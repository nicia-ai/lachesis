import {
  type Catalog,
  createPlanLanguageManifest,
  type Diagnostic,
  diagnostic,
  digestValue,
  modelPlanProposalSchema,
  type PlanLanguageManifest,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import type { FrozenPlanGenerationCase } from "./case.js";
import { type GenerationOutcome, generationOutcomeSchema } from "./model.js";

type JsonValue = z.infer<ReturnType<typeof z.json>>;

export const PORTABLE_TRANSPORT_COMPILER_VERSION =
  "lachesis-portable-transport-schema/3";
export const SUPPORTED_PORTABLE_TRANSPORT_COMPILER_VERSIONS = Object.freeze([
  "lachesis-portable-transport-schema/1",
  "lachesis-portable-transport-schema/2",
  PORTABLE_TRANSPORT_COMPILER_VERSION,
] as const);

export const structuredOutputTransportSchema = z
  .strictObject({
    formatVersion: z.literal("1"),
    compilerVersion: z.literal(PORTABLE_TRANSPORT_COMPILER_VERSION),
    manifestDigest: z.string().min(1),
    schemaDigest: z.string().min(1),
    jsonSchema: z.json(),
  })
  .readonly();

export type StructuredOutputTransport = z.infer<
  typeof structuredOutputTransportSchema
>;

export type CaseStructuredOutputTransport = Readonly<{
  caseDigest: string;
  transport: StructuredOutputTransport;
}>;

export type StructuredOutputCatalogResolver = (
  catalogId: string,
) => Result<Catalog, Diagnostic>;

const schemaObjectSchema = z.record(z.string(), z.unknown());
const stringArraySchema = z.array(z.string());
const jsonArraySchema = z.array(z.json());

const PORTABLE_SCHEMA_KEYS = new Set([
  "additionalProperties",
  "anyOf",
  "const",
  "enum",
  "items",
  "maximum",
  "maxItems",
  "maxLength",
  "minimum",
  "minItems",
  "minLength",
  "properties",
  "required",
  "type",
]);

const DECLARED_SCHEMA_ANNOTATIONS = new Set(["$schema", "readOnly"]);

function transportDiagnostic(message: string): Diagnostic {
  return diagnostic("INVALID_WIRE_SCHEMA", message);
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

function strictObject(
  entries: ReadonlyArray<readonly [string, JsonValue]>,
): JsonValue {
  const properties = z
    .record(z.string(), z.json())
    .parse(Object.fromEntries(entries));
  return {
    type: "object",
    properties,
    required: entries.map(([name]) => name),
    additionalProperties: false,
  };
}

function nullable(schema: JsonValue): JsonValue {
  return { anyOf: [schema, { type: "null" }] };
}

function referenceSchema(
  references: ReadonlyArray<Readonly<{ id: string; version: string }>>,
): JsonValue {
  return {
    anyOf: references.map((reference) =>
      strictObject([
        ["id", { type: "string", const: reference.id }],
        ["version", { type: "string", const: reference.version }],
      ]),
    ),
  };
}

function operationSchema(
  operations: ReadonlyArray<
    Readonly<{ kind: "function" | "effect"; id: string; version: string }>
  >,
): JsonValue {
  return {
    anyOf: operations.map((operation) =>
      strictObject([
        ["kind", { type: "string", const: operation.kind }],
        ["id", { type: "string", const: operation.id }],
        ["version", { type: "string", const: operation.version }],
      ]),
    ),
  };
}

function allowedKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  subject: string,
): Result<void, Diagnostic> {
  const unsupported = Object.keys(value).find(
    (key) => !allowed.has(key) && !DECLARED_SCHEMA_ANNOTATIONS.has(key),
  );
  return unsupported === undefined
    ? { ok: true, value: undefined }
    : {
        ok: false,
        error: transportDiagnostic(
          `${subject} uses unsupported JSON Schema keyword ${unsupported}.`,
        ),
      };
}

function optionalIntegerKeyword(
  value: Readonly<Record<string, unknown>>,
  key: "minItems" | "maxItems" | "minLength" | "maxLength",
): Result<number | undefined, Diagnostic> {
  const candidate = value[key];
  if (candidate === undefined) return { ok: true, value: undefined };
  const parsed = z.number().int().nonnegative().safeParse(candidate);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        error: transportDiagnostic(`${key} must be a nonnegative integer.`),
      };
}

