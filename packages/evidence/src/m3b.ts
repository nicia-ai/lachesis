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
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import { blindM3a1IntegrityAudit } from "./audit.js";
import {
  evidenceContextSchema,
  type EvidenceNeighborhood,
  evidencePathSchema,
  type EvidenceSource,
  type EvidenceSourceIdentity,
  evidenceSourceIdentitySchema,
  selectEvidence,
} from "./contract.js";
import type { M3aTask } from "./corpus.js";
import {
  createGraphSelectedAdjacencyEvidenceSource,
  createGraphSelectedFactsEvidenceSource,
  createInMemoryGraphEvidenceSource,
} from "./graph.js";
import {
  loadM3bPhaseCases,
  M3B_CORPUS_PROTOCOL,
  M3B_PREREGISTERED_CORPUS,
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

export type M3bPhase = "m3b-protocol-probe" | "m3b-calibration" | "m3b-heldout";

export const m3bOracleOutputSchema = z
  .strictObject({
    answer: z.string().min(1),
    citationIds: z.array(z.string().min(1)).max(128).readonly(),
    paths: z.array(evidencePathSchema).max(256).readonly(),
  })
  .superRefine((value, context) => {
    if (new Set(value.citationIds).size !== value.citationIds.length)
      context.addIssue({
        code: "custom",
        message: "Oracle citations must be unique.",
        path: ["citationIds"],
      });
  })
  .readonly();

export const m3bOracleRequestSchema = z
  .strictObject({
    instruction: z.string().min(1).max(4_000),
    evidence: evidenceContextSchema,
  })
  .readonly();

export type M3bOracleOutput = z.infer<typeof m3bOracleOutputSchema>;
export type M3bOracleRequest = z.infer<typeof m3bOracleRequestSchema>;

export const M3B_ORACLE_PROMPT = Object.freeze({
  id: "lachesis-m3b-arm-blinded-evidence-oracle",
  version: "1",
  text: [
    "Answer the public instruction using only the supplied normalized evidence context.",
    "Return one strict JSON object with answer, citationIds, and paths.",
    "Every citation and path must be supported by the supplied context.",
    "The evidence source and experimental arm are deliberately undisclosed.",
  ].join("\n"),
});

export const M3B_ORACLE_MODELS = Object.freeze([
  Object.freeze({
    provider: "openai",
    model: "gpt-5.6-terra",
    adapterVersion: "m3b-offline-unbound/1",
    settings: Object.freeze({
      temperature: 0,
      reasoning: "low",
      maxInputTokens: 8_000,
      maxOutputTokens: 2_000,
      sdkRetries: 0,
      structuredOutput: "json-schema",
    }),
  }),
  Object.freeze({
    provider: "anthropic",
    model: "claude-sonnet-5",
    adapterVersion: "m3b-offline-unbound/1",
    settings: Object.freeze({
      temperature: 0,
      reasoning: "adaptive-low",
      maxInputTokens: 8_000,
      maxOutputTokens: 2_000,
      sdkRetries: 0,
      structuredOutput: "json-tool",
    }),
  }),
]);

export const M3B_TRANSPORT_RETRY_POLICY = Object.freeze({
  id: "m3b-symmetric-controller-transport-retry",
  version: "1",
  maximumRetriesAfterInitialAttempt: 1,
  retryableCodes: Object.freeze([
    "provider-overload",
    "provider-timeout",
    "provider-unavailable",
  ]),
  retryPlacement: "within-the-scheduled-arm-slot-before-the-next-arm",
  sdkRetries: 0,
  semanticRepairCalls: 0,
  terminalFailureEstimand: "failure-in-primary-end-to-end",
  conditionalAnalysis: "secondary-only-when-both-paired-outputs-are-valid",
});

const requestRegistration = defineSchema({
  id: "m3b/oracle-request",
  version: "1",
  description:
    "Arm-blinded public instruction and normalized evidence context.",
  validator: m3bOracleRequestSchema,
});

const outputRegistration = defineSchema({
  id: "m3b/oracle-output",
  version: "1",
  description: "Structured answer, citations, and evidence paths.",
  validator: m3bOracleOutputSchema,
});

const oracleEffect = defineEffect({
  id: "m3b/oracle",
  version: "1",
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
  identity: { id: "m3b/oracle-catalog", version: "1" },
  schemas: [requestRegistration.runtime, outputRegistration.runtime],
  operations: [oracleEffect],
});

const M3B_SHARED_PLAN_JSON = JSON.stringify({
  formatVersion: "1",
  catalog: { id: "m3b/oracle-catalog", version: "1" },
  root: "answer",
  nodes: [
    {
      id: "request",
      op: "input",
      inputKey: "request",
      schema: { id: "m3b/oracle-request", version: "1" },
    },
    {
      id: "answer",
      op: "effect",
      source: "request",
      effect: { id: "m3b/oracle", version: "1" },
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
  if (!outputSchemaDigest.ok)
    return { ok: false, error: [outputSchemaDigest.error] };
  if (!oracleProtocolDigest.ok)
    return { ok: false, error: [oracleProtocolDigest.error] };
  return {
    ok: true,
    value: {
      executable: executable.value,
      planHash: summary.planHash,
      semanticContractHash: summary.semanticContractHash,
      catalogFingerprint: summary.catalogFingerprint,
      outputSchemaDigest: outputSchemaDigest.value,
      oracleProtocolDigest: oracleProtocolDigest.value,
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
  repetitions: number;
  initialCalls: number;
  maximumTransportRetries: number;
  maximumCalls: number;
  semanticRepairCalls: 0;
  pool: Readonly<{
    id: "m3b-development" | "m3b-heldout";
    authorizedUsdMicros: number;
    liveExecutionAuthorized: boolean;
  }>;
  sharedPlan: Omit<M3bSharedPlan, "executable">;
  retryPolicy: typeof M3B_TRANSPORT_RETRY_POLICY;
  contrasts: typeof M3B_CONTRASTS;
  multiplicityPolicy: typeof M3B_MULTIPLICITY_POLICY;
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
  const caseDigest = await digestValue(task);
  const oraclePromptDigest = await digestValue({
    prompt: M3B_ORACLE_PROMPT,
    instruction: task.instruction,
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
  const repetitions = input.phase === "m3b-heldout" ? 2 : 1;
  const providers = Object.freeze([...(input.providers ?? M3B_ORACLE_MODELS)]);
  const schedule = await createM3bWilliamsSchedule({
    cases: cases.map((item) => ({ id: item.task.id, digest: item.caseDigest })),
    providers,
    repetitions,
  });
  if (!schedule.ok) return { ok: false, error: [schedule.error] };
  const initialCalls = cases.length * 4 * providers.length * repetitions;
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
    repetitions,
    initialCalls,
    maximumTransportRetries:
      initialCalls *
      M3B_TRANSPORT_RETRY_POLICY.maximumRetriesAfterInitialAttempt,
    maximumCalls:
      initialCalls *
      (1 + M3B_TRANSPORT_RETRY_POLICY.maximumRetriesAfterInitialAttempt),
    semanticRepairCalls: 0 as const,
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
    },
    retryPolicy: M3B_TRANSPORT_RETRY_POLICY,
    contrasts: M3B_CONTRASTS,
    multiplicityPolicy: M3B_MULTIPLICITY_POLICY,
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
      materialized.manifest.sharedPlan.oracleProtocolDigest
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
    const caseDigest = await digestValue(frozen.task);
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

export const m3bOracleAttemptSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("success"),
      output: z.unknown(),
      usage: m3bOracleUsageSchema,
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
      const finalFact = request.evidence.facts.at(-1);
      return Promise.resolve({
        kind: "success",
        output: {
          answer: finalFact?.object ?? "unknown",
          citationIds: request.evidence.citations.map(
            (citation) => citation.id,
          ),
          paths: request.evidence.paths,
        },
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          costUsdMicros: 0,
          latencyMs: 1,
        },
      });
    },
  };
}

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

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
    attempts: z.array(m3bOracleAttemptSchema).min(1).max(2).readonly(),
    terminalFailure: m3bOracleFailureCodeSchema.nullable(),
    validOutput: z.boolean(),
    output: m3bOracleOutputSchema.nullable(),
    answerCorrect: z.boolean(),
    citationsCorrect: z.boolean(),
    relationshipCitationsCorrect: z.boolean(),
    pathsCorrect: z.boolean(),
    pathUtilized: z.boolean(),
    pathUtilizationSuccess: z.boolean(),
    endToEndSuccess: z.boolean(),
    conditionalSemanticSuccess: z.boolean().nullable(),
    semanticRepairCalls: z.literal(0),
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
    evidence: neighborhood.neighborhood.context,
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
  const execution = await executePlan(
    input.materialized.sharedPlan.executable,
    {
      inputs: new Map([["request", request]]),
      effectHandler: async () => {
        for (
          let attemptIndex = 0;
          attemptIndex <=
          M3B_TRANSPORT_RETRY_POLICY.maximumRetriesAfterInitialAttempt;
          attemptIndex += 1
        ) {
          const attempt = await input.oracle.generate(request, {
            recordKey: dispatchRecordKey.value,
            attemptIndex,
          });
          attempts.push(attempt);
          if (attempt.kind === "success") {
            terminalFailure = null;
            return ok({
              value: attempt.output,
              replayResultId: `${input.entry.unitDigest}:${input.arm}:${attemptIndex}`,
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
        next: () => `${input.entry.unitDigest}:${input.arm}`,
      },
    },
  );
  const parsedOutput = execution.ok
    ? m3bOracleOutputSchema.safeParse(execution.value.output)
    : { success: false as const };
  const output = parsedOutput.success ? parsedOutput.data : null;
  const visibleCitationIds = new Set(
    neighborhood.neighborhood.context.citations.map((citation) => citation.id),
  );
  const expectedCitationIds = new Set(frozen.task.expectedCitationIds);
  const citationsCorrect =
    output !== null &&
    output.citationIds.every((id) => visibleCitationIds.has(id)) &&
    [...expectedCitationIds].every((id) => output.citationIds.includes(id));
  const expectedVisibleRelationshipCitationIds =
    frozen.task.expectedEdgeCitationIds.filter((citationId) =>
      visibleCitationIds.has(citationId),
    );
  const relationshipCitationsCorrect =
    output !== null &&
    expectedVisibleRelationshipCitationIds.every((citationId) =>
      output.citationIds.includes(citationId),
    );
  const visiblePaths = new Set(
    neighborhood.neighborhood.context.paths.map((path) => pathKey(path)),
  );
  const expectedVisiblePaths = frozen.task.expectedPaths.filter((path) =>
    visiblePaths.has(pathKey(path)),
  );
  const pathsCorrect =
    output !== null &&
    output.paths.every((path) => visiblePaths.has(pathKey(path))) &&
    expectedVisiblePaths.every((path) =>
      output.paths.some((candidate) => pathKey(candidate) === pathKey(path)),
    );
  const answerCorrect = output?.answer === frozen.task.expectedAnswer;
  const pathUtilized = (output?.paths.length ?? 0) > 0;
  const pathUtilizationSuccess =
    pathUtilized && pathsCorrect && relationshipCitationsCorrect;
  const endToEndSuccess = output !== null && answerCorrect && citationsCorrect;
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
    terminalFailure,
    validOutput: output !== null,
    output,
    answerCorrect,
    citationsCorrect,
    relationshipCitationsCorrect,
    pathsCorrect,
    pathUtilized,
    pathUtilizationSuccess,
    endToEndSuccess,
    conditionalSemanticSuccess:
      output === null ? null : answerCorrect && citationsCorrect,
    semanticRepairCalls: 0 as const,
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
  statistics: M3bStatisticalReport;
}>;

export async function runM3bWithOracles(
  input: Readonly<{
    materialized: M3bMaterializedPhase;
    oracles: ReadonlyArray<M3bOracle>;
    store: M3bStore;
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
        validOutput: record.validOutput,
        endToEndSuccess: record.endToEndSuccess,
        conditionalSemanticSuccess: record.conditionalSemanticSuccess,
        pathUtilizationSuccess: record.pathUtilizationSuccess,
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
      transportRetries: records.reduce(
        (total, record) => total + Math.max(0, record.attempts.length - 1),
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
    M3B_PREREGISTERED_CORPUS,
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
    4 *
    materialized.manifest.providers.length *
    materialized.manifest.repetitions;
  return {
    phase: materialized.manifest.phase,
    cases,
    initialCalls: materialized.manifest.initialCalls,
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
      corpus.passed &&
      schedule.passed &&
      sharedPlanIdentities === 1 &&
      frozenNeighborhoods === cases * 4 &&
      materialized.manifest.initialCalls === expectedInitialCalls &&
      !materialized.manifest.pool.liveExecutionAuthorized,
  };
}
