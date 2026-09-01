import { createPublicKey, verify } from "node:crypto";

import { canonicalizeJson, type Result } from "@nicia-ai/lachesis";

import {
  M9B13K5A_ACCEPTED_LEDGER_IMPLEMENTATION_IDENTITY,
  M9B13K5A_CONTROLLER_DURATION_MS,
  M9B13K5A_EVENT_KINDS,
  M9B13K5A_LEDGER_PAYLOAD_LIMIT,
  M9B13K5A_LONGEST_REQUEST_COUNT,
  M9B13K5A_OPERATION_SPECS,
  M9B13K5A_RETAINED_RECEIPT_PROTOCOL,
  M9B13K5A_REVOCATION_DURATION_MS,
  M9B13K5A_SHORTEST_REQUEST_COUNT,
  type M9b13k5aActivation,
  m9b13k5aActivationSchema,
  m9b13k5aCanonicalDigest,
  m9b13k5aCustodianReceiptSchema,
  type M9b13k5aEventKind,
  type M9b13k5aEventPayload,
  m9b13k5aEventPayloadSchema,
  type M9b13k5aFailure,
  m9b13k5aFailure,
  type M9b13k5aNativeReceipt,
  m9b13k5aNativeReceiptSchema,
  type M9b13k5aOperation,
  type M9b13k5aRetainedReceipt,
  m9b13k5aRetainedReceiptSchema,
  m9b13k5aSha256,
} from "./protocol.js";

const ledgerAdapterRegistry = new WeakSet<object>();
const retainedReceiptRegistry = new WeakSet<object>();
const replayRegistry = new WeakSet<object>();
const dispatchPermitRegistry = new WeakSet<object>();
const consumedDispatchPermits = new WeakSet<object>();
const permitIssuedForReceipt = new WeakSet<object>();
const verifiedCustodianDigests = new Map<string, VerifiedCustodianBinding>();

export type M9b13k5aLedgerAdapterCapability = Readonly<{
  syntheticIdentity: "SYNTHETIC-M9B13K5A-NATIVE-LEDGER-ADAPTER";
  implementationIdentity: typeof M9B13K5A_ACCEPTED_LEDGER_IMPLEMENTATION_IDENTITY;
}>;

export function createM9b13k5aSyntheticLedgerAdapterCapability(): M9b13k5aLedgerAdapterCapability {
  const capability: M9b13k5aLedgerAdapterCapability = Object.freeze({
    syntheticIdentity: "SYNTHETIC-M9B13K5A-NATIVE-LEDGER-ADAPTER",
    implementationIdentity: M9B13K5A_ACCEPTED_LEDGER_IMPLEMENTATION_IDENTITY,
  });
  ledgerAdapterRegistry.add(capability);
  return capability;
}

function validLedgerAdapter(
  value: unknown,
): value is M9b13k5aLedgerAdapterCapability {
  return (
    value !== null &&
    typeof value === "object" &&
    ledgerAdapterRegistry.has(value)
  );
}

export type M9b13k5aVerifiedRetainedReceipt = M9b13k5aRetainedReceipt;

function receiptDigestProjection(
  receipt: M9b13k5aNativeReceipt,
): Omit<M9b13k5aNativeReceipt, "receiptDigest"> {
  const { receiptDigest, ...projection } = receipt;
  void receiptDigest;
  return projection;
}

function retainedDigestProjection(
  receipt: M9b13k5aRetainedReceipt,
): Omit<M9b13k5aRetainedReceipt, "authenticatedReceiptDigest"> {
  const { authenticatedReceiptDigest, ...projection } = receipt;
  void authenticatedReceiptDigest;
  return projection;
}

