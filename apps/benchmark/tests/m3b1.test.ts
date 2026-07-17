import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { digestValue } from "@nicia-ai/lachesis";
import {
  createM3bContractOutput,
  type M3bAttemptProvenance,
  type M3bOracle,
  type M3bOracleAttempt,
  type M3bOracleRequest,
} from "@nicia-ai/lachesis-evidence";
import { M3B4_ORACLE_IDENTITIES } from "@nicia-ai/lachesis-generator-ai-sdk";
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
import { createM3bRawOutputArtifactStore } from "../src/m3b1-raw-output-store.js";
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
  return {
    kind: "success",
    output: createM3bContractOutput(request),
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      costUsdMicros: 10,
      latencyMs: 5,
    },
    provenance: attemptProvenance("accepted", true),
  };
}

function attemptProvenance(
  category: string,
  usageAvailable: boolean,
): M3bAttemptProvenance {
  return {
    stage: usageAvailable ? "wire-decoding" : "transport",
    category,
    providerStatusCode: null,
    providerErrorCode: null,
    providerResponseId: null,
    finishReason: usageAvailable ? "stop" : null,
    rawFinishReason: null,
    usageAvailable,
    outputPresent: usageAvailable,
    outputDigest: null,
    outputSizeBytes: null,
    outputTruncated: false,
    issues: [],
  };
}

