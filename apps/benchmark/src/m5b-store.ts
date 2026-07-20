import {
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import {
  type M5RecordingStore,
  m5ReplayArtifactSchema,
  type M5RuntimeFailure,
} from "@nicia-ai/lachesis-evidence";
import { z } from "zod";

import type { M5bAttemptType } from "./m5b-ledger.js";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u);

const sanitizedIssueSchema = z
  .strictObject({
    code: z.string().min(1).max(128),
    path: z
      .array(z.union([z.string().max(128), z.number().int().nonnegative()]))
      .max(32)
      .readonly(),
  })
  .readonly();

export const m5bDurableAttemptSchema = z
  .strictObject({
    attemptIndex: z.number().int().nonnegative(),
    attemptType: z.enum([
      "initial",
      "wire-repair",
      "semantic-repair",
      "transport-retry",
    ]),
    requestDigest: digestSchema,
    kind: z.enum(["success", "failure"]),
    failureCode: z.string().min(1).nullable(),
    dispatchEvidence: z.enum([
      "not-dispatched",
      "dispatched-with-usage",
      "dispatched-usage-unknown",
    ]),
    stage: z.string().min(1),
    category: z.string().min(1),
    usage: z
      .strictObject({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        latencyMs: z.number().int().nonnegative(),
        costUsdMicros: z.number().int().nonnegative(),
      })
      .readonly()
      .nullable(),
    outputDigest: digestSchema.nullable(),
    outputSizeBytes: z.number().int().nonnegative().nullable(),
    providerEnvelopeDigest: digestSchema.nullable(),
    issues: z.array(sanitizedIssueSchema).max(64).readonly(),
  })
  .readonly();

export type M5bDurableAttempt = z.infer<typeof m5bDurableAttemptSchema>;

export const m5bRecordSchema = z
  .strictObject({
    protocol: z.literal("m5b-production-pilot-record/1"),
    recordKey: digestSchema,
    experimentDigest: digestSchema,
    phaseManifestDigest: digestSchema,
    corpusDigest: digestSchema,
    taskId: identifierSchema,
    taskDigest: digestSchema,
    provider: z.enum(["openai", "anthropic"]),
    model: z.string().min(1),
    requestDigest: digestSchema,
    attempts: z.array(m5bDurableAttemptSchema).max(6).readonly(),
    firstAttemptEndToEndSuccess: z.boolean(),
    firstAttemptSemanticSuccess: z.boolean(),
    postWireRepairSuccess: z.boolean().nullable(),
    postSemanticRepairSuccess: z.boolean().nullable(),
    finalReliability: z.boolean(),
    terminalClassification: z.string().min(1),
    replayArtifactDigest: digestSchema.nullable(),
    runtimeResultDigest: digestSchema.nullable(),
    citationCount: z.number().int().nonnegative(),
    provenanceReconstructionDigest: digestSchema.nullable(),
    recordDigest: digestSchema,
  })
  .readonly();

export type M5bRecord = z.infer<typeof m5bRecordSchema>;

export type M5bRecordStore = Readonly<{
  load: (
    recordKey: string,
  ) => Promise<Result<M5bRecord | undefined, Diagnostic>>;
  save: (record: M5bRecord) => Promise<Result<void, Diagnostic>>;
  list: () => Promise<Result<ReadonlyArray<M5bRecord>, Diagnostic>>;
}>;

const fileErrorSchema = z.looseObject({ code: z.string() });

function failure(action: string, error?: unknown): Diagnostic {
  return diagnostic(
    "REPLAY_OUTPUT_MISMATCH",
    `Unable to ${action} M5b artifact${
      error === undefined
        ? "."
        : `: ${error instanceof Error ? error.name : "unknown-error"}.`
    }`,
  );
}

function runtimeFailure(message: string): M5RuntimeFailure {
  return {
    code: "RECORDING_FAILED",
    stage: "recording",
    message,
    issues: [],
  };
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

async function atomicWritePrivate(
  path: string,
  text: string,
): Promise<Result<void, Diagnostic>> {
  const directory = dirname(path);
  const temporary = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await ensurePrivateDirectory(directory);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    await chmod(path, 0o600);
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    try {
      await unlink(temporary);
    } catch {
      // The temporary path is best-effort cleanup after a typed write failure.
    }
    return { ok: false, error: failure("atomically write", error) };
  }
}

async function readOptional(
  path: string,
): Promise<Result<string | undefined, Diagnostic>> {
  try {
    return { ok: true, value: await readFile(path, "utf8") };
  } catch (error: unknown) {
    const parsed = fileErrorSchema.safeParse(error);
    return parsed.success && parsed.data.code === "ENOENT"
      ? { ok: true, value: undefined }
      : { ok: false, error: failure("read", error) };
  }
}

function recordPath(root: string, recordKey: string): string {
  return join(root, "records", `${recordKey}.json`);
}

