import { canonicalizeJson, digestValue, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  assessM9b12bRetiredMaterialBoundary,
  M9B12B_INFLUENCE_BEARING_ROLES,
  type M9b12bInfluenceBearingRole,
  m9b12bInfluenceBearingRoleSchema,
  type M9b12bPreregistration,
  m9b12bPreregistrationSchema,
  prepareM9b12bPreregistration,
  verifyM9b12bPreregistration,
} from "./m9b12b-preregistration.js";

export const M9B12C_PREREGISTRATION_PROTOCOL = Object.freeze({
  id: "lachesis-m9b12c-offline-preregistration-package",
  version: "1.0.0",
  baselineCommit: "f1f4dae5b681e2237161be5da0d6e4781a15a538",
  baselineTree: "8609e77370ceefaffbd06752f1fc343903839c23",
  visibility: "private-offline-preregistration-correction-only" as const,
  decision: "m9b12c-corrected-package-ready-for-independent-review" as const,
});

export const M9B12C_RETIRED_CORPUS_PROTOCOL = Object.freeze({
  id: "lachesis-m9b12c-retired-corpus-quarantine",
  version: "1.0.0",
  status:
    "prospective-durable-deny-by-default-policy-no-retired-material-accessed" as const,
});

export const M9B12C_QUARANTINE_HISTORY_PROTOCOL =
  "lachesis-m9b12c-append-only-quarantine-history/1" as const;

export const M9B12C_EXTERNAL_REGISTRATION_PROTOCOL =
  "lachesis-m9b12c-append-only-external-registration/1" as const;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const quarantineReasonSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z0-9][a-z0-9:-]*$/u);

export type M9b12cFailure = Readonly<{
  kind: "integrity" | "history" | "authorization";
  message: string;
}>;

function failure(
  kind: M9b12cFailure["kind"],
  message: string,
): Result<never, M9b12cFailure> {
  return { ok: false, error: { kind, message } };
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalizeJson(left);
  const rightBytes = canonicalizeJson(right);
  return leftBytes.ok && rightBytes.ok && leftBytes.value === rightBytes.value;
}

async function digestBody(
  value: unknown,
): Promise<Result<string, M9b12cFailure>> {
  const digest = await digestValue(value);
  return digest.ok
    ? { ok: true, value: digest.value }
    : failure("integrity", "M9b.12c canonical digest failed.");
}

