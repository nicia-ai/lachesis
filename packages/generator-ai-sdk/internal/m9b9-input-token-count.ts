import {
  canonicalizeJson,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type M9b8ProspectiveRedesignReport,
  type M9b8ProspectiveRedesignToken,
  verifyM9b8ProspectiveRedesign,
} from "./m9b8-prospective-redesign.js";

export const M9B9_INPUT_TOKEN_COUNT_PROTOCOL = Object.freeze({
  id: "lachesis-m9b9-offline-responses-input-token-count",
  version: "1.0.0",
  baselineCommit: "1ad21e08dac6b9b02400a888e486b8f18241b760",
  visibility: "private-offline-conformance-only" as const,
  countEndpoint: "POST /v1/responses/input_tokens" as const,
  inferenceEndpoint: "POST /v1/responses" as const,
  openApiVersion: "2.3.0" as const,
  retryLimit: 0 as const,
  maximumConcurrency: 1 as const,
  decision: "token-count-pricing-unknown-no-go" as const,
  claimBoundary:
    "offline intercepted-transport and conservative-capacity evidence only; no corpus, credential, provider access, preregistration, probe, live execution, endpoint-price claim, or superiority claim",
});

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z.string().min(1).max(160);
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
export type M9b9RequestClass = z.infer<typeof requestClassSchema>;
const armSchema = z.enum(["discovered-program", "static-one-shot"]);
const phaseSchema = z.enum(["authoring", "grounded-answer"]);
const populationSchema = z.enum(["probe", "primary"]);

const strictJsonValueSchema = z.custom<z.infer<ReturnType<typeof z.json>>>(
  (value) => canonicalizeJson(value).ok,
  "Expected a strict, non-transforming JSON value.",
);

const artifactIdentitySchema = z
  .strictObject({
    id: identifierSchema,
    version: identifierSchema,
    artifactDigest: digestSchema,
  })
  .readonly();
const providerBoundIdentitySchema = artifactIdentitySchema
  .unwrap()
  .safeExtend({ providerId: identifierSchema })
  .readonly();
const pricingIdentitySchema = providerBoundIdentitySchema
  .unwrap()
  .safeExtend({
    uncachedInputUsdMicrosPerMillionTokens: safeCountSchema,
    cachedReadUsdMicrosPerMillionTokens: safeCountSchema,
    cacheWriteUsdMicrosPerMillionTokens: safeCountSchema,
    outputUsdMicrosPerMillionTokens: safeCountSchema,
    reasoningUsdMicrosPerMillionTokens: safeCountSchema,
    longContextThresholdTokens: z.number().int().positive(),
    longContextInputMultiplierMicros: z.number().int().min(1_000_000),
    longContextOutputMultiplierMicros: z.number().int().min(1_000_000),
  })
  .readonly();

export const m9b9IdentityProfileSchema = z
  .strictObject({
    provider: artifactIdentitySchema,
    model: providerBoundIdentitySchema,
    serializer: providerBoundIdentitySchema,
    modelLimits: artifactIdentitySchema,
    pricing: pricingIdentitySchema,
    officialDocumentation: artifactIdentitySchema,
    pinnedSdkSource: artifactIdentitySchema,
  })
  .superRefine((value, context) => {
    if (
      value.model.providerId !== value.provider.id ||
      value.serializer.providerId !== value.provider.id ||
      value.pricing.providerId !== value.provider.id
    )
      context.addIssue({
        code: "custom",
        message: "M9b.9 provider-bound identities disagree.",
      });
  })
  .readonly();
export type M9b9IdentityProfile = z.infer<typeof m9b9IdentityProfileSchema>;

const requestInputSchema = z
  .strictObject({
    requestClass: requestClassSchema,
    comparisonDigest: digestSchema,
    scheduleDigest: digestSchema,
    population: populationSchema,
    pairId: identifierSchema,
    arm: armSchema,
    phase: phaseSchema,
    callIndex: z.number().int().nonnegative(),
    instructions: z.string().min(1).max(131_072),
    input: strictJsonValueSchema,
    tools: strictJsonValueSchema.array().max(32).readonly(),
    structuredOutputSchema: strictJsonValueSchema,
    maximumOutputTokens: z.number().int().positive().max(128_000),
    identities: m9b9IdentityProfileSchema,
  })
  .readonly();
export type M9b9RequestInput = z.input<typeof requestInputSchema>;

const providerRequestSchema = z
  .strictObject({
    include: z.tuple([z.literal("reasoning.encrypted_content")]).readonly(),
    input: strictJsonValueSchema,
    instructions: z.string().min(1),
    max_output_tokens: z.number().int().positive(),
    model: identifierSchema,
    reasoning: z.strictObject({ effort: z.literal("none") }).readonly(),
    service_tier: z.literal("default"),
    store: z.literal(false),
    text: z
      .strictObject({
        format: z
          .strictObject({
            name: identifierSchema,
            schema: strictJsonValueSchema,
            strict: z.literal(true),
            type: z.literal("json_schema"),
          })
          .readonly(),
      })
      .readonly(),
    tools: strictJsonValueSchema.array().max(32).readonly(),
    truncation: z.literal("disabled"),
  })
  .readonly();

const requestBindingBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b9-single-source-request-binding/1"),
    requestClass: requestClassSchema,
    comparisonDigest: digestSchema,
    scheduleDigest: digestSchema,
    population: populationSchema,
    pairId: identifierSchema,
    arm: armSchema,
    phase: phaseSchema,
    callIndex: z.number().int().nonnegative(),
    identities: m9b9IdentityProfileSchema,
    providerRequest: providerRequestSchema,
    inferenceRequestBytes: z.string().min(1).max(1_048_576),
    inferenceRequestDigest: digestSchema,
    countRequest: providerRequestSchema,
    countRequestBytes: z.string().min(1).max(1_048_576),
    countRequestDigest: digestSchema,
    relationshipDigest: digestSchema,
    endpoints: z
      .strictObject({
        count: z.literal("POST /v1/responses/input_tokens"),
        inference: z.literal("POST /v1/responses"),
      })
      .readonly(),
    retryLimits: z
      .strictObject({ countAdapter: z.literal(0), controller: z.literal(0) })
      .readonly(),
  })
  .readonly();
export const m9b9RequestBindingSchema = requestBindingBodySchema
  .unwrap()
  .safeExtend({ bindingDigest: digestSchema })
  .readonly();
export type M9b9RequestBinding = z.infer<typeof m9b9RequestBindingSchema>;

export type M9b9Failure = Readonly<{
  kind:
    | "validation"
    | "persistence"
    | "count-rejected"
    | "count-ambiguous"
    | "capacity-rejected"
    | "inference-ambiguous"
    | "accounting-overage";
  message: string;
}>;

function failure(
  kind: M9b9Failure["kind"],
  message: string,
): Result<never, M9b9Failure> {
  return { ok: false, error: { kind, message } };
}

function classMatches(
  requestClass: M9b9RequestClass,
  arm: z.infer<typeof armSchema>,
  phase: z.infer<typeof phaseSchema>,
): boolean {
  switch (requestClass) {
    case "root-program-authoring":
      return arm === "discovered-program" && phase === "authoring";
    case "static-one-shot-query-planning":
      return arm === "static-one-shot" && phase === "authoring";
    case "discovered-program-leaf-reasoning":
      return arm === "discovered-program" && phase === "grounded-answer";
    case "static-answer-generation":
      return arm === "static-one-shot" && phase === "grounded-answer";
  }
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalizeJson(left);
  const rightBytes = canonicalizeJson(right);
  return leftBytes.ok && rightBytes.ok && leftBytes.value === rightBytes.value;
}

async function buildRequestBinding(
  input: z.infer<typeof requestInputSchema>,
): Promise<Result<M9b9RequestBinding, M9b9Failure>> {
  const providerRequest = providerRequestSchema.safeParse({
    include: ["reasoning.encrypted_content"],
    input: input.input,
    instructions: input.instructions,
    max_output_tokens: input.maximumOutputTokens,
    model: input.identities.model.version,
    reasoning: { effort: "none" },
    service_tier: "default",
    store: false,
    text: {
      format: {
        name: input.requestClass.replaceAll("-", "_"),
        schema: input.structuredOutputSchema,
        strict: true,
        type: "json_schema",
      },
    },
    tools: input.tools,
    truncation: "disabled",
  });
  if (!providerRequest.success)
    return failure("validation", "M9b.9 provider request is invalid.");
  const inferenceBytes = canonicalizeJson(providerRequest.data);
  const inferenceDigest = await digestValue(providerRequest.data);
  const countRequest = providerRequest.data;
  const countBytes = canonicalizeJson(countRequest);
  const countDigest = await digestValue(countRequest);
  const relationshipDigest = await digestValue({
    singleSourceProviderRequestDigest: inferenceDigest.ok
      ? inferenceDigest.value
      : "invalid",
    countEndpoint: M9B9_INPUT_TOKEN_COUNT_PROTOCOL.countEndpoint,
    inferenceEndpoint: M9B9_INPUT_TOKEN_COUNT_PROTOCOL.inferenceEndpoint,
    countRequestDigest: countDigest.ok ? countDigest.value : "invalid",
    generationOnlyFieldsRemainBound: ["max_output_tokens"],
  });
  if (
    !inferenceBytes.ok ||
    !inferenceDigest.ok ||
    !countBytes.ok ||
    !countDigest.ok ||
    !relationshipDigest.ok
  )
    return failure("validation", "M9b.9 request cannot be canonicalized.");
  const body = requestBindingBodySchema.parse({
    protocol: "lachesis-m9b9-single-source-request-binding/1",
    requestClass: input.requestClass,
    comparisonDigest: input.comparisonDigest,
    scheduleDigest: input.scheduleDigest,
    population: input.population,
    pairId: input.pairId,
    arm: input.arm,
    phase: input.phase,
    callIndex: input.callIndex,
    identities: input.identities,
    providerRequest: providerRequest.data,
    inferenceRequestBytes: inferenceBytes.value,
    inferenceRequestDigest: inferenceDigest.value,
    countRequest,
    countRequestBytes: countBytes.value,
    countRequestDigest: countDigest.value,
    relationshipDigest: relationshipDigest.value,
    endpoints: {
      count: M9B9_INPUT_TOKEN_COUNT_PROTOCOL.countEndpoint,
      inference: M9B9_INPUT_TOKEN_COUNT_PROTOCOL.inferenceEndpoint,
    },
    retryLimits: { countAdapter: 0, controller: 0 },
  });
  const bindingDigest = await digestValue(body);
  return bindingDigest.ok
    ? {
        ok: true,
        value: m9b9RequestBindingSchema.parse({
          ...body,
          bindingDigest: bindingDigest.value,
        }),
      }
    : failure("validation", "M9b.9 binding digest failed.");
}

