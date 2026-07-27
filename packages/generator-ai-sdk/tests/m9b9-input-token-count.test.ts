import {
  canonicalizeJson,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { prepareM9b2DevelopmentSuite } from "../../generator/src/m9b2-measurement.js";
import {
  deriveM9b3HistoricalDevelopmentBaseline,
  type M9b3Preparation,
  type M9b3PreparationInput,
  type M9b3ProviderProfileInput,
  prepareM9b3OfflineStudy,
} from "../../generator/src/m9b3-preparation.js";
import { M9B2_PUBLIC_DEVELOPMENT_CASES } from "../../generator/tests/fixtures/m9b2-development.js";
import { M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS } from "../../generator/tests/fixtures/m9b2-hidden.js";
import {
  acceptM9b6OfflineHardCapObservation,
  type M9b6VerifiedHardCapToken,
} from "../internal/m9b6-conservative-accounting.js";
import {
  type M9b7ModelLimits,
  prepareM9b7CampaignCapacityReview,
} from "../internal/m9b7-campaign-capacity.js";
import {
  type M9b8ProspectiveRedesignReport,
  type M9b8ProspectiveRedesignToken,
  prepareM9b8ProspectiveRedesign,
} from "../internal/m9b8-prospective-redesign.js";
import {
  dispatchM9b9InputTokenCount,
  executeM9b9LiveLifecycle,
  executeM9b9OfflineLifecycle,
  M9B9_INPUT_TOKEN_COUNT_PROTOCOL,
  type M9b9CapacityReport,
  type M9b9CapacityToken,
  type M9b9CountAdapterSettings,
  type M9b9CountReceipt,
  type M9b9IdentityProfile,
  type M9b9LedgerStore,
  type M9b9LifecycleLedger,
  prepareM9b9CapacityReview,
  prepareM9b9RequestBinding,
  recordM9b9PrerecordedInputTokenCount,
  reserveM9b9Inference,
  settleM9b9Inference,
  verifyM9b9CapacityReview,
  verifyM9b9CountReceipt,
  verifyM9b9RequestBinding,
} from "../internal/m9b9-input-token-count.js";
import * as aiSdkFacade from "../src/index.js";
import type { M9b5IdentityProfile } from "../src/m9b5-openai-responses.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function digest(character: string): string {
  return character.repeat(64);
}

const PROVIDER = Object.freeze({
  id: "offline.openai-responses",
  version: "2026-07-27",
  artifactDigest: digest("1"),
});
const MODEL = Object.freeze({
  id: "gpt-5.6-terra",
  version: "gpt-5.6-terra",
  artifactDigest: digest("2"),
  providerId: PROVIDER.id,
});
const PROJECT = Object.freeze({
  id: "offline-capacity-project",
  version: "1",
  artifactDigest: digest("3"),
  providerId: PROVIDER.id,
});
const CAP_VERIFIER = Object.freeze({
  id: "offline-capacity-verifier",
  version: "1",
  artifactDigest: digest("4"),
});
const NOW = 10_000;

function m9b5Identities(): M9b5IdentityProfile {
  return {
    provider: PROVIDER,
    model: MODEL,
    tokenizer: {
      id: "offline-reviewed-tokenizer-boundary",
      version: "2026-07-26",
      artifactDigest: digest("6"),
      providerId: PROVIDER.id,
    },
    pricingSnapshot: {
      id: "openai-terra-pricing-snapshot",
      version: "2026-07-26",
      artifactDigest: digest("7"),
      providerId: PROVIDER.id,
      inputUsdMicrosPerMillionTokens: 1_000_000,
      cachedInputUsdMicrosPerMillionTokens: 250_000,
      cacheWriteInputUsdMicrosPerMillionTokens: 1_250_000,
      outputUsdMicrosPerMillionTokens: 2_000_000,
      reasoningUsdMicrosPerMillionTokens: 0,
      longContextThresholdTokens: 272_000,
      longContextInputMultiplierMicros: 2_000_000,
      longContextOutputMultiplierMicros: 1_500_000,
    },
    serializer: {
      id: "ai-sdk-openai-responses-canonical-intercept",
      version: "4.0.15/1",
      artifactDigest: digest("8"),
      providerId: PROVIDER.id,
    },
  };
}

