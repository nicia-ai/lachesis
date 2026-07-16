import {
  type Diagnostic,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";

import type { M2MatchedRecord } from "./m2-benchmark.js";

const TANGO_95_PERCENT_Z = 1.959_963_984_540_054;
const ROOT_BOUNDARY_EPSILON = 1e-12;
const ROOT_ITERATIONS = 160;

export const M2_PAIRED_ANALYSIS_PLAN = Object.freeze({
  id: "lachesis-m2-restricted-capability-typescript-paired-analysis",
  version: "2",
  alpha: 0.05,
  statisticalUnit: "case-provider-pair-within-one-repetition",
  repetitions: Object.freeze({
    primary: Object.freeze({ label: "repetition-1", recordIndex: 0 }),
    confirmation: Object.freeze({ label: "repetition-2", recordIndex: 1 }),
    pooledInference: "prohibited",
    conclusionRule:
      "every prospective gate must pass independently in primary and confirmation",
  }),
  semanticNonInferiority: Object.freeze({
    margin: -0.1,
    confidenceLevel: 0.95,
    interval: "tango-1998-asymptotic-score-paired-risk-difference" as const,
    passRule: "lower-confidence-bound-at-least-margin",
    referenceValidation: Object.freeze([
      "newcombe-tango-n50-b12-c2",
      "cran-contingencytables-3.1.0-cavo-2012",
      "cran-contingencytables-3.1.0-zero-cell-boundaries",
    ]),
  }),
  minimumDiscordantPairsForInferentialAdvantage: 10,
  binaryTests: Object.freeze({
    taskCorrectness: "two-sided-exact-mcnemar",
    repairFreeFinalSuccess: "two-sided-exact-mcnemar",
    runtimeFailureFree: "two-sided-exact-mcnemar",
  }),
  continuousTests: Object.freeze({
    costUsdMicros: "provider-stratified-paired-median-and-exact-sign-test",
    latencyMs: "provider-stratified-paired-median-and-exact-sign-test",
  }),
  multiplicity: "report-exact-p-values-without-post-hoc-threshold-changes",
  claimBoundary:
    "A superiority claim requires the minimum discordant-pair count in both repetitions; conventional CodeMode remains unevaluated.",
  prospectiveGates: Object.freeze([
    "schedule-balanced-within-one-pair-per-provider",
    "final-task-correctness-at-least-95-percent-in-each-representation",
    "functional-ir-semantic-noninferiority-95-percent-paired-score-lower-bound-minus-10-percentage-points",
    "no-paired-repair-free-final-success-disadvantage",
    "no-paired-runtime-failure-disadvantage",
    "all-gates-pass-independently-in-primary-and-confirmation",
    "zero-unauthorized-or-contract-mismatched-execution",
  ]),
});

export type M2BinaryPairReport = Readonly<{
  sampleCount: number;
  bothSucceeded: number;
  functionalIrOnly: number;
  restrictedTypeScriptOnly: number;
  neitherSucceeded: number;
  discordantPairs: number;
  functionalIrRate: number | null;
  restrictedTypeScriptRate: number | null;
  pairedDifference: number | null;
  exactMcNemarPValue: number | null;
  inferentiallyEligible: boolean;
  additionalRestrictedTypeScriptWinsToReverseDirection: number;
}>;

export type M2PairedRiskDifferenceInterval = Readonly<{
  method: "tango-1998-asymptotic-score-paired-risk-difference";
  confidenceLevel: 0.95;
  sampleCount: number;
  functionalIrOnly: number;
  restrictedTypeScriptOnly: number;
  estimate: number;
  lowerBound: number;
  upperBound: number;
}>;

export type M2NonInferiorityReport = Readonly<{
  margin: number;
  confidenceLevel: 0.95;
  intervalMethod: M2PairedRiskDifferenceInterval["method"];
  observedDifference: number | null;
  lowerBound: number | null;
  upperBound: number | null;
  passed: boolean;
  conclusion: "pass" | "fail" | "unevaluable";
}>;

export type M2PairedContinuousReport = Readonly<{
  sampleCount: number;
  ties: number;
  functionalIrLower: number;
  restrictedTypeScriptLower: number;
  medianFunctionalIrMinusRestrictedTypeScript: number | null;
  meanFunctionalIrMinusRestrictedTypeScript: number | null;
  exactSignTestPValue: number | null;
}>;

export type M2ProviderStratumReport = Readonly<{
  provider: string;
  records: number;
  taskCorrectness: M2BinaryPairReport;
  feasibleSemanticSuccess: M2BinaryPairReport;
  semanticNonInferiority: M2NonInferiorityReport;
  repairFreeFinalSuccess: M2BinaryPairReport;
  runtimeFailureFree: M2BinaryPairReport;
  cost: M2PairedContinuousReport;
  latency: M2PairedContinuousReport;
}>;

export type M2ProspectiveGateResult = Readonly<{
  id: string;
  passed: boolean;
  detail: string;
}>;

export type M2RepetitionStatisticalReport = Readonly<{
  role: "primary" | "confirmation";
  label: "repetition-1" | "repetition-2";
  repetition: 0 | 1;
  records: number;
  taskCorrectness: M2BinaryPairReport;
  feasibleSemanticSuccess: M2BinaryPairReport;
  repairFreeFinalSuccess: M2BinaryPairReport;
  runtimeFailureFree: M2BinaryPairReport;
  semanticNonInferiority: M2NonInferiorityReport;
  providerStrata: ReadonlyArray<M2ProviderStratumReport>;
  gates: ReadonlyArray<M2ProspectiveGateResult>;
}>;

export type M2PairedStatisticalReport = Readonly<{
  analysisPlan: typeof M2_PAIRED_ANALYSIS_PLAN;
  analysisPlanDigest: string;
  records: number;
  statisticalUnit: "case-provider-pair-within-one-repetition";
  primary: M2RepetitionStatisticalReport;
  confirmation: M2RepetitionStatisticalReport | null;
  gates: ReadonlyArray<M2ProspectiveGateResult>;
  conclusion:
    | "replicated-pass"
    | "replicated-fail"
    | "primary-only-pass"
    | "primary-only-fail";
}>;

function combination(n: number, k: number): number {
  const selected = Math.min(k, n - k);
  let value = 1;
  for (let index = 1; index <= selected; index += 1)
    value = (value * (n - selected + index)) / index;
  return value;
}

function binomialProbability(
  n: number,
  k: number,
  probability: number,
): number {
  if (probability === 0) return k === 0 ? 1 : 0;
  if (probability === 1) return k === n ? 1 : 0;
  return combination(n, k) * probability ** k * (1 - probability) ** (n - k);
}

function binomialLowerTail(
  n: number,
  maximum: number,
  probability: number,
): number {
  let total = 0;
  for (let value = 0; value <= maximum; value += 1)
    total += binomialProbability(n, value, probability);
  return Math.min(1, total);
}

function exactTwoSidedSignPValue(
  positive: number,
  negative: number,
): number | null {
  const discordant = positive + negative;
  return discordant === 0
    ? null
    : Math.min(
        1,
        2 * binomialLowerTail(discordant, Math.min(positive, negative), 0.5),
      );
}

function binaryPairReport(
  pairs: ReadonlyArray<
    Readonly<{ functionalIr: boolean; restricted: boolean }>
  >,
): M2BinaryPairReport {
  const bothSucceeded = pairs.filter(
    (pair) => pair.functionalIr && pair.restricted,
  ).length;
  const functionalIrOnly = pairs.filter(
    (pair) => pair.functionalIr && !pair.restricted,
  ).length;
  const restrictedTypeScriptOnly = pairs.filter(
    (pair) => !pair.functionalIr && pair.restricted,
  ).length;
  const neitherSucceeded =
    pairs.length - bothSucceeded - functionalIrOnly - restrictedTypeScriptOnly;
  const discordantPairs = functionalIrOnly + restrictedTypeScriptOnly;
  return {
    sampleCount: pairs.length,
    bothSucceeded,
    functionalIrOnly,
    restrictedTypeScriptOnly,
    neitherSucceeded,
    discordantPairs,
    functionalIrRate:
      pairs.length === 0
        ? null
        : (bothSucceeded + functionalIrOnly) / pairs.length,
    restrictedTypeScriptRate:
      pairs.length === 0
        ? null
        : (bothSucceeded + restrictedTypeScriptOnly) / pairs.length,
    pairedDifference:
      pairs.length === 0
        ? null
        : (functionalIrOnly - restrictedTypeScriptOnly) / pairs.length,
    exactMcNemarPValue: exactTwoSidedSignPValue(
      functionalIrOnly,
      restrictedTypeScriptOnly,
    ),
    inferentiallyEligible:
      discordantPairs >=
      M2_PAIRED_ANALYSIS_PLAN.minimumDiscordantPairsForInferentialAdvantage,
    additionalRestrictedTypeScriptWinsToReverseDirection:
      functionalIrOnly > restrictedTypeScriptOnly
        ? functionalIrOnly - restrictedTypeScriptOnly
        : 0,
  };
}

function tangoScore(
  delta: number,
  sampleCount: number,
  functionalIrOnly: number,
  restrictedTypeScriptOnly: number,
): number {
  const quadraticA = 2 * sampleCount;
  const quadraticB =
    -functionalIrOnly -
    restrictedTypeScriptOnly +
    (2 * sampleCount - functionalIrOnly + restrictedTypeScriptOnly) * delta;
  const quadraticC = -restrictedTypeScriptOnly * delta * (1 - delta);
  const discriminant = Math.max(
    0,
    quadraticB * quadraticB - 4 * quadraticA * quadraticC,
  );
  const restrictedOnlyMaximumLikelihood =
    (Math.sqrt(discriminant) - quadraticB) / (2 * quadraticA);
  const variance =
    sampleCount * (2 * restrictedOnlyMaximumLikelihood + delta * (1 - delta));
  const numerator =
    functionalIrOnly - restrictedTypeScriptOnly - sampleCount * delta;
  if (variance <= 0)
    return numerator > 0
      ? Number.POSITIVE_INFINITY
      : numerator < 0
        ? Number.NEGATIVE_INFINITY
        : 0;
  return numerator / Math.sqrt(variance);
}

function tangoRoot(
  targetScore: number,
  sampleCount: number,
  functionalIrOnly: number,
  restrictedTypeScriptOnly: number,
): number {
  let lower = -1 + ROOT_BOUNDARY_EPSILON;
  let upper = 1 - ROOT_BOUNDARY_EPSILON;
  for (let iteration = 0; iteration < ROOT_ITERATIONS; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    const score = tangoScore(
      midpoint,
      sampleCount,
      functionalIrOnly,
      restrictedTypeScriptOnly,
    );
    if (score > targetScore) lower = midpoint;
    else upper = midpoint;
  }
  return (lower + upper) / 2;
}

function calculateValidatedInterval(
  sampleCount: number,
  functionalIrOnly: number,
  restrictedTypeScriptOnly: number,
): M2PairedRiskDifferenceInterval {
  const estimate = (functionalIrOnly - restrictedTypeScriptOnly) / sampleCount;
  return {
    method: "tango-1998-asymptotic-score-paired-risk-difference",
    confidenceLevel: 0.95,
    sampleCount,
    functionalIrOnly,
    restrictedTypeScriptOnly,
    estimate,
    lowerBound:
      estimate === -1
        ? -1
        : tangoRoot(
            TANGO_95_PERCENT_Z,
            sampleCount,
            functionalIrOnly,
            restrictedTypeScriptOnly,
          ),
    upperBound:
      estimate === 1
        ? 1
        : tangoRoot(
            -TANGO_95_PERCENT_Z,
            sampleCount,
            functionalIrOnly,
            restrictedTypeScriptOnly,
          ),
  };
}

/** Computes the frozen 95% Tango score interval for a paired risk difference. */
export function calculateM2PairedRiskDifferenceInterval(
  input: Readonly<{
    sampleCount: number;
    functionalIrOnly: number;
    restrictedTypeScriptOnly: number;
  }>,
): Result<M2PairedRiskDifferenceInterval, Diagnostic> {
  const counts = [
    input.sampleCount,
    input.functionalIrOnly,
    input.restrictedTypeScriptOnly,
  ];
  if (
    counts.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    input.sampleCount === 0 ||
    input.functionalIrOnly + input.restrictedTypeScriptOnly > input.sampleCount
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "A paired risk-difference interval requires a positive sample and valid nonnegative discordant counts.",
      ),
    };
  return {
    ok: true,
    value: calculateValidatedInterval(
      input.sampleCount,
      input.functionalIrOnly,
      input.restrictedTypeScriptOnly,
    ),
  };
}

