import { z } from "zod";

import type {
  evidenceCitationSchema,
  evidenceEdgeSchema,
  evidenceFactSchema,
} from "./contract.js";
import type { M3aTask } from "./corpus.js";
import { m3aTaskSchema } from "./corpus.js";
import type { EvidenceGraph } from "./graph.js";

type Fact = z.infer<typeof evidenceFactSchema>;
type Citation = z.infer<typeof evidenceCitationSchema>;
type Edge = z.infer<typeof evidenceEdgeSchema>;

export type M3b5HeldoutCorpus = Readonly<{
  tasks: ReadonlyArray<M3aTask>;
  facts: ReadonlyArray<Fact>;
  citations: ReadonlyArray<Citation>;
  edges: ReadonlyArray<Edge>;
  replacedFactIds: ReadonlySet<string>;
  replacedCitationIds: ReadonlySet<string>;
  replacedEdgeIds: ReadonlySet<string>;
}>;

function fixturePrefix(task: M3aTask): string {
  return task.id.replace(/^m3a1-/u, "");
}

function fixtureMembers<T extends Readonly<{ id: string }>>(
  values: ReadonlyArray<T>,
  task: M3aTask,
): ReadonlyArray<T> {
  const prefix = fixturePrefix(task);
  return values.filter((value) => value.id.includes(prefix));
}

function freshId(kind: "cite" | "edge" | "fact", id: string): string {
  const prefix = `${kind}-`;
  return id.startsWith(prefix)
    ? `${prefix}m3b5-${id.slice(prefix.length)}`
    : `${prefix}m3b5-${id}`;
}

function freshTaskId(id: string): string {
  return `m3a1-m3b5-${id.replace(/^m3a1-/u, "")}`;
}

function replacementMap(
  task: M3aTask,
  facts: ReadonlyArray<Fact>,
): ReadonlyMap<string, string> {
  const values = new Set([
    ...facts.flatMap((fact) => [fact.subject, fact.object]),
    task.answerContract.anchorSubject,
    ...task.expectedAnswerValues,
    ...task.protectedAnswerTerms,
  ]);
  const tag = fixturePrefix(task).replaceAll("-", "");
  return new Map(
    [...values]
      .toSorted((left, right) => left.localeCompare(right))
      .map((value, index) => [
        value,
        `m3b5${tag}${index.toString().padStart(2, "0")}${value}`,
      ]),
  );
}

function replaceValue(
  replacements: ReadonlyMap<string, string>,
  value: string,
): string {
  return replacements.get(value) ?? value;
}

function replaceText(
  replacements: ReadonlyMap<string, string>,
  value: string,
): string {
  return [...replacements.entries()]
    .toSorted(([left], [right]) => right.length - left.length)
    .reduce(
      (text, [original, replacement]) => text.replaceAll(original, replacement),
      value,
    );
}

function transformTask(input: {
  readonly task: M3aTask;
  readonly facts: ReadonlyArray<Fact>;
  readonly factIds: ReadonlyMap<string, string>;
  readonly citationIds: ReadonlyMap<string, string>;
  readonly edgeIds: ReadonlyMap<string, string>;
}): M3aTask {
  const replacements = replacementMap(input.task, input.facts);
  const instruction = `Using only the sealed M3b.5 evidence packet, ${replaceText(
    replacements,
    input.task.instruction,
  )}`;
  return m3aTaskSchema.parse({
    ...input.task,
    id: freshTaskId(input.task.id),
    instruction,
    query: {
      ...input.task.query,
      id: `query-m3b5-${input.task.query.id.replace(/^query-/u, "")}`,
      text: instruction,
      maxCitations: 24,
      maxEdges: 12,
      maxPaths: 10,
      maxHops: 4,
      maxSerializedBytes: 24_000,
      maxSerializedTokenUpperBound: 24_000,
    },
    answerContract: {
      ...input.task.answerContract,
      anchorSubject: replaceValue(
        replacements,
        input.task.answerContract.anchorSubject,
      ),
    },
    expectedAnswerValues: input.task.expectedAnswerValues.map((value) =>
      replaceValue(replacements, value),
    ),
    protectedAnswerTerms: input.task.protectedAnswerTerms.map((value) =>
      replaceValue(replacements, value),
    ),
    expectedFactIds: input.task.expectedFactIds.map(
      (id) => input.factIds.get(id) ?? id,
    ),
    expectedCitationIds: input.task.expectedCitationIds.map(
      (id) => input.citationIds.get(id) ?? id,
    ),
    expectedEdgeIds: input.task.expectedEdgeIds.map(
      (id) => input.edgeIds.get(id) ?? id,
    ),
    expectedEdgeCitationIds: input.task.expectedEdgeCitationIds.map(
      (id) => input.citationIds.get(id) ?? id,
    ),
    expectedPaths: input.task.expectedPaths.map((path) => ({
      factIds: path.factIds.map((id) => input.factIds.get(id) ?? id),
      edgeIds: path.edgeIds.map((id) => input.edgeIds.get(id) ?? id),
    })),
  });
}

