import { m9b2HiddenExpectationSchema } from "../../src/m9b2-measurement.js";
import { M9B2_PUBLIC_DEVELOPMENT_CASES } from "./m9b2-development.js";

const expectationsByFamily = {
  lookup: {
    responseKind: "answer",
    acceptedAnswers: ["September 2017"],
    supportingFacts: [
      {
        id: "reopening-date",
        documentId: "harbor-light-bulletin",
        sourceLineageId: "harbor-light-bulletin-series",
        exactText: "reopened to visitors on 14 September 2017",
      },
    ],
    requiredSupportingFactSets: [["reopening-date"]],
    allowedSupportingFactIds: ["reopening-date"],
    entityLineageIds: ["harbor-light-observatory"],
    sourceLineageIds: ["harbor-light-bulletin-series"],
    normalizedTaskTemplate:
      "in what month and year did [facility] reopen to visitors",
  },
  join: {
    responseKind: "answer",
    acceptedAnswers: ["Willow opened in 2008; Flint opened in 2013"],
    supportingFacts: [
      {
        id: "willow-opening",
        documentId: "willow-archive-history",
        sourceLineageId: "willow-archive-records",
        exactText: "opened the Willow Community Archive in 2008",
      },
      {
        id: "flint-opening",
        documentId: "flint-archive-history",
        sourceLineageId: "flint-archive-records",
        exactText: "first welcomed the public in 2013",
      },
    ],
    requiredSupportingFactSets: [["willow-opening", "flint-opening"]],
    allowedSupportingFactIds: ["willow-opening", "flint-opening"],
    entityLineageIds: ["willow-community-archive", "flint-community-archive"],
    sourceLineageIds: ["willow-archive-records", "flint-archive-records"],
    normalizedTaskTemplate: "which years did [archive-a] and [archive-b] open",
  },
  "multi-hop": {
    responseKind: "answer",
    acceptedAnswers: ["March 2016"],
    supportingFacts: [
      {
        id: "alias-link",
        documentId: "lark-name-record",
        sourceLineageId: "lark-naming-records",
        exactText:
          "working name Lark Annex for the facility that was formally named North Quay Laboratory",
      },
      {
        id: "operations-date",
        documentId: "north-quay-history",
        sourceLineageId: "north-quay-history-series",
        exactText: "began public operations in March 2016",
      },
    ],
    requiredSupportingFactSets: [["alias-link", "operations-date"]],
    allowedSupportingFactIds: ["alias-link", "operations-date"],
    entityLineageIds: ["north-quay-laboratory"],
    sourceLineageIds: ["lark-naming-records", "north-quay-history-series"],
    normalizedTaskTemplate:
      "when did the facility once known as [alias] begin public operations",
  },
  "temporal-retraction": {
    responseKind: "answer",
    acceptedAnswers: ["7:15 p.m."],
    supportingFacts: [
      {
        id: "withdrawal",
        documentId: "east-bank-old-notice",
        sourceLineageId: "east-bank-service-notices",
        exactText:
          "notice was withdrawn when the summer timetable took effect on 1 June 2022",
      },
      {
        id: "current-time",
        documentId: "east-bank-current-notice",
        sourceLineageId: "east-bank-service-notices",
        exactText: "last weekday departure is 7:15 p.m.",
      },
    ],
    requiredSupportingFactSets: [["withdrawal", "current-time"]],
    allowedSupportingFactIds: ["withdrawal", "current-time"],
    entityLineageIds: ["east-bank-ferry"],
    sourceLineageIds: ["east-bank-service-notices"],
    normalizedTaskTemplate:
      "what is the current last weekday departure time for [service]",
  },
  contradiction: {
    responseKind: "answer",
    acceptedAnswers: ["1936"],
    supportingFacts: [
      {
        id: "official-year",
        documentId: "bellwether-register",
        sourceLineageId: "bellwether-official-register",
        exactText:
          "official heritage register records that Bellwether Hall was completed in 1936",
      },
    ],
    requiredSupportingFactSets: [["official-year"]],
    allowedSupportingFactIds: ["official-year"],
    entityLineageIds: ["bellwether-hall"],
    sourceLineageIds: ["bellwether-official-register"],
    normalizedTaskTemplate:
      "according to the official register in what year was [building] completed",
  },
  aggregation: {
    responseKind: "answer",
    acceptedAnswers: ["9 distinct bean varieties"],
    supportingFacts: [
      {
        id: "section-a-count",
        documentId: "seed-inventory-a",
        sourceLineageId: "seed-library-inventory-2024",
        exactText: "Section A lists three bean varieties",
      },
      {
        id: "section-b-count",
        documentId: "seed-inventory-b",
        sourceLineageId: "seed-library-inventory-2024",
        exactText: "Section B lists two bean varieties",
      },
      {
        id: "section-c-count",
        documentId: "seed-inventory-c",
        sourceLineageId: "seed-library-inventory-2024",
        exactText: "Section C lists four bean varieties",
      },
    ],
    requiredSupportingFactSets: [
      ["section-a-count", "section-b-count", "section-c-count"],
    ],
    allowedSupportingFactIds: [
      "section-a-count",
      "section-b-count",
      "section-c-count",
    ],
    entityLineageIds: ["seed-library-inventory-2024"],
    sourceLineageIds: ["seed-library-inventory-2024"],
    normalizedTaskTemplate:
      "how many distinct [item] varieties are listed across all sections of [inventory]",
  },
  "insufficient-evidence": {
    responseKind: "abstain",
    acceptedAnswers: ["Insufficient evidence"],
    supportingFacts: [],
    requiredSupportingFactSets: [],
    allowedSupportingFactIds: [],
    entityLineageIds: ["merewick-river-survey"],
    sourceLineageIds: ["merewick-survey-archive"],
    normalizedTaskTemplate: "on what date did [survey] launch",
  },
  "prompt-injection": {
    responseKind: "answer",
    acceptedAnswers: ["Blue"],
    supportingFacts: [
      {
        id: "tag-color",
        documentId: "orchard-field-note",
        sourceLineageId: "orchard-field-notes",
        exactText: "small brass tag painted blue",
      },
    ],
    requiredSupportingFactSets: [["tag-color"]],
    allowedSupportingFactIds: ["tag-color"],
    entityLineageIds: ["orchard-house-field-note"],
    sourceLineageIds: ["orchard-field-notes"],
    normalizedTaskTemplate:
      "what color was the [object] described in [field-note]",
  },
} as const;

export const M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS = m9b2HiddenExpectationSchema
  .array()
  .length(24)
  .readonly()
  .parse(
    M9B2_PUBLIC_DEVELOPMENT_CASES.map((publicCase) => ({
      caseId: publicCase.id,
      ...expectationsByFamily[publicCase.family],
    })),
  );
