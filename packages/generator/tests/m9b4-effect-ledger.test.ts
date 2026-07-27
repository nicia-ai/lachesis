import {
  canonicalizeJson,
  diagnostic,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import * as generatorFacade from "../src/index.js";
import {
  executeM9b4EffectAttempt,
  inspectM9b4EffectLedger,
  M9B4_EFFECT_LEDGER_PROTOCOL,
  type M9b4AtomicPersistence,
  type M9b4Attempt,
  type M9b4AttemptInput,
  type M9b4Campaign,
  type M9b4CampaignInput,
  m9b4InternalLedgerSnapshotSchema,
  type M9b4TransportSession,
  prepareM9b4Attempt,
  prepareM9b4Campaign,
} from "../src/m9b4-effect-ledger.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok)
    throw new Error(`Expected success: ${JSON.stringify(result.error)}`);
  return result.value;
}

type FailureMode = "before-error" | "after-error" | "after-throw";

type MemoryLedger = Readonly<{
  persistence: M9b4AtomicPersistence;
  writes: () => number;
  content: () => string | undefined;
  failWrite: (write: number, mode: FailureMode) => void;
  clearFailure: () => void;
  replaceContent: (content: string) => void;
}>;

function memoryLedger(): MemoryLedger {
  let content: string | undefined;
  let revision = 0;
  let writes = 0;
  let failure: Readonly<{ write: number; mode: FailureMode }> | undefined;
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
        const expected = content === undefined ? null : String(revision);
        if (expected !== expectedRevision)
          return Promise.resolve({
            ok: false,
            error: diagnostic(
              "REPLAY_REQUEST_MISMATCH",
              "Injected atomic revision conflict.",
            ),
          });
        if (failure?.write === writes && failure.mode === "before-error")
          return Promise.resolve({
            ok: false,
            error: diagnostic("BUDGET_EXCEEDED", "Injected write failure."),
          });
        content = next;
        revision += 1;
        if (failure?.write === writes && failure.mode === "after-error")
          return Promise.resolve({
            ok: false,
            error: diagnostic(
              "BUDGET_EXCEEDED",
              "Injected lost persistence acknowledgement.",
            ),
          });
        if (failure?.write === writes && failure.mode === "after-throw")
          throw new Error("Injected process interruption after persistence.");
        return Promise.resolve({
          ok: true,
          value: { revision: String(revision) },
        });
      },
    },
    writes: () => writes,
    content: () => content,
    failWrite: (write, mode) => {
      failure = { write, mode };
    },
    clearFailure: () => {
      failure = undefined;
    },
    replaceContent: (next) => {
      content = next;
      revision += 1;
    },
  };
}

const PROVIDER = Object.freeze({
  id: "offline-provider",
  version: "2026-07-26",
  artifactDigest: "1".repeat(64),
});
const MODEL = Object.freeze({
  id: "offline-model",
  version: "1",
  artifactDigest: "2".repeat(64),
  providerId: PROVIDER.id,
});
const TOKENIZER = Object.freeze({
  id: "offline-tokenizer",
  version: "1",
  artifactDigest: "3".repeat(64),
  providerId: PROVIDER.id,
});
const PRICING = Object.freeze({
  id: "offline-pricing",
  version: "2026-07-26",
  artifactDigest: "4".repeat(64),
  providerId: PROVIDER.id,
  inputUsdMicrosPerMillionTokens: 1_000_000,
  cachedInputUsdMicrosPerMillionTokens: 500_000,
  cacheWriteInputUsdMicrosPerMillionTokens: 1_000_000,
  outputUsdMicrosPerMillionTokens: 2_000_000,
  reasoningUsdMicrosPerMillionTokens: 3_000_000,
  longContextThresholdTokens: 272_000,
  longContextInputMultiplierMicros: 2_000_000,
  longContextOutputMultiplierMicros: 1_500_000,
});

