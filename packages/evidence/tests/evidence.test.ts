import { digestValue, type Result } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import {
  auditM3aOfflineDesign,
  blindM3a1IntegrityAudit,
  createGraphSelectedAdjacencyEvidenceSource,
  createGraphSelectedFactsEvidenceSource,
  createInMemoryGraphEvidenceSource,
  createMatchedTextEvidenceSource,
  type EvidenceEdge,
  evidenceFactSchema,
  type EvidenceGraph,
  type EvidenceNeighborhood,
  evidencePathSchema,
  type EvidenceQuery,
  type EvidenceSource,
  isEvidenceFactBelievedAt,
  M3A1_CORPUS_PROTOCOL,
  M3A1_FACTORIAL_ARMS,
  M3A1_PREREGISTERED_CORPUS,
  M3A1_PROSPECTIVE_ANALYSIS,
  M3A1_REFERENCE_GRAPH,
  type M3a1Sources,
  type M3aTask,
  m3aTaskSchema,
  referenceEvidenceSelection,
  selectEvidence,
} from "../src/index.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function sources(graph: EvidenceGraph = M3A1_REFERENCE_GRAPH): M3a1Sources {
  return {
    lexicalFacts: unwrap(createMatchedTextEvidenceSource(graph)),
    graphFacts: unwrap(createGraphSelectedFactsEvidenceSource(graph)),
    graphAdjacency: unwrap(createGraphSelectedAdjacencyEvidenceSource(graph)),
    graphTyped: unwrap(createInMemoryGraphEvidenceSource(graph)),
  };
}

function taskWhere(
  category: M3aTask["category"],
  split: M3aTask["split"] = "development",
): M3aTask {
  const task = M3A1_PREREGISTERED_CORPUS.find(
    (item) => item.category === category && item.split === split,
  );
  if (task === undefined) throw new Error(`Missing ${split} ${category} task.`);
  return task;
}

async function selected(
  source: EvidenceSource,
  task: M3aTask,
): Promise<EvidenceNeighborhood> {
  return unwrap(await selectEvidence(source, task.query));
}

