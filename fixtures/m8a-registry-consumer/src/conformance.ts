import {
  createPlanLanguageManifest,
  type PlanLanguageManifest,
  type Result,
} from "@nicia-ai/lachesis";
import {
  type CatalogConformanceDiagnostic,
  type CatalogConformanceReport,
  catalogConformanceSuiteSchema,
  diagnoseCatalogsOffline,
  renderCatalogConformanceDiagnostic,
  verifyCatalogConformanceDiagnostic,
  verifyCatalogConformanceReport,
} from "@nicia-ai/lachesis-generator";
import { oracleRequestSchema } from "@nicia-ai/lachesis-runtime";

import {
  conformanceAnswer,
  conformanceRequest,
  createIncidentCatalog,
  semanticRoleIds,
} from "./catalog.js";

type Failure = Readonly<{ code: string; message: string }>;

function unwrap<T, E extends Failure>(result: Result<T, E>, label: string): T {
  if (!result.ok)
    throw new Error(`${label}: ${result.error.code}: ${result.error.message}`);
  return result.value;
}

const nonCriticalRequest = oracleRequestSchema.parse({
  ...conformanceRequest,
  evidence: {
    ...conformanceRequest.evidence,
    facts: conformanceRequest.evidence.facts.map((fact) =>
      fact.predicate === "severity"
        ? {
            ...fact,
            statement: "Incident inc-482 has declared severity SEV-3.",
            object: "SEV-3",
          }
        : fact,
    ),
  },
});

export const conformanceSuite = catalogConformanceSuiteSchema.parse({
  protocol: "lachesis-cross-catalog-conformance-suite/1",
  fixtures: [
    {
      kind: "schema",
      role: { id: semanticRoleIds.request, version: "1" },
      values: [conformanceRequest, nonCriticalRequest],
    },
    {
      kind: "schema",
      role: { id: semanticRoleIds.answer, version: "1" },
      values: [conformanceAnswer],
    },
    {
      kind: "schema",
      role: { id: semanticRoleIds.action, version: "1" },
      values: ["", "open-status-page", "page-primary-oncall"],
    },
    {
      kind: "schema",
      role: { id: semanticRoleIds.boolean, version: "1" },
      values: [false, true],
    },
    {
      kind: "function",
      role: { id: semanticRoleIds.normalize, version: "1" },
      inputs: [conformanceRequest, nonCriticalRequest],
    },
    {
      kind: "function",
      role: { id: semanticRoleIds.critical, version: "1" },
      inputs: [conformanceRequest, nonCriticalRequest],
    },
    {
      kind: "function",
      role: { id: semanticRoleIds.escalate, version: "1" },
      inputs: [conformanceRequest, nonCriticalRequest],
    },
    {
      kind: "function",
      role: { id: semanticRoleIds.review, version: "1" },
      inputs: [conformanceRequest, nonCriticalRequest],
    },
    {
      kind: "function",
      role: { id: semanticRoleIds.canonicalAction, version: "1" },
      inputs: ["PAGE-PRIMARY-ONCALL", " open-status-page "],
    },
    {
      kind: "reducer",
      role: { id: semanticRoleIds.priorityAction, version: "1" },
      values: ["", "open-status-page", "page-primary-oncall"],
    },
    {
      kind: "fixedPointStep",
      role: { id: semanticRoleIds.converge, version: "1" },
      inputs: [conformanceRequest, nonCriticalRequest],
    },
    {
      kind: "measure",
      role: { id: semanticRoleIds.evidenceCount, version: "1" },
      inputs: [conformanceRequest, nonCriticalRequest],
    },
    {
      kind: "effect",
      role: { id: semanticRoleIds.decide, version: "1" },
    },
  ],
});

const manifestPolicy = {
  allowedCapabilities: ["incident.decision.mock"],
  budget: {
    maxEffectCalls: 1,
    maxCollectionItems: 8,
    maxRecursionDepth: 0,
    maxTokens: 64,
    maxWallClockMs: 250,
    maxParallelism: 1,
  },
} as const;

function manifestSummary(manifest: PlanLanguageManifest): ManifestSummary {
  return {
    catalog: manifest.catalog,
    catalogFingerprint: manifest.catalogFingerprint,
    manifestDigest: manifest.manifestDigest,
    schemaCount: manifest.schemas.length,
    operationCount: manifest.operations.length,
    roleCount:
      (manifest.semanticRoles?.schemas.length ?? 0) +
      (manifest.semanticRoles?.operations.length ?? 0),
  };
}

type ManifestSummary = Readonly<{
  catalog: PlanLanguageManifest["catalog"];
  catalogFingerprint: string;
  manifestDigest: string;
  schemaCount: number;
  operationCount: number;
  roleCount: number;
}>;

type DiagnosticSummary = Readonly<{
  classification: CatalogConformanceDiagnostic["outcome"];
  stableCode: CatalogConformanceDiagnostic["code"];
  role: CatalogConformanceDiagnostic["role"];
  boundary: string;
  obligation: string;
  action: CatalogConformanceDiagnostic["action"];
  human: string;
  diagnostic: CatalogConformanceDiagnostic;
}>;

export type CatalogEvolutionResult = Readonly<{
  safeCompatible: Readonly<{
    classification: "conformant";
    report: CatalogConformanceReport;
    reportVerified: true;
  }>;
  declarationRepairable: DiagnosticSummary;
  genuinelyNonEquivalent: DiagnosticSummary;
  manifests: Readonly<{
    baseline: ManifestSummary;
    compatible: ManifestSummary;
    declarationRepairable: ManifestSummary;
    genuinelyNonEquivalent: ManifestSummary;
    migration: Readonly<{
      compatibleRequiresRecompile: true;
      priorManifestRetained: true;
      declarationRepairRequiresAuthorAttestation: true;
      nonEquivalentSubstitutionForbidden: true;
    }>;
  }>;
}>;

