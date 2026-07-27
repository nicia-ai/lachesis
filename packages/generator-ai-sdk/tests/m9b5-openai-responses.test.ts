import { canonicalizeJson, diagnostic, type Result } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import {
  executeM9b4EffectAttempt,
  inspectM9b4EffectLedger,
  type M9b4AtomicPersistence,
  type M9b4Attempt,
  type M9b4Campaign,
  prepareM9b4Attempt,
  prepareM9b4Campaign,
} from "../../generator/src/m9b4-effect-ledger.js";
import {
  createM9b5OpenAiResponsesSession,
  M9B5_OPENAI_RESPONSES_PROTOCOL,
  M9B5_OUTPUT_JSON_SCHEMAS,
  type M9b5ConformanceVector,
  type M9b5IdentityProfile,
  type M9b5RequestClass,
  prepareM9b5ConformanceVector,
} from "../src/m9b5-openai-responses.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function digest(character: string): string {
  return character.repeat(64);
}

const IDENTITIES: M9b5IdentityProfile = Object.freeze({
  provider: Object.freeze({
    id: "openai-responses-offline-intercept",
    version: "2026-07-26",
    artifactDigest: digest("1"),
  }),
  model: Object.freeze({
    id: "gpt-5.6-terra",
    version: "gpt-5.6-terra",
    artifactDigest: digest("2"),
    providerId: "openai-responses-offline-intercept",
  }),
  tokenizer: Object.freeze({
    id: "openai-responses-tokenizer-unavailable",
    version: "no-exact-offline-mechanism",
    artifactDigest: digest("3"),
    providerId: "openai-responses-offline-intercept",
  }),
  pricingSnapshot: Object.freeze({
    id: "openai-pricing-offline-fixture",
    version: "2026-07-26",
    artifactDigest: digest("4"),
    providerId: "openai-responses-offline-intercept",
    inputUsdMicrosPerMillionTokens: 1_000_000,
    cachedInputUsdMicrosPerMillionTokens: 250_000,
    cacheWriteInputUsdMicrosPerMillionTokens: 1_250_000,
    outputUsdMicrosPerMillionTokens: 2_000_000,
    reasoningUsdMicrosPerMillionTokens: 0,
    longContextThresholdTokens: 272_000,
    longContextInputMultiplierMicros: 2_000_000,
    longContextOutputMultiplierMicros: 1_500_000,
  }),
  serializer: Object.freeze({
    id: "ai-sdk-openai-responses-canonical-intercept",
    version: "4.0.15/1",
    artifactDigest: digest("5"),
    providerId: "openai-responses-offline-intercept",
  }),
});

const CLASSES: ReadonlyArray<M9b5RequestClass> = Object.freeze([
  "root-program-authoring",
  "static-one-shot-query-planning",
  "discovered-program-leaf-reasoning",
  "static-answer-generation",
]);

function classCoordinate(requestClass: M9b5RequestClass): Readonly<{
  arm: "discovered-program" | "static-one-shot";
  phase: "authoring" | "execution";
}> {
  switch (requestClass) {
    case "root-program-authoring":
      return { arm: "discovered-program", phase: "authoring" };
    case "static-one-shot-query-planning":
      return { arm: "static-one-shot", phase: "authoring" };
    case "discovered-program-leaf-reasoning":
      return { arm: "discovered-program", phase: "execution" };
    case "static-answer-generation":
      return { arm: "static-one-shot", phase: "execution" };
  }
}

async function vector(
  requestClass: M9b5RequestClass = "static-answer-generation",
): Promise<M9b5ConformanceVector> {
  const coordinate = classCoordinate(requestClass);
  return unwrap(
    await prepareM9b5ConformanceVector({
      requestClass,
      comparisonDigest: digest("6"),
      ...coordinate,
      callIndex: 0,
      instructions: "Return only the requested public structured result.",
      input: "Public task and already-visible evidence only.",
      maximumOutputTokens: 64,
      identities: IDENTITIES,
    }),
  );
}

