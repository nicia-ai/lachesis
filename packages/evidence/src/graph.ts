import { err, ok, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type EvidenceCitation,
  evidenceCitationSchema,
  type EvidenceContext,
  evidenceContextFitsQuery,
  type EvidenceEdge,
  evidenceEdgeSchema,
  type EvidenceEncoding,
  type EvidenceFact,
  evidenceFactSchema,
  type EvidenceNeighborhood,
  type EvidencePath,
  type EvidenceQuery,
  type EvidenceSource,
  type EvidenceSourceFailure,
  evidenceSourceIdentitySchema,
  isEvidenceFactBelievedAt,
  measureEvidenceContext,
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

type PathEnumeration = Readonly<{
  paths: ReadonlyArray<EvidencePath>;
  truncated: boolean;
}>;

function sourceFailure(
  message: string,
  code: EvidenceSourceFailure["code"] = "INVALID_SOURCE_DATA",
): EvidenceSourceFailure {
  return { code, message };
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
  const duplicateCitation = duplicateId(graph.citations);
  const duplicateEdge = duplicateId(graph.edges);
  if (
    duplicateFact !== undefined ||
    duplicateCitation !== undefined ||
    duplicateEdge !== undefined
  )
    return err(sourceFailure("Evidence graph identities must be unique."));

  const facts = new Map(graph.facts.map((fact) => [fact.id, fact]));
  const citations = new Map(
    graph.citations.map((citation) => [citation.id, citation]),
  );
  const incidentEdges = new Map<string, Array<EvidenceEdge>>();
  for (const fact of graph.facts) {
    if (fact.citationIds.some((citationId) => !citations.has(citationId)))
      return err(
        sourceFailure(`Evidence fact ${fact.id} has a missing citation.`),
      );
  }
  for (const edge of graph.edges) {
    if (
      !facts.has(edge.fromFactId) ||
      !facts.has(edge.toFactId) ||
      edge.provenanceCitationIds.some(
        (citationId) => !citations.has(citationId),
      )
    )
      return err(
        sourceFailure(`Evidence edge ${edge.id} has a dangling reference.`),
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

function lexicalScore(
  queryTokens: ReadonlySet<string>,
  fact: EvidenceFact,
): number {
  const factTokens = tokens(
    `${fact.statement} ${fact.subject} ${fact.predicate} ${fact.object}`,
  );
  let score = 0;
  for (const token of queryTokens) if (factTokens.has(token)) score += 1;
  return score;
}

export function rankEvidenceFacts(
  query: EvidenceQuery,
  facts: ReadonlyArray<EvidenceFact>,
): ReadonlyArray<EvidenceFact> {
  const queryTokens = tokens(query.text);
  return facts.toSorted((left, right) => {
    const scoreDifference =
      lexicalScore(queryTokens, right) - lexicalScore(queryTokens, left);
    if (scoreDifference !== 0) return scoreDifference;
    const beliefDifference =
      Number(isEvidenceFactBelievedAt(right, query)) -
      Number(isEvidenceFactBelievedAt(left, query));
    return beliefDifference !== 0
      ? beliefDifference
      : left.id.localeCompare(right.id);
  });
}

function otherEndpoint(edge: EvidenceEdge, factId: string): string {
  return edge.fromFactId === factId ? edge.toFactId : edge.fromFactId;
}

function graphRankedFacts(
  query: EvidenceQuery,
  index: GraphIndex,
): ReadonlyArray<EvidenceFact> {
  const ranking = rankEvidenceFacts(query, [...index.facts.values()]);
  const selected = new Set<string>();
  const queued = new Set<string>();
  const queue: Array<Readonly<{ factId: string; depth: number }>> = [];
  for (const seed of ranking) {
    if (selected.size >= query.maxFacts) break;
    if (selected.has(seed.id) || queued.has(seed.id)) continue;
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
    .filter((fact) => fact !== undefined);
}

function citationsFor(
  citationIds: ReadonlySet<string>,
  index: GraphIndex,
): ReadonlyArray<EvidenceCitation> {
  return [...citationIds]
    .map((citationId) => index.citations.get(citationId))
    .filter((citation) => citation !== undefined)
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

function emptyContext(): EvidenceContext {
  return { facts: [], citations: [], edges: [], paths: [] };
}

function contextFits(context: EvidenceContext, query: EvidenceQuery): boolean {
  const usage = measureEvidenceContext(context, false);
  return usage.ok && evidenceContextFitsQuery(usage.value, query);
}

function addBoundedFacts(
  candidates: ReadonlyArray<EvidenceFact>,
  query: EvidenceQuery,
  index: GraphIndex,
): Readonly<{ context: EvidenceContext; truncated: boolean }> {
  let context = emptyContext();
  let truncated = candidates.length > query.maxFacts;
  for (const fact of candidates) {
    if (context.facts.length >= query.maxFacts) {
      truncated = true;
      break;
    }
    const citationIds = new Set([
      ...context.citations.map((citation) => citation.id),
      ...fact.citationIds,
    ]);
    const candidate: EvidenceContext = {
      ...context,
      facts: [...context.facts, fact],
      citations: citationsFor(citationIds, index),
    };
    if (contextFits(candidate, query)) context = candidate;
    else truncated = true;
  }
  return { context, truncated };
}

function boundedEdges(
  context: EvidenceContext,
  query: EvidenceQuery,
  index: GraphIndex,
  encoding: EvidenceEncoding,
): Readonly<{ context: EvidenceContext; truncated: boolean }> {
  if (encoding === "facts") return { context, truncated: false };
  const selectedIds = new Set(context.facts.map((fact) => fact.id));
  const candidates = index.edges.filter(
    (edge) =>
      selectedIds.has(edge.fromFactId) && selectedIds.has(edge.toFactId),
  );
  let nextContext = context;
  let truncated = candidates.length > query.maxEdges;
  for (const edge of candidates) {
    if (nextContext.edges.length >= query.maxEdges) break;
    const encodedEdge: EvidenceEdge = {
      ...edge,
      relationship: encoding === "untyped-adjacency" ? null : edge.relationship,
    };
    const citationIds = new Set([
      ...nextContext.citations.map((citation) => citation.id),
      ...edge.provenanceCitationIds,
    ]);
    const candidate: EvidenceContext = {
      ...nextContext,
      citations: citationsFor(citationIds, index),
      edges: [...nextContext.edges, encodedEdge],
    };
    if (contextFits(candidate, query)) nextContext = candidate;
    else truncated = true;
  }
  return { context: nextContext, truncated };
}

function enumerateBoundedPaths(
  context: EvidenceContext,
  query: EvidenceQuery,
): PathEnumeration {
  if (query.maxHops === 0 || query.maxPaths === 0)
    return { paths: [], truncated: context.edges.length > 0 };
  const outgoing = new Map<string, Array<EvidenceEdge>>();
  for (const edge of context.edges) {
    const existing = outgoing.get(edge.fromFactId) ?? [];
    existing.push(edge);
    outgoing.set(edge.fromFactId, existing);
  }
  const paths: Array<EvidencePath> = [];
  let truncated = false;
  for (const start of context.facts) {
    const queue: Array<EvidencePath> = [{ factIds: [start.id], edgeIds: [] }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || current.edgeIds.length >= query.maxHops)
        continue;
      const end = current.factIds.at(-1);
      if (end === undefined) continue;
      for (const edge of (outgoing.get(end) ?? []).toSorted((left, right) =>
        left.id.localeCompare(right.id),
      )) {
        if (current.factIds.includes(edge.toFactId)) continue;
        if (paths.length >= query.maxPaths) {
          truncated = true;
          return { paths, truncated };
        }
        const next = {
          factIds: [...current.factIds, edge.toFactId],
          edgeIds: [...current.edgeIds, edge.id],
        };
        paths.push(next);
        queue.push(next);
      }
    }
  }
  return { paths, truncated };
}

function boundedPaths(
  context: EvidenceContext,
  query: EvidenceQuery,
  encoding: EvidenceEncoding,
): Readonly<{ context: EvidenceContext; truncated: boolean }> {
  if (encoding !== "typed-relationships") return { context, truncated: false };
  const enumeration = enumerateBoundedPaths(context, query);
  let nextContext = context;
  let truncated = enumeration.truncated;
  for (const path of enumeration.paths) {
    const candidate = { ...nextContext, paths: [...nextContext.paths, path] };
    if (contextFits(candidate, query)) nextContext = candidate;
    else truncated = true;
  }
  return { context: nextContext, truncated };
}

export function createBoundedNeighborhood(input: {
  readonly identity: EvidenceSource["identity"];
  readonly query: EvidenceQuery;
  readonly index: GraphIndex;
  readonly rankedFacts: ReadonlyArray<EvidenceFact>;
  readonly selectionTruncated: boolean;
}): Result<EvidenceNeighborhood, EvidenceSourceFailure> {
  const facts = addBoundedFacts(input.rankedFacts, input.query, input.index);
  if (facts.context.facts.length === 0)
    return err(
      sourceFailure(
        "The evidence budget cannot fit even one complete cited fact.",
        "CONTEXT_BUDGET_TOO_SMALL",
      ),
    );
  const edges = boundedEdges(
    facts.context,
    input.query,
    input.index,
    input.identity.encoding,
  );
  const paths = boundedPaths(
    edges.context,
    input.query,
    input.identity.encoding,
  );
  const truncated =
    input.selectionTruncated ||
    facts.truncated ||
    edges.truncated ||
    paths.truncated;
  const usage = measureEvidenceContext(paths.context, truncated);
  return usage.ok
    ? ok({
        queryId: input.query.id,
        source: input.identity,
        context: paths.context,
        usage: usage.value,
      })
    : usage;
}

function createGraphSource(
  graphInput: unknown,
  encoding: EvidenceEncoding,
): Result<EvidenceSource, EvidenceSourceFailure> {
  const graph = evidenceGraphSchema.safeParse(graphInput);
  if (!graph.success)
    return err(sourceFailure("Evidence graph validation failed."));
  const index = buildGraphIndex(graph.data);
  if (!index.ok) return index;
  const identity = evidenceSourceIdentitySchema.parse({
    id: graph.data.id,
    version: graph.data.version,
    selection: "graph",
    encoding,
    implementation: `in-memory-reference-graph/${encoding}/2`,
  });
  return ok({
    identity,
    select: (query) => {
      const rankedFacts = graphRankedFacts(query, index.value);
      return Promise.resolve(
        createBoundedNeighborhood({
          identity,
          query,
          index: index.value,
          rankedFacts,
          selectionTruncated: rankedFacts.length < index.value.facts.size,
        }),
      );
    },
  });
}

export function createGraphSelectedFactsEvidenceSource(
  graphInput: unknown,
): Result<EvidenceSource, EvidenceSourceFailure> {
  return createGraphSource(graphInput, "facts");
}

export function createGraphSelectedAdjacencyEvidenceSource(
  graphInput: unknown,
): Result<EvidenceSource, EvidenceSourceFailure> {
  return createGraphSource(graphInput, "untyped-adjacency");
}

export function createInMemoryGraphEvidenceSource(
  graphInput: unknown,
): Result<EvidenceSource, EvidenceSourceFailure> {
  return createGraphSource(graphInput, "typed-relationships");
}

export function validateEvidenceGraph(
  graphInput: unknown,
): Result<
  Readonly<{ graph: EvidenceGraph; index: GraphIndex }>,
  EvidenceSourceFailure
> {
  const graph = evidenceGraphSchema.safeParse(graphInput);
  if (!graph.success)
    return err(sourceFailure("Evidence graph validation failed."));
  const index = buildGraphIndex(graph.data);
  return index.ok ? ok({ graph: graph.data, index: index.value }) : index;
}
