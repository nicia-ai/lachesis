import { digestValue, err, ok, type Result } from "@nicia-ai/lachesis";

import {
  type EvidenceNeighborhood,
  type EvidencePath,
  type EvidenceSource,
  selectEvidence,
} from "./contract.js";
import type { M3aTask } from "./corpus.js";
import type { EvidenceGraph } from "./graph.js";

export type M3aAuditIssue = Readonly<{
  code:
    | "INVALID_GROUND_TRUTH"
    | "DUPLICATE_TASK"
    | "SOURCE_FAILURE"
    | "NONDETERMINISTIC_SELECTION"
    | "GRAPH_GROUND_TRUTH_MISS"
    | "NEGATIVE_CONTROL_MISMATCH"
    | "MISSING_CATEGORY";
  taskId: string | null;
  message: string;
}>;

export type M3aTaskScore = Readonly<{
  taskId: string;
  substrate: "text" | "graph";
  factHits: number;
  factTotal: number;
  citationHits: number;
  citationTotal: number;
  pathHits: number;
  pathTotal: number;
  selectedFacts: number;
}>;

export type M3aSubstrateMetrics = Readonly<{
  substrate: "text" | "graph";
  factRecall: number;
  citationRecall: number;
  pathRecall: number;
  selectedFacts: number;
}>;

export type M3aOfflineAuditReport = Readonly<{
  protocol: "m3a-offline-audit/1";
  tasks: number;
  structuralTasks: number;
  negativeControls: number;
  deterministicSelections: number;
  taskScores: ReadonlyArray<M3aTaskScore>;
  text: M3aSubstrateMetrics;
  graph: M3aSubstrateMetrics;
  graphPathAdvantageTasks: number;
  negativeControlParity: number;
  passed: true;
}>;

function issue(
  code: M3aAuditIssue["code"],
  taskId: string | null,
  message: string,
): M3aAuditIssue {
  return { code, taskId, message };
}

function pathKey(path: EvidencePath): string {
  return `${path.factIds.join("/")}:${path.edgeIds.join("/")}`;
}

function scoreNeighborhood(
  task: M3aTask,
  neighborhood: EvidenceNeighborhood,
): M3aTaskScore {
  const factIds = new Set(neighborhood.facts.map((fact) => fact.id));
  const citationIds = new Set(
    neighborhood.citations.map((citation) => citation.id),
  );
  const pathKeys = new Set(neighborhood.paths.map((path) => pathKey(path)));
  return {
    taskId: task.id,
    substrate: neighborhood.source.substrate,
    factHits: task.expectedFactIds.filter((id) => factIds.has(id)).length,
    factTotal: task.expectedFactIds.length,
    citationHits: task.expectedCitationIds.filter((id) => citationIds.has(id))
      .length,
    citationTotal: task.expectedCitationIds.length,
    pathHits: task.expectedPaths.filter((path) => pathKeys.has(pathKey(path)))
      .length,
    pathTotal: task.expectedPaths.length,
    selectedFacts: neighborhood.facts.length,
  };
}

function metrics(
  substrate: "text" | "graph",
  scores: ReadonlyArray<M3aTaskScore>,
): M3aSubstrateMetrics {
  const selected = scores.filter((score) => score.substrate === substrate);
  const factHits = selected.reduce((total, score) => total + score.factHits, 0);
  const factTotal = selected.reduce(
    (total, score) => total + score.factTotal,
    0,
  );
  const citationHits = selected.reduce(
    (total, score) => total + score.citationHits,
    0,
  );
  const citationTotal = selected.reduce(
    (total, score) => total + score.citationTotal,
    0,
  );
  const pathHits = selected.reduce((total, score) => total + score.pathHits, 0);
  const pathTotal = selected.reduce(
    (total, score) => total + score.pathTotal,
    0,
  );
  return {
    substrate,
    factRecall: factTotal === 0 ? 1 : factHits / factTotal,
    citationRecall: citationTotal === 0 ? 1 : citationHits / citationTotal,
    pathRecall: pathTotal === 0 ? 1 : pathHits / pathTotal,
    selectedFacts: selected.reduce(
      (total, score) => total + score.selectedFacts,
      0,
    ),
  };
}

function validateGroundTruth(
  graph: EvidenceGraph,
  tasks: ReadonlyArray<M3aTask>,
): ReadonlyArray<M3aAuditIssue> {
  const issues: Array<M3aAuditIssue> = [];
  const factIds = new Set(graph.facts.map((fact) => fact.id));
  const citationIds = new Set(graph.citations.map((citation) => citation.id));
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));
  const taskIds = new Set<string>();
  for (const task of tasks) {
    if (taskIds.has(task.id))
      issues.push(
        issue("DUPLICATE_TASK", task.id, "Task identity is repeated."),
      );
    taskIds.add(task.id);
    const missingFact = task.expectedFactIds.find((id) => !factIds.has(id));
    const missingCitation = task.expectedCitationIds.find(
      (id) => !citationIds.has(id),
    );
    const missingPathFact = task.expectedPaths
      .flatMap((path) => path.factIds)
      .find((id) => !factIds.has(id));
    const missingPathEdge = task.expectedPaths
      .flatMap((path) => path.edgeIds)
      .find((id) => !edgeIds.has(id));
    if (
      missingFact !== undefined ||
      missingCitation !== undefined ||
      missingPathFact !== undefined ||
      missingPathEdge !== undefined
    )
      issues.push(
        issue(
          "INVALID_GROUND_TRUTH",
          task.id,
          "Task ground truth references evidence absent from the frozen graph.",
        ),
      );
  }
  const categories = new Set(tasks.map((task) => task.category));
  const requiredCategories: ReadonlyArray<M3aTask["category"]> = [
    "multi-hop",
    "temporal",
    "contradiction",
    "provenance",
    "retraction",
    "negative-control",
  ];
  for (const category of requiredCategories) {
    if (!categories.has(category))
      issues.push(
        issue(
          "MISSING_CATEGORY",
          null,
          `The deterministic corpus has no ${category} task.`,
        ),
      );
  }
  return issues;
}

