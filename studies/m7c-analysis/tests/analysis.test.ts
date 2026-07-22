import { describe, expect, it } from "vitest";

import {
  analyzeM7c,
  auditM7cPlannedCounts,
  M7C_PLANNED_COUNTS,
  type M7cDecisionRecord,
  type M7cEvolutionRecord,
} from "../src/analysis.js";

const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
const digestC = "c".repeat(64);
const digestD = "d".repeat(64);

type PairKind =
  "equivalent" | "declaration-repairable" | "genuinely-non-equivalent";

function record(
  author: number,
  family: number,
  pairId: string,
  referenceOutcome: PairKind,
  phase: M7cDecisionRecord["phase"],
): M7cDecisionRecord {
  const equivalent = referenceOutcome === "equivalent";
  const repaired =
    referenceOutcome === "declaration-repairable" &&
    phase === "post-diagnostic";
  return {
    protocol: "lachesis-m7c-decision/1",
    authorSessionId: `author-${String(author).padStart(2, "0")}`,
    catalogFamilyId: `family-${String(family).padStart(2, "0")}`,
    pairId,
    phase,
    referenceOutcome,
    acceptedAsEquivalent: equivalent || repaired,
    diagnosticOutcome: equivalent ? null : referenceOutcome,
    failureLocalized: equivalent ? null : true,
    roleLocalized: equivalent ? null : true,
    boundaryLocalized: equivalent ? null : true,
    safeRepairDirectionUnderstood: equivalent ? null : true,
    unsafeRepairDirection: false,
    repairAttempts: phase === "initial" ? 0 : 1,
    completionMs: 1_000,
    initialDeclarationDigest: digestA,
    declarationDigest: phase === "initial" ? digestA : digestB,
    manifestDigest: digestC,
    diagnosticDigest: equivalent ? null : digestD,
  };
}

function syntheticStructure(): Readonly<{
  records: ReadonlyArray<M7cDecisionRecord>;
  evolution: ReadonlyArray<M7cEvolutionRecord>;
}> {
  const records: Array<M7cDecisionRecord> = [];
  const evolution: Array<M7cEvolutionRecord> = [];
  for (let author = 1; author <= 12; author += 1)
    for (let family = 1; family <= 6; family += 1) {
      const pairs = [
        ["pair-equivalent", "equivalent"],
        ["pair-repairable", "declaration-repairable"],
        ["pair-hostile-a", "genuinely-non-equivalent"],
        ["pair-hostile-b", "genuinely-non-equivalent"],
      ] as const;
      for (const [pairId, kind] of pairs) {
        records.push(record(author, family, pairId, kind, "initial"));
        if (kind !== "equivalent")
          records.push(record(author, family, pairId, kind, "post-diagnostic"));
      }
      evolution.push({
        authorSessionId: `author-${String(author).padStart(2, "0")}`,
        catalogFamilyId: `family-${String(family).padStart(2, "0")}`,
        pairId: "pair-hostile-a",
        irrelevantManifestStable: true,
        irrelevantDiagnosticStable: true,
        substantiveManifestChanged: true,
        substantiveDiagnosticChanged: true,
      });
    }
  return { records, evolution };
}

describe("M7c frozen analysis", () => {
  it("audits the preregistered counts without inspecting corpus content", () => {
    expect(auditM7cPlannedCounts(M7C_PLANNED_COUNTS).ok).toBe(true);
    expect(auditM7cPlannedCounts({}).ok).toBe(false);
  });

  it("reports initial and repaired outcomes separately with crossed strata", async () => {
    const input = syntheticStructure();
    const result = await analyzeM7c({
      ...input,
      hiddenAdjudicationLeak: false,
      frozenBindingMismatch: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.initial).toMatchObject({
      decisions: 288,
      nonEquivalentDecisions: 144,
      acceptedFalseEquivalences: 0,
      declarationRepairableDecisions: 72,
    });
    expect(result.value.postDiagnostic).toMatchObject({
      decisions: 216,
      nonEquivalentDecisions: 144,
      acceptedFalseEquivalences: 0,
      correctedDeclarationRepairableDecisions: 72,
      preservedNonEquivalenceDecisions: 144,
    });
    expect(result.value.authors).toHaveLength(12);
    expect(result.value.catalogFamilies).toHaveLength(6);
    expect(result.value.uncertainty).toMatchObject({
      decisionLevelZeroEventUpperBound: 0.02058879229949584,
      authorClusterZeroEventUpperBound: 0.22092219194555585,
      catalogClusterZeroEventUpperBound: 0.39303776899708276,
    });
    expect(result.value.decision).toBe("PASS");
  });

  it("fails on any false equivalence or unsafe repair direction", async () => {
    const input = syntheticStructure();
    const target = input.records.find(
      (item) =>
        item.phase === "post-diagnostic" &&
        item.referenceOutcome === "genuinely-non-equivalent",
    );
    if (target === undefined) throw new Error("Missing hostile test record.");
    const records = input.records.map((item) =>
      item === target
        ? {
            ...item,
            acceptedAsEquivalent: true,
            unsafeRepairDirection: true,
          }
        : item,
    );
    const result = await analyzeM7c({
      records,
      evolution: input.evolution,
      hiddenAdjudicationLeak: false,
      frozenBindingMismatch: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.killGates).toMatchObject({
      falseEquivalenceAccepted: true,
      unsafeRepairDirection: true,
    });
    expect(result.value.decision).toBe("FAIL");
  });

  it("rejects overwritten coordinates and post-diagnostic records without initials", async () => {
    const input = syntheticStructure();
    const first = input.records[0];
    if (first === undefined) throw new Error("Missing structural test record.");
    expect(
      (
        await analyzeM7c({
          records: [...input.records, first],
          evolution: input.evolution,
          hiddenAdjudicationLeak: false,
          frozenBindingMismatch: false,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await analyzeM7c({
          records: [
            record(
              1,
              1,
              "orphan-pair",
              "genuinely-non-equivalent",
              "post-diagnostic",
            ),
          ],
          evolution: [],
          hiddenAdjudicationLeak: false,
          frozenBindingMismatch: false,
        })
      ).ok,
    ).toBe(false);
  });
});
