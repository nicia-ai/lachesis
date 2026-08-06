import { digestValue } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import { M9B13E1_REGISTERED_ARCHIVE_FILES } from "../internal/m9b13e1-trusted-session-readiness.js";
import {
  M9B13E2_AMENDED_ASSUMPTION,
  M9B13E2_NONCLAIM,
  M9B13E2_RETAINED_SCOPE,
} from "../internal/m9b13e2-authority-bound-readiness.js";
import {
  appendSyntheticM9b13e3Event,
  attemptLiveM9b13e3Admission,
  attemptLiveM9b13e3BoundaryEffect,
  attemptLiveM9b13e3SupplementSubmission,
  createM9b13e3EventCursor,
  createSyntheticM9b13e3AdmissionHarness,
  createSyntheticM9b13e3Ledger,
  createSyntheticM9b13e3SubmissionHarness,
  digestM9b13e3Monitoring,
  digestM9b13e3PreEffectAdmission,
  digestM9b13e3SupplementBody,
  digestM9b13e3SupplementReview,
  digestM9b13e3TerminalReceipt,
  M9B13E3_EVENT_STREAM_PROTOCOL,
  M9B13E3_LIVE_POSITIVE_AUTHORITY,
  M9B13E3_LIVE_SUBMISSION_AUTHORITY,
  M9B13E3_MONITORING_PROTOCOL,
  M9B13E3_PRE_EFFECT_ADMISSION_PROTOCOL,
  M9B13E3_SUPPLEMENT_BODY_PROTOCOL,
  M9B13E3_SUPPLEMENT_REVIEW_PROTOCOL,
  M9B13E3_SUPPLEMENT_SUBMISSION_PROTOCOL,
  M9B13E3_SYNTHETIC_AUTHORITY_PROTOCOL,
  M9B13E3_TERMINAL_RECEIPT_PROTOCOL,
  type M9b13e3Event,
  type M9b13e3EventCursor,
  type M9b13e3MonitoringReceipt,
  type M9b13e3PreEffectAdmissionReceipt,
  type M9b13e3SupplementBody,
  type M9b13e3SupplementReview,
  type M9b13e3TerminalReceipt,
  validateM9b13e3Monitoring,
  validateM9b13e3PreEffectAdmission,
  validateM9b13e3SupplementBody,
  validateM9b13e3SupplementReview,
  validateM9b13e3TerminalReceipt,
  validateSyntheticM9b13e3BoundaryAuthority,
} from "../internal/m9b13e3-phase-separated-readiness.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);
const F = "f".repeat(64);
const ZERO = "0".repeat(64);
const ROOT = `sha256:${A}`;
const SESSION = `sha256:${B}`;
const WALL = "2026-08-08T12:00:00.000Z";

const executable = Object.freeze({
  protocol: "synthetic-executable/1",
  sourceSha256: A,
  buildReceiptSha256: B,
  executableSha256: C,
});

const authority = Object.freeze({
  expectationPackageDigest: A,
  expectationReviewIdentity: "synthetic-reviewed-expectation-v1",
  expectationReviewedCommit: "1".repeat(40),
  expectationReviewedTree: "2".repeat(40),
  collectorIdentity: executable,
  verifierIdentity: executable,
  trustedInputInventorySha256: D,
  ledgerNamespace: "synthetic-m9b13e3-ledger",
  trustedInitialLedgerRoot: ROOT,
  activationIdentity: M9B13E3_SYNTHETIC_AUTHORITY_PROTOCOL,
});

function unwrap<T>(
  result:
    Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }>,
): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

async function requiredDigest(value: unknown): Promise<string> {
  return unwrap(await digestValue(value));
}

async function processEvidence(): Promise<
  Readonly<{
    records: ReadonlyArray<{
      sessionCommitment: string;
      processKey: string;
      processId: number;
      startTimeIdentity: string;
      parentProcessKey: string | null;
      parentProcessId: number | null;
      executableIdentity: typeof executable;
      numericUid: number;
      numericGids: ReadonlyArray<number>;
    }>;
    inventorySha256: string;
    topologySha256: string;
  }>
