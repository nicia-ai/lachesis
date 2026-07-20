import {
  compilePlanJson,
  createCatalog,
  defineEffect,
  defineSchema,
  type Diagnostic,
  diagnostic,
  digestValue,
  type ExecutablePlan,
  inspectExecutablePlan,
  type Result,
} from "@nicia-ai/lachesis";
import {
  M4D1_REDUCED_ORACLE_PROMPT,
  m4d1OracleRequestSchema,
  m4OracleAnswerSchema,
} from "@nicia-ai/lachesis-evidence";
import {
  calculateMaximumCostUsdMicros,
  type PricingSnapshot,
  pricingSnapshotSchema,
} from "@nicia-ai/lachesis-generator";
import {
  AI_SDK_VERSION,
  ANTHROPIC_AI_SDK_PROVIDER_VERSION,
  createM5b0PricingSnapshot,
  M1B_ANTHROPIC_MODEL,
  M1B_OPENAI_MODEL,
  M4D1_OUTPUT_JSON_SCHEMA,
  M5B0_ORACLE_IDENTITIES,
  M5B0_PROVIDER_ADAPTER_VERSION,
  OPENAI_AI_SDK_PROVIDER_VERSION,
} from "@nicia-ai/lachesis-generator-ai-sdk";
import { z } from "zod";

import { type M5bCorpus, validateM5bCorpus } from "./m5b-corpus.js";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const providerSchema = z.enum(["openai", "anthropic"]);

export const M5B0_REDACTION_POLICY = Object.freeze({
  id: "m5b-production-pilot-redaction",
  version: "1",
  credentials: "never-serialize",
  authorizationText: "never-serialize",
  providerHeaders: "never-serialize",
  providerRequestIds: "digest-only-outside-private-artifacts",
  publicCorpusRequestOutput:
    "private-content-addressed-artifacts-only-0700-directories-0600-files",
  reports: "digests-and-bounded-sanitized-diagnostics-only",
  traces: "identity-only-no-raw-content",
});

export const M5B0_ACCEPTANCE_GATES = Object.freeze({
  id: "m5b-production-development-pilot-gates",
  version: "1",
  everyRecordDurableAndPreciselyClassified: true,
  maximumAuthorizationCapabilityIdentityBudgetViolations: 0,
  maximumOpaqueFailures: 0,
  maximumMissingUsageAttempts: 0,
  exactReplayRequiredForEveryCompletedRecord: true,
  completeCitationAndProvenanceValidationForAnswers: true,
  separateFirstAttemptAndRepairedOutcomes: true,
  providerSuperiorityClaimAllowed: false,
  graphSuperiorityClaimAllowed: false,
});

export const m5bCampaignManifestSchema = z
  .strictObject({
    formatVersion: z.literal("1"),
    campaignId: z.literal("lachesis-m5b0-production-development-pilot"),
    milestone: z.literal("m5b.0"),
    purpose: z.literal("production-development-dogfood-not-comparison"),
    budgetPool: z
      .strictObject({
        id: z.literal("m5b-development"),
        maxCostUsdMicros: z.literal(5_000_000),
        providerCostCaps: z
          .tuple([
            z
              .strictObject({
                billingProvider: z.literal("anthropic"),
                maxCostUsdMicros: z.literal(2_000_000),
              })
              .readonly(),
            z
              .strictObject({
                billingProvider: z.literal("openai"),
                maxCostUsdMicros: z.literal(3_000_000),
              })
              .readonly(),
          ])
          .readonly(),
      })
      .readonly(),
    authorizationPolicy: z
      .strictObject({
        phaseAuthorization: z.literal("separate-exact-acknowledgement"),
        completeReservation: z.literal("before-every-provider-dispatch"),
        exhaustion: z.literal("fail-closed-before-dispatch"),
        campaignCreationAuthorizesSpend: z.literal(false),
      })
      .readonly(),
    campaignDigest: digestSchema,
  })
  .readonly();

export type M5bCampaignManifest = z.infer<typeof m5bCampaignManifestSchema>;

const quotaSchema = z
  .strictObject({
    provider: providerSchema,
    initial: z.number().int().positive(),
    wireRepair: z.number().int().nonnegative(),
    semanticRepair: z.number().int().nonnegative(),
    transportRetry: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  })
  .superRefine((quota, context) => {
    if (
      quota.total !==
      quota.initial +
        quota.wireRepair +
        quota.semanticRepair +
        quota.transportRetry
    )
      context.addIssue({
        code: "custom",
        message: "Attempt quota total must equal its components.",
        path: ["total"],
      });
  })
  .readonly();

