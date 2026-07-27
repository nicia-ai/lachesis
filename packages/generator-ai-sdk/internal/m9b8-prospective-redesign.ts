import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type M9b7CapacityReport,
  type M9b7CapacityToken,
  verifyM9b7CampaignCapacityReview,
} from "./m9b7-campaign-capacity.js";

export const M9B8_PROSPECTIVE_REDESIGN_PROTOCOL = Object.freeze({
  id: "lachesis-m9b8-offline-prospective-accounting-redesign",
  version: "1.0.0",
  visibility: "private-offline-review-only" as const,
  baselineCommit: "f3f23f7141fb3a12c06bda8d44e59d0ea6431664",
  decision:
    "topology-redesign-go-for-offline-preregistration-preparation" as const,
  claimBoundary:
    "offline prospective accounting and study-topology review only; no corpus construction, preregistration, credential, provider access, probe, live execution, or superiority claim",
});

const PROBE_PAIRS = 24;
const PRIMARY_PAIRS = 168;
const CAMPAIGN_PAIRS = PROBE_PAIRS + PRIMARY_PAIRS;
const REQUESTS_PER_ARM = 2;
const REQUESTS_PER_PAIR = REQUESTS_PER_ARM * 2;
const SELECTED_CAMPAIGN_REQUESTS = CAMPAIGN_PAIRS * REQUESTS_PER_PAIR;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const safeCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const armSchema = z.enum(["discovered-program", "static-one-shot"]);
const populationSchema = z.enum(["probe", "primary"]);
const requestClassSchema = z.enum([
  "root-program-authoring",
  "static-one-shot-query-planning",
  "discovered-program-leaf-reasoning",
  "static-answer-generation",
]);

const capacitySliceSchema = z
  .strictObject({
    pairedCases: safeCountSchema,
    requestCount: safeCountSchema,
    maximumInputTokens: safeCountSchema,
    maximumOutputTokens: safeCountSchema,
    maximumReasoningTokens: z.literal(0),
    maximumCostUsdMicros: safeCountSchema,
  })
  .readonly();

const requestProfileSchema = z
  .strictObject({
    role: z.enum([
      "program-authoring",
      "static-query-planning",
      "grounded-answer",
    ]),
    adapterRequestClass: requestClassSchema,
    arm: armSchema,
    phase: z.enum(["authoring", "grounded-answer"]),
    requestsPerPair: z.literal(1),
    maximumInputTokensPerRequest: z.literal(922_000),
    maximumOutputTokensPerRequest: z.union([
      z.literal(65_536),
      z.literal(20_480),
    ]),
    maximumReasoningTokensPerRequest: z.literal(0),
    maximumCostUsdMicrosPerRequest: safeCountSchema,
    responseSchemaDigest: digestSchema,
    retryLimit: z.literal(0),
  })
  .readonly();

const officialTokenCountSchema = z
  .strictObject({
    provider: z.literal("openai"),
    endpoint: z.literal("POST /v1/responses/input_tokens"),
    documentationUrl: z.literal(
      "https://developers.openai.com/api/docs/guides/token-counting",
    ),
    openApiVersion: z.literal("2.3.0"),
    documentedModelExample: z.literal("gpt-5.6"),
    requiredModel: z.literal("gpt-5.6-terra"),
    acceptsResponsesInputShape: z.literal(true),
    includesProviderRequestStructureTokens: z.literal(true),
    returnsExactModelVisibleInputCount: z.literal(true),
    structuredOutputRequestCompatible: z.literal(true),
    installedProviderPackage: z.literal("@ai-sdk/openai@4.0.15"),
    installedPackageExposesCountOperation: z.literal(false),
    decisionRelevantProjectionDigest: digestSchema,
    pinnedSdkSourceAuditDigest: digestSchema,
    countIsProviderEffect: z.literal(true),
    countRequestRetryLimit: z.literal(0),
    status: z.literal(
      "compatible-official-boundary-requires-separate-intercepted-adapter-and-ledger",
    ),
  })
  .readonly();

