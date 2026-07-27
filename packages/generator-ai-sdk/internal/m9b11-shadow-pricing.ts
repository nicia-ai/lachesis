import { canonicalizeJson, digestValue, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  deriveM9b10AuthoritativeModerateEnvelope,
  type M9b10AuthoritativeModerateEnvelope,
  verifyM9b10AuthoritativeModerateEnvelope,
} from "./m9b10-output-envelope.js";

export const M9B11_SHADOW_PRICING_PROTOCOL = Object.freeze({
  id: "lachesis-m9b11-offline-shadow-priced-campaign-freeze",
  version: "1.0.0",
  baselineCommit: "ff039c63207a91fda896ef99fd88144c51269e4a",
  visibility: "private-offline-prospective-only" as const,
  decision:
    "shadow-priced-campaign-go-for-offline-preregistration-preparation" as const,
  countEndpoint: "POST /v1/responses/input_tokens" as const,
  inferenceEndpoint: "POST /v1/responses" as const,
  claimBoundary:
    "offline prospective pricing-risk amendment only; no assertion that counting is free, and no corpus, registration, project, credential, provider, probe, inference, campaign, publication, or live authority",
});

const MODERATE_INFERENCE_USD_MICROS = 342_097_920;
const COUNT_SHADOW_USD_MICROS = 117_964_800;
const OPERATIONAL_CAMPAIGN_USD_MICROS = 460_062_720;
const PROVIDER_HARD_CAP_USD_MICROS = 500_000_000;
const HEADROOM_USD_MICROS = 39_937_280;
const SHADOW_RATE_USD_MICROS_PER_MILLION = 3_125_000;
const PROBE_PAIRS = 24;
const PRIMARY_PAIRS = 168;
const CAMPAIGN_PAIRS = PROBE_PAIRS + PRIMARY_PAIRS;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z.string().min(1).max(200);
const safeCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const requestClassSchema = z.enum([
  "root-program-authoring",
  "static-one-shot-query-planning",
  "discovered-program-leaf-reasoning",
  "static-answer-generation",
]);
export type M9b11RequestClass = z.infer<typeof requestClassSchema>;
const armSchema = z.enum(["discovered-program", "static-one-shot"]);
const phaseSchema = z.enum(["authoring", "grounded-answer"]);

const REQUEST_CLASSES = requestClassSchema.options;
const INFERENCE_USD_MICROS_BY_CLASS = Object.freeze({
  "root-program-authoring": 819_200,
  "static-one-shot-query-planning": 266_240,
  "discovered-program-leaf-reasoning": 348_160,
  "static-answer-generation": 348_160,
});

type M9b11Failure = Readonly<{
  kind: "validation" | "integrity" | "capacity";
  message: string;
}>;

function failure(
  kind: M9b11Failure["kind"],
  message: string,
): Result<never, M9b11Failure> {
  return { ok: false, error: { kind, message } };
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftValue = canonicalizeJson(left);
  const rightValue = canonicalizeJson(right);
  return leftValue.ok && rightValue.ok && leftValue.value === rightValue.value;
}

async function digestBody(
  value: unknown,
): Promise<Result<string, M9b11Failure>> {
  const digest = await digestValue(value);
  return digest.ok
    ? { ok: true, value: digest.value }
    : failure("integrity", "M9b.11 canonical digest failed.");
}

function safeMultiply(left: number, right: number): number | undefined {
  const value = BigInt(left) * BigInt(right);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}

function sum(values: ReadonlyArray<number>): number | undefined {
  const value = values.reduce((total, entry) => total + BigInt(entry), 0n);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}

function shadowCost(tokens: number): number | undefined {
  const product = BigInt(tokens) * BigInt(SHADOW_RATE_USD_MICROS_PER_MILLION);
  const value = (product + 999_999n) / 1_000_000n;
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}

const sourceSchema = z
  .strictObject({
    url: z.url(),
    retrievedAt: z.literal("2026-07-27"),
    scope: z.enum([
      "token-counting-guide",
      "input-token-count-api-reference",
      "responses-api-reference",
    ]),
  })
  .readonly();

const classReservationSchema = z
  .strictObject({
    requestClass: requestClassSchema,
    envelope: z.custom<M9b10AuthoritativeModerateEnvelope>(),
    maximumInputTokens: z.union([z.literal(65_536), z.literal(32_768)]),
    shadowInputRateUsdMicrosPerMillionTokens: z.literal(
      SHADOW_RATE_USD_MICROS_PER_MILLION,
    ),
    maximumCountShadowReservationUsdMicros: z.union([
      z.literal(204_800),
      z.literal(102_400),
    ]),
    maximumInferenceReservationUsdMicros: z.union([
      z.literal(819_200),
      z.literal(266_240),
      z.literal(348_160),
    ]),
    maximumCountHttpRequests: z.literal(1),
    maximumInferenceCalls: z.literal(1),
    countRetries: z.literal(0),
    inferenceRetries: z.literal(0),
  })
  .readonly();

const capacitySchema = z
  .strictObject({
    pairedCases: safeCountSchema,
    countHttpRequests: safeCountSchema,
    inferenceCalls: safeCountSchema,
    modelCalls: safeCountSchema,
    totalProviderHttpRequests: safeCountSchema,
    maximumCountedInputTokens: safeCountSchema,
    inferenceCeilingUsdMicros: safeCountSchema,
    countShadowContingencyUsdMicros: safeCountSchema,
    operationalCeilingUsdMicros: safeCountSchema,
  })
  .readonly();

const killGateSchema = z.enum([
  "count-response-contract-drift",
  "authoritative-count-price-or-structure-change",
  "observed-count-spend-exceeds-shadow",
  "fixed-per-call-charge",
  "multiplier-exceeds-shadow-rule",
  "provider-hard-cap-not-independently-verified",
  "project-spend-nonzero-before-activation",
  "provider-pricing-drift",
  "provider-model-limits-drift",
]);
export type M9b11KillGate = z.infer<typeof killGateSchema>;

