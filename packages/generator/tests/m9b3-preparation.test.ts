import { digestValue, type Result } from "@nicia-ai/lachesis";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import * as generatorFacade from "../src/index.js";
import {
  M9B2_CORPUS_SCALES,
  M9B2_TASK_FAMILIES,
  type M9b2HiddenExpectation,
  type M9b2PreparedSuite,
  type M9b2PublicDevelopmentCase,
  prepareM9b2DevelopmentSuite,
} from "../src/m9b2-measurement.js";
import {
  bindM9b3Populations,
  deriveM9b3ScheduleSeedCommitment,
  evaluateM9b3ProbeAdvancement,
  M9B3_PREPARATION_PROTOCOL,
  type M9b3PreparationInput,
  type M9b3ProviderProfileInput,
  materializeM9b3Schedule,
  prepareM9b3OfflineStudy,
  validateM9b3CorpusScale,
  verifyM9b3CorpusScale,
  verifyM9b3MaterializedSchedule,
  verifyM9b3OfflineStudy,
  verifyM9b3PopulationBinding,
  verifyM9b3ProbeAdvancement,
} from "../src/m9b3-preparation.js";
import { M9B2_PUBLIC_DEVELOPMENT_CASES } from "./fixtures/m9b2-development.js";
import { M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS } from "./fixtures/m9b2-hidden.js";

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
    scheduleSeedCommitment: "6".repeat(64),
  };
}

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error("Missing M9b.3a test fixture.");
  return value;
}

const SCALE_TARGET_BYTES = Object.freeze({
  "1x": 4_096,
  "8x": 32_768,
  "32x": 131_072,
});

function exactScaledCorpus(
  publicCase: M9b2PublicDevelopmentCase,
  expectation: M9b2HiddenExpectation,
  suffix: string,
): Readonly<{
  publicCase: M9b2PublicDevelopmentCase;
  expectation: M9b2HiddenExpectation;
}> {
  const changedFacts = expectation.supportingFacts.map((fact) => ({
    ...fact,
    sourceLineageId: `${fact.sourceLineageId}-${suffix}`,
    exactText: `${fact.exactText} ${suffix}`,
  }));
  const changedDocuments = publicCase.corpus.documents.map((document) => {
    const facts = expectation.supportingFacts.filter(
      (fact) => fact.documentId === document.id,
    );
    return {
      ...document,
      title: `${document.title} ${suffix}`,
      text: `${facts.reduce(
        (text, fact) =>
          text.replace(fact.exactText, `${fact.exactText} ${suffix}`),
        document.text,
      )} ${suffix}`,
    };
  });
  const encoder = new TextEncoder();
  const targetBytes = SCALE_TARGET_BYTES[publicCase.scale];
  const changedBytes = changedDocuments.reduce(
    (sum, document) => sum + encoder.encode(document.text).byteLength,
    0,
  );
  if (changedBytes >= targetBytes)
    throw new Error("M9b.3a fixture base corpus exceeds its scale target.");
  const paddingDocuments: Array<
    Readonly<{ id: string; title: string; text: string }>
  > = [];
  let remaining = targetBytes - changedBytes;
  let paddingIndex = 0;
  while (remaining > 0) {
    const prefix = `${suffix}-${String(paddingIndex)}-`;
    const bytes = Math.min(60_000, remaining);
    if (bytes < prefix.length)
      throw new Error("M9b.3a fixture padding cannot preserve exact bytes.");
    paddingDocuments.push({
      id: `padding-${String(paddingIndex)}`,
      title: `Natural background ${suffix} ${String(paddingIndex)}`,
      text: `${prefix}${"p".repeat(bytes - prefix.length)}`,
    });
    remaining -= bytes;
    paddingIndex += 1;
  }
  const caseId = `${publicCase.id}-${suffix}`;
  return Object.freeze({
    publicCase: {
      ...publicCase,
      id: caseId,
      task: `${publicCase.task} Independent lineage ${suffix}.`,
      corpus: {
        ...publicCase.corpus,
        id: `${publicCase.corpus.id}-${suffix}`,
        documents: [...changedDocuments, ...paddingDocuments],
      },
    },
    expectation: {
      ...expectation,
      caseId,
      acceptedAnswers: expectation.acceptedAnswers.map(
        (answer) => `${answer} ${suffix}`,
      ),
      supportingFacts: changedFacts,
      entityLineageIds: expectation.entityLineageIds.map(
        (identity) => `${identity}-${suffix}`,
      ),
      sourceLineageIds: expectation.sourceLineageIds.map(
        (identity) => `${identity}-${suffix}`,
      ),
      normalizedTaskTemplate: `${expectation.normalizedTaskTemplate} ${suffix}`,
    },
  });
}

