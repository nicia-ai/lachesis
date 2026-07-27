import {
  canonicalizeJson,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

export const M9B5_OPENAI_RESPONSES_PROTOCOL = Object.freeze({
  id: "lachesis-m9b5-openai-responses-offline-conformance",
  version: "1.2.0",
  visibility: "private-offline-conformance-only" as const,
  sdk: Object.freeze({
    package: "@ai-sdk/openai",
    version: "4.0.15",
    runtimePackage: "ai",
    runtimeVersion: "7.0.28",
    requestMethod: "LanguageModelV4.doGenerate",
    retryLimit: 0,
  }),
  transport: Object.freeze({
    route: "/v1/responses",
    method: "POST",
    maximumFetches: 1,
    streaming: false,
    polling: false,
  }),
  tokenizerDecision: "adapter-conformance-pass-tokenizer-no-go" as const,
  claimBoundary:
    "offline intercepted transport evidence only; no exact tokenizer claim, credential, network call, provider entitlement, campaign readiness, or live authorization",
});

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z.string().min(1).max(160);
const requestClassSchema = z.enum([
  "root-program-authoring",
  "static-one-shot-query-planning",
  "discovered-program-leaf-reasoning",
  "static-answer-generation",
]);
export type M9b5RequestClass = z.infer<typeof requestClassSchema>;

const armSchema = z.enum(["discovered-program", "static-one-shot"]);
const phaseSchema = z.enum(["authoring", "execution"]);
const artifactIdentitySchema = z
  .strictObject({
    id: identifierSchema,
    version: identifierSchema,
    artifactDigest: digestSchema,
  })
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
    reasoningUsdMicrosPerMillionTokens: z.literal(0),
    longContextThresholdTokens: z.number().int().positive(),
    longContextInputMultiplierMicros: z.number().int().min(1_000_000),
    longContextOutputMultiplierMicros: z.number().int().min(1_000_000),
  })
  .readonly();
const serializerIdentitySchema = artifactIdentitySchema
  .unwrap()
  .safeExtend({ providerId: identifierSchema })
  .readonly();
/** @internal Private composition seam for offline protocol verification. */
export const m9b5IdentityProfileSchema = z
  .strictObject({
    provider: providerIdentitySchema,
    model: modelIdentitySchema,
    tokenizer: tokenizerIdentitySchema,
    pricingSnapshot: pricingIdentitySchema,
    serializer: serializerIdentitySchema,
  })
  .readonly();

export type M9b5IdentityProfile = Readonly<{
  provider: z.infer<typeof providerIdentitySchema>;
  model: z.infer<typeof modelIdentitySchema>;
  tokenizer: z.infer<typeof tokenizerIdentitySchema>;
  pricingSnapshot: z.infer<typeof pricingIdentitySchema>;
  serializer: z.infer<typeof serializerIdentitySchema>;
}>;

const strictJsonValueSchema = z.custom<z.infer<ReturnType<typeof z.json>>>(
  (value) => canonicalizeJson(value).ok,
  "Expected a strict, non-transforming JSON value.",
);

const stringArraySchema = z.array(z.string().min(1).max(512)).max(128);
const outputSchemas = Object.freeze({
  "root-program-authoring": z
    .strictObject({ source: z.string().min(1).max(65_536) })
    .readonly(),
  "static-one-shot-query-planning": z
    .strictObject({ query: z.string().min(1).max(4_096) })
    .readonly(),
  "discovered-program-leaf-reasoning": z
    .strictObject({
      answer: z.string().min(1).max(65_536),
      citationIds: stringArraySchema,
    })
    .readonly(),
  "static-answer-generation": z
    .strictObject({
      answer: z.string().min(1).max(65_536),
      citationIds: stringArraySchema,
    })
    .readonly(),
});

