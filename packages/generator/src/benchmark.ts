import {
  canonicalizeJson,
  type Catalog,
  createPlanLanguageManifest,
  type Diagnostic,
  diagnostic,
  digestValue,
  type EffectHandler,
  executePlan,
  inspectExecutablePlan,
  parseJson,
  type Result,
  type WireNode,
  wirePlanSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type FrozenPlanGenerationCase,
  type HiddenEvaluation,
  type PlanGenerationCase,
  type PlanProperty,
  toPublicExamples,
} from "./case.js";
import {
  type BenchmarkSplit,
  type ExperimentManifest,
  type ExperimentMethod,
  verifyExperimentManifest,
} from "./experiment.js";
import type {
  GenerationStrategy,
  ModelAdapter,
  ModelIdentity,
} from "./model.js";
import { MAX_REPAIR_ATTEMPTS } from "./model.js";
import { generatePlan, type GenerationSession } from "./pipeline.js";
import {
  type GenerationRecord,
  generationRecordSchema,
  generationStrategySchema,
  modelIdentitySchema,
} from "./records.js";

const hiddenScoreSchema = z
  .strictObject({
    id: z.string(),
    success: z.boolean(),
    diagnostics: z.array(z.string()).readonly(),
  })
  .readonly();

export const benchmarkScoreSchema = z
  .strictObject({
    expectedFeasibility: z.enum(["plannable", "unplannable"]),
    executionAttempted: z.boolean(),
    propertiesSatisfied: z.boolean().nullable(),
    semanticSuccess: z.boolean().nullable(),
    correctAbstention: z.boolean(),
    capabilityViolation: z.boolean(),
    budgetViolation: z.boolean(),
    hiddenEvaluations: z.array(hiddenScoreSchema).readonly(),
    topologyDigest: z.string().nullable(),
  })
  .readonly();

export const benchmarkCaseRecordSchema = z
  .strictObject({
    key: z.string(),
    experimentDigest: z.string(),
    split: z.enum([
      "development",
      "heldout-catalog",
      "heldout-operator-combination",
      "heldout-phrasing",
    ]),
    splitDigest: z.string(),
    caseId: z.string(),
    caseDigest: z.string(),
    manifestDigest: z.string(),
    methodId: z.string(),
    modelConfigurationDigest: z.string(),
    model: modelIdentitySchema,
    strategy: generationStrategySchema,
    repetition: z.number().int().nonnegative(),
    generation: generationRecordSchema,
    score: benchmarkScoreSchema,
    digest: z.string(),
  })
  .readonly();

export type HiddenEvaluationScore = z.infer<typeof hiddenScoreSchema>;
export type BenchmarkScore = z.infer<typeof benchmarkScoreSchema>;
export type BenchmarkCaseRecord = z.infer<typeof benchmarkCaseRecordSchema>;

export type BenchmarkMethod = Readonly<{
  id: string;
  adapter: ModelAdapter;
  strategy: GenerationStrategy;
}>;

export type CatalogResolver = (
  catalogId: string,
) => Result<Catalog, Diagnostic>;

export type BenchmarkStore = Readonly<{
  load: (
    key: string,
  ) => Promise<Result<BenchmarkCaseRecord | undefined, Diagnostic>>;
  save: (record: BenchmarkCaseRecord) => Promise<Result<void, Diagnostic>>;
}>;

export type BenchmarkRunInput = Readonly<{
  experiment: ExperimentManifest;
  cases: ReadonlyArray<FrozenPlanGenerationCase>;
  methods: ReadonlyArray<BenchmarkMethod>;
  resolveCatalog: CatalogResolver;
  store: BenchmarkStore;
}>;

export type BenchmarkRunResult = Readonly<{
  records: ReadonlyArray<BenchmarkCaseRecord>;
  resumed: number;
  generated: number;
}>;

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

function operationReferences(
  node: WireNode,
): ReadonlyArray<Readonly<{ id: string; version: string }>> {
  switch (node.op) {
    case "invoke":
      return [node.function];
    case "map":
      return [node.operation];
    case "filter":
      return [node.predicate];
    case "fold":
      return [node.reducer];
    case "effect":
      return [node.effect];
    case "boundedFix":
      return [node.step, node.measure];
    case "input":
    case "constant":
    case "select":
    case "checkpoint":
      return [];
  }
}

