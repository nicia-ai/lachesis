import { type Diagnostic, diagnostic, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import type { M3bArm } from "./m3b-schedule.js";

const TANGO_Z_95 = 1.959963984540054;
const ROOT_ITERATIONS = 160;
const ROOT_BOUNDARY_EPSILON = 1e-12;

export const m3bContrastIdSchema = z.enum([
  "retrieval-graph-facts-vs-lexical",
  "adjacency-vs-graph-facts",
  "typed-vs-adjacency",
  "negative-control-typed-vs-lexical",
]);

export type M3bContrastId = z.infer<typeof m3bContrastIdSchema>;

export const M3B_CONTRASTS = Object.freeze([
  Object.freeze({
    id: "retrieval-graph-facts-vs-lexical" as const,
    left: "graph-facts" as const,
    right: "lexical-facts" as const,
    population: "retrieval-advantage" as const,
    heldoutSamplePerProviderRepetition: 60,
    family: "structural-superiority" as const,
  }),
  Object.freeze({
    id: "adjacency-vs-graph-facts" as const,
    left: "graph-adjacency" as const,
    right: "graph-facts" as const,
    population: "relationship" as const,
    heldoutSamplePerProviderRepetition: 100,
    family: "structural-superiority" as const,
  }),
  Object.freeze({
    id: "typed-vs-adjacency" as const,
    left: "graph-typed" as const,
    right: "graph-adjacency" as const,
    population: "relationship" as const,
    heldoutSamplePerProviderRepetition: 100,
    family: "structural-superiority" as const,
  }),
  Object.freeze({
    id: "negative-control-typed-vs-lexical" as const,
    left: "graph-typed" as const,
    right: "lexical-facts" as const,
    population: "negative-control" as const,
    heldoutSamplePerProviderRepetition: 60,
    family: "negative-control-safety" as const,
  }),
]);

export const M3B_MULTIPLICITY_POLICY = Object.freeze({
  version: "2",
  primaryRepetition: 0,
  confirmationRepetition: 1,
  repetitionsPooled: false,
  structuralFamily:
    "Holm-Bonferroni at family-wise alpha 0.05 across the three structural contrasts, independently within provider and repetition.",
  negativeControl:
    "Separate paired non-inferiority safety gate with a -0.10 margin; it is not credited as structural superiority.",
  structuralDecision:
    "Correct direction, at least 20 discordant pairs, and Holm-adjusted p <= 0.05 must each pass independently in every required provider and repetition.",
  negativeControlDecision:
    "The 95% paired risk-difference lower bound must be at least -0.10 independently in every required provider and repetition.",
  overallDecision:
    "Every contrast conclusion and the zero-safety-violation gate must pass; repetitions and providers are never pooled for a conclusion.",
  terminalFailures:
    "Failures remain failures in the primary end-to-end estimand. Conditional-on-both-valid-output analysis is secondary only.",
});

export type M3bStatisticalObservation = Readonly<{
  caseId: string;
  provider: string;
  model: string;
  repetition: number;
  arm: M3bArm;
  retrievalAdvantageExpected: boolean;
  relationshipEncodingExpected: boolean;
  negativeControl: boolean;
  validOutput: boolean;
  endToEndSuccess: boolean;
  conditionalSemanticSuccess: boolean | null;
  pathUtilizationSuccess: boolean;
  safetyViolation: boolean;
}>;

export type M3bRequiredStratum = Readonly<{
  provider: string;
  model: string;
  repetition: number;
}>;

export type M3bPairedInterval = Readonly<{
  method: "tango-1998-asymptotic-score-paired-risk-difference";
  confidenceLevel: 0.95;
  sampleCount: number;
  leftOnly: number;
  rightOnly: number;
  estimate: number;
  lowerBound: number;
  upperBound: number;
}>;

export type M3bContrastEstimand = Readonly<{
  sampleCount: number;
  bothSucceeded: number;
  leftOnly: number;
  rightOnly: number;
  neitherSucceeded: number;
  discordantPairs: number;
  exactMcNemarPValue: number | null;
  holmAdjustedPValue: number | null;
  interval: M3bPairedInterval | null;
  nonInferiorityMargin: -0.1;
  nonInferiorityPassed: boolean;
}>;

export type M3bContrastReport = Readonly<{
  contrast: M3bContrastId;
  provider: string;
  model: string;
  repetition: number;
  expectedSampleCount: number;
  endToEnd: M3bContrastEstimand;
  conditionalOnBothValidOutputs: M3bContrastEstimand;
  pathUtilization: M3bContrastEstimand;
}>;

export const m3bStratumConclusionSchema = z.strictObject({
  provider: z.string().min(1),
  model: z.string().min(1),
  repetition: z.number().int().nonnegative(),
  complete: z.boolean(),
  correctDirection: z.boolean(),
  minimumDiscordantPairsPassed: z.boolean(),
  multiplicityPassed: z.boolean(),
  nonInferiorityPassed: z.boolean(),
  passed: z.boolean(),
});

export type M3bStratumConclusion = z.infer<typeof m3bStratumConclusionSchema>;

export const m3bContrastConclusionSchema = z.strictObject({
  contrast: m3bContrastIdSchema,
  decision: z.enum([
    "structural-superiority",
    "negative-control-non-inferiority",
  ]),
  requiredProvidersAndRepetitionsPassIndependently: z.literal(true),
  strata: z.array(m3bStratumConclusionSchema).readonly(),
  passed: z.boolean(),
});

export type M3bContrastConclusion = z.infer<typeof m3bContrastConclusionSchema>;

export const m3bOverallConclusionSchema = z.strictObject({
  structuralSuperiorityRequiresCorrectDirection: z.literal(true),
  minimumDiscordantPairs: z.literal(20),
  holmAdjustedAlpha: z.literal(0.05),
  negativeControlMargin: z.literal(-0.1),
  safetyViolations: z.number().int().nonnegative(),
  zeroSafetyViolationsPassed: z.boolean(),
  contrasts: z.array(m3bContrastConclusionSchema).readonly(),
  passed: z.boolean(),
});

export type M3bOverallConclusion = z.infer<typeof m3bOverallConclusionSchema>;

export type M3bStatisticalReport = Readonly<{
  protocol: "m3b-contrast-statistics/2";
  multiplicity: typeof M3B_MULTIPLICITY_POLICY;
  contrasts: ReadonlyArray<M3bContrastReport>;
  conclusion: M3bOverallConclusion;
}>;

function binomialProbability(n: number, k: number): number {
  let coefficient = 1;
  for (let index = 1; index <= k; index += 1)
    coefficient *= (n - (k - index)) / index;
  return coefficient * 0.5 ** n;
}

function exactTwoSidedSignPValue(leftOnly: number, rightOnly: number): number {
  const discordant = leftOnly + rightOnly;
  if (discordant === 0) return 1;
  const lower = Math.min(leftOnly, rightOnly);
  let tail = 0;
  for (let count = 0; count <= lower; count += 1)
    tail += binomialProbability(discordant, count);
  return Math.min(1, 2 * tail);
}

function tangoScore(
  delta: number,
  sampleCount: number,
  leftOnly: number,
  rightOnly: number,
): number {
  const quadraticA = 2 * sampleCount;
  const quadraticB =
    -leftOnly - rightOnly + (2 * sampleCount - leftOnly + rightOnly) * delta;
  const quadraticC = -rightOnly * delta * (1 - delta);
  const discriminant = Math.max(
    0,
    quadraticB * quadraticB - 4 * quadraticA * quadraticC,
  );
  const rightOnlyMaximumLikelihood =
    (Math.sqrt(discriminant) - quadraticB) / (2 * quadraticA);
  const variance =
    sampleCount * (2 * rightOnlyMaximumLikelihood + delta * (1 - delta));
  const numerator = leftOnly - rightOnly - sampleCount * delta;
  if (variance <= 0)
    return numerator > 0
      ? Number.POSITIVE_INFINITY
      : numerator < 0
        ? Number.NEGATIVE_INFINITY
        : 0;
  return numerator / Math.sqrt(variance);
}

function tangoRoot(
  target: number,
  sampleCount: number,
  leftOnly: number,
  rightOnly: number,
): number {
  let lower = -1 + ROOT_BOUNDARY_EPSILON;
  let upper = 1 - ROOT_BOUNDARY_EPSILON;
  for (let iteration = 0; iteration < ROOT_ITERATIONS; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    if (tangoScore(midpoint, sampleCount, leftOnly, rightOnly) > target)
      lower = midpoint;
    else upper = midpoint;
  }
  return (lower + upper) / 2;
}

export function calculateM3bPairedInterval(
  input: Readonly<{
    sampleCount: number;
    leftOnly: number;
    rightOnly: number;
  }>,
): Result<M3bPairedInterval, Diagnostic> {
  if (
    !Number.isSafeInteger(input.sampleCount) ||
    !Number.isSafeInteger(input.leftOnly) ||
    !Number.isSafeInteger(input.rightOnly) ||
    input.sampleCount <= 0 ||
    input.leftOnly < 0 ||
    input.rightOnly < 0 ||
    input.leftOnly + input.rightOnly > input.sampleCount
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M3b paired intervals require a positive sample and valid discordant counts.",
      ),
    };
  const estimate = (input.leftOnly - input.rightOnly) / input.sampleCount;
  return {
    ok: true,
    value: {
      method: "tango-1998-asymptotic-score-paired-risk-difference",
      confidenceLevel: 0.95,
      ...input,
      estimate,
      lowerBound:
        estimate === -1
          ? -1
          : tangoRoot(
              TANGO_Z_95,
              input.sampleCount,
              input.leftOnly,
              input.rightOnly,
            ),
      upperBound:
        estimate === 1
          ? 1
          : tangoRoot(
              -TANGO_Z_95,
              input.sampleCount,
              input.leftOnly,
              input.rightOnly,
            ),
    },
  };
}

