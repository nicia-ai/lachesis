import {
  digestValue,
  err,
  ok,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import { evidenceContextSchema } from "./contract.js";
import {
  type M3a1Category,
  m3a1CategorySchema,
  m3bAnswerContractSchema,
} from "./corpus.js";
import {
  type M3bAttemptProvenance,
  m3bAttemptProvenanceSchema,
  type M3bDiagnosticIssue,
  m3bDiagnosticIssueSchema,
  type M3bOracleDispatchContext,
  type M3bOracleFailureCode,
  m3bOracleFailureCodeSchema,
  type M3bOracleIdentity,
  m3bOracleIdentitySchema,
  m3bOracleUsageSchema,
} from "./m3b.js";
import {
  type M4DiagnosticIssue,
  m4EvidenceViewSchema,
  m4OracleAnswerSchema,
  type M4Provider,
  m4ProviderSchema,
} from "./m4.js";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u);
const repetitionSchema = z.union([z.literal(1), z.literal(2)]);

export const m4d1PolicyRuleSchema = z
  .strictObject({
    provider: m4ProviderSchema,
    category: m3a1CategorySchema,
    view: m4EvidenceViewSchema,
  })
  .readonly();

export const m4d1CandidatePolicySchema = z
  .strictObject({
    id: identifierSchema,
    version: z.string().min(1),
    status: z.literal("development-derived-confirmation-candidate"),
    basis: z.literal("m4d0-development-only-cross-repetition-audit"),
    defaultView: z.literal("lexical-facts"),
    rules: z.array(m4d1PolicyRuleSchema).length(12).readonly(),
    productionDefault: z.literal(false),
  })
  .superRefine((policy, context) => {
    const required = m4ProviderSchema.options.flatMap((provider) =>
      m3a1CategorySchema.options.map((category) => `${provider}/${category}`),
    );
    const actual = policy.rules.map(
      (rule) => `${rule.provider}/${rule.category}`,
    );
    if (
      new Set(actual).size !== required.length ||
      required.some((key) => !actual.includes(key))
    )
      context.addIssue({
        code: "custom",
        message: "Candidate policy must define every provider/category once.",
        path: ["rules"],
      });
  })
  .readonly();

export type M4d1CandidatePolicy = z.infer<typeof m4d1CandidatePolicySchema>;

const CATEGORIES: ReadonlyArray<M3a1Category> = [
  "multi-hop",
  "temporal",
  "contradiction",
  "provenance",
  "retraction",
  "negative-control",
];
const PROVIDERS: ReadonlyArray<M4Provider> = ["openai", "anthropic"];

export const M4D1_LEXICAL_CONTROL_POLICY = Object.freeze({
  id: "m4d1-always-lexical-control",
  version: "1",
  view: "lexical-facts" as const,
  productionDefault: true,
});

export const M4D1_EXISTING_M4A_DISPOSITION = Object.freeze({
  policyId: "lachesis-m4-provider-aware-evidence-view",
  policyVersion: "1",
  policyDigest:
    "d93d87fc1d337b691f0fc24be5524e491525052cce8fa7157ed1ab4e4ddc721f",
  status: "development-rejected",
  modifiedByM4d1: false,
  productionDefault: false,
});

export const M4D1_CANDIDATE_POLICY: M4d1CandidatePolicy =
  m4d1CandidatePolicySchema.parse({
    id: "m4d1-anthropic-category-evidence-candidate",
    version: "1",
    status: "development-derived-confirmation-candidate",
    basis: "m4d0-development-only-cross-repetition-audit",
    defaultView: "lexical-facts",
    rules: PROVIDERS.flatMap((provider) =>
      CATEGORIES.map((category) => ({
        provider,
        category,
        view:
          provider === "anthropic" && category === "contradiction"
            ? ("graph-facts" as const)
            : provider === "anthropic" && category === "retraction"
              ? ("graph-typed" as const)
              : ("lexical-facts" as const),
      })),
    ),
    productionDefault: false,
  });

function canonicalPolicy(policy: M4d1CandidatePolicy): M4d1CandidatePolicy {
  return m4d1CandidatePolicySchema.parse({
    ...policy,
    rules: policy.rules.toSorted((left, right) =>
      `${left.provider}/${left.category}`.localeCompare(
        `${right.provider}/${right.category}`,
      ),
    ),
  });
}