export async function prepareM9b9RequestBinding(
  input: M9b9RequestInput,
): Promise<Result<M9b9RequestBinding, M9b9Failure>> {
  const parsed = requestInputSchema.safeParse(input);
  if (
    !parsed.success ||
    !classMatches(parsed.data.requestClass, parsed.data.arm, parsed.data.phase)
  )
    return failure(
      "validation",
      "M9b.9 request class is invalid or cross-bound.",
    );
  return buildRequestBinding(parsed.data);
}

export async function verifyM9b9RequestBinding(
  value: unknown,
): Promise<Result<M9b9RequestBinding, M9b9Failure>> {
  const parsed = m9b9RequestBindingSchema.safeParse(value);
  if (!parsed.success)
    return failure("validation", "M9b.9 request binding schema rejected.");
  const rebuiltInput = requestInputSchema.safeParse({
    requestClass: parsed.data.requestClass,
    comparisonDigest: parsed.data.comparisonDigest,
    scheduleDigest: parsed.data.scheduleDigest,
    population: parsed.data.population,
    pairId: parsed.data.pairId,
    arm: parsed.data.arm,
    phase: parsed.data.phase,
    callIndex: parsed.data.callIndex,
    instructions: parsed.data.providerRequest.instructions,
    input: parsed.data.providerRequest.input,
    tools: parsed.data.providerRequest.tools,
    structuredOutputSchema: parsed.data.providerRequest.text.format.schema,
    maximumOutputTokens: parsed.data.providerRequest.max_output_tokens,
    identities: parsed.data.identities,
  });
  if (!rebuiltInput.success)
    return failure(
      "validation",
      "M9b.9 request binding cannot be reconstructed.",
    );
  const rebuilt = await buildRequestBinding(rebuiltInput.data);
  return rebuilt.ok && canonicalEqual(rebuilt.value, parsed.data)
    ? rebuilt
    : failure("validation", "M9b.9 request binding failed rederivation.");
}

const countResponseSchema = z
  .strictObject({
    object: z.literal("response.input_tokens"),
    input_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .readonly();

const countReceiptBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b9-verified-count-receipt/1"),
    bindingDigest: digestSchema,
    countRequestDigest: digestSchema,
    modelIdentityDigest: digestSchema,
    endpoint: z.literal("POST /v1/responses/input_tokens"),
    rawResponseBytes: z.string().min(1).max(1_048_576),
    rawResponseDigest: digestSchema,
    responseObject: z.literal("response.input_tokens"),
    inputTokens: z.number().int().positive().max(922_000),
    providerHttpRequests: z.literal(1),
    inferenceRequests: z.literal(0),
    modelCalls: z.literal(0),
  })
  .readonly();
export const m9b9CountReceiptSchema = countReceiptBodySchema
  .unwrap()
  .safeExtend({ receiptDigest: digestSchema })
  .readonly();
export type M9b9CountReceipt = z.infer<typeof m9b9CountReceiptSchema>;

export type M9b9OfflineFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type M9b9CountAdapterSettings = Readonly<{
  mode: "intercepted-offline";
  interceptedFetch: M9b9OfflineFetch;
  baseUrl: "https://api.openai.com/v1";
  timeoutMs: number;
}>;

const countAdapterSettingsSchema = z
  .strictObject({
    mode: z.literal("intercepted-offline"),
    interceptedFetch: z.custom<M9b9OfflineFetch>(
      (value) => typeof value === "function",
    ),
    baseUrl: z.literal("https://api.openai.com/v1"),
    timeoutMs: z.number().int().positive().max(3_600_000),
  })
  .readonly();

export type M9b9CountDispatchOutcome =
  | Readonly<{ kind: "verified"; receipt: M9b9CountReceipt }>
  | Readonly<{
      kind: "rejected" | "ambiguous" | "cancelled-before-dispatch";
      message: string;
      providerHttpRequests: 0 | 1;
      inferenceRequests: 0;
      modelCalls: 0;
    }>;

export async function recordM9b9PrerecordedInputTokenCount(
  bindingInput: unknown,
  responseInput: unknown,
): Promise<Result<M9b9CountReceipt, M9b9Failure>> {
  const binding = await verifyM9b9RequestBinding(bindingInput);
  const parsed = countResponseSchema.safeParse(responseInput);
  if (
    !binding.ok ||
    !parsed.success ||
    parsed.data.input_tokens === 0 ||
    parsed.data.input_tokens > 922_000
  )
    return failure(
      "validation",
      "M9b.9 prerecorded count response identity or count is invalid.",
    );
  const rawResponseBytes = canonicalizeJson(parsed.data);
  const rawResponseDigest = await digestValue(parsed.data);
  const modelIdentityDigest = await digestValue(binding.value.identities.model);
  if (!rawResponseBytes.ok || !rawResponseDigest.ok || !modelIdentityDigest.ok)
    return failure(
      "validation",
      "M9b.9 prerecorded count receipt cannot be canonicalized.",
    );
  const body = countReceiptBodySchema.parse({
    protocol: "lachesis-m9b9-verified-count-receipt/1",
    bindingDigest: binding.value.bindingDigest,
    countRequestDigest: binding.value.countRequestDigest,
    modelIdentityDigest: modelIdentityDigest.value,
    endpoint: M9B9_INPUT_TOKEN_COUNT_PROTOCOL.countEndpoint,
    rawResponseBytes: rawResponseBytes.value,
    rawResponseDigest: rawResponseDigest.value,
    responseObject: parsed.data.object,
    inputTokens: parsed.data.input_tokens,
    providerHttpRequests: 1,
    inferenceRequests: 0,
    modelCalls: 0,
  });
  const receiptDigest = await digestValue(body);
  return receiptDigest.ok
    ? {
        ok: true,
        value: m9b9CountReceiptSchema.parse({
          ...body,
          receiptDigest: receiptDigest.value,
        }),
      }
    : failure("validation", "M9b.9 count receipt digest failed.");
}

export async function dispatchM9b9InputTokenCount(
  bindingInput: unknown,
  settingsInput: unknown,
  signal: AbortSignal,
  authority?: M9b9LiveExecutionAuthority,
): Promise<Result<M9b9CountDispatchOutcome, M9b9Failure>> {
  if (!(await verifyLiveExecutionAuthority(authority)))
    return failure(
      "capacity-rejected",
      "M9b.9c count transport has no positive authority artifact.",
    );
  const binding = await verifyM9b9RequestBinding(bindingInput);
  if (!binding.ok) return binding;
  const settings = countAdapterSettingsSchema.safeParse(settingsInput);
  if (!settings.success)
    return failure("validation", "M9b.9 count adapter settings drifted.");
  if (signal.aborted)
    return {
      ok: true,
      value: {
        kind: "cancelled-before-dispatch",
        message: "Count request cancelled before transport.",
        providerHttpRequests: 0,
        inferenceRequests: 0,
        modelCalls: 0,
      },
    };
  let fetches = 0;
  const combinedSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(settings.data.timeoutMs),
  ]);
  let response: Response;
  try {
    fetches += 1;
    response = await settings.data.interceptedFetch(
      `${settings.data.baseUrl}/responses/input_tokens`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer offline-intercepted-not-a-credential",
          "content-type": "application/json",
        },
        body: binding.value.countRequestBytes,
        signal: combinedSignal,
      },
    );
  } catch {
    return {
      ok: true,
      value: {
        kind: "ambiguous",
        message:
          "Count transport may have occurred without a verified response.",
        providerHttpRequests: 1,
        inferenceRequests: 0,
        modelCalls: 0,
      },
    };
  }
  if (fetches !== 1)
    return failure("validation", "M9b.9 count adapter retried transport.");
  let rawText: string;
  try {
    rawText = await response.text();
  } catch {
    return {
      ok: true,
      value: {
        kind: "ambiguous",
        message: "Count response body could not be durably observed.",
        providerHttpRequests: 1,
        inferenceRequests: 0,
        modelCalls: 0,
      },
    };
  }
  if (!response.ok)
    return {
      ok: true,
      value: {
        kind: "rejected",
        message: `Count endpoint returned HTTP ${response.status}.`,
        providerHttpRequests: 1,
        inferenceRequests: 0,
        modelCalls: 0,
      },
    };
  const decoded = parseJson(rawText);
  const parsed = decoded.ok
    ? countResponseSchema.safeParse(decoded.value)
    : undefined;
  if (
    parsed === undefined ||
    !parsed.success ||
    parsed.data.input_tokens === 0 ||
    parsed.data.input_tokens > 922_000
  )
    return {
      ok: true,
      value: {
        kind: "rejected",
        message: "Count endpoint response identity or count is invalid.",
        providerHttpRequests: 1,
        inferenceRequests: 0,
        modelCalls: 0,
      },
    };
  const receipt = await recordM9b9PrerecordedInputTokenCount(
    binding.value,
    parsed.data,
  );
  return receipt.ok
    ? {
        ok: true,
        value: {
          kind: "verified",
          receipt: receipt.value,
        },
      }
    : receipt;
}