export function acceptM9b13k5aNativeLedgerReceipt(
  adapterValue: unknown,
  activationValue: unknown,
  eventValue: unknown,
  nativeReceiptValue: unknown,
  deadlines: Readonly<{
    revocationPhaseStartMonotonicMs: number | null;
    revocationDeadlineMonotonicMs: number | null;
  }>,
): Result<M9b13k5aVerifiedRetainedReceipt, M9b13k5aFailure> {
  if (!validLedgerAdapter(adapterValue))
    return m9b13k5aFailure("m9b13k5a-ledger-adapter-capability-invalid");
  const activation = m9b13k5aActivationSchema.safeParse(activationValue);
  const event = m9b13k5aEventPayloadSchema.safeParse(eventValue);
  const receipt = m9b13k5aNativeReceiptSchema.safeParse(nativeReceiptValue);
  if (!activation.success)
    return m9b13k5aFailure("m9b13k5a-activation-invalid");
  if (!event.success) return m9b13k5aFailure("m9b13k5a-event-invalid");
  if (!receipt.success)
    return m9b13k5aFailure("m9b13k5a-native-receipt-invalid");
  const payloadCanonical = canonicalizeJson(event.data);
  if (!payloadCanonical.ok)
    return m9b13k5aFailure("m9b13k5a-event-canonical-invalid");
  const payloadBytes = new TextEncoder().encode(payloadCanonical.value);
  if (payloadBytes.byteLength > M9B13K5A_LEDGER_PAYLOAD_LIMIT)
    return m9b13k5aFailure("m9b13k5a-ledger-payload-oversized");
  const expectedReceiptDigest = m9b13k5aCanonicalDigest(
    receiptDigestProjection(receipt.data),
  );
  if (!expectedReceiptDigest.ok) return expectedReceiptDigest;
  const binding = activation.data;
  if (
    receipt.data.activationIdentity !== binding.activationIdentity ||
    receipt.data.runIdentity !== binding.runIdentity ||
    receipt.data.sessionIdentity !== binding.sessionIdentity ||
    receipt.data.namespaceIdentity !== binding.ledgerNamespaceIdentity ||
    receipt.data.storeIdentity !== binding.ledgerStoreIdentity ||
    receipt.data.logDevice !== binding.logDevice ||
    receipt.data.logInode !== binding.logInode ||
    receipt.data.helperIdentity !== binding.helperIdentity ||
    receipt.data.helperVariant !== binding.helperVariant ||
    receipt.data.initialRoot !== binding.ledgerInitialRoot ||
    receipt.data.canonicalPayloadDigest !== m9b13k5aSha256(payloadBytes) ||
    receipt.data.receiptDigest !== expectedReceiptDigest.value ||
    event.data.activationIdentity !== binding.activationIdentity ||
    event.data.runIdentity !== binding.runIdentity ||
    event.data.sessionIdentity !== binding.sessionIdentity
  )
    return m9b13k5aFailure("m9b13k5a-native-receipt-binding-invalid");
  if (
    event.data.observedMonotonicMs < binding.controllerStartMonotonicMs ||
    event.data.observedMonotonicMs >= binding.controllerDeadlineMonotonicMs
  )
    return m9b13k5aFailure("m9b13k5a-controller-deadline-expired");
  if (
    (deadlines.revocationPhaseStartMonotonicMs === null) !==
      (deadlines.revocationDeadlineMonotonicMs === null) ||
    (deadlines.revocationPhaseStartMonotonicMs !== null &&
      deadlines.revocationDeadlineMonotonicMs !==
        deadlines.revocationPhaseStartMonotonicMs +
          M9B13K5A_REVOCATION_DURATION_MS)
  )
    return m9b13k5aFailure("m9b13k5a-revocation-deadline-binding-invalid");
  const retainedDraft = {
    protocol: M9B13K5A_RETAINED_RECEIPT_PROTOCOL,
    nativeReceipt: receipt.data,
    eventPayload: event.data,
    controllerStartMonotonicMs: binding.controllerStartMonotonicMs,
    controllerDeadlineMonotonicMs: binding.controllerDeadlineMonotonicMs,
    revocationPhaseStartMonotonicMs: deadlines.revocationPhaseStartMonotonicMs,
    revocationDeadlineMonotonicMs: deadlines.revocationDeadlineMonotonicMs,
  };
  const retainedDigest = m9b13k5aCanonicalDigest(retainedDraft);
  if (!retainedDigest.ok) return retainedDigest;
  const retained = m9b13k5aRetainedReceiptSchema.parse({
    ...retainedDraft,
    authenticatedReceiptDigest: retainedDigest.value,
  });
  retainedReceiptRegistry.add(retained);
  return { ok: true, value: retained };
}

type RequestStage =
  | "idle"
  | "reserved"
  | "possibly-dispatched"
  | "enqueued"
  | "raw-recorded"
  | "validated"
  | "projected"
  | "reconciled"
  | "ambiguous";

