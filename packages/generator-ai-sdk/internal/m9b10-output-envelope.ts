import {
  canonicalizeJson,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  compileM9aRetrievalProgram,
  inspectM9aRetrievalArtifact,
  inspectM9aRetrievalArtifactStructure,
} from "../../generator/src/m9a-retrieval.js";
import {
  type M9b9CapacityReport,
  type M9b9CapacityToken,
  verifyM9b9CapacityReview,
} from "./m9b9-input-token-count.js";

export const M9B10_OUTPUT_ENVELOPE_PROTOCOL = Object.freeze({
  id: "lachesis-m9b10-offline-output-envelope-review",
  version: "1.0.0",
  baselineCommit: "1e03871af204a0de4b9c140e3b71e07ef11cdd92",
  visibility: "private-offline-review-only" as const,
  decision: "campaign-capacity-remains-no-go" as const,
  claimBoundary:
    "offline prospective output-envelope and residual-capacity evidence only; no token-count price resolution, corpus, credential, provider access, preregistration, probe, live execution, or superiority claim",
});

const PROBE_PAIRS = 24;
const PRIMARY_PAIRS = 168;
const CAMPAIGN_PAIRS = PROBE_PAIRS + PRIMARY_PAIRS;
const ORIGINAL_CAP_USD_MICROS = 117_964_800;
const UNRESOLVED_COUNT_EFFECT_USD_MICROS_PER_REQUEST = 5_762_500;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const safeCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const requestClassSchema = z.enum([
  "root-program-authoring",
  "static-one-shot-query-planning",
  "discovered-program-leaf-reasoning",
  "static-answer-generation",
]);
export type M9b10RequestClass = z.infer<typeof requestClassSchema>;
const designIdSchema = z.enum([
  "accepted-m9b9-current",
  "prospective-moderate-class-specific",
  "prospective-aggressive-class-specific",
]);
export type M9b10DesignId = z.infer<typeof designIdSchema>;

const PROGRAM_STRUCTURE = Object.freeze({
  maximumBindings: 14,
  maximumOperationCalls: 64,
  maximumExpressionDepth: 2,
  maximumBoundedFixLimit: 4,
  maximumIdentifierUtf8Bytes: 64,
  maximumReferenceUtf8Bytes: 160,
  maximumCanonicalLiteralUtf8Bytes: 128,
  maximumArgumentsPerOperation: 4,
  fixedWrapperAndSchemaUtf8Bytes: 2_048,
  perBindingUtf8Bytes: 864,
  recursionGrammarUtf8Bytes: 256,
  maximumSourceUtf8Bytes: 14_400,
  canonicalJsonEscapingMultiplier: 2,
  canonicalJsonWrapperUtf8Bytes: 13,
  maximumVisibleStructuredOutputTokens: 28_813,
});

const QUERY_STRUCTURE = Object.freeze({
  maximumQueries: 1,
  maximumQueryUtf8Bytes: 512,
  printableNfcOnly: true,
  canonicalJsonEscapingMultiplier: 2,
  canonicalJsonWrapperUtf8Bytes: 12,
  maximumVisibleStructuredOutputTokens: 1_036,
});

const GROUNDED_STRUCTURE = Object.freeze({
  maximumAnswerValues: 8,
  maximumAnswerValueUtf8Bytes: 256,
  maximumSupportingFactIds: 16,
  maximumCitationIds: 16,
  maximumEvidenceIdUtf8Bytes: 96,
  typedInsufficientEvidenceOutcome: true,
  canonicalSchemaOverheadUtf8Bytes: 512,
  maximumVisibleStructuredOutputTokens: 8_192,
});

const classCoordinate = Object.freeze({
  "root-program-authoring": Object.freeze({
    arm: "discovered-program" as const,
    phase: "authoring" as const,
    inputTokens: 65_536,
    visibleTokens: PROGRAM_STRUCTURE.maximumVisibleStructuredOutputTokens,
  }),
  "static-one-shot-query-planning": Object.freeze({
    arm: "static-one-shot" as const,
    phase: "authoring" as const,
    inputTokens: 65_536,
    visibleTokens: QUERY_STRUCTURE.maximumVisibleStructuredOutputTokens,
  }),
  "discovered-program-leaf-reasoning": Object.freeze({
    arm: "discovered-program" as const,
    phase: "grounded-answer" as const,
    inputTokens: 32_768,
    visibleTokens: GROUNDED_STRUCTURE.maximumVisibleStructuredOutputTokens,
  }),
  "static-answer-generation": Object.freeze({
    arm: "static-one-shot" as const,
    phase: "grounded-answer" as const,
    inputTokens: 32_768,
    visibleTokens: GROUNDED_STRUCTURE.maximumVisibleStructuredOutputTokens,
  }),
});