function parseCompiledWire(
  session: Extract<GenerationSession, Readonly<{ kind: "compiled" }>>,
): Result<z.infer<typeof wirePlanSchema>, Diagnostic> {
  const summary = inspectExecutablePlan(session.executablePlan);
  if (summary === undefined) {
    return {
      ok: false,
      error: diagnostic(
        "INVALID_EXECUTABLE_PLAN",
        "Compiled benchmark artifact could not be inspected.",
      ),
    };
  }
  const json = parseJson(summary.canonicalPlan);
  if (!json.ok) return json;
  const parsed = wirePlanSchema.safeParse(json.value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        error: diagnostic(
          "INTERNAL_INVARIANT_VIOLATION",
          "Compiled canonical plan no longer matches the wire schema.",
        ),
      };
}

function propertySatisfied(
  property: PlanProperty,
  wire: z.infer<typeof wirePlanSchema>,
  session: Extract<GenerationSession, Readonly<{ kind: "compiled" }>>,
): boolean {
  const summary = inspectExecutablePlan(session.executablePlan);
  if (summary === undefined) return false;
  switch (property.kind) {
    case "rootSchema":
      return (
        summary.rootSchema.id === property.id &&
        summary.rootSchema.version === property.version
      );
    case "maximumNodes":
      return wire.nodes.length <= property.value;
    case "usesInput":
      return wire.nodes.some(
        (node) => node.op === "input" && node.inputKey === property.inputKey,
      );
    case "usesEffect":
      return summary.analysis.effectsUsed.has(property.name);
    case "usesOperation":
      return wire.nodes.some((node) =>
        operationReferences(node).some(
          (reference) =>
            reference.id === property.id &&
            reference.version === property.version,
        ),
      );
  }
}

async function topologyDigest(
  session: Extract<GenerationSession, Readonly<{ kind: "compiled" }>>,
): Promise<Result<string, Diagnostic>> {
  const wire = parseCompiledWire(session);
  if (!wire.ok) return wire;
  const indexes = new Map(
    wire.value.nodes.map((node, index) => [node.id, index]),
  );
  return digestValue({
    root: indexes.get(wire.value.root) ?? -1,
    nodes: wire.value.nodes.map((node) => {
      const references = operationReferences(node);
      const dependencies = (() => {
        switch (node.op) {
          case "invoke":
          case "map":
          case "filter":
          case "fold":
          case "effect":
          case "checkpoint":
            return [indexes.get(node.source) ?? -1];
          case "select":
            return [
              indexes.get(node.condition) ?? -1,
              indexes.get(node.whenTrue) ?? -1,
              indexes.get(node.whenFalse) ?? -1,
            ];
          case "boundedFix":
            return [indexes.get(node.seed) ?? -1];
          case "input":
          case "constant":
            return [];
        }
      })();
      return {
        op: node.op,
        operations: references.map(
          (reference) => `${reference.id}@${reference.version}`,
        ),
        dependencies,
      };
    }),
  });
}

function deterministicHandler(evaluation: HiddenEvaluation): EffectHandler {
  return (request) => {
    for (const fixture of evaluation.effects) {
      if (fixture.effectName !== request.effectName) continue;
      const input = canonicalizeJson(fixture.input);
      const requested = canonicalizeJson(request.input);
      if (!input.ok) return Promise.resolve(input);
      if (!requested.ok) return Promise.resolve(requested);
      if (input.value === requested.value) {
        return Promise.resolve({
          ok: true,
          value: {
            value: fixture.output,
            replayResultId: fixture.replayResultId,
            usage: fixture.usage,
          },
        });
      }
    }
    return Promise.resolve({
      ok: false,
      error: diagnostic(
        "MISSING_REPLAY_RESULT",
        `No deterministic effect fixture for ${request.effectName}.`,
        { nodeId: request.nodeId },
      ),
    });
  };
}

