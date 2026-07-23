import {
  type Catalog,
  catalogSemanticRolesSchema,
  createCatalog,
  defineEffect,
  defineFixedPointStep,
  defineFunction,
  defineMeasure,
  defineReducer,
  defineSchema,
  type Result,
} from "@nicia-ai/lachesis";
import {
  type OracleAnswer,
  oracleAnswerSchema,
  type OracleRequest,
  oracleRequestSchema,
} from "@nicia-ai/lachesis-runtime";
import { z } from "zod";

export type CatalogVariant =
  | "baseline"
  | "compatible"
  | "declaration-repairable"
  | "genuinely-non-equivalent";

type Failure = Readonly<{ code: string; message: string }>;

function unwrapDiagnostics<T>(
  result: Result<T, ReadonlyArray<Failure>>,
  label: string,
): T {
  if (result.ok) return result.value;
  const first = result.error[0];
  if (first === undefined) throw new Error(`${label}: empty diagnostics`);
  throw new Error(`${label}: ${first.code}: ${first.message}`);
}

const role = {
  request: "northstar.role/incident-decision-request",
  answer: "northstar.role/incident-decision-answer",
  action: "northstar.role/incident-action",
  boolean: "northstar.role/incident-boolean",
  normalize: "northstar.role/normalize-evidence",
  critical: "northstar.role/is-critical-incident",
  escalate: "northstar.role/prepare-escalation",
  review: "northstar.role/prepare-routine-review",
  canonicalAction: "northstar.role/canonical-action",
  priorityAction: "northstar.role/priority-action",
  converge: "northstar.role/converge-evidence",
  evidenceCount: "northstar.role/evidence-count",
  decide: "northstar.role/record-incident-decision",
} as const;

const variantConfig: Readonly<
  Record<
    CatalogVariant,
    Readonly<{
      namespace: string;
      catalogVersion: string;
      registrationVersion: string;
      decisionRoleVersion: string;
      capability: string;
    }>
  >
> = {
  baseline: {
    namespace: "northstar.incident.v1",
    catalogVersion: "1",
    registrationVersion: "1",
    decisionRoleVersion: "1",
    capability: "incident.decision.mock",
  },
  compatible: {
    namespace: "northstar.incident.v2",
    catalogVersion: "2",
    registrationVersion: "2",
    decisionRoleVersion: "1",
    capability: "incident.decision.mock",
  },
  "declaration-repairable": {
    namespace: "northstar.incident.v3",
    catalogVersion: "3",
    registrationVersion: "3",
    decisionRoleVersion: "2",
    capability: "incident.decision.mock",
  },
  "genuinely-non-equivalent": {
    namespace: "northstar.incident.v4",
    catalogVersion: "4",
    registrationVersion: "4",
    decisionRoleVersion: "1",
    capability: "incident.decision.override",
  },
};

export const conformanceRequest: OracleRequest = oracleRequestSchema.parse({
  instruction:
    "Select the registered response action for incident inc-482 from visible evidence.",
  answerContract: {
    role: "evidence-values",
    cardinality: 1,
    ordering: "scalar",
    anchorSubject: "inc-482",
    derivation: "same-subject-fact-set",
    requiredFactPredicates: ["recommended-action"],
    answerSource: "last-object",
    minimumSupportingFacts: 1,
    sufficiencyRule:
      "answer-only-when-a-complete-visible-derivation-exists-otherwise-abstain",
  },
  evidence: {
    facts: [
      {
        id: "fact-inc-482-severity",
        statement: "Incident inc-482 has declared severity SEV-1.",
        subject: "inc-482",
        predicate: "severity",
        object: "SEV-1",
        citationIds: ["citation-inc-482"],
        validFrom: "2026-07-23T00:00:00.000Z",
        validUntil: null,
        recordedFrom: "2026-07-23T00:00:00.000Z",
        recordedUntil: null,
      },
      {
        id: "fact-inc-482-action",
        statement: "Incident inc-482 requires the action page-primary-oncall.",
        subject: "inc-482",
        predicate: "recommended-action",
        object: "page-primary-oncall",
        citationIds: ["citation-inc-482"],
        validFrom: "2026-07-23T00:00:00.000Z",
        validUntil: null,
        recordedFrom: "2026-07-23T00:00:00.000Z",
        recordedUntil: null,
      },
    ],
    citations: [
      {
        id: "citation-inc-482",
        source: "northstar-incident-registry",
        locator: "incidents/inc-482/revision-7",
        observedAt: "2026-07-23T00:00:00.000Z",
      },
    ],
    edges: [],
    paths: [],
  },
  wireRepair: null,
  semanticRepair: null,
});