const quarantineHistoryRecordBodySchema = z
  .strictObject({
    protocol: z.literal(M9B12C_QUARANTINE_HISTORY_PROTOCOL),
    sequence: z.number().int().positive(),
    predecessorHeadDigest: digestSchema.nullable(),
    observerCommitment: digestSchema,
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

export const m9b12cQuarantineHistoryRecordSchema =
  quarantineHistoryRecordBodySchema
    .unwrap()
    .safeExtend({ recordDigest: digestSchema })
    .readonly();
export type M9b12cQuarantineHistoryRecord = z.infer<
  typeof m9b12cQuarantineHistoryRecordSchema
>;

export const m9b12cQuarantineHistorySchema = z
  .strictObject({
    protocol: z.literal(M9B12C_QUARANTINE_HISTORY_PROTOCOL),
    revision: z.number().int().nonnegative(),
    headDigest: digestSchema.nullable(),
    records: m9b12cQuarantineHistoryRecordSchema.array().readonly(),
  })
  .readonly();
export type M9b12cQuarantineHistory = z.infer<
  typeof m9b12cQuarantineHistorySchema
>;

function recordBody(
  record: M9b12cQuarantineHistoryRecord,
): z.infer<typeof quarantineHistoryRecordBodySchema> {
  const { recordDigest: ignoredRecordDigest, ...body } = record;
  void ignoredRecordDigest;
  return quarantineHistoryRecordBodySchema.parse(body);
}

export async function validateM9b12cQuarantineHistoryChain(
  value: unknown,
): Promise<Result<M9b12cQuarantineHistory, M9b12cFailure>> {
  const parsed = m9b12cQuarantineHistorySchema.safeParse(value);
  if (!parsed.success)
    return failure("history", "Quarantine history schema is invalid.");
  if (parsed.data.revision !== parsed.data.records.length)
    return failure("history", "Quarantine history revision is truncated.");

  let expectedPredecessor: string | null = null;
  const seenDigests = new Set<string>();
  for (const [index, record] of parsed.data.records.entries()) {
    if (record.sequence !== index + 1)
      return failure("history", "Quarantine history sequence is invalid.");
    if (record.predecessorHeadDigest !== expectedPredecessor)
      return failure("history", "Quarantine history predecessor is invalid.");
    if (
      !canonicalEqual(
        record.affectedRoleIdentities,
        M9B12B_INFLUENCE_BEARING_ROLES,
      )
    )
      return failure("history", "Quarantine history role coverage is invalid.");
    const sortedReasons = [...new Set(record.quarantineReasons)].toSorted();
    if (!canonicalEqual(record.quarantineReasons, sortedReasons))
      return failure("history", "Quarantine history reasons are invalid.");
    const computedDigest = await digestBody(recordBody(record));
    if (!computedDigest.ok) return computedDigest;
    if (computedDigest.value !== record.recordDigest)
      return failure("history", "Quarantine history record digest is invalid.");
    if (seenDigests.has(record.recordDigest))
      return failure("history", "Quarantine history record is duplicated.");
    seenDigests.add(record.recordDigest);
    expectedPredecessor = record.recordDigest;
  }
  if (parsed.data.headDigest !== expectedPredecessor)
    return failure("history", "Quarantine history head is invalid.");
  return { ok: true, value: parsed.data };
}

type QuarantineAuthorityState = Readonly<{
  history: M9b12cQuarantineHistory;
}>;

const authorityBrand: unique symbol = Symbol("M9b12cQuarantineAuthority");
export type M9b12cQuarantineAuthority = Readonly<{
  [authorityBrand]: "M9b12cQuarantineAuthority";
}>;

const repositoryBrand: unique symbol = Symbol("M9b12cQuarantineRepository");
export type M9b12cQuarantineRepository = Readonly<{
  [repositoryBrand]: "M9b12cQuarantineRepository";
}>;

const authorityStates = new WeakMap<
  M9b12cQuarantineAuthority,
  QuarantineAuthorityState
>();
const repositoryAuthorities = new WeakMap<
  M9b12cQuarantineRepository,
  M9b12cQuarantineAuthority
>();

function createRepository(
  authority: M9b12cQuarantineAuthority,
): M9b12cQuarantineRepository {
  const repository: M9b12cQuarantineRepository = Object.freeze({
    [repositoryBrand]: "M9b12cQuarantineRepository",
  });
  repositoryAuthorities.set(repository, authority);
  return repository;
}

export function prepareM9b12cQuarantineRepository(): Readonly<{
  authority: M9b12cQuarantineAuthority;
  repository: M9b12cQuarantineRepository;
}> {
  const authority: M9b12cQuarantineAuthority = Object.freeze({
    [authorityBrand]: "M9b12cQuarantineAuthority",
  });
  authorityStates.set(authority, {
    history: m9b12cQuarantineHistorySchema.parse({
      protocol: M9B12C_QUARANTINE_HISTORY_PROTOCOL,
      revision: 0,
      headDigest: null,
      records: [],
    }),
  });
  return { authority, repository: createRepository(authority) };
}

function repositoryContext(
  repository: M9b12cQuarantineRepository | null,
): Result<
  Readonly<{
    authority: M9b12cQuarantineAuthority;
    state: QuarantineAuthorityState;
  }>,
  M9b12cFailure
> {
  if (repository === null)
    return failure("history", "Trusted quarantine repository is required.");
  const authority = repositoryAuthorities.get(repository);
  if (authority === undefined)
    return failure("history", "Trusted quarantine repository is required.");
  const state = authorityStates.get(authority);
  return state === undefined
    ? failure("history", "Trusted quarantine authority is unavailable.")
    : { ok: true, value: { authority, state } };
}

async function validatedRepositoryContext(
  repository: M9b12cQuarantineRepository | null,
): Promise<
  Result<
    Readonly<{
      authority: M9b12cQuarantineAuthority;
      state: QuarantineAuthorityState;
    }>,
    M9b12cFailure
  >
> {
  const context = repositoryContext(repository);
  if (!context.ok) return context;
  const validated = await validateM9b12cQuarantineHistoryChain(
    context.value.state.history,
  );
  if (!validated.ok) return validated;
  return canonicalEqual(validated.value, context.value.state.history)
    ? context
    : failure("history", "Authoritative quarantine history changed on load.");
}

export async function snapshotM9b12cQuarantineHistory(
  repository: M9b12cQuarantineRepository,
): Promise<Result<M9b12cQuarantineHistory, M9b12cFailure>> {
  const context = await validatedRepositoryContext(repository);
  return context.ok
    ? { ok: true, value: context.value.state.history }
    : context;
}

export async function reloadM9b12cQuarantineRepository(
  authority: M9b12cQuarantineAuthority,
  serializedHistory: unknown,
): Promise<Result<M9b12cQuarantineRepository, M9b12cFailure>> {
  const authoritative = authorityStates.get(authority);
  if (authoritative === undefined)
    return failure("history", "Trusted quarantine authority is unavailable.");
  const candidate =
    await validateM9b12cQuarantineHistoryChain(serializedHistory);
  if (!candidate.ok) return candidate;
  if (
    candidate.value.revision !== authoritative.history.revision ||
    candidate.value.headDigest !== authoritative.history.headDigest ||
    !canonicalEqual(candidate.value, authoritative.history)
  )
    return failure(
      "history",
      "Serialized quarantine history does not match the authoritative head.",
    );
  return { ok: true, value: createRepository(authority) };
}

type QuarantineEventInput = Readonly<{
  observerCommitment: string;
  requestedRole: M9b12bInfluenceBearingRole;
  sessionIdentity: string;
  derivedInventoryIdentity: string;
  incidentReceiptDigest: string;
  quarantineReasons: ReadonlyArray<string>;
}>;

async function appendQuarantineEvent(
  repository: M9b12cQuarantineRepository,
  input: QuarantineEventInput,
): Promise<
  Result<
    Readonly<{
      history: M9b12cQuarantineHistory;
      record: M9b12cQuarantineHistoryRecord;
    }>,
    M9b12cFailure
  >
> {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const context = await validatedRepositoryContext(repository);
    if (!context.ok) return context;
    const before = context.value.state;
    const body = quarantineHistoryRecordBodySchema.parse({
      protocol: M9B12C_QUARANTINE_HISTORY_PROTOCOL,
      sequence: before.history.revision + 1,
      predecessorHeadDigest: before.history.headDigest,
      observerCommitment: input.observerCommitment,
      requestedRole: input.requestedRole,
      affectedRoleIdentities: M9B12B_INFLUENCE_BEARING_ROLES,
      affectedSessionIdentities: [input.sessionIdentity],
      affectedDerivedInventoryIdentities: [input.derivedInventoryIdentity],
      incidentReceiptDigest: input.incidentReceiptDigest,
      quarantineReasons: [...new Set(input.quarantineReasons)].toSorted(),
      terminalDecision: "quarantine-reuse-forbidden",
      observerReuseForbidden: true,
      roleSessionStartupPermitted: false,
      providerEffectsPermitted: false,
      derivedInventoryReuseForbidden: true,
    });
    const recordDigest = await digestBody(body);
    if (!recordDigest.ok) return recordDigest;
    const record = m9b12cQuarantineHistoryRecordSchema.parse({
      ...body,
      recordDigest: recordDigest.value,
    });
    const nextHistory = m9b12cQuarantineHistorySchema.parse({
      protocol: M9B12C_QUARANTINE_HISTORY_PROTOCOL,
      revision: record.sequence,
      headDigest: record.recordDigest,
      records: [...before.history.records, record],
    });
    const current = authorityStates.get(context.value.authority);
    if (current !== before) continue;
    authorityStates.set(context.value.authority, { history: nextHistory });
    return { ok: true, value: { history: nextHistory, record } };
  }
  return failure(
    "history",
    "Quarantine history compare-and-swap contention did not settle.",
  );
}

function observerWasQuarantined(
  history: M9b12cQuarantineHistory,
  observerCommitment: string,
): boolean {
  return history.records.some(
    (record) => record.observerCommitment === observerCommitment,
  );
}

const currentAssessmentBindingSchema = z.object({
  role: m9b12bInfluenceBearingRoleSchema,
  observerIdentity: z.object({ commitment: digestSchema.nullable() }),
});

export const m9b12cAssessmentRequestSchema = z
  .strictObject({
    observerCommitment: digestSchema,
    requestedRole: m9b12bInfluenceBearingRoleSchema,
    sessionIdentity: digestSchema,
    derivedInventoryIdentity: digestSchema,
    currentAssessment: z.unknown(),
  })
  .readonly();
export type M9b12cAssessmentRequest = z.infer<
  typeof m9b12cAssessmentRequestSchema
>;

const historyHeadBindingSchema = z
  .strictObject({
    protocol: z.literal(M9B12C_QUARANTINE_HISTORY_PROTOCOL),
    revision: z.number().int().nonnegative(),
    digest: digestSchema.nullable(),
  })
  .readonly();

const m9b12cReceiptBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b12c-retired-boundary-receipt/1"),
    policyProtocol: z.literal(M9B12C_RETIRED_CORPUS_PROTOCOL.id),
    historyProtocol: z.literal(M9B12C_QUARANTINE_HISTORY_PROTOCOL),
    decision: z.enum([
      "allow-role-start",
      "allow-minimum-opaque-count-commitment",
      "quarantine-reuse-forbidden",
    ]),
    reasons: quarantineReasonSchema.array().readonly(),
    observerCommitment: digestSchema,
    requestedRole: m9b12bInfluenceBearingRoleSchema,
    sessionIdentity: digestSchema,
    derivedInventoryIdentity: digestSchema,
    historyHead: historyHeadBindingSchema,
    observerStatusAtHead: z.enum(["clean", "quarantined"]),
    observerReuseForbidden: z.boolean(),
    roleSessionStartupPermitted: z.boolean(),
    roleSessionQuarantined: z.boolean(),
    allProducedAndDerivedInventoryQuarantined: z.boolean(),
    derivedInventoryReuseForbidden: z.boolean(),
    observerExcludedFromLaterRoles: m9b12bInfluenceBearingRoleSchema
      .array()
      .readonly(),
    affectedRoleIdentities: m9b12bInfluenceBearingRoleSchema.array().readonly(),
    affectedSessionIdentities: digestSchema.array().readonly(),
    affectedDerivedInventoryIdentities: digestSchema.array().readonly(),
    freshRestartRequired: z.boolean(),
    providerDispatchPermittedByReceipt: z.literal(false),
    credentialAccessPermittedByReceipt: z.literal(false),
    effects: z
      .strictObject({
        providerDispatches: z.literal(0),
        credentialAccesses: z.literal(0),
        filesystemAccesses: z.literal(0),
        networkAccesses: z.literal(0),
      })
      .readonly(),
  })
  .readonly();

