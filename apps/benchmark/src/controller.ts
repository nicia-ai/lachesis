import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  type Diagnostic,
  diagnostic,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import {
  type BenchmarkCaseRecord,
  benchmarkCaseRecordSchema,
  type BenchmarkMethod,
  createM1aCatalogResolver,
  createM2CatalogResolver,
  evaluateM2PairedStatistics,
  evaluateResearchGates,
  type M2CodeModeMethod,
  m2CodeModeRecordSchema,
  matchM2PairedRecords,
  runBenchmark,
  runM2PairedBenchmark,
  summarizeBenchmark,
  verifyExperimentManifest,
} from "@nicia-ai/lachesis-generator";
import {
  createJsonFileBenchmarkStore,
  createJsonFileM2CodeModeStore,
} from "@nicia-ai/lachesis-generator/node";
import {
  createM1bPrimaryAdapters,
  createM2CodeModePrimaryAdapters,
} from "@nicia-ai/lachesis-generator-ai-sdk";
import { z } from "zod";

import {
  acquireCampaignLock,
  type BudgetPoolStatus,
  inspectCampaignLedger,
  openCampaignLedger,
} from "./ledger.js";
import {
  type MaterializedPhase,
  materializeM1bPhase,
  materializeM1cPhase,
  materializeM2Phase,
  matrixCounts,
  validateM2PhaseCaps,
  validateTransportProbeCaps,
} from "./manifests.js";
import {
  type CampaignManifest,
  campaignManifestSchema,
  type CampaignPhase,
  type PhaseManifest,
  phaseManifestSchema,
  verifyCampaignManifest,
  verifyPhaseManifest,
} from "./protocol.js";

const execFileAsync = promisify(execFile);
const persistedRecordsSchema = z.array(benchmarkCaseRecordSchema).readonly();
const persistedM2CodeModeRecordsSchema = z
  .array(m2CodeModeRecordSchema)
  .readonly();

export type LiveAcknowledgement = Readonly<{
  experimentDigest: string;
  phase: CampaignPhase;
  maximumCostUsdMicros: number;
}>;

export type PreflightReport = Readonly<{
  valid: boolean;
  campaignId: string;
  campaignDigest: string;
  phaseManifestDigest: string;
  experimentDigest: string;
  phase: CampaignPhase;
  caseCountsBySplit: ReadonlyArray<Readonly<{ split: string; count: number }>>;
  methods: PhaseManifest["experiment"]["methods"];
  codeModeMethods:
    NonNullable<PhaseManifest["m2"]>["codeModeMethods"] | undefined;
  scheduleDigest: string | null;
  analysisPlanDigest: string | null;
  providers: ReadonlyArray<string>;
  repetitions: number;
  benchmarkRecords: number;
  initialModelCalls: number;
  maximumAdditionalRepairCalls: number;
  maximumModelCalls: number;
  promptDigest: string;
  protocolDigest: string;
  pricingSnapshotDigest: string;
  corpusDigest: string;
  scorer: PhaseManifest["scorer"];
  theoreticalExperimentCaps: PhaseManifest["experiment"]["caps"];
  authorizationPolicy: CampaignManifest["authorizationPolicy"];
  budgetPool: BudgetPoolStatus;
  expectedCapabilities: ReadonlyArray<string>;
  checks: Readonly<{
    manifest: boolean;
    corpus: boolean;
    cleanWorktree: boolean;
    commitMatches: boolean;
    credentialsPresent: boolean;
    acknowledgementMatches: boolean;
    executionPolicyAllowsExecution: boolean;
  }>;
  missingCredentialNames: ReadonlyArray<string>;
  liveExecutionPermitted: boolean;
}>;

export type LoadedPhase = Readonly<{
  campaign: CampaignManifest;
  phase: PhaseManifest;
  materialized: MaterializedPhase;
  executionPolicy: "live" | "completed-records-only" | "report-only";
}>;

