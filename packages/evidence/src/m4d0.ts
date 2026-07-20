import { digestValue, err, ok, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type M3a1Category,
  m3a1CategorySchema,
  m3aTaskSchema,
} from "./corpus.js";
import { type M3bRecord, m3bRecordSchema } from "./m3b.js";
import {
  classifyM4TaskCategory,
  type M4EvidenceCompilerPolicy,
  m4EvidenceCompilerPolicySchema,
  type M4EvidenceView,
  m4EvidenceViewSchema,
  type M4Provider,
  m4ProviderSchema,
} from "./m4.js";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const repetitionSchema = z.union([z.literal(1), z.literal(2)]);
const endpointSchema = z.enum([
  "first-attempt-end-to-end",
  "first-attempt-semantic",
  "final-repaired-reliability",
]);
const policyIdSchema = z.enum([
  "existing-m4a",
  "always-lexical-facts",
  "always-graph-facts",
  "always-graph-adjacency",
  "always-graph-typed",
]);

const rateSchema = z
  .strictObject({
    successes: z.number().int().nonnegative(),
    sampleCount: z.number().int().positive(),
    rate: z.number().min(0).max(1),
  })
  .readonly();

export const m4d0PolicyStratumSchema = z
  .strictObject({
    policy: policyIdSchema,
    provider: m4ProviderSchema,
    repetition: repetitionSchema,
    category: m3a1CategorySchema,
    selectedView: m4EvidenceViewSchema,
    firstAttemptEndToEnd: rateSchema,
    firstAttemptSemantic: rateSchema,
    finalRepairedReliability: rateSchema,
    wireRepairs: z.number().int().nonnegative(),
    semanticRepairs: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costUsdMicros: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
  })
  .readonly();

export const m4d0PolicySummarySchema = z
  .strictObject({
    policy: z.string().min(1),
    provider: m4ProviderSchema,
    repetition: repetitionSchema,
    firstAttemptEndToEnd: rateSchema,
    firstAttemptSemantic: rateSchema,
    finalRepairedReliability: rateSchema,
    wireRepairs: z.number().int().nonnegative(),
    semanticRepairs: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costUsdMicros: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
  })
  .readonly();

export const m4d0PairedContrastSchema = z
  .strictObject({
    policy: z.string().min(1),
    comparator: z.literal("always-lexical-facts"),
    provider: m4ProviderSchema,
    repetition: repetitionSchema,
    category: m3a1CategorySchema.nullable(),
    endpoint: endpointSchema,
    sampleCount: z.number().int().positive(),
    policyOnlySuccesses: z.number().int().nonnegative(),
    comparatorOnlySuccesses: z.number().int().nonnegative(),
    discordantPairs: z.number().int().nonnegative(),
    riskDifference: z.number().min(-1).max(1),
  })
  .readonly();

const derivedRuleSchema = z
  .strictObject({
    provider: m4ProviderSchema,
    category: m3a1CategorySchema,
    view: m4EvidenceViewSchema,
    reason: z.enum([
      "lexical-default",
      "higher-training-correctness",
      "at-least-10-percent-lower-cost-without-correctness-loss",
      "stable-correctness-benefit",
      "stable-cost-benefit-without-correctness-loss",
    ]),
  })
  .readonly();

const derivedPolicySchema = z
  .strictObject({
    id: z.string().min(1),
    trainingRepetition: repetitionSchema.nullable(),
    evaluationRepetition: repetitionSchema.nullable(),
    rules: z.array(derivedRuleSchema).length(12).readonly(),
    nonLexicalRuleCount: z.number().int().min(0).max(12),
    distinctViews: z.array(m4EvidenceViewSchema).min(1).max(4).readonly(),
    evaluation: z.array(m4d0PolicySummarySchema).length(4).readonly(),
    primaryContrasts: z.array(m4d0PairedContrastSchema).length(4).readonly(),
  })
  .readonly();

const materialFailureSchema = z
  .strictObject({
    provider: m4ProviderSchema,
    repetition: repetitionSchema,
    category: m3a1CategorySchema,
    riskDifference: z.number().max(-0.1),
  })
  .readonly();

