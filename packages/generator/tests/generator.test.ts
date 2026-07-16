import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createCatalog,
  createPlanLanguageManifest,
  defineFixedPointStep,
  defineMeasure,
  defineSchema,
  digestValue,
  executePlan,
  modelPlanProposalSchema,
  type Result,
} from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  applyDeterministicPlanMutation,
  assertM2CorpusNamespaceDisjoint,
  assertNoM1bHeldOutReuse,
  type BenchmarkBudgetController,
  benchmarkCaseRecordSchema,
  type BenchmarkMethod,
  type BenchmarkSplit,
  blindPlanGenerationValidityAudit,
  calculateCostUsdMicros,
  calculateMaximumCostUsdMicros,
  type CatalogResolver,
  CODEMODE_PROTOCOL,
  type CodeModeModelAdapter,
  type CodeModeModelRequest,
  compileCaseStructuredOutputTransports,
  compileCodeMode,
  compileCodeModeStructuredOutputTransport,
  compileModelPlanProposal,
  compileStructuredOutputTransport,
  createExperimentManifest,
  createInMemoryBenchmarkStore,
  createInMemoryM2CodeModeStore,
  createM1aCatalogResolver,
  createM2CatalogResolver,
  createM2PairedExperimentDigest,
  createPricingSnapshot,
  createRecordedModelAdapter,
  DEFAULT_INFERENCE_SETTINGS,
  evaluateResearchGates,
  executeCodeMode,
  type ExperimentCaps,
  type ExperimentManifest,
  type ExperimentTransportSchemaBinding,
  freezePlanGenerationCase,
  freezeRecordedModelFixture,
  type FrozenPlanGenerationCase,
  type FrozenRecordedModelFixture,
  generateCodeMode,
  generatePlan,
  generationRecordSchema,
  type GenerationSession,
  type GenerationStrategy,
  inspectCodeModeArtifact,
  loadM1aCorpus,
  loadM1aRecordedFixtures,
  loadM1cPreregisteredCorpus,
  loadM2PreregisteredCorpus,
  M1A_GENERATION_STRATEGIES,
  M1A_HOLDOUTS,
  type M2CodeModeMethod,
  type ModelAdapter,
  normalizeStructuredOutputEnvelope,
  partitionM1aCorpus,
  prepareSharedRepairTrial,
  type PricingSnapshot,
  RECORDED_DOUBLE_PLAN,
  runBenchmark,
  runM2CodeModeBenchmark,
  runM2PairedBenchmark,
  scoreGeneration,
  summarizeBenchmark,
  validatePlanGenerationCases,
  validatePortableStructuredOutputSchema,
  validateUnplannableWitness,
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