function correctness(record: M2MatchedRecord): Readonly<{
  functionalIr: boolean;
  restricted: boolean;
}> {
  const plannable = record.codeMode.expectedFeasibility === "plannable";
  return plannable
    ? {
        functionalIr: record.functionalIr.semanticSuccess === true,
        restricted: record.codeMode.semanticSuccess === true,
      }
    : {
        functionalIr: record.functionalIr.correctTypedAbstention,
        restricted: record.codeMode.correctTypedAbstention,
      };
}

function nonInferiority(report: M2BinaryPairReport): M2NonInferiorityReport {
  const margin = M2_PAIRED_ANALYSIS_PLAN.semanticNonInferiority.margin;
  if (report.sampleCount === 0 || report.pairedDifference === null)
    return {
      margin,
      confidenceLevel: 0.95,
      intervalMethod: "tango-1998-asymptotic-score-paired-risk-difference",
      observedDifference: null,
      lowerBound: null,
      upperBound: null,
      passed: false,
      conclusion: "unevaluable",
    };
  const interval = calculateValidatedInterval(
    report.sampleCount,
    report.functionalIrOnly,
    report.restrictedTypeScriptOnly,
  );
  const passed = interval.lowerBound >= margin;
  return {
    margin,
    confidenceLevel: interval.confidenceLevel,
    intervalMethod: interval.method,
    observedDifference: interval.estimate,
    lowerBound: interval.lowerBound,
    upperBound: interval.upperBound,
    passed,
    conclusion: passed ? "pass" : "fail",
  };
}