const auditBodyObjectSchema = z.strictObject({
  protocol: z.literal("m4d0-evidence-policy-viability/1"),
  baselineCommit: z.literal("a52f39e32877bc8cac844d50409b4970b0a3019f"),
  m3ExperimentDigest: z.literal(
    "7f0eff01ce6190d03c11ddca40f9d099eb9f24ba323811c7df7b764215e5edc5",
  ),
  m3ExecutionReportDigest: digestSchema,
  evidenceBasis: z.literal("m3-development-only-counterfactual"),
  matrix: z
    .strictObject({
      cases: z.literal(160),
      arms: z.literal(4),
      providers: z.literal(2),
      repetitions: z.literal(2),
      records: z.literal(2560),
    })
    .readonly(),
  methodology: z
    .strictObject({
      primaryEndpoint: z.literal("first-attempt-end-to-end"),
      materialWorseRiskDifference: z.literal(-0.1),
      clearCostReductionFraction: z.literal(0.1),
      decisionsPoolProviders: z.literal(false),
      decisionsPoolRepetitions: z.literal(false),
      repairsCanRescuePrimaryComparison: z.literal(false),
      permittedPolicyFeatures: z.tuple([
        z.literal("provider"),
        z.literal("public-task-category"),
      ]),
    })
    .readonly(),
  existingPolicyDigest: digestSchema,
  strata: z.array(m4d0PolicyStratumSchema).length(120).readonly(),
  summaries: z.array(m4d0PolicySummarySchema).length(20).readonly(),
  pairedContrasts: z.array(m4d0PairedContrastSchema).length(420).readonly(),
  crossRepetitionPolicies: z.array(derivedPolicySchema).length(2).readonly(),
  stableExploratoryPolicy: derivedPolicySchema,
  decision: z
    .strictObject({
      existingPolicyMateriallyWorseThanLexical: z.boolean(),
      materialFailures: z.array(materialFailureSchema).readonly(),
      existingPolicyEligibleForM4d: z.boolean(),
      directionallyStableNonLexicalBenefit: z.boolean(),
      defensibleFutureHypothesis: z.boolean(),
      recommendation: z.enum([
        "advance-existing-policy",
        "reject-existing-freeze-exploratory-candidate",
        "lexical-by-default-close-adaptive-superiority",
      ]),
    })
    .readonly(),
});

const auditBodySchema = auditBodyObjectSchema.readonly();

export const m4d0AuditSchema = auditBodyObjectSchema
  .extend({ auditDigest: digestSchema })
  .readonly();

export const m4d0AuditFailureSchema = z
  .strictObject({
    code: z.enum([
      "INVALID_RECORDS",
      "INVALID_TASKS",
      "INVALID_POLICY",
      "MATRIX_MISMATCH",
      "MISSING_USAGE",
      "IDENTITY_FAILURE",
    ]),
    message: z.string().min(1),
  })
  .readonly();

export type M4d0PolicyStratum = z.infer<typeof m4d0PolicyStratumSchema>;
export type M4d0PolicySummary = z.infer<typeof m4d0PolicySummarySchema>;
export type M4d0PairedContrast = z.infer<typeof m4d0PairedContrastSchema>;
export type M4d0Audit = z.infer<typeof m4d0AuditSchema>;
export type M4d0AuditFailure = z.infer<typeof m4d0AuditFailureSchema>;

export const M4D0_AUDIT_PROTOCOL = Object.freeze({
  id: "m4d0-evidence-policy-viability",
  version: "1",
  baselineCommit: "a52f39e32877bc8cac844d50409b4970b0a3019f",
  m3ExperimentDigest:
    "7f0eff01ce6190d03c11ddca40f9d099eb9f24ba323811c7df7b764215e5edc5",
  primaryEndpoint: "first-attempt-end-to-end",
  materialWorseRiskDifference: -0.1,
  clearCostReductionFraction: 0.1,
  liveInferenceAuthorized: false,
  materializationAuthorized: false,
});

