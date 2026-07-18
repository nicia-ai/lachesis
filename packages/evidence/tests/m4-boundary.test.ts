import { digestValue, type Result } from "@nicia-ai/lachesis";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  compileM4EvidenceView,
  type EvidenceGraph,
  type EvidenceQuery,
  M3A1_PREREGISTERED_CORPUS,
  M3A1_REFERENCE_GRAPH,
  type M3bAnswerContract,
  M4A_INITIAL_POLICY,
  M4A_PROVIDER_PROFILES,
  M4B_RECONSTRUCTION_ALGORITHM,
  type M4CompiledEvidenceView,
  type M4Provider,
  reconstructM4Provenance,
  validateM4CompiledEvidenceView,
} from "../src/index.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function developmentMultiHopTask() {
  const candidate = M3A1_PREREGISTERED_CORPUS.find(
    (entry) => entry.split === "development" && entry.category === "multi-hop",
  );
  if (candidate === undefined)
    throw new Error("Missing development multi-hop task.");
  return candidate;
}

const task = developmentMultiHopTask();

function withHiddenFacts(
  graph: EvidenceGraph,
  suffixes: ReadonlyArray<string>,
): EvidenceGraph {
  return {
    ...graph,
    citations: [
      ...graph.citations,
      ...suffixes.map((suffix) => ({
        id: `cite-m4-hidden-${suffix}`,
        source: "hidden-audit-source",
        locator: `hidden://${suffix}`,
        observedAt: "2026-01-01T00:00:00.000Z",
      })),
    ],
    facts: [
      ...graph.facts,
      ...suffixes.map((suffix) => ({
        id: `fact-m4-hidden-${suffix}`,
        statement: `A concealed unrelated audit fact ${suffix} exists.`,
        subject: `hidden-subject-${suffix}`,
        predicate: "hidden-predicate",
        object: `hidden-object-${suffix}`,
        citationIds: [`cite-m4-hidden-${suffix}`],
        validFrom: null,
        validUntil: null,
        recordedFrom: "2026-01-01T00:00:00.000Z",
        recordedUntil: null,
      })),
    ],
  };
}

async function compileFixture(input: {
  readonly graph: EvidenceGraph;
  readonly query: EvidenceQuery;
  readonly contract: M3bAnswerContract;
  readonly provider?: M4Provider;
  readonly taskClass?: "relational" | "non-relational" | "negative-control";
}): Promise<M4CompiledEvidenceView> {
  const provider = input.provider ?? "anthropic";
  return unwrap(
    await compileM4EvidenceView({
      graphInput: input.graph,
      queryInput: input.query,
      providerProfileInput: M4A_PROVIDER_PROFILES[provider],
      taskProfileInput: {
        taskClass: input.taskClass ?? "relational",
        answerContract: input.contract,
      },
    }),
  );
}

async function compile(graph: EvidenceGraph): Promise<M4CompiledEvidenceView> {
  return compileFixture({
    graph,
    query: task.query,
    contract: task.answerContract,
  });
}

const RECORDED_AT = "2026-01-01T00:00:00.000Z";