const outputProfile = Object.freeze({
  "accepted-m9b9-current": Object.freeze({
    "root-program-authoring": Object.freeze({
      maximumOutputTokens: 65_536,
      maximumReasoningTokens: 65_536,
      maximumVisibleStructuredOutputTokens: 65_536,
      formattingHeadroomTokens: 0,
    }),
    "static-one-shot-query-planning": Object.freeze({
      maximumOutputTokens: 65_536,
      maximumReasoningTokens: 65_536,
      maximumVisibleStructuredOutputTokens: 65_536,
      formattingHeadroomTokens: 0,
    }),
    "discovered-program-leaf-reasoning": Object.freeze({
      maximumOutputTokens: 20_480,
      maximumReasoningTokens: 20_480,
      maximumVisibleStructuredOutputTokens: 20_480,
      formattingHeadroomTokens: 0,
    }),
    "static-answer-generation": Object.freeze({
      maximumOutputTokens: 20_480,
      maximumReasoningTokens: 20_480,
      maximumVisibleStructuredOutputTokens: 20_480,
      formattingHeadroomTokens: 0,
    }),
  }),
  "prospective-moderate-class-specific": Object.freeze({
    "root-program-authoring": Object.freeze({
      maximumOutputTokens: 40_960,
      maximumReasoningTokens: 10_099,
      maximumVisibleStructuredOutputTokens:
        PROGRAM_STRUCTURE.maximumVisibleStructuredOutputTokens,
      formattingHeadroomTokens: 2_048,
    }),
    "static-one-shot-query-planning": Object.freeze({
      maximumOutputTokens: 4_096,
      maximumReasoningTokens: 2_048,
      maximumVisibleStructuredOutputTokens:
        QUERY_STRUCTURE.maximumVisibleStructuredOutputTokens,
      formattingHeadroomTokens: 1_012,
    }),
    "discovered-program-leaf-reasoning": Object.freeze({
      maximumOutputTokens: 16_384,
      maximumReasoningTokens: 6_144,
      maximumVisibleStructuredOutputTokens:
        GROUNDED_STRUCTURE.maximumVisibleStructuredOutputTokens,
      formattingHeadroomTokens: 2_048,
    }),
    "static-answer-generation": Object.freeze({
      maximumOutputTokens: 16_384,
      maximumReasoningTokens: 6_144,
      maximumVisibleStructuredOutputTokens:
        GROUNDED_STRUCTURE.maximumVisibleStructuredOutputTokens,
      formattingHeadroomTokens: 2_048,
    }),
  }),
  "prospective-aggressive-class-specific": Object.freeze({
    "root-program-authoring": Object.freeze({
      maximumOutputTokens: 32_768,
      maximumReasoningTokens: 2_931,
      maximumVisibleStructuredOutputTokens:
        PROGRAM_STRUCTURE.maximumVisibleStructuredOutputTokens,
      formattingHeadroomTokens: 1_024,
    }),
    "static-one-shot-query-planning": Object.freeze({
      maximumOutputTokens: 2_048,
      maximumReasoningTokens: 768,
      maximumVisibleStructuredOutputTokens:
        QUERY_STRUCTURE.maximumVisibleStructuredOutputTokens,
      formattingHeadroomTokens: 244,
    }),
    "discovered-program-leaf-reasoning": Object.freeze({
      maximumOutputTokens: 12_288,
      maximumReasoningTokens: 3_072,
      maximumVisibleStructuredOutputTokens:
        GROUNDED_STRUCTURE.maximumVisibleStructuredOutputTokens,
      formattingHeadroomTokens: 1_024,
    }),
    "static-answer-generation": Object.freeze({
      maximumOutputTokens: 12_288,
      maximumReasoningTokens: 3_072,
      maximumVisibleStructuredOutputTokens:
        GROUNDED_STRUCTURE.maximumVisibleStructuredOutputTokens,
      formattingHeadroomTokens: 1_024,
    }),
  }),
});

const developmentUsage = Object.freeze({
  "root-program-authoring": Object.freeze([
    ...Array.from({ length: 23 }, () => 18_000),
    31_000,
  ]),
  "static-one-shot-query-planning": Object.freeze([
    ...Array.from({ length: 23 }, () => 1_200),
    1_900,
  ]),
  "discovered-program-leaf-reasoning": Object.freeze([
    ...Array.from({ length: 23 }, () => 8_800),
    13_000,
  ]),
  "static-answer-generation": Object.freeze([
    ...Array.from({ length: 23 }, () => 8_600),
    13_000,
  ]),
});

const structureSchema = z
  .strictObject({
    program: z.strictObject({
      maximumBindings: z.literal(PROGRAM_STRUCTURE.maximumBindings),
      maximumOperationCalls: z.literal(PROGRAM_STRUCTURE.maximumOperationCalls),
      maximumExpressionDepth: z.literal(
        PROGRAM_STRUCTURE.maximumExpressionDepth,
      ),
      maximumBoundedFixLimit: z.literal(
        PROGRAM_STRUCTURE.maximumBoundedFixLimit,
      ),
      maximumIdentifierUtf8Bytes: z.literal(
        PROGRAM_STRUCTURE.maximumIdentifierUtf8Bytes,
      ),
      maximumReferenceUtf8Bytes: z.literal(
        PROGRAM_STRUCTURE.maximumReferenceUtf8Bytes,
      ),
      maximumCanonicalLiteralUtf8Bytes: z.literal(
        PROGRAM_STRUCTURE.maximumCanonicalLiteralUtf8Bytes,
      ),
      maximumArgumentsPerOperation: z.literal(
        PROGRAM_STRUCTURE.maximumArgumentsPerOperation,
      ),
      fixedWrapperAndSchemaUtf8Bytes: z.literal(
        PROGRAM_STRUCTURE.fixedWrapperAndSchemaUtf8Bytes,
      ),
      perBindingUtf8Bytes: z.literal(PROGRAM_STRUCTURE.perBindingUtf8Bytes),
      recursionGrammarUtf8Bytes: z.literal(
        PROGRAM_STRUCTURE.recursionGrammarUtf8Bytes,
      ),
      maximumSourceUtf8Bytes: z.literal(
        PROGRAM_STRUCTURE.maximumSourceUtf8Bytes,
      ),
      canonicalJsonEscapingMultiplier: z.literal(2),
      canonicalJsonWrapperUtf8Bytes: z.literal(13),
      maximumVisibleStructuredOutputTokens: z.literal(28_813),
    }),
    staticQuery: z.strictObject({
      maximumQueries: z.literal(1),
      maximumQueryUtf8Bytes: z.literal(512),
      printableNfcOnly: z.literal(true),
      canonicalJsonEscapingMultiplier: z.literal(2),
      canonicalJsonWrapperUtf8Bytes: z.literal(12),
      maximumVisibleStructuredOutputTokens: z.literal(1_036),
    }),
    groundedAnswer: z.strictObject({
      maximumAnswerValues: z.literal(8),
      maximumAnswerValueUtf8Bytes: z.literal(256),
      maximumSupportingFactIds: z.literal(16),
      maximumCitationIds: z.literal(16),
      maximumEvidenceIdUtf8Bytes: z.literal(96),
      typedInsufficientEvidenceOutcome: z.literal(true),
      canonicalSchemaOverheadUtf8Bytes: z.literal(512),
      maximumVisibleStructuredOutputTokens: z.literal(8_192),
    }),
    derivation: z.literal(
      "program=2048+(14*864)+(4*64)=14400-source-bytes; canonical-source-output=(14400*2)+13=28813; query=(512*2)+12=1036; grounded=8192-conservative-printable-json-bound",
    ),
    visibleTokenBoundProvenance: z.literal(
      "prospective-controller-allocation-not-exact-tokenizer-proof-provider-truncation-fails",
    ),
  })
  .readonly();

