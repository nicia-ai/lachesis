import {
  type Diagnostic,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,127}$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

const phaseSchema = z.enum(["initial", "post-diagnostic"]);
const referenceOutcomeSchema = z.enum([
  "equivalent",
  "declaration-repairable",
  "genuinely-non-equivalent",
  "insufficient-evidence",
]);
const diagnosticOutcomeSchema = z.enum([
  "declaration-repairable",
  "genuinely-non-equivalent",
  "insufficient-evidence",
]);

export const m7cDecisionRecordSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m7c-decision/1"),
    authorSessionId: identifierSchema,
    catalogFamilyId: identifierSchema,
    pairId: identifierSchema,
    phase: phaseSchema,
    referenceOutcome: referenceOutcomeSchema,
    acceptedAsEquivalent: z.boolean(),
    diagnosticOutcome: diagnosticOutcomeSchema.nullable(),
    failureLocalized: z.boolean().nullable(),
    roleLocalized: z.boolean().nullable(),
    boundaryLocalized: z.boolean().nullable(),
    safeRepairDirectionUnderstood: z.boolean().nullable(),
    unsafeRepairDirection: z.boolean(),
    repairAttempts: z.number().int().nonnegative(),
    completionMs: z.number().int().nonnegative(),
    initialDeclarationDigest: digestSchema,
    declarationDigest: digestSchema,
    manifestDigest: digestSchema,
    diagnosticDigest: digestSchema.nullable(),
  })
  .readonly();
export type M7cDecisionRecord = z.infer<typeof m7cDecisionRecordSchema>;

export const m7cEvolutionRecordSchema = z
  .strictObject({
    authorSessionId: identifierSchema,
    catalogFamilyId: identifierSchema,
    pairId: identifierSchema,
    irrelevantManifestStable: z.boolean(),
    irrelevantDiagnosticStable: z.boolean(),
    substantiveManifestChanged: z.boolean(),
    substantiveDiagnosticChanged: z.boolean(),
  })
  .readonly();
export type M7cEvolutionRecord = z.infer<typeof m7cEvolutionRecordSchema>;

export const m7cPlannedCountsSchema = z
  .strictObject({
    authorSessions: z.literal(12),
    catalogFamilies: z.literal(6),
    authorFamilyAssignments: z.literal(72),
    pairsPerAssignment: z.literal(4),
    initialDecisions: z.literal(288),
    initialNonEquivalentDecisions: z.literal(144),
    initialEquivalentDecisions: z.literal(72),
    initialDeclarationRepairableDecisions: z.literal(72),
    nonEquivalentDecisionsPerAuthor: z.literal(12),
    nonEquivalentDecisionsPerFamily: z.literal(24),
  })
  .readonly();
export type M7cPlannedCounts = z.infer<typeof m7cPlannedCountsSchema>;

export const M7C_PLANNED_COUNTS: M7cPlannedCounts = {
  authorSessions: 12,
  catalogFamilies: 6,
  authorFamilyAssignments: 72,
  pairsPerAssignment: 4,
  initialDecisions: 288,
  initialNonEquivalentDecisions: 144,
  initialEquivalentDecisions: 72,
  initialDeclarationRepairableDecisions: 72,
  nonEquivalentDecisionsPerAuthor: 12,
  nonEquivalentDecisionsPerFamily: 24,
};

const endpointSummarySchema = z
  .strictObject({
    decisions: z.number().int().nonnegative(),
    nonEquivalentDecisions: z.number().int().nonnegative(),
    acceptedFalseEquivalences: z.number().int().nonnegative(),
    falseRejections: z.number().int().nonnegative(),
    classifiableRejections: z.number().int().nonnegative(),
    correctDiagnosticOutcomes: z.number().int().nonnegative(),
    localizedRejections: z.number().int().nonnegative(),
    safeRepairComprehensionDenominator: z.number().int().nonnegative(),
    safeRepairDirectionsUnderstood: z.number().int().nonnegative(),
    declarationRepairableDecisions: z.number().int().nonnegative(),
    correctedDeclarationRepairableDecisions: z.number().int().nonnegative(),
    preservedNonEquivalenceDecisions: z.number().int().nonnegative(),
    completionMsTotal: z.number().int().nonnegative(),
    repairAttemptsTotal: z.number().int().nonnegative(),
  })
  .readonly();
