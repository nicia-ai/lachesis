import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import { M9B0_MATCHED_MODEL_ENVELOPE } from "./m9b0-comparison.js";
import {
  M9B1_ARTIFACT_BOUND_DISCOVERY_PROTOCOL,
  M9B1_MATCHED_MODEL_ENVELOPE,
  m9b1InternalInspectArtifactBoundVerifiedTerminalRecord,
} from "./m9b1-discovery.js";
import {
  auditM9b2SplitDisjointness,
  inspectM9b2PreparedSuite,
  inspectM9b3dTrustedGold,
  M9B2_CORPUS_SCALES,
  M9B2_EVALUATOR_IDENTITY,
  M9B2_MEASUREMENT_PROTOCOL,
  M9B2_PRIMARY_ENDPOINT,
  M9B2_TASK_FAMILIES,
  type M9b2CorpusScale,
  m9b2CorpusScaleSchema,
  type M9b2PreparedSuite,
  type M9b2TaskFamily,
  m9b2TaskFamilySchema,
  type M9b3dEvaluatorArtifact,
  m9b3dEvaluatorArtifactSchema,
  m9b3dGoldArtifactIdentitySchema,
  type M9b3dTrustedGold,
  type M9b3ePairedMeasurementVerification,
  type M9b3eTerminalMeasurementRecord,
  measureM9b3eVerifiedTerminalRecord,
} from "./m9b2-measurement.js";

export const M9B3_PREPARATION_PROTOCOL = Object.freeze({
  id: "lachesis-m9b3e-offline-prospective-study-preparation",
  version: "1.0.0",
  visibility: "internal-offline-preparation-only" as const,
  claimBoundary:
    "prospective construction and binding rules only; no corpus, provider adapter, credential, provider call, execution state, preregistration, authorization, or scientific result",
});

const M9B3_AUTHORING_RESERVATION = Object.freeze({
  maxInputTokens: 32_768,
  maxOutputTokens: 65_536,
});
const M9B3_MAXIMUM_SINGLE_REQUEST_TOKENS = Math.max(
  M9B0_MATCHED_MODEL_ENVELOPE.maxInputTokens +
    M9B0_MATCHED_MODEL_ENVELOPE.maxOutputTokens,
  M9B3_AUTHORING_RESERVATION.maxInputTokens +
    M9B3_AUTHORING_RESERVATION.maxOutputTokens,
);
const M9B3_PREPARED_PAIRED_CASES = 24 + 168;
const M9B3_PROBE_PAIRED_CASES = 24;
const M9B3_PRIMARY_PAIRED_CASES = 168;
const M9B3_CELL_COUNT = 24;
const M9B3_SCALE_BASE_BYTES = 4_096;
const M9B3_PROBE_COMPONENT_ALPHA_BASIS_POINTS = 250;
const M9B3_PRIMARY_ALPHA_BASIS_POINTS = 500;
const M9B3_TARGET_POWER_BASIS_POINTS = 8_000;
const M9B3_CONFIDENCE_BISECTIONS = 80;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/u);
const safeCountSchema = z.number().int().nonnegative().max(1_000_000_000_000);

const versionedIdentitySchema = z
  .strictObject({
    id: identifierSchema,
    version: identifierSchema,
  })
  .readonly();

const historicalDevelopmentBaselineSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3c-trusted-development-baseline/1"),
    suiteDigest: digestSchema,
    inventoryDigest: digestSchema,
    trustSource: z.literal("independently-reviewed-m9b2-development-baseline"),
  })
  .readonly();
export type M9b3HistoricalDevelopmentBaseline = z.infer<
  typeof historicalDevelopmentBaselineSchema
>;

const m9b3ProviderProfileInputSchema = z
  .strictObject({
    provider: versionedIdentitySchema,
    requestProtocol: z
      .strictObject({
        providerId: identifierSchema,
        id: identifierSchema,
        version: identifierSchema,
      })
      .readonly(),
    requestSerializer: z
      .strictObject({
        providerId: identifierSchema,
        requestProtocolId: identifierSchema,
        id: identifierSchema,
        version: identifierSchema,
        schemaDigest: digestSchema,
      })
      .readonly(),
    model: z
      .strictObject({
        providerId: identifierSchema,
        id: identifierSchema,
        revision: identifierSchema,
        contextWindowTokens: z.number().int().positive().max(10_000_000),
        maximumOutputTokens: z.number().int().positive().max(10_000_000),
        reasoningMode: z.literal("disabled"),
      })
      .readonly(),
    tokenizer: z
      .strictObject({
        providerId: identifierSchema,
        modelId: identifierSchema,
        id: identifierSchema,
        version: identifierSchema,
        artifactDigest: digestSchema,
        conformanceVectorDigest: digestSchema,
        countsExactSerializedRequests: z.literal(true),
        countsExactSerializedResponses: z.literal(true),
      })
      .readonly(),
    pricing: z
      .strictObject({
        providerId: identifierSchema,
        modelId: identifierSchema,
        currency: z.literal("USD"),
        inputUsdMicrosPerMillionTokens: safeCountSchema,
        outputUsdMicrosPerMillionTokens: safeCountSchema,
        reasoningUsdMicrosPerMillionTokens: z.literal(0),
        snapshotId: identifierSchema,
        sourceDigest: digestSchema,
      })
      .readonly(),
  })
  .superRefine((profile, context) => {
    if (
      profile.model.providerId !== profile.provider.id ||
      profile.requestProtocol.providerId !== profile.provider.id ||
      profile.requestSerializer.providerId !== profile.provider.id ||
      profile.requestSerializer.requestProtocolId !==
        profile.requestProtocol.id ||
      profile.tokenizer.providerId !== profile.provider.id ||
      profile.pricing.providerId !== profile.provider.id ||
      profile.tokenizer.modelId !== profile.model.id ||
      profile.pricing.modelId !== profile.model.id
    )
      context.addIssue({
        code: "custom",
        message:
          "M9b.3e provider, model, tokenizer, and pricing identities differ.",
      });
    if (
      profile.model.contextWindowTokens < M9B3_MAXIMUM_SINGLE_REQUEST_TOKENS ||
      profile.model.maximumOutputTokens <
        M9B3_AUTHORING_RESERVATION.maxOutputTokens
    )
      context.addIssue({
        code: "custom",
        message: "M9b.3e candidate model cannot contain the frozen envelope.",
      });
  })
  .readonly();

export type M9b3ProviderProfileInput = z.infer<
  typeof m9b3ProviderProfileInputSchema
>;

const m9b3PreparationInputSchema = z
  .strictObject({
    providerProfile: m9b3ProviderProfileInputSchema,
    promptBundleDigest: digestSchema,
    scheduleSeedCommitment: digestSchema,
    historicalDevelopmentBaseline: historicalDevelopmentBaselineSchema,
  })
  .readonly();
export type M9b3PreparationInput = z.infer<typeof m9b3PreparationInputSchema>;

const studyBindingsSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3a-study-bindings/1"),
    programDiscovery: z
      .strictObject({
        id: z.literal(M9B1_ARTIFACT_BOUND_DISCOVERY_PROTOCOL.id),
        version: z.literal(M9B1_ARTIFACT_BOUND_DISCOVERY_PROTOCOL.version),
        promptBundleDigest: digestSchema,
      })
      .readonly(),
    measurement: z
      .strictObject({
        id: z.literal(M9B2_MEASUREMENT_PROTOCOL.id),
        version: z.literal(M9B2_MEASUREMENT_PROTOCOL.version),
        primaryEndpoint: z.literal(M9B2_PRIMARY_ENDPOINT),
        inferenceAudit: z.literal("lachesis-m9b2d-m9c-inference-unit-audit/3"),
        descriptiveReport: z.literal("lachesis-m9b2d-m9c-descriptive-report/4"),
        splitAudit: z.literal("lachesis-m9b2d-split-disjointness-audit/5"),
      })
      .readonly(),
    developmentEvaluator: z
      .strictObject({
        id: z.literal(M9B2_EVALUATOR_IDENTITY.id),
        version: z.literal(M9B2_EVALUATOR_IDENTITY.version),
        campaignEligible: z.literal(false),
      })
      .readonly(),
    finalGoldIdentity: z.literal("absent-pending-independent-validation"),
    finalEvaluatorIdentity: z.literal("absent-pending-independent-validation"),
  })
  .readonly();

const scaleRangeSchema = z
  .strictObject({
    scale: m9b2CorpusScaleSchema,
    multiplier: z.union([z.literal(1), z.literal(8), z.literal(32)]),
    targetBytes: z.number().int().positive(),
    minimumBytesInclusive: z.number().int().positive(),
    maximumBytesInclusive: z.number().int().positive(),
  })
  .readonly();

const M9B3_SCALE_RANGES = Object.freeze(
  [
    { scale: "1x", multiplier: 1 },
    { scale: "8x", multiplier: 8 },
    { scale: "32x", multiplier: 32 },
  ].map(({ scale, multiplier }) => {
    const targetBytes = M9B3_SCALE_BASE_BYTES * multiplier;
    return scaleRangeSchema.parse({
      scale,
      multiplier,
      targetBytes,
      minimumBytesInclusive: (targetBytes * 3) / 4,
      maximumBytesInclusive: (targetBytes * 5) / 4,
    });
  }),
);

const corpusScaleProtocolSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3a-corpus-scale-validation/1"),
    metric: z.literal(
      "m9a-snapshot-corpusbytes-canonical-nfc-document-text-utf8-bytes",
    ),
    baseBytes: z.literal(M9B3_SCALE_BASE_BYTES),
    acceptanceRule: z.literal(
      "claimed-scale-range-is-inclusive-and-ranges-do-not-overlap",
    ),
    ranges: z.tuple([scaleRangeSchema, scaleRangeSchema, scaleRangeSchema]),
    outOfRangeBehavior: z.literal("reject-corpus-before-suite-binding"),
  })
  .readonly();

const matchedBudgetSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3a-complete-effects-budget/1"),
    inputTokensPerArm: z.literal(M9B1_MATCHED_MODEL_ENVELOPE.maxInputTokens),
    outputTokensPerArm: z.literal(M9B1_MATCHED_MODEL_ENVELOPE.maxOutputTokens),
    reasoningTokensPerArm: z.literal(0),
    modelTimeMsPerArm: z.literal(M9B1_MATCHED_MODEL_ENVELOPE.maxWallClockMs),
    maximumSearchCalls: z.literal(4),
    maximumReadCalls: z.literal(4),
    maximumReadBytes: z.literal(4_096),
    maximumDiscoveredModelCalls: z.literal(6),
    maximumStaticModelCalls: z.literal(2),
    evaluatorExecution: z.literal(
      "deterministic-local-arm-blind-zero-provider-effects",
    ),
    evaluatorProviderCalls: z.literal(0),
    evaluatorModelTokens: z.literal(0),
    evaluatorCostUsdMicros: z.literal(0),
    sdkTransportRetriesPerLogicalRequest: z.literal(0),
    controllerDispatchRetriesPerLogicalRequest: z.literal(0),
    maximumProviderAttemptsPerLogicalRequest: z.literal(1),
    maximumLogicalProviderRequestsPerPair: z.literal(8),
    maximumProviderAttemptsPerPair: z.literal(8),
    maximumPreparedProviderAttempts: z.literal(1_536),
    retryFailureBehavior: z.literal("first-dispatch-failure-is-terminal"),
    maximumCostUsdMicrosPerArm: safeCountSchema,
    preparedPairedCases: z.literal(M9B3_PREPARED_PAIRED_CASES),
    maximumPreparedStudyCostUsdMicros: safeCountSchema,
    preDispatchReservationRequired: z.literal(true),
    actualUsageReconciliationRequired: z.literal(true),
    sameAggregateCeilingAcrossArms: z.literal(true),
    spendingAuthorized: z.literal(false),
  })
  .readonly();

const corpusConstructionSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3a-natural-corpus-construction/1"),
    timing: z.literal(
      "only-after-external-preregistration-before-any-provider-call",
    ),
    roles: z
      .tuple([
        z.literal("independent-corpus-constructor"),
        z.literal("independent-gold-annotator"),
        z.literal("blind-split-auditor"),
      ])
      .readonly(),
    taskFamilies: z
      .tuple([
        z.literal("lookup"),
        z.literal("join"),
        z.literal("multi-hop"),
        z.literal("temporal-retraction"),
        z.literal("contradiction"),
        z.literal("aggregation"),
        z.literal("insufficient-evidence"),
        z.literal("prompt-injection"),
      ])
      .readonly(),
    corpusScales: z
      .tuple([z.literal("1x"), z.literal("8x"), z.literal("32x")])
      .readonly(),
    scaleValidation: corpusScaleProtocolSchema,
    documentSubstrate: z.literal(
      "natural-text-documents-substrate-neutral-no-typegraph-requirement",
    ),
    searchPrimitive: z.literal(
      "one-frozen-deterministic-lexical-search-shared-by-both-arms",
    ),
    independenceUnit: z.literal(
      "one-semantic-problem-with-no-shared-entity-source-template-answer-fact-or-content-lineage",
    ),
    scalePolicy: z.literal(
      "scale-is-a-stratum-and-same-problem-scale-clusters-are-reserved-for-m9d",
    ),
    requiredSplitAuditProtocol: z.literal(
      "lachesis-m9b2d-split-disjointness-audit/5",
    ),
    requiredGold: z.literal(
      "snapshot-bound-supporting-facts-answers-abstentions-and-citation-contracts",
    ),
    promptInjectionCasesRequired: z.literal(true),
    finalCorpusMaterialized: z.literal(false),
    finalCorpusIdentity: z.literal("absent"),
  })
  .readonly();

const allocationSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3e-balanced-allocation/1"),
    cells: z.literal(24),
    protocolProbePairedCases: z.literal(24),
    protocolProbeCasesPerCell: z.literal(1),
    primaryPairedCases: z.literal(168),
    primaryCasesPerCell: z.literal(7),
    practicalPairedCaseCeiling: z.literal(480),
    weighting: z.literal("equal-family-by-scale-cell-weight"),
    probeExcludedFromPrimaryAnalysis: z.literal(true),
    primaryPopulationFixedBeforePrimaryExecution: z.literal(true),
    populationBindingProtocol: z.literal(
      "lachesis-m9b3e-prospective-population-binding/1",
    ),
    historicalDevelopmentBaseline: historicalDevelopmentBaselineSchema,
    probeSuiteIdentity: z.literal("absent-pending-corpus-construction"),
    primarySuiteIdentity: z.literal("absent-pending-corpus-construction"),
    completeInventoriesRequired: z.literal(true),
    allThreePairwiseM9b2dSplitAuditsRequired: z.literal(true),
    primaryReportCoverage: z.literal(
      "exact-complete-primary-suite-token-required-by-m9b2d",
    ),
    allocationMaterialized: z.literal(false),
  })
  .readonly();

const scheduleSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3e-paired-counterbalance-schedule/1"),
    unit: z.literal("one-paired-case"),
    arms: z
      .tuple([z.literal("discovered-program"), z.literal("static-one-shot")])
      .readonly(),
    algorithm: z.literal(
      "canonical-sha256-cell-balanced-paired-counterbalance/1",
    ),
    canonicalHashEncoding: z.literal(
      "lachesis-canonical-json-utf8-sha256-digestvalue",
    ),
    seedCommitmentFrame: z.literal("protocol-purpose-and-256-bit-seed-reveal"),
    cellOrderFrame: z.literal("protocol-seed-population-family-and-scale"),
    caseOrderFrame: z.literal(
      "protocol-seed-population-suite-inventory-case-semantic-snapshot-family-and-scale",
    ),
    executionOrderFrame: z.literal(
      "protocol-seed-population-and-case-order-key",
    ),
    tieBreak: z.literal("ascending-canonical-identifier-code-unit-order"),
    oddCellRule: z.literal(
      "hash-sort-24-cells-alternate-leading-arm-then-alternate-within-cell",
    ),
    phaseRule: z.literal(
      "all-probe-cases-before-gate-and-primary-cases-only-after-pass",
    ),
    seedCommitment: digestSchema,
    seedRevealTiming: z.literal(
      "after-complete-corpus-and-gold-freeze-before-provider-adapter-preflight",
    ),
    distinctSessionsPerArmAndRole: z.literal(true),
    sessionReuseAcrossCases: z.literal(false),
    scheduleMaterialized: z.literal(false),
    scheduleDigest: z.literal("absent"),
  })
  .readonly();

const probeGateProtocolSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3e-probe-advancement-gate/1"),
    endpoint: z.literal(M9B2_PRIMARY_ENDPOINT),
    statistic: z.literal(
      "first-attempt-discovered-only-static-only-and-concordant-pair-counts",
    ),
    sourceBoundary: z.literal(
      "complete-opaque-probe-suite-plus-24-paired-m9b3e-predispatch-artifact-terminal-measurements",
    ),
    requiredBindings: z.literal(
      "preparation-supplement-opaque-gold-scoring-source-evaluator-artifact-output-schema-validation-population-schedule-endpoint-model-and-all-source-record-digests",
    ),
    callerAuthoredAggregateCountsAccepted: z.literal(false),
    probePairedCases: z.literal(M9B3_PROBE_PAIRED_CASES),
    estimator: z.literal(
      "observed-discordance-rate-and-conditional-discovered-win-rate",
    ),
    confidenceMethod: z.literal(
      "bonferroni-two-one-sided-clopper-pearson-exact-tail-inversion",
    ),
    jointCoverageBasisPoints: z.literal(9_500),
    componentAlphaBasisPoints: z.literal(
      M9B3_PROBE_COMPONENT_ALPHA_BASIS_POINTS,
    ),
    tailInversionBisections: z.literal(M9B3_CONFIDENCE_BISECTIONS),
    primaryPairedCases: z.literal(M9B3_PRIMARY_PAIRED_CASES),
    primaryTest: z.literal("exact-one-sided-conditional-mcnemar"),
    primaryAlphaBasisPoints: z.literal(M9B3_PRIMARY_ALPHA_BASIS_POINTS),
    targetPowerBasisPoints: z.literal(M9B3_TARGET_POWER_BASIS_POINTS),
    powerRounding: z.literal("floor-to-integer-basis-points-before-threshold"),
    passRule: z.literal(
      "both-lower-bounds-positive-direction-and-conservative-power-at-168-at-least-8000-basis-points",
    ),
    failureBehavior: z.literal(
      "any-invalid-count-zero-discordance-nonpositive-lower-direction-or-underpower-is-no-go",
    ),
  })
  .readonly();

const gateSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3e-advancement-gates/1"),
    beforeCorpusConstruction: z
      .tuple([
        z.literal("independent-m9b3a-architecture-security-scientific-review"),
        z.literal("external-preregistration-of-construction-protocol"),
      ])
      .readonly(),
    beforeProviderAdapter: z
      .tuple([
        z.literal("complete-corpus-and-gold-frozen"),
        z.literal("all-corpus-scale-validations-passed"),
        z.literal("probe-and-primary-population-binding-passed"),
        z.literal("all-three-pairwise-m9b2d-split-audits-passed"),
        z.literal("independent-gold-and-evaluator-validation-passed"),
        z.literal("provider-request-serializer-reviewed"),
        z.literal("exact-tokenizer-offline-conformance-passed"),
        z.literal("pricing-and-capacity-snapshot-reviewed"),
      ])
      .readonly(),
    beforeAnyProviderCall: z
      .tuple([
        z.literal("protocol-probe-corpus-supplement-registered"),
        z.literal("counterbalanced-schedule-frozen"),
        z.literal("atomic-persistence-and-zero-effect-resume-reviewed"),
        z.literal("budget-ledger-preflight-passed"),
        z.literal("credential-preflight-passed-without-recording-secrets"),
        z.literal("separate-explicit-live-authorization"),
      ])
      .readonly(),
    beforePrimaryExecution: z
      .tuple([
        z.literal("verified-probe-population-completed"),
        z.literal("m9b3e-probe-advancement-decision-is-pass"),
        z.literal("probe-decision-source-measurement-inventory-verified"),
        z.literal("exact-primary-suite-and-schedule-binding-verified"),
      ])
      .readonly(),
    killGates: z
      .tuple([
        z.literal("corpus-or-gold-leakage-to-authoring-boundary"),
        z.literal("provider-model-tokenizer-or-serializer-identity-drift"),
        z.literal("unreserved-model-or-read-dispatch"),
        z.literal("cross-arm-or-cross-role-session-reuse"),
        z.literal("split-disjointness-or-semantic-independence-failure"),
        z.literal("missing-or-reordered-schedule-entry"),
        z.literal("budget-or-capacity-bound-exceeded"),
        z.literal("preregistration-or-corpus-supplement-binding-mismatch"),
      ])
      .readonly(),
  })
  .readonly();

const preregistrationSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3e-preregistration-materials/1"),
    status: z.literal("offline-draft-not-externally-registered"),
    primaryEndpoint: z.literal(M9B2_PRIMARY_ENDPOINT),
    primaryTest: z.literal("exact-one-sided-conditional-mcnemar"),
    alphaBasisPoints: z.literal(500),
    targetPowerBasisPoints: z.literal(8_000),
    primaryClaim: z.literal(
      "discovered-program-has-higher-first-attempt-success-than-static-one-shot",
    ),
    superiorityClaimAuthorized: z.literal(false),
    requiredBindings: z
      .tuple([
        z.literal("corpus-construction-protocol-digest"),
        z.literal("study-bindings-digest"),
        z.literal("provider-profile-digest"),
        z.literal("allocation-digest"),
        z.literal("schedule-protocol-digest"),
        z.literal("probe-gate-protocol-digest"),
        z.literal("matched-budget-digest"),
        z.literal("measurement-and-evaluator-validation-digests"),
        z.literal("analysis-code-and-report-schema-digests"),
        z.literal("historical-development-baseline-digest"),
      ])
      .readonly(),
    requiredProspectiveSupplement: z
      .tuple([
        z.literal(
          "complete-development-probe-and-primary-suite-inventory-digests",
        ),
        z.literal("complete-snapshot-and-scale-validation-digests"),
        z.literal("all-three-pairwise-m9b2d-split-audit-digests"),
        z.literal(
          "opaque-probe-gold-scoring-source-and-final-evaluator-artifact-schema-validation-digests",
        ),
        z.literal("seed-reveals-and-materialized-schedule-digest"),
        z.literal("protocol-probe-discordance-and-power-gate-decision"),
      ])
      .readonly(),
    corpusIdentity: z.literal("absent"),
    externalRegistration: z.literal("not-performed"),
    executionAuthorization: z.literal("absent"),
  })
  .readonly();

const authoritySchema = z
  .strictObject({
    corpusMaterializationAuthorized: z.literal(false),
    credentialsAccessed: z.literal(false),
    providerAdapterCreated: z.literal(false),
    providerCallsAuthorized: z.literal(false),
    executionStateCreated: z.literal(false),
    externalPreregistrationPerformed: z.literal(false),
    liveExecutionAuthorized: z.literal(false),
  })
  .readonly();

