import { digestValue, err, ok, type Result } from "@nicia-ai/lachesis";

import {
  type EvidenceNeighborhood,
  type EvidencePath,
  type EvidenceSource,
  selectEvidence,
} from "./contract.js";
import type { M3a1Category, M3aTask } from "./corpus.js";
import type { EvidenceGraph } from "./graph.js";

export type M3a1AuditIssue = Readonly<{
  code:
    | "INVALID_GROUND_TRUTH"
    | "DUPLICATE_TASK"
    | "QUERY_LEAKAGE"
    | "QUERY_INSTRUCTION_MISMATCH"
    | "SOURCE_FAILURE"
    | "NONDETERMINISTIC_SELECTION"
    | "FACTORIAL_FACT_MISMATCH"
    | "RETRIEVAL_EXPECTATION_MISMATCH"
    | "RELATIONSHIP_ENCODING_MISMATCH"
    | "NEGATIVE_CONTROL_MISMATCH"
    | "BOUND_RECONCILIATION_FAILURE"
    | "MISSING_CATEGORY";
  taskId: string | null;
  message: string;
}>;

export type M3a1BlindAuditCounts = Readonly<{
  tasks: number;
  developmentCases: number;
  heldoutCases: number;
  heldoutStructuralCases: number;
  heldoutNegativeControls: number;
  categoryCounts: ReadonlyArray<
    Readonly<{
      split: "development" | "heldout";
      category: M3a1Category;
      count: number;
    }>
  >;
  duplicateTaskIds: number;
  queryInstructionMismatches: number;
  answerBearingQueryLeaks: number;
  invalidGroundTruthReferences: number;
  passed: boolean;
}>;

export type M3a1Arm =
  "lexical-facts" | "graph-facts" | "graph-adjacency" | "graph-typed";

export type M3a1ArmMetrics = Readonly<{
  arm: M3a1Arm;
  factRecall: number;
  citationRecall: number;
  edgeRecall: number;
  edgeCitationRecall: number;
  pathRecall: number;
  selectedFacts: number;
  serializedBytes: number;
}>;

export type M3a1OfflineAuditReport = Readonly<{
  protocol: "m3a1-offline-audit/2";
  tasks: number;
  selections: number;
  deterministicSelections: number;
  boundedContexts: number;
  retrievalAdvantageTasks: number;
  retrievalParityTasks: number;
  relationshipEncodingTasks: number;
  negativeControlParity: number;
  arms: ReadonlyArray<M3a1ArmMetrics>;
  blindCounts: M3a1BlindAuditCounts;
  passed: true;
}>;

export type M3a1Sources = Readonly<{
  lexicalFacts: EvidenceSource;
  graphFacts: EvidenceSource;
  graphAdjacency: EvidenceSource;
  graphTyped: EvidenceSource;
}>;

type ArmSelection = Readonly<{
  arm: M3a1Arm;
  neighborhood: EvidenceNeighborhood;
}>;

type ArmScore = Readonly<{
  arm: M3a1Arm;
  factHits: number;
  factTotal: number;
  citationHits: number;
  citationTotal: number;
  edgeHits: number;
  edgeTotal: number;
  edgeCitationHits: number;
  edgeCitationTotal: number;
  pathHits: number;
  pathTotal: number;
  selectedFacts: number;
  serializedBytes: number;
}>;

function sourceMatchesArm(arm: M3a1Arm, source: EvidenceSource): boolean {
  const { encoding, selection } = source.identity;
  switch (arm) {
    case "lexical-facts":
      return selection === "lexical" && encoding === "facts";
    case "graph-facts":
      return selection === "graph" && encoding === "facts";
    case "graph-adjacency":
      return selection === "graph" && encoding === "untyped-adjacency";
    case "graph-typed":
      return selection === "graph" && encoding === "typed-relationships";
  }
}

function issue(
  code: M3a1AuditIssue["code"],
  taskId: string | null,
  message: string,
): M3a1AuditIssue {
  return { code, taskId, message };
}

function pathKey(path: EvidencePath): string {
  return `${path.factIds.join("/")}:${path.edgeIds.join("/")}`;
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en");
}

function taskLeaksAnswer(task: M3aTask): boolean {
  const query = normalized(task.query.text);
  return task.protectedAnswerTerms.some((term) =>
    query.includes(normalized(term)),
  );
}

