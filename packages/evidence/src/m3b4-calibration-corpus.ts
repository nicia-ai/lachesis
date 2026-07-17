import { z } from "zod";

import type {
  evidenceCitationSchema,
  evidenceEdgeSchema,
  evidenceFactSchema,
} from "./contract.js";
import type { evidenceQuerySchema } from "./contract.js";
import {
  type M3a1Category,
  m3a1CategorySchema,
  type M3aTask,
  m3aTaskSchema,
} from "./corpus.js";

type FactInput = z.input<typeof evidenceFactSchema>;
type CitationInput = z.input<typeof evidenceCitationSchema>;
type EdgeInput = z.input<typeof evidenceEdgeSchema>;
type TaskInput = z.input<typeof m3aTaskSchema>;

type Fixture = Readonly<{
  task: TaskInput;
  facts: ReadonlyArray<FactInput>;
  citations: ReadonlyArray<CitationInput>;
  edges: ReadonlyArray<EdgeInput>;
}>;

const RECORDED_FROM = "2024-02-01T00:00:00.000Z";
const CHANGE_AT = "2026-02-15T00:00:00.000Z";
const CURRENT_AT = "2026-07-01T00:00:00.000Z";
const SUFFICIENCY_RULE =
  "answer-only-when-a-complete-visible-derivation-exists-otherwise-abstain" as const;

const QUERY_LIMITS = Object.freeze({
  maxCitations: 12,
  maxEdges: 6,
  maxPaths: 8,
  maxHops: 3,
  maxSerializedBytes: 16_000,
  maxSerializedTokenUpperBound: 16_000,
});

function citation(id: string, source: string): CitationInput {
  return { id, source, locator: id, observedAt: RECORDED_FROM };
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
    citationIds: [input.citationId],
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    recordedFrom: input.recordedFrom ?? RECORDED_FROM,
    recordedUntil: input.recordedUntil ?? null,
  };
}

function edge(input: {
  readonly id: string;
  readonly fromFactId: string;
  readonly toFactId: string;
  readonly relationship: z.input<typeof evidenceEdgeSchema>["relationship"];
  readonly citationId: string;
  readonly recordedFrom?: string;
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
    recordedUntil: null,
  };
}

function query(
  key: string,
  instruction: string,
  maxFacts: number,
): z.input<typeof evidenceQuerySchema> {
  return {
    id: `query-cal4-${key}`,
    text: instruction,
    validAt: CURRENT_AT,
    recordedAt: CURRENT_AT,
    maxFacts,
    ...QUERY_LIMITS,
  };
}

function noise(key: string): Omit<Fixture, "task"> {
  const factIds = ["ledger", "weather", "maintenance"].map(
    (suffix) => `fact-cal4-${key}-noise-${suffix}`,
  );
  const citationIds = ["ledger", "weather", "maintenance"].map(
    (suffix) => `cite-cal4-${key}-noise-${suffix}`,
  );
  const edgeCitationIds = ["one", "two"].map(
    (suffix) => `cite-cal4-${key}-noise-edge-${suffix}`,
  );
  return {
    facts: [
      fact({
        id: factIds[0] ?? "",
        statement:
          "A legacy ledger mentions an unrelated archive without resolving the requested role.",
        subject: `decoy-ledger-${key}`,
        predicate: "archive-note",
        object: "unresolved",
        citationId: citationIds[0] ?? "",
      }),
      fact({
        id: factIds[1] ?? "",
        statement:
          "A weather bulletin describes conditions in a disconnected district.",
        subject: `decoy-weather-${key}`,
        predicate: "forecast",
        object: "cloudy",
        citationId: citationIds[1] ?? "",
      }),
      fact({
        id: factIds[2] ?? "",
        statement:
          "A maintenance ticket records a routine inspection with no task evidence.",
        subject: `decoy-maintenance-${key}`,
        predicate: "inspection",
        object: "routine",
        citationId: citationIds[2] ?? "",
      }),
    ],
    citations: [
      citation(citationIds[0] ?? "", "calibration-legacy-ledger"),
      citation(citationIds[1] ?? "", "calibration-weather-bulletin"),
      citation(citationIds[2] ?? "", "calibration-maintenance-ticket"),
      citation(edgeCitationIds[0] ?? "", "calibration-noise-link-register"),
      citation(edgeCitationIds[1] ?? "", "calibration-noise-link-register"),
    ],
    edges: [
      edge({
        id: `edge-cal4-${key}-noise-one`,
        fromFactId: factIds[0] ?? "",
        toFactId: factIds[1] ?? "",
        relationship: "related",
        citationId: edgeCitationIds[0] ?? "",
      }),
      edge({
        id: `edge-cal4-${key}-noise-two`,
        fromFactId: factIds[1] ?? "",
        toFactId: factIds[2] ?? "",
        relationship: "precedes",
        citationId: edgeCitationIds[1] ?? "",
      }),
    ],
  };
}