export const m9b12cRetiredBoundaryReceiptSchema = m9b12cReceiptBodySchema
  .unwrap()
  .safeExtend({ receiptDigest: digestSchema })
  .readonly();
export type M9b12cRetiredBoundaryReceipt = z.infer<
  typeof m9b12cRetiredBoundaryReceiptSchema
>;

async function createM9b12cReceipt(
  request: M9b12cAssessmentRequest,
  history: M9b12cQuarantineHistory,
  decision: M9b12cRetiredBoundaryReceipt["decision"],
  reasons: ReadonlyArray<string>,
): Promise<Result<M9b12cRetiredBoundaryReceipt, M9b12cFailure>> {
  const quarantine = decision === "quarantine-reuse-forbidden";
  const body = m9b12cReceiptBodySchema.parse({
    protocol: "lachesis-m9b12c-retired-boundary-receipt/1",
    policyProtocol: M9B12C_RETIRED_CORPUS_PROTOCOL.id,
    historyProtocol: M9B12C_QUARANTINE_HISTORY_PROTOCOL,
    decision,
    reasons: [...new Set(reasons)].toSorted(),
    observerCommitment: request.observerCommitment,
    requestedRole: request.requestedRole,
    sessionIdentity: request.sessionIdentity,
    derivedInventoryIdentity: request.derivedInventoryIdentity,
    historyHead: {
      protocol: M9B12C_QUARANTINE_HISTORY_PROTOCOL,
      revision: history.revision,
      digest: history.headDigest,
    },
    observerStatusAtHead: quarantine ? "quarantined" : "clean",
    observerReuseForbidden: quarantine,
    roleSessionStartupPermitted: !quarantine,
    roleSessionQuarantined: quarantine,
    allProducedAndDerivedInventoryQuarantined: quarantine,
    derivedInventoryReuseForbidden: quarantine,
    observerExcludedFromLaterRoles: quarantine
      ? M9B12B_INFLUENCE_BEARING_ROLES
      : [],
    affectedRoleIdentities: quarantine ? M9B12B_INFLUENCE_BEARING_ROLES : [],
    affectedSessionIdentities: quarantine ? [request.sessionIdentity] : [],
    affectedDerivedInventoryIdentities: quarantine
      ? [request.derivedInventoryIdentity]
      : [],
    freshRestartRequired: quarantine,
    providerDispatchPermittedByReceipt: false,
    credentialAccessPermittedByReceipt: false,
    effects: {
      providerDispatches: 0,
      credentialAccesses: 0,
      filesystemAccesses: 0,
      networkAccesses: 0,
    },
  });
  const receiptDigest = await digestBody(body);
  return receiptDigest.ok
    ? {
        ok: true,
        value: m9b12cRetiredBoundaryReceiptSchema.parse({
          ...body,
          receiptDigest: receiptDigest.value,
        }),
      }
    : receiptDigest;
}

async function priorQuarantineIncidentDigest(
  request: M9b12cAssessmentRequest,
  history: M9b12cQuarantineHistory,
): Promise<Result<string, M9b12cFailure>> {
  return digestBody({
    protocol: "lachesis-m9b12c-prior-quarantine-rejection-incident/1",
    observerCommitment: request.observerCommitment,
    requestedRole: request.requestedRole,
    sessionIdentity: request.sessionIdentity,
    derivedInventoryIdentity: request.derivedInventoryIdentity,
    authoritativeHistoryRevision: history.revision,
    authoritativeHistoryHeadDigest: history.headDigest,
    reason: "observer-previously-quarantined",
  });
}

async function appendAndCreateQuarantineReceipt(
  repository: M9b12cQuarantineRepository,
  request: M9b12cAssessmentRequest,
  reasons: ReadonlyArray<string>,
  incidentReceiptDigest: string,
): Promise<Result<M9b12cRetiredBoundaryReceipt, M9b12cFailure>> {
  const appended = await appendQuarantineEvent(repository, {
    observerCommitment: request.observerCommitment,
    requestedRole: request.requestedRole,
    sessionIdentity: request.sessionIdentity,
    derivedInventoryIdentity: request.derivedInventoryIdentity,
    incidentReceiptDigest,
    quarantineReasons: reasons,
  });
  return appended.ok
    ? createM9b12cReceipt(
        request,
        appended.value.history,
        "quarantine-reuse-forbidden",
        reasons,
      )
    : appended;
}

async function rejectPreviouslyQuarantinedObserver(
  repository: M9b12cQuarantineRepository,
  request: M9b12cAssessmentRequest,
  history: M9b12cQuarantineHistory,
): Promise<Result<M9b12cRetiredBoundaryReceipt, M9b12cFailure>> {
  const incidentDigest = await priorQuarantineIncidentDigest(request, history);
  return incidentDigest.ok
    ? appendAndCreateQuarantineReceipt(
        repository,
        request,
        ["observer-previously-quarantined"],
        incidentDigest.value,
      )
    : incidentDigest;
}

