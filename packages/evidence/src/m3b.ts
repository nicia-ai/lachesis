import {
  compilePlanJson,
  createCatalog,
  defineEffect,
  defineSchema,
  type Diagnostic,
  diagnostic,
  digestValue,
  type ExecutablePlan,
  executePlan,
  inspectExecutablePlan,
  ok,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import { blindM3a1IntegrityAudit } from "./audit.js";
import type { evidenceContextSchema, evidencePathSchema } from "./contract.js";
import {
  evidenceCitationSchema,
  evidenceEdgeSchema,
  evidenceFactSchema,
  type EvidenceNeighborhood,
  type EvidenceSource,
  type EvidenceSourceIdentity,
  evidenceSourceIdentitySchema,
  selectEvidence,
} from "./contract.js";
import {
  type M3aTask,
  type M3bAnswerContract,
  m3bAnswerContractSchema,
} from "./corpus.js";
import {
  createGraphSelectedAdjacencyEvidenceSource,
  createGraphSelectedFactsEvidenceSource,
  createInMemoryGraphEvidenceSource,
} from "./graph.js";
import {
  loadM3bPhaseCases,
  M3B_CORPUS_PROTOCOL,
  M3B_REFERENCE_GRAPH,
} from "./m3b-corpus.js";
import {
  auditM3bWilliamsSchedule,
  createM3bWilliamsSchedule,
  type M3bArm,
  m3bArmSchema,
  type M3bScheduleEntry,
  type M3bWilliamsSchedule,
} from "./m3b-schedule.js";
import {
  evaluateM3bStatistics,
  M3B_CONTRASTS,
  M3B_MULTIPLICITY_POLICY,
  type M3bStatisticalObservation,
  type M3bStatisticalReport,
} from "./m3b-statistics.js";
import { createMatchedTextEvidenceSource } from "./text.js";

export type M3bPhase =
  | "m3b-protocol-probe"
  | "m3b-wire-stress-probe"
  | "m3b-calibration"
  | "m3b-heldout";

const m3bIdentifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const m3bDiagnosticIssueSchema = z
  .strictObject({
    code: z.string().min(1).max(128),
    path: z
      .array(z.union([z.string(), z.number().int().nonnegative()]))
      .readonly(),
    message: z.string().min(1).max(512).optional(),
  })
  .readonly();
export type M3bDiagnosticIssue = z.infer<typeof m3bDiagnosticIssueSchema>;

export const m3bVisiblePathSchema = z
  .strictObject({
    id: m3bIdentifierSchema,
    factIds: z.array(m3bIdentifierSchema).min(1).max(256).readonly(),
    edgeIds: z.array(m3bIdentifierSchema).max(256).readonly(),
  })
  .readonly();

export const m3bOracleEvidenceSchema = z
  .strictObject({
    facts: z.array(evidenceFactSchema).max(64).readonly(),
    citations: z.array(evidenceCitationSchema).max(128).readonly(),
    edges: z.array(evidenceEdgeSchema).max(256).readonly(),
    paths: z.array(m3bVisiblePathSchema).max(256).readonly(),
  })
  .readonly();

/**
 * Provider-portable wire contract. Domain rules (uniqueness, visible
 * references, answer cardinality, and correctness) are deliberately applied
 * only after the response envelope and usage have been made durable.
 */
export const m3bOracleOutputSchema = z
  .strictObject({
    outcome: z.enum(["answered", "insufficient-evidence"]),
    answerValues: z.array(z.string().min(1)).max(128).readonly(),
    supportingFactIds: z.array(z.string().min(1)).max(64).readonly(),
    citationIds: z.array(z.string().min(1)).max(128).readonly(),
    pathIds: z.array(z.string().min(1)).max(256).readonly(),
  })
  .readonly();

const m3bSemanticRepairSchema = z
  .strictObject({
    previousOutput: m3bOracleOutputSchema,
    obligationIssues: z
      .array(m3bDiagnosticIssueSchema)
      .min(1)
      .max(64)
      .readonly(),
  })
  .readonly();

const m3bWireRepairSchema = z
  .strictObject({
    previousRawOutput: z.string().max(65_536),
    decodingIssues: z.array(m3bDiagnosticIssueSchema).min(1).max(64).readonly(),
  })
  .readonly();

export const m3bOracleRequestSchema = z
  .strictObject({
    instruction: z.string().min(1).max(4_000),
    answerContract: m3bAnswerContractSchema,
    evidence: m3bOracleEvidenceSchema,
    wireRepair: m3bWireRepairSchema.nullable().default(null),
    semanticRepair: m3bSemanticRepairSchema.nullable(),
  })
  .readonly();

export type M3bOracleOutput = z.infer<typeof m3bOracleOutputSchema>;
export type M3bOracleRequest = z.infer<typeof m3bOracleRequestSchema>;

export type M3bWireDecodeResult =
  | Readonly<{
      kind: "accepted";
      output: M3bOracleOutput;
      issues: ReadonlyArray<M3bDiagnosticIssue>;
    }>
  | Readonly<{
      kind: "json-parse-failed" | "wire-schema-rejected";
      output: null;
      issues: ReadonlyArray<M3bDiagnosticIssue>;
    }>;

function zodWireIssues(error: z.ZodError): ReadonlyArray<M3bDiagnosticIssue> {
  return error.issues.slice(0, 64).map((issue) => ({
    code: issue.code,
    path: issue.path.flatMap((part) =>
      typeof part === "string" ||
      (typeof part === "number" && Number.isInteger(part) && part >= 0)
        ? [part]
        : [],
    ),
    message: issue.message.slice(0, 512),
  }));
}

export function decodeM3bOracleWire(text: string): M3bWireDecodeResult {
  const json = parseJson(text);
  if (!json.ok)
    return {
      kind: "json-parse-failed",
      output: null,
      issues: [
        {
          code: "invalid-json",
          path: [],
          message: json.error.message.slice(0, 512),
        },
      ],
    };
  const wire = m3bOracleOutputSchema.safeParse(json.value);
  return wire.success
    ? { kind: "accepted", output: wire.data, issues: [] }
    : {
        kind: "wire-schema-rejected",
        output: null,
        issues: zodWireIssues(wire.error),
      };
}

export const M3B_ORACLE_PROMPT = Object.freeze({
  id: "lachesis-m3b-arm-blinded-evidence-oracle",
  version: "4",
  text: [
    "Use only the supplied normalized evidence context to address the public instruction.",
    "Treat answerContract as an executable obligation, not a formatting hint.",
    "Return one strict JSON object with outcome, answerValues, supportingFactIds, citationIds, and pathIds.",
    "Use answered only when the visible supporting facts form a complete derivation satisfying answerContract.",
    "For answered, copy the contract-derived typed values into answerValues and the exact visible derivation facts into supportingFactIds.",
    "Use insufficient-evidence exactly when no complete visible derivation satisfies answerContract; then answerValues and supportingFactIds must both be empty.",
    "Citations must cover every supporting fact. Intermediate entities cannot fill a terminal answer role.",
    "When semanticRepair is non-null, correct only the listed deterministic obligation issues using the same public contract and visible evidence.",
    "When wireRepair is non-null, return a fresh object matching the supplied public output schema; use only the unchanged visible evidence, previous raw output, and decoding issues.",
    "Every citationId and pathId must be copied from the supplied context. Never reconstruct a path.",
    "The evidence source and experimental arm are deliberately undisclosed.",
  ].join("\n"),
});

export const M3B_SCORER_PROTOCOL = Object.freeze({
  id: "m3b-common-semantic-obligation-answer-citation-scorer",
  version: "4",
  commonPrimaryEndpoint:
    "contract-derived-typed-outcome-and-supporting-fact-citations-present",
  insufficientEvidenceRule:
    "no-complete-visible-derivation-satisfies-the-public-answer-contract",
  pathEndpoint: "separate-canonical-path-reference-utilization",
  proseScoring: false,
  semanticRepair: "one-bounded-public-obligation-repair",
  wireRepair: "one-bounded-public-schema-repair-before-semantic-repair",
});

export const M3B_PROTOCOL_PROBE_GATE = Object.freeze({
  id: "m3b-semantic-obligation-protocol-probe-gate",
  version: "4",
  requiredRecords: 48,
  requiredNonOpaqueOutcomes: 48,
  requiredDurableResponseUsageClassifications: 48,
  requiredFinalContractCorrectOutcomes: 48,
  requiredCategories: 6,
  requiredProviders: 2,
  maximumUnauthorizedOrIdentityMismatchedCalls: 0,
});

export const M3B_WIRE_STRESS_PROBE_GATE = Object.freeze({
  id: "m3b-structured-output-forensics-stress-probe-gate",
  version: "1",
  requiredRecords: 96,
  requiredGraphAdjacencyTrialsPerProvider: 24,
  requiredMatchedGraphFactsTrialsPerProvider: 24,
  requiredCategories: Object.freeze(["provenance", "temporal"]),
  requiredPreciseDecodingClassifications: 96,
  maximumSdkRuntimeSchemaDisagreements: 0,
  maximumSelectedAnthropicGraphAdjacencyFirstAttemptWireFailures: 0,
  maximumOpaqueFailures: 0,
  maximumUnauthorizedOrIdentityMismatchedCalls: 0,
});

export const M3B_ORACLE_MODELS = Object.freeze([
  Object.freeze({
    provider: "openai",
    model: "gpt-5.6-terra",
    adapterVersion: "m3b-offline-unbound/4",
    settings: Object.freeze({
      temperature: 0,
      reasoning: "low",
      maxInputTokens: 8_000,
      maxOutputTokens: 2_000,
      sdkRetries: 0,
      structuredOutput: "json-tool",
    }),
  }),
  Object.freeze({
    provider: "anthropic",
    model: "claude-sonnet-5",
    adapterVersion: "m3b-offline-unbound/4",
    settings: Object.freeze({
      temperature: 0,
      reasoning: "adaptive-low",
      maxInputTokens: 8_000,
      maxOutputTokens: 2_000,
      sdkRetries: 0,
      structuredOutput: "json-schema",
    }),
  }),
]);

export const M3B_TRANSPORT_RETRY_POLICY = Object.freeze({
  id: "m3b-symmetric-controller-transport-retry",
  version: "4",
  maximumRetriesAfterInitialAttempt: 1,
  retryableCodes: Object.freeze([
    "provider-overload",
    "provider-timeout",
    "provider-unavailable",
  ]),
  retryPlacement: "within-the-scheduled-arm-slot-before-the-next-arm",
  sdkRetries: 0,
  semanticRepairCallsPerRecord: 1,
  wireRepairCallsPerRecord: 1,
  terminalFailureEstimand: "failure-in-primary-end-to-end",
  conditionalAnalysis: "secondary-only-when-both-paired-outputs-are-valid",
});

export type M3bAttemptType =
  "initial" | "wire-repair" | "semantic-repair" | "transport-retry";

export type M3bProviderAttemptQuota = Readonly<{
  provider: "openai" | "anthropic";
  initial: number;
  wireRepair: number;
  semanticRepair: number;
  transportRetry: number;
  total: number;
}>;

export const M3B4_CALIBRATION_PROVIDER_ATTEMPT_QUOTAS = Object.freeze({
  id: "m3b4-calibration-provider-cohort-attempt-quotas",
  version: "1",
  providers: Object.freeze([
    Object.freeze({
      provider: "anthropic" as const,
      initial: 120,
      wireRepair: 24,
      semanticRepair: 48,
      transportRetry: 48,
      total: 240,
    }),
    Object.freeze({
      provider: "openai" as const,
      initial: 120,
      wireRepair: 24,
      semanticRepair: 48,
      transportRetry: 48,
      total: 240,
    }),
  ]),
  exhaustion: "calibration-incomplete-no-go-before-dispatch",
});

const requestRegistration = defineSchema({
  id: "m3b/oracle-request",
  version: "4",
  description:
    "Arm-blinded instruction, executable answer contract, and normalized evidence context.",
  validator: m3bOracleRequestSchema,
});

const outputRegistration = defineSchema({
  id: "m3b/oracle-output",
  version: "4",
  description:
    "Typed answer outcome with supporting facts, citations, and canonical paths.",
  validator: m3bOracleOutputSchema,
});

const oracleEffect = defineEffect({
  id: "m3b/oracle",
  version: "4",
  description: "Invokes the capability-scoped, arm-blinded evidence oracle.",
  input: requestRegistration,
  output: outputRegistration,
  effectName: "m3b.oracle",
  capability: "model.oracle",
  maxTokens: 2_000,
  maxWallClockMs: 60_000,
  replayable: true,
});

const catalogResult = createCatalog({
  identity: { id: "m3b/oracle-catalog", version: "4" },
  schemas: [requestRegistration.runtime, outputRegistration.runtime],
  operations: [oracleEffect],
});

const M3B_SHARED_PLAN_JSON = JSON.stringify({
  formatVersion: "1",
  catalog: { id: "m3b/oracle-catalog", version: "4" },
  root: "answer",
  nodes: [
    {
      id: "request",
      op: "input",
      inputKey: "request",
      schema: { id: "m3b/oracle-request", version: "4" },
    },
    {
      id: "answer",
      op: "effect",
      source: "request",
      effect: { id: "m3b/oracle", version: "4" },
    },
  ],
  budget: {
    maxEffectCalls: 1,
    maxCollectionItems: 256,
    maxRecursionDepth: 0,
    maxTokens: 2_000,
    maxWallClockMs: 60_000,
    maxParallelism: 1,
  },
  allowedCapabilities: ["model.oracle"],
});

export type M3bSharedPlan = Readonly<{
  executable: ExecutablePlan;
  planHash: string;
  semanticContractHash: string;
  catalogFingerprint: string;
  outputSchemaDigest: string;
  oracleProtocolDigest: string;
  scorerProtocolDigest: string;
}>;

export async function createM3bSharedPlan(): Promise<
  Result<M3bSharedPlan, ReadonlyArray<Diagnostic>>
> {
  if (!catalogResult.ok) return catalogResult;
  const executable = await compilePlanJson(
    M3B_SHARED_PLAN_JSON,
    catalogResult.value,
    {
      allowedCapabilities: ["model.oracle"],
      budget: {
        maxEffectCalls: 1,
        maxCollectionItems: 256,
        maxRecursionDepth: 0,
        maxTokens: 2_000,
        maxWallClockMs: 60_000,
        maxParallelism: 1,
      },
    },
    [{ kind: "requiresEffect", effectName: "m3b.oracle" }],
  );
  if (!executable.ok) return executable;
  const summary = inspectExecutablePlan(executable.value);
  if (summary === undefined)
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_EXECUTABLE_PLAN",
          "M3b shared-plan inspection failed.",
        ),
      ],
    };
  const outputSchemaDigest = await digestValue(
    z.toJSONSchema(m3bOracleOutputSchema),
  );
  const oracleProtocolDigest = await digestValue(M3B_ORACLE_PROMPT);
  const scorerProtocolDigest = await digestValue(M3B_SCORER_PROTOCOL);
  if (!outputSchemaDigest.ok)
    return { ok: false, error: [outputSchemaDigest.error] };
  if (!oracleProtocolDigest.ok)
    return { ok: false, error: [oracleProtocolDigest.error] };
  if (!scorerProtocolDigest.ok)
    return { ok: false, error: [scorerProtocolDigest.error] };
  return {
    ok: true,
    value: {
      executable: executable.value,
      planHash: summary.planHash,
      semanticContractHash: summary.semanticContractHash,
      catalogFingerprint: summary.catalogFingerprint,
      outputSchemaDigest: outputSchemaDigest.value,
      oracleProtocolDigest: oracleProtocolDigest.value,
      scorerProtocolDigest: scorerProtocolDigest.value,
    },
  };
}

