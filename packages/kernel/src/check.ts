import {
  type Catalog,
  referenceKey,
  type RuntimeOperation,
  type RuntimeSchema,
} from "./catalog.js";
import { type Diagnostic, diagnostic } from "./diagnostic.js";
import type {
  Bound,
  CheckedNode,
  CheckedPlan,
  NormalizedPlan,
} from "./plan.js";
import { err, ok, type Result } from "./result.js";
import type { NodeId, VersionedReference, WireNode } from "./wire.js";

function referencesEqual(
  left: VersionedReference,
  right: VersionedReference,
): boolean {
  return left.id === right.id && left.version === right.version;
}

function known(value: number): Bound {
  return { kind: "known", value };
}

function unknown(reason: string): Bound {
  return { kind: "unknown", reason };
}

function resolveSchema(
  catalog: Catalog,
  reference: VersionedReference,
  nodeId: NodeId,
  diagnostics: Array<Diagnostic>,
): RuntimeSchema | undefined {
  const schema = catalog.schemas.get(referenceKey(reference));
  if (schema === undefined) {
    diagnostics.push(
      diagnostic(
        "UNKNOWN_SCHEMA",
        `Unknown schema ${referenceKey(reference)}.`,
        { nodeId },
      ),
    );
  }
  return schema;
}

function resolveOperation(
  catalog: Catalog,
  reference: VersionedReference,
  nodeId: NodeId,
  diagnostics: Array<Diagnostic>,
): RuntimeOperation | undefined {
  const operation = catalog.operations.get(referenceKey(reference));
  if (operation === undefined) {
    diagnostics.push(
      diagnostic(
        "UNKNOWN_OPERATION",
        `Unknown operation ${referenceKey(reference)}.`,
        { nodeId },
      ),
    );
  }
  return operation;
}

function expectKind<K extends RuntimeOperation["kind"]>(
  operation: RuntimeOperation | undefined,
  kind: K,
  nodeId: NodeId,
  diagnostics: Array<Diagnostic>,
): Extract<RuntimeOperation, Readonly<{ kind: K }>> | undefined {
  if (operation === undefined) return undefined;
  if (!hasOperationKind(operation, kind)) {
    diagnostics.push(
      diagnostic(
        "OPERATION_KIND_MISMATCH",
        `Operation ${referenceKey(operation)} is ${operation.kind}, expected ${kind}.`,
        { nodeId },
      ),
    );
    return undefined;
  }
  return operation;
}

function hasOperationKind<K extends RuntimeOperation["kind"]>(
  operation: RuntimeOperation,
  kind: K,
): operation is Extract<RuntimeOperation, Readonly<{ kind: K }>> {
  return operation.kind === kind;
}

function expectType(
  actual: RuntimeSchema,
  expected: VersionedReference,
  nodeId: NodeId,
  diagnostics: Array<Diagnostic>,
  code: "TYPE_MISMATCH" | "BRANCH_TYPE_MISMATCH" = "TYPE_MISMATCH",
): boolean {
  if (referencesEqual(actual, expected)) return true;
  diagnostics.push(
    diagnostic(
      code,
      `Schema ${referenceKey(actual)} is not compatible with ${referenceKey(expected)}.`,
      {
        nodeId,
      },
    ),
  );
  return false;
}

function collectionBound(
  schema: RuntimeSchema,
  explicitMaximum?: number,
): Bound {
  if (schema.kind.kind === "scalar") return known(1);
  const value = explicitMaximum ?? schema.kind.defaultMaxItems;
  return value === undefined
    ? unknown(`Schema ${referenceKey(schema)} has no maximum cardinality.`)
    : known(value);
}

function checkedDependency(
  checked: ReadonlyMap<NodeId, CheckedNode>,
  nodeId: NodeId,
): CheckedNode | undefined {
  return checked.get(nodeId);
}

function collectionElement(
  schema: RuntimeSchema,
  nodeId: NodeId,
  diagnostics: Array<Diagnostic>,
): VersionedReference | undefined {
  if (schema.kind.kind === "collection") return schema.kind.element;
  diagnostics.push(
    diagnostic(
      "TYPE_MISMATCH",
      `Schema ${referenceKey(schema)} is not a collection.`,
      { nodeId },
    ),
  );
  return undefined;
}