const providerCeilingSchema = z
  .strictObject({
    billingProvider: providerSchema,
    maximumAttempts: z.number().int().positive(),
    maximumInputTokens: z.number().int().positive(),
    maximumOutputTokens: z.number().int().positive(),
    maximumTotalTokens: z.number().int().positive(),
    maximumCostUsdMicros: z.number().int().positive(),
  })
  .readonly();

const providerBindingSchema = z
  .strictObject({
    provider: providerSchema,
    model: z.enum([M1B_OPENAI_MODEL, M1B_ANTHROPIC_MODEL]),
    adapterVersion: z.literal(M5B0_PROVIDER_ADAPTER_VERSION),
    aiSdkVersion: z.literal(AI_SDK_VERSION),
    providerSdkVersion: z.enum([
      OPENAI_AI_SDK_PROVIDER_VERSION,
      ANTHROPIC_AI_SDK_PROVIDER_VERSION,
    ]),
    route: z.enum(["openai-responses", "anthropic-messages"]),
    structuredOutput: z.enum(["json-schema", "json-tool"]),
    reasoning: z.enum(["low", "adaptive-low"]),
    sdkRetries: z.literal(0),
    maxInputTokens: z.literal(8_000),
    maxOutputTokens: z.literal(2_000),
    transportDigest: digestSchema,
    pricingEntryId: z.string().min(1),
    pricingEntryDigest: digestSchema,
  })
  .readonly();

export const m5bPhaseManifestSchema = z
  .strictObject({
    formatVersion: z.literal("1"),
    milestone: z.literal("m5b.0"),
    status: z.literal("unexecuted-live-capable"),
    phase: z.enum(["m5b-protocol-probe", "m5b-pilot"]),
    sourceCommit: commitSchema,
    campaignDigest: digestSchema,
    corpusDigest: digestSchema,
    corpusSourceCommit: commitSchema,
    taskBindings: z
      .array(
        z
          .strictObject({ taskId: z.string().min(1), taskDigest: digestSchema })
          .readonly(),
      )
      .min(2)
      .max(12)
      .readonly(),
    schedule: z
      .strictObject({
        records: z
          .array(
            z
              .strictObject({
                recordKey: digestSchema,
                taskId: z.string().min(1),
                taskDigest: digestSchema,
                provider: providerSchema,
              })
              .readonly(),
          )
          .min(4)
          .max(24)
          .readonly(),
        scheduleDigest: digestSchema,
      })
      .readonly(),
    planIdentity: z
      .strictObject({
        planHash: digestSchema,
        semanticContractHash: digestSchema,
        catalogFingerprint: digestSchema,
      })
      .readonly(),
    oraclePromptDigest: digestSchema,
    outputSchemaDigest: digestSchema,
    redactionPolicyDigest: digestSchema,
    acceptanceGatesDigest: digestSchema,
    pricingSnapshot: pricingSnapshotSchema,
    providerBindings: z.array(providerBindingSchema).length(2).readonly(),
    attemptQuotas: z.array(quotaSchema).length(2).readonly(),
    initialRecords: z.union([z.literal(4), z.literal(24)]),
    maximumAttempts: z.union([z.literal(12), z.literal(72)]),
    theoreticalCeiling: z
      .strictObject({
        maximumAttempts: z.union([z.literal(12), z.literal(72)]),
        maximumInputTokens: z.number().int().positive(),
        maximumOutputTokens: z.number().int().positive(),
        maximumTotalTokens: z.number().int().positive(),
        maximumCostUsdMicros: z.number().int().positive(),
        providers: z.array(providerCeilingSchema).length(2).readonly(),
      })
      .readonly(),
    failurePolicy: z
      .strictObject({
        sdkRetries: z.literal(0),
        controllerTransportRetriesPerLogicalAttempt: z.literal(1),
        wireRepairsPerRecord: z.literal(1),
        semanticRepairsPerRecord: z.literal(1),
        retryableTransportFailures: z
          .tuple([
            z.literal("provider-overload"),
            z.literal("provider-timeout"),
            z.literal("provider-unavailable"),
          ])
          .readonly(),
        terminalStoredRecordsOnResume: z.literal("never-redispatch"),
        quotaExhaustion: z.literal("incomplete-formal-failure"),
      })
      .readonly(),
    experimentDigest: digestSchema,
    storageNamespace: z.string().regex(/^m5b\/[a-f0-9]{64}$/u),
    phaseManifestDigest: digestSchema,
  })
  .readonly();

