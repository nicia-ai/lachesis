import { z } from "zod";

import { evidencePathSchema, evidenceQuerySchema } from "./contract.js";
import { evidenceGraphSchema } from "./graph.js";

export const m3aTaskSchema = z
  .strictObject({
    id: z.string().regex(/^m3a-[a-z0-9-]+$/),
    category: z.enum([
      "multi-hop",
      "temporal",
      "contradiction",
      "provenance",
      "retraction",
      "negative-control",
    ]),
    instruction: z.string().min(1),
    query: evidenceQuerySchema,
    expectedAnswer: z.string().min(1),
    expectedFactIds: z.array(z.string().min(1)).min(1).readonly(),
    expectedCitationIds: z.array(z.string().min(1)).min(1).readonly(),
    expectedPaths: z.array(evidencePathSchema).readonly(),
    graphAdvantageExpected: z.boolean(),
  })
  .superRefine((value, context) => {
    if (
      value.category === "negative-control" &&
      (value.graphAdvantageExpected || value.expectedPaths.length > 0)
    )
      context.addIssue({
        code: "custom",
        message: "Negative controls cannot declare an expected graph path.",
        path: ["graphAdvantageExpected"],
      });
    if (
      value.category !== "negative-control" &&
      (!value.graphAdvantageExpected || value.expectedPaths.length === 0)
    )
      context.addIssue({
        code: "custom",
        message: "Structural tasks require graph-path ground truth.",
        path: ["expectedPaths"],
      });
  })
  .readonly();

export type M3aTask = z.infer<typeof m3aTaskSchema>;

const observedAt = "2026-07-01T00:00:00.000Z";