function pathFixture(): Readonly<{
  graph: EvidenceGraph;
  query: EvidenceQuery;
  contract: M3bAnswerContract;
  answer: Readonly<{
    outcome: "answered";
    answerValues: ReadonlyArray<string>;
    supportingFactIds: ReadonlyArray<string>;
  }>;
}> {
  const citations = [
    "cite-path-employer",
    "cite-path-headquarters",
    "cite-path-middle-a",
    "cite-path-middle-b",
    "cite-path-edge-a1",
    "cite-path-edge-a2",
    "cite-path-edge-b1",
    "cite-path-edge-b2",
  ].map((id) => ({
    id,
    source: "path-fixture",
    locator: `fixture://${id}`,
    observedAt: RECORDED_AT,
  }));
  const facts = [
    {
      id: "fact-path-employer",
      statement: "Pathperson works for Pathorg.",
      subject: "pathperson",
      predicate: "employer",
      object: "pathorg",
      citationIds: ["cite-path-employer"],
    },
    {
      id: "fact-path-headquarters",
      statement: "Pathorg has headquarters in Pathcity.",
      subject: "pathorg",
      predicate: "headquarters",
      object: "pathcity",
      citationIds: ["cite-path-headquarters"],
    },
    {
      id: "fact-path-middle-a",
      statement: "Path route A is recorded.",
      subject: "path-route-a",
      predicate: "route",
      object: "path-a",
      citationIds: ["cite-path-middle-a"],
    },
    {
      id: "fact-path-middle-b",
      statement: "Path route B is recorded.",
      subject: "path-route-b",
      predicate: "route",
      object: "path-b",
      citationIds: ["cite-path-middle-b"],
    },
  ].map((fact) => ({
    ...fact,
    validFrom: null,
    validUntil: null,
    recordedFrom: RECORDED_AT,
    recordedUntil: null,
  }));
  const edgeInputs = [
    [
      "edge-path-a1",
      "fact-path-employer",
      "fact-path-middle-a",
      "cite-path-edge-a1",
    ],
    [
      "edge-path-a2",
      "fact-path-middle-a",
      "fact-path-headquarters",
      "cite-path-edge-a2",
    ],
    [
      "edge-path-b1",
      "fact-path-employer",
      "fact-path-middle-b",
      "cite-path-edge-b1",
    ],
    [
      "edge-path-b2",
      "fact-path-middle-b",
      "fact-path-headquarters",
      "cite-path-edge-b2",
    ],
  ] as const;
  const edges = edgeInputs.map(([id, fromFactId, toFactId, citationId]) => ({
    id,
    fromFactId,
    toFactId,
    relationship: "related" as const,
    provenanceCitationIds: [citationId],
    validFrom: null,
    validUntil: null,
    recordedFrom: RECORDED_AT,
    recordedUntil: null,
  }));
  return {
    graph: {
      id: "m4-path-fixture",
      version: "1",
      facts,
      citations,
      edges,
    },
    query: {
      id: "query-m4-path-fixture",
      text: "Which city hosts the headquarters of pathperson's employer?",
      validAt: RECORDED_AT,
      recordedAt: RECORDED_AT,
      maxFacts: 4,
      maxCitations: 12,
      maxEdges: 4,
      maxPaths: 16,
      maxHops: 4,
      maxSerializedBytes: 100_000,
      maxSerializedTokenUpperBound: 100_000,
    },
    contract: {
      role: "headquarters-city",
      cardinality: 1,
      ordering: "scalar",
      anchorSubject: "pathperson",
      derivation: "object-to-subject-chain",
      requiredFactPredicates: ["employer", "headquarters"],
      answerSource: "terminal-object",
      minimumSupportingFacts: 2,
      sufficiencyRule:
        "answer-only-when-a-complete-visible-derivation-exists-otherwise-abstain",
    },
    answer: {
      outcome: "answered",
      answerValues: ["pathcity"],
      supportingFactIds: ["fact-path-employer", "fact-path-headquarters"],
    },
  };
}

