import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { digestValue, type Result } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import {
  benchmarkCaseRecordSchema,
  type BenchmarkMethod,
  type BenchmarkSplit,
  calculateCostUsdMicros,
  calculateMaximumCostUsdMicros,
  createExperimentManifest,
  createInMemoryBenchmarkStore,
  createM1aCatalogResolver,
  createPricingSnapshot,
  createRecordedModelAdapter,
  DEFAULT_INFERENCE_SETTINGS,
  evaluateResearchGates,
  type ExperimentCaps,
  type ExperimentManifest,
  freezePlanGenerationCase,
  freezeRecordedModelFixture,
  type FrozenPlanGenerationCase,
  type FrozenRecordedModelFixture,
  generatePlan,
  generationRecordSchema,
  type GenerationSession,
  type GenerationStrategy,
  loadM1aCorpus,
  loadM1aRecordedFixtures,
  M1A_GENERATION_STRATEGIES,
  type ModelAdapter,
  partitionM1aCorpus,
  type PricingSnapshot,
  RECORDED_DOUBLE_PLAN,
  runBenchmark,
  scoreGeneration,
  summarizeBenchmark,
  verifyExperimentManifest,
  verifyPricingSnapshot,
} from "../src/index.js";
import { createJsonFileBenchmarkStore } from "../src/node-store.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function strategy(id: GenerationStrategy["id"]): GenerationStrategy {
  return required(
    M1A_GENERATION_STRATEGIES.find((item) => item.id === id),
    `Missing strategy ${id}.`,
  );
}

async function corpusCase(id: string): Promise<FrozenPlanGenerationCase> {
  const corpus = unwrap(await loadM1aCorpus());
  return required(
    corpus.find((item) => item.case.id === id),
    `Missing case ${id}.`,
  );
}

async function recordedFixture(
  index: number,
): Promise<FrozenRecordedModelFixture> {
  return required(
    unwrap(await loadM1aRecordedFixtures())[index],
    `Missing recorded fixture ${index}.`,
  );
}

async function pricingFor(
  methods: ReadonlyArray<BenchmarkMethod>,
): Promise<PricingSnapshot> {
  const entries = new Map(
    methods.map((method) => [
      method.adapter.pricingEntryId,
      {
        id: method.adapter.pricingEntryId,
        billingProvider: method.adapter.identity.provider,
        route: "recorded",
        model: "recorded-fixture",
        inputUsdMicrosPerMillionTokens: 1_000_000,
        cachedInputUsdMicrosPerMillionTokens: 1_000_000,
        cacheWriteInputUsdMicrosPerMillionTokens: 1_000_000,
        outputUsdMicrosPerMillionTokens: 1_000_000,
        effectiveFrom: "2026-01-01",
        effectiveUntil: null,
        sourceUrl: "https://example.invalid/recorded-pricing",
      },
    ]),
  );
  return unwrap(
    await createPricingSnapshot({
      capturedAt: "2026-07-15T00:00:00Z",
      entries: [...entries.values()],
    }),
  );
}

async function experimentFor(
  cases: ReadonlyArray<FrozenPlanGenerationCase>,
  methods: ReadonlyArray<BenchmarkMethod>,
  repetitions = 1,
  split: BenchmarkSplit = "heldout-phrasing",
  protocolIdentity = "test",
  caps: ExperimentCaps = {
    maxCalls: 100,
    maxInputTokens: 100_000,
    maxOutputTokens: 100_000,
    maxTotalTokens: 200_000,
    maxOutputTokensPerCall: 100_000,
    maxCostUsdMicros: 1_000_000,
    providerCostCaps: [
      { billingProvider: "recorded", maxCostUsdMicros: 1_000_000 },
    ],
  },
): Promise<ExperimentManifest> {
  return unwrap(
    await createExperimentManifest({
      prompt: `${protocolIdentity}-prompt`,
      protocol: { id: protocolIdentity, version: "1" },
      cases: cases.map((frozenCase) => ({ frozenCase, split })),
      methods: methods.map((method) => ({
        id: method.id,
        model: method.adapter.identity,
        strategy: method.strategy,
        inference: method.adapter.inference,
        pricingEntryId: method.adapter.pricingEntryId,
      })),
      pricingSnapshot: await pricingFor(methods),
      repetitions,
      caps,
      versions: {
        gitCommit: "test-commit",
        workspaceVersion: "0.1.0",
        kernelVersion: "0.1.0",
        generatorVersion: "0.1.0",
      },
    }),
  );
}

async function sessionFor(
  caseId: string,
  plan: unknown,
  model: string,
): Promise<
  Readonly<{
    benchmarkCase: FrozenPlanGenerationCase;
    session: GenerationSession;
  }>
> {
  const benchmarkCase = await corpusCase(caseId);
  const fixture = unwrap(
    await freezeRecordedModelFixture({
      identity: { provider: "recorded", model, adapterVersion: "1" },
      responses: [
        {
          kind: "response",
          response: {
            structuredOutput: { kind: "plan", plan },
            rawResponse: JSON.stringify({ kind: "plan", plan }),
            usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
            latencyMs: 1,
          },
        },
      ],
    }),
  );
  const session = unwrap(
    await generatePlan({
      task: benchmarkCase.case.instruction,
      taskInputs: benchmarkCase.case.taskInputs,
      catalog: unwrap(
        unwrap(createM1aCatalogResolver())(benchmarkCase.case.catalogId),
      ),
      policy: benchmarkCase.case.policy,
      publicExamples: [],
      adapter: createRecordedModelAdapter(fixture),
      strategy: strategy("json-schema"),
    }),
  );
  return { benchmarkCase, session };
}

