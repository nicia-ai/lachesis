import { parse } from "@babel/parser";
import * as t from "@babel/types";
import {
  canonicalizeSemanticObligations,
  type Catalog,
  type CompilationPolicy,
  type Diagnostic,
  diagnostic,
  digestValue,
  readCatalog,
  type Result,
  type RuntimeOperation,
  type SemanticObligation,
  type SemanticObligationInput,
  semanticObligationSchema,
} from "@nicia-ai/lachesis";

import type { TaskInput } from "./model.js";

export const CODEMODE_PROTOCOL = Object.freeze({
  id: "lachesis-restricted-capability-typescript",
  version: "2",
  claimBoundary:
    "typed surface over the registered Lachesis capability algebra; not conventional CodeMode",
  grammar:
    "one exported async main; const SSA bindings; input fields; JSON literals; awaited capability calls; one return",
  isolation:
    "source is parsed and interpreted as a closed AST; it is never passed to eval, Function, an import loader, or a host JavaScript realm",
});

export type CodeModeCapabilityMethod =
  "invoke" | "map" | "filter" | "fold" | "select" | "boundedFix" | "effect";

type ValueExpression =
  | Readonly<{ kind: "input"; name: string }>
  | Readonly<{ kind: "binding"; name: string }>
  | Readonly<{ kind: "literal"; value: null | boolean | number | string }>;

type Reference = Readonly<{ id: string; version: string }>;

function referenceKey(reference: Reference): string {
  return `${reference.id}@${reference.version}`;
}

type CapabilityExpression =
  | Readonly<{
      kind: "operation";
      method: Exclude<CodeModeCapabilityMethod, "select" | "boundedFix">;
      operation: Reference;
      source: ValueExpression;
    }>
  | Readonly<{
      kind: "select";
      condition: ValueExpression;
      primary: ValueExpression;
      fallback: ValueExpression;
    }>
  | Readonly<{
      kind: "boundedFix";
      step: Reference;
      measure: Reference;
      source: ValueExpression;
      limit: number;
    }>;

type CodeModeBinding = Readonly<{
  name: string;
  expression: CapabilityExpression;
}>;

type CompiledProgram = Readonly<{
  bindings: ReadonlyArray<CodeModeBinding>;
  root: ValueExpression;
}>;

type Provenance = Readonly<{
  inputs: ReadonlySet<string>;
  operations: ReadonlySet<string>;
  effects: ReadonlySet<string>;
  stateChanging: boolean;
  dominatingOperations: ReadonlySet<string>;
}>;

type BindingAnalysis = Readonly<{
  schema: Reference | null;
  maximumItems: number | null;
  provenance: Provenance;
  maximumOperationCalls: number;
  maximumEffectCalls: number;
  maximumTokens: number;
  maximumWallClockMs: number;
  dependencies: ReadonlySet<string>;
}>;

export type CodeModeStaticAnalysis = Readonly<{
  maximumOperationCalls: number;
  maximumEffectCalls: number;
  maximumTokens: number;
  maximumWallClockMs: number;
  maximumCollectionItems: number;
  inputDependencies: ReadonlyArray<string>;
  operationDependencies: ReadonlyArray<string>;
  effectDependencies: ReadonlyArray<string>;
  stateChanging: boolean;
  predictedResourcesKnown: true;
}>;

const artifactBrand: unique symbol = Symbol("CodeModeArtifact");

export type CodeModeArtifact = Readonly<{
  [artifactBrand]: "CodeModeArtifact";
}>;

export type CodeModeArtifactSummary = Readonly<{
  protocol: typeof CODEMODE_PROTOCOL;
  sourceHash: string;
  semanticContractHash: string;
  semanticObligations: ReadonlyArray<SemanticObligation>;
  analysis: CodeModeStaticAnalysis;
}>;

type StoredArtifact = Readonly<{
  program: CompiledProgram;
  catalog: Catalog;
  policy: CompilationPolicy;
  taskInputs: ReadonlyArray<TaskInput>;
  summary: CodeModeArtifactSummary;
}>;

const artifacts = new WeakMap<CodeModeArtifact, StoredArtifact>();

export type CompileCodeModeInput = Readonly<{
  source: string;
  catalog: Catalog;
  policy: CompilationPolicy;
  taskInputs: ReadonlyArray<TaskInput>;
  semanticObligations: ReadonlyArray<SemanticObligationInput>;
}>;

export type CodeModeRuntimeUsage = Readonly<{
  operationCalls: number;
  effectCalls: number;
  tokens: number;
  wallClockMs: number;
}>;

export type CodeModeEffectRequest = Readonly<{
  operation: Reference;
  effectName: string;
  capability: string;
  input: unknown;
  signal: AbortSignal;
}>;

export type CodeModeEffectResult = Readonly<{
  value: unknown;
  usage: Readonly<{ tokens: number; wallClockMs: number }>;
}>;

export type CodeModeEffectHandler = (
  request: CodeModeEffectRequest,
) => Promise<Result<CodeModeEffectResult, Diagnostic>>;

export type CodeModeExecutionResult = Readonly<{
  output: unknown;
  usage: CodeModeRuntimeUsage;
  predictedUsage: CodeModeStaticAnalysis;
}>;

export type CodeModeExecutionFailure = Readonly<{
  kind:
    | "invalid-artifact"
    | "runtime-exception"
    | "timeout"
    | "capability-violation"
    | "budget-violation";
  diagnostics: ReadonlyArray<Diagnostic>;
  usage: CodeModeRuntimeUsage;
}>;

export type ExecuteCodeModeOptions = Readonly<{
  inputs: ReadonlyMap<string, unknown>;
  effectHandler: CodeModeEffectHandler;
  timeoutMs?: number | undefined;
}>;

const emptyProvenance = (): Provenance => ({
  inputs: new Set(),
  operations: new Set(),
  effects: new Set(),
  stateChanging: false,
  dominatingOperations: new Set(),
});

