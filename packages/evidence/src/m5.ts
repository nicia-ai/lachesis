import {
  createReplayEffectHandler,
  diagnostic,
  digestValue,
  type EffectHandler,
  type EffectRequest,
  err,
  type ExecutablePlan,
  executePlan,
  inspectExecutablePlan,
  ok,
  planBudgetSchema,
  recordEffectResult,
  type ReplayEntry,
  replayEntrySchema,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type EvidenceCitation,
  evidenceCitationSchema,
  evidenceQuerySchema,
} from "./contract.js";
import { m3bAnswerContractSchema } from "./corpus.js";
import { type EvidenceGraph, evidenceGraphSchema } from "./graph.js";
import type { m4ProvenanceReconstructionSchema } from "./m4.js";
import {
  compileM4EvidenceView,
  M4A_INITIAL_POLICY,
  type M4CompiledEvidenceView,
  m4CompiledEvidenceViewSchema,
  type M4EvidenceCompilerPolicy,
  m4EvidenceCompilerPolicySchema,
  type M4Failure,
  type M4OracleAnswer,
  m4OracleAnswerSchema,
  m4ProvenanceGraphSchema,
  m4ProviderProfileSchema,
  m4TaskClassSchema,
  reconstructM4Provenance,
} from "./m4.js";
import {
  decodeM4d1OracleWire,
  type M4d1OracleRequest,
  m4d1OracleRequestSchema,
} from "./m4d1.js";
import {
  snapshotZodJsonSchema,
  strictJsonValueSchema,
} from "./zod-json-schema.js";

const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const isoInstantSchema = z.iso.datetime();
export type M5InputValue = z.infer<typeof strictJsonValueSchema>;

export const M5A_RUNTIME_PROTOCOL = Object.freeze({
  id: "lachesis-production-evidence-runtime",
  version: "1",
  liveProviderDispatchImplemented: false,
  defaultEvidenceView: "lexical-facts",
  oracleOutput: Object.freeze(["outcome", "answerValues", "supportingFactIds"]),
  runtimeDerived: Object.freeze([
    "semantic-validation",
    "citations",
    "canonical-paths",
    "provenance",
  ]),
});

const evidenceLimitsSchema = evidenceQuerySchema.unwrap().pick({
  maxFacts: true,
  maxCitations: true,
  maxEdges: true,
  maxPaths: true,
  maxHops: true,
  maxSerializedBytes: true,
  maxSerializedTokenUpperBound: true,
});

export const m5PublicTaskContractSchema = z
  .strictObject({
    id: identifierSchema,
    version: z.string().min(1),
    instruction: z.string().min(1).max(4_000),
    taskClass: m4TaskClassSchema,
    answerContract: m3bAnswerContractSchema,
    evidenceLimits: evidenceLimitsSchema,
  })
  .readonly();

export type M5PublicTaskContract = z.infer<typeof m5PublicTaskContractSchema>;

export const m5SnapshotCoordinateSchema = z
  .strictObject({
    validAt: isoInstantSchema.nullable(),
    recordedAt: isoInstantSchema.nullable(),
  })
  .readonly();

export type M5SnapshotCoordinate = z.infer<typeof m5SnapshotCoordinateSchema>;

export const m5EvidenceStoreIdentitySchema = z
  .strictObject({
    id: identifierSchema,
    version: z.string().min(1),
    implementation: z.string().min(1),
    storeDigest: digestSchema,
  })
  .readonly();

export const m5EvidenceSnapshotIdentitySchema = z
  .strictObject({
    store: m5EvidenceStoreIdentitySchema,
    coordinate: m5SnapshotCoordinateSchema,
    sourceSnapshotDigest: digestSchema,
    storageSnapshotDigest: digestSchema,
  })
  .readonly();

export type M5EvidenceStoreIdentity = z.infer<
  typeof m5EvidenceStoreIdentitySchema
>;
export type M5EvidenceSnapshotIdentity = z.infer<
  typeof m5EvidenceSnapshotIdentitySchema
>;

export const m5EvidenceStoreFailureSchema = z
  .strictObject({
    code: z.enum([
      "INVALID_STORE_INPUT",
      "SNAPSHOT_NOT_FOUND",
      "SNAPSHOT_MISMATCH",
      "STORE_CLOSED",
      "STORE_OPERATION_FAILED",
      "CANCELLED",
    ]),
    message: z.string().min(1),
  })
  .readonly();

export type M5EvidenceStoreFailure = z.infer<
  typeof m5EvidenceStoreFailureSchema
>;

export type M5EvidenceSnapshot = Readonly<{
  graph: EvidenceGraph;
  identity: M5EvidenceSnapshotIdentity;
}>;

export type M5EvidenceStore = Readonly<{
  identity: M5EvidenceStoreIdentity;
  snapshot: (
    coordinate: M5SnapshotCoordinate,
    signal: AbortSignal,
  ) => Promise<Result<M5EvidenceSnapshot, M5EvidenceStoreFailure>>;
}>;

const memorySnapshotVersionSchema = z
  .strictObject({
    recordedAt: isoInstantSchema,
    graph: evidenceGraphSchema,
  })
  .readonly();

export type M5MemorySnapshotVersion = z.infer<
  typeof memorySnapshotVersionSchema
>;

const m5OracleBudgetSchema = z
  .strictObject({
    maxCalls: z.number().int().positive().max(1),
    maxInputTokens: z.number().int().nonnegative(),
    maxOutputTokens: z.number().int().nonnegative(),
    maxTotalTokens: z.number().int().nonnegative(),
    maxWallClockMs: z.number().int().nonnegative(),
    maxConcurrency: z.number().int().positive().max(1),
  })
  .superRefine((budget, context) => {
    if (budget.maxInputTokens + budget.maxOutputTokens > budget.maxTotalTokens)
      context.addIssue({
        code: "custom",
        message:
          "The total-token budget must cover the declared input and output budgets.",
        path: ["maxTotalTokens"],
      });
  })
  .readonly();

const m5EvidencePolicySelectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("lexical-default") }).readonly(),
  z
    .strictObject({
      kind: z.literal("research-opt-in"),
      acknowledgement: z.literal("explicit-research-policy-opt-in"),
      policy: m4EvidenceCompilerPolicySchema,
    })
    .readonly(),
]);

export const m5TrustedPolicySchema = z
  .strictObject({
    id: identifierSchema,
    version: z.string().min(1),
    expectedPlanHash: digestSchema,
    expectedSemanticContractHash: digestSchema,
    providerProfile: m4ProviderProfileSchema,
    oracleInputName: identifierSchema,
    oracleEffectName: z.string().min(1),
    oracleCapability: z.string().min(1),
    evidence: m5EvidencePolicySelectionSchema,
    budget: m5OracleBudgetSchema,
  })
  .readonly();

export type M5TrustedPolicy = z.infer<typeof m5TrustedPolicySchema>;
export type M5OracleBudget = z.infer<typeof m5OracleBudgetSchema>;

export const m5OracleEffectIdentitySchema = z
  .strictObject({
    id: identifierSchema,
    version: z.string().min(1),
    implementation: z.string().min(1),
    requestSchemaDigest: digestSchema,
    outputSchemaDigest: digestSchema,
  })
  .readonly();

export const m5OracleUsageSchema = z
  .strictObject({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    wallClockMs: z.number().int().nonnegative(),
  })
  .readonly();

export const m5OracleWireResultSchema = z
  .strictObject({
    wireText: z.string().max(65_536),
    replayResultId: z.string().min(1),
    usage: m5OracleUsageSchema,
  })
  .readonly();

export const m5OracleEffectFailureSchema = z
  .strictObject({
    code: z.enum([
      "CAPABILITY_DENIED",
      "BUDGET_EXHAUSTED",
      "CANCELLED",
      "ORACLE_EFFECT_FAILED",
    ]),
    message: z.string().min(1),
  })
  .readonly();

