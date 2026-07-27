import {
  canonicalizeJson,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import {
  type M9b4AtomicPersistence,
  type M9b4Campaign,
  type M9b4TransportSession,
  prepareM9b4Campaign,
} from "../../generator/src/m9b4-effect-ledger.js";
import {
  acceptM9b6OfflineHardCapObservation,
  executeM9b6AdmittedRequest,
  freezeM9b6ScientificEnvelope,
  M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL,
  type M9b6AdmittedRequest,
  type M9b6Campaign,
  m9b6CampaignSchema,
  type M9b6FrozenScientificEnvelopeToken,
  type M9b6VerifiedHardCapToken,
  prepareM9b6AdmittedRequest,
  prepareM9b6Campaign,
  verifyM9b6ZeroEffectResume,
} from "../internal/m9b6-conservative-accounting.js";
import * as aiSdkFacade from "../src/index.js";
import {
  type M9b5ConformanceVector,
  type M9b5IdentityProfile,
  prepareM9b5ConformanceVector,
} from "../src/m9b5-openai-responses.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function digest(character: string): string {
  return character.repeat(64);
}

const PROVIDER = Object.freeze({
  id: "openai-responses-offline-intercept",
  version: "2026-07-26",
  artifactDigest: digest("1"),
});
const MODEL = Object.freeze({
  id: "gpt-5.6-terra",
  version: "gpt-5.6-terra",
  artifactDigest: digest("2"),
  providerId: PROVIDER.id,
});
const IDENTITIES: M9b5IdentityProfile = Object.freeze({
  provider: PROVIDER,
  model: MODEL,
  tokenizer: Object.freeze({
    id: "provider-tokenizer-unavailable",
    version: "unknown-framing",
    artifactDigest: digest("3"),
    providerId: PROVIDER.id,
  }),
  pricingSnapshot: Object.freeze({
    id: "openai-pricing-offline-fixture",
    version: "2026-07-26",
    artifactDigest: digest("4"),
    providerId: PROVIDER.id,
    inputUsdMicrosPerMillionTokens: 1_000_000,
    cachedInputUsdMicrosPerMillionTokens: 250_000,
    cacheWriteInputUsdMicrosPerMillionTokens: 1_250_000,
    outputUsdMicrosPerMillionTokens: 2_000_000,
    reasoningUsdMicrosPerMillionTokens: 0,
    longContextThresholdTokens: 50,
    longContextInputMultiplierMicros: 2_000_000,
    longContextOutputMultiplierMicros: 1_500_000,
  }),
  serializer: Object.freeze({
    id: "ai-sdk-openai-responses-canonical-intercept",
    version: "4.0.15/1",
    artifactDigest: digest("5"),
    providerId: PROVIDER.id,
  }),
});
const PROJECT = Object.freeze({
  id: "offline-project-fixture",
  version: "1",
  artifactDigest: digest("6"),
  providerId: PROVIDER.id,
});
const VERIFIER = Object.freeze({
  id: "offline-independent-cap-verifier",
  version: "1",
  artifactDigest: digest("7"),
});
const LIMITS_ARTIFACT = Object.freeze({
  id: "gpt-5.6-terra-model-limits",
  version: "2026-07-26",
  artifactDigest: digest("8"),
});
const COMPARISON = digest("9");
const NOW = 1_000;

function hardCapObservation(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    protocol: "lachesis-m9b6-offline-hard-cap-observation/1",
    provider: PROVIDER,
    project: PROJECT,
    control: "hard",
    currency: "USD",
    hardCapUsdMicros: 100_000,
    trackedSpendUsdMicros: 20_000,
    remainingUsdMicros: 80_000,
    observedAtMs: 900,
    expiresAtMs: 2_000,
    enforcement: {
      atLimit: "429-insufficient_quota",
      propagation: "not-instantaneous",
      documentedOvershootBound: "unknown",
    },
    ...overrides,
  };
}

async function cap(
  overrides: Readonly<Record<string, unknown>> = {},
  expectedProject = PROJECT,
): Promise<
  Readonly<{
    token: M9b6VerifiedHardCapToken;
  }>
> {
  const observation = hardCapObservation(overrides);
  return unwrap(
    await acceptM9b6OfflineHardCapObservation({
      canonicalObservationBytes: unwrap(canonicalizeJson(observation)),
      expectedProvider: PROVIDER,
      expectedProject,
      expectedCurrency: "USD",
      verificationArtifact: VERIFIER,
      nowMs: NOW,
    }),
  );
}