const PROVIDERS: ReadonlyArray<M4Provider> = ["openai", "anthropic"];
const REPETITIONS = [1, 2] as const;
const VIEWS: ReadonlyArray<M4EvidenceView> = [
  "lexical-facts",
  "graph-facts",
  "graph-adjacency",
  "graph-typed",
];
const CATEGORIES: ReadonlyArray<M3a1Category> = [
  "multi-hop",
  "temporal",
  "contradiction",
  "provenance",
  "retraction",
  "negative-control",
];

type Repetition = (typeof REPETITIONS)[number];
type Endpoint = z.infer<typeof endpointSchema>;
type PolicyId = z.infer<typeof policyIdSchema>;
type Task = z.infer<typeof m3aTaskSchema>;
type Rule = z.infer<typeof derivedRuleSchema>;

type IndexedRecord = Readonly<{
  task: Task;
  record: M3bRecord;
}>;

type RecordMetrics = Readonly<{
  firstAttemptEndToEnd: boolean;
  firstAttemptSemantic: boolean;
  finalRepairedReliability: boolean;
  wireRepairs: number;
  semanticRepairs: number;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
  latencyMs: number;
}>;

function failure(
  code: M4d0AuditFailure["code"],
  message: string,
): M4d0AuditFailure {
  return { code, message };
}

function matrixKey(
  caseId: string,
  provider: M4Provider,
  repetition: Repetition,
  view: M4EvidenceView,
): string {
  return `${caseId}\u0000${provider}\u0000${repetition}\u0000${view}`;
}

function fixedPolicyId(view: M4EvidenceView): PolicyId {
  switch (view) {
    case "lexical-facts":
      return "always-lexical-facts";
    case "graph-facts":
      return "always-graph-facts";
    case "graph-adjacency":
      return "always-graph-adjacency";
    case "graph-typed":
      return "always-graph-typed";
  }
}

function policyView(
  policy: M4EvidenceCompilerPolicy,
  provider: M4Provider,
  category: M3a1Category,
): M4EvidenceView {
  const taskClass = classifyM4TaskCategory(category);
  const rule = policy.rules.find(
    (candidate) =>
      candidate.provider === provider && candidate.taskClass === taskClass,
  );
  if (rule === undefined)
    throw new Error("Validated M4 policy has no applicable rule.");
  return rule.view;
}

function endpointValue(metrics: RecordMetrics, endpoint: Endpoint): boolean {
  switch (endpoint) {
    case "first-attempt-end-to-end":
      return metrics.firstAttemptEndToEnd;
    case "first-attempt-semantic":
      return metrics.firstAttemptSemantic;
    case "final-repaired-reliability":
      return metrics.finalRepairedReliability;
  }
}

function rate(
  successes: number,
  sampleCount: number,
): z.infer<typeof rateSchema> {
  return { successes, sampleCount, rate: successes / sampleCount };
}

function metricsForRecord(
  record: M3bRecord,
): Result<RecordMetrics, M4d0AuditFailure> {
  if (record.attempts.some((attempt) => attempt.usage === null))
    return err(
      failure(
        "MISSING_USAGE",
        "Every frozen M3 attempt must expose provider-reported usage.",
      ),
    );
  const usage = record.attempts.map((attempt) => attempt.usage);
  return ok({
    firstAttemptEndToEnd: record.firstAttemptEndToEndSuccess,
    firstAttemptSemantic: record.firstAttemptSemanticValidationPassed,
    finalRepairedReliability: record.endToEndSuccess,
    wireRepairs: record.wireRepairCalls ?? 0,
    semanticRepairs: record.semanticRepairCalls,
    inputTokens: usage.reduce(
      (total, item) => total + (item?.inputTokens ?? 0),
      0,
    ),
    outputTokens: usage.reduce(
      (total, item) => total + (item?.outputTokens ?? 0),
      0,
    ),
    costUsdMicros: usage.reduce(
      (total, item) => total + (item?.costUsdMicros ?? 0),
      0,
    ),
    latencyMs: usage.reduce((total, item) => total + (item?.latencyMs ?? 0), 0),
  });
}

