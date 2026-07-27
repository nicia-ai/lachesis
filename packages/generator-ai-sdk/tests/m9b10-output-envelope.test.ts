import { canonicalizeJson, type Result } from "@nicia-ai/lachesis";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { M9A_ONE_SHOT_RAG_SOURCE } from "../../generator/src/m9a-retrieval.js";
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
import { prepareM9b8ProspectiveRedesign } from "../internal/m9b8-prospective-redesign.js";
import {
  type M9b9CapacityReport,
  type M9b9CapacityToken,
  type M9b9IdentityProfile,
  prepareM9b9CapacityReview,
} from "../internal/m9b9-input-token-count.js";
import {
  assessM9b10OfflineResponse,
  M9B10_OUTPUT_ENVELOPE_PROTOCOL,
  type M9b10OutputEnvelopeReport,
  type M9b10OutputEnvelopeToken,
  prepareM9b10OutputEnvelopeReview,
  verifyM9b10OfflineResponseReceipt,
  verifyM9b10OutputEnvelopeReview,
} from "../internal/m9b10-output-envelope.js";
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

function m9b9Identities(): M9b9IdentityProfile {
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
  m9b9Report: M9b9CapacityReport;
  m9b9Token: M9b9CapacityToken;
  report: M9b10OutputEnvelopeReport;
  token: M9b10OutputEnvelopeToken;
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
        identities: m9b9Identities(),
      }),
    );
    const m9b10 = unwrap(
      await prepareM9b10OutputEnvelopeReview({
        m9b9Token: m9b9.token,
        m9b9Report: m9b9.report,
      }),
    );
    return {
      m9b9Report: m9b9.report,
      m9b9Token: m9b9.token,
      report: m9b10.report,
      token: m9b10.token,
    };
  })();
  return fixturePromise;
}

function canonical(value: unknown): string {
  return unwrap(canonicalizeJson(value));
}

function responseInput(
  requestClass:
    | "root-program-authoring"
    | "static-one-shot-query-planning"
    | "discovered-program-leaf-reasoning"
    | "static-answer-generation",
  rawResponseBytes: string,
) {
  return {
    designId: "prospective-moderate-class-specific" as const,
    requestClass,
    rawResponseBytes,
    usage: {
      outputTokens: 10_000,
      reasoningTokens: 1_000,
      visibleStructuredOutputTokens: 5_000,
    },
    finishReason: "stop" as const,
  };
}

const boundedFixSource = `export default async function main(input, ops) {
  const questions = await ops.invoke("decompose-query@1.0.0", input.task);
  const state = await ops.invoke("prepare-retrieval-state@1.0.0", questions);
  const refined = await ops.boundedFix("refine-next-query@1.0.0", "remaining-retrieval-queries@1.0.0", state, 4);
  const queries = await ops.invoke("take-refined-queries@1.0.0", refined);
  const searches = await ops.map("search-corpus@1.0.0", queries);
  const evidence = await ops.map("read-search-results@1.0.0", searches);
  const partials = await ops.map("answer-evidence-slice@1.0.0", evidence);
  const answer = await ops.fold("synthesize-citation-confined-answer@1.0.0", partials);
  const submitted = await ops.invoke("submit-citation-confined-answer@1.0.0", answer);
  return submitted;
}`;