export type M5bPhaseManifest = z.infer<typeof m5bPhaseManifestSchema>;

export type M5bMaterializedPhase = Readonly<{
  campaign: M5bCampaignManifest;
  phase: M5bPhaseManifest;
  corpus: M5bCorpus;
  executablePlan: ExecutablePlan;
}>;

function failure(message: string): Diagnostic {
  return diagnostic("INVALID_WIRE_SCHEMA", message);
}

async function createCampaign(): Promise<
  Result<M5bCampaignManifest, Diagnostic>
> {
  const body = {
    formatVersion: "1" as const,
    campaignId: "lachesis-m5b0-production-development-pilot" as const,
    milestone: "m5b.0" as const,
    purpose: "production-development-dogfood-not-comparison" as const,
    budgetPool: {
      id: "m5b-development" as const,
      maxCostUsdMicros: 5_000_000 as const,
      providerCostCaps: [
        {
          billingProvider: "anthropic" as const,
          maxCostUsdMicros: 2_000_000 as const,
        },
        {
          billingProvider: "openai" as const,
          maxCostUsdMicros: 3_000_000 as const,
        },
      ] as const,
    },
    authorizationPolicy: {
      phaseAuthorization: "separate-exact-acknowledgement" as const,
      completeReservation: "before-every-provider-dispatch" as const,
      exhaustion: "fail-closed-before-dispatch" as const,
      campaignCreationAuthorizesSpend: false as const,
    },
  };
  const digest = await digestValue(body);
  return digest.ok
    ? {
        ok: true,
        value: m5bCampaignManifestSchema.parse({
          ...body,
          campaignDigest: digest.value,
        }),
      }
    : digest;
}

async function createSharedPlan(): Promise<
  Result<
    Readonly<{
      executable: ExecutablePlan;
      identity: M5bPhaseManifest["planIdentity"];
    }>,
    Diagnostic
  >
> {
  const request = defineSchema({
    id: "m5b/oracle-request",
    version: "1",
    description: "M5 reduced visible-evidence oracle request.",
    validator: m4d1OracleRequestSchema,
  });
  const output = defineSchema({
    id: "m5b/oracle-output",
    version: "1",
    description: "M5 reduced answer and visible supporting facts.",
    validator: m4OracleAnswerSchema,
  });
  const oracle = defineEffect({
    id: "m5b/oracle",
    version: "1",
    description: "Injected bounded M5 development oracle.",
    input: request,
    output,
    effectName: "m5b.oracle",
    capability: "evidence.oracle",
    maxTokens: 60_000,
    maxWallClockMs: 720_000,
    replayable: true,
  });
  const catalog = createCatalog({
    identity: { id: "m5b/pilot-catalog", version: "1" },
    schemas: [request.runtime, output.runtime],
    operations: [oracle],
  });
  if (!catalog.ok)
    return {
      ok: false,
      error: catalog.error[0] ?? failure("M5b catalog is invalid."),
    };
  const budget = {
    maxEffectCalls: 1,
    maxCollectionItems: 64,
    maxRecursionDepth: 0,
    maxTokens: 60_000,
    maxWallClockMs: 720_000,
    maxParallelism: 1,
  };
  const compiled = await compilePlanJson(
    JSON.stringify({
      formatVersion: "1",
      catalog: { id: "m5b/pilot-catalog", version: "1" },
      root: "answer",
      nodes: [
        {
          id: "request",
          op: "input",
          inputKey: "request",
          schema: { id: "m5b/oracle-request", version: "1" },
        },
        {
          id: "answer",
          op: "effect",
          source: "request",
          effect: { id: "m5b/oracle", version: "1" },
        },
      ],
      budget,
      allowedCapabilities: ["evidence.oracle"],
    }),
    catalog.value,
    { allowedCapabilities: ["evidence.oracle"], budget },
    [{ kind: "requiresEffect", effectName: "m5b.oracle" }],
  );
  if (!compiled.ok)
    return {
      ok: false,
      error: compiled.error[0] ?? failure("M5b plan is invalid."),
    };
  const summary = inspectExecutablePlan(compiled.value);
  return summary === undefined
    ? { ok: false, error: failure("M5b executable plan is not inspectable.") }
    : {
        ok: true,
        value: {
          executable: compiled.value,
          identity: {
            planHash: summary.planHash,
            semanticContractHash: summary.semanticContractHash,
            catalogFingerprint: summary.catalogFingerprint,
          },
        },
      };
}

