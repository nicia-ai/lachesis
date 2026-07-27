import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import { strictJsonValueSchema } from "./strict-json.js";

export const M9B4_EFFECT_LEDGER_PROTOCOL = Object.freeze({
  id: "lachesis-m9b4-offline-effect-ledger",
  version: "1.2.0",
  visibility: "internal-offline-controller-only" as const,
  retryPolicy:
    "exactly-one-transport-invocation-zero-automatic-retries" as const,
  crashPolicy:
    "dispatch-started-without-a-terminal-receipt-is-ambiguous-conservatively-charged-and-never-redispatched" as const,
  claimBoundary:
    "offline provider-neutral effect-accounting evidence only; no corpus, credential, provider adapter, provider call, preregistration, live authorization, or superiority claim",
});

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z.string().min(1).max(160);
const versionedIdentitySchema = z
  .strictObject({ id: identifierSchema, version: identifierSchema })
  .readonly();
const artifactIdentitySchema = versionedIdentitySchema
  .unwrap()
  .safeExtend({ artifactDigest: digestSchema })
  .readonly();
const providerIdentitySchema = artifactIdentitySchema;
const modelIdentitySchema = artifactIdentitySchema
  .unwrap()
  .safeExtend({ providerId: identifierSchema })
  .readonly();
const tokenizerIdentitySchema = artifactIdentitySchema
  .unwrap()
  .safeExtend({ providerId: identifierSchema })
  .readonly();
const pricingIdentitySchema = artifactIdentitySchema
  .unwrap()
  .safeExtend({
    providerId: identifierSchema,
    inputUsdMicrosPerMillionTokens: z.number().int().nonnegative(),
    cachedInputUsdMicrosPerMillionTokens: z.number().int().nonnegative(),
    cacheWriteInputUsdMicrosPerMillionTokens: z.number().int().nonnegative(),
    outputUsdMicrosPerMillionTokens: z.number().int().nonnegative(),
    reasoningUsdMicrosPerMillionTokens: z.number().int().nonnegative(),
    longContextThresholdTokens: z.number().int().positive(),
    longContextInputMultiplierMicros: z.number().int().min(1_000_000),
    longContextOutputMultiplierMicros: z.number().int().min(1_000_000),
  })
  .readonly();

export const m9b4ArmSchema = z.enum(["discovered-program", "static-one-shot"]);
export type M9b4Arm = z.infer<typeof m9b4ArmSchema>;

export const m9b4PhaseSchema = z.enum(["authoring", "execution", "evaluation"]);
export type M9b4Phase = z.infer<typeof m9b4PhaseSchema>;

const resourceCeilingSchema = z
  .strictObject({
    maximumInputTokens: z.number().int().nonnegative(),
    maximumOutputTokens: z.number().int().nonnegative(),
    maximumReasoningTokens: z.number().int().nonnegative(),
    maximumWallClockMs: z.number().int().nonnegative(),
    maximumCostUsdMicros: z.number().int().nonnegative(),
  })
  .readonly();
const providerCapSchema = resourceCeilingSchema
  .unwrap()
  .safeExtend({ provider: providerIdentitySchema })
  .readonly();
const phaseCapSchema = resourceCeilingSchema
  .unwrap()
  .safeExtend({ phase: m9b4PhaseSchema })
  .readonly();
const armCapSchema = resourceCeilingSchema
  .unwrap()
  .safeExtend({ arm: m9b4ArmSchema })
  .readonly();

const budgetEnvelopeSchema = z
  .strictObject({
    maximumAttempts: z.number().int().positive(),
    maximumConcurrentAttempts: z.literal(1),
    ...resourceCeilingSchema.unwrap().shape,
    providers: providerCapSchema.array().min(1).readonly(),
    phases: phaseCapSchema.array().length(3).readonly(),
    arms: armCapSchema.array().length(2).readonly(),
  })
  .superRefine((envelope, context) => {
    const providerKeys = envelope.providers.map(
      (cap) => `${cap.provider.id}@${cap.provider.version}`,
    );
    if (new Set(providerKeys).size !== providerKeys.length)
      context.addIssue({
        code: "custom",
        message: "M9b.4 provider caps must be unique.",
      });
    if (
      new Set(envelope.phases.map((cap) => cap.phase)).size !== 3 ||
      new Set(envelope.arms.map((cap) => cap.arm)).size !== 2
    )
      context.addIssue({
        code: "custom",
        message: "M9b.4 phase and arm caps must be complete and unique.",
      });
  })
  .readonly();

const campaignInputSchema = z
  .strictObject({
    campaignId: identifierSchema,
    budgetEnvelope: budgetEnvelopeSchema,
  })
  .readonly();
const campaignBodySchema = campaignInputSchema
  .unwrap()
  .safeExtend({
    protocol: z.literal("lachesis-m9b4-offline-effect-ledger-campaign/3"),
    budgetEnvelopeDigest: digestSchema,
  })
  .readonly();
export const m9b4CampaignSchema = campaignBodySchema
  .unwrap()
  .safeExtend({ campaignDigest: digestSchema })
  .readonly();
export type M9b4CampaignInput = z.infer<typeof campaignInputSchema>;
export type M9b4Campaign = z.infer<typeof m9b4CampaignSchema>;

const reservationInputSchema = z
  .strictObject({
    maximumInputTokens: z.number().int().nonnegative(),
    maximumOutputTokens: z.number().int().nonnegative(),
    maximumReasoningTokens: z.number().int().nonnegative(),
    maximumWallClockMs: z.number().int().positive(),
    maximumCostUsdMicros: z.number().int().nonnegative(),
  })
  .readonly();
const attemptInputSchema = z
  .strictObject({
    comparisonDigest: digestSchema,
    arm: m9b4ArmSchema,
    phase: m9b4PhaseSchema,
    callIndex: z.number().int().nonnegative(),
    serializedRequest: z.string().min(1).max(1_048_576),
    requestDigest: digestSchema,
    reservedInputTokenCeiling: z.number().int().nonnegative(),
    provider: providerIdentitySchema,
    model: modelIdentitySchema,
    tokenizer: tokenizerIdentitySchema,
    pricingSnapshot: pricingIdentitySchema,
    reservation: reservationInputSchema,
  })
  .readonly();
const attemptBodySchema = attemptInputSchema
  .unwrap()
  .safeExtend({
    protocol: z.literal("lachesis-m9b4-effect-attempt/3"),
    campaignDigest: digestSchema,
    budgetEnvelopeDigest: digestSchema,
    reservationDigest: digestSchema,
  })
  .readonly();
export const m9b4AttemptSchema = attemptBodySchema
  .unwrap()
  .safeExtend({ attemptId: digestSchema })
  .readonly();
export type M9b4AttemptInput = z.infer<typeof attemptInputSchema>;
export type M9b4Attempt = z.infer<typeof m9b4AttemptSchema>;

export const m9b4UsageSchema = z
  .strictObject({
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    cacheWriteInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    wallClockMs: z.number().int().nonnegative(),
    costUsdMicros: z.number().int().nonnegative(),
  })
  .readonly();
export type M9b4Usage = z.infer<typeof m9b4UsageSchema>;

const transportFailureSchema = z
  .strictObject({
    kind: z.enum([
      "provider-rejected",
      "provider-timeout",
      "provider-unavailable",
      "cancelled",
    ]),
    code: identifierSchema,
    message: z.string().min(1).max(2_048),
  })
  .readonly();
const transportSuccessSchema = z
  .strictObject({
    kind: z.literal("success"),
    output: strictJsonValueSchema,
    usage: m9b4UsageSchema,
  })
  .readonly();
const transportFailureResultSchema = z
  .strictObject({
    kind: z.literal("failure"),
    failure: transportFailureSchema,
    usage: m9b4UsageSchema,
  })
  .readonly();
const transportResultSchema = z.discriminatedUnion("kind", [
  transportSuccessSchema,
  transportFailureResultSchema,
]);

const receiptBindingShape = {
  attemptId: digestSchema,
  requestDigest: digestSchema,
  provider: providerIdentitySchema,
  model: modelIdentitySchema,
  tokenizer: tokenizerIdentitySchema,
  pricingSnapshot: pricingIdentitySchema,
  usage: m9b4UsageSchema,
};
const completedReceiptBodySchema = z
  .strictObject({
    ...receiptBindingShape,
    kind: z.literal("completed"),
    serializedOutput: z.string().min(1),
    outputDigest: digestSchema,
  })
  .readonly();
const completedReceiptSchema = completedReceiptBodySchema
  .unwrap()
  .safeExtend({ receiptDigest: digestSchema })
  .readonly();
const failedReceiptBodySchema = z
  .strictObject({
    ...receiptBindingShape,
    kind: z.literal("failed"),
    failure: transportFailureSchema,
  })
  .readonly();
const failedReceiptSchema = failedReceiptBodySchema
  .unwrap()
  .safeExtend({ receiptDigest: digestSchema })
  .readonly();

const settlementBodySchema = z
  .strictObject({
    attemptId: digestSchema,
    terminalEventDigest: digestSchema,
    terminal: z.enum(["completed", "failed", "overage", "ambiguous"]),
    accountingBasis: z.enum([
      "provider-reported",
      "provider-reported-overage",
      "authorized-conservative",
    ]),
    chargedUsage: m9b4UsageSchema.nullable(),
    chargedCostUsdMicros: z.number().int().nonnegative(),
  })
  .readonly();
