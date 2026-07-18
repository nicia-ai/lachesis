import { z } from "zod";

import { auditM3aOfflineDesign, type M3a1Sources } from "./audit.js";
import {
  type EvidenceCitation,
  type EvidenceFact,
  referenceEvidenceSelection,
} from "./contract.js";
import {
  M3A1_PREREGISTERED_CORPUS,
  M3A1_REFERENCE_GRAPH,
  m3a1CategorySchema,
  type M3aTask,
  m3aTaskSchema,
} from "./corpus.js";
import {
  createGraphSelectedAdjacencyEvidenceSource,
  createGraphSelectedFactsEvidenceSource,
  createInMemoryGraphEvidenceSource,
  evidenceGraphSchema,
} from "./graph.js";
import {
  M3B4_CALIBRATION_GRAPH_ADDITIONS,
  M3B4_CALIBRATION_TASKS,
} from "./m3b4-calibration-corpus.js";
import { createM3b5HeldoutCorpus } from "./m3b5-heldout-corpus.js";
import { createMatchedTextEvidenceSource } from "./text.js";

const RECORDED_FROM = "2025-01-01T00:00:00.000Z";
const CURRENT_AT = "2026-07-01T00:00:00.000Z";

function extraNegativeControl(index: number): Readonly<{
  task: z.input<typeof m3aTaskSchema>;
  fact: EvidenceFact;
  citation: EvidenceCitation;
}> {
  const ordinal = index.toString().padStart(3, "0");
  const project = `projectholdnegativecontrol${ordinal}`;
  const owner = `owneranswerholdnegativecontrol${ordinal}`;
  const factId = `fact-hold-negative-control-${ordinal}-a-owner`;
  const citationId = `cite-hold-negative-control-${ordinal}-owner`;
  const instruction = `Who owns ${project}?`;
  return {
    task: {
      id: `m3a1-hold-negative-control-${ordinal}`,
      split: "heldout",
      category: "negative-control",
      instruction,
      query: {
        id: `query-hold-negative-control-${ordinal}`,
        text: instruction,
        validAt: CURRENT_AT,
        recordedAt: CURRENT_AT,
        maxFacts: 1,
        maxCitations: 8,
        maxEdges: 4,
        maxPaths: 4,
        maxHops: 2,
        maxSerializedBytes: 12_000,
        maxSerializedTokenUpperBound: 12_000,
      },
      answerContract: {
        role: "owner",
        cardinality: 1,
        ordering: "scalar",
        anchorSubject: project,
        derivation: "single-terminal-fact",
        requiredFactPredicates: ["owner"],
        answerSource: "terminal-object",
        minimumSupportingFacts: 1,
        sufficiencyRule:
          "answer-only-when-a-complete-visible-derivation-exists-otherwise-abstain",
      },
      expectedAnswerValues: [owner],
      protectedAnswerTerms: [owner],
      expectedFactIds: [factId],
      expectedCitationIds: [citationId],
      expectedEdgeIds: [],
      expectedEdgeCitationIds: [],
      expectedPaths: [],
      retrievalAdvantageExpected: false,
      relationshipEncodingExpected: false,
    },
    fact: {
      id: factId,
      statement: `${owner} owns ${project}.`,
      subject: project,
      predicate: "owner",
      object: owner,
      validFrom: null,
      validUntil: null,
      recordedFrom: RECORDED_FROM,
      recordedUntil: null,
      citationIds: [citationId],
    },
    citation: {
      id: citationId,
      source: "project-register",
      locator: citationId,
      observedAt: RECORDED_FROM,
    },
  };
}

const addedNegativeControls = Array.from({ length: 20 }, (_, offset) =>
  extraNegativeControl(offset + 40),
);

const inspectedReferenceGraph = evidenceGraphSchema.parse({
  ...M3A1_REFERENCE_GRAPH,
  id: "m3b4-inspected-reference-evidence",
  version: "1",
  citations: [
    ...M3A1_REFERENCE_GRAPH.citations,
    ...addedNegativeControls.map((item) => item.citation),
    ...M3B4_CALIBRATION_GRAPH_ADDITIONS.citations,
  ],
  facts: [
    ...M3A1_REFERENCE_GRAPH.facts,
    ...addedNegativeControls.map((item) => item.fact),
    ...M3B4_CALIBRATION_GRAPH_ADDITIONS.facts,
  ],
  edges: [
    ...M3A1_REFERENCE_GRAPH.edges,
    ...M3B4_CALIBRATION_GRAPH_ADDITIONS.edges,
  ],
});

const inspectedCorpus: ReadonlyArray<M3aTask> = z
  .array(m3aTaskSchema)
  .readonly()
  .parse([
    ...M3A1_PREREGISTERED_CORPUS,
    ...addedNegativeControls.map((item) => item.task),
  ]);