export async function runCatalogEvolution(): Promise<CatalogEvolutionResult> {
  const baseline = createIncidentCatalog("baseline");
  const compatible = createIncidentCatalog("compatible");
  const declarationRepairable = createIncidentCatalog("declaration-repairable");
  const genuinelyNonEquivalent = createIncidentCatalog(
    "genuinely-non-equivalent",
  );
  const [
    compatibleAssessment,
    declarationAssessment,
    nonEquivalentAssessment,
    baselineManifestResult,
    compatibleManifestResult,
    declarationManifestResult,
    nonEquivalentManifestResult,
  ] = await Promise.all([
    diagnoseCatalogsOffline({
      left: baseline.catalog,
      right: compatible.catalog,
      suite: conformanceSuite,
    }),
    diagnoseCatalogsOffline({
      left: baseline.catalog,
      right: declarationRepairable.catalog,
      suite: conformanceSuite,
    }),
    diagnoseCatalogsOffline({
      left: baseline.catalog,
      right: genuinelyNonEquivalent.catalog,
      suite: conformanceSuite,
    }),
    createPlanLanguageManifest(baseline.catalog, manifestPolicy),
    createPlanLanguageManifest(compatible.catalog, manifestPolicy),
    createPlanLanguageManifest(declarationRepairable.catalog, manifestPolicy),
    createPlanLanguageManifest(genuinelyNonEquivalent.catalog, manifestPolicy),
  ]);
  const compatibleResult = unwrap(
    compatibleAssessment,
    "compatible conformance",
  );
  if (compatibleResult.kind !== "conformant")
    throw new Error("The compatible evolution was rejected.");
  unwrap(
    await verifyCatalogConformanceReport(compatibleResult.report),
    "compatible report verification",
  );
  const declarationResult = unwrap(
    declarationAssessment,
    "declaration diagnostic",
  );
  if (
    declarationResult.kind !== "rejected" ||
    declarationResult.diagnostic.outcome !== "declaration-repairable" ||
    declarationResult.diagnostic.action.kind !== "review-declaration"
  )
    throw new Error("The declaration evolution was misclassified.");
  unwrap(
    await verifyCatalogConformanceDiagnostic(declarationResult.diagnostic),
    "declaration diagnostic verification",
  );
  const nonEquivalentResult = unwrap(
    nonEquivalentAssessment,
    "non-equivalence diagnostic",
  );
  if (
    nonEquivalentResult.kind !== "rejected" ||
    nonEquivalentResult.diagnostic.outcome !== "genuinely-non-equivalent" ||
    nonEquivalentResult.diagnostic.action.kind !== "do-not-substitute"
  )
    throw new Error("The non-equivalent evolution was misclassified.");
  unwrap(
    await verifyCatalogConformanceDiagnostic(nonEquivalentResult.diagnostic),
    "non-equivalence diagnostic verification",
  );
  const baselineManifest = unwrap(baselineManifestResult, "baseline manifest");
  const compatibleManifest = unwrap(
    compatibleManifestResult,
    "compatible manifest",
  );
  const declarationManifest = unwrap(
    declarationManifestResult,
    "declaration manifest",
  );
  const nonEquivalentManifest = unwrap(
    nonEquivalentManifestResult,
    "non-equivalent manifest",
  );
  if (
    baselineManifest.catalogFingerprint ===
      compatibleManifest.catalogFingerprint ||
    baselineManifest.manifestDigest === compatibleManifest.manifestDigest
  )
    throw new Error("Compatible evolution did not change manifest identity.");
  return {
    safeCompatible: {
      classification: "conformant",
      report: compatibleResult.report,
      reportVerified: true,
    },
    declarationRepairable: {
      classification: declarationResult.diagnostic.outcome,
      stableCode: declarationResult.diagnostic.code,
      role: declarationResult.diagnostic.role,
      boundary: declarationResult.diagnostic.boundary,
      obligation: declarationResult.diagnostic.obligation,
      action: declarationResult.diagnostic.action,
      human: renderCatalogConformanceDiagnostic(declarationResult.diagnostic),
      diagnostic: declarationResult.diagnostic,
    },
    genuinelyNonEquivalent: {
      classification: nonEquivalentResult.diagnostic.outcome,
      stableCode: nonEquivalentResult.diagnostic.code,
      role: nonEquivalentResult.diagnostic.role,
      boundary: nonEquivalentResult.diagnostic.boundary,
      obligation: nonEquivalentResult.diagnostic.obligation,
      action: nonEquivalentResult.diagnostic.action,
      human: renderCatalogConformanceDiagnostic(nonEquivalentResult.diagnostic),
      diagnostic: nonEquivalentResult.diagnostic,
    },
    manifests: {
      baseline: manifestSummary(baselineManifest),
      compatible: manifestSummary(compatibleManifest),
      declarationRepairable: manifestSummary(declarationManifest),
      genuinelyNonEquivalent: manifestSummary(nonEquivalentManifest),
      migration: {
        compatibleRequiresRecompile: true,
        priorManifestRetained: true,
        declarationRepairRequiresAuthorAttestation: true,
        nonEquivalentSubstitutionForbidden: true,
      },
    },
  };
}