const IMMUTABLE_EXPERIMENT_IDENTITIES = Object.freeze([
  Object.freeze({
    campaignDigest:
      "d4f618dc57320f2d25ebdadedef43301d2b12d1e46339ca3b1ff90ecf9d55d39",
    experimentDigest:
      "723b08db9b8a627e423bdf785eaa8b4d4c349171c0aaaa5072eb549db4224a98",
    phaseManifestDigest:
      "b64ec5405841923bc683fcba0da861509ec8bcea5ab5d4359216d4650e5fb198",
    phase: "smoke" as const,
    executionPolicy: "completed-records-only" as const,
  }),
  Object.freeze({
    campaignDigest:
      "d4f618dc57320f2d25ebdadedef43301d2b12d1e46339ca3b1ff90ecf9d55d39",
    experimentDigest:
      "2fe30988638aba282955cbeb94c19c41f41ab224a0c5794ffe9c37343a27ce6d",
    phaseManifestDigest:
      "7dc8660c02cbda0c58b0339f2c660456af4e3057f6d29b3f81600a63bd5b7352",
    phase: "smoke" as const,
    executionPolicy: "completed-records-only" as const,
  }),
  Object.freeze({
    campaignDigest:
      "d4f618dc57320f2d25ebdadedef43301d2b12d1e46339ca3b1ff90ecf9d55d39",
    experimentDigest:
      "9b3abca99a1f90926631d8216827eba47348045e0cb343b77a0e37f51781e431",
    phaseManifestDigest:
      "37feb76ee3959218d715695d47c7ee5a4de8b9d5d2de7542dc285c9aca6f59e5",
    phase: "transport-probe" as const,
    executionPolicy: "report-only" as const,
  }),
  Object.freeze({
    campaignDigest:
      "d4f618dc57320f2d25ebdadedef43301d2b12d1e46339ca3b1ff90ecf9d55d39",
    experimentDigest:
      "ca742c6d0c8a4245ec06472870dcacb43fb7e1af15e53f5f00ea5814732b2e95",
    phaseManifestDigest:
      "ae455e81b940c55c1fa317789d419ff5582c1bbea2caa43f91767df3fd9b27bd",
    phase: "calibration" as const,
    executionPolicy: "report-only" as const,
  }),
  Object.freeze({
    campaignDigest:
      "918ae344d9f52bbd97d683e18c7decf678046e8f75ce21b3a6274dc9916f5b14",
    experimentDigest:
      "0a8c35b940f269bf6006e2811dfb8716e3d6fe11c98668963f8ccedb17f4bb56",
    phaseManifestDigest:
      "d4100414bd42712d980a62db130c21891a8504f2199f15d9d270f12d4b641747",
    phase: "m2-protocol-probe" as const,
    executionPolicy: "report-only" as const,
  }),
  Object.freeze({
    campaignDigest:
      "918ae344d9f52bbd97d683e18c7decf678046e8f75ce21b3a6274dc9916f5b14",
    experimentDigest:
      "79bf9900e25c3129db90476da6e6f3a989bfc6e7a0ca6794e9a91a3d15aab28c",
    phaseManifestDigest:
      "5a43c109619a82003abb7fb7a46bf1a87caead52a0114b7c8d1b21be76f0cf91",
    phase: "m2-calibration" as const,
    executionPolicy: "report-only" as const,
  }),
  Object.freeze({
    campaignDigest:
      "918ae344d9f52bbd97d683e18c7decf678046e8f75ce21b3a6274dc9916f5b14",
    experimentDigest:
      "98e7da38be47b220198a5ab6d2907f3d203134f0d57f9006845b576bd2b2a2eb",
    phaseManifestDigest:
      "cf857f08bc4fe7eb488afd162043abaf8c1f1eff1734bc0930a7d481f472cc8e",
    phase: "m2-heldout" as const,
    executionPolicy: "report-only" as const,
  }),
]);

export function immutableExecutionPolicy(
  campaign: CampaignManifest,
  phase: PhaseManifest,
): LoadedPhase["executionPolicy"] | undefined {
  return IMMUTABLE_EXPERIMENT_IDENTITIES.find(
    (identity) =>
      campaign.campaignDigest === identity.campaignDigest &&
      phase.experimentDigest === identity.experimentDigest &&
      phase.phaseManifestDigest === identity.phaseManifestDigest &&
      phase.phase === identity.phase,
  )?.executionPolicy;
}

async function verifyImmutablePhaseManifest(
  phase: PhaseManifest,
  campaign: CampaignManifest,
): Promise<Result<PhaseManifest, ReadonlyArray<Diagnostic>>> {
  const experiment = await verifyExperimentManifest(phase.experiment);
  if (!experiment.ok) return experiment;
  const { phaseManifestDigest, ...body } = phase;
  const digest = await digestValue(body);
  if (!digest.ok) return { ok: false, error: [digest.error] };
  if (
    digest.value !== phaseManifestDigest ||
    phase.campaignDigest !== campaign.campaignDigest ||
    phase.campaignId !== campaign.campaignId ||
    phase.repetitions !== experiment.value.repetitions
  )
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Immutable historical phase failed its own content, campaign, experiment, or repetition identity.",
        ),
      ],
    };
  return { ok: true, value: phase };
}

async function readJson(path: string): Promise<Result<unknown, Diagnostic>> {
  try {
    const text = await readFile(path, "utf8");
    return parseJson(text);
  } catch (error: unknown) {
    return {
      ok: false,
      error: diagnostic(
        "MALFORMED_JSON",
        `Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}.`,
      ),
    };
  }
}

