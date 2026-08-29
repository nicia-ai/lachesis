import { createHash } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  M9B13K5_ACCEPTED_LEDGER_IDENTITY,
  M9B13K5_ACTIVATION_PROTOCOL,
  M9B13K5_ARTIFACT_FILENAME,
  M9B13K5_ARTIFACT_IDENTITY,
  M9B13K5_ARTIFACT_SHA256,
  M9B13K5_DISPATCH_BOUNDARIES,
  M9B13K5_DRAFT_ID,
  M9B13K5_EVENT_KINDS,
  M9B13K5_LIMITS,
  M9B13K5_PRODUCTION_HELPER_IDENTITY,
  M9B13K5_PROJECT_ID,
  M9B13K5_PROVIDER,
  M9B13K5_PUT_REQUEST_DIGEST,
  M9B13K5_STATES,
  type M9b13k5ActivationCandidate,
  type M9b13k5CustodianReceipt,
  type M9b13k5DispatchBoundary,
  type M9b13k5EventKind,
  type M9b13k5StateName,
} from "../src/internal/m9b13k5/protocol.js";
import {
  applyM9b13k5Event,
  createM9b13k5SyntheticCapability,
  createM9b13k5SyntheticCustodianReceipt,
  createM9b13k5SyntheticState,
  createM9b13k5SyntheticTerminalReport,
  M9B13K5_ALLOWED_TRANSITIONS,
  type M9b13k5CapabilitySet,
  type M9b13k5LedgerEvent,
  type M9b13k5ModelState,
  m9b13k5RestartDecision,
  prepareM9b13k5Event,
} from "../src/internal/m9b13k5/state-model.js";

const digest = (marker: string): string =>
  createHash("sha256").update(marker).digest("hex");

function candidate(): M9b13k5ActivationCandidate {
  return {
    protocol: M9B13K5_ACTIVATION_PROTOCOL,
    reviewedIntegrationCommit: "1".repeat(40),
    reviewedIntegrationTree: "2".repeat(40),
    controllerImplementationIdentity: digest("controller"),
    ledgerImplementationIdentity: M9B13K5_ACCEPTED_LEDGER_IDENTITY,
    productionHelperIdentity: M9B13K5_PRODUCTION_HELPER_IDENTITY,
    launcherIdentity: digest("launcher"),
    productionTransportIdentity: digest("production-transport"),
    rawResponseParserIdentity: digest("response-parser"),
    reconciliationIdentity: digest("reconciliation"),
    requestSequenceIdentity: digest("request-sequence"),
    custodianPublicKey: "synthetic-public-key",
    custodianFingerprint: digest("custodian-fingerprint"),
    custodianIdentity: digest("custodian"),
    ledgerNamespaceCommitment: digest("namespace"),
    ledgerStoreIdentity: digest("store"),
    ledgerInitialRoot: digest("initial-root"),
    requestIdentity: "synthetic-request-1",
    campaignIdentity: "synthetic-campaign-1",
    tokenId: "synthetic-token-1",
    projectId: M9B13K5_PROJECT_ID,
    draftId: M9B13K5_DRAFT_ID,
    provider: M9B13K5_PROVIDER,
    artifactFilename: M9B13K5_ARTIFACT_FILENAME,
    artifactByteLength: M9B13K5_LIMITS.requestBodyBytes,
    artifactSha256: M9B13K5_ARTIFACT_SHA256,
    artifactIdentity: M9B13K5_ARTIFACT_IDENTITY,
    putRequestDigest: M9B13K5_PUT_REQUEST_DIGEST,
    limits: M9B13K5_LIMITS,
    ceremonyProtocol: "m9b13k5-future-pat-ceremony/1",
    revocationProtocol: "m9b13k5-two-phase-revocation/1",
  };
}

function capabilities(
  ledgerIdentity: string = M9B13K5_ACCEPTED_LEDGER_IDENTITY,
): M9b13k5CapabilitySet {
  return {
    conformance: createM9b13k5SyntheticCapability(
      "synthetic-conformance",
      digest("conformance"),
    ),
    transport: createM9b13k5SyntheticCapability(
      "loopback-transport",
      digest("loopback"),
    ),
    ledger: createM9b13k5SyntheticCapability(
      "synthetic-ledger",
      ledgerIdentity,
    ),
    sequence: createM9b13k5SyntheticCapability(
      "frozen-request-sequence",
      digest("sequence"),
    ),
    custodian: createM9b13k5SyntheticCapability(
      "synthetic-custodian",
      digest("custodian-capability"),
    ),
    terminalReport: createM9b13k5SyntheticCapability(
      "terminal-report",
      digest("terminal-report"),
    ),
  };
}

