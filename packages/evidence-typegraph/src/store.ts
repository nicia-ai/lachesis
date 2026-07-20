import { digestValue, err, ok, type Result } from "@nicia-ai/lachesis";
import {
  createGraphSelectedAdjacencyEvidenceSource,
  createGraphSelectedFactsEvidenceSource,
  createInMemoryGraphEvidenceSource,
  createMatchedTextEvidenceSource,
  type EvidenceCitation,
  type EvidenceEdge,
  type EvidenceFact,
  type EvidenceGraph,
  evidenceGraphSchema,
  type EvidenceSource,
  type M4EvidenceView,
  m4EvidenceViewSchema,
  validateEvidenceGraph,
} from "@nicia-ai/lachesis-evidence";
import {
  asEdgeId,
  asNodeId,
  asRecordedInstant,
  defineEdge,
  defineGraph,
  defineNode,
  type HistoryStore,
  type RecordedStoreView,
  type StoreView,
} from "@nicia-ai/typegraph";
import { z } from "zod";

import {
  CURRENT_TYPEGRAPH_SNAPSHOT,
  M4C_TYPEGRAPH_ADAPTER_VERSION,
  M4C_TYPEGRAPH_SCHEMA_VERSION,
  TYPEGRAPH_PACKAGE_VERSION,
  type TypeGraphAdapterFailure,
  type TypeGraphAdapterIdentity,
  typeGraphAdapterIdentitySchema,
  type TypeGraphBackendIdentity,
  typeGraphBackendIdentitySchema,
  type TypeGraphEvidenceRepository,
  type TypeGraphEvidenceSnapshot,
  type TypeGraphSnapshotCoordinate,
  typeGraphSnapshotCoordinateSchema,
  typeGraphSnapshotIdentitySchema,
} from "./contract.js";

const STORAGE_VALID_FROM = "0001-01-01T00:00:00.000Z";
const MANIFEST_ID = "m4c-source-manifest";

const logicalTemporalSchema = {
  logicalValidFrom: z.string().nullable(),
  logicalValidUntil: z.string().nullable(),
  logicalRecordedFrom: z.string(),
  logicalRecordedUntil: z.string().nullable(),
};

const StoredManifest = defineNode("M4EvidenceManifest", {
  schema: z.object({
    sourceGraphId: z.string(),
    sourceGraphVersion: z.string(),
    sourceGraphDigest: z.string(),
    adapterSchemaVersion: z.string(),
  }),
});

const StoredCitation = defineNode("M4EvidenceCitation", {
  schema: z.object({
    source: z.string(),
    locator: z.string(),
    observedAt: z.string(),
  }),
});

const StoredFact = defineNode("M4EvidenceFact", {
  schema: z.object({
    statement: z.string(),
    subject: z.string(),
    predicate: z.string(),
    object: z.string(),
    citationIds: z.array(z.string()),
    ...logicalTemporalSchema,
  }),
});

const StoredRelationship = defineEdge("M4EvidenceRelationship", {
  schema: z.object({
    relationship: z
      .enum([
        "related",
        "precedes",
        "contradicts",
        "corroborates",
        "derived-from",
        "retracts",
        "supersedes",
      ])
      .nullable(),
    provenanceCitationIds: z.array(z.string()),
    ...logicalTemporalSchema,
  }),
  from: [StoredFact],
  to: [StoredFact],
});

export const TYPEGRAPH_EVIDENCE_SCHEMA = defineGraph({
  id: "lachesis-m4c-evidence-storage",
  nodes: {
    M4EvidenceManifest: { type: StoredManifest },
    M4EvidenceCitation: { type: StoredCitation },
    M4EvidenceFact: { type: StoredFact },
  },
  edges: {
    M4EvidenceRelationship: {
      type: StoredRelationship,
      from: [StoredFact],
      to: [StoredFact],
    },
  },
  defaults: { onNodeDelete: "restrict", temporalMode: "current" },
});