const m3b5Heldout = createM3b5HeldoutCorpus({
  graph: inspectedReferenceGraph,
  tasks: inspectedCorpus.filter((task) => task.split === "heldout"),
});

export const M3B_REFERENCE_GRAPH = evidenceGraphSchema.parse({
  ...inspectedReferenceGraph,
  id: "m3b5-reference-evidence",
  version: "1",
  citations: [
    ...inspectedReferenceGraph.citations.filter(
      (citation) => !m3b5Heldout.replacedCitationIds.has(citation.id),
    ),
    ...m3b5Heldout.citations,
  ],
  facts: [
    ...inspectedReferenceGraph.facts.filter(
      (fact) => !m3b5Heldout.replacedFactIds.has(fact.id),
    ),
    ...m3b5Heldout.facts,
  ],
  edges: [
    ...inspectedReferenceGraph.edges.filter(
      (edge) => !m3b5Heldout.replacedEdgeIds.has(edge.id),
    ),
    ...m3b5Heldout.edges,
  ],
});

export const M3B_PREREGISTERED_CORPUS: ReadonlyArray<M3aTask> = z
  .array(m3aTaskSchema)
  .length(190)
  .readonly()
  .parse([
    ...inspectedCorpus.filter((task) => task.split === "development"),
    ...m3b5Heldout.tasks,
  ]);

export const M3B_CORPUS_PROTOCOL = Object.freeze({
  id: "lachesis-m3b5-strict-disjoint-heldout-corpus",
  version: "1",
  developmentCases: 30,
  heldoutCases: 160,
  heldoutRetrievalContrastCases: 60,
  heldoutRelationshipContrastCases: 100,
  heldoutNegativeControls: 60,
  developmentInitialCalls: 240,
  heldoutInitialCalls: 2_560,
  semanticRepairCallsPerRecord: 1,
  wireRepairCallsPerRecord: 1,
  wireStressProbeCases: 6,
  wireStressProbeRepetitions: 4,
  wireStressProbeInitialCalls: 96,
  liveInferenceAuthorized: false,
  typeGraphIntegrated: false,
});

export function loadM3bPhaseCases(
  phase:
    | "m3b-protocol-probe"
    | "m3b-wire-stress-probe"
    | "m3b-calibration"
    | "m3b-heldout",
): ReadonlyArray<M3aTask> {
  if (phase === "m3b-protocol-probe") {
    return M3B_PREREGISTERED_CORPUS.filter(
      (task) => task.split === "development",
    ).filter(
      (task, index, tasks) =>
        tasks.findIndex((candidate) => candidate.category === task.category) ===
        index,
    );
  }
  if (phase === "m3b-wire-stress-probe")
    return (["provenance", "temporal"] as const).flatMap((category) =>
      M3B_PREREGISTERED_CORPUS.filter(
        (task) => task.split === "development" && task.category === category,
      ).slice(0, 3),
    );
  if (phase === "m3b-calibration") return M3B4_CALIBRATION_TASKS;
  return M3B_PREREGISTERED_CORPUS.filter((task) => task.split === "heldout");
}

function valuesFor(
  tasks: ReadonlyArray<M3aTask>,
  select: (task: M3aTask) => ReadonlyArray<string>,
): ReadonlySet<string> {
  return new Set(tasks.flatMap(select).map((value) => value.toLowerCase()));
}

function overlapCount(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  return [...left].filter((value) => right.has(value)).length;
}

function instructionTemplate(task: M3aTask): string {
  return task.instruction
    .toLowerCase()
    .replaceAll(task.answerContract.anchorSubject.toLowerCase(), "{anchor}");
}

function fixturePrefix(task: M3aTask): string {
  return task.id.replace(/^m3a1-/, "");
}

function fixtureFactsFrom(
  graph: z.infer<typeof evidenceGraphSchema>,
  task: M3aTask,
): typeof M3B_REFERENCE_GRAPH.facts {
  const prefix = fixturePrefix(task);
  return graph.facts.filter((fact) => fact.id.includes(prefix));
}

function fixtureFacts(task: M3aTask): typeof M3B_REFERENCE_GRAPH.facts {
  return fixtureFactsFrom(M3B_REFERENCE_GRAPH, task);
}

function fixtureStructureFrom(
  graph: z.infer<typeof evidenceGraphSchema>,
  task: M3aTask,
): string {
  const prefix = fixturePrefix(task);
  const facts = fixtureFactsFrom(graph, task);
  const edges = graph.edges.filter((edge) => edge.id.includes(prefix));
  const citations = graph.citations.filter((citation) =>
    citation.id.includes(prefix),
  );
  const predicates = facts
    .map((fact) => fact.predicate)
    .toSorted()
    .join(",");
  const relationships = edges
    .map((edge) => edge.relationship ?? "untyped")
    .toSorted()
    .join(",");
  return [
    task.category,
    facts.length,
    citations.length,
    edges.length,
    predicates,
    relationships,
    task.query.maxFacts,
    task.query.maxEdges,
    task.query.maxPaths,
    task.query.maxHops,
  ].join("|");
}

