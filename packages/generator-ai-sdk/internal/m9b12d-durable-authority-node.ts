import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  canonicalizeJson,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  assessM9b12bRetiredMaterialBoundary,
  M9B12B_INFLUENCE_BEARING_ROLES,
  type M9b12bInfluenceBearingRole,
  m9b12bInfluenceBearingRoleSchema,
} from "./m9b12b-preregistration.js";
import { M9B12D_PREREGISTRATION_DIGEST } from "./m9b12d-preregistration.js";

export const M9B12D_DURABLE_AUTHORITY_PROTOCOL =
  "lachesis-m9b12d-durable-quarantine-authority/1" as const;
export const M9B12D_TRUSTED_OBSERVER_IDENTITY_PROTOCOL =
  "lachesis-m9b12d-trusted-observer-identity/1" as const;
export const M9B12D_ATOMIC_ADMISSION_PROTOCOL =
  "lachesis-m9b12d-atomic-role-effect-admission/1" as const;
export const M9B12D_RETIRED_CORPUS_PROTOCOL =
  "lachesis-m9b12d-retired-corpus-quarantine@1.0.0" as const;
export const M9B12D_PREREGISTRATION_PROTOCOL =
  "lachesis-m9b12d-offline-preregistration-package@1.0.0" as const;
const M9B4_EFFECT_LEDGER_PROTOCOL =
  "lachesis-m9b4-offline-effect-ledger@1.2.0" as const;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const MAXIMUM_STORE_BYTES = 16 * 1024 * 1024;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z.string().min(1).max(256);
const quarantineReasonSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z0-9][a-z0-9:-]*$/u);

export type M9b12dFailure = Readonly<{
  kind: "storage" | "identity" | "history" | "authorization" | "admission";
  message: string;
}>;