export const M3A_REFERENCE_GRAPH = evidenceGraphSchema.parse({
  id: "m3a-reference-evidence",
  version: "1",
  citations: [
    {
      id: "cite-rel-1",
      source: "directory",
      locator: "employee/ari",
      observedAt,
    },
    {
      id: "cite-rel-2",
      source: "registry",
      locator: "company/nicia",
      observedAt,
    },
    {
      id: "cite-temp-old",
      source: "release-log",
      locator: "orion/beta",
      observedAt,
    },
    {
      id: "cite-temp-new",
      source: "release-log",
      locator: "orion/stable",
      observedAt,
    },
    {
      id: "cite-con-1",
      source: "sensor-feed",
      locator: "sensor-k/raw",
      observedAt,
    },
    {
      id: "cite-con-2",
      source: "audit",
      locator: "sensor-k/audited",
      observedAt,
    },
    {
      id: "cite-prov-1",
      source: "dispatch",
      locator: "shipment-17",
      observedAt,
    },
    {
      id: "cite-prov-2",
      source: "warehouse",
      locator: "receipt-17",
      observedAt,
    },
    {
      id: "cite-ret-old",
      source: "policy-book",
      locator: "cedar/v1",
      observedAt,
    },
    {
      id: "cite-ret-notice",
      source: "bulletin",
      locator: "cedar/retraction",
      observedAt,
    },
    {
      id: "cite-ret-new",
      source: "policy-book",
      locator: "cedar/v2",
      observedAt,
    },
    {
      id: "cite-neg-owner",
      source: "project-index",
      locator: "lumen",
      observedAt,
    },
    {
      id: "cite-neg-color",
      source: "build-index",
      locator: "quartz",
      observedAt,
    },
  ],
  facts: [
    {
      id: "fact-rel-employer",
      statement: "Ari's employer is Nicia.",
      subject: "Ari",
      predicate: "employer",
      object: "Nicia",
      validFrom: null,
      validUntil: null,
      status: "active",
      citationIds: ["cite-rel-1"],
    },
    {
      id: "fact-rel-headquarters",
      statement: "Nicia's headquarters are in Lisbon.",
      subject: "Nicia",
      predicate: "headquarters",
      object: "Lisbon",
      validFrom: null,
      validUntil: null,
      status: "active",
      citationIds: ["cite-rel-2"],
    },
    {
      id: "fact-temp-beta",
      statement: "Orion had beta release status before March 2026.",
      subject: "Orion",
      predicate: "release-status",
      object: "beta",
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-03-01T00:00:00.000Z",
      status: "active",
      citationIds: ["cite-temp-old"],
    },
    {
      id: "fact-temp-stable",
      statement:
        "Stable replaced beta as Orion's release status in March 2026.",
      subject: "Orion",
      predicate: "release-status",
      object: "stable",
      validFrom: "2026-03-01T00:00:00.000Z",
      validUntil: null,
      status: "active",
      citationIds: ["cite-temp-new"],
    },
    {
      id: "fact-con-high",
      statement: "The raw Sensor K pressure report says high.",
      subject: "Sensor K",
      predicate: "pressure",
      object: "high",
      validFrom: null,
      validUntil: null,
      status: "active",
      citationIds: ["cite-con-1"],
    },
    {
      id: "fact-con-normal",
      statement: "The audited Sensor K pressure report says normal.",
      subject: "Sensor K",
      predicate: "pressure",
      object: "normal",
      validFrom: null,
      validUntil: null,
      status: "active",
      citationIds: ["cite-con-2"],
    },
    {
      id: "fact-prov-dispatch",
      statement: "The dispatch report says shipment 17 arrived.",
      subject: "shipment 17",
      predicate: "arrival",
      object: "arrived",
      validFrom: null,
      validUntil: null,
      status: "active",
      citationIds: ["cite-prov-1"],
    },
    {
      id: "fact-prov-receipt",
      statement: "The warehouse receipt corroborates arrival of shipment 17.",
      subject: "shipment 17",
      predicate: "arrival",
      object: "arrived",
      validFrom: null,
      validUntil: null,
      status: "active",
      citationIds: ["cite-prov-2"],
    },
    {
      id: "fact-ret-old",
      statement: "Cedar policy version one permitted guest export.",
      subject: "Cedar policy",
      predicate: "guest-export",
      object: "permitted",
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-04-01T00:00:00.000Z",
      status: "retracted",
      citationIds: ["cite-ret-old"],
    },
    {
      id: "fact-ret-notice",
      statement:
        "A Cedar retraction notice withdraws the old guest export permission.",
      subject: "Cedar retraction",
      predicate: "withdraws",
      object: "guest-export permission",
      validFrom: "2026-04-01T00:00:00.000Z",
      validUntil: null,
      status: "active",
      citationIds: ["cite-ret-notice"],
    },
    {
      id: "fact-ret-new",
      statement: "Cedar policy version two denies guest export.",
      subject: "Cedar policy",
      predicate: "guest-export",
      object: "denied",
      validFrom: "2026-04-01T00:00:00.000Z",
      validUntil: null,
      status: "active",
      citationIds: ["cite-ret-new"],
    },
    {
      id: "fact-neg-owner",
      statement: "Mira owns Project Lumen.",
      subject: "Project Lumen",
      predicate: "owner",
      object: "Mira",
      validFrom: null,
      validUntil: null,
      status: "active",
      citationIds: ["cite-neg-owner"],
    },
    {
      id: "fact-neg-color",
      statement: "The Quartz build color is blue.",
      subject: "Quartz build",
      predicate: "color",
      object: "blue",
      validFrom: null,
      validUntil: null,
      status: "active",
      citationIds: ["cite-neg-color"],
    },
  ],
  edges: [
    {
      id: "edge-rel-hop",
      fromFactId: "fact-rel-employer",
      toFactId: "fact-rel-headquarters",
      kind: "related",
    },
    {
      id: "edge-temp-supersedes",
      fromFactId: "fact-temp-beta",
      toFactId: "fact-temp-stable",
      kind: "supersedes",
    },
    {
      id: "edge-con-contradicts",
      fromFactId: "fact-con-high",
      toFactId: "fact-con-normal",
      kind: "contradicts",
    },
    {
      id: "edge-prov-corroborates",
      fromFactId: "fact-prov-dispatch",
      toFactId: "fact-prov-receipt",
      kind: "corroborates",
    },
    {
      id: "edge-ret-retracts",
      fromFactId: "fact-ret-notice",
      toFactId: "fact-ret-old",
      kind: "retracts",
    },
    {
      id: "edge-ret-supersedes",
      fromFactId: "fact-ret-old",
      toFactId: "fact-ret-new",
      kind: "supersedes",
    },
  ],
});

