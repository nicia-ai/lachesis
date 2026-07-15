import {
  type AdapterDispatchEvidence,
  calculateCostUsdMicros,
  createPricingSnapshot,
  type ExperimentCaps,
  type GenerationConstraint,
  type InferenceSettings,
  type ModelAdapter,
  type ModelAdapterFailure,
  type ModelIdentity,
  type ModelRequest,
  type ModelResponseMetadata,
  type ModelUsage,
  normalizeStructuredOutputEnvelope,
  type PricingEntry,
  type StructuredOutputTransport,
  validatePortableStructuredOutputSchema,
} from "@nicia-ai/lachesis-generator";
import { z } from "zod";

export const AI_SDK_VERSION = "7.0.28";
export const AI_SDK_ADAPTER_VERSION = `lachesis-ai-sdk-adapter/3;ai-sdk/${AI_SDK_VERSION}`;
export const M1B_OPENAI_MODEL = "gpt-5.6-terra";
export const M1B_ANTHROPIC_MODEL = "claude-sonnet-5";
export const M1B_BEDROCK_ANTHROPIC_MODEL = "us.anthropic.claude-sonnet-5";
export const M1B_REPETITIONS = 2;
export const M1B_TIMEOUT_MS = 120_000;

export const GENERATION_OUTCOME_PROMPT_CONTRACT = Object.freeze({
  plan: '{ "kind": "plan", "plan": ... }',
  unplannable: '{ "kind": "unplannable", "reasons": [...] }',
  rules: Object.freeze([
    "Return raw JSON only.",
    "Do not use Markdown fences.",
    "Do not use alternate field names.",
    "Return exactly one of the two shapes above.",
  ]),
});

export const M1B_PROMPT_PROTOCOL = Object.freeze({
  id: "lachesis-plan-generation",
  version: "3",
  outputContract: GENERATION_OUTCOME_PROMPT_CONTRACT,
  repairVisibility: Object.freeze([
    "original task",
    "public task-input declarations",
    "exact language manifest",
    "previous proposal",
    "structured compiler diagnostics",
  ]),
  hiddenExecutionResultsVisible: false,
  toolsEnabled: false,
  internalOutputTransport:
    "Constrained methods use a versioned root-object outcome envelope that normalizes to GenerationOutcome. Anthropic's json tool is an internal structured-output transport only; external tools remain disabled.",
});

export const M1B_PILOT_CAPS: ExperimentCaps = Object.freeze({
  maxCalls: 400,
  maxInputTokens: 5_000_000,
  maxOutputTokens: 1_000_000,
  maxTotalTokens: 6_000_000,
  maxOutputTokensPerCall: 8_192,
  maxCostUsdMicros: 50_000_000,
  providerCostCaps: Object.freeze([
    Object.freeze({
      billingProvider: "openai",
      maxCostUsdMicros: 25_000_000,
    }),
    Object.freeze({
      billingProvider: "anthropic",
      maxCostUsdMicros: 25_000_000,
    }),
  ]),
});

const OPENAI_PRICING: PricingEntry = Object.freeze({
  id: "openai/gpt-5.6-terra/standard/2026-07-15",
  billingProvider: "openai",
  route: "openai-responses",
  model: M1B_OPENAI_MODEL,
  inputUsdMicrosPerMillionTokens: 2_500_000,
  cachedInputUsdMicrosPerMillionTokens: 250_000,
  cacheWriteInputUsdMicrosPerMillionTokens: 3_125_000,
  outputUsdMicrosPerMillionTokens: 15_000_000,
  effectiveFrom: "2026-07-15",
  effectiveUntil: null,
  sourceUrl: "https://developers.openai.com/api/docs/pricing",
});

const ANTHROPIC_DIRECT_PRICING: PricingEntry = Object.freeze({
  id: "anthropic/claude-sonnet-5/direct/intro-2026-07-15",
  billingProvider: "anthropic",
  route: "anthropic-messages",
  model: M1B_ANTHROPIC_MODEL,
  inputUsdMicrosPerMillionTokens: 2_000_000,
  cachedInputUsdMicrosPerMillionTokens: 200_000,
  cacheWriteInputUsdMicrosPerMillionTokens: 2_500_000,
  outputUsdMicrosPerMillionTokens: 10_000_000,
  effectiveFrom: "2026-06-30",
  effectiveUntil: "2026-08-31",
  sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
});