type EvidenceStore = HistoryStore<typeof TYPEGRAPH_EVIDENCE_SCHEMA>;
type EvidenceView = StoreView<typeof TYPEGRAPH_EVIDENCE_SCHEMA>;
type RecordedEvidenceView = RecordedStoreView<typeof TYPEGRAPH_EVIDENCE_SCHEMA>;

type KnownIdentities = Readonly<{
  citationIds: ReadonlyArray<string>;
  factIds: ReadonlyArray<string>;
  edgeIds: ReadonlyArray<string>;
}>;

type SnapshotReader = Readonly<{
  manifest: () => Promise<ReadonlyArray<StoredManifestNode>>;
  citations: () => Promise<ReadonlyArray<StoredCitationNode>>;
  facts: () => Promise<ReadonlyArray<StoredFactNode>>;
  edges: () => Promise<ReadonlyArray<StoredRelationshipEdge>>;
}>;

type StoredManifestNode = Awaited<
  ReturnType<EvidenceStore["nodes"]["M4EvidenceManifest"]["find"]>
>[number];
type StoredCitationNode = Awaited<
  ReturnType<EvidenceStore["nodes"]["M4EvidenceCitation"]["find"]>
>[number];
type StoredFactNode = Awaited<
  ReturnType<EvidenceStore["nodes"]["M4EvidenceFact"]["find"]>
>[number];
type StoredRelationshipEdge = Awaited<
  ReturnType<EvidenceStore["edges"]["M4EvidenceRelationship"]["find"]>
>[number];

function failure(
  code: TypeGraphAdapterFailure["code"],
  message: string,
): TypeGraphAdapterFailure {
  return { code, message };
}

function caughtFailure(error: unknown): TypeGraphAdapterFailure {
  return failure(
    "TYPEGRAPH_OPERATION_FAILED",
    error instanceof Error
      ? `TypeGraph operation failed: ${error.name}: ${error.message}`
      : "TypeGraph operation failed.",
  );
}

async function digest(
  value: unknown,
): Promise<Result<string, TypeGraphAdapterFailure>> {
  const result = await digestValue(value);
  return result.ok
    ? ok(result.value)
    : err(
        failure("IDENTITY_FAILURE", "Content identity could not be derived."),
      );
}

function canonicalGraph(graph: EvidenceGraph): EvidenceGraph {
  return evidenceGraphSchema.parse({
    ...graph,
    citations: graph.citations.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ),
    facts: graph.facts.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ),
    edges: graph.edges.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ),
  });
}

function knownIdentities(graph: EvidenceGraph): KnownIdentities {
  return {
    citationIds: graph.citations.map((citation) => citation.id).toSorted(),
    factIds: graph.facts.map((fact) => fact.id).toSorted(),
    edgeIds: graph.edges.map((edge) => edge.id).toSorted(),
  };
}

function sourceForView(
  graph: EvidenceGraph,
  view: M4EvidenceView,
): Result<EvidenceSource, TypeGraphAdapterFailure> {
  const result = (() => {
    switch (view) {
      case "lexical-facts":
        return createMatchedTextEvidenceSource(graph);
      case "graph-facts":
        return createGraphSelectedFactsEvidenceSource(graph);
      case "graph-adjacency":
        return createGraphSelectedAdjacencyEvidenceSource(graph);
      case "graph-typed":
        return createInMemoryGraphEvidenceSource(graph);
    }
  })();
  return result.ok
    ? ok(result.value)
    : err(failure("INVALID_SOURCE_GRAPH", result.error.message));
}

function factFromNode(node: StoredFactNode): EvidenceFact {
  return {
    id: node.id,
    statement: node.statement,
    subject: node.subject,
    predicate: node.predicate,
    object: node.object,
    citationIds: node.citationIds,
    validFrom: node.logicalValidFrom,
    validUntil: node.logicalValidUntil,
    recordedFrom: node.logicalRecordedFrom,
    recordedUntil: node.logicalRecordedUntil,
  };
}

