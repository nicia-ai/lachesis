import { type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type M9b13k2CustodianAuthority,
  type M9b13k2CustodianReceipt,
  m9b13k2CustodianReceiptSchema,
  type M9b13k2RevocationVerificationRequest,
  m9b13k2RevocationVerificationRequestSchema,
  verifyM9b13k2CustodianReceipt,
} from "./custodian.js";
import {
  appendM9b13k2LedgerEvent,
  type M9b13k2FilesystemLedger,
  type M9b13k2LedgerEventDraft,
  type M9b13k2LedgerState,
  snapshotM9b13k2FilesystemLedger,
} from "./ledger.js";
import {
  M9B13K2_ACTIVATION_PROTOCOL,
  M9B13K2_ARTIFACT_IDENTITY,
  M9B13K2_CONTROLLER_DEADLINE_MS,
  M9B13K2_CUSTODIAN_PROTOCOL,
  M9B13K2_DEADLINE_PROTOCOL,
  M9B13K2_DRAFT_ID,
  M9B13K2_MAXIMUM_HTTP_REQUESTS,
  M9B13K2_PROJECT_ID,
  M9B13K2_PROVIDER,
  M9B13K2_REPLAY_PROTOCOL,
  M9B13K2_REQUEST_TIMEOUT_MS,
  M9B13K2_REVOCATION_DEADLINE_MS,
  M9B13K2_RUNTIME_PROTOCOL,
  M9B13K2_SYNTHETIC_PROTOCOL,
  m9b13k2BoundDigestSchema,
  m9b13k2CanonicalDigest,
  m9b13k2DomainDigest,
  type M9b13k2Failure,
  m9b13k2Failure,
  m9b13k2ProspectiveActivationSchema,
  m9b13k2TokenIdSchema,
} from "./protocol.js";
import {
  dispatchM9b13k2HttpsRequest,
  type M9b13k2HttpsTransport,
  type M9b13k2TransportReceipt,
  type M9b13k2TransportRequest,
} from "./transport.js";

export const M9B13K2_RUNTIME_IMPLEMENTATION_IDENTITY = m9b13k2DomainDigest(
  M9B13K2_RUNTIME_PROTOCOL,
  M9B13K2_ACTIVATION_PROTOCOL,
  M9B13K2_DEADLINE_PROTOCOL,
  "build-included-private-runtime",
);

const runtimeBindingSchema = z
  .strictObject({
    activationIdentity: m9b13k2BoundDigestSchema,
    requestIdentity: m9b13k2BoundDigestSchema,
    campaignIdentity: m9b13k2BoundDigestSchema,
    tokenId: m9b13k2TokenIdSchema,
    custodianIdentity: m9b13k2BoundDigestSchema,
  })
  .readonly();
export type M9b13k2RuntimeBinding = z.infer<typeof runtimeBindingSchema>;

export const m9b13k2SyntheticDeadlineProfileSchema = z
  .strictObject({
    protocol: z.literal(M9B13K2_SYNTHETIC_PROTOCOL),
    requestTimeoutMs: z.number().int().min(1).max(M9B13K2_REQUEST_TIMEOUT_MS),
    controllerDeadlineMs: z
      .number()
      .int()
      .min(1)
      .max(M9B13K2_CONTROLLER_DEADLINE_MS),
    revocationDeadlineMs: z
      .number()
      .int()
      .min(1)
      .max(M9B13K2_REVOCATION_DEADLINE_MS),
  })
  .readonly();
export type M9b13k2SyntheticDeadlineProfile = z.infer<
  typeof m9b13k2SyntheticDeadlineProfileSchema
>;

export type M9b13k2LiveStop = Readonly<{
  protocol: typeof M9B13K2_RUNTIME_PROTOCOL;
  decision: "m9b13k2-live-activation-unavailable";
  authorityAvailable: false;
  structuralInputAccepted: false;
  credentialReads: 0;
  ledgerAccesses: 0;
  transportDispatches: 0;
  custodianInvocations: 0;
  externalEffects: "none";
}>;

// A future reviewed capsule must replace this constant in a separately
// checksum-bound module. Ordinary input cannot populate it.
const LIVE_ACTIVATION_CAPSULE = null;