const settlementSchema = settlementBodySchema
  .unwrap()
  .safeExtend({ settlementDigest: digestSchema })
  .readonly();

const preparedEventPayloadSchema = z
  .strictObject({ kind: z.literal("prepared"), attempt: m9b4AttemptSchema })
  .readonly();
const reservedEventPayloadSchema = z
  .strictObject({
    kind: z.literal("reserved"),
    attemptId: digestSchema,
    preparedEventDigest: digestSchema,
    reservationDigest: digestSchema,
  })
  .readonly();
const dispatchEventPayloadSchema = z
  .strictObject({
    kind: z.literal("dispatch-started"),
    attemptId: digestSchema,
    reservationEventDigest: digestSchema,
    transportInvocationLimit: z.literal(1),
    automaticRetryLimit: z.literal(0),
  })
  .readonly();
const completedEventPayloadSchema = z
  .strictObject({
    kind: z.literal("completed"),
    attemptId: digestSchema,
    dispatchEventDigest: digestSchema,
    receipt: completedReceiptSchema,
  })
  .readonly();
const failedEventPayloadSchema = z
  .strictObject({
    kind: z.literal("failed"),
    attemptId: digestSchema,
    dispatchEventDigest: digestSchema,
    receipt: failedReceiptSchema,
  })
  .readonly();
const overageReceiptBodySchema = z
  .strictObject({
    ...receiptBindingShape,
    kind: z.literal("overage"),
    reason: z.enum([
      "provider-input-framing-or-accounting-overage",
      "provider-output-reasoning-time-or-cost-overage",
    ]),
  })
  .readonly();
const overageReceiptSchema = overageReceiptBodySchema
  .unwrap()
  .safeExtend({ receiptDigest: digestSchema })
  .readonly();
const overageEventPayloadSchema = z
  .strictObject({
    kind: z.literal("overage"),
    attemptId: digestSchema,
    dispatchEventDigest: digestSchema,
    receipt: overageReceiptSchema,
  })
  .readonly();
const ambiguousEventPayloadSchema = z
  .strictObject({
    kind: z.literal("ambiguous"),
    attemptId: digestSchema,
    dispatchEventDigest: digestSchema,
    reason: z.enum([
      "interrupted-after-dispatch-started",
      "session-identity-mismatch",
      "transport-threw",
      "transport-outcome-invalid",
      "usage-missing-malformed-or-inconsistent",
    ]),
  })
  .readonly();
const reconciledEventPayloadSchema = z
  .strictObject({
    kind: z.literal("reconciled"),
    attemptId: digestSchema,
    settlement: settlementSchema,
  })
  .readonly();
const eventPayloadSchema = z.discriminatedUnion("kind", [
  preparedEventPayloadSchema,
  reservedEventPayloadSchema,
  dispatchEventPayloadSchema,
  completedEventPayloadSchema,
  failedEventPayloadSchema,
  overageEventPayloadSchema,
  ambiguousEventPayloadSchema,
  reconciledEventPayloadSchema,
]);
const eventChainShape = {
  index: z.number().int().nonnegative(),
  previousDigest: digestSchema.nullable(),
  digest: digestSchema,
};
const eventSchema = z.discriminatedUnion("kind", [
  preparedEventPayloadSchema.unwrap().safeExtend(eventChainShape).readonly(),
  reservedEventPayloadSchema.unwrap().safeExtend(eventChainShape).readonly(),
  dispatchEventPayloadSchema.unwrap().safeExtend(eventChainShape).readonly(),
  completedEventPayloadSchema.unwrap().safeExtend(eventChainShape).readonly(),
  failedEventPayloadSchema.unwrap().safeExtend(eventChainShape).readonly(),
  overageEventPayloadSchema.unwrap().safeExtend(eventChainShape).readonly(),
  ambiguousEventPayloadSchema.unwrap().safeExtend(eventChainShape).readonly(),
  reconciledEventPayloadSchema.unwrap().safeExtend(eventChainShape).readonly(),
]);
type M9b4LedgerEvent = z.infer<typeof eventSchema>;
type PreparedEvent = Extract<M9b4LedgerEvent, { kind: "prepared" }>;
type ReservedEvent = Extract<M9b4LedgerEvent, { kind: "reserved" }>;
type DispatchEvent = Extract<M9b4LedgerEvent, { kind: "dispatch-started" }>;
type CompletedEvent = Extract<M9b4LedgerEvent, { kind: "completed" }>;
type FailedEvent = Extract<M9b4LedgerEvent, { kind: "failed" }>;
type OverageEvent = Extract<M9b4LedgerEvent, { kind: "overage" }>;
type AmbiguousEvent = Extract<M9b4LedgerEvent, { kind: "ambiguous" }>;
type TerminalEvent =
  CompletedEvent | FailedEvent | OverageEvent | AmbiguousEvent;
type ReconciledEvent = Extract<M9b4LedgerEvent, { kind: "reconciled" }>;

type DerivedAttempt =
  | Readonly<{ state: "prepared"; prepared: PreparedEvent }>
  | Readonly<{
      state: "reserved";
      prepared: PreparedEvent;
      reserved: ReservedEvent;
    }>
  | Readonly<{
      state: "dispatch-started";
      prepared: PreparedEvent;
      reserved: ReservedEvent;
      dispatch: DispatchEvent;
    }>
  | Readonly<{
      state: "completed" | "failed" | "overage" | "ambiguous";
      prepared: PreparedEvent;
      reserved: ReservedEvent;
      dispatch: DispatchEvent;
      terminal: TerminalEvent;
    }>
  | Readonly<{
      state: "reconciled";
      prepared: PreparedEvent;
      reserved: ReservedEvent;
      dispatch: DispatchEvent;
      terminal: TerminalEvent;
      reconciled: ReconciledEvent;
    }>;

const ledgerSnapshotBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b4-effect-ledger-snapshot/3"),
    campaignDigest: digestSchema,
    events: eventSchema.array().readonly(),
  })
  .readonly();
export const m9b4InternalLedgerSnapshotSchema = ledgerSnapshotBodySchema
  .unwrap()
  .safeExtend({ ledgerDigest: digestSchema })
  .readonly();

export type M9b4AtomicPersistence = Readonly<{
  read: () => Promise<
    Result<
      Readonly<{ revision: string; content: string }> | undefined,
      Diagnostic
    >
  >;
  writeAtomic: (
    input: Readonly<{
      expectedRevision: string | null;
      content: string;
    }>,
  ) => Promise<Result<Readonly<{ revision: string }>, Diagnostic>>;
}>;

export type M9b4TransportSession = Readonly<{
  provider: z.infer<typeof providerIdentitySchema>;
  model: z.infer<typeof modelIdentitySchema>;
  tokenizer: z.infer<typeof tokenizerIdentitySchema>;
  pricingSnapshot: z.infer<typeof pricingIdentitySchema>;
  invoke: (
    input: Readonly<{
      attemptId: string;
      serializedRequest: string;
      requestDigest: string;
    }>,
    signal: AbortSignal,
  ) => Promise<unknown>;
}>;

export type M9b4ControllerFailure = Readonly<{
  kind: "validation" | "storage" | "budget";
  diagnostic: Diagnostic;
}>;

const accountingSliceSchema = z
  .strictObject({
    reservedAttempts: z.number().int().nonnegative(),
    ...resourceCeilingSchema.unwrap().shape,
    chargedInputTokens: z.number().int().nonnegative(),
    chargedUncachedInputTokens: z.number().int().nonnegative(),
    chargedCachedInputTokens: z.number().int().nonnegative(),
    chargedCacheWriteInputTokens: z.number().int().nonnegative(),
    chargedOutputTokens: z.number().int().nonnegative(),
    chargedReasoningTokens: z.number().int().nonnegative(),
    chargedWallClockMs: z.number().int().nonnegative(),
    chargedCostUsdMicros: z.number().int().nonnegative(),
    remainingInputTokens: z.number().int(),
    remainingOutputTokens: z.number().int(),
    remainingReasoningTokens: z.number().int(),
    remainingWallClockMs: z.number().int(),
    remainingCostUsdMicros: z.number().int(),
  })
  .readonly();
