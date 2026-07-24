import type { z } from "zod";

import { strictJsonValueSchema } from "./canonical.js";
import { type Diagnostic, diagnostic } from "./diagnostic.js";
import { snapshotZodJsonSchema } from "./json.js";
import { err, ok, type Result } from "./result.js";
import {
  type CatalogSemanticRoles,
  type CatalogSemanticRolesInput,
  catalogSemanticRolesSchema,
} from "./semantic-role.js";
import {
  type CatalogReference,
  catalogReferenceSchema,
  type OperationReference,
  operationReferenceSchema,
  type SchemaReference,
  schemaReferenceSchema,
} from "./wire.js";

type JsonValue = z.infer<ReturnType<typeof z.json>>;
type Reference = Readonly<{ id: string; version: string }>;

export type SchemaKind =
  | Readonly<{ kind: "scalar"; semantic?: "boolean" | undefined }>
  | Readonly<{
      kind: "collection";
      element: SchemaReference;
      defaultMaxItems?: number | undefined;
    }>;

export type RuntimeSchema = Readonly<{
  id: SchemaReference["id"];
  version: string;
  description: string;
  jsonSchema: JsonValue;
  kind: SchemaKind;
  parse: (value: unknown) => Result<unknown, Diagnostic>;
}>;

export type SchemaRegistration<T> = Readonly<{
  id: string;
  version: string;
  kind: SchemaKind;
  parse: (value: unknown) => Result<T, Diagnostic>;
  runtime: RuntimeSchema;
}>;

type OperationBase = Readonly<{
  id: OperationReference["id"];
  version: string;
  description: string;
  input: SchemaReference;
  semantics: OperationSemantics;
}>;

export type OperationSemantics = Readonly<{
  stateChanging: boolean;
}>;

export type RuntimeFunction = OperationBase &
  Readonly<{
    kind: "function";
    output: SchemaReference;
    maxOutputItems?: number | undefined;
    invoke: (input: unknown) => Result<unknown, Diagnostic>;
  }>;

export type RuntimePredicate = OperationBase &
  Readonly<{
    kind: "predicate";
    test: (input: unknown) => Result<boolean, Diagnostic>;
  }>;

export type ReducerLaws = Readonly<{
  associative: boolean;
  commutative: boolean;
  idempotent: boolean;
}>;

export type RuntimeReducer = Readonly<{
  kind: "reducer";
  id: OperationReference["id"];
  version: string;
  description: string;
  element: SchemaReference;
  accumulator: SchemaReference;
  identity: unknown;
  laws: ReducerLaws;
  semantics: OperationSemantics;
  reduce: (
    accumulator: unknown,
    element: unknown,
  ) => Result<unknown, Diagnostic>;
}>;

export type RuntimeEffect = OperationBase &
  Readonly<{
    kind: "effect";
    output: SchemaReference;
    effectName: string;
    capability: string;
    maxTokens: number;
    maxWallClockMs: number;
    replayable: boolean;
    maxOutputItems?: number | undefined;
  }>;

export type RuntimeFixedPointStep = OperationBase &
  Readonly<{
    kind: "fixedPointStep";
    output: SchemaReference;
    invoke: (input: unknown) => Result<unknown, Diagnostic>;
  }>;

export type RuntimeMeasure = OperationBase &
  Readonly<{
    kind: "measure";
    measure: (input: unknown) => Result<number, Diagnostic>;
  }>;

export type RuntimeOperation =
  | RuntimeFunction
  | RuntimePredicate
  | RuntimeReducer
  | RuntimeEffect
  | RuntimeFixedPointStep
  | RuntimeMeasure;

const catalogBrand: unique symbol = Symbol("Catalog");

export type Catalog = Readonly<{
  [catalogBrand]: "Catalog";
}>;

export type CatalogState = Readonly<{
  identity: CatalogReference;
  schemas: ReadonlyMap<string, RuntimeSchema>;
  operations: ReadonlyMap<string, RuntimeOperation>;
  semanticRoles?: CatalogSemanticRoles | undefined;
}>;