function identities(): M9b9IdentityProfile {
  return {
    provider: PROVIDER,
    model: MODEL,
    serializer: {
      id: "direct-fetch-responses-input-token-count",
      version: "openapi-2.3.0/1",
      artifactDigest: digest("8"),
      providerId: PROVIDER.id,
    },
    modelLimits: {
      id: "gpt-5.6-terra-limits",
      version: "2026-07-27",
      artifactDigest: digest("5"),
    },
    pricing: {
      id: "openai-gpt-5.6-terra-standard-pricing",
      version: "2026-07-27",
      artifactDigest: digest("7"),
      providerId: PROVIDER.id,
      uncachedInputUsdMicrosPerMillionTokens: 2_500_000,
      cachedReadUsdMicrosPerMillionTokens: 250_000,
      cacheWriteUsdMicrosPerMillionTokens: 3_125_000,
      outputUsdMicrosPerMillionTokens: 15_000_000,
      reasoningUsdMicrosPerMillionTokens: 0,
      longContextThresholdTokens: 272_000,
      longContextInputMultiplierMicros: 2_000_000,
      longContextOutputMultiplierMicros: 1_500_000,
    },
    officialDocumentation: {
      id: "openai-token-count-model-pricing-docs",
      version: "openapi-2.3.0/2026-07-27",
      artifactDigest: digest("d"),
    },
    pinnedSdkSource: {
      id: "@ai-sdk/openai",
      version: "4.0.15",
      artifactDigest:
        "a543dc8f867af10291594fe151b98ec6e91dbede39e174fb6822d79a26771bc4",
    },
  };
}

function providerProfile(): M9b3ProviderProfileInput {
  return {
    provider: { id: PROVIDER.id, version: PROVIDER.version },
    requestProtocol: {
      providerId: PROVIDER.id,
      id: "offline.openai-responses.protocol",
      version: "2026-07-26",
    },
    requestSerializer: {
      providerId: PROVIDER.id,
      requestProtocolId: "offline.openai-responses.protocol",
      id: "ai-sdk-openai-responses-canonical-intercept",
      version: "4.0.15/1",
      schemaDigest: digest("9"),
    },
    model: {
      providerId: PROVIDER.id,
      id: MODEL.id,
      revision: MODEL.version,
      contextWindowTokens: 1_050_000,
      maximumOutputTokens: 128_000,
      reasoningMode: "disabled",
    },
    tokenizer: {
      providerId: PROVIDER.id,
      modelId: MODEL.id,
      id: "offline-reviewed-tokenizer-boundary",
      version: "2026-07-26",
      artifactDigest: digest("6"),
      conformanceVectorDigest: digest("a"),
      countsExactSerializedRequests: true,
      countsExactSerializedResponses: true,
    },
    pricing: {
      providerId: PROVIDER.id,
      modelId: MODEL.id,
      currency: "USD",
      inputUsdMicrosPerMillionTokens: 1_000_000,
      outputUsdMicrosPerMillionTokens: 2_000_000,
      reasoningUsdMicrosPerMillionTokens: 0,
      snapshotId: "openai-terra-pricing-snapshot",
      sourceDigest: digest("b"),
    },
  };
}

const MODEL_LIMITS: M9b7ModelLimits = Object.freeze({
  model: MODEL,
  limitsArtifact: {
    id: "gpt-5.6-terra-limits",
    version: "2026-07-26",
    artifactDigest: digest("5"),
  },
  maximumInputTokens: 922_000,
  maximumOutputTokens: 128_000,
  contextWindowTokens: 1_050_000,
  reservationBasis:
    "full-provider-model-input-maximum-including-unknown-framing",
});

let preparedM9b3Promise:
  | Promise<
      Readonly<{ input: M9b3PreparationInput; preparation: M9b3Preparation }>
    >
  | undefined;

