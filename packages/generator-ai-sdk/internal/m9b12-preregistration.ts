import { canonicalizeJson, digestValue, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import { M9B3_PREPARATION_PROTOCOL } from "../../generator/src/m9b3-preparation.js";
import {
  deriveM9b10AuthoritativeModerateEnvelope,
  m9b10AuthoritativeModerateEnvelopeSchema,
  verifyM9b10AuthoritativeModerateEnvelope,
} from "./m9b10-output-envelope.js";
import {
  M9B10B_PRIMARY_ANALYSIS_PROTOCOL,
  M9B10B_SELECTED_MEASUREMENT_PROTOCOL,
  M9B10B_SELECTED_TOPOLOGY_PROTOCOL,
  m9b10bInternalExactFavorableTail,
} from "./m9b10b-selected-topology.js";
import {
  M9B11_SHADOW_PRICING_PROTOCOL,
  type M9b11CampaignFreeze,
  prepareM9b11CampaignFreeze,
  verifyM9b11CampaignFreeze,
} from "./m9b11-shadow-pricing.js";

export const M9B12_PREREGISTRATION_PROTOCOL = Object.freeze({
  id: "lachesis-m9b12-offline-preregistration-package",
  version: "1.0.0",
  baselineCommit: "0096c1ff119ab6556edd8c9bacbd618a78b573cd",
  visibility: "private-offline-preregistration-preparation-only" as const,
  decision:
    "preregistration-package-ready-awaiting-external-authorization" as const,
  claimBoundary:
    "immutable offline preregistration materials only; no registration, corpus, gold, project, credential, provider, count, inference, campaign, publication, release, or push authority",
});

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const familySchema = z.enum([
  "lookup",
  "join",
  "multi-hop",
  "temporal-retraction",
  "contradiction",
  "aggregation",
  "insufficient-evidence",
  "prompt-injection",
]);
const scaleSchema = z.enum(["1x", "8x", "32x"]);
const requestClassSchema = z.enum([
  "root-program-authoring",
  "static-one-shot-query-planning",
  "discovered-program-leaf-reasoning",
  "static-answer-generation",
]);

const disjointnessDimensionSchema = z.enum([
  "development-fixtures",
  "cases",
  "documents",
  "entities",
  "answers",
  "supporting-facts",
  "templates",
  "surface-forms",
  "corpus-snapshots",
  "construction-seeds",
  "source-provenance",
]);

const endpointStageSchema = z.enum([
  "valid-first-authoring-response",
  "valid-program-or-query",
  "successful-bounded-retrieval",
  "valid-first-grounded-answer-response",
  "correct-typed-outcome",
  "correct-answer-values",
  "sufficient-visible-supporting-evidence",
  "valid-supporting-fact-identities-and-citations",
  "provenance-and-snapshot-consistency",
  "trusted-local-evaluator-success",
  "no-repair-retry-ambiguity-overage-authority-or-protocol-violation",
]);

const sequenceStepSchema = z.enum([
  "external-preregistration",
  "fresh-corpus-construction-and-isolated-materialization",
  "independent-corpus-freshness-and-disclosure-review",
  "runtime-and-environment-binding",
  "provider-project-and-hard-cap-activation",
  "credential-custody-activation",
  "count-only-operational-probe",
  "spend-and-count-pricing-reconciliation",
  "separate-authorization-for-24-pair-protocol-probe",
  "offline-reporting-and-frozen-probe-gate-decision",
  "conditional-separate-authorization-for-168-pair-primary",
  "final-analysis-replay-accounting-security-revocation-and-closure",
]);

const killGateSchema = z.enum([
  "observed-count-charge-above-shadow-reservation",
  "new-fixed-per-count-fee",
  "authoritative-pricing-contradicts-frozen-rule",
  "unexpected-cache-service-tier-regional-or-long-context-classification",
  "provider-project-initial-spend-is-not-zero",
  "provider-hard-cap-unavailable-or-changed",
  "spend-reconciliation-missing-or-late",
  "count-response-or-api-shape-drift",
  "count-ambiguity",
  "count-and-inference-identity-mismatch",
  "automatic-retry",
  "inference-during-count-only-probe",
]);

const authorizationKindSchema = z.enum([
  "external-preregistration",
  "corpus-materialization",
  "provider-cap-and-credential-activation",
  "count-only-pricing-probe",
  "twenty-four-pair-protocol-probe",
  "conditional-168-pair-primary-execution",
  "final-closure-and-credential-revocation",
]);

const authoritySchema = z
  .strictObject({
    packagePreparationComplete: z.literal(true),
    externalRegistrationAuthorized: z.literal(false),
    corpusMaterializationAuthorized: z.literal(false),
    hiddenGoldCreationAuthorized: z.literal(false),
    projectAccessAuthorized: z.literal(false),
    credentialAccessAuthorized: z.literal(false),
    providerAccessAuthorized: z.literal(false),
    tokenCountAuthorized: z.literal(false),
    inferenceAuthorized: z.literal(false),
    probeAuthorized: z.literal(false),
    primaryAuthorized: z.literal(false),
    campaignActivationAuthorized: z.literal(false),
    budgetActivationAuthorized: z.literal(false),
    publicationAuthorized: z.literal(false),
    releaseAuthorized: z.literal(false),
    pushAuthorized: z.literal(false),
  })
  .readonly();

const preregistrationBodySchema = z
  .strictObject({
    protocol: z.literal(M9B12_PREREGISTRATION_PROTOCOL.id),
    version: z.literal(M9B12_PREREGISTRATION_PROTOCOL.version),
    baselineCommit: z.literal(M9B12_PREREGISTRATION_PROTOCOL.baselineCommit),
    status: z.literal("offline-immutable-draft-not-externally-registered"),
    inheritedDecisions: z
      .tuple([
        z.literal("authority-lineage-review-pass-pricing-blocked"),
        z.literal(
          "shadow-priced-campaign-go-for-offline-preregistration-preparation",
        ),
      ])
      .readonly(),
    researchQuestion: z.literal(
      "Does a TypeScript/JavaScript CodeMode harness that lets the model author and locally execute an evidence-adaptive retrieval program improve first-attempt grounded task success over a matched static one-shot retrieval harness operating on the same external corpus snapshot?",
    ),
    bindings: z
      .strictObject({
        preparation: z
          .strictObject({
            id: z.literal(M9B3_PREPARATION_PROTOCOL.id),
            version: z.literal(M9B3_PREPARATION_PROTOCOL.version),
            implementationSha256: z.literal(
              "0ec98e0dd68bf194a94fcbe971241404b6202f44c29fdd319fad3d953a82e585",
            ),
            probeGate: z.literal("lachesis-m9b3f-probe-advancement-gate/1"),
            schedule: z.literal(
              "lachesis-m9b3f-paired-counterbalance-schedule/1",
            ),
            materializedSchedule: z.literal(
              "lachesis-m9b3f-materialized-schedule/1",
            ),
          })
          .readonly(),
        topology: z
          .strictObject({
            id: z.literal(M9B10B_SELECTED_TOPOLOGY_PROTOCOL.id),
            version: z.literal(M9B10B_SELECTED_TOPOLOGY_PROTOCOL.version),
            implementationSha256: z.literal(
              "f21ec84ed1163eb2ae9b78350eaf480704596dad9f2a764502a80f690a17640e",
            ),
          })
          .readonly(),
        measurement: z
          .strictObject({
            id: z.literal(M9B10B_SELECTED_MEASUREMENT_PROTOCOL.id),
            version: z.literal(M9B10B_SELECTED_MEASUREMENT_PROTOCOL.version),
            endpoint: z.literal(
              M9B10B_SELECTED_MEASUREMENT_PROTOCOL.primaryEndpoint,
            ),
          })
          .readonly(),
        analyzer: z
          .strictObject({
            id: z.literal(M9B10B_PRIMARY_ANALYSIS_PROTOCOL.id),
            version: z.literal(M9B10B_PRIMARY_ANALYSIS_PROTOCOL.version),
            implementationSha256: z.literal(
              "f21ec84ed1163eb2ae9b78350eaf480704596dad9f2a764502a80f690a17640e",
            ),
            entrypoint: z.literal("analyzeM9b10bPrimary"),
            populationTokenFactory: z.literal(
              "prepareM9b10cPrimaryPopulationAllocation",
            ),
            measurementSetFactory: z.literal(
              "prepareM9b10cPrimaryMeasurementSet",
            ),
            opaqueCompletePrimaryTokenRequired: z.literal(true),
            futureTokenPresent: z.literal(false),
          })
          .readonly(),
        envelope: z
          .strictObject({
            protocol: z.literal(
              "lachesis-m9b10c-authoritative-moderate-envelope/1",
            ),
            implementationSha256: z.literal(
              "91eebc4578764917c24689a12565385f1cfac5855288bd533874b2ce18eed51a",
            ),
            classes: m9b10AuthoritativeModerateEnvelopeSchema
              .array()
              .length(4)
              .readonly(),
          })
          .readonly(),
        pricing: z
          .strictObject({
            id: z.literal(M9B11_SHADOW_PRICING_PROTOCOL.id),
            version: z.literal(M9B11_SHADOW_PRICING_PROTOCOL.version),
            implementationSha256: z.literal(
              "0640689784afea7a76ee6290972f1d373cfbadd43f3f040ef3740a83a6c6098c",
            ),
            reportDigest: digestSchema,
            campaignIdentityDigest: digestSchema,
            pricingIdentityDigest: digestSchema,
            hardCapPolicyDigest: digestSchema,
          })
          .readonly(),
      })
      .readonly(),
    treatment: z
      .strictObject({
        arm: z.literal("discovered-program"),
        authoring: z.literal("model-authors-closed-retrieval-ast"),
        localExecution: z.literal(
          "evidence-adaptive-bounded-closed-ast-over-frozen-corpus",
        ),
        intermediateAdaptation: z.literal(
          "bounded-values-extracted-from-intermediate-evidence",
        ),
        retrievalProviderCalls: z.literal(0),
        groundedAnswer: z.literal(
          "second-model-call-over-visible-retrieved-evidence",
        ),
        evaluation: z.literal("deterministic-local-arm-blind"),
      })
      .readonly(),
    control: z
      .strictObject({
        arm: z.literal("static-one-shot"),
        authoring: z.literal("model-authors-one-static-query"),
        localExecution: z.literal("one-shot-retrieval-over-same-frozen-corpus"),
        retrievalProviderCalls: z.literal(0),
        groundedAnswer: z.literal(
          "second-model-call-over-visible-retrieved-evidence",
        ),
        evaluation: z.literal("deterministic-local-arm-blind"),
      })
      .readonly(),
    matching: z
      .strictObject({
        inferenceCallsPerArm: z.literal(2),
        inferenceCallsPerPair: z.literal(4),
        countRequestsPerPair: z.literal(4),
        sameModel: z.literal(true),
        sameReasoningEffort: z.literal(true),
        sameRetriever: z.literal(true),
        sameCorpusSnapshot: z.literal(true),
        sameAggregateRetrievalLimits: z.literal(true),
        sameAnswerSchema: z.literal(true),
        sameEvaluator: z.literal(true),
        independentSessions: z.literal(true),
        randomizedArmOrder: z.literal(true),
        retries: z.literal(0),
        maximumConcurrency: z.literal(1),
      })
      .readonly(),
    population: z
      .strictObject({
        families: familySchema.array().length(8).readonly(),
        scales: scaleSchema.array().length(3).readonly(),
        cells: z.literal(24),
        probePairsPerCell: z.literal(1),
        probePairs: z.literal(24),
        primaryPairsPerCell: z.literal(7),
        primaryPairs: z.literal(168),
        totalPairs: z.literal(192),
        countRequests: z.literal(768),
        inferenceCalls: z.literal(768),
        maximumProviderHttpRequests: z.literal(1_536),
        completeInventoryRequired: z.literal(true),
        materialized: z.literal(false),
        probeInventoryIdentity: z.literal("absent-until-post-registration"),
        primaryInventoryIdentity: z.literal("absent-until-post-registration"),
        disjointnessDimensions: disjointnessDimensionSchema
          .array()
          .length(11)
          .readonly(),
      })
      .readonly(),
    corpusConstruction: z
      .strictObject({
        protocol: z.literal(
          "lachesis-m9b12-future-isolated-corpus-construction/1",
        ),
        onlyAfterExternalRegistration: z.literal(true),
        freshExternalData: z.literal(true),
        immutableContentAddressedSnapshots: z.literal(true),
        hiddenGoldAnswersAndSupportingFacts: z.literal(true),
        answerableAndTypedInsufficientEvidence: z.literal(true),
        distributedMultiHopEvidence: z.literal(true),
        intermediateEvidenceAdaptiveCases: z.literal(true),
        staticRetrievalCredible: z.literal(true),
        developmentCloneFormsProhibited: z
          .tuple([
            z.literal("copy"),
            z.literal("translation"),
            z.literal("rename"),
            z.literal("paraphrase"),
            z.literal("structural-clone"),
          ])
          .readonly(),
        independentCountsOnlyFreshnessAudit: z.literal(true),
        independentLeakageAudit: z.literal(true),
        roles: z
          .tuple([
            z.literal("constructor"),
            z.literal("materializer"),
            z.literal("operator"),
            z.literal("evaluator"),
          ])
          .readonly(),
        rolesIsolated: z.literal(true),
        studyAuthorHiddenGoldAccess: z.literal(false),
        controllerHiddenGoldAccess: z.literal(false),
        promptInjectionAndHostileDocumentsRequired: z.literal(true),
        exactSourceAndTemporalProvenance: z.literal(true),
        typeGraphRequired: z.literal(false),
        graphOnlyAdvantageAssumed: z.literal(false),
        disclosureBehavior: z.literal("quarantine-case-and-derived-identities"),
        contaminationBehavior: z.literal(
          "reject-affected-inventory-before-any-provider-effect",
        ),
      })
      .readonly(),
    primaryEndpoint: z
      .strictObject({
        id: z.literal(
          "first-attempt-semantically-supported-end-to-end-success",
        ),
        kind: z.literal("paired-binary"),
        requiredStages: endpointStageSchema.array().length(11).readonly(),
        failuresRetained: z.literal(true),
        abstentionsRetained: z.literal(true),
        truncationsRetained: z.literal(true),
        ambiguousEffectsRetained: z.literal(true),
        haltedPairsRetained: z.literal(true),
        repairReliabilityUsedForSuccess: z.literal(false),
      })
      .readonly(),
    analysis: z
      .strictObject({
        paired: z.literal(true),
        test: z.literal("exact-one-sided-conditional-mcnemar"),
        direction: z.literal("discovered-program-favorable"),
        alphaNumerator: z.literal(1),
        alphaDenominator: z.literal(20),
        exactIntegerRationalDecision: z.literal(true),
        primaryPairsRequired: z.literal(168),
        subsetSelectionPermitted: z.literal(false),
        missingPairDeletionPermitted: z.literal(false),
        populationReplacementPermitted: z.literal(false),
        weighting: z.literal("equal-family-by-scale-24-cells"),
        descriptiveOnlyStrata: z
          .tuple([
            z.literal("family"),
            z.literal("scale"),
            z.literal("provider-usage"),
            z.literal("retrieval"),
            z.literal("latency"),
            z.literal("cost"),
          ])
          .readonly(),
        probeSeparateFromPrimary: z.literal(true),
        primaryInaccessibleBeforeProbePass: z.literal(true),
        executableVectors: z
          .tuple([
            z
              .strictObject({
                discoveredOnly: z.literal(5),
                staticOnly: z.literal(0),
                numerator: z.literal("1"),
                denominator: z.literal("32"),
                significant: z.literal(true),
              })
              .readonly(),
            z
              .strictObject({
                discoveredOnly: z.literal(4),
                staticOnly: z.literal(0),
                numerator: z.literal("1"),
                denominator: z.literal("16"),
                significant: z.literal(false),
              })
              .readonly(),
            z
              .strictObject({
                discoveredOnly: z.literal(0),
                staticOnly: z.literal(5),
                numerator: z.literal("32"),
                denominator: z.literal("32"),
                significant: z.literal(false),
              })
              .readonly(),
          ])
          .readonly(),
      })
      .readonly(),
    probeAdvancement: z
      .strictObject({
        protocol: z.literal("lachesis-m9b3f-probe-advancement-gate/1"),
        requiredPairs: z.literal(24),
        completeCoverageRequired: z.literal(true),
        reliabilityGate: z.literal(true),
        ambiguityGate: z.literal(true),
        confidenceMethod: z.literal(
          "bonferroni-two-one-sided-clopper-pearson-exact-tail-inversion",
        ),
        componentAlphaBasisPoints: z.literal(250),
        projectedPrimaryPairs: z.literal(168),
        primaryAlphaBasisPoints: z.literal(500),
        targetPowerBasisPoints: z.literal(8_000),
        safetyAuthorizationAccountingPricingReplayGates: z.literal(true),
        qualitativeOverridePermitted: z.literal(false),
        relaxedThresholdPermitted: z.literal(false),
        populationEnrichmentPermitted: z.literal(false),
        postProviderChangePermitted: z.literal(false),
        failurePermanentlyPreventsPrimary: z.literal(true),
      })
      .readonly(),
    financial: z
      .strictObject({
        selectedEnvelope: z.literal("moderate"),
        inferenceCeilingUsdMicros: z.literal(342_097_920),
        countShadowContingencyUsdMicros: z.literal(117_964_800),
        operationalCampaignCeilingUsdMicros: z.literal(460_062_720),
        prospectiveProviderHardCapUsdMicros: z.literal(500_000_000),
        headroomUsdMicros: z.literal(39_937_280),
        projectInitialSpendUsdMicros: z.literal(0),
        dedicatedProjectOnly: z.literal(true),
        shadowRateUsdMicrosPerMillionTokens: z.literal(3_125_000),
        countContractuallyFreeClaimed: z.literal(false),
        providerCapMayLag: z.literal(true),
        ambiguityConsumesFullReservation: z.literal(true),
        overageHalts: z.literal(true),
        retryLimit: z.literal(0),
        maximumConcurrency: z.literal(1),
        budgetActivated: z.literal(false),
      })
      .readonly(),
    operationalSequence: sequenceStepSchema.array().length(12).readonly(),
    countPricingKillGates: killGateSchema.array().length(12).readonly(),
    operationalSecurity: z
      .strictObject({
        dedicatedProjectScopedCredential: z.literal(true),
        narrowEndpointPermissionsWhereSupported: z.literal(true),
        credentialInjection: z.literal("anonymous-file-descriptor"),
        forbiddenCredentialLocations: z
          .tuple([
            z.literal("environment-variables"),
            z.literal("argv"),
            z.literal("files"),
            z.literal("logs"),
            z.literal("artifacts"),
            z.literal("role-environments"),
            z.literal("crash-reports"),
          ])
          .readonly(),
        exactPrivatePermissionsRequired: z.literal(true),
        appendOnlyHashChainedAccounting: z.literal(true),
        identityBoundReservationsAndEffects: z.literal(true),
        atomicPersistence: z.literal(true),
        campaignGlobalLock: z.literal(true),
        zeroDispatchTerminalResume: z.literal(true),
        promptAndArtifactRedactionReview: z.literal(true),
        credentialRevocationAndAbsenceVerification: z.literal(true),
        credentialExists: z.literal(false),
        executionNamespaceExists: z.literal(false),
      })
      .readonly(),
    disclosureAndRoles: z
      .strictObject({
        publicPreregistrationMayContain: z
          .tuple([
            z.literal("protocol-identities"),
            z.literal("aggregate-population-counts"),
            z.literal("construction-rules"),
            z.literal("analysis-and-gates"),
            z.literal("financial-and-security-controls"),
          ])
          .readonly(),
        publicPreregistrationMustNotContain: z
          .tuple([
            z.literal("future-case-identities"),
            z.literal("future-document-identities"),
            z.literal("future-construction-seeds"),
            z.literal("hidden-gold"),
            z.literal("expected-citations"),
            z.literal("credentials"),
          ])
          .readonly(),
        constructionAndEvaluationRolesSeparated: z.literal(true),
        operatorCannotAccessGold: z.literal(true),
        controllerCannotAccessGold: z.literal(true),
        authorCannotAccessFutureInventory: z.literal(true),
      })
      .readonly(),
    externalRegistrationFormat: z
      .strictObject({
        protocol: z.literal(
          "lachesis-m9b12-proposed-append-only-external-registration/1",
        ),
        requiredFields: z
          .tuple([
            z.literal("registration-service"),
            z.literal("registration-record-id"),
            z.literal("registered-at"),
            z.literal("preregistration-digest"),
            z.literal("artifact-checksum-manifest-digest"),
            z.literal("registrant-attestation"),
          ])
          .readonly(),
        amendmentRule: z.literal(
          "append-only-new-identity-no-reinterpretation-of-registered-artifacts",
        ),
        recordPresent: z.literal(false),
      })
      .readonly(),
    futureAuthorizations: z
      .strictObject({
        issued: z.literal(false),
        texts: z
          .strictObject({
            kind: authorizationKindSchema,
            text: z.string().min(1).max(1_024),
            prerequisites: z.string().min(1).max(1_024),
            grantsOnly: z.string().min(1).max(1_024),
          })
          .array()
          .length(7)
          .readonly(),
      })
      .readonly(),
    nonclaims: z
      .tuple([
        z.literal("no-count-endpoint-contractual-free-pricing-claim"),
        z.literal("no-model-quality-or-retrieval-superiority-result"),
        z.literal("no-rlm-or-rag-superiority-result"),
        z.literal("no-compositional-generalization-result"),
        z.literal("no-natural-or-held-out-corpus-result"),
        z.literal("no-production-readiness-claim"),
        z.literal("no-professional-security-audit-or-penetration-test-claim"),
        z.literal("no-compliance-claim"),
      ])
      .readonly(),
    audit: z
      .strictObject({
        inheritedIdentitiesReconciled: z.literal(true),
        topologyExact: z.literal(true),
        populationArithmeticExact: z.literal(true),
        probePrimaryDisjointnessRequired: z.literal(true),
        endpointComplete: z.literal(true),
        analyzerMatchesPlan: z.literal(true),
        budgetArithmeticExact: z.literal(true),
        moderateEnvelopeAuthoritative: z.literal(true),
        countShadowAccountingPreserved: z.literal(true),
        allLiveCapabilitiesUnavailable: z.literal(true),
        corpusPresent: z.literal(false),
        hiddenGoldPresent: z.literal(false),
        credentialPresent: z.literal(false),
        executionNamespacePresent: z.literal(false),
        providerRequestPossible: z.literal(false),
        futureFixtureIdentityDisclosed: z.literal(false),
        developmentFixtureAdmissionPermitted: z.literal(false),
        providerEffects: z.literal(0),
        countEffects: z.literal(0),
        inferenceEffects: z.literal(0),
        networkEffects: z.literal(0),
      })
      .readonly(),
    authority: authoritySchema,
    decision: z.literal(
      "preregistration-package-ready-awaiting-external-authorization",
    ),
  })
  .readonly();

export const m9b12PreregistrationSchema = preregistrationBodySchema
  .unwrap()
  .safeExtend({ preregistrationDigest: digestSchema })
  .readonly();
export type M9b12Preregistration = z.infer<typeof m9b12PreregistrationSchema>;

type M9b12Failure = Readonly<{
  kind: "validation" | "integrity" | "capacity";
  message: string;
}>;

function failure(
  kind: M9b12Failure["kind"],
  message: string,
): Result<never, M9b12Failure> {
  return { ok: false, error: { kind, message } };
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalizeJson(left);
  const rightBytes = canonicalizeJson(right);
  return leftBytes.ok && rightBytes.ok && leftBytes.value === rightBytes.value;
}

async function digestBody(
  value: unknown,
): Promise<Result<string, M9b12Failure>> {
  const digest = await digestValue(value);
  return digest.ok
    ? { ok: true, value: digest.value }
    : failure("integrity", "M9b.12 canonical digest failed.");
}

async function deriveEnvelopes(): Promise<
  Result<
    ReadonlyArray<z.infer<typeof m9b10AuthoritativeModerateEnvelopeSchema>>,
    M9b12Failure
  >
> {
  const envelopes: Array<
    z.infer<typeof m9b10AuthoritativeModerateEnvelopeSchema>
  > = [];
  for (const requestClass of requestClassSchema.options) {
    const envelope =
      await deriveM9b10AuthoritativeModerateEnvelope(requestClass);
    if (!envelope.ok) return failure("validation", "Envelope is absent.");
    const verified = await verifyM9b10AuthoritativeModerateEnvelope(
      envelope.value,
    );
    if (!verified.ok)
      return failure("integrity", "Moderate envelope failed verification.");
    envelopes.push(verified.value);
  }
  return { ok: true, value: Object.freeze(envelopes) };
}

function authorizationTexts(): M9b12Preregistration["futureAuthorizations"]["texts"] {
  return Object.freeze([
    {
      kind: "external-preregistration" as const,
      text: "Authorize submission of the exact checksum-bound M9b.12 preregistration package to the named external registry and no other action.",
      prerequisites:
        "Independent review accepts the local package digest and exact artifact checksum manifest.",
      grantsOnly:
        "One append-only external registration submission; no corpus, project, credential, count, inference, or campaign action.",
    },
    {
      kind: "corpus-materialization" as const,
      text: "Authorize isolated construction and materialization under the registered corpus protocol only.",
      prerequisites:
        "External registration is independently verified and role isolation is active.",
      grantsOnly:
        "Fresh corpus, gold, and split-audit production; no provider, credential, count, inference, probe, or primary execution.",
    },
    {
      kind: "provider-cap-and-credential-activation" as const,
      text: "Authorize activation of one fresh zero-spend dedicated project, verified 500 USD cap, and project-scoped credential custody.",
      prerequisites:
        "Corpus, evaluator, schedule, environment, security, and disclosure reviews pass with immutable identities.",
      grantsOnly:
        "Cap and credential activation plus preflight; no count or inference dispatch.",
    },
    {
      kind: "count-only-pricing-probe" as const,
      text: "Authorize the frozen four-request maximum count-only operational pricing probe.",
      prerequisites:
        "Cap, credential, zero-spend, accounting, persistence, and response-shape preflights pass.",
      grantsOnly:
        "At most one count request per frozen class, zero inference, zero retries, concurrency one.",
    },
    {
      kind: "twenty-four-pair-protocol-probe" as const,
      text: "Authorize execution of the exact frozen 24-pair protocol-probe inventory and schedule.",
      prerequisites:
        "Count-only probe and spend reconciliation pass every frozen kill gate and a separate review accepts the bound probe inventory.",
      grantsOnly:
        "The complete 24-pair probe; no primary execution or population change.",
    },
    {
      kind: "conditional-168-pair-primary-execution" as const,
      text: "Authorize the exact frozen 168-pair primary inventory and schedule only if the registered probe gate passed.",
      prerequisites:
        "Verified complete probe measurements produce a frozen pass and all safety, accounting, pricing, replay, authorization, and capacity gates remain satisfied.",
      grantsOnly:
        "The complete immutable 168-pair primary study; no subset, replacement, retry, or protocol amendment.",
    },
    {
      kind: "final-closure-and-credential-revocation" as const,
      text: "Authorize final replay, analysis, accounting and security closure, credential revocation, and independent absence verification.",
      prerequisites:
        "All authorized study effects are terminally accounted and no further provider dispatch is permitted.",
      grantsOnly:
        "Closure and revocation actions; no new count, inference, corpus, analysis-population, or publication authority.",
    },
  ]);
}

function analysisVectors(): M9b12Preregistration["analysis"]["executableVectors"] {
  const significant = m9b10bInternalExactFavorableTail(5, 0);
  const boundaryFail = m9b10bInternalExactFavorableTail(4, 0);
  const wrongDirection = m9b10bInternalExactFavorableTail(0, 5);
  return preregistrationBodySchema
    .unwrap()
    .shape.analysis.unwrap()
    .shape.executableVectors.parse([
      { discoveredOnly: 5, staticOnly: 0, ...significant },
      { discoveredOnly: 4, staticOnly: 0, ...boundaryFail },
      { discoveredOnly: 0, staticOnly: 5, ...wrongDirection },
    ]);
}

async function deriveM9b12Preregistration(): Promise<
  Result<M9b12Preregistration, M9b12Failure>
> {
  const pricing = await prepareM9b11CampaignFreeze();
  const envelopes = await deriveEnvelopes();
  if (!pricing.ok || !envelopes.ok)
    return failure("integrity", "Inherited M9b.11 or envelope binding failed.");
  const verifiedPricing = await verifyM9b11CampaignFreeze(
    pricing.value.token,
    pricing.value.report,
  );
  if (!verifiedPricing.ok)
    return failure("integrity", "M9b.11 campaign freeze did not verify.");
  const price: M9b11CampaignFreeze = verifiedPricing.value;
  if (
    price.reportDigest !==
      "79e03015c7c1f6c4b2296e7b6e8ac5f37556dd90fd2bf96d4460c227dc4ed090" ||
    price.capacity.campaign.pairedCases !== 192 ||
    price.capacity.campaign.countHttpRequests !== 768 ||
    price.capacity.campaign.inferenceCalls !== 768 ||
    price.capacity.campaign.totalProviderHttpRequests !== 1_536
  )
    return failure("capacity", "Inherited M9b.11 capacity changed.");
  const body = preregistrationBodySchema.parse({
    protocol: M9B12_PREREGISTRATION_PROTOCOL.id,
    version: M9B12_PREREGISTRATION_PROTOCOL.version,
    baselineCommit: M9B12_PREREGISTRATION_PROTOCOL.baselineCommit,
    status: "offline-immutable-draft-not-externally-registered",
    inheritedDecisions: [
      "authority-lineage-review-pass-pricing-blocked",
      "shadow-priced-campaign-go-for-offline-preregistration-preparation",
    ],
    researchQuestion:
      "Does a TypeScript/JavaScript CodeMode harness that lets the model author and locally execute an evidence-adaptive retrieval program improve first-attempt grounded task success over a matched static one-shot retrieval harness operating on the same external corpus snapshot?",
    bindings: {
      preparation: {
        id: M9B3_PREPARATION_PROTOCOL.id,
        version: M9B3_PREPARATION_PROTOCOL.version,
        implementationSha256:
          "0ec98e0dd68bf194a94fcbe971241404b6202f44c29fdd319fad3d953a82e585",
        probeGate: "lachesis-m9b3f-probe-advancement-gate/1",
        schedule: "lachesis-m9b3f-paired-counterbalance-schedule/1",
        materializedSchedule: "lachesis-m9b3f-materialized-schedule/1",
      },
      topology: {
        id: M9B10B_SELECTED_TOPOLOGY_PROTOCOL.id,
        version: M9B10B_SELECTED_TOPOLOGY_PROTOCOL.version,
        implementationSha256:
          "f21ec84ed1163eb2ae9b78350eaf480704596dad9f2a764502a80f690a17640e",
      },
      measurement: {
        id: M9B10B_SELECTED_MEASUREMENT_PROTOCOL.id,
        version: M9B10B_SELECTED_MEASUREMENT_PROTOCOL.version,
        endpoint: M9B10B_SELECTED_MEASUREMENT_PROTOCOL.primaryEndpoint,
      },
      analyzer: {
        id: M9B10B_PRIMARY_ANALYSIS_PROTOCOL.id,
        version: M9B10B_PRIMARY_ANALYSIS_PROTOCOL.version,
        implementationSha256:
          "f21ec84ed1163eb2ae9b78350eaf480704596dad9f2a764502a80f690a17640e",
        entrypoint: "analyzeM9b10bPrimary",
        populationTokenFactory: "prepareM9b10cPrimaryPopulationAllocation",
        measurementSetFactory: "prepareM9b10cPrimaryMeasurementSet",
        opaqueCompletePrimaryTokenRequired: true,
        futureTokenPresent: false,
      },
      envelope: {
        protocol: "lachesis-m9b10c-authoritative-moderate-envelope/1",
        implementationSha256:
          "91eebc4578764917c24689a12565385f1cfac5855288bd533874b2ce18eed51a",
        classes: envelopes.value,
      },
      pricing: {
        id: M9B11_SHADOW_PRICING_PROTOCOL.id,
        version: M9B11_SHADOW_PRICING_PROTOCOL.version,
        implementationSha256:
          "0640689784afea7a76ee6290972f1d373cfbadd43f3f040ef3740a83a6c6098c",
        reportDigest: price.reportDigest,
        campaignIdentityDigest: price.campaignIdentityDigest,
        pricingIdentityDigest: price.model.pricingIdentityDigest,
        hardCapPolicyDigest: price.budget.hardCapPolicyDigest,
      },
    },
    treatment: {
      arm: "discovered-program",
      authoring: "model-authors-closed-retrieval-ast",
      localExecution: "evidence-adaptive-bounded-closed-ast-over-frozen-corpus",
      intermediateAdaptation:
        "bounded-values-extracted-from-intermediate-evidence",
      retrievalProviderCalls: 0,
      groundedAnswer: "second-model-call-over-visible-retrieved-evidence",
      evaluation: "deterministic-local-arm-blind",
    },
    control: {
      arm: "static-one-shot",
      authoring: "model-authors-one-static-query",
      localExecution: "one-shot-retrieval-over-same-frozen-corpus",
      retrievalProviderCalls: 0,
      groundedAnswer: "second-model-call-over-visible-retrieved-evidence",
      evaluation: "deterministic-local-arm-blind",
    },
    matching: {
      inferenceCallsPerArm: 2,
      inferenceCallsPerPair: 4,
      countRequestsPerPair: 4,
      sameModel: true,
      sameReasoningEffort: true,
      sameRetriever: true,
      sameCorpusSnapshot: true,
      sameAggregateRetrievalLimits: true,
      sameAnswerSchema: true,
      sameEvaluator: true,
      independentSessions: true,
      randomizedArmOrder: true,
      retries: 0,
      maximumConcurrency: 1,
    },
    population: {
      families: familySchema.options,
      scales: scaleSchema.options,
      cells: 24,
      probePairsPerCell: 1,
      probePairs: 24,
      primaryPairsPerCell: 7,
      primaryPairs: 168,
      totalPairs: 192,
      countRequests: 768,
      inferenceCalls: 768,
      maximumProviderHttpRequests: 1_536,
      completeInventoryRequired: true,
      materialized: false,
      probeInventoryIdentity: "absent-until-post-registration",
      primaryInventoryIdentity: "absent-until-post-registration",
      disjointnessDimensions: disjointnessDimensionSchema.options,
    },
    corpusConstruction: {
      protocol: "lachesis-m9b12-future-isolated-corpus-construction/1",
      onlyAfterExternalRegistration: true,
      freshExternalData: true,
      immutableContentAddressedSnapshots: true,
      hiddenGoldAnswersAndSupportingFacts: true,
      answerableAndTypedInsufficientEvidence: true,
      distributedMultiHopEvidence: true,
      intermediateEvidenceAdaptiveCases: true,
      staticRetrievalCredible: true,
      developmentCloneFormsProhibited: [
        "copy",
        "translation",
        "rename",
        "paraphrase",
        "structural-clone",
      ],
      independentCountsOnlyFreshnessAudit: true,
      independentLeakageAudit: true,
      roles: ["constructor", "materializer", "operator", "evaluator"],
      rolesIsolated: true,
      studyAuthorHiddenGoldAccess: false,
      controllerHiddenGoldAccess: false,
      promptInjectionAndHostileDocumentsRequired: true,
      exactSourceAndTemporalProvenance: true,
      typeGraphRequired: false,
      graphOnlyAdvantageAssumed: false,
      disclosureBehavior: "quarantine-case-and-derived-identities",
      contaminationBehavior:
        "reject-affected-inventory-before-any-provider-effect",
    },
    primaryEndpoint: {
      id: "first-attempt-semantically-supported-end-to-end-success",
      kind: "paired-binary",
      requiredStages: endpointStageSchema.options,
      failuresRetained: true,
      abstentionsRetained: true,
      truncationsRetained: true,
      ambiguousEffectsRetained: true,
      haltedPairsRetained: true,
      repairReliabilityUsedForSuccess: false,
    },
    analysis: {
      paired: true,
      test: "exact-one-sided-conditional-mcnemar",
      direction: "discovered-program-favorable",
      alphaNumerator: 1,
      alphaDenominator: 20,
      exactIntegerRationalDecision: true,
      primaryPairsRequired: 168,
      subsetSelectionPermitted: false,
      missingPairDeletionPermitted: false,
      populationReplacementPermitted: false,
      weighting: "equal-family-by-scale-24-cells",
      descriptiveOnlyStrata: [
        "family",
        "scale",
        "provider-usage",
        "retrieval",
        "latency",
        "cost",
      ],
      probeSeparateFromPrimary: true,
      primaryInaccessibleBeforeProbePass: true,
      executableVectors: analysisVectors(),
    },
    probeAdvancement: {
      protocol: "lachesis-m9b3f-probe-advancement-gate/1",
      requiredPairs: 24,
      completeCoverageRequired: true,
      reliabilityGate: true,
      ambiguityGate: true,
      confidenceMethod:
        "bonferroni-two-one-sided-clopper-pearson-exact-tail-inversion",
      componentAlphaBasisPoints: 250,
      projectedPrimaryPairs: 168,
      primaryAlphaBasisPoints: 500,
      targetPowerBasisPoints: 8_000,
      safetyAuthorizationAccountingPricingReplayGates: true,
      qualitativeOverridePermitted: false,
      relaxedThresholdPermitted: false,
      populationEnrichmentPermitted: false,
      postProviderChangePermitted: false,
      failurePermanentlyPreventsPrimary: true,
    },
    financial: {
      selectedEnvelope: price.budget.selectedOutputEnvelope,
      inferenceCeilingUsdMicros: price.budget.moderateInferenceCeilingUsdMicros,
      countShadowContingencyUsdMicros:
        price.budget.countEffectShadowContingencyUsdMicros,
      operationalCampaignCeilingUsdMicros:
        price.budget.completeOperationalCampaignCeilingUsdMicros,
      prospectiveProviderHardCapUsdMicros:
        price.budget.prospectiveProviderHardCapUsdMicros,
      headroomUsdMicros: price.budget.headroomUsdMicros,
      projectInitialSpendUsdMicros: 0,
      dedicatedProjectOnly: true,
      shadowRateUsdMicrosPerMillionTokens:
        price.model.shadowInputRateUsdMicrosPerMillionTokens,
      countContractuallyFreeClaimed: false,
      providerCapMayLag: true,
      ambiguityConsumesFullReservation: true,
      overageHalts: true,
      retryLimit: price.budget.retryLimit,
      maximumConcurrency: price.budget.maximumConcurrency,
      budgetActivated: false,
    },
    operationalSequence: sequenceStepSchema.options,
    countPricingKillGates: killGateSchema.options,
    operationalSecurity: {
      dedicatedProjectScopedCredential: true,
      narrowEndpointPermissionsWhereSupported: true,
      credentialInjection: "anonymous-file-descriptor",
      forbiddenCredentialLocations: [
        "environment-variables",
        "argv",
        "files",
        "logs",
        "artifacts",
        "role-environments",
        "crash-reports",
      ],
      exactPrivatePermissionsRequired: true,
      appendOnlyHashChainedAccounting: true,
      identityBoundReservationsAndEffects: true,
      atomicPersistence: true,
      campaignGlobalLock: true,
      zeroDispatchTerminalResume: true,
      promptAndArtifactRedactionReview: true,
      credentialRevocationAndAbsenceVerification: true,
      credentialExists: false,
      executionNamespaceExists: false,
    },
    disclosureAndRoles: {
      publicPreregistrationMayContain: [
        "protocol-identities",
        "aggregate-population-counts",
        "construction-rules",
        "analysis-and-gates",
        "financial-and-security-controls",
      ],
      publicPreregistrationMustNotContain: [
        "future-case-identities",
        "future-document-identities",
        "future-construction-seeds",
        "hidden-gold",
        "expected-citations",
        "credentials",
      ],
      constructionAndEvaluationRolesSeparated: true,
      operatorCannotAccessGold: true,
      controllerCannotAccessGold: true,
      authorCannotAccessFutureInventory: true,
    },
    externalRegistrationFormat: {
      protocol: "lachesis-m9b12-proposed-append-only-external-registration/1",
      requiredFields: [
        "registration-service",
        "registration-record-id",
        "registered-at",
        "preregistration-digest",
        "artifact-checksum-manifest-digest",
        "registrant-attestation",
      ],
      amendmentRule:
        "append-only-new-identity-no-reinterpretation-of-registered-artifacts",
      recordPresent: false,
    },
    futureAuthorizations: {
      issued: false,
      texts: authorizationTexts(),
    },
    nonclaims: [
      "no-count-endpoint-contractual-free-pricing-claim",
      "no-model-quality-or-retrieval-superiority-result",
      "no-rlm-or-rag-superiority-result",
      "no-compositional-generalization-result",
      "no-natural-or-held-out-corpus-result",
      "no-production-readiness-claim",
      "no-professional-security-audit-or-penetration-test-claim",
      "no-compliance-claim",
    ],
    audit: {
      inheritedIdentitiesReconciled: true,
      topologyExact: true,
      populationArithmeticExact: true,
      probePrimaryDisjointnessRequired: true,
      endpointComplete: true,
      analyzerMatchesPlan: true,
      budgetArithmeticExact: true,
      moderateEnvelopeAuthoritative: true,
      countShadowAccountingPreserved: true,
      allLiveCapabilitiesUnavailable: true,
      corpusPresent: false,
      hiddenGoldPresent: false,
      credentialPresent: false,
      executionNamespacePresent: false,
      providerRequestPossible: false,
      futureFixtureIdentityDisclosed: false,
      developmentFixtureAdmissionPermitted: false,
      providerEffects: 0,
      countEffects: 0,
      inferenceEffects: 0,
      networkEffects: 0,
    },
    authority: {
      packagePreparationComplete: true,
      externalRegistrationAuthorized: false,
      corpusMaterializationAuthorized: false,
      hiddenGoldCreationAuthorized: false,
      projectAccessAuthorized: false,
      credentialAccessAuthorized: false,
      providerAccessAuthorized: false,
      tokenCountAuthorized: false,
      inferenceAuthorized: false,
      probeAuthorized: false,
      primaryAuthorized: false,
      campaignActivationAuthorized: false,
      budgetActivationAuthorized: false,
      publicationAuthorized: false,
      releaseAuthorized: false,
      pushAuthorized: false,
    },
    decision: M9B12_PREREGISTRATION_PROTOCOL.decision,
  });
  const preregistrationDigest = await digestBody(body);
  return preregistrationDigest.ok
    ? {
        ok: true,
        value: m9b12PreregistrationSchema.parse({
          ...body,
          preregistrationDigest: preregistrationDigest.value,
        }),
      }
    : preregistrationDigest;
}

const packageTokenBrand: unique symbol = Symbol("M9b12PreregistrationToken");
export type M9b12PreregistrationToken = Readonly<{
  [packageTokenBrand]: "M9b12PreregistrationToken";
}>;
const trustedPackages = new WeakMap<
  M9b12PreregistrationToken,
  M9b12Preregistration
>();

export async function prepareM9b12Preregistration(): Promise<
  Result<
    Readonly<{
      token: M9b12PreregistrationToken;
      preregistration: M9b12Preregistration;
    }>,
    M9b12Failure
  >
> {
  const preregistration = await deriveM9b12Preregistration();
  if (!preregistration.ok) return preregistration;
  const token: M9b12PreregistrationToken = Object.freeze({
    [packageTokenBrand]: "M9b12PreregistrationToken",
  });
  trustedPackages.set(token, preregistration.value);
  return {
    ok: true,
    value: { token, preregistration: preregistration.value },
  };
}

export async function verifyM9b12Preregistration(
  token: M9b12PreregistrationToken,
  value: unknown,
): Promise<Result<M9b12Preregistration, M9b12Failure>> {
  const trusted = trustedPackages.get(token);
  const parsed = m9b12PreregistrationSchema.safeParse(value);
  const rederived = await deriveM9b12Preregistration();
  if (
    trusted === undefined ||
    !parsed.success ||
    !rederived.ok ||
    !canonicalEqual(trusted, parsed.data) ||
    !canonicalEqual(rederived.value, parsed.data)
  )
    return failure("integrity", "M9b.12 preregistration package changed.");
  return { ok: true, value: parsed.data };
}