function citationFromNode(node: StoredCitationNode): EvidenceCitation {
  return {
    id: node.id,
    source: node.source,
    locator: node.locator,
    observedAt: node.observedAt,
  };
}

function edgeFromStored(edge: StoredRelationshipEdge): EvidenceEdge {
  return {
    id: edge.id,
    fromFactId: edge.fromId,
    toFactId: edge.toId,
    relationship: edge.relationship,
    provenanceCitationIds: edge.provenanceCitationIds,
    validFrom: edge.logicalValidFrom,
    validUntil: edge.logicalValidUntil,
    recordedFrom: edge.logicalRecordedFrom,
    recordedUntil: edge.logicalRecordedUntil,
  };
}

function currentReader(
  store: EvidenceStore,
  coordinate: TypeGraphSnapshotCoordinate,
): SnapshotReader {
  const view: EvidenceView =
    coordinate.validAt === null
      ? store.view({ mode: "current" })
      : store.asOf(coordinate.validAt);
  return {
    manifest: () => view.nodes.M4EvidenceManifest.find(),
    citations: () => view.nodes.M4EvidenceCitation.find(),
    facts: () => view.nodes.M4EvidenceFact.find(),
    edges: () => view.edges.M4EvidenceRelationship.find(),
  };
}

function compact<T>(values: ReadonlyArray<T | undefined>): ReadonlyArray<T> {
  return values.filter((value) => value !== undefined);
}

function recordedReader(
  store: EvidenceStore,
  coordinate: TypeGraphSnapshotCoordinate,
  identities: KnownIdentities,
): SnapshotReader {
  if (coordinate.recordedAt === null) return currentReader(store, coordinate);
  const validView =
    coordinate.validAt === null
      ? store.view({ mode: "current" })
      : store.asOf(coordinate.validAt);
  const view: RecordedEvidenceView = validView.asOfRecorded(
    asRecordedInstant(coordinate.recordedAt),
  );
  return {
    manifest: async () =>
      compact(
        await view.nodes.M4EvidenceManifest.getByIds([
          asNodeId<typeof StoredManifest>(MANIFEST_ID),
        ]),
      ),
    citations: async () =>
      compact(
        await view.nodes.M4EvidenceCitation.getByIds(
          identities.citationIds.map((id) =>
            asNodeId<typeof StoredCitation>(id),
          ),
        ),
      ),
    facts: async () =>
      compact(
        await view.nodes.M4EvidenceFact.getByIds(
          identities.factIds.map((id) => asNodeId<typeof StoredFact>(id)),
        ),
      ),
    edges: async () =>
      compact(
        await view.edges.M4EvidenceRelationship.getByIds(
          identities.edgeIds.map((id) =>
            asEdgeId<typeof StoredRelationship>(id),
          ),
        ),
      ),
  };
}

async function readGraph(
  reader: SnapshotReader,
): Promise<
  Result<
    Readonly<{ graph: EvidenceGraph; manifest: StoredManifestNode }>,
    TypeGraphAdapterFailure
  >
> {
  try {
    const [manifests, citations, facts, edges] = await Promise.all([
      reader.manifest(),
      reader.citations(),
      reader.facts(),
      reader.edges(),
    ]);
    const manifest = manifests[0];
    if (manifest === undefined || manifests.length !== 1)
      return err(
        failure(
          "SCHEMA_VERSION_MISMATCH",
          "The TypeGraph snapshot has no unique Lachesis source manifest.",
        ),
      );
    const graph = evidenceGraphSchema.safeParse({
      id: manifest.sourceGraphId,
      version: manifest.sourceGraphVersion,
      citations: citations.map(citationFromNode),
      facts: facts.map(factFromNode),
      edges: edges.map(edgeFromStored),
    });
    return graph.success
      ? ok({ graph: canonicalGraph(graph.data), manifest })
      : err(
          failure(
            "MISSING_REFERENCE",
            "The TypeGraph snapshot cannot form a valid evidence graph.",
          ),
        );
  } catch (error) {
    return err(caughtFailure(error));
  }
}

