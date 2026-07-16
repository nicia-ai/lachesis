import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";

import type {
  BenchmarkBudgetController,
  BenchmarkBudgetSettlement,
  BenchmarkCaseRecord,
  BenchmarkMethod,
  BenchmarkRunResult,
  BenchmarkStore,
  CatalogResolver,
} from "./benchmark.js";
import { runBenchmark } from "./benchmark.js";
import type { FrozenPlanGenerationCase, HiddenEvaluation } from "./case.js";
import {
  type CodeModeEffectHandler,
  type CodeModeExecutionFailure,
  type CodeModeRuntimeUsage,
  executeCodeMode,
  inspectCodeModeArtifact,
} from "./codemode.js";
import {
  type CodeModeGenerationRecord,
  type CodeModeGenerationStrategy,
  type CodeModeModelAdapter,
  type CodeModeModelRequest,
  generateCodeMode,
} from "./codemode-model.js";
import type { ExperimentManifest } from "./experiment.js";
import type { ModelAdapterFailure, ModelResponse } from "./model.js";
import { calculateMaximumCostUsdMicros, type PricingEntry } from "./pricing.js";

export const M2_COMPARISON_PROTOCOL = Object.freeze({
  id: "lachesis-m2-functional-ir-vs-restricted-typescript",
  version: "1",
  primaryComparison: Object.freeze([
    "functional-ir-with-typed-obligations",
    "restricted-typescript-codemode",
  ]),
  matchedFactors: Object.freeze([
    "provider-model",
    "task-public-contract",
    "hidden-evaluation",
    "initial-call-limit",
    "repair-call-limit",
    "reasoning-settings",
  ]),
  measurements: Object.freeze([
    "parse-transpile-success",
    "first-and-final-execution-success",
    "semantic-correctness",
    "runtime-exceptions-and-timeouts",
    "capability-violations",
    "repair-calls",
    "cost-and-latency",
    "static-analyzability",
    "predicted-versus-actual-resource-usage",
  ]),
  typeGraphStatus: "deferred",
});

export type M2CodeModeMethod = Readonly<{
  id: string;
  adapter: CodeModeModelAdapter;
  strategy: CodeModeGenerationStrategy;
  pricing: PricingEntry;
}>;

export type M2ResourceComparison = Readonly<{
  predicted: Readonly<{
    operationCalls: number;
    effectCalls: number;
    tokens: number;
    wallClockMs: number;
  }> | null;
  actual: CodeModeRuntimeUsage;
  actualWithinPrediction: boolean | null;
}>;

export type M2CodeModeScore = Readonly<{
  expectedFeasibility: "plannable" | "unplannable";
  parseTranspileSuccess: boolean;
  firstCompilationSuccess: boolean;
  finalCompilationSuccess: boolean;
  firstExecutionSuccess: boolean | null;
  finalExecutionSuccess: boolean | null;
  semanticSuccess: boolean | null;
  correctTypedAbstention: boolean;
  runtimeExceptions: number;
  timeouts: number;
  capabilityViolations: number;
  budgetViolations: number;
  repairCalls: number;
  costUsdMicros: number;
  latencyMs: number;
  staticallyAnalyzable: boolean;
  resources: M2ResourceComparison;
}>;

export type M2CodeModeRecord = Readonly<{
  key: string;
  experimentDigest: string;
  split: "development" | "heldout";
  splitDigest: string;
  caseId: string;
  caseDigest: string;
  methodId: string;
  representation: "restricted-typescript-codemode";
  repetition: number;
  generation: CodeModeGenerationRecord;
  score: M2CodeModeScore;
  digest: string;
}>;

export type M2CodeModeStore = Readonly<{
  load: (
    key: string,
  ) => Promise<Result<M2CodeModeRecord | undefined, Diagnostic>>;
  save: (record: M2CodeModeRecord) => Promise<Result<void, Diagnostic>>;
}>;

export type M2CodeModeRunInput = Readonly<{
  experimentDigest: string;
  split: "development" | "heldout";
  splitDigest: string;
  cases: ReadonlyArray<FrozenPlanGenerationCase>;
  methods: ReadonlyArray<M2CodeModeMethod>;
  repetitions: number;
  resolveCatalog: CatalogResolver;
  store: M2CodeModeStore;
  budgetController?: BenchmarkBudgetController | undefined;
}>;

export type M2CodeModeRunResult = Readonly<{
  records: ReadonlyArray<M2CodeModeRecord>;
  generated: number;
  resumed: number;
}>;

