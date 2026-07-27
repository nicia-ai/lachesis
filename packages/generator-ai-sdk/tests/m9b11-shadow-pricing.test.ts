import { digestValue, type Result } from "@nicia-ai/lachesis";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  assessM9b11PricingEvidence,
  M9B11_SHADOW_PRICING_PROTOCOL,
  type M9b11CampaignFreeze,
  type M9b11CampaignToken,
  type M9b11CountAttemptInput,
  type M9b11CountAttemptRecord,
  type M9b11KillGate,
  markM9b11CountAmbiguous,
  prepareM9b11CampaignFreeze,
  prepareM9b11CountReservation,
  settleM9b11PrerecordedCount,
  verifyM9b11CampaignFreeze,
  verifyM9b11CountAttempt,
  verifyM9b11CountOnlyProbe,
  verifyM9b11PricingDecision,
} from "../internal/m9b11-shadow-pricing.js";
import * as aiSdkFacade from "../src/index.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function hex(value: string): string {
  return value.repeat(64);
}

type Fixture = Readonly<{
  token: M9b11CampaignToken;
  report: M9b11CampaignFreeze;
}>;

async function fixture(): Promise<Fixture> {
  return unwrap(await prepareM9b11CampaignFreeze());
}

function inputFor(
  report: M9b11CampaignFreeze,
  requestClass: M9b11CountAttemptInput["requestClass"] = "root-program-authoring",
): M9b11CountAttemptInput {
  switch (requestClass) {
    case "root-program-authoring":
      return {
        campaignDigest: report.campaignIdentityDigest,
        pairId: "pair-001",
        arm: "discovered-program",
        phase: "authoring",
        callIndex: 1,
        requestClass,
        exactRequestDigest: hex("1"),
      };
    case "static-one-shot-query-planning":
      return {
        campaignDigest: report.campaignIdentityDigest,
        pairId: "pair-001",
        arm: "static-one-shot",
        phase: "authoring",
        callIndex: 1,
        requestClass,
        exactRequestDigest: hex("2"),
      };
    case "discovered-program-leaf-reasoning":
      return {
        campaignDigest: report.campaignIdentityDigest,
        pairId: "pair-001",
        arm: "discovered-program",
        phase: "grounded-answer",
        callIndex: 2,
        requestClass,
        exactRequestDigest: hex("3"),
      };
    case "static-answer-generation":
      return {
        campaignDigest: report.campaignIdentityDigest,
        pairId: "pair-001",
        arm: "static-one-shot",
        phase: "grounded-answer",
        callIndex: 2,
        requestClass,
        exactRequestDigest: hex("4"),
      };
  }
}

async function reserve(
  current: Fixture,
  input = inputFor(current.report),
): Promise<M9b11CountAttemptRecord> {
  return unwrap(
    await prepareM9b11CountReservation(current.token, current.report, input),
  );
}

async function resignReport(
  report: M9b11CampaignFreeze,
  bodyChanges: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  const { reportDigest: ignored, ...body } = report;
  void ignored;
  const changed = { ...body, ...bodyChanges };
  return { ...changed, reportDigest: unwrap(await digestValue(changed)) };
}

async function resignRecord(
  record: M9b11CountAttemptRecord,
  bodyChanges: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  const { recordDigest: ignored, ...body } = record;
  void ignored;
  const changed = { ...body, ...bodyChanges };
  return { ...changed, recordDigest: unwrap(await digestValue(changed)) };
}

function terminal(record: M9b11CountAttemptRecord) {
  return record.events.at(-1);
}

function countResponse(inputTokens: number) {
  return {
    object: "response.input_tokens" as const,
    input_tokens: inputTokens,
  };
}

