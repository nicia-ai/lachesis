import { execFile } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  diagnostic,
  type Diagnostics,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import {
  type BenchmarkBudgetReservation,
  type BenchmarkMethod,
  createExperimentManifest,
  createInMemoryBenchmarkStore,
  createM1aCatalogResolver,
  type ExperimentMethodInput,
  runBenchmark,
} from "@nicia-ai/lachesis-generator";
import { createJsonFileBenchmarkStore } from "@nicia-ai/lachesis-generator/node";
import {
  M1B_BEDROCK_ANTHROPIC_MODEL,
  M1B_PROMPT_PROTOCOL,
} from "@nicia-ai/lachesis-generator-ai-sdk";
import { afterEach, describe, expect, it } from "vitest";

import {
  createPrimaryMethods,
  executePhase,
  generateStoredReport,
  type LiveAcknowledgement,
  type LoadedPhase,
  loadPhaseFiles,
  preflightPhase,
} from "../src/controller.js";
import {
  acquireCampaignLock,
  inspectCampaignLedger,
  openCampaignLedger,
} from "../src/ledger.js";
import {
  M1B_PROMPT_CANDIDATE,
  type MaterializedPhase,
  materializeM1bPhase,
  matrixCounts,
} from "../src/manifests.js";
import {
  createCampaignManifest,
  createPhaseManifest,
  type PhaseManifest,
  phaseManifestSchema,
  verifyCampaignManifest,
  verifyPhaseManifest,
} from "../src/protocol.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: Array<string> = [];
const RUNTIME_VERSIONS = Object.freeze({
  node: "24.13.0",
  pnpm: "10.33.0",
  typescript: "6.0.3",
  zod: "4.4.3",
  aiSdk: "7.0.28",
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "lachesis-benchmark-"));
  temporaryDirectories.push(path);
  return path;
}

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function withoutPhaseDigest(
  manifest: PhaseManifest,
): Omit<PhaseManifest, "phaseManifestDigest"> {
  const { phaseManifestDigest, ...body } = manifest;
  expect(phaseManifestDigest.length).toBeGreaterThan(0);
  return body;
}

async function materialized(
  phase: "smoke" | "calibration" | "heldout",
  gitCommit = "test-commit",
): Promise<MaterializedPhase> {
  return unwrap(
    await materializeM1bPhase({
      phase,
      gitCommit,
      runtimeVersions: RUNTIME_VERSIONS,
    }),
  );
}

function loaded(value: MaterializedPhase): LoadedPhase {
  return {
    campaign: value.campaign,
    phase: value.manifest,
    materialized: value,
  };
}

async function recreateExperiment(
  input: Readonly<{
    materialized: MaterializedPhase;
    caseBindings?: ReadonlyArray<
      Readonly<{
        index: number;
        split:
          | "development"
          | "heldout-catalog"
          | "heldout-operator-combination"
          | "heldout-phrasing";
      }>
    >;
    methods?: ReadonlyArray<ExperimentMethodInput>;
  }>,
): Promise<PhaseManifest["experiment"]> {
  const original = input.materialized.manifest.experiment;
  const caseBindings =
    input.caseBindings ??
    input.materialized.cases.map((_, index) => ({
      index,
      split: original.cases[index]?.split ?? "development",
    }));
  return unwrap(
    await createExperimentManifest({
      prompt: M1B_PROMPT_CANDIDATE,
      protocol: M1B_PROMPT_PROTOCOL,
      cases: caseBindings.map((binding) => ({
        frozenCase:
          input.materialized.cases[binding.index] ??
          input.materialized.cases[0] ??
          (() => {
            throw new Error("Missing test case.");
          })(),
        split: binding.split,
      })),
      methods:
        input.methods ??
        original.methods.map((method) => ({
          id: method.id,
          model: method.model,
          strategy: method.strategy,
          inference: method.inference,
          pricingEntryId: method.pricingEntryId,
        })),
      pricingSnapshot: original.pricingSnapshot,
      repetitions: original.repetitions,
      caps: original.caps,
      versions: original.versions,
    }),
  );
}