describe("M1a frozen substrate", () => {
  it("content-addresses immutable pricing and prices cache usage exactly", async () => {
    const method: BenchmarkMethod = {
      id: "schema",
      adapter: createRecordedModelAdapter(await recordedFixture(0)),
      strategy: strategy("json-schema"),
    };
    const first = await pricingFor([method]);
    const second = await pricingFor([method]);
    const entry = required(first.entries[0], "Missing recorded pricing entry.");

    expect(first.digest).toBe(second.digest);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.entries)).toBe(true);
    expect(
      unwrap(
        calculateCostUsdMicros(entry, {
          inputTokens: 10,
          cachedInputTokens: 2,
          cacheWriteInputTokens: 3,
          outputTokens: 4,
        }),
      ),
    ).toBe(14);
    expect(unwrap(calculateMaximumCostUsdMicros(entry, 10, 4))).toBe(14);
    expect(
      calculateCostUsdMicros(entry, {
        inputTokens: 10,
        cachedInputTokens: 8,
        cacheWriteInputTokens: 3,
        outputTokens: 4,
      }).ok,
    ).toBe(false);
    expect((await verifyPricingSnapshot(first)).ok).toBe(true);
    expect(
      (
        await verifyPricingSnapshot({
          ...first,
          entries: [
            {
              ...entry,
              outputUsdMicrosPerMillionTokens:
                entry.outputUsdMicrosPerMillionTokens + 1,
            },
          ],
        })
      ).ok,
    ).toBe(false);
    expect((await verifyPricingSnapshot({ formatVersion: "1" })).ok).toBe(
      false,
    );
    expect(
      (
        await verifyPricingSnapshot({
          ...first,
          entries: [entry, entry],
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await createPricingSnapshot({
          capturedAt: "not-a-timestamp",
          entries: [entry],
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await createPricingSnapshot({
          capturedAt: first.capturedAt,
          entries: [entry, entry],
        })
      ).ok,
    ).toBe(false);
    expect(
      calculateCostUsdMicros(
        {
          ...entry,
          inputUsdMicrosPerMillionTokens: Number.MAX_SAFE_INTEGER,
          outputUsdMicrosPerMillionTokens: Number.MAX_SAFE_INTEGER,
        },
        {
          inputTokens: Number.MAX_SAFE_INTEGER,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: Number.MAX_SAFE_INTEGER,
        },
      ).ok,
    ).toBe(false);

    const repriced = unwrap(
      await createPricingSnapshot({
        capturedAt: first.capturedAt,
        entries: [
          {
            ...entry,
            outputUsdMicrosPerMillionTokens:
              entry.outputUsdMicrosPerMillionTokens + 1,
          },
        ],
      }),
    );
    expect(repriced.digest).not.toBe(first.digest);
  });

  it("loads 42 content-addressed cases across unrelated catalogs", async () => {
    const first = unwrap(await loadM1aCorpus());
    const second = unwrap(await loadM1aCorpus());

    expect(first).toHaveLength(42);
    expect(new Set(first.map((item) => item.case.catalogId)).size).toBe(4);
    expect(first.map((item) => item.digest)).toEqual(
      second.map((item) => item.digest),
    );
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0]?.case.hiddenEvaluations)).toBe(true);
    expect(
      first.filter((item) => item.case.expectedFeasibility === "unplannable"),
    ).toHaveLength(10);
    const partition = partitionM1aCorpus(first);
    expect(partition.heldOutCatalogs.length).toBeGreaterThan(0);
    expect(partition.heldOutOperatorCombinations.length).toBeGreaterThan(0);
    expect(partition.heldOutPhrasings.length).toBeGreaterThan(0);
    expect(
      partition.development.some(
        (item) => item.case.catalogId === "benchmark.workflow",
      ),
    ).toBe(false);
    const expectedInputNames = new Map([
      ["benchmark.numbers", ["items"]],
      ["benchmark.text", ["items"]],
      ["benchmark.decisions", ["condition", "primary", "fallback"]],
      ["benchmark.workflow", ["state"]],
    ]);
    const collectionCatalogs = new Set(["benchmark.numbers", "benchmark.text"]);
    for (const item of first) {
      const names = item.case.taskInputs.map((taskInput) => taskInput.name);
      expect(names).toEqual(expectedInputNames.get(item.case.catalogId));
      for (const taskInput of item.case.taskInputs) {
        expect(taskInput.declaredBounds).toEqual(
          collectionCatalogs.has(item.case.catalogId)
            ? [{ kind: "maximumCollectionItems", value: 128 }]
            : [],
        );
        expect(Object.keys(taskInput).toSorted()).toEqual([
          "declaredBounds",
          "name",
          "schema",
        ]);
      }
    }
  });

  it("rejects malformed cases and freezes complete recorded fixtures", async () => {
    const invalid = await freezePlanGenerationCase({ id: "incomplete" });
    expect(invalid.ok).toBe(false);

    const fixture = await recordedFixture(0);
    expect(Object.isFrozen(fixture.fixture)).toBe(true);
    expect(Object.isFrozen(fixture.fixture.responses)).toBe(true);
    const response = fixture.fixture.responses[0];
    if (response?.kind !== "response") throw new Error("Expected response.");
    expect(Object.isFrozen(response.response.structuredOutput)).toBe(true);

    const malformedFixture = await freezeRecordedModelFixture({
      identity: {},
      responses: [],
    });
    expect(malformedFixture.ok).toBe(false);
  });

  it("resolves only the frozen corpus catalogs", () => {
    const resolver = unwrap(createM1aCatalogResolver());
    expect(resolver("benchmark.numbers").ok).toBe(true);
    const missing = resolver("benchmark.missing");
    expect(missing.ok).toBe(false);
    expect(missing.ok ? undefined : missing.error.code).toBe(
      "CATALOG_REFERENCE_MISMATCH",
    );
  });

  it("freezes and verifies content-addressed experiment identity", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const methods: ReadonlyArray<BenchmarkMethod> = [
      {
        id: "schema",
        adapter: createRecordedModelAdapter(await recordedFixture(0)),
        strategy: strategy("json-schema"),
      },
    ];
    const first = await experimentFor([benchmarkCase], methods);
    const second = await experimentFor([benchmarkCase], methods);
    expect(first.experimentDigest).toBe(second.experimentDigest);
    expect(first.caseSetDigest).toBe(second.caseSetDigest);
    expect(first.splits).toHaveLength(4);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.methods[0]?.inference)).toBe(true);
    expect((await verifyExperimentManifest(first)).ok).toBe(true);
    const legacyMethods = [];
    for (const method of first.methods) {
      const modelConfigurationDigest = unwrap(
        await digestValue({
          model: method.model,
          temperature: method.inference.temperature,
          seed: method.inference.seed,
          reasoningSettings: method.inference.reasoningSettings,
          maxInputTokens: method.inference.maxInputTokens,
          maxOutputTokens: method.inference.maxOutputTokens,
        }),
      );
      legacyMethods.push({ ...method, modelConfigurationDigest });
    }
    const legacyBody = {
      ...first,
      formatVersion: "2",
      methods: legacyMethods,
    };
    const { experimentDigest: currentDigest, ...legacyWithoutDigest } =
      legacyBody;
    expect(currentDigest).toBe(first.experimentDigest);
    const legacyDigest = unwrap(await digestValue(legacyWithoutDigest));
    expect(
      (
        await verifyExperimentManifest({
          ...legacyWithoutDigest,
          experimentDigest: legacyDigest,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await verifyExperimentManifest({
          ...first,
          promptDigest: "tampered",
        })
      ).ok,
    ).toBe(false);
    const { experimentDigest, ...manifestBody } = first;
    expect(experimentDigest).toBe(first.experimentDigest);
    const incompatibleMethodBody = {
      ...manifestBody,
      methods: manifestBody.methods.map((method, index) =>
        index === 0
          ? {
              ...method,
              inference: {
                ...method.inference,
                structuredOutputMode: "none",
              },
            }
          : method,
      ),
    };
    const incompatibleMethodDigest = unwrap(
      await digestValue(incompatibleMethodBody),
    );
    expect(
      (
        await verifyExperimentManifest({
          ...incompatibleMethodBody,
          experimentDigest: incompatibleMethodDigest,
        })
      ).ok,
    ).toBe(false);
    const extraSplitBody = {
      ...manifestBody,
      splits: [...manifestBody.splits, ...manifestBody.splits.slice(0, 1)],
    };
    const extraSplitDigest = unwrap(await digestValue(extraSplitBody));
    expect(
      (
        await verifyExperimentManifest({
          ...extraSplitBody,
          experimentDigest: extraSplitDigest,
        })
      ).ok,
    ).toBe(false);
    const inconsistentMethodDigestBody = {
      ...manifestBody,
      methods: manifestBody.methods.map((method, index) =>
        index === 0
          ? { ...method, modelConfigurationDigest: "inconsistent" }
          : method,
      ),
    };
    const inconsistentMethodDigest = unwrap(
      await digestValue(inconsistentMethodDigestBody),
    );
    expect(
      (
        await verifyExperimentManifest({
          ...inconsistentMethodDigestBody,
          experimentDigest: inconsistentMethodDigest,
        })
      ).ok,
    ).toBe(false);
    const inconsistentCaseBody = {
      ...manifestBody,
      caseSetDigest: "inconsistent",
    };
    const inconsistentCaseDigest = unwrap(
      await digestValue(inconsistentCaseBody),
    );
    expect(
      (
        await verifyExperimentManifest({
          ...inconsistentCaseBody,
          experimentDigest: inconsistentCaseDigest,
        })
      ).ok,
    ).toBe(false);
    const inconsistentSplitBody = {
      ...manifestBody,
      splits: manifestBody.splits.map((split, index) =>
        index === 0 ? { ...split, caseDigests: ["inconsistent"] } : split,
      ),
    };
    const inconsistentSplitDigest = unwrap(
      await digestValue(inconsistentSplitBody),
    );
    expect(
      (
        await verifyExperimentManifest({
          ...inconsistentSplitBody,
          experimentDigest: inconsistentSplitDigest,
        })
      ).ok,
    ).toBe(false);

    const invalidMode = await createExperimentManifest({
      prompt: "prompt",
      protocol: "protocol",
      cases: [{ frozenCase: benchmarkCase, split: "development" }],
      methods: [
        {
          id: "invalid-mode",
          model: methods[0]?.adapter.identity ?? {
            provider: "recorded",
            model: "missing",
            adapterVersion: "1",
          },
          strategy: strategy("unconstrained-json"),
          inference: {
            temperature: 0,
            seed: null,
            reasoningSettings: {},
            maxInputTokens: 100,
            maxOutputTokens: 100,
            structuredOutputMode: "json-schema",
          },
          pricingEntryId: methods[0]?.adapter.pricingEntryId ?? "recorded/free",
        },
      ],
      pricingSnapshot: await pricingFor(methods),
      repetitions: 1,
      caps: {
        maxCalls: 1,
        maxInputTokens: 1,
        maxOutputTokens: 1,
        maxTotalTokens: 1,
        maxOutputTokensPerCall: 100,
        maxCostUsdMicros: 1,
        providerCostCaps: [
          { billingProvider: "recorded", maxCostUsdMicros: 1 },
        ],
      },
      versions: {
        gitCommit: "test",
        workspaceVersion: "test",
        kernelVersion: "test",
        generatorVersion: "test",
      },
    });
    expect(invalidMode.ok).toBe(false);
  });

  it("rejects duplicate and unpriced experiment identities", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const method: BenchmarkMethod = {
      id: "schema",
      adapter: createRecordedModelAdapter(await recordedFixture(0)),
      strategy: strategy("json-schema"),
    };
    const pricingSnapshot = await pricingFor([method]);
    const methodInput = {
      id: method.id,
      model: method.adapter.identity,
      strategy: method.strategy,
      inference: method.adapter.inference,
      pricingEntryId: method.adapter.pricingEntryId,
    };
    const common = {
      prompt: "prompt",
      protocol: "protocol",
      pricingSnapshot,
      repetitions: 1,
      caps: {
        maxCalls: 2,
        maxInputTokens: 100_000,
        maxOutputTokens: 100_000,
        maxTotalTokens: 200_000,
        maxOutputTokensPerCall: 100_000,
        maxCostUsdMicros: 1_000_000,
        providerCostCaps: [
          { billingProvider: "recorded", maxCostUsdMicros: 1_000_000 },
        ],
      },
      versions: {
        gitCommit: "test",
        workspaceVersion: "test",
        kernelVersion: "test",
        generatorVersion: "test",
      },
    };

    const duplicateCase = await createExperimentManifest({
      ...common,
      cases: [
        { frozenCase: benchmarkCase, split: "development" },
        { frozenCase: benchmarkCase, split: "heldout-phrasing" },
      ],
      methods: [methodInput],
    });
    expect(duplicateCase.ok).toBe(false);

    const duplicateMethod = await createExperimentManifest({
      ...common,
      cases: [{ frozenCase: benchmarkCase, split: "development" }],
      methods: [methodInput, methodInput],
    });
    expect(duplicateMethod.ok).toBe(false);

    const duplicateProviderCap = await createExperimentManifest({
      ...common,
      cases: [{ frozenCase: benchmarkCase, split: "development" }],
      methods: [methodInput],
      caps: {
        ...common.caps,
        providerCostCaps: [
          ...common.caps.providerCostCaps,
          ...common.caps.providerCostCaps,
        ],
      },
    });
    expect(duplicateProviderCap.ok).toBe(false);

    const unpricedMethod = await createExperimentManifest({
      ...common,
      cases: [{ frozenCase: benchmarkCase, split: "development" }],
      methods: [{ ...methodInput, pricingEntryId: "recorded/missing" }],
    });
    expect(unpricedMethod.ok).toBe(false);
  });
});