export type M9b13k5aReplayProjection = Readonly<{
  activationIdentity: string;
  runIdentity: string;
  sessionIdentity: string;
  currentRoot: string;
  sequence: number;
  lastAcceptedLedgerReceiptDigest: string | null;
  operationIndex: number;
  expectedOperation: M9b13k5aOperation | null;
  expectedPage: number;
  requestStage: RequestStage;
  requestCount: number;
  completedOperations: ReadonlyArray<M9b13k5aOperation>;
  possiblyDispatchedRequestIdentities: ReadonlyArray<string>;
  revocationPhaseStartMonotonicMs: number | null;
  revocationDeadlineMonotonicMs: number | null;
  revocationProjectionSha256: string | null;
  terminal: boolean;
  custodianVerified: boolean;
  lastMonotonicMs: number;
}>;

export type M9b13k5aVerifiedReplay = Readonly<{
  syntheticIdentity: "SYNTHETIC-M9B13K5A-VERIFIED-REPLAY";
  projection: M9b13k5aReplayProjection;
}>;

function applicableReconciliationKind(
  operation: M9b13k5aOperation,
): M9b13k5aEventKind {
  switch (operation) {
    case "canary-put":
      return "upload-reconciled";
    case "canary-download":
      return "download-reconciled";
    case "pat-revocation":
      return "revocation-reconciled";
    case "token-detail":
    case "project":
    case "registration-inventory":
    case "view-only-link-inventory":
    case "pre-upload-file-inventory":
    case "provider-root":
    case "post-upload-file-inventory":
      return "request-reconciled";
  }
}

export const M9B13K5A_ALLOWED_STAGE_EVENTS: Readonly<
  Record<RequestStage, ReadonlyArray<M9b13k5aEventKind>>
> = {
  idle: ["request-reserved", "custodian-evidence-accepted", "terminal-closed"],
  reserved: ["dispatch-permit-consumed"],
  "possibly-dispatched": [
    "enqueue-observed",
    "raw-response-recorded",
    "response-ambiguity",
  ],
  enqueued: ["raw-response-recorded", "response-ambiguity"],
  "raw-recorded": ["response-validated", "response-ambiguity"],
  validated: ["decision-projected"],
  projected: [
    "request-reconciled",
    "upload-reconciled",
    "download-reconciled",
    "revocation-reconciled",
  ],
  reconciled: ["page-continued", "operation-completed"],
  ambiguous: [],
};

function initialProjection(
  activation: M9b13k5aActivation,
): M9b13k5aReplayProjection {
  return {
    activationIdentity: activation.activationIdentity,
    runIdentity: activation.runIdentity,
    sessionIdentity: activation.sessionIdentity,
    currentRoot: activation.ledgerInitialRoot,
    sequence: 0,
    lastAcceptedLedgerReceiptDigest: null,
    operationIndex: 0,
    expectedOperation: M9B13K5A_OPERATION_SPECS[0].operation,
    expectedPage: 1,
    requestStage: "idle",
    requestCount: 0,
    completedOperations: [],
    possiblyDispatchedRequestIdentities: [],
    revocationPhaseStartMonotonicMs: null,
    revocationDeadlineMonotonicMs: null,
    revocationProjectionSha256: null,
    terminal: false,
    custodianVerified: false,
    lastMonotonicMs: activation.controllerStartMonotonicMs,
  };
}

function eventBoundToCurrentRequest(
  projection: M9b13k5aReplayProjection,
  event: M9b13k5aEventPayload,
): boolean {
  if (event.kind === "request-reserved")
    return (
      event.operation === projection.expectedOperation &&
      event.page === projection.expectedPage &&
      event.requestNumber === projection.requestCount + 1
    );
  return (
    event.operation === projection.expectedOperation &&
    event.page === projection.expectedPage
  );
}