export type M2MatchedRecord = Readonly<{
  caseId: string;
  provider: string;
  model: string;
  repetition: number;
  functionalIr: Readonly<{
    parseSuccess: boolean;
    firstCompilationSuccess: boolean;
    finalCompilationSuccess: boolean;
    finalExecutionSuccess: boolean | null;
    semanticSuccess: boolean | null;
    correctTypedAbstention: boolean;
    repairCalls: number;
    costUsdMicros: number;
    latencyMs: number;
    staticallyAnalyzable: boolean;
    predictedActualReconciled: boolean | null;
  }>;
  codeMode: M2CodeModeScore;
  digest: string;
}>;

export type M2PairedRunInput = Readonly<{
  experimentDigest: string;
  irExperiment: ExperimentManifest;
  split: "development" | "heldout";
  splitDigest: string;
  cases: ReadonlyArray<FrozenPlanGenerationCase>;
  repetitions: number;
  irMethods: ReadonlyArray<BenchmarkMethod>;
  codeModeMethods: ReadonlyArray<M2CodeModeMethod>;
  resolveCatalog: CatalogResolver;
  irStore: BenchmarkStore;
  codeModeStore: M2CodeModeStore;
  budgetController?: BenchmarkBudgetController | undefined;
}>;

export type M2PairedRunResult = Readonly<{
  functionalIr: BenchmarkRunResult;
  codeMode: M2CodeModeRunResult;
  matched: ReadonlyArray<M2MatchedRecord>;
}>;

export async function createM2PairedExperimentDigest(
  input: Readonly<{
    irExperiment: ExperimentManifest;
    cases: ReadonlyArray<FrozenPlanGenerationCase>;
    repetitions: number;
    codeModeMethods: ReadonlyArray<M2CodeModeMethod>;
  }>,
): Promise<Result<string, Diagnostic>> {
  return digestValue({
    protocol: M2_COMPARISON_PROTOCOL,
    functionalIrExperimentDigest: input.irExperiment.experimentDigest,
    cases: input.cases.map((item) => ({
      id: item.case.id,
      digest: item.digest,
    })),
    repetitions: input.repetitions,
    codeModeMethods: input.codeModeMethods.map((method) => ({
      id: method.id,
      model: method.adapter.identity,
      inference: method.adapter.inference,
      strategy: method.strategy,
      pricingEntryId: method.pricing.id,
    })),
  });
}

function zeroRuntimeUsage(): CodeModeRuntimeUsage {
  return { operationCalls: 0, effectCalls: 0, tokens: 0, wallClockMs: 0 };
}

function addRuntimeUsage(
  left: CodeModeRuntimeUsage,
  right: CodeModeRuntimeUsage,
): CodeModeRuntimeUsage {
  return {
    operationCalls: left.operationCalls + right.operationCalls,
    effectCalls: left.effectCalls + right.effectCalls,
    tokens: left.tokens + right.tokens,
    wallClockMs: left.wallClockMs + right.wallClockMs,
  };
}

function executionFailureCount(
  failures: ReadonlyArray<CodeModeExecutionFailure>,
  kind: CodeModeExecutionFailure["kind"],
): number {
  return failures.filter((failure) => failure.kind === kind).length;
}

function semanticEqual(left: unknown, right: unknown): boolean {
  const leftCanonical = canonicalizeJson(left);
  const rightCanonical = canonicalizeJson(right);
  return (
    leftCanonical.ok &&
    rightCanonical.ok &&
    leftCanonical.value === rightCanonical.value
  );
}

function deterministicCodeModeHandler(
  evaluation: HiddenEvaluation,
): CodeModeEffectHandler {
  return (request) => {
    for (const fixture of evaluation.effects) {
      if (fixture.effectName !== request.effectName) continue;
      const expectedInput = canonicalizeJson(fixture.input);
      const requestedInput = canonicalizeJson(request.input);
      if (!expectedInput.ok) return Promise.resolve(expectedInput);
      if (!requestedInput.ok) return Promise.resolve(requestedInput);
      if (expectedInput.value === requestedInput.value)
        return Promise.resolve({
          ok: true,
          value: { value: fixture.output, usage: fixture.usage },
        });
    }
    return Promise.resolve({
      ok: false,
      error: diagnostic(
        "MISSING_REPLAY_RESULT",
        `No deterministic CodeMode effect fixture for ${request.effectName}.`,
      ),
    });
  };
}