async function evaluateHidden(
  session: Extract<GenerationSession, Readonly<{ kind: "compiled" }>>,
  evaluation: HiddenEvaluation,
): Promise<HiddenEvaluationScore> {
  let tick = 0;
  const executed = await executePlan(session.executablePlan, {
    inputs: new Map(Object.entries(evaluation.inputs)),
    effectHandler: deterministicHandler(evaluation),
    clock: { now: () => `benchmark-tick-${tick++}` },
    runIdProvider: { next: () => `benchmark/${evaluation.id}` },
  });
  if (!executed.ok) {
    return {
      id: evaluation.id,
      success: false,
      diagnostics: executed.error.diagnostics.map((item) => item.code),
    };
  }
  const expected = canonicalizeJson(evaluation.expectedOutput);
  const actual = canonicalizeJson(executed.value.output);
  return {
    id: evaluation.id,
    success: expected.ok && actual.ok && expected.value === actual.value,
    diagnostics: expected.ok && actual.ok ? [] : ["RUNTIME_SCHEMA_VIOLATION"],
  };
}

function diagnosticFlags(record: GenerationRecord): Readonly<{
  capabilityViolation: boolean;
  budgetViolation: boolean;
}> {
  const diagnostics = record.attempts.flatMap((attempt) => attempt.diagnostics);
  return {
    capabilityViolation: diagnostics.some(
      (item) => item.code === "DENIED_CAPABILITY",
    ),
    budgetViolation: diagnostics.some(
      (item) => item.code === "BUDGET_EXCEEDED",
    ),
  };
}

export async function scoreGeneration(
  benchmarkCase: PlanGenerationCase,
  session: GenerationSession,
): Promise<Result<BenchmarkScore, Diagnostic>> {
  const flags = diagnosticFlags(session.record);
  if (session.kind !== "compiled") {
    return {
      ok: true,
      value: {
        expectedFeasibility: benchmarkCase.expectedFeasibility,
        executionAttempted: false,
        propertiesSatisfied: null,
        semanticSuccess: null,
        correctAbstention:
          benchmarkCase.expectedFeasibility === "unplannable" &&
          session.kind === "unplannable",
        ...flags,
        hiddenEvaluations: [],
        topologyDigest: null,
      },
    };
  }
  const wire = parseCompiledWire(session);
  if (!wire.ok) return wire;
  const propertiesSatisfied = benchmarkCase.requiredProperties.every(
    (property) => propertySatisfied(property, wire.value, session),
  );
  const topology = await topologyDigest(session);
  if (!topology.ok) return topology;
  const summary = inspectExecutablePlan(session.executablePlan);
  if (summary === undefined) {
    return {
      ok: false,
      error: diagnostic(
        "INVALID_EXECUTABLE_PLAN",
        "Compiled benchmark artifact could not be inspected.",
      ),
    };
  }
  const forbiddenUsed = [...summary.analysis.capabilitiesRequired].some(
    (capability) => benchmarkCase.forbiddenCapabilities.includes(capability),
  );
  if (forbiddenUsed) {
    return {
      ok: true,
      value: {
        expectedFeasibility: benchmarkCase.expectedFeasibility,
        executionAttempted: false,
        propertiesSatisfied,
        semanticSuccess: false,
        correctAbstention: false,
        capabilityViolation: true,
        budgetViolation: flags.budgetViolation,
        hiddenEvaluations: [],
        topologyDigest: topology.value,
      },
    };
  }
  const hidden: Array<HiddenEvaluationScore> = [];
  for (const evaluation of benchmarkCase.hiddenEvaluations)
    hidden.push(await evaluateHidden(session, evaluation));
  return {
    ok: true,
    value: {
      expectedFeasibility: benchmarkCase.expectedFeasibility,
      executionAttempted: true,
      propertiesSatisfied,
      semanticSuccess:
        benchmarkCase.expectedFeasibility === "plannable" &&
        propertiesSatisfied &&
        hidden.every((evaluation) => evaluation.success),
      correctAbstention: false,
      capabilityViolation: flags.capabilityViolation,
      budgetViolation: flags.budgetViolation,
      hiddenEvaluations: hidden,
      topologyDigest: topology.value,
    },
  };
}

export function createInMemoryBenchmarkStore(): BenchmarkStore {
  const records = new Map<string, BenchmarkCaseRecord>();
  return {
    load: (key) => Promise.resolve({ ok: true, value: records.get(key) }),
    save: (record) => {
      records.set(record.key, record);
      return Promise.resolve({ ok: true, value: undefined });
    },
  };
}

