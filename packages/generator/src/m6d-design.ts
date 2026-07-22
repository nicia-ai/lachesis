import {
  type Diagnostic,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

const knownBoundSchema = z
  .strictObject({
    kind: z.literal("known"),
    value: z.number().int().nonnegative(),
  })
  .readonly();

const unknownBoundSchema = z
  .strictObject({
    kind: z.literal("unknown"),
    reason: z.enum([
      "no-prospective-discordance-distribution",
      "no-frozen-catalog-effect-envelope",
      "no-frozen-provider-model-pricing-or-token-envelope",
    ]),
  })
  .readonly();

export const m6dBoundSchema = z.discriminatedUnion("kind", [
  knownBoundSchema,
  unknownBoundSchema,
]);

export type M6dBound = z.infer<typeof m6dBoundSchema>;

const m6dStudyBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m6d-paired-study-design/1"),
    status: z.literal("complete-design-no-go"),
    claim: z
      .strictObject({
        primaryEstimand: z.literal(
          "template-minus-discovery-first-attempt-semantic-success",
        ),
        noninferiorityMarginBasisPoints: z.literal(1_000),
        familyAlpha: z.literal(0.05),
        repetitions: z.literal(2),
        inference: z
          .strictObject({
            method: z.literal(
              "distribution-free-one-sided-hoeffding-lower-bound",
            ),
            casesPerRepetition: z.number().int().positive(),
            totalFreshCases: z.number().int().positive(),
            empiricalPower: unknownBoundSchema,
          })
          .readonly(),
        secondaryMetrics: z
          .tuple([
            z.literal("planner-calls"),
            z.literal("final-semantic-success"),
            z.literal("latency-ms"),
            z.literal("cost-usd-micros"),
          ])
          .readonly(),
      })
      .readonly(),
    assignment: z
      .strictObject({
        unit: z.literal("fresh-public-task"),
        pairing: z.literal(
          "same-task-policy-evidence-contract-and-validation-envelope",
        ),
        sequences: z
          .tuple([z.literal("discovery-first"), z.literal("template-first")])
          .readonly(),
        algorithm: z.literal("sha256-case-digest-parity"),
        scorerBlindedToArm: z.literal(true),
      })
      .readonly(),
    eligibility: z
      .strictObject({
        stableTemplateRequired: z.literal(true),
        exactCatalogOrVerifiedM6cReportRequired: z.literal(true),
        insideValidationEnvelopeRequired: z.literal(true),
        identicalTrustedPolicyRequired: z.literal(true),
        identicalEvidenceSufficiencyContractRequired: z.literal(true),
        plannerAbsentFromTemplateArm: z.literal(true),
      })
      .readonly(),
    disjointness: z
      .strictObject({
        requiredAgainstMilestones: z
          .tuple([
            z.literal("M1"),
            z.literal("M2"),
            z.literal("M3"),
            z.literal("M4"),
            z.literal("M5"),
            z.literal("M6a-M6c"),
          ])
          .readonly(),
        dimensions: z
          .tuple([
            z.literal("case-identity"),
            z.literal("normalized-instruction"),
            z.literal("public-task-value"),
            z.literal("evidence-contract-and-content"),
            z.literal("catalog-pair"),
            z.literal("template-identity"),
          ])
          .readonly(),
        finalCorpusMaterialized: z.literal(false),
        contractDigest: digestSchema,
      })
      .readonly(),
    canary: z
      .strictObject({
        pairedCases: z.literal(20),
        maximumTemplatePlannerCalls: z.literal(0),
        rollbackTriggers: z
          .tuple([
            z.literal("false-role-equivalence"),
            z.literal("authority-or-budget-widening"),
            z.literal("catalog-or-conformance-report-mismatch"),
            z.literal("template-arm-planner-call"),
            z.literal("semantic-contract-or-replay-mismatch"),
          ])
          .readonly(),
        rollbackAction: z.literal("disable-reuse-and-deprecate-template"),
        automaticPromotion: z.literal(false),
      })
      .readonly(),
    bounds: z
      .strictObject({
        practicalFreshCaseCeiling: knownBoundSchema,
        requiredFreshCases: knownBoundSchema,
        discoveryPlannerCalls: knownBoundSchema,
        templatePlannerCalls: knownBoundSchema,
        effectCalls: unknownBoundSchema,
        maximumCostUsdMicros: unknownBoundSchema,
      })
      .readonly(),
    decision: z
      .strictObject({
        outcome: z.literal("no-go"),
        blockers: z
          .tuple([
            z.literal("required-cases-exceed-practical-ceiling"),
            z.literal("empirical-power-unknown"),
            z.literal("maximum-cost-unknown"),
            z.literal("fresh-final-corpus-not-materialized"),
          ])
          .readonly(),
      })
      .readonly(),
    authority: z
      .strictObject({
        liveInferenceAuthorized: z.literal(false),
        providerIdentityCreated: z.literal(false),
        campaignCreated: z.literal(false),
        preregistrationCreated: z.literal(false),
        spendingAuthorized: z.literal(false),
      })
      .readonly(),
  })
  .superRefine((design, context) => {
    const total =
      design.claim.inference.casesPerRepetition * design.claim.repetitions;
    if (
      design.claim.inference.totalFreshCases !== total ||
      design.bounds.requiredFreshCases.value !== total ||
      design.bounds.discoveryPlannerCalls.value !== total ||
      design.bounds.templatePlannerCalls.value !== 0 ||
      total <= design.bounds.practicalFreshCaseCeiling.value
    )
      context.addIssue({
        code: "custom",
        message: "M6d case, call, and no-go bounds must remain consistent.",
      });
  })
  .readonly();