export const M9B5_OUTPUT_JSON_SCHEMAS = Object.freeze({
  "root-program-authoring": Object.freeze({
    type: "object",
    properties: Object.freeze({
      source: Object.freeze({
        type: "string",
        minLength: 1,
        maxLength: 65_536,
      }),
    }),
    required: Object.freeze(["source"]),
    additionalProperties: false,
  }),
  "static-one-shot-query-planning": Object.freeze({
    type: "object",
    properties: Object.freeze({
      query: Object.freeze({ type: "string", minLength: 1, maxLength: 4_096 }),
    }),
    required: Object.freeze(["query"]),
    additionalProperties: false,
  }),
  "discovered-program-leaf-reasoning": Object.freeze({
    type: "object",
    properties: Object.freeze({
      answer: Object.freeze({
        type: "string",
        minLength: 1,
        maxLength: 65_536,
      }),
      citationIds: Object.freeze({
        type: "array",
        items: Object.freeze({ type: "string", minLength: 1, maxLength: 512 }),
        maxItems: 128,
      }),
    }),
    required: Object.freeze(["answer", "citationIds"]),
    additionalProperties: false,
  }),
  "static-answer-generation": Object.freeze({
    type: "object",
    properties: Object.freeze({
      answer: Object.freeze({
        type: "string",
        minLength: 1,
        maxLength: 65_536,
      }),
      citationIds: Object.freeze({
        type: "array",
        items: Object.freeze({ type: "string", minLength: 1, maxLength: 512 }),
        maxItems: 128,
      }),
    }),
    required: Object.freeze(["answer", "citationIds"]),
    additionalProperties: false,
  }),
});

const classBinding = Object.freeze({
  "root-program-authoring": Object.freeze({
    arm: "discovered-program" as const,
    phase: "authoring" as const,
  }),
  "static-one-shot-query-planning": Object.freeze({
    arm: "static-one-shot" as const,
    phase: "authoring" as const,
  }),
  "discovered-program-leaf-reasoning": Object.freeze({
    arm: "discovered-program" as const,
    phase: "execution" as const,
  }),
  "static-answer-generation": Object.freeze({
    arm: "static-one-shot" as const,
    phase: "execution" as const,
  }),
});

const vectorInputSchema = z
  .strictObject({
    requestClass: requestClassSchema,
    comparisonDigest: digestSchema,
    arm: armSchema,
    phase: phaseSchema,
    callIndex: z.number().int().nonnegative(),
    instructions: z.string().min(1).max(131_072),
    input: z.string().min(1).max(524_288),
    maximumOutputTokens: z.number().int().positive().max(1_000_000),
    identities: m9b5IdentityProfileSchema,
  })
  .readonly();

const vectorBodySchema = z
  .strictObject({
    protocol: z.literal(M9B5_OPENAI_RESPONSES_PROTOCOL.id),
    version: z.literal(M9B5_OPENAI_RESPONSES_PROTOCOL.version),
    requestClass: requestClassSchema,
    comparisonDigest: digestSchema,
    arm: armSchema,
    phase: phaseSchema,
    callIndex: z.number().int().nonnegative(),
    attemptCoordinateDigest: digestSchema,
    identities: m9b5IdentityProfileSchema,
    modelVisible: z
      .strictObject({ instructions: z.string(), input: z.string() })
      .readonly(),
    responseSchema: strictJsonValueSchema,
    responseSchemaDigest: digestSchema,
    providerRequest: strictJsonValueSchema,
    providerRequestBytes: z.string().min(1),
    providerRequestDigest: digestSchema,
    maximumOutputTokens: z.number().int().positive(),
    retryLimits: z
      .strictObject({ sdk: z.literal(0), controller: z.literal(0) })
      .readonly(),
  })
  .readonly();

export const m9b5ConformanceVectorSchema = vectorBodySchema
  .unwrap()
  .safeExtend({
    serializedRequest: z.string().min(1),
    requestDigest: digestSchema,
  })
  .readonly();
export type M9b5ConformanceVector = z.infer<typeof m9b5ConformanceVectorSchema>;

export type M9b5PreparationFailure = Readonly<{
  kind: "validation";
  message: string;
}>;

function invalid(message: string): Result<never, M9b5PreparationFailure> {
  return { ok: false, error: { kind: "validation", message } };
}

function hasHostileKey(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((entry) => hasHostileKey(entry));
  return Object.keys(value).some(
    (key) =>
      key === "__proto__" ||
      key === "prototype" ||
      key === "constructor" ||
      hasHostileKey(Reflect.get(value, key)),
  );
}

function providerRequestFor(
  input: z.infer<typeof vectorInputSchema>,
  responseSchema: unknown,
): Readonly<Record<string, unknown>> {
  return {
    include: ["reasoning.encrypted_content"],
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: input.input }],
      },
    ],
    instructions: input.instructions,
    max_output_tokens: input.maximumOutputTokens,
    model: input.identities.model.version,
    reasoning: { effort: "none" },
    service_tier: "default",
    store: false,
    text: {
      format: {
        name: input.requestClass.replaceAll("-", "_"),
        schema: responseSchema,
        strict: true,
        type: "json_schema",
      },
    },
    truncation: "disabled",
  };
}