function aggregate(
  policy: string,
  provider: M4Provider,
  repetition: Repetition,
  records: ReadonlyArray<Readonly<{ metrics: RecordMetrics }>>,
): M4d0PolicySummary {
  const sampleCount = records.length;
  return m4d0PolicySummarySchema.parse({
    policy,
    provider,
    repetition,
    firstAttemptEndToEnd: rate(
      records.filter((item) => item.metrics.firstAttemptEndToEnd).length,
      sampleCount,
    ),
    firstAttemptSemantic: rate(
      records.filter((item) => item.metrics.firstAttemptSemantic).length,
      sampleCount,
    ),
    finalRepairedReliability: rate(
      records.filter((item) => item.metrics.finalRepairedReliability).length,
      sampleCount,
    ),
    wireRepairs: records.reduce(
      (total, item) => total + item.metrics.wireRepairs,
      0,
    ),
    semanticRepairs: records.reduce(
      (total, item) => total + item.metrics.semanticRepairs,
      0,
    ),
    inputTokens: records.reduce(
      (total, item) => total + item.metrics.inputTokens,
      0,
    ),
    outputTokens: records.reduce(
      (total, item) => total + item.metrics.outputTokens,
      0,
    ),
    costUsdMicros: records.reduce(
      (total, item) => total + item.metrics.costUsdMicros,
      0,
    ),
    latencyMs: records.reduce(
      (total, item) => total + item.metrics.latencyMs,
      0,
    ),
  });
}

function contrast(
  policy: string,
  provider: M4Provider,
  repetition: Repetition,
  category: M3a1Category | null,
  endpoint: Endpoint,
  pairs: ReadonlyArray<
    Readonly<{ policy: RecordMetrics; comparator: RecordMetrics }>
  >,
): M4d0PairedContrast {
  const policyOnlySuccesses = pairs.filter(
    (pair) =>
      endpointValue(pair.policy, endpoint) &&
      !endpointValue(pair.comparator, endpoint),
  ).length;
  const comparatorOnlySuccesses = pairs.filter(
    (pair) =>
      !endpointValue(pair.policy, endpoint) &&
      endpointValue(pair.comparator, endpoint),
  ).length;
  return m4d0PairedContrastSchema.parse({
    policy,
    comparator: "always-lexical-facts",
    provider,
    repetition,
    category,
    endpoint,
    sampleCount: pairs.length,
    policyOnlySuccesses,
    comparatorOnlySuccesses,
    discordantPairs: policyOnlySuccesses + comparatorOnlySuccesses,
    riskDifference:
      (policyOnlySuccesses - comparatorOnlySuccesses) / pairs.length,
  });
}

function sortedViewsByCost(
  values: ReadonlyArray<
    Readonly<{ view: M4EvidenceView; summary: M4d0PolicySummary }>
  >,
): ReadonlyArray<
  Readonly<{ view: M4EvidenceView; summary: M4d0PolicySummary }>
> {
  return values.toSorted(
    (left, right) =>
      left.summary.costUsdMicros - right.summary.costUsdMicros ||
      VIEWS.indexOf(left.view) - VIEWS.indexOf(right.view),
  );
}

function ruleKey(provider: M4Provider, category: M3a1Category): string {
  return `${provider}/${category}`;
}