export async function verifyM9b9CountReceipt(
  bindingInput: unknown,
  receiptInput: unknown,
): Promise<Result<M9b9CountReceipt, M9b9Failure>> {
  const binding = await verifyM9b9RequestBinding(bindingInput);
  const receipt = m9b9CountReceiptSchema.safeParse(receiptInput);
  if (!binding.ok || !receipt.success)
    return failure("validation", "M9b.9 count receipt schema rejected.");
  const raw = parseJson(receipt.data.rawResponseBytes);
  if (!raw.ok)
    return failure(
      "validation",
      "M9b.9 count receipt raw response is invalid.",
    );
  const response = countResponseSchema.safeParse(raw.value);
  const rawDigest = await digestValue(raw.value);
  const modelDigest = await digestValue(binding.value.identities.model);
  const { receiptDigest: _receiptDigest, ...receiptBody } = receipt.data;
  void _receiptDigest;
  const body = countReceiptBodySchema.safeParse(receiptBody);
  if (!body.success)
    return failure("validation", "M9b.9 count receipt body is invalid.");
  const receiptDigest = await digestValue(body.data);
  return response.success &&
    rawDigest.ok &&
    modelDigest.ok &&
    receiptDigest.ok &&
    response.data.input_tokens === receipt.data.inputTokens &&
    receipt.data.bindingDigest === binding.value.bindingDigest &&
    receipt.data.countRequestDigest === binding.value.countRequestDigest &&
    receipt.data.rawResponseDigest === rawDigest.value &&
    receipt.data.modelIdentityDigest === modelDigest.value &&
    receipt.data.receiptDigest === receiptDigest.value
    ? { ok: true, value: receipt.data }
    : failure(
        "validation",
        "M9b.9 count receipt failed complete rederivation.",
      );
}

const reservationBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b9-exact-count-inference-reservation/1"),
    bindingDigest: digestSchema,
    countReceiptDigest: digestSchema,
    inputTokens: z.number().int().positive().max(922_000),
    maximumOutputTokens: z.number().int().positive().max(128_000),
    maximumReasoningTokens: z.literal(0),
    highestInputRateClass: z.literal(
      "maximum-of-uncached-cached-read-cache-write",
    ),
    inputRateUsdMicrosPerMillionTokens: safeCountSchema,
    outputRateUsdMicrosPerMillionTokens: safeCountSchema,
    longContext: z.boolean(),
    longContextInputMultiplierMicros: z.number().int().min(1_000_000),
    longContextOutputMultiplierMicros: z.number().int().min(1_000_000),
    maximumCostUsdMicros: safeCountSchema,
  })
  .readonly();
export const m9b9InferenceReservationSchema = reservationBodySchema
  .unwrap()
  .safeExtend({ reservationDigest: digestSchema })
  .readonly();
export type M9b9InferenceReservation = z.infer<
  typeof m9b9InferenceReservationSchema
>;

function pricedCeiling(
  inputTokens: number,
  outputTokens: number,
  pricing: z.infer<typeof pricingIdentitySchema>,
): number | undefined {
  const inputRate = Math.max(
    pricing.uncachedInputUsdMicrosPerMillionTokens,
    pricing.cachedReadUsdMicrosPerMillionTokens,
    pricing.cacheWriteUsdMicrosPerMillionTokens,
  );
  const long = inputTokens > pricing.longContextThresholdTokens;
  const inputMultiplier = long
    ? pricing.longContextInputMultiplierMicros
    : 1_000_000;
  const outputMultiplier = long
    ? pricing.longContextOutputMultiplierMicros
    : 1_000_000;
  const numerator =
    BigInt(inputTokens) * BigInt(inputRate) * BigInt(inputMultiplier) +
    BigInt(outputTokens) *
      BigInt(pricing.outputUsdMicrosPerMillionTokens) *
      BigInt(outputMultiplier);
  const denominator = 1_000_000_000_000n;
  const result = (numerator + denominator - 1n) / denominator;
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : undefined;
}

export async function reserveM9b9Inference(
  bindingInput: unknown,
  receiptInput: unknown,
): Promise<Result<M9b9InferenceReservation, M9b9Failure>> {
  const binding = await verifyM9b9RequestBinding(bindingInput);
  if (!binding.ok) return binding;
  const receipt = await verifyM9b9CountReceipt(binding.value, receiptInput);
  if (!receipt.ok) return receipt;
  const outputTokens = binding.value.providerRequest.max_output_tokens;
  if (receipt.value.inputTokens + outputTokens > 1_050_000)
    return failure(
      "count-rejected",
      "Count exceeds the frozen context window.",
    );
  const cost = pricedCeiling(
    receipt.value.inputTokens,
    outputTokens,
    binding.value.identities.pricing,
  );
  if (cost === undefined)
    return failure("validation", "M9b.9 inference reservation overflowed.");
  const pricing = binding.value.identities.pricing;
  const body = reservationBodySchema.parse({
    protocol: "lachesis-m9b9-exact-count-inference-reservation/1",
    bindingDigest: binding.value.bindingDigest,
    countReceiptDigest: receipt.value.receiptDigest,
    inputTokens: receipt.value.inputTokens,
    maximumOutputTokens: outputTokens,
    maximumReasoningTokens: 0,
    highestInputRateClass: "maximum-of-uncached-cached-read-cache-write",
    inputRateUsdMicrosPerMillionTokens: Math.max(
      pricing.uncachedInputUsdMicrosPerMillionTokens,
      pricing.cachedReadUsdMicrosPerMillionTokens,
      pricing.cacheWriteUsdMicrosPerMillionTokens,
    ),
    outputRateUsdMicrosPerMillionTokens:
      pricing.outputUsdMicrosPerMillionTokens,
    longContext: receipt.value.inputTokens > pricing.longContextThresholdTokens,
    longContextInputMultiplierMicros:
      receipt.value.inputTokens > pricing.longContextThresholdTokens
        ? pricing.longContextInputMultiplierMicros
        : 1_000_000,
    longContextOutputMultiplierMicros:
      receipt.value.inputTokens > pricing.longContextThresholdTokens
        ? pricing.longContextOutputMultiplierMicros
        : 1_000_000,
    maximumCostUsdMicros: cost,
  });
  const reservationDigest = await digestValue(body);
  return reservationDigest.ok
    ? {
        ok: true,
        value: m9b9InferenceReservationSchema.parse({
          ...body,
          reservationDigest: reservationDigest.value,
        }),
      }
    : failure("validation", "M9b.9 reservation digest failed.");
}

export async function verifyM9b9InferenceReservation(
  bindingInput: unknown,
  receiptInput: unknown,
  reservationInput: unknown,
): Promise<Result<M9b9InferenceReservation, M9b9Failure>> {
  const parsed = m9b9InferenceReservationSchema.safeParse(reservationInput);
  const rebuilt = await reserveM9b9Inference(bindingInput, receiptInput);
  return parsed.success &&
    rebuilt.ok &&
    canonicalEqual(parsed.data, rebuilt.value)
    ? rebuilt
    : failure("validation", "M9b.9 inference reservation failed rederivation.");
}

export const m9b9InferenceUsageSchema = z
  .strictObject({
    inputTokens: safeCountSchema,
    cachedReadTokens: safeCountSchema,
    cacheWriteTokens: safeCountSchema,
    outputTokens: safeCountSchema,
    reasoningTokens: safeCountSchema,
  })
  .superRefine((value, context) => {
    if (
      value.cachedReadTokens + value.cacheWriteTokens > value.inputTokens ||
      value.reasoningTokens > value.outputTokens
    )
      context.addIssue({
        code: "custom",
        message: "M9b.9 provider usage classes are inconsistent.",
      });
  })
  .readonly();
export type M9b9InferenceUsage = z.infer<typeof m9b9InferenceUsageSchema>;

const settlementBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b9-inference-settlement/1"),
    bindingDigest: digestSchema,
    countReceiptDigest: digestSchema,
    reservationDigest: digestSchema,
    countedInputTokens: z.number().int().positive(),
    providerReportedUsage: m9b9InferenceUsageSchema.nullable(),
    relationship: z.enum([
      "equal",
      "provider-lower",
      "provider-higher",
      "missing",
    ]),
    outcome: z.enum(["completed", "accounting-overage", "ambiguous-usage"]),
    chargedUsdMicros: safeCountSchema,
    retainedReservationUsdMicros: safeCountSchema,
    progressionHalted: z.boolean(),
    redispatchPermitted: z.literal(false),
    providerHttpRequests: z.literal(1),
    inferenceRequests: z.literal(1),
    modelCalls: z.literal(1),
  })
  .readonly();
export const m9b9InferenceSettlementSchema = settlementBodySchema
  .unwrap()
  .safeExtend({ settlementDigest: digestSchema })
  .readonly();
export type M9b9InferenceSettlement = z.infer<
  typeof m9b9InferenceSettlementSchema
>;

function exactUsageCost(
  usage: M9b9InferenceUsage,
  pricing: z.infer<typeof pricingIdentitySchema>,
): number | undefined {
  const uncached =
    usage.inputTokens - usage.cachedReadTokens - usage.cacheWriteTokens;
  const long = usage.inputTokens > pricing.longContextThresholdTokens;
  const inputMultiplier = long
    ? pricing.longContextInputMultiplierMicros
    : 1_000_000;
  const outputMultiplier = long
    ? pricing.longContextOutputMultiplierMicros
    : 1_000_000;
  const numerator =
    BigInt(uncached) *
      BigInt(pricing.uncachedInputUsdMicrosPerMillionTokens) *
      BigInt(inputMultiplier) +
    BigInt(usage.cachedReadTokens) *
      BigInt(pricing.cachedReadUsdMicrosPerMillionTokens) *
      BigInt(inputMultiplier) +
    BigInt(usage.cacheWriteTokens) *
      BigInt(pricing.cacheWriteUsdMicrosPerMillionTokens) *
      BigInt(inputMultiplier) +
    BigInt(usage.outputTokens) *
      BigInt(pricing.outputUsdMicrosPerMillionTokens) *
      BigInt(outputMultiplier) +
    BigInt(usage.reasoningTokens) *
      BigInt(pricing.reasoningUsdMicrosPerMillionTokens) *
      BigInt(outputMultiplier);
  const denominator = 1_000_000_000_000n;
  const cost = (numerator + denominator - 1n) / denominator;
  return cost <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cost) : undefined;
}