type FrozenNeighborhood = Readonly<{
  arm: M3bArm;
  source: EvidenceSourceIdentity;
  neighborhoodDigest: string;
  contextDigest: string;
  neighborhood: EvidenceNeighborhood;
}>;

export type M3bFrozenCase = Readonly<{
  task: M3aTask;
  answerContract: M3bAnswerContract;
  caseDigest: string;
  oraclePromptDigest: string;
  neighborhoods: ReadonlyArray<FrozenNeighborhood>;
}>;

type ManifestCase = Readonly<{
  caseId: string;
  caseDigest: string;
  oraclePromptDigest: string;
  neighborhoods: ReadonlyArray<Omit<FrozenNeighborhood, "neighborhood">>;
}>;

export type M3bManifest = Readonly<{
  formatVersion: "1";
  phase: M3bPhase;
  sourceCommit: string;
  corpusProtocol: typeof M3B_CORPUS_PROTOCOL;
  cases: ReadonlyArray<ManifestCase>;
  providers: ReadonlyArray<M3bOracleIdentity>;
  scheduledArms: ReadonlyArray<M3bArm>;
  repetitions: number;
  initialCalls: number;
  maximumTransportRetries: number;
  maximumCalls: number;
  semanticRepairCalls: number;
  wireRepairCalls: number;
  attemptQuotas: Readonly<{
    id: string;
    version: string;
    providers: ReadonlyArray<M3bProviderAttemptQuota>;
    exhaustion: string;
  }>;
  pool: Readonly<{
    id: "m3b-development" | "m3b-heldout";
    authorizedUsdMicros: number;
    liveExecutionAuthorized: boolean;
  }>;
  sharedPlan: Omit<M3bSharedPlan, "executable">;
  retryPolicy: typeof M3B_TRANSPORT_RETRY_POLICY;
  contrasts: typeof M3B_CONTRASTS;
  multiplicityPolicy: typeof M3B_MULTIPLICITY_POLICY;
  protocolProbeGate:
    typeof M3B_PROTOCOL_PROBE_GATE | typeof M3B_WIRE_STRESS_PROBE_GATE;
  schedule: M3bWilliamsSchedule;
  experimentDigest: string;
}>;

export type M3bMaterializedPhase = Readonly<{
  manifest: M3bManifest;
  cases: ReadonlyArray<M3bFrozenCase>;
  sharedPlan: M3bSharedPlan;
}>;

function sourceMap(): Result<ReadonlyMap<M3bArm, EvidenceSource>, Diagnostic> {
  const constructed = [
    ["lexical-facts", createMatchedTextEvidenceSource(M3B_REFERENCE_GRAPH)],
    [
      "graph-facts",
      createGraphSelectedFactsEvidenceSource(M3B_REFERENCE_GRAPH),
    ],
    [
      "graph-adjacency",
      createGraphSelectedAdjacencyEvidenceSource(M3B_REFERENCE_GRAPH),
    ],
    ["graph-typed", createInMemoryGraphEvidenceSource(M3B_REFERENCE_GRAPH)],
  ] as const;
  const failed = constructed.find((item) => !item[1].ok);
  if (failed !== undefined && !failed[1].ok)
    return {
      ok: false,
      error: diagnostic("INVALID_WIRE_SCHEMA", failed[1].error.message),
    };
  return {
    ok: true,
    value: new Map(
      constructed.flatMap(([arm, source]) =>
        source.ok ? [[arm, source.value] as const] : [],
      ),
    ),
  };
}

