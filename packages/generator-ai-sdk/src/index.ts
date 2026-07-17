import {
  decodeM3bOracleWire,
  M3B_ORACLE_PROMPT,
  type M3bAttemptProvenance,
  type M3bOracle,
  type M3bOracleFailureCode,
  type M3bOracleIdentity,
  m3bOracleOutputSchema,
  type M3bOracleRequest,
  type M3bOracleUsage,
  type M3bRawOutputArtifact,
  type M3bRawOutputWriter,
} from "@nicia-ai/lachesis-evidence";
import {
  type AdapterDispatchEvidence,
  calculateCostUsdMicros,
  type CodeModeModelAdapter,
  type CodeModeModelRequest,
  codeModeOutcomeSchema,
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
export const OPENAI_AI_SDK_PROVIDER_VERSION = "4.0.15";
export const ANTHROPIC_AI_SDK_PROVIDER_VERSION = "4.0.15";
export const AI_SDK_ADAPTER_VERSION = `lachesis-ai-sdk-adapter/4;ai-sdk/${AI_SDK_VERSION}`;
export const M2_CODEMODE_ADAPTER_VERSION = `${AI_SDK_ADAPTER_VERSION};restricted-capability-typescript/3`;
export const M3B1_PROVIDER_ADAPTER_VERSION = `${AI_SDK_ADAPTER_VERSION};m3b-arm-blinded-evidence-oracle/1`;
export const M3B2_PROVIDER_ADAPTER_VERSION = `${AI_SDK_ADAPTER_VERSION};m3b-arm-blinded-typed-evidence-oracle/2`;
export const M3B3_PROVIDER_ADAPTER_VERSION = `${AI_SDK_ADAPTER_VERSION};m3b-arm-blinded-semantic-obligation-oracle/3`;
export const M3B4_PROVIDER_ADAPTER_VERSION = `${AI_SDK_ADAPTER_VERSION};m3b-staged-wire-recovery-oracle/4`;
export const M1B_OPENAI_MODEL = "gpt-5.6-terra";
export const M1B_ANTHROPIC_MODEL = "claude-sonnet-5";
export const M1B_BEDROCK_ANTHROPIC_MODEL = "us.anthropic.claude-sonnet-5";
export const M1B_REPETITIONS = 2;
export const M1B_TIMEOUT_MS = 120_000;

export const GENERATION_OUTCOME_PROMPT_CONTRACT = Object.freeze({
  plan: '{ "kind": "plan", "plan": ... }',
  unplannable:
    '{ "kind": "unplannable", "witness": { "kind": "missingOperation" | "deniedCapability" | "insufficientBudget", ... } }',
  rules: Object.freeze([
    "Return raw JSON only.",
    "Do not use Markdown fences.",
    "Do not use alternate field names.",
    "Return exactly one of the two shapes above.",
    "The plan contains operator topology and arguments only.",
    "Do not return budget, allowedCapabilities, or input maxItems fields; trusted runtime authority supplies them.",
  ]),
});

export const M1C_PROMPT_PROTOCOL = Object.freeze({
  id: "lachesis-plan-generation",
  version: "5",
  outputContract: GENERATION_OUTCOME_PROMPT_CONTRACT,
  repairVisibility: Object.freeze([
    "original task",
    "public task-input declarations",
    "exact language manifest",
    "public typed semantic obligations",
    "previous proposal",
    "structured compiler diagnostics",
  ]),
  hiddenExecutionResultsVisible: false,
  toolsEnabled: false,
  authorityBinding:
    "The model proposes computation only. The runtime binds public input bounds, capabilities, and policy limits; the analyzer derives requirements and the compiler compares them to trusted limits.",
  internalOutputTransport:
    "Constrained methods use a versioned root-object outcome envelope that normalizes to GenerationOutcome. Anthropic's json tool is an internal structured-output transport only; external tools remain disabled.",
});

/** Frozen name retained for consumers that report historical M1b identities. */
export const M1B_PROMPT_PROTOCOL = M1C_PROMPT_PROTOCOL;

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

export const M3B1_PRICING_ENTRIES: ReadonlyArray<PricingEntry> = Object.freeze([
  OPENAI_PRICING,
  ANTHROPIC_DIRECT_PRICING,
]);
export const M3B2_PRICING_ENTRIES = M3B1_PRICING_ENTRIES;
export const M3B3_PRICING_ENTRIES = M3B1_PRICING_ENTRIES;
export const M3B4_PRICING_ENTRIES = M3B1_PRICING_ENTRIES;

export function createM3b1PricingSnapshot(): ReturnType<
  typeof createPricingSnapshot
> {
  return createPricingSnapshot({
    capturedAt: "2026-07-15T00:00:00-07:00",
    entries: M3B1_PRICING_ENTRIES,
  });
}

export const createM3b2PricingSnapshot = createM3b1PricingSnapshot;
export const createM3b3PricingSnapshot = createM3b1PricingSnapshot;
export const createM3b4PricingSnapshot = createM3b1PricingSnapshot;

export const M3B1_OUTPUT_SCHEMA_VERSION =
  "m3b-provider-portable-answer-citation-path/1";
export const M3B2_OUTPUT_SCHEMA_VERSION =
  "m3b-provider-portable-typed-answer-reference/2";
export const M3B3_OUTPUT_SCHEMA_VERSION =
  "m3b-provider-portable-semantic-obligation-answer/3";
export const M3B4_OUTPUT_SCHEMA_VERSION =
  "m3b-provider-portable-staged-wire-answer/4";
function deepFreezeValue(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) deepFreezeValue(child);
  Object.freeze(value);
}

