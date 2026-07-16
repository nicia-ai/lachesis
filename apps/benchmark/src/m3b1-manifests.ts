import {
  type Diagnostic,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import {
  type M3bMaterializedPhase,
  type M3bPhase,
  materializeM3bPhase,
} from "@nicia-ai/lachesis-evidence";
import {
  calculateMaximumCostUsdMicros,
  type PricingEntry,
  type PricingSnapshot,
  pricingSnapshotSchema,
  validatePortableStructuredOutputSchema,
} from "@nicia-ai/lachesis-generator";
import {
  AI_SDK_VERSION,
  ANTHROPIC_AI_SDK_PROVIDER_VERSION,
  createM3b1PricingSnapshot,
  M3B1_ORACLE_IDENTITIES,
  M3B1_OUTPUT_JSON_SCHEMA,
  M3B1_OUTPUT_SCHEMA_VERSION,
  OPENAI_AI_SDK_PROVIDER_VERSION,
} from "@nicia-ai/lachesis-generator-ai-sdk";
import { z } from "zod";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const phaseSchema = z.enum([
  "m3b-protocol-probe",
  "m3b-calibration",
  "m3b-heldout",
]);
const providerCapSchema = z
  .strictObject({
    billingProvider: z.enum(["openai", "anthropic"]),
    maxCostUsdMicros: z.number().int().positive(),
  })
  .readonly();
const poolSchema = z
  .strictObject({
    id: z.enum(["m3b-development", "m3b-heldout"]),
    maxCostUsdMicros: z.number().int().positive(),
    providerCostCaps: z.array(providerCapSchema).length(2).readonly(),
  })
  .readonly();

export const m3b1CampaignManifestSchema = z
  .strictObject({
    formatVersion: z.literal("1"),
    campaignId: z.literal("lachesis-m3b1-live-graph-substrate"),
    milestone: z.literal("m3b.1"),
    maximumOperationalCostUsdMicros: z.literal(70_000_000),
    budgetPools: z.array(poolSchema).length(2).readonly(),
    authorizationPolicy: z
      .strictObject({
        theoreticalPhaseCeilings: z.literal("disclosed-not-authorized"),
        requestReservation: z.literal("complete-worst-case-before-dispatch"),
        retryReservation: z.literal("independent-complete-worst-case"),
        exhaustion: z.literal("fail-closed-without-dispatch"),
        phaseAuthorization: z.literal("separate-exact-acknowledgement"),
      })
      .readonly(),
    campaignDigest: digestSchema,
  })
  .readonly();
export type M3b1CampaignManifest = z.infer<typeof m3b1CampaignManifestSchema>;

const transportBindingSchema = z
  .strictObject({
    provider: z.enum(["openai", "anthropic"]),
    model: z.string().min(1),
    modelIdentityDigest: digestSchema,
    aiSdkVersion: z.literal(AI_SDK_VERSION),
    providerSdkPackage: z.enum(["@ai-sdk/openai", "@ai-sdk/anthropic"]),
    providerSdkVersion: z.enum([
      OPENAI_AI_SDK_PROVIDER_VERSION,
      ANTHROPIC_AI_SDK_PROVIDER_VERSION,
    ]),
    sdkDigest: digestSchema,
    adapterVersion: z.string().min(1),
    route: z.enum(["openai-responses", "anthropic-messages"]),
    structuredOutput: z.enum(["json-schema", "json-tool"]),
    outputSchemaVersion: z.literal(M3B1_OUTPUT_SCHEMA_VERSION),
    outputSchemaDigest: digestSchema,
    transportDigest: digestSchema,
    pricingEntryId: z.string().min(1),
    pricingEntryDigest: digestSchema,
  })
  .readonly();

const providerCeilingSchema = z
  .strictObject({
    billingProvider: z.enum(["openai", "anthropic"]),
    maximumCalls: z.number().int().positive(),
    maximumInputTokens: z.number().int().positive(),
    maximumOutputTokens: z.number().int().positive(),
    maximumTotalTokens: z.number().int().positive(),
    maximumCostUsdMicros: z.number().int().positive(),
  })
  .readonly();

const theoreticalCeilingSchema = z
  .strictObject({
    maximumCalls: z.number().int().positive(),
    maximumInputTokens: z.number().int().positive(),
    maximumOutputTokens: z.number().int().positive(),
    maximumTotalTokens: z.number().int().positive(),
    maximumCostUsdMicros: z.number().int().positive(),
    providers: z.array(providerCeilingSchema).length(2).readonly(),
  })
  .readonly();

export const m3b1PhaseManifestSchema = z
  .strictObject({
    formatVersion: z.literal("1"),
    milestone: z.literal("m3b.1"),
    status: z.literal("unexecuted-live-capable"),
    phase: phaseSchema,
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    campaignId: z.literal("lachesis-m3b1-live-graph-substrate"),
    campaignDigest: digestSchema,
    budgetPoolId: z.enum(["m3b-development", "m3b-heldout"]),
    operationalPool: poolSchema,
    substrateExperimentDigest: digestSchema,
    scheduleDigest: digestSchema,
    planHash: digestSchema,
    oraclePromptDigest: digestSchema,
    commonOutputSchemaDigest: digestSchema,
    pricingSnapshot: pricingSnapshotSchema,
    providerBindings: z.array(transportBindingSchema).length(2).readonly(),
    theoreticalCeiling: theoreticalCeilingSchema,
    initialCalls: z.number().int().positive(),
    maximumTransportRetries: z.number().int().nonnegative(),
    maximumCalls: z.number().int().positive(),
    semanticRepairCalls: z.literal(0),
    failurePolicy: z
      .strictObject({
        sdkRetries: z.literal(0),
        controllerRetriesPerRecord: z.literal(1),
        retryableFailures: z
          .tuple([
            z.literal("provider-overload"),
            z.literal("provider-timeout"),
            z.literal("provider-unavailable"),
          ])
          .readonly(),
        unknownUsageSettlement: z.literal(
          "full-conservative-charge-per-dispatched-attempt",
        ),
        semanticRepairs: z.literal(0),
      })
      .readonly(),
    executionPolicy: z.literal("exact-controller-authorization-required"),
    experimentDigest: digestSchema,
    storageNamespace: z.string().min(1),
    phaseManifestDigest: digestSchema,
  })
  .readonly();
export type M3b1PhaseManifest = z.infer<typeof m3b1PhaseManifestSchema>;

export type M3b1MaterializedPhase = Readonly<{
  campaign: M3b1CampaignManifest;
  phase: M3b1PhaseManifest;
  substrate: M3bMaterializedPhase;
}>;

export const M3B_OFFLINE_DESIGN_IDENTITIES = Object.freeze([
  Object.freeze({
    experimentDigest:
      "99dc013f1e23af94bc9b99ca0ddac44e6fd7c8a54bb2dd8d872bafc18b19b6e6",
    disposition: "report-only-offline-unbound" as const,
  }),
  Object.freeze({
    experimentDigest:
      "aa88eeb790929b0f716187622b7970562255b3b92475df77ef4e9965d0621e29",
    disposition: "report-only-offline-unbound" as const,
  }),
  Object.freeze({
    experimentDigest:
      "2101fe92fdcf88de3000048d44e1e9a4ce137a60412126dc64cb06f713b8a159",
    disposition: "report-only-offline-unbound" as const,
  }),
]);

export async function createM3b1CampaignManifest(): Promise<
  Result<M3b1CampaignManifest, Diagnostic>
> {
  const body = {
    formatVersion: "1" as const,
    campaignId: "lachesis-m3b1-live-graph-substrate" as const,
    milestone: "m3b.1" as const,
    maximumOperationalCostUsdMicros: 70_000_000 as const,
    budgetPools: [
      {
        id: "m3b-development" as const,
        maxCostUsdMicros: 10_000_000,
        providerCostCaps: [
          {
            billingProvider: "anthropic" as const,
            maxCostUsdMicros: 4_000_000,
          },
          { billingProvider: "openai" as const, maxCostUsdMicros: 6_000_000 },
        ],
      },
      {
        id: "m3b-heldout" as const,
        maxCostUsdMicros: 60_000_000,
        providerCostCaps: [
          {
            billingProvider: "anthropic" as const,
            maxCostUsdMicros: 25_000_000,
          },
          { billingProvider: "openai" as const, maxCostUsdMicros: 35_000_000 },
        ],
      },
    ],
    authorizationPolicy: {
      theoreticalPhaseCeilings: "disclosed-not-authorized" as const,
      requestReservation: "complete-worst-case-before-dispatch" as const,
      retryReservation: "independent-complete-worst-case" as const,
      exhaustion: "fail-closed-without-dispatch" as const,
      phaseAuthorization: "separate-exact-acknowledgement" as const,
    },
  };
  const digest = await digestValue(body);
  return digest.ok
    ? {
        ok: true,
        value: m3b1CampaignManifestSchema.parse({
          ...body,
          campaignDigest: digest.value,
        }),
      }
    : digest;
}

function pricingFor(
  snapshot: PricingSnapshot,
  provider: string,
): PricingEntry | undefined {
  return snapshot.entries.find((entry) => entry.billingProvider === provider);
}

function theoreticalCeiling(
  substrate: M3bMaterializedPhase,
  pricing: PricingSnapshot,
): Result<z.infer<typeof theoreticalCeilingSchema>, Diagnostic> {
  const providers: Array<z.infer<typeof providerCeilingSchema>> = [];
  for (const identity of substrate.manifest.providers.toSorted((left, right) =>
    left.provider.localeCompare(right.provider),
  )) {
    const entry = pricingFor(pricing, identity.provider);
    if (entry === undefined)
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          `M3b.1 provider ${identity.provider} has no frozen pricing entry.`,
        ),
      };
    const maximumCalls =
      substrate.manifest.schedule.entries.filter(
        (scheduled) => scheduled.provider === identity.provider,
      ).length *
      4 *
      2;
    const perCall = calculateMaximumCostUsdMicros(
      entry,
      identity.settings.maxInputTokens,
      identity.settings.maxOutputTokens,
    );
    if (!perCall.ok) return perCall;
    providers.push({
      billingProvider: identity.provider,
      maximumCalls,
      maximumInputTokens: maximumCalls * identity.settings.maxInputTokens,
      maximumOutputTokens: maximumCalls * identity.settings.maxOutputTokens,
      maximumTotalTokens:
        maximumCalls *
        (identity.settings.maxInputTokens + identity.settings.maxOutputTokens),
      maximumCostUsdMicros: maximumCalls * perCall.value,
    });
  }
  return {
    ok: true,
    value: theoreticalCeilingSchema.parse({
      maximumCalls: providers.reduce(
        (total, provider) => total + provider.maximumCalls,
        0,
      ),
      maximumInputTokens: providers.reduce(
        (total, provider) => total + provider.maximumInputTokens,
        0,
      ),
      maximumOutputTokens: providers.reduce(
        (total, provider) => total + provider.maximumOutputTokens,
        0,
      ),
      maximumTotalTokens: providers.reduce(
        (total, provider) => total + provider.maximumTotalTokens,
        0,
      ),
      maximumCostUsdMicros: providers.reduce(
        (total, provider) => total + provider.maximumCostUsdMicros,
        0,
      ),
      providers,
    }),
  };
}