const ANTHROPIC_BEDROCK_PRICING: PricingEntry = Object.freeze({
  ...ANTHROPIC_DIRECT_PRICING,
  id: "anthropic/claude-sonnet-5/bedrock/intro-2026-07-15",
  route: "aws-bedrock",
  model: M1B_BEDROCK_ANTHROPIC_MODEL,
  sourceUrl: "https://aws.amazon.com/bedrock/pricing/",
});

export const M1B_PRICING_ENTRIES: ReadonlyArray<PricingEntry> = Object.freeze([
  OPENAI_PRICING,
  ANTHROPIC_DIRECT_PRICING,
  ANTHROPIC_BEDROCK_PRICING,
]);

export function createM1bPricingSnapshot(): ReturnType<
  typeof createPricingSnapshot
> {
  return createPricingSnapshot({
    capturedAt: "2026-07-15T00:00:00-07:00",
    entries: M1B_PRICING_ENTRIES,
  });
}

type JsonValue = z.infer<ReturnType<typeof z.json>>;
type ProviderOptions = Readonly<Record<string, JsonValue>>;
type UnknownFunction = (...arguments_: ReadonlyArray<unknown>) => unknown;

export type AiSdkRuntime = Readonly<{
  generateText: UnknownFunction;
  outputObject: UnknownFunction;
  jsonSchema: UnknownFunction;
}>;

export type DispatchObserver = Readonly<{
  markDispatched: () => void;
}>;

export type AiSdkModelAdapterInput = Readonly<{
  identity: ModelIdentity;
  inference: InferenceSettings;
  pricing: PricingEntry;
  loadModel: (observer: DispatchObserver) => Promise<unknown>;
  runtime?: AiSdkRuntime | undefined;
  providerOptions?: ProviderOptions | undefined;
  timeoutMs?: number | undefined;
}>;