const reportBodySchema = z
  .strictObject({
    protocol: z.literal(M9B8_PROSPECTIVE_REDESIGN_PROTOCOL.id),
    version: z.literal(M9B8_PROSPECTIVE_REDESIGN_PROTOCOL.version),
    baselineCommit: z.literal(
      M9B8_PROSPECTIVE_REDESIGN_PROTOCOL.baselineCommit,
    ),
    inheritedM9b7: z
      .strictObject({
        reportDigest: digestSchema,
        protocol: z.literal("lachesis-m9b7-offline-campaign-capacity-review"),
        version: z.literal("1.0.0"),
        immutableDecision: z.literal("campaign-capacity-no-go"),
        inactiveCapOnlyAlternativeUsdMicros: z.literal(3_639_570_432),
        preparationDigest: digestSchema,
        adapterIdentityDigest: digestSchema,
        modelLimitsDigest: digestSchema,
        pricingDigest: digestSchema,
        scheduleProtocolDigest: digestSchema,
      })
      .readonly(),
    fullModelReservationAudit: z
      .strictObject({
        contextWindowTokens: z.literal(1_050_000),
        providerMaximumInputTokens: z.literal(922_000),
        providerMaximumOutputTokens: z.literal(128_000),
        exactCanonicalProviderRequestBytes: z.literal(
          "bound-per-request-by-m9b5-but-not-a-token-count",
        ),
        controllerInputTokenLimit: z.literal(
          "full-provider-model-input-maximum",
        ),
        modelVisibleEvidenceLimits: z
          .strictObject({
            maximumSearchCalls: z.literal(4),
            maximumReadCalls: z.literal(4),
            maximumReadBytes: z.literal(4_096),
          })
          .readonly(),
        toolSchemaInstructionBytes: z.literal(
          "included-in-canonical-request-bytes-but-not-locally-exact-tokenized",
        ),
        providerAddedFramingTokens: z.literal(
          "unknown-before-provider-count-or-usage",
        ),
        unobservableInternalProviderTokens: z.literal(
          "not-assumed-input; output-formatting-and-reasoning-remain-inside-max-output-tokens",
        ),
        providerReportedBillableUsage: z.literal(
          "post-dispatch-settlement-only",
        ),
        maximumFinancialExposure: z.literal(
          "full-input-maximum-plus-configured-output-at-highest-applicable-rates",
        ),
        conclusion: z.literal(
          "922000-is-a-safe-fallback-not-the-tightest-request-specific-bound",
        ),
      })
      .readonly(),
    alternatives: z
      .strictObject({
        proportionalByteEnvelope: z
          .strictObject({
            designId: z.literal("proportional-byte-envelope"),
            exactCanonicalUtf8BytesAvailable: z.literal(true),
            authoritativePinnedTokenizerByteBound: z.literal("absent"),
            authoritativeProviderFramingBound: z.literal("absent"),
            status: z.literal("rejected-unproven-token-and-framing-bound"),
            estimatedTokensPresentedAsExact: z.literal(false),
          })
          .readonly(),
        officialTokenCounting: officialTokenCountSchema,
        reducedCallTopology: z
          .strictObject({
            designId: z.literal("matched-two-call-arms-local-retrieval"),
            status: z.literal("selected-prospective-design"),
            discoveredArm: z
              .tuple([
                z.literal("model-authored-retrieval-program"),
                z.literal("deterministic-local-codemode-retrieval"),
                z.literal("model-grounded-answer"),
                z.literal("deterministic-local-evaluation"),
              ])
              .readonly(),
            staticArm: z
              .tuple([
                z.literal("model-authored-single-search-query"),
                z.literal("deterministic-local-one-shot-retrieval"),
                z.literal("model-grounded-answer"),
                z.literal("deterministic-local-evaluation"),
              ])
              .readonly(),
            modelCallsPerArm: z.literal(REQUESTS_PER_ARM),
            modelCallsPerPair: z.literal(REQUESTS_PER_PAIR),
            leafModelCallsDuringLocalRetrieval: z.literal(0),
            localEvaluatorCalls: z.literal(0),
            providerRetries: z.literal(0),
            maximumConcurrency: z.literal(1),
            treatmentAsymmetry: z.literal(
              "program-discovered-retrieval-sequence-versus-model-authored-single-query",
            ),
            prospectiveCodeModeProfile: z.literal(
              "retrieval-only-local-capabilities-no-model-or-provider-dispatch-inside-program",
            ),
            programOutput: z.literal(
              "bounded-evidence-slice-and-retrieval-transcript-for-one-grounded-answer-call",
            ),
          })
          .readonly(),
        capOnlyReference: z
          .strictObject({
            designId: z.literal("m9b7-raise-cap-preserve-eight-call-topology"),
            maximumCostUsdMicros: z.literal(3_639_570_432),
            activated: z.literal(false),
            status: z.literal("inactive-higher-exposure-reference"),
          })
          .readonly(),
      })
      .readonly(),
    selectedDesign: z
      .strictObject({
        designId: z.literal("matched-two-call-arms-local-retrieval"),
        requestProfiles: requestProfileSchema.array().length(4).readonly(),
        totals: z
          .strictObject({
            perPair: capacitySliceSchema,
            perArm: z
              .strictObject({
                discoveredProgram: capacitySliceSchema,
                staticOneShot: capacitySliceSchema,
              })
              .readonly(),
            perPhase: z
              .strictObject({
                authoring: capacitySliceSchema,
                groundedAnswer: capacitySliceSchema,
                localRetrieval: capacitySliceSchema,
                localEvaluation: capacitySliceSchema,
              })
              .readonly(),
            probe: capacitySliceSchema,
            primary: capacitySliceSchema,
            providerModel: capacitySliceSchema,
            campaign: capacitySliceSchema,
          })
          .readonly(),
        prospectiveCampaignCapUsdMicros: z.literal(1_869_330_432),
        offlineCapacityEvidence: z
          .discriminatedUnion("status", [
            z
              .strictObject({
                status: z.literal("absent"),
                receiptDigest: z.null(),
                remainingUsdMicros: z.literal(0),
              })
              .readonly(),
            z
              .strictObject({
                status: z.literal("verified-m9b7-offline-observation"),
                receiptDigest: digestSchema,
                remainingUsdMicros: safeCountSchema,
              })
              .readonly(),
          ])
          .readonly(),
        savingsAgainstM9b7UsdMicros: z.literal(1_770_240_000),
        m9b7ExposureBasisPoints: z.literal(5_137),
        expectedDescriptiveSpend: z.literal(
          "unknown-before-provider-usage-observations",
        ),
        capacityActivation: z
          .tuple([
            z.literal("new-prospective-cap-binding"),
            z.literal("implement-and-review-retrieval-only-codemode-profile"),
            z.literal("fresh-verified-hard-cap-receipt"),
            z.literal("materialized-schedule-and-request-identities"),
            z.literal("separate-offline-preregistration-review"),
          ])
          .readonly(),
      })
      .readonly(),
    scientificProperties: z
      .strictObject({
        estimand: z.literal(
          "paired-first-attempt-semantically-supported-success-difference-discovered-program-minus-static-one-shot",
        ),
        population: z
          .strictObject({
            probePairs: z.literal(24),
            primaryPairs: z.literal(168),
          })
          .readonly(),
        allocation: z.literal("equal-family-by-scale-full-suite-paired"),
        power: z
          .strictObject({
            alphaBasisPoints: z.literal(500),
            targetPowerBasisPoints: z.literal(8_000),
            status: z.literal(
              "unchanged-prospective-target-pending-frozen-probe",
            ),
          })
          .readonly(),
        armEnvelope: z.literal(
          "same-model-authoring-and-grounded-answer-call-count-and-output-ceilings",
        ),
        retrievalBudget: z
          .strictObject({
            maximumSearchCalls: z.literal(4),
            maximumReadCalls: z.literal(4),
            maximumReadBytes: z.literal(4_096),
            retriever: z.literal("same-deterministic-local-retriever"),
          })
          .readonly(),
        evaluator: z.literal("same-local-zero-provider-arm-blind-evaluator"),
        incompletePairsForbidden: z.literal(true),
        postOutcomePopulationOrScheduleChangesForbidden: z.literal(true),
      })
      .readonly(),
    settlement: z
      .strictObject({
        ambiguous: z.literal(
          "charge-full-reservation-halt-unscorable-no-redispatch",
        ),
        overage: z.literal(
          "charge-full-reservation-plus-verified-excess-halt-unscorable-no-redispatch",
        ),
        complete: z.literal(
          "reconcile-complete-provider-usage-against-reservation",
        ),
      })
      .readonly(),
    dominantCostDrivers: z
      .tuple([
        z.literal("full-provider-input-maximum-fallback"),
        z.literal("call-topology"),
        z.literal("cache-write-input-rate"),
        z.literal("long-context-multipliers"),
        z.literal("authoring-output-ceilings"),
      ])
      .readonly(),
    unresolvedProofObligations: z
      .tuple([
        z.literal(
          "intercept-and-bind-official-token-count-request-and-response",
        ),
        z.literal("ledger-token-count-provider-effects-before-any-use"),
        z.literal(
          "bind-future-response-dependent-request-bodies-before-counting",
        ),
        z.literal("obtain-new-cap-and-hard-cap-receipts-for-selected-topology"),
      ])
      .readonly(),
    decision: z.literal(
      "topology-redesign-go-for-offline-preregistration-preparation",
    ),
    authority: z
      .strictObject({
        offlinePreregistrationPackagePreparationAuthorized: z.literal(true),
        corpusConstructionAuthorized: z.literal(false),
        externalRegistrationAuthorized: z.literal(false),
        credentialsAuthorized: z.literal(false),
        providerAccessAuthorized: z.literal(false),
        probeAuthorized: z.literal(false),
        liveExecutionAuthorized: z.literal(false),
      })
      .readonly(),
    nonclaims: z
      .tuple([
        z.literal("no-model-quality-claim"),
        z.literal("no-rlm-or-rag-superiority-claim"),
        z.literal("no-exact-local-tokenizer-claim"),
        z.literal("no-expected-spend-claim"),
        z.literal("no-production-readiness-claim"),
        z.literal("no-professional-security-audit-claim"),
      ])
      .readonly(),
  })
  .readonly();