async function providerBindings(
  pricing: PricingSnapshot,
): Promise<
  Result<ReadonlyArray<z.infer<typeof transportBindingSchema>>, Diagnostic>
> {
  const portable = validatePortableStructuredOutputSchema(
    M3B1_OUTPUT_JSON_SCHEMA,
  );
  if (!portable.ok) return portable;
  const outputSchemaDigest = await digestValue(M3B1_OUTPUT_JSON_SCHEMA);
  if (!outputSchemaDigest.ok) return outputSchemaDigest;
  const bindings: Array<z.infer<typeof transportBindingSchema>> = [];
  for (const identity of M3B1_ORACLE_IDENTITIES.toSorted((left, right) =>
    left.provider.localeCompare(right.provider),
  )) {
    const pricingEntry = pricingFor(pricing, identity.provider);
    if (pricingEntry === undefined)
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          `M3b.1 provider ${identity.provider} has no pricing binding.`,
        ),
      };
    const modelIdentityDigest = await digestValue(identity);
    const pricingEntryDigest = await digestValue(pricingEntry);
    const providerSdkPackage =
      identity.provider === "openai"
        ? ("@ai-sdk/openai" as const)
        : ("@ai-sdk/anthropic" as const);
    const providerSdkVersion =
      identity.provider === "openai"
        ? OPENAI_AI_SDK_PROVIDER_VERSION
        : ANTHROPIC_AI_SDK_PROVIDER_VERSION;
    const sdkDigest = await digestValue({
      aiSdkVersion: AI_SDK_VERSION,
      providerSdkPackage,
      providerSdkVersion,
    });
    if (!modelIdentityDigest.ok) return modelIdentityDigest;
    if (!pricingEntryDigest.ok) return pricingEntryDigest;
    if (!sdkDigest.ok) return sdkDigest;
    const transportBody = {
      provider: identity.provider,
      model: identity.model,
      modelIdentityDigest: modelIdentityDigest.value,
      aiSdkVersion: AI_SDK_VERSION,
      providerSdkPackage,
      providerSdkVersion,
      sdkDigest: sdkDigest.value,
      adapterVersion: identity.adapterVersion,
      route:
        identity.provider === "openai"
          ? ("openai-responses" as const)
          : ("anthropic-messages" as const),
      structuredOutput: identity.settings.structuredOutput,
      outputSchemaVersion: M3B1_OUTPUT_SCHEMA_VERSION,
      outputSchemaDigest: outputSchemaDigest.value,
      pricingEntryId: pricingEntry.id,
      pricingEntryDigest: pricingEntryDigest.value,
    };
    const transportDigest = await digestValue(transportBody);
    if (!transportDigest.ok) return transportDigest;
    bindings.push(
      transportBindingSchema.parse({
        ...transportBody,
        transportDigest: transportDigest.value,
      }),
    );
  }
  return { ok: true, value: bindings };
}