const reportBodySchema = z
  .strictObject({
    protocol: z.literal(M9B11_SHADOW_PRICING_PROTOCOL.id),
    version: z.literal(M9B11_SHADOW_PRICING_PROTOCOL.version),
    baselineCommit: z.literal(M9B11_SHADOW_PRICING_PROTOCOL.baselineCommit),
    inheritedDecision: z.literal(
      "authority-lineage-review-pass-pricing-blocked",
    ),
    campaignIdentityDigest: digestSchema,
    sourceArtifact: z
      .strictObject({
        protocol: z.literal("lachesis-m9b11-public-count-evidence/1"),
        sources: sourceSchema.array().length(3).readonly(),
        exactModelVisibleInputCount: z.literal(true),
        includesStructuralFormattingTokens: z.literal(true),
        intendedForContextValidationAndCostEstimation: z.literal(true),
        responseFields: z
          .tuple([z.literal("object"), z.literal("input_tokens")])
          .readonly(),
        explicitEndpointPricePublished: z.literal(false),
        explicitZeroDollarStatementPublished: z.literal(false),
        failureBillingMatrixPublished: z.literal(false),
        cacheClassificationPublished: z.literal(false),
        serviceTierRulePublished: z.literal(false),
        finding: z.literal(
          "public-documentation-suggests-free-operational-behavior-but-does-not-establish-it-contractually",
        ),
        uncertainty: z.literal(
          "count-endpoint-pricing-and-undocumented-fee-behavior-remain-unknown",
        ),
        artifactDigest: digestSchema,
      })
      .readonly(),
    model: z
      .strictObject({
        id: z.literal("gpt-5.6-terra"),
        reasoningEffort: z.literal("frozen-unchanged-from-m9b10c"),
        highestApplicableInputClass: z.literal(
          "cache-write-highest-applicable-class",
        ),
        shadowInputRateUsdMicrosPerMillionTokens: z.literal(
          SHADOW_RATE_USD_MICROS_PER_MILLION,
        ),
        pricingIdentityDigest: digestSchema,
      })
      .readonly(),
    classReservations: classReservationSchema.array().length(4).readonly(),
    capacity: z
      .strictObject({
        perPair: capacitySchema,
        probe: capacitySchema,
        primary: capacitySchema,
        campaign: capacitySchema,
      })
      .readonly(),
    budget: z
      .strictObject({
        selectedOutputEnvelope: z.literal("moderate"),
        moderateInferenceCeilingUsdMicros: z.literal(
          MODERATE_INFERENCE_USD_MICROS,
        ),
        countEffectShadowContingencyUsdMicros: z.literal(
          COUNT_SHADOW_USD_MICROS,
        ),
        completeOperationalCampaignCeilingUsdMicros: z.literal(
          OPERATIONAL_CAMPAIGN_USD_MICROS,
        ),
        prospectiveProviderHardCapUsdMicros: z.literal(
          PROVIDER_HARD_CAP_USD_MICROS,
        ),
        headroomUsdMicros: z.literal(HEADROOM_USD_MICROS),
        supersedesConditionalProviderCapUsdMicros: z.literal(400_000_000),
        hardCapActivated: z.literal(false),
        campaignActivated: z.literal(false),
        maximumConcurrency: z.literal(1),
        retryLimit: z.literal(0),
        hardCapPolicyDigest: digestSchema,
      })
      .readonly(),
    killGates: killGateSchema.array().length(9).readonly(),
    residualRisk: z
      .strictObject({
        providerSpendEnforcementMayLag: z.literal(true),
        arbitraryUndocumentedFeesGuaranteedCovered: z.literal(false),
        practicalExposureControls: z
          .tuple([
            z.literal("concurrency-one"),
            z.literal("zero-retries"),
            z.literal("per-effect-persistence"),
            z.literal("shadow-reservations"),
            z.literal("terminal-kill-gates"),
          ])
          .readonly(),
        liveActivationRequiresExplicitUserRiskAcceptance: z.literal(true),
        projectSpendMustBeginUsdMicros: z.literal(0),
        dedicatedProjectExclusiveToCampaign: z.literal(true),
      })
      .readonly(),
    countOnlyProbe: z
      .strictObject({
        protocol: z.literal("lachesis-m9b11-count-only-probe-design/1"),
        freshDedicatedProject: z.literal(true),
        initialProjectSpendUsdMicros: z.literal(0),
        verifiedHardCapUsdMicros: z.literal(PROVIDER_HARD_CAP_USD_MICROS),
        requestClasses: requestClassSchema.array().length(4).readonly(),
        maximumCountRequests: z.literal(4),
        inferenceCalls: z.literal(0),
        retries: z.literal(0),
        maximumConcurrency: z.literal(1),
        observationIntervalMs: z.literal(86_400_000),
        stopOnChargeOrAmbiguity: z.literal(true),
        establishesContractualGuarantee: z.literal(false),
        executionAuthorized: z.literal(false),
      })
      .readonly(),
    scientificProtocol: z
      .strictObject({
        topology: z.literal("selected-m9b8-m9b10c-four-call-paired"),
        model: z.literal("gpt-5.6-terra"),
        reasoning: z.literal("frozen-unchanged-from-m9b10c"),
        outputEnvelope: z.literal("moderate"),
        probePairs: z.literal(PROBE_PAIRS),
        primaryPairs: z.literal(PRIMARY_PAIRS),
        allocation: z.literal("equal-family-by-scale-24-cells"),
        estimand: z.literal(
          "paired-first-attempt-semantically-supported-end-to-end-success",
        ),
        analysis: z.literal("one-sided-exact-conditional-mcnemar-alpha-0.05"),
        probeAdvancement: z.literal("frozen-m9b3f-rule"),
        retrievalLimits: z.literal("frozen-m9b10c-limits"),
        completePairAndPopulationGating: z.literal(true),
      })
      .readonly(),
    preregistrationLanguage: z
      .tuple([
        z.literal("count-endpoint-pricing-is-not-explicitly-classified"),
        z.literal("no-claim-that-counting-is-contractually-free"),
        z.literal("all-count-effects-receive-conservative-shadow-charges"),
        z.literal("prospective-provider-cap-is-500-usd-not-activated"),
        z.literal("unexpected-count-pricing-is-a-frozen-kill-gate"),
        z.literal("count-only-operational-probe-precedes-inference"),
        z.literal("incomplete-ambiguous-and-halted-records-remain-reportable"),
        z.literal("no-post-hoc-budget-population-envelope-or-retry-change"),
      ])
      .readonly(),
    decision: z.literal(
      "shadow-priced-campaign-go-for-offline-preregistration-preparation",
    ),
    authority: z
      .strictObject({
        offlinePreregistrationPreparationAuthorized: z.literal(true),
        externalRegistrationAuthorized: z.literal(false),
        corpusMaterializationAuthorized: z.literal(false),
        projectAccessAuthorized: z.literal(false),
        credentialAccessAuthorized: z.literal(false),
        providerAccessAuthorized: z.literal(false),
        countProbeExecutionAuthorized: z.literal(false),
        inferenceAuthorized: z.literal(false),
        campaignActivationAuthorized: z.literal(false),
        publicationAuthorized: z.literal(false),
      })
      .readonly(),
  })
  .readonly();

export const m9b11CampaignFreezeSchema = reportBodySchema
  .unwrap()
  .safeExtend({ reportDigest: digestSchema })
  .readonly();
export type M9b11CampaignFreeze = z.infer<typeof m9b11CampaignFreezeSchema>;

const campaignTokenBrand: unique symbol = Symbol("M9b11CampaignToken");
export type M9b11CampaignToken = Readonly<{
  [campaignTokenBrand]: "M9b11CampaignToken";
}>;
const trustedCampaigns = new WeakMap<M9b11CampaignToken, M9b11CampaignFreeze>();

async function deriveSourceArtifact(): Promise<
  Result<M9b11CampaignFreeze["sourceArtifact"], M9b11Failure>
