import { execFile } from "node:child_process";
import { access, chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import {
  compileM4EvidenceView,
  createM5OracleEffectIdentity,
  createM5RecordingOracleInterpreter,
  M4A_INITIAL_POLICY,
  M4A_PROVIDER_PROFILES,
  type M4CompiledEvidenceView,
  type M4d1Oracle,
  type M4d1OracleAttempt,
  type M4d1OracleRequest,
  m4d1OracleRequestSchema,
  type M4OracleAnswer,
  type M5EvidenceStore,
  type M5OracleInterpreter,
  type M5TrustedPolicy,
  reconstructM4Provenance,
  replayM5EvidenceRuntime,
  runM5EvidenceRuntime,
} from "@nicia-ai/lachesis-evidence";
import { createM5TypeGraphSqliteEvidenceStore } from "@nicia-ai/lachesis-evidence-typegraph/sqlite";
import { calculateMaximumCostUsdMicros } from "@nicia-ai/lachesis-generator";
import {
  createAnthropicM5b0Oracle,
  createOpenAiM5b0Oracle,
} from "@nicia-ai/lachesis-generator-ai-sdk";

import { acquireCampaignLock } from "./ledger.js";
import { createM3bRawOutputArtifactStore } from "./m3b1-raw-output-store.js";
import type { M5bPilotTask } from "./m5b-corpus.js";
import {
  inspectM5bLedger,
  type M5bBudgetController,
  type M5bBudgetReservation,
  type M5bBudgetStatus,
  openM5bLedger,
} from "./m5b-ledger.js";
import {
  type M5bMaterializedPhase,
  type M5bPhaseManifest,
  validateM5bMaterialization,
} from "./m5b-manifests.js";
import {
  auditM5bRedaction,
  createDurableM5RecordingStore,
  createM5bRecord,
  createM5bRecordStore,
  type M5bDurableAttempt,
  type M5bRecord,
} from "./m5b-store.js";

const execFileAsync = promisify(execFile);

export type M5bLiveAcknowledgement = Readonly<{
  campaignDigest: string;
  experimentDigest: string;
  phaseManifestDigest: string;
  phase: M5bPhaseManifest["phase"];
  maximumCampaignUsdMicros: 5_000_000;
}>;

export type M5bCredentialPresence = Readonly<{
  OPENAI_API_KEY: boolean;
  ANTHROPIC_API_KEY: boolean;
}>;

export type M5bPreflightReport = Readonly<{
  valid: boolean;
  campaignDigest: string;
  experimentDigest: string;
  phaseManifestDigest: string;
  phase: M5bPhaseManifest["phase"];
  initialRecords: number;
  maximumAttempts: number;
  theoreticalCeilingUsdMicros: number;
  missingCredentialNames: ReadonlyArray<"OPENAI_API_KEY" | "ANTHROPIC_API_KEY">;
  budget: M5bBudgetStatus;
  checks: Readonly<{
    materialization: boolean;
    sourceCommit: boolean;
    cleanWorktree: boolean;
    credentials: boolean;
    acknowledgement: boolean;
    completePhaseCapacity: boolean;
    corpusBound: boolean;
  }>;
  liveExecutionPermitted: boolean;
}>;

export type M5bExecutionReport = Readonly<{
  experimentDigest: string;
  phaseManifestDigest: string;
  phase: M5bPhaseManifest["phase"];
  records: number;
  resumed: number;
  providerAttempts: number;
  firstAttemptEndToEndSuccesses: number;
  firstAttemptSemanticSuccesses: number;
  postWireRepairSuccesses: number;
  postSemanticRepairSuccesses: number;
  finalReliableRecords: number;
  preciseClassifications: number;
  missingUsageAttempts: number;
  replayVerifiedRecords: number;
  citationAndProvenanceValidatedAnswers: number;
  terminalClassifications: ReadonlyArray<
    Readonly<{ classification: string; records: number }>
  >;
  budget: M5bBudgetStatus;
  acceptance: Readonly<{
    passed: boolean;
    noProviderOrGraphComparisonClaim: true;
    authorizationCapabilityIdentityBudgetViolations: 0;
  }>;
}>;

type M5bExecutionOracles = Readonly<{
  openai: M4d1Oracle;
  anthropic: M4d1Oracle;
}>;

type PipelineTelemetry = Readonly<{
  requestDigest: string;
  attempts: ReadonlyArray<M5bDurableAttempt>;
  firstAttemptEndToEndSuccess: boolean;
  firstAttemptSemanticSuccess: boolean;
  postWireRepairSuccess: boolean | null;
  postSemanticRepairSuccess: boolean | null;
  finalReliability: boolean;
  terminalClassification: string;
}>;

type MutablePipelineTelemetry = {
  requestDigest: string;
  attempts: Array<M5bDurableAttempt>;
  firstAttemptEndToEndSuccess: boolean;
  firstAttemptSemanticSuccess: boolean;
  postWireRepairSuccess: boolean | null;
  postSemanticRepairSuccess: boolean | null;
  finalReliability: boolean;
  terminalClassification: string;
};

type OracleInvocationResult = Readonly<{
  output: M4OracleAnswer | null;
  successfulAttemptIndex: number | null;
}>;

function failure(message: string): Diagnostic {
  return diagnostic("INVALID_WIRE_SCHEMA", message);
}

function missingCredentials(
  credentials: M5bCredentialPresence,
): ReadonlyArray<"OPENAI_API_KEY" | "ANTHROPIC_API_KEY"> {
  return [
    ...(credentials.OPENAI_API_KEY ? [] : (["OPENAI_API_KEY"] as const)),
    ...(credentials.ANTHROPIC_API_KEY ? [] : (["ANTHROPIC_API_KEY"] as const)),
  ];
}

function acknowledgementMatches(
  materialized: M5bMaterializedPhase,
  acknowledgement: M5bLiveAcknowledgement | undefined,
): boolean {
  return (
    acknowledgement?.campaignDigest === materialized.campaign.campaignDigest &&
    acknowledgement.experimentDigest === materialized.phase.experimentDigest &&
    acknowledgement.phaseManifestDigest ===
      materialized.phase.phaseManifestDigest &&
    acknowledgement.phase === materialized.phase.phase
  );
}

function completePhaseCapacity(
  materialized: M5bMaterializedPhase,
  budget: M5bBudgetStatus,
): boolean {
  return (
    materialized.phase.theoreticalCeiling.maximumCostUsdMicros <=
      budget.remainingUsdMicros &&
    materialized.phase.theoreticalCeiling.providers.every((ceiling) => {
      const provider = budget.providers.find(
        (candidate) => candidate.billingProvider === ceiling.billingProvider,
      );
      return (
        provider !== undefined &&
        ceiling.maximumCostUsdMicros <= provider.remainingUsdMicros
      );
    })
  );
}

function emptyBudget(materialized: M5bMaterializedPhase): M5bBudgetStatus {
  return {
    maximumUsdMicros: materialized.campaign.budgetPool.maxCostUsdMicros,
    consumedUsdMicros: 0,
    remainingUsdMicros: materialized.campaign.budgetPool.maxCostUsdMicros,
    eventCount: 0,
    ledgerHead: null,
    observedProviderBillingUsdMicros: 0,
    authorizedConservativeUsdMicros: 0,
    unsettledReservationUsdMicros: 0,
    providers: materialized.campaign.budgetPool.providerCostCaps.map((cap) => ({
      billingProvider: cap.billingProvider,
      maximumUsdMicros: cap.maxCostUsdMicros,
      consumedUsdMicros: 0,
      remainingUsdMicros: cap.maxCostUsdMicros,
    })),
  };
}

export async function preflightM5b(
  input: Readonly<{
    materialized: M5bMaterializedPhase;
    currentCommit: string;
    cleanWorktree: boolean;
    credentials: M5bCredentialPresence;
    acknowledgement?: M5bLiveAcknowledgement | undefined;
    ledgerPath: string;
  }>,
): Promise<Result<M5bPreflightReport, Diagnostic>> {
  const validated = await validateM5bMaterialization(input.materialized);
  const inspected = await inspectM5bLedger({
    path: input.ledgerPath,
    campaign: input.materialized.campaign,
  });
  const budget = inspected.ok
    ? inspected.value
    : emptyBudget(input.materialized);
  const missingCredentialNames = missingCredentials(input.credentials);
  const taskDigests = new Set(
    input.materialized.corpus.tasks.map((task) => task.taskDigest),
  );
  const checks = {
    materialization: validated.ok,
    sourceCommit: input.currentCommit === input.materialized.phase.sourceCommit,
    cleanWorktree: input.cleanWorktree,
    credentials: missingCredentialNames.length === 0,
    acknowledgement: acknowledgementMatches(
      input.materialized,
      input.acknowledgement,
    ),
    completePhaseCapacity:
      inspected.ok && completePhaseCapacity(input.materialized, budget),
    corpusBound:
      input.materialized.phase.corpusDigest ===
        input.materialized.corpus.corpusDigest &&
      input.materialized.phase.taskBindings.every((task) =>
        taskDigests.has(task.taskDigest),
      ),
  };
  return {
    ok: true,
    value: {
      valid: validated.ok && inspected.ok,
      campaignDigest: input.materialized.campaign.campaignDigest,
      experimentDigest: input.materialized.phase.experimentDigest,
      phaseManifestDigest: input.materialized.phase.phaseManifestDigest,
      phase: input.materialized.phase.phase,
      initialRecords: input.materialized.phase.initialRecords,
      maximumAttempts: input.materialized.phase.maximumAttempts,
      theoreticalCeilingUsdMicros:
        input.materialized.phase.theoreticalCeiling.maximumCostUsdMicros,
      missingCredentialNames,
      budget,
      checks,
      liveExecutionPermitted: Object.values(checks).every((check) => check),
    },
  };
}

function lexicalPolicy(): typeof M4A_INITIAL_POLICY {
  return {
    ...M4A_INITIAL_POLICY,
    id: "m5b-production-lexical-policy",
    rules: M4A_INITIAL_POLICY.rules.map((rule) => ({
      ...rule,
      view: "lexical-facts",
    })),
  };
}

async function compiledView(
  materialized: M5bMaterializedPhase,
  task: M5bPilotTask,
  provider: "openai" | "anthropic",
): Promise<Result<M4CompiledEvidenceView, Diagnostic>> {
  const compiled = await compileM4EvidenceView({
    graphInput: materialized.corpus.graph,
    queryInput: {
      id: task.task.id,
      text: task.task.instruction,
      validAt: task.temporalLens.validAt,
      recordedAt: task.temporalLens.recordedAt,
      ...task.task.evidenceLimits,
    },
    providerProfileInput: M4A_PROVIDER_PROFILES[provider],
    taskProfileInput: {
      taskClass: task.task.taskClass,
      answerContract: task.task.answerContract,
    },
    policyInput: lexicalPolicy(),
  });
  return compiled.ok
    ? { ok: true, value: compiled.value }
    : { ok: false, error: failure(compiled.error.message) };
}

function settlementFor(
  reservation: M5bBudgetReservation,
  attempt: M4d1OracleAttempt,
) {
  if (attempt.kind === "success")
    return {
      ...reservation,
      actualCostUsdMicros: attempt.usage.costUsdMicros,
      conservative: false,
      accountingBasis: "provider-reported" as const,
    };
  if (attempt.dispatchEvidence === "not-dispatched")
    return {
      ...reservation,
      actualCostUsdMicros: 0,
      conservative: false,
      accountingBasis: "not-dispatched" as const,
    };
  if (
    attempt.dispatchEvidence === "dispatched-with-usage" &&
    attempt.usage !== null
  )
    return {
      ...reservation,
      actualCostUsdMicros: attempt.usage.costUsdMicros,
      conservative: false,
      accountingBasis: "provider-reported" as const,
    };
  return {
    ...reservation,
    actualCostUsdMicros: reservation.maximumCostUsdMicros,
    conservative: true,
    accountingBasis: "authorized-conservative" as const,
  };
}

function retryable(code: string): boolean {
  return [
    "provider-overload",
    "provider-timeout",
    "provider-unavailable",
  ].includes(code);
}

async function sanitizedAttempt(
  input: Readonly<{
    attempt: M4d1OracleAttempt;
    attemptIndex: number;
    attemptType: M5bDurableAttempt["attemptType"];
    requestDigest: string;
  }>,
): Promise<Result<M5bDurableAttempt, Diagnostic>> {
  const envelopeDigest = await digestValue({
    providerStatusCode: input.attempt.provenance.providerStatusCode,
    providerErrorCode: input.attempt.provenance.providerErrorCode,
    providerResponseId: input.attempt.provenance.providerResponseId,
    finishReason: input.attempt.provenance.finishReason,
    rawFinishReason: input.attempt.provenance.rawFinishReason,
  });
  if (!envelopeDigest.ok) return envelopeDigest;
  const usage = input.attempt.usage;
  return {
    ok: true,
    value: {
      attemptIndex: input.attemptIndex,
      attemptType: input.attemptType,
      requestDigest: input.requestDigest,
      kind: input.attempt.kind,
      failureCode: input.attempt.kind === "failure" ? input.attempt.code : null,
      dispatchEvidence:
        input.attempt.kind === "success"
          ? "dispatched-with-usage"
          : input.attempt.dispatchEvidence,
      stage: input.attempt.provenance.stage,
      category: input.attempt.provenance.category,
      usage:
        usage === null
          ? null
          : {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              latencyMs: usage.latencyMs,
              costUsdMicros: usage.costUsdMicros,
            },
      outputDigest: input.attempt.provenance.outputDigest,
      outputSizeBytes: input.attempt.provenance.outputSizeBytes,
      providerEnvelopeDigest: envelopeDigest.value,
      issues: input.attempt.provenance.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
      })),
    },
  };
}