function fixtureStructure(task: M3aTask): string {
  return fixtureStructureFrom(M3B_REFERENCE_GRAPH, task);
}

export type M3b4CalibrationCorpusAudit = Readonly<{
  cases: number;
  categoryCounts: ReadonlyArray<
    Readonly<{ category: M3aTask["category"]; count: number }>
  >;
  reusedFixtureIds: number;
  reusedEntities: number;
  reusedInstructionWording: number;
  reusedFactWording: number;
  reusedAnswers: number;
  reusedFixtureStructures: number;
  passed: boolean;
}>;

export function auditM3b4CalibrationCorpusDisjointness(): M3b4CalibrationCorpusAudit {
  const legacy = M3B_PREREGISTERED_CORPUS.filter(
    (task) => task.split === "development",
  );
  const fresh = M3B4_CALIBRATION_TASKS;
  const categoryCounts = m3a1CategorySchema.options.map((category) => ({
    category,
    count: fresh.filter((task) => task.category === category).length,
  }));
  const reusedFixtureIds = overlapCount(
    valuesFor(legacy, (task) => [task.id]),
    valuesFor(fresh, (task) => [task.id]),
  );
  const reusedEntities = overlapCount(
    valuesFor(legacy, (task) =>
      fixtureFacts(task).flatMap((fact) => [fact.subject, fact.object]),
    ),
    valuesFor(fresh, (task) =>
      fixtureFacts(task).flatMap((fact) => [fact.subject, fact.object]),
    ),
  );
  const reusedInstructionWording = overlapCount(
    valuesFor(legacy, (task) => [instructionTemplate(task)]),
    valuesFor(fresh, (task) => [instructionTemplate(task)]),
  );
  const reusedFactWording = overlapCount(
    valuesFor(legacy, (task) =>
      fixtureFacts(task).map((fact) => fact.statement),
    ),
    valuesFor(fresh, (task) =>
      fixtureFacts(task).map((fact) => fact.statement),
    ),
  );
  const reusedAnswers = overlapCount(
    valuesFor(legacy, (task) => task.expectedAnswerValues),
    valuesFor(fresh, (task) => task.expectedAnswerValues),
  );
  const reusedFixtureStructures = overlapCount(
    valuesFor(legacy, (task) => [fixtureStructure(task)]),
    valuesFor(fresh, (task) => [fixtureStructure(task)]),
  );
  return {
    cases: fresh.length,
    categoryCounts,
    reusedFixtureIds,
    reusedEntities,
    reusedInstructionWording,
    reusedFactWording,
    reusedAnswers,
    reusedFixtureStructures,
    passed:
      fresh.length === 30 &&
      categoryCounts.every((item) => item.count === 5) &&
      reusedFixtureIds === 0 &&
      reusedEntities === 0 &&
      reusedInstructionWording === 0 &&
      reusedFactWording === 0 &&
      reusedAnswers === 0 &&
      reusedFixtureStructures === 0,
  };
}

export type M3b5HeldoutCorpusAudit = Readonly<{
  cases: number;
  categoryCounts: ReadonlyArray<
    Readonly<{ category: M3aTask["category"]; count: number }>
  >;
  reusedFixtureIds: number;
  reusedEntities: number;
  reusedExactInstructions: number;
  reusedInstructionWording: number;
  reusedFactWording: number;
  reusedAnswers: number;
  reusedFixtureStructures: number;
  reusedNeighborhoodDigests: number;
  factorialDesignPassed: boolean;
  passed: boolean;
}>;

function offlineSources(
  graph: z.infer<typeof evidenceGraphSchema>,
): M3a1Sources {
  const lexicalFacts = createMatchedTextEvidenceSource(graph);
  const graphFacts = createGraphSelectedFactsEvidenceSource(graph);
  const graphAdjacency = createGraphSelectedAdjacencyEvidenceSource(graph);
  const graphTyped = createInMemoryGraphEvidenceSource(graph);
  if (
    !lexicalFacts.ok ||
    !graphFacts.ok ||
    !graphAdjacency.ok ||
    !graphTyped.ok
  )
    throw new Error("M3b.5 offline evidence source construction failed.");
  return {
    lexicalFacts: lexicalFacts.value,
    graphFacts: graphFacts.value,
    graphAdjacency: graphAdjacency.value,
    graphTyped: graphTyped.value,
  };
}

