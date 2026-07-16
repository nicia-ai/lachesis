import {
  canonicalizeJson,
  digestValue,
  err,
  ok,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const evidenceSelectionKindSchema = z.enum(["lexical", "graph"]);
export const evidenceEncodingSchema = z.enum([
  "facts",
  "untyped-adjacency",
  "typed-relationships",
]);

export const evidenceSourceIdentitySchema = z
  .strictObject({
    id: identifierSchema,
    version: z.string().min(1),
    selection: evidenceSelectionKindSchema,
    encoding: evidenceEncodingSchema,
    implementation: z.string().min(1),
  })
  .readonly();

export const evidenceQuerySchema = z
  .strictObject({
    id: identifierSchema,
    text: z.string().min(1).max(4_000),
    validAt: z.iso.datetime().nullable(),
    recordedAt: z.iso.datetime().nullable(),
    maxFacts: z.number().int().positive().max(64),
    maxCitations: z.number().int().positive().max(128),
    maxEdges: z.number().int().nonnegative().max(256),
    maxPaths: z.number().int().nonnegative().max(256),
    maxHops: z.number().int().nonnegative().max(8),
    maxSerializedBytes: z.number().int().positive().max(1_000_000),
    maxSerializedTokenUpperBound: z.number().int().positive().max(1_000_000),
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

const temporalRecordSchema = z
  .strictObject({
    validFrom: z.iso.datetime().nullable(),
    validUntil: z.iso.datetime().nullable(),
    recordedFrom: z.iso.datetime(),
    recordedUntil: z.iso.datetime().nullable(),
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
    if (
      value.recordedUntil !== null &&
      value.recordedFrom >= value.recordedUntil
    )
      context.addIssue({
        code: "custom",
        message: "recordedFrom must precede recordedUntil.",
        path: ["recordedUntil"],
      });
  });

export const evidenceFactSchema = temporalRecordSchema
  .extend({
    id: identifierSchema,
    statement: z.string().min(1),
    subject: z.string().min(1),
    predicate: z.string().min(1),
    object: z.string().min(1),
    citationIds: z.array(identifierSchema).min(1).readonly(),
  })
  .readonly();

export const evidenceRelationshipSchema = z.enum([
  "related",
  "precedes",
  "contradicts",
  "corroborates",
  "derived-from",
  "retracts",
  "supersedes",
]);

export const evidenceEdgeSchema = temporalRecordSchema
  .extend({
    id: identifierSchema,
    fromFactId: identifierSchema,
    toFactId: identifierSchema,
    relationship: evidenceRelationshipSchema.nullable(),
    provenanceCitationIds: z.array(identifierSchema).min(1).readonly(),
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

export const evidenceContextSchema = z
  .strictObject({
    facts: z.array(evidenceFactSchema).readonly(),
    citations: z.array(evidenceCitationSchema).readonly(),
    edges: z.array(evidenceEdgeSchema).readonly(),
    paths: z.array(evidencePathSchema).readonly(),
  })
  .readonly();

export const evidenceContextUsageSchema = z
  .strictObject({
    factCount: z.number().int().nonnegative(),
    citationCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    pathCount: z.number().int().nonnegative(),
    serializedBytes: z.number().int().nonnegative(),
    serializedTokenUpperBound: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .readonly();

export const evidenceNeighborhoodSchema = z
  .strictObject({
    queryId: identifierSchema,
    source: evidenceSourceIdentitySchema,
    context: evidenceContextSchema,
    usage: evidenceContextUsageSchema,
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
      "CONTEXT_BUDGET_TOO_SMALL",
    ]),
    message: z.string().min(1),
  })
  .readonly();

export type EvidenceSelectionKind = z.infer<typeof evidenceSelectionKindSchema>;
export type EvidenceEncoding = z.infer<typeof evidenceEncodingSchema>;
export type EvidenceSourceIdentity = z.infer<
  typeof evidenceSourceIdentitySchema
>;
export type EvidenceQuery = z.infer<typeof evidenceQuerySchema>;
export type EvidenceCitation = z.infer<typeof evidenceCitationSchema>;
export type EvidenceFact = z.infer<typeof evidenceFactSchema>;
export type EvidenceRelationship = z.infer<typeof evidenceRelationshipSchema>;
export type EvidenceEdge = z.infer<typeof evidenceEdgeSchema>;
export type EvidencePath = z.infer<typeof evidencePathSchema>;
export type EvidenceContext = z.infer<typeof evidenceContextSchema>;
export type EvidenceContextUsage = z.infer<typeof evidenceContextUsageSchema>;
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

function withinInterval(
  instant: string | null,
  start: string | null,
  end: string | null,
): boolean {
  return (
    instant === null ||
    ((start === null || start <= instant) && (end === null || instant < end))
  );
}

export function isEvidenceFactBelievedAt(
  fact: EvidenceFact,
  query: Pick<EvidenceQuery, "validAt" | "recordedAt">,
): boolean {
  return (
    withinInterval(query.validAt, fact.validFrom, fact.validUntil) &&
    withinInterval(query.recordedAt, fact.recordedFrom, fact.recordedUntil)
  );
}

export function measureEvidenceContext(
  context: EvidenceContext,
  truncated: boolean,
): Result<EvidenceContextUsage, EvidenceSourceFailure> {
  const canonical = canonicalizeJson(context);
  if (!canonical.ok)
    return err(
      failure(
        "INVALID_NEIGHBORHOOD",
        "Evidence context is not canonically serializable.",
      ),
    );
  const serializedBytes = new TextEncoder().encode(canonical.value).length;
  return ok({
    factCount: context.facts.length,
    citationCount: context.citations.length,
    edgeCount: context.edges.length,
    pathCount: context.paths.length,
    serializedBytes,
    serializedTokenUpperBound: serializedBytes,
    truncated,
  });
}

export function evidenceContextFitsQuery(
  usage: EvidenceContextUsage,
  query: EvidenceQuery,
): boolean {
  return (
    usage.factCount <= query.maxFacts &&
    usage.citationCount <= query.maxCitations &&
    usage.edgeCount <= query.maxEdges &&
    usage.pathCount <= query.maxPaths &&
    usage.serializedBytes <= query.maxSerializedBytes &&
    usage.serializedTokenUpperBound <= query.maxSerializedTokenUpperBound
  );
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
    left.selection === right.selection &&
    left.encoding === right.encoding &&
    left.implementation === right.implementation
  );
}

function encodingIsValid(neighborhood: EvidenceNeighborhood): boolean {
  const { encoding } = neighborhood.source;
  const { edges, paths } = neighborhood.context;
  if (encoding === "facts") return edges.length === 0 && paths.length === 0;
  if (encoding === "untyped-adjacency")
    return (
      paths.length === 0 && edges.every((edge) => edge.relationship === null)
    );
  return edges.every((edge) => edge.relationship !== null);
}

function validNeighborhoodReferences(
  neighborhood: EvidenceNeighborhood,
  maxHops: number,
): boolean {
  const { citations, edges, facts, paths } = neighborhood.context;
  if (
    hasDuplicateIds(facts) ||
    hasDuplicateIds(citations) ||
    hasDuplicateIds(edges) ||
    new Set(paths.map((path) => pathKey(path))).size !== paths.length
  )
    return false;
  const factIds = new Set(facts.map((fact) => fact.id));
  const citationIds = new Set(citations.map((citation) => citation.id));
  const edgeIndex = new Map(edges.map((edge) => [edge.id, edge]));
  if (
    facts.some((fact) =>
      fact.citationIds.some((citationId) => !citationIds.has(citationId)),
    ) ||
    edges.some(
      (edge) =>
        !factIds.has(edge.fromFactId) ||
        !factIds.has(edge.toFactId) ||
        edge.provenanceCitationIds.some(
          (citationId) => !citationIds.has(citationId),
        ),
    )
  )
    return false;
  for (const path of paths) {
    if (
      path.edgeIds.length > maxHops ||
      path.factIds.some((factId) => !factIds.has(factId))
    )
      return false;
    for (const [index, edgeId] of path.edgeIds.entries()) {
      const edge = edgeIndex.get(edgeId);
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

function pathKey(path: EvidencePath): string {
  return `${path.factIds.join("/")}:${path.edgeIds.join("/")}`;
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
  if (
    neighborhood.data.queryId !== query.data.id ||
    !sameSourceIdentity(neighborhood.data.source, source.identity)
  )
    return err(
      failure(
        "INVALID_NEIGHBORHOOD",
        "Evidence neighborhood identity does not match its query and source.",
      ),
    );
  const measured = measureEvidenceContext(
    neighborhood.data.context,
    neighborhood.data.usage.truncated,
  );
  if (
    !measured.ok ||
    measured.value.factCount !== neighborhood.data.usage.factCount ||
    measured.value.citationCount !== neighborhood.data.usage.citationCount ||
    measured.value.edgeCount !== neighborhood.data.usage.edgeCount ||
    measured.value.pathCount !== neighborhood.data.usage.pathCount ||
    measured.value.serializedBytes !==
      neighborhood.data.usage.serializedBytes ||
    measured.value.serializedTokenUpperBound !==
      neighborhood.data.usage.serializedTokenUpperBound ||
    !evidenceContextFitsQuery(neighborhood.data.usage, query.data) ||
    !encodingIsValid(neighborhood.data) ||
    !validNeighborhoodReferences(neighborhood.data, query.data.maxHops)
  )
    return err(
      failure(
        "INVALID_NEIGHBORHOOD",
        "Evidence neighborhood failed bound, encoding, or reference reconciliation.",
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