function transitionProjection(
  activation: M9b13k5aActivation,
  projection: M9b13k5aReplayProjection,
  event: M9b13k5aEventPayload,
): Result<M9b13k5aReplayProjection, M9b13k5aFailure> {
  if (projection.terminal)
    return m9b13k5aFailure("m9b13k5a-terminal-state-reopened");
  if (
    event.observedMonotonicMs < projection.lastMonotonicMs ||
    event.observedMonotonicMs < activation.controllerStartMonotonicMs
  )
    return m9b13k5aFailure("m9b13k5a-monotonic-time-regressed");
  if (event.observedMonotonicMs >= activation.controllerDeadlineMonotonicMs)
    return m9b13k5aFailure("m9b13k5a-controller-deadline-expired");
  if (
    projection.revocationDeadlineMonotonicMs !== null &&
    event.operation === "pat-revocation" &&
    event.observedMonotonicMs >= projection.revocationDeadlineMonotonicMs
  )
    return m9b13k5aFailure("m9b13k5a-revocation-deadline-expired");
  const allowed = M9B13K5A_ALLOWED_STAGE_EVENTS[projection.requestStage];
  if (!allowed.includes(event.kind))
    return m9b13k5aFailure("m9b13k5a-state-event-forbidden");
  if (event.kind === "custodian-evidence-accepted") {
    const verified = verifiedCustodianDigests.get(event.custodianReceiptDigest);
    if (
      projection.operationIndex !== M9B13K5A_OPERATION_SPECS.length ||
      projection.requestStage !== "idle" ||
      projection.expectedOperation !== null ||
      verified?.activationIdentity !== activation.activationIdentity ||
      verified.runIdentity !== activation.runIdentity ||
      verified.sessionIdentity !== activation.sessionIdentity ||
      verified.revocationProjectionSha256 !== event.revocationProjectionSha256
    )
      return m9b13k5aFailure("m9b13k5a-custodian-evidence-invalid");
    return {
      ok: true,
      value: {
        ...projection,
        custodianVerified: true,
        lastMonotonicMs: event.observedMonotonicMs,
      },
    };
  }
  if (event.kind === "terminal-closed") {
    if (
      !projection.custodianVerified ||
      projection.operationIndex !== M9B13K5A_OPERATION_SPECS.length ||
      event.requestCount !== projection.requestCount ||
      projection.requestCount < M9B13K5A_SHORTEST_REQUEST_COUNT ||
      projection.requestCount > M9B13K5A_LONGEST_REQUEST_COUNT
    )
      return m9b13k5aFailure("m9b13k5a-terminal-closure-incomplete");
    return {
      ok: true,
      value: {
        ...projection,
        terminal: true,
        lastMonotonicMs: event.observedMonotonicMs,
      },
    };
  }
  if (!eventBoundToCurrentRequest(projection, event))
    return m9b13k5aFailure("m9b13k5a-operation-page-binding-invalid");
  switch (event.kind) {
    case "request-reserved":
      return {
        ok: true,
        value: {
          ...projection,
          requestStage: "reserved",
          requestCount: event.requestNumber,
          lastMonotonicMs: event.observedMonotonicMs,
        },
      };
    case "dispatch-permit-consumed":
      return {
        ok: true,
        value: {
          ...projection,
          requestStage: "possibly-dispatched",
          possiblyDispatchedRequestIdentities: [
            ...projection.possiblyDispatchedRequestIdentities,
            event.requestIdentity,
          ],
          lastMonotonicMs: event.observedMonotonicMs,
        },
      };
    case "enqueue-observed":
      return {
        ok: true,
        value: {
          ...projection,
          requestStage: "enqueued",
          lastMonotonicMs: event.observedMonotonicMs,
        },
      };
    case "response-ambiguity":
      return {
        ok: true,
        value: {
          ...projection,
          requestStage: "ambiguous",
          terminal: true,
          lastMonotonicMs: event.observedMonotonicMs,
        },
      };
    case "raw-response-recorded":
      return {
        ok: true,
        value: {
          ...projection,
          requestStage: "raw-recorded",
          lastMonotonicMs: event.observedMonotonicMs,
        },
      };
    case "response-validated":
      return {
        ok: true,
        value: {
          ...projection,
          requestStage: "validated",
          lastMonotonicMs: event.observedMonotonicMs,
        },
      };
    case "decision-projected":
      return {
        ok: true,
        value: {
          ...projection,
          requestStage: "projected",
          lastMonotonicMs: event.observedMonotonicMs,
        },
      };
    case "request-reconciled":
    case "upload-reconciled":
    case "download-reconciled":
    case "revocation-reconciled": {
      if (event.kind !== applicableReconciliationKind(event.operation))
        return m9b13k5aFailure("m9b13k5a-reconciliation-kind-invalid");
      if (
        event.kind === "revocation-reconciled" &&
        (event.revocationPhaseStartMonotonicMs !== event.observedMonotonicMs ||
          event.revocationDeadlineMonotonicMs !==
            event.revocationPhaseStartMonotonicMs +
              M9B13K5A_REVOCATION_DURATION_MS)
      )
        return m9b13k5aFailure("m9b13k5a-revocation-deadline-binding-invalid");
      return {
        ok: true,
        value: {
          ...projection,
          requestStage: "reconciled",
          revocationPhaseStartMonotonicMs:
            event.kind === "revocation-reconciled"
              ? event.revocationPhaseStartMonotonicMs
              : projection.revocationPhaseStartMonotonicMs,
          revocationDeadlineMonotonicMs:
            event.kind === "revocation-reconciled"
              ? event.revocationDeadlineMonotonicMs
              : projection.revocationDeadlineMonotonicMs,
          revocationProjectionSha256:
            event.kind === "revocation-reconciled"
              ? event.revocationProjectionSha256
              : projection.revocationProjectionSha256,
          lastMonotonicMs: event.observedMonotonicMs,
        },
      };
    }
    case "page-continued": {
      const specification = M9B13K5A_OPERATION_SPECS[projection.operationIndex];
      if (
        specification === undefined ||
        event.nextPage !== projection.expectedPage + 1 ||
        event.nextPage > specification.maximumPages
      )
        return m9b13k5aFailure("m9b13k5a-pagination-rewind-or-overflow");
      return {
        ok: true,
        value: {
          ...projection,
          expectedPage: event.nextPage,
          requestStage: "idle",
          lastMonotonicMs: event.observedMonotonicMs,
        },
      };
    }
    case "operation-completed": {
      if (event.pagesCompleted !== projection.expectedPage)
        return m9b13k5aFailure("m9b13k5a-operation-page-count-invalid");
      const nextOperationIndex = projection.operationIndex + 1;
      return {
        ok: true,
        value: {
          ...projection,
          operationIndex: nextOperationIndex,
          expectedOperation:
            M9B13K5A_OPERATION_SPECS[nextOperationIndex]?.operation ?? null,
          expectedPage: 1,
          requestStage: "idle",
          completedOperations: [
            ...projection.completedOperations,
            event.operation,
          ],
          lastMonotonicMs: event.observedMonotonicMs,
        },
      };
    }
  }
}