export const m9b4AccountingStatusSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b4-rederived-accounting/3"),
    campaignDigest: digestSchema,
    eventCount: z.number().int().nonnegative(),
    ledgerHead: digestSchema.nullable(),
    attempts: z.number().int().nonnegative(),
    attemptStates: z
      .strictObject({
        attemptId: digestSchema,
        requestDigest: digestSchema,
        arm: m9b4ArmSchema,
        phase: m9b4PhaseSchema,
        callIndex: z.number().int().nonnegative(),
        lifecycle: z.enum([
          "prepared",
          "reserved",
          "dispatch-started",
          "terminal",
          "reconciled",
        ]),
        terminal: z
          .enum(["completed", "failed", "overage", "ambiguous"])
          .nullable(),
      })
      .readonly()
      .array()
      .readonly(),
    terminalCounts: z
      .strictObject({
        completed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        overage: z.number().int().nonnegative(),
        ambiguous: z.number().int().nonnegative(),
      })
      .readonly(),
    progressionHalted: z.boolean(),
    total: accountingSliceSchema,
    providers: z
      .strictObject({
        provider: providerIdentitySchema,
        accounting: accountingSliceSchema,
      })
      .readonly()
      .array()
      .readonly(),
    phases: z
      .strictObject({
        phase: m9b4PhaseSchema,
        accounting: accountingSliceSchema,
      })
      .readonly()
      .array()
      .readonly(),
    arms: z
      .strictObject({
        arm: m9b4ArmSchema,
        accounting: accountingSliceSchema,
      })
      .readonly()
      .array()
      .readonly(),
    requests: z
      .strictObject({
        requestDigest: digestSchema,
        reservedAttempts: z.number().int().nonnegative(),
        chargedInputTokens: z.number().int().nonnegative(),
        chargedUncachedInputTokens: z.number().int().nonnegative(),
        chargedCachedInputTokens: z.number().int().nonnegative(),
        chargedCacheWriteInputTokens: z.number().int().nonnegative(),
        chargedOutputTokens: z.number().int().nonnegative(),
        chargedReasoningTokens: z.number().int().nonnegative(),
        chargedWallClockMs: z.number().int().nonnegative(),
        chargedCostUsdMicros: z.number().int().nonnegative(),
      })
      .readonly()
      .array()
      .readonly(),
    accountingDigest: digestSchema,
  })
  .readonly();
export type M9b4AccountingStatus = z.infer<typeof m9b4AccountingStatusSchema>;

export type M9b4ExecutionResult = Readonly<{
  protocol: typeof M9B4_EFFECT_LEDGER_PROTOCOL;
  attemptId: string;
  state: "reconciled";
  terminal: "completed" | "failed" | "overage" | "ambiguous";
  successful: boolean;
  scorable: boolean;
  repairable: false;
  resumed: boolean;
  transportInvoked: boolean;
  accounting: M9b4AccountingStatus;
}>;

type LoadedLedger = Readonly<{
  revision: string | null;
  events: ReadonlyArray<M9b4LedgerEvent>;
  attempts: ReadonlyMap<string, DerivedAttempt>;
}>;

function invalid(message: string): Diagnostic {
  return diagnostic("REPLAY_REQUEST_MISMATCH", message);
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftValue = canonicalizeJson(left);
  const rightValue = canonicalizeJson(right);
  return leftValue.ok && rightValue.ok && leftValue.value === rightValue.value;
}

function priceUsage(
  pricing: z.infer<typeof pricingIdentitySchema>,
  usage: Readonly<{
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  }>,
): Result<number, Diagnostic> {
  const uncachedInputTokens =
    usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteInputTokens;
  if (uncachedInputTokens < 0)
    return {
      ok: false,
      error: invalid("M9b.4 cached and cache-write input exceed total input."),
    };
  const longContext = usage.inputTokens > pricing.longContextThresholdTokens;
  const inputMultiplier = longContext
    ? pricing.longContextInputMultiplierMicros
    : 1_000_000;
  const outputMultiplier = longContext
    ? pricing.longContextOutputMultiplierMicros
    : 1_000_000;
  const numerators = [
    BigInt(uncachedInputTokens) *
      BigInt(pricing.inputUsdMicrosPerMillionTokens) *
      BigInt(inputMultiplier),
    BigInt(usage.cachedInputTokens) *
      BigInt(pricing.cachedInputUsdMicrosPerMillionTokens) *
      BigInt(inputMultiplier),
    BigInt(usage.cacheWriteInputTokens) *
      BigInt(pricing.cacheWriteInputUsdMicrosPerMillionTokens) *
      BigInt(inputMultiplier),
    BigInt(usage.outputTokens) *
      BigInt(pricing.outputUsdMicrosPerMillionTokens) *
      BigInt(outputMultiplier),
    BigInt(usage.reasoningTokens) *
      BigInt(pricing.reasoningUsdMicrosPerMillionTokens) *
      BigInt(outputMultiplier),
  ];
  const numerator = numerators.reduce(
    (total, component) => total + component,
    0n,
  );
  const denominator = 1_000_000_000_000n;
  const cost = (numerator + denominator - 1n) / denominator;
  return cost <= BigInt(Number.MAX_SAFE_INTEGER)
    ? { ok: true, value: Number(cost) }
    : {
        ok: false,
        error: invalid("M9b.4 pricing exceeds safe integer bounds."),
      };
}

function maximumInputBreakdown(
  pricing: z.infer<typeof pricingIdentitySchema>,
  inputTokens: number,
): Readonly<{
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
}> {
  const rates = [
    pricing.inputUsdMicrosPerMillionTokens,
    pricing.cachedInputUsdMicrosPerMillionTokens,
    pricing.cacheWriteInputUsdMicrosPerMillionTokens,
  ];
  const maximumRate = Math.max(...rates);
  const cachedInputTokens =
    pricing.cachedInputUsdMicrosPerMillionTokens === maximumRate &&
    pricing.inputUsdMicrosPerMillionTokens !== maximumRate
      ? inputTokens
      : 0;
  return {
    cachedInputTokens,
    cacheWriteInputTokens:
      pricing.cacheWriteInputUsdMicrosPerMillionTokens === maximumRate &&
      pricing.inputUsdMicrosPerMillionTokens !== maximumRate &&
      cachedInputTokens === 0
        ? inputTokens
        : 0,
  };
}

function maximumUsage(
  pricing: z.infer<typeof pricingIdentitySchema>,
  usage: Readonly<{
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    wallClockMs: number;
  }>,
): Result<M9b4Usage, Diagnostic> {
  const { cachedInputTokens, cacheWriteInputTokens } = maximumInputBreakdown(
    pricing,
    usage.inputTokens,
  );
  const cost = priceUsage(pricing, {
    inputTokens: usage.inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
  });
  return cost.ok
    ? {
        ok: true,
        value: {
          inputTokens: usage.inputTokens,
          cachedInputTokens,
          cacheWriteInputTokens,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens,
          wallClockMs: usage.wallClockMs,
          costUsdMicros: cost.value,
        },
      }
    : cost;
}

async function validateCampaign(
  input: unknown,
): Promise<Result<M9b4Campaign, Diagnostic>> {
  const parsed = m9b4CampaignSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: invalid("Invalid M9b.4 campaign.") };
  const envelopeDigest = await digestValue(parsed.data.budgetEnvelope);
  const { campaignDigest: _digest, ...body } = parsed.data;
  void _digest;
  const campaignDigest = await digestValue(body);
  return envelopeDigest.ok &&
    campaignDigest.ok &&
    envelopeDigest.value === parsed.data.budgetEnvelopeDigest &&
    campaignDigest.value === parsed.data.campaignDigest
    ? { ok: true, value: parsed.data }
    : { ok: false, error: invalid("M9b.4 campaign digests differ.") };
}

export async function prepareM9b4Campaign(
  input: M9b4CampaignInput,
): Promise<Result<M9b4Campaign, Diagnostic>> {
  const parsed = campaignInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: invalid("Invalid M9b.4 campaign input.") };
  const budgetEnvelopeDigest = await digestValue(parsed.data.budgetEnvelope);
  if (!budgetEnvelopeDigest.ok) return budgetEnvelopeDigest;
  const body = campaignBodySchema.parse({
    protocol: "lachesis-m9b4-offline-effect-ledger-campaign/3",
    ...parsed.data,
    budgetEnvelopeDigest: budgetEnvelopeDigest.value,
  });
  const campaignDigest = await digestValue(body);
  return campaignDigest.ok
    ? {
        ok: true,
        value: m9b4CampaignSchema.parse({
          ...body,
          campaignDigest: campaignDigest.value,
        }),
      }
    : campaignDigest;
}

async function canonicalRequest(
  serializedRequest: string,
  requestDigest: string,
): Promise<Result<void, Diagnostic>> {
  const parsed = parseJson(serializedRequest);
  const strict = parsed.ok
    ? strictJsonValueSchema.safeParse(parsed.value)
    : undefined;
  const canonical =
    strict?.success === true ? canonicalizeJson(strict.data) : undefined;
  const digest =
    strict?.success === true ? await digestValue(strict.data) : undefined;
  return strict?.success === true &&
    canonical?.ok === true &&
    canonical.value === serializedRequest &&
    digest?.ok === true &&
    digest.value === requestDigest
    ? { ok: true, value: undefined }
    : {
        ok: false,
        error: invalid("M9b.4 request bytes or digest are not canonical."),
      };
}

async function attemptIdentityBody(
  attempt: z.infer<typeof attemptBodySchema>,
): Promise<Result<string, Diagnostic>> {
  return digestValue({
    protocol: attempt.protocol,
    campaignDigest: attempt.campaignDigest,
    budgetEnvelopeDigest: attempt.budgetEnvelopeDigest,
    comparisonDigest: attempt.comparisonDigest,
    arm: attempt.arm,
    phase: attempt.phase,
    callIndex: attempt.callIndex,
    requestDigest: attempt.requestDigest,
    reservedInputTokenCeiling: attempt.reservedInputTokenCeiling,
    provider: attempt.provider,
    model: attempt.model,
    tokenizer: attempt.tokenizer,
    pricingSnapshot: attempt.pricingSnapshot,
    reservationDigest: attempt.reservationDigest,
  });
}