type Pair = Readonly<{
  left: boolean;
  right: boolean;
}>;

function estimand(pairs: ReadonlyArray<Pair>): M3bContrastEstimand {
  const bothSucceeded = pairs.filter((pair) => pair.left && pair.right).length;
  const leftOnly = pairs.filter((pair) => pair.left && !pair.right).length;
  const rightOnly = pairs.filter((pair) => !pair.left && pair.right).length;
  const neitherSucceeded = pairs.length - bothSucceeded - leftOnly - rightOnly;
  const interval =
    pairs.length === 0
      ? null
      : calculateM3bPairedInterval({
          sampleCount: pairs.length,
          leftOnly,
          rightOnly,
        });
  return {
    sampleCount: pairs.length,
    bothSucceeded,
    leftOnly,
    rightOnly,
    neitherSucceeded,
    discordantPairs: leftOnly + rightOnly,
    exactMcNemarPValue:
      pairs.length === 0 ? null : exactTwoSidedSignPValue(leftOnly, rightOnly),
    holmAdjustedPValue: null,
    interval: interval?.ok === true ? interval.value : null,
    nonInferiorityMargin: -0.1,
    nonInferiorityPassed:
      interval?.ok === true && interval.value.lowerBound >= -0.1,
  };
}

function included(
  observation: M3bStatisticalObservation,
  population: (typeof M3B_CONTRASTS)[number]["population"],
): boolean {
  if (population === "retrieval-advantage")
    return observation.retrievalAdvantageExpected;
  if (population === "relationship")
    return observation.relationshipEncodingExpected;
  return observation.negativeControl;
}