export async function loadPhaseFiles(
  input: Readonly<{
    campaignPath: string;
    phasePath: string;
  }>,
): Promise<Result<LoadedPhase, ReadonlyArray<Diagnostic>>> {
  const [campaignJson, phaseJson] = await Promise.all([
    readJson(input.campaignPath),
    readJson(input.phasePath),
  ]);
  if (!campaignJson.ok) return { ok: false, error: [campaignJson.error] };
  if (!phaseJson.ok) return { ok: false, error: [phaseJson.error] };
  const parsedCampaign = campaignManifestSchema.safeParse(campaignJson.value);
  const parsedPhase = phaseManifestSchema.safeParse(phaseJson.value);
  if (!parsedCampaign.success || !parsedPhase.success) {
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Campaign or phase manifest does not match its versioned schema.",
        ),
      ],
    };
  }
  const campaign = await verifyCampaignManifest(parsedCampaign.data);
  if (!campaign.ok) return campaign;
  const immutablePolicy = immutableExecutionPolicy(
    campaign.value,
    parsedPhase.data,
  );
  const phase =
    immutablePolicy === undefined
      ? await verifyPhaseManifest(parsedPhase.data, campaign.value)
      : await verifyImmutablePhaseManifest(parsedPhase.data, campaign.value);
  if (!phase.ok) return phase;
  if (
    (phase.value.phase === "transport-probe" ||
      phase.value.phase === "m1c-protocol-probe") &&
    immutablePolicy !== "report-only"
  ) {
    const caps = validateTransportProbeCaps(phase.value.experiment);
    if (!caps.ok) return caps;
  }
  if (phase.value.phase.startsWith("m2-")) {
    const caps = validateM2PhaseCaps(phase.value);
    if (!caps.ok) return caps;
  }
  const materializer = phase.value.phase.startsWith("m2-")
    ? materializeM2Phase
    : phase.value.phase.startsWith("m1c-")
      ? materializeM1cPhase
      : materializeM1bPhase;
  const materialized = await materializer({
    phase: phase.value.phase,
    gitCommit: phase.value.experiment.versions.gitCommit,
    runtimeVersions: phase.value.runtimeVersions,
  });
  if (!materialized.ok) return materialized;
  if (
    materialized.value.manifest.phaseManifestDigest !==
    phase.value.phaseManifestDigest
  ) {
    if (immutablePolicy !== undefined) {
      const caseDigests = new Map(
        phase.value.experiment.cases.map((item) => [item.id, item.caseDigest]),
      );
      const cases = materialized.value.cases.flatMap((item) => {
        const digest = caseDigests.get(item.case.id);
        return digest === undefined ? [] : [{ case: item.case, digest }];
      });
      if (cases.length === phase.value.experiment.cases.length) {
        return {
          ok: true,
          value: {
            campaign: campaign.value,
            phase: phase.value,
            materialized: {
              campaign: campaign.value,
              manifest: phase.value,
              cases,
            },
            executionPolicy: immutablePolicy,
          },
        };
      }
    }
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Phase manifest does not match the current frozen corpus, prompt, protocol, pricing, scorer, or runtime specification.",
        ),
      ],
    };
  }
  return {
    ok: true,
    value: {
      campaign: campaign.value,
      phase: phase.value,
      materialized: materialized.value,
      executionPolicy: "live",
    },
  };
}

function recordsCompleteForManifest(
  records: ReadonlyArray<BenchmarkCaseRecord>,
  phase: PhaseManifest,
): boolean {
  const expected = new Set<string>();
  for (const benchmarkCase of phase.experiment.cases) {
    for (const method of phase.experiment.methods) {
      for (let repetition = 0; repetition < phase.repetitions; repetition += 1)
        expected.add(
          `${benchmarkCase.id}\u0000${method.id}\u0000${repetition}`,
        );
    }
  }
  const actual = new Set(
    records.map(
      (record) =>
        `${record.caseId}\u0000${record.methodId}\u0000${record.repetition}`,
    ),
  );
  return (
    records.length === expected.size &&
    actual.size === expected.size &&
    [...expected].every((key) => actual.has(key))
  );
}

async function gitState(cwd: string): Promise<
  Result<
    Readonly<{
      commit: string;
      clean: boolean;
    }>,
    Diagnostic
  >
> {
  try {
    const [commit, status] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd }),
      execFileAsync(
        "git",
        ["status", "--porcelain", "--untracked-files=normal"],
        { cwd },
      ),
    ]);
    return {
      ok: true,
      value: {
        commit: commit.stdout.trim(),
        clean: status.stdout.trim().length === 0,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: diagnostic(
        "INTERNAL_INVARIANT_VIOLATION",
        `Unable to inspect Git state: ${error instanceof Error ? error.message : String(error)}.`,
      ),
    };
  }
}

function credentialCheck(
  phase: PhaseManifest,
  environment: NodeJS.ProcessEnv,
): Readonly<{ present: boolean; missing: ReadonlyArray<string> }> {
  const providers = new Set(
    phase.experiment.methods.map((method) => method.model.provider),
  );
  const required = [
    ...(providers.has("openai") ? ["OPENAI_API_KEY"] : []),
    ...(providers.has("anthropic") ? ["ANTHROPIC_API_KEY"] : []),
  ];
  const missing = required.filter((name) => {
    const value = environment[name];
    return value === undefined || value.length === 0;
  });
  return { present: missing.length === 0, missing };
}

