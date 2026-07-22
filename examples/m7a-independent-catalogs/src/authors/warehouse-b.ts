import {
  type Catalog,
  catalogSemanticRolesSchema,
  createCatalog,
  definePredicate,
  defineReducer,
  defineSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

export function createWarehouseCatalogB(): Catalog {
  const stockCount = defineSchema({
    id: "m7a/warehouse-b/stock-count",
    version: "2026-07",
    description: "A warehouse stock count from zero through one thousand.",
    validator: z.number().int().gte(0).lte(1_000),
  });
  const replenish = definePredicate({
    id: "m7a/warehouse-b/replenish",
    version: "2026-07",
    description:
      "Flag stock counts no greater than the ten-unit reorder point.",
    input: stockCount,
    implementation: (count) => count < 11,
  });
  const largestDemand = defineReducer({
    id: "m7a/warehouse-b/largest-demand",
    version: "2026-07",
    description: "Select the largest demand count.",
    element: stockCount,
    accumulator: stockCount,
    identity: 0,
    laws: { associative: true, commutative: true, idempotent: true },
    implementation: (current, next) => (current >= next ? current : next),
  });
  const semanticRoles = catalogSemanticRolesSchema.parse({
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [
      {
        kind: "schema",
        role: { id: "m7a.role/warehouse/units", version: "1" },
        schema: { id: stockCount.id, version: stockCount.version },
        obligations: { mutuallyAcceptsConformanceValues: true },
      },
    ],
    operations: [
      {
        kind: "predicate",
        role: { id: "m7a.role/warehouse/needs-reorder", version: "1" },
        operation: { id: replenish.id, version: replenish.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "reducer",
        role: { id: "m7a.role/warehouse/peak-demand", version: "1" },
        operation: { id: largestDemand.id, version: largestDemand.version },
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
    identity: { id: "m7a/warehouse-b/catalog", version: "2026-07" },
    schemas: [stockCount.runtime],
    operations: [largestDemand, replenish],
    semanticRoles,
  });
  if (!catalog.ok) throw new Error("Warehouse author B catalog is invalid.");
  return catalog.value;
}
