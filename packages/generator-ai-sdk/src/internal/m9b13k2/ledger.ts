import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { canonicalizeJson, parseJson, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  M9B13K2_ARTIFACT_IDENTITY,
  M9B13K2_DRAFT_ID,
  M9B13K2_LEDGER_PROTOCOL,
  M9B13K2_MAXIMUM_HTTP_REQUESTS,
  M9B13K2_MAXIMUM_PUT_DISPATCHES,
  M9B13K2_MAXIMUM_REVOCATION_DISPATCHES,
  M9B13K2_PROJECT_ID,
  M9B13K2_PROVIDER,
  m9b13k2BoundDigestSchema,
  m9b13k2CanonicalDigest,
  m9b13k2DigestSchema,
  m9b13k2DomainDigest,
  type M9b13k2Failure,
  m9b13k2Failure,
} from "./protocol.js";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const MAXIMUM_LEDGER_BYTES = 16 * 1024 * 1024;
const DATABASE_FILENAME = "ledger.sqlite";
const ANCHOR_FILENAME = "ledger.anchor.json";
const SQLITE_SIDECAR_SUFFIXES = ["-journal", "-wal", "-shm"] as const;

export const m9b13k2LedgerEventKindSchema = z.enum([
  "activation-reserved",
  "request-reserved",
  "request-dispatched",
  "request-completed",
  "request-ambiguous",
  "upload-completed",
  "revocation-reserved",
  "revocation-dispatched",
  "revocation-completed",
  "awaiting-independent-revocation-verification",
  "custodian-receipt",
  "terminal",
]);
export type M9b13k2LedgerEventKind = z.infer<
  typeof m9b13k2LedgerEventKindSchema
>;

export const m9b13k2RequestClassSchema = z.enum([
  "token-detail",
  "project-detail",
  "registrations",
  "view-only-links",
  "files-inventory",
  "provider-root",
  "upload",
  "download",
  "revoke-token",
]);
export type M9b13k2RequestClass = z.infer<typeof m9b13k2RequestClassSchema>;

const nullableRequestIndexSchema = z.number().int().positive().nullable();
const nullableStatusSchema = z.number().int().min(100).max(599).nullable();
const nullableNonnegativeSchema = z.number().nonnegative().nullable();
const nullableOutcomeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9:-]*$/u)
  .nullable();

const ledgerEventBodySchema = z
  .strictObject({
    protocol: z.literal(M9B13K2_LEDGER_PROTOCOL),
    schemaVersion: z.literal(1),
    sequence: z.number().int().positive(),
    activationIdentity: m9b13k2BoundDigestSchema,
    runtimeIdentity: m9b13k2DigestSchema,
    campaignIdentity: m9b13k2BoundDigestSchema,
    requestIdentity: m9b13k2BoundDigestSchema,
    kind: m9b13k2LedgerEventKindSchema,
    requestIndex: nullableRequestIndexSchema,
    requestClass: m9b13k2RequestClassSchema.nullable(),
    method: z.enum(["DELETE", "GET", "PUT"]).nullable(),
    urlDigest: m9b13k2DigestSchema.nullable(),
    host: z.string().min(1).max(253).nullable(),
    pathClass: z.string().min(1).max(256).nullable(),
    queryNames: z.array(z.string().min(1).max(128)).max(16).readonly(),
    projectId: z.literal(M9B13K2_PROJECT_ID),
    draftId: z.literal(M9B13K2_DRAFT_ID),
    provider: z.literal(M9B13K2_PROVIDER),
    artifactIdentity: z.literal(M9B13K2_ARTIFACT_IDENTITY),
    tokenId: z.string().regex(/^[a-f0-9]{24}$/u),
    responseStatus: nullableStatusSchema,
    responseDigest: m9b13k2DigestSchema.nullable(),
    receiptDigest: m9b13k2DigestSchema.nullable(),
    custodianIdentity: m9b13k2BoundDigestSchema.nullable(),
    outcome: nullableOutcomeSchema,
    observedMonotonicMs: z.number().nonnegative(),
    deadlineMonotonicMs: nullableNonnegativeSchema,
    priorEventDigest: m9b13k2DigestSchema,
  })
  .readonly();

export const m9b13k2LedgerEventSchema = ledgerEventBodySchema
  .unwrap()
  .safeExtend({ eventDigest: m9b13k2DigestSchema })
  .readonly();
export type M9b13k2LedgerEvent = z.infer<typeof m9b13k2LedgerEventSchema>;