function acknowledged(
  phase: PhaseManifest,
  campaign: CampaignManifest,
  acknowledgement: LiveAcknowledgement | undefined,
): boolean {
  const pool = campaign.budgetPools.find(
    (item) => item.id === phase.budgetPoolId,
  );
  return (
    acknowledgement?.experimentDigest === phase.experimentDigest &&
    acknowledgement.phase === phase.phase &&
    acknowledgement.maximumCostUsdMicros === pool?.maxCostUsdMicros
  );
}

export async function preflightPhase(
  input: Readonly<{
    loaded: LoadedPhase;
    ledgerPath: string;
    cwd: string;
    environment?: NodeJS.ProcessEnv | undefined;
    acknowledgement?: LiveAcknowledgement | undefined;
  }>,
): Promise<Result<PreflightReport, Diagnostic>> {
  const git = await gitState(input.cwd);
  if (!git.ok) return git;
  const statuses = await inspectCampaignLedger({
    path: input.ledgerPath,
    campaign: input.loaded.campaign,
  });
  if (!statuses.ok) return statuses;
  const pool = statuses.value.find(
    (item) => item.id === input.loaded.phase.budgetPoolId,
  );
  if (pool === undefined) {
    return {
      ok: false,
      error: diagnostic(
        "INTERNAL_INVARIANT_VIOLATION",
        "Campaign budget pool is missing.",
      ),
    };
  }
  const credentials = credentialCheck(
    input.loaded.phase,
    input.environment ?? process.env,
  );
  const counts = matrixCounts(input.loaded.phase);
  const gitBound =
    input.loaded.phase.phase.startsWith("m1c-") ||
    input.loaded.phase.phase.startsWith("m2-") ||
    input.loaded.phase.phase === "heldout" ||
    input.loaded.phase.phase === "transport-probe";
  const cleanWorktree = !gitBound || git.value.clean;
  const commitMatches =
    !gitBound ||
    git.value.commit === input.loaded.phase.experiment.versions.gitCommit;
  const acknowledgementMatches = acknowledged(
    input.loaded.phase,
    input.loaded.campaign,
    input.acknowledgement,
  );
  const checks = {
    manifest: true,
    corpus: true,
    cleanWorktree,
    commitMatches,
    credentialsPresent: credentials.present,
    acknowledgementMatches,
    executionPolicyAllowsExecution:
      input.loaded.executionPolicy !== "report-only",
  };
  const splitCounts = new Map<string, number>();
  for (const item of input.loaded.phase.experiment.cases) {
    splitCounts.set(item.split, (splitCounts.get(item.split) ?? 0) + 1);
  }
  return {
    ok: true,
    value: {
      valid: true,
      campaignId: input.loaded.campaign.campaignId,
      campaignDigest: input.loaded.campaign.campaignDigest,
      phaseManifestDigest: input.loaded.phase.phaseManifestDigest,
      experimentDigest: input.loaded.phase.experimentDigest,
      phase: input.loaded.phase.phase,
      caseCountsBySplit: [...splitCounts.entries()].map(([split, count]) => ({
        split,
        count,
      })),
      methods: input.loaded.phase.experiment.methods,
      codeModeMethods: input.loaded.phase.m2?.codeModeMethods,
      scheduleDigest: input.loaded.phase.m2?.schedule.scheduleDigest ?? null,
      analysisPlanDigest: input.loaded.phase.m2?.analysisPlanDigest ?? null,
      providers: [
        ...new Set(
          input.loaded.phase.experiment.methods.map(
            (method) => method.model.provider,
          ),
        ),
      ].toSorted(),
      repetitions: input.loaded.phase.repetitions,
      ...counts,
      promptDigest: input.loaded.phase.experiment.promptDigest,
      protocolDigest: input.loaded.phase.experiment.protocolDigest,
      pricingSnapshotDigest:
        input.loaded.phase.experiment.pricingSnapshot.digest,
      corpusDigest: input.loaded.phase.corpusDigest,
      scorer: input.loaded.phase.scorer,
      theoreticalExperimentCaps: input.loaded.phase.experiment.caps,
      authorizationPolicy: input.loaded.campaign.authorizationPolicy,
      budgetPool: pool,
      expectedCapabilities: [
        ...new Set(
          input.loaded.materialized.cases.flatMap(
            (item) => item.case.policy.allowedCapabilities,
          ),
        ),
      ].toSorted(),
      checks,
      missingCredentialNames: credentials.missing,
      liveExecutionPermitted: Object.values(checks).every(Boolean),
    },
  };
}

export function createPrimaryMethods(
  phase: PhaseManifest,
  environment: NodeJS.ProcessEnv,
): ReadonlyArray<BenchmarkMethod> {
  const openaiKey = environment["OPENAI_API_KEY"];
  const anthropicKey = environment["ANTHROPIC_API_KEY"];
  return phase.experiment.methods.map((method) => {
    const adapters = createM1bPrimaryAdapters({
      constraint: method.strategy.constraint,
      ...(openaiKey === undefined ? {} : { openai: { apiKey: openaiKey } }),
      ...(anthropicKey === undefined
        ? {}
        : { anthropic: { apiKey: anthropicKey } }),
    });
    return {
      id: method.id,
      adapter:
        method.model.provider === "openai"
          ? adapters.openai
          : adapters.anthropic,
      strategy: method.strategy,
    };
  });
}