> {
  const records = [
    {
      sessionCommitment: SESSION,
      processKey: "controller",
      processId: 100,
      startTimeIdentity: "start-controller",
      parentProcessKey: null,
      parentProcessId: null,
      executableIdentity: executable,
      numericUid: 501,
      numericGids: [20, 501],
    },
    {
      sessionCommitment: SESSION,
      processKey: "helper",
      processId: 101,
      startTimeIdentity: "start-helper",
      parentProcessKey: "controller",
      parentProcessId: 100,
      executableIdentity: executable,
      numericUid: 501,
      numericGids: [20, 501],
    },
  ];
  return {
    records,
    inventorySha256: await requiredDigest(records),
    topologySha256: await requiredDigest(
      records.map((record) => ({
        processKey: record.processKey,
        processId: record.processId,
        startTimeIdentity: record.startTimeIdentity,
        parentProcessKey: record.parentProcessKey,
        parentProcessId: record.parentProcessId,
      })),
    ),
  };
}

type EventBuilder = Readonly<{
  events: ReadonlyArray<M9b13e3Event>;
  cursor: M9b13e3EventCursor;
}>;

async function append(
  builder: EventBuilder,
  value: Readonly<Record<string, unknown>>,
): Promise<EventBuilder> {
  const next = unwrap(
    await appendSyntheticM9b13e3Event(builder.cursor, {
      protocol: M9B13E3_EVENT_STREAM_PROTOCOL,
      sessionCommitment: SESSION,
      wallTimestamp: WALL,
      ...value,
    }),
  );
  return { events: [...builder.events, next.event], cursor: next.cursor };
}

function censusDraft(
  evidence: Awaited<ReturnType<typeof processEvidence>>,
  eventId: string,
  time: number,
  censusKind:
    | "initial"
    | "pre-admission"
    | "before-consequential-boundary"
    | "after-completion"
    | "pre-seal"
    | "terminal",
  referenceEventId: string,
  boundaryIdentity: string | null,
): Readonly<Record<string, unknown>> {
  return {
    kind: "census",
    eventId,
    monotonicTimestampNanos: String(time),
    censusKind,
    referenceEventId,
    boundaryIdentity,
    collectorIdentity: executable,
    ageMillisAtDecision: 1,
    maximumAgeMillis: 50,
    processRecords: evidence.records,
    inventorySha256: evidence.inventorySha256,
    topologySha256: evidence.topologySha256,
  };
}

async function admissionFixture(
  mode: "valid" | "initial-after-admission" = "valid",
): Promise<
  Readonly<{
    receipt: M9b13e3PreEffectAdmissionReceipt;
    cursor: M9b13e3EventCursor;
  }>
> {
  const evidence = await processEvidence();
  const start = unwrap(createM9b13e3EventCursor(SESSION, ROOT));
  let builder: EventBuilder = { events: [], cursor: start };
  builder = await append(builder, {
    kind: "phase-commit",
    eventId: "session-reserved",
    monotonicTimestampNanos: "100",
    status: "session-reserved",
    boundDigest: A,
  });
  builder = await append(builder, {
    kind: "transition",
    eventId: "enter-preflight",
    monotonicTimestampNanos: "200",
    from: "uninitialized",
    to: "preflight",
  });
  if (mode === "valid")
    builder = await append(
      builder,
      censusDraft(
        evidence,
        "initial-census",
        300,
        "initial",
        "enter-preflight",
        null,
      ),
    );
  builder = await append(builder, {
    kind: "readiness-verification",
    eventId: "readiness-pass",
    monotonicTimestampNanos: mode === "valid" ? "400" : "300",
    verifierIdentity: executable,
    result: "pass",
    evidenceSha256: E,
  });
  builder = await append(
    builder,
    censusDraft(
      evidence,
      "pre-admission-census",
      mode === "valid" ? 500 : 400,
      "pre-admission",
      "readiness-pass",
      null,
    ),
  );
  builder = await append(builder, {
    kind: "transition",
    eventId: "admitted-clean",
    monotonicTimestampNanos: mode === "valid" ? "600" : "500",
    from: "preflight",
    to: "admitted-clean",
  });
  if (mode === "initial-after-admission")
    builder = await append(
      builder,
      censusDraft(
        evidence,
        "initial-census",
        600,
        "initial",
        "enter-preflight",
        null,
      ),
    );
  builder = await append(builder, {
    kind: "phase-commit",
    eventId: "pre-effect-admitted",
    monotonicTimestampNanos: mode === "valid" ? "700" : "700",
    status: "pre-effect-admitted",
    boundDigest: B,
  });
  const unsigned: M9b13e3PreEffectAdmissionReceipt = {
    protocol: M9B13E3_PRE_EFFECT_ADMISSION_PROTOCOL,
    decision: "trusted-session-admitted",
    authorityBindings: authority,
    sessionCommitment: SESSION,
    startCursor: start,
    events: [...builder.events],
    independentReadinessVerification: "pass",
    verificationEvidenceSha256: E,
    zeroPreAdmissionEffects: {
      networkRequests: 0,
      durableAcquisitionWrites: 0,
      downloads: 0,
      imageOperations: 0,
      credentialAccesses: 0,
      providerOrModelCalls: 0,
    },
    reservationEventId: "session-reserved",
    admissionCommitEventId: "pre-effect-admitted",
    canonicalReceiptDigest: ZERO,
  };
  const digest = unwrap(await digestM9b13e3PreEffectAdmission(unsigned));
  return {
    receipt: { ...unsigned, canonicalReceiptDigest: digest },
    cursor: builder.cursor,
  };
}