async function phaseWithExperiment(
  value: MaterializedPhase,
  experiment: PhaseManifest["experiment"],
  phase = value.manifest.phase,
): Promise<Result<PhaseManifest, Diagnostics>> {
  return createPhaseManifest({
    campaign: value.campaign,
    phase,
    experiment,
    corpusDigest: value.manifest.corpusDigest,
    storageNamespace: value.manifest.storageNamespace,
    runtimeVersions: value.manifest.runtimeVersions,
  });
}

function fakeMethods(
  value: MaterializedPhase,
  calls: { value: number },
): ReadonlyArray<BenchmarkMethod> {
  return value.manifest.experiment.methods.map((method) => ({
    id: method.id,
    strategy: method.strategy,
    adapter: {
      identity: method.model,
      inference: method.inference,
      pricingEntryId: method.pricingEntryId,
      generate: () => {
        calls.value += 1;
        const code =
          method.id === "openai/unconstrained-json"
            ? ("PROVIDER_TIMEOUT" as const)
            : ("PROVIDER_FAILURE" as const);
        return Promise.resolve({
          ok: false,
          error: {
            code,
            message: "Recorded transport failure.",
          },
        });
      },
    },
  }));
}

function reservation(
  key: string,
  provider: string,
  maximumCostUsdMicros: number,
): BenchmarkBudgetReservation {
  return {
    experimentDigest: "experiment",
    benchmarkRecordKey: key,
    methodId: `${provider}/method`,
    attemptIndex: 0,
    billingProvider: provider,
    maximumCostUsdMicros,
  };
}

async function initializeGitRepository(): Promise<
  Readonly<{
    path: string;
    commit: string;
  }>
> {
  const path = await temporaryDirectory();
  await execFileAsync("git", ["init"], { cwd: path });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: path,
  });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: path });
  await writeFile(join(path, "tracked.txt"), "tracked\n", "utf8");
  await execFileAsync("git", ["add", "tracked.txt"], { cwd: path });
  await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: path });
  const commit = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: path,
  });
  return { path, commit: commit.stdout.trim() };
}

