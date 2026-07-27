import { canonicalizeJson, digestValue, type Result } from "@nicia-ai/lachesis";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { prepareM9b2DevelopmentSuite } from "../../generator/src/m9b2-measurement.js";
import {
  deriveM9b3HistoricalDevelopmentBaseline,
  type M9b3Preparation,
  type M9b3PreparationInput,
  type M9b3ProviderProfileInput,
  prepareM9b3OfflineStudy,
} from "../../generator/src/m9b3-preparation.js";
import { M9B2_PUBLIC_DEVELOPMENT_CASES } from "../../generator/tests/fixtures/m9b2-development.js";
import { M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS } from "../../generator/tests/fixtures/m9b2-hidden.js";
import {
  acceptM9b6OfflineHardCapObservation,
  type M9b6VerifiedHardCapToken,
} from "../internal/m9b6-conservative-accounting.js";
import {
  type M9b7CapacityReport,
  type M9b7CapacityToken,
  type M9b7ModelLimits,
  prepareM9b7CampaignCapacityReview,
} from "../internal/m9b7-campaign-capacity.js";
import {
  inspectM9b8CanonicalRequest,
  M9B8_PROSPECTIVE_REDESIGN_PROTOCOL,
  type M9b8ProgressionSnapshot,
  type M9b8ProspectiveRedesignReport,
  type M9b8ProspectiveRedesignToken,
  prepareM9b8ProspectiveRedesign,
  prepareM9b8SyntheticProportionalReservation,
  reviewM9b8CompletionSafety,
  settleM9b8SyntheticProportionalReservation,
  verifyM9b8CompletionSafety,
  verifyM9b8ProspectiveRedesign,
  verifyM9b8SyntheticProportionalReservation,
} from "../internal/m9b8-prospective-redesign.js";
import * as aiSdkFacade from "../src/index.js";
import type { M9b5IdentityProfile } from "../src/m9b5-openai-responses.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function digest(character: string): string {
  return character.repeat(64);
}

const PROVIDER = Object.freeze({
  id: "offline.openai-responses",
  version: "2026-07-26",
  artifactDigest: digest("1"),
});
const MODEL = Object.freeze({
  id: "gpt-5.6-terra",
  version: "gpt-5.6-terra",
  artifactDigest: digest("2"),
  providerId: PROVIDER.id,
});
const PROJECT = Object.freeze({
  id: "offline-capacity-project",
  version: "1",
  artifactDigest: digest("3"),
  providerId: PROVIDER.id,
});
const CAP_VERIFIER = Object.freeze({
  id: "offline-capacity-verifier",
  version: "1",
  artifactDigest: digest("4"),
});
const NOW = 10_000;

function identities(): M9b5IdentityProfile {
  return {
    provider: PROVIDER,
    model: MODEL,
    tokenizer: {
      id: "offline-reviewed-tokenizer-boundary",
      version: "2026-07-26",
      artifactDigest: digest("6"),
      providerId: PROVIDER.id,
    },
    pricingSnapshot: {
      id: "openai-terra-pricing-snapshot",
      version: "2026-07-26",
      artifactDigest: digest("7"),
      providerId: PROVIDER.id,
      inputUsdMicrosPerMillionTokens: 1_000_000,
      cachedInputUsdMicrosPerMillionTokens: 250_000,
      cacheWriteInputUsdMicrosPerMillionTokens: 1_250_000,
      outputUsdMicrosPerMillionTokens: 2_000_000,
      reasoningUsdMicrosPerMillionTokens: 0,
      longContextThresholdTokens: 272_000,
      longContextInputMultiplierMicros: 2_000_000,
      longContextOutputMultiplierMicros: 1_500_000,
    },
    serializer: {
      id: "ai-sdk-openai-responses-canonical-intercept",
      version: "4.0.15/1",
      artifactDigest: digest("8"),
      providerId: PROVIDER.id,
    },
  };
}

