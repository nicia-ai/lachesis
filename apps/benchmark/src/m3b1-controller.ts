import { join } from "node:path";

import { type Diagnostic, diagnostic, type Result } from "@nicia-ai/lachesis";
import {
  type M3bAttemptProvenance,
  type M3bOracle,
  type M3bOracleAttempt,
  type M3bRunResult,
  runM3bWithOracles,
} from "@nicia-ai/lachesis-evidence";
import { calculateMaximumCostUsdMicros } from "@nicia-ai/lachesis-generator";
import {
  createAnthropicM3bOracle,
  createOpenAiM3bOracle,
} from "@nicia-ai/lachesis-generator-ai-sdk";

import { acquireCampaignLock } from "./ledger.js";
import {
  type M3b1BudgetController,
  type M3b1BudgetReservation,
  type M3b1BudgetSettlement,
  type M3b1BudgetStatus,
  openM3b1Ledger,
} from "./m3b1-ledger.js";
import {
  M3B_OFFLINE_DESIGN_IDENTITIES,
  type M3b1MaterializedPhase,
  validateM3b1Materialization,
} from "./m3b1-manifests.js";
import { createM3bRawOutputArtifactStore } from "./m3b1-raw-output-store.js";
import { createJsonFileM3b1Store } from "./m3b1-store.js";

export type M3b1LiveAcknowledgement = Readonly<{
  campaignDigest: string;
  experimentDigest: string;
  phase: M3b1MaterializedPhase["phase"]["phase"];
  operationalPoolUsdMicros: number;
}>;

export type M3b1CredentialPresence = Readonly<{
  OPENAI_API_KEY: boolean;
  ANTHROPIC_API_KEY: boolean;
}>;

export type M3b1PreflightReport = Readonly<{
  valid: boolean;
  campaignDigest: string;
  experimentDigest: string;
  phaseManifestDigest: string;
  phase: M3b1MaterializedPhase["phase"]["phase"];
  executionDisposition:
    | "live-capable"
    | "report-only-offline-unbound"
    | "complete-protocol-fail"
    | "complete-protocol-pass"
    | "complete-semantic-gate-fail"
    | "complete-calibration-fail"
    | "complete-calibration-pass"
    | "blocked-unexecuted"
    | "superseded-unexecuted";
  initialCalls: number;
  maximumTransportRetries: number;
  maximumCalls: number;
  semanticRepairCalls: number;
  wireRepairCalls: number;
  theoreticalCeilingUsdMicros: number;
  operationalPoolUsdMicros: number;
  missingCredentialNames: ReadonlyArray<"OPENAI_API_KEY" | "ANTHROPIC_API_KEY">;
  checks: Readonly<{
    materialization: boolean;
    sourceCommit: boolean;
    cleanWorktree: boolean;
    credentials: boolean;
    acknowledgement: boolean;
    perRequestReservationsFit: boolean;
    completePhaseReservationsFit: boolean;
  }>;
  liveExecutionPermitted: boolean;
}>;

export function m3bExecutionDisposition(
  experimentDigest: string,
): M3b1PreflightReport["executionDisposition"] {
  return (
    M3B_OFFLINE_DESIGN_IDENTITIES.find(
      (identity) => identity.experimentDigest === experimentDigest,
    )?.disposition ?? "live-capable"
  );
}

function acknowledgementMatches(
  materialized: M3b1MaterializedPhase,
  acknowledgement: M3b1LiveAcknowledgement | undefined,
): boolean {
  return (
    acknowledgement?.campaignDigest === materialized.campaign.campaignDigest &&
    acknowledgement.experimentDigest === materialized.phase.experimentDigest &&
    acknowledgement.phase === materialized.phase.phase &&
    acknowledgement.operationalPoolUsdMicros ===
      materialized.phase.operationalPool.maxCostUsdMicros
  );
}

function missingCredentials(
  credentials: M3b1CredentialPresence,
): ReadonlyArray<"OPENAI_API_KEY" | "ANTHROPIC_API_KEY"> {
  return [
    ...(credentials.OPENAI_API_KEY ? [] : (["OPENAI_API_KEY"] as const)),
    ...(credentials.ANTHROPIC_API_KEY ? [] : (["ANTHROPIC_API_KEY"] as const)),
  ];
}

