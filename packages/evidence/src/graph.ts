import { err, ok, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type EvidenceCitation,
  evidenceCitationSchema,
  type EvidenceEdge,
  evidenceEdgeSchema,
  type EvidenceFact,
  evidenceFactSchema,
  type EvidenceNeighborhood,
  type EvidencePath,
  type EvidenceQuery,
  type EvidenceSource,
  type EvidenceSourceFailure,
  evidenceSourceIdentitySchema,
} from "./contract.js";

export const evidenceGraphSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
    version: z.string().min(1),
    facts: z.array(evidenceFactSchema).readonly(),
    citations: z.array(evidenceCitationSchema).readonly(),
    edges: z.array(evidenceEdgeSchema).readonly(),
  })
  .readonly();

export type EvidenceGraph = z.infer<typeof evidenceGraphSchema>;

type GraphIndex = Readonly<{
  facts: ReadonlyMap<string, EvidenceFact>;
  citations: ReadonlyMap<string, EvidenceCitation>;
  edges: ReadonlyArray<EvidenceEdge>;
  incidentEdges: ReadonlyMap<string, ReadonlyArray<EvidenceEdge>>;
}>;

function sourceFailure(message: string): EvidenceSourceFailure {
  return { code: "INVALID_SOURCE_DATA", message };
}

function duplicateId(
  values: ReadonlyArray<Readonly<{ id: string }>>,
): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) return value.id;
    seen.add(value.id);
  }
  return undefined;
}

function buildGraphIndex(
  graph: EvidenceGraph,
): Result<GraphIndex, EvidenceSourceFailure> {
  const duplicateFact = duplicateId(graph.facts);
  if (duplicateFact !== undefined)
    return err(sourceFailure(`Duplicate evidence fact ${duplicateFact}.`));
  const duplicateCitation = duplicateId(graph.citations);
  if (duplicateCitation !== undefined)
    return err(
      sourceFailure(`Duplicate evidence citation ${duplicateCitation}.`),
    );
  const duplicateEdge = duplicateId(graph.edges);
  if (duplicateEdge !== undefined)
    return err(sourceFailure(`Duplicate evidence edge ${duplicateEdge}.`));

  const facts = new Map(graph.facts.map((fact) => [fact.id, fact]));
  const citations = new Map(
    graph.citations.map((citation) => [citation.id, citation]),
  );
  const incidentEdges = new Map<string, Array<EvidenceEdge>>();
  for (const fact of graph.facts) {
    for (const citationId of fact.citationIds) {
      if (!citations.has(citationId))
        return err(
          sourceFailure(
            `Evidence fact ${fact.id} references missing citation ${citationId}.`,
          ),
        );
    }
  }
  for (const edge of graph.edges) {
    if (!facts.has(edge.fromFactId) || !facts.has(edge.toFactId))
      return err(
        sourceFailure(`Evidence edge ${edge.id} references a missing fact.`),
      );
    for (const factId of [edge.fromFactId, edge.toFactId]) {
      const existing = incidentEdges.get(factId) ?? [];
      existing.push(edge);
      incidentEdges.set(factId, existing);
    }
  }
  return ok({
    facts,
    citations,
    edges: graph.edges.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ),
    incidentEdges: new Map(
      [...incidentEdges].map(([factId, edges]) => [
        factId,
        edges.toSorted((left, right) => left.id.localeCompare(right.id)),
      ]),
    ),
  });
}

function tokens(value: string): ReadonlySet<string> {
  return new Set(value.toLocaleLowerCase("en").match(/[a-z0-9]+/g) ?? []);
}

function lexicalScore(queryTokens: ReadonlySet<string>, fact: EvidenceFact) {
  const factTokens = tokens(
    `${fact.statement} ${fact.subject} ${fact.predicate} ${fact.object}`,
  );
  let score = 0;
  for (const token of queryTokens) if (factTokens.has(token)) score += 1;
  return score;
}

function validAt(fact: EvidenceFact, asOf: string | null): boolean {
  if (asOf === null) return fact.status === "active";
  return (
    (fact.validFrom === null || fact.validFrom <= asOf) &&
    (fact.validUntil === null || asOf < fact.validUntil) &&
    fact.status === "active"
  );
}

function rankedFacts(
  query: EvidenceQuery,
  index: GraphIndex,
): ReadonlyArray<EvidenceFact> {
  const queryTokens = tokens(query.text);
  return [...index.facts.values()].toSorted((left, right) => {
    const scoreDifference =
      lexicalScore(queryTokens, right) - lexicalScore(queryTokens, left);
    if (scoreDifference !== 0) return scoreDifference;
    const validityDifference =
      Number(validAt(right, query.asOf)) - Number(validAt(left, query.asOf));
    return validityDifference !== 0
      ? validityDifference
      : left.id.localeCompare(right.id);
  });
}