export const m9b13k2LedgerStateSchema = z
  .strictObject({
    protocol: z.literal(M9B13K2_LEDGER_PROTOCOL),
    schemaVersion: z.literal(1),
    storeIdentity: m9b13k2DigestSchema,
    activationIdentity: m9b13k2BoundDigestSchema,
    runtimeIdentity: m9b13k2DigestSchema,
    namespaceCommitment: m9b13k2BoundDigestSchema,
    initialRoot: m9b13k2DigestSchema,
    revision: z.number().int().nonnegative(),
    headDigest: m9b13k2DigestSchema,
    cumulativeHttpRequests: z
      .number()
      .int()
      .min(0)
      .max(M9B13K2_MAXIMUM_HTTP_REQUESTS),
    putReservations: z
      .number()
      .int()
      .min(0)
      .max(M9B13K2_MAXIMUM_PUT_DISPATCHES),
    putDispatches: z.number().int().min(0).max(M9B13K2_MAXIMUM_PUT_DISPATCHES),
    revocationReservations: z
      .number()
      .int()
      .min(0)
      .max(M9B13K2_MAXIMUM_REVOCATION_DISPATCHES),
    revocationDispatches: z
      .number()
      .int()
      .min(0)
      .max(M9B13K2_MAXIMUM_REVOCATION_DISPATCHES),
    events: z.array(m9b13k2LedgerEventSchema).readonly(),
  })
  .readonly();
export type M9b13k2LedgerState = z.infer<typeof m9b13k2LedgerStateSchema>;

export type M9b13k2LedgerEventDraft = Omit<
  M9b13k2LedgerEvent,
  "eventDigest" | "priorEventDigest" | "protocol" | "schemaVersion" | "sequence"
>;

const trustedBindingSchema = z
  .strictObject({
    protocol: z.literal(M9B13K2_LEDGER_PROTOCOL),
    schemaVersion: z.literal(1),
    storeIdentity: m9b13k2DigestSchema,
    anchorIdentity: m9b13k2DigestSchema,
    activationIdentity: m9b13k2BoundDigestSchema,
    runtimeIdentity: m9b13k2DigestSchema,
    namespaceCommitment: m9b13k2BoundDigestSchema,
    initialRoot: m9b13k2DigestSchema,
  })
  .readonly();
export type M9b13k2LedgerBinding = z.infer<typeof trustedBindingSchema>;

const anchorBodySchema = trustedBindingSchema.unwrap().safeExtend({
  revision: z.number().int().nonnegative(),
  headDigest: m9b13k2DigestSchema,
  stateDigest: m9b13k2DigestSchema,
});
const anchorSchema = anchorBodySchema
  .safeExtend({ anchorDigest: m9b13k2DigestSchema })
  .readonly();
type LedgerAnchor = z.infer<typeof anchorSchema>;

const databaseRowSchema = z.object({
  protocol: z.string(),
  store_identity: z.string(),
  revision: z.number().int().nonnegative(),
  head_digest: z.string(),
  state_json: z.string(),
  state_digest: z.string(),
});

const ledgerBrand: unique symbol = Symbol("M9b13k2FilesystemLedger");
export type M9b13k2FilesystemLedger = Readonly<{
  [ledgerBrand]: "M9b13k2FilesystemLedger";
}>;
type LedgerHandleState = Readonly<{
  namespacePath: string;
  databasePath: string;
  anchorPath: string;
  binding: M9b13k2LedgerBinding;
}>;
const ledgerHandles = new WeakMap<object, LedgerHandleState>();

export type M9b13k2LedgerAudit = Readonly<{
  protocol: typeof M9B13K2_LEDGER_PROTOCOL;
  storeIdentity: string;
  revision: number;
  headDigest: string;
  cumulativeHttpRequests: number;
  putReservations: number;
  putDispatches: number;
  revocationReservations: number;
  revocationDispatches: number;
  terminal: boolean;
  ambiguous: boolean;
  namespaceMode: 448;
  databaseMode: 384;
  anchorMode: 384;
}>;

export type M9b13k2LedgerCommitFault =
  | "none"
  | "before-database-update"
  | "after-database-commit-before-anchor"
  | "pause-after-database-commit-before-anchor";

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function modeOf(mode: number): number {
  return mode & 0o777;
}

function currentUserId(): Result<number, M9b13k2Failure> {
  const userId = process.getuid?.();
  return userId === undefined
    ? m9b13k2Failure("ledger", "m9b13k2-ledger-user-id-unavailable")
    : { ok: true, value: userId };
}

function exactAbsolutePath(path: string): Result<string, M9b13k2Failure> {
  return isAbsolute(path) && resolve(path) === path
    ? { ok: true, value: path }
    : m9b13k2Failure(
        "ledger",
        "m9b13k2-ledger-namespace-not-normalized-absolute",
      );
}

async function validatePrivateDirectory(
  path: string,
  userId: number,
): Promise<Result<void, M9b13k2Failure>> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      return m9b13k2Failure(
        "ledger",
        "m9b13k2-ledger-namespace-not-private-directory",
      );
    if (
      metadata.uid !== userId ||
      modeOf(metadata.mode) !== PRIVATE_DIRECTORY_MODE
    )
      return m9b13k2Failure(
        "ledger",
        "m9b13k2-ledger-namespace-owner-or-mode-invalid",
      );
    const canonical = await realpath(path);
    const expected = join(await realpath(dirname(path)), basename(path));
    return canonical === expected
      ? { ok: true, value: undefined }
      : m9b13k2Failure("ledger", "m9b13k2-ledger-namespace-symlink-or-alias");
  } catch (error: unknown) {
    return m9b13k2Failure(
      "ledger",
      `m9b13k2-ledger-namespace-audit-${error instanceof Error ? error.name : "unknown"}`,
    );
  }
}