function phaseQuotas(
  phase: M5bPhaseManifest["phase"],
): ReadonlyArray<z.infer<typeof quotaSchema>> {
  const values =
    phase === "m5b-protocol-probe"
      ? { initial: 2, wireRepair: 1, semanticRepair: 1, transportRetry: 2 }
      : { initial: 12, wireRepair: 6, semanticRepair: 6, transportRetry: 12 };
  return (["anthropic", "openai"] as const).map((provider) => ({
    provider,
    ...values,
    total:
      values.initial +
      values.wireRepair +
      values.semanticRepair +
      values.transportRetry,
  }));
}

async function bindings(
  pricing: PricingSnapshot,
): Promise<
  Result<ReadonlyArray<z.infer<typeof providerBindingSchema>>, Diagnostic>
> {
  const output: Array<z.infer<typeof providerBindingSchema>> = [];
  for (const identity of M5B0_ORACLE_IDENTITIES) {
    const entry = pricing.entries.find(
      (candidate) => candidate.billingProvider === identity.provider,
    );
    if (entry === undefined)
      return {
        ok: false,
        error: failure("M5b provider pricing is incomplete."),
      };
    const [transportDigest, pricingEntryDigest] = await Promise.all([
      digestValue({
        identity,
        prompt: M4D1_REDUCED_ORACLE_PROMPT,
        outputSchema: M4D1_OUTPUT_JSON_SCHEMA,
        route:
          identity.provider === "openai"
            ? "openai-responses"
            : "anthropic-messages",
      }),
      digestValue(entry),
    ]);
    if (!transportDigest.ok) return transportDigest;
    if (!pricingEntryDigest.ok) return pricingEntryDigest;
    output.push(
      providerBindingSchema.parse({
        provider: identity.provider,
        model: identity.model,
        adapterVersion: identity.adapterVersion,
        aiSdkVersion: AI_SDK_VERSION,
        providerSdkVersion:
          identity.provider === "openai"
            ? OPENAI_AI_SDK_PROVIDER_VERSION
            : ANTHROPIC_AI_SDK_PROVIDER_VERSION,
        route:
          identity.provider === "openai"
            ? "openai-responses"
            : "anthropic-messages",
        structuredOutput: identity.settings.structuredOutput,
        reasoning: identity.settings.reasoning,
        sdkRetries: identity.settings.sdkRetries,
        maxInputTokens: identity.settings.maxInputTokens,
        maxOutputTokens: identity.settings.maxOutputTokens,
        transportDigest: transportDigest.value,
        pricingEntryId: entry.id,
        pricingEntryDigest: pricingEntryDigest.value,
      }),
    );
  }
  return {
    ok: true,
    value: output.toSorted((left, right) =>
      left.provider.localeCompare(right.provider),
    ),
  };
}

function selectedTasks(
  corpus: M5bCorpus,
  phase: M5bPhaseManifest["phase"],
): ReadonlyArray<M5bCorpus["tasks"][number]> {
  return phase === "m5b-protocol-probe"
    ? corpus.tasks.filter((task) => task.audit.probeRole !== null)
    : corpus.tasks;
}