function outputFor(requestClass: M9b5RequestClass): unknown {
  switch (requestClass) {
    case "root-program-authoring":
      return { source: "export default async function main() { return {}; }" };
    case "static-one-shot-query-planning":
      return { query: "public deterministic query" };
    case "discovered-program-leaf-reasoning":
    case "static-answer-generation":
      return { answer: "offline answer", citationIds: ["chunk:1"] };
  }
}

type RawResponseOverrides = Readonly<{
  status?: "completed" | "failed" | "incomplete" | "cancelled";
  model?: string;
  output?: ReadonlyArray<unknown>;
  usage?: unknown;
  error?: Readonly<{ code: string; message: string }> | null;
  incompleteDetails?: Readonly<{ reason: string }> | null;
}>;

function rawResponse(
  requestClass: M9b5RequestClass,
  overrides: RawResponseOverrides = {},
): unknown {
  const status = overrides.status ?? "completed";
  const defaultOutput =
    status === "completed"
      ? [
          {
            type: "message",
            id: "msg_offline_001",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: unwrap(canonicalizeJson(outputFor(requestClass))),
                annotations: [],
              },
            ],
          },
        ]
      : [];
  return {
    id: "resp_offline_001",
    object: "response",
    created_at: 1_785_000_000,
    status,
    model: overrides.model ?? IDENTITIES.model.version,
    output: overrides.output ?? defaultOutput,
    usage:
      overrides.usage === undefined
        ? {
            input_tokens: 10,
            input_tokens_details: {
              cached_tokens: 0,
              cache_write_tokens: 0,
            },
            output_tokens: 4,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 14,
          }
        : overrides.usage,
    error: overrides.error ?? null,
    incomplete_details: overrides.incompleteDetails ?? null,
  };
}

type FetchObservation = {
  count: number;
  body: string | undefined;
  signal: AbortSignal | undefined;
  authorization: string | null;
};

