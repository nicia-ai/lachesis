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
  executeM9b4EffectAttempt,
  inspectM9b4EffectLedger,
  M9B4_EFFECT_LEDGER_PROTOCOL,
  type M9b4AtomicPersistence,
  m9b4AttemptSchema,
  type M9b4Campaign,
  m9b4CampaignSchema,
  type M9b4ControllerFailure,
  type M9b4ExecutionResult,
  type M9b4TransportSession,
  prepareM9b4Attempt,
  prepareM9b4Campaign,
} from "../../generator/src/m9b4-effect-ledger.js";
import {
  M9B5_OPENAI_RESPONSES_PROTOCOL,
  type M9b5ConformanceVector,
  m9b5ConformanceVectorSchema,
  validateM9b5ConformanceVector,
} from "../src/m9b5-openai-responses.js";

export const M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL = Object.freeze({
  id: "lachesis-m9b6-conservative-pre-dispatch-accounting",
  version: "1.0.0",
  visibility: "private-offline-preparation-only" as const,
  effectLedger: `${M9B4_EFFECT_LEDGER_PROTOCOL.id}@${M9B4_EFFECT_LEDGER_PROTOCOL.version}`,
  adapter: `${M9B5_OPENAI_RESPONSES_PROTOCOL.id}@${M9B5_OPENAI_RESPONSES_PROTOCOL.version}`,
  decision:
    "conservative-accounting-go-for-offline-campaign-preparation" as const,
  tokenizerClaim: "no-exact-provider-tokenizer-or-framing-claim" as const,
  claimBoundary:
    "offline accounting and intercepted-transport evidence only; no corpus, credential, provider access, preregistration, probe, live execution, or superiority claim",
});

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z.string().min(1).max(160);
const artifactIdentitySchema = z
  .strictObject({
    id: identifierSchema,
    version: identifierSchema,
    artifactDigest: digestSchema,
  })
  .readonly();
const providerIdentitySchema = artifactIdentitySchema;
const projectIdentitySchema = artifactIdentitySchema
  .unwrap()
  .safeExtend({ providerId: identifierSchema })
  .readonly();

const hardCapControlPlaneSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b6-offline-hard-cap-observation/1"),
    provider: providerIdentitySchema,
    project: projectIdentitySchema,
    control: z.enum(["hard", "soft-alert"]),
    currency: z.literal("USD"),
    hardCapUsdMicros: z.number().int().positive(),
    trackedSpendUsdMicros: z.number().int().nonnegative(),
    remainingUsdMicros: z.number().int().nonnegative(),
    observedAtMs: z.number().int().nonnegative(),
    expiresAtMs: z.number().int().positive(),
    enforcement: z
      .strictObject({
        atLimit: z.literal("429-insufficient_quota"),
        propagation: z.literal("not-instantaneous"),
        documentedOvershootBound: z.literal("unknown"),
      })
      .readonly(),
  })
  .superRefine((value, context) => {
    const sum = value.trackedSpendUsdMicros + value.remainingUsdMicros;
    if (
      !Number.isSafeInteger(sum) ||
      sum !== value.hardCapUsdMicros ||
      value.expiresAtMs <= value.observedAtMs ||
      value.project.providerId !== value.provider.id
    )
      context.addIssue({
        code: "custom",
        message: "M9b.6 hard-cap observation is arithmetically inconsistent.",
      });
  })
  .readonly();

const hardCapReceiptBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b6-verified-hard-cap-receipt/1"),
    provider: providerIdentitySchema,
    project: projectIdentitySchema,
    currency: z.literal("USD"),
    hardCapUsdMicros: z.number().int().positive(),
    trackedSpendUsdMicros: z.number().int().nonnegative(),
    remainingUsdMicros: z.number().int().nonnegative(),
    observedAtMs: z.number().int().nonnegative(),
    expiresAtMs: z.number().int().positive(),
    verificationArtifact: artifactIdentitySchema,
    canonicalObservationBytes: z.string().min(1).max(1_048_576),
    observationDigest: digestSchema,
    providerEnforcement: z.literal(
      "hard-cap-429-but-propagation-not-instantaneous",
    ),
    providerOvershootBound: z.literal("unknown"),
  })
  .readonly();
