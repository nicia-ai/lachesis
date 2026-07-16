import { z } from "zod";

import type {
  evidenceCitationSchema,
  evidenceEdgeSchema,
  evidenceFactSchema,
} from "./contract.js";
import { evidencePathSchema, evidenceQuerySchema } from "./contract.js";
import { evidenceGraphSchema } from "./graph.js";

export const m3a1SplitSchema = z.enum(["development", "heldout"]);
export const m3a1CategorySchema = z.enum([
  "multi-hop",
  "temporal",
  "contradiction",
  "provenance",
  "retraction",
  "negative-control",
]);

export const m3aTaskSchema = z
  .strictObject({
    id: z.string().regex(/^m3a1-[a-z0-9-]+$/),
    split: m3a1SplitSchema,
    category: m3a1CategorySchema,
    instruction: z.string().min(1),
    query: evidenceQuerySchema,
    expectedAnswer: z.string().min(1),
    protectedAnswerTerms: z.array(z.string().min(1)).min(1).readonly(),
    expectedFactIds: z.array(z.string().min(1)).min(1).readonly(),
    expectedCitationIds: z.array(z.string().min(1)).min(1).readonly(),
    expectedEdgeIds: z.array(z.string().min(1)).readonly(),
    expectedEdgeCitationIds: z.array(z.string().min(1)).readonly(),
    expectedPaths: z.array(evidencePathSchema).readonly(),
    retrievalAdvantageExpected: z.boolean(),
    relationshipEncodingExpected: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.query.text !== value.instruction)
      context.addIssue({
        code: "custom",
        message: "Selection query text must equal the public instruction.",
        path: ["query", "text"],
      });
    const structural = value.category !== "negative-control";
    if (
      structural !== value.relationshipEncodingExpected ||
      structural !== value.expectedPaths.length > 0 ||
      structural !== value.expectedEdgeIds.length > 0 ||
      structural !== value.expectedEdgeCitationIds.length > 0
    )
      context.addIssue({
        code: "custom",
        message:
          "Only structural tasks may declare relationship-encoding ground truth.",
        path: ["relationshipEncodingExpected"],
      });
    if (
      value.category === "negative-control" &&
      value.retrievalAdvantageExpected
    )
      context.addIssue({
        code: "custom",
        message: "Negative controls cannot expect a retrieval advantage.",
        path: ["retrievalAdvantageExpected"],
      });
  })
  .readonly();

export type M3a1Split = z.infer<typeof m3a1SplitSchema>;
export type M3a1Category = z.infer<typeof m3a1CategorySchema>;
export type M3aTask = z.infer<typeof m3aTaskSchema>;

type FactInput = z.input<typeof evidenceFactSchema>;
type CitationInput = z.input<typeof evidenceCitationSchema>;
type EdgeInput = z.input<typeof evidenceEdgeSchema>;
type TaskInput = z.input<typeof m3aTaskSchema>;

type FixturePart = Readonly<{
  task: TaskInput;
  facts: ReadonlyArray<FactInput>;
  citations: ReadonlyArray<CitationInput>;
  edges: ReadonlyArray<EdgeInput>;
}>;

const RECORDED_FROM = "2025-01-01T00:00:00.000Z";
const CHANGE_AT = "2026-04-01T00:00:00.000Z";
const CURRENT_AT = "2026-07-01T00:00:00.000Z";

const BASE_LIMITS = Object.freeze({
  maxCitations: 8,
  maxEdges: 4,
  maxPaths: 4,
  maxHops: 2,
  maxSerializedBytes: 12_000,
  maxSerializedTokenUpperBound: 12_000,
});

function citation(id: string, source: string): CitationInput {
  return {
    id,
    source,
    locator: id,
    observedAt: RECORDED_FROM,
  };
}