const m5OracleInvocationResultSchema = z.discriminatedUnion("ok", [
  z
    .strictObject({
      ok: z.literal(true),
      value: m5OracleWireResultSchema,
    })
    .readonly(),
  z
    .strictObject({
      ok: z.literal(false),
      error: m5OracleEffectFailureSchema,
    })
    .readonly(),
]);

export type M5OracleEffectIdentity = z.infer<
  typeof m5OracleEffectIdentitySchema
>;
export type M5OracleUsage = z.infer<typeof m5OracleUsageSchema>;
export type M5OracleWireResult = z.infer<typeof m5OracleWireResultSchema>;
export type M5OracleEffectFailure = z.infer<typeof m5OracleEffectFailureSchema>;

export type M5OracleInvocationContext = Readonly<{
  requestDigest: string;
  budget: M5OracleBudget;
  signal: AbortSignal;
}>;

export type M5OracleEffect = Readonly<{
  identity: M5OracleEffectIdentity;
  invoke: (
    request: M4d1OracleRequest,
    context: M5OracleInvocationContext,
  ) => Promise<Result<M5OracleWireResult, M5OracleEffectFailure>>;
}>;

export type M5OracleInterpreter = Readonly<{
  mode: "mock" | "record";
  effect: M5OracleEffect;
}>;

const m5RuntimeFailureCodeSchema = z.enum([
  "INVALID_INPUT",
  "PLAN_MISMATCH",
  "SEMANTIC_CONTRACT_MISMATCH",
  "EVIDENCE_STORE_FAILED",
  "EVIDENCE_SNAPSHOT_MISMATCH",
  "VISIBLE_VIEW_MISMATCH",
  "MISSING_OR_UNSUPPORTED_FACTS",
  "CAPABILITY_DENIED",
  "BUDGET_EXHAUSTED",
  "ORACLE_EFFECT_FAILED",
  "ORACLE_WIRE_REJECTED",
  "ORACLE_SEMANTIC_REJECTED",
  "PLAN_EXECUTION_FAILED",
  "REPLAY_ARTIFACT_MISMATCH",
  "PROVENANCE_RECONSTRUCTION_FAILED",
  "RECORDING_FAILED",
  "IDENTITY_FAILURE",
  "CANCELLED",
]);

const m5RuntimeStageSchema = z.enum([
  "input",
  "plan",
  "snapshot",
  "compilation",
  "oracle",
  "execution",
  "validation",
  "provenance",
  "recording",
  "replay",
]);

export const m5RuntimeFailureSchema = z
  .strictObject({
    code: m5RuntimeFailureCodeSchema,
    stage: m5RuntimeStageSchema,
    message: z.string().min(1),
    issues: z
      .array(
        z
          .strictObject({
            code: z.string().min(1),
            path: z
              .array(z.union([z.string(), z.number().int().nonnegative()]))
              .readonly(),
          })
          .readonly(),
      )
      .max(64)
      .readonly(),
  })
  .readonly();

export type M5RuntimeFailure = z.infer<typeof m5RuntimeFailureSchema>;

const m5TraceEventSchema = z
  .strictObject({
    sequence: z.number().int().nonnegative(),
    stage: m5RuntimeStageSchema,
    event: z.string().min(1),
    identityDigest: digestSchema.nullable(),
  })
  .readonly();

export const m5RuntimeTraceSchema = z
  .strictObject({
    protocol: z.literal("lachesis-production-evidence-runtime/1"),
    mode: z.enum(["mock", "record"]),
    events: z.array(m5TraceEventSchema).readonly(),
    traceDigest: digestSchema,
  })
  .readonly();

const m5BudgetUsageSchema = z
  .strictObject({
    calls: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    wallClockMs: z.number().int().nonnegative(),
    maximumConcurrency: z.number().int().nonnegative(),
  })
  .readonly();

export const m5RuntimeResultSchema = z
  .strictObject({
    protocol: z.literal("lachesis-production-evidence-runtime/1"),
    answer: z
      .strictObject({
        outcome: z.enum(["answered", "insufficient-evidence"]),
        values: z.array(z.string().min(1)).max(2).readonly(),
      })
      .readonly(),
    citations: z.array(evidenceCitationSchema).readonly(),
    provenance: m4ProvenanceGraphSchema,
    reconstructionDigest: digestSchema,
    planIdentity: z
      .strictObject({
        planHash: digestSchema,
        semanticContractHash: digestSchema,
        catalogFingerprint: digestSchema,
      })
      .readonly(),
    taskContractDigest: digestSchema,
    trustedPolicyDigest: digestSchema,
    evidenceSnapshot: m5EvidenceSnapshotIdentitySchema,
    visibleViewIdentity: z
      .strictObject({
        compilerAuditDigest: digestSchema,
        visibleViewDigest: digestSchema,
        selectedNeighborhoodDigest: digestSchema,
      })
      .readonly(),
    effectIdentity: z
      .strictObject({
        identity: m5OracleEffectIdentitySchema,
        digest: digestSchema,
      })
      .readonly(),
    budgets: z
      .strictObject({
        plan: planBudgetSchema,
        oracle: z
          .strictObject({
            limits: m5OracleBudgetSchema,
            usage: m5BudgetUsageSchema,
          })
          .readonly(),
      })
      .readonly(),
    trace: m5RuntimeTraceSchema,
    resultDigest: digestSchema,
  })
  .readonly();

export type M5RuntimeTrace = z.infer<typeof m5RuntimeTraceSchema>;
export type M5RuntimeResult = z.infer<typeof m5RuntimeResultSchema>;

const m5InputEntrySchema = z
  .strictObject({ name: identifierSchema, value: strictJsonValueSchema })
  .readonly();

const m5OracleRecordingSchema = z
  .strictObject({
    interpreterMode: z.enum(["mock", "record"]),
    identity: m5OracleEffectIdentitySchema,
    identityDigest: digestSchema,
    request: m4d1OracleRequestSchema,
    requestDigest: digestSchema,
    wireResult: m5OracleWireResultSchema,
    output: m4OracleAnswerSchema,
  })
  .readonly();

const m5ReplayArtifactBodyObject = z.strictObject({
  protocol: z.literal("lachesis-production-evidence-runtime-recording/1"),
  planIdentity: z
    .strictObject({
      planHash: digestSchema,
      semanticContractHash: digestSchema,
      catalogFingerprint: digestSchema,
    })
    .readonly(),
  publicTaskContract: m5PublicTaskContractSchema,
  taskContractDigest: digestSchema,
  trustedPolicy: m5TrustedPolicySchema,
  trustedPolicyDigest: digestSchema,
  inputEntries: z.array(m5InputEntrySchema).readonly(),
  evidenceSnapshot: z
    .strictObject({
      graph: evidenceGraphSchema,
      identity: m5EvidenceSnapshotIdentitySchema,
    })
    .readonly(),
  compiledView: m4CompiledEvidenceViewSchema,
  oracle: m5OracleRecordingSchema,
  replayEntries: z.array(replayEntrySchema).min(1).max(1).readonly(),
  result: m5RuntimeResultSchema,
});

const m5ReplayArtifactBodySchema = m5ReplayArtifactBodyObject.readonly();

export const m5ReplayArtifactSchema = m5ReplayArtifactBodyObject
  .extend({ artifactDigest: digestSchema })
  .readonly();

export type M5ReplayArtifact = z.infer<typeof m5ReplayArtifactSchema>;

export type M5RecordingStore = Readonly<{
  load: (
    artifactDigest: string,
    signal: AbortSignal,
  ) => Promise<Result<M5ReplayArtifact | undefined, M5RuntimeFailure>>;
  save: (
    artifact: M5ReplayArtifact,
    signal: AbortSignal,
  ) => Promise<Result<void, M5RuntimeFailure>>;
}>;

export type M5RunSuccess = Readonly<{
  result: M5RuntimeResult;
  artifactDigest: string;
}>;