export const m9b6HardCapReceiptSchema = hardCapReceiptBodySchema
  .unwrap()
  .safeExtend({ receiptDigest: digestSchema })
  .readonly();
export type M9b6HardCapReceipt = z.infer<typeof m9b6HardCapReceiptSchema>;

export type M9b6VerifiedHardCapToken = Readonly<{ capability: object }>;
const verifiedHardCaps = new WeakMap<object, string>();

const matchedArmEnvelopeSchema = z
  .strictObject({
    arm: z.enum(["discovered-program", "static-one-shot"]),
    maximumCanonicalRequestBytes: z.number().int().positive(),
    maximumAggregateModelCalls: z.number().int().positive(),
    maximumAggregateOutputTokens: z.number().int().positive(),
    reasoningEffort: z.literal("none"),
    maximumRetrievalEvidenceBytes: z.number().int().nonnegative(),
    maximumModelWallClockMs: z.number().int().positive(),
    maximumAttempts: z.number().int().positive(),
    maximumCostUsdMicros: z.number().int().positive(),
  })
  .readonly();
const scientificEnvelopeSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b6-scientific-envelope/1"),
    comparisonDigest: digestSchema,
    model: artifactIdentitySchema
      .unwrap()
      .safeExtend({ providerId: identifierSchema })
      .readonly(),
    arms: matchedArmEnvelopeSchema.array().length(2).readonly(),
    armOrder: z
      .enum(["discovered-program", "static-one-shot"])
      .array()
      .length(2)
      .readonly(),
    inclusionRule: z.literal(
      "all-first-attempt-terminal-records-independent-of-reported-token-usage",
    ),
    matchingRule: z.literal(
      "equal-controller-envelopes-not-exact-cross-arm-request-byte-equality",
    ),
  })
  .superRefine((value, context) => {
    const arms = new Set(value.arms.map((entry) => entry.arm));
    const order = new Set(value.armOrder);
    const [first, second] = value.arms;
    if (
      arms.size !== 2 ||
      order.size !== 2 ||
      first === undefined ||
      second === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "M9b.6 arms are incomplete.",
      });
      return;
    }
    const { arm: _firstArm, ...firstEnvelope } = first;
    const { arm: _secondArm, ...secondEnvelope } = second;
    void _firstArm;
    void _secondArm;
    const left = canonicalizeJson(firstEnvelope);
    const right = canonicalizeJson(secondEnvelope);
    if (!left.ok || !right.ok || left.value !== right.value)
      context.addIssue({
        code: "custom",
        message: "M9b.6 scientific arm envelopes must be exactly equal.",
      });
  })
  .readonly();
export type M9b6ScientificEnvelope = z.infer<typeof scientificEnvelopeSchema>;
export type M9b6FrozenScientificEnvelopeToken = Readonly<{
  capability: object;
}>;
const frozenScientificEnvelopes = new WeakMap<object, string>();

const modelLimitSchema = z
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
        message: "M9b.6 model limits do not form the frozen context window.",
      });
  })
  .readonly();

const campaignBodySchema = z
  .strictObject({
    protocol: z.literal(M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL.id),
    version: z.literal(M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL.version),
    campaignId: identifierSchema,
    m9b4Campaign: m9b4CampaignSchema,
    hardCapReceipt: m9b6HardCapReceiptSchema,
    hardCapReceiptDigest: digestSchema,
    campaignCapUsdMicros: z.number().int().positive(),
    maximumRequestCount: z.number().int().positive(),
    maximumConcurrency: z.literal(1),
    automaticRetryLimit: z.literal(0),
    activationTimeMs: z.number().int().nonnegative(),
    modelLimits: modelLimitSchema,
    scientificEnvelope: scientificEnvelopeSchema,
    scientificEnvelopeDigest: digestSchema,
    accountingBoundary: z
      .strictObject({
        requestIdentity: z.literal("exact-canonical-json-sha256"),
        requestSize: z.literal("exact-utf8-bytes"),
        inputReservation: z.literal("conservative-full-model-input-maximum"),
        settlement: z.literal("exact-provider-reported-usage-classes"),
        hiddenFraming: z.literal("unknown-but-within-model-input-maximum"),
        outerCap: z.literal("independently-verified-project-hard-cap"),
      })
      .readonly(),
  })
  .readonly();