function reservationsFit(materialized: M3b1MaterializedPhase): boolean {
  return materialized.phase.theoreticalCeiling.providers.every((provider) => {
    const cap = materialized.phase.operationalPool.providerCostCaps.find(
      (candidate) => candidate.billingProvider === provider.billingProvider,
    );
    const perRequest = provider.maximumCostUsdMicros / provider.maximumCalls;
    return (
      Number.isSafeInteger(perRequest) &&
      cap !== undefined &&
      perRequest <= cap.maxCostUsdMicros &&
      perRequest <= materialized.phase.operationalPool.maxCostUsdMicros
    );
  });
}

function completePhaseReservationsFit(
  materialized: M3b1MaterializedPhase,
): boolean {
  return (
    materialized.phase.theoreticalCeiling.maximumCostUsdMicros <=
      materialized.phase.operationalPool.maxCostUsdMicros &&
    materialized.phase.theoreticalCeiling.providers.every((provider) => {
      const cap = materialized.phase.operationalPool.providerCostCaps.find(
        (candidate) => candidate.billingProvider === provider.billingProvider,
      );
      return (
        cap !== undefined &&
        provider.maximumCostUsdMicros <= cap.maxCostUsdMicros
      );
    })
  );
}

export async function preflightM3b1(input: {
  readonly materialized: M3b1MaterializedPhase;
  readonly currentCommit: string;
  readonly cleanWorktree: boolean;
  readonly credentials: M3b1CredentialPresence;
  readonly acknowledgement?: M3b1LiveAcknowledgement | undefined;
}): Promise<M3b1PreflightReport> {
  const validated = await validateM3b1Materialization(input.materialized);
  const historicalDisposition = m3bExecutionDisposition(
    input.materialized.phase.experimentDigest,
  );
  const disposition = historicalDisposition;
  const missingCredentialNames = missingCredentials(input.credentials);
  const checks = {
    materialization: validated.ok,
    sourceCommit: input.currentCommit === input.materialized.phase.sourceCommit,
    cleanWorktree: input.cleanWorktree,
    credentials: missingCredentialNames.length === 0,
    acknowledgement: acknowledgementMatches(
      input.materialized,
      input.acknowledgement,
    ),
    perRequestReservationsFit: reservationsFit(input.materialized),
    completePhaseReservationsFit: completePhaseReservationsFit(
      input.materialized,
    ),
  };
  const liveExecutionPermitted =
    disposition === "live-capable" &&
    Object.values(checks).every((passed) => passed);
  return {
    valid: validated.ok,
    campaignDigest: input.materialized.campaign.campaignDigest,
    experimentDigest: input.materialized.phase.experimentDigest,
    phaseManifestDigest: input.materialized.phase.phaseManifestDigest,
    phase: input.materialized.phase.phase,
    executionDisposition: disposition,
    initialCalls: input.materialized.phase.initialCalls,
    maximumTransportRetries: input.materialized.phase.maximumTransportRetries,
    maximumCalls: input.materialized.phase.maximumCalls,
    semanticRepairCalls: input.materialized.phase.semanticRepairCalls,
    wireRepairCalls: input.materialized.phase.wireRepairCalls,
    theoreticalCeilingUsdMicros:
      input.materialized.phase.theoreticalCeiling.maximumCostUsdMicros,
    operationalPoolUsdMicros:
      input.materialized.phase.operationalPool.maxCostUsdMicros,
    missingCredentialNames,
    checks,
    liveExecutionPermitted,
  };
}

function settlement(
  reservation: M3b1BudgetReservation,
  result: M3bOracleAttempt,
): M3b1BudgetSettlement {
  if (result.kind === "success")
    return {
      ...reservation,
      actualCostUsdMicros: result.usage.costUsdMicros,
      conservative: false,
      accountingBasis: "provider-reported",
    };
  if (result.dispatchEvidence === "not-dispatched")
    return {
      ...reservation,
      actualCostUsdMicros: 0,
      conservative: false,
      accountingBasis: "not-dispatched",
    };
  if (
    result.dispatchEvidence === "dispatched-with-usage" &&
    result.usage !== null
  )
    return {
      ...reservation,
      actualCostUsdMicros: result.usage.costUsdMicros,
      conservative: false,
      accountingBasis: "provider-reported",
    };
  return {
    ...reservation,
    actualCostUsdMicros: reservation.maximumCostUsdMicros,
    conservative: true,
    accountingBasis: "authorized-conservative",
  };
}

