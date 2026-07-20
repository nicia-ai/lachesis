import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Result } from "@nicia-ai/lachesis";
import {
  compileM4EvidenceView,
  createGraphSelectedAdjacencyEvidenceSource,
  createGraphSelectedFactsEvidenceSource,
  createInMemoryGraphEvidenceSource,
  createMatchedTextEvidenceSource,
  type EvidenceGraph,
  type EvidenceSource,
  M3A1_PREREGISTERED_CORPUS,
  M3A1_REFERENCE_GRAPH,
  M4A_INITIAL_POLICY,
  M4A_PROVIDER_PROFILES,
  type M4EvidenceView,
  type M4Provider,
  reconstructM4Provenance,
  referenceEvidenceSelection,
  selectEvidence,
} from "@nicia-ai/lachesis-evidence";
import { createLocalSqliteStore } from "@nicia-ai/typegraph/sqlite/local";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import {
  createTypeGraphEvidenceRepository,
  CURRENT_TYPEGRAPH_SNAPSHOT,
  TYPEGRAPH_EVIDENCE_SCHEMA,
  type TypeGraphEvidenceRepository,
} from "../src/index.js";
import { createTypeGraphSqliteEvidenceRepository } from "../src/sqlite.js";

const repositories: Array<TypeGraphEvidenceRepository> = [];
const databasePaths: Array<string> = [];

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

async function repository(
  graph: EvidenceGraph = M3A1_REFERENCE_GRAPH,
  path?: string,
): Promise<TypeGraphEvidenceRepository> {
  const created = unwrap(
    await createTypeGraphSqliteEvidenceRepository({
      graphInput: graph,
      ...(path === undefined ? {} : { path }),
    }),
  );
  repositories.push(created);
  return created;
}