async function validatePrivateFile(
  path: string,
  userId: number,
  label: string,
): Promise<Result<void, M9b13k2Failure>> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile())
      return m9b13k2Failure("ledger", `m9b13k2-ledger-${label}-not-regular`);
    if (metadata.uid !== userId || modeOf(metadata.mode) !== PRIVATE_FILE_MODE)
      return m9b13k2Failure(
        "ledger",
        `m9b13k2-ledger-${label}-owner-or-mode-invalid`,
      );
    if (metadata.size > MAXIMUM_LEDGER_BYTES)
      return m9b13k2Failure("ledger", `m9b13k2-ledger-${label}-oversized`);
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    return m9b13k2Failure(
      "ledger",
      `m9b13k2-ledger-${label}-audit-${error instanceof Error ? error.name : "unknown"}`,
    );
  }
}

async function auditSidecars(
  databasePath: string,
  userId: number,
  activeTransaction: boolean,
): Promise<Result<void, M9b13k2Failure>> {
  const parent = dirname(databasePath);
  const databaseName = basename(databasePath);
  const allowed = new Set(
    SQLITE_SIDECAR_SUFFIXES.map((suffix) => `${databaseName}${suffix}`),
  );
  try {
    for (const name of await readdir(parent)) {
      if (name.startsWith(`${databaseName}-`) && !allowed.has(name))
        return m9b13k2Failure("ledger", "m9b13k2-ledger-unknown-sidecar");
    }
    for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
      const path = `${databasePath}${suffix}`;
      try {
        await lstat(path);
      } catch (error: unknown) {
        if (errorCode(error) === "ENOENT") continue;
        throw error;
      }
      if (!activeTransaction)
        return m9b13k2Failure("ledger", "m9b13k2-ledger-residual-sidecar");
      const validated = await validatePrivateFile(
        path,
        userId,
        `sidecar-${suffix.slice(1)}`,
      );
      if (!validated.ok) return validated;
    }
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    return m9b13k2Failure(
      "ledger",
      `m9b13k2-ledger-sidecar-audit-${error instanceof Error ? error.name : "unknown"}`,
    );
  }
}

async function syncDirectory(
  path: string,
): Promise<Result<void, M9b13k2Failure>> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    return m9b13k2Failure(
      "ledger",
      `m9b13k2-ledger-directory-sync-${error instanceof Error ? error.name : "unknown"}`,
      true,
    );
  }
}