async function preparedM9b3(): Promise<
  Readonly<{ input: M9b3PreparationInput; preparation: M9b3Preparation }>
> {
  preparedM9b3Promise ??= (async () => {
    const development = unwrap(
      await prepareM9b2DevelopmentSuite({
        publicCases: M9B2_PUBLIC_DEVELOPMENT_CASES,
        hiddenExpectations: M9B2_HIDDEN_DEVELOPMENT_EXPECTATIONS,
      }),
    );
    const input: M9b3PreparationInput = {
      providerProfile: providerProfile(),
      promptBundleDigest: digest("c"),
      scheduleSeedCommitment: digest("d"),
      historicalDevelopmentBaseline: unwrap(
        await deriveM9b3HistoricalDevelopmentBaseline(development),
      ),
    };
    return { input, preparation: unwrap(await prepareM9b3OfflineStudy(input)) };
  })();
  return preparedM9b3Promise;
}

async function cap(): Promise<M9b6VerifiedHardCapToken> {
  const observation = {
    protocol: "lachesis-m9b6-offline-hard-cap-observation/1",
    provider: PROVIDER,
    project: PROJECT,
    control: "hard",
    currency: "USD",
    hardCapUsdMicros: 4_000_000_000,
    trackedSpendUsdMicros: 0,
    remainingUsdMicros: 4_000_000_000,
    observedAtMs: NOW - 100,
    expiresAtMs: NOW + 1_000,
    enforcement: {
      atLimit: "429-insufficient_quota",
      propagation: "not-instantaneous",
      documentedOvershootBound: "unknown",
    },
  } as const;
  return unwrap(
    await acceptM9b6OfflineHardCapObservation({
      canonicalObservationBytes: unwrap(canonicalizeJson(observation)),
      expectedProvider: PROVIDER,
      expectedProject: PROJECT,
      expectedCurrency: "USD",
      verificationArtifact: CAP_VERIFIER,
      nowMs: NOW,
    }),
  ).token;
}

type Fixture = Readonly<{
  m9b8Report: M9b8ProspectiveRedesignReport;
  m9b8Token: M9b8ProspectiveRedesignToken;
  capacityReport: M9b9CapacityReport;
  capacityToken: M9b9CapacityToken;
}>;
let fixturePromise: Promise<Fixture> | undefined;

async function fixture(): Promise<Fixture> {
  fixturePromise ??= (async () => {
    const prepared = await preparedM9b3();
    const m9b7 = unwrap(
      await prepareM9b7CampaignCapacityReview({
        preparationInput: prepared.input,
        preparation: prepared.preparation,
        adapterIdentities: m9b5Identities(),
        modelLimits: MODEL_LIMITS,
        hardCapToken: await cap(),
      }),
    );
    const m9b8 = unwrap(
      await prepareM9b8ProspectiveRedesign({
        m9b7Token: m9b7.token,
        m9b7Report: m9b7.report,
      }),
    );
    const m9b9 = unwrap(
      await prepareM9b9CapacityReview({
        m9b8Token: m9b8.token,
        m9b8Report: m9b8.report,
        identities: identities(),
      }),
    );
    return {
      m9b8Report: m9b8.report,
      m9b8Token: m9b8.token,
      capacityReport: m9b9.report,
      capacityToken: m9b9.token,
    };
  })();
  return fixturePromise;
}

const CLASS_COORDINATES = Object.freeze({
  "root-program-authoring": {
    arm: "discovered-program" as const,
    phase: "authoring" as const,
    maximumOutputTokens: 65_536,
  },
  "static-one-shot-query-planning": {
    arm: "static-one-shot" as const,
    phase: "authoring" as const,
    maximumOutputTokens: 65_536,
  },
  "discovered-program-leaf-reasoning": {
    arm: "discovered-program" as const,
    phase: "grounded-answer" as const,
    maximumOutputTokens: 20_480,
  },
  "static-answer-generation": {
    arm: "static-one-shot" as const,
    phase: "grounded-answer" as const,
    maximumOutputTokens: 20_480,
  },
});