function multiHop(index: number): Fixture {
  const key = `multi-hop-${index.toString().padStart(2, "0")}`;
  const person = `calibrator-${index}-northwind`;
  const organization = `guild-${index}-copperleaf`;
  const city = `harbor-${index}-cedarpoint`;
  const first = `fact-cal4-${key}-employment`;
  const second = `fact-cal4-${key}-seat`;
  const firstCitation = `cite-cal4-${key}-roster`;
  const secondCitation = `cite-cal4-${key}-charter`;
  const link = `edge-cal4-${key}-chain`;
  const linkCitation = `cite-cal4-${key}-chain`;
  const instruction = `Locate the headquarters city reached from the employer record for ${person}.`;
  const extra = noise(key);
  return {
    task: {
      id: `m3a1-cal4-${key}`,
      split: "development",
      category: "multi-hop",
      instruction,
      query: query(key, instruction, 2),
      answerContract: {
        role: "headquarters-city",
        cardinality: 1,
        ordering: "scalar",
        anchorSubject: person,
        derivation: "object-to-subject-chain",
        requiredFactPredicates: ["employer", "headquarters"],
        answerSource: "terminal-object",
        minimumSupportingFacts: 2,
        sufficiencyRule: SUFFICIENCY_RULE,
      },
      expectedAnswerValues: [city],
      protectedAnswerTerms: [organization, city],
      expectedFactIds: [first, second],
      expectedCitationIds: [firstCitation, secondCitation],
      expectedEdgeIds: [link],
      expectedEdgeCitationIds: [linkCitation],
      expectedPaths: [{ factIds: [first, second], edgeIds: [link] }],
      retrievalAdvantageExpected: true,
      relationshipEncodingExpected: true,
    },
    facts: [
      fact({
        id: first,
        statement: `A personnel roster associates ${person} with ${organization}.`,
        subject: person,
        predicate: "employer",
        object: organization,
        citationId: firstCitation,
      }),
      fact({
        id: second,
        statement: `The corporate charter places ${organization} in ${city}.`,
        subject: organization,
        predicate: "headquarters",
        object: city,
        citationId: secondCitation,
      }),
      ...extra.facts,
    ],
    citations: [
      citation(firstCitation, "calibration-personnel-roster"),
      citation(secondCitation, "calibration-corporate-charter"),
      citation(linkCitation, "calibration-entity-chain-register"),
      ...extra.citations,
    ],
    edges: [
      edge({
        id: link,
        fromFactId: first,
        toFactId: second,
        relationship: "derived-from",
        citationId: linkCitation,
      }),
      ...extra.edges,
    ],
  };
}

function temporal(index: number): Fixture {
  const key = `temporal-${index.toString().padStart(2, "0")}`;
  const project = `launch-${index}-silverpine`;
  const oldValue = `queued-${index}-westgate`;
  const newValue = `released-${index}-eastgate`;
  const oldFact = `fact-cal4-${key}-earlier`;
  const newFact = `fact-cal4-${key}-later`;
  const oldCitation = `cite-cal4-${key}-earlier`;
  const newCitation = `cite-cal4-${key}-later`;
  const link = `edge-cal4-${key}-sequence`;
  const linkCitation = `cite-cal4-${key}-sequence`;
  const instruction = `Report the earlier and later release states recorded for ${project}.`;
  const extra = noise(key);
  return {
    task: {
      id: `m3a1-cal4-${key}`,
      split: "development",
      category: "temporal",
      instruction,
      query: query(key, instruction, 2),
      answerContract: {
        role: "release-status-change",
        cardinality: 2,
        ordering: "ordered",
        anchorSubject: project,
        derivation: "same-subject-valid-time-sequence",
        requiredFactPredicates: ["release-status", "release-status"],
        answerSource: "ordered-objects",
        minimumSupportingFacts: 2,
        sufficiencyRule: SUFFICIENCY_RULE,
      },
      expectedAnswerValues: [oldValue, newValue],
      protectedAnswerTerms: [oldValue, newValue],
      expectedFactIds: [oldFact, newFact],
      expectedCitationIds: [oldCitation, newCitation],
      expectedEdgeIds: [link],
      expectedEdgeCitationIds: [linkCitation],
      expectedPaths: [{ factIds: [oldFact, newFact], edgeIds: [link] }],
      retrievalAdvantageExpected: false,
      relationshipEncodingExpected: true,
    },
    facts: [
      fact({
        id: oldFact,
        statement: `The archived release state for ${project} is ${oldValue}.`,
        subject: project,
        predicate: "release-status",
        object: oldValue,
        citationId: oldCitation,
        validFrom: RECORDED_FROM,
        validUntil: CHANGE_AT,
        recordedUntil: CHANGE_AT,
      }),
      fact({
        id: newFact,
        statement: `A later release record for ${project} states ${newValue}.`,
        subject: project,
        predicate: "release-status",
        object: newValue,
        citationId: newCitation,
        validFrom: CHANGE_AT,
        recordedFrom: CHANGE_AT,
      }),
      ...extra.facts,
    ],
    citations: [
      citation(oldCitation, "calibration-release-archive"),
      citation(newCitation, "calibration-release-register"),
      citation(linkCitation, "calibration-temporal-chain"),
      ...extra.citations,
    ],
    edges: [
      edge({
        id: link,
        fromFactId: oldFact,
        toFactId: newFact,
        relationship: "supersedes",
        citationId: linkCitation,
        recordedFrom: CHANGE_AT,
      }),
      ...extra.edges,
    ],
  };
}

