import {
  createPlanLanguageManifest,
  digestValue,
  fingerprintCatalog,
} from "@nicia-ai/lachesis";
import {
  conformCatalogsOffline,
  verifyCatalogConformanceReport,
} from "@nicia-ai/lachesis-generator";
import { z } from "zod";

import {
  type AdjudicationEntry,
  loadSealedAdjudication,
  mutationClassSchema,
} from "./adjudication.js";
import { createTransitCatalogA } from "./authors/transit-a.js";
import { createWarehouseCatalogA } from "./authors/warehouse-a.js";
import { createWarehouseCatalogB } from "./authors/warehouse-b.js";
import { loadBlindedTrialCases } from "./cases.js";
import {
  createEvolvedWarehouseCatalog,
  createHostileCatalog,
} from "./hostile-catalogs.js";
import { runBlindedCases } from "./runner.js";
import { transitSuite, warehouseSuite } from "./suites.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const scoreSchema = z
  .strictObject({
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().positive(),
  })
  .readonly();
const diagnosticSchema = z
  .strictObject({
    code: z.string(),
    message: z.string(),
    failureClassLocated: z.boolean(),
    targetLocated: z.boolean(),
    repairDirectionPresent: z.boolean(),
  })
  .readonly();
const caseReportSchema = z
  .strictObject({
    caseId: z.string(),
    family: z.enum(["warehouse", "transit", "support"]),
    expected: z.enum(["equivalent", "non-equivalent"]),
    mutationClass: mutationClassSchema,
    rationale: z.string(),
    accepted: z.boolean(),
    outcome: z.enum(["accepted", "rejected"]),
    classification: z.enum([
      "true-accept",
      "false-rejection",
      "true-rejection",
      "false-equivalence",
    ]),
    leftCatalogFingerprint: sha256Schema,
    rightCatalogFingerprint: sha256Schema,
    leftManifestDigest: sha256Schema,
    rightManifestDigest: sha256Schema,
    suiteDigest: sha256Schema,
    conformanceReportDigest: sha256Schema.nullable(),
    diagnostic: diagnosticSchema.nullable(),
  })
  .readonly();

export const m7aConformanceReportSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m7a-independent-catalog-trial/1"),
    packages: z
      .strictObject({
        kernel: z.literal("@nicia-ai/lachesis@0.1.0-alpha.2"),
        generator: z.literal("@nicia-ai/lachesis-generator@0.1.0-alpha.2"),
      })
      .readonly(),
    execution: z
      .strictObject({
        network: z.literal("disabled"),
        modelInference: z.literal("none"),
        effectsInvoked: z.literal(0),
        authorship: z.literal("role-simulated-not-independent-human-evidence"),
      })
      .readonly(),
    caseRegistryDigest: sha256Schema,
    blindOutcomeDigest: sha256Schema,
    adjudicationDigest: sha256Schema,
    cases: z.array(caseReportSchema).length(12).readonly(),
    metrics: z
      .strictObject({
        equivalentPairs: z.literal(3),
        hostilePairs: z.literal(9),
        acceptedHostilePairs: z.number().int().nonnegative(),
        falseRejections: z.number().int().nonnegative(),
        trueAccepts: z.number().int().nonnegative(),
        trueRejections: z.number().int().nonnegative(),
        falseEquivalenceRate: scoreSchema,
        falseRejectionRate: scoreSchema,
        failureClassLocalization: scoreSchema,
        targetLocalization: scoreSchema,
        repairDirectionPresence: scoreSchema,
      })
      .readonly(),
    protocolChecks: z
      .strictObject({
        crossFamilyRejected: z.boolean(),
        incompleteFixtureSetRejected: z.boolean(),
        duplicateAdjudicationIdsRejected: z.boolean(),
        extraAdjudicationIdsRejected: z.boolean(),
      })
      .readonly(),
    evolution: z
      .strictObject({
        registrationOrderFingerprintStable: z.boolean(),
        reconstructionFingerprintStable: z.boolean(),
        versionedCatalogFingerprintChanged: z.boolean(),
        versionedManifestDigestChanged: z.boolean(),
        behaviorPreservingEvolutionConformed: z.boolean(),
        roleVersionMismatchRejected: z.boolean(),
        priorReportStillVerified: z.boolean(),
        originalFingerprint: sha256Schema,
        evolvedFingerprint: sha256Schema,
        originalManifestDigest: sha256Schema,
        evolvedManifestDigest: sha256Schema,
      })
      .readonly(),
    gates: z
      .strictObject({
        zeroFalseEquivalence: z.boolean(),
        zeroFalseRejection: z.boolean(),
        completeHostileCoverage: z.boolean(),
        failureClassLocalizationAtLeast90Percent: z.boolean(),
        targetLocalizationAtLeast80Percent: z.boolean(),
        deterministicIdentity: z.boolean(),
        evolutionAllPassed: z.boolean(),
      })
      .readonly(),
    decision: z.enum(["GO", "NO-GO"]),
    decisionScope: z.literal(
      "larger-offline-independent-author-conformance-study",
    ),
    nonclaims: z
      .tuple([
        z.literal("no-universal-extensional-equivalence"),
        z.literal("no-equivalence-outside-frozen-fixtures"),
        z.literal("no-independent-human-authorship-evidence-from-this-slice"),
        z.literal("no-compositional-generalization"),
        z.literal(
          "no-live-inference-strategy-promotion-m8-or-typegraph-quality-claim",
        ),
      ])
      .readonly(),
    reportDigest: sha256Schema,
  })
  .readonly();