async function validateAttempt(
  campaign: M9b4Campaign,
  input: unknown,
): Promise<Result<M9b4Attempt, Diagnostic>> {
  const parsed = m9b4AttemptSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: invalid("Invalid M9b.4 attempt.") };
  const request = await canonicalRequest(
    parsed.data.serializedRequest,
    parsed.data.requestDigest,
  );
  const reservationDigest = await digestValue(parsed.data.reservation);
  const expectedMaximum = maximumUsage(parsed.data.pricingSnapshot, {
    inputTokens: parsed.data.reservation.maximumInputTokens,
    outputTokens: parsed.data.reservation.maximumOutputTokens,
    reasoningTokens: parsed.data.reservation.maximumReasoningTokens,
    wallClockMs: parsed.data.reservation.maximumWallClockMs,
  });
  const { attemptId: _attemptId, ...body } = parsed.data;
  void _attemptId;
  const attemptId = await attemptIdentityBody(body);
  if (
    !request.ok ||
    !reservationDigest.ok ||
    !expectedMaximum.ok ||
    !attemptId.ok ||
    parsed.data.campaignDigest !== campaign.campaignDigest ||
    parsed.data.budgetEnvelopeDigest !== campaign.budgetEnvelopeDigest ||
    parsed.data.reservationDigest !== reservationDigest.value ||
    parsed.data.attemptId !== attemptId.value ||
    parsed.data.provider.id !== parsed.data.model.providerId ||
    parsed.data.provider.id !== parsed.data.tokenizer.providerId ||
    parsed.data.provider.id !== parsed.data.pricingSnapshot.providerId ||
    parsed.data.reservedInputTokenCeiling !==
      parsed.data.reservation.maximumInputTokens ||
    parsed.data.reservation.maximumCostUsdMicros !==
      expectedMaximum.value.costUsdMicros
  )
    return {
      ok: false,
      error: invalid("M9b.4 attempt identities or reservation differ."),
    };
  return { ok: true, value: parsed.data };
}

export async function prepareM9b4Attempt(
  campaignInput: M9b4Campaign,
  input: M9b4AttemptInput,
): Promise<Result<M9b4Attempt, Diagnostic>> {
  const campaign = await validateCampaign(campaignInput);
  const parsed = attemptInputSchema.safeParse(input);
  if (!campaign.ok) return campaign;
  if (!parsed.success)
    return { ok: false, error: invalid("Invalid M9b.4 attempt input.") };
  const request = await canonicalRequest(
    parsed.data.serializedRequest,
    parsed.data.requestDigest,
  );
  if (!request.ok) return request;
  const reservationDigest = await digestValue(parsed.data.reservation);
  if (!reservationDigest.ok) return reservationDigest;
  const body = attemptBodySchema.parse({
    protocol: "lachesis-m9b4-effect-attempt/3",
    campaignDigest: campaign.value.campaignDigest,
    budgetEnvelopeDigest: campaign.value.budgetEnvelopeDigest,
    ...parsed.data,
    reservationDigest: reservationDigest.value,
  });
  const attemptId = await attemptIdentityBody(body);
  if (!attemptId.ok) return attemptId;
  return validateAttempt(campaign.value, {
    ...body,
    attemptId: attemptId.value,
  });
}

function coordinateKey(attempt: M9b4Attempt): string {
  return [
    attempt.comparisonDigest,
    attempt.arm,
    attempt.phase,
    String(attempt.callIndex),
  ].join(":");
}

function terminalState(
  event: TerminalEvent,
): "completed" | "failed" | "overage" | "ambiguous" {
  return event.kind;
}

async function validateCompletedReceipt(
  attempt: M9b4Attempt,
  receipt: z.infer<typeof completedReceiptSchema>,
): Promise<Result<void, Diagnostic>> {
  const output = parseJson(receipt.serializedOutput);
  const strict = output.ok
    ? strictJsonValueSchema.safeParse(output.value)
    : undefined;
  const canonical =
    strict?.success === true ? canonicalizeJson(strict.data) : undefined;
  const outputDigest =
    strict?.success === true ? await digestValue(strict.data) : undefined;
  const { receiptDigest: _receiptDigest, ...body } = receipt;
  void _receiptDigest;
  const receiptDigest = await digestValue(body);
  const usage = validateReportedUsage(attempt, receipt.usage);
  return strict?.success === true &&
    canonical?.ok === true &&
    canonical.value === receipt.serializedOutput &&
    outputDigest?.ok === true &&
    outputDigest.value === receipt.outputDigest &&
    receiptDigest.ok &&
    usage.ok &&
    usageOverageReason(attempt, receipt.usage) === undefined &&
    receiptDigest.value === receipt.receiptDigest &&
    receipt.attemptId === attempt.attemptId &&
    receipt.requestDigest === attempt.requestDigest &&
    canonicalEqual(receipt.provider, attempt.provider) &&
    canonicalEqual(receipt.model, attempt.model) &&
    canonicalEqual(receipt.tokenizer, attempt.tokenizer) &&
    canonicalEqual(receipt.pricingSnapshot, attempt.pricingSnapshot)
    ? { ok: true, value: undefined }
    : { ok: false, error: invalid("M9b.4 completed receipt is cross-bound.") };
}

async function validateFailedReceipt(
  attempt: M9b4Attempt,
  receipt: z.infer<typeof failedReceiptSchema>,
): Promise<Result<void, Diagnostic>> {
  const { receiptDigest: _receiptDigest, ...body } = receipt;
  void _receiptDigest;
  const receiptDigest = await digestValue(body);
  const usage = validateReportedUsage(attempt, receipt.usage);
  return receiptDigest.ok &&
    usage.ok &&
    usageOverageReason(attempt, receipt.usage) === undefined &&
    receiptDigest.value === receipt.receiptDigest &&
    receipt.attemptId === attempt.attemptId &&
    receipt.requestDigest === attempt.requestDigest &&
    canonicalEqual(receipt.provider, attempt.provider) &&
    canonicalEqual(receipt.model, attempt.model) &&
    canonicalEqual(receipt.tokenizer, attempt.tokenizer) &&
    canonicalEqual(receipt.pricingSnapshot, attempt.pricingSnapshot)
    ? { ok: true, value: undefined }
    : { ok: false, error: invalid("M9b.4 failed receipt is cross-bound.") };
}

async function validateOverageReceipt(
  attempt: M9b4Attempt,
  receipt: z.infer<typeof overageReceiptSchema>,
): Promise<Result<void, Diagnostic>> {
  const { receiptDigest: _receiptDigest, ...body } = receipt;
  void _receiptDigest;
  const receiptDigest = await digestValue(body);
  const usage = validateReportedUsage(attempt, receipt.usage);
  const reason = usage.ok
    ? usageOverageReason(attempt, usage.value)
    : undefined;
  return receiptDigest.ok &&
    usage.ok &&
    reason === receipt.reason &&
    receiptDigest.value === receipt.receiptDigest &&
    receipt.attemptId === attempt.attemptId &&
    receipt.requestDigest === attempt.requestDigest &&
    canonicalEqual(receipt.provider, attempt.provider) &&
    canonicalEqual(receipt.model, attempt.model) &&
    canonicalEqual(receipt.tokenizer, attempt.tokenizer) &&
    canonicalEqual(receipt.pricingSnapshot, attempt.pricingSnapshot)
    ? { ok: true, value: undefined }
    : { ok: false, error: invalid("M9b.4 overage receipt is cross-bound.") };
}

function validateReportedUsage(
  attempt: M9b4Attempt,
  usageInput: unknown,
): Result<M9b4Usage, Diagnostic> {
  const usage = m9b4UsageSchema.safeParse(usageInput);
  if (!usage.success)
    return { ok: false, error: invalid("M9b.4 provider usage is malformed.") };
  const cost = priceUsage(attempt.pricingSnapshot, usage.data);
  return cost.ok &&
    usage.data.cachedInputTokens + usage.data.cacheWriteInputTokens <=
      usage.data.inputTokens &&
    usage.data.costUsdMicros === cost.value
    ? { ok: true, value: usage.data }
    : {
        ok: false,
        error: invalid(
          "M9b.4 provider usage or billing classes are inconsistent.",
        ),
      };
}

function usageOverageReason(
  attempt: M9b4Attempt,
  usage: M9b4Usage,
): z.infer<typeof overageReceiptBodySchema>["reason"] | undefined {
  if (usage.inputTokens > attempt.reservation.maximumInputTokens)
    return "provider-input-framing-or-accounting-overage";
  return usage.outputTokens > attempt.reservation.maximumOutputTokens ||
    usage.reasoningTokens > attempt.reservation.maximumReasoningTokens ||
    usage.wallClockMs > attempt.reservation.maximumWallClockMs ||
    usage.costUsdMicros > attempt.reservation.maximumCostUsdMicros
    ? "provider-output-reasoning-time-or-cost-overage"
    : undefined;
}