export async function assessM9b12cRetiredMaterialBoundary(
  repository: M9b12cQuarantineRepository | null,
  value: unknown,
): Promise<Result<M9b12cRetiredBoundaryReceipt, M9b12cFailure>> {
  const request = m9b12cAssessmentRequestSchema.safeParse(value);
  if (!request.success)
    return failure(
      "authorization",
      "M9b.12c assessment request is incomplete; startup is forbidden.",
    );
  if (repository === null)
    return failure("history", "Trusted quarantine repository is required.");
  const initial = await validatedRepositoryContext(repository);
  if (!initial.ok) return initial;
  if (
    observerWasQuarantined(
      initial.value.state.history,
      request.data.observerCommitment,
    )
  )
    return rejectPreviouslyQuarantinedObserver(
      repository,
      request.data,
      initial.value.state.history,
    );

  const current = await assessM9b12bRetiredMaterialBoundary(
    request.data.currentAssessment,
  );
  if (!current.ok)
    return failure(
      "authorization",
      "M9b.12b current assessment could not be evaluated.",
    );
  const reasons = new Set(current.value.reasons);
  const binding = currentAssessmentBindingSchema.safeParse(
    request.data.currentAssessment,
  );
  if (!binding.success) reasons.add("assessment-identity-binding-invalid");
  else {
    if (
      binding.data.observerIdentity.commitment !==
      request.data.observerCommitment
    )
      reasons.add("assessment-observer-binding-mismatch");
    if (binding.data.role !== request.data.requestedRole)
      reasons.add("assessment-role-binding-mismatch");
  }

  if (
    current.value.decision === "quarantine-reuse-forbidden" ||
    reasons.size > 0
  ) {
    const incidentDigest = await digestBody({
      protocol: "lachesis-m9b12c-current-assessment-incident/1",
      m9b12bReceiptDigest: current.value.receiptDigest,
      reasons: [...reasons].toSorted(),
      observerCommitment: request.data.observerCommitment,
      requestedRole: request.data.requestedRole,
      sessionIdentity: request.data.sessionIdentity,
      derivedInventoryIdentity: request.data.derivedInventoryIdentity,
    });
    return incidentDigest.ok
      ? appendAndCreateQuarantineReceipt(
          repository,
          request.data,
          [...reasons],
          incidentDigest.value,
        )
      : incidentDigest;
  }

  const currentHead = await validatedRepositoryContext(repository);
  if (!currentHead.ok) return currentHead;
  if (
    observerWasQuarantined(
      currentHead.value.state.history,
      request.data.observerCommitment,
    )
  )
    return rejectPreviouslyQuarantinedObserver(
      repository,
      request.data,
      currentHead.value.state.history,
    );
  return createM9b12cReceipt(
    request.data,
    currentHead.value.state.history,
    current.value.decision,
    [],
  );
}

function receiptBody(
  receipt: M9b12cRetiredBoundaryReceipt,
): z.infer<typeof m9b12cReceiptBodySchema> {
  const { receiptDigest: ignoredReceiptDigest, ...body } = receipt;
  void ignoredReceiptDigest;
  return m9b12cReceiptBodySchema.parse(body);
}

const authorizationRevalidationSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b12c-startup-revalidation/1"),
    decision: z.enum(["authorization-current", "authorization-rejected"]),
    reason: z
      .enum([
        "observer-previously-quarantined",
        "history-head-changed",
        "receipt-invalid",
        "receipt-not-startup-authorization",
      ])
      .nullable(),
    authoritativeHistoryHead: historyHeadBindingSchema,
    observerReuseForbidden: z.boolean(),
    roleSessionStartupPermitted: z.boolean(),
    providerEffectsPermitted: z.literal(false),
    derivedInventoryReuseForbidden: z.boolean(),
  })
  .readonly();
export type M9b12cAuthorizationRevalidation = z.infer<
  typeof authorizationRevalidationSchema
>;

function rejectedRevalidation(
  history: M9b12cQuarantineHistory,
  reason: Exclude<M9b12cAuthorizationRevalidation["reason"], null>,
): M9b12cAuthorizationRevalidation {
  return authorizationRevalidationSchema.parse({
    protocol: "lachesis-m9b12c-startup-revalidation/1",
    decision: "authorization-rejected",
    reason,
    authoritativeHistoryHead: {
      protocol: M9B12C_QUARANTINE_HISTORY_PROTOCOL,
      revision: history.revision,
      digest: history.headDigest,
    },
    observerReuseForbidden: true,
    roleSessionStartupPermitted: false,
    providerEffectsPermitted: false,
    derivedInventoryReuseForbidden: true,
  });
}

export async function revalidateM9b12cStartupAuthorization(
  repository: M9b12cQuarantineRepository,
  value: unknown,
): Promise<Result<M9b12cAuthorizationRevalidation, M9b12cFailure>> {
  const context = await validatedRepositoryContext(repository);
  if (!context.ok) return context;
  const parsed = m9b12cRetiredBoundaryReceiptSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: true,
      value: rejectedRevalidation(
        context.value.state.history,
        "receipt-invalid",
      ),
    };
  const expectedDigest = await digestBody(receiptBody(parsed.data));
  if (!expectedDigest.ok) return expectedDigest;
  if (expectedDigest.value !== parsed.data.receiptDigest)
    return {
      ok: true,
      value: rejectedRevalidation(
        context.value.state.history,
        "receipt-invalid",
      ),
    };
  if (
    parsed.data.decision === "quarantine-reuse-forbidden" ||
    !parsed.data.roleSessionStartupPermitted
  )
    return {
      ok: true,
      value: rejectedRevalidation(
        context.value.state.history,
        "receipt-not-startup-authorization",
      ),
    };
  if (
    observerWasQuarantined(
      context.value.state.history,
      parsed.data.observerCommitment,
    )
  )
    return {
      ok: true,
      value: rejectedRevalidation(
        context.value.state.history,
        "observer-previously-quarantined",
      ),
    };
  if (
    parsed.data.historyHead.revision !== context.value.state.history.revision ||
    parsed.data.historyHead.digest !== context.value.state.history.headDigest
  )
    return {
      ok: true,
      value: rejectedRevalidation(
        context.value.state.history,
        "history-head-changed",
      ),
    };
  return {
    ok: true,
    value: authorizationRevalidationSchema.parse({
      protocol: "lachesis-m9b12c-startup-revalidation/1",
      decision: "authorization-current",
      reason: null,
      authoritativeHistoryHead: parsed.data.historyHead,
      observerReuseForbidden: false,
      roleSessionStartupPermitted: true,
      providerEffectsPermitted: false,
      derivedInventoryReuseForbidden: false,
    }),
  };
}

const m9b12LineageSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b12-offline-preregistration-package@1.0.0"),
    commit: z.literal("b9f13c7b215624eb651caf3b038b77976247c9a3"),
    tree: z.literal("30144b30de282d63371f9afedeb7d5ac43cfa739"),
    preregistrationDigest: z.literal(
      "f12c1212c4fbaa57190059f4d29ef413d09f9d006489b7b95ae038e426a74ff5",
    ),
    checksumManifestDigest: z.literal(
      "437c7b26238d1f758efcb4ed753662d6da197526b2f1a707b0f0961de5cbd83c",
    ),
    independentReviewDecision: z.literal(
      "independent-preregistration-review-pass-with-narrow-corrections",
    ),
    status: z.literal(
      "superseded-unregistered-retired-corpus-policy-incomplete",
    ),
  })
  .readonly();

const m9b12aLineageSchema = z
  .strictObject({
    protocol: z.literal(
      "lachesis-m9b12a-offline-preregistration-package@1.0.0",
    ),
    commit: z.literal("d8cadc384ec99df8c2c938c9dda2992be15f8272"),
    tree: z.literal("8babde6e603705f2c672afc260157c6fdd02bc88"),
    preregistrationDigest: z.literal(
      "79db2718c94a938431544f8bc72f793c478ed85bff56a2071c3bd03d999c2831",
    ),
    checksumManifestDigest: z.literal(
      "fb98320423322624a42eea328a71d90199b1208b5e5094a999876eca14775298",
    ),
    independentReviewDecision: z.literal("m9b12a-independent-review-no-go"),
    status: z.literal(
      "superseded-unregistered-retired-corpus-enforcement-incomplete",
    ),
  })
  .readonly();