export async function settleM9b9Inference(
  bindingInput: unknown,
  receiptInput: unknown,
  reservationInput: unknown,
  usageInput: unknown,
): Promise<Result<M9b9InferenceSettlement, M9b9Failure>> {
  const binding = await verifyM9b9RequestBinding(bindingInput);
  if (!binding.ok) return binding;
  const receipt = await verifyM9b9CountReceipt(binding.value, receiptInput);
  if (!receipt.ok) return receipt;
  const reservation = await verifyM9b9InferenceReservation(
    binding.value,
    receipt.value,
    reservationInput,
  );
  if (!reservation.ok) return reservation;
  const usage =
    usageInput === null
      ? { success: true as const, data: null }
      : m9b9InferenceUsageSchema.safeParse(usageInput);
  if (!usage.success)
    return failure("validation", "M9b.9 inference usage is malformed.");
  const relationship =
    usage.data === null
      ? ("missing" as const)
      : usage.data.inputTokens === receipt.value.inputTokens
        ? ("equal" as const)
        : usage.data.inputTokens < receipt.value.inputTokens
          ? ("provider-lower" as const)
          : ("provider-higher" as const);
  const actualCost =
    usage.data === null
      ? reservation.value.maximumCostUsdMicros
      : exactUsageCost(usage.data, binding.value.identities.pricing);
  if (actualCost === undefined)
    return failure("validation", "M9b.9 inference usage cost overflowed.");
  const outcome =
    relationship === "provider-higher"
      ? ("accounting-overage" as const)
      : relationship === "missing"
        ? ("ambiguous-usage" as const)
        : ("completed" as const);
  const chargedUsdMicros =
    relationship === "missing"
      ? reservation.value.maximumCostUsdMicros
      : actualCost;
  const body = settlementBodySchema.parse({
    protocol: "lachesis-m9b9-inference-settlement/1",
    bindingDigest: binding.value.bindingDigest,
    countReceiptDigest: receipt.value.receiptDigest,
    reservationDigest: reservation.value.reservationDigest,
    countedInputTokens: receipt.value.inputTokens,
    providerReportedUsage: usage.data,
    relationship,
    outcome,
    chargedUsdMicros,
    retainedReservationUsdMicros: reservation.value.maximumCostUsdMicros,
    progressionHalted:
      outcome === "accounting-overage" || outcome === "ambiguous-usage",
    redispatchPermitted: false,
    providerHttpRequests: 1,
    inferenceRequests: 1,
    modelCalls: 1,
  });
  const settlementDigest = await digestValue(body);
  return settlementDigest.ok
    ? {
        ok: true,
        value: m9b9InferenceSettlementSchema.parse({
          ...body,
          settlementDigest: settlementDigest.value,
        }),
      }
    : failure("validation", "M9b.9 settlement digest failed.");
}

const FROZEN_CLASS_COUNTS = Object.freeze({
  "root-program-authoring": 65_536,
  "static-one-shot-query-planning": 65_536,
  "discovered-program-leaf-reasoning": 32_768,
  "static-answer-generation": 32_768,
});
const OUTPUT_CEILINGS = Object.freeze({
  "root-program-authoring": 65_536,
  "static-one-shot-query-planning": 65_536,
  "discovered-program-leaf-reasoning": 20_480,
  "static-answer-generation": 20_480,
});
const PROBE_PAIRS = 24;
const PRIMARY_PAIRS = 168;
const CAMPAIGN_PAIRS = PROBE_PAIRS + PRIMARY_PAIRS;
const REQUESTS_PER_PAIR = 4;
const INFERENCE_REQUESTS = CAMPAIGN_PAIRS * REQUESTS_PER_PAIR;
const ORIGINAL_CAP_USD_MICROS = 117_964_800;
const M9B8_EXPOSURE_USD_MICROS = 1_869_330_432;

const classCapacitySchema = z
  .strictObject({
    requestClass: requestClassSchema,
    frozenCountedInputTokensPerRequest: z.number().int().positive(),
    maximumOutputTokensPerRequest: z.number().int().positive(),
    inferenceReservationUsdMicrosPerRequest: safeCountSchema,
    unresolvedCountEffectReservationUsdMicrosPerRequest: safeCountSchema,
    maximumProviderHttpRequestsPerRequest: z.literal(2),
    maximumInferenceCallsPerRequest: z.literal(1),
    maximumModelCallsPerRequest: z.literal(1),
  })
  .readonly();
const capacityTotalsSchema = z
  .strictObject({
    pairedCases: safeCountSchema,
    countEndpointCalls: safeCountSchema,
    inferenceCalls: safeCountSchema,
    providerHttpRequests: safeCountSchema,
    modelCalls: safeCountSchema,
    countedInputTokens: safeCountSchema,
    maximumOutputTokens: safeCountSchema,
    inferenceReservationUsdMicros: safeCountSchema,
    unresolvedCountEffectReservationUsdMicros: safeCountSchema,
    completeExposureUsdMicros: safeCountSchema,
  })
  .readonly();

const capacityReportBodySchema = z
  .strictObject({
    protocol: z.literal(M9B9_INPUT_TOKEN_COUNT_PROTOCOL.id),
    version: z.literal(M9B9_INPUT_TOKEN_COUNT_PROTOCOL.version),
    baselineCommit: z.literal(M9B9_INPUT_TOKEN_COUNT_PROTOCOL.baselineCommit),
    inheritedM9b8ReportDigest: digestSchema,
    identities: m9b9IdentityProfileSchema,
    sourceContract: z
      .strictObject({
        tokenCountingDocumentationUrl: z.literal(
          "https://developers.openai.com/api/docs/guides/token-counting",
        ),
        responsesApiEndpoint: z.literal("POST /v1/responses"),
        countApiEndpoint: z.literal("POST /v1/responses/input_tokens"),
        openApiVersion: z.literal("2.3.0"),
        officialCountIsExactForModelVisibleInput: z.literal(true),
        endpointBillingStatus: z.literal(
          "not-specified-by-pinned-primary-sources",
        ),
        pinnedSdk: z.literal("@ai-sdk/openai@4.0.15"),
        pinnedSdkHasCountOperation: z.literal(false),
        directFetchProfile: z.literal("private-intercepted-zero-retry"),
      })
      .readonly(),
    frozenClassMaxima: classCapacitySchema.array().length(4).readonly(),
    totals: z
      .strictObject({
        perPair: capacityTotalsSchema,
        probe: capacityTotalsSchema,
        primary: capacityTotalsSchema,
        campaign: capacityTotalsSchema,
      })
      .readonly(),
    originalM9b8ExposureUsdMicros: z.literal(M9B8_EXPOSURE_USD_MICROS),
    conditionalInferenceReductionFromM9b8UsdMicros: safeCountSchema,
    completeExposureReductionFromM9b8UsdMicros: z.number().int(),
    originalCampaignCapUsdMicros: z.literal(ORIGINAL_CAP_USD_MICROS),
    completeExposureOverOriginalCapUsdMicros: safeCountSchema,
    fullCompleteStudyCapacityPasses: z.literal(false),
    countPricingTreatment: z.literal(
      "unresolved-charge-full-model-input-at-highest-input-class-and-long-context-multiplier",
    ),
    ambiguityTreatment: z.literal(
      "charge-full-reservation-halt-unscorable-no-redispatch",
    ),
    limits: z
      .strictObject({
        maximumConcurrency: z.literal(1),
        countRetries: z.literal(0),
        inferenceRetries: z.literal(0),
        maximumInputTokens: z.literal(922_000),
        contextWindowTokens: z.literal(1_050_000),
        maximumOutputTokens: z.literal(128_000),
      })
      .readonly(),
    decision: z.literal("token-count-pricing-unknown-no-go"),
    authority: z
      .strictObject({
        offlinePreregistrationPreparationAuthorized: z.literal(false),
        corpusMaterializationAuthorized: z.literal(false),
        externalRegistrationAuthorized: z.literal(false),
        credentialsAuthorized: z.literal(false),
        providerAccessAuthorized: z.literal(false),
        liveExecutionAuthorized: z.literal(false),
      })
      .readonly(),
  })
  .readonly();
export const m9b9CapacityReportSchema = capacityReportBodySchema
  .unwrap()
  .safeExtend({ reportDigest: digestSchema })
  .readonly();
export type M9b9CapacityReport = z.infer<typeof m9b9CapacityReportSchema>;
export type M9b9CapacityToken = Readonly<{ capability: object }>;
const trustedCapacityReports = new WeakMap<
  object,
  Readonly<{
    m9b8Token: M9b8ProspectiveRedesignToken;
    m9b8Report: M9b8ProspectiveRedesignReport;
    identities: M9b9IdentityProfile;
  }>
>();

function safeMultiply(left: number, right: number): number | undefined {
  const product = BigInt(left) * BigInt(right);
  return product <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(product)
    : undefined;
}

function sum(values: ReadonlyArray<number>): number | undefined {
  const total = values.reduce(
    (accumulator, value) => accumulator + BigInt(value),
    0n,
  );
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : undefined;
}

function totalsFor(
  classes: ReadonlyArray<z.infer<typeof classCapacitySchema>>,
  pairs: number,
): z.infer<typeof capacityTotalsSchema> | undefined {
  const perPairInput = sum(
    classes.map((entry) => entry.frozenCountedInputTokensPerRequest),
  );
  const perPairOutput = sum(
    classes.map((entry) => entry.maximumOutputTokensPerRequest),
  );
  const perPairInference = sum(
    classes.map((entry) => entry.inferenceReservationUsdMicrosPerRequest),
  );
  const perPairCount = sum(
    classes.map(
      (entry) => entry.unresolvedCountEffectReservationUsdMicrosPerRequest,
    ),
  );
  if (
    perPairInput === undefined ||
    perPairOutput === undefined ||
    perPairInference === undefined ||
    perPairCount === undefined
  )
    return undefined;
  const countEndpointCalls = safeMultiply(REQUESTS_PER_PAIR, pairs);
  const providerHttpRequests = safeMultiply(REQUESTS_PER_PAIR * 2, pairs);
  const input = safeMultiply(perPairInput, pairs);
  const output = safeMultiply(perPairOutput, pairs);
  const inference = safeMultiply(perPairInference, pairs);
  const count = safeMultiply(perPairCount, pairs);
  const complete =
    inference === undefined || count === undefined
      ? undefined
      : sum([inference, count]);
  if (
    countEndpointCalls === undefined ||
    providerHttpRequests === undefined ||
    input === undefined ||
    output === undefined ||
    inference === undefined ||
    count === undefined ||
    complete === undefined
  )
    return undefined;
  return capacityTotalsSchema.parse({
    pairedCases: pairs,
    countEndpointCalls,
    inferenceCalls: countEndpointCalls,
    providerHttpRequests,
    modelCalls: countEndpointCalls,
    countedInputTokens: input,
    maximumOutputTokens: output,
    inferenceReservationUsdMicros: inference,
    unresolvedCountEffectReservationUsdMicros: count,
    completeExposureUsdMicros: complete,
  });
}