export type M7cEndpointSummary = z.infer<typeof endpointSummarySchema>;

const stratumReportSchema = z
  .strictObject({
    stratumId: identifierSchema,
    initial: endpointSummarySchema,
    postDiagnostic: endpointSummarySchema,
  })
  .readonly();

export const m7cAnalysisReportSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m7c-analysis-report/1"),
    initial: endpointSummarySchema,
    postDiagnostic: endpointSummarySchema,
    authors: z.array(stratumReportSchema).length(12).readonly(),
    catalogFamilies: z.array(stratumReportSchema).length(6).readonly(),
    uncertainty: z
      .strictObject({
        confidenceLevel: z.literal(0.95),
        decisionLevelZeroEventUpperBound: z.number().min(0).max(1),
        authorClusterZeroEventUpperBound: z.number().min(0).max(1),
        catalogClusterZeroEventUpperBound: z.number().min(0).max(1),
        interpretation: z.literal(
          "decision-level bound is descriptive only; author and catalog clustering remain explicit and unpooled",
        ),
      })
      .readonly(),
    evolution: z
      .strictObject({
        records: z.number().int().nonnegative(),
        allIrrelevantDiagnosticsStable: z.boolean(),
        allIrrelevantManifestsStable: z.boolean(),
        allSubstantiveDiagnosticsChanged: z.boolean(),
        allSubstantiveManifestsChanged: z.boolean(),
      })
      .readonly(),
    killGates: z
      .strictObject({
        falseEquivalenceAccepted: z.boolean(),
        unsafeRepairDirection: z.boolean(),
        hiddenAdjudicationLeak: z.boolean(),
        frozenBindingMismatch: z.boolean(),
        missingOrPooledStratum: z.boolean(),
      })
      .readonly(),
    decision: z.enum(["PASS", "FAIL"]),
    reportDigest: digestSchema,
  })
  .readonly();
export type M7cAnalysisReport = z.infer<typeof m7cAnalysisReportSchema>;

function expectedDiagnostic(
  reference: M7cDecisionRecord["referenceOutcome"],
): M7cDecisionRecord["diagnosticOutcome"] {
  return reference === "equivalent" ? null : reference;
}

function summarize(
  records: ReadonlyArray<M7cDecisionRecord>,
): M7cEndpointSummary {
  const nonEquivalent = records.filter(
    (record) => record.referenceOutcome === "genuinely-non-equivalent",
  );
  const rejected = records.filter((record) => !record.acceptedAsEquivalent);
  const classifiable = rejected.filter(
    (record) => record.referenceOutcome !== "equivalent",
  );
  const comprehensible = rejected.filter(
    (record) => record.safeRepairDirectionUnderstood !== null,
  );
  const repairable = records.filter(
    (record) => record.referenceOutcome === "declaration-repairable",
  );
  return {
    decisions: records.length,
    nonEquivalentDecisions: nonEquivalent.length,
    acceptedFalseEquivalences: nonEquivalent.filter(
      (record) => record.acceptedAsEquivalent,
    ).length,
    falseRejections: records.filter(
      (record) =>
        record.referenceOutcome === "equivalent" &&
        !record.acceptedAsEquivalent,
    ).length,
    classifiableRejections: classifiable.length,
    correctDiagnosticOutcomes: classifiable.filter(
      (record) =>
        record.diagnosticOutcome ===
        expectedDiagnostic(record.referenceOutcome),
    ).length,
    localizedRejections: rejected.filter(
      (record) =>
        record.failureLocalized === true &&
        record.roleLocalized === true &&
        record.boundaryLocalized === true,
    ).length,
    safeRepairComprehensionDenominator: comprehensible.length,
    safeRepairDirectionsUnderstood: comprehensible.filter(
      (record) => record.safeRepairDirectionUnderstood === true,
    ).length,
    declarationRepairableDecisions: repairable.length,
    correctedDeclarationRepairableDecisions: repairable.filter(
      (record) =>
        record.phase === "post-diagnostic" && record.acceptedAsEquivalent,
    ).length,
    preservedNonEquivalenceDecisions: nonEquivalent.filter(
      (record) =>
        record.phase === "post-diagnostic" && !record.acceptedAsEquivalent,
    ).length,
    completionMsTotal: records.reduce(
      (total, record) => total + record.completionMs,
      0,
    ),
    repairAttemptsTotal: records.reduce(
      (total, record) => total + record.repairAttempts,
      0,
    ),
  };
}

