import {
  createPlanLanguageManifest,
  digestValue,
  type PlanLanguageManifest,
} from "@nicia-ai/lachesis";
import {
  type CatalogConformanceReport,
  conformCatalogsOffline,
} from "@nicia-ai/lachesis-generator";

import type { BlindedTrialCase, CatalogFamily } from "./cases.js";

const manifestPolicy = {
  allowedCapabilities: [],
  budget: {
    maxEffectCalls: 0,
    maxCollectionItems: 1_000,
    maxRecursionDepth: 0,
    maxTokens: 0,
    maxWallClockMs: 1_000,
    maxParallelism: 1,
  },
} as const;

export type BlindDiagnostic = Readonly<{
  code: string;
  message: string;
  failureClassLocated: boolean;
  targetLocated: boolean;
  repairDirectionPresent: boolean;
}>;

export type BlindOutcome = Readonly<{
  caseId: string;
  family: CatalogFamily;
  accepted: boolean;
  leftCatalogFingerprint: string;
  rightCatalogFingerprint: string;
  leftManifestDigest: string;
  rightManifestDigest: string;
  suiteDigest: string;
  conformanceReportDigest: string | null;
  diagnostic: BlindDiagnostic | null;
}>;

export type BlindedRun = Readonly<{
  outcomes: ReadonlyArray<BlindOutcome>;
  caseRegistryDigest: string;
  blindOutcomeDigest: string;
}>;

function diagnosticScore(code: string, message: string): BlindDiagnostic {
  const lower = message.toLowerCase();
  return {
    code,
    message,
    failureClassLocated: [
      "role",
      "fixture",
      "schema",
      "operation",
      "reducer",
      "pointwise",
      "effect",
    ].some((term) => lower.includes(term)),
    targetLocated:
      message.includes("m7a.role/") ||
      lower.includes("versioned semantic-role set") ||
      lower.includes("fixtures"),
    repairDirectionPresent:
      lower.includes("must") || lower.includes("do not declare"),
  };
}

async function manifestFor(
  trialCase: BlindedTrialCase,
  side: "left" | "right",
): Promise<PlanLanguageManifest> {
  const catalog = side === "left" ? trialCase.left : trialCase.right;
  const manifest = await createPlanLanguageManifest(catalog, manifestPolicy);
  if (!manifest.ok)
    throw new Error(`Manifest construction failed for ${trialCase.caseId}.`);
  return manifest.value;
}

async function runCase(trialCase: BlindedTrialCase): Promise<BlindOutcome> {
  const [leftManifest, rightManifest, suiteDigest, result] = await Promise.all([
    manifestFor(trialCase, "left"),
    manifestFor(trialCase, "right"),
    digestValue(trialCase.suite),
    conformCatalogsOffline({
      left: trialCase.left,
      right: trialCase.right,
      suite: trialCase.suite,
    }),
  ]);
  if (!suiteDigest.ok)
    throw new Error(`Suite identity failed for ${trialCase.caseId}.`);
  if (result.ok) {
    return {
      caseId: trialCase.caseId,
      family: trialCase.family,
      accepted: true,
      leftCatalogFingerprint: leftManifest.catalogFingerprint,
      rightCatalogFingerprint: rightManifest.catalogFingerprint,
      leftManifestDigest: leftManifest.manifestDigest,
      rightManifestDigest: rightManifest.manifestDigest,
      suiteDigest: suiteDigest.value,
      conformanceReportDigest: result.value.reportDigest,
      diagnostic: null,
    };
  }
  return {
    caseId: trialCase.caseId,
    family: trialCase.family,
    accepted: false,
    leftCatalogFingerprint: leftManifest.catalogFingerprint,
    rightCatalogFingerprint: rightManifest.catalogFingerprint,
    leftManifestDigest: leftManifest.manifestDigest,
    rightManifestDigest: rightManifest.manifestDigest,
    suiteDigest: suiteDigest.value,
    conformanceReportDigest: null,
    diagnostic: diagnosticScore(result.error.code, result.error.message),
  };
}

/** Executes all cases without importing or receiving adjudication labels. */
export async function runBlindedCases(
  cases: ReadonlyArray<BlindedTrialCase>,
): Promise<BlindedRun> {
  const outcomes = await Promise.all(
    cases.map((trialCase) => runCase(trialCase)),
  );
  const sorted = outcomes.toSorted((left, right) =>
    left.caseId < right.caseId ? -1 : left.caseId > right.caseId ? 1 : 0,
  );
  const registry = sorted.map((outcome) => ({
    caseId: outcome.caseId,
    family: outcome.family,
    leftCatalogFingerprint: outcome.leftCatalogFingerprint,
    rightCatalogFingerprint: outcome.rightCatalogFingerprint,
    suiteDigest: outcome.suiteDigest,
  }));
  const [caseRegistryDigest, blindOutcomeDigest] = await Promise.all([
    digestValue(registry),
    digestValue(sorted),
  ]);
  if (!caseRegistryDigest.ok || !blindOutcomeDigest.ok)
    throw new Error("Blinded trial identities could not be constructed.");
  return {
    outcomes: sorted,
    caseRegistryDigest: caseRegistryDigest.value,
    blindOutcomeDigest: blindOutcomeDigest.value,
  };
}

export type { CatalogConformanceReport };
