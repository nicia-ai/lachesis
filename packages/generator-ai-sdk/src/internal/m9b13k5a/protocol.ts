import { createHash } from "node:crypto";

import { canonicalizeJson, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

export const M9B13K5A_PROTOCOL =
  "lachesis-m9b13k5a-corrected-controller-integration-design/1" as const;
export const M9B13K5A_EVENT_PROTOCOL =
  "lachesis-m9b13k5a-controller-event-payload/1" as const;
export const M9B13K5A_NATIVE_RECEIPT_PROTOCOL =
  "lachesis-m9b13k5a-accepted-native-ledger-receipt/1" as const;
export const M9B13K5A_RETAINED_RECEIPT_PROTOCOL =
  "lachesis-m9b13k5a-authenticated-retained-receipt/1" as const;
export const M9B13K5A_ACTIVATION_PROTOCOL =
  "lachesis-m9b13k5a-structural-activation/1" as const;
export const M9B13K5A_CUSTODIAN_PROTOCOL =
  "lachesis-m9b13k5a-custodian-receipt/1" as const;

export const M9B13K5A_ACCEPTED_LEDGER_IMPLEMENTATION_IDENTITY =
  "cf35bd5756e8397ed9fa010e356ac30787ef69ba19ab13a7c057eac0f32d9ceb" as const;
export const M9B13K5A_COMPARATOR_PROTOCOL =
  "lachesis-m9b13k4c-source-build-bound-ledger-identity/4" as const;
export const M9B13K5A_PROJECT_ID = "bmsda" as const;
export const M9B13K5A_DRAFT_ID = "6a7619b506a607fe5f63a77d" as const;
export const M9B13K5A_PROVIDER = "osfstorage" as const;
export const M9B13K5A_FILENAME =
  "m9b13k5-offline-controller-integration-proof.txt" as const;
export const M9B13K5A_LEDGER_PAYLOAD_LIMIT = 65_536 as const;
export const M9B13K5A_CONTROLLER_DURATION_MS = 120_000 as const;
export const M9B13K5A_REVOCATION_DURATION_MS = 15_000 as const;

const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .readonly();
const identitySchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:/-]+$/u)
  .readonly();
const nonnegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();

export type M9b13k5aFailure = Readonly<{
  kind: "m9b13k5a";
  reason: string;
  ambiguous: boolean;
}>;

export function m9b13k5aFailure(
  reason: string,
  ambiguous = false,
): Result<never, M9b13k5aFailure> {
  return { ok: false, error: { kind: "m9b13k5a", reason, ambiguous } };
}

export function m9b13k5aSha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function m9b13k5aCanonicalDigest(
  value: unknown,
): Result<string, M9b13k5aFailure> {
  const canonical = canonicalizeJson(value);
  return canonical.ok
    ? { ok: true, value: m9b13k5aSha256(canonical.value) }
    : m9b13k5aFailure("m9b13k5a-canonicalization-failed");
}

export const M9B13K5A_OPERATION_SPECS = [
  {
    operation: "token-detail",
    phase: "pre-upload",
    method: "GET",
    minimumPages: 1,
    maximumPages: 1,
  },
  {
    operation: "project",
    phase: "pre-upload",
    method: "GET",
    minimumPages: 1,
    maximumPages: 1,
  },
  {
    operation: "registration-inventory",
    phase: "pre-upload",
    method: "GET",
    minimumPages: 1,
    maximumPages: 2,
  },
  {
    operation: "view-only-link-inventory",
    phase: "pre-upload",
    method: "GET",
    minimumPages: 1,
    maximumPages: 2,
  },
  {
    operation: "pre-upload-file-inventory",
    phase: "pre-upload",
    method: "GET",
    minimumPages: 1,
    maximumPages: 4,
  },
  {
    operation: "provider-root",
    phase: "pre-upload",
    method: "GET",
    minimumPages: 1,
    maximumPages: 1,
  },
  {
    operation: "canary-put",
    phase: "upload",
    method: "PUT",
    minimumPages: 1,
    maximumPages: 1,
  },
  {
    operation: "post-upload-file-inventory",
    phase: "post-upload",
    method: "GET",
    minimumPages: 1,
    maximumPages: 4,
  },
  {
    operation: "canary-download",
    phase: "post-upload",
    method: "GET",
    minimumPages: 1,
    maximumPages: 1,
  },
  {
    operation: "pat-revocation",
    phase: "revocation",
    method: "DELETE",
    minimumPages: 1,
    maximumPages: 1,
  },
] as const;

