import { z } from "zod";

import type { EvidenceCitation, EvidenceFact } from "./contract.js";
import {
  M3A1_PREREGISTERED_CORPUS,
  M3A1_REFERENCE_GRAPH,
  type M3aTask,
  m3aTaskSchema,
} from "./corpus.js";
import { evidenceGraphSchema } from "./graph.js";

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
      expectedAnswer: owner,
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
  version: "1",
  facts: [
    ...M3A1_REFERENCE_GRAPH.facts,
    ...addedNegativeControls.map((item) => item.fact),
  ],
  citations: [
    ...M3A1_REFERENCE_GRAPH.citations,
    ...addedNegativeControls.map((item) => item.citation),
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
  version: "1",
  developmentCases: 30,
  heldoutCases: 160,
  heldoutRetrievalContrastCases: 60,
  heldoutRelationshipContrastCases: 100,
  heldoutNegativeControls: 60,
  developmentInitialCalls: 240,
  heldoutInitialCalls: 2_560,
  semanticRepairCalls: 0,
  liveInferenceAuthorized: false,
  typeGraphIntegrated: false,
});

export function loadM3bPhaseCases(
  phase: "m3b-protocol-probe" | "m3b-calibration" | "m3b-heldout",
): ReadonlyArray<M3aTask> {
  if (phase === "m3b-protocol-probe") {
    const structural = M3B_PREREGISTERED_CORPUS.find(
      (task) => task.split === "development" && task.category === "multi-hop",
    );
    const negative = M3B_PREREGISTERED_CORPUS.find(
      (task) =>
        task.split === "development" && task.category === "negative-control",
    );
    return structural === undefined || negative === undefined
      ? []
      : [structural, negative];
  }
  const split = phase === "m3b-calibration" ? "development" : "heldout";
  return M3B_PREREGISTERED_CORPUS.filter((task) => task.split === split);
}