async function deriveCapacityReport(
  m9b8Token: M9b8ProspectiveRedesignToken,
  m9b8Report: M9b8ProspectiveRedesignReport,
  identitiesInput: unknown,
): Promise<Result<M9b9CapacityReport, M9b9Failure>> {
  const baseline = await verifyM9b8ProspectiveRedesign(m9b8Token, m9b8Report);
  const identities = m9b9IdentityProfileSchema.safeParse(identitiesInput);
  if (!baseline.ok || !identities.success)
    return failure(
      "validation",
      "M9b.9 requires verified M9b.8 and identities.",
    );
  if (
    baseline.value.selectedDesign.totals.campaign.requestCount !==
      INFERENCE_REQUESTS ||
    baseline.value.selectedDesign.totals.campaign.maximumCostUsdMicros !==
      M9B8_EXPOSURE_USD_MICROS
  )
    return failure("validation", "M9b.8 topology or exposure drifted.");
  const countFallback = pricedCeiling(922_000, 0, identities.data.pricing);
  if (countFallback === undefined)
    return failure("validation", "M9b.9 count-effect fallback overflowed.");
  const classes: Array<z.infer<typeof classCapacitySchema>> = [];
  for (const requestClass of requestClassSchema.options) {
    const inference = pricedCeiling(
      FROZEN_CLASS_COUNTS[requestClass],
      OUTPUT_CEILINGS[requestClass],
      identities.data.pricing,
    );
    if (inference === undefined)
      return failure("validation", "M9b.9 class reservation overflowed.");
    classes.push(
      classCapacitySchema.parse({
        requestClass,
        frozenCountedInputTokensPerRequest: FROZEN_CLASS_COUNTS[requestClass],
        maximumOutputTokensPerRequest: OUTPUT_CEILINGS[requestClass],
        inferenceReservationUsdMicrosPerRequest: inference,
        unresolvedCountEffectReservationUsdMicrosPerRequest: countFallback,
        maximumProviderHttpRequestsPerRequest: 2,
        maximumInferenceCallsPerRequest: 1,
        maximumModelCallsPerRequest: 1,
      }),
    );
  }
  const perPair = totalsFor(classes, 1);
  const probe = totalsFor(classes, PROBE_PAIRS);
  const primary = totalsFor(classes, PRIMARY_PAIRS);
  const campaign = totalsFor(classes, CAMPAIGN_PAIRS);
  if (
    perPair === undefined ||
    probe === undefined ||
    primary === undefined ||
    campaign === undefined
  )
    return failure("validation", "M9b.9 campaign totals overflowed.");
  const body = capacityReportBodySchema.safeParse({
    protocol: M9B9_INPUT_TOKEN_COUNT_PROTOCOL.id,
    version: M9B9_INPUT_TOKEN_COUNT_PROTOCOL.version,
    baselineCommit: M9B9_INPUT_TOKEN_COUNT_PROTOCOL.baselineCommit,
    inheritedM9b8ReportDigest: baseline.value.reportDigest,
    identities: identities.data,
    sourceContract: {
      tokenCountingDocumentationUrl:
        "https://developers.openai.com/api/docs/guides/token-counting",
      responsesApiEndpoint: M9B9_INPUT_TOKEN_COUNT_PROTOCOL.inferenceEndpoint,
      countApiEndpoint: M9B9_INPUT_TOKEN_COUNT_PROTOCOL.countEndpoint,
      openApiVersion: M9B9_INPUT_TOKEN_COUNT_PROTOCOL.openApiVersion,
      officialCountIsExactForModelVisibleInput: true,
      endpointBillingStatus: "not-specified-by-pinned-primary-sources",
      pinnedSdk: "@ai-sdk/openai@4.0.15",
      pinnedSdkHasCountOperation: false,
      directFetchProfile: "private-intercepted-zero-retry",
    },
    frozenClassMaxima: classes,
    totals: { perPair, probe, primary, campaign },
    originalM9b8ExposureUsdMicros: M9B8_EXPOSURE_USD_MICROS,
    conditionalInferenceReductionFromM9b8UsdMicros:
      M9B8_EXPOSURE_USD_MICROS - campaign.inferenceReservationUsdMicros,
    completeExposureReductionFromM9b8UsdMicros:
      M9B8_EXPOSURE_USD_MICROS - campaign.completeExposureUsdMicros,
    originalCampaignCapUsdMicros: ORIGINAL_CAP_USD_MICROS,
    completeExposureOverOriginalCapUsdMicros:
      campaign.completeExposureUsdMicros - ORIGINAL_CAP_USD_MICROS,
    fullCompleteStudyCapacityPasses: false,
    countPricingTreatment:
      "unresolved-charge-full-model-input-at-highest-input-class-and-long-context-multiplier",
    ambiguityTreatment: "charge-full-reservation-halt-unscorable-no-redispatch",
    limits: {
      maximumConcurrency: 1,
      countRetries: 0,
      inferenceRetries: 0,
      maximumInputTokens: 922_000,
      contextWindowTokens: 1_050_000,
      maximumOutputTokens: 128_000,
    },
    decision: M9B9_INPUT_TOKEN_COUNT_PROTOCOL.decision,
    authority: {
      offlinePreregistrationPreparationAuthorized: false,
      corpusMaterializationAuthorized: false,
      externalRegistrationAuthorized: false,
      credentialsAuthorized: false,
      providerAccessAuthorized: false,
      liveExecutionAuthorized: false,
    },
  });
  if (!body.success)
    return failure(
      "validation",
      `M9b.9 capacity body rejected: ${body.error.message}`,
    );
  const reportDigest = await digestValue(body.data);
  return reportDigest.ok
    ? {
        ok: true,
        value: m9b9CapacityReportSchema.parse({
          ...body.data,
          reportDigest: reportDigest.value,
        }),
      }
    : failure("validation", "M9b.9 capacity report digest failed.");
}

export async function prepareM9b9CapacityReview(
  input: Readonly<{
    m9b8Token: M9b8ProspectiveRedesignToken;
    m9b8Report: M9b8ProspectiveRedesignReport;
    identities: M9b9IdentityProfile;
  }>,
): Promise<
  Result<
    Readonly<{ report: M9b9CapacityReport; token: M9b9CapacityToken }>,
    M9b9Failure
  >
> {
  const report = await deriveCapacityReport(
    input.m9b8Token,
    input.m9b8Report,
    input.identities,
  );
  if (!report.ok) return report;
  const capability = Object.freeze({});
  trustedCapacityReports.set(capability, {
    m9b8Token: input.m9b8Token,
    m9b8Report: input.m9b8Report,
    identities: input.identities,
  });
  return { ok: true, value: { report: report.value, token: { capability } } };
}

export async function verifyM9b9CapacityReview(
  token: M9b9CapacityToken,
  value: unknown,
): Promise<Result<M9b9CapacityReport, M9b9Failure>> {
  const trusted = trustedCapacityReports.get(token.capability);
  const parsed = m9b9CapacityReportSchema.safeParse(value);
  if (trusted === undefined || !parsed.success)
    return failure("validation", "Unknown M9b.9 capacity token or report.");
  const rebuilt = await deriveCapacityReport(
    trusted.m9b8Token,
    trusted.m9b8Report,
    trusted.identities,
  );
  return rebuilt.ok && canonicalEqual(rebuilt.value, parsed.data)
    ? rebuilt
    : failure(
        "validation",
        "M9b.9 capacity report failed zero-effect rederivation.",
      );
}

const ledgerEventBodySchema = z
  .strictObject({
    sequence: z.number().int().nonnegative(),
    previousEventDigest: digestSchema.nullable(),
    state: z.enum([
      "prepared",
      "count-reserved",
      "count-dispatch-started",
      "count-completed",
      "inference-reserved",
      "inference-dispatch-started",
      "terminal",
    ]),
    payload: strictJsonValueSchema,
  })
  .readonly();
const ledgerEventSchema = ledgerEventBodySchema
  .unwrap()
  .safeExtend({ eventDigest: digestSchema })
  .readonly();
const ledgerBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b9c-live-authority-ledger/2"),
    attemptId: digestSchema,
    bindingDigest: digestSchema,
    events: ledgerEventSchema.array().min(1).max(8).readonly(),
  })
  .readonly();
export const m9b9LifecycleLedgerSchema = ledgerBodySchema
  .unwrap()
  .safeExtend({ ledgerDigest: digestSchema })
  .readonly();
export type M9b9LifecycleLedger = z.infer<typeof m9b9LifecycleLedgerSchema>;
type M9b9LedgerEvent = z.infer<typeof ledgerEventSchema>;

const countEffectReservationSchema = z
  .strictObject({
    kind: z.literal("count-effect-reservation"),
    bindingDigest: digestSchema,
    maximumProviderHttpRequests: z.literal(1),
    maximumInferenceRequests: z.literal(0),
    maximumModelCalls: z.literal(0),
    pricingStatus: z.literal("unresolved"),
    maximumCostUsdMicros: safeCountSchema,
  })
  .readonly();
const dispatchStartedPayloadSchema = z
  .strictObject({
    kind: z.enum(["count-dispatch", "inference-dispatch"]),
    ownerId: identifierSchema,
    requestDigest: digestSchema,
    retryLimit: z.literal(0),
  })
  .readonly();
const countCompletedPayloadSchema = z
  .strictObject({
    kind: z.literal("count-completed"),
    receipt: m9b9CountReceiptSchema,
  })
  .readonly();
const inferenceReservedPayloadSchema = z
  .strictObject({
    kind: z.literal("inference-reserved"),
    reservation: m9b9InferenceReservationSchema,
    capacityReportDigest: digestSchema,
    capacityRequiredUsdMicros: safeCountSchema,
    capacityAvailableUsdMicros: safeCountSchema,
  })
  .readonly();
const terminalPayloadSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("completed"),
      settlement: m9b9InferenceSettlementSchema,
    })
    .readonly(),
  z
    .strictObject({
      kind: z.enum([
        "count-rejected",
        "count-ambiguous",
        "capacity-rejected",
        "inference-ambiguous",
        "accounting-overage",
      ]),
      message: z.string().min(1).max(2_048),
      chargedUsdMicros: safeCountSchema,
      providerHttpRequests: z.number().int().min(0).max(2),
      inferenceRequests: z.number().int().min(0).max(1),
      modelCalls: z.number().int().min(0).max(1),
      redispatchPermitted: z.literal(false),
    })
    .readonly(),
]);

async function eventFor(
  previous: M9b9LedgerEvent | undefined,
  state: M9b9LedgerEvent["state"],
  payload: unknown,
): Promise<Result<M9b9LedgerEvent, M9b9Failure>> {
  const body = ledgerEventBodySchema.safeParse({
    sequence: previous === undefined ? 0 : previous.sequence + 1,
    previousEventDigest: previous?.eventDigest ?? null,
    state,
    payload,
  });
  if (!body.success)
    return failure("validation", "M9b.9 lifecycle event is invalid.");
  const eventDigest = await digestValue(body.data);
  return eventDigest.ok
    ? {
        ok: true,
        value: ledgerEventSchema.parse({
          ...body.data,
          eventDigest: eventDigest.value,
        }),
      }
    : failure("validation", "M9b.9 lifecycle event digest failed.");
}

async function ledgerFor(
  attemptId: string,
  bindingDigest: string,
  events: ReadonlyArray<M9b9LedgerEvent>,
): Promise<Result<M9b9LifecycleLedger, M9b9Failure>> {
  const body = ledgerBodySchema.safeParse({
    protocol: "lachesis-m9b9c-live-authority-ledger/2",
    attemptId,
    bindingDigest,
    events,
  });
  if (!body.success)
    return failure("validation", "M9b.9 lifecycle ledger is invalid.");
  const ledgerDigest = await digestValue(body.data);
  return ledgerDigest.ok
    ? {
        ok: true,
        value: m9b9LifecycleLedgerSchema.parse({
          ...body.data,
          ledgerDigest: ledgerDigest.value,
        }),
      }
    : failure("validation", "M9b.9 lifecycle ledger digest failed.");
}

function expectedNextState(
  state: M9b9LedgerEvent["state"],
): ReadonlyArray<M9b9LedgerEvent["state"]> {
  switch (state) {
    case "prepared":
      return ["count-reserved"];
    case "count-reserved":
      return ["count-dispatch-started", "terminal"];
    case "count-dispatch-started":
      return ["count-completed", "terminal"];
    case "count-completed":
      return ["inference-reserved", "terminal"];
    case "inference-reserved":
      return ["inference-dispatch-started", "terminal"];
    case "inference-dispatch-started":
      return ["terminal"];
    case "terminal":
      return [];
  }
}

function payloadMatchesState(event: M9b9LedgerEvent): boolean {
  switch (event.state) {
    case "prepared":
      return m9b9RequestBindingSchema.safeParse(event.payload).success;
    case "count-reserved":
      return countEffectReservationSchema.safeParse(event.payload).success;
    case "count-dispatch-started": {
      const parsed = dispatchStartedPayloadSchema.safeParse(event.payload);
      return parsed.success && parsed.data.kind === "count-dispatch";
    }
    case "count-completed":
      return countCompletedPayloadSchema.safeParse(event.payload).success;
    case "inference-reserved":
      return inferenceReservedPayloadSchema.safeParse(event.payload).success;
    case "inference-dispatch-started": {
      const parsed = dispatchStartedPayloadSchema.safeParse(event.payload);
      return parsed.success && parsed.data.kind === "inference-dispatch";
    }
    case "terminal":
      return terminalPayloadSchema.safeParse(event.payload).success;
  }
}

export async function verifyM9b9LifecycleLedger(
  value: unknown,
): Promise<Result<M9b9LifecycleLedger, M9b9Failure>> {
  const parsed = m9b9LifecycleLedgerSchema.safeParse(value);
  if (!parsed.success)
    return failure("validation", "M9b.9 lifecycle ledger schema rejected.");
  for (let index = 0; index < parsed.data.events.length; index += 1) {
    const event = parsed.data.events[index];
    const previous = parsed.data.events[index - 1];
    if (
      event?.sequence !== index ||
      event.previousEventDigest !== (previous?.eventDigest ?? null) ||
      !payloadMatchesState(event) ||
      (previous?.state !== undefined &&
        !expectedNextState(previous.state).includes(event.state))
    )
      return failure("validation", "M9b.9 lifecycle sequence is invalid.");
    const body = ledgerEventBodySchema.parse({
      sequence: event.sequence,
      previousEventDigest: event.previousEventDigest,
      state: event.state,
      payload: event.payload,
    });
    const digest = await digestValue(body);
    if (!digest.ok || digest.value !== event.eventDigest)
      return failure("validation", "M9b.9 lifecycle event chain was altered.");
  }
  const first = parsed.data.events[0];
  const binding =
    first?.state === "prepared"
      ? await verifyM9b9RequestBinding(first.payload)
      : failure("validation", "M9b.9 lifecycle lacks prepared request.");
  if (
    !binding.ok ||
    binding.value.bindingDigest !== parsed.data.bindingDigest ||
    parsed.data.attemptId !== binding.value.relationshipDigest
  )
    return failure(
      "validation",
      "M9b.9 lifecycle request identity is cross-bound.",
    );
  let countReservation:
    z.infer<typeof countEffectReservationSchema> | undefined;
  let countReceipt: M9b9CountReceipt | undefined;
  let inferenceReservation: M9b9InferenceReservation | undefined;
  for (const event of parsed.data.events) {
    switch (event.state) {
      case "prepared":
        break;
      case "count-reserved": {
        const payload = countEffectReservationSchema.parse(event.payload);
        if (payload.bindingDigest !== binding.value.bindingDigest)
          return failure(
            "validation",
            "M9b.9 count reservation is cross-bound.",
          );
        countReservation = payload;
        break;
      }
      case "count-dispatch-started": {
        const payload = dispatchStartedPayloadSchema.parse(event.payload);
        if (payload.requestDigest !== binding.value.countRequestDigest)
          return failure(
            "validation",
            "M9b.9 count dispatch request was altered.",
          );
        break;
      }
      case "count-completed": {
        const payload = countCompletedPayloadSchema.parse(event.payload);
        const verified = await verifyM9b9CountReceipt(
          binding.value,
          payload.receipt,
        );
        if (!verified.ok)
          return failure(
            "validation",
            "M9b.9 persisted count receipt is cross-bound.",
          );
        countReceipt = verified.value;
        break;
      }
      case "inference-reserved": {
        const payload = inferenceReservedPayloadSchema.parse(event.payload);
        if (countReceipt === undefined)
          return failure(
            "validation",
            "M9b.9 inference reservation lacks count receipt.",
          );
        const verified = await verifyM9b9InferenceReservation(
          binding.value,
          countReceipt,
          payload.reservation,
        );
        if (
          !verified.ok ||
          payload.capacityAvailableUsdMicros < payload.capacityRequiredUsdMicros
        )
          return failure(
            "validation",
            "M9b.9 persisted inference reservation is invalid.",
          );
        inferenceReservation = verified.value;
        break;
      }
      case "inference-dispatch-started": {
        const payload = dispatchStartedPayloadSchema.parse(event.payload);
        if (payload.requestDigest !== binding.value.inferenceRequestDigest)
          return failure(
            "validation",
            "M9b.9 inference dispatch request was altered.",
          );
        break;
      }
      case "terminal": {
        const payload = terminalPayloadSchema.parse(event.payload);
        if (payload.kind === "completed") {
          if (countReceipt === undefined || inferenceReservation === undefined)
            return failure(
              "validation",
              "M9b.9 completed terminal lacks receipts.",
            );
          const rebuilt = await settleM9b9Inference(
            binding.value,
            countReceipt,
            inferenceReservation,
            payload.settlement.providerReportedUsage,
          );
          if (!rebuilt.ok || !canonicalEqual(rebuilt.value, payload.settlement))
            return failure(
              "validation",
              "M9b.9 completed settlement was altered.",
            );
        } else if (
          (payload.kind === "count-ambiguous" ||
            payload.kind === "count-rejected") &&
          payload.providerHttpRequests === 1 &&
          payload.chargedUsdMicros !== countReservation?.maximumCostUsdMicros
        )
          return failure(
            "validation",
            "M9b.9 count terminal charge was altered.",
          );
        break;
      }
    }
  }
  const body = ledgerBodySchema.parse({
    protocol: parsed.data.protocol,
    attemptId: parsed.data.attemptId,
    bindingDigest: parsed.data.bindingDigest,
    events: parsed.data.events,
  });
  const digest = await digestValue(body);
  return digest.ok && digest.value === parsed.data.ledgerDigest
    ? { ok: true, value: parsed.data }
    : failure("validation", "M9b.9 lifecycle ledger digest was altered.");
}

export async function prepareM9b9LifecycleLedger(
  bindingInput: unknown,
): Promise<Result<M9b9LifecycleLedger, M9b9Failure>> {
  const binding = await verifyM9b9RequestBinding(bindingInput);
  if (!binding.ok) return binding;
  const initial = await eventFor(undefined, "prepared", binding.value);
  return initial.ok
    ? ledgerFor(binding.value.relationshipDigest, binding.value.bindingDigest, [
        initial.value,
      ])
    : initial;
}

async function appendLedger(
  ledgerInput: unknown,
  state: M9b9LedgerEvent["state"],
  payload: unknown,
): Promise<Result<M9b9LifecycleLedger, M9b9Failure>> {
  const ledger = await verifyM9b9LifecycleLedger(ledgerInput);
  if (!ledger.ok) return ledger;
  const previous = ledger.value.events.at(-1);
  if (
    previous === undefined ||
    !expectedNextState(previous.state).includes(state)
  )
    return failure("validation", "M9b.9 lifecycle transition is forbidden.");
  const next = await eventFor(previous, state, payload);
  return next.ok
    ? ledgerFor(ledger.value.attemptId, ledger.value.bindingDigest, [
        ...ledger.value.events,
        next.value,
      ])
    : next;
}