async function adapterIdentity(
  backend: TypeGraphBackendIdentity,
): Promise<Result<TypeGraphAdapterIdentity, TypeGraphAdapterFailure>> {
  const schemaDigest = await digest({
    graphId: TYPEGRAPH_EVIDENCE_SCHEMA.id,
    nodeKinds: Object.keys(TYPEGRAPH_EVIDENCE_SCHEMA.nodes).toSorted(),
    edgeKinds: Object.keys(TYPEGRAPH_EVIDENCE_SCHEMA.edges).toSorted(),
    schemaVersion: M4C_TYPEGRAPH_SCHEMA_VERSION,
  });
  if (!schemaDigest.ok) return schemaDigest;
  const body = {
    id: "lachesis-m4c-typegraph-evidence" as const,
    version: M4C_TYPEGRAPH_ADAPTER_VERSION,
    typeGraphPackageVersion: TYPEGRAPH_PACKAGE_VERSION,
    schemaVersion: M4C_TYPEGRAPH_SCHEMA_VERSION,
    backend,
    schemaDigest: schemaDigest.value,
  };
  const adapterDigest = await digest(body);
  if (!adapterDigest.ok) return adapterDigest;
  return ok(
    typeGraphAdapterIdentitySchema.parse({
      ...body,
      adapterDigest: adapterDigest.value,
    }),
  );
}

async function writeInitialGraph(
  store: EvidenceStore,
  graph: EvidenceGraph,
  sourceGraphDigest: string,
): Promise<Result<string, TypeGraphAdapterFailure>> {
  try {
    const outcome = await store.transactionWithReceipt(async (transaction) => {
      await transaction.nodes.M4EvidenceManifest.create(
        {
          sourceGraphId: graph.id,
          sourceGraphVersion: graph.version,
          sourceGraphDigest,
          adapterSchemaVersion: M4C_TYPEGRAPH_SCHEMA_VERSION,
        },
        { id: MANIFEST_ID, validFrom: STORAGE_VALID_FROM },
      );
      await transaction.nodes.M4EvidenceCitation.bulkCreate(
        graph.citations.map((citation) => ({
          id: citation.id,
          validFrom: STORAGE_VALID_FROM,
          props: {
            source: citation.source,
            locator: citation.locator,
            observedAt: citation.observedAt,
          },
        })),
      );
      await transaction.nodes.M4EvidenceFact.bulkCreate(
        graph.facts.map((fact) => ({
          id: fact.id,
          validFrom: STORAGE_VALID_FROM,
          props: {
            statement: fact.statement,
            subject: fact.subject,
            predicate: fact.predicate,
            object: fact.object,
            citationIds: [...fact.citationIds],
            logicalValidFrom: fact.validFrom,
            logicalValidUntil: fact.validUntil,
            logicalRecordedFrom: fact.recordedFrom,
            logicalRecordedUntil: fact.recordedUntil,
          },
        })),
      );
      await transaction.edges.M4EvidenceRelationship.bulkCreate(
        graph.edges.map((edge) => ({
          id: edge.id,
          from: { kind: "M4EvidenceFact", id: edge.fromFactId },
          to: { kind: "M4EvidenceFact", id: edge.toFactId },
          validFrom: STORAGE_VALID_FROM,
          props: {
            relationship: edge.relationship,
            provenanceCitationIds: [...edge.provenanceCitationIds],
            logicalValidFrom: edge.validFrom,
            logicalValidUntil: edge.validUntil,
            logicalRecordedFrom: edge.recordedFrom,
            logicalRecordedUntil: edge.recordedUntil,
          },
        })),
      );
    });
    const recordedAt = outcome.receipt.recorded;
    return recordedAt === undefined
      ? err(
          failure(
            "ADAPTER_CAPABILITY_VIOLATION",
            "TypeGraph history did not expose a recorded checkpoint.",
          ),
        )
      : ok(recordedAt);
  } catch (error) {
    return err(caughtFailure(error));
  }
}