export async function identifyM4d1CandidatePolicy(
  policyInput: unknown = M4D1_CANDIDATE_POLICY,
): Promise<Result<string, M4d1DesignFailure>> {
  const parsed = m4d1CandidatePolicySchema.safeParse(policyInput);
  if (!parsed.success)
    return err(designFailure("INVALID_POLICY", "Candidate policy is invalid."));
  const identified = await digestValue(canonicalPolicy(parsed.data));
  return identified.ok
    ? ok(identified.value)
    : err(
        designFailure(
          "IDENTITY_FAILURE",
          "Candidate policy cannot be identified.",
        ),
      );
}

export function selectM4d1CandidateView(
  provider: M4Provider,
  category: M3a1Category,
): M4d1CandidatePolicy["rules"][number]["view"] {
  const selected = M4D1_CANDIDATE_POLICY.rules.find(
    (rule) => rule.provider === provider && rule.category === category,
  );
  return selected?.view ?? M4D1_LEXICAL_CONTROL_POLICY.view;
}

export const M4D1_REDUCED_ORACLE_PROMPT = Object.freeze({
  id: "m4d1-arm-blinded-reduced-evidence-oracle",
  version: "1",
  rules: Object.freeze([
    "Use only the public instruction, public answer contract, and supplied visible evidence.",
    "Return only outcome, answerValues, and supportingFactIds.",
    "Return answered only when the visible evidence contains a complete derivation satisfying the public contract.",
    "Return insufficient-evidence with empty answerValues and supportingFactIds when no complete visible derivation exists.",
    "Never infer or return citations, paths, provenance, source, representation, arm, or policy identity.",
    "Return raw JSON only, with no Markdown fences or alternate fields.",
  ]),
  runtimeDerived: Object.freeze([
    "semantic-validation",
    "citations",
    "canonical-paths",
    "provenance-graph",
  ]),
  maximumWireRepairsPerRecord: 1,
  maximumSemanticRepairsPerRecord: 1,
  liveInferenceAuthorized: false,
  materializationAuthorized: false,
});

const m4d1WireRepairSchema = z
  .strictObject({
    previousRawOutput: z.string().max(65_536),
    decodingIssues: z.array(m3bDiagnosticIssueSchema).min(1).max(64).readonly(),
  })
  .readonly();

const m4d1SemanticRepairSchema = z
  .strictObject({
    previousOutput: m4OracleAnswerSchema,
    obligationIssues: z
      .array(m3bDiagnosticIssueSchema)
      .min(1)
      .max(64)
      .readonly(),
  })
  .readonly();

export const m4d1OracleRequestSchema = z
  .strictObject({
    instruction: z.string().min(1).max(4_000),
    answerContract: m3bAnswerContractSchema,
    evidence: evidenceContextSchema,
    wireRepair: m4d1WireRepairSchema.nullable().default(null),
    semanticRepair: m4d1SemanticRepairSchema.nullable().default(null),
  })
  .superRefine((request, context) => {
    if (request.wireRepair !== null && request.semanticRepair !== null)
      context.addIssue({
        code: "custom",
        message: "Wire and semantic repair are separate bounded stages.",
        path: ["semanticRepair"],
      });
  })
  .readonly();

export type M4d1OracleRequest = z.infer<typeof m4d1OracleRequestSchema>;
export type M4d1OracleOutput = z.infer<typeof m4OracleAnswerSchema>;

export type M4d1WireDecodeResult =
  | Readonly<{
      kind: "accepted";
      output: M4d1OracleOutput;
      issues: ReadonlyArray<M3bDiagnosticIssue>;
    }>
  | Readonly<{
      kind: "json-parse-failed" | "wire-schema-rejected";
      output: null;
      issues: ReadonlyArray<M3bDiagnosticIssue>;
    }>;

function zodIssues(error: z.ZodError): ReadonlyArray<M3bDiagnosticIssue> {
  return error.issues.slice(0, 64).map((issue) => ({
    code: issue.code,
    path: issue.path.flatMap((part) =>
      typeof part === "string" || typeof part === "number" ? [part] : [],
    ),
    message: issue.message.slice(0, 512),
  }));
}