describe("M4a.1 visible-evidence noninterference", () => {
  it("keeps reconstruction identity invariant when hidden source facts do not change the visible view", async () => {
    const original = await compile(M3A1_REFERENCE_GRAPH);
    const hiddenMutation = await compile(
      withHiddenFacts(M3A1_REFERENCE_GRAPH, ["one"]),
    );
    expect(hiddenMutation.modelVisibleContext).toEqual(
      original.modelVisibleContext,
    );
    expect(hiddenMutation.identity.visibleViewDigest).toBe(
      original.identity.visibleViewDigest,
    );
    expect(hiddenMutation.identity.sourceSnapshotDigest).not.toBe(
      original.identity.sourceSnapshotDigest,
    );
    expect(hiddenMutation.identity.compilerAuditDigest).not.toBe(
      original.identity.compilerAuditDigest,
    );

    const oracleAnswer = {
      outcome: "answered",
      answerValues: task.expectedAnswerValues,
      supportingFactIds: task.expectedFactIds,
    };
    const originalResult = unwrap(
      await reconstructM4Provenance({
        compiledViewInput: original,
        oracleAnswerInput: oracleAnswer,
      }),
    );
    const hiddenMutationResult = unwrap(
      await reconstructM4Provenance({
        compiledViewInput: hiddenMutation,
        oracleAnswerInput: oracleAnswer,
      }),
    );

    expect(hiddenMutationResult.provenance).toEqual(originalResult.provenance);
    expect(hiddenMutationResult.reconstructionDigest).toBe(
      originalResult.reconstructionDigest,
    );
  });

  it("property-tests hidden-fact noninterference over identical visible views", async () => {
    const original = await compile(M3A1_REFERENCE_GRAPH);
    const originalResult = unwrap(
      await reconstructM4Provenance({
        compiledViewInput: original,
        oracleAnswerInput: {
          outcome: "answered",
          answerValues: task.expectedAnswerValues,
          supportingFactIds: task.expectedFactIds,
        },
      }),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 1, max: 999 }), {
          minLength: 1,
          maxLength: 5,
        }),
        async (values) => {
          const mutated = await compile(
            withHiddenFacts(
              M3A1_REFERENCE_GRAPH,
              values.map((value) => value.toString().padStart(3, "0")),
            ),
          );
          expect(mutated.modelVisibleContext).toEqual(
            original.modelVisibleContext,
          );
          const result = unwrap(
            await reconstructM4Provenance({
              compiledViewInput: mutated,
              oracleAnswerInput: {
                outcome: "answered",
                answerValues: task.expectedAnswerValues,
                supportingFactIds: task.expectedFactIds,
              },
            }),
          );
          expect(result).toEqual(originalResult);
        },
      ),
      { numRuns: 12 },
    );
  }, 30_000);

  it("does not let a hidden supporting fact validate an otherwise unsupported answer", async () => {
    const visible = await compile(M3A1_REFERENCE_GRAPH);
    const employer = visible.modelVisibleContext.facts.find(
      (fact) => fact.id === task.expectedFactIds[0],
    );
    if (employer === undefined)
      throw new Error("Missing visible employer fact.");
    const hiddenCitationId = "cite-m4-hidden-headquarters";
    const hiddenFactId = "fact-m4-hidden-headquarters";
    const graph: EvidenceGraph = {
      ...M3A1_REFERENCE_GRAPH,
      citations: [
        ...M3A1_REFERENCE_GRAPH.citations,
        {
          id: hiddenCitationId,
          source: "hidden-audit-source",
          locator: "hidden://headquarters",
          observedAt: RECORDED_AT,
        },
      ],
      facts: [
        ...M3A1_REFERENCE_GRAPH.facts,
        {
          id: hiddenFactId,
          statement: "A concealed terminal fact names HiddenCity.",
          subject: employer.object,
          predicate: "headquarters",
          object: "hiddencity",
          citationIds: [hiddenCitationId],
          validFrom: null,
          validUntil: null,
          recordedFrom: RECORDED_AT,
          recordedUntil: null,
        },
      ],
    };
    const compiled = await compile(graph);
    expect(compiled.modelVisibleContext.facts).not.toContainEqual(
      expect.objectContaining({ id: hiddenFactId }),
    );
    expect(
      await reconstructM4Provenance({
        compiledViewInput: compiled,
        oracleAnswerInput: {
          outcome: "answered",
          answerValues: ["hiddencity"],
          supportingFactIds: [employer.id, hiddenFactId],
        },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "SEMANTIC_OBLIGATION_FAILED",
        issues: [{ code: "answer-support-does-not-form-visible-derivation" }],
      },
    });
  });

  it("does not use a hidden shortcut edge and deterministically chooses among visible shortest paths", async () => {
    const fixture = pathFixture();
    const original = await compileFixture(fixture);
    const originalResult = unwrap(
      await reconstructM4Provenance({
        compiledViewInput: original,
        oracleAnswerInput: fixture.answer,
      }),
    );
    expect(originalResult.provenance.paths).toEqual([
      {
        id: "m4-path-001",
        factIds: [
          "fact-path-employer",
          "fact-path-middle-a",
          "fact-path-headquarters",
        ],
        edgeIds: ["edge-path-a1", "edge-path-a2"],
      },
    ]);

    const hiddenShortcut: EvidenceGraph = {
      ...fixture.graph,
      citations: [
        ...fixture.graph.citations,
        {
          id: "cite-path-hidden-shortcut",
          source: "path-fixture",
          locator: "fixture://hidden-shortcut",
          observedAt: RECORDED_AT,
        },
      ],
      edges: [
        ...fixture.graph.edges,
        {
          id: "edge-z-hidden-shortcut",
          fromFactId: "fact-path-employer",
          toFactId: "fact-path-headquarters",
          relationship: "related",
          provenanceCitationIds: ["cite-path-hidden-shortcut"],
          validFrom: null,
          validUntil: null,
          recordedFrom: RECORDED_AT,
          recordedUntil: null,
        },
      ],
    };
    const mutated = await compileFixture({ ...fixture, graph: hiddenShortcut });
    expect(mutated.modelVisibleContext).toEqual(original.modelVisibleContext);
    const mutatedResult = unwrap(
      await reconstructM4Provenance({
        compiledViewInput: mutated,
        oracleAnswerInput: fixture.answer,
      }),
    );
    expect(mutatedResult).toEqual(originalResult);

    const reordered = await compileFixture({
      ...fixture,
      graph: {
        ...fixture.graph,
        facts: fixture.graph.facts.toReversed(),
        citations: fixture.graph.citations.toReversed(),
        edges: fixture.graph.edges.toReversed(),
      },
    });
    const reorderedResult = unwrap(
      await reconstructM4Provenance({
        compiledViewInput: reordered,
        oracleAnswerInput: fixture.answer,
      }),
    );
    expect(reorderedResult).toEqual(originalResult);
  });

  it("rejects an answer when a required visible supporting fact is removed", async () => {
    const removedFactId = task.expectedFactIds[1];
    if (removedFactId === undefined)
      throw new Error("Missing support identity.");
    const graph: EvidenceGraph = {
      ...M3A1_REFERENCE_GRAPH,
      facts: M3A1_REFERENCE_GRAPH.facts.filter(
        (fact) => fact.id !== removedFactId,
      ),
      edges: M3A1_REFERENCE_GRAPH.edges.filter(
        (edge) =>
          edge.fromFactId !== removedFactId && edge.toFactId !== removedFactId,
      ),
    };
    const compiled = await compile(graph);
    expect(compiled.modelVisibleContext.facts).not.toContainEqual(
      expect.objectContaining({ id: removedFactId }),
    );
    expect(
      await reconstructM4Provenance({
        compiledViewInput: compiled,
        oracleAnswerInput: {
          outcome: "answered",
          answerValues: task.expectedAnswerValues,
          supportingFactIds: task.expectedFactIds,
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_OBLIGATION_FAILED" },
    });
  });

  it("keeps every accepted support, citation, edge, and path inside the visible evidence closure", async () => {
    const compiled = await compile(M3A1_REFERENCE_GRAPH);
    const result = unwrap(
      await reconstructM4Provenance({
        compiledViewInput: compiled,
        oracleAnswerInput: {
          outcome: "answered",
          answerValues: task.expectedAnswerValues,
          supportingFactIds: task.expectedFactIds,
        },
      }),
    );
    const visibleFactIds = new Set(
      compiled.modelVisibleContext.facts.map((fact) => fact.id),
    );
    const visibleCitationIds = new Set(
      compiled.modelVisibleContext.citations.map((citation) => citation.id),
    );
    const visibleEdgeIds = new Set(
      compiled.modelVisibleContext.edges.map((edge) => edge.id),
    );
    expect(
      result.provenance.supportingFactIds.every((id) => visibleFactIds.has(id)),
    ).toBe(true);
    expect(
      result.provenance.citationIds.every((id) => visibleCitationIds.has(id)),
    ).toBe(true);
    expect(
      result.provenance.edgeIds.every((id) => visibleEdgeIds.has(id)),
    ).toBe(true);
    expect(
      result.provenance.paths.every(
        (path) =>
          path.factIds.every((id) => visibleFactIds.has(id)) &&
          path.edgeIds.every((id) => visibleEdgeIds.has(id)),
      ),
    ).toBe(true);
  });

  it("preserves behavior under entity renaming while changing content identities", async () => {
    const fixture = pathFixture();
    const original = await compileFixture(fixture);
    const originalResult = unwrap(
      await reconstructM4Provenance({
        compiledViewInput: original,
        oracleAnswerInput: fixture.answer,
      }),
    );
    const rename = (value: string): string =>
      value
        .replaceAll("Pathperson", "Renamedperson")
        .replaceAll("Pathorg", "Renamedorg")
        .replaceAll("Pathcity", "Renamedcity")
        .replaceAll("pathperson", "renamedperson")
        .replaceAll("pathorg", "renamedorg")
        .replaceAll("pathcity", "renamedcity");
    const renamedGraph: EvidenceGraph = {
      ...fixture.graph,
      facts: fixture.graph.facts.map((fact) => ({
        ...fact,
        statement: rename(fact.statement),
        subject: rename(fact.subject),
        object: rename(fact.object),
      })),
    };
    const renamed = await compileFixture({
      ...fixture,
      graph: renamedGraph,
      query: { ...fixture.query, text: rename(fixture.query.text) },
      contract: {
        ...fixture.contract,
        anchorSubject: "renamedperson",
      },
    });
    const renamedResult = unwrap(
      await reconstructM4Provenance({
        compiledViewInput: renamed,
        oracleAnswerInput: {
          ...fixture.answer,
          answerValues: ["renamedcity"],
        },
      }),
    );

    expect(renamedResult.provenance.supportingFactIds).toEqual(
      originalResult.provenance.supportingFactIds,
    );
    expect(renamedResult.provenance.paths).toEqual(
      originalResult.provenance.paths,
    );
    expect(renamedResult.provenance.answerValues).toEqual(["renamedcity"]);
    expect(renamed.identity.policyDigest).toBe(original.identity.policyDigest);
    expect(renamed.identity.providerProfileDigest).toBe(
      original.identity.providerProfileDigest,
    );
    expect(renamed.identity.sourceSnapshotDigest).not.toBe(
      original.identity.sourceSnapshotDigest,
    );
    expect(renamed.identity.queryDigest).not.toBe(
      original.identity.queryDigest,
    );
    expect(renamed.identity.taskContractDigest).not.toBe(
      original.identity.taskContractDigest,
    );
    expect(renamed.identity.visibleViewDigest).not.toBe(
      original.identity.visibleViewDigest,
    );
    expect(renamedResult.reconstructionDigest).not.toBe(
      originalResult.reconstructionDigest,
    );
  });

  it("rejects hidden policy inputs and keeps provider and arm labels outside the visible context", async () => {
    const hiddenProviderProfile = {
      ...M4A_PROVIDER_PROFILES.openai,
      expectedAnswer: task.expectedAnswerValues,
    };
    const hiddenTaskProfile = {
      taskClass: "relational",
      answerContract: task.answerContract,
      hiddenProperties: ["semantic-score"],
      expectedOutcome: "answered",
    };
    expect(
      await compileM4EvidenceView({
        graphInput: M3A1_REFERENCE_GRAPH,
        queryInput: task.query,
        providerProfileInput: hiddenProviderProfile,
        taskProfileInput: {
          taskClass: "relational",
          answerContract: task.answerContract,
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_PROVIDER" } });
    expect(
      await compileM4EvidenceView({
        graphInput: M3A1_REFERENCE_GRAPH,
        queryInput: task.query,
        providerProfileInput: M4A_PROVIDER_PROFILES.openai,
        taskProfileInput: hiddenTaskProfile,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_TASK_CLASS" } });

    const compiled = await compileFixture({
      graph: M3A1_REFERENCE_GRAPH,
      query: task.query,
      contract: task.answerContract,
      provider: "openai",
    });
    expect(JSON.stringify(compiled.modelVisibleContext)).not.toMatch(
      /openai|anthropic|graph-adjacency|graph-typed|graph-facts|lexical-facts|provider-profile|selector/u,
    );
  });

  it("binds each content identity at its trust layer", async () => {
    const compiled = await compile(M3A1_REFERENCE_GRAPH);
    const result = unwrap(
      await reconstructM4Provenance({
        compiledViewInput: compiled,
        oracleAnswerInput: {
          outcome: "answered",
          answerValues: task.expectedAnswerValues,
          supportingFactIds: task.expectedFactIds,
        },
      }),
    );
    for (const digest of [
      compiled.identity.policyDigest,
      compiled.identity.providerProfileDigest,
      compiled.identity.taskContractDigest,
      compiled.identity.selectorManifestDigest,
      compiled.identity.sourceSnapshotDigest,
      compiled.identity.queryDigest,
      compiled.identity.selectedNeighborhoodDigest,
      compiled.identity.visibleViewDigest,
      compiled.identity.compilerAuditDigest,
      result.reconstructionAlgorithmDigest,
      result.reconstructionDigest,
    ])
      expect(digest).toMatch(/^[a-f0-9]{64}$/u);

    expect(compiled.identity.protocol).toBe(
      "m4a-provider-aware-evidence-compiler/2",
    );
    expect(result.protocol).toBe(
      "m4b-deterministic-provenance-reconstruction/2",
    );
    expect(result.visibleViewDigest).toBe(compiled.identity.visibleViewDigest);
    expect(result.taskContractDigest).toBe(
      compiled.identity.taskContractDigest,
    );
    expect(unwrap(await digestValue(compiled.providerProfile))).toBe(
      compiled.identity.providerProfileDigest,
    );
    expect(unwrap(await digestValue(compiled.taskProfile.answerContract))).toBe(
      compiled.identity.taskContractDigest,
    );
    expect(unwrap(await digestValue(compiled.selectorManifest))).toBe(
      compiled.identity.selectorManifestDigest,
    );
    expect(unwrap(await digestValue(compiled.graph))).toBe(
      compiled.identity.sourceSnapshotDigest,
    );
    expect(unwrap(await digestValue(compiled.modelVisibleContext))).toBe(
      compiled.identity.visibleViewDigest,
    );
    expect(unwrap(await digestValue(M4B_RECONSTRUCTION_ALGORITHM))).toBe(
      result.reconstructionAlgorithmDigest,
    );
    expect(compiled.policy.version).toBe(M4A_INITIAL_POLICY.version);
    expect(
      compiled.selectorManifest.map((entry) => entry.implementation),
    ).toEqual([
      "matched-rendered-chunks/2",
      "in-memory-reference-graph/facts/2",
      "in-memory-reference-graph/untyped-adjacency/2",
      "in-memory-reference-graph/typed-relationships/2",
    ]);

    const revisedProviderProfile = unwrap(
      await compileM4EvidenceView({
        graphInput: M3A1_REFERENCE_GRAPH,
        queryInput: task.query,
        providerProfileInput: {
          ...M4A_PROVIDER_PROFILES.anthropic,
          version: "2",
        },
        taskProfileInput: {
          taskClass: "relational",
          answerContract: task.answerContract,
        },
      }),
    );
    expect(revisedProviderProfile.modelVisibleContext).toEqual(
      compiled.modelVisibleContext,
    );
    expect(revisedProviderProfile.identity.visibleViewDigest).toBe(
      compiled.identity.visibleViewDigest,
    );
    expect(revisedProviderProfile.identity.providerProfileDigest).not.toBe(
      compiled.identity.providerProfileDigest,
    );
    expect(revisedProviderProfile.identity.compilerAuditDigest).not.toBe(
      compiled.identity.compilerAuditDigest,
    );
    expect(
      await validateM4CompiledEvidenceView({
        ...compiled,
        selectorManifest: compiled.selectorManifest.map((entry, index) =>
          index === 0
            ? { ...entry, implementation: "tampered-selector/99" }
            : entry,
        ),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_COMPILED_VIEW" },
    });
  });
});
