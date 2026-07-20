import {
  decodeM4d1OracleWire,
  deduplicateM4d1VisibleRequests,
  designM4d1Power,
  exactM4d1GatePower,
  exactTwoSidedMcNemarP,
  identifyM4d1CandidatePolicy,
  M3B_PREREGISTERED_CORPUS,
  M3B_REFERENCE_GRAPH,
  M4D1_CANDIDATE_POLICY,
  M4D1_EXISTING_M4A_DISPOSITION,
  m4d1CandidatePolicySchema,
  m4d1OracleRequestSchema,
  m4d1OutcomeMeasurementsSchema,
  selectM4d1CandidateView,
} from "@nicia-ai/lachesis-evidence";
import { describe, expect, it } from "vitest";

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function request() {
  const task = required(
    M3B_PREREGISTERED_CORPUS.find(
      (candidate) =>
        candidate.split === "development" &&
        candidate.category === "contradiction",
    ),
    "Missing contradiction fixture.",
  );
  const facts = M3B_REFERENCE_GRAPH.facts.filter((fact) =>
    task.expectedFactIds.includes(fact.id),
  );
  const citationIds = new Set(facts.flatMap((fact) => fact.citationIds));
  return m4d1OracleRequestSchema.parse({
    instruction: task.instruction,
    answerContract: task.answerContract,
    evidence: {
      facts,
      citations: M3B_REFERENCE_GRAPH.citations.filter((citation) =>
        citationIds.has(citation.id),
      ),
      edges: [],
      paths: [],
    },
    wireRepair: null,
    semanticRepair: null,
  });
}

describe("M4d.1 offline protocol and design", () => {
  it("keeps lexical as default and identifies the explicit two-rule candidate", async () => {
    expect(M4D1_EXISTING_M4A_DISPOSITION).toMatchObject({
      policyDigest:
        "d93d87fc1d337b691f0fc24be5524e491525052cce8fa7157ed1ab4e4ddc721f",
      status: "development-rejected",
      modifiedByM4d1: false,
      productionDefault: false,
    });
    expect(
      M4D1_CANDIDATE_POLICY.rules.filter(
        (rule) => rule.view !== "lexical-facts",
      ),
    ).toEqual([
      {
        provider: "anthropic",
        category: "contradiction",
        view: "graph-facts",
      },
      {
        provider: "anthropic",
        category: "retraction",
        view: "graph-typed",
      },
    ]);
    expect(selectM4d1CandidateView("openai", "contradiction")).toBe(
      "lexical-facts",
    );
    expect(selectM4d1CandidateView("anthropic", "provenance")).toBe(
      "lexical-facts",
    );
    const forward = await identifyM4d1CandidatePolicy();
    const reverse = await identifyM4d1CandidatePolicy({
      ...M4D1_CANDIDATE_POLICY,
      rules: M4D1_CANDIDATE_POLICY.rules.toReversed(),
    });
    expect(forward).toEqual(reverse);
    expect(forward.ok).toBe(true);
    expect(forward).toEqual({
      ok: true,
      value: "29121609dde1241c4cfd5fae5053e5fbf3482c3de963b97e0e6fa220e8f3daa7",
    });
    expect(
      m4d1CandidatePolicySchema.safeParse({
        ...M4D1_CANDIDATE_POLICY,
        productionDefault: true,
      }).success,
    ).toBe(false);
  });

  it("reproduces exact paired power thresholds and reference p-values", async () => {
    expect(exactTwoSidedMcNemarP(20, 0)).toEqual({
      ok: true,
      value: 0.0000019073486328125,
    });
    expect(exactTwoSidedMcNemarP(10, 10)).toEqual({ ok: true, value: 1 });
    expect(exactTwoSidedMcNemarP(-1, 0)).toMatchObject({
      ok: false,
      error: { code: "INVALID_POWER_INPUT" },
    });
    const design = await designM4d1Power();
    expect(design.ok).toBe(true);
    if (!design.ok) return;
    expect(design.value.hypotheses).toMatchObject([
      {
        category: "contradiction",
        minimumCasesPerRepetition: 2289,
        achievedExactPower: 0.900032071828,
        previousSampleExactPower: 0.899888564971,
      },
      {
        category: "retraction",
        minimumCasesPerRepetition: 228,
        achievedExactPower: 0.901532062852,
        previousSampleExactPower: 0.8999321961,
      },
    ]);
    expect(design.value.proposedCorpus).toEqual({
      contradictionCases: 2289,
      retractionCases: 228,
      uniqueCases: 2517,
      initialCalls: 10068,
      practicalMaximumUniqueCases: 500,
      status: "blocked-impractical-sample-size",
      finalCorpusGenerated: false,
    });
    expect(design.value.designDigest).toBe(
      "29c80e1348933b232d057e8030d94c0abee53c91f76e79ff5f131a8f36b2366a",
    );
    const previous = exactM4d1GatePower(2288, 1 / 20, 2 / 3);
    const minimum = exactM4d1GatePower(2289, 1 / 20, 2 / 3);
    expect(previous.ok && previous.value).toBeLessThan(0.9);
    expect(minimum.ok && minimum.value).toBeGreaterThanOrEqual(0.9);
    expect(exactM4d1GatePower(0, 1 / 20, 2 / 3)).toMatchObject({
      ok: false,
      error: { code: "INVALID_POWER_INPUT" },
    });
  }, 30_000);

  it("deduplicates byte-identical visible requests across policies", async () => {
    const visibleRequest = request();
    const shared = await deduplicateM4d1VisibleRequests([
      {
        conditionId: "case-a-candidate",
        provider: "anthropic",
        repetition: 1,
        policyId: "candidate",
        request: visibleRequest,
      },
      {
        conditionId: "case-a-lexical",
        provider: "anthropic",
        repetition: 1,
        policyId: "lexical",
        request: visibleRequest,
      },
      {
        conditionId: "case-a-candidate-replication",
        provider: "anthropic",
        repetition: 2,
        policyId: "candidate",
        request: visibleRequest,
      },
    ]);
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;
    expect(shared.value).toHaveLength(2);
    expect(shared.value[0]?.policyMappings).toHaveLength(2);
    expect(shared.value[1]?.policyMappings).toHaveLength(1);
  });

  it("keeps wire, semantic, and final outcomes distinct", () => {
    expect(
      decodeM4d1OracleWire(
        JSON.stringify({
          outcome: "answered",
          answerValues: ["value"],
          supportingFactIds: ["fact-1"],
        }),
      ),
    ).toMatchObject({ kind: "accepted" });
    expect(decodeM4d1OracleWire("not-json")).toMatchObject({
      kind: "json-parse-failed",
    });
    expect(decodeM4d1OracleWire('{"outcome":"answered"}')).toMatchObject({
      kind: "wire-schema-rejected",
    });
    expect(
      m4d1OutcomeMeasurementsSchema.safeParse({
        firstAttemptEndToEndSuccess: false,
        firstAttemptSemanticSuccess: false,
        postWireRepairSuccess: true,
        postSemanticRepairSuccess: null,
        finalReliability: true,
        wireRepairCalls: 1,
        semanticRepairCalls: 0,
      }).success,
    ).toBe(true);
    expect(
      m4d1OutcomeMeasurementsSchema.safeParse({
        firstAttemptEndToEndSuccess: false,
        firstAttemptSemanticSuccess: false,
        postWireRepairSuccess: true,
        postSemanticRepairSuccess: null,
        finalReliability: true,
        wireRepairCalls: 0,
        semanticRepairCalls: 0,
      }).success,
    ).toBe(false);
  });
});