export function decodeM4d1OracleWire(text: string): M4d1WireDecodeResult {
  const json = parseJson(text);
  if (!json.ok)
    return {
      kind: "json-parse-failed",
      output: null,
      issues: [
        {
          code: "invalid-json",
          path: [],
          message: json.error.message.slice(0, 512),
        },
      ],
    };
  const parsed = m4OracleAnswerSchema.safeParse(json.value);
  return parsed.success
    ? { kind: "accepted", output: parsed.data, issues: [] }
    : {
        kind: "wire-schema-rejected",
        output: null,
        issues: zodIssues(parsed.error),
      };
}

export const m4d1OracleAttemptSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("success"),
      output: m4OracleAnswerSchema,
      usage: m3bOracleUsageSchema,
      provenance: m3bAttemptProvenanceSchema,
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("failure"),
      code: m3bOracleFailureCodeSchema,
      dispatchEvidence: z.enum([
        "not-dispatched",
        "dispatched-with-usage",
        "dispatched-usage-unknown",
      ]),
      usage: m3bOracleUsageSchema.nullable(),
      latencyMs: z.number().int().nonnegative().optional(),
      provenance: m3bAttemptProvenanceSchema,
    })
    .readonly(),
]);

export type M4d1OracleAttempt = z.infer<typeof m4d1OracleAttemptSchema>;
export type M4d1Oracle = Readonly<{
  identity: M3bOracleIdentity;
  generate: (
    request: M4d1OracleRequest,
    context: M3bOracleDispatchContext,
  ) => Promise<M4d1OracleAttempt>;
}>;

export const m4d1OutcomeMeasurementsSchema = z
  .strictObject({
    firstAttemptEndToEndSuccess: z.boolean(),
    firstAttemptSemanticSuccess: z.boolean(),
    postWireRepairSuccess: z.boolean().nullable(),
    postSemanticRepairSuccess: z.boolean().nullable(),
    finalReliability: z.boolean(),
    wireRepairCalls: z.union([z.literal(0), z.literal(1)]),
    semanticRepairCalls: z.union([z.literal(0), z.literal(1)]),
  })
  .superRefine((measurement, context) => {
    if (
      (measurement.wireRepairCalls === 0) !==
      (measurement.postWireRepairSuccess === null)
    )
      context.addIssue({
        code: "custom",
        message:
          "Post-wire outcome must correspond to exactly one wire repair.",
        path: ["postWireRepairSuccess"],
      });
    if (
      (measurement.semanticRepairCalls === 0) !==
      (measurement.postSemanticRepairSuccess === null)
    )
      context.addIssue({
        code: "custom",
        message:
          "Post-semantic outcome must correspond to exactly one semantic repair.",
        path: ["postSemanticRepairSuccess"],
      });
  })
  .readonly();

const developmentEstimateSchema = z
  .strictObject({
    repetition: repetitionSchema,
    matchedCases: z.literal(20),
    favorableDiscordances: z.number().int().nonnegative(),
    adverseDiscordances: z.number().int().nonnegative(),
  })
  .readonly();

const hypothesisDesignSchema = z
  .strictObject({
    id: z.enum([
      "anthropic-contradiction-graph-facts-vs-lexical",
      "anthropic-retraction-typed-graph-vs-lexical",
    ]),
    category: z.enum(["contradiction", "retraction"]),
    candidateView: z.enum(["graph-facts", "graph-typed"]),
    comparatorView: z.literal("lexical-facts"),
    development: z.array(developmentEstimateSchema).length(2).readonly(),
    conservativeDiscordanceProbability: z.number().min(0).max(1),
    conservativeFavorableGivenDiscordance: z.number().min(0.5).max(1),
    minimumCasesPerRepetition: z.number().int().positive(),
    achievedExactPower: z.number().min(0).max(1),
    previousSampleExactPower: z.number().min(0).max(1),
  })
  .readonly();

