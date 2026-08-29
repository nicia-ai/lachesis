import { createHash } from "node:crypto";

import { canonicalizeJson, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  deriveM9b13k5ActivationIdentity,
  M9B13K5_ACCEPTED_LEDGER_IDENTITY,
  M9B13K5_ARTIFACT_IDENTITY,
  M9B13K5_ARTIFACT_SHA256,
  M9B13K5_CUSTODIAN_PROTOCOL,
  M9B13K5_EVENT_PROTOCOL,
  M9B13K5_LIMITS,
  M9B13K5_STATE_PROTOCOL,
  type M9b13k5ActivationCandidate,
  type M9b13k5CustodianReceipt,
  m9b13k5CustodianReceiptSchema,
  type M9b13k5DispatchBoundary,
  m9b13k5DispatchBoundarySchema,
  type M9b13k5EventKind,
  m9b13k5EventKindSchema,
  type M9b13k5StateName,
  m9b13k5StateNameSchema,
} from "./protocol.js";

const ZERO_SHA256 = "0".repeat(64);
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .readonly();
const identitySchema = z.string().min(1).max(256).readonly();

export const M9B13K5_MODEL_CAPABILITY_KINDS = [
  "synthetic-conformance",
  "loopback-transport",
  "synthetic-ledger",
  "frozen-request-sequence",
  "synthetic-custodian",
  "terminal-report",
] as const;
export type M9b13k5ModelCapabilityKind =
  (typeof M9B13K5_MODEL_CAPABILITY_KINDS)[number];

const capabilityRegistry = new WeakSet<object>();

export type M9b13k5ModelCapability = Readonly<{
  mode: "synthetic";
  kind: M9b13k5ModelCapabilityKind;
  identity: string;
}>;

export function createM9b13k5SyntheticCapability(
  kind: M9b13k5ModelCapabilityKind,
  identity: string,
): M9b13k5ModelCapability {
  if (!/^[a-f0-9]{64}$/u.test(identity))
    throw new Error("m9b13k5-capability-identity-invalid");
  const capability: M9b13k5ModelCapability = Object.freeze({
    mode: "synthetic",
    kind,
    identity,
  });
  capabilityRegistry.add(capability);
  return capability;
}

export type M9b13k5CapabilitySet = Readonly<{
  conformance: M9b13k5ModelCapability;
  transport: M9b13k5ModelCapability;
  ledger: M9b13k5ModelCapability;
  sequence: M9b13k5ModelCapability;
  custodian: M9b13k5ModelCapability;
  terminalReport: M9b13k5ModelCapability;
}>;

const expectedCapabilityKinds: Readonly<
  Record<keyof M9b13k5CapabilitySet, M9b13k5ModelCapabilityKind>
> = {
  conformance: "synthetic-conformance",
  transport: "loopback-transport",
  ledger: "synthetic-ledger",
  sequence: "frozen-request-sequence",
  custodian: "synthetic-custodian",
  terminalReport: "terminal-report",
};

const capabilityKeys = [
  "conformance",
  "transport",
  "ledger",
  "sequence",
  "custodian",
  "terminalReport",
] as const;

const capabilitySetInputSchema = z.strictObject({
  conformance: z.unknown(),
  transport: z.unknown(),
  ledger: z.unknown(),
  sequence: z.unknown(),
  custodian: z.unknown(),
  terminalReport: z.unknown(),
});
const capabilityShapeSchema = z.strictObject({
  mode: z.literal("synthetic"),
  kind: z.enum(M9B13K5_MODEL_CAPABILITY_KINDS),
  identity: sha256Schema,
});

function validCapabilities(value: unknown): value is M9b13k5CapabilitySet {
  const parsedSet = capabilitySetInputSchema.safeParse(value);
  if (!parsedSet.success) return false;
  return capabilityKeys.every((key) => {
    const capability = parsedSet.data[key];
    const parsedCapability = capabilityShapeSchema.safeParse(capability);
    return (
      capability !== null &&
      typeof capability === "object" &&
      capabilityRegistry.has(capability) &&
      parsedCapability.success &&
      parsedCapability.data.kind === expectedCapabilityKinds[key]
    );
  });
}