function checkNode(
  node: WireNode,
  checked: ReadonlyMap<NodeId, CheckedNode>,
  catalog: Catalog,
  diagnostics: Array<Diagnostic>,
): CheckedNode | undefined {
  switch (node.op) {
    case "input": {
      const schema = resolveSchema(catalog, node.schema, node.id, diagnostics);
      return schema === undefined
        ? undefined
        : {
            node,
            outputSchema: schema,
            cardinality: collectionBound(schema, node.maxItems),
          };
    }
    case "constant": {
      const schema = resolveSchema(catalog, node.schema, node.id, diagnostics);
      if (schema === undefined) return undefined;
      const parsed = schema.parse(node.value);
      if (!parsed.ok) {
        diagnostics.push({ ...parsed.error, location: { nodeId: node.id } });
        return undefined;
      }
      const cardinality =
        schema.kind.kind === "collection" && Array.isArray(parsed.value)
          ? known(parsed.value.length)
          : collectionBound(schema);
      return { node, outputSchema: schema, cardinality };
    }
    case "invoke": {
      const source = checkedDependency(checked, node.source);
      const operation = expectKind(
        resolveOperation(catalog, node.function, node.id, diagnostics),
        "function",
        node.id,
        diagnostics,
      );
      if (source === undefined || operation === undefined) return undefined;
      expectType(source.outputSchema, operation.input, node.id, diagnostics);
      const output = resolveSchema(
        catalog,
        operation.output,
        node.id,
        diagnostics,
      );
      return output === undefined
        ? undefined
        : {
            node,
            outputSchema: output,
            operation,
            cardinality: collectionBound(output, operation.maxOutputItems),
          };
    }
    case "map": {
      const source = checkedDependency(checked, node.source);
      const operation = resolveOperation(
        catalog,
        node.operation,
        node.id,
        diagnostics,
      );
      const expectedOperation =
        node.operation.kind === "function"
          ? expectKind(operation, "function", node.id, diagnostics)
          : expectKind(operation, "effect", node.id, diagnostics);
      const output = resolveSchema(
        catalog,
        node.outputCollectionSchema,
        node.id,
        diagnostics,
      );
      if (
        source === undefined ||
        expectedOperation === undefined ||
        output === undefined
      )
        return undefined;
      const sourceElement = collectionElement(
        source.outputSchema,
        node.id,
        diagnostics,
      );
      const outputElement = collectionElement(output, node.id, diagnostics);
      if (sourceElement !== undefined) {
        const elementSchema = resolveSchema(
          catalog,
          sourceElement,
          node.id,
          diagnostics,
        );
        if (elementSchema !== undefined)
          expectType(
            elementSchema,
            expectedOperation.input,
            node.id,
            diagnostics,
          );
      }
      if (
        outputElement !== undefined &&
        !referencesEqual(outputElement, expectedOperation.output)
      ) {
        diagnostics.push(
          diagnostic(
            "TYPE_MISMATCH",
            "Mapped operation output does not match the output collection element.",
            {
              nodeId: node.id,
            },
          ),
        );
      }
      return {
        node,
        outputSchema: output,
        operation: expectedOperation,
        cardinality: source.cardinality,
      };
    }
    case "filter": {
      const source = checkedDependency(checked, node.source);
      const predicate = expectKind(
        resolveOperation(catalog, node.predicate, node.id, diagnostics),
        "predicate",
        node.id,
        diagnostics,
      );
      if (source === undefined || predicate === undefined) return undefined;
      const element = collectionElement(
        source.outputSchema,
        node.id,
        diagnostics,
      );
      if (element !== undefined) {
        const elementSchema = resolveSchema(
          catalog,
          element,
          node.id,
          diagnostics,
        );
        if (elementSchema !== undefined)
          expectType(elementSchema, predicate.input, node.id, diagnostics);
      }
      return {
        node,
        outputSchema: source.outputSchema,
        operation: predicate,
        cardinality: source.cardinality,
      };
    }
    case "fold": {
      const source = checkedDependency(checked, node.source);
      const reducer = expectKind(
        resolveOperation(catalog, node.reducer, node.id, diagnostics),
        "reducer",
        node.id,
        diagnostics,
      );
      if (source === undefined || reducer === undefined) return undefined;
      const element = collectionElement(
        source.outputSchema,
        node.id,
        diagnostics,
      );
      if (element !== undefined && !referencesEqual(element, reducer.element)) {
        diagnostics.push(
          diagnostic(
            "TYPE_MISMATCH",
            "Reducer element schema does not match collection element schema.",
            {
              nodeId: node.id,
            },
          ),
        );
      }
      const output = resolveSchema(
        catalog,
        reducer.accumulator,
        node.id,
        diagnostics,
      );
      return output === undefined
        ? undefined
        : {
            node,
            outputSchema: output,
            operation: reducer,
            cardinality: known(1),
          };
    }
    case "select": {
      const condition = checkedDependency(checked, node.condition);
      const whenTrue = checkedDependency(checked, node.whenTrue);
      const whenFalse = checkedDependency(checked, node.whenFalse);
      if (
        condition === undefined ||
        whenTrue === undefined ||
        whenFalse === undefined
      )
        return undefined;
      if (
        condition.outputSchema.kind.kind !== "scalar" ||
        condition.outputSchema.kind.semantic !== "boolean"
      ) {
        diagnostics.push(
          diagnostic(
            "TYPE_MISMATCH",
            "Select condition must use a boolean schema.",
            { nodeId: node.id },
          ),
        );
      }
      expectType(
        whenTrue.outputSchema,
        whenFalse.outputSchema,
        node.id,
        diagnostics,
        "BRANCH_TYPE_MISMATCH",
      );
      const cardinality =
        whenTrue.cardinality.kind === "known" &&
        whenFalse.cardinality.kind === "known"
          ? known(
              Math.max(whenTrue.cardinality.value, whenFalse.cardinality.value),
            )
          : unknown("A select branch has unknown cardinality.");
      return { node, outputSchema: whenTrue.outputSchema, cardinality };
    }
    case "effect": {
      const source = checkedDependency(checked, node.source);
      const effect = expectKind(
        resolveOperation(catalog, node.effect, node.id, diagnostics),
        "effect",
        node.id,
        diagnostics,
      );
      if (source === undefined || effect === undefined) return undefined;
      expectType(source.outputSchema, effect.input, node.id, diagnostics);
      const output = resolveSchema(
        catalog,
        effect.output,
        node.id,
        diagnostics,
      );
      return output === undefined
        ? undefined
        : {
            node,
            outputSchema: output,
            operation: effect,
            cardinality: collectionBound(output, effect.maxOutputItems),
          };
    }
    case "checkpoint": {
      const source = checkedDependency(checked, node.source);
      return source === undefined
        ? undefined
        : {
            node,
            outputSchema: source.outputSchema,
            cardinality: source.cardinality,
          };
    }
    case "boundedFix": {
      const seed = checkedDependency(checked, node.seed);
      const step = expectKind(
        resolveOperation(catalog, node.step, node.id, diagnostics),
        "fixedPointStep",
        node.id,
        diagnostics,
      );
      const measure = expectKind(
        resolveOperation(catalog, node.measure, node.id, diagnostics),
        "measure",
        node.id,
        diagnostics,
      );
      if (seed === undefined || step === undefined || measure === undefined)
        return undefined;
      expectType(seed.outputSchema, step.input, node.id, diagnostics);
      expectType(seed.outputSchema, step.output, node.id, diagnostics);
      expectType(seed.outputSchema, measure.input, node.id, diagnostics);
      return {
        node,
        outputSchema: seed.outputSchema,
        operation: step,
        cardinality: seed.cardinality,
      };
    }
  }
}