async function createScaledSuite(
  role: "probe" | "primary",
  waves: number,
): Promise<M9b2PreparedSuite> {
  const expectations = new Map(
    M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS.map((expectation) => [
      expectation.caseId,
      expectation,
    ]),
  );
  const fixtures = Array.from({ length: waves }, (_value, wave) =>
    M9B2_PUBLIC_DEVELOPMENT_CASES.map((publicCase, index) =>
      exactScaledCorpus(
        publicCase,
        required(expectations.get(publicCase.id)),
        `${role}-${String(wave)}-${String(index)}`,
      ),
    ),
  ).flat();
  return unwrap(
    await prepareM9b2DevelopmentSuite({
      publicCases: fixtures.map((fixture) => fixture.publicCase),
      hiddenExpectations: fixtures.map((fixture) => fixture.expectation),
    }),
  );
}

let populationsPromise:
  | Promise<Readonly<{ probe: M9b2PreparedSuite; primary: M9b2PreparedSuite }>>
  | undefined;

function preparedPopulations(): Promise<
  Readonly<{ probe: M9b2PreparedSuite; primary: M9b2PreparedSuite }>
> {
  populationsPromise ??= Promise.all([
    createScaledSuite("probe", 1),
    createScaledSuite("primary", 7),
  ]).then(([probe, primary]) => Object.freeze({ probe, primary }));
  return populationsPromise;
}

async function resign<T extends object>(
  value: T,
): Promise<T & Readonly<{ preparationDigest: string }>> {
  return {
    ...value,
    preparationDigest: unwrap(await digestValue(value)),
  };
}