export type CatalogDescription = Readonly<{
  identity: CatalogReference;
  semanticRoles?: CatalogSemanticRoles | undefined;
  schemas: ReadonlyArray<
    Readonly<{
      id: SchemaReference["id"];
      version: string;
      description: string;
      jsonSchema: JsonValue;
      kind: SchemaKind;
    }>
  >;
  operations: ReadonlyArray<
    Readonly<{
      id: OperationReference["id"];
      version: string;
      kind: RuntimeOperation["kind"];
      description: string;
      input?: SchemaReference | undefined;
      semantics: OperationSemantics;
    }>
  >;
}>;

const catalogStates = new WeakMap<Catalog, CatalogState>();

export function readCatalog(catalog: Catalog): CatalogState {
  const state = catalogStates.get(catalog);
  if (state === undefined) throw new Error("Invalid Catalog token.");
  return state;
}

export function snapshotCatalog(catalog: Catalog): Catalog {
  const state = readCatalog(catalog);
  return storeCatalog({
    identity: state.identity,
    schemas: new Map(state.schemas),
    operations: new Map(state.operations),
    ...(state.semanticRoles === undefined
      ? {}
      : { semanticRoles: state.semanticRoles }),
  });
}

function storeCatalog(state: CatalogState): Catalog {
  const token: Catalog = Object.freeze({ [catalogBrand]: "Catalog" });
  catalogStates.set(token, Object.freeze(state));
  return token;
}

export function referenceKey(reference: Reference): string {
  return `${reference.id}@${reference.version}`;
}

function compareKeys(left: Reference, right: Reference): number {
  const leftKey = referenceKey(left);
  const rightKey = referenceKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function schemaReference(id: string, version: string): SchemaReference {
  return schemaReferenceSchema.parse({ id, version });
}

function operationReference(id: string, version: string): OperationReference {
  return operationReferenceSchema.parse({ id, version });
}

function freezeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (const item of value) freezeJson(item);
  } else {
    for (const item of Object.values(value)) freezeJson(item);
  }
  Object.freeze(value);
  return value;
}

function freezeRuntimeSchema(schema: RuntimeSchema): RuntimeSchema {
  const kind =
    schema.kind.kind === "scalar"
      ? Object.freeze({ ...schema.kind })
      : Object.freeze({
          ...schema.kind,
          element: Object.freeze({ ...schema.kind.element }),
        });
  return Object.freeze({
    ...schema,
    kind,
    jsonSchema: freezeJson(schema.jsonSchema),
  });
}

function freezeRuntimeOperation(operation: RuntimeOperation): RuntimeOperation {
  if (operation.kind === "reducer") {
    return Object.freeze({
      ...operation,
      element: Object.freeze({ ...operation.element }),
      accumulator: Object.freeze({ ...operation.accumulator }),
      laws: Object.freeze({ ...operation.laws }),
    });
  }
  const input = Object.freeze({ ...operation.input });
  if (operation.kind === "predicate" || operation.kind === "measure") {
    return Object.freeze({ ...operation, input });
  }
  return Object.freeze({
    ...operation,
    input,
    output: Object.freeze({ ...operation.output }),
  });
}

function runtimeValidationDiagnostic(
  subject: string,
  message: string,
): Diagnostic {
  return diagnostic("RUNTIME_SCHEMA_VIOLATION", `${subject}: ${message}`);
}

/** Registers a scalar Zod trust boundary while retaining its typed validator in a closure. */
export function defineSchema<T>(
  definition: Readonly<{
    id: string;
    version: string;
    description: string;
    validator: z.ZodType<T>;
    semantic?: "boolean" | undefined;
  }>,
): SchemaRegistration<T> {
  function parse(value: unknown): Result<T, Diagnostic> {
    const parsed = definition.validator.safeParse(value);
    if (!parsed.success) {
      return err(
        runtimeValidationDiagnostic(
          definition.id,
          parsed.error.issues.map((issue) => issue.message).join("; "),
        ),
      );
    }
    return strictJsonValueSchema.safeParse(parsed.data).success
      ? ok(parsed.data)
      : err(
          runtimeValidationDiagnostic(
            definition.id,
            "Schema value must be JSON serializable.",
          ),
        );
  }
  const kind: SchemaKind = {
    kind: "scalar",
    ...(definition.semantic === undefined
      ? {}
      : { semantic: definition.semantic }),
  };
  const runtime: RuntimeSchema = {
    id: schemaReference(definition.id, definition.version).id,
    version: definition.version,
    description: definition.description,
    jsonSchema: snapshotZodJsonSchema(definition.validator),
    kind,
    parse,
  };
  return { ...runtime, parse, runtime };
}

