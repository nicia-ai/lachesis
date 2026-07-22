import {
  type Catalog,
  catalogSemanticRolesSchema,
  createCatalog,
  definePredicate,
  defineReducer,
  defineSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

export function createSupportCatalogB(): Catalog {
  const severity = defineSchema({
    id: "m7a/support-b/severity-band",
    version: "2026.2",
    description:
      "Integral triage severity in the inclusive zero-to-five range.",
    validator: z.number().int().gte(0).lte(5),
  });
  const requiresEscalation = definePredicate({
    id: "m7a/support-b/requires-escalation",
    version: "2026.2",
    description: "Escalate requests outside the zero-to-three routine bands.",
    input: severity,
    implementation: (value) => value > 3,
  });
  const mostSevere = defineReducer({
    id: "m7a/support-b/most-severe",
    version: "2026.2",
    description: "Combine priorities by selecting the most severe band.",
    element: severity,
    accumulator: severity,
    identity: 0,
    laws: { associative: true, commutative: true, idempotent: true },
    implementation: (left, right) => (left > right ? left : right),
  });
  const semanticRoles = catalogSemanticRolesSchema.parse({
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [
      {
        kind: "schema",
        role: { id: "m7a.role/support/priority", version: "1" },
        schema: { id: severity.id, version: severity.version },
        obligations: { mutuallyAcceptsConformanceValues: true },
      },
    ],
    operations: [
      {
        kind: "predicate",
        role: { id: "m7a.role/support/escalate", version: "1" },
        operation: {
          id: requiresEscalation.id,
          version: requiresEscalation.version,
        },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "reducer",
        role: { id: "m7a.role/support/highest-priority", version: "1" },
        operation: { id: mostSevere.id, version: mostSevere.version },
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
    identity: { id: "m7a/support-b/catalog", version: "2026.2" },
    schemas: [severity.runtime],
    operations: [mostSevere, requiresEscalation],
    semanticRoles,
  });
  if (!catalog.ok) throw new Error("Support author B catalog is invalid.");
  return catalog.value;
}
