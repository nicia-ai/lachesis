import { canonicalizeJson, digestValue, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  M9B13E1_REGISTERED_ARCHIVE_FILES,
  type M9b13e1ArchiveFile,
} from "./m9b13e1-trusted-session-readiness.js";
import {
  M9B13E2_AMENDED_ASSUMPTION,
  M9B13E2_NONCLAIM,
  M9B13E2_RETAINED_SCOPE,
} from "./m9b13e2-authority-bound-readiness.js";

export const M9B13E3_PRE_EFFECT_ADMISSION_PROTOCOL =
  "lachesis-m9b13e3-pre-effect-trusted-session-admission/1" as const;
export const M9B13E3_MONITORING_PROTOCOL =
  "lachesis-m9b13e3-continuing-session-monitoring/1" as const;
export const M9B13E3_TERMINAL_RECEIPT_PROTOCOL =
  "lachesis-m9b13e3-terminal-trusted-session-receipt/1" as const;
export const M9B13E3_EVENT_STREAM_PROTOCOL =
  "lachesis-m9b13e3-canonical-session-event-stream/1" as const;
export const M9B13E3_LEDGER_PROTOCOL =
  "lachesis-m9b13e3-phase-separated-synthetic-anti-replay-ledger/1" as const;
export const M9B13E3_SUPPLEMENT_BODY_PROTOCOL =
  "lachesis-m9b13e3-operational-supplement-body/1" as const;
export const M9B13E3_SUPPLEMENT_REVIEW_PROTOCOL =
  "lachesis-m9b13e3-independent-supplement-review/1" as const;
export const M9B13E3_SUPPLEMENT_SUBMISSION_PROTOCOL =
  "lachesis-m9b13e3-authority-bound-supplement-submission/1" as const;
export const M9B13E3_SYNTHETIC_AUTHORITY_PROTOCOL =
  "lachesis-m9b13e3-synthetic-phase-authority-never-live/1" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitmentSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const gitIdentitySchema = z.string().regex(/^[a-f0-9]{40}$/u);
const timestampSchema = z.iso.datetime({ offset: true });
const monotonicSchema = z.string().regex(/^[0-9]+$/u);
const nonemptySchema = z.string().min(1);

const executableIdentitySchema = z.strictObject({
  protocol: nonemptySchema,
  sourceSha256: sha256Schema,
  buildReceiptSha256: sha256Schema,
  executableSha256: sha256Schema,
});

const zeroEffectSchema = z.strictObject({
  networkRequests: z.literal(0),
  durableAcquisitionWrites: z.literal(0),
  downloads: z.literal(0),
  imageOperations: z.literal(0),
  credentialAccesses: z.literal(0),
  providerOrModelCalls: z.literal(0),
});

const ZERO_EFFECTS: z.infer<typeof zeroEffectSchema> = Object.freeze({
  networkRequests: 0,
  durableAcquisitionWrites: 0,
  downloads: 0,
  imageOperations: 0,
  credentialAccesses: 0,
  providerOrModelCalls: 0,
});

const sessionStateSchema = z.enum([
  "uninitialized",
  "preflight",
  "admitted-clean",
  "acquisition-active",
  "verification-active",
  "sealed",
  "quarantined",
  "closed",
]);

const processRecordSchema = z.strictObject({
  sessionCommitment: commitmentSchema,
  processKey: nonemptySchema,
  processId: z.number().int().positive(),
  startTimeIdentity: nonemptySchema,
  parentProcessKey: nonemptySchema.nullable(),
  parentProcessId: z.number().int().positive().nullable(),
  executableIdentity: executableIdentitySchema,
  numericUid: z.number().int().nonnegative(),
  numericGids: z.array(z.number().int().nonnegative()).min(1),
});

const eventBaseShape = {
  protocol: z.literal(M9B13E3_EVENT_STREAM_PROTOCOL),
  sessionCommitment: commitmentSchema,
  eventId: nonemptySchema,
  sequence: z.number().int().nonnegative(),
  monotonicTimestampNanos: monotonicSchema,
  wallTimestamp: timestampSchema,
  priorEventDigest: sha256Schema.nullable(),
  currentEventDigest: sha256Schema,
  ledgerRevision: z.number().int().positive(),
  priorLedgerRoot: commitmentSchema,
  resultingLedgerRoot: commitmentSchema,
};

const transitionEventSchema = z.strictObject({
  ...eventBaseShape,
  kind: z.literal("transition"),
  from: sessionStateSchema,
  to: sessionStateSchema,
});

const censusEventSchema = z.strictObject({
  ...eventBaseShape,
  kind: z.literal("census"),
  censusKind: z.enum([
    "initial",
    "pre-admission",
    "before-consequential-boundary",
    "after-completion",
    "pre-seal",
    "terminal",
  ]),
  referenceEventId: nonemptySchema,
  boundaryIdentity: nonemptySchema.nullable(),
  collectorIdentity: executableIdentitySchema,
  ageMillisAtDecision: z.number().int().nonnegative(),
  maximumAgeMillis: z.number().int().nonnegative(),
  processRecords: z.array(processRecordSchema).min(1),
  inventorySha256: sha256Schema,
  topologySha256: sha256Schema,
  observedPriorLedgerRoot: commitmentSchema,
});

const reservationEventSchema = z.strictObject({
  ...eventBaseShape,
  kind: z.literal("boundary-reservation"),
  boundaryIdentity: nonemptySchema,
});

const dispatchEventSchema = z.strictObject({
  ...eventBaseShape,
  kind: z.literal("boundary-dispatch-effect"),
  boundaryIdentity: nonemptySchema,
  reservationEventId: nonemptySchema,
  censusEventId: nonemptySchema,
});

const completionEventSchema = z.strictObject({
  ...eventBaseShape,
  kind: z.literal("completion"),
  completionIdentity: nonemptySchema,
  boundaryIdentity: nonemptySchema,
  dispatchEventId: nonemptySchema,
  completion: z.enum(["completed", "ambiguous"]),
});

const readinessVerificationEventSchema = z.strictObject({
  ...eventBaseShape,
  kind: z.literal("readiness-verification"),
  verifierIdentity: executableIdentitySchema,
  result: z.literal("pass"),
  evidenceSha256: sha256Schema,
});

const invariantLossEventSchema = z.strictObject({
  ...eventBaseShape,
  kind: z.literal("invariant-loss"),
  reason: nonemptySchema,
});

const stopEventSchema = z.strictObject({
  ...eventBaseShape,
  kind: z.literal("stop"),
  from: z.enum(["admitted-clean", "acquisition-active", "verification-active"]),
  to: z.literal("quarantined"),
  reason: nonemptySchema,
});

const sealEventSchema = z.strictObject({
  ...eventBaseShape,
  kind: z.literal("seal"),
  from: z.literal("verification-active"),
  to: z.literal("sealed"),
});

const terminalCloseEventSchema = z.strictObject({
  ...eventBaseShape,
  kind: z.literal("terminal-close"),
  from: z.enum(["sealed", "quarantined"]),
  to: z.literal("closed"),
});

const phaseCommitEventSchema = z.strictObject({
  ...eventBaseShape,
  kind: z.literal("phase-commit"),
  status: z.enum([
    "session-reserved",
    "pre-effect-admitted",
    "active-monitoring",
    "terminal-completed",
    "terminal-stopped",
    "terminal-quarantined",
  ]),
  boundDigest: sha256Schema,
});

export const m9b13e3EventSchema = z.discriminatedUnion("kind", [
  transitionEventSchema,
  censusEventSchema,
  reservationEventSchema,
  dispatchEventSchema,
  completionEventSchema,
  readinessVerificationEventSchema,
  invariantLossEventSchema,
  stopEventSchema,
  sealEventSchema,
  terminalCloseEventSchema,
  phaseCommitEventSchema,
]);