describe("generate, compile, and bounded repair", () => {
  it("compiles a recorded plan and writes a canonical generation record", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const catalog = unwrap(
      unwrap(createM1aCatalogResolver())(benchmarkCase.case.catalogId),
    );
    const session = unwrap(
      await generatePlan({
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog,
        policy: benchmarkCase.case.policy,
        publicExamples: [],
        adapter: createRecordedModelAdapter(await recordedFixture(0)),
        strategy: strategy("json-schema"),
      }),
    );

    expect(session.kind).toBe("compiled");
    expect(session.record.attempts).toHaveLength(1);
    expect(session.record.attempts[0]?.compiled).toBe(true);
    expect(session.record.totalInputTokens).toBe(120);
    expect(session.record.planHash).not.toBeNull();
    expect(Object.isFrozen(session.record)).toBe(true);
    expect(Object.isFrozen(session.record.attempts[0])).toBe(true);
    expect(Object.isFrozen(session.manifest)).toBe(true);
    expect(Object.isFrozen(session.manifest.policy.budget)).toBe(true);
    expect(generationRecordSchema.safeParse(session.record).success).toBe(true);
  });

  it("repairs from structured diagnostics without hidden evaluation data", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const resolver = unwrap(createM1aCatalogResolver());
    const adapter = createRecordedModelAdapter(await recordedFixture(1));
    const session = unwrap(
      await generatePlan({
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog: unwrap(resolver(benchmarkCase.case.catalogId)),
        policy: benchmarkCase.case.policy,
        publicExamples: [],
        adapter,
        strategy: strategy("json-schema-with-repair"),
      }),
    );

    expect(session.kind).toBe("compiled");
    expect(session.record.repairCount).toBe(1);
    expect(session.record.attempts[0]?.diagnostics[0]?.code).toBe(
      "INVALID_WIRE_SCHEMA",
    );
    const repair = required(adapter.requests()[1], "Missing repair request.");
    const initial = required(adapter.requests()[0], "Missing initial request.");
    expect(initial.taskInputs).toEqual(benchmarkCase.case.taskInputs);
    expect(repair.taskInputs).toEqual(benchmarkCase.case.taskInputs);
    expect(Object.keys(repair).toSorted()).toEqual([
      "diagnostics",
      "kind",
      "languageManifest",
      "originalTask",
      "previousProposal",
      "taskInputs",
    ]);
    expect("hiddenEvaluations" in repair).toBe(false);
    expect("executionResults" in repair).toBe(false);
    expect("publicExamples" in repair).toBe(false);
  });

  it("stops after exactly two repair attempts", async () => {
    const invalidResponse = {
      kind: "response",
      response: {
        structuredOutput: { kind: "plan", plan: { formatVersion: "1" } },
        rawResponse: '{"kind":"plan","plan":{"formatVersion":"1"}}',
        usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
        latencyMs: 1,
      },
    };
    const frozen = unwrap(
      await freezeRecordedModelFixture({
        identity: {
          provider: "recorded",
          model: "always-invalid",
          adapterVersion: "1",
        },
        responses: [invalidResponse, invalidResponse, invalidResponse],
      }),
    );
    const adapter = createRecordedModelAdapter(frozen);
    const benchmarkCase = await corpusCase("numbers/double");
    const session = unwrap(
      await generatePlan({
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog: unwrap(
          unwrap(createM1aCatalogResolver())(benchmarkCase.case.catalogId),
        ),
        policy: benchmarkCase.case.policy,
        publicExamples: [],
        adapter,
        strategy: strategy("json-schema-with-repair"),
      }),
    );

    expect(session.kind).toBe("rejected");
    expect(session.record.attempts).toHaveLength(3);
    expect(session.record.repairCount).toBe(2);
    expect(adapter.requests()).toHaveLength(3);
  });

  it("records correct abstention and adapter exhaustion", async () => {
    const impossible = await corpusCase("numbers/forbidden-tax");
    const resolver = unwrap(createM1aCatalogResolver());
    const abstained = unwrap(
      await generatePlan({
        task: impossible.case.instruction,
        taskInputs: impossible.case.taskInputs,
        catalog: unwrap(resolver(impossible.case.catalogId)),
        policy: impossible.case.policy,
        publicExamples: [],
        adapter: createRecordedModelAdapter(await recordedFixture(2)),
        strategy: strategy("json-schema-with-repair"),
      }),
    );
    expect(abstained.kind).toBe("unplannable");
    expect(abstained.record.attempts[0]?.abstentionReasons).toHaveLength(1);

    const exhausted = createRecordedModelAdapter(await recordedFixture(2));
    await exhausted.generate({
      kind: "initial",
      originalTask: "first",
      taskInputs: impossible.case.taskInputs,
      languageManifest: abstained.manifest,
      publicExamples: [],
      constraint: "json-schema",
    });
    const failure = await exhausted.generate({
      kind: "initial",
      originalTask: "second",
      taskInputs: impossible.case.taskInputs,
      languageManifest: abstained.manifest,
      publicExamples: [],
      constraint: "json-schema",
    });
    expect(failure.ok).toBe(false);
    expect(failure.ok ? undefined : failure.error.code).toBe(
      "RECORDED_RESPONSE_MISSING",
    );
  });

  it("records provider failures and non-JSON proposals as rejected attempts", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const catalog = unwrap(
      unwrap(createM1aCatalogResolver())(benchmarkCase.case.catalogId),
    );
    const failureFixture = unwrap(
      await freezeRecordedModelFixture({
        identity: {
          provider: "recorded",
          model: "provider-failure",
          adapterVersion: "1",
        },
        responses: [
          {
            kind: "failure",
            failure: { code: "PROVIDER_FAILURE", message: "offline" },
          },
        ],
      }),
    );
    const failed = unwrap(
      await generatePlan({
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog,
        policy: benchmarkCase.case.policy,
        publicExamples: [],
        adapter: createRecordedModelAdapter(failureFixture),
        strategy: strategy("json-schema"),
      }),
    );
    expect(failed.kind).toBe("adapterFailure");
    expect(failed.record.attempts[0]?.adapterFailure?.code).toBe(
      "PROVIDER_FAILURE",
    );

    const nonJsonAdapter: ModelAdapter = {
      identity: {
        provider: "recorded",
        model: "non-json",
        adapterVersion: "1",
      },
      inference: DEFAULT_INFERENCE_SETTINGS,
      pricingEntryId: "recorded/free",
      generate: () =>
        Promise.resolve({
          ok: true,
          value: {
            structuredOutput: { kind: "plan", plan: 1n },
            rawResponse: "1n",
            usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
            latencyMs: 1,
            dispatchEvidence: "dispatched-with-usage",
          },
        }),
    };
    const rejected = unwrap(
      await generatePlan({
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog,
        policy: benchmarkCase.case.policy,
        publicExamples: [],
        adapter: nonJsonAdapter,
        strategy: strategy("json-schema"),
      }),
    );
    expect(rejected.kind).toBe("rejected");
    expect(rejected.record.attempts[0]?.parseSuccess).toBe(false);
    expect(rejected.record.attempts[0]?.responseKind).toBe("invalidOutput");
    expect(rejected.record.attempts[0]?.adapterFailure).toBeNull();
  });

  it("centrally parses unconstrained output and validates structured output", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const catalog = unwrap(
      unwrap(createM1aCatalogResolver())(benchmarkCase.case.catalogId),
    );
    async function runResponse(
      rawResponse: string,
      structuredOutput: unknown,
      generationStrategy: GenerationStrategy,
    ): Promise<GenerationSession> {
      const frozen = unwrap(
        await freezeRecordedModelFixture({
          identity: {
            provider: "recorded",
            model: `central-${generationStrategy.id}`,
            adapterVersion: "1",
          },
          responses: [
            {
              kind: "response",
              response: {
                rawResponse,
                structuredOutput,
                usage: {
                  inputTokens: 1,
                  outputTokens: 1,
                  costUsdMicros: 1,
                },
                latencyMs: 1,
              },
            },
          ],
        }),
      );
      return unwrap(
        await generatePlan({
          task: benchmarkCase.case.instruction,
          taskInputs: benchmarkCase.case.taskInputs,
          catalog,
          policy: benchmarkCase.case.policy,
          publicExamples: [],
          adapter: createRecordedModelAdapter(frozen),
          strategy: generationStrategy,
        }),
      );
    }

    const planOutcome = { kind: "plan", plan: RECORDED_DOUBLE_PLAN };
    const constrained = await runResponse(
      "{",
      planOutcome,
      strategy("json-schema"),
    );
    expect(constrained.kind).toBe("compiled");

    const invalidRaw = await runResponse(
      "{",
      planOutcome,
      strategy("unconstrained-json"),
    );
    expect(invalidRaw.kind).toBe("rejected");
    expect(invalidRaw.record.attempts[0]?.diagnostics[0]?.code).toBe(
      "MALFORMED_JSON",
    );

    const unconstrained = await runResponse(
      JSON.stringify(planOutcome),
      { providerSpecific: "ignored" },
      strategy("unconstrained-json"),
    );
    expect(unconstrained.kind).toBe("compiled");

    const repairedFixture = unwrap(
      await freezeRecordedModelFixture({
        identity: {
          provider: "recorded",
          model: "invalid-output-repair",
          adapterVersion: "1",
        },
        responses: [
          {
            kind: "response",
            response: {
              rawResponse: '{"provider":"invalid"}',
              structuredOutput: { provider: "invalid" },
              usage: {
                inputTokens: 1,
                outputTokens: 1,
                costUsdMicros: 1,
              },
              latencyMs: 1,
            },
          },
          {
            kind: "response",
            response: {
              rawResponse: JSON.stringify(planOutcome),
              structuredOutput: planOutcome,
              usage: {
                inputTokens: 1,
                outputTokens: 1,
                costUsdMicros: 1,
              },
              latencyMs: 1,
            },
          },
        ],
      }),
    );
    const repairedAdapter = createRecordedModelAdapter(repairedFixture);
    const repaired = unwrap(
      await generatePlan({
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog,
        policy: benchmarkCase.case.policy,
        publicExamples: [],
        adapter: repairedAdapter,
        strategy: strategy("json-schema-with-repair"),
      }),
    );
    expect(repaired.kind).toBe("compiled");
    expect(repaired.record.attempts[0]?.responseKind).toBe("invalidOutput");
    expect(repaired.record.attempts[0]?.diagnostics[0]?.code).toBe(
      "INVALID_WIRE_SCHEMA",
    );
    expect(repairedAdapter.requests()[1]?.kind).toBe("repair");
  });
});

