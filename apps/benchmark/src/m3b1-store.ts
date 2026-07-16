import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import {
  type M3bRecord,
  m3bRecordSchema,
  type M3bStore,
} from "@nicia-ai/lachesis-evidence";
import { z } from "zod";

const fileErrorSchema = z.looseObject({ code: z.string() });

function storageFailure(action: string, error: unknown): Diagnostic {
  return diagnostic(
    "INVALID_WIRE_SCHEMA",
    `Unable to ${action} M3b.1 record: ${error instanceof Error ? error.message : String(error)}.`,
  );
}

async function recordPath(
  root: string,
  key: string,
): Promise<Result<string, Diagnostic>> {
  const digest = await digestValue({ key });
  return digest.ok
    ? { ok: true, value: join(root, `${digest.value}.json`) }
    : digest;
}

export function createJsonFileM3b1Store(root: string): M3bStore {
  return {
    async load(key) {
      const path = await recordPath(root, key);
      if (!path.ok) return path;
      let text: string;
      try {
        text = await readFile(path.value, "utf8");
      } catch (error: unknown) {
        const parsed = fileErrorSchema.safeParse(error);
        return parsed.success && parsed.data.code === "ENOENT"
          ? { ok: true, value: undefined }
          : { ok: false, error: storageFailure("read", error) };
      }
      const json = parseJson(text);
      if (!json.ok) return json;
      const parsed = m3bRecordSchema.safeParse(json.value);
      if (!parsed.success || parsed.data.key !== key)
        return {
          ok: false,
          error: diagnostic(
            "REPLAY_OUTPUT_MISMATCH",
            "Durable M3b.1 record failed schema or content-address validation.",
          ),
        };
      return { ok: true, value: parsed.data };
    },
    async save(record: M3bRecord) {
      const path = await recordPath(root, record.key);
      if (!path.ok) return path;
      const canonical = canonicalizeJson(record);
      if (!canonical.ok) return canonical;
      try {
        await mkdir(root, { recursive: true, mode: 0o700 });
        await writeFile(path.value, `${canonical.value}\n`, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        return { ok: true, value: undefined };
      } catch (error: unknown) {
        return { ok: false, error: storageFailure("append", error) };
      }
    },
  };
}
