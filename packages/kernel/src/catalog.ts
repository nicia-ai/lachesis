import { z } from "zod";

import { type Diagnostic, diagnostic } from "./diagnostic.js";
import { err, ok, type Result } from "./result.js";
import type { VersionedReference } from "./wire.js";

export type SchemaKind =
  | Readonly<{ kind: "scalar"; semantic?: "boolean" | undefined }>
  | Readonly<{
      kind: "collection";
      element: VersionedReference;
      defaultMaxItems?: number | undefined;
    }>;

export type RuntimeSchema = Readonly<{
  id: string;
  version: string;
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
  id: string;
  version: string;
  input: VersionedReference;
}>;

export type RuntimeFunction = OperationBase &
  Readonly<{
    kind: "function";
    output: VersionedReference;
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
  id: string;
  version: string;
  element: VersionedReference;
  accumulator: VersionedReference;
  identity: unknown;
  laws: ReducerLaws;
  reduce: (
    accumulator: unknown,
    element: unknown,
  ) => Result<unknown, Diagnostic>;
}>;

export type RuntimeEffect = OperationBase &
  Readonly<{
    kind: "effect";
    output: VersionedReference;
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
    output: VersionedReference;
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

export type Catalog = Readonly<{
  identity: VersionedReference;
  schemas: ReadonlyMap<string, RuntimeSchema>;
  operations: ReadonlyMap<string, RuntimeOperation>;
}>;

export type CatalogDescription = Readonly<{
  identity: VersionedReference;
  schemas: ReadonlyArray<
    Readonly<{ id: string; version: string; kind: SchemaKind }>
  >;
  operations: ReadonlyArray<
    Readonly<{
      id: string;
      version: string;
      kind: RuntimeOperation["kind"];
      input?: VersionedReference | undefined;
    }>
  >;
}>;

export function referenceKey(reference: VersionedReference): string {
  return `${reference.id}@${reference.version}`;
}

function compareKeys(
  left: VersionedReference,
  right: VersionedReference,
): number {
  const leftKey = referenceKey(left);
  const rightKey = referenceKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
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
    return z.json().safeParse(parsed.data).success
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
    id: definition.id,
    version: definition.version,
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
    validator: z.ZodType<ReadonlyArray<T>>;
    element: SchemaRegistration<T>;
    defaultMaxItems?: number | undefined;
  }>,
): SchemaRegistration<ReadonlyArray<T>> {
  const kind: SchemaKind = {
    kind: "collection",
    element: { id: definition.element.id, version: definition.element.version },
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
    return z.json().safeParse(parsed.data).success
      ? ok(parsed.data)
      : err(
          runtimeValidationDiagnostic(
            definition.id,
            "Schema value must be JSON serializable.",
          ),
        );
  }
  const runtime: RuntimeSchema = {
    id: definition.id,
    version: definition.version,
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
    input: SchemaRegistration<I>;
    output: SchemaRegistration<O>;
    implementation: (input: I) => O;
    maxOutputItems?: number | undefined;
  }>,
): RuntimeFunction {
  return {
    kind: "function",
    id: definition.id,
    version: definition.version,
    input: { id: definition.input.id, version: definition.input.version },
    output: { id: definition.output.id, version: definition.output.version },
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
    input: SchemaRegistration<I>;
    implementation: (input: I) => boolean;
  }>,
): RuntimePredicate {
  return {
    kind: "predicate",
    id: definition.id,
    version: definition.version,
    input: { id: definition.input.id, version: definition.input.version },
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
    element: SchemaRegistration<E>;
    accumulator: SchemaRegistration<A>;
    identity: A;
    laws: ReducerLaws;
    implementation: (accumulator: A, element: E) => A;
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
    id: definition.id,
    version: definition.version,
    element: { id: definition.element.id, version: definition.element.version },
    accumulator: {
      id: definition.accumulator.id,
      version: definition.accumulator.version,
    },
    identity: identity.value,
    laws: definition.laws,
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
    input: SchemaRegistration<I>;
    output: SchemaRegistration<O>;
    effectName: string;
    capability: string;
    maxTokens: number;
    maxWallClockMs: number;
    replayable: boolean;
    maxOutputItems?: number | undefined;
  }>,
): RuntimeEffect {
  return {
    kind: "effect",
    id: definition.id,
    version: definition.version,
    input: { id: definition.input.id, version: definition.input.version },
    output: { id: definition.output.id, version: definition.output.version },
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
    state: SchemaRegistration<T>;
    implementation: (state: T) => T;
  }>,
): RuntimeFixedPointStep {
  return {
    kind: "fixedPointStep",
    id: definition.id,
    version: definition.version,
    input: { id: definition.state.id, version: definition.state.version },
    output: { id: definition.state.id, version: definition.state.version },
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
    input: SchemaRegistration<T>;
    implementation: (input: T) => number;
  }>,
): RuntimeMeasure {
  return {
    kind: "measure",
    id: definition.id,
    version: definition.version,
    input: { id: definition.input.id, version: definition.input.version },
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
    identity: VersionedReference;
    schemas: ReadonlyArray<RuntimeSchema>;
    operations: ReadonlyArray<RuntimeOperation>;
  }>,
): Result<Catalog, ReadonlyArray<Diagnostic>> {
  const schemas = new Map<string, RuntimeSchema>();
  const operations = new Map<string, RuntimeOperation>();
  const diagnostics: Array<Diagnostic> = [];
  for (const schema of definition.schemas) {
    const key = referenceKey(schema);
    if (schemas.has(key))
      diagnostics.push(
        diagnostic("UNKNOWN_SCHEMA", `Duplicate schema registration ${key}.`),
      );
    else schemas.set(key, schema);
  }
  for (const operation of definition.operations) {
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
  return diagnostics.length === 0
    ? ok({ identity: definition.identity, schemas, operations })
    : err(diagnostics);
}

export function describeCatalog(catalog: Catalog): CatalogDescription {
  return {
    identity: catalog.identity,
    schemas: [...catalog.schemas.values()]
      .map((schema) => ({
        id: schema.id,
        version: schema.version,
        kind: schema.kind,
      }))
      .toSorted((left, right) => compareKeys(left, right)),
    operations: [...catalog.operations.values()]
      .map((operation) => ({
        id: operation.id,
        version: operation.version,
        kind: operation.kind,
        ...(operation.kind === "reducer" ? {} : { input: operation.input }),
      }))
      .toSorted((left, right) => compareKeys(left, right)),
  };
}
