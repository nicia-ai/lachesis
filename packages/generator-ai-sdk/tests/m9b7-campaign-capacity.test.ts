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
  M9B7_CAMPAIGN_CAPACITY_PROTOCOL,
  type M9b7AlternativeToken,
  type M9b7CapacityReport,
  type M9b7CapacityToken,
  type M9b7ModelLimits,
  type M9b7ProgressionSnapshot,
  prepareM9b7CampaignCapacityReview,
  reviewM9b7CompletionSafety,
  verifyM9b7CampaignCapacityReview,
  verifyM9b7CompletionSafety,
} from "../internal/m9b7-campaign-capacity.js";
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
const LIMITS_ARTIFACT = Object.freeze({
  id: "gpt-5.6-terra-limits",
  version: "2026-07-26",
  artifactDigest: digest("5"),
});
const NOW = 10_000;

type PricingOverrides = Readonly<{
  cachedInputUsdMicrosPerMillionTokens?: number;
  cacheWriteInputUsdMicrosPerMillionTokens?: number;
  longContextThresholdTokens?: number;
  longContextInputMultiplierMicros?: number;
  longContextOutputMultiplierMicros?: number;
}>;

function identities(overrides: PricingOverrides = {}): M9b5IdentityProfile {
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
      cachedInputUsdMicrosPerMillionTokens:
        overrides.cachedInputUsdMicrosPerMillionTokens ?? 250_000,
      cacheWriteInputUsdMicrosPerMillionTokens:
        overrides.cacheWriteInputUsdMicrosPerMillionTokens ?? 1_250_000,
      outputUsdMicrosPerMillionTokens: 2_000_000,
      reasoningUsdMicrosPerMillionTokens: 0,
      longContextThresholdTokens:
        overrides.longContextThresholdTokens ?? 272_000,
      longContextInputMultiplierMicros:
        overrides.longContextInputMultiplierMicros ?? 2_000_000,
      longContextOutputMultiplierMicros:
        overrides.longContextOutputMultiplierMicros ?? 1_500_000,
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
  limitsArtifact: LIMITS_ARTIFACT,
  maximumInputTokens: 922_000,
  maximumOutputTokens: 128_000,
  contextWindowTokens: 1_050_000,
  reservationBasis:
    "full-provider-model-input-maximum-including-unknown-framing",
});

let preparationPromise:
  | Promise<
      Readonly<{
        input: M9b3PreparationInput;
        preparation: M9b3Preparation;
      }>
    >
  | undefined;

async function preparedM9b3(): Promise<
  Readonly<{
    input: M9b3PreparationInput;
    preparation: M9b3Preparation;
  }>
> {
  preparationPromise ??= (async () => {
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
  return preparationPromise;
}

async function cap(
  remainingUsdMicros: number,
  provider: M9b5IdentityProfile["provider"] = PROVIDER,
): Promise<M9b6VerifiedHardCapToken> {
  const observation = {
    protocol: "lachesis-m9b6-offline-hard-cap-observation/1",
    provider,
    project: { ...PROJECT, providerId: provider.id },
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
      expectedProvider: provider,
      expectedProject: observation.project,
      expectedCurrency: "USD",
      verificationArtifact: CAP_VERIFIER,
      nowMs: NOW,
    }),
  ).token;
}

type Fixture = Readonly<{
  report: M9b7CapacityReport;
  capacityToken: M9b7CapacityToken;
  alternativeToken: M9b7AlternativeToken;
}>;

async function fixture(
  remainingUsdMicros = 4_000_000_000,
  pricingOverrides: PricingOverrides = {},
): Promise<Fixture> {
  const prepared = await preparedM9b3();
  const result = unwrap(
    await prepareM9b7CampaignCapacityReview({
      preparationInput: prepared.input,
      preparation: prepared.preparation,
      adapterIdentities: identities(pricingOverrides),
      modelLimits: MODEL_LIMITS,
      hardCapToken: await cap(remainingUsdMicros),
    }),
  );
  return {
    report: result.report,
    capacityToken: result.token,
    alternativeToken: result.alternativeToken,
  };
}