async function freezeCase(
  task: M3aTask,
  sources: ReadonlyMap<M3bArm, EvidenceSource>,
  sharedPlan: M3bSharedPlan,
): Promise<Result<M3bFrozenCase, Diagnostic>> {
  const answerContract = task.answerContract;
  const caseDigest = await digestValue({ task, answerContract });
  const oraclePromptDigest = await digestValue({
    prompt: M3B_ORACLE_PROMPT,
    instruction: task.instruction,
    answerContract,
    outputSchemaDigest: sharedPlan.outputSchemaDigest,
    planHash: sharedPlan.planHash,
  });
  if (!caseDigest.ok) return caseDigest;
  if (!oraclePromptDigest.ok) return oraclePromptDigest;
  const neighborhoods: Array<FrozenNeighborhood> = [];
  for (const arm of [
    "lexical-facts",
    "graph-facts",
    "graph-adjacency",
    "graph-typed",
  ] as const) {
    const source = sources.get(arm);
    if (source === undefined)
      return {
        ok: false,
        error: diagnostic("INVALID_WIRE_SCHEMA", `Missing M3b source ${arm}.`),
      };
    const selection = await selectEvidence(source, task.query);
    if (!selection.ok)
      return {
        ok: false,
        error: diagnostic("INVALID_WIRE_SCHEMA", selection.error.message),
      };
    const neighborhoodDigest = await digestValue(selection.value);
    const contextDigest = await digestValue(selection.value.context);
    if (!neighborhoodDigest.ok) return neighborhoodDigest;
    if (!contextDigest.ok) return contextDigest;
    neighborhoods.push({
      arm,
      source: source.identity,
      neighborhoodDigest: neighborhoodDigest.value,
      contextDigest: contextDigest.value,
      neighborhood: selection.value,
    });
  }
  return {
    ok: true,
    value: {
      task,
      answerContract,
      caseDigest: caseDigest.value,
      oraclePromptDigest: oraclePromptDigest.value,
      neighborhoods,
    },
  };
}

export async function materializeM3bPhase(
  input: Readonly<{
    phase: M3bPhase;
    sourceCommit: string;
    providers?: ReadonlyArray<M3bOracleIdentity> | undefined;
  }>,
): Promise<Result<M3bMaterializedPhase, ReadonlyArray<Diagnostic>>> {
  const sharedPlan = await createM3bSharedPlan();
  if (!sharedPlan.ok) return sharedPlan;
  const sources = sourceMap();
  if (!sources.ok) return { ok: false, error: [sources.error] };
  const cases: Array<M3bFrozenCase> = [];
  for (const task of loadM3bPhaseCases(input.phase)) {
    const frozen = await freezeCase(task, sources.value, sharedPlan.value);
    if (!frozen.ok) return { ok: false, error: [frozen.error] };
    cases.push(frozen.value);
  }
  const repetitions =
    input.phase === "m3b-heldout"
      ? 2
      : input.phase === "m3b-wire-stress-probe"
        ? 4
        : 1;
  const scheduledArms: ReadonlyArray<M3bArm> =
    input.phase === "m3b-wire-stress-probe"
      ? ["graph-facts", "graph-adjacency"]
      : ["lexical-facts", "graph-facts", "graph-adjacency", "graph-typed"];
  const providers = Object.freeze([...(input.providers ?? M3B_ORACLE_MODELS)]);
  const schedule = await createM3bWilliamsSchedule({
    cases: cases.map((item) => ({ id: item.task.id, digest: item.caseDigest })),
    providers,
    repetitions,
    ...(scheduledArms.length === 2
      ? {
          arms: ["graph-facts", "graph-adjacency"] as const,
        }
      : {}),
  });
  if (!schedule.ok) return { ok: false, error: [schedule.error] };
  const initialCalls =
    cases.length * scheduledArms.length * providers.length * repetitions;
  const initialCallsPerProvider = initialCalls / providers.length;
  const attemptQuotas =
    input.phase === "m3b-calibration"
      ? M3B4_CALIBRATION_PROVIDER_ATTEMPT_QUOTAS
      : Object.freeze({
          id: "m3b4-phase-provider-cohort-attempt-quotas",
          version: "1",
          providers: Object.freeze(
            providers
              .map((provider) => {
                const wireRepair = initialCallsPerProvider;
                const semanticRepair = initialCallsPerProvider;
                const transportRetry =
                  (initialCallsPerProvider + wireRepair + semanticRepair) *
                  M3B_TRANSPORT_RETRY_POLICY.maximumRetriesAfterInitialAttempt;
                return Object.freeze({
                  provider: provider.provider,
                  initial: initialCallsPerProvider,
                  wireRepair,
                  semanticRepair,
                  transportRetry,
                  total:
                    initialCallsPerProvider +
                    wireRepair +
                    semanticRepair +
                    transportRetry,
                });
              })
              .toSorted((left, right) =>
                left.provider.localeCompare(right.provider),
              ),
          ),
          exhaustion: "phase-incomplete-no-go-before-dispatch",
        });
  const wireRepairCalls = attemptQuotas.providers.reduce(
    (total, provider) => total + provider.wireRepair,
    0,
  );
  const semanticRepairCalls = attemptQuotas.providers.reduce(
    (total, provider) => total + provider.semanticRepair,
    0,
  );
  const maximumTransportRetries = attemptQuotas.providers.reduce(
    (total, provider) => total + provider.transportRetry,
    0,
  );
  const maximumCalls = attemptQuotas.providers.reduce(
    (total, provider) => total + provider.total,
    0,
  );
  const body = {
    formatVersion: "1" as const,
    phase: input.phase,
    sourceCommit: input.sourceCommit,
    corpusProtocol: M3B_CORPUS_PROTOCOL,
    cases: cases.map((item) => ({
      caseId: item.task.id,
      caseDigest: item.caseDigest,
      oraclePromptDigest: item.oraclePromptDigest,
      neighborhoods: item.neighborhoods.map((neighborhood) => ({
        arm: neighborhood.arm,
        source: neighborhood.source,
        neighborhoodDigest: neighborhood.neighborhoodDigest,
        contextDigest: neighborhood.contextDigest,
      })),
    })),
    providers,
    scheduledArms,
    repetitions,
    initialCalls,
    semanticRepairCalls,
    wireRepairCalls,
    maximumTransportRetries,
    maximumCalls,
    attemptQuotas,
    pool: {
      id:
        input.phase === "m3b-heldout"
          ? ("m3b-heldout" as const)
          : ("m3b-development" as const),
      authorizedUsdMicros: 0 as const,
      liveExecutionAuthorized: false as const,
    },
    sharedPlan: {
      planHash: sharedPlan.value.planHash,
      semanticContractHash: sharedPlan.value.semanticContractHash,
      catalogFingerprint: sharedPlan.value.catalogFingerprint,
      outputSchemaDigest: sharedPlan.value.outputSchemaDigest,
      oracleProtocolDigest: sharedPlan.value.oracleProtocolDigest,
      scorerProtocolDigest: sharedPlan.value.scorerProtocolDigest,
    },
    retryPolicy: M3B_TRANSPORT_RETRY_POLICY,
    contrasts: M3B_CONTRASTS,
    multiplicityPolicy: M3B_MULTIPLICITY_POLICY,
    protocolProbeGate:
      input.phase === "m3b-wire-stress-probe"
        ? M3B_WIRE_STRESS_PROBE_GATE
        : M3B_PROTOCOL_PROBE_GATE,
    schedule: schedule.value,
  };
  const experimentDigest = await digestValue(body);
  return experimentDigest.ok
    ? {
        ok: true,
        value: {
          manifest: { ...body, experimentDigest: experimentDigest.value },
          cases,
          sharedPlan: sharedPlan.value,
        },
      }
    : { ok: false, error: [experimentDigest.error] };
}

