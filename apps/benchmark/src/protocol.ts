import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  type Diagnostics,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import {
  type ExperimentManifest,
  experimentManifestSchema,
  PORTABLE_TRANSPORT_COMPILER_VERSION,
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
    id: z.enum(["m1b-development", "m1b-heldout-pilot"]),
    maxCostUsdMicros: z.number().int().positive(),
    providerCostCaps: z.array(providerCapSchema).readonly(),
  })
  .readonly();

export const campaignManifestSchema = z
  .strictObject({
    formatVersion: z.literal("1"),
    campaignId: z.string().min(1),
    title: z.string().min(1),
    maximumAuthorizedCostUsdMicros: z.number().int().positive(),
    budgetPools: z.array(budgetPoolSchema).length(2).readonly(),
    primaryComparison: z
      .strictObject({
        interpretation: z.literal("within-model-constraint-effects"),
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
      .literal(PORTABLE_TRANSPORT_COMPILER_VERSION)
      .optional(),
    schemaPreflight: z.literal("before-budget-reservation").optional(),
  })
  .readonly();

export const phaseManifestSchema = z
  .strictObject({
    formatVersion: z.enum(["1", "2", "3"]),
    campaignId: z.string().min(1),
    campaignDigest: z.string().min(1),
    phase: campaignPhaseSchema,
    budgetPoolId: z.enum(["m1b-development", "m1b-heldout-pilot"]),
    experimentDigest: z.string().min(1),
    experiment: experimentManifestSchema,
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
  return `m1b/${phase}/experiments/${experimentDigest}`;
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
  const body = {
    formatVersion: "1",
    campaignId,
    title: "Lachesis M1b controlled constraint and repair pilot",
    maximumAuthorizedCostUsdMicros: 60_000_000,
    budgetPools: [
      {
        id: "m1b-development",
        maxCostUsdMicros: 10_000_000,
        providerCostCaps: [],
      },
      {
        id: "m1b-heldout-pilot",
        maxCostUsdMicros: 50_000_000,
        providerCostCaps: [
          { billingProvider: "openai", maxCostUsdMicros: 25_000_000 },
          { billingProvider: "anthropic", maxCostUsdMicros: 25_000_000 },
        ],
      },
    ],
    primaryComparison: {
      interpretation: "within-model-constraint-effects",
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
          "Campaign manifest is not the frozen M1b campaign or failed its digest.",
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
  return phase === "heldout"
    ? !splits.has("development")
    : splits.size === 1 && splits.has("development");
}

function primaryMethodsAreValid(
  experiment: ExperimentManifest,
  phaseFormatVersion: PhaseManifest["formatVersion"],
  phase: CampaignPhase,
): boolean {
  const probe = phase === "transport-probe";
  if (experiment.methods.length !== (probe ? 2 : 6)) return false;
  const expectedStrategies = probe
    ? ["json-schema"]
    : ["unconstrained-json", "json-schema", "json-schema-with-repair"];
  for (const provider of ["openai", "anthropic"]) {
    const methods = experiment.methods.filter(
      (method) => method.model.provider === provider,
    );
    if (
      methods.length !== (probe ? 1 : 3) ||
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
            ? phaseFormatVersion === "3"
              ? "openai-responses-portable-json-schema"
              : "openai-responses-json-schema"
            : phaseFormatVersion === "3"
              ? "anthropic-json-tool-portable-json-schema"
              : "anthropic-json-tool";
      const expectedAdapterVersion =
        phaseFormatVersion === "1"
          ? `ai-sdk/${AI_SDK_VERSION}`
          : phaseFormatVersion === "2"
            ? `lachesis-ai-sdk-adapter/2;ai-sdk/${AI_SDK_VERSION}`
            : AI_SDK_ADAPTER_VERSION;
      if (
        method.model.adapterVersion !== expectedAdapterVersion ||
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
  }>,
): Promise<Result<PhaseManifest, Diagnostics>> {
  const scorerDigest = await digestValue({
    id: "lachesis-hidden-semantic-scorer",
    version: "1",
  });
  if (!scorerDigest.ok) return { ok: false, error: [scorerDigest.error] };
  const body = {
    formatVersion: "3",
    campaignId: input.campaign.campaignId,
    campaignDigest: input.campaign.campaignDigest,
    phase: input.phase,
    budgetPoolId:
      input.phase === "heldout" ? "m1b-heldout-pilot" : "m1b-development",
    experimentDigest: input.experiment.experimentDigest,
    experiment: input.experiment,
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
  if (
    digest.value !== phaseManifestDigest ||
    parsed.data.campaignDigest !== campaign.campaignDigest ||
    parsed.data.campaignId !== campaign.campaignId ||
    parsed.data.experimentDigest !==
      verifiedExperiment.value.experimentDigest ||
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
    (parsed.data.phase === "heldout" ? "m1b-heldout-pilot" : "m1b-development")
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
    parsed.data.formatVersion === "3" &&
    (parsed.data.failurePolicy.transportSchemaCompiler !==
      PORTABLE_TRANSPORT_COMPILER_VERSION ||
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
  return { ok: true, value: parsed.data };
}
