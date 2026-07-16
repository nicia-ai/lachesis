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
  createPlanLanguageManifest,
  type Diagnostic,
  diagnostic,
  type Diagnostics,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import {
  type BenchmarkBudgetReservation,
  type BenchmarkBudgetSettlement,
  type BenchmarkMethod,
  type CodeModeModelAdapter,
  createExperimentManifest,
  createInMemoryBenchmarkStore,
  createM1aCatalogResolver,
  createM2CatalogResolver,
  createPricingSnapshot,
  createReferencePlanWitness,
  type ExperimentCaps,
  type ExperimentMethodInput,
  type M2CodeModeMethod,
  type ModelAdapter,
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
  blindHeldOutIntegrityAudit,
  blindM1cHeldOutIntegrityAudit,
  blindM2HeldOutAudit,
  deriveTransportProbeCaps,
  M1B_PROMPT_CANDIDATE,
  type MaterializedPhase,
  materializeM1bPhase,
  materializeM1cPhase,
  materializeM2Phase,
  matrixCounts,
  validateM2PhaseCaps,
  validateTransportProbeCaps,
} from "../src/manifests.js";
import {
  campaignManifestSchema,
  createCampaignManifest,
  createPhaseManifest,
  experimentStorageNamespace,
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
const IMMUTABLE_PARTIAL_PROBE = Object.freeze({
  gitCommit: "bd72ae69f2f3efaeab97bd2890bbe9a4c450de8e",
  campaignDigest:
    "d4f618dc57320f2d25ebdadedef43301d2b12d1e46339ca3b1ff90ecf9d55d39",
  experimentDigest:
    "9b3abca99a1f90926631d8216827eba47348045e0cb343b77a0e37f51781e431",
  phaseManifestDigest:
    "37feb76ee3959218d715695d47c7ee5a4de8b9d5d2de7542dc285c9aca6f59e5",
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

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function diagnosticMessage<T>(result: Result<T, Diagnostic>): string {
  if (result.ok) throw new Error("Expected a diagnostic result.");
  return result.error.message;
}

function withoutPhaseDigest(
  manifest: PhaseManifest,
): Omit<PhaseManifest, "phaseManifestDigest"> {
  const { phaseManifestDigest, ...body } = manifest;
  expect(phaseManifestDigest.length).toBeGreaterThan(0);
  return body;
}

async function materialized(
  phase: "transport-probe" | "smoke" | "calibration" | "heldout",
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

async function materializedM1c(
  phase:
    "m1c-protocol-probe" | "m1c-repair" | "m1c-calibration" | "m1c-heldout",
  gitCommit = "test-commit",
): Promise<MaterializedPhase> {
  return unwrap(
    await materializeM1cPhase({
      phase,
      gitCommit,
      runtimeVersions: RUNTIME_VERSIONS,
    }),
  );
}

async function materializedM2(
  phase: "m2-protocol-probe" | "m2-calibration" | "m2-heldout",
  gitCommit = "test-commit",
): Promise<MaterializedPhase> {
  return unwrap(
    await materializeM2Phase({
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
    executionPolicy: "live",
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
    caps?: ExperimentCaps;
  }>,
): Promise<PhaseManifest["experiment"]> {
  const original = input.materialized.manifest.experiment;
  const caseBindings =
    input.caseBindings ??
    input.materialized.cases.map((_, index) => ({
      index,
      split: original.cases[index]?.split ?? "development",
    }));
  const cases = caseBindings.map((binding) => ({
    frozenCase:
      input.materialized.cases[binding.index] ??
      input.materialized.cases[0] ??
      (() => {
        throw new Error("Missing test case.");
      })(),
    split: binding.split,
  }));
  const methods =
    input.methods ??
    original.methods.map((method) => ({
      id: method.id,
      model: method.model,
      strategy: method.strategy,
      inference: method.inference,
      pricingEntryId: method.pricingEntryId,
    }));
  const transportSchemas = cases.flatMap(({ frozenCase }) =>
    methods.flatMap(
      (method) =>
        original.transportSchemas?.filter(
          (binding) =>
            binding.caseDigest === frozenCase.digest &&
            binding.methodId === method.id,
        ) ?? [],
    ),
  );
  return unwrap(
    await createExperimentManifest({
      prompt: M1B_PROMPT_CANDIDATE,
      protocol: M1B_PROMPT_PROTOCOL,
      cases,
      methods,
      transportSchemas,
      pricingSnapshot: original.pricingSnapshot,
      repetitions: original.repetitions,
      caps: input.caps ?? original.caps,
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
    storageNamespace: experimentStorageNamespace(
      phase,
      experiment.experimentDigest,
    ),
    runtimeVersions: value.manifest.runtimeVersions,
  });
}

async function immutablePartialProbe(): Promise<MaterializedPhase> {
  const current = unwrap(
    await materializeM1bPhase({
      phase: "transport-probe",
      gitCommit: IMMUTABLE_PARTIAL_PROBE.gitCommit,
      runtimeVersions: { ...RUNTIME_VERSIONS, node: "24.18.0" },
    }),
  );
  const campaignJson = unwrap(
    parseJson(
      await readFile(
        join(import.meta.dirname, "fixtures", "immutable-campaign.json"),
        "utf8",
      ),
    ),
  );
  const manifestJson = unwrap(
    parseJson(
      await readFile(
        join(import.meta.dirname, "fixtures", "immutable-partial-probe.json"),
        "utf8",
      ),
    ),
  );
  const campaign = campaignManifestSchema.parse(campaignJson);
  const manifest = phaseManifestSchema.parse(manifestJson);
  expect(campaign.campaignDigest).toBe(IMMUTABLE_PARTIAL_PROBE.campaignDigest);
  expect(manifest.experimentDigest).toBe(
    IMMUTABLE_PARTIAL_PROBE.experimentDigest,
  );
  expect(manifest.phaseManifestDigest).toBe(
    IMMUTABLE_PARTIAL_PROBE.phaseManifestDigest,
  );
  const digests = new Map(
    manifest.experiment.cases.map((item) => [item.id, item.caseDigest]),
  );
  return {
    campaign,
    manifest,
    cases: current.cases.map((item) => ({
      case: item.case,
      digest: required(digests.get(item.case.id), "Missing historical digest."),
    })),
  };
}

function fakeMethods(
  value: MaterializedPhase,
  calls: { value: number },
  dispatchEvidence:
    "not-dispatched" | "dispatched-usage-unknown" = "dispatched-usage-unknown",
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
            dispatchEvidence,
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

describe("M2 paired representation protocol", () => {
  it("uses an independent campaign and freezes the exact eight-call paired probe", async () => {
    expect(
      (
        await materializeM2Phase({
          phase: "smoke",
          gitCommit: "test-commit",
          runtimeVersions: RUNTIME_VERSIONS,
        })
      ).ok,
    ).toBe(false);
    const m1c = await materializedM1c("m1c-protocol-probe");
    const probe = await materializedM2("m2-protocol-probe");
    expect(validateM2PhaseCaps(m1c.manifest).ok).toBe(false);
    const missingPricing = required(
      probe.manifest.m2,
      "Missing M2 paired identity.",
    ).codeModeMethods.map((method, index) =>
      index === 0 ? { ...method, pricingEntryId: "missing/pricing" } : method,
    );
    expect(
      validateM2PhaseCaps({
        ...probe.manifest,
        m2: {
          ...required(probe.manifest.m2, "Missing M2 identity."),
          codeModeMethods: missingPricing,
        },
      }).ok,
    ).toBe(false);
    expect(probe.campaign.campaignDigest).not.toBe(m1c.campaign.campaignDigest);
    expect(probe.campaign).toMatchObject({
      milestone: "m2",
      campaignId:
        "lachesis-m2-functional-ir-vs-restricted-capability-typescript",
      maximumAuthorizedCostUsdMicros: 236_086_400,
      primaryComparison: {
        interpretation: "paired-representation-ablation",
      },
    });
    expect(probe.campaign.budgetPools).toEqual([
      {
        id: "m2-development",
        maxCostUsdMicros: 32_758_400,
        providerCostCaps: [
          { billingProvider: "openai", maxCostUsdMicros: 18_727_040 },
          { billingProvider: "anthropic", maxCostUsdMicros: 14_031_360 },
        ],
      },
      {
        id: "m2-heldout",
        maxCostUsdMicros: 203_328_000,
        providerCostCaps: [
          { billingProvider: "openai", maxCostUsdMicros: 116_236_800 },
          { billingProvider: "anthropic", maxCostUsdMicros: 87_091_200 },
        ],
      },
    ]);
    expect(probe.manifest).toMatchObject({
      formatVersion: "5",
      milestone: "m2",
      budgetPoolId: "m2-development",
      phase: "m2-protocol-probe",
    });
    expect(probe.manifest.m2).toBeDefined();
    expect(probe.manifest.experimentDigest).toBe(
      probe.manifest.m2?.pairedExperimentDigest,
    );
    expect(probe.manifest.experimentDigest).not.toBe(
      probe.manifest.experiment.experimentDigest,
    );
    expect(
      probe.cases.map((item) => item.case.expectedFeasibility).toSorted(),
    ).toEqual(["plannable", "unplannable"]);
    expect(probe.manifest.experiment.methods).toHaveLength(2);
    expect(probe.manifest.m2?.codeModeMethods).toHaveLength(2);
    expect(probe.manifest.m2?.codeModeTransportSchemas).toHaveLength(4);
    expect(probe.manifest.m2?.schedule.entries).toHaveLength(4);
    expect(matrixCounts(probe.manifest)).toEqual({
      benchmarkRecords: 8,
      initialModelCalls: 8,
      maximumAdditionalRepairCalls: 0,
      maximumModelCalls: 8,
    });
    expect(probe.manifest.experiment.caps).toEqual({
      maxCalls: 8,
      maxInputTokens: 512_000,
      maxOutputTokens: 65_536,
      maxTotalTokens: 577_536,
      maxOutputTokensPerCall: 8_192,
      maxCostUsdMicros: 2_259_200,
      providerCostCaps: [
        { billingProvider: "anthropic", maxCostUsdMicros: 967_680 },
        { billingProvider: "openai", maxCostUsdMicros: 1_291_520 },
      ],
    });
    expect(
      (
        await createPhaseManifest({
          campaign: probe.campaign,
          phase: "m2-protocol-probe",
          experiment: probe.manifest.experiment,
          corpusDigest: probe.manifest.corpusDigest,
          storageNamespace: probe.manifest.storageNamespace,
          runtimeVersions: RUNTIME_VERSIONS,
        })
      ).ok,
    ).toBe(false);
    const identity = required(probe.manifest.m2, "Missing M2 identity.");
    expect(
      (
        await createPhaseManifest({
          campaign: probe.campaign,
          phase: "m2-protocol-probe",
          experiment: probe.manifest.experiment,
          m2: {
            ...identity,
            schedule: {
              ...identity.schedule,
              entries: identity.schedule.entries.toReversed(),
            },
          },
          corpusDigest: probe.manifest.corpusDigest,
          storageNamespace: probe.manifest.storageNamespace,
          runtimeVersions: RUNTIME_VERSIONS,
        })
      ).ok,
    ).toBe(false);
  });

  it("freezes the expanded matrix, blind counts, and credential-free nonmutating dry run", async () => {
    expect(await blindM2HeldOutAudit()).toEqual({
      totalCases: 30,
      plannableCases: 24,
      unplannableCases: 6,
      referencesValid: 30,
      witnessesCompiled: 24,
      hiddenPropertiesPassed: 24,
      infeasibilityWitnessesPassed: 6,
      invalidCases: 0,
      loadValid: true,
      categories: {
        multiStep: 6,
        branch: 6,
        effect: 6,
        recursion: 6,
        infeasible: 6,
      },
      witnessKinds: {
        missingOperation: 2,
        deniedCapability: 2,
        insufficientBudget: 2,
      },
    });
    const calibration = await materializedM2("m2-calibration");
    expect(matrixCounts(calibration.manifest)).toEqual({
      benchmarkRecords: 36,
      initialModelCalls: 36,
      maximumAdditionalRepairCalls: 72,
      maximumModelCalls: 108,
    });
    expect(calibration.manifest.experiment.caps.maxCostUsdMicros).toBe(
      30_499_200,
    );
    const developmentPool = required(
      calibration.campaign.budgetPools.find(
        (pool) => pool.id === "m2-development",
      ),
      "Missing M2 development pool.",
    );
    expect(developmentPool.maxCostUsdMicros).toBe(
      calibration.manifest.experiment.caps.maxCostUsdMicros + 2_259_200,
    );
    for (const provider of ["openai", "anthropic"]) {
      const calibrationCap = required(
        calibration.manifest.experiment.caps.providerCostCaps.find(
          (cap) => cap.billingProvider === provider,
        ),
        "Missing M2 calibration provider cap.",
      ).maxCostUsdMicros;
      const probeCap = provider === "openai" ? 1_291_520 : 967_680;
      expect(
        developmentPool.providerCostCaps.find(
          (cap) => cap.billingProvider === provider,
        )?.maxCostUsdMicros,
      ).toBe(calibrationCap + probeCap);
    }
    const heldout = await materializedM2("m2-heldout");
    expect(matrixCounts(heldout.manifest)).toEqual({
      benchmarkRecords: 240,
      initialModelCalls: 240,
      maximumAdditionalRepairCalls: 480,
      maximumModelCalls: 720,
    });
    expect(heldout.manifest.experiment.caps.maxCostUsdMicros).toBe(203_328_000);
    expect(
      heldout.campaign.budgetPools.find((pool) => pool.id === "m2-heldout"),
    ).toEqual({
      id: "m2-heldout",
      maxCostUsdMicros: heldout.manifest.experiment.caps.maxCostUsdMicros,
      providerCostCaps: [
        { billingProvider: "openai", maxCostUsdMicros: 116_236_800 },
        { billingProvider: "anthropic", maxCostUsdMicros: 87_091_200 },
      ],
    });
    for (const provider of ["openai", "anthropic"]) {
      const entries = heldout.manifest.m2?.schedule.entries.filter(
        (entry) => entry.provider === provider,
      );
      expect(entries).toHaveLength(60);
      expect(
        entries?.filter((entry) => entry.order[0] === "functional-ir"),
      ).toHaveLength(30);
    }
    expect(
      heldout.manifest.m2?.schedule.entries.filter(
        (entry) => entry.order[0] === "functional-ir",
      ),
    ).toHaveLength(60);

    expect(
      calibration.manifest.m2?.schedule.entries.filter(
        (entry) => entry.order[0] === "functional-ir",
      ),
    ).toHaveLength(9);

    const repository = await initializeGitRepository();
    const probe = await materializedM2("m2-protocol-probe", repository.commit);
    const storage = await temporaryDirectory();
    const ledgerPath = join(storage, "ledger.ndjson");
    const preflight = unwrap(
      await preflightPhase({
        loaded: loaded(probe),
        ledgerPath,
        cwd: repository.path,
        environment: {},
        acknowledgement: undefined,
      }),
    );
    expect(preflight).toMatchObject({
      valid: true,
      liveExecutionPermitted: false,
      benchmarkRecords: 8,
      initialModelCalls: 8,
      maximumModelCalls: 8,
      checks: {
        manifest: true,
        corpus: true,
        cleanWorktree: true,
        commitMatches: true,
        credentialsPresent: false,
        acknowledgementMatches: false,
        executionPolicyAllowsExecution: true,
      },
    });
    expect(await readdir(storage)).toEqual([]);
  });

  it("executes the paired probe offline with fake adapters, reports it, and resumes without redispatch", async () => {
    const repository = await initializeGitRepository();
    const probe = await materializedM2("m2-protocol-probe", repository.commit);
    const resolver = unwrap(createM2CatalogResolver());
    const feasible = required(
      probe.cases.find((item) => item.case.expectedFeasibility === "plannable"),
      "Missing M2 probe feasible case.",
    );
    const unplannable = required(
      probe.cases.find(
        (item) => item.case.expectedFeasibility === "unplannable",
      ),
      "Missing M2 probe unplannable case.",
    );
    const catalog = unwrap(resolver(feasible.case.catalogId));
    const language = unwrap(
      await createPlanLanguageManifest(catalog, feasible.case.policy),
    );
    const plan = unwrap(createReferencePlanWitness(feasible, language));
    const witness = required(
      unplannable.case.infeasibilityWitness,
      "Missing M2 probe witness.",
    );
    const dispatches: Array<string> = [];
    const irMethods: ReadonlyArray<BenchmarkMethod> =
      probe.manifest.experiment.methods.map((method) => {
        const adapter: ModelAdapter = {
          identity: method.model,
          inference: method.inference,
          pricingEntryId: method.pricingEntryId,
          preflightStructuredOutput: () =>
            Promise.resolve({ ok: true, value: undefined }),
          generate: (request) => {
            dispatches.push("functional-ir");
            const outcome =
              request.originalTask === feasible.case.instruction
                ? { kind: "plan" as const, plan }
                : { kind: "unplannable" as const, witness };
            return Promise.resolve({
              ok: true,
              value: {
                rawResponse: JSON.stringify(outcome),
                structuredOutput: outcome,
                usage: {
                  inputTokens: 10,
                  outputTokens: 10,
                  costUsdMicros: 0,
                },
                latencyMs: 1,
                dispatchEvidence: "dispatched-with-usage",
              },
            });
          },
        };
        return { id: method.id, adapter, strategy: method.strategy };
      });
    const codeSource = `export default async function main(input, ops) {
  const selected = await ops.filter("nonnegative@1.0.0", input.items);
  const mapped = await ops.map("square@1.0.0", selected);
  return mapped;
}`;
    const codeMethods: ReadonlyArray<M2CodeModeMethod> = required(
      probe.manifest.m2,
      "Missing M2 paired identity.",
    ).codeModeMethods.map((method) => {
      const adapter: CodeModeModelAdapter = {
        identity: method.model,
        inference: method.inference,
        pricingEntryId: method.pricingEntryId,
        preflightStructuredOutput: () =>
          Promise.resolve({ ok: true, value: undefined }),
        generate: (request) => {
          dispatches.push("restricted-capability-typescript");
          const outcome =
            request.originalTask === feasible.case.instruction
              ? { kind: "program" as const, source: codeSource }
              : { kind: "unplannable" as const, witness };
          return Promise.resolve({
            ok: true,
            value: {
              rawResponse: JSON.stringify(outcome),
              structuredOutput: { outcome },
              usage: {
                inputTokens: 10,
                outputTokens: 10,
                costUsdMicros: 0,
              },
              latencyMs: 1,
              dispatchEvidence: "dispatched-with-usage",
            },
          });
        },
      };
      const pricing = required(
        probe.manifest.experiment.pricingSnapshot.entries.find(
          (entry) => entry.id === method.pricingEntryId,
        ),
        "Missing M2 fake pricing.",
      );
      return { id: method.id, adapter, strategy: method.strategy, pricing };
    });
    const storageRoot = await temporaryDirectory();
    const acknowledgement: LiveAcknowledgement = {
      experimentDigest: probe.manifest.experimentDigest,
      phase: "m2-protocol-probe",
      maximumCostUsdMicros: 32_758_400,
    };
    const input = {
      loaded: loaded(probe),
      storageRoot,
      cwd: repository.path,
      acknowledgement,
      environment: {
        OPENAI_API_KEY: "offline-test-value",
        ANTHROPIC_API_KEY: "offline-test-value",
      },
      methods: irMethods,
      m2CodeModeMethods: codeMethods,
    };
    const first = unwrap(await executePhase(input));
    expect(first).toMatchObject({ generated: 8, resumed: 0, records: 8 });
    expect(dispatches).toEqual(
      probe.manifest.m2?.schedule.entries.flatMap((entry) => entry.order),
    );
    const report = unwrap(
      await generateStoredReport({ loaded: loaded(probe), storageRoot }),
    );
    expect(report).toMatchObject({
      experimentDigest: probe.manifest.experimentDigest,
      records: {
        functionalIr: 4,
        restrictedCapabilityTypeScript: 4,
        matched: 4,
      },
      pairedAnalysis: {
        taskCorrectness: { bothSucceeded: 4 },
      },
    });
    const codeRecordPath = join(
      storageRoot,
      probe.campaign.campaignDigest,
      probe.manifest.storageNamespace,
      "restricted-capability-typescript-records.json",
    );
    const persistedCodeRecords = await readFile(codeRecordPath, "utf8");
    await writeFile(codeRecordPath, "[{}]\n", "utf8");
    expect(
      (await generateStoredReport({ loaded: loaded(probe), storageRoot })).ok,
    ).toBe(false);
    await writeFile(
      codeRecordPath,
      persistedCodeRecords.replace(/"digest":"[^"]+"/, '"digest":"tampered"'),
      "utf8",
    );
    expect(
      (await generateStoredReport({ loaded: loaded(probe), storageRoot })).ok,
    ).toBe(false);
    await rm(codeRecordPath);
    expect(
      (await generateStoredReport({ loaded: loaded(probe), storageRoot })).ok,
    ).toBe(false);
    await writeFile(codeRecordPath, persistedCodeRecords, "utf8");
    const second = unwrap(await executePhase(input));
    expect(second).toMatchObject({ generated: 0, resumed: 8, records: 8 });
    expect(dispatches).toHaveLength(8);
    const reconstructedResume = unwrap(
      await executePhase({
        loaded: input.loaded,
        storageRoot: input.storageRoot,
        cwd: input.cwd,
        acknowledgement: input.acknowledgement,
        environment: input.environment,
      }),
    );
    expect(reconstructedResume).toMatchObject({
      generated: 0,
      resumed: 8,
      records: 8,
    });
    expect(dispatches).toHaveLength(8);
  });

  it("rejects a lowered paired cap before ledger creation or dispatch", async () => {
    const repository = await initializeGitRepository();
    const probe = await materializedM2("m2-protocol-probe", repository.commit);
    const storageRoot = await temporaryDirectory();
    const lowered: MaterializedPhase = {
      ...probe,
      manifest: {
        ...probe.manifest,
        experiment: {
          ...probe.manifest.experiment,
          caps: { ...probe.manifest.experiment.caps, maxCalls: 7 },
        },
      },
    };
    const result = await executePhase({
      loaded: loaded(lowered),
      storageRoot,
      cwd: repository.path,
      acknowledgement: {
        experimentDigest: lowered.manifest.experimentDigest,
        phase: "m2-protocol-probe",
        maximumCostUsdMicros: 32_758_400,
      },
      environment: {
        OPENAI_API_KEY: "offline-test-value",
        ANTHROPIC_API_KEY: "offline-test-value",
      },
      methods: [],
      m2CodeModeMethods: [],
    });
    expect(result.ok).toBe(false);
    expect(await readdir(storageRoot)).toEqual([]);
  });

  it("fails closed on an unreconstructable paired adapter identity", async () => {
    const repository = await initializeGitRepository();
    const probe = await materializedM2("m2-protocol-probe", repository.commit);
    const identity = required(probe.manifest.m2, "Missing M2 identity.");
    const first = required(identity.codeModeMethods[0], "Missing M2 method.");
    const mutated: MaterializedPhase = {
      ...probe,
      manifest: {
        ...probe.manifest,
        m2: {
          ...identity,
          codeModeMethods: [
            {
              ...first,
              model: { ...first.model, adapterVersion: "invalid-adapter/1" },
            },
            ...identity.codeModeMethods.slice(1),
          ],
        },
      },
    };
    const result = await executePhase({
      loaded: loaded(mutated),
      storageRoot: await temporaryDirectory(),
      cwd: repository.path,
      acknowledgement: {
        experimentDigest: mutated.manifest.experimentDigest,
        phase: "m2-protocol-probe",
        maximumCostUsdMicros: 32_758_400,
      },
      environment: {
        OPENAI_API_KEY: "offline-test-value",
        ANTHROPIC_API_KEY: "offline-test-value",
      },
    });
    expect(result.ok).toBe(false);
  });

  it("fails closed when the paired split digest is absent", async () => {
    const repository = await initializeGitRepository();
    const probe = await materializedM2("m2-protocol-probe", repository.commit);
    const mutated: MaterializedPhase = {
      ...probe,
      manifest: {
        ...probe.manifest,
        experiment: {
          ...probe.manifest.experiment,
          splits: probe.manifest.experiment.splits.filter(
            (split) => split.id !== "development",
          ),
        },
      },
    };
    const result = await executePhase({
      loaded: loaded(mutated),
      storageRoot: await temporaryDirectory(),
      cwd: repository.path,
      acknowledgement: {
        experimentDigest: mutated.manifest.experimentDigest,
        phase: "m2-protocol-probe",
        maximumCostUsdMicros: 32_758_400,
      },
      environment: {
        OPENAI_API_KEY: "offline-test-value",
        ANTHROPIC_API_KEY: "offline-test-value",
      },
      methods: [],
      m2CodeModeMethods: [],
    });
    expect(result.ok).toBe(false);
  });
});

describe("M1c phase protocol", () => {
  it("fails closed on cross-milestone and incomplete M1c phase identities", async () => {
    expect(
      (
        await materializeM1cPhase({
          phase: "smoke",
          gitCommit: "test-commit",
          runtimeVersions: RUNTIME_VERSIONS,
        })
      ).ok,
    ).toBe(false);

    const calibration = await materializedM1c("m1c-calibration");
    expect(
      (
        await createPhaseManifest({
          campaign: calibration.campaign,
          phase: "m1c-calibration",
          experiment: calibration.manifest.experiment,
          corpusDigest: calibration.manifest.corpusDigest,
          storageNamespace: calibration.manifest.storageNamespace,
          runtimeVersions: { ...RUNTIME_VERSIONS, node: "" },
        })
      ).ok,
    ).toBe(false);
    const { milestone, ...withoutMilestone } = withoutPhaseDigest(
      calibration.manifest,
    );
    expect(milestone).toBe("m1c");
    const withoutMilestoneDigest = unwrap(await digestValue(withoutMilestone));
    expect(
      (
        await verifyPhaseManifest(
          {
            ...withoutMilestone,
            phaseManifestDigest: withoutMilestoneDigest,
          },
          calibration.campaign,
        )
      ).ok,
    ).toBe(false);

    const probe = await materializedM1c("m1c-protocol-probe");
    const oversizedProbe = await recreateExperiment({
      materialized: probe,
      caps: { ...probe.manifest.experiment.caps, maxCalls: 5 },
    });
    expect(
      (
        await createPhaseManifest({
          campaign: probe.campaign,
          phase: "m1c-protocol-probe",
          experiment: oversizedProbe,
          corpusDigest: probe.manifest.corpusDigest,
          storageNamespace: experimentStorageNamespace(
            "m1c-protocol-probe",
            oversizedProbe.experimentDigest,
          ),
          runtimeVersions: RUNTIME_VERSIONS,
        })
      ).ok,
    ).toBe(false);

    const repair = await materializedM1c("m1c-repair");
    const missingTrials = await recreateExperiment({ materialized: repair });
    expect(missingTrials.repairTrials).toBeUndefined();
    expect(
      (
        await createPhaseManifest({
          campaign: repair.campaign,
          phase: "m1c-repair",
          experiment: missingTrials,
          corpusDigest: repair.manifest.corpusDigest,
          storageNamespace: experimentStorageNamespace(
            "m1c-repair",
            missingTrials.experimentDigest,
          ),
          runtimeVersions: RUNTIME_VERSIONS,
        })
      ).ok,
    ).toBe(false);
  });

  it("uses a separate campaign and freezes the four-call two-branch probe", async () => {
    const m1b = await materialized("transport-probe");
    const probe = await materializedM1c("m1c-protocol-probe");
    expect(probe.campaign.campaignDigest).not.toBe(m1b.campaign.campaignDigest);
    expect(probe.campaign.milestone).toBe("m1c");
    expect(probe.campaign.budgetPools.map((pool) => pool.id)).toEqual([
      "m1c-development",
      "m1c-heldout",
    ]);
    expect(probe.campaign.maximumAuthorizedCostUsdMicros).toBe(90_000_000);
    expect(probe.campaign.budgetPools).toEqual([
      {
        id: "m1c-development",
        maxCostUsdMicros: 30_000_000,
        providerCostCaps: [
          { billingProvider: "openai", maxCostUsdMicros: 15_000_000 },
          { billingProvider: "anthropic", maxCostUsdMicros: 12_000_000 },
        ],
      },
      {
        id: "m1c-heldout",
        maxCostUsdMicros: 60_000_000,
        providerCostCaps: [
          { billingProvider: "openai", maxCostUsdMicros: 35_000_000 },
          { billingProvider: "anthropic", maxCostUsdMicros: 25_000_000 },
        ],
      },
    ]);
    expect(probe.manifest.formatVersion).toBe("4");
    expect(probe.manifest.budgetPoolId).toBe("m1c-development");
    expect(probe.manifest.experiment.cases).toHaveLength(2);
    expect(probe.manifest.experiment.methods).toHaveLength(2);
    expect(
      probe.cases.map((item) => item.case.expectedFeasibility).toSorted(),
    ).toEqual(["plannable", "unplannable"]);
    expect(matrixCounts(probe.manifest)).toEqual({
      benchmarkRecords: 4,
      initialModelCalls: 4,
      maximumAdditionalRepairCalls: 0,
      maximumModelCalls: 4,
    });
    expect(probe.manifest.experiment.caps).toEqual({
      maxCalls: 4,
      maxInputTokens: 256_000,
      maxOutputTokens: 32_768,
      maxTotalTokens: 288_768,
      maxOutputTokensPerCall: 8_192,
      maxCostUsdMicros: 1_129_600,
      providerCostCaps: [
        { billingProvider: "anthropic", maxCostUsdMicros: 483_840 },
        { billingProvider: "openai", maxCostUsdMicros: 645_760 },
      ],
    });
    expect(probe.manifest.storageNamespace).toBe(
      `m1c/protocol-probe/experiments/${probe.manifest.experimentDigest}`,
    );
  });

  it("persists shared deterministic repair trials and correct matrix outcomes", async () => {
    const repair = await materializedM1c("m1c-repair");
    expect(repair.cases).toHaveLength(4);
    expect(repair.repairTrials?.size).toBe(4);
    expect(repair.manifest.experiment.formatVersion).toBe("5");
    expect(repair.manifest.experiment.repairTrials).toHaveLength(4);
    for (const trial of repair.manifest.experiment.repairTrials ?? []) {
      expect(trial.initialProposalDigest).toBe(trial.arms.withoutRepair);
      expect(trial.initialProposalDigest).toBe(trial.arms.compilerGuidedRepair);
      expect(trial.mutation.kind).toBe("redirectRoot");
      expect(trial.eligibility).toBe("eligible");
    }
    expect(matrixCounts(repair.manifest)).toEqual({
      benchmarkRecords: 8,
      initialModelCalls: 0,
      maximumAdditionalRepairCalls: 16,
      maximumModelCalls: 16,
    });
    expect(repair.manifest.experiment.caps).toEqual({
      maxCalls: 16,
      maxInputTokens: 1_024_000,
      maxOutputTokens: 131_072,
      maxTotalTokens: 1_155_072,
      maxOutputTokensPerCall: 8_192,
      maxCostUsdMicros: 4_518_400,
      providerCostCaps: [
        { billingProvider: "anthropic", maxCostUsdMicros: 1_935_360 },
        { billingProvider: "openai", maxCostUsdMicros: 2_583_040 },
      ],
    });

    const calibration = await materializedM1c("m1c-calibration");
    expect(calibration.cases).toHaveLength(7);
    expect(matrixCounts(calibration.manifest)).toEqual({
      benchmarkRecords: 42,
      initialModelCalls: 42,
      maximumAdditionalRepairCalls: 28,
      maximumModelCalls: 70,
    });
    expect(calibration.manifest.experiment.caps.maxCostUsdMicros).toBe(
      19_768_000,
    );
    const heldout = await materializedM1c("m1c-heldout");
    expect(heldout.cases).toHaveLength(10);
    expect(matrixCounts(heldout.manifest)).toEqual({
      benchmarkRecords: 120,
      initialModelCalls: 120,
      maximumAdditionalRepairCalls: 80,
      maximumModelCalls: 200,
    });
    expect(heldout.manifest.experiment.caps).toEqual({
      maxCalls: 200,
      maxInputTokens: 12_800_000,
      maxOutputTokens: 1_638_400,
      maxTotalTokens: 14_438_400,
      maxOutputTokensPerCall: 8_192,
      maxCostUsdMicros: 56_480_000,
      providerCostCaps: [
        { billingProvider: "anthropic", maxCostUsdMicros: 24_192_000 },
        { billingProvider: "openai", maxCostUsdMicros: 32_288_000 },
      ],
    });
  });

  it("runs shared repair records only from the persisted matching proposal", async () => {
    const repository = await initializeGitRepository();
    const repair = await materializedM1c("m1c-repair", repository.commit);
    const resolver = unwrap(createM1aCatalogResolver());
    const references = new Map<string, unknown>();
    for (const frozenCase of repair.cases) {
      const catalog = unwrap(resolver(frozenCase.case.catalogId));
      const manifest = unwrap(
        await createPlanLanguageManifest(catalog, frozenCase.case.policy),
      );
      references.set(
        frozenCase.case.instruction,
        unwrap(createReferencePlanWitness(frozenCase, manifest)),
      );
    }
    const methods = createPrimaryMethods(repair.manifest, {
      OPENAI_API_KEY: "dummy-openai",
      ANTHROPIC_API_KEY: "dummy-anthropic",
    });
    let dispatches = 0;
    const fakeMethods = methods.map((method) => ({
      ...method,
      adapter: {
        ...method.adapter,
        generate: (request: Parameters<typeof method.adapter.generate>[0]) => {
          dispatches += 1;
          const plan = references.get(request.originalTask);
          if (plan === undefined) throw new Error("Missing reference repair.");
          return Promise.resolve({
            ok: true as const,
            value: {
              rawResponse: JSON.stringify({ kind: "plan", plan }),
              structuredOutput: { kind: "plan", plan },
              usage: {
                inputTokens: 1,
                outputTokens: 1,
                costUsdMicros: 0,
              },
              latencyMs: 1,
              dispatchEvidence: "dispatched-with-usage" as const,
            },
          });
        },
      },
    }));
    const result = unwrap(
      await runBenchmark({
        experiment: repair.manifest.experiment,
        cases: repair.cases,
        methods: fakeMethods,
        resolveCatalog: resolver,
        store: createInMemoryBenchmarkStore(),
        repairTrials: required(
          repair.repairTrials,
          "Missing repair trial bindings.",
        ),
      }),
    );
    expect(result.generated).toBe(8);
    expect(dispatches).toBe(8);
    expect(
      result.records.every(
        (record) =>
          record.repairTrial?.outcome === "repaired" &&
          record.repairTrial.initialProposalDigest ===
            record.repairTrial.arms.withoutRepair &&
          record.repairTrial.initialProposalDigest ===
            record.repairTrial.arms.compilerGuidedRepair,
      ),
    ).toBe(true);
    expect(
      result.records.every(
        (record) => record.generation.attempts[0]?.phase === "repair",
      ),
    ).toBe(true);
    const runtimeTrials = required(
      repair.repairTrials,
      "Missing repair trial bindings.",
    );
    const first = runtimeTrials.entries().next().value;
    if (first === undefined) throw new Error("Missing repair trial.");
    const [caseDigest, value] = first;
    const mismatched = new Map(runtimeTrials);
    mismatched.set(caseDigest, {
      ...value,
      trial: {
        ...value.trial,
        arms: {
          ...value.trial.arms,
          compilerGuidedRepair: "0".repeat(64),
        },
      },
    });
    const rejected = await runBenchmark({
      experiment: repair.manifest.experiment,
      cases: repair.cases,
      methods: fakeMethods,
      resolveCatalog: resolver,
      store: createInMemoryBenchmarkStore(),
      repairTrials: mismatched,
    });
    expect(rejected.ok).toBe(false);
    expect(dispatches).toBe(8);

    const storageRoot = await temporaryDirectory();
    const executed = unwrap(
      await executePhase({
        loaded: loaded(repair),
        storageRoot,
        cwd: repository.path,
        acknowledgement: {
          experimentDigest: repair.manifest.experimentDigest,
          phase: "m1c-repair",
          maximumCostUsdMicros: 30_000_000,
        },
        environment: {
          OPENAI_API_KEY: "dummy-openai",
          ANTHROPIC_API_KEY: "dummy-anthropic",
        },
        methods: fakeMethods,
      }),
    );
    expect(executed.generated).toBe(8);
    expect(dispatches).toBe(16);
    expect(
      unwrap(
        await generateStoredReport({ loaded: loaded(repair), storageRoot }),
      ),
    ).toMatchObject({
      phase: "m1c-repair",
      repairComparison: {
        rule: "same-initial-proposal-digest-only",
        matchedRecords: 8,
        unmatchedRecords: 0,
        eligible: 0,
        repaired: 8,
        failed: 0,
        repairUnnecessary: 0,
      },
    });
  });

  it("keeps the held-out audit counts-only with all witness variants valid", async () => {
    expect(unwrap(await blindM1cHeldOutIntegrityAudit())).toEqual({
      totalCases: 10,
      plannableCases: 7,
      unplannableCases: 3,
      referencesValid: 10,
      witnessesCompiled: 7,
      hiddenPropertiesPassed: 7,
      infeasibilityWitnessesPassed: 3,
      invalidCases: 0,
    });
  });
});

describe("M1b phase protocol", () => {
  it("reports blind held-out validity counts without fixture content", async () => {
    const audit = unwrap(await blindHeldOutIntegrityAudit());
    expect(audit).toEqual({
      totalCases: 17,
      plannableCases: 13,
      unplannableCases: 4,
      referencesValid: 17,
      witnessesCompiled: 13,
      hiddenPropertiesPassed: 13,
      infeasibilityWitnessesPassed: 4,
      invalidCases: 0,
    });
    expect(
      Object.values(audit).every((value) => typeof value === "number"),
    ).toBe(true);
  });

  it("freezes the exact probe, smoke, and held-out matrix counts", async () => {
    const probe = await materialized("transport-probe");
    const smoke = await materialized("smoke");
    const heldout = await materialized("heldout");

    expect(probe.manifest.experiment.cases).toHaveLength(1);
    expect(matrixCounts(probe.manifest)).toEqual({
      benchmarkRecords: 2,
      initialModelCalls: 2,
      maximumAdditionalRepairCalls: 0,
      maximumModelCalls: 2,
    });
    expect(probe.manifest.experiment.caps.maxCostUsdMicros).toBe(564_800);
    expect(probe.manifest.experiment.caps).toEqual({
      maxCalls: 2,
      maxInputTokens: 128_000,
      maxOutputTokens: 16_384,
      maxTotalTokens: 144_384,
      maxOutputTokensPerCall: 8_192,
      maxCostUsdMicros: 564_800,
      providerCostCaps: [
        { billingProvider: "anthropic", maxCostUsdMicros: 241_920 },
        { billingProvider: "openai", maxCostUsdMicros: 322_880 },
      ],
    });
    expect(probe.campaign.campaignDigest).toBe(smoke.campaign.campaignDigest);
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
    expect(smoke.campaign.campaignDigest).toBe(
      "d4f618dc57320f2d25ebdadedef43301d2b12d1e46339ca3b1ff90ecf9d55d39",
    );
    expect(smoke.manifest.formatVersion).toBe("3");
    expect(smoke.manifest.experiment.formatVersion).toBe("4");
    expect(smoke.manifest.storageNamespace).toBe(
      `m1b/smoke/experiments/${smoke.manifest.experimentDigest}`,
    );
  });

  it("derives probe caps from frozen pricing independent of method order", async () => {
    const probe = await materialized("transport-probe");
    const experiment = probe.manifest.experiment;
    const direct = unwrap(
      deriveTransportProbeCaps({
        methods: experiment.methods,
        pricingSnapshot: experiment.pricingSnapshot,
        caseCount: experiment.cases.length,
        repetitions: experiment.repetitions,
      }),
    );
    const reversed = unwrap(
      deriveTransportProbeCaps({
        methods: experiment.methods.toReversed(),
        pricingSnapshot: experiment.pricingSnapshot,
        caseCount: experiment.cases.length,
        repetitions: experiment.repetitions,
      }),
    );
    expect(reversed).toEqual(direct);

    const changedPricing = unwrap(
      await createPricingSnapshot({
        capturedAt: experiment.pricingSnapshot.capturedAt,
        entries: experiment.pricingSnapshot.entries.map((entry) =>
          entry.billingProvider === "openai"
            ? {
                ...entry,
                cacheWriteInputUsdMicrosPerMillionTokens:
                  entry.cacheWriteInputUsdMicrosPerMillionTokens + 1_000_000,
              }
            : entry,
        ),
      }),
    );
    const changed = unwrap(
      deriveTransportProbeCaps({
        methods: experiment.methods,
        pricingSnapshot: changedPricing,
        caseCount: experiment.cases.length,
        repetitions: experiment.repetitions,
      }),
    );
    expect(changed.providerCostCaps).toEqual([
      { billingProvider: "anthropic", maxCostUsdMicros: 241_920 },
      { billingProvider: "openai", maxCostUsdMicros: 386_880 },
    ]);
    expect(changed.maxCostUsdMicros).toBe(628_800);
  });

  it("rejects a materialized probe with any lowered derived provider cap", async () => {
    const probe = await materialized("transport-probe");
    const caps = probe.manifest.experiment.caps;
    const lowered: ExperimentCaps = {
      ...caps,
      providerCostCaps: caps.providerCostCaps.map((cap) =>
        cap.billingProvider === "openai"
          ? { ...cap, maxCostUsdMicros: cap.maxCostUsdMicros - 1 }
          : cap,
      ),
    };
    expect(
      validateTransportProbeCaps({
        ...probe.manifest.experiment,
        caps: lowered,
      }).ok,
    ).toBe(false);
  });

  it("fails closed on incomplete or unsafe probe cap inputs", async () => {
    const probe = await materialized("transport-probe");
    const experiment = probe.manifest.experiment;
    expect(
      deriveTransportProbeCaps({
        methods: [],
        pricingSnapshot: experiment.pricingSnapshot,
        caseCount: experiment.cases.length,
        repetitions: experiment.repetitions,
      }).ok,
    ).toBe(false);
    const firstMethod = experiment.methods[0];
    if (firstMethod === undefined) throw new Error("Missing probe method.");
    expect(
      deriveTransportProbeCaps({
        methods: [{ ...firstMethod, pricingEntryId: "missing-pricing" }],
        pricingSnapshot: experiment.pricingSnapshot,
        caseCount: experiment.cases.length,
        repetitions: experiment.repetitions,
      }).ok,
    ).toBe(false);
    expect(
      deriveTransportProbeCaps({
        methods: [
          {
            ...firstMethod,
            inference: {
              ...firstMethod.inference,
              maxInputTokens: Number.MAX_SAFE_INTEGER,
            },
          },
        ],
        pricingSnapshot: experiment.pricingSnapshot,
        caseCount: 2,
        repetitions: 1,
      }).ok,
    ).toBe(false);
  });

  it("gives each experiment a collision-resistant namespace in the shared campaign", async () => {
    const first = await materialized("smoke", "commit-one");
    const second = await materialized("smoke", "commit-two");

    expect(first.campaign.campaignDigest).toBe(second.campaign.campaignDigest);
    expect(first.manifest.experimentDigest).not.toBe(
      second.manifest.experimentDigest,
    );
    expect(first.manifest.phaseManifestDigest).not.toBe(
      second.manifest.phaseManifestDigest,
    );
    expect(first.manifest.storageNamespace).not.toBe(
      second.manifest.storageNamespace,
    );
    expect(first.manifest.storageNamespace).toContain(
      first.manifest.experimentDigest,
    );

    const namespaceBody = {
      ...withoutPhaseDigest(first.manifest),
      storageNamespace: "m1b/smoke/experiments/wrong",
    };
    const namespaceDigest = unwrap(await digestValue(namespaceBody));
    expect(
      (
        await verifyPhaseManifest(
          { ...namespaceBody, phaseManifestDigest: namespaceDigest },
          first.campaign,
        )
      ).ok,
    ).toBe(false);
  });

  it("pre-registers a development-only calibration set across all catalogs and operator classes", async () => {
    const calibration = await materialized("calibration");
    expect(M1B_PROMPT_CANDIDATE.amendment).toEqual({
      classification: "non-discretionary-protocol-correction",
      supersedesInvalidCalibration:
        "ca742c6d0c8a4245ec06472870dcacb43fb7e1af15e53f5f00ea5814732b2e95",
      heldOutAccessOccurred: false,
      rationale:
        "Corrects model/runtime authority and benchmark-validity defects discovered in development calibration; it is not a fourth discretionary prompt candidate.",
    });
    expect(calibration.manifest.experiment.promptDigest).toBe(
      unwrap(await digestValue(M1B_PROMPT_CANDIDATE)),
    );
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
    const truncatedHeldout = await recreateExperiment({
      materialized: heldout,
      caseBindings: [{ index: 0, split: "heldout-catalog" }],
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
    expect(
      (await phaseWithExperiment(heldout, truncatedHeldout, "heldout")).ok,
    ).toBe(false);
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
    const wrongTransportMethods = methods.with(anthropicIndex, {
      ...anthropic,
      inference: {
        ...anthropic.inference,
        structuredOutputTransport: "openai-responses-portable-json-schema",
      },
    });

    for (const candidate of [
      bedrockMethods,
      wrongModelMethods,
      wrongReasoningMethods,
      wrongTransportMethods,
    ]) {
      const experiment = await recreateExperiment({
        materialized: heldout,
        methods: candidate,
      });
      expect((await phaseWithExperiment(heldout, experiment)).ok).toBe(false);
    }

    const phaseBody = withoutPhaseDigest(heldout.manifest);
    const legacyFailurePolicyBody = {
      ...phaseBody,
      failurePolicy: {
        transport: "record-and-continue",
        providerAutomaticRetries: 0,
        storedProviderFailureOnResume: "do-not-retry",
        selectiveSemanticReruns: "prohibited",
        compilerGuidedRepairLimit: 2,
        timeoutMs: phaseBody.failurePolicy.timeoutMs,
      } satisfies PhaseManifest["failurePolicy"],
    };
    const legacyFailurePolicyDigest = unwrap(
      await digestValue(legacyFailurePolicyBody),
    );
    expect(
      (
        await verifyPhaseManifest(
          {
            ...legacyFailurePolicyBody,
            phaseManifestDigest: legacyFailurePolicyDigest,
          },
          heldout.campaign,
        )
      ).ok,
    ).toBe(false);
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

  it("keeps the immutable partial probe report-only without touching its state", async () => {
    const historical = await immutablePartialProbe();
    const storageRoot = await temporaryDirectory();
    const manifestDirectory = await temporaryDirectory();
    const campaignPath = join(manifestDirectory, "campaign.json");
    const phasePath = join(manifestDirectory, "transport-probe.json");
    await writeFile(
      campaignPath,
      `${JSON.stringify(historical.campaign)}\n`,
      "utf8",
    );
    await writeFile(
      phasePath,
      `${JSON.stringify(historical.manifest)}\n`,
      "utf8",
    );
    const historicalLoaded = unwrap(
      await loadPhaseFiles({ campaignPath, phasePath }),
    );
    expect(historicalLoaded.executionPolicy).toBe("report-only");

    const base = join(storageRoot, historical.campaign.campaignDigest);
    const ledgerPath = join(base, "ledger.ndjson");
    const recordPath = join(
      base,
      historical.manifest.storageNamespace,
      "records.json",
    );
    unwrap(
      await openCampaignLedger({
        path: ledgerPath,
        campaign: historical.campaign,
      }),
    );
    await mkdir(join(base, historical.manifest.storageNamespace), {
      recursive: true,
    });
    await writeFile(
      recordPath,
      await readFile(
        join(
          import.meta.dirname,
          "fixtures",
          "immutable-partial-probe-records.json",
        ),
        "utf8",
      ),
      "utf8",
    );
    const report = unwrap(
      await generateStoredReport({ loaded: historicalLoaded, storageRoot }),
    );
    expect(report).toMatchObject({
      experimentDigest: IMMUTABLE_PARTIAL_PROBE.experimentDigest,
      records: 1,
    });

    const ledgerBefore = await readFile(ledgerPath, "utf8");
    const recordsBefore = await readFile(recordPath, "utf8");
    const blockedCalls = { value: 0 };
    const acknowledgement: LiveAcknowledgement = {
      experimentDigest: IMMUTABLE_PARTIAL_PROBE.experimentDigest,
      phase: "transport-probe",
      maximumCostUsdMicros: 10_000_000,
    };
    for (const environment of [
      {},
      {
        OPENAI_API_KEY: "offline-dummy",
        ANTHROPIC_API_KEY: "offline-dummy",
      },
    ]) {
      const blocked = await executePhase({
        loaded: historicalLoaded,
        storageRoot,
        cwd: process.cwd(),
        environment,
        acknowledgement,
        methods: fakeMethods(historical, blockedCalls),
      });
      expect(blocked.ok).toBe(false);
      expect(diagnosticMessage(blocked)).toContain("report-only");
    }
    expect(blockedCalls.value).toBe(0);
    expect(await readFile(ledgerPath, "utf8")).toBe(ledgerBefore);
    expect(await readFile(recordPath, "utf8")).toBe(recordsBefore);
  });

  it("preserves the completed M1b.4.1 calibration as report-only", async () => {
    const storageRoot = await temporaryDirectory();
    const manifestDirectory = await temporaryDirectory();
    const campaignPath = join(manifestDirectory, "campaign.json");
    const phasePath = join(manifestDirectory, "calibration.json");
    await writeFile(
      campaignPath,
      await readFile(
        join(import.meta.dirname, "fixtures", "immutable-campaign.json"),
        "utf8",
      ),
      "utf8",
    );
    await writeFile(
      phasePath,
      await readFile(
        join(import.meta.dirname, "fixtures", "immutable-calibration.json"),
        "utf8",
      ),
      "utf8",
    );
    const historical = unwrap(
      await loadPhaseFiles({ campaignPath, phasePath }),
    );
    expect(historical.executionPolicy).toBe("report-only");
    const calls = { value: 0 };
    const blocked = await executePhase({
      loaded: historical,
      storageRoot,
      cwd: process.cwd(),
      environment: {
        OPENAI_API_KEY: "offline-dummy",
        ANTHROPIC_API_KEY: "offline-dummy",
      },
      acknowledgement: {
        experimentDigest:
          "ca742c6d0c8a4245ec06472870dcacb43fb7e1af15e53f5f00ea5814732b2e95",
        phase: "calibration",
        maximumCostUsdMicros: 10_000_000,
      },
      methods: fakeMethods(historical.materialized, calls),
    });
    expect(blocked.ok).toBe(false);
    expect(diagnosticMessage(blocked)).toContain("report-only");
    expect(calls.value).toBe(0);
    expect(await readdir(storageRoot)).toEqual([]);
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

  it("accepts complete worst-case reservations for both probe methods", async () => {
    const repository = await initializeGitRepository();
    const probe = await materialized("transport-probe", repository.commit);
    const calls = { value: 0 };
    const reservations: Array<string> = [];
    const result = unwrap(
      await executePhase({
        loaded: loaded(probe),
        storageRoot: await temporaryDirectory(),
        cwd: repository.path,
        environment: {
          OPENAI_API_KEY: "offline-dummy",
          ANTHROPIC_API_KEY: "offline-dummy",
        },
        acknowledgement: {
          experimentDigest: probe.manifest.experimentDigest,
          phase: "transport-probe",
          maximumCostUsdMicros: 10_000_000,
        },
        methods: fakeMethods(probe, calls),
        onReservation: (_, provider) => {
          reservations.push(provider);
        },
      }),
    );
    expect(result).toMatchObject({ generated: 2, resumed: 0, records: 2 });
    expect(calls.value).toBe(2);
    expect(reservations).toEqual(["anthropic", "openai"]);
    expect(result.budget).toMatchObject({
      consumedUsdMicros: 564_800,
      unsettledReservationUsdMicros: 0,
    });
  });

  it("rejects invalid probe caps before dispatch or ledger mutation", async () => {
    const probe = await materialized("transport-probe");
    const storageRoot = await temporaryDirectory();
    const calls = { value: 0 };
    const caps = probe.manifest.experiment.caps;
    const invalidExperiment = {
      ...probe.manifest.experiment,
      caps: {
        ...caps,
        providerCostCaps: caps.providerCostCaps.map((cap) =>
          cap.billingProvider === "openai"
            ? { ...cap, maxCostUsdMicros: cap.maxCostUsdMicros - 1 }
            : cap,
        ),
      },
    };
    const invalidPhase = { ...probe.manifest, experiment: invalidExperiment };
    const result = await executePhase({
      loaded: {
        ...loaded(probe),
        phase: invalidPhase,
        materialized: {
          ...probe,
          manifest: invalidPhase,
        },
      },
      storageRoot,
      cwd: process.cwd(),
      environment: {
        OPENAI_API_KEY: "offline-dummy",
        ANTHROPIC_API_KEY: "offline-dummy",
      },
      acknowledgement: {
        experimentDigest: probe.manifest.experimentDigest,
        phase: "transport-probe",
        maximumCostUsdMicros: 10_000_000,
      },
      methods: fakeMethods(probe, calls),
    });
    expect(result.ok).toBe(false);
    expect(calls.value).toBe(0);
    expect(await readdir(storageRoot)).toEqual([]);
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
          accountingBasis: "provider-reported",
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
          accountingBasis: "authorized-conservative",
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
      authorizedConservativeUsdMicros: 24_000_000,
      unsettledReservationUsdMicros: 25_000_000,
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
      accountingBasis: "provider-reported",
    } satisfies BenchmarkBudgetSettlement;
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
  it("settles pre-dispatch adapter failures at zero cost and zero tokens", async () => {
    const smoke = await materialized("smoke");
    const path = join(await temporaryDirectory(), "ledger.ndjson");
    const ledger = unwrap(
      await openCampaignLedger({ path, campaign: smoke.campaign }),
    );
    const calls = { value: 0 };
    const result = unwrap(
      await runBenchmark({
        experiment: smoke.manifest.experiment,
        cases: smoke.cases,
        methods: fakeMethods(smoke, calls, "not-dispatched"),
        resolveCatalog: unwrap(createM1aCatalogResolver()),
        store: createInMemoryBenchmarkStore(),
        budgetController: ledger.budgetController(smoke.manifest),
      }),
    );

    expect(result.generated).toBe(12);
    expect(calls.value).toBe(12);
    expect(
      result.records.every(
        (record) =>
          record.generation.totalCostUsdMicros === 0 &&
          record.generation.totalInputTokens === 0 &&
          record.generation.totalOutputTokens === 0,
      ),
    ).toBe(true);
    expect(ledger.status("m1b-development")).toMatchObject({
      consumedUsdMicros: 0,
      observedProviderBillingUsdMicros: 0,
      authorizedConservativeUsdMicros: 0,
      notDispatchedSettlements: 12,
    });
  });

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

    const resumeOnlyCalls = { value: 0 };
    const resumeOnly = unwrap(
      await executePhase({
        loaded: { ...loaded(smoke), executionPolicy: "completed-records-only" },
        storageRoot,
        cwd: process.cwd(),
        acknowledgement: {
          experimentDigest: smoke.manifest.experimentDigest,
          phase: "smoke",
          maximumCostUsdMicros: 10_000_000,
        },
        environment: {
          OPENAI_API_KEY: "offline-dummy",
          ANTHROPIC_API_KEY: "offline-dummy",
        },
        methods: fakeMethods(smoke, resumeOnlyCalls),
      }),
    );
    expect(resumeOnly).toMatchObject({
      resumed: 12,
      generated: 0,
      records: 12,
    });
    expect(resumeOnlyCalls.value).toBe(0);

    const completeRecords = await readFile(recordPath, "utf8");
    await writeFile(
      recordPath,
      `${JSON.stringify(first.records.slice(0, -1))}\n`,
      "utf8",
    );
    expect(
      (
        await executePhase({
          loaded: {
            ...loaded(smoke),
            executionPolicy: "completed-records-only",
          },
          storageRoot,
          cwd: process.cwd(),
          acknowledgement: {
            experimentDigest: smoke.manifest.experimentDigest,
            phase: "smoke",
            maximumCostUsdMicros: 10_000_000,
          },
          environment: {
            OPENAI_API_KEY: "offline-dummy",
            ANTHROPIC_API_KEY: "offline-dummy",
          },
          methods: fakeMethods(smoke, resumeOnlyCalls),
        })
      ).ok,
    ).toBe(false);
    expect(resumeOnlyCalls.value).toBe(0);
    await writeFile(recordPath, completeRecords, "utf8");

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