const classEnvelopeSchema = z
  .strictObject({
    requestClass: requestClassSchema,
    arm: z.enum(["discovered-program", "static-one-shot"]),
    phase: z.enum(["authoring", "grounded-answer"]),
    frozenMaximumInputTokens: z.union([z.literal(65_536), z.literal(32_768)]),
    inputBillingClass: z.literal("cache-write-highest-applicable-class"),
    inputUsdMicrosPerMillionTokens: safeCountSchema,
    outputUsdMicrosPerMillionTokens: safeCountSchema,
    inputMultiplierMicros: z.literal(1_000_000),
    outputMultiplierMicros: z.literal(1_000_000),
    maximumOutputTokens: safeCountSchema,
    maximumReasoningTokens: safeCountSchema,
    maximumVisibleStructuredOutputTokens: safeCountSchema,
    formattingHeadroomTokens: safeCountSchema,
    maximumInputReservationUsdMicros: safeCountSchema,
    maximumOutputAndReasoningReservationUsdMicros: safeCountSchema,
    maximumInferenceReservationUsdMicros: safeCountSchema,
    requestsPerProbe: z.literal(PROBE_PAIRS),
    requestsPerPrimary: z.literal(PRIMARY_PAIRS),
    requestsPerCampaign: z.literal(CAMPAIGN_PAIRS),
    campaignContributionUsdMicros: safeCountSchema,
  })
  .readonly();

const totalsSchema = z
  .strictObject({
    pairs: safeCountSchema,
    requests: safeCountSchema,
    maximumInputTokens: safeCountSchema,
    maximumOutputTokens: safeCountSchema,
    inferenceReservationUsdMicros: safeCountSchema,
    unresolvedCountPricingExposureUsdMicros: safeCountSchema,
    completeExposureUsdMicros: safeCountSchema,
    overOriginalCapUsdMicros: safeCountSchema,
  })
  .readonly();

const developmentClassSchema = z
  .strictObject({
    requestClass: requestClassSchema,
    fixtures: z.literal(24),
    observedTruncations: z.number().int().min(0).max(24),
    maximumObservedCombinedOutputTokens: safeCountSchema,
    inferenceOutsideFrozenFixtures: z.literal("unknown"),
  })
  .readonly();

const designSchema = z
  .strictObject({
    designId: designIdSchema,
    immutableReference: z.boolean(),
    classEnvelopes: classEnvelopeSchema.array().length(4).readonly(),
    totals: z.strictObject({
      perPair: totalsSchema,
      probe: totalsSchema,
      primary: totalsSchema,
      campaign: totalsSchema,
    }),
    developmentConformance: z.strictObject({
      evidenceKind: z.literal(
        "frozen-offline-development-fixture-conformance-not-population-risk-estimate",
      ),
      classes: developmentClassSchema.array().length(4).readonly(),
      totalFixtures: z.literal(96),
      observedTruncations: safeCountSchema,
      generalizationRisk: z.literal("unknown"),
    }),
    firstAttemptPolicy: z.strictObject({
      truncatedOrIncomplete: z.literal("terminal-primary-endpoint-failure"),
      exactResponseAndUsageRetained: z.literal(true),
      retries: z.literal(0),
      exclusionPermitted: z.literal(false),
      replacementPermitted: z.literal(false),
      postHocCeilingIncreasePermitted: z.literal(false),
    }),
    probeGate: z.strictObject({
      completeProbeResponsesRequired: z.literal(96),
      maximumTruncatedOrIncompleteResponses: z.literal(0),
      failureDecision: z.literal(
        "halt-no-primary-no-ceiling-change-no-retry-no-replacement",
      ),
    }),
    scientificBoundary: z.strictObject({
      primaryEndpointUnchanged: z.literal(true),
      populationUnchanged: z.literal(true),
      pairedAllocationUnchanged: z.literal(true),
      alphaUnchanged: z.literal(true),
      targetPowerUnchanged: z.literal(true),
      targetPowerBasisPoints: z.literal(8_000),
      primaryPairedCases: z.literal(PRIMARY_PAIRS),
      matchedModelAndReasoningModeAcrossArms: z.literal(true),
      fixedVisibleReasoningRatioAssumed: z.literal(false),
      ceilingMutableAfterProbeBegins: z.literal(false),
    }),
  })
  .readonly();