/** Registers a collection and the nominal identity of its element schema. */
export function defineCollectionSchema<T>(
  definition: Readonly<{
    id: string;
    version: string;
    description: string;
    validator: z.ZodType<ReadonlyArray<T>>;
    element: SchemaRegistration<T>;
    defaultMaxItems?: number | undefined;
  }>,
): SchemaRegistration<ReadonlyArray<T>> {
  const kind: SchemaKind = {
    kind: "collection",
    element: schemaReference(definition.element.id, definition.element.version),
    ...(definition.defaultMaxItems === undefined
      ? {}
      : { defaultMaxItems: definition.defaultMaxItems }),
  };
  function parse(value: unknown): Result<ReadonlyArray<T>, Diagnostic> {
    const parsed = definition.validator.safeParse(value);
    if (!parsed.success) {
      return err(
        runtimeValidationDiagnostic(
          definition.id,
          parsed.error.issues.map((issue) => issue.message).join("; "),
        ),
      );
    }
    return strictJsonValueSchema.safeParse(parsed.data).success
      ? ok(parsed.data)
      : err(
          runtimeValidationDiagnostic(
            definition.id,
            "Schema value must be JSON serializable.",
          ),
        );
  }
  const runtime: RuntimeSchema = {
    id: schemaReference(definition.id, definition.version).id,
    version: definition.version,
    description: definition.description,
    jsonSchema: snapshotZodJsonSchema(definition.validator),
    kind,
    parse,
  };
  return {
    id: definition.id,
    version: definition.version,
    kind,
    parse,
    runtime,
  };
}

function runTyped<I, O>(
  subject: string,
  inputSchema: SchemaRegistration<I>,
  outputSchema: SchemaRegistration<O>,
  implementation: (input: I) => O,
  input: unknown,
): Result<unknown, Diagnostic> {
  const parsedInput = inputSchema.parse(input);
  if (!parsedInput.ok) return parsedInput;
  const output = implementation(parsedInput.value);
  const parsedOutput = outputSchema.parse(output);
  if (!parsedOutput.ok) {
    return err(
      runtimeValidationDiagnostic(subject, parsedOutput.error.message),
    );
  }
  return ok(parsedOutput.value);
}

/** Erases a pure typed implementation only after input/output validation is installed. */
export function defineFunction<I, O>(
  definition: Readonly<{
    id: string;
    version: string;
    description: string;
    input: SchemaRegistration<I>;
    output: SchemaRegistration<O>;
    implementation: (input: I) => O;
    maxOutputItems?: number | undefined;
    stateChanging?: boolean | undefined;
  }>,
): RuntimeFunction {
  return {
    kind: "function",
    id: operationReference(definition.id, definition.version).id,
    version: definition.version,
    description: definition.description,
    input: schemaReference(definition.input.id, definition.input.version),
    semantics: Object.freeze({
      stateChanging: definition.stateChanging ?? false,
    }),
    output: schemaReference(definition.output.id, definition.output.version),
    ...(definition.maxOutputItems === undefined
      ? {}
      : { maxOutputItems: definition.maxOutputItems }),
    invoke: (input) =>
      runTyped(
        definition.id,
        definition.input,
        definition.output,
        definition.implementation,
        input,
      ),
  };
}