function providerProfile(): M9b3ProviderProfileInput {
  return {
    provider: { id: PROVIDER.id, version: PROVIDER.version },
    requestProtocol: {
      providerId: PROVIDER.id,
      id: "offline.openai-responses.protocol",
      version: "2026-07-26",
    },
    requestSerializer: {
      providerId: PROVIDER.id,
      requestProtocolId: "offline.openai-responses.protocol",
      id: "ai-sdk-openai-responses-canonical-intercept",
      version: "4.0.15/1",
      schemaDigest: digest("9"),
    },
    model: {
      providerId: PROVIDER.id,
      id: MODEL.id,
      revision: MODEL.version,
      contextWindowTokens: 1_050_000,
      maximumOutputTokens: 128_000,
      reasoningMode: "disabled",
    },
    tokenizer: {
      providerId: PROVIDER.id,
      modelId: MODEL.id,
      id: "offline-reviewed-tokenizer-boundary",
      version: "2026-07-26",
      artifactDigest: digest("6"),
      conformanceVectorDigest: digest("a"),
      countsExactSerializedRequests: true,
      countsExactSerializedResponses: true,
    },
    pricing: {
      providerId: PROVIDER.id,
      modelId: MODEL.id,
      currency: "USD",
      inputUsdMicrosPerMillionTokens: 1_000_000,
      outputUsdMicrosPerMillionTokens: 2_000_000,
      reasoningUsdMicrosPerMillionTokens: 0,
      snapshotId: "openai-terra-pricing-snapshot",
      sourceDigest: digest("b"),
    },
  };
}

const MODEL_LIMITS: M9b7ModelLimits = Object.freeze({
  model: MODEL,
  limitsArtifact: {
    id: "gpt-5.6-terra-limits",
    version: "2026-07-26",
    artifactDigest: digest("5"),
  },
  maximumInputTokens: 922_000,
  maximumOutputTokens: 128_000,
  contextWindowTokens: 1_050_000,
  reservationBasis:
    "full-provider-model-input-maximum-including-unknown-framing",
});

let preparedPromise:
  | Promise<
      Readonly<{
        input: M9b3PreparationInput;
        preparation: M9b3Preparation;
      }>
    >
  | undefined;

async function preparedM9b3(): Promise<
  Readonly<{ input: M9b3PreparationInput; preparation: M9b3Preparation }>
> {
  preparedPromise ??= (async () => {
    const development = unwrap(
      await prepareM9b2DevelopmentSuite({
        publicCases: M9B2_PUBLIC_DEVELOPMENT_CASES,
        hiddenExpectations: M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS,
      }),
    );
    const input: M9b3PreparationInput = {
      providerProfile: providerProfile(),
      promptBundleDigest: digest("c"),
      scheduleSeedCommitment: digest("d"),
      historicalDevelopmentBaseline: unwrap(
        await deriveM9b3HistoricalDevelopmentBaseline(development),
      ),
    };
    return { input, preparation: unwrap(await prepareM9b3OfflineStudy(input)) };
  })();
  return preparedPromise;
}

async function cap(
  remainingUsdMicros = 4_000_000_000,
): Promise<M9b6VerifiedHardCapToken> {
  const observation = {
    protocol: "lachesis-m9b6-offline-hard-cap-observation/1",
    provider: PROVIDER,
    project: PROJECT,
    control: "hard",
    currency: "USD",
    hardCapUsdMicros: remainingUsdMicros,
    trackedSpendUsdMicros: 0,
    remainingUsdMicros,
    observedAtMs: NOW - 100,
    expiresAtMs: NOW + 1_000,
    enforcement: {
      atLimit: "429-insufficient_quota",
      propagation: "not-instantaneous",
      documentedOvershootBound: "unknown",
    },
  } as const;
  return unwrap(
    await acceptM9b6OfflineHardCapObservation({
      canonicalObservationBytes: unwrap(canonicalizeJson(observation)),
      expectedProvider: PROVIDER,
      expectedProject: PROJECT,
      expectedCurrency: "USD",
      verificationArtifact: CAP_VERIFIER,
      nowMs: NOW,
    }),
  ).token;
}

type Fixture = Readonly<{
  m9b7Report: M9b7CapacityReport;
  m9b7Token: M9b7CapacityToken;
  report: M9b8ProspectiveRedesignReport;
  token: M9b8ProspectiveRedesignToken;
}>;

let fixturePromise: Promise<Fixture> | undefined;

