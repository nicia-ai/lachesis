import { digestValue, err, ok, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const evidenceSourceIdentitySchema = z
  .strictObject({
    id: identifierSchema,
    version: z.string().min(1),
    substrate: z.enum(["text", "graph"]),
    implementation: z.string().min(1),
  })
  .readonly();

export const evidenceQuerySchema = z
  .strictObject({
    id: identifierSchema,
    text: z.string().min(1).max(2_000),
    asOf: z.iso.datetime().nullable(),
    maxFacts: z.number().int().positive().max(64),
    maxHops: z.number().int().nonnegative().max(8),
  })
  .readonly();

export const evidenceCitationSchema = z
  .strictObject({
    id: identifierSchema,
    source: z.string().min(1),
    locator: z.string().min(1),
    observedAt: z.iso.datetime(),
  })
  .readonly();

export const evidenceFactSchema = z
  .strictObject({
    id: identifierSchema,
    statement: z.string().min(1),
    subject: z.string().min(1),
    predicate: z.string().min(1),
    object: z.string().min(1),
    validFrom: z.iso.datetime().nullable(),
    validUntil: z.iso.datetime().nullable(),
    status: z.enum(["active", "retracted"]),
    citationIds: z.array(identifierSchema).min(1).readonly(),
  })
  .superRefine((value, context) => {
    if (
      value.validFrom !== null &&
      value.validUntil !== null &&
      value.validFrom >= value.validUntil
    )
      context.addIssue({
        code: "custom",
        message: "validFrom must precede validUntil.",
        path: ["validUntil"],
      });
  })
  .readonly();

export const evidenceEdgeSchema = z
  .strictObject({
    id: identifierSchema,
    fromFactId: identifierSchema,
    toFactId: identifierSchema,
    kind: z.enum([
      "related",
      "precedes",
      "contradicts",
      "corroborates",
      "derived-from",
      "retracts",
      "supersedes",
    ]),
  })
  .readonly();

export const evidencePathSchema = z
  .strictObject({
    factIds: z.array(identifierSchema).min(1).readonly(),
    edgeIds: z.array(identifierSchema).readonly(),
  })
  .superRefine((value, context) => {
    if (value.edgeIds.length !== value.factIds.length - 1)
      context.addIssue({
        code: "custom",
        message: "A path requires exactly one edge between adjacent facts.",
        path: ["edgeIds"],
      });
  })
  .readonly();

export const evidenceNeighborhoodSchema = z
  .strictObject({
    queryId: identifierSchema,
    source: evidenceSourceIdentitySchema,
    facts: z.array(evidenceFactSchema).readonly(),
    citations: z.array(evidenceCitationSchema).readonly(),
    edges: z.array(evidenceEdgeSchema).readonly(),
    paths: z.array(evidencePathSchema).readonly(),
  })
  .readonly();

export const evidenceSelectionReferenceSchema = z
  .strictObject({
    queryId: identifierSchema,
    source: evidenceSourceIdentitySchema,
    neighborhoodDigest: sha256Schema.brand<"EvidenceNeighborhoodDigest">(),
  })
  .readonly();

export const evidenceSourceFailureSchema = z
  .strictObject({
    code: z.enum([
      "INVALID_QUERY",
      "INVALID_SOURCE_DATA",
      "INVALID_NEIGHBORHOOD",
    ]),
    message: z.string().min(1),
  })
  .readonly();

export type EvidenceSourceIdentity = z.infer<
  typeof evidenceSourceIdentitySchema
>;
export type EvidenceQuery = z.infer<typeof evidenceQuerySchema>;
export type EvidenceCitation = z.infer<typeof evidenceCitationSchema>;
export type EvidenceFact = z.infer<typeof evidenceFactSchema>;
export type EvidenceEdge = z.infer<typeof evidenceEdgeSchema>;
export type EvidencePath = z.infer<typeof evidencePathSchema>;
export type EvidenceNeighborhood = z.infer<typeof evidenceNeighborhoodSchema>;
export type EvidenceSelectionReference = z.infer<
  typeof evidenceSelectionReferenceSchema
>;
export type EvidenceSourceFailure = z.infer<typeof evidenceSourceFailureSchema>;

export type EvidenceSource = Readonly<{
  identity: EvidenceSourceIdentity;
  select: (
    query: EvidenceQuery,
  ) => Promise<Result<EvidenceNeighborhood, EvidenceSourceFailure>>;
}>;

function failure(
  code: EvidenceSourceFailure["code"],
  message: string,
): EvidenceSourceFailure {
  return { code, message };
}

function hasDuplicateIds(
  values: ReadonlyArray<Readonly<{ id: string }>>,
): boolean {
  return new Set(values.map((value) => value.id)).size !== values.length;
}

function sameSourceIdentity(
  left: EvidenceSourceIdentity,
  right: EvidenceSourceIdentity,
): boolean {
  return (
    left.id === right.id &&
    left.version === right.version &&
    left.substrate === right.substrate &&
    left.implementation === right.implementation
  );
}

function validNeighborhoodReferences(
  neighborhood: EvidenceNeighborhood,
  maxHops: number,
): boolean {
  if (
    hasDuplicateIds(neighborhood.facts) ||
    hasDuplicateIds(neighborhood.citations) ||
    hasDuplicateIds(neighborhood.edges)
  )
    return false;
  const factIds = new Set(neighborhood.facts.map((fact) => fact.id));
  const citationIds = new Set(
    neighborhood.citations.map((citation) => citation.id),
  );
  const edges = new Map(neighborhood.edges.map((edge) => [edge.id, edge]));
  if (
    neighborhood.facts.some((fact) =>
      fact.citationIds.some((citationId) => !citationIds.has(citationId)),
    ) ||
    neighborhood.edges.some(
      (edge) => !factIds.has(edge.fromFactId) || !factIds.has(edge.toFactId),
    )
  )
    return false;
  for (const path of neighborhood.paths) {
    if (
      path.edgeIds.length > maxHops ||
      path.factIds.some((factId) => !factIds.has(factId))
    )
      return false;
    for (const [index, edgeId] of path.edgeIds.entries()) {
      const edge = edges.get(edgeId);
      const fromFactId = path.factIds[index];
      const toFactId = path.factIds[index + 1];
      if (
        edge === undefined ||
        fromFactId === undefined ||
        toFactId === undefined ||
        edge.fromFactId !== fromFactId ||
        edge.toFactId !== toFactId
      )
        return false;
    }
  }
  return true;
}

export async function selectEvidence(
  source: EvidenceSource,
  queryInput: unknown,
): Promise<Result<EvidenceNeighborhood, EvidenceSourceFailure>> {
  const query = evidenceQuerySchema.safeParse(queryInput);
  if (!query.success)
    return err(failure("INVALID_QUERY", "Evidence query validation failed."));
  const selected = await source.select(query.data);
  if (!selected.ok) return selected;
  const neighborhood = evidenceNeighborhoodSchema.safeParse(selected.value);
  if (!neighborhood.success)
    return err(
      failure(
        "INVALID_NEIGHBORHOOD",
        "Evidence source returned an invalid neighborhood.",
      ),
    );
  if (neighborhood.data.queryId !== query.data.id)
    return err(
      failure(
        "INVALID_NEIGHBORHOOD",
        "Evidence neighborhood does not match the query identity.",
      ),
    );
  if (!sameSourceIdentity(neighborhood.data.source, source.identity))
    return err(
      failure(
        "INVALID_NEIGHBORHOOD",
        "Evidence neighborhood does not match the source identity.",
      ),
    );
  if (neighborhood.data.facts.length > query.data.maxFacts)
    return err(
      failure(
        "INVALID_NEIGHBORHOOD",
        "Evidence neighborhood exceeds the declared fact bound.",
      ),
    );
  if (!validNeighborhoodReferences(neighborhood.data, query.data.maxHops))
    return err(
      failure(
        "INVALID_NEIGHBORHOOD",
        "Evidence neighborhood contains invalid internal references.",
      ),
    );
  return ok(neighborhood.data);
}

export async function referenceEvidenceSelection(
  neighborhood: EvidenceNeighborhood,
): Promise<Result<EvidenceSelectionReference, EvidenceSourceFailure>> {
  const digest = await digestValue(neighborhood);
  if (!digest.ok)
    return err(
      failure(
        "INVALID_NEIGHBORHOOD",
        "Evidence neighborhood cannot be canonically identified.",
      ),
    );
  const reference = evidenceSelectionReferenceSchema.safeParse({
    queryId: neighborhood.queryId,
    source: neighborhood.source,
    neighborhoodDigest: digest.value,
  });
  return reference.success
    ? ok(reference.data)
    : err(
        failure(
          "INVALID_NEIGHBORHOOD",
          "Evidence selection reference validation failed.",
        ),
      );
}