export const M3A_DETERMINISTIC_CORPUS: ReadonlyArray<M3aTask> = z
  .array(m3aTaskSchema)
  .readonly()
  .parse([
    {
      id: "m3a-multi-hop-headquarters",
      category: "multi-hop",
      instruction: "Identify the headquarters city of Ari's employer.",
      query: {
        id: "query-rel-headquarters",
        text: "Ari employer headquarters",
        asOf: null,
        maxFacts: 2,
        maxHops: 1,
      },
      expectedAnswer: "Lisbon",
      expectedFactIds: ["fact-rel-employer", "fact-rel-headquarters"],
      expectedCitationIds: ["cite-rel-1", "cite-rel-2"],
      expectedPaths: [
        {
          factIds: ["fact-rel-employer", "fact-rel-headquarters"],
          edgeIds: ["edge-rel-hop"],
        },
      ],
      graphAdvantageExpected: true,
    },
    {
      id: "m3a-temporal-release",
      category: "temporal",
      instruction:
        "Determine the current Orion release status and its predecessor.",
      query: {
        id: "query-temp-release",
        text: "Orion release status beta replaced current",
        asOf: "2026-07-01T00:00:00.000Z",
        maxFacts: 2,
        maxHops: 1,
      },
      expectedAnswer: "Stable replaced beta.",
      expectedFactIds: ["fact-temp-beta", "fact-temp-stable"],
      expectedCitationIds: ["cite-temp-old", "cite-temp-new"],
      expectedPaths: [
        {
          factIds: ["fact-temp-beta", "fact-temp-stable"],
          edgeIds: ["edge-temp-supersedes"],
        },
      ],
      graphAdvantageExpected: true,
    },
    {
      id: "m3a-contradiction-sensor",
      category: "contradiction",
      instruction: "Identify the contradictory Sensor K pressure reports.",
      query: {
        id: "query-con-sensor",
        text: "Sensor K pressure reports high normal contradiction",
        asOf: null,
        maxFacts: 2,
        maxHops: 1,
      },
      expectedAnswer:
        "The raw report says high; the audited report says normal.",
      expectedFactIds: ["fact-con-high", "fact-con-normal"],
      expectedCitationIds: ["cite-con-1", "cite-con-2"],
      expectedPaths: [
        {
          factIds: ["fact-con-high", "fact-con-normal"],
          edgeIds: ["edge-con-contradicts"],
        },
      ],
      graphAdvantageExpected: true,
    },
    {
      id: "m3a-provenance-shipment",
      category: "provenance",
      instruction:
        "Find independent evidence corroborating shipment 17's arrival.",
      query: {
        id: "query-prov-shipment",
        text: "shipment 17 arrival dispatch corroborates warehouse receipt",
        asOf: null,
        maxFacts: 2,
        maxHops: 1,
      },
      expectedAnswer:
        "The dispatch report is corroborated by the warehouse receipt.",
      expectedFactIds: ["fact-prov-dispatch", "fact-prov-receipt"],
      expectedCitationIds: ["cite-prov-1", "cite-prov-2"],
      expectedPaths: [
        {
          factIds: ["fact-prov-dispatch", "fact-prov-receipt"],
          edgeIds: ["edge-prov-corroborates"],
        },
      ],
      graphAdvantageExpected: true,
    },
    {
      id: "m3a-retraction-policy",
      category: "retraction",
      instruction: "Resolve the retracted Cedar guest-export policy.",
      query: {
        id: "query-ret-policy",
        text: "Cedar retraction old guest export permission current policy",
        asOf: "2026-07-01T00:00:00.000Z",
        maxFacts: 3,
        maxHops: 2,
      },
      expectedAnswer:
        "The old permission was retracted; current policy denies guest export.",
      expectedFactIds: ["fact-ret-notice", "fact-ret-old", "fact-ret-new"],
      expectedCitationIds: ["cite-ret-notice", "cite-ret-old", "cite-ret-new"],
      expectedPaths: [
        {
          factIds: ["fact-ret-notice", "fact-ret-old", "fact-ret-new"],
          edgeIds: ["edge-ret-retracts", "edge-ret-supersedes"],
        },
      ],
      graphAdvantageExpected: true,
    },
    {
      id: "m3a-negative-owner",
      category: "negative-control",
      instruction: "Return the owner of Project Lumen.",
      query: {
        id: "query-neg-owner",
        text: "Project Lumen owner Mira",
        asOf: null,
        maxFacts: 1,
        maxHops: 2,
      },
      expectedAnswer: "Mira",
      expectedFactIds: ["fact-neg-owner"],
      expectedCitationIds: ["cite-neg-owner"],
      expectedPaths: [],
      graphAdvantageExpected: false,
    },
    {
      id: "m3a-negative-color",
      category: "negative-control",
      instruction: "Return the Quartz build color.",
      query: {
        id: "query-neg-color",
        text: "Quartz build color blue",
        asOf: null,
        maxFacts: 1,
        maxHops: 2,
      },
      expectedAnswer: "blue",
      expectedFactIds: ["fact-neg-color"],
      expectedCitationIds: ["cite-neg-color"],
      expectedPaths: [],
      graphAdvantageExpected: false,
    },
  ]);

export const M3A_CORPUS_PROTOCOL = Object.freeze({
  id: "lachesis-m3a-deterministic-evidence-substrate",
  version: "1",
  liveInferenceAuthorized: false,
  typeGraphIntegrated: false,
  comparison:
    "Matched functional IR over text-selected evidence versus graph-selected evidence neighborhoods.",
});
