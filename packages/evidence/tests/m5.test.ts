import {
  compilePlanJson,
  createCatalog,
  defineEffect,
  defineSchema,
  digestValue,
  effectRequestHashSchema,
  type ExecutablePlan,
  type ExecutablePlanSummary,
  inspectExecutablePlan,
  type Result,
  valueDigestSchema,
} from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import {
  createInMemoryM5EvidenceStore,
  createM5MockOracleInterpreter,
  createM5OracleEffectIdentity,
  createM5RecordingOracleInterpreter,
  createMemoryM5RecordingStore,
  type EvidenceGraph,
  M4A_INITIAL_POLICY,
  M4A_PROVIDER_PROFILES,
  m4d1OracleRequestSchema,
  m4OracleAnswerSchema,
  type M5EvidenceStore,
  type M5OracleEffect,
  type M5OracleEffectIdentity,
  type M5PublicTaskContract,
  type M5RecordingStore,
  type M5ReplayArtifact,
  m5ReplayArtifactSchema,
  type M5TrustedPolicy,
  m5TrustedPolicySchema,
  replayM5EvidenceRuntime,
  runM5EvidenceRuntime,
} from "../src/index.js";

const HISTORICAL_RECORDED_AT = "2026-01-15T00:00:00.000Z";
const CURRENT_RECORDED_AT = "2026-03-01T00:00:00.000Z";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function graph(owner: string, factId: string): EvidenceGraph {
  return {
    id: "m5-owner-evidence",
    version: "1",
    citations: [
      {
        id: `citation-${factId}`,
        source: "offline-registry",
        locator: `record/${factId}`,
        observedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    facts: [
      {
        id: factId,
        statement: `Atlas owner is ${owner}.`,
        subject: "Atlas",
        predicate: "owner",
        object: owner,
        citationIds: [`citation-${factId}`],
        validFrom: null,
        validUntil: null,
        recordedFrom: "2026-01-01T00:00:00.000Z",
        recordedUntil: null,
      },
    ],
    edges: [],
  };
}

const HISTORICAL_GRAPH = graph("Mira", "atlas-owner-old");
const CURRENT_GRAPH = graph("Noor", "atlas-owner-current");

const TASK: M5PublicTaskContract = {
  id: "atlas-owner",
  version: "1",
  instruction: "Who is the owner of Atlas?",
  taskClass: "negative-control",
  answerContract: {
    role: "owner",
    cardinality: 1,
    ordering: "scalar",
    anchorSubject: "Atlas",
    derivation: "single-terminal-fact",
    requiredFactPredicates: ["owner"],
    answerSource: "terminal-object",
    minimumSupportingFacts: 1,
    sufficiencyRule:
      "answer-only-when-a-complete-visible-derivation-exists-otherwise-abstain",
  },
  evidenceLimits: {
    maxFacts: 4,
    maxCitations: 4,
    maxEdges: 2,
    maxPaths: 2,
    maxHops: 2,
    maxSerializedBytes: 8_000,
    maxSerializedTokenUpperBound: 8_000,
  },
};

async function runtimePlan(): Promise<
  Readonly<{ executable: ExecutablePlan; summary: ExecutablePlanSummary }>
> {
  const request = defineSchema({
    id: "m5/oracle-request",
    version: "1",
    description: "Reduced visible-evidence oracle request.",
    validator: m4d1OracleRequestSchema,
  });
  const output = defineSchema({
    id: "m5/oracle-output",
    version: "1",
    description: "Reduced evidence oracle output.",
    validator: m4OracleAnswerSchema,
  });
  const effect = defineEffect({
    id: "m5/oracle",
    version: "1",
    description: "Injected bounded evidence oracle.",
    input: request,
    output,
    effectName: "m5.oracle",
    capability: "evidence.oracle",
    maxTokens: 1_000,
    maxWallClockMs: 10_000,
    replayable: true,
  });
  const catalog = unwrap(
    createCatalog({
      identity: { id: "m5/runtime-catalog", version: "1" },
      schemas: [request.runtime, output.runtime],
      operations: [effect],
    }),
  );
  const budget = {
    maxEffectCalls: 1,
    maxCollectionItems: 64,
    maxRecursionDepth: 0,
    maxTokens: 1_000,
    maxWallClockMs: 10_000,
    maxParallelism: 1,
  };
  const executable = unwrap(
    await compilePlanJson(
      JSON.stringify({
        formatVersion: "1",
        catalog: { id: "m5/runtime-catalog", version: "1" },
        root: "answer",
        nodes: [
          {
            id: "request",
            op: "input",
            inputKey: "request",
            schema: { id: "m5/oracle-request", version: "1" },
          },
          {
            id: "answer",
            op: "effect",
            source: "request",
            effect: { id: "m5/oracle", version: "1" },
          },
        ],
        budget,
        allowedCapabilities: ["evidence.oracle"],
      }),
      catalog,
      { allowedCapabilities: ["evidence.oracle"], budget },
      [{ kind: "requiresEffect", effectName: "m5.oracle" }],
    ),
  );
  const summary = inspectExecutablePlan(executable);
  if (summary === undefined) throw new Error("M5 executable is opaque.");
  return { executable, summary };
}

function policy(summary: ExecutablePlanSummary): M5TrustedPolicy {
  return {
    id: "m5-production-policy",
    version: "1",
    expectedPlanHash: summary.planHash,
    expectedSemanticContractHash: summary.semanticContractHash,
    providerProfile: M4A_PROVIDER_PROFILES.openai,
    oracleInputName: "request",
    oracleEffectName: "m5.oracle",
    oracleCapability: "evidence.oracle",
    evidence: { kind: "lexical-default" },
    budget: {
      maxCalls: 1,
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxTotalTokens: 200,
      maxWallClockMs: 1_000,
      maxConcurrency: 1,
    },
  };
}

async function store(): Promise<M5EvidenceStore> {
  return unwrap(
    await createInMemoryM5EvidenceStore({
      id: "m5-versioned-memory",
      version: "1",
      snapshots: [
        {
          recordedAt: "2026-01-01T00:00:00.000Z",
          graph: HISTORICAL_GRAPH,
        },
        {
          recordedAt: "2026-02-01T00:00:00.000Z",
          graph: CURRENT_GRAPH,
        },
      ],
    }),
  );
}

async function effectIdentity(): Promise<M5OracleEffectIdentity> {
  return unwrap(
    await createM5OracleEffectIdentity({
      id: "offline-owner-oracle",
      version: "1",
      implementation: "deterministic-visible-fact/1",
    }),
  );
}

async function deterministicEffect(
  calls: Array<string>,
  override?: Readonly<{
    wireText?: string | undefined;
    usage?:
      | Readonly<{
          inputTokens: number;
          outputTokens: number;
          wallClockMs: number;
        }>
      | undefined;
  }>,
): Promise<M5OracleEffect> {
  return {
    identity: await effectIdentity(),
    invoke: (request, context) => {
      calls.push(context.requestDigest);
      const owner = request.evidence.facts.find(
        (fact) => fact.subject === "Atlas" && fact.predicate === "owner",
      );
      const output =
        owner === undefined
          ? {
              outcome: "insufficient-evidence" as const,
              answerValues: [],
              supportingFactIds: [],
            }
          : {
              outcome: "answered" as const,
              answerValues: [owner.object],
              supportingFactIds: [owner.id],
            };
      return Promise.resolve({
        ok: true,
        value: {
          wireText: override?.wireText ?? JSON.stringify(output),
          replayResultId: `offline/${context.requestDigest}`,
          usage: override?.usage ?? {
            inputTokens: 20,
            outputTokens: 10,
            wallClockMs: 2,
          },
        },
      });
    },
  };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

function artifactBody(
  artifact: M5ReplayArtifact,
): Omit<M5ReplayArtifact, "artifactDigest"> {
  const { artifactDigest, ...body } = artifact;
  void artifactDigest;
  return body;
}

async function signArtifact(
  body: Omit<M5ReplayArtifact, "artifactDigest">,
): Promise<M5ReplayArtifact> {
  return m5ReplayArtifactSchema.parse({
    ...body,
    artifactDigest: unwrap(await digestValue(body)),
  });
}

describe("M5a production evidence runtime", () => {
  it("fails closed at in-memory snapshot and mock interpreter boundaries", async () => {
    expect(
      await createInMemoryM5EvidenceStore({
        id: "Invalid ID",
        version: "1",
        snapshots: [],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_STORE_INPUT" },
    });
    expect(
      await createInMemoryM5EvidenceStore({
        id: "duplicate-snapshots",
        version: "1",
        snapshots: [
          {
            recordedAt: "2026-01-01T00:00:00.000Z",
            graph: HISTORICAL_GRAPH,
          },
          {
            recordedAt: "2026-01-01T00:00:00.000Z",
            graph: CURRENT_GRAPH,
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_STORE_INPUT" },
    });
    const evidenceStore = await store();
    const aborted = new AbortController();
    aborted.abort();
    expect(
      await evidenceStore.snapshot(
        { validAt: null, recordedAt: null },
        aborted.signal,
      ),
    ).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
    expect(
      await evidenceStore.snapshot(
        { validAt: "not-an-instant", recordedAt: null },
        signal(),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_STORE_INPUT" },
    });
    expect(
      await evidenceStore.snapshot(
        { validAt: null, recordedAt: "2025-01-01T00:00:00.000Z" },
        signal(),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SNAPSHOT_NOT_FOUND" },
    });
    expect(
      await createM5OracleEffectIdentity({
        id: "Invalid ID",
        version: "1",
        implementation: "invalid",
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });

    const plan = await runtimePlan();
    const trustedPolicy = policy(plan.summary);
    const seedStore = createMemoryM5RecordingStore();
    const seeded = unwrap(
      await runM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        inputValues: new Map(),
        trustedPolicy,
        evidenceStore,
        snapshot: { validAt: null, recordedAt: CURRENT_RECORDED_AT },
        oracle: createM5RecordingOracleInterpreter(
          await deterministicEffect([]),
        ),
        recordingStore: seedStore,
        signal: signal(),
      }),
    );
    const seededArtifact = seedStore
      .artifacts()
      .find((artifact) => artifact.artifactDigest === seeded.artifactDigest);
    if (seededArtifact === undefined) throw new Error("Seed artifact missing.");
    expect(
      await seedStore.load(seeded.artifactDigest, aborted.signal),
    ).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
    expect(
      await createM5MockOracleInterpreter({
        identity: { ...seededArtifact.oracle.identity, id: "Invalid ID" },
        fixtures: [],
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(
      await createM5MockOracleInterpreter({
        identity: seededArtifact.oracle.identity,
        fixtures: [
          {
            request: seededArtifact.oracle.request,
            result: {
              kind: "success",
              value: seededArtifact.oracle.wireResult,
            },
          },
          {
            request: seededArtifact.oracle.request,
            result: {
              kind: "success",
              value: seededArtifact.oracle.wireResult,
            },
          },
        ],
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    const emptyMock = unwrap(
      await createM5MockOracleInterpreter({
        identity: seededArtifact.oracle.identity,
        fixtures: [],
      }),
    );
    expect(
      await emptyMock.effect.invoke(seededArtifact.oracle.request, {
        requestDigest: seededArtifact.oracle.requestDigest,
        budget: trustedPolicy.budget,
        signal: signal(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "ORACLE_EFFECT_FAILED" },
    });
    expect(
      await emptyMock.effect.invoke(seededArtifact.oracle.request, {
        requestDigest: seededArtifact.oracle.requestDigest,
        budget: trustedPolicy.budget,
        signal: aborted.signal,
      }),
    ).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  });

  it("pins historical/current snapshots and replays the historical result without evidence or oracle access", async () => {
    const plan = await runtimePlan();
    const trustedPolicy = policy(plan.summary);
    const evidenceStore = await store();
    const recordings = createMemoryM5RecordingStore();
    const calls: Array<string> = [];
    const oracle = createM5RecordingOracleInterpreter(
      await deterministicEffect(calls),
    );
    const inputValues = new Map<string, string>([["tenant", "offline"]]);
    const historical = unwrap(
      await runM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        inputValues,
        trustedPolicy,
        evidenceStore,
        snapshot: { validAt: null, recordedAt: HISTORICAL_RECORDED_AT },
        oracle,
        recordingStore: recordings,
        signal: signal(),
      }),
    );
    const current = unwrap(
      await runM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        inputValues: new Map(),
        trustedPolicy,
        evidenceStore,
        snapshot: { validAt: null, recordedAt: CURRENT_RECORDED_AT },
        oracle,
        recordingStore: recordings,
        signal: signal(),
      }),
    );

    expect(historical.result.answer).toEqual({
      outcome: "answered",
      values: ["Mira"],
    });
    expect(current.result.answer).toEqual({
      outcome: "answered",
      values: ["Noor"],
    });
    expect(historical.result.visibleViewIdentity.visibleViewDigest).not.toBe(
      current.result.visibleViewIdentity.visibleViewDigest,
    );
    expect(historical.result.citations.map((citation) => citation.id)).toEqual([
      "citation-atlas-owner-old",
    ]);
    expect(historical.result.provenance.supportingFactIds).toEqual([
      "atlas-owner-old",
    ]);
    const callsBeforeReplay = calls.length;
    const replayed = unwrap(
      await replayM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        trustedPolicy,
        artifactDigest: historical.artifactDigest,
        recordingStore: recordings,
        signal: signal(),
      }),
    );
    expect(replayed).toEqual(historical.result);
    expect(calls).toHaveLength(callsBeforeReplay);
    expect(inputValues).toEqual(new Map([["tenant", "offline"]]));
    expect(Object.isFrozen(historical.result)).toBe(true);
  });

  it("uses lexical evidence by default and requires explicit research opt-in", async () => {
    const plan = await runtimePlan();
    const trustedPolicy = policy(plan.summary);
    const recordings = createMemoryM5RecordingStore();
    const calls: Array<string> = [];
    const completed = unwrap(
      await runM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        inputValues: new Map(),
        trustedPolicy,
        evidenceStore: await store(),
        snapshot: { validAt: null, recordedAt: CURRENT_RECORDED_AT },
        oracle: createM5RecordingOracleInterpreter(
          await deterministicEffect(calls),
        ),
        recordingStore: recordings,
        signal: signal(),
      }),
    );
    const artifact = recordings
      .artifacts()
      .find(
        (candidate) => candidate.artifactDigest === completed.artifactDigest,
      );
    expect(artifact?.compiledView.identity.selectedView).toBe("lexical-facts");
    expect(JSON.stringify(artifact?.oracle.request)).not.toMatch(
      /openai|anthropic|lexical-facts|graph-adjacency|graph-typed|policy|typegraph/iu,
    );

    expect(
      m5TrustedPolicySchema.safeParse({
        ...trustedPolicy,
        evidence: { kind: "research-opt-in", policy: M4A_INITIAL_POLICY },
      }).success,
    ).toBe(false);

    const researchCompilerPolicy = {
      ...M4A_INITIAL_POLICY,
      id: "m5-explicit-research-view",
      rules: M4A_INITIAL_POLICY.rules.map((rule) =>
        rule.provider === "openai" && rule.taskClass === "negative-control"
          ? { ...rule, view: "graph-adjacency" as const }
          : rule,
      ),
    };
    const researchRecordings = createMemoryM5RecordingStore();
    const research = unwrap(
      await runM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        inputValues: new Map(),
        trustedPolicy: {
          ...trustedPolicy,
          evidence: {
            kind: "research-opt-in",
            acknowledgement: "explicit-research-policy-opt-in",
            policy: researchCompilerPolicy,
          },
        },
        evidenceStore: await store(),
        snapshot: { validAt: null, recordedAt: CURRENT_RECORDED_AT },
        oracle: createM5RecordingOracleInterpreter(
          await deterministicEffect(calls),
        ),
        recordingStore: researchRecordings,
        signal: signal(),
      }),
    );
    expect(
      researchRecordings
        .artifacts()
        .find(
          (candidate) => candidate.artifactDigest === research.artifactDigest,
        )?.compiledView.identity.selectedView,
    ).toBe("graph-adjacency");

    const repeated = unwrap(
      await runM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        inputValues: new Map(),
        trustedPolicy,
        evidenceStore: await store(),
        snapshot: { validAt: null, recordedAt: CURRENT_RECORDED_AT },
        oracle: createM5RecordingOracleInterpreter(
          await deterministicEffect(calls),
        ),
        recordingStore: recordings,
        signal: signal(),
      }),
    );
    expect(repeated.artifactDigest).toBe(completed.artifactDigest);
  });

  it("supports deterministic mock fixtures and injected failures", async () => {
    const plan = await runtimePlan();
    const trustedPolicy = policy(plan.summary);
    const recordingCalls: Array<string> = [];
    const seedRecordings = createMemoryM5RecordingStore();
    const seeded = unwrap(
      await runM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        inputValues: new Map(),
        trustedPolicy,
        evidenceStore: await store(),
        snapshot: { validAt: null, recordedAt: CURRENT_RECORDED_AT },
        oracle: createM5RecordingOracleInterpreter(
          await deterministicEffect(recordingCalls),
        ),
        recordingStore: seedRecordings,
        signal: signal(),
      }),
    );
    const seededArtifact = seedRecordings
      .artifacts()
      .find((artifact) => artifact.artifactDigest === seeded.artifactDigest);
    if (seededArtifact === undefined) throw new Error("Seed artifact missing.");
    const mock = unwrap(
      await createM5MockOracleInterpreter({
        identity: await effectIdentity(),
        fixtures: [
          {
            request: seededArtifact.oracle.request,
            result: {
              kind: "success",
              value: seededArtifact.oracle.wireResult,
            },
          },
        ],
      }),
    );
    const mocked = unwrap(
      await runM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        inputValues: new Map(),
        trustedPolicy,
        evidenceStore: await store(),
        snapshot: { validAt: null, recordedAt: CURRENT_RECORDED_AT },
        oracle: mock,
        recordingStore: createMemoryM5RecordingStore(),
        signal: signal(),
      }),
    );
    expect(mocked.result.answer.values).toEqual(["Noor"]);

    const fault = unwrap(
      await createM5MockOracleInterpreter({
        identity: await effectIdentity(),
        fixtures: [
          {
            request: seededArtifact.oracle.request,
            result: {
              kind: "failure",
              error: {
                code: "ORACLE_EFFECT_FAILED",
                message: "Injected deterministic fault.",
              },
            },
          },
        ],
      }),
    );
    expect(
      await runM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        inputValues: new Map(),
        trustedPolicy,
        evidenceStore: await store(),
        snapshot: { validAt: null, recordedAt: CURRENT_RECORDED_AT },
        oracle: fault,
        recordingStore: createMemoryM5RecordingStore(),
        signal: signal(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "ORACLE_EFFECT_FAILED", stage: "oracle" },
    });
  });

  it("fails closed on identity, snapshot, visible-view, capability, budget, wire, semantic, replay, and cancellation defects", async () => {
    const plan = await runtimePlan();
    const trustedPolicy = policy(plan.summary);
    const evidenceStore = await store();
    const calls: Array<string> = [];
    const validOracle = createM5RecordingOracleInterpreter(
      await deterministicEffect(calls),
    );
    const base = {
      executablePlan: plan.executable,
      publicTaskContract: TASK,
      inputValues: new Map(),
      trustedPolicy,
      evidenceStore,
      snapshot: { validAt: null, recordedAt: CURRENT_RECORDED_AT },
      oracle: validOracle,
      recordingStore: createMemoryM5RecordingStore(),
      signal: signal(),
    };
    expect(
      await runM5EvidenceRuntime({
        ...base,
        trustedPolicy: { ...trustedPolicy, expectedPlanHash: "0".repeat(64) },
      }),
    ).toMatchObject({ ok: false, error: { code: "PLAN_MISMATCH" } });
    expect(
      await runM5EvidenceRuntime({
        ...base,
        trustedPolicy: {
          ...trustedPolicy,
          expectedSemanticContractHash: "0".repeat(64),
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_CONTRACT_MISMATCH" },
    });
    expect(
      await runM5EvidenceRuntime({
        ...base,
        expectedStorageSnapshotDigest: "0".repeat(64),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_SNAPSHOT_MISMATCH" },
    });
    expect(
      await runM5EvidenceRuntime({
        ...base,
        expectedVisibleViewDigest: "0".repeat(64),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "VISIBLE_VIEW_MISMATCH" },
    });
    expect(
      await runM5EvidenceRuntime({
        ...base,
        trustedPolicy: {
          ...trustedPolicy,
          oracleCapability: "denied.oracle",
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "CAPABILITY_DENIED" } });

    const excessiveUsage = createM5RecordingOracleInterpreter(
      await deterministicEffect(calls, {
        usage: { inputTokens: 101, outputTokens: 10, wallClockMs: 2 },
      }),
    );
    expect(
      await runM5EvidenceRuntime({ ...base, oracle: excessiveUsage }),
    ).toMatchObject({ ok: false, error: { code: "BUDGET_EXHAUSTED" } });
    const invalidWire = createM5RecordingOracleInterpreter(
      await deterministicEffect(calls, { wireText: "not-json" }),
    );
    expect(
      await runM5EvidenceRuntime({ ...base, oracle: invalidWire }),
    ).toMatchObject({ ok: false, error: { code: "ORACLE_WIRE_REJECTED" } });
    const unsupported = createM5RecordingOracleInterpreter({
      identity: await effectIdentity(),
      invoke: () =>
        Promise.resolve({
          ok: true,
          value: {
            wireText: JSON.stringify({
              outcome: "answered",
              answerValues: ["Hidden"],
              supportingFactIds: ["hidden-fact"],
            }),
            replayResultId: "unsupported",
            usage: { inputTokens: 1, outputTokens: 1, wallClockMs: 1 },
          },
        }),
    });
    expect(
      await runM5EvidenceRuntime({ ...base, oracle: unsupported }),
    ).toMatchObject({
      ok: false,
      error: { code: "MISSING_OR_UNSUPPORTED_FACTS" },
    });
    const semanticError = createM5RecordingOracleInterpreter({
      identity: await effectIdentity(),
      invoke: (request) => {
        const fact = request.evidence.facts[0];
        return Promise.resolve({
          ok: true,
          value: {
            wireText: JSON.stringify({
              outcome: "answered",
              answerValues: ["Wrong"],
              supportingFactIds: fact === undefined ? [] : [fact.id],
            }),
            replayResultId: "semantic-error",
            usage: { inputTokens: 1, outputTokens: 1, wallClockMs: 1 },
          },
        });
      },
    });
    expect(
      await runM5EvidenceRuntime({ ...base, oracle: semanticError }),
    ).toMatchObject({
      ok: false,
      error: { code: "ORACLE_SEMANTIC_REJECTED" },
    });

    const cancelledController = new AbortController();
    cancelledController.abort();
    expect(
      await runM5EvidenceRuntime({
        ...base,
        signal: cancelledController.signal,
      }),
    ).toMatchObject({ ok: false, error: { code: "CANCELLED" } });

    const recordingStore = createMemoryM5RecordingStore();
    const valid = unwrap(
      await runM5EvidenceRuntime({ ...base, recordingStore }),
    );
    expect(
      await replayM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: { ...TASK, version: "2" },
        trustedPolicy,
        artifactDigest: valid.artifactDigest,
        recordingStore,
        signal: signal(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_ARTIFACT_MISMATCH" },
    });
  });

  it("maps hostile stores, typed oracle failures, thrown effects, and recording failures", async () => {
    const plan = await runtimePlan();
    const trustedPolicy = policy(plan.summary);
    const evidenceStore = await store();
    const validSnapshot = unwrap(
      await evidenceStore.snapshot(
        { validAt: null, recordedAt: CURRENT_RECORDED_AT },
        signal(),
      ),
    );
    const validEffect = await deterministicEffect([]);
    const base = {
      executablePlan: plan.executable,
      publicTaskContract: TASK,
      inputValues: new Map(),
      trustedPolicy,
      snapshot: { validAt: null, recordedAt: CURRENT_RECORDED_AT },
      oracle: createM5RecordingOracleInterpreter(validEffect),
      recordingStore: createMemoryM5RecordingStore(),
      signal: signal(),
    };
    const storeErrors = [
      { code: "CANCELLED" as const, expected: "CANCELLED" },
      {
        code: "SNAPSHOT_MISMATCH" as const,
        expected: "EVIDENCE_SNAPSHOT_MISMATCH",
      },
      {
        code: "STORE_OPERATION_FAILED" as const,
        expected: "EVIDENCE_STORE_FAILED",
      },
    ];
    for (const item of storeErrors) {
      const failingStore: M5EvidenceStore = {
        identity: evidenceStore.identity,
        snapshot: () =>
          Promise.resolve({
            ok: false,
            error: { code: item.code, message: "Injected store failure." },
          }),
      };
      expect(
        await runM5EvidenceRuntime({ ...base, evidenceStore: failingStore }),
      ).toMatchObject({ ok: false, error: { code: item.expected } });
    }
    const throwingStore: M5EvidenceStore = {
      identity: evidenceStore.identity,
      snapshot: () => Promise.reject(new Error("store")),
    };
    expect(
      await runM5EvidenceRuntime({ ...base, evidenceStore: throwingStore }),
    ).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_STORE_FAILED" },
    });
    const wrongStoreIdentity: M5EvidenceStore = {
      identity: evidenceStore.identity,
      snapshot: () =>
        Promise.resolve({
          ok: true,
          value: {
            ...validSnapshot,
            identity: {
              ...validSnapshot.identity,
              store: {
                ...validSnapshot.identity.store,
                storeDigest: "0".repeat(64),
              },
            },
          },
        }),
    };
    expect(
      await runM5EvidenceRuntime({
        ...base,
        evidenceStore: wrongStoreIdentity,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_SNAPSHOT_MISMATCH" },
    });
    const wrongCoordinateStore: M5EvidenceStore = {
      identity: evidenceStore.identity,
      snapshot: () =>
        Promise.resolve({
          ok: true,
          value: {
            ...validSnapshot,
            identity: {
              ...validSnapshot.identity,
              coordinate: { validAt: null, recordedAt: null },
            },
          },
        }),
    };
    expect(
      await runM5EvidenceRuntime({
        ...base,
        evidenceStore: wrongCoordinateStore,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_SNAPSHOT_MISMATCH" },
    });
    const invalidGraphStore: M5EvidenceStore = {
      identity: evidenceStore.identity,
      snapshot: () =>
        Promise.resolve({
          ok: true,
          value: {
            ...validSnapshot,
            graph: {
              ...validSnapshot.graph,
              id: "Invalid ID",
            },
          },
        }),
    };
    expect(
      await runM5EvidenceRuntime({ ...base, evidenceStore: invalidGraphStore }),
    ).toMatchObject({
      ok: false,
      error: { code: "MISSING_OR_UNSUPPORTED_FACTS" },
    });
    const wrongGraphDigestStore: M5EvidenceStore = {
      identity: evidenceStore.identity,
      snapshot: () =>
        Promise.resolve({
          ok: true,
          value: {
            ...validSnapshot,
            identity: {
              ...validSnapshot.identity,
              sourceSnapshotDigest: "0".repeat(64),
            },
          },
        }),
    };
    expect(
      await runM5EvidenceRuntime({
        ...base,
        evidenceStore: wrongGraphDigestStore,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_SNAPSHOT_MISMATCH" },
    });

    for (const code of [
      "CAPABILITY_DENIED",
      "BUDGET_EXHAUSTED",
      "CANCELLED",
    ] as const) {
      const oracle = createM5RecordingOracleInterpreter({
        identity: await effectIdentity(),
        invoke: () =>
          Promise.resolve({
            ok: false,
            error: { code, message: "Injected oracle failure." },
          }),
      });
      expect(
        await runM5EvidenceRuntime({
          ...base,
          evidenceStore,
          oracle,
        }),
      ).toMatchObject({ ok: false, error: { code } });
    }
    const throwingOracle = createM5RecordingOracleInterpreter({
      identity: await effectIdentity(),
      invoke: () => Promise.reject(new Error("oracle")),
    });
    expect(
      await runM5EvidenceRuntime({
        ...base,
        evidenceStore,
        oracle: throwingOracle,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "ORACLE_EFFECT_FAILED" },
    });
    for (const usage of [
      { inputTokens: 1, outputTokens: 101, wallClockMs: 1 },
      { inputTokens: 1, outputTokens: 1, wallClockMs: 1_001 },
    ]) {
      expect(
        await runM5EvidenceRuntime({
          ...base,
          evidenceStore,
          oracle: createM5RecordingOracleInterpreter(
            await deterministicEffect([], { usage }),
          ),
        }),
      ).toMatchObject({ ok: false, error: { code: "BUDGET_EXHAUSTED" } });
    }
    const saveThrows: M5RecordingStore = {
      load: () => Promise.resolve({ ok: true, value: undefined }),
      save: () => Promise.reject(new Error("recording")),
    };
    expect(
      await runM5EvidenceRuntime({
        ...base,
        evidenceStore,
        recordingStore: saveThrows,
      }),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });
    const saveRejects: M5RecordingStore = {
      load: () => Promise.resolve({ ok: true, value: undefined }),
      save: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "RECORDING_FAILED",
            stage: "recording",
            message: "Injected save rejection.",
            issues: [],
          },
        }),
    };
    expect(
      await runM5EvidenceRuntime({
        ...base,
        evidenceStore,
        recordingStore: saveRejects,
      }),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });
  });

  it("detects provenance reconstruction corruption after a correctly re-signed replay artifact", async () => {
    const plan = await runtimePlan();
    const trustedPolicy = policy(plan.summary);
    const sourceStore = createMemoryM5RecordingStore();
    const valid = unwrap(
      await runM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        inputValues: new Map(),
        trustedPolicy,
        evidenceStore: await store(),
        snapshot: { validAt: null, recordedAt: CURRENT_RECORDED_AT },
        oracle: createM5RecordingOracleInterpreter(
          await deterministicEffect([]),
        ),
        recordingStore: sourceStore,
        signal: signal(),
      }),
    );
    const original = sourceStore
      .artifacts()
      .find((artifact) => artifact.artifactDigest === valid.artifactDigest);
    if (original === undefined) throw new Error("Artifact missing.");
    const tamperedBody = {
      ...original,
      compiledView: {
        ...original.compiledView,
        identity: {
          ...original.compiledView.identity,
          visibleViewDigest: "0".repeat(64),
        },
      },
    };
    const { artifactDigest: oldDigest, ...unsigned } = tamperedBody;
    void oldDigest;
    const digest = unwrap(await digestValue(unsigned));
    const tampered = m5ReplayArtifactSchema.parse({
      ...unsigned,
      artifactDigest: digest,
    });
    const tamperedStore: M5RecordingStore = {
      load: () => Promise.resolve({ ok: true, value: tampered }),
      save: () => Promise.resolve({ ok: true, value: undefined }),
    };
    const replay = await replayM5EvidenceRuntime({
      executablePlan: plan.executable,
      publicTaskContract: TASK,
      trustedPolicy,
      artifactDigest: tampered.artifactDigest,
      recordingStore: tamperedStore,
      signal: signal(),
    });
    expect(replay).toMatchObject({
      ok: false,
      error: { code: "PROVENANCE_RECONSTRUCTION_FAILED" },
    });
  });

  it("classifies replay-store, request, effect, output, snapshot, and result corruption", async () => {
    const plan = await runtimePlan();
    const trustedPolicy = policy(plan.summary);
    const recordings = createMemoryM5RecordingStore();
    const valid = unwrap(
      await runM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        inputValues: new Map(),
        trustedPolicy,
        evidenceStore: await store(),
        snapshot: { validAt: null, recordedAt: CURRENT_RECORDED_AT },
        oracle: createM5RecordingOracleInterpreter(
          await deterministicEffect([]),
        ),
        recordingStore: recordings,
        signal: signal(),
      }),
    );
    const original = recordings
      .artifacts()
      .find((artifact) => artifact.artifactDigest === valid.artifactDigest);
    if (original === undefined) throw new Error("Replay artifact missing.");
    const aborted = new AbortController();
    aborted.abort();
    expect(
      await replayM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        trustedPolicy,
        artifactDigest: original.artifactDigest,
        recordingStore: recordings,
        signal: aborted.signal,
      }),
    ).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
    const loadingThrows: M5RecordingStore = {
      load: () => Promise.reject(new Error("load")),
      save: () => Promise.resolve({ ok: true, value: undefined }),
    };
    expect(
      await replayM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        trustedPolicy,
        artifactDigest: original.artifactDigest,
        recordingStore: loadingThrows,
        signal: signal(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_ARTIFACT_MISMATCH" },
    });
    const loadingRejects: M5RecordingStore = {
      load: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "REPLAY_ARTIFACT_MISMATCH",
            stage: "replay",
            message: "Injected load rejection.",
            issues: [],
          },
        }),
      save: () => Promise.resolve({ ok: true, value: undefined }),
    };
    expect(
      await replayM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        trustedPolicy,
        artifactDigest: original.artifactDigest,
        recordingStore: loadingRejects,
        signal: signal(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_ARTIFACT_MISMATCH" },
    });
    expect(
      await replayM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        trustedPolicy,
        artifactDigest: "0".repeat(64),
        recordingStore: recordings,
        signal: signal(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_ARTIFACT_MISMATCH" },
    });
    const alwaysOriginal: M5RecordingStore = {
      load: () => Promise.resolve({ ok: true, value: original }),
      save: () => Promise.resolve({ ok: true, value: undefined }),
    };
    expect(
      await replayM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        trustedPolicy,
        artifactDigest: "0".repeat(64),
        recordingStore: alwaysOriginal,
        signal: signal(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_ARTIFACT_MISMATCH" },
    });

    const wrongRequest = await signArtifact({
      ...artifactBody(original),
      oracle: { ...original.oracle, requestDigest: "0".repeat(64) },
    });
    const wrongRequestStore: M5RecordingStore = {
      load: () => Promise.resolve({ ok: true, value: wrongRequest }),
      save: () => Promise.resolve({ ok: true, value: undefined }),
    };
    expect(
      await replayM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        trustedPolicy,
        artifactDigest: wrongRequest.artifactDigest,
        recordingStore: wrongRequestStore,
        signal: signal(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_ARTIFACT_MISMATCH" },
    });

    const replayEntry = original.replayEntries[0];
    if (replayEntry === undefined) throw new Error("Replay entry missing.");
    const wrongEffect = await signArtifact({
      ...artifactBody(original),
      replayEntries: [
        {
          ...replayEntry,
          requestHash: effectRequestHashSchema.parse("0".repeat(64)),
        },
      ],
    });
    const wrongEffectStore: M5RecordingStore = {
      load: () => Promise.resolve({ ok: true, value: wrongEffect }),
      save: () => Promise.resolve({ ok: true, value: undefined }),
    };
    expect(
      await replayM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        trustedPolicy,
        artifactDigest: wrongEffect.artifactDigest,
        recordingStore: wrongEffectStore,
        signal: signal(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_ARTIFACT_MISMATCH" },
    });

    const differentOutput = {
      outcome: "answered",
      answerValues: ["Different"],
      supportingFactIds: ["atlas-owner-current"],
    };
    const differentOutputDigest = unwrap(await digestValue(differentOutput));
    const wrongOutput = await signArtifact({
      ...artifactBody(original),
      replayEntries: [
        {
          ...replayEntry,
          value: differentOutput,
          outputDigest: valueDigestSchema.parse(differentOutputDigest),
        },
      ],
    });
    const wrongOutputStore: M5RecordingStore = {
      load: () => Promise.resolve({ ok: true, value: wrongOutput }),
      save: () => Promise.resolve({ ok: true, value: undefined }),
    };
    expect(
      await replayM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        trustedPolicy,
        artifactDigest: wrongOutput.artifactDigest,
        recordingStore: wrongOutputStore,
        signal: signal(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_ARTIFACT_MISMATCH" },
    });

    const wrongSnapshot = await signArtifact({
      ...artifactBody(original),
      evidenceSnapshot: {
        ...original.evidenceSnapshot,
        identity: {
          ...original.evidenceSnapshot.identity,
          sourceSnapshotDigest: "0".repeat(64),
        },
      },
    });
    const wrongSnapshotStore: M5RecordingStore = {
      load: () => Promise.resolve({ ok: true, value: wrongSnapshot }),
      save: () => Promise.resolve({ ok: true, value: undefined }),
    };
    expect(
      await replayM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        trustedPolicy,
        artifactDigest: wrongSnapshot.artifactDigest,
        recordingStore: wrongSnapshotStore,
        signal: signal(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_SNAPSHOT_MISMATCH" },
    });

    const wrongResult = await signArtifact({
      ...artifactBody(original),
      result: { ...original.result, resultDigest: "0".repeat(64) },
    });
    const wrongResultStore: M5RecordingStore = {
      load: () => Promise.resolve({ ok: true, value: wrongResult }),
      save: () => Promise.resolve({ ok: true, value: undefined }),
    };
    expect(
      await replayM5EvidenceRuntime({
        executablePlan: plan.executable,
        publicTaskContract: TASK,
        trustedPolicy,
        artifactDigest: wrongResult.artifactDigest,
        recordingStore: wrongResultStore,
        signal: signal(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_ARTIFACT_MISMATCH" },
    });
  });
});