function identitiesAgree(identities: M9b5IdentityProfile): boolean {
  return (
    identities.model.providerId === identities.provider.id &&
    identities.tokenizer.providerId === identities.provider.id &&
    identities.pricingSnapshot.providerId === identities.provider.id &&
    identities.serializer.providerId === identities.provider.id
  );
}

export async function prepareM9b5ConformanceVector(
  input: z.input<typeof vectorInputSchema>,
): Promise<Result<M9b5ConformanceVector, M9b5PreparationFailure>> {
  const parsed = vectorInputSchema.safeParse(input);
  if (!parsed.success)
    return invalid("Invalid M9b.5 conformance vector input.");
  const expected = classBinding[parsed.data.requestClass];
  if (
    parsed.data.arm !== expected.arm ||
    parsed.data.phase !== expected.phase ||
    !identitiesAgree(parsed.data.identities)
  )
    return invalid("M9b.5 request class or identity profile is cross-bound.");
  const responseSchema = M9B5_OUTPUT_JSON_SCHEMAS[parsed.data.requestClass];
  const attemptCoordinateDigest = await digestValue({
    comparisonDigest: parsed.data.comparisonDigest,
    arm: parsed.data.arm,
    phase: parsed.data.phase,
    callIndex: parsed.data.callIndex,
  });
  const responseSchemaDigest = await digestValue(responseSchema);
  const providerRequest = providerRequestFor(parsed.data, responseSchema);
  const providerRequestBytes = canonicalizeJson(providerRequest);
  const providerRequestDigest = await digestValue(providerRequest);
  if (
    !attemptCoordinateDigest.ok ||
    !responseSchemaDigest.ok ||
    !providerRequestBytes.ok ||
    !providerRequestDigest.ok
  )
    return invalid("M9b.5 request artifacts are not strict canonical JSON.");
  const body = vectorBodySchema.parse({
    protocol: M9B5_OPENAI_RESPONSES_PROTOCOL.id,
    version: M9B5_OPENAI_RESPONSES_PROTOCOL.version,
    requestClass: parsed.data.requestClass,
    comparisonDigest: parsed.data.comparisonDigest,
    arm: parsed.data.arm,
    phase: parsed.data.phase,
    callIndex: parsed.data.callIndex,
    attemptCoordinateDigest: attemptCoordinateDigest.value,
    identities: parsed.data.identities,
    modelVisible: {
      instructions: parsed.data.instructions,
      input: parsed.data.input,
    },
    responseSchema,
    responseSchemaDigest: responseSchemaDigest.value,
    providerRequest,
    providerRequestBytes: providerRequestBytes.value,
    providerRequestDigest: providerRequestDigest.value,
    maximumOutputTokens: parsed.data.maximumOutputTokens,
    retryLimits: { sdk: 0, controller: 0 },
  });
  const serializedRequest = canonicalizeJson(body);
  const requestDigest = await digestValue(body);
  return serializedRequest.ok && requestDigest.ok
    ? {
        ok: true,
        value: m9b5ConformanceVectorSchema.parse({
          ...body,
          serializedRequest: serializedRequest.value,
          requestDigest: requestDigest.value,
        }),
      }
    : invalid("M9b.5 request envelope could not be bound.");
}

export async function validateM9b5ConformanceVector(
  input: unknown,
): Promise<Result<M9b5ConformanceVector, M9b5PreparationFailure>> {
  const parsed = m9b5ConformanceVectorSchema.safeParse(input);
  if (!parsed.success) return invalid("Invalid M9b.5 conformance vector.");
  const rebuilt = await prepareM9b5ConformanceVector({
    requestClass: parsed.data.requestClass,
    comparisonDigest: parsed.data.comparisonDigest,
    arm: parsed.data.arm,
    phase: parsed.data.phase,
    callIndex: parsed.data.callIndex,
    instructions: parsed.data.modelVisible.instructions,
    input: parsed.data.modelVisible.input,
    maximumOutputTokens: parsed.data.maximumOutputTokens,
    identities: parsed.data.identities,
  });
  if (!rebuilt.ok) return rebuilt;
  const expected = canonicalizeJson(rebuilt.value);
  const observed = canonicalizeJson(parsed.data);
  return expected.ok && observed.ok && expected.value === observed.value
    ? rebuilt
    : invalid("M9b.5 conformance vector identities differ.");
}