function memorySource(
  graph: EvidenceGraph,
  view: M4EvidenceView,
): EvidenceSource {
  const source = (() => {
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
  return unwrap(source);
}

function taskClass(
  category: (typeof M3A1_PREREGISTERED_CORPUS)[number]["category"],
): "relational" | "non-relational" | "negative-control" {
  return category === "negative-control"
    ? "negative-control"
    : category === "temporal" || category === "retraction"
      ? "non-relational"
      : "relational";
}

function databasePath(label: string): string {
  const path = join(
    tmpdir(),
    `lachesis-typegraph-${label}-${crypto.randomUUID()}.sqlite`,
  );
  databasePaths.push(path);
  return path;
}

function reorderByKeys<T extends Readonly<{ id: string }>>(
  values: ReadonlyArray<T>,
  keys: ReadonlyArray<number>,
): ReadonlyArray<T> {
  return values
    .map((value, index) => ({ value, key: keys[index] ?? 0 }))
    .toSorted(
      (left, right) =>
        left.key - right.key || left.value.id.localeCompare(right.value.id),
    )
    .map((entry) => entry.value);
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((entry) => entry.close()));
  await Promise.all(
    databasePaths.splice(0).map(async (path) => {
      try {
        await unlink(path);
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
    }),
  );
});

describe("M4c TypeGraph parity", () => {
  it("matches every development fixture and evidence view exactly", async () => {
    const typeGraph = await repository();
    const tasks = M3A1_PREREGISTERED_CORPUS.filter(
      (task) => task.split === "development",
    );
    const views: ReadonlyArray<M4EvidenceView> = [
      "lexical-facts",
      "graph-facts",
      "graph-adjacency",
      "graph-typed",
    ];

    for (const task of tasks) {
      for (const view of views) {
        const expected = unwrap(
          await selectEvidence(
            memorySource(M3A1_REFERENCE_GRAPH, view),
            task.query,
          ),
        );
        const actualSource = unwrap(await typeGraph.source(view));
        const actual = unwrap(await selectEvidence(actualSource, task.query));
        expect(actual).toEqual(expected);
        expect(unwrap(await referenceEvidenceSelection(actual))).toEqual(
          unwrap(await referenceEvidenceSelection(expected)),
        );
      }
    }
  });

  it("preserves compiler, visible-view, validation, and reconstruction identities", async () => {
    const typeGraph = await repository();
    const snapshot = unwrap(await typeGraph.snapshot());
    const tasks = M3A1_PREREGISTERED_CORPUS.filter(
      (task) => task.split === "development",
    );
    const providers: ReadonlyArray<M4Provider> = ["openai", "anthropic"];

    for (const task of tasks) {
      for (const provider of providers) {
        const input = {
          queryInput: task.query,
          providerProfileInput: M4A_PROVIDER_PROFILES[provider],
          taskProfileInput: {
            taskClass: taskClass(task.category),
            answerContract: task.answerContract,
          },
          policyInput: M4A_INITIAL_POLICY,
        };
        const expected = unwrap(
          await compileM4EvidenceView({
            ...input,
            graphInput: M3A1_REFERENCE_GRAPH,
          }),
        );
        const actual = unwrap(
          await compileM4EvidenceView({
            ...input,
            graphInput: snapshot.graph,
          }),
        );
        expect(actual).toEqual(expected);

        const answer = {
          outcome: "answered" as const,
          answerValues: task.expectedAnswerValues,
          supportingFactIds: task.expectedFactIds,
        };
        expect(
          await reconstructM4Provenance({
            compiledViewInput: actual,
            oracleAnswerInput: answer,
          }),
        ).toEqual(
          await reconstructM4Provenance({
            compiledViewInput: expected,
            oracleAnswerInput: answer,
          }),
        );
      }
    }
  }, 20_000);

  it("is independent of insertion and database row order", async () => {
    const reordered: EvidenceGraph = {
      ...M3A1_REFERENCE_GRAPH,
      facts: M3A1_REFERENCE_GRAPH.facts.toReversed(),
      citations: M3A1_REFERENCE_GRAPH.citations.toReversed(),
      edges: M3A1_REFERENCE_GRAPH.edges.toReversed(),
    };
    const original = await repository();
    const reversed = await repository(reordered);

    expect(unwrap(await reversed.snapshot()).graph).toEqual(
      unwrap(await original.snapshot()).graph,
    );
    expect(unwrap(await reversed.snapshot()).identity.sourceGraphDigest).toBe(
      unwrap(await original.snapshot()).identity.sourceGraphDigest,
    );
  });

  it("property-checks canonical output across arbitrary insertion orders", async () => {
    const expected = await repository();
    const expectedSnapshot = unwrap(await expected.snapshot());
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer(), {
          minLength: M3A1_REFERENCE_GRAPH.facts.length,
          maxLength: M3A1_REFERENCE_GRAPH.facts.length,
        }),
        fc.array(fc.integer(), {
          minLength: M3A1_REFERENCE_GRAPH.citations.length,
          maxLength: M3A1_REFERENCE_GRAPH.citations.length,
        }),
        fc.array(fc.integer(), {
          minLength: M3A1_REFERENCE_GRAPH.edges.length,
          maxLength: M3A1_REFERENCE_GRAPH.edges.length,
        }),
        async (factKeys, citationKeys, edgeKeys) => {
          const reordered: EvidenceGraph = {
            ...M3A1_REFERENCE_GRAPH,
            facts: reorderByKeys(M3A1_REFERENCE_GRAPH.facts, factKeys),
            citations: reorderByKeys(
              M3A1_REFERENCE_GRAPH.citations,
              citationKeys,
            ),
            edges: reorderByKeys(M3A1_REFERENCE_GRAPH.edges, edgeKeys),
          };
          const actual = await repository(reordered);
          expect(unwrap(await actual.snapshot()).graph).toEqual(
            expectedSnapshot.graph,
          );
        },
      ),
      { numRuns: 4 },
    );
  }, 20_000);

  it("binds valid-time and recorded-time lenses while preserving replay", async () => {
    const typeGraph = await repository();
    const before = unwrap(await typeGraph.snapshot());
    const factId = M3A1_REFERENCE_GRAPH.facts[0]?.id;
    if (factId === undefined) throw new Error("Expected a reference fact.");

    const retractedAt = unwrap(await typeGraph.retractFact(factId));
    const current = unwrap(await typeGraph.snapshot());
    const replay = unwrap(
      await typeGraph.snapshot({
        validAt: null,
        recordedAt: typeGraph.initialRecordedAt,
      }),
    );
    const pinned = unwrap(
      await typeGraph.snapshot({
        validAt: "2026-01-01T00:00:00.000Z",
        recordedAt: typeGraph.initialRecordedAt,
      }),
    );

    expect(retractedAt >= typeGraph.initialRecordedAt).toBe(true);
    expect(current.graph.facts.some((fact) => fact.id === factId)).toBe(false);
    expect(replay.graph).toEqual(before.graph);
    expect(pinned.graph).toEqual(before.graph);
    expect(replay.identity.storageSnapshotDigest).not.toBe(
      pinned.identity.storageSnapshotDigest,
    );
    expect(
      unwrap(
        await typeGraph.snapshot({
          validAt: null,
          recordedAt: typeGraph.initialRecordedAt,
        }),
      ),
    ).toEqual(replay);
  });

  it("keeps hidden additions outside selected evidence from changing visible results", async () => {
    const task = M3A1_PREREGISTERED_CORPUS.find(
      (candidate) => candidate.split === "development",
    );
    if (task === undefined) throw new Error("Expected a development task.");
    const citation = M3A1_REFERENCE_GRAPH.citations[0];
    if (citation === undefined) throw new Error("Expected a citation.");
    const hidden: EvidenceGraph = {
      ...M3A1_REFERENCE_GRAPH,
      facts: [
        ...M3A1_REFERENCE_GRAPH.facts,
        {
          id: "m4c-hidden-unrelated",
          statement: "Unrelated archival material.",
          subject: "hidden",
          predicate: "unrelated",
          object: "noise",
          citationIds: [citation.id],
          validFrom: null,
          validUntil: null,
          recordedFrom: citation.observedAt,
          recordedUntil: null,
        },
      ],
    };
    const original = await repository();
    const withHidden = await repository(hidden);
    const expected = unwrap(
      await selectEvidence(
        unwrap(await original.source("graph-typed")),
        task.query,
      ),
    );
    const actual = unwrap(
      await selectEvidence(
        unwrap(await withHidden.source("graph-typed")),
        task.query,
      ),
    );

    expect(actual.context).toEqual(expected.context);
    expect(
      unwrap(await withHidden.snapshot()).identity.sourceGraphDigest,
    ).not.toBe(unwrap(await original.snapshot()).identity.sourceGraphDigest);
  });
});

