import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createM5TypeGraphEvidenceStore,
  createTypeGraphEvidenceRepository,
  TYPEGRAPH_EVIDENCE_SCHEMA,
} from "@nicia-ai/lachesis-evidence-typegraph";
import { createM5TypeGraphSqliteEvidenceStore } from "@nicia-ai/lachesis-evidence-typegraph/sqlite";
import {
  compilePlan,
  createCatalog,
  createInMemoryEvidenceStore,
  createMemoryRecordingStore,
  createMockOracleInterpreter,
  createOracleEffectIdentity,
  createRecordingOracleInterpreter,
  defineEffect,
  defineSchema,
  inspectExecutablePlan,
  oracleAnswerSchema,
  oracleRequestSchema,
  replay,
  run,
} from "@nicia-ai/lachesis-runtime";
import { createPrivateFileRecordingStore } from "@nicia-ai/lachesis-runtime/node";
import { createLocalSqliteStore } from "@nicia-ai/typegraph/sqlite/local";

const HISTORICAL_RECORDED_AT = "2026-01-15T00:00:00.000Z";
const CURRENT_RECORDED_AT = "2026-03-01T00:00:00.000Z";

const graph = {
  id: "alpha-owner-history",
  version: "1",
  citations: [
    {
      id: "citation-owner-old",
      source: "offline-registry",
      locator: "owner/old",
      observedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "citation-owner-current",
      source: "offline-registry",
      locator: "owner/current",
      observedAt: "2026-02-01T00:00:00.000Z",
    },
  ],
  facts: [
    {
      id: "fact-owner-old",
      statement: "Atlas owner is Mira.",
      subject: "Atlas",
      predicate: "owner",
      object: "Mira",
      citationIds: ["citation-owner-old"],
      validFrom: null,
      validUntil: "2026-02-01T00:00:00.000Z",
      recordedFrom: "2026-01-01T00:00:00.000Z",
      recordedUntil: null,
    },
    {
      id: "fact-owner-replacement",
      statement: "Atlas owner is Noor.",
      subject: "Atlas",
      predicate: "owner",
      object: "Noor",
      citationIds: ["citation-owner-current"],
      validFrom: "2026-02-01T00:00:00.000Z",
      validUntil: null,
      recordedFrom: "2026-01-01T00:00:00.000Z",
      recordedUntil: null,
    },
  ],
  edges: [],
};

