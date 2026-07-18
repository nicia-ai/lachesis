import { type Result } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import {
  compileM4EvidenceView,
  M3A1_PREREGISTERED_CORPUS,
  M3A1_REFERENCE_GRAPH,
  type M3aTask,
  M4A_EVIDENCE_COMPILER_PROTOCOL,
  M4A_INITIAL_POLICY,
  M4B_PROVENANCE_PROTOCOL,
  type M4CompiledEvidenceView,
  type M4EvidenceCompilerPolicy,
  type M4OracleAnswer,
  type M4Provider,
  reconstructM4Provenance,
  validateM4CompiledEvidenceView,
} from "../src/index.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function developmentTask(category: M3aTask["category"]): M3aTask {
  const task = M3A1_PREREGISTERED_CORPUS.find(
    (candidate) =>
      candidate.split === "development" && candidate.category === category,
  );
  if (task === undefined) throw new Error(`Missing ${category} task.`);
  return task;
}

async function compile(
  task: M3aTask,
  provider: M4Provider,
  taskClass: "relational" | "non-relational" | "negative-control",
  policyInput: unknown = M4A_INITIAL_POLICY,
): Promise<M4CompiledEvidenceView> {
  return unwrap(
    await compileM4EvidenceView({
      graphInput: M3A1_REFERENCE_GRAPH,
      queryInput: task.query,
      providerInput: provider,
      taskClassInput: taskClass,
      policyInput,
    }),
  );
}

function expectedAnswer(task: M3aTask): M4OracleAnswer {
  return {
    outcome: "answered",
    answerValues: task.expectedAnswerValues,
    supportingFactIds: task.expectedFactIds,
  };
}

