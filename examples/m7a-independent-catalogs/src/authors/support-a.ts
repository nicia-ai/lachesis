import {
  type Catalog,
  catalogSemanticRolesSchema,
  createCatalog,
  definePredicate,
  defineReducer,
  defineSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

export function createSupportCatalogA(): Catalog {
  const priority = defineSchema({
    id: "m7a/support-a/priority",
    version: "1",
    description: "A normalized support priority from zero through five.",
    validator: z.number().int().min(0).max(5),
  });
  const escalate = definePredicate({
    id: "m7a/support-a/escalate",
    version: "1",
    description: "Escalate priority four and five requests.",
    input: priority,
    implementation: (value) => value >= 4,
  });
  const highestPriority = defineReducer({
    id: "m7a/support-a/highest-priority",
    version: "1",
    description: "Retain the highest normalized support priority.",
    element: priority,
    accumulator: priority,
    identity: 0,
    laws: { associative: true, commutative: true, idempotent: true },
    implementation: Math.max,
  });
  const semanticRoles = catalogSemanticRolesSchema.parse({
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [
      {
        kind: "schema",
        role: { id: "m7a.role/support/priority", version: "1" },
        schema: { id: priority.id, version: priority.version },
        obligations: { mutuallyAcceptsConformanceValues: true },
      },
    ],
    operations: [
      {
        kind: "predicate",
        role: { id: "m7a.role/support/escalate", version: "1" },
        operation: { id: escalate.id, version: escalate.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "reducer",
        role: { id: "m7a.role/support/highest-priority", version: "1" },
        operation: { id: highestPriority.id, version: highestPriority.version },
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
    identity: { id: "m7a/support-a/catalog", version: "1" },
    schemas: [priority.runtime],
    operations: [escalate, highestPriority],
    semanticRoles,
  });
  if (!catalog.ok) throw new Error("Support author A catalog is invalid.");
  return catalog.value;
}