const m9b12bLineageSchema = z
  .strictObject({
    protocol: z.literal(
      "lachesis-m9b12b-offline-preregistration-package@1.0.0",
    ),
    commit: z.literal(M9B12C_PREREGISTRATION_PROTOCOL.baselineCommit),
    tree: z.literal(M9B12C_PREREGISTRATION_PROTOCOL.baselineTree),
    preregistrationDigest: z.literal(
      "52807c052f6e3fab79a943a4e2c6644296823f3b40f49e4452ad40a641a83bd2",
    ),
    checksumManifestDigest: z.literal(
      "ed9d3a0fda5c0bb753f17dcc01370281406ec6bfd4cc157f8927c6d2d892face",
    ),
    independentReviewDecision: z.literal("m9b12b-independent-review-no-go"),
    status: z.literal("superseded-unregistered-quarantine-history-not-durable"),
  })
  .readonly();

const M9B12_LINEAGE = Object.freeze({
  protocol: "lachesis-m9b12-offline-preregistration-package@1.0.0",
  commit: "b9f13c7b215624eb651caf3b038b77976247c9a3",
  tree: "30144b30de282d63371f9afedeb7d5ac43cfa739",
  preregistrationDigest:
    "f12c1212c4fbaa57190059f4d29ef413d09f9d006489b7b95ae038e426a74ff5",
  checksumManifestDigest:
    "437c7b26238d1f758efcb4ed753662d6da197526b2f1a707b0f0961de5cbd83c",
  independentReviewDecision:
    "independent-preregistration-review-pass-with-narrow-corrections",
  status: "superseded-unregistered-retired-corpus-policy-incomplete",
});

const M9B12A_LINEAGE = Object.freeze({
  protocol: "lachesis-m9b12a-offline-preregistration-package@1.0.0",
  commit: "d8cadc384ec99df8c2c938c9dda2992be15f8272",
  tree: "8babde6e603705f2c672afc260157c6fdd02bc88",
  preregistrationDigest:
    "79db2718c94a938431544f8bc72f793c478ed85bff56a2071c3bd03d999c2831",
  checksumManifestDigest:
    "fb98320423322624a42eea328a71d90199b1208b5e5094a999876eca14775298",
  independentReviewDecision: "m9b12a-independent-review-no-go",
  status: "superseded-unregistered-retired-corpus-enforcement-incomplete",
});

const M9B12B_LINEAGE = Object.freeze({
  protocol: "lachesis-m9b12b-offline-preregistration-package@1.0.0",
  commit: M9B12C_PREREGISTRATION_PROTOCOL.baselineCommit,
  tree: M9B12C_PREREGISTRATION_PROTOCOL.baselineTree,
  preregistrationDigest:
    "52807c052f6e3fab79a943a4e2c6644296823f3b40f49e4452ad40a641a83bd2",
  checksumManifestDigest:
    "ed9d3a0fda5c0bb753f17dcc01370281406ec6bfd4cc157f8927c6d2d892face",
  independentReviewDecision: "m9b12b-independent-review-no-go",
  status: "superseded-unregistered-quarantine-history-not-durable",
});

export const m9b12cExternalRegistrationFormatSchema = z
  .strictObject({
    protocol: z.literal(M9B12C_EXTERNAL_REGISTRATION_PROTOCOL),
    status: z.literal("format-only-no-record-present"),
    requiredFields: z
      .tuple([
        z.literal("registration-service"),
        z.literal("registration-record-id"),
        z.literal("server-registered-at"),
        z.literal("corrected-preregistration-digest"),
        z.literal("superseded-m9b12b-preregistration-digest"),
        z.literal("superseded-m9b12a-preregistration-digest"),
        z.literal("superseded-m9b12-preregistration-digest"),
        z.literal("source-commit"),
        z.literal("source-tree"),
        z.literal("checksum-manifest-digest"),
        z.literal("submitted-attachment-inventory-and-sha256"),
        z.literal("registrant-attestation"),
      ])
      .readonly(),
    supersessionLineage: z
      .tuple([m9b12LineageSchema, m9b12aLineageSchema, m9b12bLineageSchema])
      .readonly(),
    sourceBinding: z
      .strictObject({
        baselineCommit: z.literal(
          M9B12C_PREREGISTRATION_PROTOCOL.baselineCommit,
        ),
        baselineTree: z.literal(M9B12C_PREREGISTRATION_PROTOCOL.baselineTree),
        sourceCommit: z.null(),
        sourceTree: z.null(),
        procedure: z.literal(
          "external-record-binds-reviewed-source-commit-and-tree-after-independent-review",
        ),
      })
      .readonly(),
    correctedPreregistrationDigestRule: z.literal(
      "registration-value-must-equal-canonical-submitted-m9b12c-preregistration-digest",
    ),
    checksumManifestDigestRule: z.literal(
      "registration-value-must-equal-sha256-of-submitted-checksum-manifest",
    ),
    attachmentInventoryRule: z.literal(
      "registration-value-must-list-every-submitted-relative-path-and-sha256-in-manifest-order",
    ),
    amendmentRule: z.literal(
      "append-only-new-identity-no-reinterpretation-of-any-lineage-artifact",
    ),
    registrationRecord: z.null(),
    submissionAuthorized: z.literal(false),
  })
  .readonly();
export type M9b12cExternalRegistrationFormat = z.infer<
  typeof m9b12cExternalRegistrationFormatSchema
>;

export function createM9b12cExternalRegistrationFormat(): M9b12cExternalRegistrationFormat {
  return m9b12cExternalRegistrationFormatSchema.parse({
    protocol: M9B12C_EXTERNAL_REGISTRATION_PROTOCOL,
    status: "format-only-no-record-present",
    requiredFields: [
      "registration-service",
      "registration-record-id",
      "server-registered-at",
      "corrected-preregistration-digest",
      "superseded-m9b12b-preregistration-digest",
      "superseded-m9b12a-preregistration-digest",
      "superseded-m9b12-preregistration-digest",
      "source-commit",
      "source-tree",
      "checksum-manifest-digest",
      "submitted-attachment-inventory-and-sha256",
      "registrant-attestation",
    ],
    supersessionLineage: [M9B12_LINEAGE, M9B12A_LINEAGE, M9B12B_LINEAGE],
    sourceBinding: {
      baselineCommit: M9B12C_PREREGISTRATION_PROTOCOL.baselineCommit,
      baselineTree: M9B12C_PREREGISTRATION_PROTOCOL.baselineTree,
      sourceCommit: null,
      sourceTree: null,
      procedure:
        "external-record-binds-reviewed-source-commit-and-tree-after-independent-review",
    },
    correctedPreregistrationDigestRule:
      "registration-value-must-equal-canonical-submitted-m9b12c-preregistration-digest",
    checksumManifestDigestRule:
      "registration-value-must-equal-sha256-of-submitted-checksum-manifest",
    attachmentInventoryRule:
      "registration-value-must-list-every-submitted-relative-path-and-sha256-in-manifest-order",
    amendmentRule:
      "append-only-new-identity-no-reinterpretation-of-any-lineage-artifact",
    registrationRecord: null,
    submissionAuthorized: false,
  });
}

