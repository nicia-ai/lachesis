import { z } from "zod";

import { canonicalizeJson, hashCanonicalJson } from "./canonical.js";
import {
  type Catalog,
  readCatalog,
  referenceKey,
  type RuntimeOperation,
  type RuntimeSchema,
} from "./catalog.js";
import { type Diagnostic, diagnostic } from "./diagnostic.js";
import {
  type CatalogFingerprint,
  catalogFingerprintSchema,
  type ManifestDigest,
  manifestDigestSchema,
} from "./identity.js";
import { err, ok, type Result } from "./result.js";
import {
  type CatalogReference,
  type OperationReference,
  operationReferenceSchema,
  type PlanBudget,
  type SchemaReference,
  schemaReferenceSchema,
  wirePlanSchema,
} from "./wire.js";

type JsonValue = z.infer<ReturnType<typeof z.json>>;

export type CompilationPolicy = Readonly<{
  allowedCapabilities: ReadonlyArray<string>;
  budget: PlanBudget;
}>;

export type ManifestSchema = Readonly<{
  reference: SchemaReference;
  kind: RuntimeSchema["kind"];
  description: string;
  jsonSchema: JsonValue;
}>;

export type ManifestOperation = Readonly<{
  reference: OperationReference;
  kind: RuntimeOperation["kind"];
  description: string;
  input?: SchemaReference | undefined;
  output?: SchemaReference | undefined;
  element?: SchemaReference | undefined;
  accumulator?: SchemaReference | undefined;
  effect?:
    | Readonly<{
        name: string;
        capability: string;
        replayable: boolean;
      }>
    | undefined;
  bounds: Readonly<{
    maxOutputItems?: number | undefined;
    maxTokens?: number | undefined;
    maxWallClockMs?: number | undefined;
  }>;
  reducerLaws?:
    | Readonly<{
        associative: boolean;
        commutative: boolean;
        idempotent: boolean;
      }>
    | undefined;
}>;

type CatalogManifestCore = Readonly<{
  formatVersion: "1";
  catalog: CatalogReference;
  schemas: ReadonlyArray<ManifestSchema>;
  operations: ReadonlyArray<ManifestOperation>;
}>;

export type PlanLanguageManifest = CatalogManifestCore &
  Readonly<{
    planJsonSchema: JsonValue;
    catalogFingerprint: CatalogFingerprint;
    policy: CompilationPolicy;
    manifestDigest: ManifestDigest;
  }>;

function operationReference(operation: RuntimeOperation): OperationReference {
  return operationReferenceSchema.parse({
    id: operation.id,
    version: operation.version,
  });
}

function schemaReference(schema: RuntimeSchema): SchemaReference {
  return schemaReferenceSchema.parse({
    id: schema.id,
    version: schema.version,
  });
}

function operationManifest(operation: RuntimeOperation): ManifestOperation {
  const base = {
    reference: operationReference(operation),
    kind: operation.kind,
    description: operation.description,
  };
  if (operation.kind === "reducer") {
    return {
      ...base,
      element: operation.element,
      accumulator: operation.accumulator,
      bounds: {},
      reducerLaws: operation.laws,
    };
  }
  if (operation.kind === "predicate" || operation.kind === "measure") {
    return { ...base, input: operation.input, bounds: {} };
  }
  if (operation.kind === "effect") {
    return {
      ...base,
      input: operation.input,
      output: operation.output,
      effect: {
        name: operation.effectName,
        capability: operation.capability,
        replayable: operation.replayable,
      },
      bounds: {
        maxTokens: operation.maxTokens,
        maxWallClockMs: operation.maxWallClockMs,
        ...(operation.maxOutputItems === undefined
          ? {}
          : { maxOutputItems: operation.maxOutputItems }),
      },
    };
  }
  return {
    ...base,
    input: operation.input,
    output: operation.output,
    bounds:
      operation.kind === "function" && operation.maxOutputItems !== undefined
        ? { maxOutputItems: operation.maxOutputItems }
        : {},
  };
}

function catalogCore(catalog: Catalog): CatalogManifestCore {
  const state = readCatalog(catalog);
  return {
    formatVersion: "1",
    catalog: state.identity,
    schemas: [...state.schemas.values()]
      .map((schema) => ({
        reference: schemaReference(schema),
        kind: schema.kind,
        description: schema.description,
        jsonSchema: schema.jsonSchema,
      }))
      .toSorted((left, right) =>
        referenceKey(left.reference) < referenceKey(right.reference) ? -1 : 1,
      ),
    operations: [...state.operations.values()]
      .map(operationManifest)
      .toSorted((left, right) =>
        referenceKey(left.reference) < referenceKey(right.reference) ? -1 : 1,
      ),
  };
}

async function digestJson(value: unknown): Promise<Result<string, Diagnostic>> {
  const canonical = canonicalizeJson(value);
  return canonical.ok
    ? ok(await hashCanonicalJson(canonical.value))
    : err(
        diagnostic(
          "INTERNAL_INVARIANT_VIOLATION",
          "A language manifest was not canonical JSON.",
        ),
      );
}

export async function fingerprintCatalog(
  catalog: Catalog,
): Promise<Result<CatalogFingerprint, Diagnostic>> {
  const digest = await digestJson(catalogCore(catalog));
  return digest.ok ? ok(catalogFingerprintSchema.parse(digest.value)) : digest;
}

export async function createPlanLanguageManifest(
  catalog: Catalog,
  policy: CompilationPolicy,
): Promise<Result<PlanLanguageManifest, Diagnostic>> {
  const core = catalogCore(catalog);
  const fingerprint = await fingerprintCatalog(catalog);
  if (!fingerprint.ok) return fingerprint;
  const partial = {
    ...core,
    planJsonSchema: z.json().parse(z.toJSONSchema(wirePlanSchema)),
    catalogFingerprint: fingerprint.value,
    policy,
  };
  const digest = await digestJson(partial);
  return digest.ok
    ? ok({
        ...partial,
        manifestDigest: manifestDigestSchema.parse(digest.value),
      })
    : digest;
}