export type M9b13k5aOperation =
  (typeof M9B13K5A_OPERATION_SPECS)[number]["operation"];
export const M9B13K5A_OPERATIONS = M9B13K5A_OPERATION_SPECS.map(
  (specification) => specification.operation,
);
export const m9b13k5aOperationSchema = z.enum(M9B13K5A_OPERATIONS);

export const M9B13K5A_SHORTEST_REQUEST_COUNT = M9B13K5A_OPERATION_SPECS.reduce(
  (total, specification) => total + specification.minimumPages,
  0,
);
export const M9B13K5A_LONGEST_REQUEST_COUNT = M9B13K5A_OPERATION_SPECS.reduce(
  (total, specification) => total + specification.maximumPages,
  0,
);

export type M9b13k5aRequestSlot = Readonly<{
  operation: M9b13k5aOperation;
  page: number;
  requestNumber: number;
}>;

export function deriveM9b13k5aRequestPath(
  pageCounts: Readonly<Record<M9b13k5aOperation, number>>,
): Result<ReadonlyArray<M9b13k5aRequestSlot>, M9b13k5aFailure> {
  const path: Array<M9b13k5aRequestSlot> = [];
  for (const specification of M9B13K5A_OPERATION_SPECS) {
    const count = pageCounts[specification.operation];
    if (
      !Number.isInteger(count) ||
      count < specification.minimumPages ||
      count > specification.maximumPages
    )
      return m9b13k5aFailure("m9b13k5a-page-count-invalid");
    for (let page = 1; page <= count; page++)
      path.push({
        operation: specification.operation,
        page,
        requestNumber: path.length + 1,
      });
  }
  return { ok: true, value: path };
}

export const m9b13k5aActivationSchema = z
  .strictObject({
    protocol: z.literal(M9B13K5A_ACTIVATION_PROTOCOL),
    activationIdentity: sha256Schema,
    runIdentity: identitySchema,
    sessionIdentity: identitySchema,
    requestPlanIdentity: sha256Schema,
    patCommitment: sha256Schema,
    ledgerImplementationIdentity: z.literal(
      M9B13K5A_ACCEPTED_LEDGER_IMPLEMENTATION_IDENTITY,
    ),
    ledgerNamespaceIdentity: sha256Schema,
    ledgerStoreIdentity: sha256Schema,
    logDevice: positiveInteger,
    logInode: positiveInteger,
    helperIdentity: sha256Schema,
    helperVariant: z.enum(["production", "conformance"]),
    ledgerInitialRoot: sha256Schema,
    controllerStartMonotonicMs: positiveInteger,
    controllerDeadlineMonotonicMs: positiveInteger,
    projectId: z.literal(M9B13K5A_PROJECT_ID),
    draftId: z.literal(M9B13K5A_DRAFT_ID),
    provider: z.literal(M9B13K5A_PROVIDER),
    filename: z.literal(M9B13K5A_FILENAME),
    putDigest: sha256Schema,
  })
  .superRefine((value, context) => {
    if (
      value.controllerDeadlineMonotonicMs !==
      value.controllerStartMonotonicMs + M9B13K5A_CONTROLLER_DURATION_MS
    )
      context.addIssue({
        code: "custom",
        message: "controller deadline must be absolute",
      });
  })
  .readonly();
export type M9b13k5aActivation = z.infer<typeof m9b13k5aActivationSchema>;