export type M9b13e3Event = z.infer<typeof m9b13e3EventSchema>;

type LedgerPhaseStatus = z.infer<typeof phaseCommitEventSchema>["status"];

export type M9b13e3SyntheticLedgerSnapshot = Readonly<{
  protocol: typeof M9B13E3_LEDGER_PROTOCOL;
  namespace: string;
  trustedInitialRoot: string;
  revision: number;
  root: string;
  events: ReadonlyArray<M9b13e3Event>;
  sessions: ReadonlyArray<
    Readonly<{ sessionCommitment: string; status: LedgerPhaseStatus }>
  >;
}>;

export type M9b13e3SyntheticLedgerFault =
  | "none"
  | "next-conflict"
  | "next-ambiguous-before-write"
  | "next-ambiguous-after-write";

type LedgerWriteFailure = Readonly<{
  kind:
    | "conflict"
    | "persistence-ambiguous"
    | "invalid-phase-transition"
    | "terminal-session-reopening";
}>;

export type M9b13e3SyntheticLedgerControl = Readonly<{
  compareAndSwap: (
    expectedRevision: number,
    expectedRoot: string,
    event: M9b13e3Event,
  ) => Promise<Result<M9b13e3SyntheticLedgerSnapshot, LedgerWriteFailure>>;
  setNextFault: (fault: M9b13e3SyntheticLedgerFault) => void;
  snapshot: () => M9b13e3SyntheticLedgerSnapshot;
}>;

function nextPhaseStatus(
  current: LedgerPhaseStatus | null,
  event: M9b13e3Event,
): Result<LedgerPhaseStatus | null, LedgerWriteFailure> {
  if (current?.startsWith("terminal-") === true)
    return { ok: false, error: { kind: "terminal-session-reopening" } };
  if (event.kind !== "phase-commit") return { ok: true, value: current };
  if (
    (current === null && event.status === "session-reserved") ||
    (current === "session-reserved" &&
      event.status === "pre-effect-admitted") ||
    (current === "pre-effect-admitted" &&
      event.status === "active-monitoring") ||
    (current === "active-monitoring" &&
      (event.status === "terminal-completed" ||
        event.status === "terminal-stopped" ||
        event.status === "terminal-quarantined"))
  )
    return { ok: true, value: event.status };
  return { ok: false, error: { kind: "invalid-phase-transition" } };
}

export function createSyntheticM9b13e3Ledger(
  namespace: string,
  trustedInitialRoot: string,
): ContractResult<M9b13e3SyntheticLedgerControl> {
  if (
    !nonemptySchema.safeParse(namespace).success ||
    !commitmentSchema.safeParse(trustedInitialRoot).success
  )
    return failure("m9b13e3:synthetic-ledger-identity-invalid");
  let fault: M9b13e3SyntheticLedgerFault = "none";
  let state: M9b13e3SyntheticLedgerSnapshot = {
    protocol: M9B13E3_LEDGER_PROTOCOL,
    namespace,
    trustedInitialRoot,
    revision: 0,
    root: trustedInitialRoot,
    events: [],
    sessions: [],
  };
  const compareAndSwap: M9b13e3SyntheticLedgerControl["compareAndSwap"] = (
    expectedRevision,
    expectedRoot,
    event,
  ) => {
    if (fault === "next-conflict") {
      fault = "none";
      return Promise.resolve({ ok: false, error: { kind: "conflict" } });
    }
    if (fault === "next-ambiguous-before-write") {
      fault = "none";
      return Promise.resolve({
        ok: false,
        error: { kind: "persistence-ambiguous" },
      });
    }
    if (
      state.revision !== expectedRevision ||
      state.root !== expectedRoot ||
      event.ledgerRevision !== state.revision + 1 ||
      event.priorLedgerRoot !== state.root
    )
      return Promise.resolve({ ok: false, error: { kind: "conflict" } });
    const existing = state.sessions.find(
      (session) => session.sessionCommitment === event.sessionCommitment,
    );
    const next = nextPhaseStatus(existing?.status ?? null, event);
    if (!next.ok) return Promise.resolve(next);
    const sessions =
      next.value === null
        ? state.sessions
        : [
            ...state.sessions.filter(
              (session) =>
                session.sessionCommitment !== event.sessionCommitment,
            ),
            { sessionCommitment: event.sessionCommitment, status: next.value },
          ];
    state = {
      ...state,
      revision: event.ledgerRevision,
      root: event.resultingLedgerRoot,
      events: [...state.events, event],
      sessions,
    };
    if (fault === "next-ambiguous-after-write") {
      fault = "none";
      return Promise.resolve({
        ok: false,
        error: { kind: "persistence-ambiguous" },
      });
    }
    return Promise.resolve({ ok: true, value: state });
  };
  return {
    ok: true,
    value: {
      compareAndSwap,
      setNextFault: (nextFault): void => {
        fault = nextFault;
      },
      snapshot: (): M9b13e3SyntheticLedgerSnapshot => state,
    },
  };
}

const eventDraftBaseShape = {
  protocol: z.literal(M9B13E3_EVENT_STREAM_PROTOCOL),
  sessionCommitment: commitmentSchema,
  eventId: nonemptySchema,
  monotonicTimestampNanos: monotonicSchema,
  wallTimestamp: timestampSchema,
};

const censusDraftSchema = z.strictObject({
  ...eventDraftBaseShape,
  kind: z.literal("census"),
  censusKind: censusEventSchema.shape.censusKind,
  referenceEventId: nonemptySchema,
  boundaryIdentity: nonemptySchema.nullable(),
  collectorIdentity: executableIdentitySchema,
  ageMillisAtDecision: z.number().int().nonnegative(),
  maximumAgeMillis: z.number().int().nonnegative(),
  processRecords: z.array(processRecordSchema).min(1),
  inventorySha256: sha256Schema,
  topologySha256: sha256Schema,
});

const m9b13e3EventDraftSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...eventDraftBaseShape,
    kind: z.literal("transition"),
    from: sessionStateSchema,
    to: sessionStateSchema,
  }),
  censusDraftSchema,
  z.strictObject({
    ...eventDraftBaseShape,
    kind: z.literal("boundary-reservation"),
    boundaryIdentity: nonemptySchema,
  }),
  z.strictObject({
    ...eventDraftBaseShape,
    kind: z.literal("boundary-dispatch-effect"),
    boundaryIdentity: nonemptySchema,
    reservationEventId: nonemptySchema,
    censusEventId: nonemptySchema,
  }),
  z.strictObject({
    ...eventDraftBaseShape,
    kind: z.literal("completion"),
    completionIdentity: nonemptySchema,
    boundaryIdentity: nonemptySchema,
    dispatchEventId: nonemptySchema,
    completion: z.enum(["completed", "ambiguous"]),
  }),
  z.strictObject({
    ...eventDraftBaseShape,
    kind: z.literal("readiness-verification"),
    verifierIdentity: executableIdentitySchema,
    result: z.literal("pass"),
    evidenceSha256: sha256Schema,
  }),
  z.strictObject({
    ...eventDraftBaseShape,
    kind: z.literal("invariant-loss"),
    reason: nonemptySchema,
  }),
  z.strictObject({
    ...eventDraftBaseShape,
    kind: z.literal("stop"),
    from: stopEventSchema.shape.from,
    to: z.literal("quarantined"),
    reason: nonemptySchema,
  }),
  z.strictObject({
    ...eventDraftBaseShape,
    kind: z.literal("seal"),
    from: z.literal("verification-active"),
    to: z.literal("sealed"),
  }),
  z.strictObject({
    ...eventDraftBaseShape,
    kind: z.literal("terminal-close"),
    from: terminalCloseEventSchema.shape.from,
    to: z.literal("closed"),
  }),
  z.strictObject({
    ...eventDraftBaseShape,
    kind: z.literal("phase-commit"),
    status: phaseCommitEventSchema.shape.status,
    boundDigest: sha256Schema,
  }),
]);