function optionalNumberKeyword(
  value: Readonly<Record<string, unknown>>,
  key: "minimum" | "maximum",
): Result<number | undefined, Diagnostic> {
  const candidate = value[key];
  if (candidate === undefined) return { ok: true, value: undefined };
  const parsed = z.number().safeParse(candidate);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        error: transportDiagnostic(`${key} must be a finite number.`),
      };
}

function enumKeyword(
  value: Readonly<Record<string, unknown>>,
): Result<ReadonlyArray<JsonValue> | undefined, Diagnostic> {
  if (value["enum"] === undefined) return { ok: true, value: undefined };
  const parsed = jsonArraySchema.min(1).safeParse(value["enum"]);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        error: transportDiagnostic("enum must contain JSON values."),
      };
}

function compileDeclaredSchema(
  value: unknown,
  subject: string,
): Result<JsonValue, Diagnostic> {
  const parsed = schemaObjectSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      error: transportDiagnostic(`${subject} is not a JSON Schema object.`),
    };
  const raw = parsed.data;
  const type = z
    .enum(["boolean", "integer", "number", "string", "array", "object"])
    .safeParse(raw["type"]);
  if (!type.success)
    return {
      ok: false,
      error: transportDiagnostic(`${subject} must declare one portable type.`),
    };
  const enumeration = enumKeyword(raw);
  if (!enumeration.ok) return enumeration;
  const constant =
    raw["const"] === undefined ? undefined : z.json().safeParse(raw["const"]);
  if (constant !== undefined && !constant.success)
    return {
      ok: false,
      error: transportDiagnostic(`${subject} const must be JSON.`),
    };

  if (
    type.data === "boolean" ||
    type.data === "integer" ||
    type.data === "number" ||
    type.data === "string"
  ) {
    const allowed = new Set(["type", "enum", "const"]);
    if (type.data === "string") {
      allowed.add("minLength");
      allowed.add("maxLength");
    }
    if (type.data === "integer" || type.data === "number") {
      allowed.add("minimum");
      allowed.add("maximum");
    }
    const checked = allowedKeys(raw, allowed, subject);
    if (!checked.ok) return checked;
    const minimum = optionalNumberKeyword(raw, "minimum");
    const maximum = optionalNumberKeyword(raw, "maximum");
    const minLength = optionalIntegerKeyword(raw, "minLength");
    const maxLength = optionalIntegerKeyword(raw, "maxLength");
    if (!minimum.ok) return { ok: false, error: minimum.error };
    if (!maximum.ok) return { ok: false, error: maximum.error };
    if (!minLength.ok) return { ok: false, error: minLength.error };
    if (!maxLength.ok) return { ok: false, error: maxLength.error };
    return {
      ok: true,
      value: z.json().parse({
        type: type.data,
        ...(minimum.value === undefined ? {} : { minimum: minimum.value }),
        ...(maximum.value === undefined ? {} : { maximum: maximum.value }),
        ...(minLength.value === undefined
          ? {}
          : { minLength: minLength.value }),
        ...(maxLength.value === undefined
          ? {}
          : { maxLength: maxLength.value }),
        ...(enumeration.value === undefined ? {} : { enum: enumeration.value }),
        ...(constant === undefined ? {} : { const: constant.data }),
      }),
    };
  }

  if (type.data === "array") {
    const checked = allowedKeys(
      raw,
      new Set(["type", "items", "minItems", "maxItems"]),
      subject,
    );
    if (!checked.ok) return checked;
    if (raw["items"] === undefined)
      return {
        ok: false,
        error: transportDiagnostic(`${subject} array must declare items.`),
      };
    const items = compileDeclaredSchema(raw["items"], `${subject}.items`);
    if (!items.ok) return items;
    const minItems = optionalIntegerKeyword(raw, "minItems");
    const maxItems = optionalIntegerKeyword(raw, "maxItems");
    if (!minItems.ok) return { ok: false, error: minItems.error };
    if (!maxItems.ok) return { ok: false, error: maxItems.error };
    return {
      ok: true,
      value: {
        type: "array",
        items: items.value,
        ...(minItems.value === undefined ? {} : { minItems: minItems.value }),
        ...(maxItems.value === undefined ? {} : { maxItems: maxItems.value }),
      },
    };
  }

  const checked = allowedKeys(
    raw,
    new Set(["type", "properties", "required", "additionalProperties"]),
    subject,
  );
  if (!checked.ok) return checked;
  const properties = schemaObjectSchema.safeParse(raw["properties"]);
  const required = stringArraySchema.safeParse(raw["required"]);
  if (
    !properties.success ||
    !required.success ||
    raw["additionalProperties"] !== false
  )
    return {
      ok: false,
      error: transportDiagnostic(
        `${subject} object must be closed and require every declared property.`,
      ),
    };
  const propertyNames = Object.keys(properties.data).toSorted();
  const requiredNames = [...required.data].toSorted();
  if (
    propertyNames.length !== requiredNames.length ||
    !propertyNames.every((name, index) => name === requiredNames[index])
  )
    return {
      ok: false,
      error: transportDiagnostic(
        `${subject} optional object properties are not portable.`,
      ),
    };
  const compiledEntries: Array<readonly [string, JsonValue]> = [];
  for (const name of propertyNames) {
    const property = compileDeclaredSchema(
      properties.data[name],
      `${subject}.properties.${name}`,
    );
    if (!property.ok) return property;
    compiledEntries.push([name, property.value]);
  }
  return { ok: true, value: strictObject(compiledEntries) };
}