const eventBindingSchema = z.strictObject({
  protocol: z.literal(M9B13K5A_EVENT_PROTOCOL),
  activationIdentity: sha256Schema,
  runIdentity: identitySchema,
  sessionIdentity: identitySchema,
  operation: m9b13k5aOperationSchema,
  page: positiveInteger.max(4),
  requestIdentity: sha256Schema,
  requestDigest: sha256Schema,
  reservationIdentity: sha256Schema,
  observedMonotonicMs: positiveInteger,
});

const requestReservedSchema = eventBindingSchema
  .safeExtend({
    kind: z.literal("request-reserved"),
    requestNumber: positiveInteger.max(M9B13K5A_LONGEST_REQUEST_COUNT),
  })
  .readonly();
const dispatchPermitConsumedSchema = eventBindingSchema
  .safeExtend({
    kind: z.literal("dispatch-permit-consumed"),
    permitIdentity: sha256Schema,
    reservationReceiptDigest: sha256Schema,
  })
  .readonly();
const enqueueObservedSchema = eventBindingSchema
  .safeExtend({
    kind: z.literal("enqueue-observed"),
    permitIdentity: sha256Schema,
    transportReceiptDigest: sha256Schema,
  })
  .readonly();
const responseAmbiguitySchema = eventBindingSchema
  .safeExtend({
    kind: z.literal("response-ambiguity"),
    permitIdentity: sha256Schema,
    transportReceiptDigest: sha256Schema,
    classification: z.enum([
      "committed-before-enqueue",
      "during-enqueue",
      "after-enqueue-before-response",
      "during-response-persistence",
      "after-response-before-projection",
    ]),
  })
  .readonly();
const rawResponseSchema = eventBindingSchema
  .safeExtend({
    kind: z.literal("raw-response-recorded"),
    responseIdentity: sha256Schema,
    transportReceiptDigest: sha256Schema,
    status: z.number().int().min(200).max(299),
    rawByteLength: nonnegativeInteger,
    rawSha256: sha256Schema,
  })
  .readonly();
const responseValidatedSchema = eventBindingSchema
  .safeExtend({
    kind: z.literal("response-validated"),
    responseIdentity: sha256Schema,
    rawSha256: sha256Schema,
    canonicalResponseSha256: sha256Schema,
  })
  .readonly();
const decisionProjectedSchema = eventBindingSchema
  .safeExtend({
    kind: z.literal("decision-projected"),
    responseIdentity: sha256Schema,
    rawSha256: sha256Schema,
    canonicalResponseSha256: sha256Schema,
    decisionProjectionSha256: sha256Schema,
  })
  .readonly();
const requestReconciledSchema = eventBindingSchema
  .safeExtend({
    kind: z.literal("request-reconciled"),
    responseIdentity: sha256Schema,
    reconciliationSha256: sha256Schema,
    exactObjectCardinality: nonnegativeInteger,
  })
  .readonly();
const uploadReconciledSchema = eventBindingSchema
  .safeExtend({
    kind: z.literal("upload-reconciled"),
    responseIdentity: sha256Schema,
    reconciliationSha256: sha256Schema,
    exactObjectCardinality: z.literal(1),
    filename: z.literal(M9B13K5A_FILENAME),
    putDigest: sha256Schema,
    objectIdentity: identitySchema,
  })
  .readonly();
const downloadReconciledSchema = eventBindingSchema
  .safeExtend({
    kind: z.literal("download-reconciled"),
    responseIdentity: sha256Schema,
    reconciliationSha256: sha256Schema,
    exactObjectCardinality: z.literal(1),
    filename: z.literal(M9B13K5A_FILENAME),
    putDigest: sha256Schema,
    objectIdentity: identitySchema,
    downloadedByteLength: nonnegativeInteger,
    downloadedSha256: sha256Schema,
  })
  .readonly();