function fact(input: {
  readonly id: string;
  readonly statement: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly citationId: string;
  readonly validFrom?: string | null;
  readonly validUntil?: string | null;
  readonly recordedFrom?: string;
  readonly recordedUntil?: string | null;
}): FactInput {
  return {
    id: input.id,
    statement: input.statement,
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    recordedFrom: input.recordedFrom ?? RECORDED_FROM,
    recordedUntil: input.recordedUntil ?? null,
    citationIds: [input.citationId],
  };
}

function edge(input: {
  readonly id: string;
  readonly fromFactId: string;
  readonly toFactId: string;
  readonly relationship: z.input<typeof evidenceEdgeSchema>["relationship"];
  readonly citationId: string;
  readonly recordedFrom?: string;
  readonly recordedUntil?: string | null;
}): EdgeInput {
  return {
    id: input.id,
    fromFactId: input.fromFactId,
    toFactId: input.toFactId,
    relationship: input.relationship,
    provenanceCitationIds: [input.citationId],
    validFrom: null,
    validUntil: null,
    recordedFrom: input.recordedFrom ?? RECORDED_FROM,
    recordedUntil: input.recordedUntil ?? null,
  };
}

function key(split: M3a1Split, category: M3a1Category, index: number): string {
  const splitKey = split === "development" ? "dev" : "hold";
  return `${splitKey}-${category}-${index.toString().padStart(3, "0")}`;
}

function query(
  id: string,
  instruction: string,
  maxFacts: number,
): z.input<typeof evidenceQuerySchema> {
  return {
    id: `query-${id}`,
    text: instruction,
    validAt: CURRENT_AT,
    recordedAt: CURRENT_AT,
    maxFacts,
    ...BASE_LIMITS,
  };
}

function noise(
  prefix: string,
  distractorStatement = "An unrelated city headquarters status report is archived.",
): Readonly<{
  facts: ReadonlyArray<FactInput>;
  citations: ReadonlyArray<CitationInput>;
  edges: ReadonlyArray<EdgeInput>;
}> {
  const distractCitation = `cite-${prefix}-distractor`;
  const noiseCitation = `cite-${prefix}-noise`;
  const edgeCitation = `cite-${prefix}-noise-edge`;
  const distractFact = `fact-${prefix}-z-distractor`;
  const noiseFact = `fact-${prefix}-zz-noise`;
  return {
    citations: [
      citation(distractCitation, "misleading-lexical-index"),
      citation(noiseCitation, "disconnected-noise-index"),
      citation(edgeCitation, "noisy-edge-register"),
    ],
    facts: [
      fact({
        id: distractFact,
        statement: distractorStatement,
        subject: "unrelated-record",
        predicate: "archive-note",
        object: "distractor",
        citationId: distractCitation,
      }),
      fact({
        id: noiseFact,
        statement: "A disconnected maintenance record contains no task answer.",
        subject: `noise-${prefix}`,
        predicate: "maintenance",
        object: "irrelevant",
        citationId: noiseCitation,
      }),
    ],
    edges: [
      edge({
        id: `edge-${prefix}-noise`,
        fromFactId: distractFact,
        toFactId: noiseFact,
        relationship: "related",
        citationId: edgeCitation,
      }),
    ],
  };
}

