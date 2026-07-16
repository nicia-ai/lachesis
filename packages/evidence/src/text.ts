import { err, ok, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type EvidenceFact,
  type EvidenceSource,
  type EvidenceSourceFailure,
  evidenceSourceIdentitySchema,
} from "./contract.js";
import {
  createBoundedNeighborhood,
  type EvidenceGraph,
  validateEvidenceGraph,
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
  return [
    fact.statement,
    `Subject: ${fact.subject}.`,
    `Predicate: ${fact.predicate}.`,
    `Object: ${fact.object}.`,
    `Valid from: ${fact.validFrom ?? "unbounded"}.`,
    `Valid until: ${fact.validUntil ?? "unbounded"}.`,
    `Recorded from: ${fact.recordedFrom}.`,
    `Recorded until: ${fact.recordedUntil ?? "current"}.`,
    `Citations: ${fact.citationIds.join(", ")}.`,
  ].join(" ");
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

function lexicalTokens(value: string): ReadonlySet<string> {
  return new Set(value.toLocaleLowerCase("en").match(/[a-z0-9]+/g) ?? []);
}

function chunkScore(
  queryTokens: ReadonlySet<string>,
  chunk: TextEvidenceChunk,
): number {
  const chunkTokens = lexicalTokens(chunk.text);
  let score = 0;
  for (const token of queryTokens) if (chunkTokens.has(token)) score += 1;
  return score;
}

function rankRenderedFacts(
  queryText: string,
  chunks: ReadonlyArray<TextEvidenceChunk>,
  facts: ReadonlyMap<string, EvidenceFact>,
): ReadonlyArray<EvidenceFact> {
  const queryTokens = lexicalTokens(queryText);
  return chunks
    .toSorted((left, right) => {
      const scoreDifference =
        chunkScore(queryTokens, right) - chunkScore(queryTokens, left);
      return scoreDifference !== 0
        ? scoreDifference
        : left.id.localeCompare(right.id);
    })
    .map((chunk) => facts.get(chunk.factId))
    .filter((fact) => fact !== undefined);
}

export function createMatchedTextEvidenceSource(
  graphInput: unknown,
): Result<EvidenceSource, EvidenceSourceFailure> {
  const validated = validateEvidenceGraph(graphInput);
  if (!validated.ok) return err(sourceFailure(validated.error.message));
  const chunks = createMatchedTextChunks(validated.value.graph);
  const identity = evidenceSourceIdentitySchema.parse({
    id: validated.value.graph.id,
    version: validated.value.graph.version,
    selection: "lexical",
    encoding: "facts",
    implementation: "matched-rendered-chunks/2",
  });
  return ok({
    identity,
    select: (query) =>
      Promise.resolve(
        createBoundedNeighborhood({
          identity,
          query,
          index: validated.value.index,
          rankedFacts: rankRenderedFacts(
            query.text,
            chunks,
            validated.value.index.facts,
          ),
          selectionTruncated: false,
        }),
      ),
  });
}