export const conformanceAnswer: OracleAnswer = oracleAnswerSchema.parse({
  outcome: "answered",
  answerValues: ["page-primary-oncall"],
  supportingFactIds: ["fact-inc-482-action"],
});

export type IncidentCatalog = Readonly<{
  catalog: Catalog;
  variant: CatalogVariant;
  operationCount: number;
  decisionEffectName: string;
  decisionCapability: string;
  references: Readonly<{
    requestSchema: Readonly<{ id: string; version: string }>;
    answerSchema: Readonly<{ id: string; version: string }>;
    actionSchema: Readonly<{ id: string; version: string }>;
    canonicalAction: Readonly<{ id: string; version: string }>;
    normalize: Readonly<{ id: string; version: string }>;
    critical: Readonly<{ id: string; version: string }>;
    escalate: Readonly<{ id: string; version: string }>;
    review: Readonly<{ id: string; version: string }>;
    decide: Readonly<{ id: string; version: string }>;
  }>;
}>;

export function createIncidentCatalog(
  variant: CatalogVariant,
): IncidentCatalog {
  const config = variantConfig[variant];
  const request = defineSchema({
    id: `${config.namespace}/decision-request`,
    version: config.registrationVersion,
    description: "A reduced visible-evidence incident decision request.",
    validator: oracleRequestSchema,
  });
  const answer = defineSchema({
    id: `${config.namespace}/decision-answer`,
    version: config.registrationVersion,
    description: "A reduced incident decision answer with explicit support.",
    validator: oracleAnswerSchema,
  });
  const action = defineSchema({
    id: `${config.namespace}/action`,
    version: config.registrationVersion,
    description: "A registered incident response action identifier.",
    validator: z.string().max(128),
  });
  const boolean = defineSchema({
    id: `${config.namespace}/boolean`,
    version: config.registrationVersion,
    description: "A boolean incident routing decision.",
    validator: z.boolean(),
    semantic: "boolean",
  });
  const normalize = defineFunction({
    id: `${config.namespace}/normalize-evidence`,
    version: config.registrationVersion,
    description: "Canonicalize visible incident facts by stable fact identity.",
    input: request,
    output: request,
    implementation: (value) => value,
  });
  const critical = defineFunction({
    id: `${config.namespace}/is-critical`,
    version: config.registrationVersion,
    description: "Detect an explicitly cited SEV-1 declaration.",
    input: request,
    output: boolean,
    implementation: (value) =>
      value.evidence.facts.some(
        (fact) => fact.predicate === "severity" && fact.object === "SEV-1",
      ),
  });
  const escalate = defineFunction({
    id: `${config.namespace}/prepare-escalation`,
    version: config.registrationVersion,
    description:
      "Attest the escalation route without changing public evidence.",
    input: request,
    output: request,
    implementation: (value) => value,
  });
  const review = defineFunction({
    id: `${config.namespace}/prepare-routine-review`,
    version: config.registrationVersion,
    description:
      "Attest the routine-review route without changing public evidence.",
    input: request,
    output: request,
    implementation: (value) => value,
  });
  const canonicalAction = defineFunction({
    id: `${config.namespace}/canonical-action`,
    version: config.registrationVersion,
    description: "Canonicalize a response action identifier.",
    input: action,
    output: action,
    implementation: (value) => value.trim().toLowerCase(),
  });
  const priorityAction = defineReducer({
    id: `${config.namespace}/priority-action`,
    version: config.registrationVersion,
    description: "Select the lexicographically greatest canonical action.",
    element: action,
    accumulator: action,
    identity: "",
    laws: { associative: true, commutative: true, idempotent: true },
    implementation: (left, right) => (left < right ? right : left),
  });
  const converge = defineFixedPointStep({
    id: `${config.namespace}/converge-evidence`,
    version: config.registrationVersion,
    description: "Remove one trailing fact from a bounded request.",
    state: request,
    implementation: (value) =>
      oracleRequestSchema.parse({
        ...value,
        evidence: {
          ...value.evidence,
          facts: value.evidence.facts.slice(0, -1),
        },
      }),
  });
  const evidenceCount = defineMeasure({
    id: `${config.namespace}/evidence-count`,
    version: config.registrationVersion,
    description: "Count visible incident facts.",
    input: request,
    implementation: (value) => value.evidence.facts.length,
  });
  const decisionEffectName = "northstar.incident.record-decision";
  const decide = defineEffect({
    id: `${config.namespace}/record-decision`,
    version: config.registrationVersion,
    description: "Record one bounded replayable incident decision.",
    input: request,
    output: answer,
    effectName: decisionEffectName,
    capability: config.capability,
    maxTokens: 64,
    maxWallClockMs: 250,
    replayable: true,
    stateChanging: true,
  });
  const semanticRoles = catalogSemanticRolesSchema.parse({
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [
      {
        kind: "schema",
        role: { id: role.request, version: "1" },
        schema: { id: request.id, version: request.version },
        obligations: { mutuallyAcceptsConformanceValues: true },
      },
      {
        kind: "schema",
        role: { id: role.answer, version: "1" },
        schema: { id: answer.id, version: answer.version },
        obligations: { mutuallyAcceptsConformanceValues: true },
      },
      {
        kind: "schema",
        role: { id: role.action, version: "1" },
        schema: { id: action.id, version: action.version },
        obligations: { mutuallyAcceptsConformanceValues: true },
      },
      {
        kind: "schema",
        role: { id: role.boolean, version: "1" },
        schema: { id: boolean.id, version: boolean.version },
        obligations: { mutuallyAcceptsConformanceValues: true },
      },
    ],
    operations: [
      {
        kind: "function",
        role: { id: role.normalize, version: "1" },
        operation: { id: normalize.id, version: normalize.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "function",
        role: { id: role.critical, version: "1" },
        operation: { id: critical.id, version: critical.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "function",
        role: { id: role.escalate, version: "1" },
        operation: { id: escalate.id, version: escalate.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "function",
        role: { id: role.review, version: "1" },
        operation: { id: review.id, version: review.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "function",
        role: { id: role.canonicalAction, version: "1" },
        operation: {
          id: canonicalAction.id,
          version: canonicalAction.version,
        },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "reducer",
        role: { id: role.priorityAction, version: "1" },
        operation: { id: priorityAction.id, version: priorityAction.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
          identity: true,
          associative: true,
          commutative: true,
          idempotent: true,
        },
      },
      {
        kind: "fixedPointStep",
        role: { id: role.converge, version: "1" },
        operation: { id: converge.id, version: converge.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
          sameSchema: true,
        },
      },
      {
        kind: "measure",
        role: { id: role.evidenceCount, version: "1" },
        operation: { id: evidenceCount.id, version: evidenceCount.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
          nonnegativeSafeInteger: true,
        },
      },
      {
        kind: "effect",
        role: { id: role.decide, version: config.decisionRoleVersion },
        operation: { id: decide.id, version: decide.version },
        obligations: {
          sameEffectClass: true,
          sameCapability: true,
          sameReplayability: true,
          sameStateChangeSemantics: true,
          sameResourceBounds: true,
        },
      },
    ],
  });
  const catalog = unwrapDiagnostics(
    createCatalog({
      identity: {
        id: "northstar.incident/catalog",
        version: config.catalogVersion,
      },
      schemas: [
        request.runtime,
        answer.runtime,
        action.runtime,
        boolean.runtime,
      ],
      operations: [
        normalize,
        critical,
        escalate,
        review,
        canonicalAction,
        priorityAction,
        converge,
        evidenceCount,
        decide,
      ],
      semanticRoles,
    }),
    `catalog ${variant}`,
  );
  return {
    catalog,
    variant,
    operationCount: 9,
    decisionEffectName,
    decisionCapability: config.capability,
    references: {
      requestSchema: { id: request.id, version: request.version },
      answerSchema: { id: answer.id, version: answer.version },
      actionSchema: { id: action.id, version: action.version },
      canonicalAction: {
        id: canonicalAction.id,
        version: canonicalAction.version,
      },
      normalize: { id: normalize.id, version: normalize.version },
      critical: { id: critical.id, version: critical.version },
      escalate: { id: escalate.id, version: escalate.version },
      review: { id: review.id, version: review.version },
      decide: { id: decide.id, version: decide.version },
    },
  };
}

export const semanticRoleIds = role;