const outputTextPartSchema = z
  .object({
    type: z.literal("output_text"),
    text: z.string(),
    annotations: z.array(strictJsonValueSchema),
  })
  .readonly();
const responseMessageSchema = z
  .object({
    type: z.literal("message"),
    id: identifierSchema,
    role: z.literal("assistant"),
    status: z.literal("completed"),
    content: z.array(outputTextPartSchema).length(1),
  })
  .readonly();
const usageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    input_tokens_details: z
      .object({
        cached_tokens: z.number().int().nonnegative(),
        cache_write_tokens: z.number().int().nonnegative(),
      })
      .readonly(),
    output_tokens: z.number().int().nonnegative(),
    output_tokens_details: z
      .object({ reasoning_tokens: z.number().int().nonnegative() })
      .readonly(),
    total_tokens: z.number().int().nonnegative(),
  })
  .readonly();
const rawResponseSchema = z
  .object({
    id: identifierSchema,
    object: z.literal("response"),
    created_at: z.number().int().nonnegative(),
    status: z.enum(["completed", "failed", "incomplete", "cancelled"]),
    model: identifierSchema,
    output: z.array(responseMessageSchema).max(1),
    usage: usageSchema,
    error: z
      .object({
        code: identifierSchema,
        message: z.string().min(1).max(2_048),
      })
      .readonly()
      .nullable(),
    incomplete_details: z
      .object({ reason: identifierSchema })
      .readonly()
      .nullable(),
  })
  .readonly();

type M9b5Usage = Readonly<{
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  wallClockMs: number;
  costUsdMicros: number;
}>;
type M9b5TransportResult =
  | Readonly<{ kind: "success"; output: unknown; usage: M9b5Usage }>
  | Readonly<{
      kind: "failure";
      failure: Readonly<{
        kind:
          | "provider-rejected"
          | "provider-timeout"
          | "provider-unavailable"
          | "cancelled";
        code: string;
        message: string;
      }>;
      usage: M9b5Usage;
    }>;

function pricedUsage(
  vector: M9b5ConformanceVector,
  usage: z.infer<typeof usageSchema>,
  wallClockMs: number,
): M9b5Usage | undefined {
  if (
    usage.total_tokens !== usage.input_tokens + usage.output_tokens ||
    usage.input_tokens_details.cached_tokens +
      usage.input_tokens_details.cache_write_tokens >
      usage.input_tokens ||
    usage.output_tokens_details.reasoning_tokens > usage.output_tokens
  )
    return undefined;
  const pricing = vector.identities.pricingSnapshot;
  const uncachedInputTokens =
    usage.input_tokens -
    usage.input_tokens_details.cached_tokens -
    usage.input_tokens_details.cache_write_tokens;
  const longContext = usage.input_tokens > pricing.longContextThresholdTokens;
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
    BigInt(usage.input_tokens_details.cached_tokens) *
      BigInt(pricing.cachedInputUsdMicrosPerMillionTokens) *
      BigInt(inputMultiplier),
    BigInt(usage.input_tokens_details.cache_write_tokens) *
      BigInt(pricing.cacheWriteInputUsdMicrosPerMillionTokens) *
      BigInt(inputMultiplier),
    BigInt(usage.output_tokens) *
      BigInt(pricing.outputUsdMicrosPerMillionTokens) *
      BigInt(outputMultiplier),
  ];
  const numerator = numerators.reduce(
    (total, component) => total + component,
    0n,
  );
  const denominator = 1_000_000_000_000n;
  const costUsdMicros = (numerator + denominator - 1n) / denominator;
  return costUsdMicros <= BigInt(Number.MAX_SAFE_INTEGER)
    ? {
        inputTokens: usage.input_tokens,
        cachedInputTokens: usage.input_tokens_details.cached_tokens,
        cacheWriteInputTokens: usage.input_tokens_details.cache_write_tokens,
        outputTokens: usage.output_tokens,
        reasoningTokens: usage.output_tokens_details.reasoning_tokens,
        wallClockMs,
        costUsdMicros: Number(costUsdMicros),
      }
    : undefined;
}