async function scoreCodeMode(
  benchmarkCase: FrozenPlanGenerationCase,
  session: Awaited<ReturnType<typeof generateCodeMode>> extends Result<
    infer Session,
    Diagnostic
  >
    ? Session
    : never,
): Promise<M2CodeModeScore> {
  const generation = session.record;
  const initial = generation.attempts[0];
  const parseTranspileSuccess =
    initial?.parseTranspileSuccess === true ||
    generation.finalKind === "unplannable";
  const firstCompilationSuccess = initial?.staticAnalysisSuccess === true;
  const finalCompilationSuccess = session.kind === "compiled";
  if (benchmarkCase.case.expectedFeasibility === "unplannable") {
    return {
      expectedFeasibility: "unplannable",
      parseTranspileSuccess,
      firstCompilationSuccess,
      finalCompilationSuccess,
      firstExecutionSuccess: null,
      finalExecutionSuccess: null,
      semanticSuccess: null,
      correctTypedAbstention: session.kind === "unplannable",
      runtimeExceptions: 0,
      timeouts: 0,
      capabilityViolations: 0,
      budgetViolations: 0,
      repairCalls: generation.repairCount,
      costUsdMicros: generation.totalUsage.costUsdMicros,
      latencyMs: generation.totalLatencyMs,
      staticallyAnalyzable: false,
      resources: {
        predicted: null,
        actual: zeroRuntimeUsage(),
        actualWithinPrediction: null,
      },
    };
  }
  if (session.kind !== "compiled") {
    return {
      expectedFeasibility: "plannable",
      parseTranspileSuccess,
      firstCompilationSuccess,
      finalCompilationSuccess: false,
      firstExecutionSuccess: false,
      finalExecutionSuccess: false,
      semanticSuccess: false,
      correctTypedAbstention: false,
      runtimeExceptions: 0,
      timeouts: 0,
      capabilityViolations: 0,
      budgetViolations: 0,
      repairCalls: generation.repairCount,
      costUsdMicros: generation.totalUsage.costUsdMicros,
      latencyMs: generation.totalLatencyMs,
      staticallyAnalyzable: false,
      resources: {
        predicted: null,
        actual: zeroRuntimeUsage(),
        actualWithinPrediction: null,
      },
    };
  }
  const summary = inspectCodeModeArtifact(session.artifact);
  const failures: Array<CodeModeExecutionFailure> = [];
  let actual = zeroRuntimeUsage();
  let semanticallyCorrect = true;
  for (const evaluation of benchmarkCase.case.hiddenEvaluations) {
    const executed = await executeCodeMode(session.artifact, {
      inputs: new Map(Object.entries(evaluation.inputs)),
      effectHandler: deterministicCodeModeHandler(evaluation),
      timeoutMs: benchmarkCase.case.policy.budget.maxWallClockMs,
    });
    if (!executed.ok) {
      failures.push(executed.error);
      actual = addRuntimeUsage(actual, executed.error.usage);
      semanticallyCorrect = false;
    } else {
      actual = addRuntimeUsage(actual, executed.value.usage);
      semanticallyCorrect &&= semanticEqual(
        executed.value.output,
        evaluation.expectedOutput,
      );
    }
  }
  const predicted =
    summary === undefined
      ? null
      : {
          operationCalls:
            summary.analysis.maximumOperationCalls *
            benchmarkCase.case.hiddenEvaluations.length,
          effectCalls:
            summary.analysis.maximumEffectCalls *
            benchmarkCase.case.hiddenEvaluations.length,
          tokens:
            summary.analysis.maximumTokens *
            benchmarkCase.case.hiddenEvaluations.length,
          wallClockMs:
            summary.analysis.maximumWallClockMs *
            benchmarkCase.case.hiddenEvaluations.length,
        };
  const actualWithinPrediction =
    predicted === null
      ? null
      : actual.operationCalls <= predicted.operationCalls &&
        actual.effectCalls <= predicted.effectCalls &&
        actual.tokens <= predicted.tokens &&
        actual.wallClockMs <= predicted.wallClockMs;
  const executionSuccess = failures.length === 0;
  return {
    expectedFeasibility: "plannable",
    parseTranspileSuccess,
    firstCompilationSuccess,
    finalCompilationSuccess: true,
    firstExecutionSuccess:
      firstCompilationSuccess && generation.repairCount === 0
        ? executionSuccess
        : false,
    finalExecutionSuccess: executionSuccess,
    semanticSuccess: executionSuccess && semanticallyCorrect,
    correctTypedAbstention: false,
    runtimeExceptions: executionFailureCount(failures, "runtime-exception"),
    timeouts: executionFailureCount(failures, "timeout"),
    capabilityViolations: executionFailureCount(
      failures,
      "capability-violation",
    ),
    budgetViolations: executionFailureCount(failures, "budget-violation"),
    repairCalls: generation.repairCount,
    costUsdMicros: generation.totalUsage.costUsdMicros,
    latencyMs: generation.totalLatencyMs,
    staticallyAnalyzable: summary?.analysis.predictedResourcesKnown === true,
    resources: { predicted, actual, actualWithinPrediction },
  };
}