describe("M9b.3a offline prospective preparation correction", () => {
  it("keeps the complete M9b.3a preparation surface private", () => {
    expect("M9B3_PREPARATION_PROTOCOL" in generatorFacade).toBe(false);
    expect("prepareM9b3OfflineStudy" in generatorFacade).toBe(false);
    expect("verifyM9b3OfflineStudy" in generatorFacade).toBe(false);
    expect("bindM9b3Populations" in generatorFacade).toBe(false);
    expect("materializeM9b3Schedule" in generatorFacade).toBe(false);
    expect("evaluateM9b3ProbeAdvancement" in generatorFacade).toBe(false);
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
        scaleValidation: {
          baseBytes: 4_096,
          ranges: [
            { scale: "1x", minimumBytesInclusive: 3_072 },
            { scale: "8x", minimumBytesInclusive: 24_576 },
            { scale: "32x", minimumBytesInclusive: 98_304 },
          ],
        },
      },
      allocation: {
        cells: 24,
        protocolProbePairedCases: 24,
        primaryPairedCases: 168,
        primaryCasesPerCell: 7,
        probeSuiteIdentity: "absent-pending-corpus-construction",
        primarySuiteIdentity: "absent-pending-corpus-construction",
        completeInventoriesRequired: true,
        allocationMaterialized: false,
      },
      schedule: {
        distinctSessionsPerArmAndRole: true,
        sessionReuseAcrossCases: false,
        scheduleMaterialized: false,
        scheduleDigest: "absent",
      },
      probeGate: {
        probePairedCases: 24,
        primaryPairedCases: 168,
        confidenceMethod:
          "bonferroni-two-one-sided-clopper-pearson-exact-tail-inversion",
        componentAlphaBasisPoints: 250,
        targetPowerBasisPoints: 8_000,
      },
      matchedBudget: {
        inputTokensPerArm: 135_168,
        outputTokensPerArm: 86_016,
        reasoningTokensPerArm: 0,
        maximumCostUsdMicrosPerArm: 307_200,
        preparedPairedCases: 192,
        maximumPreparedStudyCostUsdMicros: 117_964_800,
        evaluatorProviderCalls: 0,
        evaluatorModelTokens: 0,
        evaluatorCostUsdMicros: 0,
        sdkTransportRetriesPerLogicalRequest: 0,
        controllerDispatchRetriesPerLogicalRequest: 0,
        maximumProviderAttemptsPerLogicalRequest: 1,
        maximumLogicalProviderRequestsPerPair: 8,
        maximumProviderAttemptsPerPair: 8,
        maximumPreparedProviderAttempts: 1_536,
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
      primarySuiteIdentity: "forged-suite",
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

  it("operationalizes every corpus scale with exact inclusive byte ranges", async () => {
    const boundaries = [
      { claimedScale: "1x", corpusBytes: 3_072 },
      { claimedScale: "1x", corpusBytes: 5_120 },
      { claimedScale: "8x", corpusBytes: 24_576 },
      { claimedScale: "8x", corpusBytes: 40_960 },
      { claimedScale: "32x", corpusBytes: 98_304 },
      { claimedScale: "32x", corpusBytes: 163_840 },
    ] as const;
    for (const input of boundaries) {
      const validation = unwrap(await validateM9b3CorpusScale(input));
      expect(await verifyM9b3CorpusScale(input, validation)).toMatchObject({
        ok: true,
      });
      expect(
        await verifyM9b3CorpusScale(input, {
          ...validation,
          corpusBytes: validation.corpusBytes + 1,
          validationDigest: "0".repeat(64),
        }),
      ).toMatchObject({ ok: false });
    }
    for (const input of [
      { claimedScale: "1x", corpusBytes: 3_071 },
      { claimedScale: "1x", corpusBytes: 5_121 },
      { claimedScale: "8x", corpusBytes: 24_575 },
      { claimedScale: "32x", corpusBytes: 163_841 },
      { claimedScale: "forged", corpusBytes: 4_096 },
    ])
      expect(await validateM9b3CorpusScale(input)).toMatchObject({ ok: false });
  });

  it("freezes an exact conservative probe gate and fails closed", async () => {
    const passInput = {
      discoveredOnly: 24,
      staticOnly: 0,
      bothSucceeded: 0,
      bothFailed: 0,
    };
    const pass = unwrap(await evaluateM9b3ProbeAdvancement(passInput));
    expect(pass).toMatchObject({
      discordantPairs: 24,
      outcome: { status: "pass" },
    });
    expect(await verifyM9b3ProbeAdvancement(passInput, pass)).toMatchObject({
      ok: true,
    });
    const decisions = await Promise.all([
      evaluateM9b3ProbeAdvancement({
        discoveredOnly: 0,
        staticOnly: 0,
        bothSucceeded: 12,
        bothFailed: 12,
      }),
      evaluateM9b3ProbeAdvancement({
        discoveredOnly: 0,
        staticOnly: 24,
        bothSucceeded: 0,
        bothFailed: 0,
      }),
      evaluateM9b3ProbeAdvancement({
        discoveredOnly: 8,
        staticOnly: 0,
        bothSucceeded: 8,
        bothFailed: 8,
      }),
    ]);
    expect(decisions.map((decision) => unwrap(decision).outcome)).toEqual([
      { status: "no-go", reason: "zero-discordant-pairs" },
      { status: "no-go", reason: "nonpositive-conservative-direction" },
      {
        status: "no-go",
        reason: "conservative-power-below-8000-basis-points",
      },
    ]);
    const { decisionDigest: _digest, ...body } = pass;
    void _digest;
    const changed = {
      ...body,
      conservativePowerAt168BasisPoints: 0,
    };
    expect(
      await verifyM9b3ProbeAdvancement(passInput, {
        ...changed,
        decisionDigest: unwrap(await digestValue(changed)),
      }),
    ).toMatchObject({ ok: false });
    expect(
      await evaluateM9b3ProbeAdvancement({
        discoveredOnly: 24,
        staticOnly: 1,
        bothSucceeded: 0,
        bothFailed: 0,
      }),
    ).toMatchObject({ ok: false });
  });

  it("binds exact disjoint probe and primary suite inventories", async () => {
    const populations = await preparedPopulations();
    const binding = unwrap(
      await bindM9b3Populations(populations.probe, populations.primary),
    );
    expect(binding).toMatchObject({
      probe: { caseCount: 24, casesPerCell: 1 },
      primary: { caseCount: 168, casesPerCell: 7 },
      combinedSemanticProblemsUnique: true,
      primaryReportCoverage:
        "exact-complete-primary-suite-token-required-by-m9b2d",
    });
    expect(binding.probe.cases).toHaveLength(24);
    expect(binding.primary.cases).toHaveLength(168);
    expect(binding.probe.suiteDigest).not.toBe(binding.primary.suiteDigest);
    expect(
      await verifyM9b3PopulationBinding(
        populations.probe,
        populations.primary,
        binding,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await bindM9b3Populations(populations.probe, populations.probe),
    ).toMatchObject({ ok: false });
    expect(
      await bindM9b3Populations(populations.primary, populations.probe),
    ).toMatchObject({ ok: false });
    const { bindingDigest: _digest, ...body } = binding;
    void _digest;
    const changed = {
      ...body,
      primary: {
        ...body.primary,
        cases: body.primary.cases.slice(1),
        caseCount: body.primary.caseCount - 1,
      },
    };
    expect(
      await verifyM9b3PopulationBinding(
        populations.probe,
        populations.primary,
        {
          ...changed,
          bindingDigest: unwrap(await digestValue(changed)),
        },
      ),
    ).toMatchObject({ ok: false });
  }, 15_000);

  it("materializes and rederives the exact counterbalanced schedule", async () => {
    const populations = await preparedPopulations();
    const seedReveal = "d".repeat(64);
    const scheduleSeedCommitment = unwrap(
      await deriveM9b3ScheduleSeedCommitment(seedReveal),
    );
    const input = { ...preparationInput(), scheduleSeedCommitment };
    const preparation = unwrap(await prepareM9b3OfflineStudy(input));
    const schedule = unwrap(
      await materializeM9b3Schedule(
        input,
        preparation,
        populations.probe,
        populations.primary,
        seedReveal,
      ),
    );
    expect(schedule.probeEntries).toHaveLength(24);
    expect(schedule.primaryEntries).toHaveLength(168);
    expect(
      schedule.probeEntries.filter(
        (entry) => entry.firstArm === "discovered-program",
      ),
    ).toHaveLength(12);
    expect(
      schedule.primaryEntries.filter(
        (entry) => entry.firstArm === "discovered-program",
      ),
    ).toHaveLength(84);
    for (const family of M9B2_TASK_FAMILIES) {
      for (const scale of M9B2_CORPUS_SCALES) {
        const cell = schedule.primaryEntries.filter(
          (entry) => entry.family === family && entry.scale === scale,
        );
        expect(cell).toHaveLength(7);
        expect(
          Math.abs(
            cell.filter((entry) => entry.firstArm === "discovered-program")
              .length -
              cell.filter((entry) => entry.firstArm === "static-one-shot")
                .length,
          ),
        ).toBe(1);
      }
    }
    expect(
      await verifyM9b3MaterializedSchedule(
        input,
        preparation,
        populations.probe,
        populations.primary,
        seedReveal,
        schedule,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await materializeM9b3Schedule(
        input,
        preparation,
        populations.probe,
        populations.primary,
        "e".repeat(64),
      ),
    ).toMatchObject({ ok: false });
    const { scheduleDigest: _digest, ...body } = schedule;
    void _digest;
    const first = required(body.primaryEntries[0]);
    const changed = {
      ...body,
      primaryEntries: [
        { ...first, firstArm: first.secondArm, secondArm: first.firstArm },
        ...body.primaryEntries.slice(1),
      ],
    };
    expect(
      await verifyM9b3MaterializedSchedule(
        input,
        preparation,
        populations.probe,
        populations.primary,
        seedReveal,
        {
          ...changed,
          scheduleDigest: unwrap(await digestValue(changed)),
        },
      ),
    ).toMatchObject({ ok: false });
    const reordered = {
      ...body,
      primaryEntries: [
        required(body.primaryEntries[1]),
        required(body.primaryEntries[0]),
        ...body.primaryEntries.slice(2),
      ],
    };
    expect(
      await verifyM9b3MaterializedSchedule(
        input,
        preparation,
        populations.probe,
        populations.primary,
        seedReveal,
        {
          ...reordered,
          scheduleDigest: unwrap(await digestValue(reordered)),
        },
      ),
    ).toMatchObject({ ok: false });
  }, 10_000);

  it("preserves probe and scheduling invariants over generated inputs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .tuple(
            fc.integer({ min: 0, max: 24 }),
            fc.integer({ min: 0, max: 24 }),
            fc.integer({ min: 0, max: 24 }),
          )
          .filter(([first, second, third]) => first + second + third <= 24),
        async ([discoveredOnly, staticOnly, bothSucceeded]) => {
          const input = {
            discoveredOnly,
            staticOnly,
            bothSucceeded,
            bothFailed: 24 - discoveredOnly - staticOnly - bothSucceeded,
          };
          const decision = unwrap(await evaluateM9b3ProbeAdvancement(input));
          expect(
            await verifyM9b3ProbeAdvancement(input, decision),
          ).toMatchObject({ ok: true });
          expect(decision.discordantPairs).toBe(discoveredOnly + staticOnly);
        },
      ),
      { numRuns: 40 },
    );

    const populations = await preparedPopulations();
    await fc.assert(
      fc.asyncProperty(
        fc
          .array(fc.integer({ min: 0, max: 15 }), {
            minLength: 64,
            maxLength: 64,
          })
          .map((digits) => digits.map((digit) => digit.toString(16)).join("")),
        async (seedReveal) => {
          const input = {
            ...preparationInput(),
            scheduleSeedCommitment: unwrap(
              await deriveM9b3ScheduleSeedCommitment(seedReveal),
            ),
          };
          const preparation = unwrap(await prepareM9b3OfflineStudy(input));
          const schedule = unwrap(
            await materializeM9b3Schedule(
              input,
              preparation,
              populations.probe,
              populations.primary,
              seedReveal,
            ),
          );
          expect(
            new Set(schedule.primaryEntries.map((entry) => entry.caseId)).size,
          ).toBe(168);
          expect(
            schedule.primaryEntries.map((entry) => entry.executionOrdinal),
          ).toEqual(Array.from({ length: 168 }, (_value, index) => index));
        },
      ),
      { numRuns: 5 },
    );
  }, 10_000);

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
