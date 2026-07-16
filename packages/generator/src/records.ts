import {
  diagnosticCodeSchema,
  semanticObligationSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

const diagnosticLocationSchema = z
  .strictObject({
    nodeId: z.string().optional(),
    path: z
      .array(z.union([z.string(), z.number()]))
      .readonly()
      .optional(),
  })
  .readonly();

const diagnosticReferenceSchema = z
  .strictObject({
    kind: z.enum(["schema", "operation", "catalog", "effectRequest"]),
    id: z.string(),
    version: z.string().optional(),
  })
  .readonly();

const diagnosticValueSchema = z
  .strictObject({
    schema: z
      .strictObject({ id: z.string(), version: z.string() })
      .readonly()
      .optional(),
    reference: diagnosticReferenceSchema.optional(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .readonly();

export const diagnosticRecordSchema = z
  .strictObject({
    code: diagnosticCodeSchema,
    message: z.string(),
    location: diagnosticLocationSchema,
    details: z
      .array(
        z
          .strictObject({
            key: z.string(),
            value: z.union([z.string(), z.number(), z.boolean()]),
          })
          .readonly(),
      )
      .readonly(),
    expected: diagnosticValueSchema.optional(),
    actual: diagnosticValueSchema.optional(),
    limit: z
      .strictObject({
        resource: z.string(),
        limit: z.number(),
        actual: z.number(),
      })
      .readonly()
      .optional(),
    repair: diagnosticLocationSchema.optional(),
  })
  .readonly();

export const modelIdentitySchema = z
  .strictObject({
    provider: z.string().min(1),
    model: z.string().min(1),
    adapterVersion: z.string().min(1),
  })
  .readonly();

export const generationStrategySchema = z
  .strictObject({
    id: z.enum([
      "unconstrained-json",
      "json-schema",
      "json-schema-with-repair",
      "codemode",
    ]),
    constraint: z.enum(["unconstrained-json", "json-schema"]),
    repair: z.enum(["none", "compiler-guided"]),
  })
  .readonly();

export const modelUsageSchema = z
  .strictObject({
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    cacheWriteInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    costUsdMicros: z.number().int().nonnegative(),
  })
  .readonly();

const modelResponseMetadataSchema = z
  .strictObject({
    providerRequestId: z.string().nullable(),
    providerResponseId: z.string().nullable(),
    returnedModelId: z.string().min(1),
    finishReason: z.string().min(1),
    rawFinishReason: z.string().nullable(),
  })
  .readonly();

export const adapterFailureSchema = z
  .strictObject({
    code: z.enum([
      "RECORDED_RESPONSE_MISSING",
      "PROVIDER_FAILURE",
      "PROVIDER_TIMEOUT",
      "PROVIDER_REFUSAL",
      "BUDGET_RESERVATION_FAILED",
    ]),
    message: z.string(),
    dispatchEvidence: z
      .enum([
        "not-dispatched",
        "dispatched-with-usage",
        "dispatched-usage-unknown",
      ])
      .optional(),
    metadata: modelResponseMetadataSchema.optional(),
    usage: modelUsageSchema.optional(),
    latencyMs: z.number().int().nonnegative().optional(),
  })
  .readonly();

export const attemptRecordSchema = z
  .strictObject({
    attemptIndex: z.number().int().nonnegative(),
    phase: z.enum(["initial", "repair"]),
    requestDigest: z.string(),
    responseKind: z.enum([
      "plan",
      "unplannable",
      "invalidOutput",
      "providerRefusal",
      "adapterFailure",
    ]),
    rawResponse: z.string().nullable(),
    structuredOutputCanonical: z.string().nullable(),
    proposalCanonical: z.string().nullable(),
    abstentionReasons: z.array(z.string()).readonly(),
    abstentionWitness: z.json().nullable().optional(),
    diagnostics: z.array(diagnosticRecordSchema).readonly(),
    adapterFailure: adapterFailureSchema.nullable(),
    dispatchEvidence: z
      .enum([
        "not-dispatched",
        "dispatched-with-usage",
        "dispatched-usage-unknown",
      ])
      .optional(),
    parseSuccess: z.boolean().nullable(),
    wireValidation: z.boolean().nullable(),
    compiled: z.boolean(),
    usage: modelUsageSchema,
    responseMetadata: modelResponseMetadataSchema.nullable(),
    latencyMs: z.number().int().nonnegative(),
    digest: z.string(),
  })
  .readonly();

export const generationRecordSchema = z
  .strictObject({
    task: z.string(),
    model: modelIdentitySchema,
    strategy: generationStrategySchema,
    manifestDigest: z.string(),
    catalogFingerprint: z.string(),
    attempts: z.array(attemptRecordSchema).readonly(),
    finalKind: z.enum([
      "compiled",
      "unplannable",
      "rejected",
      "providerRefusal",
      "adapterFailure",
    ]),
    planHash: z.string().nullable(),
    semanticContractHash: z.string().nullable().optional(),
    semanticObligations: z
      .array(semanticObligationSchema)
      .readonly()
      .optional(),
    repairCount: z.number().int().nonnegative(),
    totalInputTokens: z.number().int().nonnegative(),
    totalCachedInputTokens: z.number().int().nonnegative(),
    totalCacheWriteInputTokens: z.number().int().nonnegative(),
    totalOutputTokens: z.number().int().nonnegative(),
    totalReasoningTokens: z.number().int().nonnegative(),
    totalCostUsdMicros: z.number().int().nonnegative(),
    totalLatencyMs: z.number().int().nonnegative(),
    digest: z.string(),
  })
  .readonly();

export type AttemptRecord = z.infer<typeof attemptRecordSchema>;
export type GenerationRecord = z.infer<typeof generationRecordSchema>;
export type GenerationFinalKind = GenerationRecord["finalKind"];
