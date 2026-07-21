import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  compilePlan,
  createCatalog,
  createInMemoryEvidenceStore,
  createMemoryRecordingStore,
  createOracleEffectIdentity,
  createRecordingOracleInterpreter,
  defineEffect,
  defineSchema,
  type EvidenceGraph,
  inspectExecutablePlan,
  oracleAnswerSchema,
  type OracleEffect,
  oracleRequestSchema,
  type PublicTaskContract,
  replay,
  type ReplayArtifact,
  type Result,
  run,
  type TrustedPolicy,
} from "@nicia-ai/lachesis-runtime";
import {
  auditPrivateSqliteFile,
  createPrivateFileRecordingStore,
  preparePrivateSqliteFile,
  PRIVATE_RECORDING_STORE_POLICY,
} from "@nicia-ai/lachesis-runtime/node";
import { afterEach, describe, expect, it } from "vitest";

const roots: Array<string> = [];

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error("Expected successful runtime fixture.");
  return result.value;
}

async function temporaryRoot(name: string): Promise<string> {
  const systemTemporaryRoot = await realpath(tmpdir());
  const parent = await mkdtemp(join(systemTemporaryRoot, `lachesis-${name}-`));
  roots.push(parent);
  return join(parent, "private");
}

const GRAPH: EvidenceGraph = {
  id: "runtime-alpha-evidence",
  version: "1",
  citations: [
    {
      id: "citation-owner",
      source: "offline-fixture",
      locator: "fixture/owner",
      observedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  facts: [
    {
      id: "fact-owner",
      statement: "Atlas owner is Noor.",
      subject: "Atlas",
      predicate: "owner",
      object: "Noor",
      citationIds: ["citation-owner"],
      validFrom: null,
      validUntil: null,
      recordedFrom: "2026-01-01T00:00:00.000Z",
      recordedUntil: null,
    },
  ],
  edges: [],
};

const TASK: PublicTaskContract = {
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

async function fixture(): Promise<
  Readonly<{
    artifact: ReplayArtifact;
    executablePlan: Parameters<typeof run>[0]["executablePlan"];
    policy: TrustedPolicy;
  }>
> {
  const request = defineSchema({
    id: "runtime/oracle-request",
    version: "1",
    description: "Reduced oracle request.",
    validator: oracleRequestSchema,
  });
  const output = defineSchema({
    id: "runtime/oracle-output",
    version: "1",
    description: "Reduced oracle output.",
    validator: oracleAnswerSchema,
  });
  const effect = defineEffect({
    id: "runtime/oracle",
    version: "1",
    description: "Injected offline oracle.",
    input: request,
    output,
    effectName: "runtime.oracle",
    capability: "evidence.oracle",
    maxTokens: 1_000,
    maxWallClockMs: 10_000,
    replayable: true,
  });
  const catalog = unwrap(
    createCatalog({
      identity: { id: "runtime/alpha-catalog", version: "1" },
      schemas: [request.runtime, output.runtime],
      operations: [effect],
    }),
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
        catalog: { id: "runtime/alpha-catalog", version: "1" },
        root: "answer",
        nodes: [
          {
            id: "request",
            op: "input",
            inputKey: "request",
            schema: { id: "runtime/oracle-request", version: "1" },
          },
          {
            id: "answer",
            op: "effect",
            source: "request",
            effect: { id: "runtime/oracle", version: "1" },
          },
        ],
        budget,
        allowedCapabilities: ["evidence.oracle"],
      }),
      catalog,
      { allowedCapabilities: ["evidence.oracle"], budget },
      [{ kind: "requiresEffect", effectName: "runtime.oracle" }],
    ),
  );
  const summary = inspectExecutablePlan(executablePlan);
  if (summary === undefined) throw new Error("Expected inspectable plan.");
  const policy: TrustedPolicy = {
    id: "runtime-alpha-policy",
    version: "1",
    expectedPlanHash: summary.planHash,
    expectedSemanticContractHash: summary.semanticContractHash,
    providerProfile: {
      id: "offline-provider",
      version: "1",
      provider: "openai",
    },
    oracleInputName: "request",
    oracleEffectName: "runtime.oracle",
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
  const evidenceStore = unwrap(
    await createInMemoryEvidenceStore({
      id: "runtime-alpha-memory",
      version: "1",
      snapshots: [{ recordedAt: "2026-01-01T00:00:00.000Z", graph: GRAPH }],
    }),
  );
  const identity = unwrap(
    await createOracleEffectIdentity({
      id: "runtime-alpha-oracle",
      version: "1",
      implementation: "offline-fixture/1",
    }),
  );
  const oracleEffect: OracleEffect = {
    identity,
    invoke: (requestInput, context) => {
      const fact = requestInput.evidence.facts.find(
        (candidate) => candidate.id === "fact-owner",
      );
      return Promise.resolve({
        ok: true,
        value: {
          wireText: JSON.stringify({
            outcome: "answered",
            answerValues: fact === undefined ? [] : [fact.object],
            supportingFactIds: fact === undefined ? [] : [fact.id],
          }),
          replayResultId: `offline/${context.requestDigest}`,
          usage: { inputTokens: 10, outputTokens: 5, wallClockMs: 1 },
        },
      });
    },
  };
  const memory = createMemoryRecordingStore();
  const completed = unwrap(
    await run({
      executablePlan,
      publicTaskContract: TASK,
      inputValues: new Map(),
      trustedPolicy: policy,
      evidenceStore,
      snapshot: {
        validAt: null,
        recordedAt: "2026-01-01T00:00:00.000Z",
      },
      oracle: createRecordingOracleInterpreter(oracleEffect),
      recordingStore: memory,
      signal: new AbortController().signal,
    }),
  );
  const artifact = memory
    .artifacts()
    .find((candidate) => candidate.artifactDigest === completed.artifactDigest);
  if (artifact === undefined) throw new Error("Expected replay artifact.");
  return { artifact, executablePlan, policy };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("M5c public alpha runtime", () => {
  it("persists concurrently, audits private artifacts, and replays exactly", async () => {
    const prepared = await fixture();
    const root = await temporaryRoot("recording");
    const privateStore = unwrap(
      await createPrivateFileRecordingStore({ root }),
    );
    const signal = new AbortController().signal;
    expect(
      await Promise.all(
        Array.from({ length: 32 }, () =>
          privateStore.store.save(prepared.artifact, signal),
        ),
      ),
    ).toEqual(
      Array.from({ length: 32 }, () => ({ ok: true, value: undefined })),
    );
    const audit = unwrap(await privateStore.audit());
    expect(audit.directoryMode).toBe(0o700);
    expect(audit.artifacts).toHaveLength(1);
    expect(audit.artifacts[0]).toMatchObject({
      kind: "artifact",
      mode: 0o600,
    });
    const replayed = unwrap(
      await replay({
        executablePlan: prepared.executablePlan,
        publicTaskContract: TASK,
        trustedPolicy: prepared.policy,
        artifactDigest: prepared.artifact.artifactDigest,
        recordingStore: privateStore.store,
        signal,
      }),
    );
    expect(replayed.answer).toEqual({
      outcome: "answered",
      values: ["Noor"],
    });
  });

  it("recovers stale temporary files without lock state", async () => {
    const root = await temporaryRoot("recovery");
    await mkdir(root, { mode: 0o700 });
    const temporary = join(
      root,
      `${"a".repeat(64)}.tmp-00000000-0000-4000-8000-000000000000`,
    );
    const handle = await open(temporary, "wx", 0o600);
    await handle.close();
    await utimes(temporary, new Date(0), new Date(0));
    const store = unwrap(
      await createPrivateFileRecordingStore({
        root,
        staleTemporaryFileMs: 1,
        now: () => 10_000,
      }),
    );
    expect(unwrap(await store.audit()).artifacts).toEqual([]);
    expect(PRIVATE_RECORDING_STORE_POLICY.locks).toBe(
      "lock-free-content-addressed-commit",
    );
  });

  it("fails closed on traversal, symlinks, permission drift, size, and cancellation", async () => {
    const prepared = await fixture();
    const root = await temporaryRoot("hostile");
    const privateStore = unwrap(
      await createPrivateFileRecordingStore({ root }),
    );
    const signal = new AbortController().signal;
    unwrap(await privateStore.store.save(prepared.artifact, signal));
    expect(await privateStore.store.load("../artifact", signal)).toMatchObject({
      ok: false,
      error: { code: "RECORDING_FAILED" },
    });
    const artifactPath = join(
      privateStore.root,
      `${prepared.artifact.artifactDigest}.json`,
    );
    await chmod(artifactPath, 0o644);
    expect(await privateStore.audit()).toMatchObject({
      ok: false,
      error: { code: "RECORDING_FAILED" },
    });
    expect(
      await privateStore.store.load(prepared.artifact.artifactDigest, signal),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });

    const smallRoot = await temporaryRoot("bounded");
    const small = unwrap(
      await createPrivateFileRecordingStore({
        root: smallRoot,
        maximumArtifactBytes: 64,
      }),
    );
    expect(await small.store.save(prepared.artifact, signal)).toMatchObject({
      ok: false,
      error: { code: "RECORDING_FAILED" },
    });
    const aborted = new AbortController();
    aborted.abort();
    expect(
      await small.store.load(prepared.artifact.artifactDigest, aborted.signal),
    ).toMatchObject({ ok: false, error: { code: "CANCELLED" } });

    const linkedParent = await temporaryRoot("symlink");
    const target = `${linkedParent}-target`;
    await mkdir(target, { mode: 0o700 });
    await symlink(target, linkedParent);
    expect(
      await createPrivateFileRecordingStore({ root: linkedParent }),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });
  });

  it("rejects invalid roots, limits, unknown files, and corrupt recordings", async () => {
    expect(
      await createPrivateFileRecordingStore({ root: "relative/private" }),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });
    const nonnormalizedRoot = `${await realpath(tmpdir())}/lachesis-normalized/../private`;
    expect(
      await createPrivateFileRecordingStore({ root: nonnormalizedRoot }),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });
    const invalidLimitRoot = await temporaryRoot("invalid-limits");
    expect(
      await createPrivateFileRecordingStore({
        root: invalidLimitRoot,
        maximumArtifactBytes: 0,
      }),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });
    expect(
      await createPrivateFileRecordingStore({
        root: invalidLimitRoot,
        staleTemporaryFileMs: -1,
      }),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });
    expect(
      await createPrivateFileRecordingStore({
        root: invalidLimitRoot,
        maximumArtifactBytes: Number.NaN,
      }),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });
    expect(
      await createPrivateFileRecordingStore({
        root: invalidLimitRoot,
        staleTemporaryFileMs: Number.NaN,
      }),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });

    const permissiveRoot = await temporaryRoot("permissive-root");
    await mkdir(permissiveRoot, { mode: 0o755 });
    expect(
      await createPrivateFileRecordingStore({ root: permissiveRoot }),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });

    const fileRoot = await temporaryRoot("file-root");
    const fileRootHandle = await open(fileRoot, "wx", 0o600);
    await fileRootHandle.close();
    expect(
      await createPrivateFileRecordingStore({ root: fileRoot }),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });

    const root = await temporaryRoot("corrupt");
    const privateStore = unwrap(
      await createPrivateFileRecordingStore({ root }),
    );
    const signal = new AbortController().signal;
    expect(await privateStore.store.load("b".repeat(64), signal)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await privateStore.store.load("not-a-digest", signal)).toMatchObject(
      { ok: false, error: { code: "RECORDING_FAILED" } },
    );
    const aborted = new AbortController();
    aborted.abort();
    const prepared = await fixture();
    expect(
      await privateStore.store.save(prepared.artifact, aborted.signal),
    ).toMatchObject({ ok: false, error: { code: "CANCELLED" } });

    const artifactPath = join(root, `${"c".repeat(64)}.json`);
    await writeFile(artifactPath, "not-json", { mode: 0o600 });
    expect(await privateStore.store.load("c".repeat(64), signal)).toMatchObject(
      {
        ok: false,
        error: { code: "RECORDING_FAILED" },
      },
    );
    await writeFile(artifactPath, "{}", { mode: 0o600 });
    expect(await privateStore.store.load("c".repeat(64), signal)).toMatchObject(
      {
        ok: false,
        error: { code: "RECORDING_FAILED" },
      },
    );

    const unknownPath = join(root, "unexpected.txt");
    await writeFile(unknownPath, "unexpected", { mode: 0o600 });
    expect(await privateStore.audit()).toMatchObject({
      ok: false,
      error: { code: "RECORDING_FAILED" },
    });

    const initialAuditRoot = await temporaryRoot("initial-audit");
    await mkdir(initialAuditRoot, { mode: 0o700 });
    await writeFile(join(initialAuditRoot, "unknown"), "unknown", {
      mode: 0o600,
    });
    expect(
      await createPrivateFileRecordingStore({ root: initialAuditRoot }),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });

    const badTemporaryRoot = await temporaryRoot("bad-temporary");
    await mkdir(badTemporaryRoot, { mode: 0o700 });
    await writeFile(
      join(
        badTemporaryRoot,
        `${"f".repeat(64)}.tmp-00000000-0000-4000-8000-000000000000`,
      ),
      "{}",
      { mode: 0o644 },
    );
    expect(
      await createPrivateFileRecordingStore({ root: badTemporaryRoot }),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });
  });

  it("prepares and audits private SQLite databases and every sidecar", async () => {
    expect(await preparePrivateSqliteFile("relative.sqlite")).toMatchObject({
      ok: false,
      error: { code: "RECORDING_FAILED" },
    });
    expect(await auditPrivateSqliteFile("relative.sqlite")).toMatchObject({
      ok: false,
      error: { code: "RECORDING_FAILED" },
    });

    const directory = await temporaryRoot("sqlite");
    const databasePath = join(directory, "evidence.sqlite");
    const prepared = unwrap(await preparePrivateSqliteFile(databasePath));
    expect(prepared.artifacts).toHaveLength(1);
    for (const suffix of ["-journal", "-wal", "-shm"] as const) {
      const handle = await open(`${databasePath}${suffix}`, "wx", 0o600);
      await handle.close();
    }
    const audited = unwrap(await auditPrivateSqliteFile(databasePath));
    expect(audited.artifacts).toHaveLength(4);
    expect(audited.directoryPath).toBe(directory);

    await chmod(`${databasePath}-wal`, 0o644);
    expect(await auditPrivateSqliteFile(databasePath)).toMatchObject({
      ok: false,
      error: { code: "RECORDING_FAILED" },
    });

    const linkedDatabase = join(directory, "linked.sqlite");
    await symlink(databasePath, linkedDatabase);
    expect(await preparePrivateSqliteFile(linkedDatabase)).toMatchObject({
      ok: false,
      error: { code: "RECORDING_FAILED" },
    });
  });

  it("fails closed on malformed, conflicting, and drifted recording artifacts", async () => {
    const prepared = await fixture();
    const root = await temporaryRoot("recording-adversarial");
    const privateStore = unwrap(
      await createPrivateFileRecordingStore({ root }),
    );
    const signal = new AbortController().signal;
    const invalidArtifact = structuredClone(prepared.artifact);
    Reflect.set(invalidArtifact, "artifactDigest", "invalid");
    expect(
      await privateStore.store.save(invalidArtifact, signal),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });

    const conflicting = structuredClone(prepared.artifact);
    Reflect.set(conflicting, "artifactDigest", "d".repeat(64));
    await writeFile(
      join(root, `${prepared.artifact.artifactDigest}.json`),
      JSON.stringify(conflicting),
      { mode: 0o600 },
    );
    expect(
      await privateStore.store.save(prepared.artifact, signal),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });

    const malformedNameRoot = await temporaryRoot("recording-name");
    const malformedNameStore = unwrap(
      await createPrivateFileRecordingStore({ root: malformedNameRoot }),
    );
    await writeFile(join(malformedNameRoot, "not-a-digest.json"), "{}", {
      mode: 0o600,
    });
    expect(await malformedNameStore.audit()).toMatchObject({
      ok: false,
      error: { code: "RECORDING_FAILED" },
    });

    const recentRoot = await temporaryRoot("recording-recent");
    await mkdir(recentRoot, { mode: 0o700 });
    const recentTemporary = join(
      recentRoot,
      `${"e".repeat(64)}.tmp-00000000-0000-4000-8000-000000000000`,
    );
    await writeFile(recentTemporary, "{}", { mode: 0o600 });
    const recentStore = unwrap(
      await createPrivateFileRecordingStore({
        root: recentRoot,
        staleTemporaryFileMs: 10_000,
        now: () => Date.now(),
      }),
    );
    expect(unwrap(await recentStore.audit()).artifacts).toMatchObject([
      { kind: "temporary" },
    ]);

    await chmod(recentRoot, 0o755);
    expect(await recentStore.audit()).toMatchObject({
      ok: false,
      error: { code: "RECORDING_FAILED" },
    });
    expect(
      await recentStore.store.load(prepared.artifact.artifactDigest, signal),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });
    expect(
      await recentStore.store.save(prepared.artifact, signal),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });

    const symlinkRoot = await temporaryRoot("recording-artifact-link");
    const symlinkStore = unwrap(
      await createPrivateFileRecordingStore({ root: symlinkRoot }),
    );
    const symlinkTarget = join(dirname(symlinkRoot), "artifact-target");
    await writeFile(symlinkTarget, "{}", { mode: 0o600 });
    await symlink(symlinkTarget, join(symlinkRoot, `${"1".repeat(64)}.json`));
    expect(await symlinkStore.store.load("1".repeat(64), signal)).toMatchObject(
      { ok: false, error: { code: "RECORDING_FAILED" } },
    );

    const boundedRoot = await temporaryRoot("recording-existing-size");
    const boundedStore = unwrap(
      await createPrivateFileRecordingStore({
        root: boundedRoot,
        maximumArtifactBytes: 64,
      }),
    );
    await writeFile(
      join(boundedRoot, `${"2".repeat(64)}.json`),
      "x".repeat(65),
      {
        mode: 0o600,
      },
    );
    expect(await boundedStore.store.load("2".repeat(64), signal)).toMatchObject(
      { ok: false, error: { code: "RECORDING_FAILED" } },
    );
  });

  it("rejects SQLite database and sidecar type or mode drift", async () => {
    const missingDirectory = await temporaryRoot("sqlite-missing");
    await mkdir(missingDirectory, { mode: 0o700 });
    expect(
      await auditPrivateSqliteFile(join(missingDirectory, "missing.sqlite")),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });

    const permissiveDirectory = await temporaryRoot("sqlite-permissive");
    await mkdir(permissiveDirectory, { mode: 0o755 });
    expect(
      await auditPrivateSqliteFile(
        join(permissiveDirectory, "evidence.sqlite"),
      ),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });
    expect(
      await preparePrivateSqliteFile(
        join(permissiveDirectory, "evidence.sqlite"),
      ),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });

    const directory = await temporaryRoot("sqlite-drift");
    const databasePath = join(directory, "evidence.sqlite");
    unwrap(await preparePrivateSqliteFile(databasePath));
    await chmod(databasePath, 0o644);
    expect(await auditPrivateSqliteFile(databasePath)).toMatchObject({
      ok: false,
      error: { code: "RECORDING_FAILED" },
    });
    await chmod(databasePath, 0o600);
    await mkdir(`${databasePath}-shm`, { mode: 0o700 });
    expect(await auditPrivateSqliteFile(databasePath)).toMatchObject({
      ok: false,
      error: { code: "RECORDING_FAILED" },
    });

    const parentFile = await temporaryRoot("sqlite-parent-file");
    const parentHandle = await open(parentFile, "wx", 0o600);
    await parentHandle.close();
    expect(
      await preparePrivateSqliteFile(join(parentFile, "evidence.sqlite")),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });

    const normalizedDirectory = await temporaryRoot("sqlite-normalized");
    expect(
      await preparePrivateSqliteFile(
        `${normalizedDirectory}/child/../evidence.sqlite`,
      ),
    ).toMatchObject({ ok: false, error: { code: "RECORDING_FAILED" } });
  });
});
