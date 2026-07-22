import { digestValue } from "@nicia-ai/lachesis";
import {
  type CatalogConformanceDiagnostic,
  catalogConformanceDiagnosticSchema,
  conformCatalogsOffline,
  diagnoseCatalogsOffline,
  renderCatalogConformanceDiagnostic,
  verifyCatalogConformanceDiagnostic,
} from "@nicia-ai/lachesis-generator";
import { z } from "zod";

import { createDiagnosticCatalog } from "./catalogs.js";
import {
  catalogsFor,
  diagnosticSuite,
  loadM7bDevelopmentCorpus,
} from "./corpus.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const caseReportSchema = z
  .strictObject({
    caseId: z.string(),
    conformanceAccepted: z.literal(false),
    expectedOutcome: z.enum([
      "declaration-repairable",
      "genuinely-non-equivalent",
      "insufficient-evidence",
    ]),
    expectedCode: z.string(),
    expectedRoleId: z.string().nullable(),
    expectedBoundary: z.string(),
    exactLocalization: z.boolean(),
    safeGuidance: z.boolean(),
    human: z.string(),
    diagnostic: catalogConformanceDiagnosticSchema,
  })
  .readonly();

export const m7bReportSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m7b-diagnostic-hardening-report/1"),
    provenance: z.literal("fresh-development-only-disjoint-from-m7c"),
    m7aReportDigestPreserved: z.literal(
      "8cc35372ec4f4f560180a2f26cf4edb46c9c298f49f21cc39f8df07cde19cf85",
    ),
    cases: z.array(caseReportSchema).length(9).readonly(),
    counts: z
      .strictObject({
        declarationRepairable: z.number().int().nonnegative(),
        genuinelyNonEquivalent: z.number().int().nonnegative(),
        insufficientEvidence: z.number().int().nonnegative(),
        falseEquivalence: z.number().int().nonnegative(),
        unsafeRepairDirections: z.number().int().nonnegative(),
        exactLocalizations: z.number().int().nonnegative(),
        classified: z.number().int().nonnegative(),
      })
      .readonly(),
    evolution: z
      .strictObject({
        irrelevantEvolutionDiagnosticStable: z.boolean(),
        irrelevantEvolutionManifestChanged: z.boolean(),
        substantiveEvolutionDiagnosticChanged: z.boolean(),
        substantiveEvolutionManifestChanged: z.boolean(),
        baselineDiagnosticDigest: sha256Schema,
        irrelevantDiagnosticDigest: sha256Schema,
        substantiveDiagnosticDigest: sha256Schema,
        baselineManifestDigest: sha256Schema,
        irrelevantManifestDigest: sha256Schema,
        substantiveManifestDigest: sha256Schema,
      })
      .readonly(),
    gates: z
      .strictObject({
        zeroFalseEquivalence: z.boolean(),
        zeroUnsafeRepair: z.boolean(),
        completeClassification: z.boolean(),
        exactLocalization: z.boolean(),
        declarationGuidanceComplete: z.boolean(),
        nonSubstitutionComplete: z.boolean(),
        deterministicRendering: z.boolean(),
        identityEvolutionCorrect: z.boolean(),
      })
      .readonly(),
    decision: z.enum(["GO", "NO-GO"]),
    decisionScope: z.literal("freeze-m7c-protocol-only"),
    nonclaims: z
      .tuple([
        z.literal("m7c-not-executed"),
        z.literal("no-live-inference-or-provider-calls"),
        z.literal("no-equivalence-rule-weakening"),
        z.literal("no-independent-author-evidence"),
        z.literal("no-m8-publishing-push-or-campaign"),
      ])
      .readonly(),
    reportDigest: sha256Schema,
  })
  .readonly();
export type M7bReport = z.infer<typeof m7bReportSchema>;

