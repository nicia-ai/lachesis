import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  type Diagnostics,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import {
  createM2CounterbalancedScheduleFromIdentity,
  createM2PairedExperimentDigestFromIdentity,
  type ExperimentManifest,
  experimentManifestSchema,
  inferenceSettingsSchema,
  M2_COMPARISON_PROTOCOL,
  M2_PAIRED_ANALYSIS_PLAN,
  m2CounterbalancedScheduleSchema,
  PORTABLE_TRANSPORT_COMPILER_VERSION,
  SUPPORTED_PORTABLE_TRANSPORT_COMPILER_VERSIONS,
  verifyExperimentManifest,
} from "@nicia-ai/lachesis-generator";
import {
  AI_SDK_ADAPTER_VERSION,
  AI_SDK_VERSION,
  M1B_ANTHROPIC_MODEL,
  M1B_OPENAI_MODEL,
  M1B_TIMEOUT_MS,
} from "@nicia-ai/lachesis-generator-ai-sdk";
import { z } from "zod";

export const campaignPhaseSchema = z.enum([
  "transport-probe",
  "smoke",
  "calibration",
  "heldout",
  "m1c-protocol-probe",
  "m1c-repair",
  "m1c-calibration",
  "m1c-heldout",
  "m2-protocol-probe",
  "m2-calibration",
  "m2-heldout",
]);
export type CampaignPhase = z.infer<typeof campaignPhaseSchema>;

const providerCapSchema = z
  .strictObject({
    billingProvider: z.string().min(1),
    maxCostUsdMicros: z.number().int().positive(),
  })
  .readonly();

const budgetPoolSchema = z
  .strictObject({
    id: z.enum([
      "m1b-development",
      "m1b-heldout-pilot",
      "m1c-development",
      "m1c-heldout",
      "m2-development",
      "m2-heldout",
    ]),
    maxCostUsdMicros: z.number().int().positive(),
    providerCostCaps: z.array(providerCapSchema).readonly(),
  })
  .readonly();

export const campaignManifestSchema = z
  .strictObject({
    formatVersion: z.literal("1"),
    campaignId: z.string().min(1),
    title: z.string().min(1),
    milestone: z.enum(["m1b", "m1c", "m2"]).optional(),
    maximumAuthorizedCostUsdMicros: z.number().int().positive(),
    budgetPools: z.array(budgetPoolSchema).length(2).readonly(),
    primaryComparison: z
      .strictObject({
        interpretation: z.enum([
          "within-model-constraint-effects",
          "paired-representation-ablation",
        ]),
        aiSdkVersion: z.literal(AI_SDK_VERSION),
        openai: z
          .strictObject({
            route: z.literal("openai-responses"),
            model: z.literal(M1B_OPENAI_MODEL),
            reasoning: z.literal("low"),
          })
          .readonly(),
        anthropic: z
          .strictObject({
            route: z.literal("anthropic-messages"),
            model: z.literal(M1B_ANTHROPIC_MODEL),
            thinking: z.literal("adaptive"),
            effort: z.literal("low"),
          })
          .readonly(),
      })
      .readonly(),
    campaignDigest: z.string().min(1),
  })
  .readonly();

const failurePolicySchema = z
  .strictObject({
    transport: z.literal("record-and-continue"),
    providerAutomaticRetries: z.literal(0),
    storedProviderFailureOnResume: z.literal("do-not-retry"),
    selectiveSemanticReruns: z.literal("prohibited"),
    compilerGuidedRepairLimit: z.literal(2),
    timeoutMs: z.number().int().positive(),
    adapterDispatchEvidence: z.literal("v1").optional(),
    preDispatchSettlement: z.literal("zero").optional(),
    postDispatchUnknownUsage: z.literal("authorized-conservative").optional(),
    transportSchemaCompiler: z
      .enum(SUPPORTED_PORTABLE_TRANSPORT_COMPILER_VERSIONS)
      .optional(),
    schemaPreflight: z.literal("before-budget-reservation").optional(),
  })
  .readonly();