function exactUpperBoundWithZeroEvents(units: number): number {
  return units === 0 ? 1 : 1 - Math.pow(0.05, 1 / units);
}

function coordinate(record: M7cDecisionRecord): string {
  return `${record.authorSessionId}\u0000${record.catalogFamilyId}\u0000${record.pairId}\u0000${record.phase}`;
}

function pairCoordinate(record: M7cDecisionRecord): string {
  return `${record.authorSessionId}\u0000${record.catalogFamilyId}\u0000${record.pairId}`;
}

function fail(message: string): Result<never, Diagnostic> {
  return {
    ok: false,
    error: diagnostic("SEMANTIC_OBLIGATION_FAILED", message),
  };
}

export function auditM7cPlannedCounts(
  value: unknown,
): Result<M7cPlannedCounts, Diagnostic> {
  const parsed = m7cPlannedCountsSchema.safeParse(value);
  if (!parsed.success) return fail("M7c planned counts are invalid.");
  return { ok: true, value: parsed.data };
}

export async function analyzeM7c(
  input: Readonly<{
    records: ReadonlyArray<unknown>;
    evolution: ReadonlyArray<unknown>;
    hiddenAdjudicationLeak: boolean;
    frozenBindingMismatch: boolean;
  }>,
): Promise<Result<M7cAnalysisReport, Diagnostic>> {
  const records = z.array(m7cDecisionRecordSchema).safeParse(input.records);
  const evolution = z
    .array(m7cEvolutionRecordSchema)
    .safeParse(input.evolution);
  if (!records.success || !evolution.success)
    return fail("M7c analysis inputs are invalid.");
  const coordinates = records.data.map(coordinate);
  if (new Set(coordinates).size !== coordinates.length)
    return fail("M7c records overwrite a frozen author/pair/phase coordinate.");
  const initialPairs = new Set(
    records.data
      .filter((record) => record.phase === "initial")
      .map(pairCoordinate),
  );
  if (
    records.data.some(
      (record) =>
        record.phase === "post-diagnostic" &&
        !initialPairs.has(pairCoordinate(record)),
    )
  )
    return fail(
      "Every post-diagnostic record requires a preserved initial record.",
    );
  const initialByPair = new Map(
    records.data
      .filter((record) => record.phase === "initial")
      .map((record) => [pairCoordinate(record), record]),
  );
  if (
    records.data.some((record) => {
      if (record.phase !== "post-diagnostic") return false;
      const initialRecord = initialByPair.get(pairCoordinate(record));
      if (initialRecord === undefined) return true;
      return (
        initialRecord.referenceOutcome !== record.referenceOutcome ||
        initialRecord.declarationDigest !== record.initialDeclarationDigest
      );
    })
  )
    return fail(
      "Post-diagnostic records must retain the initial outcome and declaration identity.",
    );
  const authors = [
    ...new Set(records.data.map((record) => record.authorSessionId)),
  ].toSorted();
  const families = [
    ...new Set(records.data.map((record) => record.catalogFamilyId)),
  ].toSorted();
  const strata = (
    values: ReadonlyArray<string>,
    select: (record: M7cDecisionRecord) => string,
  ) =>
    values.map((stratumId) => {
      const selected = records.data.filter(
        (record) => select(record) === stratumId,
      );
      return {
        stratumId,
        initial: summarize(
          selected.filter((record) => record.phase === "initial"),
        ),
        postDiagnostic: summarize(
          selected.filter((record) => record.phase === "post-diagnostic"),
        ),
      };
    });
  const initial = records.data.filter((record) => record.phase === "initial");
  const postDiagnostic = records.data.filter(
    (record) => record.phase === "post-diagnostic",
  );
  const missingOrPooledStratum =
    authors.length !== M7C_PLANNED_COUNTS.authorSessions ||
    families.length !== M7C_PLANNED_COUNTS.catalogFamilies ||
    initial.length !== M7C_PLANNED_COUNTS.initialDecisions ||
    initial.filter((record) => record.referenceOutcome === "equivalent")
      .length !== M7C_PLANNED_COUNTS.initialEquivalentDecisions ||
    initial.filter(
      (record) => record.referenceOutcome === "declaration-repairable",
    ).length !== M7C_PLANNED_COUNTS.initialDeclarationRepairableDecisions ||
    initial.filter(
      (record) => record.referenceOutcome === "genuinely-non-equivalent",
    ).length !== M7C_PLANNED_COUNTS.initialNonEquivalentDecisions ||
    authors.some((author) =>
      families.some(
        (family) =>
          initial.filter(
            (record) =>
              record.authorSessionId === author &&
              record.catalogFamilyId === family,
          ).length !== M7C_PLANNED_COUNTS.pairsPerAssignment,
      ),
    ) ||
    authors.some(
      (author) =>
        initial.filter(
          (record) =>
            record.authorSessionId === author &&
            record.referenceOutcome === "genuinely-non-equivalent",
        ).length !== M7C_PLANNED_COUNTS.nonEquivalentDecisionsPerAuthor,
    ) ||
    families.some(
      (family) =>
        initial.filter(
          (record) =>
            record.catalogFamilyId === family &&
            record.referenceOutcome === "genuinely-non-equivalent",
        ).length !== M7C_PLANNED_COUNTS.nonEquivalentDecisionsPerFamily,
    );
  const initialSummary = summarize(initial);
  const postSummary = summarize(postDiagnostic);
  const killGates = {
    falseEquivalenceAccepted:
      initialSummary.acceptedFalseEquivalences > 0 ||
      postSummary.acceptedFalseEquivalences > 0,
    unsafeRepairDirection: records.data.some(
      (record) => record.unsafeRepairDirection,
    ),
    hiddenAdjudicationLeak: input.hiddenAdjudicationLeak,
    frozenBindingMismatch: input.frozenBindingMismatch,
    missingOrPooledStratum,
  };
  const evolutionSummary = {
    records: evolution.data.length,
    allIrrelevantDiagnosticsStable: evolution.data.every(
      (record) => record.irrelevantDiagnosticStable,
    ),
    allIrrelevantManifestsStable: evolution.data.every(
      (record) => record.irrelevantManifestStable,
    ),
    allSubstantiveDiagnosticsChanged: evolution.data.every(
      (record) => record.substantiveDiagnosticChanged,
    ),
    allSubstantiveManifestsChanged: evolution.data.every(
      (record) => record.substantiveManifestChanged,
    ),
  };
  const body = {
    protocol: "lachesis-m7c-analysis-report/1" as const,
    initial: initialSummary,
    postDiagnostic: postSummary,
    authors: strata(authors, (record) => record.authorSessionId),
    catalogFamilies: strata(families, (record) => record.catalogFamilyId),
    uncertainty: {
      confidenceLevel: 0.95 as const,
      decisionLevelZeroEventUpperBound: exactUpperBoundWithZeroEvents(
        initialSummary.nonEquivalentDecisions,
      ),
      authorClusterZeroEventUpperBound: exactUpperBoundWithZeroEvents(
        M7C_PLANNED_COUNTS.authorSessions,
      ),
      catalogClusterZeroEventUpperBound: exactUpperBoundWithZeroEvents(
        M7C_PLANNED_COUNTS.catalogFamilies,
      ),
      interpretation:
        "decision-level bound is descriptive only; author and catalog clustering remain explicit and unpooled" as const,
    },
    evolution: evolutionSummary,
    killGates,
    decision: Object.values(killGates).some(Boolean)
      ? ("FAIL" as const)
      : ("PASS" as const),
  };
  const reportDigest = await digestValue(body);
  if (!reportDigest.ok) return reportDigest;
  return {
    ok: true,
    value: m7cAnalysisReportSchema.parse({
      ...body,
      reportDigest: reportDigest.value,
    }),
  };
}