function failure(
  kind: M9b12dFailure["kind"],
  message: string,
): Result<never, M9b12dFailure> {
  return { ok: false, error: { kind, message } };
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function modeOf(mode: number): number {
  return mode & 0o777;
}

async function digestBody(
  value: unknown,
): Promise<Result<string, M9b12dFailure>> {
  const digest = await digestValue(value);
  return digest.ok
    ? { ok: true, value: digest.value }
    : failure("history", "M9b.12d canonical digest failed.");
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftCanonical = canonicalizeJson(left);
  const rightCanonical = canonicalizeJson(right);
  return (
    leftCanonical.ok &&
    rightCanonical.ok &&
    leftCanonical.value === rightCanonical.value
  );
}

const commonEventBodyShape = {
  protocol: z.literal(M9B12D_DURABLE_AUTHORITY_PROTOCOL),
  sequence: z.number().int().positive(),
  predecessorHeadDigest: digestSchema.nullable(),
};

const identityIssuedEventBodySchema = z
  .strictObject({
    ...commonEventBodyShape,
    kind: z.literal("identity-issued"),
    identityProtocol: z.literal(M9B12D_TRUSTED_OBSERVER_IDENTITY_PROTOCOL),
    principalKey: digestSchema,
    launchAllocationKey: digestSchema,
    observerKey: digestSchema,
    launchHandle: digestSchema,
    requestedRole: m9b12bInfluenceBearingRoleSchema,
    sessionIdentity: digestSchema,
    validThroughEpochMs: z.number().int().nonnegative().nullable(),
    identityState: z.literal("active"),
  })
  .readonly();

const quarantineEventBodySchema = z
  .strictObject({
    ...commonEventBodyShape,
    kind: z.literal("quarantine"),
    quarantineProtocol: z.literal(M9B12D_RETIRED_CORPUS_PROTOCOL),
    observerKey: digestSchema,
    launchHandle: digestSchema,
    requestedRole: m9b12bInfluenceBearingRoleSchema,
    affectedRoleIdentities: m9b12bInfluenceBearingRoleSchema
      .array()
      .length(12)
      .readonly(),
    affectedSessionIdentities: digestSchema.array().length(1).readonly(),
    affectedDerivedInventoryIdentities: digestSchema
      .array()
      .length(1)
      .readonly(),
    incidentReceiptDigest: digestSchema,
    quarantineReasons: quarantineReasonSchema.array().min(1).readonly(),
    terminalDecision: z.literal("quarantine-reuse-forbidden"),
    observerReuseForbidden: z.literal(true),
    roleSessionStartupPermitted: z.literal(false),
    providerEffectsPermitted: z.literal(false),
    derivedInventoryReuseForbidden: z.literal(true),
  })
  .readonly();

const admissionStartedEventBodySchema = z
  .strictObject({
    ...commonEventBodyShape,
    kind: z.literal("admission-effect-started"),
    admissionProtocol: z.literal(M9B12D_ATOMIC_ADMISSION_PROTOCOL),
    admissionIdentity: digestSchema,
    observerKey: digestSchema,
    launchHandle: digestSchema,
    requestedRole: m9b12bInfluenceBearingRoleSchema,
    sessionIdentity: digestSchema,
    derivedInventoryIdentity: digestSchema,
    proofReceiptDigest: digestSchema,
    admissionState: z.literal("effect-started"),
    oneTimeAdmissionConsumed: z.literal(true),
    reusablePermissionExposed: z.literal(false),
    providerEffectsPermitted: z.literal(false),
    requiredProviderEffectLedgerProtocol: z.literal(
      M9B4_EFFECT_LEDGER_PROTOCOL,
    ),
  })
  .readonly();

const admissionTerminalEventBodySchema = z
  .strictObject({
    ...commonEventBodyShape,
    kind: z.literal("admission-terminal"),
    admissionProtocol: z.literal(M9B12D_ATOMIC_ADMISSION_PROTOCOL),
    admissionIdentity: digestSchema,
    startedEventDigest: digestSchema,
    admissionState: z.enum(["completed", "ambiguous"]),
    terminalReason: z
      .enum([
        "role-startup-completed",
        "effect-boundary-failed-after-durable-start",
      ])
      .nullable(),
    providerEffectsPermitted: z.literal(false),
  })
  .superRefine((event, context) => {
    if (
      (event.admissionState === "completed" &&
        event.terminalReason !== "role-startup-completed") ||
      (event.admissionState === "ambiguous" &&
        event.terminalReason !== "effect-boundary-failed-after-durable-start")
    )
      context.addIssue({
        code: "custom",
        message: "Admission terminal reason does not match its state.",
      });
  })
  .readonly();

const authorityEventBodySchema = z.discriminatedUnion("kind", [
  identityIssuedEventBodySchema,
  quarantineEventBodySchema,
  admissionStartedEventBodySchema,
  admissionTerminalEventBodySchema,
]);
type AuthorityEventBody = z.infer<typeof authorityEventBodySchema>;

const identityIssuedEventSchema = identityIssuedEventBodySchema
  .unwrap()
  .safeExtend({ eventDigest: digestSchema })
  .readonly();
const quarantineEventSchema = quarantineEventBodySchema
  .unwrap()
  .safeExtend({ eventDigest: digestSchema })
  .readonly();
const admissionStartedEventSchema = admissionStartedEventBodySchema
  .unwrap()
  .safeExtend({ eventDigest: digestSchema })
  .readonly();
const admissionTerminalEventSchema = admissionTerminalEventBodySchema
  .unwrap()
  .safeExtend({ eventDigest: digestSchema })
  .readonly();

export const m9b12dAuthorityEventSchema = z.discriminatedUnion("kind", [
  identityIssuedEventSchema,
  quarantineEventSchema,
  admissionStartedEventSchema,
  admissionTerminalEventSchema,
]);
export type M9b12dAuthorityEvent = z.infer<typeof m9b12dAuthorityEventSchema>;

export const m9b12dAuthorityStateSchema = z
  .strictObject({
    protocol: z.literal(M9B12D_DURABLE_AUTHORITY_PROTOCOL),
    preregistrationProtocol: z.literal(M9B12D_PREREGISTRATION_PROTOCOL),
    preregistrationDigest: digestSchema,
    storeIdentity: digestSchema,
    revision: z.number().int().nonnegative(),
    headDigest: digestSchema.nullable(),
    events: m9b12dAuthorityEventSchema.array().readonly(),
  })
  .readonly();
export type M9b12dAuthorityState = z.infer<typeof m9b12dAuthorityStateSchema>;

function eventBody(event: M9b12dAuthorityEvent): AuthorityEventBody {
  const { eventDigest: ignoredEventDigest, ...body } = event;
  void ignoredEventDigest;
  return authorityEventBodySchema.parse(body);
}

function identityEvents(
  state: M9b12dAuthorityState,
): ReadonlyArray<z.infer<typeof identityIssuedEventSchema>> {
  return state.events.filter(
    (event): event is z.infer<typeof identityIssuedEventSchema> =>
      event.kind === "identity-issued",
  );
}

function quarantineEvents(
  state: M9b12dAuthorityState,
): ReadonlyArray<z.infer<typeof quarantineEventSchema>> {
  return state.events.filter(
    (event): event is z.infer<typeof quarantineEventSchema> =>
      event.kind === "quarantine",
  );
}

function admissionStartedEvents(
  state: M9b12dAuthorityState,
): ReadonlyArray<z.infer<typeof admissionStartedEventSchema>> {
  return state.events.filter(
    (event): event is z.infer<typeof admissionStartedEventSchema> =>
      event.kind === "admission-effect-started",
  );
}

function admissionTerminalEvents(
  state: M9b12dAuthorityState,
): ReadonlyArray<z.infer<typeof admissionTerminalEventSchema>> {
  return state.events.filter(
    (event): event is z.infer<typeof admissionTerminalEventSchema> =>
      event.kind === "admission-terminal",
  );
}

export async function validateM9b12dAuthorityState(
  value: unknown,
): Promise<Result<M9b12dAuthorityState, M9b12dFailure>> {
  const parsed = m9b12dAuthorityStateSchema.safeParse(value);
  if (!parsed.success)
    return failure("history", "Durable authority state schema is invalid.");
  const state = parsed.data;
  if (state.revision !== state.events.length)
    return failure("history", "Durable authority history is truncated.");
  let predecessor: string | null = null;
  const eventDigests = new Set<string>();
  const principalObservers = new Map<string, string>();
  const allocationKeys = new Set<string>();
  const launchHandles = new Set<string>();
  const launchesByHandle = new Map<
    string,
    z.infer<typeof identityIssuedEventSchema>
  >();
  const quarantinedObservers = new Set<string>();
  const startedAdmissions = new Map<
    string,
    z.infer<typeof admissionStartedEventSchema>
  >();
  const terminalAdmissions = new Set<string>();
  const admittedLaunchHandles = new Set<string>();

  for (const [index, event] of state.events.entries()) {
    if (event.sequence !== index + 1)
      return failure("history", "Durable authority sequence is invalid.");
    if (event.predecessorHeadDigest !== predecessor)
      return failure("history", "Durable authority predecessor is invalid.");
    const computed = await digestBody(eventBody(event));
    if (!computed.ok) return computed;
    if (computed.value !== event.eventDigest)
      return failure("history", "Durable authority event digest is invalid.");
    if (eventDigests.has(event.eventDigest))
      return failure("history", "Durable authority event is duplicated.");
    eventDigests.add(event.eventDigest);
    predecessor = event.eventDigest;

    if (event.kind === "identity-issued") {
      const knownObserver = principalObservers.get(event.principalKey);
      const derivedObserver = await digestBody({
        protocol: M9B12D_TRUSTED_OBSERVER_IDENTITY_PROTOCOL,
        storeIdentity: state.storeIdentity,
        principalKey: event.principalKey,
      });
      if (!derivedObserver.ok) return derivedObserver;
      if (
        derivedObserver.value !== event.observerKey ||
        (knownObserver !== undefined && knownObserver !== event.observerKey) ||
        allocationKeys.has(event.launchAllocationKey) ||
        launchHandles.has(event.launchHandle)
      )
        return failure(
          "identity",
          "Trusted observer identity chain conflicts.",
        );
      principalObservers.set(event.principalKey, event.observerKey);
      allocationKeys.add(event.launchAllocationKey);
      launchHandles.add(event.launchHandle);
      launchesByHandle.set(event.launchHandle, event);
    } else if (event.kind === "quarantine") {
      const launch = launchesByHandle.get(event.launchHandle);
      if (
        launch?.observerKey !== event.observerKey ||
        launch.requestedRole !== event.requestedRole ||
        !canonicalEqual(event.affectedSessionIdentities, [
          launch.sessionIdentity,
        ]) ||
        !canonicalEqual(
          event.affectedRoleIdentities,
          M9B12B_INFLUENCE_BEARING_ROLES,
        ) ||
        !canonicalEqual(
          event.quarantineReasons,
          [...new Set(event.quarantineReasons)].toSorted(),
        )
      )
        return failure("history", "Durable quarantine event is noncanonical.");
      quarantinedObservers.add(event.observerKey);
    } else if (event.kind === "admission-effect-started") {
      const launch = launchesByHandle.get(event.launchHandle);
      if (
        launch?.observerKey !== event.observerKey ||
        launch.requestedRole !== event.requestedRole ||
        launch.sessionIdentity !== event.sessionIdentity ||
        quarantinedObservers.has(event.observerKey) ||
        startedAdmissions.has(event.admissionIdentity) ||
        admittedLaunchHandles.has(event.launchHandle)
      )
        return failure("admission", "Durable admission ordering is invalid.");
      startedAdmissions.set(event.admissionIdentity, event);
      admittedLaunchHandles.add(event.launchHandle);
    } else {
      const started = startedAdmissions.get(event.admissionIdentity);
      if (
        started?.eventDigest !== event.startedEventDigest ||
        terminalAdmissions.has(event.admissionIdentity)
      )
        return failure(
          "admission",
          "Admission terminal transition is invalid.",
        );
      terminalAdmissions.add(event.admissionIdentity);
    }
  }
  if (state.headDigest !== predecessor)
    return failure("history", "Durable authority head is invalid.");
  return { ok: true, value: state };
}

const trustedBindingSchema = z
  .strictObject({
    protocol: z.literal(M9B12D_DURABLE_AUTHORITY_PROTOCOL),
    preregistrationProtocol: z.literal(M9B12D_PREREGISTRATION_PROTOCOL),
    preregistrationDigest: digestSchema,
    storeIdentity: digestSchema,
    anchorIdentity: digestSchema,
  })
  .readonly();
export type M9b12dTrustedAuthorityBinding = z.infer<
  typeof trustedBindingSchema
>;

const anchorBodySchema = trustedBindingSchema
  .unwrap()
  .safeExtend({
    revision: z.number().int().nonnegative(),
    headDigest: digestSchema.nullable(),
    stateDigest: digestSchema,
  })
  .readonly();
const anchorSchema = anchorBodySchema
  .unwrap()
  .safeExtend({ anchorDigest: digestSchema })
  .readonly();
type AuthorityAnchor = z.infer<typeof anchorSchema>;

const authorityAuditSchema = z
  .strictObject({
    protocol: z.literal(M9B12D_DURABLE_AUTHORITY_PROTOCOL),
    storeIdentity: digestSchema,
    preregistrationDigest: digestSchema,
    revision: z.number().int().nonnegative(),
    headDigest: digestSchema.nullable(),
    identityMappings: z.number().int().nonnegative(),
    quarantineEvents: z.number().int().nonnegative(),
    admissionStarts: z.number().int().nonnegative(),
    completedAdmissions: z.number().int().nonnegative(),
    ambiguousAdmissions: z.number().int().nonnegative(),
    databaseMode: z.literal(PRIVATE_FILE_MODE),
    anchorMode: z.literal(PRIVATE_FILE_MODE),
    parentDirectoryMode: z.literal(PRIVATE_DIRECTORY_MODE),
  })
  .readonly();
export type M9b12dAuthorityAudit = z.infer<typeof authorityAuditSchema>;

const rowSchema = z.object({
  protocol: z.string(),
  preregistration_digest: z.string(),
  store_identity: z.string(),
  revision: z.number().int().nonnegative(),
  head_digest: z.string().nullable(),
  state_json: z.string(),
  state_digest: z.string(),
});

type LoadedState = Readonly<{
  state: M9b12dAuthorityState;
  stateDigest: string;
  anchor: AuthorityAnchor;
}>;

const repositoryBrand: unique symbol = Symbol("M9b12dDurableAuthority");
export type M9b12dDurableAuthority = Readonly<{
  [repositoryBrand]: "M9b12dDurableAuthority";
  databasePath: string;
  anchorPath: string;
  trustedBinding: M9b12dTrustedAuthorityBinding;
}>;

function repository(
  databasePath: string,
  anchorPath: string,
  trustedBinding: M9b12dTrustedAuthorityBinding,
): M9b12dDurableAuthority {
  const brand = "M9b12dDurableAuthority" as const;
  const value: M9b12dDurableAuthority = Object.freeze({
    [repositoryBrand]: brand,
    databasePath,
    anchorPath,
    trustedBinding,
  });
  return value;
}

function currentUserId(): Result<number, M9b12dFailure> {
  const userId = process.getuid?.();
  return userId === undefined
    ? failure(
        "storage",
        "Durable authority requires an operating-system user ID.",
      )
    : { ok: true, value: userId };
}

function normalizedAbsolutePath(
  path: string,
  label: string,
): Result<string, M9b12dFailure> {
  return isAbsolute(path) && resolve(path) === path
    ? { ok: true, value: path }
    : failure("storage", `${label} must be an absolute normalized path.`);
}

async function validatePrivateDirectory(
  path: string,
  userId: number,
): Promise<Result<void, M9b12dFailure>> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      return failure(
        "storage",
        "Authority parent must be a non-symlink directory.",
      );
    if (metadata.uid !== userId)
      return failure("storage", "Authority parent has the wrong owner.");
    if (modeOf(metadata.mode) !== PRIVATE_DIRECTORY_MODE)
      return failure("storage", "Authority parent mode must be exactly 0700.");
    const canonical = await realpath(path);
    const expected = join(await realpath(dirname(path)), basename(path));
    return canonical === expected
      ? { ok: true, value: undefined }
      : failure(
          "storage",
          "Authority parent resolves through a symbolic link.",
        );
  } catch (error: unknown) {
    return failure(
      "storage",
      `Authority parent audit failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
    );
  }
}

async function validatePrivateFile(
  path: string,
  userId: number,
  label: string,
): Promise<Result<void, M9b12dFailure>> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile())
      return failure("storage", `${label} must be a non-symlink regular file.`);
    if (metadata.uid !== userId)
      return failure("storage", `${label} has the wrong owner.`);
    if (modeOf(metadata.mode) !== PRIVATE_FILE_MODE)
      return failure("storage", `${label} mode must be exactly 0600.`);
    if (metadata.size > MAXIMUM_STORE_BYTES)
      return failure("storage", `${label} exceeds its byte limit.`);
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    return failure(
      "storage",
      `${label} audit failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
    );
  }
}

