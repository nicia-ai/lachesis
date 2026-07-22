import {
  type CatalogConformanceSuite,
  catalogConformanceSuiteSchema,
} from "@nicia-ai/lachesis-generator";

export const warehouseSuite: CatalogConformanceSuite =
  catalogConformanceSuiteSchema.parse({
    protocol: "lachesis-cross-catalog-conformance-suite/1",
    fixtures: [
      {
        kind: "schema",
        role: { id: "m7a.role/warehouse/units", version: "1" },
        values: [0, 1, 9, 10, 11, 999, 1_000],
      },
      {
        kind: "predicate",
        role: { id: "m7a.role/warehouse/needs-reorder", version: "1" },
        inputs: [0, 9, 10, 11, 1_000],
      },
      {
        kind: "reducer",
        role: { id: "m7a.role/warehouse/peak-demand", version: "1" },
        values: [0, 1, 10, 11, 1_000],
      },
    ],
  });

export const transitSuite: CatalogConformanceSuite =
  catalogConformanceSuiteSchema.parse({
    protocol: "lachesis-cross-catalog-conformance-suite/1",
    fixtures: [
      {
        kind: "schema",
        role: { id: "m7a.role/transit/delay-seconds", version: "1" },
        values: [0, 1, 299, 300, 301, 7_199, 7_200],
      },
      {
        kind: "predicate",
        role: { id: "m7a.role/transit/service-alert", version: "1" },
        inputs: [0, 299, 300, 301, 7_200],
      },
      {
        kind: "reducer",
        role: { id: "m7a.role/transit/worst-delay", version: "1" },
        values: [0, 1, 299, 300, 7_200],
      },
    ],
  });

export const supportSuite: CatalogConformanceSuite =
  catalogConformanceSuiteSchema.parse({
    protocol: "lachesis-cross-catalog-conformance-suite/1",
    fixtures: [
      {
        kind: "schema",
        role: { id: "m7a.role/support/priority", version: "1" },
        values: [0, 1, 2, 3, 4, 5],
      },
      {
        kind: "predicate",
        role: { id: "m7a.role/support/escalate", version: "1" },
        inputs: [0, 3, 4, 5],
      },
      {
        kind: "reducer",
        role: { id: "m7a.role/support/highest-priority", version: "1" },
        values: [0, 1, 3, 4, 5],
      },
    ],
  });