function safeGuidance(diagnostic: CatalogConformanceDiagnostic): boolean {
  switch (diagnostic.outcome) {
    case "declaration-repairable":
      return (
        diagnostic.action.kind === "review-declaration" &&
        diagnostic.action.safetyCondition.length > 0
      );
    case "genuinely-non-equivalent":
      return diagnostic.action.kind === "do-not-substitute";
    case "insufficient-evidence":
      return (
        diagnostic.action.kind === "edit-suite" ||
        diagnostic.action.kind === "no-safe-repair"
      );
  }
}

async function rejectedDiagnostic(
  left: ReturnType<typeof createDiagnosticCatalog>,
  right: ReturnType<typeof createDiagnosticCatalog>,
): Promise<CatalogConformanceDiagnostic> {
  const result = await diagnoseCatalogsOffline({
    left,
    right,
    suite: diagnosticSuite,
  });
  if (!result.ok || result.value.kind !== "rejected")
    throw new Error("Expected an M7b rejection diagnostic.");
  return result.value.diagnostic;
}

async function evolutionReport(): Promise<M7bReport["evolution"]> {
  const left = createDiagnosticCatalog("baseline-a");
  const [baseline, irrelevant, substantive] = await Promise.all([
    rejectedDiagnostic(left, createDiagnosticCatalog("output-semantics")),
    rejectedDiagnostic(
      left,
      createDiagnosticCatalog("output-semantics-irrelevant-evolution"),
    ),
    rejectedDiagnostic(
      left,
      createDiagnosticCatalog("output-semantics-substantive-evolution"),
    ),
  ]);
  return {
    irrelevantEvolutionDiagnosticStable:
      baseline.diagnosticDigest === irrelevant.diagnosticDigest,
    irrelevantEvolutionManifestChanged:
      baseline.evidence.rightManifestDigest !==
      irrelevant.evidence.rightManifestDigest,
    substantiveEvolutionDiagnosticChanged:
      baseline.diagnosticDigest !== substantive.diagnosticDigest,
    substantiveEvolutionManifestChanged:
      baseline.evidence.rightManifestDigest !==
      substantive.evidence.rightManifestDigest,
    baselineDiagnosticDigest: baseline.diagnosticDigest,
    irrelevantDiagnosticDigest: irrelevant.diagnosticDigest,
    substantiveDiagnosticDigest: substantive.diagnosticDigest,
    baselineManifestDigest: baseline.evidence.rightManifestDigest,
    irrelevantManifestDigest: irrelevant.evidence.rightManifestDigest,
    substantiveManifestDigest: substantive.evidence.rightManifestDigest,
  };
}

function evolutionPassed(evolution: M7bReport["evolution"]): boolean {
  return (
    evolution.irrelevantEvolutionDiagnosticStable &&
    evolution.irrelevantEvolutionManifestChanged &&
    evolution.substantiveEvolutionDiagnosticChanged &&
    evolution.substantiveEvolutionManifestChanged
  );
}