describe("M4a provider-aware evidence compiler", () => {
  it("selects the frozen development-policy view and retains graph facts only as a control", async () => {
    const relational = developmentTask("multi-hop");
    const negative = developmentTask("negative-control");
    const openai = await compile(relational, "openai", "relational");
    const anthropic = await compile(relational, "anthropic", "relational");
    const openaiNegative = await compile(
      negative,
      "openai",
      "negative-control",
    );
    const anthropicNonRelational = await compile(
      negative,
      "anthropic",
      "non-relational",
    );

    expect(openai.identity.selectedView).toBe("graph-adjacency");
    expect(anthropic.identity.selectedView).toBe("graph-typed");
    expect(openaiNegative.identity.selectedView).toBe("lexical-facts");
    expect(anthropicNonRelational.identity.selectedView).toBe("lexical-facts");
    for (const compiled of [
      openai,
      anthropic,
      openaiNegative,
      anthropicNonRelational,
    ]) {
      expect(compiled.identity.experimentalControlView).toBe("graph-facts");
      expect(compiled.experimentalControlNeighborhood.source).toMatchObject({
        selection: "graph",
        encoding: "facts",
      });
      expect(compiled.identity.selectedView).not.toBe("graph-facts");
      expect(compiled.views.map((view) => view.view)).toEqual([
        "lexical-facts",
        "graph-facts",
        "graph-adjacency",
        "graph-typed",
      ]);
    }
  });

  it("keeps provider, view, policy, and source identity out of the model-visible context", async () => {
    const compiled = await compile(
      developmentTask("provenance"),
      "anthropic",
      "relational",
    );
    const visible = JSON.stringify(compiled.modelVisibleContext);

    expect(visible).not.toMatch(
      /anthropic|openai|graph-typed|graph-adjacency|graph-facts|lexical-facts|implementation|development-hypothesis/u,
    );
    expect(compiled.identity).toMatchObject({
      provider: "anthropic",
      selectedView: "graph-typed",
    });
  });

  it("canonicalizes policy rules and graph storage ordering into stable identities", async () => {
    const task = developmentTask("temporal");
    const reversedPolicy: M4EvidenceCompilerPolicy = {
      ...M4A_INITIAL_POLICY,
      rules: M4A_INITIAL_POLICY.rules.toReversed(),
    };
    const original = await compile(task, "openai", "relational");
    const reordered = unwrap(
      await compileM4EvidenceView({
        graphInput: {
          ...M3A1_REFERENCE_GRAPH,
          facts: M3A1_REFERENCE_GRAPH.facts.toReversed(),
          citations: M3A1_REFERENCE_GRAPH.citations.toReversed(),
          edges: M3A1_REFERENCE_GRAPH.edges.toReversed(),
        },
        queryInput: task.query,
        providerInput: "openai",
        taskClassInput: "relational",
        policyInput: reversedPolicy,
      }),
    );

    expect(reordered.identity).toEqual(original.identity);
    expect(reordered.modelVisibleContext).toEqual(original.modelVisibleContext);
  });

  it("rejects incomplete policies, graph-facts defaults, and tampered compiled identities", async () => {
    const task = developmentTask("multi-hop");
    const incomplete = {
      ...M4A_INITIAL_POLICY,
      rules: M4A_INITIAL_POLICY.rules.slice(1),
    };
    const graphFactsDefault = {
      ...M4A_INITIAL_POLICY,
      rules: M4A_INITIAL_POLICY.rules.map((rule, index) =>
        index === 0 ? { ...rule, view: "graph-facts" } : rule,
      ),
    };

    expect(
      await compileM4EvidenceView({
        graphInput: M3A1_REFERENCE_GRAPH,
        queryInput: task.query,
        providerInput: "openai",
        taskClassInput: "relational",
        policyInput: incomplete,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_POLICY" } });
    expect(
      await compileM4EvidenceView({
        graphInput: M3A1_REFERENCE_GRAPH,
        queryInput: task.query,
        providerInput: "openai",
        taskClassInput: "relational",
        policyInput: graphFactsDefault,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_POLICY" } });

    const valid = await compile(task, "openai", "relational");
    expect(
      await validateM4CompiledEvidenceView({
        ...valid,
        identity: { ...valid.identity, selectedView: "graph-typed" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_COMPILED_VIEW" },
    });
    expect(
      await validateM4CompiledEvidenceView({
        ...valid,
        graph: {
          ...valid.graph,
          citations: valid.graph.citations.map((citation, index) =>
            index === 0
              ? { ...citation, locator: `${citation.locator}#tampered` }
              : citation,
          ),
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_COMPILED_VIEW" },
    });
    const [firstView, ...remainingViews] = valid.views;
    if (firstView === undefined) throw new Error("Missing compiled view.");
    expect(
      await validateM4CompiledEvidenceView({
        ...valid,
        views: [
          {
            ...firstView,
            neighborhoodDigest: "0".repeat(64),
          },
          ...remainingViews,
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_COMPILED_VIEW" },
    });
  });

  it("keeps M4 offline and treats all M3 results only as policy-development evidence", () => {
    expect(M4A_EVIDENCE_COMPILER_PROTOCOL).toMatchObject({
      status: "offline-development-policy",
      evidenceBasis: "m3-development-evidence",
      liveInferenceAuthorized: false,
      campaignMaterializationAuthorized: false,
      heldoutMaterializationAuthorized: false,
      typeGraphIntegrated: false,
    });
    expect(M4B_PROVENANCE_PROTOCOL).toMatchObject({
      liveInferenceAuthorized: false,
      heldoutMaterializationAuthorized: false,
      typeGraphIntegrated: false,
    });
  });
});

describe("M4b deterministic provenance reconstruction", () => {
  it("derives canonical citations, evidence paths, and provenance from a reduced oracle answer", async () => {
    const task = developmentTask("multi-hop");
    const compiled = await compile(task, "openai", "relational");
    const reconstruction = unwrap(
      await reconstructM4Provenance({
        compiledViewInput: compiled,
        answerContractInput: task.answerContract,
        oracleAnswerInput: expectedAnswer(task),
      }),
    );

    expect(reconstruction.provenance.answerValues).toEqual(
      task.expectedAnswerValues,
    );
    expect(reconstruction.provenance.supportingFactIds).toEqual(
      task.expectedFactIds,
    );
    expect(reconstruction.provenance.citationIds).toEqual(
      [...task.expectedCitationIds, ...task.expectedEdgeCitationIds].toSorted(),
    );
    expect(reconstruction.provenance.edgeIds).toEqual(task.expectedEdgeIds);
    expect(reconstruction.provenance.paths).toEqual([
      {
        id: "m4-path-001",
        factIds: task.expectedPaths[0]?.factIds,
        edgeIds: task.expectedPaths[0]?.edgeIds,
      },
    ]);
    expect(reconstruction.provenance.links).toContainEqual({
      kind: "support-connected-by-path",
      fromFactId: task.expectedFactIds[0],
      toFactId: task.expectedFactIds[1],
      pathId: "m4-path-001",
    });
    expect(reconstruction.reconstructionDigest).toMatch(/^[a-f0-9]{64}$/u);

    const reordered = unwrap(
      await reconstructM4Provenance({
        compiledViewInput: compiled,
        answerContractInput: task.answerContract,
        oracleAnswerInput: {
          ...expectedAnswer(task),
          supportingFactIds: task.expectedFactIds.toReversed(),
        },
      }),
    );
    expect(reordered.provenance).toEqual(reconstruction.provenance);
  });

  it("passes deterministic reconstruction across every M3 development category and provider", async () => {
    const categories: ReadonlyArray<M3aTask["category"]> = [
      "multi-hop",
      "temporal",
      "contradiction",
      "provenance",
      "retraction",
      "negative-control",
    ];
    for (const category of categories) {
      const task = developmentTask(category);
      for (const provider of ["openai", "anthropic"] as const) {
        const compiled = await compile(
          task,
          provider,
          category === "negative-control" ? "negative-control" : "relational",
        );
        const reconstruction = unwrap(
          await reconstructM4Provenance({
            compiledViewInput: compiled,
            answerContractInput: task.answerContract,
            oracleAnswerInput: expectedAnswer(task),
          }),
        );
        expect(reconstruction.provenance.answerValues).toEqual(
          task.answerContract.ordering === "unordered"
            ? task.expectedAnswerValues.toSorted()
            : task.expectedAnswerValues,
        );
      }
    }
  }, 30_000);

  it("derives no path for a facts-only view while preserving canonical fact citations", async () => {
    const task = developmentTask("negative-control");
    const compiled = await compile(task, "openai", "negative-control");
    const reconstruction = unwrap(
      await reconstructM4Provenance({
        compiledViewInput: compiled,
        answerContractInput: task.answerContract,
        oracleAnswerInput: expectedAnswer(task),
      }),
    );

    expect(compiled.identity.selectedView).toBe("lexical-facts");
    expect(reconstruction.provenance.paths).toEqual([]);
    expect(reconstruction.provenance.edgeIds).toEqual([]);
    expect(reconstruction.provenance.citationIds).toEqual(
      task.expectedCitationIds,
    );
  });

  it("rejects hidden scorer fields, model-authored citations and paths, invalid support, and false abstention", async () => {
    const task = developmentTask("multi-hop");
    const compiled = await compile(task, "anthropic", "relational");
    const extraFields = {
      ...expectedAnswer(task),
      citationIds: task.expectedCitationIds,
      pathIds: ["m4-path-001"],
      expectedAnswerValues: task.expectedAnswerValues,
      semanticScore: 1,
    };
    const wrongSupport = {
      ...expectedAnswer(task),
      supportingFactIds: ["missing-fact"],
    };
    const falseAbstention: M4OracleAnswer = {
      outcome: "insufficient-evidence",
      answerValues: [],
      supportingFactIds: [],
    };

    expect(
      await reconstructM4Provenance({
        compiledViewInput: compiled,
        answerContractInput: task.answerContract,
        oracleAnswerInput: extraFields,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_ORACLE_ANSWER" },
    });
    expect(
      await reconstructM4Provenance({
        compiledViewInput: compiled,
        answerContractInput: task.answerContract,
        oracleAnswerInput: wrongSupport,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_OBLIGATION_FAILED" },
    });
    expect(
      await reconstructM4Provenance({
        compiledViewInput: compiled,
        answerContractInput: task.answerContract,
        oracleAnswerInput: falseAbstention,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "SEMANTIC_OBLIGATION_FAILED",
        issues: [
          {
            code: "abstention-when-complete-derivation-visible",
            path: ["outcome"],
          },
        ],
      },
    });
  });
});
