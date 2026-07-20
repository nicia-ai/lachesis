import {
  auditM4d0PolicyViability,
  type M3a1Category,
  M3B_PREREGISTERED_CORPUS,
  type M3bArm,
  type M3bRecord,
  M4A_INITIAL_POLICY,
  type M4Provider,
} from "@nicia-ai/lachesis-evidence";
import { describe, expect, it } from "vitest";

const DIGEST = "0".repeat(64);
const REPORT_DIGEST = "1".repeat(64);
const EXPERIMENT_DIGEST =
  "7f0eff01ce6190d03c11ddca40f9d099eb9f24ba323811c7df7b764215e5edc5";
const ARMS: ReadonlyArray<M3bArm> = [
  "lexical-facts",
  "graph-facts",
  "graph-adjacency",
  "graph-typed",
];
const PROVIDERS: ReadonlyArray<M4Provider> = ["openai", "anthropic"];

const tasks = M3B_PREREGISTERED_CORPUS.filter(
  (task) => task.split === "heldout",
);

function categoryOrdinal(caseId: string, category: M3a1Category): number {
  return tasks
    .filter((task) => task.category === category)
    .findIndex((task) => task.id === caseId);
}

function firstAttemptSuccess(
  input: Readonly<{
    caseId: string;
    category: M3a1Category;
    provider: M4Provider;
    repetition: 0 | 1;
    arm: M3bArm;
  }>,
): boolean {
  if (input.provider === "openai") return true;
  const ordinal = categoryOrdinal(input.caseId, input.category);
  if (input.category === "contradiction")
    return input.arm === "lexical-facts" ? ordinal > 0 : true;
  if (input.category === "retraction") {
    if (input.arm === "lexical-facts")
      return ordinal >= (input.repetition === 0 ? 3 : 5);
    if (input.arm === "graph-facts")
      return input.repetition === 0 ? ordinal > 0 : true;
    if (input.arm === "graph-adjacency")
      return ordinal >= (input.repetition === 0 ? 1 : 2);
    return true;
  }
  if (input.category === "provenance" && input.arm === "graph-typed")
    return ordinal >= (input.repetition === 0 ? 4 : 3);
  return true;
}

function attempt(costUsdMicros: number): M3bRecord["attempts"][number] {
  return {
    kind: "success",
    output: {
      outcome: "answered",
      answerValues: ["value"],
      supportingFactIds: ["fact"],
      citationIds: ["citation"],
      pathIds: [],
    },
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      costUsdMicros,
      latencyMs: 10,
    },
    provenance: {
      stage: "wire-decoding",
      category: "accepted",
      providerStatusCode: null,
      providerErrorCode: null,
      providerResponseId: "fixture",
      finishReason: "stop",
      rawFinishReason: null,
      usageAvailable: true,
      outputPresent: true,
      outputDigest: DIGEST,
      outputSizeBytes: 1,
      outputTruncated: false,
      issues: [],
    },
  };
}

function viewCost(
  provider: M4Provider,
  category: M3a1Category,
  arm: M3bArm,
): number {
  if (
    provider === "anthropic" &&
    category === "contradiction" &&
    arm === "graph-facts"
  )
    return 90;
  switch (arm) {
    case "lexical-facts":
      return 100;
    case "graph-facts":
      return 110;
    case "graph-adjacency":
      return 120;
    case "graph-typed":
      return 130;
  }
}