export const m9b12cQuarantineHistoryFormatSchema = z
  .strictObject({
    protocol: z.literal(M9B12C_QUARANTINE_HISTORY_PROTOCOL),
    status: z.literal("format-only-empty-authoritative-history"),
    trustBoundary: z.literal(
      "opaque-authority-owned-history-never-caller-supplied-to-assessment",
    ),
    appendSemantics: z.literal(
      "monotonic-compare-and-swap-no-removal-override-expiration-replacement-rehabilitation-or-clean-reset",
    ),
    loadValidation: z.literal(
      "validate-complete-chain-and-match-trusted-authoritative-revision-and-head",
    ),
    startupRevalidation: z.literal(
      "exact-receipt-head-must-equal-current-authoritative-head-and-observer-must-remain-clean",
    ),
    recordFields: z
      .tuple([
        z.literal("protocol"),
        z.literal("sequence"),
        z.literal("predecessor-head-digest"),
        z.literal("observer-commitment"),
        z.literal("requested-role"),
        z.literal("affected-role-identities"),
        z.literal("affected-session-identities"),
        z.literal("affected-derived-inventory-identities"),
        z.literal("incident-receipt-digest"),
        z.literal("quarantine-reasons"),
        z.literal("terminal-decision"),
        z.literal("observer-reuse-forbidden"),
        z.literal("role-session-startup-permitted"),
        z.literal("provider-effects-permitted"),
        z.literal("derived-inventory-reuse-forbidden"),
        z.literal("record-digest"),
      ])
      .readonly(),
    initialRevision: z.literal(0),
    initialHeadDigest: z.null(),
    liveHistoryPresent: z.literal(false),
  })
  .readonly();
export type M9b12cQuarantineHistoryFormat = z.infer<
  typeof m9b12cQuarantineHistoryFormatSchema
>;

export function createM9b12cQuarantineHistoryFormat(): M9b12cQuarantineHistoryFormat {
  return m9b12cQuarantineHistoryFormatSchema.parse({
    protocol: M9B12C_QUARANTINE_HISTORY_PROTOCOL,
    status: "format-only-empty-authoritative-history",
    trustBoundary:
      "opaque-authority-owned-history-never-caller-supplied-to-assessment",
    appendSemantics:
      "monotonic-compare-and-swap-no-removal-override-expiration-replacement-rehabilitation-or-clean-reset",
    loadValidation:
      "validate-complete-chain-and-match-trusted-authoritative-revision-and-head",
    startupRevalidation:
      "exact-receipt-head-must-equal-current-authoritative-head-and-observer-must-remain-clean",
    recordFields: [
      "protocol",
      "sequence",
      "predecessor-head-digest",
      "observer-commitment",
      "requested-role",
      "affected-role-identities",
      "affected-session-identities",
      "affected-derived-inventory-identities",
      "incident-receipt-digest",
      "quarantine-reasons",
      "terminal-decision",
      "observer-reuse-forbidden",
      "role-session-startup-permitted",
      "provider-effects-permitted",
      "derived-inventory-reuse-forbidden",
      "record-digest",
    ],
    initialRevision: 0,
    initialHeadDigest: null,
    liveHistoryPresent: false,
  });
}

const originalShape = m9b12bPreregistrationSchema.unwrap().shape;
const preservedM9b12bFieldsSchema = m9b12bPreregistrationSchema.unwrap().omit({
  protocol: true,
  version: true,
  baselineCommit: true,
  baselineTree: true,
  status: true,
  supersession: true,
  corpusConstruction: true,
  retiredCorpusPolicy: true,
  futureAuthorizations: true,
  externalRegistrationFormat: true,
  correctionAudit: true,
  decision: true,
  preregistrationDigest: true,
});

const supersessionSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b12c-linear-supersession/1"),
    ordering: z
      .tuple([
        z.literal("lachesis-m9b12-offline-preregistration-package@1.0.0"),
        z.literal("lachesis-m9b12a-offline-preregistration-package@1.0.0"),
        z.literal("lachesis-m9b12b-offline-preregistration-package@1.0.0"),
        z.literal("lachesis-m9b12c-offline-preregistration-package@1.0.0"),
      ])
      .readonly(),
    predecessors: z
      .tuple([m9b12LineageSchema, m9b12aLineageSchema, m9b12bLineageSchema])
      .readonly(),
    predecessorBytesModified: z.literal(false),
    predecessorExternallyRegistered: z.literal(false),
    correctionScope: z.literal(
      "durable-quarantine-history-atomic-revalidation-supersession-registration-and-tests-only",
    ),
  })
  .readonly();

const correctedRetiredCorpusPolicySchema = originalShape.retiredCorpusPolicy
  .unwrap()
  .extend({
    protocol: z.literal(M9B12C_RETIRED_CORPUS_PROTOCOL.id),
    version: z.literal(M9B12C_RETIRED_CORPUS_PROTOCOL.version),
    status: z.literal(M9B12C_RETIRED_CORPUS_PROTOCOL.status),
    decisionRule: z.literal(
      "allow-only-when-current-proofs-are-complete-and-affirmative-and-authoritative-history-confirms-observer-clean-at-bound-head",
    ),
    quarantineHistoryProtocol: z.literal(M9B12C_QUARANTINE_HISTORY_PROTOCOL),
    authoritativeHistoryRequired: z.literal(true),
    callerSelectedHistoryForbidden: z.literal(true),
    quarantinePermanentAndMonotonic: z.literal(true),
    compareAndSwapAppendRequired: z.literal(true),
    startupHeadRevalidationRequired: z.literal(true),
  })
  .readonly();

const correctedCorpusConstructionSchema = originalShape.corpusConstruction
  .unwrap()
  .extend({
    retiredCorpusPolicy: z.literal(M9B12C_RETIRED_CORPUS_PROTOCOL.id),
    retiredAccessBehavior: z.literal(
      "deny-by-default-with-authoritative-durable-history-and-stale-authorization-revalidation",
    ),
  })
  .readonly();

const quarantineHistoryPolicySchema = z
  .strictObject({
    protocol: z.literal(M9B12C_QUARANTINE_HISTORY_PROTOCOL),
    format: m9b12cQuarantineHistoryFormatSchema,
    authoritativeRepositoryOpaque: z.literal(true),
    assessmentQueriesRepositoryDirectly: z.literal(true),
    callerMaySupplyHistory: z.literal(false),
    completeChainValidatedOnLoadAndUse: z.literal(true),
    trustedRevisionAndHeadMatchRequiredOnReload: z.literal(true),
    appendBeforeTerminalQuarantineReceipt: z.literal(true),
    cleanReceiptBindsExactHead: z.literal(true),
    compareAndSwapRequired: z.literal(true),
    staleAuthorizationFailsClosed: z.literal(true),
    removalOverrideExpirationReplacementRehabilitationOrCleanReset:
      z.literal(false),
    liveHistoryPresent: z.literal(false),
  })
  .readonly();