const revocationReconciledSchema = eventBindingSchema
  .safeExtend({
    kind: z.literal("revocation-reconciled"),
    responseIdentity: sha256Schema,
    reconciliationSha256: sha256Schema,
    revocationProjectionSha256: sha256Schema,
    revocationPhaseStartMonotonicMs: positiveInteger,
    revocationDeadlineMonotonicMs: positiveInteger,
  })
  .readonly();
const pageContinuedSchema = eventBindingSchema
  .safeExtend({
    kind: z.literal("page-continued"),
    nextPage: positiveInteger.max(4),
    nextUrlSha256: sha256Schema,
  })
  .readonly();
const operationCompletedSchema = eventBindingSchema
  .safeExtend({
    kind: z.literal("operation-completed"),
    pagesCompleted: positiveInteger.max(4),
    exactObjectCardinality: nonnegativeInteger,
  })
  .readonly();
const custodianEvidenceSchema = eventBindingSchema
  .safeExtend({
    kind: z.literal("custodian-evidence-accepted"),
    custodianReceiptDigest: sha256Schema,
    revocationProjectionSha256: sha256Schema,
  })
  .readonly();
const terminalClosedSchema = eventBindingSchema
  .safeExtend({
    kind: z.literal("terminal-closed"),
    requestCount: z.union([
      z.literal(M9B13K5A_SHORTEST_REQUEST_COUNT),
      z.literal(M9B13K5A_LONGEST_REQUEST_COUNT),
      positiveInteger
        .min(M9B13K5A_SHORTEST_REQUEST_COUNT)
        .max(M9B13K5A_LONGEST_REQUEST_COUNT),
    ]),
    custodianReceiptDigest: sha256Schema,
  })
  .readonly();

export const m9b13k5aEventPayloadSchema = z.discriminatedUnion("kind", [
  requestReservedSchema,
  dispatchPermitConsumedSchema,
  enqueueObservedSchema,
  responseAmbiguitySchema,
  rawResponseSchema,
  responseValidatedSchema,
  decisionProjectedSchema,
  requestReconciledSchema,
  uploadReconciledSchema,
  downloadReconciledSchema,
  revocationReconciledSchema,
  pageContinuedSchema,
  operationCompletedSchema,
  custodianEvidenceSchema,
  terminalClosedSchema,
]);
export type M9b13k5aEventPayload = z.infer<typeof m9b13k5aEventPayloadSchema>;
export type M9b13k5aEventKind = M9b13k5aEventPayload["kind"];
export const M9B13K5A_EVENT_KINDS = [
  "request-reserved",
  "dispatch-permit-consumed",
  "enqueue-observed",
  "response-ambiguity",
  "raw-response-recorded",
  "response-validated",
  "decision-projected",
  "request-reconciled",
  "upload-reconciled",
  "download-reconciled",
  "revocation-reconciled",
  "page-continued",
  "operation-completed",
  "custodian-evidence-accepted",
  "terminal-closed",
] as const satisfies ReadonlyArray<M9b13k5aEventKind>;

export const m9b13k5aNativeReceiptSchema = z
  .strictObject({
    protocol: z.literal(M9B13K5A_NATIVE_RECEIPT_PROTOCOL),
    sessionIdentity: identitySchema,
    activationIdentity: sha256Schema,
    runIdentity: identitySchema,
    namespaceIdentity: sha256Schema,
    storeIdentity: sha256Schema,
    logDevice: positiveInteger,
    logInode: positiveInteger,
    helperIdentity: sha256Schema,
    helperVariant: z.enum(["production", "conformance"]),
    initialRoot: sha256Schema,
    previousRoot: sha256Schema,
    resultingRoot: sha256Schema,
    sequence: positiveInteger,
    canonicalPayloadDigest: sha256Schema,
    receiptDigest: sha256Schema,
  })
  .readonly();
export type M9b13k5aNativeReceipt = z.infer<typeof m9b13k5aNativeReceiptSchema>;