const m9b13k5StateSchema = z
  .strictObject({
    protocol: z.literal(M9B13K5_STATE_PROTOCOL),
    state: m9b13k5StateNameSchema,
    authorityMode: z.literal("synthetic"),
    activationIdentity: sha256Schema,
    requestIdentity: identitySchema,
    campaignIdentity: identitySchema,
    tokenId: identitySchema,
    ledgerImplementationIdentity: z.literal(M9B13K5_ACCEPTED_LEDGER_IDENTITY),
    ledgerNamespaceCommitment: sha256Schema,
    ledgerStoreIdentity: sha256Schema,
    ledgerInitialRoot: sha256Schema,
    ledgerSequence: z.number().int().nonnegative(),
    ledgerRoot: sha256Schema,
    artifactIdentity: z.literal(M9B13K5_ARTIFACT_IDENTITY),
    artifactSha256: z.literal(M9B13K5_ARTIFACT_SHA256),
    artifactByteLength: z.literal(M9B13K5_LIMITS.requestBodyBytes),
    requestCount: z.number().int().min(0).max(18),
    putCount: z.number().int().min(0).max(1),
    revocationCount: z.number().int().min(0).max(1),
    controllerDeadlineAtMs: z.number().int().positive(),
    revocationDeadlineAtMs: z.number().int().positive().nullable(),
    lastMonotonicMs: z.number().int().nonnegative(),
    eventIdentities: z.array(sha256Schema).max(512).readonly(),
    custodianPublicKey: z.string().min(1).max(4096),
    custodianFingerprint: sha256Schema,
    custodianIdentity: sha256Schema,
    terminal: z.boolean(),
  })
  .readonly();
export type M9b13k5ModelState = z.infer<typeof m9b13k5StateSchema>;

const ambiguitySchema = z.enum([
  "none",
  "reserved-not-dispatched",
  "after-dispatch",
  "terminal-response-proven",
  "custodian-ambiguous",
]);

export const m9b13k5LedgerEventSchema = z
  .strictObject({
    protocol: z.literal(M9B13K5_EVENT_PROTOCOL),
    kind: m9b13k5EventKindSchema,
    fromState: m9b13k5StateNameSchema,
    toState: m9b13k5StateNameSchema,
    activationIdentity: sha256Schema,
    requestIdentity: identitySchema,
    campaignIdentity: identitySchema,
    tokenId: identitySchema,
    ledgerImplementationIdentity: z.literal(M9B13K5_ACCEPTED_LEDGER_IDENTITY),
    ledgerNamespaceCommitment: sha256Schema,
    ledgerStoreIdentity: sha256Schema,
    artifactIdentity: z.literal(M9B13K5_ARTIFACT_IDENTITY),
    artifactSha256: z.literal(M9B13K5_ARTIFACT_SHA256),
    artifactByteLength: z.literal(M9B13K5_LIMITS.requestBodyBytes),
    expectedPriorSequence: z.number().int().nonnegative(),
    expectedPriorRoot: sha256Schema,
    requestIndex: z.number().int().nonnegative(),
    cumulativeRequestCount: z.number().int().min(0).max(18),
    putCount: z.number().int().min(0).max(1),
    revocationCount: z.number().int().min(0).max(1),
    responseRawSha256: sha256Schema,
    responseDecisionSha256: sha256Schema,
    ambiguity: ambiguitySchema,
    dispatchBoundary: m9b13k5DispatchBoundarySchema.nullable(),
    observedMonotonicMs: z.number().int().nonnegative(),
    custodianReceipt: m9b13k5CustodianReceiptSchema.nullable(),
    eventIdentity: sha256Schema,
    newSequence: z.number().int().positive(),
    newRoot: sha256Schema,
  })
  .readonly();
export type M9b13k5LedgerEvent = z.infer<typeof m9b13k5LedgerEventSchema>;