describe("M4c TypeGraph fail-closed behavior", () => {
  it("rejects duplicate identities, dangling references, and invalid intervals", async () => {
    const fact = M3A1_REFERENCE_GRAPH.facts[0];
    const edge = M3A1_REFERENCE_GRAPH.edges[0];
    if (fact === undefined || edge === undefined)
      throw new Error("Expected reference graph records.");
    const inputs: ReadonlyArray<unknown> = [
      {
        ...M3A1_REFERENCE_GRAPH,
        facts: [...M3A1_REFERENCE_GRAPH.facts, fact],
      },
      {
        ...M3A1_REFERENCE_GRAPH,
        edges: [{ ...edge, toFactId: "missing-fact" }],
      },
      {
        ...M3A1_REFERENCE_GRAPH,
        facts: M3A1_REFERENCE_GRAPH.facts.map((candidate, index) =>
          index === 0
            ? {
                ...candidate,
                validFrom: "2026-02-01T00:00:00.000Z",
                validUntil: "2026-01-01T00:00:00.000Z",
              }
            : candidate,
        ),
      },
    ];

    for (const graphInput of inputs) {
      expect(
        await createTypeGraphSqliteEvidenceRepository({ graphInput }),
      ).toMatchObject({ ok: false, error: { code: "INVALID_SOURCE_GRAPH" } });
    }
  });

  it("rejects schema/source mismatch when reopening a persistent store", async () => {
    const path = databasePath("identity");
    const first = await repository(M3A1_REFERENCE_GRAPH, path);
    await first.close();
    repositories.splice(repositories.indexOf(first), 1);

    expect(
      await createTypeGraphSqliteEvidenceRepository({
        graphInput: { ...M3A1_REFERENCE_GRAPH, version: "incompatible" },
        path,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SOURCE_IDENTITY_MISMATCH" },
    });
  });

  it("rejects a public-store manifest with an incompatible adapter schema", async () => {
    const store = await createLocalSqliteStore(TYPEGRAPH_EVIDENCE_SCHEMA, {
      store: { history: true },
    });
    await store.nodes.M4EvidenceManifest.create(
      {
        sourceGraphId: M3A1_REFERENCE_GRAPH.id,
        sourceGraphVersion: M3A1_REFERENCE_GRAPH.version,
        sourceGraphDigest: "0".repeat(64),
        adapterSchemaVersion: "unsupported",
      },
      {
        id: "m4c-source-manifest",
        validFrom: "0001-01-01T00:00:00.000Z",
      },
    );

    expect(
      await createTypeGraphEvidenceRepository({
        graphInput: M3A1_REFERENCE_GRAPH,
        store,
        backendIdentity: { id: "hostile-test-store", version: "1" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SCHEMA_VERSION_MISMATCH" },
    });
  });

  it("rejects an invalid host backend identity before adapter writes", async () => {
    const store = await createLocalSqliteStore(TYPEGRAPH_EVIDENCE_SCHEMA, {
      store: { history: true },
    });

    expect(
      await createTypeGraphEvidenceRepository({
        graphInput: M3A1_REFERENCE_GRAPH,
        store,
        backendIdentity: { id: "INVALID BACKEND", version: "" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "ADAPTER_CAPABILITY_VIOLATION" },
    });
  });

  it("classifies a host-store inspection failure without throwing", async () => {
    const store = await createLocalSqliteStore(TYPEGRAPH_EVIDENCE_SCHEMA, {
      store: { history: true },
    });
    await store.close();

    expect(
      await createTypeGraphEvidenceRepository({
        graphInput: M3A1_REFERENCE_GRAPH,
        store,
        backendIdentity: { id: "closed-test-store", version: "1" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "TYPEGRAPH_OPERATION_FAILED" },
    });
  });

  it("rejects snapshot mismatches, missing retractions, and use after close", async () => {
    const typeGraph = await repository();
    const snapshot = unwrap(
      await typeGraph.snapshot(CURRENT_TYPEGRAPH_SNAPSHOT),
    );

    expect(await typeGraph.assertSnapshot("0".repeat(64))).toMatchObject({
      ok: false,
      error: { code: "SNAPSHOT_MISMATCH" },
    });
    expect(
      unwrap(
        await typeGraph.assertSnapshot(snapshot.identity.storageSnapshotDigest),
      ),
    ).toEqual(snapshot);
    expect(await typeGraph.retractFact("missing-fact")).toMatchObject({
      ok: false,
      error: { code: "MISSING_REFERENCE" },
    });
    await typeGraph.close();
    expect(await typeGraph.snapshot()).toMatchObject({
      ok: false,
      error: { code: "REPOSITORY_CLOSED" },
    });
  });
});