export const m9b6CampaignSchema = campaignBodySchema
  .unwrap()
  .safeExtend({ campaignDigest: digestSchema })
  .readonly();
export type M9b6Campaign = z.infer<typeof m9b6CampaignSchema>;

const admittedRequestBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b6-admitted-request/1"),
    campaignDigest: digestSchema,
    vector: m9b5ConformanceVectorSchema,
    providerRequestDigest: digestSchema,
    providerRequestBytes: z.string().min(1).max(1_048_576),
    providerRequestUtf8Bytes: z.number().int().positive().max(1_048_576),
    modelInputTokenCeiling: z.number().int().positive(),
    quantityClassification: z
      .strictObject({
        providerRequestBytes: z.literal("exact"),
        modelInputTokenCeiling: z.literal("conservative"),
        providerFramingTokens: z.literal("unknown"),
        providerReportedUsage: z.literal("unknown-until-settlement"),
      })
      .readonly(),
    effectAttempt: m9b4AttemptSchema,
  })
  .readonly();
export const m9b6AdmittedRequestSchema = admittedRequestBodySchema
  .unwrap()
  .safeExtend({ admissionDigest: digestSchema })
  .readonly();
export type M9b6AdmittedRequest = z.infer<typeof m9b6AdmittedRequestSchema>;

export type M9b6Failure = Readonly<{
  kind: "validation" | "budget" | "storage" | "campaign-halted";
  diagnostic: Diagnostic;
}>;

function invalid(message: string): Diagnostic {
  return diagnostic("REPLAY_REQUEST_MISMATCH", message);
}

function failure(
  kind: M9b6Failure["kind"],
  message: string,
): Result<never, M9b6Failure> {
  return { ok: false, error: { kind, diagnostic: invalid(message) } };
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalizeJson(left);
  const rightBytes = canonicalizeJson(right);
  return leftBytes.ok && rightBytes.ok && leftBytes.value === rightBytes.value;
}

function capForToken(
  token: M9b6VerifiedHardCapToken,
): M9b6HardCapReceipt | undefined {
  const bytes = verifiedHardCaps.get(token.capability);
  const decoded = bytes === undefined ? undefined : parseJson(bytes);
  const parsed = decoded?.ok
    ? m9b6HardCapReceiptSchema.safeParse(decoded.value)
    : undefined;
  return parsed?.success === true ? parsed.data : undefined;
}

function scientificEnvelopeForToken(
  token: M9b6FrozenScientificEnvelopeToken,
): M9b6ScientificEnvelope | undefined {
  const bytes = frozenScientificEnvelopes.get(token.capability);
  const decoded = bytes === undefined ? undefined : parseJson(bytes);
  const parsed = decoded?.ok
    ? scientificEnvelopeSchema.safeParse(decoded.value)
    : undefined;
  return parsed?.success === true ? parsed.data : undefined;
}

export function freezeM9b6ScientificEnvelope(input: unknown): Result<
  Readonly<{
    envelope: M9b6ScientificEnvelope;
    token: M9b6FrozenScientificEnvelopeToken;
  }>,
  M9b6Failure
> {
  const parsed = scientificEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    return failure("validation", "Invalid M9b.6 scientific envelope.");
  const bytes = canonicalizeJson(parsed.data);
  if (!bytes.ok)
    return failure("validation", "M9b.6 scientific envelope is not canonical.");
  const capability = Object.freeze({});
  frozenScientificEnvelopes.set(capability, bytes.value);
  return { ok: true, value: { envelope: parsed.data, token: { capability } } };
}

export async function acceptM9b6OfflineHardCapObservation(
  input: Readonly<{
    canonicalObservationBytes: string;
    expectedProvider: z.infer<typeof providerIdentitySchema>;
    expectedProject: z.infer<typeof projectIdentitySchema>;
    expectedCurrency: string;
    verificationArtifact: z.infer<typeof artifactIdentitySchema>;
    nowMs: number;
  }>,
): Promise<
  Result<
    Readonly<{
      receipt: M9b6HardCapReceipt;
      token: M9b6VerifiedHardCapToken;
    }>,
    M9b6Failure
  >
