import { err, ok, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type EvidenceFact,
  type EvidenceNeighborhood,
  type EvidenceQuery,
  type EvidenceSource,
  type EvidenceSourceFailure,
  evidenceSourceIdentitySchema,
} from "./contract.js";
import {
  createInMemoryGraphEvidenceSource,
  type EvidenceGraph,
  evidenceGraphSchema,
} from "./graph.js";

export const textEvidenceChunkSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
    factId: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
    text: z.string().min(1),
  })
  .readonly();

export type TextEvidenceChunk = z.infer<typeof textEvidenceChunkSchema>;

function sourceFailure(message: string): EvidenceSourceFailure {
  return { code: "INVALID_SOURCE_DATA", message };
}

function renderFact(fact: EvidenceFact): string {
  const validity = [fact.validFrom, fact.validUntil]
    .filter((value) => value !== null)
    .join(" through ");
  return [
    fact.statement,
    `Subject: ${fact.subject}.`,
    `Predicate: ${fact.predicate}.`,
    `Object: ${fact.object}.`,
    `Status: ${fact.status}.`,
    validity.length === 0 ? "" : `Validity: ${validity}.`,
    `Citations: ${fact.citationIds.join(", ")}.`,
  ]
    .filter((value) => value.length > 0)
    .join(" ");
}

export function createMatchedTextChunks(
  graph: EvidenceGraph,
): ReadonlyArray<TextEvidenceChunk> {
  return graph.facts
    .map((fact) => ({
      id: `chunk-${fact.id}`,
      factId: fact.id,
      text: renderFact(fact),
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

function tokens(value: string): ReadonlySet<string> {
  return new Set(value.toLocaleLowerCase("en").match(/[a-z0-9]+/g) ?? []);
}

function chunkScore(
  queryTokens: ReadonlySet<string>,
  chunk: TextEvidenceChunk,
): number {
  const chunkTokens = tokens(chunk.text);
  let score = 0;
  for (const token of queryTokens) if (chunkTokens.has(token)) score += 1;
  return score;
}

function textNeighborhood(
  source: EvidenceSource["identity"],
  query: EvidenceQuery,
  graph: EvidenceGraph,
  chunks: ReadonlyArray<TextEvidenceChunk>,
): EvidenceNeighborhood {
  const queryTokens = tokens(query.text);
  const selectedChunks = chunks
    .toSorted((left, right) => {
      const scoreDifference =
        chunkScore(queryTokens, right) - chunkScore(queryTokens, left);
      return scoreDifference !== 0
        ? scoreDifference
        : left.id.localeCompare(right.id);
    })
    .slice(0, query.maxFacts);
  const selectedFactIds = new Set(selectedChunks.map((chunk) => chunk.factId));
  const facts = graph.facts
    .filter((fact) => selectedFactIds.has(fact.id))
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const selectedCitationIds = new Set(
    facts.flatMap((fact) => fact.citationIds),
  );
  const citations = graph.citations
    .filter((citation) => selectedCitationIds.has(citation.id))
    .toSorted((left, right) => left.id.localeCompare(right.id));
  return {
    queryId: query.id,
    source,
    facts,
    citations,
    edges: [],
    paths: [],
  };
}

export function createMatchedTextEvidenceSource(
  graphInput: unknown,
): Result<EvidenceSource, EvidenceSourceFailure> {
  const graph = evidenceGraphSchema.safeParse(graphInput);
  if (!graph.success)
    return err(sourceFailure("Matched text graph validation failed."));
  const graphValidation = createInMemoryGraphEvidenceSource(graph.data);
  if (!graphValidation.ok) return graphValidation;
  const chunks = createMatchedTextChunks(graph.data);
  const identity = evidenceSourceIdentitySchema.parse({
    id: graph.data.id,
    version: graph.data.version,
    substrate: "text",
    implementation: "matched-rendered-chunks/1",
  });
  return ok({
    identity,
    select: (query) =>
      Promise.resolve(
        ok(textNeighborhood(identity, query, graph.data, chunks)),
      ),
  });
}