function controllerProvenance(
  stage: "pre-dispatch" | "provider-response",
  category: string,
  usageAvailable: boolean,
): M3bAttemptProvenance {
  return {
    stage,
    category,
    providerStatusCode: null,
    providerErrorCode: null,
    providerResponseId: null,
    finishReason: null,
    rawFinishReason: null,
    usageAvailable,
    outputPresent: false,
    outputDigest: null,
    outputSizeBytes: null,
    outputTruncated: false,
    issues: [],
  };
}

function budgetedOracle(input: {
  readonly materialized: M3b1MaterializedPhase;
  readonly oracle: M3bOracle;
  readonly controller: M3b1BudgetController;
}): Result<M3bOracle, Diagnostic> {
  const pricing = input.materialized.phase.pricingSnapshot.entries.find(
    (entry) => entry.billingProvider === input.oracle.identity.provider,
  );
  if (pricing === undefined)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M3b.1 oracle has no frozen pricing entry.",
      ),
    };
  const maximum = calculateMaximumCostUsdMicros(
    pricing,
    input.oracle.identity.settings.maxInputTokens,
    input.oracle.identity.settings.maxOutputTokens,
  );
  if (!maximum.ok) return maximum;
  return {
    ok: true,
    value: {
      identity: input.oracle.identity,
      async generate(request, context) {
        const reservation: M3b1BudgetReservation = {
          experimentDigest: input.materialized.phase.experimentDigest,
          recordKey: context.recordKey,
          attemptIndex: context.attemptIndex,
          billingProvider: input.oracle.identity.provider,
          attemptType: context.attemptType,
          maximumCostUsdMicros: maximum.value,
        };
        const reserved = await input.controller.reserve(reservation);
        if (!reserved.ok)
          return {
            kind: "failure",
            code: "budget-rejected",
            dispatchEvidence: "not-dispatched",
            usage: null,
            provenance: controllerProvenance(
              "pre-dispatch",
              "budget-rejected",
              false,
            ),
          };
        if (reserved.value === "previous-attempt-accounted")
          return {
            kind: "failure",
            code: "provider-unavailable",
            dispatchEvidence: "dispatched-usage-unknown",
            usage: null,
            provenance: controllerProvenance(
              "provider-response",
              "previous-attempt-accounted",
              false,
            ),
          };
        const result = await input.oracle.generate(request, context);
        const settled = await input.controller.settle(
          settlement(reservation, result),
        );
        return settled.ok
          ? result
          : {
              kind: "failure",
              code: "budget-rejected",
              dispatchEvidence:
                result.kind === "failure"
                  ? result.dispatchEvidence
                  : "dispatched-with-usage",
              usage: result.usage,
              provenance: controllerProvenance(
                "provider-response",
                "budget-settlement-failed",
                result.usage !== null,
              ),
            };
      },
    },
  };
}