const m4d1PowerDesignBodyObject = z.strictObject({
  protocol: z.literal("m4d1-exact-paired-power-design/1"),
  baselineCommit: z.literal("ad875ca89608e3b3d9f1fd44bc7e342af51748e3"),
  evidenceBasis: z.literal("frozen-m3-development-discordances"),
  provider: z.literal("anthropic"),
  repetitions: z.literal(2),
  targetPowerPerHypothesisPerRepetition: z.literal(0.9),
  minimumDiscordantPairs: z.literal(20),
  familyAlphaPerRepetition: z.literal(0.05),
  multiplicity: z.literal("holm-two-primary-hypotheses"),
  designAlpha: z.literal(0.025),
  pairedTest: z.literal("exact-two-sided-mcnemar"),
  effectConvention: z.literal(
    "minimum-repetition-discordance-rate-and-add-one-shrunk-direction",
  ),
  hypotheses: z.array(hypothesisDesignSchema).length(2).readonly(),
  proposedCorpus: z
    .strictObject({
      contradictionCases: z.number().int().positive(),
      retractionCases: z.number().int().positive(),
      uniqueCases: z.number().int().positive(),
      initialCalls: z.number().int().positive(),
      practicalMaximumUniqueCases: z.literal(500),
      status: z.literal("blocked-impractical-sample-size"),
      finalCorpusGenerated: z.literal(false),
    })
    .readonly(),
  analysis: z
    .strictObject({
      providersPooled: z.literal(false),
      repetitionsPooled: z.literal(false),
      hypothesesIndependent: z.literal(true),
      bothRepetitionsMustPass: z.literal(true),
      correctDirectionRequired: z.literal(true),
      repairsCanRescuePrimary: z.literal(false),
      combinedAdaptivePolicyEndpoint: z.literal("secondary"),
    })
    .readonly(),
});

const m4d1PowerDesignBodySchema = m4d1PowerDesignBodyObject.readonly();

export const m4d1PowerDesignSchema = m4d1PowerDesignBodyObject
  .extend({ designDigest: digestSchema })
  .readonly();
export type M4d1PowerDesign = z.infer<typeof m4d1PowerDesignSchema>;

export const m4d1DesignFailureSchema = z
  .strictObject({
    code: z.enum([
      "INVALID_POLICY",
      "INVALID_POWER_INPUT",
      "POWER_SEARCH_EXHAUSTED",
      "IDENTITY_FAILURE",
      "INVALID_SHARED_CONDITION",
    ]),
    message: z.string().min(1),
  })
  .readonly();
export type M4d1DesignFailure = z.infer<typeof m4d1DesignFailureSchema>;

function designFailure(
  code: M4d1DesignFailure["code"],
  message: string,
): M4d1DesignFailure {
  return { code, message };
}

function binomialProbabilities(
  trials: number,
  probability: number,
): ReadonlyArray<number> {
  if (probability === 0) return [1, ...Array.from({ length: trials }, () => 0)];
  if (probability === 1) return [...Array.from({ length: trials }, () => 0), 1];
  const result: Array<number> = [Math.pow(1 - probability, trials)];
  for (let successes = 0; successes < trials; successes += 1) {
    const previous = result[successes] ?? 0;
    result.push(
      (previous * (trials - successes) * probability) /
        ((successes + 1) * (1 - probability)),
    );
  }
  return result;
}

function exactTwoSidedMcNemarPUnchecked(
  favorable: number,
  adverse: number,
): number {
  const discordant = favorable + adverse;
  if (discordant === 0) return 1;
  const smaller = Math.min(favorable, adverse);
  const probabilities = binomialProbabilities(discordant, 0.5);
  return Math.min(
    1,
    2 *
      probabilities
        .slice(0, smaller + 1)
        .reduce((sum, value) => sum + value, 0),
  );
}

export function exactTwoSidedMcNemarP(
  favorable: number,
  adverse: number,
): Result<number, M4d1DesignFailure> {
  if (
    !Number.isSafeInteger(favorable) ||
    favorable < 0 ||
    !Number.isSafeInteger(adverse) ||
    adverse < 0
  )
    return err(
      designFailure(
        "INVALID_POWER_INPUT",
        "Discordance counts must be nonnegative safe integers.",
      ),
    );
  return ok(exactTwoSidedMcNemarPUnchecked(favorable, adverse));
}