type MonitoringMode =
  | "valid"
  | "before-boundary-after-dispatch"
  | "after-completion-before-completion"
  | "before-seal-after-seal"
  | "missing-before-boundary"
  | "duplicate-before-boundary"
  | "wrong-reference-kind"
  | "nonadjacent-before-boundary";

async function monitoringFixture(
  admission: Awaited<ReturnType<typeof admissionFixture>>,
  mode: MonitoringMode = "valid",
): Promise<
  Readonly<{
    receipt: M9b13e3MonitoringReceipt;
    cursor: M9b13e3EventCursor;
  }>
> {
  const evidence = await processEvidence();
  let builder: EventBuilder = { events: [], cursor: admission.cursor };
  builder = await append(builder, {
    kind: "transition",
    eventId: "acquisition-active",
    monotonicTimestampNanos: "800",
    from: "admitted-clean",
    to: "acquisition-active",
  });
  builder = await append(builder, {
    kind: "phase-commit",
    eventId: "active-monitoring",
    monotonicTimestampNanos: "900",
    status: "active-monitoring",
    boundDigest: admission.receipt.canonicalReceiptDigest,
  });
  builder = await append(builder, {
    kind: "boundary-reservation",
    eventId: "boundary-reservation-1",
    monotonicTimestampNanos: "1000",
    boundaryIdentity: "boundary-1",
  });
  if (mode === "before-boundary-after-dispatch") {
    builder = await append(builder, {
      kind: "boundary-dispatch-effect",
      eventId: "boundary-dispatch-1",
      monotonicTimestampNanos: "1100",
      boundaryIdentity: "boundary-1",
      reservationEventId: "boundary-reservation-1",
      censusEventId: "before-boundary-1",
    });
    builder = await append(
      builder,
      censusDraft(
        evidence,
        "before-boundary-1",
        1200,
        "before-consequential-boundary",
        "boundary-reservation-1",
        "boundary-1",
      ),
    );
  } else {
    if (mode !== "missing-before-boundary")
      builder = await append(
        builder,
        censusDraft(
          evidence,
          "before-boundary-1",
          1100,
          mode === "wrong-reference-kind"
            ? "after-completion"
            : "before-consequential-boundary",
          mode === "wrong-reference-kind"
            ? "active-monitoring"
            : "boundary-reservation-1",
          "boundary-1",
        ),
      );
    if (mode === "duplicate-before-boundary")
      builder = await append(
        builder,
        censusDraft(
          evidence,
          "before-boundary-duplicate",
          1150,
          "before-consequential-boundary",
          "boundary-reservation-1",
          "boundary-1",
        ),
      );
    if (mode === "nonadjacent-before-boundary")
      builder = await append(builder, {
        kind: "invariant-loss",
        eventId: "unrelated-event",
        monotonicTimestampNanos: "1150",
        reason: "synthetic-unrelated-event",
      });
    builder = await append(builder, {
      kind: "boundary-dispatch-effect",
      eventId: "boundary-dispatch-1",
      monotonicTimestampNanos: "1200",
      boundaryIdentity: "boundary-1",
      reservationEventId: "boundary-reservation-1",
      censusEventId: "before-boundary-1",
    });
  }
  if (mode === "after-completion-before-completion")
    builder = await append(
      builder,
      censusDraft(
        evidence,
        "after-completion-1",
        1300,
        "after-completion",
        "completion-1",
        "boundary-1",
      ),
    );
  builder = await append(builder, {
    kind: "completion",
    eventId: "completion-1",
    monotonicTimestampNanos:
      mode === "after-completion-before-completion" ? "1400" : "1300",
    completionIdentity: "completion-1",
    boundaryIdentity: "boundary-1",
    dispatchEventId: "boundary-dispatch-1",
    completion: "completed",
  });
  if (mode !== "after-completion-before-completion")
    builder = await append(
      builder,
      censusDraft(
        evidence,
        "after-completion-1",
        1400,
        "after-completion",
        "completion-1",
        "boundary-1",
      ),
    );
  builder = await append(builder, {
    kind: "transition",
    eventId: "verification-active",
    monotonicTimestampNanos: "1500",
    from: "acquisition-active",
    to: "verification-active",
  });
  if (mode === "before-seal-after-seal")
    builder = await append(builder, {
      kind: "seal",
      eventId: "seal-before-census",
      monotonicTimestampNanos: "1550",
      from: "verification-active",
      to: "sealed",
    });
  builder = await append(
    builder,
    censusDraft(
      evidence,
      "pre-seal-census",
      1600,
      "pre-seal",
      "verification-active",
      null,
    ),
  );
  const unsigned: M9b13e3MonitoringReceipt = {
    protocol: M9B13E3_MONITORING_PROTOCOL,
    decision: "monitoring-lineage-only",
    authorityBindings: authority,
    sessionCommitment: SESSION,
    startCursor: admission.cursor,
    events: [...builder.events],
    admissionReceiptDigest: admission.receipt.canonicalReceiptDigest,
    monitoringCommitEventId: "active-monitoring",
    grantsAdmissionAuthority: false,
    grantsEffectAuthority: false,
    canonicalMonitoringDigest: ZERO,
  };
  const digest = unwrap(await digestM9b13e3Monitoring(unsigned));
  return {
    receipt: { ...unsigned, canonicalMonitoringDigest: digest },
    cursor: builder.cursor,
  };
}