async function createBoundedInterpreter(
  input: Readonly<{
    materialized: M5bMaterializedPhase;
    task: M5bPilotTask;
    recordKey: string;
    oracle: M4d1Oracle;
    compiled: M4CompiledEvidenceView;
    budget: M5bBudgetController;
    rawOutputReader: ReturnType<typeof createM3bRawOutputArtifactStore>["read"];
  }>,
): Promise<
  Result<
    Readonly<{
      interpreter: M5OracleInterpreter;
      telemetry: () => PipelineTelemetry;
    }>,
    Diagnostic
  >
> {
  const effectIdentity = await createM5OracleEffectIdentity({
    id: `m5b-${input.oracle.identity.provider}-oracle`,
    version: "1",
    implementation: input.oracle.identity.adapterVersion,
  });
  if (!effectIdentity.ok)
    return { ok: false, error: failure(effectIdentity.error.message) };
  const pricing = input.materialized.phase.pricingSnapshot.entries.find(
    (entry) => entry.billingProvider === input.oracle.identity.provider,
  );
  if (pricing === undefined)
    return { ok: false, error: failure("M5b oracle pricing is missing.") };
  const maximum = calculateMaximumCostUsdMicros(
    pricing,
    input.oracle.identity.settings.maxInputTokens,
    input.oracle.identity.settings.maxOutputTokens,
  );
  if (!maximum.ok) return { ok: false, error: maximum.error };
  const state: MutablePipelineTelemetry = {
    requestDigest: "0".repeat(64),
    attempts: [],
    firstAttemptEndToEndSuccess: false,
    firstAttemptSemanticSuccess: false,
    postWireRepairSuccess: null,
    postSemanticRepairSuccess: null,
    finalReliability: false,
    terminalClassification: "not-started",
  };
  const providerAttempts: Array<M4d1OracleAttempt> = [];
  const usage = { inputTokens: 0, outputTokens: 0, wallClockMs: 0 };
  const invoke = async (
    request: M4d1OracleRequest,
    invocation: "initial" | "wire-repair" | "semantic-repair",
  ): Promise<OracleInvocationResult> => {
    const requestIdentity = await digestValue(request);
    if (!requestIdentity.ok) {
      state.terminalClassification = "request-identity-failed";
      return { output: null, successfulAttemptIndex: null };
    }
    if (invocation === "initial") state.requestDigest = requestIdentity.value;
    for (let retryIndex = 0; retryIndex <= 1; retryIndex += 1) {
      const attemptIndex = state.attempts.length;
      const attemptType =
        retryIndex === 1 ? ("transport-retry" as const) : invocation;
      const reservation: M5bBudgetReservation = {
        experimentDigest: input.materialized.phase.experimentDigest,
        recordKey: input.recordKey,
        attemptIndex,
        billingProvider: input.oracle.identity.provider,
        attemptType,
        maximumCostUsdMicros: maximum.value,
      };
      const reserved = await input.budget.reserve(reservation);
      if (!reserved.ok || reserved.value === "previous-attempt-accounted") {
        state.terminalClassification = reserved.ok
          ? "interrupted-reservation-not-redispatched"
          : "reservation-rejected";
        return { output: null, successfulAttemptIndex: null };
      }
      const attempt = await input.oracle.generate(request, {
        recordKey: input.recordKey,
        attemptIndex,
        invocation,
        transportRetryIndex: retryIndex,
        attemptType,
      });
      const settled = await input.budget.settle(
        settlementFor(reservation, attempt),
      );
      if (!settled.ok) {
        state.terminalClassification = "settlement-failed";
        return { output: null, successfulAttemptIndex: null };
      }
      const durable = await sanitizedAttempt({
        attempt,
        attemptIndex,
        attemptType,
        requestDigest: requestIdentity.value,
      });
      if (!durable.ok) {
        state.terminalClassification = "attempt-identity-failed";
        return { output: null, successfulAttemptIndex: null };
      }
      providerAttempts.push(attempt);
      state.attempts.push(durable.value);
      if (attempt.usage !== null) {
        usage.inputTokens += attempt.usage.inputTokens;
        usage.outputTokens += attempt.usage.outputTokens;
        usage.wallClockMs += attempt.usage.latencyMs;
      }
      if (attempt.kind === "success")
        return { output: attempt.output, successfulAttemptIndex: attemptIndex };
      state.terminalClassification = attempt.code;
      if (!retryable(attempt.code))
        return { output: null, successfulAttemptIndex: null };
    }
    return { output: null, successfulAttemptIndex: null };
  };
  const interpreter = createM5RecordingOracleInterpreter({
    identity: effectIdentity.value,
    async invoke(request) {
      const baseRequest = m4d1OracleRequestSchema.parse(request);
      const initial = await invoke(baseRequest, "initial");
      let output = initial.output;
      let firstValidation =
        output === null
          ? null
          : await reconstructM4Provenance({
              compiledViewInput: input.compiled,
              oracleAnswerInput: output,
            });
      state.firstAttemptSemanticSuccess =
        initial.successfulAttemptIndex === 0 && (firstValidation?.ok ?? false);
      state.firstAttemptEndToEndSuccess = state.firstAttemptSemanticSuccess;
      if (output === null) {
        const failureAttempt = providerAttempts.findLast(
          (attempt) => attempt.kind === "failure",
        );
        if (
          failureAttempt?.kind === "failure" &&
          (failureAttempt.code === "json-parse-failed" ||
            failureAttempt.code === "wire-schema-rejected") &&
          failureAttempt.provenance.rawOutputArtifact !== undefined &&
          failureAttempt.provenance.rawOutputArtifact !== null
        ) {
          const raw = await input.rawOutputReader(
            failureAttempt.provenance.rawOutputArtifact,
          );
          if (!raw.ok)
            return {
              ok: false,
              error: {
                code: "ORACLE_EFFECT_FAILED",
                message: raw.error.message,
              },
            };
          const wireRepairRequest = m4d1OracleRequestSchema.parse({
            ...baseRequest,
            wireRepair: {
              previousRawOutput: raw.value,
              decodingIssues:
                failureAttempt.provenance.issues.length === 0
                  ? [
                      {
                        code: failureAttempt.code,
                        path: [],
                        message:
                          "The prior output failed staged wire decoding.",
                      },
                    ]
                  : failureAttempt.provenance.issues,
            },
            semanticRepair: null,
          });
          const wireRepair = await invoke(wireRepairRequest, "wire-repair");
          output = wireRepair.output;
          state.postWireRepairSuccess = output !== null;
          firstValidation =
            output === null
              ? null
              : await reconstructM4Provenance({
                  compiledViewInput: input.compiled,
                  oracleAnswerInput: output,
                });
        }
      }
      if (output === null) {
        state.finalReliability = false;
        return {
          ok: false,
          error: {
            code: "ORACLE_EFFECT_FAILED",
            message: `M5b oracle ended at ${state.terminalClassification}.`,
          },
        };
      }
      if (firstValidation !== null && !firstValidation.ok) {
        const repairRequest = m4d1OracleRequestSchema.parse({
          ...baseRequest,
          wireRepair: null,
          semanticRepair: {
            previousOutput: output,
            obligationIssues: firstValidation.error.issues.map((issue) => ({
              code: issue.code,
              path: issue.path,
              message: "The prior output failed a public semantic obligation.",
            })),
          },
        });
        output = (await invoke(repairRequest, "semantic-repair")).output;
        const repaired =
          output === null
            ? null
            : await reconstructM4Provenance({
                compiledViewInput: input.compiled,
                oracleAnswerInput: output,
              });
        state.postSemanticRepairSuccess = repaired?.ok ?? false;
        firstValidation = repaired;
      }
      if (output === null || !firstValidation?.ok) {
        state.finalReliability = false;
        state.terminalClassification =
          output === null
            ? state.terminalClassification
            : "semantic-obligation-failed";
        return {
          ok: false,
          error: {
            code: "ORACLE_EFFECT_FAILED",
            message: `M5b oracle ended at ${state.terminalClassification}.`,
          },
        };
      }
      const wire = canonicalizeJson(output);
      if (!wire.ok)
        return {
          ok: false,
          error: {
            code: "ORACLE_EFFECT_FAILED",
            message: "M5b oracle output could not be serialized.",
          },
        };
      state.finalReliability = true;
      state.terminalClassification = "completed";
      return {
        ok: true,
        value: {
          wireText: wire.value,
          replayResultId: `${input.recordKey}:${state.attempts.length}`,
          usage,
        },
      };
    },
  });
  return {
    ok: true,
    value: {
      interpreter,
      telemetry: () => ({
        requestDigest: state.requestDigest,
        attempts: [...state.attempts],
        firstAttemptEndToEndSuccess: state.firstAttemptEndToEndSuccess,
        firstAttemptSemanticSuccess: state.firstAttemptSemanticSuccess,
        postWireRepairSuccess: state.postWireRepairSuccess,
        postSemanticRepairSuccess: state.postSemanticRepairSuccess,
        finalReliability: state.finalReliability,
        terminalClassification: state.terminalClassification,
      }),
    },
  };
}