function multiHopFixture(split: M3a1Split, index: number): FixturePart {
  const prefix = key(split, "multi-hop", index);
  const compact = prefix.replaceAll("-", "");
  const person = `person${compact}`;
  const organization = `organswer${compact}`;
  const city = `cityanswer${prefix.replaceAll("-", "")}`;
  const anchor = `fact-${prefix}-a-employer`;
  const target = `fact-${prefix}-b-headquarters`;
  const anchorCitation = `cite-${prefix}-employer`;
  const targetCitation = `cite-${prefix}-headquarters`;
  const edgeCitation = `cite-${prefix}-link-01`;
  const relationship = `edge-${prefix}-link-01`;
  const instruction = `Which city hosts the headquarters of ${person}'s employer?`;
  const extra = noise(
    prefix,
    "An unrelated city hosts a headquarters entry in an employer survey.",
  );
  return {
    task: {
      id: `m3a1-${prefix}`,
      split,
      category: "multi-hop",
      instruction,
      query: query(prefix, instruction, 2),
      expectedAnswer: city,
      protectedAnswerTerms: [city, organization],
      expectedFactIds: [anchor, target],
      expectedCitationIds: [anchorCitation, targetCitation],
      expectedEdgeIds: [relationship],
      expectedEdgeCitationIds: [edgeCitation],
      expectedPaths: [{ factIds: [anchor, target], edgeIds: [relationship] }],
      retrievalAdvantageExpected: true,
      relationshipEncodingExpected: true,
    },
    citations: [
      citation(anchorCitation, "employment-directory"),
      citation(targetCitation, "company-register"),
      citation(edgeCitation, "evidence-link-register"),
      ...extra.citations,
    ],
    facts: [
      fact({
        id: anchor,
        statement: `The headquarters lookup records ${person}'s employer as ${organization}.`,
        subject: person,
        predicate: "employer",
        object: organization,
        citationId: anchorCitation,
      }),
      fact({
        id: target,
        statement: `${organization}'s headquarters are in ${city}.`,
        subject: organization,
        predicate: "headquarters",
        object: city,
        citationId: targetCitation,
      }),
      ...extra.facts,
    ],
    edges: [
      edge({
        id: relationship,
        fromFactId: anchor,
        toFactId: target,
        relationship: "related",
        citationId: edgeCitation,
      }),
      ...extra.edges,
    ],
  };
}

function temporalFixture(split: M3a1Split, index: number): FixturePart {
  const prefix = key(split, "temporal", index);
  const project = `project${prefix.replaceAll("-", "")}`;
  const oldStatus = `phaseold${prefix.replaceAll("-", "")}`;
  const newStatus = `phasenew${prefix.replaceAll("-", "")}`;
  const oldFact = `fact-${prefix}-a-old`;
  const newFact = `fact-${prefix}-b-new`;
  const oldCitation = `cite-${prefix}-old`;
  const newCitation = `cite-${prefix}-new`;
  const edgeCitation = `cite-${prefix}-link-01`;
  const relationship = `edge-${prefix}-link-01`;
  const instruction = `How did the release status of ${project} change by July 2026?`;
  const extra = noise(prefix);
  return {
    task: {
      id: `m3a1-${prefix}`,
      split,
      category: "temporal",
      instruction,
      query: query(prefix, instruction, 2),
      expectedAnswer: `${oldStatus} then ${newStatus}`,
      protectedAnswerTerms: [oldStatus, newStatus],
      expectedFactIds: [oldFact, newFact],
      expectedCitationIds: [oldCitation, newCitation],
      expectedEdgeIds: [relationship],
      expectedEdgeCitationIds: [edgeCitation],
      expectedPaths: [{ factIds: [oldFact, newFact], edgeIds: [relationship] }],
      retrievalAdvantageExpected: false,
      relationshipEncodingExpected: true,
    },
    citations: [
      citation(oldCitation, "release-log"),
      citation(newCitation, "release-log"),
      citation(edgeCitation, "evidence-link-register"),
      ...extra.citations,
    ],
    facts: [
      fact({
        id: oldFact,
        statement: `${project} release status was ${oldStatus}.`,
        subject: project,
        predicate: "release-status",
        object: oldStatus,
        citationId: oldCitation,
        validFrom: RECORDED_FROM,
        validUntil: CHANGE_AT,
        recordedUntil: CHANGE_AT,
      }),
      fact({
        id: newFact,
        statement: `${project} release status became ${newStatus}.`,
        subject: project,
        predicate: "release-status",
        object: newStatus,
        citationId: newCitation,
        validFrom: CHANGE_AT,
        recordedFrom: CHANGE_AT,
      }),
      ...extra.facts,
    ],
    edges: [
      edge({
        id: relationship,
        fromFactId: oldFact,
        toFactId: newFact,
        relationship: "supersedes",
        citationId: edgeCitation,
        recordedFrom: CHANGE_AT,
      }),
      ...extra.edges,
    ],
  };
}