> {
  const parsedJson = parseJson(input.canonicalObservationBytes);
  const parsed = parsedJson.ok
    ? hardCapControlPlaneSchema.safeParse(parsedJson.value)
    : undefined;
  const canonical =
    parsed?.success === true ? canonicalizeJson(parsed.data) : undefined;
  const observationDigest =
    parsed?.success === true ? await digestValue(parsed.data) : undefined;
  if (
    parsed?.success !== true ||
    canonical?.ok !== true ||
    canonical.value !== input.canonicalObservationBytes ||
    observationDigest?.ok !== true ||
    parsed.data.control !== "hard" ||
    parsed.data.currency !== input.expectedCurrency ||
    !canonicalEqual(parsed.data.provider, input.expectedProvider) ||
    !canonicalEqual(parsed.data.project, input.expectedProject) ||
    !artifactIdentitySchema.safeParse(input.verificationArtifact).success ||
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < parsed.data.observedAtMs ||
    input.nowMs >= parsed.data.expiresAtMs
  )
    return failure(
      "validation",
      "M9b.6 hard-cap observation is absent, soft, stale, noncanonical, or cross-bound.",
    );
  const body = hardCapReceiptBodySchema.parse({
    protocol: "lachesis-m9b6-verified-hard-cap-receipt/1",
    provider: parsed.data.provider,
    project: parsed.data.project,
    currency: parsed.data.currency,
    hardCapUsdMicros: parsed.data.hardCapUsdMicros,
    trackedSpendUsdMicros: parsed.data.trackedSpendUsdMicros,
    remainingUsdMicros: parsed.data.remainingUsdMicros,
    observedAtMs: parsed.data.observedAtMs,
    expiresAtMs: parsed.data.expiresAtMs,
    verificationArtifact: input.verificationArtifact,
    canonicalObservationBytes: canonical.value,
    observationDigest: observationDigest.value,
    providerEnforcement: "hard-cap-429-but-propagation-not-instantaneous",
    providerOvershootBound: "unknown",
  });
  const receiptDigest = await digestValue(body);
  if (!receiptDigest.ok)
    return failure("validation", "M9b.6 hard-cap receipt cannot be digested.");
  const receipt = m9b6HardCapReceiptSchema.parse({
    ...body,
    receiptDigest: receiptDigest.value,
  });
  const receiptBytes = canonicalizeJson(receipt);
  if (!receiptBytes.ok)
    return failure("validation", "M9b.6 hard-cap receipt is not canonical.");
  const capability = Object.freeze({});
  verifiedHardCaps.set(capability, receiptBytes.value);
  return { ok: true, value: { receipt, token: { capability } } };
}

async function validatedM9b4Campaign(
  input: unknown,
): Promise<M9b4Campaign | undefined> {
  const candidate = m9b4CampaignSchema.safeParse(input);
  if (!candidate.success) return undefined;
  const rebuilt = await prepareM9b4Campaign({
    campaignId: candidate.data.campaignId,
    budgetEnvelope: candidate.data.budgetEnvelope,
  });
  return rebuilt.ok && canonicalEqual(rebuilt.value, candidate.data)
    ? rebuilt.value
    : undefined;
}