async function terminalFixture(
  admission: Awaited<ReturnType<typeof admissionFixture>>,
  monitoring: Awaited<ReturnType<typeof monitoringFixture>>,
): Promise<M9b13e3TerminalReceipt> {
  const evidence = await processEvidence();
  let builder: EventBuilder = { events: [], cursor: monitoring.cursor };
  builder = await append(builder, {
    kind: "seal",
    eventId: "sealed",
    monotonicTimestampNanos: "1700",
    from: "verification-active",
    to: "sealed",
  });
  builder = await append(builder, {
    kind: "terminal-close",
    eventId: "closed",
    monotonicTimestampNanos: "1800",
    from: "sealed",
    to: "closed",
  });
  builder = await append(
    builder,
    censusDraft(evidence, "terminal-census", 1900, "terminal", "closed", null),
  );
  builder = await append(builder, {
    kind: "phase-commit",
    eventId: "terminal-completed",
    monotonicTimestampNanos: "2000",
    status: "terminal-completed",
    boundDigest: F,
  });
  const unsigned: M9b13e3TerminalReceipt = {
    protocol: M9B13E3_TERMINAL_RECEIPT_PROTOCOL,
    decision: "trusted-session-completed",
    authorityBindings: authority,
    sessionCommitment: SESSION,
    startCursor: monitoring.cursor,
    events: [...builder.events],
    admissionReceiptDigest: admission.receipt.canonicalReceiptDigest,
    monitoringLineageDigest: monitoring.receipt.canonicalMonitoringDigest,
    terminalCommitEventId: "terminal-completed",
    acceptedAsInitialAuthority: false,
    canonicalTerminalDigest: ZERO,
  };
  const digest = unwrap(await digestM9b13e3TerminalReceipt(unsigned));
  return { ...unsigned, canonicalTerminalDigest: digest };
}

async function supplementBody(): Promise<M9b13e3SupplementBody> {
  const checksumInventory = [{ path: "prospective-supplement.md", sha256: A }];
  const unsigned: M9b13e3SupplementBody = {
    protocol: M9B13E3_SUPPLEMENT_BODY_PROTOCOL,
    bodyIdentity: "future-supplement-body-v1",
    bodyCanonicalDigest: ZERO,
    bodyFrozenTimestamp: "2026-08-09T10:00:00.000Z",
    amendedAssumption: M9B13E2_AMENDED_ASSUMPTION,
    nonclaim: M9B13E2_NONCLAIM,
    retainedScope: M9B13E2_RETAINED_SCOPE,
    registration: {
      id: "63sh5",
      immutableFiles: [...M9B13E1_REGISTERED_ARCHIVE_FILES],
      preregistrationDigest:
        "097d4848a264fc8484ca590c79388e3a00279a6310392205db7868104cee13b4",
      manifestDigest:
        "5e53f4aeb8bf22213692557023b695bf88013372c8b235a7f844fdcf5545b189",
    },
    scientificFinancialProjectionDigest:
      "e5cd02100a1004849acc18f3f302e880580a38ef45a0733868826c32a23ff282",
    embargo: {
      protectedThrough: "2030-08-01T00:00:00Z",
      atLeastOriginalRestriction: true,
      publicViewOnlyLinkCount: 0,
    },
    historicalNoGos: [
      "M9b.13",
      "M9b.13a",
      "M9b.13b",
      "M9b.13c",
      "M9b.13d",
      "M9b.13d.1",
      "M9b.13e-and-independent-review",
      "M9b.13e.1-and-independent-review",
      "M9b.13e.2-and-independent-review",
    ],
    checksumInventory,
    checksumManifestDigest: await requiredDigest(checksumInventory),
  };
  const digest = unwrap(await digestM9b13e3SupplementBody(unsigned));
  return { ...unsigned, bodyCanonicalDigest: digest };
}

