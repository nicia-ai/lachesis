import {
  catalogSemanticRolesSchema,
  createCatalog,
  defineFunction,
  defineSchema,
} from "@nicia-ai/lachesis";
import {
  catalogConformanceSuiteSchema,
  conformCatalogsOffline,
  verifyCatalogConformanceReport,
} from "@nicia-ai/lachesis-generator";
import { z } from "zod";

function unwrap(result, label) {
  if (!result.ok) throw new Error(`${label} failed.`);
  return result.value;
}

function catalog(namespace) {
  const text = defineSchema({
    id: `${namespace}/text`,
    version: "1",
    description: "A public text value.",
    validator: z.string(),
  });
  const normalize = defineFunction({
    id: `${namespace}/normalize`,
    version: "1",
    description: "Normalize surrounding whitespace.",
    input: text,
    output: text,
    implementation: (value) => value.trim(),
  });
  const semanticRoles = catalogSemanticRolesSchema.parse({
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [
      {
        kind: "schema",
        role: { id: "example.role/text", version: "1" },
        schema: { id: text.id, version: text.version },
        obligations: { mutuallyAcceptsConformanceValues: true },
      },
    ],
    operations: [
      {
        kind: "function",
        role: { id: "example.role/normalize", version: "1" },
        operation: { id: normalize.id, version: normalize.version },
        obligations: {
          deterministic: true,
          totalOnConformanceValues: true,
          pointwiseEquivalent: true,
        },
      },
    ],
  });
  return unwrap(
    createCatalog({
      identity: { id: `${namespace}/catalog`, version: "1" },
      schemas: [text.runtime],
      operations: [normalize],
      semanticRoles,
    }),
    "catalog",
  );
}

const suite = catalogConformanceSuiteSchema.parse({
  protocol: "lachesis-cross-catalog-conformance-suite/1",
  fixtures: [
    {
      kind: "schema",
      role: { id: "example.role/text", version: "1" },
      values: ["", " public text "],
    },
    {
      kind: "function",
      role: { id: "example.role/normalize", version: "1" },
      inputs: ["", " public text "],
    },
  ],
});

const report = unwrap(
  await conformCatalogsOffline({
    left: catalog("example/alpha"),
    right: catalog("example/beta"),
    suite,
  }),
  "conformance",
);

unwrap(await verifyCatalogConformanceReport(report), "report verification");
if (report.checkedSchemaRoles !== 1 || report.checkedOperationRoles !== 1)
  process.exitCode = 1;
