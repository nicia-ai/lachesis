import { type Diagnostics, digestValue, type Result } from "@nicia-ai/lachesis";
import {
  createExperimentManifest,
  type ExperimentCaps,
  type ExperimentMethodInput,
  freezePlanGenerationCase,
  type FrozenPlanGenerationCase,
  loadM1aCorpus,
  M1A_GENERATION_STRATEGIES,
  partitionM1aCorpus,
} from "@nicia-ai/lachesis-generator";
import {
  createM1bPricingSnapshot,
  createM1bPrimaryAdapters,
  M1B_PILOT_CAPS,
  M1B_PROMPT_PROTOCOL,
} from "@nicia-ai/lachesis-generator-ai-sdk";

import {
  type CampaignManifest,
  type CampaignPhase,
  createCampaignManifest,
  createPhaseManifest,
  type PhaseManifest,
} from "./protocol.js";

const DEVELOPMENT_CAPS: ExperimentCaps = Object.freeze({
  maxCalls: 200,
  maxInputTokens: 2_000_000,
  maxOutputTokens: 500_000,
  maxTotalTokens: 2_500_000,
  maxOutputTokensPerCall: 8_192,
  maxCostUsdMicros: 10_000_000,
  providerCostCaps: Object.freeze([
    Object.freeze({
      billingProvider: "openai",
      maxCostUsdMicros: 10_000_000,
    }),
    Object.freeze({
      billingProvider: "anthropic",
      maxCostUsdMicros: 10_000_000,
    }),
  ]),
});

const SMOKE_CAPS: ExperimentCaps = Object.freeze({
  ...DEVELOPMENT_CAPS,
  maxCalls: 20,
});

export const M1B_PROMPT_CANDIDATE = Object.freeze({
  id: "lachesis-m1b-plan-generator",
  version: "development-candidate-1",
  instruction:
    "Propose only registered Lachesis operators and schemas. Return the requested GenerationOutcome contract; use unplannable only when the supplied manifest and policy cannot satisfy the task.",
});

export type MaterializedPhase = Readonly<{
  campaign: CampaignManifest;
  manifest: PhaseManifest;
  cases: ReadonlyArray<FrozenPlanGenerationCase>;
}>;

export type RuntimeVersions = PhaseManifest["runtimeVersions"];

const DEFAULT_BUDGET = Object.freeze({
  maxEffectCalls: 16,
  maxCollectionItems: 128,
  maxRecursionDepth: 16,
  maxTokens: 4096,
  maxWallClockMs: 5000,
  maxParallelism: 8,
});

async function calibrationWorkflowCase(): Promise<
  Result<FrozenPlanGenerationCase, Diagnostics>
> {
  return freezePlanGenerationCase({
    id: "calibration/workflow-countdown",
    instruction:
      "Use boundedFix with the registered countdown step and remaining measure until the workflow state reaches its fixed point.",
    catalogId: "benchmark.workflow",
    policy: { allowedCapabilities: [], budget: DEFAULT_BUDGET },
    publicExamples: [],
    hiddenEvaluations: [
      {
        id: "calibration/workflow-countdown/hidden-1",
        inputs: { state: { remaining: 4, value: 3 } },
        effects: [],
        expectedOutput: { remaining: 0, value: 7 },
      },
    ],
    expectedFeasibility: "plannable",
    requiredProperties: [
      { kind: "usesInput", inputKey: "state" },
      { kind: "usesOperation", id: "countdown-step", version: "1" },
      { kind: "usesOperation", id: "remaining", version: "1" },
    ],
    forbiddenCapabilities: [],
  });
}

function requiredCase(
  cases: ReadonlyArray<FrozenPlanGenerationCase>,
  id: string,
): Result<FrozenPlanGenerationCase, Diagnostics> {
  const found = cases.find((item) => item.case.id === id);
  return found === undefined
    ? {
        ok: false,
        error: [
          {
            code: "INTERNAL_INVARIANT_VIOLATION",
            message: `Missing preregistered case ${id}.`,
            location: {},
            details: [],
          },
        ],
      }
    : { ok: true, value: found };
}