function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) return null;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1];
  return lower === undefined ? null : (lower + upper) / 2;
}

function continuousReport(
  differences: ReadonlyArray<number>,
): M2PairedContinuousReport {
  const functionalIrLower = differences.filter((value) => value < 0).length;
  const restrictedTypeScriptLower = differences.filter(
    (value) => value > 0,
  ).length;
  return {
    sampleCount: differences.length,
    ties: differences.length - functionalIrLower - restrictedTypeScriptLower,
    functionalIrLower,
    restrictedTypeScriptLower,
    medianFunctionalIrMinusRestrictedTypeScript: median(differences),
    meanFunctionalIrMinusRestrictedTypeScript:
      differences.length === 0
        ? null
        : differences.reduce((total, value) => total + value, 0) /
          differences.length,
    exactSignTestPValue: exactTwoSidedSignPValue(
      functionalIrLower,
      restrictedTypeScriptLower,
    ),
  };
}

function pairedMetrics(records: ReadonlyArray<M2MatchedRecord>): Readonly<{
  taskCorrectness: M2BinaryPairReport;
  feasibleSemanticSuccess: M2BinaryPairReport;
  repairFreeFinalSuccess: M2BinaryPairReport;
  runtimeFailureFree: M2BinaryPairReport;
  semanticNonInferiority: M2NonInferiorityReport;
}> {
  const taskCorrectness = binaryPairReport(records.map(correctness));
  const feasible = records.filter(
    (record) => record.codeMode.expectedFeasibility === "plannable",
  );
  const feasibleSemanticSuccess = binaryPairReport(feasible.map(correctness));
  const repairFreeFinalSuccess = binaryPairReport(
    records.map((record) => {
      const correct = correctness(record);
      return {
        functionalIr:
          correct.functionalIr && record.functionalIr.repairCalls === 0,
        restricted: correct.restricted && record.codeMode.repairCalls === 0,
      };
    }),
  );
  const runtimeFailureFree = binaryPairReport(
    records.map((record) => ({
      functionalIr:
        record.functionalIr.runtimeExceptions === 0 &&
        record.functionalIr.timeouts === 0,
      restricted:
        record.codeMode.runtimeExceptions === 0 &&
        record.codeMode.timeouts === 0 &&
        record.codeMode.capabilityViolations === 0 &&
        record.codeMode.budgetViolations === 0,
    })),
  );
  return {
    taskCorrectness,
    feasibleSemanticSuccess,
    repairFreeFinalSuccess,
    runtimeFailureFree,
    semanticNonInferiority: nonInferiority(feasibleSemanticSuccess),
  };
}

