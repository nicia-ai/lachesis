import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { digestValue } from "@nicia-ai/lachesis";
import {
  M3B_PREREGISTERED_CORPUS,
  type M3bOracle,
  type M3bOracleAttempt,
  type M3bOracleRequest,
} from "@nicia-ai/lachesis-evidence";
import { M3B1_ORACLE_IDENTITIES } from "@nicia-ai/lachesis-generator-ai-sdk";
import { afterEach, describe, expect, it } from "vitest";

import {
  executeM3b1,
  type M3b1LiveAcknowledgement,
  m3bExecutionDisposition,
  preflightM3b1,
} from "../src/m3b1-controller.js";
import { inspectM3b1Ledger, openM3b1Ledger } from "../src/m3b1-ledger.js";
import {
  M3B_OFFLINE_DESIGN_IDENTITIES,
  type M3b1MaterializedPhase,
  materializeM3b1Phase,
  validateM3b1Materialization,
} from "../src/m3b1-manifests.js";
import { createJsonFileM3b1Store } from "../src/m3b1-store.js";

const SOURCE_COMMIT = "7e25f52c18a0f5879e1dd9de708d79edb663410d";
const temporaryRoots: Array<string> = [];

function unwrap<T>(
  result:
    Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }>,
): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lachesis-m3b1-"));
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

function semanticOutput(request: M3bOracleRequest): M3bOracleAttempt {
  const task = M3B_PREREGISTERED_CORPUS.find(
    (candidate) => candidate.instruction === request.instruction,
  );
  return {
    kind: "success",
    output: {
      answer: task?.expectedAnswer ?? "unknown",
      citationIds: request.evidence.citations.map((citation) => citation.id),
      paths: request.evidence.paths,
    },
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      costUsdMicros: 10,
      latencyMs: 5,
    },
  };
}

function retryingOracle(
  provider: "openai" | "anthropic",
  requests: Array<M3bOracleRequest>,
): M3bOracle {
  const identity = M3B1_ORACLE_IDENTITIES.find(
    (candidate) => candidate.provider === provider,
  );
  if (identity === undefined) throw new Error(`Missing ${provider} identity.`);
  return {
    identity,
    generate: (request, context) => {
      requests.push(request);
      return Promise.resolve(
        context.attemptIndex === 0
          ? {
              kind: "failure",
              code: "provider-overload",
              dispatchEvidence: "dispatched-usage-unknown",
              usage: null,
              latencyMs: 3,
            }
          : semanticOutput(request),
      );
    },
  };
}

function terminalFailureOracle(
  provider: "openai" | "anthropic",
  requests: Array<M3bOracleRequest>,
): M3bOracle {
  const identity = M3B1_ORACLE_IDENTITIES.find(
    (candidate) => candidate.provider === provider,
  );
  if (identity === undefined) throw new Error(`Missing ${provider} identity.`);
  return {
    identity,
    generate: (request) => {
      requests.push(request);
      return Promise.resolve(
        provider === "openai"
          ? {
              kind: "failure",
              code: "provider-refusal",
              dispatchEvidence: "dispatched-with-usage",
              usage: {
                inputTokens: 10,
                outputTokens: 1,
                costUsdMicros: 7,
                latencyMs: 2,
              },
            }
          : {
              kind: "failure",
              code: "contract-mismatch",
              dispatchEvidence: "not-dispatched",
              usage: null,
              latencyMs: 1,
            },
      );
    },
  };
}

function acknowledgement(
  materialized: M3b1MaterializedPhase,
): M3b1LiveAcknowledgement {
  return {
    campaignDigest: materialized.campaign.campaignDigest,
    experimentDigest: materialized.phase.experimentDigest,
    phase: materialized.phase.phase,
    operationalPoolUsdMicros:
      materialized.phase.operationalPool.maxCostUsdMicros,
  };
}