export type M9b9LedgerStore = Readonly<{
  load: (attemptId: string) => Promise<M9b9LifecycleLedger | undefined>;
  compareAndSwap: (
    attemptId: string,
    expectedLedgerDigest: string | null,
    next: M9b9LifecycleLedger,
  ) => Promise<boolean>;
}>;

export type M9b9InferenceTransport = (
  requestBytes: string,
  signal: AbortSignal,
) => Promise<Readonly<{ usage: M9b9InferenceUsage | null }>>;

export type M9b9LifecycleControllerInput = Readonly<{
  binding: M9b9RequestBinding;
  capacityToken: M9b9CapacityToken;
  capacityReport: M9b9CapacityReport;
  availableCampaignUsdMicros: number;
  store: M9b9LedgerStore;
  countAdapter: M9b9CountAdapterSettings;
  inferenceTransport: M9b9InferenceTransport;
  controllerId: string;
  resumeAfterCrash: boolean;
  signal: AbortSignal;
}>;

export type M9b9OfflineConformanceInput = Readonly<{
  binding: M9b9RequestBinding;
  capacityToken: M9b9CapacityToken;
  capacityReport: M9b9CapacityReport;
  prerecordedCount: M9b9CountReceipt | null;
  prerecordedInferenceUsage: M9b9InferenceUsage | null;
}>;

const offlineConformanceNoGoBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b9c-offline-conformance-no-go/2"),
    mode: z.literal("offline-conformance"),
    bindingDigest: digestSchema,
    capacityReportDigest: digestSchema,
    decision: z.literal("no-go-no-positive-live-authority"),
    countEffectPerformed: z.literal(false),
    inferenceEffectPerformed: z.literal(false),
    credentialAccessed: z.literal(false),
    networkAccessed: z.literal(false),
    dispatchStatePersisted: z.literal(false),
  })
  .readonly();
const offlineConformanceNoGoSchema = offlineConformanceNoGoBodySchema
  .unwrap()
  .safeExtend({ receiptDigest: digestSchema })
  .readonly();
export type M9b9OfflineConformanceNoGo = z.infer<
  typeof offlineConformanceNoGoSchema
>;
export type M9b9OfflineConformanceFailure = Readonly<{
  kind: "capacity-rejected";
  message: string;
  receipt: M9b9OfflineConformanceNoGo;
}>;

async function offlineConformanceNoGo(
  input: M9b9OfflineConformanceInput,
): Promise<Result<never, M9b9Failure | M9b9OfflineConformanceFailure>> {
  const body = offlineConformanceNoGoBodySchema.parse({
    protocol: "lachesis-m9b9c-offline-conformance-no-go/2",
    mode: "offline-conformance",
    bindingDigest: input.binding.bindingDigest,
    capacityReportDigest: input.capacityReport.reportDigest,
    decision: "no-go-no-positive-live-authority",
    countEffectPerformed: false,
    inferenceEffectPerformed: false,
    credentialAccessed: false,
    networkAccessed: false,
    dispatchStatePersisted: false,
  });
  const receiptDigest = await digestValue(body);
  if (!receiptDigest.ok)
    return failure("validation", "M9b.9c NO-GO receipt digest failed.");
  const receipt = offlineConformanceNoGoSchema.parse({
    ...body,
    receiptDigest: receiptDigest.value,
  });
  return {
    ok: false,
    error: {
      kind: "capacity-rejected",
      message:
        "M9b.9c verified authority is NO-GO; every provider effect is forbidden.",
      receipt,
    },
  };
}

const liveAuthorityBrand: unique symbol = Symbol("M9b9LiveExecutionAuthority");
const liveExecutionAuthorityBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b9c-positive-live-execution-authority/1"),
    campaignDigest: digestSchema,
    experimentDigest: digestSchema,
    populationDigest: digestSchema,
    scheduleDigest: digestSchema,
    modelIdentityDigest: digestSchema,
    pricingIdentityDigest: digestSchema,
    hardCapReceiptDigest: digestSchema,
    completeStudyCapacityDigest: digestSchema,
    providerAccessAuthorizationDigest: digestSchema,
    liveExecutionAuthorizationDigest: digestSchema,
    activation: z.literal("active"),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .readonly();
const liveExecutionAuthorityReceiptSchema = liveExecutionAuthorityBodySchema
  .unwrap()
  .safeExtend({ authorityDigest: digestSchema })
  .readonly();
type M9b9LiveExecutionAuthorityReceipt = z.infer<
  typeof liveExecutionAuthorityReceiptSchema
>;
export type M9b9LiveExecutionAuthority = Readonly<{
  [liveAuthorityBrand]: "M9b9LiveExecutionAuthority";
  receipt: M9b9LiveExecutionAuthorityReceipt;
}>;
const liveAuthorities = new WeakSet<M9b9LiveExecutionAuthority>();

async function verifyLiveExecutionAuthority(
  authority: M9b9LiveExecutionAuthority | undefined,
): Promise<boolean> {
  if (authority === undefined || !liveAuthorities.has(authority)) return false;
  const parsed = liveExecutionAuthorityReceiptSchema.safeParse(
    authority.receipt,
  );
  if (!parsed.success) return false;
  const { authorityDigest, ...body } = parsed.data;
  const expectedDigest = await digestValue(body);
  return expectedDigest.ok && expectedDigest.value === authorityDigest;
}

async function persistNext(
  store: M9b9LedgerStore,
  current: M9b9LifecycleLedger | undefined,
  next: M9b9LifecycleLedger,
): Promise<Result<M9b9LifecycleLedger, M9b9Failure>> {
  const saved = await store.compareAndSwap(
    next.attemptId,
    current?.ledgerDigest ?? null,
    next,
  );
  return saved
    ? { ok: true, value: next }
    : failure("persistence", "M9b.9 durable compare-and-swap failed.");
}

function eventPayload<T>(
  event: M9b9LedgerEvent,
  schema: z.ZodType<T>,
): T | undefined {
  const parsed = schema.safeParse(event.payload);
  return parsed.success ? parsed.data : undefined;
}

