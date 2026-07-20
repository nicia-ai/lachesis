import {
  canonicalizeJson,
  createPlanLanguageManifest,
  diagnostic,
  parseJson,
  type Result,
  semanticObligationSchema,
} from "@nicia-ai/lachesis";
import {
  M3B_PREREGISTERED_CORPUS,
  M3B_REFERENCE_GRAPH,
  m3bOracleOutputSchema,
  m3bOracleRequestSchema,
  type M4d1OracleRequest,
  m4d1OracleRequestSchema,
  m4OracleAnswerSchema,
  validateM3bSemanticOutput,
} from "@nicia-ai/lachesis-evidence";
import {
  CODEMODE_MODEL_VISIBLE_GRAMMAR_CONTRACT,
  type CodeModeRepairRequest,
  compileCodeModeStructuredOutputTransport,
  compileStructuredOutputTransport,
  createM1aCatalogResolver,
  generateCodeMode,
  generatePlan,
  type GenerationStrategy,
  loadM1aCorpus,
  M1A_GENERATION_STRATEGIES,
  M2_CODEMODE_PROMPT_PROTOCOL,
  type ModelRequest,
  RECORDED_DOUBLE_PLAN,
} from "@nicia-ai/lachesis-generator";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AI_SDK_ADAPTER_VERSION,
  type AiSdkRuntime,
  createAiSdkModelAdapter,
  createAnthropicCodeModeAdapter,
  createAnthropicM3bOracle,
  createAnthropicM4d1Oracle,
  createAnthropicM5b0Oracle,
  createBedrockAnthropicPlanAdapter,
  createM1bPricingSnapshot,
  createM1bPrimaryAdapters,
  createM4d1ProtocolProbeDesign,
  createOpenAiCodeModeAdapter,
  createOpenAiM3bOracle,
  createOpenAiM4d1Oracle,
  createOpenAiM5b0Oracle,
  M1B_ANTHROPIC_MODEL,
  M1B_BEDROCK_ANTHROPIC_MODEL,
  M1B_OPENAI_MODEL,
  M1B_PILOT_CAPS,
  M1B_PRICING_ENTRIES,
  M1B_REPETITIONS,
  M3B4_ANTHROPIC_TRANSPORT_SELECTION,
  M3B4_ORACLE_IDENTITIES,
  M3B4_OUTPUT_JSON_SCHEMA,
  M4D1_ORACLE_IDENTITIES,
  M4D1_OUTPUT_JSON_SCHEMA,
  M5B0_ORACLE_IDENTITIES,
  M5B0_PROVIDER_ADAPTER_VERSION,
} from "../src/index.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function strategy(id: GenerationStrategy["id"]): GenerationStrategy {
  return required(
    M1A_GENERATION_STRATEGIES.find((item) => item.id === id),
    `Missing strategy ${id}.`,
  );
}

async function generationInput() {
  const benchmarkCase = required(
    unwrap(await loadM1aCorpus()).find(
      (item) => item.case.id === "numbers/double",
    ),
    "Missing numbers/double case.",
  );
  const catalog = unwrap(
    unwrap(createM1aCatalogResolver())(benchmarkCase.case.catalogId),
  );
  return { benchmarkCase, catalog };
}

function runtimeReturning(
  value: unknown,
  captured: Array<unknown> = [],
): AiSdkRuntime {
  return {
    generateText: (...arguments_) => {
      captured.push(arguments_[0]);
      return Promise.resolve(value);
    },
    outputObject: (...arguments_) => {
      captured.push(arguments_[0]);
      return { kind: "output-object-fixture" };
    },
    jsonSchema: (...arguments_) => arguments_[0],
  };
}

type CapturedFetchRequest = Readonly<{ url: string; body: unknown }>;
type RealOpenAiFactory = (
  settings: Readonly<{ apiKey: string; fetch: typeof globalThis.fetch }>,
) => unknown;

class FixtureNoObjectGeneratedError extends Error {
  readonly text: string;
  readonly usage: Readonly<{ inputTokens: number; outputTokens: number }>;
  readonly response: Readonly<{ id: string; modelId: string }>;
  readonly finishReason = "stop";

  constructor(input: {
    readonly message: string;
    readonly text: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly responseId: string;
  }) {
    super(input.message);
    this.name = "AI_NoObjectGeneratedError";
    this.text = input.text;
    this.usage = {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
    };
    this.response = {
      id: input.responseId,
      modelId: M1B_ANTHROPIC_MODEL,
    };
  }
}

function reflectedProperty(value: unknown, key: string): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  )
    return undefined;
  return Object.entries(value).find(([name]) => name === key)?.[1];
}

function interceptedFetch(
  captured: Array<CapturedFetchRequest>,
  response: Readonly<{ status: number; message: string }> = {
    status: 500,
    message: "provider unavailable: offline interception",
  },
): typeof globalThis.fetch {
  return (resource, options) => {
    const url =
      typeof resource === "string"
        ? resource
        : resource instanceof URL
          ? resource.toString()
          : resource.url;
    const body = options?.body;
    if (typeof body !== "string") throw new Error("Expected a JSON body.");
    const parsed = parseJson(body);
    if (!parsed.ok) throw new Error(parsed.error.message);
    captured.push({ url, body: parsed.value });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: "intercepted",
            message: response.message,
          },
        }),
        {
          status: response.status,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  };
}

function interceptedAnthropicOutput(
  captured: Array<CapturedFetchRequest>,
  input: unknown,
): typeof globalThis.fetch {
  return (resource, options) => {
    const url =
      typeof resource === "string"
        ? resource
        : resource instanceof URL
          ? resource.toString()
          : resource.url;
    const body = options?.body;
    if (typeof body !== "string") throw new Error("Expected a JSON body.");
    const parsed = parseJson(body);
    if (!parsed.ok) throw new Error(parsed.error.message);
    captured.push({ url, body: parsed.value });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          type: "message",
          id: "msg_offline_no_object",
          model: M1B_ANTHROPIC_MODEL,
          content: [
            {
              type: "tool_use",
              id: "tool_offline_no_object",
              name: "json",
              input,
            },
          ],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 40, output_tokens: 20 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  };
}

function stringLeaves(value: unknown): ReadonlyArray<string> {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(stringLeaves);
}

const FORBIDDEN_SCHEMA_KEYWORDS = new Set([
  "$defs",
  "$ref",
  "definitions",
  "propertyNames",
  "readOnly",
]);

function schemaObject(value: unknown): Readonly<Record<string, unknown>> {
  return z.record(z.string(), z.unknown()).parse(value);
}

function expectPortableSchema(value: unknown, root = true): void {
  const node = schemaObject(value);
  if (root) expect(node["type"]).toBe("object");
  for (const key of Object.keys(node))
    expect(FORBIDDEN_SCHEMA_KEYWORDS.has(key)).toBe(false);
  if (node["type"] === "object") {
    const properties = schemaObject(node["properties"]);
    const required = z.array(z.string()).parse(node["required"]);
    expect(node["additionalProperties"]).toBe(false);
    expect([...required].toSorted()).toEqual(
      Object.keys(properties).toSorted(),
    );
    for (const child of Object.values(properties))
      expectPortableSchema(child, false);
  }
  if (node["items"] !== undefined) expectPortableSchema(node["items"], false);
  if (node["anyOf"] !== undefined)
    for (const child of z.array(z.unknown()).min(1).parse(node["anyOf"]))
      expectPortableSchema(child, false);
}

const MODEL_AUTHORITY_PROPERTY_NAMES = new Set([
  "allowedCapabilities",
  "budget",
  "maxItems",
]);

function expectNoModelAuthorityProperties(value: unknown): void {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) return;
  const properties = z
    .record(z.string(), z.unknown())
    .safeParse(parsed.data["properties"]);
  if (properties.success) {
    for (const [name, child] of Object.entries(properties.data)) {
      expect(MODEL_AUTHORITY_PROPERTY_NAMES.has(name)).toBe(false);
      expectNoModelAuthorityProperties(child);
    }
  }
  if (parsed.data["items"] !== undefined)
    expectNoModelAuthorityProperties(parsed.data["items"]);
  const variants = z.array(z.unknown()).safeParse(parsed.data["anyOf"]);
  if (variants.success)
    for (const child of variants.data) expectNoModelAuthorityProperties(child);
}