function createM2CodeModeMethods(
  phase: PhaseManifest,
  environment: NodeJS.ProcessEnv,
): Result<ReadonlyArray<M2CodeModeMethod>, Diagnostic> {
  if (phase.m2 === undefined)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M2 execution requires its paired method identity.",
      ),
    };
  const openaiKey = environment["OPENAI_API_KEY"];
  const anthropicKey = environment["ANTHROPIC_API_KEY"];
  const methods: Array<M2CodeModeMethod> = [];
  for (const method of phase.m2.codeModeMethods) {
    const adapters = createM2CodeModePrimaryAdapters({
      constraint: method.strategy.constraint,
      ...(openaiKey === undefined ? {} : { openai: { apiKey: openaiKey } }),
      ...(anthropicKey === undefined
        ? {}
        : { anthropic: { apiKey: anthropicKey } }),
    });
    const adapter =
      method.model.provider === "openai"
        ? adapters.openai
        : method.model.provider === "anthropic"
          ? adapters.anthropic
          : undefined;
    const pricing = phase.experiment.pricingSnapshot.entries.find(
      (entry) => entry.id === method.pricingEntryId,
    );
    if (
      adapter === undefined ||
      pricing === undefined ||
      adapter.identity.provider !== method.model.provider ||
      adapter.identity.model !== method.model.model ||
      adapter.identity.adapterVersion !== method.model.adapterVersion
    )
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          `M2 method ${method.id} cannot be reconstructed from its frozen provider and pricing identity.`,
        ),
      };
    methods.push({
      id: method.id,
      adapter,
      strategy: method.strategy,
      pricing,
    });
  }
  return { ok: true, value: Object.freeze(methods) };
}

export async function executePhase(
  input: Readonly<{
    loaded: LoadedPhase;
    storageRoot: string;
    cwd: string;
    acknowledgement: LiveAcknowledgement | undefined;
    environment?: NodeJS.ProcessEnv | undefined;
    methods?: ReadonlyArray<BenchmarkMethod> | undefined;
    m2CodeModeMethods?: ReadonlyArray<M2CodeModeMethod> | undefined;
    onReservation?:
      ((status: BudgetPoolStatus, provider: string) => void) | undefined;
  }>,
): Promise<
  Result<
    Readonly<{
      resumed: number;
      generated: number;
      records: number;
      budget: BudgetPoolStatus;
    }>,
    Diagnostic
  >
