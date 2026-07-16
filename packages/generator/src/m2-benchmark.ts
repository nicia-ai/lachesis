import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import type {
  BenchmarkBudgetController,
  BenchmarkBudgetSettlement,
  BenchmarkCaseRecord,
  BenchmarkMethod,
  BenchmarkRecordCoordinate,
  BenchmarkRecordCoordinator,
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
  codeModeGenerationRecordSchema,
  type CodeModeGenerationStrategy,
  type CodeModeModelAdapter,
  type CodeModeModelRequest,
  generateCodeMode,
} from "./codemode-model.js";
import type { ExperimentManifest } from "./experiment.js";
import {
  evaluateM2PairedStatistics,
  M2_PAIRED_ANALYSIS_PLAN,
  type M2PairedStatisticalReport,
} from "./m2-statistics.js";
import type { ModelAdapterFailure, ModelResponse } from "./model.js";
import { calculateMaximumCostUsdMicros, type PricingEntry } from "./pricing.js";

export const M2_SUPERSEDED_M21_IDENTITIES = Object.freeze({
  status: "superseded-unexecuted" as const,
  reason:
    "M2.2 corrects the repeated-measures analysis and separates theoretical ceilings from operational authorization.",
  sourceCommit: "e26e76b8cbae7bfa827dfd2deb97773afe41ff70",
  campaignDigest:
    "09e8ee6cb1fd090f80f7be4fd14e8b1fd746e815b2a409fce1bdcdd72f38ca68",
  phases: Object.freeze([
    Object.freeze({
      phase: "m2-protocol-probe",
      experimentDigest:
        "490f8fb3b8434be554d4fbd1a5d046f21e1db8f07309b2536bc16d576182f7de",
      phaseManifestDigest:
        "d4cd75b520f59b04b3b0909755cdcc44bc755cafe1003c832d0af51fb8792e7a",
      scheduleDigest:
        "39145d62334d1b2639523a70202688b9839d0b0b03d3c915e0a871a6d0692eac",
    }),
    Object.freeze({
      phase: "m2-calibration",
      experimentDigest:
        "963796612f6069fe9deeecb93be48ad0d5e048e2aae6468d6faac9f1b80daa18",
      phaseManifestDigest:
        "75e343c037908e3eaf49cf1dce8f71f615a2458117c7cdca257628ccf6c4dba7",
      scheduleDigest:
        "e9acc7e18a1d9571cedf816eaf2fb44071eee204bcb99c4ad4587ee88d4218ab",
    }),
    Object.freeze({
      phase: "m2-heldout",
      experimentDigest:
        "b0fa6ece4b82f4148a221851f5e763b19912c64e6039eeed0e40c6feaed450b0",
      phaseManifestDigest:
        "2438859664cc75b85ba274479e5954ace5555876f558a54725c893120e349df7",
      scheduleDigest:
        "5d938cd744e21e3d11d0f5ab43309c18646cee2645e07812d590b2adb355756f",
    }),
  ]),
});