export const m9b8ProspectiveRedesignReportSchema = reportBodySchema
  .unwrap()
  .safeExtend({ reportDigest: digestSchema })
  .readonly();
export type M9b8ProspectiveRedesignReport = z.infer<
  typeof m9b8ProspectiveRedesignReportSchema
>;

export type M9b8ProspectiveRedesignToken = Readonly<{ capability: object }>;

type TrustedRedesign = Readonly<{
  m9b7Token: M9b7CapacityToken;
  m9b7ReportBytes: string;
}>;

const trustedRedesigns = new WeakMap<object, TrustedRedesign>();

function invalid(message: string): Result<never, Diagnostic> {
  return { ok: false, error: diagnostic("REPLAY_REQUEST_MISMATCH", message) };
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalizeJson(left);
  const rightBytes = canonicalizeJson(right);
  return leftBytes.ok && rightBytes.ok && leftBytes.value === rightBytes.value;
}

function safeAdd(values: ReadonlyArray<number>): number | undefined {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : undefined;
}

function safeMultiply(left: number, right: number): number | undefined {
  const product = BigInt(left) * BigInt(right);
  return product <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(product)
    : undefined;
}

function profile(
  report: M9b7CapacityReport,
  requestClass: z.infer<typeof requestClassSchema>,
): M9b7CapacityReport["totals"]["perRequestClass"][number] | undefined {
  const matches = report.totals.perRequestClass.filter(
    (entry) => entry.requestClass === requestClass,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function capacitySlice(
  profiles: ReadonlyArray<z.infer<typeof requestProfileSchema>>,
  pairedCases: number,
): z.infer<typeof capacitySliceSchema> | undefined {
  const requestCount = safeMultiply(profiles.length, pairedCases);
  const input = safeMultiply(
    profiles.reduce(
      (sum, entry) => sum + entry.maximumInputTokensPerRequest,
      0,
    ),
    pairedCases,
  );
  const output = safeMultiply(
    profiles.reduce(
      (sum, entry) => sum + entry.maximumOutputTokensPerRequest,
      0,
    ),
    pairedCases,
  );
  const cost = safeMultiply(
    profiles.reduce(
      (sum, entry) => sum + entry.maximumCostUsdMicrosPerRequest,
      0,
    ),
    pairedCases,
  );
  return requestCount === undefined ||
    input === undefined ||
    output === undefined ||
    cost === undefined
    ? undefined
    : capacitySliceSchema.parse({
        pairedCases,
        requestCount,
        maximumInputTokens: input,
        maximumOutputTokens: output,
        maximumReasoningTokens: 0,
        maximumCostUsdMicros: cost,
      });
}

function emptySlice(pairedCases: number): z.infer<typeof capacitySliceSchema> {
  return capacitySliceSchema.parse({
    pairedCases,
    requestCount: 0,
    maximumInputTokens: 0,
    maximumOutputTokens: 0,
    maximumReasoningTokens: 0,
    maximumCostUsdMicros: 0,
  });
}

async function deriveReport(
  token: M9b7CapacityToken,
  value: unknown,
): Promise<Result<M9b8ProspectiveRedesignReport, Diagnostic>> {
  const verified = await verifyM9b7CampaignCapacityReview(token, value);
  if (!verified.ok)
    return invalid("M9b.8 requires a fully rederived M9b.7 baseline.");
  const baseline = verified.value;
  const root = profile(baseline, "root-program-authoring");
  const leaf = profile(baseline, "discovered-program-leaf-reasoning");
  const staticPlan = profile(baseline, "static-one-shot-query-planning");
  const staticAnswer = profile(baseline, "static-answer-generation");
  if (
    root === undefined ||
    leaf === undefined ||
    staticPlan === undefined ||
    staticAnswer === undefined ||
    root.maximumInputTokensPerRequest !== 922_000 ||
    staticPlan.maximumInputTokensPerRequest !== 922_000 ||
    staticAnswer.maximumInputTokensPerRequest !== 922_000 ||
    baseline.totals.campaign.maximumCostUsdMicros !== 3_639_570_432
  )
    return invalid(
      "M9b.8 baseline topology or model-limit reservation drifted.",
    );

  const profiles = requestProfileSchema
    .array()
    .length(4)
    .parse([
      {
        role: "program-authoring",
        adapterRequestClass: root.requestClass,
        arm: "discovered-program",
        phase: "authoring",
        requestsPerPair: 1,
        maximumInputTokensPerRequest: 922_000,
        maximumOutputTokensPerRequest: 65_536,
        maximumReasoningTokensPerRequest: 0,
        maximumCostUsdMicrosPerRequest: root.maximumCostUsdMicrosPerRequest,
        responseSchemaDigest: root.responseSchemaDigest,
        retryLimit: 0,
      },
      {
        role: "grounded-answer",
        adapterRequestClass: leaf.requestClass,
        arm: "discovered-program",
        phase: "grounded-answer",
        requestsPerPair: 1,
        maximumInputTokensPerRequest: 922_000,
        maximumOutputTokensPerRequest: 20_480,
        maximumReasoningTokensPerRequest: 0,
        maximumCostUsdMicrosPerRequest:
          staticAnswer.maximumCostUsdMicrosPerRequest,
        responseSchemaDigest: leaf.responseSchemaDigest,
        retryLimit: 0,
      },
      {
        role: "static-query-planning",
        adapterRequestClass: staticPlan.requestClass,
        arm: "static-one-shot",
        phase: "authoring",
        requestsPerPair: 1,
        maximumInputTokensPerRequest: 922_000,
        maximumOutputTokensPerRequest: 65_536,
        maximumReasoningTokensPerRequest: 0,
        maximumCostUsdMicrosPerRequest:
          staticPlan.maximumCostUsdMicrosPerRequest,
        responseSchemaDigest: staticPlan.responseSchemaDigest,
        retryLimit: 0,
      },
      {
        role: "grounded-answer",
        adapterRequestClass: staticAnswer.requestClass,
        arm: "static-one-shot",
        phase: "grounded-answer",
        requestsPerPair: 1,
        maximumInputTokensPerRequest: 922_000,
        maximumOutputTokensPerRequest: 20_480,
        maximumReasoningTokensPerRequest: 0,
        maximumCostUsdMicrosPerRequest:
          staticAnswer.maximumCostUsdMicrosPerRequest,
        responseSchemaDigest: staticAnswer.responseSchemaDigest,
        retryLimit: 0,
      },
    ]);
  const discovered = profiles.filter(
    (entry) => entry.arm === "discovered-program",
  );
  const staticProfiles = profiles.filter(
    (entry) => entry.arm === "static-one-shot",
  );
  const authoring = profiles.filter((entry) => entry.phase === "authoring");
  const answering = profiles.filter(
    (entry) => entry.phase === "grounded-answer",
  );
  const perPair = capacitySlice(profiles, 1);
  const discoveredCampaign = capacitySlice(discovered, CAMPAIGN_PAIRS);
  const staticCampaign = capacitySlice(staticProfiles, CAMPAIGN_PAIRS);
  const authoringCampaign = capacitySlice(authoring, CAMPAIGN_PAIRS);
  const answeringCampaign = capacitySlice(answering, CAMPAIGN_PAIRS);
  const probe = capacitySlice(profiles, PROBE_PAIRS);
  const primary = capacitySlice(profiles, PRIMARY_PAIRS);
  const campaign = capacitySlice(profiles, CAMPAIGN_PAIRS);
  if (
    perPair === undefined ||
    discoveredCampaign === undefined ||
    staticCampaign === undefined ||
    authoringCampaign === undefined ||
    answeringCampaign === undefined ||
    probe === undefined ||
    primary === undefined ||
    campaign === undefined
  )
    return invalid("M9b.8 selected-topology capacity failed exact derivation.");
  if (
    campaign.requestCount !== SELECTED_CAMPAIGN_REQUESTS ||
    campaign.maximumCostUsdMicros !== 1_869_330_432
  )
    return invalid("M9b.8 selected-topology totals drifted.");
  const m9b7ExposureBasisPoints = Number(
    (BigInt(campaign.maximumCostUsdMicros) * 10_000n +
      BigInt(baseline.totals.campaign.maximumCostUsdMicros) -
      1n) /
      BigInt(baseline.totals.campaign.maximumCostUsdMicros),
  );
  const tokenCountProjectionDigest = await digestValue({
    endpoint: "POST /v1/responses/input_tokens",
    openApiVersion: "2.3.0",
    acceptsResponsesInputShape: true,
    includesProviderRequestStructureTokens: true,
    returnsExactModelVisibleInputCount: true,
    requiredModel: "gpt-5.6-terra",
  });
  const pinnedSdkSourceAuditDigest = await digestValue({
    package: "@ai-sdk/openai",
    version: "4.0.15",
    searchedSymbols: ["inputTokens", "input_tokens", "responses/input_tokens"],
    exposedOperation: false,
  });
  if (!tokenCountProjectionDigest.ok || !pinnedSdkSourceAuditDigest.ok)
    return invalid("M9b.8 official token-count identity binding failed.");
  const reportBody = reportBodySchema.safeParse({
    protocol: M9B8_PROSPECTIVE_REDESIGN_PROTOCOL.id,
    version: M9B8_PROSPECTIVE_REDESIGN_PROTOCOL.version,
    baselineCommit: M9B8_PROSPECTIVE_REDESIGN_PROTOCOL.baselineCommit,
    inheritedM9b7: {
      reportDigest: baseline.reportDigest,
      protocol: baseline.protocol,
      version: baseline.version,
      immutableDecision: baseline.decision,
      inactiveCapOnlyAlternativeUsdMicros:
        baseline.alternative.requiredCampaignCapUsdMicros,
      preparationDigest: baseline.preparationDigest,
      adapterIdentityDigest: baseline.adapterIdentityDigest,
      modelLimitsDigest: baseline.modelLimitsDigest,
      pricingDigest: baseline.pricingDigest,
      scheduleProtocolDigest: baseline.schedule.scheduleProtocolDigest,
    },
    fullModelReservationAudit: {
      contextWindowTokens: baseline.modelLimits.contextWindowTokens,
      providerMaximumInputTokens: baseline.modelLimits.maximumInputTokens,
      providerMaximumOutputTokens: baseline.modelLimits.maximumOutputTokens,
      exactCanonicalProviderRequestBytes:
        "bound-per-request-by-m9b5-but-not-a-token-count",
      controllerInputTokenLimit: "full-provider-model-input-maximum",
      modelVisibleEvidenceLimits: {
        maximumSearchCalls: 4,
        maximumReadCalls: 4,
        maximumReadBytes: 4_096,
      },
      toolSchemaInstructionBytes:
        "included-in-canonical-request-bytes-but-not-locally-exact-tokenized",
      providerAddedFramingTokens: "unknown-before-provider-count-or-usage",
      unobservableInternalProviderTokens:
        "not-assumed-input; output-formatting-and-reasoning-remain-inside-max-output-tokens",
      providerReportedBillableUsage: "post-dispatch-settlement-only",
      maximumFinancialExposure:
        "full-input-maximum-plus-configured-output-at-highest-applicable-rates",
      conclusion:
        "922000-is-a-safe-fallback-not-the-tightest-request-specific-bound",
    },
    alternatives: {
      proportionalByteEnvelope: {
        designId: "proportional-byte-envelope",
        exactCanonicalUtf8BytesAvailable: true,
        authoritativePinnedTokenizerByteBound: "absent",
        authoritativeProviderFramingBound: "absent",
        status: "rejected-unproven-token-and-framing-bound",
        estimatedTokensPresentedAsExact: false,
      },
      officialTokenCounting: {
        provider: "openai",
        endpoint: "POST /v1/responses/input_tokens",
        documentationUrl:
          "https://developers.openai.com/api/docs/guides/token-counting",
        openApiVersion: "2.3.0",
        documentedModelExample: "gpt-5.6",
        requiredModel: "gpt-5.6-terra",
        acceptsResponsesInputShape: true,
        includesProviderRequestStructureTokens: true,
        returnsExactModelVisibleInputCount: true,
        structuredOutputRequestCompatible: true,
        installedProviderPackage: "@ai-sdk/openai@4.0.15",
        installedPackageExposesCountOperation: false,
        decisionRelevantProjectionDigest: tokenCountProjectionDigest.value,
        pinnedSdkSourceAuditDigest: pinnedSdkSourceAuditDigest.value,
        countIsProviderEffect: true,
        countRequestRetryLimit: 0,
        status:
          "compatible-official-boundary-requires-separate-intercepted-adapter-and-ledger",
      },
      reducedCallTopology: {
        designId: "matched-two-call-arms-local-retrieval",
        status: "selected-prospective-design",
        discoveredArm: [
          "model-authored-retrieval-program",
          "deterministic-local-codemode-retrieval",
          "model-grounded-answer",
          "deterministic-local-evaluation",
        ],
        staticArm: [
          "model-authored-single-search-query",
          "deterministic-local-one-shot-retrieval",
          "model-grounded-answer",
          "deterministic-local-evaluation",
        ],
        modelCallsPerArm: REQUESTS_PER_ARM,
        modelCallsPerPair: REQUESTS_PER_PAIR,
        leafModelCallsDuringLocalRetrieval: 0,
        localEvaluatorCalls: 0,
        providerRetries: 0,
        maximumConcurrency: 1,
        treatmentAsymmetry:
          "program-discovered-retrieval-sequence-versus-model-authored-single-query",
        prospectiveCodeModeProfile:
          "retrieval-only-local-capabilities-no-model-or-provider-dispatch-inside-program",
        programOutput:
          "bounded-evidence-slice-and-retrieval-transcript-for-one-grounded-answer-call",
      },
      capOnlyReference: {
        designId: "m9b7-raise-cap-preserve-eight-call-topology",
        maximumCostUsdMicros: baseline.alternative.requiredCampaignCapUsdMicros,
        activated: false,
        status: "inactive-higher-exposure-reference",
      },
    },
    selectedDesign: {
      designId: "matched-two-call-arms-local-retrieval",
      requestProfiles: profiles,
      totals: {
        perPair,
        perArm: {
          discoveredProgram: discoveredCampaign,
          staticOneShot: staticCampaign,
        },
        perPhase: {
          authoring: authoringCampaign,
          groundedAnswer: answeringCampaign,
          localRetrieval: emptySlice(CAMPAIGN_PAIRS),
          localEvaluation: emptySlice(CAMPAIGN_PAIRS),
        },
        probe,
        primary,
        providerModel: campaign,
        campaign,
      },
      prospectiveCampaignCapUsdMicros: campaign.maximumCostUsdMicros,
      offlineCapacityEvidence:
        baseline.hardCap.status === "verified-offline-capability"
          ? {
              status: "verified-m9b7-offline-observation",
              receiptDigest: baseline.hardCap.receiptDigest,
              remainingUsdMicros: baseline.hardCap.remainingUsdMicros,
            }
          : {
              status: "absent",
              receiptDigest: null,
              remainingUsdMicros: 0,
            },
      savingsAgainstM9b7UsdMicros:
        baseline.totals.campaign.maximumCostUsdMicros -
        campaign.maximumCostUsdMicros,
      m9b7ExposureBasisPoints,
      expectedDescriptiveSpend: "unknown-before-provider-usage-observations",
      capacityActivation: [
        "new-prospective-cap-binding",
        "implement-and-review-retrieval-only-codemode-profile",
        "fresh-verified-hard-cap-receipt",
        "materialized-schedule-and-request-identities",
        "separate-offline-preregistration-review",
      ],
    },
    scientificProperties: {
      estimand:
        "paired-first-attempt-semantically-supported-success-difference-discovered-program-minus-static-one-shot",
      population: { probePairs: PROBE_PAIRS, primaryPairs: PRIMARY_PAIRS },
      allocation: "equal-family-by-scale-full-suite-paired",
      power: {
        alphaBasisPoints: 500,
        targetPowerBasisPoints: 8_000,
        status: "unchanged-prospective-target-pending-frozen-probe",
      },
      armEnvelope:
        "same-model-authoring-and-grounded-answer-call-count-and-output-ceilings",
      retrievalBudget: {
        maximumSearchCalls: 4,
        maximumReadCalls: 4,
        maximumReadBytes: 4_096,
        retriever: "same-deterministic-local-retriever",
      },
      evaluator: "same-local-zero-provider-arm-blind-evaluator",
      incompletePairsForbidden: true,
      postOutcomePopulationOrScheduleChangesForbidden: true,
    },
    settlement: {
      ambiguous: "charge-full-reservation-halt-unscorable-no-redispatch",
      overage:
        "charge-full-reservation-plus-verified-excess-halt-unscorable-no-redispatch",
      complete: "reconcile-complete-provider-usage-against-reservation",
    },
    dominantCostDrivers: [
      "full-provider-input-maximum-fallback",
      "call-topology",
      "cache-write-input-rate",
      "long-context-multipliers",
      "authoring-output-ceilings",
    ],
    unresolvedProofObligations: [
      "intercept-and-bind-official-token-count-request-and-response",
      "ledger-token-count-provider-effects-before-any-use",
      "bind-future-response-dependent-request-bodies-before-counting",
      "obtain-new-cap-and-hard-cap-receipts-for-selected-topology",
    ],
    decision: "topology-redesign-go-for-offline-preregistration-preparation",
    authority: {
      offlinePreregistrationPackagePreparationAuthorized: true,
      corpusConstructionAuthorized: false,
      externalRegistrationAuthorized: false,
      credentialsAuthorized: false,
      providerAccessAuthorized: false,
      probeAuthorized: false,
      liveExecutionAuthorized: false,
    },
    nonclaims: [
      "no-model-quality-claim",
      "no-rlm-or-rag-superiority-claim",
      "no-exact-local-tokenizer-claim",
      "no-expected-spend-claim",
      "no-production-readiness-claim",
      "no-professional-security-audit-claim",
    ],
  });
  if (!reportBody.success)
    return invalid(
      `M9b.8 report body is invalid: ${reportBody.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  const reportDigest = await digestValue(reportBody.data);
  return reportDigest.ok
    ? {
        ok: true,
        value: m9b8ProspectiveRedesignReportSchema.parse({
          ...reportBody.data,
          reportDigest: reportDigest.value,
        }),
      }
    : reportDigest;
}

export async function prepareM9b8ProspectiveRedesign(
  input: Readonly<{
    m9b7Token: M9b7CapacityToken;
    m9b7Report: M9b7CapacityReport;
  }>,
): Promise<
  Result<
    Readonly<{
      report: M9b8ProspectiveRedesignReport;
      token: M9b8ProspectiveRedesignToken;
    }>,
    Diagnostic
  >
> {
  const report = await deriveReport(input.m9b7Token, input.m9b7Report);
  const bytes = canonicalizeJson(input.m9b7Report);
  if (!report.ok || !bytes.ok)
    return report.ok ? invalid("M9b.8 baseline is noncanonical.") : report;
  const capability = Object.freeze({});
  trustedRedesigns.set(capability, {
    m9b7Token: input.m9b7Token,
    m9b7ReportBytes: bytes.value,
  });
  return { ok: true, value: { report: report.value, token: { capability } } };
}

async function trustedReport(
  token: M9b8ProspectiveRedesignToken,
): Promise<Result<M9b8ProspectiveRedesignReport, Diagnostic>> {
  const trusted = trustedRedesigns.get(token.capability);
  if (trusted === undefined) return invalid("Unknown M9b.8 redesign token.");
  const baseline = parseJson(trusted.m9b7ReportBytes);
  return baseline.ok
    ? deriveReport(trusted.m9b7Token, baseline.value)
    : invalid("M9b.8 trusted baseline bytes cannot be decoded.");
}

export async function verifyM9b8ProspectiveRedesign(
  token: M9b8ProspectiveRedesignToken,
  value: unknown,
): Promise<Result<M9b8ProspectiveRedesignReport, Diagnostic>> {
  const parsed = m9b8ProspectiveRedesignReportSchema.safeParse(value);
  const rederived = await trustedReport(token);
  return parsed.success &&
    rederived.ok &&
    canonicalEqual(parsed.data, rederived.value)
    ? rederived
    : invalid("M9b.8 report failed complete zero-effect rederivation.");
}

function hasUnpairedSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

function containsUnpairedSurrogate(
  value: unknown,
  ancestors: ReadonlySet<object> = new Set(),
): boolean {
  if (typeof value === "string") return hasUnpairedSurrogate(value);
  if (value === null || typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  const nextAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value))
    return value.some((entry) =>
      containsUnpairedSurrogate(entry, nextAncestors),
    );
  return Reflect.ownKeys(value).some((key) => {
    if (typeof key !== "string" || hasUnpairedSurrogate(key)) return true;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor === undefined ||
      !("value" in descriptor) ||
      containsUnpairedSurrogate(descriptor.value, nextAncestors)
    );
  });
}

const canonicalRequestInspectionSchema = z
  .strictObject({
    canonicalBytes: z.string().min(1),
    requestDigest: digestSchema,
    utf8ByteLength: z.number().int().positive(),
    status: z.literal("exact-bytes-not-exact-provider-tokens"),
  })
  .readonly();
export type M9b8CanonicalRequestInspection = z.infer<
  typeof canonicalRequestInspectionSchema
>;

export async function inspectM9b8CanonicalRequest(
  value: unknown,
): Promise<Result<M9b8CanonicalRequestInspection, Diagnostic>> {
  try {
    if (containsUnpairedSurrogate(value))
      return invalid(
        "M9b.8 rejects unpaired UTF-16 surrogates before accounting.",
      );
  } catch {
    return invalid("M9b.8 request cannot be safely inspected.");
  }
  const bytes = canonicalizeJson(value);
  const requestDigest = await digestValue(value);
  if (!bytes.ok || !requestDigest.ok)
    return invalid("M9b.8 request is not canonical strict JSON.");
  return {
    ok: true,
    value: canonicalRequestInspectionSchema.parse({
      canonicalBytes: bytes.value,
      requestDigest: requestDigest.value,
      utf8ByteLength: new TextEncoder().encode(bytes.value).byteLength,
      status: "exact-bytes-not-exact-provider-tokens",
    }),
  };
}

const syntheticPricingSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b8-synthetic-proportional-pricing/1"),
    normalInputUsdMicrosPerMillionTokens: safeCountSchema,
    cachedReadUsdMicrosPerMillionTokens: safeCountSchema,
    cacheWriteUsdMicrosPerMillionTokens: safeCountSchema,
    outputUsdMicrosPerMillionTokens: safeCountSchema,
    longContextThresholdTokens: z.number().int().positive(),
    longContextInputMultiplierMicros: z.number().int().min(1_000_000),
    longContextOutputMultiplierMicros: z.number().int().min(1_000_000),
  })
  .readonly();

const syntheticReservationBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b8-synthetic-proportional-reservation/1"),
    scope: z.literal("offline-synthetic-proof-harness-never-openai"),
    request: canonicalRequestInspectionSchema,
    byteTokenInvariant: z.literal(
      "at-most-one-caller-token-per-canonical-utf8-byte",
    ),
    callerControlledInputTokenBound: z.number().int().positive(),
    providerFramingContingencyTokens: z.number().int().nonnegative(),
    maximumInputTokens: z.number().int().positive(),
    maximumOutputTokens: z.number().int().positive(),
    maximumReasoningTokens: z.literal(0),
    highestInputRateClass: z.literal(
      "maximum-of-normal-cached-read-cache-write",
    ),
    longContext: z.boolean(),
    maximumCostUsdMicros: safeCountSchema,
    pricing: syntheticPricingSchema,
  })
  .readonly();
export const m9b8SyntheticReservationSchema = syntheticReservationBodySchema
  .unwrap()
  .safeExtend({ reservationDigest: digestSchema })
  .readonly();
export type M9b8SyntheticReservation = z.infer<
  typeof m9b8SyntheticReservationSchema
>;

function ceilingCost(
  inputTokens: number,
  outputTokens: number,
  pricing: z.infer<typeof syntheticPricingSchema>,
): number | undefined {
  const longContext = inputTokens > pricing.longContextThresholdTokens;
  const inputRate = Math.max(
    pricing.normalInputUsdMicrosPerMillionTokens,
    pricing.cachedReadUsdMicrosPerMillionTokens,
    pricing.cacheWriteUsdMicrosPerMillionTokens,
  );
  const inputMultiplier = longContext
    ? pricing.longContextInputMultiplierMicros
    : 1_000_000;
  const outputMultiplier = longContext
    ? pricing.longContextOutputMultiplierMicros
    : 1_000_000;
  const numerator =
    BigInt(inputTokens) * BigInt(inputRate) * BigInt(inputMultiplier) +
    BigInt(outputTokens) *
      BigInt(pricing.outputUsdMicrosPerMillionTokens) *
      BigInt(outputMultiplier);
  const denominator = 1_000_000_000_000n;
  const rounded = (numerator + denominator - 1n) / denominator;
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(rounded)
    : undefined;
}

export async function prepareM9b8SyntheticProportionalReservation(
  input: Readonly<{
    providerRequest: unknown;
    providerFramingContingencyTokens: number;
    maximumOutputTokens: number;
    pricing: z.input<typeof syntheticPricingSchema>;
  }>,
): Promise<Result<M9b8SyntheticReservation, Diagnostic>> {
  const request = await inspectM9b8CanonicalRequest(input.providerRequest);
  const pricing = syntheticPricingSchema.safeParse(input.pricing);
  const framing = z
    .number()
    .int()
    .nonnegative()
    .safeParse(input.providerFramingContingencyTokens);
  const output = z
    .number()
    .int()
    .positive()
    .safeParse(input.maximumOutputTokens);
  if (!request.ok || !pricing.success || !framing.success || !output.success)
    return invalid("Invalid M9b.8 synthetic proportional reservation input.");
  const maximumInputTokens = safeAdd([
    request.value.utf8ByteLength,
    framing.data,
  ]);
  const cost =
    maximumInputTokens === undefined
      ? undefined
      : ceilingCost(maximumInputTokens, output.data, pricing.data);
  if (maximumInputTokens === undefined || cost === undefined)
    return invalid("M9b.8 synthetic proportional reservation overflows.");
  const body = syntheticReservationBodySchema.parse({
    protocol: "lachesis-m9b8-synthetic-proportional-reservation/1",
    scope: "offline-synthetic-proof-harness-never-openai",
    request: request.value,
    byteTokenInvariant: "at-most-one-caller-token-per-canonical-utf8-byte",
    callerControlledInputTokenBound: request.value.utf8ByteLength,
    providerFramingContingencyTokens: framing.data,
    maximumInputTokens,
    maximumOutputTokens: output.data,
    maximumReasoningTokens: 0,
    highestInputRateClass: "maximum-of-normal-cached-read-cache-write",
    longContext: maximumInputTokens > pricing.data.longContextThresholdTokens,
    maximumCostUsdMicros: cost,
    pricing: pricing.data,
  });
  const reservationDigest = await digestValue(body);
  return reservationDigest.ok
    ? {
        ok: true,
        value: m9b8SyntheticReservationSchema.parse({
          ...body,
          reservationDigest: reservationDigest.value,
        }),
      }
    : reservationDigest;
}

export async function verifyM9b8SyntheticProportionalReservation(
  providerRequest: unknown,
  reservation: unknown,
): Promise<Result<M9b8SyntheticReservation, Diagnostic>> {
  const parsed = m9b8SyntheticReservationSchema.safeParse(reservation);
  if (!parsed.success)
    return invalid("Invalid M9b.8 synthetic proportional reservation.");
  const rebuilt = await prepareM9b8SyntheticProportionalReservation({
    providerRequest,
    providerFramingContingencyTokens:
      parsed.data.providerFramingContingencyTokens,
    maximumOutputTokens: parsed.data.maximumOutputTokens,
    pricing: parsed.data.pricing,
  });
  return rebuilt.ok && canonicalEqual(parsed.data, rebuilt.value)
    ? rebuilt
    : invalid("M9b.8 request or proportional reservation was mutated.");
}

const syntheticUsageSchema = z
  .strictObject({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  })
  .readonly();

const syntheticSettlementSchema = z
  .strictObject({
    kind: z.enum(["completed", "ambiguous", "overage"]),
    chargedUsdMicros: safeCountSchema,
    terminal: z.boolean(),
    scorable: z.boolean(),
    redispatchPermitted: z.literal(false),
  })
  .readonly();
export type M9b8SyntheticSettlement = z.infer<typeof syntheticSettlementSchema>;

export async function settleM9b8SyntheticProportionalReservation(
  reservationInput: unknown,
  usageInput: unknown,
): Promise<Result<M9b8SyntheticSettlement, Diagnostic>> {
  const reservation =
    m9b8SyntheticReservationSchema.safeParse(reservationInput);
  if (!reservation.success)
    return invalid("Invalid M9b.8 synthetic settlement reservation.");
  const reservationBody = Object.fromEntries(
    Object.entries(reservation.data).filter(
      ([key]) => key !== "reservationDigest",
    ),
  );
  const reservationDigest = await digestValue(reservationBody);
  if (
    !reservationDigest.ok ||
    reservationDigest.value !== reservation.data.reservationDigest
  )
    return invalid("M9b.8 synthetic reservation digest is invalid.");
  const usage = syntheticUsageSchema.safeParse(usageInput);
  if (!usage.success)
    return {
      ok: true,
      value: syntheticSettlementSchema.parse({
        kind: "ambiguous",
        chargedUsdMicros: reservation.data.maximumCostUsdMicros,
        terminal: true,
        scorable: false,
        redispatchPermitted: false,
      }),
    };
  const usageCost = ceilingCost(
    usage.data.inputTokens,
    usage.data.outputTokens,
    reservation.data.pricing,
  );
  if (usageCost === undefined)
    return invalid("M9b.8 synthetic settlement cost overflows.");
  if (
    usage.data.inputTokens > reservation.data.maximumInputTokens ||
    usage.data.outputTokens > reservation.data.maximumOutputTokens
  )
    return {
      ok: true,
      value: syntheticSettlementSchema.parse({
        kind: "overage",
        chargedUsdMicros: Math.max(
          reservation.data.maximumCostUsdMicros,
          usageCost,
        ),
        terminal: true,
        scorable: false,
        redispatchPermitted: false,
      }),
    };
  return {
    ok: true,
    value: syntheticSettlementSchema.parse({
      kind: "completed",
      chargedUsdMicros: usageCost,
      terminal: false,
      scorable: true,
      redispatchPermitted: false,
    }),
  };
}

const activePairSchema = z
  .strictObject({
    population: populationSchema,
    pairOrdinal: z.number().int().nonnegative(),
    firstArm: armSchema,
    completedArms: armSchema.array().max(1).readonly(),
  })
  .readonly();

const progressionSnapshotSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b8-topology-progression-snapshot/1"),
    reportDigest: digestSchema,
    prospectiveDesignDigest: digestSchema,
    scheduleProtocolDigest: digestSchema,
    completedProbePairs: z.number().int().min(0).max(PROBE_PAIRS),
    completedPrimaryPairs: z.number().int().min(0).max(PRIMARY_PAIRS),
    activePair: activePairSchema.nullable(),
    probeDecision: z.enum(["not-evaluated", "pass", "fail"]),
    terminalHalt: z.enum(["ambiguous", "overage"]).nullable(),
    overageExcessChargeUsdMicros: safeCountSchema,
    outstandingReservations: z.number().int().nonnegative(),
    committedCostUsdMicros: safeCountSchema,
  })
  .readonly();
export type M9b8ProgressionSnapshot = z.infer<typeof progressionSnapshotSchema>;

const gateBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b8-topology-completion-gate/1"),
    reportDigest: digestSchema,
    snapshot: progressionSnapshotSchema,
    authorized: z.boolean(),
    action: z.enum([
      "start-probe-pair",
      "resume-probe-pair",
      "await-probe-decision",
      "start-primary-pair",
      "resume-primary-pair",
      "campaign-complete",
      "reject-capacity",
      "halt-ambiguous",
      "halt-overage",
      "reject-concurrency",
      "reject-inconsistent-state",
    ]),
    population: populationSchema.nullable(),
    pairOrdinal: z.number().int().nonnegative().nullable(),
    nextArm: armSchema.nullable(),
    remainingPhaseCostUsdMicros: safeCountSchema,
    remainingCampaignCostUsdMicros: safeCountSchema,
    availableCapacityUsdMicros: safeCountSchema,
    providerEffects: z.literal(0),
  })
  .readonly();
export const m9b8CompletionGateSchema = gateBodySchema
  .unwrap()
  .safeExtend({ gateDigest: digestSchema })
  .readonly();
export type M9b8CompletionGate = z.infer<typeof m9b8CompletionGateSchema>;

function nextArm(
  pair: z.infer<typeof activePairSchema>,
): "discovered-program" | "static-one-shot" | undefined {
  if (pair.completedArms.length === 0) return pair.firstArm;
  const completed = pair.completedArms[0];
  if (completed !== pair.firstArm) return undefined;
  return completed === "discovered-program"
    ? "static-one-shot"
    : "discovered-program";
}

async function deriveGate(
  report: M9b8ProspectiveRedesignReport,
  snapshotInput: unknown,
): Promise<Result<M9b8CompletionGate, Diagnostic>> {
  const parsed = progressionSnapshotSchema.safeParse(snapshotInput);
  if (!parsed.success) return invalid("Invalid M9b.8 progression snapshot.");
  const snapshot = parsed.data;
  const designDigest = await digestValue(report.selectedDesign);
  if (!designDigest.ok)
    return invalid("M9b.8 selected design cannot be identity-bound.");
  const perPair = report.selectedDesign.totals.perPair.maximumCostUsdMicros;
  const activeCount = snapshot.activePair === null ? 0 : 1;
  const committedPairs =
    snapshot.completedProbePairs + snapshot.completedPrimaryPairs + activeCount;
  const expectedBase = safeMultiply(committedPairs, perPair);
  const expectedCommitted =
    expectedBase === undefined
      ? undefined
      : safeAdd([expectedBase, snapshot.overageExcessChargeUsdMicros]);
  const remainingCampaign = safeMultiply(
    CAMPAIGN_PAIRS - committedPairs,
    perPair,
  );
  const inheritedCap = Math.min(
    report.selectedDesign.prospectiveCampaignCapUsdMicros,
    report.selectedDesign.offlineCapacityEvidence.remainingUsdMicros,
  );
  const available = inheritedCap - snapshot.committedCostUsdMicros;
  let authorized = false;
  let action: z.infer<typeof gateBodySchema>["action"];
  let population: "probe" | "primary" | null = null;
  let pairOrdinal: number | null = null;
  let followingArm: "discovered-program" | "static-one-shot" | null = null;
  let remainingPhase = 0;
  const bindingsAgree =
    snapshot.reportDigest === report.reportDigest &&
    snapshot.prospectiveDesignDigest === designDigest.value &&
    snapshot.scheduleProtocolDigest ===
      report.inheritedM9b7.scheduleProtocolDigest;
  const primaryHasStarted =
    snapshot.completedPrimaryPairs > 0 ||
    snapshot.activePair?.population === "primary";
  const populationOrderAgrees = primaryHasStarted
    ? snapshot.completedProbePairs === PROBE_PAIRS &&
      snapshot.probeDecision === "pass"
    : snapshot.completedPrimaryPairs === 0 &&
      snapshot.completedProbePairs <= PROBE_PAIRS;
  const stateAgrees =
    expectedCommitted !== undefined &&
    expectedCommitted === snapshot.committedCostUsdMicros &&
    remainingCampaign !== undefined &&
    available >= 0 &&
    populationOrderAgrees;
  if (!bindingsAgree || !stateAgrees) {
    action = "reject-inconsistent-state";
  } else if (snapshot.outstandingReservations > 0) {
    action = "reject-concurrency";
  } else if (snapshot.terminalHalt === "ambiguous") {
    action = "halt-ambiguous";
  } else if (snapshot.terminalHalt === "overage") {
    action = "halt-overage";
  } else if (snapshot.activePair !== null) {
    const pair = snapshot.activePair;
    followingArm = nextArm(pair) ?? null;
    const expectedPopulation =
      snapshot.completedProbePairs < PROBE_PAIRS ? "probe" : "primary";
    const expectedOrdinal =
      expectedPopulation === "probe"
        ? snapshot.completedProbePairs
        : snapshot.completedPrimaryPairs;
    if (
      followingArm === null ||
      pair.population !== expectedPopulation ||
      pair.pairOrdinal !== expectedOrdinal
    ) {
      action = "reject-inconsistent-state";
    } else {
      authorized = snapshot.outstandingReservations === 0;
      action =
        pair.population === "probe"
          ? "resume-probe-pair"
          : "resume-primary-pair";
      population = pair.population;
      pairOrdinal = pair.pairOrdinal;
      remainingPhase = perPair;
    }
  } else if (snapshot.completedProbePairs < PROBE_PAIRS) {
    remainingPhase =
      report.selectedDesign.totals.probe.maximumCostUsdMicros -
      snapshot.completedProbePairs * perPair;
    authorized =
      snapshot.outstandingReservations === 0 && available >= remainingPhase;
    action = authorized ? "start-probe-pair" : "reject-capacity";
    population = "probe";
    pairOrdinal = snapshot.completedProbePairs;
  } else if (snapshot.probeDecision === "not-evaluated") {
    action = "await-probe-decision";
  } else if (snapshot.probeDecision === "fail") {
    action = "campaign-complete";
  } else if (snapshot.completedPrimaryPairs < PRIMARY_PAIRS) {
    remainingPhase =
      report.selectedDesign.totals.primary.maximumCostUsdMicros -
      snapshot.completedPrimaryPairs * perPair;
    authorized =
      snapshot.outstandingReservations === 0 && available >= remainingPhase;
    action = authorized ? "start-primary-pair" : "reject-capacity";
    population = "primary";
    pairOrdinal = snapshot.completedPrimaryPairs;
  } else {
    action = "campaign-complete";
  }
  const body = gateBodySchema.parse({
    protocol: "lachesis-m9b8-topology-completion-gate/1",
    reportDigest: report.reportDigest,
    snapshot,
    authorized,
    action,
    population,
    pairOrdinal,
    nextArm: followingArm,
    remainingPhaseCostUsdMicros: remainingPhase,
    remainingCampaignCostUsdMicros: remainingCampaign ?? 0,
    availableCapacityUsdMicros: Math.max(0, available),
    providerEffects: 0,
  });
  const gateDigest = await digestValue(body);
  return gateDigest.ok
    ? {
        ok: true,
        value: m9b8CompletionGateSchema.parse({
          ...body,
          gateDigest: gateDigest.value,
        }),
      }
    : gateDigest;
}

export async function reviewM9b8CompletionSafety(
  input: Readonly<{
    token: M9b8ProspectiveRedesignToken;
    snapshot: M9b8ProgressionSnapshot;
  }>,
): Promise<Result<M9b8CompletionGate, Diagnostic>> {
  const report = await trustedReport(input.token);
  return report.ok ? deriveGate(report.value, input.snapshot) : report;
}

export async function verifyM9b8CompletionSafety(
  token: M9b8ProspectiveRedesignToken,
  value: unknown,
): Promise<Result<M9b8CompletionGate, Diagnostic>> {
  const parsed = m9b8CompletionGateSchema.safeParse(value);
  const rederived = parsed.success
    ? await reviewM9b8CompletionSafety({
        token,
        snapshot: parsed.data.snapshot,
      })
    : invalid("Invalid M9b.8 completion gate.");
  return parsed.success &&
    rederived.ok &&
    canonicalEqual(parsed.data, rederived.value)
    ? rederived
    : invalid("M9b.8 completion gate failed zero-effect rederivation.");
}