describe("behavioral benchmark runner", () => {
  it("scores hidden inputs and resumes by content identity", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const fixture = await recordedFixture(0);
    const store = createInMemoryBenchmarkStore();
    const firstMethods: ReadonlyArray<BenchmarkMethod> = [
      {
        id: "schema",
        adapter: createRecordedModelAdapter(fixture),
        strategy: strategy("json-schema"),
      },
    ];
    const experiment = await experimentFor([benchmarkCase], firstMethods);
    const first = unwrap(
      await runBenchmark({
        experiment,
        cases: [benchmarkCase],
        methods: firstMethods,
        resolveCatalog: unwrap(createM1aCatalogResolver()),
        store,
      }),
    );

    expect(first.generated).toBe(1);
    expect(first.records[0]?.score.semanticSuccess).toBe(true);
    expect(first.records[0]?.score.hiddenEvaluations).toHaveLength(2);
    expect(first.records[0]?.score.executionAttempted).toBe(true);

    const second = unwrap(
      await runBenchmark({
        experiment,
        cases: [benchmarkCase],
        methods: [
          {
            id: "schema",
            adapter: createRecordedModelAdapter(fixture),
            strategy: strategy("json-schema"),
          },
        ],
        resolveCatalog: unwrap(createM1aCatalogResolver()),
        store,
      }),
    );
    expect(second.generated).toBe(0);
    expect(second.resumed).toBe(1);
    expect(second.records).toEqual(first.records);

    const changedMethods: ReadonlyArray<BenchmarkMethod> = [
      {
        id: "schema",
        adapter: createRecordedModelAdapter(fixture),
        strategy: strategy("json-schema"),
      },
    ];
    const changed = unwrap(
      await runBenchmark({
        experiment: await experimentFor(
          [benchmarkCase],
          changedMethods,
          1,
          "heldout-phrasing",
          "changed",
        ),
        cases: [benchmarkCase],
        methods: changedMethods,
        resolveCatalog: unwrap(createM1aCatalogResolver()),
        store,
      }),
    );
    expect(changed.generated).toBe(1);
    expect(changed.records[0]?.key).not.toBe(first.records[0]?.key);
  });

  it("rejects constant-answer plans behaviorally across hidden cases", async () => {
    const constantPlan = {
      ...RECORDED_DOUBLE_PLAN,
      root: "answer",
      nodes: [
        {
          id: "answer",
          op: "constant",
          schema: { id: "numbers", version: "1.0.0" },
          value: [2, 4],
        },
      ],
    };
    const frozen = unwrap(
      await freezeRecordedModelFixture({
        identity: {
          provider: "recorded",
          model: "constant-answer",
          adapterVersion: "1",
        },
        responses: [
          {
            kind: "response",
            response: {
              structuredOutput: { kind: "plan", plan: constantPlan },
              rawResponse: JSON.stringify({ kind: "plan", plan: constantPlan }),
              usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
              latencyMs: 1,
            },
          },
        ],
      }),
    );
    const benchmarkCase = await corpusCase("numbers/double");
    const session = unwrap(
      await generatePlan({
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog: unwrap(
          unwrap(createM1aCatalogResolver())(benchmarkCase.case.catalogId),
        ),
        policy: benchmarkCase.case.policy,
        publicExamples: [],
        adapter: createRecordedModelAdapter(frozen),
        strategy: strategy("json-schema"),
      }),
    );
    const score = unwrap(await scoreGeneration(benchmarkCase.case, session));
    expect(score.semanticSuccess).toBe(false);
    expect(score.hiddenEvaluations.map((item) => item.success)).toEqual([
      true,
      false,
    ]);
    expect(score.propertiesSatisfied).toBe(false);
  });

  it("enforces experiment call and monetary caps", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const repairMethods: ReadonlyArray<BenchmarkMethod> = [
      {
        id: "repair",
        adapter: createRecordedModelAdapter(await recordedFixture(1)),
        strategy: strategy("json-schema-with-repair"),
      },
    ];
    const callLimited = await runBenchmark({
      experiment: await experimentFor(
        [benchmarkCase],
        repairMethods,
        1,
        "heldout-phrasing",
        "call-cap",
        {
          maxCalls: 1,
          maxInputTokens: 100_000,
          maxOutputTokens: 100_000,
          maxTotalTokens: 200_000,
          maxOutputTokensPerCall: 100_000,
          maxCostUsdMicros: 1_000_000,
          providerCostCaps: [
            { billingProvider: "recorded", maxCostUsdMicros: 1_000_000 },
          ],
        },
      ),
      cases: [benchmarkCase],
      methods: repairMethods,
      resolveCatalog: unwrap(createM1aCatalogResolver()),
      store: createInMemoryBenchmarkStore(),
    });
    expect(callLimited.ok).toBe(false);
    expect(callLimited.ok ? undefined : callLimited.error.code).toBe(
      "BUDGET_EXCEEDED",
    );

    const directAdapter = createRecordedModelAdapter(await recordedFixture(0));
    const directMethods: ReadonlyArray<BenchmarkMethod> = [
      {
        id: "schema",
        adapter: directAdapter,
        strategy: strategy("json-schema"),
      },
    ];
    const costLimited = await runBenchmark({
      experiment: await experimentFor(
        [benchmarkCase],
        directMethods,
        1,
        "heldout-phrasing",
        "cost-cap",
        {
          maxCalls: 2,
          maxInputTokens: 100_000,
          maxOutputTokens: 100_000,
          maxTotalTokens: 200_000,
          maxOutputTokensPerCall: 100_000,
          maxCostUsdMicros: 100,
          providerCostCaps: [
            { billingProvider: "recorded", maxCostUsdMicros: 100 },
          ],
        },
      ),
      cases: [benchmarkCase],
      methods: directMethods,
      resolveCatalog: unwrap(createM1aCatalogResolver()),
      store: createInMemoryBenchmarkStore(),
    });
    expect(costLimited.ok).toBe(false);
    expect(costLimited.ok ? undefined : costLimited.error.code).toBe(
      "BUDGET_EXCEEDED",
    );
    expect(directAdapter.requests()).toHaveLength(0);

    const providerLimitedAdapter = createRecordedModelAdapter(
      await recordedFixture(0),
    );
    const providerLimitedMethods: ReadonlyArray<BenchmarkMethod> = [
      {
        id: "schema",
        adapter: providerLimitedAdapter,
        strategy: strategy("json-schema"),
      },
    ];
    const providerLimited = await runBenchmark({
      experiment: await experimentFor(
        [benchmarkCase],
        providerLimitedMethods,
        1,
        "heldout-phrasing",
        "provider-cost-cap",
        {
          maxCalls: 2,
          maxInputTokens: 100_000,
          maxOutputTokens: 100_000,
          maxTotalTokens: 200_000,
          maxOutputTokensPerCall: 100_000,
          maxCostUsdMicros: 1_000_000,
          providerCostCaps: [
            { billingProvider: "recorded", maxCostUsdMicros: 100 },
          ],
        },
      ),
      cases: [benchmarkCase],
      methods: providerLimitedMethods,
      resolveCatalog: unwrap(createM1aCatalogResolver()),
      store: createInMemoryBenchmarkStore(),
    });
    expect(providerLimited.ok).toBe(false);
    expect(providerLimited.ok ? undefined : providerLimited.error.code).toBe(
      "BUDGET_EXCEEDED",
    );
    expect(providerLimitedAdapter.requests()).toHaveLength(0);
  });

  it("retains worst-case reservation when provider usage is unavailable", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const fixture = unwrap(
      await freezeRecordedModelFixture({
        identity: {
          provider: "recorded",
          model: "transport-failure",
          adapterVersion: "1",
        },
        responses: [
          {
            kind: "failure",
            failure: {
              code: "PROVIDER_FAILURE",
              message: "Connection closed after request dispatch.",
            },
          },
        ],
      }),
    );
    const adapter = createRecordedModelAdapter(fixture);
    const methods: ReadonlyArray<BenchmarkMethod> = [
      { id: "schema", adapter, strategy: strategy("json-schema") },
    ];
    const run = unwrap(
      await runBenchmark({
        experiment: await experimentFor(
          [benchmarkCase],
          methods,
          1,
          "heldout-phrasing",
          "unknown-provider-usage",
          {
            maxCalls: 2,
            maxInputTokens: 20_000,
            maxOutputTokens: 5_000,
            maxTotalTokens: 25_000,
            maxOutputTokensPerCall: 2_000,
            maxCostUsdMicros: 20_000,
            providerCostCaps: [
              { billingProvider: "recorded", maxCostUsdMicros: 20_000 },
            ],
          },
        ),
        cases: [benchmarkCase],
        methods,
        resolveCatalog: unwrap(createM1aCatalogResolver()),
        store: createInMemoryBenchmarkStore(),
      }),
    );
    const record = required(run.records[0], "Missing failure record.");
    expect(record.generation.finalKind).toBe("adapterFailure");
    expect(record.generation.totalInputTokens).toBe(8_000);
    expect(record.generation.totalOutputTokens).toBe(2_000);
    expect(record.generation.totalCostUsdMicros).toBe(10_000);
    expect(adapter.requests()).toHaveLength(1);
  });

  it("executes effectful maps only through hidden deterministic fixtures", async () => {
    const benchmarkCase = await corpusCase("numbers/tax-map");
    const effectPlan = {
      ...RECORDED_DOUBLE_PLAN,
      root: "quoted",
      nodes: [
        {
          id: "source",
          op: "input",
          inputKey: "items",
          schema: { id: "numbers", version: "1.0.0" },
          maxItems: 2,
        },
        {
          id: "quoted",
          op: "map",
          source: "source",
          operation: {
            kind: "effect",
            id: "quote-tax",
            version: "1.0.0",
          },
          outputCollectionSchema: { id: "numbers", version: "1.0.0" },
          parallelism: 2,
        },
      ],
      budget: {
        maxEffectCalls: 2,
        maxCollectionItems: 32,
        maxRecursionDepth: 0,
        maxTokens: 24,
        maxWallClockMs: 40,
        maxParallelism: 2,
      },
      allowedCapabilities: ["finance.read"],
    };
    const fixture = unwrap(
      await freezeRecordedModelFixture({
        identity: {
          provider: "recorded",
          model: "effect-map",
          adapterVersion: "1",
        },
        responses: [
          {
            kind: "response",
            response: {
              structuredOutput: { kind: "plan", plan: effectPlan },
              rawResponse: JSON.stringify({ kind: "plan", plan: effectPlan }),
              usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
              latencyMs: 1,
            },
          },
        ],
      }),
    );
    const session = unwrap(
      await generatePlan({
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog: unwrap(
          unwrap(createM1aCatalogResolver())(benchmarkCase.case.catalogId),
        ),
        policy: benchmarkCase.case.policy,
        publicExamples: [],
        adapter: createRecordedModelAdapter(fixture),
        strategy: strategy("json-schema"),
      }),
    );
    const score = unwrap(await scoreGeneration(benchmarkCase.case, session));
    expect(score.semanticSuccess).toBe(true);
    expect(score.hiddenEvaluations.every((item) => item.success)).toBe(true);

    const newlyForbidden = unwrap(
      await freezePlanGenerationCase({
        ...benchmarkCase.case,
        expectedFeasibility: "unplannable",
        forbiddenCapabilities: ["finance.read"],
      }),
    );
    const forbiddenScore = unwrap(
      await scoreGeneration(newlyForbidden.case, session),
    );
    expect(forbiddenScore.executionAttempted).toBe(false);
    expect(forbiddenScore.capabilityViolation).toBe(true);
    expect(forbiddenScore.hiddenEvaluations).toEqual([]);
  });

  it("scores bounded fixed-point behavior and both recursion operations", async () => {
    const benchmarkCase = await corpusCase("workflow/countdown-3");
    const recursionPlan = {
      formatVersion: "1",
      catalog: { id: "benchmark.workflow", version: "1.0.0" },
      root: "done",
      nodes: [
        {
          id: "seed",
          op: "input",
          inputKey: "state",
          schema: { id: "workflow-state", version: "1.0.0" },
        },
        {
          id: "done",
          op: "boundedFix",
          seed: "seed",
          step: { id: "countdown-step", version: "1.0.0" },
          measure: { id: "remaining", version: "1.0.0" },
          maxIterations: 3,
        },
      ],
      budget: {
        maxEffectCalls: 0,
        maxCollectionItems: 1,
        maxRecursionDepth: 3,
        maxTokens: 0,
        maxWallClockMs: 0,
        maxParallelism: 1,
      },
      allowedCapabilities: [],
    };
    const fixture = unwrap(
      await freezeRecordedModelFixture({
        identity: {
          provider: "recorded",
          model: "bounded-fix",
          adapterVersion: "1",
        },
        responses: [
          {
            kind: "response",
            response: {
              structuredOutput: { kind: "plan", plan: recursionPlan },
              rawResponse: JSON.stringify({
                kind: "plan",
                plan: recursionPlan,
              }),
              usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
              latencyMs: 1,
            },
          },
        ],
      }),
    );
    const session = unwrap(
      await generatePlan({
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog: unwrap(
          unwrap(createM1aCatalogResolver())(benchmarkCase.case.catalogId),
        ),
        policy: benchmarkCase.case.policy,
        publicExamples: [],
        adapter: createRecordedModelAdapter(fixture),
        strategy: strategy("json-schema"),
      }),
    );
    const score = unwrap(await scoreGeneration(benchmarkCase.case, session));
    expect(score.propertiesSatisfied).toBe(true);
    expect(score.semanticSuccess).toBe(true);
  });

  it("scores filter/fold and select/invoke topologies", async () => {
    const budget = {
      maxEffectCalls: 0,
      maxCollectionItems: 8,
      maxRecursionDepth: 0,
      maxTokens: 0,
      maxWallClockMs: 0,
      maxParallelism: 1,
    };
    const filteredFold = await sessionFor(
      "numbers/positive-sum",
      {
        formatVersion: "1",
        catalog: { id: "benchmark.numbers", version: "1.0.0" },
        root: "sum",
        nodes: [
          {
            id: "source",
            op: "input",
            inputKey: "items",
            schema: { id: "numbers", version: "1.0.0" },
            maxItems: 8,
          },
          {
            id: "positive",
            op: "filter",
            source: "source",
            predicate: { id: "positive", version: "1.0.0" },
          },
          {
            id: "sum",
            op: "fold",
            source: "positive",
            reducer: { id: "sum", version: "1.0.0" },
          },
        ],
        budget,
        allowedCapabilities: [],
      },
      "filter-fold",
    );
    expect(
      unwrap(
        await scoreGeneration(
          filteredFold.benchmarkCase.case,
          filteredFold.session,
        ),
      ).semanticSuccess,
    ).toBe(true);

    const selectedInvoke = await sessionFor(
      "decisions/approve",
      {
        formatVersion: "1",
        catalog: { id: "benchmark.decisions", version: "1.0.0" },
        root: "approved",
        nodes: [
          {
            id: "condition",
            op: "input",
            inputKey: "condition",
            schema: { id: "boolean", version: "1.0.0" },
          },
          {
            id: "primary",
            op: "input",
            inputKey: "primary",
            schema: { id: "label", version: "1.0.0" },
          },
          {
            id: "fallback",
            op: "input",
            inputKey: "fallback",
            schema: { id: "label", version: "1.0.0" },
          },
          {
            id: "chosen",
            op: "select",
            condition: "condition",
            whenTrue: "primary",
            whenFalse: "fallback",
          },
          {
            id: "approved",
            op: "invoke",
            source: "chosen",
            function: { id: "approve-label", version: "1.0.0" },
          },
        ],
        budget,
        allowedCapabilities: [],
      },
      "select-invoke",
    );
    expect(
      unwrap(
        await scoreGeneration(
          selectedInvoke.benchmarkCase.case,
          selectedInvoke.session,
        ),
      ).semanticSuccess,
    ).toBe(true);
  });

  it("never executes rejected plans and credits impossible-case abstention", async () => {
    const impossible = await corpusCase("numbers/forbidden-tax");
    const catalog = unwrap(
      unwrap(createM1aCatalogResolver())(impossible.case.catalogId),
    );
    const rejectedFixture = unwrap(
      await freezeRecordedModelFixture({
        identity: {
          provider: "recorded",
          model: "invalid",
          adapterVersion: "1",
        },
        responses: [
          {
            kind: "response",
            response: {
              structuredOutput: {
                kind: "plan",
                plan: { formatVersion: "1" },
              },
              rawResponse: "invalid plan",
              usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
              latencyMs: 1,
            },
          },
        ],
      }),
    );
    const rejected = unwrap(
      await generatePlan({
        task: impossible.case.instruction,
        taskInputs: impossible.case.taskInputs,
        catalog,
        policy: impossible.case.policy,
        publicExamples: [],
        adapter: createRecordedModelAdapter(rejectedFixture),
        strategy: strategy("json-schema"),
      }),
    );
    const rejectedScore = unwrap(
      await scoreGeneration(impossible.case, rejected),
    );
    expect(rejectedScore.executionAttempted).toBe(false);
    expect(rejectedScore.correctAbstention).toBe(false);

    const abstained = unwrap(
      await generatePlan({
        task: impossible.case.instruction,
        taskInputs: impossible.case.taskInputs,
        catalog,
        policy: impossible.case.policy,
        publicExamples: [],
        adapter: createRecordedModelAdapter(await recordedFixture(2)),
        strategy: strategy("json-schema-with-repair"),
      }),
    );
    const abstentionScore = unwrap(
      await scoreGeneration(impossible.case, abstained),
    );
    expect(abstentionScore.executionAttempted).toBe(false);
    expect(abstentionScore.correctAbstention).toBe(true);
  });

  it("records denied capabilities without executing the proposed plan", async () => {
    const impossible = await corpusCase("numbers/forbidden-tax");
    const effectPlan = {
      ...RECORDED_DOUBLE_PLAN,
      root: "quoted",
      nodes: [
        {
          id: "source",
          op: "input",
          inputKey: "items",
          schema: { id: "numbers", version: "1.0.0" },
          maxItems: 4,
        },
        {
          id: "quoted",
          op: "map",
          source: "source",
          operation: {
            kind: "effect",
            id: "quote-tax",
            version: "1.0.0",
          },
          outputCollectionSchema: { id: "numbers", version: "1.0.0" },
          parallelism: 2,
        },
      ],
      budget: {
        maxEffectCalls: 4,
        maxCollectionItems: 32,
        maxRecursionDepth: 0,
        maxTokens: 48,
        maxWallClockMs: 80,
        maxParallelism: 2,
      },
      allowedCapabilities: ["finance.read"],
    };
    const fixture = unwrap(
      await freezeRecordedModelFixture({
        identity: {
          provider: "recorded",
          model: "denied-capability",
          adapterVersion: "1",
        },
        responses: [
          {
            kind: "response",
            response: {
              structuredOutput: { kind: "plan", plan: effectPlan },
              rawResponse: JSON.stringify({ kind: "plan", plan: effectPlan }),
              usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
              latencyMs: 1,
            },
          },
        ],
      }),
    );
    const session = unwrap(
      await generatePlan({
        task: impossible.case.instruction,
        taskInputs: impossible.case.taskInputs,
        catalog: unwrap(
          unwrap(createM1aCatalogResolver())(impossible.case.catalogId),
        ),
        policy: impossible.case.policy,
        publicExamples: [],
        adapter: createRecordedModelAdapter(fixture),
        strategy: strategy("json-schema"),
      }),
    );
    const score = unwrap(await scoreGeneration(impossible.case, session));
    expect(session.kind).toBe("rejected");
    expect(
      session.record.attempts[0]?.diagnostics.map((item) => item.code),
    ).toContain("DENIED_CAPABILITY");
    expect(score.executionAttempted).toBe(false);
    expect(score.capabilityViolation).toBe(true);
  });

  it("summarizes metrics and keeps M1b CodeMode gate unevaluated", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const methods: ReadonlyArray<BenchmarkMethod> = [
      {
        id: "schema",
        adapter: createRecordedModelAdapter(await recordedFixture(0)),
        strategy: strategy("json-schema"),
      },
    ];
    const run = unwrap(
      await runBenchmark({
        experiment: await experimentFor([benchmarkCase], methods),
        cases: [benchmarkCase],
        methods,
        resolveCatalog: unwrap(createM1aCatalogResolver()),
        store: createInMemoryBenchmarkStore(),
      }),
    );
    const summary = summarizeBenchmark(run.records);
    expect(summary.firstAttemptCompilation.rate).toBe(1);
    expect(summary.firstAttemptCompilation.sampleCount).toBe(1);
    expect(summary.firstAttemptCompilation.confidenceInterval).not.toBeNull();
    expect(summary.semanticSuccess.rate).toBe(1);
    expect(summary.totalInputTokens).toBe(120);
    expect(summary.totalCostUsdMicros).toBe(200);
    const gates = evaluateResearchGates(run.records);
    expect(
      gates.find((gate) => gate.id === "functional-ir-outperforms-codemode")
        ?.status,
    ).toBe("notEvaluated");

    const baseRecord = required(run.records[0], "Missing summary record.");
    const repairedRecord = benchmarkCaseRecordSchema.parse({
      ...baseRecord,
      key: "repaired",
      methodId: "repair",
      strategy: {
        id: "json-schema-with-repair",
        constraint: "json-schema",
        repair: "compiler-guided",
      },
      generation: {
        ...baseRecord.generation,
        strategy: {
          id: "json-schema-with-repair",
          constraint: "json-schema",
          repair: "compiler-guided",
        },
      },
    });
    const codeModeRecord = benchmarkCaseRecordSchema.parse({
      ...baseRecord,
      key: "codemode",
      methodId: "codemode",
      strategy: {
        id: "codemode",
        constraint: "unconstrained-json",
        repair: "none",
      },
      generation: {
        ...baseRecord.generation,
        strategy: {
          id: "codemode",
          constraint: "unconstrained-json",
          repair: "none",
        },
        repairCount: 2,
      },
      score: {
        ...baseRecord.score,
        semanticSuccess: false,
        hiddenEvaluations: baseRecord.score.hiddenEvaluations.map(
          (evaluation, index) => ({
            ...evaluation,
            success: index === 0 ? false : evaluation.success,
          }),
        ),
      },
    });
    const compared = evaluateResearchGates([
      baseRecord,
      repairedRecord,
      codeModeRecord,
    ]);
    expect(
      compared.find((gate) => gate.id === "functional-ir-outperforms-codemode")
        ?.status,
    ).toBe("pass");
    expect(
      compared.find((gate) => gate.id === "repair-materially-improves")
        ?.sampleCount,
    ).toBe(1);
    const unmatched = evaluateResearchGates([repairedRecord]);
    expect(
      unmatched.find((gate) => gate.id === "repair-materially-improves")
        ?.status,
    ).toBe("notEvaluated");
    const developmentFailure = benchmarkCaseRecordSchema.parse({
      ...codeModeRecord,
      split: "development",
      score: { ...codeModeRecord.score, capabilityViolation: true },
    });
    expect(
      evaluateResearchGates([developmentFailure]).find(
        (gate) => gate.id === "zero-rejected-or-unauthorized-execution",
      )?.status,
    ).toBe("notEvaluated");
  });

  it("validates experiment repetitions", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const method: BenchmarkMethod = {
      id: "schema",
      adapter: createRecordedModelAdapter(await recordedFixture(0)),
      strategy: strategy("json-schema"),
    };
    const invalid = await createExperimentManifest({
      prompt: "prompt",
      protocol: "protocol",
      cases: [{ frozenCase: benchmarkCase, split: "development" }],
      methods: [
        {
          id: method.id,
          model: method.adapter.identity,
          strategy: method.strategy,
          inference: {
            temperature: 0,
            seed: null,
            reasoningSettings: {},
            maxInputTokens: 100,
            maxOutputTokens: 100,
            structuredOutputMode: "json-schema",
          },
          pricingEntryId: method.adapter.pricingEntryId,
        },
      ],
      pricingSnapshot: await pricingFor([method]),
      repetitions: 0,
      caps: {
        maxCalls: 1,
        maxInputTokens: 1,
        maxOutputTokens: 1,
        maxTotalTokens: 1,
        maxOutputTokensPerCall: 100,
        maxCostUsdMicros: 1,
        providerCostCaps: [
          { billingProvider: "recorded", maxCostUsdMicros: 1 },
        ],
      },
      versions: {
        gitCommit: "test",
        workspaceVersion: "test",
        kernelVersion: "test",
        generatorVersion: "test",
      },
    });
    expect(invalid.ok).toBe(false);
  });
});