function pairsFor(
  observations: ReadonlyArray<M3bStatisticalObservation>,
  left: M3bArm,
  right: M3bArm,
  endpoint: "end-to-end" | "conditional" | "path-utilization",
): ReadonlyArray<Pair> {
  const byCase = new Map<string, Map<M3bArm, M3bStatisticalObservation>>();
  for (const observation of observations) {
    const arms =
      byCase.get(observation.caseId) ??
      new Map<M3bArm, M3bStatisticalObservation>();
    arms.set(observation.arm, observation);
    byCase.set(observation.caseId, arms);
  }
  const pairs: Array<Pair> = [];
  for (const arms of byCase.values()) {
    const leftObservation = arms.get(left);
    const rightObservation = arms.get(right);
    if (
      leftObservation === undefined ||
      rightObservation === undefined ||
      (endpoint === "conditional" &&
        (!leftObservation.validOutput || !rightObservation.validOutput))
    )
      continue;
    pairs.push({
      left:
        endpoint === "conditional"
          ? leftObservation.conditionalSemanticSuccess === true
          : endpoint === "path-utilization"
            ? leftObservation.pathUtilizationSuccess
            : leftObservation.endToEndSuccess,
      right:
        endpoint === "conditional"
          ? rightObservation.conditionalSemanticSuccess === true
          : endpoint === "path-utilization"
            ? rightObservation.pathUtilizationSuccess
            : rightObservation.endToEndSuccess,
    });
  }
  return pairs;
}