export async function materializeM3b1Phase(input: {
  readonly phase: M3bPhase;
  readonly sourceCommit: string;
}): Promise<Result<M3b1MaterializedPhase, ReadonlyArray<Diagnostic>>> {
  const campaign = await createM3b1CampaignManifest();
  if (!campaign.ok) return { ok: false, error: [campaign.error] };
  const substrate = await materializeM3bPhase({
    ...input,
    providers: M3B1_ORACLE_IDENTITIES,
  });
  if (!substrate.ok) return substrate;
  const pricing = await createM3b1PricingSnapshot();
  if (!pricing.ok) return pricing;
  const bindings = await providerBindings(pricing.value);
  if (!bindings.ok) return { ok: false, error: [bindings.error] };
  const ceiling = theoreticalCeiling(substrate.value, pricing.value);
  if (!ceiling.ok) return { ok: false, error: [ceiling.error] };
  const budgetPoolId =
    input.phase === "m3b-heldout"
      ? ("m3b-heldout" as const)
      : ("m3b-development" as const);
  const operationalPool = campaign.value.budgetPools.find(
    (pool) => pool.id === budgetPoolId,
  );
  if (operationalPool === undefined)
    return {
      ok: false,
      error: [
        diagnostic("INVALID_WIRE_SCHEMA", "M3b.1 operational pool is missing."),
      ],
    };
  for (const provider of ceiling.value.providers) {
    const providerPool = operationalPool.providerCostCaps.find(
      (cap) => cap.billingProvider === provider.billingProvider,
    );
    const perRequest = provider.maximumCostUsdMicros / provider.maximumCalls;
    if (
      !Number.isSafeInteger(perRequest) ||
      providerPool === undefined ||
      perRequest > providerPool.maxCostUsdMicros ||
      perRequest > operationalPool.maxCostUsdMicros
    )
      return {
        ok: false,
        error: [
          diagnostic(
            "BUDGET_EXCEEDED",
            "M3b.1 operational pool cannot fund one complete provider reservation.",
          ),
        ],
      };
  }
  const experimentBody = {
    milestone: "m3b.1" as const,
    phase: input.phase,
    sourceCommit: input.sourceCommit,
    campaignDigest: campaign.value.campaignDigest,
    budgetPoolId,
    operationalPool,
    substrateExperimentDigest: substrate.value.manifest.experimentDigest,
    scheduleDigest: substrate.value.manifest.schedule.scheduleDigest,
    planHash: substrate.value.manifest.sharedPlan.planHash,
    oraclePromptDigest:
      substrate.value.manifest.sharedPlan.oracleProtocolDigest,
    commonOutputSchemaDigest:
      substrate.value.manifest.sharedPlan.outputSchemaDigest,
    pricingSnapshot: pricing.value,
    providerBindings: bindings.value,
    theoreticalCeiling: ceiling.value,
    initialCalls: substrate.value.manifest.initialCalls,
    maximumTransportRetries: substrate.value.manifest.maximumTransportRetries,
    maximumCalls: substrate.value.manifest.maximumCalls,
    semanticRepairCalls: 0 as const,
    failurePolicy: {
      sdkRetries: 0 as const,
      controllerRetriesPerRecord: 1 as const,
      retryableFailures: [
        "provider-overload" as const,
        "provider-timeout" as const,
        "provider-unavailable" as const,
      ],
      unknownUsageSettlement:
        "full-conservative-charge-per-dispatched-attempt" as const,
      semanticRepairs: 0 as const,
    },
    executionPolicy: "exact-controller-authorization-required" as const,
  };
  const experimentDigest = await digestValue(experimentBody);
  if (!experimentDigest.ok)
    return { ok: false, error: [experimentDigest.error] };
  const manifestBody = {
    formatVersion: "1" as const,
    status: "unexecuted-live-capable" as const,
    campaignId: campaign.value.campaignId,
    ...experimentBody,
    experimentDigest: experimentDigest.value,
    storageNamespace: `m3b1/${input.phase}/experiments/${experimentDigest.value}`,
  };
  const phaseManifestDigest = await digestValue(manifestBody);
  return phaseManifestDigest.ok
    ? {
        ok: true,
        value: {
          campaign: campaign.value,
          phase: m3b1PhaseManifestSchema.parse({
            ...manifestBody,
            phaseManifestDigest: phaseManifestDigest.value,
          }),
          substrate: substrate.value,
        },
      }
    : { ok: false, error: [phaseManifestDigest.error] };
}

export async function validateM3b1Materialization(
  materialized: M3b1MaterializedPhase,
): Promise<Result<void, Diagnostic>> {
  const expected = await materializeM3b1Phase({
    phase: materialized.phase.phase,
    sourceCommit: materialized.phase.sourceCommit,
  });
  if (!expected.ok)
    return {
      ok: false,
      error:
        expected.error[0] ??
        diagnostic(
          "INTERNAL_INVARIANT_VIOLATION",
          "M3b.1 materialization could not be reconstructed.",
        ),
    };
  return expected.value.phase.phaseManifestDigest ===
    materialized.phase.phaseManifestDigest
    ? { ok: true, value: undefined }
    : {
        ok: false,
        error: diagnostic(
          "REPLAY_OUTPUT_MISMATCH",
          "M3b.1 phase differs from its frozen provider, pricing, transport, schedule, or substrate identity.",
        ),
      };
}