const reportBodySchema = z
  .strictObject({
    protocol: z.literal(M9B10_OUTPUT_ENVELOPE_PROTOCOL.id),
    version: z.literal(M9B10_OUTPUT_ENVELOPE_PROTOCOL.version),
    baselineCommit: z.literal(M9B10_OUTPUT_ENVELOPE_PROTOCOL.baselineCommit),
    inheritedM9b9: z.strictObject({
      reportDigest: digestSchema,
      protocol: z.literal("lachesis-m9b9-offline-responses-input-token-count"),
      version: z.literal("1.0.0"),
      decision: z.literal("token-count-pricing-unknown-no-go"),
      exactCountInferenceReservationUsdMicros: z.literal(613_416_960),
      unresolvedCountPricingExposureUsdMicros: z.literal(4_425_600_000),
    }),
    population: z.strictObject({
      probePairs: z.literal(PROBE_PAIRS),
      primaryPairs: z.literal(PRIMARY_PAIRS),
      campaignPairs: z.literal(CAMPAIGN_PAIRS),
      requestClassesPerPair: z.literal(4),
      primaryEndpoint: z.literal(
        "first-attempt-semantically-supported-end-to-end-success",
      ),
      inferenceUnit: z.literal("independent-paired-case"),
    }),
    pricing: z.strictObject({
      cacheWriteInputUsdMicrosPerMillionTokens: safeCountSchema,
      outputUsdMicrosPerMillionTokens: safeCountSchema,
      reasoningUsdMicrosPerMillionTokens: safeCountSchema,
      longContextThresholdTokens: safeCountSchema,
      inputMultiplierMicrosBelowThreshold: z.literal(1_000_000),
      outputMultiplierMicrosBelowThreshold: z.literal(1_000_000),
      providerMaxOutputIncludesVisibleAndNonvisibleTokens: z.literal(true),
      countPricingRule: z.literal("unresolved"),
    }),
    structuralContracts: structureSchema,
    designs: designSchema.array().length(3).readonly(),
    dominance: z.strictObject({
      acceptedM9b9InputReservationUsdMicros: z.literal(117_964_800),
      acceptedM9b9OutputReservationUsdMicros: z.literal(495_452_160),
      acceptedM9b9OutputShareBasisPoints: z.literal(8_078),
      acceptedM9b9AuthoringOutputReservationUsdMicros: z.literal(377_487_360),
      acceptedM9b9GroundedOutputReservationUsdMicros: z.literal(117_964_800),
      residualCapacityAfterInputAtOriginalCapUsdMicros: z.literal(0),
      conclusion: z.literal(
        "output-dominates-accepted-inference-but-input-floor-exhausts-original-cap",
      ),
    }),
    alternatives: z.strictObject({
      currentImmutableNoGo: z.literal("accepted-m9b9-current"),
      prospectivelySelectableOnlyBeforeProbe: z.tuple([
        z.literal("prospective-moderate-class-specific"),
        z.literal("prospective-aggressive-class-specific"),
      ]),
      dominantProspectivelyChangeableParameters: z.tuple([
        z.literal("program-authoring-output-ceiling"),
        z.literal("grounded-answer-output-ceiling"),
        z.literal("static-query-output-ceiling"),
        z.literal("campaign-cap"),
      ]),
      forbiddenChanges: z.tuple([
        z.literal("population"),
        z.literal("estimand"),
        z.literal("paired-allocation"),
        z.literal("alpha"),
        z.literal("power-target"),
        z.literal("retry-policy"),
      ]),
    }),
    decision: z.literal("campaign-capacity-remains-no-go"),
    authority: z.strictObject({
      overallPreregistrationReadiness: z.literal(false),
      countPricingResolutionRequired: z.literal(true),
      campaignCapChangeRequiredForAnyPositiveOutputEnvelope: z.literal(true),
      corpusMaterializationAuthorized: z.literal(false),
      externalRegistrationAuthorized: z.literal(false),
      credentialsAuthorized: z.literal(false),
      providerAccessAuthorized: z.literal(false),
      probeAuthorized: z.literal(false),
      liveExecutionAuthorized: z.literal(false),
    }),
  })
  .readonly();

export const m9b10OutputEnvelopeReportSchema = reportBodySchema
  .unwrap()
  .safeExtend({ reportDigest: digestSchema })
  .readonly();
export type M9b10OutputEnvelopeReport = z.infer<
  typeof m9b10OutputEnvelopeReportSchema
>;
export type M9b10OutputEnvelopeToken = Readonly<{ capability: object }>;

export type M9b10Failure = Readonly<{
  kind: "validation" | "structural-rejection";
  message: string;
}>;

function failure(
  kind: M9b10Failure["kind"],
  message: string,
): Result<never, M9b10Failure> {
  return { ok: false, error: { kind, message } };
}

function safeMultiply(left: number, right: number): number | undefined {
  const product = BigInt(left) * BigInt(right);
  return product <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(product)
    : undefined;
}

function safeSum(values: ReadonlyArray<number>): number | undefined {
  const total = values.reduce(
    (accumulator, value) => accumulator + BigInt(value),
    0n,
  );
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : undefined;
}

function priced(tokens: number, rate: number): number | undefined {
  const numerator = BigInt(tokens) * BigInt(rate);
  const value = (numerator + 999_999n) / 1_000_000n;
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function totalsFor(
  classes: ReadonlyArray<z.infer<typeof classEnvelopeSchema>>,
  pairs: number,
): z.infer<typeof totalsSchema> | undefined {
  const inputTokens = safeSum(
    classes.map((entry) => entry.frozenMaximumInputTokens),
  );
  const outputTokens = safeSum(
    classes.map((entry) => entry.maximumOutputTokens),
  );
  const inferencePerPair = safeSum(
    classes.map((entry) => entry.maximumInferenceReservationUsdMicros),
  );
  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    inferencePerPair === undefined
  )
    return undefined;
  const requests = safeMultiply(4, pairs);
  const maximumInputTokens = safeMultiply(inputTokens, pairs);
  const maximumOutputTokens = safeMultiply(outputTokens, pairs);
  const inference = safeMultiply(inferencePerPair, pairs);
  const count =
    requests === undefined
      ? undefined
      : safeMultiply(requests, UNRESOLVED_COUNT_EFFECT_USD_MICROS_PER_REQUEST);
  const complete =
    inference === undefined || count === undefined
      ? undefined
      : safeSum([inference, count]);
  if (
    requests === undefined ||
    maximumInputTokens === undefined ||
    maximumOutputTokens === undefined ||
    inference === undefined ||
    count === undefined ||
    complete === undefined
  )
    return undefined;
  return totalsSchema.parse({
    pairs,
    requests,
    maximumInputTokens,
    maximumOutputTokens,
    inferenceReservationUsdMicros: inference,
    unresolvedCountPricingExposureUsdMicros: count,
    completeExposureUsdMicros: complete,
    overOriginalCapUsdMicros: Math.max(0, complete - ORIGINAL_CAP_USD_MICROS),
  });
}