const tokenDetailsSchema = z
  .looseObject({
    noCacheTokens: z.number().int().nonnegative().optional(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
    cacheWriteTokens: z.number().int().nonnegative().optional(),
  })
  .optional();

const outputTokenDetailsSchema = z
  .looseObject({
    textTokens: z.number().int().nonnegative().optional(),
    reasoningTokens: z.number().int().nonnegative().optional(),
  })
  .optional();

const usageSchema = z
  .looseObject({
    inputTokens: z.number().int().nonnegative().optional(),
    inputTokenDetails: tokenDetailsSchema,
    outputTokens: z.number().int().nonnegative().optional(),
    outputTokenDetails: outputTokenDetailsSchema,
  })
  .optional();

const responseSchema = z
  .looseObject({
    id: z.string().optional(),
    modelId: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .optional();

const generationResultSchema = z.looseObject({
  text: z.string(),
  output: z.unknown().optional(),
  usage: usageSchema,
  response: responseSchema,
  providerMetadata: z.unknown().optional(),
  finishReason: z.string(),
  rawFinishReason: z.string().optional(),
});

const structuredGenerationErrorSchema = z.looseObject({
  text: z.string().optional(),
  usage: usageSchema,
  response: responseSchema,
  finishReason: z.string().optional(),
  rawFinishReason: z.string().optional(),
});

function renderRequest(request: ModelRequest): string {
  const transport =
    request.structuredOutputTransport === null
      ? null
      : {
          formatVersion: request.structuredOutputTransport.formatVersion,
          compilerVersion: request.structuredOutputTransport.compilerVersion,
          manifestDigest: request.structuredOutputTransport.manifestDigest,
          schemaDigest: request.structuredOutputTransport.schemaDigest,
          envelope:
            '{ "outcome": { "kind": "plan", "plan": ... } } or { "outcome": { "kind": "unplannable", "reasons": [...] } }',
        };
  const shared = {
    protocol: M1B_PROMPT_PROTOCOL,
    generationOutcomeContract: GENERATION_OUTCOME_PROMPT_CONTRACT,
    originalTask: request.originalTask,
    taskInputs: request.taskInputs,
    languageManifest: request.languageManifest,
    structuredOutputTransport: transport,
  };
  return JSON.stringify(
    request.kind === "initial"
      ? {
          ...shared,
          turn: "initial",
          constraint: request.constraint,
          publicExamples: request.publicExamples,
        }
      : {
          ...shared,
          turn: "repair",
          previousProposal: request.previousProposal,
          compilerDiagnostics: request.diagnostics,
        },
  );
}

function property(value: unknown, key: string): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  )
    return undefined;
  return Object.entries(value).find(([name]) => name === key)?.[1];
}

function callable(value: unknown): value is UnknownFunction {
  return typeof value === "function";
}

async function importModule(name: string): Promise<unknown> {
  return import(name);
}

type ProviderFetch = typeof globalThis.fetch;
type ProviderSetting = string | ProviderFetch;
type ProviderSettings = Readonly<Record<string, ProviderSetting>>;

const providerSettingSchema = z.union([
  z.string(),
  z.custom<ProviderFetch>((value) => callable(value)),
]);

function providerSettings(value: unknown): ProviderSettings {
  const parsed = z
    .record(z.string(), providerSettingSchema.optional())
    .parse(value ?? {});
  const settings: Record<string, ProviderSetting> = {};
  for (const [key, setting] of Object.entries(parsed)) {
    if (setting !== undefined) settings[key] = setting;
  }
  return settings;
}

function dispatchingFetch(
  configured: ProviderFetch | undefined,
  observer: DispatchObserver,
): ProviderFetch {
  const target = configured ?? globalThis.fetch;
  return (resource, options) => {
    observer.markDispatched();
    return target(resource, options);
  };
}

async function loadAiSdk(): Promise<AiSdkRuntime> {
  const module = await importModule(["a", "i"].join(""));
  const generateText = property(module, "generateText");
  const outputObject = property(property(module, "Output"), "object");
  const jsonSchema = property(module, "jsonSchema");
  if (
    !callable(generateText) ||
    !callable(outputObject) ||
    !callable(jsonSchema)
  ) {
    throw new Error(
      "AI SDK 7 generateText, Output.object, or jsonSchema is unavailable.",
    );
  }
  return { generateText, outputObject, jsonSchema };
}

async function providerModel(
  moduleName: string,
  factoryName: string,
  settings: ProviderSettings,
  modelId: string,
  observer: DispatchObserver,
  modelFactoryName?: string,
): Promise<unknown> {
  const module = await importModule(moduleName);
  const factory = property(module, factoryName);
  if (!callable(factory)) throw new Error(`Missing ${factoryName}.`);
  const configuredFetch = settings["fetch"];
  const provider = await Promise.resolve(
    factory({
      ...settings,
      fetch: dispatchingFetch(
        typeof configuredFetch === "function" ? configuredFetch : undefined,
        observer,
      ),
    }),
  );
  const modelFactory =
    modelFactoryName === undefined
      ? provider
      : property(provider, modelFactoryName);
  if (!callable(modelFactory))
    throw new Error("Provider model factory is unavailable.");
  return modelFactory(modelId);
}

function stringProperty(value: unknown, key: string): string | null {
  const found = property(value, key);
  return typeof found === "string" ? found : null;
}

function nestedString(
  value: unknown,
  parent: string,
  child: string,
): string | null {
  return stringProperty(property(value, parent), child);
}

function header(
  headers: Readonly<Record<string, string>> | undefined,
  names: ReadonlyArray<string>,
): string | null {
  if (headers === undefined) return null;
  const entries = Object.entries(headers);
  for (const name of names) {
    const match = entries.find(
      ([headerName]) => headerName.toLowerCase() === name,
    );
    if (match !== undefined) return match[1];
  }
  return null;
}

function usageFromAiSdk(
  usage: z.infer<typeof usageSchema>,
  pricing: PricingEntry,
): ModelUsage {
  const normalized = {
    inputTokens: usage?.inputTokens ?? 0,
    cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteInputTokens: usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? 0,
  };
  const cost = calculateCostUsdMicros(pricing, normalized);
  return { ...normalized, costUsdMicros: cost.ok ? cost.value : 0 };
}

function responseMetadata(
  input: Readonly<{
    configuredModel: string;
    response?: z.infer<typeof responseSchema>;
    providerMetadata?: unknown;
    finishReason?: string | undefined;
    rawFinishReason?: string | undefined;
  }>,
): ModelResponseMetadata {
  const providerResponseId =
    nestedString(input.providerMetadata, "openai", "responseId") ??
    nestedString(input.providerMetadata, "anthropic", "responseId");
  return {
    providerRequestId: header(input.response?.headers, [
      "x-request-id",
      "request-id",
      "x-amzn-requestid",
      "x-amzn-request-id",
    ]),
    providerResponseId: providerResponseId ?? input.response?.id ?? null,
    returnedModelId: input.response?.modelId ?? input.configuredModel,
    finishReason: input.finishReason ?? "unknown",
    rawFinishReason: input.rawFinishReason ?? null,
  };
}

function isSafetyRefusal(metadata: ModelResponseMetadata): boolean {
  return (
    metadata.finishReason === "content-filter" ||
    metadata.rawFinishReason === "refusal"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown provider failure.";
}

function refusal(
  metadata: ModelResponseMetadata,
  usage: ModelUsage,
  latencyMs: number,
): Readonly<{ ok: false; error: ModelAdapterFailure }> {
  return {
    ok: false,
    error: {
      code: "PROVIDER_REFUSAL",
      message: "The provider returned a safety refusal.",
      dispatchEvidence: "dispatched-with-usage",
      metadata,
      usage,
      latencyMs,
    },
  };
}

function failureEvidence(
  dispatched: boolean,
  usageKnown: boolean,
): AdapterDispatchEvidence {
  return dispatched
    ? usageKnown
      ? "dispatched-with-usage"
      : "dispatched-usage-unknown"
    : "not-dispatched";
}

function portableSchemaFailure(message: string): ModelAdapterFailure {
  return {
    code: "PROVIDER_FAILURE",
    message,
    dispatchEvidence: "not-dispatched",
  };
}

type AdapterPreflightResult =
  | Readonly<{ ok: true; value: undefined }>
  | Readonly<{ ok: false; error: ModelAdapterFailure }>;

function preflightStructuredOutput(
  transport: StructuredOutputTransport,
): Promise<AdapterPreflightResult> {
  const portable = validatePortableStructuredOutputSchema(transport.jsonSchema);
  return Promise.resolve(
    portable.ok
      ? { ok: true, value: undefined }
      : { ok: false, error: portableSchemaFailure(portable.error.message) },
  );
}

export function createAiSdkModelAdapter(
  input: AiSdkModelAdapterInput,
): ModelAdapter {
  return {
    identity: input.identity,
    inference: input.inference,
    pricingEntryId: input.pricing.id,
    preflightStructuredOutput,
    async generate(request) {
      const started = performance.now();
      let dispatched = false;
      const observer: DispatchObserver = {
        markDispatched: () => {
          dispatched = true;
        },
      };
      const abortSignal = AbortSignal.timeout(
        input.timeoutMs ?? M1B_TIMEOUT_MS,
      );
      try {
        const prompt = renderRequest(request);
        const sdk = input.runtime ?? (await loadAiSdk());
        const transport = request.structuredOutputTransport;
        const structured = transport !== null;
        const output =
          transport !== null
            ? sdk.outputObject({
                name: "generation_outcome",
                description:
                  "A Lachesis plan proposal or principled abstention.",
                schema: sdk.jsonSchema(transport.jsonSchema, {
                  validate: (value: unknown) => {
                    const normalized = normalizeStructuredOutputEnvelope(value);
                    return normalized.ok
                      ? { success: true, value: normalized.value }
                      : {
                          success: false,
                          error: new Error(normalized.error.message),
                        };
                  },
                }),
              })
            : undefined;
        const raw = await sdk.generateText({
          model: await input.loadModel(observer),
          prompt,
          maxOutputTokens: input.inference.maxOutputTokens,
          maxRetries: 0,
          abortSignal,
          ...(input.inference.temperature === null
            ? {}
            : { temperature: input.inference.temperature }),
          ...(input.inference.seed === null
            ? {}
            : { seed: input.inference.seed }),
          ...(input.providerOptions === undefined
            ? {}
            : { providerOptions: input.providerOptions }),
          ...(output === undefined ? {} : { output }),
        });
        const parsed = generationResultSchema.safeParse(raw);
        if (!parsed.success || parsed.data.usage === undefined) {
          return {
            ok: false,
            error: {
              code: "PROVIDER_FAILURE",
              message: "AI SDK returned an invalid generation result.",
              dispatchEvidence: failureEvidence(dispatched, false),
              latencyMs: Math.max(0, Math.round(performance.now() - started)),
            },
          };
        }
        const latencyMs = Math.max(0, Math.round(performance.now() - started));
        const metadata = responseMetadata({
          configuredModel: input.identity.model,
          response: parsed.data.response,
          providerMetadata: parsed.data.providerMetadata,
          finishReason: parsed.data.finishReason,
          rawFinishReason: parsed.data.rawFinishReason,
        });
        const usage = usageFromAiSdk(parsed.data.usage, input.pricing);
        if (isSafetyRefusal(metadata))
          return refusal(metadata, usage, latencyMs);
        return {
          ok: true,
          value: {
            rawResponse: parsed.data.text,
            ...(structured && parsed.data.output !== undefined
              ? { structuredOutput: parsed.data.output }
              : {}),
            usage,
            latencyMs,
            metadata,
            dispatchEvidence: "dispatched-with-usage",
          },
        };
      } catch (error) {
        const latencyMs = Math.max(0, Math.round(performance.now() - started));
        if (abortSignal.aborted) {
          return {
            ok: false,
            error: {
              code: "PROVIDER_TIMEOUT",
              message: `Provider request exceeded ${input.timeoutMs ?? M1B_TIMEOUT_MS} ms.`,
              dispatchEvidence: failureEvidence(dispatched, false),
              latencyMs,
            },
          };
        }
        const generated = structuredGenerationErrorSchema.safeParse(error);
        if (
          generated.success &&
          generated.data.text !== undefined &&
          generated.data.usage !== undefined
        ) {
          const metadata = responseMetadata({
            configuredModel: input.identity.model,
            response: generated.data.response,
            finishReason: generated.data.finishReason,
            rawFinishReason: generated.data.rawFinishReason,
          });
          const usage = usageFromAiSdk(generated.data.usage, input.pricing);
          if (isSafetyRefusal(metadata))
            return refusal(metadata, usage, latencyMs);
          return {
            ok: true,
            value: {
              rawResponse: generated.data.text,
              usage,
              latencyMs,
              metadata,
              dispatchEvidence: "dispatched-with-usage",
            },
          };
        }
        return {
          ok: false,
          error: {
            code: "PROVIDER_FAILURE",
            message: errorMessage(error),
            dispatchEvidence: failureEvidence(dispatched, false),
            latencyMs,
          },
        };
      }
    },
  };
}

function inference(
  constraint: GenerationConstraint,
  reasoningSettings: InferenceSettings["reasoningSettings"],
  structuredOutputTransport: Exclude<
    InferenceSettings["structuredOutputTransport"],
    "prompt-json" | undefined
  >,
): InferenceSettings {
  return Object.freeze({
    temperature: null,
    seed: null,
    reasoningSettings,
    maxInputTokens: 64_000,
    maxOutputTokens: 8_192,
    structuredOutputMode:
      constraint === "unconstrained-json" ? "none" : "json-schema",
    structuredOutputTransport:
      constraint === "unconstrained-json"
        ? "prompt-json"
        : structuredOutputTransport,
  });
}

export type OpenAiProviderSettings = Readonly<{
  apiKey?: string | undefined;
  baseURL?: string | undefined;
  organization?: string | undefined;
  project?: string | undefined;
  fetch?: ProviderFetch | undefined;
}>;

export type OpenAiAdapterInput = Readonly<{
  constraint: GenerationConstraint;
  provider?: OpenAiProviderSettings | undefined;
}>;

export function createOpenAiPlanAdapter(
  input: OpenAiAdapterInput,
): ModelAdapter {
  return createAiSdkModelAdapter({
    identity: {
      provider: "openai",
      model: M1B_OPENAI_MODEL,
      adapterVersion: AI_SDK_ADAPTER_VERSION,
    },
    inference: inference(
      input.constraint,
      { mode: "reasoning", effort: "low" },
      "openai-responses-portable-json-schema",
    ),
    pricing: OPENAI_PRICING,
    loadModel: (observer) =>
      providerModel(
        ["@ai-sdk", "openai"].join("/"),
        "createOpenAI",
        providerSettings(input.provider),
        M1B_OPENAI_MODEL,
        observer,
        "responses",
      ),
    providerOptions: {
      openai: {
        reasoningEffort: "low",
        store: false,
        serviceTier: "default",
      },
    },
  });
}

type AdaptiveThinkingAcknowledgement = Readonly<{
  acknowledgeAdaptiveThinking: true;
  constraint: GenerationConstraint;
}>;

export type AnthropicProviderSettings = Readonly<{
  apiKey?: string | undefined;
  baseURL?: string | undefined;
  fetch?: ProviderFetch | undefined;
}>;

export type AnthropicAdapterInput = AdaptiveThinkingAcknowledgement &
  Readonly<{ provider?: AnthropicProviderSettings | undefined }>;

export function createAnthropicPlanAdapter(
  input: AnthropicAdapterInput,
): ModelAdapter {
  return createAiSdkModelAdapter({
    identity: {
      provider: "anthropic",
      model: M1B_ANTHROPIC_MODEL,
      adapterVersion: AI_SDK_ADAPTER_VERSION,
    },
    inference: inference(
      input.constraint,
      { mode: "adaptive", effort: "low" },
      "anthropic-json-tool-portable-json-schema",
    ),
    pricing: ANTHROPIC_DIRECT_PRICING,
    loadModel: (observer) =>
      providerModel(
        ["@ai-sdk", "anthropic"].join("/"),
        "createAnthropic",
        providerSettings(input.provider),
        M1B_ANTHROPIC_MODEL,
        observer,
      ),
    providerOptions: {
      anthropic: {
        thinking: { type: "adaptive" },
        effort: "low",
        structuredOutputMode: "jsonTool",
      },
    },
  });
}

export type M1bPrimaryAdaptersInput = Readonly<{
  constraint: GenerationConstraint;
  openai?: OpenAiProviderSettings | undefined;
  anthropic?: AnthropicProviderSettings | undefined;
}>;

export type M1bPrimaryAdapters = Readonly<{
  openai: ModelAdapter;
  anthropic: ModelAdapter;
}>;

export function createM1bPrimaryAdapters(
  input: M1bPrimaryAdaptersInput,
): M1bPrimaryAdapters {
  return Object.freeze({
    openai: createOpenAiPlanAdapter({
      constraint: input.constraint,
      ...(input.openai === undefined ? {} : { provider: input.openai }),
    }),
    anthropic: createAnthropicPlanAdapter({
      constraint: input.constraint,
      acknowledgeAdaptiveThinking: true,
      ...(input.anthropic === undefined ? {} : { provider: input.anthropic }),
    }),
  });
}

export type BedrockAnthropicProviderSettings = Readonly<{
  region?: string | undefined;
  apiKey?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  sessionToken?: string | undefined;
  baseURL?: string | undefined;
  fetch?: ProviderFetch | undefined;
}>;

export type BedrockAnthropicAdapterInput = AdaptiveThinkingAcknowledgement &
  Readonly<{ provider?: BedrockAnthropicProviderSettings | undefined }>;

export function createBedrockAnthropicPlanAdapter(
  input: BedrockAnthropicAdapterInput,
): ModelAdapter {
  return createAiSdkModelAdapter({
    identity: {
      provider: "anthropic",
      model: M1B_BEDROCK_ANTHROPIC_MODEL,
      adapterVersion: AI_SDK_ADAPTER_VERSION,
    },
    inference: inference(
      input.constraint,
      { mode: "adaptive", effort: "low", route: "aws-bedrock" },
      "bedrock-json-tool-portable-json-schema",
    ),
    pricing: ANTHROPIC_BEDROCK_PRICING,
    loadModel: (observer) =>
      providerModel(
        ["@ai-sdk", "amazon-bedrock", "anthropic"].join("/"),
        "createAmazonBedrockAnthropic",
        providerSettings(input.provider),
        M1B_BEDROCK_ANTHROPIC_MODEL,
        observer,
      ),
    providerOptions: {
      anthropic: {
        thinking: { type: "adaptive" },
        effort: "low",
        structuredOutputMode: "jsonTool",
      },
    },
  });
}