> {
  const body = {
    protocol: "lachesis-m9b11-public-count-evidence/1" as const,
    sources: Object.freeze([
      {
        url: "https://developers.openai.com/api/docs/guides/token-counting",
        retrievedAt: "2026-07-27" as const,
        scope: "token-counting-guide" as const,
      },
      {
        url: "https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count",
        retrievedAt: "2026-07-27" as const,
        scope: "input-token-count-api-reference" as const,
      },
      {
        url: "https://developers.openai.com/api/reference/resources/responses/methods/create",
        retrievedAt: "2026-07-27" as const,
        scope: "responses-api-reference" as const,
      },
    ]),
    exactModelVisibleInputCount: true as const,
    includesStructuralFormattingTokens: true as const,
    intendedForContextValidationAndCostEstimation: true as const,
    responseFields: Object.freeze(["object", "input_tokens"] as const),
    explicitEndpointPricePublished: false as const,
    explicitZeroDollarStatementPublished: false as const,
    failureBillingMatrixPublished: false as const,
    cacheClassificationPublished: false as const,
    serviceTierRulePublished: false as const,
    finding:
      "public-documentation-suggests-free-operational-behavior-but-does-not-establish-it-contractually" as const,
    uncertainty:
      "count-endpoint-pricing-and-undocumented-fee-behavior-remain-unknown" as const,
  };
  const artifactDigest = await digestBody(body);
  return artifactDigest.ok
    ? {
        ok: true,
        value: reportBodySchema.unwrap().shape.sourceArtifact.parse({
          ...body,
          artifactDigest: artifactDigest.value,
        }),
      }
    : artifactDigest;
}

async function derivePricingIdentityDigest(): Promise<
  Result<string, M9b11Failure>
> {
  return digestBody({
    protocol: "lachesis-m9b11-shadow-pricing-identity/1",
    model: "gpt-5.6-terra",
    pricingClass: "cache-write-highest-applicable-class",
    rateUsdMicrosPerMillionTokens: SHADOW_RATE_USD_MICROS_PER_MILLION,
    serviceTier: "frozen-m9b10c-default",
    regionalProcessing: "no-additional-multiplier-frozen",
    longContext: "request-class-maxima-below-frozen-threshold",
  });
}

async function deriveHardCapPolicyDigest(): Promise<
  Result<string, M9b11Failure>
> {
  return digestBody({
    protocol: "lachesis-m9b11-prospective-hard-cap-policy/1",
    operationalCampaignCeilingUsdMicros: OPERATIONAL_CAMPAIGN_USD_MICROS,
    providerHardCapUsdMicros: PROVIDER_HARD_CAP_USD_MICROS,
    headroomUsdMicros: HEADROOM_USD_MICROS,
    providerEnforcementMayLag: true,
    projectInitialSpendUsdMicros: 0,
    projectExclusive: true,
    activation: "not-activated",
  });
}

async function deriveClassReservations(): Promise<
  Result<ReadonlyArray<z.infer<typeof classReservationSchema>>, M9b11Failure>
> {
  const values: Array<z.infer<typeof classReservationSchema>> = [];
  for (const requestClass of REQUEST_CLASSES) {
    const envelope =
      await deriveM9b10AuthoritativeModerateEnvelope(requestClass);
    if (!envelope.ok)
      return failure("validation", "Moderate envelope missing.");
    const verified = await verifyM9b10AuthoritativeModerateEnvelope(
      envelope.value,
    );
    const maximumShadow = shadowCost(envelope.value.maximumInputTokens);
    if (!verified.ok || maximumShadow === undefined)
      return failure("validation", "Moderate envelope verification failed.");
    values.push(
      classReservationSchema.parse({
        requestClass,
        envelope: envelope.value,
        maximumInputTokens: envelope.value.maximumInputTokens,
        shadowInputRateUsdMicrosPerMillionTokens:
          SHADOW_RATE_USD_MICROS_PER_MILLION,
        maximumCountShadowReservationUsdMicros: maximumShadow,
        maximumInferenceReservationUsdMicros:
          INFERENCE_USD_MICROS_BY_CLASS[requestClass],
        maximumCountHttpRequests: 1,
        maximumInferenceCalls: 1,
        countRetries: 0,
        inferenceRetries: 0,
      }),
    );
  }
  return { ok: true, value: Object.freeze(values) };
}

function capacityFor(
  classes: ReadonlyArray<z.infer<typeof classReservationSchema>>,
  pairs: number,
): z.infer<typeof capacitySchema> | undefined {
  const inputPerPair = sum(classes.map((entry) => entry.maximumInputTokens));
  const inferencePerPair = sum(
    classes.map((entry) => entry.maximumInferenceReservationUsdMicros),
  );
  const countPerPair = sum(
    classes.map((entry) => entry.maximumCountShadowReservationUsdMicros),
  );
  const requests = safeMultiply(classes.length, pairs);
  const input =
    inputPerPair === undefined ? undefined : safeMultiply(inputPerPair, pairs);
  const inference =
    inferencePerPair === undefined
      ? undefined
      : safeMultiply(inferencePerPair, pairs);
  const count =
    countPerPair === undefined ? undefined : safeMultiply(countPerPair, pairs);
  const providerRequests =
    requests === undefined ? undefined : safeMultiply(requests, 2);
  const operational =
    inference === undefined || count === undefined
      ? undefined
      : sum([inference, count]);
  if (
    requests === undefined ||
    input === undefined ||
    inference === undefined ||
    count === undefined ||
    providerRequests === undefined ||
    operational === undefined
  )
    return undefined;
  return capacitySchema.parse({
    pairedCases: pairs,
    countHttpRequests: requests,
    inferenceCalls: requests,
    modelCalls: requests,
    totalProviderHttpRequests: providerRequests,
    maximumCountedInputTokens: input,
    inferenceCeilingUsdMicros: inference,
    countShadowContingencyUsdMicros: count,
    operationalCeilingUsdMicros: operational,
  });
}

async function deriveCampaignFreeze(): Promise<
  Result<M9b11CampaignFreeze, M9b11Failure>
