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
  M9B3_PREPARATION_PROTOCOL,
  type M9b3Preparation,
  type M9b3PreparationInput,
  verifyM9b3OfflineStudy,
} from "../../generator/src/m9b3-preparation.js";
import {
  M9B5_OPENAI_RESPONSES_PROTOCOL,
  type M9b5IdentityProfile,
  m9b5IdentityProfileSchema,
  type M9b5RequestClass,
  prepareM9b5ConformanceVector,
} from "../src/m9b5-openai-responses.js";
import {
  inspectM9b6VerifiedHardCapReceipt,
  M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL,
  type M9b6HardCapReceipt,
  m9b6HardCapReceiptSchema,
  type M9b6VerifiedHardCapToken,
} from "./m9b6-conservative-accounting.js";

export const M9B7_CAMPAIGN_CAPACITY_PROTOCOL = Object.freeze({
  id: "lachesis-m9b7-offline-campaign-capacity-review",
  version: "1.0.0",
  visibility: "private-offline-review-only" as const,
  preparation: `${M9B3_PREPARATION_PROTOCOL.id}@${M9B3_PREPARATION_PROTOCOL.version}`,
  adapter: `${M9B5_OPENAI_RESPONSES_PROTOCOL.id}@${M9B5_OPENAI_RESPONSES_PROTOCOL.version}`,
  accounting: `${M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL.id}@${M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL.version}`,
  claimBoundary:
    "offline campaign capacity and completion-safety review only; no corpus, preregistration, credential, provider call, probe, live execution, or superiority claim",
});

const PROBE_PAIRS = 24;
const PRIMARY_PAIRS = 168;
const TOTAL_PAIRS = PROBE_PAIRS + PRIMARY_PAIRS;
const REQUESTS_PER_DISCOVERED_ARM = 6;
const REQUESTS_PER_STATIC_ARM = 2;
const REQUESTS_PER_PAIR = REQUESTS_PER_DISCOVERED_ARM + REQUESTS_PER_STATIC_ARM;
const TOTAL_REQUESTS = TOTAL_PAIRS * REQUESTS_PER_PAIR;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z.string().min(1).max(160);
const safeCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const armSchema = z.enum(["discovered-program", "static-one-shot"]);
const populationSchema = z.enum(["probe", "primary"]);

const artifactIdentitySchema = z
  .strictObject({
    id: identifierSchema,
    version: identifierSchema,
    artifactDigest: digestSchema,
  })
  .readonly();

const modelLimitsSchema = z
  .strictObject({
    model: artifactIdentitySchema
      .unwrap()
      .safeExtend({ providerId: identifierSchema })
      .readonly(),
    limitsArtifact: artifactIdentitySchema,
    maximumInputTokens: z.number().int().positive(),
    maximumOutputTokens: z.number().int().positive(),
    contextWindowTokens: z.number().int().positive(),
    reservationBasis: z.literal(
      "full-provider-model-input-maximum-including-unknown-framing",
    ),
  })
  .superRefine((value, context) => {
    const total = value.maximumInputTokens + value.maximumOutputTokens;
    if (!Number.isSafeInteger(total) || total !== value.contextWindowTokens)
      context.addIssue({
        code: "custom",
        message: "M9b.7 model limits do not form the context window.",
      });
  })
  .readonly();
export type M9b7ModelLimits = z.infer<typeof modelLimitsSchema>;

const requestProfileSchema = z
  .strictObject({
    requestClass: z.enum([
      "root-program-authoring",
      "static-one-shot-query-planning",
      "discovered-program-leaf-reasoning",
      "static-answer-generation",
    ]),
    arm: armSchema,
    phase: z.enum(["authoring", "execution"]),
    requestsPerPair: z.number().int().positive(),
    maximumInputTokensPerRequest: z.number().int().positive(),
    maximumOutputTokensPerRequest: z.number().int().positive(),
    maximumCostUsdMicrosPerRequest: safeCountSchema,
    responseSchemaDigest: digestSchema,
    retryLimit: z.literal(0),
  })
  .readonly();

const capacitySliceSchema = z
  .strictObject({
    requestCount: safeCountSchema,
    maximumInputTokens: safeCountSchema,
    maximumOutputTokens: safeCountSchema,
    maximumCostUsdMicros: safeCountSchema,
  })
  .readonly();

const capacityTotalsSchema = z
  .strictObject({
    perRequestClass: requestProfileSchema.array().length(4).readonly(),
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
        execution: capacitySliceSchema,
        evaluation: capacitySliceSchema,
      })
      .readonly(),
    providerModel: capacitySliceSchema,
    probe: capacitySliceSchema,
    primary: capacitySliceSchema,
    campaign: capacitySliceSchema,
  })
  .readonly();

const scheduleBindingSchema = z
  .strictObject({
    allocationDigest: digestSchema,
    scheduleProtocolDigest: digestSchema,
    seedCommitment: digestSchema,
    scheduleProtocol: z.literal(
      "lachesis-m9b3f-paired-counterbalance-schedule/1",
    ),
    phaseOrder: z.literal("complete-probe-gate-then-complete-primary"),
    probePairs: z.literal(PROBE_PAIRS),
    primaryPairs: z.literal(PRIMARY_PAIRS),
    materializedScheduleDigest: z.literal("absent"),
    capacityOrder: z.literal(
      "pair-reservation-before-first-arm-scheduled-arm-order-only",
    ),
  })
  .readonly();