function settlement(
  input: Readonly<{
    experimentDigest: string;
    benchmarkRecordKey: string;
    methodId: string;
    attemptIndex: number;
    billingProvider: string;
    maximumCostUsdMicros: number;
    result: Result<ModelResponse, ModelAdapterFailure>;
  }>,
): BenchmarkBudgetSettlement {
  const reservation = {
    experimentDigest: input.experimentDigest,
    benchmarkRecordKey: input.benchmarkRecordKey,
    methodId: input.methodId,
    attemptIndex: input.attemptIndex,
    billingProvider: input.billingProvider,
    maximumCostUsdMicros: input.maximumCostUsdMicros,
  };
  if (input.result.ok)
    return {
      ...reservation,
      actualCostUsdMicros: input.result.value.usage.costUsdMicros,
      conservative: false,
      accountingBasis: "provider-reported",
    };
  if (input.result.error.dispatchEvidence === "not-dispatched")
    return {
      ...reservation,
      actualCostUsdMicros: 0,
      conservative: false,
      accountingBasis: "not-dispatched",
    };
  if (
    input.result.error.dispatchEvidence === "dispatched-with-usage" &&
    input.result.error.usage !== undefined
  )
    return {
      ...reservation,
      actualCostUsdMicros: input.result.error.usage.costUsdMicros,
      conservative: false,
      accountingBasis: "provider-reported",
    };
  return {
    ...reservation,
    actualCostUsdMicros: input.maximumCostUsdMicros,
    conservative: true,
    accountingBasis: "authorized-conservative",
  };
}

function budgetedAdapter(
  input: Readonly<{
    experimentDigest: string;
    recordKey: string;
    method: M2CodeModeMethod;
    controller?: BenchmarkBudgetController | undefined;
  }>,
): CodeModeModelAdapter {
  let attemptIndex = 0;
  return {
    ...input.method.adapter,
    async generate(request: CodeModeModelRequest) {
      const currentAttempt = attemptIndex;
      attemptIndex += 1;
      const maximum = calculateMaximumCostUsdMicros(
        input.method.pricing,
        input.method.adapter.inference.maxInputTokens,
        input.method.adapter.inference.maxOutputTokens,
      );
      if (!maximum.ok)
        return {
          ok: false,
          error: {
            code: "BUDGET_RESERVATION_FAILED",
            message: maximum.error.message,
            dispatchEvidence: "not-dispatched",
          },
        };
      const reservation = {
        experimentDigest: input.experimentDigest,
        benchmarkRecordKey: input.recordKey,
        methodId: input.method.id,
        attemptIndex: currentAttempt,
        billingProvider: input.method.pricing.billingProvider,
        maximumCostUsdMicros: maximum.value,
      };
      const reserved = await input.controller?.reserve(reservation);
      if (reserved !== undefined && !reserved.ok)
        return {
          ok: false,
          error: {
            code: "BUDGET_RESERVATION_FAILED",
            message: reserved.error.message,
            dispatchEvidence: "not-dispatched",
          },
        };
      const result = await input.method.adapter.generate(request);
      const settled = await input.controller?.settle(
        settlement({ ...reservation, result }),
      );
      return settled !== undefined && !settled.ok
        ? {
            ok: false,
            error: {
              code: "BUDGET_RESERVATION_FAILED",
              message: settled.error.message,
              dispatchEvidence: "not-dispatched",
            },
          }
        : result;
    },
  };
}

async function recordKey(
  input: Readonly<{
    experimentDigest: string;
    splitDigest: string;
    caseDigest: string;
    methodId: string;
    repetition: number;
  }>,
): Promise<Result<string, Diagnostic>> {
  return digestValue(input);
}