describe("M9b.11 offline shadow-priced campaign freeze", () => {
  it("freezes the public-documentation uncertainty and exact campaign arithmetic", async () => {
    const current = await fixture();
    expect(current.report).toMatchObject({
      protocol: M9B11_SHADOW_PRICING_PROTOCOL.id,
      decision:
        "shadow-priced-campaign-go-for-offline-preregistration-preparation",
      sourceArtifact: {
        exactModelVisibleInputCount: true,
        includesStructuralFormattingTokens: true,
        explicitEndpointPricePublished: false,
        explicitZeroDollarStatementPublished: false,
        finding:
          "public-documentation-suggests-free-operational-behavior-but-does-not-establish-it-contractually",
      },
      budget: {
        selectedOutputEnvelope: "moderate",
        moderateInferenceCeilingUsdMicros: 342_097_920,
        countEffectShadowContingencyUsdMicros: 117_964_800,
        completeOperationalCampaignCeilingUsdMicros: 460_062_720,
        prospectiveProviderHardCapUsdMicros: 500_000_000,
        headroomUsdMicros: 39_937_280,
        supersedesConditionalProviderCapUsdMicros: 400_000_000,
        hardCapActivated: false,
      },
      capacity: {
        perPair: {
          countHttpRequests: 4,
          inferenceCalls: 4,
          totalProviderHttpRequests: 8,
          countShadowContingencyUsdMicros: 614_400,
          operationalCeilingUsdMicros: 2_396_160,
        },
        probe: { countHttpRequests: 96, inferenceCalls: 96 },
        primary: { countHttpRequests: 672, inferenceCalls: 672 },
        campaign: {
          countHttpRequests: 768,
          inferenceCalls: 768,
          modelCalls: 768,
          totalProviderHttpRequests: 1_536,
          inferenceCeilingUsdMicros: 342_097_920,
          countShadowContingencyUsdMicros: 117_964_800,
          operationalCeilingUsdMicros: 460_062_720,
        },
      },
    });
    expect(
      await verifyM9b11CampaignFreeze(current.token, current.report),
    ).toMatchObject({ ok: true });
  });

  it("keeps every M9b.11 seam private", () => {
    expect("M9B11_SHADOW_PRICING_PROTOCOL" in aiSdkFacade).toBe(false);
    expect("prepareM9b11CampaignFreeze" in aiSdkFacade).toBe(false);
    expect("prepareM9b11CountReservation" in aiSdkFacade).toBe(false);
  });

  it("settles exact counts below and at every request-class maximum", async () => {
    const current = await fixture();
    for (const profile of current.report.classReservations) {
      const input = inputFor(current.report, profile.requestClass);
      const reserved = await reserve(current, input);
      const below = unwrap(
        await settleM9b11PrerecordedCount(
          current.token,
          current.report,
          input,
          reserved,
          countResponse(profile.maximumInputTokens - 1),
        ),
      );
      const at = unwrap(
        await settleM9b11PrerecordedCount(
          current.token,
          current.report,
          input,
          reserved,
          countResponse(profile.maximumInputTokens),
        ),
      );
      expect(terminal(below)).toMatchObject({
        kind: "settled",
        inferenceReservationInputTokens: profile.maximumInputTokens - 1,
      });
      expect(terminal(at)).toMatchObject({
        kind: "settled",
        responseObject: "response.input_tokens",
        shadowContingencyConsumedUsdMicros:
          profile.maximumCountShadowReservationUsdMicros,
        releasedShadowReservationUsdMicros: 0,
        inferenceReservationInputTokens: profile.maximumInputTokens,
      });
      expect(
        await verifyM9b11CountAttempt(current.token, current.report, input, at),
      ).toMatchObject({ ok: true });
    }
    const input = inputFor(current.report);
    const reserved = await reserve(current, input);
    expect(
      await settleM9b11PrerecordedCount(
        current.token,
        current.report,
        input,
        reserved,
        {
          ...countResponse(100),
          usage: { cost_usd_micros: 1 },
        },
      ),
    ).toMatchObject({ ok: false });
  });

  it("halts an above-class count without inference and retains the full reservation", async () => {
    const current = await fixture();
    const input = inputFor(current.report);
    const reserved = await reserve(current, input);
    const result = unwrap(
      await settleM9b11PrerecordedCount(
        current.token,
        current.report,
        input,
        reserved,
        countResponse(65_537),
      ),
    );
    expect(terminal(result)).toMatchObject({
      kind: "over-limit",
      shadowContingencyConsumedUsdMicros: 204_800,
      releasedShadowReservationUsdMicros: 0,
      inferenceDispatchAuthorized: false,
      pairHalted: true,
      campaignHalted: true,
      redispatchPermitted: false,
    });
  });

  it("rejects omitted reservation and dispatch-before-persistence records", async () => {
    const current = await fixture();
    const input = inputFor(current.report);
    const reserved = await reserve(current, input);
    const settled = unwrap(
      await settleM9b11PrerecordedCount(
        current.token,
        current.report,
        input,
        reserved,
        countResponse(100),
      ),
    );
    const withoutReservation = await resignRecord(settled, {
      events: settled.events.slice(1),
    });
    const first = settled.events[0];
    if (first?.kind !== "reserved") throw new Error("missing reservation");
    const unpersisted = await resignRecord(settled, {
      events: [
        {
          ...first,
          persistenceReceipt: {
            ...first.persistenceReceipt,
            acknowledged: false,
          },
        },
        ...settled.events.slice(1),
      ],
    });
    for (const candidate of [withoutReservation, unpersisted])
      expect(
        await verifyM9b11CountAttempt(
          current.token,
          current.report,
          input,
          candidate,
        ),
      ).toMatchObject({ ok: false });
  });

  it("retains the complete reservation for every ambiguous count class", async () => {
    const current = await fixture();
    const input = inputFor(current.report);
    const reserved = await reserve(current, input);
    for (const reason of [
      "timeout",
      "cancellation",
      "interrupted-transport",
      "malformed-response",
      "possible-dispatch-without-durable-response",
      "persistence-failure-after-possible-effect",
    ] as const) {
      const result = unwrap(
        await markM9b11CountAmbiguous(
          current.token,
          current.report,
          input,
          reserved,
          reason,
        ),
      );
      expect(terminal(result)).toMatchObject({
        kind: "ambiguous",
        reason,
        shadowContingencyConsumedUsdMicros: 204_800,
        releasedShadowReservationUsdMicros: 0,
        inferenceDispatchAuthorized: false,
        pairHalted: true,
        campaignHalted: true,
        redispatchPermitted: false,
      });
    }
  });

  it("rejects removing shadow charge or conflating it with inference billing", async () => {
    const current = await fixture();
    const input = inputFor(current.report);
    const reserved = await reserve(current, input);
    const settled = unwrap(
      await settleM9b11PrerecordedCount(
        current.token,
        current.report,
        input,
        reserved,
        countResponse(100),
      ),
    );
    const last = terminal(settled);
    if (last?.kind !== "settled") throw new Error("missing settlement");
    const freeAssumption = await resignRecord(settled, {
      events: [
        ...settled.events.slice(0, 2),
        {
          ...last,
          shadowContingencyConsumedUsdMicros: 0,
          releasedShadowReservationUsdMicros: 204_800,
        },
      ],
    });
    const conflated = await resignRecord(settled, {
      events: [
        ...settled.events.slice(0, 2),
        {
          ...last,
          providerReportedInferenceBilling: "charged-as-count-effect",
        },
      ],
    });
    for (const candidate of [freeAssumption, conflated])
      expect(
        await verifyM9b11CountAttempt(
          current.token,
          current.report,
          input,
          candidate,
        ),
      ).toMatchObject({ ok: false });
  });

  it("terminally kills every frozen unexpected-pricing evidence class", async () => {
    const current = await fixture();
    const gates: ReadonlyArray<M9b11KillGate> = [
      "count-response-contract-drift",
      "authoritative-count-price-or-structure-change",
      "observed-count-spend-exceeds-shadow",
      "fixed-per-call-charge",
      "multiplier-exceeds-shadow-rule",
      "provider-hard-cap-not-independently-verified",
      "project-spend-nonzero-before-activation",
      "provider-pricing-drift",
      "provider-model-limits-drift",
    ];
    for (const [index, gate] of gates.entries()) {
      const evidence = {
        kind: "unexpected" as const,
        gate,
        evidenceDigest: String(index + 1)
          .repeat(64)
          .slice(0, 64),
      };
      const decision = unwrap(
        await assessM9b11PricingEvidence(
          current.token,
          current.report,
          evidence,
        ),
      );
      expect(decision).toMatchObject({
        outcome: "terminal-kill-new-prospective-amendment-required",
        countProbeExecutionAuthorized: false,
        inferenceAuthorized: false,
        providerEffectPerformed: false,
      });
      expect(
        await verifyM9b11PricingDecision(
          current.token,
          current.report,
          evidence,
          decision,
        ),
      ).toMatchObject({ ok: true });
    }
  });

  it("accepts only the exact baseline pricing identity for continued offline preparation", async () => {
    const current = await fixture();
    const baseline = {
      kind: "baseline-conforms" as const,
      pricingIdentityDigest: current.report.model.pricingIdentityDigest,
      responseFields: ["object", "input_tokens"] as const,
      projectSpendUsdMicros: 0 as const,
      hardCapIndependentlyVerified: true as const,
    };
    expect(
      unwrap(
        await assessM9b11PricingEvidence(
          current.token,
          current.report,
          baseline,
        ),
      ),
    ).toMatchObject({ outcome: "continue-offline-preparation-only" });
    expect(
      await assessM9b11PricingEvidence(current.token, current.report, {
        ...baseline,
        pricingIdentityDigest: hex("f"),
      }),
    ).toMatchObject({ ok: false });
  });

  it("rejects stale caps, reduced campaign capacity, changed headroom, rate drift, and model drift", async () => {
    const current = await fixture();
    const candidates = [
      await resignReport(current.report, {
        budget: {
          ...current.report.budget,
          prospectiveProviderHardCapUsdMicros: 400_000_000,
        },
      }),
      await resignReport(current.report, {
        budget: {
          ...current.report.budget,
          completeOperationalCampaignCeilingUsdMicros: 460_062_719,
        },
      }),
      await resignReport(current.report, {
        budget: {
          ...current.report.budget,
          prospectiveProviderHardCapUsdMicros: 499_999_999,
        },
      }),
      await resignReport(current.report, {
        budget: { ...current.report.budget, headroomUsdMicros: 39_937_279 },
      }),
      await resignReport(current.report, {
        model: {
          ...current.report.model,
          shadowInputRateUsdMicrosPerMillionTokens: 3_124_999,
        },
      }),
      await resignReport(current.report, {
        model: { ...current.report.model, id: "different-model" },
      }),
    ];
    for (const candidate of candidates)
      expect(
        await verifyM9b11CampaignFreeze(current.token, candidate),
      ).toMatchObject({ ok: false });
  });

  it("rejects count-only probe inference, extra requests, retries, concurrency, nonzero spend, and lower cap", async () => {
    const current = await fixture();
    const probe = current.report.countOnlyProbe;
    const candidates = [
      { ...probe, inferenceCalls: 1 },
      { ...probe, maximumCountRequests: 5 },
      { ...probe, retries: 1 },
      { ...probe, maximumConcurrency: 2 },
      { ...probe, initialProjectSpendUsdMicros: 1 },
      { ...probe, verifiedHardCapUsdMicros: 499_999_999 },
    ];
    for (const candidate of candidates)
      expect(
        await verifyM9b11CountOnlyProbe(
          current.token,
          current.report,
          candidate,
        ),
      ).toMatchObject({ ok: false });
  });

  it("rejects foreign campaigns, cross-class requests, and old artifacts", async () => {
    const current = await fixture();
    const valid = inputFor(current.report);
    expect(
      await prepareM9b11CountReservation(current.token, current.report, {
        ...valid,
        campaignDigest: hex("e"),
      }),
    ).toMatchObject({ ok: false });
    expect(
      await prepareM9b11CountReservation(current.token, current.report, {
        ...valid,
        requestClass: "static-answer-generation",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await verifyM9b11CampaignFreeze(current.token, {
        protocol: "lachesis-m9b10c-offline-selected-topology-integration",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await verifyM9b11CountAttempt(current.token, current.report, valid, {
        protocol: "lachesis-m9b9c-live-authority-ledger/2",
      }),
    ).toMatchObject({ ok: false });
  });

  it("replays exact valid reservation, settlement, ambiguity, and pricing decisions with zero effects", async () => {
    const current = await fixture();
    const input = inputFor(current.report);
    const reserved = await reserve(current, input);
    const settled = unwrap(
      await settleM9b11PrerecordedCount(
        current.token,
        current.report,
        input,
        reserved,
        countResponse(65_536),
      ),
    );
    const ambiguous = unwrap(
      await markM9b11CountAmbiguous(
        current.token,
        current.report,
        input,
        reserved,
        "timeout",
      ),
    );
    for (const record of [reserved, settled, ambiguous]) {
      expect(
        unwrap(
          await verifyM9b11CountAttempt(
            current.token,
            current.report,
            input,
            record,
          ),
        ),
      ).toEqual(record);
      expect(record).toMatchObject({
        countEffectPerformed: false,
        inferenceEffectPerformed: false,
        credentialAccessed: false,
        networkAccessed: false,
      });
    }
  });

  it("property-checks exact shadow settlement and release arithmetic", async () => {
    const current = await fixture();
    const input = inputFor(current.report);
    const reserved = await reserve(current, input);
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 65_536 }),
        async (inputTokens) => {
          const result = unwrap(
            await settleM9b11PrerecordedCount(
              current.token,
              current.report,
              input,
              reserved,
              countResponse(inputTokens),
            ),
          );
          const last = terminal(result);
          if (last?.kind !== "settled") throw new Error("expected settlement");
          const expected = Math.ceil((inputTokens * 3_125_000) / 1_000_000);
          expect(last.shadowContingencyConsumedUsdMicros).toBe(expected);
          expect(last.releasedShadowReservationUsdMicros + expected).toBe(
            204_800,
          );
          expect(last.inferenceReservationInputTokens).toBe(inputTokens);
        },
      ),
      { numRuns: 24 },
    );
  });
});