async function writePrivateJson(
  path: string,
  value: unknown,
  createOnly: boolean,
): Promise<Result<void, M9b13k2Failure>> {
  const canonical = canonicalizeJson(value);
  if (!canonical.ok)
    return m9b13k2Failure("ledger", "m9b13k2-ledger-anchor-not-canonical");
  const temporary = `${path}.tmp-${randomUUID()}`;
  const target = createOnly ? path : temporary;
  try {
    const handle = await open(
      target,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
    try {
      await handle.writeFile(canonical.value, { encoding: "utf8" });
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!createOnly) await rename(temporary, path);
    return await syncDirectory(dirname(path));
  } catch (error: unknown) {
    return m9b13k2Failure(
      "ledger",
      `m9b13k2-ledger-anchor-write-${error instanceof Error ? error.name : "unknown"}`,
      !createOnly,
    );
  } finally {
    if (!createOnly)
      try {
        await unlink(temporary);
      } catch (error: unknown) {
        if (errorCode(error) !== "ENOENT") void error;
      }
  }
}

function configureDatabase(database: DatabaseSync): void {
  database.exec(
    "PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA temp_store = MEMORY; PRAGMA busy_timeout = 1000;",
  );
}

function eventBody(
  event: M9b13k2LedgerEvent,
): z.infer<typeof ledgerEventBodySchema> {
  const { eventDigest: ignoredEventDigest, ...body } = event;
  void ignoredEventDigest;
  return ledgerEventBodySchema.parse(body);
}

function initialRoot(
  binding: Omit<M9b13k2LedgerBinding, "initialRoot">,
): string {
  return m9b13k2DomainDigest(
    M9B13K2_LEDGER_PROTOCOL,
    binding.storeIdentity,
    binding.anchorIdentity,
    binding.activationIdentity,
    binding.runtimeIdentity,
    binding.namespaceCommitment,
    "initial-root",
  );
}

type DerivedCounters = Readonly<{
  cumulativeHttpRequests: number;
  putReservations: number;
  putDispatches: number;
  revocationReservations: number;
  revocationDispatches: number;
  terminal: boolean;
  ambiguous: boolean;
}>;

function deriveCounters(
  events: ReadonlyArray<M9b13k2LedgerEvent>,
): Result<DerivedCounters, M9b13k2Failure> {
  const reserved = new Map<number, M9b13k2LedgerEvent>();
  const dispatched = new Set<number>();
  const completed = new Set<number>();
  let cumulativeHttpRequests = 0;
  let putReservations = 0;
  let putDispatches = 0;
  let revocationReservations = 0;
  let revocationDispatches = 0;
  let terminal = false;
  let ambiguous = false;
  for (const event of events) {
    if (
      event.kind === "request-reserved" ||
      event.kind === "revocation-reserved"
    ) {
      if (
        event.requestIndex !== cumulativeHttpRequests + 1 ||
        event.requestClass === null ||
        event.method === null ||
        event.urlDigest === null ||
        reserved.has(event.requestIndex)
      )
        return m9b13k2Failure(
          "ledger",
          "m9b13k2-ledger-request-reservation-invalid",
        );
      cumulativeHttpRequests += 1;
      reserved.set(event.requestIndex, event);
      if (event.requestClass === "upload") putReservations += 1;
      if (event.kind === "revocation-reserved") {
        if (event.requestClass !== "revoke-token")
          return m9b13k2Failure(
            "ledger",
            "m9b13k2-ledger-revocation-reservation-invalid",
          );
        revocationReservations += 1;
      }
    }
    if (
      event.kind === "request-dispatched" ||
      event.kind === "revocation-dispatched"
    ) {
      if (
        event.requestIndex === null ||
        !reserved.has(event.requestIndex) ||
        dispatched.has(event.requestIndex)
      )
        return m9b13k2Failure(
          "ledger",
          "m9b13k2-ledger-request-dispatch-invalid",
        );
      const reservation = reserved.get(event.requestIndex);
      if (
        reservation?.requestClass !== event.requestClass ||
        reservation.method !== event.method ||
        reservation.urlDigest !== event.urlDigest
      )
        return m9b13k2Failure(
          "ledger",
          "m9b13k2-ledger-request-dispatch-binding-invalid",
        );
      dispatched.add(event.requestIndex);
      if (event.requestClass === "upload") putDispatches += 1;
      if (event.kind === "revocation-dispatched") {
        if (event.requestClass !== "revoke-token")
          return m9b13k2Failure(
            "ledger",
            "m9b13k2-ledger-revocation-dispatch-invalid",
          );
        revocationDispatches += 1;
      }
    }
    if (
      event.kind === "request-completed" ||
      event.kind === "request-ambiguous" ||
      event.kind === "revocation-completed"
    ) {
      if (
        event.requestIndex === null ||
        !dispatched.has(event.requestIndex) ||
        completed.has(event.requestIndex)
      )
        return m9b13k2Failure(
          "ledger",
          "m9b13k2-ledger-request-completion-invalid",
        );
      completed.add(event.requestIndex);
      if (event.kind === "request-ambiguous") ambiguous = true;
    }
    if (event.kind === "terminal") {
      if (terminal)
        return m9b13k2Failure("ledger", "m9b13k2-ledger-duplicate-terminal");
      terminal = true;
    }
  }
  if (
    cumulativeHttpRequests > M9B13K2_MAXIMUM_HTTP_REQUESTS ||
    putReservations > M9B13K2_MAXIMUM_PUT_DISPATCHES ||
    putDispatches > M9B13K2_MAXIMUM_PUT_DISPATCHES ||
    revocationReservations > M9B13K2_MAXIMUM_REVOCATION_DISPATCHES ||
    revocationDispatches > M9B13K2_MAXIMUM_REVOCATION_DISPATCHES
  )
    return m9b13k2Failure("ledger", "m9b13k2-ledger-effect-budget-exceeded");
  if (completed.size < reserved.size) ambiguous = true;
  return {
    ok: true,
    value: {
      cumulativeHttpRequests,
      putReservations,
      putDispatches,
      revocationReservations,
      revocationDispatches,
      terminal,
      ambiguous,
    },
  };
}

export function validateM9b13k2LedgerState(
  value: unknown,
): Result<M9b13k2LedgerState, M9b13k2Failure> {
  const parsed = m9b13k2LedgerStateSchema.safeParse(value);
  if (!parsed.success)
    return m9b13k2Failure("ledger", "m9b13k2-ledger-state-schema-invalid");
  const state = parsed.data;
  if (state.revision !== state.events.length)
    return m9b13k2Failure("ledger", "m9b13k2-ledger-state-truncated");
  let root = state.initialRoot;
  for (const [index, event] of state.events.entries()) {
    if (
      event.sequence !== index + 1 ||
      event.priorEventDigest !== root ||
      event.activationIdentity !== state.activationIdentity ||
      event.runtimeIdentity !== state.runtimeIdentity
    )
      return m9b13k2Failure("ledger", "m9b13k2-ledger-event-chain-invalid");
    const digest = m9b13k2CanonicalDigest(eventBody(event));
    if (!digest.ok || digest.value !== event.eventDigest)
      return m9b13k2Failure("ledger", "m9b13k2-ledger-event-digest-invalid");
    root = event.eventDigest;
  }
  const counters = deriveCounters(state.events);
  if (!counters.ok) return counters;
  if (
    root !== state.headDigest ||
    state.cumulativeHttpRequests !== counters.value.cumulativeHttpRequests ||
    state.putReservations !== counters.value.putReservations ||
    state.putDispatches !== counters.value.putDispatches ||
    state.revocationReservations !== counters.value.revocationReservations ||
    state.revocationDispatches !== counters.value.revocationDispatches
  )
    return m9b13k2Failure("ledger", "m9b13k2-ledger-derived-state-mismatch");
  return { ok: true, value: state };
}

function makeLedgerHandle(state: LedgerHandleState): M9b13k2FilesystemLedger {
  const handle: M9b13k2FilesystemLedger = Object.freeze({
    [ledgerBrand]: "M9b13k2FilesystemLedger",
  });
  ledgerHandles.set(handle, state);
  return handle;
}

function resolveHandle(
  value: M9b13k2FilesystemLedger,
): Result<LedgerHandleState, M9b13k2Failure> {
  const state = ledgerHandles.get(value);
  return state === undefined
    ? m9b13k2Failure("ledger", "m9b13k2-ledger-handle-invalid")
    : { ok: true, value: state };
}

async function auditHandlePaths(
  handle: LedgerHandleState,
  activeTransaction = false,
): Promise<Result<number, M9b13k2Failure>> {
  const userId = currentUserId();
  if (!userId.ok) return userId;
  const namespace = await validatePrivateDirectory(
    handle.namespacePath,
    userId.value,
  );
  if (!namespace.ok) return namespace;
  const database = await validatePrivateFile(
    handle.databasePath,
    userId.value,
    "database",
  );
  if (!database.ok) return database;
  const anchor = await validatePrivateFile(
    handle.anchorPath,
    userId.value,
    "anchor",
  );
  if (!anchor.ok) return anchor;
  const sidecars = await auditSidecars(
    handle.databasePath,
    userId.value,
    activeTransaction,
  );
  return sidecars.ok ? userId : sidecars;
}

async function readAnchor(
  path: string,
  userId: number,
): Promise<Result<LedgerAnchor, M9b13k2Failure>> {
  const audited = await validatePrivateFile(path, userId, "anchor");
  if (!audited.ok) return audited;
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let text: string;
    try {
      const opened = await handle.stat();
      const named = await lstat(path);
      if (opened.dev !== named.dev || opened.ino !== named.ino)
        return m9b13k2Failure(
          "ledger",
          "m9b13k2-ledger-anchor-replaced-during-read",
        );
      text = await handle.readFile({ encoding: "utf8" });
    } finally {
      await handle.close();
    }
    const json = parseJson(text);
    const parsed = anchorSchema.safeParse(json.ok ? json.value : undefined);
    if (!parsed.success)
      return m9b13k2Failure("ledger", "m9b13k2-ledger-anchor-schema-invalid");
    const { anchorDigest: ignoredAnchorDigest, ...body } = parsed.data;
    void ignoredAnchorDigest;
    const digest = m9b13k2CanonicalDigest(anchorBodySchema.parse(body));
    return digest.ok && digest.value === parsed.data.anchorDigest
      ? { ok: true, value: parsed.data }
      : m9b13k2Failure("ledger", "m9b13k2-ledger-anchor-digest-invalid");
  } catch (error: unknown) {
    return m9b13k2Failure(
      "ledger",
      `m9b13k2-ledger-anchor-read-${error instanceof Error ? error.name : "unknown"}`,
    );
  }
}