async function alternativeDigest(report: M9b7CapacityReport): Promise<string> {
  return unwrap(await digestValue(report.alternative));
}

async function snapshot(
  current: Fixture,
  overrides: Readonly<{
    completedProbePairs?: number;
    completedPrimaryPairs?: number;
    activePair?: M9b7ProgressionSnapshot["activePair"];
    probeDecision?: M9b7ProgressionSnapshot["probeDecision"];
    terminalHalt?: M9b7ProgressionSnapshot["terminalHalt"];
    overageExcessChargeUsdMicros?: number;
    outstandingReservations?: number;
    committedCostUsdMicros?: number;
    reportDigest?: string;
    alternativeDesignDigest?: string;
  }> = {},
): Promise<M9b7ProgressionSnapshot> {
  const completedProbePairs = overrides.completedProbePairs ?? 0;
  const completedPrimaryPairs = overrides.completedPrimaryPairs ?? 0;
  const activePair = overrides.activePair ?? null;
  const overageExcessChargeUsdMicros =
    overrides.overageExcessChargeUsdMicros ?? 0;
  const committedPairs =
    completedProbePairs + completedPrimaryPairs + (activePair === null ? 0 : 1);
  return {
    protocol: "lachesis-m9b7-capacity-progression-snapshot/1",
    reportDigest: overrides.reportDigest ?? current.report.reportDigest,
    alternativeDesignDigest:
      overrides.alternativeDesignDigest ??
      (await alternativeDigest(current.report)),
    completedProbePairs,
    completedPrimaryPairs,
    activePair,
    probeDecision: overrides.probeDecision ?? "not-evaluated",
    terminalHalt: overrides.terminalHalt ?? null,
    overageExcessChargeUsdMicros,
    outstandingReservations: overrides.outstandingReservations ?? 0,
    committedCostUsdMicros:
      overrides.committedCostUsdMicros ??
      committedPairs * current.report.totals.perPair.maximumCostUsdMicros +
        overageExcessChargeUsdMicros,
  };
}

async function gate(current: Fixture, state: M9b7ProgressionSnapshot) {
  return reviewM9b7CompletionSafety({
    capacityToken: current.capacityToken,
    alternativeToken: current.alternativeToken,
    snapshot: state,
  });
}

function replaceField(
  value: Readonly<Record<string, unknown>>,
  key: string,
  replacement: unknown,
): Readonly<Record<string, unknown>> {
  return { ...value, [key]: replacement };
}

async function resignRecord(
  value: Readonly<Record<string, unknown>>,
  digestField: "reportDigest" | "gateDigest",
): Promise<Readonly<Record<string, unknown>>> {
  const body = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== digestField),
  );
  return { ...body, [digestField]: unwrap(await digestValue(body)) };
}