export function createM3b5HeldoutCorpus(
  input: Readonly<{
    graph: EvidenceGraph;
    tasks: ReadonlyArray<M3aTask>;
  }>,
): M3b5HeldoutCorpus {
  const tasks: Array<M3aTask> = [];
  const facts: Array<Fact> = [];
  const citations: Array<Citation> = [];
  const edges: Array<Edge> = [];
  const replacedFactIds = new Set<string>();
  const replacedCitationIds = new Set<string>();
  const replacedEdgeIds = new Set<string>();
  for (const task of input.tasks) {
    const fixtureFacts = fixtureMembers(input.graph.facts, task);
    const fixtureCitations = fixtureMembers(input.graph.citations, task);
    const fixtureEdges = fixtureMembers(input.graph.edges, task);
    const factIds = new Map(
      fixtureFacts.map((fact) => [fact.id, freshId("fact", fact.id)]),
    );
    const citationIds = new Map(
      fixtureCitations.map((citation) => [
        citation.id,
        freshId("cite", citation.id),
      ]),
    );
    const edgeIds = new Map(
      fixtureEdges.map((edge) => [edge.id, freshId("edge", edge.id)]),
    );
    const replacements = replacementMap(task, fixtureFacts);
    for (const fact of fixtureFacts) {
      replacedFactIds.add(fact.id);
      facts.push({
        ...fact,
        id: factIds.get(fact.id) ?? fact.id,
        statement: `Sealed M3b.5 record: ${replaceText(
          replacements,
          fact.statement,
        )}`,
        subject: replaceValue(replacements, fact.subject),
        object: replaceValue(replacements, fact.object),
        citationIds: fact.citationIds.map((id) => citationIds.get(id) ?? id),
      });
    }
    for (const citation of fixtureCitations) {
      replacedCitationIds.add(citation.id);
      citations.push({
        ...citation,
        id: citationIds.get(citation.id) ?? citation.id,
        source: `m3b5-sealed-${citation.source}`,
        locator: `m3b5-sealed-${citation.locator}`,
      });
    }
    for (const edge of fixtureEdges) {
      replacedEdgeIds.add(edge.id);
      edges.push({
        ...edge,
        id: edgeIds.get(edge.id) ?? edge.id,
        fromFactId: factIds.get(edge.fromFactId) ?? edge.fromFactId,
        toFactId: factIds.get(edge.toFactId) ?? edge.toFactId,
        provenanceCitationIds: edge.provenanceCitationIds.map(
          (id) => citationIds.get(id) ?? id,
        ),
      });
    }
    tasks.push(
      transformTask({
        task,
        facts: fixtureFacts,
        factIds,
        citationIds,
        edgeIds,
      }),
    );
  }
  return {
    tasks: z.array(m3aTaskSchema).length(160).readonly().parse(tasks),
    facts: Object.freeze(facts),
    citations: Object.freeze(citations),
    edges: Object.freeze(edges),
    replacedFactIds,
    replacedCitationIds,
    replacedEdgeIds,
  };
}