export async function runM2CodeModeBenchmark(
  input: M2CodeModeRunInput,
): Promise<Result<M2CodeModeRunResult, Diagnostic>> {
  const records: Array<M2CodeModeRecord> = [];
  let generatedCount = 0;
  let resumed = 0;
  for (const benchmarkCase of input.cases) {
    const catalog = input.resolveCatalog(benchmarkCase.case.catalogId);
    if (!catalog.ok) return catalog;
    for (const method of input.methods) {
      for (
        let repetition = 0;
        repetition < input.repetitions;
        repetition += 1
      ) {
        const key = await recordKey({
          experimentDigest: input.experimentDigest,
          splitDigest: input.splitDigest,
          caseDigest: benchmarkCase.digest,
          methodId: method.id,
          repetition,
        });
        if (!key.ok) return key;
        const stored = await input.store.load(key.value);
        if (!stored.ok) return stored;
        if (stored.value !== undefined) {
          records.push(stored.value);
          resumed += 1;
          continue;
        }
        const session = await generateCodeMode({
          task: benchmarkCase.case.instruction,
          catalog: catalog.value,
          policy: benchmarkCase.case.policy,
          taskInputs: benchmarkCase.case.taskInputs,
          semanticObligations: benchmarkCase.case.semanticObligations ?? [],
          adapter: budgetedAdapter({
            experimentDigest: input.experimentDigest,
            recordKey: key.value,
            method,
            controller: input.budgetController,
          }),
          strategy: method.strategy,
        });
        if (!session.ok) return session;
        const score = await scoreCodeMode(benchmarkCase, session.value);
        const withoutDigest = {
          key: key.value,
          experimentDigest: input.experimentDigest,
          split: input.split,
          splitDigest: input.splitDigest,
          caseId: benchmarkCase.case.id,
          caseDigest: benchmarkCase.digest,
          methodId: method.id,
          representation: "restricted-typescript-codemode" as const,
          repetition,
          generation: session.value.record,
          score,
        };
        const digest = await digestValue(withoutDigest);
        if (!digest.ok) return digest;
        const record: M2CodeModeRecord = Object.freeze({
          ...withoutDigest,
          digest: digest.value,
        });
        const saved = await input.store.save(record);
        if (!saved.ok) return saved;
        records.push(record);
        generatedCount += 1;
      }
    }
  }
  return {
    ok: true,
    value: {
      records: Object.freeze(records),
      generated: generatedCount,
      resumed,
    },
  };
}

export function createInMemoryM2CodeModeStore(): M2CodeModeStore {
  const records = new Map<string, M2CodeModeRecord>();
  return {
    load: (key) => Promise.resolve({ ok: true, value: records.get(key) }),
    save: (record) => {
      const existing = records.get(record.key);
      if (existing !== undefined && existing.digest !== record.digest)
        return Promise.resolve({
          ok: false,
          error: diagnostic(
            "INTERNAL_INVARIANT_VIOLATION",
            `M2 CodeMode record collision for ${record.key}.`,
          ),
        });
      records.set(record.key, record);
      return Promise.resolve({ ok: true, value: undefined });
    },
  };
}

function pairedBudgetController(
  controller: BenchmarkBudgetController | undefined,
  experimentDigest: string,
): BenchmarkBudgetController | undefined {
  return controller === undefined
    ? undefined
    : {
        reserve: (reservation) =>
          controller.reserve({ ...reservation, experimentDigest }),
        settle: (settlementValue) =>
          controller.settle({ ...settlementValue, experimentDigest }),
      };
}

function sameModelPair(
  ir: BenchmarkCaseRecord,
  codeMode: M2CodeModeRecord,
): boolean {
  return (
    ir.caseId === codeMode.caseId &&
    ir.repetition === codeMode.repetition &&
    ir.model.provider === codeMode.generation.model.provider &&
    ir.model.model === codeMode.generation.model.model
  );
}

function sameInferenceSettings(
  ir: BenchmarkMethod,
  codeMode: M2CodeModeMethod,
): boolean {
  const irInference = canonicalizeJson(ir.adapter.inference);
  const codeModeInference = canonicalizeJson(codeMode.adapter.inference);
  return (
    irInference.ok &&
    codeModeInference.ok &&
    irInference.value === codeModeInference.value &&
    ir.adapter.pricingEntryId === codeMode.pricing.id &&
    codeMode.pricing.billingProvider === codeMode.adapter.identity.provider
  );
}