export type M5RunInput = Readonly<{
  executablePlan: ExecutablePlan;
  publicTaskContract: M5PublicTaskContract;
  inputValues: ReadonlyMap<string, M5InputValue>;
  trustedPolicy: M5TrustedPolicy;
  evidenceStore: M5EvidenceStore;
  snapshot: M5SnapshotCoordinate;
  expectedStorageSnapshotDigest?: string | undefined;
  expectedVisibleViewDigest?: string | undefined;
  oracle: M5OracleInterpreter;
  recordingStore: M5RecordingStore;
  signal: AbortSignal;
}>;

export type M5ReplayInput = Readonly<{
  executablePlan: ExecutablePlan;
  publicTaskContract: M5PublicTaskContract;
  trustedPolicy: M5TrustedPolicy;
  artifactDigest: string;
  recordingStore: M5RecordingStore;
  signal: AbortSignal;
}>;

function runtimeFailure(
  code: M5RuntimeFailure["code"],
  stage: M5RuntimeFailure["stage"],
  message: string,
  issues: M5RuntimeFailure["issues"] = [],
): M5RuntimeFailure {
  return { code, stage, message, issues };
}

function storeFailure(
  code: M5EvidenceStoreFailure["code"],
  message: string,
): M5EvidenceStoreFailure {
  return { code, message };
}

async function identified(
  value: unknown,
  stage: M5RuntimeFailure["stage"],
  message: string,
): Promise<Result<string, M5RuntimeFailure>> {
  const digest = await digestValue(value);
  return digest.ok
    ? ok(digest.value)
    : err(runtimeFailure("IDENTITY_FAILURE", stage, message));
}

function cancelled(stage: M5RuntimeFailure["stage"]): M5RuntimeFailure {
  return runtimeFailure("CANCELLED", stage, "Operation was cancelled.");
}

function canonicalGraph(graph: EvidenceGraph): EvidenceGraph {
  return evidenceGraphSchema.parse({
    ...graph,
    facts: graph.facts.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ),
    citations: graph.citations.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ),
    edges: graph.edges.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ),
  });
}

