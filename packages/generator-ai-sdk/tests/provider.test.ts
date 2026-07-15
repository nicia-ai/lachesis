import {
  canonicalizeJson,
  createPlanLanguageManifest,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import {
  createM1aCatalogResolver,
  generatePlan,
  type GenerationStrategy,
  loadM1aCorpus,
  M1A_GENERATION_STRATEGIES,
  type ModelRequest,
  RECORDED_DOUBLE_PLAN,
} from "@nicia-ai/lachesis-generator";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AI_SDK_ADAPTER_VERSION,
  type AiSdkRuntime,
  createAiSdkModelAdapter,
  createBedrockAnthropicPlanAdapter,
  createM1bPricingSnapshot,
  createM1bPrimaryAdapters,
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

function expectGenerationOutcomeSchema(value: unknown): void {
  const canonical = unwrap(canonicalizeJson(value));
  expect(canonical).toContain('"kind"');
  expect(canonical).toContain('"plan"');
  expect(canonical).toContain('"unplannable"');
  expect(canonical).toContain('"reasons"');
  expect(canonical).toContain('"const":"plan"');
  expect(canonical).toContain('"const":"unplannable"');
  expect(canonical).toContain('"required":["kind","plan"]');
  expect(canonical).toContain('"required":["kind","reasons"]');
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
      "openai-responses-json-schema",
    );
    expect(anthropic.identity.model).toBe(M1B_ANTHROPIC_MODEL);
    expect(anthropic.pricingEntryId).toContain("/direct/");
    expect(anthropic.inference.reasoningSettings).toEqual({
      mode: "adaptive",
      effort: "low",
    });
    expect(anthropic.inference.structuredOutputTransport).toBe(
      "anthropic-json-tool",
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

  it("uses real provider packages and serializes both routes through intercepted fetch", async () => {
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

    const adapters = createM1bPrimaryAdapters({
      constraint: "json-schema",
      openai: { apiKey: "offline-dummy", fetch: openaiFetch },
      anthropic: { apiKey: "offline-dummy", fetch: anthropicFetch },
    });
    const { benchmarkCase, catalog } = await generationInput();
    const common = {
      task: benchmarkCase.case.instruction,
      taskInputs: benchmarkCase.case.taskInputs,
      catalog,
      policy: benchmarkCase.case.policy,
      publicExamples: [],
      strategy: strategy("json-schema"),
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
    expect(openaiRequests).toHaveLength(1);
    expect(anthropicRequests).toHaveLength(1);

    const openaiRequest = required(
      openaiRequests[0],
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
    expectGenerationOutcomeSchema(openaiBody.text.format.schema);

    const anthropicRequest = required(
      anthropicRequests[0],
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
    expectGenerationOutcomeSchema(anthropicBody.tools[0]?.input_schema);
  });

  it("renders the exact outcome and public-input contract on every turn without hostile fields", async () => {
    const prompts: Array<string> = [];
    const pricing = required(M1B_PRICING_ENTRIES[0], "Missing OpenAI pricing.");
    const runtime: AiSdkRuntime = {
      outputObject: () => ({ kind: "output-object-fixture" }),
      generateText: (...arguments_) => {
        const options = z
          .looseObject({ prompt: z.string() })
          .parse(arguments_[0]);
        prompts.push(options.prompt);
        return Promise.resolve({
          text: '{"kind":"unplannable","reasons":["offline"]}',
          output: { kind: "unplannable", reasons: ["offline"] },
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
        structuredOutputTransport: "openai-responses-json-schema",
      },
      pricing,
      loadModel: () => Promise.resolve({ id: "model-fixture" }),
      runtime,
    });
    const { benchmarkCase, catalog } = await generationInput();
    const manifest = unwrap(
      await createPlanLanguageManifest(catalog, benchmarkCase.case.policy),
    );
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
      publicExamples: [],
      constraint: "json-schema",
    };
    const unconstrained: ModelRequest & typeof hostile = {
      ...initial,
      constraint: "unconstrained-json",
    };
    const repair: ModelRequest & typeof hostile = {
      ...hostile,
      kind: "repair",
      originalTask: benchmarkCase.case.instruction,
      taskInputs: benchmarkCase.case.taskInputs,
      languageManifest: manifest,
      previousProposal: { kind: "plan", plan: {} },
      diagnostics: [],
    };
    await adapter.generate(initial);
    await adapter.generate(unconstrained);
    await adapter.generate(repair);

    expect(prompts).toHaveLength(3);
    for (const prompt of prompts) {
      expect(prompt).toContain('{ \\"kind\\": \\"plan\\", \\"plan\\": ... }');
      expect(prompt).toContain(
        '{ \\"kind\\": \\"unplannable\\", \\"reasons\\": [...] }',
      );
      expect(prompt).toContain("Return raw JSON only.");
      expect(prompt).toContain("Do not use Markdown fences.");
      expect(prompt).toContain("Do not use alternate field names.");
      expect(prompt).toContain('"taskInputs"');
      for (const value of Object.values(hostile))
        expect(prompt).not.toContain(value);
    }
  });
});
