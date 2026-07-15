import {
  diagnostic,
  type Diagnostics,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import {
  compileCaseStructuredOutputTransports,
  createExperimentManifest,
  createM1aCatalogResolver,
  type ExperimentCaps,
  type ExperimentMethodInput,
  type ExperimentTransportSchemaBinding,
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
  experimentStorageNamespace,
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

const TRANSPORT_PROBE_CAPS: ExperimentCaps = Object.freeze({
  ...DEVELOPMENT_CAPS,
  maxCalls: 2,
  maxCostUsdMicros: 564_800,
  providerCostCaps: Object.freeze([
    Object.freeze({
      billingProvider: "openai",
      maxCostUsdMicros: 282_880,
    }),
    Object.freeze({
      billingProvider: "anthropic",
      maxCostUsdMicros: 281_920,
    }),
  ]),
});

export const M1B_PROMPT_CANDIDATE = Object.freeze({
  id: "lachesis-m1b-plan-generator",
  version: "development-candidate-3",
  instruction:
    'Propose only registered Lachesis operators and schemas. Return raw JSON as exactly { "kind": "plan", "plan": ... } or { "kind": "unplannable", "reasons": [...] }; never use Markdown fences or alternate field names. A constrained provider may carry that exact logical outcome inside the internal structured-output transport envelope { "outcome": ... }; this JSON tool is output transport only and does not authorize external tools. Use unplannable only when the supplied manifest, public input contract, and policy cannot satisfy the task.',
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
    taskInputs: [
      {
        name: "state",
        schema: { id: "workflow-state", version: "1.0.0" },
        declaredBounds: [],
      },
    ],
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
    phase === "smoke" || phase === "transport-probe"
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
  for (const id of phase === "transport-probe" ? ids.slice(0, 1) : ids) {
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

function experimentMethods(
  phase: CampaignPhase,
): ReadonlyArray<ExperimentMethodInput> {
  const strategies =
    phase === "transport-probe"
      ? M1A_GENERATION_STRATEGIES.filter(
          (strategy) => strategy.id === "json-schema",
        )
      : M1A_GENERATION_STRATEGIES;
  return strategies.flatMap((strategy) => {
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

async function transportSchemaBindings(
  cases: ReadonlyArray<FrozenPlanGenerationCase>,
  methods: ReadonlyArray<ExperimentMethodInput>,
): Promise<
  Result<ReadonlyArray<ExperimentTransportSchemaBinding>, Diagnostics>
> {
  const resolver = createM1aCatalogResolver();
  if (!resolver.ok) return resolver;
  const compiled = await compileCaseStructuredOutputTransports(
    cases,
    resolver.value,
  );
  if (!compiled.ok) return { ok: false, error: [compiled.error] };
  const adapters = createM1bPrimaryAdapters({ constraint: "json-schema" });
  const byProvider = new Map([
    [adapters.openai.identity.provider, adapters.openai],
    [adapters.anthropic.identity.provider, adapters.anthropic],
  ]);
  const preflighted = new Set<string>();
  const bindings: Array<ExperimentTransportSchemaBinding> = [];
  for (const item of compiled.value) {
    for (const method of methods) {
      if (method.strategy.constraint !== "json-schema") continue;
      const adapter = byProvider.get(method.model.provider);
      if (adapter === undefined)
        return {
          ok: false,
          error: [
            diagnostic(
              "INVALID_WIRE_SCHEMA",
              `No structured-output adapter exists for ${method.model.provider}.`,
            ),
          ],
        };
      const preflightKey = `${item.transport.manifestDigest}\u0000${method.model.provider}`;
      if (!preflighted.has(preflightKey)) {
        if (adapter.preflightStructuredOutput === undefined)
          return {
            ok: false,
            error: [
              diagnostic(
                "INVALID_WIRE_SCHEMA",
                `Adapter ${method.model.provider} has no structured-output preflight.`,
              ),
            ],
          };
        const preflight = await adapter.preflightStructuredOutput(
          item.transport,
        );
        if (!preflight.ok)
          return {
            ok: false,
            error: [
              diagnostic(
                "INVALID_WIRE_SCHEMA",
                `Structured-output preflight failed for ${method.model.provider}: ${preflight.error.message}`,
              ),
            ],
          };
        preflighted.add(preflightKey);
      }
      bindings.push({
        caseDigest: item.caseDigest,
        methodId: method.id,
        manifestDigest: item.transport.manifestDigest,
        compilerVersion: item.transport.compilerVersion,
        schemaDigest: item.transport.schemaDigest,
      });
    }
  }
  return { ok: true, value: Object.freeze(bindings) };
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
  const methods = experimentMethods(input.phase);
  const transportSchemas = await transportSchemaBindings(cases.value, methods);
  if (!transportSchemas.ok) return transportSchemas;
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
    methods,
    transportSchemas: transportSchemas.value,
    pricingSnapshot: pricing.value,
    repetitions: input.phase === "heldout" ? 2 : 1,
    caps:
      input.phase === "heldout"
        ? M1B_PILOT_CAPS
        : input.phase === "transport-probe"
          ? TRANSPORT_PROBE_CAPS
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
    storageNamespace: experimentStorageNamespace(
      input.phase,
      experiment.value.experimentDigest,
    ),
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
