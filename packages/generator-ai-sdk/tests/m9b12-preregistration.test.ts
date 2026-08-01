import { digestValue, type Result } from "@nicia-ai/lachesis";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  M9B12_PREREGISTRATION_PROTOCOL,
  type M9b12Preregistration,
  prepareM9b12Preregistration,
  verifyM9b12Preregistration,
} from "../internal/m9b12-preregistration.js";
import * as aiSdkFacade from "../src/index.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

async function fixture() {
  return unwrap(await prepareM9b12Preregistration());
}

async function resign(
  report: M9b12Preregistration,
  changes: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  const { preregistrationDigest: ignored, ...body } = report;
  void ignored;
  const changed = { ...body, ...changes };
  return {
    ...changed,
    preregistrationDigest: unwrap(await digestValue(changed)),
  };
}

describe("M9b.12 offline preregistration preparation", () => {
  it("freezes the research question, exact topology, and ready-only decision", async () => {
    const current = await fixture();
    expect(current.preregistration).toMatchObject({
      protocol: M9B12_PREREGISTRATION_PROTOCOL.id,
      decision: "preregistration-package-ready-awaiting-external-authorization",
      treatment: {
        arm: "discovered-program",
        retrievalProviderCalls: 0,
      },
      control: { arm: "static-one-shot", retrievalProviderCalls: 0 },
      matching: {
        inferenceCallsPerArm: 2,
        inferenceCallsPerPair: 4,
        countRequestsPerPair: 4,
        retries: 0,
        maximumConcurrency: 1,
      },
    });
    expect(
      await verifyM9b12Preregistration(current.token, current.preregistration),
    ).toMatchObject({ ok: true });
  });

  it("keeps every M9b.12 entry point off the package facade", () => {
    expect("M9B12_PREREGISTRATION_PROTOCOL" in aiSdkFacade).toBe(false);
    expect("prepareM9b12Preregistration" in aiSdkFacade).toBe(false);
    expect("verifyM9b12Preregistration" in aiSdkFacade).toBe(false);
  });

  it("binds exact M9b.3, M9b.10c, moderate-envelope, and M9b.11 identities", async () => {
    const current = await fixture();
    expect(current.preregistration.bindings).toMatchObject({
      preparation: {
        id: "lachesis-m9b3f-offline-prospective-study-preparation",
        version: "1.0.0",
      },
      topology: {
        id: "lachesis-m9b10c-offline-selected-topology-integration",
        version: "1.1.0",
      },
      measurement: {
        id: "lachesis-m9b10c-selected-topology-measurement",
        version: "1.1.0",
      },
      analyzer: {
        id: "lachesis-m9b10c-exact-primary-mcnemar",
        version: "1.1.0",
        opaqueCompletePrimaryTokenRequired: true,
        futureTokenPresent: false,
      },
      pricing: {
        id: "lachesis-m9b11-offline-shadow-priced-campaign-freeze",
        version: "1.0.0",
        reportDigest:
          "79e03015c7c1f6c4b2296e7b6e8ac5f37556dd90fd2bf96d4460c227dc4ed090",
      },
    });
    expect(current.preregistration.bindings.envelope.classes).toHaveLength(4);
    expect(
      new Set(
        current.preregistration.bindings.envelope.classes.map(
          (entry) => entry.requestClass,
        ),
      ).size,
    ).toBe(4);
  });

  it("freezes the balanced 24-cell probe and complete 168-pair primary", async () => {
    const { preregistration } = await fixture();
    expect(preregistration.population).toMatchObject({
      cells: 24,
      probePairsPerCell: 1,
      probePairs: 24,
      primaryPairsPerCell: 7,
      primaryPairs: 168,
      totalPairs: 192,
      countRequests: 768,
      inferenceCalls: 768,
      maximumProviderHttpRequests: 1_536,
      materialized: false,
    });
    expect(preregistration.population.families).toHaveLength(8);
    expect(preregistration.population.scales).toHaveLength(3);
    expect(preregistration.population.disjointnessDimensions).toHaveLength(11);
  });

  it("freezes the complete first-attempt endpoint and retains every failure class", async () => {
    const { preregistration } = await fixture();
    expect(preregistration.primaryEndpoint.requiredStages).toHaveLength(11);
    expect(preregistration.primaryEndpoint).toMatchObject({
      failuresRetained: true,
      abstentionsRetained: true,
      truncationsRetained: true,
      ambiguousEffectsRetained: true,
      haltedPairsRetained: true,
      repairReliabilityUsedForSuccess: false,
    });
  });

  it("binds the executable exact one-sided McNemar boundary and direction", async () => {
    const { preregistration } = await fixture();
    expect(preregistration.analysis).toMatchObject({
      test: "exact-one-sided-conditional-mcnemar",
      direction: "discovered-program-favorable",
      alphaNumerator: 1,
      alphaDenominator: 20,
      exactIntegerRationalDecision: true,
      primaryPairsRequired: 168,
      subsetSelectionPermitted: false,
    });
    expect(preregistration.analysis.executableVectors).toEqual([
      {
        discoveredOnly: 5,
        staticOnly: 0,
        numerator: "1",
        denominator: "32",
        significant: true,
      },
      {
        discoveredOnly: 4,
        staticOnly: 0,
        numerator: "1",
        denominator: "16",
        significant: false,
      },
      {
        discoveredOnly: 0,
        staticOnly: 5,
        numerator: "32",
        denominator: "32",
        significant: false,
      },
    ]);
  });

  it("binds the exact probe gate and makes a failed probe permanently terminal", async () => {
    const { preregistration } = await fixture();
    expect(preregistration.probeAdvancement).toMatchObject({
      requiredPairs: 24,
      componentAlphaBasisPoints: 250,
      projectedPrimaryPairs: 168,
      primaryAlphaBasisPoints: 500,
      targetPowerBasisPoints: 8_000,
      qualitativeOverridePermitted: false,
      relaxedThresholdPermitted: false,
      populationEnrichmentPermitted: false,
      postProviderChangePermitted: false,
      failurePermanentlyPreventsPrimary: true,
    });
  });

  it("preserves the exact shadow-priced budget and all pricing kill gates", async () => {
    const { preregistration } = await fixture();
    expect(preregistration.financial).toEqual({
      selectedEnvelope: "moderate",
      inferenceCeilingUsdMicros: 342_097_920,
      countShadowContingencyUsdMicros: 117_964_800,
      operationalCampaignCeilingUsdMicros: 460_062_720,
      prospectiveProviderHardCapUsdMicros: 500_000_000,
      headroomUsdMicros: 39_937_280,
      projectInitialSpendUsdMicros: 0,
      dedicatedProjectOnly: true,
      shadowRateUsdMicrosPerMillionTokens: 3_125_000,
      countContractuallyFreeClaimed: false,
      providerCapMayLag: true,
      ambiguityConsumesFullReservation: true,
      overageHalts: true,
      retryLimit: 0,
      maximumConcurrency: 1,
      budgetActivated: false,
    });
    expect(preregistration.countPricingKillGates).toHaveLength(12);
  });

  it("keeps corpus, gold, credentials, execution namespaces, and provider effects absent", async () => {
    const { preregistration } = await fixture();
    expect(preregistration.audit).toMatchObject({
      corpusPresent: false,
      hiddenGoldPresent: false,
      credentialPresent: false,
      executionNamespacePresent: false,
      providerRequestPossible: false,
      providerEffects: 0,
      countEffects: 0,
      inferenceEffects: 0,
      networkEffects: 0,
    });
    expect(preregistration.authority).toMatchObject({
      externalRegistrationAuthorized: false,
      corpusMaterializationAuthorized: false,
      projectAccessAuthorized: false,
      credentialAccessAuthorized: false,
      providerAccessAuthorized: false,
      tokenCountAuthorized: false,
      inferenceAuthorized: false,
      campaignActivationAuthorized: false,
      budgetActivationAuthorized: false,
      pushAuthorized: false,
    });
  });

  it("defines seven distinct future authorization texts without issuing them", async () => {
    const { preregistration } = await fixture();
    expect(preregistration.futureAuthorizations.issued).toBe(false);
    expect(preregistration.futureAuthorizations.texts).toHaveLength(7);
    expect(
      new Set(
        preregistration.futureAuthorizations.texts.map((entry) => entry.kind),
      ).size,
    ).toBe(7);
    expect(preregistration.externalRegistrationFormat.recordPresent).toBe(
      false,
    );
  });

  it("rejects self-consistent topology, population, endpoint, analysis, financial, and authority mutations", async () => {
    const current = await fixture();
    const candidates = [
      await resign(current.preregistration, {
        matching: {
          ...current.preregistration.matching,
          inferenceCallsPerArm: 3,
        },
      }),
      await resign(current.preregistration, {
        population: {
          ...current.preregistration.population,
          primaryPairs: 167,
        },
      }),
      await resign(current.preregistration, {
        primaryEndpoint: {
          ...current.preregistration.primaryEndpoint,
          requiredStages:
            current.preregistration.primaryEndpoint.requiredStages.slice(1),
        },
      }),
      await resign(current.preregistration, {
        analysis: {
          ...current.preregistration.analysis,
          alphaDenominator: 10,
        },
      }),
      await resign(current.preregistration, {
        financial: {
          ...current.preregistration.financial,
          countShadowContingencyUsdMicros: 0,
        },
      }),
      await resign(current.preregistration, {
        authority: {
          ...current.preregistration.authority,
          tokenCountAuthorized: true,
        },
      }),
    ];
    for (const candidate of candidates)
      expect(
        await verifyM9b12Preregistration(current.token, candidate),
      ).toMatchObject({ ok: false });
  });

  it("rejects old, foreign, and disclosure-contaminated artifacts", async () => {
    const current = await fixture();
    expect(
      await verifyM9b12Preregistration(current.token, {
        protocol: "lachesis-m9b11-offline-shadow-priced-campaign-freeze",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await verifyM9b12Preregistration(
        current.token,
        await resign(current.preregistration, {
          population: {
            ...current.preregistration.population,
            probeInventoryIdentity: "future-case-identity-leak",
          },
        }),
      ),
    ).toMatchObject({ ok: false });
  });

  it("rederives the exact package with zero effects", async () => {
    const current = await fixture();
    const verified = unwrap(
      await verifyM9b12Preregistration(current.token, current.preregistration),
    );
    expect(verified).toEqual(current.preregistration);
    expect(verified.audit).toMatchObject({
      providerEffects: 0,
      countEffects: 0,
      inferenceEffects: 0,
      networkEffects: 0,
    });
  });

  it("property-checks immutable family-by-scale population arithmetic", async () => {
    const { preregistration } = await fixture();
    fc.assert(
      fc.property(
        fc.constantFrom(...preregistration.population.families),
        fc.constantFrom(...preregistration.population.scales),
        (family, scale) => {
          expect(preregistration.population.families).toContain(family);
          expect(preregistration.population.scales).toContain(scale);
          expect(
            preregistration.population.primaryPairsPerCell *
              preregistration.population.cells,
          ).toBe(preregistration.population.primaryPairs);
          expect(
            preregistration.population.probePairsPerCell *
              preregistration.population.cells,
          ).toBe(preregistration.population.probePairs);
        },
      ),
      { numRuns: 24 },
    );
  });
});