async function inspectExistingStore(
  store: EvidenceStore,
  expectedGraph: EvidenceGraph,
  expectedDigest: string,
): Promise<Result<string | undefined, TypeGraphAdapterFailure>> {
  try {
    const manifests = await store.nodes.M4EvidenceManifest.find();
    if (manifests.length === 0) return ok(undefined);
    if (manifests.length !== 1) {
      return err(
        failure(
          "SCHEMA_VERSION_MISMATCH",
          "The TypeGraph database contains multiple Lachesis manifests.",
        ),
      );
    }
    const manifest = manifests[0];
    if (manifest === undefined)
      return err(
        failure("SCHEMA_VERSION_MISMATCH", "The source manifest is missing."),
      );
    if (manifest.adapterSchemaVersion !== M4C_TYPEGRAPH_SCHEMA_VERSION)
      return err(
        failure(
          "SCHEMA_VERSION_MISMATCH",
          "The stored adapter schema version is incompatible.",
        ),
      );
    if (
      manifest.sourceGraphId !== expectedGraph.id ||
      manifest.sourceGraphVersion !== expectedGraph.version ||
      manifest.sourceGraphDigest !== expectedDigest
    )
      return err(
        failure(
          "SOURCE_IDENTITY_MISMATCH",
          "The stored source identity differs from the requested evidence graph.",
        ),
      );
    return ok(await store.recordedNow());
  } catch (error) {
    return err(caughtFailure(error));
  }
}

async function closeAfterFailure<T>(
  store: EvidenceStore,
  result: Result<T, TypeGraphAdapterFailure>,
): Promise<Result<T, TypeGraphAdapterFailure>> {
  if (!result.ok) await store.close();
  return result;
}

