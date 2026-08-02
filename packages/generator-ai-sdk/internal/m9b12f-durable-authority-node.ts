import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
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
  type M9b12bRetiredBoundaryReceipt,
  m9b12bRetiredBoundaryReceiptSchema,
} from "./m9b12b-preregistration.js";
import { M9B12F_PREREGISTRATION_DIGEST } from "./m9b12f-preregistration.js";

export const M9B12F_DURABLE_AUTHORITY_PROTOCOL =
  "lachesis-m9b12f-durable-quarantine-authority/1" as const;
export const M9B12F_AUTHENTICATED_OBSERVER_IDENTITY_PROTOCOL =
  "lachesis-m9b12f-authenticated-observer-identity/1" as const;
export const M9B12F_ATOMIC_ADMISSION_PROTOCOL =
  "lachesis-m9b12f-atomic-role-effect-admission/1" as const;
export const M9B12F_PRIVATE_SQLITE_SIDECAR_POLICY_PROTOCOL =
  "lachesis-m9b12f-private-sqlite-sidecar-policy/1" as const;
export const M9B12F_RETIRED_CORPUS_PROTOCOL =
  "lachesis-m9b12f-retired-corpus-quarantine@1.0.0" as const;
export const M9B12F_PREREGISTRATION_PROTOCOL =
  "lachesis-m9b12f-offline-preregistration-package@1.0.0" as const;
const M9B4_EFFECT_LEDGER_PROTOCOL =
  "lachesis-m9b4-offline-effect-ledger@1.2.0" as const;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const MAXIMUM_STORE_BYTES = 16 * 1024 * 1024;
const SQLITE_SIDECAR_SUFFIXES = ["-journal", "-wal", "-shm"] as const;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z.string().min(1).max(256);
const quarantineReasonSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z0-9][a-z0-9:-]*$/u);

export type M9b12fFailure = Readonly<{
  kind: "storage" | "identity" | "history" | "authorization" | "admission";
  message: string;
}>;

function failure(
  kind: M9b12fFailure["kind"],
  message: string,
): Result<never, M9b12fFailure> {
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
): Promise<Result<string, M9b12fFailure>> {
  const digest = await digestValue(value);
  return digest.ok
    ? { ok: true, value: digest.value }
    : failure("history", "M9b.12f canonical digest failed.");
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
  protocol: z.literal(M9B12F_DURABLE_AUTHORITY_PROTOCOL),
  sequence: z.number().int().positive(),
  predecessorHeadDigest: digestSchema.nullable(),
};