const m2MethodSchema = z
  .strictObject({
    id: z.string().min(1),
    model: z
      .strictObject({
        provider: z.string().min(1),
        model: z.string().min(1),
        adapterVersion: z.string().min(1),
      })
      .readonly(),
    inference: inferenceSettingsSchema,
    strategy: z
      .strictObject({
        constraint: z.enum(["unconstrained-json", "json-schema"]),
        repair: z.enum(["none", "compiler-guided"]),
      })
      .readonly(),
    pricingEntryId: z.string().min(1),
  })
  .readonly();

const m2TransportBindingSchema = z
  .strictObject({
    caseDigest: z.string().min(1),
    methodId: z.string().min(1),
    manifestDigest: z.string().min(1),
    compilerVersion: z.string().min(1),
    schemaDigest: z.string().min(1),
  })
  .readonly();

export const m2PhaseIdentitySchema = z
  .strictObject({
    protocolDigest: z.string().min(1),
    analysisPlanDigest: z.string().min(1),
    codeModePromptDigest: z.string().min(1),
    codeModeMethods: z.array(m2MethodSchema).length(2).readonly(),
    codeModeTransportSchemas: z
      .array(m2TransportBindingSchema)
      .min(1)
      .readonly(),
    schedule: m2CounterbalancedScheduleSchema,
    pairedExperimentDigest: z.string().min(1),
  })
  .readonly();

export type M2PhaseIdentity = z.infer<typeof m2PhaseIdentitySchema>;

export const phaseManifestSchema = z
  .strictObject({
    formatVersion: z.enum(["1", "2", "3", "4", "5"]),
    campaignId: z.string().min(1),
    campaignDigest: z.string().min(1),
    phase: campaignPhaseSchema,
    budgetPoolId: z.enum([
      "m1b-development",
      "m1b-heldout-pilot",
      "m1c-development",
      "m1c-heldout",
      "m2-development",
      "m2-heldout",
    ]),
    milestone: z.enum(["m1b", "m1c", "m2"]).optional(),
    experimentDigest: z.string().min(1),
    experiment: experimentManifestSchema,
    m2: m2PhaseIdentitySchema.optional(),
    corpusDigest: z.string().min(1),
    scorer: z
      .strictObject({
        id: z.literal("lachesis-hidden-semantic-scorer"),
        version: z.literal("1"),
        digest: z.string().min(1),
      })
      .readonly(),
    failurePolicy: failurePolicySchema,
    repetitions: z.number().int().positive(),
    storageNamespace: z.string().min(1),
    runtimeVersions: z
      .strictObject({
        node: z.string().min(1),
        pnpm: z.string().min(1),
        typescript: z.string().min(1),
        zod: z.string().min(1),
        aiSdk: z.literal(AI_SDK_VERSION),
      })
      .readonly(),
    phaseManifestDigest: z.string().min(1),
  })
  .readonly();

export type CampaignManifest = z.infer<typeof campaignManifestSchema>;
export type PhaseManifest = z.infer<typeof phaseManifestSchema>;
export type FailurePolicy = z.infer<typeof failurePolicySchema>;

export function experimentStorageNamespace(
  phase: CampaignPhase,
  experimentDigest: string,
): string {
  const milestone = phase.startsWith("m2-")
    ? "m2"
    : phase.startsWith("m1c-")
      ? "m1c"
      : "m1b";
  const phaseName =
    phase.startsWith("m1c-") || phase.startsWith("m2-")
      ? phase.slice(4)
      : phase;
  return `${milestone}/${phaseName}/experiments/${experimentDigest}`;
}

export const M1B_FAILURE_POLICY: FailurePolicy = Object.freeze({
  transport: "record-and-continue",
  providerAutomaticRetries: 0,
  storedProviderFailureOnResume: "do-not-retry",
  selectiveSemanticReruns: "prohibited",
  compilerGuidedRepairLimit: 2,
  timeoutMs: M1B_TIMEOUT_MS,
  adapterDispatchEvidence: "v1",
  preDispatchSettlement: "zero",
  postDispatchUnknownUsage: "authorized-conservative",
  transportSchemaCompiler: PORTABLE_TRANSPORT_COMPILER_VERSION,
  schemaPreflight: "before-budget-reservation",
});