export function runM9b13k2LiveController(): Promise<M9b13k2LiveStop> {
  void LIVE_ACTIVATION_CAPSULE;
  return Promise.resolve({
    protocol: M9B13K2_RUNTIME_PROTOCOL,
    decision: "m9b13k2-live-activation-unavailable",
    authorityAvailable: false,
    structuralInputAccepted: false,
    credentialReads: 0,
    ledgerAccesses: 0,
    transportDispatches: 0,
    custodianInvocations: 0,
    externalEffects: "none",
  });
}

export type M9b13k2StructuralInspection = Readonly<{
  protocol: typeof M9B13K2_ACTIVATION_PROTOCOL;
  structurallyValid: boolean;
  authorityAvailable: false;
  effectAdmission: "denied";
}>;

export function inspectM9b13k2ProspectiveActivation(
  value: unknown,
): M9b13k2StructuralInspection {
  return {
    protocol: M9B13K2_ACTIVATION_PROTOCOL,
    structurallyValid:
      m9b13k2ProspectiveActivationSchema.safeParse(value).success,
    authorityAvailable: false,
    effectAdmission: "denied",
  };
}

export type M9b13k2RestartInspection = Readonly<{
  protocol: typeof M9B13K2_REPLAY_PROTOCOL;
  state:
    | "fresh-ledger-awaiting-unavailable-activation"
    | "prior-activation-or-effect-state"
    | "ambiguous-state"
    | "terminal-state";
  credentialReadPermitted: false;
  secondPutPermitted: false;
  secondRevocationPermitted: false;
  requestCounterResetPermitted: false;
}>;

export function inspectM9b13k2RestartState(
  state: M9b13k2LedgerState,
): M9b13k2RestartInspection {
  const terminal = state.events.some((event) => event.kind === "terminal");
  const ambiguous = state.events.some(
    (event) =>
      event.kind === "request-ambiguous" ||
      event.kind === "request-reserved" ||
      event.kind === "revocation-reserved",
  );
  return {
    protocol: M9B13K2_REPLAY_PROTOCOL,
    state: terminal
      ? "terminal-state"
      : ambiguous
        ? "ambiguous-state"
        : state.events.length === 0
          ? "fresh-ledger-awaiting-unavailable-activation"
          : "prior-activation-or-effect-state",
    credentialReadPermitted: false,
    secondPutPermitted: false,
    secondRevocationPermitted: false,
    requestCounterResetPermitted: false,
  };
}

type ConcreteRuntimeState = {
  ledger: M9b13k2FilesystemLedger;
  transport: M9b13k2HttpsTransport;
  binding: M9b13k2RuntimeBinding;
  credential: Uint8Array;
  deadlineProfile: M9b13k2SyntheticDeadlineProfile;
  controllerAbort: AbortController;
  controllerTimer: ReturnType<typeof setTimeout>;
  closed: boolean;
};

const concreteRuntimeBrand: unique symbol = Symbol(
  "M9b13k2SyntheticConcreteRuntime",
);
export type M9b13k2SyntheticConcreteRuntime = Readonly<{
  [concreteRuntimeBrand]: "M9b13k2SyntheticConcreteRuntime";
}>;
const concreteRuntimes = new WeakMap<object, ConcreteRuntimeState>();

function validSyntheticCredential(bytes: Uint8Array): boolean {
  const prefix = new TextEncoder().encode("M9B13K2SYNTHETICNONOSF");
  if (bytes.byteLength !== 64) return false;
  for (const [index, byte] of prefix.entries())
    if (bytes[index] !== byte) return false;
  return Array.from(bytes).every(
    (byte) =>
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a),
  );
}

function deriveCampaignIdentity(
  activationIdentity: string,
  requestIdentity: string,
): string {
  return `sha256:${m9b13k2DomainDigest(
    M9B13K2_RUNTIME_PROTOCOL,
    "campaign",
    activationIdentity,
    requestIdentity,
  )}`;
}