describe("M1b phase protocol", () => {
  it("freezes the exact smoke and held-out matrix counts", async () => {
    const smoke = await materialized("smoke");
    const heldout = await materialized("heldout");

    expect(smoke.manifest.experiment.cases).toHaveLength(2);
    expect(matrixCounts(smoke.manifest)).toEqual({
      benchmarkRecords: 12,
      initialModelCalls: 12,
      maximumAdditionalRepairCalls: 8,
      maximumModelCalls: 20,
    });
    expect(
      heldout.manifest.experiment.cases.filter(
        (item) => item.split === "heldout-catalog",
      ),
    ).toHaveLength(9);
    expect(matrixCounts(heldout.manifest)).toEqual({
      benchmarkRecords: 204,
      initialModelCalls: 204,
      maximumAdditionalRepairCalls: 136,
      maximumModelCalls: 340,
    });
  });

  it("pre-registers a development-only calibration set across all catalogs and operator classes", async () => {
    const calibration = await materialized("calibration");
    expect(
      calibration.manifest.experiment.cases.every(
        (item) => item.split === "development",
      ),
    ).toBe(true);
    expect(
      new Set(calibration.cases.map((item) => item.case.catalogId)),
    ).toEqual(
      new Set([
        "benchmark.numbers",
        "benchmark.text",
        "benchmark.decisions",
        "benchmark.workflow",
      ]),
    );
    expect(
      calibration.cases.some(
        (item) => item.case.id === "calibration/workflow-countdown",
      ),
    ).toBe(true);
  });

  it("rejects development, held-out, and mixed cases in the wrong phase", async () => {
    const smoke = await materialized("smoke");
    const heldout = await materialized("heldout");
    const heldoutAsSmoke = await recreateExperiment({
      materialized: heldout,
      caseBindings: [{ index: 0, split: "heldout-catalog" }],
    });
    const developmentAsHeldout = await recreateExperiment({
      materialized: smoke,
      caseBindings: [{ index: 0, split: "development" }],
    });
    const mixed = await recreateExperiment({
      materialized: heldout,
      caseBindings: [
        { index: 0, split: "development" },
        { index: 1, split: "heldout-catalog" },
      ],
    });

    expect(
      (await phaseWithExperiment(heldout, heldoutAsSmoke, "smoke")).ok,
    ).toBe(false);
    expect(
      (await phaseWithExperiment(smoke, developmentAsHeldout, "heldout")).ok,
    ).toBe(false);
    expect((await phaseWithExperiment(heldout, mixed, "heldout")).ok).toBe(
      false,
    );
  });

  it("rejects Bedrock, wrong models, and wrong reasoning settings", async () => {
    const heldout = await materialized("heldout");
    const methods = heldout.manifest.experiment.methods.map((method) => ({
      id: method.id,
      model: method.model,
      strategy: method.strategy,
      inference: method.inference,
      pricingEntryId: method.pricingEntryId,
    }));
    const anthropicIndex = methods.findIndex(
      (method) => method.model.provider === "anthropic",
    );
    const anthropic = methods[anthropicIndex];
    if (anthropic === undefined) throw new Error("Missing Anthropic method.");
    const bedrockMethods = methods.with(anthropicIndex, {
      ...anthropic,
      model: { ...anthropic.model, model: M1B_BEDROCK_ANTHROPIC_MODEL },
      pricingEntryId: "anthropic/claude-sonnet-5/bedrock/intro-2026-07-15",
    });
    const wrongModelMethods = methods.with(anthropicIndex, {
      ...anthropic,
      model: { ...anthropic.model, model: "claude-wrong" },
    });
    const wrongReasoningMethods = methods.with(anthropicIndex, {
      ...anthropic,
      inference: {
        ...anthropic.inference,
        reasoningSettings: { mode: "adaptive", effort: "high" },
      },
    });

    for (const candidate of [
      bedrockMethods,
      wrongModelMethods,
      wrongReasoningMethods,
    ]) {
      const experiment = await recreateExperiment({
        materialized: heldout,
        methods: candidate,
      });
      expect((await phaseWithExperiment(heldout, experiment)).ok).toBe(false);
    }
  });
});