export type M9b13e3EventCursor = Readonly<{
  sessionCommitment: string;
  nextSequence: number;
  priorMonotonicTimestampNanos: string | null;
  priorEventDigest: string | null;
  nextLedgerRevision: number;
  priorLedgerRoot: string;
}>;

type ContractFailure = Readonly<{
  kind: "m9b13e3-contract-invalid";
  reason: string;
}>;
type ContractResult<T> = Result<T, ContractFailure>;

function failure<T>(reason: string): ContractResult<T> {
  return {
    ok: false,
    error: { kind: "m9b13e3-contract-invalid", reason },
  };
}

async function digestOrFailure(
  value: unknown,
): Promise<ContractResult<string>> {
  const digest = await digestValue(value);
  return digest.ok
    ? { ok: true, value: digest.value }
    : failure("m9b13e3:canonicalization-failed");
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftValue = canonicalizeJson(left);
  const rightValue = canonicalizeJson(right);
  return leftValue.ok && rightValue.ok && leftValue.value === rightValue.value;
}

function eventDigestProjection(
  event: M9b13e3Event,
): Readonly<Record<string, unknown>> {
  const {
    currentEventDigest: omittedDigest,
    resultingLedgerRoot: omittedRoot,
    ...projection
  } = event;
  void omittedDigest;
  void omittedRoot;
  return projection;
}

export async function digestM9b13e3Event(
  event: M9b13e3Event,
): Promise<ContractResult<string>> {
  return digestOrFailure(eventDigestProjection(event));
}

export function createM9b13e3EventCursor(
  sessionCommitment: string,
  initialLedgerRoot: string,
  initialLedgerRevision = 0,
): ContractResult<M9b13e3EventCursor> {
  if (
    !commitmentSchema.safeParse(sessionCommitment).success ||
    !commitmentSchema.safeParse(initialLedgerRoot).success ||
    !Number.isInteger(initialLedgerRevision) ||
    initialLedgerRevision < 0
  )
    return failure("m9b13e3:event-cursor-invalid");
  return {
    ok: true,
    value: {
      sessionCommitment,
      nextSequence: 0,
      priorMonotonicTimestampNanos: null,
      priorEventDigest: null,
      nextLedgerRevision: initialLedgerRevision + 1,
      priorLedgerRoot: initialLedgerRoot,
    },
  };
}

export async function appendSyntheticM9b13e3Event(
  cursor: M9b13e3EventCursor,
  draftValue: unknown,
): Promise<
  ContractResult<Readonly<{ event: M9b13e3Event; cursor: M9b13e3EventCursor }>>
> {
  const parsed = m9b13e3EventDraftSchema.safeParse(draftValue);
  if (!parsed.success) return failure("m9b13e3:event-draft-schema-rejected");
  const draft = parsed.data;
  if (
    draft.sessionCommitment !== cursor.sessionCommitment ||
    (cursor.priorMonotonicTimestampNanos !== null &&
      BigInt(draft.monotonicTimestampNanos) <=
        BigInt(cursor.priorMonotonicTimestampNanos))
  )
    return failure("m9b13e3:event-draft-session-or-time-invalid");
  const body = {
    ...draft,
    sequence: cursor.nextSequence,
    priorEventDigest: cursor.priorEventDigest,
    ledgerRevision: cursor.nextLedgerRevision,
    priorLedgerRoot: cursor.priorLedgerRoot,
    ...(draft.kind === "census"
      ? { observedPriorLedgerRoot: cursor.priorLedgerRoot }
      : {}),
  };
  const eventDigest = await digestOrFailure(body);
  if (!eventDigest.ok) return eventDigest;
  const rootDigest = await digestOrFailure({
    previousRoot: cursor.priorLedgerRoot,
    eventDigest: eventDigest.value,
  });
  if (!rootDigest.ok) return rootDigest;
  const eventResult = m9b13e3EventSchema.safeParse({
    ...body,
    currentEventDigest: eventDigest.value,
    resultingLedgerRoot: `sha256:${rootDigest.value}`,
  });
  if (!eventResult.success)
    return failure("m9b13e3:sealed-event-schema-rejected");
  const event = eventResult.data;
  return {
    ok: true,
    value: {
      event,
      cursor: {
        sessionCommitment: cursor.sessionCommitment,
        nextSequence: cursor.nextSequence + 1,
        priorMonotonicTimestampNanos: event.monotonicTimestampNanos,
        priorEventDigest: event.currentEventDigest,
        nextLedgerRevision: cursor.nextLedgerRevision + 1,
        priorLedgerRoot: event.resultingLedgerRoot,
      },
    },
  };
}

function referencedEventIds(event: M9b13e3Event): ReadonlyArray<string> {
  switch (event.kind) {
    case "census":
      return [event.referenceEventId];
    case "boundary-dispatch-effect":
      return [event.reservationEventId, event.censusEventId];
    case "completion":
      return [event.dispatchEventId];
    case "transition":
    case "boundary-reservation":
    case "readiness-verification":
    case "invariant-loss":
    case "stop":
    case "seal":
    case "terminal-close":
    case "phase-commit":
      return [];
  }
}

async function validateEventStream(
  events: ReadonlyArray<M9b13e3Event>,
  start: M9b13e3EventCursor,
): Promise<ContractResult<M9b13e3EventCursor>> {
  if (events.length === 0) return failure("m9b13e3:event-stream-empty");
  const identities = new Set<string>();
  const seen = new Map<string, M9b13e3Event>();
  let cursor = start;
  for (const event of events) {
    if (
      identities.has(event.eventId) ||
      event.sessionCommitment !== start.sessionCommitment ||
      event.sequence !== cursor.nextSequence ||
      event.ledgerRevision !== cursor.nextLedgerRevision ||
      event.priorEventDigest !== cursor.priorEventDigest ||
      event.priorLedgerRoot !== cursor.priorLedgerRoot ||
      (cursor.priorMonotonicTimestampNanos !== null &&
        BigInt(event.monotonicTimestampNanos) <=
          BigInt(cursor.priorMonotonicTimestampNanos))
    )
      return failure("m9b13e3:event-chain-sequence-time-or-ledger-mismatch");
    for (const reference of referencedEventIds(event)) {
      const referenced = seen.get(reference);
      if (referenced === undefined)
        return failure("m9b13e3:event-reference-missing-or-future");
      if (referenced.sessionCommitment !== event.sessionCommitment)
        return failure("m9b13e3:event-reference-cross-session");
    }
    const digest = await digestM9b13e3Event(event);
    if (!digest.ok || digest.value !== event.currentEventDigest)
      return failure("m9b13e3:event-digest-chain-mismatch");
    const root = await digestOrFailure({
      previousRoot: event.priorLedgerRoot,
      eventDigest: event.currentEventDigest,
    });
    if (
      !root.ok ||
      event.resultingLedgerRoot !== `sha256:${root.value}` ||
      (event.kind === "census" &&
        event.observedPriorLedgerRoot !== event.priorLedgerRoot)
    )
      return failure("m9b13e3:event-ledger-root-mismatch");
    identities.add(event.eventId);
    seen.set(event.eventId, event);
    cursor = {
      sessionCommitment: event.sessionCommitment,
      nextSequence: event.sequence + 1,
      priorMonotonicTimestampNanos: event.monotonicTimestampNanos,
      priorEventDigest: event.currentEventDigest,
      nextLedgerRevision: event.ledgerRevision + 1,
      priorLedgerRoot: event.resultingLedgerRoot,
    };
  }
  return { ok: true, value: cursor };
}