function contradictionFixture(split: M3a1Split, index: number): FixturePart {
  const prefix = key(split, "contradiction", index);
  const sensor = `sensor${prefix.replaceAll("-", "")}`;
  const firstReading = `readingalpha${prefix.replaceAll("-", "")}`;
  const secondReading = `readingbeta${prefix.replaceAll("-", "")}`;
  const firstFact = `fact-${prefix}-a-first`;
  const secondFact = `fact-${prefix}-b-second`;
  const firstCitation = `cite-${prefix}-first`;
  const secondCitation = `cite-${prefix}-second`;
  const edgeCitation = `cite-${prefix}-link-01`;
  const relationship = `edge-${prefix}-link-01`;
  const instruction = `Which readings conflict in the reports for ${sensor}?`;
  const extra = noise(prefix);
  return {
    task: {
      id: `m3a1-${prefix}`,
      split,
      category: "contradiction",
      instruction,
      query: query(prefix, instruction, 2),
      expectedAnswer: `${firstReading} conflicts with ${secondReading}`,
      protectedAnswerTerms: [firstReading, secondReading],
      expectedFactIds: [firstFact, secondFact],
      expectedCitationIds: [firstCitation, secondCitation],
      expectedEdgeIds: [relationship],
      expectedEdgeCitationIds: [edgeCitation],
      expectedPaths: [
        { factIds: [firstFact, secondFact], edgeIds: [relationship] },
      ],
      retrievalAdvantageExpected: false,
      relationshipEncodingExpected: true,
    },
    citations: [
      citation(firstCitation, "raw-sensor-feed"),
      citation(secondCitation, "audited-sensor-feed"),
      citation(edgeCitation, "evidence-link-register"),
      ...extra.citations,
    ],
    facts: [
      fact({
        id: firstFact,
        statement: `The first ${sensor} report records ${firstReading}.`,
        subject: sensor,
        predicate: "reading",
        object: firstReading,
        citationId: firstCitation,
      }),
      fact({
        id: secondFact,
        statement: `The audited ${sensor} report records ${secondReading}.`,
        subject: sensor,
        predicate: "reading",
        object: secondReading,
        citationId: secondCitation,
      }),
      ...extra.facts,
    ],
    edges: [
      edge({
        id: relationship,
        fromFactId: firstFact,
        toFactId: secondFact,
        relationship: "contradicts",
        citationId: edgeCitation,
      }),
      ...extra.edges,
    ],
  };
}

function provenanceFixture(split: M3a1Split, index: number): FixturePart {
  const prefix = key(split, "provenance", index);
  const shipment = `shipment${prefix.replaceAll("-", "")}`;
  const verifier = `verifier${prefix.replaceAll("-", "")}`;
  const dispatchFact = `fact-${prefix}-a-dispatch`;
  const verifierFact = `fact-${prefix}-b-verifier`;
  const dispatchCitation = `cite-${prefix}-dispatch`;
  const verifierCitation = `cite-${prefix}-verifier`;
  const edgeCitation = `cite-${prefix}-link-01`;
  const relationship = `edge-${prefix}-link-01`;
  const instruction = `Which organization independently confirms the arrival report for ${shipment}?`;
  const extra = noise(
    prefix,
    "An unrelated organization independently confirms a report index.",
  );
  return {
    task: {
      id: `m3a1-${prefix}`,
      split,
      category: "provenance",
      instruction,
      query: query(prefix, instruction, 2),
      expectedAnswer: verifier,
      protectedAnswerTerms: [verifier],
      expectedFactIds: [dispatchFact, verifierFact],
      expectedCitationIds: [dispatchCitation, verifierCitation],
      expectedEdgeIds: [relationship],
      expectedEdgeCitationIds: [edgeCitation],
      expectedPaths: [
        { factIds: [dispatchFact, verifierFact], edgeIds: [relationship] },
      ],
      retrievalAdvantageExpected: true,
      relationshipEncodingExpected: true,
    },
    citations: [
      citation(dispatchCitation, "dispatch-report"),
      citation(verifierCitation, "independent-receipt"),
      citation(edgeCitation, "evidence-link-register"),
      ...extra.citations,
    ],
    facts: [
      fact({
        id: dispatchFact,
        statement: `The organization dispatch report records arrival of ${shipment}.`,
        subject: shipment,
        predicate: "arrival",
        object: "reported",
        citationId: dispatchCitation,
      }),
      fact({
        id: verifierFact,
        statement: `${verifier} signed the secondary receipt.`,
        subject: verifier,
        predicate: "signed",
        object: "secondary-receipt",
        citationId: verifierCitation,
      }),
      ...extra.facts,
    ],
    edges: [
      edge({
        id: relationship,
        fromFactId: dispatchFact,
        toFactId: verifierFact,
        relationship: "corroborates",
        citationId: edgeCitation,
      }),
      ...extra.edges,
    ],
  };
}