function validatePortableNode(
  value: unknown,
  path: string,
): Result<void, Diagnostic> {
  const parsed = schemaObjectSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      error: transportDiagnostic(`${path} is not a schema object.`),
    };
  const node = parsed.data;
  const unsupported = Object.keys(node).find(
    (key) => !PORTABLE_SCHEMA_KEYS.has(key),
  );
  if (unsupported !== undefined)
    return {
      ok: false,
      error: transportDiagnostic(
        `${path} contains non-portable keyword ${unsupported}.`,
      ),
    };
  if (node["properties"] !== undefined) {
    if (node["type"] !== "object" || node["additionalProperties"] !== false)
      return {
        ok: false,
        error: transportDiagnostic(`${path} contains an open object schema.`),
      };
    const properties = schemaObjectSchema.safeParse(node["properties"]);
    const required = stringArraySchema.safeParse(node["required"]);
    if (!properties.success || !required.success)
      return {
        ok: false,
        error: transportDiagnostic(`${path} has invalid object properties.`),
      };
    const names = Object.keys(properties.data).toSorted();
    const requiredNames = [...required.data].toSorted();
    if (
      names.length !== requiredNames.length ||
      !names.every((name, index) => name === requiredNames[index])
    )
      return {
        ok: false,
        error: transportDiagnostic(
          `${path} must require every object property.`,
        ),
      };
    for (const name of names) {
      const child = validatePortableNode(
        properties.data[name],
        `${path}.properties.${name}`,
      );
      if (!child.ok) return child;
    }
  }
  if (node["items"] !== undefined) {
    const child = validatePortableNode(node["items"], `${path}.items`);
    if (!child.ok) return child;
  }
  if (node["anyOf"] !== undefined) {
    const variants = z.array(z.unknown()).min(1).safeParse(node["anyOf"]);
    if (!variants.success)
      return {
        ok: false,
        error: transportDiagnostic(`${path}.anyOf must contain schemas.`),
      };
    for (let index = 0; index < variants.data.length; index += 1) {
      const child = validatePortableNode(
        variants.data[index],
        `${path}.anyOf.${index}`,
      );
      if (!child.ok) return child;
    }
  }
  return { ok: true, value: undefined };
}