export type M7aConformanceReport = z.infer<typeof m7aConformanceReportSchema>;

const policy = {
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

function labelMap(
  labels: ReadonlyArray<AdjudicationEntry>,
): ReadonlyMap<string, AdjudicationEntry> {
  return new Map(labels.map((label) => [label.caseId, label]));
}

function classification(
  expected: AdjudicationEntry["expected"],
  accepted: boolean,
): "true-accept" | "false-rejection" | "true-rejection" | "false-equivalence" {
  if (expected === "equivalent")
    return accepted ? "true-accept" : "false-rejection";
  return accepted ? "false-equivalence" : "true-rejection";
}

async function protocolChecks(): Promise<
  Readonly<{
    crossFamilyRejected: boolean;
    incompleteFixtureSetRejected: boolean;
    duplicateAdjudicationIdsRejected: boolean;
    extraAdjudicationIdsRejected: boolean;
  }>
> {
  const crossFamily = await conformCatalogsOffline({
    left: createWarehouseCatalogA(),
    right: createTransitCatalogA(),
    suite: warehouseSuite,
  });
  const incomplete = await conformCatalogsOffline({
    left: createWarehouseCatalogA(),
    right: createWarehouseCatalogB(),
    suite: {
      protocol: "lachesis-cross-catalog-conformance-suite/1",
      fixtures: warehouseSuite.fixtures.slice(1),
    },
  });
  const labels = loadSealedAdjudication();
  const first = labels.at(0);
  if (first === undefined)
    throw new Error("Adjudication is unexpectedly empty.");
  const duplicate = [...labels.slice(1), first, first];
  const extra = [...labels.slice(1), { ...first, caseId: "blind-99" }];
  return {
    crossFamilyRejected: !crossFamily.ok,
    incompleteFixtureSetRejected: !incomplete.ok,
    duplicateAdjudicationIdsRejected: !validLabelJoin(duplicate, 12),
    extraAdjudicationIdsRejected: !validLabelJoin(extra, 12),
  };
}

function validLabelJoin(
  labels: ReadonlyArray<AdjudicationEntry>,
  expectedCount: number,
): boolean {
  const ids = labels.map((label) => label.caseId);
  const expectedIds = Array.from(
    { length: expectedCount },
    (_, index) => `blind-${String(index + 1).padStart(2, "0")}`,
  );
  return (
    ids.length === expectedCount &&
    new Set(ids).size === expectedCount &&
    ids.toSorted().join("\u0000") === expectedIds.join("\u0000")
  );
}

async function evolutionChecks(): Promise<M7aConformanceReport["evolution"]> {
  const original = createWarehouseCatalogB();
  const evolved = createEvolvedWarehouseCatalog();
  const [
    ordered,
    reversed,
    reconstructed,
    originalFingerprint,
    evolvedFingerprint,
    originalManifest,
    evolvedManifest,
  ] = await Promise.all([
    fingerprintCatalog(createWarehouseCatalogA()),
    fingerprintCatalog(createWarehouseCatalogA(true)),
    fingerprintCatalog(createWarehouseCatalogB()),
    fingerprintCatalog(original),
    fingerprintCatalog(evolved),
    createPlanLanguageManifest(original, policy),
    createPlanLanguageManifest(evolved, policy),
  ]);
  if (
    !ordered.ok ||
    !reversed.ok ||
    !reconstructed.ok ||
    !originalFingerprint.ok ||
    !evolvedFingerprint.ok ||
    !originalManifest.ok ||
    !evolvedManifest.ok
  )
    throw new Error("Catalog evolution identities could not be constructed.");
  const priorReport = await conformCatalogsOffline({
    left: createWarehouseCatalogA(),
    right: original,
    suite: warehouseSuite,
  });
  const evolvedReport = await conformCatalogsOffline({
    left: createWarehouseCatalogA(),
    right: evolved,
    suite: warehouseSuite,
  });
  const roleMismatch = await conformCatalogsOffline({
    left: createTransitCatalogA(),
    right: createHostileCatalog("blind-09"),
    suite: transitSuite,
  });
  return {
    registrationOrderFingerprintStable: ordered.value === reversed.value,
    reconstructionFingerprintStable:
      originalFingerprint.value === reconstructed.value,
    versionedCatalogFingerprintChanged:
      originalFingerprint.value !== evolvedFingerprint.value,
    versionedManifestDigestChanged:
      originalManifest.value.manifestDigest !==
      evolvedManifest.value.manifestDigest,
    behaviorPreservingEvolutionConformed: evolvedReport.ok,
    roleVersionMismatchRejected: !roleMismatch.ok,
    priorReportStillVerified:
      priorReport.ok &&
      (await verifyCatalogConformanceReport(priorReport.value)).ok,
    originalFingerprint: originalFingerprint.value,
    evolvedFingerprint: evolvedFingerprint.value,
    originalManifestDigest: originalManifest.value.manifestDigest,
    evolvedManifestDigest: evolvedManifest.value.manifestDigest,
  };
}

function allEvolutionPassed(
  evolution: M7aConformanceReport["evolution"],
): boolean {
  return (
    evolution.registrationOrderFingerprintStable &&
    evolution.reconstructionFingerprintStable &&
    evolution.versionedCatalogFingerprintChanged &&
    evolution.versionedManifestDigestChanged &&
    evolution.behaviorPreservingEvolutionConformed &&
    evolution.roleVersionMismatchRejected &&
    evolution.priorReportStillVerified
  );
}

/** Runs, then unblinds and adjudicates, the frozen M7a vertical slice. */
export async function createM7aConformanceReport(): Promise<M7aConformanceReport> {
  const [blinded, repeatedBlindRun] = await Promise.all([
    runBlindedCases(loadBlindedTrialCases()),
    runBlindedCases(loadBlindedTrialCases()),
  ]);
  const labels = loadSealedAdjudication();
  if (!validLabelJoin(labels, blinded.outcomes.length))
    throw new Error(
      "Adjudication IDs do not exactly match the blinded registry.",
    );
  const adjudicationDigest = await digestValue(labels);
  if (!adjudicationDigest.ok) throw new Error("Adjudication identity failed.");
  const labelsById = labelMap(labels);
  const cases = blinded.outcomes.map((outcome) => {
    const label = labelsById.get(outcome.caseId);
    if (label === undefined)
      throw new Error(`Missing adjudication for ${outcome.caseId}.`);
    return {
      ...outcome,
      expected: label.expected,
      mutationClass: label.mutationClass,
      rationale: label.rationale,
      outcome: outcome.accepted ? ("accepted" as const) : ("rejected" as const),
      classification: classification(label.expected, outcome.accepted),
    };
  });
  const hostile = cases.filter((item) => item.expected === "non-equivalent");
  const positives = cases.filter((item) => item.expected === "equivalent");
  const rejections = cases.filter((item) => !item.accepted);
  const acceptedHostilePairs = hostile.filter((item) => item.accepted).length;
  const falseRejections = positives.filter((item) => !item.accepted).length;
  const trueAccepts = positives.length - falseRejections;
  const trueRejections = hostile.length - acceptedHostilePairs;
  const failureClassLocated = rejections.filter(
    (item) => item.diagnostic?.failureClassLocated === true,
  ).length;
  const targetLocated = rejections.filter(
    (item) => item.diagnostic?.targetLocated === true,
  ).length;
  const repairDirectionPresent = rejections.filter(
    (item) => item.diagnostic?.repairDirectionPresent === true,
  ).length;
  const [checks, evolution] = await Promise.all([
    protocolChecks(),
    evolutionChecks(),
  ]);
  const gates = {
    zeroFalseEquivalence: acceptedHostilePairs === 0,
    zeroFalseRejection: falseRejections === 0,
    completeHostileCoverage: hostile.length === 9,
    failureClassLocalizationAtLeast90Percent:
      failureClassLocated * 10 >= rejections.length * 9,
    targetLocalizationAtLeast80Percent:
      targetLocated * 10 >= rejections.length * 8,
    deterministicIdentity:
      blinded.caseRegistryDigest === repeatedBlindRun.caseRegistryDigest &&
      blinded.blindOutcomeDigest === repeatedBlindRun.blindOutcomeDigest,
    evolutionAllPassed: allEvolutionPassed(evolution),
  };
  const go =
    Object.values(gates).every(Boolean) && Object.values(checks).every(Boolean);
  const body = {
    protocol: "lachesis-m7a-independent-catalog-trial/1" as const,
    packages: {
      kernel: "@nicia-ai/lachesis@0.1.0-alpha.2" as const,
      generator: "@nicia-ai/lachesis-generator@0.1.0-alpha.2" as const,
    },
    execution: {
      network: "disabled" as const,
      modelInference: "none" as const,
      effectsInvoked: 0 as const,
      authorship: "role-simulated-not-independent-human-evidence" as const,
    },
    caseRegistryDigest: blinded.caseRegistryDigest,
    blindOutcomeDigest: blinded.blindOutcomeDigest,
    adjudicationDigest: adjudicationDigest.value,
    cases,
    metrics: {
      equivalentPairs: 3 as const,
      hostilePairs: 9 as const,
      acceptedHostilePairs,
      falseRejections,
      trueAccepts,
      trueRejections,
      falseEquivalenceRate: {
        numerator: acceptedHostilePairs,
        denominator: hostile.length,
      },
      falseRejectionRate: {
        numerator: falseRejections,
        denominator: positives.length,
      },
      failureClassLocalization: {
        numerator: failureClassLocated,
        denominator: rejections.length,
      },
      targetLocalization: {
        numerator: targetLocated,
        denominator: rejections.length,
      },
      repairDirectionPresence: {
        numerator: repairDirectionPresent,
        denominator: rejections.length,
      },
    },
    protocolChecks: checks,
    evolution,
    gates,
    decision: go ? ("GO" as const) : ("NO-GO" as const),
    decisionScope:
      "larger-offline-independent-author-conformance-study" as const,
    nonclaims: [
      "no-universal-extensional-equivalence",
      "no-equivalence-outside-frozen-fixtures",
      "no-independent-human-authorship-evidence-from-this-slice",
      "no-compositional-generalization",
      "no-live-inference-strategy-promotion-m8-or-typegraph-quality-claim",
    ] as const,
  };
  const reportDigest = await digestValue(body);
  if (!reportDigest.ok) throw new Error("M7a report identity failed.");
  return m7aConformanceReportSchema.parse({
    ...body,
    reportDigest: reportDigest.value,
  });
}

export async function verifyM7aConformanceReport(
  value: unknown,
): Promise<boolean> {
  const parsed = m7aConformanceReportSchema.safeParse(value);
  if (!parsed.success) return false;
  const { reportDigest, ...body } = parsed.data;
  const digest = await digestValue(body);
  return digest.ok && digest.value === reportDigest;
}