function logicalBudget(): M5TrustedPolicy["budget"] {
  return {
    maxCalls: 1,
    maxInputTokens: 48_000,
    maxOutputTokens: 12_000,
    maxTotalTokens: 60_000,
    maxWallClockMs: 720_000,
    maxConcurrency: 1,
  };
}

function policy(
  materialized: M5bMaterializedPhase,
  provider: "openai" | "anthropic",
): M5TrustedPolicy {
  return {
    id: "m5b-production-pilot-policy",
    version: "1",
    expectedPlanHash: materialized.phase.planIdentity.planHash,
    expectedSemanticContractHash:
      materialized.phase.planIdentity.semanticContractHash,
    providerProfile: M4A_PROVIDER_PROFILES[provider],
    oracleInputName: "request",
    oracleEffectName: "m5b.oracle",
    oracleCapability: "evidence.oracle",
    evidence: { kind: "lexical-default" },
    budget: logicalBudget(),
  };
}

async function executeRecord(
  input: Readonly<{
    materialized: M5bMaterializedPhase;
    task: M5bPilotTask;
    recordKey: string;
    provider: "openai" | "anthropic";
    oracle: M4d1Oracle;
    evidenceStore: M5EvidenceStore;
    budgetController: M5bBudgetController;
    experimentRoot: string;
  }>,
): Promise<Result<M5bRecord, Diagnostic>> {
  const compiled = await compiledView(
    input.materialized,
    input.task,
    input.provider,
  );
  if (!compiled.ok) return compiled;
  const rawOutputs = createM3bRawOutputArtifactStore(
    join(input.experimentRoot, "private-artifacts", "raw-output"),
  );
  const bounded = await createBoundedInterpreter({
    materialized: input.materialized,
    task: input.task,
    recordKey: input.recordKey,
    oracle: input.oracle,
    compiled: compiled.value,
    budget: input.budgetController,
    rawOutputReader: rawOutputs.read,
  });
  if (!bounded.ok) return bounded;
  const recordingStore = createDurableM5RecordingStore(
    join(input.experimentRoot, "private-artifacts"),
  );
  const run = await runM5EvidenceRuntime({
    executablePlan: input.materialized.executablePlan,
    publicTaskContract: input.task.task,
    inputValues: new Map(),
    trustedPolicy: policy(input.materialized, input.provider),
    evidenceStore: input.evidenceStore,
    snapshot: {
      validAt: input.task.temporalLens.validAt,
      recordedAt: input.task.temporalLens.recordedAt,
    },
    expectedVisibleViewDigest: compiled.value.identity.visibleViewDigest,
    oracle: bounded.value.interpreter,
    recordingStore,
    signal: new AbortController().signal,
  });
  const telemetry = bounded.value.telemetry();
  const result = run.ok ? run.value.result : null;
  return createM5bRecord({
    protocol: "m5b-production-pilot-record/1",
    recordKey: input.recordKey,
    experimentDigest: input.materialized.phase.experimentDigest,
    phaseManifestDigest: input.materialized.phase.phaseManifestDigest,
    corpusDigest: input.materialized.corpus.corpusDigest,
    taskId: input.task.task.id,
    taskDigest: input.task.taskDigest,
    provider: input.provider,
    model: input.oracle.identity.model,
    requestDigest: telemetry.requestDigest,
    attempts: telemetry.attempts,
    firstAttemptEndToEndSuccess: telemetry.firstAttemptEndToEndSuccess,
    firstAttemptSemanticSuccess: telemetry.firstAttemptSemanticSuccess,
    postWireRepairSuccess: telemetry.postWireRepairSuccess,
    postSemanticRepairSuccess: telemetry.postSemanticRepairSuccess,
    finalReliability: run.ok && telemetry.finalReliability,
    terminalClassification: run.ok
      ? telemetry.terminalClassification
      : run.error.code,
    replayArtifactDigest: run.ok ? run.value.artifactDigest : null,
    runtimeResultDigest: result?.resultDigest ?? null,
    citationCount: result?.citations.length ?? 0,
    provenanceReconstructionDigest: result?.reconstructionDigest ?? null,
  });
}