function scientificEnvelope(
  armOrder: ReadonlyArray<"discovered-program" | "static-one-shot"> = [
    "discovered-program",
    "static-one-shot",
  ],
  staticCost = 10_000,
): Readonly<Record<string, unknown>> {
  const common = {
    maximumCanonicalRequestBytes: 1_048_576,
    maximumAggregateModelCalls: 4,
    maximumAggregateOutputTokens: 1_000,
    reasoningEffort: "none" as const,
    maximumRetrievalEvidenceBytes: 4_096,
    maximumModelWallClockMs: 10_000,
    maximumAttempts: 4,
    maximumCostUsdMicros: 10_000,
  };
  return {
    protocol: "lachesis-m9b6-scientific-envelope/1",
    comparisonDigest: COMPARISON,
    model: MODEL,
    arms: [
      { arm: "discovered-program", ...common },
      {
        arm: "static-one-shot",
        ...common,
        maximumCostUsdMicros: staticCost,
      },
    ],
    armOrder,
    inclusionRule:
      "all-first-attempt-terminal-records-independent-of-reported-token-usage",
    matchingRule:
      "equal-controller-envelopes-not-exact-cross-arm-request-byte-equality",
  };
}

async function effectCampaign(
  maximumCostUsdMicros = 10_000,
): Promise<M9b4Campaign> {
  const ceiling = {
    maximumInputTokens: 1_000,
    maximumOutputTokens: 1_000,
    maximumReasoningTokens: 0,
    maximumWallClockMs: 100_000,
    maximumCostUsdMicros,
  };
  return unwrap(
    await prepareM9b4Campaign({
      campaignId: "m9b6-offline-campaign",
      budgetEnvelope: {
        maximumAttempts: 4,
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
    }),
  );
}

async function vector(
  input = 'ASCII é e\u0301 😀 escapes \\n and {"__proto__":"safe"}',
  requestClass:
    | "static-answer-generation"
    | "root-program-authoring" = "static-answer-generation",
  callIndex = 0,
): Promise<M9b5ConformanceVector> {
  const discovered = requestClass === "root-program-authoring";
  return unwrap(
    await prepareM9b5ConformanceVector({
      requestClass,
      comparisonDigest: COMPARISON,
      arm: discovered ? "discovered-program" : "static-one-shot",
      phase: discovered ? "authoring" : "execution",
      callIndex,
      instructions: "Return the frozen public structured response only.",
      input,
      maximumOutputTokens: 64,
      identities: IDENTITIES,
    }),
  );
}

type Setup = Readonly<{
  campaign: M9b6Campaign;
  hardCapToken: M9b6VerifiedHardCapToken;
  scientificEnvelopeToken: M9b6FrozenScientificEnvelopeToken;
  admitted: M9b6AdmittedRequest;
}>;

async function setup(): Promise<Setup> {
  const hardCap = await cap();
  const frozen = unwrap(freezeM9b6ScientificEnvelope(scientificEnvelope()));
  const campaignValue = unwrap(
    await prepareM9b6Campaign({
      campaignId: "m9b6-offline-campaign",
      m9b4Campaign: await effectCampaign(),
      hardCapToken: hardCap.token,
      scientificEnvelopeToken: frozen.token,
      campaignCapUsdMicros: 10_000,
      maximumRequestCount: 4,
      activationTimeMs: NOW,
      modelLimits: {
        model: MODEL,
        limitsArtifact: LIMITS_ARTIFACT,
        maximumInputTokens: 100,
        maximumOutputTokens: 64,
        contextWindowTokens: 164,
        reservationBasis:
          "full-provider-model-input-maximum-including-unknown-framing",
      },
    }),
  );
  const admitted = unwrap(
    await prepareM9b6AdmittedRequest({
      campaign: campaignValue,
      hardCapToken: hardCap.token,
      scientificEnvelopeToken: frozen.token,
      vector: await vector(),
      maximumWallClockMs: 1_000,
      nowMs: NOW,
    }),
  );
  return {
    campaign: campaignValue,
    hardCapToken: hardCap.token,
    scientificEnvelopeToken: frozen.token,
    admitted,
  };
}

function memoryLedger(): Readonly<{
  persistence: M9b4AtomicPersistence;
  content: () => string | undefined;
  replace: (content: string) => void;
}> {
  let content: string | undefined;
  let revision = 0;
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
      writeAtomic: (input) => {
        if (
          input.expectedRevision !== (revision === 0 ? null : String(revision))
        )
          return Promise.resolve({
            ok: false,
            error: diagnostic("REPLAY_REQUEST_MISMATCH", "CAS mismatch."),
          });
        content = input.content;
        revision += 1;
        return Promise.resolve({
          ok: true,
          value: { revision: String(revision) },
        });
      },
    },
    content: () => content,
    replace: (next) => {
      content = next;
      revision += 1;
    },
  };
}