function retryingOracle(
  provider: "openai" | "anthropic",
  requests: Array<M3bOracleRequest>,
): M3bOracle {
  const identity = M3B4_ORACLE_IDENTITIES.find(
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
              provenance: attemptProvenance("provider-overload", false),
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
  const identity = M3B4_ORACLE_IDENTITIES.find(
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
              provenance: attemptProvenance("provider-refusal", true),
            }
          : {
              kind: "failure",
              code: "contract-mismatch",
              dispatchEvidence: "not-dispatched",
              usage: null,
              latencyMs: 1,
              provenance: attemptProvenance("contract-mismatch", false),
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
  it("persists bounded raw-output artifacts content-addressed with user-only permissions", async () => {
    const root = await temporaryRoot();
    const artifacts = createM3bRawOutputArtifactStore(join(root, "raw"));
    const text = `${"x".repeat(70_000)}secret-boundary`;
    const written = unwrap(
      await artifacts.write({
        recordKey: "record",
        attemptIndex: 0,
        text,
      }),
    );
    expect(written).toMatchObject({
      storedSizeBytes: 65_536,
      originalSizeBytes: new TextEncoder().encode(text).byteLength,
      truncated: true,
    });
    const path = join(root, "raw", `${written.digest}.txt`);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const recovered = unwrap(await artifacts.read(written));
    expect(new TextEncoder().encode(recovered).byteLength).toBe(65_536);
    expect(
      unwrap(
        await artifacts.write({ recordKey: "other", attemptIndex: 1, text }),
      ).digest,
    ).toBe(written.digest);
    await writeFile(path, "tampered", "utf8");
    expect(await artifacts.read(written)).toMatchObject({
      ok: false,
      error: { code: "REPLAY_OUTPUT_MISMATCH" },
    });
  });

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
    const stress = unwrap(
      await materializeM3b1Phase({
        phase: "m3b-wire-stress-probe",
        sourceCommit: SOURCE_COMMIT,
      }),
    );
    const heldout = await materializeM3b1Phase({
      phase: "m3b-heldout",
      sourceCommit: SOURCE_COMMIT,
    });

    expect(await validateM3b1Materialization(probe)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(probe.campaign).toMatchObject({
      campaignId: "lachesis-m3b4-wire-forensics-development",
      milestone: "m3b.4",
      maximumOperationalCostUsdMicros: 30_000_000,
      budgetPools: [
        {
          id: "m3b-development",
          maxCostUsdMicros: 30_000_000,
          providerCostCaps: [
            { billingProvider: "anthropic", maxCostUsdMicros: 13_000_000 },
            { billingProvider: "openai", maxCostUsdMicros: 17_000_000 },
          ],
        },
      ],
    });
    expect(probe.campaign.campaignDigest).not.toBe(
      "6e5cc9dcb80b9c1c82ef005987f30bf560f33d2c1400cb5de9ca2460c755369a",
    );
    expect(
      [probe, stress, calibration].map((item) => ({
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
        initialCalls: 48,
        retries: 144,
        maximumCalls: 288,
        theoretical: 13_680_000,
        operational: 30_000_000,
      },
      {
        phase: "m3b-wire-stress-probe",
        initialCalls: 96,
        retries: 288,
        maximumCalls: 576,
        theoretical: 27_360_000,
        operational: 30_000_000,
      },
      {
        phase: "m3b-calibration",
        initialCalls: 240,
        retries: 720,
        maximumCalls: 1_440,
        theoretical: 68_400_000,
        operational: 30_000_000,
      },
    ]);
    expect(heldout).toMatchObject({
      ok: false,
      error: [
        {
          code: "INVALID_WIRE_SCHEMA",
          message:
            "The M3b.4 development campaign carries no held-out authority.",
        },
      ],
    });
    expect(probe.phase.theoreticalCeiling.providers).toEqual([
      {
        billingProvider: "anthropic",
        maximumCalls: 144,
        maximumInputTokens: 1_152_000,
        maximumOutputTokens: 288_000,
        maximumTotalTokens: 1_440_000,
        maximumCostUsdMicros: 5_760_000,
      },
      {
        billingProvider: "openai",
        maximumCalls: 144,
        maximumInputTokens: 1_152_000,
        maximumOutputTokens: 288_000,
        maximumTotalTokens: 1_440_000,
        maximumCostUsdMicros: 7_920_000,
      },
    ]);
    expect(
      new Set(probe.phase.providerBindings.map((item) => item.route)),
    ).toEqual(new Set(["openai-responses", "anthropic-messages"]));
    expect(
      probe.phase.providerBindings.map((item) => item.providerSdkPackage),
    ).toEqual(["@ai-sdk/anthropic", "@ai-sdk/openai"]);
    expect(
      M3B_OFFLINE_DESIGN_IDENTITIES.slice(0, 3).map((item) => item.disposition),
    ).toEqual(Array.from({ length: 3 }, () => "report-only-offline-unbound"));
    expect(
      m3bExecutionDisposition(
        M3B_OFFLINE_DESIGN_IDENTITIES[3]?.experimentDigest ?? "",
      ),
    ).toBe("complete-protocol-fail");
    expect(
      M3B_OFFLINE_DESIGN_IDENTITIES.slice(4, 6).every(
        (identity) =>
          m3bExecutionDisposition(identity.experimentDigest) ===
          "superseded-unexecuted",
      ),
    ).toBe(true);
    expect(
      m3bExecutionDisposition(
        M3B_OFFLINE_DESIGN_IDENTITIES[6]?.experimentDigest ?? "",
      ),
    ).toBe("complete-semantic-gate-fail");
    expect(
      M3B_OFFLINE_DESIGN_IDENTITIES.slice(7).every((identity) => {
        const disposition = m3bExecutionDisposition(identity.experimentDigest);
        return (
          disposition === "superseded-unexecuted" ||
          disposition === "complete-calibration-fail" ||
          disposition === "blocked-unexecuted"
        );
      }),
    ).toBe(true);
    expect(
      M3B_OFFLINE_DESIGN_IDENTITIES.every(
        (identity) =>
          ![probe, stress, calibration].some(
            (item) => item.phase.experimentDigest === identity.experimentDigest,
          ),
      ),
    ).toBe(true);
    const stressPreflight = await preflightM3b1({
      materialized: stress,
      currentCommit: SOURCE_COMMIT,
      cleanWorktree: true,
      credentials: { OPENAI_API_KEY: false, ANTHROPIC_API_KEY: false },
    });
    expect(stressPreflight.checks).toMatchObject({
      perRequestReservationsFit: true,
      completePhaseReservationsFit: true,
    });
    const calibrationPreflight = await preflightM3b1({
      materialized: calibration,
      currentCommit: SOURCE_COMMIT,
      cleanWorktree: true,
      credentials: { OPENAI_API_KEY: false, ANTHROPIC_API_KEY: false },
    });
    expect(calibrationPreflight.checks.completePhaseReservationsFit).toBe(
      false,
    );
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
  }, 20_000);

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
    await expect(stat(join(root, "m3b4"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects the failed and superseded M3b.1 identities before ledger mutation or dispatch", async () => {
    const root = await temporaryRoot();
    const fresh = unwrap(
      await materializeM3b1Phase({
        phase: "m3b-protocol-probe",
        sourceCommit: SOURCE_COMMIT,
      }),
    );
    for (const historical of M3B_OFFLINE_DESIGN_IDENTITIES.slice(3)) {
      const materialized: M3b1MaterializedPhase = {
        ...fresh,
        phase: {
          ...fresh.phase,
          experimentDigest: historical.experimentDigest,
        },
      };
      const requests: Array<M3bOracleRequest> = [];
      const result = await executeM3b1({
        materialized,
        currentCommit: SOURCE_COMMIT,
        cleanWorktree: true,
        credentials: {
          openaiApiKey: "offline-dummy",
          anthropicApiKey: "offline-dummy",
        },
        acknowledgement: acknowledgement(materialized),
        storageRoot: root,
        oracles: [
          retryingOracle("openai", requests),
          retryingOracle("anthropic", requests),
        ],
      });
      expect(result).toMatchObject({ ok: false });
      expect(requests).toEqual([]);
    }
    expect(await readdir(root)).toEqual([]);
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
      dispatched: 48,
      resumed: 0,
      transportRetries: 48,
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
      consumedUsdMicros: 2_280_480,
      observedProviderBillingUsdMicros: 480,
      authorizedConservativeUsdMicros: 2_280_000,
    });
    expect(first.budget.providers).toEqual([
      {
        billingProvider: "anthropic",
        maximumUsdMicros: 13_000_000,
        consumedUsdMicros: 960_240,
        remainingUsdMicros: 12_039_760,
      },
      {
        billingProvider: "openai",
        maximumUsdMicros: 17_000_000,
        consumedUsdMicros: 1_320_240,
        remainingUsdMicros: 15_679_760,
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
    expect(resumed.run).toMatchObject({ dispatched: 0, resumed: 48 });
    expect(openaiRequests.length + anthropicRequests.length).toBe(
      callsBeforeResume,
    );
    expect(resumed.budget).toEqual(first.budget);

    const ledgerPath = join(
      root,
      "m3b4",
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
      "m3b4",
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
      dispatched: 48,
      transportRetries: 48,
    });
    expect(requests).toHaveLength(95);
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

    expect(requests).toHaveLength(48);
    expect(result.run.transportRetries).toBe(0);
    expect(result.budget).toMatchObject({
      consumedUsdMicros: 168,
      observedProviderBillingUsdMicros: 168,
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
      "m3b4",
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
    await expect(stat(join(root, "m3b4"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