function validRetainedReceipt(
  value: unknown,
): value is M9b13k5aVerifiedRetainedReceipt {
  return (
    value !== null &&
    typeof value === "object" &&
    retainedReceiptRegistry.has(value) &&
    m9b13k5aRetainedReceiptSchema.safeParse(value).success
  );
}

export function replayM9b13k5aReceipts(
  activationValue: unknown,
  receiptValues: ReadonlyArray<unknown>,
  admittedNowMonotonicMs: number,
): Result<M9b13k5aVerifiedReplay, M9b13k5aFailure> {
  const activation = m9b13k5aActivationSchema.safeParse(activationValue);
  if (!activation.success)
    return m9b13k5aFailure("m9b13k5a-activation-invalid");
  if (
    admittedNowMonotonicMs < activation.data.controllerStartMonotonicMs ||
    admittedNowMonotonicMs >= activation.data.controllerDeadlineMonotonicMs
  )
    return m9b13k5aFailure("m9b13k5a-replay-deadline-expired");
  let projection = initialProjection(activation.data);
  for (const receiptValue of receiptValues) {
    if (!validRetainedReceipt(receiptValue))
      return m9b13k5aFailure("m9b13k5a-retained-receipt-unverified");
    const receipt = receiptValue;
    const expectedRetainedDigest = m9b13k5aCanonicalDigest(
      retainedDigestProjection(receipt),
    );
    if (!expectedRetainedDigest.ok) return expectedRetainedDigest;
    if (
      receipt.authenticatedReceiptDigest !== expectedRetainedDigest.value ||
      receipt.nativeReceipt.previousRoot !== projection.currentRoot ||
      receipt.nativeReceipt.sequence !== projection.sequence + 1 ||
      receipt.controllerStartMonotonicMs !==
        activation.data.controllerStartMonotonicMs ||
      receipt.controllerDeadlineMonotonicMs !==
        activation.data.controllerDeadlineMonotonicMs ||
      receipt.revocationPhaseStartMonotonicMs !==
        projection.revocationPhaseStartMonotonicMs ||
      receipt.revocationDeadlineMonotonicMs !==
        projection.revocationDeadlineMonotonicMs
    )
      return m9b13k5aFailure("m9b13k5a-ledger-receipt-stale", true);
    const next = transitionProjection(
      activation.data,
      projection,
      receipt.eventPayload,
    );
    if (!next.ok) return next;
    projection = {
      ...next.value,
      currentRoot: receipt.nativeReceipt.resultingRoot,
      sequence: receipt.nativeReceipt.sequence,
      lastAcceptedLedgerReceiptDigest: receipt.nativeReceipt.receiptDigest,
    };
  }
  const replay: M9b13k5aVerifiedReplay = Object.freeze({
    syntheticIdentity: "SYNTHETIC-M9B13K5A-VERIFIED-REPLAY",
    projection,
  });
  replayRegistry.add(replay);
  return { ok: true, value: replay };
}