/** Resolves every catalog reference and proves nominal schema compatibility for the complete graph. */
export function checkPlan(
  normalized: NormalizedPlan,
  catalog: Catalog,
): Result<CheckedPlan, ReadonlyArray<Diagnostic>> {
  const diagnostics: Array<Diagnostic> = [];
  if (!referencesEqual(normalized.wire.catalog, catalog.identity)) {
    diagnostics.push(
      diagnostic(
        "UNKNOWN_OPERATION",
        `Plan requires catalog ${referenceKey(normalized.wire.catalog)}, received ${referenceKey(catalog.identity)}.`,
      ),
    );
  }
  const checked = new Map<NodeId, CheckedNode>();
  for (const nodeId of normalized.topologicalOrder) {
    const node = normalized.nodes.get(nodeId);
    if (node === undefined) {
      diagnostics.push(
        diagnostic(
          "INTERNAL_INVARIANT_VIOLATION",
          `Normalized node ${nodeId} disappeared.`,
        ),
      );
      continue;
    }
    const result = checkNode(node, checked, catalog, diagnostics);
    if (result !== undefined) checked.set(nodeId, result);
  }
  const root = checked.get(normalized.wire.root);
  if (root === undefined && diagnostics.length === 0) {
    diagnostics.push(
      diagnostic("INTERNAL_INVARIANT_VIOLATION", "Checked root is missing."),
    );
  }
  return diagnostics.length === 0 && root !== undefined
    ? ok({ normalized, nodes: checked, root })
    : err(diagnostics);
}