async function validateCampaign(
  input: unknown,
  hardCapToken: M9b6VerifiedHardCapToken,
  scientificEnvelopeToken: M9b6FrozenScientificEnvelopeToken,
  nowMs: number,
): Promise<Result<M9b6Campaign, M9b6Failure>> {
  const parsed = m9b6CampaignSchema.safeParse(input);
  const trustedCap = capForToken(hardCapToken);
  const trustedEnvelope = scientificEnvelopeForToken(scientificEnvelopeToken);
  if (
    !parsed.success ||
    trustedCap === undefined ||
    trustedEnvelope === undefined
  )
    return failure("validation", "Invalid or untrusted M9b.6 campaign.");
  const m9b4Campaign = await validatedM9b4Campaign(parsed.data.m9b4Campaign);
  const { campaignDigest: _campaignDigest, ...body } = parsed.data;
  void _campaignDigest;
  const campaignDigest = await digestValue(body);
  const hardCapDigest = await digestValue(parsed.data.hardCapReceipt);
  const scientificEnvelopeDigest = await digestValue(
    parsed.data.scientificEnvelope,
  );
  const providerCap = parsed.data.m9b4Campaign.budgetEnvelope.providers[0];
  if (
    m9b4Campaign === undefined ||
    !campaignDigest.ok ||
    !hardCapDigest.ok ||
    !scientificEnvelopeDigest.ok ||
    parsed.data.campaignDigest !== campaignDigest.value ||
    !canonicalEqual(parsed.data.hardCapReceipt, trustedCap) ||
    parsed.data.hardCapReceiptDigest !== hardCapDigest.value ||
    !canonicalEqual(parsed.data.scientificEnvelope, trustedEnvelope) ||
    parsed.data.scientificEnvelopeDigest !== scientificEnvelopeDigest.value ||
    nowMs < parsed.data.activationTimeMs ||
    nowMs >= trustedCap.expiresAtMs ||
    parsed.data.campaignCapUsdMicros > trustedCap.remainingUsdMicros ||
    parsed.data.m9b4Campaign.budgetEnvelope.maximumCostUsdMicros >
      parsed.data.campaignCapUsdMicros ||
    parsed.data.m9b4Campaign.budgetEnvelope.maximumAttempts >
      parsed.data.maximumRequestCount ||
    providerCap === undefined ||
    !canonicalEqual(providerCap.provider, trustedCap.provider) ||
    !canonicalEqual(
      parsed.data.modelLimits.model,
      parsed.data.scientificEnvelope.model,
    )
  )
    return failure(
      "validation",
      "M9b.6 campaign identities, cap capacity, model limits, or activation differ.",
    );
  return { ok: true, value: parsed.data };
}

export async function prepareM9b6Campaign(
  input: Readonly<{
    campaignId: string;
    m9b4Campaign: M9b4Campaign;
    hardCapToken: M9b6VerifiedHardCapToken;
    scientificEnvelopeToken: M9b6FrozenScientificEnvelopeToken;
    campaignCapUsdMicros: number;
    maximumRequestCount: number;
    activationTimeMs: number;
    modelLimits: z.input<typeof modelLimitSchema>;
  }>,
): Promise<Result<M9b6Campaign, M9b6Failure>> {
  const trustedCap = capForToken(input.hardCapToken);
  const trustedEnvelope = scientificEnvelopeForToken(
    input.scientificEnvelopeToken,
  );
  const parsedLimits = modelLimitSchema.safeParse(input.modelLimits);
  if (
    trustedCap === undefined ||
    trustedEnvelope === undefined ||
    !parsedLimits.success
  )
    return failure("validation", "Invalid M9b.6 campaign preparation input.");
  const hardCapReceiptDigest = await digestValue(trustedCap);
  const scientificEnvelopeDigest = await digestValue(trustedEnvelope);
  if (!hardCapReceiptDigest.ok || !scientificEnvelopeDigest.ok)
    return failure("validation", "M9b.6 campaign inputs cannot be digested.");
  const body = campaignBodySchema.safeParse({
    protocol: M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL.id,
    version: M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL.version,
    campaignId: input.campaignId,
    m9b4Campaign: input.m9b4Campaign,
    hardCapReceipt: trustedCap,
    hardCapReceiptDigest: hardCapReceiptDigest.value,
    campaignCapUsdMicros: input.campaignCapUsdMicros,
    maximumRequestCount: input.maximumRequestCount,
    maximumConcurrency: 1,
    automaticRetryLimit: 0,
    activationTimeMs: input.activationTimeMs,
    modelLimits: parsedLimits.data,
    scientificEnvelope: trustedEnvelope,
    scientificEnvelopeDigest: scientificEnvelopeDigest.value,
    accountingBoundary: {
      requestIdentity: "exact-canonical-json-sha256",
      requestSize: "exact-utf8-bytes",
      inputReservation: "conservative-full-model-input-maximum",
      settlement: "exact-provider-reported-usage-classes",
      hiddenFraming: "unknown-but-within-model-input-maximum",
      outerCap: "independently-verified-project-hard-cap",
    },
  });
  if (!body.success)
    return failure("validation", "Invalid M9b.6 campaign body.");
  const campaignDigest = await digestValue(body.data);
  if (!campaignDigest.ok)
    return failure("validation", "M9b.6 campaign cannot be digested.");
  return validateCampaign(
    { ...body.data, campaignDigest: campaignDigest.value },
    input.hardCapToken,
    input.scientificEnvelopeToken,
    input.activationTimeMs,
  );
}