export function validatePortableStructuredOutputSchema(
  value: unknown,
): Result<void, Diagnostic> {
  const parsed = schemaObjectSchema.safeParse(value);
  if (!parsed.success || parsed.data["type"] !== "object")
    return {
      ok: false,
      error: transportDiagnostic(
        "Portable structured output must have an object root.",
      ),
    };
  return validatePortableNode(parsed.data, "structuredOutputSchema");
}

function nodeBase(op: string): ReadonlyArray<readonly [string, JsonValue]> {
  return [
    ["id", { type: "string", minLength: 1, maxLength: 128 }],
    ["op", { type: "string", const: op }],
  ];
}

function planSchema(
  manifest: PlanLanguageManifest,
  declaredSchemas: ReadonlyMap<string, JsonValue>,
): JsonValue {
  const schemas = manifest.schemas.map((schema) => schema.reference);
  const collections = manifest.schemas
    .filter((schema) => schema.kind.kind === "collection")
    .map((schema) => schema.reference);
  const operations = (
    kind:
      | "function"
      | "predicate"
      | "reducer"
      | "effect"
      | "fixedPointStep"
      | "measure",
  ) =>
    manifest.operations
      .filter((operation) => operation.kind === kind)
      .filter(
        (operation) =>
          operation.kind !== "effect" ||
          (operation.effect !== undefined &&
            manifest.policy.allowedCapabilities.includes(
              operation.effect.capability,
            )),
      )
      .map((operation) => operation.reference);
  const nodes: Array<JsonValue> = [];
  nodes.push(
    strictObject([
      ...nodeBase("input"),
      ["inputKey", { type: "string", minLength: 1, maxLength: 128 }],
      ["schema", referenceSchema(schemas)],
    ]),
  );
  for (const schema of manifest.schemas) {
    const valueSchema = declaredSchemas.get(
      `${schema.reference.id}@${schema.reference.version}`,
    );
    if (valueSchema !== undefined)
      nodes.push(
        strictObject([
          ...nodeBase("constant"),
          ["schema", referenceSchema([schema.reference])],
          ["value", valueSchema],
        ]),
      );
  }
  const functions = operations("function");
  if (functions.length > 0)
    nodes.push(
      strictObject([
        ...nodeBase("invoke"),
        ["source", { type: "string", minLength: 1, maxLength: 128 }],
        ["function", referenceSchema(functions)],
      ]),
    );
  const mapOperations = [
    ...functions.map((reference) => ({
      kind: "function" as const,
      ...reference,
    })),
    ...operations("effect").map((reference) => ({
      kind: "effect" as const,
      ...reference,
    })),
  ];
  if (mapOperations.length > 0 && collections.length > 0)
    nodes.push(
      strictObject([
        ...nodeBase("map"),
        ["source", { type: "string", minLength: 1, maxLength: 128 }],
        ["operation", operationSchema(mapOperations)],
        ["outputCollectionSchema", referenceSchema(collections)],
        [
          "parallelism",
          {
            type: "integer",
            minimum: 1,
            maximum: manifest.policy.budget.maxParallelism,
          },
        ],
      ]),
    );
  const predicates = operations("predicate");
  if (predicates.length > 0)
    nodes.push(
      strictObject([
        ...nodeBase("filter"),
        ["source", { type: "string", minLength: 1, maxLength: 128 }],
        ["predicate", referenceSchema(predicates)],
      ]),
    );
  const reducers = operations("reducer");
  if (reducers.length > 0)
    nodes.push(
      strictObject([
        ...nodeBase("fold"),
        ["source", { type: "string", minLength: 1, maxLength: 128 }],
        ["reducer", referenceSchema(reducers)],
      ]),
    );
  nodes.push(
    strictObject([
      ...nodeBase("select"),
      ["condition", { type: "string", minLength: 1, maxLength: 128 }],
      ["whenTrue", { type: "string", minLength: 1, maxLength: 128 }],
      ["whenFalse", { type: "string", minLength: 1, maxLength: 128 }],
    ]),
  );
  const effects = operations("effect");
  if (effects.length > 0)
    nodes.push(
      strictObject([
        ...nodeBase("effect"),
        ["source", { type: "string", minLength: 1, maxLength: 128 }],
        ["effect", referenceSchema(effects)],
      ]),
    );
  nodes.push(
    strictObject([
      ...nodeBase("checkpoint"),
      ["source", { type: "string", minLength: 1, maxLength: 128 }],
      ["label", { type: "string", minLength: 1, maxLength: 128 }],
    ]),
  );
  const steps = operations("fixedPointStep");
  const measures = operations("measure");
  if (
    steps.length > 0 &&
    measures.length > 0 &&
    manifest.policy.budget.maxRecursionDepth > 0
  )
    nodes.push(
      strictObject([
        ...nodeBase("boundedFix"),
        ["seed", { type: "string", minLength: 1, maxLength: 128 }],
        ["step", referenceSchema(steps)],
        ["measure", referenceSchema(measures)],
        [
          "maxIterations",
          {
            type: "integer",
            minimum: 1,
            maximum: manifest.policy.budget.maxRecursionDepth,
          },
        ],
      ]),
    );
  return strictObject([
    ["formatVersion", { type: "string", const: "1" }],
    ["catalog", referenceSchema([manifest.catalog])],
    ["root", { type: "string", minLength: 1, maxLength: 128 }],
    [
      "nodes",
      { type: "array", items: { anyOf: nodes }, minItems: 1, maxItems: 10_000 },
    ],
    [
      "metadata",
      nullable(
        strictObject([
          ["name", { type: "string", minLength: 1, maxLength: 256 }],
          ["revision", { type: "string", minLength: 1, maxLength: 128 }],
        ]),
      ),
    ],
  ]);
}