export type M9b13k5aDispatchPermit = Readonly<{
  syntheticIdentity: "SYNTHETIC-M9B13K5A-ONE-USE-DISPATCH-PERMIT";
  activationIdentity: string;
  runIdentity: string;
  operation: M9b13k5aOperation;
  page: number;
  requestIdentity: string;
  reservationIdentity: string;
  acceptedLedgerRoot: string;
  acceptedLedgerSequence: number;
  acceptedLedgerReceiptDigest: string;
  permitIdentity: string;
}>;

export function issueM9b13k5aDispatchPermit(
  replayValue: unknown,
  consumedReceiptValue: unknown,
): Result<M9b13k5aDispatchPermit, M9b13k5aFailure> {
  if (
    replayValue === null ||
    typeof replayValue !== "object" ||
    !replayRegistry.has(replayValue) ||
    !validRetainedReceipt(consumedReceiptValue)
  )
    return m9b13k5aFailure("m9b13k5a-verified-replay-required");
  const replay = replayValue as M9b13k5aVerifiedReplay;
  const receipt = consumedReceiptValue;
  const event = receipt.eventPayload;
  if (
    event.kind !== "dispatch-permit-consumed" ||
    replay.projection.currentRoot !== receipt.nativeReceipt.resultingRoot ||
    replay.projection.sequence !== receipt.nativeReceipt.sequence ||
    replay.projection.requestStage !== "possibly-dispatched" ||
    permitIssuedForReceipt.has(receipt)
  )
    return m9b13k5aFailure("m9b13k5a-dispatch-permit-unavailable");
  const permit: M9b13k5aDispatchPermit = Object.freeze({
    syntheticIdentity: "SYNTHETIC-M9B13K5A-ONE-USE-DISPATCH-PERMIT",
    activationIdentity: event.activationIdentity,
    runIdentity: event.runIdentity,
    operation: event.operation,
    page: event.page,
    requestIdentity: event.requestIdentity,
    reservationIdentity: event.reservationIdentity,
    acceptedLedgerRoot: receipt.nativeReceipt.resultingRoot,
    acceptedLedgerSequence: receipt.nativeReceipt.sequence,
    acceptedLedgerReceiptDigest: receipt.nativeReceipt.receiptDigest,
    permitIdentity: event.permitIdentity,
  });
  permitIssuedForReceipt.add(receipt);
  dispatchPermitRegistry.add(permit);
  return { ok: true, value: permit };
}

export function consumeM9b13k5aDispatchPermit(
  permitValue: unknown,
): Result<Readonly<{ mayEnqueue: true }>, M9b13k5aFailure> {
  if (
    permitValue === null ||
    typeof permitValue !== "object" ||
    !dispatchPermitRegistry.has(permitValue)
  )
    return m9b13k5aFailure("m9b13k5a-dispatch-permit-invalid");
  if (consumedDispatchPermits.has(permitValue))
    return m9b13k5aFailure("m9b13k5a-dispatch-permit-reused");
  consumedDispatchPermits.add(permitValue);
  return { ok: true, value: { mayEnqueue: true } };
}

type VerifiedCustodianBinding = Readonly<{
  activationIdentity: string;
  runIdentity: string;
  sessionIdentity: string;
  revocationProjectionSha256: string;
}>;