const identityIssuedEventBodySchema = z
  .strictObject({
    ...commonEventBodyShape,
    kind: z.literal("identity-issued"),
    identityProtocol: z.literal(
      M9B12F_AUTHENTICATED_OBSERVER_IDENTITY_PROTOCOL,
    ),
    principalId: digestSchema,
    launchAllocationId: digestSchema,
    displayLabel: identifierSchema.nullable(),
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
    quarantineProtocol: z.literal(M9B12F_RETIRED_CORPUS_PROTOCOL),
    observerKey: digestSchema,
    launchHandle: digestSchema,
    launchAllocationId: digestSchema,
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
    assessmentCanonicalJson: z.string().min(2),
    assessmentBytesDigest: digestSchema,
    proofReceipt: m9b12bRetiredBoundaryReceiptSchema,
    proofReceiptDigest: digestSchema,
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
    admissionProtocol: z.literal(M9B12F_ATOMIC_ADMISSION_PROTOCOL),
    admissionIdentity: digestSchema,
    observerKey: digestSchema,
    launchHandle: digestSchema,
    launchAllocationId: digestSchema,
    requestedRole: m9b12bInfluenceBearingRoleSchema,
    sessionIdentity: digestSchema,
    derivedInventoryIdentity: digestSchema,
    assessmentCanonicalJson: z.string().min(2),
    assessmentBytesDigest: digestSchema,
    proofReceipt: m9b12bRetiredBoundaryReceiptSchema,
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
    admissionProtocol: z.literal(M9B12F_ATOMIC_ADMISSION_PROTOCOL),
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

export const m9b12fAuthorityEventSchema = z.discriminatedUnion("kind", [
  identityIssuedEventSchema,
  quarantineEventSchema,
  admissionStartedEventSchema,
  admissionTerminalEventSchema,
]);
export type M9b12fAuthorityEvent = z.infer<typeof m9b12fAuthorityEventSchema>;

export const m9b12fAuthorityStateSchema = z
  .strictObject({
    protocol: z.literal(M9B12F_DURABLE_AUTHORITY_PROTOCOL),
    preregistrationProtocol: z.literal(M9B12F_PREREGISTRATION_PROTOCOL),
    preregistrationDigest: digestSchema,
    storeIdentity: digestSchema,
    revision: z.number().int().nonnegative(),
    headDigest: digestSchema.nullable(),
    events: m9b12fAuthorityEventSchema.array().readonly(),
  })
  .readonly();
export type M9b12fAuthorityState = z.infer<typeof m9b12fAuthorityStateSchema>;

function eventBody(event: M9b12fAuthorityEvent): AuthorityEventBody {
  const { eventDigest: ignoredEventDigest, ...body } = event;
  void ignoredEventDigest;
  return authorityEventBodySchema.parse(body);
}

async function validateStoredProofAssessment(
  event:
    | z.infer<typeof quarantineEventSchema>
    | z.infer<typeof admissionStartedEventSchema>,
): Promise<Result<void, M9b12fFailure>> {
  const parsedJson = parseJson(event.assessmentCanonicalJson);
  if (!parsedJson.ok)
    return failure("history", "Stored assessment bytes are not strict JSON.");
  const canonical = canonicalizeJson(parsedJson.value);
  const assessment = currentAssessmentPayloadSchema.safeParse(parsedJson.value);
  const assessmentDigest = await digestBody(parsedJson.value);
  if (
    !canonical.ok ||
    canonical.value !== event.assessmentCanonicalJson ||
    !assessment.success ||
    !assessmentDigest.ok ||
    assessmentDigest.value !== event.assessmentBytesDigest
  )
    return failure(
      "history",
      "Stored assessment bytes or digest are inconsistent.",
    );
  const rederived = await assessM9b12bRetiredMaterialBoundary({
    ...assessment.data,
    role: event.requestedRole,
    observerIdentity: {
      status: "complete",
      commitment: event.observerKey,
    },
  });
  if (
    !rederived.ok ||
    rederived.value.receiptDigest !== event.proofReceiptDigest ||
    !canonicalEqual(rederived.value, event.proofReceipt)
  )
    return failure(
      "history",
      "Stored transactional proof receipt or digest is invalid.",
    );
  return { ok: true, value: undefined };
}

function identityEvents(
  state: M9b12fAuthorityState,
): ReadonlyArray<z.infer<typeof identityIssuedEventSchema>> {
  return state.events.filter(
    (event): event is z.infer<typeof identityIssuedEventSchema> =>
      event.kind === "identity-issued",
  );
}

function quarantineEvents(
  state: M9b12fAuthorityState,
): ReadonlyArray<z.infer<typeof quarantineEventSchema>> {
  return state.events.filter(
    (event): event is z.infer<typeof quarantineEventSchema> =>
      event.kind === "quarantine",
  );
}

function admissionStartedEvents(
  state: M9b12fAuthorityState,
): ReadonlyArray<z.infer<typeof admissionStartedEventSchema>> {
  return state.events.filter(
    (event): event is z.infer<typeof admissionStartedEventSchema> =>
      event.kind === "admission-effect-started",
  );
}

function admissionTerminalEvents(
  state: M9b12fAuthorityState,
): ReadonlyArray<z.infer<typeof admissionTerminalEventSchema>> {
  return state.events.filter(
    (event): event is z.infer<typeof admissionTerminalEventSchema> =>
      event.kind === "admission-terminal",
  );
}

export async function validateM9b12fAuthorityState(
  value: unknown,
): Promise<Result<M9b12fAuthorityState, M9b12fFailure>> {
  const parsed = m9b12fAuthorityStateSchema.safeParse(value);
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
      const knownObserver = principalObservers.get(event.principalId);
      const derivedObserver = await digestBody({
        protocol: M9B12F_AUTHENTICATED_OBSERVER_IDENTITY_PROTOCOL,
        storeIdentity: state.storeIdentity,
        principalId: event.principalId,
      });
      if (!derivedObserver.ok) return derivedObserver;
      if (
        derivedObserver.value !== event.observerKey ||
        (knownObserver !== undefined && knownObserver !== event.observerKey) ||
        allocationKeys.has(event.launchAllocationId) ||
        launchHandles.has(event.launchHandle)
      )
        return failure(
          "identity",
          "Trusted observer identity chain conflicts.",
        );
      principalObservers.set(event.principalId, event.observerKey);
      allocationKeys.add(event.launchAllocationId);
      launchHandles.add(event.launchHandle);
      launchesByHandle.set(event.launchHandle, event);
    } else if (event.kind === "quarantine") {
      const proof = await validateStoredProofAssessment(event);
      if (!proof.ok) return proof;
      const launch = launchesByHandle.get(event.launchHandle);
      if (
        launch?.observerKey !== event.observerKey ||
        launch.launchAllocationId !== event.launchAllocationId ||
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
        ) ||
        event.proofReceipt.receiptDigest !== event.proofReceiptDigest
      )
        return failure("history", "Durable quarantine event is noncanonical.");
      quarantinedObservers.add(event.observerKey);
    } else if (event.kind === "admission-effect-started") {
      const proof = await validateStoredProofAssessment(event);
      if (!proof.ok) return proof;
      const launch = launchesByHandle.get(event.launchHandle);
      if (
        launch?.observerKey !== event.observerKey ||
        launch.launchAllocationId !== event.launchAllocationId ||
        launch.requestedRole !== event.requestedRole ||
        launch.sessionIdentity !== event.sessionIdentity ||
        event.proofReceipt.receiptDigest !== event.proofReceiptDigest ||
        event.proofReceipt.decision === "quarantine-reuse-forbidden" ||
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
    protocol: z.literal(M9B12F_DURABLE_AUTHORITY_PROTOCOL),
    preregistrationProtocol: z.literal(M9B12F_PREREGISTRATION_PROTOCOL),
    preregistrationDigest: digestSchema,
    storeIdentity: digestSchema,
    anchorIdentity: digestSchema,
  })
  .readonly();
export type M9b12fTrustedAuthorityBinding = z.infer<
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
    protocol: z.literal(M9B12F_DURABLE_AUTHORITY_PROTOCOL),
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
export type M9b12fAuthorityAudit = z.infer<typeof authorityAuditSchema>;

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
  state: M9b12fAuthorityState;
  stateDigest: string;
  anchor: AuthorityAnchor;
}>;

const repositoryBrand: unique symbol = Symbol("M9b12fDurableAuthority");
export type M9b12fDurableAuthority = Readonly<{
  [repositoryBrand]: "M9b12fDurableAuthority";
  databasePath: string;
  anchorPath: string;
  trustedBinding: M9b12fTrustedAuthorityBinding;
}>;

function repository(
  databasePath: string,
  anchorPath: string,
  trustedBinding: M9b12fTrustedAuthorityBinding,
): M9b12fDurableAuthority {
  const brand = "M9b12fDurableAuthority" as const;
  const value: M9b12fDurableAuthority = Object.freeze({
    [repositoryBrand]: brand,
    databasePath,
    anchorPath,
    trustedBinding,
  });
  return value;
}