function retractionFixture(split: M3a1Split, index: number): FixturePart {
  const prefix = key(split, "retraction", index);
  const policy = `policy${prefix.replaceAll("-", "")}`;
  const oldRule = `ruleold${prefix.replaceAll("-", "")}`;
  const newRule = `rulenew${prefix.replaceAll("-", "")}`;
  const oldFact = `fact-${prefix}-a-old`;
  const noticeFact = `fact-${prefix}-b-notice`;
  const newFact = `fact-${prefix}-c-new`;
  const oldCitation = `cite-${prefix}-old`;
  const noticeCitation = `cite-${prefix}-notice`;
  const newCitation = `cite-${prefix}-new`;
  const retractCitation = `cite-${prefix}-link-01`;
  const supersedeCitation = `cite-${prefix}-link-02`;
  const retractEdge = `edge-${prefix}-link-01`;
  const supersedeEdge = `edge-${prefix}-link-02`;
  const instruction = `How did the recorded rule for ${policy} change after its retraction?`;
  const extra = noise(
    prefix,
    "An unrelated policy rule change is recorded in an archive.",
  );
  return {
    task: {
      id: `m3a1-${prefix}`,
      split,
      category: "retraction",
      instruction,
      query: query(prefix, instruction, 3),
      expectedAnswer: `${oldRule} was replaced by ${newRule}`,
      protectedAnswerTerms: [oldRule, newRule],
      expectedFactIds: [oldFact, noticeFact, newFact],
      expectedCitationIds: [oldCitation, noticeCitation, newCitation],
      expectedEdgeIds: [retractEdge, supersedeEdge],
      expectedEdgeCitationIds: [retractCitation, supersedeCitation],
      expectedPaths: [
        {
          factIds: [noticeFact, oldFact, newFact],
          edgeIds: [retractEdge, supersedeEdge],
        },
      ],
      retrievalAdvantageExpected: true,
      relationshipEncodingExpected: true,
    },
    citations: [
      citation(oldCitation, "policy-archive"),
      citation(noticeCitation, "retraction-bulletin"),
      citation(newCitation, "current-policy"),
      citation(retractCitation, "evidence-link-register"),
      citation(supersedeCitation, "evidence-link-register"),
      ...extra.citations,
    ],
    facts: [
      fact({
        id: oldFact,
        statement: `${policy} originally recorded ${oldRule}.`,
        subject: policy,
        predicate: "rule",
        object: oldRule,
        citationId: oldCitation,
        recordedUntil: CHANGE_AT,
      }),
      fact({
        id: noticeFact,
        statement: `A bulletin recorded how the ${policy} rule changed after retraction.`,
        subject: policy,
        predicate: "retraction",
        object: "original-rule",
        citationId: noticeCitation,
        recordedFrom: CHANGE_AT,
      }),
      fact({
        id: newFact,
        statement: `${policy} now records ${newRule}.`,
        subject: policy,
        predicate: "rule",
        object: newRule,
        citationId: newCitation,
        recordedFrom: CHANGE_AT,
      }),
      ...extra.facts,
    ],
    edges: [
      edge({
        id: retractEdge,
        fromFactId: noticeFact,
        toFactId: oldFact,
        relationship: "retracts",
        citationId: retractCitation,
        recordedFrom: CHANGE_AT,
      }),
      edge({
        id: supersedeEdge,
        fromFactId: oldFact,
        toFactId: newFact,
        relationship: "supersedes",
        citationId: supersedeCitation,
        recordedFrom: CHANGE_AT,
      }),
      ...extra.edges,
    ],
  };
}

