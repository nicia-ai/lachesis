import { readFile } from "node:fs/promises";

import { parseJson } from "@nicia-ai/lachesis";
import { conformCatalogsOffline } from "@nicia-ai/lachesis-generator";
import { describe, expect, it } from "vitest";

import { createWarehouseCatalogA } from "../src/authors/warehouse-a.js";
import { createWarehouseCatalogB } from "../src/authors/warehouse-b.js";
import { loadBlindedTrialCases } from "../src/cases.js";
import {
  createM7aConformanceReport,
  m7aConformanceReportSchema,
  verifyM7aConformanceReport,
} from "../src/report.js";
import { runBlindedCases } from "../src/runner.js";
import { warehouseSuite } from "../src/suites.js";

describe("M7a independent catalog conformance vertical slice", () => {
  it("keeps expected labels out of blinded runner outcomes", async () => {
    const blinded = await runBlindedCases(loadBlindedTrialCases());
    expect(blinded.outcomes).toHaveLength(12);
    expect(blinded.outcomes.every((outcome) => !("expected" in outcome))).toBe(
      true,
    );
  });

  it("accepts all three positives and no hostile near-equivalence", async () => {
    const report = await createM7aConformanceReport();
    expect(report.metrics).toMatchObject({
      equivalentPairs: 3,
      hostilePairs: 9,
      acceptedHostilePairs: 0,
      falseRejections: 0,
      trueAccepts: 3,
      trueRejections: 9,
    });
    expect(
      report.cases.filter(
        (item) => item.classification === "false-equivalence",
      ),
    ).toEqual([]);
    expect(report.decision).toBe("GO");
  });

  it("rejects duplicate and incomplete fixture coverage", async () => {
    const first = warehouseSuite.fixtures.at(0);
    if (first === undefined) throw new Error("Warehouse suite is empty.");
    const duplicate = await conformCatalogsOffline({
      left: createWarehouseCatalogA(),
      right: createWarehouseCatalogB(),
      suite: {
        protocol: "lachesis-cross-catalog-conformance-suite/1",
        fixtures: [...warehouseSuite.fixtures, first],
      },
    });
    const incomplete = await conformCatalogsOffline({
      left: createWarehouseCatalogA(),
      right: createWarehouseCatalogB(),
      suite: {
        protocol: "lachesis-cross-catalog-conformance-suite/1",
        fixtures: warehouseSuite.fixtures.slice(1),
      },
    });
    expect(duplicate.ok).toBe(false);
    expect(incomplete.ok).toBe(false);
  });

  it("keeps evolution identity-sensitive while preserving finite conformance", async () => {
    const report = await createM7aConformanceReport();
    expect(report.evolution).toMatchObject({
      registrationOrderFingerprintStable: true,
      reconstructionFingerprintStable: true,
      versionedCatalogFingerprintChanged: true,
      versionedManifestDigestChanged: true,
      behaviorPreservingEvolutionConformed: true,
      roleVersionMismatchRejected: true,
      priorReportStillVerified: true,
    });
  });

  it("reproduces the committed machine report and rejects identity tamper", async () => {
    const text = await readFile(
      new URL("../reports/m7a-conformance-report.json", import.meta.url),
      "utf8",
    );
    const parsed = parseJson(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const committed = m7aConformanceReportSchema.parse(parsed.value);
    const generated = await createM7aConformanceReport();
    expect(generated).toEqual(committed);
    expect(await verifyM7aConformanceReport(committed)).toBe(true);
    expect(
      await verifyM7aConformanceReport({
        ...committed,
        decision: committed.decision === "GO" ? "NO-GO" : "GO",
      }),
    ).toBe(false);
  });
});