export type M3b1ExecutionReport = Readonly<{
  experimentDigest: string;
  phaseManifestDigest: string;
  run: M3bRunResult;
  budget: M3b1BudgetStatus;
  providerAttempts: ReadonlyArray<
    Readonly<{
      provider: string;
      attempts: number;
      retries: number;
      wireRepairs: number;
      semanticRepairs: number;
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      observedCostUsdMicros: number;
      terminalFailures: number;
    }>
  >;
  outcomeStages: Readonly<{
    firstAttemptEndToEndSuccesses: number;
    firstAttemptSemanticSuccesses: number;
    postWireRepairSuccesses: number;
    finalPostSemanticRepairSuccesses: number;
  }>;
  protocolProbeGate: Readonly<{
    applicable: boolean;
    nonOpaqueOutcomes: number;
    durableResponseUsageClassifications: number;
    correctTypedOutcomes: number;
    firstAttemptContractCorrectOutcomes: number;
    repairedOutcomes: number;
    providerCategoryCoverage: number;
    unauthorizedOrIdentityMismatchedCalls: 0;
    passed: boolean;
  }>;
  wireStressProbeGate: Readonly<{
    applicable: boolean;
    preciseDecodingClassifications: number;
    sdkRuntimeSchemaDisagreements: number;
    anthropicGraphAdjacencyFirstAttemptWireFailures: number;
    graphAdjacencyTrialsByProvider: Readonly<Record<string, number>>;
    matchedGraphFactsTrialsByProvider: Readonly<Record<string, number>>;
    opaqueFailures: number;
    unauthorizedOrIdentityMismatchedCalls: 0;
    passed: boolean;
  }>;
}>;