async function ensureNewPrivateParent(
  path: string,
  userId: number,
): Promise<Result<void, M9b12dFailure>> {
  try {
    await mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    return await validatePrivateDirectory(path, userId);
  } catch (error: unknown) {
    return failure(
      "storage",
      `Authority parent creation failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
    );
  }
}

async function syncDirectory(
  path: string,
): Promise<Result<void, M9b12dFailure>> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    return failure(
      "storage",
      `Authority directory sync failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
    );
  }
}

async function readPrivateJson(
  path: string,
  userId: number,
  label: string,
): Promise<Result<unknown, M9b12dFailure>> {
  const audited = await validatePrivateFile(path, userId, label);
  if (!audited.ok) return audited;
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      const named = await lstat(path);
      if (
        opened.dev !== named.dev ||
        opened.ino !== named.ino ||
        opened.uid !== userId ||
        modeOf(opened.mode) !== PRIVATE_FILE_MODE
      )
        return failure(
          "storage",
          `${label} changed during its permission audit.`,
        );
      const parsed = parseJson(await handle.readFile({ encoding: "utf8" }));
      return parsed.ok
        ? { ok: true, value: parsed.value }
        : failure("storage", `${label} is not strict JSON.`);
    } finally {
      await handle.close();
    }
  } catch (error: unknown) {
    return failure(
      "storage",
      `${label} read failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
    );
  }
}

async function writePrivateJson(
  path: string,
  value: unknown,
  userId: number,
  createOnly: boolean,
): Promise<Result<void, M9b12dFailure>> {
  const canonical = canonicalizeJson(value);
  if (!canonical.ok)
    return failure("storage", "Trusted anchor is not canonical JSON.");
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    const handle = await open(
      createOnly ? path : temporary,
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
    const target = createOnly ? path : temporary;
    const audited = await validatePrivateFile(
      target,
      userId,
      "Trusted authority anchor",
    );
    if (!audited.ok) return audited;
    if (!createOnly) await rename(temporary, path);
    const finalAudit = await validatePrivateFile(
      path,
      userId,
      "Trusted authority anchor",
    );
    if (!finalAudit.ok) return finalAudit;
    return await syncDirectory(dirname(path));
  } catch (error: unknown) {
    return failure(
      "storage",
      `Trusted anchor write failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
    );
  } finally {
    if (!createOnly) {
      try {
        await unlink(temporary);
      } catch (error: unknown) {
        if (errorCode(error) !== "ENOENT") void error;
      }
    }
  }
}

function configureDatabase(database: DatabaseSync): void {
  database.exec(
    "PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 1000;",
  );
}

function readDatabaseRow(
  database: DatabaseSync,
): Result<z.infer<typeof rowSchema>, M9b12dFailure> {
  const row = database
    .prepare(
      "SELECT protocol, preregistration_digest, store_identity, revision, head_digest, state_json, state_digest FROM authority_state WHERE singleton = 1",
    )
    .get();
  const parsed = rowSchema.safeParse(row);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : failure(
        "storage",
        "Durable authority database row is missing or malformed.",
      );
}

async function parseDatabaseState(
  row: z.infer<typeof rowSchema>,
): Promise<
  Result<
    Readonly<{ state: M9b12dAuthorityState; stateDigest: string }>,
    M9b12dFailure
  >
> {
  const parsedJson = parseJson(row.state_json);
  if (!parsedJson.ok)
    return failure("storage", "Durable authority state is not strict JSON.");
  const state = await validateM9b12dAuthorityState(parsedJson.value);
  if (!state.ok) return state;
  const stateDigest = await digestBody(state.value);
  if (!stateDigest.ok) return stateDigest;
  if (
    row.protocol !== state.value.protocol ||
    row.preregistration_digest !== state.value.preregistrationDigest ||
    row.store_identity !== state.value.storeIdentity ||
    row.revision !== state.value.revision ||
    row.head_digest !== state.value.headDigest ||
    row.state_digest !== stateDigest.value
  )
    return failure(
      "storage",
      "Durable authority database binding is inconsistent.",
    );
  return {
    ok: true,
    value: { state: state.value, stateDigest: stateDigest.value },
  };
}

async function readAnchor(
  path: string,
  userId: number,
): Promise<Result<AuthorityAnchor, M9b12dFailure>> {
  const json = await readPrivateJson(path, userId, "Trusted authority anchor");
  if (!json.ok) return json;
  const parsed = anchorSchema.safeParse(json.value);
  if (!parsed.success)
    return failure("storage", "Trusted authority anchor schema is invalid.");
  const { anchorDigest: ignoredAnchorDigest, ...body } = parsed.data;
  void ignoredAnchorDigest;
  const digest = await digestBody(anchorBodySchema.parse(body));
  return digest.ok && digest.value === parsed.data.anchorDigest
    ? { ok: true, value: parsed.data }
    : failure("storage", "Trusted authority anchor digest is invalid.");
}