function conditionalGateProbability(
  discordant: number,
  favorableProbability: number,
): number {
  if (discordant < 20) return 0;
  const nullProbabilities = binomialProbabilities(discordant, 0.5);
  const nullPrefix: Array<number> = [];
  for (const probability of nullProbabilities) {
    const previous = nullPrefix.at(-1) ?? 0;
    nullPrefix.push(previous + probability);
  }
  let minimumFavorable: number | null = null;
  for (
    let favorable = Math.floor(discordant / 2) + 1;
    favorable <= discordant;
    favorable += 1
  ) {
    const adverse = discordant - favorable;
    if (2 * (nullPrefix[adverse] ?? 1) <= 0.025) {
      minimumFavorable = favorable;
      break;
    }
  }
  if (minimumFavorable === null) return 0;
  return binomialProbabilities(discordant, favorableProbability)
    .slice(minimumFavorable)
    .reduce((sum, probability) => sum + probability, 0);
}

function exactM4d1GatePowerUnchecked(
  cases: number,
  discordanceProbability: number,
  favorableGivenDiscordance: number,
): number {
  const discordances = binomialProbabilities(cases, discordanceProbability);
  return discordances.reduce(
    (power, probability, discordant) =>
      power +
      probability *
        conditionalGateProbability(discordant, favorableGivenDiscordance),
    0,
  );
}

export function exactM4d1GatePower(
  cases: number,
  discordanceProbability: number,
  favorableGivenDiscordance: number,
): Result<number, M4d1DesignFailure> {
  if (
    !Number.isSafeInteger(cases) ||
    cases < 1 ||
    !Number.isFinite(discordanceProbability) ||
    discordanceProbability < 0 ||
    discordanceProbability > 1 ||
    !Number.isFinite(favorableGivenDiscordance) ||
    favorableGivenDiscordance < 0.5 ||
    favorableGivenDiscordance > 1
  )
    return err(
      designFailure(
        "INVALID_POWER_INPUT",
        "Power inputs require positive safe cases and probabilities in their declared ranges.",
      ),
    );
  return ok(
    exactM4d1GatePowerUnchecked(
      cases,
      discordanceProbability,
      favorableGivenDiscordance,
    ),
  );
}

function minimumCases(
  discordanceProbability: number,
  favorableGivenDiscordance: number,
): Result<
  Readonly<{ cases: number; power: number; previousPower: number }>,
  M4d1DesignFailure
> {
  let lower = 20;
  let upper = 40;
  while (
    upper < 10_000 &&
    exactM4d1GatePowerUnchecked(
      upper,
      discordanceProbability,
      favorableGivenDiscordance,
    ) < 0.9
  )
    upper *= 2;
  if (upper > 10_000)
    return err(
      designFailure(
        "POWER_SEARCH_EXHAUSTED",
        "Exact power target was not reached within 10,000 cases.",
      ),
    );
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (
      exactM4d1GatePowerUnchecked(
        middle,
        discordanceProbability,
        favorableGivenDiscordance,
      ) >= 0.9
    )
      upper = middle;
    else lower = middle + 1;
  }
  return ok({
    cases: lower,
    power: exactM4d1GatePowerUnchecked(
      lower,
      discordanceProbability,
      favorableGivenDiscordance,
    ),
    previousPower: exactM4d1GatePowerUnchecked(
      lower - 1,
      discordanceProbability,
      favorableGivenDiscordance,
    ),
  });
}

function roundedProbability(value: number): number {
  return Number(value.toFixed(12));
}

export async function designM4d1Power(): Promise<
  Result<M4d1PowerDesign, M4d1DesignFailure>
