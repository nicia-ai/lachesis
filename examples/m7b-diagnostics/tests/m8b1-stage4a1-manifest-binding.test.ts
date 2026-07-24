import { readFile } from "node:fs/promises";

import {
  type CompilationPolicy,
  createPlanLanguageManifest,
  digestValue,
  fingerprintCatalog,
  parseJson,
} from "@nicia-ai/lachesis";
import {
  diagnoseCatalogsOffline,
  verifyCatalogConformanceDiagnostic,
} from "@nicia-ai/lachesis-generator";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { catalogsFor, loadM7bDevelopmentCorpus } from "../src/corpus.js";

const leftPolicy = {
  allowedCapabilities: ["m8b.stage4a1/left"],
  budget: {
    maxEffectCalls: 7,
    maxCollectionItems: 17,
    maxRecursionDepth: 2,
    maxTokens: 321,
    maxWallClockMs: 654,
    maxParallelism: 3,
  },
} as const satisfies CompilationPolicy;

const rightPolicy = {
  allowedCapabilities: ["m8b.stage4a1/right"],
  budget: {
    maxEffectCalls: 11,
    maxCollectionItems: 19,
    maxRecursionDepth: 3,
    maxTokens: 987,
    maxWallClockMs: 1_234,
    maxParallelism: 4,
  },
} as const satisfies CompilationPolicy;

const representativeCases = [
  "m7b-dev-01-missing-declarations",
  "m7b-dev-03-incomplete-evidence",
  "m7b-dev-09-output",
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const evidenceCaseSchema = z
  .strictObject({
    caseId: z.enum(representativeCases),
    outcome: z.enum([
      "declaration-repairable",
      "genuinely-non-equivalent",
      "insufficient-evidence",
    ]),
    leftCatalogFingerprint: sha256Schema,
    rightCatalogFingerprint: sha256Schema,
    suiteDigest: sha256Schema,
    cliLeftManifestDigest: sha256Schema,
    generatorLeftManifestDigest: sha256Schema,
    cliRightManifestDigest: sha256Schema,
    generatorRightManifestDigest: sha256Schema,
  })
  .readonly();

const decisionEvidenceSchema = z.object({
  regression: z.object({
    leftPolicyDigest: sha256Schema,
    rightPolicyDigest: sha256Schema,
    cases: z.array(evidenceCaseSchema).readonly(),
  }),
});

describe("M8b.1 Stage 4a.1 diagnostic manifest binding", () => {
  it("reconciles fingerprints and suite identity without equating policy-specific manifest digests", async () => {
    const corpus = loadM7bDevelopmentCorpus();
    const evidenceCases: Array<z.infer<typeof evidenceCaseSchema>> = [];
    for (const caseId of representativeCases) {
      const diagnosticCase = corpus.find((item) => item.caseId === caseId);
      if (diagnosticCase === undefined)
        throw new Error(`Missing deterministic diagnostic case ${caseId}.`);
      const catalogs = catalogsFor(diagnosticCase);
      const [assessment, leftManifest, rightManifest, suiteDigest] =
        await Promise.all([
          diagnoseCatalogsOffline({
            ...catalogs,
            suite: diagnosticCase.suite,
          }),
          createPlanLanguageManifest(catalogs.left, leftPolicy),
          createPlanLanguageManifest(catalogs.right, rightPolicy),
          digestValue(diagnosticCase.suite),
        ]);
      expect(assessment.ok).toBe(true);
      expect(leftManifest.ok).toBe(true);
      expect(rightManifest.ok).toBe(true);
      expect(suiteDigest.ok).toBe(true);
      if (
        !assessment.ok ||
        assessment.value.kind !== "rejected" ||
        !leftManifest.ok ||
        !rightManifest.ok ||
        !suiteDigest.ok
      )
        continue;

      const diagnostic = assessment.value.diagnostic;
      expect(diagnostic.outcome).toBe(diagnosticCase.expectedOutcome);
      expect((await verifyCatalogConformanceDiagnostic(diagnostic)).ok).toBe(
        true,
      );
      expect(diagnostic.evidence.leftCatalogFingerprint).toBe(
        leftManifest.value.catalogFingerprint,
      );
      expect(diagnostic.evidence.rightCatalogFingerprint).toBe(
        rightManifest.value.catalogFingerprint,
      );
      expect(diagnostic.evidence.fixtureDigest).toBe(suiteDigest.value);
      expect(diagnostic.evidence.leftManifestDigest).not.toBe(
        leftManifest.value.manifestDigest,
      );
      expect(diagnostic.evidence.rightManifestDigest).not.toBe(
        rightManifest.value.manifestDigest,
      );

      const [leftFingerprint, rightFingerprint] = await Promise.all([
        fingerprintCatalog(catalogs.left),
        fingerprintCatalog(catalogs.right),
      ]);
      expect(leftFingerprint.ok).toBe(true);
      expect(rightFingerprint.ok).toBe(true);
      if (!leftFingerprint.ok || !rightFingerprint.ok) continue;
      expect(diagnostic.evidence.leftCatalogFingerprint).toBe(
        leftFingerprint.value,
      );
      expect(diagnostic.evidence.rightCatalogFingerprint).toBe(
        rightFingerprint.value,
      );
      evidenceCases.push({
        caseId,
        outcome: diagnostic.outcome,
        leftCatalogFingerprint: diagnostic.evidence.leftCatalogFingerprint,
        rightCatalogFingerprint: diagnostic.evidence.rightCatalogFingerprint,
        suiteDigest: suiteDigest.value,
        cliLeftManifestDigest: leftManifest.value.manifestDigest,
        generatorLeftManifestDigest: diagnostic.evidence.leftManifestDigest,
        cliRightManifestDigest: rightManifest.value.manifestDigest,
        generatorRightManifestDigest: diagnostic.evidence.rightManifestDigest,
      });
    }

    const decisionText = await readFile(
      new URL("../../../docs/m8b1-stage4a1-decision.json", import.meta.url),
      "utf8",
    );
    const decisionJson = parseJson(decisionText);
    expect(decisionJson.ok).toBe(true);
    if (!decisionJson.ok) return;
    const committed = decisionEvidenceSchema.parse(decisionJson.value);
    const [leftPolicyDigest, rightPolicyDigest] = await Promise.all([
      digestValue(leftPolicy),
      digestValue(rightPolicy),
    ]);
    expect(leftPolicyDigest.ok).toBe(true);
    expect(rightPolicyDigest.ok).toBe(true);
    if (!leftPolicyDigest.ok || !rightPolicyDigest.ok) return;
    expect(committed.regression).toEqual({
      leftPolicyDigest: leftPolicyDigest.value,
      rightPolicyDigest: rightPolicyDigest.value,
      cases: evidenceCases,
    });
  });
});