async function phaseCases(
  phase: CampaignPhase,
): Promise<Result<ReadonlyArray<FrozenPlanGenerationCase>, Diagnostics>> {
  const loaded = await loadM1aCorpus();
  if (!loaded.ok) return loaded;
  const partition = partitionM1aCorpus(loaded.value);
  if (phase === "heldout") {
    return {
      ok: true,
      value: Object.freeze([
        ...partition.heldOutCatalogs,
        ...partition.heldOutOperatorCombinations,
        ...partition.heldOutPhrasings,
      ]),
    };
  }
  const ids =
    phase === "smoke"
      ? ["numbers/double", "numbers/missing-average"]
      : [
          "numbers/increment-positive",
          "numbers/sum",
          "text/trim-nonempty",
          "decisions/approve",
          "numbers/tax-map",
          "text/translation-map",
          "numbers/missing-average",
        ];
  const selected: Array<FrozenPlanGenerationCase> = [];
  for (const id of ids) {
    const item = requiredCase(partition.development, id);
    if (!item.ok) return item;
    selected.push(item.value);
  }
  if (phase === "calibration") {
    const workflow = await calibrationWorkflowCase();
    if (!workflow.ok) return workflow;
    selected.push(workflow.value);
  }
  return { ok: true, value: Object.freeze(selected) };
}

function experimentMethods(): ReadonlyArray<ExperimentMethodInput> {
  return M1A_GENERATION_STRATEGIES.flatMap((strategy) => {
    const adapters = createM1bPrimaryAdapters({
      constraint: strategy.constraint,
    });
    return [adapters.openai, adapters.anthropic].map((adapter) => ({
      id: `${adapter.identity.provider}/${strategy.id}`,
      model: adapter.identity,
      strategy,
      inference: adapter.inference,
      pricingEntryId: adapter.pricingEntryId,
    }));
  });
}

export async function materializeM1bPhase(
  input: Readonly<{
    phase: CampaignPhase;
    gitCommit: string;
    runtimeVersions: RuntimeVersions;
  }>,
): Promise<Result<MaterializedPhase, Diagnostics>> {
  const campaign = await createCampaignManifest();
  if (!campaign.ok) return campaign;
  const cases = await phaseCases(input.phase);
  if (!cases.ok) return cases;
  const pricing = await createM1bPricingSnapshot();
  if (!pricing.ok) return pricing;
  const corpusDigest = await digestValue(
    cases.value.map((item) => ({ id: item.case.id, digest: item.digest })),
  );
  if (!corpusDigest.ok) return { ok: false, error: [corpusDigest.error] };
  const experiment = await createExperimentManifest({
    prompt: M1B_PROMPT_CANDIDATE,
    protocol: M1B_PROMPT_PROTOCOL,
    cases: cases.value.map((frozenCase) => ({
      frozenCase,
      split:
        input.phase === "heldout"
          ? frozenCase.case.catalogId === "benchmark.workflow"
            ? "heldout-catalog"
            : [
                  "numbers/double-sum",
                  "numbers/positive-sum",
                  "text/trim-uppercase",
                  "text/nonempty-concatenate",
                ].includes(frozenCase.case.id)
              ? "heldout-operator-combination"
              : "heldout-phrasing"
          : "development",
    })),
    methods: experimentMethods(),
    pricingSnapshot: pricing.value,
    repetitions: input.phase === "heldout" ? 2 : 1,
    caps:
      input.phase === "heldout"
        ? M1B_PILOT_CAPS
        : input.phase === "smoke"
          ? SMOKE_CAPS
          : DEVELOPMENT_CAPS,
    versions: {
      gitCommit: input.gitCommit,
      workspaceVersion: "0.1.0",
      kernelVersion: "0.1.0",
      generatorVersion: "0.1.0",
    },
  });
  if (!experiment.ok) return experiment;
  const manifest = await createPhaseManifest({
    campaign: campaign.value,
    phase: input.phase,
    experiment: experiment.value,
    corpusDigest: corpusDigest.value,
    storageNamespace: `m1b/${input.phase}/v1`,
    runtimeVersions: input.runtimeVersions,
  });
  return manifest.ok
    ? {
        ok: true,
        value: {
          campaign: campaign.value,
          manifest: manifest.value,
          cases: cases.value,
        },
      }
    : manifest;
}

export function matrixCounts(manifest: PhaseManifest): Readonly<{
  benchmarkRecords: number;
  initialModelCalls: number;
  maximumAdditionalRepairCalls: number;
  maximumModelCalls: number;
}> {
  const benchmarkRecords =
    manifest.experiment.cases.length *
    manifest.experiment.methods.length *
    manifest.repetitions;
  const repairMethods = manifest.experiment.methods.filter(
    (method) => method.strategy.id === "json-schema-with-repair",
  ).length;
  const maximumAdditionalRepairCalls =
    manifest.experiment.cases.length * repairMethods * manifest.repetitions * 2;
  return {
    benchmarkRecords,
    initialModelCalls: benchmarkRecords,
    maximumAdditionalRepairCalls,
    maximumModelCalls: benchmarkRecords + maximumAdditionalRepairCalls,
  };
}