> {
  const sourceArtifact = await deriveSourceArtifact();
  const pricingIdentityDigest = await derivePricingIdentityDigest();
  const hardCapPolicyDigest = await deriveHardCapPolicyDigest();
  const campaignIdentityDigest = await digestBody({
    protocol: "lachesis-m9b11-prospective-campaign-identity/1",
    inheritedTopology: "selected-m9b8-m9b10c-four-call-paired",
    selectedEnvelope: "moderate",
    probePairs: PROBE_PAIRS,
    primaryPairs: PRIMARY_PAIRS,
    operationalCampaignCeilingUsdMicros: OPERATIONAL_CAMPAIGN_USD_MICROS,
    providerHardCapUsdMicros: PROVIDER_HARD_CAP_USD_MICROS,
  });
  const classes = await deriveClassReservations();
  if (
    !sourceArtifact.ok ||
    !pricingIdentityDigest.ok ||
    !hardCapPolicyDigest.ok ||
    !campaignIdentityDigest.ok ||
    !classes.ok
  )
    return failure("validation", "M9b.11 frozen inputs could not be derived.");
  const perPair = capacityFor(classes.value, 1);
  const probe = capacityFor(classes.value, PROBE_PAIRS);
  const primary = capacityFor(classes.value, PRIMARY_PAIRS);
  const campaign = capacityFor(classes.value, CAMPAIGN_PAIRS);
  if (
    perPair === undefined ||
    probe === undefined ||
    primary === undefined ||
    campaign === undefined
  )
    return failure("capacity", "M9b.11 frozen budget arithmetic drifted.");
  if (
    campaign.inferenceCeilingUsdMicros !== MODERATE_INFERENCE_USD_MICROS ||
    campaign.countShadowContingencyUsdMicros !== COUNT_SHADOW_USD_MICROS ||
    campaign.operationalCeilingUsdMicros !== OPERATIONAL_CAMPAIGN_USD_MICROS ||
    PROVIDER_HARD_CAP_USD_MICROS - campaign.operationalCeilingUsdMicros !==
      HEADROOM_USD_MICROS
  )
    return failure("capacity", "M9b.11 frozen budget arithmetic drifted.");
  const body = reportBodySchema.parse({
    protocol: M9B11_SHADOW_PRICING_PROTOCOL.id,
    version: M9B11_SHADOW_PRICING_PROTOCOL.version,
    baselineCommit: M9B11_SHADOW_PRICING_PROTOCOL.baselineCommit,
    inheritedDecision: "authority-lineage-review-pass-pricing-blocked",
    campaignIdentityDigest: campaignIdentityDigest.value,
    sourceArtifact: sourceArtifact.value,
    model: {
      id: "gpt-5.6-terra",
      reasoningEffort: "frozen-unchanged-from-m9b10c",
      highestApplicableInputClass: "cache-write-highest-applicable-class",
      shadowInputRateUsdMicrosPerMillionTokens:
        SHADOW_RATE_USD_MICROS_PER_MILLION,
      pricingIdentityDigest: pricingIdentityDigest.value,
    },
    classReservations: classes.value,
    capacity: { perPair, probe, primary, campaign },
    budget: {
      selectedOutputEnvelope: "moderate",
      moderateInferenceCeilingUsdMicros: MODERATE_INFERENCE_USD_MICROS,
      countEffectShadowContingencyUsdMicros: COUNT_SHADOW_USD_MICROS,
      completeOperationalCampaignCeilingUsdMicros:
        OPERATIONAL_CAMPAIGN_USD_MICROS,
      prospectiveProviderHardCapUsdMicros: PROVIDER_HARD_CAP_USD_MICROS,
      headroomUsdMicros: HEADROOM_USD_MICROS,
      supersedesConditionalProviderCapUsdMicros: 400_000_000,
      hardCapActivated: false,
      campaignActivated: false,
      maximumConcurrency: 1,
      retryLimit: 0,
      hardCapPolicyDigest: hardCapPolicyDigest.value,
    },
    killGates: killGateSchema.options,
    residualRisk: {
      providerSpendEnforcementMayLag: true,
      arbitraryUndocumentedFeesGuaranteedCovered: false,
      practicalExposureControls: [
        "concurrency-one",
        "zero-retries",
        "per-effect-persistence",
        "shadow-reservations",
        "terminal-kill-gates",
      ],
      liveActivationRequiresExplicitUserRiskAcceptance: true,
      projectSpendMustBeginUsdMicros: 0,
      dedicatedProjectExclusiveToCampaign: true,
    },
    countOnlyProbe: {
      protocol: "lachesis-m9b11-count-only-probe-design/1",
      freshDedicatedProject: true,
      initialProjectSpendUsdMicros: 0,
      verifiedHardCapUsdMicros: PROVIDER_HARD_CAP_USD_MICROS,
      requestClasses: REQUEST_CLASSES,
      maximumCountRequests: 4,
      inferenceCalls: 0,
      retries: 0,
      maximumConcurrency: 1,
      observationIntervalMs: 86_400_000,
      stopOnChargeOrAmbiguity: true,
      establishesContractualGuarantee: false,
      executionAuthorized: false,
    },
    scientificProtocol: {
      topology: "selected-m9b8-m9b10c-four-call-paired",
      model: "gpt-5.6-terra",
      reasoning: "frozen-unchanged-from-m9b10c",
      outputEnvelope: "moderate",
      probePairs: PROBE_PAIRS,
      primaryPairs: PRIMARY_PAIRS,
      allocation: "equal-family-by-scale-24-cells",
      estimand:
        "paired-first-attempt-semantically-supported-end-to-end-success",
      analysis: "one-sided-exact-conditional-mcnemar-alpha-0.05",
      probeAdvancement: "frozen-m9b3f-rule",
      retrievalLimits: "frozen-m9b10c-limits",
      completePairAndPopulationGating: true,
    },
    preregistrationLanguage: [
      "count-endpoint-pricing-is-not-explicitly-classified",
      "no-claim-that-counting-is-contractually-free",
      "all-count-effects-receive-conservative-shadow-charges",
      "prospective-provider-cap-is-500-usd-not-activated",
      "unexpected-count-pricing-is-a-frozen-kill-gate",
      "count-only-operational-probe-precedes-inference",
      "incomplete-ambiguous-and-halted-records-remain-reportable",
      "no-post-hoc-budget-population-envelope-or-retry-change",
    ],
    decision: M9B11_SHADOW_PRICING_PROTOCOL.decision,
    authority: {
      offlinePreregistrationPreparationAuthorized: true,
      externalRegistrationAuthorized: false,
      corpusMaterializationAuthorized: false,
      projectAccessAuthorized: false,
      credentialAccessAuthorized: false,
      providerAccessAuthorized: false,
      countProbeExecutionAuthorized: false,
      inferenceAuthorized: false,
      campaignActivationAuthorized: false,
      publicationAuthorized: false,
    },
  });
  const reportDigest = await digestBody(body);
  return reportDigest.ok
    ? {
        ok: true,
        value: m9b11CampaignFreezeSchema.parse({
          ...body,
          reportDigest: reportDigest.value,
        }),
      }
    : reportDigest;
}

export async function prepareM9b11CampaignFreeze(): Promise<
  Result<
    Readonly<{
      token: M9b11CampaignToken;
      report: M9b11CampaignFreeze;
    }>,
    M9b11Failure
  >
> {
  const report = await deriveCampaignFreeze();
  if (!report.ok) return report;
  const token: M9b11CampaignToken = Object.freeze({
    [campaignTokenBrand]: "M9b11CampaignToken",
  });
  trustedCampaigns.set(token, report.value);
  return { ok: true, value: { token, report: report.value } };
}