export const m6dStudyDesignSchema = m6dStudyBodySchema
  .unwrap()
  .safeExtend({ designDigest: digestSchema })
  .readonly();

export type M6dStudyDesign = z.infer<typeof m6dStudyDesignSchema>;

function failure(message: string): Result<never, Diagnostic> {
  return {
    ok: false,
    error: diagnostic("INVALID_WIRE_SCHEMA", message),
  };
}

function requiredHoeffdingCases(alpha: number, margin: number): number {
  return Math.ceil((2 * Math.log(1 / alpha)) / margin ** 2);
}

/** Materializes only a content-addressed offline design; it creates no live identity. */
export async function designM6dPairedStudy(): Promise<
  Result<M6dStudyDesign, Diagnostic>
> {
  const familyAlpha = 0.05;
  const margin = 0.1;
  const repetitions = 2;
  const casesPerRepetition = requiredHoeffdingCases(familyAlpha, margin);
  const totalFreshCases = casesPerRepetition * repetitions;
  const disjointness = {
    requiredAgainstMilestones: ["M1", "M2", "M3", "M4", "M5", "M6a-M6c"],
    dimensions: [
      "case-identity",
      "normalized-instruction",
      "public-task-value",
      "evidence-contract-and-content",
      "catalog-pair",
      "template-identity",
    ],
    finalCorpusMaterialized: false,
  };
  const disjointnessDigest = await digestValue({
    protocol: "lachesis-m6d-disjointness-contract/1",
    ...disjointness,
  });
  if (!disjointnessDigest.ok) return disjointnessDigest;
  const parsed = m6dStudyBodySchema.safeParse({
    protocol: "lachesis-m6d-paired-study-design/1",
    status: "complete-design-no-go",
    claim: {
      primaryEstimand:
        "template-minus-discovery-first-attempt-semantic-success",
      noninferiorityMarginBasisPoints: 1_000,
      familyAlpha,
      repetitions,
      inference: {
        method: "distribution-free-one-sided-hoeffding-lower-bound",
        casesPerRepetition,
        totalFreshCases,
        empiricalPower: {
          kind: "unknown",
          reason: "no-prospective-discordance-distribution",
        },
      },
      secondaryMetrics: [
        "planner-calls",
        "final-semantic-success",
        "latency-ms",
        "cost-usd-micros",
      ],
    },
    assignment: {
      unit: "fresh-public-task",
      pairing: "same-task-policy-evidence-contract-and-validation-envelope",
      sequences: ["discovery-first", "template-first"],
      algorithm: "sha256-case-digest-parity",
      scorerBlindedToArm: true,
    },
    eligibility: {
      stableTemplateRequired: true,
      exactCatalogOrVerifiedM6cReportRequired: true,
      insideValidationEnvelopeRequired: true,
      identicalTrustedPolicyRequired: true,
      identicalEvidenceSufficiencyContractRequired: true,
      plannerAbsentFromTemplateArm: true,
    },
    disjointness: { ...disjointness, contractDigest: disjointnessDigest.value },
    canary: {
      pairedCases: 20,
      maximumTemplatePlannerCalls: 0,
      rollbackTriggers: [
        "false-role-equivalence",
        "authority-or-budget-widening",
        "catalog-or-conformance-report-mismatch",
        "template-arm-planner-call",
        "semantic-contract-or-replay-mismatch",
      ],
      rollbackAction: "disable-reuse-and-deprecate-template",
      automaticPromotion: false,
    },
    bounds: {
      practicalFreshCaseCeiling: { kind: "known", value: 500 },
      requiredFreshCases: { kind: "known", value: totalFreshCases },
      discoveryPlannerCalls: { kind: "known", value: totalFreshCases },
      templatePlannerCalls: { kind: "known", value: 0 },
      effectCalls: {
        kind: "unknown",
        reason: "no-frozen-catalog-effect-envelope",
      },
      maximumCostUsdMicros: {
        kind: "unknown",
        reason: "no-frozen-provider-model-pricing-or-token-envelope",
      },
    },
    decision: {
      outcome: "no-go",
      blockers: [
        "required-cases-exceed-practical-ceiling",
        "empirical-power-unknown",
        "maximum-cost-unknown",
        "fresh-final-corpus-not-materialized",
      ],
    },
    authority: {
      liveInferenceAuthorized: false,
      providerIdentityCreated: false,
      campaignCreated: false,
      preregistrationCreated: false,
      spendingAuthorized: false,
    },
  });
  if (!parsed.success)
    return failure("Constructed M6d study design is invalid.");
  const digest = await digestValue(parsed.data);
  return digest.ok
    ? {
        ok: true,
        value: m6dStudyDesignSchema.parse({
          ...parsed.data,
          designDigest: digest.value,
        }),
      }
    : digest;
}