export async function createTypeGraphEvidenceRepository(
  input: Readonly<{
    graphInput: unknown;
    store: EvidenceStore;
    backendIdentity: TypeGraphBackendIdentity;
  }>,
): Promise<Result<TypeGraphEvidenceRepository, TypeGraphAdapterFailure>> {
  const store = input.store;
  const validated = validateEvidenceGraph(input.graphInput);
  if (!validated.ok) {
    await store.close();
    return err(failure("INVALID_SOURCE_GRAPH", validated.error.message));
  }
  const backendIdentity = typeGraphBackendIdentitySchema.safeParse(
    input.backendIdentity,
  );
  if (!backendIdentity.success) {
    await store.close();
    return err(
      failure(
        "ADAPTER_CAPABILITY_VIOLATION",
        "The TypeGraph backend identity is invalid.",
      ),
    );
  }
  const graph = canonicalGraph(validated.value.graph);
  const sourceGraphDigest = await digest(graph);
  if (!sourceGraphDigest.ok) return closeAfterFailure(store, sourceGraphDigest);
  const identity = await adapterIdentity(backendIdentity.data);
  if (!identity.ok) return closeAfterFailure(store, identity);

  const existing = await closeAfterFailure(
    store,
    await inspectExistingStore(store, graph, sourceGraphDigest.value),
  );
  if (!existing.ok) return existing;
  let initialRecordedAt = existing.value;
  if (initialRecordedAt === undefined) {
    const written = await closeAfterFailure(
      store,
      await writeInitialGraph(store, graph, sourceGraphDigest.value),
    );
    if (!written.ok) return written;
    initialRecordedAt = written.value;
  }

  const identities = knownIdentities(graph);
  let closed = false;

  const snapshot = async (
    coordinateInput: TypeGraphSnapshotCoordinate = CURRENT_TYPEGRAPH_SNAPSHOT,
  ): Promise<Result<TypeGraphEvidenceSnapshot, TypeGraphAdapterFailure>> => {
    if (closed)
      return err(failure("REPOSITORY_CLOSED", "The repository is closed."));
    const coordinate =
      typeGraphSnapshotCoordinateSchema.safeParse(coordinateInput);
    if (!coordinate.success)
      return err(
        failure(
          "ADAPTER_CAPABILITY_VIOLATION",
          "The TypeGraph snapshot coordinate is invalid.",
        ),
      );
    const selected = await readGraph(
      recordedReader(store, coordinate.data, identities),
    );
    if (!selected.ok) return selected;
    if (
      selected.value.manifest.adapterSchemaVersion !==
      M4C_TYPEGRAPH_SCHEMA_VERSION
    )
      return err(
        failure(
          "SCHEMA_VERSION_MISMATCH",
          "The TypeGraph snapshot has an incompatible adapter schema.",
        ),
      );
    const selectedGraphDigest = await digest(selected.value.graph);
    if (!selectedGraphDigest.ok) return selectedGraphDigest;
    const storageSnapshotDigest = await digest({
      adapter: identity.value,
      coordinate: coordinate.data,
      sourceGraphDigest: selectedGraphDigest.value,
    });
    if (!storageSnapshotDigest.ok) return storageSnapshotDigest;
    const snapshotIdentity = typeGraphSnapshotIdentitySchema.safeParse({
      adapter: identity.value,
      coordinate: coordinate.data,
      sourceGraphDigest: selectedGraphDigest.value,
      storageSnapshotDigest: storageSnapshotDigest.value,
    });
    return snapshotIdentity.success
      ? ok({ graph: selected.value.graph, identity: snapshotIdentity.data })
      : err(
          failure(
            "IDENTITY_FAILURE",
            "The TypeGraph snapshot identity is invalid.",
          ),
        );
  };

  const repository: TypeGraphEvidenceRepository = {
    identity: identity.value,
    initialRecordedAt,
    snapshot,
    source: async (view, coordinate) => {
      if (!m4EvidenceViewSchema.safeParse(view).success)
        return err(
          failure(
            "ADAPTER_CAPABILITY_VIOLATION",
            "The requested evidence view is invalid.",
          ),
        );
      const selected = await snapshot(coordinate);
      return selected.ok ? sourceForView(selected.value.graph, view) : selected;
    },
    assertSnapshot: async (expectedDigest, coordinate) => {
      const selected = await snapshot(coordinate);
      if (!selected.ok) return selected;
      return selected.value.identity.storageSnapshotDigest === expectedDigest
        ? selected
        : err(
            failure(
              "SNAPSHOT_MISMATCH",
              "The TypeGraph storage snapshot digest does not match.",
            ),
          );
    },
    retractFact: async (factId) => {
      if (closed)
        return err(failure("REPOSITORY_CLOSED", "The repository is closed."));
      if (!identities.factIds.includes(factId))
        return err(
          failure(
            "MISSING_REFERENCE",
            "The requested evidence fact does not exist.",
          ),
        );
      try {
        const outcome = await store.transactionWithReceipt(
          async (transaction) => {
            const relationships =
              await transaction.edges.M4EvidenceRelationship.find();
            for (const relationship of relationships) {
              if (
                relationship.fromId === factId ||
                relationship.toId === factId
              )
                await transaction.edges.M4EvidenceRelationship.delete(
                  relationship.id,
                );
            }
            await transaction.nodes.M4EvidenceFact.delete(
              asNodeId<typeof StoredFact>(factId),
            );
          },
        );
        const recordedAt = outcome.receipt.recorded;
        return recordedAt === undefined
          ? err(
              failure(
                "ADAPTER_CAPABILITY_VIOLATION",
                "TypeGraph history did not expose a retraction checkpoint.",
              ),
            )
          : ok(recordedAt);
      } catch (error) {
        return err(caughtFailure(error));
      }
    },
    close: async () => {
      if (!closed) {
        closed = true;
        await store.close();
      }
    },
  };
  return ok(repository);
}