export function createM5bRecordStore(root: string): M5bRecordStore {
  return {
    async load(recordKey) {
      const digest = digestSchema.safeParse(recordKey);
      if (!digest.success)
        return { ok: false, error: failure("validate record key") };
      const text = await readOptional(recordPath(root, digest.data));
      if (!text.ok) return text;
      if (text.value === undefined) return { ok: true, value: undefined };
      const json = parseJson(text.value);
      if (!json.ok) return json;
      const parsed = m5bRecordSchema.safeParse(json.value);
      if (!parsed.success || parsed.data.recordKey !== digest.data)
        return { ok: false, error: failure("validate durable record") };
      const { recordDigest, ...body } = parsed.data;
      const computed = await digestValue(body);
      return computed.ok && computed.value === recordDigest
        ? { ok: true, value: parsed.data }
        : { ok: false, error: failure("verify durable record identity") };
    },
    async save(record) {
      const parsed = m5bRecordSchema.safeParse(record);
      if (!parsed.success)
        return { ok: false, error: failure("validate record before save") };
      const existing = await this.load(parsed.data.recordKey);
      if (!existing.ok) return existing;
      if (existing.value !== undefined)
        return existing.value.recordDigest === parsed.data.recordDigest
          ? { ok: true, value: undefined }
          : { ok: false, error: failure("prevent duplicate record dispatch") };
      const canonical = canonicalizeJson(parsed.data);
      if (!canonical.ok) return canonical;
      return atomicWritePrivate(
        recordPath(root, parsed.data.recordKey),
        `${canonical.value}\n`,
      );
    },
    async list() {
      const directory = join(root, "records");
      let names: ReadonlyArray<string>;
      try {
        names = await readdir(directory);
      } catch (error: unknown) {
        const parsed = fileErrorSchema.safeParse(error);
        return parsed.success && parsed.data.code === "ENOENT"
          ? { ok: true, value: [] }
          : { ok: false, error: failure("list records", error) };
      }
      const records: Array<M5bRecord> = [];
      for (const name of names.toSorted()) {
        if (!name.endsWith(".json")) continue;
        const loaded = await this.load(name.slice(0, -5));
        if (!loaded.ok) return loaded;
        if (loaded.value !== undefined) records.push(loaded.value);
      }
      return { ok: true, value: records };
    },
  };
}

function replayPath(root: string, digest: string): string {
  return join(root, "replay", `${digest}.json`);
}

export function createDurableM5RecordingStore(root: string): M5RecordingStore {
  return {
    async load(artifactDigest, signal) {
      if (signal.aborted)
        return { ok: false, error: runtimeFailure("Replay load cancelled.") };
      const digest = digestSchema.safeParse(artifactDigest);
      if (!digest.success)
        return {
          ok: false,
          error: runtimeFailure("Replay digest is invalid."),
        };
      const text = await readOptional(replayPath(root, digest.data));
      if (!text.ok)
        return { ok: false, error: runtimeFailure(text.error.message) };
      if (text.value === undefined) return { ok: true, value: undefined };
      const json = parseJson(text.value);
      if (!json.ok)
        return { ok: false, error: runtimeFailure(json.error.message) };
      const parsed = m5ReplayArtifactSchema.safeParse(json.value);
      return parsed.success && parsed.data.artifactDigest === digest.data
        ? { ok: true, value: parsed.data }
        : {
            ok: false,
            error: runtimeFailure("Replay artifact failed schema or identity."),
          };
    },
    async save(artifact, signal) {
      if (signal.aborted)
        return { ok: false, error: runtimeFailure("Replay save cancelled.") };
      const parsed = m5ReplayArtifactSchema.safeParse(artifact);
      if (!parsed.success)
        return {
          ok: false,
          error: runtimeFailure("Replay artifact is invalid."),
        };
      const path = replayPath(root, parsed.data.artifactDigest);
      const existing = await readOptional(path);
      if (!existing.ok)
        return { ok: false, error: runtimeFailure(existing.error.message) };
      const canonical = canonicalizeJson(parsed.data);
      if (!canonical.ok)
        return { ok: false, error: runtimeFailure(canonical.error.message) };
      if (existing.value !== undefined)
        return existing.value === `${canonical.value}\n`
          ? { ok: true, value: undefined }
          : {
              ok: false,
              error: runtimeFailure("Replay content address already differs."),
            };
      const written = await atomicWritePrivate(path, `${canonical.value}\n`);
      return written.ok
        ? { ok: true, value: undefined }
        : { ok: false, error: runtimeFailure(written.error.message) };
    },
  };
}

export async function createM5bRecord(
  body: Omit<M5bRecord, "recordDigest">,
): Promise<Result<M5bRecord, Diagnostic>> {
  const digest = await digestValue(body);
  if (!digest.ok) return digest;
  const parsed = m5bRecordSchema.safeParse({
    ...body,
    recordDigest: digest.value,
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        error: diagnostic(
          "REPLAY_OUTPUT_MISMATCH",
          `Unable to construct durable M5b record: ${parsed.error.issues
            .slice(0, 8)
            .map((issue) => `${issue.path.join(".")}:${issue.code}`)
            .join(", ")}.`,
        ),
      };
}

export async function auditPrivateArtifactPermissions(
  root: string,
  artifactPaths: ReadonlyArray<string>,
): Promise<Result<void, Diagnostic>> {
  try {
    const rootMode = (await stat(root)).mode & 0o777;
    if (rootMode !== 0o700)
      return { ok: false, error: failure("verify private root permissions") };
    for (const path of artifactPaths) {
      const mode = (await stat(path)).mode & 0o777;
      if (mode !== 0o600)
        return { ok: false, error: failure("verify private file permissions") };
    }
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    return { ok: false, error: failure("audit artifact permissions", error) };
  }
}

export async function auditM5bRedaction(
  input: Readonly<{
    value: unknown;
    forbiddenValues: ReadonlyArray<string>;
  }>,
): Promise<
  Result<
    Readonly<{ digest: string; leaked: ReadonlyArray<string> }>,
    Diagnostic
  >
> {
  const canonical = canonicalizeJson(input.value);
  if (!canonical.ok) return canonical;
  const leaked = input.forbiddenValues
    .filter((value) => value.length > 0 && canonical.value.includes(value))
    .toSorted();
  const digest = await digestValue({
    redactedValue: input.value,
    forbiddenValueCount: input.forbiddenValues.length,
  });
  return digest.ok
    ? { ok: true, value: { digest: digest.value, leaked } }
    : digest;
}

export function attemptType(value: M5bAttemptType): M5bAttemptType {
  return value;
}