function campaignInput(maximumCostUsdMicros = 1_000): M9b4CampaignInput {
  const ceiling = {
    maximumInputTokens: 1_000,
    maximumOutputTokens: 1_000,
    maximumReasoningTokens: 1_000,
    maximumWallClockMs: 100_000,
    maximumCostUsdMicros,
  };
  return {
    campaignId: "offline-m9b4-campaign",
    budgetEnvelope: {
      maximumAttempts: 12,
      maximumConcurrentAttempts: 1,
      ...ceiling,
      providers: [{ provider: PROVIDER, ...ceiling }],
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
  };
}

async function campaign(maximumCostUsdMicros = 1_000): Promise<M9b4Campaign> {
  return unwrap(await prepareM9b4Campaign(campaignInput(maximumCostUsdMicros)));
}

async function attempt(
  campaignValue: M9b4Campaign,
  overrides: Readonly<Pick<M9b4AttemptInput, "arm" | "phase" | "callIndex">> = {
    arm: "discovered-program",
    phase: "execution",
    callIndex: 0,
  },
): Promise<M9b4Attempt> {
  const request = { prompt: `offline-${overrides.arm}-${overrides.callIndex}` };
  const serializedRequest = unwrap(canonicalizeJson(request));
  const requestDigest = unwrap(await digestValue(request));
  return unwrap(
    await prepareM9b4Attempt(campaignValue, {
      comparisonDigest: "5".repeat(64),
      ...overrides,
      serializedRequest,
      requestDigest,
      reservedInputTokenCeiling: 10,
      provider: PROVIDER,
      model: MODEL,
      tokenizer: TOKENIZER,
      pricingSnapshot: PRICING,
      reservation: {
        maximumInputTokens: 10,
        maximumOutputTokens: 5,
        maximumReasoningTokens: 2,
        maximumWallClockMs: 1_000,
        maximumCostUsdMicros: 26,
      },
    }),
  );
}

type SessionCounters = {
  sessions: number;
  credentials: number;
  transports: number;
};

function successfulTransport(outputTokens = 2, reasoningTokens = 1): unknown {
  return {
    kind: "success",
    output: { answer: "offline" },
    usage: {
      inputTokens: 10,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens,
      reasoningTokens,
      wallClockMs: 20,
      costUsdMicros: 10 + outputTokens * 2 + reasoningTokens * 3,
    },
  };
}

function sessionFactory(
  counters: SessionCounters,
  result: unknown = successfulTransport(),
): () => M9b4TransportSession {
  return () => {
    counters.sessions += 1;
    counters.credentials += 1;
    return {
      provider: PROVIDER,
      model: MODEL,
      tokenizer: TOKENIZER,
      pricingSnapshot: PRICING,
      invoke: () => {
        counters.transports += 1;
        return Promise.resolve(result);
      },
    };
  };
}

function emptyCounters(): SessionCounters {
  return { sessions: 0, credentials: 0, transports: 0 };
}

async function serializedSnapshot(
  memory: MemoryLedger,
  transform: (
    snapshot: ReturnType<typeof m9b4InternalLedgerSnapshotSchema.parse>,
  ) => Promise<unknown>,
): Promise<string> {
  const content = memory.content();
  if (content === undefined) throw new Error("Expected ledger content.");
  const parsed = unwrap(parseJson(content));
  const snapshot = m9b4InternalLedgerSnapshotSchema.parse(parsed);
  return unwrap(canonicalizeJson(await transform(snapshot)));
}

async function resignSnapshotBody(
  snapshot: ReturnType<typeof m9b4InternalLedgerSnapshotSchema.parse>,
  events: ReadonlyArray<
    ReturnType<typeof m9b4InternalLedgerSnapshotSchema.parse>["events"][number]
  >,
): Promise<unknown> {
  const chainedEvents: Array<unknown> = [];
  let previousDigest: string | null = null;
  for (const event of events) {
    const {
      digest: _digest,
      index: _index,
      previousDigest: _previousDigest,
      ...payload
    } = event;
    void _digest;
    void _index;
    void _previousDigest;
    const body = {
      ...payload,
      index: chainedEvents.length,
      previousDigest,
    };
    const digestInput: unknown = body;
    const digest: string = unwrap(await digestValue(digestInput));
    chainedEvents.push({ ...body, digest });
    previousDigest = digest;
  }
  const body = {
    protocol: snapshot.protocol,
    campaignDigest: snapshot.campaignDigest,
    events: chainedEvents,
  };
  return { ...body, ledgerDigest: unwrap(await digestValue(body)) };
}

describe("M9b.4 offline effect ledger", () => {
  it("keeps the controller private and freezes the offline NO-GO boundary", () => {
    expect(M9B4_EFFECT_LEDGER_PROTOCOL.retryPolicy).toContain("zero-automatic");
    expect(M9B4_EFFECT_LEDGER_PROTOCOL.claimBoundary).toContain("no corpus");
    expect("executeM9b4EffectAttempt" in generatorFacade).toBe(false);
    expect("prepareM9b4Campaign" in generatorFacade).toBe(false);
  });

  it("rejects malformed campaign caps and noncanonical request bytes", async () => {
    const validCampaignInput = campaignInput();
    const invalidCampaign = await prepareM9b4Campaign({
      ...validCampaignInput,
      budgetEnvelope: {
        ...validCampaignInput.budgetEnvelope,
        phases: [
          validCampaignInput.budgetEnvelope.phases[0] ?? {
            phase: "authoring",
            maximumInputTokens: 0,
            maximumOutputTokens: 0,
            maximumReasoningTokens: 0,
            maximumWallClockMs: 0,
            maximumCostUsdMicros: 0,
          },
          {
            phase: "authoring",
            maximumInputTokens: 1_000,
            maximumOutputTokens: 1_000,
            maximumReasoningTokens: 1_000,
            maximumWallClockMs: 100_000,
            maximumCostUsdMicros: 1_000,
          },
          {
            phase: "evaluation",
            maximumInputTokens: 1_000,
            maximumOutputTokens: 1_000,
            maximumReasoningTokens: 1_000,
            maximumWallClockMs: 100_000,
            maximumCostUsdMicros: 1_000,
          },
        ],
      },
    });
    expect(invalidCampaign.ok).toBe(false);

    const campaignValue = await campaign();
    const invalidRequest = await prepareM9b4Attempt(campaignValue, {
      comparisonDigest: "5".repeat(64),
      arm: "discovered-program",
      phase: "execution",
      callIndex: 0,
      serializedRequest: '{ "prompt": "not-canonical" }',
      requestDigest: "0".repeat(64),
      reservedInputTokenCeiling: 10,
      provider: PROVIDER,
      model: MODEL,
      tokenizer: TOKENIZER,
      pricingSnapshot: PRICING,
      reservation: {
        maximumInputTokens: 10,
        maximumOutputTokens: 5,
        maximumReasoningTokens: 2,
        maximumWallClockMs: 1_000,
        maximumCostUsdMicros: 26,
      },
    });
    expect(invalidRequest.ok).toBe(false);
  });

  it("persists reservation and dispatch before exactly one successful transport", async () => {
    const campaignValue = await campaign();
    const attemptValue = await attempt(campaignValue);
    const memory = memoryLedger();
    const counters = emptyCounters();
    const first = unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memory.persistence,
        createSession: sessionFactory(counters),
      }),
    );
    expect(first).toMatchObject({
      terminal: "completed",
      successful: true,
      scorable: true,
      transportInvoked: true,
      resumed: false,
    });
    expect(memory.writes()).toBe(5);
    expect(counters).toEqual({ sessions: 1, credentials: 1, transports: 1 });
    expect(first.accounting.total).toMatchObject({
      maximumCostUsdMicros: 1_000,
      reservedAttempts: 1,
      chargedInputTokens: 10,
      chargedUncachedInputTokens: 10,
      chargedCachedInputTokens: 0,
      chargedCacheWriteInputTokens: 0,
      chargedOutputTokens: 2,
      chargedReasoningTokens: 1,
      chargedWallClockMs: 20,
      chargedCostUsdMicros: 17,
      remainingCostUsdMicros: 983,
    });

    const resumed = unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memory.persistence,
        createSession: sessionFactory(counters),
      }),
    );
    expect(resumed).toMatchObject({
      terminal: "completed",
      resumed: true,
      transportInvoked: false,
    });
    expect(counters).toEqual({ sessions: 1, credentials: 1, transports: 1 });
  });

  it("rejects an unaffordable reservation before session, credential, or transport access", async () => {
    const campaignValue = await campaign(25);
    const attemptValue = await attempt(campaignValue);
    const memory = memoryLedger();
    const counters = emptyCounters();
    const result = await executeM9b4EffectAttempt({
      campaign: campaignValue,
      attempt: attemptValue,
      persistence: memory.persistence,
      createSession: sessionFactory(counters),
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "budget" } });
    expect(memory.writes()).toBe(1);
    expect(counters).toEqual({ sessions: 0, credentials: 0, transports: 0 });
  });

  it("bounds prepared attempt identities before growing or dispatching the ledger", async () => {
    const input = campaignInput();
    const campaignValue = unwrap(
      await prepareM9b4Campaign({
        ...input,
        budgetEnvelope: { ...input.budgetEnvelope, maximumAttempts: 1 },
      }),
    );
    const memory = memoryLedger();
    const firstAttempt = await attempt(campaignValue);
    unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: firstAttempt,
        persistence: memory.persistence,
        createSession: sessionFactory(emptyCounters()),
      }),
    );
    const writes = memory.writes();
    const counters = emptyCounters();
    const secondAttempt = await attempt(campaignValue, {
      arm: "static-one-shot",
      phase: "execution",
      callIndex: 0,
    });
    const rejected = await executeM9b4EffectAttempt({
      campaign: campaignValue,
      attempt: secondAttempt,
      persistence: memory.persistence,
      createSession: sessionFactory(counters),
    });
    expect(rejected).toMatchObject({ ok: false, error: { kind: "budget" } });
    expect(memory.writes()).toBe(writes);
    expect(counters).toEqual({ sessions: 0, credentials: 0, transports: 0 });
  });

  it("does not invoke transport when dispatch-started persistence fails", async () => {
    const campaignValue = await campaign();
    const attemptValue = await attempt(campaignValue);
    const memory = memoryLedger();
    memory.failWrite(3, "before-error");
    const counters = emptyCounters();
    const first = await executeM9b4EffectAttempt({
      campaign: campaignValue,
      attempt: attemptValue,
      persistence: memory.persistence,
      createSession: sessionFactory(counters),
    });
    expect(first.ok).toBe(false);
    expect(counters.transports).toBe(0);
    memory.clearFailure();
    const resumed = unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memory.persistence,
        createSession: sessionFactory(counters),
      }),
    );
    expect(resumed.terminal).toBe("completed");
    expect(counters.transports).toBe(1);
  });

  it("resumes a prepared attempt after reservation persistence fails", async () => {
    const campaignValue = await campaign();
    const attemptValue = await attempt(campaignValue);
    const memory = memoryLedger();
    memory.failWrite(2, "before-error");
    const counters = emptyCounters();
    const first = await executeM9b4EffectAttempt({
      campaign: campaignValue,
      attempt: attemptValue,
      persistence: memory.persistence,
      createSession: sessionFactory(counters),
    });
    expect(first.ok).toBe(false);
    expect(counters.transports).toBe(0);
    memory.clearFailure();
    const resumed = unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memory.persistence,
        createSession: sessionFactory(counters),
      }),
    );
    expect(resumed).toMatchObject({
      terminal: "completed",
      resumed: true,
      transportInvoked: true,
    });
    expect(counters.transports).toBe(1);
  });

  it("treats a persisted dispatch-started crash as terminal ambiguity without dispatch", async () => {
    const campaignValue = await campaign();
    const attemptValue = await attempt(campaignValue);
    const memory = memoryLedger();
    memory.failWrite(3, "after-throw");
    const counters = emptyCounters();
    await expect(
      executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memory.persistence,
        createSession: sessionFactory(counters),
      }),
    ).rejects.toThrow("process interruption");
    expect(counters).toEqual({ sessions: 0, credentials: 0, transports: 0 });
    memory.clearFailure();
    const resumed = unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memory.persistence,
        createSession: sessionFactory(counters),
      }),
    );
    expect(resumed).toMatchObject({
      terminal: "ambiguous",
      successful: false,
      scorable: false,
      repairable: false,
      transportInvoked: false,
      resumed: true,
    });
    expect(resumed.accounting.total.chargedCostUsdMicros).toBe(26);
    expect(counters.transports).toBe(0);
  });

  it("never redispatches when a received response cannot be durably recorded", async () => {
    const campaignValue = await campaign();
    const attemptValue = await attempt(campaignValue);
    const memory = memoryLedger();
    memory.failWrite(4, "before-error");
    const counters = emptyCounters();
    const first = await executeM9b4EffectAttempt({
      campaign: campaignValue,
      attempt: attemptValue,
      persistence: memory.persistence,
      createSession: sessionFactory(counters),
    });
    expect(first.ok).toBe(false);
    expect(counters.transports).toBe(1);
    memory.clearFailure();
    const resumed = unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memory.persistence,
        createSession: sessionFactory(counters),
      }),
    );
    expect(resumed.terminal).toBe("ambiguous");
    expect(resumed.accounting.total.chargedCostUsdMicros).toBe(26);
    expect(counters.transports).toBe(1);
    unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memory.persistence,
        createSession: sessionFactory(counters),
      }),
    );
    expect(counters.transports).toBe(1);
  });

  it("classifies an invocation that throws as ambiguous and resumes settlement without retry", async () => {
    const campaignValue = await campaign();
    const attemptValue = await attempt(campaignValue);
    const memory = memoryLedger();
    memory.failWrite(5, "before-error");
    const counters = emptyCounters();
    const createSession = (): M9b4TransportSession => {
      counters.sessions += 1;
      counters.credentials += 1;
      return {
        provider: PROVIDER,
        model: MODEL,
        tokenizer: TOKENIZER,
        pricingSnapshot: PRICING,
        invoke: () => {
          counters.transports += 1;
          return Promise.reject(new Error("Unknown post-dispatch outcome."));
        },
      };
    };
    const first = await executeM9b4EffectAttempt({
      campaign: campaignValue,
      attempt: attemptValue,
      persistence: memory.persistence,
      createSession,
    });
    expect(first.ok).toBe(false);
    expect(counters.transports).toBe(1);
    memory.clearFailure();
    const resumed = unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memory.persistence,
        createSession,
      }),
    );
    expect(resumed).toMatchObject({
      terminal: "ambiguous",
      resumed: true,
      transportInvoked: false,
      scorable: false,
    });
    expect(resumed.accounting.total.chargedCostUsdMicros).toBe(26);
    expect(counters.transports).toBe(1);
  });

  it("recovers a committed receipt whose persistence acknowledgement was lost", async () => {
    const campaignValue = await campaign();
    const attemptValue = await attempt(campaignValue);
    const memory = memoryLedger();
    memory.failWrite(4, "after-error");
    const counters = emptyCounters();
    expect(
      (
        await executeM9b4EffectAttempt({
          campaign: campaignValue,
          attempt: attemptValue,
          persistence: memory.persistence,
          createSession: sessionFactory(counters),
        })
      ).ok,
    ).toBe(false);
    memory.clearFailure();
    const resumed = unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memory.persistence,
        createSession: sessionFactory(counters),
      }),
    );
    expect(resumed.terminal).toBe("completed");
    expect(resumed.accounting.total.chargedCostUsdMicros).toBe(17);
    expect(counters.transports).toBe(1);
  });

  it("resumes terminal completed and failed states only by settling them", async () => {
    for (const result of [
      successfulTransport(),
      {
        kind: "failure",
        failure: {
          kind: "provider-rejected",
          code: "offline-rejection",
          message: "Rejected by the intercepted transport.",
        },
        usage: {
          inputTokens: 10,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          wallClockMs: 10,
          costUsdMicros: 10,
        },
      },
    ]) {
      const campaignValue = await campaign();
      const attemptValue = await attempt(campaignValue);
      const memory = memoryLedger();
      memory.failWrite(5, "before-error");
      const counters = emptyCounters();
      expect(
        (
          await executeM9b4EffectAttempt({
            campaign: campaignValue,
            attempt: attemptValue,
            persistence: memory.persistence,
            createSession: sessionFactory(counters, result),
          })
        ).ok,
      ).toBe(false);
      memory.clearFailure();
      const resumed = unwrap(
        await executeM9b4EffectAttempt({
          campaign: campaignValue,
          attempt: attemptValue,
          persistence: memory.persistence,
          createSession: sessionFactory(counters, result),
        }),
      );
      expect(resumed.resumed).toBe(true);
      expect(resumed.transportInvoked).toBe(false);
      expect(counters.transports).toBe(1);
    }
  });

  it.each([
    ["missing", { kind: "success", output: { answer: "offline" } }],
    [
      "malformed",
      {
        kind: "success",
        output: { answer: "offline" },
        usage: { inputTokens: "ten" },
      },
    ],
  ])(
    "classifies %s usage as conservative ambiguity",
    async (_label, result) => {
      const campaignValue = await campaign();
      const attemptValue = await attempt(campaignValue);
      const memory = memoryLedger();
      const counters = emptyCounters();
      const outcome = unwrap(
        await executeM9b4EffectAttempt({
          campaign: campaignValue,
          attempt: attemptValue,
          persistence: memory.persistence,
          createSession: sessionFactory(counters, result),
        }),
      );
      expect(outcome).toMatchObject({ terminal: "ambiguous", scorable: false });
      expect(outcome.accounting.total.chargedCostUsdMicros).toBe(26);
      expect(counters.transports).toBe(1);
    },
  );

  it("retains complete provider usage for a typed reservation overage", async () => {
    const campaignValue = await campaign();
    const attemptValue = await attempt(campaignValue);
    const outcome = unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memoryLedger().persistence,
        createSession: sessionFactory(emptyCounters(), {
          kind: "success",
          output: { answer: "offline" },
          usage: {
            inputTokens: 10,
            cachedInputTokens: 0,
            cacheWriteInputTokens: 0,
            outputTokens: 6,
            reasoningTokens: 0,
            wallClockMs: 10,
            costUsdMicros: 22,
          },
        }),
      }),
    );
    expect(outcome).toMatchObject({
      terminal: "overage",
      successful: false,
      scorable: false,
      accounting: {
        total: { chargedOutputTokens: 6, chargedCostUsdMicros: 26 },
      },
    });
  });

  it("allows only one concurrent controller to win an attempt identity", async () => {
    const campaignValue = await campaign();
    const attemptValue = await attempt(campaignValue);
    const memory = memoryLedger();
    const counters = emptyCounters();
    const createSession = sessionFactory(counters);
    const results = await Promise.all([
      executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memory.persistence,
        createSession,
      }),
      executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memory.persistence,
        createSession,
      }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(counters.transports).toBe(1);
    const resumed = unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memory.persistence,
        createSession,
      }),
    );
    expect(resumed.transportInvoked).toBe(false);
    expect(counters.transports).toBe(1);
  });

  it("fails closed on request, reservation, receipt, usage, settlement, and chain tampering", async () => {
    const mutations = [
      "request",
      "reservation",
      "receipt",
      "usage",
      "settlement",
      "chain",
    ] as const;
    for (const mutation of mutations) {
      const campaignValue = await campaign();
      const attemptValue = await attempt(campaignValue);
      const memory = memoryLedger();
      unwrap(
        await executeM9b4EffectAttempt({
          campaign: campaignValue,
          attempt: attemptValue,
          persistence: memory.persistence,
          createSession: sessionFactory(emptyCounters()),
        }),
      );
      const changed = await serializedSnapshot(memory, async (snapshot) => {
        const events = await Promise.all(
          snapshot.events.map(async (event) => {
            if (mutation === "request" && event.kind === "prepared")
              return {
                ...event,
                attempt: {
                  ...event.attempt,
                  serializedRequest: '{"prompt":"tampered"}',
                },
              };
            if (mutation === "reservation" && event.kind === "prepared")
              return {
                ...event,
                attempt: {
                  ...event.attempt,
                  reservation: {
                    ...event.attempt.reservation,
                    maximumOutputTokens: 4,
                  },
                },
              };
            if (mutation === "receipt" && event.kind === "completed") {
              const changedReceipt = {
                ...event.receipt,
                requestDigest: "0".repeat(64),
              };
              const { receiptDigest: _receiptDigest, ...receiptBody } =
                changedReceipt;
              void _receiptDigest;
              return {
                ...event,
                receipt: {
                  ...receiptBody,
                  receiptDigest: unwrap(await digestValue(receiptBody)),
                },
              };
            }
            if (mutation === "usage" && event.kind === "completed") {
              const changedReceipt = {
                ...event.receipt,
                usage: { ...event.receipt.usage, outputTokens: 5 },
              };
              const { receiptDigest: _receiptDigest, ...receiptBody } =
                changedReceipt;
              void _receiptDigest;
              return {
                ...event,
                receipt: {
                  ...receiptBody,
                  receiptDigest: unwrap(await digestValue(receiptBody)),
                },
              };
            }
            if (mutation === "settlement" && event.kind === "reconciled") {
              const changedSettlement = {
                ...event.settlement,
                chargedCostUsdMicros: event.settlement.chargedCostUsdMicros + 1,
              };
              const { settlementDigest: _settlementDigest, ...settlementBody } =
                changedSettlement;
              void _settlementDigest;
              return {
                ...event,
                settlement: {
                  ...settlementBody,
                  settlementDigest: unwrap(await digestValue(settlementBody)),
                },
              };
            }
            return event;
          }),
        );
        return resignSnapshotBody(
          snapshot,
          mutation === "chain"
            ? [events[1], events[0], ...events.slice(2)].filter(
                (event) => event !== undefined,
              )
            : events,
        );
      });
      memory.replaceContent(changed);
      const inspection = await inspectM9b4EffectLedger(
        campaignValue,
        memory.persistence,
      );
      expect({ mutation, accepted: inspection.ok }).toEqual({
        mutation,
        accepted: false,
      });
    }
  });

  it("preserves a completed first arm when the second arm becomes ambiguous", async () => {
    const campaignValue = await campaign();
    const firstAttempt = await attempt(campaignValue, {
      arm: "discovered-program",
      phase: "execution",
      callIndex: 0,
    });
    const secondAttempt = await attempt(campaignValue, {
      arm: "static-one-shot",
      phase: "execution",
      callIndex: 0,
    });
    const memory = memoryLedger();
    const firstCounters = emptyCounters();
    unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: firstAttempt,
        persistence: memory.persistence,
        createSession: sessionFactory(firstCounters),
      }),
    );
    memory.failWrite(9, "before-error");
    const secondCounters = emptyCounters();
    expect(
      (
        await executeM9b4EffectAttempt({
          campaign: campaignValue,
          attempt: secondAttempt,
          persistence: memory.persistence,
          createSession: sessionFactory(secondCounters),
        })
      ).ok,
    ).toBe(false);
    memory.clearFailure();
    const firstResume = unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: firstAttempt,
        persistence: memory.persistence,
        createSession: sessionFactory(firstCounters),
      }),
    );
    const secondResume = unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: secondAttempt,
        persistence: memory.persistence,
        createSession: sessionFactory(secondCounters),
      }),
    );
    expect(firstResume.terminal).toBe("completed");
    expect(secondResume.terminal).toBe("ambiguous");
    expect(firstCounters.transports).toBe(1);
    expect(secondCounters.transports).toBe(1);
  });

  it("rederives campaign, provider, phase, arm, and request accounting exactly", async () => {
    const campaignValue = await campaign();
    const memory = memoryLedger();
    const discovered = await attempt(campaignValue, {
      arm: "discovered-program",
      phase: "authoring",
      callIndex: 0,
    });
    const staticAttempt = await attempt(campaignValue, {
      arm: "static-one-shot",
      phase: "evaluation",
      callIndex: 0,
    });
    for (const attemptValue of [discovered, staticAttempt])
      unwrap(
        await executeM9b4EffectAttempt({
          campaign: campaignValue,
          attempt: attemptValue,
          persistence: memory.persistence,
          createSession: sessionFactory(emptyCounters()),
        }),
      );
    const status = unwrap(
      await inspectM9b4EffectLedger(campaignValue, memory.persistence),
    );
    expect(status.total.chargedCostUsdMicros).toBe(34);
    expect(status.total).toMatchObject({
      chargedInputTokens: 20,
      chargedUncachedInputTokens: 20,
      chargedCachedInputTokens: 0,
      chargedCacheWriteInputTokens: 0,
      chargedOutputTokens: 4,
      chargedReasoningTokens: 2,
      chargedWallClockMs: 40,
    });
    expect(status.providers[0]?.accounting.chargedCostUsdMicros).toBe(34);
    expect(
      status.phases.find((entry) => entry.phase === "authoring")?.accounting
        .chargedCostUsdMicros,
    ).toBe(17);
    expect(
      status.arms.find((entry) => entry.arm === "static-one-shot")?.accounting
        .chargedCostUsdMicros,
    ).toBe(17);
    expect(status.requests).toHaveLength(2);
    expect(
      status.requests.every(
        (entry) =>
          entry.reservedAttempts === 1 &&
          entry.chargedInputTokens === 10 &&
          entry.chargedUncachedInputTokens === 10 &&
          entry.chargedCachedInputTokens === 0 &&
          entry.chargedCacheWriteInputTokens === 0 &&
          entry.chargedOutputTokens === 2 &&
          entry.chargedReasoningTokens === 1 &&
          entry.chargedWallClockMs === 20 &&
          entry.chargedCostUsdMicros === 17,
      ),
    ).toBe(true);
  });

  it("rederives uncached, cached, and cache-write billing classes", async () => {
    const campaignValue = await campaign();
    const attemptValue = await attempt(campaignValue);
    const memory = memoryLedger();
    const result = unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memory.persistence,
        createSession: sessionFactory(emptyCounters(), {
          kind: "success",
          output: { answer: "offline" },
          usage: {
            inputTokens: 10,
            cachedInputTokens: 3,
            cacheWriteInputTokens: 2,
            outputTokens: 0,
            reasoningTokens: 0,
            wallClockMs: 20,
            costUsdMicros: 9,
          },
        }),
      }),
    );

    expect(result.accounting.total).toMatchObject({
      chargedInputTokens: 10,
      chargedUncachedInputTokens: 5,
      chargedCachedInputTokens: 3,
      chargedCacheWriteInputTokens: 2,
      chargedCostUsdMicros: 9,
    });
  });

  it("charges overlapping input billing classes as conservative ambiguity", async () => {
    const campaignValue = await campaign();
    const attemptValue = await attempt(campaignValue);
    const result = unwrap(
      await executeM9b4EffectAttempt({
        campaign: campaignValue,
        attempt: attemptValue,
        persistence: memoryLedger().persistence,
        createSession: sessionFactory(emptyCounters(), {
          kind: "success",
          output: { answer: "offline" },
          usage: {
            inputTokens: 10,
            cachedInputTokens: 6,
            cacheWriteInputTokens: 5,
            outputTokens: 0,
            reasoningTokens: 0,
            wallClockMs: 20,
            costUsdMicros: 9,
          },
        }),
      }),
    );

    expect(result).toMatchObject({
      terminal: "ambiguous",
      accounting: {
        total: {
          chargedInputTokens: 10,
          chargedUncachedInputTokens: 10,
          chargedCachedInputTokens: 0,
          chargedCacheWriteInputTokens: 0,
          chargedCostUsdMicros: 26,
        },
      },
    });
  });

  it("property-checks exact pricing reconciliation within the frozen reservation", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 2 }),
        async (outputTokens, reasoningTokens) => {
          const campaignValue = await campaign();
          const attemptValue = await attempt(campaignValue);
          const memory = memoryLedger();
          const result = unwrap(
            await executeM9b4EffectAttempt({
              campaign: campaignValue,
              attempt: attemptValue,
              persistence: memory.persistence,
              createSession: sessionFactory(
                emptyCounters(),
                successfulTransport(outputTokens, reasoningTokens),
              ),
            }),
          );
          expect(result.accounting.total.chargedCostUsdMicros).toBe(
            10 + outputTokens * 2 + reasoningTokens * 3,
          );
        },
      ),
      { numRuns: 24 },
    );
  });
});
