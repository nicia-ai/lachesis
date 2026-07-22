import { readFile } from "node:fs/promises";

import { parseJson } from "@nicia-ai/lachesis";
import {
  diagnoseCatalogsOffline,
  renderCatalogConformanceDiagnostic,
  verifyCatalogConformanceDiagnostic,
} from "@nicia-ai/lachesis-generator";
import { describe, expect, it } from "vitest";

import { createDiagnosticCatalog } from "../src/catalogs.js";
import {
  catalogsFor,
  diagnosticSuite,
  loadM7bDevelopmentCorpus,
} from "../src/corpus.js";
import {
  createM7bReport,
  m7bReportSchema,
  verifyM7bReport,
} from "../src/report.js";

describe("M7b offline catalog diagnostic hardening", () => {
  it("classifies and exactly localizes every fresh development rejection", async () => {
    const report = await createM7bReport();
    expect(report.counts).toEqual({
      declarationRepairable: 2,
      genuinelyNonEquivalent: 6,
      insufficientEvidence: 1,
      falseEquivalence: 0,
      unsafeRepairDirections: 0,
      exactLocalizations: 9,
      classified: 9,
    });
    expect(report.cases.every((item) => item.exactLocalization)).toBe(true);
    expect(report.decision).toBe("GO");
  });

  it("never recommends metadata repair for genuine non-equivalence", async () => {
    const report = await createM7bReport();
    const hostile = report.cases.filter(
      (item) => item.diagnostic.outcome === "genuinely-non-equivalent",
    );
    expect(hostile).toHaveLength(6);
    expect(
      hostile.every(
        (item) =>
          item.diagnostic.action.kind === "do-not-substitute" &&
          item.diagnostic.action.reason.includes("Do not align metadata"),
      ),
    ).toBe(true);
  });

  it("provides typed conditional declaration guidance without manufacturing equivalence", async () => {
    const cases = loadM7bDevelopmentCorpus().filter(
      (item) => item.expectedOutcome === "declaration-repairable",
    );
    for (const diagnosticCase of cases) {
      const assessment = await diagnoseCatalogsOffline({
        ...catalogsFor(diagnosticCase),
        suite: diagnosticCase.suite,
      });
      expect(assessment.ok).toBe(true);
      if (!assessment.ok || assessment.value.kind !== "rejected") continue;
      expect(assessment.value.diagnostic.action.kind).toBe(
        "review-declaration",
      );
      if (assessment.value.diagnostic.action.kind !== "review-declaration")
        continue;
      expect(assessment.value.diagnostic.action.mechanical).toBe(false);
      expect(
        assessment.value.diagnostic.action.safetyCondition.toLowerCase(),
      ).toMatch(/only|do not/);
    }
  });

  it("preserves the ordinary conformant result for equivalent catalogs", async () => {
    const assessment = await diagnoseCatalogsOffline({
      left: createDiagnosticCatalog("baseline-a"),
      right: createDiagnosticCatalog("baseline-b"),
      suite: diagnosticSuite,
    });
    expect(assessment.ok).toBe(true);
    if (!assessment.ok) return;
    expect(assessment.value.kind).toBe("conformant");
  });

  it("classifies invalid and duplicate suites as insufficient evidence", async () => {
    const catalogs = {
      left: createDiagnosticCatalog("baseline-a"),
      right: createDiagnosticCatalog("baseline-b"),
    };
    const invalid = await diagnoseCatalogsOffline({ ...catalogs, suite: {} });
    expect(invalid.ok).toBe(true);
    if (!invalid.ok || invalid.value.kind !== "rejected") return;
    expect(invalid.value.diagnostic).toMatchObject({
      outcome: "insufficient-evidence",
      boundary: "suite-schema",
      action: { kind: "no-safe-repair" },
    });

    const first = diagnosticSuite.fixtures[0];
    if (first === undefined)
      throw new Error("M7b suite is unexpectedly empty.");
    const duplicate = await diagnoseCatalogsOffline({
      ...catalogs,
      suite: {
        ...diagnosticSuite,
        fixtures: [...diagnosticSuite.fixtures, first],
      },
    });
    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok || duplicate.value.kind !== "rejected") return;
    expect(duplicate.value.diagnostic).toMatchObject({
      code: "DUPLICATE_FIXTURE_EVIDENCE",
      outcome: "insufficient-evidence",
      action: { kind: "edit-suite", operation: "remove-duplicate-fixture" },
    });
  });

  it("keeps human and machine rendering deterministic and tamper-evident", async () => {
    expect((await verifyCatalogConformanceDiagnostic({})).ok).toBe(false);
    const assessment = await diagnoseCatalogsOffline({
      left: createDiagnosticCatalog("baseline-a"),
      right: createDiagnosticCatalog("output-semantics"),
      suite: diagnosticSuite,
    });
    expect(assessment.ok).toBe(true);
    if (!assessment.ok || assessment.value.kind !== "rejected") return;
    const diagnostic = assessment.value.diagnostic;
    expect(renderCatalogConformanceDiagnostic(diagnostic)).toBe(
      renderCatalogConformanceDiagnostic(diagnostic),
    );
    expect((await verifyCatalogConformanceDiagnostic(diagnostic)).ok).toBe(
      true,
    );
    expect(
      (
        await verifyCatalogConformanceDiagnostic({
          ...diagnostic,
          boundary: "tampered-boundary",
        })
      ).ok,
    ).toBe(false);
  });

  it("separates semantic diagnostic identity from irrelevant manifest evolution", async () => {
    const report = await createM7bReport();
    expect(report.evolution).toMatchObject({
      irrelevantEvolutionDiagnosticStable: true,
      irrelevantEvolutionManifestChanged: true,
      substantiveEvolutionDiagnosticChanged: true,
      substantiveEvolutionManifestChanged: true,
    });
  });

  it("reproduces the committed report while preserving the M7a digest", async () => {
    const text = await readFile(
      new URL("../reports/m7b-diagnostic-report.json", import.meta.url),
      "utf8",
    );
    const parsed = parseJson(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const committed = m7bReportSchema.parse(parsed.value);
    expect(await createM7bReport()).toEqual(committed);
    expect(await verifyM7bReport(committed)).toBe(true);
    expect(committed.m7aReportDigestPreserved).toBe(
      "8cc35372ec4f4f560180a2f26cf4edb46c9c298f49f21cc39f8df07cde19cf85",
    );
  });
});
