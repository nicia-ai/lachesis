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
  ModelAdapterFailure,
  ModelIdentity,
  ModelResponse,
} from "./model.js";
import { MAX_REPAIR_ATTEMPTS } from "./model.js";
import { generatePlan, type GenerationSession } from "./pipeline.js";
import {
  calculateCostUsdMicros,
  calculateMaximumCostUsdMicros,
  type PricingEntry,
} from "./pricing.js";
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
    pricingEntryId: z.string(),
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
    pricingEntryId: input.experimentMethod.pricingEntryId,
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
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsdMicros: number;
}>;

const ZERO_RUN_USAGE: RunUsage = {
  calls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  costUsdMicros: 0,
};

function addRecordUsage(
  usage: RunUsage,
  record: BenchmarkCaseRecord,
): RunUsage {
  return {
    calls: usage.calls + record.generation.attempts.length,
    inputTokens: usage.inputTokens + record.generation.totalInputTokens,
    cachedInputTokens:
      usage.cachedInputTokens + record.generation.totalCachedInputTokens,
    cacheWriteInputTokens:
      usage.cacheWriteInputTokens +
      record.generation.totalCacheWriteInputTokens,
    outputTokens: usage.outputTokens + record.generation.totalOutputTokens,
    reasoningTokens:
      usage.reasoningTokens + record.generation.totalReasoningTokens,
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

function perCallCapViolation(
  record: BenchmarkCaseRecord,
  experiment: ExperimentManifest,
): Diagnostic | undefined {
  const exceeded = record.generation.attempts.find(
    (attempt) =>
      attempt.usage.outputTokens > experiment.caps.maxOutputTokensPerCall,
  );
  return exceeded === undefined
    ? undefined
    : diagnostic(
        "BUDGET_EXCEEDED",
        `Model call exceeded output token limit: ${exceeded.usage.outputTokens} > ${experiment.caps.maxOutputTokensPerCall}.`,
        {},
        [],
        {
          limit: {
            resource: "outputTokensPerCall",
            actual: exceeded.usage.outputTokens,
            limit: experiment.caps.maxOutputTokensPerCall,
          },
        },
      );
}

function providerCapViolation(
  providerCosts: ReadonlyMap<string, number>,
  experiment: ExperimentManifest,
): Diagnostic | undefined {
  for (const cap of experiment.caps.providerCostCaps) {
    const actual = providerCosts.get(cap.billingProvider) ?? 0;
    if (actual > cap.maxCostUsdMicros) {
      return diagnostic(
        "BUDGET_EXCEEDED",
        `Experiment exceeded ${cap.billingProvider} cost: ${actual} > ${cap.maxCostUsdMicros}.`,
        {},
        [],
        {
          limit: {
            resource: `${cap.billingProvider}.costUsdMicros`,
            actual,
            limit: cap.maxCostUsdMicros,
          },
        },
      );
    }
  }
  return undefined;
}

function reservationFailure(
  message: string,
): Result<ModelResponse, ModelAdapterFailure> {
  return {
    ok: false,
    error: { code: "BUDGET_RESERVATION_FAILED", message },
  };
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
        expected.pricingEntryId !== method.adapter.pricingEntryId ||
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
  if (
    input.methods.some(
      (method) =>
        method.adapter.inference.maxOutputTokens >
        verified.value.caps.maxOutputTokensPerCall,
    )
  ) {
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "A method output limit exceeds the experiment per-call output cap.",
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
  const runContext = context.value;
  const records: Array<BenchmarkCaseRecord> = [];
  let resumed = 0;
  let generated = 0;
  let usage = ZERO_RUN_USAGE;
  const providerCosts = new Map<string, number>();
  const pricingEntries = new Map(
    runContext.experiment.pricingSnapshot.entries.map((entry) => [
      entry.id,
      entry,
    ]),
  );
  const providerCaps = new Map(
    runContext.experiment.caps.providerCostCaps.map((cap) => [
      cap.billingProvider,
      cap.maxCostUsdMicros,
    ]),
  );

  function meteredAdapter(
    adapter: ModelAdapter,
    pricingEntry: PricingEntry,
  ): ModelAdapter {
    return {
      ...adapter,
      async generate(request) {
        const reservedCost = calculateMaximumCostUsdMicros(
          pricingEntry,
          adapter.inference.maxInputTokens,
          adapter.inference.maxOutputTokens,
        );
        if (!reservedCost.ok) {
          return reservationFailure(reservedCost.error.message);
        }
        const providerCap = providerCaps.get(pricingEntry.billingProvider);
        if (providerCap === undefined) {
          return reservationFailure(
            `No cost cap exists for ${pricingEntry.billingProvider}.`,
          );
        }
        const reservedInput =
          usage.inputTokens + adapter.inference.maxInputTokens;
        const reservedOutput =
          usage.outputTokens + adapter.inference.maxOutputTokens;
        const reservedTotal = reservedInput + reservedOutput;
        const reservedGlobalCost = usage.costUsdMicros + reservedCost.value;
        const reservedProviderCost =
          (providerCosts.get(pricingEntry.billingProvider) ?? 0) +
          reservedCost.value;
        if (
          usage.calls + 1 > runContext.experiment.caps.maxCalls ||
          reservedInput > runContext.experiment.caps.maxInputTokens ||
          reservedOutput > runContext.experiment.caps.maxOutputTokens ||
          reservedTotal > runContext.experiment.caps.maxTotalTokens ||
          reservedGlobalCost > runContext.experiment.caps.maxCostUsdMicros ||
          reservedProviderCost > providerCap
        ) {
          return reservationFailure(
            `Worst-case request reservation would exceed an experiment or ${pricingEntry.billingProvider} cap.`,
          );
        }
        usage = { ...usage, calls: usage.calls + 1 };
        const response = await adapter.generate(request);
        const reconcileUsage = (
          pricedUsage: Readonly<{
            inputTokens: number;
            cachedInputTokens: number;
            cacheWriteInputTokens: number;
            outputTokens: number;
            reasoningTokens: number;
            costUsdMicros: number;
          }>,
        ): void => {
          usage = {
            calls: usage.calls,
            inputTokens: usage.inputTokens + pricedUsage.inputTokens,
            cachedInputTokens:
              usage.cachedInputTokens + pricedUsage.cachedInputTokens,
            cacheWriteInputTokens:
              usage.cacheWriteInputTokens + pricedUsage.cacheWriteInputTokens,
            outputTokens: usage.outputTokens + pricedUsage.outputTokens,
            reasoningTokens:
              usage.reasoningTokens + pricedUsage.reasoningTokens,
            costUsdMicros: usage.costUsdMicros + pricedUsage.costUsdMicros,
          };
          providerCosts.set(
            pricingEntry.billingProvider,
            (providerCosts.get(pricingEntry.billingProvider) ?? 0) +
              pricedUsage.costUsdMicros,
          );
        };
        const conservativeUsage = {
          inputTokens: adapter.inference.maxInputTokens,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: adapter.inference.maxOutputTokens,
          reasoningTokens: 0,
          costUsdMicros: reservedCost.value,
        };
        if (!response.ok && response.error.usage === undefined) {
          reconcileUsage(conservativeUsage);
          return {
            ok: false,
            error: { ...response.error, usage: conservativeUsage },
          };
        }
        const responseUsage = response.ok
          ? response.value.usage
          : response.error.usage;
        if (responseUsage === undefined) {
          reconcileUsage(conservativeUsage);
          return reservationFailure(
            "Provider response omitted usage after a billable request.",
          );
        }
        const completeUsage = {
          inputTokens: responseUsage.inputTokens,
          cachedInputTokens: responseUsage.cachedInputTokens ?? 0,
          cacheWriteInputTokens: responseUsage.cacheWriteInputTokens ?? 0,
          outputTokens: responseUsage.outputTokens,
          reasoningTokens: responseUsage.reasoningTokens ?? 0,
        };
        const actualCost = calculateCostUsdMicros(pricingEntry, completeUsage);
        if (!actualCost.ok) {
          reconcileUsage(conservativeUsage);
          return {
            ok: false,
            error: {
              code: "PROVIDER_FAILURE",
              message: actualCost.error.message,
              usage: conservativeUsage,
              ...(response.ok
                ? response.value.metadata === undefined
                  ? {}
                  : { metadata: response.value.metadata }
                : response.error.metadata === undefined
                  ? {}
                  : { metadata: response.error.metadata }),
            },
          };
        }
        const pricedUsage = {
          ...completeUsage,
          costUsdMicros: actualCost.value,
        };
        reconcileUsage(pricedUsage);
        return response.ok
          ? {
              ok: true,
              value: { ...response.value, usage: pricedUsage },
            }
          : {
              ok: false,
              error: { ...response.error, usage: pricedUsage },
            };
      },
    };
  }
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
      const pricingEntry = pricingEntries.get(experimentMethod.pricingEntryId);
      if (pricingEntry === undefined) {
        return {
          ok: false,
          error: diagnostic(
            "INVALID_WIRE_SCHEMA",
            `Missing pricing entry ${experimentMethod.pricingEntryId}.`,
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
            stored.value.pricingEntryId !== experimentMethod.pricingEntryId ||
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
          providerCosts.set(
            pricingEntry.billingProvider,
            (providerCosts.get(pricingEntry.billingProvider) ?? 0) +
              stored.value.generation.totalCostUsdMicros,
          );
          const violation =
            capViolation(usage, context.value.experiment) ??
            perCallCapViolation(stored.value, context.value.experiment) ??
            providerCapViolation(providerCosts, context.value.experiment);
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
          adapter: meteredAdapter(method.adapter, pricingEntry),
          strategy: method.strategy,
          modelCallLimit: Math.min(MAX_REPAIR_ATTEMPTS + 1, remainingCalls),
        });
        if (!session.ok) return session;
        if (
          session.value.record.attempts.some(
            (attempt) =>
              attempt.adapterFailure?.code === "BUDGET_RESERVATION_FAILED",
          )
        ) {
          return {
            ok: false,
            error: diagnostic(
              "BUDGET_EXCEEDED",
              "Worst-case model request reservation was denied before provider invocation.",
            ),
          };
        }
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
        const violation =
          capViolation(usage, context.value.experiment) ??
          perCallCapViolation(record.value, context.value.experiment) ??
          providerCapViolation(providerCosts, context.value.experiment);
        if (violation !== undefined) return { ok: false, error: violation };
        const saved = await input.store.save(record.value);
        if (!saved.ok) return saved;
        records.push(record.value);
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
  providerRefusals: number;
  meanRepairCount: number;
  totalInputTokens: number;
  totalCachedInputTokens: number;
  totalCacheWriteInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
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
    providerRefusals: records.filter(
      (record) => record.generation.finalKind === "providerRefusal",
    ).length,
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
    totalCachedInputTokens: records.reduce(
      (total, record) => total + record.generation.totalCachedInputTokens,
      0,
    ),
    totalCacheWriteInputTokens: records.reduce(
      (total, record) => total + record.generation.totalCacheWriteInputTokens,
      0,
    ),
    totalOutputTokens: records.reduce(
      (total, record) => total + record.generation.totalOutputTokens,
      0,
    ),
    totalReasoningTokens: records.reduce(
      (total, record) => total + record.generation.totalReasoningTokens,
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