describe("M3b.1 live-binding substrate", () => {
  it("derives fresh provider, pricing, transport, and phase identities", async () => {
    const probe = unwrap(
      await materializeM3b1Phase({
        phase: "m3b-protocol-probe",
        sourceCommit: SOURCE_COMMIT,
      }),
    );
    const calibration = unwrap(
      await materializeM3b1Phase({
        phase: "m3b-calibration",
        sourceCommit: SOURCE_COMMIT,
      }),
    );
    const heldout = unwrap(
      await materializeM3b1Phase({
        phase: "m3b-heldout",
        sourceCommit: SOURCE_COMMIT,
      }),
    );

    expect(await validateM3b1Materialization(probe)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      [probe, calibration, heldout].map((item) => ({
        phase: item.phase.phase,
        initialCalls: item.phase.initialCalls,
        retries: item.phase.maximumTransportRetries,
        maximumCalls: item.phase.maximumCalls,
        theoretical: item.phase.theoreticalCeiling.maximumCostUsdMicros,
        operational: item.phase.operationalPool.maxCostUsdMicros,
      })),
    ).toEqual([
      {
        phase: "m3b-protocol-probe",
        initialCalls: 16,
        retries: 16,
        maximumCalls: 32,
        theoretical: 1_520_000,
        operational: 10_000_000,
      },
      {
        phase: "m3b-calibration",
        initialCalls: 240,
        retries: 240,
        maximumCalls: 480,
        theoretical: 22_800_000,
        operational: 10_000_000,
      },
      {
        phase: "m3b-heldout",
        initialCalls: 2_560,
        retries: 2_560,
        maximumCalls: 5_120,
        theoretical: 243_200_000,
        operational: 60_000_000,
      },
    ]);
    expect(probe.phase.theoreticalCeiling.providers).toEqual([
      {
        billingProvider: "anthropic",
        maximumCalls: 16,
        maximumInputTokens: 128_000,
        maximumOutputTokens: 32_000,
        maximumTotalTokens: 160_000,
        maximumCostUsdMicros: 640_000,
      },
      {
        billingProvider: "openai",
        maximumCalls: 16,
        maximumInputTokens: 128_000,
        maximumOutputTokens: 32_000,
        maximumTotalTokens: 160_000,
        maximumCostUsdMicros: 880_000,
      },
    ]);
    expect(
      new Set(probe.phase.providerBindings.map((item) => item.route)),
    ).toEqual(new Set(["openai-responses", "anthropic-messages"]));
    expect(
      probe.phase.providerBindings.map((item) => item.providerSdkPackage),
    ).toEqual(["@ai-sdk/anthropic", "@ai-sdk/openai"]);
    expect(
      M3B_OFFLINE_DESIGN_IDENTITIES.map((item) => item.disposition),
    ).toEqual(Array.from({ length: 3 }, () => "report-only-offline-unbound"));
    expect(
      M3B_OFFLINE_DESIGN_IDENTITIES.map((identity) =>
        m3bExecutionDisposition(identity.experimentDigest),
      ),
    ).toEqual(Array.from({ length: 3 }, () => "report-only-offline-unbound"));
    expect(
      M3B_OFFLINE_DESIGN_IDENTITIES.every(
        (identity) =>
          ![probe, calibration, heldout].some(
            (item) => item.phase.experimentDigest === identity.experimentDigest,
          ),
      ),
    ).toBe(true);
    expect(
      await validateM3b1Materialization({
        ...probe,
        phase: {
          ...probe.phase,
          phaseManifestDigest: "0".repeat(64),
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_OUTPUT_MISMATCH" },
    });
  }, 10_000);

  it("keeps credential-free and acknowledgement-free preflight read-only", async () => {
    const root = await temporaryRoot();
    const materialized = unwrap(
      await materializeM3b1Phase({
        phase: "m3b-protocol-probe",
        sourceCommit: SOURCE_COMMIT,
      }),
    );
    const report = await preflightM3b1({
      materialized,
      currentCommit: SOURCE_COMMIT,
      cleanWorktree: true,
      credentials: { OPENAI_API_KEY: false, ANTHROPIC_API_KEY: false },
    });

    expect(report).toMatchObject({
      valid: true,
      executionDisposition: "live-capable",
      missingCredentialNames: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
      liveExecutionPermitted: false,
    });
    await expect(stat(join(root, "m3b1"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("charges both attempts when an unknown-usage failure is retried and resumes without dispatch", async () => {
    const root = await temporaryRoot();
    const materialized = unwrap(
      await materializeM3b1Phase({
        phase: "m3b-protocol-probe",
        sourceCommit: SOURCE_COMMIT,
      }),
    );
    const openaiRequests: Array<M3bOracleRequest> = [];
    const anthropicRequests: Array<M3bOracleRequest> = [];
    const first = unwrap(
      await executeM3b1({
        materialized,
        storageRoot: root,
        currentCommit: SOURCE_COMMIT,
        cleanWorktree: true,
        acknowledgement: acknowledgement(materialized),
        credentials: {
          openaiApiKey: "offline-dummy",
          anthropicApiKey: "offline-dummy",
        },
        oracles: [
          retryingOracle("openai", openaiRequests),
          retryingOracle("anthropic", anthropicRequests),
        ],
      }),
    );

    expect(first.run).toMatchObject({
      dispatched: 16,
      resumed: 0,
      transportRetries: 16,
    });
    expect(
      first.run.records.every(
        (record) =>
          record.executionBinding?.experimentDigest ===
            materialized.phase.experimentDigest &&
          record.executionBinding.phaseManifestDigest ===
            materialized.phase.phaseManifestDigest &&
          record.executionBinding.pricingSnapshotDigest ===
            materialized.phase.pricingSnapshot.digest,
      ),
    ).toBe(true);
    expect(first.budget).toMatchObject({
      consumedUsdMicros: 760_160,
      observedProviderBillingUsdMicros: 160,
      authorizedConservativeUsdMicros: 760_000,
    });
    expect(first.budget.providers).toEqual([
      {
        billingProvider: "anthropic",
        maximumUsdMicros: 4_000_000,
        consumedUsdMicros: 320_080,
        remainingUsdMicros: 3_679_920,
      },
      {
        billingProvider: "openai",
        maximumUsdMicros: 6_000_000,
        consumedUsdMicros: 440_080,
        remainingUsdMicros: 5_559_920,
      },
    ]);
    const callsBeforeResume = openaiRequests.length + anthropicRequests.length;
    const resumed = unwrap(
      await executeM3b1({
        materialized,
        storageRoot: root,
        currentCommit: SOURCE_COMMIT,
        cleanWorktree: true,
        acknowledgement: acknowledgement(materialized),
        credentials: {
          openaiApiKey: "offline-dummy",
          anthropicApiKey: "offline-dummy",
        },
        oracles: [
          retryingOracle("openai", openaiRequests),
          retryingOracle("anthropic", anthropicRequests),
        ],
      }),
    );
    expect(resumed.run).toMatchObject({ dispatched: 0, resumed: 16 });
    expect(openaiRequests.length + anthropicRequests.length).toBe(
      callsBeforeResume,
    );
    expect(resumed.budget).toEqual(first.budget);

    const ledgerPath = join(
      root,
      "m3b1",
      materialized.campaign.campaignDigest,
      "ledger.ndjson",
    );
    const ledger = unwrap(
      await inspectM3b1Ledger({
        path: ledgerPath,
        campaign: materialized.campaign,
      }),
    );
    expect(ledger.find((pool) => pool.poolId === "m3b-development")).toEqual(
      first.budget,
    );
    expect((await readFile(ledgerPath, "utf8")).endsWith("\n")).toBe(true);
  });

  it("recovers an interrupted reserved attempt without redispatching it", async () => {
    const root = await temporaryRoot();
    const materialized = unwrap(
      await materializeM3b1Phase({
        phase: "m3b-protocol-probe",
        sourceCommit: SOURCE_COMMIT,
      }),
    );
    const firstEntry = materialized.substrate.manifest.schedule.entries[0];
    const firstArm = firstEntry?.order[0];
    if (firstEntry === undefined || firstArm === undefined)
      throw new Error("The protocol probe schedule is empty.");
    if (firstEntry.provider !== "openai" && firstEntry.provider !== "anthropic")
      throw new Error("The scheduled provider is not live-bound.");
    const persistentKey = `${materialized.phase.experimentDigest}/${firstEntry.unitDigest}/${firstArm}`;
    const dispatchKey = unwrap(await digestValue({ recordKey: persistentKey }));
    const providerCeiling =
      materialized.phase.theoreticalCeiling.providers.find(
        (provider) => provider.billingProvider === firstEntry.provider,
      );
    if (providerCeiling === undefined)
      throw new Error("The scheduled provider has no ceiling.");
    const ledgerPath = join(
      root,
      "m3b1",
      materialized.campaign.campaignDigest,
      "ledger.ndjson",
    );
    const ledger = unwrap(
      await openM3b1Ledger({
        path: ledgerPath,
        campaign: materialized.campaign,
      }),
    );
    unwrap(await ledger.registerManifest(materialized.phase));
    expect(
      await ledger.registerManifest({
        ...materialized.phase,
        phaseManifestDigest: "0".repeat(64),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_OUTPUT_MISMATCH" },
    });
    const controller = ledger.budgetController(materialized.phase);
    expect(
      unwrap(
        await controller.reserve({
          experimentDigest: materialized.phase.experimentDigest,
          recordKey: dispatchKey,
          attemptIndex: 0,
          billingProvider: firstEntry.provider,
          maximumCostUsdMicros:
            providerCeiling.maximumCostUsdMicros / providerCeiling.maximumCalls,
        }),
      ),
    ).toBe("reserved");
    expect(
      await controller.reserve({
        experimentDigest: materialized.phase.experimentDigest,
        recordKey: "unfundable-offline-fixture",
        attemptIndex: 0,
        billingProvider: firstEntry.provider,
        maximumCostUsdMicros:
          materialized.phase.operationalPool.maxCostUsdMicros,
      }),
    ).toMatchObject({ ok: false, error: { code: "BUDGET_EXCEEDED" } });
    expect(
      await controller.settle({
        experimentDigest: materialized.phase.experimentDigest,
        recordKey: "missing-offline-fixture",
        attemptIndex: 0,
        billingProvider: firstEntry.provider,
        maximumCostUsdMicros: 1,
        actualCostUsdMicros: 0,
        conservative: false,
        accountingBasis: "not-dispatched",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_OUTPUT_MISMATCH" },
    });

    const requests: Array<M3bOracleRequest> = [];
    const result = unwrap(
      await executeM3b1({
        materialized,
        storageRoot: root,
        currentCommit: SOURCE_COMMIT,
        cleanWorktree: true,
        acknowledgement: acknowledgement(materialized),
        credentials: {
          openaiApiKey: "offline-dummy",
          anthropicApiKey: "offline-dummy",
        },
        oracles: [
          retryingOracle("openai", requests),
          retryingOracle("anthropic", requests),
        ],
      }),
    );

    expect(result.run).toMatchObject({
      dispatched: 16,
      transportRetries: 16,
    });
    expect(requests).toHaveLength(31);
    expect(
      result.run.records.some(
        (record) =>
          record.key === persistentKey &&
          record.attempts[0]?.kind === "failure" &&
          record.attempts[0].dispatchEvidence === "dispatched-usage-unknown",
      ),
    ).toBe(true);
  });

  it("separates observed and proven pre-dispatch settlements and detects durable corruption", async () => {
    const root = await temporaryRoot();
    const materialized = unwrap(
      await materializeM3b1Phase({
        phase: "m3b-protocol-probe",
        sourceCommit: SOURCE_COMMIT,
      }),
    );
    const requests: Array<M3bOracleRequest> = [];
    const result = unwrap(
      await executeM3b1({
        materialized,
        storageRoot: root,
        currentCommit: SOURCE_COMMIT,
        cleanWorktree: true,
        acknowledgement: acknowledgement(materialized),
        credentials: {
          openaiApiKey: "offline-dummy",
          anthropicApiKey: "offline-dummy",
        },
        oracles: [
          terminalFailureOracle("openai", requests),
          terminalFailureOracle("anthropic", requests),
        ],
      }),
    );

    expect(requests).toHaveLength(16);
    expect(result.run.transportRetries).toBe(0);
    expect(result.budget).toMatchObject({
      consumedUsdMicros: 56,
      observedProviderBillingUsdMicros: 56,
      authorizedConservativeUsdMicros: 0,
    });
    const firstRecord = result.run.records[0];
    if (firstRecord === undefined)
      throw new Error("Probe produced no records.");
    const store = createJsonFileM3b1Store(
      join(root, materialized.phase.storageNamespace),
    );
    expect(await store.save(firstRecord)).toMatchObject({
      ok: false,
      error: { code: "INVALID_WIRE_SCHEMA" },
    });
    const recordFileDigest = unwrap(
      await digestValue({ key: firstRecord.key }),
    );
    await writeFile(
      join(
        root,
        materialized.phase.storageNamespace,
        `${recordFileDigest}.json`,
      ),
      "{}\n",
      "utf8",
    );
    expect(await store.load(firstRecord.key)).toMatchObject({
      ok: false,
      error: { code: "REPLAY_OUTPUT_MISMATCH" },
    });

    const ledgerPath = join(
      root,
      "m3b1",
      materialized.campaign.campaignDigest,
      "ledger.ndjson",
    );
    const ledgerText = await readFile(ledgerPath, "utf8");
    const headText = await readFile(`${ledgerPath}.head`, "utf8");
    await writeFile(`${ledgerPath}.head`, "{}\n", "utf8");
    expect(
      await inspectM3b1Ledger({
        path: ledgerPath,
        campaign: materialized.campaign,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_OUTPUT_MISMATCH" },
    });
    await writeFile(`${ledgerPath}.head`, headText, "utf8");
    await writeFile(
      ledgerPath,
      ledgerText.replace(
        /"digest":"[a-f0-9]{64}"/u,
        `"digest":"${"0".repeat(64)}"`,
      ),
      "utf8",
    );
    expect(
      await inspectM3b1Ledger({
        path: ledgerPath,
        campaign: materialized.campaign,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_OUTPUT_MISMATCH" },
    });
    const invalidLedgerPath = join(root, "invalid-ledger.ndjson");
    await writeFile(invalidLedgerPath, "{}\n", "utf8");
    await writeFile(`${invalidLedgerPath}.head`, "{}\n", "utf8");
    expect(
      await inspectM3b1Ledger({
        path: invalidLedgerPath,
        campaign: materialized.campaign,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_OUTPUT_MISMATCH" },
    });
    const nonDirectory = join(root, "not-a-directory");
    await writeFile(nonDirectory, "fixture", "utf8");
    expect(
      await openM3b1Ledger({
        path: join(nonDirectory, "ledger.ndjson"),
        campaign: materialized.campaign,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_WIRE_SCHEMA" },
    });
    const readOnlyDirectory = join(root, "read-only");
    await mkdir(readOnlyDirectory, { mode: 0o500 });
    try {
      expect(
        await openM3b1Ledger({
          path: join(readOnlyDirectory, "ledger.ndjson"),
          campaign: materialized.campaign,
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "INVALID_WIRE_SCHEMA" },
      });
    } finally {
      await chmod(readOnlyDirectory, 0o700);
    }
    await rm(`${ledgerPath}.head`);
    expect(
      await inspectM3b1Ledger({
        path: ledgerPath,
        campaign: materialized.campaign,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPLAY_OUTPUT_MISMATCH" },
    });
  });

  it("rejects invalid acknowledgement before dispatch, ledger, or record mutation", async () => {
    const root = await temporaryRoot();
    const materialized = unwrap(
      await materializeM3b1Phase({
        phase: "m3b-protocol-probe",
        sourceCommit: SOURCE_COMMIT,
      }),
    );
    const requests: Array<M3bOracleRequest> = [];
    const result = await executeM3b1({
      materialized,
      storageRoot: root,
      currentCommit: SOURCE_COMMIT,
      cleanWorktree: true,
      acknowledgement: {
        ...acknowledgement(materialized),
        experimentDigest: "0".repeat(64),
      },
      credentials: {
        openaiApiKey: "offline-dummy",
        anthropicApiKey: "offline-dummy",
      },
      oracles: [
        retryingOracle("openai", requests),
        retryingOracle("anthropic", requests),
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "BUDGET_EXCEEDED" },
    });
    expect(requests).toEqual([]);
    await expect(stat(join(root, "m3b1"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