export async function verifyM9b11CampaignFreeze(
  token: M9b11CampaignToken,
  value: unknown,
): Promise<Result<M9b11CampaignFreeze, M9b11Failure>> {
  const trusted = trustedCampaigns.get(token);
  const parsed = m9b11CampaignFreezeSchema.safeParse(value);
  const rederived = await deriveCampaignFreeze();
  if (
    trusted === undefined ||
    !parsed.success ||
    !rederived.ok ||
    !canonicalEqual(trusted, parsed.data) ||
    !canonicalEqual(rederived.value, parsed.data)
  )
    return failure("integrity", "M9b.11 campaign freeze changed.");
  return { ok: true, value: parsed.data };
}

const attemptInputSchema = z
  .strictObject({
    campaignDigest: digestSchema,
    pairId: identifierSchema,
    arm: armSchema,
    phase: phaseSchema,
    callIndex: z.union([z.literal(1), z.literal(2)]),
    requestClass: requestClassSchema,
    exactRequestDigest: digestSchema,
  })
  .readonly();
export type M9b11CountAttemptInput = z.infer<typeof attemptInputSchema>;

function requestClassMatches(input: M9b11CountAttemptInput): boolean {
  switch (input.requestClass) {
    case "root-program-authoring":
      return (
        input.arm === "discovered-program" &&
        input.phase === "authoring" &&
        input.callIndex === 1
      );
    case "static-one-shot-query-planning":
      return (
        input.arm === "static-one-shot" &&
        input.phase === "authoring" &&
        input.callIndex === 1
      );
    case "discovered-program-leaf-reasoning":
      return (
        input.arm === "discovered-program" &&
        input.phase === "grounded-answer" &&
        input.callIndex === 2
      );
    case "static-answer-generation":
      return (
        input.arm === "static-one-shot" &&
        input.phase === "grounded-answer" &&
        input.callIndex === 2
      );
  }
}

const reservationBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b11-count-shadow-reservation/1"),
    campaignReportDigest: digestSchema,
    campaignDigest: digestSchema,
    pairId: identifierSchema,
    arm: armSchema,
    phase: phaseSchema,
    callIndex: z.union([z.literal(1), z.literal(2)]),
    requestClass: requestClassSchema,
    exactRequestDigest: digestSchema,
    envelopeDigest: digestSchema,
    pricingIdentityDigest: digestSchema,
    hardCapPolicyDigest: digestSchema,
    maximumInputTokens: z.union([z.literal(65_536), z.literal(32_768)]),
    shadowInputRateUsdMicrosPerMillionTokens: z.literal(
      SHADOW_RATE_USD_MICROS_PER_MILLION,
    ),
    maximumShadowReservationUsdMicros: z.union([
      z.literal(204_800),
      z.literal(102_400),
    ]),
    operationalCampaignCapacityUsdMicros: z.literal(
      OPERATIONAL_CAMPAIGN_USD_MICROS,
    ),
    providerHardCapCapacityUsdMicros: z.literal(PROVIDER_HARD_CAP_USD_MICROS),
    retryLimit: z.literal(0),
    maximumConcurrency: z.literal(1),
    persistedBeforeFutureDispatch: z.literal(true),
  })
  .readonly();
const reservationSchema = reservationBodySchema
  .unwrap()
  .safeExtend({ reservationDigest: digestSchema })
  .readonly();
export type M9b11CountReservation = z.infer<typeof reservationSchema>;

const reservedEventBodySchema = z
  .strictObject({
    kind: z.literal("reserved"),
    sequence: z.literal(0),
    previousEventDigest: z.null(),
    reservation: reservationSchema,
    persistenceReceipt: z
      .strictObject({
        protocol: z.literal("lachesis-m9b11-reservation-persistence/1"),
        reservationDigest: digestSchema,
        acknowledged: z.literal(true),
        receiptDigest: digestSchema,
      })
      .readonly(),
  })
  .readonly();
const reservedEventSchema = reservedEventBodySchema
  .unwrap()
  .safeExtend({ eventDigest: digestSchema })
  .readonly();

const dispatchEventBodySchema = z
  .strictObject({
    kind: z.literal("dispatch-started"),
    sequence: z.literal(1),
    previousEventDigest: digestSchema,
    effectIdentity: digestSchema,
    reservationPersistenceReceiptDigest: digestSchema,
    retryLimit: z.literal(0),
    maximumConcurrency: z.literal(1),
    mode: z.literal("offline-prerecorded-conformance"),
    futureDispatchAuthorized: z.literal(false),
    transportInvoked: z.literal(false),
  })
  .readonly();
const dispatchEventSchema = dispatchEventBodySchema
  .unwrap()
  .safeExtend({ eventDigest: digestSchema })
  .readonly();

const countResponseSchema = z
  .strictObject({
    object: z.literal("response.input_tokens"),
    input_tokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .readonly();

const settledEventBodySchema = z
  .strictObject({
    kind: z.literal("settled"),
    sequence: z.literal(2),
    previousEventDigest: digestSchema,
    responseObject: z.literal("response.input_tokens"),
    rawResponseBytes: z.string().min(1),
    rawResponseDigest: digestSchema,
    exactReturnedInputTokens: z.number().int().positive().max(65_536),
    shadowContingencyConsumedUsdMicros: safeCountSchema,
    releasedShadowReservationUsdMicros: safeCountSchema,
    inferenceReservationInputTokens: z.number().int().positive().max(65_536),
    providerReportedCountCharge: z.literal("not-observed-offline"),
    providerReportedInferenceBilling: z.literal("separate-not-dispatched"),
    inferenceDispatchAuthorized: z.literal(false),
    pairHalted: z.literal(false),
    campaignHalted: z.literal(false),
  })
  .readonly();
const settledEventSchema = settledEventBodySchema
  .unwrap()
  .safeExtend({ eventDigest: digestSchema })
  .readonly();

const overLimitEventBodySchema = z
  .strictObject({
    kind: z.literal("over-limit"),
    sequence: z.literal(2),
    previousEventDigest: digestSchema,
    responseObject: z.literal("response.input_tokens"),
    rawResponseBytes: z.string().min(1),
    rawResponseDigest: digestSchema,
    returnedInputTokens: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
    maximumInputTokens: z.union([z.literal(65_536), z.literal(32_768)]),
    shadowContingencyConsumedUsdMicros: z.union([
      z.literal(204_800),
      z.literal(102_400),
    ]),
    releasedShadowReservationUsdMicros: z.literal(0),
    inferenceDispatchAuthorized: z.literal(false),
    pairHalted: z.literal(true),
    campaignHalted: z.literal(true),
    redispatchPermitted: z.literal(false),
  })
  .readonly();
const overLimitEventSchema = overLimitEventBodySchema
  .unwrap()
  .safeExtend({ eventDigest: digestSchema })
  .readonly();

const ambiguityReasonSchema = z.enum([
  "timeout",
  "cancellation",
  "interrupted-transport",
  "malformed-response",
  "possible-dispatch-without-durable-response",
  "persistence-failure-after-possible-effect",
]);

const ambiguousEventBodySchema = z
  .strictObject({
    kind: z.literal("ambiguous"),
    sequence: z.literal(2),
    previousEventDigest: digestSchema,
    reason: ambiguityReasonSchema,
    shadowContingencyConsumedUsdMicros: z.union([
      z.literal(204_800),
      z.literal(102_400),
    ]),
    releasedShadowReservationUsdMicros: z.literal(0),
    inferenceDispatchAuthorized: z.literal(false),
    pairHalted: z.literal(true),
    campaignHalted: z.literal(true),
    redispatchPermitted: z.literal(false),
  })
  .readonly();
const ambiguousEventSchema = ambiguousEventBodySchema
  .unwrap()
  .safeExtend({ eventDigest: digestSchema })
  .readonly();

const attemptEventSchema = z.discriminatedUnion("kind", [
  reservedEventSchema,
  dispatchEventSchema,
  settledEventSchema,
  overLimitEventSchema,
  ambiguousEventSchema,
]);

const attemptRecordBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b11-count-shadow-attempt/1"),
    mode: z.literal("offline-prerecorded-conformance"),
    campaignReportDigest: digestSchema,
    attemptId: digestSchema,
    binding: attemptInputSchema,
    state: z.enum(["reserved", "settled", "over-limit", "ambiguous"]),
    events: attemptEventSchema.array().min(1).max(3).readonly(),
    countEffectPerformed: z.literal(false),
    inferenceEffectPerformed: z.literal(false),
    credentialAccessed: z.literal(false),
    networkAccessed: z.literal(false),
  })
  .readonly();