function initial(caps = capabilities()): M9b13k5ModelState {
  const result = createM9b13k5SyntheticState(candidate(), caps);
  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
}

type AdvanceOptions = Readonly<{
  boundary?: M9b13k5DispatchBoundary;
  ambiguity?: M9b13k5LedgerEvent["ambiguity"];
  receipt?: M9b13k5CustodianReceipt;
}>;

function advance(
  state: M9b13k5ModelState,
  caps: M9b13k5CapabilitySet,
  kind: M9b13k5EventKind,
  observedMonotonicMs: number,
  options: AdvanceOptions = {},
): M9b13k5ModelState {
  const responseFields =
    kind.includes("reconciled") || kind.includes("custodian")
      ? {
          responseRawSha256: digest(`${kind}-raw`),
          responseDecisionSha256: digest(`${kind}-decision`),
        }
      : {};
  const prepared = prepareM9b13k5Event(state, kind, {
    observedMonotonicMs,
    ...(options.boundary === undefined
      ? {}
      : { dispatchBoundary: options.boundary }),
    ...(options.ambiguity === undefined
      ? {}
      : { ambiguity: options.ambiguity }),
    ...(options.receipt === undefined
      ? {}
      : { custodianReceipt: options.receipt }),
    ...responseFields,
  });
  if (!prepared.ok) throw new Error(prepared.error.reason);
  const applied = applyM9b13k5Event(state, prepared.value, caps);
  if (!applied.ok) throw new Error(applied.error.reason);
  return applied.value;
}

function toPreconditions(
  caps: M9b13k5CapabilitySet,
): Readonly<{ state: M9b13k5ModelState; nextTime: number }> {
  let state = initial(caps);
  let time = 1;
  for (const kind of [
    "activation-inspected",
    "activation-admitted",
    "ledger-opened",
    "credential-launch-reserved",
    "credential-custody-active",
    "preconditions-started",
  ] as const) {
    state = advance(state, caps, kind, time);
    time += 1;
  }
  return { state, nextTime: time };
}

function toAwaiting(
  caps: M9b13k5CapabilitySet,
  preconditionRequests = 2,
): Readonly<{ state: M9b13k5ModelState; nextTime: number }> {
  let { state, nextTime } = toPreconditions(caps);
  for (let index = 0; index < preconditionRequests; index++) {
    state = advance(state, caps, "precondition-request-reserved", nextTime);
    nextTime += 1;
  }
  state = advance(state, caps, "upload-reserved", nextTime++);
  state = advance(state, caps, "upload-dispatch-observed", nextTime++, {
    boundary: "first-possible-byte-enqueue",
    ambiguity: "terminal-response-proven",
  });
  state = advance(state, caps, "upload-reconciled", nextTime++);
  state = advance(state, caps, "revocation-reserved", nextTime++);
  state = advance(state, caps, "revocation-dispatch-observed", nextTime++, {
    boundary: "first-possible-byte-enqueue",
    ambiguity: "terminal-response-proven",
  });
  state = advance(state, caps, "credential-custody-closed", nextTime++);
  state = advance(state, caps, "custodian-verification-awaited", nextTime++);
  return { state, nextTime };
}