function report(
  materialized: M5bMaterializedPhase,
  records: ReadonlyArray<M5bRecord>,
  resumed: number,
  replayVerifiedRecords: number,
  budget: M5bBudgetStatus,
): M5bExecutionReport {
  const preciseClassifications = records.filter((record) =>
    record.attempts.every(
      (attempt) => attempt.stage.length > 0 && attempt.category.length > 0,
    ),
  ).length;
  const missingUsageAttempts = records.reduce(
    (total, record) =>
      total +
      record.attempts.filter(
        (attempt) =>
          attempt.dispatchEvidence !== "not-dispatched" &&
          attempt.usage === null,
      ).length,
    0,
  );
  const finalReliableRecords = records.filter(
    (record) => record.finalReliability,
  ).length;
  const citationAndProvenanceValidatedAnswers = records.filter(
    (record) =>
      record.finalReliability &&
      record.citationCount > 0 &&
      record.provenanceReconstructionDigest !== null,
  ).length;
  const everyRecordComplete =
    records.length === materialized.phase.initialRecords;
  const passed =
    everyRecordComplete &&
    preciseClassifications === records.length &&
    missingUsageAttempts === 0 &&
    replayVerifiedRecords === records.length &&
    finalReliableRecords === records.length;
  const terminalClassifications = [
    ...new Set(records.map((record) => record.terminalClassification)),
  ]
    .toSorted()
    .map((classification) => ({
      classification,
      records: records.filter(
        (record) => record.terminalClassification === classification,
      ).length,
    }));
  return {
    experimentDigest: materialized.phase.experimentDigest,
    phaseManifestDigest: materialized.phase.phaseManifestDigest,
    phase: materialized.phase.phase,
    records: records.length,
    resumed,
    providerAttempts: records.reduce(
      (total, record) => total + record.attempts.length,
      0,
    ),
    firstAttemptEndToEndSuccesses: records.filter(
      (record) => record.firstAttemptEndToEndSuccess,
    ).length,
    firstAttemptSemanticSuccesses: records.filter(
      (record) => record.firstAttemptSemanticSuccess,
    ).length,
    postWireRepairSuccesses: records.filter(
      (record) => record.postWireRepairSuccess === true,
    ).length,
    postSemanticRepairSuccesses: records.filter(
      (record) => record.postSemanticRepairSuccess === true,
    ).length,
    finalReliableRecords,
    preciseClassifications,
    missingUsageAttempts,
    replayVerifiedRecords,
    citationAndProvenanceValidatedAnswers,
    terminalClassifications,
    budget,
    acceptance: {
      passed,
      noProviderOrGraphComparisonClaim: true,
      authorizationCapabilityIdentityBudgetViolations: 0,
    },
  };
}