export async function compileStructuredOutputTransport(
  manifest: PlanLanguageManifest,
): Promise<Result<StructuredOutputTransport, Diagnostic>> {
  const declaredSchemas = new Map<string, JsonValue>();
  for (const schema of manifest.schemas) {
    const compiled = compileDeclaredSchema(
      schema.jsonSchema,
      `Catalog schema ${schema.reference.id}@${schema.reference.version}`,
    );
    if (!compiled.ok) return compiled;
    const bounded =
      schema.kind.kind === "collection" &&
      schema.kind.defaultMaxItems !== undefined &&
      typeof compiled.value === "object" &&
      compiled.value !== null &&
      !Array.isArray(compiled.value)
        ? { ...compiled.value, maxItems: schema.kind.defaultMaxItems }
        : compiled.value;
    declaredSchemas.set(
      `${schema.reference.id}@${schema.reference.version}`,
      bounded,
    );
  }
  const jsonSchema: JsonValue = strictObject([
    [
      "outcome",
      {
        anyOf: [
          strictObject([
            ["kind", { type: "string", const: "plan" }],
            ["plan", planSchema(manifest, declaredSchemas)],
          ]),
          strictObject([
            ["kind", { type: "string", const: "unplannable" }],
            [
              "witness",
              {
                anyOf: [
                  strictObject([
                    ["kind", { type: "string", const: "missingOperation" }],
                    [
                      "operation",
                      strictObject([
                        [
                          "id",
                          { type: "string", minLength: 1, maxLength: 128 },
                        ],
                        [
                          "version",
                          { type: "string", minLength: 1, maxLength: 64 },
                        ],
                      ]),
                    ],
                  ]),
                  strictObject([
                    ["kind", { type: "string", const: "deniedCapability" }],
                    [
                      "operation",
                      strictObject([
                        [
                          "id",
                          { type: "string", minLength: 1, maxLength: 128 },
                        ],
                        [
                          "version",
                          { type: "string", minLength: 1, maxLength: 64 },
                        ],
                      ]),
                    ],
                    [
                      "capability",
                      { type: "string", minLength: 1, maxLength: 128 },
                    ],
                  ]),
                  strictObject([
                    ["kind", { type: "string", const: "insufficientBudget" }],
                    [
                      "operation",
                      strictObject([
                        [
                          "id",
                          { type: "string", minLength: 1, maxLength: 128 },
                        ],
                        [
                          "version",
                          { type: "string", minLength: 1, maxLength: 64 },
                        ],
                      ]),
                    ],
                    [
                      "resource",
                      {
                        type: "string",
                        enum: [
                          "maxEffectCalls",
                          "maxRecursionDepth",
                          "maxTokens",
                          "maxWallClockMs",
                        ],
                      },
                    ],
                    ["requiredMinimum", { type: "integer", minimum: 1 }],
                  ]),
                ],
              },
            ],
          ]),
        ],
      },
    ],
  ]);
  const portable = validatePortableStructuredOutputSchema(jsonSchema);
  if (!portable.ok) return portable;
  const digest = await digestValue(jsonSchema);
  if (!digest.ok) return digest;
  const transport = structuredOutputTransportSchema.parse({
    formatVersion: "1",
    compilerVersion: PORTABLE_TRANSPORT_COMPILER_VERSION,
    manifestDigest: manifest.manifestDigest,
    schemaDigest: digest.value,
    jsonSchema,
  });
  deepFreeze(transport);
  return { ok: true, value: transport };
}