type Counters = { sessions: number; transports: number };

function session(
  counters: Counters,
  usage: unknown = {
    inputTokens: 10,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 4,
    reasoningTokens: 0,
    wallClockMs: 20,
    costUsdMicros: 18,
  },
): () => M9b4TransportSession {
  return () => {
    counters.sessions += 1;
    return {
      provider: IDENTITIES.provider,
      model: IDENTITIES.model,
      tokenizer: IDENTITIES.tokenizer,
      pricingSnapshot: IDENTITIES.pricingSnapshot,
      invoke: () => {
        counters.transports += 1;
        return Promise.resolve({
          kind: "success",
          output: { answer: "offline", citationIds: ["chunk:1"] },
          usage,
        });
      },
    };
  };
}

function withField(
  value: unknown,
  key: string,
  replacement: unknown,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected object fixture.");
  return { ...Object.fromEntries(Object.entries(value)), [key]: replacement };
}

async function execute(
  fixture: Setup,
  persistence: M9b4AtomicPersistence,
  createSession: () => M9b4TransportSession,
  nowMs = NOW,
) {
  return executeM9b6AdmittedRequest({
    campaign: fixture.campaign,
    hardCapToken: fixture.hardCapToken,
    scientificEnvelopeToken: fixture.scientificEnvelopeToken,
    admittedRequest: fixture.admitted,
    persistence,
    createSession,
    nowMs,
  });
}

async function resign<T extends Readonly<Record<string, unknown>>>(
  value: T,
  digestKey: keyof T,
): Promise<T> {
  const entries = Object.entries(value).filter(([key]) => key !== digestKey);
  const body = Object.fromEntries(entries);
  return { ...value, [digestKey]: unwrap(await digestValue(body)) };
}