async function neighborhoodDigests(
  graph: z.infer<typeof evidenceGraphSchema>,
  tasks: ReadonlyArray<M3aTask>,
): Promise<ReadonlySet<string>> {
  const built = offlineSources(graph);
  const sources = [
    built.lexicalFacts,
    built.graphFacts,
    built.graphAdjacency,
    built.graphTyped,
  ];
  const references = await Promise.all(
    tasks.flatMap((task) =>
      sources.map(async (source) => {
        const selected = await source.select(task.query);
        if (!selected.ok) throw new Error(selected.error.message);
        const reference = await referenceEvidenceSelection(selected.value);
        if (!reference.ok) throw new Error(reference.error.message);
        return reference.value.neighborhoodDigest;
      }),
    ),
  );
  return new Set(references);
}

export async function auditM3b5HeldoutCorpusDisjointness(): Promise<M3b5HeldoutCorpusAudit> {
  const inspected = [...inspectedCorpus, ...M3B4_CALIBRATION_TASKS];
  const heldout = M3B_PREREGISTERED_CORPUS.filter(
    (task) => task.split === "heldout",
  );
  const categoryCounts = m3a1CategorySchema.options.map((category) => ({
    category,
    count: heldout.filter((task) => task.category === category).length,
  }));
  const reusedFixtureIds = overlapCount(
    valuesFor(inspected, (task) => [task.id]),
    valuesFor(heldout, (task) => [task.id]),
  );
  const reusedEntities = overlapCount(
    valuesFor(inspected, (task) =>
      fixtureFactsFrom(inspectedReferenceGraph, task).flatMap((fact) => [
        fact.subject,
        fact.object,
      ]),
    ),
    valuesFor(heldout, (task) =>
      fixtureFacts(task).flatMap((fact) => [fact.subject, fact.object]),
    ),
  );
  const reusedExactInstructions = overlapCount(
    valuesFor(inspected, (task) => [task.instruction]),
    valuesFor(heldout, (task) => [task.instruction]),
  );
  const reusedInstructionWording = overlapCount(
    valuesFor(inspected, (task) => [instructionTemplate(task)]),
    valuesFor(heldout, (task) => [instructionTemplate(task)]),
  );
  const reusedFactWording = overlapCount(
    valuesFor(inspected, (task) =>
      fixtureFactsFrom(inspectedReferenceGraph, task).map(
        (fact) => fact.statement,
      ),
    ),
    valuesFor(heldout, (task) =>
      fixtureFacts(task).map((fact) => fact.statement),
    ),
  );
  const reusedAnswers = overlapCount(
    valuesFor(inspected, (task) => task.expectedAnswerValues),
    valuesFor(heldout, (task) => task.expectedAnswerValues),
  );
  const reusedFixtureStructures = overlapCount(
    valuesFor(inspected, (task) => [
      fixtureStructureFrom(inspectedReferenceGraph, task),
    ]),
    valuesFor(heldout, (task) => [fixtureStructure(task)]),
  );
  const [inspectedNeighborhoods, heldoutNeighborhoods] = await Promise.all([
    neighborhoodDigests(inspectedReferenceGraph, inspected),
    neighborhoodDigests(M3B_REFERENCE_GRAPH, heldout),
  ]);
  const reusedNeighborhoodDigests = overlapCount(
    inspectedNeighborhoods,
    heldoutNeighborhoods,
  );
  const mirroredDevelopment = heldout.map((task) =>
    m3aTaskSchema.parse({
      ...task,
      id: task.id.replace(/^m3a1-/u, "m3a1-audit-development-"),
      split: "development",
    }),
  );
  const factorialDesign = await auditM3aOfflineDesign({
    graph: M3B_REFERENCE_GRAPH,
    tasks: [...mirroredDevelopment, ...heldout],
    sources: offlineSources(M3B_REFERENCE_GRAPH),
  });
  const factorialDesignPassed = factorialDesign.ok;
  const expectedCounts = new Map<M3aTask["category"], number>([
    ["multi-hop", 20],
    ["temporal", 20],
    ["contradiction", 20],
    ["provenance", 20],
    ["retraction", 20],
    ["negative-control", 60],
  ]);
  return {
    cases: heldout.length,
    categoryCounts,
    reusedFixtureIds,
    reusedEntities,
    reusedExactInstructions,
    reusedInstructionWording,
    reusedFactWording,
    reusedAnswers,
    reusedFixtureStructures,
    reusedNeighborhoodDigests,
    factorialDesignPassed,
    passed:
      heldout.length === 160 &&
      categoryCounts.every(
        (item) => item.count === expectedCounts.get(item.category),
      ) &&
      reusedFixtureIds === 0 &&
      reusedEntities === 0 &&
      reusedExactInstructions === 0 &&
      reusedInstructionWording === 0 &&
      reusedFactWording === 0 &&
      reusedAnswers === 0 &&
      reusedFixtureStructures === 0 &&
      reusedNeighborhoodDigests === 0 &&
      factorialDesignPassed,
  };
}
