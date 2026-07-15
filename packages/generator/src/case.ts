import { type Diagnostic, digestValue, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  generationOutcomeSchema,
  type PublicExample,
  taskInputSchema,
} from "./model.js";

export const exampleSchema = z
  .strictObject({
    instruction: z.string().min(1),
    outcome: generationOutcomeSchema,
  })
  .readonly();

const operationPropertySchema = z
  .strictObject({
    kind: z.literal("usesOperation"),
    id: z.string().min(1),
    version: z.string().min(1),
  })
  .readonly();

export const planPropertySchema = z.discriminatedUnion("kind", [
  operationPropertySchema,
  z
    .strictObject({ kind: z.literal("usesEffect"), name: z.string().min(1) })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("rootSchema"),
      id: z.string().min(1),
      version: z.string().min(1),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("maximumNodes"),
      value: z.number().int().positive(),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("usesInput"),
      inputKey: z.string().min(1),
    })
    .readonly(),
]);

export const deterministicEffectSchema = z
  .strictObject({
    effectName: z.string().min(1),
    input: z.json(),
    output: z.json(),
    replayResultId: z.string().min(1),
    usage: z
      .strictObject({
        tokens: z.number().int().nonnegative(),
        wallClockMs: z.number().int().nonnegative(),
      })
      .readonly(),
  })
  .readonly();

export const hiddenEvaluationSchema = z
  .strictObject({
    id: z.string().min(1),
    inputs: z.record(z.string(), z.json()).readonly(),
    effects: z.array(deterministicEffectSchema).readonly(),
    expectedOutput: z.json(),
  })
  .readonly();

const compilationPolicySchema = z
  .strictObject({
    allowedCapabilities: z.array(z.string().min(1)).readonly(),
    budget: z
      .strictObject({
        maxEffectCalls: z.number().int().nonnegative(),
        maxCollectionItems: z.number().int().nonnegative(),
        maxRecursionDepth: z.number().int().nonnegative(),
        maxTokens: z.number().int().nonnegative(),
        maxWallClockMs: z.number().int().nonnegative(),
        maxParallelism: z.number().int().positive(),
      })
      .readonly(),
  })
  .readonly();

export const planGenerationCaseSchema = z
  .strictObject({
    id: z.string().min(1),
    instruction: z.string().min(1),
    catalogId: z.string().min(1),
    policy: compilationPolicySchema,
    taskInputs: z.array(taskInputSchema).min(1).readonly(),
    publicExamples: z.array(exampleSchema).readonly(),
    hiddenEvaluations: z.array(hiddenEvaluationSchema).readonly(),
    expectedFeasibility: z.enum(["plannable", "unplannable"]),
    requiredProperties: z.array(planPropertySchema).readonly(),
    forbiddenCapabilities: z.array(z.string().min(1)).readonly(),
  })
  .readonly();

export type Example = z.infer<typeof exampleSchema>;
export type PlanProperty = z.infer<typeof planPropertySchema>;
export type DeterministicEffect = z.infer<typeof deterministicEffectSchema>;
export type HiddenEvaluation = z.infer<typeof hiddenEvaluationSchema>;
export type PlanGenerationCase = z.infer<typeof planGenerationCaseSchema>;

export type FrozenPlanGenerationCase = Readonly<{
  case: PlanGenerationCase;
  digest: string;
}>;

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

export async function freezePlanGenerationCase(
  value: unknown,
): Promise<Result<FrozenPlanGenerationCase, ReadonlyArray<Diagnostic>>> {
  const parsed = planGenerationCaseSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => ({
        code: "INVALID_WIRE_SCHEMA",
        message: issue.message,
        location: {
          path: issue.path.map((part) =>
            typeof part === "symbol" ? String(part) : part,
          ),
        },
        details: [],
        repair: {
          path: issue.path.map((part) =>
            typeof part === "symbol" ? String(part) : part,
          ),
        },
      })),
    };
  }
  deepFreeze(parsed.data);
  const digest = await digestValue(parsed.data);
  return digest.ok
    ? {
        ok: true,
        value: Object.freeze({ case: parsed.data, digest: digest.value }),
      }
    : { ok: false, error: [digest.error] };
}

export function toPublicExamples(
  examples: ReadonlyArray<Example>,
): ReadonlyArray<PublicExample> {
  return examples;
}
