import { digestValue, type Result } from "@nicia-ai/lachesis";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import * as generatorFacade from "../src/index.js";
import {
  M9B3_PREPARATION_PROTOCOL,
  type M9b3PreparationInput,
  type M9b3ProviderProfileInput,
  prepareM9b3OfflineStudy,
  verifyM9b3OfflineStudy,
} from "../src/m9b3-preparation.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok)
    throw new Error(`Expected success: ${JSON.stringify(result.error)}`);
  return result.value;
}

function providerProfile(): M9b3ProviderProfileInput {
  return {
    provider: { id: "offline.test-provider", version: "2026-07-26" },
    requestProtocol: {
      providerId: "offline.test-provider",
      id: "offline.test-provider.responses",
      version: "2026-07-26",
    },
    requestSerializer: {
      providerId: "offline.test-provider",
      requestProtocolId: "offline.test-provider.responses",
      id: "offline.test-provider.canonical-request",
      version: "1",
      schemaDigest: "1".repeat(64),
    },
    model: {
      providerId: "offline.test-provider",
      id: "offline.test-shared-model",
      revision: "2026-07-26",
      contextWindowTokens: 262_144,
      maximumOutputTokens: 131_072,
      reasoningMode: "disabled",
    },
    tokenizer: {
      providerId: "offline.test-provider",
      modelId: "offline.test-shared-model",
      id: "offline.test-exact-tokenizer",
      version: "2026-07-26",
      artifactDigest: "2".repeat(64),
      conformanceVectorDigest: "3".repeat(64),
      countsExactSerializedRequests: true,
      countsExactSerializedResponses: true,
    },
    pricing: {
      providerId: "offline.test-provider",
      modelId: "offline.test-shared-model",
      currency: "USD",
      inputUsdMicrosPerMillionTokens: 1_000_000,
      outputUsdMicrosPerMillionTokens: 2_000_000,
      reasoningUsdMicrosPerMillionTokens: 0,
      snapshotId: "offline-pricing-2026-07-26",
      sourceDigest: "4".repeat(64),
    },
  };
}

function preparationInput(): M9b3PreparationInput {
  return {
    providerProfile: providerProfile(),
    promptBundleDigest: "7".repeat(64),
    allocationSeedCommitment: "5".repeat(64),
    scheduleSeedCommitment: "6".repeat(64),
  };
}

async function resign<T extends object>(
  value: T,
): Promise<T & Readonly<{ preparationDigest: string }>> {
  return {
    ...value,
    preparationDigest: unwrap(await digestValue(value)),
  };
}