describe("M9b.7 offline campaign capacity and completion safety", () => {
  it("keeps every M9b.7 seam out of the public facade", () => {
    expect("M9B7_CAMPAIGN_CAPACITY_PROTOCOL" in aiSdkFacade).toBe(false);
    expect("prepareM9b7CampaignCapacityReview" in aiSdkFacade).toBe(false);
    expect("reviewM9b7CompletionSafety" in aiSdkFacade).toBe(false);
  });

  it("immutably records the accepted design as a capacity NO-GO", async () => {
    const current = await fixture();
    expect(current.report).toMatchObject({
      protocol: M9B7_CAMPAIGN_CAPACITY_PROTOCOL.id,
      version: "1.0.0",
      decision: "campaign-capacity-no-go",
      originalDesign: {
        frozenCampaignCapUsdMicros: 117_964_800,
        requiredCampaignCapUsdMicros: 3_639_570_432,
        shortfallUsdMicros: 3_521_605_632,
        capacityRatioBasisPoints: 308_531,
        outcome: "campaign-capacity-no-go",
      },
      alternative: {
        requiredCampaignCapUsdMicros: 3_639_570_432,
        scientificComparability: "preserved",
        power: {
          primaryPairs: 168,
          targetPowerBasisPoints: 8_000,
          status: "unchanged-prospective-target-pending-frozen-probe",
        },
      },
    });
    expect(
      unwrap(
        await verifyM9b7CampaignCapacityReview(
          current.capacityToken,
          current.report,
        ),
      ),
    ).toEqual(current.report);
  });

  it("derives exact request, pair, arm, phase, population, and campaign totals", async () => {
    const { report } = await fixture();
    expect(report.totals.perRequestClass).toEqual([
      expect.objectContaining({
        requestClass: "root-program-authoring",
        requestsPerPair: 1,
        maximumCostUsdMicrosPerRequest: 2_501_608,
      }),
      expect.objectContaining({
        requestClass: "discovered-program-leaf-reasoning",
        requestsPerPair: 5,
        maximumCostUsdMicrosPerRequest: 2_317_288,
      }),
      expect.objectContaining({
        requestClass: "static-one-shot-query-planning",
        requestsPerPair: 1,
        maximumCostUsdMicrosPerRequest: 2_501_608,
      }),
      expect.objectContaining({
        requestClass: "static-answer-generation",
        requestsPerPair: 1,
        maximumCostUsdMicrosPerRequest: 2_366_440,
      }),
    ]);
    expect(report.totals.perPair).toMatchObject({
      requestCount: 8,
      maximumInputTokens: 7_376_000,
      maximumOutputTokens: 172_032,
      maximumCostUsdMicros: 18_956_096,
    });
    expect(report.totals.perArm).toMatchObject({
      discoveredProgram: {
        requestCount: 1_152,
        maximumCostUsdMicros: 2_704_905_216,
      },
      staticOneShot: {
        requestCount: 384,
        maximumCostUsdMicros: 934_665_216,
      },
    });
    expect(report.totals.perPhase).toMatchObject({
      authoring: {
        requestCount: 384,
        maximumCostUsdMicros: 960_617_472,
      },
      execution: {
        requestCount: 1_152,
        maximumCostUsdMicros: 2_678_952_960,
      },
      evaluation: { requestCount: 0, maximumCostUsdMicros: 0 },
    });
    expect(report.totals.probe.maximumCostUsdMicros).toBe(454_946_304);
    expect(report.totals.primary.maximumCostUsdMicros).toBe(3_184_624_128);
    expect(report.totals.campaign).toMatchObject({
      requestCount: 1_536,
      maximumInputTokens: 1_416_192_000,
      maximumOutputTokens: 33_030_144,
      maximumCostUsdMicros: 3_639_570_432,
    });
    expect(report.totals.providerModel).toEqual(report.totals.campaign);
  });

  it("rejects report mutations to schedule, attempts, outputs, pricing, limits, cap, or totals", async () => {
    const current = await fixture();
    const mutations: ReadonlyArray<unknown> = [
      {
        ...current.report,
        schedule: { ...current.report.schedule, seedCommitment: digest("e") },
      },
      {
        ...current.report,
        schedule: { ...current.report.schedule, phaseOrder: "primary-first" },
      },
      {
        ...current.report,
        totals: {
          ...current.report.totals,
          campaign: { ...current.report.totals.campaign, requestCount: 1_535 },
        },
      },
      {
        ...current.report,
        totals: {
          ...current.report.totals,
          perRequestClass: current.report.totals.perRequestClass.map(
            (profile, index) =>
              index === 0
                ? { ...profile, maximumOutputTokensPerRequest: 65_535 }
                : profile,
          ),
        },
      },
      {
        ...current.report,
        modelLimits: {
          ...current.report.modelLimits,
          maximumInputTokens: 921_999,
        },
      },
      { ...current.report, pricingDigest: digest("f") },
      {
        ...current.report,
        hardCap: {
          ...current.report.hardCap,
          remainingUsdMicros: 5_000_000_000,
        },
      },
      {
        ...current.report,
        originalDesign: {
          ...current.report.originalDesign,
          frozenCampaignCapUsdMicros: 3_639_570_432,
        },
      },
    ];
    for (const mutation of mutations) {
      if (
        mutation === null ||
        typeof mutation !== "object" ||
        Array.isArray(mutation)
      )
        throw new Error("Expected object mutation.");
      expect(
        await verifyM9b7CampaignCapacityReview(
          current.capacityToken,
          await resignRecord(
            Object.fromEntries(Object.entries(mutation)),
            "reportDigest",
          ),
        ),
      ).toMatchObject({ ok: false });
    }
  });

  it("prices the highest cache class and changes deterministically across the long-context threshold", async () => {
    const current = await fixture();
    const noLongContext = await fixture(4_000_000_000, {
      longContextThresholdTokens: 1_000_000,
    });
    const higherCacheWrite = await fixture(5_000_000_000, {
      cacheWriteInputUsdMicrosPerMillionTokens: 1_500_000,
    });
    expect(current.report.totals.campaign.maximumCostUsdMicros).toBe(
      3_639_570_432,
    );
    expect(noLongContext.report.totals.campaign.maximumCostUsdMicros).toBe(
      1_836_300_288,
    );
    expect(higherCacheWrite.report.totals.campaign.maximumCostUsdMicros).toBe(
      4_347_666_432,
    );
    expect(current.report.pricingDigest).not.toBe(
      noLongContext.report.pricingDigest,
    );
    expect(current.report.pricingDigest).not.toBe(
      higherCacheWrite.report.pricingDigest,
    );
  });

  it("rejects provider, model, tokenizer, pricing, model-limit, and hard-cap drift", async () => {
    const prepared = await preparedM9b3();
    const base = identities();
    const foreignProvider = {
      id: "offline.foreign-provider",
      version: PROVIDER.version,
      artifactDigest: digest("e"),
    };
    const cases = [
      { ...base, provider: foreignProvider },
      { ...base, model: { ...base.model, version: "drift" } },
      { ...base, tokenizer: { ...base.tokenizer, version: "drift" } },
      {
        ...base,
        pricingSnapshot: {
          ...base.pricingSnapshot,
          inputUsdMicrosPerMillionTokens: 1_000_001,
        },
      },
    ];
    for (const adapterIdentities of cases)
      expect(
        await prepareM9b7CampaignCapacityReview({
          preparationInput: prepared.input,
          preparation: prepared.preparation,
          adapterIdentities,
          modelLimits: MODEL_LIMITS,
          hardCapToken: await cap(4_000_000_000),
        }),
      ).toMatchObject({ ok: false });
    expect(
      await prepareM9b7CampaignCapacityReview({
        preparationInput: prepared.input,
        preparation: prepared.preparation,
        adapterIdentities: base,
        modelLimits: { ...MODEL_LIMITS, maximumInputTokens: 921_999 },
        hardCapToken: await cap(4_000_000_000),
      }),
    ).toMatchObject({ ok: false });
    expect(
      await prepareM9b7CampaignCapacityReview({
        preparationInput: prepared.input,
        preparation: prepared.preparation,
        adapterIdentities: base,
        modelLimits: MODEL_LIMITS,
        hardCapToken: await cap(4_000_000_000, foreignProvider),
      }),
    ).toMatchObject({ ok: false });
  });

  it("fails closed on safe-integer overflow and rounding edges", async () => {
    const prepared = await preparedM9b3();
    expect(
      await prepareM9b7CampaignCapacityReview({
        preparationInput: prepared.input,
        preparation: prepared.preparation,
        adapterIdentities: identities({
          cacheWriteInputUsdMicrosPerMillionTokens: Number.MAX_SAFE_INTEGER,
        }),
        modelLimits: MODEL_LIMITS,
        hardCapToken: await cap(4_000_000_000),
      }),
    ).toMatchObject({ ok: false });
    const current = await fixture();
    for (const profile of current.report.totals.perRequestClass)
      expect(Number.isSafeInteger(profile.maximumCostUsdMicrosPerRequest)).toBe(
        true,
      );
  });

  it("refuses to start when capacity covers an arm but not the complete pair", async () => {
    const current = await fixture(14_088_048);
    const state = await snapshot(current);
    const first = unwrap(await gate(current, state));
    const replay = unwrap(await gate(current, state));
    expect(first).toMatchObject({
      authorized: false,
      action: "reject-capacity",
      providerEffects: 0,
    });
    expect(replay).toEqual(first);
  });

  it("permits the complete probe but refuses primary without complete primary capacity", async () => {
    const current = await fixture(454_946_304);
    expect(unwrap(await gate(current, await snapshot(current)))).toMatchObject({
      authorized: true,
      action: "start-probe-pair",
    });
    const afterProbe = await snapshot(current, {
      completedProbePairs: 24,
      probeDecision: "pass",
    });
    expect(unwrap(await gate(current, afterProbe))).toMatchObject({
      authorized: false,
      action: "reject-capacity",
      remainingPhaseCostUsdMicros: 3_184_624_128,
      availableCapacityUsdMicros: 0,
    });
  });

  it("reserves a complete pair and resumes only its missing opposite arm", async () => {
    const current = await fixture();
    const perPair = current.report.totals.perPair.maximumCostUsdMicros;
    const partial = await snapshot(current, {
      activePair: {
        population: "probe",
        pairOrdinal: 0,
        firstArm: "discovered-program",
        completedArms: ["discovered-program"],
      },
      committedCostUsdMicros: perPair,
    });
    expect(unwrap(await gate(current, partial))).toMatchObject({
      authorized: true,
      action: "resume-probe-pair",
      pairOrdinal: 0,
      nextArm: "static-one-shot",
    });
    const imbalanced = {
      ...partial,
      activePair: {
        population: "probe" as const,
        pairOrdinal: 0,
        firstArm: "discovered-program" as const,
        completedArms: ["static-one-shot" as const],
      },
    };
    expect(unwrap(await gate(current, imbalanced))).toMatchObject({
      authorized: false,
      action: "reject-inconsistent-state",
    });
  });

  it("halts repeatably after ambiguity or overage with the pair reservation charged", async () => {
    const current = await fixture();
    const activePair = {
      population: "probe" as const,
      pairOrdinal: 0,
      firstArm: "discovered-program" as const,
      completedArms: [] as const,
    };
    for (const terminalHalt of ["ambiguous", "overage"] as const) {
      const overageExcessChargeUsdMicros = terminalHalt === "overage" ? 123 : 0;
      const state = await snapshot(current, {
        activePair,
        terminalHalt,
        overageExcessChargeUsdMicros,
      });
      const first = unwrap(await gate(current, state));
      const second = unwrap(await gate(current, state));
      expect(first).toMatchObject({
        authorized: false,
        action:
          terminalHalt === "ambiguous" ? "halt-ambiguous" : "halt-overage",
        providerEffects: 0,
      });
      expect(first.snapshot.committedCostUsdMicros).toBe(
        current.report.totals.perPair.maximumCostUsdMicros +
          overageExcessChargeUsdMicros,
      );
      expect(second).toEqual(first);
    }
  });

  it("rejects concurrency and inconsistent partial persisted phase state", async () => {
    const current = await fixture();
    expect(
      unwrap(
        await gate(
          current,
          await snapshot(current, { outstandingReservations: 2 }),
        ),
      ),
    ).toMatchObject({ authorized: false, action: "reject-concurrency" });
    expect(
      unwrap(
        await gate(
          current,
          await snapshot(current, {
            completedProbePairs: 1,
            committedCostUsdMicros: 0,
          }),
        ),
      ),
    ).toMatchObject({
      authorized: false,
      action: "reject-inconsistent-state",
    });
  });

  it("resumes after settlement without changing the population or repeating a pair", async () => {
    const current = await fixture();
    const state = await snapshot(current, { completedProbePairs: 1 });
    const result = unwrap(await gate(current, state));
    expect(result).toMatchObject({
      authorized: true,
      action: "start-probe-pair",
      pairOrdinal: 1,
      nextArm: "static-one-shot",
      providerEffects: 0,
    });
    expect(
      unwrap(
        await verifyM9b7CompletionSafety({
          capacityToken: current.capacityToken,
          alternativeToken: current.alternativeToken,
          snapshot: state,
          gate: result,
        }),
      ),
    ).toEqual(result);
    const alteredGate = await resignRecord(
      { ...result, authorized: false, action: "reject-capacity" },
      "gateDigest",
    );
    expect(
      await verifyM9b7CompletionSafety({
        capacityToken: current.capacityToken,
        alternativeToken: current.alternativeToken,
        snapshot: state,
        gate: alteredGate,
      }),
    ).toMatchObject({ ok: false });
    expect(unwrap(await gate(current, state))).toEqual(result);
  });

  it("blocks post-outcome population, schedule, arm-order, and digest changes", async () => {
    const current = await fixture();
    const cases = [
      await snapshot(current, {
        completedPrimaryPairs: 1,
        probeDecision: "pass",
      }),
      await snapshot(current, { reportDigest: digest("e") }),
      await snapshot(current, { alternativeDesignDigest: digest("f") }),
      await snapshot(current, {
        activePair: {
          population: "primary",
          pairOrdinal: 0,
          firstArm: "static-one-shot",
          completedArms: [],
        },
      }),
    ];
    for (const state of cases)
      expect(unwrap(await gate(current, state))).toMatchObject({
        authorized: false,
        action: "reject-inconsistent-state",
      });
  });

  it("requires the frozen probe decision and recognizes exact campaign completion", async () => {
    const current = await fixture();
    expect(
      unwrap(
        await gate(
          current,
          await snapshot(current, { completedProbePairs: 24 }),
        ),
      ),
    ).toMatchObject({ authorized: false, action: "await-probe-decision" });
    expect(
      unwrap(
        await gate(
          current,
          await snapshot(current, {
            completedProbePairs: 24,
            completedPrimaryPairs: 168,
            probeDecision: "pass",
          }),
        ),
      ),
    ).toMatchObject({
      authorized: false,
      action: "campaign-complete",
      remainingCampaignCostUsdMicros: 0,
    });
  });

  it("rejects every self-consistent outer re-signing without the opaque token lineage", async () => {
    const current = await fixture();
    const changed = replaceField(
      current.report,
      "decision",
      "campaign-capacity-go-for-prospective-preregistration-preparation",
    );
    const { reportDigest: _digest, ...body } = changed;
    void _digest;
    const resigned = {
      ...body,
      reportDigest: unwrap(await digestValue(body)),
    };
    expect(
      await verifyM9b7CampaignCapacityReview(current.capacityToken, resigned),
    ).toMatchObject({ ok: false });
  });

  it("property-checks that only the exact committed-pair cost can progress", async () => {
    const current = await fixture();
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 23 }),
        fc.integer({ min: 1, max: 10_000 }),
        async (completedProbePairs, delta) => {
          const expected =
            completedProbePairs *
            current.report.totals.perPair.maximumCostUsdMicros;
          const state = await snapshot(current, {
            completedProbePairs,
            committedCostUsdMicros: expected + delta,
          });
          expect(unwrap(await gate(current, state))).toMatchObject({
            authorized: false,
            action: "reject-inconsistent-state",
          });
        },
      ),
      { numRuns: 50 },
    );
  });
});