function contradiction(index: number): Fixture {
  const key = `contradiction-${index.toString().padStart(2, "0")}`;
  const instrument = `gauge-${index}-redquartz`;
  const firstValue = `measure-${index}-amber`;
  const secondValue = `measure-${index}-violet`;
  const first = `fact-cal4-${key}-field`;
  const second = `fact-cal4-${key}-audit`;
  const firstCitation = `cite-cal4-${key}-field`;
  const secondCitation = `cite-cal4-${key}-audit`;
  const link = `edge-cal4-${key}-conflict`;
  const linkCitation = `cite-cal4-${key}-conflict`;
  const instruction = `Return the two incompatible measurements documented for ${instrument}.`;
  const extra = noise(key);
  return {
    task: {
      id: `m3a1-cal4-${key}`,
      split: "development",
      category: "contradiction",
      instruction,
      query: query(key, instruction, 2),
      answerContract: {
        role: "conflicting-readings",
        cardinality: 2,
        ordering: "unordered",
        anchorSubject: instrument,
        derivation: "same-subject-distinct-values",
        requiredFactPredicates: ["reading", "reading"],
        answerSource: "unordered-objects",
        minimumSupportingFacts: 2,
        sufficiencyRule: SUFFICIENCY_RULE,
      },
      expectedAnswerValues: [firstValue, secondValue],
      protectedAnswerTerms: [firstValue, secondValue],
      expectedFactIds: [first, second],
      expectedCitationIds: [firstCitation, secondCitation],
      expectedEdgeIds: [link],
      expectedEdgeCitationIds: [linkCitation],
      expectedPaths: [{ factIds: [first, second], edgeIds: [link] }],
      retrievalAdvantageExpected: false,
      relationshipEncodingExpected: true,
    },
    facts: [
      fact({
        id: first,
        statement: `A field worksheet assigns ${firstValue} to ${instrument}.`,
        subject: instrument,
        predicate: "reading",
        object: firstValue,
        citationId: firstCitation,
      }),
      fact({
        id: second,
        statement: `The laboratory audit assigns ${secondValue} to ${instrument}.`,
        subject: instrument,
        predicate: "reading",
        object: secondValue,
        citationId: secondCitation,
      }),
      ...extra.facts,
    ],
    citations: [
      citation(firstCitation, "calibration-field-worksheet"),
      citation(secondCitation, "calibration-laboratory-audit"),
      citation(linkCitation, "calibration-conflict-register"),
      ...extra.citations,
    ],
    edges: [
      edge({
        id: link,
        fromFactId: first,
        toFactId: second,
        relationship: "contradicts",
        citationId: linkCitation,
      }),
      ...extra.edges,
    ],
  };
}