/** Registers a validated pure predicate. */
export function definePredicate<I>(
  definition: Readonly<{
    id: string;
    version: string;
    description: string;
    input: SchemaRegistration<I>;
    implementation: (input: I) => boolean;
    stateChanging?: boolean | undefined;
  }>,
): RuntimePredicate {
  return {
    kind: "predicate",
    id: operationReference(definition.id, definition.version).id,
    version: definition.version,
    description: definition.description,
    input: schemaReference(definition.input.id, definition.input.version),
    semantics: Object.freeze({
      stateChanging: definition.stateChanging ?? false,
    }),
    test(input: unknown): Result<boolean, Diagnostic> {
      const parsed = definition.input.parse(input);
      return parsed.ok ? ok(definition.implementation(parsed.value)) : parsed;
    },
  };
}

/** Registers a validated reducer plus the algebraic laws claimed by its author. */
export function defineReducer<E, A>(
  definition: Readonly<{
    id: string;
    version: string;
    description: string;
    element: SchemaRegistration<E>;
    accumulator: SchemaRegistration<A>;
    identity: A;
    laws: ReducerLaws;
    implementation: (accumulator: A, element: E) => A;
    stateChanging?: boolean | undefined;
  }>,
): RuntimeReducer {
  const identity = definition.accumulator.parse(definition.identity);
  if (!identity.ok) {
    throw new Error(
      `Invalid reducer identity for ${definition.id}: ${identity.error.message}`,
    );
  }
  return {
    kind: "reducer",
    id: operationReference(definition.id, definition.version).id,
    version: definition.version,
    description: definition.description,
    element: schemaReference(definition.element.id, definition.element.version),
    accumulator: schemaReference(
      definition.accumulator.id,
      definition.accumulator.version,
    ),
    identity: identity.value,
    laws: definition.laws,
    semantics: Object.freeze({
      stateChanging: definition.stateChanging ?? false,
    }),
    reduce(
      accumulator: unknown,
      element: unknown,
    ): Result<unknown, Diagnostic> {
      const parsedAccumulator = definition.accumulator.parse(accumulator);
      if (!parsedAccumulator.ok) return parsedAccumulator;
      const parsedElement = definition.element.parse(element);
      if (!parsedElement.ok) return parsedElement;
      return runTyped(
        definition.id,
        definition.accumulator,
        definition.accumulator,
        (value) => definition.implementation(value, parsedElement.value),
        parsedAccumulator.value,
      );
    },
  };
}

/** Declares an external effect; no live implementation enters the portable catalog. */
export function defineEffect<I, O>(
  definition: Readonly<{
    id: string;
    version: string;
    description: string;
    input: SchemaRegistration<I>;
    output: SchemaRegistration<O>;
    effectName: string;
    capability: string;
    maxTokens: number;
    maxWallClockMs: number;
    replayable: boolean;
    maxOutputItems?: number | undefined;
    stateChanging?: boolean | undefined;
  }>,
): RuntimeEffect {
  return {
    kind: "effect",
    id: operationReference(definition.id, definition.version).id,
    version: definition.version,
    description: definition.description,
    input: schemaReference(definition.input.id, definition.input.version),
    semantics: Object.freeze({
      stateChanging: definition.stateChanging ?? false,
    }),
    output: schemaReference(definition.output.id, definition.output.version),
    effectName: definition.effectName,
    capability: definition.capability,
    maxTokens: definition.maxTokens,
    maxWallClockMs: definition.maxWallClockMs,
    replayable: definition.replayable,
    ...(definition.maxOutputItems === undefined
      ? {}
      : { maxOutputItems: definition.maxOutputItems }),
  };
}

/** Registers a same-schema pure transition for bounded fixed-point execution. */
export function defineFixedPointStep<T>(
  definition: Readonly<{
    id: string;
    version: string;
    description: string;
    state: SchemaRegistration<T>;
    implementation: (state: T) => T;
    stateChanging?: boolean | undefined;
  }>,
): RuntimeFixedPointStep {
  return {
    kind: "fixedPointStep",
    id: operationReference(definition.id, definition.version).id,
    version: definition.version,
    description: definition.description,
    input: schemaReference(definition.state.id, definition.state.version),
    semantics: Object.freeze({
      stateChanging: definition.stateChanging ?? false,
    }),
    output: schemaReference(definition.state.id, definition.state.version),
    invoke: (input) =>
      runTyped(
        definition.id,
        definition.state,
        definition.state,
        definition.implementation,
        input,
      ),
  };
}

