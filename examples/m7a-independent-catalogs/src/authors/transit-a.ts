import {
  type Catalog,
  catalogSemanticRolesSchema,
  createCatalog,
  definePredicate,
  defineReducer,
  defineSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

export function createTransitCatalogA(): Catalog {
  const delay = defineSchema({
    id: "m7a/transit-a/delay-seconds",
    version: "1",
    description: "A nonnegative vehicle delay up to two hours.",
    validator: z.number().int().min(0).max(7_200),
  });
  const serviceAlert = definePredicate({
    id: "m7a/transit-a/service-alert",
    version: "1",
    description: "Raise an alert for delays of five minutes or more.",
    input: delay,
    implementation: (seconds) => seconds >= 300,
  });
  const worstDelay = defineReducer({
    id: "m7a/transit-a/worst-delay",
    version: "1",
    description: "Retain the worst observed delay.",
    element: delay,
    accumulator: delay,
    identity: 0,
    laws: { associative: true, commutative: true, idempotent: true },
    implementation: Math.max,
  });
  const semanticRoles = catalogSemanticRolesSchema.parse({
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [
      {
        kind: "schema",
        role: { id: "m7a.role/transit/delay-seconds", version: "1" },
        schema: { id: delay.id, version: delay.version },
        obligations: { mutuallyAcceptsConformanceValues: true },
      },
    ],
    operations: [
      {
        kind: "predicate",
        role: { id: "m7a.role/transit/service-alert", version: "1" },
        operation: { id: serviceAlert.id, version: serviceAlert.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "reducer",
        role: { id: "m7a.role/transit/worst-delay", version: "1" },
        operation: { id: worstDelay.id, version: worstDelay.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
          identity: true,
          associative: true,
          commutative: true,
          idempotent: true,
        },
      },
    ],
  });
  const catalog = createCatalog({
    identity: { id: "m7a/transit-a/catalog", version: "1" },
    schemas: [delay.runtime],
    operations: [serviceAlert, worstDelay],
    semanticRoles,
  });
  if (!catalog.ok) throw new Error("Transit author A catalog is invalid.");
  return catalog.value;
}