async function caseRecord(
  key: string,
  input: Readonly<{
    experiment: ExperimentManifest;
    experimentMethod: ExperimentMethod;
    split: BenchmarkSplit;
    splitDigest: string;
    frozenCase: FrozenPlanGenerationCase;
    method: BenchmarkMethod;
    repetition: number;
    session: GenerationSession;
    score: BenchmarkScore;
  }>,
): Promise<Result<BenchmarkCaseRecord, Diagnostic>> {
  const body = {
    key,
    experimentDigest: input.experiment.experimentDigest,
    split: input.split,
    splitDigest: input.splitDigest,
    caseId: input.frozenCase.case.id,
    caseDigest: input.frozenCase.digest,
    manifestDigest: input.session.manifest.manifestDigest,
    methodId: input.method.id,
    modelConfigurationDigest: input.experimentMethod.modelConfigurationDigest,
    model: input.method.adapter.identity,
    strategy: input.method.strategy,
    repetition: input.repetition,
    generation: input.session.record,
    score: input.score,
  };
  const digest = await digestValue(body);
  if (!digest.ok) return digest;
  const complete: BenchmarkCaseRecord = { ...body, digest: digest.value };
  deepFreeze(complete);
  return { ok: true, value: complete };
}

type RunUsage = Readonly<{
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
}>;

const ZERO_RUN_USAGE: RunUsage = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsdMicros: 0,
};

function addRecordUsage(
  usage: RunUsage,
  record: BenchmarkCaseRecord,
): RunUsage {
  return {
    calls: usage.calls + record.generation.attempts.length,
    inputTokens: usage.inputTokens + record.generation.totalInputTokens,
    outputTokens: usage.outputTokens + record.generation.totalOutputTokens,
    costUsdMicros: usage.costUsdMicros + record.generation.totalCostUsdMicros,
  };
}

function capViolation(
  usage: RunUsage,
  experiment: ExperimentManifest,
): Diagnostic | undefined {
  const totalTokens = usage.inputTokens + usage.outputTokens;
  const checks: ReadonlyArray<
    Readonly<{ resource: string; actual: number; limit: number }>
  > = [
    {
      resource: "modelCalls",
      actual: usage.calls,
      limit: experiment.caps.maxCalls,
    },
    {
      resource: "inputTokens",
      actual: usage.inputTokens,
      limit: experiment.caps.maxInputTokens,
    },
    {
      resource: "outputTokens",
      actual: usage.outputTokens,
      limit: experiment.caps.maxOutputTokens,
    },
    {
      resource: "totalTokens",
      actual: totalTokens,
      limit: experiment.caps.maxTotalTokens,
    },
    {
      resource: "costUsdMicros",
      actual: usage.costUsdMicros,
      limit: experiment.caps.maxCostUsdMicros,
    },
  ];
  const exceeded = checks.find((item) => item.actual > item.limit);
  return exceeded === undefined
    ? undefined
    : diagnostic(
        "BUDGET_EXCEEDED",
        `Experiment exceeded ${exceeded.resource}: ${exceeded.actual} > ${exceeded.limit}.`,
        {},
        [],
        { limit: exceeded },
      );
}

function sameCanonical(left: unknown, right: unknown): boolean {
  const leftJson = canonicalizeJson(left);
  const rightJson = canonicalizeJson(right);
  return leftJson.ok && rightJson.ok && leftJson.value === rightJson.value;
}

type RunContext = Readonly<{
  experiment: ExperimentManifest;
  caseBindings: ReadonlyMap<string, ExperimentManifest["cases"][number]>;
  splitDigests: ReadonlyMap<BenchmarkSplit, string>;
  methodBindings: ReadonlyMap<string, ExperimentMethod>;
}>;

