import {
  type Catalog,
  catalogSemanticRolesSchema,
  createCatalog,
  definePredicate,
  defineReducer,
  defineSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

export function createWarehouseCatalogA(reverse = false): Catalog {
  const units = defineSchema({
    id: "m7a/warehouse-a/on-hand-units",
    version: "1",
    description:
      "Whole units currently available, capped at warehouse capacity.",
    validator: z.number().int().min(0).max(1_000),
  });
  const needsReorder = definePredicate({
    id: "m7a/warehouse-a/needs-reorder",
    version: "1",
    description: "Request replenishment at or below ten on-hand units.",
    input: units,
    implementation: (value) => value <= 10,
  });
  const peakDemand = defineReducer({
    id: "m7a/warehouse-a/peak-demand",
    version: "1",
    description: "Retain the largest observed nonnegative unit demand.",
    element: units,
    accumulator: units,
    identity: 0,
    laws: { associative: true, commutative: true, idempotent: true },
    implementation: Math.max,
  });
  const semanticRoles = catalogSemanticRolesSchema.parse({
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [
      {
        kind: "schema",
        role: { id: "m7a.role/warehouse/units", version: "1" },
        schema: { id: units.id, version: units.version },
        obligations: { mutuallyAcceptsConformanceValues: true },
      },
    ],
    operations: [
      {
        kind: "predicate",
        role: { id: "m7a.role/warehouse/needs-reorder", version: "1" },
        operation: { id: needsReorder.id, version: needsReorder.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "reducer",
        role: { id: "m7a.role/warehouse/peak-demand", version: "1" },
        operation: { id: peakDemand.id, version: peakDemand.version },
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
    identity: { id: "m7a/warehouse-a/catalog", version: "1" },
    schemas: [units.runtime],
    operations: reverse
      ? [peakDemand, needsReorder]
      : [needsReorder, peakDemand],
    semanticRoles,
  });
  if (!catalog.ok) throw new Error("Warehouse author A catalog is invalid.");
  return catalog.value;
}