async function validateCensusDerivation(
  census: z.infer<typeof censusEventSchema>,
): Promise<ContractResult<true>> {
  if (census.ageMillisAtDecision > census.maximumAgeMillis)
    return failure("m9b13e3:census-stale");
  const identities = new Set<string>();
  const keys = new Set<string>();
  const ids = new Set<number>();
  for (const record of census.processRecords) {
    if (record.sessionCommitment !== census.sessionCommitment)
      return failure("m9b13e3:census-process-cross-session");
    const identity = `${record.processId}:${record.startTimeIdentity}`;
    if (
      identities.has(identity) ||
      keys.has(record.processKey) ||
      ids.has(record.processId)
    )
      return failure("m9b13e3:census-process-duplicate");
    identities.add(identity);
    keys.add(record.processKey);
    ids.add(record.processId);
  }
  for (const record of census.processRecords) {
    if (record.parentProcessKey === null) {
      if (record.parentProcessId !== null)
        return failure("m9b13e3:census-root-parent-mismatch");
      continue;
    }
    const parent = census.processRecords.find(
      (candidate) => candidate.processKey === record.parentProcessKey,
    );
    if (parent?.processId !== record.parentProcessId)
      return failure("m9b13e3:census-parent-mismatch");
  }
  const inventory = await digestOrFailure(census.processRecords);
  const topology = await digestOrFailure(
    census.processRecords.map((record) => ({
      processKey: record.processKey,
      processId: record.processId,
      startTimeIdentity: record.startTimeIdentity,
      parentProcessKey: record.parentProcessKey,
      parentProcessId: record.parentProcessId,
    })),
  );
  return inventory.ok &&
    topology.ok &&
    inventory.value === census.inventorySha256 &&
    topology.value === census.topologySha256
    ? { ok: true, value: true }
    : failure("m9b13e3:census-derived-digest-mismatch");
}

const authorityBindingsSchema = z.strictObject({
  expectationPackageDigest: sha256Schema,
  expectationReviewIdentity: nonemptySchema,
  expectationReviewedCommit: gitIdentitySchema,
  expectationReviewedTree: gitIdentitySchema,
  collectorIdentity: executableIdentitySchema,
  verifierIdentity: executableIdentitySchema,
  trustedInputInventorySha256: sha256Schema,
  ledgerNamespace: nonemptySchema,
  trustedInitialLedgerRoot: commitmentSchema,
  activationIdentity: nonemptySchema,
});

const receiptBaseShape = {
  authorityBindings: authorityBindingsSchema,
  sessionCommitment: commitmentSchema,
  startCursor: z.strictObject({
    sessionCommitment: commitmentSchema,
    nextSequence: z.number().int().nonnegative(),
    priorMonotonicTimestampNanos: monotonicSchema.nullable(),
    priorEventDigest: sha256Schema.nullable(),
    nextLedgerRevision: z.number().int().positive(),
    priorLedgerRoot: commitmentSchema,
  }),
  events: z.array(m9b13e3EventSchema).min(1),
};

export const m9b13e3PreEffectAdmissionReceiptSchema = z.strictObject({
  protocol: z.literal(M9B13E3_PRE_EFFECT_ADMISSION_PROTOCOL),
  decision: z.literal("trusted-session-admitted"),
  ...receiptBaseShape,
  independentReadinessVerification: z.literal("pass"),
  verificationEvidenceSha256: sha256Schema,
  zeroPreAdmissionEffects: zeroEffectSchema,
  reservationEventId: nonemptySchema,
  admissionCommitEventId: nonemptySchema,
  canonicalReceiptDigest: sha256Schema,
});

export type M9b13e3PreEffectAdmissionReceipt = z.infer<
  typeof m9b13e3PreEffectAdmissionReceiptSchema
>;

export const m9b13e3MonitoringReceiptSchema = z.strictObject({
  protocol: z.literal(M9B13E3_MONITORING_PROTOCOL),
  decision: z.literal("monitoring-lineage-only"),
  ...receiptBaseShape,
  admissionReceiptDigest: sha256Schema,
  monitoringCommitEventId: nonemptySchema,
  grantsAdmissionAuthority: z.literal(false),
  grantsEffectAuthority: z.literal(false),
  canonicalMonitoringDigest: sha256Schema,
});

export type M9b13e3MonitoringReceipt = z.infer<
  typeof m9b13e3MonitoringReceiptSchema
>;

const completedTerminalSchema = z.strictObject({
  protocol: z.literal(M9B13E3_TERMINAL_RECEIPT_PROTOCOL),
  decision: z.literal("trusted-session-completed"),
  ...receiptBaseShape,
  admissionReceiptDigest: sha256Schema,
  monitoringLineageDigest: sha256Schema,
  terminalCommitEventId: nonemptySchema,
  acceptedAsInitialAuthority: z.literal(false),
  canonicalTerminalDigest: sha256Schema,
});

const failedTerminalSchema = z.strictObject({
  protocol: z.literal(M9B13E3_TERMINAL_RECEIPT_PROTOCOL),
  decision: z.enum(["trusted-session-stopped", "trusted-session-quarantined"]),
  ...receiptBaseShape,
  admissionReceiptDigest: sha256Schema,
  monitoringLineageDigest: sha256Schema,
  terminalCommitEventId: nonemptySchema,
  acceptedAsInitialAuthority: z.literal(false),
  canonicalTerminalDigest: sha256Schema,
});

export const m9b13e3TerminalReceiptSchema = z.discriminatedUnion("decision", [
  completedTerminalSchema,
  failedTerminalSchema,
]);

export type M9b13e3TerminalReceipt = z.infer<
  typeof m9b13e3TerminalReceiptSchema
>;

function admissionProjection(
  value: M9b13e3PreEffectAdmissionReceipt,
): Readonly<Record<string, unknown>> {
  const { canonicalReceiptDigest: omitted, ...projection } = value;
  void omitted;
  return projection;
}

function monitoringProjection(
  value: M9b13e3MonitoringReceipt,
): Readonly<Record<string, unknown>> {
  const { canonicalMonitoringDigest: omitted, ...projection } = value;
  void omitted;
  return projection;
}

function terminalProjection(
  value: M9b13e3TerminalReceipt,
): Readonly<Record<string, unknown>> {
  const { canonicalTerminalDigest: omitted, ...projection } = value;
  void omitted;
  return projection;
}

export async function digestM9b13e3PreEffectAdmission(
  value: M9b13e3PreEffectAdmissionReceipt,
): Promise<ContractResult<string>> {
  return digestOrFailure(admissionProjection(value));
}

export async function digestM9b13e3Monitoring(
  value: M9b13e3MonitoringReceipt,
): Promise<ContractResult<string>> {
  return digestOrFailure(monitoringProjection(value));
}

export async function digestM9b13e3TerminalReceipt(
  value: M9b13e3TerminalReceipt,
): Promise<ContractResult<string>> {
  return digestOrFailure(terminalProjection(value));
}

function eventAt(
  events: ReadonlyArray<M9b13e3Event>,
  index: number,
): M9b13e3Event | undefined {
  return events.at(index);
}

function transitionIs(
  event: M9b13e3Event | undefined,
  from: z.infer<typeof sessionStateSchema>,
  to: z.infer<typeof sessionStateSchema>,
): boolean {
  return event?.kind === "transition" && event.from === from && event.to === to;
}