const hardCapBindingSchema = z
  .discriminatedUnion("status", [
    z
      .strictObject({
        status: z.literal("absent"),
        receipt: z.null(),
        receiptDigest: z.null(),
        remainingUsdMicros: z.literal(0),
      })
      .readonly(),
    z
      .strictObject({
        status: z.literal("verified-offline-capability"),
        receipt: m9b6HardCapReceiptSchema,
        receiptDigest: digestSchema,
        remainingUsdMicros: safeCountSchema,
      })
      .readonly(),
  ])
  .readonly();

const powerBindingSchema = z
  .strictObject({
    primaryPairs: z.literal(PRIMARY_PAIRS),
    alphaBasisPoints: z.literal(500),
    targetPowerBasisPoints: z.literal(8_000),
    probeGate: z.literal("lachesis-m9b3f-probe-advancement-gate/1"),
    status: z.enum([
      "unchanged-prospective-target-pending-frozen-probe",
      "unknown-requires-new-probe-and-preregistration",
    ]),
  })
  .readonly();

const alternativeSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b7-cap-only-alternative/1"),
    designId: z.literal("raise-cap-preserve-scientific-design"),
    requiredCampaignCapUsdMicros: safeCountSchema,
    requiredHardCapRemainingUsdMicros: safeCountSchema,
    populationPairs: z.literal(TOTAL_PAIRS),
    requestCount: z.literal(TOTAL_REQUESTS),
    changedParameters: z.tuple([z.literal("campaign-cap")]).readonly(),
    unchangedParameters: z
      .tuple([
        z.literal("population"),
        z.literal("schedule-protocol"),
        z.literal("model"),
        z.literal("request-topology"),
        z.literal("output-ceilings"),
        z.literal("zero-retry-policy"),
        z.literal("maximum-concurrency"),
        z.literal("primary-estimand"),
        z.literal("probe-gate"),
      ])
      .readonly(),
    scientificComparability: z.literal("preserved"),
    power: powerBindingSchema,
    liveAuthority: z.literal(false),
    activationRequirements: z
      .tuple([
        z.literal("new-prospective-cap-binding"),
        z.literal("fresh-verified-hard-cap-receipt"),
        z.literal("materialized-schedule-binding"),
        z.literal("separate-review"),
      ])
      .readonly(),
  })
  .readonly();

const reportBodySchema = z
  .strictObject({
    protocol: z.literal(M9B7_CAMPAIGN_CAPACITY_PROTOCOL.id),
    version: z.literal(M9B7_CAMPAIGN_CAPACITY_PROTOCOL.version),
    baselineCommit: z.literal("4401bef2c912d9b8fd4349c74fad78ffb75a8dea"),
    preparationDigest: digestSchema,
    providerProfileDigest: digestSchema,
    adapterProtocol: z.literal(M9B5_OPENAI_RESPONSES_PROTOCOL.id),
    adapterVersion: z.literal(M9B5_OPENAI_RESPONSES_PROTOCOL.version),
    adapterIdentityDigest: digestSchema,
    accountingProtocol: z.literal(M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL.id),
    accountingVersion: z.literal(M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL.version),
    modelLimits: modelLimitsSchema,
    modelLimitsDigest: digestSchema,
    pricingDigest: digestSchema,
    schedule: scheduleBindingSchema,
    hardCap: hardCapBindingSchema,
    invariants: z
      .strictObject({
        maximumConcurrency: z.literal(1),
        retriesPerRequest: z.literal(0),
        requestsPerPair: z.literal(REQUESTS_PER_PAIR),
        completePairReservationBeforeFirstArm: z.literal(true),
        completePhaseCapacityBeforeFirstDispatch: z.literal(true),
        completePopulationCapacityBeforeFirstDispatch: z.literal(true),
        asymmetricPartialPairsForbidden: z.literal(true),
        outcomeDependentPopulationChangesForbidden: z.literal(true),
        postHocPopulationReductionForbidden: z.literal(true),
        ambiguousAndOverageChargeFullReservationAndHalt: z.literal(true),
      })
      .readonly(),
    totals: capacityTotalsSchema,
    originalDesign: z
      .strictObject({
        frozenCampaignCapUsdMicros: safeCountSchema,
        requiredCampaignCapUsdMicros: safeCountSchema,
        shortfallUsdMicros: safeCountSchema,
        capacityRatioBasisPoints: safeCountSchema,
        hardCapSufficient: z.boolean(),
        scheduleMaterialized: z.literal(false),
        outcome: z.literal("campaign-capacity-no-go"),
        blockers: z
          .enum([
            "frozen-m9b3-cap-below-m9b6-full-reservations",
            "verified-current-hard-cap-capacity-absent-or-insufficient",
            "materialized-schedule-and-request-identities-absent",
          ])
          .array()
          .min(1)
          .readonly(),
      })
      .readonly(),
    dominantCostDrivers: z
      .tuple([
        z.literal("request-count-and-call-topology"),
        z.literal("full-model-input-maximum"),
        z.literal("highest-input-cache-class"),
        z.literal("long-context-multipliers"),
        z.literal("output-ceilings"),
      ])
      .readonly(),
    alternative: alternativeSchema,
    decision: z.literal("campaign-capacity-no-go"),
    authority: z
      .strictObject({
        offlinePreregistrationPackageAuthorized: z.literal(false),
        corpusMaterializationAuthorized: z.literal(false),
        externalRegistrationAuthorized: z.literal(false),
        credentialsAuthorized: z.literal(false),
        providerCallsAuthorized: z.literal(false),
        liveExecutionAuthorized: z.literal(false),
      })
      .readonly(),
  })
  .readonly();