export async function verifyM6dStudyDesign(
  value: unknown,
): Promise<Result<M6dStudyDesign, Diagnostic>> {
  const parsed = m6dStudyDesignSchema.safeParse(value);
  if (!parsed.success) return failure("M6d study design is invalid.");
  const { designDigest, ...body } = parsed.data;
  const digest = await digestValue(body);
  return digest.ok && digest.value === designDigest
    ? { ok: true, value: parsed.data }
    : failure("M6d study design identity is invalid.");
}

export type M6dMaximumCostBound = Readonly<{
  protocol: "lachesis-m6d-maximum-cost-bound/1";
  maximumPlannerCalls: number;
  maximumEffectCalls: number;
  maximumCostUsdMicros: number;
}>;

export const m6dWorkloadIdentitySchema = z
  .strictObject({
    caseIdentity: digestSchema,
    normalizedInstruction: digestSchema,
    publicTaskValue: digestSchema,
    evidenceContractAndContent: digestSchema,
    catalogPair: digestSchema,
    templateIdentity: digestSchema,
  })
  .readonly();

export type M6dWorkloadIdentity = z.infer<typeof m6dWorkloadIdentitySchema>;

export type M6dDisjointnessAudit = Readonly<{
  protocol: "lachesis-m6d-disjointness-audit/1";
  candidateCount: number;
  historicalCount: number;
  passed: true;
  auditDigest: string;
}>;