export type M9b13k5ModelFailure = Readonly<{
  kind: "model";
  reason: string;
  ambiguous: boolean;
}>;

function modelFailure(
  reason: string,
  ambiguous = false,
): Result<never, M9b13k5ModelFailure> {
  return { ok: false, error: { kind: "model", reason, ambiguous } };
}

type TransitionSpec = Readonly<{
  kind: M9b13k5EventKind;
  from: M9b13k5StateName;
  to: M9b13k5StateName;
  requestDelta: 0 | 1;
  putDelta: 0 | 1;
  revocationDelta: 0 | 1;
}>;

const fixedTransitions: ReadonlyArray<TransitionSpec> = [
  {
    kind: "activation-inspected",
    from: "inert",
    to: "activation_structurally_inspected",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  },
  {
    kind: "activation-admitted",
    from: "activation_structurally_inspected",
    to: "activation_admitted",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  },
  {
    kind: "ledger-opened",
    from: "activation_admitted",
    to: "ledger_opened_identity_verified",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  },
  {
    kind: "credential-launch-reserved",
    from: "ledger_opened_identity_verified",
    to: "credential_launch_reserved",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  },
  {
    kind: "credential-custody-active",
    from: "credential_launch_reserved",
    to: "credential_custody_active",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  },
  {
    kind: "preconditions-started",
    from: "credential_custody_active",
    to: "request_preconditions_in_progress",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  },
  {
    kind: "precondition-request-reserved",
    from: "request_preconditions_in_progress",
    to: "request_preconditions_in_progress",
    requestDelta: 1,
    putDelta: 0,
    revocationDelta: 0,
  },
  {
    kind: "upload-reserved",
    from: "request_preconditions_in_progress",
    to: "upload_reserved",
    requestDelta: 1,
    putDelta: 1,
    revocationDelta: 0,
  },
  {
    kind: "upload-dispatch-observed",
    from: "upload_reserved",
    to: "upload_possibly_dispatched",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  },
  {
    kind: "upload-reconciled",
    from: "upload_possibly_dispatched",
    to: "upload_reconciled",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  },
  {
    kind: "revocation-reserved",
    from: "upload_reconciled",
    to: "revocation_reserved",
    requestDelta: 1,
    putDelta: 0,
    revocationDelta: 1,
  },
  {
    kind: "revocation-dispatch-observed",
    from: "revocation_reserved",
    to: "revocation_possibly_dispatched",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  },
  {
    kind: "credential-custody-closed",
    from: "revocation_possibly_dispatched",
    to: "credential_custody_closed",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  },
  {
    kind: "custodian-verification-awaited",
    from: "credential_custody_closed",
    to: "awaiting_independent_revocation_verification",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  },
  {
    kind: "synthetic-custodian-revoked",
    from: "awaiting_independent_revocation_verification",
    to: "synthetic_revoked_and_verified",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  },
  {
    kind: "synthetic-custodian-active",
    from: "awaiting_independent_revocation_verification",
    to: "synthetic_active_token_security_stop",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  },
  {
    kind: "synthetic-custodian-ambiguous",
    from: "awaiting_independent_revocation_verification",
    to: "synthetic_ambiguity_security_stop",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  },
  {
    kind: "closed",
    from: "synthetic_revoked_and_verified",
    to: "closed",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  },
];

const ambiguitySources: ReadonlyArray<M9b13k5StateName> = [
  "upload_reserved",
  "upload_possibly_dispatched",
  "revocation_reserved",
  "revocation_possibly_dispatched",
];
const terminalStates = new Set<M9b13k5StateName>([
  "synthetic_active_token_security_stop",
  "synthetic_ambiguity_security_stop",
  "revoked_and_independently_verified",
  "active_token_security_stop",
  "ambiguity_security_stop",
  "quarantined",
  "closed",
]);