function schemasWithOperation(
  value: unknown,
  operation: string,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  const found: Array<Readonly<Record<string, unknown>>> = [];
  const visit = (candidate: unknown): void => {
    const parsed = z.record(z.string(), z.unknown()).safeParse(candidate);
    if (!parsed.success) return;
    const properties = z
      .record(z.string(), z.unknown())
      .safeParse(parsed.data["properties"]);
    if (properties.success) {
      const op = z
        .record(z.string(), z.unknown())
        .safeParse(properties.data["op"]);
      if (op.success && op.data["const"] === operation) found.push(parsed.data);
      for (const child of Object.values(properties.data)) visit(child);
    }
    if (parsed.data["items"] !== undefined) visit(parsed.data["items"]);
    const variants = z.array(z.unknown()).safeParse(parsed.data["anyOf"]);
    if (variants.success) for (const child of variants.data) visit(child);
  };
  visit(value);
  return found;
}

describe("AI SDK provider adapters", () => {
  it("records provider identity and detailed token usage centrally", async () => {
    const captured: Array<unknown> = [];
    const pricing = required(M1B_PRICING_ENTRIES[0], "Missing OpenAI pricing.");
    const adapter = createAiSdkModelAdapter({
      identity: {
        provider: "openai",
        model: M1B_OPENAI_MODEL,
        adapterVersion: AI_SDK_ADAPTER_VERSION,
      },
      inference: {
        temperature: null,
        seed: null,
        reasoningSettings: { mode: "reasoning", effort: "low" },
        maxInputTokens: 64_000,
        maxOutputTokens: 8_192,
        structuredOutputMode: "json-schema",
      },
      pricing,
      loadModel: () => Promise.resolve({ id: "model-fixture" }),
      runtime: runtimeReturning(
        {
          text: JSON.stringify({ kind: "plan", plan: RECORDED_DOUBLE_PLAN }),
          output: { kind: "plan", plan: RECORDED_DOUBLE_PLAN },
          usage: {
            inputTokens: 100,
            inputTokenDetails: {
              cacheReadTokens: 20,
              cacheWriteTokens: 10,
            },
            outputTokens: 30,
            outputTokenDetails: { reasoningTokens: 4 },
          },
          response: {
            id: "response-123",
            modelId: "gpt-5.6-terra-2026-07-01",
            headers: { "x-request-id": "request-123" },
          },
          providerMetadata: { openai: { responseId: "provider-response-123" } },
          finishReason: "stop",
          rawFinishReason: "completed",
        },
        captured,
      ),
    });
    const { benchmarkCase, catalog } = await generationInput();
    const session = unwrap(
      await generatePlan({
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog,
        policy: benchmarkCase.case.policy,
        semanticObligations: benchmarkCase.case.semanticObligations ?? [],
        publicExamples: [],
        adapter,
        strategy: strategy("json-schema"),
      }),
    );

    expect(session.kind).toBe("compiled");
    expect(session.record.totalInputTokens).toBe(100);
    expect(session.record.totalCachedInputTokens).toBe(20);
    expect(session.record.totalCacheWriteInputTokens).toBe(10);
    expect(session.record.totalOutputTokens).toBe(30);
    expect(session.record.totalReasoningTokens).toBe(4);
    expect(session.record.attempts[0]?.responseMetadata).toEqual({
      providerRequestId: "request-123",
      providerResponseId: "provider-response-123",
      returnedModelId: "gpt-5.6-terra-2026-07-01",
      finishReason: "stop",
      rawFinishReason: "completed",
    });
    const requestOptions = z.record(z.string(), z.unknown()).parse(captured[1]);
    expect(requestOptions["maxOutputTokens"]).toBe(8_192);
    expect(requestOptions["maxRetries"]).toBe(0);
    expect(requestOptions["abortSignal"]).toBeInstanceOf(AbortSignal);
    expect(requestOptions).not.toHaveProperty("temperature");
    expect(requestOptions).not.toHaveProperty("seed");
    expect(requestOptions).not.toHaveProperty("tools");
  });

  it("classifies provider safety refusals separately from abstention", async () => {
    const pricing = required(M1B_PRICING_ENTRIES[0], "Missing OpenAI pricing.");
    const adapter = createAiSdkModelAdapter({
      identity: {
        provider: "openai",
        model: M1B_OPENAI_MODEL,
        adapterVersion: AI_SDK_ADAPTER_VERSION,
      },
      inference: {
        temperature: null,
        seed: null,
        reasoningSettings: { mode: "reasoning", effort: "low" },
        maxInputTokens: 64_000,
        maxOutputTokens: 8_192,
        structuredOutputMode: "json-schema",
      },
      pricing,
      loadModel: () => Promise.resolve({ id: "model-fixture" }),
      runtime: runtimeReturning({
        text: "",
        usage: { inputTokens: 12, outputTokens: 0 },
        response: {
          id: "response-refusal",
          modelId: M1B_OPENAI_MODEL,
          headers: { "x-request-id": "request-refusal" },
        },
        finishReason: "content-filter",
        rawFinishReason: "refusal",
      }),
    });
    const { benchmarkCase, catalog } = await generationInput();
    const session = unwrap(
      await generatePlan({
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog,
        policy: benchmarkCase.case.policy,
        publicExamples: [],
        adapter,
        strategy: strategy("json-schema"),
      }),
    );

    expect(session.kind).toBe("providerRefusal");
    expect(session.record.finalKind).toBe("providerRefusal");
    expect(session.record.attempts[0]?.responseKind).toBe("providerRefusal");
    expect(session.record.attempts[0]?.abstentionReasons).toEqual([]);
  });

  it("aborts and classifies provider timeouts separately", async () => {
    const pricing = required(M1B_PRICING_ENTRIES[0], "Missing OpenAI pricing.");
    const adapter = createAiSdkModelAdapter({
      identity: {
        provider: "openai",
        model: M1B_OPENAI_MODEL,
        adapterVersion: AI_SDK_ADAPTER_VERSION,
      },
      inference: {
        temperature: null,
        seed: null,
        reasoningSettings: { mode: "reasoning", effort: "low" },
        maxInputTokens: 64_000,
        maxOutputTokens: 8_192,
        structuredOutputMode: "json-schema",
      },
      pricing,
      loadModel: () => Promise.resolve({ id: "model-fixture" }),
      timeoutMs: 1,
      runtime: {
        generateText: (...arguments_) => {
          const options = z
            .record(z.string(), z.unknown())
            .parse(arguments_[0]);
          const signal = z
            .custom<AbortSignal>((value) => value instanceof AbortSignal)
            .parse(options["abortSignal"]);
          return new Promise((_, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                reject(new Error("aborted"));
              },
              { once: true },
            );
          });
        },
        outputObject: () => ({ kind: "output-object-fixture" }),
        jsonSchema: (...arguments_) => arguments_[0],
      },
    });
    const { benchmarkCase, catalog } = await generationInput();
    const session = unwrap(
      await generatePlan({
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog,
        policy: benchmarkCase.case.policy,
        publicExamples: [],
        adapter,
        strategy: strategy("json-schema"),
      }),
    );

    expect(session.kind).toBe("adapterFailure");
    expect(session.record.attempts[0]?.adapterFailure?.code).toBe(
      "PROVIDER_TIMEOUT",
    );
  });

  it("freezes pilot caps, pricing, and explicit route configurations", async () => {
    const primary = createM1bPrimaryAdapters({ constraint: "json-schema" });
    const openai = primary.openai;
    const anthropic = primary.anthropic;
    const bedrock = createBedrockAnthropicPlanAdapter({
      constraint: "json-schema",
      acknowledgeAdaptiveThinking: true,
    });
    const pricing = await createM1bPricingSnapshot();

    expect(pricing.ok).toBe(true);
    expect(openai.identity.model).toBe(M1B_OPENAI_MODEL);
    expect(openai.inference.reasoningSettings).toEqual({
      mode: "reasoning",
      effort: "low",
    });
    expect(openai.inference.structuredOutputTransport).toBe(
      "openai-responses-portable-json-schema",
    );
    expect(anthropic.identity.model).toBe(M1B_ANTHROPIC_MODEL);
    expect(anthropic.pricingEntryId).toContain("/direct/");
    expect(anthropic.inference.reasoningSettings).toEqual({
      mode: "adaptive",
      effort: "low",
    });
    expect(anthropic.inference.structuredOutputTransport).toBe(
      "anthropic-json-tool-portable-json-schema",
    );
    expect(bedrock.identity.model).toBe(M1B_BEDROCK_ANTHROPIC_MODEL);
    expect(bedrock.inference.reasoningSettings).toEqual({
      mode: "adaptive",
      effort: "low",
      route: "aws-bedrock",
    });
    expect(M1B_PILOT_CAPS).toMatchObject({
      maxCalls: 400,
      maxInputTokens: 5_000_000,
      maxOutputTokens: 1_000_000,
      maxOutputTokensPerCall: 8_192,
      maxCostUsdMicros: 50_000_000,
    });
    expect(M1B_PILOT_CAPS.providerCostCaps).toEqual([
      { billingProvider: "openai", maxCostUsdMicros: 25_000_000 },
      { billingProvider: "anthropic", maxCostUsdMicros: 25_000_000 },
    ]);
    expect(M1B_REPETITIONS).toBe(2);
  });

  it("uses real packages and portable schemas for every catalog/provider path without network", async () => {
    const openaiRequests: Array<CapturedFetchRequest> = [];
    const anthropicRequests: Array<CapturedFetchRequest> = [];
    const openaiFetch = interceptedFetch(openaiRequests);
    const anthropicFetch = interceptedFetch(anthropicRequests);
    const openaiModule: unknown = await import(["@ai-sdk", "openai"].join("/"));
    const createInstalledOpenAI = z
      .custom<RealOpenAiFactory>((value) => typeof value === "function")
      .parse(reflectedProperty(openaiModule, "createOpenAI"));
    const installedOpenAI = createInstalledOpenAI({
      apiKey: "offline-dummy",
      fetch: openaiFetch,
    });
    expect(typeof installedOpenAI).toBe("function");
    expect(typeof reflectedProperty(installedOpenAI, "responses")).toBe(
      "function",
    );

    const corpus = unwrap(await loadM1aCorpus());
    const selected = [
      required(
        corpus.find((item) => item.case.id === "numbers/tax-map"),
        "Missing numeric transport case.",
      ),
      required(
        corpus.find((item) => item.case.catalogId === "benchmark.text"),
        "Missing text transport case.",
      ),
      required(
        corpus.find((item) => item.case.catalogId === "benchmark.decisions"),
        "Missing decision transport case.",
      ),
      required(
        corpus.find((item) => item.case.catalogId === "benchmark.workflow"),
        "Missing workflow transport case.",
      ),
    ];
    const resolver = unwrap(createM1aCatalogResolver());
    const expectedSchemas: Array<unknown> = [];
    const declaredSchemaCounts: Array<number> = [];
    for (const benchmarkCase of selected) {
      const catalog = unwrap(resolver(benchmarkCase.case.catalogId));
      const manifest = unwrap(
        await createPlanLanguageManifest(catalog, benchmarkCase.case.policy),
      );
      const transport = unwrap(
        await compileStructuredOutputTransport(manifest),
      );
      expectedSchemas.push(transport.jsonSchema);
      declaredSchemaCounts.push(manifest.schemas.length);
      const adapters = createM1bPrimaryAdapters({
        constraint: "json-schema",
        openai: { apiKey: "offline-dummy", fetch: openaiFetch },
        anthropic: { apiKey: "offline-dummy", fetch: anthropicFetch },
      });
      const common = {
        task: benchmarkCase.case.instruction,
        taskInputs: benchmarkCase.case.taskInputs,
        catalog,
        policy: benchmarkCase.case.policy,
        publicExamples: [],
        strategy: strategy("json-schema"),
        structuredOutputTransport: transport,
      };
      const openaiSession = unwrap(
        await generatePlan({ ...common, adapter: adapters.openai }),
      );
      const anthropicSession = unwrap(
        await generatePlan({ ...common, adapter: adapters.anthropic }),
      );
      expect(openaiSession.kind).toBe("adapterFailure");
      expect(anthropicSession.kind).toBe("adapterFailure");
      expect(
        openaiSession.record.attempts[0]?.adapterFailure?.dispatchEvidence,
      ).toBe("dispatched-usage-unknown");
      expect(
        anthropicSession.record.attempts[0]?.adapterFailure?.dispatchEvidence,
      ).toBe("dispatched-usage-unknown");
    }
    expect(openaiRequests).toHaveLength(selected.length);
    expect(anthropicRequests).toHaveLength(selected.length);

    const observedOperations = new Set<string>();
    for (let index = 0; index < selected.length; index += 1) {
      const openaiRequest = required(
        openaiRequests[index],
        "Missing OpenAI request.",
      );
      expect(openaiRequest.url).toMatch(/\/v1\/responses$/u);
      const openaiBody = z
        .looseObject({
          model: z.string(),
          reasoning: z.looseObject({ effort: z.string() }),
          store: z.boolean(),
          service_tier: z.string(),
          text: z.looseObject({
            format: z.looseObject({ type: z.string(), schema: z.unknown() }),
          }),
          tools: z.array(z.unknown()).optional(),
        })
        .parse(openaiRequest.body);
      expect(openaiBody.model).toBe(M1B_OPENAI_MODEL);
      expect(openaiBody.reasoning.effort).toBe("low");
      expect(openaiBody.store).toBe(false);
      expect(openaiBody.service_tier).toBe("default");
      expect(openaiBody.text.format.type).toBe("json_schema");
      expect(openaiBody.tools).toBeUndefined();

      const anthropicRequest = required(
        anthropicRequests[index],
        "Missing Anthropic request.",
      );
      expect(anthropicRequest.url).toMatch(/\/v1\/messages$/u);
      const anthropicBody = z
        .looseObject({
          model: z.string(),
          thinking: z.looseObject({ type: z.string() }),
          output_config: z.looseObject({
            effort: z.string(),
            format: z.unknown().optional(),
          }),
          tools: z.array(
            z.looseObject({ name: z.string(), input_schema: z.unknown() }),
          ),
          tool_choice: z.looseObject({
            type: z.string(),
            disable_parallel_tool_use: z.boolean(),
          }),
        })
        .parse(anthropicRequest.body);
      expect(anthropicBody.model).toBe(M1B_ANTHROPIC_MODEL);
      expect(anthropicBody.thinking.type).toBe("adaptive");
      expect(anthropicBody.output_config.effort).toBe("low");
      expect(anthropicBody.output_config.format).toBeUndefined();
      expect(anthropicBody.tools.map((tool) => tool.name)).toEqual(["json"]);
      expect(anthropicBody.tool_choice).toEqual({
        type: "any",
        disable_parallel_tool_use: true,
      });

      const expectedSchema = required(
        expectedSchemas[index],
        "Missing expected transport schema.",
      );
      expectPortableSchema(openaiBody.text.format.schema);
      expectPortableSchema(anthropicBody.tools[0]?.input_schema);
      expectNoModelAuthorityProperties(openaiBody.text.format.schema);
      expectNoModelAuthorityProperties(anthropicBody.tools[0]?.input_schema);
      const expectedSchemaText = JSON.stringify(expectedSchema);
      expect(expectedSchemaText).toContain("missingOperation");
      expect(expectedSchemaText).toContain("deniedCapability");
      expect(expectedSchemaText).toContain("insufficientBudget");
      expect(expectedSchemaText).not.toContain('"reasons"');
      expect(unwrap(canonicalizeJson(openaiBody.text.format.schema))).toBe(
        unwrap(canonicalizeJson(expectedSchema)),
      );
      expect(
        unwrap(canonicalizeJson(anthropicBody.tools[0]?.input_schema)),
      ).toBe(unwrap(canonicalizeJson(expectedSchema)));
      expect(schemasWithOperation(expectedSchema, "constant")).toHaveLength(
        required(declaredSchemaCounts[index], "Missing declared schema count."),
      );
      for (const operation of [
        "input",
        "constant",
        "invoke",
        "map",
        "filter",
        "fold",
        "select",
        "effect",
        "checkpoint",
        "boundedFix",
      ])
        if (schemasWithOperation(expectedSchema, operation).length > 0)
          observedOperations.add(operation);
    }
    expect([...observedOperations].toSorted()).toEqual(
      [
        "boundedFix",
        "checkpoint",
        "constant",
        "effect",
        "filter",
        "fold",
        "input",
        "invoke",
        "map",
        "select",
      ].toSorted(),
    );
  });

  it("serializes arm-blinded M3b requests through both real provider routes without network", async () => {
    const openaiRequests: Array<CapturedFetchRequest> = [];
    const anthropicRequests: Array<CapturedFetchRequest> = [];
    const task = required(
      M3B_PREREGISTERED_CORPUS.find(
        (candidate) =>
          candidate.split === "development" &&
          candidate.category === "negative-control",
      ),
      "Missing M3b transport task.",
    );
    const fact = required(
      M3B_REFERENCE_GRAPH.facts.find(
        (candidate) => candidate.id === task.expectedFactIds[0],
      ),
      "Missing M3b transport fact.",
    );
    const citationIds = new Set(fact.citationIds);
    const request = m3bOracleRequestSchema.parse({
      instruction: "Answer this public evidence question.",
      answerContract: task.answerContract,
      evidence: {
        facts: [fact],
        citations: M3B_REFERENCE_GRAPH.citations.filter((citation) =>
          citationIds.has(citation.id),
        ),
        edges: [],
        paths: [],
      },
      semanticRepair: null,
    });
    const openai = createOpenAiM3bOracle({
      apiKey: "offline-dummy",
      fetch: interceptedFetch(openaiRequests),
    });
    const anthropic = createAnthropicM3bOracle({
      acknowledgeAdaptiveThinking: true,
      provider: {
        apiKey: "offline-dummy",
        fetch: interceptedFetch(anthropicRequests),
      },
    });
    const context = {
      recordKey: "0".repeat(64),
      attemptIndex: 0,
      invocation: "initial" as const,
      transportRetryIndex: 0,
      attemptType: "initial" as const,
    };

    const openaiAttempt = await openai.generate(request, context);
    const anthropicAttempt = await anthropic.generate(request, context);
    expect(openaiAttempt).toMatchObject({
      kind: "failure",
      code: "provider-unavailable",
      dispatchEvidence: "dispatched-usage-unknown",
      provenance: {
        stage: "transport",
        outputPresent: false,
        usageAvailable: false,
      },
    });
    expect(anthropicAttempt).toMatchObject({
      kind: "failure",
      code: "provider-unavailable",
      dispatchEvidence: "dispatched-usage-unknown",
      provenance: {
        stage: "transport",
        outputPresent: false,
        usageAvailable: false,
      },
    });
    const overloaded = createOpenAiM3bOracle({
      apiKey: "offline-dummy",
      fetch: interceptedFetch([], { status: 429, message: "overloaded" }),
    });
    const timedOut = createAnthropicM3bOracle({
      acknowledgeAdaptiveThinking: true,
      provider: {
        apiKey: "offline-dummy",
        fetch: interceptedFetch([], { status: 504, message: "timed out" }),
      },
    });
    expect(await overloaded.generate(request, context)).toMatchObject({
      kind: "failure",
      code: "provider-overload",
    });
    expect(await timedOut.generate(request, context)).toMatchObject({
      kind: "failure",
      code: "provider-timeout",
    });
    expect(openaiRequests).toHaveLength(1);
    expect(anthropicRequests).toHaveLength(1);
    expect(openai.identity).toEqual(
      M3B4_ORACLE_IDENTITIES.find((identity) => identity.provider === "openai"),
    );
    expect(anthropic.identity).toEqual(
      M3B4_ORACLE_IDENTITIES.find(
        (identity) => identity.provider === "anthropic",
      ),
    );

    const openaiRequest = required(
      openaiRequests[0],
      "Missing OpenAI M3b request.",
    );
    expect(openaiRequest.url).toMatch(/\/v1\/responses$/u);
    const openaiBody = z
      .looseObject({
        model: z.string(),
        temperature: z.number().optional(),
        reasoning: z.looseObject({ effort: z.string() }),
        store: z.boolean(),
        service_tier: z.string(),
        text: z.looseObject({
          format: z.looseObject({ type: z.string(), schema: z.unknown() }),
        }),
        tools: z.array(z.unknown()).optional(),
      })
      .parse(openaiRequest.body);
    expect(openaiBody.model).toBe(M1B_OPENAI_MODEL);
    expect(openaiBody.temperature).toBeUndefined();
    expect(openaiBody.reasoning.effort).toBe("low");
    expect(openaiBody.store).toBe(false);
    expect(openaiBody.service_tier).toBe("default");
    expect(openaiBody.tools).toBeUndefined();
    expectPortableSchema(openaiBody.text.format.schema);
    expect(unwrap(canonicalizeJson(openaiBody.text.format.schema))).toBe(
      unwrap(canonicalizeJson(M3B4_OUTPUT_JSON_SCHEMA)),
    );

    const anthropicRequest = required(
      anthropicRequests[0],
      "Missing Anthropic M3b request.",
    );
    expect(anthropicRequest.url).toMatch(/\/v1\/messages$/u);
    const anthropicBody = z
      .looseObject({
        model: z.string(),
        temperature: z.number().optional(),
        thinking: z.looseObject({ type: z.string() }),
        output_config: z.looseObject({
          effort: z.string(),
          format: z
            .looseObject({ type: z.string(), schema: z.unknown() })
            .optional(),
        }),
        tools: z
          .array(z.looseObject({ name: z.string(), input_schema: z.unknown() }))
          .optional(),
        tool_choice: z.unknown().optional(),
      })
      .parse(anthropicRequest.body);
    expect(anthropicBody.model).toBe(M1B_ANTHROPIC_MODEL);
    expect(anthropicBody.temperature).toBeUndefined();
    expect(anthropicBody.thinking.type).toBe("adaptive");
    expect(anthropicBody.output_config.effort).toBe("low");
    expect(M3B4_ANTHROPIC_TRANSPORT_SELECTION.selected).toBe("jsonTool");
    expect(anthropicBody.output_config.format).toBeUndefined();
    expect(anthropicBody.tools?.map((tool) => tool.name)).toEqual(["json"]);
    expect(anthropicBody.tool_choice).toEqual({
      type: "any",
      disable_parallel_tool_use: true,
    });
    expectPortableSchema(anthropicBody.tools?.[0]?.input_schema);
    expect(
      unwrap(canonicalizeJson(anthropicBody.tools?.[0]?.input_schema)),
    ).toBe(unwrap(canonicalizeJson(M3B4_OUTPUT_JSON_SCHEMA)));

    for (const providerRequest of [openaiRequest, anthropicRequest]) {
      const serialized = JSON.stringify(providerRequest.body);
      const visibleText = stringLeaves(providerRequest.body).join("\n");
      expect(serialized).toContain(request.instruction);
      expect(visibleText).toContain('"role":"owner"');
      expect(visibleText).toContain("complete visible derivation");
      expect(serialized).toContain("insufficient-evidence");
      expect(serialized).toContain("supportingFactIds");
      expect(serialized).toContain("pathIds");
      expect(serialized).not.toMatch(
        /lexical-facts|graph-facts|graph-adjacency|graph-typed|in-memory-reference-graph|matched-text/u,
      );
      expect(serialized).not.toContain(context.recordKey);
      expect(serialized).not.toContain("attemptIndex");
    }

    const repairRequest = m3bOracleRequestSchema.parse({
      ...request,
      semanticRepair: {
        previousOutput: {
          outcome: "answered",
          answerValues: ["wrong-role-value"],
          supportingFactIds: [fact.id],
          citationIds: fact.citationIds,
          pathIds: [],
        },
        obligationIssues: [
          {
            code: "answer-values-not-derived-from-supporting-facts",
            path: ["answerValues"],
          },
        ],
      },
    });
    await openai.generate(repairRequest, {
      ...context,
      attemptIndex: 1,
      invocation: "semantic-repair",
      attemptType: "semantic-repair",
    });
    await anthropic.generate(repairRequest, {
      ...context,
      attemptIndex: 1,
      invocation: "semantic-repair",
      attemptType: "semantic-repair",
    });
    expect(openaiRequests).toHaveLength(2);
    expect(anthropicRequests).toHaveLength(2);
    for (const providerRequest of [openaiRequests[1], anthropicRequests[1]]) {
      const requestBody = required(
        providerRequest,
        "Missing M3b semantic-repair request.",
      ).body;
      const serialized = JSON.stringify(requestBody);
      const visibleText = stringLeaves(requestBody).join("\n");
      expect(visibleText).toContain('"role":"owner"');
      expect(visibleText).toContain("semanticRepair");
      expect(visibleText).toContain("previousOutput");
      expect(visibleText).toContain(
        "answer-values-not-derived-from-supporting-facts",
      );
      expect(serialized).toContain("publicOutputSchema");
      expect(serialized).toContain('"maxItems":128');
      expect(serialized).not.toMatch(
        /lexical-facts|graph-facts|graph-adjacency|graph-typed|implementation/u,
      );
    }

    const wireRepairRequest = m3bOracleRequestSchema.parse({
      ...request,
      wireRepair: {
        previousRawOutput: '{"outcome":"answered"}',
        decodingIssues: [
          {
            code: "invalid_type",
            path: ["pathIds"],
            message: "Expected an array.",
          },
        ],
      },
      semanticRepair: null,
    });
    await openai.generate(wireRepairRequest, {
      ...context,
      attemptIndex: 2,
      invocation: "wire-repair",
      attemptType: "wire-repair",
    });
    await anthropic.generate(wireRepairRequest, {
      ...context,
      attemptIndex: 2,
      invocation: "wire-repair",
      attemptType: "wire-repair",
    });
    expect(openaiRequests).toHaveLength(3);
    expect(anthropicRequests).toHaveLength(3);
    for (const providerRequest of [openaiRequests[2], anthropicRequests[2]]) {
      const requestBody = required(
        providerRequest,
        "Missing M3b wire-repair request.",
      ).body;
      const serialized = JSON.stringify(requestBody);
      const visibleText = stringLeaves(requestBody).join("\n");
      expect(visibleText).toContain("wireRepair");
      expect(visibleText).toContain("previousRawOutput");
      expect(visibleText).toContain("invalid_type");
      expect(serialized).toContain("publicOutputSchema");
      expect(serialized).toContain('"maxItems":128');
      expect(serialized).not.toMatch(
        /lexical-facts|graph-facts|graph-adjacency|graph-typed|implementation/u,
      );
    }
  });

  it("keeps the provider schema equivalent to the wire validator while deferring domain rules", () => {
    const providerValidator = z.fromJSONSchema(M3B4_OUTPUT_JSON_SCHEMA);
    const identifier = fc
      .tuple(
        fc.constantFrom(...Array.from("abcdefghijklmnopqrstuvwxyz0123456789")),
        fc.array(
          fc.constantFrom(
            ...Array.from("abcdefghijklmnopqrstuvwxyz0123456789._-"),
          ),
          { maxLength: 24 },
        ),
      )
      .map(([head, tail]) => `${head}${tail.join("")}`);
    const output = fc.record({
      outcome: fc.constantFrom("answered", "insufficient-evidence"),
      answerValues: fc.array(fc.string({ minLength: 1, maxLength: 32 }), {
        maxLength: 8,
      }),
      supportingFactIds: fc.array(identifier, { maxLength: 8 }),
      citationIds: fc.array(identifier, { maxLength: 8 }),
      pathIds: fc.array(identifier, { maxLength: 8 }),
    });
    fc.assert(
      fc.property(output, (value) => {
        expect(providerValidator.safeParse(value).success).toBe(true);
        expect(m3bOracleOutputSchema.safeParse(value).success).toBe(true);
      }),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(providerValidator.safeParse(value).success).toBe(
          m3bOracleOutputSchema.safeParse(value).success,
        );
      }),
      { numRuns: 1_000 },
    );

    const request = m3bOracleRequestSchema.parse({
      instruction: "Use visible evidence.",
      answerContract: {
        role: "owner",
        cardinality: 1,
        ordering: "scalar",
        anchorSubject: "project",
        derivation: "single-terminal-fact",
        requiredFactPredicates: ["owner"],
        answerSource: "terminal-object",
        minimumSupportingFacts: 1,
        sufficiencyRule:
          "answer-only-when-a-complete-visible-derivation-exists-otherwise-abstain",
      },
      evidence: { facts: [], citations: [], edges: [], paths: [] },
      semanticRepair: null,
    });
    const wireValidButDomainInvalid = m3bOracleOutputSchema.parse({
      outcome: "answered",
      answerValues: [],
      supportingFactIds: ["missing", "missing"],
      citationIds: ["missing", "missing"],
      pathIds: ["path-999"],
    });
    expect(
      validateM3bSemanticOutput(request, wireValidButDomainInvalid).map(
        (issue) => issue.code,
      ),
    ).toEqual(
      expect.arrayContaining([
        "duplicate-reference",
        "unknown-citation-reference",
        "unknown-path-reference",
        "unknown-supporting-fact-reference",
        "answer-cardinality-mismatch",
        "answered-without-complete-visible-derivation",
        "supporting-facts-do-not-form-required-derivation",
        "answer-values-not-derived-from-supporting-facts",
      ]),
    );
  });

  it("compares Anthropic native output format and jsonTool on provenance and temporal shapes offline", async () => {
    for (const category of ["provenance", "temporal"] as const) {
      const task = required(
        M3B_PREREGISTERED_CORPUS.find(
          (candidate) =>
            candidate.split === "development" &&
            candidate.category === category,
        ),
        `Missing M3b ${category} comparison task.`,
      );
      const factIds = new Set(task.expectedFactIds);
      const edgeIds = new Set(task.expectedEdgeIds);
      const facts = M3B_REFERENCE_GRAPH.facts.filter((fact) =>
        factIds.has(fact.id),
      );
      const citationIds = new Set(facts.flatMap((fact) => fact.citationIds));
      const request = m3bOracleRequestSchema.parse({
        instruction: task.instruction,
        answerContract: task.answerContract,
        evidence: {
          facts,
          citations: M3B_REFERENCE_GRAPH.citations.filter((citation) =>
            citationIds.has(citation.id),
          ),
          edges: M3B_REFERENCE_GRAPH.edges.filter((edge) =>
            edgeIds.has(edge.id),
          ),
          paths: [],
        },
        semanticRepair: null,
      });
      const nativeRequests: Array<CapturedFetchRequest> = [];
      const jsonToolRequests: Array<CapturedFetchRequest> = [];
      for (const [transportMode, captured] of [
        ["outputFormat", nativeRequests],
        ["jsonTool", jsonToolRequests],
      ] as const) {
        const oracle = createAnthropicM3bOracle({
          acknowledgeAdaptiveThinking: true,
          transportMode,
          provider: {
            apiKey: "offline-dummy",
            fetch: interceptedFetch(captured),
          },
        });
        await oracle.generate(request, {
          recordKey: "0".repeat(64),
          attemptIndex: 0,
          invocation: "initial",
          transportRetryIndex: 0,
          attemptType: "initial",
        });
      }
      const nativeBody = z
        .looseObject({
          output_config: z.looseObject({
            format: z.looseObject({ schema: z.unknown() }),
          }),
          tools: z.array(z.unknown()).optional(),
        })
        .parse(required(nativeRequests[0], "Missing native request.").body);
      const jsonToolBody = z
        .looseObject({
          output_config: z.looseObject({ format: z.unknown().optional() }),
          tools: z.array(
            z.looseObject({ name: z.string(), input_schema: z.unknown() }),
          ),
        })
        .parse(required(jsonToolRequests[0], "Missing jsonTool request.").body);
      expect(nativeBody.tools).toBeUndefined();
      expect(jsonToolBody.output_config.format).toBeUndefined();
      expect(jsonToolBody.tools.map((tool) => tool.name)).toEqual(["json"]);
      expect(
        unwrap(canonicalizeJson(nativeBody.output_config.format.schema)),
      ).not.toBe(unwrap(canonicalizeJson(jsonToolBody.tools[0]?.input_schema)));
      expect(
        unwrap(canonicalizeJson(jsonToolBody.tools[0]?.input_schema)),
      ).toBe(unwrap(canonicalizeJson(M3B4_OUTPUT_JSON_SCHEMA)));
      expect(JSON.stringify(nativeBody.output_config.format.schema)).toContain(
        "max items: 128",
      );
      for (const captured of [...nativeRequests, ...jsonToolRequests]) {
        const serialized = JSON.stringify(captured.body);
        expect(serialized).not.toMatch(
          /lexical-facts|graph-facts|graph-adjacency|graph-typed/u,
        );
        expect(serialized).toContain(task.instruction);
      }
    }
  });

  it("classifies an AI SDK NoObjectGeneratedError without losing diagnostics", async () => {
    const persistedRawOutputs: Array<string> = [];
    const task = required(
      M3B_PREREGISTERED_CORPUS.find(
        (candidate) =>
          candidate.split === "development" &&
          candidate.category === "negative-control",
      ),
      "Missing M3b transport task.",
    );
    const fact = required(
      M3B_REFERENCE_GRAPH.facts.find(
        (candidate) => candidate.id === task.expectedFactIds[0],
      ),
      "Missing M3b transport fact.",
    );
    const request = m3bOracleRequestSchema.parse({
      instruction: "Answer this public evidence question.",
      answerContract: task.answerContract,
      evidence: {
        facts: [fact],
        citations: M3B_REFERENCE_GRAPH.citations.filter((citation) =>
          fact.citationIds.includes(citation.id),
        ),
        edges: [],
        paths: [],
      },
      semanticRepair: null,
    });
    const malformedOutput = {
      outcome: "answered",
      answerValues: [fact.object],
      supportingFactIds: [fact.id],
      citationIds: fact.citationIds,
    };
    const oracle = createAnthropicM3bOracle({
      acknowledgeAdaptiveThinking: true,
      transportMode: "jsonTool",
      rawOutputWriter: (input) => {
        persistedRawOutputs.push(input.text);
        return Promise.resolve({
          ok: true,
          value: {
            digest: "1".repeat(64),
            storedSizeBytes: new TextEncoder().encode(input.text).byteLength,
            originalSizeBytes: new TextEncoder().encode(input.text).byteLength,
            truncated: false,
          },
        });
      },
      provider: {
        apiKey: "offline-dummy",
        fetch: interceptedAnthropicOutput([], malformedOutput),
      },
    });

    const attempt = await oracle.generate(request, {
      recordKey: "0".repeat(64),
      attemptIndex: 0,
      invocation: "initial",
      transportRetryIndex: 0,
      attemptType: "initial",
    });

    expect(attempt).toMatchObject({
      kind: "failure",
      code: "wire-schema-rejected",
      provenance: {
        stage: "wire-decoding",
        category: "wire-schema-rejected",
        errorClass: "AI_NoObjectGeneratedError",
        outputPresent: true,
        usageAvailable: true,
        rawOutputArtifact: { digest: "1".repeat(64) },
        issues: [{ code: "invalid_type", path: ["pathIds"] }],
      },
    });
    if (attempt.kind !== "failure")
      throw new Error("Expected a wire-schema failure fixture.");
    expect(attempt.provenance.causeClass).not.toBeNull();
    expect(attempt.provenance.sanitizedMessage).toContain(
      "response did not match schema",
    );
    expect(persistedRawOutputs).toEqual([JSON.stringify(malformedOutput)]);
  });

  it("recovers runtime-valid raw output after an SDK structured-output disagreement", async () => {
    const task = required(
      M3B_PREREGISTERED_CORPUS.find(
        (candidate) =>
          candidate.split === "development" &&
          candidate.category === "negative-control",
      ),
      "Missing M3b recovery task.",
    );
    const fact = required(
      M3B_REFERENCE_GRAPH.facts.find(
        (candidate) => candidate.id === task.expectedFactIds[0],
      ),
      "Missing M3b recovery fact.",
    );
    const output = {
      outcome: "answered" as const,
      answerValues: [fact.object],
      supportingFactIds: [fact.id],
      citationIds: fact.citationIds,
      pathIds: [],
    };
    const request = m3bOracleRequestSchema.parse({
      instruction: task.instruction,
      answerContract: task.answerContract,
      evidence: {
        facts: [fact],
        citations: M3B_REFERENCE_GRAPH.citations.filter((citation) =>
          fact.citationIds.includes(citation.id),
        ),
        edges: [],
        paths: [],
      },
      semanticRepair: null,
    });
    const raw = JSON.stringify(output);
    const runtime: AiSdkRuntime = {
      generateText: () => {
        throw new FixtureNoObjectGeneratedError({
          message: "SDK fixture rejected a runtime-valid value.",
          text: raw,
          inputTokens: 50,
          outputTokens: 25,
          responseId: "msg_sdk_runtime_disagreement",
        });
      },
      outputObject: () => ({ kind: "output-object-fixture" }),
      jsonSchema: (schema) => schema,
      isNoObjectGeneratedError: () => true,
    };
    const oracle = createAnthropicM3bOracle({
      acknowledgeAdaptiveThinking: true,
      provider: { apiKey: "offline-dummy" },
      runtime,
      rawOutputWriter: (input) =>
        Promise.resolve({
          ok: true,
          value: {
            digest: "2".repeat(64),
            storedSizeBytes: new TextEncoder().encode(input.text).byteLength,
            originalSizeBytes: new TextEncoder().encode(input.text).byteLength,
            truncated: false,
          },
        }),
    });

    expect(
      await oracle.generate(request, {
        recordKey: "0".repeat(64),
        attemptIndex: 0,
        invocation: "initial",
        transportRetryIndex: 0,
        attemptType: "initial",
      }),
    ).toMatchObject({
      kind: "success",
      output,
      provenance: {
        stage: "wire-decoding",
        category: "sdk-runtime-schema-disagreement",
        errorClass: "AI_NoObjectGeneratedError",
        jsonParseResult: "passed",
        wireSchemaResult: "passed",
        rawOutputArtifact: { digest: "2".repeat(64) },
      },
    });

    const invalidJsonOracle = createAnthropicM3bOracle({
      acknowledgeAdaptiveThinking: true,
      provider: { apiKey: "offline-dummy" },
      runtime: {
        ...runtime,
        generateText: () => {
          throw new FixtureNoObjectGeneratedError({
            message:
              "SDK fixture could not parse JSON with sk-supersecret123456.",
            text: "not-json",
            inputTokens: 50,
            outputTokens: 5,
            responseId: "msg_json_parse_failed",
          });
        },
      },
      rawOutputWriter: () =>
        Promise.resolve({
          ok: true,
          value: {
            digest: "4".repeat(64),
            storedSizeBytes: 8,
            originalSizeBytes: 8,
            truncated: false,
          },
        }),
    });
    const invalidAttempt = await invalidJsonOracle.generate(request, {
      recordKey: "0".repeat(64),
      attemptIndex: 1,
      invocation: "initial",
      transportRetryIndex: 1,
      attemptType: "transport-retry",
    });
    expect(invalidAttempt).toMatchObject({
      kind: "failure",
      code: "json-parse-failed",
      dispatchEvidence: "dispatched-with-usage",
      provenance: {
        stage: "wire-decoding",
        category: "json-parse-failed",
        jsonParseResult: "failed",
        wireSchemaResult: "not-attempted",
        issues: [{ code: "invalid-json", path: [] }],
      },
    });
    expect(invalidAttempt.provenance.sanitizedMessage).toContain("[redacted]");
    expect(invalidAttempt.provenance.sanitizedMessage).not.toContain(
      "supersecret",
    );
  });

  it("serializes the restricted CodeMode schema through both real provider routes without network", async () => {
    const openaiRequests: Array<CapturedFetchRequest> = [];
    const anthropicRequests: Array<CapturedFetchRequest> = [];
    const { benchmarkCase, catalog } = await generationInput();
    const manifest = unwrap(
      await createPlanLanguageManifest(catalog, benchmarkCase.case.policy),
    );
    const obligations = [
      { kind: "rootDependsOnInput" as const, inputKey: "items" },
      {
        kind: "requiresOperation" as const,
        operation: { id: "double", version: "1.0.0" },
      },
    ];
    const transport = unwrap(
      await compileCodeModeStructuredOutputTransport(manifest, obligations),
    );
    const canonicalObligations = semanticObligationSchema
      .array()
      .parse(obligations);
    const openai = createOpenAiCodeModeAdapter({
      constraint: "json-schema",
      provider: {
        apiKey: "offline-dummy",
        fetch: interceptedFetch(openaiRequests),
      },
    });
    const anthropic = createAnthropicCodeModeAdapter({
      constraint: "json-schema",
      acknowledgeAdaptiveThinking: true,
      provider: {
        apiKey: "offline-dummy",
        fetch: interceptedFetch(anthropicRequests),
      },
    });
    const common = {
      task: "Double every input item.",
      catalog,
      policy: benchmarkCase.case.policy,
      taskInputs: benchmarkCase.case.taskInputs,
      semanticObligations: canonicalObligations,
      strategy: {
        constraint: "json-schema" as const,
        repair: "none" as const,
      },
      structuredOutputTransport: transport,
    };
    expect(
      unwrap(await generateCodeMode({ ...common, adapter: openai })).kind,
    ).toBe("adapter-failure");
    expect(
      unwrap(await generateCodeMode({ ...common, adapter: anthropic })).kind,
    ).toBe("adapter-failure");
    const repairRequest: CodeModeRepairRequest = {
      kind: "repair",
      protocol: M2_CODEMODE_PROMPT_PROTOCOL,
      originalTask: common.task,
      taskInputs: common.taskInputs,
      languageManifest: manifest,
      semanticObligations: canonicalObligations,
      previousProgram: "export async function main(items) { return items; }",
      diagnostics: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Offline compiler fixture rejected the entry point.",
        ),
      ],
      structuredOutputTransport: transport,
    };
    expect((await openai.generate(repairRequest)).ok).toBe(false);
    expect((await anthropic.generate(repairRequest)).ok).toBe(false);
    expect(openaiRequests).toHaveLength(2);
    expect(anthropicRequests).toHaveLength(2);

    expect(M2_CODEMODE_PROMPT_PROTOCOL.modelVisibleGrammar).toBe(
      CODEMODE_MODEL_VISIBLE_GRAMMAR_CONTRACT,
    );
    for (const requests of [openaiRequests, anthropicRequests]) {
      for (const [index, request] of requests.entries()) {
        const prompt = required(
          stringLeaves(request.body).find((value) =>
            value.startsWith('{"protocol":'),
          ),
          "Missing serialized CodeMode prompt.",
        );
        const parsedPrompt = unwrap(parseJson(prompt));
        expect(
          unwrap(canonicalizeJson(reflectedProperty(parsedPrompt, "protocol"))),
        ).toBe(unwrap(canonicalizeJson(M2_CODEMODE_PROMPT_PROTOCOL)));
        expect(reflectedProperty(parsedPrompt, "turn")).toBe(
          index === 0 ? "initial" : "repair",
        );
      }
    }

    const openaiBody = z
      .looseObject({
        model: z.string(),
        reasoning: z.looseObject({ effort: z.string() }),
        text: z.looseObject({
          format: z.looseObject({ schema: z.unknown() }),
        }),
        tools: z.array(z.unknown()).optional(),
      })
      .parse(
        required(openaiRequests[0], "Missing OpenAI CodeMode request.").body,
      );
    const anthropicBody = z
      .looseObject({
        model: z.string(),
        thinking: z.looseObject({ type: z.string() }),
        output_config: z.looseObject({ effort: z.string() }),
        tools: z.array(
          z.looseObject({ name: z.string(), input_schema: z.unknown() }),
        ),
      })
      .parse(
        required(anthropicRequests[0], "Missing Anthropic CodeMode request.")
          .body,
      );
    expect(openaiBody.model).toBe(M1B_OPENAI_MODEL);
    expect(openaiBody.reasoning.effort).toBe("low");
    expect(openaiBody.tools).toBeUndefined();
    expect(anthropicBody.model).toBe(M1B_ANTHROPIC_MODEL);
    expect(anthropicBody.thinking.type).toBe("adaptive");
    expect(anthropicBody.output_config.effort).toBe("low");
    expect(anthropicBody.tools.map((tool) => tool.name)).toEqual(["json"]);
    expect(unwrap(canonicalizeJson(openaiBody.text.format.schema))).toBe(
      unwrap(canonicalizeJson(transport.jsonSchema)),
    );
    expect(unwrap(canonicalizeJson(anthropicBody.tools[0]?.input_schema))).toBe(
      unwrap(canonicalizeJson(transport.jsonSchema)),
    );
    expectPortableSchema(openaiBody.text.format.schema);
    expectPortableSchema(anthropicBody.tools[0]?.input_schema);
  });

  it("renders the exact outcome and public-input contract on every turn without hostile fields", async () => {
    const prompts: Array<string> = [];
    const pricing = required(M1B_PRICING_ENTRIES[0], "Missing OpenAI pricing.");
    const runtime: AiSdkRuntime = {
      outputObject: () => ({ kind: "output-object-fixture" }),
      jsonSchema: (...arguments_) => arguments_[0],
      generateText: (...arguments_) => {
        const options = z
          .looseObject({ prompt: z.string() })
          .parse(arguments_[0]);
        prompts.push(options.prompt);
        return Promise.resolve({
          text: '{"kind":"unplannable","witness":{"kind":"missingOperation","operation":{"id":"offline","version":"1"}}}',
          output: {
            kind: "unplannable",
            witness: {
              kind: "missingOperation",
              operation: { id: "offline", version: "1" },
            },
          },
          usage: { inputTokens: 1, outputTokens: 1 },
          finishReason: "stop",
        });
      },
    };
    const adapter = createAiSdkModelAdapter({
      identity: {
        provider: "openai",
        model: M1B_OPENAI_MODEL,
        adapterVersion: AI_SDK_ADAPTER_VERSION,
      },
      inference: {
        temperature: null,
        seed: null,
        reasoningSettings: { mode: "reasoning", effort: "low" },
        maxInputTokens: 64_000,
        maxOutputTokens: 8_192,
        structuredOutputMode: "json-schema",
        structuredOutputTransport: "openai-responses-portable-json-schema",
      },
      pricing,
      loadModel: () => Promise.resolve({ id: "model-fixture" }),
      runtime,
    });
    const { benchmarkCase, catalog } = await generationInput();
    const manifest = unwrap(
      await createPlanLanguageManifest(catalog, benchmarkCase.case.policy),
    );
    const transport = unwrap(await compileStructuredOutputTransport(manifest));
    const hostile = {
      hiddenInputs: "HOSTILE_HIDDEN_INPUT",
      expectedOutputs: "HOSTILE_EXPECTED_OUTPUT",
      effectResults: "HOSTILE_EFFECT_RESULT",
      semanticScores: "HOSTILE_SEMANTIC_SCORE",
    };
    const initial: ModelRequest & typeof hostile = {
      ...hostile,
      kind: "initial",
      originalTask: benchmarkCase.case.instruction,
      taskInputs: benchmarkCase.case.taskInputs,
      languageManifest: manifest,
      semanticObligations: benchmarkCase.case.semanticObligations ?? [],
      publicExamples: [],
      constraint: "json-schema",
      structuredOutputTransport: transport,
    };
    const unconstrained: ModelRequest & typeof hostile = {
      ...initial,
      constraint: "unconstrained-json",
      structuredOutputTransport: null,
    };
    const repair: ModelRequest & typeof hostile = {
      ...hostile,
      kind: "repair",
      originalTask: benchmarkCase.case.instruction,
      taskInputs: benchmarkCase.case.taskInputs,
      languageManifest: manifest,
      semanticObligations: benchmarkCase.case.semanticObligations ?? [],
      previousProposal: { kind: "plan", plan: {} },
      diagnostics: [],
      structuredOutputTransport: transport,
    };
    await adapter.generate(initial);
    await adapter.generate(unconstrained);
    await adapter.generate(repair);

    expect(prompts).toHaveLength(3);
    for (const prompt of prompts) {
      expect(prompt).toContain('{ \\"kind\\": \\"plan\\", \\"plan\\": ... }');
      expect(prompt).toContain(
        '{ \\"kind\\": \\"unplannable\\", \\"witness\\": { \\"kind\\": \\"missingOperation\\" | \\"deniedCapability\\" | \\"insufficientBudget\\", ... } }',
      );
      expect(prompt).toContain("Return raw JSON only.");
      expect(prompt).toContain("Do not use Markdown fences.");
      expect(prompt).toContain("Do not use alternate field names.");
      expect(prompt).toContain(
        "The plan contains operator topology and arguments only.",
      );
      expect(prompt).toContain(
        "Do not return budget, allowedCapabilities, or input maxItems fields",
      );
      expect(prompt).toContain('"taskInputs"');
      expect(prompt).toContain('"semanticObligations"');
      for (const value of Object.values(hostile))
        expect(prompt).not.toContain(value);
    }
  });

  it("serializes the reduced M4d.1 contract through real provider packages without experimental identities", async () => {
    const providerValidator = z.fromJSONSchema(M4D1_OUTPUT_JSON_SCHEMA);
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(providerValidator.safeParse(value).success).toBe(
          m4OracleAnswerSchema.safeParse(value).success,
        );
      }),
      { numRuns: 1_000 },
    );
    const task = required(
      M3B_PREREGISTERED_CORPUS.find(
        (candidate) =>
          candidate.split === "development" &&
          candidate.category === "contradiction",
      ),
      "Missing M4d.1 request task.",
    );
    const facts = M3B_REFERENCE_GRAPH.facts.filter((fact) =>
      task.expectedFactIds.includes(fact.id),
    );
    const citationIds = new Set(facts.flatMap((fact) => fact.citationIds));
    const visibleRequest = m4d1OracleRequestSchema.parse({
      instruction: task.instruction,
      answerContract: task.answerContract,
      evidence: {
        facts,
        citations: M3B_REFERENCE_GRAPH.citations.filter((citation) =>
          citationIds.has(citation.id),
        ),
        edges: [],
        paths: [],
      },
      wireRepair: null,
      semanticRepair: null,
    });
    const hostile = {
      representationIdentity: "HOSTILE_REPRESENTATION_IDENTITY",
      armIdentity: "HOSTILE_ARM_IDENTITY",
      policyIdentity: "HOSTILE_POLICY_IDENTITY",
      typeGraphIdentity: "HOSTILE_TYPEGRAPH_IDENTITY",
      sourceIdentity: "HOSTILE_SOURCE_IDENTITY",
      expectedAnswerIdentity: "HOSTILE_EXPECTED_ANSWER_IDENTITY",
    };
    const requestWithHiddenMetadata: M4d1OracleRequest & typeof hostile = {
      ...visibleRequest,
      ...hostile,
    };
    const openaiRequests: Array<CapturedFetchRequest> = [];
    const anthropicRequests: Array<CapturedFetchRequest> = [];
    const openai = createOpenAiM4d1Oracle({
      apiKey: "offline-dummy",
      fetch: interceptedFetch(openaiRequests),
    });
    const anthropic = createAnthropicM4d1Oracle({
      acknowledgeAdaptiveThinking: true,
      provider: {
        apiKey: "offline-dummy",
        fetch: interceptedFetch(anthropicRequests),
      },
    });
    const context = {
      recordKey: "offline-m4d1-request",
      attemptIndex: 0,
      invocation: "initial" as const,
      transportRetryIndex: 0,
      attemptType: "initial" as const,
    };
    await openai.generate(requestWithHiddenMetadata, context);
    await anthropic.generate(requestWithHiddenMetadata, context);
    expect(openaiRequests).toHaveLength(1);
    expect(anthropicRequests).toHaveLength(1);
    expect(openai.identity).toEqual(
      M4D1_ORACLE_IDENTITIES.find((identity) => identity.provider === "openai"),
    );
    expect(anthropic.identity).toEqual(
      M4D1_ORACLE_IDENTITIES.find(
        (identity) => identity.provider === "anthropic",
      ),
    );

    const openaiBody = z
      .looseObject({
        model: z.string(),
        reasoning: z.looseObject({ effort: z.string() }),
        text: z.looseObject({
          format: z.looseObject({ schema: z.unknown() }),
        }),
        tools: z.array(z.unknown()).optional(),
      })
      .parse(required(openaiRequests[0], "Missing M4d.1 OpenAI request.").body);
    expect(openaiBody.model).toBe(M1B_OPENAI_MODEL);
    expect(openaiBody.reasoning.effort).toBe("low");
    expect(openaiBody.tools).toBeUndefined();
    expect(unwrap(canonicalizeJson(openaiBody.text.format.schema))).toBe(
      unwrap(canonicalizeJson(M4D1_OUTPUT_JSON_SCHEMA)),
    );

    const anthropicBody = z
      .looseObject({
        model: z.string(),
        thinking: z.looseObject({ type: z.string() }),
        output_config: z.looseObject({ effort: z.string() }),
        tools: z.array(
          z.looseObject({ name: z.string(), input_schema: z.unknown() }),
        ),
      })
      .parse(
        required(anthropicRequests[0], "Missing M4d.1 Anthropic request.").body,
      );
    expect(anthropicBody.model).toBe(M1B_ANTHROPIC_MODEL);
    expect(anthropicBody.thinking.type).toBe("adaptive");
    expect(anthropicBody.output_config.effort).toBe("low");
    expect(anthropicBody.tools.map((tool) => tool.name)).toEqual(["json"]);
    expect(unwrap(canonicalizeJson(anthropicBody.tools[0]?.input_schema))).toBe(
      unwrap(canonicalizeJson(M4D1_OUTPUT_JSON_SCHEMA)),
    );

    for (const captured of [...openaiRequests, ...anthropicRequests]) {
      const serialized = JSON.stringify(captured.body);
      const visibleText = stringLeaves(captured.body).join("\n");
      expect(serialized).toContain(task.instruction);
      expect(serialized).toContain("supportingFactIds");
      expect(serialized).toContain("runtimeDerived");
      expect(visibleText).toContain("canonical-paths");
      expect(serialized).not.toMatch(
        /lexical-facts|graph-facts|graph-adjacency|graph-typed|typegraph|in-memory-reference-graph|matched-text/iu,
      );
      expect(serialized).not.toContain(context.recordKey);
      for (const identity of Object.values(hostile))
        expect(serialized).not.toContain(identity);
    }

    const semanticRepair = m4d1OracleRequestSchema.parse({
      ...visibleRequest,
      semanticRepair: {
        previousOutput: {
          outcome: "answered",
          answerValues: ["wrong-public-role"],
          supportingFactIds: [required(facts[0], "Missing visible fact.").id],
        },
        obligationIssues: [
          {
            code: "answer-support-does-not-form-visible-derivation",
            path: ["supportingFactIds"],
          },
        ],
      },
    });
    await anthropic.generate(semanticRepair, {
      ...context,
      attemptIndex: 1,
      invocation: "semantic-repair",
      attemptType: "semantic-repair",
    });
    const repairBody = JSON.stringify(
      required(anthropicRequests[1], "Missing semantic repair request.").body,
    );
    expect(repairBody).toContain("previousOutput");
    expect(repairBody).toContain(
      "answer-support-does-not-form-visible-derivation",
    );
    expect(repairBody).not.toMatch(/expectedAnswer|policyIdentity|typeGraph/iu);

    const staged = createAnthropicM4d1Oracle({
      acknowledgeAdaptiveThinking: true,
      provider: { apiKey: "offline-dummy" },
      runtime: runtimeReturning({
        text: '{"outcome":"answered"}',
        output: { outcome: "answered" },
        usage: { inputTokens: 10, outputTokens: 5 },
        response: { id: "offline-m4d1-wire-rejection" },
        finishReason: "stop",
      }),
    });
    expect(await staged.generate(visibleRequest, context)).toMatchObject({
      kind: "failure",
      code: "wire-schema-rejected",
      dispatchEvidence: "dispatched-with-usage",
      provenance: {
        stage: "wire-decoding",
        category: "wire-schema-rejected",
        jsonParseResult: "passed",
        wireSchemaResult: "failed",
        usageAvailable: true,
      },
    });

    const probe = createM4d1ProtocolProbeDesign();
    expect(probe).toMatchObject({
      ok: true,
      value: {
        initialCalls: 8,
        maximumWireRepairs: 2,
        maximumSemanticRepairs: 2,
        maximumTransportRetries: 4,
        maximumProviderAttempts: 16,
        maximumCostUsdMicros: 640000,
        liveExecutionAuthorized: false,
        materializationAuthorized: false,
      },
    });
  });

  it("binds M5b to the real reduced provider routes without widening the visible request", async () => {
    const task = required(
      M3B_PREREGISTERED_CORPUS.find(
        (candidate) =>
          candidate.split === "development" &&
          candidate.category === "negative-control",
      ),
      "Missing M5b transport fixture.",
    );
    const fact = required(
      M3B_REFERENCE_GRAPH.facts.find(
        (candidate) => candidate.id === task.expectedFactIds[0],
      ),
      "Missing M5b visible fact.",
    );
    const request = m4d1OracleRequestSchema.parse({
      instruction: task.instruction,
      answerContract: task.answerContract,
      evidence: {
        facts: [fact],
        citations: M3B_REFERENCE_GRAPH.citations.filter((citation) =>
          fact.citationIds.includes(citation.id),
        ),
        edges: [],
        paths: [],
      },
      wireRepair: null,
      semanticRepair: null,
    });
    const openaiRequests: Array<CapturedFetchRequest> = [];
    const anthropicRequests: Array<CapturedFetchRequest> = [];
    const openai = createOpenAiM5b0Oracle({
      apiKey: "offline-dummy",
      fetch: interceptedFetch(openaiRequests),
    });
    const anthropic = createAnthropicM5b0Oracle({
      acknowledgeAdaptiveThinking: true,
      provider: {
        apiKey: "offline-dummy",
        fetch: interceptedFetch(anthropicRequests),
      },
    });
    const context = {
      recordKey: "offline-m5b-request",
      attemptIndex: 0,
      invocation: "initial" as const,
      transportRetryIndex: 0,
      attemptType: "initial" as const,
    };
    await openai.generate(request, context);
    await anthropic.generate(request, context);
    expect(openai.identity.adapterVersion).toBe(M5B0_PROVIDER_ADAPTER_VERSION);
    expect(anthropic.identity.adapterVersion).toBe(
      M5B0_PROVIDER_ADAPTER_VERSION,
    );
    expect([openai.identity, anthropic.identity]).toEqual(
      M5B0_ORACLE_IDENTITIES,
    );
    expect(openai.identity.settings).toMatchObject({
      reasoning: "low",
      sdkRetries: 0,
      structuredOutput: "json-schema",
    });
    expect(anthropic.identity.settings).toMatchObject({
      reasoning: "adaptive-low",
      sdkRetries: 0,
      structuredOutput: "json-tool",
    });
    for (const captured of [...openaiRequests, ...anthropicRequests]) {
      const serialized = JSON.stringify(captured.body);
      expect(serialized).toContain(task.instruction);
      expect(serialized).toContain("supportingFactIds");
      expect(serialized).not.toMatch(
        /expectedAnswer|typegraph|graph-typed|graph-adjacency|policyIdentity|armIdentity/iu,
      );
    }
  });
});
