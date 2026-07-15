import {
  type Catalog,
  type CompilationPolicy,
  createCatalog,
  defineCollectionSchema,
  defineEffect,
  defineFixedPointStep,
  defineFunction,
  defineMeasure,
  definePredicate,
  defineReducer,
  defineSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

export const examplePolicy: CompilationPolicy = {
  allowedCapabilities: ["llm.invoke:extractor", "llm.invoke:synthesizer"],
  budget: {
    maxEffectCalls: 10_000,
    maxCollectionItems: 10_000,
    maxRecursionDepth: 10_000,
    maxTokens: 10_000_000,
    maxWallClockMs: 10_000_000,
    maxParallelism: 1_000,
  },
};

export const fragmentSchema = defineSchema({
  id: "example/fragment",
  version: "1",
  description: "A source fragment with a stable ID and text.",
  validator: z.strictObject({ id: z.string(), text: z.string() }).readonly(),
});
export const fragmentsSchema = defineCollectionSchema({
  id: "example/fragments",
  version: "1",
  description: "A bounded collection of source fragments.",
  validator: z
    .array(z.strictObject({ id: z.string(), text: z.string() }).readonly())
    .readonly(),
  element: fragmentSchema,
});
export const claimSchema = defineSchema({
  id: "example/claim",
  version: "1",
  description: "A normalized claim extracted from a fragment.",
  validator: z.strictObject({ id: z.string(), text: z.string() }).readonly(),
});
export const claimsSchema = defineCollectionSchema({
  id: "example/claims",
  version: "1",
  description: "A deduplicated collection of claims.",
  validator: z
    .array(z.strictObject({ id: z.string(), text: z.string() }).readonly())
    .readonly(),
  element: claimSchema,
});
export const summarySchema = defineSchema({
  id: "example/summary",
  version: "1",
  description: "A synthesized summary and its supporting claim IDs.",
  validator: z
    .strictObject({
      text: z.string(),
      claimIds: z.array(z.string()).readonly(),
    })
    .readonly(),
});
export const booleanSchema = defineSchema({
  id: "core/boolean",
  version: "1",
  description: "A boolean condition value.",
  validator: z.boolean(),
  semantic: "boolean",
});
export const countdownSchema = defineSchema({
  id: "example/countdown",
  version: "1",
  description: "A nonnegative countdown state.",
  validator: z
    .strictObject({ remaining: z.number().int().nonnegative() })
    .readonly(),
});

export const fragmentToClaim = defineFunction({
  id: "example/fragment-to-claim",
  version: "1",
  description: "Converts a fragment to an equivalent claim.",
  input: fragmentSchema,
  output: claimSchema,
  implementation: (fragment) => ({ id: fragment.id, text: fragment.text }),
});
export const claimIsNonempty = definePredicate({
  id: "example/claim-is-nonempty",
  version: "1",
  description: "Tests whether a claim contains nonempty text.",
  input: claimSchema,
  implementation: (claim) => claim.text.length > 0,
});
export const claimUnion = defineReducer({
  id: "example/claim-union",
  version: "1",
  description: "Adds and deterministically deduplicates a claim by ID.",
  element: claimSchema,
  accumulator: claimsSchema,
  identity: [],
  laws: { associative: true, commutative: true, idempotent: true },
  implementation: (claims, claim) => {
    const candidates = [...claims, claim].toSorted((left, right) => {
      const leftKey = `${left.id}\u0000${left.text}`;
      const rightKey = `${right.id}\u0000${right.text}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    return candidates.filter(
      (candidate, index) =>
        index === 0 || candidates[index - 1]?.id !== candidate.id,
    );
  },
});
export const extractionEffect = defineEffect({
  id: "example/extract-claim",
  version: "1",
  description: "Uses the extractor model to produce one claim per fragment.",
  input: fragmentSchema,
  output: claimSchema,
  effectName: "model.extract",
  capability: "llm.invoke:extractor",
  maxTokens: 200,
  maxWallClockMs: 1_000,
  replayable: true,
});
export const synthesisEffect = defineEffect({
  id: "example/synthesize",
  version: "1",
  description: "Uses the synthesizer model to summarize a claim set.",
  input: claimsSchema,
  output: summarySchema,
  effectName: "model.synthesize",
  capability: "llm.invoke:synthesizer",
  maxTokens: 500,
  maxWallClockMs: 2_000,
  replayable: true,
});
export const countdownStep = defineFixedPointStep({
  id: "example/countdown-step",
  version: "1",
  description: "Decrements a positive countdown by one.",
  state: countdownSchema,
  implementation: (state) => ({ remaining: Math.max(0, state.remaining - 1) }),
});
export const stuckCountdownStep = defineFixedPointStep({
  id: "example/stuck-countdown-step",
  version: "1",
  description: "Leaves countdown state unchanged for rejection testing.",
  state: countdownSchema,
  implementation: (state) => state,
});
export const countdownMeasure = defineMeasure({
  id: "example/countdown-measure",
  version: "1",
  description: "Returns the remaining countdown as a progress measure.",
  input: countdownSchema,
  implementation: (state) => state.remaining,
});

export const exampleSchemas = [
  fragmentSchema.runtime,
  fragmentsSchema.runtime,
  claimSchema.runtime,
  claimsSchema.runtime,
  summarySchema.runtime,
  booleanSchema.runtime,
  countdownSchema.runtime,
] as const;

export const exampleOperations = [
  fragmentToClaim,
  claimIsNonempty,
  claimUnion,
  extractionEffect,
  synthesisEffect,
  countdownStep,
  stuckCountdownStep,
  countdownMeasure,
] as const;

export function createExampleCatalog(): Catalog {
  const created = createCatalog({
    identity: { id: "example/catalog", version: "1" },
    schemas: exampleSchemas,
    operations: exampleOperations,
  });
  if (!created.ok) {
    throw new Error(created.error.map((item) => item.message).join("; "));
  }
  return created.value;
}