async function buildFixture(remainingUsdMicros: number): Promise<Fixture> {
  const prepared = await preparedM9b3();
  const m9b7 = unwrap(
    await prepareM9b7CampaignCapacityReview({
      preparationInput: prepared.input,
      preparation: prepared.preparation,
      adapterIdentities: identities(),
      modelLimits: MODEL_LIMITS,
      hardCapToken: await cap(remainingUsdMicros),
    }),
  );
  const m9b8 = unwrap(
    await prepareM9b8ProspectiveRedesign({
      m9b7Token: m9b7.token,
      m9b7Report: m9b7.report,
    }),
  );
  return {
    m9b7Report: m9b7.report,
    m9b7Token: m9b7.token,
    report: m9b8.report,
    token: m9b8.token,
  };
}

async function fixture(): Promise<Fixture> {
  fixturePromise ??= buildFixture(4_000_000_000);
  return fixturePromise;
}

async function resign(
  value: Readonly<Record<string, unknown>>,
  digestField: "reportDigest" | "gateDigest",
): Promise<Readonly<Record<string, unknown>>> {
  const body = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== digestField),
  );
  return { ...body, [digestField]: unwrap(await digestValue(body)) };
}

const SYNTHETIC_PRICING = Object.freeze({
  protocol: "lachesis-m9b8-synthetic-proportional-pricing/1" as const,
  normalInputUsdMicrosPerMillionTokens: 1_000_000,
  cachedReadUsdMicrosPerMillionTokens: 250_000,
  cacheWriteUsdMicrosPerMillionTokens: 1_250_000,
  outputUsdMicrosPerMillionTokens: 2_000_000,
  longContextThresholdTokens: 100,
  longContextInputMultiplierMicros: 2_000_000,
  longContextOutputMultiplierMicros: 1_500_000,
});

type SyntheticPricing = Readonly<{
  protocol: "lachesis-m9b8-synthetic-proportional-pricing/1";
  normalInputUsdMicrosPerMillionTokens: number;
  cachedReadUsdMicrosPerMillionTokens: number;
  cacheWriteUsdMicrosPerMillionTokens: number;
  outputUsdMicrosPerMillionTokens: number;
  longContextThresholdTokens: number;
  longContextInputMultiplierMicros: number;
  longContextOutputMultiplierMicros: number;
}>;

async function syntheticReservation(
  request: unknown = { input: "a" },
  framing = 8,
  pricing: SyntheticPricing = SYNTHETIC_PRICING,
) {
  return unwrap(
    await prepareM9b8SyntheticProportionalReservation({
      providerRequest: request,
      providerFramingContingencyTokens: framing,
      maximumOutputTokens: 20,
      pricing,
    }),
  );
}

async function snapshot(
  current: Fixture,
  overrides: Readonly<{
    completedProbePairs?: number;
    completedPrimaryPairs?: number;
    activePair?: M9b8ProgressionSnapshot["activePair"];
    probeDecision?: M9b8ProgressionSnapshot["probeDecision"];
    terminalHalt?: M9b8ProgressionSnapshot["terminalHalt"];
    overageExcessChargeUsdMicros?: number;
    outstandingReservations?: number;
    reportDigest?: string;
    prospectiveDesignDigest?: string;
    scheduleProtocolDigest?: string;
  }> = {},
): Promise<M9b8ProgressionSnapshot> {
  const completedProbePairs = overrides.completedProbePairs ?? 0;
  const completedPrimaryPairs = overrides.completedPrimaryPairs ?? 0;
  const activePair = overrides.activePair ?? null;
  const overage = overrides.overageExcessChargeUsdMicros ?? 0;
  const committedPairs =
    completedProbePairs + completedPrimaryPairs + (activePair === null ? 0 : 1);
  return {
    protocol: "lachesis-m9b8-topology-progression-snapshot/1",
    reportDigest: overrides.reportDigest ?? current.report.reportDigest,
    prospectiveDesignDigest:
      overrides.prospectiveDesignDigest ??
      unwrap(await digestValue(current.report.selectedDesign)),
    scheduleProtocolDigest:
      overrides.scheduleProtocolDigest ??
      current.report.inheritedM9b7.scheduleProtocolDigest,
    completedProbePairs,
    completedPrimaryPairs,
    activePair,
    probeDecision: overrides.probeDecision ?? "not-evaluated",
    terminalHalt: overrides.terminalHalt ?? null,
    overageExcessChargeUsdMicros: overage,
    outstandingReservations: overrides.outstandingReservations ?? 0,
    committedCostUsdMicros:
      committedPairs *
        current.report.selectedDesign.totals.perPair.maximumCostUsdMicros +
      overage,
  };
}