export async function auditM4d0PolicyViability(
  input: Readonly<{
    recordsInput: unknown;
    tasksInput: unknown;
    existingPolicyInput: unknown;
    m3ExecutionReportDigest: string;
  }>,
): Promise<Result<M4d0Audit, M4d0AuditFailure>> {
  const recordsResult = z
    .array(m3bRecordSchema)
    .length(2560)
    .readonly()
    .safeParse(input.recordsInput);
  if (!recordsResult.success)
    return err(failure("INVALID_RECORDS", "Frozen M3 records are invalid."));
  const tasksResult = z
    .array(m3aTaskSchema)
    .length(160)
    .readonly()
    .safeParse(input.tasksInput);
  if (!tasksResult.success)
    return err(failure("INVALID_TASKS", "Frozen M3 tasks are invalid."));
  const policyResult = m4EvidenceCompilerPolicySchema.safeParse(
    input.existingPolicyInput,
  );
  if (!policyResult.success)
    return err(failure("INVALID_POLICY", "The M4a policy is invalid."));
  const policy = m4EvidenceCompilerPolicySchema.parse({
    ...policyResult.data,
    rules: policyResult.data.rules.toSorted((left, right) =>
      `${left.provider}/${left.taskClass}`.localeCompare(
        `${right.provider}/${right.taskClass}`,
      ),
    ),
  });
  if (!digestSchema.safeParse(input.m3ExecutionReportDigest).success)
    return err(failure("IDENTITY_FAILURE", "The M3 report digest is invalid."));

  const tasks = tasksResult.data;
  if (
    new Set(tasks.map((task) => task.id)).size !== 160 ||
    tasks.some((task) => task.split !== "heldout")
  )
    return err(
      failure(
        "MATRIX_MISMATCH",
        "The M3 task matrix is not unique held-out data.",
      ),
    );
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const indexed = new Map<string, IndexedRecord>();
  for (const record of recordsResult.data) {
    const provider = m4ProviderSchema.safeParse(record.provider);
    const repetition =
      record.repetition === 0 ? 1 : record.repetition === 1 ? 2 : undefined;
    const task = taskById.get(record.caseId);
    if (
      !provider.success ||
      repetition === undefined ||
      task === undefined ||
      record.executionBinding?.experimentDigest !==
        M4D0_AUDIT_PROTOCOL.m3ExperimentDigest
    )
      return err(
        failure(
          "MATRIX_MISMATCH",
          "A frozen M3 record is outside the bound matrix.",
        ),
      );
    const key = matrixKey(record.caseId, provider.data, repetition, record.arm);
    if (indexed.has(key))
      return err(
        failure(
          "MATRIX_MISMATCH",
          "The frozen M3 matrix contains a duplicate cell.",
        ),
      );
    indexed.set(key, { task, record });
  }

  const get = (
    task: Task,
    provider: M4Provider,
    repetition: Repetition,
    view: M4EvidenceView,
  ): Result<RecordMetrics, M4d0AuditFailure> => {
    const item = indexed.get(matrixKey(task.id, provider, repetition, view));
    return item === undefined
      ? err(failure("MATRIX_MISMATCH", "The frozen M3 matrix is incomplete."))
      : metricsForRecord(item.record);
  };

  const policyChoices = new Map<string, M4EvidenceView>();
  for (const provider of PROVIDERS)
    for (const category of CATEGORIES)
      policyChoices.set(
        ruleKey(provider, category),
        policyView(policy, provider, category),
      );

  const policyDefinitions: ReadonlyArray<
    Readonly<{
      id: PolicyId;
      choose: (provider: M4Provider, category: M3a1Category) => M4EvidenceView;
    }>
  > = [
    {
      id: "existing-m4a",
      choose: (provider, category) => {
        const selected = policyChoices.get(ruleKey(provider, category));
        if (selected === undefined)
          throw new Error("Validated policy choice is missing.");
        return selected;
      },
    },
    ...VIEWS.map((view) => ({ id: fixedPolicyId(view), choose: () => view })),
  ];

  const selectedMetrics = new Map<string, RecordMetrics>();
  const selectionKey = (
    policy: string,
    task: Task,
    provider: M4Provider,
    repetition: Repetition,
  ): string => `${policy}\u0000${task.id}\u0000${provider}\u0000${repetition}`;

  for (const definition of policyDefinitions)
    for (const provider of PROVIDERS)
      for (const repetition of REPETITIONS)
        for (const task of tasks) {
          const view = definition.choose(provider, task.category);
          const selected = get(task, provider, repetition, view);
          if (!selected.ok) return selected;
          selectedMetrics.set(
            selectionKey(definition.id, task, provider, repetition),
            selected.value,
          );
        }

  const strata: Array<M4d0PolicyStratum> = [];
  const summaries: Array<M4d0PolicySummary> = [];
  const pairedContrasts: Array<M4d0PairedContrast> = [];
  for (const definition of policyDefinitions) {
    for (const provider of PROVIDERS) {
      for (const repetition of REPETITIONS) {
        const all = tasks.map((task) => ({
          metrics: selectedMetrics.get(
            selectionKey(definition.id, task, provider, repetition),
          ),
        }));
        if (all.some((item) => item.metrics === undefined))
          return err(
            failure("MATRIX_MISMATCH", "Policy selection is incomplete."),
          );
        const complete = all.flatMap((item) =>
          item.metrics === undefined ? [] : [{ metrics: item.metrics }],
        );
        summaries.push(
          aggregate(definition.id, provider, repetition, complete),
        );
        for (const category of CATEGORIES) {
          const categoryTasks = tasks.filter(
            (task) => task.category === category,
          );
          const categoryRecords = categoryTasks.flatMap((task) => {
            const metrics = selectedMetrics.get(
              selectionKey(definition.id, task, provider, repetition),
            );
            return metrics === undefined ? [] : [{ metrics }];
          });
          const summary = aggregate(
            definition.id,
            provider,
            repetition,
            categoryRecords,
          );
          strata.push(
            m4d0PolicyStratumSchema.parse({
              ...summary,
              category,
              selectedView: definition.choose(provider, category),
            }),
          );
          for (const endpoint of endpointSchema.options) {
            const pairs = categoryTasks.flatMap((task) => {
              const policyMetrics = selectedMetrics.get(
                selectionKey(definition.id, task, provider, repetition),
              );
              const comparatorMetrics = selectedMetrics.get(
                selectionKey(
                  "always-lexical-facts",
                  task,
                  provider,
                  repetition,
                ),
              );
              return policyMetrics === undefined ||
                comparatorMetrics === undefined
                ? []
                : [{ policy: policyMetrics, comparator: comparatorMetrics }];
            });
            pairedContrasts.push(
              contrast(
                definition.id,
                provider,
                repetition,
                category,
                endpoint,
                pairs,
              ),
            );
          }
        }
        for (const endpoint of endpointSchema.options) {
          const pairs = tasks.flatMap((task) => {
            const policyMetrics = selectedMetrics.get(
              selectionKey(definition.id, task, provider, repetition),
            );
            const comparatorMetrics = selectedMetrics.get(
              selectionKey("always-lexical-facts", task, provider, repetition),
            );
            return policyMetrics === undefined ||
              comparatorMetrics === undefined
              ? []
              : [{ policy: policyMetrics, comparator: comparatorMetrics }];
          });
          pairedContrasts.push(
            contrast(
              definition.id,
              provider,
              repetition,
              null,
              endpoint,
              pairs,
            ),
          );
        }
      }
    }
  }

  const fixedSummary = (
    view: M4EvidenceView,
    provider: M4Provider,
    repetition: Repetition,
    category: M3a1Category,
  ): M4d0PolicySummary => {
    const policy = fixedPolicyId(view);
    const categoryTasks = tasks.filter((task) => task.category === category);
    return aggregate(
      policy,
      provider,
      repetition,
      categoryTasks.flatMap((task) => {
        const metrics = selectedMetrics.get(
          selectionKey(policy, task, provider, repetition),
        );
        return metrics === undefined ? [] : [{ metrics }];
      }),
    );
  };

  const deriveRules = (trainingRepetition: Repetition): ReadonlyArray<Rule> =>
    PROVIDERS.flatMap((provider) =>
      CATEGORIES.map((category) => {
        const candidates = VIEWS.map((view) => ({
          view,
          summary: fixedSummary(view, provider, trainingRepetition, category),
        }));
        const lexical = candidates.find(
          (candidate) => candidate.view === "lexical-facts",
        );
        if (lexical === undefined)
          throw new Error("Lexical baseline is missing.");
        const bestSuccesses = Math.max(
          ...candidates.map(
            (candidate) => candidate.summary.firstAttemptEndToEnd.successes,
          ),
        );
        if (bestSuccesses > lexical.summary.firstAttemptEndToEnd.successes) {
          const selected = sortedViewsByCost(
            candidates.filter(
              (candidate) =>
                candidate.summary.firstAttemptEndToEnd.successes ===
                bestSuccesses,
            ),
          )[0];
          if (selected === undefined)
            throw new Error("Correctness candidate is missing.");
          return {
            provider,
            category,
            view: selected.view,
            reason: "higher-training-correctness" as const,
          };
        }
        const clearSavings = sortedViewsByCost(
          candidates.filter(
            (candidate) =>
              candidate.view !== "lexical-facts" &&
              candidate.summary.firstAttemptEndToEnd.successes ===
                lexical.summary.firstAttemptEndToEnd.successes &&
              candidate.summary.costUsdMicros <=
                lexical.summary.costUsdMicros * 0.9,
          ),
        )[0];
        return clearSavings === undefined
          ? {
              provider,
              category,
              view: "lexical-facts" as const,
              reason: "lexical-default" as const,
            }
          : {
              provider,
              category,
              view: clearSavings.view,
              reason:
                "at-least-10-percent-lower-cost-without-correctness-loss" as const,
            };
      }),
    );

  const evaluateRules = (
    id: string,
    rules: ReadonlyArray<Rule>,
    trainingRepetition: Repetition | null,
    evaluationRepetition: Repetition | null,
  ): z.infer<typeof derivedPolicySchema> => {
    const chosen = new Map(
      rules.map((rule) => [ruleKey(rule.provider, rule.category), rule.view]),
    );
    const evaluations: Array<M4d0PolicySummary> = [];
    const contrasts: Array<M4d0PairedContrast> = [];
    for (const provider of PROVIDERS) {
      for (const repetition of REPETITIONS) {
        const records = tasks.flatMap((task) => {
          const view = chosen.get(ruleKey(provider, task.category));
          if (view === undefined) return [];
          const policyMetrics = get(task, provider, repetition, view);
          const comparatorMetrics = get(
            task,
            provider,
            repetition,
            "lexical-facts",
          );
          return policyMetrics.ok && comparatorMetrics.ok
            ? [
                {
                  metrics: policyMetrics.value,
                  comparator: comparatorMetrics.value,
                },
              ]
            : [];
        });
        evaluations.push(aggregate(id, provider, repetition, records));
        contrasts.push(
          contrast(
            id,
            provider,
            repetition,
            null,
            "first-attempt-end-to-end",
            records.map((record) => ({
              policy: record.metrics,
              comparator: record.comparator,
            })),
          ),
        );
      }
    }
    return derivedPolicySchema.parse({
      id,
      trainingRepetition,
      evaluationRepetition,
      rules,
      nonLexicalRuleCount: rules.filter((rule) => rule.view !== "lexical-facts")
        .length,
      distinctViews: [...new Set(rules.map((rule) => rule.view))].toSorted(
        (left, right) => VIEWS.indexOf(left) - VIEWS.indexOf(right),
      ),
      evaluation: evaluations,
      primaryContrasts: contrasts,
    });
  };

  const crossRepetitionPolicies = REPETITIONS.map((trainingRepetition) => {
    const evaluationRepetition = trainingRepetition === 1 ? 2 : 1;
    return evaluateRules(
      `derived-repetition-${trainingRepetition}`,
      deriveRules(trainingRepetition),
      trainingRepetition,
      evaluationRepetition,
    );
  });

  const stableRules: ReadonlyArray<Rule> = PROVIDERS.flatMap((provider) =>
    CATEGORIES.map((category) => {
      const lexical = REPETITIONS.map((repetition) =>
        fixedSummary("lexical-facts", provider, repetition, category),
      );
      const candidates = VIEWS.filter((view) => view !== "lexical-facts")
        .map((view) => {
          const summaries = REPETITIONS.map((repetition) =>
            fixedSummary(view, provider, repetition, category),
          );
          const improvements = summaries.map(
            (summary, index) =>
              summary.firstAttemptEndToEnd.successes -
              (lexical[index]?.firstAttemptEndToEnd.successes ?? 0),
          );
          const correctnessBenefit = improvements.every(
            (improvement) => improvement > 0,
          );
          const costBenefit =
            improvements.every((improvement) => improvement === 0) &&
            summaries.every(
              (summary, index) =>
                summary.costUsdMicros <=
                (lexical[index]?.costUsdMicros ?? 0) * 0.9,
            );
          return {
            view,
            summaries,
            improvements,
            correctnessBenefit,
            costBenefit,
          };
        })
        .filter(
          (candidate) => candidate.correctnessBenefit || candidate.costBenefit,
        )
        .toSorted((left, right) => {
          const leftMinimum = Math.min(...left.improvements);
          const rightMinimum = Math.min(...right.improvements);
          const leftTotal = left.improvements.reduce(
            (total, value) => total + value,
            0,
          );
          const rightTotal = right.improvements.reduce(
            (total, value) => total + value,
            0,
          );
          const leftCost = left.summaries.reduce(
            (total, summary) => total + summary.costUsdMicros,
            0,
          );
          const rightCost = right.summaries.reduce(
            (total, summary) => total + summary.costUsdMicros,
            0,
          );
          return (
            rightMinimum - leftMinimum ||
            rightTotal - leftTotal ||
            leftCost - rightCost ||
            VIEWS.indexOf(left.view) - VIEWS.indexOf(right.view)
          );
        });
      const selected = candidates[0];
      return selected === undefined
        ? {
            provider,
            category,
            view: "lexical-facts" as const,
            reason: "lexical-default" as const,
          }
        : {
            provider,
            category,
            view: selected.view,
            reason: selected.correctnessBenefit
              ? ("stable-correctness-benefit" as const)
              : ("stable-cost-benefit-without-correctness-loss" as const),
          };
    }),
  );
  const stableExploratoryPolicy = evaluateRules(
    "stable-exploratory-policy",
    stableRules,
    null,
    null,
  );

  const materialFailures = pairedContrasts
    .filter(
      (item) =>
        item.policy === "existing-m4a" &&
        item.endpoint === "first-attempt-end-to-end" &&
        item.category !== null &&
        item.riskDifference <= M4D0_AUDIT_PROTOCOL.materialWorseRiskDifference,
    )
    .map((item) => ({
      provider: item.provider,
      repetition: item.repetition,
      category: item.category ?? "negative-control",
      riskDifference: item.riskDifference,
    }));
  const existingPolicyMateriallyWorseThanLexical = materialFailures.length > 0;
  const directionallyStableNonLexicalBenefit =
    stableExploratoryPolicy.nonLexicalRuleCount > 0;
  const recommendation = existingPolicyMateriallyWorseThanLexical
    ? directionallyStableNonLexicalBenefit
      ? ("reject-existing-freeze-exploratory-candidate" as const)
      : ("lexical-by-default-close-adaptive-superiority" as const)
    : ("advance-existing-policy" as const);

  const existingPolicyDigest = await digestValue(policy);
  if (!existingPolicyDigest.ok)
    return err(failure("IDENTITY_FAILURE", "The M4a policy digest failed."));
  const body = auditBodySchema.parse({
    protocol: "m4d0-evidence-policy-viability/1",
    baselineCommit: M4D0_AUDIT_PROTOCOL.baselineCommit,
    m3ExperimentDigest: M4D0_AUDIT_PROTOCOL.m3ExperimentDigest,
    m3ExecutionReportDigest: input.m3ExecutionReportDigest,
    evidenceBasis: "m3-development-only-counterfactual",
    matrix: {
      cases: 160,
      arms: 4,
      providers: 2,
      repetitions: 2,
      records: 2560,
    },
    methodology: {
      primaryEndpoint: "first-attempt-end-to-end",
      materialWorseRiskDifference: -0.1,
      clearCostReductionFraction: 0.1,
      decisionsPoolProviders: false,
      decisionsPoolRepetitions: false,
      repairsCanRescuePrimaryComparison: false,
      permittedPolicyFeatures: ["provider", "public-task-category"],
    },
    existingPolicyDigest: existingPolicyDigest.value,
    strata,
    summaries,
    pairedContrasts,
    crossRepetitionPolicies,
    stableExploratoryPolicy,
    decision: {
      existingPolicyMateriallyWorseThanLexical,
      materialFailures,
      existingPolicyEligibleForM4d: !existingPolicyMateriallyWorseThanLexical,
      directionallyStableNonLexicalBenefit,
      defensibleFutureHypothesis: directionallyStableNonLexicalBenefit,
      recommendation,
    },
  });
  const auditDigest = await digestValue(body);
  return auditDigest.ok
    ? ok(m4d0AuditSchema.parse({ ...body, auditDigest: auditDigest.value }))
    : err(failure("IDENTITY_FAILURE", "The M4d.0 audit digest failed."));
}