export async function createInMemoryM5EvidenceStore(
  input: Readonly<{
    id: string;
    version: string;
    snapshots: ReadonlyArray<M5MemorySnapshotVersion>;
  }>,
): Promise<Result<M5EvidenceStore, M5EvidenceStoreFailure>> {
  const identityInput = z
    .strictObject({
      id: identifierSchema,
      version: z.string().min(1),
      snapshots: z.array(memorySnapshotVersionSchema).min(1).readonly(),
    })
    .safeParse(input);
  if (!identityInput.success)
    return err(
      storeFailure("INVALID_STORE_INPUT", "Memory evidence store is invalid."),
    );
  const snapshots = identityInput.data.snapshots
    .map((snapshot) => ({
      recordedAt: snapshot.recordedAt,
      graph: canonicalGraph(snapshot.graph),
    }))
    .toSorted((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  if (
    new Set(snapshots.map((snapshot) => snapshot.recordedAt)).size !==
    snapshots.length
  )
    return err(
      storeFailure(
        "INVALID_STORE_INPUT",
        "Memory evidence snapshots require unique recorded times.",
      ),
    );
  const storeIdentityDigest = await digestValue({
    id: identityInput.data.id,
    version: identityInput.data.version,
    snapshots,
  });
  if (!storeIdentityDigest.ok)
    return err(
      storeFailure("INVALID_STORE_INPUT", "Memory store cannot be identified."),
    );
  const identity = m5EvidenceStoreIdentitySchema.parse({
    id: identityInput.data.id,
    version: identityInput.data.version,
    implementation: "m5-in-memory-versioned-evidence/1",
    storeDigest: storeIdentityDigest.value,
  });
  return ok({
    identity,
    snapshot: async (coordinate, signal) => {
      if (signal.aborted)
        return err(storeFailure("CANCELLED", "Snapshot selection cancelled."));
      const parsedCoordinate = m5SnapshotCoordinateSchema.safeParse(coordinate);
      if (!parsedCoordinate.success)
        return err(
          storeFailure(
            "INVALID_STORE_INPUT",
            "Snapshot coordinate is invalid.",
          ),
        );
      const recordedAt = parsedCoordinate.data.recordedAt;
      const selected =
        recordedAt === null
          ? snapshots.at(-1)
          : snapshots.findLast((snapshot) => snapshot.recordedAt <= recordedAt);
      if (selected === undefined)
        return err(
          storeFailure(
            "SNAPSHOT_NOT_FOUND",
            "No evidence snapshot exists at the requested recorded time.",
          ),
        );
      const sourceSnapshotDigest = await digestValue(selected.graph);
      if (!sourceSnapshotDigest.ok)
        return err(
          storeFailure(
            "STORE_OPERATION_FAILED",
            "Evidence snapshot cannot be identified.",
          ),
        );
      const storageSnapshotDigest = await digestValue({
        store: identity,
        coordinate: parsedCoordinate.data,
        selectedRecordedAt: selected.recordedAt,
        sourceSnapshotDigest: sourceSnapshotDigest.value,
      });
      if (!storageSnapshotDigest.ok)
        return err(
          storeFailure(
            "STORE_OPERATION_FAILED",
            "Storage snapshot cannot be identified.",
          ),
        );
      return ok({
        graph: selected.graph,
        identity: m5EvidenceSnapshotIdentitySchema.parse({
          store: identity,
          coordinate: parsedCoordinate.data,
          sourceSnapshotDigest: sourceSnapshotDigest.value,
          storageSnapshotDigest: storageSnapshotDigest.value,
        }),
      });
    },
  });
}

export function createMemoryM5RecordingStore(): M5RecordingStore &
  Readonly<{ artifacts: () => ReadonlyArray<M5ReplayArtifact> }> {
  const artifacts = new Map<string, M5ReplayArtifact>();
  return {
    load: (artifactDigest, signal) =>
      Promise.resolve(
        signal.aborted
          ? err(cancelled("replay"))
          : ok(artifacts.get(artifactDigest)),
      ),
    save: (artifact, signal) => {
      if (signal.aborted) return Promise.resolve(err(cancelled("recording")));
      artifacts.set(artifact.artifactDigest, artifact);
      return Promise.resolve(ok(undefined));
    },
    artifacts: () =>
      [...artifacts.values()].toSorted((left, right) =>
        left.artifactDigest.localeCompare(right.artifactDigest),
      ),
  };
}

export function createM5RecordingOracleInterpreter(
  effect: M5OracleEffect,
): M5OracleInterpreter {
  return { mode: "record", effect };
}

export async function createM5OracleEffectIdentity(
  input: Readonly<{
    id: string;
    version: string;
    implementation: string;
  }>,
): Promise<Result<M5OracleEffectIdentity, M5RuntimeFailure>> {
  const requestSchemaDigest = await identified(
    snapshotZodJsonSchema(m4d1OracleRequestSchema),
    "input",
    "Reduced oracle request schema cannot be identified.",
  );
  if (!requestSchemaDigest.ok) return requestSchemaDigest;
  const outputSchemaDigest = await identified(
    snapshotZodJsonSchema(m4OracleAnswerSchema),
    "input",
    "Reduced oracle output schema cannot be identified.",
  );
  if (!outputSchemaDigest.ok) return outputSchemaDigest;
  const parsed = m5OracleEffectIdentitySchema.safeParse({
    ...input,
    requestSchemaDigest: requestSchemaDigest.value,
    outputSchemaDigest: outputSchemaDigest.value,
  });
  return parsed.success
    ? ok(parsed.data)
    : err(
        runtimeFailure(
          "INVALID_INPUT",
          "input",
          "Oracle effect identity is invalid.",
        ),
      );
}

const m5MockFixtureSchema = z
  .strictObject({
    request: m4d1OracleRequestSchema,
    result: z.discriminatedUnion("kind", [
      z
        .strictObject({
          kind: z.literal("success"),
          value: m5OracleWireResultSchema,
        })
        .readonly(),
      z
        .strictObject({
          kind: z.literal("failure"),
          error: m5OracleEffectFailureSchema,
        })
        .readonly(),
    ]),
  })
  .readonly();

export type M5MockFixture = z.infer<typeof m5MockFixtureSchema>;

export async function createM5MockOracleInterpreter(
  input: Readonly<{
    identity: M5OracleEffectIdentity;
    fixtures: ReadonlyArray<M5MockFixture>;
  }>,
): Promise<Result<M5OracleInterpreter, M5RuntimeFailure>> {
  const identity = m5OracleEffectIdentitySchema.safeParse(input.identity);
  const fixtures = z.array(m5MockFixtureSchema).safeParse(input.fixtures);
  if (!identity.success || !fixtures.success)
    return err(
      runtimeFailure("INVALID_INPUT", "input", "Mock oracle is invalid."),
    );
  const byRequest = new Map<string, M5MockFixture["result"]>();
  for (const fixture of fixtures.data) {
    const requestDigest = await identified(
      fixture.request,
      "input",
      "Mock request cannot be identified.",
    );
    if (!requestDigest.ok) return requestDigest;
    if (byRequest.has(requestDigest.value))
      return err(
        runtimeFailure(
          "INVALID_INPUT",
          "input",
          "Mock fixtures require unique request identities.",
        ),
      );
    byRequest.set(requestDigest.value, fixture.result);
  }
  return ok({
    mode: "mock",
    effect: {
      identity: identity.data,
      invoke: (_request, context) => {
        if (context.signal.aborted)
          return Promise.resolve(
            err({ code: "CANCELLED", message: "Mock oracle cancelled." }),
          );
        const fixture = byRequest.get(context.requestDigest);
        if (fixture === undefined)
          return Promise.resolve(
            err({
              code: "ORACLE_EFFECT_FAILED",
              message: "No deterministic mock fixture matches the request.",
            }),
          );
        return Promise.resolve(
          fixture.kind === "success" ? ok(fixture.value) : err(fixture.error),
        );
      },
    },
  });
}

const M5_LEXICAL_COMPILER_POLICY: M4EvidenceCompilerPolicy =
  m4EvidenceCompilerPolicySchema.parse({
    ...M4A_INITIAL_POLICY,
    id: "m5-lexical-production-evidence-view",
    version: "1",
    rules: M4A_INITIAL_POLICY.rules.map((rule) => ({
      ...rule,
      view: "lexical-facts",
    })),
  });

function compilerPolicy(policy: M5TrustedPolicy): M4EvidenceCompilerPolicy {
  return policy.evidence.kind === "lexical-default"
    ? M5_LEXICAL_COMPILER_POLICY
    : policy.evidence.policy;
}

function taskQuery(
  task: M5PublicTaskContract,
  coordinate: M5SnapshotCoordinate,
): z.infer<typeof evidenceQuerySchema> {
  return evidenceQuerySchema.parse({
    id: task.id,
    text: task.instruction,
    validAt: coordinate.validAt,
    recordedAt: coordinate.recordedAt,
    ...task.evidenceLimits,
  });
}

function m4Issues(failure: M4Failure): M5RuntimeFailure["issues"] {
  return failure.issues.map((issue) => ({
    code: issue.code,
    path: issue.path,
  }));
}

function budgetFailure(
  usage: M5OracleUsage,
  budget: M5OracleBudget,
): M5RuntimeFailure | undefined {
  if (usage.inputTokens > budget.maxInputTokens)
    return runtimeFailure(
      "BUDGET_EXHAUSTED",
      "oracle",
      "Oracle input-token budget was exceeded.",
    );
  if (usage.outputTokens > budget.maxOutputTokens)
    return runtimeFailure(
      "BUDGET_EXHAUSTED",
      "oracle",
      "Oracle output-token budget was exceeded.",
    );
  if (usage.wallClockMs > budget.maxWallClockMs)
    return runtimeFailure(
      "BUDGET_EXHAUSTED",
      "oracle",
      "Oracle wall-clock budget was exceeded.",
    );
  return undefined;
}

function orderedInputEntries(
  inputs: ReadonlyMap<string, M5InputValue>,
): ReadonlyArray<z.infer<typeof m5InputEntrySchema>> {
  return [...inputs.entries()]
    .map(([name, value]) => m5InputEntrySchema.parse({ name, value }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

async function trace(
  mode: M5OracleInterpreter["mode"],
  entries: ReadonlyArray<Omit<z.infer<typeof m5TraceEventSchema>, "sequence">>,
): Promise<Result<M5RuntimeTrace, M5RuntimeFailure>> {
  const events = entries.map((entry, sequence) => ({ ...entry, sequence }));
  const traceDigest = await identified(
    { protocol: "lachesis-production-evidence-runtime/1", mode, events },
    "recording",
    "Runtime trace cannot be identified.",
  );
  return traceDigest.ok
    ? ok(
        m5RuntimeTraceSchema.parse({
          protocol: "lachesis-production-evidence-runtime/1",
          mode,
          events,
          traceDigest: traceDigest.value,
        }),
      )
    : traceDigest;
}

function mapOracleFailure(failure: M5OracleEffectFailure): M5RuntimeFailure {
  switch (failure.code) {
    case "CAPABILITY_DENIED":
      return runtimeFailure("CAPABILITY_DENIED", "oracle", failure.message);
    case "BUDGET_EXHAUSTED":
      return runtimeFailure("BUDGET_EXHAUSTED", "oracle", failure.message);
    case "CANCELLED":
      return cancelled("oracle");
    case "ORACLE_EFFECT_FAILED":
      return runtimeFailure("ORACLE_EFFECT_FAILED", "oracle", failure.message);
  }
}

type CapturedOracle = Readonly<{
  wireResult: M5OracleWireResult;
  output: M4OracleAnswer;
  replayEntry: ReplayEntry;
}>;

type OracleInvocationRace =
  | Readonly<{
      kind: "completed";
      value: unknown;
    }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "timed-out" }>;

async function invokeOracleWithinBudget(
  input: Readonly<{
    interpreter: M5OracleInterpreter;
    request: M4d1OracleRequest;
    requestDigest: string;
    budget: M5OracleBudget;
    signal: AbortSignal;
  }>,
): Promise<OracleInvocationRace> {
  if (input.signal.aborted) return { kind: "cancelled" };
  const controller = new AbortController();
  const cancel = (): void => {
    controller.abort();
  };
  input.signal.addEventListener("abort", cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<OracleInvocationRace>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "timed-out" });
    }, input.budget.maxWallClockMs);
  });
  const cancelled = new Promise<OracleInvocationRace>((resolve) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        if (input.signal.aborted) resolve({ kind: "cancelled" });
      },
      { once: true },
    );
  });
  const invoked = Promise.resolve(
    input.interpreter.effect.invoke(input.request, {
      requestDigest: input.requestDigest,
      budget: input.budget,
      signal: controller.signal,
    }),
  ).then<OracleInvocationRace>((value) => ({ kind: "completed", value }));
  try {
    return await Promise.race([invoked, cancelled, timedOut]);
  } finally {
    input.signal.removeEventListener("abort", cancel);
    if (timer !== undefined) clearTimeout(timer);
  }
}