async function selectDeterministically(
  source: EvidenceSource,
  task: M3aTask,
): Promise<
  Result<
    Readonly<{ neighborhood: EvidenceNeighborhood; deterministic: true }>,
    M3aAuditIssue
  >
> {
  const first = await selectEvidence(source, task.query);
  const second = await selectEvidence(source, task.query);
  if (!first.ok || !second.ok)
    return err(
      issue(
        "SOURCE_FAILURE",
        task.id,
        `${source.identity.substrate} source failed its offline selection audit.`,
      ),
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
        `${source.identity.substrate} source returned different neighborhoods for the same query.`,
      ),
    );
  return ok({ neighborhood: first.value, deterministic: true });
}

export async function auditM3aOfflineDesign(input: {
  readonly graph: EvidenceGraph;
  readonly tasks: ReadonlyArray<M3aTask>;
  readonly textSource: EvidenceSource;
  readonly graphSource: EvidenceSource;
}): Promise<Result<M3aOfflineAuditReport, ReadonlyArray<M3aAuditIssue>>> {
  const issues = [...validateGroundTruth(input.graph, input.tasks)];
  if (input.textSource.identity.substrate !== "text")
    issues.push(
      issue("SOURCE_FAILURE", null, "Text arm has a non-text identity."),
    );
  if (input.graphSource.identity.substrate !== "graph")
    issues.push(
      issue("SOURCE_FAILURE", null, "Graph arm has a non-graph identity."),
    );
  if (issues.length > 0) return err(issues);

  const taskScores: Array<M3aTaskScore> = [];
  let deterministicSelections = 0;
  let graphPathAdvantageTasks = 0;
  let negativeControlParity = 0;
  for (const task of input.tasks) {
    const text = await selectDeterministically(input.textSource, task);
    const graph = await selectDeterministically(input.graphSource, task);
    if (!text.ok) issues.push(text.error);
    if (!graph.ok) issues.push(graph.error);
    if (!text.ok || !graph.ok) continue;
    deterministicSelections += 2;
    const textScore = scoreNeighborhood(task, text.value.neighborhood);
    const graphScore = scoreNeighborhood(task, graph.value.neighborhood);
    taskScores.push(textScore, graphScore);
    if (
      graphScore.factHits !== graphScore.factTotal ||
      graphScore.citationHits !== graphScore.citationTotal ||
      graphScore.pathHits !== graphScore.pathTotal
    )
      issues.push(
        issue(
          "GRAPH_GROUND_TRUTH_MISS",
          task.id,
          "Reference graph selection missed frozen evidence ground truth.",
        ),
      );
    if (task.graphAdvantageExpected && graphScore.pathHits > textScore.pathHits)
      graphPathAdvantageTasks += 1;
    if (task.category === "negative-control") {
      const equal =
        textScore.factHits === graphScore.factHits &&
        textScore.citationHits === graphScore.citationHits &&
        textScore.selectedFacts === graphScore.selectedFacts;
      if (equal) negativeControlParity += 1;
      else
        issues.push(
          issue(
            "NEGATIVE_CONTROL_MISMATCH",
            task.id,
            "Graph and text sources diverged on a negative control.",
          ),
        );
    }
  }
  if (issues.length > 0) return err(issues);
  const structuralTasks = input.tasks.filter(
    (task) => task.category !== "negative-control",
  ).length;
  const negativeControls = input.tasks.length - structuralTasks;
  if (graphPathAdvantageTasks !== structuralTasks)
    return err([
      issue(
        "GRAPH_GROUND_TRUTH_MISS",
        null,
        "The generic graph arm did not add path evidence on every structural task.",
      ),
    ]);
  if (negativeControlParity !== negativeControls)
    return err([
      issue(
        "NEGATIVE_CONTROL_MISMATCH",
        null,
        "The generic graph arm changed a negative-control result.",
      ),
    ]);
  return ok({
    protocol: "m3a-offline-audit/1",
    tasks: input.tasks.length,
    structuralTasks,
    negativeControls,
    deterministicSelections,
    taskScores,
    text: metrics("text", taskScores),
    graph: metrics("graph", taskScores),
    graphPathAdvantageTasks,
    negativeControlParity,
    passed: true,
  });
}