function lifecycleDraft(
  state: ConcreteRuntimeState,
  kind: M9b13k2LedgerEventDraft["kind"],
  nowMs: number,
  fields: Readonly<
    Pick<
      M9b13k2LedgerEventDraft,
      | "custodianIdentity"
      | "deadlineMonotonicMs"
      | "host"
      | "method"
      | "outcome"
      | "pathClass"
      | "queryNames"
      | "receiptDigest"
      | "requestClass"
      | "requestIndex"
      | "responseDigest"
      | "responseStatus"
      | "urlDigest"
    >
  >,
): M9b13k2LedgerEventDraft {
  return {
    activationIdentity: state.binding.activationIdentity,
    runtimeIdentity: M9B13K2_RUNTIME_IMPLEMENTATION_IDENTITY,
    campaignIdentity: state.binding.campaignIdentity,
    requestIdentity: state.binding.requestIdentity,
    kind,
    ...fields,
    projectId: M9B13K2_PROJECT_ID,
    draftId: M9B13K2_DRAFT_ID,
    provider: M9B13K2_PROVIDER,
    artifactIdentity: M9B13K2_ARTIFACT_IDENTITY,
    tokenId: state.binding.tokenId,
    observedMonotonicMs: nowMs,
  };
}

function emptyLifecycleFields(): Pick<
  M9b13k2LedgerEventDraft,
  | "custodianIdentity"
  | "deadlineMonotonicMs"
  | "host"
  | "method"
  | "outcome"
  | "pathClass"
  | "queryNames"
  | "receiptDigest"
  | "requestClass"
  | "requestIndex"
  | "responseDigest"
  | "responseStatus"
  | "urlDigest"
> {
  return {
    custodianIdentity: null,
    deadlineMonotonicMs: null,
    host: null,
    method: null,
    outcome: null,
    pathClass: null,
    queryNames: [],
    receiptDigest: null,
    requestClass: null,
    requestIndex: null,
    responseDigest: null,
    responseStatus: null,
    urlDigest: null,
  };
}

function resolveConcreteRuntime(
  value: M9b13k2SyntheticConcreteRuntime,
): Result<ConcreteRuntimeState, M9b13k2Failure> {
  const state = concreteRuntimes.get(value);
  if (state === undefined || state.closed)
    return m9b13k2Failure(
      "activation",
      "m9b13k2-synthetic-runtime-invalid-or-closed",
    );
  return { ok: true, value: state };
}

function closeConcreteRuntimeState(state: ConcreteRuntimeState): void {
  state.credential.fill(0);
  state.closed = true;
  clearTimeout(state.controllerTimer);
  state.controllerAbort.abort("m9b13k2-effect-controller-custody-closed");
}

export async function createSyntheticM9b13k2ConcreteRuntime(
  ledger: M9b13k2FilesystemLedger,
  transport: M9b13k2HttpsTransport,
  bindingValue: unknown,
  credential: Uint8Array,
  deadlineProfileValue: unknown,
): Promise<Result<M9b13k2SyntheticConcreteRuntime, M9b13k2Failure>> {
  const binding = runtimeBindingSchema.safeParse(bindingValue);
  const deadlineProfile =
    m9b13k2SyntheticDeadlineProfileSchema.safeParse(deadlineProfileValue);
  if (!binding.success || !deadlineProfile.success)
    return m9b13k2Failure(
      "activation",
      "m9b13k2-synthetic-runtime-binding-invalid",
    );
  if (
    binding.data.campaignIdentity !==
    deriveCampaignIdentity(
      binding.data.activationIdentity,
      binding.data.requestIdentity,
    )
  )
    return m9b13k2Failure(
      "activation",
      "m9b13k2-synthetic-campaign-binding-invalid",
    );
  const initial = await snapshotM9b13k2FilesystemLedger(ledger);
  if (!initial.ok) return initial;
  if (
    initial.value.events.length !== 0 ||
    initial.value.activationIdentity !== binding.data.activationIdentity ||
    initial.value.runtimeIdentity !== M9B13K2_RUNTIME_IMPLEMENTATION_IDENTITY
  )
    return m9b13k2Failure(
      "activation",
      "m9b13k2-restart-forbids-new-credential-session",
      initial.value.events.length !== 0,
    );
  if (!validSyntheticCredential(credential))
    return m9b13k2Failure(
      "credential",
      "m9b13k2-synthetic-non-osf-credential-required",
    );

  const controllerAbort = new AbortController();
  const controllerTimer = setTimeout(() => {
    controllerAbort.abort("m9b13k2-controller-deadline");
  }, deadlineProfile.data.controllerDeadlineMs);
  controllerTimer.unref();
  const state: ConcreteRuntimeState = {
    ledger,
    transport,
    binding: binding.data,
    credential: credential.slice(),
    deadlineProfile: deadlineProfile.data,
    controllerAbort,
    controllerTimer,
    closed: false,
  };
  credential.fill(0);
  const reserved = await appendM9b13k2LedgerEvent(
    ledger,
    initial.value.revision,
    initial.value.headDigest,
    lifecycleDraft(
      state,
      "activation-reserved",
      performance.now(),
      emptyLifecycleFields(),
    ),
  );
  if (!reserved.ok) {
    state.credential.fill(0);
    clearTimeout(controllerTimer);
    return reserved;
  }
  const runtime: M9b13k2SyntheticConcreteRuntime = Object.freeze({
    [concreteRuntimeBrand]: "M9b13k2SyntheticConcreteRuntime",
  });
  concreteRuntimes.set(runtime, state);
  return { ok: true, value: runtime };
}