function buildEffectHandler(
  input: Readonly<{
    expectedRequest: M4d1OracleRequest;
    expectedRequestDigest: string;
    trustedPolicy: M5TrustedPolicy;
    interpreter: M5OracleInterpreter;
    signal: AbortSignal;
    capture: (captured: CapturedOracle) => void;
    fail: (failure: M5RuntimeFailure) => void;
  }>,
): EffectHandler {
  let calls = 0;
  return async (request: EffectRequest) => {
    if (input.signal.aborted) {
      input.fail(cancelled("oracle"));
      return err(
        diagnostic("RUNTIME_SCHEMA_VIOLATION", "Oracle invocation cancelled."),
      );
    }
    if (
      request.effectName !== input.trustedPolicy.oracleEffectName ||
      request.capability !== input.trustedPolicy.oracleCapability
    ) {
      const failure = runtimeFailure(
        "CAPABILITY_DENIED",
        "oracle",
        "The executable requested an unauthorized oracle capability.",
      );
      input.fail(failure);
      return err(diagnostic("DENIED_CAPABILITY", failure.message));
    }
    calls += 1;
    if (calls > input.trustedPolicy.budget.maxCalls) {
      const failure = runtimeFailure(
        "BUDGET_EXHAUSTED",
        "oracle",
        "Oracle call budget was exceeded.",
      );
      input.fail(failure);
      return err(diagnostic("BUDGET_EXCEEDED", failure.message));
    }
    const parsedRequest = m4d1OracleRequestSchema.safeParse(request.input);
    if (!parsedRequest.success) {
      const failure = runtimeFailure(
        "PLAN_MISMATCH",
        "execution",
        "The executable did not pass the reduced oracle request contract.",
      );
      input.fail(failure);
      return err(diagnostic("RUNTIME_SCHEMA_VIOLATION", failure.message));
    }
    const actualRequestDigest = await digestValue(parsedRequest.data);
    if (
      !actualRequestDigest.ok ||
      actualRequestDigest.value !== input.expectedRequestDigest
    ) {
      const failure = runtimeFailure(
        "PLAN_MISMATCH",
        "execution",
        "The executable changed the bound oracle request.",
      );
      input.fail(failure);
      return err(diagnostic("RUNTIME_SCHEMA_VIOLATION", failure.message));
    }
    let raced: OracleInvocationRace;
    try {
      raced = await invokeOracleWithinBudget({
        interpreter: input.interpreter,
        request: input.expectedRequest,
        requestDigest: input.expectedRequestDigest,
        budget: input.trustedPolicy.budget,
        signal: input.signal,
      });
    } catch (error) {
      const failure = runtimeFailure(
        "ORACLE_EFFECT_FAILED",
        "oracle",
        error instanceof Error
          ? `Oracle effect failed: ${error.name}.`
          : "Oracle effect failed.",
      );
      input.fail(failure);
      return err(diagnostic("RUNTIME_SCHEMA_VIOLATION", failure.message));
    }
    if (raced.kind === "cancelled") {
      const failure = cancelled("oracle");
      input.fail(failure);
      return err(diagnostic("RUNTIME_SCHEMA_VIOLATION", failure.message));
    }
    if (raced.kind === "timed-out") {
      const failure = runtimeFailure(
        "BUDGET_EXHAUSTED",
        "oracle",
        "Oracle wall-clock deadline was exceeded.",
      );
      input.fail(failure);
      return err(diagnostic("BUDGET_EXCEEDED", failure.message));
    }
    const parsedInvocation = m5OracleInvocationResultSchema.safeParse(
      raced.value,
    );
    if (!parsedInvocation.success) {
      const failure = runtimeFailure(
        "ORACLE_EFFECT_FAILED",
        "oracle",
        "Oracle effect returned an invalid result or usage envelope.",
        parsedInvocation.error.issues.slice(0, 64).map((issue) => ({
          code: issue.code,
          path: issue.path.map((part) =>
            typeof part === "symbol" ? String(part) : part,
          ),
        })),
      );
      input.fail(failure);
      return err(diagnostic("RUNTIME_SCHEMA_VIOLATION", failure.message));
    }
    const invoked = parsedInvocation.data;
    if (!invoked.ok) {
      const failure = mapOracleFailure(invoked.error);
      input.fail(failure);
      return err(diagnostic("RUNTIME_SCHEMA_VIOLATION", failure.message));
    }
    const usageFailure = budgetFailure(
      invoked.value.usage,
      input.trustedPolicy.budget,
    );
    if (usageFailure !== undefined) {
      input.fail(usageFailure);
      return err(diagnostic("BUDGET_EXCEEDED", usageFailure.message));
    }
    const decoded = decodeM4d1OracleWire(invoked.value.wireText);
    if (decoded.kind !== "accepted") {
      const failure = runtimeFailure(
        "ORACLE_WIRE_REJECTED",
        "oracle",
        "Oracle output failed the reduced wire contract.",
        decoded.issues.map((issue) => ({
          code: issue.code,
          path: issue.path,
        })),
      );
      input.fail(failure);
      return err(diagnostic("RUNTIME_SCHEMA_VIOLATION", failure.message));
    }
    const effectResult = {
      value: decoded.output,
      replayResultId: invoked.value.replayResultId,
      usage: {
        tokens:
          invoked.value.usage.inputTokens + invoked.value.usage.outputTokens,
        wallClockMs: invoked.value.usage.wallClockMs,
      },
    };
    const recorded = await recordEffectResult(request, effectResult);
    if (!recorded.ok) {
      const failure = runtimeFailure(
        "RECORDING_FAILED",
        "recording",
        "Oracle effect result could not be recorded.",
      );
      input.fail(failure);
      return recorded;
    }
    input.capture({
      wireResult: invoked.value,
      output: decoded.output,
      replayEntry: recorded.value,
    });
    return ok(effectResult);
  };
}