async function createAnchor(
  binding: M9b12dTrustedAuthorityBinding,
  state: M9b12dAuthorityState,
): Promise<Result<AuthorityAnchor, M9b12dFailure>> {
  const stateDigest = await digestBody(state);
  if (!stateDigest.ok) return stateDigest;
  const body = anchorBodySchema.parse({
    ...binding,
    revision: state.revision,
    headDigest: state.headDigest,
    stateDigest: stateDigest.value,
  });
  const anchorDigest = await digestBody(body);
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
  anchor: AuthorityAnchor,
  binding: M9b12dTrustedAuthorityBinding,
  state: M9b12dAuthorityState,
  stateDigest: string,
): boolean {
  const anchoredBinding = trustedBindingSchema.parse({
    protocol: anchor.protocol,
    preregistrationProtocol: anchor.preregistrationProtocol,
    preregistrationDigest: anchor.preregistrationDigest,
    storeIdentity: anchor.storeIdentity,
    anchorIdentity: anchor.anchorIdentity,
  });
  return (
    canonicalEqual(anchoredBinding, binding) &&
    anchor.revision === state.revision &&
    anchor.headDigest === state.headDigest &&
    anchor.stateDigest === stateDigest
  );
}

async function auditPaths(
  authority: M9b12dDurableAuthority,
): Promise<Result<number, M9b12dFailure>> {
  const userId = currentUserId();
  if (!userId.ok) return userId;
  const databaseParent = await validatePrivateDirectory(
    dirname(authority.databasePath),
    userId.value,
  );
  if (!databaseParent.ok) return databaseParent;
  const anchorParent = await validatePrivateDirectory(
    dirname(authority.anchorPath),
    userId.value,
  );
  if (!anchorParent.ok) return anchorParent;
  const database = await validatePrivateFile(
    authority.databasePath,
    userId.value,
    "Durable authority database",
  );
  if (!database.ok) return database;
  const anchor = await validatePrivateFile(
    authority.anchorPath,
    userId.value,
    "Trusted authority anchor",
  );
  return anchor.ok ? userId : anchor;
}

async function loadState(
  authority: M9b12dDurableAuthority,
  database: DatabaseSync,
  userId: number,
): Promise<Result<LoadedState, M9b12dFailure>> {
  const row = readDatabaseRow(database);
  if (!row.ok) return row;
  const state = await parseDatabaseState(row.value);
  if (!state.ok) return state;
  const anchor = await readAnchor(authority.anchorPath, userId);
  if (!anchor.ok) return anchor;
  if (
    !anchorMatches(
      anchor.value,
      authority.trustedBinding,
      state.value.state,
      state.value.stateDigest,
    )
  )
    return failure(
      "storage",
      "Durable authority state does not match the trusted persisted anchor.",
    );
  return {
    ok: true,
    value: {
      state: state.value.state,
      stateDigest: state.value.stateDigest,
      anchor: anchor.value,
    },
  };
}

type TransactionFault =
  "none" | "before-database-update" | "after-database-commit-before-anchor";

async function commitState(
  authority: M9b12dDurableAuthority,
  mutate: (
    state: M9b12dAuthorityState,
  ) => Promise<Result<M9b12dAuthorityState, M9b12dFailure>>,
  fault: TransactionFault = "none",
): Promise<Result<M9b12dAuthorityState, M9b12dFailure>> {
  const audited = await auditPaths(authority);
  if (!audited.ok) return audited;
  let database: DatabaseSync | undefined;
  let committed = false;
  try {
    database = new DatabaseSync(authority.databasePath);
    configureDatabase(database);
    database.exec("BEGIN IMMEDIATE");
    const loaded = await loadState(authority, database, audited.value);
    if (!loaded.ok) {
      database.exec("ROLLBACK");
      return loaded;
    }
    const next = await mutate(loaded.value.state);
    if (!next.ok) {
      database.exec("ROLLBACK");
      return next;
    }
    const validated = await validateM9b12dAuthorityState(next.value);
    if (!validated.ok) {
      database.exec("ROLLBACK");
      return validated;
    }
    if (fault === "before-database-update") {
      database.exec("ROLLBACK");
      return failure(
        "storage",
        "Injected persistence failure before authority commit.",
      );
    }
    const canonical = canonicalizeJson(validated.value);
    const stateDigest = await digestBody(validated.value);
    if (!canonical.ok || !stateDigest.ok) {
      database.exec("ROLLBACK");
      return stateDigest.ok
        ? failure("storage", "Durable authority state is not canonical JSON.")
        : stateDigest;
    }
    const updated = database
      .prepare(
        "UPDATE authority_state SET revision = ?, head_digest = ?, state_json = ?, state_digest = ? WHERE singleton = 1 AND revision = ? AND state_digest = ?",
      )
      .run(
        validated.value.revision,
        validated.value.headDigest,
        canonical.value,
        stateDigest.value,
        loaded.value.state.revision,
        loaded.value.stateDigest,
      );
    if (updated.changes !== 1) {
      database.exec("ROLLBACK");
      return failure("storage", "Durable authority compare-and-swap failed.");
    }
    database.exec("COMMIT");
    committed = true;
    database.close();
    database = undefined;
    if (fault === "after-database-commit-before-anchor")
      return failure(
        "storage",
        "Injected crash after database commit and before trusted-anchor commit.",
      );
    const nextAnchor = await createAnchor(
      authority.trustedBinding,
      validated.value,
    );
    if (!nextAnchor.ok) return nextAnchor;
    const persistedAnchor = await writePrivateJson(
      authority.anchorPath,
      nextAnchor.value,
      audited.value,
      false,
    );
    return persistedAnchor.ok
      ? { ok: true, value: validated.value }
      : persistedAnchor;
  } catch (error: unknown) {
    if (database !== undefined && !committed) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // The original storage failure remains the fail-closed result.
      }
    }
    return failure(
      "storage",
      `Durable authority transaction failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
    );
  } finally {
    database?.close();
  }
}

async function appendEvent(
  state: M9b12dAuthorityState,
  event:
    | Omit<
        z.input<typeof identityIssuedEventBodySchema>,
        "sequence" | "predecessorHeadDigest"
      >
    | Omit<
        z.input<typeof quarantineEventBodySchema>,
        "sequence" | "predecessorHeadDigest"
      >
    | Omit<
        z.input<typeof admissionStartedEventBodySchema>,
        "sequence" | "predecessorHeadDigest"
      >
    | Omit<
        z.input<typeof admissionTerminalEventBodySchema>,
        "sequence" | "predecessorHeadDigest"
      >,
): Promise<
  Result<
    Readonly<{ state: M9b12dAuthorityState; event: M9b12dAuthorityEvent }>,
    M9b12dFailure
  >
> {
  const body = authorityEventBodySchema.parse({
    ...event,
    sequence: state.revision + 1,
    predecessorHeadDigest: state.headDigest,
  });
  const eventDigest = await digestBody(body);
  if (!eventDigest.ok) return eventDigest;
  const appended = m9b12dAuthorityEventSchema.parse({
    ...body,
    eventDigest: eventDigest.value,
  });
  const next = m9b12dAuthorityStateSchema.parse({
    ...state,
    revision: appended.sequence,
    headDigest: appended.eventDigest,
    events: [...state.events, appended],
  });
  return { ok: true, value: { state: next, event: appended } };
}

export type M9b12dAuthorityPaths = Readonly<{
  databasePath: string;
  anchorPath: string;
}>;

export async function createNewM9b12dAuthority(
  paths: M9b12dAuthorityPaths,
): Promise<
  Result<
    Readonly<{
      authority: M9b12dDurableAuthority;
      trustedBinding: M9b12dTrustedAuthorityBinding;
    }>,
    M9b12dFailure
  >
> {
  const databasePath = normalizedAbsolutePath(
    paths.databasePath,
    "Durable authority database path",
  );
  if (!databasePath.ok) return databasePath;
  const anchorPath = normalizedAbsolutePath(
    paths.anchorPath,
    "Trusted anchor path",
  );
  if (!anchorPath.ok) return anchorPath;
  if (databasePath.value === anchorPath.value)
    return failure(
      "storage",
      "Authority database and anchor paths must differ.",
    );
  const userId = currentUserId();
  if (!userId.ok) return userId;
  try {
    for (const path of [databasePath.value, anchorPath.value]) {
      try {
        await lstat(path);
        return failure(
          "storage",
          "New authority paths must not already exist.",
        );
      } catch (error: unknown) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
    for (const parent of [
      dirname(databasePath.value),
      dirname(anchorPath.value),
    ]) {
      const prepared = await ensureNewPrivateParent(parent, userId.value);
      if (!prepared.ok) return prepared;
    }
    const databaseHandle = await open(
      databasePath.value,
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
    const storeIdentity = await digestBody({
      protocol: M9B12D_DURABLE_AUTHORITY_PROTOCOL,
      nonce: randomUUID(),
    });
    const anchorIdentity = await digestBody({
      protocol: `${M9B12D_DURABLE_AUTHORITY_PROTOCOL}:trusted-anchor`,
      nonce: randomUUID(),
    });
    if (!storeIdentity.ok) return storeIdentity;
    if (!anchorIdentity.ok) return anchorIdentity;
    const trustedBinding = trustedBindingSchema.parse({
      protocol: M9B12D_DURABLE_AUTHORITY_PROTOCOL,
      preregistrationProtocol: M9B12D_PREREGISTRATION_PROTOCOL,
      preregistrationDigest: M9B12D_PREREGISTRATION_DIGEST,
      storeIdentity: storeIdentity.value,
      anchorIdentity: anchorIdentity.value,
    });
    const state = m9b12dAuthorityStateSchema.parse({
      protocol: M9B12D_DURABLE_AUTHORITY_PROTOCOL,
      preregistrationProtocol: M9B12D_PREREGISTRATION_PROTOCOL,
      preregistrationDigest: M9B12D_PREREGISTRATION_DIGEST,
      storeIdentity: storeIdentity.value,
      revision: 0,
      headDigest: null,
      events: [],
    });
    const canonical = canonicalizeJson(state);
    const stateDigest = await digestBody(state);
    if (!canonical.ok || !stateDigest.ok)
      return stateDigest.ok
        ? failure(
            "storage",
            "Initial durable authority state is not canonical.",
          )
        : stateDigest;
    const database = new DatabaseSync(databasePath.value);
    try {
      configureDatabase(database);
      database.exec(
        "CREATE TABLE authority_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), protocol TEXT NOT NULL, preregistration_digest TEXT NOT NULL, store_identity TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 0), head_digest TEXT, state_json TEXT NOT NULL, state_digest TEXT NOT NULL) STRICT; PRAGMA user_version = 1;",
      );
      database
        .prepare(
          "INSERT INTO authority_state (singleton, protocol, preregistration_digest, store_identity, revision, head_digest, state_json, state_digest) VALUES (1, ?, ?, ?, 0, NULL, ?, ?)",
        )
        .run(
          state.protocol,
          state.preregistrationDigest,
          state.storeIdentity,
          canonical.value,
          stateDigest.value,
        );
    } finally {
      database.close();
    }
    const anchor = await createAnchor(trustedBinding, state);
    if (!anchor.ok) return anchor;
    const persistedAnchor = await writePrivateJson(
      anchorPath.value,
      anchor.value,
      userId.value,
      true,
    );
    if (!persistedAnchor.ok) return persistedAnchor;
    const authority = repository(
      databasePath.value,
      anchorPath.value,
      trustedBinding,
    );
    const audited = await auditM9b12dAuthority(authority);
    return audited.ok
      ? { ok: true, value: { authority, trustedBinding } }
      : audited;
  } catch (error: unknown) {
    return failure(
      "storage",
      `New durable authority creation failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
    );
  }
}