function readDatabaseState(
  database: DatabaseSync,
): Result<
  Readonly<{ state: M9b13k2LedgerState; digest: string }>,
  M9b13k2Failure
> {
  const row = database
    .prepare(
      "SELECT protocol, store_identity, revision, head_digest, state_json, state_digest FROM ledger_state WHERE singleton = 1",
    )
    .get();
  const parsedRow = databaseRowSchema.safeParse(row);
  if (!parsedRow.success)
    return m9b13k2Failure("ledger", "m9b13k2-ledger-database-row-invalid");
  const json = parseJson(parsedRow.data.state_json);
  const state = validateM9b13k2LedgerState(json.ok ? json.value : undefined);
  if (!state.ok) return state;
  const digest = m9b13k2CanonicalDigest(state.value);
  if (
    !digest.ok ||
    parsedRow.data.protocol !== state.value.protocol ||
    parsedRow.data.store_identity !== state.value.storeIdentity ||
    parsedRow.data.revision !== state.value.revision ||
    parsedRow.data.head_digest !== state.value.headDigest ||
    parsedRow.data.state_digest !== digest.value
  )
    return m9b13k2Failure("ledger", "m9b13k2-ledger-database-binding-invalid");
  return { ok: true, value: { state: state.value, digest: digest.value } };
}

function anchorForState(
  binding: M9b13k2LedgerBinding,
  state: M9b13k2LedgerState,
): Result<LedgerAnchor, M9b13k2Failure> {
  const stateDigest = m9b13k2CanonicalDigest(state);
  if (!stateDigest.ok) return stateDigest;
  const body = anchorBodySchema.parse({
    ...binding,
    revision: state.revision,
    headDigest: state.headDigest,
    stateDigest: stateDigest.value,
  });
  const anchorDigest = m9b13k2CanonicalDigest(body);
  return anchorDigest.ok
    ? {
        ok: true,
        value: anchorSchema.parse({
          ...body,
          anchorDigest: anchorDigest.value,
        }),
      }
    : anchorDigest;
}