function provenance(index: number): Fixture {
  const key = `provenance-${index.toString().padStart(2, "0")}`;
  const consignment = `parcel-${index}-ironfern`;
  const verifier = `auditor-${index}-moonharbor`;
  const arrival = `fact-cal4-${key}-arrival`;
  const receipt = `fact-cal4-${key}-receipt`;
  const arrivalCitation = `cite-cal4-${key}-arrival`;
  const receiptCitation = `cite-cal4-${key}-receipt`;
  const link = `edge-cal4-${key}-corroboration`;
  const linkCitation = `cite-cal4-${key}-corroboration`;
  const instruction = `Identify the independent signer corroborating the delivery of ${consignment}.`;
  const extra = noise(key);
  return {
    task: {
      id: `m3a1-cal4-${key}`,
      split: "development",
      category: "provenance",
      instruction,
      query: query(key, instruction, 2),
      answerContract: {
        role: "independent-verifier",
        cardinality: 1,
        ordering: "scalar",
        anchorSubject: consignment,
        derivation: "arrival-plus-signed-receipt",
        requiredFactPredicates: ["arrival", "signed"],
        answerSource: "terminal-subject",
        minimumSupportingFacts: 2,
        sufficiencyRule: SUFFICIENCY_RULE,
      },
      expectedAnswerValues: [verifier],
      protectedAnswerTerms: [verifier],
      expectedFactIds: [arrival, receipt],
      expectedCitationIds: [arrivalCitation, receiptCitation],
      expectedEdgeIds: [link],
      expectedEdgeCitationIds: [linkCitation],
      expectedPaths: [{ factIds: [arrival, receipt], edgeIds: [link] }],
      retrievalAdvantageExpected: true,
      relationshipEncodingExpected: true,
    },
    facts: [
      fact({
        id: arrival,
        statement: `A dock record marks ${consignment} as arrived.`,
        subject: consignment,
        predicate: "arrival",
        object: "dock-confirmed",
        citationId: arrivalCitation,
      }),
      fact({
        id: receipt,
        statement: `${verifier} signed an independent custody receipt.`,
        subject: verifier,
        predicate: "signed",
        object: "custody-receipt",
        citationId: receiptCitation,
      }),
      ...extra.facts,
    ],
    citations: [
      citation(arrivalCitation, "calibration-dock-record"),
      citation(receiptCitation, "calibration-custody-receipt"),
      citation(linkCitation, "calibration-corroboration-register"),
      ...extra.citations,
    ],
    edges: [
      edge({
        id: link,
        fromFactId: arrival,
        toFactId: receipt,
        relationship: "corroborates",
        citationId: linkCitation,
      }),
      ...extra.edges,
    ],
  };
}

function retraction(index: number): Fixture {
  const key = `retraction-${index.toString().padStart(2, "0")}`;
  const policy = `protocol-${index}-bluewillow`;
  const oldRule = `limit-${index}-granite`;
  const newRule = `limit-${index}-opal`;
  const oldFact = `fact-cal4-${key}-original`;
  const notice = `fact-cal4-${key}-withdrawal`;
  const newFact = `fact-cal4-${key}-replacement`;
  const oldCitation = `cite-cal4-${key}-original`;
  const noticeCitation = `cite-cal4-${key}-withdrawal`;
  const newCitation = `cite-cal4-${key}-replacement`;
  const retractEdge = `edge-cal4-${key}-withdraws`;
  const replaceEdge = `edge-cal4-${key}-replaces`;
  const retractCitation = `cite-cal4-${key}-withdraws`;
  const replaceCitation = `cite-cal4-${key}-replaces`;
  const instruction = `Give the withdrawn and replacement rules in recorded order for ${policy}.`;
  const extra = noise(key);
  return {
    task: {
      id: `m3a1-cal4-${key}`,
      split: "development",
      category: "retraction",
      instruction,
      query: query(key, instruction, 3),
      answerContract: {
        role: "retracted-rule-change",
        cardinality: 2,
        ordering: "ordered",
        anchorSubject: policy,
        derivation: "same-subject-recorded-retraction-sequence",
        requiredFactPredicates: ["rule", "retraction", "rule"],
        answerSource: "ordered-rule-objects",
        minimumSupportingFacts: 3,
        sufficiencyRule: SUFFICIENCY_RULE,
      },
      expectedAnswerValues: [oldRule, newRule],
      protectedAnswerTerms: [oldRule, newRule],
      expectedFactIds: [oldFact, notice, newFact],
      expectedCitationIds: [oldCitation, noticeCitation, newCitation],
      expectedEdgeIds: [retractEdge, replaceEdge],
      expectedEdgeCitationIds: [retractCitation, replaceCitation],
      expectedPaths: [
        {
          factIds: [notice, oldFact, newFact],
          edgeIds: [retractEdge, replaceEdge],
        },
      ],
      retrievalAdvantageExpected: true,
      relationshipEncodingExpected: true,
    },
    facts: [
      fact({
        id: oldFact,
        statement: `The first register entry for ${policy} specifies ${oldRule}.`,
        subject: policy,
        predicate: "rule",
        object: oldRule,
        citationId: oldCitation,
        recordedUntil: CHANGE_AT,
      }),
      fact({
        id: notice,
        statement: `A withdrawal notice applies to the earlier ${policy} rule.`,
        subject: policy,
        predicate: "retraction",
        object: "earlier-entry",
        citationId: noticeCitation,
        recordedFrom: CHANGE_AT,
      }),
      fact({
        id: newFact,
        statement: `The replacement register entry for ${policy} specifies ${newRule}.`,
        subject: policy,
        predicate: "rule",
        object: newRule,
        citationId: newCitation,
        recordedFrom: CHANGE_AT,
      }),
      ...extra.facts,
    ],
    citations: [
      citation(oldCitation, "calibration-policy-register"),
      citation(noticeCitation, "calibration-withdrawal-notice"),
      citation(newCitation, "calibration-replacement-register"),
      citation(retractCitation, "calibration-retraction-chain"),
      citation(replaceCitation, "calibration-replacement-chain"),
      ...extra.citations,
    ],
    edges: [
      edge({
        id: retractEdge,
        fromFactId: notice,
        toFactId: oldFact,
        relationship: "retracts",
        citationId: retractCitation,
        recordedFrom: CHANGE_AT,
      }),
      edge({
        id: replaceEdge,
        fromFactId: oldFact,
        toFactId: newFact,
        relationship: "supersedes",
        citationId: replaceCitation,
        recordedFrom: CHANGE_AT,
      }),
      ...extra.edges,
    ],
  };
}