const workloadDimensions = [
  "caseIdentity",
  "normalizedInstruction",
  "publicTaskValue",
  "evidenceContractAndContent",
  "catalogPair",
  "templateIdentity",
] as const;

/** Rejects duplicate candidate identities and overlap with prior milestone material. */
export async function auditM6dWorkloadDisjointness(
  input: Readonly<{
    candidates: ReadonlyArray<unknown>;
    historical: ReadonlyArray<unknown>;
  }>,
): Promise<Result<M6dDisjointnessAudit, Diagnostic>> {
  const candidates = z
    .array(m6dWorkloadIdentitySchema)
    .min(1)
    .max(10_000)
    .safeParse(input.candidates);
  const historical = z
    .array(m6dWorkloadIdentitySchema)
    .max(100_000)
    .safeParse(input.historical);
  if (!candidates.success || !historical.success)
    return failure("M6d workload identities are invalid.");
  for (const dimension of workloadDimensions) {
    const candidateValues = candidates.data.map((item) => item[dimension]);
    if (new Set(candidateValues).size !== candidateValues.length)
      return failure(`M6d candidate ${dimension} identities are not unique.`);
    const historicalValues = new Set(
      historical.data.map((item) => item[dimension]),
    );
    if (candidateValues.some((value) => historicalValues.has(value)))
      return failure(
        `M6d candidate ${dimension} overlaps historical material.`,
      );
  }
  const body = {
    protocol: "lachesis-m6d-disjointness-audit/1" as const,
    candidateCount: candidates.data.length,
    historicalCount: historical.data.length,
    passed: true as const,
  };
  const digest = await digestValue(body);
  return digest.ok
    ? {
        ok: true,
        value: Object.freeze({ ...body, auditDigest: digest.value }),
      }
    : digest;
}

export function assignM6dSequence(
  caseDigest: string,
): Result<"discovery-first" | "template-first", Diagnostic> {
  const parsed = digestSchema.safeParse(caseDigest);
  if (!parsed.success)
    return failure("M6d assignment requires a SHA-256 digest.");
  const finalDigit = Number.parseInt(parsed.data.slice(-1), 16);
  return {
    ok: true,
    value: finalDigit % 2 === 0 ? "discovery-first" : "template-first",
  };
}

/** Computes a known offline ceiling only after all per-call ceilings are supplied. */
export function boundM6dMaximumCost(
  design: M6dStudyDesign,
  ceilings: Readonly<{
    plannerCallUsdMicros: number;
    effectCallUsdMicros: number;
    effectCallsPerArmPerCase: number;
  }>,
): Result<M6dMaximumCostBound, Diagnostic> {
  const values = [
    ceilings.plannerCallUsdMicros,
    ceilings.effectCallUsdMicros,
    ceilings.effectCallsPerArmPerCase,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0))
    return failure("M6d cost ceilings must be nonnegative safe integers.");
  const maximumPlannerCalls = design.bounds.discoveryPlannerCalls.value;
  const maximumEffectCalls =
    design.bounds.requiredFreshCases.value *
    2 *
    ceilings.effectCallsPerArmPerCase;
  const maximumCostUsdMicros =
    maximumPlannerCalls * ceilings.plannerCallUsdMicros +
    maximumEffectCalls * ceilings.effectCallUsdMicros;
  return Number.isSafeInteger(maximumEffectCalls) &&
    Number.isSafeInteger(maximumCostUsdMicros)
    ? {
        ok: true,
        value: Object.freeze({
          protocol: "lachesis-m6d-maximum-cost-bound/1",
          maximumPlannerCalls,
          maximumEffectCalls,
          maximumCostUsdMicros,
        }),
      }
    : {
        ok: false,
        error: diagnostic(
          "BUDGET_EXCEEDED",
          "M6d maximum cost exceeds the safe integer range.",
        ),
      };
}