> {
  if (input.loaded.executionPolicy === "report-only")
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "This immutable historical experiment is report-only and can never execute or resume.",
      ),
    };
  if (
    input.loaded.phase.phase === "transport-probe" ||
    input.loaded.phase.phase === "m1c-protocol-probe"
  ) {
    const caps = validateTransportProbeCaps(input.loaded.phase.experiment);
    if (!caps.ok)
      return {
        ok: false,
        error:
          caps.error[0] ??
          diagnostic(
            "INVALID_WIRE_SCHEMA",
            "Transport-probe cap validation failed.",
          ),
      };
  }
  if (input.loaded.phase.phase.startsWith("m2-")) {
    const caps = validateM2PhaseCaps(input.loaded.phase);
    if (!caps.ok)
      return {
        ok: false,
        error:
          caps.error[0] ??
          diagnostic("INVALID_WIRE_SCHEMA", "M2 cap validation failed."),
      };
  }
  const ledgerPath = join(
    input.storageRoot,
    input.loaded.campaign.campaignDigest,
    "ledger.ndjson",
  );
  const lock = await acquireCampaignLock(ledgerPath);
  if (!lock.ok) return lock;
  try {
    const preflight = await preflightPhase({
      loaded: input.loaded,
      ledgerPath,
      cwd: input.cwd,
      environment: input.environment,
      acknowledgement: input.acknowledgement,
    });
    if (!preflight.ok) return preflight;
    if (!preflight.value.liveExecutionPermitted) {
      return {
        ok: false,
        error: diagnostic(
          "BUDGET_EXCEEDED",
          "Live execution preflight failed: exact acknowledgement, credentials, Git state, or manifest binding is not satisfied.",
        ),
      };
    }
    const ledger = await openCampaignLedger({
      path: ledgerPath,
      campaign: input.loaded.campaign,
    });
    if (!ledger.ok) return ledger;
    const registered = await ledger.value.registerManifest(input.loaded.phase);
    if (!registered.ok) return registered;
    const recordPath = join(
      input.storageRoot,
      input.loaded.campaign.campaignDigest,
      input.loaded.phase.storageNamespace,
      "records.json",
    );
    const store = await createJsonFileBenchmarkStore(recordPath);
    if (!store.ok) return store;
    if (input.loaded.executionPolicy === "completed-records-only") {
      const stored = await loadRecords(
        recordPath,
        input.loaded.phase.experimentDigest,
      );
      if (!stored.ok) return stored;
      if (!recordsCompleteForManifest(stored.value, input.loaded.phase)) {
        return {
          ok: false,
          error: diagnostic(
            "INVALID_WIRE_SCHEMA",
            "An immutable completed-records-only experiment can resume only when every preregistered record is already complete.",
          ),
        };
      }
      return {
        ok: true,
        value: {
          resumed: stored.value.length,
          generated: 0,
          records: stored.value.length,
          budget: ledger.value.status(input.loaded.phase.budgetPoolId),
        },
      };
    }
    const environment = input.environment ?? process.env;
    if (input.loaded.phase.m2 !== undefined) {
      const resolver = createM2CatalogResolver();
      if (!resolver.ok)
        return {
          ok: false,
          error:
            resolver.error[0] ??
            diagnostic(
              "INTERNAL_INVARIANT_VIOLATION",
              "M2 catalog resolver could not be created.",
            ),
        };
      const codeModeMethods =
        input.m2CodeModeMethods === undefined
          ? createM2CodeModeMethods(input.loaded.phase, environment)
          : { ok: true as const, value: input.m2CodeModeMethods };
      if (!codeModeMethods.ok) return codeModeMethods;
      const codeModeStore = await createJsonFileM2CodeModeStore(
        join(
          input.storageRoot,
          input.loaded.campaign.campaignDigest,
          input.loaded.phase.storageNamespace,
          "restricted-capability-typescript-records.json",
        ),
      );
      if (!codeModeStore.ok) return codeModeStore;
      const split =
        input.loaded.phase.phase === "m2-heldout"
          ? ("heldout" as const)
          : ("development" as const);
      const experimentSplit = input.loaded.phase.experiment.splits.find(
        (item) =>
          item.id ===
          (split === "heldout" ? "heldout-phrasing" : "development"),
      );
      if (experimentSplit === undefined)
        return {
          ok: false,
          error: diagnostic(
            "INVALID_WIRE_SCHEMA",
            "M2 experiment is missing its selected split digest.",
          ),
        };
      const result = await runM2PairedBenchmark({
        experimentDigest: input.loaded.phase.experimentDigest,
        irExperiment: input.loaded.phase.experiment,
        split,
        splitDigest: experimentSplit.digest,
        cases: input.loaded.materialized.cases,
        repetitions: input.loaded.phase.repetitions,
        schedule: input.loaded.phase.m2.schedule,
        irMethods:
          input.methods ??
          createPrimaryMethods(input.loaded.phase, environment),
        codeModeMethods: codeModeMethods.value,
        resolveCatalog: resolver.value,
        irStore: store.value,
        codeModeStore: codeModeStore.value,
        budgetController: ledger.value.budgetController(
          input.loaded.phase,
          input.onReservation,
        ),
      });
      if (!result.ok) return result;
      return {
        ok: true,
        value: {
          resumed:
            result.value.functionalIr.resumed + result.value.codeMode.resumed,
          generated:
            result.value.functionalIr.generated +
            result.value.codeMode.generated,
          records: result.value.matched.length * 2,
          budget: ledger.value.status(input.loaded.phase.budgetPoolId),
        },
      };
    }
    const catalogResolver = createM1aCatalogResolver();
    if (!catalogResolver.ok) {
      return {
        ok: false,
        error:
          catalogResolver.error[0] ??
          diagnostic(
            "INTERNAL_INVARIANT_VIOLATION",
            "M1a catalog resolver could not be created.",
          ),
      };
    }
    const result = await runBenchmark({
      experiment: input.loaded.phase.experiment,
      cases: input.loaded.materialized.cases,
      methods:
        input.methods ?? createPrimaryMethods(input.loaded.phase, environment),
      resolveCatalog: catalogResolver.value,
      store: store.value,
      budgetController: ledger.value.budgetController(
        input.loaded.phase,
        input.onReservation,
      ),
      ...(input.loaded.materialized.repairTrials === undefined
        ? {}
        : { repairTrials: input.loaded.materialized.repairTrials }),
    });
    if (!result.ok) return result;
    return {
      ok: true,
      value: {
        resumed: result.value.resumed,
        generated: result.value.generated,
        records: result.value.records.length,
        budget: ledger.value.status(input.loaded.phase.budgetPoolId),
      },
    };
  } finally {
    await lock.value.release();
  }
}

async function loadRecords(
  path: string,
  experimentDigest: string,
): Promise<Result<ReadonlyArray<BenchmarkCaseRecord>, Diagnostic>> {
  const json = await readJson(path);
  if (!json.ok) return json;
  const parsed = persistedRecordsSchema.safeParse(json.value);
  if (!parsed.success) {
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Stored benchmark records have an invalid schema.",
      ),
    };
  }
  for (const record of parsed.data) {
    const { digest, ...body } = record;
    const computed = await digestValue(body);
    if (!computed.ok) return computed;
    if (
      computed.value !== digest ||
      record.experimentDigest !== experimentDigest
    ) {
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Stored benchmark record failed its digest or experiment binding.",
        ),
      };
    }
  }
  return { ok: true, value: parsed.data };
}