function currentUserId(): Result<number, M9b12fFailure> {
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
): Result<string, M9b12fFailure> {
  return isAbsolute(path) && resolve(path) === path
    ? { ok: true, value: path }
    : failure("storage", `${label} must be an absolute normalized path.`);
}

async function validatePrivateDirectory(
  path: string,
  userId: number,
): Promise<Result<void, M9b12fFailure>> {
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
): Promise<Result<void, M9b12fFailure>> {
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

type SidecarExpectation = "absent" | "active-transaction";

async function auditSqliteSidecars(
  databasePath: string,
  userId: number,
  expectation: SidecarExpectation,
): Promise<Result<void, M9b12fFailure>> {
  const parent = dirname(databasePath);
  const databaseName = basename(databasePath);
  const allowedNames = new Set(
    SQLITE_SIDECAR_SUFFIXES.map((suffix) => `${databaseName}${suffix}`),
  );
  try {
    const canonicalParent = await realpath(parent);
    if (canonicalParent !== parent)
      return failure(
        "storage",
        "SQLite sidecar parent contains a normalized alias or containment escape.",
      );
    const entries = await readdir(parent);
    for (const name of entries) {
      if (!name.startsWith(`${databaseName}-`)) continue;
      if (!allowedNames.has(name))
        return failure(
          "storage",
          "Unknown database-prefixed SQLite sidecar-like path is present.",
        );
    }
    for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
      const sidecarPath = `${databasePath}${suffix}`;
      if (
        resolve(parent, `${databaseName}${suffix}`) !== sidecarPath ||
        dirname(sidecarPath) !== parent
      )
        return failure(
          "storage",
          "SQLite sidecar path escapes its private database parent.",
        );
      try {
        await lstat(sidecarPath);
      } catch (error: unknown) {
        if (errorCode(error) === "ENOENT") continue;
        return failure(
          "storage",
          `SQLite sidecar inventory failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
        );
      }
      if (expectation === "absent")
        return failure(
          "storage",
          `Unexpected residual SQLite ${suffix} sidecar is present.`,
        );
      const audited = await validatePrivateFile(
        sidecarPath,
        userId,
        `SQLite ${suffix} sidecar`,
      );
      if (!audited.ok) return audited;
    }
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    return failure(
      "storage",
      `SQLite sidecar audit failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
    );
  }
}

async function ensureNewPrivateParent(
  path: string,
  userId: number,
): Promise<Result<void, M9b12fFailure>> {
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
): Promise<Result<void, M9b12fFailure>> {
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
): Promise<Result<unknown, M9b12fFailure>> {
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
): Promise<Result<void, M9b12fFailure>> {
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
): Result<z.infer<typeof rowSchema>, M9b12fFailure> {
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
    Readonly<{ state: M9b12fAuthorityState; stateDigest: string }>,
    M9b12fFailure
  >
> {
  const parsedJson = parseJson(row.state_json);
  if (!parsedJson.ok)
    return failure("storage", "Durable authority state is not strict JSON.");
  const state = await validateM9b12fAuthorityState(parsedJson.value);
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
): Promise<Result<AuthorityAnchor, M9b12fFailure>> {
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
  binding: M9b12fTrustedAuthorityBinding,
  state: M9b12fAuthorityState,
): Promise<Result<AuthorityAnchor, M9b12fFailure>> {
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
  binding: M9b12fTrustedAuthorityBinding,
  state: M9b12fAuthorityState,
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
  authority: M9b12fDurableAuthority,
  sidecarExpectation: SidecarExpectation = "absent",
): Promise<Result<number, M9b12fFailure>> {
  const userId = currentUserId();
  if (!userId.ok) return userId;
  const databaseParentPath = dirname(authority.databasePath);
  const anchorParentPath = dirname(authority.anchorPath);
  const authorityRoot = dirname(databaseParentPath);
  if (dirname(anchorParentPath) !== authorityRoot)
    return failure(
      "storage",
      "Database and anchor must share one private authority root.",
    );
  const root = await validatePrivateDirectory(authorityRoot, userId.value);
  if (!root.ok) return root;
  try {
    if ((await realpath(authorityRoot)) !== authorityRoot)
      return failure(
        "storage",
        "Authority root contains a normalized alias or containment escape.",
      );
  } catch (error: unknown) {
    return failure(
      "storage",
      `Authority root canonical audit failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
    );
  }
  const databaseParent = await validatePrivateDirectory(
    databaseParentPath,
    userId.value,
  );
  if (!databaseParent.ok) return databaseParent;
  const anchorParent = await validatePrivateDirectory(
    anchorParentPath,
    userId.value,
  );
  if (!anchorParent.ok) return anchorParent;
  const database = await validatePrivateFile(
    authority.databasePath,
    userId.value,
    "Durable authority database",
  );
  if (!database.ok) return database;
  const sidecars = await auditSqliteSidecars(
    authority.databasePath,
    userId.value,
    sidecarExpectation,
  );
  if (!sidecars.ok) return sidecars;
  const anchor = await validatePrivateFile(
    authority.anchorPath,
    userId.value,
    "Trusted authority anchor",
  );
  return anchor.ok ? userId : anchor;
}

async function loadState(
  authority: M9b12fDurableAuthority,
  database: DatabaseSync,
  userId: number,
): Promise<Result<LoadedState, M9b12fFailure>> {
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
  authority: M9b12fDurableAuthority,
  mutate: (
    state: M9b12fAuthorityState,
  ) => Promise<Result<M9b12fAuthorityState, M9b12fFailure>>,
  fault: TransactionFault = "none",
): Promise<Result<M9b12fAuthorityState, M9b12fFailure>> {
  const audited = await auditPaths(authority);
  if (!audited.ok) return audited;
  let database: DatabaseSync | undefined;
  let committed = false;
  try {
    database = new DatabaseSync(authority.databasePath);
    configureDatabase(database);
    const openedAudit = await auditPaths(authority);
    if (!openedAudit.ok) return openedAudit;
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
    const validated = await validateM9b12fAuthorityState(next.value);
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
    const activeSidecars = await auditPaths(authority, "active-transaction");
    if (!activeSidecars.ok) {
      database.exec("ROLLBACK");
      return activeSidecars;
    }
    database.exec("COMMIT");
    committed = true;
    database.close();
    database = undefined;
    const closedAudit = await auditPaths(authority);
    if (!closedAudit.ok) return closedAudit;
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
    if (!persistedAnchor.ok) return persistedAnchor;
    const finalAudit = await auditPaths(authority);
    return finalAudit.ok ? { ok: true, value: validated.value } : finalAudit;
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
  state: M9b12fAuthorityState,
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
    Readonly<{ state: M9b12fAuthorityState; event: M9b12fAuthorityEvent }>,
    M9b12fFailure
  >
> {
  const body = authorityEventBodySchema.parse({
    ...event,
    sequence: state.revision + 1,
    predecessorHeadDigest: state.headDigest,
  });
  const eventDigest = await digestBody(body);
  if (!eventDigest.ok) return eventDigest;
  const appended = m9b12fAuthorityEventSchema.parse({
    ...body,
    eventDigest: eventDigest.value,
  });
  const next = m9b12fAuthorityStateSchema.parse({
    ...state,
    revision: appended.sequence,
    headDigest: appended.eventDigest,
    events: [...state.events, appended],
  });
  return { ok: true, value: { state: next, event: appended } };
}

export type M9b12fAuthorityPaths = Readonly<{
  databasePath: string;
  anchorPath: string;
}>;

export async function createNewM9b12fAuthority(
  paths: M9b12fAuthorityPaths,
): Promise<
  Result<
    Readonly<{
      authority: M9b12fDurableAuthority;
      trustedBinding: M9b12fTrustedAuthorityBinding;
    }>,
    M9b12fFailure
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
      protocol: M9B12F_DURABLE_AUTHORITY_PROTOCOL,
      nonce: randomUUID(),
    });
    const anchorIdentity = await digestBody({
      protocol: `${M9B12F_DURABLE_AUTHORITY_PROTOCOL}:trusted-anchor`,
      nonce: randomUUID(),
    });
    if (!storeIdentity.ok) return storeIdentity;
    if (!anchorIdentity.ok) return anchorIdentity;
    const trustedBinding = trustedBindingSchema.parse({
      protocol: M9B12F_DURABLE_AUTHORITY_PROTOCOL,
      preregistrationProtocol: M9B12F_PREREGISTRATION_PROTOCOL,
      preregistrationDigest: M9B12F_PREREGISTRATION_DIGEST,
      storeIdentity: storeIdentity.value,
      anchorIdentity: anchorIdentity.value,
    });
    const state = m9b12fAuthorityStateSchema.parse({
      protocol: M9B12F_DURABLE_AUTHORITY_PROTOCOL,
      preregistrationProtocol: M9B12F_PREREGISTRATION_PROTOCOL,
      preregistrationDigest: M9B12F_PREREGISTRATION_DIGEST,
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
    const audited = await auditM9b12fAuthority(authority);
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

export async function openExistingM9b12fAuthority(
  paths: M9b12fAuthorityPaths,
  value: unknown,
): Promise<Result<M9b12fDurableAuthority, M9b12fFailure>> {
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
  const audited = await auditM9b12fAuthority(authority);
  return audited.ok ? { ok: true, value: authority } : audited;
}

async function readValidatedState(
  authority: M9b12fDurableAuthority,
): Promise<Result<LoadedState, M9b12fFailure>> {
  const audited = await auditPaths(authority);
  if (!audited.ok) return audited;
  let database: DatabaseSync | undefined;
  let loaded: Result<LoadedState, M9b12fFailure> | undefined;
  try {
    database = new DatabaseSync(authority.databasePath, { readOnly: true });
    database.exec("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON;");
    const openedAudit = await auditPaths(authority);
    if (!openedAudit.ok) return openedAudit;
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
    loaded = await loadState(authority, database, audited.value);
  } catch (error: unknown) {
    return failure(
      "storage",
      `Existing durable authority open failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
    );
  } finally {
    database?.close();
  }
  const closedAudit = await auditPaths(authority);
  if (!closedAudit.ok) return closedAudit;
  return loaded;
}

export async function snapshotM9b12fAuthorityState(
  authority: M9b12fDurableAuthority,
): Promise<Result<M9b12fAuthorityState, M9b12fFailure>> {
  const loaded = await readValidatedState(authority);
  return loaded.ok ? { ok: true, value: loaded.value.state } : loaded;
}

export async function auditM9b12fAuthority(
  authority: M9b12fDurableAuthority,
): Promise<Result<M9b12fAuthorityAudit, M9b12fFailure>> {
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
      protocol: M9B12F_DURABLE_AUTHORITY_PROTOCOL,
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

const authenticatedChannelAdapterBrand: unique symbol = Symbol(
  "M9b12fAuthenticatedChannelAdapter",
);
export type M9b12fAuthenticatedChannelAdapter = Readonly<{
  [authenticatedChannelAdapterBrand]: "M9b12fAuthenticatedChannelAdapter";
}>;

const authenticatedPrincipalSchema = z
  .strictObject({
    opaquePrincipalId: digestSchema,
    validThroughEpochMs: z.number().int().nonnegative().nullable(),
  })
  .readonly();
export type M9b12fAuthenticatedPrincipal = z.infer<
  typeof authenticatedPrincipalSchema
>;

export type M9b12fPrincipalAuthenticator = (
  credentials: unknown,
) => Promise<Result<M9b12fAuthenticatedPrincipal, M9b12fFailure>>;

type AuthenticatedChannelAdapterState = Readonly<{
  authority: M9b12fDurableAuthority;
  authenticate: M9b12fPrincipalAuthenticator;
}>;
const authenticatedChannelAdapters = new WeakMap<
  object,
  AuthenticatedChannelAdapterState
>();

export function createM9b12fAuthenticatedChannelAdapter(
  authority: M9b12fDurableAuthority,
  authenticate: M9b12fPrincipalAuthenticator,
): M9b12fAuthenticatedChannelAdapter {
  const adapter: M9b12fAuthenticatedChannelAdapter = Object.freeze({
    [authenticatedChannelAdapterBrand]: "M9b12fAuthenticatedChannelAdapter",
  });
  authenticatedChannelAdapters.set(adapter, { authority, authenticate });
  return adapter;
}

const presenterContextBrand: unique symbol = Symbol(
  "M9b12fAuthenticatedPresenterContext",
);
export type M9b12fAuthenticatedPresenterContext = Readonly<{
  [presenterContextBrand]: "M9b12fAuthenticatedPresenterContext";
}>;

type PresenterContextState = Readonly<{
  protocol: typeof M9B12F_AUTHENTICATED_OBSERVER_IDENTITY_PROTOCOL;
  storeIdentity: string;
  principalId: string;
  issuedAtEpochMs: number;
  validThroughEpochMs: number | null;
}>;
const presenterContexts = new WeakMap<object, PresenterContextState>();
const revokedPresenterContexts = new WeakSet<object>();

function objectValue(value: unknown): object | undefined {
  return typeof value === "object" && value !== null ? value : undefined;
}

export async function authenticateM9b12fPresenter(
  adapterValue: unknown,
  credentials: unknown,
): Promise<Result<M9b12fAuthenticatedPresenterContext, M9b12fFailure>> {
  const adapterObject = objectValue(adapterValue);
  const adapter =
    adapterObject === undefined
      ? undefined
      : authenticatedChannelAdapters.get(adapterObject);
  if (adapter === undefined)
    return failure("identity", "authenticated-channel-adapter-invalid");
  const authenticated = await adapter.authenticate(credentials);
  if (!authenticated.ok) return authenticated;
  const parsed = authenticatedPrincipalSchema.safeParse(authenticated.value);
  if (!parsed.success)
    return failure("identity", "authenticated-principal-invalid");
  const nowEpochMs = Date.now();
  if (
    parsed.data.validThroughEpochMs !== null &&
    nowEpochMs > parsed.data.validThroughEpochMs
  )
    return failure("identity", "authenticated-presenter-context-expired");
  const state = await readValidatedState(adapter.authority);
  if (!state.ok) return state;
  const context: M9b12fAuthenticatedPresenterContext = Object.freeze({
    [presenterContextBrand]: "M9b12fAuthenticatedPresenterContext",
  });
  presenterContexts.set(context, {
    protocol: M9B12F_AUTHENTICATED_OBSERVER_IDENTITY_PROTOCOL,
    storeIdentity: state.value.state.storeIdentity,
    principalId: parsed.data.opaquePrincipalId,
    issuedAtEpochMs: nowEpochMs,
    validThroughEpochMs: parsed.data.validThroughEpochMs,
  });
  return { ok: true, value: context };
}

export function revokeM9b12fPresenterContext(
  value: unknown,
): Result<void, M9b12fFailure> {
  const context = objectValue(value);
  if (context === undefined || !presenterContexts.has(context))
    return failure("identity", "authenticated-presenter-context-invalid");
  revokedPresenterContexts.add(context);
  return { ok: true, value: undefined };
}

function validatePresenterContext(
  authority: M9b12fDurableAuthority,
  value: unknown,
  nowEpochMs: number,
): Result<PresenterContextState, M9b12fFailure> {
  const context = objectValue(value);
  if (context === undefined)
    return failure("identity", "authenticated-presenter-context-invalid");
  const state = presenterContexts.get(context);
  if (state === undefined)
    return failure("identity", "authenticated-presenter-context-invalid");
  if (revokedPresenterContexts.has(context))
    return failure("identity", "authenticated-presenter-context-revoked");
  if (state.storeIdentity !== authority.trustedBinding.storeIdentity)
    return failure("identity", "authenticated-presenter-context-wrong-store");
  if (
    state.validThroughEpochMs !== null &&
    nowEpochMs > state.validThroughEpochMs
  )
    return failure("identity", "authenticated-presenter-context-expired");
  return { ok: true, value: state };
}

const identityIssuanceSchema = z
  .strictObject({
    opaquePrincipalId: digestSchema,
    launchAllocationId: digestSchema,
    displayLabel: identifierSchema.nullable(),
    requestedRole: m9b12bInfluenceBearingRoleSchema,
    sessionIdentity: digestSchema,
    validThroughEpochMs: z.number().int().nonnegative().nullable(),
  })
  .readonly();
export type M9b12fIdentityIssuance = z.infer<typeof identityIssuanceSchema>;

const identityReceiptBodySchema = z
  .strictObject({
    protocol: z.literal(M9B12F_AUTHENTICATED_OBSERVER_IDENTITY_PROTOCOL),
    storeIdentity: digestSchema,
    principalId: digestSchema,
    launchAllocationId: digestSchema,
    displayLabel: identifierSchema.nullable(),
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
export type M9b12fIdentityReceipt = z.infer<typeof identityReceiptSchema>;

export async function issueM9b12fObserverLaunchHandle(
  authority: M9b12fDurableAuthority,
  value: unknown,
): Promise<Result<M9b12fIdentityReceipt, M9b12fFailure>> {
  const input = identityIssuanceSchema.safeParse(value);
  if (!input.success)
    return failure(
      "identity",
      "Authenticated opaque observer identity issuance is invalid.",
    );
  let issuedEvent: z.infer<typeof identityIssuedEventSchema> | undefined;
  const committed = await commitState(authority, async (state) => {
    if (
      identityEvents(state).some(
        (event) => event.launchAllocationId === input.data.launchAllocationId,
      )
    )
      return failure(
        "identity",
        "Launch allocation identity was already issued.",
      );
    const observerKey = await digestBody({
      protocol: M9B12F_AUTHENTICATED_OBSERVER_IDENTITY_PROTOCOL,
      storeIdentity: state.storeIdentity,
      principalId: input.data.opaquePrincipalId,
    });
    if (!observerKey.ok) return observerKey;
    const launchHandle = await digestBody({
      protocol: M9B12F_AUTHENTICATED_OBSERVER_IDENTITY_PROTOCOL,
      storeIdentity: state.storeIdentity,
      observerKey: observerKey.value,
      launchAllocationId: input.data.launchAllocationId,
      requestedRole: input.data.requestedRole,
      sessionIdentity: input.data.sessionIdentity,
      nonce: randomUUID(),
    });
    if (!launchHandle.ok) return launchHandle;
    const appended = await appendEvent(state, {
      protocol: M9B12F_DURABLE_AUTHORITY_PROTOCOL,
      kind: "identity-issued",
      identityProtocol: M9B12F_AUTHENTICATED_OBSERVER_IDENTITY_PROTOCOL,
      principalId: input.data.opaquePrincipalId,
      launchAllocationId: input.data.launchAllocationId,
      displayLabel: input.data.displayLabel,
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
    return failure(
      "identity",
      "Authenticated identity event was not committed.",
    );
  const body = identityReceiptBodySchema.parse({
    protocol: M9B12F_AUTHENTICATED_OBSERVER_IDENTITY_PROTOCOL,
    storeIdentity: committed.value.storeIdentity,
    principalId: issuedEvent.principalId,
    launchAllocationId: issuedEvent.launchAllocationId,
    displayLabel: issuedEvent.displayLabel,
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
      "opaquePrincipalId",
      "principalId",
      "presenterContext",
      "authenticatedPresenterContext",
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
    launchAllocationId: digestSchema,
    requestedRole: m9b12bInfluenceBearingRoleSchema,
    sessionIdentity: digestSchema,
    derivedInventoryIdentity: digestSchema,
    admissionIdentity: digestSchema,
    currentAssessment: currentAssessmentPayloadSchema,
  })
  .readonly();
export type M9b12fAdmissionRequest = z.infer<typeof admissionRequestSchema>;

const durableHeadSchema = z
  .strictObject({
    protocol: z.literal(M9B12F_DURABLE_AUTHORITY_PROTOCOL),
    storeIdentity: digestSchema,
    preregistrationDigest: digestSchema,
    revision: z.number().int().nonnegative(),
    digest: digestSchema.nullable(),
  })
  .readonly();

const quarantineReceiptBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b12f-durable-quarantine-receipt/1"),
    decision: z.literal("quarantine-reuse-forbidden"),
    reasons: quarantineReasonSchema.array().min(1).readonly(),
    canonicalObserverKey: digestSchema,
    launchHandle: digestSchema,
    launchAllocationId: digestSchema,
    requestedRole: m9b12bInfluenceBearingRoleSchema,
    sessionIdentity: digestSchema,
    derivedInventoryIdentity: digestSchema,
    assessmentBytesDigest: digestSchema,
    proofReceipt: m9b12bRetiredBoundaryReceiptSchema,
    proofReceiptDigest: digestSchema,
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
export type M9b12fQuarantineReceipt = z.infer<typeof quarantineReceiptSchema>;

const admissionReceiptBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b12f-atomic-admission-receipt/1"),
    decision: z.literal("atomic-admission-completed"),
    admissionState: z.literal("completed"),
    admissionIdentity: digestSchema,
    canonicalObserverKey: digestSchema,
    launchHandle: digestSchema,
    launchAllocationId: digestSchema,
    requestedRole: m9b12bInfluenceBearingRoleSchema,
    sessionIdentity: digestSchema,
    derivedInventoryIdentity: digestSchema,
    assessmentBytesDigest: digestSchema,
    proofReceipt: m9b12bRetiredBoundaryReceiptSchema,
    proofReceiptDigest: digestSchema,
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
export type M9b12fAdmissionReceipt = z.infer<typeof admissionReceiptSchema>;

export type M9b12fBoundaryReceipt =
  M9b12fQuarantineReceipt | M9b12fAdmissionReceipt;

export type M9b12fRoleStartupEffect = (
  context: Readonly<{
    protocol: typeof M9B12F_ATOMIC_ADMISSION_PROTOCOL;
    admissionIdentity: string;
    canonicalObserverKey: string;
    launchHandle: string;
    launchAllocationId: string;
    requestedRole: M9b12bInfluenceBearingRole;
    sessionIdentity: string;
    derivedInventoryIdentity: string;
    providerEffectsPermitted: false;
    requiredProviderEffectLedgerProtocol: typeof M9B4_EFFECT_LEDGER_PROTOCOL;
  }>,
) => Promise<Result<void, M9b12fFailure>>;

export type M9b12fAdmissionTestHooks = Readonly<{
  afterCanonicalCaptureBeforeTransaction?: (() => Promise<void>) | undefined;
  beforeTransactionalProofAssessment?: (() => Promise<void>) | undefined;
  afterTransactionalProofAssessment?:
    ((receipt: M9b12bRetiredBoundaryReceipt) => Promise<void>) | undefined;
  transactionFault?: TransactionFault | undefined;
  crashAfterAnchorBeforeEffect?: boolean | undefined;
  crashAfterEffectBeforeTerminal?: boolean | undefined;
}>;

function resolveLaunch(
  state: M9b12fAuthorityState,
  request: M9b12fAdmissionRequest,
  presenterPrincipalId: string,
  nowEpochMs: number,
): Result<z.infer<typeof identityIssuedEventSchema>, M9b12fFailure> {
  const launch = identityEvents(state).find(
    (event) => event.launchHandle === request.launchHandle,
  );
  if (launch === undefined)
    return failure("identity", "Authority-issued launch handle is unknown.");
  if (launch.principalId !== presenterPrincipalId)
    return failure("identity", "presenting-principal-mismatch");
  if (
    launch.launchAllocationId !== request.launchAllocationId ||
    launch.requestedRole !== request.requestedRole ||
    launch.sessionIdentity !== request.sessionIdentity
  )
    return failure(
      "identity",
      "Launch handle allocation, role, or session binding conflicts.",
    );
  if (
    launch.validThroughEpochMs !== null &&
    nowEpochMs > launch.validThroughEpochMs
  )
    return failure("identity", "Authority-issued launch handle is expired.");
  return { ok: true, value: launch };
}

function observerIsQuarantined(
  state: M9b12fAuthorityState,
  observerKey: string,
): boolean {
  return quarantineEvents(state).some(
    (event) => event.observerKey === observerKey,
  );
}

async function quarantineReceipt(
  state: M9b12fAuthorityState,
  request: M9b12fAdmissionRequest,
  observerKey: string,
  reasons: ReadonlyArray<string>,
  assessmentBytesDigest: string,
  proofReceipt: M9b12bRetiredBoundaryReceipt,
): Promise<Result<M9b12fQuarantineReceipt, M9b12fFailure>> {
  const body = quarantineReceiptBodySchema.parse({
    protocol: "lachesis-m9b12f-durable-quarantine-receipt/1",
    decision: "quarantine-reuse-forbidden",
    reasons: [...new Set(reasons)].toSorted(),
    canonicalObserverKey: observerKey,
    launchHandle: request.launchHandle,
    launchAllocationId: request.launchAllocationId,
    requestedRole: request.requestedRole,
    sessionIdentity: request.sessionIdentity,
    derivedInventoryIdentity: request.derivedInventoryIdentity,
    assessmentBytesDigest,
    proofReceipt,
    proofReceiptDigest: proofReceipt.receiptDigest,
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
      protocol: M9B12F_DURABLE_AUTHORITY_PROTOCOL,
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

async function appendAdmissionTerminal(
  authority: M9b12fDurableAuthority,
  admissionIdentity: string,
  startedEventDigest: string,
  admissionState: "completed" | "ambiguous",
): Promise<
  Result<
    Readonly<{ state: M9b12fAuthorityState; eventDigest: string }>,
    M9b12fFailure
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
      protocol: M9B12F_DURABLE_AUTHORITY_PROTOCOL,
      kind: "admission-terminal",
      admissionProtocol: M9B12F_ATOMIC_ADMISSION_PROTOCOL,
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

export async function admitM9b12fRoleStartup(
  authority: M9b12fDurableAuthority,
  presenterContext: unknown,
  value: unknown,
  effect: M9b12fRoleStartupEffect,
  hooks: M9b12fAdmissionTestHooks = {},
): Promise<Result<M9b12fBoundaryReceipt, M9b12fFailure>> {
  const canonicalRequest = canonicalizeJson(value);
  if (!canonicalRequest.ok)
    return failure(
      "authorization",
      "M9b.12f admission request contains hidden or non-JSON runtime state.",
    );
  const capturedRequest = parseJson(canonicalRequest.value);
  if (!capturedRequest.ok)
    return failure("authorization", "M9b.12f canonical request is invalid.");
  const request = admissionRequestSchema.safeParse(capturedRequest.value);
  if (!request.success)
    return failure(
      "authorization",
      "M9b.12f admission request is invalid or contains caller identity fields.",
    );
  const assessmentCanonical = canonicalizeJson(request.data.currentAssessment);
  const assessmentBytesDigest = await digestBody(
    request.data.currentAssessment,
  );
  if (!assessmentCanonical.ok || !assessmentBytesDigest.ok)
    return failure(
      "authorization",
      "M9b.12f assessment input is not strict canonical JSON.",
    );
  await hooks.afterCanonicalCaptureBeforeTransaction?.();

  type TransactionOutcome =
    | Readonly<{
        kind: "quarantine";
        event: z.infer<typeof quarantineEventSchema>;
      }>
    | Readonly<{
        kind: "admission";
        event: z.infer<typeof admissionStartedEventSchema>;
      }>;
  let transactionOutcome: TransactionOutcome | undefined;
  const committed = await commitState(
    authority,
    async (state) => {
      const nowEpochMs = Date.now();
      const presenter = validatePresenterContext(
        authority,
        presenterContext,
        nowEpochMs,
      );
      if (!presenter.ok) return presenter;
      const launch = resolveLaunch(
        state,
        request.data,
        presenter.value.principalId,
        nowEpochMs,
      );
      if (!launch.ok) return launch;
      const wasAlreadyQuarantined = observerIsQuarantined(
        state,
        launch.value.observerKey,
      );
      const parsedAssessment = parseJson(assessmentCanonical.value);
      if (!parsedAssessment.ok)
        return failure(
          "authorization",
          "Captured assessment bytes failed strict transactional parsing.",
        );
      const assessmentPayload = currentAssessmentPayloadSchema.safeParse(
        parsedAssessment.value,
      );
      if (!assessmentPayload.success)
        return failure(
          "authorization",
          "Captured assessment bytes changed before transactional parsing.",
        );
      await hooks.beforeTransactionalProofAssessment?.();
      const proofReceipt = await assessM9b12bRetiredMaterialBoundary({
        ...assessmentPayload.data,
        role: request.data.requestedRole,
        observerIdentity: {
          status: "complete",
          commitment: launch.value.observerKey,
        },
      });
      if (!proofReceipt.ok)
        return failure(
          "authorization",
          "Transactional proof assessment failed closed.",
        );
      await hooks.afterTransactionalProofAssessment?.(proofReceipt.value);
      const proofRequiresQuarantine =
        proofReceipt.value.decision === "quarantine-reuse-forbidden" ||
        proofReceipt.value.reasons.length > 0;
      if (wasAlreadyQuarantined || proofRequiresQuarantine) {
        const reasons = wasAlreadyQuarantined
          ? ["observer-previously-quarantined"]
          : proofReceipt.value.reasons;
        const incident = await digestBody({
          protocol: wasAlreadyQuarantined
            ? "lachesis-m9b12f-prior-quarantine-incident/1"
            : "lachesis-m9b12f-current-assessment-incident/1",
          observerKey: launch.value.observerKey,
          assessmentBytesDigest: assessmentBytesDigest.value,
          proofReceiptDigest: proofReceipt.value.receiptDigest,
          reasons,
          admissionIdentity: request.data.admissionIdentity,
          historyHead: state.headDigest,
        });
        if (!incident.ok) return incident;
        const appended = await appendEvent(state, {
          protocol: M9B12F_DURABLE_AUTHORITY_PROTOCOL,
          kind: "quarantine",
          quarantineProtocol: M9B12F_RETIRED_CORPUS_PROTOCOL,
          observerKey: launch.value.observerKey,
          launchHandle: request.data.launchHandle,
          launchAllocationId: request.data.launchAllocationId,
          requestedRole: request.data.requestedRole,
          affectedRoleIdentities: M9B12B_INFLUENCE_BEARING_ROLES,
          affectedSessionIdentities: [request.data.sessionIdentity],
          affectedDerivedInventoryIdentities: [
            request.data.derivedInventoryIdentity,
          ],
          assessmentCanonicalJson: assessmentCanonical.value,
          assessmentBytesDigest: assessmentBytesDigest.value,
          proofReceipt: proofReceipt.value,
          proofReceiptDigest: proofReceipt.value.receiptDigest,
          incidentReceiptDigest: incident.value,
          quarantineReasons: reasons,
          terminalDecision: "quarantine-reuse-forbidden",
          observerReuseForbidden: true,
          roleSessionStartupPermitted: false,
          providerEffectsPermitted: false,
          derivedInventoryReuseForbidden: true,
        });
        if (!appended.ok) return appended;
        if (appended.value.event.kind !== "quarantine")
          return failure(
            "admission",
            "Quarantine event kind changed during append.",
          );
        transactionOutcome = {
          kind: "quarantine",
          event: appended.value.event,
        };
        return { ok: true, value: appended.value.state };
      }
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
        protocol: M9B12F_DURABLE_AUTHORITY_PROTOCOL,
        kind: "admission-effect-started",
        admissionProtocol: M9B12F_ATOMIC_ADMISSION_PROTOCOL,
        admissionIdentity: request.data.admissionIdentity,
        observerKey: launch.value.observerKey,
        launchHandle: request.data.launchHandle,
        launchAllocationId: request.data.launchAllocationId,
        requestedRole: request.data.requestedRole,
        sessionIdentity: request.data.sessionIdentity,
        derivedInventoryIdentity: request.data.derivedInventoryIdentity,
        assessmentCanonicalJson: assessmentCanonical.value,
        assessmentBytesDigest: assessmentBytesDigest.value,
        proofReceipt: proofReceipt.value,
        proofReceiptDigest: proofReceipt.value.receiptDigest,
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
      transactionOutcome = {
        kind: "admission",
        event: appended.value.event,
      };
      return { ok: true, value: appended.value.state };
    },
    hooks.transactionFault ?? "none",
  );
  if (!committed.ok) return committed;
  if (transactionOutcome === undefined)
    return failure("admission", "Atomic admission outcome was not committed.");
  if (transactionOutcome.kind === "quarantine")
    return quarantineReceipt(
      committed.value,
      request.data,
      transactionOutcome.event.observerKey,
      transactionOutcome.event.quarantineReasons,
      transactionOutcome.event.assessmentBytesDigest,
      transactionOutcome.event.proofReceipt,
    );
  const startedEvent = transactionOutcome.event;
  if (hooks.crashAfterAnchorBeforeEffect)
    return failure(
      "admission",
      "Injected crash after durable admission and before role startup effect.",
    );
  const effectResult = await effect({
    protocol: M9B12F_ATOMIC_ADMISSION_PROTOCOL,
    admissionIdentity: request.data.admissionIdentity,
    canonicalObserverKey: startedEvent.observerKey,
    launchHandle: request.data.launchHandle,
    launchAllocationId: request.data.launchAllocationId,
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
    protocol: "lachesis-m9b12f-atomic-admission-receipt/1",
    decision: "atomic-admission-completed",
    admissionState: "completed",
    admissionIdentity: request.data.admissionIdentity,
    canonicalObserverKey: startedEvent.observerKey,
    launchHandle: request.data.launchHandle,
    launchAllocationId: request.data.launchAllocationId,
    requestedRole: request.data.requestedRole,
    sessionIdentity: request.data.sessionIdentity,
    derivedInventoryIdentity: request.data.derivedInventoryIdentity,
    assessmentBytesDigest: startedEvent.assessmentBytesDigest,
    proofReceipt: startedEvent.proofReceipt,
    proofReceiptDigest: startedEvent.proofReceiptDigest,
    startedEventDigest: startedEvent.eventDigest,
    terminalEventDigest: terminal.value.eventDigest,
    durableHistoryHead: {
      protocol: M9B12F_DURABLE_AUTHORITY_PROTOCOL,
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