function responseFetch(
  responseValue: unknown,
  observation: FetchObservation,
): typeof globalThis.fetch {
  return (_resource, options) => {
    observation.count += 1;
    observation.body =
      typeof options?.body === "string" ? options.body : undefined;
    observation.signal = options?.signal ?? undefined;
    observation.authorization = new Headers(options?.headers).get(
      "authorization",
    );
    return Promise.resolve(
      new Response(JSON.stringify(responseValue), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

function observation(): FetchObservation {
  return { count: 0, body: undefined, signal: undefined, authorization: null };
}

function syntheticKey(): string {
  return ["offline", "synthetic", "never", "durable"].join("-");
}

async function sessionFor(
  vectorValue: M9b5ConformanceVector,
  fetch: typeof globalThis.fetch,
  expectedAttemptId = digest("7"),
  timeoutMs = 1_000,
  keyProvider: () => string = syntheticKey,
) {
  let now = 100;
  return unwrap(
    await createM9b5OpenAiResponsesSession(vectorValue, {
      interceptedFetch: fetch,
      syntheticApiKey: keyProvider,
      sdkRetryLimit: 0,
      expectedAttemptId,
      timeoutMs,
      nowMs: () => {
        now += 5;
        return now;
      },
    }),
  );
}

function invokeInput(
  vectorValue: M9b5ConformanceVector,
  attemptId = digest("7"),
): Readonly<{
  attemptId: string;
  serializedRequest: string;
  requestDigest: string;
}> {
  return {
    attemptId,
    serializedRequest: vectorValue.serializedRequest,
    requestDigest: vectorValue.requestDigest,
  };
}

describe("M9b.5 offline OpenAI Responses adapter conformance", () => {
  it("freezes all four request classes without model-visible study metadata", async () => {
    for (const requestClass of CLASSES) {
      const prepared = await vector(requestClass);
      expect(prepared.protocol).toBe(M9B5_OPENAI_RESPONSES_PROTOCOL.id);
      expect(prepared.responseSchema).toEqual(
        M9B5_OUTPUT_JSON_SCHEMAS[requestClass],
      );
      expect(prepared.providerRequestBytes).toBe(
        unwrap(canonicalizeJson(prepared.providerRequest)),
      );
      expect(prepared.modelVisible).toEqual({
        instructions: "Return only the requested public structured result.",
        input: "Public task and already-visible evidence only.",
      });
      expect(prepared.modelVisible).not.toHaveProperty("arm");
      expect(prepared.modelVisible).not.toHaveProperty("comparisonDigest");
      expect(prepared.modelVisible).not.toHaveProperty("gold");
    }
  });

  it("uses the installed Responses SDK once and maps complete raw success", async () => {
    const prepared = await vector();
    const seen = observation();
    const session = await sessionFor(
      prepared,
      responseFetch(rawResponse(prepared.requestClass), seen),
    );
    const result = await session.invoke(
      invokeInput(prepared),
      new AbortController().signal,
    );

    expect(seen.count).toBe(1);
    expect(seen.body).toBe(prepared.providerRequestBytes);
    expect(seen.authorization).toBe(`Bearer ${syntheticKey()}`);
    expect(result).toEqual({
      kind: "success",
      output: {
        protocol: "lachesis-m9b5-openai-responses-completed-output/3",
        responseId: "resp_offline_001",
        returnedModel: IDENTITIES.model.version,
        requestClass: prepared.requestClass,
        structuredOutput: outputFor(prepared.requestClass),
      },
      usage: {
        inputTokens: 10,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 4,
        reasoningTokens: 0,
        wallClockMs: 5,
        costUsdMicros: 18,
      },
    });
  });

  it("accepts an official-shaped response projection and prices every input billing class", async () => {
    const prepared = await vector();
    const seen = observation();
    const response = {
      id: "resp_official_shaped_001",
      object: "response",
      created_at: 1_785_000_000,
      completed_at: 1_785_000_001,
      status: "completed",
      model: IDENTITIES.model.version,
      service_tier: "default",
      reasoning: { effort: "none", summary: null },
      output: [
        {
          type: "message",
          id: "msg_official_shaped_001",
          role: "assistant",
          status: "completed",
          phase: "final_answer",
          content: [
            {
              type: "output_text",
              text: unwrap(canonicalizeJson(outputFor(prepared.requestClass))),
              annotations: [
                {
                  type: "file_citation",
                  index: 0,
                  file_id: "file_offline_001",
                  filename: "offline.txt",
                },
              ],
              logprobs: [],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 10,
        input_tokens_details: {
          cached_tokens: 3,
          cache_write_tokens: 2,
          orchestration_input_cached_tokens: 0,
        },
        output_tokens: 4,
        output_tokens_details: {
          reasoning_tokens: 0,
          accepted_prediction_tokens: 0,
        },
        total_tokens: 14,
      },
      error: null,
      incomplete_details: null,
      parallel_tool_calls: true,
      store: false,
      truncation: "disabled",
      metadata: {},
    };
    const session = await sessionFor(prepared, responseFetch(response, seen));

    await expect(
      session.invoke(invokeInput(prepared), new AbortController().signal),
    ).resolves.toMatchObject({
      kind: "success",
      usage: {
        inputTokens: 10,
        cachedInputTokens: 3,
        cacheWriteInputTokens: 2,
        outputTokens: 4,
        costUsdMicros: 17,
      },
    });
    expect(seen.count).toBe(1);
  });

  it("rejects cross-bound vectors, re-signed request drift, and retry drift", async () => {
    const prepared = await vector();
    const altered = { ...prepared, providerRequestDigest: digest("8") };
    expect(
      await createM9b5OpenAiResponsesSession(altered, {
        interceptedFetch: responseFetch(
          rawResponse(prepared.requestClass),
          observation(),
        ),
        syntheticApiKey: syntheticKey,
        sdkRetryLimit: 0,
        expectedAttemptId: digest("7"),
        timeoutMs: 1_000,
        nowMs: () => 0,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await createM9b5OpenAiResponsesSession(prepared, {
        interceptedFetch: responseFetch(
          rawResponse(prepared.requestClass),
          observation(),
        ),
        syntheticApiKey: syntheticKey,
        sdkRetryLimit: 2,
        expectedAttemptId: digest("7"),
        timeoutMs: 1_000,
        nowMs: () => 0,
      }),
    ).toMatchObject({ ok: false });
    const wrongCoordinate = await prepareM9b5ConformanceVector({
      requestClass: "root-program-authoring",
      comparisonDigest: digest("6"),
      arm: "static-one-shot",
      phase: "authoring",
      callIndex: 0,
      instructions: "public",
      input: "public",
      maximumOutputTokens: 1,
      identities: IDENTITIES,
    });
    expect(wrongCoordinate).toMatchObject({ ok: false });
  });

  it.each([
    ["returned model mismatch", { model: "different-model" }],
    ["missing usage", { usage: null }],
    [
      "missing cache-write usage",
      {
        usage: {
          input_tokens: 10,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 4,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 14,
        },
      },
    ],
    [
      "overlapping input billing classes",
      {
        usage: {
          input_tokens: 10,
          input_tokens_details: {
            cached_tokens: 6,
            cache_write_tokens: 5,
          },
          output_tokens: 4,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 14,
        },
      },
    ],
    [
      "malformed usage",
      {
        usage: {
          input_tokens: 10,
          input_tokens_details: {
            cached_tokens: 0,
            cache_write_tokens: 0,
          },
          output_tokens: 4,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 99,
        },
      },
    ],
    [
      "reasoning usage",
      {
        usage: {
          input_tokens: 10,
          input_tokens_details: {
            cached_tokens: 0,
            cache_write_tokens: 0,
          },
          output_tokens: 4,
          output_tokens_details: { reasoning_tokens: 1 },
          total_tokens: 14,
        },
      },
    ],
    ["missing output", { output: [] }],
    [
      "duplicate output",
      {
        output: [
          {
            type: "message",
            id: "one",
            role: "assistant",
            status: "completed",
            content: [],
          },
          {
            type: "message",
            id: "two",
            role: "assistant",
            status: "completed",
            content: [],
          },
        ],
      },
    ],
    [
      "unexpected tool call",
      {
        output: [
          {
            type: "function_call",
            id: "call",
            call_id: "call",
            name: "forbidden",
            arguments: "{}",
          },
        ],
      },
    ],
  ])("fails closed for %s with exactly one fetch", async (_name, overrides) => {
    const prepared = await vector();
    const seen = observation();
    const session = await sessionFor(
      prepared,
      responseFetch(rawResponse(prepared.requestClass, overrides), seen),
    );
    await expect(
      session.invoke(invokeInput(prepared), new AbortController().signal),
    ).rejects.toThrow();
    expect(seen.count).toBe(1);
  });

  it("rejects malformed and hostile-key structured output", async () => {
    const prepared = await vector();
    for (const text of [
      "not-json",
      '{"answer":"offline","citationIds":[],"__proto__":{"polluted":true}}',
      '{"answer":"offline","citationIds":[],"extra":true}',
    ]) {
      const seen = observation();
      const response = rawResponse(prepared.requestClass, {
        output: [
          {
            type: "message",
            id: "msg",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text, annotations: [] }],
          },
        ],
      });
      const session = await sessionFor(prepared, responseFetch(response, seen));
      await expect(
        session.invoke(invokeInput(prepared), new AbortController().signal),
      ).rejects.toThrow();
      expect(seen.count).toBe(1);
    }
  });

  it("maps determinate incomplete responses only when complete usage exists", async () => {
    const prepared = await vector();
    const seen = observation();
    const session = await sessionFor(
      prepared,
      responseFetch(
        rawResponse(prepared.requestClass, {
          status: "incomplete",
          incompleteDetails: { reason: "max_output_tokens" },
        }),
        seen,
      ),
    );
    await expect(
      session.invoke(invokeInput(prepared), new AbortController().signal),
    ).resolves.toMatchObject({
      kind: "failure",
      failure: { kind: "provider-unavailable", code: "max_output_tokens" },
    });
    expect(seen.count).toBe(1);

    const missingSeen = observation();
    const missing = await sessionFor(
      prepared,
      responseFetch(
        rawResponse(prepared.requestClass, {
          status: "incomplete",
          usage: null,
          incompleteDetails: { reason: "unknown" },
        }),
        missingSeen,
      ),
    );
    await expect(
      missing.invoke(invokeInput(prepared), new AbortController().signal),
    ).rejects.toThrow();
    expect(missingSeen.count).toBe(1);
  });

  it("cancels before fetch and during the sole fetch without retry", async () => {
    const prepared = await vector();
    const beforeSeen = observation();
    const before = await sessionFor(
      prepared,
      responseFetch(rawResponse(prepared.requestClass), beforeSeen),
    );
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(
      before.invoke(invokeInput(prepared), alreadyAborted.signal),
    ).rejects.toThrow();
    expect(beforeSeen.count).toBe(0);

    const duringSeen = observation();
    const duringController = new AbortController();
    const during = await sessionFor(prepared, (_resource, options) => {
      duringSeen.count += 1;
      duringSeen.signal = options?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        if (options?.signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        options?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const pending = during.invoke(
      invokeInput(prepared),
      duringController.signal,
    );
    duringController.abort();
    await expect(pending).rejects.toThrow();
    expect(duringSeen.count).toBe(1);
    expect(duringSeen.signal?.aborted).toBe(true);
  });

  it("times out the sole fetch and does not persist synthetic credentials", async () => {
    const prepared = await vector();
    const seen = observation();
    const session = await sessionFor(
      prepared,
      (_resource, options) => {
        seen.count += 1;
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new DOMException("timeout", "AbortError"));
          });
        });
      },
      digest("7"),
      1,
    );
    let message = "";
    try {
      await session.invoke(invokeInput(prepared), new AbortController().signal);
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : "unknown";
    }
    expect(seen.count).toBe(1);
    expect(message).not.toContain(syntheticKey());
    expect(prepared.serializedRequest).not.toContain(syntheticKey());
  });
});

type MemoryLedger = Readonly<{
  persistence: M9b4AtomicPersistence;
  writes: () => number;
  failBefore: (write: number) => void;
  clearFailure: () => void;
}>;

function memoryLedger(): MemoryLedger {
  let content: string | undefined;
  let revision = 0;
  let writes = 0;
  let failingWrite: number | undefined;
  return {
    persistence: {
      read: () =>
        Promise.resolve({
          ok: true,
          value:
            content === undefined
              ? undefined
              : { revision: String(revision), content },
        }),
      writeAtomic: ({ expectedRevision, content: next }) => {
        writes += 1;
        if (failingWrite === writes)
          return Promise.resolve({
            ok: false,
            error: diagnostic(
              "BUDGET_EXCEEDED",
              "injected persistence failure",
            ),
          });
        const expected = content === undefined ? null : String(revision);
        if (expectedRevision !== expected)
          return Promise.resolve({
            ok: false,
            error: diagnostic("REPLAY_REQUEST_MISMATCH", "revision conflict"),
          });
        content = next;
        revision += 1;
        return Promise.resolve({
          ok: true,
          value: { revision: String(revision) },
        });
      },
    },
    writes: () => writes,
    failBefore: (write) => {
      failingWrite = write;
    },
    clearFailure: () => {
      failingWrite = undefined;
    },
  };
}

async function campaign(maximumCostUsdMicros = 10_000): Promise<M9b4Campaign> {
  const ceiling = {
    maximumInputTokens: 1_000,
    maximumOutputTokens: 1_000,
    maximumReasoningTokens: 0,
    maximumWallClockMs: 10_000,
    maximumCostUsdMicros,
  };
  return unwrap(
    await prepareM9b4Campaign({
      campaignId: "m9b5-offline-composition",
      budgetEnvelope: {
        maximumAttempts: 4,
        maximumConcurrentAttempts: 1,
        ...ceiling,
        providers: [{ provider: IDENTITIES.provider, ...ceiling }],
        phases: [
          { phase: "authoring", ...ceiling },
          { phase: "execution", ...ceiling },
          { phase: "evaluation", ...ceiling },
        ],
        arms: [
          { arm: "discovered-program", ...ceiling },
          { arm: "static-one-shot", ...ceiling },
        ],
      },
    }),
  );
}

async function effectAttempt(
  campaignValue: M9b4Campaign,
  vectorValue: M9b5ConformanceVector,
): Promise<M9b4Attempt> {
  return unwrap(
    await prepareM9b4Attempt(campaignValue, {
      comparisonDigest: vectorValue.comparisonDigest,
      arm: vectorValue.arm,
      phase: vectorValue.phase,
      callIndex: vectorValue.callIndex,
      serializedRequest: vectorValue.serializedRequest,
      requestDigest: vectorValue.requestDigest,
      reservedInputTokenCeiling: 10,
      provider: IDENTITIES.provider,
      model: IDENTITIES.model,
      tokenizer: IDENTITIES.tokenizer,
      pricingSnapshot: IDENTITIES.pricingSnapshot,
      reservation: {
        maximumInputTokens: 10,
        maximumOutputTokens: 64,
        maximumReasoningTokens: 0,
        maximumWallClockMs: 1_000,
        maximumCostUsdMicros: 141,
      },
    }),
  );
}

describe("M9b.5 private M9b.4 structural composition", () => {
  it("reservation rejection has zero session, credential, or transport effects", async () => {
    const campaignValue = await campaign(100);
    const prepared = await vector();
    const attempt = await effectAttempt(campaignValue, prepared);
    const memory = memoryLedger();
    const seen = observation();
    let credentialReads = 0;
    let sessions = 0;
    const session = await sessionFor(
      prepared,
      responseFetch(rawResponse(prepared.requestClass), seen),
      attempt.attemptId,
      1_000,
      () => {
        credentialReads += 1;
        return syntheticKey();
      },
    );
    const result = await executeM9b4EffectAttempt({
      campaign: campaignValue,
      attempt,
      persistence: memory.persistence,
      createSession: () => {
        sessions += 1;
        return session;
      },
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "budget" } });
    expect({ sessions, credentialReads, fetches: seen.count }).toEqual({
      sessions: 0,
      credentialReads: 0,
      fetches: 0,
    });
  });

  it("persists reservation and dispatch before the sole intercepted transport", async () => {
    const campaignValue = await campaign();
    const prepared = await vector();
    const attempt = await effectAttempt(campaignValue, prepared);
    const memory = memoryLedger();
    const seen = observation();
    const order: Array<string> = [];
    const originalWrite = memory.persistence.writeAtomic;
    const persistence: M9b4AtomicPersistence = {
      ...memory.persistence,
      writeAtomic: async (input) => {
        const result = await originalWrite(input);
        if (result.ok) order.push(`write-${memory.writes()}`);
        return result;
      },
    };
    const session = await sessionFor(
      prepared,
      async (resource, options) => {
        order.push("fetch");
        return responseFetch(rawResponse(prepared.requestClass), seen)(
          resource,
          options,
        );
      },
      attempt.attemptId,
    );
    const result = await executeM9b4EffectAttempt({
      campaign: campaignValue,
      attempt,
      persistence,
      createSession: () => {
        order.push("session");
        return session;
      },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { terminal: "completed", transportInvoked: true },
    });
    expect(order.slice(0, 5)).toEqual([
      "write-1",
      "write-2",
      "write-3",
      "session",
      "fetch",
    ]);
    expect(seen.count).toBe(1);
    const inspection = await inspectM9b4EffectLedger(
      campaignValue,
      persistence,
    );
    expect(inspection).toMatchObject({
      ok: true,
      value: {
        total: {
          reservedAttempts: 1,
          chargedInputTokens: 10,
          chargedOutputTokens: 4,
        },
      },
    });
  });

  it("does not redispatch after terminal persistence fails", async () => {
    const campaignValue = await campaign();
    const prepared = await vector();
    const attempt = await effectAttempt(campaignValue, prepared);
    const memory = memoryLedger();
    memory.failBefore(4);
    const seen = observation();
    let sessions = 0;
    const createSession = async () => {
      sessions += 1;
      return sessionFor(
        prepared,
        responseFetch(rawResponse(prepared.requestClass), seen),
        attempt.attemptId,
      );
    };
    const firstSession = await createSession();
    const first = await executeM9b4EffectAttempt({
      campaign: campaignValue,
      attempt,
      persistence: memory.persistence,
      createSession: () => firstSession,
    });
    expect(first).toMatchObject({ ok: false, error: { kind: "storage" } });
    expect(seen.count).toBe(1);
    memory.clearFailure();
    const resumed = await executeM9b4EffectAttempt({
      campaign: campaignValue,
      attempt,
      persistence: memory.persistence,
      createSession: () => {
        throw new Error("resume must not create a session");
      },
    });
    expect(resumed).toMatchObject({
      ok: true,
      value: { terminal: "ambiguous", transportInvoked: false, resumed: true },
    });
    expect(seen.count).toBe(1);
    expect(sessions).toBe(1);
    const again = await executeM9b4EffectAttempt({
      campaign: campaignValue,
      attempt,
      persistence: memory.persistence,
      createSession: () => {
        throw new Error("repeated resume must remain effect-free");
      },
    });
    expect(again).toMatchObject({
      ok: true,
      value: { terminal: "ambiguous", transportInvoked: false },
    });
    expect(seen.count).toBe(1);
  });

  it("charges malformed usage as ledger ambiguity", async () => {
    const campaignValue = await campaign();
    const prepared = await vector();
    const attempt = await effectAttempt(campaignValue, prepared);
    const memory = memoryLedger();
    const seen = observation();
    const session = await sessionFor(
      prepared,
      responseFetch(
        rawResponse("static-answer-generation", { usage: null }),
        seen,
      ),
      attempt.attemptId,
    );
    const result = await executeM9b4EffectAttempt({
      campaign: campaignValue,
      attempt,
      persistence: memory.persistence,
      createSession: () => session,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        terminal: "ambiguous",
        scorable: false,
        accounting: {
          total: {
            chargedInputTokens: 10,
            chargedOutputTokens: 64,
            chargedCostUsdMicros: 141,
          },
        },
      },
    });
    expect(seen.count).toBe(1);
  });

  it("retains provider-reported usage for a typed output overage", async () => {
    const campaignValue = await campaign();
    const prepared = await vector();
    const attempt = await effectAttempt(campaignValue, prepared);
    const seen = observation();
    const session = await sessionFor(
      prepared,
      responseFetch(
        rawResponse("static-answer-generation", {
          usage: {
            input_tokens: 10,
            input_tokens_details: {
              cached_tokens: 0,
              cache_write_tokens: 0,
            },
            output_tokens: 65,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 75,
          },
        }),
        seen,
      ),
      attempt.attemptId,
    );
    const result = await executeM9b4EffectAttempt({
      campaign: campaignValue,
      attempt,
      persistence: memoryLedger().persistence,
      createSession: () => session,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        terminal: "overage",
        successful: false,
        scorable: false,
        accounting: {
          total: {
            chargedInputTokens: 10,
            chargedOutputTokens: 65,
            chargedCostUsdMicros: 141,
          },
        },
      },
    });
    expect(seen.count).toBe(1);
  });

  it("rejects post-reservation adapter identity drift before fetch", async () => {
    const campaignValue = await campaign();
    const prepared = await vector();
    const attempt = await effectAttempt(campaignValue, prepared);
    const memory = memoryLedger();
    const seen = observation();
    const session = await sessionFor(
      prepared,
      responseFetch(rawResponse(prepared.requestClass), seen),
      attempt.attemptId,
    );
    const result = await executeM9b4EffectAttempt({
      campaign: campaignValue,
      attempt,
      persistence: memory.persistence,
      createSession: () => ({
        ...session,
        model: { ...session.model, artifactDigest: digest("9") },
      }),
    });
    expect(result).toMatchObject({
      ok: true,
      value: { terminal: "ambiguous", transportInvoked: false },
    });
    expect(seen.count).toBe(0);
  });
});
