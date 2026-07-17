import { z } from "zod";

import type { EvidenceCitation, EvidenceFact } from "./contract.js";
import {
  M3A1_PREREGISTERED_CORPUS,
  M3A1_REFERENCE_GRAPH,
  m3a1CategorySchema,
  type M3aTask,
  m3aTaskSchema,
} from "./corpus.js";
import { evidenceGraphSchema } from "./graph.js";
import {
  M3B4_CALIBRATION_GRAPH_ADDITIONS,
  M3B4_CALIBRATION_TASKS,
} from "./m3b4-calibration-corpus.js";

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

export const M3B_REFERENCE_GRAPH = evidenceGraphSchema.parse({
  ...M3A1_REFERENCE_GRAPH,
  id: "m3b-reference-evidence",
  version: "2",
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

export const M3B_PREREGISTERED_CORPUS: ReadonlyArray<M3aTask> = z
  .array(m3aTaskSchema)
  .readonly()
  .parse([
    ...M3A1_PREREGISTERED_CORPUS,
    ...addedNegativeControls.map((item) => item.task),
  ]);

export const M3B_CORPUS_PROTOCOL = Object.freeze({
  id: "lachesis-m3b-factorial-evidence-live-corpus",
  version: "3",
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

function fixtureFacts(task: M3aTask): typeof M3B_REFERENCE_GRAPH.facts {
  const prefix = fixturePrefix(task);
  return M3B_REFERENCE_GRAPH.facts.filter((fact) => fact.id.includes(prefix));
}

function fixtureStructure(task: M3aTask): string {
  const prefix = fixturePrefix(task);
  const facts = fixtureFacts(task);
  const edges = M3B_REFERENCE_GRAPH.edges.filter((edge) =>
    edge.id.includes(prefix),
  );
  const citations = M3B_REFERENCE_GRAPH.citations.filter((citation) =>
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