function negativeControl(index: number): Fixture {
  const key = `negative-control-${index.toString().padStart(2, "0")}`;
  const asset = `workshop-${index}-sunmaple`;
  const owner = `custodian-${index}-brightmarsh`;
  const ownerFact = `fact-cal4-${key}-custodian`;
  const ownerCitation = `cite-cal4-${key}-custodian`;
  const instruction = `Name the owner registered for ${asset}.`;
  const extra = noise(key);
  return {
    task: {
      id: `m3a1-cal4-${key}`,
      split: "development",
      category: "negative-control",
      instruction,
      query: query(key, instruction, 1),
      answerContract: {
        role: "owner",
        cardinality: 1,
        ordering: "scalar",
        anchorSubject: asset,
        derivation: "single-terminal-fact",
        requiredFactPredicates: ["owner"],
        answerSource: "terminal-object",
        minimumSupportingFacts: 1,
        sufficiencyRule: SUFFICIENCY_RULE,
      },
      expectedAnswerValues: [owner],
      protectedAnswerTerms: [owner],
      expectedFactIds: [ownerFact],
      expectedCitationIds: [ownerCitation],
      expectedEdgeIds: [],
      expectedEdgeCitationIds: [],
      expectedPaths: [],
      retrievalAdvantageExpected: false,
      relationshipEncodingExpected: false,
    },
    facts: [
      fact({
        id: ownerFact,
        statement: `The asset registry lists ${owner} as owner of ${asset}.`,
        subject: asset,
        predicate: "owner",
        object: owner,
        citationId: ownerCitation,
      }),
      ...extra.facts,
    ],
    citations: [
      citation(ownerCitation, "calibration-asset-registry"),
      ...extra.citations,
    ],
    edges: extra.edges,
  };
}

const BUILDERS: Readonly<Record<M3a1Category, (index: number) => Fixture>> =
  Object.freeze({
    "multi-hop": multiHop,
    temporal,
    contradiction,
    provenance,
    retraction,
    "negative-control": negativeControl,
  });

const fixtures = m3a1CategorySchema.options.flatMap((category) =>
  Array.from({ length: 5 }, (_, index) => BUILDERS[category](index + 1)),
);

export const M3B4_CALIBRATION_TASKS: ReadonlyArray<M3aTask> = z
  .array(m3aTaskSchema)
  .length(30)
  .readonly()
  .parse(fixtures.map((fixture) => fixture.task));

export const M3B4_CALIBRATION_GRAPH_ADDITIONS = Object.freeze({
  facts: Object.freeze(fixtures.flatMap((fixture) => fixture.facts)),
  citations: Object.freeze(fixtures.flatMap((fixture) => fixture.citations)),
  edges: Object.freeze(fixtures.flatMap((fixture) => fixture.edges)),
});