/** No factory exists until an independently reviewed positive authority protocol does. */
export async function executeM9b9LiveLifecycle(
  input: M9b9LifecycleControllerInput,
  authority?: M9b9LiveExecutionAuthority,
): Promise<Result<M9b9LifecycleLedger, M9b9Failure>> {
  if (!(await verifyLiveExecutionAuthority(authority)))
    return failure(
      "capacity-rejected",
      "M9b.9c live execution has no positive authority artifact.",
    );
  const binding = await verifyM9b9RequestBinding(input.binding);
  const capacity = await verifyM9b9CapacityReview(
    input.capacityToken,
    input.capacityReport,
  );
  if (!binding.ok || !capacity.ok)
    return failure("validation", "M9b.9 lifecycle inputs failed verification.");
  if (!canonicalEqual(binding.value.identities, capacity.value.identities))
    return failure(
      "validation",
      "M9b.9 request and capacity identities differ.",
    );
  if (
    !Number.isSafeInteger(input.availableCampaignUsdMicros) ||
    input.availableCampaignUsdMicros < 0 ||
    input.controllerId.length === 0
  )
    return failure(
      "validation",
      "M9b.9 lifecycle controller settings are invalid.",
    );
  let ledger = await input.store.load(binding.value.relationshipDigest);
  if (ledger === undefined) {
    const prepared = await prepareM9b9LifecycleLedger(binding.value);
    if (!prepared.ok) return prepared;
    const saved = await persistNext(input.store, undefined, prepared.value);
    if (!saved.ok) return saved;
    ledger = saved.value;
  } else {
    const verified = await verifyM9b9LifecycleLedger(ledger);
    if (
      !verified.ok ||
      verified.value.bindingDigest !== binding.value.bindingDigest
    )
      return failure("validation", "M9b.9 persisted lifecycle is cross-bound.");
    ledger = verified.value;
  }
  const persistedCapacity = ledger.events
    .map((event) => eventPayload(event, inferenceReservedPayloadSchema))
    .find((entry) => entry !== undefined);
  if (
    persistedCapacity !== undefined &&
    (persistedCapacity.capacityReportDigest !== capacity.value.reportDigest ||
      persistedCapacity.capacityRequiredUsdMicros !==
        capacity.value.totals.campaign.completeExposureUsdMicros ||
      persistedCapacity.capacityAvailableUsdMicros !==
        input.availableCampaignUsdMicros)
  )
    return failure(
      "validation",
      "M9b.9 persisted capacity authorization drifted.",
    );
  let last = ledger.events.at(-1);
  if (last === undefined)
    return failure("validation", "M9b.9 lifecycle is empty.");
  if (last.state === "terminal") return { ok: true, value: ledger };

  if (last.state === "count-dispatch-started") {
    if (!input.resumeAfterCrash)
      return failure(
        "persistence",
        "M9b.9 count dispatch is owned by another controller.",
      );
    const reserved = ledger.events
      .map((event) => eventPayload(event, countEffectReservationSchema))
      .find((entry) => entry !== undefined);
    if (reserved === undefined)
      return failure("validation", "M9b.9 count ambiguity lacks reservation.");
    const terminal = await appendLedger(ledger, "terminal", {
      kind: "count-ambiguous",
      message:
        "Persisted dispatch-started count effect is conservatively terminal.",
      chargedUsdMicros: reserved.maximumCostUsdMicros,
      providerHttpRequests: 1,
      inferenceRequests: 0,
      modelCalls: 0,
      redispatchPermitted: false,
    });
    return terminal.ok
      ? persistNext(input.store, ledger, terminal.value)
      : terminal;
  }
  if (last.state === "inference-dispatch-started") {
    if (!input.resumeAfterCrash)
      return failure(
        "persistence",
        "M9b.9 inference dispatch is owned by another controller.",
      );
    const reserved = ledger.events
      .map((event) => eventPayload(event, inferenceReservedPayloadSchema))
      .find((entry) => entry !== undefined);
    if (reserved === undefined)
      return failure(
        "validation",
        "M9b.9 inference ambiguity lacks reservation.",
      );
    const terminal = await appendLedger(ledger, "terminal", {
      kind: "inference-ambiguous",
      message:
        "Persisted dispatch-started inference effect is conservatively terminal.",
      chargedUsdMicros: reserved.reservation.maximumCostUsdMicros,
      providerHttpRequests: 2,
      inferenceRequests: 1,
      modelCalls: 1,
      redispatchPermitted: false,
    });
    return terminal.ok
      ? persistNext(input.store, ledger, terminal.value)
      : terminal;
  }

  if (last.state === "prepared") {
    const pricing = binding.value.identities.pricing;
    const fallback = pricedCeiling(922_000, 0, pricing);
    if (fallback === undefined)
      return failure("validation", "M9b.9 count reservation overflowed.");
    const next = await appendLedger(ledger, "count-reserved", {
      kind: "count-effect-reservation",
      bindingDigest: binding.value.bindingDigest,
      maximumProviderHttpRequests: 1,
      maximumInferenceRequests: 0,
      maximumModelCalls: 0,
      pricingStatus: "unresolved",
      maximumCostUsdMicros: fallback,
    });
    if (!next.ok) return next;
    const saved = await persistNext(input.store, ledger, next.value);
    if (!saved.ok) return saved;
    ledger = saved.value;
    last = ledger.events.at(-1);
  }
  if (last?.state === "count-reserved") {
    const next = await appendLedger(ledger, "count-dispatch-started", {
      kind: "count-dispatch",
      ownerId: input.controllerId,
      requestDigest: binding.value.countRequestDigest,
      retryLimit: 0,
    });
    if (!next.ok) return next;
    const saved = await persistNext(input.store, ledger, next.value);
    if (!saved.ok) return saved;
    ledger = saved.value;
    const dispatched = await dispatchM9b9InputTokenCount(
      binding.value,
      input.countAdapter,
      input.signal,
      authority,
    );
    if (!dispatched.ok) return dispatched;
    if (dispatched.value.kind !== "verified") {
      const reservation = ledger.events
        .map((event) => eventPayload(event, countEffectReservationSchema))
        .find((entry) => entry !== undefined);
      if (reservation === undefined)
        return failure("validation", "M9b.9 count terminal lacks reservation.");
      const terminal = await appendLedger(ledger, "terminal", {
        kind:
          dispatched.value.kind === "ambiguous"
            ? "count-ambiguous"
            : "count-rejected",
        message: dispatched.value.message,
        chargedUsdMicros:
          dispatched.value.providerHttpRequests === 1
            ? reservation.maximumCostUsdMicros
            : 0,
        providerHttpRequests: dispatched.value.providerHttpRequests,
        inferenceRequests: 0,
        modelCalls: 0,
        redispatchPermitted: false,
      });
      return terminal.ok
        ? persistNext(input.store, ledger, terminal.value)
        : terminal;
    }
    const completed = await appendLedger(ledger, "count-completed", {
      kind: "count-completed",
      receipt: dispatched.value.receipt,
    });
    if (!completed.ok) return completed;
    const savedCompleted = await persistNext(
      input.store,
      ledger,
      completed.value,
    );
    if (!savedCompleted.ok) return savedCompleted;
    ledger = savedCompleted.value;
    last = ledger.events.at(-1);
  }
  if (last?.state === "count-completed") {
    const completed = eventPayload(last, countCompletedPayloadSchema);
    if (completed === undefined)
      return failure("validation", "M9b.9 count-completed payload is invalid.");
    const countEffectReservation = ledger.events
      .map((event) => eventPayload(event, countEffectReservationSchema))
      .find((entry) => entry !== undefined);
    if (countEffectReservation === undefined)
      return failure(
        "validation",
        "M9b.9 completed count lacks effect reservation.",
      );
    if (
      completed.receipt.inputTokens >
      FROZEN_CLASS_COUNTS[binding.value.requestClass]
    ) {
      const terminal = await appendLedger(ledger, "terminal", {
        kind: "count-rejected",
        message:
          "Count exceeds the prospectively frozen request-class maximum.",
        chargedUsdMicros: countEffectReservation.maximumCostUsdMicros,
        providerHttpRequests: 1,
        inferenceRequests: 0,
        modelCalls: 0,
        redispatchPermitted: false,
      });
      return terminal.ok
        ? persistNext(input.store, ledger, terminal.value)
        : terminal;
    }
    const reservation = await reserveM9b9Inference(
      binding.value,
      completed.receipt,
    );
    if (!reservation.ok) return reservation;
    const required = capacity.value.totals.campaign.completeExposureUsdMicros;
    if (input.availableCampaignUsdMicros < required) {
      const terminal = await appendLedger(ledger, "terminal", {
        kind: "capacity-rejected",
        message:
          "Complete campaign capacity is unavailable after exact counting.",
        chargedUsdMicros: countEffectReservation.maximumCostUsdMicros,
        providerHttpRequests: 1,
        inferenceRequests: 0,
        modelCalls: 0,
        redispatchPermitted: false,
      });
      return terminal.ok
        ? persistNext(input.store, ledger, terminal.value)
        : terminal;
    }
    const next = await appendLedger(ledger, "inference-reserved", {
      kind: "inference-reserved",
      reservation: reservation.value,
      capacityReportDigest: capacity.value.reportDigest,
      capacityRequiredUsdMicros: required,
      capacityAvailableUsdMicros: input.availableCampaignUsdMicros,
    });
    if (!next.ok) return next;
    const saved = await persistNext(input.store, ledger, next.value);
    if (!saved.ok) return saved;
    ledger = saved.value;
    last = ledger.events.at(-1);
  }
  if (last?.state === "inference-reserved") {
    const next = await appendLedger(ledger, "inference-dispatch-started", {
      kind: "inference-dispatch",
      ownerId: input.controllerId,
      requestDigest: binding.value.inferenceRequestDigest,
      retryLimit: 0,
    });
    if (!next.ok) return next;
    const saved = await persistNext(input.store, ledger, next.value);
    if (!saved.ok) return saved;
    ledger = saved.value;
    let response: Readonly<{ usage: M9b9InferenceUsage | null }>;
    try {
      response = await input.inferenceTransport(
        binding.value.inferenceRequestBytes,
        input.signal,
      );
    } catch {
      const reserved = ledger.events
        .map((event) => eventPayload(event, inferenceReservedPayloadSchema))
        .find((entry) => entry !== undefined);
      if (reserved === undefined)
        return failure(
          "validation",
          "M9b.9 inference ambiguity lacks reservation.",
        );
      const terminal = await appendLedger(ledger, "terminal", {
        kind: "inference-ambiguous",
        message:
          "Inference transport may have occurred without verified usage.",
        chargedUsdMicros: reserved.reservation.maximumCostUsdMicros,
        providerHttpRequests: 2,
        inferenceRequests: 1,
        modelCalls: 1,
        redispatchPermitted: false,
      });
      return terminal.ok
        ? persistNext(input.store, ledger, terminal.value)
        : terminal;
    }
    const completed = ledger.events
      .map((event) => eventPayload(event, countCompletedPayloadSchema))
      .find((entry) => entry !== undefined);
    const reserved = ledger.events
      .map((event) => eventPayload(event, inferenceReservedPayloadSchema))
      .find((entry) => entry !== undefined);
    if (completed === undefined || reserved === undefined)
      return failure(
        "validation",
        "M9b.9 inference settlement lacks receipts.",
      );
    const settlement = await settleM9b9Inference(
      binding.value,
      completed.receipt,
      reserved.reservation,
      response.usage,
    );
    if (!settlement.ok) return settlement;
    const terminal = await appendLedger(
      ledger,
      "terminal",
      settlement.value.outcome === "completed"
        ? { kind: "completed", settlement: settlement.value }
        : {
            kind:
              settlement.value.outcome === "accounting-overage"
                ? "accounting-overage"
                : "inference-ambiguous",
            message: `Inference settled as ${settlement.value.outcome}.`,
            chargedUsdMicros: settlement.value.chargedUsdMicros,
            providerHttpRequests: 2,
            inferenceRequests: 1,
            modelCalls: 1,
            redispatchPermitted: false,
          },
    );
    return terminal.ok
      ? persistNext(input.store, ledger, terminal.value)
      : terminal;
  }
  return failure(
    "validation",
    "M9b.9 lifecycle did not reach a terminal state.",
  );
}

/**
 * Fail-closed authority boundary for the frozen M9b.9 report. The only trusted
 * M9b.9 report is explicitly NO-GO, so verification can never reach session,
 * persistence, credential, count, or inference effects. A later live protocol
 * must introduce independently reviewed positive authority rather than
 * reinterpreting this artifact.
 */
export async function executeM9b9OfflineLifecycle(
  input: M9b9OfflineConformanceInput,
): Promise<
  Result<M9b9LifecycleLedger, M9b9Failure | M9b9OfflineConformanceFailure>
> {
  return executeM9b9OfflineConformanceLifecycle(input);
}

/**
 * Offline conformance consumes only prerecorded values. It owns no store,
 * session, credential, fetch, count-adapter, or inference-transport capability.
 */
export async function executeM9b9OfflineConformanceLifecycle(
  input: M9b9OfflineConformanceInput,
): Promise<
  Result<M9b9LifecycleLedger, M9b9Failure | M9b9OfflineConformanceFailure>
> {
  if (
    Object.hasOwn(input, "store") ||
    Object.hasOwn(input, "countAdapter") ||
    Object.hasOwn(input, "inferenceTransport") ||
    Object.hasOwn(input, "credential") ||
    Object.hasOwn(input, "session") ||
    Object.hasOwn(input, "fetch")
  )
    return offlineConformanceNoGo(input);
  const binding = await verifyM9b9RequestBinding(input.binding);
  const capacity = await verifyM9b9CapacityReview(
    input.capacityToken,
    input.capacityReport,
  );
  if (!binding.ok || !capacity.ok)
    return failure("validation", "M9b.9 lifecycle inputs failed verification.");
  return offlineConformanceNoGo(input);
}