describe("preflight", () => {
  it("constructs the exact inert primary method set without provider requests", async () => {
    const smoke = await materialized("smoke");
    const methods = createPrimaryMethods(smoke.manifest, {
      OPENAI_API_KEY: "present",
      ANTHROPIC_API_KEY: "present",
    });
    expect(methods).toHaveLength(6);
    expect(
      new Set(methods.map((method) => method.adapter.identity.provider)),
    ).toEqual(new Set(["openai", "anthropic"]));
    expect(
      createPrimaryMethods(smoke.manifest, {}).map(
        (method) => method.adapter.identity.model,
      ),
    ).toEqual(methods.map((method) => method.adapter.identity.model));
  });

  it("loads and revalidates materialized files and rejects malformed input", async () => {
    const smoke = await materialized("smoke");
    const directory = await temporaryDirectory();
    const campaignPath = join(directory, "campaign.json");
    const phasePath = join(directory, "smoke.json");
    await writeFile(
      campaignPath,
      `${JSON.stringify(smoke.campaign)}\n`,
      "utf8",
    );
    await writeFile(phasePath, `${JSON.stringify(smoke.manifest)}\n`, "utf8");
    const loadedFiles = unwrap(
      await loadPhaseFiles({ campaignPath, phasePath }),
    );
    expect(loadedFiles.phase.phaseManifestDigest).toBe(
      smoke.manifest.phaseManifestDigest,
    );

    await writeFile(phasePath, "{broken\n", "utf8");
    expect((await loadPhaseFiles({ campaignPath, phasePath })).ok).toBe(false);
    await writeFile(phasePath, "{}\n", "utf8");
    expect((await loadPhaseFiles({ campaignPath, phasePath })).ok).toBe(false);
    expect(
      (
        await loadPhaseFiles({
          campaignPath: join(directory, "missing.json"),
          phasePath,
        })
      ).ok,
    ).toBe(false);

    const body = withoutPhaseDigest(smoke.manifest);
    const changedBody = {
      ...body,
      corpusDigest: "different-corpus-digest",
    };
    const changedDigest = unwrap(await digestValue(changedBody));
    await writeFile(
      phasePath,
      `${JSON.stringify({ ...changedBody, phaseManifestDigest: changedDigest })}\n`,
      "utf8",
    );
    expect((await loadPhaseFiles({ campaignPath, phasePath })).ok).toBe(false);
  });

  it("requires exact acknowledgement and reports credentials without exposing values", async () => {
    const smoke = await materialized("smoke");
    const path = await temporaryDirectory();
    const ledgerPath = join(path, "ledger.ndjson");
    const environment = {
      OPENAI_API_KEY: "openai-secret-value",
      ANTHROPIC_API_KEY: "anthropic-secret-value",
    };
    const base = await preflightPhase({
      loaded: loaded(smoke),
      ledgerPath,
      cwd: process.cwd(),
      environment,
    });
    expect(unwrap(base).liveExecutionPermitted).toBe(false);

    const pool = smoke.campaign.budgetPools.find(
      (item) => item.id === "m1b-development",
    );
    if (pool === undefined) throw new Error("Missing development pool.");
    const exact: LiveAcknowledgement = {
      experimentDigest: smoke.manifest.experimentDigest,
      phase: "smoke",
      maximumCostUsdMicros: pool.maxCostUsdMicros,
    };
    const permitted = unwrap(
      await preflightPhase({
        loaded: loaded(smoke),
        ledgerPath,
        cwd: process.cwd(),
        environment,
        acknowledgement: exact,
      }),
    );
    expect(permitted.liveExecutionPermitted).toBe(true);
    expect(JSON.stringify(permitted)).not.toContain("secret-value");

    for (const wrong of [
      { ...exact, experimentDigest: "wrong" },
      { ...exact, maximumCostUsdMicros: pool.maxCostUsdMicros - 1 },
      { ...exact, phase: "calibration" as const },
    ]) {
      const report = unwrap(
        await preflightPhase({
          loaded: loaded(smoke),
          ledgerPath,
          cwd: process.cwd(),
          environment,
          acknowledgement: wrong,
        }),
      );
      expect(report.liveExecutionPermitted).toBe(false);
    }
  });

  it("reports missing credential names only and performs no provider calls", async () => {
    const smoke = await materialized("smoke");
    const report = unwrap(
      await preflightPhase({
        loaded: loaded(smoke),
        ledgerPath: join(await temporaryDirectory(), "ledger.ndjson"),
        cwd: process.cwd(),
        environment: {},
      }),
    );
    expect(report.missingCredentialNames).toEqual([
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
    ]);
    expect(report.liveExecutionPermitted).toBe(false);
    expect(report.benchmarkRecords).toBe(12);
    expect(
      (
        await preflightPhase({
          loaded: loaded(smoke),
          ledgerPath: join(await temporaryDirectory(), "ledger.ndjson"),
          cwd: process.cwd(),
        })
      ).ok,
    ).toBe(true);
  });

  it("fails closed when Git or ledger inspection fails", async () => {
    const smoke = await materialized("smoke");
    const directory = await temporaryDirectory();
    expect(
      (
        await preflightPhase({
          loaded: loaded(smoke),
          ledgerPath: join(directory, "ledger.ndjson"),
          cwd: join(directory, "not-a-repository"),
          environment: {},
        })
      ).ok,
    ).toBe(false);
    const ledgerPath = join(directory, "corrupt.ndjson");
    await writeFile(ledgerPath, "{}\n", "utf8");
    expect(
      (
        await preflightPhase({
          loaded: loaded(smoke),
          ledgerPath,
          cwd: process.cwd(),
          environment: {},
        })
      ).ok,
    ).toBe(false);
  });

  it("blocks dirty held-out worktrees and commit mismatches", async () => {
    const repository = await initializeGitRepository();
    const matching = await materialized("heldout", repository.commit);
    const ledgerPath = join(await temporaryDirectory(), "ledger.ndjson");
    const environment = {
      OPENAI_API_KEY: "present",
      ANTHROPIC_API_KEY: "present",
    };
    const acknowledgement: LiveAcknowledgement = {
      experimentDigest: matching.manifest.experimentDigest,
      phase: "heldout",
      maximumCostUsdMicros: 50_000_000,
    };
    const clean = unwrap(
      await preflightPhase({
        loaded: loaded(matching),
        ledgerPath,
        cwd: repository.path,
        environment,
        acknowledgement,
      }),
    );
    expect(clean.checks.cleanWorktree).toBe(true);
    expect(clean.checks.commitMatches).toBe(true);

    await writeFile(join(repository.path, "dirty.txt"), "dirty\n", "utf8");
    const dirty = unwrap(
      await preflightPhase({
        loaded: loaded(matching),
        ledgerPath,
        cwd: repository.path,
        environment,
        acknowledgement,
      }),
    );
    expect(dirty.checks.cleanWorktree).toBe(false);

    const mismatch = await materialized("heldout", "wrong-commit");
    const mismatched = unwrap(
      await preflightPhase({
        loaded: loaded(mismatch),
        ledgerPath,
        cwd: repository.path,
        environment,
        acknowledgement: {
          ...acknowledgement,
          experimentDigest: mismatch.manifest.experimentDigest,
        },
      }),
    );
    expect(mismatched.checks.commitMatches).toBe(false);
  });

  it("executes and resumes under the controller with fake adapters only", async () => {
    const smoke = await materialized("smoke");
    const storageRoot = await temporaryDirectory();
    const calls = { value: 0 };
    const environment = {
      OPENAI_API_KEY: "present",
      ANTHROPIC_API_KEY: "present",
    };
    const acknowledgement: LiveAcknowledgement = {
      experimentDigest: smoke.manifest.experimentDigest,
      phase: "smoke",
      maximumCostUsdMicros: 10_000_000,
    };
    const reservations: Array<string> = [];
    const first = unwrap(
      await executePhase({
        loaded: loaded(smoke),
        storageRoot,
        cwd: process.cwd(),
        environment,
        acknowledgement,
        methods: fakeMethods(smoke, calls),
        onReservation: (_, provider) => {
          reservations.push(provider);
        },
      }),
    );
    expect(first).toMatchObject({ generated: 12, resumed: 0, records: 12 });
    expect(reservations).toHaveLength(12);
    const second = unwrap(
      await executePhase({
        loaded: loaded(smoke),
        storageRoot,
        cwd: process.cwd(),
        environment,
        acknowledgement,
        methods: fakeMethods(smoke, calls),
      }),
    );
    expect(second).toMatchObject({ generated: 0, resumed: 12, records: 12 });
    expect(calls.value).toBe(12);
  });

  it("refuses execution before constructing live methods when acknowledgement is absent", async () => {
    const smoke = await materialized("smoke");
    const result = await executePhase({
      loaded: loaded(smoke),
      storageRoot: await temporaryDirectory(),
      cwd: process.cwd(),
      environment: {
        OPENAI_API_KEY: "present",
        ANTHROPIC_API_KEY: "present",
      },
      acknowledgement: undefined,
    });
    expect(result.ok).toBe(false);
  });
});

