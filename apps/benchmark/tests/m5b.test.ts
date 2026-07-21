import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  M3bAttemptProvenance,
  M4d1Oracle,
  M4d1OracleAttempt,
  M4d1OracleRequest,
  M4OracleAnswer,
} from "@nicia-ai/lachesis-evidence";
import { M5B0_ORACLE_IDENTITIES } from "@nicia-ai/lachesis-generator-ai-sdk";
import { afterEach, describe, expect, it } from "vitest";

import { acquireCampaignLock } from "../src/ledger.js";
import { createM3bRawOutputArtifactStore } from "../src/m3b1-raw-output-store.js";
import {
  executeM5b,
  generateStoredM5bReport,
  type M5bLiveAcknowledgement,
  preflightM5b,
} from "../src/m5b-controller.js";
import { type M5bCorpus, materializeM5bCorpus } from "../src/m5b-corpus.js";
import { inspectM5bLedger } from "../src/m5b-ledger.js";
import {
  M5B0_FAILED_PROBE_DISPOSITION,
  m5bExecutionDisposition,
  type M5bMaterializedPhase,
  materializeM5bPhase,
  validateM5bMaterialization,
} from "../src/m5b-manifests.js";

const SOURCE_COMMIT = "1f1bc5f2de01cfb1a1121eca072756c6f1aa4983";
const REPOSITORY_ROOT = join(import.meta.dirname, "..", "..", "..");
const temporaryRoots: Array<string> = [];

function unwrap<T>(
  result:
    Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }>,
): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lachesis-m5b-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function corpus(): Promise<M5bCorpus> {
  return unwrap(
    await materializeM5bCorpus({ repositoryRoot: REPOSITORY_ROOT }),
  );
}

async function probe(): Promise<M5bMaterializedPhase> {
  return unwrap(
    await materializeM5bPhase({
      phase: "m5b-protocol-probe",
      sourceCommit: SOURCE_COMMIT,
      corpus: await corpus(),
    }),
  );
}

function acknowledgement(
  materialized: M5bMaterializedPhase,
): M5bLiveAcknowledgement {
  return {
    campaignDigest: materialized.campaign.campaignDigest,
    experimentDigest: materialized.phase.experimentDigest,
    phaseManifestDigest: materialized.phase.phaseManifestDigest,
    phase: materialized.phase.phase,
    maximumCampaignUsdMicros: 5_000_000,
  };
}

function provenance(category = "accepted"): M3bAttemptProvenance {
  return {
    stage: "wire-decoding",
    category,
    providerStatusCode: 200,
    providerErrorCode: null,
    providerResponseId: "offline-redacted-by-digest",
    finishReason: "stop",
    rawFinishReason: "stop",
    usageAvailable: true,
    outputPresent: true,
    outputDigest: "a".repeat(64),
    outputSizeBytes: 64,
    outputTruncated: false,
    issues: [],
    errorClass: null,
    causeClass: null,
    sanitizedMessage: null,
    rawOutputArtifact: null,
    jsonParseResult: "passed",
    wireSchemaResult: "passed",
  };
}

function successfulAttempt(output: M4OracleAnswer): M4d1OracleAttempt {
  return {
    kind: "success",
    output,
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      latencyMs: 5,
      costUsdMicros: 10,
    },
    provenance: provenance(),
  };
}

function fakeOracle(
  input: Readonly<{
    provider: "openai" | "anthropic";
    expectedByInstruction: ReadonlyMap<
      string,
      Readonly<{
        outcome: "answered" | "insufficient-evidence";
        answerValues: ReadonlyArray<string>;
        supportingFactIds: ReadonlyArray<string>;
      }>
    >;
    calls: Array<Readonly<{ request: M4d1OracleRequest; invocation: string }>>;
  }>,
): M4d1Oracle {
  const identity = M5B0_ORACLE_IDENTITIES.find(
    (candidate) => candidate.provider === input.provider,
  );
  if (identity === undefined) throw new Error("Missing M5b oracle identity.");
  return {
    identity,
    generate(request, context) {
      input.calls.push({ request, invocation: context.invocation });
      const expected = input.expectedByInstruction.get(request.instruction);
      if (expected === undefined)
        throw new Error("Offline oracle received an unknown instruction.");
      return Promise.resolve(successfulAttempt(expected));
    },
  };
}

