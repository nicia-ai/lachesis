import type {
  Diagnostic,
  PlanLanguageManifest,
  Result,
} from "@nicia-ai/lachesis";
import { modelPlanProposalSchema } from "@nicia-ai/lachesis";
import { z } from "zod";

import type { StructuredOutputTransport } from "./transport.js";

export type GenerationOutcome =
  | Readonly<{ kind: "plan"; plan: unknown }>
  | Readonly<{
      kind: "unplannable";
      reasons: ReadonlyArray<string>;
    }>;

export const generationOutcomeSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({ kind: z.literal("plan"), plan: modelPlanProposalSchema })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("unplannable"),
      reasons: z.array(z.string().min(1)).min(1).readonly(),
    })
    .readonly(),
]);

export type PublicExample = Readonly<{
  instruction: string;
  outcome: GenerationOutcome;
}>;

export type GenerationConstraint = "unconstrained-json" | "json-schema";

export const taskInputBoundSchema = z
  .strictObject({
    kind: z.literal("maximumCollectionItems"),
    value: z.number().int().nonnegative(),
  })
  .readonly();

export const taskInputSchema = z
  .strictObject({
    name: z.string().min(1),
    schema: z
      .strictObject({
        id: z.string().min(1),
        version: z.string().min(1),
      })
      .readonly(),
    declaredBounds: z.array(taskInputBoundSchema).max(1).readonly(),
  })
  .readonly();

export type TaskInput = z.infer<typeof taskInputSchema>;

export type InitialGenerationRequest = Readonly<{
  kind: "initial";
  originalTask: string;
  taskInputs: ReadonlyArray<TaskInput>;
  languageManifest: PlanLanguageManifest;
  publicExamples: ReadonlyArray<PublicExample>;
  constraint: GenerationConstraint;
  structuredOutputTransport: StructuredOutputTransport | null;
}>;

/** Deliberately excludes examples, hidden evaluations, and execution results. */
export type RepairGenerationRequest = Readonly<{
  kind: "repair";
  originalTask: string;
  taskInputs: ReadonlyArray<TaskInput>;
  languageManifest: PlanLanguageManifest;
  previousProposal: unknown;
  diagnostics: ReadonlyArray<Diagnostic>;
  structuredOutputTransport: StructuredOutputTransport;
}>;

export type ModelRequest = InitialGenerationRequest | RepairGenerationRequest;

export type ModelUsage = Readonly<{
  inputTokens: number;
  cachedInputTokens?: number | undefined;
  cacheWriteInputTokens?: number | undefined;
  outputTokens: number;
  reasoningTokens?: number | undefined;
  costUsdMicros: number;
}>;

export type ModelResponseMetadata = Readonly<{
  providerRequestId: string | null;
  providerResponseId: string | null;
  returnedModelId: string;
  finishReason: string;
  rawFinishReason: string | null;
}>;

export type ModelResponse = Readonly<{
  rawResponse: string;
  structuredOutput?: unknown;
  usage: ModelUsage;
  latencyMs: number;
  metadata?: ModelResponseMetadata | undefined;
  dispatchEvidence: "dispatched-with-usage";
}>;

export type AdapterDispatchEvidence =
  "not-dispatched" | "dispatched-with-usage" | "dispatched-usage-unknown";

export type ModelAdapterFailure = Readonly<{
  code:
    | "RECORDED_RESPONSE_MISSING"
    | "PROVIDER_FAILURE"
    | "PROVIDER_TIMEOUT"
    | "PROVIDER_REFUSAL"
    | "BUDGET_RESERVATION_FAILED";
  message: string;
  dispatchEvidence: AdapterDispatchEvidence;
  metadata?: ModelResponseMetadata | undefined;
  usage?: ModelUsage | undefined;
  latencyMs?: number | undefined;
}>;

export type ModelIdentity = Readonly<{
  provider: string;
  model: string;
  adapterVersion: string;
}>;

export const inferenceSettingsSchema = z
  .strictObject({
    temperature: z.number().min(0).nullable(),
    seed: z.number().int().nullable(),
    reasoningSettings: z.json(),
    maxInputTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    structuredOutputMode: z.enum(["none", "json-schema", "provider-native"]),
    structuredOutputTransport: z
      .enum([
        "prompt-json",
        "openai-responses-json-schema",
        "anthropic-json-tool",
        "bedrock-json-tool",
        "recorded-json-schema",
        "openai-responses-portable-json-schema",
        "anthropic-json-tool-portable-json-schema",
        "bedrock-json-tool-portable-json-schema",
      ])
      .optional(),
  })
  .readonly();

export type InferenceSettings = z.infer<typeof inferenceSettingsSchema>;

export const DEFAULT_INFERENCE_SETTINGS: InferenceSettings = Object.freeze({
  temperature: 0,
  seed: null,
  reasoningSettings: Object.freeze({}),
  maxInputTokens: 8_000,
  maxOutputTokens: 2_000,
  structuredOutputMode: "json-schema",
  structuredOutputTransport: "recorded-json-schema",
});

export type ModelAdapter = Readonly<{
  identity: ModelIdentity;
  inference: InferenceSettings;
  pricingEntryId: string;
  preflightStructuredOutput?:
    | ((
        transport: StructuredOutputTransport,
      ) => Promise<Result<void, ModelAdapterFailure>>)
    | undefined;
  generate: (
    request: ModelRequest,
  ) => Promise<Result<ModelResponse, ModelAdapterFailure>>;
}>;

export type GenerationStrategy = Readonly<{
  id:
    | "unconstrained-json"
    | "json-schema"
    | "json-schema-with-repair"
    | "codemode";
  constraint: GenerationConstraint;
  repair: "none" | "compiler-guided";
}>;

export const M1A_GENERATION_STRATEGIES: ReadonlyArray<GenerationStrategy> = [
  {
    id: "unconstrained-json",
    constraint: "unconstrained-json",
    repair: "none",
  },
  { id: "json-schema", constraint: "json-schema", repair: "none" },
  {
    id: "json-schema-with-repair",
    constraint: "json-schema",
    repair: "compiler-guided",
  },
];

export const MAX_REPAIR_ATTEMPTS = 2;