function record(
  input: Readonly<{
    caseId: string;
    category: M3a1Category;
    provider: M4Provider;
    repetition: 0 | 1;
    arm: M3bArm;
  }>,
): M3bRecord {
  const firstSuccess = firstAttemptSuccess(input);
  const output = {
    outcome: "answered" as const,
    answerValues: ["value"],
    supportingFactIds: ["fact"],
    citationIds: ["citation"],
    pathIds: [],
  };
  const attempts = firstSuccess
    ? [viewCost(input.provider, input.category, input.arm)]
    : [
        viewCost(input.provider, input.category, input.arm),
        viewCost(input.provider, input.category, input.arm),
      ];
  return {
    key: `${input.caseId}/${input.provider}/${input.repetition}/${input.arm}`,
    experimentDigest: DIGEST,
    scheduleDigest: DIGEST,
    unitDigest: DIGEST,
    executionPosition: ARMS.indexOf(input.arm),
    predecessorArm: null,
    caseId: input.caseId,
    caseDigest: DIGEST,
    provider: input.provider,
    model: "fixture-model",
    modelIdentityDigest: DIGEST,
    repetition: input.repetition,
    arm: input.arm,
    source: {
      id: "fixture-source",
      version: "1",
      selection: input.arm === "lexical-facts" ? "lexical" : "graph",
      encoding:
        input.arm === "graph-adjacency"
          ? "untyped-adjacency"
          : input.arm === "graph-typed"
            ? "typed-relationships"
            : "facts",
      implementation: "fixture",
    },
    neighborhoodDigest: DIGEST,
    contextDigest: DIGEST,
    planHash: DIGEST,
    oraclePromptDigest: DIGEST,
    outputSchemaDigest: DIGEST,
    executionBinding: {
      experimentDigest: EXPERIMENT_DIGEST,
      phaseManifestDigest: DIGEST,
      pricingSnapshotDigest: DIGEST,
      providerBindings: PROVIDERS.map((provider) => ({
        provider,
        transportDigest: DIGEST,
        pricingEntryDigest: DIGEST,
      })),
    },
    attempts: attempts.map(attempt),
    firstAttemptOutput: output,
    firstAttemptSemanticValidationPassed: firstSuccess,
    firstAttemptSemanticIssues: [],
    firstAttemptEndToEndSuccess: firstSuccess,
    firstAttemptConditionalSemanticSuccess: firstSuccess,
    firstAttemptPathUtilizationSuccess: false,
    postWireRepairOutput: null,
    postWireRepairSuccess: false,
    terminalFailure: null,
    validOutput: true,
    output,
    semanticValidationPassed: true,
    semanticIssues: [],
    semanticProvenance: null,
    expectedOutcome: "answered",
    answerCorrect: true,
    citationsCorrect: true,
    relationshipCitationsCorrect: true,
    pathsCorrect: true,
    pathUtilized: false,
    pathUtilizationSuccess: false,
    endToEndSuccess: true,
    conditionalSemanticSuccess: true,
    semanticRepairCalls: firstSuccess ? 0 : 1,
    semanticRepairSucceeded: firstSuccess ? null : true,
    wireRepairCalls: 0,
    wireRepairSucceeded: null,
    digest: DIGEST,
  };
}

function matrix(): ReadonlyArray<M3bRecord> {
  return tasks.flatMap((task) =>
    PROVIDERS.flatMap((provider) =>
      ([0, 1] as const).flatMap((repetition) =>
        ARMS.map((arm) =>
          record({
            caseId: task.id,
            category: task.category,
            provider,
            repetition,
            arm,
          }),
        ),
      ),
    ),
  );
}

async function audit(
  recordsInput: unknown = matrix(),
  tasksInput: unknown = tasks,
  existingPolicyInput: unknown = M4A_INITIAL_POLICY,
) {
  return auditM4d0PolicyViability({
    recordsInput,
    tasksInput,
    existingPolicyInput,
    m3ExecutionReportDigest: REPORT_DIGEST,
  });
}