function rate(
  report: M2BinaryPairReport,
  side: "functional" | "restricted",
): number {
  return (
    (side === "functional"
      ? report.functionalIrRate
      : report.restrictedTypeScriptRate) ?? 0
  );
}

function repetitionReport(
  records: ReadonlyArray<M2MatchedRecord>,
  repetition: 0 | 1,
  role: "primary" | "confirmation",
): M2RepetitionStatisticalReport {
  const metrics = pairedMetrics(records);
  const providers = [
    ...new Set(records.map((record) => record.provider)),
  ].toSorted();
  const providerStrata = providers.map((provider) => {
    const selected = records.filter((record) => record.provider === provider);
    const providerMetrics = pairedMetrics(selected);
    return {
      provider,
      records: selected.length,
      ...providerMetrics,
      cost: continuousReport(
        selected.map(
          (record) =>
            record.functionalIr.costUsdMicros - record.codeMode.costUsdMicros,
        ),
      ),
      latency: continuousReport(
        selected.map(
          (record) => record.functionalIr.latencyMs - record.codeMode.latencyMs,
        ),
      ),
    };
  });
  const runtimeDisadvantage =
    metrics.runtimeFailureFree.restrictedTypeScriptOnly >
    metrics.runtimeFailureFree.functionalIrOnly;
  const repairDisadvantage =
    metrics.repairFreeFinalSuccess.restrictedTypeScriptOnly >
    metrics.repairFreeFinalSuccess.functionalIrOnly;
  const gates: ReadonlyArray<M2ProspectiveGateResult> = [
    {
      id: "final-task-correctness-functional-ir",
      passed: rate(metrics.taskCorrectness, "functional") >= 0.95,
      detail: `${metrics.taskCorrectness.functionalIrRate ?? "unevaluable"}`,
    },
    {
      id: "final-task-correctness-restricted-capability-typescript",
      passed: rate(metrics.taskCorrectness, "restricted") >= 0.95,
      detail: `${metrics.taskCorrectness.restrictedTypeScriptRate ?? "unevaluable"}`,
    },
    {
      id: "semantic-noninferiority",
      passed: metrics.semanticNonInferiority.passed,
      detail:
        metrics.semanticNonInferiority.lowerBound === null
          ? "unevaluable"
          : `lower=${metrics.semanticNonInferiority.lowerBound};margin=${metrics.semanticNonInferiority.margin}`,
    },
    {
      id: "no-functional-ir-repair-free-success-disadvantage",
      passed: !repairDisadvantage,
      detail: `${metrics.repairFreeFinalSuccess.functionalIrOnly}:${metrics.repairFreeFinalSuccess.restrictedTypeScriptOnly}`,
    },
    {
      id: "no-functional-ir-runtime-failure-disadvantage",
      passed: !runtimeDisadvantage,
      detail: `${metrics.runtimeFailureFree.functionalIrOnly}:${metrics.runtimeFailureFree.restrictedTypeScriptOnly}`,
    },
  ];
  return {
    role,
    label: repetition === 0 ? "repetition-1" : "repetition-2",
    repetition,
    records: records.length,
    ...metrics,
    providerStrata,
    gates,
  };
}