export async function validateM3bMaterialization(
  materialized: M3bMaterializedPhase,
): Promise<Result<void, Diagnostic>> {
  const expected = await materializeM3bPhase({
    phase: materialized.manifest.phase,
    sourceCommit: materialized.manifest.sourceCommit,
    providers: materialized.manifest.providers,
  });
  if (!expected.ok)
    return {
      ok: false,
      error:
        expected.error[0] ??
        diagnostic(
          "INTERNAL_INVARIANT_VIOLATION",
          "M3b expected materialization could not be reconstructed.",
        ),
    };
  const [expectedCasesDigest, actualCasesDigest] = await Promise.all([
    digestValue(expected.value.cases),
    digestValue(materialized.cases),
  ]);
  const executableSummary = inspectExecutablePlan(
    materialized.sharedPlan.executable,
  );
  const { experimentDigest, ...manifestBody } = materialized.manifest;
  const computedExperiment = await digestValue(manifestBody);
  if (!computedExperiment.ok) return computedExperiment;
  const { scheduleDigest, ...scheduleBody } = materialized.manifest.schedule;
  const computedSchedule = await digestValue(scheduleBody);
  if (!computedSchedule.ok) return computedSchedule;
  if (
    !expectedCasesDigest.ok ||
    !actualCasesDigest.ok ||
    expectedCasesDigest.value !== actualCasesDigest.value ||
    executableSummary?.planHash !== materialized.sharedPlan.planHash ||
    executableSummary.semanticContractHash !==
      materialized.sharedPlan.semanticContractHash ||
    executableSummary.catalogFingerprint !==
      materialized.sharedPlan.catalogFingerprint ||
    expected.value.manifest.experimentDigest !== experimentDigest ||
    computedExperiment.value !== experimentDigest ||
    computedSchedule.value !== scheduleDigest ||
    materialized.sharedPlan.planHash !==
      materialized.manifest.sharedPlan.planHash ||
    materialized.sharedPlan.semanticContractHash !==
      materialized.manifest.sharedPlan.semanticContractHash ||
    materialized.sharedPlan.catalogFingerprint !==
      materialized.manifest.sharedPlan.catalogFingerprint ||
    materialized.sharedPlan.outputSchemaDigest !==
      materialized.manifest.sharedPlan.outputSchemaDigest ||
    materialized.sharedPlan.oracleProtocolDigest !==
      materialized.manifest.sharedPlan.oracleProtocolDigest ||
    materialized.sharedPlan.scorerProtocolDigest !==
      materialized.manifest.sharedPlan.scorerProtocolDigest
  )
    return {
      ok: false,
      error: diagnostic(
        "REPLAY_OUTPUT_MISMATCH",
        "M3b manifest, schedule, or shared-plan identity is inconsistent.",
      ),
    };
  for (const frozen of materialized.cases) {
    const reference = materialized.manifest.cases.find(
      (item) => item.caseId === frozen.task.id,
    );
    const caseDigest = await digestValue({
      task: frozen.task,
      answerContract: frozen.answerContract,
    });
    if (
      reference === undefined ||
      !caseDigest.ok ||
      caseDigest.value !== frozen.caseDigest ||
      reference.caseDigest !== frozen.caseDigest ||
      reference.oraclePromptDigest !== frozen.oraclePromptDigest
    )
      return {
        ok: false,
        error: diagnostic(
          "REPLAY_OUTPUT_MISMATCH",
          "M3b frozen case identity is inconsistent.",
        ),
      };
    for (const neighborhood of frozen.neighborhoods) {
      const neighborhoodReference = reference.neighborhoods.find(
        (item) => item.arm === neighborhood.arm,
      );
      const neighborhoodDigest = await digestValue(neighborhood.neighborhood);
      const contextDigest = await digestValue(
        neighborhood.neighborhood.context,
      );
      if (
        neighborhoodReference === undefined ||
        !neighborhoodDigest.ok ||
        !contextDigest.ok ||
        neighborhoodDigest.value !== neighborhood.neighborhoodDigest ||
        contextDigest.value !== neighborhood.contextDigest ||
        neighborhoodReference.neighborhoodDigest !==
          neighborhood.neighborhoodDigest ||
        neighborhoodReference.contextDigest !== neighborhood.contextDigest
      )
        return {
          ok: false,
          error: diagnostic(
            "REPLAY_OUTPUT_MISMATCH",
            "M3b frozen neighborhood identity is inconsistent.",
          ),
        };
    }
  }
  return ok(undefined);
}

export const m3bOracleFailureCodeSchema = z.enum([
  "provider-overload",
  "provider-timeout",
  "provider-unavailable",
  "provider-refusal",
  "budget-rejected",
  "contract-mismatch",
  "json-parse-failed",
  "wire-schema-rejected",
  "sdk-runtime-schema-disagreement",
  "semantic-obligation-failed",
]);
export type M3bOracleFailureCode = z.infer<typeof m3bOracleFailureCodeSchema>;

export const m3bOracleUsageSchema = z
  .strictObject({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costUsdMicros: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
  })
  .readonly();
export type M3bOracleUsage = z.infer<typeof m3bOracleUsageSchema>;

export const m3bRawOutputArtifactSchema = z
  .strictObject({
    digest: digestSchema,
    storedSizeBytes: z.number().int().nonnegative().max(65_536),
    originalSizeBytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .readonly();
export type M3bRawOutputArtifact = z.infer<typeof m3bRawOutputArtifactSchema>;

export type M3bRawOutputWriter = (
  input: Readonly<{
    recordKey: string;
    attemptIndex: number;
    text: string;
  }>,
) => Promise<Result<M3bRawOutputArtifact, Diagnostic>>;

export type M3bRawOutputReader = (
  artifact: M3bRawOutputArtifact,
) => Promise<Result<string, Diagnostic>>;

export const m3bAttemptProvenanceSchema = z
  .strictObject({
    stage: z.enum([
      "pre-dispatch",
      "transport",
      "provider-response",
      "wire-decoding",
      "semantic-validation",
    ]),
    category: z.string().min(1).max(128),
    providerStatusCode: z.number().int().min(100).max(599).nullable(),
    providerErrorCode: z.string().min(1).max(128).nullable(),
    providerResponseId: z.string().min(1).max(512).nullable(),
    finishReason: z.string().min(1).max(128).nullable(),
    rawFinishReason: z.string().min(1).max(128).nullable(),
    usageAvailable: z.boolean(),
    outputPresent: z.boolean(),
    outputDigest: digestSchema.nullable(),
    outputSizeBytes: z.number().int().nonnegative().nullable(),
    outputTruncated: z.boolean(),
    issues: z.array(m3bDiagnosticIssueSchema).max(64).readonly(),
    errorClass: z.string().min(1).max(128).nullable().optional(),
    causeClass: z.string().min(1).max(128).nullable().optional(),
    sanitizedMessage: z.string().min(1).max(512).nullable().optional(),
    rawOutputArtifact: m3bRawOutputArtifactSchema.nullable().optional(),
    jsonParseResult: z.enum(["not-attempted", "passed", "failed"]).optional(),
    wireSchemaResult: z.enum(["not-attempted", "passed", "failed"]).optional(),
  })
  .readonly();
export type M3bAttemptProvenance = z.infer<typeof m3bAttemptProvenanceSchema>;

export const m3bOracleAttemptSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("success"),
      output: m3bOracleOutputSchema,
      usage: m3bOracleUsageSchema,
      provenance: m3bAttemptProvenanceSchema,
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("failure"),
      code: m3bOracleFailureCodeSchema,
      dispatchEvidence: z.enum([
        "not-dispatched",
        "dispatched-with-usage",
        "dispatched-usage-unknown",
      ]),
      usage: m3bOracleUsageSchema.nullable(),
      latencyMs: z.number().int().nonnegative().optional(),
      provenance: m3bAttemptProvenanceSchema,
    })
    .readonly(),
]);
export type M3bOracleAttempt = z.infer<typeof m3bOracleAttemptSchema>;

export const m3bOracleIdentitySchema = z
  .strictObject({
    provider: z.enum(["openai", "anthropic"]),
    model: z.string().min(1),
    adapterVersion: z.string().min(1),
    settings: z
      .strictObject({
        temperature: z.number().nullable(),
        reasoning: z.enum(["low", "adaptive-low"]),
        maxInputTokens: z.number().int().positive(),
        maxOutputTokens: z.number().int().positive(),
        sdkRetries: z.number().int().nonnegative(),
        structuredOutput: z.enum(["json-schema", "json-tool"]),
      })
      .readonly(),
  })
  .readonly();
export type M3bOracleIdentity = z.infer<typeof m3bOracleIdentitySchema>;

export type M3bOracleDispatchContext = Readonly<{
  recordKey: string;
  attemptIndex: number;
  invocation: "initial" | "wire-repair" | "semantic-repair";
  transportRetryIndex: number;
  attemptType: M3bAttemptType;
}>;

export const m3bExecutionBindingSchema = z
  .strictObject({
    experimentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    phaseManifestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    pricingSnapshotDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    providerBindings: z
      .array(
        z
          .strictObject({
            provider: z.enum(["openai", "anthropic"]),
            transportDigest: z.string().regex(/^[a-f0-9]{64}$/u),
            pricingEntryDigest: z.string().regex(/^[a-f0-9]{64}$/u),
          })
          .readonly(),
      )
      .length(2)
      .readonly(),
  })
  .readonly();
export type M3bExecutionBinding = z.infer<typeof m3bExecutionBindingSchema>;

export type M3bOracle = Readonly<{
  identity: M3bOracleIdentity;
  generate: (
    request: M3bOracleRequest,
    context: M3bOracleDispatchContext,
  ) => Promise<M3bOracleAttempt>;
}>;

export type DeterministicM3bOracle = M3bOracle &
  Readonly<{ requests: () => ReadonlyArray<M3bOracleRequest> }>;

/** Zero-network fixture oracle for protocol, schedule, retry, and resume tests. */
export function createDeterministicM3bOracle(
  identity: M3bOracle["identity"],
): DeterministicM3bOracle {
  const requests: Array<M3bOracleRequest> = [];
  return {
    identity,
    requests: () => [...requests],
    generate: (request) => {
      requests.push(request);
      return Promise.resolve({
        kind: "success",
        output: createM3bContractOutput(request),
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          costUsdMicros: 0,
          latencyMs: 1,
        },
        provenance: {
          stage: "wire-decoding",
          category: "accepted",
          providerStatusCode: null,
          providerErrorCode: null,
          providerResponseId: "deterministic-fixture",
          finishReason: "stop",
          rawFinishReason: null,
          usageAvailable: true,
          outputPresent: true,
          outputDigest: null,
          outputSizeBytes: null,
          outputTruncated: false,
          issues: [],
        },
      });
    },
  };
}