function schemaDiagnostics(label: string, error: z.ZodError): Diagnostics {
  return error.issues.map((issue) =>
    diagnostic("INVALID_WIRE_SCHEMA", `${label}: ${issue.message}`, {
      path: issue.path.map((part) =>
        typeof part === "symbol" ? String(part) : part,
      ),
    }),
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  const leftJson = canonicalizeJson(left);
  const rightJson = canonicalizeJson(right);
  return leftJson.ok && rightJson.ok && leftJson.value === rightJson.value;
}

export async function createCampaignManifest(
  campaignId = "lachesis-m1b-controlled-pilot",
): Promise<Result<CampaignManifest, Diagnostics>> {
  const m1c = campaignId === "lachesis-m1c-typed-semantic-obligations";
  const m2 =
    campaignId ===
    "lachesis-m2-functional-ir-vs-restricted-capability-typescript";
  const body = {
    formatVersion: "1",
    campaignId,
    ...(m2
      ? { milestone: "m2" as const }
      : m1c
        ? { milestone: "m1c" as const }
        : {}),
    title: m2
      ? "Lachesis M2 functional IR versus restricted capability TypeScript"
      : m1c
        ? "Lachesis M1c typed semantic obligations"
        : "Lachesis M1b controlled constraint and repair pilot",
    maximumAuthorizedCostUsdMicros: m2
      ? 236_086_400
      : m1c
        ? 90_000_000
        : 60_000_000,
    budgetPools: [
      {
        id: m2
          ? ("m2-development" as const)
          : m1c
            ? ("m1c-development" as const)
            : ("m1b-development" as const),
        maxCostUsdMicros: m2 ? 32_758_400 : m1c ? 30_000_000 : 10_000_000,
        providerCostCaps: m2
          ? [
              { billingProvider: "openai", maxCostUsdMicros: 18_727_040 },
              {
                billingProvider: "anthropic",
                maxCostUsdMicros: 14_031_360,
              },
            ]
          : m1c
            ? [
                { billingProvider: "openai", maxCostUsdMicros: 15_000_000 },
                { billingProvider: "anthropic", maxCostUsdMicros: 12_000_000 },
              ]
            : [],
      },
      {
        id: m2
          ? ("m2-heldout" as const)
          : m1c
            ? ("m1c-heldout" as const)
            : ("m1b-heldout-pilot" as const),
        maxCostUsdMicros: m2 ? 203_328_000 : m1c ? 60_000_000 : 50_000_000,
        providerCostCaps: m2
          ? [
              { billingProvider: "openai", maxCostUsdMicros: 116_236_800 },
              {
                billingProvider: "anthropic",
                maxCostUsdMicros: 87_091_200,
              },
            ]
          : [
              {
                billingProvider: "openai",
                maxCostUsdMicros: m1c ? 35_000_000 : 25_000_000,
              },
              { billingProvider: "anthropic", maxCostUsdMicros: 25_000_000 },
            ],
      },
    ],
    primaryComparison: {
      interpretation: m2
        ? ("paired-representation-ablation" as const)
        : ("within-model-constraint-effects" as const),
      aiSdkVersion: AI_SDK_VERSION,
      openai: {
        route: "openai-responses",
        model: M1B_OPENAI_MODEL,
        reasoning: "low",
      },
      anthropic: {
        route: "anthropic-messages",
        model: M1B_ANTHROPIC_MODEL,
        thinking: "adaptive",
        effort: "low",
      },
    },
  };
  const parsed = campaignManifestSchema
    .unwrap()
    .omit({ campaignDigest: true })
    .safeParse(body);
  if (!parsed.success)
    return {
      ok: false,
      error: schemaDiagnostics("Invalid campaign", parsed.error),
    };
  const digest = await digestValue(parsed.data);
  if (!digest.ok) return { ok: false, error: [digest.error] };
  return {
    ok: true,
    value: campaignManifestSchema.parse({
      ...parsed.data,
      campaignDigest: digest.value,
    }),
  };
}

export async function verifyCampaignManifest(
  value: unknown,
): Promise<Result<CampaignManifest, Diagnostics>> {
  const parsed = campaignManifestSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      error: schemaDiagnostics("Invalid campaign", parsed.error),
    };
  const { campaignDigest, ...body } = parsed.data;
  const digest = await digestValue(body);
  if (!digest.ok) return { ok: false, error: [digest.error] };
  const expectedPools = await createCampaignManifest(parsed.data.campaignId);
  if (
    digest.value !== campaignDigest ||
    !expectedPools.ok ||
    !sameValue(parsed.data, expectedPools.value)
  ) {
    return {
      ok: false,
      error: [
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Campaign manifest is not a frozen Lachesis campaign or failed its digest.",
        ),
      ],
    };
  }
  return { ok: true, value: parsed.data };
}