async function validateRunInput(
  input: BenchmarkRunInput,
): Promise<Result<RunContext, Diagnostic>> {
  const verified = await verifyExperimentManifest(input.experiment);
  if (!verified.ok) {
    return {
      ok: false,
      error:
        verified.error[0] ??
        diagnostic("INVALID_WIRE_SCHEMA", "Invalid experiment manifest."),
    };
  }
  const caseBindings = new Map(
    verified.value.cases.map((item) => [item.id, item]),
  );
  if (
    input.cases.length !== caseBindings.size ||
    input.cases.some(
      (item) => caseBindings.get(item.case.id)?.caseDigest !== item.digest,
    )
  ) {
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Benchmark cases do not exactly match the experiment manifest.",
      ),
    };
  }
  const methodBindings = new Map(
    verified.value.methods.map((item) => [item.id, item]),
  );
  if (
    input.methods.length !== methodBindings.size ||
    input.methods.some((method) => {
      const expected = methodBindings.get(method.id);
      return (
        expected === undefined ||
        !sameCanonical(expected.model, method.adapter.identity) ||
        !sameCanonical(expected.inference, method.adapter.inference) ||
        !sameCanonical(expected.strategy, method.strategy)
      );
    })
  ) {
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Benchmark methods do not exactly match the experiment manifest.",
      ),
    };
  }
  return {
    ok: true,
    value: {
      experiment: verified.value,
      caseBindings,
      methodBindings,
      splitDigests: new Map(
        verified.value.splits.map((item) => [item.id, item.digest]),
      ),
    },
  };
}

/** Resumes by content key and never exposes hidden evaluations to the adapter. */
export async function runBenchmark(
  input: BenchmarkRunInput,
): Promise<Result<BenchmarkRunResult, Diagnostic>> {
  const context = await validateRunInput(input);
  if (!context.ok) return context;
  const records: Array<BenchmarkCaseRecord> = [];
  let resumed = 0;
  let generated = 0;
  let usage = ZERO_RUN_USAGE;
  for (const frozenCase of input.cases) {
    const caseBinding = context.value.caseBindings.get(frozenCase.case.id);
    if (caseBinding === undefined) {
      return {
        ok: false,
        error: diagnostic("INVALID_WIRE_SCHEMA", "Missing experiment case."),
      };
    }
    const splitDigest = context.value.splitDigests.get(caseBinding.split);
    if (splitDigest === undefined) {
      return {
        ok: false,
        error: diagnostic("INVALID_WIRE_SCHEMA", "Missing experiment split."),
      };
    }
    const catalog = input.resolveCatalog(frozenCase.case.catalogId);
    if (!catalog.ok) return catalog;
    const manifest = await createPlanLanguageManifest(
      catalog.value,
      frozenCase.case.policy,
    );
    if (!manifest.ok) return manifest;
    for (const method of input.methods) {
      const experimentMethod = context.value.methodBindings.get(method.id);
      if (experimentMethod === undefined) {
        return {
          ok: false,
          error: diagnostic(
            "INVALID_WIRE_SCHEMA",
            "Missing experiment method.",
          ),
        };
      }
      for (
        let repetition = 0;
        repetition < context.value.experiment.repetitions;
        repetition += 1
      ) {
        const keyDigest = await digestValue({
          experimentDigest: context.value.experiment.experimentDigest,
          caseDigest: frozenCase.digest,
          split: caseBinding.split,
          languageManifestDigest: manifest.value.manifestDigest,
          methodId: method.id,
          repetition,
        });
        if (!keyDigest.ok) return keyDigest;
        const stored = await input.store.load(keyDigest.value);
        if (!stored.ok) return stored;
        if (stored.value !== undefined) {
          if (
            stored.value.key !== keyDigest.value ||
            stored.value.experimentDigest !==
              context.value.experiment.experimentDigest ||
            stored.value.caseDigest !== frozenCase.digest ||
            stored.value.manifestDigest !== manifest.value.manifestDigest ||
            stored.value.split !== caseBinding.split ||
            stored.value.methodId !== method.id ||
            stored.value.repetition !== repetition
          ) {
            return {
              ok: false,
              error: diagnostic(
                "INVALID_WIRE_SCHEMA",
                "Resumed benchmark record does not match its experiment key.",
              ),
            };
          }
          usage = addRecordUsage(usage, stored.value);
          const violation = capViolation(usage, context.value.experiment);
          if (violation !== undefined) return { ok: false, error: violation };
          records.push(stored.value);
          resumed += 1;
          continue;
        }
        const remainingCalls =
          context.value.experiment.caps.maxCalls - usage.calls;
        if (remainingCalls <= 0) {
          return {
            ok: false,
            error: diagnostic(
              "BUDGET_EXCEEDED",
              "Experiment model-call cap is exhausted.",
            ),
          };
        }
        const session = await generatePlan({
          task: frozenCase.case.instruction,
          catalog: catalog.value,
          policy: frozenCase.case.policy,
          publicExamples: toPublicExamples(frozenCase.case.publicExamples),
          adapter: method.adapter,
          strategy: method.strategy,
          modelCallLimit: Math.min(MAX_REPAIR_ATTEMPTS + 1, remainingCalls),
        });
        if (!session.ok) return session;
        const score = await scoreGeneration(frozenCase.case, session.value);
        if (!score.ok) return score;
        const record = await caseRecord(keyDigest.value, {
          experiment: context.value.experiment,
          experimentMethod,
          split: caseBinding.split,
          splitDigest,
          frozenCase,
          method,
          repetition,
          session: session.value,
          score: score.value,
        });
        if (!record.ok) return record;
        const nextUsage = addRecordUsage(usage, record.value);
        const violation = capViolation(nextUsage, context.value.experiment);
        if (violation !== undefined) return { ok: false, error: violation };
        const saved = await input.store.save(record.value);
        if (!saved.ok) return saved;
        records.push(record.value);
        usage = nextUsage;
        generated += 1;
      }
    }
  }
  return { ok: true, value: { records, resumed, generated } };
}