async function loadM2CodeModeRecords(
  path: string,
  experimentDigest: string,
): Promise<
  Result<ReadonlyArray<z.infer<typeof m2CodeModeRecordSchema>>, Diagnostic>
> {
  const json = await readJson(path);
  if (!json.ok) return json;
  const parsed = persistedM2CodeModeRecordsSchema.safeParse(json.value);
  if (!parsed.success)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Stored restricted-TypeScript records have an invalid schema.",
      ),
    };
  for (const record of parsed.data) {
    const { digest, ...body } = record;
    const computed = await digestValue(body);
    if (!computed.ok) return computed;
    if (
      computed.value !== digest ||
      record.experimentDigest !== experimentDigest
    )
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Stored restricted-TypeScript record failed its digest or paired experiment binding.",
        ),
      };
  }
  return { ok: true, value: parsed.data };
}

function pairCoverage(
  records: ReadonlyArray<BenchmarkCaseRecord>,
  provider: string,
  left: string,
  right: string,
): Readonly<{ completePairs: number; incompletePairs: number }> {
  const relevant = records.filter(
    (record) => record.model.provider === provider,
  );
  const keys = new Map<string, Set<string>>();
  for (const record of relevant) {
    const key = `${record.caseDigest}/${record.repetition}`;
    const values = keys.get(key) ?? new Set<string>();
    values.add(record.strategy.id);
    keys.set(key, values);
  }
  const completePairs = [...keys.values()].filter(
    (strategies) => strategies.has(left) && strategies.has(right),
  ).length;
  return { completePairs, incompletePairs: keys.size - completePairs };
}

