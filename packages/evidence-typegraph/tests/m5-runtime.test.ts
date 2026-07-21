import { chmod, mkdir, open, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  compilePlanJson,
  createCatalog,
  defineEffect,
  defineSchema,
  type ExecutablePlan,
  type ExecutablePlanSummary,
  inspectExecutablePlan,
  type Result,
} from "@nicia-ai/lachesis";
import {
  createInMemoryM5EvidenceStore,
  createM5OracleEffectIdentity,
  createM5RecordingOracleInterpreter,
  createMemoryM5RecordingStore,
  type EvidenceGraph,
  M4A_PROVIDER_PROFILES,
  m4d1OracleRequestSchema,
  m4OracleAnswerSchema,
  type M5EvidenceStore,
  type M5OracleEffect,
  type M5PublicTaskContract,
  type M5RecordingStore,
  type M5RuntimeResult,
  type M5TrustedPolicy,
  replayM5EvidenceRuntime,
  runM5EvidenceRuntime,
} from "@nicia-ai/lachesis-evidence";
import { createLocalSqliteStore } from "@nicia-ai/typegraph/sqlite/local";
import { afterEach, describe, expect, it } from "vitest";

import {
  createM5TypeGraphEvidenceStore,
  createTypeGraphEvidenceRepository,
  TYPEGRAPH_EVIDENCE_SCHEMA,
  type TypeGraphEvidenceRepository,
} from "../src/index.js";
import {
  createM5TypeGraphSqliteEvidenceStore,
  createTypeGraphSqliteEvidenceRepository,
  type M5ManagedSqliteEvidenceStore,
} from "../src/sqlite.js";

const repositories: Array<TypeGraphEvidenceRepository> = [];
const managedStores: Array<M5ManagedSqliteEvidenceStore> = [];
const paths: Array<string> = [];

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

async function databasePath(label: string): Promise<string> {
  const directory = join(
    tmpdir(),
    `lachesis-m5-${label}-${crypto.randomUUID()}`,
  );
  await mkdir(directory, { mode: 0o700 });
  paths.push(directory);
  return join(directory, "evidence.sqlite");
}