function anchorMatches(
  anchor: LedgerAnchor,
  binding: M9b13k2LedgerBinding,
  state: M9b13k2LedgerState,
  stateDigest: string,
): boolean {
  return (
    anchor.storeIdentity === binding.storeIdentity &&
    anchor.anchorIdentity === binding.anchorIdentity &&
    anchor.activationIdentity === binding.activationIdentity &&
    anchor.runtimeIdentity === binding.runtimeIdentity &&
    anchor.namespaceCommitment === binding.namespaceCommitment &&
    anchor.initialRoot === binding.initialRoot &&
    anchor.revision === state.revision &&
    anchor.headDigest === state.headDigest &&
    anchor.stateDigest === stateDigest
  );
}

async function loadValidatedState(
  handle: LedgerHandleState,
  database: DatabaseSync,
  userId: number,
): Promise<Result<M9b13k2LedgerState, M9b13k2Failure>> {
  const loaded = readDatabaseState(database);
  if (!loaded.ok) return loaded;
  const anchor = await readAnchor(handle.anchorPath, userId);
  if (!anchor.ok) return anchor;
  return anchorMatches(
    anchor.value,
    handle.binding,
    loaded.value.state,
    loaded.value.digest,
  )
    ? { ok: true, value: loaded.value.state }
    : m9b13k2Failure("ledger", "m9b13k2-ledger-anchor-state-mismatch", true);
}

function appendEventToState(
  state: M9b13k2LedgerState,
  draft: M9b13k2LedgerEventDraft,
): Result<M9b13k2LedgerState, M9b13k2Failure> {
  const body = ledgerEventBodySchema.safeParse({
    ...draft,
    protocol: M9B13K2_LEDGER_PROTOCOL,
    schemaVersion: 1,
    sequence: state.revision + 1,
    priorEventDigest: state.headDigest,
  });
  if (!body.success)
    return m9b13k2Failure("ledger", "m9b13k2-ledger-event-draft-invalid");
  const digest = m9b13k2CanonicalDigest(body.data);
  if (!digest.ok) return digest;
  const event = m9b13k2LedgerEventSchema.parse({
    ...body.data,
    eventDigest: digest.value,
  });
  const counters = deriveCounters([...state.events, event]);
  if (!counters.ok) return counters;
  return validateM9b13k2LedgerState({
    ...state,
    revision: event.sequence,
    headDigest: event.eventDigest,
    cumulativeHttpRequests: counters.value.cumulativeHttpRequests,
    putReservations: counters.value.putReservations,
    putDispatches: counters.value.putDispatches,
    revocationReservations: counters.value.revocationReservations,
    revocationDispatches: counters.value.revocationDispatches,
    events: [...state.events, event],
  });
}

export async function createM9b13k2FilesystemLedger(
  namespacePathValue: string,
  activationIdentity: string,
  runtimeIdentity: string,
): Promise<
  Result<
    Readonly<{
      ledger: M9b13k2FilesystemLedger;
      binding: M9b13k2LedgerBinding;
    }>,
    M9b13k2Failure
  >