async function verifyReplays(
  input: Readonly<{
    materialized: M5bMaterializedPhase;
    records: ReadonlyArray<M5bRecord>;
    experimentRoot: string;
  }>,
): Promise<Result<number, Diagnostic>> {
  const recordingStore = createDurableM5RecordingStore(
    join(input.experimentRoot, "private-artifacts"),
  );
  let verified = 0;
  for (const record of input.records) {
    if (record.replayArtifactDigest === null) continue;
    const task = input.materialized.corpus.tasks.find(
      (candidate) => candidate.task.id === record.taskId,
    );
    if (task === undefined)
      return { ok: false, error: failure("Replay task is missing.") };
    const replay = await replayM5EvidenceRuntime({
      executablePlan: input.materialized.executablePlan,
      publicTaskContract: task.task,
      trustedPolicy: policy(input.materialized, record.provider),
      artifactDigest: record.replayArtifactDigest,
      recordingStore,
      signal: new AbortController().signal,
    });
    if (!replay.ok || replay.value.resultDigest !== record.runtimeResultDigest)
      return { ok: false, error: failure("Exact M5b replay failed.") };
    verified += 1;
  }
  return { ok: true, value: verified };
}

export async function executeM5b(
  input: Readonly<{
    materialized: M5bMaterializedPhase;
    storageRoot: string;
    currentCommit: string;
    cleanWorktree: boolean;
    acknowledgement: M5bLiveAcknowledgement;
    credentials: Readonly<{ openaiApiKey: string; anthropicApiKey: string }>;
    oracles?: M5bExecutionOracles | undefined;
  }>,
): Promise<Result<M5bExecutionReport, Diagnostic>> {
  const ledgerPath = join(
    input.storageRoot,
    input.materialized.campaign.campaignDigest,
    "ledger.ndjson",
  );
  const preflight = await preflightM5b({
    materialized: input.materialized,
    currentCommit: input.currentCommit,
    cleanWorktree: input.cleanWorktree,
    credentials: {
      OPENAI_API_KEY: input.credentials.openaiApiKey.length > 0,
      ANTHROPIC_API_KEY: input.credentials.anthropicApiKey.length > 0,
    },
    acknowledgement: input.acknowledgement,
    ledgerPath,
  });
  if (!preflight.ok) return preflight;
  if (!preflight.value.liveExecutionPermitted)
    return {
      ok: false,
      error: diagnostic(
        "BUDGET_EXCEEDED",
        "M5b live preflight did not explicitly permit execution.",
      ),
    };
  const lock = await acquireCampaignLock(ledgerPath);
  if (!lock.ok) return lock;
  const experimentRoot = join(
    input.storageRoot,
    input.materialized.phase.storageNamespace,
  );
  const privateArtifactsRoot = join(experimentRoot, "private-artifacts");
  await mkdir(privateArtifactsRoot, { recursive: true, mode: 0o700 });
  await Promise.all([
    chmod(experimentRoot, 0o700),
    chmod(privateArtifactsRoot, 0o700),
  ]);
  const managed = await createM5TypeGraphSqliteEvidenceStore({
    graphInput: input.materialized.corpus.graph,
    path: join(privateArtifactsRoot, "evidence.sqlite"),
  });
  if (!managed.ok) {
    await lock.value.release();
    return { ok: false, error: failure(managed.error.message) };
  }
  try {
    const ledger = await openM5bLedger({
      path: ledgerPath,
      campaign: input.materialized.campaign,
    });
    if (!ledger.ok) return ledger;
    const registered = await ledger.value.registerManifest(
      input.materialized.phase,
    );
    if (!registered.ok) return registered;
    const recordStore = createM5bRecordStore(experimentRoot);
    const rawOutputs = createM3bRawOutputArtifactStore(
      join(experimentRoot, "private-artifacts", "raw-output"),
    );
    const oracles = input.oracles ?? {
      openai: createOpenAiM5b0Oracle(
        { apiKey: input.credentials.openaiApiKey },
        { rawOutputWriter: rawOutputs.write },
      ),
      anthropic: createAnthropicM5b0Oracle({
        acknowledgeAdaptiveThinking: true,
        provider: { apiKey: input.credentials.anthropicApiKey },
        rawOutputWriter: rawOutputs.write,
      }),
    };
    const records: Array<M5bRecord> = [];
    let resumed = 0;
    for (const scheduled of input.materialized.phase.schedule.records) {
      const prior = await recordStore.load(scheduled.recordKey);
      if (!prior.ok) return prior;
      if (prior.value !== undefined) {
        records.push(prior.value);
        resumed += 1;
        continue;
      }
      const task = input.materialized.corpus.tasks.find(
        (candidate) => candidate.task.id === scheduled.taskId,
      );
      if (task === undefined)
        return { ok: false, error: failure("Scheduled M5b task is missing.") };
      const oracle = oracles[scheduled.provider];
      const executed = await executeRecord({
        materialized: input.materialized,
        task,
        recordKey: scheduled.recordKey,
        provider: scheduled.provider,
        oracle,
        evidenceStore: managed.value.store,
        budgetController: ledger.value.budgetController(
          input.materialized.phase,
        ),
        experimentRoot,
      });
      if (!executed.ok) return executed;
      const redaction = await auditM5bRedaction({
        value: executed.value,
        forbiddenValues: [
          input.credentials.openaiApiKey,
          input.credentials.anthropicApiKey,
        ],
      });
      if (!redaction.ok || redaction.value.leaked.length > 0)
        return {
          ok: false,
          error: failure("M5b durable record leaked a credential."),
        };
      const saved = await recordStore.save(executed.value);
      if (!saved.ok) return saved;
      records.push(executed.value);
    }
    const replay = await verifyReplays({
      materialized: input.materialized,
      records,
      experimentRoot,
    });
    if (!replay.ok) return replay;
    return {
      ok: true,
      value: report(
        input.materialized,
        records,
        resumed,
        replay.value,
        ledger.value.status(),
      ),
    };
  } finally {
    await managed.value.close();
    await lock.value.release();
  }
}

