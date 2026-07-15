import {
  type Catalog,
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

export const fragmentSchema = defineSchema({
  id: "example/fragment",
  version: "1",
  validator: z.strictObject({ id: z.string(), text: z.string() }).readonly(),
});
export const fragmentsSchema = defineCollectionSchema({
  id: "example/fragments",
  version: "1",
  validator: z
    .array(z.strictObject({ id: z.string(), text: z.string() }).readonly())
    .readonly(),
  element: fragmentSchema,
});
export const claimSchema = defineSchema({
  id: "example/claim",
  version: "1",
  validator: z.strictObject({ id: z.string(), text: z.string() }).readonly(),
});
export const claimsSchema = defineCollectionSchema({
  id: "example/claims",
  version: "1",
  validator: z
    .array(z.strictObject({ id: z.string(), text: z.string() }).readonly())
    .readonly(),
  element: claimSchema,
});
export const summarySchema = defineSchema({
  id: "example/summary",
  version: "1",
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
  validator: z.boolean(),
  semantic: "boolean",
});
export const countdownSchema = defineSchema({
  id: "example/countdown",
  version: "1",
  validator: z
    .strictObject({ remaining: z.number().int().nonnegative() })
    .readonly(),
});

const fragmentToClaim = defineFunction({
  id: "example/fragment-to-claim",
  version: "1",
  input: fragmentSchema,
  output: claimSchema,
  implementation: (fragment) => ({ id: fragment.id, text: fragment.text }),
});
const claimIsNonempty = definePredicate({
  id: "example/claim-is-nonempty",
  version: "1",
  input: claimSchema,
  implementation: (claim) => claim.text.length > 0,
});
const claimUnion = defineReducer({
  id: "example/claim-union",
  version: "1",
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
const extractionEffect = defineEffect({
  id: "example/extract-claim",
  version: "1",
  input: fragmentSchema,
  output: claimSchema,
  effectName: "model.extract",
  capability: "llm.invoke:extractor",
  maxTokens: 200,
  maxWallClockMs: 1_000,
  replayable: true,
});
const synthesisEffect = defineEffect({
  id: "example/synthesize",
  version: "1",
  input: claimsSchema,
  output: summarySchema,
  effectName: "model.synthesize",
  capability: "llm.invoke:synthesizer",
  maxTokens: 500,
  maxWallClockMs: 2_000,
  replayable: true,
});
const countdownStep = defineFixedPointStep({
  id: "example/countdown-step",
  version: "1",
  state: countdownSchema,
  implementation: (state) => ({ remaining: Math.max(0, state.remaining - 1) }),
});
const stuckCountdownStep = defineFixedPointStep({
  id: "example/stuck-countdown-step",
  version: "1",
  state: countdownSchema,
  implementation: (state) => state,
});
const countdownMeasure = defineMeasure({
  id: "example/countdown-measure",
  version: "1",
  input: countdownSchema,
  implementation: (state) => state.remaining,
});

export function createExampleCatalog(): Catalog {
  const created = createCatalog({
    identity: { id: "example/catalog", version: "1" },
    schemas: [
      fragmentSchema.runtime,
      fragmentsSchema.runtime,
      claimSchema.runtime,
      claimsSchema.runtime,
      summarySchema.runtime,
      booleanSchema.runtime,
      countdownSchema.runtime,
    ],
    operations: [
      fragmentToClaim,
      claimIsNonempty,
      claimUnion,
      extractionEffect,
      synthesisEffect,
      countdownStep,
      stuckCountdownStep,
      countdownMeasure,
    ],
  });
  if (!created.ok) {
    throw new Error(created.error.map((item) => item.message).join("; "));
  }
  return created.value;
}