const preparationBodySchema = z
  .strictObject({
    protocol: z.literal(M9B3_PREPARATION_PROTOCOL.id),
    version: z.literal(M9B3_PREPARATION_PROTOCOL.version),
    status: z.literal("offline-preparation-complete-m9b-live-no-go"),
    providerProfile: m9b3ProviderProfileInputSchema,
    providerProfileDigest: digestSchema,
    historicalDevelopmentBaseline: historicalDevelopmentBaselineSchema,
    historicalDevelopmentBaselineDigest: digestSchema,
    authoringVisibility: z
      .strictObject({
        visible: z.literal("task-grammar-capabilities-and-budget-only"),
        providerModelTokenizerPricingAndArmIdentitiesExcluded: z.literal(true),
      })
      .readonly(),
    studyBindings: studyBindingsSchema,
    studyBindingsDigest: digestSchema,
    corpusConstruction: corpusConstructionSchema,
    corpusConstructionDigest: digestSchema,
    allocation: allocationSchema,
    allocationDigest: digestSchema,
    schedule: scheduleSchema,
    scheduleProtocolDigest: digestSchema,
    probeGate: probeGateProtocolSchema,
    probeGateProtocolDigest: digestSchema,
    matchedBudget: matchedBudgetSchema,
    matchedBudgetDigest: digestSchema,
    gates: gateSchema,
    gatesDigest: digestSchema,
    preregistration: preregistrationSchema,
    preregistrationMaterialsDigest: digestSchema,
    authority: authoritySchema,
    decision: z
      .strictObject({
        outcome: z.literal("no-go"),
        blockers: z
          .tuple([
            z.literal("external-preregistration-not-performed"),
            z.literal("corpus-and-gold-not-materialized"),
            z.literal("independent-evaluator-validation-not-complete"),
            z.literal("provider-adapter-and-tokenizer-conformance-absent"),
            z.literal("empirical-discordance-gate-not-run"),
            z.literal("schedule-not-materialized"),
            z.literal("explicit-live-authorization-absent"),
          ])
          .readonly(),
      })
      .readonly(),
  })
  .readonly();

export const m9b3PreparationSchema = preparationBodySchema
  .unwrap()
  .safeExtend({ preparationDigest: digestSchema })
  .readonly();
export type M9b3Preparation = z.infer<typeof m9b3PreparationSchema>;

const m9b3ProspectiveSupplementInputSchema = z
  .strictObject({
    finalGold: m9b3dGoldArtifactIdentitySchema,
    finalEvaluator: m9b3dEvaluatorArtifactSchema
      .unwrap()
      .safeExtend({
        deterministicLocalArmBlind: z.literal(true),
        providerEffects: z.literal(0),
        campaignEligible: z.literal(true),
      })
      .readonly(),
  })
  .superRefine((input, context) => {
    if (
      input.finalEvaluator.id === M9B2_EVALUATOR_IDENTITY.id &&
      input.finalEvaluator.version === M9B2_EVALUATOR_IDENTITY.version
    )
      context.addIssue({
        code: "custom",
        message:
          "M9b.3e final evaluator must differ from the campaign-ineligible development evaluator.",
      });
  })
  .readonly();
export type M9b3ProspectiveSupplementInput = z.infer<
  typeof m9b3ProspectiveSupplementInputSchema
>;

const prospectiveSupplementBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3e-prospective-supplement/1"),
    status: z.literal(
      "offline-identities-frozen-no-preregistration-or-execution-authority",
    ),
    preparationDigest: digestSchema,
    historicalDevelopmentBaselineDigest: digestSchema,
    finalGold: m9b3dGoldArtifactIdentitySchema,
    finalEvaluator:
      m9b3ProspectiveSupplementInputSchema.unwrap().shape.finalEvaluator,
    measurementRecordProtocol: z.literal(
      "lachesis-m9b3e-predispatch-artifact-terminal-measurement-record/1",
    ),
    authority: z
      .strictObject({
        corpusMaterializationAuthorized: z.literal(false),
        providerAdapterAuthorized: z.literal(false),
        providerCallsAuthorized: z.literal(false),
        externalPreregistrationPerformed: z.literal(false),
        liveExecutionAuthorized: z.literal(false),
      })
      .readonly(),
  })
  .readonly();

export const m9b3ProspectiveSupplementSchema = prospectiveSupplementBodySchema
  .unwrap()
  .safeExtend({ supplementDigest: digestSchema })
  .readonly();
export type M9b3ProspectiveSupplement = z.infer<
  typeof m9b3ProspectiveSupplementSchema
>;

const scaleValidationBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3a-corpus-scale-validation/1"),
    claimedScale: m9b2CorpusScaleSchema,
    corpusBytes: z.number().int().positive(),
    acceptedRange: scaleRangeSchema,
    accepted: z.literal(true),
  })
  .readonly();
export const m9b3ScaleValidationSchema = scaleValidationBodySchema
  .unwrap()
  .safeExtend({ validationDigest: digestSchema })
  .readonly();
export type M9b3ScaleValidation = z.infer<typeof m9b3ScaleValidationSchema>;

const populationCaseSchema = z
  .strictObject({
    caseId: identifierSchema,
    family: m9b2TaskFamilySchema,
    scale: m9b2CorpusScaleSchema,
    snapshotDigest: digestSchema,
    corpusBytes: z.number().int().positive(),
    semanticProblemIdentity: digestSchema,
    scaleValidationDigest: digestSchema,
  })
  .readonly();

const developmentPopulationCaseSchema = populationCaseSchema
  .unwrap()
  .omit({ scaleValidationDigest: true })
  .readonly();

const boundDevelopmentPopulationSchema = z
  .strictObject({
    role: z.literal("m9b2-development"),
    suiteDigest: digestSchema,
    inventoryDigest: digestSchema,
    caseCount: z.literal(24),
    casesPerCell: z.literal(1),
    cases: developmentPopulationCaseSchema.array().length(24).readonly(),
  })
  .readonly();

const boundPopulationSchema = z
  .strictObject({
    role: z.enum(["protocol-probe", "primary"]),
    suiteDigest: digestSchema,
    inventoryDigest: digestSchema,
    caseCount: z.number().int().positive(),
    casesPerCell: z.number().int().positive(),
    cases: populationCaseSchema.array().min(24).max(10_000).readonly(),
  })
  .readonly();

const populationBindingBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3e-prospective-population-binding/1"),
    preparationDigest: digestSchema,
    historicalDevelopmentBaselineDigest: digestSchema,
    development: boundDevelopmentPopulationSchema,
    probe: boundPopulationSchema,
    primary: boundPopulationSchema,
    prospectiveSemanticProblemsUnique: z.literal(true),
    pairwiseSplitAudits: z
      .strictObject({
        protocol: z.literal("lachesis-m9b2d-split-disjointness-audit/5"),
        developmentProbeDigest: digestSchema,
        developmentPrimaryDigest: digestSchema,
        probePrimaryDigest: digestSchema,
      })
      .readonly(),
    primaryReportCoverage: z.literal(
      "exact-complete-primary-suite-token-required-by-m9b2d",
    ),
  })
  .readonly();
export const m9b3PopulationBindingSchema = populationBindingBodySchema
  .unwrap()
  .safeExtend({ bindingDigest: digestSchema })
  .readonly();
export type M9b3PopulationBinding = z.infer<typeof m9b3PopulationBindingSchema>;

const scheduleEntrySchema = z
  .strictObject({
    executionOrdinal: z.number().int().nonnegative(),
    population: z.enum(["protocol-probe", "primary"]),
    caseId: identifierSchema,
    suiteDigest: digestSchema,
    inventoryDigest: digestSchema,
    family: m9b2TaskFamilySchema,
    scale: m9b2CorpusScaleSchema,
    snapshotDigest: digestSchema,
    semanticProblemIdentity: digestSchema,
    cellOrderKey: digestSchema,
    caseOrderKey: digestSchema,
    executionOrderKey: digestSchema,
    cellRank: z.number().int().nonnegative().max(23),
    positionInCell: z.number().int().nonnegative().max(6),
    leadingArm: z.enum(["discovered-program", "static-one-shot"]),
    firstArm: z.enum(["discovered-program", "static-one-shot"]),
    secondArm: z.enum(["discovered-program", "static-one-shot"]),
  })
  .readonly();

const materializedScheduleBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3e-materialized-schedule/1"),
    algorithmProtocol: z.literal(
      "lachesis-m9b3e-paired-counterbalance-schedule/1",
    ),
    preparationDigest: digestSchema,
    populationBindingDigest: digestSchema,
    seedCommitment: digestSchema,
    seedReveal: digestSchema,
    probeEntries: scheduleEntrySchema.array().length(24).readonly(),
    primaryEntries: scheduleEntrySchema.array().length(168).readonly(),
    primaryExecutionCondition: z.literal("probe-advancement-gate-passed"),
  })
  .readonly();
export const m9b3MaterializedScheduleSchema = materializedScheduleBodySchema
  .unwrap()
  .safeExtend({ scheduleDigest: digestSchema })
  .readonly();
export type M9b3MaterializedSchedule = z.infer<
  typeof m9b3MaterializedScheduleSchema
>;

const probeCountsSchema = z
  .strictObject({
    discoveredOnly: z.number().int().nonnegative().max(24),
    staticOnly: z.number().int().nonnegative().max(24),
    bothSucceeded: z.number().int().nonnegative().max(24),
    bothFailed: z.number().int().nonnegative().max(24),
  })
  .refine(
    (counts) =>
      counts.discoveredOnly +
        counts.staticOnly +
        counts.bothSucceeded +
        counts.bothFailed ===
      M9B3_PROBE_PAIRED_CASES,
  )
  .readonly();

const probeMeasurementIdentitySchema = z
  .strictObject({ id: z.string().min(1), version: z.string().min(1) })
  .readonly();

const probeSourcePairSchema = z
  .strictObject({
    caseId: identifierSchema,
    scheduleExecutionOrdinal: z.number().int().nonnegative().max(23),
    scheduleFirstArm: z.enum(["discovered-program", "static-one-shot"]),
    comparisonDigest: digestSchema,
    taskDigest: digestSchema,
    corpusSnapshotDigest: digestSchema,
    evaluatorArtifact: m9b3dEvaluatorArtifactSchema,
    goldArtifact: m9b3dGoldArtifactIdentitySchema,
    discovered: z
      .strictObject({
        measurementRecordDigest: digestSchema,
        sourceArmRecordDigest: digestSchema,
        programIdentity: digestSchema.nullable(),
        success: z.boolean(),
      })
      .readonly(),
    static: z
      .strictObject({
        measurementRecordDigest: digestSchema,
        sourceArmRecordDigest: digestSchema,
        programIdentity: digestSchema.nullable(),
        success: z.boolean(),
      })
      .readonly(),
  })
  .readonly();

const probeDecisionBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3e-probe-advancement-decision/1"),
    gateProtocol: z.literal("lachesis-m9b3e-probe-advancement-gate/1"),
    preparationDigest: digestSchema,
    prospectiveSupplementDigest: digestSchema,
    populationBindingDigest: digestSchema,
    probeSuiteDigest: digestSchema,
    probeInventoryDigest: digestSchema,
    scheduleDigest: digestSchema,
    endpoint: z.literal(M9B2_PRIMARY_ENDPOINT),
    model: probeMeasurementIdentitySchema,
    evaluator: probeMeasurementIdentitySchema,
    finalGold: m9b3dGoldArtifactIdentitySchema,
    sourcePairs: probeSourcePairSchema.array().length(24).readonly(),
    sourceMeasurementInventoryDigest: digestSchema,
    counts: probeCountsSchema,
    discordantPairs: z.number().int().nonnegative().max(24),
    discordanceRateLowerBoundBasisPoints: z.number().int().min(0).max(10_000),
    conditionalDiscoveredWinLowerBoundBasisPoints: z
      .number()
      .int()
      .min(0)
      .max(10_000),
    conservativePowerAt168BasisPoints: z.number().int().min(0).max(10_000),
    outcome: z.discriminatedUnion("status", [
      z.strictObject({ status: z.literal("pass") }).readonly(),
      z
        .strictObject({
          status: z.literal("no-go"),
          reason: z.enum([
            "zero-discordant-pairs",
            "nonpositive-conservative-direction",
            "conservative-power-below-8000-basis-points",
          ]),
        })
        .readonly(),
    ]),
  })
  .superRefine((decision, context) => {
    if (
      !unique(decision.sourcePairs.map((pair) => pair.caseId)) ||
      !unique(decision.sourcePairs.map((pair) => pair.comparisonDigest)) ||
      !unique(
        decision.sourcePairs.flatMap((pair) => [
          pair.discovered.measurementRecordDigest,
          pair.static.measurementRecordDigest,
        ]),
      ) ||
      !unique(
        decision.sourcePairs.flatMap((pair) => [
          pair.discovered.sourceArmRecordDigest,
          pair.static.sourceArmRecordDigest,
        ]),
      )
    )
      context.addIssue({
        code: "custom",
        message: "M9b.3e probe source-pair provenance is not unique.",
      });
  })
  .readonly();