describe("M4d.0 evidence-policy viability audit", () => {
  it("rejects the existing coarse policy and isolates a stable small candidate", async () => {
    const result = await audit();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.matrix).toEqual({
      cases: 160,
      arms: 4,
      providers: 2,
      repetitions: 2,
      records: 2560,
    });
    expect(result.value.decision).toMatchObject({
      existingPolicyMateriallyWorseThanLexical: true,
      existingPolicyEligibleForM4d: false,
      directionallyStableNonLexicalBenefit: true,
      defensibleFutureHypothesis: true,
      recommendation: "reject-existing-freeze-exploratory-candidate",
    });
    expect(result.value.decision.materialFailures).toEqual([
      {
        provider: "anthropic",
        repetition: 1,
        category: "provenance",
        riskDifference: -0.2,
      },
      {
        provider: "anthropic",
        repetition: 2,
        category: "provenance",
        riskDifference: -0.15,
      },
    ]);
    expect(
      result.value.stableExploratoryPolicy.rules.filter(
        (rule) => rule.view !== "lexical-facts",
      ),
    ).toEqual([
      {
        provider: "anthropic",
        category: "contradiction",
        view: "graph-facts",
        reason: "stable-correctness-benefit",
      },
      {
        provider: "anthropic",
        category: "retraction",
        view: "graph-typed",
        reason: "stable-correctness-benefit",
      },
    ]);
    expect(result.value.strata).toHaveLength(120);
    expect(result.value.summaries).toHaveLength(20);
    expect(result.value.pairedContrasts).toHaveLength(420);
  });

  it("is independent of record order and canonicalizes policy rule order", async () => {
    const records = matrix();
    const first = await audit(records);
    const second = await audit(records.toReversed(), tasks.toReversed(), {
      ...M4A_INITIAL_POLICY,
      rules: M4A_INITIAL_POLICY.rules.toReversed(),
    });
    expect(first).toEqual(second);
  });

  it("does not use entities, instructions, answers, or hidden expectations as policy features", async () => {
    const original = await audit();
    const renamedTasks = tasks.map((task, index) => ({
      ...task,
      instruction: `Public instruction ${index}`,
      query: {
        ...task.query,
        text: `Public instruction ${index}`,
      },
      answerContract: {
        ...task.answerContract,
        anchorSubject: `public-anchor-${index}`,
      },
      expectedAnswerValues: task.expectedAnswerValues.map(
        (_, valueIndex) => `hidden-answer-${index}-${valueIndex}`,
      ),
      protectedAnswerTerms: task.protectedAnswerTerms.map(
        (_, valueIndex) => `hidden-term-${index}-${valueIndex}`,
      ),
      expectedFactIds: task.expectedFactIds.map(
        (_, valueIndex) => `hidden-fact-${index}-${valueIndex}`,
      ),
      expectedCitationIds: task.expectedCitationIds.map(
        (_, valueIndex) => `hidden-citation-${index}-${valueIndex}`,
      ),
      expectedEdgeIds: task.expectedEdgeIds.map(
        (_, valueIndex) => `hidden-edge-${index}-${valueIndex}`,
      ),
      expectedEdgeCitationIds: task.expectedEdgeCitationIds.map(
        (_, valueIndex) => `hidden-edge-citation-${index}-${valueIndex}`,
      ),
      expectedPaths: task.expectedPaths.map((path, pathIndex) => ({
        factIds: path.factIds.map(
          (_, valueIndex) =>
            `hidden-path-fact-${index}-${pathIndex}-${valueIndex}`,
        ),
        edgeIds: path.edgeIds.map(
          (_, valueIndex) =>
            `hidden-path-edge-${index}-${pathIndex}-${valueIndex}`,
        ),
      })),
    }));
    const renamed = await audit(matrix(), renamedTasks);
    expect(renamed).toEqual(original);
  });

  it("fails closed on incomplete matrices and missing usage", async () => {
    const records = matrix();
    expect(await audit(records.slice(1))).toMatchObject({
      ok: false,
      error: { code: "INVALID_RECORDS" },
    });
    const first = records[0];
    if (first === undefined)
      throw new Error("Expected an audit fixture record.");
    const firstAttempt = first.attempts[0];
    if (firstAttempt === undefined)
      throw new Error("Expected an audit fixture attempt.");
    const withoutUsage: M3bRecord = {
      ...first,
      attempts: [
        {
          kind: "failure",
          code: "provider-timeout",
          dispatchEvidence: "dispatched-usage-unknown",
          usage: null,
          provenance: {
            ...firstAttempt.provenance,
            stage: "transport",
            category: "timeout",
            usageAvailable: false,
            outputPresent: false,
            outputDigest: null,
            outputSizeBytes: null,
          },
        },
      ],
    };
    expect(await audit([withoutUsage, ...records.slice(1)])).toMatchObject({
      ok: false,
      error: { code: "MISSING_USAGE" },
    });
  });
});
