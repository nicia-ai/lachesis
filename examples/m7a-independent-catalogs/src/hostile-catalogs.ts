import {
  type Catalog,
  catalogSemanticRolesSchema,
  createCatalog,
  definePredicate,
  defineReducer,
  defineSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

export const hostileCaseIds = [
  "blind-04",
  "blind-05",
  "blind-06",
  "blind-07",
  "blind-08",
  "blind-09",
  "blind-10",
  "blind-11",
  "blind-12",
] as const;

export type HostileCaseId = (typeof hostileCaseIds)[number];

type HostileDefinition = Readonly<{
  family: "warehouse" | "transit" | "support";
  schemaMaximum: number;
  schemaMinimum: number;
  predicate: (value: number) => boolean;
  reducer: (left: number, right: number) => number;
  roleVersion: string;
}>;

function definition(caseId: HostileCaseId): HostileDefinition {
  switch (caseId) {
    case "blind-04":
      return {
        family: "warehouse",
        schemaMinimum: 0,
        schemaMaximum: 999,
        predicate: (value) => value <= 10,
        reducer: Math.max,
        roleVersion: "1",
      };
    case "blind-05":
      return {
        family: "warehouse",
        schemaMinimum: 0,
        schemaMaximum: 1_000,
        predicate: (value) => value < 10,
        reducer: Math.max,
        roleVersion: "1",
      };
    case "blind-06":
      return {
        family: "warehouse",
        schemaMinimum: 0,
        schemaMaximum: 1_000,
        predicate: (value) => value <= 10,
        reducer: Math.min,
        roleVersion: "1",
      };
    case "blind-07":
      return {
        family: "transit",
        schemaMinimum: 0,
        schemaMaximum: 7_199,
        predicate: (value) => value >= 300,
        reducer: Math.max,
        roleVersion: "1",
      };
    case "blind-08":
      return {
        family: "transit",
        schemaMinimum: 0,
        schemaMaximum: 7_200,
        predicate: (value) => value > 300,
        reducer: Math.max,
        roleVersion: "1",
      };
    case "blind-09":
      return {
        family: "transit",
        schemaMinimum: 0,
        schemaMaximum: 7_200,
        predicate: (value) => value >= 300,
        reducer: Math.max,
        roleVersion: "2",
      };
    case "blind-10":
      return {
        family: "support",
        schemaMinimum: 1,
        schemaMaximum: 5,
        predicate: (value) => value >= 4,
        reducer: Math.max,
        roleVersion: "1",
      };
    case "blind-11":
      return {
        family: "support",
        schemaMinimum: 0,
        schemaMaximum: 5,
        predicate: (value) => value > 4,
        reducer: Math.max,
        roleVersion: "1",
      };
    case "blind-12":
      return {
        family: "support",
        schemaMinimum: 0,
        schemaMaximum: 5,
        predicate: (value) => value >= 4,
        reducer: Math.min,
        roleVersion: "1",
      };
  }
}

function familyContract(family: HostileDefinition["family"]): Readonly<{
  schemaRole: string;
  predicateRole: string;
  reducerRole: string;
}> {
  switch (family) {
    case "warehouse":
      return {
        schemaRole: "m7a.role/warehouse/units",
        predicateRole: "m7a.role/warehouse/needs-reorder",
        reducerRole: "m7a.role/warehouse/peak-demand",
      };
    case "transit":
      return {
        schemaRole: "m7a.role/transit/delay-seconds",
        predicateRole: "m7a.role/transit/service-alert",
        reducerRole: "m7a.role/transit/worst-delay",
      };
    case "support":
      return {
        schemaRole: "m7a.role/support/priority",
        predicateRole: "m7a.role/support/escalate",
        reducerRole: "m7a.role/support/highest-priority",
      };
  }
}

export function createHostileCatalog(caseId: HostileCaseId): Catalog {
  const selected = definition(caseId);
  const roles = familyContract(selected.family);
  const value = defineSchema({
    id: `m7a/hostile/${caseId}/value`,
    version: "1",
    description: "A deliberately near-equivalent adversarial value domain.",
    validator: z
      .number()
      .int()
      .min(selected.schemaMinimum)
      .max(selected.schemaMaximum),
  });
  const decision = definePredicate({
    id: `m7a/hostile/${caseId}/decision`,
    version: "1",
    description: "A deliberately near-equivalent adversarial decision.",
    input: value,
    implementation: selected.predicate,
  });
  const aggregate = defineReducer({
    id: `m7a/hostile/${caseId}/aggregate`,
    version: "1",
    description: "A deliberately near-equivalent adversarial aggregate.",
    element: value,
    accumulator: value,
    identity: selected.schemaMinimum,
    laws: { associative: true, commutative: true, idempotent: true },
    implementation: selected.reducer,
  });
  const semanticRoles = catalogSemanticRolesSchema.parse({
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [
      {
        kind: "schema",
        role: { id: roles.schemaRole, version: selected.roleVersion },
        schema: { id: value.id, version: value.version },
        obligations: { mutuallyAcceptsConformanceValues: true },
      },
    ],
    operations: [
      {
        kind: "predicate",
        role: { id: roles.predicateRole, version: selected.roleVersion },
        operation: { id: decision.id, version: decision.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "reducer",
        role: { id: roles.reducerRole, version: selected.roleVersion },
        operation: { id: aggregate.id, version: aggregate.version },
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
    identity: { id: `m7a/hostile/${caseId}/catalog`, version: "1" },
    schemas: [value.runtime],
    operations: [decision, aggregate],
    semanticRoles,
  });
  if (!catalog.ok) throw new Error(`Hostile catalog ${caseId} is invalid.`);
  return catalog.value;
}

export function createEvolvedWarehouseCatalog(): Catalog {
  const units = defineSchema({
    id: "m7a/warehouse-b-v2/stock-count",
    version: "2",
    description: "A warehouse stock count from zero through one thousand.",
    validator: z.number().int().min(0).max(1_000),
  });
  const reorder = definePredicate({
    id: "m7a/warehouse-b-v2/replenish",
    version: "2",
    description: "Flag stock counts at or below the ten-unit reorder point.",
    input: units,
    implementation: (value) => value <= 10,
  });
  const peak = defineReducer({
    id: "m7a/warehouse-b-v2/largest-demand",
    version: "2",
    description: "Select the largest demand count.",
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
        operation: { id: reorder.id, version: reorder.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
      {
        kind: "reducer",
        role: { id: "m7a.role/warehouse/peak-demand", version: "1" },
        operation: { id: peak.id, version: peak.version },
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
    identity: { id: "m7a/warehouse-b/catalog", version: "2" },
    schemas: [units.runtime],
    operations: [reorder, peak],
    semanticRoles,
  });
  if (!catalog.ok) throw new Error("Evolved warehouse catalog is invalid.");
  return catalog.value;
}