export const m9b3ProbeDecisionSchema = probeDecisionBodySchema
  .unwrap()
  .safeExtend({ decisionDigest: digestSchema })
  .readonly();
export type M9b3ProbeDecision = z.infer<typeof m9b3ProbeDecisionSchema>;

function invalid(message: string): Result<never, Diagnostic> {
  return { ok: false, error: diagnostic("INVALID_WIRE_SCHEMA", message) };
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftCanonical = canonicalizeJson(left);
  const rightCanonical = canonicalizeJson(right);
  return (
    leftCanonical.ok &&
    rightCanonical.ok &&
    leftCanonical.value === rightCanonical.value
  );
}

function tokenCostCeiling(tokens: number, rate: number): number | undefined {
  const product = tokens * rate;
  if (!Number.isSafeInteger(product)) return undefined;
  return Math.ceil(product / 1_000_000);
}

async function identified<T>(
  value: T,
): Promise<Result<Readonly<{ value: T; digest: string }>, Diagnostic>> {
  const digest = await digestValue(value);
  return digest.ok
    ? { ok: true, value: Object.freeze({ value, digest: digest.value }) }
    : digest;
}

function compareIdentifiers(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unique(values: ReadonlyArray<unknown>): boolean {
  return new Set(values).size === values.length;
}

function binomialDistribution(
  trials: number,
  probability: number,
): ReadonlyArray<number> {
  if (probability === 0)
    return Object.freeze([1, ...Array.from({ length: trials }, () => 0)]);
  if (probability === 1)
    return Object.freeze([...Array.from({ length: trials }, () => 0), 1]);
  const values = Array.from({ length: trials + 1 }, () => 0);
  const mode = Math.min(trials, Math.floor((trials + 1) * probability));
  values[mode] = 1;
  for (let successes = mode; successes > 0; successes -= 1) {
    const current = values[successes] ?? 0;
    values[successes - 1] =
      current *
      (successes / (trials - successes + 1)) *
      ((1 - probability) / probability);
  }
  for (let successes = mode; successes < trials; successes += 1) {
    const current = values[successes] ?? 0;
    values[successes + 1] =
      current *
      ((trials - successes) / (successes + 1)) *
      (probability / (1 - probability));
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return Object.freeze(values.map((value) => value / total));
}

function oneSidedClopperPearsonLowerBound(
  successes: number,
  trials: number,
): number {
  if (successes === 0 || trials === 0) return 0;
  const alpha = M9B3_PROBE_COMPONENT_ALPHA_BASIS_POINTS / 10_000;
  let lower = 0;
  let upper = 1;
  for (
    let iteration = 0;
    iteration < M9B3_CONFIDENCE_BISECTIONS;
    iteration += 1
  ) {
    const midpoint = (lower + upper) / 2;
    const upperTail = binomialDistribution(trials, midpoint)
      .slice(successes)
      .reduce((sum, probability) => sum + probability, 0);
    if (upperTail < alpha) lower = midpoint;
    else upper = midpoint;
  }
  return lower;
}

function rejectionThreshold(discordances: number, alpha: number): number {
  const nullDistribution = binomialDistribution(discordances, 0.5);
  let tail = 0;
  let threshold = discordances + 1;
  for (let successes = discordances; successes >= 0; successes -= 1) {
    tail += nullDistribution[successes] ?? 0;
    if (tail <= alpha) threshold = successes;
  }
  return threshold;
}

function exactConditionalPowerByDiscordance(
  maximum: number,
  conditionalDiscoveredWinRate: number,
  alpha: number,
): ReadonlyArray<number> {
  return Object.freeze(
    Array.from({ length: maximum + 1 }, (_value, discordances) => {
      const threshold = rejectionThreshold(discordances, alpha);
      return binomialDistribution(discordances, conditionalDiscoveredWinRate)
        .slice(threshold)
        .reduce((sum, probability) => sum + probability, 0);
    }),
  );
}

function scenarioPower(
  pairedCases: number,
  discordanceRate: number,
  conditionalPower: ReadonlyArray<number>,
): number {
  return binomialDistribution(pairedCases, discordanceRate).reduce(
    (sum, probability, count) =>
      sum + probability * (conditionalPower[count] ?? 0),
    0,
  );
}

export async function validateM9b3CorpusScale(
  input: unknown,
): Promise<Result<M9b3ScaleValidation, Diagnostic>> {
  const parsed = z
    .strictObject({
      claimedScale: m9b2CorpusScaleSchema,
      corpusBytes: z.number().int().positive(),
    })
    .safeParse(input);
  if (!parsed.success) return invalid("M9b.3e corpus scale input is invalid.");
  const range = M9B3_SCALE_RANGES.find(
    (candidate) => candidate.scale === parsed.data.claimedScale,
  );
  if (
    range === undefined ||
    parsed.data.corpusBytes < range.minimumBytesInclusive ||
    parsed.data.corpusBytes > range.maximumBytesInclusive
  )
    return invalid("M9b.3e corpus bytes do not fit the claimed scale.");
  const body = scaleValidationBodySchema.parse({
    protocol: "lachesis-m9b3a-corpus-scale-validation/1",
    claimedScale: parsed.data.claimedScale,
    corpusBytes: parsed.data.corpusBytes,
    acceptedRange: range,
    accepted: true,
  });
  const validationDigest = await digestValue(body);
  return validationDigest.ok
    ? {
        ok: true,
        value: m9b3ScaleValidationSchema.parse({
          ...body,
          validationDigest: validationDigest.value,
        }),
      }
    : validationDigest;
}

export async function verifyM9b3CorpusScale(
  input: unknown,
  value: unknown,
): Promise<Result<M9b3ScaleValidation, Diagnostic>> {
  const parsed = m9b3ScaleValidationSchema.safeParse(value);
  if (!parsed.success) return invalid("M9b.3e scale validation is invalid.");
  const rederived = await validateM9b3CorpusScale(input);
  return rederived.ok && canonicalEqual(rederived.value, parsed.data)
    ? { ok: true, value: parsed.data }
    : invalid("M9b.3e scale validation failed complete rederivation.");
}

async function bindPopulation(
  role: "protocol-probe" | "primary",
  suite: M9b2PreparedSuite,
): Promise<Result<z.infer<typeof boundPopulationSchema>, Diagnostic>> {
  const inspected = inspectM9b2PreparedSuite(suite);
  const expectedCount =
    role === "protocol-probe"
      ? M9B3_PROBE_PAIRED_CASES
      : M9B3_PRIMARY_PAIRED_CASES;
  const expectedPerCell = expectedCount / M9B3_CELL_COUNT;
  if (inspected?.cases.length !== expectedCount)
    return invalid(`M9b.3e ${role} suite has the wrong complete case count.`);
  if (
    M9B2_TASK_FAMILIES.some((family) =>
      M9B2_CORPUS_SCALES.some(
        (scale) =>
          inspected.cases.filter(
            (candidate) =>
              candidate.family === family && candidate.scale === scale,
          ).length !== expectedPerCell,
      ),
    )
  )
    return invalid(`M9b.3e ${role} suite is not balanced across all 24 cells.`);
  const cases: Array<z.infer<typeof populationCaseSchema>> = [];
  for (const candidate of inspected.cases) {
    const scale = await validateM9b3CorpusScale({
      claimedScale: candidate.scale,
      corpusBytes: candidate.corpusBytes,
    });
    if (!scale.ok) return scale;
    cases.push(
      populationCaseSchema.parse({
        ...candidate,
        scaleValidationDigest: scale.value.validationDigest,
      }),
    );
  }
  const sortedCases = Object.freeze(
    cases.toSorted((left, right) =>
      compareIdentifiers(left.caseId, right.caseId),
    ),
  );
  const inventoryDigest = await digestValue({
    protocol: "lachesis-m9b3e-population-inventory/1",
    role,
    suiteDigest: inspected.suiteDigest,
    cases: sortedCases,
  });
  return inventoryDigest.ok
    ? {
        ok: true,
        value: boundPopulationSchema.parse({
          role,
          suiteDigest: inspected.suiteDigest,
          inventoryDigest: inventoryDigest.value,
          caseCount: sortedCases.length,
          casesPerCell: expectedPerCell,
          cases: sortedCases,
        }),
      }
    : inventoryDigest;
}

async function bindDevelopmentPopulation(
  suite: M9b2PreparedSuite,
): Promise<
  Result<z.infer<typeof boundDevelopmentPopulationSchema>, Diagnostic>
> {
  const inspected = inspectM9b2PreparedSuite(suite);
  if (inspected?.cases.length !== M9B3_CELL_COUNT)
    return invalid(
      "M9b.3e existing development suite must contain all 24 cases.",
    );
  if (
    M9B2_TASK_FAMILIES.some((family) =>
      M9B2_CORPUS_SCALES.some(
        (scale) =>
          inspected.cases.filter(
            (candidate) =>
              candidate.family === family && candidate.scale === scale,
          ).length !== 1,
      ),
    )
  )
    return invalid(
      "M9b.3e existing development suite must cover every family-scale cell once.",
    );
  const cases = Object.freeze(
    inspected.cases
      .map((candidate) => developmentPopulationCaseSchema.parse(candidate))
      .toSorted((left, right) => compareIdentifiers(left.caseId, right.caseId)),
  );
  const inventoryDigest = await digestValue({
    protocol: "lachesis-m9b3e-development-population-inventory/1",
    role: "m9b2-development",
    suiteDigest: inspected.suiteDigest,
    cases,
  });
  return inventoryDigest.ok
    ? {
        ok: true,
        value: boundDevelopmentPopulationSchema.parse({
          role: "m9b2-development",
          suiteDigest: inspected.suiteDigest,
          inventoryDigest: inventoryDigest.value,
          caseCount: cases.length,
          casesPerCell: 1,
          cases,
        }),
      }
    : inventoryDigest;
}

/** @internal Derives the exact identity for independent baseline review. */
export async function deriveM9b3HistoricalDevelopmentBaseline(
  suite: M9b2PreparedSuite,
): Promise<Result<M9b3HistoricalDevelopmentBaseline, Diagnostic>> {
  const development = await bindDevelopmentPopulation(suite);
  return development.ok
    ? {
        ok: true,
        value: historicalDevelopmentBaselineSchema.parse({
          protocol: "lachesis-m9b3c-trusted-development-baseline/1",
          suiteDigest: development.value.suiteDigest,
          inventoryDigest: development.value.inventoryDigest,
          trustSource: "independently-reviewed-m9b2-development-baseline",
        }),
      }
    : development;
}

export async function bindM9b3Populations(
  preparationInput: unknown,
  preparation: unknown,
  developmentSuite: M9b2PreparedSuite,
  probeSuite: M9b2PreparedSuite,
  primarySuite: M9b2PreparedSuite,
): Promise<Result<M9b3PopulationBinding, Diagnostic>> {
  const verifiedPreparation = await verifyM9b3OfflineStudy(
    preparationInput,
    preparation,
  );
  if (!verifiedPreparation.ok)
    return invalid("M9b.3e population preparation is invalid.");
  const development = await bindDevelopmentPopulation(developmentSuite);
  if (!development.ok) return development;
  const trustedBaseline =
    verifiedPreparation.value.historicalDevelopmentBaseline;
  if (
    development.value.suiteDigest !== trustedBaseline.suiteDigest ||
    development.value.inventoryDigest !== trustedBaseline.inventoryDigest
  )
    return invalid(
      "M9b.3e supplied development suite differs from the frozen historical baseline.",
    );
  const probe = await bindPopulation("protocol-probe", probeSuite);
  if (!probe.ok) return probe;
  const primary = await bindPopulation("primary", primarySuite);
  if (!primary.ok) return primary;
  const combinedCases = [
    ...development.value.cases,
    ...probe.value.cases,
    ...primary.value.cases,
  ];
  if (
    new Set([
      development.value.suiteDigest,
      probe.value.suiteDigest,
      primary.value.suiteDigest,
    ]).size !== 3
  )
    return invalid("M9b.3e population suite identities must be distinct.");
  if (!unique(combinedCases.map((candidate) => candidate.caseId)))
    return invalid("M9b.3e population case identities must be distinct.");
  if (
    !unique(
      [...probe.value.cases, ...primary.value.cases].map(
        (candidate) => candidate.semanticProblemIdentity,
      ),
    )
  )
    return invalid(
      "M9b.3e population semantic-problem identities must be distinct.",
    );
  const developmentProbeAudit = await auditM9b2SplitDisjointness({
    developmentSuite,
    heldoutSuite: probeSuite,
  });
  if (!developmentProbeAudit.ok) return developmentProbeAudit;
  const developmentPrimaryAudit = await auditM9b2SplitDisjointness({
    developmentSuite,
    heldoutSuite: primarySuite,
  });
  if (!developmentPrimaryAudit.ok) return developmentPrimaryAudit;
  const probePrimaryAudit = await auditM9b2SplitDisjointness({
    developmentSuite: probeSuite,
    heldoutSuite: primarySuite,
  });
  if (!probePrimaryAudit.ok) return probePrimaryAudit;
  const body = populationBindingBodySchema.parse({
    protocol: "lachesis-m9b3e-prospective-population-binding/1",
    preparationDigest: verifiedPreparation.value.preparationDigest,
    historicalDevelopmentBaselineDigest:
      verifiedPreparation.value.historicalDevelopmentBaselineDigest,
    development: development.value,
    probe: probe.value,
    primary: primary.value,
    prospectiveSemanticProblemsUnique: true,
    pairwiseSplitAudits: {
      protocol: "lachesis-m9b2d-split-disjointness-audit/5",
      developmentProbeDigest: developmentProbeAudit.value.auditDigest,
      developmentPrimaryDigest: developmentPrimaryAudit.value.auditDigest,
      probePrimaryDigest: probePrimaryAudit.value.auditDigest,
    },
    primaryReportCoverage:
      "exact-complete-primary-suite-token-required-by-m9b2d",
  });
  const bindingDigest = await digestValue(body);
  return bindingDigest.ok
    ? {
        ok: true,
        value: m9b3PopulationBindingSchema.parse({
          ...body,
          bindingDigest: bindingDigest.value,
        }),
      }
    : bindingDigest;
}

export async function verifyM9b3PopulationBinding(
  preparationInput: unknown,
  preparation: unknown,
  developmentSuite: M9b2PreparedSuite,
  probeSuite: M9b2PreparedSuite,
  primarySuite: M9b2PreparedSuite,
  value: unknown,
): Promise<Result<M9b3PopulationBinding, Diagnostic>> {
  const parsed = m9b3PopulationBindingSchema.safeParse(value);
  if (!parsed.success) return invalid("M9b.3e population binding is invalid.");
  const rederived = await bindM9b3Populations(
    preparationInput,
    preparation,
    developmentSuite,
    probeSuite,
    primarySuite,
  );
  return rederived.ok && canonicalEqual(rederived.value, parsed.data)
    ? { ok: true, value: parsed.data }
    : invalid("M9b.3e population binding failed opaque-suite rederivation.");
}

export async function deriveM9b3ScheduleSeedCommitment(
  seedReveal: unknown,
): Promise<Result<string, Diagnostic>> {
  const parsed = digestSchema.safeParse(seedReveal);
  if (!parsed.success)
    return invalid("M9b.3e schedule seed reveal is invalid.");
  return digestValue({
    protocol: "lachesis-m9b3e-seed-commitment/1",
    purpose: "paired-counterbalance-schedule",
    seedReveal: parsed.data,
  });
}

type SchedulePopulation = z.infer<typeof boundPopulationSchema>;
type ScheduleEntry = z.infer<typeof scheduleEntrySchema>;

async function materializePopulationSchedule(
  population: SchedulePopulation,
  seedReveal: string,
): Promise<Result<ReadonlyArray<ScheduleEntry>, Diagnostic>> {
  const cells: Array<
    Readonly<{
      family: M9b2TaskFamily;
      scale: M9b2CorpusScale;
      cellOrderKey: string;
    }>
  > = [];
  for (const family of M9B2_TASK_FAMILIES) {
    for (const scale of M9B2_CORPUS_SCALES) {
      const cellOrderKey = await digestValue({
        protocol: "lachesis-m9b3e-schedule-cell-order/1",
        seedReveal,
        population: population.role,
        family,
        scale,
      });
      if (!cellOrderKey.ok) return cellOrderKey;
      cells.push(
        Object.freeze({ family, scale, cellOrderKey: cellOrderKey.value }),
      );
    }
  }
  const sortedCells = cells.toSorted((left, right) => {
    const keyOrder = compareIdentifiers(left.cellOrderKey, right.cellOrderKey);
    if (keyOrder !== 0) return keyOrder;
    return compareIdentifiers(
      `${left.family}/${left.scale}`,
      `${right.family}/${right.scale}`,
    );
  });
  const unscheduled: Array<ScheduleEntry> = [];
  for (const [cellRank, cell] of sortedCells.entries()) {
    const caseKeys: Array<
      Readonly<{
        candidate: z.infer<typeof populationCaseSchema>;
        caseOrderKey: string;
      }>
    > = [];
    for (const candidate of population.cases.filter(
      (value) => value.family === cell.family && value.scale === cell.scale,
    )) {
      const caseOrderKey = await digestValue({
        protocol: "lachesis-m9b3e-schedule-case-order/1",
        seedReveal,
        population: population.role,
        suiteDigest: population.suiteDigest,
        inventoryDigest: population.inventoryDigest,
        caseId: candidate.caseId,
        semanticProblemIdentity: candidate.semanticProblemIdentity,
        snapshotDigest: candidate.snapshotDigest,
        family: candidate.family,
        scale: candidate.scale,
      });
      if (!caseOrderKey.ok) return caseOrderKey;
      caseKeys.push(
        Object.freeze({ candidate, caseOrderKey: caseOrderKey.value }),
      );
    }
    const sortedCases = caseKeys.toSorted((left, right) => {
      const keyOrder = compareIdentifiers(
        left.caseOrderKey,
        right.caseOrderKey,
      );
      return keyOrder !== 0
        ? keyOrder
        : compareIdentifiers(left.candidate.caseId, right.candidate.caseId);
    });
    const leadingArm =
      cellRank % 2 === 0 ? "discovered-program" : "static-one-shot";
    for (const [positionInCell, keyed] of sortedCases.entries()) {
      const executionOrderKey = await digestValue({
        protocol: "lachesis-m9b3e-schedule-execution-order/1",
        seedReveal,
        population: population.role,
        caseOrderKey: keyed.caseOrderKey,
      });
      if (!executionOrderKey.ok) return executionOrderKey;
      const firstArm =
        positionInCell % 2 === 0
          ? leadingArm
          : leadingArm === "discovered-program"
            ? "static-one-shot"
            : "discovered-program";
      unscheduled.push(
        scheduleEntrySchema.parse({
          executionOrdinal: 0,
          population: population.role,
          caseId: keyed.candidate.caseId,
          suiteDigest: population.suiteDigest,
          inventoryDigest: population.inventoryDigest,
          family: keyed.candidate.family,
          scale: keyed.candidate.scale,
          snapshotDigest: keyed.candidate.snapshotDigest,
          semanticProblemIdentity: keyed.candidate.semanticProblemIdentity,
          cellOrderKey: cell.cellOrderKey,
          caseOrderKey: keyed.caseOrderKey,
          executionOrderKey: executionOrderKey.value,
          cellRank,
          positionInCell,
          leadingArm,
          firstArm,
          secondArm:
            firstArm === "discovered-program"
              ? "static-one-shot"
              : "discovered-program",
        }),
      );
    }
  }
  return {
    ok: true,
    value: Object.freeze(
      unscheduled
        .toSorted((left, right) => {
          const keyOrder = compareIdentifiers(
            left.executionOrderKey,
            right.executionOrderKey,
          );
          return keyOrder !== 0
            ? keyOrder
            : compareIdentifiers(left.caseId, right.caseId);
        })
        .map((entry, executionOrdinal) =>
          scheduleEntrySchema.parse({ ...entry, executionOrdinal }),
        ),
    ),
  };
}

export async function materializeM9b3Schedule(
  preparationInput: unknown,
  preparation: unknown,
  developmentSuite: M9b2PreparedSuite,
  probeSuite: M9b2PreparedSuite,
  primarySuite: M9b2PreparedSuite,
  seedReveal: unknown,
): Promise<Result<M9b3MaterializedSchedule, Diagnostic>> {
  const verifiedPreparation = await verifyM9b3OfflineStudy(
    preparationInput,
    preparation,
  );
  const parsedSeed = digestSchema.safeParse(seedReveal);
  if (!verifiedPreparation.ok || !parsedSeed.success)
    return invalid("M9b.3e schedule inputs are invalid.");
  const seedCommitment = await deriveM9b3ScheduleSeedCommitment(
    parsedSeed.data,
  );
  if (
    !seedCommitment.ok ||
    seedCommitment.value !== verifiedPreparation.value.schedule.seedCommitment
  )
    return invalid("M9b.3e schedule seed does not open the frozen commitment.");
  const populations = await bindM9b3Populations(
    preparationInput,
    preparation,
    developmentSuite,
    probeSuite,
    primarySuite,
  );
  if (!populations.ok) return populations;
  const probeEntries = await materializePopulationSchedule(
    populations.value.probe,
    parsedSeed.data,
  );
  if (!probeEntries.ok) return probeEntries;
  const primaryEntries = await materializePopulationSchedule(
    populations.value.primary,
    parsedSeed.data,
  );
  if (!primaryEntries.ok) return primaryEntries;
  const body = materializedScheduleBodySchema.parse({
    protocol: "lachesis-m9b3e-materialized-schedule/1",
    algorithmProtocol: "lachesis-m9b3e-paired-counterbalance-schedule/1",
    preparationDigest: verifiedPreparation.value.preparationDigest,
    populationBindingDigest: populations.value.bindingDigest,
    seedCommitment: seedCommitment.value,
    seedReveal: parsedSeed.data,
    probeEntries: probeEntries.value,
    primaryEntries: primaryEntries.value,
    primaryExecutionCondition: "probe-advancement-gate-passed",
  });
  const scheduleDigest = await digestValue(body);
  return scheduleDigest.ok
    ? {
        ok: true,
        value: m9b3MaterializedScheduleSchema.parse({
          ...body,
          scheduleDigest: scheduleDigest.value,
        }),
      }
    : scheduleDigest;
}

export async function verifyM9b3MaterializedSchedule(
  preparationInput: unknown,
  preparation: unknown,
  developmentSuite: M9b2PreparedSuite,
  probeSuite: M9b2PreparedSuite,
  primarySuite: M9b2PreparedSuite,
  seedReveal: unknown,
  value: unknown,
): Promise<Result<M9b3MaterializedSchedule, Diagnostic>> {
  const parsed = m9b3MaterializedScheduleSchema.safeParse(value);
  if (!parsed.success)
    return invalid("M9b.3e materialized schedule is invalid.");
  const rederived = await materializeM9b3Schedule(
    preparationInput,
    preparation,
    developmentSuite,
    probeSuite,
    primarySuite,
    seedReveal,
  );
  return rederived.ok && canonicalEqual(rederived.value, parsed.data)
    ? { ok: true, value: parsed.data }
    : invalid("M9b.3e schedule failed complete zero-effect rederivation.");
}

function pairedSuccessCounts(
  pairs: ReadonlyArray<z.infer<typeof probeSourcePairSchema>>,
): z.infer<typeof probeCountsSchema> {
  return probeCountsSchema.parse({
    discoveredOnly: pairs.filter(
      (pair) => pair.discovered.success && !pair.static.success,
    ).length,
    staticOnly: pairs.filter(
      (pair) => !pair.discovered.success && pair.static.success,
    ).length,
    bothSucceeded: pairs.filter(
      (pair) => pair.discovered.success && pair.static.success,
    ).length,
    bothFailed: pairs.filter(
      (pair) => !pair.discovered.success && !pair.static.success,
    ).length,
  });
}

function modelIdentityMatchesPreparation(
  record: M9b3eTerminalMeasurementRecord,
  preparation: M9b3Preparation,
): boolean {
  return (
    record.model.id === preparation.providerProfile.model.id &&
    record.model.version === preparation.providerProfile.model.revision
  );
}

function evaluatorIdentityMatchesSupplement(
  record: M9b3eTerminalMeasurementRecord,
  supplement: M9b3ProspectiveSupplement,
): boolean {
  return (
    record.evaluator.id === supplement.finalEvaluator.id &&
    record.evaluator.version === supplement.finalEvaluator.version
  );
}

function evaluatorArtifactFromSupplement(
  supplement: M9b3ProspectiveSupplement,
): M9b3dEvaluatorArtifact {
  return m9b3dEvaluatorArtifactSchema.parse({
    id: supplement.finalEvaluator.id,
    version: supplement.finalEvaluator.version,
    artifactDigest: supplement.finalEvaluator.artifactDigest,
    outputSchemaDigest: supplement.finalEvaluator.outputSchemaDigest,
    independentValidationRecordDigest:
      supplement.finalEvaluator.independentValidationRecordDigest,
  });
}

export async function evaluateM9b3ProbeAdvancement(
  preparationInput: unknown,
  preparation: unknown,
  prospectiveSupplementInput: unknown,
  prospectiveSupplement: unknown,
  goldToken: M9b3dTrustedGold,
  developmentSuite: M9b2PreparedSuite,
  probeSuite: M9b2PreparedSuite,
  primarySuite: M9b2PreparedSuite,
  seedReveal: unknown,
  schedule: unknown,
  measurements: ReadonlyArray<M9b3ePairedMeasurementVerification>,
): Promise<Result<M9b3ProbeDecision, Diagnostic>> {
  const verifiedPreparation = await verifyM9b3OfflineStudy(
    preparationInput,
    preparation,
  );
  if (!verifiedPreparation.ok)
    return invalid("M9b.3e probe preparation is invalid.");
  const verifiedSupplement = await verifyM9b3ProspectiveSupplement(
    preparationInput,
    preparation,
    prospectiveSupplementInput,
    probeSuite,
    goldToken,
    prospectiveSupplement,
  );
  if (!verifiedSupplement.ok)
    return invalid("M9b.3e probe prospective supplement is invalid.");
  const populations = await bindM9b3Populations(
    preparationInput,
    preparation,
    developmentSuite,
    probeSuite,
    primarySuite,
  );
  if (!populations.ok) return populations;
  const verifiedSchedule = await verifyM9b3MaterializedSchedule(
    preparationInput,
    preparation,
    developmentSuite,
    probeSuite,
    primarySuite,
    seedReveal,
    schedule,
  );
  if (!verifiedSchedule.ok) return verifiedSchedule;
  if (
    measurements.length !== M9B3_PROBE_PAIRED_CASES ||
    !unique(measurements.map((measurement) => measurement.caseId))
  )
    return invalid(
      "M9b.3e probe measurements must exactly cover 24 unique paired cases.",
    );
  const measurementsByCase = new Map(
    measurements.map((measurement) => [measurement.caseId, measurement]),
  );
  if (
    populations.value.probe.cases.some(
      (candidate) => !measurementsByCase.has(candidate.caseId),
    )
  )
    return invalid(
      "M9b.3e probe measurements do not cover the bound probe inventory.",
    );
  const populationCases = new Map(
    populations.value.probe.cases.map((candidate) => [
      candidate.caseId,
      candidate,
    ]),
  );
  const sourcePairs: Array<z.infer<typeof probeSourcePairSchema>> = [];
  for (const scheduleEntry of verifiedSchedule.value.probeEntries) {
    const measurement = measurementsByCase.get(scheduleEntry.caseId);
    const populationCase = populationCases.get(scheduleEntry.caseId);
    if (measurement === undefined || populationCase === undefined)
      return invalid("M9b.3e probe schedule lost a bound case.");
    const evaluatorArtifact = evaluatorArtifactFromSupplement(
      verifiedSupplement.value,
    );
    const discovered = await measureM9b3eVerifiedTerminalRecord(
      measurement.discovered,
      evaluatorArtifact,
      goldToken,
    );
    const staticMeasurement = await measureM9b3eVerifiedTerminalRecord(
      measurement.static,
      evaluatorArtifact,
      goldToken,
    );
    const discoveredTerminal =
      m9b1InternalInspectArtifactBoundVerifiedTerminalRecord(
        measurement.discovered.verifiedRecord,
      );
    const staticTerminal =
      m9b1InternalInspectArtifactBoundVerifiedTerminalRecord(
        measurement.static.verifiedRecord,
      );
    const scheduledExecutionOrder =
      scheduleEntry.firstArm === "discovered-program"
        ? "discovered-first"
        : "static-first";
    if (
      !discovered.ok ||
      !staticMeasurement.ok ||
      discoveredTerminal === undefined ||
      staticTerminal === undefined ||
      discoveredTerminal.result.record.sourceRecord.executionOrder !==
        scheduledExecutionOrder ||
      staticTerminal.result.record.sourceRecord.executionOrder !==
        scheduledExecutionOrder ||
      measurement.caseId !== scheduleEntry.caseId ||
      discovered.value.caseId !== scheduleEntry.caseId ||
      staticMeasurement.value.caseId !== scheduleEntry.caseId ||
      discovered.value.suiteDigest !== populations.value.probe.suiteDigest ||
      staticMeasurement.value.suiteDigest !==
        populations.value.probe.suiteDigest ||
      discovered.value.arm !== "discovered-program" ||
      staticMeasurement.value.arm !== "static-one-shot" ||
      discovered.value.comparisonDigest !==
        staticMeasurement.value.comparisonDigest ||
      discovered.value.taskDigest !== staticMeasurement.value.taskDigest ||
      discovered.value.corpusSnapshotDigest !==
        staticMeasurement.value.corpusSnapshotDigest ||
      discovered.value.corpusSnapshotDigest !== populationCase.snapshotDigest ||
      discovered.value.corpusSnapshotDigest !== scheduleEntry.snapshotDigest ||
      !canonicalEqual(discovered.value.model, staticMeasurement.value.model) ||
      !canonicalEqual(
        discovered.value.evaluator,
        staticMeasurement.value.evaluator,
      ) ||
      !canonicalEqual(
        discovered.value.evaluatorArtifact,
        staticMeasurement.value.evaluatorArtifact,
      ) ||
      !canonicalEqual(
        discovered.value.goldArtifact,
        staticMeasurement.value.goldArtifact,
      ) ||
      !modelIdentityMatchesPreparation(
        discovered.value,
        verifiedPreparation.value,
      ) ||
      !evaluatorIdentityMatchesSupplement(
        discovered.value,
        verifiedSupplement.value,
      )
    )
      return invalid(
        "M9b.3e probe measurements are not cross-bound scheduled opposites.",
      );
    sourcePairs.push(
      probeSourcePairSchema.parse({
        caseId: scheduleEntry.caseId,
        scheduleExecutionOrdinal: scheduleEntry.executionOrdinal,
        scheduleFirstArm: scheduleEntry.firstArm,
        comparisonDigest: discovered.value.comparisonDigest,
        taskDigest: discovered.value.taskDigest,
        corpusSnapshotDigest: discovered.value.corpusSnapshotDigest,
        evaluatorArtifact: discovered.value.evaluatorArtifact,
        goldArtifact: discovered.value.goldArtifact,
        discovered: {
          measurementRecordDigest: discovered.value.recordDigest,
          sourceArmRecordDigest: discovered.value.sourceArmRecordDigest,
          programIdentity: discovered.value.programIdentity,
          success: discovered.value.primary.success,
        },
        static: {
          measurementRecordDigest: staticMeasurement.value.recordDigest,
          sourceArmRecordDigest: staticMeasurement.value.sourceArmRecordDigest,
          programIdentity: staticMeasurement.value.programIdentity,
          success: staticMeasurement.value.primary.success,
        },
      }),
    );
  }
  const counts = pairedSuccessCounts(sourcePairs);
  const discordantPairs = counts.discoveredOnly + counts.staticOnly;
  const discordanceLower = oneSidedClopperPearsonLowerBound(
    discordantPairs,
    M9B3_PROBE_PAIRED_CASES,
  );
  const conditionalWinLower = oneSidedClopperPearsonLowerBound(
    counts.discoveredOnly,
    discordantPairs,
  );
  const conditionalPower = exactConditionalPowerByDiscordance(
    M9B3_PRIMARY_PAIRED_CASES,
    conditionalWinLower,
    M9B3_PRIMARY_ALPHA_BASIS_POINTS / 10_000,
  );
  const conservativePower = scenarioPower(
    M9B3_PRIMARY_PAIRED_CASES,
    discordanceLower,
    conditionalPower,
  );
  const conservativePowerAt168BasisPoints = Math.min(
    10_000,
    Math.max(0, Math.floor(conservativePower * 10_000)),
  );
  const outcome =
    discordantPairs === 0
      ? ({ status: "no-go", reason: "zero-discordant-pairs" } as const)
      : conditionalWinLower <= 0.5
        ? ({
            status: "no-go",
            reason: "nonpositive-conservative-direction",
          } as const)
        : conservativePowerAt168BasisPoints < M9B3_TARGET_POWER_BASIS_POINTS
          ? ({
              status: "no-go",
              reason: "conservative-power-below-8000-basis-points",
            } as const)
          : ({ status: "pass" } as const);
  const sourceMeasurementInventoryDigest = await digestValue({
    protocol: "lachesis-m9b3e-probe-measurement-inventory/1",
    preparationDigest: verifiedPreparation.value.preparationDigest,
    prospectiveSupplementDigest: verifiedSupplement.value.supplementDigest,
    populationBindingDigest: populations.value.bindingDigest,
    scheduleDigest: verifiedSchedule.value.scheduleDigest,
    sourcePairs,
  });
  if (!sourceMeasurementInventoryDigest.ok)
    return sourceMeasurementInventoryDigest;
  const body = probeDecisionBodySchema.parse({
    protocol: "lachesis-m9b3e-probe-advancement-decision/1",
    gateProtocol: "lachesis-m9b3e-probe-advancement-gate/1",
    preparationDigest: verifiedPreparation.value.preparationDigest,
    prospectiveSupplementDigest: verifiedSupplement.value.supplementDigest,
    populationBindingDigest: populations.value.bindingDigest,
    probeSuiteDigest: populations.value.probe.suiteDigest,
    probeInventoryDigest: populations.value.probe.inventoryDigest,
    scheduleDigest: verifiedSchedule.value.scheduleDigest,
    endpoint: M9B2_PRIMARY_ENDPOINT,
    model: {
      id: verifiedPreparation.value.providerProfile.model.id,
      version: verifiedPreparation.value.providerProfile.model.revision,
    },
    evaluator: {
      id: verifiedSupplement.value.finalEvaluator.id,
      version: verifiedSupplement.value.finalEvaluator.version,
    },
    finalGold: verifiedSupplement.value.finalGold,
    sourcePairs,
    sourceMeasurementInventoryDigest: sourceMeasurementInventoryDigest.value,
    counts,
    discordantPairs,
    discordanceRateLowerBoundBasisPoints: Math.floor(discordanceLower * 10_000),
    conditionalDiscoveredWinLowerBoundBasisPoints: Math.floor(
      conditionalWinLower * 10_000,
    ),
    conservativePowerAt168BasisPoints,
    outcome,
  });
  const decisionDigest = await digestValue(body);
  return decisionDigest.ok
    ? {
        ok: true,
        value: m9b3ProbeDecisionSchema.parse({
          ...body,
          decisionDigest: decisionDigest.value,
        }),
      }
    : decisionDigest;
}

export async function verifyM9b3ProbeAdvancement(
  preparationInput: unknown,
  preparation: unknown,
  prospectiveSupplementInput: unknown,
  prospectiveSupplement: unknown,
  goldToken: M9b3dTrustedGold,
  developmentSuite: M9b2PreparedSuite,
  probeSuite: M9b2PreparedSuite,
  primarySuite: M9b2PreparedSuite,
  seedReveal: unknown,
  schedule: unknown,
  measurements: ReadonlyArray<M9b3ePairedMeasurementVerification>,
  value: unknown,
): Promise<Result<M9b3ProbeDecision, Diagnostic>> {
  const parsed = m9b3ProbeDecisionSchema.safeParse(value);
  if (!parsed.success) return invalid("M9b.3e probe decision is invalid.");
  const rederived = await evaluateM9b3ProbeAdvancement(
    preparationInput,
    preparation,
    prospectiveSupplementInput,
    prospectiveSupplement,
    goldToken,
    developmentSuite,
    probeSuite,
    primarySuite,
    seedReveal,
    schedule,
    measurements,
  );
  return rederived.ok && canonicalEqual(rederived.value, parsed.data)
    ? { ok: true, value: parsed.data }
    : invalid("M9b.3e probe decision failed complete rederivation.");
}

/** Freezes prospective identities and rules only. It performs no external effects. */
export async function prepareM9b3OfflineStudy(
  input: unknown,
): Promise<Result<M9b3Preparation, Diagnostic>> {
  const preparationInput = m9b3PreparationInputSchema.safeParse(input);
  if (!preparationInput.success)
    return invalid("M9b.3e offline preparation input is invalid.");
  const profile = preparationInput.data.providerProfile;
  const inputCost = tokenCostCeiling(
    M9B1_MATCHED_MODEL_ENVELOPE.maxInputTokens,
    profile.pricing.inputUsdMicrosPerMillionTokens,
  );
  const outputCost = tokenCostCeiling(
    M9B1_MATCHED_MODEL_ENVELOPE.maxOutputTokens,
    profile.pricing.outputUsdMicrosPerMillionTokens,
  );
  if (inputCost === undefined || outputCost === undefined)
    return invalid("M9b.3e matched cost ceiling exceeds safe integer bounds.");
  const maximumCostUsdMicrosPerArm = inputCost + outputCost;
  if (!Number.isSafeInteger(maximumCostUsdMicrosPerArm))
    return invalid("M9b.3e matched cost sum exceeds safe integer bounds.");
  const maximumPreparedStudyCostUsdMicros =
    maximumCostUsdMicrosPerArm * M9B3_PREPARED_PAIRED_CASES * 2;
  if (!Number.isSafeInteger(maximumPreparedStudyCostUsdMicros))
    return invalid("M9b.3e prepared study cost exceeds safe integer bounds.");

  const corpusConstruction = corpusConstructionSchema.parse({
    protocol: "lachesis-m9b3a-natural-corpus-construction/1",
    timing: "only-after-external-preregistration-before-any-provider-call",
    roles: [
      "independent-corpus-constructor",
      "independent-gold-annotator",
      "blind-split-auditor",
    ],
    taskFamilies: M9B2_TASK_FAMILIES,
    corpusScales: M9B2_CORPUS_SCALES,
    scaleValidation: {
      protocol: "lachesis-m9b3a-corpus-scale-validation/1",
      metric: "m9a-snapshot-corpusbytes-canonical-nfc-document-text-utf8-bytes",
      baseBytes: M9B3_SCALE_BASE_BYTES,
      acceptanceRule:
        "claimed-scale-range-is-inclusive-and-ranges-do-not-overlap",
      ranges: M9B3_SCALE_RANGES,
      outOfRangeBehavior: "reject-corpus-before-suite-binding",
    },
    documentSubstrate:
      "natural-text-documents-substrate-neutral-no-typegraph-requirement",
    searchPrimitive:
      "one-frozen-deterministic-lexical-search-shared-by-both-arms",
    independenceUnit:
      "one-semantic-problem-with-no-shared-entity-source-template-answer-fact-or-content-lineage",
    scalePolicy:
      "scale-is-a-stratum-and-same-problem-scale-clusters-are-reserved-for-m9d",
    requiredSplitAuditProtocol: "lachesis-m9b2d-split-disjointness-audit/5",
    requiredGold:
      "snapshot-bound-supporting-facts-answers-abstentions-and-citation-contracts",
    promptInjectionCasesRequired: true,
    finalCorpusMaterialized: false,
    finalCorpusIdentity: "absent",
  });
  const studyBindings = studyBindingsSchema.parse({
    protocol: "lachesis-m9b3a-study-bindings/1",
    programDiscovery: {
      id: M9B1_ARTIFACT_BOUND_DISCOVERY_PROTOCOL.id,
      version: M9B1_ARTIFACT_BOUND_DISCOVERY_PROTOCOL.version,
      promptBundleDigest: preparationInput.data.promptBundleDigest,
    },
    measurement: {
      id: M9B2_MEASUREMENT_PROTOCOL.id,
      version: M9B2_MEASUREMENT_PROTOCOL.version,
      primaryEndpoint: M9B2_PRIMARY_ENDPOINT,
      inferenceAudit: "lachesis-m9b2d-m9c-inference-unit-audit/3",
      descriptiveReport: "lachesis-m9b2d-m9c-descriptive-report/4",
      splitAudit: "lachesis-m9b2d-split-disjointness-audit/5",
    },
    developmentEvaluator: {
      id: M9B2_EVALUATOR_IDENTITY.id,
      version: M9B2_EVALUATOR_IDENTITY.version,
      campaignEligible: false,
    },
    finalGoldIdentity: "absent-pending-independent-validation",
    finalEvaluatorIdentity: "absent-pending-independent-validation",
  });
  const allocation = allocationSchema.parse({
    protocol: "lachesis-m9b3e-balanced-allocation/1",
    cells: 24,
    protocolProbePairedCases: 24,
    protocolProbeCasesPerCell: 1,
    primaryPairedCases: 168,
    primaryCasesPerCell: 7,
    practicalPairedCaseCeiling: 480,
    weighting: "equal-family-by-scale-cell-weight",
    probeExcludedFromPrimaryAnalysis: true,
    primaryPopulationFixedBeforePrimaryExecution: true,
    populationBindingProtocol:
      "lachesis-m9b3e-prospective-population-binding/1",
    historicalDevelopmentBaseline:
      preparationInput.data.historicalDevelopmentBaseline,
    probeSuiteIdentity: "absent-pending-corpus-construction",
    primarySuiteIdentity: "absent-pending-corpus-construction",
    completeInventoriesRequired: true,
    allThreePairwiseM9b2dSplitAuditsRequired: true,
    primaryReportCoverage:
      "exact-complete-primary-suite-token-required-by-m9b2d",
    allocationMaterialized: false,
  });
  const schedule = scheduleSchema.parse({
    protocol: "lachesis-m9b3e-paired-counterbalance-schedule/1",
    unit: "one-paired-case",
    arms: ["discovered-program", "static-one-shot"],
    algorithm: "canonical-sha256-cell-balanced-paired-counterbalance/1",
    canonicalHashEncoding: "lachesis-canonical-json-utf8-sha256-digestvalue",
    seedCommitmentFrame: "protocol-purpose-and-256-bit-seed-reveal",
    cellOrderFrame: "protocol-seed-population-family-and-scale",
    caseOrderFrame:
      "protocol-seed-population-suite-inventory-case-semantic-snapshot-family-and-scale",
    executionOrderFrame: "protocol-seed-population-and-case-order-key",
    tieBreak: "ascending-canonical-identifier-code-unit-order",
    oddCellRule:
      "hash-sort-24-cells-alternate-leading-arm-then-alternate-within-cell",
    phaseRule: "all-probe-cases-before-gate-and-primary-cases-only-after-pass",
    seedCommitment: preparationInput.data.scheduleSeedCommitment,
    seedRevealTiming:
      "after-complete-corpus-and-gold-freeze-before-provider-adapter-preflight",
    distinctSessionsPerArmAndRole: true,
    sessionReuseAcrossCases: false,
    scheduleMaterialized: false,
    scheduleDigest: "absent",
  });
  const probeGate = probeGateProtocolSchema.parse({
    protocol: "lachesis-m9b3e-probe-advancement-gate/1",
    endpoint: M9B2_PRIMARY_ENDPOINT,
    statistic:
      "first-attempt-discovered-only-static-only-and-concordant-pair-counts",
    sourceBoundary:
      "complete-opaque-probe-suite-plus-24-paired-m9b3e-predispatch-artifact-terminal-measurements",
    requiredBindings:
      "preparation-supplement-opaque-gold-scoring-source-evaluator-artifact-output-schema-validation-population-schedule-endpoint-model-and-all-source-record-digests",
    callerAuthoredAggregateCountsAccepted: false,
    probePairedCases: M9B3_PROBE_PAIRED_CASES,
    estimator: "observed-discordance-rate-and-conditional-discovered-win-rate",
    confidenceMethod:
      "bonferroni-two-one-sided-clopper-pearson-exact-tail-inversion",
    jointCoverageBasisPoints: 9_500,
    componentAlphaBasisPoints: M9B3_PROBE_COMPONENT_ALPHA_BASIS_POINTS,
    tailInversionBisections: M9B3_CONFIDENCE_BISECTIONS,
    primaryPairedCases: M9B3_PRIMARY_PAIRED_CASES,
    primaryTest: "exact-one-sided-conditional-mcnemar",
    primaryAlphaBasisPoints: M9B3_PRIMARY_ALPHA_BASIS_POINTS,
    targetPowerBasisPoints: M9B3_TARGET_POWER_BASIS_POINTS,
    powerRounding: "floor-to-integer-basis-points-before-threshold",
    passRule:
      "both-lower-bounds-positive-direction-and-conservative-power-at-168-at-least-8000-basis-points",
    failureBehavior:
      "any-invalid-count-zero-discordance-nonpositive-lower-direction-or-underpower-is-no-go",
  });
  const matchedBudget = matchedBudgetSchema.parse({
    protocol: "lachesis-m9b3a-complete-effects-budget/1",
    inputTokensPerArm: M9B1_MATCHED_MODEL_ENVELOPE.maxInputTokens,
    outputTokensPerArm: M9B1_MATCHED_MODEL_ENVELOPE.maxOutputTokens,
    reasoningTokensPerArm: 0,
    modelTimeMsPerArm: M9B1_MATCHED_MODEL_ENVELOPE.maxWallClockMs,
    maximumSearchCalls: 4,
    maximumReadCalls: 4,
    maximumReadBytes: 4_096,
    maximumDiscoveredModelCalls: 6,
    maximumStaticModelCalls: 2,
    evaluatorExecution: "deterministic-local-arm-blind-zero-provider-effects",
    evaluatorProviderCalls: 0,
    evaluatorModelTokens: 0,
    evaluatorCostUsdMicros: 0,
    sdkTransportRetriesPerLogicalRequest: 0,
    controllerDispatchRetriesPerLogicalRequest: 0,
    maximumProviderAttemptsPerLogicalRequest: 1,
    maximumLogicalProviderRequestsPerPair: 8,
    maximumProviderAttemptsPerPair: 8,
    maximumPreparedProviderAttempts: 1_536,
    retryFailureBehavior: "first-dispatch-failure-is-terminal",
    maximumCostUsdMicrosPerArm,
    preparedPairedCases: M9B3_PREPARED_PAIRED_CASES,
    maximumPreparedStudyCostUsdMicros,
    preDispatchReservationRequired: true,
    actualUsageReconciliationRequired: true,
    sameAggregateCeilingAcrossArms: true,
    spendingAuthorized: false,
  });
  const gates = gateSchema.parse({
    protocol: "lachesis-m9b3e-advancement-gates/1",
    beforeCorpusConstruction: [
      "independent-m9b3a-architecture-security-scientific-review",
      "external-preregistration-of-construction-protocol",
    ],
    beforeProviderAdapter: [
      "complete-corpus-and-gold-frozen",
      "all-corpus-scale-validations-passed",
      "probe-and-primary-population-binding-passed",
      "all-three-pairwise-m9b2d-split-audits-passed",
      "independent-gold-and-evaluator-validation-passed",
      "provider-request-serializer-reviewed",
      "exact-tokenizer-offline-conformance-passed",
      "pricing-and-capacity-snapshot-reviewed",
    ],
    beforeAnyProviderCall: [
      "protocol-probe-corpus-supplement-registered",
      "counterbalanced-schedule-frozen",
      "atomic-persistence-and-zero-effect-resume-reviewed",
      "budget-ledger-preflight-passed",
      "credential-preflight-passed-without-recording-secrets",
      "separate-explicit-live-authorization",
    ],
    beforePrimaryExecution: [
      "verified-probe-population-completed",
      "m9b3e-probe-advancement-decision-is-pass",
      "probe-decision-source-measurement-inventory-verified",
      "exact-primary-suite-and-schedule-binding-verified",
    ],
    killGates: [
      "corpus-or-gold-leakage-to-authoring-boundary",
      "provider-model-tokenizer-or-serializer-identity-drift",
      "unreserved-model-or-read-dispatch",
      "cross-arm-or-cross-role-session-reuse",
      "split-disjointness-or-semantic-independence-failure",
      "missing-or-reordered-schedule-entry",
      "budget-or-capacity-bound-exceeded",
      "preregistration-or-corpus-supplement-binding-mismatch",
    ],
  });
  const preregistration = preregistrationSchema.parse({
    protocol: "lachesis-m9b3e-preregistration-materials/1",
    status: "offline-draft-not-externally-registered",
    primaryEndpoint: M9B2_PRIMARY_ENDPOINT,
    primaryTest: "exact-one-sided-conditional-mcnemar",
    alphaBasisPoints: 500,
    targetPowerBasisPoints: 8_000,
    primaryClaim:
      "discovered-program-has-higher-first-attempt-success-than-static-one-shot",
    superiorityClaimAuthorized: false,
    requiredBindings: [
      "corpus-construction-protocol-digest",
      "study-bindings-digest",
      "provider-profile-digest",
      "allocation-digest",
      "schedule-protocol-digest",
      "probe-gate-protocol-digest",
      "matched-budget-digest",
      "measurement-and-evaluator-validation-digests",
      "analysis-code-and-report-schema-digests",
      "historical-development-baseline-digest",
    ],
    requiredProspectiveSupplement: [
      "complete-development-probe-and-primary-suite-inventory-digests",
      "complete-snapshot-and-scale-validation-digests",
      "all-three-pairwise-m9b2d-split-audit-digests",
      "opaque-probe-gold-scoring-source-and-final-evaluator-artifact-schema-validation-digests",
      "seed-reveals-and-materialized-schedule-digest",
      "protocol-probe-discordance-and-power-gate-decision",
    ],
    corpusIdentity: "absent",
    externalRegistration: "not-performed",
    executionAuthorization: "absent",
  });
  const providerIdentity = await identified(profile);
  if (!providerIdentity.ok) return providerIdentity;
  const historicalDevelopmentBaselineIdentity = await identified(
    preparationInput.data.historicalDevelopmentBaseline,
  );
  if (!historicalDevelopmentBaselineIdentity.ok)
    return historicalDevelopmentBaselineIdentity;
  const studyBindingsIdentity = await identified(studyBindings);
  if (!studyBindingsIdentity.ok) return studyBindingsIdentity;
  const corpusIdentity = await identified(corpusConstruction);
  if (!corpusIdentity.ok) return corpusIdentity;
  const allocationIdentity = await identified(allocation);
  if (!allocationIdentity.ok) return allocationIdentity;
  const scheduleIdentity = await identified(schedule);
  if (!scheduleIdentity.ok) return scheduleIdentity;
  const probeGateIdentity = await identified(probeGate);
  if (!probeGateIdentity.ok) return probeGateIdentity;
  const budgetIdentity = await identified(matchedBudget);
  if (!budgetIdentity.ok) return budgetIdentity;
  const gatesIdentity = await identified(gates);
  if (!gatesIdentity.ok) return gatesIdentity;
  const preregistrationIdentity = await identified(preregistration);
  if (!preregistrationIdentity.ok) return preregistrationIdentity;
  const body = preparationBodySchema.parse({
    protocol: M9B3_PREPARATION_PROTOCOL.id,
    version: M9B3_PREPARATION_PROTOCOL.version,
    status: "offline-preparation-complete-m9b-live-no-go",
    providerProfile: providerIdentity.value.value,
    providerProfileDigest: providerIdentity.value.digest,
    historicalDevelopmentBaseline:
      historicalDevelopmentBaselineIdentity.value.value,
    historicalDevelopmentBaselineDigest:
      historicalDevelopmentBaselineIdentity.value.digest,
    authoringVisibility: {
      visible: "task-grammar-capabilities-and-budget-only",
      providerModelTokenizerPricingAndArmIdentitiesExcluded: true,
    },
    studyBindings: studyBindingsIdentity.value.value,
    studyBindingsDigest: studyBindingsIdentity.value.digest,
    corpusConstruction: corpusIdentity.value.value,
    corpusConstructionDigest: corpusIdentity.value.digest,
    allocation: allocationIdentity.value.value,
    allocationDigest: allocationIdentity.value.digest,
    schedule: scheduleIdentity.value.value,
    scheduleProtocolDigest: scheduleIdentity.value.digest,
    probeGate: probeGateIdentity.value.value,
    probeGateProtocolDigest: probeGateIdentity.value.digest,
    matchedBudget: budgetIdentity.value.value,
    matchedBudgetDigest: budgetIdentity.value.digest,
    gates: gatesIdentity.value.value,
    gatesDigest: gatesIdentity.value.digest,
    preregistration: preregistrationIdentity.value.value,
    preregistrationMaterialsDigest: preregistrationIdentity.value.digest,
    authority: {
      corpusMaterializationAuthorized: false,
      credentialsAccessed: false,
      providerAdapterCreated: false,
      providerCallsAuthorized: false,
      executionStateCreated: false,
      externalPreregistrationPerformed: false,
      liveExecutionAuthorized: false,
    },
    decision: {
      outcome: "no-go",
      blockers: [
        "external-preregistration-not-performed",
        "corpus-and-gold-not-materialized",
        "independent-evaluator-validation-not-complete",
        "provider-adapter-and-tokenizer-conformance-absent",
        "empirical-discordance-gate-not-run",
        "schedule-not-materialized",
        "explicit-live-authorization-absent",
      ],
    },
  });
  const preparationDigest = await digestValue(body);
  return preparationDigest.ok
    ? {
        ok: true,
        value: m9b3PreparationSchema.parse({
          ...body,
          preparationDigest: preparationDigest.value,
        }),
      }
    : preparationDigest;
}

/** Rederives the complete offline preparation from independently trusted input. */
export async function verifyM9b3OfflineStudy(
  input: unknown,
  value: unknown,
): Promise<Result<M9b3Preparation, Diagnostic>> {
  const parsed = m9b3PreparationSchema.safeParse(value);
  if (!parsed.success)
    return invalid("M9b.3e preparation artifact is invalid.");
  const rederived = await prepareM9b3OfflineStudy(input);
  return rederived.ok && canonicalEqual(rederived.value, parsed.data)
    ? { ok: true, value: parsed.data }
    : invalid("M9b.3e preparation failed complete offline rederivation.");
}

/** Freezes reviewed final gold/evaluator identities without granting authority. */
export async function prepareM9b3ProspectiveSupplement(
  preparationInput: unknown,
  preparation: unknown,
  input: unknown,
  probeSuite: M9b2PreparedSuite,
  goldToken: M9b3dTrustedGold,
): Promise<Result<M9b3ProspectiveSupplement, Diagnostic>> {
  const verifiedPreparation = await verifyM9b3OfflineStudy(
    preparationInput,
    preparation,
  );
  const parsed = m9b3ProspectiveSupplementInputSchema.safeParse(input);
  const gold = inspectM9b3dTrustedGold(goldToken);
  const probe = inspectM9b2PreparedSuite(probeSuite);
  if (
    !verifiedPreparation.ok ||
    !parsed.success ||
    gold?.suiteDigest !== probe?.suiteDigest ||
    !canonicalEqual(gold, parsed.data.finalGold)
  )
    return invalid("M9b.3e prospective supplement input is invalid.");
  const body = prospectiveSupplementBodySchema.parse({
    protocol: "lachesis-m9b3e-prospective-supplement/1",
    status:
      "offline-identities-frozen-no-preregistration-or-execution-authority",
    preparationDigest: verifiedPreparation.value.preparationDigest,
    historicalDevelopmentBaselineDigest:
      verifiedPreparation.value.historicalDevelopmentBaselineDigest,
    finalGold: gold,
    finalEvaluator: parsed.data.finalEvaluator,
    measurementRecordProtocol:
      "lachesis-m9b3e-predispatch-artifact-terminal-measurement-record/1",
    authority: {
      corpusMaterializationAuthorized: false,
      providerAdapterAuthorized: false,
      providerCallsAuthorized: false,
      externalPreregistrationPerformed: false,
      liveExecutionAuthorized: false,
    },
  });
  const supplementDigest = await digestValue(body);
  return supplementDigest.ok
    ? {
        ok: true,
        value: m9b3ProspectiveSupplementSchema.parse({
          ...body,
          supplementDigest: supplementDigest.value,
        }),
      }
    : supplementDigest;
}

export async function verifyM9b3ProspectiveSupplement(
  preparationInput: unknown,
  preparation: unknown,
  input: unknown,
  probeSuite: M9b2PreparedSuite,
  goldToken: M9b3dTrustedGold,
  value: unknown,
): Promise<Result<M9b3ProspectiveSupplement, Diagnostic>> {
  const parsed = m9b3ProspectiveSupplementSchema.safeParse(value);
  if (!parsed.success)
    return invalid("M9b.3e prospective supplement is invalid.");
  const rederived = await prepareM9b3ProspectiveSupplement(
    preparationInput,
    preparation,
    input,
    probeSuite,
    goldToken,
  );
  return rederived.ok && canonicalEqual(rederived.value, parsed.data)
    ? { ok: true, value: parsed.data }
    : invalid("M9b.3e prospective supplement failed complete rederivation.");
}