function phaseDiagnostic(
  message: string,
): Result<never, ReadonlyArray<Diagnostic>> {
  return { ok: false, error: [diagnostic("INVALID_WIRE_SCHEMA", message)] };
}

function phaseSplitsAreValid(
  phase: CampaignPhase,
  experiment: ExperimentManifest,
): boolean {
  const splits = new Set(experiment.cases.map((item) => item.split));
  return phase === "heldout" ||
    phase === "m1c-heldout" ||
    phase === "m2-heldout"
    ? !splits.has("development")
    : splits.size === 1 && splits.has("development");
}

function primaryMethodsAreValid(
  experiment: ExperimentManifest,
  phaseFormatVersion: PhaseManifest["formatVersion"],
  phase: CampaignPhase,
): boolean {
  const probe = phase === "transport-probe";
  const m1cProbe = phase === "m1c-protocol-probe";
  const repair = phase === "m1c-repair";
  const m2 = phase.startsWith("m2-");
  if (experiment.methods.length !== (probe || m1cProbe || repair || m2 ? 2 : 6))
    return false;
  const expectedStrategies = probe
    ? ["json-schema"]
    : m1cProbe
      ? ["json-schema"]
      : repair
        ? ["json-schema-with-repair"]
        : m2
          ? [
              phase === "m2-protocol-probe"
                ? "json-schema"
                : "json-schema-with-repair",
            ]
          : ["unconstrained-json", "json-schema", "json-schema-with-repair"];
  for (const provider of ["openai", "anthropic"]) {
    const methods = experiment.methods.filter(
      (method) => method.model.provider === provider,
    );
    if (
      methods.length !== (probe || m1cProbe || repair || m2 ? 1 : 3) ||
      !expectedStrategies.every((strategy) =>
        methods.some((method) => method.strategy.id === strategy),
      )
    )
      return false;
    for (const method of methods) {
      const expectedTransport =
        method.strategy.constraint === "unconstrained-json"
          ? "prompt-json"
          : provider === "openai"
            ? ["3", "4", "5"].includes(phaseFormatVersion)
              ? "openai-responses-portable-json-schema"
              : "openai-responses-json-schema"
            : ["3", "4", "5"].includes(phaseFormatVersion)
              ? "anthropic-json-tool-portable-json-schema"
              : "anthropic-json-tool";
      const expectedAdapterVersions =
        phaseFormatVersion === "1"
          ? [`ai-sdk/${AI_SDK_VERSION}`]
          : phaseFormatVersion === "2"
            ? [`lachesis-ai-sdk-adapter/2;ai-sdk/${AI_SDK_VERSION}`]
            : [
                `lachesis-ai-sdk-adapter/3;ai-sdk/${AI_SDK_VERSION}`,
                AI_SDK_ADAPTER_VERSION,
              ];
      if (
        !expectedAdapterVersions.includes(method.model.adapterVersion) ||
        method.inference.structuredOutputTransport !==
          (phaseFormatVersion === "1" ? undefined : expectedTransport)
      )
        return false;
      if (provider === "openai") {
        if (
          method.model.model !== M1B_OPENAI_MODEL ||
          !sameValue(method.inference.reasoningSettings, {
            mode: "reasoning",
            effort: "low",
          }) ||
          !method.pricingEntryId.includes("openai/")
        )
          return false;
      } else if (
        method.model.model !== M1B_ANTHROPIC_MODEL ||
        method.pricingEntryId.includes("/bedrock/") ||
        !method.pricingEntryId.includes("/direct/") ||
        !sameValue(method.inference.reasoningSettings, {
          mode: "adaptive",
          effort: "low",
        })
      )
        return false;
    }
  }
  return experiment.methods.every(
    (method) =>
      method.model.provider === "openai" ||
      method.model.provider === "anthropic",
  );
}

