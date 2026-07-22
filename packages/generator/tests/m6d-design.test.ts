import { describe, expect, it } from "vitest";

import {
  assignM6dSequence,
  auditM6dWorkloadDisjointness,
  boundM6dMaximumCost,
  designM6dPairedStudy,
  type M6dWorkloadIdentity,
  verifyM6dStudyDesign,
} from "../src/m6d-design.js";

function digest(value: number): string {
  return value.toString(16).padStart(64, "0");
}

function workload(offset: number): M6dWorkloadIdentity {
  return {
    caseIdentity: digest(offset),
    normalizedInstruction: digest(offset + 1),
    publicTaskValue: digest(offset + 2),
    evidenceContractAndContent: digest(offset + 3),
    catalogPair: digest(offset + 4),
    templateIdentity: digest(offset + 5),
  };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture.");
  return value;
}

describe("M6d paired study design", () => {
  it("produces an offline no-go with explicit known and unknown bounds", async () => {
    const result = await designM6dPairedStudy();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      status: "complete-design-no-go",
      claim: {
        inference: {
          casesPerRepetition: 600,
          totalFreshCases: 1_200,
          empiricalPower: {
            kind: "unknown",
            reason: "no-prospective-discordance-distribution",
          },
        },
      },
      bounds: {
        practicalFreshCaseCeiling: { kind: "known", value: 500 },
        requiredFreshCases: { kind: "known", value: 1_200 },
        discoveryPlannerCalls: { kind: "known", value: 1_200 },
        templatePlannerCalls: { kind: "known", value: 0 },
        effectCalls: { kind: "unknown" },
        maximumCostUsdMicros: { kind: "unknown" },
      },
      decision: { outcome: "no-go" },
      authority: {
        liveInferenceAuthorized: false,
        providerIdentityCreated: false,
        campaignCreated: false,
        preregistrationCreated: false,
        spendingAuthorized: false,
      },
    });
    expect((await verifyM6dStudyDesign(result.value)).ok).toBe(true);
    expect(
      (
        await verifyM6dStudyDesign({
          ...result.value,
          status: "complete-design-awaiting-authorization",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await verifyM6dStudyDesign({
          ...result.value,
          designDigest: "f".repeat(64),
        })
      ).ok,
    ).toBe(false);
  });

  it("calculates a ceiling only from explicit safe per-call bounds", async () => {
    const design = await designM6dPairedStudy();
    if (!design.ok) throw new Error(design.error.message);
    expect(
      boundM6dMaximumCost(design.value, {
        plannerCallUsdMicros: 100,
        effectCallUsdMicros: 10,
        effectCallsPerArmPerCase: 2,
      }),
    ).toEqual({
      ok: true,
      value: {
        protocol: "lachesis-m6d-maximum-cost-bound/1",
        maximumPlannerCalls: 1_200,
        maximumEffectCalls: 4_800,
        maximumCostUsdMicros: 168_000,
      },
    });
    expect(
      boundM6dMaximumCost(design.value, {
        plannerCallUsdMicros: -1,
        effectCallUsdMicros: 0,
        effectCallsPerArmPerCase: 0,
      }).ok,
    ).toBe(false);
    expect(
      boundM6dMaximumCost(design.value, {
        plannerCallUsdMicros: Number.MAX_SAFE_INTEGER,
        effectCallUsdMicros: 0,
        effectCallsPerArmPerCase: 0,
      }),
    ).toMatchObject({ ok: false, error: { code: "BUDGET_EXCEEDED" } });
  });

  it("assigns paired order deterministically and rejects invalid identities", () => {
    expect(assignM6dSequence("0".repeat(64))).toEqual({
      ok: true,
      value: "discovery-first",
    });
    expect(assignM6dSequence(`${"0".repeat(63)}1`)).toEqual({
      ok: true,
      value: "template-first",
    });
    expect(assignM6dSequence("not-a-digest").ok).toBe(false);
  });

  it("accepts fresh identities and rejects duplicates or historical overlap", async () => {
    const candidates = [workload(1), workload(10)];
    const historical = [workload(30)];
    const firstCandidate = required(candidates[0]);
    const historicalCase = required(historical[0]);
    const passing = await auditM6dWorkloadDisjointness({
      candidates,
      historical,
    });
    expect(passing).toMatchObject({
      ok: true,
      value: { candidateCount: 2, historicalCount: 1, passed: true },
    });
    expect(
      (
        await auditM6dWorkloadDisjointness({
          candidates: [firstCandidate, firstCandidate],
          historical,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await auditM6dWorkloadDisjointness({
          candidates: [
            {
              ...firstCandidate,
              caseIdentity: historicalCase.caseIdentity,
            },
          ],
          historical,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await auditM6dWorkloadDisjointness({
          candidates: [],
          historical,
        })
      ).ok,
    ).toBe(false);
  });
});