describe("M5b.0 offline production-pilot infrastructure", () => {
  it("preserves the failed probe identity as report-only before credentials or state", async () => {
    const materialized = unwrap(
      await materializeM5bPhase({
        phase: "m5b-protocol-probe",
        sourceCommit: M5B0_FAILED_PROBE_DISPOSITION.sourceCommit,
        corpus: await corpus(),
      }),
    );
    expect(materialized.phase).toMatchObject({
      experimentDigest: M5B0_FAILED_PROBE_DISPOSITION.experimentDigest,
      phaseManifestDigest: M5B0_FAILED_PROBE_DISPOSITION.phaseManifestDigest,
    });
    expect(m5bExecutionDisposition(materialized.phase)).toBe(
      "complete-integrity-fail-report-only",
    );
    const root = await temporaryRoot();
    let credentialReads = 0;
    const calls: Array<
      Readonly<{ request: M4d1OracleRequest; invocation: string }>
    > = [];
    const expectedByInstruction = new Map(
      materialized.corpus.tasks.map((task) => [
        task.task.instruction,
        task.expected,
      ]),
    );
    const result = await executeM5b({
      materialized,
      storageRoot: root,
      currentCommit: M5B0_FAILED_PROBE_DISPOSITION.sourceCommit,
      cleanWorktree: true,
      acknowledgement: acknowledgement(materialized),
      credentials: {
        get openaiApiKey(): string {
          credentialReads += 1;
          return "offline-openai-secret";
        },
        get anthropicApiKey(): string {
          credentialReads += 1;
          return "offline-anthropic-secret";
        },
      },
      oracles: {
        openai: fakeOracle({
          provider: "openai",
          expectedByInstruction,
          calls,
        }),
        anthropic: fakeOracle({
          provider: "anthropic",
          expectedByInstruction,
          calls,
        }),
      },
    });
    expect(result).toMatchObject({ ok: false });
    expect(credentialReads).toBe(0);
    expect(calls).toHaveLength(0);
    await expect(
      stat(join(root, materialized.campaign.campaignDigest)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("materializes an auditable natural repository corpus and exact derived limits", async () => {
    const frozen = await corpus();
    expect(frozen).toMatchObject({
      sourceSnapshotCommit: SOURCE_COMMIT,
      audit: {
        taskCount: 12,
        answeredTaskCount: 11,
        insufficientEvidenceTaskCount: 1,
        everyAnswerReconstructedOffline: true,
        liveGitHubRequired: false,
        benchmarkGeneralizationClaimed: false,
      },
    });
    expect(frozen.commits.length).toBeGreaterThan(30);
    expect(frozen.documents).toHaveLength(13);
    expect(frozen.graph.facts.length).toBeGreaterThan(40);
    expect(new Set(frozen.tasks.map((task) => task.task.id)).size).toBe(12);

    const materialized = await probe();
    expect(await validateM5bMaterialization(materialized)).toMatchObject({
      ok: true,
    });
    expect(materialized.phase).toMatchObject({
      initialRecords: 4,
      maximumAttempts: 12,
      theoreticalCeiling: {
        maximumInputTokens: 96_000,
        maximumOutputTokens: 24_000,
        maximumTotalTokens: 120_000,
        maximumCostUsdMicros: 570_000,
        providers: [
          { billingProvider: "anthropic", maximumCostUsdMicros: 240_000 },
          { billingProvider: "openai", maximumCostUsdMicros: 330_000 },
        ],
      },
      failurePolicy: {
        sdkRetries: 0,
        controllerTransportRetriesPerLogicalAttempt: 1,
        wireRepairsPerRecord: 1,
        semanticRepairsPerRecord: 1,
      },
    });
    const pilot = unwrap(
      await materializeM5bPhase({
        phase: "m5b-pilot",
        sourceCommit: SOURCE_COMMIT,
        corpus: frozen,
      }),
    );
    expect(pilot.phase).toMatchObject({
      initialRecords: 24,
      maximumAttempts: 72,
      theoreticalCeiling: {
        maximumCostUsdMicros: 3_420_000,
        providers: [
          { billingProvider: "anthropic", maximumCostUsdMicros: 1_440_000 },
          { billingProvider: "openai", maximumCostUsdMicros: 1_980_000 },
        ],
      },
    });
  });

  it("keeps credential-free dry-run non-executable and creates no ledger", async () => {
    const materialized = await probe();
    const root = await temporaryRoot();
    const ledgerPath = join(root, "state", "ledger.ndjson");
    const dryRun = unwrap(
      await preflightM5b({
        materialized,
        currentCommit: SOURCE_COMMIT,
        cleanWorktree: true,
        credentials: { OPENAI_API_KEY: false, ANTHROPIC_API_KEY: false },
        ledgerPath,
      }),
    );
    expect(dryRun).toMatchObject({
      valid: true,
      liveExecutionPermitted: false,
      missingCredentialNames: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
      checks: {
        materialization: true,
        sourceCommit: true,
        cleanWorktree: true,
        credentials: false,
        acknowledgement: false,
        completePhaseCapacity: true,
        corpusBound: true,
      },
    });
    await expect(readFile(ledgerPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("executes the four-record probe with fake effects and resumes with zero redispatch", async () => {
    const materialized = await probe();
    const root = await temporaryRoot();
    const expectedByInstruction = new Map(
      materialized.corpus.tasks.map((task) => [
        task.task.instruction,
        task.expected,
      ]),
    );
    const calls: Array<
      Readonly<{ request: M4d1OracleRequest; invocation: string }>
    > = [];
    const oracles = {
      openai: fakeOracle({ provider: "openai", expectedByInstruction, calls }),
      anthropic: fakeOracle({
        provider: "anthropic",
        expectedByInstruction,
        calls,
      }),
    };
    const first = unwrap(
      await executeM5b({
        materialized,
        storageRoot: root,
        currentCommit: SOURCE_COMMIT,
        cleanWorktree: true,
        acknowledgement: acknowledgement(materialized),
        credentials: {
          openaiApiKey: "offline-openai-secret",
          anthropicApiKey: "offline-anthropic-secret",
        },
        oracles,
      }),
    );
    expect(first).toMatchObject({
      records: 4,
      resumed: 0,
      providerAttempts: 4,
      firstAttemptEndToEndSuccesses: 4,
      finalReliableRecords: 4,
      replayVerifiedRecords: 4,
      acceptance: { passed: true },
    });
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      const serialized = JSON.stringify(call.request);
      expect(serialized).not.toMatch(
        /expected|typegraph|graph-typed|graph-adjacency|policyIdentity/iu,
      );
    }
    const resumed = unwrap(
      await executeM5b({
        materialized,
        storageRoot: root,
        currentCommit: SOURCE_COMMIT,
        cleanWorktree: true,
        acknowledgement: acknowledgement(materialized),
        credentials: {
          openaiApiKey: "offline-openai-secret",
          anthropicApiKey: "offline-anthropic-secret",
        },
        oracles,
      }),
    );
    expect(resumed).toMatchObject({ records: 4, resumed: 4 });
    expect(calls).toHaveLength(4);
    expect(
      unwrap(
        await generateStoredM5bReport({ materialized, storageRoot: root }),
      ),
    ).toMatchObject({ records: 4, replayVerifiedRecords: 4 });
    const ledger = unwrap(
      await inspectM5bLedger({
        path: join(root, materialized.campaign.campaignDigest, "ledger.ndjson"),
        campaign: materialized.campaign,
      }),
    );
    expect(ledger).toMatchObject({ consumedUsdMicros: 40 });
    const experimentRoot = join(root, materialized.phase.storageNamespace);
    expect((await stat(experimentRoot)).mode & 0o777).toBe(0o700);
    const recordPath = join(
      experimentRoot,
      "records",
      `${materialized.phase.schedule.records[0]?.recordKey}.json`,
    );
    expect((await stat(recordPath)).mode & 0o777).toBe(0o600);
    const durable = await readFile(recordPath, "utf8");
    expect(durable).not.toMatch(/offline-(openai|anthropic)-secret/u);
    expect(durable).not.toContain("offline-redacted-by-digest");
  });

  it("blocks acknowledgement mismatch before state, dispatch, or reservation", async () => {
    const materialized = await probe();
    const root = await temporaryRoot();
    const calls: Array<
      Readonly<{ request: M4d1OracleRequest; invocation: string }>
    > = [];
    const expectedByInstruction = new Map(
      materialized.corpus.tasks.map((task) => [
        task.task.instruction,
        task.expected,
      ]),
    );
    const result = await executeM5b({
      materialized,
      storageRoot: root,
      currentCommit: SOURCE_COMMIT,
      cleanWorktree: true,
      acknowledgement: {
        ...acknowledgement(materialized),
        experimentDigest: "0".repeat(64),
      },
      credentials: {
        openaiApiKey: "offline-openai-secret",
        anthropicApiKey: "offline-anthropic-secret",
      },
      oracles: {
        openai: fakeOracle({
          provider: "openai",
          expectedByInstruction,
          calls,
        }),
        anthropic: fakeOracle({
          provider: "anthropic",
          expectedByInstruction,
          calls,
        }),
      },
    });
    expect(result).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
    expect(await stat(root)).toBeDefined();
    expect(
      unwrap(
        await inspectM5bLedger({
          path: join(
            root,
            materialized.campaign.campaignDigest,
            "ledger.ndjson",
          ),
          campaign: materialized.campaign,
        }),
      ).eventCount,
    ).toBe(0);
  });

  it("audits the private database before reservation or provider dispatch", async () => {
    const materialized = await probe();
    const root = await temporaryRoot();
    const privateRoot = join(
      root,
      materialized.phase.storageNamespace,
      "private-artifacts",
    );
    await mkdir(privateRoot, { recursive: true, mode: 0o700 });
    const database = await open(
      join(privateRoot, "evidence.sqlite"),
      "wx",
      0o600,
    );
    await database.close();
    await chmod(join(privateRoot, "evidence.sqlite"), 0o644);
    const calls: Array<
      Readonly<{ request: M4d1OracleRequest; invocation: string }>
    > = [];
    const expectedByInstruction = new Map(
      materialized.corpus.tasks.map((task) => [
        task.task.instruction,
        task.expected,
      ]),
    );
    const result = await executeM5b({
      materialized,
      storageRoot: root,
      currentCommit: SOURCE_COMMIT,
      cleanWorktree: true,
      acknowledgement: acknowledgement(materialized),
      credentials: {
        openaiApiKey: "offline-openai-secret",
        anthropicApiKey: "offline-anthropic-secret",
      },
      oracles: {
        openai: fakeOracle({
          provider: "openai",
          expectedByInstruction,
          calls,
        }),
        anthropic: fakeOracle({
          provider: "anthropic",
          expectedByInstruction,
          calls,
        }),
      },
    });
    expect(result).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
    const ledger = unwrap(
      await inspectM5bLedger({
        path: join(root, materialized.campaign.campaignDigest, "ledger.ndjson"),
        campaign: materialized.campaign,
      }),
    );
    expect(ledger.eventCount).toBe(0);
  });

  it("preserves stale locks and bounds private raw-output artifacts", async () => {
    const root = await temporaryRoot();
    const ledgerPath = join(root, "state", "ledger.ndjson");
    const first = unwrap(await acquireCampaignLock(ledgerPath));
    expect((await stat(first.path)).mode & 0o777).toBe(0o700);
    expect((await stat(join(first.path, "owner.json"))).mode & 0o777).toBe(
      0o600,
    );
    await expect(
      acquireCampaignLock(ledgerPath, 60_000),
    ).resolves.toMatchObject({ ok: false });
    const old = new Date(0);
    await utimes(first.path, old, old);
    const replacement = unwrap(await acquireCampaignLock(ledgerPath, 1));
    await replacement.release();

    const raw = createM3bRawOutputArtifactStore(join(root, "private-raw"));
    const artifact = unwrap(
      await raw.write({
        text: "x".repeat(70_000),
        recordKey: "0".repeat(64),
        attemptIndex: 0,
      }),
    );
    expect(artifact).toMatchObject({
      storedSizeBytes: 65_536,
      truncated: true,
    });
    expect((await raw.read(artifact)).ok).toBe(true);
    await chmod(join(root, "private-raw", `${artifact.digest}.txt`), 0o600);
  });
});
