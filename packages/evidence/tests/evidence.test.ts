import { digestValue, type Result } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import {
  auditM3aOfflineDesign,
  createInMemoryGraphEvidenceSource,
  createMatchedTextEvidenceSource,
  evidenceFactSchema,
  type EvidenceGraph,
  type EvidenceNeighborhood,
  evidencePathSchema,
  type EvidenceSource,
  M3A_DETERMINISTIC_CORPUS,
  M3A_REFERENCE_GRAPH,
  m3aTaskSchema,
  referenceEvidenceSelection,
  selectEvidence,
} from "../src/index.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

async function select(
  source: EvidenceSource,
  taskId: string,
): Promise<EvidenceNeighborhood> {
  const task = M3A_DETERMINISTIC_CORPUS.find((item) => item.id === taskId);
  if (task === undefined) throw new Error(`Missing task ${taskId}.`);
  return unwrap(await selectEvidence(source, task.query));
}

describe("M3a substrate-neutral evidence selection", () => {
  it("passes the frozen deterministic corpus audit for both substrate arms", async () => {
    const graphSource = unwrap(
      createInMemoryGraphEvidenceSource(M3A_REFERENCE_GRAPH),
    );
    const textSource = unwrap(
      createMatchedTextEvidenceSource(M3A_REFERENCE_GRAPH),
    );
    const report = unwrap(
      await auditM3aOfflineDesign({
        graph: M3A_REFERENCE_GRAPH,
        tasks: M3A_DETERMINISTIC_CORPUS,
        textSource,
        graphSource,
      }),
    );

    expect(report).toMatchObject({
      protocol: "m3a-offline-audit/1",
      tasks: 7,
      structuralTasks: 5,
      negativeControls: 2,
      deterministicSelections: 14,
      graphPathAdvantageTasks: 5,
      negativeControlParity: 2,
      passed: true,
    });
    expect(report.graph).toMatchObject({
      factRecall: 1,
      citationRecall: 1,
      pathRecall: 1,
    });
    expect(report.text.pathRecall).toBe(0);
  });

  it("returns the same expected schema while keeping graph paths substrate-specific", async () => {
    const graphSource = unwrap(
      createInMemoryGraphEvidenceSource(M3A_REFERENCE_GRAPH),
    );
    const textSource = unwrap(
      createMatchedTextEvidenceSource(M3A_REFERENCE_GRAPH),
    );
    const graph = await select(graphSource, "m3a-retraction-policy");
    const text = await select(textSource, "m3a-retraction-policy");

    expect(graph.facts.map((fact) => fact.id)).toEqual([
      "fact-ret-new",
      "fact-ret-notice",
      "fact-ret-old",
    ]);
    expect(graph.paths).toContainEqual({
      factIds: ["fact-ret-notice", "fact-ret-old", "fact-ret-new"],
      edgeIds: ["edge-ret-retracts", "edge-ret-supersedes"],
    });
    expect(text.paths).toEqual([]);
    expect(graph.queryId).toBe(text.queryId);
  });

  it("canonicalizes selection identity without merging evidence into plan identity", async () => {
    const source = unwrap(
      createInMemoryGraphEvidenceSource(M3A_REFERENCE_GRAPH),
    );
    const neighborhood = await select(source, "m3a-multi-hop-headquarters");
    const first = unwrap(await referenceEvidenceSelection(neighborhood));
    const second = unwrap(await referenceEvidenceSelection(neighborhood));

    expect(first).toEqual(second);
    expect(first.neighborhoodDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(first).toSorted()).toEqual([
      "neighborhoodDigest",
      "queryId",
      "source",
    ]);
  });

  it("is invariant to frozen graph storage ordering", async () => {
    const reversed: EvidenceGraph = {
      ...M3A_REFERENCE_GRAPH,
      facts: M3A_REFERENCE_GRAPH.facts.toReversed(),
      citations: M3A_REFERENCE_GRAPH.citations.toReversed(),
      edges: M3A_REFERENCE_GRAPH.edges.toReversed(),
    };
    const originalSource = unwrap(
      createInMemoryGraphEvidenceSource(M3A_REFERENCE_GRAPH),
    );
    const reversedSource = unwrap(createInMemoryGraphEvidenceSource(reversed));
    const original = await select(originalSource, "m3a-temporal-release");
    const reordered = await select(reversedSource, "m3a-temporal-release");

    expect(unwrap(await digestValue(original))).toBe(
      unwrap(await digestValue(reordered)),
    );
  });

  it("rejects malformed graphs before selection", () => {
    const missingCitation = {
      ...M3A_REFERENCE_GRAPH,
      citations: M3A_REFERENCE_GRAPH.citations.filter(
        (citation) => citation.id !== "cite-rel-1",
      ),
    };
    const missingFact = {
      ...M3A_REFERENCE_GRAPH,
      facts: M3A_REFERENCE_GRAPH.facts.filter(
        (fact) => fact.id !== "fact-rel-headquarters",
      ),
    };

    expect(createInMemoryGraphEvidenceSource(missingCitation)).toMatchObject({
      ok: false,
      error: { code: "INVALID_SOURCE_DATA" },
    });
    expect(createInMemoryGraphEvidenceSource(missingFact)).toMatchObject({
      ok: false,
      error: { code: "INVALID_SOURCE_DATA" },
    });

    const duplicateFact = {
      ...M3A_REFERENCE_GRAPH,
      facts: [M3A_REFERENCE_GRAPH.facts[0], ...M3A_REFERENCE_GRAPH.facts],
    };
    expect(createInMemoryGraphEvidenceSource(duplicateFact)).toMatchObject({
      ok: false,
      error: { code: "INVALID_SOURCE_DATA" },
    });
  });

  it("rejects invalid temporal, path, and task ground-truth shapes", () => {
    const fact = M3A_REFERENCE_GRAPH.facts[0];
    const task = M3A_DETERMINISTIC_CORPUS[0];
    if (fact === undefined || task === undefined)
      throw new Error("Missing M3a fixture values.");

    expect(
      evidenceFactSchema.safeParse({
        ...fact,
        validFrom: "2026-07-02T00:00:00.000Z",
        validUntil: "2026-07-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      evidencePathSchema.safeParse({
        factIds: ["fact-a", "fact-b"],
        edgeIds: [],
      }).success,
    ).toBe(false);
    expect(
      m3aTaskSchema.safeParse({
        ...task,
        category: "negative-control",
        graphAdvantageExpected: true,
      }).success,
    ).toBe(false);
    expect(
      m3aTaskSchema.safeParse({
        ...task,
        expectedPaths: [],
      }).success,
    ).toBe(false);
  });

  it("fails the offline audit on duplicate or dangling task ground truth", async () => {
    const graphSource = unwrap(
      createInMemoryGraphEvidenceSource(M3A_REFERENCE_GRAPH),
    );
    const textSource = unwrap(
      createMatchedTextEvidenceSource(M3A_REFERENCE_GRAPH),
    );
    const task = M3A_DETERMINISTIC_CORPUS[0];
    if (task === undefined) throw new Error("Missing first M3a task.");
    const result = await auditM3aOfflineDesign({
      graph: M3A_REFERENCE_GRAPH,
      tasks: [
        task,
        task,
        { ...task, id: "m3a-dangling", expectedFactIds: ["missing"] },
      ],
      textSource,
      graphSource,
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("Expected the invalid audit to fail.");
    expect(result.error.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_TASK",
        "INVALID_GROUND_TRUTH",
        "MISSING_CATEGORY",
      ]),
    );
  });

  it("rejects invalid queries and invalid source neighborhoods", async () => {
    const source = unwrap(
      createInMemoryGraphEvidenceSource(M3A_REFERENCE_GRAPH),
    );
    expect(await selectEvidence(source, { id: "bad" })).toMatchObject({
      ok: false,
      error: { code: "INVALID_QUERY" },
    });

    const invalidSource: EvidenceSource = {
      identity: source.identity,
      select: (query) =>
        Promise.resolve({
          ok: true,
          value: {
            queryId: `${query.id}-wrong`,
            source: source.identity,
            facts: [],
            citations: [],
            edges: [],
            paths: [],
          },
        }),
    };
    const task = M3A_DETERMINISTIC_CORPUS[0];
    if (task === undefined) throw new Error("Missing first M3a task.");
    expect(await selectEvidence(invalidSource, task.query)).toMatchObject({
      ok: false,
      error: { code: "INVALID_NEIGHBORHOOD" },
    });

    const validNeighborhood = unwrap(await selectEvidence(source, task.query));
    const spoofedSource: EvidenceSource = {
      identity: source.identity,
      select: () =>
        Promise.resolve({
          ok: true,
          value: {
            ...validNeighborhood,
            source: { ...source.identity, implementation: "spoofed/1" },
          },
        }),
    };
    expect(await selectEvidence(spoofedSource, task.query)).toMatchObject({
      ok: false,
      error: { code: "INVALID_NEIGHBORHOOD" },
    });

    const firstFact = validNeighborhood.facts[0];
    if (firstFact === undefined) throw new Error("Missing selected fact.");
    const danglingCitationSource: EvidenceSource = {
      identity: source.identity,
      select: () =>
        Promise.resolve({
          ok: true,
          value: {
            ...validNeighborhood,
            facts: [
              { ...firstFact, citationIds: ["missing-citation"] },
              ...validNeighborhood.facts.slice(1),
            ],
          },
        }),
    };
    expect(
      await selectEvidence(danglingCitationSource, task.query),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_NEIGHBORHOOD" },
    });
  });
});