export const m9b7CapacityReportSchema = reportBodySchema
  .unwrap()
  .safeExtend({ reportDigest: digestSchema })
  .readonly();
export type M9b7CapacityReport = z.infer<typeof m9b7CapacityReportSchema>;

export type M9b7CapacityToken = Readonly<{ capability: object }>;
export type M9b7AlternativeToken = Readonly<{ capability: object }>;

type TrustedReview = Readonly<{
  preparationInputBytes: string;
  preparationBytes: string;
  adapterIdentityBytes: string;
  modelLimitsBytes: string;
  hardCapToken: M9b6VerifiedHardCapToken | undefined;
}>;

const trustedReviews = new WeakMap<object, TrustedReview>();
const trustedAlternatives = new WeakMap<object, string>();

function invalid(message: string): Result<never, Diagnostic> {
  return { ok: false, error: diagnostic("REPLAY_REQUEST_MISMATCH", message) };
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalizeJson(left);
  const rightBytes = canonicalizeJson(right);
  return leftBytes.ok && rightBytes.ok && leftBytes.value === rightBytes.value;
}

function safeMultiply(left: number, right: number): number | undefined {
  const product = BigInt(left) * BigInt(right);
  return product <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(product)
    : undefined;
}

function safeAdd(values: ReadonlyArray<number>): number | undefined {
  const sum = values.reduce((total, value) => total + BigInt(value), 0n);
  return sum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(sum) : undefined;
}