function developmentConformance(
  designId: M9b10DesignId,
): z.infer<typeof designSchema>["developmentConformance"] {
  const classes = requestClassSchema.options.map((requestClass) => {
    const observations = developmentUsage[requestClass];
    const maximumOutputTokens =
      outputProfile[designId][requestClass].maximumOutputTokens;
    return developmentClassSchema.parse({
      requestClass,
      fixtures: 24,
      observedTruncations: observations.filter(
        (tokens) => tokens > maximumOutputTokens,
      ).length,
      maximumObservedCombinedOutputTokens: Math.max(...observations),
      inferenceOutsideFrozenFixtures: "unknown",
    });
  });
  return {
    evidenceKind:
      "frozen-offline-development-fixture-conformance-not-population-risk-estimate",
    classes,
    totalFixtures: 96,
    observedTruncations: classes.reduce(
      (total, entry) => total + entry.observedTruncations,
      0,
    ),
    generalizationRisk: "unknown",
  };
}

function deriveDesign(
  designId: M9b10DesignId,
  m9b9: M9b9CapacityReport,
): z.infer<typeof designSchema> | undefined {
  const pricing = m9b9.identities.pricing;
  const classes: Array<z.infer<typeof classEnvelopeSchema>> = [];
  for (const requestClass of requestClassSchema.options) {
    const coordinate = classCoordinate[requestClass];
    const profile = outputProfile[designId][requestClass];
    const input = priced(
      coordinate.inputTokens,
      pricing.cacheWriteUsdMicrosPerMillionTokens,
    );
    const output = priced(
      profile.maximumOutputTokens,
      pricing.outputUsdMicrosPerMillionTokens,
    );
    if (input === undefined || output === undefined) return undefined;
    const total = safeSum([input, output]);
    const contribution =
      total === undefined ? undefined : safeMultiply(total, CAMPAIGN_PAIRS);
    if (total === undefined || contribution === undefined) return undefined;
    classes.push(
      classEnvelopeSchema.parse({
        requestClass,
        arm: coordinate.arm,
        phase: coordinate.phase,
        frozenMaximumInputTokens: coordinate.inputTokens,
        inputBillingClass: "cache-write-highest-applicable-class",
        inputUsdMicrosPerMillionTokens:
          pricing.cacheWriteUsdMicrosPerMillionTokens,
        outputUsdMicrosPerMillionTokens:
          pricing.outputUsdMicrosPerMillionTokens,
        inputMultiplierMicros: 1_000_000,
        outputMultiplierMicros: 1_000_000,
        maximumOutputTokens: profile.maximumOutputTokens,
        maximumReasoningTokens: profile.maximumReasoningTokens,
        maximumVisibleStructuredOutputTokens:
          profile.maximumVisibleStructuredOutputTokens,
        formattingHeadroomTokens: profile.formattingHeadroomTokens,
        maximumInputReservationUsdMicros: input,
        maximumOutputAndReasoningReservationUsdMicros: output,
        maximumInferenceReservationUsdMicros: total,
        requestsPerProbe: PROBE_PAIRS,
        requestsPerPrimary: PRIMARY_PAIRS,
        requestsPerCampaign: CAMPAIGN_PAIRS,
        campaignContributionUsdMicros: contribution,
      }),
    );
  }
  const perPair = totalsFor(classes, 1);
  const probe = totalsFor(classes, PROBE_PAIRS);
  const primary = totalsFor(classes, PRIMARY_PAIRS);
  const campaign = totalsFor(classes, CAMPAIGN_PAIRS);
  if (
    perPair === undefined ||
    probe === undefined ||
    primary === undefined ||
    campaign === undefined
  )
    return undefined;
  return designSchema.parse({
    designId,
    immutableReference: designId === "accepted-m9b9-current",
    classEnvelopes: classes,
    totals: { perPair, probe, primary, campaign },
    developmentConformance: developmentConformance(designId),
    firstAttemptPolicy: {
      truncatedOrIncomplete: "terminal-primary-endpoint-failure",
      exactResponseAndUsageRetained: true,
      retries: 0,
      exclusionPermitted: false,
      replacementPermitted: false,
      postHocCeilingIncreasePermitted: false,
    },
    probeGate: {
      completeProbeResponsesRequired: 96,
      maximumTruncatedOrIncompleteResponses: 0,
      failureDecision:
        "halt-no-primary-no-ceiling-change-no-retry-no-replacement",
    },
    scientificBoundary: {
      primaryEndpointUnchanged: true,
      populationUnchanged: true,
      pairedAllocationUnchanged: true,
      alphaUnchanged: true,
      targetPowerUnchanged: true,
      targetPowerBasisPoints: 8_000,
      primaryPairedCases: PRIMARY_PAIRS,
      matchedModelAndReasoningModeAcrossArms: true,
      fixedVisibleReasoningRatioAssumed: false,
      ceilingMutableAfterProbeBegins: false,
    },
  });
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalizeJson(left);
  const rightBytes = canonicalizeJson(right);
  return leftBytes.ok && rightBytes.ok && leftBytes.value === rightBytes.value;
}