async function deriveLedger(
  campaign: M9b4Campaign,
  events: ReadonlyArray<M9b4LedgerEvent>,
): Promise<Result<ReadonlyMap<string, DerivedAttempt>, Diagnostic>> {
  const attempts = new Map<string, DerivedAttempt>();
  const coordinates = new Map<string, string>();
  let previousDigest: string | null = null;
  for (const [index, event] of events.entries()) {
    const { digest, ...body } = event;
    const digestValueResult = await digestValue(body);
    if (
      !digestValueResult.ok ||
      digestValueResult.value !== digest ||
      event.index !== index ||
      event.previousDigest !== previousDigest
    )
      return {
        ok: false,
        error: invalid("M9b.4 ledger chain is corrupted or reordered."),
      };
    previousDigest = digest;
    if (event.kind === "prepared") {
      const attempt = await validateAttempt(campaign, event.attempt);
      const coordinate = attempt.ok ? coordinateKey(attempt.value) : undefined;
      if (
        !attempt.ok ||
        attempts.size >= campaign.budgetEnvelope.maximumAttempts ||
        attempts.has(event.attempt.attemptId) ||
        coordinate === undefined ||
        coordinates.has(coordinate)
      )
        return {
          ok: false,
          error: invalid("M9b.4 prepared attempt is duplicated or invalid."),
        };
      attempts.set(event.attempt.attemptId, {
        state: "prepared",
        prepared: event,
      });
      coordinates.set(coordinate, event.attempt.attemptId);
      continue;
    }
    const current = attempts.get(event.attemptId);
    if (current === undefined)
      return {
        ok: false,
        error: invalid("M9b.4 event has no prepared attempt."),
      };
    if (event.kind === "reserved") {
      if (
        current.state !== "prepared" ||
        event.preparedEventDigest !== current.prepared.digest ||
        event.reservationDigest !==
          current.prepared.attempt.reservationDigest ||
        !reservationFitsCampaign(
          campaign,
          [...attempts.values()],
          current.prepared.attempt,
        )
      )
        return {
          ok: false,
          error: invalid("M9b.4 reservation transition is invalid."),
        };
      attempts.set(event.attemptId, {
        state: "reserved",
        prepared: current.prepared,
        reserved: event,
      });
      continue;
    }
    if (event.kind === "dispatch-started") {
      if (
        current.state !== "reserved" ||
        event.reservationEventDigest !== current.reserved.digest
      )
        return {
          ok: false,
          error: invalid("M9b.4 dispatch transition is invalid."),
        };
      attempts.set(event.attemptId, {
        state: "dispatch-started",
        prepared: current.prepared,
        reserved: current.reserved,
        dispatch: event,
      });
      continue;
    }
    if (
      event.kind === "completed" ||
      event.kind === "failed" ||
      event.kind === "overage" ||
      event.kind === "ambiguous"
    ) {
      if (
        current.state !== "dispatch-started" ||
        event.dispatchEventDigest !== current.dispatch.digest
      )
        return {
          ok: false,
          error: invalid("M9b.4 terminal transition is invalid."),
        };
      const receipt =
        event.kind === "completed"
          ? await validateCompletedReceipt(
              current.prepared.attempt,
              event.receipt,
            )
          : event.kind === "failed"
            ? await validateFailedReceipt(
                current.prepared.attempt,
                event.receipt,
              )
            : event.kind === "overage"
              ? await validateOverageReceipt(
                  current.prepared.attempt,
                  event.receipt,
                )
              : { ok: true as const, value: undefined };
      if (!receipt.ok) return receipt;
      attempts.set(event.attemptId, {
        state: event.kind,
        prepared: current.prepared,
        reserved: current.reserved,
        dispatch: current.dispatch,
        terminal: event,
      });
      continue;
    }
    if (
      current.state !== "completed" &&
      current.state !== "failed" &&
      current.state !== "overage" &&
      current.state !== "ambiguous"
    )
      return {
        ok: false,
        error: invalid("M9b.4 reconciliation transition is invalid."),
      };
    const { settlementDigest: _settlementDigest, ...settlementBody } =
      event.settlement;
    void _settlementDigest;
    const settlementDigest = await digestValue(settlementBody);
    const expectedTerminal = terminalState(current.terminal);
    const expectedUsage =
      current.terminal.kind === "completed" ||
      current.terminal.kind === "failed" ||
      current.terminal.kind === "overage"
        ? current.terminal.receipt.usage
        : null;
    const expectedCost =
      current.terminal.kind === "overage"
        ? Math.max(
            current.terminal.receipt.usage.costUsdMicros,
            current.prepared.attempt.reservation.maximumCostUsdMicros,
          )
        : (expectedUsage?.costUsdMicros ??
          current.prepared.attempt.reservation.maximumCostUsdMicros);
    const expectedBasis =
      expectedUsage === null
        ? "authorized-conservative"
        : current.terminal.kind === "overage"
          ? "provider-reported-overage"
          : "provider-reported";
    if (
      !settlementDigest.ok ||
      settlementDigest.value !== event.settlement.settlementDigest ||
      event.settlement.attemptId !== event.attemptId ||
      event.settlement.terminalEventDigest !== current.terminal.digest ||
      event.settlement.terminal !== expectedTerminal ||
      event.settlement.accountingBasis !== expectedBasis ||
      event.settlement.chargedCostUsdMicros !== expectedCost ||
      !canonicalEqual(event.settlement.chargedUsage, expectedUsage)
    )
      return { ok: false, error: invalid("M9b.4 settlement is cross-bound.") };
    attempts.set(event.attemptId, {
      state: "reconciled",
      prepared: current.prepared,
      reserved: current.reserved,
      dispatch: current.dispatch,
      terminal: current.terminal,
      reconciled: event,
    });
  }
  return { ok: true, value: attempts };
}

async function loadLedger(
  persistence: M9b4AtomicPersistence,
  campaign: M9b4Campaign,
): Promise<Result<LoadedLedger, Diagnostic>> {
  const loaded = await persistence.read();
  if (!loaded.ok) return loaded;
  if (loaded.value === undefined)
    return {
      ok: true,
      value: { revision: null, events: [], attempts: new Map() },
    };
  const parsedJson = parseJson(loaded.value.content);
  const parsed = parsedJson.ok
    ? m9b4InternalLedgerSnapshotSchema.safeParse(parsedJson.value)
    : undefined;
  const canonical =
    parsed?.success === true ? canonicalizeJson(parsed.data) : undefined;
  if (
    parsed?.success !== true ||
    canonical?.ok !== true ||
    canonical.value !== loaded.value.content ||
    parsed.data.campaignDigest !== campaign.campaignDigest
  )
    return {
      ok: false,
      error: invalid("M9b.4 ledger snapshot is invalid or cross-bound."),
    };
  const { ledgerDigest: _ledgerDigest, ...body } = parsed.data;
  void _ledgerDigest;
  const ledgerDigest = await digestValue(body);
  if (!ledgerDigest.ok || ledgerDigest.value !== parsed.data.ledgerDigest)
    return {
      ok: false,
      error: invalid("M9b.4 ledger snapshot digest differs."),
    };
  const attempts = await deriveLedger(campaign, parsed.data.events);
  return attempts.ok
    ? {
        ok: true,
        value: {
          revision: loaded.value.revision,
          events: parsed.data.events,
          attempts: attempts.value,
        },
      }
    : attempts;
}

async function appendEvent(
  persistence: M9b4AtomicPersistence,
  campaign: M9b4Campaign,
  payloadInput: unknown,
): Promise<Result<LoadedLedger, Diagnostic>> {
  const payload = eventPayloadSchema.safeParse(payloadInput);
  if (!payload.success)
    return { ok: false, error: invalid("M9b.4 event payload is invalid.") };
  const loaded = await loadLedger(persistence, campaign);
  if (!loaded.ok) return loaded;
  const body = {
    ...payload.data,
    index: loaded.value.events.length,
    previousDigest: loaded.value.events.at(-1)?.digest ?? null,
  };
  const eventDigest = await digestValue(body);
  if (!eventDigest.ok) return eventDigest;
  const event = eventSchema.parse({ ...body, digest: eventDigest.value });
  const events = [...loaded.value.events, event];
  const attempts = await deriveLedger(campaign, events);
  if (!attempts.ok) return attempts;
  const snapshotBody = ledgerSnapshotBodySchema.parse({
    protocol: "lachesis-m9b4-effect-ledger-snapshot/3",
    campaignDigest: campaign.campaignDigest,
    events,
  });
  const ledgerDigest = await digestValue(snapshotBody);
  if (!ledgerDigest.ok) return ledgerDigest;
  const snapshot = m9b4InternalLedgerSnapshotSchema.parse({
    ...snapshotBody,
    ledgerDigest: ledgerDigest.value,
  });
  const content = canonicalizeJson(snapshot);
  if (!content.ok) return content;
  const written = await persistence.writeAtomic({
    expectedRevision: loaded.value.revision,
    content: content.value,
  });
  return written.ok
    ? {
        ok: true,
        value: {
          revision: written.value.revision,
          events,
          attempts: attempts.value,
        },
      }
    : written;
}