function ceilPrice(
  inputTokens: number,
  outputTokens: number,
  pricing: M9b5IdentityProfile["pricingSnapshot"],
): number | undefined {
  const longContext = inputTokens > pricing.longContextThresholdTokens;
  const inputRate = Math.max(
    pricing.inputUsdMicrosPerMillionTokens,
    pricing.cachedInputUsdMicrosPerMillionTokens,
    pricing.cacheWriteInputUsdMicrosPerMillionTokens,
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

type RequestDefinition = Readonly<{
  requestClass: M9b5RequestClass;
  arm: "discovered-program" | "static-one-shot";
  phase: "authoring" | "execution";
  requestsPerPair: number;
  maximumOutputTokensPerRequest: number;
}>;

const REQUEST_DEFINITIONS: ReadonlyArray<RequestDefinition> = Object.freeze([
  Object.freeze({
    requestClass: "root-program-authoring",
    arm: "discovered-program",
    phase: "authoring",
    requestsPerPair: 1,
    maximumOutputTokensPerRequest: 65_536,
  }),
  Object.freeze({
    requestClass: "discovered-program-leaf-reasoning",
    arm: "discovered-program",
    phase: "execution",
    requestsPerPair: 5,
    maximumOutputTokensPerRequest: 4_096,
  }),
  Object.freeze({
    requestClass: "static-one-shot-query-planning",
    arm: "static-one-shot",
    phase: "authoring",
    requestsPerPair: 1,
    maximumOutputTokensPerRequest: 65_536,
  }),
  Object.freeze({
    requestClass: "static-answer-generation",
    arm: "static-one-shot",
    phase: "execution",
    requestsPerPair: 1,
    maximumOutputTokensPerRequest: 20_480,
  }),
]);

function sliceForProfiles(
  profiles: ReadonlyArray<z.infer<typeof requestProfileSchema>>,
  pairCount: number,
): z.infer<typeof capacitySliceSchema> | undefined {
  const requestCount = profiles.reduce(
    (count, profile) => count + profile.requestsPerPair * pairCount,
    0,
  );
  const input = safeAdd(
    profiles.map(
      (profile) =>
        profile.maximumInputTokensPerRequest *
        profile.requestsPerPair *
        pairCount,
    ),
  );
  const output = safeAdd(
    profiles.map(
      (profile) =>
        profile.maximumOutputTokensPerRequest *
        profile.requestsPerPair *
        pairCount,
    ),
  );
  const cost = safeAdd(
    profiles.map(
      (profile) =>
        profile.maximumCostUsdMicrosPerRequest *
        profile.requestsPerPair *
        pairCount,
    ),
  );
  return input === undefined || output === undefined || cost === undefined
    ? undefined
    : capacitySliceSchema.parse({
        requestCount,
        maximumInputTokens: input,
        maximumOutputTokens: output,
        maximumCostUsdMicros: cost,
      });
}

async function requestProfiles(
  preparation: M9b3Preparation,
  identities: M9b5IdentityProfile,
  limits: M9b7ModelLimits,
): Promise<ReadonlyArray<z.infer<typeof requestProfileSchema>> | undefined> {
  const profiles: Array<z.infer<typeof requestProfileSchema>> = [];
  for (const definition of REQUEST_DEFINITIONS) {
    const vector = await prepareM9b5ConformanceVector({
      requestClass: definition.requestClass,
      comparisonDigest: preparation.preparationDigest,
      arm: definition.arm,
      phase: definition.phase,
      callIndex: 0,
      instructions: "M9b.7 offline capacity schema binding only.",
      input:
        "No task, corpus, evidence, answer, or provider effect is present.",
      maximumOutputTokens: definition.maximumOutputTokensPerRequest,
      identities,
    });
    const cost = ceilPrice(
      limits.maximumInputTokens,
      definition.maximumOutputTokensPerRequest,
      identities.pricingSnapshot,
    );
    if (!vector.ok || cost === undefined) return undefined;
    profiles.push(
      requestProfileSchema.parse({
        ...definition,
        maximumInputTokensPerRequest: limits.maximumInputTokens,
        maximumCostUsdMicrosPerRequest: cost,
        responseSchemaDigest: vector.value.responseSchemaDigest,
        retryLimit: 0,
      }),
    );
  }
  return profiles;
}

async function validatedInputs(
  input: Readonly<{
    preparationInput: unknown;
    preparation: unknown;
    adapterIdentities: M9b5IdentityProfile;
    modelLimits: unknown;
    hardCapToken?: M9b6VerifiedHardCapToken | undefined;
  }>,
): Promise<
  Result<
    Readonly<{
      preparation: M9b3Preparation;
      identities: M9b5IdentityProfile;
      limits: M9b7ModelLimits;
      hardCap: M9b6HardCapReceipt | undefined;
    }>,
    Diagnostic
  >
> {
  const preparation = await verifyM9b3OfflineStudy(
    input.preparationInput,
    input.preparation,
  );
  const limits = modelLimitsSchema.safeParse(input.modelLimits);
  const identityBytes = canonicalizeJson(input.adapterIdentities);
  const hardCapResult =
    input.hardCapToken === undefined
      ? undefined
      : inspectM9b6VerifiedHardCapReceipt(input.hardCapToken);
  if (
    !preparation.ok ||
    !limits.success ||
    !identityBytes.ok ||
    hardCapResult?.ok === false
  )
    return invalid("M9b.7 input is invalid or lacks trusted provenance.");
  const hardCap = hardCapResult?.ok === true ? hardCapResult.value : undefined;
  const identities = input.adapterIdentities;
  const profile = preparation.value.providerProfile;
  if (
    identities.provider.id !== profile.provider.id ||
    identities.provider.version !== profile.provider.version ||
    identities.model.id !== profile.model.id ||
    identities.model.version !== profile.model.revision ||
    identities.model.providerId !== profile.provider.id ||
    identities.tokenizer.id !== profile.tokenizer.id ||
    identities.tokenizer.version !== profile.tokenizer.version ||
    identities.pricingSnapshot.providerId !== profile.provider.id ||
    identities.pricingSnapshot.inputUsdMicrosPerMillionTokens !==
      profile.pricing.inputUsdMicrosPerMillionTokens ||
    identities.pricingSnapshot.outputUsdMicrosPerMillionTokens !==
      profile.pricing.outputUsdMicrosPerMillionTokens ||
    limits.data.model.id !== identities.model.id ||
    limits.data.model.version !== identities.model.version ||
    limits.data.model.providerId !== identities.provider.id ||
    limits.data.contextWindowTokens !== profile.model.contextWindowTokens ||
    limits.data.maximumOutputTokens !== profile.model.maximumOutputTokens ||
    identities.pricingSnapshot.cacheWriteInputUsdMicrosPerMillionTokens <
      identities.pricingSnapshot.inputUsdMicrosPerMillionTokens ||
    (hardCap !== undefined && hardCap.provider.id !== identities.provider.id)
  )
    return invalid(
      "M9b.7 provider, model, tokenizer, pricing, or cap drifted.",
    );
  return {
    ok: true,
    value: {
      preparation: preparation.value,
      identities,
      limits: limits.data,
      hardCap,
    },
  };
}

async function deriveReport(
  input: Readonly<{
    preparationInput: unknown;
    preparation: unknown;
    adapterIdentities: M9b5IdentityProfile;
    modelLimits: unknown;
    hardCapToken?: M9b6VerifiedHardCapToken | undefined;
  }>,
): Promise<Result<M9b7CapacityReport, Diagnostic>> {
  const validated = await validatedInputs(input);
  if (!validated.ok) return validated;
  const { preparation, identities, limits, hardCap } = validated.value;
  const profiles = await requestProfiles(preparation, identities, limits);
  if (profiles === undefined)
    return invalid("M9b.7 request profiles overflow or violate M9b.5.");
  const discoveredProfiles = profiles.filter(
    (profile) => profile.arm === "discovered-program",
  );
  const staticProfiles = profiles.filter(
    (profile) => profile.arm === "static-one-shot",
  );
  const authoringProfiles = profiles.filter(
    (profile) => profile.phase === "authoring",
  );
  const executionProfiles = profiles.filter(
    (profile) => profile.phase === "execution",
  );
  const perPair = sliceForProfiles(profiles, 1);
  const discovered = sliceForProfiles(discoveredProfiles, TOTAL_PAIRS);
  const staticArm = sliceForProfiles(staticProfiles, TOTAL_PAIRS);
  const authoring = sliceForProfiles(authoringProfiles, TOTAL_PAIRS);
  const execution = sliceForProfiles(executionProfiles, TOTAL_PAIRS);
  const probe = sliceForProfiles(profiles, PROBE_PAIRS);
  const primary = sliceForProfiles(profiles, PRIMARY_PAIRS);
  const campaign = sliceForProfiles(profiles, TOTAL_PAIRS);
  if (
    perPair === undefined ||
    discovered === undefined ||
    staticArm === undefined ||
    authoring === undefined ||
    execution === undefined ||
    probe === undefined ||
    primary === undefined ||
    campaign === undefined
  )
    return invalid("M9b.7 aggregate capacity overflows safe integer bounds.");
  const empty = capacitySliceSchema.parse({
    requestCount: 0,
    maximumInputTokens: 0,
    maximumOutputTokens: 0,
    maximumCostUsdMicros: 0,
  });
  const providerProfileDigest = await digestValue(preparation.providerProfile);
  const adapterIdentityDigest = await digestValue(identities);
  const modelLimitsDigest = await digestValue(limits);
  const pricingDigest = await digestValue(identities.pricingSnapshot);
  const hardCapDigest =
    hardCap === undefined ? undefined : await digestValue(hardCap);
  if (
    !providerProfileDigest.ok ||
    !adapterIdentityDigest.ok ||
    !modelLimitsDigest.ok ||
    !pricingDigest.ok ||
    hardCapDigest?.ok === false
  )
    return invalid("M9b.7 identity binding failed.");
  const frozenCap = preparation.matchedBudget.maximumPreparedStudyCostUsdMicros;
  const shortfall = campaign.maximumCostUsdMicros - frozenCap;
  if (!Number.isSafeInteger(shortfall) || shortfall <= 0)
    return invalid(
      "M9b.7 expected the accepted M9b.3 design to remain capacity-incompatible.",
    );
  const capacityRatioBasisPoints = Number(
    (BigInt(campaign.maximumCostUsdMicros) * 10_000n + BigInt(frozenCap) - 1n) /
      BigInt(frozenCap),
  );
  const hardCapSufficient =
    hardCap !== undefined &&
    hardCap.remainingUsdMicros >= campaign.maximumCostUsdMicros;
  const hardCapBinding =
    hardCap === undefined
      ? {
          status: "absent" as const,
          receipt: null,
          receiptDigest: null,
          remainingUsdMicros: 0 as const,
        }
      : {
          status: "verified-offline-capability" as const,
          receipt: hardCap,
          receiptDigest: hardCapDigest?.ok === true ? hardCapDigest.value : "",
          remainingUsdMicros: hardCap.remainingUsdMicros,
        };
  const body = reportBodySchema.safeParse({
    protocol: M9B7_CAMPAIGN_CAPACITY_PROTOCOL.id,
    version: M9B7_CAMPAIGN_CAPACITY_PROTOCOL.version,
    baselineCommit: "4401bef2c912d9b8fd4349c74fad78ffb75a8dea",
    preparationDigest: preparation.preparationDigest,
    providerProfileDigest: providerProfileDigest.value,
    adapterProtocol: M9B5_OPENAI_RESPONSES_PROTOCOL.id,
    adapterVersion: M9B5_OPENAI_RESPONSES_PROTOCOL.version,
    adapterIdentityDigest: adapterIdentityDigest.value,
    accountingProtocol: M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL.id,
    accountingVersion: M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL.version,
    modelLimits: limits,
    modelLimitsDigest: modelLimitsDigest.value,
    pricingDigest: pricingDigest.value,
    schedule: {
      allocationDigest: preparation.allocationDigest,
      scheduleProtocolDigest: preparation.scheduleProtocolDigest,
      seedCommitment: preparation.schedule.seedCommitment,
      scheduleProtocol: "lachesis-m9b3f-paired-counterbalance-schedule/1",
      phaseOrder: "complete-probe-gate-then-complete-primary",
      probePairs: PROBE_PAIRS,
      primaryPairs: PRIMARY_PAIRS,
      materializedScheduleDigest: "absent",
      capacityOrder:
        "pair-reservation-before-first-arm-scheduled-arm-order-only",
    },
    hardCap: hardCapBinding,
    invariants: {
      maximumConcurrency: 1,
      retriesPerRequest: 0,
      requestsPerPair: REQUESTS_PER_PAIR,
      completePairReservationBeforeFirstArm: true,
      completePhaseCapacityBeforeFirstDispatch: true,
      completePopulationCapacityBeforeFirstDispatch: true,
      asymmetricPartialPairsForbidden: true,
      outcomeDependentPopulationChangesForbidden: true,
      postHocPopulationReductionForbidden: true,
      ambiguousAndOverageChargeFullReservationAndHalt: true,
    },
    totals: {
      perRequestClass: profiles,
      perPair,
      perArm: { discoveredProgram: discovered, staticOneShot: staticArm },
      perPhase: { authoring, execution, evaluation: empty },
      providerModel: campaign,
      probe,
      primary,
      campaign,
    },
    originalDesign: {
      frozenCampaignCapUsdMicros: frozenCap,
      requiredCampaignCapUsdMicros: campaign.maximumCostUsdMicros,
      shortfallUsdMicros: shortfall,
      capacityRatioBasisPoints,
      hardCapSufficient,
      scheduleMaterialized: false,
      outcome: "campaign-capacity-no-go",
      blockers: [
        "frozen-m9b3-cap-below-m9b6-full-reservations",
        ...(hardCapSufficient
          ? []
          : [
              "verified-current-hard-cap-capacity-absent-or-insufficient" as const,
            ]),
        "materialized-schedule-and-request-identities-absent",
      ],
    },
    dominantCostDrivers: [
      "request-count-and-call-topology",
      "full-model-input-maximum",
      "highest-input-cache-class",
      "long-context-multipliers",
      "output-ceilings",
    ],
    alternative: {
      protocol: "lachesis-m9b7-cap-only-alternative/1",
      designId: "raise-cap-preserve-scientific-design",
      requiredCampaignCapUsdMicros: campaign.maximumCostUsdMicros,
      requiredHardCapRemainingUsdMicros: campaign.maximumCostUsdMicros,
      populationPairs: TOTAL_PAIRS,
      requestCount: TOTAL_REQUESTS,
      changedParameters: ["campaign-cap"],
      unchangedParameters: [
        "population",
        "schedule-protocol",
        "model",
        "request-topology",
        "output-ceilings",
        "zero-retry-policy",
        "maximum-concurrency",
        "primary-estimand",
        "probe-gate",
      ],
      scientificComparability: "preserved",
      power: {
        primaryPairs: PRIMARY_PAIRS,
        alphaBasisPoints: 500,
        targetPowerBasisPoints: 8_000,
        probeGate: "lachesis-m9b3f-probe-advancement-gate/1",
        status: "unchanged-prospective-target-pending-frozen-probe",
      },
      liveAuthority: false,
      activationRequirements: [
        "new-prospective-cap-binding",
        "fresh-verified-hard-cap-receipt",
        "materialized-schedule-binding",
        "separate-review",
      ],
    },
    decision: "campaign-capacity-no-go",
    authority: {
      offlinePreregistrationPackageAuthorized: false,
      corpusMaterializationAuthorized: false,
      externalRegistrationAuthorized: false,
      credentialsAuthorized: false,
      providerCallsAuthorized: false,
      liveExecutionAuthorized: false,
    },
  });
  if (!body.success) return invalid("M9b.7 report body is invalid.");
  const reportDigest = await digestValue(body.data);
  return reportDigest.ok
    ? {
        ok: true,
        value: m9b7CapacityReportSchema.parse({
          ...body.data,
          reportDigest: reportDigest.value,
        }),
      }
    : reportDigest;
}

export async function prepareM9b7CampaignCapacityReview(
  input: Readonly<{
    preparationInput: M9b3PreparationInput;
    preparation: M9b3Preparation;
    adapterIdentities: M9b5IdentityProfile;
    modelLimits: M9b7ModelLimits;
    hardCapToken?: M9b6VerifiedHardCapToken | undefined;
  }>,
): Promise<
  Result<
    Readonly<{
      report: M9b7CapacityReport;
      token: M9b7CapacityToken;
      alternativeToken: M9b7AlternativeToken;
    }>,
    Diagnostic
  >
> {
  const report = await deriveReport(input);
  const preparationInputBytes = canonicalizeJson(input.preparationInput);
  const preparationBytes = canonicalizeJson(input.preparation);
  const adapterIdentityBytes = canonicalizeJson(input.adapterIdentities);
  const modelLimitsBytes = canonicalizeJson(input.modelLimits);
  if (
    !report.ok ||
    !preparationInputBytes.ok ||
    !preparationBytes.ok ||
    !adapterIdentityBytes.ok ||
    !modelLimitsBytes.ok
  )
    return report.ok
      ? invalid("M9b.7 trusted review inputs are noncanonical.")
      : report;
  const capability = Object.freeze({});
  const alternativeCapability = Object.freeze({});
  trustedReviews.set(capability, {
    preparationInputBytes: preparationInputBytes.value,
    preparationBytes: preparationBytes.value,
    adapterIdentityBytes: adapterIdentityBytes.value,
    modelLimitsBytes: modelLimitsBytes.value,
    hardCapToken: input.hardCapToken,
  });
  const alternativeBytes = canonicalizeJson(report.value.alternative);
  if (!alternativeBytes.ok)
    return invalid("M9b.7 alternative design is noncanonical.");
  trustedAlternatives.set(alternativeCapability, alternativeBytes.value);
  return {
    ok: true,
    value: {
      report: report.value,
      token: { capability },
      alternativeToken: { capability: alternativeCapability },
    },
  };
}

async function trustedReport(
  token: M9b7CapacityToken,
): Promise<Result<M9b7CapacityReport, Diagnostic>> {
  const trusted = trustedReviews.get(token.capability);
  if (trusted === undefined) return invalid("Unknown M9b.7 capacity token.");
  const values = [
    parseJson(trusted.preparationInputBytes),
    parseJson(trusted.preparationBytes),
    parseJson(trusted.adapterIdentityBytes),
    parseJson(trusted.modelLimitsBytes),
  ];
  if (values.some((value) => !value.ok))
    return invalid("M9b.7 trusted input bytes cannot be decoded.");
  const [preparationInput, preparation, identities, limits] = values;
  if (
    preparationInput === undefined ||
    preparation === undefined ||
    identities === undefined ||
    limits === undefined ||
    !preparationInput.ok ||
    !preparation.ok ||
    !identities.ok ||
    !limits.ok
  )
    return invalid("M9b.7 trusted input decoding is incomplete.");
  const parsedIdentities = m9b5IdentityProfileSchema.safeParse(
    identities.value,
  );
  if (!parsedIdentities.success)
    return invalid("M9b.7 trusted adapter identity bytes are invalid.");
  return deriveReport({
    preparationInput: preparationInput.value,
    preparation: preparation.value,
    adapterIdentities: parsedIdentities.data,
    modelLimits: limits.value,
    hardCapToken: trusted.hardCapToken,
  });
}

export async function verifyM9b7CampaignCapacityReview(
  token: M9b7CapacityToken,
  value: unknown,
): Promise<Result<M9b7CapacityReport, Diagnostic>> {
  const parsed = m9b7CapacityReportSchema.safeParse(value);
  const rederived = await trustedReport(token);
  return parsed.success &&
    rederived.ok &&
    canonicalEqual(parsed.data, rederived.value)
    ? rederived
    : invalid(
        "M9b.7 capacity report failed complete zero-effect rederivation.",
      );
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
    protocol: z.literal("lachesis-m9b7-capacity-progression-snapshot/1"),
    reportDigest: digestSchema,
    alternativeDesignDigest: digestSchema,
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
export type M9b7ProgressionSnapshot = z.infer<typeof progressionSnapshotSchema>;

const gateBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b7-completion-safety-gate/1"),
    reportDigest: digestSchema,
    alternativeDesignDigest: digestSchema,
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
export const m9b7CompletionSafetyGateSchema = gateBodySchema
  .unwrap()
  .safeExtend({ gateDigest: digestSchema })
  .readonly();
export type M9b7CompletionSafetyGate = z.infer<
  typeof m9b7CompletionSafetyGateSchema
>;

function alternativeForToken(
  token: M9b7AlternativeToken,
): Result<z.infer<typeof alternativeSchema>, Diagnostic> {
  const bytes = trustedAlternatives.get(token.capability);
  if (bytes === undefined) return invalid("Unknown M9b.7 alternative token.");
  const decoded = parseJson(bytes);
  const parsed = decoded.ok
    ? alternativeSchema.safeParse(decoded.value)
    : undefined;
  return parsed?.success === true
    ? { ok: true, value: parsed.data }
    : invalid("Invalid M9b.7 alternative capability.");
}

function expectedCommittedPairs(snapshot: M9b7ProgressionSnapshot): number {
  return (
    snapshot.completedProbePairs +
    snapshot.completedPrimaryPairs +
    (snapshot.activePair === null ? 0 : 1)
  );
}

function nextArmForActivePair(
  pair: z.infer<typeof activePairSchema>,
): "discovered-program" | "static-one-shot" | undefined {
  if (pair.completedArms.length === 0) return pair.firstArm;
  const completed = pair.completedArms[0];
  return completed === pair.firstArm
    ? pair.firstArm === "discovered-program"
      ? "static-one-shot"
      : "discovered-program"
    : undefined;
}

async function deriveGate(
  report: M9b7CapacityReport,
  alternative: z.infer<typeof alternativeSchema>,
  input: unknown,
): Promise<Result<M9b7CompletionSafetyGate, Diagnostic>> {
  const snapshot = progressionSnapshotSchema.safeParse(input);
  const alternativeDigest = await digestValue(alternative);
  if (!snapshot.success || !alternativeDigest.ok)
    return invalid("Invalid M9b.7 progression input.");
  const value = snapshot.data;
  const perPair = report.totals.perPair.maximumCostUsdMicros;
  const committedPairs = expectedCommittedPairs(value);
  const expectedCommitted = safeMultiply(committedPairs, perPair);
  const expectedCharged =
    expectedCommitted === undefined
      ? undefined
      : safeAdd([expectedCommitted, value.overageExcessChargeUsdMicros]);
  const remainingCampaignPairs = TOTAL_PAIRS - committedPairs;
  const remainingCampaign = safeMultiply(remainingCampaignPairs, perPair);
  const trustedHardCap =
    report.hardCap.status === "verified-offline-capability"
      ? report.hardCap.remainingUsdMicros
      : 0;
  const usableCapacity = Math.min(
    alternative.requiredCampaignCapUsdMicros,
    trustedHardCap,
  );
  const available = usableCapacity - value.committedCostUsdMicros;
  let authorized = false;
  let action: z.infer<typeof gateBodySchema>["action"] =
    "reject-inconsistent-state";
  let population: "probe" | "primary" | null = null;
  let pairOrdinal: number | null = null;
  let nextArm: "discovered-program" | "static-one-shot" | null = null;
  let remainingPhase = 0;
  const active = value.activePair;
  const activePopulationValid =
    active === null ||
    (active.population === "probe"
      ? active.pairOrdinal === value.completedProbePairs &&
        value.completedPrimaryPairs === 0
      : active.pairOrdinal === value.completedPrimaryPairs &&
        value.completedProbePairs === PROBE_PAIRS &&
        value.probeDecision === "pass");
  const consistent =
    value.reportDigest === report.reportDigest &&
    value.alternativeDesignDigest === alternativeDigest.value &&
    expectedCharged !== undefined &&
    value.committedCostUsdMicros === expectedCharged &&
    available >= 0 &&
    remainingCampaign !== undefined &&
    activePopulationValid &&
    (value.terminalHalt === "overage" ||
      value.overageExcessChargeUsdMicros === 0) &&
    !(
      value.completedProbePairs < PROBE_PAIRS && value.completedPrimaryPairs > 0
    );
  if (!consistent) {
    action = "reject-inconsistent-state";
  } else if (value.outstandingReservations > 1) {
    action = "reject-concurrency";
  } else if (value.terminalHalt === "ambiguous") {
    action = "halt-ambiguous";
  } else if (value.terminalHalt === "overage") {
    action = "halt-overage";
  } else if (active !== null) {
    population = active.population;
    pairOrdinal = active.pairOrdinal;
    nextArm = nextArmForActivePair(active) ?? null;
    const populationPairs =
      active.population === "probe" ? PROBE_PAIRS : PRIMARY_PAIRS;
    const completed =
      active.population === "probe"
        ? value.completedProbePairs
        : value.completedPrimaryPairs;
    remainingPhase = (populationPairs - completed - 1) * perPair;
    if (nextArm !== null && value.outstandingReservations === 0) {
      authorized = true;
      action =
        active.population === "probe"
          ? "resume-probe-pair"
          : "resume-primary-pair";
    }
  } else if (value.completedProbePairs < PROBE_PAIRS) {
    population = "probe";
    pairOrdinal = value.completedProbePairs;
    nextArm = pairOrdinal % 2 === 0 ? "discovered-program" : "static-one-shot";
    remainingPhase = (PROBE_PAIRS - value.completedProbePairs) * perPair;
    if (available >= remainingPhase && value.outstandingReservations === 0) {
      authorized = true;
      action = "start-probe-pair";
    } else action = "reject-capacity";
  } else if (value.probeDecision === "not-evaluated") {
    action = "await-probe-decision";
  } else if (value.probeDecision === "fail") {
    action = "reject-capacity";
  } else if (value.completedPrimaryPairs < PRIMARY_PAIRS) {
    population = "primary";
    pairOrdinal = value.completedPrimaryPairs;
    nextArm = pairOrdinal % 2 === 0 ? "static-one-shot" : "discovered-program";
    remainingPhase = (PRIMARY_PAIRS - value.completedPrimaryPairs) * perPair;
    if (available >= remainingPhase && value.outstandingReservations === 0) {
      authorized = true;
      action = "start-primary-pair";
    } else action = "reject-capacity";
  } else {
    action = "campaign-complete";
  }
  const body = gateBodySchema.parse({
    protocol: "lachesis-m9b7-completion-safety-gate/1",
    reportDigest: report.reportDigest,
    alternativeDesignDigest: alternativeDigest.value,
    snapshot: value,
    authorized,
    action,
    population,
    pairOrdinal,
    nextArm,
    remainingPhaseCostUsdMicros: remainingPhase,
    remainingCampaignCostUsdMicros: remainingCampaign ?? 0,
    availableCapacityUsdMicros: Math.max(0, available),
    providerEffects: 0,
  });
  const gateDigest = await digestValue(body);
  return gateDigest.ok
    ? {
        ok: true,
        value: m9b7CompletionSafetyGateSchema.parse({
          ...body,
          gateDigest: gateDigest.value,
        }),
      }
    : gateDigest;
}

export async function reviewM9b7CompletionSafety(
  input: Readonly<{
    capacityToken: M9b7CapacityToken;
    alternativeToken: M9b7AlternativeToken;
    snapshot: M9b7ProgressionSnapshot;
  }>,
): Promise<Result<M9b7CompletionSafetyGate, Diagnostic>> {
  const report = await trustedReport(input.capacityToken);
  const alternative = alternativeForToken(input.alternativeToken);
  return report.ok && alternative.ok
    ? deriveGate(report.value, alternative.value, input.snapshot)
    : invalid("M9b.7 completion gate lacks trusted capacity inputs.");
}

export async function verifyM9b7CompletionSafety(
  input: Readonly<{
    capacityToken: M9b7CapacityToken;
    alternativeToken: M9b7AlternativeToken;
    snapshot: M9b7ProgressionSnapshot;
    gate: unknown;
  }>,
): Promise<Result<M9b7CompletionSafetyGate, Diagnostic>> {
  const parsed = m9b7CompletionSafetyGateSchema.safeParse(input.gate);
  const rederived = await reviewM9b7CompletionSafety(input);
  return parsed.success &&
    rederived.ok &&
    canonicalEqual(parsed.data, rederived.value)
    ? rederived
    : invalid("M9b.7 completion gate failed zero-effect rederivation.");
}
