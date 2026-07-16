import {
  canonicalizeJson,
  createPlanLanguageManifest,
  diagnostic,
  parseJson,
  type Result,
  semanticObligationSchema,
} from "@nicia-ai/lachesis";
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
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AI_SDK_ADAPTER_VERSION,
  type AiSdkRuntime,
  createAiSdkModelAdapter,
  createAnthropicCodeModeAdapter,
  createBedrockAnthropicPlanAdapter,
  createM1bPricingSnapshot,
  createM1bPrimaryAdapters,
  createOpenAiCodeModeAdapter,
  M1B_ANTHROPIC_MODEL,
  M1B_BEDROCK_ANTHROPIC_MODEL,
  M1B_OPENAI_MODEL,
  M1B_PILOT_CAPS,
  M1B_PRICING_ENTRIES,
  M1B_REPETITIONS,
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
          error: { type: "intercepted", message: "offline interception" },
        }),
        { status: 500, headers: { "content-type": "application/json" } },
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
});