describe("M9b.6 conservative pre-dispatch accounting", () => {
  it("keeps the protocol private and the milestone offline-only", () => {
    expect("M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL" in aiSdkFacade).toBe(false);
    expect(M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL.claimBoundary).toContain(
      "no corpus",
    );
  });

  it("binds exact canonical UTF-8 bytes without labeling them as tokens", async () => {
    const fixture = await setup();
    expect(fixture.admitted.providerRequestUtf8Bytes).toBe(
      new TextEncoder().encode(fixture.admitted.providerRequestBytes)
        .byteLength,
    );
    expect(fixture.admitted.providerRequestUtf8Bytes).toBeGreaterThan(
      fixture.admitted.providerRequestBytes.length,
    );
    expect(fixture.admitted.quantityClassification).toEqual({
      providerRequestBytes: "exact",
      modelInputTokenCeiling: "conservative",
      providerFramingTokens: "unknown",
      providerReportedUsage: "unknown-until-settlement",
    });
  });

  it("distinguishes canonically different composed and decomposed text", async () => {
    const composed = await vector("é");
    const decomposed = await vector("e\u0301");
    expect(composed.providerRequestBytes).not.toBe(
      decomposed.providerRequestBytes,
    );
    expect(composed.providerRequestDigest).not.toBe(
      decomposed.providerRequestDigest,
    );
  });

  it("rejects noncanonical cap bytes and soft, stale, absent-project, or currency drift", async () => {
    const cases = [
      {
        bytes: JSON.stringify(hardCapObservation()),
        nowMs: NOW,
        project: PROJECT,
      },
      {
        bytes: unwrap(
          canonicalizeJson(hardCapObservation({ control: "soft-alert" })),
        ),
        nowMs: NOW,
        project: PROJECT,
      },
      {
        bytes: unwrap(canonicalizeJson(hardCapObservation())),
        nowMs: 2_000,
        project: PROJECT,
      },
      {
        bytes: unwrap(canonicalizeJson(hardCapObservation())),
        nowMs: NOW,
        project: { ...PROJECT, id: "other-project" },
      },
      {
        bytes: unwrap(
          canonicalizeJson(hardCapObservation({ currency: "EUR" })),
        ),
        nowMs: NOW,
        project: PROJECT,
      },
    ];
    for (const candidate of cases) {
      const accepted = await acceptM9b6OfflineHardCapObservation({
        canonicalObservationBytes: candidate.bytes,
        expectedProvider: PROVIDER,
        expectedProject: candidate.project,
        expectedCurrency: "USD",
        verificationArtifact: VERIFIER,
        nowMs: candidate.nowMs,
      });
      expect(accepted.ok).toBe(false);
    }
  });

  it("rejects campaign capacity above the verified project balance", async () => {
    const hardCap = await cap();
    const frozen = unwrap(freezeM9b6ScientificEnvelope(scientificEnvelope()));
    const result = await prepareM9b6Campaign({
      campaignId: "too-large",
      m9b4Campaign: await effectCampaign(90_000),
      hardCapToken: hardCap.token,
      scientificEnvelopeToken: frozen.token,
      campaignCapUsdMicros: 90_000,
      maximumRequestCount: 4,
      activationTimeMs: NOW,
      modelLimits: {
        model: MODEL,
        limitsArtifact: LIMITS_ARTIFACT,
        maximumInputTokens: 100,
        maximumOutputTokens: 64,
        contextWindowTokens: 164,
        reservationBasis:
          "full-provider-model-input-maximum-including-unknown-framing",
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an absent or forged hard-cap capability", async () => {
    const frozen = unwrap(freezeM9b6ScientificEnvelope(scientificEnvelope()));
    const result = await prepareM9b6Campaign({
      campaignId: "no-cap",
      m9b4Campaign: await effectCampaign(),
      hardCapToken: { capability: {} },
      scientificEnvelopeToken: frozen.token,
      campaignCapUsdMicros: 10_000,
      maximumRequestCount: 4,
      activationTimeMs: NOW,
      modelLimits: {
        model: MODEL,
        limitsArtifact: LIMITS_ARTIFACT,
        maximumInputTokens: 100,
        maximumOutputTokens: 64,
        contextWindowTokens: 164,
        reservationBasis:
          "full-provider-model-input-maximum-including-unknown-framing",
      },
    });
    expect(result.ok).toBe(false);
  });

  it("reserves the highest input billing class and long-context tier", async () => {
    const fixture = await setup();
    expect(fixture.admitted.effectAttempt.reservation).toMatchObject({
      maximumInputTokens: 100,
      maximumOutputTokens: 64,
      maximumCostUsdMicros: 442,
    });
  });

  it("rejects request, model, reasoning, schema, instructions, output, or provider mutation after reservation", async () => {
    const fixture = await setup();
    const mutations: ReadonlyArray<Readonly<Record<string, unknown>>> = [
      { ...fixture.admitted, providerRequestBytes: "{}" },
      {
        ...fixture.admitted,
        vector: {
          ...fixture.admitted.vector,
          identities: {
            ...fixture.admitted.vector.identities,
            model: { ...MODEL, artifactDigest: digest("a") },
          },
        },
      },
      {
        ...fixture.admitted,
        vector: {
          ...fixture.admitted.vector,
          providerRequest: withField(
            fixture.admitted.vector.providerRequest,
            "reasoning",
            { effort: "high" },
          ),
        },
      },
      {
        ...fixture.admitted,
        vector: {
          ...fixture.admitted.vector,
          responseSchemaDigest: digest("b"),
        },
      },
      {
        ...fixture.admitted,
        vector: {
          ...fixture.admitted.vector,
          modelVisible: {
            ...fixture.admitted.vector.modelVisible,
            instructions: "tampered",
          },
        },
      },
      {
        ...fixture.admitted,
        vector: { ...fixture.admitted.vector, maximumOutputTokens: 65 },
      },
      {
        ...fixture.admitted,
        vector: {
          ...fixture.admitted.vector,
          providerRequest: withField(
            fixture.admitted.vector.providerRequest,
            "service_tier",
            "priority",
          ),
        },
      },
    ];
    for (const mutation of mutations) {
      const resigned = await resign(mutation, "admissionDigest");
      const counters = { sessions: 0, transports: 0 };
      const result = await executeM9b6AdmittedRequest({
        campaign: fixture.campaign,
        hardCapToken: fixture.hardCapToken,
        scientificEnvelopeToken: fixture.scientificEnvelopeToken,
        admittedRequest: resigned,
        persistence: memoryLedger().persistence,
        createSession: session(counters),
        nowMs: NOW,
      });
      expect(result.ok).toBe(false);
      expect(counters).toEqual({ sessions: 0, transports: 0 });
    }
  });

  it("rejects unequal scientific envelopes and freezes arm order prospectively", async () => {
    expect(
      freezeM9b6ScientificEnvelope(scientificEnvelope(undefined, 9_999)).ok,
    ).toBe(false);
    const fixture = await setup();
    const reversed = unwrap(
      freezeM9b6ScientificEnvelope(
        scientificEnvelope(["static-one-shot", "discovered-program"]),
      ),
    );
    const result = await prepareM9b6Campaign({
      campaignId: fixture.campaign.campaignId,
      m9b4Campaign: fixture.campaign.m9b4Campaign,
      hardCapToken: fixture.hardCapToken,
      scientificEnvelopeToken: reversed.token,
      campaignCapUsdMicros: fixture.campaign.campaignCapUsdMicros,
      maximumRequestCount: fixture.campaign.maximumRequestCount,
      activationTimeMs: NOW,
      modelLimits: fixture.campaign.modelLimits,
    });
    expect(result.ok).toBe(true);
    const counters = { sessions: 0, transports: 0 };
    const rejected = await executeM9b6AdmittedRequest({
      campaign: unwrap(result),
      hardCapToken: fixture.hardCapToken,
      scientificEnvelopeToken: fixture.scientificEnvelopeToken,
      admittedRequest: fixture.admitted,
      persistence: memoryLedger().persistence,
      createSession: session(counters),
      nowMs: NOW,
    });
    expect(rejected.ok).toBe(false);
    expect(counters.transports).toBe(0);
  });

  it("does not permit post-outcome token filtering in the frozen inclusion rule", () => {
    const accepted = freezeM9b6ScientificEnvelope({
      ...scientificEnvelope(),
      inclusionRule: "include-only-if-provider-token-counts-match",
    });
    expect(accepted.ok).toBe(false);
  });

  it("settles complete usage exactly and releases unused reservation", async () => {
    const fixture = await setup();
    const memory = memoryLedger();
    const counters = { sessions: 0, transports: 0 };
    const result = unwrap(
      await execute(fixture, memory.persistence, session(counters)),
    );
    expect(result).toMatchObject({
      terminal: "completed",
      successful: true,
      scorable: true,
      accounting: {
        total: {
          chargedInputTokens: 10,
          chargedOutputTokens: 4,
          chargedCostUsdMicros: 18,
        },
      },
    });
  });

  it("settles the frozen long-context pricing tier exactly", async () => {
    const fixture = await setup();
    const result = unwrap(
      await execute(
        fixture,
        memoryLedger().persistence,
        session(
          { sessions: 0, transports: 0 },
          {
            inputTokens: 60,
            cachedInputTokens: 0,
            cacheWriteInputTokens: 0,
            outputTokens: 4,
            reasoningTokens: 0,
            wallClockMs: 20,
            costUsdMicros: 132,
          },
        ),
      ),
    );
    expect(result).toMatchObject({
      terminal: "completed",
      accounting: { total: { chargedCostUsdMicros: 132 } },
    });
  });

  it.each([
    ["missing", undefined],
    ["malformed", { inputTokens: "ten" }],
    [
      "missing-cached-read",
      {
        inputTokens: 10,
        cacheWriteInputTokens: 0,
        outputTokens: 4,
        reasoningTokens: 0,
        wallClockMs: 20,
        costUsdMicros: 18,
      },
    ],
    [
      "missing-cache-write",
      {
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 4,
        reasoningTokens: 0,
        wallClockMs: 20,
        costUsdMicros: 18,
      },
    ],
    [
      "overlapping-cache-classes",
      {
        inputTokens: 10,
        cachedInputTokens: 7,
        cacheWriteInputTokens: 6,
        outputTokens: 0,
        reasoningTokens: 0,
        wallClockMs: 20,
        costUsdMicros: 10,
      },
    ],
  ])("retains the full reservation for %s usage", async (_name, usage) => {
    const fixture = await setup();
    const memory = memoryLedger();
    const counters = { sessions: 0, transports: 0 };
    const createSession = () => {
      const created = session(counters, usage)();
      return usage === undefined
        ? {
            ...created,
            invoke: () => {
              counters.transports += 1;
              return Promise.resolve({ kind: "success", output: {} });
            },
          }
        : created;
    };
    const result = unwrap(
      await execute(fixture, memory.persistence, createSession),
    );
    expect(result).toMatchObject({
      terminal: "ambiguous",
      successful: false,
      scorable: false,
      accounting: { total: { chargedCostUsdMicros: 442 } },
    });
    unwrap(await execute(fixture, memory.persistence, createSession));
    expect(counters.transports).toBe(1);
  });

  it("records provider framing/accounting overage, conservatively charges, and halts", async () => {
    const fixture = await setup();
    const memory = memoryLedger();
    const counters = { sessions: 0, transports: 0 };
    const result = unwrap(
      await execute(
        fixture,
        memory.persistence,
        session(counters, {
          inputTokens: 101,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          wallClockMs: 20,
          costUsdMicros: 202,
        }),
      ),
    );
    expect(result).toMatchObject({
      terminal: "overage",
      successful: false,
      scorable: false,
      accounting: {
        progressionHalted: true,
        total: { chargedInputTokens: 101, chargedCostUsdMicros: 442 },
      },
    });
    const secondVector = await vector("second", "root-program-authoring", 0);
    const second = unwrap(
      await prepareM9b6AdmittedRequest({
        campaign: fixture.campaign,
        hardCapToken: fixture.hardCapToken,
        scientificEnvelopeToken: fixture.scientificEnvelopeToken,
        vector: secondVector,
        maximumWallClockMs: 1_000,
        nowMs: NOW,
      }),
    );
    const stopped = await executeM9b6AdmittedRequest({
      campaign: fixture.campaign,
      hardCapToken: fixture.hardCapToken,
      scientificEnvelopeToken: fixture.scientificEnvelopeToken,
      admittedRequest: second,
      persistence: memory.persistence,
      createSession: session(counters),
      nowMs: NOW,
    });
    expect(stopped).toMatchObject({
      ok: false,
      error: { kind: "campaign-halted" },
    });
    expect(counters.transports).toBe(1);
  });

  it("rejects cap drift during resume before session creation", async () => {
    const fixture = await setup();
    const alternateCap = await cap({
      hardCapUsdMicros: 110_000,
      trackedSpendUsdMicros: 30_000,
    });
    const counters = { sessions: 0, transports: 0 };
    const result = await executeM9b6AdmittedRequest({
      campaign: fixture.campaign,
      hardCapToken: alternateCap.token,
      scientificEnvelopeToken: fixture.scientificEnvelopeToken,
      admittedRequest: fixture.admitted,
      persistence: memoryLedger().persistence,
      createSession: session(counters),
      nowMs: NOW,
    });
    expect(result.ok).toBe(false);
    expect(counters).toEqual({ sessions: 0, transports: 0 });
  });

  it("fails closed on safe-integer reservation and balance overflow", async () => {
    const hardCap = await cap({
      hardCapUsdMicros: Number.MAX_SAFE_INTEGER,
      trackedSpendUsdMicros: Number.MAX_SAFE_INTEGER - 80_000,
    });
    const frozen = unwrap(freezeM9b6ScientificEnvelope(scientificEnvelope()));
    const result = await prepareM9b6Campaign({
      campaignId: "overflow",
      m9b4Campaign: await effectCampaign(),
      hardCapToken: hardCap.token,
      scientificEnvelopeToken: frozen.token,
      campaignCapUsdMicros: 10_000,
      maximumRequestCount: 4,
      activationTimeMs: NOW,
      modelLimits: {
        model: MODEL,
        limitsArtifact: LIMITS_ARTIFACT,
        maximumInputTokens: Number.MAX_SAFE_INTEGER,
        maximumOutputTokens: 64,
        contextWindowTokens: Number.MAX_SAFE_INTEGER,
        reservationBasis:
          "full-provider-model-input-maximum-including-unknown-framing",
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects tampered reservation, cap receipt, or ledger chain after re-signing", async () => {
    const fixture = await setup();
    const changedAttempt = {
      ...fixture.admitted,
      effectAttempt: {
        ...fixture.admitted.effectAttempt,
        reservation: {
          ...fixture.admitted.effectAttempt.reservation,
          maximumCostUsdMicros: 1,
        },
      },
    };
    const resignedAttempt = await resign(changedAttempt, "admissionDigest");
    const changedCampaignBody = {
      ...fixture.campaign,
      hardCapReceipt: {
        ...fixture.campaign.hardCapReceipt,
        remainingUsdMicros: 79_999,
      },
    };
    const resignedCampaign = await resign(
      changedCampaignBody,
      "campaignDigest",
    );
    for (const [campaignValue, admitted] of [
      [fixture.campaign, resignedAttempt],
      [resignedCampaign, fixture.admitted],
    ] as const) {
      const result = await executeM9b6AdmittedRequest({
        campaign: campaignValue,
        hardCapToken: fixture.hardCapToken,
        scientificEnvelopeToken: fixture.scientificEnvelopeToken,
        admittedRequest: admitted,
        persistence: memoryLedger().persistence,
        createSession: session({
          sessions: 0,
          transports: 0,
        }),
        nowMs: NOW,
      });
      expect(result.ok).toBe(false);
    }

    const memory = memoryLedger();
    unwrap(
      await execute(
        fixture,
        memory.persistence,
        session({ sessions: 0, transports: 0 }),
      ),
    );
    const content = memory.content();
    if (content === undefined) throw new Error("missing ledger");
    memory.replace(content.replace(/"index":0/u, '"index":1'));
    const result = await execute(
      fixture,
      memory.persistence,
      session({ sessions: 0, transports: 0 }),
    );
    expect(result.ok).toBe(false);
  });

  it("provides exact zero-effect resume after valid settlement", async () => {
    const fixture = await setup();
    const memory = memoryLedger();
    const counters = { sessions: 0, transports: 0 };
    unwrap(await execute(fixture, memory.persistence, session(counters)));
    const resumed = unwrap(
      await verifyM9b6ZeroEffectResume({
        campaign: fixture.campaign,
        hardCapToken: fixture.hardCapToken,
        scientificEnvelopeToken: fixture.scientificEnvelopeToken,
        admittedRequest: fixture.admitted,
        persistence: memory.persistence,
        createSession: session(counters),
        nowMs: NOW,
      }),
    );
    expect(resumed).toMatchObject({ resumed: true, transportInvoked: false });
    expect(counters).toEqual({ sessions: 1, transports: 1 });
  });

  it("allows at most one concurrent invocation and freezes zero retries", async () => {
    const fixture = await setup();
    expect(fixture.campaign).toMatchObject({
      maximumConcurrency: 1,
      automaticRetryLimit: 0,
    });
    const memory = memoryLedger();
    const counters = { sessions: 0, transports: 0 };
    const results = await Promise.all([
      execute(fixture, memory.persistence, session(counters)),
      execute(fixture, memory.persistence, session(counters)),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(counters.transports).toBe(1);
  });

  it("rejects old M9b.4, M9b.5, and M9b.6 wire identities", async () => {
    const fixture = await setup();
    const oldVector = {
      ...fixture.admitted.vector,
      version: "1.1.0",
    };
    const oldAttempt = {
      ...fixture.admitted,
      effectAttempt: {
        ...fixture.admitted.effectAttempt,
        protocol: "lachesis-m9b4-effect-attempt/2",
      },
    };
    const oldCampaign = { ...fixture.campaign, version: "0.9.0" };
    for (const admittedRequest of [
      { ...fixture.admitted, vector: oldVector },
      oldAttempt,
    ]) {
      const counters = { sessions: 0, transports: 0 };
      const result = await executeM9b6AdmittedRequest({
        campaign: fixture.campaign,
        hardCapToken: fixture.hardCapToken,
        scientificEnvelopeToken: fixture.scientificEnvelopeToken,
        admittedRequest,
        persistence: memoryLedger().persistence,
        createSession: session(counters),
        nowMs: NOW,
      });
      expect(result.ok).toBe(false);
      expect(counters).toEqual({ sessions: 0, transports: 0 });
    }
    expect(m9b6CampaignSchema.safeParse(oldCampaign).success).toBe(false);
    expect(M9B6_CONSERVATIVE_ACCOUNTING_PROTOCOL.decision).toBe(
      "conservative-accounting-go-for-offline-campaign-preparation",
    );
  });
});