export const m9b11CountAttemptRecordSchema = attemptRecordBodySchema
  .unwrap()
  .safeExtend({ recordDigest: digestSchema })
  .readonly();
export type M9b11CountAttemptRecord = z.infer<
  typeof m9b11CountAttemptRecordSchema
>;

function classReservationFor(
  report: M9b11CampaignFreeze,
  requestClass: M9b11RequestClass,
): z.infer<typeof classReservationSchema> | undefined {
  return report.classReservations.find(
    (entry) => entry.requestClass === requestClass,
  );
}

async function buildReservation(
  report: M9b11CampaignFreeze,
  input: M9b11CountAttemptInput,
): Promise<Result<M9b11CountReservation, M9b11Failure>> {
  const profile = classReservationFor(report, input.requestClass);
  if (profile === undefined || !requestClassMatches(input))
    return failure("validation", "M9b.11 request class is cross-bound.");
  const body = reservationBodySchema.parse({
    protocol: "lachesis-m9b11-count-shadow-reservation/1",
    campaignReportDigest: report.reportDigest,
    campaignDigest: input.campaignDigest,
    pairId: input.pairId,
    arm: input.arm,
    phase: input.phase,
    callIndex: input.callIndex,
    requestClass: input.requestClass,
    exactRequestDigest: input.exactRequestDigest,
    envelopeDigest: profile.envelope.envelopeDigest,
    pricingIdentityDigest: report.model.pricingIdentityDigest,
    hardCapPolicyDigest: report.budget.hardCapPolicyDigest,
    maximumInputTokens: profile.maximumInputTokens,
    shadowInputRateUsdMicrosPerMillionTokens:
      SHADOW_RATE_USD_MICROS_PER_MILLION,
    maximumShadowReservationUsdMicros:
      profile.maximumCountShadowReservationUsdMicros,
    operationalCampaignCapacityUsdMicros: OPERATIONAL_CAMPAIGN_USD_MICROS,
    providerHardCapCapacityUsdMicros: PROVIDER_HARD_CAP_USD_MICROS,
    retryLimit: 0,
    maximumConcurrency: 1,
    persistedBeforeFutureDispatch: true,
  });
  const reservationDigest = await digestBody(body);
  return reservationDigest.ok
    ? {
        ok: true,
        value: reservationSchema.parse({
          ...body,
          reservationDigest: reservationDigest.value,
        }),
      }
    : reservationDigest;
}

async function eventWithDigest<T>(
  body: T,
): Promise<Result<T & Readonly<{ eventDigest: string }>, M9b11Failure>> {
  const eventDigest = await digestBody(body);
  return eventDigest.ok
    ? {
        ok: true,
        value: Object.freeze({ ...body, eventDigest: eventDigest.value }),
      }
    : eventDigest;
}

async function recordFor(
  body: z.infer<typeof attemptRecordBodySchema>,
): Promise<Result<M9b11CountAttemptRecord, M9b11Failure>> {
  const recordDigest = await digestBody(body);
  return recordDigest.ok
    ? {
        ok: true,
        value: m9b11CountAttemptRecordSchema.parse({
          ...body,
          recordDigest: recordDigest.value,
        }),
      }
    : recordDigest;
}

function recordBody(
  record: M9b11CountAttemptRecord,
): z.infer<typeof attemptRecordBodySchema> {
  const { recordDigest, ...body } = record;
  void recordDigest;
  return body;
}

async function verifiedCampaign(
  token: M9b11CampaignToken,
  report: unknown,
): Promise<Result<M9b11CampaignFreeze, M9b11Failure>> {
  return verifyM9b11CampaignFreeze(token, report);
}

export async function prepareM9b11CountReservation(
  token: M9b11CampaignToken,
  reportInput: unknown,
  inputValue: unknown,
): Promise<Result<M9b11CountAttemptRecord, M9b11Failure>> {
  const report = await verifiedCampaign(token, reportInput);
  const input = attemptInputSchema.safeParse(inputValue);
  if (!report.ok || !input.success)
    return failure("validation", "M9b.11 count attempt input rejected.");
  if (input.data.campaignDigest !== report.value.campaignIdentityDigest)
    return failure("validation", "M9b.11 campaign identity changed.");
  const reservation = await buildReservation(report.value, input.data);
  if (!reservation.ok) return reservation;
  const persistenceBody = {
    protocol: "lachesis-m9b11-reservation-persistence/1" as const,
    reservationDigest: reservation.value.reservationDigest,
    acknowledged: true as const,
  };
  const persistenceDigest = await digestBody(persistenceBody);
  if (!persistenceDigest.ok) return persistenceDigest;
  const persistenceReceipt = {
    ...persistenceBody,
    receiptDigest: persistenceDigest.value,
  };
  const reserved = await eventWithDigest({
    kind: "reserved" as const,
    sequence: 0 as const,
    previousEventDigest: null,
    reservation: reservation.value,
    persistenceReceipt,
  });
  if (!reserved.ok) return reserved;
  const attemptId = await digestBody({
    protocol: "lachesis-m9b11-count-attempt-identity/1",
    campaignReportDigest: report.value.reportDigest,
    binding: input.data,
  });
  if (!attemptId.ok) return attemptId;
  return recordFor(
    attemptRecordBodySchema.parse({
      protocol: "lachesis-m9b11-count-shadow-attempt/1",
      mode: "offline-prerecorded-conformance",
      campaignReportDigest: report.value.reportDigest,
      attemptId: attemptId.value,
      binding: input.data,
      state: "reserved",
      events: [reserved.value],
      countEffectPerformed: false,
      inferenceEffectPerformed: false,
      credentialAccessed: false,
      networkAccessed: false,
    }),
  );
}