describe("M9b.3 offline prospective preparation", () => {
  it("keeps the complete M9b.3 preparation surface private", () => {
    expect("M9B3_PREPARATION_PROTOCOL" in generatorFacade).toBe(false);
    expect("prepareM9b3OfflineStudy" in generatorFacade).toBe(false);
    expect("verifyM9b3OfflineStudy" in generatorFacade).toBe(false);
  });

  it("freezes exact prospective identities while retaining every live NO-GO", async () => {
    const input = preparationInput();
    const prepared = unwrap(await prepareM9b3OfflineStudy(input));
    expect(prepared).toMatchObject({
      protocol: M9B3_PREPARATION_PROTOCOL.id,
      version: M9B3_PREPARATION_PROTOCOL.version,
      status: "offline-preparation-complete-m9b-live-no-go",
      providerProfile: input.providerProfile,
      authoringVisibility: {
        visible: "task-grammar-capabilities-and-budget-only",
        providerModelTokenizerPricingAndArmIdentitiesExcluded: true,
      },
      studyBindings: {
        programDiscovery: {
          id: "lachesis-m9b1b-offline-program-discovery",
          version: "1.0.0",
          promptBundleDigest: input.promptBundleDigest,
        },
        developmentEvaluator: { campaignEligible: false },
        finalGoldIdentity: "absent-pending-independent-validation",
        finalEvaluatorIdentity: "absent-pending-independent-validation",
      },
      corpusConstruction: {
        finalCorpusMaterialized: false,
        finalCorpusIdentity: "absent",
      },
      allocation: {
        cells: 24,
        protocolProbePairedCases: 24,
        primaryPairedCases: 168,
        primaryCasesPerCell: 7,
        allocationMaterialized: false,
      },
      schedule: {
        distinctSessionsPerArmAndRole: true,
        sessionReuseAcrossCases: false,
        scheduleMaterialized: false,
        scheduleDigest: "absent",
      },
      matchedBudget: {
        inputTokensPerArm: 135_168,
        outputTokensPerArm: 86_016,
        reasoningTokensPerArm: 0,
        maximumCostUsdMicrosPerArm: 307_200,
        preparedPairedCases: 192,
        maximumPreparedStudyCostUsdMicros: 117_964_800,
        sameAggregateCeilingAcrossArms: true,
        spendingAuthorized: false,
      },
      preregistration: {
        status: "offline-draft-not-externally-registered",
        corpusIdentity: "absent",
        externalRegistration: "not-performed",
        executionAuthorization: "absent",
      },
      authority: {
        corpusMaterializationAuthorized: false,
        credentialsAccessed: false,
        providerAdapterCreated: false,
        providerCallsAuthorized: false,
        executionStateCreated: false,
        externalPreregistrationPerformed: false,
        liveExecutionAuthorized: false,
      },
      decision: { outcome: "no-go" },
    });
    expect(await verifyM9b3OfflineStudy(input, prepared)).toMatchObject({
      ok: true,
    });
    expect(await prepareM9b3OfflineStudy(input)).toEqual({
      ok: true,
      value: prepared,
    });
    expect(
      await prepareM9b3OfflineStudy({ ...input, apiKey: "forbidden-secret" }),
    ).toMatchObject({ ok: false });
  });

  it("rejects cross-bound provider, model, tokenizer, pricing, and seed identities", async () => {
    const original = preparationInput();
    const invalidProfiles: ReadonlyArray<unknown> = [
      {
        ...original,
        providerProfile: {
          ...original.providerProfile,
          requestProtocol: {
            ...original.providerProfile.requestProtocol,
            providerId: "offline.other-provider",
          },
        },
      },
      {
        ...original,
        providerProfile: {
          ...original.providerProfile,
          requestSerializer: {
            ...original.providerProfile.requestSerializer,
            requestProtocolId: "offline.other-protocol",
          },
        },
      },
      {
        ...original,
        providerProfile: {
          ...original.providerProfile,
          model: {
            ...original.providerProfile.model,
            providerId: "offline.other-provider",
          },
        },
      },
      {
        ...original,
        providerProfile: {
          ...original.providerProfile,
          tokenizer: {
            ...original.providerProfile.tokenizer,
            modelId: "offline.other-model",
          },
        },
      },
      {
        ...original,
        providerProfile: {
          ...original.providerProfile,
          pricing: {
            ...original.providerProfile.pricing,
            providerId: "offline.other-provider",
          },
        },
      },
      {
        ...original,
        providerProfile: {
          ...original.providerProfile,
          model: {
            ...original.providerProfile.model,
            contextWindowTokens: 122_879,
          },
        },
      },
      {
        ...original,
        providerProfile: {
          ...original.providerProfile,
          model: {
            ...original.providerProfile.model,
            maximumOutputTokens: 65_535,
          },
        },
      },
      {
        ...original,
        providerProfile: {
          ...original.providerProfile,
          tokenizer: {
            ...original.providerProfile.tokenizer,
            countsExactSerializedRequests: false,
          },
        },
      },
      {
        ...original,
        scheduleSeedCommitment: original.allocationSeedCommitment,
      },
    ];
    for (const invalidProfile of invalidProfiles)
      expect(await prepareM9b3OfflineStudy(invalidProfile)).toMatchObject({
        ok: false,
      });
  });

  it("rejects re-signed identity, allocation, schedule, budget, gate, and preregistration mutations", async () => {
    const input = preparationInput();
    const prepared = unwrap(await prepareM9b3OfflineStudy(input));
    const { preparationDigest: _preparationDigest, ...body } = prepared;
    void _preparationDigest;
    const changedProfile = {
      ...prepared.providerProfile,
      model: { ...prepared.providerProfile.model, revision: "forged-revision" },
    };
    const changedStudyBindings = {
      ...prepared.studyBindings,
      programDiscovery: {
        ...prepared.studyBindings.programDiscovery,
        promptBundleDigest: "b".repeat(64),
      },
    };
    const changedAllocation = {
      ...prepared.allocation,
      allocationSeedCommitment: "7".repeat(64),
    };
    const changedSchedule = {
      ...prepared.schedule,
      seedCommitment: "8".repeat(64),
    };
    const changedBudget = {
      ...prepared.matchedBudget,
      maximumCostUsdMicrosPerArm:
        prepared.matchedBudget.maximumCostUsdMicrosPerArm + 1,
    };
    const mutations = [
      {
        ...body,
        studyBindings: changedStudyBindings,
        studyBindingsDigest: unwrap(await digestValue(changedStudyBindings)),
      },
      {
        ...body,
        providerProfile: changedProfile,
        providerProfileDigest: unwrap(await digestValue(changedProfile)),
      },
      {
        ...body,
        allocation: changedAllocation,
        allocationDigest: unwrap(await digestValue(changedAllocation)),
      },
      {
        ...body,
        schedule: changedSchedule,
        scheduleProtocolDigest: unwrap(await digestValue(changedSchedule)),
      },
      {
        ...body,
        matchedBudget: changedBudget,
        matchedBudgetDigest: unwrap(await digestValue(changedBudget)),
      },
      { ...body, gatesDigest: "9".repeat(64) },
      { ...body, preregistrationMaterialsDigest: "a".repeat(64) },
    ] as const;
    for (const mutation of mutations)
      expect(
        await verifyM9b3OfflineStudy(input, await resign(mutation)),
      ).toMatchObject({ ok: false });
  });

  it("derives safe exact cost ceilings over bounded prospective price inputs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        async (inputRate, outputRate) => {
          const original = preparationInput();
          const input = {
            ...original,
            providerProfile: {
              ...original.providerProfile,
              pricing: {
                ...original.providerProfile.pricing,
                inputUsdMicrosPerMillionTokens: inputRate,
                outputUsdMicrosPerMillionTokens: outputRate,
              },
            },
          };
          const prepared = unwrap(await prepareM9b3OfflineStudy(input));
          expect(prepared.matchedBudget.maximumCostUsdMicrosPerArm).toBe(
            Math.ceil((135_168 * inputRate) / 1_000_000) +
              Math.ceil((86_016 * outputRate) / 1_000_000),
          );
          expect(await verifyM9b3OfflineStudy(input, prepared)).toMatchObject({
            ok: true,
          });
        },
      ),
      { numRuns: 40 },
    );
  });

  it("fails closed when a price multiplication exceeds safe integer bounds", async () => {
    const original = preparationInput();
    expect(
      await prepareM9b3OfflineStudy({
        ...original,
        providerProfile: {
          ...original.providerProfile,
          pricing: {
            ...original.providerProfile.pricing,
            inputUsdMicrosPerMillionTokens: 1_000_000_000_000,
          },
        },
      }),
    ).toMatchObject({ ok: false });
  });
});