export async function generateStoredReport(
  input: Readonly<{
    loaded: LoadedPhase;
    storageRoot: string;
  }>,
): Promise<Result<unknown, Diagnostic>> {
  const base = join(input.storageRoot, input.loaded.campaign.campaignDigest);
  const recordPath = join(
    base,
    input.loaded.phase.storageNamespace,
    "records.json",
  );
  if (input.loaded.phase.m2 !== undefined) {
    const functionalIr = await loadRecords(
      recordPath,
      input.loaded.phase.experiment.experimentDigest,
    );
    if (!functionalIr.ok) return functionalIr;
    const codeMode = await loadM2CodeModeRecords(
      join(
        base,
        input.loaded.phase.storageNamespace,
        "restricted-capability-typescript-records.json",
      ),
      input.loaded.phase.experimentDigest,
    );
    if (!codeMode.ok) return codeMode;
    const matched = await matchM2PairedRecords({
      functionalIr: functionalIr.value,
      codeMode: codeMode.value,
      schedule: input.loaded.phase.m2.schedule,
    });
    if (!matched.ok) return matched;
    const statistics = await evaluateM2PairedStatistics(matched.value);
    if (!statistics.ok) return statistics;
    const budgets = await inspectCampaignLedger({
      path: join(base, "ledger.ndjson"),
      campaign: input.loaded.campaign,
    });
    if (!budgets.ok) return budgets;
    return {
      ok: true,
      value: {
        campaignDigest: input.loaded.campaign.campaignDigest,
        phaseManifestDigest: input.loaded.phase.phaseManifestDigest,
        experimentDigest: input.loaded.phase.experimentDigest,
        functionalIrExperimentDigest:
          input.loaded.phase.experiment.experimentDigest,
        phase: input.loaded.phase.phase,
        interpretation:
          "Paired functional JSON IR versus restricted capability-oriented TypeScript representation ablation; conventional CodeMode is not evaluated.",
        scheduleDigest: input.loaded.phase.m2.schedule.scheduleDigest,
        records: {
          functionalIr: functionalIr.value.length,
          restrictedCapabilityTypeScript: codeMode.value.length,
          matched: matched.value.length,
        },
        functionalIr: summarizeBenchmark(functionalIr.value),
        restrictedCapabilityTypeScript: {
          parseTranspileSuccess: codeMode.value.filter(
            (record) => record.score.parseTranspileSuccess,
          ).length,
          firstCompilationSuccess: codeMode.value.filter(
            (record) => record.score.firstCompilationSuccess,
          ).length,
          finalCompilationSuccess: codeMode.value.filter(
            (record) => record.score.finalCompilationSuccess,
          ).length,
          semanticSuccess: codeMode.value.filter(
            (record) => record.score.semanticSuccess === true,
          ).length,
          correctTypedAbstention: codeMode.value.filter(
            (record) => record.score.correctTypedAbstention,
          ).length,
          runtimeExceptions: codeMode.value.reduce(
            (total, record) => total + record.score.runtimeExceptions,
            0,
          ),
          timeouts: codeMode.value.reduce(
            (total, record) => total + record.score.timeouts,
            0,
          ),
          capabilityViolations: codeMode.value.reduce(
            (total, record) => total + record.score.capabilityViolations,
            0,
          ),
          repairCalls: codeMode.value.reduce(
            (total, record) => total + record.score.repairCalls,
            0,
          ),
        },
        pairedAnalysis: statistics.value,
        budgets: budgets.value,
        claimBoundary: {
          conventionalCodeMode: "not-evaluated-not-claimed",
          typeGraph: "deferred",
        },
      },
    };
  }
  const records = await loadRecords(
    recordPath,
    input.loaded.phase.experimentDigest,
  );
  if (!records.ok) return records;
  const budgets = await inspectCampaignLedger({
    path: join(base, "ledger.ndjson"),
    campaign: input.loaded.campaign,
  });
  if (!budgets.ok) return budgets;
  const repairRecords = records.value.filter(
    (record) => record.repairTrial !== undefined,
  );
  const mismatchedRepairArms = repairRecords.filter((record) => {
    const trial = record.repairTrial;
    return (
      trial !== undefined &&
      (trial.initialProposalDigest !== trial.arms.withoutRepair ||
        trial.initialProposalDigest !== trial.arms.compilerGuidedRepair)
    );
  });
  if (
    input.loaded.phase.phase === "m1c-repair" &&
    mismatchedRepairArms.length > 0
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "M1c repair records contain unmatched initial-proposal digests.",
      ),
    };
  const groups = input.loaded.phase.experiment.methods.map((method) => {
    const selected = records.value.filter(
      (record) => record.methodId === method.id,
    );
    return {
      methodId: method.id,
      provider: method.model.provider,
      model: method.model.model,
      inference: method.inference,
      strategy: method.strategy.id,
      summary: summarizeBenchmark(selected),
      invalidProviderResponses: selected
        .flatMap((record) => record.generation.attempts)
        .filter((attempt) => attempt.responseKind === "invalidOutput").length,
      providerFailures: selected
        .flatMap((record) => record.generation.attempts)
        .filter(
          (attempt) => attempt.adapterFailure?.code === "PROVIDER_FAILURE",
        ).length,
      providerTimeouts: selected
        .flatMap((record) => record.generation.attempts)
        .filter(
          (attempt) => attempt.adapterFailure?.code === "PROVIDER_TIMEOUT",
        ).length,
      dispatchEvidence: {
        notDispatched: selected
          .flatMap((record) => record.generation.attempts)
          .filter(
            (attempt) =>
              attempt.dispatchEvidence === "not-dispatched" ||
              attempt.adapterFailure?.dispatchEvidence === "not-dispatched",
          ).length,
        dispatchedWithUsage: selected
          .flatMap((record) => record.generation.attempts)
          .filter(
            (attempt) =>
              attempt.dispatchEvidence === "dispatched-with-usage" ||
              attempt.adapterFailure?.dispatchEvidence ===
                "dispatched-with-usage",
          ).length,
        dispatchedUsageUnknown: selected
          .flatMap((record) => record.generation.attempts)
          .filter(
            (attempt) =>
              attempt.dispatchEvidence === "dispatched-usage-unknown" ||
              attempt.adapterFailure?.dispatchEvidence ===
                "dispatched-usage-unknown",
          ).length,
      },
    };
  });
  const providers = [
    ...new Set(records.value.map((record) => record.model.provider)),
  ];
  return {
    ok: true,
    value: {
      campaignDigest: input.loaded.campaign.campaignDigest,
      phaseManifestDigest: input.loaded.phase.phaseManifestDigest,
      experimentDigest: input.loaded.phase.experimentDigest,
      phase: input.loaded.phase.phase,
      interpretation:
        "Within-provider matched constraint and repair effects are primary; cross-provider values are descriptive only.",
      accountingInterpretation:
        "Observed provider billing is reconstructed from provider-reported usage. Authorized conservative accounting is a campaign charge used only when a dispatched request has no usable provider usage; not-dispatched failures settle at zero.",
      records: records.value.length,
      methods: groups,
      repairComparison:
        input.loaded.phase.phase === "m1c-repair"
          ? {
              rule: "same-initial-proposal-digest-only",
              matchedRecords: repairRecords.length,
              unmatchedRecords: mismatchedRepairArms.length,
              eligible: repairRecords.filter(
                (record) => record.repairTrial?.outcome === "eligible",
              ).length,
              repaired: repairRecords.filter(
                (record) => record.repairTrial?.outcome === "repaired",
              ).length,
              failed: repairRecords.filter(
                (record) => record.repairTrial?.outcome === "failed",
              ).length,
              repairUnnecessary: repairRecords.filter(
                (record) =>
                  record.repairTrial?.outcome === "repair-unnecessary",
              ).length,
            }
          : null,
      matchedComparisons: providers.flatMap((provider) => [
        {
          provider,
          comparison: "unconstrained-json -> json-schema",
          ...pairCoverage(
            records.value,
            provider,
            "unconstrained-json",
            "json-schema",
          ),
        },
        {
          provider,
          comparison: "json-schema -> json-schema-with-repair",
          ...pairCoverage(
            records.value,
            provider,
            "json-schema",
            "json-schema-with-repair",
          ),
        },
      ]),
      researchGates: evaluateResearchGates(records.value),
      budgets: budgets.value,
    },
  };
}