async function appendDispatch(
  record: M9b11CountAttemptRecord,
): Promise<Result<z.infer<typeof dispatchEventSchema>, M9b11Failure>> {
  const reserved = record.events[0];
  if (reserved?.kind !== "reserved")
    return failure("integrity", "Count dispatch lacks persisted reservation.");
  const effectIdentity = await digestBody({
    protocol: "lachesis-m9b11-count-effect-identity/1",
    attemptId: record.attemptId,
    exactRequestDigest: record.binding.exactRequestDigest,
    reservationDigest: reserved.reservation.reservationDigest,
  });
  if (!effectIdentity.ok) return effectIdentity;
  const event = await eventWithDigest({
    kind: "dispatch-started" as const,
    sequence: 1 as const,
    previousEventDigest: reserved.eventDigest,
    effectIdentity: effectIdentity.value,
    reservationPersistenceReceiptDigest:
      reserved.persistenceReceipt.receiptDigest,
    retryLimit: 0 as const,
    maximumConcurrency: 1 as const,
    mode: "offline-prerecorded-conformance" as const,
    futureDispatchAuthorized: false as const,
    transportInvoked: false as const,
  });
  return event.ok
    ? { ok: true, value: dispatchEventSchema.parse(event.value) }
    : event;
}

async function verifyReservedAttempt(
  token: M9b11CampaignToken,
  report: M9b11CampaignFreeze,
  trustedInput: M9b11CountAttemptInput,
  record: unknown,
): Promise<Result<M9b11CountAttemptRecord, M9b11Failure>> {
  const parsed = m9b11CountAttemptRecordSchema.safeParse(record);
  if (!parsed.success)
    return failure("validation", "M9b.11 count record schema rejected.");
  const expected = await prepareM9b11CountReservation(
    token,
    report,
    trustedInput,
  );
  if (!expected.ok || !canonicalEqual(expected.value, parsed.data))
    return failure("integrity", "M9b.11 count reservation changed.");
  return { ok: true, value: parsed.data };
}

export async function settleM9b11PrerecordedCount(
  token: M9b11CampaignToken,
  reportInput: unknown,
  trustedInputValue: unknown,
  reservedRecord: unknown,
  responseInput: unknown,
): Promise<Result<M9b11CountAttemptRecord, M9b11Failure>> {
  const report = await verifiedCampaign(token, reportInput);
  const trustedInput = attemptInputSchema.safeParse(trustedInputValue);
  const response = countResponseSchema.safeParse(responseInput);
  if (!report.ok || !trustedInput.success)
    return failure("validation", "M9b.11 settlement context rejected.");
  const reserved = await verifyReservedAttempt(
    token,
    report.value,
    trustedInput.data,
    reservedRecord,
  );
  if (!reserved.ok || !response.success)
    return failure("validation", "M9b.11 exact count response rejected.");
  const rawResponseBytes = canonicalizeJson(response.data);
  const rawResponseDigest = await digestBody(response.data);
  if (!rawResponseBytes.ok || !rawResponseDigest.ok)
    return failure("integrity", "M9b.11 count response could not be bound.");
  const exactReturnedInputTokens = response.data.input_tokens;
  const firstEvent = reserved.value.events[0];
  if (firstEvent?.kind !== "reserved")
    return failure("integrity", "M9b.11 reservation event missing.");
  const dispatch = await appendDispatch(reserved.value);
  if (!dispatch.ok) return dispatch;
  if (exactReturnedInputTokens > firstEvent.reservation.maximumInputTokens) {
    const overLimit = await eventWithDigest({
      kind: "over-limit" as const,
      sequence: 2 as const,
      previousEventDigest: dispatch.value.eventDigest,
      responseObject: response.data.object,
      rawResponseBytes: rawResponseBytes.value,
      rawResponseDigest: rawResponseDigest.value,
      returnedInputTokens: exactReturnedInputTokens,
      maximumInputTokens: firstEvent.reservation.maximumInputTokens,
      shadowContingencyConsumedUsdMicros:
        firstEvent.reservation.maximumShadowReservationUsdMicros,
      releasedShadowReservationUsdMicros: 0 as const,
      inferenceDispatchAuthorized: false as const,
      pairHalted: true as const,
      campaignHalted: true as const,
      redispatchPermitted: false as const,
    });
    if (!overLimit.ok) return overLimit;
    return recordFor(
      attemptRecordBodySchema.parse({
        ...recordBody(reserved.value),
        state: "over-limit",
        events: [firstEvent, dispatch.value, overLimit.value],
      }),
    );
  }
  const consumed = shadowCost(exactReturnedInputTokens);
  if (consumed === undefined)
    return failure("capacity", "M9b.11 shadow settlement overflowed.");
  const settled = await eventWithDigest({
    kind: "settled" as const,
    sequence: 2 as const,
    previousEventDigest: dispatch.value.eventDigest,
    responseObject: response.data.object,
    rawResponseBytes: rawResponseBytes.value,
    rawResponseDigest: rawResponseDigest.value,
    exactReturnedInputTokens,
    shadowContingencyConsumedUsdMicros: consumed,
    releasedShadowReservationUsdMicros:
      firstEvent.reservation.maximumShadowReservationUsdMicros - consumed,
    inferenceReservationInputTokens: exactReturnedInputTokens,
    providerReportedCountCharge: "not-observed-offline" as const,
    providerReportedInferenceBilling: "separate-not-dispatched" as const,
    inferenceDispatchAuthorized: false as const,
    pairHalted: false as const,
    campaignHalted: false as const,
  });
  if (!settled.ok) return settled;
  return recordFor(
    attemptRecordBodySchema.parse({
      ...recordBody(reserved.value),
      state: "settled",
      events: [firstEvent, dispatch.value, settled.value],
    }),
  );
}