describe("M3a.1 factorial evidence benchmark", () => {
  it("passes a counts-only blind leakage and corpus-integrity audit", () => {
    const counts = blindM3a1IntegrityAudit(
      M3A1_REFERENCE_GRAPH,
      M3A1_PREREGISTERED_CORPUS,
    );

    expect(counts).toMatchObject({
      tasks: 170,
      developmentCases: 30,
      heldoutCases: 140,
      heldoutStructuralCases: 100,
      heldoutNegativeControls: 40,
      duplicateTaskIds: 0,
      queryInstructionMismatches: 0,
      answerBearingQueryLeaks: 0,
      invalidGroundTruthReferences: 0,
      passed: true,
    });
    expect(counts.categoryCounts).toHaveLength(12);
    expect(M3A1_CORPUS_PROTOCOL.liveInferenceAuthorized).toBe(false);
    expect(M3A1_CORPUS_PROTOCOL.typeGraphIntegrated).toBe(false);
  });

  it("passes all four offline factorial arms under equal query bounds", async () => {
    const report = unwrap(
      await auditM3aOfflineDesign({
        graph: M3A1_REFERENCE_GRAPH,
        tasks: M3A1_PREREGISTERED_CORPUS,
        sources: sources(),
      }),
    );

    expect(report).toMatchObject({
      protocol: "m3a1-offline-audit/2",
      tasks: 170,
      selections: 680,
      deterministicSelections: 1_360,
      boundedContexts: 680,
      retrievalAdvantageTasks: 75,
      retrievalParityTasks: 95,
      relationshipEncodingTasks: 125,
      negativeControlParity: 45,
      passed: true,
    });
    expect(report.arms).toHaveLength(4);
    expect(report.arms.find((arm) => arm.arm === "graph-typed")).toMatchObject({
      edgeRecall: 1,
      edgeCitationRecall: 1,
      pathRecall: 1,
    });
  }, 30_000);

  it("isolates graph selection, adjacency, and typed relationship encoding", async () => {
    const task = taskWhere("multi-hop");
    const allSources = sources();
    const lexical = await selected(allSources.lexicalFacts, task);
    const graphFacts = await selected(allSources.graphFacts, task);
    const adjacency = await selected(allSources.graphAdjacency, task);
    const typed = await selected(allSources.graphTyped, task);
    const ids = (neighborhood: EvidenceNeighborhood) =>
      neighborhood.context.facts.map((fact) => fact.id);

    expect(ids(graphFacts)).toEqual(ids(adjacency));
    expect(ids(graphFacts)).toEqual(ids(typed));
    expect(ids(graphFacts)).not.toEqual(ids(lexical));
    expect(
      [lexical, graphFacts, adjacency, typed].every(
        (neighborhood) => neighborhood.usage.truncated,
      ),
    ).toBe(true);
    expect(graphFacts.context.edges).toEqual([]);
    expect(adjacency.context.edges).toHaveLength(1);
    expect(
      adjacency.context.edges.every((edge) => edge.relationship === null),
    ).toBe(true);
    const factCitationIds = new Set(
      graphFacts.context.citations.map((citation) => citation.id),
    );
    const adjacencyOnlyCitations = adjacency.context.citations.filter(
      (citation) => !factCitationIds.has(citation.id),
    );
    expect(
      JSON.stringify({
        edges: adjacency.context.edges,
        citations: adjacencyOnlyCitations,
      }),
    ).not.toMatch(
      /contradicts|corroborates|derived-from|retracts|supersedes|precedes/,
    );
    expect(adjacency.context.paths).toEqual([]);
    expect(typed.context.edges).toContainEqual(
      expect.objectContaining({
        id: task.expectedEdgeIds[0],
        relationship: "related",
        provenanceCitationIds: task.expectedEdgeCitationIds,
      }),
    );
    expect(typed.context.paths).toContainEqual(task.expectedPaths[0]);
  });

  it("enforces citation, edge, path, byte, and token bounds during dense traversal", async () => {
    const graph = denseGraph(12);
    const source = unwrap(createInMemoryGraphEvidenceSource(graph));
    const query: EvidenceQuery = {
      id: "dense-query",
      text: "common",
      validAt: null,
      recordedAt: null,
      maxFacts: 12,
      maxCitations: 20,
      maxEdges: 5,
      maxPaths: 3,
      maxHops: 8,
      maxSerializedBytes: 12_000,
      maxSerializedTokenUpperBound: 12_000,
    };
    const neighborhood = unwrap(await selectEvidence(source, query));

    expect(neighborhood.usage).toMatchObject({
      factCount: 12,
      edgeCount: 5,
      pathCount: 3,
      truncated: true,
    });
    expect(neighborhood.usage.citationCount).toBeLessThanOrEqual(20);
    expect(neighborhood.usage.serializedBytes).toBeLessThanOrEqual(12_000);
    expect(neighborhood.usage.serializedTokenUpperBound).toBeLessThanOrEqual(
      12_000,
    );
  });

  it("represents belief before and after a recorded retraction", () => {
    const task = taskWhere("retraction");
    const oldFactId = task.expectedFactIds[0];
    const newFactId = task.expectedFactIds[2];
    const oldFact = M3A1_REFERENCE_GRAPH.facts.find(
      (fact) => fact.id === oldFactId,
    );
    const newFact = M3A1_REFERENCE_GRAPH.facts.find(
      (fact) => fact.id === newFactId,
    );
    if (oldFact === undefined || newFact === undefined)
      throw new Error("Missing retraction facts.");

    const before = {
      validAt: "2026-03-01T00:00:00.000Z",
      recordedAt: "2026-03-01T00:00:00.000Z",
    };
    const after = {
      validAt: "2026-07-01T00:00:00.000Z",
      recordedAt: "2026-07-01T00:00:00.000Z",
    };
    expect(isEvidenceFactBelievedAt(oldFact, before)).toBe(true);
    expect(isEvidenceFactBelievedAt(oldFact, after)).toBe(false);
    expect(isEvidenceFactBelievedAt(newFact, before)).toBe(false);
    expect(isEvidenceFactBelievedAt(newFact, after)).toBe(true);
  });

  it("requires independently cited relationship provenance", () => {
    const edge = M3A1_REFERENCE_GRAPH.edges[0];
    if (edge === undefined) throw new Error("Missing first edge.");
    const missingProvenance = {
      ...M3A1_REFERENCE_GRAPH,
      edges: [{ ...edge, provenanceCitationIds: ["missing"] }],
    };

    expect(createInMemoryGraphEvidenceSource(missingProvenance)).toMatchObject({
      ok: false,
      error: { code: "INVALID_SOURCE_DATA" },
    });
  });

  it("detects query leakage without exposing held-out content", () => {
    const task = taskWhere("negative-control", "heldout");
    const leaked: M3aTask = {
      ...task,
      instruction: `${task.instruction} ${task.protectedAnswerTerms[0]}`,
      query: {
        ...task.query,
        text: `${task.instruction} ${task.protectedAnswerTerms[0]}`,
      },
    };
    const counts = blindM3a1IntegrityAudit(M3A1_REFERENCE_GRAPH, [leaked]);

    expect(counts.answerBearingQueryLeaks).toBe(1);
    expect(counts.passed).toBe(false);
    expect(Object.keys(counts)).not.toContain("taskIds");
  });

  it("keeps development and held-out identities disjoint", () => {
    const development = new Set(
      M3A1_PREREGISTERED_CORPUS.filter(
        (task) => task.split === "development",
      ).map((task) => task.id),
    );
    const heldout = M3A1_PREREGISTERED_CORPUS.filter(
      (task) => task.split === "heldout",
    );

    expect(heldout).toHaveLength(140);
    expect(heldout.some((task) => development.has(task.id))).toBe(false);
  });

  it("rejects a factorial arm with the wrong selection identity", async () => {
    const validSources = sources();
    const result = await auditM3aOfflineDesign({
      graph: M3A1_REFERENCE_GRAPH,
      tasks: M3A1_PREREGISTERED_CORPUS,
      sources: {
        ...validSources,
        graphFacts: validSources.lexicalFacts,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: [{ code: "SOURCE_FAILURE", taskId: null }],
    });
  });

  it("freezes prospective sample size, margins, and sensitivity before M3b", () => {
    expect(M3A1_FACTORIAL_ARMS.map((arm) => arm.id)).toEqual([
      "lexical-facts",
      "graph-facts",
      "graph-adjacency",
      "graph-typed",
    ]);
    expect(M3A1_PROSPECTIVE_ANALYSIS).toMatchObject({
      status: "offline-design-only",
      repetitionsArePooled: false,
      heldoutStructuralCasesPerProvider: 100,
      heldoutNegativeControlsPerProvider: 40,
      pairedSemanticNonInferiorityMargin: -0.1,
      minimumDiscordantPairsForSuperiority: 20,
      sensitivity: {
        structuralFourAdverseLowerBound: -0.09837071435887923,
        structuralFiveAdverseLowerBound: -0.11175046923191914,
      },
    });
  });

  it("preserves deterministic identity across graph storage ordering", async () => {
    const reversed: EvidenceGraph = {
      ...M3A1_REFERENCE_GRAPH,
      facts: M3A1_REFERENCE_GRAPH.facts.toReversed(),
      citations: M3A1_REFERENCE_GRAPH.citations.toReversed(),
      edges: M3A1_REFERENCE_GRAPH.edges.toReversed(),
    };
    const task = taskWhere("temporal");
    const original = await selected(
      unwrap(createInMemoryGraphEvidenceSource(M3A1_REFERENCE_GRAPH)),
      task,
    );
    const reordered = await selected(
      unwrap(createInMemoryGraphEvidenceSource(reversed)),
      task,
    );

    expect(unwrap(await digestValue(original))).toBe(
      unwrap(await digestValue(reordered)),
    );
  });

  it("creates a plan-independent canonical selection reference", async () => {
    const task = taskWhere("multi-hop");
    const neighborhood = await selected(sources().graphTyped, task);
    const first = unwrap(await referenceEvidenceSelection(neighborhood));
    const second = unwrap(await referenceEvidenceSelection(neighborhood));

    expect(first).toEqual(second);
    expect(first.neighborhoodDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects invalid temporal, path, task, and source reconciliation", async () => {
    const fact = M3A1_REFERENCE_GRAPH.facts[0];
    const task = M3A1_PREREGISTERED_CORPUS[0];
    if (fact === undefined || task === undefined)
      throw new Error("Missing M3a.1 fixtures.");
    expect(
      evidenceFactSchema.safeParse({
        ...fact,
        recordedFrom: "2026-07-02T00:00:00.000Z",
        recordedUntil: "2026-07-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      evidencePathSchema.safeParse({ factIds: ["a", "b"], edgeIds: [] })
        .success,
    ).toBe(false);
    expect(
      m3aTaskSchema.safeParse({
        ...task,
        query: { ...task.query, text: "different" },
      }).success,
    ).toBe(false);

    const valid = await selected(sources().graphTyped, task);
    const dishonest: EvidenceSource = {
      identity: valid.source,
      select: () =>
        Promise.resolve({
          ok: true,
          value: {
            ...valid,
            usage: { ...valid.usage, serializedBytes: 1 },
          },
        }),
    };
    expect(await selectEvidence(dishonest, task.query)).toMatchObject({
      ok: false,
      error: { code: "INVALID_NEIGHBORHOOD" },
    });
  });
});

function denseGraph(size: number): EvidenceGraph {
  const recordedFrom = "2026-01-01T00:00:00.000Z";
  const facts = Array.from({ length: size }, (_, index) => ({
    id: `fact-dense-${index}`,
    statement: `Common dense fact ${index}.`,
    subject: "common",
    predicate: "dense",
    object: `${index}`,
    validFrom: null,
    validUntil: null,
    recordedFrom,
    recordedUntil: null,
    citationIds: [`cite-dense-${index}`],
  }));
  const factCitations = Array.from({ length: size }, (_, index) => ({
    id: `cite-dense-${index}`,
    source: "dense-fixture",
    locator: `${index}`,
    observedAt: recordedFrom,
  }));
  const edges = facts.flatMap((from, fromIndex) =>
    facts.slice(fromIndex + 1).map((to): EvidenceEdge => ({
      id: `edge-${from.id}-${to.id}`,
      fromFactId: from.id,
      toFactId: to.id,
      relationship: "related",
      provenanceCitationIds: [`cite-edge-${from.id}-${to.id}`],
      validFrom: null,
      validUntil: null,
      recordedFrom,
      recordedUntil: null,
    })),
  );
  const edgeCitations = edges.map((edge) => ({
    id: edge.provenanceCitationIds[0] ?? "missing",
    source: "dense-edge-fixture",
    locator: edge.id,
    observedAt: recordedFrom,
  }));
  return {
    id: "dense-graph",
    version: "1",
    facts,
    citations: [...factCitations, ...edgeCitations],
    edges,
  };
}