function chargeOf(state: DerivedAttempt): Readonly<{
  reserved: boolean;
  usage: M9b4Usage;
}> {
  const zero = {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    wallClockMs: 0,
    costUsdMicros: 0,
  };
  if (state.state === "prepared") return { reserved: false, usage: zero };
  const reservation = state.prepared.attempt.reservation;
  const maximum = maximumUsage(state.prepared.attempt.pricingSnapshot, {
    inputTokens: reservation.maximumInputTokens,
    outputTokens: reservation.maximumOutputTokens,
    reasoningTokens: reservation.maximumReasoningTokens,
    wallClockMs: reservation.maximumWallClockMs,
  });
  if (!maximum.ok) {
    const inputBreakdown = maximumInputBreakdown(
      state.prepared.attempt.pricingSnapshot,
      reservation.maximumInputTokens,
    );
    return {
      reserved: true,
      usage: {
        inputTokens: reservation.maximumInputTokens,
        ...inputBreakdown,
        outputTokens: reservation.maximumOutputTokens,
        reasoningTokens: reservation.maximumReasoningTokens,
        wallClockMs: reservation.maximumWallClockMs,
        costUsdMicros: reservation.maximumCostUsdMicros,
      },
    };
  }
  return {
    reserved: true,
    usage:
      state.state === "reconciled"
        ? state.reconciled.settlement.chargedUsage === null
          ? maximum.value
          : {
              ...state.reconciled.settlement.chargedUsage,
              costUsdMicros: state.reconciled.settlement.chargedCostUsdMicros,
            }
        : maximum.value,
  };
}