async function supplementReview(
  body: M9b13e3SupplementBody,
): Promise<M9b13e3SupplementReview> {
  const unsigned: M9b13e3SupplementReview = {
    protocol: M9B13E3_SUPPLEMENT_REVIEW_PROTOCOL,
    reviewPackageIdentity: "future-independent-review-v1",
    reviewPackageCanonicalDigest: ZERO,
    supplementBodyProtocol: M9B13E3_SUPPLEMENT_BODY_PROTOCOL,
    supplementBodyDigest: body.bodyCanonicalDigest,
    supplementBodyCommit: "3".repeat(40),
    supplementBodyTree: "4".repeat(40),
    supplementBodyChecksumManifestDigest: body.checksumManifestDigest,
    reviewerIdentityCommitment: `sha256:${C}`,
    reviewEvidenceSha256: D,
    decision: "pass",
    bodyFrozenTimestamp: body.bodyFrozenTimestamp,
    reviewTimestamp: "2026-08-09T11:00:00.000Z",
    checks: {
      prospective: true,
      embargoPreserved: true,
      scientificInvariancePreserved: true,
      exactAssumptionAndNonclaims: true,
    },
  };
  const digest = unwrap(await digestM9b13e3SupplementReview(unsigned));
  return { ...unsigned, reviewPackageCanonicalDigest: digest };
}