function correctedFutureAuthorizations(): M9b12bPreregistration["futureAuthorizations"] {
  return originalShape.futureAuthorizations.parse({
    issued: false,
    texts: [
      {
        kind: "external-preregistration",
        text: "Authorize submission of the exact checksum-bound M9b.12c preregistration package to the named external registry and no other action.",
        prerequisites:
          "Independent review accepts the M9b.12c digest, complete linear supersession, durable quarantine history, atomic stale-decision protection, one canonical registration contract, and exact checksum manifest.",
        grantsOnly:
          "One append-only external registration submission; no corpus, project, credential, count, inference, or campaign action.",
      },
      {
        kind: "corpus-materialization",
        text: "Authorize isolated construction and materialization under the registered corpus and M9b.12c durable retired-material protocols only.",
        prerequisites:
          "External registration is independently verified and every required role, history, isolation, ancestry, and noninterference proof is complete and affirmative.",
        grantsOnly:
          "Fresh corpus, gold, and split-audit production; no provider, credential, count, inference, probe, or primary execution.",
      },
      {
        kind: "provider-cap-and-credential-activation",
        text: "Authorize activation of one fresh zero-spend dedicated project, verified 500 USD cap, and project-scoped credential custody.",
        prerequisites:
          "Corpus, durable retired-material history, evaluator, schedule, environment, security, and disclosure reviews pass with immutable identities.",
        grantsOnly:
          "Cap and credential activation plus preflight; no count or inference dispatch.",
      },
      {
        kind: "count-only-pricing-probe",
        text: "Authorize the frozen four-request maximum count-only operational pricing probe.",
        prerequisites:
          "Cap, credential, zero-spend, accounting, persistence, durable deny-by-default retired-material, and response-shape preflights pass.",
        grantsOnly:
          "At most one count request per frozen class, zero inference, zero retries, concurrency one.",
      },
      {
        kind: "twenty-four-pair-protocol-probe",
        text: "Authorize execution of the exact frozen 24-pair protocol-probe inventory and schedule.",
        prerequisites:
          "Count-only reconciliation and durable retired-material noninterference pass every frozen gate and a separate review accepts the bound probe inventory.",
        grantsOnly:
          "The complete 24-pair probe; no primary execution or population change.",
      },
      {
        kind: "conditional-168-pair-primary-execution",
        text: "Authorize the exact frozen 168-pair primary inventory and schedule only if the registered probe gate passed.",
        prerequisites:
          "Verified complete probe measurements pass and all safety, durable retired-material, accounting, pricing, replay, authorization, and capacity gates remain satisfied.",
        grantsOnly:
          "The complete immutable 168-pair primary study; no subset, replacement, retry, or protocol amendment.",
      },
      {
        kind: "final-closure-and-credential-revocation",
        text: "Authorize final replay, analysis, accounting and security closure, credential revocation, and independent absence verification.",
        prerequisites:
          "All authorized study effects and durable retired-material incidents are terminally accounted and no further provider dispatch is permitted.",
        grantsOnly:
          "Closure and revocation actions; no new count, inference, corpus, analysis-population, publication, or quarantine-override authority.",
      },
    ],
  });
}

const correctionAuditSchema = z
  .strictObject({
    reviewDecisionAddressed: z.literal("m9b12b-independent-review-no-go"),
    durableAuthoritativeHistoryImplemented: z.literal(true),
    callerSelectedHistoryImpossible: z.literal(true),
    priorQuarantineRejectsCleanRetry: z.literal(true),
    crossRoleSessionAndInventoryRetryRejects: z.literal(true),
    serializedReloadValidatedAgainstTrustedHead: z.literal(true),
    tamperTruncationReorderDuplicateAndForkReject: z.literal(true),
    compareAndSwapAppendImplemented: z.literal(true),
    staleCleanReceiptRevalidationFailsClosed: z.literal(true),
    fullPerRoleTerminalAssertionsRequired: z.literal(true),
    m9b12BytesModified: z.literal(false),
    m9b12aBytesModified: z.literal(false),
    m9b12bBytesModified: z.literal(false),
    scientificProtocolUnchanged: z.literal(true),
    financialProtocolUnchanged: z.literal(true),
    retiredMaterialAccessed: z.literal(false),
    providerEffects: z.literal(0),
    credentialEffects: z.literal(0),
    networkEffects: z.literal(0),
  })
  .readonly();

const m9b12cBodySchema = preservedM9b12bFieldsSchema
  .safeExtend({
    protocol: z.literal(M9B12C_PREREGISTRATION_PROTOCOL.id),
    version: z.literal(M9B12C_PREREGISTRATION_PROTOCOL.version),
    baselineCommit: z.literal(M9B12C_PREREGISTRATION_PROTOCOL.baselineCommit),
    baselineTree: z.literal(M9B12C_PREREGISTRATION_PROTOCOL.baselineTree),
    status: z.literal(
      "offline-immutable-superseding-draft-not-externally-registered",
    ),
    supersession: supersessionSchema,
    corpusConstruction: correctedCorpusConstructionSchema,
    retiredCorpusPolicy: correctedRetiredCorpusPolicySchema,
    quarantineHistory: quarantineHistoryPolicySchema,
    futureAuthorizations: originalShape.futureAuthorizations,
    externalRegistrationFormat: m9b12cExternalRegistrationFormatSchema,
    correctionAudit: correctionAuditSchema,
    decision: z.literal(M9B12C_PREREGISTRATION_PROTOCOL.decision),
  })
  .readonly();

export const m9b12cPreregistrationSchema = m9b12cBodySchema
  .unwrap()
  .safeExtend({ preregistrationDigest: digestSchema })
  .readonly();
export type M9b12cPreregistration = z.infer<typeof m9b12cPreregistrationSchema>;

function withoutReplacedFields(
  original: M9b12bPreregistration,
): z.infer<typeof preservedM9b12bFieldsSchema> {
  const {
    protocol: ignoredProtocol,
    version: ignoredVersion,
    baselineCommit: ignoredBaselineCommit,
    baselineTree: ignoredBaselineTree,
    status: ignoredStatus,
    supersession: ignoredSupersession,
    corpusConstruction: ignoredCorpusConstruction,
    retiredCorpusPolicy: ignoredRetiredCorpusPolicy,
    futureAuthorizations: ignoredFutureAuthorizations,
    externalRegistrationFormat: ignoredExternalRegistrationFormat,
    correctionAudit: ignoredCorrectionAudit,
    decision: ignoredDecision,
    preregistrationDigest: ignoredPreregistrationDigest,
    ...preserved
  } = original;
  void ignoredProtocol;
  void ignoredVersion;
  void ignoredBaselineCommit;
  void ignoredBaselineTree;
  void ignoredStatus;
  void ignoredSupersession;
  void ignoredCorpusConstruction;
  void ignoredRetiredCorpusPolicy;
  void ignoredFutureAuthorizations;
  void ignoredExternalRegistrationFormat;
  void ignoredCorrectionAudit;
  void ignoredDecision;
  void ignoredPreregistrationDigest;
  const parsed = preservedM9b12bFieldsSchema.safeParse(preserved);
  if (!parsed.success)
    throw new Error(
      `M9b.12b preserved fields changed: ${parsed.error.message}`,
    );
  return parsed.data;
}