function otherEndpoint(edge: EvidenceEdge, factId: string): string {
  return edge.fromFactId === factId ? edge.toFactId : edge.fromFactId;
}

function selectConnectedFacts(
  query: EvidenceQuery,
  index: GraphIndex,
): ReadonlyArray<EvidenceFact> {
  const ranking = rankedFacts(query, index);
  const selected = new Set<string>();
  const queued = new Set<string>();
  const queue: Array<Readonly<{ factId: string; depth: number }>> = [];

  for (const seed of ranking) {
    if (selected.size >= query.maxFacts) break;
    if (queued.has(seed.id) || selected.has(seed.id)) continue;
    queue.push({ factId: seed.id, depth: 0 });
    queued.add(seed.id);
    while (queue.length > 0 && selected.size < query.maxFacts) {
      const current = queue.shift();
      if (current === undefined) break;
      selected.add(current.factId);
      if (current.depth >= query.maxHops) continue;
      for (const edge of index.incidentEdges.get(current.factId) ?? []) {
        const nextFactId = otherEndpoint(edge, current.factId);
        if (!selected.has(nextFactId) && !queued.has(nextFactId)) {
          queue.push({ factId: nextFactId, depth: current.depth + 1 });
          queued.add(nextFactId);
        }
      }
    }
  }
  return [...selected]
    .map((factId) => index.facts.get(factId))
    .filter((fact) => fact !== undefined)
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

function enumeratePaths(
  facts: ReadonlyArray<EvidenceFact>,
  edges: ReadonlyArray<EvidenceEdge>,
  maxHops: number,
): ReadonlyArray<EvidencePath> {
  if (maxHops === 0) return [];
  const selectedIds = new Set(facts.map((fact) => fact.id));
  const outgoing = new Map<string, Array<EvidenceEdge>>();
  for (const edge of edges) {
    if (!selectedIds.has(edge.fromFactId) || !selectedIds.has(edge.toFactId))
      continue;
    const existing = outgoing.get(edge.fromFactId) ?? [];
    existing.push(edge);
    outgoing.set(edge.fromFactId, existing);
  }
  const paths: Array<EvidencePath> = [];
  for (const start of facts) {
    const queue: Array<EvidencePath> = [{ factIds: [start.id], edgeIds: [] }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || current.edgeIds.length >= maxHops) continue;
      const end = current.factIds.at(-1);
      if (end === undefined) continue;
      for (const edge of (outgoing.get(end) ?? []).toSorted((left, right) =>
        left.id.localeCompare(right.id),
      )) {
        if (current.factIds.includes(edge.toFactId)) continue;
        const next = {
          factIds: [...current.factIds, edge.toFactId],
          edgeIds: [...current.edgeIds, edge.id],
        };
        paths.push(next);
        queue.push(next);
      }
    }
  }
  return paths.toSorted((left, right) =>
    `${left.factIds.join("/")}:${left.edgeIds.join("/")}`.localeCompare(
      `${right.factIds.join("/")}:${right.edgeIds.join("/")}`,
    ),
  );
}

function graphNeighborhood(
  source: EvidenceSource["identity"],
  query: EvidenceQuery,
  index: GraphIndex,
): EvidenceNeighborhood {
  const facts = selectConnectedFacts(query, index);
  const selectedIds = new Set(facts.map((fact) => fact.id));
  const edges = index.edges.filter(
    (edge) =>
      selectedIds.has(edge.fromFactId) && selectedIds.has(edge.toFactId),
  );
  const citationIds = new Set(facts.flatMap((fact) => fact.citationIds));
  const citations = [...citationIds]
    .map((citationId) => index.citations.get(citationId))
    .filter((citation) => citation !== undefined)
    .toSorted((left, right) => left.id.localeCompare(right.id));
  return {
    queryId: query.id,
    source,
    facts,
    citations,
    edges,
    paths: enumeratePaths(facts, edges, query.maxHops),
  };
}

export function createInMemoryGraphEvidenceSource(
  graphInput: unknown,
): Result<EvidenceSource, EvidenceSourceFailure> {
  const graph = evidenceGraphSchema.safeParse(graphInput);
  if (!graph.success)
    return err(sourceFailure("Evidence graph validation failed."));
  const index = buildGraphIndex(graph.data);
  if (!index.ok) return index;
  const identity = evidenceSourceIdentitySchema.parse({
    id: graph.data.id,
    version: graph.data.version,
    substrate: "graph",
    implementation: "in-memory-reference-graph/1",
  });
  return ok({
    identity,
    select: (query) =>
      Promise.resolve(ok(graphNeighborhood(identity, query, index.value))),
  });
}