async function deriveReport(
  m9b9Token: M9b9CapacityToken,
  m9b9Input: unknown,
): Promise<Result<M9b10OutputEnvelopeReport, M9b10Failure>> {
  const m9b9 = await verifyM9b9CapacityReview(m9b9Token, m9b9Input);
  if (!m9b9.ok)
    return failure("validation", "M9b.10 requires a verified M9b.9 report.");
  if (
    m9b9.value.totals.campaign.inferenceReservationUsdMicros !== 613_416_960 ||
    m9b9.value.totals.campaign.unresolvedCountEffectReservationUsdMicros !==
      4_425_600_000 ||
    m9b9.value.identities.pricing.reasoningUsdMicrosPerMillionTokens !== 0 ||
    m9b9.value.identities.pricing.longContextThresholdTokens !== 272_000
  )
    return failure(
      "validation",
      "M9b.9 capacity or pricing identities drifted.",
    );
  const designs = designIdSchema.options.map((designId) =>
    deriveDesign(designId, m9b9.value),
  );
  if (designs.some((design) => design === undefined))
    return failure("validation", "M9b.10 envelope arithmetic overflowed.");
  const body = reportBodySchema.safeParse({
    protocol: M9B10_OUTPUT_ENVELOPE_PROTOCOL.id,
    version: M9B10_OUTPUT_ENVELOPE_PROTOCOL.version,
    baselineCommit: M9B10_OUTPUT_ENVELOPE_PROTOCOL.baselineCommit,
    inheritedM9b9: {
      reportDigest: m9b9.value.reportDigest,
      protocol: m9b9.value.protocol,
      version: m9b9.value.version,
      decision: m9b9.value.decision,
      exactCountInferenceReservationUsdMicros:
        m9b9.value.totals.campaign.inferenceReservationUsdMicros,
      unresolvedCountPricingExposureUsdMicros:
        m9b9.value.totals.campaign.unresolvedCountEffectReservationUsdMicros,
    },
    population: {
      probePairs: PROBE_PAIRS,
      primaryPairs: PRIMARY_PAIRS,
      campaignPairs: CAMPAIGN_PAIRS,
      requestClassesPerPair: 4,
      primaryEndpoint:
        "first-attempt-semantically-supported-end-to-end-success",
      inferenceUnit: "independent-paired-case",
    },
    pricing: {
      cacheWriteInputUsdMicrosPerMillionTokens:
        m9b9.value.identities.pricing.cacheWriteUsdMicrosPerMillionTokens,
      outputUsdMicrosPerMillionTokens:
        m9b9.value.identities.pricing.outputUsdMicrosPerMillionTokens,
      reasoningUsdMicrosPerMillionTokens:
        m9b9.value.identities.pricing.reasoningUsdMicrosPerMillionTokens,
      longContextThresholdTokens:
        m9b9.value.identities.pricing.longContextThresholdTokens,
      inputMultiplierMicrosBelowThreshold: 1_000_000,
      outputMultiplierMicrosBelowThreshold: 1_000_000,
      providerMaxOutputIncludesVisibleAndNonvisibleTokens: true,
      countPricingRule: "unresolved",
    },
    structuralContracts: {
      program: PROGRAM_STRUCTURE,
      staticQuery: QUERY_STRUCTURE,
      groundedAnswer: GROUNDED_STRUCTURE,
      derivation:
        "program=2048+(14*864)+(4*64)=14400-source-bytes; canonical-source-output=(14400*2)+13=28813; query=(512*2)+12=1036; grounded=8192-conservative-printable-json-bound",
      visibleTokenBoundProvenance:
        "prospective-controller-allocation-not-exact-tokenizer-proof-provider-truncation-fails",
    },
    designs,
    dominance: {
      acceptedM9b9InputReservationUsdMicros: 117_964_800,
      acceptedM9b9OutputReservationUsdMicros: 495_452_160,
      acceptedM9b9OutputShareBasisPoints: 8_078,
      acceptedM9b9AuthoringOutputReservationUsdMicros: 377_487_360,
      acceptedM9b9GroundedOutputReservationUsdMicros: 117_964_800,
      residualCapacityAfterInputAtOriginalCapUsdMicros: 0,
      conclusion:
        "output-dominates-accepted-inference-but-input-floor-exhausts-original-cap",
    },
    alternatives: {
      currentImmutableNoGo: "accepted-m9b9-current",
      prospectivelySelectableOnlyBeforeProbe: [
        "prospective-moderate-class-specific",
        "prospective-aggressive-class-specific",
      ],
      dominantProspectivelyChangeableParameters: [
        "program-authoring-output-ceiling",
        "grounded-answer-output-ceiling",
        "static-query-output-ceiling",
        "campaign-cap",
      ],
      forbiddenChanges: [
        "population",
        "estimand",
        "paired-allocation",
        "alpha",
        "power-target",
        "retry-policy",
      ],
    },
    decision: M9B10_OUTPUT_ENVELOPE_PROTOCOL.decision,
    authority: {
      overallPreregistrationReadiness: false,
      countPricingResolutionRequired: true,
      campaignCapChangeRequiredForAnyPositiveOutputEnvelope: true,
      corpusMaterializationAuthorized: false,
      externalRegistrationAuthorized: false,
      credentialsAuthorized: false,
      providerAccessAuthorized: false,
      probeAuthorized: false,
      liveExecutionAuthorized: false,
    },
  });
  if (!body.success)
    return failure(
      "validation",
      `M9b.10 report body rejected: ${body.error.message}`,
    );
  const reportDigest = await digestValue(body.data);
  return reportDigest.ok
    ? {
        ok: true,
        value: m9b10OutputEnvelopeReportSchema.parse({
          ...body.data,
          reportDigest: reportDigest.value,
        }),
      }
    : failure("validation", "M9b.10 report digest failed.");
}