async function validateAdmissionChronology(
  receipt: M9b13e3PreEffectAdmissionReceipt,
): Promise<ContractResult<true>> {
  const events = receipt.events;
  if (events.length !== 7)
    return failure("m9b13e3:admission-event-count-not-exact");
  const reservation = eventAt(events, 0);
  const preflight = eventAt(events, 1);
  const initial = eventAt(events, 2);
  const verification = eventAt(events, 3);
  const preAdmission = eventAt(events, 4);
  const admitted = eventAt(events, 5);
  const commit = eventAt(events, 6);
  if (
    reservation?.kind !== "phase-commit" ||
    reservation.status !== "session-reserved" ||
    reservation.eventId !== receipt.reservationEventId ||
    !transitionIs(preflight, "uninitialized", "preflight") ||
    initial?.kind !== "census" ||
    initial.censusKind !== "initial" ||
    initial.referenceEventId !== preflight?.eventId ||
    initial.boundaryIdentity !== null ||
    verification?.kind !== "readiness-verification" ||
    preAdmission?.kind !== "census" ||
    preAdmission.censusKind !== "pre-admission" ||
    preAdmission.referenceEventId !== verification.eventId ||
    preAdmission.boundaryIdentity !== null ||
    !transitionIs(admitted, "preflight", "admitted-clean") ||
    commit?.kind !== "phase-commit" ||
    commit.status !== "pre-effect-admitted" ||
    commit.eventId !== receipt.admissionCommitEventId ||
    !canonicalEqual(
      verification.verifierIdentity,
      receipt.authorityBindings.verifierIdentity,
    ) ||
    verification.evidenceSha256 !== receipt.verificationEvidenceSha256
  )
    return failure("m9b13e3:admission-chronology-not-exact");
  for (const census of [initial, preAdmission]) {
    const derived = await validateCensusDerivation(census);
    if (!derived.ok) return derived;
    if (
      !canonicalEqual(
        census.collectorIdentity,
        receipt.authorityBindings.collectorIdentity,
      )
    )
      return failure("m9b13e3:admission-census-collector-mismatch");
  }
  return { ok: true, value: true };
}

export type M9b13e3StructuralSummary = Readonly<{
  result: "structurally-valid-nonauthoritative";
  protocol:
    | typeof M9B13E3_PRE_EFFECT_ADMISSION_PROTOCOL
    | typeof M9B13E3_MONITORING_PROTOCOL
    | typeof M9B13E3_TERMINAL_RECEIPT_PROTOCOL;
  digest: string;
  grantsAdmissionAuthority: false;
  grantsEffectAuthority: false;
}>;

export async function validateM9b13e3PreEffectAdmission(
  value: unknown,
): Promise<ContractResult<M9b13e3StructuralSummary>> {
  const parsed = m9b13e3PreEffectAdmissionReceiptSchema.safeParse(value);
  if (!parsed.success)
    return failure("m9b13e3:pre-effect-admission-schema-rejected");
  const receipt = parsed.data;
  if (
    receipt.startCursor.nextSequence !== 0 ||
    receipt.startCursor.priorEventDigest !== null ||
    receipt.startCursor.priorMonotonicTimestampNanos !== null ||
    receipt.startCursor.priorLedgerRoot !==
      receipt.authorityBindings.trustedInitialLedgerRoot ||
    receipt.sessionCommitment !== receipt.startCursor.sessionCommitment
  )
    return failure("m9b13e3:admission-start-cursor-invalid");
  const stream = await validateEventStream(receipt.events, receipt.startCursor);
  if (!stream.ok) return stream;
  const chronology = await validateAdmissionChronology(receipt);
  if (!chronology.ok) return chronology;
  const digest = await digestM9b13e3PreEffectAdmission(receipt);
  if (!digest.ok || digest.value !== receipt.canonicalReceiptDigest)
    return failure("m9b13e3:admission-receipt-digest-mismatch");
  return {
    ok: true,
    value: {
      result: "structurally-valid-nonauthoritative",
      protocol: M9B13E3_PRE_EFFECT_ADMISSION_PROTOCOL,
      digest: digest.value,
      grantsAdmissionAuthority: false,
      grantsEffectAuthority: false,
    },
  };
}

async function validateMonitoringChronology(
  receipt: M9b13e3MonitoringReceipt,
): Promise<ContractResult<true>> {
  const events = receipt.events;
  const monitoringCommit = eventAt(events, 1);
  if (
    !transitionIs(eventAt(events, 0), "admitted-clean", "acquisition-active") ||
    monitoringCommit?.kind !== "phase-commit" ||
    monitoringCommit.status !== "active-monitoring" ||
    monitoringCommit.eventId !== receipt.monitoringCommitEventId
  )
    return failure("m9b13e3:monitoring-start-not-exact");
  let index = 2;
  const usedCensusRoles = new Set<string>();
  while (eventAt(events, index)?.kind === "boundary-reservation") {
    const reservation = eventAt(events, index);
    const before = eventAt(events, index + 1);
    const dispatch = eventAt(events, index + 2);
    const completion = eventAt(events, index + 3);
    const after = eventAt(events, index + 4);
    if (
      reservation?.kind !== "boundary-reservation" ||
      before?.kind !== "census" ||
      before.censusKind !== "before-consequential-boundary" ||
      before.referenceEventId !== reservation.eventId ||
      before.boundaryIdentity !== reservation.boundaryIdentity ||
      dispatch?.kind !== "boundary-dispatch-effect" ||
      dispatch.boundaryIdentity !== reservation.boundaryIdentity ||
      dispatch.reservationEventId !== reservation.eventId ||
      dispatch.censusEventId !== before.eventId ||
      completion?.kind !== "completion" ||
      completion.boundaryIdentity !== reservation.boundaryIdentity ||
      completion.dispatchEventId !== dispatch.eventId ||
      after?.kind !== "census" ||
      after.censusKind !== "after-completion" ||
      after.referenceEventId !== completion.eventId ||
      after.boundaryIdentity !== reservation.boundaryIdentity
    )
      return failure("m9b13e3:boundary-census-chronology-not-exact");
    for (const census of [before, after]) {
      if (usedCensusRoles.has(census.eventId))
        return failure("m9b13e3:census-role-reused");
      usedCensusRoles.add(census.eventId);
      const derived = await validateCensusDerivation(census);
      if (!derived.ok) return derived;
      if (
        !canonicalEqual(
          census.collectorIdentity,
          receipt.authorityBindings.collectorIdentity,
        )
      )
        return failure("m9b13e3:monitoring-census-collector-mismatch");
    }
    index += 5;
  }
  const verification = eventAt(events, index);
  const preSeal = eventAt(events, index + 1);
  if (
    index + 2 !== events.length ||
    !transitionIs(verification, "acquisition-active", "verification-active") ||
    preSeal?.kind !== "census" ||
    preSeal.censusKind !== "pre-seal" ||
    preSeal.referenceEventId !== verification?.eventId ||
    preSeal.boundaryIdentity !== null
  )
    return failure("m9b13e3:pre-seal-chronology-not-exact");
  const derived = await validateCensusDerivation(preSeal);
  if (!derived.ok) return derived;
  return canonicalEqual(
    preSeal.collectorIdentity,
    receipt.authorityBindings.collectorIdentity,
  )
    ? { ok: true, value: true }
    : failure("m9b13e3:pre-seal-collector-mismatch");
}