const m3b1OutputJsonSchema = {
  type: "object",
  properties: {
    answer: { type: "string", minLength: 1 },
    citationIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
      maxItems: 128,
    },
    paths: {
      type: "array",
      items: {
        type: "object",
        properties: {
          factIds: {
            type: "array",
            items: { type: "string", minLength: 1 },
            maxItems: 256,
          },
          edgeIds: {
            type: "array",
            items: { type: "string", minLength: 1 },
            maxItems: 256,
          },
        },
        required: ["factIds", "edgeIds"],
        additionalProperties: false,
      },
      maxItems: 256,
    },
  },
  required: ["answer", "citationIds", "paths"],
  additionalProperties: false,
};
deepFreezeValue(m3b1OutputJsonSchema);
export const M3B1_OUTPUT_JSON_SCHEMA = m3b1OutputJsonSchema;

type ProviderJsonSchema = Exclude<
  Parameters<typeof z.fromJSONSchema>[0],
  boolean
>;

const m3b2OutputJsonSchema: ProviderJsonSchema = {
  type: "object",
  properties: {
    outcome: {
      type: "string",
      enum: ["answered", "insufficient-evidence"],
    },
    answerValues: {
      type: "array",
      items: { type: "string", minLength: 1 },
      maxItems: 128,
    },
    citationIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
      maxItems: 128,
    },
    pathIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
      maxItems: 256,
    },
  },
  required: ["outcome", "answerValues", "citationIds", "pathIds"],
  additionalProperties: false,
};
deepFreezeValue(m3b2OutputJsonSchema);
export const M3B2_OUTPUT_JSON_SCHEMA = m3b2OutputJsonSchema;