function coordinate(record: M2MatchedRecord): string {
  return [record.caseId, record.provider, record.model].join("\u0000");
}

function validateRepetitions(
  records: ReadonlyArray<M2MatchedRecord>,
): Result<undefined, Diagnostic> {
  if (
    records.some((record) => record.repetition !== 0 && record.repetition !== 1)
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M2 paired inference accepts only frozen primary and confirmation repetitions.",
      ),
    };
  const primary = records.filter((record) => record.repetition === 0);
  const confirmation = records.filter((record) => record.repetition === 1);
  if (records.length > 0 && primary.length === 0)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M2 confirmation cannot be analyzed without its primary repetition.",
      ),
    };
  for (const selected of [primary, confirmation])
    if (new Set(selected.map(coordinate)).size !== selected.length)
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          "M2 repetition analysis contains duplicate case-provider-model coordinates.",
        ),
      };
  if (
    confirmation.length > 0 &&
    primary.map(coordinate).toSorted().join("\n") !==
      confirmation.map(coordinate).toSorted().join("\n")
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M2 confirmation must contain exactly the primary case-provider-model coordinates.",
      ),
    };
  return { ok: true, value: undefined };
}

function combinedGates(
  primary: M2RepetitionStatisticalReport,
  confirmation: M2RepetitionStatisticalReport | null,
): ReadonlyArray<M2ProspectiveGateResult> {
  return primary.gates.map((primaryGate) => {
    const confirmationGate = confirmation?.gates.find(
      (gate) => gate.id === primaryGate.id,
    );
    return {
      id: primaryGate.id,
      passed:
        primaryGate.passed &&
        (confirmationGate === undefined || confirmationGate.passed),
      detail:
        confirmationGate === undefined
          ? `primary=${primaryGate.detail};confirmation=not-run`
          : `primary=${primaryGate.detail};confirmation=${confirmationGate.detail}`,
    };
  });
}