function mapRawResponse(
  vector: M9b5ConformanceVector,
  raw: unknown,
  wallClockMs: number,
): M9b5TransportResult | undefined {
  const parsed = rawResponseSchema.safeParse(raw);
  if (!parsed.success || parsed.data.model !== vector.identities.model.version)
    return undefined;
  const usage = pricedUsage(vector, parsed.data.usage, wallClockMs);
  if (usage?.reasoningTokens !== 0) return undefined;
  if (parsed.data.status !== "completed") {
    const kind =
      parsed.data.status === "cancelled"
        ? "cancelled"
        : parsed.data.status === "failed"
          ? "provider-rejected"
          : "provider-unavailable";
    return {
      kind: "failure",
      failure: {
        kind,
        code:
          parsed.data.error?.code ??
          parsed.data.incomplete_details?.reason ??
          parsed.data.status,
        message:
          parsed.data.error?.message ??
          `OpenAI Responses ended with ${parsed.data.status}.`,
      },
      usage,
    };
  }
  const message = parsed.data.output[0];
  const text = message?.content[0]?.text;
  if (message === undefined || text === undefined) return undefined;
  const decoded = parseJson(text);
  if (!decoded.ok || hasHostileKey(decoded.value)) return undefined;
  const strict = strictJsonValueSchema.safeParse(decoded.value);
  const expected = outputSchemas[vector.requestClass].safeParse(decoded.value);
  if (!strict.success || !expected.success) return undefined;
  return {
    kind: "success",
    output: {
      protocol: "lachesis-m9b5-openai-responses-completed-output/3",
      responseId: parsed.data.id,
      returnedModel: parsed.data.model,
      requestClass: vector.requestClass,
      structuredOutput: decoded.value,
    },
    usage,
  };
}

export type M9b5OfflineFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type M9b5SessionSettings = Readonly<{
  interceptedFetch: M9b5OfflineFetch;
  syntheticApiKey: () => string;
  sdkRetryLimit: 0;
  expectedAttemptId: string;
  timeoutMs: number;
  nowMs: () => number;
}>;

const sessionSettingsSchema = z
  .strictObject({
    interceptedFetch: z.custom<M9b5OfflineFetch>(
      (value) => typeof value === "function",
    ),
    syntheticApiKey: z.custom<() => string>(
      (value) => typeof value === "function",
    ),
    sdkRetryLimit: z.literal(0),
    expectedAttemptId: digestSchema,
    timeoutMs: z.number().int().positive().max(3_600_000),
    nowMs: z.custom<() => number>((value) => typeof value === "function"),
  })
  .readonly();

export type M9b5TransportSession = Readonly<{
  provider: M9b5IdentityProfile["provider"];
  model: M9b5IdentityProfile["model"];
  tokenizer: M9b5IdentityProfile["tokenizer"];
  pricingSnapshot: M9b5IdentityProfile["pricingSnapshot"];
  invoke: (
    input: Readonly<{
      attemptId: string;
      serializedRequest: string;
      requestDigest: string;
    }>,
    signal: AbortSignal,
  ) => Promise<unknown>;
}>;

type InstalledResponsesModel = Readonly<{
  doGenerate: (options: unknown) => PromiseLike<unknown>;
}>;
type InstalledOpenAiProvider = Readonly<{
  responses: (modelId: string) => InstalledResponsesModel;
}>;
type InstalledOpenAiFactory = (
  settings: Readonly<{ apiKey: string; fetch: typeof globalThis.fetch }>,
) => InstalledOpenAiProvider;

function reflectedProperty(value: unknown, key: string): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  )
    return undefined;
  return Object.entries(value).find(([name]) => name === key)?.[1];
}

async function loadInstalledOpenAiFactory(): Promise<InstalledOpenAiFactory> {
  const installedModule: unknown = await import(
    ["@ai-sdk", "openai"].join("/")
  );
  return z
    .custom<InstalledOpenAiFactory>((value) => typeof value === "function")
    .parse(reflectedProperty(installedModule, "createOpenAI"));
}