export async function openExistingM9b12dAuthority(
  paths: M9b12dAuthorityPaths,
  value: unknown,
): Promise<Result<M9b12dDurableAuthority, M9b12dFailure>> {
  const binding = trustedBindingSchema.safeParse(value);
  if (!binding.success)
    return failure("storage", "Trusted authority binding is invalid.");
  const databasePath = normalizedAbsolutePath(
    paths.databasePath,
    "Durable authority database path",
  );
  if (!databasePath.ok) return databasePath;
  const anchorPath = normalizedAbsolutePath(
    paths.anchorPath,
    "Trusted anchor path",
  );
  if (!anchorPath.ok) return anchorPath;
  const authority = repository(
    databasePath.value,
    anchorPath.value,
    binding.data,
  );
  const audited = await auditM9b12dAuthority(authority);
  return audited.ok ? { ok: true, value: authority } : audited;
}

async function readValidatedState(
  authority: M9b12dDurableAuthority,
): Promise<Result<LoadedState, M9b12dFailure>> {
  const audited = await auditPaths(authority);
  if (!audited.ok) return audited;
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(authority.databasePath, { readOnly: true });
    database.exec("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON;");
    const version = database.prepare("PRAGMA user_version").get();
    const versionParsed = z
      .object({ user_version: z.literal(1) })
      .safeParse(version);
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all();
    if (
      !versionParsed.success ||
      !canonicalEqual(tables, [{ name: "authority_state" }])
    )
      return failure(
        "storage",
        "Durable authority database schema is invalid.",
      );
    return await loadState(authority, database, audited.value);
  } catch (error: unknown) {
    return failure(
      "storage",
      `Existing durable authority open failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
    );
  } finally {
    database?.close();
  }
}

export async function snapshotM9b12dAuthorityState(
  authority: M9b12dDurableAuthority,
): Promise<Result<M9b12dAuthorityState, M9b12dFailure>> {
  const loaded = await readValidatedState(authority);
  return loaded.ok ? { ok: true, value: loaded.value.state } : loaded;
}

export async function auditM9b12dAuthority(
  authority: M9b12dDurableAuthority,
): Promise<Result<M9b12dAuthorityAudit, M9b12dFailure>> {
  const loaded = await readValidatedState(authority);
  if (!loaded.ok) return loaded;
  const terminals = admissionTerminalEvents(loaded.value.state);
  const terminalIds = new Set(
    terminals.map((event) => event.admissionIdentity),
  );
  const unresolved = admissionStartedEvents(loaded.value.state).filter(
    (event) => !terminalIds.has(event.admissionIdentity),
  );
  return {
    ok: true,
    value: authorityAuditSchema.parse({
      protocol: M9B12D_DURABLE_AUTHORITY_PROTOCOL,
      storeIdentity: loaded.value.state.storeIdentity,
      preregistrationDigest: loaded.value.state.preregistrationDigest,
      revision: loaded.value.state.revision,
      headDigest: loaded.value.state.headDigest,
      identityMappings: identityEvents(loaded.value.state).length,
      quarantineEvents: quarantineEvents(loaded.value.state).length,
      admissionStarts: admissionStartedEvents(loaded.value.state).length,
      completedAdmissions: terminals.filter(
        (event) => event.admissionState === "completed",
      ).length,
      ambiguousAdmissions:
        terminals.filter((event) => event.admissionState === "ambiguous")
          .length + unresolved.length,
      databaseMode: PRIVATE_FILE_MODE,
      anchorMode: PRIVATE_FILE_MODE,
      parentDirectoryMode: PRIVATE_DIRECTORY_MODE,
    }),
  };
}

function normalizeTrustedIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ");
}

const identityIssuanceSchema = z
  .strictObject({
    studyPrincipalIdentity: identifierSchema,
    launchAllocationIdentity: identifierSchema,
    requestedRole: m9b12bInfluenceBearingRoleSchema,
    sessionIdentity: digestSchema,
    validThroughEpochMs: z.number().int().nonnegative().nullable(),
  })
  .readonly();
export type M9b12dIdentityIssuance = z.infer<typeof identityIssuanceSchema>;

const identityReceiptBodySchema = z
  .strictObject({
    protocol: z.literal(M9B12D_TRUSTED_OBSERVER_IDENTITY_PROTOCOL),
    storeIdentity: digestSchema,
    principalKey: digestSchema,
    launchAllocationKey: digestSchema,
    canonicalObserverKey: digestSchema,
    launchHandle: digestSchema,
    requestedRole: m9b12bInfluenceBearingRoleSchema,
    sessionIdentity: digestSchema,
    validThroughEpochMs: z.number().int().nonnegative().nullable(),
    callerMaySelectObserverKey: z.literal(false),
    historyRevision: z.number().int().positive(),
    historyHeadDigest: digestSchema,
  })
  .readonly();
const identityReceiptSchema = identityReceiptBodySchema
  .unwrap()
  .safeExtend({ receiptDigest: digestSchema })
  .readonly();
export type M9b12dIdentityReceipt = z.infer<typeof identityReceiptSchema>;

export async function issueM9b12dObserverLaunchHandle(
  authority: M9b12dDurableAuthority,
  value: unknown,
): Promise<Result<M9b12dIdentityReceipt, M9b12dFailure>> {
  const input = identityIssuanceSchema.safeParse(value);
  if (!input.success)
    return failure(
      "identity",
      "Trusted observer identity issuance is invalid.",
    );
  const normalizedPrincipal = normalizeTrustedIdentity(
    input.data.studyPrincipalIdentity,
  );
  const normalizedAllocation = normalizeTrustedIdentity(
    input.data.launchAllocationIdentity,
  );
  if (normalizedPrincipal.length === 0 || normalizedAllocation.length === 0)
    return failure(
      "identity",
      "Trusted observer identity normalizes to empty.",
    );
  const principalKey = await digestBody({
    protocol: M9B12D_TRUSTED_OBSERVER_IDENTITY_PROTOCOL,
    domain: "controller-issued-study-principal",
    normalizedPrincipal,
  });
  const allocationKey = await digestBody({
    protocol: M9B12D_TRUSTED_OBSERVER_IDENTITY_PROTOCOL,
    domain: "controller-issued-launch-allocation",
    normalizedAllocation,
  });
  if (!principalKey.ok) return principalKey;
  if (!allocationKey.ok) return allocationKey;
  let issuedEvent: z.infer<typeof identityIssuedEventSchema> | undefined;
  const committed = await commitState(authority, async (state) => {
    if (
      identityEvents(state).some(
        (event) => event.launchAllocationKey === allocationKey.value,
      )
    )
      return failure(
        "identity",
        "Launch allocation identity was already issued.",
      );
    const observerKey = await digestBody({
      protocol: M9B12D_TRUSTED_OBSERVER_IDENTITY_PROTOCOL,
      storeIdentity: state.storeIdentity,
      principalKey: principalKey.value,
    });
    if (!observerKey.ok) return observerKey;
    const launchHandle = await digestBody({
      protocol: M9B12D_TRUSTED_OBSERVER_IDENTITY_PROTOCOL,
      storeIdentity: state.storeIdentity,
      observerKey: observerKey.value,
      launchAllocationKey: allocationKey.value,
      requestedRole: input.data.requestedRole,
      sessionIdentity: input.data.sessionIdentity,
      nonce: randomUUID(),
    });
    if (!launchHandle.ok) return launchHandle;
    const appended = await appendEvent(state, {
      protocol: M9B12D_DURABLE_AUTHORITY_PROTOCOL,
      kind: "identity-issued",
      identityProtocol: M9B12D_TRUSTED_OBSERVER_IDENTITY_PROTOCOL,
      principalKey: principalKey.value,
      launchAllocationKey: allocationKey.value,
      observerKey: observerKey.value,
      launchHandle: launchHandle.value,
      requestedRole: input.data.requestedRole,
      sessionIdentity: input.data.sessionIdentity,
      validThroughEpochMs: input.data.validThroughEpochMs,
      identityState: "active",
    });
    if (!appended.ok) return appended;
    if (appended.value.event.kind !== "identity-issued")
      return failure("identity", "Identity event kind changed during append.");
    issuedEvent = appended.value.event;
    return { ok: true, value: appended.value.state };
  });
  if (!committed.ok) return committed;
  if (issuedEvent === undefined)
    return failure("identity", "Trusted identity event was not committed.");
  const body = identityReceiptBodySchema.parse({
    protocol: M9B12D_TRUSTED_OBSERVER_IDENTITY_PROTOCOL,
    storeIdentity: committed.value.storeIdentity,
    principalKey: issuedEvent.principalKey,
    launchAllocationKey: issuedEvent.launchAllocationKey,
    canonicalObserverKey: issuedEvent.observerKey,
    launchHandle: issuedEvent.launchHandle,
    requestedRole: issuedEvent.requestedRole,
    sessionIdentity: issuedEvent.sessionIdentity,
    validThroughEpochMs: issuedEvent.validThroughEpochMs,
    callerMaySelectObserverKey: false,
    historyRevision: committed.value.revision,
    historyHeadDigest: committed.value.headDigest,
  });
  const receiptDigest = await digestBody(body);
  return receiptDigest.ok
    ? {
        ok: true,
        value: identityReceiptSchema.parse({
          ...body,
          receiptDigest: receiptDigest.value,
        }),
      }
    : receiptDigest;
}

const currentAssessmentPayloadSchema = z
  .record(z.string(), z.json())
  .superRefine((value, context) => {
    for (const forbidden of [
      "observerIdentity",
      "observerCommitment",
      "canonicalObserverKey",
      "role",
    ])
      if (Object.hasOwn(value, forbidden))
        context.addIssue({
          code: "custom",
          message: `Caller assessment field ${forbidden} is forbidden.`,
        });
  });

const admissionRequestSchema = z
  .strictObject({
    launchHandle: digestSchema,
    requestedRole: m9b12bInfluenceBearingRoleSchema,
    sessionIdentity: digestSchema,
    derivedInventoryIdentity: digestSchema,
    admissionIdentity: digestSchema,
    currentAssessment: currentAssessmentPayloadSchema,
  })
  .readonly();
export type M9b12dAdmissionRequest = z.infer<typeof admissionRequestSchema>;

const durableHeadSchema = z
  .strictObject({
    protocol: z.literal(M9B12D_DURABLE_AUTHORITY_PROTOCOL),
    storeIdentity: digestSchema,
    preregistrationDigest: digestSchema,
    revision: z.number().int().nonnegative(),
    digest: digestSchema.nullable(),
  })
  .readonly();

const quarantineReceiptBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b12d-durable-quarantine-receipt/1"),
    decision: z.literal("quarantine-reuse-forbidden"),
    reasons: quarantineReasonSchema.array().min(1).readonly(),
    canonicalObserverKey: digestSchema,
    launchHandle: digestSchema,
    requestedRole: m9b12bInfluenceBearingRoleSchema,
    sessionIdentity: digestSchema,
    derivedInventoryIdentity: digestSchema,
    observerReuseForbidden: z.literal(true),
    roleSessionStartupPermitted: z.literal(false),
    providerEffectsPermitted: z.literal(false),
    derivedInventoryQuarantined: z.literal(true),
    derivedInventoryReuseForbidden: z.literal(true),
    observerExcludedFromLaterRoles: m9b12bInfluenceBearingRoleSchema
      .array()
      .length(12)
      .readonly(),
    affectedRoleIdentities: m9b12bInfluenceBearingRoleSchema
      .array()
      .length(12)
      .readonly(),
    affectedSessionIdentities: digestSchema.array().length(1).readonly(),
    affectedDerivedInventoryIdentities: digestSchema
      .array()
      .length(1)
      .readonly(),
    durableHistoryHead: durableHeadSchema,
    noAdmissionRecordCreated: z.literal(true),
  })
  .readonly();
const quarantineReceiptSchema = quarantineReceiptBodySchema
  .unwrap()
  .safeExtend({ receiptDigest: digestSchema })
  .readonly();
export type M9b12dQuarantineReceipt = z.infer<typeof quarantineReceiptSchema>;

const admissionReceiptBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b12d-atomic-admission-receipt/1"),
    decision: z.literal("atomic-admission-completed"),
    admissionState: z.literal("completed"),
    admissionIdentity: digestSchema,
    canonicalObserverKey: digestSchema,
    launchHandle: digestSchema,
    requestedRole: m9b12bInfluenceBearingRoleSchema,
    sessionIdentity: digestSchema,
    derivedInventoryIdentity: digestSchema,
    startedEventDigest: digestSchema,
    terminalEventDigest: digestSchema,
    durableHistoryHead: durableHeadSchema,
    oneTimeAdmissionConsumed: z.literal(true),
    reusablePermissionExposed: z.literal(false),
    providerEffectsPermitted: z.literal(false),
    requiredProviderEffectLedgerProtocol: z.literal(
      M9B4_EFFECT_LEDGER_PROTOCOL,
    ),
  })
  .readonly();
const admissionReceiptSchema = admissionReceiptBodySchema
  .unwrap()
  .safeExtend({ receiptDigest: digestSchema })
  .readonly();
export type M9b12dAdmissionReceipt = z.infer<typeof admissionReceiptSchema>;

export type M9b12dBoundaryReceipt =
  M9b12dQuarantineReceipt | M9b12dAdmissionReceipt;

export type M9b12dRoleStartupEffect = (
  context: Readonly<{
    protocol: typeof M9B12D_ATOMIC_ADMISSION_PROTOCOL;
    admissionIdentity: string;
    canonicalObserverKey: string;
    launchHandle: string;
    requestedRole: M9b12bInfluenceBearingRole;
    sessionIdentity: string;
    derivedInventoryIdentity: string;
    providerEffectsPermitted: false;
    requiredProviderEffectLedgerProtocol: typeof M9B4_EFFECT_LEDGER_PROTOCOL;
  }>,
) => Promise<Result<void, M9b12dFailure>>;

export type M9b12dAdmissionTestHooks = Readonly<{
  afterValidationBeforeCommit?: (() => Promise<void>) | undefined;
  transactionFault?: TransactionFault | undefined;
  crashAfterAnchorBeforeEffect?: boolean | undefined;
  crashAfterEffectBeforeTerminal?: boolean | undefined;
}>;

function resolveLaunch(
  state: M9b12dAuthorityState,
  request: M9b12dAdmissionRequest,
  nowEpochMs: number,
): Result<z.infer<typeof identityIssuedEventSchema>, M9b12dFailure> {
  const launch = identityEvents(state).find(
    (event) => event.launchHandle === request.launchHandle,
  );
  if (launch === undefined)
    return failure("identity", "Authority-issued launch handle is unknown.");
  if (
    launch.requestedRole !== request.requestedRole ||
    launch.sessionIdentity !== request.sessionIdentity
  )
    return failure(
      "identity",
      "Launch handle role or session binding conflicts.",
    );
  if (
    launch.validThroughEpochMs !== null &&
    nowEpochMs > launch.validThroughEpochMs
  )
    return failure("identity", "Authority-issued launch handle is expired.");
  return { ok: true, value: launch };
}

function observerIsQuarantined(
  state: M9b12dAuthorityState,
  observerKey: string,
): boolean {
  return quarantineEvents(state).some(
    (event) => event.observerKey === observerKey,
  );
}

async function quarantineReceipt(
  state: M9b12dAuthorityState,
  request: M9b12dAdmissionRequest,
  observerKey: string,
  reasons: ReadonlyArray<string>,
): Promise<Result<M9b12dQuarantineReceipt, M9b12dFailure>> {
  const body = quarantineReceiptBodySchema.parse({
    protocol: "lachesis-m9b12d-durable-quarantine-receipt/1",
    decision: "quarantine-reuse-forbidden",
    reasons: [...new Set(reasons)].toSorted(),
    canonicalObserverKey: observerKey,
    launchHandle: request.launchHandle,
    requestedRole: request.requestedRole,
    sessionIdentity: request.sessionIdentity,
    derivedInventoryIdentity: request.derivedInventoryIdentity,
    observerReuseForbidden: true,
    roleSessionStartupPermitted: false,
    providerEffectsPermitted: false,
    derivedInventoryQuarantined: true,
    derivedInventoryReuseForbidden: true,
    observerExcludedFromLaterRoles: M9B12B_INFLUENCE_BEARING_ROLES,
    affectedRoleIdentities: M9B12B_INFLUENCE_BEARING_ROLES,
    affectedSessionIdentities: [request.sessionIdentity],
    affectedDerivedInventoryIdentities: [request.derivedInventoryIdentity],
    durableHistoryHead: {
      protocol: M9B12D_DURABLE_AUTHORITY_PROTOCOL,
      storeIdentity: state.storeIdentity,
      preregistrationDigest: state.preregistrationDigest,
      revision: state.revision,
      digest: state.headDigest,
    },
    noAdmissionRecordCreated: true,
  });
  const receiptDigest = await digestBody(body);
  return receiptDigest.ok
    ? {
        ok: true,
        value: quarantineReceiptSchema.parse({
          ...body,
          receiptDigest: receiptDigest.value,
        }),
      }
    : receiptDigest;
}

async function appendQuarantine(
  authority: M9b12dDurableAuthority,
  request: M9b12dAdmissionRequest,
  observerKey: string,
  reasons: ReadonlyArray<string>,
  incidentReceiptDigest: string,
  fault: TransactionFault,
): Promise<Result<M9b12dQuarantineReceipt, M9b12dFailure>> {
  const committed = await commitState(
    authority,
    async (state) => {
      const launch = resolveLaunch(state, request, Date.now());
      if (!launch.ok) return launch;
      const finalReasons = observerIsQuarantined(
        state,
        launch.value.observerKey,
      )
        ? ["observer-previously-quarantined"]
        : reasons;
      const appended = await appendEvent(state, {
        protocol: M9B12D_DURABLE_AUTHORITY_PROTOCOL,
        kind: "quarantine",
        quarantineProtocol: M9B12D_RETIRED_CORPUS_PROTOCOL,
        observerKey: launch.value.observerKey,
        launchHandle: request.launchHandle,
        requestedRole: request.requestedRole,
        affectedRoleIdentities: M9B12B_INFLUENCE_BEARING_ROLES,
        affectedSessionIdentities: [request.sessionIdentity],
        affectedDerivedInventoryIdentities: [request.derivedInventoryIdentity],
        incidentReceiptDigest,
        quarantineReasons: finalReasons,
        terminalDecision: "quarantine-reuse-forbidden",
        observerReuseForbidden: true,
        roleSessionStartupPermitted: false,
        providerEffectsPermitted: false,
        derivedInventoryReuseForbidden: true,
      });
      return appended.ok ? { ok: true, value: appended.value.state } : appended;
    },
    fault,
  );
  if (!committed.ok) return committed;
  const finalReasons = observerIsQuarantined(
    {
      ...committed.value,
      events: committed.value.events.slice(0, -1),
      revision: committed.value.revision - 1,
      headDigest: committed.value.events.at(-2)?.eventDigest ?? null,
    },
    observerKey,
  )
    ? ["observer-previously-quarantined"]
    : reasons;
  return quarantineReceipt(committed.value, request, observerKey, finalReasons);
}

async function appendAdmissionTerminal(
  authority: M9b12dDurableAuthority,
  admissionIdentity: string,
  startedEventDigest: string,
  admissionState: "completed" | "ambiguous",
): Promise<
  Result<
    Readonly<{ state: M9b12dAuthorityState; eventDigest: string }>,
    M9b12dFailure
  >
> {
  let terminalDigest: string | undefined;
  const committed = await commitState(authority, async (state) => {
    const started = admissionStartedEvents(state).find(
      (event) => event.admissionIdentity === admissionIdentity,
    );
    if (started?.eventDigest !== startedEventDigest)
      return failure("admission", "Started admission identity is unavailable.");
    if (
      admissionTerminalEvents(state).some(
        (event) => event.admissionIdentity === admissionIdentity,
      )
    )
      return failure(
        "admission",
        "Admission already has a terminal transition.",
      );
    const appended = await appendEvent(state, {
      protocol: M9B12D_DURABLE_AUTHORITY_PROTOCOL,
      kind: "admission-terminal",
      admissionProtocol: M9B12D_ATOMIC_ADMISSION_PROTOCOL,
      admissionIdentity,
      startedEventDigest,
      admissionState,
      terminalReason:
        admissionState === "completed"
          ? "role-startup-completed"
          : "effect-boundary-failed-after-durable-start",
      providerEffectsPermitted: false,
    });
    if (!appended.ok) return appended;
    terminalDigest = appended.value.event.eventDigest;
    return { ok: true, value: appended.value.state };
  });
  return committed.ok && terminalDigest !== undefined
    ? {
        ok: true,
        value: { state: committed.value, eventDigest: terminalDigest },
      }
    : committed.ok
      ? failure("admission", "Admission terminal event was not committed.")
      : committed;
}

export async function admitM9b12dRoleStartup(
  authority: M9b12dDurableAuthority,
  value: unknown,
  effect: M9b12dRoleStartupEffect,
  hooks: M9b12dAdmissionTestHooks = {},
): Promise<Result<M9b12dBoundaryReceipt, M9b12dFailure>> {
  const request = admissionRequestSchema.safeParse(value);
  if (!request.success)
    return failure(
      "authorization",
      "M9b.12d admission request is invalid or contains caller identity fields.",
    );
  const initial = await readValidatedState(authority);
  if (!initial.ok) return initial;
  const initialLaunch = resolveLaunch(
    initial.value.state,
    request.data,
    Date.now(),
  );
  if (!initialLaunch.ok) return initialLaunch;
  if (
    observerIsQuarantined(initial.value.state, initialLaunch.value.observerKey)
  ) {
    const incident = await digestBody({
      protocol: "lachesis-m9b12d-prior-quarantine-incident/1",
      observerKey: initialLaunch.value.observerKey,
      launchHandle: request.data.launchHandle,
      admissionIdentity: request.data.admissionIdentity,
      historyHead: initial.value.state.headDigest,
    });
    if (!incident.ok) return incident;
    await hooks.afterValidationBeforeCommit?.();
    return appendQuarantine(
      authority,
      request.data,
      initialLaunch.value.observerKey,
      ["observer-previously-quarantined"],
      incident.value,
      hooks.transactionFault ?? "none",
    );
  }
  const currentAssessment = {
    ...request.data.currentAssessment,
    role: request.data.requestedRole,
    observerIdentity: {
      status: "complete",
      commitment: initialLaunch.value.observerKey,
    },
  };
  const current = await assessM9b12bRetiredMaterialBoundary(currentAssessment);
  if (!current.ok)
    return failure("authorization", "Current proof assessment failed closed.");
  if (
    current.value.decision === "quarantine-reuse-forbidden" ||
    current.value.reasons.length > 0
  ) {
    const incident = await digestBody({
      protocol: "lachesis-m9b12d-current-assessment-incident/1",
      observerKey: initialLaunch.value.observerKey,
      m9b12bReceiptDigest: current.value.receiptDigest,
      reasons: current.value.reasons,
      admissionIdentity: request.data.admissionIdentity,
    });
    if (!incident.ok) return incident;
    await hooks.afterValidationBeforeCommit?.();
    return appendQuarantine(
      authority,
      request.data,
      initialLaunch.value.observerKey,
      current.value.reasons,
      incident.value,
      hooks.transactionFault ?? "none",
    );
  }
  await hooks.afterValidationBeforeCommit?.();
  let startedEvent: z.infer<typeof admissionStartedEventSchema> | undefined;
  const started = await commitState(
    authority,
    async (state) => {
      const launch = resolveLaunch(state, request.data, Date.now());
      if (!launch.ok) return launch;
      if (observerIsQuarantined(state, launch.value.observerKey))
        return failure(
          "admission",
          "Quarantine committed before atomic admission.",
        );
      if (
        admissionStartedEvents(state).some(
          (event) =>
            event.admissionIdentity === request.data.admissionIdentity ||
            event.launchHandle === request.data.launchHandle,
        )
      )
        return failure(
          "admission",
          "Admission identity or launch was already consumed.",
        );
      const appended = await appendEvent(state, {
        protocol: M9B12D_DURABLE_AUTHORITY_PROTOCOL,
        kind: "admission-effect-started",
        admissionProtocol: M9B12D_ATOMIC_ADMISSION_PROTOCOL,
        admissionIdentity: request.data.admissionIdentity,
        observerKey: launch.value.observerKey,
        launchHandle: request.data.launchHandle,
        requestedRole: request.data.requestedRole,
        sessionIdentity: request.data.sessionIdentity,
        derivedInventoryIdentity: request.data.derivedInventoryIdentity,
        proofReceiptDigest: current.value.receiptDigest,
        admissionState: "effect-started",
        oneTimeAdmissionConsumed: true,
        reusablePermissionExposed: false,
        providerEffectsPermitted: false,
        requiredProviderEffectLedgerProtocol: M9B4_EFFECT_LEDGER_PROTOCOL,
      });
      if (!appended.ok) return appended;
      if (appended.value.event.kind !== "admission-effect-started")
        return failure(
          "admission",
          "Admission event kind changed during append.",
        );
      startedEvent = appended.value.event;
      return { ok: true, value: appended.value.state };
    },
    hooks.transactionFault ?? "none",
  );
  if (!started.ok) return started;
  if (startedEvent === undefined)
    return failure("admission", "Atomic admission start was not committed.");
  if (hooks.crashAfterAnchorBeforeEffect)
    return failure(
      "admission",
      "Injected crash after durable admission and before role startup effect.",
    );
  const effectResult = await effect({
    protocol: M9B12D_ATOMIC_ADMISSION_PROTOCOL,
    admissionIdentity: request.data.admissionIdentity,
    canonicalObserverKey: startedEvent.observerKey,
    launchHandle: request.data.launchHandle,
    requestedRole: request.data.requestedRole,
    sessionIdentity: request.data.sessionIdentity,
    derivedInventoryIdentity: request.data.derivedInventoryIdentity,
    providerEffectsPermitted: false,
    requiredProviderEffectLedgerProtocol: M9B4_EFFECT_LEDGER_PROTOCOL,
  });
  if (!effectResult.ok || hooks.crashAfterEffectBeforeTerminal) {
    if (!hooks.crashAfterEffectBeforeTerminal)
      await appendAdmissionTerminal(
        authority,
        request.data.admissionIdentity,
        startedEvent.eventDigest,
        "ambiguous",
      );
    return effectResult.ok
      ? failure(
          "admission",
          "Injected crash after role startup effect and before terminal commit.",
        )
      : effectResult;
  }
  const terminal = await appendAdmissionTerminal(
    authority,
    request.data.admissionIdentity,
    startedEvent.eventDigest,
    "completed",
  );
  if (!terminal.ok) return terminal;
  const body = admissionReceiptBodySchema.parse({
    protocol: "lachesis-m9b12d-atomic-admission-receipt/1",
    decision: "atomic-admission-completed",
    admissionState: "completed",
    admissionIdentity: request.data.admissionIdentity,
    canonicalObserverKey: startedEvent.observerKey,
    launchHandle: request.data.launchHandle,
    requestedRole: request.data.requestedRole,
    sessionIdentity: request.data.sessionIdentity,
    derivedInventoryIdentity: request.data.derivedInventoryIdentity,
    startedEventDigest: startedEvent.eventDigest,
    terminalEventDigest: terminal.value.eventDigest,
    durableHistoryHead: {
      protocol: M9B12D_DURABLE_AUTHORITY_PROTOCOL,
      storeIdentity: terminal.value.state.storeIdentity,
      preregistrationDigest: terminal.value.state.preregistrationDigest,
      revision: terminal.value.state.revision,
      digest: terminal.value.state.headDigest,
    },
    oneTimeAdmissionConsumed: true,
    reusablePermissionExposed: false,
    providerEffectsPermitted: false,
    requiredProviderEffectLedgerProtocol: M9B4_EFFECT_LEDGER_PROTOCOL,
  });
  const receiptDigest = await digestBody(body);
  return receiptDigest.ok
    ? {
        ok: true,
        value: admissionReceiptSchema.parse({
          ...body,
          receiptDigest: receiptDigest.value,
        }),
      }
    : receiptDigest;
}