export async function evaluateM2PairedStatistics(
  records: ReadonlyArray<M2MatchedRecord>,
): Promise<Result<M2PairedStatisticalReport, Diagnostic>> {
  const repetitionValidation = validateRepetitions(records);
  if (!repetitionValidation.ok) return repetitionValidation;
  const analysisPlanDigest = await digestValue(M2_PAIRED_ANALYSIS_PLAN);
  if (!analysisPlanDigest.ok) return analysisPlanDigest;
  const primary = repetitionReport(
    records.filter((record) => record.repetition === 0),
    0,
    "primary",
  );
  const confirmationRecords = records.filter(
    (record) => record.repetition === 1,
  );
  const confirmation =
    confirmationRecords.length === 0
      ? null
      : repetitionReport(confirmationRecords, 1, "confirmation");
  const gates = combinedGates(primary, confirmation);
  const passed = gates.every((gate) => gate.passed);
  return {
    ok: true,
    value: {
      analysisPlan: M2_PAIRED_ANALYSIS_PLAN,
      analysisPlanDigest: analysisPlanDigest.value,
      records: records.length,
      statisticalUnit: "case-provider-pair-within-one-repetition",
      primary,
      confirmation,
      gates,
      conclusion:
        confirmation === null
          ? passed
            ? "primary-only-pass"
            : "primary-only-fail"
          : passed
            ? "replicated-pass"
            : "replicated-fail",
    },
  };
}