export const m3bRecordSchema = z
  .strictObject({
    key: z.string().min(1),
    experimentDigest: digestSchema,
    scheduleDigest: digestSchema,
    unitDigest: digestSchema,
    executionPosition: z.number().int().min(0).max(3),
    predecessorArm: m3bArmSchema.nullable(),
    caseId: z.string().min(1),
    caseDigest: digestSchema,
    provider: z.string().min(1),
    model: z.string().min(1),
    modelIdentityDigest: digestSchema,
    repetition: z.number().int().nonnegative(),
    arm: m3bArmSchema,
    source: evidenceSourceIdentitySchema,
    neighborhoodDigest: digestSchema,
    contextDigest: digestSchema,
    planHash: digestSchema,
    oraclePromptDigest: digestSchema,
    outputSchemaDigest: digestSchema,
    executionBinding: m3bExecutionBindingSchema.nullable(),
    attempts: z.array(m3bOracleAttemptSchema).min(1).max(6).readonly(),
    firstAttemptOutput: m3bOracleOutputSchema.nullable(),
    firstAttemptSemanticValidationPassed: z.boolean(),
    firstAttemptSemanticIssues: z
      .array(m3bDiagnosticIssueSchema)
      .max(64)
      .readonly(),
    firstAttemptEndToEndSuccess: z.boolean(),
    firstAttemptConditionalSemanticSuccess: z.boolean().nullable(),
    firstAttemptPathUtilizationSuccess: z.boolean(),
    postWireRepairOutput: m3bOracleOutputSchema.nullable().optional(),
    postWireRepairSuccess: z.boolean().optional(),
    terminalFailure: m3bOracleFailureCodeSchema.nullable(),
    validOutput: z.boolean(),
    output: m3bOracleOutputSchema.nullable(),
    semanticValidationPassed: z.boolean(),
    semanticIssues: z.array(m3bDiagnosticIssueSchema).max(64).readonly(),
    semanticProvenance: m3bAttemptProvenanceSchema.nullable(),
    expectedOutcome: z.enum(["answered", "insufficient-evidence"]),
    answerCorrect: z.boolean(),
    citationsCorrect: z.boolean(),
    relationshipCitationsCorrect: z.boolean(),
    pathsCorrect: z.boolean(),
    pathUtilized: z.boolean(),
    pathUtilizationSuccess: z.boolean(),
    endToEndSuccess: z.boolean(),
    conditionalSemanticSuccess: z.boolean().nullable(),
    semanticRepairCalls: z.union([z.literal(0), z.literal(1)]),
    semanticRepairSucceeded: z.boolean().nullable(),
    wireRepairCalls: z.union([z.literal(0), z.literal(1)]).optional(),
    wireRepairSucceeded: z.boolean().nullable().optional(),
    digest: digestSchema,
  })
  .readonly();
export type M3bRecord = z.infer<typeof m3bRecordSchema>;

export type M3bStore = Readonly<{
  load: (key: string) => Promise<Result<M3bRecord | undefined, Diagnostic>>;
  save: (record: M3bRecord) => Promise<Result<void, Diagnostic>>;
}>;

export function createMemoryM3bStore(): M3bStore &
  Readonly<{
    records: () => ReadonlyArray<M3bRecord>;
  }> {
  const records = new Map<string, M3bRecord>();
  return {
    load: (key) => Promise.resolve(ok(records.get(key))),
    save: (record) => {
      records.set(record.key, record);
      return Promise.resolve(ok(undefined));
    },
    records: () => [...records.values()],
  };
}

function retryable(code: M3bOracleFailureCode): boolean {
  return M3B_TRANSPORT_RETRY_POLICY.retryableCodes.includes(code);
}

function pathKey(path: z.infer<typeof evidencePathSchema>): string {
  return `${path.factIds.join("/")}:${path.edgeIds.join("/")}`;
}

function visiblePathId(index: number): string {
  return `path-${String(index + 1).padStart(3, "0")}`;
}

function visibleEvidence(
  context: z.infer<typeof evidenceContextSchema>,
): z.infer<typeof m3bOracleEvidenceSchema> {
  return m3bOracleEvidenceSchema.parse({
    facts: context.facts,
    citations: context.citations,
    edges: context.edges,
    paths: context.paths.map((path, index) => ({
      id: visiblePathId(index),
      factIds: path.factIds,
      edgeIds: path.edgeIds,
    })),
  });
}

function duplicateIssue(
  values: ReadonlyArray<string>,
  path: string,
): ReadonlyArray<M3bDiagnosticIssue> {
  return new Set(values).size === values.length
    ? []
    : [{ code: "duplicate-reference", path: [path] }];
}

type M3bVisibleDerivation = Readonly<{
  answerValues: ReadonlyArray<string>;
  supportingFactIds: ReadonlyArray<string>;
}>;

function pairwise<T>(values: ReadonlyArray<T>): ReadonlyArray<readonly [T, T]> {
  return values.flatMap((left, leftIndex) =>
    values.slice(leftIndex + 1).map((right) => [left, right] as const),
  );
}

function temporalKey(
  fact: z.infer<typeof evidenceFactSchema>,
  field: "validFrom" | "recordedFrom",
): string {
  return fact[field] ?? fact.recordedFrom;
}

function visibleDerivations(
  request: M3bOracleRequest,
): ReadonlyArray<M3bVisibleDerivation> {
  const facts = request.evidence.facts;
  const contract = request.answerContract;
  switch (contract.role) {
    case "headquarters-city": {
      const employers = facts.filter(
        (fact) =>
          fact.subject === contract.anchorSubject &&
          fact.predicate === contract.requiredFactPredicates[0],
      );
      return employers.flatMap((employer) =>
        facts
          .filter(
            (fact) =>
              fact.subject === employer.object &&
              fact.predicate === contract.requiredFactPredicates[1],
          )
          .map((headquarters) => ({
            answerValues: [headquarters.object],
            supportingFactIds: [employer.id, headquarters.id],
          })),
      );
    }
    case "release-status-change": {
      const statusFacts = facts
        .filter(
          (fact) =>
            fact.subject === contract.anchorSubject &&
            fact.predicate === contract.requiredFactPredicates[0],
        )
        .toSorted((left, right) =>
          temporalKey(left, "validFrom").localeCompare(
            temporalKey(right, "validFrom"),
          ),
        );
      return pairwise(statusFacts).map(([oldStatus, newStatus]) => ({
        answerValues: [oldStatus.object, newStatus.object],
        supportingFactIds: [oldStatus.id, newStatus.id],
      }));
    }
    case "conflicting-readings": {
      const readings = facts.filter(
        (fact) =>
          fact.subject === contract.anchorSubject &&
          fact.predicate === contract.requiredFactPredicates[0],
      );
      return pairwise(readings)
        .filter(([left, right]) => left.object !== right.object)
        .map(([left, right]) => ({
          answerValues: [left.object, right.object].toSorted(),
          supportingFactIds: [left.id, right.id],
        }));
    }
    case "independent-verifier": {
      const arrivals = facts.filter(
        (fact) =>
          fact.subject === contract.anchorSubject &&
          fact.predicate === contract.requiredFactPredicates[0],
      );
      const receipts = facts.filter(
        (fact) => fact.predicate === contract.requiredFactPredicates[1],
      );
      return arrivals.flatMap((arrival) =>
        receipts.map((receipt) => ({
          answerValues: [receipt.subject],
          supportingFactIds: [arrival.id, receipt.id],
        })),
      );
    }
    case "retracted-rule-change": {
      const rules = facts
        .filter(
          (fact) =>
            fact.subject === contract.anchorSubject &&
            fact.predicate === contract.requiredFactPredicates[0],
        )
        .toSorted((left, right) =>
          temporalKey(left, "recordedFrom").localeCompare(
            temporalKey(right, "recordedFrom"),
          ),
        );
      const notices = facts.filter(
        (fact) =>
          fact.subject === contract.anchorSubject &&
          fact.predicate === contract.requiredFactPredicates[1],
      );
      return pairwise(rules).flatMap(([oldRule, newRule]) =>
        notices.map((notice) => ({
          answerValues: [oldRule.object, newRule.object],
          supportingFactIds: [oldRule.id, notice.id, newRule.id],
        })),
      );
    }
    case "owner":
      return facts
        .filter(
          (fact) =>
            fact.subject === contract.anchorSubject &&
            fact.predicate === contract.requiredFactPredicates[0],
        )
        .map((fact) => ({
          answerValues: [fact.object],
          supportingFactIds: [fact.id],
        }));
  }
}

/** Deterministic public-contract witness used only by offline audits and tests. */
export function createM3bContractOutput(
  request: M3bOracleRequest,
): M3bOracleOutput {
  const derivation = visibleDerivations(request)[0];
  if (derivation === undefined)
    return {
      outcome: "insufficient-evidence",
      answerValues: [],
      supportingFactIds: [],
      citationIds: [],
      pathIds: [],
    };
  const supportingFacts = new Set(derivation.supportingFactIds);
  return {
    outcome: "answered",
    answerValues: derivation.answerValues,
    supportingFactIds: derivation.supportingFactIds,
    citationIds: [
      ...new Set(
        request.evidence.facts
          .filter((fact) => supportingFacts.has(fact.id))
          .flatMap((fact) => fact.citationIds),
      ),
    ],
    pathIds: request.evidence.paths.map((path) => path.id),
  };
}

function valuesEqual(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
  unordered: boolean,
): boolean {
  const comparableLeft = unordered ? left.toSorted() : left;
  const comparableRight = unordered ? right.toSorted() : right;
  return (
    comparableLeft.length === comparableRight.length &&
    comparableLeft.every((value, index) => value === comparableRight[index])
  );
}

function sameMembers(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  return valuesEqual(left, right, true);
}