export async function createPhaseManifest(
  input: Readonly<{
    campaign: CampaignManifest;
    phase: CampaignPhase;
    experiment: ExperimentManifest;
    corpusDigest: string;
    storageNamespace: string;
    runtimeVersions: PhaseManifest["runtimeVersions"];
    m2?: M2PhaseIdentity | undefined;
  }>,
): Promise<Result<PhaseManifest, Diagnostics>> {
  const scorerDigest = await digestValue({
    id: "lachesis-hidden-semantic-scorer",
    version: "1",
  });
  if (!scorerDigest.ok) return { ok: false, error: [scorerDigest.error] };
  const m1c = input.phase.startsWith("m1c-");
  const m2 = input.phase.startsWith("m2-");
  const heldout =
    input.phase === "heldout" ||
    input.phase === "m1c-heldout" ||
    input.phase === "m2-heldout";
  const body = {
    formatVersion: m2 ? ("5" as const) : m1c ? ("4" as const) : ("3" as const),
    ...(m2
      ? { milestone: "m2" as const }
      : m1c
        ? { milestone: "m1c" as const }
        : {}),
    campaignId: input.campaign.campaignId,
    campaignDigest: input.campaign.campaignDigest,
    phase: input.phase,
    budgetPoolId: m2
      ? heldout
        ? "m2-heldout"
        : "m2-development"
      : m1c
        ? heldout
          ? "m1c-heldout"
          : "m1c-development"
        : heldout
          ? "m1b-heldout-pilot"
          : "m1b-development",
    experimentDigest:
      input.m2?.pairedExperimentDigest ?? input.experiment.experimentDigest,
    experiment: input.experiment,
    ...(input.m2 === undefined ? {} : { m2: input.m2 }),
    corpusDigest: input.corpusDigest,
    scorer: {
      id: "lachesis-hidden-semantic-scorer",
      version: "1",
      digest: scorerDigest.value,
    },
    failurePolicy: M1B_FAILURE_POLICY,
    repetitions: input.experiment.repetitions,
    storageNamespace: input.storageNamespace,
    runtimeVersions: input.runtimeVersions,
  };
  const parsed = phaseManifestSchema
    .unwrap()
    .omit({ phaseManifestDigest: true })
    .safeParse(body);
  if (!parsed.success)
    return {
      ok: false,
      error: schemaDiagnostics("Invalid phase manifest", parsed.error),
    };
  const digest = await digestValue(parsed.data);
  if (!digest.ok) return { ok: false, error: [digest.error] };
  return verifyPhaseManifest(
    { ...parsed.data, phaseManifestDigest: digest.value },
    input.campaign,
  );
}