export type ConfidenceInterval = Readonly<{
  confidence: 0.95;
  lower: number;
  upper: number;
}>;

export type RateEstimate = Readonly<{
  successes: number;
  sampleCount: number;
  rate: number | null;
  confidenceInterval: ConfidenceInterval | null;
}>;

export type BenchmarkSummary = Readonly<{
  records: number;
  parseSuccess: RateEstimate;
  wireValidation: RateEstimate;
  firstAttemptCompilation: RateEstimate;
  postRepairCompilation: RateEstimate;
  semanticSuccess: RateEstimate;
  correctAbstention: RateEstimate;
  meanRepairCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsdMicros: number;
  totalLatencyMs: number;
  topologyVariants: number;
}>;

function estimate(successes: number, sampleCount: number): RateEstimate {
  if (sampleCount === 0) {
    return {
      successes,
      sampleCount,
      rate: null,
      confidenceInterval: null,
    };
  }
  const rate = successes / sampleCount;
  const z = 1.96;
  const denominator = 1 + (z * z) / sampleCount;
  const center = (rate + (z * z) / (2 * sampleCount)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt(
      (rate * (1 - rate)) / sampleCount +
        (z * z) / (4 * sampleCount * sampleCount),
    );
  return {
    successes,
    sampleCount,
    rate,
    confidenceInterval: {
      confidence: 0.95,
      lower: Math.max(0, center - margin),
      upper: Math.min(1, center + margin),
    },
  };
}

export function summarizeBenchmark(
  records: ReadonlyArray<BenchmarkCaseRecord>,
): BenchmarkSummary {
  const attempts = records.flatMap((record) => record.generation.attempts);
  const parseAttempts = attempts.filter(
    (attempt) => attempt.parseSuccess !== null,
  );
  const wireAttempts = attempts.filter(
    (attempt) =>
      attempt.parseSuccess === true && attempt.wireValidation !== null,
  );
  const plannable = records.filter(
    (record) => record.score.expectedFeasibility === "plannable",
  );
  const impossible = records.filter(
    (record) => record.score.expectedFeasibility === "unplannable",
  );
  return {
    records: records.length,
    parseSuccess: estimate(
      parseAttempts.filter((attempt) => attempt.parseSuccess).length,
      parseAttempts.length,
    ),
    wireValidation: estimate(
      wireAttempts.filter((attempt) => attempt.wireValidation).length,
      wireAttempts.length,
    ),
    firstAttemptCompilation: estimate(
      plannable.filter((record) => record.generation.attempts[0]?.compiled)
        .length,
      plannable.length,
    ),
    postRepairCompilation: estimate(
      plannable.filter((record) => record.generation.finalKind === "compiled")
        .length,
      plannable.length,
    ),
    semanticSuccess: estimate(
      plannable.filter((record) => record.score.semanticSuccess).length,
      plannable.length,
    ),
    correctAbstention: estimate(
      impossible.filter((record) => record.score.correctAbstention).length,
      impossible.length,
    ),
    meanRepairCount:
      records.length === 0
        ? 0
        : records.reduce(
            (total, record) => total + record.generation.repairCount,
            0,
          ) / records.length,
    totalInputTokens: records.reduce(
      (total, record) => total + record.generation.totalInputTokens,
      0,
    ),
    totalOutputTokens: records.reduce(
      (total, record) => total + record.generation.totalOutputTokens,
      0,
    ),
    totalCostUsdMicros: records.reduce(
      (total, record) => total + record.generation.totalCostUsdMicros,
      0,
    ),
    totalLatencyMs: records.reduce(
      (total, record) => total + record.generation.totalLatencyMs,
      0,
    ),
    topologyVariants: new Set(
      records.flatMap((record) =>
        record.score.topologyDigest === null
          ? []
          : [record.score.topologyDigest],
      ),
    ).size,
  };
}

export type ResearchGate = Readonly<{
  id: string;
  status: "pass" | "fail" | "notEvaluated";
  actual: number | boolean | null;
  target: string;
  sampleCount: number;
  confidenceInterval: ConfidenceInterval | null;
}>;

function thresholdGate(
  id: string,
  value: RateEstimate,
  threshold: number,
): ResearchGate {
  return {
    id,
    status:
      value.rate === null
        ? "notEvaluated"
        : value.rate >= threshold
          ? "pass"
          : "fail",
    actual: value.rate,
    target: `>=${threshold}`,
    sampleCount: value.sampleCount,
    confidenceInterval: value.confidenceInterval,
  };
}

function isHeldOut(record: BenchmarkCaseRecord): boolean {
  return record.split !== "development";
}

function pairKey(record: BenchmarkCaseRecord): string {
  return [
    record.experimentDigest,
    record.split,
    record.caseDigest,
    record.modelConfigurationDigest,
    String(record.repetition),
  ].join("/");
}

type RecordPair = Readonly<{
  left: BenchmarkCaseRecord;
  right: BenchmarkCaseRecord;
}>;

type PairedCoverage = Readonly<{
  complete: boolean;
  pairs: ReadonlyArray<RecordPair>;
}>;

function matchedPairs(
  records: ReadonlyArray<BenchmarkCaseRecord>,
  leftStrategy: GenerationStrategy["id"],
  rightStrategy: GenerationStrategy["id"],
): PairedCoverage {
  const left = new Map<string, BenchmarkCaseRecord>();
  const right = new Map<string, BenchmarkCaseRecord>();
  let duplicates = false;
  for (const record of records) {
    const target =
      record.strategy.id === leftStrategy
        ? left
        : record.strategy.id === rightStrategy
          ? right
          : undefined;
    if (target === undefined) continue;
    const key = pairKey(record);
    if (target.has(key)) duplicates = true;
    else target.set(key, record);
  }
  const sameKeys =
    left.size === right.size && [...left.keys()].every((key) => right.has(key));
  if (duplicates || !sameKeys) return { complete: false, pairs: [] };
  return {
    complete: true,
    pairs: [...left.entries()].flatMap(([key, leftRecord]) => {
      const rightRecord = right.get(key);
      return rightRecord === undefined
        ? []
        : [{ left: leftRecord, right: rightRecord }];
    }),
  };
}

function semanticallyExecutable(record: BenchmarkCaseRecord): boolean {
  return (
    record.generation.finalKind === "compiled" &&
    record.score.semanticSuccess === true
  );
}

function runtimeFailed(record: BenchmarkCaseRecord): boolean {
  return (
    record.score.executionAttempted &&
    record.score.hiddenEvaluations.some((evaluation) => !evaluation.success)
  );
}

function differenceInterval(
  right: RateEstimate,
  left: RateEstimate,
): ConfidenceInterval | null {
  return right.confidenceInterval === null || left.confidenceInterval === null
    ? null
    : {
        confidence: 0.95,
        lower: right.confidenceInterval.lower - left.confidenceInterval.upper,
        upper: right.confidenceInterval.upper - left.confidenceInterval.lower,
      };
}

export function evaluateResearchGates(
  records: ReadonlyArray<BenchmarkCaseRecord>,
): ReadonlyArray<ResearchGate> {
  const heldOut = records.filter(isHeldOut);
  const withRepair = heldOut.filter(
    (record) => record.strategy.id === "json-schema-with-repair",
  );
  const repairedSummary = summarizeBenchmark(withRepair);
  const repairPairs = matchedPairs(
    heldOut,
    "json-schema",
    "json-schema-with-repair",
  );
  const baseSemantic = estimate(
    repairPairs.pairs.filter((pair) => semanticallyExecutable(pair.left))
      .length,
    repairPairs.pairs.length,
  );
  const repairedSemantic = estimate(
    repairPairs.pairs.filter((pair) => semanticallyExecutable(pair.right))
      .length,
    repairPairs.pairs.length,
  );
  const repairUplift =
    baseSemantic.rate === null || repairedSemantic.rate === null
      ? null
      : repairedSemantic.rate - baseSemantic.rate;
  const repairImproved =
    repairUplift === null ||
    baseSemantic.rate === null ||
    repairedSemantic.rate === null
      ? null
      : repairUplift >= 0.1 ||
        1 - repairedSemantic.rate <= (1 - baseSemantic.rate) / 2;
  const codePairs = matchedPairs(
    heldOut,
    "json-schema-with-repair",
    "codemode",
  );
  const irRuntimeFailures = estimate(
    codePairs.pairs.filter((pair) => runtimeFailed(pair.left)).length,
    codePairs.pairs.length,
  );
  const codeRuntimeFailures = estimate(
    codePairs.pairs.filter((pair) => runtimeFailed(pair.right)).length,
    codePairs.pairs.length,
  );
  const irRepairs =
    codePairs.pairs.length === 0
      ? null
      : codePairs.pairs.reduce(
          (total, pair) => total + pair.left.generation.repairCount,
          0,
        ) / codePairs.pairs.length;
  const codeRepairs =
    codePairs.pairs.length === 0
      ? null
      : codePairs.pairs.reduce(
          (total, pair) => total + pair.right.generation.repairCount,
          0,
        ) / codePairs.pairs.length;
  const runtimeAdvantage =
    irRuntimeFailures.rate === null || codeRuntimeFailures.rate === null
      ? null
      : codeRuntimeFailures.rate - irRuntimeFailures.rate;
  const irOutperformsCodeMode =
    runtimeAdvantage === null || irRepairs === null || codeRepairs === null
      ? null
      : runtimeAdvantage > 0 && irRepairs < codeRepairs;
  const safeExecution = heldOut.every(
    (record) =>
      !record.score.executionAttempted ||
      (record.generation.finalKind === "compiled" &&
        !record.score.capabilityViolation),
  );
  return [
    {
      id: "zero-rejected-or-unauthorized-execution",
      status:
        heldOut.length === 0 ? "notEvaluated" : safeExecution ? "pass" : "fail",
      actual: heldOut.length === 0 ? null : safeExecution,
      target: "true",
      sampleCount: heldOut.length,
      confidenceInterval: null,
    },
    thresholdGate(
      "first-attempt-compile-rate",
      repairedSummary.firstAttemptCompilation,
      0.9,
    ),
    thresholdGate(
      "post-repair-compile-rate",
      repairedSummary.postRepairCompilation,
      0.98,
    ),
    thresholdGate(
      "semantic-hidden-case-success",
      repairedSummary.semanticSuccess,
      0.9,
    ),
    thresholdGate(
      "correct-impossible-case-abstention",
      repairedSummary.correctAbstention,
      0.9,
    ),
    {
      id: "repair-materially-improves",
      status:
        !repairPairs.complete || repairImproved === null
          ? "notEvaluated"
          : repairImproved
            ? "pass"
            : "fail",
      actual: repairPairs.complete ? repairUplift : null,
      target: ">=10 percentage points or halves failure rate",
      sampleCount: repairPairs.pairs.length,
      confidenceInterval: repairPairs.complete
        ? differenceInterval(repairedSemantic, baseSemantic)
        : null,
    },
    {
      id: "functional-ir-outperforms-codemode",
      status:
        !codePairs.complete || irOutperformsCodeMode === null
          ? "notEvaluated"
          : irOutperformsCodeMode
            ? "pass"
            : "fail",
      actual: codePairs.complete ? runtimeAdvantage : null,
      target: "fewer repair turns and runtime failures",
      sampleCount: codePairs.pairs.length,
      confidenceInterval: codePairs.complete
        ? differenceInterval(codeRuntimeFailures, irRuntimeFailures)
        : null,
    },
  ];
}

export function benchmarkMethodIdentity(method: BenchmarkMethod): Readonly<{
  id: string;
  model: ModelIdentity;
  strategy: GenerationStrategy;
}> {
  return {
    id: method.id,
    model: method.adapter.identity,
    strategy: method.strategy,
  };
}