function invalid(message: string): Diagnostic {
  return diagnostic("INVALID_WIRE_SCHEMA", `Restricted CodeMode: ${message}`);
}

function runtimeFailure(message: string): Diagnostic {
  return diagnostic(
    "RUNTIME_SCHEMA_VIOLATION",
    `Restricted CodeMode: ${message}`,
  );
}

function parseReference(
  node: t.Expression | t.SpreadElement | t.ArgumentPlaceholder,
): Result<Reference, Diagnostic> {
  if (!t.isStringLiteral(node))
    return {
      ok: false,
      error: invalid("operation references must be string literals"),
    };
  const separator = node.value.lastIndexOf("@");
  if (separator <= 0 || separator === node.value.length - 1)
    return {
      ok: false,
      error: invalid("operation references must use id@version"),
    };
  return {
    ok: true,
    value: {
      id: node.value.slice(0, separator),
      version: node.value.slice(separator + 1),
    },
  };
}

function parseValueExpression(
  node: t.Expression | t.SpreadElement | t.ArgumentPlaceholder,
): Result<ValueExpression, Diagnostic> {
  if (t.isIdentifier(node))
    return { ok: true, value: { kind: "binding", name: node.name } };
  if (
    t.isMemberExpression(node) &&
    !node.computed &&
    t.isIdentifier(node.object, { name: "input" }) &&
    t.isIdentifier(node.property)
  )
    return { ok: true, value: { kind: "input", name: node.property.name } };
  if (t.isNullLiteral(node))
    return { ok: true, value: { kind: "literal", value: null } };
  if (
    t.isBooleanLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isStringLiteral(node)
  )
    return { ok: true, value: { kind: "literal", value: node.value } };
  return {
    ok: false,
    error: invalid(
      "values must be an input field, prior const binding, or scalar JSON literal",
    ),
  };
}

function capabilityCall(
  node: t.Expression | null,
): Result<t.CallExpression, Diagnostic> {
  const awaited = t.isAwaitExpression(node) ? node.argument : node;
  if (!t.isCallExpression(awaited))
    return {
      ok: false,
      error: invalid("const initializers must await a capability call"),
    };
  if (!t.isAwaitExpression(node))
    return { ok: false, error: invalid("capability calls must be awaited") };
  return { ok: true, value: awaited };
}

function capabilityMethod(
  call: t.CallExpression,
): Result<CodeModeCapabilityMethod, Diagnostic> {
  if (
    !t.isMemberExpression(call.callee) ||
    call.callee.computed ||
    !t.isIdentifier(call.callee.object, { name: "ops" }) ||
    !t.isIdentifier(call.callee.property)
  )
    return {
      ok: false,
      error: invalid("only direct ops capability calls are permitted"),
    };
  const value = call.callee.property.name;
  switch (value) {
    case "invoke":
    case "map":
    case "filter":
    case "fold":
    case "select":
    case "boundedFix":
    case "effect":
      return { ok: true, value };
    default:
      return {
        ok: false,
        error: invalid(`unknown capability method ${value}`),
      };
  }
}

function exactArguments(
  call: t.CallExpression,
  count: number,
): Result<
  ReadonlyArray<t.Expression | t.SpreadElement | t.ArgumentPlaceholder>,
  Diagnostic
> {
  return call.arguments.length === count
    ? { ok: true, value: call.arguments }
    : {
        ok: false,
        error: invalid(`capability call requires exactly ${count} arguments`),
      };
}

function parseCapabilityExpression(
  node: t.Expression | null,
): Result<CapabilityExpression, Diagnostic> {
  const parsedCall = capabilityCall(node);
  if (!parsedCall.ok) return parsedCall;
  const method = capabilityMethod(parsedCall.value);
  if (!method.ok) return method;
  if (method.value === "select") {
    const args = exactArguments(parsedCall.value, 3);
    if (!args.ok) return args;
    const [conditionNode, primaryNode, fallbackNode] = args.value;
    if (
      conditionNode === undefined ||
      primaryNode === undefined ||
      fallbackNode === undefined
    )
      return {
        ok: false,
        error: invalid("select arguments disappeared after validation"),
      };
    const condition = parseValueExpression(conditionNode);
    const primary = parseValueExpression(primaryNode);
    const fallback = parseValueExpression(fallbackNode);
    if (!condition.ok) return condition;
    if (!primary.ok) return primary;
    if (!fallback.ok) return fallback;
    return {
      ok: true,
      value: {
        kind: "select",
        condition: condition.value,
        primary: primary.value,
        fallback: fallback.value,
      },
    };
  }
  if (method.value === "boundedFix") {
    const args = exactArguments(parsedCall.value, 4);
    if (!args.ok) return args;
    const [stepNode, measureNode, sourceNode, limitNode] = args.value;
    if (
      stepNode === undefined ||
      measureNode === undefined ||
      sourceNode === undefined ||
      limitNode === undefined
    )
      return {
        ok: false,
        error: invalid("boundedFix arguments disappeared after validation"),
      };
    const step = parseReference(stepNode);
    const measure = parseReference(measureNode);
    const source = parseValueExpression(sourceNode);
    if (!step.ok) return step;
    if (!measure.ok) return measure;
    if (!source.ok) return source;
    if (
      !t.isNumericLiteral(limitNode) ||
      !Number.isSafeInteger(limitNode.value) ||
      limitNode.value < 0
    )
      return {
        ok: false,
        error: invalid(
          "boundedFix limit must be a nonnegative integer literal",
        ),
      };
    return {
      ok: true,
      value: {
        kind: "boundedFix",
        step: step.value,
        measure: measure.value,
        source: source.value,
        limit: limitNode.value,
      },
    };
  }
  const args = exactArguments(parsedCall.value, 2);
  if (!args.ok) return args;
  const [operationNode, sourceNode] = args.value;
  if (operationNode === undefined || sourceNode === undefined)
    return {
      ok: false,
      error: invalid("operation arguments disappeared after validation"),
    };
  const operation = parseReference(operationNode);
  const source = parseValueExpression(sourceNode);
  if (!operation.ok) return operation;
  if (!source.ok) return source;
  return {
    ok: true,
    value: {
      kind: "operation",
      method: method.value,
      operation: operation.value,
      source: source.value,
    },
  };
}