export function verifyM9b13k5aCustodianReceipt(
  activationValue: unknown,
  replayValue: unknown,
  receiptValue: unknown,
): Result<Readonly<{ custodianReceiptDigest: string }>, M9b13k5aFailure> {
  const activation = m9b13k5aActivationSchema.safeParse(activationValue);
  const receipt = m9b13k5aCustodianReceiptSchema.safeParse(receiptValue);
  if (!activation.success)
    return m9b13k5aFailure("m9b13k5a-activation-invalid");
  if (!receipt.success)
    return m9b13k5aFailure("m9b13k5a-custodian-receipt-invalid");
  if (
    replayValue === null ||
    typeof replayValue !== "object" ||
    !replayRegistry.has(replayValue)
  )
    return m9b13k5aFailure("m9b13k5a-verified-replay-required");
  const replay = replayValue as M9b13k5aVerifiedReplay;
  const unsigned = receipt.data.unsigned;
  if (
    unsigned.activationIdentity !== activation.data.activationIdentity ||
    unsigned.runIdentity !== activation.data.runIdentity ||
    unsigned.sessionIdentity !== activation.data.sessionIdentity ||
    unsigned.patCommitment !== activation.data.patCommitment ||
    unsigned.acceptedLedgerSequence !== replay.projection.sequence ||
    unsigned.acceptedLedgerRoot !== replay.projection.currentRoot ||
    unsigned.acceptedLedgerReceiptDigest !==
      replay.projection.lastAcceptedLedgerReceiptDigest ||
    unsigned.revocationProjectionSha256 !==
      replay.projection.revocationProjectionSha256 ||
    unsigned.observedMonotonicMs < replay.projection.lastMonotonicMs ||
    replay.projection.revocationDeadlineMonotonicMs === null ||
    unsigned.observedMonotonicMs >=
      replay.projection.revocationDeadlineMonotonicMs
  )
    return m9b13k5aFailure("m9b13k5a-custodian-lineage-invalid");
  let publicKeyDer: Uint8Array;
  let signature: Uint8Array;
  try {
    publicKeyDer = Uint8Array.from(
      globalThis.atob(receipt.data.publicKeyDerBase64),
      (character) => character.charCodeAt(0),
    );
    signature = Uint8Array.from(
      globalThis.atob(receipt.data.signatureBase64),
      (character) => character.charCodeAt(0),
    );
  } catch {
    return m9b13k5aFailure("m9b13k5a-custodian-base64-invalid");
  }
  const fingerprint = m9b13k5aSha256(publicKeyDer);
  const identity = m9b13k5aSha256(
    `SYNTHETIC-M9B13K5A-CUSTODIAN\u0000${fingerprint}`,
  );
  if (
    unsigned.publicKeyFingerprint !== fingerprint ||
    unsigned.custodianIdentity !== identity
  )
    return m9b13k5aFailure("m9b13k5a-custodian-key-identity-invalid");
  const canonical = canonicalizeJson(unsigned);
  if (!canonical.ok)
    return m9b13k5aFailure("m9b13k5a-custodian-projection-invalid");
  try {
    const key = createPublicKey(
      `-----BEGIN PUBLIC KEY-----\n${receipt.data.publicKeyDerBase64}\n-----END PUBLIC KEY-----`,
    );
    if (
      !verify(null, new TextEncoder().encode(canonical.value), key, signature)
    )
      return m9b13k5aFailure("m9b13k5a-custodian-signature-invalid");
  } catch {
    return m9b13k5aFailure("m9b13k5a-custodian-signature-invalid");
  }
  const digest = m9b13k5aCanonicalDigest(receipt.data);
  if (!digest.ok) return digest;
  verifiedCustodianDigests.set(digest.value, {
    activationIdentity: unsigned.activationIdentity,
    runIdentity: unsigned.runIdentity,
    sessionIdentity: unsigned.sessionIdentity,
    revocationProjectionSha256: unsigned.revocationProjectionSha256,
  });
  return { ok: true, value: { custodianReceiptDigest: digest.value } };
}

export function deriveM9b13k5aStateModelIdentity(): string {
  const digest = m9b13k5aCanonicalDigest({
    operations: M9B13K5A_OPERATION_SPECS,
    eventKinds: M9B13K5A_EVENT_KINDS,
    allowedStageEvents: M9B13K5A_ALLOWED_STAGE_EVENTS,
    requestCounts: {
      shortest: M9B13K5A_SHORTEST_REQUEST_COUNT,
      longest: M9B13K5A_LONGEST_REQUEST_COUNT,
    },
    controllerDurationMs: M9B13K5A_CONTROLLER_DURATION_MS,
    revocationDurationMs: M9B13K5A_REVOCATION_DURATION_MS,
    acceptedLedgerImplementationIdentity:
      M9B13K5A_ACCEPTED_LEDGER_IMPLEMENTATION_IDENTITY,
    payloadLimit: M9B13K5A_LEDGER_PAYLOAD_LIMIT,
  });
  if (!digest.ok) throw new Error(digest.error.reason);
  return digest.value;
}