afterEach(async () => {
  await Promise.all(
    repositories.splice(0).map((repository) => repository.close()),
  );
  await Promise.all(managedStores.splice(0).map((store) => store.close()));
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const GRAPH: EvidenceGraph = {
  id: "m5-typegraph-parity",
  version: "1",
  citations: [
    {
      id: "citation-owner",
      source: "offline-registry",
      locator: "record/owner",
      observedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "citation-owner-replacement",
      source: "offline-registry",
      locator: "record/owner-replacement",
      observedAt: "2026-02-01T00:00:00.000Z",
    },
  ],
  facts: [
    {
      id: "fact-owner",
      statement: "Atlas owner is Mira.",
      subject: "Atlas",
      predicate: "owner",
      object: "Mira",
      citationIds: ["citation-owner"],
      validFrom: null,
      validUntil: null,
      recordedFrom: "2026-01-01T00:00:00.000Z",
      recordedUntil: null,
    },
    {
      id: "fact-owner-replacement",
      statement: "Atlas owner is Noor.",
      subject: "Atlas",
      predicate: "owner",
      object: "Noor",
      citationIds: ["citation-owner-replacement"],
      validFrom: "2026-02-01T00:00:00.000Z",
      validUntil: null,
      recordedFrom: "2026-01-01T00:00:00.000Z",
      recordedUntil: null,
    },
  ],
  edges: [],
};

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

async function plan(): Promise<
  Readonly<{ executable: ExecutablePlan; summary: ExecutablePlanSummary }>
> {
  const request = defineSchema({
    id: "m5/oracle-request",
    version: "1",
    description: "Reduced oracle request.",
    validator: m4d1OracleRequestSchema,
  });
  const output = defineSchema({
    id: "m5/oracle-output",
    version: "1",
    description: "Reduced oracle output.",
    validator: m4OracleAnswerSchema,
  });
  const oracle = defineEffect({
    id: "m5/oracle",
    version: "1",
    description: "Offline parity oracle.",
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
      identity: { id: "m5/parity-catalog", version: "1" },
      schemas: [request.runtime, output.runtime],
      operations: [oracle],
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
        catalog: { id: "m5/parity-catalog", version: "1" },
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
  if (summary === undefined) throw new Error("M5 parity plan is opaque.");
  return { executable, summary };
}

function policy(summary: ExecutablePlanSummary): M5TrustedPolicy {
  return {
    id: "m5-parity-policy",
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

async function oracle(): Promise<M5OracleEffect> {
  return {
    identity: unwrap(
      await createM5OracleEffectIdentity({
        id: "m5-parity-oracle",
        version: "1",
        implementation: "visible-owner/1",
      }),
    ),
    invoke: (request, context) => {
      const fact = request.evidence.facts.find(
        (candidate) => candidate.predicate === "owner",
      );
      const output =
        fact === undefined
          ? {
              outcome: "insufficient-evidence",
              answerValues: [],
              supportingFactIds: [],
            }
          : {
              outcome: "answered",
              answerValues: [fact.object],
              supportingFactIds: [fact.id],
            };
      return Promise.resolve({
        ok: true,
        value: {
          wireText: JSON.stringify(output),
          replayResultId: `parity/${context.requestDigest}`,
          usage: { inputTokens: 10, outputTokens: 5, wallClockMs: 1 },
        },
      });
    },
  };
}

async function run(
  evidenceStore: M5EvidenceStore,
  executable: ExecutablePlan,
  trustedPolicy: M5TrustedPolicy,
  recordingStore: M5RecordingStore = createMemoryM5RecordingStore(),
  recordedAt: string | null = null,
  validAt: string | null = null,
): Promise<M5RuntimeResult> {
  return unwrap(
    await runM5EvidenceRuntime({
      executablePlan: executable,
      publicTaskContract: TASK,
      inputValues: new Map(),
      trustedPolicy,
      evidenceStore,
      snapshot: { validAt, recordedAt },
      oracle: createM5RecordingOracleInterpreter(await oracle()),
      recordingStore,
      signal: new AbortController().signal,
    }),
  ).result;
}

function semanticProjection(result: M5RuntimeResult): Readonly<{
  answer: M5RuntimeResult["answer"];
  citations: M5RuntimeResult["citations"];
  provenance: M5RuntimeResult["provenance"];
  reconstructionDigest: string;
  visibleViewIdentity: M5RuntimeResult["visibleViewIdentity"];
}> {
  return {
    answer: result.answer,
    citations: result.citations,
    provenance: result.provenance,
    reconstructionDigest: result.reconstructionDigest,
    visibleViewIdentity: result.visibleViewIdentity,
  };
}

describe("M5 TypeGraph runtime parity", () => {
  it("maps TypeGraph adapter failures and cancellation into the portable store contract", async () => {
    const repository = unwrap(
      await createTypeGraphSqliteEvidenceRepository({
        graphInput: GRAPH,
        path: await databasePath("failure-map"),
      }),
    );
    repositories.push(repository);
    const adapted = unwrap(await createM5TypeGraphEvidenceStore(repository));
    const aborted = new AbortController();
    aborted.abort();
    expect(
      await adapted.snapshot(
        { validAt: null, recordedAt: null },
        aborted.signal,
      ),
    ).toMatchObject({ ok: false, error: { code: "CANCELLED" } });

    const failures = [
      { source: "SNAPSHOT_MISMATCH" as const, target: "SNAPSHOT_MISMATCH" },
      {
        source: "INVALID_SOURCE_GRAPH" as const,
        target: "STORE_OPERATION_FAILED",
      },
      {
        source: "SOURCE_IDENTITY_MISMATCH" as const,
        target: "STORE_OPERATION_FAILED",
      },
      {
        source: "SCHEMA_VERSION_MISMATCH" as const,
        target: "STORE_OPERATION_FAILED",
      },
      {
        source: "MISSING_REFERENCE" as const,
        target: "STORE_OPERATION_FAILED",
      },
      {
        source: "ADAPTER_CAPABILITY_VIOLATION" as const,
        target: "STORE_OPERATION_FAILED",
      },
      {
        source: "TYPEGRAPH_OPERATION_FAILED" as const,
        target: "STORE_OPERATION_FAILED",
      },
      {
        source: "IDENTITY_FAILURE" as const,
        target: "STORE_OPERATION_FAILED",
      },
    ];
    for (const item of failures) {
      const failingRepository: TypeGraphEvidenceRepository = {
        ...repository,
        snapshot: () =>
          Promise.resolve({
            ok: false,
            error: {
              code: item.source,
              message: "Injected TypeGraph failure.",
            },
          }),
      };
      const failingStore = unwrap(
        await createM5TypeGraphEvidenceStore(failingRepository),
      );
      expect(
        await failingStore.snapshot(
          { validAt: null, recordedAt: null },
          new AbortController().signal,
        ),
      ).toMatchObject({ ok: false, error: { code: item.target } });
    }
    await repository.close();
    expect(
      await adapted.snapshot(
        { validAt: null, recordedAt: null },
        new AbortController().signal,
      ),
    ).toMatchObject({ ok: false, error: { code: "STORE_CLOSED" } });
    repositories.splice(repositories.indexOf(repository), 1);
  });

  it("matches in-memory, host-provided HistoryStore, and managed SQLite workflows", async () => {
    const runtimePlan = await plan();
    const trustedPolicy = policy(runtimePlan.summary);
    const memory = unwrap(
      await createInMemoryM5EvidenceStore({
        id: "m5-parity-memory",
        version: "1",
        snapshots: [{ recordedAt: "2026-01-01T00:00:00.000Z", graph: GRAPH }],
      }),
    );

    const historyStore = await createLocalSqliteStore(
      TYPEGRAPH_EVIDENCE_SCHEMA,
      {
        path: await databasePath("host"),
        store: { history: true },
      },
    );
    const repository = unwrap(
      await createTypeGraphEvidenceRepository({
        graphInput: GRAPH,
        store: historyStore,
        backendIdentity: { id: "host-provided-sqlite", version: "1" },
      }),
    );
    repositories.push(repository);
    const hostProvided = unwrap(
      await createM5TypeGraphEvidenceStore(repository),
    );

    const managed = unwrap(
      await createM5TypeGraphSqliteEvidenceStore({
        graphInput: GRAPH,
        path: await databasePath("managed"),
      }),
    );
    managedStores.push(managed);

    const [memoryResult, hostResult, managedResult] = await Promise.all([
      run(memory, runtimePlan.executable, trustedPolicy),
      run(hostProvided, runtimePlan.executable, trustedPolicy),
      run(managed.store, runtimePlan.executable, trustedPolicy),
    ]);
    expect(semanticProjection(hostResult)).toEqual(
      semanticProjection(memoryResult),
    );
    expect(semanticProjection(managedResult)).toEqual(
      semanticProjection(memoryResult),
    );
    expect(hostResult.evidenceSnapshot.sourceSnapshotDigest).toBe(
      memoryResult.evidenceSnapshot.sourceSnapshotDigest,
    );
    expect(managedResult.evidenceSnapshot.sourceSnapshotDigest).toBe(
      memoryResult.evidenceSnapshot.sourceSnapshotDigest,
    );
    const permissionAudit = unwrap(await managed.permissionAudit());
    expect(permissionAudit?.artifacts.length).toBeGreaterThan(0);
    expect(hostResult.evidenceSnapshot.storageSnapshotDigest).not.toBe(
      memoryResult.evidenceSnapshot.storageSnapshotDigest,
    );
    expect(hostResult.evidenceSnapshot.store.implementation).toContain(
      "m4c-typegraph-evidence-adapter",
    );
  }, 20_000);

  it("replays a historical recorded-time answer after a later TypeGraph retraction", async () => {
    const runtimePlan = await plan();
    const trustedPolicy = policy(runtimePlan.summary);
    const managed = unwrap(
      await createM5TypeGraphSqliteEvidenceStore({
        graphInput: GRAPH,
        path: await databasePath("retraction"),
      }),
    );
    managedStores.push(managed);
    const recordings = createMemoryM5RecordingStore();
    const historical = await run(
      managed.store,
      runtimePlan.executable,
      trustedPolicy,
      recordings,
      managed.repository.initialRecordedAt,
      "2026-01-15T00:00:00.000Z",
    );
    expect(historical.answer.values).toEqual(["Mira"]);

    unwrap(await managed.repository.retractFact("fact-owner"));
    const current = await run(
      managed.store,
      runtimePlan.executable,
      trustedPolicy,
      createMemoryM5RecordingStore(),
      null,
      "2026-03-01T00:00:00.000Z",
    );
    expect(current.answer).toEqual({ outcome: "answered", values: ["Noor"] });

    const historicalArtifact = recordings
      .artifacts()
      .find(
        (artifact) => artifact.result.resultDigest === historical.resultDigest,
      );
    if (historicalArtifact === undefined)
      throw new Error("Historical replay artifact is missing.");
    const replayed = unwrap(
      await replayM5EvidenceRuntime({
        executablePlan: runtimePlan.executable,
        publicTaskContract: TASK,
        trustedPolicy,
        artifactDigest: historicalArtifact.artifactDigest,
        recordingStore: recordings,
        signal: new AbortController().signal,
      }),
    );
    expect(replayed).toEqual(historical);
  }, 20_000);
});

it("fails closed on managed SQLite symlinks and permission drift", async () => {
  const permissivePath = await databasePath("permissive");
  const permissive = await open(permissivePath, "wx", 0o600);
  await permissive.close();
  await chmod(permissivePath, 0o644);
  expect(
    await createM5TypeGraphSqliteEvidenceStore({
      graphInput: GRAPH,
      path: permissivePath,
    }),
  ).toMatchObject({
    ok: false,
    error: { code: "ADAPTER_CAPABILITY_VIOLATION" },
  });

  const linkedPath = await databasePath("linked");
  const targetPath = `${linkedPath}.target`;
  const target = await open(targetPath, "wx", 0o600);
  await target.close();
  await symlink(targetPath, linkedPath);
  expect(
    await createM5TypeGraphSqliteEvidenceStore({
      graphInput: GRAPH,
      path: linkedPath,
    }),
  ).toMatchObject({
    ok: false,
    error: { code: "ADAPTER_CAPABILITY_VIOLATION" },
  });

  const driftPath = await databasePath("drift");
  const managed = unwrap(
    await createM5TypeGraphSqliteEvidenceStore({
      graphInput: GRAPH,
      path: driftPath,
    }),
  );
  managedStores.push(managed);
  await chmod(driftPath, 0o644);
  expect(await managed.permissionAudit()).toMatchObject({
    ok: false,
    error: { code: "ADAPTER_CAPABILITY_VIOLATION" },
  });
});