export const M2_SUPERSEDED_M22_IDENTITIES = Object.freeze({
  status: "superseded-after-protocol-probe-failure" as const,
  reason:
    "M2.3 corrects deterministic prompt/compiler drift discovered before calibration or held-out access.",
  sourceCommit: "933dfc62235658597cf5bbcc0d4c5247571965d1",
  campaignDigest:
    "918ae344d9f52bbd97d683e18c7decf678046e8f75ce21b3a6274dc9916f5b14",
  phases: Object.freeze([
    Object.freeze({
      status: "failed-report-only" as const,
      phase: "m2-protocol-probe",
      experimentDigest:
        "0a8c35b940f269bf6006e2811dfb8716e3d6fe11c98668963f8ccedb17f4bb56",
      phaseManifestDigest:
        "d4100414bd42712d980a62db130c21891a8504f2199f15d9d270f12d4b641747",
      scheduleDigest:
        "39145d62334d1b2639523a70202688b9839d0b0b03d3c915e0a871a6d0692eac",
    }),
    Object.freeze({
      status: "superseded-unexecuted" as const,
      phase: "m2-calibration",
      experimentDigest:
        "79bf9900e25c3129db90476da6e6f3a989bfc6e7a0ca6794e9a91a3d15aab28c",
      phaseManifestDigest:
        "5a43c109619a82003abb7fb7a46bf1a87caead52a0114b7c8d1b21be76f0cf91",
      scheduleDigest:
        "e9acc7e18a1d9571cedf816eaf2fb44071eee204bcb99c4ad4587ee88d4218ab",
    }),
    Object.freeze({
      status: "superseded-unexecuted" as const,
      phase: "m2-heldout",
      experimentDigest:
        "98e7da38be47b220198a5ab6d2907f3d203134f0d57f9006845b576bd2b2a2eb",
      phaseManifestDigest:
        "cf857f08bc4fe7eb488afd162043abaf8c1f1eff1734bc0930a7d481f472cc8e",
      scheduleDigest:
        "5d938cd744e21e3d11d0f5ab43309c18646cee2645e07812d590b2adb355756f",
    }),
  ]),
});