> {
  const namespacePath = exactAbsolutePath(namespacePathValue);
  const parsedActivation =
    m9b13k2BoundDigestSchema.safeParse(activationIdentity);
  const parsedRuntime = m9b13k2DigestSchema.safeParse(runtimeIdentity);
  if (!namespacePath.ok) return namespacePath;
  if (!parsedActivation.success || !parsedRuntime.success)
    return m9b13k2Failure("ledger", "m9b13k2-ledger-creation-binding-invalid");
  const userId = currentUserId();
  if (!userId.ok) return userId;
  const databasePath = join(namespacePath.value, DATABASE_FILENAME);
  const anchorPath = join(namespacePath.value, ANCHOR_FILENAME);
  try {
    await mkdir(namespacePath.value, { mode: PRIVATE_DIRECTORY_MODE });
    await chmod(namespacePath.value, PRIVATE_DIRECTORY_MODE);
    const privateNamespace = await validatePrivateDirectory(
      namespacePath.value,
      userId.value,
    );
    if (!privateNamespace.ok) return privateNamespace;
    const databaseHandle = await open(
      databasePath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_RDWR |
        constants.O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
    try {
      await databaseHandle.sync();
    } finally {
      await databaseHandle.close();
    }
    const storeIdentity = m9b13k2DomainDigest(
      M9B13K2_LEDGER_PROTOCOL,
      "store",
      randomUUID(),
    );
    const anchorIdentity = m9b13k2DomainDigest(
      M9B13K2_LEDGER_PROTOCOL,
      "anchor",
      randomUUID(),
    );
    const namespaceCommitment = `sha256:${m9b13k2DomainDigest(
      M9B13K2_LEDGER_PROTOCOL,
      "namespace",
      namespacePath.value,
      storeIdentity,
    )}`;
    const partialBinding = {
      protocol: M9B13K2_LEDGER_PROTOCOL,
      schemaVersion: 1 as const,
      storeIdentity,
      anchorIdentity,
      activationIdentity: parsedActivation.data,
      runtimeIdentity: parsedRuntime.data,
      namespaceCommitment,
    };
    const binding = trustedBindingSchema.parse({
      ...partialBinding,
      initialRoot: initialRoot(partialBinding),
    });
    const state = m9b13k2LedgerStateSchema.parse({
      protocol: M9B13K2_LEDGER_PROTOCOL,
      schemaVersion: 1,
      storeIdentity: binding.storeIdentity,
      activationIdentity: binding.activationIdentity,
      runtimeIdentity: binding.runtimeIdentity,
      namespaceCommitment: binding.namespaceCommitment,
      initialRoot: binding.initialRoot,
      revision: 0,
      headDigest: binding.initialRoot,
      cumulativeHttpRequests: 0,
      putReservations: 0,
      putDispatches: 0,
      revocationReservations: 0,
      revocationDispatches: 0,
      events: [],
    });
    const canonical = canonicalizeJson(state);
    const stateDigest = m9b13k2CanonicalDigest(state);
    if (!canonical.ok || !stateDigest.ok)
      return m9b13k2Failure(
        "ledger",
        "m9b13k2-ledger-initial-state-not-canonical",
      );
    const database = new DatabaseSync(databasePath);
    try {
      configureDatabase(database);
      database.exec(
        "CREATE TABLE ledger_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), protocol TEXT NOT NULL, store_identity TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 0), head_digest TEXT NOT NULL, state_json TEXT NOT NULL, state_digest TEXT NOT NULL) STRICT; PRAGMA user_version = 1;",
      );
      database
        .prepare(
          "INSERT INTO ledger_state (singleton, protocol, store_identity, revision, head_digest, state_json, state_digest) VALUES (1, ?, ?, 0, ?, ?, ?)",
        )
        .run(
          state.protocol,
          state.storeIdentity,
          state.headDigest,
          canonical.value,
          stateDigest.value,
        );
    } finally {
      database.close();
    }
    await chmod(databasePath, PRIVATE_FILE_MODE);
    const anchor = anchorForState(binding, state);
    if (!anchor.ok) return anchor;
    const anchorWritten = await writePrivateJson(
      anchorPath,
      anchor.value,
      true,
    );
    if (!anchorWritten.ok) return anchorWritten;
    const handleState: LedgerHandleState = {
      namespacePath: namespacePath.value,
      databasePath,
      anchorPath,
      binding,
    };
    const ledger = makeLedgerHandle(handleState);
    const audit = await auditM9b13k2FilesystemLedger(ledger);
    return audit.ok ? { ok: true, value: { ledger, binding } } : audit;
  } catch (error: unknown) {
    return m9b13k2Failure(
      "ledger",
      `m9b13k2-ledger-create-${error instanceof Error ? error.name : "unknown"}`,
    );
  }
}

export async function openM9b13k2FilesystemLedger(
  namespacePathValue: string,
  bindingValue: unknown,
): Promise<Result<M9b13k2FilesystemLedger, M9b13k2Failure>> {
  const namespacePath = exactAbsolutePath(namespacePathValue);
  const binding = trustedBindingSchema.safeParse(bindingValue);
  if (!namespacePath.ok) return namespacePath;
  if (!binding.success)
    return m9b13k2Failure("ledger", "m9b13k2-ledger-binding-invalid");
  const handle = makeLedgerHandle({
    namespacePath: namespacePath.value,
    databasePath: join(namespacePath.value, DATABASE_FILENAME),
    anchorPath: join(namespacePath.value, ANCHOR_FILENAME),
    binding: binding.data,
  });
  const audit = await auditM9b13k2FilesystemLedger(handle);
  return audit.ok ? { ok: true, value: handle } : audit;
}

export async function snapshotM9b13k2FilesystemLedger(
  ledger: M9b13k2FilesystemLedger,
): Promise<Result<M9b13k2LedgerState, M9b13k2Failure>> {
  const resolved = resolveHandle(ledger);
  if (!resolved.ok) return resolved;
  const audited = await auditHandlePaths(resolved.value);
  if (!audited.ok) return audited;
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(resolved.value.databasePath, {
      readOnly: true,
    });
    database.exec("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON;");
    const version = z
      .object({ user_version: z.literal(1) })
      .safeParse(database.prepare("PRAGMA user_version").get());
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all();
    if (
      !version.success ||
      tables.length !== 1 ||
      !z.object({ name: z.literal("ledger_state") }).safeParse(tables[0])
        .success
    )
      return m9b13k2Failure("ledger", "m9b13k2-ledger-database-schema-invalid");
    return await loadValidatedState(resolved.value, database, audited.value);
  } catch (error: unknown) {
    return m9b13k2Failure(
      "ledger",
      `m9b13k2-ledger-snapshot-${error instanceof Error ? error.name : "unknown"}`,
    );
  } finally {
    database?.close();
  }
}