export type M9b13k2ConcreteDispatchOutcome = Readonly<{
  protocol: typeof M9B13K2_RUNTIME_PROTOCOL;
  terminalState:
    | "request-recorded"
    | "request-reserved-not-dispatched"
    | "request-dispatch-ambiguous"
    | "awaiting-independent-revocation-verification";
  ledgerRevision: number;
  ledgerRoot: string;
  cumulativeHttpRequests: number;
  putReservations: number;
  putDispatches: number;
  revocationReservations: number;
  revocationDispatches: number;
  transportReceipt: M9b13k2TransportReceipt;
  verificationRequest: M9b13k2RevocationVerificationRequest | null;
}>;

async function appendRuntimeEvent(
  state: ConcreteRuntimeState,
  snapshot: M9b13k2LedgerState,
  kind: M9b13k2LedgerEventDraft["kind"],
  fields: ReturnType<typeof emptyLifecycleFields>,
): Promise<Result<M9b13k2LedgerState, M9b13k2Failure>> {
  return await appendM9b13k2LedgerEvent(
    state.ledger,
    snapshot.revision,
    snapshot.headDigest,
    lifecycleDraft(state, kind, performance.now(), fields),
  );
}

function requestFields(
  request: M9b13k2TransportRequest,
  requestIndex: number,
  deadlineMonotonicMs: number,
): ReturnType<typeof emptyLifecycleFields> {
  return {
    ...emptyLifecycleFields(),
    deadlineMonotonicMs,
    host: request.logicalUrl.hostname,
    method: request.method,
    pathClass: request.pathClass,
    queryNames: Array.from(
      new Set(request.logicalUrl.searchParams.keys()),
    ).toSorted(),
    requestClass: request.requestClass,
    requestIndex,
    urlDigest: m9b13k2DomainDigest(
      "lachesis-m9b13k2-bounded-node-https-transport/1",
      request.logicalUrl.href,
    ),
  };
}