> {
  const contradiction = minimumCases(1 / 20, 2 / 3);
  if (!contradiction.ok) return contradiction;
  const retraction = minimumCases(3 / 20, 4 / 5);
  if (!retraction.ok) return retraction;
  const body = m4d1PowerDesignBodySchema.parse({
    protocol: "m4d1-exact-paired-power-design/1",
    baselineCommit: "ad875ca89608e3b3d9f1fd44bc7e342af51748e3",
    evidenceBasis: "frozen-m3-development-discordances",
    provider: "anthropic",
    repetitions: 2,
    targetPowerPerHypothesisPerRepetition: 0.9,
    minimumDiscordantPairs: 20,
    familyAlphaPerRepetition: 0.05,
    multiplicity: "holm-two-primary-hypotheses",
    designAlpha: 0.025,
    pairedTest: "exact-two-sided-mcnemar",
    effectConvention:
      "minimum-repetition-discordance-rate-and-add-one-shrunk-direction",
    hypotheses: [
      {
        id: "anthropic-contradiction-graph-facts-vs-lexical",
        category: "contradiction",
        candidateView: "graph-facts",
        comparatorView: "lexical-facts",
        development: [
          {
            repetition: 1,
            matchedCases: 20,
            favorableDiscordances: 1,
            adverseDiscordances: 0,
          },
          {
            repetition: 2,
            matchedCases: 20,
            favorableDiscordances: 1,
            adverseDiscordances: 0,
          },
        ],
        conservativeDiscordanceProbability: 1 / 20,
        conservativeFavorableGivenDiscordance: 2 / 3,
        minimumCasesPerRepetition: contradiction.value.cases,
        achievedExactPower: roundedProbability(contradiction.value.power),
        previousSampleExactPower: roundedProbability(
          contradiction.value.previousPower,
        ),
      },
      {
        id: "anthropic-retraction-typed-graph-vs-lexical",
        category: "retraction",
        candidateView: "graph-typed",
        comparatorView: "lexical-facts",
        development: [
          {
            repetition: 1,
            matchedCases: 20,
            favorableDiscordances: 3,
            adverseDiscordances: 0,
          },
          {
            repetition: 2,
            matchedCases: 20,
            favorableDiscordances: 5,
            adverseDiscordances: 0,
          },
        ],
        conservativeDiscordanceProbability: 3 / 20,
        conservativeFavorableGivenDiscordance: 4 / 5,
        minimumCasesPerRepetition: retraction.value.cases,
        achievedExactPower: roundedProbability(retraction.value.power),
        previousSampleExactPower: roundedProbability(
          retraction.value.previousPower,
        ),
      },
    ],
    proposedCorpus: {
      contradictionCases: contradiction.value.cases,
      retractionCases: retraction.value.cases,
      uniqueCases: contradiction.value.cases + retraction.value.cases,
      initialCalls:
        (contradiction.value.cases + retraction.value.cases) * 2 * 2,
      practicalMaximumUniqueCases: 500,
      status: "blocked-impractical-sample-size",
      finalCorpusGenerated: false,
    },
    analysis: {
      providersPooled: false,
      repetitionsPooled: false,
      hypothesesIndependent: true,
      bothRepetitionsMustPass: true,
      correctDirectionRequired: true,
      repairsCanRescuePrimary: false,
      combinedAdaptivePolicyEndpoint: "secondary",
    },
  });
  const identified = await digestValue(body);
  return identified.ok
    ? ok(
        m4d1PowerDesignSchema.parse({
          ...body,
          designDigest: identified.value,
        }),
      )
    : err(
        designFailure("IDENTITY_FAILURE", "Power design cannot be identified."),
      );
}

export const m4d1SharedConditionInputSchema = z
  .strictObject({
    conditionId: identifierSchema,
    provider: m4ProviderSchema,
    repetition: repetitionSchema,
    policyId: identifierSchema,
    request: m4d1OracleRequestSchema,
  })
  .readonly();

const sharedConditionSchema = z
  .strictObject({
    sharedConditionDigest: digestSchema,
    provider: m4ProviderSchema,
    repetition: repetitionSchema,
    requestDigest: digestSchema,
    request: m4d1OracleRequestSchema,
    policyMappings: z
      .array(
        z
          .strictObject({
            conditionId: identifierSchema,
            policyId: identifierSchema,
          })
          .readonly(),
      )
      .min(1)
      .readonly(),
  })
  .readonly();

export type M4d1SharedCondition = z.infer<typeof sharedConditionSchema>;