export const M2_COMPARISON_PROTOCOL = Object.freeze({
  id: "lachesis-m2-functional-ir-vs-restricted-capability-typescript",
  version: "4",
  primaryComparison: Object.freeze([
    "functional-ir-with-typed-obligations",
    "restricted-capability-typescript-with-typed-obligations",
  ]),
  claimBoundary: "representation-ablation-only; no conventional-CodeMode claim",
  schedule: "content-addressed-provider-stratified-counterbalance/2",
  repeatedMeasures:
    "repetition-1(record-index-0)-primary;repetition-2(record-index-1)-independent-confirmation;pooling-prohibited",
  supersedes: Object.freeze([
    M2_SUPERSEDED_M21_IDENTITIES,
    M2_SUPERSEDED_M22_IDENTITIES,
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

export type M2Representation =
  "functional-ir" | "restricted-capability-typescript";

const m2ScheduleEntrySchema = z
  .strictObject({
    pairDigest: z.string().min(1),
    counterbalanceHash: z.string().min(1),
    caseId: z.string().min(1),
    caseDigest: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    repetition: z.number().int().nonnegative(),
    order: z
      .tuple([
        z.enum(["functional-ir", "restricted-capability-typescript"]),
        z.enum(["functional-ir", "restricted-capability-typescript"]),
      ])
      .readonly(),
  })
  .readonly();

export const m2CounterbalancedScheduleSchema = z
  .strictObject({
    formatVersion: z.literal("2"),
    algorithm: z.literal(
      "sha256-case-provider-repetition/provider-stratified-global-balance-v2",
    ),
    entries: z.array(m2ScheduleEntrySchema).min(1).readonly(),
    scheduleDigest: z.string().min(1),
  })
  .readonly();

export type M2ScheduleEntry = z.infer<typeof m2ScheduleEntrySchema>;
export type M2CounterbalancedSchedule = z.infer<
  typeof m2CounterbalancedScheduleSchema
>;

type ScheduleCoordinate = Readonly<{
  caseId: string;
  caseDigest: string;
  provider: string;
  model: string;
  repetition: number;
}>;

function coordinateKey(coordinate: ScheduleCoordinate): string {
  return [
    coordinate.caseId,
    coordinate.caseDigest,
    coordinate.provider,
    coordinate.model,
    String(coordinate.repetition),
  ].join("\u0000");
}

function compareCoordinates(
  left: ScheduleCoordinate,
  right: ScheduleCoordinate,
): number {
  const leftKey = [
    left.caseId,
    left.caseDigest,
    left.provider,
    left.model,
  ].join("\u0000");
  const rightKey = [
    right.caseId,
    right.caseDigest,
    right.provider,
    right.model,
  ].join("\u0000");
  return leftKey < rightKey
    ? -1
    : leftKey > rightKey
      ? 1
      : left.repetition - right.repetition;
}

export async function createM2CounterbalancedSchedule(
  input: Readonly<{
    cases: ReadonlyArray<FrozenPlanGenerationCase>;
    methods: ReadonlyArray<M2CodeModeMethod>;
    repetitions: number;
  }>,
): Promise<Result<M2CounterbalancedSchedule, Diagnostic>> {
  return createM2CounterbalancedScheduleFromIdentity({
    cases: input.cases.map((item) => ({
      id: item.case.id,
      digest: item.digest,
    })),
    methods: input.methods.map((method) => ({
      provider: method.adapter.identity.provider,
      model: method.adapter.identity.model,
    })),
    repetitions: input.repetitions,
  });
}

export async function createM2CounterbalancedScheduleFromIdentity(
  input: Readonly<{
    cases: ReadonlyArray<Readonly<{ id: string; digest: string }>>;
    methods: ReadonlyArray<Readonly<{ provider: string; model: string }>>;
    repetitions: number;
  }>,
): Promise<Result<M2CounterbalancedSchedule, Diagnostic>> {
  if (
    !Number.isSafeInteger(input.repetitions) ||
    input.repetitions <= 0 ||
    input.cases.length === 0 ||
    input.methods.length === 0
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M2 schedule requires cases, methods, and a positive repetition count.",
      ),
    };
  const providers = input.methods
    .map((method) => ({ ...method }))
    .toSorted((left, right) => {
      const leftKey = `${left.provider}\u0000${left.model}`;
      const rightKey = `${right.provider}\u0000${right.model}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  if (
    new Set(providers.map((item) => `${item.provider}\u0000${item.model}`))
      .size !== providers.length
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M2 schedule requires exactly one method per provider/model pair.",
      ),
    };
  const seeded: Array<
    ScheduleCoordinate &
      Readonly<{ pairDigest: string; counterbalanceHash: string }>
  > = [];
  for (const benchmarkCase of input.cases.toSorted((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  ))
    for (const provider of providers)
      for (
        let repetition = 0;
        repetition < input.repetitions;
        repetition += 1
      ) {
        const coordinate = {
          caseId: benchmarkCase.id,
          caseDigest: benchmarkCase.digest,
          provider: provider.provider,
          model: provider.model,
          repetition,
        };
        const hash = await digestValue(coordinate);
        if (!hash.ok) return hash;
        seeded.push({
          ...coordinate,
          pairDigest: hash.value,
          counterbalanceHash: hash.value,
        });
      }
  const assigned = new Map<string, M2ScheduleEntry["order"]>();
  let globalIrFirst = 0;
  let globalTypescriptFirst = 0;
  for (const provider of providers) {
    const group = seeded
      .filter(
        (entry) =>
          entry.provider === provider.provider &&
          entry.model === provider.model,
      )
      .toSorted((left, right) =>
        left.counterbalanceHash < right.counterbalanceHash
          ? -1
          : left.counterbalanceHash > right.counterbalanceHash
            ? 1
            : 0,
      );
    const hashStartsWithIr =
      Number.parseInt(group[0]?.counterbalanceHash.slice(0, 2) ?? "0", 16) %
        2 ===
      0;
    const startsWithIr =
      group.length % 2 === 0
        ? hashStartsWithIr
        : globalIrFirst < globalTypescriptFirst
          ? true
          : globalTypescriptFirst < globalIrFirst
            ? false
            : hashStartsWithIr;
    for (const [index, entry] of group.entries()) {
      const irFirst = index % 2 === 0 ? startsWithIr : !startsWithIr;
      if (irFirst) globalIrFirst += 1;
      else globalTypescriptFirst += 1;
      assigned.set(
        coordinateKey(entry),
        irFirst
          ? ["functional-ir", "restricted-capability-typescript"]
          : ["restricted-capability-typescript", "functional-ir"],
      );
    }
  }
  const entries = seeded.toSorted(compareCoordinates).map((entry) => ({
    ...entry,
    order:
      assigned.get(coordinateKey(entry)) ??
      (["functional-ir", "restricted-capability-typescript"] as const),
  }));
  const body = {
    formatVersion: "2" as const,
    algorithm:
      "sha256-case-provider-repetition/provider-stratified-global-balance-v2" as const,
    entries,
  };
  const digest = await digestValue(body);
  if (!digest.ok) return digest;
  return {
    ok: true,
    value: m2CounterbalancedScheduleSchema.parse({
      ...body,
      scheduleDigest: digest.value,
    }),
  };
}

export type M2CodeModeMethod = Readonly<{
  id: string;
  adapter: CodeModeModelAdapter;
  strategy: CodeModeGenerationStrategy;
  pricing: PricingEntry;
}>;

export type M2CodeModeMethodIdentity = Readonly<{
  id: string;
  model: CodeModeModelAdapter["identity"];
  inference: CodeModeModelAdapter["inference"];
  strategy: CodeModeGenerationStrategy;
  pricingEntryId: string;
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
  representation: "restricted-capability-typescript";
  repetition: number;
  generation: CodeModeGenerationRecord;
  score: M2CodeModeScore;
  digest: string;
}>;

const runtimeUsageSchema = z
  .strictObject({
    operationCalls: z.number().int().nonnegative(),
    effectCalls: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
    wallClockMs: z.number().int().nonnegative(),
  })
  .readonly();

const m2CodeModeScoreSchema = z
  .strictObject({
    expectedFeasibility: z.enum(["plannable", "unplannable"]),
    parseTranspileSuccess: z.boolean(),
    firstCompilationSuccess: z.boolean(),
    finalCompilationSuccess: z.boolean(),
    firstExecutionSuccess: z.boolean().nullable(),
    finalExecutionSuccess: z.boolean().nullable(),
    semanticSuccess: z.boolean().nullable(),
    correctTypedAbstention: z.boolean(),
    runtimeExceptions: z.number().int().nonnegative(),
    timeouts: z.number().int().nonnegative(),
    capabilityViolations: z.number().int().nonnegative(),
    budgetViolations: z.number().int().nonnegative(),
    repairCalls: z.number().int().nonnegative(),
    costUsdMicros: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
    staticallyAnalyzable: z.boolean(),
    resources: z
      .strictObject({
        predicted: runtimeUsageSchema.nullable(),
        actual: runtimeUsageSchema,
        actualWithinPrediction: z.boolean().nullable(),
      })
      .readonly(),
  })
  .readonly() satisfies z.ZodType<M2CodeModeScore>;

export const m2CodeModeRecordSchema = z
  .strictObject({
    key: z.string(),
    experimentDigest: z.string(),
    split: z.enum(["development", "heldout"]),
    splitDigest: z.string(),
    caseId: z.string(),
    caseDigest: z.string(),
    methodId: z.string(),
    representation: z.literal("restricted-capability-typescript"),
    repetition: z.number().int().nonnegative(),
    generation: codeModeGenerationRecordSchema,
    score: m2CodeModeScoreSchema,
    digest: z.string(),
  })
  .readonly() satisfies z.ZodType<M2CodeModeRecord>;

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
  recordCoordinator?: BenchmarkRecordCoordinator | undefined;
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
  scheduleDigest: string;
  executionOrder: M2ScheduleEntry["order"];
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
    runtimeExceptions: number;
    timeouts: number;
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
  schedule: M2CounterbalancedSchedule;
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
  statistics: M2PairedStatisticalReport;
}>;

export async function createM2PairedExperimentDigest(
  input: Readonly<{
    irExperiment: ExperimentManifest;
    cases: ReadonlyArray<FrozenPlanGenerationCase>;
    repetitions: number;
    codeModeMethods: ReadonlyArray<M2CodeModeMethod>;
    schedule: M2CounterbalancedSchedule;
  }>,
): Promise<Result<string, Diagnostic>> {
  return createM2PairedExperimentDigestFromIdentity({
    irExperiment: input.irExperiment,
    cases: input.cases.map((item) => ({
      id: item.case.id,
      digest: item.digest,
    })),
    repetitions: input.repetitions,
    schedule: input.schedule,
    codeModeMethods: input.codeModeMethods.map((method) => ({
      id: method.id,
      model: method.adapter.identity,
      inference: method.adapter.inference,
      strategy: method.strategy,
      pricingEntryId: method.pricing.id,
    })),
  });
}

export async function createM2PairedExperimentDigestFromIdentity(
  input: Readonly<{
    irExperiment: ExperimentManifest;
    cases: ReadonlyArray<Readonly<{ id: string; digest: string }>>;
    repetitions: number;
    codeModeMethods: ReadonlyArray<M2CodeModeMethodIdentity>;
    schedule: M2CounterbalancedSchedule;
  }>,
): Promise<Result<string, Diagnostic>> {
  return digestValue({
    protocol: M2_COMPARISON_PROTOCOL,
    analysisPlan: M2_PAIRED_ANALYSIS_PLAN,
    functionalIrExperimentDigest: input.irExperiment.experimentDigest,
    cases: input.cases.toSorted((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    ),
    repetitions: input.repetitions,
    scheduleDigest: input.schedule.scheduleDigest,
    codeModeMethods: input.codeModeMethods.toSorted((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    ),
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
        const coordinate = {
          caseId: benchmarkCase.case.id,
          caseDigest: benchmarkCase.digest,
          provider: method.adapter.identity.provider,
          model: method.adapter.identity.model,
          repetition,
        };
        const admitted =
          await input.recordCoordinator?.beforeRecord(coordinate);
        if (admitted !== undefined && !admitted.ok) return admitted;
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
          const completed =
            await input.recordCoordinator?.afterRecord(coordinate);
          if (completed !== undefined && !completed.ok) return completed;
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
          representation: "restricted-capability-typescript" as const,
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
        const completed =
          await input.recordCoordinator?.afterRecord(coordinate);
        if (completed !== undefined && !completed.ok) return completed;
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

async function verifyM2CounterbalancedSchedule(
  schedule: M2CounterbalancedSchedule,
  input: Readonly<{
    cases: ReadonlyArray<FrozenPlanGenerationCase>;
    methods: ReadonlyArray<M2CodeModeMethod>;
    repetitions: number;
  }>,
): Promise<Result<void, Diagnostic>> {
  const parsed = m2CounterbalancedScheduleSchema.safeParse(schedule);
  if (!parsed.success)
    return {
      ok: false,
      error: diagnostic("INVALID_WIRE_SCHEMA", "Invalid M2 schedule shape."),
    };
  const { scheduleDigest, ...body } = parsed.data;
  const digest = await digestValue(body);
  if (!digest.ok) return digest;
  const expected = await createM2CounterbalancedSchedule(input);
  if (!expected.ok) return expected;
  const actualJson = canonicalizeJson(parsed.data);
  const expectedJson = canonicalizeJson(expected.value);
  if (
    digest.value !== scheduleDigest ||
    !actualJson.ok ||
    !expectedJson.ok ||
    actualJson.value !== expectedJson.value
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M2 schedule is not the exact deterministic counterbalance for this matrix.",
      ),
    };
  return { ok: true, value: undefined };
}

type ScheduleWaiter = Readonly<{
  representation: M2Representation;
  coordinate: BenchmarkRecordCoordinate;
  resolve: (result: Result<void, Diagnostic>) => void;
}>;

function createScheduleCoordinator(
  schedule: M2CounterbalancedSchedule,
): Readonly<{
  forRepresentation: (
    representation: M2Representation,
  ) => BenchmarkRecordCoordinator;
  abort: (error: Diagnostic) => void;
}> {
  let index = 0;
  let stage = 0;
  let inFlight: ScheduleWaiter | undefined;
  let aborted: Diagnostic | undefined;
  const waiters: Array<ScheduleWaiter> = [];
  const entryIndexes = new Map(
    schedule.entries.map((entry, entryIndex) => [
      coordinateKey(entry),
      entryIndex,
    ]),
  );
  const pump = (): void => {
    for (
      let waiterIndex = waiters.length - 1;
      waiterIndex >= 0;
      waiterIndex -= 1
    ) {
      const waiter = waiters[waiterIndex];
      if (waiter === undefined) continue;
      if (aborted !== undefined) {
        waiters.splice(waiterIndex, 1);
        waiter.resolve({ ok: false, error: aborted });
        continue;
      }
      if (inFlight !== undefined) continue;
      const current = schedule.entries[index];
      if (
        current !== undefined &&
        coordinateKey(current) === coordinateKey(waiter.coordinate) &&
        current.order[stage] === waiter.representation
      ) {
        waiters.splice(waiterIndex, 1);
        inFlight = waiter;
        waiter.resolve({ ok: true, value: undefined });
      }
    }
  };
  const fail = (message: string): Result<void, Diagnostic> => {
    const error = diagnostic("INVALID_WIRE_SCHEMA", message);
    aborted = error;
    pump();
    return { ok: false, error };
  };
  const forRepresentation = (
    representation: M2Representation,
  ): BenchmarkRecordCoordinator => ({
    beforeRecord: (coordinate) => {
      const scheduledIndex = entryIndexes.get(coordinateKey(coordinate));
      if (scheduledIndex === undefined)
        return Promise.resolve(
          fail("M2 runner reached a record absent from its frozen schedule."),
        );
      if (scheduledIndex < index)
        return Promise.resolve(
          fail("M2 runner attempted to redispatch an already completed pair."),
        );
      return new Promise((resolve) => {
        waiters.push({ representation, coordinate, resolve });
        pump();
      });
    },
    afterRecord: (coordinate) => {
      const active = inFlight;
      if (
        active?.representation !== representation ||
        coordinateKey(active.coordinate) !== coordinateKey(coordinate)
      )
        return Promise.resolve(
          fail("M2 runner completed a record outside its frozen schedule."),
        );
      inFlight = undefined;
      stage += 1;
      if (stage === 2) {
        stage = 0;
        index += 1;
      }
      pump();
      return Promise.resolve({ ok: true, value: undefined });
    },
  });
  return {
    forRepresentation,
    abort: (error) => {
      aborted = error;
      pump();
    },
  };
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
    runtimeExceptions: record.score.runtimeMetrics?.runtimeExceptions ?? 0,
    timeouts: record.score.runtimeMetrics?.timeouts ?? 0,
    staticallyAnalyzable:
      record.score.runtimeMetrics?.staticallyAnalyzable ?? false,
    predictedActualReconciled:
      record.score.runtimeMetrics?.actualWithinPrediction ?? null,
  };
}

export async function runM2PairedBenchmark(
  input: M2PairedRunInput,
): Promise<Result<M2PairedRunResult, Diagnostic>> {
  const scheduleVerified = await verifyM2CounterbalancedSchedule(
    input.schedule,
    {
      cases: input.cases,
      methods: input.codeModeMethods,
      repetitions: input.repetitions,
    },
  );
  if (!scheduleVerified.ok) return scheduleVerified;
  const expectedDigest = await createM2PairedExperimentDigest({
    irExperiment: input.irExperiment,
    cases: input.cases,
    repetitions: input.repetitions,
    codeModeMethods: input.codeModeMethods,
    schedule: input.schedule,
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
        match.strategy.constraint !== "json-schema" ||
        method.strategy.constraint !== match.strategy.constraint ||
        method.strategy.repair !== match.strategy.repair ||
        method.strategy.id !==
          (match.strategy.repair === "compiler-guided"
            ? "json-schema-with-repair"
            : "json-schema")
      );
    })
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M2 requires one paired IR and restricted-TypeScript method with identical constraint, repair policy, provider, model, inference limits, reasoning settings, and pricing identity.",
      ),
    };
  const controller = pairedBudgetController(
    input.budgetController,
    input.experimentDigest,
  );
  const orderedCases = input.cases.toSorted((left, right) =>
    left.case.id < right.case.id ? -1 : left.case.id > right.case.id ? 1 : 0,
  );
  const methodOrder = (
    left: Readonly<{
      adapter: Readonly<{
        identity: Readonly<{ provider: string; model: string }>;
      }>;
    }>,
    right: Readonly<{
      adapter: Readonly<{
        identity: Readonly<{ provider: string; model: string }>;
      }>;
    }>,
  ): number => {
    const leftKey = `${left.adapter.identity.provider}\u0000${left.adapter.identity.model}`;
    const rightKey = `${right.adapter.identity.provider}\u0000${right.adapter.identity.model}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  };
  const orderedIrMethods = input.irMethods.toSorted(methodOrder);
  const orderedCodeModeMethods = input.codeModeMethods.toSorted(methodOrder);
  const scheduleCoordinator = createScheduleCoordinator(input.schedule);
  const functionalIrPromise = runBenchmark({
    experiment: input.irExperiment,
    cases: orderedCases,
    methods: orderedIrMethods,
    resolveCatalog: input.resolveCatalog,
    store: input.irStore,
    budgetController: controller,
    recordCoordinator: scheduleCoordinator.forRepresentation("functional-ir"),
  }).then((result) => {
    if (!result.ok) scheduleCoordinator.abort(result.error);
    return result;
  });
  const codeModePromise = runM2CodeModeBenchmark({
    experimentDigest: input.experimentDigest,
    split: input.split,
    splitDigest: input.splitDigest,
    cases: orderedCases,
    methods: orderedCodeModeMethods,
    repetitions: input.repetitions,
    resolveCatalog: input.resolveCatalog,
    store: input.codeModeStore,
    budgetController: controller,
    recordCoordinator: scheduleCoordinator.forRepresentation(
      "restricted-capability-typescript",
    ),
  }).then((result) => {
    if (!result.ok) scheduleCoordinator.abort(result.error);
    return result;
  });
  const [functionalIr, codeMode] = await Promise.all([
    functionalIrPromise,
    codeModePromise,
  ]);
  if (!functionalIr.ok) return functionalIr;
  if (!codeMode.ok) return codeMode;
  const matched = await matchM2PairedRecords({
    functionalIr: functionalIr.value.records,
    codeMode: codeMode.value.records,
    schedule: input.schedule,
  });
  if (!matched.ok) return matched;
  const statistics = await evaluateM2PairedStatistics(matched.value);
  if (!statistics.ok) return statistics;
  return {
    ok: true,
    value: {
      functionalIr: functionalIr.value,
      codeMode: codeMode.value,
      matched: matched.value,
      statistics: statistics.value,
    },
  };
}

export async function matchM2PairedRecords(
  input: Readonly<{
    functionalIr: ReadonlyArray<BenchmarkCaseRecord>;
    codeMode: ReadonlyArray<M2CodeModeRecord>;
    schedule: M2CounterbalancedSchedule;
  }>,
): Promise<Result<ReadonlyArray<M2MatchedRecord>, Diagnostic>> {
  const matched: Array<M2MatchedRecord> = [];
  for (const ir of input.functionalIr) {
    const candidates = input.codeMode.filter((record) =>
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
    const scheduleEntry = input.schedule.entries.find(
      (entry) =>
        entry.caseId === ir.caseId &&
        entry.caseDigest === ir.caseDigest &&
        entry.provider === ir.model.provider &&
        entry.model === ir.model.model &&
        entry.repetition === ir.repetition,
    );
    if (scheduleEntry === undefined)
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          `M2 record ${ir.key} has no persisted schedule entry.`,
        ),
      };
    const body = {
      caseId: ir.caseId,
      provider: ir.model.provider,
      model: ir.model.model,
      repetition: ir.repetition,
      scheduleDigest: input.schedule.scheduleDigest,
      executionOrder: scheduleEntry.order,
      functionalIr: irComparison(ir),
      codeMode: codeRecord.score,
    };
    const digest = await digestValue(body);
    if (!digest.ok) return digest;
    matched.push(Object.freeze({ ...body, digest: digest.value }));
  }
  if (matched.length !== input.codeMode.length)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M2 paired record cardinality differs across representations.",
      ),
    };
  return { ok: true, value: Object.freeze(matched) };
}
