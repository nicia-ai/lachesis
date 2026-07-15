import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import {
  type BenchmarkCaseRecord,
  benchmarkCaseRecordSchema,
  type BenchmarkStore,
} from "@nicia-ai/lachesis-generator";
import { z } from "zod";

const persistedRecordsSchema = z.array(benchmarkCaseRecordSchema).readonly();
const fileErrorSchema = z.object({ code: z.string() });

function storageDiagnostic(action: string, error: unknown): Diagnostic {
  return diagnostic(
    "INTERNAL_INVARIANT_VIOLATION",
    `Unable to ${action} benchmark records: ${error instanceof Error ? error.message : String(error)}.`,
  );
}

async function readRecords(
  path: string,
): Promise<Result<ReadonlyArray<BenchmarkCaseRecord>, Diagnostic>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error: unknown) {
    const fileError = fileErrorSchema.safeParse(error);
    if (fileError.success && fileError.data.code === "ENOENT") {
      return { ok: true, value: [] };
    }
    return { ok: false, error: storageDiagnostic("read", error) };
  }
  const json = parseJson(text);
  if (!json.ok) return json;
  const parsed = persistedRecordsSchema.safeParse(json.value);
  if (!parsed.success) {
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        `Persisted benchmark record is invalid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}.`,
      ),
    };
  }
  const keys = new Set<string>();
  for (const record of parsed.data) {
    if (keys.has(record.key)) {
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          `Persisted benchmark record contains duplicate key ${record.key}.`,
        ),
      };
    }
    keys.add(record.key);
    const { digest, ...body } = record;
    const computed = await digestValue(body);
    if (!computed.ok) return computed;
    if (computed.value !== digest) {
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          `Persisted benchmark record ${record.key} failed its content digest.`,
        ),
      };
    }
  }
  return { ok: true, value: parsed.data };
}

export async function createJsonFileBenchmarkStore(
  path: string,
): Promise<Result<BenchmarkStore, Diagnostic>> {
  const loaded = await readRecords(path);
  if (!loaded.ok) return loaded;
  const records = new Map(loaded.value.map((record) => [record.key, record]));
  return {
    ok: true,
    value: {
      load: (key) => Promise.resolve({ ok: true, value: records.get(key) }),
      async save(record) {
        const nextRecords = new Map(records);
        nextRecords.set(record.key, record);
        const canonical = canonicalizeJson(
          [...nextRecords.values()].sort((left, right) =>
            left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
          ),
        );
        if (!canonical.ok) return canonical;
        const temporaryPath = `${path}.tmp`;
        try {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(temporaryPath, `${canonical.value}\n`, "utf8");
          await rename(temporaryPath, path);
        } catch (error: unknown) {
          return { ok: false, error: storageDiagnostic("write", error) };
        }
        records.clear();
        for (const [key, value] of nextRecords) records.set(key, value);
        return { ok: true, value: undefined };
      },
    },
  };
}