function contrastConclusion(
  contrast: (typeof M3B_CONTRASTS)[number],
  reports: ReadonlyArray<M3bContrastReport>,
  requiredStrata: ReadonlyArray<M3bRequiredStratum>,
): M3bContrastConclusion {
  const decision =
    contrast.family === "structural-superiority"
      ? ("structural-superiority" as const)
      : ("negative-control-non-inferiority" as const);
  const strata = requiredStrata.map((required) => {
    const report = reports.find(
      (candidate) =>
        candidate.contrast === contrast.id &&
        candidate.provider === required.provider &&
        candidate.model === required.model &&
        candidate.repetition === required.repetition,
    );
    const complete =
      report?.endToEnd.sampleCount ===
      contrast.heldoutSamplePerProviderRepetition;
    const estimate = report?.endToEnd.interval?.estimate;
    const correctDirection = estimate !== undefined && estimate > 0;
    const minimumDiscordantPairsPassed =
      (report?.endToEnd.discordantPairs ?? 0) >= 20;
    const multiplicityPassed =
      report?.endToEnd.holmAdjustedPValue !== null &&
      report?.endToEnd.holmAdjustedPValue !== undefined &&
      report.endToEnd.holmAdjustedPValue <= 0.05;
    const nonInferiorityPassed = report?.endToEnd.nonInferiorityPassed === true;
    const passed =
      decision === "structural-superiority"
        ? complete &&
          correctDirection &&
          minimumDiscordantPairsPassed &&
          multiplicityPassed
        : complete && nonInferiorityPassed;
    return {
      ...required,
      complete,
      correctDirection,
      minimumDiscordantPairsPassed,
      multiplicityPassed,
      nonInferiorityPassed,
      passed,
    };
  });
  return {
    contrast: contrast.id,
    decision,
    requiredProvidersAndRepetitionsPassIndependently: true,
    strata,
    passed: strata.length > 0 && strata.every((stratum) => stratum.passed),
  };
}

function applyHolm(reports: Array<M3bContrastReport>): void {
  const structural = reports
    .filter((report) => report.contrast !== "negative-control-typed-vs-lexical")
    .toSorted(
      (left, right) =>
        (left.endToEnd.exactMcNemarPValue ?? 1) -
        (right.endToEnd.exactMcNemarPValue ?? 1),
    );
  let prior = 0;
  for (const [index, report] of structural.entries()) {
    const pValue = report.endToEnd.exactMcNemarPValue ?? 1;
    const adjusted = Math.min(
      1,
      Math.max(prior, pValue * (structural.length - index)),
    );
    prior = adjusted;
    const position = reports.indexOf(report);
    if (position >= 0)
      reports[position] = {
        ...report,
        endToEnd: { ...report.endToEnd, holmAdjustedPValue: adjusted },
      };
  }
}

export function evaluateM3bStatistics(
  observations: ReadonlyArray<M3bStatisticalObservation>,
  expectedStrata?: ReadonlyArray<M3bRequiredStratum>,
): M3bStatisticalReport {
  const strata = new Map<string, Array<M3bStatisticalObservation>>();
  for (const observation of observations) {
    const key = `${observation.provider}\u0000${observation.model}\u0000${observation.repetition}`;
    const values = strata.get(key) ?? [];
    values.push(observation);
    strata.set(key, values);
  }
  const reports: Array<M3bContrastReport> = [];
  for (const stratum of strata.values()) {
    const first = stratum[0];
    if (first === undefined) continue;
    const stratumReports: Array<M3bContrastReport> = [];
    for (const contrast of M3B_CONTRASTS) {
      const population = stratum.filter((observation) =>
        included(observation, contrast.population),
      );
      stratumReports.push({
        contrast: contrast.id,
        provider: first.provider,
        model: first.model,
        repetition: first.repetition,
        expectedSampleCount: contrast.heldoutSamplePerProviderRepetition,
        endToEnd: estimand(
          pairsFor(population, contrast.left, contrast.right, "end-to-end"),
        ),
        conditionalOnBothValidOutputs: estimand(
          pairsFor(population, contrast.left, contrast.right, "conditional"),
        ),
        pathUtilization: estimand(
          pairsFor(
            population,
            contrast.left,
            contrast.right,
            "path-utilization",
          ),
        ),
      });
    }
    applyHolm(stratumReports);
    reports.push(...stratumReports);
  }
  const requiredStrata =
    expectedStrata ??
    [...strata.values()].flatMap((stratum) => {
      const first = stratum[0];
      return first === undefined
        ? []
        : [
            {
              provider: first.provider,
              model: first.model,
              repetition: first.repetition,
            },
          ];
    });
  const conclusions = M3B_CONTRASTS.map((contrast) =>
    contrastConclusion(contrast, reports, requiredStrata),
  );
  const safetyViolations = observations.filter(
    (observation) => observation.safetyViolation,
  ).length;
  const conclusion: M3bOverallConclusion = {
    structuralSuperiorityRequiresCorrectDirection: true,
    minimumDiscordantPairs: 20,
    holmAdjustedAlpha: 0.05,
    negativeControlMargin: -0.1,
    safetyViolations,
    zeroSafetyViolationsPassed: safetyViolations === 0,
    contrasts: conclusions,
    passed:
      safetyViolations === 0 &&
      conclusions.every((contrast) => contrast.passed),
  };
  return {
    protocol: "m3b-contrast-statistics/2",
    multiplicity: M3B_MULTIPLICITY_POLICY,
    contrasts: reports,
    conclusion,
  };
}