function groundTruthReferenceFailures(
  graph: EvidenceGraph,
  tasks: ReadonlyArray<M3aTask>,
): number {
  const factIds = new Set(graph.facts.map((fact) => fact.id));
  const citationIds = new Set(graph.citations.map((citation) => citation.id));
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));
  return tasks.filter(
    (task) =>
      task.expectedFactIds.some((id) => !factIds.has(id)) ||
      task.expectedCitationIds.some((id) => !citationIds.has(id)) ||
      task.expectedEdgeIds.some((id) => !edgeIds.has(id)) ||
      task.expectedEdgeCitationIds.some((id) => !citationIds.has(id)) ||
      task.expectedPaths.some(
        (path) =>
          path.factIds.some((id) => !factIds.has(id)) ||
          path.edgeIds.some((id) => !edgeIds.has(id)),
      ),
  ).length;
}

export function blindM3a1IntegrityAudit(
  graph: EvidenceGraph,
  tasks: ReadonlyArray<M3aTask>,
): M3a1BlindAuditCounts {
  const taskIds = new Set<string>();
  let duplicateTaskIds = 0;
  for (const task of tasks) {
    if (taskIds.has(task.id)) duplicateTaskIds += 1;
    taskIds.add(task.id);
  }
  const splits: ReadonlyArray<M3aTask["split"]> = ["development", "heldout"];
  const categories: ReadonlyArray<M3a1Category> = [
    "multi-hop",
    "temporal",
    "contradiction",
    "provenance",
    "retraction",
    "negative-control",
  ];
  const categoryCounts = splits.flatMap((split) =>
    categories.map((category) => ({
      split,
      category,
      count: tasks.filter(
        (task) => task.split === split && task.category === category,
      ).length,
    })),
  );
  const developmentCases = tasks.filter(
    (task) => task.split === "development",
  ).length;
  const heldoutCases = tasks.length - developmentCases;
  const heldoutNegativeControls = tasks.filter(
    (task) => task.split === "heldout" && task.category === "negative-control",
  ).length;
  const queryInstructionMismatches = tasks.filter(
    (task) => task.query.text !== task.instruction,
  ).length;
  const answerBearingQueryLeaks = tasks.filter((task) =>
    taskLeaksAnswer(task),
  ).length;
  const invalidGroundTruthReferences = groundTruthReferenceFailures(
    graph,
    tasks,
  );
  return {
    tasks: tasks.length,
    developmentCases,
    heldoutCases,
    heldoutStructuralCases: heldoutCases - heldoutNegativeControls,
    heldoutNegativeControls,
    categoryCounts,
    duplicateTaskIds,
    queryInstructionMismatches,
    answerBearingQueryLeaks,
    invalidGroundTruthReferences,
    passed:
      duplicateTaskIds === 0 &&
      queryInstructionMismatches === 0 &&
      answerBearingQueryLeaks === 0 &&
      invalidGroundTruthReferences === 0 &&
      categoryCounts.every((item) => item.count > 0),
  };
}

function scoreSelection(task: M3aTask, selected: ArmSelection): ArmScore {
  const { context, usage } = selected.neighborhood;
  const factIds = new Set(context.facts.map((fact) => fact.id));
  const citationIds = new Set(context.citations.map((citation) => citation.id));
  const edgeIds = new Set(context.edges.map((edge) => edge.id));
  const pathKeys = new Set(context.paths.map((path) => pathKey(path)));
  return {
    arm: selected.arm,
    factHits: task.expectedFactIds.filter((id) => factIds.has(id)).length,
    factTotal: task.expectedFactIds.length,
    citationHits: task.expectedCitationIds.filter((id) => citationIds.has(id))
      .length,
    citationTotal: task.expectedCitationIds.length,
    edgeHits: task.expectedEdgeIds.filter((id) => edgeIds.has(id)).length,
    edgeTotal: task.expectedEdgeIds.length,
    edgeCitationHits: task.expectedEdgeCitationIds.filter((id) =>
      citationIds.has(id),
    ).length,
    edgeCitationTotal: task.expectedEdgeCitationIds.length,
    pathHits: task.expectedPaths.filter((path) => pathKeys.has(pathKey(path)))
      .length,
    pathTotal: task.expectedPaths.length,
    selectedFacts: context.facts.length,
    serializedBytes: usage.serializedBytes,
  };
}

function recall(hits: number, total: number): number {
  return total === 0 ? 1 : hits / total;
}

function metrics(
  arm: M3a1Arm,
  scores: ReadonlyArray<ArmScore>,
): M3a1ArmMetrics {
  const selected = scores.filter((score) => score.arm === arm);
  const sum = (field: keyof Omit<ArmScore, "arm">): number =>
    selected.reduce((total, score) => total + score[field], 0);
  return {
    arm,
    factRecall: recall(sum("factHits"), sum("factTotal")),
    citationRecall: recall(sum("citationHits"), sum("citationTotal")),
    edgeRecall: recall(sum("edgeHits"), sum("edgeTotal")),
    edgeCitationRecall: recall(
      sum("edgeCitationHits"),
      sum("edgeCitationTotal"),
    ),
    pathRecall: recall(sum("pathHits"), sum("pathTotal")),
    selectedFacts: sum("selectedFacts"),
    serializedBytes: sum("serializedBytes"),
  };
}