const m3b3OutputJsonSchema: ProviderJsonSchema = {
  type: "object",
  properties: {
    outcome: {
      type: "string",
      enum: ["answered", "insufficient-evidence"],
    },
    answerValues: {
      type: "array",
      items: { type: "string", minLength: 1 },
      maxItems: 128,
    },
    supportingFactIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
      maxItems: 64,
    },
    citationIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
      maxItems: 128,
    },
    pathIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
      maxItems: 256,
    },
  },
  required: [
    "outcome",
    "answerValues",
    "supportingFactIds",
    "citationIds",
    "pathIds",
  ],
  additionalProperties: false,
};
deepFreezeValue(m3b3OutputJsonSchema);
export const M3B3_OUTPUT_JSON_SCHEMA = m3b3OutputJsonSchema;
export const M3B4_OUTPUT_JSON_SCHEMA = M3B3_OUTPUT_JSON_SCHEMA;

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
  isNoObjectGeneratedError?: ((error: unknown) => boolean) | undefined;
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
            '{ "outcome": { "kind": "plan", "plan": ... } } or { "outcome": { "kind": "unplannable", "witness": ... } }',
        };
  const shared = {
    protocol: M1C_PROMPT_PROTOCOL,
    generationOutcomeContract: GENERATION_OUTCOME_PROMPT_CONTRACT,
    originalTask: request.originalTask,
    taskInputs: request.taskInputs,
    languageManifest: request.languageManifest,
    semanticObligations: request.semanticObligations,
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

function renderCodeModeRequest(request: CodeModeModelRequest): string {
  const transport = {
    formatVersion: request.structuredOutputTransport?.formatVersion ?? null,
    compilerVersion: request.structuredOutputTransport?.compilerVersion ?? null,
    manifestDigest: request.structuredOutputTransport?.manifestDigest ?? null,
    schemaDigest: request.structuredOutputTransport?.schemaDigest ?? null,
    envelope:
      '{ "outcome": { "kind": "program", "source": "..." } } or { "outcome": { "kind": "unplannable", "witness": ... } }',
  };
  const shared = {
    protocol: request.protocol,
    originalTask: request.originalTask,
    taskInputs: request.taskInputs,
    languageManifest: request.languageManifest,
    semanticObligations: request.semanticObligations,
    structuredOutputTransport: transport,
  };
  return JSON.stringify(
    request.kind === "initial"
      ? {
          ...shared,
          turn: "initial",
          constraint: request.constraint,
        }
      : {
          ...shared,
          turn: "repair",
          previousProgram: request.previousProgram,
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
  const isNoObjectGeneratedError = property(
    property(module, "NoObjectGeneratedError"),
    "isInstance",
  );
  if (
    !callable(generateText) ||
    !callable(outputObject) ||
    !callable(jsonSchema)
  ) {
    throw new Error(
      "AI SDK 7 generateText, Output.object, or jsonSchema is unavailable.",
    );
  }
  return {
    generateText,
    outputObject,
    jsonSchema,
    ...(callable(isNoObjectGeneratedError)
      ? {
          isNoObjectGeneratedError: (error: unknown): boolean =>
            isNoObjectGeneratedError(error) === true,
        }
      : {}),
  };
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
  return usageKnown
    ? "dispatched-with-usage"
    : dispatched
      ? "dispatched-usage-unknown"
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
  return createAiSdkAdapter(
    input,
    renderRequest,
    normalizeStructuredOutputEnvelope,
    "generation_outcome",
    "A Lachesis plan proposal or principled abstention.",
  );
}

type AiSdkRequest = Readonly<{
  structuredOutputTransport: StructuredOutputTransport | null;
}>;

type AiSdkAdapter<Request extends AiSdkRequest> = Readonly<{
  identity: ModelIdentity;
  inference: InferenceSettings;
  pricingEntryId: string;
  preflightStructuredOutput: (
    transport: StructuredOutputTransport,
  ) => Promise<AdapterPreflightResult>;
  generate: (
    request: Request,
  ) => Promise<
    ReturnType<ModelAdapter["generate"]> extends Promise<infer Output>
      ? Output
      : never
  >;
}>;

type StructuredNormalizerResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; error: Readonly<{ message: string }> }>;

type StructuredNormalizer = (value: unknown) => StructuredNormalizerResult;

function normalizeCodeModeEnvelope(value: unknown): StructuredNormalizerResult {
  const envelope = z
    .strictObject({ outcome: codeModeOutcomeSchema })
    .safeParse(value);
  if (envelope.success) return { ok: true, value: envelope.data.outcome };
  const direct = codeModeOutcomeSchema.safeParse(value);
  return direct.success
    ? { ok: true, value: direct.data }
    : {
        ok: false,
        error: {
          message: `Invalid CodeMode outcome: ${envelope.error.issues.map((issue) => issue.message).join("; ")}`,
        },
      };
}

function createAiSdkAdapter<Request extends AiSdkRequest>(
  input: AiSdkModelAdapterInput,
  render: (request: Request) => string,
  normalize: StructuredNormalizer,
  outputName: string,
  outputDescription: string,
): AiSdkAdapter<Request> {
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
        const prompt = render(request);
        const sdk = input.runtime ?? (await loadAiSdk());
        const transport = request.structuredOutputTransport;
        const structured = transport !== null;
        const output =
          transport !== null
            ? sdk.outputObject({
                name: outputName,
                description: outputDescription,
                schema: sdk.jsonSchema(transport.jsonSchema, {
                  validate: (value: unknown) => {
                    const normalized = normalize(value);
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

export function createAiSdkCodeModeAdapter(
  input: AiSdkModelAdapterInput,
): CodeModeModelAdapter {
  return createAiSdkAdapter(
    input,
    renderCodeModeRequest,
    normalizeCodeModeEnvelope,
    "codemode_outcome",
    "A restricted TypeScript program or typed infeasibility witness.",
  );
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

export function createOpenAiCodeModeAdapter(
  input: OpenAiAdapterInput,
): CodeModeModelAdapter {
  return createAiSdkCodeModeAdapter({
    identity: {
      provider: "openai",
      model: M1B_OPENAI_MODEL,
      adapterVersion: M2_CODEMODE_ADAPTER_VERSION,
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

export function createAnthropicCodeModeAdapter(
  input: AnthropicAdapterInput,
): CodeModeModelAdapter {
  return createAiSdkCodeModeAdapter({
    identity: {
      provider: "anthropic",
      model: M1B_ANTHROPIC_MODEL,
      adapterVersion: M2_CODEMODE_ADAPTER_VERSION,
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

function m3bOracleIdentity(
  provider: "openai" | "anthropic",
  adapterVersion: string,
  anthropicTransport: "json-tool" | "json-schema" = "json-tool",
): M3bOracleIdentity {
  return Object.freeze({
    provider,
    model: provider === "openai" ? M1B_OPENAI_MODEL : M1B_ANTHROPIC_MODEL,
    adapterVersion,
    settings: Object.freeze({
      temperature: null,
      reasoning: provider === "openai" ? "low" : "adaptive-low",
      maxInputTokens: 8_000,
      maxOutputTokens: 2_000,
      sdkRetries: 0,
      structuredOutput:
        provider === "openai" ? "json-schema" : anthropicTransport,
    }),
  });
}

export const M3B4_ANTHROPIC_TRANSPORT_SELECTION = Object.freeze({
  comparisonVersion: "m3b-anthropic-structured-output-comparison/1",
  candidates: Object.freeze(["jsonTool", "outputFormat"]),
  selected: "jsonTool" as const,
  prospectiveRule:
    "Select only a route that serializes the exact frozen portable schema. The installed native output-format route rewrites minLength and maxItems as descriptions, while jsonTool preserves the schema exactly; external tools remain disabled.",
});

export const M3B4_ORACLE_IDENTITIES: ReadonlyArray<M3bOracleIdentity> =
  Object.freeze([
    m3bOracleIdentity("openai", M3B4_PROVIDER_ADAPTER_VERSION),
    m3bOracleIdentity("anthropic", M3B4_PROVIDER_ADAPTER_VERSION, "json-tool"),
  ]);

export const M3B3_ORACLE_IDENTITIES: ReadonlyArray<M3bOracleIdentity> =
  Object.freeze([
    m3bOracleIdentity("openai", M3B3_PROVIDER_ADAPTER_VERSION),
    m3bOracleIdentity("anthropic", M3B3_PROVIDER_ADAPTER_VERSION),
  ]);
export const M3B2_ORACLE_IDENTITIES: ReadonlyArray<M3bOracleIdentity> =
  Object.freeze([
    m3bOracleIdentity("openai", M3B2_PROVIDER_ADAPTER_VERSION),
    m3bOracleIdentity("anthropic", M3B2_PROVIDER_ADAPTER_VERSION),
  ]);
export const M3B1_ORACLE_IDENTITIES: ReadonlyArray<M3bOracleIdentity> =
  Object.freeze([
    m3bOracleIdentity("openai", M3B1_PROVIDER_ADAPTER_VERSION),
    m3bOracleIdentity("anthropic", M3B1_PROVIDER_ADAPTER_VERSION),
  ]);

function renderM3bOracleRequest(request: M3bOracleRequest): string {
  return JSON.stringify({
    protocol: M3B_ORACLE_PROMPT,
    publicOutputSchema: M3B4_OUTPUT_JSON_SCHEMA,
    instruction: request.instruction,
    answerContract: request.answerContract,
    evidence: request.evidence,
    wireRepair: request.wireRepair,
    semanticRepair: request.semanticRepair,
  });
}

function m3bFailureCode(error: unknown): M3bOracleFailureCode {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("overload") || message.includes("429"))
    return "provider-overload";
  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("408") ||
    message.includes("504")
  )
    return "provider-timeout";
  if (
    message.includes("unavailable") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("socket") ||
    message.includes("500") ||
    message.includes("503") ||
    message.includes("502")
  )
    return "provider-unavailable";
  return "contract-mismatch";
}

function numericProperty(value: unknown, key: string): number | null {
  const found = property(value, key);
  return typeof found === "number" && Number.isInteger(found) ? found : null;
}

const diagnosticIssuesSchema = z.array(
  z.looseObject({
    code: z.string(),
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  }),
);

function diagnosticIssues(value: unknown): M3bAttemptProvenance["issues"] {
  const direct = diagnosticIssuesSchema.safeParse(property(value, "issues"));
  const caused = diagnosticIssuesSchema.safeParse(
    property(property(value, "cause"), "issues"),
  );
  const issues = direct.success
    ? direct.data
    : caused.success
      ? caused.data
      : [];
  return issues.slice(0, 64).map((issue) => ({
    code: issue.code,
    path: issue.path,
  }));
}

function errorClass(value: unknown): string | null {
  const name = stringProperty(value, "name");
  if (name !== null) return name.slice(0, 128);
  const constructorName = stringProperty(
    property(value, "constructor"),
    "name",
  );
  return constructorName?.slice(0, 128) ?? null;
}

function sanitizedErrorMessage(value: unknown): string | null {
  let withoutControlCharacters = "";
  for (const character of errorMessage(value)) {
    const code = character.codePointAt(0) ?? 0;
    withoutControlCharacters += code <= 31 || code === 127 ? " " : character;
  }
  const message = withoutControlCharacters
    .replaceAll(/(?:sk|key|token)-[a-z0-9_-]{8,}/giu, "[redacted]")
    .trim();
  return message.length === 0 ? null : message.slice(0, 512);
}

async function boundedOutputEvidence(value: unknown): Promise<
  Readonly<{
    outputPresent: boolean;
    outputDigest: string | null;
    outputSizeBytes: number | null;
    outputTruncated: boolean;
  }>
> {
  if (value === undefined || value === null)
    return {
      outputPresent: false,
      outputDigest: null,
      outputSizeBytes: null,
      outputTruncated: false,
    };
  let serialized: string;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return {
      outputPresent: true,
      outputDigest: null,
      outputSizeBytes: null,
      outputTruncated: false,
    };
  }
  const bytes = new TextEncoder().encode(serialized);
  const bounded = bytes.subarray(0, 65_536);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bounded);
  const outputDigest = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return {
    outputPresent: true,
    outputDigest,
    outputSizeBytes: bytes.byteLength,
    outputTruncated: bounded.byteLength !== bytes.byteLength,
  };
}

function provenance(
  input: Readonly<{
    stage: M3bAttemptProvenance["stage"];
    category: string;
    usageAvailable: boolean;
    outputEvidence?: Readonly<{
      outputPresent: boolean;
      outputDigest: string | null;
      outputSizeBytes: number | null;
      outputTruncated: boolean;
    }>;
    metadata?: ModelResponseMetadata | undefined;
    error?: unknown;
    issues?: M3bAttemptProvenance["issues"] | undefined;
    rawOutputArtifact?: M3bRawOutputArtifact | null | undefined;
    jsonParseResult?: "not-attempted" | "passed" | "failed" | undefined;
    wireSchemaResult?: "not-attempted" | "passed" | "failed" | undefined;
  }>,
): M3bAttemptProvenance {
  return {
    stage: input.stage,
    category: input.category,
    providerStatusCode:
      numericProperty(input.error, "statusCode") ??
      numericProperty(input.error, "status") ??
      numericProperty(property(input.error, "cause"), "statusCode") ??
      numericProperty(property(input.error, "cause"), "status"),
    providerErrorCode:
      stringProperty(input.error, "code") ??
      stringProperty(property(input.error, "cause"), "code"),
    providerResponseId:
      input.metadata?.providerResponseId ??
      input.metadata?.providerRequestId ??
      null,
    finishReason: input.metadata?.finishReason ?? null,
    rawFinishReason: input.metadata?.rawFinishReason ?? null,
    usageAvailable: input.usageAvailable,
    outputPresent: input.outputEvidence?.outputPresent ?? false,
    outputDigest: input.outputEvidence?.outputDigest ?? null,
    outputSizeBytes: input.outputEvidence?.outputSizeBytes ?? null,
    outputTruncated: input.outputEvidence?.outputTruncated ?? false,
    issues:
      input.issues ??
      (input.error === undefined ? [] : diagnosticIssues(input.error)),
    errorClass: input.error === undefined ? null : errorClass(input.error),
    causeClass:
      input.error === undefined
        ? null
        : errorClass(property(input.error, "cause")),
    sanitizedMessage:
      input.error === undefined ? null : sanitizedErrorMessage(input.error),
    rawOutputArtifact: input.rawOutputArtifact ?? null,
    jsonParseResult: input.jsonParseResult ?? "not-attempted",
    wireSchemaResult: input.wireSchemaResult ?? "not-attempted",
  };
}

function exceptionStage(
  dispatchEvidence: AdapterDispatchEvidence,
): M3bAttemptProvenance["stage"] {
  return dispatchEvidence === "not-dispatched" ? "pre-dispatch" : "transport";
}

function exceptionCategory(
  aborted: boolean,
  outputPresent: boolean,
  dispatchEvidence: AdapterDispatchEvidence,
): string {
  if (aborted) return "provider-timeout";
  if (outputPresent) return "structured-output-exception";
  return dispatchEvidence === "not-dispatched"
    ? "adapter-configuration-exception"
    : "provider-transport-exception";
}

function m3bUsage(
  usage: z.infer<typeof usageSchema>,
  pricing: PricingEntry,
  latencyMs: number,
): M3bOracleUsage {
  const normalized = usageFromAiSdk(usage, pricing);
  return {
    inputTokens: normalized.inputTokens,
    outputTokens: normalized.outputTokens,
    costUsdMicros: normalized.costUsdMicros,
    latencyMs,
  };
}

type M3bAiSdkOracleInput = Readonly<{
  identity: M3bOracleIdentity;
  pricing: PricingEntry;
  loadModel: (observer: DispatchObserver) => Promise<unknown>;
  providerOptions: ProviderOptions;
  runtime?: AiSdkRuntime | undefined;
  timeoutMs?: number | undefined;
  rawOutputWriter?: M3bRawOutputWriter | undefined;
}>;

async function persistRawOutput(
  writer: M3bRawOutputWriter | undefined,
  context: Readonly<{ recordKey: string; attemptIndex: number }>,
  text: string | undefined,
): Promise<
  Readonly<{
    artifact: M3bRawOutputArtifact | null;
    error: unknown;
  }>
> {
  if (writer === undefined || text === undefined)
    return { artifact: null, error: null };
  const written = await writer({ ...context, text });
  return written.ok
    ? { artifact: written.value, error: null }
    : { artifact: null, error: written.error };
}

function createM3bAiSdkOracle(input: M3bAiSdkOracleInput): M3bOracle {
  return {
    identity: input.identity,
    async generate(request, context) {
      const portable = validatePortableStructuredOutputSchema(
        M3B4_OUTPUT_JSON_SCHEMA,
      );
      if (!portable.ok)
        return {
          kind: "failure",
          code: "contract-mismatch",
          dispatchEvidence: "not-dispatched",
          usage: null,
          provenance: provenance({
            stage: "pre-dispatch",
            category: "wire-schema-rejected",
            usageAvailable: false,
          }),
        };
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
      let isNoObjectGeneratedError: (error: unknown) => boolean = () => false;
      try {
        const sdk = input.runtime ?? (await loadAiSdk());
        isNoObjectGeneratedError =
          sdk.isNoObjectGeneratedError ?? isNoObjectGeneratedError;
        const output = sdk.outputObject({
          name: "m3b_evidence_answer",
          description:
            "A typed answer or insufficient-evidence outcome with citation and canonical-path references.",
          schema: sdk.jsonSchema(M3B4_OUTPUT_JSON_SCHEMA, {
            validate: (value: unknown) => {
              const parsed = m3bOracleOutputSchema.safeParse(value);
              return parsed.success
                ? { success: true, value: parsed.data }
                : {
                    success: false,
                    error: parsed.error,
                  };
            },
          }),
        });
        const raw = await sdk.generateText({
          model: await input.loadModel(observer),
          prompt: renderM3bOracleRequest(request),
          maxOutputTokens: input.identity.settings.maxOutputTokens,
          maxRetries: 0,
          abortSignal,
          ...(input.identity.settings.temperature === null
            ? {}
            : { temperature: input.identity.settings.temperature }),
          providerOptions: input.providerOptions,
          output,
        });
        const parsed = generationResultSchema.safeParse(raw);
        const latencyMs = Math.max(0, Math.round(performance.now() - started));
        if (!parsed.success || parsed.data.usage === undefined) {
          const outputEvidence = await boundedOutputEvidence(
            parsed.success ? (parsed.data.output ?? parsed.data.text) : raw,
          );
          return {
            kind: "failure",
            code: "contract-mismatch",
            dispatchEvidence: failureEvidence(dispatched, false),
            usage: null,
            provenance: provenance({
              stage: "provider-response",
              category: parsed.success
                ? "usage-unavailable"
                : "provider-envelope-invalid",
              usageAvailable: false,
              outputEvidence,
              error: parsed.success ? undefined : parsed.error,
            }),
          };
        }
        const usage = m3bUsage(parsed.data.usage, input.pricing, latencyMs);
        const metadata = responseMetadata({
          configuredModel: input.identity.model,
          response: parsed.data.response,
          providerMetadata: parsed.data.providerMetadata,
          finishReason: parsed.data.finishReason,
          rawFinishReason: parsed.data.rawFinishReason,
        });
        if (isSafetyRefusal(metadata))
          return {
            kind: "failure",
            code: "provider-refusal",
            dispatchEvidence: "dispatched-with-usage",
            usage,
            provenance: provenance({
              stage: "provider-response",
              category: "provider-refusal",
              usageAvailable: true,
              metadata,
              outputEvidence: await boundedOutputEvidence(parsed.data.output),
            }),
          };
        const normalized = m3bOracleOutputSchema.safeParse(parsed.data.output);
        const outputEvidence = await boundedOutputEvidence(parsed.data.output);
        const rejectedOutputArtifact = normalized.success
          ? { artifact: null, error: null }
          : await persistRawOutput(
              input.rawOutputWriter,
              context,
              JSON.stringify(parsed.data.output),
            );
        if (rejectedOutputArtifact.error !== null)
          return {
            kind: "failure",
            code: "wire-schema-rejected",
            dispatchEvidence: "dispatched-with-usage",
            usage,
            provenance: provenance({
              stage: "wire-decoding",
              category: "raw-output-artifact-write-failed",
              usageAvailable: true,
              metadata,
              outputEvidence,
              error: rejectedOutputArtifact.error,
            }),
          };
        return normalized.success
          ? {
              kind: "success",
              output: normalized.data,
              usage,
              provenance: provenance({
                stage: "wire-decoding",
                category: "accepted",
                usageAvailable: true,
                metadata,
                outputEvidence,
                jsonParseResult: "passed",
                wireSchemaResult: "passed",
              }),
            }
          : {
              kind: "failure",
              code: "wire-schema-rejected",
              dispatchEvidence: "dispatched-with-usage",
              usage,
              provenance: provenance({
                stage: "wire-decoding",
                category: "wire-schema-rejected",
                usageAvailable: true,
                metadata,
                outputEvidence,
                error: normalized.error,
                rawOutputArtifact: rejectedOutputArtifact.artifact,
                jsonParseResult: "passed",
                wireSchemaResult: "failed",
              }),
            };
      } catch (error) {
        const latencyMs = Math.max(0, Math.round(performance.now() - started));
        const directStructured =
          structuredGenerationErrorSchema.safeParse(error);
        const causedStructured = structuredGenerationErrorSchema.safeParse(
          property(error, "cause"),
        );
        const structured = directStructured.success
          ? directStructured
          : causedStructured;
        const caughtUsage =
          structured.success && structured.data.usage !== undefined
            ? m3bUsage(structured.data.usage, input.pricing, latencyMs)
            : null;
        const metadata = structured.success
          ? responseMetadata({
              configuredModel: input.identity.model,
              response: structured.data.response,
              finishReason: structured.data.finishReason,
              rawFinishReason: structured.data.rawFinishReason,
            })
          : undefined;
        const rawText = structured.success
          ? structured.data.text
          : (stringProperty(error, "text") ?? undefined);
        const outputEvidence = await boundedOutputEvidence(rawText);
        const dispatchEvidence = failureEvidence(
          dispatched,
          caughtUsage !== null,
        );
        const noObjectGenerated = isNoObjectGeneratedError(error);
        if (
          typeof rawText === "string" &&
          caughtUsage !== null &&
          (noObjectGenerated || structured.success)
        ) {
          const artifact = await persistRawOutput(
            input.rawOutputWriter,
            context,
            rawText,
          );
          if (artifact.error !== null)
            return {
              kind: "failure",
              code: "wire-schema-rejected",
              dispatchEvidence,
              usage: caughtUsage,
              latencyMs,
              provenance: provenance({
                stage: "wire-decoding",
                category: "raw-output-artifact-write-failed",
                usageAvailable: true,
                metadata,
                outputEvidence,
                error: artifact.error,
              }),
            };
          const decoded = decodeM3bOracleWire(rawText);
          if (decoded.kind === "accepted")
            return {
              kind: "success",
              output: decoded.output,
              usage: caughtUsage,
              provenance: provenance({
                stage: "wire-decoding",
                category: "sdk-runtime-schema-disagreement",
                usageAvailable: true,
                metadata,
                outputEvidence,
                rawOutputArtifact: artifact.artifact,
                error,
                jsonParseResult: "passed",
                wireSchemaResult: "passed",
              }),
            };
          return {
            kind: "failure",
            code: decoded.kind,
            dispatchEvidence,
            usage: caughtUsage,
            latencyMs,
            provenance: provenance({
              stage: "wire-decoding",
              category: decoded.kind,
              usageAvailable: true,
              metadata,
              outputEvidence,
              rawOutputArtifact: artifact.artifact,
              error,
              issues: decoded.issues,
              jsonParseResult:
                decoded.kind === "json-parse-failed" ? "failed" : "passed",
              wireSchemaResult:
                decoded.kind === "wire-schema-rejected"
                  ? "failed"
                  : "not-attempted",
            }),
          };
        }
        return {
          kind: "failure",
          code: abortSignal.aborted
            ? "provider-timeout"
            : m3bFailureCode(error),
          dispatchEvidence,
          usage: caughtUsage,
          latencyMs,
          provenance: provenance({
            stage: exceptionStage(dispatchEvidence),
            category: exceptionCategory(
              abortSignal.aborted,
              outputEvidence.outputPresent,
              dispatchEvidence,
            ),
            usageAvailable: caughtUsage !== null,
            metadata,
            outputEvidence,
            error,
          }),
        };
      }
    },
  };
}

export function createOpenAiM3bOracle(
  provider?: OpenAiProviderSettings,
  diagnostics?: Readonly<{
    rawOutputWriter?: M3bRawOutputWriter | undefined;
    runtime?: AiSdkRuntime | undefined;
  }>,
): M3bOracle {
  const identity = m3bOracleIdentity("openai", M3B4_PROVIDER_ADAPTER_VERSION);
  return createM3bAiSdkOracle({
    identity,
    pricing: OPENAI_PRICING,
    loadModel: (observer) =>
      providerModel(
        ["@ai-sdk", "openai"].join("/"),
        "createOpenAI",
        providerSettings(provider),
        identity.model,
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
    ...(diagnostics?.rawOutputWriter === undefined
      ? {}
      : { rawOutputWriter: diagnostics.rawOutputWriter }),
    ...(diagnostics?.runtime === undefined
      ? {}
      : { runtime: diagnostics.runtime }),
  });
}

export function createAnthropicM3bOracle(
  input: Readonly<{
    acknowledgeAdaptiveThinking: true;
    provider?: AnthropicProviderSettings | undefined;
    rawOutputWriter?: M3bRawOutputWriter | undefined;
    transportMode?: "jsonTool" | "outputFormat" | undefined;
    runtime?: AiSdkRuntime | undefined;
  }>,
): M3bOracle {
  const transportMode =
    input.transportMode ?? M3B4_ANTHROPIC_TRANSPORT_SELECTION.selected;
  const identity = m3bOracleIdentity(
    "anthropic",
    M3B4_PROVIDER_ADAPTER_VERSION,
    transportMode === "jsonTool" ? "json-tool" : "json-schema",
  );
  return createM3bAiSdkOracle({
    identity,
    pricing: ANTHROPIC_DIRECT_PRICING,
    loadModel: (observer) =>
      providerModel(
        ["@ai-sdk", "anthropic"].join("/"),
        "createAnthropic",
        providerSettings(input.provider),
        identity.model,
        observer,
      ),
    providerOptions: {
      anthropic: {
        thinking: { type: "adaptive" },
        effort: "low",
        structuredOutputMode: transportMode,
      },
    },
    ...(input.rawOutputWriter === undefined
      ? {}
      : { rawOutputWriter: input.rawOutputWriter }),
    ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
  });
}

export type M2CodeModePrimaryAdapters = Readonly<{
  openai: CodeModeModelAdapter;
  anthropic: CodeModeModelAdapter;
}>;

export function createM2CodeModePrimaryAdapters(
  input: M1bPrimaryAdaptersInput,
): M2CodeModePrimaryAdapters {
  return Object.freeze({
    openai: createOpenAiCodeModeAdapter({
      constraint: input.constraint,
      ...(input.openai === undefined ? {} : { provider: input.openai }),
    }),
    anthropic: createAnthropicCodeModeAdapter({
      constraint: input.constraint,
      acknowledgeAdaptiveThinking: true,
      ...(input.anthropic === undefined ? {} : { provider: input.anthropic }),
    }),
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