async function deriveM9b12cPreregistration(): Promise<
  Result<M9b12cPreregistration, M9b12cFailure>
> {
  const predecessor = await prepareM9b12bPreregistration();
  if (!predecessor.ok)
    return failure("integrity", "M9b.12b package could not rederive.");
  const verified = await verifyM9b12bPreregistration(
    predecessor.value.token,
    predecessor.value.preregistration,
  );
  if (
    !verified.ok ||
    verified.value.preregistrationDigest !==
      M9B12B_LINEAGE.preregistrationDigest
  )
    return failure("integrity", "M9b.12b identity changed.");
  const retiredCorpusPolicy = correctedRetiredCorpusPolicySchema.parse({
    ...verified.value.retiredCorpusPolicy,
    protocol: M9B12C_RETIRED_CORPUS_PROTOCOL.id,
    version: M9B12C_RETIRED_CORPUS_PROTOCOL.version,
    status: M9B12C_RETIRED_CORPUS_PROTOCOL.status,
    decisionRule:
      "allow-only-when-current-proofs-are-complete-and-affirmative-and-authoritative-history-confirms-observer-clean-at-bound-head",
    quarantineHistoryProtocol: M9B12C_QUARANTINE_HISTORY_PROTOCOL,
    authoritativeHistoryRequired: true,
    callerSelectedHistoryForbidden: true,
    quarantinePermanentAndMonotonic: true,
    compareAndSwapAppendRequired: true,
    startupHeadRevalidationRequired: true,
  });
  const body = m9b12cBodySchema.parse({
    ...withoutReplacedFields(verified.value),
    protocol: M9B12C_PREREGISTRATION_PROTOCOL.id,
    version: M9B12C_PREREGISTRATION_PROTOCOL.version,
    baselineCommit: M9B12C_PREREGISTRATION_PROTOCOL.baselineCommit,
    baselineTree: M9B12C_PREREGISTRATION_PROTOCOL.baselineTree,
    status: "offline-immutable-superseding-draft-not-externally-registered",
    supersession: {
      protocol: "lachesis-m9b12c-linear-supersession/1",
      ordering: [
        M9B12_LINEAGE.protocol,
        M9B12A_LINEAGE.protocol,
        M9B12B_LINEAGE.protocol,
        "lachesis-m9b12c-offline-preregistration-package@1.0.0",
      ],
      predecessors: [M9B12_LINEAGE, M9B12A_LINEAGE, M9B12B_LINEAGE],
      predecessorBytesModified: false,
      predecessorExternallyRegistered: false,
      correctionScope:
        "durable-quarantine-history-atomic-revalidation-supersession-registration-and-tests-only",
    },
    corpusConstruction: {
      ...verified.value.corpusConstruction,
      retiredCorpusPolicy: M9B12C_RETIRED_CORPUS_PROTOCOL.id,
      retiredAccessBehavior:
        "deny-by-default-with-authoritative-durable-history-and-stale-authorization-revalidation",
    },
    retiredCorpusPolicy,
    quarantineHistory: {
      protocol: M9B12C_QUARANTINE_HISTORY_PROTOCOL,
      format: createM9b12cQuarantineHistoryFormat(),
      authoritativeRepositoryOpaque: true,
      assessmentQueriesRepositoryDirectly: true,
      callerMaySupplyHistory: false,
      completeChainValidatedOnLoadAndUse: true,
      trustedRevisionAndHeadMatchRequiredOnReload: true,
      appendBeforeTerminalQuarantineReceipt: true,
      cleanReceiptBindsExactHead: true,
      compareAndSwapRequired: true,
      staleAuthorizationFailsClosed: true,
      removalOverrideExpirationReplacementRehabilitationOrCleanReset: false,
      liveHistoryPresent: false,
    },
    futureAuthorizations: correctedFutureAuthorizations(),
    externalRegistrationFormat: createM9b12cExternalRegistrationFormat(),
    correctionAudit: {
      reviewDecisionAddressed: "m9b12b-independent-review-no-go",
      durableAuthoritativeHistoryImplemented: true,
      callerSelectedHistoryImpossible: true,
      priorQuarantineRejectsCleanRetry: true,
      crossRoleSessionAndInventoryRetryRejects: true,
      serializedReloadValidatedAgainstTrustedHead: true,
      tamperTruncationReorderDuplicateAndForkReject: true,
      compareAndSwapAppendImplemented: true,
      staleCleanReceiptRevalidationFailsClosed: true,
      fullPerRoleTerminalAssertionsRequired: true,
      m9b12BytesModified: false,
      m9b12aBytesModified: false,
      m9b12bBytesModified: false,
      scientificProtocolUnchanged: true,
      financialProtocolUnchanged: true,
      retiredMaterialAccessed: false,
      providerEffects: 0,
      credentialEffects: 0,
      networkEffects: 0,
    },
    decision: M9B12C_PREREGISTRATION_PROTOCOL.decision,
  });
  const preregistrationDigest = await digestBody(body);
  return preregistrationDigest.ok
    ? {
        ok: true,
        value: m9b12cPreregistrationSchema.parse({
          ...body,
          preregistrationDigest: preregistrationDigest.value,
        }),
      }
    : preregistrationDigest;
}

const packageTokenBrand: unique symbol = Symbol("M9b12cPreregistrationToken");
export type M9b12cPreregistrationToken = Readonly<{
  [packageTokenBrand]: "M9b12cPreregistrationToken";
}>;
const trustedPackages = new WeakMap<
  M9b12cPreregistrationToken,
  M9b12cPreregistration
>();

export async function prepareM9b12cPreregistration(): Promise<
  Result<
    Readonly<{
      token: M9b12cPreregistrationToken;
      preregistration: M9b12cPreregistration;
    }>,
    M9b12cFailure
  >
> {
  const preregistration = await deriveM9b12cPreregistration();
  if (!preregistration.ok) return preregistration;
  const token: M9b12cPreregistrationToken = Object.freeze({
    [packageTokenBrand]: "M9b12cPreregistrationToken",
  });
  trustedPackages.set(token, preregistration.value);
  return {
    ok: true,
    value: { token, preregistration: preregistration.value },
  };
}

export async function verifyM9b12cPreregistration(
  token: M9b12cPreregistrationToken,
  value: unknown,
): Promise<Result<M9b12cPreregistration, M9b12cFailure>> {
  const trusted = trustedPackages.get(token);
  const parsed = m9b12cPreregistrationSchema.safeParse(value);
  const rederived = await deriveM9b12cPreregistration();
  if (
    trusted === undefined ||
    !parsed.success ||
    !rederived.ok ||
    !canonicalEqual(trusted, parsed.data) ||
    !canonicalEqual(rederived.value, parsed.data)
  )
    return failure("integrity", "M9b.12c preregistration package changed.");
  return { ok: true, value: parsed.data };
}