function parseProgram(
  source: string,
): Result<CompiledProgram, ReadonlyArray<Diagnostic>> {
  let file: ReturnType<typeof parse>;
  try {
    file = parse(source, {
      sourceType: "module",
      plugins: ["typescript"],
      allowAwaitOutsideFunction: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "parser rejected the source";
    return { ok: false, error: [invalid(message)] };
  }
  const body = file.program.body;
  if (
    file.program.directives.length !== 0 ||
    body.length !== 1 ||
    !t.isExportDefaultDeclaration(body[0]) ||
    !t.isFunctionDeclaration(body[0].declaration)
  )
    return {
      ok: false,
      error: [
        invalid(
          "program must contain only `export default async function main(input, ops) { ... }`",
        ),
      ],
    };
  const fn = body[0].declaration;
  if (
    !fn.async ||
    fn.generator ||
    fn.id?.name !== "main" ||
    fn.params.length !== 2 ||
    !t.isIdentifier(fn.params[0], { name: "input" }) ||
    !t.isIdentifier(fn.params[1], { name: "ops" })
  )
    return {
      ok: false,
      error: [invalid("entry point must be async main(input, ops)")],
    };
  if (fn.body.directives.length !== 0)
    return {
      ok: false,
      error: [invalid("directives are not part of restricted CodeMode")],
    };
  const statements = fn.body.body;
  const bindings: Array<CodeModeBinding> = [];
  let root: ValueExpression | undefined;
  for (const [index, statement] of statements.entries()) {
    if (
      t.isVariableDeclaration(statement) &&
      statement.kind === "const" &&
      statement.declarations.length === 1
    ) {
      if (root !== undefined)
        return {
          ok: false,
          error: [invalid("no statements may follow return")],
        };
      const declaration = statement.declarations[0];
      if (declaration === undefined)
        return {
          ok: false,
          error: [invalid("const declaration disappeared after validation")],
        };
      if (!t.isIdentifier(declaration.id))
        return {
          ok: false,
          error: [invalid("const bindings require simple identifiers")],
        };
      if (declaration.init === undefined)
        return {
          ok: false,
          error: [invalid("const bindings require initializers")],
        };
      const expression = parseCapabilityExpression(declaration.init);
      if (!expression.ok) return { ok: false, error: [expression.error] };
      bindings.push({
        name: declaration.id.name,
        expression: expression.value,
      });
      continue;
    }
    if (
      t.isReturnStatement(statement) &&
      index === statements.length - 1 &&
      statement.argument !== null
    ) {
      if (statement.argument === undefined)
        return {
          ok: false,
          error: [invalid("return argument disappeared after validation")],
        };
      const value = parseValueExpression(statement.argument);
      if (!value.ok) return { ok: false, error: [value.error] };
      root = value.value;
      continue;
    }
    return {
      ok: false,
      error: [
        invalid(
          "function body permits only single-declarator const bindings and a final return",
        ),
      ],
    };
  }
  return root === undefined
    ? { ok: false, error: [invalid("function must end with a return value")] }
    : { ok: true, value: { bindings, root } };
}

/** Parses and lowers the restricted TypeScript grammar without catalog access or execution. */
export function validateCodeModeSourceSyntax(
  source: string,
): Result<void, ReadonlyArray<Diagnostic>> {
  const parsed = parseProgram(source);
  return parsed.ok ? { ok: true, value: undefined } : parsed;
}

function union<T>(...sets: ReadonlyArray<ReadonlySet<T>>): ReadonlySet<T> {
  return new Set(sets.flatMap((set) => [...set]));
}

function intersection<T>(sets: ReadonlyArray<ReadonlySet<T>>): ReadonlySet<T> {
  const first = sets[0];
  return first === undefined
    ? new Set()
    : new Set(
        [...first].filter((value) =>
          sets.slice(1).every((set) => set.has(value)),
        ),
      );
}

function valueAnalysis(
  value: ValueExpression,
  inputs: ReadonlyMap<string, BindingAnalysis>,
  bindings: ReadonlyMap<string, BindingAnalysis>,
): Result<BindingAnalysis, Diagnostic> {
  if (value.kind === "literal")
    return {
      ok: true,
      value: {
        schema: null,
        maximumItems: null,
        provenance: emptyProvenance(),
        maximumOperationCalls: 0,
        maximumEffectCalls: 0,
        maximumTokens: 0,
        maximumWallClockMs: 0,
        dependencies: new Set(),
      },
    };
  const found =
    value.kind === "input" ? inputs.get(value.name) : bindings.get(value.name);
  return found === undefined
    ? {
        ok: false,
        error: invalid(
          `${value.kind} ${value.name} is not declared before use`,
        ),
      }
    : { ok: true, value: found };
}

function sameSchema(left: Reference | null, right: Reference | null): boolean {
  return (
    left !== null &&
    right !== null &&
    referenceKey(left) === referenceKey(right)
  );
}

function operationFor(
  catalog: ReturnType<typeof readCatalog>,
  reference: Reference,
): Result<RuntimeOperation, Diagnostic> {
  const operation = catalog.operations.get(referenceKey(reference));
  return operation === undefined
    ? {
        ok: false,
        error: diagnostic(
          "UNKNOWN_OPERATION",
          `Unknown CodeMode operation ${referenceKey(reference)}.`,
        ),
      }
    : { ok: true, value: operation };
}

function collectionForElement(
  catalog: ReturnType<typeof readCatalog>,
  element: Reference,
): Reference | null {
  const schema = [...catalog.schemas.values()].find(
    (candidate) =>
      candidate.kind.kind === "collection" &&
      referenceKey(candidate.kind.element) === referenceKey(element),
  );
  return schema === undefined
    ? null
    : { id: schema.id, version: schema.version };
}

function analyzeExpression(
  expression: CapabilityExpression,
  inputs: ReadonlyMap<string, BindingAnalysis>,
  bindings: ReadonlyMap<string, BindingAnalysis>,
  catalog: ReturnType<typeof readCatalog>,
  policy: CompilationPolicy,
): Result<BindingAnalysis, Diagnostic> {
  if (expression.kind === "select") {
    const condition = valueAnalysis(expression.condition, inputs, bindings);
    const primary = valueAnalysis(expression.primary, inputs, bindings);
    const fallback = valueAnalysis(expression.fallback, inputs, bindings);
    if (!condition.ok) return condition;
    if (!primary.ok) return primary;
    if (!fallback.ok) return fallback;
    if (!sameSchema(primary.value.schema, fallback.value.schema))
      return {
        ok: false,
        error: diagnostic(
          "BRANCH_TYPE_MISMATCH",
          "CodeMode select branches must share one registered schema.",
        ),
      };
    const values = [condition.value, primary.value, fallback.value];
    return {
      ok: true,
      value: {
        schema: primary.value.schema,
        maximumItems: Math.max(
          ...values.map((value) => value.maximumItems ?? 0),
        ),
        provenance: {
          inputs: union(...values.map((value) => value.provenance.inputs)),
          operations: union(
            ...values.map((value) => value.provenance.operations),
          ),
          effects: union(...values.map((value) => value.provenance.effects)),
          stateChanging: values.some((value) => value.provenance.stateChanging),
          dominatingOperations: intersection(
            values.map((value) => value.provenance.dominatingOperations),
          ),
        },
        maximumOperationCalls: values.reduce(
          (sum, value) => sum + value.maximumOperationCalls,
          0,
        ),
        maximumEffectCalls: values.reduce(
          (sum, value) => sum + value.maximumEffectCalls,
          0,
        ),
        maximumTokens: values.reduce(
          (sum, value) => sum + value.maximumTokens,
          0,
        ),
        maximumWallClockMs: values.reduce(
          (sum, value) => sum + value.maximumWallClockMs,
          0,
        ),
        dependencies: union(...values.map((value) => value.dependencies)),
      },
    };
  }
  const source = valueAnalysis(expression.source, inputs, bindings);
  if (!source.ok) return source;
  const references =
    expression.kind === "boundedFix"
      ? [expression.step, expression.measure]
      : [expression.operation];
  const operations: Array<RuntimeOperation> = [];
  for (const reference of references) {
    const operation = operationFor(catalog, reference);
    if (!operation.ok) return operation;
    operations.push(operation.value);
  }
  let outputSchema: Reference;
  let calls = 1;
  let effects = 0;
  let tokens = 0;
  let wallClock = 0;
  if (expression.kind === "boundedFix") {
    const [step, measure] = operations;
    if (
      step?.kind !== "fixedPointStep" ||
      measure?.kind !== "measure" ||
      !sameSchema(source.value.schema, step.input) ||
      !sameSchema(source.value.schema, measure.input)
    )
      return {
        ok: false,
        error: diagnostic(
          "OPERATION_KIND_MISMATCH",
          "CodeMode boundedFix requires a same-schema fixed-point step and measure.",
        ),
      };
    outputSchema = step.output;
    calls = expression.limit * 2 + 1;
  } else {
    const operation = operations[0];
    if (operation === undefined)
      return {
        ok: false,
        error: diagnostic(
          "INTERNAL_INVARIANT_VIOLATION",
          "CodeMode operation analysis lost its operation.",
        ),
      };
    const sourceSchema = source.value.schema;
    if (expression.method === "map") {
      const collection =
        sourceSchema === null
          ? undefined
          : catalog.schemas.get(referenceKey(sourceSchema));
      if (
        operation.kind !== "function" ||
        collection?.kind.kind !== "collection" ||
        referenceKey(collection.kind.element) !== referenceKey(operation.input)
      )
        return {
          ok: false,
          error: diagnostic(
            "OPERATION_KIND_MISMATCH",
            "CodeMode map requires a collection and matching function.",
          ),
        };
      const outputCollection = collectionForElement(catalog, operation.output);
      if (outputCollection === null)
        return {
          ok: false,
          error: diagnostic(
            "UNKNOWN_SCHEMA",
            `CodeMode map has no registered collection for ${referenceKey(operation.output)}.`,
          ),
        };
      outputSchema = outputCollection;
      calls = source.value.maximumItems ?? 0;
    } else if (expression.method === "filter") {
      const collection =
        sourceSchema === null
          ? undefined
          : catalog.schemas.get(referenceKey(sourceSchema));
      if (
        sourceSchema === null ||
        operation.kind !== "predicate" ||
        collection?.kind.kind !== "collection" ||
        referenceKey(collection.kind.element) !== referenceKey(operation.input)
      )
        return {
          ok: false,
          error: diagnostic(
            "OPERATION_KIND_MISMATCH",
            "CodeMode filter requires a collection and matching predicate.",
          ),
        };
      outputSchema = sourceSchema;
      calls = source.value.maximumItems ?? 0;
    } else if (expression.method === "fold") {
      const collection =
        sourceSchema === null
          ? undefined
          : catalog.schemas.get(referenceKey(sourceSchema));
      if (
        operation.kind !== "reducer" ||
        collection?.kind.kind !== "collection" ||
        referenceKey(collection.kind.element) !==
          referenceKey(operation.element)
      )
        return {
          ok: false,
          error: diagnostic(
            "OPERATION_KIND_MISMATCH",
            "CodeMode fold requires a collection and matching reducer.",
          ),
        };
      outputSchema = operation.accumulator;
      calls = source.value.maximumItems ?? 0;
    } else if (expression.method === "effect") {
      if (
        operation.kind !== "effect" ||
        !sameSchema(sourceSchema, operation.input)
      )
        return {
          ok: false,
          error: diagnostic(
            "OPERATION_KIND_MISMATCH",
            "CodeMode effect requires a matching registered effect.",
          ),
        };
      if (!policy.allowedCapabilities.includes(operation.capability))
        return {
          ok: false,
          error: diagnostic(
            "DENIED_CAPABILITY",
            `CodeMode capability ${operation.capability} is not authorized.`,
          ),
        };
      outputSchema = operation.output;
      effects = 1;
      tokens = operation.maxTokens;
      wallClock = operation.maxWallClockMs;
    } else {
      if (
        operation.kind !== "function" ||
        !sameSchema(sourceSchema, operation.input)
      )
        return {
          ok: false,
          error: diagnostic(
            "OPERATION_KIND_MISMATCH",
            "CodeMode invoke requires a matching registered function.",
          ),
        };
      outputSchema = operation.output;
    }
  }
  const keys = new Set(references.map(referenceKey));
  const effectNames = new Set(source.value.provenance.effects);
  let stateChanging = source.value.provenance.stateChanging;
  for (const operation of operations) {
    if (operation.kind === "effect") effectNames.add(operation.effectName);
    stateChanging ||= operation.semantics.stateChanging;
  }
  return {
    ok: true,
    value: {
      schema: outputSchema,
      maximumItems: source.value.maximumItems,
      provenance: {
        inputs: source.value.provenance.inputs,
        operations: union<string>(source.value.provenance.operations, keys),
        effects: effectNames,
        stateChanging,
        dominatingOperations: union<string>(
          source.value.provenance.dominatingOperations,
          keys,
        ),
      },
      maximumOperationCalls: source.value.maximumOperationCalls + calls,
      maximumEffectCalls: source.value.maximumEffectCalls + effects,
      maximumTokens: source.value.maximumTokens + tokens,
      maximumWallClockMs: source.value.maximumWallClockMs + wallClock,
      dependencies: source.value.dependencies,
    },
  };
}

function obligationDiagnostics(
  provenance: Provenance,
  obligations: ReadonlyArray<SemanticObligation>,
  catalog: ReturnType<typeof readCatalog>,
): ReadonlyArray<Diagnostic> {
  const failures: Array<Diagnostic> = [];
  for (const obligation of obligations) {
    let satisfied: boolean;
    switch (obligation.kind) {
      case "requiresOperation":
        satisfied = provenance.operations.has(
          referenceKey(obligation.operation),
        );
        break;
      case "operationDominatesRoot":
        satisfied = provenance.dominatingOperations.has(
          referenceKey(obligation.operation),
        );
        break;
      case "rootDependsOnInput":
        satisfied = provenance.inputs.has(obligation.inputKey);
        break;
      case "requiresStateChange":
        satisfied = provenance.stateChanging;
        break;
      case "requiresEffect":
        satisfied = provenance.effects.has(obligation.effectName);
        break;
    }
    if (!satisfied)
      failures.push(
        diagnostic(
          "SEMANTIC_OBLIGATION_FAILED",
          `CodeMode program does not satisfy semantic obligation ${obligation.kind}.`,
        ),
      );
  }
  void catalog;
  return failures;
}

function budgetDiagnostics(
  analysis: CodeModeStaticAnalysis,
  policy: CompilationPolicy,
): ReadonlyArray<Diagnostic> {
  const checks: ReadonlyArray<
    Readonly<{ name: string; actual: number; limit: number }>
  > = [
    {
      name: "effect calls",
      actual: analysis.maximumEffectCalls,
      limit: policy.budget.maxEffectCalls,
    },
    {
      name: "tokens",
      actual: analysis.maximumTokens,
      limit: policy.budget.maxTokens,
    },
    {
      name: "wall-clock milliseconds",
      actual: analysis.maximumWallClockMs,
      limit: policy.budget.maxWallClockMs,
    },
    {
      name: "collection items",
      actual: analysis.maximumCollectionItems,
      limit: policy.budget.maxCollectionItems,
    },
  ];
  return checks
    .filter((check) => check.actual > check.limit)
    .map((check) =>
      diagnostic(
        "BUDGET_EXCEEDED",
        `CodeMode predicted ${check.name} ${check.actual} exceeds budget ${check.limit}.`,
      ),
    );
}

export async function compileCodeMode(
  input: CompileCodeModeInput,
): Promise<Result<CodeModeArtifact, ReadonlyArray<Diagnostic>>> {
  const parsed = parseProgram(input.source);
  if (!parsed.ok) return parsed;
  const catalog = readCatalog(input.catalog);
  const inputAnalyses = new Map<string, BindingAnalysis>();
  let maximumCollectionItems = 0;
  for (const taskInput of input.taskInputs) {
    const schema = catalog.schemas.get(referenceKey(taskInput.schema));
    if (schema === undefined)
      return {
        ok: false,
        error: [
          diagnostic(
            "UNKNOWN_SCHEMA",
            `Unknown CodeMode task input schema ${referenceKey(taskInput.schema)}.`,
          ),
        ],
      };
    const bound =
      taskInput.declaredBounds.at(0)?.value ??
      (schema.kind.kind === "collection"
        ? schema.kind.defaultMaxItems
        : undefined) ??
      0;
    maximumCollectionItems = Math.max(maximumCollectionItems, bound);
    inputAnalyses.set(taskInput.name, {
      schema: taskInput.schema,
      maximumItems: schema.kind.kind === "collection" ? bound : null,
      provenance: { ...emptyProvenance(), inputs: new Set([taskInput.name]) },
      maximumOperationCalls: 0,
      maximumEffectCalls: 0,
      maximumTokens: 0,
      maximumWallClockMs: 0,
      dependencies: new Set(),
    });
  }
  const bindings = new Map<string, BindingAnalysis>();
  for (const binding of parsed.value.bindings) {
    if (
      bindings.has(binding.name) ||
      inputAnalyses.has(binding.name) ||
      binding.name === "input" ||
      binding.name === "ops"
    )
      return {
        ok: false,
        error: [invalid(`duplicate or reserved binding ${binding.name}`)],
      };
    const analysis = analyzeExpression(
      binding.expression,
      inputAnalyses,
      bindings,
      catalog,
      input.policy,
    );
    if (!analysis.ok) return { ok: false, error: [analysis.error] };
    const direct =
      binding.expression.kind === "select"
        ? [
            binding.expression.condition,
            binding.expression.primary,
            binding.expression.fallback,
          ]
        : [binding.expression.source];
    bindings.set(binding.name, {
      ...analysis.value,
      dependencies: new Set(
        direct
          .filter((value) => value.kind === "binding")
          .map((value) => value.name),
      ),
    });
  }
  const root = valueAnalysis(parsed.value.root, inputAnalyses, bindings);
  if (!root.ok) return { ok: false, error: [root.error] };
  const live = new Set<string>();
  const visit = (name: string): void => {
    if (live.has(name)) return;
    live.add(name);
    const binding = bindings.get(name);
    if (binding !== undefined)
      for (const dependency of binding.dependencies) visit(dependency);
  };
  if (parsed.value.root.kind === "binding") visit(parsed.value.root.name);
  const dead = [...bindings.keys()].filter((name) => !live.has(name));
  if (dead.length > 0)
    return {
      ok: false,
      error: dead.map((name) =>
        invalid(`binding ${name} does not contribute to the return value`),
      ),
    };
  const parsedObligations = semanticObligationSchema
    .array()
    .safeParse(input.semanticObligations);
  if (!parsedObligations.success)
    return {
      ok: false,
      error: [
        invalid(
          `semantic obligations are invalid: ${parsedObligations.error.issues.map((issue) => issue.message).join("; ")}`,
        ),
      ],
    };
  const obligations = canonicalizeSemanticObligations(parsedObligations.data);
  const semanticFailures = obligationDiagnostics(
    root.value.provenance,
    obligations,
    catalog,
  );
  const analysis: CodeModeStaticAnalysis = {
    maximumOperationCalls: root.value.maximumOperationCalls,
    maximumEffectCalls: root.value.maximumEffectCalls,
    maximumTokens: root.value.maximumTokens,
    maximumWallClockMs: root.value.maximumWallClockMs,
    maximumCollectionItems,
    inputDependencies: [...root.value.provenance.inputs].toSorted(),
    operationDependencies: [...root.value.provenance.operations].toSorted(),
    effectDependencies: [...root.value.provenance.effects].toSorted(),
    stateChanging: root.value.provenance.stateChanging,
    predictedResourcesKnown: true,
  };
  const failures = [
    ...semanticFailures,
    ...budgetDiagnostics(analysis, input.policy),
  ];
  if (failures.length > 0) return { ok: false, error: failures };
  const sourceDigest = await digestValue({
    protocol: CODEMODE_PROTOCOL,
    source: input.source,
  });
  if (!sourceDigest.ok) return { ok: false, error: [sourceDigest.error] };
  const contractDigest = await digestValue({
    sourceHash: sourceDigest.value,
    catalog: catalog.identity,
    policy: input.policy,
    taskInputs: input.taskInputs,
    semanticObligations: obligations,
  });
  if (!contractDigest.ok) return { ok: false, error: [contractDigest.error] };
  const artifact: CodeModeArtifact = Object.freeze({
    [artifactBrand]: "CodeModeArtifact",
  });
  const summary: CodeModeArtifactSummary = Object.freeze({
    protocol: CODEMODE_PROTOCOL,
    sourceHash: sourceDigest.value,
    semanticContractHash: contractDigest.value,
    semanticObligations: obligations,
    analysis,
  });
  artifacts.set(artifact, {
    program: parsed.value,
    catalog: input.catalog,
    policy: input.policy,
    taskInputs: input.taskInputs,
    summary,
  });
  return { ok: true, value: artifact };
}

export function inspectCodeModeArtifact(
  artifact: CodeModeArtifact,
): CodeModeArtifactSummary | undefined {
  return artifacts.get(artifact)?.summary;
}

type MutableUsage = {
  operationCalls: number;
  effectCalls: number;
  tokens: number;
  wallClockMs: number;
};

function snapshotUsage(usage: MutableUsage): CodeModeRuntimeUsage {
  return { ...usage };
}

function aborted(usage: MutableUsage): CodeModeExecutionFailure {
  return {
    kind: "timeout",
    diagnostics: [
      diagnostic("BUDGET_EXCEEDED", "CodeMode execution was aborted."),
    ],
    usage: snapshotUsage(usage),
  };
}

function signalWasAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function invokeOperation(
  operation: RuntimeOperation,
  value: unknown,
  effectHandler: CodeModeEffectHandler,
  policy: CompilationPolicy,
  usage: MutableUsage,
  catalog: ReturnType<typeof readCatalog>,
  signal: AbortSignal,
): Promise<Result<unknown, CodeModeExecutionFailure>> {
  if (signalWasAborted(signal)) return { ok: false, error: aborted(usage) };
  usage.operationCalls += 1;
  if (operation.kind === "function" || operation.kind === "fixedPointStep") {
    const result = operation.invoke(value);
    return result.ok
      ? result
      : {
          ok: false,
          error: {
            kind: "runtime-exception",
            diagnostics: [result.error],
            usage: snapshotUsage(usage),
          },
        };
  }
  if (operation.kind === "predicate") {
    const result = operation.test(value);
    return result.ok
      ? result
      : {
          ok: false,
          error: {
            kind: "runtime-exception",
            diagnostics: [result.error],
            usage: snapshotUsage(usage),
          },
        };
  }
  if (operation.kind !== "effect")
    return {
      ok: false,
      error: {
        kind: "runtime-exception",
        diagnostics: [
          runtimeFailure(
            `operation ${referenceKey(operation)} cannot be directly invoked`,
          ),
        ],
        usage: snapshotUsage(usage),
      },
    };
  if (!policy.allowedCapabilities.includes(operation.capability))
    return {
      ok: false,
      error: {
        kind: "capability-violation",
        diagnostics: [
          diagnostic(
            "DENIED_CAPABILITY",
            `CodeMode capability ${operation.capability} is not authorized.`,
          ),
        ],
        usage: snapshotUsage(usage),
      },
    };
  usage.effectCalls += 1;
  if (usage.effectCalls > policy.budget.maxEffectCalls)
    return {
      ok: false,
      error: {
        kind: "budget-violation",
        diagnostics: [
          diagnostic(
            "BUDGET_EXCEEDED",
            "CodeMode runtime effect calls exceeded the trusted policy.",
          ),
        ],
        usage: snapshotUsage(usage),
      },
    };
  const result = await effectHandler({
    operation: { id: operation.id, version: operation.version },
    effectName: operation.effectName,
    capability: operation.capability,
    input: value,
    signal,
  });
  if (signalWasAborted(signal)) return { ok: false, error: aborted(usage) };
  if (!result.ok)
    return {
      ok: false,
      error: {
        kind: "runtime-exception",
        diagnostics: [result.error],
        usage: snapshotUsage(usage),
      },
    };
  usage.tokens += result.value.usage.tokens;
  usage.wallClockMs += result.value.usage.wallClockMs;
  if (
    usage.tokens > policy.budget.maxTokens ||
    usage.wallClockMs > policy.budget.maxWallClockMs
  )
    return {
      ok: false,
      error: {
        kind: "budget-violation",
        diagnostics: [
          diagnostic(
            "BUDGET_EXCEEDED",
            "CodeMode runtime effect usage exceeded the trusted policy.",
          ),
        ],
        usage: snapshotUsage(usage),
      },
    };
  const outputSchema = catalog.schemas.get(referenceKey(operation.output));
  const output = outputSchema?.parse(result.value.value);
  return output?.ok
    ? output
    : {
        ok: false,
        error: {
          kind: "runtime-exception",
          diagnostics: [
            output?.error ?? runtimeFailure("effect output schema disappeared"),
          ],
          usage: snapshotUsage(usage),
        },
      };
}

function valueAt(
  expression: ValueExpression,
  inputs: ReadonlyMap<string, unknown>,
  bindings: ReadonlyMap<string, unknown>,
): Result<unknown, Diagnostic> {
  if (expression.kind === "literal")
    return { ok: true, value: expression.value };
  const value =
    expression.kind === "input"
      ? inputs.get(expression.name)
      : bindings.get(expression.name);
  return value === undefined
    ? {
        ok: false,
        error: runtimeFailure(
          `${expression.kind} ${expression.name} has no runtime value`,
        ),
      }
    : { ok: true, value };
}

async function runExpression(
  expression: CapabilityExpression,
  stored: StoredArtifact,
  effectHandler: CodeModeEffectHandler,
  inputs: ReadonlyMap<string, unknown>,
  bindings: ReadonlyMap<string, unknown>,
  usage: MutableUsage,
  signal: AbortSignal,
): Promise<Result<unknown, CodeModeExecutionFailure>> {
  const catalog = readCatalog(stored.catalog);
  if (signalWasAborted(signal)) return { ok: false, error: aborted(usage) };
  if (expression.kind === "select") {
    const condition = valueAt(expression.condition, inputs, bindings);
    if (!condition.ok || typeof condition.value !== "boolean")
      return {
        ok: false,
        error: {
          kind: "runtime-exception",
          diagnostics: [
            condition.ok
              ? runtimeFailure("select condition must be boolean")
              : condition.error,
          ],
          usage: snapshotUsage(usage),
        },
      };
    const selected = valueAt(
      condition.value ? expression.primary : expression.fallback,
      inputs,
      bindings,
    );
    return selected.ok
      ? selected
      : {
          ok: false,
          error: {
            kind: "runtime-exception",
            diagnostics: [selected.error],
            usage: snapshotUsage(usage),
          },
        };
  }
  const source = valueAt(expression.source, inputs, bindings);
  if (!source.ok)
    return {
      ok: false,
      error: {
        kind: "runtime-exception",
        diagnostics: [source.error],
        usage: snapshotUsage(usage),
      },
    };
  if (expression.kind === "boundedFix") {
    const step = catalog.operations.get(referenceKey(expression.step));
    const measure = catalog.operations.get(referenceKey(expression.measure));
    if (step?.kind !== "fixedPointStep" || measure?.kind !== "measure")
      return {
        ok: false,
        error: {
          kind: "runtime-exception",
          diagnostics: [runtimeFailure("boundedFix operations disappeared")],
          usage: snapshotUsage(usage),
        },
      };
    let current = source.value;
    for (let index = 0; index < expression.limit; index += 1) {
      usage.operationCalls += 1;
      const before = measure.measure(current);
      if (!before.ok)
        return {
          ok: false,
          error: {
            kind: "runtime-exception",
            diagnostics: [before.error],
            usage: snapshotUsage(usage),
          },
        };
      if (before.value === 0) return { ok: true, value: current };
      const next = await invokeOperation(
        step,
        current,
        effectHandler,
        stored.policy,
        usage,
        catalog,
        signal,
      );
      if (!next.ok) return next;
      usage.operationCalls += 1;
      const after = measure.measure(next.value);
      if (!after.ok)
        return {
          ok: false,
          error: {
            kind: "runtime-exception",
            diagnostics: [after.error],
            usage: snapshotUsage(usage),
          },
        };
      if (after.value >= before.value)
        return {
          ok: false,
          error: {
            kind: "runtime-exception",
            diagnostics: [
              diagnostic(
                "NON_DECREASING_RECURSION_MEASURE",
                "CodeMode boundedFix did not strictly decrease its measure.",
              ),
            ],
            usage: snapshotUsage(usage),
          },
        };
      current = next.value;
    }
    return {
      ok: false,
      error: {
        kind: "budget-violation",
        diagnostics: [
          diagnostic(
            "BUDGET_EXCEEDED",
            "CodeMode boundedFix exhausted its hard limit.",
          ),
        ],
        usage: snapshotUsage(usage),
      },
    };
  }
  const operation = catalog.operations.get(referenceKey(expression.operation));
  if (operation === undefined)
    return {
      ok: false,
      error: {
        kind: "runtime-exception",
        diagnostics: [runtimeFailure("compiled operation disappeared")],
        usage: snapshotUsage(usage),
      },
    };
  if (
    expression.method === "map" ||
    expression.method === "filter" ||
    expression.method === "fold"
  ) {
    if (!Array.isArray(source.value))
      return {
        ok: false,
        error: {
          kind: "runtime-exception",
          diagnostics: [
            runtimeFailure(`${expression.method} source must be an array`),
          ],
          usage: snapshotUsage(usage),
        },
      };
    if (expression.method === "map") {
      const output: Array<unknown> = [];
      for (const item of source.value) {
        const result = await invokeOperation(
          operation,
          item,
          effectHandler,
          stored.policy,
          usage,
          catalog,
          signal,
        );
        if (!result.ok) return result;
        output.push(result.value);
      }
      return { ok: true, value: output };
    }
    if (expression.method === "filter") {
      const output: Array<unknown> = [];
      for (const item of source.value) {
        const result = await invokeOperation(
          operation,
          item,
          effectHandler,
          stored.policy,
          usage,
          catalog,
          signal,
        );
        if (!result.ok) return result;
        if (result.value === true) output.push(item);
      }
      return { ok: true, value: output };
    }
    if (operation.kind !== "reducer")
      return {
        ok: false,
        error: {
          kind: "runtime-exception",
          diagnostics: [runtimeFailure("fold reducer disappeared")],
          usage: snapshotUsage(usage),
        },
      };
    let accumulator: unknown = operation.identity;
    for (const item of source.value) {
      usage.operationCalls += 1;
      const result = operation.reduce(accumulator, item);
      if (!result.ok)
        return {
          ok: false,
          error: {
            kind: "runtime-exception",
            diagnostics: [result.error],
            usage: snapshotUsage(usage),
          },
        };
      accumulator = result.value;
    }
    return { ok: true, value: accumulator };
  }
  return invokeOperation(
    operation,
    source.value,
    effectHandler,
    stored.policy,
    usage,
    catalog,
    signal,
  );
}

export async function executeCodeMode(
  artifact: CodeModeArtifact,
  options: ExecuteCodeModeOptions,
): Promise<Result<CodeModeExecutionResult, CodeModeExecutionFailure>> {
  const base = artifacts.get(artifact);
  const zero: MutableUsage = {
    operationCalls: 0,
    effectCalls: 0,
    tokens: 0,
    wallClockMs: 0,
  };
  if (base === undefined)
    return {
      ok: false,
      error: {
        kind: "invalid-artifact",
        diagnostics: [
          diagnostic(
            "INVALID_EXECUTABLE_PLAN",
            "Execution requires an artifact returned by compileCodeMode.",
          ),
        ],
        usage: snapshotUsage(zero),
      },
    };
  const stored = base;
  const abortController = new AbortController();
  for (const taskInput of stored.taskInputs) {
    const schema = readCatalog(stored.catalog).schemas.get(
      referenceKey(taskInput.schema),
    );
    const parsed = schema?.parse(options.inputs.get(taskInput.name));
    if (!parsed?.ok)
      return {
        ok: false,
        error: {
          kind: "runtime-exception",
          diagnostics: [
            parsed?.error ??
              runtimeFailure(`input ${taskInput.name} schema disappeared`),
          ],
          usage: snapshotUsage(zero),
        },
      };
  }
  const work = async (): Promise<
    Result<CodeModeExecutionResult, CodeModeExecutionFailure>
  > => {
    const bindings = new Map<string, unknown>();
    for (const binding of stored.program.bindings) {
      const result = await runExpression(
        binding.expression,
        stored,
        options.effectHandler,
        options.inputs,
        bindings,
        zero,
        abortController.signal,
      );
      if (!result.ok) return result;
      bindings.set(binding.name, result.value);
    }
    const output = valueAt(stored.program.root, options.inputs, bindings);
    return output.ok
      ? {
          ok: true,
          value: {
            output: output.value,
            usage: snapshotUsage(zero),
            predictedUsage: stored.summary.analysis,
          },
        }
      : {
          ok: false,
          error: {
            kind: "runtime-exception",
            diagnostics: [output.error],
            usage: snapshotUsage(zero),
          },
        };
  };
  const timeoutMs = options.timeoutMs ?? stored.policy.budget.maxWallClockMs;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<
    Result<CodeModeExecutionResult, CodeModeExecutionFailure>
  >((resolve) => {
    timeoutId = setTimeout(() => {
      abortController.abort();
      resolve({
        ok: false,
        error: {
          kind: "timeout",
          diagnostics: [
            diagnostic(
              "BUDGET_EXCEEDED",
              `CodeMode execution exceeded ${timeoutMs} milliseconds.`,
            ),
          ],
          usage: snapshotUsage(zero),
        },
      });
    }, timeoutMs);
  });
  const result = await Promise.race([work(), timeout]);
  if (timeoutId !== undefined) clearTimeout(timeoutId);
  return result;
}