/** Domain validation runs only after the provider envelope and usage exist. */
export function validateM3bSemanticOutput(
  request: M3bOracleRequest,
  output: M3bOracleOutput,
): ReadonlyArray<M3bDiagnosticIssue> {
  const issues: Array<M3bDiagnosticIssue> = [
    ...duplicateIssue(output.citationIds, "citationIds"),
    ...duplicateIssue(output.pathIds, "pathIds"),
    ...duplicateIssue(output.supportingFactIds, "supportingFactIds"),
  ];
  const visibleCitations = new Set(
    request.evidence.citations.map((citation) => citation.id),
  );
  const visiblePaths = new Set(request.evidence.paths.map((path) => path.id));
  const visibleFacts = new Map(
    request.evidence.facts.map((fact) => [fact.id, fact]),
  );
  const derivations = visibleDerivations(request);
  if (output.citationIds.some((id) => !visibleCitations.has(id)))
    issues.push({ code: "unknown-citation-reference", path: ["citationIds"] });
  if (output.pathIds.some((id) => !visiblePaths.has(id)))
    issues.push({ code: "unknown-path-reference", path: ["pathIds"] });
  if (output.supportingFactIds.some((id) => !visibleFacts.has(id)))
    issues.push({
      code: "unknown-supporting-fact-reference",
      path: ["supportingFactIds"],
    });
  if (
    output.outcome === "insufficient-evidence" &&
    output.answerValues.length !== 0
  )
    issues.push({
      code: "abstention-has-answer-values",
      path: ["answerValues"],
    });
  if (
    output.outcome === "insufficient-evidence" &&
    output.supportingFactIds.length !== 0
  )
    issues.push({
      code: "abstention-has-supporting-facts",
      path: ["supportingFactIds"],
    });
  if (output.outcome === "insufficient-evidence" && derivations.length > 0)
    issues.push({
      code: "abstention-when-complete-derivation-visible",
      path: ["outcome"],
    });
  if (output.outcome === "answered") {
    if (output.answerValues.length !== request.answerContract.cardinality)
      issues.push({
        code: "answer-cardinality-mismatch",
        path: ["answerValues"],
      });
    if (
      request.answerContract.ordering === "unordered" &&
      new Set(output.answerValues).size !== output.answerValues.length
    )
      issues.push({ code: "duplicate-answer-value", path: ["answerValues"] });
    if (derivations.length === 0)
      issues.push({
        code: "answered-without-complete-visible-derivation",
        path: ["outcome"],
      });
    const matchingSupport = derivations.filter((derivation) =>
      sameMembers(derivation.supportingFactIds, output.supportingFactIds),
    );
    if (matchingSupport.length === 0)
      issues.push({
        code: "supporting-facts-do-not-form-required-derivation",
        path: ["supportingFactIds"],
      });
    if (
      !matchingSupport.some((derivation) =>
        valuesEqual(
          derivation.answerValues,
          output.answerValues,
          request.answerContract.ordering === "unordered",
        ),
      )
    )
      issues.push({
        code: "answer-values-not-derived-from-supporting-facts",
        path: ["answerValues"],
      });
    const uncitedSupportingFact = output.supportingFactIds.some((factId) => {
      const fact = visibleFacts.get(factId);
      return (
        fact?.citationIds.some(
          (citationId) => !output.citationIds.includes(citationId),
        ) === true
      );
    });
    if (uncitedSupportingFact)
      issues.push({
        code: "supporting-fact-citation-missing",
        path: ["citationIds"],
      });
  }
  return issues;
}

async function validStoredRecord(
  record: M3bRecord,
  manifest: M3bManifest,
  entry: M3bScheduleEntry,
  position: number,
  arm: M3bArm,
  executionBinding: M3bExecutionBinding | null,
): Promise<boolean> {
  const { digest, ...body } = record;
  const computed = await digestValue(body);
  const modelIdentity = manifest.providers.find(
    (candidate) =>
      candidate.provider === record.provider &&
      candidate.model === record.model,
  );
  const benchmarkCase = manifest.cases.find(
    (candidate) => candidate.caseId === entry.caseId,
  );
  const neighborhood = benchmarkCase?.neighborhoods.find(
    (candidate) => candidate.arm === arm,
  );
  if (
    modelIdentity === undefined ||
    benchmarkCase === undefined ||
    neighborhood === undefined
  )
    return false;
  const [
    modelIdentityDigest,
    expectedSourceDigest,
    actualSourceDigest,
    expectedExecutionBindingDigest,
    actualExecutionBindingDigest,
  ] = await Promise.all([
    digestValue(modelIdentity),
    digestValue(neighborhood.source),
    digestValue(record.source),
    digestValue(executionBinding),
    digestValue(record.executionBinding),
  ]);
  return (
    computed.ok &&
    computed.value === digest &&
    modelIdentityDigest.ok &&
    record.modelIdentityDigest === modelIdentityDigest.value &&
    expectedSourceDigest.ok &&
    actualSourceDigest.ok &&
    expectedSourceDigest.value === actualSourceDigest.value &&
    expectedExecutionBindingDigest.ok &&
    actualExecutionBindingDigest.ok &&
    expectedExecutionBindingDigest.value ===
      actualExecutionBindingDigest.value &&
    record.experimentDigest === manifest.experimentDigest &&
    record.scheduleDigest === manifest.schedule.scheduleDigest &&
    record.key === recordKey(manifest, entry, arm, executionBinding) &&
    record.unitDigest === entry.unitDigest &&
    record.executionPosition === position &&
    record.predecessorArm ===
      (position === 0 ? null : (entry.order[position - 1] ?? null)) &&
    record.caseId === entry.caseId &&
    record.caseDigest === entry.caseDigest &&
    record.provider === entry.provider &&
    record.model === entry.model &&
    record.repetition === entry.repetition &&
    record.arm === arm &&
    record.neighborhoodDigest === neighborhood.neighborhoodDigest &&
    record.contextDigest === neighborhood.contextDigest &&
    record.planHash === manifest.sharedPlan.planHash &&
    record.oraclePromptDigest === benchmarkCase.oraclePromptDigest &&
    record.outputSchemaDigest === manifest.sharedPlan.outputSchemaDigest
  );
}

function recordKey(
  manifest: M3bManifest,
  entry: M3bScheduleEntry,
  arm: M3bArm,
  executionBinding: M3bExecutionBinding | null,
): string {
  return `${executionBinding?.experimentDigest ?? manifest.experimentDigest}/${entry.unitDigest}/${arm}`;
}

function modelVisibleRequest(
  frozen: M3bFrozenCase,
  neighborhood: FrozenNeighborhood,
): M3bOracleRequest {
  return m3bOracleRequestSchema.parse({
    instruction: frozen.task.instruction,
    answerContract: frozen.answerContract,
    evidence: visibleEvidence(neighborhood.neighborhood.context),
    wireRepair: null,
    semanticRepair: null,
  });
}

