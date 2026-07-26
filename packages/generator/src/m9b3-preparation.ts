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
  M9B1_MATCHED_MODEL_ENVELOPE,
  M9B1_OFFLINE_DISCOVERY_PROTOCOL,
} from "./m9b1-discovery.js";
import {
  M9B2_CORPUS_SCALES,
  M9B2_EVALUATOR_IDENTITY,
  M9B2_MEASUREMENT_PROTOCOL,
  M9B2_PRIMARY_ENDPOINT,
  M9B2_TASK_FAMILIES,
} from "./m9b2-measurement.js";

export const M9B3_PREPARATION_PROTOCOL = Object.freeze({
  id: "lachesis-m9b3-offline-prospective-study-preparation",
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
          "M9b.3 provider, model, tokenizer, and pricing identities differ.",
      });
    if (
      profile.model.contextWindowTokens < M9B3_MAXIMUM_SINGLE_REQUEST_TOKENS ||
      profile.model.maximumOutputTokens <
        M9B3_AUTHORING_RESERVATION.maxOutputTokens
    )
      context.addIssue({
        code: "custom",
        message: "M9b.3 candidate model cannot contain the frozen envelope.",
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
    allocationSeedCommitment: digestSchema,
    scheduleSeedCommitment: digestSchema,
  })
  .superRefine((input, context) => {
    if (input.allocationSeedCommitment === input.scheduleSeedCommitment)
      context.addIssue({
        code: "custom",
        message:
          "M9b.3 allocation and schedule seeds require domain separation.",
      });
  })
  .readonly();
export type M9b3PreparationInput = z.infer<typeof m9b3PreparationInputSchema>;

const studyBindingsSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3-study-bindings/1"),
    programDiscovery: z
      .strictObject({
        id: z.literal(M9B1_OFFLINE_DISCOVERY_PROTOCOL.id),
        version: z.literal(M9B1_OFFLINE_DISCOVERY_PROTOCOL.version),
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

const matchedBudgetSchema = z
  .strictObject({
    inputTokensPerArm: z.literal(M9B1_MATCHED_MODEL_ENVELOPE.maxInputTokens),
    outputTokensPerArm: z.literal(M9B1_MATCHED_MODEL_ENVELOPE.maxOutputTokens),
    reasoningTokensPerArm: z.literal(0),
    modelTimeMsPerArm: z.literal(M9B1_MATCHED_MODEL_ENVELOPE.maxWallClockMs),
    maximumSearchCalls: z.literal(4),
    maximumReadCalls: z.literal(4),
    maximumReadBytes: z.literal(4_096),
    maximumDiscoveredModelCalls: z.literal(6),
    maximumStaticModelCalls: z.literal(2),
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
    protocol: z.literal("lachesis-m9b3-natural-corpus-construction/1"),
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
    protocol: z.literal("lachesis-m9b3-balanced-allocation/1"),
    cells: z.literal(24),
    protocolProbePairedCases: z.literal(24),
    protocolProbeCasesPerCell: z.literal(1),
    primaryPairedCases: z.literal(168),
    primaryCasesPerCell: z.literal(7),
    practicalPairedCaseCeiling: z.literal(480),
    weighting: z.literal("equal-family-by-scale-cell-weight"),
    probeExcludedFromPrimaryAnalysis: z.literal(true),
    primaryPopulationFixedBeforePrimaryExecution: z.literal(true),
    empiricalDiscordanceGate: z.literal(
      "probe-must-independently-support-preregistered-power-at-168-or-study-remains-no-go",
    ),
    allocationSeedCommitment: digestSchema,
    allocationMaterialized: z.literal(false),
  })
  .readonly();

const scheduleSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3-paired-counterbalance-schedule/1"),
    unit: z.literal("one-paired-case"),
    arms: z
      .tuple([z.literal("discovered-program"), z.literal("static-one-shot")])
      .readonly(),
    algorithm: z.literal(
      "sha256-revealed-seed-case-digest-stratum-balanced-alternation/1",
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

const gateSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b3-advancement-gates/1"),
    beforeCorpusConstruction: z
      .tuple([
        z.literal("independent-m9b3-architecture-security-scientific-review"),
        z.literal("external-preregistration-of-construction-protocol"),
      ])
      .readonly(),
    beforeProviderAdapter: z
      .tuple([
        z.literal("complete-corpus-and-gold-frozen"),
        z.literal("m9b2d-split-audit-passed"),
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
    protocol: z.literal("lachesis-m9b3-preregistration-materials/1"),
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
        z.literal("matched-budget-digest"),
        z.literal("measurement-and-evaluator-validation-digests"),
        z.literal("analysis-code-and-report-schema-digests"),
      ])
      .readonly(),
    requiredProspectiveSupplement: z
      .tuple([
        z.literal("complete-corpus-snapshot-and-case-inventory-digests"),
        z.literal("complete-gold-and-final-evaluator-digests"),
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

/** Freezes prospective identities and rules only. It performs no external effects. */
export async function prepareM9b3OfflineStudy(
  input: unknown,
): Promise<Result<M9b3Preparation, Diagnostic>> {
  const preparationInput = m9b3PreparationInputSchema.safeParse(input);
  if (!preparationInput.success)
    return invalid("M9b.3 offline preparation input is invalid.");
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
    return invalid("M9b.3 matched cost ceiling exceeds safe integer bounds.");
  const maximumCostUsdMicrosPerArm = inputCost + outputCost;
  if (!Number.isSafeInteger(maximumCostUsdMicrosPerArm))
    return invalid("M9b.3 matched cost sum exceeds safe integer bounds.");
  const maximumPreparedStudyCostUsdMicros =
    maximumCostUsdMicrosPerArm * M9B3_PREPARED_PAIRED_CASES * 2;
  if (!Number.isSafeInteger(maximumPreparedStudyCostUsdMicros))
    return invalid("M9b.3 prepared study cost exceeds safe integer bounds.");

  const corpusConstruction = corpusConstructionSchema.parse({
    protocol: "lachesis-m9b3-natural-corpus-construction/1",
    timing: "only-after-external-preregistration-before-any-provider-call",
    roles: [
      "independent-corpus-constructor",
      "independent-gold-annotator",
      "blind-split-auditor",
    ],
    taskFamilies: M9B2_TASK_FAMILIES,
    corpusScales: M9B2_CORPUS_SCALES,
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
    protocol: "lachesis-m9b3-study-bindings/1",
    programDiscovery: {
      id: M9B1_OFFLINE_DISCOVERY_PROTOCOL.id,
      version: M9B1_OFFLINE_DISCOVERY_PROTOCOL.version,
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
    protocol: "lachesis-m9b3-balanced-allocation/1",
    cells: 24,
    protocolProbePairedCases: 24,
    protocolProbeCasesPerCell: 1,
    primaryPairedCases: 168,
    primaryCasesPerCell: 7,
    practicalPairedCaseCeiling: 480,
    weighting: "equal-family-by-scale-cell-weight",
    probeExcludedFromPrimaryAnalysis: true,
    primaryPopulationFixedBeforePrimaryExecution: true,
    empiricalDiscordanceGate:
      "probe-must-independently-support-preregistered-power-at-168-or-study-remains-no-go",
    allocationSeedCommitment: preparationInput.data.allocationSeedCommitment,
    allocationMaterialized: false,
  });
  const schedule = scheduleSchema.parse({
    protocol: "lachesis-m9b3-paired-counterbalance-schedule/1",
    unit: "one-paired-case",
    arms: ["discovered-program", "static-one-shot"],
    algorithm:
      "sha256-revealed-seed-case-digest-stratum-balanced-alternation/1",
    seedCommitment: preparationInput.data.scheduleSeedCommitment,
    seedRevealTiming:
      "after-complete-corpus-and-gold-freeze-before-provider-adapter-preflight",
    distinctSessionsPerArmAndRole: true,
    sessionReuseAcrossCases: false,
    scheduleMaterialized: false,
    scheduleDigest: "absent",
  });
  const matchedBudget = matchedBudgetSchema.parse({
    inputTokensPerArm: M9B1_MATCHED_MODEL_ENVELOPE.maxInputTokens,
    outputTokensPerArm: M9B1_MATCHED_MODEL_ENVELOPE.maxOutputTokens,
    reasoningTokensPerArm: 0,
    modelTimeMsPerArm: M9B1_MATCHED_MODEL_ENVELOPE.maxWallClockMs,
    maximumSearchCalls: 4,
    maximumReadCalls: 4,
    maximumReadBytes: 4_096,
    maximumDiscoveredModelCalls: 6,
    maximumStaticModelCalls: 2,
    maximumCostUsdMicrosPerArm,
    preparedPairedCases: M9B3_PREPARED_PAIRED_CASES,
    maximumPreparedStudyCostUsdMicros,
    preDispatchReservationRequired: true,
    actualUsageReconciliationRequired: true,
    sameAggregateCeilingAcrossArms: true,
    spendingAuthorized: false,
  });
  const gates = gateSchema.parse({
    protocol: "lachesis-m9b3-advancement-gates/1",
    beforeCorpusConstruction: [
      "independent-m9b3-architecture-security-scientific-review",
      "external-preregistration-of-construction-protocol",
    ],
    beforeProviderAdapter: [
      "complete-corpus-and-gold-frozen",
      "m9b2d-split-audit-passed",
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
    protocol: "lachesis-m9b3-preregistration-materials/1",
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
      "matched-budget-digest",
      "measurement-and-evaluator-validation-digests",
      "analysis-code-and-report-schema-digests",
    ],
    requiredProspectiveSupplement: [
      "complete-corpus-snapshot-and-case-inventory-digests",
      "complete-gold-and-final-evaluator-digests",
      "seed-reveals-and-materialized-schedule-digest",
      "protocol-probe-discordance-and-power-gate-decision",
    ],
    corpusIdentity: "absent",
    externalRegistration: "not-performed",
    executionAuthorization: "absent",
  });
  const providerIdentity = await identified(profile);
  if (!providerIdentity.ok) return providerIdentity;
  const studyBindingsIdentity = await identified(studyBindings);
  if (!studyBindingsIdentity.ok) return studyBindingsIdentity;
  const corpusIdentity = await identified(corpusConstruction);
  if (!corpusIdentity.ok) return corpusIdentity;
  const allocationIdentity = await identified(allocation);
  if (!allocationIdentity.ok) return allocationIdentity;
  const scheduleIdentity = await identified(schedule);
  if (!scheduleIdentity.ok) return scheduleIdentity;
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
  if (!parsed.success) return invalid("M9b.3 preparation artifact is invalid.");
  const rederived = await prepareM9b3OfflineStudy(input);
  return rederived.ok && canonicalEqual(rederived.value, parsed.data)
    ? { ok: true, value: parsed.data }
    : invalid("M9b.3 preparation failed complete offline rederivation.");
}