const task = {
  id: "atlas-owner",
  version: "1",
  instruction: "Who owns Atlas?",
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

function unwrap(result, label) {
  if (!result.ok)
    throw new Error(
      `${label} failed: ${result.error.code}: ${result.error.message}`,
    );
  return result.value;
}

async function planAndPolicy() {
  const request = defineSchema({
    id: "alpha/oracle-request",
    version: "1",
    description: "Reduced visible-evidence request.",
    validator: oracleRequestSchema,
  });
  const output = defineSchema({
    id: "alpha/oracle-output",
    version: "1",
    description: "Reduced visible-evidence answer.",
    validator: oracleAnswerSchema,
  });
  const effect = defineEffect({
    id: "alpha/oracle",
    version: "1",
    description: "Injected bounded oracle.",
    input: request,
    output,
    effectName: "alpha.oracle",
    capability: "evidence.oracle",
    maxTokens: 1_000,
    maxWallClockMs: 10_000,
    replayable: true,
  });
  const catalog = unwrap(
    createCatalog({
      identity: { id: "alpha/catalog", version: "1" },
      schemas: [request.runtime, output.runtime],
      operations: [effect],
    }),
    "catalog",
  );
  const budget = {
    maxEffectCalls: 1,
    maxCollectionItems: 4,
    maxRecursionDepth: 0,
    maxTokens: 1_000,
    maxWallClockMs: 10_000,
    maxParallelism: 1,
  };
  const executablePlan = unwrap(
    await compilePlan(
      JSON.stringify({
        formatVersion: "1",
        catalog: { id: "alpha/catalog", version: "1" },
        root: "answer",
        nodes: [
          {
            id: "request",
            op: "input",
            inputKey: "request",
            schema: { id: "alpha/oracle-request", version: "1" },
          },
          {
            id: "answer",
            op: "effect",
            source: "request",
            effect: { id: "alpha/oracle", version: "1" },
          },
        ],
        budget,
        allowedCapabilities: ["evidence.oracle"],
      }),
      catalog,
      { allowedCapabilities: ["evidence.oracle"], budget },
      [{ kind: "requiresEffect", effectName: "alpha.oracle" }],
    ),
    "plan",
  );
  const summary = inspectExecutablePlan(executablePlan);
  if (summary === undefined) throw new Error("Plan identity is unavailable.");
  return {
    executablePlan,
    policy: {
      id: "alpha-policy",
      version: "1",
      expectedPlanHash: summary.planHash,
      expectedSemanticContractHash: summary.semanticContractHash,
      providerProfile: {
        id: "offline-provider",
        version: "1",
        provider: "openai",
      },
      oracleInputName: "request",
      oracleEffectName: "alpha.oracle",
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
    },
  };
}

async function oracleEffect() {
  const identity = unwrap(
    await createOracleEffectIdentity({
      id: "offline-owner-oracle",
      version: "1",
      implementation: "deterministic-example/1",
    }),
    "effect identity",
  );
  return {
    identity,
    invoke: (request, context) => {
      const owner = request.evidence.facts.find(
        (fact) => fact.subject === "Atlas" && fact.predicate === "owner",
      );
      const output =
        owner === undefined
          ? {
              outcome: "insufficient-evidence",
              answerValues: [],
              supportingFactIds: [],
            }
          : {
              outcome: "answered",
              answerValues: [owner.object],
              supportingFactIds: [owner.id],
            };
      return Promise.resolve({
        ok: true,
        value: {
          wireText: JSON.stringify(output),
          replayResultId: `offline/${context.requestDigest}`,
          usage: { inputTokens: 10, outputTokens: 5, wallClockMs: 1 },
        },
      });
    },
  };
}

async function execute(evidenceStore, options = {}) {
  const { executablePlan, policy } = await planAndPolicy();
  const recordings = options.recordings ?? createMemoryRecordingStore();
  const completed = await run({
    executablePlan,
    publicTaskContract: options.task ?? task,
    inputValues: new Map(),
    trustedPolicy: policy,
    evidenceStore,
    snapshot: {
      validAt: options.validAt ?? CURRENT_RECORDED_AT,
      recordedAt: options.recordedAt ?? null,
    },
    ...(options.expectedStorageSnapshotDigest === undefined
      ? {}
      : {
          expectedStorageSnapshotDigest: options.expectedStorageSnapshotDigest,
        }),
    oracle:
      options.oracle ?? createRecordingOracleInterpreter(await oracleEffect()),
    recordingStore: recordings,
    signal: options.signal ?? new AbortController().signal,
  });
  return { completed, executablePlan, policy, recordings };
}

export async function inMemoryMockExample() {
  const evidenceStore = unwrap(
    await createInMemoryEvidenceStore({
      id: "alpha-memory",
      version: "1",
      snapshots: [{ recordedAt: CURRENT_RECORDED_AT, graph }],
    }),
    "memory evidence",
  );
  const seed = await execute(evidenceStore);
  const seedResult = unwrap(seed.completed, "seed recording");
  const artifact = seed.recordings
    .artifacts()
    .find((item) => item.artifactDigest === seedResult.artifactDigest);
  if (artifact === undefined) throw new Error("Seed artifact is unavailable.");
  const mock = unwrap(
    await createMockOracleInterpreter({
      identity: artifact.oracle.identity,
      fixtures: [
        {
          request: artifact.oracle.request,
          result: { kind: "success", value: artifact.oracle.wireResult },
        },
      ],
    }),
    "mock interpreter",
  );
  return unwrap(
    (await execute(evidenceStore, { oracle: mock })).completed,
    "mock run",
  );
}

export async function recordReplayExample() {
  const evidenceStore = unwrap(
    await createInMemoryEvidenceStore({
      id: "alpha-record-memory",
      version: "1",
      snapshots: [{ recordedAt: CURRENT_RECORDED_AT, graph }],
    }),
    "memory evidence",
  );
  const recorded = await execute(evidenceStore);
  const completed = unwrap(recorded.completed, "record run");
  const replayed = unwrap(
    await replay({
      executablePlan: recorded.executablePlan,
      publicTaskContract: task,
      trustedPolicy: recorded.policy,
      artifactDigest: completed.artifactDigest,
      recordingStore: recorded.recordings,
      signal: new AbortController().signal,
    }),
    "replay",
  );
  return { completed: completed.result, replayed };
}

export async function privateFileRecordReplayExample() {
  const evidenceStore = unwrap(
    await createInMemoryEvidenceStore({
      id: "alpha-private-file-memory",
      version: "1",
      snapshots: [{ recordedAt: CURRENT_RECORDED_AT, graph }],
    }),
    "memory evidence",
  );
  const temporaryBase = await mkdtemp(
    join(await realpath(tmpdir()), "lachesis-alpha-recordings-"),
  );
  try {
    const privateRecordings = unwrap(
      await createPrivateFileRecordingStore({
        root: join(temporaryBase, "private"),
      }),
      "private recording store",
    );
    const recorded = await execute(evidenceStore, {
      recordings: privateRecordings.store,
    });
    const completed = unwrap(recorded.completed, "private record run");
    const replayed = unwrap(
      await replay({
        executablePlan: recorded.executablePlan,
        publicTaskContract: task,
        trustedPolicy: recorded.policy,
        artifactDigest: completed.artifactDigest,
        recordingStore: privateRecordings.store,
        signal: new AbortController().signal,
      }),
      "private replay",
    );
    const permissions = unwrap(
      await privateRecordings.audit(),
      "recording audit",
    );
    return { completed: completed.result, replayed, permissions };
  } finally {
    await rm(temporaryBase, { recursive: true, force: true });
  }
}

export async function hostTypeGraphExample() {
  const historyStore = await createLocalSqliteStore(TYPEGRAPH_EVIDENCE_SCHEMA, {
    store: { history: true },
  });
  const repository = unwrap(
    await createTypeGraphEvidenceRepository({
      graphInput: graph,
      store: historyStore,
      backendIdentity: { id: "host-history-store", version: "1" },
    }),
    "TypeGraph repository",
  );
  try {
    const evidenceStore = unwrap(
      await createM5TypeGraphEvidenceStore(repository),
      "TypeGraph evidence store",
    );
    return unwrap((await execute(evidenceStore)).completed, "TypeGraph run");
  } finally {
    await repository.close();
  }
}

export async function managedSqliteExample() {
  const temporaryBase = await mkdtemp(
    join(await realpath(tmpdir()), "lachesis-alpha-sqlite-"),
  );
  const managed = unwrap(
    await createM5TypeGraphSqliteEvidenceStore({
      graphInput: graph,
      path: join(temporaryBase, "private", "evidence.sqlite"),
    }),
    "managed SQLite",
  );
  try {
    const result = unwrap(
      (await execute(managed.store)).completed,
      "SQLite run",
    );
    const permissions = unwrap(
      await managed.permissionAudit(),
      "permission audit",
    );
    return { result, permissions };
  } finally {
    await managed.close();
    await rm(temporaryBase, { recursive: true, force: true });
  }
}

export async function historicalRetractionExample() {
  const temporaryBase = await mkdtemp(
    join(await realpath(tmpdir()), "lachesis-alpha-history-"),
  );
  const managed = unwrap(
    await createM5TypeGraphSqliteEvidenceStore({
      graphInput: graph,
      path: join(temporaryBase, "private", "evidence.sqlite"),
    }),
    "managed history",
  );
  try {
    const recordings = createMemoryRecordingStore();
    const historical = await execute(managed.store, {
      recordings,
      validAt: HISTORICAL_RECORDED_AT,
      recordedAt: managed.repository.initialRecordedAt,
    });
    const historicalResult = unwrap(historical.completed, "historical run");
    unwrap(
      await managed.repository.retractFact("fact-owner-old"),
      "retraction",
    );
    const currentResult = unwrap(
      (await execute(managed.store)).completed,
      "current run",
    );
    const replayed = unwrap(
      await replay({
        executablePlan: historical.executablePlan,
        publicTaskContract: task,
        trustedPolicy: historical.policy,
        artifactDigest: historicalResult.artifactDigest,
        recordingStore: recordings,
        signal: new AbortController().signal,
      }),
      "historical replay",
    );
    const mismatch = await execute(managed.store, {
      validAt: HISTORICAL_RECORDED_AT,
      recordedAt: managed.repository.initialRecordedAt,
      expectedStorageSnapshotDigest:
        currentResult.result.evidenceSnapshot.storageSnapshotDigest,
    });
    return {
      historical: historicalResult.result.answer,
      current: currentResult.result.answer,
      replayed: replayed.answer,
      snapshotMismatchFailedClosed:
        !mismatch.completed.ok &&
        mismatch.completed.error.code === "EVIDENCE_SNAPSHOT_MISMATCH",
    };
  } finally {
    await managed.close();
    await rm(temporaryBase, { recursive: true, force: true });
  }
}

export async function typedFailureExample() {
  const evidenceStore = unwrap(
    await createInMemoryEvidenceStore({
      id: "alpha-failure-memory",
      version: "1",
      snapshots: [{ recordedAt: CURRENT_RECORDED_AT, graph }],
    }),
    "memory evidence",
  );
  const controller = new AbortController();
  controller.abort();
  const failed = (await execute(evidenceStore, { signal: controller.signal }))
    .completed;
  if (failed.ok) throw new Error("Expected typed cancellation.");
  switch (failed.error.code) {
    case "CANCELLED":
      return failed.error;
    default:
      throw new Error(`Unexpected failure ${failed.error.code}.`);
  }
}

export async function loadTestFixture() {
  const evidenceStore = unwrap(
    await createInMemoryEvidenceStore({
      id: "alpha-load-memory",
      version: "1",
      snapshots: [{ recordedAt: CURRENT_RECORDED_AT, graph }],
    }),
    "load evidence",
  );
  const prepared = await planAndPolicy();
  return {
    ...prepared,
    evidenceStore,
    oracle: createRecordingOracleInterpreter(await oracleEffect()),
    task,
  };
}