const trustedReports = new WeakMap<
  object,
  Readonly<{
    m9b9Token: M9b9CapacityToken;
    m9b9Report: M9b9CapacityReport;
  }>
>();

export async function prepareM9b10OutputEnvelopeReview(input: {
  readonly m9b9Token: M9b9CapacityToken;
  readonly m9b9Report: M9b9CapacityReport;
}): Promise<
  Result<
    Readonly<{
      report: M9b10OutputEnvelopeReport;
      token: M9b10OutputEnvelopeToken;
    }>,
    M9b10Failure
  >
> {
  const report = await deriveReport(input.m9b9Token, input.m9b9Report);
  if (!report.ok) return report;
  const capability = Object.freeze({});
  trustedReports.set(capability, {
    m9b9Token: input.m9b9Token,
    m9b9Report: input.m9b9Report,
  });
  return { ok: true, value: { report: report.value, token: { capability } } };
}

export async function verifyM9b10OutputEnvelopeReview(
  token: M9b10OutputEnvelopeToken,
  value: unknown,
): Promise<Result<M9b10OutputEnvelopeReport, M9b10Failure>> {
  const trusted = trustedReports.get(token.capability);
  const parsed = m9b10OutputEnvelopeReportSchema.safeParse(value);
  if (trusted === undefined || !parsed.success)
    return failure("validation", "Unknown M9b.10 token or report.");
  const rebuilt = await deriveReport(trusted.m9b9Token, trusted.m9b9Report);
  return rebuilt.ok && canonicalEqual(rebuilt.value, parsed.data)
    ? rebuilt
    : failure(
        "validation",
        "M9b.10 report failed exact zero-effect rederivation.",
      );
}

const evidenceIdSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[A-Za-z0-9._:@/-]+$/u)
  .refine((value) => utf8Bytes(value) <= 96);
function hasOnlyPrintableCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      (codePoint <= 31 && codePoint !== 10) ||
      (codePoint >= 127 && codePoint <= 159)
    )
      return false;
  }
  return true;
}
const printableNfcString = (maximumUtf8Bytes: number): z.ZodString =>
  z
    .string()
    .min(1)
    .refine((value) => value.normalize("NFC") === value)
    .refine(hasOnlyPrintableCharacters)
    .refine((value) => utf8Bytes(value) <= maximumUtf8Bytes);
const programOutputSchema = z
  .strictObject({ source: z.string().min(1).max(32_768) })
  .readonly();
const queryOutputSchema = z
  .strictObject({ query: printableNfcString(512) })
  .readonly();
const groundedOutputSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("answer"),
      answerValues: printableNfcString(256).array().min(1).max(8).readonly(),
      supportingFactIds: evidenceIdSchema.array().min(1).max(16).readonly(),
      citationIds: evidenceIdSchema.array().min(1).max(16).readonly(),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("insufficient-evidence"),
      reason: z.literal("corpus-does-not-support-answer"),
      supportingFactIds: z.tuple([]).readonly(),
      citationIds: z.tuple([]).readonly(),
    })
    .readonly(),
]);

const usageSchema = z
  .strictObject({
    outputTokens: safeCountSchema,
    reasoningTokens: safeCountSchema,
    visibleStructuredOutputTokens: safeCountSchema,
  })
  .readonly();
const prospectiveDesignIdSchema = z.enum([
  "prospective-moderate-class-specific",
  "prospective-aggressive-class-specific",
]);
const responseAssessmentInputSchema = z
  .strictObject({
    designId: prospectiveDesignIdSchema,
    requestClass: requestClassSchema,
    rawResponseBytes: z.string().min(1).max(131_072),
    usage: usageSchema,
    finishReason: z.enum(["stop", "length", "incomplete"]),
  })
  .readonly();

const responseReceiptBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b10-first-attempt-output-receipt/1"),
    designId: prospectiveDesignIdSchema,
    requestClass: requestClassSchema,
    rawResponseBytes: z.string().min(1).max(131_072),
    rawResponseDigest: digestSchema,
    usage: usageSchema,
    finishReason: z.enum(["stop", "length", "incomplete"]),
    outcome: z.enum(["accepted", "first-attempt-failure"]),
    failureReasons: z
      .enum([
        "noncanonical-or-malformed-json",
        "schema-or-structural-bound-rejected",
        "closed-ast-compilation-rejected",
        "output-token-ceiling-exceeded",
        "reasoning-token-ceiling-exceeded",
        "visible-token-ceiling-exceeded",
        "usage-components-inconsistent",
        "provider-truncated-or-incomplete",
      ])
      .array()
      .readonly(),
    exactResponseAndUsageRetained: z.literal(true),
    retryPermitted: z.literal(false),
    exclusionPermitted: z.literal(false),
    replacementPermitted: z.literal(false),
    ceilingIncreasePermitted: z.literal(false),
  })
  .readonly();
export const m9b10ResponseReceiptSchema = responseReceiptBodySchema
  .unwrap()
  .safeExtend({ receiptDigest: digestSchema })
  .readonly();
export type M9b10ResponseReceipt = z.infer<typeof m9b10ResponseReceiptSchema>;