export const M9B13K5_ALLOWED_TRANSITIONS: ReadonlyArray<TransitionSpec> = [
  ...fixedTransitions,
  ...ambiguitySources.map((from): TransitionSpec => ({
    kind: "dispatch-ambiguity-stopped",
    from,
    to: "synthetic_ambiguity_security_stop",
    requestDelta: 0,
    putDelta: 0,
    revocationDelta: 0,
  })),
  ...m9b13k5StateNameSchema.options
    .filter((state) => !terminalStates.has(state))
    .map((from): TransitionSpec => ({
      kind: "quarantined",
      from,
      to: "quarantined",
      requestDelta: 0,
      putDelta: 0,
      revocationDelta: 0,
    })),
];

export function deriveM9b13k5StateModelIdentity(): string {
  return canonicalIdentity({
    protocol: M9B13K5_STATE_PROTOCOL,
    eventProtocol: M9B13K5_EVENT_PROTOCOL,
    custodianProtocol: M9B13K5_CUSTODIAN_PROTOCOL,
    ledgerImplementationIdentity: M9B13K5_ACCEPTED_LEDGER_IDENTITY,
    artifactIdentity: M9B13K5_ARTIFACT_IDENTITY,
    artifactSha256: M9B13K5_ARTIFACT_SHA256,
    limits: M9B13K5_LIMITS,
    capabilityKinds: M9B13K5_MODEL_CAPABILITY_KINDS,
    states: m9b13k5StateNameSchema.options,
    events: m9b13k5EventKindSchema.options,
    transitions: M9B13K5_ALLOWED_TRANSITIONS,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalIdentity(value: unknown): string {
  const canonical = canonicalizeJson(value);
  if (!canonical.ok) throw new Error("m9b13k5-model-canonicalization-failed");
  return sha256(canonical.value);
}

export function createM9b13k5SyntheticState(
  candidate: M9b13k5ActivationCandidate,
  capabilitiesValue: unknown,
): Result<M9b13k5ModelState, M9b13k5ModelFailure> {
  if (!validCapabilities(capabilitiesValue))
    return modelFailure("m9b13k5-capability-set-invalid");
  const capabilities = capabilitiesValue;
  const activation = deriveM9b13k5ActivationIdentity(candidate);
  if (!activation.ok) return modelFailure(activation.error.reason);
  if (capabilities.ledger.identity !== M9B13K5_ACCEPTED_LEDGER_IDENTITY)
    return modelFailure("m9b13k5-ledger-capability-foreign");
  const state = m9b13k5StateSchema.safeParse({
    protocol: M9B13K5_STATE_PROTOCOL,
    state: "inert",
    authorityMode: "synthetic",
    activationIdentity: activation.value.activationIdentity,
    requestIdentity: candidate.requestIdentity,
    campaignIdentity: candidate.campaignIdentity,
    tokenId: candidate.tokenId,
    ledgerImplementationIdentity: candidate.ledgerImplementationIdentity,
    ledgerNamespaceCommitment: candidate.ledgerNamespaceCommitment,
    ledgerStoreIdentity: candidate.ledgerStoreIdentity,
    ledgerInitialRoot: candidate.ledgerInitialRoot,
    ledgerSequence: 0,
    ledgerRoot: candidate.ledgerInitialRoot,
    artifactIdentity: candidate.artifactIdentity,
    artifactSha256: candidate.artifactSha256,
    artifactByteLength: candidate.artifactByteLength,
    requestCount: 0,
    putCount: 0,
    revocationCount: 0,
    controllerDeadlineAtMs: M9B13K5_LIMITS.controllerDeadlineMs,
    revocationDeadlineAtMs: null,
    lastMonotonicMs: 0,
    eventIdentities: [],
    custodianPublicKey: candidate.custodianPublicKey,
    custodianFingerprint: candidate.custodianFingerprint,
    custodianIdentity: candidate.custodianIdentity,
    terminal: false,
  });
  return state.success
    ? { ok: true, value: state.data }
    : modelFailure("m9b13k5-initial-state-invalid");
}

type EventOptions = Readonly<{
  observedMonotonicMs: number;
  responseRawSha256?: string;
  responseDecisionSha256?: string;
  ambiguity?: M9b13k5LedgerEvent["ambiguity"];
  dispatchBoundary?: M9b13k5DispatchBoundary | null;
  custodianReceipt?: M9b13k5CustodianReceipt | null;
}>;

function transitionFor(
  state: M9b13k5ModelState,
  kind: M9b13k5EventKind,
): TransitionSpec | undefined {
  return M9B13K5_ALLOWED_TRANSITIONS.find(
    (candidate) => candidate.kind === kind && candidate.from === state.state,
  );
}

function eventProjection(
  event: Omit<M9b13k5LedgerEvent, "eventIdentity" | "newRoot">,
): unknown {
  return event;
}

export function prepareM9b13k5Event(
  state: M9b13k5ModelState,
  kind: M9b13k5EventKind,
  options: EventOptions,
): Result<M9b13k5LedgerEvent, M9b13k5ModelFailure> {
  const transition = transitionFor(state, kind);
  if (transition === undefined)
    return modelFailure("m9b13k5-transition-unspecified");
  const requestCount = state.requestCount + transition.requestDelta;
  const putCount = state.putCount + transition.putDelta;
  const revocationCount = state.revocationCount + transition.revocationDelta;
  const base = {
    protocol: M9B13K5_EVENT_PROTOCOL,
    kind,
    fromState: transition.from,
    toState: transition.to,
    activationIdentity: state.activationIdentity,
    requestIdentity: state.requestIdentity,
    campaignIdentity: state.campaignIdentity,
    tokenId: state.tokenId,
    ledgerImplementationIdentity: state.ledgerImplementationIdentity,
    ledgerNamespaceCommitment: state.ledgerNamespaceCommitment,
    ledgerStoreIdentity: state.ledgerStoreIdentity,
    artifactIdentity: state.artifactIdentity,
    artifactSha256: state.artifactSha256,
    artifactByteLength: state.artifactByteLength,
    expectedPriorSequence: state.ledgerSequence,
    expectedPriorRoot: state.ledgerRoot,
    requestIndex: transition.requestDelta === 1 ? requestCount : 0,
    cumulativeRequestCount: requestCount,
    putCount,
    revocationCount,
    responseRawSha256: options.responseRawSha256 ?? ZERO_SHA256,
    responseDecisionSha256: options.responseDecisionSha256 ?? ZERO_SHA256,
    ambiguity: options.ambiguity ?? "none",
    dispatchBoundary: options.dispatchBoundary ?? null,
    observedMonotonicMs: options.observedMonotonicMs,
    custodianReceipt: options.custodianReceipt ?? null,
    newSequence: state.ledgerSequence + 1,
  } satisfies Omit<M9b13k5LedgerEvent, "eventIdentity" | "newRoot">;
  const eventIdentity = canonicalIdentity(eventProjection(base));
  const event = {
    ...base,
    eventIdentity,
    newRoot: sha256(`${state.ledgerRoot}\u0000${eventIdentity}`),
  };
  const parsed = m9b13k5LedgerEventSchema.safeParse(event);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : modelFailure("m9b13k5-event-preparation-invalid");
}

function validCustodianReceipt(
  state: M9b13k5ModelState,
  event: M9b13k5LedgerEvent,
  result: M9b13k5CustodianReceipt["result"],
): boolean {
  const receipt = event.custodianReceipt;
  return (
    receipt !== null &&
    receipt.mode === "synthetic" &&
    receipt.result === result &&
    receipt.activationIdentity === state.activationIdentity &&
    receipt.requestIdentity === state.requestIdentity &&
    receipt.tokenId === state.tokenId &&
    receipt.ledgerStoreIdentity === state.ledgerStoreIdentity &&
    receipt.ledgerSequence === state.ledgerSequence &&
    receipt.ledgerRoot === state.ledgerRoot &&
    receipt.revocationRequestIndex === state.requestCount &&
    receipt.custodianPublicKey === state.custodianPublicKey &&
    receipt.custodianFingerprint === state.custodianFingerprint &&
    receipt.custodianIdentity === state.custodianIdentity
  );
}

function committedEventProjection(event: M9b13k5LedgerEvent): unknown {
  const { eventIdentity, newRoot, ...projection } = event;
  void eventIdentity;
  void newRoot;
  return projection;
}

function checkEventSemantics(
  state: M9b13k5ModelState,
  event: M9b13k5LedgerEvent,
  transition: TransitionSpec,
): Result<true, M9b13k5ModelFailure> {
  if (event.observedMonotonicMs < state.lastMonotonicMs)
    return modelFailure("m9b13k5-monotonic-time-regressed");
  const custodianEvent = event.kind.startsWith("synthetic-custodian-");
  if (
    !custodianEvent &&
    event.observedMonotonicMs >= state.controllerDeadlineAtMs
  )
    return modelFailure("m9b13k5-controller-deadline-expired");
  if (
    state.revocationDeadlineAtMs !== null &&
    [
      "revocation-dispatch-observed",
      "credential-custody-closed",
      "custodian-verification-awaited",
    ].includes(event.kind) &&
    event.observedMonotonicMs >= state.revocationDeadlineAtMs
  )
    return modelFailure("m9b13k5-revocation-deadline-expired");
  if (
    event.cumulativeRequestCount > M9B13K5_LIMITS.maximumHttpRequests ||
    event.putCount > M9B13K5_LIMITS.maximumPutDispatches ||
    event.revocationCount > M9B13K5_LIMITS.maximumRevocationDispatches
  )
    return modelFailure("m9b13k5-effect-limit-exceeded");
  if (
    event.cumulativeRequestCount !==
      state.requestCount + transition.requestDelta ||
    event.putCount !== state.putCount + transition.putDelta ||
    event.revocationCount !== state.revocationCount + transition.revocationDelta
  )
    return modelFailure("m9b13k5-effect-accounting-invalid");
  if (
    event.requestIndex !==
    (transition.requestDelta === 1 ? event.cumulativeRequestCount : 0)
  )
    return modelFailure("m9b13k5-request-index-invalid");
  if (
    event.kind === "upload-dispatch-observed" &&
    event.dispatchBoundary === null
  )
    return modelFailure("m9b13k5-upload-dispatch-boundary-absent");
  if (
    event.kind === "revocation-dispatch-observed" &&
    event.dispatchBoundary === null
  )
    return modelFailure("m9b13k5-revocation-dispatch-boundary-absent");
  if (event.kind === "dispatch-ambiguity-stopped") {
    if (event.dispatchBoundary === null || event.ambiguity === "none")
      return modelFailure("m9b13k5-dispatch-ambiguity-incomplete", true);
  }
  const custodianResults: Readonly<
    Record<string, M9b13k5CustodianReceipt["result"]>
  > = {
    "synthetic-custodian-revoked": "revoked",
    "synthetic-custodian-active": "active",
    "synthetic-custodian-ambiguous": "ambiguous",
  };
  const custodianResult = custodianResults[event.kind];
  if (
    custodianResult !== undefined &&
    !validCustodianReceipt(state, event, custodianResult)
  )
    return modelFailure("m9b13k5-custodian-receipt-invalid");
  if (custodianResult === undefined && event.custodianReceipt !== null)
    return modelFailure("m9b13k5-custodian-receipt-unexpected");
  return { ok: true, value: true };
}

export function applyM9b13k5Event(
  stateValue: unknown,
  eventValue: unknown,
  capabilities: unknown,
): Result<M9b13k5ModelState, M9b13k5ModelFailure> {
  if (!validCapabilities(capabilities))
    return modelFailure("m9b13k5-capability-set-invalid");
  const state = m9b13k5StateSchema.safeParse(stateValue);
  const event = m9b13k5LedgerEventSchema.safeParse(eventValue);
  if (!state.success) return modelFailure("m9b13k5-state-invalid");
  if (!event.success) return modelFailure("m9b13k5-event-invalid");
  if (state.data.terminal)
    return modelFailure("m9b13k5-terminal-state-reopened");
  const transition = transitionFor(state.data, event.data.kind);
  if (
    transition === undefined ||
    event.data.fromState !== state.data.state ||
    event.data.toState !== transition.to
  )
    return modelFailure("m9b13k5-transition-unspecified");
  if (
    event.data.activationIdentity !== state.data.activationIdentity ||
    event.data.requestIdentity !== state.data.requestIdentity ||
    event.data.campaignIdentity !== state.data.campaignIdentity ||
    event.data.tokenId !== state.data.tokenId ||
    event.data.ledgerNamespaceCommitment !==
      state.data.ledgerNamespaceCommitment ||
    event.data.ledgerStoreIdentity !== state.data.ledgerStoreIdentity
  )
    return modelFailure("m9b13k5-event-binding-mismatch");
  if (
    event.data.expectedPriorSequence !== state.data.ledgerSequence ||
    event.data.expectedPriorRoot !== state.data.ledgerRoot ||
    event.data.newSequence !== state.data.ledgerSequence + 1
  )
    return modelFailure("m9b13k5-ledger-receipt-stale", true);
  const projection = committedEventProjection(event.data);
  const expectedEventIdentity = canonicalIdentity(projection);
  const expectedRoot = sha256(
    `${state.data.ledgerRoot}\u0000${expectedEventIdentity}`,
  );
  if (
    event.data.eventIdentity !== expectedEventIdentity ||
    event.data.newRoot !== expectedRoot ||
    state.data.eventIdentities.includes(event.data.eventIdentity)
  )
    return modelFailure("m9b13k5-ledger-event-integrity-invalid", true);
  const semantics = checkEventSemantics(state.data, event.data, transition);
  if (!semantics.ok) return semantics;
  const next = m9b13k5StateSchema.safeParse({
    ...state.data,
    state: transition.to,
    ledgerSequence: event.data.newSequence,
    ledgerRoot: event.data.newRoot,
    requestCount: event.data.cumulativeRequestCount,
    putCount: event.data.putCount,
    revocationCount: event.data.revocationCount,
    revocationDeadlineAtMs:
      event.data.kind === "revocation-reserved"
        ? event.data.observedMonotonicMs + M9B13K5_LIMITS.revocationDeadlineMs
        : state.data.revocationDeadlineAtMs,
    lastMonotonicMs: event.data.observedMonotonicMs,
    eventIdentities: [...state.data.eventIdentities, event.data.eventIdentity],
    terminal: terminalStates.has(transition.to),
  });
  return next.success
    ? { ok: true, value: next.data }
    : modelFailure("m9b13k5-next-state-invalid");
}

export type M9b13k5RestartDecision = Readonly<{
  mayReadCredential: boolean;
  mayCreateAnotherPat: false;
  mayReserveRequest: boolean;
  mayDispatch: boolean;
  mayReconcileOnly: boolean;
  mayRevoke: boolean;
  mayAwaitCustodian: boolean;
  terminalOrQuarantined: boolean;
}>;

export function m9b13k5RestartDecision(
  state: M9b13k5ModelState,
): M9b13k5RestartDecision {
  return {
    mayReadCredential: state.state === "credential_launch_reserved",
    mayCreateAnotherPat: false,
    mayReserveRequest:
      state.state === "request_preconditions_in_progress" &&
      state.requestCount < M9B13K5_LIMITS.maximumHttpRequests,
    mayDispatch:
      state.state === "upload_reserved" ||
      state.state === "revocation_reserved",
    mayReconcileOnly:
      state.state === "upload_possibly_dispatched" ||
      state.state === "revocation_possibly_dispatched",
    mayRevoke: state.state === "upload_reconciled",
    mayAwaitCustodian:
      state.state === "credential_custody_closed" ||
      state.state === "awaiting_independent_revocation_verification",
    terminalOrQuarantined: state.terminal || state.state === "quarantined",
  };
}

export const M9B13K5_TERMINAL_REPORT_PROTOCOL =
  "lachesis-m9b13k5-synthetic-terminal-report/1" as const;
export const m9b13k5TerminalReportSchema = z
  .strictObject({
    protocol: z.literal(M9B13K5_TERMINAL_REPORT_PROTOCOL),
    mode: z.literal("synthetic"),
    terminalState: z.literal("closed"),
    activationIdentity: sha256Schema,
    requestIdentity: identitySchema,
    campaignIdentity: identitySchema,
    tokenId: identitySchema,
    ledgerImplementationIdentity: z.literal(M9B13K5_ACCEPTED_LEDGER_IDENTITY),
    ledgerNamespaceCommitment: sha256Schema,
    ledgerStoreIdentity: sha256Schema,
    ledgerSequence: z.number().int().positive(),
    ledgerRoot: sha256Schema,
    requestCount: z.number().int().min(0).max(18),
    putCount: z.literal(1),
    revocationCount: z.literal(1),
    terminalEventIdentity: sha256Schema,
    zeroExternalEffects: z.literal(true),
  })
  .readonly();
export type M9b13k5TerminalReport = z.infer<typeof m9b13k5TerminalReportSchema>;

export function createM9b13k5SyntheticTerminalReport(
  state: M9b13k5ModelState,
  capabilities: unknown,
): Result<M9b13k5TerminalReport, M9b13k5ModelFailure> {
  if (!validCapabilities(capabilities))
    return modelFailure("m9b13k5-capability-set-invalid");
  if (state.state !== "closed" || !state.terminal)
    return modelFailure("m9b13k5-terminal-report-premature");
  const terminalEventIdentity = state.eventIdentities.at(-1);
  if (terminalEventIdentity === undefined)
    return modelFailure("m9b13k5-terminal-event-absent");
  const parsed = m9b13k5TerminalReportSchema.safeParse({
    protocol: M9B13K5_TERMINAL_REPORT_PROTOCOL,
    mode: "synthetic",
    terminalState: state.state,
    activationIdentity: state.activationIdentity,
    requestIdentity: state.requestIdentity,
    campaignIdentity: state.campaignIdentity,
    tokenId: state.tokenId,
    ledgerImplementationIdentity: state.ledgerImplementationIdentity,
    ledgerNamespaceCommitment: state.ledgerNamespaceCommitment,
    ledgerStoreIdentity: state.ledgerStoreIdentity,
    ledgerSequence: state.ledgerSequence,
    ledgerRoot: state.ledgerRoot,
    requestCount: state.requestCount,
    putCount: state.putCount,
    revocationCount: state.revocationCount,
    terminalEventIdentity,
    zeroExternalEffects: true,
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : modelFailure("m9b13k5-terminal-report-invalid");
}

export function createM9b13k5SyntheticCustodianReceipt(
  state: M9b13k5ModelState,
  result: M9b13k5CustodianReceipt["result"],
): M9b13k5CustodianReceipt {
  if (state.state !== "awaiting_independent_revocation_verification")
    throw new Error("m9b13k5-custodian-state-invalid");
  return {
    protocol: M9B13K5_CUSTODIAN_PROTOCOL,
    mode: "synthetic",
    result,
    activationIdentity: state.activationIdentity,
    requestIdentity: state.requestIdentity,
    tokenId: state.tokenId,
    ledgerStoreIdentity: state.ledgerStoreIdentity,
    ledgerSequence: state.ledgerSequence,
    ledgerRoot: state.ledgerRoot,
    revocationRequestIndex: state.requestCount,
    revocationDigest: canonicalIdentity({
      tokenId: state.tokenId,
      requestIndex: state.requestCount,
      result,
    }),
    custodianPublicKey: state.custodianPublicKey,
    custodianFingerprint: state.custodianFingerprint,
    custodianIdentity: state.custodianIdentity,
    signature: `synthetic-signature-${canonicalIdentity({
      activationIdentity: state.activationIdentity,
      ledgerRoot: state.ledgerRoot,
      result,
    })}`,
  };
}