export async function compileCaseStructuredOutputTransports(
  cases: ReadonlyArray<FrozenPlanGenerationCase>,
  resolveCatalog: StructuredOutputCatalogResolver,
): Promise<Result<ReadonlyArray<CaseStructuredOutputTransport>, Diagnostic>> {
  const compiled: Array<CaseStructuredOutputTransport> = [];
  for (const frozenCase of cases) {
    const catalog = resolveCatalog(frozenCase.case.catalogId);
    if (!catalog.ok) return catalog;
    const manifest = await createPlanLanguageManifest(
      catalog.value,
      frozenCase.case.policy,
    );
    if (!manifest.ok) return manifest;
    const transport = await compileStructuredOutputTransport(manifest.value);
    if (!transport.ok) return transport;
    compiled.push({
      caseDigest: frozenCase.digest,
      transport: transport.value,
    });
  }
  return { ok: true, value: Object.freeze(compiled) };
}

function normalizePlan(value: unknown): Result<unknown, Diagnostic> {
  const plan = schemaObjectSchema.safeParse(value);
  if (!plan.success)
    return {
      ok: false,
      error: transportDiagnostic("Transport plan must be an object."),
    };
  const normalizedPlan = Object.fromEntries(
    Object.entries(plan.data).filter(
      ([name, item]) => !(name === "metadata" && item === null),
    ),
  );
  const parsed = modelPlanProposalSchema.safeParse(normalizedPlan);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        error: transportDiagnostic(
          `Transport plan did not normalize to a model computation proposal: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
        ),
      };
}

export function normalizeStructuredOutputEnvelope(
  value: unknown,
): Result<GenerationOutcome, Diagnostic> {
  const envelope = z.strictObject({ outcome: z.unknown() }).safeParse(value);
  if (!envelope.success)
    return {
      ok: false,
      error: transportDiagnostic(
        "Structured output must use the versioned outcome envelope.",
      ),
    };
  const kind = z
    .looseObject({ kind: z.enum(["plan", "unplannable"]) })
    .safeParse(envelope.data.outcome);
  if (!kind.success)
    return {
      ok: false,
      error: transportDiagnostic("Transport outcome has an invalid kind."),
    };
  if (kind.data.kind === "unplannable") {
    const parsed = generationOutcomeSchema.safeParse(envelope.data.outcome);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : {
          ok: false,
          error: transportDiagnostic(
            "Transport abstention does not match GenerationOutcome.",
          ),
        };
  }
  const planOutcome = z
    .looseObject({ kind: z.literal("plan"), plan: z.unknown() })
    .safeParse(envelope.data.outcome);
  if (!planOutcome.success)
    return {
      ok: false,
      error: transportDiagnostic("Transport plan outcome is malformed."),
    };
  const plan = normalizePlan(planOutcome.data.plan);
  return plan.ok
    ? { ok: true, value: { kind: "plan", plan: plan.value } }
    : plan;
}