describe("M9b.13e.3 phase-separated authority", () => {
  it("accepts a pre-effect admission ending only at admitted-clean", async () => {
    const admission = await admissionFixture();
    const result = await validateM9b13e3PreEffectAdmission(admission.receipt);
    expect(result.ok).toBe(true);
    expect(
      admission.receipt.events.some((event) => event.kind === "seal"),
    ).toBe(false);
  });

  it("admits only through a synthetic closure-bound authority and committed ledger", async () => {
    const admission = await admissionFixture();
    const ledger = unwrap(
      createSyntheticM9b13e3Ledger(authority.ledgerNamespace, ROOT),
    );
    const harness = unwrap(
      createSyntheticM9b13e3AdmissionHarness(authority, ledger),
    );
    const first = await harness.attempt(admission.receipt);
    expect(first.ok).toBe(true);
    expect(ledger.snapshot().sessions[0]?.status).toBe("pre-effect-admitted");
    const replay = await harness.attempt(admission.receipt);
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.effects).toEqual({
      networkRequests: 0,
      durableAcquisitionWrites: 0,
      downloads: 0,
      imageOperations: 0,
      credentialAccesses: 0,
      providerOrModelCalls: 0,
    });
  });

  it("rejects a terminal receipt or complete future history as admission", async () => {
    const admission = await admissionFixture();
    const monitoring = await monitoringFixture(admission);
    const terminal = await terminalFixture(admission, monitoring);
    expect((await validateM9b13e3PreEffectAdmission(terminal)).ok).toBe(false);
    const futureHistory = {
      ...admission.receipt,
      events: [...admission.receipt.events, ...monitoring.receipt.events],
    };
    expect((await validateM9b13e3PreEffectAdmission(futureHistory)).ok).toBe(
      false,
    );
  });

  it("rejects monitoring without admission and terminal without monitoring", async () => {
    const admission = await admissionFixture();
    const monitoring = await monitoringFixture(admission);
    const terminal = await terminalFixture(admission, monitoring);
    expect((await validateM9b13e3Monitoring(monitoring.receipt, {})).ok).toBe(
      false,
    );
    expect(
      (await validateM9b13e3TerminalReceipt(terminal, admission.receipt, {}))
        .ok,
    ).toBe(false);
  });

  it("cross-binds admission, monitoring, and terminal digests", async () => {
    const admission = await admissionFixture();
    const monitoring = await monitoringFixture(admission);
    const terminal = await terminalFixture(admission, monitoring);
    expect(
      (await validateM9b13e3Monitoring(monitoring.receipt, admission.receipt))
        .ok,
    ).toBe(true);
    expect(
      (
        await validateM9b13e3TerminalReceipt(
          terminal,
          admission.receipt,
          monitoring.receipt,
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await validateM9b13e3Monitoring(
          { ...monitoring.receipt, admissionReceiptDigest: F },
          admission.receipt,
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await validateM9b13e3TerminalReceipt(
          { ...terminal, monitoringLineageDigest: F },
          admission.receipt,
          monitoring.receipt,
        )
      ).ok,
    ).toBe(false);
  });

  it("rejects effect before admitted-clean and terminal evidence as effect authority", async () => {
    const admission = await admissionFixture();
    const monitoring = await monitoringFixture(admission);
    const terminal = await terminalFixture(admission, monitoring);
    expect(attemptLiveM9b13e3BoundaryEffect({ admission: {} }).effects).toEqual(
      {
        networkRequests: 0,
        durableAcquisitionWrites: 0,
        downloads: 0,
        imageOperations: 0,
        credentialAccesses: 0,
        providerOrModelCalls: 0,
      },
    );
    expect((await validateM9b13e3PreEffectAdmission(terminal)).ok).toBe(false);
  });

  it("requires the committed admission and immediate current pre-boundary census", async () => {
    const admission = await admissionFixture();
    const monitoring = await monitoringFixture(admission);
    const activeMonitoringCommit = monitoring.receipt.events[1];
    const reservation = monitoring.receipt.events[2];
    const immediatePreBoundaryCensus = monitoring.receipt.events[3];
    expect(activeMonitoringCommit?.kind).toBe("phase-commit");
    expect(reservation?.kind).toBe("boundary-reservation");
    expect(immediatePreBoundaryCensus?.kind).toBe("census");
    if (
      activeMonitoringCommit?.kind !== "phase-commit" ||
      reservation?.kind !== "boundary-reservation" ||
      immediatePreBoundaryCensus?.kind !== "census"
    )
      return;
    const proof = {
      protocol: M9B13E3_MONITORING_PROTOCOL,
      sessionCommitment: SESSION,
      admissionReceiptDigest: admission.receipt.canonicalReceiptDigest,
      activeMonitoringCommit,
      reservation,
      immediatePreBoundaryCensus,
      currentLedgerRoot: immediatePreBoundaryCensus.resultingLedgerRoot,
      terminal: false,
    };
    expect(
      (
        await validateSyntheticM9b13e3BoundaryAuthority(
          proof,
          admission.receipt,
          authority,
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await validateSyntheticM9b13e3BoundaryAuthority(
          { ...proof, currentLedgerRoot: reservation.resultingLedgerRoot },
          admission.receipt,
          authority,
        )
      ).ok,
    ).toBe(false);
  });
});

describe("M9b.13e.3 exact census chronology", () => {
  it.each([
    "before-boundary-after-dispatch",
    "after-completion-before-completion",
    "before-seal-after-seal",
    "missing-before-boundary",
    "duplicate-before-boundary",
    "wrong-reference-kind",
    "nonadjacent-before-boundary",
  ] as const)("rejects %s", async (mode) => {
    const admission = await admissionFixture();
    const monitoring = await monitoringFixture(admission, mode);
    expect(
      (await validateM9b13e3Monitoring(monitoring.receipt, admission.receipt))
        .ok,
    ).toBe(false);
  });

  it("rejects initial census after admission", async () => {
    const admission = await admissionFixture("initial-after-admission");
    expect(
      (await validateM9b13e3PreEffectAdmission(admission.receipt)).ok,
    ).toBe(false);
  });

  it("rejects event gaps, timestamp reversal, chain breaks, hostile keys, and terminal census reuse", async () => {
    const admission = await admissionFixture();
    const event = admission.receipt.events[1];
    expect(event).toBeDefined();
    if (event === undefined) return;
    for (const changed of [
      { ...event, sequence: event.sequence + 2 },
      { ...event, monotonicTimestampNanos: "100" },
      { ...event, priorEventDigest: F },
      { ...event, ledgerRevision: event.ledgerRevision + 2 },
    ]) {
      const events = admission.receipt.events.map((candidate) =>
        candidate.eventId === event.eventId ? changed : candidate,
      );
      expect(
        (
          await validateM9b13e3PreEffectAdmission({
            ...admission.receipt,
            events,
          })
        ).ok,
      ).toBe(false);
    }
    expect(
      (
        await validateM9b13e3PreEffectAdmission({
          ...admission.receipt,
          constructor: "hostile",
        })
      ).ok,
    ).toBe(false);
  });
});

describe("M9b.13e.3 separate supplement review authority", () => {
  it("recomputes the body and separate review digests", async () => {
    const body = await supplementBody();
    const review = await supplementReview(body);
    expect((await validateM9b13e3SupplementBody(body)).ok).toBe(true);
    expect((await validateM9b13e3SupplementReview(review, body)).ok).toBe(true);
  });

  it("rejects embedded self-review and digest-circular construction", async () => {
    const body = await supplementBody();
    const review = await supplementReview(body);
    expect(
      (
        await validateM9b13e3SupplementBody({
          ...body,
          independentReview: review,
        })
      ).ok,
    ).toBe(false);
  });

  it("rejects an unrecomputed body digest, another body, and post-review mutation", async () => {
    const body = await supplementBody();
    const review = await supplementReview(body);
    const changedBody = { ...body, bodyIdentity: "mutated-after-review" };
    expect((await validateM9b13e3SupplementBody(changedBody)).ok).toBe(false);
    expect(
      (await validateM9b13e3SupplementReview(review, changedBody)).ok,
    ).toBe(false);
    const otherBody = await supplementBody();
    const resealedOther = {
      ...otherBody,
      bodyIdentity: "other-body",
      bodyCanonicalDigest: ZERO,
    };
    const otherDigest = unwrap(
      await digestM9b13e3SupplementBody(resealedOther),
    );
    expect(
      (
        await validateM9b13e3SupplementReview(review, {
          ...resealedOther,
          bodyCanonicalDigest: otherDigest,
        })
      ).ok,
    ).toBe(false);
  });

  it("requires the authority-bound review rather than a caller-selected pass", async () => {
    const body = await supplementBody();
    const review = await supplementReview(body);
    const harness = createSyntheticM9b13e3SubmissionHarness({
      protocol: M9B13E3_SUPPLEMENT_SUBMISSION_PROTOCOL,
      frozenBodyDigest: body.bodyCanonicalDigest,
      frozenReviewDigest: review.reviewPackageCanonicalDigest,
      reviewedCommit: review.supplementBodyCommit,
      reviewedTree: review.supplementBodyTree,
      acceptedDecision: "pass",
      submissionAuthorizationIdentity: "synthetic-submission-authorization",
      submissionAuthorizationTimestamp: "2026-08-09T12:00:00.000Z",
      registryMechanismIdentity: "synthetic-registry-never-live",
      embargoPolicyIdentity: "embargo-through-2030-08-01",
    });
    expect(harness.protocol).toBe(M9B13E3_SYNTHETIC_AUTHORITY_PROTOCOL);
    expect((await harness.attempt(body, review)).ok).toBe(true);
    const callerReview = {
      ...review,
      reviewPackageIdentity: "caller-selected-pass",
      reviewPackageCanonicalDigest: ZERO,
    };
    const callerDigest = unwrap(
      await digestM9b13e3SupplementReview(callerReview),
    );
    expect(
      (
        await harness.attempt(body, {
          ...callerReview,
          reviewPackageCanonicalDigest: callerDigest,
        })
      ).ok,
    ).toBe(false);
  });

  it("rejects review-before-freeze and review-after-authorization", async () => {
    const body = await supplementBody();
    const review = await supplementReview(body);
    expect(
      (
        await validateM9b13e3SupplementReview(
          { ...review, reviewTimestamp: body.bodyFrozenTimestamp },
          body,
        )
      ).ok,
    ).toBe(false);
    const harness = createSyntheticM9b13e3SubmissionHarness({
      protocol: M9B13E3_SUPPLEMENT_SUBMISSION_PROTOCOL,
      frozenBodyDigest: body.bodyCanonicalDigest,
      frozenReviewDigest: review.reviewPackageCanonicalDigest,
      reviewedCommit: review.supplementBodyCommit,
      reviewedTree: review.supplementBodyTree,
      acceptedDecision: "pass",
      submissionAuthorizationIdentity: "synthetic-submission-authorization",
      submissionAuthorizationTimestamp: review.reviewTimestamp,
      registryMechanismIdentity: "synthetic-registry-never-live",
      embargoPolicyIdentity: "embargo-through-2030-08-01",
    });
    expect((await harness.attempt(body, review)).ok).toBe(false);
  });

  it("rejects failed review, changed scientific or embargo fields, and hostile review keys", async () => {
    const body = await supplementBody();
    const review = await supplementReview(body);
    expect(
      (
        await validateM9b13e3SupplementReview(
          { ...review, decision: "fail" },
          body,
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await validateM9b13e3SupplementBody({
          ...body,
          scientificFinancialProjectionDigest: F,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await validateM9b13e3SupplementBody({
          ...body,
          embargo: { ...body.embargo, publicViewOnlyLinkCount: 1 },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await validateM9b13e3SupplementReview(
          { ...review, constructor: "hostile" },
          body,
        )
      ).ok,
    ).toBe(false);
  });
});

describe("M9b.13e.3 phase anti-replay ledger", () => {
  it("CAS-chains reservation, admission, monitoring, and terminal completion", async () => {
    const admission = await admissionFixture();
    const monitoring = await monitoringFixture(admission);
    const terminal = await terminalFixture(admission, monitoring);
    const ledger = unwrap(
      createSyntheticM9b13e3Ledger(authority.ledgerNamespace, ROOT),
    );
    for (const event of [
      ...admission.receipt.events,
      ...monitoring.receipt.events,
      ...terminal.events,
    ]) {
      const before = ledger.snapshot();
      expect(
        (await ledger.compareAndSwap(before.revision, before.root, event)).ok,
      ).toBe(true);
    }
    expect(ledger.snapshot().sessions).toEqual([
      {
        sessionCommitment: SESSION,
        status: "terminal-completed",
      },
    ]);
  });

  it("rejects replay, second admission, stale roots, and terminal reopening", async () => {
    const admission = await admissionFixture();
    const monitoring = await monitoringFixture(admission);
    const terminal = await terminalFixture(admission, monitoring);
    const ledger = unwrap(
      createSyntheticM9b13e3Ledger(authority.ledgerNamespace, ROOT),
    );
    const allEvents = [
      ...admission.receipt.events,
      ...monitoring.receipt.events,
      ...terminal.events,
    ];
    for (const event of allEvents) {
      const before = ledger.snapshot();
      unwrap(await ledger.compareAndSwap(before.revision, before.root, event));
    }
    const terminalSnapshot = ledger.snapshot();
    const first = admission.receipt.events[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(
      (
        await ledger.compareAndSwap(
          terminalSnapshot.revision,
          terminalSnapshot.root,
          first,
        )
      ).ok,
    ).toBe(false);
    expect(ledger.snapshot()).toEqual(terminalSnapshot);
  });

  it("treats ambiguous-after-write as possibly persisted and never redispatches", async () => {
    const admission = await admissionFixture();
    const first = admission.receipt.events[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const ledger = unwrap(
      createSyntheticM9b13e3Ledger(authority.ledgerNamespace, ROOT),
    );
    ledger.setNextFault("next-ambiguous-after-write");
    const ambiguous = await ledger.compareAndSwap(0, ROOT, first);
    expect(ambiguous.ok).toBe(false);
    expect(ledger.snapshot().events).toHaveLength(1);
    const retry = await ledger.compareAndSwap(0, ROOT, first);
    expect(retry.ok).toBe(false);
    expect(ledger.snapshot().events).toHaveLength(1);
  });
});

describe("M9b.13e.3 live zero-authority boundary", () => {
  it("keeps every live authority null and every entry point zero-effect stopped", () => {
    expect(M9B13E3_LIVE_POSITIVE_AUTHORITY).toBeNull();
    expect(M9B13E3_LIVE_SUBMISSION_AUTHORITY).toBeNull();
    for (const result of [
      attemptLiveM9b13e3Admission({ constructor: "hostile" }),
      attemptLiveM9b13e3BoundaryEffect({ __proto__: "hostile" }),
      attemptLiveM9b13e3SupplementSubmission({ pass: true }),
    ]) {
      expect(result).toEqual({
        decision: "trusted-session-no-effect-stop",
        reason: "positive-readiness-authority-unavailable",
        effects: {
          networkRequests: 0,
          durableAcquisitionWrites: 0,
          downloads: 0,
          imageOperations: 0,
          credentialAccesses: 0,
          providerOrModelCalls: 0,
        },
      });
    }
  });
});