async function selectDeterministically(
  arm: M3a1Arm,
  source: EvidenceSource,
  task: M3aTask,
): Promise<Result<ArmSelection, M3a1AuditIssue>> {
  const first = await selectEvidence(source, task.query);
  const second = await selectEvidence(source, task.query);
  if (!first.ok || !second.ok)
    return err(
      issue("SOURCE_FAILURE", task.id, `${arm} failed offline selection.`),
    );
  const firstDigest = await digestValue(first.value);
  const secondDigest = await digestValue(second.value);
  if (
    !firstDigest.ok ||
    !secondDigest.ok ||
    firstDigest.value !== secondDigest.value
  )
    return err(
      issue(
        "NONDETERMINISTIC_SELECTION",
        task.id,
        `${arm} returned different neighborhoods for one query.`,
      ),
    );
  return ok({ arm, neighborhood: first.value });
}

function factIds(selection: ArmSelection): ReadonlyArray<string> {
  return selection.neighborhood.context.facts.map((fact) => fact.id);
}

function sameValues(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function validateFactorialTask(
  task: M3aTask,
  selections: ReadonlyArray<ArmSelection>,
  scores: ReadonlyArray<ArmScore>,
): ReadonlyArray<M3a1AuditIssue> {
  const issues: Array<M3a1AuditIssue> = [];
  const findSelection = (arm: M3a1Arm): ArmSelection | undefined =>
    selections.find((selection) => selection.arm === arm);
  const findScore = (arm: M3a1Arm): ArmScore | undefined =>
    scores.find((score) => score.arm === arm);
  const graphFacts = findSelection("graph-facts");
  const adjacency = findSelection("graph-adjacency");
  const typed = findSelection("graph-typed");
  const lexicalScore = findScore("lexical-facts");
  const graphScore = findScore("graph-facts");
  const adjacencyScore = findScore("graph-adjacency");
  const typedScore = findScore("graph-typed");
  if (
    graphFacts === undefined ||
    adjacency === undefined ||
    typed === undefined ||
    lexicalScore === undefined ||
    graphScore === undefined ||
    adjacencyScore === undefined ||
    typedScore === undefined
  )
    return [issue("SOURCE_FAILURE", task.id, "A factorial arm is missing.")];
  if (
    !sameValues(factIds(graphFacts), factIds(adjacency)) ||
    !sameValues(factIds(graphFacts), factIds(typed))
  )
    issues.push(
      issue(
        "FACTORIAL_FACT_MISMATCH",
        task.id,
        "Graph encoding arms selected different facts.",
      ),
    );
  const retrievalDifference = graphScore.factHits - lexicalScore.factHits;
  if (
    (task.retrievalAdvantageExpected && retrievalDifference <= 0) ||
    (!task.retrievalAdvantageExpected && retrievalDifference !== 0)
  )
    issues.push(
      issue(
        "RETRIEVAL_EXPECTATION_MISMATCH",
        task.id,
        "Observed fact selection does not match the frozen retrieval ablation.",
      ),
    );
  const adjacencyRelationshipsAreHidden =
    adjacency.neighborhood.context.edges.every(
      (edge) => edge.relationship === null,
    );
  const typedRelationshipsArePresent = typed.neighborhood.context.edges.every(
    (edge) => edge.relationship !== null,
  );
  if (
    adjacencyScore.edgeHits !== adjacencyScore.edgeTotal ||
    adjacencyScore.edgeCitationHits !== adjacencyScore.edgeCitationTotal ||
    adjacencyScore.pathHits !== 0 ||
    !adjacencyRelationshipsAreHidden ||
    typedScore.edgeHits !== typedScore.edgeTotal ||
    typedScore.edgeCitationHits !== typedScore.edgeCitationTotal ||
    typedScore.pathHits !== typedScore.pathTotal ||
    !typedRelationshipsArePresent
  )
    issues.push(
      issue(
        "RELATIONSHIP_ENCODING_MISMATCH",
        task.id,
        "Adjacency and typed encodings do not isolate relationship information.",
      ),
    );
  if (task.category === "negative-control") {
    const expected = task.expectedFactIds;
    if (
      selections.some((selection) => !sameValues(factIds(selection), expected))
    )
      issues.push(
        issue(
          "NEGATIVE_CONTROL_MISMATCH",
          task.id,
          "A factorial arm changed a negative-control fact selection.",
        ),
      );
  }
  if (
    selections.some(
      (selection) =>
        selection.neighborhood.usage.factCount > task.query.maxFacts ||
        selection.neighborhood.usage.citationCount > task.query.maxCitations ||
        selection.neighborhood.usage.edgeCount > task.query.maxEdges ||
        selection.neighborhood.usage.pathCount > task.query.maxPaths ||
        selection.neighborhood.usage.serializedBytes >
          task.query.maxSerializedBytes ||
        selection.neighborhood.usage.serializedTokenUpperBound >
          task.query.maxSerializedTokenUpperBound,
    )
  )
    issues.push(
      issue(
        "BOUND_RECONCILIATION_FAILURE",
        task.id,
        "An arm exceeded a frozen context bound.",
      ),
    );
  return issues;
}

export async function auditM3aOfflineDesign(input: {
  readonly graph: EvidenceGraph;
  readonly tasks: ReadonlyArray<M3aTask>;
  readonly sources: M3a1Sources;
}): Promise<Result<M3a1OfflineAuditReport, ReadonlyArray<M3a1AuditIssue>>> {
  const blindCounts = blindM3a1IntegrityAudit(input.graph, input.tasks);
  const issues: Array<M3a1AuditIssue> = [];
  if (!blindCounts.passed) {
    if (blindCounts.duplicateTaskIds > 0)
      issues.push(issue("DUPLICATE_TASK", null, "Task identities repeat."));
    if (blindCounts.queryInstructionMismatches > 0)
      issues.push(
        issue(
          "QUERY_INSTRUCTION_MISMATCH",
          null,
          "Selection queries differ from public instructions.",
        ),
      );
    if (blindCounts.answerBearingQueryLeaks > 0)
      issues.push(
        issue("QUERY_LEAKAGE", null, "Selection queries leak answer terms."),
      );
    if (blindCounts.invalidGroundTruthReferences > 0)
      issues.push(
        issue(
          "INVALID_GROUND_TRUTH",
          null,
          "Ground truth contains dangling evidence references.",
        ),
      );
    if (blindCounts.categoryCounts.some((item) => item.count === 0))
      issues.push(
        issue("MISSING_CATEGORY", null, "A split/category cell is empty."),
      );
    return err(issues);
  }

  const armSources: ReadonlyArray<
    Readonly<{ arm: M3a1Arm; source: EvidenceSource }>
  > = [
    { arm: "lexical-facts", source: input.sources.lexicalFacts },
    { arm: "graph-facts", source: input.sources.graphFacts },
    { arm: "graph-adjacency", source: input.sources.graphAdjacency },
    { arm: "graph-typed", source: input.sources.graphTyped },
  ];
  const identityIssues = armSources
    .filter((item) => !sourceMatchesArm(item.arm, item.source))
    .map((item) =>
      issue(
        "SOURCE_FAILURE",
        null,
        `${item.arm} has an incompatible selection or encoding identity.`,
      ),
    );
  if (identityIssues.length > 0) return err(identityIssues);
  const allScores: Array<ArmScore> = [];
  let deterministicSelections = 0;
  let boundedContexts = 0;
  let retrievalAdvantageTasks = 0;
  let retrievalParityTasks = 0;
  let relationshipEncodingTasks = 0;
  let negativeControlParity = 0;
  for (const task of input.tasks) {
    const selections: Array<ArmSelection> = [];
    for (const armSource of armSources) {
      const selection = await selectDeterministically(
        armSource.arm,
        armSource.source,
        task,
      );
      if (selection.ok) {
        selections.push(selection.value);
        deterministicSelections += 2;
        boundedContexts += 1;
      } else issues.push(selection.error);
    }
    const scores = selections.map((selection) =>
      scoreSelection(task, selection),
    );
    allScores.push(...scores);
    const taskIssues = validateFactorialTask(task, selections, scores);
    issues.push(...taskIssues);
    if (taskIssues.length === 0) {
      if (task.retrievalAdvantageExpected) retrievalAdvantageTasks += 1;
      else retrievalParityTasks += 1;
      if (task.relationshipEncodingExpected) relationshipEncodingTasks += 1;
      if (task.category === "negative-control") negativeControlParity += 1;
    }
  }
  if (issues.length > 0) return err(issues);
  const arms: ReadonlyArray<M3a1Arm> = [
    "lexical-facts",
    "graph-facts",
    "graph-adjacency",
    "graph-typed",
  ];
  return ok({
    protocol: "m3a1-offline-audit/2",
    tasks: input.tasks.length,
    selections: input.tasks.length * arms.length,
    deterministicSelections,
    boundedContexts,
    retrievalAdvantageTasks,
    retrievalParityTasks,
    relationshipEncodingTasks,
    negativeControlParity,
    arms: arms.map((arm) => metrics(arm, allScores)),
    blindCounts,
    passed: true,
  });
}