export async function createM7bReport(): Promise<M7bReport> {
  const corpus = loadM7bDevelopmentCorpus();
  const cases = await Promise.all(
    corpus.map(async (diagnosticCase) => {
      const catalogs = catalogsFor(diagnosticCase);
      const [conformance, assessment] = await Promise.all([
        conformCatalogsOffline({
          ...catalogs,
          suite: diagnosticCase.suite,
        }),
        diagnoseCatalogsOffline({ ...catalogs, suite: diagnosticCase.suite }),
      ]);
      if (assessment.ok && assessment.value.kind === "conformant")
        throw new Error(`${diagnosticCase.caseId} was incorrectly conformant.`);
      if (!assessment.ok || assessment.value.kind !== "rejected")
        throw new Error(`${diagnosticCase.caseId} has no diagnostic.`);
      const diagnostic = assessment.value.diagnostic;
      if (!(await verifyCatalogConformanceDiagnostic(diagnostic)).ok)
        throw new Error(`${diagnosticCase.caseId} diagnostic failed identity.`);
      return {
        caseId: diagnosticCase.caseId,
        conformanceAccepted: conformance.ok,
        expectedOutcome: diagnosticCase.expectedOutcome,
        expectedCode: diagnosticCase.expectedCode,
        expectedRoleId: diagnosticCase.expectedRoleId,
        expectedBoundary: diagnosticCase.expectedBoundary,
        exactLocalization:
          diagnostic.outcome === diagnosticCase.expectedOutcome &&
          diagnostic.code === diagnosticCase.expectedCode &&
          (diagnostic.role?.id ?? null) === diagnosticCase.expectedRoleId &&
          diagnostic.boundary === diagnosticCase.expectedBoundary,
        safeGuidance: safeGuidance(diagnostic),
        human: renderCatalogConformanceDiagnostic(diagnostic),
        diagnostic,
      };
    }),
  );
  const sortedCases = cases.toSorted((left, right) =>
    left.caseId < right.caseId ? -1 : left.caseId > right.caseId ? 1 : 0,
  );
  const evolution = await evolutionReport();
  const declarationRepairable = sortedCases.filter(
    (item) => item.diagnostic.outcome === "declaration-repairable",
  );
  const genuinelyNonEquivalent = sortedCases.filter(
    (item) => item.diagnostic.outcome === "genuinely-non-equivalent",
  );
  const insufficientEvidence = sortedCases.filter(
    (item) => item.diagnostic.outcome === "insufficient-evidence",
  );
  const falseEquivalence = sortedCases.filter(
    (item) => item.conformanceAccepted,
  ).length;
  const unsafeRepairDirections = sortedCases.filter(
    (item) => !item.safeGuidance,
  ).length;
  const gates = {
    zeroFalseEquivalence: falseEquivalence === 0,
    zeroUnsafeRepair: unsafeRepairDirections === 0,
    completeClassification:
      declarationRepairable.length +
        genuinelyNonEquivalent.length +
        insufficientEvidence.length ===
      sortedCases.length,
    exactLocalization: sortedCases.every((item) => item.exactLocalization),
    declarationGuidanceComplete: declarationRepairable.every(
      (item) => item.safeGuidance,
    ),
    nonSubstitutionComplete: genuinelyNonEquivalent.every(
      (item) => item.diagnostic.action.kind === "do-not-substitute",
    ),
    deterministicRendering: sortedCases.every(
      (item) =>
        item.human === renderCatalogConformanceDiagnostic(item.diagnostic),
    ),
    identityEvolutionCorrect: evolutionPassed(evolution),
  };
  const go = Object.values(gates).every(Boolean);
  const body = {
    protocol: "lachesis-m7b-diagnostic-hardening-report/1" as const,
    provenance: "fresh-development-only-disjoint-from-m7c" as const,
    m7aReportDigestPreserved:
      "8cc35372ec4f4f560180a2f26cf4edb46c9c298f49f21cc39f8df07cde19cf85" as const,
    cases: sortedCases,
    counts: {
      declarationRepairable: declarationRepairable.length,
      genuinelyNonEquivalent: genuinelyNonEquivalent.length,
      insufficientEvidence: insufficientEvidence.length,
      falseEquivalence,
      unsafeRepairDirections,
      exactLocalizations: sortedCases.filter((item) => item.exactLocalization)
        .length,
      classified:
        declarationRepairable.length +
        genuinelyNonEquivalent.length +
        insufficientEvidence.length,
    },
    evolution,
    gates,
    decision: go ? ("GO" as const) : ("NO-GO" as const),
    decisionScope: "freeze-m7c-protocol-only" as const,
    nonclaims: [
      "m7c-not-executed",
      "no-live-inference-or-provider-calls",
      "no-equivalence-rule-weakening",
      "no-independent-author-evidence",
      "no-m8-publishing-push-or-campaign",
    ] as const,
  };
  const reportDigest = await digestValue(body);
  if (!reportDigest.ok) throw new Error("M7b report identity failed.");
  return m7bReportSchema.parse({ ...body, reportDigest: reportDigest.value });
}

export async function verifyM7bReport(value: unknown): Promise<boolean> {
  const parsed = m7bReportSchema.safeParse(value);
  if (!parsed.success) return false;
  const { reportDigest, ...body } = parsed.data;
  const digest = await digestValue(body);
  return digest.ok && digest.value === reportDigest;
}
