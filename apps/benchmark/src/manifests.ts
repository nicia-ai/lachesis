import {
  createPlanLanguageManifest,
  diagnostic,
  type Diagnostics,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import {
  type BenchmarkRepairTrialInput,
  blindPlanGenerationValidityAudit,
  calculateMaximumCostUsdMicros,
  compileCaseStructuredOutputTransports,
  createExperimentManifest,
  createM1aCatalogResolver,
  createReferencePlanWitness,
  type ExperimentCaps,
  type ExperimentManifest,
  type ExperimentMethodInput,
  type ExperimentRepairTrial,
  type ExperimentTransportSchemaBinding,
  freezePlanGenerationCase,
  type FrozenPlanGenerationCase,
  loadM1aCorpus,
  loadM1cPreregisteredCorpus,
  M1A_GENERATION_STRATEGIES,
  M1A_WORKFLOW_MAX_ITERATIONS,
  M1A_WORKFLOW_VERSION,
  M1C_CORPUS_PROTOCOL,
  partitionM1aCorpus,
  prepareSharedRepairTrial,
  type PricingSnapshot,
  validatePlanGenerationCases,
} from "@nicia-ai/lachesis-generator";
import {
  createM1bPricingSnapshot,
  createM1bPrimaryAdapters,
  M1B_PILOT_CAPS,
  M1C_PROMPT_PROTOCOL,
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

export const M1B_PROMPT_CANDIDATE = Object.freeze({
  id: "lachesis-m1b-plan-generator",
  version: "development-candidate-4",
  amendment: Object.freeze({
    classification: "non-discretionary-protocol-correction",
    supersedesInvalidCalibration:
      "ca742c6d0c8a4245ec06472870dcacb43fb7e1af15e53f5f00ea5814732b2e95",
    heldOutAccessOccurred: false,
    rationale:
      "Corrects model/runtime authority and benchmark-validity defects discovered in development calibration; it is not a fourth discretionary prompt candidate.",
  }),
  instruction:
    'Propose only registered Lachesis operator topology and arguments. Do not author budget, allowedCapabilities, or input maxItems fields; the trusted runtime supplies public input bounds, capabilities, policy limits, and typed semantic obligations, the analyzer derives requirements and root provenance, and the compiler checks both. Return raw JSON as exactly { "kind": "plan", "plan": ... } or { "kind": "unplannable", "witness": { "kind": "missingOperation" | "deniedCapability" | "insufficientBudget", ... } }; never use Markdown fences or alternate field names. A constrained provider may carry that exact logical outcome inside the internal structured-output transport envelope { "outcome": ... }; this JSON tool is output transport only and does not authorize external tools. Use unplannable only when its typed witness is proven by the supplied public obligations, exact manifest, and trusted policy.',
});

export const M1C_PROMPT_CANDIDATE = Object.freeze({
  id: "lachesis-m1c-typed-semantic-obligations",
  version: "development-candidate-1",
  codeModeStatus: "not-implemented-not-claimed",
  instruction: M1B_PROMPT_CANDIDATE.instruction,
});

export const M1C_EXPERIMENT_PROTOCOL = Object.freeze({
  id: "lachesis-m1c-controlled-experiment",
  version: "1",
  corpus: M1C_CORPUS_PROTOCOL,
  repair: Object.freeze({
    initialProposal: "offline-reference-plan-with-deterministic-mutation",
    comparisonRule: "same-initial-proposal-digest-only",
    eligibility: "compilation-or-semantic-obligation-failure",
    noFailureOutcome: "repair-unnecessary",
  }),
  codeModeStatus: "not-implemented-not-claimed",
});

export type MaterializedPhase = Readonly<{
  campaign: CampaignManifest;
  manifest: PhaseManifest;
  cases: ReadonlyArray<FrozenPlanGenerationCase>;
  repairTrials?: ReadonlyMap<string, BenchmarkRepairTrialInput> | undefined;
}>;

export type RuntimeVersions = PhaseManifest["runtimeVersions"];

const DEFAULT_BUDGET = Object.freeze({
  maxEffectCalls: 16,
  maxCollectionItems: 128,
  maxRecursionDepth: M1A_WORKFLOW_MAX_ITERATIONS,
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
        schema: { id: "workflow-state", version: M1A_WORKFLOW_VERSION },
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
    infeasibilityWitness: null,
    requiredProperties: [
      { kind: "usesInput", inputKey: "state" },
      {
        kind: "usesOperation",
        id: "countdown-step",
        version: M1A_WORKFLOW_VERSION,
      },
      {
        kind: "usesOperation",
        id: "remaining",
        version: M1A_WORKFLOW_VERSION,
      },
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

async function m1cPhaseCases(
  phase: CampaignPhase,
): Promise<Result<ReadonlyArray<FrozenPlanGenerationCase>, Diagnostics>> {
  const loaded = await loadM1cPreregisteredCorpus();
  if (!loaded.ok) return loaded;
  if (phase === "m1c-heldout") return { ok: true, value: loaded.value.heldOut };
  if (phase === "m1c-protocol-probe") {
    const feasible = requiredCase(
      loaded.value.development,
      "m1c/numbers/even-then-double",
    );
    if (!feasible.ok) return feasible;
    const unplannable = requiredCase(
      loaded.value.development,
      "m1c/numbers/missing-product",
    );
    return unplannable.ok
      ? {
          ok: true,
          value: Object.freeze([feasible.value, unplannable.value]),
        }
      : unplannable;
  }
  return {
    ok: true,
    value:
      phase === "m1c-repair"
        ? Object.freeze(
            loaded.value.development.filter(
              (item) => item.case.expectedFeasibility === "plannable",
            ),
          )
        : loaded.value.development,
  };
}

async function m1cRepairTrials(
  cases: ReadonlyArray<FrozenPlanGenerationCase>,
): Promise<
  Result<ReadonlyMap<string, BenchmarkRepairTrialInput>, Diagnostics>
> {
  const resolver = createM1aCatalogResolver();
  if (!resolver.ok) return resolver;
  const trials = new Map<string, BenchmarkRepairTrialInput>();
  for (const frozenCase of cases) {
    const catalog = resolver.value(frozenCase.case.catalogId);
    if (!catalog.ok) return { ok: false, error: [catalog.error] };
    const manifest = await createPlanLanguageManifest(
      catalog.value,
      frozenCase.case.policy,
    );
    if (!manifest.ok) return { ok: false, error: [manifest.error] };
    const reference = createReferencePlanWitness(frozenCase, manifest.value);
    if (!reference.ok) return { ok: false, error: [reference.error] };
    const inputNode = reference.value.nodes.find((node) => node.op === "input");
    if (inputNode === undefined)
      return {
        ok: false,
        error: capDiagnostic(
          `M1c reference plan ${frozenCase.case.id} has no input mutation target.`,
        ),
      };
    const mutation = {
      kind: "redirectRoot" as const,
      root: inputNode.id,
    };
    const prepared = await prepareSharedRepairTrial({
      validProposal: reference.value,
      mutation,
      catalog: catalog.value,
      policy: frozenCase.case.policy,
      taskInputs: frozenCase.case.taskInputs,
      semanticObligations: frozenCase.case.semanticObligations ?? [],
    });
    if (!prepared.ok) return { ok: false, error: [prepared.error] };
    trials.set(
      frozenCase.digest,
      Object.freeze({ mutation, trial: prepared.value }),
    );
  }
  return { ok: true, value: trials };
}

/** Audits held-out fixture validity without returning identities or contents. */
export async function blindHeldOutIntegrityAudit(): Promise<
  Result<
    Awaited<ReturnType<typeof blindPlanGenerationValidityAudit>>,
    Diagnostics
  >
> {
  const loaded = await loadM1aCorpus();
  if (!loaded.ok) return loaded;
  const partition = partitionM1aCorpus(loaded.value);
  const heldOut = Object.freeze([
    ...partition.heldOutCatalogs,
    ...partition.heldOutOperatorCombinations,
    ...partition.heldOutPhrasings,
  ]);
  const resolver = createM1aCatalogResolver();
  if (!resolver.ok) return resolver;
  return {
    ok: true,
    value: await blindPlanGenerationValidityAudit(heldOut, resolver.value),
  };
}

function experimentMethods(
  phase: CampaignPhase,
): ReadonlyArray<ExperimentMethodInput> {
  const strategies =
    phase === "transport-probe" || phase === "m1c-protocol-probe"
      ? M1A_GENERATION_STRATEGIES.filter(
          (strategy) => strategy.id === "json-schema",
        )
      : phase === "m1c-repair"
        ? M1A_GENERATION_STRATEGIES.filter(
            (strategy) => strategy.id === "json-schema-with-repair",
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

type TransportProbeCapInput = Readonly<{
  methods: ReadonlyArray<ExperimentMethodInput>;
  pricingSnapshot: PricingSnapshot;
  caseCount: number;
  repetitions: number;
}>;

function capDiagnostic(message: string): Diagnostics {
  return [diagnostic("INVALID_WIRE_SCHEMA", message)];
}

function checkedProduct(
  left: number,
  right: number,
  label: string,
): Result<number, Diagnostics> {
  const value = left * right;
  return Number.isSafeInteger(value) && value > 0
    ? { ok: true, value }
    : {
        ok: false,
        error: capDiagnostic(`Transport-probe ${label} is not a safe integer.`),
      };
}

function checkedSum(
  left: number,
  right: number,
  label: string,
): Result<number, Diagnostics> {
  const value = left + right;
  return Number.isSafeInteger(value) && value > 0
    ? { ok: true, value }
    : {
        ok: false,
        error: capDiagnostic(`Transport-probe ${label} is not a safe integer.`),
      };
}

function deriveExactCaps(
  input: TransportProbeCapInput,
  callsPerCase: (method: ExperimentMethodInput) => number,
): Result<ExperimentCaps, Diagnostics> {
  if (
    input.methods.length === 0 ||
    !Number.isSafeInteger(input.caseCount) ||
    input.caseCount <= 0 ||
    !Number.isSafeInteger(input.repetitions) ||
    input.repetitions <= 0
  )
    return {
      ok: false,
      error: capDiagnostic(
        "Transport-probe methods, cases, and repetitions must be positive.",
      ),
    };
  const casesAndRepetitions = checkedProduct(
    input.caseCount,
    input.repetitions,
    "cases and repetitions",
  );
  if (!casesAndRepetitions.ok) return casesAndRepetitions;

  let maxCalls = 0;
  let maxInputTokens = 0;
  let maxOutputTokens = 0;
  let maxOutputTokensPerCall = 0;
  const costsByProvider = new Map<string, number>();
  for (const method of input.methods) {
    const requestsPerMethod = checkedProduct(
      casesAndRepetitions.value,
      callsPerCase(method),
      `${method.id} request count`,
    );
    if (!requestsPerMethod.ok) return requestsPerMethod;
    const nextCalls = checkedSum(maxCalls, requestsPerMethod.value, "call cap");
    if (!nextCalls.ok) return nextCalls;
    maxCalls = nextCalls.value;
    const pricing = input.pricingSnapshot.entries.find(
      (entry) => entry.id === method.pricingEntryId,
    );
    if (pricing === undefined)
      return {
        ok: false,
        error: capDiagnostic(
          `Transport-probe method ${method.id} has no frozen pricing entry.`,
        ),
      };
    const methodInput = checkedProduct(
      method.inference.maxInputTokens,
      requestsPerMethod.value,
      `${method.id} input-token cap`,
    );
    if (!methodInput.ok) return methodInput;
    const nextInput = checkedSum(
      maxInputTokens,
      methodInput.value,
      "input-token cap",
    );
    if (!nextInput.ok) return nextInput;
    maxInputTokens = nextInput.value;

    const methodOutput = checkedProduct(
      method.inference.maxOutputTokens,
      requestsPerMethod.value,
      `${method.id} output-token cap`,
    );
    if (!methodOutput.ok) return methodOutput;
    const nextOutput = checkedSum(
      maxOutputTokens,
      methodOutput.value,
      "output-token cap",
    );
    if (!nextOutput.ok) return nextOutput;
    maxOutputTokens = nextOutput.value;
    maxOutputTokensPerCall = Math.max(
      maxOutputTokensPerCall,
      method.inference.maxOutputTokens,
    );

    const requestCost = calculateMaximumCostUsdMicros(
      pricing,
      method.inference.maxInputTokens,
      method.inference.maxOutputTokens,
    );
    if (!requestCost.ok) return { ok: false, error: [requestCost.error] };
    const methodCost = checkedProduct(
      requestCost.value,
      requestsPerMethod.value,
      `${method.id} cost cap`,
    );
    if (!methodCost.ok) return methodCost;
    const providerCost = checkedSum(
      costsByProvider.get(pricing.billingProvider) ?? 0,
      methodCost.value,
      `${pricing.billingProvider} cost cap`,
    );
    if (!providerCost.ok) return providerCost;
    costsByProvider.set(pricing.billingProvider, providerCost.value);
  }

  const maxTotalTokens = checkedSum(
    maxInputTokens,
    maxOutputTokens,
    "total-token cap",
  );
  if (!maxTotalTokens.ok) return maxTotalTokens;
  const providerCostCaps = Object.freeze(
    [...costsByProvider.entries()]
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([billingProvider, maxCostUsdMicros]) =>
        Object.freeze({ billingProvider, maxCostUsdMicros }),
      ),
  );
  let maxCostUsdMicros = 0;
  for (const cap of providerCostCaps) {
    const nextCost = checkedSum(
      maxCostUsdMicros,
      cap.maxCostUsdMicros,
      "total cost cap",
    );
    if (!nextCost.ok) return nextCost;
    maxCostUsdMicros = nextCost.value;
  }
  return {
    ok: true,
    value: Object.freeze({
      maxCalls,
      maxInputTokens,
      maxOutputTokens,
      maxTotalTokens: maxTotalTokens.value,
      maxOutputTokensPerCall,
      maxCostUsdMicros,
      providerCostCaps,
    }),
  };
}

/** Derives every exact transport-probe cap from its frozen request matrix. */
export function deriveTransportProbeCaps(
  input: TransportProbeCapInput,
): Result<ExperimentCaps, Diagnostics> {
  return deriveExactCaps(input, () => 1);
}

function deriveM1cPhaseCaps(
  input: TransportProbeCapInput & Readonly<{ phase: CampaignPhase }>,
): Result<ExperimentCaps, Diagnostics> {
  return deriveExactCaps(input, (method) =>
    input.phase === "m1c-repair"
      ? 2
      : method.strategy.id === "json-schema-with-repair"
        ? 3
        : 1,
  );
}

function capsEqual(left: ExperimentCaps, right: ExperimentCaps): boolean {
  return (
    left.maxCalls === right.maxCalls &&
    left.maxInputTokens === right.maxInputTokens &&
    left.maxOutputTokens === right.maxOutputTokens &&
    left.maxTotalTokens === right.maxTotalTokens &&
    left.maxOutputTokensPerCall === right.maxOutputTokensPerCall &&
    left.maxCostUsdMicros === right.maxCostUsdMicros &&
    left.providerCostCaps.length === right.providerCostCaps.length &&
    left.providerCostCaps.every(
      (cap, index) =>
        cap.billingProvider ===
          right.providerCostCaps[index]?.billingProvider &&
        cap.maxCostUsdMicros === right.providerCostCaps[index].maxCostUsdMicros,
    )
  );
}

/** Rejects a probe whose manifest cannot reserve every preregistered request. */
export function validateTransportProbeCaps(
  experiment: Pick<
    ExperimentManifest,
    "methods" | "pricingSnapshot" | "cases" | "repetitions" | "caps"
  >,
): Result<undefined, Diagnostics> {
  const derived = deriveTransportProbeCaps({
    methods: experiment.methods,
    pricingSnapshot: experiment.pricingSnapshot,
    caseCount: experiment.cases.length,
    repetitions: experiment.repetitions,
  });
  if (!derived.ok) return derived;
  if (!capsEqual(experiment.caps, derived.value))
    return {
      ok: false,
      error: capDiagnostic(
        "Transport-probe caps do not exactly cover every preregistered worst-case request.",
      ),
    };
  return { ok: true, value: undefined };
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
  const resolver = createM1aCatalogResolver();
  if (!resolver.ok) return resolver;
  const validCases = await validatePlanGenerationCases(
    cases.value,
    resolver.value,
  );
  if (!validCases.ok) return validCases;
  const pricing = await createM1bPricingSnapshot();
  if (!pricing.ok) return pricing;
  const methods = experimentMethods(input.phase);
  const repetitions = input.phase === "heldout" ? 2 : 1;
  const caps: Result<ExperimentCaps, Diagnostics> =
    input.phase === "heldout"
      ? { ok: true, value: M1B_PILOT_CAPS }
      : input.phase === "transport-probe"
        ? deriveTransportProbeCaps({
            methods,
            pricingSnapshot: pricing.value,
            caseCount: cases.value.length,
            repetitions,
          })
        : input.phase === "smoke"
          ? { ok: true, value: SMOKE_CAPS }
          : { ok: true, value: DEVELOPMENT_CAPS };
  if (!caps.ok) return caps;
  const transportSchemas = await transportSchemaBindings(cases.value, methods);
  if (!transportSchemas.ok) return transportSchemas;
  const corpusDigest = await digestValue(
    cases.value.map((item) => ({ id: item.case.id, digest: item.digest })),
  );
  if (!corpusDigest.ok) return { ok: false, error: [corpusDigest.error] };
  const experiment = await createExperimentManifest({
    prompt: M1B_PROMPT_CANDIDATE,
    protocol: M1C_PROMPT_PROTOCOL,
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
    repetitions,
    caps: caps.value,
    versions: {
      gitCommit: input.gitCommit,
      workspaceVersion: "0.1.0",
      kernelVersion: "0.1.0",
      generatorVersion: "0.1.0",
    },
  });
  if (!experiment.ok) return experiment;
  if (input.phase === "transport-probe") {
    const validatedCaps = validateTransportProbeCaps(experiment.value);
    if (!validatedCaps.ok) return validatedCaps;
  }
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

/** Builds a separately budgeted M1c phase without touching external storage. */
export async function materializeM1cPhase(
  input: Readonly<{
    phase: CampaignPhase;
    gitCommit: string;
    runtimeVersions: RuntimeVersions;
  }>,
): Promise<Result<MaterializedPhase, Diagnostics>> {
  if (!input.phase.startsWith("m1c-"))
    return {
      ok: false,
      error: capDiagnostic("M1c materialization requires an M1c phase."),
    };
  const campaign = await createCampaignManifest(
    "lachesis-m1c-typed-semantic-obligations",
  );
  if (!campaign.ok) return campaign;
  const cases = await m1cPhaseCases(input.phase);
  if (!cases.ok) return cases;
  const resolver = createM1aCatalogResolver();
  if (!resolver.ok) return resolver;
  const validCases = await validatePlanGenerationCases(
    cases.value,
    resolver.value,
  );
  if (!validCases.ok) return validCases;
  const pricing = await createM1bPricingSnapshot();
  if (!pricing.ok) return pricing;
  const methods = experimentMethods(input.phase);
  const repetitions = input.phase === "m1c-heldout" ? 2 : 1;
  const caps = deriveM1cPhaseCaps({
    phase: input.phase,
    methods,
    pricingSnapshot: pricing.value,
    caseCount: cases.value.length,
    repetitions,
  });
  if (!caps.ok) return caps;
  const transportSchemas = await transportSchemaBindings(cases.value, methods);
  if (!transportSchemas.ok) return transportSchemas;
  const repairTrials =
    input.phase === "m1c-repair"
      ? await m1cRepairTrials(cases.value)
      : { ok: true as const, value: undefined };
  if (!repairTrials.ok) return repairTrials;
  const repairTrialBindings: ReadonlyArray<ExperimentRepairTrial> | undefined =
    repairTrials.value === undefined
      ? undefined
      : Object.freeze(
          [...repairTrials.value.entries()].map(([caseDigest, item]) => ({
            caseDigest,
            mutation: item.mutation,
            initialProposalDigest: item.trial.initialProposalDigest,
            eligibility: item.trial.eligibility,
            arms: item.trial.arms,
          })),
        );
  const corpusDigest = await digestValue(
    cases.value.map((item) => ({ id: item.case.id, digest: item.digest })),
  );
  if (!corpusDigest.ok) return { ok: false, error: [corpusDigest.error] };
  const experiment = await createExperimentManifest({
    prompt: M1C_PROMPT_CANDIDATE,
    protocol: {
      provider: M1C_PROMPT_PROTOCOL,
      experiment: M1C_EXPERIMENT_PROTOCOL,
      phase: input.phase,
    },
    cases: cases.value.map((frozenCase) => ({
      frozenCase,
      split: input.phase === "m1c-heldout" ? "heldout-phrasing" : "development",
    })),
    methods,
    transportSchemas: transportSchemas.value,
    ...(repairTrialBindings === undefined
      ? {}
      : { repairTrials: repairTrialBindings }),
    pricingSnapshot: pricing.value,
    repetitions,
    caps: caps.value,
    versions: {
      gitCommit: input.gitCommit,
      workspaceVersion: "0.1.0",
      kernelVersion: "0.1.0",
      generatorVersion: "0.1.0",
    },
  });
  if (!experiment.ok) return experiment;
  if (input.phase === "m1c-protocol-probe") {
    const validatedCaps = validateTransportProbeCaps(experiment.value);
    if (!validatedCaps.ok) return validatedCaps;
  }
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
          ...(repairTrials.value === undefined
            ? {}
            : { repairTrials: repairTrials.value }),
        },
      }
    : manifest;
}

/** Counts-only M1c held-out audit for prompt-development integrity. */
export async function blindM1cHeldOutIntegrityAudit(): Promise<
  Result<
    Awaited<ReturnType<typeof blindPlanGenerationValidityAudit>>,
    Diagnostics
  >
> {
  const loaded = await loadM1cPreregisteredCorpus();
  if (!loaded.ok) return loaded;
  const resolver = createM1aCatalogResolver();
  if (!resolver.ok) return resolver;
  return {
    ok: true,
    value: await blindPlanGenerationValidityAudit(
      loaded.value.heldOut,
      resolver.value,
    ),
  };
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
  if (manifest.phase === "m1c-repair") {
    const maximumAdditionalRepairCalls =
      manifest.experiment.cases.length *
      repairMethods *
      manifest.repetitions *
      2;
    return {
      benchmarkRecords,
      initialModelCalls: 0,
      maximumAdditionalRepairCalls,
      maximumModelCalls: maximumAdditionalRepairCalls,
    };
  }
  const maximumAdditionalRepairCalls =
    manifest.experiment.cases.length * repairMethods * manifest.repetitions * 2;
  return {
    benchmarkRecords,
    initialModelCalls: benchmarkRecords,
    maximumAdditionalRepairCalls,
    maximumModelCalls: benchmarkRecords + maximumAdditionalRepairCalls,
  };
}