function negativeControlFixture(split: M3a1Split, index: number): FixturePart {
  const prefix = key(split, "negative-control", index);
  const project = `project${prefix.replaceAll("-", "")}`;
  const owner = `owneranswer${prefix.replaceAll("-", "")}`;
  const targetFact = `fact-${prefix}-a-owner`;
  const targetCitation = `cite-${prefix}-owner`;
  const instruction = `Who owns ${project}?`;
  const extra = noise(prefix);
  return {
    task: {
      id: `m3a1-${prefix}`,
      split,
      category: "negative-control",
      instruction,
      query: query(prefix, instruction, 1),
      expectedAnswer: owner,
      protectedAnswerTerms: [owner],
      expectedFactIds: [targetFact],
      expectedCitationIds: [targetCitation],
      expectedEdgeIds: [],
      expectedEdgeCitationIds: [],
      expectedPaths: [],
      retrievalAdvantageExpected: false,
      relationshipEncodingExpected: false,
    },
    citations: [
      citation(targetCitation, "project-register"),
      ...extra.citations,
    ],
    facts: [
      fact({
        id: targetFact,
        statement: `${owner} owns ${project}.`,
        subject: project,
        predicate: "owner",
        object: owner,
        citationId: targetCitation,
      }),
      ...extra.facts,
    ],
    edges: extra.edges,
  };
}

const FIXTURE_BUILDERS = Object.freeze({
  "multi-hop": multiHopFixture,
  temporal: temporalFixture,
  contradiction: contradictionFixture,
  provenance: provenanceFixture,
  retraction: retractionFixture,
  "negative-control": negativeControlFixture,
});

function fixtureCount(split: M3a1Split, category: M3a1Category): number {
  if (split === "development") return 5;
  return category === "negative-control" ? 40 : 20;
}

const splits: ReadonlyArray<M3a1Split> = ["development", "heldout"];

const fixtureParts: ReadonlyArray<FixturePart> = splits.flatMap((split) =>
  m3a1CategorySchema.options.flatMap((category) =>
    Array.from({ length: fixtureCount(split, category) }, (_, index) =>
      FIXTURE_BUILDERS[category](split, index),
    ),
  ),
);

export const M3A1_REFERENCE_GRAPH = evidenceGraphSchema.parse({
  id: "m3a1-reference-evidence",
  version: "2",
  facts: fixtureParts.flatMap((part) => part.facts),
  citations: fixtureParts.flatMap((part) => part.citations),
  edges: fixtureParts.flatMap((part) => part.edges),
});

export const M3A1_PREREGISTERED_CORPUS: ReadonlyArray<M3aTask> = z
  .array(m3aTaskSchema)
  .readonly()
  .parse(fixtureParts.map((part) => part.task));

export const M3A1_CORPUS_PROTOCOL = Object.freeze({
  id: "lachesis-m3a1-factorial-evidence-substrate",
  version: "2",
  developmentCases: 30,
  heldoutCases: 140,
  heldoutStructuralCases: 100,
  heldoutNegativeControls: 40,
  liveInferenceAuthorized: false,
  typeGraphIntegrated: false,
  comparison:
    "Lexical facts versus graph-selected facts versus untyped adjacency versus typed relationships under identical per-task context bounds.",
});
