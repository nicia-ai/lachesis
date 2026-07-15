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
  evaluateResearchGates,
  runBenchmark,
  summarizeBenchmark,
} from "@nicia-ai/lachesis-generator";
import { createJsonFileBenchmarkStore } from "@nicia-ai/lachesis-generator/node";
import { createM1bPrimaryAdapters } from "@nicia-ai/lachesis-generator-ai-sdk";
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
  matrixCounts,
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
  budgetPool: BudgetPoolStatus;
  expectedCapabilities: ReadonlyArray<string>;
  checks: Readonly<{
    manifest: boolean;
    corpus: boolean;
    cleanWorktree: boolean;
    commitMatches: boolean;
    credentialsPresent: boolean;
    acknowledgementMatches: boolean;
  }>;
  missingCredentialNames: ReadonlyArray<string>;
  liveExecutionPermitted: boolean;
}>;

export type LoadedPhase = Readonly<{
  campaign: CampaignManifest;
  phase: PhaseManifest;
  materialized: MaterializedPhase;
  resumeOnly: boolean;
}>;

const IMMUTABLE_SMOKE_IDENTITIES = Object.freeze([
  Object.freeze({
    campaignDigest:
      "d4f618dc57320f2d25ebdadedef43301d2b12d1e46339ca3b1ff90ecf9d55d39",
    experimentDigest:
      "723b08db9b8a627e423bdf785eaa8b4d4c349171c0aaaa5072eb549db4224a98",
    phaseManifestDigest:
      "b64ec5405841923bc683fcba0da861509ec8bcea5ab5d4359216d4650e5fb198",
  }),
  Object.freeze({
    campaignDigest:
      "d4f618dc57320f2d25ebdadedef43301d2b12d1e46339ca3b1ff90ecf9d55d39",
    experimentDigest:
      "2fe30988638aba282955cbeb94c19c41f41ab224a0c5794ffe9c37343a27ce6d",
    phaseManifestDigest:
      "7dc8660c02cbda0c58b0339f2c660456af4e3057f6d29b3f81600a63bd5b7352",
  }),
]);

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
  const phase = await verifyPhaseManifest(parsedPhase.data, campaign.value);
  if (!phase.ok) return phase;
  const materialized = await materializeM1bPhase({
    phase: phase.value.phase,
    gitCommit: phase.value.experiment.versions.gitCommit,
    runtimeVersions: phase.value.runtimeVersions,
  });
  if (!materialized.ok) return materialized;
  if (
    materialized.value.manifest.phaseManifestDigest !==
    phase.value.phaseManifestDigest
  ) {
    const immutableSmoke = IMMUTABLE_SMOKE_IDENTITIES.some(
      (identity) =>
        campaign.value.campaignDigest === identity.campaignDigest &&
        phase.value.experimentDigest === identity.experimentDigest &&
        phase.value.phaseManifestDigest === identity.phaseManifestDigest,
    );
    if (immutableSmoke && phase.value.phase === "smoke") {
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
            resumeOnly: true,
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
      resumeOnly: false,
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

export async function executePhase(
  input: Readonly<{
    loaded: LoadedPhase;
    storageRoot: string;
    cwd: string;
    acknowledgement: LiveAcknowledgement | undefined;
    environment?: NodeJS.ProcessEnv | undefined;
    methods?: ReadonlyArray<BenchmarkMethod> | undefined;
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
    if (input.loaded.resumeOnly) {
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
            "The immutable original smoke can only be resumed when every preregistered record is already complete.",
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