export async function generateStoredM5bReport(
  input: Readonly<{
    materialized: M5bMaterializedPhase;
    storageRoot: string;
  }>,
): Promise<Result<M5bExecutionReport, Diagnostic>> {
  const experimentRoot = join(
    input.storageRoot,
    input.materialized.phase.storageNamespace,
  );
  const records = await createM5bRecordStore(experimentRoot).list();
  if (!records.ok) return records;
  const replay = await verifyReplays({
    materialized: input.materialized,
    records: records.value,
    experimentRoot,
  });
  if (!replay.ok) return replay;
  const budget = await inspectM5bLedger({
    path: join(
      input.storageRoot,
      input.materialized.campaign.campaignDigest,
      "ledger.ndjson",
    ),
    campaign: input.materialized.campaign,
  });
  if (!budget.ok) return budget;
  return {
    ok: true,
    value: report(
      input.materialized,
      records.value,
      records.value.length,
      replay.value,
      budget.value,
    ),
  };
}

export async function inspectGitState(
  repositoryRoot: string,
): Promise<Result<Readonly<{ commit: string; clean: boolean }>, Diagnostic>> {
  try {
    const [commit, status] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }),
      execFileAsync("git", ["status", "--porcelain"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }),
    ]);
    return {
      ok: true,
      value: {
        commit: commit.stdout.trim(),
        clean: status.stdout.trim().length === 0,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: failure(
        `Unable to inspect Git state: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
}

export async function noExecutionStateExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch {
    return true;
  }
}