async function outputPassesStructure(
  requestClass: M9b10RequestClass,
  value: unknown,
): Promise<Readonly<{ shape: boolean; compiled: boolean }>> {
  if (requestClass === "root-program-authoring") {
    const parsed = programOutputSchema.safeParse(value);
    if (
      !parsed.success ||
      utf8Bytes(parsed.data.source) > PROGRAM_STRUCTURE.maximumSourceUtf8Bytes
    )
      return { shape: false, compiled: false };
    const compiled = await compileM9aRetrievalProgram(parsed.data.source);
    if (!compiled.ok) return { shape: true, compiled: false };
    const summary = inspectM9aRetrievalArtifact(compiled.value);
    const structure = inspectM9aRetrievalArtifactStructure(compiled.value);
    if (summary === undefined || structure === undefined)
      return { shape: true, compiled: false };
    return {
      shape:
        structure.bindingCount <= PROGRAM_STRUCTURE.maximumBindings &&
        summary.analysis.maximumOperationCalls <=
          PROGRAM_STRUCTURE.maximumOperationCalls &&
        structure.maximumBoundedFixLimit <=
          PROGRAM_STRUCTURE.maximumBoundedFixLimit &&
        structure.maximumIdentifierUtf8Bytes <=
          PROGRAM_STRUCTURE.maximumIdentifierUtf8Bytes &&
        structure.maximumReferenceUtf8Bytes <=
          PROGRAM_STRUCTURE.maximumReferenceUtf8Bytes &&
        structure.maximumCanonicalLiteralUtf8Bytes <=
          PROGRAM_STRUCTURE.maximumCanonicalLiteralUtf8Bytes &&
        structure.maximumArgumentsPerOperation <=
          PROGRAM_STRUCTURE.maximumArgumentsPerOperation,
      compiled: true,
    };
  }
  if (requestClass === "static-one-shot-query-planning")
    return {
      shape: queryOutputSchema.safeParse(value).success,
      compiled: true,
    };
  return {
    shape: groundedOutputSchema.safeParse(value).success,
    compiled: true,
  };
}

export async function assessM9b10OfflineResponse(
  input: unknown,
): Promise<Result<M9b10ResponseReceipt, M9b10Failure>> {
  const parsedInput = responseAssessmentInputSchema.safeParse(input);
  if (!parsedInput.success)
    return failure("validation", "M9b.10 response input is invalid.");
  const profile =
    outputProfile[parsedInput.data.designId][parsedInput.data.requestClass];
  const reasons: Array<
    z.infer<typeof responseReceiptBodySchema>["failureReasons"][number]
  > = [];
  const parsedOutput = parseJson(parsedInput.data.rawResponseBytes);
  const canonical = parsedOutput.ok
    ? canonicalizeJson(parsedOutput.value)
    : undefined;
  let structure = { shape: false, compiled: true };
  if (
    !parsedOutput.ok ||
    canonical === undefined ||
    !canonical.ok ||
    canonical.value !== parsedInput.data.rawResponseBytes
  )
    reasons.push("noncanonical-or-malformed-json");
  else
    structure = await outputPassesStructure(
      parsedInput.data.requestClass,
      parsedOutput.value,
    );
  if (!structure.shape) reasons.push("schema-or-structural-bound-rejected");
  if (!structure.compiled) reasons.push("closed-ast-compilation-rejected");
  if (parsedInput.data.usage.outputTokens > profile.maximumOutputTokens)
    reasons.push("output-token-ceiling-exceeded");
  if (parsedInput.data.usage.reasoningTokens > profile.maximumReasoningTokens)
    reasons.push("reasoning-token-ceiling-exceeded");
  if (
    parsedInput.data.usage.visibleStructuredOutputTokens >
    profile.maximumVisibleStructuredOutputTokens
  )
    reasons.push("visible-token-ceiling-exceeded");
  if (
    parsedInput.data.usage.reasoningTokens +
      parsedInput.data.usage.visibleStructuredOutputTokens >
    parsedInput.data.usage.outputTokens
  )
    reasons.push("usage-components-inconsistent");
  if (parsedInput.data.finishReason !== "stop")
    reasons.push("provider-truncated-or-incomplete");
  const rawResponseDigest = await digestValue(
    parsedInput.data.rawResponseBytes,
  );
  if (!rawResponseDigest.ok)
    return failure("validation", "M9b.10 response digest failed.");
  const body = responseReceiptBodySchema.parse({
    protocol: "lachesis-m9b10-first-attempt-output-receipt/1",
    ...parsedInput.data,
    rawResponseDigest: rawResponseDigest.value,
    outcome: reasons.length === 0 ? "accepted" : "first-attempt-failure",
    failureReasons: reasons,
    exactResponseAndUsageRetained: true,
    retryPermitted: false,
    exclusionPermitted: false,
    replacementPermitted: false,
    ceilingIncreasePermitted: false,
  });
  const receiptDigest = await digestValue(body);
  return receiptDigest.ok
    ? {
        ok: true,
        value: m9b10ResponseReceiptSchema.parse({
          ...body,
          receiptDigest: receiptDigest.value,
        }),
      }
    : failure("validation", "M9b.10 receipt digest failed.");
}

export async function verifyM9b10OfflineResponseReceipt(
  input: unknown,
): Promise<Result<M9b10ResponseReceipt, M9b10Failure>> {
  const parsed = m9b10ResponseReceiptSchema.safeParse(input);
  if (!parsed.success)
    return failure("validation", "M9b.10 response receipt is invalid.");
  const rebuilt = await assessM9b10OfflineResponse({
    designId: parsed.data.designId,
    requestClass: parsed.data.requestClass,
    rawResponseBytes: parsed.data.rawResponseBytes,
    usage: parsed.data.usage,
    finishReason: parsed.data.finishReason,
  });
  return rebuilt.ok && canonicalEqual(rebuilt.value, parsed.data)
    ? rebuilt
    : failure(
        "validation",
        "M9b.10 response receipt failed zero-effect rederivation.",
      );
}