export async function appendM9b13k2LedgerEvent(
  ledger: M9b13k2FilesystemLedger,
  expectedRevision: number,
  expectedHeadDigest: string,
  draft: M9b13k2LedgerEventDraft,
  fault: M9b13k2LedgerCommitFault = "none",
): Promise<Result<M9b13k2LedgerState, M9b13k2Failure>> {
  const resolved = resolveHandle(ledger);
  if (!resolved.ok) return resolved;
  const audited = await auditHandlePaths(resolved.value);
  if (!audited.ok) return audited;
  let database: DatabaseSync | undefined;
  let committed = false;
  try {
    database = new DatabaseSync(resolved.value.databasePath);
    configureDatabase(database);
    database.exec("BEGIN IMMEDIATE");
    const activePaths = await auditHandlePaths(resolved.value, true);
    if (!activePaths.ok) {
      database.exec("ROLLBACK");
      return activePaths;
    }
    const current = await loadValidatedState(
      resolved.value,
      database,
      audited.value,
    );
    if (!current.ok) {
      database.exec("ROLLBACK");
      return current;
    }
    if (
      current.value.revision !== expectedRevision ||
      current.value.headDigest !== expectedHeadDigest
    ) {
      database.exec("ROLLBACK");
      return m9b13k2Failure("ledger", "m9b13k2-ledger-cas-conflict");
    }
    const next = appendEventToState(current.value, draft);
    if (!next.ok) {
      database.exec("ROLLBACK");
      return next;
    }
    if (fault === "before-database-update") {
      database.exec("ROLLBACK");
      return m9b13k2Failure(
        "ledger",
        "m9b13k2-ledger-injected-before-database-update",
      );
    }
    const canonical = canonicalizeJson(next.value);
    const stateDigest = m9b13k2CanonicalDigest(next.value);
    if (!canonical.ok || !stateDigest.ok) {
      database.exec("ROLLBACK");
      return m9b13k2Failure(
        "ledger",
        "m9b13k2-ledger-next-state-not-canonical",
      );
    }
    const updated = database
      .prepare(
        "UPDATE ledger_state SET revision = ?, head_digest = ?, state_json = ?, state_digest = ? WHERE singleton = 1 AND revision = ? AND head_digest = ?",
      )
      .run(
        next.value.revision,
        next.value.headDigest,
        canonical.value,
        stateDigest.value,
        current.value.revision,
        current.value.headDigest,
      );
    if (updated.changes !== 1) {
      database.exec("ROLLBACK");
      return m9b13k2Failure("ledger", "m9b13k2-ledger-cas-conflict");
    }
    database.exec("COMMIT");
    committed = true;
    database.close();
    database = undefined;
    const closedPaths = await auditHandlePaths(resolved.value);
    if (!closedPaths.ok) return closedPaths;
    if (fault === "after-database-commit-before-anchor")
      return m9b13k2Failure(
        "ledger",
        "m9b13k2-ledger-database-committed-anchor-ambiguous",
        true,
      );
    if (fault === "pause-after-database-commit-before-anchor")
      await new Promise<never>(() => {
        // A conformance child is killed while paused at this crash boundary.
        setInterval(() => {
          // The referenced timer keeps the synthetic crash process alive.
        }, 1_000);
      });
    const anchor = anchorForState(resolved.value.binding, next.value);
    if (!anchor.ok) return anchor;
    const persisted = await writePrivateJson(
      resolved.value.anchorPath,
      anchor.value,
      false,
    );
    if (!persisted.ok) return persisted;
    const finalAudit = await auditHandlePaths(resolved.value);
    return finalAudit.ok ? next : finalAudit;
  } catch (error: unknown) {
    if (database !== undefined && !committed)
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the original fail-closed storage result.
      }
    return m9b13k2Failure(
      "ledger",
      `m9b13k2-ledger-commit-${error instanceof Error ? error.name : "unknown"}`,
      committed,
    );
  } finally {
    database?.close();
  }
}

export async function auditM9b13k2FilesystemLedger(
  ledger: M9b13k2FilesystemLedger,
): Promise<Result<M9b13k2LedgerAudit, M9b13k2Failure>> {
  const state = await snapshotM9b13k2FilesystemLedger(ledger);
  if (!state.ok) return state;
  const counters = deriveCounters(state.value.events);
  if (!counters.ok) return counters;
  return {
    ok: true,
    value: {
      protocol: M9B13K2_LEDGER_PROTOCOL,
      storeIdentity: state.value.storeIdentity,
      revision: state.value.revision,
      headDigest: state.value.headDigest,
      cumulativeHttpRequests: counters.value.cumulativeHttpRequests,
      putReservations: counters.value.putReservations,
      putDispatches: counters.value.putDispatches,
      revocationReservations: counters.value.revocationReservations,
      revocationDispatches: counters.value.revocationDispatches,
      terminal: counters.value.terminal,
      ambiguous: counters.value.ambiguous,
      namespaceMode: PRIVATE_DIRECTORY_MODE,
      databaseMode: PRIVATE_FILE_MODE,
      anchorMode: PRIVATE_FILE_MODE,
    },
  };
}

export function m9b13k2LedgerPathsForConformance(
  ledger: M9b13k2FilesystemLedger,
): Result<
  Readonly<{
    namespacePath: string;
    databasePath: string;
    anchorPath: string;
  }>,
  M9b13k2Failure
> {
  const resolved = resolveHandle(ledger);
  return resolved.ok
    ? {
        ok: true,
        value: {
          namespacePath: resolved.value.namespacePath,
          databasePath: resolved.value.databasePath,
          anchorPath: resolved.value.anchorPath,
        },
      }
    : resolved;
}