function executionReport(
  materialized: M3b1MaterializedPhase,
  run: M3bRunResult,
  budget: M3b1BudgetStatus,
): M3b1ExecutionReport {
  const providerAttempts = materialized.phase.providerBindings.map(
    (binding) => {
      const records = run.records.filter(
        (record) => record.provider === binding.provider,
      );
      const attempts = records.flatMap((record) => record.attempts);
      const semanticRepairs = records.reduce(
        (total, record) => total + record.semanticRepairCalls,
        0,
      );
      const wireRepairs = records.reduce(
        (total, record) => total + (record.wireRepairCalls ?? 0),
        0,
      );
      return {
        provider: binding.provider,
        attempts: attempts.length,
        retries:
          attempts.length - records.length - semanticRepairs - wireRepairs,
        wireRepairs,
        semanticRepairs,
        inputTokens: attempts.reduce(
          (total, attempt) => total + (attempt.usage?.inputTokens ?? 0),
          0,
        ),
        outputTokens: attempts.reduce(
          (total, attempt) => total + (attempt.usage?.outputTokens ?? 0),
          0,
        ),
        latencyMs: attempts.reduce(
          (total, attempt) =>
            total +
            (attempt.usage?.latencyMs ??
              (attempt.kind === "failure" ? (attempt.latencyMs ?? 0) : 0)),
          0,
        ),
        observedCostUsdMicros: attempts.reduce(
          (total, attempt) => total + (attempt.usage?.costUsdMicros ?? 0),
          0,
        ),
        terminalFailures: records.filter(
          (record) => record.terminalFailure !== null,
        ).length,
      };
    },
  );
  const applicable = materialized.phase.phase === "m3b-protocol-probe";
  const nonOpaqueOutcomes = run.records.filter((record) =>
    record.attempts.every(
      (attempt) =>
        attempt.provenance.category.length > 0 &&
        attempt.provenance.stage.length > 0,
    ),
  ).length;
  const durableResponseUsageClassifications = run.records.filter((record) =>
    record.attempts.every(
      (attempt) =>
        attempt.provenance.usageAvailable === (attempt.usage !== null) &&
        (attempt.kind === "failure" || attempt.provenance.outputPresent),
    ),
  ).length;
  const correctTypedOutcomes = run.records.filter(
    (record) => record.endToEndSuccess,
  ).length;
  const firstAttemptContractCorrectOutcomes = run.records.filter(
    (record) => record.firstAttemptSemanticValidationPassed,
  ).length;
  const repairedOutcomes = run.records.filter(
    (record) => record.semanticRepairSucceeded === true,
  ).length;
  const providerCategoryCoverage = new Set(
    run.records.flatMap((record) => {
      const category = materialized.substrate.cases.find(
        (candidate) => candidate.task.id === record.caseId,
      )?.task.category;
      return category === undefined ? [] : [`${record.provider}:${category}`];
    }),
  ).size;
  const protocolProbeGate = {
    applicable,
    nonOpaqueOutcomes,
    durableResponseUsageClassifications,
    correctTypedOutcomes,
    firstAttemptContractCorrectOutcomes,
    repairedOutcomes,
    providerCategoryCoverage,
    unauthorizedOrIdentityMismatchedCalls: 0 as const,
    passed:
      applicable &&
      run.records.length === 48 &&
      nonOpaqueOutcomes === 48 &&
      durableResponseUsageClassifications === 48 &&
      correctTypedOutcomes === 48 &&
      providerCategoryCoverage === 12,
  };
  const precise = (record: M3bRunResult["records"][number]): boolean =>
    record.attempts.every(
      (attempt) =>
        attempt.provenance.stage.length > 0 &&
        attempt.provenance.category.length > 0 &&
        attempt.provenance.jsonParseResult !== undefined &&
        attempt.provenance.wireSchemaResult !== undefined &&
        (attempt.kind !== "failure" ||
          (attempt.code !== "json-parse-failed" &&
            attempt.code !== "wire-schema-rejected") ||
          (attempt.provenance.rawOutputArtifact !== undefined &&
            attempt.provenance.rawOutputArtifact !== null &&
            attempt.provenance.errorClass !== undefined &&
            attempt.provenance.errorClass !== null &&
            attempt.provenance.sanitizedMessage !== undefined &&
            attempt.provenance.sanitizedMessage !== null)),
    );
  const graphAdjacencyTrialsByProvider = Object.fromEntries(
    materialized.phase.providerBindings.map((binding) => [
      binding.provider,
      run.records.filter(
        (record) =>
          record.provider === binding.provider &&
          record.arm === "graph-adjacency",
      ).length,
    ]),
  );
  const matchedGraphFactsTrialsByProvider = Object.fromEntries(
    materialized.phase.providerBindings.map((binding) => [
      binding.provider,
      run.records.filter(
        (record) =>
          record.provider === binding.provider && record.arm === "graph-facts",
      ).length,
    ]),
  );
  const preciseDecodingClassifications = run.records.filter(precise).length;
  const sdkRuntimeSchemaDisagreements = run.records.filter((record) =>
    record.attempts.some(
      (attempt) =>
        attempt.provenance.category === "sdk-runtime-schema-disagreement",
    ),
  ).length;
  const anthropicGraphAdjacencyFirstAttemptWireFailures = run.records.filter(
    (record) =>
      record.provider === "anthropic" &&
      record.arm === "graph-adjacency" &&
      record.attempts[0]?.kind === "failure" &&
      (record.attempts[0].code === "json-parse-failed" ||
        record.attempts[0].code === "wire-schema-rejected"),
  ).length;
  const opaqueFailures = run.records.filter((record) =>
    record.attempts.some(
      (attempt) =>
        attempt.kind === "failure" &&
        (attempt.provenance.category.length === 0 ||
          attempt.provenance.stage.length === 0),
    ),
  ).length;
  const wireStressApplicable =
    materialized.phase.phase === "m3b-wire-stress-probe";
  const wireStressProbeGate = {
    applicable: wireStressApplicable,
    preciseDecodingClassifications,
    sdkRuntimeSchemaDisagreements,
    anthropicGraphAdjacencyFirstAttemptWireFailures,
    graphAdjacencyTrialsByProvider,
    matchedGraphFactsTrialsByProvider,
    opaqueFailures,
    unauthorizedOrIdentityMismatchedCalls: 0 as const,
    passed:
      wireStressApplicable &&
      run.records.length === 96 &&
      preciseDecodingClassifications === 96 &&
      sdkRuntimeSchemaDisagreements === 0 &&
      anthropicGraphAdjacencyFirstAttemptWireFailures === 0 &&
      opaqueFailures === 0 &&
      Object.values(graphAdjacencyTrialsByProvider).every(
        (count) => count === 24,
      ) &&
      Object.values(matchedGraphFactsTrialsByProvider).every(
        (count) => count === 24,
      ),
  };
  return {
    experimentDigest: materialized.phase.experimentDigest,
    phaseManifestDigest: materialized.phase.phaseManifestDigest,
    run,
    budget,
    providerAttempts,
    outcomeStages: {
      firstAttemptEndToEndSuccesses: run.records.filter(
        (record) => record.firstAttemptEndToEndSuccess,
      ).length,
      firstAttemptSemanticSuccesses: run.records.filter(
        (record) => record.firstAttemptSemanticValidationPassed,
      ).length,
      postWireRepairSuccesses: run.records.filter(
        (record) => record.postWireRepairSuccess === true,
      ).length,
      finalPostSemanticRepairSuccesses: run.records.filter(
        (record) => record.endToEndSuccess,
      ).length,
    },
    protocolProbeGate,
    wireStressProbeGate,
  };
}