export async function deduplicateM4d1VisibleRequests(
  input: ReadonlyArray<unknown>,
): Promise<Result<ReadonlyArray<M4d1SharedCondition>, M4d1DesignFailure>> {
  const parsed = z.array(m4d1SharedConditionInputSchema).safeParse(input);
  if (!parsed.success)
    return err(
      designFailure(
        "INVALID_SHARED_CONDITION",
        "Shared visible-request conditions are invalid.",
      ),
    );
  const grouped = new Map<
    string,
    Readonly<{
      provider: M4Provider;
      repetition: 1 | 2;
      requestDigest: string;
      request: M4d1OracleRequest;
      mappings: Array<Readonly<{ conditionId: string; policyId: string }>>;
    }>
  >();
  for (const condition of parsed.data) {
    const requestDigest = await digestValue(condition.request);
    if (!requestDigest.ok)
      return err(
        designFailure(
          "IDENTITY_FAILURE",
          "Visible request cannot be identified.",
        ),
      );
    const key = `${condition.provider}/${condition.repetition}/${requestDigest.value}`;
    const existing = grouped.get(key);
    if (existing === undefined)
      grouped.set(key, {
        provider: condition.provider,
        repetition: condition.repetition,
        requestDigest: requestDigest.value,
        request: condition.request,
        mappings: [
          { conditionId: condition.conditionId, policyId: condition.policyId },
        ],
      });
    else
      existing.mappings.push({
        conditionId: condition.conditionId,
        policyId: condition.policyId,
      });
  }
  const output: Array<M4d1SharedCondition> = [];
  for (const entry of [...grouped.values()].toSorted((left, right) =>
    `${left.provider}/${left.repetition}/${left.requestDigest}`.localeCompare(
      `${right.provider}/${right.repetition}/${right.requestDigest}`,
    ),
  )) {
    const policyMappings = entry.mappings.toSorted((left, right) =>
      `${left.policyId}/${left.conditionId}`.localeCompare(
        `${right.policyId}/${right.conditionId}`,
      ),
    );
    const sharedConditionDigest = await digestValue({
      provider: entry.provider,
      repetition: entry.repetition,
      requestDigest: entry.requestDigest,
      policyMappings,
    });
    if (!sharedConditionDigest.ok)
      return err(
        designFailure(
          "IDENTITY_FAILURE",
          "Shared condition cannot be identified.",
        ),
      );
    output.push(
      sharedConditionSchema.parse({
        sharedConditionDigest: sharedConditionDigest.value,
        provider: entry.provider,
        repetition: entry.repetition,
        requestDigest: entry.requestDigest,
        request: entry.request,
        policyMappings,
      }),
    );
  }
  return ok(output);
}

export type M4d1StagedAdapterConfiguration = Readonly<{
  identity: M3bOracleIdentity;
  outputJsonSchema: Exclude<Parameters<typeof z.fromJSONSchema>[0], boolean>;
  renderRequest: (request: M4d1OracleRequest) => string;
  decodeWire: (text: string) => M4d1WireDecodeResult;
  validateOutput: (
    value: unknown,
  ) => Result<M4d1OracleOutput, ReadonlyArray<M4DiagnosticIssue>>;
}>;

export function validateM4d1WireOutput(
  value: unknown,
): Result<M4d1OracleOutput, ReadonlyArray<M4DiagnosticIssue>> {
  const parsed = m4OracleAnswerSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(
        parsed.error.issues.slice(0, 64).map((issue) => ({
          code: issue.code,
          path: issue.path.flatMap((part) =>
            typeof part === "string" || typeof part === "number" ? [part] : [],
          ),
        })),
      );
}

export type M4d1StagedFailure = Readonly<{
  code: M3bOracleFailureCode;
  provenance: M3bAttemptProvenance;
}>;

export function validateM4d1OracleIdentity(
  input: unknown,
): Result<M3bOracleIdentity, M4d1DesignFailure> {
  const parsed = m3bOracleIdentitySchema.safeParse(input);
  return parsed.success
    ? ok(parsed.data)
    : err(designFailure("INVALID_POWER_INPUT", "Oracle identity is invalid."));
}

export const M4D1_CORPUS_DISJOINTNESS_REQUIREMENTS = Object.freeze({
  version: "1",
  compareAgainst:
    "all-m1-through-m4-development-calibration-stress-and-heldout",
  zeroOverlap: Object.freeze([
    "fixture-identities",
    "entities",
    "exact-instructions",
    "normalized-instructions",
    "exact-fact-wording",
    "answers",
    "exact-graph-structures",
    "neighborhood-identities",
  ]),
  generationStatus: "blocked-pending-practical-power-redesign",
  finalCorpusGenerated: false,
});