async function validateAdmittedRequest(
  campaign: M9b6Campaign,
  input: unknown,
): Promise<Result<M9b6AdmittedRequest, M9b6Failure>> {
  const parsed = m9b6AdmittedRequestSchema.safeParse(input);
  if (!parsed.success)
    return failure("validation", "Invalid M9b.6 admitted request.");
  const vector = await validateM9b5ConformanceVector(parsed.data.vector);
  if (!vector.ok)
    return failure(
      "validation",
      "M9b.6 request contains an invalid M9b.5 vector.",
    );
  const effectAttempt = await prepareM9b4Attempt(campaign.m9b4Campaign, {
    comparisonDigest: parsed.data.effectAttempt.comparisonDigest,
    arm: parsed.data.effectAttempt.arm,
    phase: parsed.data.effectAttempt.phase,
    callIndex: parsed.data.effectAttempt.callIndex,
    serializedRequest: parsed.data.effectAttempt.serializedRequest,
    requestDigest: parsed.data.effectAttempt.requestDigest,
    reservedInputTokenCeiling:
      parsed.data.effectAttempt.reservedInputTokenCeiling,
    provider: parsed.data.effectAttempt.provider,
    model: parsed.data.effectAttempt.model,
    tokenizer: parsed.data.effectAttempt.tokenizer,
    pricingSnapshot: parsed.data.effectAttempt.pricingSnapshot,
    reservation: parsed.data.effectAttempt.reservation,
  });
  const byteLength = new TextEncoder().encode(
    vector.value.providerRequestBytes,
  ).byteLength;
  const { admissionDigest: _admissionDigest, ...body } = parsed.data;
  void _admissionDigest;
  const admissionDigest = await digestValue(body);
  if (
    !effectAttempt.ok ||
    !admissionDigest.ok ||
    parsed.data.admissionDigest !== admissionDigest.value ||
    parsed.data.campaignDigest !== campaign.campaignDigest ||
    parsed.data.providerRequestBytes !== vector.value.providerRequestBytes ||
    parsed.data.providerRequestDigest !== vector.value.providerRequestDigest ||
    parsed.data.providerRequestUtf8Bytes !== byteLength ||
    parsed.data.modelInputTokenCeiling !==
      campaign.modelLimits.maximumInputTokens ||
    !canonicalEqual(parsed.data.effectAttempt, effectAttempt.value) ||
    parsed.data.effectAttempt.requestDigest !== vector.value.requestDigest ||
    parsed.data.effectAttempt.serializedRequest !==
      vector.value.serializedRequest ||
    parsed.data.effectAttempt.reservation.maximumOutputTokens !==
      vector.value.maximumOutputTokens
  )
    return failure(
      "validation",
      "M9b.6 admitted request bytes, identities, or reservation differ.",
    );
  return { ok: true, value: parsed.data };
}