async function binding(
  requestClass: keyof typeof CLASS_COORDINATES = "root-program-authoring",
) {
  const coordinate = CLASS_COORDINATES[requestClass];
  const hostileSchema = unwrap(
    parseJson(
      '{"__proto__":{"type":"string"},"additionalProperties":false,"properties":{"answer":{"description":"é🙂","type":"string"}},"required":["answer"],"type":"object"}',
    ),
  );
  return unwrap(
    await prepareM9b9RequestBinding({
      requestClass,
      comparisonDigest: digest("c"),
      scheduleDigest: digest("e"),
      population: "probe",
      pairId: "lookup-1x-001",
      arm: coordinate.arm,
      phase: coordinate.phase,
      callIndex: 0,
      instructions: 'Frozen instructions é🙂\\n"\\',
      input: [
        { role: "user", content: [{ type: "input_text", text: "task" }] },
      ],
      tools: [
        {
          type: "function",
          name: "search_corpus",
          strict: true,
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          },
        },
      ],
      structuredOutputSchema: hostileSchema,
      maximumOutputTokens: coordinate.maximumOutputTokens,
      identities: identities(),
    }),
  );
}

function countSettings(
  handler: M9b9CountAdapterSettings["interceptedFetch"],
  timeoutMs = 1_000,
): M9b9CountAdapterSettings {
  return {
    mode: "intercepted-offline",
    interceptedFetch: handler,
    baseUrl: "https://api.openai.com/v1",
    timeoutMs,
  };
}

function emptyInference(): Promise<Readonly<{ usage: null }>> {
  return Promise.resolve({ usage: null });
}

async function receiptFor(
  requestInput?: Awaited<ReturnType<typeof binding>>,
  inputTokens = 65_536,
): Promise<M9b9CountReceipt> {
  const request = requestInput ?? (await binding());
  return unwrap(
    await recordM9b9PrerecordedInputTokenCount(request, {
      object: "response.input_tokens",
      input_tokens: inputTokens,
    }),
  );
}

class MemoryStore implements M9b9LedgerStore {
  readonly records = new Map<string, M9b9LifecycleLedger>();
  saves = 0;
  failAtSave: number | undefined;

  load(attemptId: string): Promise<M9b9LifecycleLedger | undefined> {
    return Promise.resolve(this.records.get(attemptId));
  }

  compareAndSwap(
    attemptId: string,
    expectedLedgerDigest: string | null,
    next: M9b9LifecycleLedger,
  ): Promise<boolean> {
    this.saves += 1;
    if (this.saves === this.failAtSave) return Promise.resolve(false);
    const current = this.records.get(attemptId);
    if ((current?.ledgerDigest ?? null) !== expectedLedgerDigest)
      return Promise.resolve(false);
    this.records.set(attemptId, next);
    return Promise.resolve(true);
  }
}

async function resign(
  value: Readonly<Record<string, unknown>>,
  digestField: string,
): Promise<Readonly<Record<string, unknown>>> {
  const body = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== digestField),
  );
  return { ...body, [digestField]: unwrap(await digestValue(body)) };
}