/** Registers a validated nonnegative-integer progress measure. */
export function defineMeasure<T>(
  definition: Readonly<{
    id: string;
    version: string;
    description: string;
    input: SchemaRegistration<T>;
    implementation: (input: T) => number;
    stateChanging?: boolean | undefined;
  }>,
): RuntimeMeasure {
  return {
    kind: "measure",
    id: operationReference(definition.id, definition.version).id,
    version: definition.version,
    description: definition.description,
    input: schemaReference(definition.input.id, definition.input.version),
    semantics: Object.freeze({
      stateChanging: definition.stateChanging ?? false,
    }),
    measure(input: unknown): Result<number, Diagnostic> {
      const parsed = definition.input.parse(input);
      if (!parsed.ok) return parsed;
      const value = definition.implementation(parsed.value);
      return Number.isSafeInteger(value) && value >= 0
        ? ok(value)
        : err(
            runtimeValidationDiagnostic(
              definition.id,
              "Measure must return a nonnegative safe integer.",
            ),
          );
    },
  };
}

/** Builds an immutable heterogeneous catalog and rejects duplicate or dangling registrations. */
export function createCatalog(
  definition: Readonly<{
    identity: Readonly<{ id: string; version: string }>;
    schemas: ReadonlyArray<RuntimeSchema>;
    operations: ReadonlyArray<RuntimeOperation>;
    semanticRoles?: CatalogSemanticRolesInput | undefined;
  }>,
): Result<Catalog, ReadonlyArray<Diagnostic>> {
  const identity = catalogReferenceSchema.safeParse(definition.identity);
  if (!identity.success) {
    return err([
      diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Catalog identity must contain a valid branded ID and version.",
      ),
    ]);
  }
  const schemas = new Map<string, RuntimeSchema>();
  const operations = new Map<string, RuntimeOperation>();
  const diagnostics: Array<Diagnostic> = [];
  const semanticRoles =
    definition.semanticRoles === undefined
      ? undefined
      : catalogSemanticRolesSchema.safeParse(definition.semanticRoles);
  if (semanticRoles !== undefined && !semanticRoles.success)
    diagnostics.push(
      diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Catalog semantic-role declarations are invalid.",
      ),
    );
  for (const registration of definition.schemas) {
    const schema = freezeRuntimeSchema(registration);
    const key = referenceKey(schema);
    if (schemas.has(key))
      diagnostics.push(
        diagnostic("UNKNOWN_SCHEMA", `Duplicate schema registration ${key}.`),
      );
    else schemas.set(key, schema);
  }
  for (const registration of definition.operations) {
    const operation = freezeRuntimeOperation(registration);
    const key = referenceKey(operation);
    if (operations.has(key))
      diagnostics.push(
        diagnostic(
          "UNKNOWN_OPERATION",
          `Duplicate operation registration ${key}.`,
        ),
      );
    else operations.set(key, operation);
  }
  for (const operation of operations.values()) {
    if (operation.kind === "reducer") {
      if (
        !schemas.has(referenceKey(operation.element)) ||
        !schemas.has(referenceKey(operation.accumulator))
      ) {
        diagnostics.push(
          diagnostic(
            "INVALID_REDUCER",
            `Reducer ${referenceKey(operation)} references an unregistered schema.`,
          ),
        );
      }
    } else {
      if (!schemas.has(referenceKey(operation.input))) {
        diagnostics.push(
          diagnostic(
            "UNKNOWN_SCHEMA",
            `Operation ${referenceKey(operation)} has an unknown input schema.`,
          ),
        );
      }
      if (
        (operation.kind === "function" ||
          operation.kind === "effect" ||
          operation.kind === "fixedPointStep") &&
        !schemas.has(referenceKey(operation.output))
      ) {
        diagnostics.push(
          diagnostic(
            "UNKNOWN_SCHEMA",
            `Operation ${referenceKey(operation)} has an unknown output schema.`,
          ),
        );
      }
    }
    if (
      operation.kind === "effect" &&
      (operation.effectName.length === 0 || operation.capability.length === 0)
    ) {
      diagnostics.push(
        diagnostic(
          "UNDECLARED_EFFECT",
          `Effect ${referenceKey(operation)} must declare an effect and capability.`,
        ),
      );
    }
  }
  if (semanticRoles?.success) {
    const schemaRoles = new Set<string>();
    const roleSchemas = new Set<string>();
    for (const declaration of semanticRoles.data.schemas) {
      const role = referenceKey(declaration.role);
      const schema = referenceKey(declaration.schema);
      if (schemaRoles.has(role) || roleSchemas.has(schema))
        diagnostics.push(
          diagnostic(
            "INVALID_WIRE_SCHEMA",
            `Semantic schema role ${role} or registration ${schema} is duplicated.`,
          ),
        );
      schemaRoles.add(role);
      roleSchemas.add(schema);
      if (!schemas.has(schema))
        diagnostics.push(
          diagnostic(
            "UNKNOWN_SCHEMA",
            `Semantic schema role ${role} references unknown schema ${schema}.`,
          ),
        );
    }
    const operationRoles = new Set<string>();
    const roleOperations = new Set<string>();
    for (const declaration of semanticRoles.data.operations) {
      const role = referenceKey(declaration.role);
      const operationKey = referenceKey(declaration.operation);
      const operation = operations.get(operationKey);
      if (operationRoles.has(role) || roleOperations.has(operationKey))
        diagnostics.push(
          diagnostic(
            "INVALID_WIRE_SCHEMA",
            `Semantic operation role ${role} or registration ${operationKey} is duplicated.`,
          ),
        );
      operationRoles.add(role);
      roleOperations.add(operationKey);
      if (operation === undefined) {
        diagnostics.push(
          diagnostic(
            "UNKNOWN_OPERATION",
            `Semantic operation role ${role} references unknown operation ${operationKey}.`,
          ),
        );
        continue;
      }
      if (operation.kind !== declaration.kind)
        diagnostics.push(
          diagnostic(
            "OPERATION_KIND_MISMATCH",
            `Semantic operation role ${role} declares ${declaration.kind} for ${operation.kind} operation ${operationKey}.`,
          ),
        );
      if (
        operation.kind === "reducer" &&
        declaration.kind === "reducer" &&
        (operation.laws.associative !== declaration.obligations.associative ||
          operation.laws.commutative !== declaration.obligations.commutative ||
          operation.laws.idempotent !== declaration.obligations.idempotent)
      )
        diagnostics.push(
          diagnostic(
            "INVALID_REDUCER",
            `Semantic reducer role ${role} must claim exactly the registered reducer laws.`,
          ),
        );
    }
  }
  return diagnostics.length === 0
    ? ok(
        storeCatalog({
          identity: identity.data,
          schemas,
          operations,
          ...(semanticRoles?.success
            ? { semanticRoles: semanticRoles.data }
            : {}),
        }),
      )
    : err(diagnostics);
}

export function describeCatalog(catalog: Catalog): CatalogDescription {
  const state = readCatalog(catalog);
  return {
    identity: state.identity,
    ...(state.semanticRoles === undefined
      ? {}
      : { semanticRoles: state.semanticRoles }),
    schemas: [...state.schemas.values()]
      .map((schema) => ({
        id: schema.id,
        version: schema.version,
        description: schema.description,
        jsonSchema: schema.jsonSchema,
        kind: schema.kind,
      }))
      .toSorted((left, right) => compareKeys(left, right)),
    operations: [...state.operations.values()]
      .map((operation) => ({
        id: operation.id,
        version: operation.version,
        kind: operation.kind,
        description: operation.description,
        semantics: operation.semantics,
        ...(operation.kind === "reducer" ? {} : { input: operation.input }),
      }))
      .toSorted((left, right) => compareKeys(left, right)),
  };
}