export async function prepareM9b6AdmittedRequest(
  input: Readonly<{
    campaign: M9b6Campaign;
    hardCapToken: M9b6VerifiedHardCapToken;
    scientificEnvelopeToken: M9b6FrozenScientificEnvelopeToken;
    vector: M9b5ConformanceVector;
    maximumWallClockMs: number;
    nowMs: number;
  }>,
): Promise<Result<M9b6AdmittedRequest, M9b6Failure>> {
  const campaign = await validateCampaign(
    input.campaign,
    input.hardCapToken,
    input.scientificEnvelopeToken,
    input.nowMs,
  );
  const vector = await validateM9b5ConformanceVector(input.vector);
  if (!campaign.ok || !vector.ok)
    return failure(
      "validation",
      "M9b.6 campaign or request vector is invalid.",
    );
  const pricing = vector.value.identities.pricingSnapshot;
  const maximumInputRate = Math.max(
    pricing.inputUsdMicrosPerMillionTokens,
    pricing.cachedInputUsdMicrosPerMillionTokens,
    pricing.cacheWriteInputUsdMicrosPerMillionTokens,
  );
  const inputNumerator =
    BigInt(campaign.value.modelLimits.maximumInputTokens) *
    BigInt(maximumInputRate) *
    BigInt(
      campaign.value.modelLimits.maximumInputTokens >
        pricing.longContextThresholdTokens
        ? pricing.longContextInputMultiplierMicros
        : 1_000_000,
    );
  const outputNumerator =
    BigInt(vector.value.maximumOutputTokens) *
    BigInt(pricing.outputUsdMicrosPerMillionTokens) *
    BigInt(
      campaign.value.modelLimits.maximumInputTokens >
        pricing.longContextThresholdTokens
        ? pricing.longContextOutputMultiplierMicros
        : 1_000_000,
    );
  const numerator = inputNumerator + outputNumerator;
  const denominator = 1_000_000_000_000n;
  const maximumCost = (numerator + denominator - 1n) / denominator;
  if (maximumCost > BigInt(Number.MAX_SAFE_INTEGER))
    return failure("budget", "M9b.6 conservative reservation overflows.");
  const maximumCostUsdMicros = Number(maximumCost);
  const boundedAttempt = await prepareM9b4Attempt(campaign.value.m9b4Campaign, {
    comparisonDigest: vector.value.comparisonDigest,
    arm: vector.value.arm,
    phase: vector.value.phase,
    callIndex: vector.value.callIndex,
    serializedRequest: vector.value.serializedRequest,
    requestDigest: vector.value.requestDigest,
    reservedInputTokenCeiling: campaign.value.modelLimits.maximumInputTokens,
    provider: vector.value.identities.provider,
    model: vector.value.identities.model,
    tokenizer: vector.value.identities.tokenizer,
    pricingSnapshot: vector.value.identities.pricingSnapshot,
    reservation: {
      maximumInputTokens: campaign.value.modelLimits.maximumInputTokens,
      maximumOutputTokens: vector.value.maximumOutputTokens,
      maximumReasoningTokens: 0,
      maximumWallClockMs: input.maximumWallClockMs,
      maximumCostUsdMicros,
    },
  });
  const byteLength = new TextEncoder().encode(
    vector.value.providerRequestBytes,
  ).byteLength;
  const armEnvelope = campaign.value.scientificEnvelope.arms.find(
    (entry) => entry.arm === vector.value.arm,
  );
  if (
    !boundedAttempt.ok ||
    armEnvelope === undefined ||
    byteLength > armEnvelope.maximumCanonicalRequestBytes ||
    vector.value.maximumOutputTokens >
      campaign.value.modelLimits.maximumOutputTokens ||
    vector.value.maximumOutputTokens >
      armEnvelope.maximumAggregateOutputTokens ||
    maximumCostUsdMicros > armEnvelope.maximumCostUsdMicros
  )
    return failure(
      "budget",
      "M9b.6 request exceeds its exact byte or conservative resource envelope.",
    );
  const body = admittedRequestBodySchema.parse({
    protocol: "lachesis-m9b6-admitted-request/1",
    campaignDigest: campaign.value.campaignDigest,
    vector: vector.value,
    providerRequestDigest: vector.value.providerRequestDigest,
    providerRequestBytes: vector.value.providerRequestBytes,
    providerRequestUtf8Bytes: byteLength,
    modelInputTokenCeiling: campaign.value.modelLimits.maximumInputTokens,
    quantityClassification: {
      providerRequestBytes: "exact",
      modelInputTokenCeiling: "conservative",
      providerFramingTokens: "unknown",
      providerReportedUsage: "unknown-until-settlement",
    },
    effectAttempt: boundedAttempt.value,
  });
  const admissionDigest = await digestValue(body);
  if (!admissionDigest.ok)
    return failure("validation", "M9b.6 admission cannot be digested.");
  return validateAdmittedRequest(campaign.value, {
    ...body,
    admissionDigest: admissionDigest.value,
  });
}