describe("M9b.9 offline Responses input-token count boundary", () => {
  it("rejects the verified NO-GO report before persistence or either transport", async () => {
    const request = await binding();
    const current = await fixture();
    const store = new MemoryStore();
    let countCalls = 0;
    let inferenceCalls = 0;
    const hostileInput = {
      binding: request,
      capacityToken: current.capacityToken,
      capacityReport: current.capacityReport,
      prerecordedCount: null,
      prerecordedInferenceUsage: null,
      availableCampaignUsdMicros: Number.MAX_SAFE_INTEGER,
      store,
      countAdapter: countSettings(() => {
        countCalls += 1;
        return Promise.resolve(new Response("{}"));
      }),
      inferenceTransport: () => {
        inferenceCalls += 1;
        return emptyInference();
      },
      controllerId: "authority-hostile-controller",
      resumeAfterCrash: false,
      signal: new AbortController().signal,
    };
    const result = await executeM9b9OfflineLifecycle(hostileInput);
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "capacity-rejected",
        receipt: {
          mode: "offline-conformance",
          countEffectPerformed: false,
          inferenceEffectPerformed: false,
          credentialAccessed: false,
          networkAccessed: false,
          dispatchStatePersisted: false,
        },
      },
    });
    expect({ saves: store.saves, countCalls, inferenceCalls }).toEqual({
      saves: 0,
      countCalls: 0,
      inferenceCalls: 0,
    });
  });

  it("requires an unavailable positive authority before every live transport callback", async () => {
    const request = await binding();
    const current = await fixture();
    const store = new MemoryStore();
    let countCalls = 0;
    let inferenceCalls = 0;
    const result = await executeM9b9LiveLifecycle({
      binding: request,
      capacityToken: current.capacityToken,
      capacityReport: current.capacityReport,
      availableCampaignUsdMicros: Number.MAX_SAFE_INTEGER,
      store,
      countAdapter: countSettings(() => {
        countCalls += 1;
        return Promise.resolve(new Response("{}"));
      }),
      inferenceTransport: () => {
        inferenceCalls += 1;
        return emptyInference();
      },
      controllerId: "unauthorized-live-controller",
      resumeAfterCrash: false,
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "capacity-rejected" },
    });
    expect({ saves: store.saves, countCalls, inferenceCalls }).toEqual({
      saves: 0,
      countCalls: 0,
      inferenceCalls: 0,
    });
  });

  it("keeps every M9b.9 seam private", () => {
    expect("M9B9_INPUT_TOKEN_COUNT_PROTOCOL" in aiSdkFacade).toBe(false);
    expect("prepareM9b9RequestBinding" in aiSdkFacade).toBe(false);
    expect("executeM9b9OfflineLifecycle" in aiSdkFacade).toBe(false);
  });

  it("freezes a pricing-unknown NO-GO and exact HTTP/model ceilings", async () => {
    const current = await fixture();
    expect(current.capacityReport).toMatchObject({
      protocol: M9B9_INPUT_TOKEN_COUNT_PROTOCOL.id,
      version: "1.0.0",
      decision: "token-count-pricing-unknown-no-go",
      sourceContract: {
        endpointBillingStatus: "not-specified-by-pinned-primary-sources",
        pinnedSdkHasCountOperation: false,
      },
      totals: {
        campaign: {
          countEndpointCalls: 768,
          inferenceCalls: 768,
          providerHttpRequests: 1_536,
          modelCalls: 768,
        },
      },
      fullCompleteStudyCapacityPasses: false,
    });
    expect(
      unwrap(
        await verifyM9b9CapacityReview(
          current.capacityToken,
          current.capacityReport,
        ),
      ),
    ).toEqual(current.capacityReport);
  });

  it("binds all four request classes to one count/inference source", async () => {
    for (const requestClass of Object.keys(CLASS_COORDINATES)) {
      const prepared = await binding(
        requestClass as keyof typeof CLASS_COORDINATES,
      );
      expect(prepared.countRequestBytes).toBe(prepared.inferenceRequestBytes);
      expect(prepared.countRequestDigest).toBe(prepared.inferenceRequestDigest);
      expect(prepared.providerRequest).toMatchObject({
        model: "gpt-5.6-terra",
        reasoning: { effort: "none" },
        text: { format: { type: "json_schema", strict: true } },
        tools: [expect.objectContaining({ name: "search_corpus" })],
      });
      expect(unwrap(await verifyM9b9RequestBinding(prepared))).toEqual(
        prepared,
      );
    }
  });

  it("retains Unicode, escapes, structured schemas, tools, and hostile keys", async () => {
    const prepared = await binding();
    expect(prepared.inferenceRequestBytes).toContain("é🙂");
    expect(prepared.inferenceRequestBytes).toContain("__proto__");
    expect(prepared.inferenceRequestBytes).toContain("search_corpus");
    expect(prepared.inferenceRequestBytes).toContain("json_schema");
  });

  it("maps an official-shaped prerecorded count result without transport", async () => {
    const prepared = await binding();
    const receipt = unwrap(
      await recordM9b9PrerecordedInputTokenCount(prepared, {
        object: "response.input_tokens",
        input_tokens: 123,
      }),
    );
    expect(receipt).toMatchObject({
      inputTokens: 123,
      modelCalls: 0,
      inferenceRequests: 0,
    });
  });

  it("rejects mutation between count and inference even when re-signed", async () => {
    const prepared = await binding();
    const mutated = await resign(
      {
        ...prepared,
        inferenceRequestBytes: `${prepared.inferenceRequestBytes} `,
      },
      "bindingDigest",
    );
    expect((await verifyM9b9RequestBinding(mutated)).ok).toBe(false);
  });

  it("rejects wrong response identities and invalid token counts", async () => {
    const prepared = await binding();
    const invalidResponses: ReadonlyArray<unknown> = [
      { object: "response", input_tokens: 1 },
      { object: "response.input_tokens" },
      { object: "response.input_tokens", input_tokens: -1 },
      { object: "response.input_tokens", input_tokens: 1.5 },
      {
        object: "response.input_tokens",
        input_tokens: Number.MAX_SAFE_INTEGER + 1,
      },
      { object: "response.input_tokens", input_tokens: 922_001 },
    ];
    for (const response of invalidResponses) {
      expect(
        (await recordM9b9PrerecordedInputTokenCount(prepared, response)).ok,
      ).toBe(false);
    }
  });

  it("gates direct count dispatch before callback access", async () => {
    const prepared = await binding();
    let fetches = 0;
    const outcome = await dispatchM9b9InputTokenCount(
      prepared,
      countSettings(() => {
        fetches += 1;
        return Promise.resolve(new Response("{}"));
      }),
      new AbortController().signal,
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: { kind: "capacity-rejected" },
    });
    expect(fetches).toBe(0);
  });

  it("binds and rederives count receipts against request and model identity", async () => {
    const prepared = await binding();
    const receipt = await receiptFor(prepared);
    expect(unwrap(await verifyM9b9CountReceipt(prepared, receipt))).toEqual(
      receipt,
    );
    const altered = await resign(
      { ...receipt, bindingDigest: digest("f") },
      "receiptDigest",
    );
    expect((await verifyM9b9CountReceipt(prepared, altered)).ok).toBe(false);
  });

  it("uses the highest cache-write class and exact long-context boundary", async () => {
    const prepared = await binding();
    const short = unwrap(
      await reserveM9b9Inference(prepared, await receiptFor(prepared, 272_000)),
    );
    const long = unwrap(
      await reserveM9b9Inference(prepared, await receiptFor(prepared, 272_001)),
    );
    expect(short).toMatchObject({
      longContext: false,
      inputRateUsdMicrosPerMillionTokens: 3_125_000,
    });
    expect(long).toMatchObject({
      longContext: true,
      longContextInputMultiplierMicros: 2_000_000,
      longContextOutputMultiplierMicros: 1_500_000,
    });
    expect(long.maximumCostUsdMicros).toBeGreaterThan(
      short.maximumCostUsdMicros,
    );
  });

  it("reconciles usage equal to, below, and above the count", async () => {
    const prepared = await binding();
    const receipt = await receiptFor(prepared, 100);
    const reservation = unwrap(await reserveM9b9Inference(prepared, receipt));
    const usage = {
      cachedReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 10,
      reasoningTokens: 0,
    };
    const equal = unwrap(
      await settleM9b9Inference(prepared, receipt, reservation, {
        ...usage,
        inputTokens: 100,
      }),
    );
    const below = unwrap(
      await settleM9b9Inference(prepared, receipt, reservation, {
        ...usage,
        inputTokens: 99,
      }),
    );
    const above = unwrap(
      await settleM9b9Inference(prepared, receipt, reservation, {
        ...usage,
        inputTokens: 101,
      }),
    );
    expect(equal).toMatchObject({
      relationship: "equal",
      outcome: "completed",
    });
    expect(below).toMatchObject({
      countedInputTokens: 100,
      relationship: "provider-lower",
      outcome: "completed",
    });
    expect(above).toMatchObject({
      relationship: "provider-higher",
      outcome: "accounting-overage",
      progressionHalted: true,
      redispatchPermitted: false,
    });
  });

  it("retains the full inference reservation when usage is missing", async () => {
    const prepared = await binding();
    const receipt = await receiptFor(prepared, 100);
    const reservation = unwrap(await reserveM9b9Inference(prepared, receipt));
    const settlement = unwrap(
      await settleM9b9Inference(prepared, receipt, reservation, null),
    );
    expect(settlement).toMatchObject({
      relationship: "missing",
      outcome: "ambiguous-usage",
      chargedUsdMicros: reservation.maximumCostUsdMicros,
      progressionHalted: true,
    });
  });

  it("rejects tampered reservations and malformed cache classes", async () => {
    const prepared = await binding();
    const receipt = await receiptFor(prepared, 100);
    const reservation = unwrap(await reserveM9b9Inference(prepared, receipt));
    const altered = await resign(
      { ...reservation, maximumCostUsdMicros: 0 },
      "reservationDigest",
    );
    expect(
      (
        await settleM9b9Inference(prepared, receipt, altered, {
          inputTokens: 100,
          cachedReadTokens: 101,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
        })
      ).ok,
    ).toBe(false);
  });

  it("rejects self-consistent capacity mutations and old identities", async () => {
    const current = await fixture();
    const altered = await resign(
      {
        ...current.capacityReport,
        version: "0.8.0",
      },
      "reportDigest",
    );
    expect(
      (await verifyM9b9CapacityReview(current.capacityToken, altered)).ok,
    ).toBe(false);
    expect((await verifyM9b9RequestBinding(current.m9b8Report)).ok).toBe(false);
  });

  it("derives exact capacity totals and keeps the unknown count liability separate", async () => {
    const { capacityReport: report } = await fixture();
    expect(
      report.frozenClassMaxima.map(
        (entry) => entry.frozenCountedInputTokensPerRequest,
      ),
    ).toEqual([65_536, 65_536, 32_768, 32_768]);
    expect(report.totals.campaign).toMatchObject({
      countedInputTokens: 37_748_736,
      maximumOutputTokens: 33_030_144,
      inferenceReservationUsdMicros: 613_416_960,
      unresolvedCountEffectReservationUsdMicros: 4_425_600_000,
      completeExposureUsdMicros: 5_039_016_960,
    });
    expect(report.conditionalInferenceReductionFromM9b8UsdMicros).toBe(
      1_255_913_472,
    );
    expect(report.completeExposureReductionFromM9b8UsdMicros).toBe(
      -3_169_686_528,
    );
    expect(report.completeExposureOverOriginalCapUsdMicros).toBe(4_921_052_160);
  });

  it("property-checks canonical request and receipt tampering", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 64 }),
        async (text) => {
          const coordinate =
            CLASS_COORDINATES["static-one-shot-query-planning"];
          const prepared = unwrap(
            await prepareM9b9RequestBinding({
              requestClass: "static-one-shot-query-planning",
              comparisonDigest: digest("c"),
              scheduleDigest: digest("e"),
              population: "probe",
              pairId: "property-case",
              arm: coordinate.arm,
              phase: coordinate.phase,
              callIndex: 0,
              instructions: "instructions",
              input: text,
              tools: [],
              structuredOutputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
                additionalProperties: false,
              },
              maximumOutputTokens: coordinate.maximumOutputTokens,
              identities: identities(),
            }),
          );
          expect(unwrap(await verifyM9b9RequestBinding(prepared))).toEqual(
            prepared,
          );
        },
      ),
      { numRuns: 50 },
    );
  });
});
