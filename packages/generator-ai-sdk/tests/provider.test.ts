import { type Result } from "@nicia-ai/lachesis";
import {
  createM1aCatalogResolver,
  generatePlan,
  type GenerationStrategy,
  loadM1aCorpus,
  M1A_GENERATION_STRATEGIES,
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
    expect(anthropic.identity.model).toBe(M1B_ANTHROPIC_MODEL);
    expect(anthropic.pricingEntryId).toContain("/direct/");
    expect(anthropic.inference.reasoningSettings).toEqual({
      mode: "adaptive",
      effort: "low",
    });
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
});