export async function createM9b5OpenAiResponsesSession(
  vectorInput: M9b5ConformanceVector,
  settingsInput: unknown,
): Promise<Result<M9b5TransportSession, M9b5PreparationFailure>> {
  const vector = await validateM9b5ConformanceVector(vectorInput);
  if (!vector.ok) return vector;
  const settings = sessionSettingsSchema.safeParse(settingsInput);
  if (!settings.success)
    return invalid(
      "M9b.5 session settings violate the frozen offline profile.",
    );
  const identity = vector.value.identities;
  return {
    ok: true,
    value: {
      provider: identity.provider,
      model: identity.model,
      tokenizer: identity.tokenizer,
      pricingSnapshot: identity.pricingSnapshot,
      invoke: async (input, suppliedSignal): Promise<unknown> => {
        if (
          input.attemptId !== settings.data.expectedAttemptId ||
          input.serializedRequest !== vector.value.serializedRequest ||
          input.requestDigest !== vector.value.requestDigest
        )
          throw new Error(
            "M9b.5 invocation differs from its reserved request.",
          );
        if (suppliedSignal.aborted)
          throw new Error("M9b.5 invocation was cancelled before transport.");
        let fetchCount = 0;
        let rawResponse: unknown;
        const canonicalFetch: typeof globalThis.fetch = async (
          resource,
          options,
        ): Promise<Response> => {
          fetchCount += 1;
          if (fetchCount !== 1)
            throw new Error("M9b.5 permits exactly one transport request.");
          const url =
            typeof resource === "string"
              ? resource
              : resource instanceof URL
                ? resource.toString()
                : resource.url;
          const body = options?.body;
          if (
            !url.endsWith(M9B5_OPENAI_RESPONSES_PROTOCOL.transport.route) ||
            options?.method !== "POST" ||
            typeof body !== "string"
          )
            throw new Error("M9b.5 SDK transport route or method drifted.");
          const decoded = parseJson(body);
          const canonical = decoded.ok
            ? canonicalizeJson(decoded.value)
            : decoded;
          if (
            !decoded.ok ||
            !canonical.ok ||
            canonical.value !== vector.value.providerRequestBytes
          )
            throw new Error("M9b.5 SDK request serialization drifted.");
          const response = await settings.data.interceptedFetch(resource, {
            ...options,
            body: vector.value.providerRequestBytes,
          });
          const rawText = await response.clone().text();
          const raw = parseJson(rawText);
          rawResponse = raw.ok ? raw.value : undefined;
          return response;
        };
        const timeoutSignal = AbortSignal.timeout(settings.data.timeoutMs);
        const signal = AbortSignal.any([suppliedSignal, timeoutSignal]);
        const createOpenAI = await loadInstalledOpenAiFactory();
        const syntheticApiKey = settings.data.syntheticApiKey();
        if (syntheticApiKey.length < 8 || syntheticApiKey.length > 256)
          throw new Error("M9b.5 synthetic credential fixture is invalid.");
        const provider = createOpenAI({
          apiKey: syntheticApiKey,
          fetch: canonicalFetch,
        });
        const model = provider.responses(identity.model.version);
        const startedAt = settings.data.nowMs();
        try {
          await model.doGenerate({
            prompt: [
              {
                role: "user",
                content: [
                  { type: "text", text: vector.value.modelVisible.input },
                ],
              },
            ],
            maxOutputTokens: vector.value.maximumOutputTokens,
            reasoning: "none",
            responseFormat: {
              type: "json",
              name: vector.value.requestClass.replaceAll("-", "_"),
              schema: M9B5_OUTPUT_JSON_SCHEMAS[vector.value.requestClass],
            },
            abortSignal: signal,
            providerOptions: {
              openai: {
                instructions: vector.value.modelVisible.instructions,
                reasoningEffort: "none",
                serviceTier: "default",
                store: false,
                strictJsonSchema: true,
                truncation: "disabled",
              },
            },
          });
        } catch (error: unknown) {
          if (rawResponse === undefined) throw error;
        }
        if (fetchCount !== 1 || rawResponse === undefined)
          throw new Error("M9b.5 transport outcome is indeterminate.");
        const elapsed = settings.data.nowMs() - startedAt;
        if (!Number.isSafeInteger(elapsed) || elapsed < 0)
          throw new Error("M9b.5 monotonic clock is invalid.");
        const mapped = mapRawResponse(vector.value, rawResponse, elapsed);
        if (mapped === undefined)
          throw new Error("M9b.5 raw response is incomplete or inconsistent.");
        return mapped;
      },
    },
  };
}