function modelProposal(value: unknown): unknown {
  const object = z.record(z.string(), z.unknown()).parse(value);
  const nodes = z
    .array(z.record(z.string(), z.unknown()))
    .parse(object["nodes"])
    .map((node) =>
      Object.fromEntries(
        Object.entries(node).filter(([name]) => name !== "maxItems"),
      ),
    );
  return {
    ...Object.fromEntries(
      Object.entries(object).filter(
        ([name]) => name !== "budget" && name !== "allowedCapabilities",
      ),
    ),
    nodes,
  };
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
  resolverOverride?: CatalogResolver,
): Promise<ExperimentManifest> {
  const methodInputs = methods.map((method) => ({
    id: method.id,
    model: method.adapter.identity,
    strategy: method.strategy,
    inference: method.adapter.inference,
    pricingEntryId: method.adapter.pricingEntryId,
  }));
  const resolver = resolverOverride ?? unwrap(createM1aCatalogResolver());
  const transports = unwrap(
    await compileCaseStructuredOutputTransports(cases, resolver),
  );
  const transportSchemas: ReadonlyArray<ExperimentTransportSchemaBinding> =
    transports.flatMap((item) =>
      methodInputs
        .filter((method) => method.strategy.constraint === "json-schema")
        .map((method) => ({
          caseDigest: item.caseDigest,
          methodId: method.id,
          manifestDigest: item.transport.manifestDigest,
          compilerVersion: item.transport.compilerVersion,
          schemaDigest: item.transport.schemaDigest,
        })),
    );
  return unwrap(
    await createExperimentManifest({
      prompt: `${protocolIdentity}-prompt`,
      protocol: { id: protocolIdentity, version: "1" },
      cases: cases.map((frozenCase) => ({ frozenCase, split })),
      methods: methodInputs,
      transportSchemas,
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
  const proposal = modelProposal(plan);
  const fixture = unwrap(
    await freezeRecordedModelFixture({
      identity: { provider: "recorded", model, adapterVersion: "1" },
      responses: [
        {
          kind: "response",
          response: {
            structuredOutput: { kind: "plan", plan: proposal },
            rawResponse: JSON.stringify({ kind: "plan", plan: proposal }),
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
  it("compiles portable scalar, collection, and closed-object catalog schemas", async () => {
    const boolean = defineSchema({
      id: "boolean-value",
      version: "1",
      description: "Boolean fixture.",
      validator: z.boolean(),
    });
    const constrainedText = defineSchema({
      id: "constrained-text",
      version: "1",
      description: "Constrained text fixture.",
      validator: z.string().min(1).max(8),
    });
    const enumeratedText = defineSchema({
      id: "enumerated-text",
      version: "1",
      description: "Enumerated text fixture.",
      validator: z.enum(["first", "second"]),
    });
    const boundedStrings = defineSchema({
      id: "bounded-strings",
      version: "1",
      description: "Bounded strings fixture.",
      validator: z.array(z.string()).min(1).max(3),
    });
    const closedObject = defineSchema({
      id: "closed-object",
      version: "1",
      description: "Closed object fixture.",
      validator: z.strictObject({
        enabled: z.boolean(),
        count: z.int().min(0),
      }),
    });
    const catalog = unwrap(
      createCatalog({
        identity: { id: "portable-test", version: "1" },
        schemas: [
          boolean.runtime,
          constrainedText.runtime,
          enumeratedText.runtime,
          boundedStrings.runtime,
          closedObject.runtime,
        ],
        operations: [],
      }),
    );
    const benchmarkCase = await corpusCase("numbers/double");
    const manifest = unwrap(
      await createPlanLanguageManifest(catalog, benchmarkCase.case.policy),
    );
    expect((await compileStructuredOutputTransport(manifest)).ok).toBe(true);

    const unsupported = [
      defineSchema({
        id: "optional-object",
        version: "1",
        description: "Optional object fixture.",
        validator: z.strictObject({ value: z.string().optional() }),
      }).runtime,
      defineSchema({
        id: "schema-union",
        version: "1",
        description: "Union fixture.",
        validator: z.union([z.string(), z.number()]),
      }).runtime,
      defineSchema({
        id: "tuple",
        version: "1",
        description: "Tuple fixture.",
        validator: z.tuple([z.string(), z.number()]),
      }).runtime,
    ];
    for (const schema of unsupported) {
      const unsupportedCatalog = unwrap(
        createCatalog({
          identity: { id: `unsupported-${schema.id}`, version: "1" },
          schemas: [schema],
          operations: [],
        }),
      );
      const unsupportedManifest = unwrap(
        await createPlanLanguageManifest(
          unsupportedCatalog,
          benchmarkCase.case.policy,
        ),
      );
      expect(
        (await compileStructuredOutputTransport(unsupportedManifest)).ok,
      ).toBe(false);
    }

    for (const jsonSchema of [
      "not-a-schema-object",
      z.json().parse({ type: "array" }),
      z.json().parse({
        type: "object",
        properties: { value: { type: "string" } },
        required: [],
        additionalProperties: false,
      }),
    ]) {
      const alteredManifest = {
        ...manifest,
        schemas: manifest.schemas.map((schema, index) =>
          index === 0 ? { ...schema, jsonSchema } : schema,
        ),
      };
      expect((await compileStructuredOutputTransport(alteredManifest)).ok).toBe(
        false,
      );
    }
  });

  it("normalizes the portable outcome envelope and rejects malformed transports", () => {
    const transportPlan = {
      ...RECORDED_DOUBLE_PLAN,
      metadata: null,
    };
    const normalized = unwrap(
      normalizeStructuredOutputEnvelope({
        outcome: { kind: "plan", plan: transportPlan },
      }),
    );
    expect(normalized.kind).toBe("plan");
    if (normalized.kind !== "plan") throw new Error("Expected plan outcome.");
    expect(normalized.plan).not.toHaveProperty("metadata");
    expect(normalized.plan).not.toHaveProperty("nodes.0.maxItems");
    expect(
      unwrap(
        normalizeStructuredOutputEnvelope({
          outcome: {
            kind: "unplannable",
            witness: {
              kind: "missingOperation",
              operation: { id: "offline", version: "1" },
            },
          },
        }),
      ),
    ).toEqual({
      kind: "unplannable",
      witness: {
        kind: "missingOperation",
        operation: { id: "offline", version: "1" },
      },
    });

    for (const malformed of [
      null,
      {},
      { outcome: { kind: "other" } },
      { outcome: { kind: "unplannable", witness: {} } },
      { outcome: { kind: "plan" } },
      { outcome: { kind: "plan", plan: "not-an-object" } },
      { outcome: { kind: "plan", plan: {} } },
      { outcome: { kind: "plan", plan: { nodes: ["not-a-node"] } } },
      {
        outcome: {
          kind: "plan",
          plan: { ...transportPlan, formatVersion: "unsupported" },
        },
      },
    ])
      expect(normalizeStructuredOutputEnvelope(malformed).ok).toBe(false);

    for (const nonPortable of [
      null,
      { type: "string" },
      { type: "object", readOnly: true },
      { type: "object", properties: {}, required: [] },
      {
        type: "object",
        properties: "invalid",
        required: [],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { value: { type: "string" } },
        required: [],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { value: { type: "string", readOnly: true } },
        required: ["value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          value: { type: "array", items: { type: "string", readOnly: true } },
        },
        required: ["value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { value: { anyOf: [] } },
        required: ["value"],
        additionalProperties: false,
      },
    ])
      expect(validatePortableStructuredOutputSchema(nonPortable).ok).toBe(
        false,
      );
  });

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

  it("proves every plannable fixture with offline references and hidden properties", async () => {
    const corpus = unwrap(await loadM1aCorpus());
    const resolver = unwrap(createM1aCatalogResolver());
    expect(await validatePlanGenerationCases(corpus, resolver)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await blindPlanGenerationValidityAudit(corpus, resolver)).toEqual({
      totalCases: 42,
      plannableCases: 32,
      unplannableCases: 10,
      referencesValid: 42,
      witnessesCompiled: 32,
      hiddenPropertiesPassed: 32,
      infeasibilityWitnessesPassed: 10,
      invalidCases: 0,
    });
    const partition = partitionM1aCorpus(corpus);
    const heldOut = [
      ...partition.heldOutCatalogs,
      ...partition.heldOutOperatorCombinations,
      ...partition.heldOutPhrasings,
    ];
    const audit = await blindPlanGenerationValidityAudit(heldOut, resolver);
    expect(audit).toEqual({
      totalCases: 17,
      plannableCases: 13,
      unplannableCases: 4,
      referencesValid: 17,
      witnessesCompiled: 13,
      hiddenPropertiesPassed: 13,
      infeasibilityWitnessesPassed: 4,
      invalidCases: 0,
    });
    expect(
      Object.values(audit).every((value) => typeof value === "number"),
    ).toBe(true);
  });

  it("audits compilation, hidden semantics, and infeasibility independently", async () => {
    const resolver = unwrap(createM1aCatalogResolver());
    const feasible = await corpusCase("numbers/double");
    const semanticFailure = unwrap(
      await freezePlanGenerationCase({
        ...feasible.case,
        hiddenEvaluations: feasible.case.hiddenEvaluations.map(
          (evaluation) => ({
            ...evaluation,
            expectedOutput: ["deliberately-wrong"],
          }),
        ),
      }),
    );
    expect(
      await blindPlanGenerationValidityAudit([semanticFailure], resolver),
    ).toEqual({
      totalCases: 1,
      plannableCases: 1,
      unplannableCases: 0,
      referencesValid: 1,
      witnessesCompiled: 1,
      hiddenPropertiesPassed: 0,
      infeasibilityWitnessesPassed: 0,
      invalidCases: 1,
    });
    const semanticValidation = await validatePlanGenerationCases(
      [semanticFailure],
      resolver,
    );
    expect(
      semanticValidation.ok
        ? []
        : semanticValidation.error.map((item) => item.message),
    ).toContain(
      "numbers/double: compiled offline reference witness did not pass hidden properties",
    );

    const missingFeasibleWitness = unwrap(
      await freezePlanGenerationCase({
        ...feasible.case,
        id: "audit/no-reference-witness",
      }),
    );
    expect(
      (await validatePlanGenerationCases([missingFeasibleWitness], resolver))
        .ok,
    ).toBe(false);

    const missing = await corpusCase("numbers/missing-average");
    const falseMissingWitness = unwrap(
      await freezePlanGenerationCase({
        ...missing.case,
        infeasibilityWitness: {
          kind: "missingOperation",
          operation: { id: "double", version: "1.0.0" },
        },
        semanticObligations: [
          {
            kind: "requiresOperation",
            operation: { id: "double", version: "1.0.0" },
          },
        ],
      }),
    );
    const denied = await corpusCase("numbers/forbidden-tax");
    const falseDeniedWitness = unwrap(
      await freezePlanGenerationCase({
        ...denied.case,
        policy: {
          ...denied.case.policy,
          allowedCapabilities: ["finance.read"],
        },
      }),
    );
    const budget = await corpusCase("numbers/zero-effect-budget");
    const falseBudgetWitness = unwrap(
      await freezePlanGenerationCase({
        ...budget.case,
        policy: {
          ...budget.case.policy,
          budget: { ...budget.case.policy.budget, maxEffectCalls: 1 },
        },
      }),
    );
    for (const invalid of [
      falseMissingWitness,
      falseDeniedWitness,
      falseBudgetWitness,
    ])
      expect((await validatePlanGenerationCases([invalid], resolver)).ok).toBe(
        false,
      );

    expect(
      await blindPlanGenerationValidityAudit([falseMissingWitness], resolver),
    ).toEqual({
      totalCases: 1,
      plannableCases: 0,
      unplannableCases: 1,
      referencesValid: 1,
      witnessesCompiled: 0,
      hiddenPropertiesPassed: 0,
      infeasibilityWitnessesPassed: 0,
      invalidCases: 1,
    });

    expect(
      (
        await freezePlanGenerationCase({
          ...missing.case,
          infeasibilityWitness: null,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await freezePlanGenerationCase({
          ...feasible.case,
          infeasibilityWitness: {
            kind: "missingOperation",
            operation: { id: "average", version: "1.0.0" },
          },
        })
      ).ok,
    ).toBe(false);
  });

  it("rejects unresolved public and required fixture references", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const invalid = unwrap(
      await freezePlanGenerationCase({
        ...benchmarkCase.case,
        taskInputs: benchmarkCase.case.taskInputs.map((input) => ({
          ...input,
          schema: { ...input.schema, version: "missing" },
        })),
        requiredProperties: [
          {
            kind: "usesOperation",
            id: "double",
            version: "missing",
          },
          { kind: "rootSchema", id: "numbers", version: "missing" },
          { kind: "usesEffect", name: "missing.effect" },
          { kind: "usesInput", inputKey: "missing-input" },
        ],
      }),
    );
    const validation = await validatePlanGenerationCases(
      [invalid],
      unwrap(createM1aCatalogResolver()),
    );
    expect(validation.ok).toBe(false);
    expect(
      validation.ok
        ? []
        : validation.error.map((item) => item.message).toSorted(),
    ).toEqual([
      "numbers/double: public input items references unknown schema numbers@missing",
      "numbers/double: required effect missing.effect is not registered",
      "numbers/double: required input missing-input is not public",
      "numbers/double: required operation double@missing is not registered",
      "numbers/double: required root schema numbers@missing is not registered",
    ]);

    const unknownCatalog = unwrap(
      await freezePlanGenerationCase({
        ...benchmarkCase.case,
        id: "numbers/unknown-catalog",
        catalogId: "benchmark.missing",
      }),
    );
    expect(
      (
        await validatePlanGenerationCases(
          [unknownCatalog],
          unwrap(createM1aCatalogResolver()),
        )
      ).ok,
    ).toBe(false);
    expect(
      await blindPlanGenerationValidityAudit(
        [invalid, unknownCatalog],
        unwrap(createM1aCatalogResolver()),
      ),
    ).toEqual({
      totalCases: 2,
      plannableCases: 2,
      unplannableCases: 0,
      referencesValid: 0,
      witnessesCompiled: 0,
      hiddenPropertiesPassed: 0,
      infeasibilityWitnessesPassed: 0,
      invalidCases: 2,
    });
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
    expect((await verifyExperimentManifest({})).ok).toBe(false);
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
    const caseDigest = first.cases[0]?.caseDigest;
    if (caseDigest === undefined) throw new Error("Missing experiment case.");
    const invalidRepairBody = {
      ...manifestBody,
      formatVersion: "5",
      repairTrials: [
        {
          caseDigest,
          mutation: { kind: "redirectRoot", root: "items" },
          initialProposalDigest: "a".repeat(64),
          eligibility: "eligible",
          arms: {
            withoutRepair: "a".repeat(64),
            compilerGuidedRepair: "b".repeat(64),
          },
        },
      ],
    };
    const invalidRepairDigest = unwrap(await digestValue(invalidRepairBody));
    expect(
      (
        await verifyExperimentManifest({
          ...invalidRepairBody,
          experimentDigest: invalidRepairDigest,
        })
      ).ok,
    ).toBe(false);
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
      transportSchemas: [],
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
    const adapter = createRecordedModelAdapter(await recordedFixture(0));
    const method: BenchmarkMethod = {
      id: "schema",
      adapter,
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
      transportSchemas: [],
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

describe("M1c preregistered corpus boundary", () => {
  it("uses only fresh case identities and passes the blind offline validity audit", async () => {
    const corpus = unwrap(await loadM1cPreregisteredCorpus());
    expect(corpus.development).toHaveLength(7);
    expect(corpus.heldOut).toHaveLength(10);
    const priorIds = [
      ...M1A_HOLDOUTS.catalogs,
      ...M1A_HOLDOUTS.operatorCombinations,
      ...M1A_HOLDOUTS.phrasings,
    ];
    expect(assertNoM1bHeldOutReuse(corpus, priorIds).ok).toBe(true);
    expect(
      assertNoM1bHeldOutReuse(corpus, [corpus.development[0]?.case.id ?? ""])
        .ok,
    ).toBe(false);
    const all = [...corpus.development, ...corpus.heldOut];
    expect(
      await blindPlanGenerationValidityAudit(
        all,
        unwrap(createM1aCatalogResolver()),
      ),
    ).toEqual({
      totalCases: 17,
      plannableCases: 11,
      unplannableCases: 6,
      referencesValid: 17,
      witnessesCompiled: 11,
      hiddenPropertiesPassed: 11,
      infeasibilityWitnessesPassed: 6,
      invalidCases: 0,
    });
    for (const split of [corpus.development, corpus.heldOut])
      expect(
        split
          .flatMap((item) =>
            item.case.infeasibilityWitness === null
              ? []
              : [item.case.infeasibilityWitness.kind],
          )
          .toSorted(),
      ).toEqual(["deniedCapability", "insufficientBudget", "missingOperation"]);
  });
});

describe("generate, compile, and bounded repair", () => {
  it("rejects model-authored authority and narrowed public input bounds", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const narrowed = {
      ...RECORDED_DOUBLE_PLAN,
      nodes: RECORDED_DOUBLE_PLAN.nodes.map((node) =>
        node.op === "input" ? { ...node, maxItems: 1 } : node,
      ),
      budget: benchmarkCase.case.policy.budget,
      allowedCapabilities: [],
    };
    const fixture = unwrap(
      await freezeRecordedModelFixture({
        identity: {
          provider: "recorded",
          model: "model-authored-authority",
          adapterVersion: "1",
        },
        responses: [
          {
            kind: "response",
            response: {
              structuredOutput: { kind: "plan", plan: narrowed },
              rawResponse: JSON.stringify({ kind: "plan", plan: narrowed }),
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
    expect(session.kind).toBe("rejected");
    expect(
      session.record.attempts[0]?.diagnostics.map((item) => item.message),
    ).toEqual([
      "Model proposals cannot author trusted policy budgets.",
      "Model proposals cannot authorize capabilities.",
      "Model input bound 1 cannot narrow public task bound 128.",
    ]);
  });

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
    expect(session.record.semanticContractHash).toMatch(/^[a-f0-9]{64}$/);
    expect(session.record.semanticObligations).toEqual([]);
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
      "semanticObligations",
      "structuredOutputTransport",
      "taskInputs",
    ]);
    expect("hiddenEvaluations" in repair).toBe(false);
    expect("executionResults" in repair).toBe(false);
    expect("publicExamples" in repair).toBe(false);
  });

  it("feeds dead-root topology failures into bounded repair", async () => {
    const benchmarkCase = await corpusCase("text/uppercase-exclaim");
    const version = "1.0.0";
    const badPlan = {
      formatVersion: "1",
      catalog: { id: "benchmark.text", version },
      root: "uppercase",
      nodes: [
        {
          id: "items",
          op: "input",
          inputKey: "items",
          schema: { id: "texts", version },
        },
        {
          id: "uppercase",
          op: "map",
          source: "items",
          operation: { kind: "function", id: "uppercase", version },
          outputCollectionSchema: { id: "texts", version },
          parallelism: 1,
        },
        {
          id: "exclaim",
          op: "map",
          source: "uppercase",
          operation: { kind: "function", id: "exclaim", version },
          outputCollectionSchema: { id: "texts", version },
          parallelism: 1,
        },
      ],
    };
    const goodPlan = { ...badPlan, root: "exclaim" };
    const fixture = unwrap(
      await freezeRecordedModelFixture({
        identity: {
          provider: "recorded",
          model: "dead-root-repair",
          adapterVersion: "1",
        },
        responses: [badPlan, goodPlan].map((plan) => ({
          kind: "response" as const,
          response: {
            structuredOutput: { kind: "plan", plan },
            rawResponse: JSON.stringify({ kind: "plan", plan }),
            usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
            latencyMs: 1,
          },
        })),
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
        semanticObligations: benchmarkCase.case.semanticObligations ?? [],
        publicExamples: [],
        adapter: createRecordedModelAdapter(fixture),
        strategy: strategy("json-schema-with-repair"),
      }),
    );
    expect(session.kind).toBe("compiled");
    expect(session.record.repairCount).toBe(1);
    expect(session.record.attempts[0]?.diagnostics[0]?.code).toBe("DEAD_NODE");
  });

  it("validates typed infeasibility witnesses and repairs an irrelevant abstention", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const catalog = unwrap(
      unwrap(createM1aCatalogResolver())(benchmarkCase.case.catalogId),
    );
    const manifest = unwrap(
      await createPlanLanguageManifest(catalog, benchmarkCase.case.policy),
    );
    const irrelevantWitness = {
      kind: "missingOperation" as const,
      operation: { id: "offline", version: "1" },
    };
    expect(
      validateUnplannableWitness(
        irrelevantWitness,
        manifest,
        benchmarkCase.case.policy,
        benchmarkCase.case.semanticObligations ?? [],
      )[0]?.code,
    ).toBe("INVALID_INFEASIBILITY_WITNESS");
    const fixture = unwrap(
      await freezeRecordedModelFixture({
        identity: {
          provider: "recorded",
          model: "witness-repair",
          adapterVersion: "1",
        },
        responses: [
          {
            kind: "response",
            response: {
              structuredOutput: {
                kind: "unplannable",
                witness: irrelevantWitness,
              },
              rawResponse: JSON.stringify({
                kind: "unplannable",
                witness: irrelevantWitness,
              }),
              usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 1 },
              latencyMs: 1,
            },
          },
          {
            kind: "response",
            response: {
              structuredOutput: {
                kind: "plan",
                plan: modelProposal(RECORDED_DOUBLE_PLAN),
              },
              rawResponse: JSON.stringify({
                kind: "plan",
                plan: modelProposal(RECORDED_DOUBLE_PLAN),
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
        catalog,
        policy: benchmarkCase.case.policy,
        semanticObligations: benchmarkCase.case.semanticObligations ?? [],
        publicExamples: [],
        adapter: createRecordedModelAdapter(fixture),
        strategy: strategy("json-schema-with-repair"),
      }),
    );
    expect(session.kind).toBe("compiled");
    expect(session.record.repairCount).toBe(1);
    expect(session.record.attempts[0]?.diagnostics[0]?.code).toBe(
      "INVALID_INFEASIBILITY_WITNESS",
    );
  });

  it("proves missing-operation and exact insufficient-budget witnesses", async () => {
    const resolver = unwrap(createM1aCatalogResolver());
    const missing = await corpusCase("numbers/missing-average");
    const missingCatalog = unwrap(resolver(missing.case.catalogId));
    const missingManifest = unwrap(
      await createPlanLanguageManifest(missingCatalog, missing.case.policy),
    );
    expect(
      validateUnplannableWitness(
        {
          kind: "missingOperation",
          operation: { id: "average", version: "1.0.0" },
        },
        missingManifest,
        missing.case.policy,
        missing.case.semanticObligations ?? [],
      ),
    ).toEqual([]);

    const budget = await corpusCase("numbers/zero-effect-budget");
    const budgetCatalog = unwrap(resolver(budget.case.catalogId));
    const budgetManifest = unwrap(
      await createPlanLanguageManifest(budgetCatalog, budget.case.policy),
    );
    expect(
      validateUnplannableWitness(
        {
          kind: "insufficientBudget",
          operation: { id: "quote-tax", version: "1.0.0" },
          resource: "maxEffectCalls",
          requiredMinimum: 1,
        },
        budgetManifest,
        budget.case.policy,
        budget.case.semanticObligations ?? [],
      ),
    ).toEqual([]);
    expect(
      validateUnplannableWitness(
        {
          kind: "insufficientBudget",
          operation: { id: "quote-tax", version: "1.0.0" },
          resource: "maxEffectCalls",
          requiredMinimum: 2,
        },
        budgetManifest,
        budget.case.policy,
        budget.case.semanticObligations ?? [],
      )[0]?.code,
    ).toBe("INVALID_INFEASIBILITY_WITNESS");
  });

  it("uses one deterministic initial proposal for both repair arms", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const catalog = unwrap(
      unwrap(createM1aCatalogResolver())(benchmarkCase.case.catalogId),
    );
    const common = {
      validProposal: modelProposal(RECORDED_DOUBLE_PLAN),
      catalog,
      policy: benchmarkCase.case.policy,
      taskInputs: benchmarkCase.case.taskInputs,
      semanticObligations: benchmarkCase.case.semanticObligations ?? [],
    };
    const eligible = unwrap(
      await prepareSharedRepairTrial({
        ...common,
        mutation: { kind: "bypassUnaryNode", nodeId: "doubled" },
      }),
    );
    expect(eligible.eligibility).toBe("eligible");
    expect(eligible.arms.withoutRepair).toBe(
      eligible.arms.compilerGuidedRepair,
    );
    expect(eligible.diagnostics[0]?.code).toBe("SEMANTIC_OBLIGATION_FAILED");

    const unnecessary = unwrap(
      await prepareSharedRepairTrial({
        ...common,
        mutation: { kind: "redirectRoot", root: "doubled" },
      }),
    );
    expect(unnecessary.eligibility).toBe("repair-unnecessary");
    expect(unnecessary.diagnostics).toEqual([]);

    expect(
      applyDeterministicPlanMutation(
        {},
        { kind: "redirectRoot", root: "missing" },
      ).ok,
    ).toBe(false);
    expect(
      (
        await prepareSharedRepairTrial({
          ...common,
          validProposal: {},
          mutation: { kind: "redirectRoot", root: "missing" },
        })
      ).ok,
    ).toBe(false);
    expect(
      applyDeterministicPlanMutation(common.validProposal, {
        kind: "redirectRoot",
        root: "missing",
      }).ok,
    ).toBe(false);
    expect(
      applyDeterministicPlanMutation(common.validProposal, {
        kind: "bypassUnaryNode",
        nodeId: "items",
      }).ok,
    ).toBe(false);
  });

  it("dispatches only eligible shared repairs and records unnecessary trials without a call", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const catalog = unwrap(
      unwrap(createM1aCatalogResolver())(benchmarkCase.case.catalogId),
    );
    const base = modelPlanProposalSchema.parse(
      modelProposal(RECORDED_DOUBLE_PLAN),
    );
    const eligible = unwrap(
      applyDeterministicPlanMutation(base, {
        kind: "bypassUnaryNode",
        nodeId: "doubled",
      }),
    );
    const repairedAdapter = createRecordedModelAdapter(
      await recordedFixture(0),
    );
    const repaired = unwrap(
      await generatePlan({
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog,
        policy: benchmarkCase.case.policy,
        semanticObligations: benchmarkCase.case.semanticObligations ?? [],
        publicExamples: [],
        adapter: repairedAdapter,
        strategy: strategy("json-schema-with-repair"),
        sharedInitialProposal: eligible,
      }),
    );
    expect(repaired.kind).toBe("compiled");
    expect(repairedAdapter.requests()).toHaveLength(1);
    expect(repairedAdapter.requests()[0]?.kind).toBe("repair");
    expect(repaired.record.repairCount).toBe(1);

    const unnecessaryAdapter = createRecordedModelAdapter(
      await recordedFixture(0),
    );
    const unnecessary = unwrap(
      await generatePlan({
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog,
        policy: benchmarkCase.case.policy,
        semanticObligations: benchmarkCase.case.semanticObligations ?? [],
        publicExamples: [],
        adapter: unnecessaryAdapter,
        strategy: strategy("json-schema-with-repair"),
        sharedInitialProposal: base,
      }),
    );
    expect(unnecessary.kind).toBe("compiled");
    expect(unnecessaryAdapter.requests()).toHaveLength(0);
    expect(unnecessary.record.attempts).toHaveLength(0);
    expect(unnecessary.record.repairCount).toBe(0);
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

    const sharedAdapter = createRecordedModelAdapter(frozen);
    const sharedInitialProposal = unwrap(
      applyDeterministicPlanMutation(
        modelPlanProposalSchema.parse(modelProposal(RECORDED_DOUBLE_PLAN)),
        { kind: "bypassUnaryNode", nodeId: "doubled" },
      ),
    );
    const shared = unwrap(
      await generatePlan({
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog: unwrap(
          unwrap(createM1aCatalogResolver())(benchmarkCase.case.catalogId),
        ),
        policy: benchmarkCase.case.policy,
        semanticObligations: benchmarkCase.case.semanticObligations ?? [],
        publicExamples: [],
        adapter: sharedAdapter,
        strategy: strategy("json-schema-with-repair"),
        sharedInitialProposal,
      }),
    );
    expect(shared.kind).toBe("rejected");
    expect(shared.record.attempts).toHaveLength(2);
    expect(shared.record.repairCount).toBe(2);
    expect(sharedAdapter.requests()).toHaveLength(2);
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
        semanticObligations: impossible.case.semanticObligations ?? [],
        publicExamples: [],
        adapter: createRecordedModelAdapter(await recordedFixture(2)),
        strategy: strategy("json-schema-with-repair"),
      }),
    );
    expect(abstained.kind).toBe("unplannable");
    expect(abstained.record.attempts[0]?.abstentionReasons).toHaveLength(0);
    expect(abstained.record.attempts[0]?.abstentionWitness).toEqual({
      kind: "deniedCapability",
      operation: { id: "quote-tax", version: "1.0.0" },
      capability: "finance.read",
    });

    const exhausted = createRecordedModelAdapter(await recordedFixture(2));
    const transport = unwrap(
      await compileStructuredOutputTransport(abstained.manifest),
    );
    await exhausted.generate({
      kind: "initial",
      originalTask: "first",
      taskInputs: impossible.case.taskInputs,
      languageManifest: abstained.manifest,
      semanticObligations: [],
      publicExamples: [],
      constraint: "json-schema",
      structuredOutputTransport: transport,
    });
    const failure = await exhausted.generate({
      kind: "initial",
      originalTask: "second",
      taskInputs: impossible.case.taskInputs,
      languageManifest: abstained.manifest,
      semanticObligations: [],
      publicExamples: [],
      constraint: "json-schema",
      structuredOutputTransport: transport,
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
  it("rejects unsupported catalog schemas before dispatch or budget reservation", async () => {
    const benchmarkCase = await corpusCase("numbers/double");
    const adapter = createRecordedModelAdapter(await recordedFixture(0));
    const method: BenchmarkMethod = {
      id: "schema",
      adapter,
      strategy: strategy("json-schema"),
    };
    const experiment = await experimentFor([benchmarkCase], [method]);
    const arbitraryMap = defineSchema({
      id: "arbitrary-map",
      version: "1.0.0",
      description: "An intentionally unsupported arbitrary map.",
      validator: z.record(z.string(), z.string()),
    });
    const unsupportedCatalog = unwrap(
      createCatalog({
        identity: { id: "benchmark.numbers", version: "1.0.0" },
        schemas: [arbitraryMap.runtime],
        operations: [],
      }),
    );
    let reservations = 0;
    const result = await runBenchmark({
      experiment,
      cases: [benchmarkCase],
      methods: [method],
      resolveCatalog: () => ({ ok: true, value: unsupportedCatalog }),
      store: createInMemoryBenchmarkStore(),
      budgetController: {
        reserve: () => {
          reservations += 1;
          return Promise.resolve({ ok: true, value: undefined });
        },
        settle: () => Promise.resolve({ ok: true, value: undefined }),
      },
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.message).toContain(
      "unsupported JSON Schema keyword propertyNames",
    );
    expect(reservations).toBe(0);
    expect(adapter.requests()).toHaveLength(0);
  });

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
    const constantProposal = modelProposal(constantPlan);
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
              structuredOutput: { kind: "plan", plan: constantProposal },
              rawResponse: JSON.stringify({
                kind: "plan",
                plan: constantProposal,
              }),
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
              structuredOutput: {
                kind: "plan",
                plan: modelProposal(effectPlan),
              },
              rawResponse: JSON.stringify({
                kind: "plan",
                plan: modelProposal(effectPlan),
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
    expect(score.semanticSuccess).toBe(true);
    expect(score.hiddenEvaluations.every((item) => item.success)).toBe(true);

    const newlyForbidden = unwrap(
      await freezePlanGenerationCase({
        ...benchmarkCase.case,
        expectedFeasibility: "unplannable",
        infeasibilityWitness: {
          kind: "deniedCapability",
          operation: { id: "quote-tax", version: "1.0.0" },
          capability: "finance.read",
        },
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
      catalog: { id: "benchmark.workflow", version: "1.1.0" },
      root: "done",
      nodes: [
        {
          id: "seed",
          op: "input",
          inputKey: "state",
          schema: { id: "workflow-state", version: "1.1.0" },
        },
        {
          id: "done",
          op: "boundedFix",
          seed: "seed",
          step: { id: "countdown-step", version: "1.1.0" },
          measure: { id: "remaining", version: "1.1.0" },
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
              structuredOutput: {
                kind: "plan",
                plan: modelProposal(recursionPlan),
              },
              rawResponse: JSON.stringify({
                kind: "plan",
                plan: modelProposal(recursionPlan),
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
        semanticObligations: impossible.case.semanticObligations ?? [],
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
        semanticObligations: impossible.case.semanticObligations ?? [],
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
              structuredOutput: {
                kind: "plan",
                plan: modelProposal(effectPlan),
              },
              rawResponse: JSON.stringify({
                kind: "plan",
                plan: modelProposal(effectPlan),
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
    ).toBe(0);
    expect(
      compared.find((gate) => gate.id === "repair-materially-improves")?.target,
    ).toContain("repair unnecessary");
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
      transportSchemas: [],
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

describe("M2 disjoint paired corpus", () => {
  const operationOrder = new Map<string, ReadonlyArray<string>>([
    ["m2/dev/numbers/nonnegative-squares", ["nonnegative", "square"]],
    ["m2/dev/numbers/add-ten-product", ["add-ten", "product"]],
    ["m2/dev/text/reverse-surround", ["reverse", "surround"]],
    ["m2/heldout/numbers/square-add-ten", ["square", "add-ten"]],
    [
      "m2/heldout/numbers/nonnegative-adjusted-product",
      ["nonnegative", "add-ten", "product"],
    ],
    ["m2/heldout/text/dashed-reversed", ["has-dash", "reverse"]],
    ["m2/heldout/text/surrounded-slash-join", ["surround", "join-slash"]],
  ]);
  const predicates = new Set(["nonnegative", "has-dash"]);
  const reducers = new Set(["product", "join-slash"]);

  function pairedWitness(
    benchmarkCase: FrozenPlanGenerationCase,
    operations: ReadonlyArray<string>,
  ): Readonly<{ plan: unknown; source: string }> {
    const input = required(
      benchmarkCase.case.taskInputs[0],
      "M2 fixture requires an items input.",
    );
    const nodes: Array<Readonly<Record<string, unknown>>> = [
      {
        id: "input",
        op: "input",
        inputKey: "items",
        schema: input.schema,
      },
    ];
    const statements: Array<string> = [];
    let prior = "input";
    let codePrior = "input.items";
    for (const [index, operation] of operations.entries()) {
      const id = `step-${index + 1}`;
      const method = predicates.has(operation)
        ? "filter"
        : reducers.has(operation)
          ? "fold"
          : "map";
      nodes.push({
        id,
        op: method,
        source: prior,
        ...(method === "filter"
          ? { predicate: { id: operation, version: "1.0.0" } }
          : method === "fold"
            ? { reducer: { id: operation, version: "1.0.0" } }
            : {
                operation: {
                  kind: "function",
                  id: operation,
                  version: "1.0.0",
                },
                outputCollectionSchema: input.schema,
                parallelism: 4,
              }),
      });
      const binding = `step${index + 1}`;
      statements.push(
        `const ${binding} = await ops.${method}("${operation}@1.0.0", ${codePrior});`,
      );
      prior = id;
      codePrior = binding;
    }
    return {
      plan: {
        formatVersion: "1",
        catalog: {
          id: benchmarkCase.case.catalogId,
          version: "1.0.0",
        },
        root: prior,
        nodes,
      },
      source: `export default async function main(input, ops) {
        ${statements.join("\n")}
        return ${codePrior};
      }`,
    };
  }

  it("uses a fresh namespace and covers every typed witness kind in both splits", async () => {
    const corpus = unwrap(await loadM2PreregisteredCorpus());
    expect(corpus.development).toHaveLength(6);
    expect(corpus.heldOut).toHaveLength(7);
    expect(
      assertM2CorpusNamespaceDisjoint([
        ...corpus.development,
        ...corpus.heldOut,
      ]).ok,
    ).toBe(true);
    const first = required(corpus.development[0], "Missing M2 case.");
    expect(
      assertM2CorpusNamespaceDisjoint([
        { ...first, case: { ...first.case, id: "legacy/reused-case" } },
      ]).ok,
    ).toBe(false);
    for (const split of [corpus.development, corpus.heldOut])
      expect(
        split
          .filter((item) => item.case.expectedFeasibility === "unplannable")
          .map((item) => item.case.infeasibilityWitness?.kind)
          .toSorted(),
      ).toEqual(
        [
          "deniedCapability",
          "insufficientBudget",
          "missingOperation",
        ].toSorted(),
      );
  });

  it("has paired offline witnesses that compile and produce identical hidden outputs", async () => {
    const corpus = unwrap(await loadM2PreregisteredCorpus());
    const resolver = unwrap(createM2CatalogResolver());
    const feasible = [...corpus.development, ...corpus.heldOut].filter(
      (item) => item.case.expectedFeasibility === "plannable",
    );
    expect(feasible).toHaveLength(7);
    for (const benchmarkCase of feasible) {
      const operations = required(
        operationOrder.get(benchmarkCase.case.id),
        `Missing paired witness for ${benchmarkCase.case.id}.`,
      );
      const catalog = unwrap(resolver(benchmarkCase.case.catalogId));
      const witness = pairedWitness(benchmarkCase, operations);
      const compiledPlan = await compileModelPlanProposal(
        witness.plan,
        catalog,
        benchmarkCase.case.policy,
        benchmarkCase.case.taskInputs,
        benchmarkCase.case.semanticObligations ?? [],
      );
      if (compiledPlan.executablePlan === undefined)
        throw new Error(
          `${benchmarkCase.case.id}: ${JSON.stringify(compiledPlan.diagnostics)}`,
        );
      const compiledCode = await compileCodeMode({
        source: witness.source,
        catalog,
        policy: benchmarkCase.case.policy,
        taskInputs: benchmarkCase.case.taskInputs,
        semanticObligations: benchmarkCase.case.semanticObligations ?? [],
      });
      expect(compiledCode.ok).toBe(true);
      if (!compiledCode.ok) continue;
      for (const evaluation of benchmarkCase.case.hiddenEvaluations) {
        const inputs = new Map(Object.entries(evaluation.inputs));
        const ir = await executePlan(compiledPlan.executablePlan, {
          inputs,
          effectHandler: () =>
            Promise.resolve({
              ok: false,
              error: {
                code: "UNDECLARED_EFFECT",
                message: "M2 witness has no effects.",
                location: {},
                details: [],
              },
            }),
          clock: { now: () => "2026-07-15T00:00:00.000Z" },
          runIdProvider: { next: () => `m2-ir/${evaluation.id}` },
        });
        const code = await executeCodeMode(compiledCode.value, {
          inputs,
          effectHandler: () =>
            Promise.resolve({
              ok: false,
              error: {
                code: "UNDECLARED_EFFECT",
                message: "M2 witness has no effects.",
                location: {},
                details: [],
              },
            }),
        });
        expect(ir.ok ? ir.value.output : ir.error).toEqual(
          evaluation.expectedOutput,
        );
        expect(code.ok ? code.value.output : code.error).toEqual(
          evaluation.expectedOutput,
        );
      }
    }
  });

  it("runs, accounts, scores, and safely resumes CodeMode records", async () => {
    const corpus = unwrap(await loadM2PreregisteredCorpus());
    const benchmarkCase = required(
      corpus.development.find(
        (item) => item.case.id === "m2/dev/numbers/nonnegative-squares",
      ),
      "Missing M2 development case.",
    );
    const witness = pairedWitness(
      benchmarkCase,
      required(
        operationOrder.get(benchmarkCase.case.id),
        "Missing operations.",
      ),
    );
    let providerCalls = 0;
    const adapter: CodeModeModelAdapter = {
      identity: {
        provider: "recorded",
        model: "m2-codemode",
        adapterVersion: "m2-codemode-test/1",
      },
      inference: {
        ...DEFAULT_INFERENCE_SETTINGS,
        maxInputTokens: 1_000,
        maxOutputTokens: 500,
      },
      pricingEntryId: "recorded/m2-codemode/1",
      preflightStructuredOutput: () =>
        Promise.resolve({ ok: true, value: undefined }),
      generate: () => {
        providerCalls += 1;
        return Promise.resolve({
          ok: true,
          value: {
            rawResponse: JSON.stringify({
              kind: "program",
              source: witness.source,
            }),
            structuredOutput: {
              outcome: { kind: "program", source: witness.source },
            },
            usage: {
              inputTokens: 100,
              outputTokens: 50,
              costUsdMicros: 150,
            },
            latencyMs: 9,
            dispatchEvidence: "dispatched-with-usage",
          },
        });
      },
    };
    const method: M2CodeModeMethod = {
      id: "recorded/codemode/schema",
      adapter,
      strategy: { constraint: "json-schema", repair: "compiler-guided" },
      pricing: {
        id: adapter.pricingEntryId,
        billingProvider: "recorded",
        route: "offline",
        model: "m2-codemode",
        inputUsdMicrosPerMillionTokens: 1_000_000,
        cachedInputUsdMicrosPerMillionTokens: 1_000_000,
        cacheWriteInputUsdMicrosPerMillionTokens: 1_000_000,
        outputUsdMicrosPerMillionTokens: 1_000_000,
        effectiveFrom: "2026-07-15",
        effectiveUntil: null,
        sourceUrl: "https://example.invalid/m2-pricing",
      },
    };
    const reservations: Array<unknown> = [];
    const settlements: Array<unknown> = [];
    const store = createInMemoryM2CodeModeStore();
    const budgetController: BenchmarkBudgetController = {
      reserve: (reservation) => {
        reservations.push(reservation);
        return Promise.resolve({ ok: true, value: undefined });
      },
      settle: (settlement) => {
        settlements.push(settlement);
        return Promise.resolve({ ok: true, value: undefined });
      },
    };
    const runInput = {
      experimentDigest: "m2-test-experiment",
      split: "development" as const,
      splitDigest: "m2-test-split",
      cases: [benchmarkCase],
      methods: [method],
      repetitions: 1,
      resolveCatalog: unwrap(createM2CatalogResolver()),
      store,
      budgetController,
    };
    const first = unwrap(await runM2CodeModeBenchmark(runInput));
    expect(first).toMatchObject({ generated: 1, resumed: 0 });
    expect(first.records[0]?.score).toMatchObject({
      parseTranspileSuccess: true,
      firstCompilationSuccess: true,
      finalCompilationSuccess: true,
      firstExecutionSuccess: true,
      finalExecutionSuccess: true,
      semanticSuccess: true,
      runtimeExceptions: 0,
      timeouts: 0,
      capabilityViolations: 0,
      repairCalls: 0,
      costUsdMicros: 150,
      staticallyAnalyzable: true,
      resources: { actualWithinPrediction: true },
    });
    expect(reservations).toHaveLength(1);
    expect(settlements).toHaveLength(1);
    expect(
      (
        await store.save({
          ...required(first.records[0], "Missing first M2 record."),
          digest: "collision",
        })
      ).ok,
    ).toBe(false);
    const resumed = unwrap(await runM2CodeModeBenchmark(runInput));
    expect(resumed).toMatchObject({ generated: 0, resumed: 1 });
    expect(providerCalls).toBe(1);
  });

  it("replays only preregistered CodeMode effects while scoring hidden evaluations", async () => {
    const benchmarkCase = unwrap(
      await freezePlanGenerationCase({
        id: "m2/test/numbers/risk-quote",
        instruction: "Obtain the required deterministic risk quote.",
        catalogId: "m2.numbers",
        policy: {
          allowedCapabilities: ["m2.risk.read"],
          budget: {
            maxEffectCalls: 1,
            maxCollectionItems: 1,
            maxRecursionDepth: 0,
            maxTokens: 80,
            maxWallClockMs: 40,
            maxParallelism: 1,
          },
        },
        taskInputs: [
          {
            name: "value",
            schema: { id: "m2-number", version: "1.0.0" },
            declaredBounds: [],
          },
        ],
        publicExamples: [],
        hiddenEvaluations: [
          {
            id: "m2/test/risk/matched",
            inputs: { value: 4 },
            effects: [
              {
                effectName: "m2.risk.quote",
                input: 4,
                output: 9,
                replayResultId: "m2/test/risk/fixture",
                usage: { tokens: 3, wallClockMs: 2 },
              },
            ],
            expectedOutput: 9,
          },
          {
            id: "m2/test/risk/missing",
            inputs: { value: 5 },
            effects: [],
            expectedOutput: 10,
          },
        ],
        expectedFeasibility: "plannable",
        infeasibilityWitness: null,
        requiredProperties: [
          { kind: "usesInput", inputKey: "value" },
          { kind: "usesEffect", name: "m2.risk.quote" },
        ],
        semanticObligations: [
          { kind: "rootDependsOnInput", inputKey: "value" },
          { kind: "requiresEffect", effectName: "m2.risk.quote" },
        ],
        forbiddenCapabilities: [],
      }),
    );
    const adapter: CodeModeModelAdapter = {
      identity: {
        provider: "recorded",
        model: "m2-effect-replay",
        adapterVersion: "m2-effect-test/1",
      },
      inference: DEFAULT_INFERENCE_SETTINGS,
      pricingEntryId: "recorded/m2-effect/1",
      preflightStructuredOutput: () =>
        Promise.resolve({ ok: true, value: undefined }),
      generate: () =>
        Promise.resolve({
          ok: true,
          value: {
            rawResponse: "offline",
            structuredOutput: {
              outcome: {
                kind: "program",
                source: `export default async function main(input, ops) {
                  const quote = await ops.effect("risk-quote@1.0.0", input.value);
                  return quote;
                }`,
              },
            },
            usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 0 },
            latencyMs: 1,
            dispatchEvidence: "dispatched-with-usage",
          },
        }),
    };
    const result = unwrap(
      await runM2CodeModeBenchmark({
        experimentDigest: "m2-effect-replay",
        split: "development",
        splitDigest: "m2-effect-replay-split",
        cases: [benchmarkCase],
        methods: [
          {
            id: "recorded/m2-effect",
            adapter,
            strategy: { constraint: "json-schema", repair: "none" },
            pricing: {
              id: adapter.pricingEntryId,
              billingProvider: "recorded",
              route: "offline",
              model: "m2-effect-replay",
              inputUsdMicrosPerMillionTokens: 0,
              cachedInputUsdMicrosPerMillionTokens: 0,
              cacheWriteInputUsdMicrosPerMillionTokens: 0,
              outputUsdMicrosPerMillionTokens: 0,
              effectiveFrom: "2026-07-15",
              effectiveUntil: null,
              sourceUrl: "https://example.invalid/m2-effect-replay",
            },
          },
        ],
        repetitions: 1,
        resolveCatalog: unwrap(createM2CatalogResolver()),
        store: createInMemoryM2CodeModeStore(),
      }),
    );
    expect(result.records[0]?.score).toMatchObject({
      firstCompilationSuccess: true,
      finalCompilationSuccess: true,
      firstExecutionSuccess: false,
      finalExecutionSuccess: false,
      semanticSuccess: false,
      runtimeExceptions: 1,
      resources: {
        actual: {
          operationCalls: 2,
          effectCalls: 2,
          tokens: 3,
          wallClockMs: 2,
        },
        actualWithinPrediction: true,
      },
    });
  });

  it("runs the preregistered IR and CodeMode arms as exact matched pairs", async () => {
    const corpus = unwrap(await loadM2PreregisteredCorpus());
    const benchmarkCase = required(
      corpus.development.find(
        (item) => item.case.id === "m2/dev/numbers/nonnegative-squares",
      ),
      "Missing paired M2 case.",
    );
    const witness = pairedWitness(
      benchmarkCase,
      required(
        operationOrder.get(benchmarkCase.case.id),
        "Missing operations.",
      ),
    );
    const fixture = unwrap(
      await freezeRecordedModelFixture({
        identity: {
          provider: "recorded",
          model: "m2-paired-model",
          adapterVersion: "ir-test/1",
        },
        pricingEntryId: "recorded/free",
        inference: DEFAULT_INFERENCE_SETTINGS,
        responses: [
          {
            kind: "response",
            response: {
              rawResponse: JSON.stringify({ kind: "plan", plan: witness.plan }),
              structuredOutput: { kind: "plan", plan: witness.plan },
              usage: { inputTokens: 10, outputTokens: 10, costUsdMicros: 0 },
              latencyMs: 2,
            },
          },
        ],
      }),
    );
    const irAdapter = createRecordedModelAdapter(fixture);
    const irMethod: BenchmarkMethod = {
      id: "recorded/functional-ir/schema-with-repair",
      adapter: irAdapter,
      strategy: strategy("json-schema-with-repair"),
    };
    const codeAdapter: CodeModeModelAdapter = {
      identity: {
        provider: "recorded",
        model: "m2-paired-model",
        adapterVersion: "codemode-test/1",
      },
      inference: DEFAULT_INFERENCE_SETTINGS,
      pricingEntryId: "recorded/free",
      preflightStructuredOutput: () =>
        Promise.resolve({ ok: true, value: undefined }),
      generate: () =>
        Promise.resolve({
          ok: true,
          value: {
            rawResponse: JSON.stringify({
              kind: "program",
              source: witness.source,
            }),
            structuredOutput: {
              outcome: { kind: "program", source: witness.source },
            },
            usage: { inputTokens: 10, outputTokens: 10, costUsdMicros: 0 },
            latencyMs: 2,
            dispatchEvidence: "dispatched-with-usage",
          },
        }),
    };
    const pricing = {
      id: "recorded/free",
      billingProvider: "recorded",
      route: "offline",
      model: "m2-paired-model",
      inputUsdMicrosPerMillionTokens: 0,
      cachedInputUsdMicrosPerMillionTokens: 0,
      cacheWriteInputUsdMicrosPerMillionTokens: 0,
      outputUsdMicrosPerMillionTokens: 0,
      effectiveFrom: "2026-07-15",
      effectiveUntil: null,
      sourceUrl: "https://example.invalid/free",
    };
    const codeMethod: M2CodeModeMethod = {
      id: "recorded/restricted-typescript/schema-with-repair",
      adapter: codeAdapter,
      strategy: { constraint: "json-schema", repair: "compiler-guided" },
      pricing,
    };
    const resolver = unwrap(createM2CatalogResolver());
    const caps: ExperimentCaps = {
      maxCalls: 4,
      maxInputTokens: 100_000,
      maxOutputTokens: 100_000,
      maxTotalTokens: 200_000,
      maxOutputTokensPerCall: 100_000,
      maxCostUsdMicros: 1_000_000,
      providerCostCaps: [
        { billingProvider: "recorded", maxCostUsdMicros: 1_000_000 },
      ],
    };
    const irExperiment = await experimentFor(
      [benchmarkCase],
      [irMethod],
      1,
      "development",
      "m2-paired-test",
      caps,
      resolver,
    );
    const experimentDigest = unwrap(
      await createM2PairedExperimentDigest({
        irExperiment,
        cases: [benchmarkCase],
        repetitions: 1,
        codeModeMethods: [codeMethod],
      }),
    );
    const pairedBudget: BenchmarkBudgetController = {
      reserve: () => Promise.resolve({ ok: true, value: undefined }),
      settle: () => Promise.resolve({ ok: true, value: undefined }),
    };
    const pairedInput = {
      experimentDigest,
      irExperiment,
      split: "development" as const,
      splitDigest: required(
        irExperiment.splits.find((item) => item.id === "development"),
        "Missing development split.",
      ).digest,
      cases: [benchmarkCase],
      repetitions: 1,
      irMethods: [irMethod],
      codeModeMethods: [codeMethod],
      resolveCatalog: resolver,
      irStore: createInMemoryBenchmarkStore(),
      codeModeStore: createInMemoryM2CodeModeStore(),
      budgetController: pairedBudget,
    };
    const paired = unwrap(await runM2PairedBenchmark(pairedInput));
    expect(paired.matched).toHaveLength(1);
    expect(paired.matched[0]).toMatchObject({
      provider: "recorded",
      model: "m2-paired-model",
      functionalIr: {
        firstCompilationSuccess: true,
        finalExecutionSuccess: true,
        semanticSuccess: true,
        staticallyAnalyzable: true,
        predictedActualReconciled: true,
      },
      codeMode: {
        firstCompilationSuccess: true,
        finalExecutionSuccess: true,
        semanticSuccess: true,
        staticallyAnalyzable: true,
        resources: { actualWithinPrediction: true },
      },
    });
    expect(
      (
        await runM2PairedBenchmark({
          ...pairedInput,
          experimentDigest: "wrong-m2-digest",
        })
      ).ok,
    ).toBe(false);
    const emptyDigest = unwrap(
      await createM2PairedExperimentDigest({
        irExperiment,
        cases: [benchmarkCase],
        repetitions: 1,
        codeModeMethods: [],
      }),
    );
    expect(
      (
        await runM2PairedBenchmark({
          ...pairedInput,
          experimentDigest: emptyDigest,
          codeModeMethods: [],
        })
      ).ok,
    ).toBe(false);
  });

  it("scores typed abstention and fails closed across reservation and unknown-usage paths", async () => {
    const corpus = unwrap(await loadM2PreregisteredCorpus());
    const resolver = unwrap(createM2CatalogResolver());
    const impossible = required(
      corpus.development.find(
        (item) => item.case.id === "m2/dev/numbers/missing-median",
      ),
      "Missing M2 abstention case.",
    );
    const feasible = required(
      corpus.development.find(
        (item) => item.case.id === "m2/dev/numbers/nonnegative-squares",
      ),
      "Missing M2 feasible case.",
    );
    const pricing = {
      id: "recorded/m2/failure-paths",
      billingProvider: "recorded",
      route: "offline",
      model: "m2-failure-paths",
      inputUsdMicrosPerMillionTokens: 1_000_000,
      cachedInputUsdMicrosPerMillionTokens: 1_000_000,
      cacheWriteInputUsdMicrosPerMillionTokens: 1_000_000,
      outputUsdMicrosPerMillionTokens: 1_000_000,
      effectiveFrom: "2026-07-15",
      effectiveUntil: null,
      sourceUrl: "https://example.invalid/m2-failure-paths",
    };
    const adapterBase = {
      identity: {
        provider: "recorded",
        model: "m2-failure-paths",
        adapterVersion: "m2-test/1",
      },
      inference: {
        ...DEFAULT_INFERENCE_SETTINGS,
        maxInputTokens: 100,
        maxOutputTokens: 100,
      },
      pricingEntryId: pricing.id,
      preflightStructuredOutput: () =>
        Promise.resolve({ ok: true as const, value: undefined }),
    };
    const witness = impossible.case.infeasibilityWitness;
    if (witness === null) throw new Error("Missing M2 witness.");
    const abstaining: CodeModeModelAdapter = {
      ...adapterBase,
      generate: () =>
        Promise.resolve({
          ok: true,
          value: {
            rawResponse: JSON.stringify({ kind: "unplannable", witness }),
            structuredOutput: { outcome: { kind: "unplannable", witness } },
            usage: { inputTokens: 2, outputTokens: 2, costUsdMicros: 4 },
            latencyMs: 3,
            dispatchEvidence: "dispatched-with-usage",
          },
        }),
    };
    const abstentionMethod: M2CodeModeMethod = {
      id: "recorded/m2/abstention",
      adapter: abstaining,
      strategy: { constraint: "json-schema", repair: "compiler-guided" },
      pricing,
    };
    const abstention = unwrap(
      await runM2CodeModeBenchmark({
        experimentDigest: "m2-abstention",
        split: "development",
        splitDigest: "m2-development",
        cases: [impossible],
        methods: [abstentionMethod],
        repetitions: 1,
        resolveCatalog: resolver,
        store: createInMemoryM2CodeModeStore(),
      }),
    );
    expect(abstention.records[0]?.score).toMatchObject({
      correctTypedAbstention: true,
      semanticSuccess: null,
      finalExecutionSuccess: null,
    });

    let forbiddenDispatches = 0;
    const dispatching: CodeModeModelAdapter = {
      ...adapterBase,
      generate: () => {
        forbiddenDispatches += 1;
        return Promise.resolve({
          ok: false,
          error: {
            code: "PROVIDER_FAILURE",
            message: "must not dispatch",
            dispatchEvidence: "not-dispatched",
          },
        });
      },
    };
    const deniedController: BenchmarkBudgetController = {
      reserve: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "BUDGET_EXCEEDED",
            message: "offline denial",
            location: {},
            details: [],
          },
        }),
      settle: () => Promise.resolve({ ok: true, value: undefined }),
    };
    const denied = unwrap(
      await runM2CodeModeBenchmark({
        experimentDigest: "m2-denied",
        split: "development",
        splitDigest: "m2-development",
        cases: [feasible],
        methods: [
          {
            id: "recorded/m2/denied",
            adapter: dispatching,
            strategy: { constraint: "json-schema", repair: "compiler-guided" },
            pricing,
          },
        ],
        repetitions: 1,
        resolveCatalog: resolver,
        store: createInMemoryM2CodeModeStore(),
        budgetController: deniedController,
      }),
    );
    expect(denied.records[0]?.score.finalCompilationSuccess).toBe(false);
    expect(forbiddenDispatches).toBe(0);

    const settlements: Array<unknown> = [];
    const unknownUsage: CodeModeModelAdapter = {
      ...adapterBase,
      generate: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "PROVIDER_FAILURE",
            message: "usage unavailable",
            dispatchEvidence: "dispatched-usage-unknown",
          },
        }),
    };
    const conservativeController: BenchmarkBudgetController = {
      reserve: () => Promise.resolve({ ok: true, value: undefined }),
      settle: (value) => {
        settlements.push(value);
        return Promise.resolve({ ok: true, value: undefined });
      },
    };
    unwrap(
      await runM2CodeModeBenchmark({
        experimentDigest: "m2-conservative",
        split: "development",
        splitDigest: "m2-development",
        cases: [feasible],
        methods: [
          {
            id: "recorded/m2/conservative",
            adapter: unknownUsage,
            strategy: { constraint: "json-schema", repair: "compiler-guided" },
            pricing,
          },
        ],
        repetitions: 1,
        resolveCatalog: resolver,
        store: createInMemoryM2CodeModeStore(),
        budgetController: conservativeController,
      }),
    );
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      conservative: true,
      accountingBasis: "authorized-conservative",
      actualCostUsdMicros: 200,
    });
    const observedSettlements: Array<unknown> = [];
    const observedController: BenchmarkBudgetController = {
      reserve: () => Promise.resolve({ ok: true, value: undefined }),
      settle: (value) => {
        observedSettlements.push(value);
        return Promise.resolve({ ok: true, value: undefined });
      },
    };
    const failureAdapters: ReadonlyArray<CodeModeModelAdapter> = [
      {
        ...adapterBase,
        generate: () =>
          Promise.resolve({
            ok: false,
            error: {
              code: "PROVIDER_FAILURE",
              message: "offline pre-dispatch failure",
              dispatchEvidence: "not-dispatched",
            },
          }),
      },
      {
        ...adapterBase,
        generate: () =>
          Promise.resolve({
            ok: false,
            error: {
              code: "PROVIDER_FAILURE",
              message: "offline post-dispatch failure",
              dispatchEvidence: "dispatched-with-usage",
              usage: { inputTokens: 7, outputTokens: 3, costUsdMicros: 10 },
            },
          }),
      },
    ];
    for (const [index, adapter] of failureAdapters.entries())
      unwrap(
        await runM2CodeModeBenchmark({
          experimentDigest: `m2-observed-failure-${index}`,
          split: "development",
          splitDigest: "m2-development",
          cases: [feasible],
          methods: [
            {
              id: `recorded/m2/observed-failure-${index}`,
              adapter,
              strategy: { constraint: "json-schema", repair: "none" },
              pricing,
            },
          ],
          repetitions: 1,
          resolveCatalog: resolver,
          store: createInMemoryM2CodeModeStore(),
          budgetController: observedController,
        }),
      );
    expect(observedSettlements).toEqual([
      expect.objectContaining({
        accountingBasis: "not-dispatched",
        actualCostUsdMicros: 0,
        conservative: false,
      }),
      expect.objectContaining({
        accountingBasis: "provider-reported",
        actualCostUsdMicros: 10,
        conservative: false,
      }),
    ]);
    expect(
      observedSettlements.some(
        (value) =>
          typeof value === "object" && value !== null && "result" in value,
      ),
    ).toBe(false);
    unwrap(
      await runM2CodeModeBenchmark({
        experimentDigest: "m2-invalid-token-cap",
        split: "development",
        splitDigest: "m2-development",
        cases: [feasible],
        methods: [
          {
            id: "recorded/m2/invalid-token-cap",
            adapter: {
              ...abstaining,
              inference: { ...abstaining.inference, maxInputTokens: -1 },
            },
            strategy: { constraint: "json-schema", repair: "none" },
            pricing,
          },
        ],
        repetitions: 1,
        resolveCatalog: resolver,
        store: createInMemoryM2CodeModeStore(),
      }),
    );
    const storageError = {
      code: "INTERNAL_INVARIANT_VIOLATION" as const,
      message: "offline store failure",
      location: {},
      details: [],
    };
    expect(
      (
        await runM2CodeModeBenchmark({
          experimentDigest: "m2-catalog-error",
          split: "development",
          splitDigest: "m2-development",
          cases: [impossible],
          methods: [abstentionMethod],
          repetitions: 1,
          resolveCatalog: () => ({
            ok: false,
            error: storageError,
          }),
          store: createInMemoryM2CodeModeStore(),
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await runM2CodeModeBenchmark({
          experimentDigest: "m2-load-error",
          split: "development",
          splitDigest: "m2-development",
          cases: [impossible],
          methods: [abstentionMethod],
          repetitions: 1,
          resolveCatalog: resolver,
          store: {
            load: () => Promise.resolve({ ok: false, error: storageError }),
            save: () => Promise.resolve({ ok: true, value: undefined }),
          },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await runM2CodeModeBenchmark({
          experimentDigest: "m2-save-error",
          split: "development",
          splitDigest: "m2-development",
          cases: [impossible],
          methods: [abstentionMethod],
          repetitions: 1,
          resolveCatalog: resolver,
          store: {
            load: () => Promise.resolve({ ok: true, value: undefined }),
            save: () => Promise.resolve({ ok: false, error: storageError }),
          },
        })
      ).ok,
    ).toBe(false);
  });
});

describe("restricted TypeScript CodeMode", () => {
  const policy = {
    allowedCapabilities: [] as ReadonlyArray<string>,
    budget: {
      maxEffectCalls: 4,
      maxCollectionItems: 128,
      maxRecursionDepth: 16,
      maxTokens: 1_000,
      maxWallClockMs: 1_000,
      maxParallelism: 1,
    },
  };
  const taskInputs = [
    {
      name: "items",
      schema: { id: "numbers", version: "1.0.0" },
      declaredBounds: [{ kind: "maximumCollectionItems" as const, value: 128 }],
    },
  ];

  it("compiles and interprets a closed capability-only TypeScript program", async () => {
    const catalog = unwrap(
      unwrap(createM1aCatalogResolver())("benchmark.numbers"),
    );
    const compiled = await compileCodeMode({
      source: `
        export default async function main(
          input: Readonly<{ items: ReadonlyArray<number> }>,
          ops: Operations,
        ): Promise<unknown> {
          const evens = await ops.filter("even@1.0.0", input.items);
          const doubled = await ops.map("double@1.0.0", evens);
          return doubled;
        }
      `,
      catalog,
      policy,
      taskInputs,
      semanticObligations: [
        { kind: "rootDependsOnInput", inputKey: "items" },
        {
          kind: "requiresOperation",
          operation: { id: "even", version: "1.0.0" },
        },
        {
          kind: "requiresOperation",
          operation: { id: "double", version: "1.0.0" },
        },
        { kind: "requiresStateChange" },
      ],
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const summary = inspectCodeModeArtifact(compiled.value);
    expect(summary).toMatchObject({
      protocol: CODEMODE_PROTOCOL,
      analysis: {
        maximumOperationCalls: 256,
        predictedResourcesKnown: true,
        inputDependencies: ["items"],
        operationDependencies: ["double@1.0.0", "even@1.0.0"],
      },
    });
    const executed = await executeCodeMode(compiled.value, {
      inputs: new Map([["items", [-3, 2, 5, 4]]]),
      effectHandler: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "UNDECLARED_EFFECT",
            message: "not used",
            location: {},
            details: [],
          },
        }),
    });
    expect(executed).toMatchObject({
      ok: true,
      value: {
        output: [4, 8],
        usage: { operationCalls: 6, effectCalls: 0 },
      },
    });
    const invalidInput = await executeCodeMode(compiled.value, {
      inputs: new Map([["items", "not-an-array"]]),
      effectHandler: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "UNDECLARED_EFFECT",
            message: "unused",
            location: {},
            details: [],
          },
        }),
    });
    expect(invalidInput.ok ? null : invalidInput.error.kind).toBe(
      "runtime-exception",
    );
  });

  it("executes select, invoke, and boundedFix without ambient JavaScript", async () => {
    const resolver = unwrap(createM1aCatalogResolver());
    const decisions = unwrap(resolver("benchmark.decisions"));
    const decisionProgram = await compileCodeMode({
      source: `export default async function main(input, ops) {
        const selected = await ops.select(input.condition, input.primary, input.fallback);
        const approved = await ops.invoke("approve-label@1.0.0", selected);
        return approved;
      }`,
      catalog: decisions,
      policy,
      taskInputs: [
        {
          name: "condition",
          schema: { id: "boolean", version: "1.0.0" },
          declaredBounds: [],
        },
        {
          name: "primary",
          schema: { id: "label", version: "1.0.0" },
          declaredBounds: [],
        },
        {
          name: "fallback",
          schema: { id: "label", version: "1.0.0" },
          declaredBounds: [],
        },
      ],
      semanticObligations: [
        { kind: "rootDependsOnInput", inputKey: "condition" },
        {
          kind: "operationDominatesRoot",
          operation: { id: "approve-label", version: "1.0.0" },
        },
      ],
    });
    expect(decisionProgram.ok).toBe(true);
    if (!decisionProgram.ok) return;
    const decision = await executeCodeMode(decisionProgram.value, {
      inputs: new Map<string, unknown>([
        ["condition", false],
        ["primary", "north"],
        ["fallback", "south"],
      ]),
      effectHandler: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "UNDECLARED_EFFECT",
            message: "unused",
            location: {},
            details: [],
          },
        }),
    });
    expect(decision.ok ? decision.value.output : null).toBe("approved:south");
    const invalidConditionProgram = await compileCodeMode({
      source: `export default async function main(input, ops) {
        const selected = await ops.select(input.primary, input.primary, input.fallback);
        return selected;
      }`,
      catalog: decisions,
      policy,
      taskInputs: [
        {
          name: "primary",
          schema: { id: "label", version: "1.0.0" },
          declaredBounds: [],
        },
        {
          name: "fallback",
          schema: { id: "label", version: "1.0.0" },
          declaredBounds: [],
        },
      ],
      semanticObligations: [],
    });
    expect(invalidConditionProgram.ok).toBe(true);
    if (!invalidConditionProgram.ok) return;
    const invalidCondition = await executeCodeMode(
      invalidConditionProgram.value,
      {
        inputs: new Map([
          ["primary", "north"],
          ["fallback", "south"],
        ]),
        effectHandler: () =>
          Promise.resolve({
            ok: false,
            error: {
              code: "UNDECLARED_EFFECT",
              message: "unused",
              location: {},
              details: [],
            },
          }),
      },
    );
    expect(invalidCondition.ok ? null : invalidCondition.error.kind).toBe(
      "runtime-exception",
    );

    const workflow = unwrap(resolver("benchmark.workflow"));
    const workflowProgram = await compileCodeMode({
      source: `export default async function main(input, ops) {
        const completed = await ops.boundedFix("countdown-step@1.1.0", "remaining@1.1.0", input.state, 16);
        return completed;
      }`,
      catalog: workflow,
      policy,
      taskInputs: [
        {
          name: "state",
          schema: { id: "workflow-state", version: "1.1.0" },
          declaredBounds: [],
        },
      ],
      semanticObligations: [
        {
          kind: "requiresOperation",
          operation: { id: "countdown-step", version: "1.1.0" },
        },
      ],
    });
    expect(workflowProgram.ok).toBe(true);
    if (!workflowProgram.ok) return;
    const completed = await executeCodeMode(workflowProgram.value, {
      inputs: new Map([["state", { remaining: 3, value: 7 }]]),
      effectHandler: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "UNDECLARED_EFFECT",
            message: "unused",
            location: {},
            details: [],
          },
        }),
    });
    expect(completed.ok ? completed.value.output : null).toEqual({
      remaining: 0,
      value: 10,
    });
    const shortProgram = await compileCodeMode({
      source: `export default async function main(input, ops) {
        const completed = await ops.boundedFix("countdown-step@1.1.0", "remaining@1.1.0", input.state, 1);
        return completed;
      }`,
      catalog: workflow,
      policy,
      taskInputs: [
        {
          name: "state",
          schema: { id: "workflow-state", version: "1.1.0" },
          declaredBounds: [],
        },
      ],
      semanticObligations: [],
    });
    expect(shortProgram.ok).toBe(true);
    if (!shortProgram.ok) return;
    const exhausted = await executeCodeMode(shortProgram.value, {
      inputs: new Map([["state", { remaining: 3, value: 7 }]]),
      effectHandler: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "UNDECLARED_EFFECT",
            message: "unused",
            location: {},
            details: [],
          },
        }),
    });
    expect(exhausted.ok ? null : exhausted.error.kind).toBe("budget-violation");
    const alreadyComplete = await executeCodeMode(shortProgram.value, {
      inputs: new Map([["state", { remaining: 0, value: 7 }]]),
      effectHandler: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "UNDECLARED_EFFECT",
            message: "unused",
            location: {},
            details: [],
          },
        }),
    });
    expect(alreadyComplete.ok ? alreadyComplete.value.output : null).toEqual({
      remaining: 0,
      value: 7,
    });

    const stalledState = defineSchema({
      id: "stalled-state",
      version: "1",
      description: "Offline non-progressing state.",
      validator: z.strictObject({ remaining: z.number().int().nonnegative() }),
    });
    const stalledCatalog = unwrap(
      createCatalog({
        identity: { id: "test.stalled", version: "1" },
        schemas: [stalledState.runtime],
        operations: [
          defineFixedPointStep({
            id: "stall",
            version: "1",
            description: "Return the same state.",
            state: stalledState,
            implementation: (state) => state,
          }),
          defineMeasure({
            id: "remaining",
            version: "1",
            description: "Read remaining work.",
            input: stalledState,
            implementation: (state) => state.remaining,
          }),
        ],
      }),
    );
    const stalledProgram = await compileCodeMode({
      source: `export default async function main(input, ops) {
        const result = await ops.boundedFix("stall@1", "remaining@1", input.state, 1);
        return result;
      }`,
      catalog: stalledCatalog,
      policy,
      taskInputs: [
        {
          name: "state",
          schema: { id: "stalled-state", version: "1" },
          declaredBounds: [],
        },
      ],
      semanticObligations: [],
    });
    expect(stalledProgram.ok).toBe(true);
    if (!stalledProgram.ok) return;
    const stalled = await executeCodeMode(stalledProgram.value, {
      inputs: new Map([["state", { remaining: 2 }]]),
      effectHandler: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "UNDECLARED_EFFECT",
            message: "unused",
            location: {},
            details: [],
          },
        }),
    });
    expect(stalled.ok ? null : stalled.error.diagnostics[0]?.code).toBe(
      "NON_DECREASING_RECURSION_MEASURE",
    );
  });

  it.each([
    [
      "program directives",
      `"use strict"; export default async function main(input, ops) { return input.items; }`,
    ],
    [
      "function directives",
      `export default async function main(input, ops) { "use strict"; return input.items; }`,
    ],
    [
      "imports",
      `import fs from "node:fs"; export default async function main(input, ops) { return input.items; }`,
    ],
    [
      "network",
      `export default async function main(input, ops) { const x = await fetch("https://example.com"); return x; }`,
    ],
    [
      "environment",
      `export default async function main(input, ops) { return process.env.SECRET; }`,
    ],
    [
      "ambient global",
      `export default async function main(input, ops) { return globalThis; }`,
    ],
    [
      "dynamic code",
      `export default async function main(input, ops) { return Function("return 1")(); }`,
    ],
    [
      "loop",
      `export default async function main(input, ops) { while (true) {} return input.items; }`,
    ],
    [
      "unregistered method",
      `export default async function main(input, ops) { const x = await ops.network("x@1", input.items); return x; }`,
    ],
  ])("rejects %s before runtime", async (_name, source) => {
    const catalog = unwrap(
      unwrap(createM1aCatalogResolver())("benchmark.numbers"),
    );
    const compiled = await compileCodeMode({
      source,
      catalog,
      policy,
      taskInputs,
      semanticObligations: [],
    });
    expect(compiled.ok).toBe(false);
  });

  it.each([
    ["empty module", ``],
    [
      "ordinary function",
      `async function main(input, ops) { return input.items; }`,
    ],
    [
      "non-async entry",
      `export default function main(input, ops) { return input.items; }`,
    ],
    [
      "wrong entry name",
      `export default async function run(input, ops) { return input.items; }`,
    ],
    [
      "wrong parameters",
      `export default async function main(value) { return value; }`,
    ],
    [
      "generator entry",
      `export default async function* main(input, ops) { return input.items; }`,
    ],
    [
      "let binding",
      `export default async function main(input, ops) { let value = input.items; return value; }`,
    ],
    [
      "multiple declarators",
      `export default async function main(input, ops) { const a = input.items, b = input.items; return a; }`,
    ],
    [
      "destructuring",
      `export default async function main(input, ops) { const { value } = input; return value; }`,
    ],
    [
      "missing initializer",
      `export default async function main(input, ops) { const value; return input.items; }`,
    ],
    [
      "unawaited capability",
      `export default async function main(input, ops) { const value = ops.map("double@1.0.0", input.items); return value; }`,
    ],
    [
      "indirect capability",
      `export default async function main(input, ops) { const value = await other.map("double@1.0.0", input.items); return value; }`,
    ],
    [
      "computed capability",
      `export default async function main(input, ops) { const value = await ops["map"]("double@1.0.0", input.items); return value; }`,
    ],
    [
      "wrong map arity",
      `export default async function main(input, ops) { const value = await ops.map("double@1.0.0"); return value; }`,
    ],
    [
      "spread argument",
      `export default async function main(input, ops) { const value = await ops.map(...input.items); return value; }`,
    ],
    [
      "bad reference",
      `export default async function main(input, ops) { const value = await ops.map("double", input.items); return value; }`,
    ],
    [
      "computed input",
      `export default async function main(input, ops) { const value = await ops.map("double@1.0.0", input["items"]); return value; }`,
    ],
    [
      "unknown binding",
      `export default async function main(input, ops) { const value = await ops.map("double@1.0.0", absent); return value; }`,
    ],
    [
      "duplicate binding",
      `export default async function main(input, ops) { const value = await ops.map("double@1.0.0", input.items); const value = await ops.map("double@1.0.0", input.items); return value; }`,
    ],
    [
      "reserved binding",
      `export default async function main(input, ops) { const input = await ops.map("double@1.0.0", input.items); return input; }`,
    ],
    [
      "return before end",
      `export default async function main(input, ops) { return input.items; const value = await ops.map("double@1.0.0", input.items); }`,
    ],
    [
      "no return",
      `export default async function main(input, ops) { const value = await ops.map("double@1.0.0", input.items); }`,
    ],
    [
      "select arity",
      `export default async function main(input, ops) { const value = await ops.select(input.items, input.items); return value; }`,
    ],
    [
      "bounded arity",
      `export default async function main(input, ops) { const value = await ops.boundedFix("a@1", "b@1", input.items); return value; }`,
    ],
    [
      "bounded negative",
      `export default async function main(input, ops) { const value = await ops.boundedFix("a@1", "b@1", input.items, -1); return value; }`,
    ],
    [
      "unknown operation",
      `export default async function main(input, ops) { const value = await ops.map("missing@1", input.items); return value; }`,
    ],
    [
      "map kind mismatch",
      `export default async function main(input, ops) { const value = await ops.map("even@1.0.0", input.items); return value; }`,
    ],
    [
      "filter kind mismatch",
      `export default async function main(input, ops) { const value = await ops.filter("double@1.0.0", input.items); return value; }`,
    ],
    [
      "fold kind mismatch",
      `export default async function main(input, ops) { const value = await ops.fold("double@1.0.0", input.items); return value; }`,
    ],
    [
      "effect kind mismatch",
      `export default async function main(input, ops) { const value = await ops.effect("double@1.0.0", input.items); return value; }`,
    ],
    [
      "invoke kind mismatch",
      `export default async function main(input, ops) { const value = await ops.invoke("sum@1.0.0", input.items); return value; }`,
    ],
  ])("rejects restricted grammar case: %s", async (_name, source) => {
    const catalog = unwrap(
      unwrap(createM1aCatalogResolver())("benchmark.numbers"),
    );
    expect(
      (
        await compileCodeMode({
          source,
          catalog,
          policy,
          taskInputs,
          semanticObligations: [],
        })
      ).ok,
    ).toBe(false);
  });

  it("rejects dead work and failed trusted obligations statically", async () => {
    const catalog = unwrap(
      unwrap(createM1aCatalogResolver())("benchmark.numbers"),
    );
    const dead = await compileCodeMode({
      source: `export default async function main(input, ops) {
        const ignored = await ops.map("double@1.0.0", input.items);
        return input.items;
      }`,
      catalog,
      policy,
      taskInputs,
      semanticObligations: [],
    });
    expect(dead.ok ? [] : dead.error.map((item) => item.message)).toContain(
      "Restricted CodeMode: binding ignored does not contribute to the return value",
    );
    const obligation = await compileCodeMode({
      source: `export default async function main(input, ops) { return input.items; }`,
      catalog,
      policy,
      taskInputs,
      semanticObligations: [
        {
          kind: "requiresOperation",
          operation: { id: "double", version: "1.0.0" },
        },
      ],
    });
    expect(
      obligation.ok ? [] : obligation.error.map((item) => item.code),
    ).toContain("SEMANTIC_OBLIGATION_FAILED");
  });

  it("enforces capability policy before an effect can dispatch", async () => {
    const catalog = unwrap(
      unwrap(createM1aCatalogResolver())("benchmark.numbers"),
    );
    let dispatches = 0;
    const compiled = await compileCodeMode({
      source: `export default async function main(input, ops) {
        const quoted = await ops.effect("quote-tax@1.0.0", input.value);
        return quoted;
      }`,
      catalog,
      policy,
      taskInputs: [
        {
          name: "value",
          schema: { id: "number", version: "1.0.0" },
          declaredBounds: [],
        },
      ],
      semanticObligations: [],
    });
    expect(compiled.ok).toBe(false);
    if (compiled.ok) {
      await executeCodeMode(compiled.value, {
        inputs: new Map([["value", 1]]),
        effectHandler: () => {
          dispatches += 1;
          return Promise.resolve({
            ok: true,
            value: { value: 1, usage: { tokens: 0, wallClockMs: 0 } },
          });
        },
      });
    }
    expect(dispatches).toBe(0);
  });

  it("validates effect outputs, actual budgets, and hard timeouts in the closed runtime", async () => {
    const catalog = unwrap(unwrap(createM2CatalogResolver())("m2.numbers"));
    const effectPolicy = {
      allowedCapabilities: ["m2.risk.read"],
      budget: {
        maxEffectCalls: 1,
        maxCollectionItems: 1,
        maxRecursionDepth: 0,
        maxTokens: 80,
        maxWallClockMs: 40,
        maxParallelism: 1,
      },
    };
    const compiled = await compileCodeMode({
      source: `export default async function main(input, ops) {
        const quote = await ops.effect("risk-quote@1.0.0", input.value);
        return quote;
      }`,
      catalog,
      policy: effectPolicy,
      taskInputs: [
        {
          name: "value",
          schema: { id: "m2-number", version: "1.0.0" },
          declaredBounds: [],
        },
      ],
      semanticObligations: [
        { kind: "requiresEffect", effectName: "m2.risk.quote" },
      ],
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const invalidOutput = await executeCodeMode(compiled.value, {
      inputs: new Map([["value", 4]]),
      effectHandler: () =>
        Promise.resolve({
          ok: true,
          value: {
            value: "not-a-number",
            usage: { tokens: 1, wallClockMs: 1 },
          },
        }),
    });
    expect(invalidOutput.ok ? null : invalidOutput.error.kind).toBe(
      "runtime-exception",
    );
    const failedEffect = await executeCodeMode(compiled.value, {
      inputs: new Map([["value", 4]]),
      effectHandler: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "MISSING_REPLAY_RESULT",
            message: "offline effect failure",
            location: {},
            details: [],
          },
        }),
    });
    expect(failedEffect.ok ? null : failedEffect.error.kind).toBe(
      "runtime-exception",
    );
    const budget = await executeCodeMode(compiled.value, {
      inputs: new Map([["value", 4]]),
      effectHandler: () =>
        Promise.resolve({
          ok: true,
          value: { value: 4, usage: { tokens: 81, wallClockMs: 1 } },
        }),
    });
    expect(budget.ok ? null : budget.error.kind).toBe("budget-violation");
    const timedOut = await executeCodeMode(compiled.value, {
      inputs: new Map([["value", 4]]),
      timeoutMs: 1,
      effectHandler: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              value: { value: 4, usage: { tokens: 1, wallClockMs: 1 } },
            });
          }, 10);
        }),
    });
    expect(timedOut.ok ? null : timedOut.error.kind).toBe("timeout");
  });

  it("compiles a portable root-object provider schema for programs and all witness kinds", async () => {
    const catalog = unwrap(
      unwrap(createM1aCatalogResolver())("benchmark.numbers"),
    );
    const manifest = unwrap(await createPlanLanguageManifest(catalog, policy));
    const transport = unwrap(
      await compileCodeModeStructuredOutputTransport(manifest, [
        {
          kind: "requiresOperation",
          operation: { id: "missing-product", version: "1.0.0" },
        },
      ]),
    );
    expect(
      validatePortableStructuredOutputSchema(transport.jsonSchema).ok,
    ).toBe(true);
    expect(JSON.stringify(transport.jsonSchema)).toContain("missing-product");
    expect(JSON.stringify(transport.jsonSchema)).toContain(
      "insufficientBudget",
    );
    expect(JSON.stringify(transport.jsonSchema)).not.toContain("propertyNames");
  });

  it("repairs one shared CodeMode proposal without exposing hidden evaluation data", async () => {
    const catalog = unwrap(
      unwrap(createM1aCatalogResolver())("benchmark.numbers"),
    );
    const captured: Array<CodeModeModelRequest> = [];
    const sources = [
      `export default async function main(input, ops) { return input.items; }`,
      `export default async function main(input, ops) {
        const doubled = await ops.map("double@1.0.0", input.items);
        return doubled;
      }`,
    ];
    const adapter: CodeModeModelAdapter = {
      identity: {
        provider: "recorded",
        model: "codemode-fixture",
        adapterVersion: "codemode-test/1",
      },
      inference: DEFAULT_INFERENCE_SETTINGS,
      pricingEntryId: "recorded/codemode/1",
      preflightStructuredOutput: () =>
        Promise.resolve({ ok: true, value: undefined }),
      generate: (request) => {
        captured.push(request);
        const source = required(
          sources[captured.length - 1],
          "Missing CodeMode response source.",
        );
        return Promise.resolve({
          ok: true,
          value: {
            rawResponse: JSON.stringify({ kind: "program", source }),
            structuredOutput: { outcome: { kind: "program", source } },
            usage: {
              inputTokens: 10,
              outputTokens: 10,
              costUsdMicros: 20,
            },
            latencyMs: 5,
            dispatchEvidence: "dispatched-with-usage",
          },
        });
      },
    };
    const generated = unwrap(
      await generateCodeMode({
        task: "Double every public item.",
        catalog,
        policy,
        taskInputs,
        semanticObligations: [
          { kind: "rootDependsOnInput", inputKey: "items" },
          {
            kind: "requiresOperation",
            operation: { id: "double", version: "1.0.0" },
          },
        ],
        adapter,
        strategy: {
          constraint: "json-schema",
          repair: "compiler-guided",
        },
      }),
    );
    expect(generated.kind).toBe("compiled");
    expect(generated.record.repairCount).toBe(1);
    expect(
      generated.record.attempts.map((attempt) => attempt.responseKind),
    ).toEqual(["program", "program"]);
    expect(captured).toHaveLength(2);
    const initial = JSON.stringify(captured[0]);
    const repair = JSON.stringify(captured[1]);
    expect(initial).not.toContain("expectedOutput");
    expect(repair).not.toContain("expectedOutput");
    expect(initial).not.toContain("SECRET-HIDDEN-VALUE");
    expect(repair).not.toContain("SECRET-HIDDEN-VALUE");
    expect(repair).toContain("SEMANTIC_OBLIGATION_FAILED");
  });

  it("records typed abstention, invalid output, adapter failure, and preflight failure distinctly", async () => {
    const corpus = unwrap(await loadM2PreregisteredCorpus());
    const impossible = required(
      corpus.development.find(
        (item) => item.case.id === "m2/dev/numbers/missing-median",
      ),
      "Missing M2 impossible case.",
    );
    const catalog = unwrap(
      unwrap(createM2CatalogResolver())(impossible.case.catalogId),
    );
    const base = {
      identity: {
        provider: "recorded",
        model: "codemode-outcomes",
        adapterVersion: "codemode-test/1",
      },
      inference: DEFAULT_INFERENCE_SETTINGS,
      pricingEntryId: "recorded/codemode/outcomes",
      preflightStructuredOutput: () =>
        Promise.resolve({ ok: true as const, value: undefined }),
    };
    const witness = impossible.case.infeasibilityWitness;
    if (witness === null) throw new Error("Missing infeasibility witness.");
    const abstaining: CodeModeModelAdapter = {
      ...base,
      generate: () =>
        Promise.resolve({
          ok: true,
          value: {
            rawResponse: JSON.stringify({ kind: "unplannable", witness }),
            structuredOutput: { outcome: { kind: "unplannable", witness } },
            usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 0 },
            latencyMs: 1,
            dispatchEvidence: "dispatched-with-usage",
          },
        }),
    };
    const common = {
      task: impossible.case.instruction,
      catalog,
      policy: impossible.case.policy,
      taskInputs: impossible.case.taskInputs,
      semanticObligations: impossible.case.semanticObligations ?? [],
      strategy: { constraint: "json-schema" as const, repair: "none" as const },
    };
    const abstained = unwrap(
      await generateCodeMode({ ...common, adapter: abstaining }),
    );
    expect(abstained.kind).toBe("unplannable");

    const invalid: CodeModeModelAdapter = {
      ...base,
      generate: () =>
        Promise.resolve({
          ok: true,
          value: {
            rawResponse: "{}",
            structuredOutput: {},
            usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 0 },
            latencyMs: 1,
            dispatchEvidence: "dispatched-with-usage",
          },
        }),
    };
    const rejected = unwrap(
      await generateCodeMode({ ...common, adapter: invalid }),
    );
    expect(rejected.kind).toBe("rejected");
    expect(rejected.record.attempts[0]?.responseKind).toBe("invalid-output");

    const failing: CodeModeModelAdapter = {
      ...base,
      generate: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "PROVIDER_FAILURE",
            message: "offline failure",
            dispatchEvidence: "not-dispatched",
          },
        }),
    };
    const failed = unwrap(
      await generateCodeMode({ ...common, adapter: failing }),
    );
    expect(failed.kind).toBe("adapter-failure");
    expect(failed.record.totalUsage.costUsdMicros).toBe(0);

    const preflight: CodeModeModelAdapter = {
      ...abstaining,
      preflightStructuredOutput: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "PROVIDER_FAILURE",
            message: "schema rejected offline",
            dispatchEvidence: "not-dispatched",
          },
        }),
    };
    expect((await generateCodeMode({ ...common, adapter: preflight })).ok).toBe(
      false,
    );
    expect(
      (
        await generateCodeMode({
          ...common,
          adapter: abstaining,
          semanticObligations: [
            {
              kind: "requiresOperation",
              operation: { id: "", version: "" },
            },
          ],
        })
      ).ok,
    ).toBe(false);

    const source = `export default async function main(input, ops) {
      const squared = await ops.map("square@1.0.0", input.items);
      return squared;
    }`;
    const unconstrained: CodeModeModelAdapter = {
      ...base,
      generate: () =>
        Promise.resolve({
          ok: true,
          value: {
            rawResponse: JSON.stringify({ kind: "program", source }),
            usage: { inputTokens: 1, outputTokens: 1, costUsdMicros: 0 },
            latencyMs: 1,
            dispatchEvidence: "dispatched-with-usage",
          },
        }),
    };
    const feasible = required(
      corpus.heldOut.find(
        (item) => item.case.id === "m2/heldout/numbers/square-add-ten",
      ),
      "Missing unconstrained fixture.",
    );
    expect(
      (
        await generateCodeMode({
          task: "Square the inputs.",
          catalog,
          policy: feasible.case.policy,
          taskInputs: feasible.case.taskInputs,
          semanticObligations: [
            {
              kind: "requiresOperation",
              operation: { id: "square", version: "1.0.0" },
            },
          ],
          adapter: unconstrained,
          strategy: { constraint: "unconstrained-json", repair: "none" },
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await generateCodeMode({
          ...common,
          adapter: unconstrained,
          strategy: {
            constraint: "unconstrained-json",
            repair: "compiler-guided",
          },
        })
      ).ok,
    ).toBe(false);
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