export const m9b13k5aRetainedReceiptSchema = z
  .strictObject({
    protocol: z.literal(M9B13K5A_RETAINED_RECEIPT_PROTOCOL),
    nativeReceipt: m9b13k5aNativeReceiptSchema,
    eventPayload: m9b13k5aEventPayloadSchema,
    authenticatedReceiptDigest: sha256Schema,
    controllerStartMonotonicMs: positiveInteger,
    controllerDeadlineMonotonicMs: positiveInteger,
    revocationPhaseStartMonotonicMs: positiveInteger.nullable(),
    revocationDeadlineMonotonicMs: positiveInteger.nullable(),
  })
  .readonly();
export type M9b13k5aRetainedReceipt = z.infer<
  typeof m9b13k5aRetainedReceiptSchema
>;

export const m9b13k5aCustodianUnsignedSchema = z
  .strictObject({
    protocol: z.literal(M9B13K5A_CUSTODIAN_PROTOCOL),
    syntheticIdentity: z.literal("SYNTHETIC-M9B13K5A-CUSTODIAN"),
    activationIdentity: sha256Schema,
    runIdentity: identitySchema,
    sessionIdentity: identitySchema,
    patCommitment: sha256Schema,
    publicKeyFingerprint: sha256Schema,
    custodianIdentity: sha256Schema,
    revocationProjectionSha256: sha256Schema,
    acceptedLedgerReceiptDigest: sha256Schema,
    acceptedLedgerSequence: positiveInteger,
    acceptedLedgerRoot: sha256Schema,
    observedMonotonicMs: positiveInteger,
  })
  .readonly();
export type M9b13k5aCustodianUnsigned = z.infer<
  typeof m9b13k5aCustodianUnsignedSchema
>;

export const m9b13k5aCustodianReceiptSchema = z
  .strictObject({
    unsigned: m9b13k5aCustodianUnsignedSchema,
    publicKeyDerBase64: z.string().min(1).max(1024),
    signatureBase64: z.string().min(1).max(1024),
  })
  .readonly();
export type M9b13k5aCustodianReceipt = z.infer<
  typeof m9b13k5aCustodianReceiptSchema
>;

export const M9B13K5A_FUTURE_IMPLEMENTATION_ORDER = [
  "accepted-ledger-adapter-and-verified-receipt-boundary",
  "raw-transport-receipt-strict-json-parser-and-official-response-schemas",
  "exact-reconciliation-and-url-resource-binding",
  "complete-request-state-event-grammar-and-replay",
  "authenticated-launcher",
  "revocation-custodian",
  "loopback-intercepted-integration-with-crashes-and-restarts",
  "independent-review-of-all-preceding-components",
  "effect-capable-controller-assembly",
  "activation-capsule-preparation-and-review",
] as const;

export const M9B13K5A_IMPLEMENTED_STAGES = [1, 2, 3, 4] as const;
export const M9B13K5A_FORBIDDEN_STAGES = [5, 6, 7, 8, 9, 10] as const;

export function deriveM9b13k5aProtocolIdentity(): string {
  const digest = m9b13k5aCanonicalDigest({
    protocol: M9B13K5A_PROTOCOL,
    acceptedLedgerImplementationIdentity:
      M9B13K5A_ACCEPTED_LEDGER_IMPLEMENTATION_IDENTITY,
    comparatorProtocol: M9B13K5A_COMPARATOR_PROTOCOL,
    operations: M9B13K5A_OPERATION_SPECS,
    shortestRequestCount: M9B13K5A_SHORTEST_REQUEST_COUNT,
    longestRequestCount: M9B13K5A_LONGEST_REQUEST_COUNT,
    eventKinds: M9B13K5A_EVENT_KINDS,
    payloadLimit: M9B13K5A_LEDGER_PAYLOAD_LIMIT,
    futureOrder: M9B13K5A_FUTURE_IMPLEMENTATION_ORDER,
    implementedStages: M9B13K5A_IMPLEMENTED_STAGES,
    forbiddenStages: M9B13K5A_FORBIDDEN_STAGES,
  });
  if (!digest.ok) throw new Error(digest.error.reason);
  return digest.value;
}