export async function verifyPhaseManifest(
  value: unknown,
  campaign: CampaignManifest,
): Promise<Result<PhaseManifest, Diagnostics>> {
  const parsed = phaseManifestSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      error: schemaDiagnostics("Invalid phase manifest", parsed.error),
    };
  const verifiedCampaign = await verifyCampaignManifest(campaign);
  if (!verifiedCampaign.ok) return verifiedCampaign;
  const verifiedExperiment = await verifyExperimentManifest(
    parsed.data.experiment,
  );
  if (!verifiedExperiment.ok) return verifiedExperiment;
  const { phaseManifestDigest, ...body } = parsed.data;
  const digest = await digestValue(body);
  if (!digest.ok) return { ok: false, error: [digest.error] };
  const pairedDigest =
    parsed.data.m2 === undefined
      ? undefined
      : await createM2PairedExperimentDigestFromIdentity({
          irExperiment: verifiedExperiment.value,
          cases: verifiedExperiment.value.cases.map((item) => ({
            id: item.id,
            digest: item.caseDigest,
          })),
          repetitions: verifiedExperiment.value.repetitions,
          codeModeMethods: parsed.data.m2.codeModeMethods,
          schedule: parsed.data.m2.schedule,
        });
  if (pairedDigest !== undefined && !pairedDigest.ok)
    return { ok: false, error: [pairedDigest.error] };
  const expectedM2Schedule =
    parsed.data.m2 === undefined
      ? undefined
      : await createM2CounterbalancedScheduleFromIdentity({
          cases: verifiedExperiment.value.cases.map((item) => ({
            id: item.id,
            digest: item.caseDigest,
          })),
          methods: parsed.data.m2.codeModeMethods.map((method) => ({
            provider: method.model.provider,
            model: method.model.model,
          })),
          repetitions: verifiedExperiment.value.repetitions,
        });
  if (expectedM2Schedule !== undefined && !expectedM2Schedule.ok)
    return { ok: false, error: [expectedM2Schedule.error] };
  if (
    digest.value !== phaseManifestDigest ||
    parsed.data.campaignDigest !== campaign.campaignDigest ||
    parsed.data.campaignId !== campaign.campaignId ||
    parsed.data.experimentDigest !==
      (pairedDigest?.value ?? verifiedExperiment.value.experimentDigest) ||
    parsed.data.repetitions !== verifiedExperiment.value.repetitions
  )
    return phaseDiagnostic(
      "Phase manifest has a campaign, experiment, repetition, or content-digest mismatch.",
    );
  if (!phaseSplitsAreValid(parsed.data.phase, verifiedExperiment.value))
    return phaseDiagnostic(
      "Phase manifest mixes development and held-out cases or uses a case in the wrong phase.",
    );
  if (
    parsed.data.budgetPoolId !==
    (parsed.data.phase.startsWith("m2-")
      ? parsed.data.phase === "m2-heldout"
        ? "m2-heldout"
        : "m2-development"
      : parsed.data.phase.startsWith("m1c-")
        ? parsed.data.phase === "m1c-heldout"
          ? "m1c-heldout"
          : "m1c-development"
        : parsed.data.phase === "heldout"
          ? "m1b-heldout-pilot"
          : "m1b-development")
  )
    return phaseDiagnostic(
      "Phase manifest uses the wrong campaign budget pool.",
    );
  if (
    parsed.data.formatVersion !== "1" &&
    parsed.data.storageNamespace !==
      experimentStorageNamespace(
        parsed.data.phase,
        parsed.data.experimentDigest,
      )
  )
    return phaseDiagnostic(
      "Phase manifest storage namespace is not bound to its experiment digest.",
    );
  if (
    parsed.data.formatVersion !== "1" &&
    (parsed.data.failurePolicy.adapterDispatchEvidence !== "v1" ||
      parsed.data.failurePolicy.preDispatchSettlement !== "zero" ||
      parsed.data.failurePolicy.postDispatchUnknownUsage !==
        "authorized-conservative")
  )
    return phaseDiagnostic(
      "Phase manifest is missing the M1b.3 dispatch-accounting identity.",
    );
  if (
    ["3", "4", "5"].includes(parsed.data.formatVersion) &&
    (parsed.data.failurePolicy.transportSchemaCompiler === undefined ||
      !SUPPORTED_PORTABLE_TRANSPORT_COMPILER_VERSIONS.includes(
        parsed.data.failurePolicy.transportSchemaCompiler,
      ) ||
      verifiedExperiment.value.transportSchemas?.some(
        (binding) =>
          binding.compilerVersion !==
          parsed.data.failurePolicy.transportSchemaCompiler,
      ) === true ||
      parsed.data.failurePolicy.schemaPreflight !== "before-budget-reservation")
  )
    return phaseDiagnostic(
      "Phase manifest is missing the M1b.4 transport-schema identity.",
    );
  if (
    !primaryMethodsAreValid(
      verifiedExperiment.value,
      parsed.data.formatVersion,
      parsed.data.phase,
    )
  )
    return phaseDiagnostic(
      "Phase manifest does not use the frozen direct OpenAI/Anthropic primary model matrix.",
    );
  if (
    parsed.data.phase === "heldout" &&
    (verifiedExperiment.value.cases.length !== 17 ||
      verifiedExperiment.value.repetitions !== 2)
  )
    return phaseDiagnostic(
      "Held-out phase must contain 17 cases and two repetitions.",
    );
  if (
    parsed.data.phase.startsWith("m1c-") &&
    (parsed.data.formatVersion !== "4" ||
      parsed.data.milestone !== "m1c" ||
      campaign.milestone !== "m1c")
  )
    return phaseDiagnostic(
      "M1c phase must be bound to the separately versioned M1c campaign.",
    );
  if (parsed.data.phase.startsWith("m2-")) {
    const protocolDigest = await digestValue(M2_COMPARISON_PROTOCOL);
    if (!protocolDigest.ok) return { ok: false, error: [protocolDigest.error] };
    const analysisPlanDigest = await digestValue(M2_PAIRED_ANALYSIS_PLAN);
    if (!analysisPlanDigest.ok)
      return { ok: false, error: [analysisPlanDigest.error] };
    if (
      parsed.data.formatVersion !== "5" ||
      parsed.data.milestone !== "m2" ||
      campaign.milestone !== "m2" ||
      parsed.data.m2 === undefined ||
      !pairedDigest?.ok ||
      !expectedM2Schedule?.ok ||
      !sameValue(parsed.data.m2.schedule, expectedM2Schedule.value) ||
      parsed.data.m2.pairedExperimentDigest !== pairedDigest.value ||
      parsed.data.m2.protocolDigest !== protocolDigest.value ||
      parsed.data.m2.analysisPlanDigest !== analysisPlanDigest.value ||
      parsed.data.m2.codeModeTransportSchemas.length !==
        verifiedExperiment.value.cases.length *
          parsed.data.m2.codeModeMethods.length
    )
      return phaseDiagnostic(
        "M2 phase must bind the paired representation, schedule, analysis plan, transports, and independent campaign identity.",
      );
  } else if (parsed.data.m2 !== undefined) {
    return phaseDiagnostic("Only an M2 phase may carry an M2 paired identity.");
  }
  if (
    parsed.data.phase === "m1c-protocol-probe" &&
    (verifiedExperiment.value.cases.length !== 2 ||
      verifiedExperiment.value.methods.length !== 2 ||
      verifiedExperiment.value.caps.maxCalls !== 4)
  )
    return phaseDiagnostic(
      "M1c protocol probe must contain two cases, two providers, and exactly four calls.",
    );
  if (
    parsed.data.phase === "m1c-repair" &&
    (verifiedExperiment.value.formatVersion !== "5" ||
      verifiedExperiment.value.repairTrials === undefined)
  )
    return phaseDiagnostic(
      "M1c repair phase must persist its shared deterministic repair trials.",
    );
  if (
    parsed.data.phase === "m2-protocol-probe" &&
    (verifiedExperiment.value.cases.length !== 2 ||
      verifiedExperiment.value.methods.length !== 2 ||
      parsed.data.m2?.codeModeMethods.length !== 2 ||
      verifiedExperiment.value.repetitions !== 1 ||
      verifiedExperiment.value.caps.maxCalls !== 8)
  )
    return phaseDiagnostic(
      "M2 protocol probe must contain two outcomes, two representations, two providers, and exactly eight initial calls.",
    );
  if (
    parsed.data.phase === "m2-heldout" &&
    (verifiedExperiment.value.cases.length < 20 ||
      verifiedExperiment.value.repetitions !== 2)
  )
    return phaseDiagnostic(
      "M2 held-out must contain at least 20 cases and two repetitions.",
    );
  return { ok: true, value: parsed.data };
}
