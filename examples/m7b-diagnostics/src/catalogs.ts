import {
  type Catalog,
  catalogSemanticRolesSchema,
  createCatalog,
  defineCollectionSchema,
  defineEffect,
  defineFixedPointStep,
  defineFunction,
  defineReducer,
  defineSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

export type DiagnosticVariant =
  | "baseline-a"
  | "baseline-b"
  | "missing-declarations"
  | "role-version"
  | "incompatible-obligations"
  | "capability"
  | "effect-contract"
  | "ordering"
  | "state-transition"
  | "output-semantics"
  | "output-semantics-irrelevant-evolution"
  | "output-semantics-substantive-evolution";

function roleVersion(variant: DiagnosticVariant): string {
  return variant === "role-version" ? "2" : "1";
}

function version(variant: DiagnosticVariant): string {
  return variant === "output-semantics-irrelevant-evolution" ||
    variant === "output-semantics-substantive-evolution"
    ? "2"
    : "1";
}

export function createDiagnosticCatalog(variant: DiagnosticVariant): Catalog {
  const namespace = `m7b.dev/${variant}`;
  const registrationVersion = version(variant);
  const number = defineSchema({
    id: `${namespace}/number`,
    version: registrationVersion,
    description:
      variant === "output-semantics-irrelevant-evolution"
        ? "An irrelevant editorial revision of a bounded diagnostic integer."
        : "A bounded diagnostic integer from zero through ten.",
    validator: z.number().int().min(0).max(10),
  });
  const numbers = defineCollectionSchema({
    id: `${namespace}/numbers`,
    version: registrationVersion,
    description: "A bounded ordered list of diagnostic integers.",
    validator: z.array(z.number().int().min(0).max(10)).max(8).readonly(),
    element: number,
    defaultMaxItems: 8,
  });
  const transform = defineFunction({
    id: `${namespace}/transform`,
    version: registrationVersion,
    description: "Double a bounded integer.",
    input: number,
    output: number,
    implementation: (value) => {
      if (variant === "output-semantics-substantive-evolution")
        return Math.min(10, value * 2 + 2);
      if (
        variant === "output-semantics" ||
        variant === "output-semantics-irrelevant-evolution"
      )
        return Math.min(10, value * 2 + 1);
      return Math.min(10, value * 2);
    },
  });
  const preserveOrder = defineFunction({
    id: `${namespace}/preserve-order`,
    version: registrationVersion,
    description: "Preserve the supplied list order.",
    input: numbers,
    output: numbers,
    maxOutputItems: 8,
    implementation: (values) =>
      variant === "ordering" ? values.toReversed() : values,
  });
  const peak = defineReducer({
    id: `${namespace}/peak`,
    version: registrationVersion,
    description: "Select the maximum integer.",
    element: number,
    accumulator: number,
    identity: 0,
    laws: {
      associative: true,
      commutative: variant !== "incompatible-obligations",
      idempotent: true,
    },
    implementation: Math.max,
  });
  const step = defineFixedPointStep({
    id: `${namespace}/step`,
    version: registrationVersion,
    description: "Decrease a state toward zero.",
    state: number,
    implementation: (value) =>
      variant === "state-transition" ? value : Math.max(0, value - 1),
  });
  const observe = defineEffect({
    id: `${namespace}/observe`,
    version: registrationVersion,
    description: "Declare a replayable, non-state-changing observation.",
    input: number,
    output: number,
    effectName:
      variant === "effect-contract" ? "m7b.observe.alternate" : "m7b.observe",
    capability: variant === "capability" ? "m7b.observe.wide" : "m7b.observe",
    maxTokens: 0,
    maxWallClockMs: 10,
    replayable: true,
  });
  const role = roleVersion(variant);
  const semanticRoles = catalogSemanticRolesSchema.parse({
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [
      {
        kind: "schema",
        role: { id: "m7b.dev.role/number", version: role },
        schema: { id: number.id, version: number.version },
        obligations: { mutuallyAcceptsConformanceValues: true },
      },
      {
        kind: "schema",
        role: { id: "m7b.dev.role/numbers", version: role },
        schema: { id: numbers.id, version: numbers.version },
        obligations: { mutuallyAcceptsConformanceValues: true },
      },
    ],
    operations: [
      {
        kind: "function",
        role: { id: "m7b.dev.role/transform", version: role },
        operation: { id: transform.id, version: transform.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "function",
        role: { id: "m7b.dev.role/preserve-order", version: role },
        operation: { id: preserveOrder.id, version: preserveOrder.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "reducer",
        role: { id: "m7b.dev.role/peak", version: role },
        operation: { id: peak.id, version: peak.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
          identity: true,
          associative: true,
          commutative: variant !== "incompatible-obligations",
          idempotent: true,
        },
      },
      {
        kind: "fixedPointStep",
        role: { id: "m7b.dev.role/step", version: role },
        operation: { id: step.id, version: step.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
          sameSchema: true,
        },
      },
      {
        kind: "effect",
        role: { id: "m7b.dev.role/observe", version: role },
        operation: { id: observe.id, version: observe.version },
        obligations: {
          sameEffectClass: true,
          sameCapability: true,
          sameReplayability: true,
          sameStateChangeSemantics: true,
          sameResourceBounds: true,
        },
      },
    ],
  });
  const catalog = createCatalog({
    identity: { id: `${namespace}/catalog`, version: registrationVersion },
    schemas: [number.runtime, numbers.runtime],
    operations: [transform, preserveOrder, peak, step, observe],
    ...(variant === "missing-declarations" ? {} : { semanticRoles }),
  });
  if (!catalog.ok) throw new Error(`M7b catalog ${variant} is invalid.`);
  return catalog.value;
}