export async function dispatchSyntheticM9b13k2ConcreteRequest(
  runtime: M9b13k2SyntheticConcreteRuntime,
  requestValue: M9b13k2TransportRequest,
): Promise<Result<M9b13k2ConcreteDispatchOutcome, M9b13k2Failure>> {
  const resolved = resolveConcreteRuntime(runtime);
  if (!resolved.ok) return resolved;
  const state = resolved.value;
  const revocation = requestValue.requestClass === "revoke-token";
  if (!revocation && state.controllerAbort.signal.aborted)
    return m9b13k2Failure(
      "transport",
      "m9b13k2-controller-deadline-before-reservation",
    );
  const snapshot = await snapshotM9b13k2FilesystemLedger(state.ledger);
  if (!snapshot.ok) return snapshot;
  if (snapshot.value.cumulativeHttpRequests >= M9B13K2_MAXIMUM_HTTP_REQUESTS)
    return m9b13k2Failure(
      "ledger",
      "m9b13k2-campaign-request-budget-exhausted",
    );
  const requestIndex = snapshot.value.cumulativeHttpRequests + 1;
  const request = {
    ...requestValue,
    timeoutMs: state.deadlineProfile.requestTimeoutMs,
  };
  const requestDeadline =
    performance.now() + state.deadlineProfile.requestTimeoutMs;
  const reserved = await appendRuntimeEvent(
    state,
    snapshot.value,
    revocation ? "revocation-reserved" : "request-reserved",
    requestFields(request, requestIndex, requestDeadline),
  );
  if (!reserved.ok) return reserved;

  try {
    const revocationAbort = new AbortController();
    const revocationTimer = revocation
      ? setTimeout(() => {
          revocationAbort.abort("m9b13k2-revocation-deadline");
        }, state.deadlineProfile.revocationDeadlineMs)
      : undefined;
    revocationTimer?.unref();
    const signal = revocation
      ? revocationAbort.signal
      : state.controllerAbort.signal;
    const transport = await dispatchM9b13k2HttpsRequest(
      state.transport,
      request,
      state.credential,
      signal,
    );
    if (revocationTimer !== undefined) clearTimeout(revocationTimer);
    if (!transport.ok) return transport;

    let current = reserved.value;
    const receipt = transport.value.receipt;
    const commonFields = {
      ...requestFields(request, requestIndex, requestDeadline),
      outcome: receipt.outcome,
      responseDigest: receipt.responseDigest,
      responseStatus: receipt.status,
    };
    if (receipt.dispatched) {
      const dispatched = await appendRuntimeEvent(
        state,
        current,
        revocation ? "revocation-dispatched" : "request-dispatched",
        commonFields,
      );
      if (!dispatched.ok) return dispatched;
      current = dispatched.value;
      const completed = await appendRuntimeEvent(
        state,
        current,
        receipt.outcome === "response"
          ? revocation
            ? "revocation-completed"
            : "request-completed"
          : "request-ambiguous",
        commonFields,
      );
      if (!completed.ok) return completed;
      current = completed.value;
    }

    let verificationRequest: M9b13k2RevocationVerificationRequest | null = null;
    let terminalState: M9b13k2ConcreteDispatchOutcome["terminalState"] =
      receipt.dispatched
        ? receipt.outcome === "response"
          ? "request-recorded"
          : "request-dispatch-ambiguous"
        : "request-reserved-not-dispatched";
    if (
      revocation &&
      receipt.outcome === "response" &&
      receipt.dispatched &&
      receipt.status !== null &&
      [200, 204].includes(receipt.status)
    ) {
      const receiptDigest = m9b13k2CanonicalDigest(receipt);
      if (!receiptDigest.ok) return receiptDigest;
      const awaiting = await appendRuntimeEvent(
        state,
        current,
        "awaiting-independent-revocation-verification",
        {
          ...emptyLifecycleFields(),
          outcome: "awaiting-independent-revocation-verification",
          receiptDigest: receiptDigest.value,
        },
      );
      if (!awaiting.ok) return awaiting;
      current = awaiting.value;
      verificationRequest = m9b13k2RevocationVerificationRequestSchema.parse({
        protocol: "lachesis-m9b13k2-two-phase-revocation/1",
        activationIdentity: state.binding.activationIdentity,
        requestIdentity: state.binding.requestIdentity,
        tokenId: state.binding.tokenId,
        ledgerStoreIdentity: current.storeIdentity,
        ledgerRevision: current.revision,
        ledgerRoot: current.headDigest,
        revocationRequestIndex: requestIndex,
        revocationReceiptDigest: receiptDigest.value,
        credentialIncluded: false,
      });
      terminalState = "awaiting-independent-revocation-verification";
    }
    return {
      ok: true,
      value: {
        protocol: M9B13K2_RUNTIME_PROTOCOL,
        terminalState,
        ledgerRevision: current.revision,
        ledgerRoot: current.headDigest,
        cumulativeHttpRequests: current.cumulativeHttpRequests,
        putReservations: current.putReservations,
        putDispatches: current.putDispatches,
        revocationReservations: current.revocationReservations,
        revocationDispatches: current.revocationDispatches,
        transportReceipt: receipt,
        verificationRequest,
      },
    };
  } finally {
    if (revocation) closeConcreteRuntimeState(state);
  }
}

export function closeSyntheticM9b13k2ConcreteRuntime(
  runtime: M9b13k2SyntheticConcreteRuntime,
): Result<void, M9b13k2Failure> {
  const state = concreteRuntimes.get(runtime);
  if (state === undefined)
    return m9b13k2Failure("activation", "m9b13k2-synthetic-runtime-invalid");
  closeConcreteRuntimeState(state);
  return { ok: true, value: undefined };
}