export async function markM9b11CountAmbiguous(
  token: M9b11CampaignToken,
  reportInput: unknown,
  trustedInputValue: unknown,
  reservedRecord: unknown,
  reasonInput: unknown,
): Promise<Result<M9b11CountAttemptRecord, M9b11Failure>> {
  const report = await verifiedCampaign(token, reportInput);
  const trustedInput = attemptInputSchema.safeParse(trustedInputValue);
  const reason = ambiguityReasonSchema.safeParse(reasonInput);
  if (!report.ok || !trustedInput.success || !reason.success)
    return failure("validation", "M9b.11 ambiguity context rejected.");
  const reserved = await verifyReservedAttempt(
    token,
    report.value,
    trustedInput.data,
    reservedRecord,
  );
  if (!reserved.ok) return reserved;
  const firstEvent = reserved.value.events[0];
  if (firstEvent?.kind !== "reserved")
    return failure("integrity", "M9b.11 reservation event missing.");
  const dispatch = await appendDispatch(reserved.value);
  if (!dispatch.ok) return dispatch;
  const ambiguous = await eventWithDigest({
    kind: "ambiguous" as const,
    sequence: 2 as const,
    previousEventDigest: dispatch.value.eventDigest,
    reason: reason.data,
    shadowContingencyConsumedUsdMicros:
      firstEvent.reservation.maximumShadowReservationUsdMicros,
    releasedShadowReservationUsdMicros: 0 as const,
    inferenceDispatchAuthorized: false as const,
    pairHalted: true as const,
    campaignHalted: true as const,
    redispatchPermitted: false as const,
  });
  if (!ambiguous.ok) return ambiguous;
  return recordFor(
    attemptRecordBodySchema.parse({
      ...recordBody(reserved.value),
      state: "ambiguous",
      events: [firstEvent, dispatch.value, ambiguous.value],
    }),
  );
}

export async function verifyM9b11CountAttempt(
  token: M9b11CampaignToken,
  reportInput: unknown,
  trustedInputValue: unknown,
  value: unknown,
): Promise<Result<M9b11CountAttemptRecord, M9b11Failure>> {
  const report = await verifiedCampaign(token, reportInput);
  const trustedInput = attemptInputSchema.safeParse(trustedInputValue);
  const parsed = m9b11CountAttemptRecordSchema.safeParse(value);
  if (!report.ok || !trustedInput.success || !parsed.success)
    return failure("validation", "M9b.11 count attempt verification rejected.");
  let rebuilt: Result<M9b11CountAttemptRecord, M9b11Failure>;
  if (parsed.data.state === "reserved")
    rebuilt = await prepareM9b11CountReservation(
      token,
      report.value,
      trustedInput.data,
    );
  else {
    const base = await prepareM9b11CountReservation(
      token,
      report.value,
      trustedInput.data,
    );
    if (!base.ok) return base;
    const terminal = parsed.data.events[2];
    if (terminal?.kind === "settled")
      rebuilt = await settleM9b11PrerecordedCount(
        token,
        report.value,
        trustedInput.data,
        base.value,
        {
          object: terminal.responseObject,
          input_tokens: terminal.exactReturnedInputTokens,
        },
      );
    else if (terminal?.kind === "over-limit")
      rebuilt = await settleM9b11PrerecordedCount(
        token,
        report.value,
        trustedInput.data,
        base.value,
        {
          object: terminal.responseObject,
          input_tokens: terminal.returnedInputTokens,
        },
      );
    else if (terminal?.kind === "ambiguous")
      rebuilt = await markM9b11CountAmbiguous(
        token,
        report.value,
        trustedInput.data,
        base.value,
        terminal.reason,
      );
    else return failure("integrity", "M9b.11 terminal event is invalid.");
  }
  return rebuilt.ok && canonicalEqual(rebuilt.value, parsed.data)
    ? rebuilt
    : failure("integrity", "M9b.11 count attempt failed rederivation.");
}

export const m9b11CountOnlyProbeSchema =
  reportBodySchema.unwrap().shape.countOnlyProbe;

export async function verifyM9b11CountOnlyProbe(
  token: M9b11CampaignToken,
  reportInput: unknown,
  value: unknown,
): Promise<Result<M9b11CampaignFreeze["countOnlyProbe"], M9b11Failure>> {
  const report = await verifiedCampaign(token, reportInput);
  const parsed = m9b11CountOnlyProbeSchema.safeParse(value);
  return report.ok &&
    parsed.success &&
    canonicalEqual(parsed.data, report.value.countOnlyProbe)
    ? { ok: true, value: parsed.data }
    : failure("validation", "M9b.11 count-only probe design changed.");
}

const pricingEvidenceSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("baseline-conforms"),
      pricingIdentityDigest: digestSchema,
      responseFields: z
        .tuple([z.literal("object"), z.literal("input_tokens")])
        .readonly(),
      projectSpendUsdMicros: z.literal(0),
      hardCapIndependentlyVerified: z.literal(true),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("unexpected"),
      gate: killGateSchema,
      evidenceDigest: digestSchema,
    })
    .readonly(),
]);

const pricingDecisionBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b11-pricing-kill-gate-decision/1"),
    campaignReportDigest: digestSchema,
    evidence: pricingEvidenceSchema,
    outcome: z.enum([
      "continue-offline-preparation-only",
      "terminal-kill-new-prospective-amendment-required",
    ]),
    countProbeExecutionAuthorized: z.literal(false),
    inferenceAuthorized: z.literal(false),
    providerEffectPerformed: z.literal(false),
  })
  .readonly();
export const m9b11PricingDecisionSchema = pricingDecisionBodySchema
  .unwrap()
  .safeExtend({ decisionDigest: digestSchema })
  .readonly();
export type M9b11PricingDecision = z.infer<typeof m9b11PricingDecisionSchema>;

export async function assessM9b11PricingEvidence(
  token: M9b11CampaignToken,
  reportInput: unknown,
  evidenceInput: unknown,
): Promise<Result<M9b11PricingDecision, M9b11Failure>> {
  const report = await verifiedCampaign(token, reportInput);
  const evidence = pricingEvidenceSchema.safeParse(evidenceInput);
  if (!report.ok || !evidence.success)
    return failure("validation", "M9b.11 pricing evidence rejected.");
  if (
    evidence.data.kind === "baseline-conforms" &&
    evidence.data.pricingIdentityDigest !==
      report.value.model.pricingIdentityDigest
  )
    return failure("validation", "M9b.11 baseline pricing identity drifted.");
  const body = pricingDecisionBodySchema.parse({
    protocol: "lachesis-m9b11-pricing-kill-gate-decision/1",
    campaignReportDigest: report.value.reportDigest,
    evidence: evidence.data,
    outcome:
      evidence.data.kind === "baseline-conforms"
        ? "continue-offline-preparation-only"
        : "terminal-kill-new-prospective-amendment-required",
    countProbeExecutionAuthorized: false,
    inferenceAuthorized: false,
    providerEffectPerformed: false,
  });
  const decisionDigest = await digestBody(body);
  return decisionDigest.ok
    ? {
        ok: true,
        value: m9b11PricingDecisionSchema.parse({
          ...body,
          decisionDigest: decisionDigest.value,
        }),
      }
    : decisionDigest;
}

export async function verifyM9b11PricingDecision(
  token: M9b11CampaignToken,
  reportInput: unknown,
  evidenceInput: unknown,
  value: unknown,
): Promise<Result<M9b11PricingDecision, M9b11Failure>> {
  const parsed = m9b11PricingDecisionSchema.safeParse(value);
  const rederived = await assessM9b11PricingEvidence(
    token,
    reportInput,
    evidenceInput,
  );
  return parsed.success &&
    rederived.ok &&
    canonicalEqual(parsed.data, rederived.value)
    ? rederived
    : failure("integrity", "M9b.11 pricing decision changed.");
}