function irComparison(
  record: BenchmarkCaseRecord,
): M2MatchedRecord["functionalIr"] {
  const initial = record.generation.attempts[0];
  return {
    parseSuccess: initial?.parseSuccess === true,
    firstCompilationSuccess: initial?.compiled === true,
    finalCompilationSuccess: record.generation.finalKind === "compiled",
    finalExecutionSuccess: record.score.executionAttempted
      ? record.score.hiddenEvaluations.every((evaluation) => evaluation.success)
      : null,
    semanticSuccess: record.score.semanticSuccess,
    correctTypedAbstention: record.score.correctAbstention,
    repairCalls: record.generation.repairCount,
    costUsdMicros: record.generation.totalCostUsdMicros,
    latencyMs: record.generation.totalLatencyMs,
    staticallyAnalyzable:
      record.score.runtimeMetrics?.staticallyAnalyzable ?? false,
    predictedActualReconciled:
      record.score.runtimeMetrics?.actualWithinPrediction ?? null,
  };
}

export async function runM2PairedBenchmark(
  input: M2PairedRunInput,
): Promise<Result<M2PairedRunResult, Diagnostic>> {
  const expectedDigest = await createM2PairedExperimentDigest({
    irExperiment: input.irExperiment,
    cases: input.cases,
    repetitions: input.repetitions,
    codeModeMethods: input.codeModeMethods,
  });
  if (!expectedDigest.ok) return expectedDigest;
  if (expectedDigest.value !== input.experimentDigest)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M2 paired experiment digest does not match its exact methods, cases, and subexperiment.",
      ),
    };
  if (
    input.irExperiment.repetitions !== input.repetitions ||
    input.irMethods.length !== input.codeModeMethods.length ||
    input.irMethods.some((method) => {
      const matches = input.codeModeMethods.filter(
        (candidate) =>
          candidate.adapter.identity.provider ===
            method.adapter.identity.provider &&
          candidate.adapter.identity.model === method.adapter.identity.model,
      );
      const match = matches[0];
      return (
        matches.length !== 1 ||
        match === undefined ||
        !sameInferenceSettings(method, match) ||
        method.strategy.id !== "json-schema-with-repair" ||
        match.strategy.constraint !== "json-schema" ||
        match.strategy.repair !== "compiler-guided"
      );
    })
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M2 requires one schema-with-repair IR and CodeMode method with identical provider, model, inference limits, reasoning settings, and pricing identity.",
      ),
    };
  const controller = pairedBudgetController(
    input.budgetController,
    input.experimentDigest,
  );
  const functionalIr = await runBenchmark({
    experiment: input.irExperiment,
    cases: input.cases,
    methods: input.irMethods,
    resolveCatalog: input.resolveCatalog,
    store: input.irStore,
    budgetController: controller,
  });
  if (!functionalIr.ok) return functionalIr;
  const codeMode = await runM2CodeModeBenchmark({
    experimentDigest: input.experimentDigest,
    split: input.split,
    splitDigest: input.splitDigest,
    cases: input.cases,
    methods: input.codeModeMethods,
    repetitions: input.repetitions,
    resolveCatalog: input.resolveCatalog,
    store: input.codeModeStore,
    budgetController: controller,
  });
  if (!codeMode.ok) return codeMode;
  const matched: Array<M2MatchedRecord> = [];
  for (const ir of functionalIr.value.records) {
    const candidates = codeMode.value.records.filter((record) =>
      sameModelPair(ir, record),
    );
    const codeRecord = candidates[0];
    if (candidates.length !== 1 || codeRecord === undefined)
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          `M2 record ${ir.key} does not have exactly one matched CodeMode record.`,
        ),
      };
    const body = {
      caseId: ir.caseId,
      provider: ir.model.provider,
      model: ir.model.model,
      repetition: ir.repetition,
      functionalIr: irComparison(ir),
      codeMode: codeRecord.score,
    };
    const digest = await digestValue(body);
    if (!digest.ok) return digest;
    matched.push(Object.freeze({ ...body, digest: digest.value }));
  }
  if (matched.length !== codeMode.value.records.length)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M2 paired record cardinality differs across representations.",
      ),
    };
  return {
    ok: true,
    value: {
      functionalIr: functionalIr.value,
      codeMode: codeMode.value,
      matched: Object.freeze(matched),
    },
  };
}