describe("M9b.13k.5 pure state model", () => {
  it("executes the complete synthetic success grammar and closes once", () => {
    const caps = capabilities();
    const awaiting = toAwaiting(caps);
    const receipt = createM9b13k5SyntheticCustodianReceipt(
      awaiting.state,
      "revoked",
    );
    const verified = advance(
      awaiting.state,
      caps,
      "synthetic-custodian-revoked",
      awaiting.nextTime,
      { receipt },
    );
    const closed = advance(verified, caps, "closed", awaiting.nextTime + 1);
    expect(closed).toMatchObject({
      state: "closed",
      terminal: true,
      requestCount: 4,
      putCount: 1,
      revocationCount: 1,
    });
    expect(new Set(closed.eventIdentities).size).toBe(
      closed.eventIdentities.length,
    );
    expect(createM9b13k5SyntheticTerminalReport(closed, caps)).toMatchObject({
      ok: true,
      value: {
        terminalState: "closed",
        requestCount: 4,
        putCount: 1,
        revocationCount: 1,
        zeroExternalEffects: true,
      },
    });
    expect(
      createM9b13k5SyntheticTerminalReport(awaiting.state, caps),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-terminal-report-premature" },
    });
  });

  it("keeps synthetic and live terminal results structurally distinct", () => {
    const caps = capabilities();
    for (const result of ["active", "ambiguous"] as const) {
      const awaiting = toAwaiting(caps);
      const receipt = createM9b13k5SyntheticCustodianReceipt(
        awaiting.state,
        result,
      );
      const kind =
        result === "active"
          ? "synthetic-custodian-active"
          : "synthetic-custodian-ambiguous";
      const stopped = advance(awaiting.state, caps, kind, awaiting.nextTime, {
        receipt,
      });
      expect(stopped.state).toBe(
        result === "active"
          ? "synthetic_active_token_security_stop"
          : "synthetic_ambiguity_security_stop",
      );
      expect(stopped.state).not.toBe("active_token_security_stop");
      expect(stopped.state).not.toBe("ambiguity_security_stop");
    }
  });

  it("rejects ordinary JSON, production substitution, and a foreign ledger", () => {
    const caps = capabilities();
    const forged = {
      conformance: { ...caps.conformance },
      transport: { ...caps.transport },
      ledger: { ...caps.ledger },
      sequence: { ...caps.sequence },
      custodian: { ...caps.custodian },
      terminalReport: { ...caps.terminalReport },
    };
    expect(createM9b13k5SyntheticState(candidate(), forged)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-capability-set-invalid" },
    });
    const productionSubstitution = {
      ...caps,
      transport: { ...caps.transport, kind: "production-transport" },
    };
    expect(
      createM9b13k5SyntheticState(candidate(), productionSubstitution),
    ).toMatchObject({ ok: false });
    expect(
      createM9b13k5SyntheticState(candidate(), capabilities(digest("foreign"))),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-ledger-capability-foreign" },
    });
    expect(
      createM9b13k5SyntheticState({ ...candidate(), tokenId: "" }, caps),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-activation-candidate-invalid" },
    });
    expect(() =>
      createM9b13k5SyntheticCapability("synthetic-ledger", "not-a-digest"),
    ).toThrow("m9b13k5-capability-identity-invalid");
    expect(createM9b13k5SyntheticState(candidate(), null)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-capability-set-invalid" },
    });
  });

  it("rejects malformed model inputs and authority at each public boundary", () => {
    const caps = capabilities();
    const state = initial(caps);
    const prepared = prepareM9b13k5Event(state, "activation-inspected", {
      observedMonotonicMs: 1,
    });
    if (!prepared.ok) throw new Error(prepared.error.reason);
    expect(applyM9b13k5Event({}, prepared.value, caps)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-state-invalid" },
    });
    expect(applyM9b13k5Event(state, {}, caps)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-event-invalid" },
    });
    expect(applyM9b13k5Event(state, prepared.value, {})).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-capability-set-invalid" },
    });
    expect(
      applyM9b13k5Event({ ...state, terminal: true }, prepared.value, caps),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-terminal-state-reopened" },
    });
    expect(createM9b13k5SyntheticTerminalReport(state, {})).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-capability-set-invalid" },
    });
    expect(
      createM9b13k5SyntheticTerminalReport(
        { ...state, state: "closed", terminal: true },
        caps,
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-terminal-event-absent" },
    });
    expect(() =>
      createM9b13k5SyntheticCustodianReceipt(state, "revoked"),
    ).toThrow("m9b13k5-custodian-state-invalid");
  });

  it("rejects every unspecified state/event pair", () => {
    const base = initial(capabilities());
    for (const stateName of M9B13K5_STATES) {
      const snapshot: M9b13k5ModelState = {
        ...base,
        state: stateName,
        requestCount:
          stateName === "awaiting_independent_revocation_verification" ? 1 : 0,
        terminal: false,
      };
      for (const kind of M9B13K5_EVENT_KINDS) {
        const specified = M9B13K5_ALLOWED_TRANSITIONS.some(
          (transition) =>
            transition.from === snapshot.state && transition.kind === kind,
        );
        const prepared = prepareM9b13k5Event(snapshot, kind, {
          observedMonotonicMs: 1,
          dispatchBoundary: "first-possible-byte-enqueue",
          ambiguity: "after-dispatch",
        });
        expect(prepared.ok).toBe(specified);
      }
    }
  });

  it("applies every one of the exact allowed transition specifications", () => {
    const caps = capabilities();
    const base = initial(caps);
    for (const transition of M9B13K5_ALLOWED_TRANSITIONS) {
      const state: M9b13k5ModelState = {
        ...base,
        state: transition.from,
        requestCount:
          transition.from === "awaiting_independent_revocation_verification"
            ? 1
            : 0,
        terminal: false,
      };
      const resultByKind: Readonly<
        Record<string, M9b13k5CustodianReceipt["result"]>
      > = {
        "synthetic-custodian-revoked": "revoked",
        "synthetic-custodian-active": "active",
        "synthetic-custodian-ambiguous": "ambiguous",
      };
      const custodianResult = resultByKind[transition.kind];
      const receipt =
        custodianResult === undefined
          ? undefined
          : createM9b13k5SyntheticCustodianReceipt(state, custodianResult);
      const prepared = prepareM9b13k5Event(state, transition.kind, {
        observedMonotonicMs: 1,
        ...(transition.kind.includes("dispatch")
          ? { dispatchBoundary: "first-possible-byte-enqueue" as const }
          : {}),
        ...(transition.kind === "dispatch-ambiguity-stopped"
          ? { ambiguity: "after-dispatch" as const }
          : {}),
        ...(receipt === undefined ? {} : { custodianReceipt: receipt }),
      });
      if (!prepared.ok) throw new Error(prepared.error.reason);
      const applied = applyM9b13k5Event(state, prepared.value, caps);
      expect(applied).toMatchObject({
        ok: true,
        value: { state: transition.to },
      });
    }
  });

  it("rejects skipped states, duplicates, reopening, rollback, and cloned receipts", () => {
    const caps = capabilities();
    const state = initial(caps);
    const first = prepareM9b13k5Event(state, "activation-inspected", {
      observedMonotonicMs: 1,
    });
    if (!first.ok) throw new Error(first.error.reason);
    const inspected = applyM9b13k5Event(state, first.value, caps);
    if (!inspected.ok) throw new Error(inspected.error.reason);
    expect(applyM9b13k5Event(inspected.value, first.value, caps).ok).toBe(
      false,
    );
    expect(
      prepareM9b13k5Event(state, "ledger-opened", {
        observedMonotonicMs: 1,
      }).ok,
    ).toBe(false);
    const stale = { ...first.value, expectedPriorRoot: digest("rollback") };
    expect(applyM9b13k5Event(state, stale, caps).ok).toBe(false);

    const awaiting = toAwaiting(caps);
    const receipt = createM9b13k5SyntheticCustodianReceipt(
      awaiting.state,
      "revoked",
    );
    const verified = advance(
      awaiting.state,
      caps,
      "synthetic-custodian-revoked",
      awaiting.nextTime,
      { receipt },
    );
    const closed = advance(verified, caps, "closed", awaiting.nextTime + 1);
    expect(
      prepareM9b13k5Event(closed, "quarantined", {
        observedMonotonicMs: awaiting.nextTime + 2,
      }).ok,
    ).toBe(false);
  });

  it("rejects token, activation, artifact, store, and namespace tampering before reservation", () => {
    const caps = capabilities();
    const { state, nextTime } = toPreconditions(caps);
    const prepared = prepareM9b13k5Event(
      state,
      "precondition-request-reserved",
      { observedMonotonicMs: nextTime },
    );
    if (!prepared.ok) throw new Error(prepared.error.reason);
    for (const mutation of [
      { ...prepared.value, tokenId: "cross-token" },
      { ...prepared.value, activationIdentity: digest("foreign-activation") },
      { ...prepared.value, artifactSha256: digest("replacement-artifact") },
      { ...prepared.value, ledgerStoreIdentity: digest("cloned-store") },
      {
        ...prepared.value,
        ledgerNamespaceCommitment: digest("recreated-namespace"),
      },
    ])
      expect(applyM9b13k5Event(state, mutation, caps).ok).toBe(false);
    expect(state.requestCount).toBe(0);
  });

  it.each(M9B13K5_DISPATCH_BOUNDARIES)(
    "classifies failure at %s without permitting a second PUT",
    (boundary) => {
      const caps = capabilities();
      let { state, nextTime } = toPreconditions(caps);
      state = advance(state, caps, "upload-reserved", nextTime++);
      const ambiguity = [
        "request-constructed",
        "reservation-committed",
        "request-object-created",
      ].includes(boundary)
        ? "reserved-not-dispatched"
        : "after-dispatch";
      const stopped = advance(
        state,
        caps,
        "dispatch-ambiguity-stopped",
        nextTime,
        { boundary, ambiguity },
      );
      expect(stopped).toMatchObject({
        state: "synthetic_ambiguity_security_stop",
        putCount: 1,
        terminal: true,
      });
      expect(
        prepareM9b13k5Event(stopped, "upload-reserved", {
          observedMonotonicMs: nextTime + 1,
        }).ok,
      ).toBe(false);
    },
  );

  it("enforces controller and revocation deadline boundaries", () => {
    const caps = capabilities();
    const state = initial(caps);
    const expired = prepareM9b13k5Event(state, "activation-inspected", {
      observedMonotonicMs: M9B13K5_LIMITS.controllerDeadlineMs,
    });
    if (!expired.ok) throw new Error(expired.error.reason);
    expect(applyM9b13k5Event(state, expired.value, caps)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-controller-deadline-expired" },
    });

    let awaitingRevocation = toAwaiting(caps, 0).state;
    awaitingRevocation = {
      ...awaitingRevocation,
      state: "revocation_reserved",
      terminal: false,
      revocationDeadlineAtMs: awaitingRevocation.lastMonotonicMs,
    };
    const event = prepareM9b13k5Event(
      awaitingRevocation,
      "revocation-dispatch-observed",
      {
        observedMonotonicMs: awaitingRevocation.lastMonotonicMs,
        dispatchBoundary: "request-object-created",
      },
    );
    if (!event.ok) throw new Error(event.error.reason);
    expect(
      applyM9b13k5Event(awaitingRevocation, event.value, caps),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-revocation-deadline-expired" },
    });
  });

  it("persists request accounting at 18 and rejects request 19, second PUT, and second revocation", () => {
    const caps = capabilities();
    const maximum = toAwaiting(caps, 16).state;
    expect(maximum.requestCount).toBe(18);
    expect(maximum.putCount).toBe(1);
    expect(maximum.revocationCount).toBe(1);

    let { state, nextTime } = toPreconditions(caps);
    for (let index = 0; index < 17; index++)
      state = advance(state, caps, "precondition-request-reserved", nextTime++);
    state = advance(state, caps, "upload-reserved", nextTime++);
    state = advance(state, caps, "upload-dispatch-observed", nextTime++, {
      boundary: "response-completed",
      ambiguity: "terminal-response-proven",
    });
    state = advance(state, caps, "upload-reconciled", nextTime++);
    expect(
      prepareM9b13k5Event(state, "revocation-reserved", {
        observedMonotonicMs: nextTime,
      }).ok,
    ).toBe(false);
    expect(
      prepareM9b13k5Event(state, "upload-reserved", {
        observedMonotonicMs: nextTime,
      }).ok,
    ).toBe(false);
  });

  it("rejects cross-custodian and live receipts", () => {
    const caps = capabilities();
    const awaiting = toAwaiting(caps);
    const receipt = createM9b13k5SyntheticCustodianReceipt(
      awaiting.state,
      "revoked",
    );
    for (const changed of [
      { ...receipt, custodianIdentity: digest("foreign-custodian") },
      { ...receipt, tokenId: "cross-token" },
      { ...receipt, mode: "live" as const },
    ]) {
      const event = prepareM9b13k5Event(
        awaiting.state,
        "synthetic-custodian-revoked",
        {
          observedMonotonicMs: awaiting.nextTime,
          custodianReceipt: changed,
        },
      );
      if (!event.ok) throw new Error(event.error.reason);
      expect(applyM9b13k5Event(awaiting.state, event.value, caps).ok).toBe(
        false,
      );
    }
  });

  it("defines restart behavior for all 22 states without ever creating another PAT", () => {
    const base = initial(capabilities());
    const decisions = new Map<
      M9b13k5StateName,
      ReturnType<typeof m9b13k5RestartDecision>
    >();
    for (const stateName of M9B13K5_STATES) {
      const state: M9b13k5ModelState = {
        ...base,
        state: stateName,
        terminal: [
          "synthetic_active_token_security_stop",
          "synthetic_ambiguity_security_stop",
          "revoked_and_independently_verified",
          "active_token_security_stop",
          "ambiguity_security_stop",
          "quarantined",
          "closed",
        ].includes(stateName),
      };
      const decision = m9b13k5RestartDecision(state);
      expect(decision.mayCreateAnotherPat).toBe(false);
      decisions.set(stateName, decision);
    }
    expect(decisions.get("upload_possibly_dispatched")).toMatchObject({
      mayReconcileOnly: true,
      mayDispatch: false,
      mayReadCredential: false,
    });
  });

  it("property-checks zero-effect replay and accounting for every safe precondition count", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 16 }), (count) => {
        const firstCaps = capabilities();
        const secondCaps = capabilities();
        const first = toAwaiting(firstCaps, count).state;
        const second = toAwaiting(secondCaps, count).state;
        expect(first).toEqual(second);
        expect(first.requestCount).toBe(count + 2);
        expect(first.putCount).toBe(1);
        expect(first.revocationCount).toBe(1);
        expect(first.requestCount).toBeLessThanOrEqual(18);
      }),
      { numRuns: 128 },
    );
  });
});