async function executeRecord(
  input: Readonly<{
    materialized: M3bMaterializedPhase;
    entry: M3bScheduleEntry;
    position: number;
    arm: M3bArm;
    oracle: M3bOracle;
    executionBinding: M3bExecutionBinding | null;
    rawOutputReader?: M3bRawOutputReader | undefined;
  }>,
): Promise<Result<M3bRecord, Diagnostic>> {
  const frozen = input.materialized.cases.find(
    (item) => item.task.id === input.entry.caseId,
  );
  const neighborhood = frozen?.neighborhoods.find(
    (item) => item.arm === input.arm,
  );
  if (frozen === undefined || neighborhood === undefined)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M3b schedule references a missing frozen case or neighborhood.",
      ),
    };
  const request = modelVisibleRequest(frozen, neighborhood);
  const modelIdentityDigest = await digestValue(input.oracle.identity);
  if (!modelIdentityDigest.ok) return modelIdentityDigest;
  const persistentRecordKey = recordKey(
    input.materialized.manifest,
    input.entry,
    input.arm,
    input.executionBinding,
  );
  const dispatchRecordKey = await digestValue({
    recordKey: persistentRecordKey,
  });
  if (!dispatchRecordKey.ok) return dispatchRecordKey;
  const attempts: Array<M3bOracleAttempt> = [];
  let terminalFailure: M3bOracleFailureCode | null = null;
  const invoke = async (
    oracleRequest: M3bOracleRequest,
    invocation: "initial" | "wire-repair" | "semantic-repair",
  ): Promise<M3bOracleOutput | null> => {
    const execution = await executePlan(
      input.materialized.sharedPlan.executable,
      {
        inputs: new Map([["request", oracleRequest]]),
        effectHandler: async () => {
          for (
            let retryIndex = 0;
            retryIndex <=
            M3B_TRANSPORT_RETRY_POLICY.maximumRetriesAfterInitialAttempt;
            retryIndex += 1
          ) {
            const attemptIndex = attempts.length;
            const attemptType: M3bAttemptType =
              retryIndex > 0 ? "transport-retry" : invocation;
            const attempt = await input.oracle.generate(oracleRequest, {
              recordKey: dispatchRecordKey.value,
              attemptIndex,
              invocation,
              transportRetryIndex: retryIndex,
              attemptType,
            });
            attempts.push(attempt);
            if (attempt.kind === "success") {
              terminalFailure = null;
              return ok({
                value: attempt.output,
                replayResultId: `${input.entry.unitDigest}:${input.arm}:${invocation}:${retryIndex}`,
                usage: {
                  tokens: attempt.usage.outputTokens,
                  wallClockMs: attempt.usage.latencyMs,
                },
              });
            }
            terminalFailure = attempt.code;
            if (!retryable(attempt.code)) break;
          }
          return {
            ok: false,
            error: diagnostic(
              "INTERNAL_INVARIANT_VIOLATION",
              "The M3b oracle reached a terminal transport failure.",
            ),
          };
        },
        clock: { now: () => "2026-01-01T00:00:00.000Z" },
        runIdProvider: {
          next: () => `${input.entry.unitDigest}:${input.arm}:${invocation}`,
        },
      },
    );
    const parsed = execution.ok
      ? m3bOracleOutputSchema.safeParse(execution.value.output)
      : { success: false as const };
    return parsed.success ? parsed.data : null;
  };

  const firstAttemptOutput = await invoke(request, "initial");
  const firstAttemptSemanticIssues =
    firstAttemptOutput === null
      ? []
      : validateM3bSemanticOutput(request, firstAttemptOutput);
  const firstAttemptSemanticValidationPassed =
    firstAttemptOutput !== null && firstAttemptSemanticIssues.length === 0;
  let wireRepairCalls: 0 | 1 = 0;
  let wireRepairSucceeded: boolean | null = null;
  let postWireRepairOutput: M3bOracleOutput | null = null;
  const firstFailure = attempts.findLast(
    (attempt) => attempt.kind === "failure",
  );
  if (
    firstAttemptOutput === null &&
    firstFailure?.kind === "failure" &&
    (firstFailure.code === "json-parse-failed" ||
      firstFailure.code === "wire-schema-rejected") &&
    firstFailure.provenance.rawOutputArtifact !== undefined &&
    firstFailure.provenance.rawOutputArtifact !== null &&
    input.rawOutputReader !== undefined
  ) {
    const raw = await input.rawOutputReader(
      firstFailure.provenance.rawOutputArtifact,
    );
    if (!raw.ok) return raw;
    wireRepairCalls = 1;
    const wireRepairRequest = m3bOracleRequestSchema.parse({
      ...request,
      wireRepair: {
        previousRawOutput: raw.value,
        decodingIssues:
          firstFailure.provenance.issues.length === 0
            ? [
                {
                  code: firstFailure.code,
                  path: [],
                  message: "The prior output failed staged wire decoding.",
                },
              ]
            : firstFailure.provenance.issues,
      },
      semanticRepair: null,
    });
    postWireRepairOutput = await invoke(wireRepairRequest, "wire-repair");
    wireRepairSucceeded = postWireRepairOutput !== null;
  }
  let semanticRepairCalls: 0 | 1 = 0;
  let semanticRepairSucceeded: boolean | null = null;
  let finalRequest = request;
  let output =
    wireRepairCalls === 1 ? postWireRepairOutput : firstAttemptOutput;
  const preSemanticRepairIssues =
    output === null ? [] : validateM3bSemanticOutput(request, output);
  if (output !== null && preSemanticRepairIssues.length > 0) {
    semanticRepairCalls = 1;
    finalRequest = m3bOracleRequestSchema.parse({
      ...request,
      wireRepair: null,
      semanticRepair: {
        previousOutput: output,
        obligationIssues: preSemanticRepairIssues,
      },
    });
    output = await invoke(finalRequest, "semantic-repair");
  }
  const semanticIssues =
    output === null ? [] : validateM3bSemanticOutput(finalRequest, output);
  const semanticValidationPassed =
    output !== null && semanticIssues.length === 0;
  if (semanticRepairCalls === 1)
    semanticRepairSucceeded = semanticValidationPassed;
  const successfulAttempt = attempts.findLast(
    (attempt) => attempt.kind === "success",
  );
  const semanticProvenance =
    output !== null && !semanticValidationPassed
      ? {
          ...(successfulAttempt?.provenance ?? {
            providerStatusCode: null,
            providerErrorCode: null,
            providerResponseId: null,
            finishReason: null,
            rawFinishReason: null,
            usageAvailable: successfulAttempt !== undefined,
            outputPresent: true,
            outputDigest: null,
            outputSizeBytes: null,
            outputTruncated: false,
          }),
          stage: "semantic-validation" as const,
          category: "semantic-obligation-failed",
          issues: semanticIssues,
        }
      : null;
  const visibleCitationIds = new Set(
    request.evidence.citations.map((citation) => citation.id),
  );
  const expectedCitationIds = new Set(frozen.task.expectedCitationIds);
  const expectedOutcome =
    visibleDerivations(request).length > 0
      ? ("answered" as const)
      : ("insufficient-evidence" as const);
  const citationsMatch = (
    candidate: M3bOracleOutput | null,
    semanticValid: boolean,
  ): boolean =>
    semanticValid &&
    candidate !== null &&
    candidate.citationIds.every((id) => visibleCitationIds.has(id)) &&
    (expectedOutcome === "insufficient-evidence" ||
      [...expectedCitationIds].every((id) =>
        candidate.citationIds.includes(id),
      ));
  const typedAnswerMatches = (
    candidate: M3bOracleOutput | null,
    semanticValid: boolean,
  ): boolean =>
    semanticValid &&
    candidate !== null &&
    candidate.outcome === expectedOutcome &&
    (expectedOutcome === "insufficient-evidence"
      ? candidate.answerValues.length === 0
      : valuesEqual(
          candidate.answerValues,
          frozen.task.expectedAnswerValues,
          frozen.answerContract.ordering === "unordered",
        ));
  const citationsCorrect = citationsMatch(output, semanticValidationPassed);
  const expectedVisibleRelationshipCitationIds =
    frozen.task.expectedEdgeCitationIds.filter((citationId) =>
      visibleCitationIds.has(citationId),
    );
  const relationshipCitationsCorrect =
    semanticValidationPassed &&
    output !== null &&
    expectedVisibleRelationshipCitationIds.every((citationId) =>
      output.citationIds.includes(citationId),
    );
  const firstAttemptRelationshipCitationsCorrect =
    firstAttemptSemanticValidationPassed &&
    expectedVisibleRelationshipCitationIds.every((citationId) =>
      firstAttemptOutput.citationIds.includes(citationId),
    );
  const pathIdsByKey = new Map(
    neighborhood.neighborhood.context.paths.map((path, index) => [
      pathKey(path),
      visiblePathId(index),
    ]),
  );
  const visiblePathIds = new Set(pathIdsByKey.values());
  const expectedVisiblePathIds = frozen.task.expectedPaths.flatMap((path) => {
    const id = pathIdsByKey.get(pathKey(path));
    return id === undefined ? [] : [id];
  });
  const pathsCorrect =
    semanticValidationPassed &&
    output !== null &&
    output.pathIds.every((id) => visiblePathIds.has(id)) &&
    expectedVisiblePathIds.every((id) => output.pathIds.includes(id));
  const firstAttemptPathsCorrect =
    firstAttemptSemanticValidationPassed &&
    firstAttemptOutput.pathIds.every((id) => visiblePathIds.has(id)) &&
    expectedVisiblePathIds.every((id) =>
      firstAttemptOutput.pathIds.includes(id),
    );
  const answerCorrect = typedAnswerMatches(output, semanticValidationPassed);
  const firstAttemptAnswerCorrect = typedAnswerMatches(
    firstAttemptOutput,
    firstAttemptSemanticValidationPassed,
  );
  const firstAttemptCitationsCorrect = citationsMatch(
    firstAttemptOutput,
    firstAttemptSemanticValidationPassed,
  );
  const firstAttemptEndToEndSuccess =
    firstAttemptSemanticValidationPassed &&
    firstAttemptAnswerCorrect &&
    firstAttemptCitationsCorrect;
  const firstAttemptConditionalSemanticSuccess =
    firstAttemptOutput === null || !firstAttemptSemanticValidationPassed
      ? null
      : firstAttemptAnswerCorrect && firstAttemptCitationsCorrect;
  const firstAttemptPathUtilized =
    (firstAttemptOutput?.pathIds.length ?? 0) > 0;
  const firstAttemptPathUtilizationSuccess =
    firstAttemptPathUtilized &&
    firstAttemptPathsCorrect &&
    firstAttemptRelationshipCitationsCorrect;
  const pathUtilized = (output?.pathIds.length ?? 0) > 0;
  const pathUtilizationSuccess =
    pathUtilized && pathsCorrect && relationshipCitationsCorrect;
  const endToEndSuccess =
    semanticValidationPassed && answerCorrect && citationsCorrect;
  const body = {
    key: persistentRecordKey,
    experimentDigest: input.materialized.manifest.experimentDigest,
    scheduleDigest: input.materialized.manifest.schedule.scheduleDigest,
    unitDigest: input.entry.unitDigest,
    executionPosition: input.position,
    predecessorArm:
      input.position === 0
        ? null
        : (input.entry.order[input.position - 1] ?? null),
    caseId: frozen.task.id,
    caseDigest: frozen.caseDigest,
    provider: input.entry.provider,
    model: input.entry.model,
    modelIdentityDigest: modelIdentityDigest.value,
    repetition: input.entry.repetition,
    arm: input.arm,
    source: neighborhood.source,
    neighborhoodDigest: neighborhood.neighborhoodDigest,
    contextDigest: neighborhood.contextDigest,
    planHash: input.materialized.sharedPlan.planHash,
    oraclePromptDigest: frozen.oraclePromptDigest,
    outputSchemaDigest: input.materialized.sharedPlan.outputSchemaDigest,
    executionBinding: input.executionBinding,
    attempts,
    firstAttemptOutput,
    firstAttemptSemanticValidationPassed,
    firstAttemptSemanticIssues,
    firstAttemptEndToEndSuccess,
    firstAttemptConditionalSemanticSuccess,
    firstAttemptPathUtilizationSuccess,
    postWireRepairOutput,
    postWireRepairSuccess:
      wireRepairCalls === 1 && postWireRepairOutput !== null,
    terminalFailure,
    validOutput: output !== null,
    output,
    semanticValidationPassed,
    semanticIssues,
    semanticProvenance,
    expectedOutcome,
    answerCorrect,
    citationsCorrect,
    relationshipCitationsCorrect,
    pathsCorrect,
    pathUtilized,
    pathUtilizationSuccess,
    endToEndSuccess,
    conditionalSemanticSuccess:
      output === null || !semanticValidationPassed
        ? null
        : answerCorrect && citationsCorrect,
    semanticRepairCalls,
    semanticRepairSucceeded,
    wireRepairCalls,
    wireRepairSucceeded,
  };
  const digest = await digestValue(body);
  return digest.ok
    ? { ok: true, value: { ...body, digest: digest.value } }
    : digest;
}