export type M9b13k2IndependentRevocationOutcome = Readonly<{
  protocol: typeof M9B13K2_CUSTODIAN_PROTOCOL;
  terminalState:
    | "revoked-and-independently-verified"
    | "custodian-reports-active"
    | "custodian-verification-ambiguous";
  ledgerRevision: number;
  ledgerRoot: string;
  result: "revoked" | "active" | "ambiguous";
  effectControllerCredentialAvailable: false;
}>;

function independentDraft(
  state: M9b13k2LedgerState,
  request: M9b13k2RevocationVerificationRequest,
  receipt: M9b13k2CustodianReceipt,
  kind: "custodian-receipt" | "terminal",
  outcome: string,
): M9b13k2LedgerEventDraft {
  return {
    activationIdentity: request.activationIdentity,
    runtimeIdentity: state.runtimeIdentity,
    campaignIdentity: deriveCampaignIdentity(
      request.activationIdentity,
      request.requestIdentity,
    ),
    requestIdentity: request.requestIdentity,
    kind,
    requestIndex: null,
    requestClass: null,
    method: null,
    urlDigest: null,
    host: null,
    pathClass: null,
    queryNames: [],
    projectId: M9B13K2_PROJECT_ID,
    draftId: M9B13K2_DRAFT_ID,
    provider: M9B13K2_PROVIDER,
    artifactIdentity: M9B13K2_ARTIFACT_IDENTITY,
    tokenId: request.tokenId,
    responseStatus: null,
    responseDigest: null,
    receiptDigest: receipt.receiptDigest,
    custodianIdentity: receipt.custodianIdentity,
    outcome,
    observedMonotonicMs: performance.now(),
    deadlineMonotonicMs: null,
  };
}

export async function appendM9b13k2IndependentCustodianReceipt(
  ledger: M9b13k2FilesystemLedger,
  authority: M9b13k2CustodianAuthority,
  requestValue: unknown,
  receiptValue: unknown,
): Promise<Result<M9b13k2IndependentRevocationOutcome, M9b13k2Failure>> {
  const request =
    m9b13k2RevocationVerificationRequestSchema.safeParse(requestValue);
  const receipt = m9b13k2CustodianReceiptSchema.safeParse(receiptValue);
  if (!request.success || !receipt.success)
    return m9b13k2Failure(
      "custodian",
      "m9b13k2-independent-receipt-envelope-invalid",
    );
  const verified = verifyM9b13k2CustodianReceipt(
    authority,
    request.data,
    receipt.data,
  );
  if (!verified.ok) return verified;
  const snapshot = await snapshotM9b13k2FilesystemLedger(ledger);
  if (!snapshot.ok) return snapshot;
  if (
    snapshot.value.storeIdentity !== request.data.ledgerStoreIdentity ||
    snapshot.value.revision !== request.data.ledgerRevision ||
    snapshot.value.headDigest !== request.data.ledgerRoot ||
    snapshot.value.activationIdentity !== request.data.activationIdentity
  )
    return m9b13k2Failure(
      "custodian",
      "m9b13k2-independent-receipt-ledger-binding-invalid",
    );
  const receiptEvent = await appendM9b13k2LedgerEvent(
    ledger,
    snapshot.value.revision,
    snapshot.value.headDigest,
    independentDraft(
      snapshot.value,
      request.data,
      receipt.data,
      "custodian-receipt",
      `custodian-${receipt.data.result}`,
    ),
  );
  if (!receiptEvent.ok) return receiptEvent;
  const terminalState: M9b13k2IndependentRevocationOutcome["terminalState"] =
    receipt.data.result === "revoked"
      ? "revoked-and-independently-verified"
      : receipt.data.result === "active"
        ? "custodian-reports-active"
        : "custodian-verification-ambiguous";
  const terminal = await appendM9b13k2LedgerEvent(
    ledger,
    receiptEvent.value.revision,
    receiptEvent.value.headDigest,
    independentDraft(
      receiptEvent.value,
      request.data,
      receipt.data,
      "terminal",
      terminalState,
    ),
  );
  return terminal.ok
    ? {
        ok: true,
        value: {
          protocol: M9B13K2_CUSTODIAN_PROTOCOL,
          terminalState,
          ledgerRevision: terminal.value.revision,
          ledgerRoot: terminal.value.headDigest,
          result: receipt.data.result,
          effectControllerCredentialAvailable: false,
        },
      }
    : terminal;
}