function citationsFor(
  compiled: M4CompiledEvidenceView,
  citationIds: ReadonlyArray<string>,
): ReadonlyArray<EvidenceCitation> {
  const required = new Set(citationIds);
  return compiled.modelVisibleContext.citations
    .filter((citation) => required.has(citation.id))
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

async function createRuntimeResult(
  input: Readonly<{
    summary: NonNullable<ReturnType<typeof inspectExecutablePlan>>;
    taskContractDigest: string;
    trustedPolicyDigest: string;
    snapshot: M5EvidenceSnapshot;
    compiled: M4CompiledEvidenceView;
    effectIdentity: M5OracleEffectIdentity;
    effectIdentityDigest: string;
    oracle: M4OracleAnswer;
    usage: M5OracleUsage;
    budget: M5OracleBudget;
    provenance: z.infer<typeof m4ProvenanceReconstructionSchema>;
    mode: M5OracleInterpreter["mode"];
  }>,
): Promise<Result<M5RuntimeResult, M5RuntimeFailure>> {
  const runtimeTrace = await trace(input.mode, [
    {
      stage: "plan",
      event: "plan-verified",
      identityDigest: input.summary.planHash,
    },
    {
      stage: "snapshot",
      event: "snapshot-pinned",
      identityDigest: input.snapshot.identity.storageSnapshotDigest,
    },
    {
      stage: "compilation",
      event: "visible-view-compiled",
      identityDigest: input.compiled.identity.visibleViewDigest,
    },
    {
      stage: "oracle",
      event: "oracle-recorded",
      identityDigest: input.effectIdentityDigest,
    },
    {
      stage: "provenance",
      event: "provenance-reconstructed",
      identityDigest: input.provenance.reconstructionDigest,
    },
  ]);
  if (!runtimeTrace.ok) return runtimeTrace;
  const body = {
    protocol: "lachesis-production-evidence-runtime/1" as const,
    answer: {
      outcome: input.oracle.outcome,
      values: input.oracle.answerValues,
    },
    citations: citationsFor(
      input.compiled,
      input.provenance.provenance.citationIds,
    ),
    provenance: input.provenance.provenance,
    reconstructionDigest: input.provenance.reconstructionDigest,
    planIdentity: {
      planHash: input.summary.planHash,
      semanticContractHash: input.summary.semanticContractHash,
      catalogFingerprint: input.summary.catalogFingerprint,
    },
    taskContractDigest: input.taskContractDigest,
    trustedPolicyDigest: input.trustedPolicyDigest,
    evidenceSnapshot: input.snapshot.identity,
    visibleViewIdentity: {
      compilerAuditDigest: input.compiled.identity.compilerAuditDigest,
      visibleViewDigest: input.compiled.identity.visibleViewDigest,
      selectedNeighborhoodDigest:
        input.compiled.identity.selectedNeighborhoodDigest,
    },
    effectIdentity: {
      identity: input.effectIdentity,
      digest: input.effectIdentityDigest,
    },
    budgets: {
      plan: input.summary.budget,
      oracle: {
        limits: input.budget,
        usage: {
          calls: 1,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          totalTokens: input.usage.inputTokens + input.usage.outputTokens,
          wallClockMs: input.usage.wallClockMs,
          maximumConcurrency: 1,
        },
      },
    },
    trace: runtimeTrace.value,
  };
  const resultDigest = await identified(
    body,
    "recording",
    "Runtime result cannot be identified.",
  );
  if (!resultDigest.ok) return resultDigest;
  const parsed = m5RuntimeResultSchema.safeParse({
    ...body,
    resultDigest: resultDigest.value,
  });
  return parsed.success
    ? ok(parsed.data)
    : err(
        runtimeFailure(
          "IDENTITY_FAILURE",
          "recording",
          "Runtime result failed identity validation.",
        ),
      );
}

async function validateEffectIdentity(
  identity: M5OracleEffectIdentity,
): Promise<Result<string, M5RuntimeFailure>> {
  const expected = await createM5OracleEffectIdentity({
    id: identity.id,
    version: identity.version,
    implementation: identity.implementation,
  });
  if (!expected.ok) return expected;
  if (
    expected.value.requestSchemaDigest !== identity.requestSchemaDigest ||
    expected.value.outputSchemaDigest !== identity.outputSchemaDigest
  )
    return err(
      runtimeFailure(
        "PLAN_MISMATCH",
        "plan",
        "Oracle effect schema identity does not match the reduced contract.",
      ),
    );
  return identified(
    identity,
    "plan",
    "Oracle effect identity cannot be identified.",
  );
}

async function validateArtifact(
  input: unknown,
  expectedDigest: string,
): Promise<Result<M5ReplayArtifact, M5RuntimeFailure>> {
  const parsed = m5ReplayArtifactSchema.safeParse(input);
  if (!parsed.success)
    return err(
      runtimeFailure(
        "REPLAY_ARTIFACT_MISMATCH",
        "replay",
        "Replay artifact failed schema validation.",
      ),
    );
  const { artifactDigest, ...body } = parsed.data;
  void artifactDigest;
  const actualDigest = await identified(
    body,
    "replay",
    "Replay artifact cannot be identified.",
  );
  if (
    !actualDigest.ok ||
    actualDigest.value !== parsed.data.artifactDigest ||
    parsed.data.artifactDigest !== expectedDigest
  )
    return err(
      runtimeFailure(
        "REPLAY_ARTIFACT_MISMATCH",
        "replay",
        "Replay artifact digest does not match its contents or request.",
      ),
    );
  return ok(parsed.data);
}

async function createArtifact(
  body: z.input<typeof m5ReplayArtifactBodySchema>,
): Promise<Result<M5ReplayArtifact, M5RuntimeFailure>> {
  const parsedBody = m5ReplayArtifactBodySchema.safeParse(body);
  if (!parsedBody.success)
    return err(
      runtimeFailure(
        "RECORDING_FAILED",
        "recording",
        "Replay artifact body failed schema validation.",
      ),
    );
  const artifactDigest = await identified(
    parsedBody.data,
    "recording",
    "Replay artifact cannot be identified.",
  );
  if (!artifactDigest.ok) return artifactDigest;
  return ok(
    m5ReplayArtifactSchema.parse({
      ...parsedBody.data,
      artifactDigest: artifactDigest.value,
    }),
  );
}

function outputMatches(left: M4OracleAnswer, right: M4OracleAnswer): boolean {
  return (
    left.outcome === right.outcome &&
    left.answerValues.length === right.answerValues.length &&
    left.answerValues.every(
      (value, index) => value === right.answerValues[index],
    ) &&
    left.supportingFactIds.length === right.supportingFactIds.length &&
    left.supportingFactIds.every(
      (value, index) => value === right.supportingFactIds[index],
    )
  );
}

function planIdentity(
  summary: NonNullable<ReturnType<typeof inspectExecutablePlan>>,
): M5ReplayArtifact["planIdentity"] {
  return {
    planHash: summary.planHash,
    semanticContractHash: summary.semanticContractHash,
    catalogFingerprint: summary.catalogFingerprint,
  };
}

function validatePlan(
  executablePlan: ExecutablePlan,
  policy: M5TrustedPolicy,
): Result<
  NonNullable<ReturnType<typeof inspectExecutablePlan>>,
  M5RuntimeFailure
> {
  const summary = inspectExecutablePlan(executablePlan);
  if (summary?.planHash !== policy.expectedPlanHash)
    return err(
      runtimeFailure(
        "PLAN_MISMATCH",
        "plan",
        "Executable plan identity does not match trusted policy.",
      ),
    );
  if (summary.semanticContractHash !== policy.expectedSemanticContractHash)
    return err(
      runtimeFailure(
        "SEMANTIC_CONTRACT_MISMATCH",
        "plan",
        "Executable semantic-contract identity does not match trusted policy.",
      ),
    );
  if (!summary.allowedCapabilities.includes(policy.oracleCapability))
    return err(
      runtimeFailure(
        "CAPABILITY_DENIED",
        "plan",
        "Executable plan does not declare the trusted oracle capability.",
      ),
    );
  return ok(summary);
}

function executionFailure(
  captured: M5RuntimeFailure | undefined,
  diagnostics: ReadonlyArray<Readonly<{ code: string }>>,
): M5RuntimeFailure {
  if (captured !== undefined) return captured;
  return diagnostics.some((item) => item.code === "BUDGET_EXCEEDED")
    ? runtimeFailure(
        "BUDGET_EXHAUSTED",
        "execution",
        "Executable plan exhausted its compiled runtime budget.",
      )
    : runtimeFailure(
        "PLAN_EXECUTION_FAILED",
        "execution",
        "Executable plan failed under the evidence runtime.",
      );
}

async function snapshotFromStore(
  store: M5EvidenceStore,
  coordinate: M5SnapshotCoordinate,
  signal: AbortSignal,
): Promise<Result<M5EvidenceSnapshot, M5RuntimeFailure>> {
  if (signal.aborted) return err(cancelled("snapshot"));
  let selected: Result<M5EvidenceSnapshot, M5EvidenceStoreFailure>;
  try {
    selected = await store.snapshot(coordinate, signal);
  } catch (error) {
    return err(
      runtimeFailure(
        "EVIDENCE_STORE_FAILED",
        "snapshot",
        error instanceof Error
          ? `Evidence store failed: ${error.name}.`
          : "Evidence store failed.",
      ),
    );
  }
  if (!selected.ok)
    return err(
      selected.error.code === "CANCELLED"
        ? cancelled("snapshot")
        : runtimeFailure(
            selected.error.code === "SNAPSHOT_MISMATCH"
              ? "EVIDENCE_SNAPSHOT_MISMATCH"
              : "EVIDENCE_STORE_FAILED",
            "snapshot",
            selected.error.message,
          ),
    );
  const identity = m5EvidenceSnapshotIdentitySchema.safeParse(
    selected.value.identity,
  );
  if (
    !identity.success ||
    identity.data.store.id !== store.identity.id ||
    identity.data.store.version !== store.identity.version ||
    identity.data.store.implementation !== store.identity.implementation ||
    identity.data.store.storeDigest !== store.identity.storeDigest ||
    identity.data.coordinate.validAt !== coordinate.validAt ||
    identity.data.coordinate.recordedAt !== coordinate.recordedAt
  )
    return err(
      runtimeFailure(
        "EVIDENCE_SNAPSHOT_MISMATCH",
        "snapshot",
        "Evidence snapshot does not belong to the supplied store identity.",
      ),
    );
  const graph = evidenceGraphSchema.safeParse(selected.value.graph);
  if (!graph.success)
    return err(
      runtimeFailure(
        "MISSING_OR_UNSUPPORTED_FACTS",
        "snapshot",
        "Evidence store returned an invalid graph snapshot.",
      ),
    );
  const canonical = canonicalGraph(graph.data);
  const graphDigest = await identified(
    canonical,
    "snapshot",
    "Evidence graph snapshot cannot be identified.",
  );
  if (
    !graphDigest.ok ||
    graphDigest.value !== identity.data.sourceSnapshotDigest
  )
    return err(
      runtimeFailure(
        "EVIDENCE_SNAPSHOT_MISMATCH",
        "snapshot",
        "Evidence graph does not match its source-snapshot identity.",
      ),
    );
  return ok({
    graph: canonical,
    identity: identity.data,
  });
}

export async function runM5EvidenceRuntime(
  input: M5RunInput,
): Promise<Result<M5RunSuccess, M5RuntimeFailure>> {
  if (input.signal.aborted) return err(cancelled("input"));
  const task = m5PublicTaskContractSchema.safeParse(input.publicTaskContract);
  const policy = m5TrustedPolicySchema.safeParse(input.trustedPolicy);
  const coordinate = m5SnapshotCoordinateSchema.safeParse(input.snapshot);
  const storeIdentity = m5EvidenceStoreIdentitySchema.safeParse(
    input.evidenceStore.identity,
  );
  if (
    !task.success ||
    !policy.success ||
    !coordinate.success ||
    !storeIdentity.success
  )
    return err(
      runtimeFailure(
        "INVALID_INPUT",
        "input",
        "Runtime task, policy, coordinate, or store identity is invalid.",
      ),
    );
  const summary = validatePlan(input.executablePlan, policy.data);
  if (!summary.ok) return summary;
  if (input.inputValues.has(policy.data.oracleInputName))
    return err(
      runtimeFailure(
        "PLAN_MISMATCH",
        "input",
        "Caller inputs must not replace the runtime-owned oracle request.",
      ),
    );
  let inputEntries: ReadonlyArray<z.infer<typeof m5InputEntrySchema>>;
  try {
    inputEntries = orderedInputEntries(input.inputValues);
  } catch {
    return err(
      runtimeFailure(
        "INVALID_INPUT",
        "input",
        "Runtime input values must be canonical JSON values with valid names.",
      ),
    );
  }
  const effectIdentity = m5OracleEffectIdentitySchema.safeParse(
    input.oracle.effect.identity,
  );
  if (!effectIdentity.success)
    return err(
      runtimeFailure(
        "INVALID_INPUT",
        "input",
        "Oracle effect identity is invalid.",
      ),
    );
  const effectIdentityDigest = await validateEffectIdentity(
    effectIdentity.data,
  );
  if (!effectIdentityDigest.ok) return effectIdentityDigest;
  const snapshot = await snapshotFromStore(
    input.evidenceStore,
    coordinate.data,
    input.signal,
  );
  if (!snapshot.ok) return snapshot;
  if (
    input.expectedStorageSnapshotDigest !== undefined &&
    snapshot.value.identity.storageSnapshotDigest !==
      input.expectedStorageSnapshotDigest
  )
    return err(
      runtimeFailure(
        "EVIDENCE_SNAPSHOT_MISMATCH",
        "snapshot",
        "Pinned evidence snapshot differs from the expected identity.",
      ),
    );
  const compiled = await compileM4EvidenceView({
    graphInput: snapshot.value.graph,
    queryInput: taskQuery(task.data, coordinate.data),
    providerProfileInput: policy.data.providerProfile,
    taskProfileInput: {
      taskClass: task.data.taskClass,
      answerContract: task.data.answerContract,
    },
    policyInput: compilerPolicy(policy.data),
  });
  if (!compiled.ok)
    return err(
      runtimeFailure(
        compiled.error.code === "INVALID_GRAPH"
          ? "MISSING_OR_UNSUPPORTED_FACTS"
          : "VISIBLE_VIEW_MISMATCH",
        "compilation",
        compiled.error.message,
        m4Issues(compiled.error),
      ),
    );
  if (
    policy.data.evidence.kind === "lexical-default" &&
    compiled.value.identity.selectedView !== "lexical-facts"
  )
    return err(
      runtimeFailure(
        "VISIBLE_VIEW_MISMATCH",
        "compilation",
        "Default evidence compilation did not select lexical facts.",
      ),
    );
  if (
    input.expectedVisibleViewDigest !== undefined &&
    compiled.value.identity.visibleViewDigest !==
      input.expectedVisibleViewDigest
  )
    return err(
      runtimeFailure(
        "VISIBLE_VIEW_MISMATCH",
        "compilation",
        "Compiled visible view differs from the expected identity.",
      ),
    );
  const oracleRequest = m4d1OracleRequestSchema.parse({
    instruction: task.data.instruction,
    answerContract: task.data.answerContract,
    evidence: compiled.value.modelVisibleContext,
    wireRepair: null,
    semanticRepair: null,
  });
  const requestDigest = await identified(
    oracleRequest,
    "oracle",
    "Reduced oracle request cannot be identified.",
  );
  if (!requestDigest.ok) return requestDigest;
  let captured: CapturedOracle | undefined;
  let capturedFailure: M5RuntimeFailure | undefined;
  const handler = buildEffectHandler({
    expectedRequest: oracleRequest,
    expectedRequestDigest: requestDigest.value,
    trustedPolicy: policy.data,
    interpreter: input.oracle,
    signal: input.signal,
    capture: (value) => {
      captured = value;
    },
    fail: (failure) => {
      capturedFailure = failure;
    },
  });
  const executionInputs = new Map<string, unknown>(
    inputEntries.map((entry) => [entry.name, entry.value]),
  );
  executionInputs.set(policy.data.oracleInputName, oracleRequest);
  const execution = await executePlan(input.executablePlan, {
    inputs: executionInputs,
    effectHandler: handler,
    clock: { now: () => "1970-01-01T00:00:00.000Z" },
    runIdProvider: { next: () => `m5-${requestDigest.value}` },
  });
  if (!execution.ok)
    return err(executionFailure(capturedFailure, execution.error.diagnostics));
  if (captured === undefined)
    return err(
      runtimeFailure(
        "PLAN_MISMATCH",
        "execution",
        "Executable plan completed without invoking the bound oracle effect.",
      ),
    );
  const output = m4OracleAnswerSchema.safeParse(execution.value.output);
  if (!output.success || !outputMatches(output.data, captured.output))
    return err(
      runtimeFailure(
        "PLAN_MISMATCH",
        "execution",
        "Executable output differs from the bound oracle output.",
      ),
    );
  const visibleFactIds = new Set(
    compiled.value.modelVisibleContext.facts.map((fact) => fact.id),
  );
  if (
    captured.output.supportingFactIds.some(
      (factId) => !visibleFactIds.has(factId),
    )
  )
    return err(
      runtimeFailure(
        "MISSING_OR_UNSUPPORTED_FACTS",
        "validation",
        "Oracle output references facts outside visible evidence.",
      ),
    );
  const provenance = await reconstructM4Provenance({
    compiledViewInput: compiled.value,
    oracleAnswerInput: captured.output,
  });
  if (!provenance.ok)
    return err(
      runtimeFailure(
        provenance.error.code === "SEMANTIC_OBLIGATION_FAILED"
          ? "ORACLE_SEMANTIC_REJECTED"
          : "PROVENANCE_RECONSTRUCTION_FAILED",
        provenance.error.code === "SEMANTIC_OBLIGATION_FAILED"
          ? "validation"
          : "provenance",
        provenance.error.message,
        m4Issues(provenance.error),
      ),
    );
  const taskContractDigest = await identified(
    task.data,
    "input",
    "Public task contract cannot be identified.",
  );
  if (!taskContractDigest.ok) return taskContractDigest;
  const trustedPolicyDigest = await identified(
    policy.data,
    "input",
    "Trusted policy cannot be identified.",
  );
  if (!trustedPolicyDigest.ok) return trustedPolicyDigest;
  const result = await createRuntimeResult({
    summary: summary.value,
    taskContractDigest: taskContractDigest.value,
    trustedPolicyDigest: trustedPolicyDigest.value,
    snapshot: snapshot.value,
    compiled: compiled.value,
    effectIdentity: effectIdentity.data,
    effectIdentityDigest: effectIdentityDigest.value,
    oracle: captured.output,
    usage: captured.wireResult.usage,
    budget: policy.data.budget,
    provenance: provenance.value,
    mode: input.oracle.mode,
  });
  if (!result.ok) return result;
  const artifact = await createArtifact({
    protocol: "lachesis-production-evidence-runtime-recording/1",
    planIdentity: planIdentity(summary.value),
    publicTaskContract: task.data,
    taskContractDigest: taskContractDigest.value,
    trustedPolicy: policy.data,
    trustedPolicyDigest: trustedPolicyDigest.value,
    inputEntries,
    evidenceSnapshot: snapshot.value,
    compiledView: compiled.value,
    oracle: {
      interpreterMode: input.oracle.mode,
      identity: effectIdentity.data,
      identityDigest: effectIdentityDigest.value,
      request: oracleRequest,
      requestDigest: requestDigest.value,
      wireResult: captured.wireResult,
      output: captured.output,
    },
    replayEntries: [captured.replayEntry],
    result: result.value,
  });
  if (!artifact.ok) return artifact;
  let saved: Result<void, M5RuntimeFailure>;
  try {
    saved = await input.recordingStore.save(artifact.value, input.signal);
  } catch {
    return err(
      runtimeFailure(
        "RECORDING_FAILED",
        "recording",
        "Recording store failed while saving the replay artifact.",
      ),
    );
  }
  return saved.ok
    ? ok({
        result: result.value,
        artifactDigest: artifact.value.artifactDigest,
      })
    : saved;
}

export async function replayM5EvidenceRuntime(
  input: M5ReplayInput,
): Promise<Result<M5RuntimeResult, M5RuntimeFailure>> {
  if (input.signal.aborted) return err(cancelled("replay"));
  let loaded: Result<M5ReplayArtifact | undefined, M5RuntimeFailure>;
  try {
    loaded = await input.recordingStore.load(
      input.artifactDigest,
      input.signal,
    );
  } catch {
    return err(
      runtimeFailure(
        "REPLAY_ARTIFACT_MISMATCH",
        "replay",
        "Recording store failed while loading the replay artifact.",
      ),
    );
  }
  if (!loaded.ok) return loaded;
  if (loaded.value === undefined)
    return err(
      runtimeFailure(
        "REPLAY_ARTIFACT_MISMATCH",
        "replay",
        "Requested replay artifact does not exist.",
      ),
    );
  const artifact = await validateArtifact(loaded.value, input.artifactDigest);
  if (!artifact.ok) return artifact;
  const task = m5PublicTaskContractSchema.safeParse(input.publicTaskContract);
  const policy = m5TrustedPolicySchema.safeParse(input.trustedPolicy);
  if (!task.success || !policy.success)
    return err(
      runtimeFailure(
        "INVALID_INPUT",
        "replay",
        "Replay task or trusted policy is invalid.",
      ),
    );
  const summary = validatePlan(input.executablePlan, policy.data);
  if (!summary.ok) return summary;
  const [taskDigest, policyDigest] = await Promise.all([
    identified(task.data, "replay", "Replay task cannot be identified."),
    identified(policy.data, "replay", "Replay policy cannot be identified."),
  ]);
  if (!taskDigest.ok) return taskDigest;
  if (!policyDigest.ok) return policyDigest;
  if (
    taskDigest.value !== artifact.value.taskContractDigest ||
    policyDigest.value !== artifact.value.trustedPolicyDigest ||
    summary.value.planHash !== artifact.value.planIdentity.planHash ||
    summary.value.semanticContractHash !==
      artifact.value.planIdentity.semanticContractHash ||
    summary.value.catalogFingerprint !==
      artifact.value.planIdentity.catalogFingerprint
  )
    return err(
      runtimeFailure(
        "REPLAY_ARTIFACT_MISMATCH",
        "replay",
        "Replay request or contract identity differs from the recording.",
      ),
    );
  const graphDigest = await identified(
    canonicalGraph(artifact.value.evidenceSnapshot.graph),
    "replay",
    "Recorded evidence snapshot cannot be identified.",
  );
  if (
    !graphDigest.ok ||
    graphDigest.value !==
      artifact.value.evidenceSnapshot.identity.sourceSnapshotDigest ||
    artifact.value.compiledView.identity.sourceSnapshotDigest !==
      artifact.value.evidenceSnapshot.identity.sourceSnapshotDigest
  )
    return err(
      runtimeFailure(
        "EVIDENCE_SNAPSHOT_MISMATCH",
        "replay",
        "Recorded source graph or compiled view differs from the pinned snapshot.",
      ),
    );
  const requestDigest = await identified(
    artifact.value.oracle.request,
    "replay",
    "Recorded oracle request cannot be identified.",
  );
  if (
    !requestDigest.ok ||
    requestDigest.value !== artifact.value.oracle.requestDigest
  )
    return err(
      runtimeFailure(
        "REPLAY_ARTIFACT_MISMATCH",
        "replay",
        "Recorded oracle request identity is invalid.",
      ),
    );
  const executionInputs = new Map<string, unknown>(
    artifact.value.inputEntries.map((entry) => [entry.name, entry.value]),
  );
  executionInputs.set(
    policy.data.oracleInputName,
    artifact.value.oracle.request,
  );
  const execution = await executePlan(input.executablePlan, {
    inputs: executionInputs,
    effectHandler: createReplayEffectHandler(artifact.value.replayEntries),
    clock: { now: () => "1970-01-01T00:00:00.000Z" },
    runIdProvider: { next: () => `m5-${requestDigest.value}` },
  });
  if (!execution.ok)
    return err(
      runtimeFailure(
        "REPLAY_ARTIFACT_MISMATCH",
        "replay",
        "Recorded effect could not replay under the exact executable identity.",
      ),
    );
  const replayOutput = m4OracleAnswerSchema.safeParse(execution.value.output);
  if (
    !replayOutput.success ||
    !outputMatches(replayOutput.data, artifact.value.oracle.output)
  )
    return err(
      runtimeFailure(
        "REPLAY_ARTIFACT_MISMATCH",
        "replay",
        "Replay output differs from the recorded reduced oracle output.",
      ),
    );
  const provenance = await reconstructM4Provenance({
    compiledViewInput: artifact.value.compiledView,
    oracleAnswerInput: artifact.value.oracle.output,
  });
  if (
    !provenance.ok ||
    provenance.value.reconstructionDigest !==
      artifact.value.result.reconstructionDigest
  )
    return err(
      runtimeFailure(
        "PROVENANCE_RECONSTRUCTION_FAILED",
        "replay",
        "Deterministic provenance does not match the recording.",
      ),
    );
  const resultDigest = await identified(
    (() => {
      const { resultDigest, ...body } = artifact.value.result;
      void resultDigest;
      return body;
    })(),
    "replay",
    "Recorded result cannot be identified.",
  );
  if (
    !resultDigest.ok ||
    resultDigest.value !== artifact.value.result.resultDigest
  )
    return err(
      runtimeFailure(
        "REPLAY_ARTIFACT_MISMATCH",
        "replay",
        "Recorded runtime result identity is invalid.",
      ),
    );
  return ok(artifact.value.result);
}