describe("resumable Node store", () => {
  it("round-trips canonical records and reports invalid persistence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lachesis-generator-"));
    try {
      const path = join(directory, "records.json");
      const store = unwrap(await createJsonFileBenchmarkStore(path));
      const benchmarkCase = await corpusCase("numbers/double");
      const methods: ReadonlyArray<BenchmarkMethod> = [
        {
          id: "schema",
          adapter: createRecordedModelAdapter(await recordedFixture(0)),
          strategy: strategy("json-schema"),
        },
      ];
      const run = unwrap(
        await runBenchmark({
          experiment: await experimentFor([benchmarkCase], methods),
          cases: [benchmarkCase],
          methods,
          resolveCatalog: unwrap(createM1aCatalogResolver()),
          store,
        }),
      );
      const record = required(run.records[0], "Missing persisted record.");
      const reopened = unwrap(await createJsonFileBenchmarkStore(path));
      expect(unwrap(await reopened.load(record.key))).toEqual(record);

      const persisted = await readFile(path, "utf8");
      await writeFile(
        path,
        persisted.replace(record.digest, "tampered"),
        "utf8",
      );
      const tampered = await createJsonFileBenchmarkStore(path);
      expect(tampered.ok).toBe(false);

      const invalidPath = join(directory, "invalid.json");
      await writeFile(invalidPath, "{", "utf8");
      const invalid = await createJsonFileBenchmarkStore(invalidPath);
      expect(invalid.ok).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns write failures without mutating the in-memory snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lachesis-generator-"));
    try {
      const path = join(directory, "records.json");
      const store = unwrap(await createJsonFileBenchmarkStore(path));
      await mkdir(path);
      const benchmarkCase = await corpusCase("numbers/double");
      const methods: ReadonlyArray<BenchmarkMethod> = [
        {
          id: "schema",
          adapter: createRecordedModelAdapter(await recordedFixture(0)),
          strategy: strategy("json-schema"),
        },
      ];
      const result = await runBenchmark({
        experiment: await experimentFor([benchmarkCase], methods),
        cases: [benchmarkCase],
        methods,
        resolveCatalog: unwrap(createM1aCatalogResolver()),
        store,
      });
      expect(result.ok).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
