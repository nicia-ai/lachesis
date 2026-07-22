import {
  type Catalog,
  catalogSemanticRolesSchema,
  createCatalog,
  definePredicate,
  defineReducer,
  defineSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

export function createTransitCatalogB(): Catalog {
  const lateness = defineSchema({
    id: "m7a/transit-b/lateness",
    version: "3",
    description: "Integral seconds late within the operating telemetry bound.",
    validator: z.number().int().nonnegative().lte(7_200),
  });
  const alertRequired = definePredicate({
    id: "m7a/transit-b/alert-required",
    version: "3",
    description: "An alert is required once lateness reaches 300 seconds.",
    input: lateness,
    implementation: (seconds) => !(seconds < 300),
  });
  const maximumLateness = defineReducer({
    id: "m7a/transit-b/maximum-lateness",
    version: "3",
    description: "Aggregate telemetry to the maximum lateness.",
    element: lateness,
    accumulator: lateness,
    identity: 0,
    laws: { associative: true, commutative: true, idempotent: true },
    implementation: (accumulator, element) =>
      element > accumulator ? element : accumulator,
  });
  const semanticRoles = catalogSemanticRolesSchema.parse({
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [
      {
        kind: "schema",
        role: { id: "m7a.role/transit/delay-seconds", version: "1" },
        schema: { id: lateness.id, version: lateness.version },
        obligations: { mutuallyAcceptsConformanceValues: true },
      },
    ],
    operations: [
      {
        kind: "predicate",
        role: { id: "m7a.role/transit/service-alert", version: "1" },
        operation: { id: alertRequired.id, version: alertRequired.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "reducer",
        role: { id: "m7a.role/transit/worst-delay", version: "1" },
        operation: { id: maximumLateness.id, version: maximumLateness.version },
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
    identity: { id: "m7a/transit-b/catalog", version: "3" },
    schemas: [lateness.runtime],
    operations: [maximumLateness, alertRequired],
    semanticRoles,
  });
  if (!catalog.ok) throw new Error("Transit author B catalog is invalid.");
  return catalog.value;
}