function cursorAfterEvents(
  events: ReadonlyArray<M9b13e3Event>,
): M9b13e3EventCursor | null {
  const last = events.at(-1);
  return last === undefined
    ? null
    : {
        sessionCommitment: last.sessionCommitment,
        nextSequence: last.sequence + 1,
        priorMonotonicTimestampNanos: last.monotonicTimestampNanos,
        priorEventDigest: last.currentEventDigest,
        nextLedgerRevision: last.ledgerRevision + 1,
        priorLedgerRoot: last.resultingLedgerRoot,
      };
}

export async function validateM9b13e3Monitoring(
  value: unknown,
  admissionValue: unknown,
): Promise<ContractResult<M9b13e3StructuralSummary>> {
  const admissionParsed =
    m9b13e3PreEffectAdmissionReceiptSchema.safeParse(admissionValue);
  const parsed = m9b13e3MonitoringReceiptSchema.safeParse(value);
  if (!admissionParsed.success || !parsed.success)
    return failure("m9b13e3:monitoring-or-admission-schema-rejected");
  const admissionResult = await validateM9b13e3PreEffectAdmission(
    admissionParsed.data,
  );
  if (!admissionResult.ok) return admissionResult;
  const receipt = parsed.data;
  const expectedStart = cursorAfterEvents(admissionParsed.data.events);
  if (
    expectedStart === null ||
    !canonicalEqual(receipt.startCursor, expectedStart) ||
    receipt.admissionReceiptDigest !==
      admissionParsed.data.canonicalReceiptDigest ||
    receipt.sessionCommitment !== admissionParsed.data.sessionCommitment ||
    !canonicalEqual(
      receipt.authorityBindings,
      admissionParsed.data.authorityBindings,
    )
  )
    return failure("m9b13e3:monitoring-admission-cross-binding-mismatch");
  const stream = await validateEventStream(receipt.events, receipt.startCursor);
  if (!stream.ok) return stream;
  const chronology = await validateMonitoringChronology(receipt);
  if (!chronology.ok) return chronology;
  const digest = await digestM9b13e3Monitoring(receipt);
  if (!digest.ok || digest.value !== receipt.canonicalMonitoringDigest)
    return failure("m9b13e3:monitoring-digest-mismatch");
  return {
    ok: true,
    value: {
      result: "structurally-valid-nonauthoritative",
      protocol: M9B13E3_MONITORING_PROTOCOL,
      digest: digest.value,
      grantsAdmissionAuthority: false,
      grantsEffectAuthority: false,
    },
  };
}

async function validateTerminalChronology(
  receipt: M9b13e3TerminalReceipt,
): Promise<ContractResult<true>> {
  const events = receipt.events;
  if (receipt.decision === "trusted-session-completed") {
    const seal = eventAt(events, 0);
    const close = eventAt(events, 1);
    const terminal = eventAt(events, 2);
    const commit = eventAt(events, 3);
    if (
      events.length !== 4 ||
      seal?.kind !== "seal" ||
      close?.kind !== "terminal-close" ||
      close.from !== "sealed" ||
      terminal?.kind !== "census" ||
      terminal.censusKind !== "terminal" ||
      terminal.referenceEventId !== close.eventId ||
      terminal.boundaryIdentity !== null ||
      commit?.kind !== "phase-commit" ||
      commit.status !== "terminal-completed" ||
      commit.eventId !== receipt.terminalCommitEventId
    )
      return failure("m9b13e3:completed-terminal-chronology-not-exact");
    return validateCensusDerivation(terminal);
  }
  const loss = eventAt(events, 0);
  const stop = eventAt(events, 1);
  const close = eventAt(events, 2);
  const terminal = eventAt(events, 3);
  const commit = eventAt(events, 4);
  const expectedStatus =
    receipt.decision === "trusted-session-stopped"
      ? "terminal-stopped"
      : "terminal-quarantined";
  if (
    events.length !== 5 ||
    loss?.kind !== "invariant-loss" ||
    stop?.kind !== "stop" ||
    close?.kind !== "terminal-close" ||
    close.from !== "quarantined" ||
    terminal?.kind !== "census" ||
    terminal.censusKind !== "terminal" ||
    terminal.referenceEventId !== close.eventId ||
    terminal.boundaryIdentity !== null ||
    commit?.kind !== "phase-commit" ||
    commit.status !== expectedStatus ||
    commit.eventId !== receipt.terminalCommitEventId
  )
    return failure("m9b13e3:failed-terminal-chronology-not-exact");
  return validateCensusDerivation(terminal);
}

export async function validateM9b13e3TerminalReceipt(
  value: unknown,
  admissionValue: unknown,
  monitoringValue: unknown,
): Promise<ContractResult<M9b13e3StructuralSummary>> {
  const admission =
    m9b13e3PreEffectAdmissionReceiptSchema.safeParse(admissionValue);
  const monitoring = m9b13e3MonitoringReceiptSchema.safeParse(monitoringValue);
  const parsed = m9b13e3TerminalReceiptSchema.safeParse(value);
  if (!admission.success || !monitoring.success || !parsed.success)
    return failure("m9b13e3:terminal-lineage-schema-rejected");
  const monitoringResult = await validateM9b13e3Monitoring(
    monitoring.data,
    admission.data,
  );
  if (!monitoringResult.ok) return monitoringResult;
  const receipt = parsed.data;
  const expectedStart = cursorAfterEvents(monitoring.data.events);
  if (
    expectedStart === null ||
    !canonicalEqual(receipt.startCursor, expectedStart) ||
    receipt.admissionReceiptDigest !== admission.data.canonicalReceiptDigest ||
    receipt.monitoringLineageDigest !==
      monitoring.data.canonicalMonitoringDigest ||
    receipt.sessionCommitment !== admission.data.sessionCommitment ||
    !canonicalEqual(receipt.authorityBindings, admission.data.authorityBindings)
  )
    return failure("m9b13e3:terminal-lineage-cross-binding-mismatch");
  const stream = await validateEventStream(receipt.events, receipt.startCursor);
  if (!stream.ok) return stream;
  const chronology = await validateTerminalChronology(receipt);
  if (!chronology.ok) return chronology;
  const digest = await digestM9b13e3TerminalReceipt(receipt);
  if (!digest.ok || digest.value !== receipt.canonicalTerminalDigest)
    return failure("m9b13e3:terminal-digest-mismatch");
  return {
    ok: true,
    value: {
      result: "structurally-valid-nonauthoritative",
      protocol: M9B13E3_TERMINAL_RECEIPT_PROTOCOL,
      digest: digest.value,
      grantsAdmissionAuthority: false,
      grantsEffectAuthority: false,
    },
  };
}

const boundaryAuthorityProofSchema = z.strictObject({
  protocol: z.literal(M9B13E3_MONITORING_PROTOCOL),
  sessionCommitment: commitmentSchema,
  admissionReceiptDigest: sha256Schema,
  activeMonitoringCommit: phaseCommitEventSchema,
  reservation: reservationEventSchema,
  immediatePreBoundaryCensus: censusEventSchema,
  currentLedgerRoot: commitmentSchema,
  terminal: z.literal(false),
});

export async function validateSyntheticM9b13e3BoundaryAuthority(
  proofValue: unknown,
  admissionValue: unknown,
  trustedAuthorityValue: unknown,
): Promise<
  ContractResult<Readonly<{ result: "synthetic-boundary-authorized" }>>