export async function executeM3b1(input: {
  readonly materialized: M3b1MaterializedPhase;
  readonly storageRoot: string;
  readonly currentCommit: string;
  readonly cleanWorktree: boolean;
  readonly acknowledgement: M3b1LiveAcknowledgement;
  readonly credentials: Readonly<{
    openaiApiKey: string;
    anthropicApiKey: string;
  }>;
  readonly oracles?: ReadonlyArray<M3bOracle> | undefined;
}): Promise<Result<M3b1ExecutionReport, Diagnostic>> {
  const preflight = await preflightM3b1({
    materialized: input.materialized,
    currentCommit: input.currentCommit,
    cleanWorktree: input.cleanWorktree,
    credentials: {
      OPENAI_API_KEY: input.credentials.openaiApiKey.length > 0,
      ANTHROPIC_API_KEY: input.credentials.anthropicApiKey.length > 0,
    },
    acknowledgement: input.acknowledgement,
  });
  if (!preflight.liveExecutionPermitted)
    return {
      ok: false,
      error: diagnostic(
        "BUDGET_EXCEEDED",
        "M3b.1 live preflight did not explicitly permit execution.",
      ),
    };
  const ledgerPath = join(
    input.storageRoot,
    input.materialized.phase.milestone.replace(".", ""),
    input.materialized.campaign.campaignDigest,
    "ledger.ndjson",
  );
  const lock = await acquireCampaignLock(ledgerPath);
  if (!lock.ok) return lock;
  try {
    const ledger = await openM3b1Ledger({
      path: ledgerPath,
      campaign: input.materialized.campaign,
    });
    if (!ledger.ok) return ledger;
    const registered = await ledger.value.registerManifest(
      input.materialized.phase,
    );
    if (!registered.ok) return registered;
    const controller = ledger.value.budgetController(input.materialized.phase);
    const experimentRoot = join(
      input.storageRoot,
      input.materialized.phase.storageNamespace,
    );
    const rawOutputArtifacts = createM3bRawOutputArtifactStore(
      join(experimentRoot, "raw-output"),
    );
    const oracles = input.oracles ?? [
      createOpenAiM3bOracle(
        { apiKey: input.credentials.openaiApiKey },
        { rawOutputWriter: rawOutputArtifacts.write },
      ),
      createAnthropicM3bOracle({
        acknowledgeAdaptiveThinking: true,
        provider: { apiKey: input.credentials.anthropicApiKey },
        rawOutputWriter: rawOutputArtifacts.write,
      }),
    ];
    const budgeted: Array<M3bOracle> = [];
    for (const oracle of oracles) {
      const wrapped = budgetedOracle({
        materialized: input.materialized,
        oracle,
        controller,
      });
      if (!wrapped.ok) return wrapped;
      budgeted.push(wrapped.value);
    }
    const store = createJsonFileM3b1Store(experimentRoot);
    const run = await runM3bWithOracles({
      materialized: input.materialized.substrate,
      oracles: budgeted,
      store,
      rawOutputReader: rawOutputArtifacts.read,
      executionBinding: {
        experimentDigest: input.materialized.phase.experimentDigest,
        phaseManifestDigest: input.materialized.phase.phaseManifestDigest,
        pricingSnapshotDigest: input.materialized.phase.pricingSnapshot.digest,
        providerBindings: input.materialized.phase.providerBindings.map(
          (binding) => ({
            provider: binding.provider,
            transportDigest: binding.transportDigest,
            pricingEntryDigest: binding.pricingEntryDigest,
          }),
        ),
      },
    });
    if (!run.ok) return run;
    return {
      ok: true,
      value: executionReport(
        input.materialized,
        run.value,
        ledger.value.status(input.materialized.phase.budgetPoolId),
      ),
    };
  } finally {
    await lock.value.release();
  }
}