describe("M9b.8 offline prospective accounting and topology redesign", () => {
  it("keeps every M9b.8 seam out of the public facade", () => {
    expect("M9B8_PROSPECTIVE_REDESIGN_PROTOCOL" in aiSdkFacade).toBe(false);
    expect("prepareM9b8ProspectiveRedesign" in aiSdkFacade).toBe(false);
    expect("reviewM9b8CompletionSafety" in aiSdkFacade).toBe(false);
  });

  it("selects the matched four-call topology with exact conservative totals", async () => {
    const current = await fixture();
    expect(current.report).toMatchObject({
      protocol: M9B8_PROSPECTIVE_REDESIGN_PROTOCOL.id,
      version: "1.0.0",
      decision: "topology-redesign-go-for-offline-preregistration-preparation",
      inheritedM9b7: {
        immutableDecision: "campaign-capacity-no-go",
        inactiveCapOnlyAlternativeUsdMicros: 3_639_570_432,
      },
      selectedDesign: {
        prospectiveCampaignCapUsdMicros: 1_869_330_432,
        savingsAgainstM9b7UsdMicros: 1_770_240_000,
        m9b7ExposureBasisPoints: 5_137,
        totals: {
          perPair: {
            requestCount: 4,
            maximumInputTokens: 3_688_000,
            maximumOutputTokens: 172_032,
            maximumCostUsdMicros: 9_736_096,
          },
          probe: {
            requestCount: 96,
            maximumCostUsdMicros: 233_666_304,
          },
          primary: {
            requestCount: 672,
            maximumCostUsdMicros: 1_635_664_128,
          },
          campaign: {
            requestCount: 768,
            maximumInputTokens: 708_096_000,
            maximumOutputTokens: 33_030_144,
            maximumCostUsdMicros: 1_869_330_432,
          },
        },
      },
    });
    expect(
      current.report.selectedDesign.totals.perArm.discoveredProgram,
    ).toEqual(current.report.selectedDesign.totals.perArm.staticOneShot);
    expect(current.report.alternatives.reducedCallTopology).toMatchObject({
      modelCallsPerPair: 4,
      leafModelCallsDuringLocalRetrieval: 0,
      localEvaluatorCalls: 0,
      prospectiveCodeModeProfile:
        "retrieval-only-local-capabilities-no-model-or-provider-dispatch-inside-program",
    });
    expect(current.report.scientificProperties.power).toEqual({
      alphaBasisPoints: 500,
      targetPowerBasisPoints: 8_000,
      status: "unchanged-prospective-target-pending-frozen-probe",
    });
  });

  it("classifies the full input limit as fallback and keeps other designs honest", async () => {
    const current = await fixture();
    expect(current.report.fullModelReservationAudit.conclusion).toBe(
      "922000-is-a-safe-fallback-not-the-tightest-request-specific-bound",
    );
    expect(current.report.alternatives.proportionalByteEnvelope.status).toBe(
      "rejected-unproven-token-and-framing-bound",
    );
    expect(current.report.alternatives.officialTokenCounting).toMatchObject({
      endpoint: "POST /v1/responses/input_tokens",
      returnsExactModelVisibleInputCount: true,
      installedPackageExposesCountOperation: false,
      countIsProviderEffect: true,
    });
    expect(current.report.alternatives.capOnlyReference).toMatchObject({
      maximumCostUsdMicros: 3_639_570_432,
      activated: false,
    });
    expect(current.report.selectedDesign.expectedDescriptiveSpend).toBe(
      "unknown-before-provider-usage-observations",
    );
  });

  it("rederives reports and rejects self-consistent topology, arm, schedule, and population changes", async () => {
    const current = await fixture();
    expect(
      unwrap(
        await verifyM9b8ProspectiveRedesign(current.token, current.report),
      ),
    ).toEqual(current.report);
    const changes: ReadonlyArray<Readonly<Record<string, unknown>>> = [
      {
        ...current.report,
        selectedDesign: {
          ...current.report.selectedDesign,
          prospectiveCampaignCapUsdMicros: 1,
        },
      },
      {
        ...current.report,
        selectedDesign: {
          ...current.report.selectedDesign,
          requestProfiles: [
            ...current.report.selectedDesign.requestProfiles,
            current.report.selectedDesign.requestProfiles[0],
          ],
        },
      },
      {
        ...current.report,
        selectedDesign: {
          ...current.report.selectedDesign,
          requestProfiles: current.report.selectedDesign.requestProfiles.map(
            (profile, index) =>
              index === 1
                ? { ...profile, maximumOutputTokensPerRequest: 4_096 }
                : profile,
          ),
        },
      },
      {
        ...current.report,
        selectedDesign: {
          ...current.report.selectedDesign,
          offlineCapacityEvidence: {
            ...current.report.selectedDesign.offlineCapacityEvidence,
            remainingUsdMicros: 1,
          },
        },
      },
      {
        ...current.report,
        selectedDesign: {
          ...current.report.selectedDesign,
          requestProfiles: current.report.selectedDesign.requestProfiles.map(
            (profile, index) =>
              index === 0 ? { ...profile, arm: "static-one-shot" } : profile,
          ),
        },
      },
      {
        ...current.report,
        inheritedM9b7: {
          ...current.report.inheritedM9b7,
          scheduleProtocolDigest: digest("f"),
        },
      },
      {
        ...current.report,
        scientificProperties: {
          ...current.report.scientificProperties,
          population: { probePairs: 24, primaryPairs: 144 },
        },
      },
    ];
    for (const changed of changes) {
      const resigned = await resign(changed, "reportDigest");
      expect(
        (await verifyM9b8ProspectiveRedesign(current.token, resigned)).ok,
      ).toBe(false);
    }
  });

  it("binds exact UTF-8 bytes without claiming exact provider tokens", async () => {
    const ascii = unwrap(await inspectM9b8CanonicalRequest({ input: "a" }));
    const multibyte = unwrap(
      await inspectM9b8CanonicalRequest({ input: "é🙂" }),
    );
    const combining = unwrap(
      await inspectM9b8CanonicalRequest({ input: "e\u0301" }),
    );
    const escaped = unwrap(
      await inspectM9b8CanonicalRequest({ input: '\n"\\\u0000' }),
    );
    expect(ascii.status).toBe("exact-bytes-not-exact-provider-tokens");
    expect(multibyte.utf8ByteLength).toBeGreaterThan(ascii.utf8ByteLength);
    expect(combining.canonicalBytes).toContain("é");
    expect(escaped.canonicalBytes).toContain('\\n\\"\\\\\\u0000');
    expect((await inspectM9b8CanonicalRequest("\ud800")).ok).toBe(false);
  });

  it("uses every canonical byte for the synthetic one-byte-per-token worst case", async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (value) => {
        const inspected = await inspectM9b8CanonicalRequest(value);
        if (!inspected.ok) return;
        const reservation = await syntheticReservation(value, 0);
        expect(reservation.callerControlledInputTokenBound).toBe(
          inspected.value.utf8ByteLength,
        );
        expect(reservation.maximumInputTokens).toBe(
          inspected.value.utf8ByteLength,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("accounts for structural schemas and rejects request mutation after accounting", async () => {
    const request = {
      input: "task",
      text: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: Object.fromEntries(
              Array.from({ length: 128 }, (_, index) => [
                `field-${index}`,
                { type: "string", description: "x".repeat(64) },
              ]),
            ),
          },
        },
      },
    };
    const reservation = await syntheticReservation(request);
    expect(reservation.request.utf8ByteLength).toBeGreaterThan(10_000);
    expect(
      unwrap(
        await verifyM9b8SyntheticProportionalReservation(request, reservation),
      ),
    ).toEqual(reservation);
    expect(
      (
        await verifyM9b8SyntheticProportionalReservation(
          { ...request, input: "altered" },
          reservation,
        )
      ).ok,
    ).toBe(false);
  });

  it("halts on framing exhaustion, usage overage, or ambiguous usage", async () => {
    const reservation = await syntheticReservation({ input: "bounded" }, 3);
    const framingExhausted = unwrap(
      await settleM9b8SyntheticProportionalReservation(reservation, {
        inputTokens: reservation.maximumInputTokens + 1,
        outputTokens: 0,
      }),
    );
    const outputOverage = unwrap(
      await settleM9b8SyntheticProportionalReservation(reservation, {
        inputTokens: reservation.maximumInputTokens,
        outputTokens: reservation.maximumOutputTokens + 1,
      }),
    );
    const ambiguous = unwrap(
      await settleM9b8SyntheticProportionalReservation(reservation, {
        inputTokens: "missing",
      }),
    );
    for (const settlement of [framingExhausted, outputOverage]) {
      expect(settlement.kind).toBe("overage");
      expect(settlement.terminal).toBe(true);
      expect(settlement.scorable).toBe(false);
      expect(settlement.redispatchPermitted).toBe(false);
    }
    expect(ambiguous).toMatchObject({
      kind: "ambiguous",
      chargedUsdMicros: reservation.maximumCostUsdMicros,
      terminal: true,
      scorable: false,
      redispatchPermitted: false,
    });
    expect(
      (
        await settleM9b8SyntheticProportionalReservation(
          {
            ...reservation,
            maximumInputTokens: reservation.maximumInputTokens + 1,
          },
          { inputTokens: 0, outputTokens: 0 },
        )
      ).ok,
    ).toBe(false);
  });

  it("applies long-context, highest cache-class, and maximum output ceilings exactly", async () => {
    const base = await syntheticReservation({ input: "x".repeat(20) }, 0, {
      ...SYNTHETIC_PRICING,
      longContextThresholdTokens: 10_000,
    });
    const long = await syntheticReservation({ input: "x".repeat(20) }, 0, {
      ...SYNTHETIC_PRICING,
      longContextThresholdTokens: base.maximumInputTokens - 1,
    });
    const expensiveCacheWrite = await syntheticReservation(
      { input: "x".repeat(20) },
      0,
      {
        ...SYNTHETIC_PRICING,
        cacheWriteUsdMicrosPerMillionTokens: 9_000_000,
        longContextThresholdTokens: 10_000,
      },
    );
    expect(base.longContext).toBe(false);
    expect(long.longContext).toBe(true);
    expect(long.maximumCostUsdMicros).toBeGreaterThan(
      base.maximumCostUsdMicros,
    );
    expect(expensiveCacheWrite.maximumCostUsdMicros).toBeGreaterThan(
      base.maximumCostUsdMicros,
    );
    expect(
      unwrap(
        await settleM9b8SyntheticProportionalReservation(base, {
          inputTokens: base.maximumInputTokens,
          outputTokens: base.maximumOutputTokens,
        }),
      ),
    ).toMatchObject({
      kind: "completed",
      chargedUsdMicros: base.maximumCostUsdMicros,
      scorable: true,
    });
  });

  it("enforces pair and phase capacity at exact boundaries", async () => {
    const probeCost = 233_666_304;
    const current = await buildFixture(probeCost);
    const short = await buildFixture(probeCost - 1);
    const pairCost = 9_736_096;
    const exactProbe = unwrap(
      await reviewM9b8CompletionSafety({
        token: current.token,
        snapshot: await snapshot(current),
      }),
    );
    const shortProbe = unwrap(
      await reviewM9b8CompletionSafety({
        token: short.token,
        snapshot: await snapshot(short),
      }),
    );
    const finalProbePair = unwrap(
      await reviewM9b8CompletionSafety({
        token: current.token,
        snapshot: await snapshot(current, {
          completedProbePairs: 23,
        }),
      }),
    );
    expect(exactProbe).toMatchObject({
      authorized: true,
      action: "start-probe-pair",
    });
    expect(shortProbe).toMatchObject({
      authorized: false,
      action: "reject-capacity",
    });
    expect(finalProbePair).toMatchObject({
      authorized: true,
      action: "start-probe-pair",
      remainingPhaseCostUsdMicros: pairCost,
    });
  });

  it("does not confuse probe capacity with primary capacity", async () => {
    const current = await buildFixture(233_666_304);
    const gate = unwrap(
      await reviewM9b8CompletionSafety({
        token: current.token,
        snapshot: await snapshot(current, {
          completedProbePairs: 24,
          probeDecision: "pass",
        }),
      }),
    );
    expect(gate).toMatchObject({
      authorized: false,
      action: "reject-capacity",
      population: "primary",
    });
  });

  it("halts ambiguity and overage and rejects concurrent reservations", async () => {
    const current = await fixture();
    const ambiguous = unwrap(
      await reviewM9b8CompletionSafety({
        token: current.token,
        snapshot: await snapshot(current, { terminalHalt: "ambiguous" }),
      }),
    );
    const overage = unwrap(
      await reviewM9b8CompletionSafety({
        token: current.token,
        snapshot: await snapshot(current, {
          activePair: {
            population: "probe",
            pairOrdinal: 0,
            firstArm: "discovered-program",
            completedArms: [],
          },
          terminalHalt: "overage",
          overageExcessChargeUsdMicros: 1,
        }),
      }),
    );
    const concurrent = unwrap(
      await reviewM9b8CompletionSafety({
        token: current.token,
        snapshot: await snapshot(current, { outstandingReservations: 1 }),
      }),
    );
    expect(ambiguous.action).toBe("halt-ambiguous");
    expect(overage.action).toBe("halt-overage");
    expect(concurrent.action).toBe("reject-concurrency");
    expect(ambiguous.authorized).toBe(false);
    expect(overage.authorized).toBe(false);
    expect(concurrent.authorized).toBe(false);
  });

  it("rejects provider-cap, schedule, population, and active-arm drift", async () => {
    const current = await fixture();
    const insufficient = await buildFixture(1);
    const lowCap = unwrap(
      await reviewM9b8CompletionSafety({
        token: insufficient.token,
        snapshot: await snapshot(insufficient),
      }),
    );
    const schedule = unwrap(
      await reviewM9b8CompletionSafety({
        token: current.token,
        snapshot: await snapshot(current, {
          scheduleProtocolDigest: digest("e"),
        }),
      }),
    );
    const population = unwrap(
      await reviewM9b8CompletionSafety({
        token: current.token,
        snapshot: await snapshot(current, {
          activePair: {
            population: "primary",
            pairOrdinal: 0,
            firstArm: "discovered-program",
            completedArms: [],
          },
        }),
      }),
    );
    const primaryBeforeGate = unwrap(
      await reviewM9b8CompletionSafety({
        token: current.token,
        snapshot: await snapshot(current, {
          completedProbePairs: 24,
          activePair: {
            population: "primary",
            pairOrdinal: 0,
            firstArm: "discovered-program",
            completedArms: [],
          },
        }),
      }),
    );
    const arm = unwrap(
      await reviewM9b8CompletionSafety({
        token: current.token,
        snapshot: await snapshot(current, {
          activePair: {
            population: "probe",
            pairOrdinal: 0,
            firstArm: "discovered-program",
            completedArms: ["static-one-shot"],
          },
        }),
      }),
    );
    expect(lowCap.action).toBe("reject-capacity");
    expect(schedule.action).toBe("reject-inconsistent-state");
    expect(population.action).toBe("reject-inconsistent-state");
    expect(primaryBeforeGate.action).toBe("reject-inconsistent-state");
    expect(arm.action).toBe("reject-inconsistent-state");
  });

  it("resumes a partial pair without changing the bound topology", async () => {
    const current = await fixture();
    const gate = unwrap(
      await reviewM9b8CompletionSafety({
        token: current.token,
        snapshot: await snapshot(current, {
          activePair: {
            population: "probe",
            pairOrdinal: 0,
            firstArm: "static-one-shot",
            completedArms: ["static-one-shot"],
          },
        }),
      }),
    );
    expect(gate).toMatchObject({
      authorized: true,
      action: "resume-probe-pair",
      nextArm: "discovered-program",
      providerEffects: 0,
    });
    expect(
      unwrap(await verifyM9b8CompletionSafety(current.token, gate)),
    ).toEqual(gate);
  });

  it("performs exact zero-effect report and gate replay and rejects re-signed gates", async () => {
    const current = await fixture();
    const state = await snapshot(current);
    const first = unwrap(
      await reviewM9b8CompletionSafety({
        token: current.token,
        snapshot: state,
      }),
    );
    const second = unwrap(
      await reviewM9b8CompletionSafety({
        token: current.token,
        snapshot: state,
      }),
    );
    expect(second).toEqual(first);
    expect(second.providerEffects).toBe(0);
    expect(
      unwrap(await verifyM9b8CompletionSafety(current.token, first)),
    ).toEqual(first);
    const resigned = await resign(
      { ...first, action: "campaign-complete", authorized: true },
      "gateDigest",
    );
    expect((await verifyM9b8CompletionSafety(current.token, resigned)).ok).toBe(
      false,
    );
  });
});
