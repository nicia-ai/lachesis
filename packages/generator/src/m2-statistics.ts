import { type Diagnostic, digestValue, type Result } from "@nicia-ai/lachesis";

import type { M2MatchedRecord } from "./m2-benchmark.js";

export const M2_PAIRED_ANALYSIS_PLAN = Object.freeze({
  id: "lachesis-m2-restricted-capability-typescript-paired-analysis",
  version: "1",
  alpha: 0.05,
  semanticNonInferiorityMargin: -0.1,
  minimumDiscordantPairsForInferentialAdvantage: 10,
  minimumAdversePairsToOverturnMarginForSensitivity: 5,
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
    "A superiority claim requires the minimum discordant-pair count; otherwise report sensitivity only.",
  prospectiveGates: Object.freeze([
    "schedule-balanced-within-one-pair-per-provider",
    "final-task-correctness-at-least-95-percent-in-each-representation",
    "functional-ir-semantic-noninferiority-margin-minus-10-percentage-points",
    "no-paired-repair-free-final-success-disadvantage",
    "no-paired-runtime-failure-disadvantage",
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

export type M2NonInferiorityReport = Readonly<{
  margin: number;
  observedDifference: number | null;
  observedMarginSatisfied: boolean;
  exactConditionalPValue: number | null;
  inferentiallyEligible: boolean;
  additionalAdverseDiscordancesToCrossMargin: number;
  sensitivitySatisfied: boolean;
  conclusion: "inferential-pass" | "inferential-fail" | "sensitivity-only";
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
  cost: M2PairedContinuousReport;
  latency: M2PairedContinuousReport;
}>;

export type M2ProspectiveGateResult = Readonly<{
  id: string;
  passed: boolean;
  detail: string;
}>;

export type M2PairedStatisticalReport = Readonly<{
  analysisPlan: typeof M2_PAIRED_ANALYSIS_PLAN;
  analysisPlanDigest: string;
  records: number;
  taskCorrectness: M2BinaryPairReport;
  feasibleSemanticSuccess: M2BinaryPairReport;
  repairFreeFinalSuccess: M2BinaryPairReport;
  runtimeFailureFree: M2BinaryPairReport;
  semanticNonInferiority: M2NonInferiorityReport;
  providerStrata: ReadonlyArray<M2ProviderStratumReport>;
  gates: ReadonlyArray<M2ProspectiveGateResult>;
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

function binomialUpperTail(
  n: number,
  minimum: number,
  probability: number,
): number {
  let total = 0;
  for (let value = minimum; value <= n; value += 1)
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

function additionalLossesToCross(
  positive: number,
  negative: number,
  sampleCount: number,
  boundary: number,
): number {
  for (let added = 0; added <= sampleCount + 1; added += 1)
    if ((positive - negative - added) / (sampleCount + added) < boundary)
      return added;
  return sampleCount + 1;
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
  const margin = M2_PAIRED_ANALYSIS_PLAN.semanticNonInferiorityMargin;
  const discordant = report.discordantPairs;
  const nullProbability =
    discordant === 0
      ? null
      : (discordant + margin * report.sampleCount) / (2 * discordant);
  const exactConditionalPValue =
    nullProbability === null
      ? null
      : nullProbability <= 0
        ? 0
        : nullProbability >= 1
          ? 1
          : binomialUpperTail(
              discordant,
              report.functionalIrOnly,
              nullProbability,
            );
  const additionalAdverseDiscordancesToCrossMargin =
    report.sampleCount === 0
      ? 0
      : additionalLossesToCross(
          report.functionalIrOnly,
          report.restrictedTypeScriptOnly,
          report.sampleCount,
          margin,
        );
  const observedMarginSatisfied =
    report.pairedDifference !== null && report.pairedDifference >= margin;
  const inferentiallyEligible = report.inferentiallyEligible;
  const inferentialPass =
    inferentiallyEligible &&
    observedMarginSatisfied &&
    exactConditionalPValue !== null &&
    exactConditionalPValue <= M2_PAIRED_ANALYSIS_PLAN.alpha;
  const sensitivitySatisfied =
    observedMarginSatisfied &&
    additionalAdverseDiscordancesToCrossMargin >=
      M2_PAIRED_ANALYSIS_PLAN.minimumAdversePairsToOverturnMarginForSensitivity;
  return {
    margin,
    observedDifference: report.pairedDifference,
    observedMarginSatisfied,
    exactConditionalPValue,
    inferentiallyEligible,
    additionalAdverseDiscordancesToCrossMargin,
    sensitivitySatisfied,
    conclusion: inferentiallyEligible
      ? inferentialPass
        ? "inferential-pass"
        : "inferential-fail"
      : "sensitivity-only",
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

export async function evaluateM2PairedStatistics(
  records: ReadonlyArray<M2MatchedRecord>,
): Promise<Result<M2PairedStatisticalReport, Diagnostic>> {
  const analysisPlanDigest = await digestValue(M2_PAIRED_ANALYSIS_PLAN);
  if (!analysisPlanDigest.ok) return analysisPlanDigest;
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
  const semanticNonInferiority = nonInferiority(feasibleSemanticSuccess);
  const providers = [
    ...new Set(records.map((record) => record.provider)),
  ].toSorted();
  const providerStrata = providers.map((provider) => {
    const selected = records.filter((record) => record.provider === provider);
    return {
      provider,
      records: selected.length,
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
    runtimeFailureFree.restrictedTypeScriptOnly >
    runtimeFailureFree.functionalIrOnly;
  const repairDisadvantage =
    repairFreeFinalSuccess.restrictedTypeScriptOnly >
    repairFreeFinalSuccess.functionalIrOnly;
  const gates: ReadonlyArray<M2ProspectiveGateResult> = [
    {
      id: "final-task-correctness-functional-ir",
      passed: rate(taskCorrectness, "functional") >= 0.95,
      detail: `${taskCorrectness.functionalIrRate ?? "unevaluable"}`,
    },
    {
      id: "final-task-correctness-restricted-capability-typescript",
      passed: rate(taskCorrectness, "restricted") >= 0.95,
      detail: `${taskCorrectness.restrictedTypeScriptRate ?? "unevaluable"}`,
    },
    {
      id: "semantic-noninferiority",
      passed:
        semanticNonInferiority.observedMarginSatisfied &&
        (semanticNonInferiority.conclusion === "inferential-pass" ||
          semanticNonInferiority.sensitivitySatisfied),
      detail: semanticNonInferiority.conclusion,
    },
    {
      id: "no-functional-ir-repair-free-success-disadvantage",
      passed: !repairDisadvantage,
      detail: `${repairFreeFinalSuccess.functionalIrOnly}:${repairFreeFinalSuccess.restrictedTypeScriptOnly}`,
    },
    {
      id: "no-functional-ir-runtime-failure-disadvantage",
      passed: !runtimeDisadvantage,
      detail: `${runtimeFailureFree.functionalIrOnly}:${runtimeFailureFree.restrictedTypeScriptOnly}`,
    },
  ];
  return {
    ok: true,
    value: {
      analysisPlan: M2_PAIRED_ANALYSIS_PLAN,
      analysisPlanDigest: analysisPlanDigest.value,
      records: records.length,
      taskCorrectness,
      feasibleSemanticSuccess,
      repairFreeFinalSuccess,
      runtimeFailureFree,
      semanticNonInferiority,
      providerStrata,
      gates,
    },
  };
}