export async function materializeM5bPhase(
  input: Readonly<{
    phase: M5bPhaseManifest["phase"];
    sourceCommit: string;
    corpus: M5bCorpus;
  }>,
): Promise<Result<M5bMaterializedPhase, Diagnostic>> {
  const sourceCommit = commitSchema.safeParse(input.sourceCommit);
  if (!sourceCommit.success)
    return { ok: false, error: failure("M5b source commit is invalid.") };
  const corpus = await validateM5bCorpus(input.corpus);
  if (!corpus.ok) return corpus;
  const campaign = await createCampaign();
  if (!campaign.ok) return campaign;
  const plan = await createSharedPlan();
  if (!plan.ok) return plan;
  const pricing = await createM5b0PricingSnapshot();
  if (!pricing.ok)
    return {
      ok: false,
      error: pricing.error[0] ?? failure("M5b pricing is invalid."),
    };
  const providerBindings = await bindings(pricing.value);
  if (!providerBindings.ok) return providerBindings;
  const tasks = selectedTasks(corpus.value, input.phase);
  const scheduleRecords: Array<
    Omit<M5bPhaseManifest["schedule"]["records"][number], "recordKey">
  > = tasks.flatMap((task) =>
    providerBindings.value.map((binding) => ({
      taskId: task.task.id,
      taskDigest: task.taskDigest,
      provider: binding.provider,
    })),
  );
  const scheduleBody = [];
  for (const record of scheduleRecords) {
    const recordKey = await digestValue({
      phase: input.phase,
      corpusDigest: corpus.value.corpusDigest,
      ...record,
    });
    if (!recordKey.ok) return recordKey;
    scheduleBody.push({ ...record, recordKey: recordKey.value });
  }
  const orderedSchedule = scheduleBody.toSorted((left, right) =>
    `${left.taskId}/${left.provider}`.localeCompare(
      `${right.taskId}/${right.provider}`,
    ),
  );
  const scheduleDigest = await digestValue(orderedSchedule);
  if (!scheduleDigest.ok) return scheduleDigest;
  const quotas = phaseQuotas(input.phase);
  const providerCeilings: Array<z.infer<typeof providerCeilingSchema>> = [];
  for (const quota of quotas) {
    const binding = providerBindings.value.find(
      (candidate) => candidate.provider === quota.provider,
    );
    const entry = pricing.value.entries.find(
      (candidate) => candidate.billingProvider === quota.provider,
    );
    if (binding === undefined || entry === undefined)
      return {
        ok: false,
        error: failure("M5b provider ceiling is incomplete."),
      };
    const perAttempt = calculateMaximumCostUsdMicros(
      entry,
      binding.maxInputTokens,
      binding.maxOutputTokens,
    );
    if (!perAttempt.ok) return perAttempt;
    providerCeilings.push({
      billingProvider: quota.provider,
      maximumAttempts: quota.total,
      maximumInputTokens: quota.total * binding.maxInputTokens,
      maximumOutputTokens: quota.total * binding.maxOutputTokens,
      maximumTotalTokens:
        quota.total * (binding.maxInputTokens + binding.maxOutputTokens),
      maximumCostUsdMicros: quota.total * perAttempt.value,
    });
  }
  const sortedCeilings = providerCeilings.toSorted((left, right) =>
    left.billingProvider.localeCompare(right.billingProvider),
  );
  const theoreticalCeiling = {
    maximumAttempts: quotas.reduce((total, quota) => total + quota.total, 0),
    maximumInputTokens: sortedCeilings.reduce(
      (total, provider) => total + provider.maximumInputTokens,
      0,
    ),
    maximumOutputTokens: sortedCeilings.reduce(
      (total, provider) => total + provider.maximumOutputTokens,
      0,
    ),
    maximumTotalTokens: sortedCeilings.reduce(
      (total, provider) => total + provider.maximumTotalTokens,
      0,
    ),
    maximumCostUsdMicros: sortedCeilings.reduce(
      (total, provider) => total + provider.maximumCostUsdMicros,
      0,
    ),
    providers: sortedCeilings,
  };
  const [
    oraclePromptDigest,
    outputSchemaDigest,
    redactionPolicyDigest,
    acceptanceGatesDigest,
  ] = await Promise.all([
    digestValue(M4D1_REDUCED_ORACLE_PROMPT),
    digestValue(M4D1_OUTPUT_JSON_SCHEMA),
    digestValue(M5B0_REDACTION_POLICY),
    digestValue(M5B0_ACCEPTANCE_GATES),
  ]);
  if (!oraclePromptDigest.ok) return oraclePromptDigest;
  if (!outputSchemaDigest.ok) return outputSchemaDigest;
  if (!redactionPolicyDigest.ok) return redactionPolicyDigest;
  if (!acceptanceGatesDigest.ok) return acceptanceGatesDigest;
  const identityBody = {
    phase: input.phase,
    sourceCommit: sourceCommit.data,
    campaignDigest: campaign.value.campaignDigest,
    corpusDigest: corpus.value.corpusDigest,
    taskBindings: tasks.map((task) => ({
      taskId: task.task.id,
      taskDigest: task.taskDigest,
    })),
    scheduleDigest: scheduleDigest.value,
    planIdentity: plan.value.identity,
    oraclePromptDigest: oraclePromptDigest.value,
    outputSchemaDigest: outputSchemaDigest.value,
    redactionPolicyDigest: redactionPolicyDigest.value,
    acceptanceGatesDigest: acceptanceGatesDigest.value,
    pricingSnapshotDigest: pricing.value.digest,
    providerBindings: providerBindings.value,
    quotas,
    theoreticalCeiling,
  };
  const experimentDigest = await digestValue(identityBody);
  if (!experimentDigest.ok) return experimentDigest;
  const phaseBody = {
    formatVersion: "1" as const,
    milestone: "m5b.0" as const,
    status: "unexecuted-live-capable" as const,
    phase: input.phase,
    sourceCommit: sourceCommit.data,
    campaignDigest: campaign.value.campaignDigest,
    corpusDigest: corpus.value.corpusDigest,
    corpusSourceCommit: corpus.value.sourceSnapshotCommit,
    taskBindings: identityBody.taskBindings,
    schedule: {
      records: orderedSchedule,
      scheduleDigest: scheduleDigest.value,
    },
    planIdentity: plan.value.identity,
    oraclePromptDigest: oraclePromptDigest.value,
    outputSchemaDigest: outputSchemaDigest.value,
    redactionPolicyDigest: redactionPolicyDigest.value,
    acceptanceGatesDigest: acceptanceGatesDigest.value,
    pricingSnapshot: pricing.value,
    providerBindings: providerBindings.value,
    attemptQuotas: quotas,
    initialRecords: orderedSchedule.length,
    maximumAttempts: theoreticalCeiling.maximumAttempts,
    theoreticalCeiling,
    failurePolicy: {
      sdkRetries: 0 as const,
      controllerTransportRetriesPerLogicalAttempt: 1 as const,
      wireRepairsPerRecord: 1 as const,
      semanticRepairsPerRecord: 1 as const,
      retryableTransportFailures: [
        "provider-overload",
        "provider-timeout",
        "provider-unavailable",
      ] as const,
      terminalStoredRecordsOnResume: "never-redispatch" as const,
      quotaExhaustion: "incomplete-formal-failure" as const,
    },
    experimentDigest: experimentDigest.value,
    storageNamespace: `m5b/${experimentDigest.value}`,
  };
  const phaseManifestDigest = await digestValue(phaseBody);
  if (!phaseManifestDigest.ok) return phaseManifestDigest;
  const phase = m5bPhaseManifestSchema.safeParse({
    ...phaseBody,
    phaseManifestDigest: phaseManifestDigest.value,
  });
  if (!phase.success)
    return { ok: false, error: failure("M5b phase manifest is invalid.") };
  return {
    ok: true,
    value: {
      campaign: campaign.value,
      phase: phase.data,
      corpus: corpus.value,
      executablePlan: plan.value.executable,
    },
  };
}

export async function validateM5bMaterialization(
  input: M5bMaterializedPhase,
): Promise<Result<M5bMaterializedPhase, Diagnostic>> {
  const campaign = m5bCampaignManifestSchema.safeParse(input.campaign);
  const phase = m5bPhaseManifestSchema.safeParse(input.phase);
  const corpus = await validateM5bCorpus(input.corpus);
  if (!campaign.success || !phase.success || !corpus.ok)
    return {
      ok: false,
      error: failure("M5b materialization schema is invalid."),
    };
  const rematerialized = await materializeM5bPhase({
    phase: phase.data.phase,
    sourceCommit: phase.data.sourceCommit,
    corpus: corpus.value,
  });
  if (!rematerialized.ok) return rematerialized;
  const [expected, actual] = await Promise.all([
    digestValue({
      campaign: rematerialized.value.campaign,
      phase: rematerialized.value.phase,
    }),
    digestValue({ campaign: campaign.data, phase: phase.data }),
  ]);
  return expected.ok && actual.ok && expected.value === actual.value
    ? { ok: true, value: input }
    : { ok: false, error: failure("M5b materialization identity mismatch.") };
}