describe("M9b.10 offline output envelope review", () => {
  it("rederives all three frozen designs and the residual-capacity NO-GO", async () => {
    const value = await fixture();
    expect(value.report.protocol).toBe(M9B10_OUTPUT_ENVELOPE_PROTOCOL.id);
    expect(value.report.decision).toBe("campaign-capacity-remains-no-go");
    expect(value.report.dominance.acceptedM9b9OutputReservationUsdMicros).toBe(
      495_452_160,
    );
    expect(
      value.report.dominance.residualCapacityAfterInputAtOriginalCapUsdMicros,
    ).toBe(0);
    expect(
      value.report.designs.map(
        (design) => design.totals.campaign.inferenceReservationUsdMicros,
      ),
    ).toEqual([613_416_960, 342_097_920, 289_013_760]);
    expect(
      value.report.designs.map(
        (design) => design.totals.campaign.completeExposureUsdMicros,
      ),
    ).toEqual([5_039_016_960, 4_767_697_920, 4_714_613_760]);
    expect(
      value.report.designs.map(
        (design) => design.developmentConformance.observedTruncations,
      ),
    ).toEqual([0, 0, 2]);
  });

  it("verifies exact zero-effect replay and remains absent from the facade", async () => {
    const value = await fixture();
    expect(
      unwrap(await verifyM9b10OutputEnvelopeReview(value.token, value.report)),
    ).toEqual(value.report);
    expect("prepareM9b10OutputEnvelopeReview" in aiSdkFacade).toBe(false);
  });

  it.each([
    [
      "output cap",
      (report: M9b10OutputEnvelopeReport) => {
        const design = report.designs.at(1);
        const envelope = design?.classEnvelopes.at(0);
        if (envelope !== undefined)
          Object.assign(envelope, {
            maximumOutputTokens: 40_961,
          });
      },
    ],
    [
      "arm-specific cap",
      (report: M9b10OutputEnvelopeReport) => {
        const design = report.designs.at(1);
        const envelope = design?.classEnvelopes.at(3);
        if (envelope !== undefined)
          Object.assign(envelope, {
            maximumOutputTokens: 16_385,
          });
      },
    ],
    [
      "model/pricing binding",
      (report: M9b10OutputEnvelopeReport) => {
        Object.assign(report.pricing, {
          outputUsdMicrosPerMillionTokens: 1,
        });
      },
    ],
    [
      "reasoning mode",
      (report: M9b10OutputEnvelopeReport) => {
        const design = report.designs.at(1);
        if (design !== undefined)
          Object.assign(design.scientificBoundary, {
            matchedModelAndReasoningModeAcrossArms: false,
          });
      },
    ],
    [
      "population",
      (report: M9b10OutputEnvelopeReport) => {
        Object.assign(report.population, { primaryPairs: 167 });
      },
    ],
    [
      "schedule/inherited identity",
      (report: M9b10OutputEnvelopeReport) => {
        Object.assign(report.inheritedM9b9, { reportDigest: digest("0") });
      },
    ],
    [
      "post-outcome enlargement",
      (report: M9b10OutputEnvelopeReport) => {
        const design = report.designs.at(2);
        if (design !== undefined)
          Object.assign(design.firstAttemptPolicy, {
            postHocCeilingIncreasePermitted: true,
          });
      },
    ],
  ])("rejects self-consistent-looking %s mutation", async (_name, mutate) => {
    const value = await fixture();
    const altered = structuredClone(value.report);
    mutate(altered);
    Object.assign(altered, { reportDigest: digest("f") });
    expect(
      (await verifyM9b10OutputEnvelopeReview(value.token, altered)).ok,
    ).toBe(false);
  });

  it("does not reinterpret the prior artifact under the new identity", async () => {
    const value = await fixture();
    expect(
      (await verifyM9b10OutputEnvelopeReview(value.token, value.m9b9Report)).ok,
    ).toBe(false);
  });

  it("accepts a maximum-byte valid closed program and exact max depth", async () => {
    const padding = 14_400 - new TextEncoder().encode(boundedFixSource).length;
    const source = `${boundedFixSource}${" ".repeat(padding)}`;
    expect(new TextEncoder().encode(source)).toHaveLength(14_400);
    const receipt = unwrap(
      await assessM9b10OfflineResponse(
        responseInput("root-program-authoring", canonical({ source })),
      ),
    );
    expect(receipt.outcome).toBe("accepted");
  });

  it("rejects a program one byte over and a boundedFix beyond depth four", async () => {
    const padding = 14_401 - new TextEncoder().encode(boundedFixSource).length;
    const oversized = unwrap(
      await assessM9b10OfflineResponse(
        responseInput(
          "root-program-authoring",
          canonical({ source: `${boundedFixSource}${" ".repeat(padding)}` }),
        ),
      ),
    );
    expect(oversized.outcome).toBe("first-attempt-failure");
    expect(oversized.failureReasons).toContain(
      "schema-or-structural-bound-rejected",
    );
    const excessiveDepth = unwrap(
      await assessM9b10OfflineResponse(
        responseInput(
          "root-program-authoring",
          canonical({
            source: boundedFixSource.replace("state, 4", "state, 5"),
          }),
        ),
      ),
    );
    expect(excessiveDepth.failureReasons).toContain(
      "closed-ast-compilation-rejected",
    );
  });

  it("rejects oversized queries and hidden prose around JSON", async () => {
    const oversized = unwrap(
      await assessM9b10OfflineResponse(
        responseInput(
          "static-one-shot-query-planning",
          canonical({ query: "q".repeat(513) }),
        ),
      ),
    );
    expect(oversized.outcome).toBe("first-attempt-failure");
    const prose = unwrap(
      await assessM9b10OfflineResponse(
        responseInput(
          "static-one-shot-query-planning",
          `answer: ${canonical({ query: "bounded query" })}`,
        ),
      ),
    );
    expect(prose.failureReasons).toContain("noncanonical-or-malformed-json");
  });

  it("accepts maximum grounded answer cardinalities and typed abstention", async () => {
    const answer = {
      kind: "answer",
      answerValues: Array.from(
        { length: 8 },
        (_, index) => `${index}${"a".repeat(255)}`,
      ),
      supportingFactIds: Array.from(
        { length: 16 },
        (_, index) => `fact-${index}`,
      ),
      citationIds: Array.from({ length: 16 }, (_, index) => `chunk-${index}`),
    };
    const accepted = unwrap(
      await assessM9b10OfflineResponse(
        responseInput("discovered-program-leaf-reasoning", canonical(answer)),
      ),
    );
    expect(accepted.outcome).toBe("accepted");
    const abstention = unwrap(
      await assessM9b10OfflineResponse({
        ...responseInput(
          "static-answer-generation",
          canonical({
            kind: "insufficient-evidence",
            reason: "corpus-does-not-support-answer",
            supportingFactIds: [],
            citationIds: [],
          }),
        ),
        usage: {
          outputTokens: 1_000,
          reasoningTokens: 100,
          visibleStructuredOutputTokens: 500,
        },
      }),
    );
    expect(abstention.outcome).toBe("accepted");
  });

  it.each([
    [
      "answer values",
      {
        kind: "answer",
        answerValues: Array.from({ length: 9 }, () => "value"),
        supportingFactIds: ["fact"],
        citationIds: ["chunk"],
      },
    ],
    [
      "supporting facts",
      {
        kind: "answer",
        answerValues: ["value"],
        supportingFactIds: Array.from(
          { length: 17 },
          (_, index) => `fact-${index}`,
        ),
        citationIds: ["chunk"],
      },
    ],
    [
      "citations",
      {
        kind: "answer",
        answerValues: ["value"],
        supportingFactIds: ["fact"],
        citationIds: Array.from({ length: 17 }, (_, index) => `chunk-${index}`),
      },
    ],
  ])("rejects excess grounded %s", async (_name, answer) => {
    const receipt = unwrap(
      await assessM9b10OfflineResponse(
        responseInput("discovered-program-leaf-reasoning", canonical(answer)),
      ),
    );
    expect(receipt.failureReasons).toContain(
      "schema-or-structural-bound-rejected",
    );
  });

  it("charges reasoning inside max output and makes truncation terminal", async () => {
    const raw = canonical({
      kind: "answer",
      answerValues: ["value"],
      supportingFactIds: ["fact"],
      citationIds: ["chunk"],
    });
    const receipt = unwrap(
      await assessM9b10OfflineResponse({
        ...responseInput("static-answer-generation", raw),
        designId: "prospective-aggressive-class-specific",
        usage: {
          outputTokens: 13_000,
          reasoningTokens: 4_000,
          visibleStructuredOutputTokens: 8_192,
        },
        finishReason: "length",
      }),
    );
    expect(receipt.failureReasons).toEqual(
      expect.arrayContaining([
        "output-token-ceiling-exceeded",
        "reasoning-token-ceiling-exceeded",
        "provider-truncated-or-incomplete",
      ]),
    );
    expect(receipt).toMatchObject({
      outcome: "first-attempt-failure",
      retryPermitted: false,
      exclusionPermitted: false,
      replacementPermitted: false,
      ceilingIncreasePermitted: false,
      exactResponseAndUsageRetained: true,
    });
  });

  it("rejects tampered receipts and replays valid failure receipts exactly", async () => {
    const receipt = unwrap(
      await assessM9b10OfflineResponse({
        ...responseInput(
          "static-one-shot-query-planning",
          canonical({ query: "query" }),
        ),
        finishReason: "incomplete",
      }),
    );
    expect(unwrap(await verifyM9b10OfflineResponseReceipt(receipt))).toEqual(
      receipt,
    );
    const altered = structuredClone(receipt);
    Object.assign(altered.usage, { reasoningTokens: 2_000 });
    Object.assign(altered, { receiptDigest: digest("0") });
    expect((await verifyM9b10OfflineResponseReceipt(altered)).ok).toBe(false);
  });

  it("property-checks the static-query UTF-8 boundary", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 520 }), async (length) => {
        const receipt = unwrap(
          await assessM9b10OfflineResponse({
            ...responseInput(
              "static-one-shot-query-planning",
              canonical({ query: "q".repeat(length) }),
            ),
            usage: {
              outputTokens: 1_500,
              reasoningTokens: 100,
              visibleStructuredOutputTokens: 1_000,
            },
          }),
        );
        expect(receipt.outcome === "accepted").toBe(length <= 512);
      }),
      { numRuns: 80 },
    );
  });

  it("retains the accepted M9b.9 source artifact unchanged", async () => {
    const value = await fixture();
    expect(value.m9b9Report.decision).toBe("token-count-pricing-unknown-no-go");
    expect(value.m9b9Report.protocol).toBe(
      "lachesis-m9b9-offline-responses-input-token-count",
    );
  });

  it("accepts the ordinary one-shot source within the moderate envelope", async () => {
    const receipt = unwrap(
      await assessM9b10OfflineResponse(
        responseInput(
          "root-program-authoring",
          canonical({ source: M9A_ONE_SHOT_RAG_SOURCE }),
        ),
      ),
    );
    expect(receipt.outcome).toBe("accepted");
  });
});