function mapControllerFailure(
  result: Result<M9b4ExecutionResult, M9b4ControllerFailure>,
): Result<M9b4ExecutionResult, M9b6Failure> {
  return result.ok
    ? result
    : {
        ok: false,
        error: {
          kind: result.error.kind,
          diagnostic: result.error.diagnostic,
        },
      };
}

export async function executeM9b6AdmittedRequest(
  input: Readonly<{
    campaign: M9b6Campaign;
    hardCapToken: M9b6VerifiedHardCapToken;
    scientificEnvelopeToken: M9b6FrozenScientificEnvelopeToken;
    admittedRequest: unknown;
    persistence: M9b4AtomicPersistence;
    createSession: () => M9b4TransportSession;
    nowMs: number;
    signal?: AbortSignal | undefined;
  }>,
): Promise<Result<M9b4ExecutionResult, M9b6Failure>> {
  const campaign = await validateCampaign(
    input.campaign,
    input.hardCapToken,
    input.scientificEnvelopeToken,
    input.nowMs,
  );
  if (!campaign.ok) return campaign;
  const admitted = await validateAdmittedRequest(
    campaign.value,
    input.admittedRequest,
  );
  if (!admitted.ok) return admitted;
  const accounting = await inspectM9b4EffectLedger(
    campaign.value.m9b4Campaign,
    input.persistence,
  );
  if (!accounting.ok)
    return {
      ok: false,
      error: { kind: "storage", diagnostic: accounting.error },
    };
  const existing = accounting.value.attemptStates.find(
    (state) => state.attemptId === admitted.value.effectAttempt.attemptId,
  );
  if (accounting.value.progressionHalted && existing === undefined)
    return failure(
      "campaign-halted",
      "M9b.6 campaign progression stopped after ambiguity or provider overage.",
    );
  const projected =
    accounting.value.total.chargedCostUsdMicros +
    (existing === undefined
      ? admitted.value.effectAttempt.reservation.maximumCostUsdMicros
      : 0);
  if (
    !Number.isSafeInteger(projected) ||
    projected > campaign.value.campaignCapUsdMicros ||
    projected > campaign.value.hardCapReceipt.remainingUsdMicros
  )
    return failure(
      "budget",
      "M9b.6 consumed, ambiguous, and reserved charges exceed a bound cap.",
    );
  return mapControllerFailure(
    await executeM9b4EffectAttempt({
      campaign: campaign.value.m9b4Campaign,
      attempt: admitted.value.effectAttempt,
      persistence: input.persistence,
      createSession: input.createSession,
      signal: input.signal,
    }),
  );
}

export async function verifyM9b6ZeroEffectResume(
  input: Readonly<{
    campaign: M9b6Campaign;
    hardCapToken: M9b6VerifiedHardCapToken;
    scientificEnvelopeToken: M9b6FrozenScientificEnvelopeToken;
    admittedRequest: M9b6AdmittedRequest;
    persistence: M9b4AtomicPersistence;
    createSession: () => M9b4TransportSession;
    nowMs: number;
  }>,
): Promise<Result<M9b4ExecutionResult, M9b6Failure>> {
  const before = await inspectM9b4EffectLedger(
    input.campaign.m9b4Campaign,
    input.persistence,
  );
  if (!before.ok)
    return { ok: false, error: { kind: "storage", diagnostic: before.error } };
  const result = await executeM9b6AdmittedRequest(input);
  if (!result.ok) return result;
  const after = await inspectM9b4EffectLedger(
    input.campaign.m9b4Campaign,
    input.persistence,
  );
  return after.ok &&
    before.value.accountingDigest === after.value.accountingDigest &&
    result.value.resumed &&
    !result.value.transportInvoked
    ? result
    : failure(
        "validation",
        "M9b.6 zero-effect resume changed accounting or invoked transport.",
      );
}
