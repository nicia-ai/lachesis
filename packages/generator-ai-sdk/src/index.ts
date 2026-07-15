import {
  calculateCostUsdMicros,
  createPricingSnapshot,
  type ExperimentCaps,
  type GenerationConstraint,
  generationOutcomeSchema,
  type InferenceSettings,
  type ModelAdapter,
  type ModelAdapterFailure,
  type ModelIdentity,
  type ModelRequest,
  type ModelResponseMetadata,
  type ModelUsage,
  type PricingEntry,
} from "@nicia-ai/lachesis-generator";
import { z } from "zod";

export const AI_SDK_VERSION = "7.0.28";
export const AI_SDK_ADAPTER_VERSION = `ai-sdk/${AI_SDK_VERSION}`;
export const M1B_OPENAI_MODEL = "gpt-5.6-terra";
export const M1B_ANTHROPIC_MODEL = "claude-sonnet-5";
export const M1B_BEDROCK_ANTHROPIC_MODEL = "us.anthropic.claude-sonnet-5";
export const M1B_REPETITIONS = 2;

export const M1B_PROMPT_PROTOCOL = Object.freeze({
  id: "lachesis-plan-generation",
  version: "1",
  outputContract:
    "Return exactly one GenerationOutcome. Abstain only when the task cannot be satisfied under the supplied language manifest and policy.",
  repairVisibility: Object.freeze([
    "original task",
    "exact language manifest",
    "previous proposal",
    "structured compiler diagnostics",
  ]),
  hiddenExecutionResultsVisible: false,
  toolsEnabled: false,
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
}>;

export type AiSdkModelAdapterInput = Readonly<{
  identity: ModelIdentity;
  inference: InferenceSettings;
  pricing: PricingEntry;
  loadModel: () => Promise<unknown>;
  runtime?: AiSdkRuntime | undefined;
  providerOptions?: ProviderOptions | undefined;
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
  const shared = {
    protocol: M1B_PROMPT_PROTOCOL,
    originalTask: request.originalTask,
    languageManifest: request.languageManifest,
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
  if (value === null || typeof value !== "object") return undefined;
  return Object.entries(value).find(([name]) => name === key)?.[1];
}

function callable(value: unknown): value is UnknownFunction {
  return typeof value === "function";
}

async function importModule(name: string): Promise<unknown> {
  return import(name);
}

function jsonSettings(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  const parsed = z.record(z.string(), z.string().optional()).parse(value);
  const settings: Record<string, string> = {};
  for (const [key, setting] of Object.entries(parsed)) {
    if (setting !== undefined) settings[key] = setting;
  }
  return settings;
}

async function loadAiSdk(): Promise<AiSdkRuntime> {
  const module = await importModule(["a", "i"].join(""));
  const generateText = property(module, "generateText");
  const outputObject = property(property(module, "Output"), "object");
  if (!callable(generateText) || !callable(outputObject)) {
    throw new Error("AI SDK 7 generateText or Output.object is unavailable.");
  }
  return { generateText, outputObject };
}

async function providerModel(
  moduleName: string,
  factoryName: string,
  settings: JsonValue | undefined,
  modelId: string,
  modelFactoryName?: string,
): Promise<unknown> {
  const module = await importModule(moduleName);
  const factory = property(module, factoryName);
  if (!callable(factory)) throw new Error(`Missing ${factoryName}.`);
  const provider = await Promise.resolve(factory(settings));
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
      metadata,
      usage,
      latencyMs,
    },
  };
}

export function createAiSdkModelAdapter(
  input: AiSdkModelAdapterInput,
): ModelAdapter {
  let model: Promise<unknown> | undefined;
  return {
    identity: input.identity,
    inference: input.inference,
    pricingEntryId: input.pricing.id,
    async generate(request) {
      const started = performance.now();
      try {
        const prompt = renderRequest(request);
        const sdk = input.runtime ?? (await loadAiSdk());
        model ??= input.loadModel();
        const structured = !(
          request.kind === "initial" &&
          request.constraint === "unconstrained-json"
        );
        const output = structured
          ? sdk.outputObject({
              name: "generation_outcome",
              description: "A Lachesis plan proposal or principled abstention.",
              schema: generationOutcomeSchema,
            })
          : undefined;
        const raw = await sdk.generateText({
          model: await model,
          prompt,
          maxOutputTokens: input.inference.maxOutputTokens,
          maxRetries: 0,
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
        if (!parsed.success) {
          return {
            ok: false,
            error: {
              code: "PROVIDER_FAILURE",
              message: "AI SDK returned an invalid generation result.",
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
          },
        };
      } catch (error) {
        const latencyMs = Math.max(0, Math.round(performance.now() - started));
        const generated = structuredGenerationErrorSchema.safeParse(error);
        if (generated.success && generated.data.text !== undefined) {
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
            },
          };
        }
        return {
          ok: false,
          error: {
            code: "PROVIDER_FAILURE",
            message: errorMessage(error),
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
): InferenceSettings {
  return Object.freeze({
    temperature: null,
    seed: null,
    reasoningSettings,
    maxInputTokens: 64_000,
    maxOutputTokens: 8_192,
    structuredOutputMode:
      constraint === "unconstrained-json" ? "none" : "json-schema",
  });
}

export type OpenAiProviderSettings = Readonly<{
  apiKey?: string | undefined;
  baseURL?: string | undefined;
  organization?: string | undefined;
  project?: string | undefined;
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
    inference: inference(input.constraint, {
      mode: "reasoning",
      effort: "low",
    }),
    pricing: OPENAI_PRICING,
    loadModel: () =>
      providerModel(
        ["@ai-sdk", "openai"].join("/"),
        "createOpenAI",
        jsonSettings(input.provider),
        M1B_OPENAI_MODEL,
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
    inference: inference(input.constraint, { mode: "adaptive", effort: "low" }),
    pricing: ANTHROPIC_DIRECT_PRICING,
    loadModel: () =>
      providerModel(
        ["@ai-sdk", "anthropic"].join("/"),
        "createAnthropic",
        jsonSettings(input.provider),
        M1B_ANTHROPIC_MODEL,
      ),
    providerOptions: {
      anthropic: {
        thinking: { type: "adaptive" },
        effort: "low",
        structuredOutputMode: "outputFormat",
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
    inference: inference(input.constraint, {
      mode: "adaptive",
      effort: "low",
      route: "aws-bedrock",
    }),
    pricing: ANTHROPIC_BEDROCK_PRICING,
    loadModel: () =>
      providerModel(
        ["@ai-sdk", "amazon-bedrock", "anthropic"].join("/"),
        "createAmazonBedrockAnthropic",
        jsonSettings(input.provider),
        M1B_BEDROCK_ANTHROPIC_MODEL,
      ),
    providerOptions: {
      anthropic: {
        thinking: { type: "adaptive" },
        effort: "low",
        structuredOutputMode: "outputFormat",
      },
    },
  });
}