export type M3bRunResult = Readonly<{
  records: ReadonlyArray<M3bRecord>;
  dispatched: number;
  resumed: number;
  transportRetries: number;
  semanticRepairs: number;
  wireRepairs: number;
  statistics: M3bStatisticalReport;
}>;

export async function runM3bWithOracles(
  input: Readonly<{
    materialized: M3bMaterializedPhase;
    oracles: ReadonlyArray<M3bOracle>;
    store: M3bStore;
    rawOutputReader?: M3bRawOutputReader | undefined;
    executionBinding?: M3bExecutionBinding | undefined;
  }>,
): Promise<Result<M3bRunResult, Diagnostic>> {
  const validated = await validateM3bMaterialization(input.materialized);
  if (!validated.ok) return validated;
  if (input.materialized.manifest.pool.liveExecutionAuthorized)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Offline M3b infrastructure cannot accept a live-authorized manifest.",
      ),
    };
  for (const expectedIdentity of input.materialized.manifest.providers) {
    const oracle = input.oracles.find(
      (candidate) =>
        candidate.identity.provider === expectedIdentity.provider &&
        candidate.identity.model === expectedIdentity.model,
    );
    if (oracle === undefined)
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          "A manifest-bound M3b oracle is missing.",
        ),
      };
    const [expectedDigest, actualDigest] = await Promise.all([
      digestValue(expectedIdentity),
      digestValue(oracle.identity),
    ]);
    if (
      !expectedDigest.ok ||
      !actualDigest.ok ||
      expectedDigest.value !== actualDigest.value
    )
      return {
        ok: false,
        error: diagnostic(
          "REPLAY_OUTPUT_MISMATCH",
          "An M3b oracle identity differs from the frozen manifest.",
        ),
      };
  }
  const records: Array<M3bRecord> = [];
  let dispatched = 0;
  let resumed = 0;
  for (const entry of input.materialized.manifest.schedule.entries) {
    const oracle = input.oracles.find(
      (item) =>
        item.identity.provider === entry.provider &&
        item.identity.model === entry.model,
    );
    if (oracle === undefined)
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          "A scheduled M3b oracle is missing.",
        ),
      };
    for (const [position, arm] of entry.order.entries()) {
      const key = recordKey(
        input.materialized.manifest,
        entry,
        arm,
        input.executionBinding ?? null,
      );
      const stored = await input.store.load(key);
      if (!stored.ok) return stored;
      if (stored.value !== undefined) {
        if (
          !(await validStoredRecord(
            stored.value,
            input.materialized.manifest,
            entry,
            position,
            arm,
            input.executionBinding ?? null,
          ))
        )
          return {
            ok: false,
            error: diagnostic(
              "REPLAY_OUTPUT_MISMATCH",
              "Stored M3b record failed digest-bound resume validation.",
            ),
          };
        records.push(stored.value);
        resumed += 1;
        continue;
      }
      const record = await executeRecord({
        materialized: input.materialized,
        entry,
        position,
        arm,
        oracle,
        executionBinding: input.executionBinding ?? null,
        ...(input.rawOutputReader === undefined
          ? {}
          : { rawOutputReader: input.rawOutputReader }),
      });
      if (!record.ok) return record;
      if (record.value.terminalFailure === "budget-rejected")
        return {
          ok: false,
          error: diagnostic(
            "BUDGET_EXCEEDED",
            "M3b controller rejected the complete request reservation before dispatch.",
          ),
        };
      const saved = await input.store.save(record.value);
      if (!saved.ok) return saved;
      records.push(record.value);
      dispatched += 1;
    }
  }
  const observations: ReadonlyArray<M3bStatisticalObservation> = records.map(
    (record) => {
      const task = input.materialized.cases.find(
        (item) => item.task.id === record.caseId,
      )?.task;
      return {
        caseId: record.caseId,
        provider: record.provider,
        model: record.model,
        repetition: record.repetition,
        arm: record.arm,
        retrievalAdvantageExpected: task?.retrievalAdvantageExpected ?? false,
        relationshipEncodingExpected:
          task?.relationshipEncodingExpected ?? false,
        negativeControl: task?.category === "negative-control",
        validOutput: record.firstAttemptOutput !== null,
        endToEndSuccess: record.firstAttemptEndToEndSuccess,
        conditionalSemanticSuccess:
          record.firstAttemptConditionalSemanticSuccess,
        pathUtilizationSuccess: record.firstAttemptPathUtilizationSuccess,
        safetyViolation: record.attempts.some(
          (attempt) =>
            attempt.kind === "failure" &&
            (attempt.code === "budget-rejected" ||
              attempt.code === "contract-mismatch"),
        ),
      };
    },
  );
  const expectedStrata = input.materialized.manifest.providers.flatMap(
    (provider) =>
      Array.from(
        { length: input.materialized.manifest.repetitions },
        (_, repetition) => ({
          provider: provider.provider,
          model: provider.model,
          repetition,
        }),
      ),
  );
  return {
    ok: true,
    value: {
      records,
      dispatched,
      resumed,
      semanticRepairs: records.reduce(
        (total, record) => total + record.semanticRepairCalls,
        0,
      ),
      wireRepairs: records.reduce(
        (total, record) => total + (record.wireRepairCalls ?? 0),
        0,
      ),
      transportRetries: records.reduce(
        (total, record) =>
          total +
          Math.max(
            0,
            record.attempts.length -
              1 -
              record.semanticRepairCalls -
              (record.wireRepairCalls ?? 0),
          ),
        0,
      ),
      statistics: evaluateM3bStatistics(observations, expectedStrata),
    },
  };
}

export type M3bBlindAuditCounts = Readonly<{
  phase: M3bPhase;
  cases: number;
  initialCalls: number;
  maximumSemanticRepairs: number;
  maximumWireRepairs: number;
  maximumTransportRetries: number;
  maximumCalls: number;
  frozenNeighborhoods: number;
  queryLeaks: number;
  invalidGroundTruthReferences: number;
  schedulePositionImbalanceMaximum: number;
  schedulePredecessorImbalanceMaximum: number;
  sharedPlanIdentities: number;
  liveExecutionAuthorized: false;
  passed: boolean;
}>;

export function blindAuditM3bMaterialization(
  materialized: M3bMaterializedPhase,
): M3bBlindAuditCounts {
  const corpus = blindM3a1IntegrityAudit(
    M3B_REFERENCE_GRAPH,
    materialized.cases.map((item) => item.task),
  );
  const schedule = auditM3bWilliamsSchedule(materialized.manifest.schedule);
  const sharedPlanIdentities = new Set(
    materialized.cases.map(() => materialized.manifest.sharedPlan.planHash),
  ).size;
  const cases = materialized.cases.length;
  const frozenNeighborhoods = materialized.cases.reduce(
    (total, item) => total + item.neighborhoods.length,
    0,
  );
  const expectedInitialCalls =
    cases *
    materialized.manifest.scheduledArms.length *
    materialized.manifest.providers.length *
    materialized.manifest.repetitions;
  const expectedWireRepairs =
    materialized.manifest.attemptQuotas.providers.reduce(
      (total, provider) => total + provider.wireRepair,
      0,
    );
  const expectedSemanticRepairs =
    materialized.manifest.attemptQuotas.providers.reduce(
      (total, provider) => total + provider.semanticRepair,
      0,
    );
  const expectedTransportRetries =
    materialized.manifest.attemptQuotas.providers.reduce(
      (total, provider) => total + provider.transportRetry,
      0,
    );
  const expectedMaximumCalls =
    materialized.manifest.attemptQuotas.providers.reduce(
      (total, provider) => total + provider.total,
      0,
    );
  return {
    phase: materialized.manifest.phase,
    cases,
    initialCalls: materialized.manifest.initialCalls,
    maximumSemanticRepairs: materialized.manifest.semanticRepairCalls,
    maximumWireRepairs: materialized.manifest.wireRepairCalls,
    maximumTransportRetries: materialized.manifest.maximumTransportRetries,
    maximumCalls: materialized.manifest.maximumCalls,
    frozenNeighborhoods,
    queryLeaks: corpus.answerBearingQueryLeaks,
    invalidGroundTruthReferences: corpus.invalidGroundTruthReferences,
    schedulePositionImbalanceMaximum: schedule.positionImbalanceMaximum,
    schedulePredecessorImbalanceMaximum: schedule.predecessorImbalanceMaximum,
    sharedPlanIdentities,
    liveExecutionAuthorized: false,
    passed:
      corpus.duplicateTaskIds === 0 &&
      corpus.queryInstructionMismatches === 0 &&
      corpus.answerBearingQueryLeaks === 0 &&
      corpus.invalidGroundTruthReferences === 0 &&
      schedule.passed &&
      sharedPlanIdentities === 1 &&
      frozenNeighborhoods === cases * 4 &&
      materialized.manifest.initialCalls === expectedInitialCalls &&
      materialized.manifest.semanticRepairCalls === expectedSemanticRepairs &&
      materialized.manifest.wireRepairCalls === expectedWireRepairs &&
      materialized.manifest.maximumTransportRetries ===
        expectedTransportRetries &&
      materialized.manifest.maximumCalls === expectedMaximumCalls &&
      !materialized.manifest.pool.liveExecutionAuthorized,
  };
}