> {
  const proof = boundaryAuthorityProofSchema.safeParse(proofValue);
  const admission =
    m9b13e3PreEffectAdmissionReceiptSchema.safeParse(admissionValue);
  const authority = authorityBindingsSchema.safeParse(trustedAuthorityValue);
  if (!proof.success || !admission.success || !authority.success)
    return failure("m9b13e3:boundary-authority-schema-rejected");
  const admissionResult = await validateM9b13e3PreEffectAdmission(
    admission.data,
  );
  if (!admissionResult.ok) return admissionResult;
  const active = proof.data.activeMonitoringCommit;
  const reservation = proof.data.reservation;
  const census = proof.data.immediatePreBoundaryCensus;
  const activeDigest = await digestM9b13e3Event(active);
  const reservationDigest = await digestM9b13e3Event(reservation);
  const censusDigest = await digestM9b13e3Event(census);
  if (
    proof.data.sessionCommitment !== admission.data.sessionCommitment ||
    proof.data.admissionReceiptDigest !==
      admission.data.canonicalReceiptDigest ||
    !canonicalEqual(admission.data.authorityBindings, authority.data) ||
    !activeDigest.ok ||
    activeDigest.value !== active.currentEventDigest ||
    active.status !== "active-monitoring" ||
    active.boundDigest !== proof.data.admissionReceiptDigest ||
    reservation.sequence !== active.sequence + 1 ||
    reservation.ledgerRevision !== active.ledgerRevision + 1 ||
    reservation.priorEventDigest !== active.currentEventDigest ||
    reservation.priorLedgerRoot !== active.resultingLedgerRoot ||
    !reservationDigest.ok ||
    reservationDigest.value !== reservation.currentEventDigest ||
    reservation.sessionCommitment !== proof.data.sessionCommitment ||
    census.sessionCommitment !== proof.data.sessionCommitment ||
    census.censusKind !== "before-consequential-boundary" ||
    census.referenceEventId !== reservation.eventId ||
    census.boundaryIdentity !== reservation.boundaryIdentity ||
    census.sequence !== reservation.sequence + 1 ||
    census.ledgerRevision !== reservation.ledgerRevision + 1 ||
    census.priorEventDigest !== reservation.currentEventDigest ||
    census.priorLedgerRoot !== reservation.resultingLedgerRoot ||
    !censusDigest.ok ||
    censusDigest.value !== census.currentEventDigest ||
    proof.data.currentLedgerRoot !== census.resultingLedgerRoot
  )
    return failure("m9b13e3:boundary-authority-not-immediate-or-current");
  return { ok: true, value: { result: "synthetic-boundary-authorized" } };
}

export type M9b13e3LiveStop = Readonly<{
  decision: "trusted-session-no-effect-stop";
  reason: "positive-readiness-authority-unavailable";
  effects: z.infer<typeof zeroEffectSchema>;
}>;

export type M9b13e3SyntheticAdmissionResult =
  | Readonly<{
      ok: true;
      receipt: M9b13e3PreEffectAdmissionReceipt;
    }>
  | Readonly<{
      ok: false;
      decision: "trusted-session-no-effect-stop";
      reason:
        | "malformed-or-inconsistent-evidence"
        | "authority-binding-mismatch"
        | "replay-or-ledger-conflict"
        | "persistence-ambiguous";
      effects: z.infer<typeof zeroEffectSchema>;
    }>;

export type M9b13e3SyntheticAdmissionHarness = Readonly<{
  protocol: typeof M9B13E3_SYNTHETIC_AUTHORITY_PROTOCOL;
  attempt: (value: unknown) => Promise<M9b13e3SyntheticAdmissionResult>;
}>;

export function createSyntheticM9b13e3AdmissionHarness(
  authorityValue: unknown,
  ledger: M9b13e3SyntheticLedgerControl,
): ContractResult<M9b13e3SyntheticAdmissionHarness> {
  const authority = authorityBindingsSchema.safeParse(authorityValue);
  if (!authority.success)
    return failure("m9b13e3:synthetic-admission-authority-invalid");
  const context = Object.freeze(authority.data);
  return {
    ok: true,
    value: {
      protocol: M9B13E3_SYNTHETIC_AUTHORITY_PROTOCOL,
      attempt: async (value): Promise<M9b13e3SyntheticAdmissionResult> => {
        const parsed = m9b13e3PreEffectAdmissionReceiptSchema.safeParse(value);
        if (!parsed.success)
          return {
            ok: false,
            decision: "trusted-session-no-effect-stop",
            reason: "malformed-or-inconsistent-evidence",
            effects: ZERO_EFFECTS,
          };
        const structural = await validateM9b13e3PreEffectAdmission(parsed.data);
        if (!structural.ok)
          return {
            ok: false,
            decision: "trusted-session-no-effect-stop",
            reason: "malformed-or-inconsistent-evidence",
            effects: ZERO_EFFECTS,
          };
        if (!canonicalEqual(parsed.data.authorityBindings, context))
          return {
            ok: false,
            decision: "trusted-session-no-effect-stop",
            reason: "authority-binding-mismatch",
            effects: ZERO_EFFECTS,
          };
        const initial = ledger.snapshot();
        if (
          initial.namespace !== context.ledgerNamespace ||
          initial.trustedInitialRoot !== context.trustedInitialLedgerRoot ||
          initial.sessions.some(
            (session) =>
              session.sessionCommitment === parsed.data.sessionCommitment,
          )
        )
          return {
            ok: false,
            decision: "trusted-session-no-effect-stop",
            reason: "replay-or-ledger-conflict",
            effects: ZERO_EFFECTS,
          };
        for (const event of parsed.data.events) {
          const before = ledger.snapshot();
          const write = await ledger.compareAndSwap(
            before.revision,
            before.root,
            event,
          );
          if (!write.ok)
            return {
              ok: false,
              decision: "trusted-session-no-effect-stop",
              reason:
                write.error.kind === "persistence-ambiguous"
                  ? "persistence-ambiguous"
                  : "replay-or-ledger-conflict",
              effects: ZERO_EFFECTS,
            };
        }
        return { ok: true, receipt: parsed.data };
      },
    },
  };
}

export const M9B13E3_LIVE_POSITIVE_AUTHORITY = null;
export const M9B13E3_LIVE_SUBMISSION_AUTHORITY = null;

export function attemptLiveM9b13e3Admission(_value: unknown): M9b13e3LiveStop {
  void _value;
  return {
    decision: "trusted-session-no-effect-stop",
    reason: "positive-readiness-authority-unavailable",
    effects: ZERO_EFFECTS,
  };
}

export function attemptLiveM9b13e3BoundaryEffect(
  _value: unknown,
): M9b13e3LiveStop {
  void _value;
  return attemptLiveM9b13e3Admission(null);
}

export function attemptLiveM9b13e3SupplementSubmission(
  _value: unknown,
): M9b13e3LiveStop {
  void _value;
  return attemptLiveM9b13e3Admission(null);
}

const archiveFileSchema: z.ZodType<M9b13e1ArchiveFile> = z.strictObject({
  name: nonemptySchema,
  version: z.literal(1),
  sha256: sha256Schema,
});

const checksumEntrySchema = z.strictObject({
  path: nonemptySchema,
  sha256: sha256Schema,
});

export const m9b13e3SupplementBodySchema = z.strictObject({
  protocol: z.literal(M9B13E3_SUPPLEMENT_BODY_PROTOCOL),
  bodyIdentity: nonemptySchema,
  bodyCanonicalDigest: sha256Schema,
  bodyFrozenTimestamp: timestampSchema,
  amendedAssumption: z.literal(M9B13E2_AMENDED_ASSUMPTION),
  nonclaim: z.literal(M9B13E2_NONCLAIM),
  retainedScope: z.literal(M9B13E2_RETAINED_SCOPE),
  registration: z.strictObject({
    id: z.literal("63sh5"),
    immutableFiles: z.array(archiveFileSchema).length(27),
    preregistrationDigest: z.literal(
      "097d4848a264fc8484ca590c79388e3a00279a6310392205db7868104cee13b4",
    ),
    manifestDigest: z.literal(
      "5e53f4aeb8bf22213692557023b695bf88013372c8b235a7f844fdcf5545b189",
    ),
  }),
  scientificFinancialProjectionDigest: z.literal(
    "e5cd02100a1004849acc18f3f302e880580a38ef45a0733868826c32a23ff282",
  ),
  embargo: z.strictObject({
    protectedThrough: z.literal("2030-08-01T00:00:00Z"),
    atLeastOriginalRestriction: z.literal(true),
    publicViewOnlyLinkCount: z.literal(0),
  }),
  historicalNoGos: z.array(nonemptySchema).min(9),
  checksumInventory: z.array(checksumEntrySchema).min(1),
  checksumManifestDigest: sha256Schema,
});