function sumUsage(
  charges: ReadonlyArray<ReturnType<typeof chargeOf>>,
): M9b4Usage {
  return charges.reduce<M9b4Usage>(
    (total, charge) => ({
      inputTokens: total.inputTokens + charge.usage.inputTokens,
      cachedInputTokens:
        total.cachedInputTokens + charge.usage.cachedInputTokens,
      cacheWriteInputTokens:
        total.cacheWriteInputTokens + charge.usage.cacheWriteInputTokens,
      outputTokens: total.outputTokens + charge.usage.outputTokens,
      reasoningTokens: total.reasoningTokens + charge.usage.reasoningTokens,
      wallClockMs: total.wallClockMs + charge.usage.wallClockMs,
      costUsdMicros: total.costUsdMicros + charge.usage.costUsdMicros,
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      wallClockMs: 0,
      costUsdMicros: 0,
    },
  );
}

function accountingSlice(
  ceiling: z.infer<typeof resourceCeilingSchema>,
  states: ReadonlyArray<DerivedAttempt>,
) {
  const charges = states.map(chargeOf);
  const charged = sumUsage(charges);
  return {
    reservedAttempts: charges.filter((charge) => charge.reserved).length,
    maximumInputTokens: ceiling.maximumInputTokens,
    maximumOutputTokens: ceiling.maximumOutputTokens,
    maximumReasoningTokens: ceiling.maximumReasoningTokens,
    maximumWallClockMs: ceiling.maximumWallClockMs,
    maximumCostUsdMicros: ceiling.maximumCostUsdMicros,
    chargedInputTokens: charged.inputTokens,
    chargedUncachedInputTokens:
      charged.inputTokens -
      charged.cachedInputTokens -
      charged.cacheWriteInputTokens,
    chargedCachedInputTokens: charged.cachedInputTokens,
    chargedCacheWriteInputTokens: charged.cacheWriteInputTokens,
    chargedOutputTokens: charged.outputTokens,
    chargedReasoningTokens: charged.reasoningTokens,
    chargedWallClockMs: charged.wallClockMs,
    chargedCostUsdMicros: charged.costUsdMicros,
    remainingInputTokens: ceiling.maximumInputTokens - charged.inputTokens,
    remainingOutputTokens: ceiling.maximumOutputTokens - charged.outputTokens,
    remainingReasoningTokens:
      ceiling.maximumReasoningTokens - charged.reasoningTokens,
    remainingWallClockMs: ceiling.maximumWallClockMs - charged.wallClockMs,
    remainingCostUsdMicros:
      ceiling.maximumCostUsdMicros - charged.costUsdMicros,
  };
}

async function accountingStatus(
  campaign: M9b4Campaign,
  ledger: LoadedLedger,
): Promise<Result<M9b4AccountingStatus, Diagnostic>> {
  const states = [...ledger.attempts.values()];
  const attemptStates = states
    .map((state) => ({
      attemptId: state.prepared.attempt.attemptId,
      requestDigest: state.prepared.attempt.requestDigest,
      arm: state.prepared.attempt.arm,
      phase: state.prepared.attempt.phase,
      callIndex: state.prepared.attempt.callIndex,
      lifecycle:
        state.state === "completed" ||
        state.state === "failed" ||
        state.state === "overage" ||
        state.state === "ambiguous"
          ? ("terminal" as const)
          : state.state,
      terminal:
        state.state === "reconciled"
          ? terminalState(state.terminal)
          : state.state === "completed" ||
              state.state === "failed" ||
              state.state === "overage" ||
              state.state === "ambiguous"
            ? state.state
            : null,
    }))
    .toSorted((left, right) => left.attemptId.localeCompare(right.attemptId));
  const terminalCounts = {
    completed: attemptStates.filter((state) => state.terminal === "completed")
      .length,
    failed: attemptStates.filter((state) => state.terminal === "failed").length,
    overage: attemptStates.filter((state) => state.terminal === "overage")
      .length,
    ambiguous: attemptStates.filter((state) => state.terminal === "ambiguous")
      .length,
  };
  const providers = campaign.budgetEnvelope.providers.map((cap) => ({
    provider: cap.provider,
    accounting: accountingSlice(
      cap,
      states.filter(
        (state) =>
          state.prepared.attempt.provider.id === cap.provider.id &&
          state.prepared.attempt.provider.version === cap.provider.version,
      ),
    ),
  }));
  const phases = campaign.budgetEnvelope.phases.map((cap) => ({
    phase: cap.phase,
    accounting: accountingSlice(
      cap,
      states.filter((state) => state.prepared.attempt.phase === cap.phase),
    ),
  }));
  const arms = campaign.budgetEnvelope.arms.map((cap) => ({
    arm: cap.arm,
    accounting: accountingSlice(
      cap,
      states.filter((state) => state.prepared.attempt.arm === cap.arm),
    ),
  }));
  const requestDigests = [
    ...new Set(states.map((state) => state.prepared.attempt.requestDigest)),
  ].toSorted();
  const requests = requestDigests.map((requestDigest) => {
    const requestStates = states.filter(
      (state) => state.prepared.attempt.requestDigest === requestDigest,
    );
    const charges = requestStates.map(chargeOf);
    const charged = sumUsage(charges);
    return {
      requestDigest,
      reservedAttempts: charges.filter((charge) => charge.reserved).length,
      chargedInputTokens: charged.inputTokens,
      chargedUncachedInputTokens:
        charged.inputTokens -
        charged.cachedInputTokens -
        charged.cacheWriteInputTokens,
      chargedCachedInputTokens: charged.cachedInputTokens,
      chargedCacheWriteInputTokens: charged.cacheWriteInputTokens,
      chargedOutputTokens: charged.outputTokens,
      chargedReasoningTokens: charged.reasoningTokens,
      chargedWallClockMs: charged.wallClockMs,
      chargedCostUsdMicros: charged.costUsdMicros,
    };
  });
  const body = {
    protocol: "lachesis-m9b4-rederived-accounting/3" as const,
    campaignDigest: campaign.campaignDigest,
    eventCount: ledger.events.length,
    ledgerHead: ledger.events.at(-1)?.digest ?? null,
    attempts: states.length,
    attemptStates,
    terminalCounts,
    progressionHalted:
      terminalCounts.overage > 0 || terminalCounts.ambiguous > 0,
    total: accountingSlice(campaign.budgetEnvelope, states),
    providers,
    phases,
    arms,
    requests,
  };
  const accountingDigest = await digestValue(body);
  return accountingDigest.ok
    ? {
        ok: true,
        value: m9b4AccountingStatusSchema.parse({
          ...body,
          accountingDigest: accountingDigest.value,
        }),
      }
    : accountingDigest;
}

export async function inspectM9b4EffectLedger(
  campaignInput: M9b4Campaign,
  persistence: M9b4AtomicPersistence,
): Promise<Result<M9b4AccountingStatus, Diagnostic>> {
  const campaign = await validateCampaign(campaignInput);
  if (!campaign.ok) return campaign;
  const ledger = await loadLedger(persistence, campaign.value);
  return ledger.ok ? accountingStatus(campaign.value, ledger.value) : ledger;
}

function providerCapFor(campaign: M9b4Campaign, attempt: M9b4Attempt) {
  return campaign.budgetEnvelope.providers.find(
    (cap) =>
      cap.provider.id === attempt.provider.id &&
      cap.provider.version === attempt.provider.version &&
      cap.provider.artifactDigest === attempt.provider.artifactDigest,
  );
}

function reservationFitsCampaign(
  campaign: M9b4Campaign,
  states: ReadonlyArray<DerivedAttempt>,
  attempt: M9b4Attempt,
): boolean {
  const providerCap = providerCapFor(campaign, attempt);
  const phaseCap = campaign.budgetEnvelope.phases.find(
    (cap) => cap.phase === attempt.phase,
  );
  const armCap = campaign.budgetEnvelope.arms.find(
    (cap) => cap.arm === attempt.arm,
  );
  const maximum = attempt.reservation;
  const activeAttempts = states.filter(
    (state) =>
      state.prepared.attempt.attemptId !== attempt.attemptId &&
      (state.state === "reserved" || state.state === "dispatch-started"),
  ).length;
  const fits = (
    selected: ReadonlyArray<DerivedAttempt>,
    ceiling: z.infer<typeof resourceCeilingSchema>,
  ): boolean => {
    const charged = sumUsage(selected.map(chargeOf));
    return (
      charged.inputTokens + maximum.maximumInputTokens <=
        ceiling.maximumInputTokens &&
      charged.outputTokens + maximum.maximumOutputTokens <=
        ceiling.maximumOutputTokens &&
      charged.reasoningTokens + maximum.maximumReasoningTokens <=
        ceiling.maximumReasoningTokens &&
      charged.wallClockMs + maximum.maximumWallClockMs <=
        ceiling.maximumWallClockMs &&
      charged.costUsdMicros + maximum.maximumCostUsdMicros <=
        ceiling.maximumCostUsdMicros
    );
  };
  return (
    providerCap !== undefined &&
    phaseCap !== undefined &&
    armCap !== undefined &&
    activeAttempts < campaign.budgetEnvelope.maximumConcurrentAttempts &&
    states.length <= campaign.budgetEnvelope.maximumAttempts &&
    fits(states, campaign.budgetEnvelope) &&
    fits(
      states.filter((candidate) =>
        canonicalEqual(candidate.prepared.attempt.provider, attempt.provider),
      ),
      providerCap,
    ) &&
    fits(
      states.filter(
        (candidate) => candidate.prepared.attempt.phase === attempt.phase,
      ),
      phaseCap,
    ) &&
    fits(
      states.filter(
        (candidate) => candidate.prepared.attempt.arm === attempt.arm,
      ),
      armCap,
    )
  );
}

function admitReservation(
  campaign: M9b4Campaign,
  ledger: LoadedLedger,
  state: Extract<DerivedAttempt, { state: "prepared" }>,
): Result<void, Diagnostic> {
  return reservationFitsCampaign(
    campaign,
    [...ledger.attempts.values()],
    state.prepared.attempt,
  )
    ? { ok: true, value: undefined }
    : {
        ok: false,
        error: diagnostic(
          "BUDGET_EXCEEDED",
          "M9b.4 reservation exceeds campaign, provider, phase, arm, or attempt capacity.",
        ),
      };
}

async function createCompletedReceipt(
  attempt: M9b4Attempt,
  output: z.infer<typeof strictJsonValueSchema>,
  usage: M9b4Usage,
): Promise<Result<z.infer<typeof completedReceiptSchema>, Diagnostic>> {
  const serializedOutput = canonicalizeJson(output);
  const outputDigest = await digestValue(output);
  if (!serializedOutput.ok) return serializedOutput;
  if (!outputDigest.ok) return outputDigest;
  const body = completedReceiptBodySchema.parse({
    kind: "completed",
    attemptId: attempt.attemptId,
    requestDigest: attempt.requestDigest,
    provider: attempt.provider,
    model: attempt.model,
    tokenizer: attempt.tokenizer,
    pricingSnapshot: attempt.pricingSnapshot,
    usage,
    serializedOutput: serializedOutput.value,
    outputDigest: outputDigest.value,
  });
  const receiptDigest = await digestValue(body);
  return receiptDigest.ok
    ? {
        ok: true,
        value: completedReceiptSchema.parse({
          ...body,
          receiptDigest: receiptDigest.value,
        }),
      }
    : receiptDigest;
}

async function createFailedReceipt(
  attempt: M9b4Attempt,
  failure: z.infer<typeof transportFailureSchema>,
  usage: M9b4Usage,
): Promise<Result<z.infer<typeof failedReceiptSchema>, Diagnostic>> {
  const body = failedReceiptBodySchema.parse({
    kind: "failed",
    attemptId: attempt.attemptId,
    requestDigest: attempt.requestDigest,
    provider: attempt.provider,
    model: attempt.model,
    tokenizer: attempt.tokenizer,
    pricingSnapshot: attempt.pricingSnapshot,
    usage,
    failure,
  });
  const receiptDigest = await digestValue(body);
  return receiptDigest.ok
    ? {
        ok: true,
        value: failedReceiptSchema.parse({
          ...body,
          receiptDigest: receiptDigest.value,
        }),
      }
    : receiptDigest;
}

async function createOverageReceipt(
  attempt: M9b4Attempt,
  usage: M9b4Usage,
  reason: z.infer<typeof overageReceiptBodySchema>["reason"],
): Promise<Result<z.infer<typeof overageReceiptSchema>, Diagnostic>> {
  const body = overageReceiptBodySchema.parse({
    kind: "overage",
    attemptId: attempt.attemptId,
    requestDigest: attempt.requestDigest,
    provider: attempt.provider,
    model: attempt.model,
    tokenizer: attempt.tokenizer,
    pricingSnapshot: attempt.pricingSnapshot,
    usage,
    reason,
  });
  const receiptDigest = await digestValue(body);
  return receiptDigest.ok
    ? {
        ok: true,
        value: overageReceiptSchema.parse({
          ...body,
          receiptDigest: receiptDigest.value,
        }),
      }
    : receiptDigest;
}

async function appendAmbiguous(
  persistence: M9b4AtomicPersistence,
  campaign: M9b4Campaign,
  state: Extract<DerivedAttempt, { state: "dispatch-started" }>,
  reason: AmbiguousEvent["reason"],
): Promise<Result<LoadedLedger, Diagnostic>> {
  return appendEvent(persistence, campaign, {
    kind: "ambiguous",
    attemptId: state.prepared.attempt.attemptId,
    dispatchEventDigest: state.dispatch.digest,
    reason,
  });
}

async function reconcile(
  persistence: M9b4AtomicPersistence,
  campaign: M9b4Campaign,
  state: Extract<
    DerivedAttempt,
    { state: "completed" | "failed" | "overage" | "ambiguous" }
  >,
): Promise<Result<LoadedLedger, Diagnostic>> {
  const usage =
    state.terminal.kind === "completed" ||
    state.terminal.kind === "failed" ||
    state.terminal.kind === "overage"
      ? state.terminal.receipt.usage
      : null;
  const body = settlementBodySchema.parse({
    attemptId: state.prepared.attempt.attemptId,
    terminalEventDigest: state.terminal.digest,
    terminal: terminalState(state.terminal),
    accountingBasis:
      usage === null
        ? "authorized-conservative"
        : state.terminal.kind === "overage"
          ? "provider-reported-overage"
          : "provider-reported",
    chargedUsage: usage,
    chargedCostUsdMicros:
      state.terminal.kind === "overage"
        ? Math.max(
            state.terminal.receipt.usage.costUsdMicros,
            state.prepared.attempt.reservation.maximumCostUsdMicros,
          )
        : (usage?.costUsdMicros ??
          state.prepared.attempt.reservation.maximumCostUsdMicros),
  });
  const settlementDigest = await digestValue(body);
  if (!settlementDigest.ok) return settlementDigest;
  return appendEvent(persistence, campaign, {
    kind: "reconciled",
    attemptId: state.prepared.attempt.attemptId,
    settlement: { ...body, settlementDigest: settlementDigest.value },
  });
}

function sessionMatchesAttempt(
  session: M9b4TransportSession,
  attempt: M9b4Attempt,
): boolean {
  return (
    canonicalEqual(session.provider, attempt.provider) &&
    canonicalEqual(session.model, attempt.model) &&
    canonicalEqual(session.tokenizer, attempt.tokenizer) &&
    canonicalEqual(session.pricingSnapshot, attempt.pricingSnapshot)
  );
}

function controllerFailure(
  kind: M9b4ControllerFailure["kind"],
  diagnosticValue: Diagnostic,
): Result<never, M9b4ControllerFailure> {
  return { ok: false, error: { kind, diagnostic: diagnosticValue } };
}

async function resultFor(
  campaign: M9b4Campaign,
  ledger: LoadedLedger,
  state: Extract<DerivedAttempt, { state: "reconciled" }>,
  resumed: boolean,
  transportInvoked: boolean,
): Promise<Result<M9b4ExecutionResult, M9b4ControllerFailure>> {
  const accounting = await accountingStatus(campaign, ledger);
  if (!accounting.ok) return controllerFailure("validation", accounting.error);
  const terminal = terminalState(state.terminal);
  return {
    ok: true,
    value: {
      protocol: M9B4_EFFECT_LEDGER_PROTOCOL,
      attemptId: state.prepared.attempt.attemptId,
      state: "reconciled",
      terminal,
      successful: terminal === "completed",
      scorable: terminal !== "ambiguous" && terminal !== "overage",
      repairable: false,
      resumed,
      transportInvoked,
      accounting: accounting.value,
    },
  };
}

async function reconcileAndReturn(
  campaign: M9b4Campaign,
  persistence: M9b4AtomicPersistence,
  state: Extract<
    DerivedAttempt,
    { state: "completed" | "failed" | "overage" | "ambiguous" }
  >,
  resumed: boolean,
  transportInvoked: boolean,
): Promise<Result<M9b4ExecutionResult, M9b4ControllerFailure>> {
  const reconciled = await reconcile(persistence, campaign, state);
  if (!reconciled.ok) return controllerFailure("storage", reconciled.error);
  const next = reconciled.value.attempts.get(state.prepared.attempt.attemptId);
  return next?.state === "reconciled"
    ? resultFor(campaign, reconciled.value, next, resumed, transportInvoked)
    : controllerFailure(
        "validation",
        invalid("M9b.4 reconciliation did not produce a terminal state."),
      );
}

async function ambiguousAndReturn(
  campaign: M9b4Campaign,
  persistence: M9b4AtomicPersistence,
  state: Extract<DerivedAttempt, { state: "dispatch-started" }>,
  reason: AmbiguousEvent["reason"],
  resumed: boolean,
  transportInvoked: boolean,
): Promise<Result<M9b4ExecutionResult, M9b4ControllerFailure>> {
  const ambiguous = await appendAmbiguous(persistence, campaign, state, reason);
  if (!ambiguous.ok) return controllerFailure("storage", ambiguous.error);
  const next = ambiguous.value.attempts.get(state.prepared.attempt.attemptId);
  return next?.state === "ambiguous"
    ? reconcileAndReturn(campaign, persistence, next, resumed, transportInvoked)
    : controllerFailure(
        "validation",
        invalid("M9b.4 ambiguity transition did not persist."),
      );
}

export async function executeM9b4EffectAttempt(
  input: Readonly<{
    campaign: M9b4Campaign;
    attempt: M9b4Attempt;
    persistence: M9b4AtomicPersistence;
    createSession: () => M9b4TransportSession;
    signal?: AbortSignal | undefined;
  }>,
): Promise<Result<M9b4ExecutionResult, M9b4ControllerFailure>> {
  const campaign = await validateCampaign(input.campaign);
  if (!campaign.ok) return controllerFailure("validation", campaign.error);
  const attempt = await validateAttempt(campaign.value, input.attempt);
  if (!attempt.ok) return controllerFailure("validation", attempt.error);
  let ledger = await loadLedger(input.persistence, campaign.value);
  if (!ledger.ok) return controllerFailure("storage", ledger.error);
  const existingCoordinate = [...ledger.value.attempts.values()].find(
    (state) =>
      coordinateKey(state.prepared.attempt) === coordinateKey(attempt.value),
  );
  if (
    existingCoordinate !== undefined &&
    existingCoordinate.prepared.attempt.attemptId !== attempt.value.attemptId
  )
    return controllerFailure(
      "validation",
      invalid(
        "M9b.4 attempt coordinates are already bound to another request.",
      ),
    );
  const resumed = existingCoordinate !== undefined;
  let state = ledger.value.attempts.get(attempt.value.attemptId);
  if (state === undefined) {
    if (
      ledger.value.attempts.size >=
      campaign.value.budgetEnvelope.maximumAttempts
    )
      return controllerFailure(
        "budget",
        diagnostic(
          "BUDGET_EXCEEDED",
          "M9b.4 campaign attempt capacity is exhausted.",
        ),
      );
    ledger = await appendEvent(input.persistence, campaign.value, {
      kind: "prepared",
      attempt: attempt.value,
    });
    if (!ledger.ok) return controllerFailure("storage", ledger.error);
    state = ledger.value.attempts.get(attempt.value.attemptId);
  }
  if (state?.state === "prepared") {
    const admitted = admitReservation(campaign.value, ledger.value, state);
    if (!admitted.ok) return controllerFailure("budget", admitted.error);
    ledger = await appendEvent(input.persistence, campaign.value, {
      kind: "reserved",
      attemptId: attempt.value.attemptId,
      preparedEventDigest: state.prepared.digest,
      reservationDigest: attempt.value.reservationDigest,
    });
    if (!ledger.ok) return controllerFailure("storage", ledger.error);
    state = ledger.value.attempts.get(attempt.value.attemptId);
  }
  if (state?.state === "dispatch-started")
    return ambiguousAndReturn(
      campaign.value,
      input.persistence,
      state,
      "interrupted-after-dispatch-started",
      true,
      false,
    );
  if (
    state?.state === "completed" ||
    state?.state === "failed" ||
    state?.state === "overage" ||
    state?.state === "ambiguous"
  )
    return reconcileAndReturn(
      campaign.value,
      input.persistence,
      state,
      true,
      false,
    );
  if (state?.state === "reconciled")
    return resultFor(campaign.value, ledger.value, state, true, false);
  if (state?.state !== "reserved")
    return controllerFailure(
      "validation",
      invalid("M9b.4 attempt did not reach its reserved state."),
    );
  ledger = await appendEvent(input.persistence, campaign.value, {
    kind: "dispatch-started",
    attemptId: attempt.value.attemptId,
    reservationEventDigest: state.reserved.digest,
    transportInvocationLimit: 1,
    automaticRetryLimit: 0,
  });
  if (!ledger.ok) return controllerFailure("storage", ledger.error);
  const dispatchState = ledger.value.attempts.get(attempt.value.attemptId);
  if (dispatchState?.state !== "dispatch-started")
    return controllerFailure(
      "validation",
      invalid("M9b.4 dispatch-started transition did not persist."),
    );
  let session: M9b4TransportSession;
  try {
    session = input.createSession();
  } catch {
    return ambiguousAndReturn(
      campaign.value,
      input.persistence,
      dispatchState,
      "interrupted-after-dispatch-started",
      resumed,
      false,
    );
  }
  if (!sessionMatchesAttempt(session, attempt.value))
    return ambiguousAndReturn(
      campaign.value,
      input.persistence,
      dispatchState,
      "session-identity-mismatch",
      resumed,
      false,
    );
  const signal = input.signal ?? new AbortController().signal;
  let rawResult: unknown;
  try {
    rawResult = await session.invoke(
      {
        attemptId: attempt.value.attemptId,
        serializedRequest: attempt.value.serializedRequest,
        requestDigest: attempt.value.requestDigest,
      },
      signal,
    );
  } catch {
    return ambiguousAndReturn(
      campaign.value,
      input.persistence,
      dispatchState,
      "transport-threw",
      resumed,
      true,
    );
  }
  const transportResult = transportResultSchema.safeParse(rawResult);
  if (!transportResult.success)
    return ambiguousAndReturn(
      campaign.value,
      input.persistence,
      dispatchState,
      "transport-outcome-invalid",
      resumed,
      true,
    );
  const usage = validateReportedUsage(
    attempt.value,
    transportResult.data.usage,
  );
  if (!usage.ok)
    return ambiguousAndReturn(
      campaign.value,
      input.persistence,
      dispatchState,
      "usage-missing-malformed-or-inconsistent",
      resumed,
      true,
    );
  const overageReason = usageOverageReason(attempt.value, usage.value);
  if (overageReason !== undefined) {
    const overageReceipt = await createOverageReceipt(
      attempt.value,
      usage.value,
      overageReason,
    );
    if (!overageReceipt.ok)
      return ambiguousAndReturn(
        campaign.value,
        input.persistence,
        dispatchState,
        "transport-outcome-invalid",
        resumed,
        true,
      );
    ledger = await appendEvent(input.persistence, campaign.value, {
      kind: "overage",
      attemptId: attempt.value.attemptId,
      dispatchEventDigest: dispatchState.dispatch.digest,
      receipt: overageReceipt.value,
    });
    if (!ledger.ok) return controllerFailure("storage", ledger.error);
    const overageState = ledger.value.attempts.get(attempt.value.attemptId);
    return overageState?.state === "overage"
      ? reconcileAndReturn(
          campaign.value,
          input.persistence,
          overageState,
          resumed,
          true,
        )
      : controllerFailure(
          "validation",
          invalid("M9b.4 overage receipt did not persist."),
        );
  }
  const terminalPayload =
    transportResult.data.kind === "success"
      ? await createCompletedReceipt(
          attempt.value,
          transportResult.data.output,
          usage.value,
        )
      : await createFailedReceipt(
          attempt.value,
          transportResult.data.failure,
          usage.value,
        );
  if (!terminalPayload.ok)
    return ambiguousAndReturn(
      campaign.value,
      input.persistence,
      dispatchState,
      "transport-outcome-invalid",
      resumed,
      true,
    );
  ledger = await appendEvent(input.persistence, campaign.value, {
    kind: transportResult.data.kind === "success" ? "completed" : "failed",
    attemptId: attempt.value.attemptId,
    dispatchEventDigest: dispatchState.dispatch.digest,
    receipt: terminalPayload.value,
  });
  if (!ledger.ok) return controllerFailure("storage", ledger.error);
  const terminalStateValue = ledger.value.attempts.get(attempt.value.attemptId);
  return terminalStateValue?.state === "completed" ||
    terminalStateValue?.state === "failed"
    ? reconcileAndReturn(
        campaign.value,
        input.persistence,
        terminalStateValue,
        resumed,
        true,
      )
    : controllerFailure(
        "validation",
        invalid("M9b.4 terminal receipt did not persist."),
      );
}