describe("content addressing", () => {
  it("rejects campaign and phase digest or pool mutation", async () => {
    const smoke = await materialized("smoke");
    expect(
      (
        await verifyCampaignManifest({
          ...smoke.campaign,
          campaignDigest: "wrong",
        })
      ).ok,
    ).toBe(false);
    const campaign = unwrap(await createCampaignManifest("another-campaign"));
    expect((await verifyPhaseManifest(smoke.manifest, campaign)).ok).toBe(
      false,
    );
    const body = withoutPhaseDigest(smoke.manifest);
    const budgetPoolId = "m1b-heldout-pilot" as const;
    const wrongPoolBody = {
      ...body,
      budgetPoolId,
    };
    const digest = unwrap(await digestValue(wrongPoolBody));
    expect(
      (
        await verifyPhaseManifest(
          { ...wrongPoolBody, phaseManifestDigest: digest },
          smoke.campaign,
        )
      ).ok,
    ).toBe(false);
  });
});

describe("campaign ledger", () => {
  it("shares one $10 development pool across smoke, calibration, and later manifests", async () => {
    const smoke = await materialized("smoke");
    const calibration = await materialized("calibration");
    const path = join(await temporaryDirectory(), "ledger.ndjson");
    const ledger = unwrap(
      await openCampaignLedger({ path, campaign: smoke.campaign }),
    );
    const smokeBudget = ledger.budgetController(smoke.manifest);
    const calibrationBudget = ledger.budgetController(calibration.manifest);
    const first = reservation("smoke-1", "openai", 6_000_000);
    expect((await smokeBudget.reserve(first)).ok).toBe(true);
    expect(
      (
        await smokeBudget.settle({
          ...first,
          actualCostUsdMicros: 6_000_000,
          conservative: false,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await calibrationBudget.reserve(
          reservation("calibration-1", "anthropic", 5_000_000),
        )
      ).ok,
    ).toBe(false);
    expect(ledger.status("m1b-development").remainingUsdMicros).toBe(4_000_000);

    const secondCalibration = await materialized("calibration");
    expect(
      (
        await ledger
          .budgetController(secondCalibration.manifest)
          .reserve(reservation("new-manifest", "openai", 4_000_001))
      ).ok,
    ).toBe(false);
  });

  it("enforces held-out total/provider caps and conservative missing-usage charges", async () => {
    const heldout = await materialized("heldout");
    const path = join(await temporaryDirectory(), "ledger.ndjson");
    const ledger = unwrap(
      await openCampaignLedger({ path, campaign: heldout.campaign }),
    );
    const budget = ledger.budgetController(heldout.manifest);
    const openai = reservation("openai-1", "openai", 24_000_000);
    expect((await budget.reserve(openai)).ok).toBe(true);
    expect(
      (
        await budget.settle({
          ...openai,
          actualCostUsdMicros: 24_000_000,
          conservative: true,
        })
      ).ok,
    ).toBe(true);
    expect(
      (await budget.reserve(reservation("openai-2", "openai", 2_000_000))).ok,
    ).toBe(false);
    const anthropic = reservation("anthropic-1", "anthropic", 25_000_000);
    expect((await budget.reserve(anthropic)).ok).toBe(true);
    expect(ledger.status("m1b-heldout-pilot")).toMatchObject({
      consumedUsdMicros: 49_000_000,
      remainingUsdMicros: 1_000_000,
    });
  });

  it("prevents duplicate reservation, charging, and settlement", async () => {
    const smoke = await materialized("smoke");
    const ledger = unwrap(
      await openCampaignLedger({
        path: join(await temporaryDirectory(), "ledger.ndjson"),
        campaign: smoke.campaign,
      }),
    );
    const budget = ledger.budgetController(smoke.manifest);
    const value = reservation("same", "openai", 1000);
    expect((await budget.reserve(value)).ok).toBe(true);
    expect((await budget.reserve(value)).ok).toBe(false);
    const settlement = {
      ...value,
      actualCostUsdMicros: 400,
      conservative: false,
    };
    expect((await budget.settle(settlement)).ok).toBe(true);
    expect((await budget.settle(settlement)).ok).toBe(false);
    expect(ledger.status("m1b-development").consumedUsdMicros).toBe(400);
  });

  it("serializes concurrent processes and preserves stale locks as evidence", async () => {
    const path = join(await temporaryDirectory(), "ledger.ndjson");
    const first = unwrap(await acquireCampaignLock(path));
    expect((await acquireCampaignLock(path)).ok).toBe(false);
    await first.release();

    const lockPath = `${path}.lock`;
    await mkdir(lockPath);
    await writeFile(join(lockPath, "owner.json"), "{}\n", "utf8");
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);
    const recovered = unwrap(await acquireCampaignLock(path, 1));
    expect(recovered.path).toBe(lockPath);
    await recovered.release();
    expect(
      (await readdir(join(path, ".."))).some((name) =>
        name.startsWith("ledger.ndjson.lock.stale-"),
      ),
    ).toBe(true);
  });

  it.each(["truncated", "reordered", "mismatched"])(
    "detects %s ledger data",
    async (corruption) => {
      const smoke = await materialized("smoke");
      const directory = await temporaryDirectory();
      const path = join(directory, "ledger.ndjson");
      const ledger = unwrap(
        await openCampaignLedger({ path, campaign: smoke.campaign }),
      );
      const budget = ledger.budgetController(smoke.manifest);
      expect(
        (await budget.reserve(reservation("record", "openai", 1000))).ok,
      ).toBe(true);
      const text = await readFile(path, "utf8");
      if (corruption === "truncated") {
        await writeFile(path, text.slice(0, -1), "utf8");
      } else if (corruption === "reordered") {
        const lines = text.trimEnd().split("\n").toReversed();
        await writeFile(path, `${lines.join("\n")}\n`, "utf8");
      } else {
        await appendFile(path, "{}\n", "utf8");
      }
      expect(
        (await inspectCampaignLedger({ path, campaign: smoke.campaign })).ok,
      ).toBe(false);
    },
  );

  it("rejects manifest mutation after the namespace is registered", async () => {
    const smoke = await materialized("smoke");
    const ledger = unwrap(
      await openCampaignLedger({
        path: join(await temporaryDirectory(), "ledger.ndjson"),
        campaign: smoke.campaign,
      }),
    );
    expect((await ledger.registerManifest(smoke.manifest)).ok).toBe(true);
    const body = withoutPhaseDigest(smoke.manifest);
    const changedBody = {
      ...body,
      runtimeVersions: { ...body.runtimeVersions, node: "24.99.0" },
    };
    const digest = unwrap(await digestValue(changedBody));
    const changed = phaseManifestSchema.parse({
      ...changedBody,
      phaseManifestDigest: digest,
    });
    expect((await verifyPhaseManifest(changed, smoke.campaign)).ok).toBe(true);
    expect((await ledger.registerManifest(changed)).ok).toBe(false);
  });
});

describe("resume and reporting", () => {
  it("propagates external reservation and settlement denial without overspending", async () => {
    const smoke = await materialized("smoke");
    const resolver = unwrap(createM1aCatalogResolver());
    const reserveCalls = { value: 0 };
    const deniedReservation = await runBenchmark({
      experiment: smoke.manifest.experiment,
      cases: smoke.cases,
      methods: fakeMethods(smoke, reserveCalls),
      resolveCatalog: resolver,
      store: createInMemoryBenchmarkStore(),
      budgetController: {
        reserve: () =>
          Promise.resolve({
            ok: false,
            error: diagnostic("BUDGET_EXCEEDED", "denied"),
          }),
        settle: () => Promise.resolve({ ok: true, value: undefined }),
      },
    });
    expect(deniedReservation.ok).toBe(false);
    expect(reserveCalls.value).toBe(0);

    const settleCalls = { value: 0 };
    const deniedSettlement = await runBenchmark({
      experiment: smoke.manifest.experiment,
      cases: smoke.cases,
      methods: fakeMethods(smoke, settleCalls),
      resolveCatalog: resolver,
      store: createInMemoryBenchmarkStore(),
      budgetController: {
        reserve: () => Promise.resolve({ ok: true, value: undefined }),
        settle: () =>
          Promise.resolve({
            ok: false,
            error: diagnostic("BUDGET_EXCEEDED", "settlement denied"),
          }),
      },
    });
    expect(deniedSettlement.ok).toBe(false);
    expect(settleCalls.value).toBe(1);
  });

  it("records provider failures once, resumes without retrying, and reconstructs an offline report", async () => {
    const smoke = await materialized("smoke");
    const storageRoot = await temporaryDirectory();
    const base = join(storageRoot, smoke.campaign.campaignDigest);
    const ledgerPath = join(base, "ledger.ndjson");
    const recordPath = join(
      base,
      smoke.manifest.storageNamespace,
      "records.json",
    );
    const ledger = unwrap(
      await openCampaignLedger({ path: ledgerPath, campaign: smoke.campaign }),
    );
    const store = unwrap(await createJsonFileBenchmarkStore(recordPath));
    const resolver = unwrap(createM1aCatalogResolver());
    const calls = { value: 0 };
    const first = unwrap(
      await runBenchmark({
        experiment: smoke.manifest.experiment,
        cases: smoke.cases,
        methods: fakeMethods(smoke, calls),
        resolveCatalog: resolver,
        store,
        budgetController: ledger.budgetController(smoke.manifest),
      }),
    );
    expect(first.generated).toBe(12);
    expect(calls.value).toBe(12);
    const chargedAfterFirst =
      ledger.status("m1b-development").consumedUsdMicros;

    const second = unwrap(
      await runBenchmark({
        experiment: smoke.manifest.experiment,
        cases: smoke.cases,
        methods: fakeMethods(smoke, calls),
        resolveCatalog: resolver,
        store,
        budgetController: ledger.budgetController(smoke.manifest),
      }),
    );
    expect(second.resumed).toBe(12);
    expect(second.generated).toBe(0);
    expect(calls.value).toBe(12);
    expect(ledger.status("m1b-development").consumedUsdMicros).toBe(
      chargedAfterFirst,
    );

    const report = unwrap(
      await generateStoredReport({
        loaded: loaded(smoke),
        storageRoot,
      }),
    );
    expect(report).toMatchObject({ records: 12, phase: "smoke" });
    expect(JSON.stringify(report)).toContain("providerFailures");
    expect(JSON.stringify(report)).toContain(
      "functional-ir-outperforms-codemode",
    );

    const originalRecords = await readFile(recordPath, "utf8");
    await writeFile(recordPath, "[{}]\n", "utf8");
    expect(
      (
        await generateStoredReport({
          loaded: loaded(smoke),
          storageRoot,
        })
      ).ok,
    ).toBe(false);
    const firstRecord = first.records[0];
    if (firstRecord === undefined) throw new Error("Missing first record.");
    await writeFile(
      recordPath,
      `${JSON.stringify([{ ...firstRecord, digest: "wrong" }])}\n`,
      "utf8",
    );
    expect(
      (
        await generateStoredReport({
          loaded: loaded(smoke),
          storageRoot,
        })
      ).ok,
    ).toBe(false);
    await writeFile(recordPath, originalRecords, "utf8");
    await writeFile(`${ledgerPath}.head`, "{}\n", "utf8");
    expect(
      (
        await generateStoredReport({
          loaded: loaded(smoke),
          storageRoot,
        })
      ).ok,
    ).toBe(false);
  });

  it("reports missing immutable records without loading providers", async () => {
    const smoke = await materialized("smoke");
    expect(
      (
        await generateStoredReport({
          loaded: loaded(smoke),
          storageRoot: await temporaryDirectory(),
        })
      ).ok,
    ).toBe(false);
  });

  it("keeps a pure in-memory resume path independent of providers", async () => {
    const smoke = await materialized("smoke");
    const store = createInMemoryBenchmarkStore();
    const resolver = unwrap(createM1aCatalogResolver());
    const calls = { value: 0 };
    const first = unwrap(
      await runBenchmark({
        experiment: smoke.manifest.experiment,
        cases: smoke.cases,
        methods: fakeMethods(smoke, calls),
        resolveCatalog: resolver,
        store,
      }),
    );
    const second = unwrap(
      await runBenchmark({
        experiment: smoke.manifest.experiment,
        cases: smoke.cases,
        methods: fakeMethods(smoke, calls),
        resolveCatalog: resolver,
        store,
      }),
    );
    expect(first.generated).toBe(12);
    expect(second.resumed).toBe(12);
    expect(calls.value).toBe(12);
  });
});