export type M9b13e3SupplementBody = z.infer<typeof m9b13e3SupplementBodySchema>;

export const m9b13e3SupplementReviewSchema = z.strictObject({
  protocol: z.literal(M9B13E3_SUPPLEMENT_REVIEW_PROTOCOL),
  reviewPackageIdentity: nonemptySchema,
  reviewPackageCanonicalDigest: sha256Schema,
  supplementBodyProtocol: z.literal(M9B13E3_SUPPLEMENT_BODY_PROTOCOL),
  supplementBodyDigest: sha256Schema,
  supplementBodyCommit: gitIdentitySchema,
  supplementBodyTree: gitIdentitySchema,
  supplementBodyChecksumManifestDigest: sha256Schema,
  reviewerIdentityCommitment: commitmentSchema,
  reviewEvidenceSha256: sha256Schema,
  decision: z.literal("pass"),
  bodyFrozenTimestamp: timestampSchema,
  reviewTimestamp: timestampSchema,
  checks: z.strictObject({
    prospective: z.literal(true),
    embargoPreserved: z.literal(true),
    scientificInvariancePreserved: z.literal(true),
    exactAssumptionAndNonclaims: z.literal(true),
  }),
});

export type M9b13e3SupplementReview = z.infer<
  typeof m9b13e3SupplementReviewSchema
>;

function supplementBodyProjection(
  body: M9b13e3SupplementBody,
): Readonly<Record<string, unknown>> {
  const { bodyCanonicalDigest: omitted, ...projection } = body;
  void omitted;
  return projection;
}

function supplementReviewProjection(
  review: M9b13e3SupplementReview,
): Readonly<Record<string, unknown>> {
  const { reviewPackageCanonicalDigest: omitted, ...projection } = review;
  void omitted;
  return projection;
}

export async function digestM9b13e3SupplementBody(
  body: M9b13e3SupplementBody,
): Promise<ContractResult<string>> {
  return digestOrFailure(supplementBodyProjection(body));
}

export async function digestM9b13e3SupplementReview(
  review: M9b13e3SupplementReview,
): Promise<ContractResult<string>> {
  return digestOrFailure(supplementReviewProjection(review));
}

export async function validateM9b13e3SupplementBody(
  value: unknown,
): Promise<ContractResult<M9b13e3SupplementBody>> {
  const parsed = m9b13e3SupplementBodySchema.safeParse(value);
  if (!parsed.success)
    return failure("m9b13e3:supplement-body-schema-rejected");
  const body = parsed.data;
  const manifestDigest = await digestOrFailure(body.checksumInventory);
  const bodyDigest = await digestM9b13e3SupplementBody(body);
  const expectedNoGos = new Set([
    "M9b.13",
    "M9b.13a",
    "M9b.13b",
    "M9b.13c",
    "M9b.13d",
    "M9b.13d.1",
    "M9b.13e-and-independent-review",
    "M9b.13e.1-and-independent-review",
    "M9b.13e.2-and-independent-review",
  ]);
  for (const historical of body.historicalNoGos)
    expectedNoGos.delete(historical);
  if (
    !manifestDigest.ok ||
    manifestDigest.value !== body.checksumManifestDigest ||
    !bodyDigest.ok ||
    bodyDigest.value !== body.bodyCanonicalDigest ||
    !canonicalEqual(
      body.registration.immutableFiles,
      M9B13E1_REGISTERED_ARCHIVE_FILES,
    ) ||
    expectedNoGos.size !== 0
  )
    return failure("m9b13e3:supplement-body-identity-or-lineage-mismatch");
  return { ok: true, value: body };
}

export async function validateM9b13e3SupplementReview(
  reviewValue: unknown,
  bodyValue: unknown,
): Promise<ContractResult<M9b13e3SupplementReview>> {
  const reviewParsed = m9b13e3SupplementReviewSchema.safeParse(reviewValue);
  const bodyResult = await validateM9b13e3SupplementBody(bodyValue);
  if (!reviewParsed.success || !bodyResult.ok)
    return failure("m9b13e3:supplement-review-or-body-invalid");
  const review = reviewParsed.data;
  const reviewDigest = await digestM9b13e3SupplementReview(review);
  if (
    !reviewDigest.ok ||
    reviewDigest.value !== review.reviewPackageCanonicalDigest ||
    review.supplementBodyDigest !== bodyResult.value.bodyCanonicalDigest ||
    review.supplementBodyChecksumManifestDigest !==
      bodyResult.value.checksumManifestDigest ||
    review.bodyFrozenTimestamp !== bodyResult.value.bodyFrozenTimestamp ||
    Date.parse(review.reviewTimestamp) <=
      Date.parse(bodyResult.value.bodyFrozenTimestamp)
  )
    return failure("m9b13e3:supplement-review-cross-binding-or-order-invalid");
  return { ok: true, value: review };
}

type SyntheticSubmissionContext = Readonly<{
  protocol: typeof M9B13E3_SUPPLEMENT_SUBMISSION_PROTOCOL;
  frozenBodyDigest: string;
  frozenReviewDigest: string;
  reviewedCommit: string;
  reviewedTree: string;
  acceptedDecision: "pass";
  submissionAuthorizationIdentity: string;
  submissionAuthorizationTimestamp: string;
  registryMechanismIdentity: string;
  embargoPolicyIdentity: string;
}>;

export type M9b13e3SyntheticSubmissionHarness = Readonly<{
  protocol: typeof M9B13E3_SYNTHETIC_AUTHORITY_PROTOCOL;
  attempt: (
    bodyValue: unknown,
    reviewValue: unknown,
  ) => Promise<
    ContractResult<Readonly<{ decision: "synthetic-submission-authorized" }>>
  >;
}>;

export function createSyntheticM9b13e3SubmissionHarness(
  contextValue: SyntheticSubmissionContext,
): M9b13e3SyntheticSubmissionHarness {
  const context = Object.freeze({ ...contextValue });
  return {
    protocol: M9B13E3_SYNTHETIC_AUTHORITY_PROTOCOL,
    attempt: async (bodyValue, reviewValue) => {
      const review = await validateM9b13e3SupplementReview(
        reviewValue,
        bodyValue,
      );
      if (!review.ok)
        return failure("m9b13e3:submission-structural-review-invalid");
      if (
        review.value.supplementBodyDigest !== context.frozenBodyDigest ||
        review.value.reviewPackageCanonicalDigest !==
          context.frozenReviewDigest ||
        review.value.supplementBodyCommit !== context.reviewedCommit ||
        review.value.supplementBodyTree !== context.reviewedTree ||
        Date.parse(review.value.reviewTimestamp) >=
          Date.parse(context.submissionAuthorizationTimestamp)
      )
        return failure("m9b13e3:submission-authority-binding-mismatch");
      return {
        ok: true,
        value: { decision: "synthetic-submission-authorized" },
      };
    },
  };
}
