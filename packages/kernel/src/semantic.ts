import { z } from "zod";

import { referenceKey } from "./catalog.js";
import { type Diagnostic, diagnostic } from "./diagnostic.js";
import { nodeDependencies } from "./normalize.js";
import type { CheckedPlan, PlanAnalysis, RootProvenance } from "./plan.js";
import type { NodeId, OperationReference, WireNode } from "./wire.js";
import { operationReferenceSchema } from "./wire.js";

const operationObligationSchema = z
  .strictObject({
    kind: z.literal("requiresOperation"),
    operation: operationReferenceSchema,
  })
  .readonly();

export const semanticObligationSchema = z.discriminatedUnion("kind", [
  operationObligationSchema,
  z
    .strictObject({
      kind: z.literal("operationDominatesRoot"),
      operation: operationReferenceSchema,
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("rootDependsOnInput"),
      inputKey: z.string().min(1).max(128),
    })
    .readonly(),
  z.strictObject({ kind: z.literal("requiresStateChange") }).readonly(),
  z
    .strictObject({
      kind: z.literal("requiresEffect"),
      effectName: z.string().min(1).max(128),
    })
    .readonly(),
]);

export type SemanticObligation = z.infer<typeof semanticObligationSchema>;
export type SemanticObligationInput = z.input<typeof semanticObligationSchema>;

export function nodeOperationReferences(
  node: WireNode,
): ReadonlyArray<OperationReference> {
  switch (node.op) {
    case "invoke":
      return [node.function];
    case "map":
      return [node.operation];
    case "filter":
      return [node.predicate];
    case "fold":
      return [node.reducer];
    case "effect":
      return [node.effect];
    case "boundedFix":
      return [node.step, node.measure];
    case "input":
    case "constant":
    case "select":
    case "checkpoint":
      return [];
  }
}

function intersectSets<T>(sets: ReadonlyArray<ReadonlySet<T>>): Set<T> {
  const [first, ...rest] = sets;
  if (first === undefined) return new Set();
  return new Set(
    [...first].filter((value) => rest.every((set) => set.has(value))),
  );
}

export function analyzeRootProvenance(plan: CheckedPlan): RootProvenance {
  const nodeDependenciesAtRoot = new Set<NodeId>();
  const inputDependencies = new Set<string>();
  const operations = new Map<string, OperationReference>();
  const effects = new Set<string>();
  const stateChangingOperations = new Map<string, OperationReference>();
  const dominators = new Map<NodeId, ReadonlySet<NodeId>>();

  for (const nodeId of plan.normalized.topologicalOrder) {
    const node = plan.normalized.nodes.get(nodeId);
    if (node === undefined) continue;
    const dependencies = nodeDependencies(node);
    const inherited = intersectSets(
      dependencies.flatMap((dependency) => {
        const values = dominators.get(dependency);
        return values === undefined ? [] : [values];
      }),
    );
    inherited.add(nodeId);
    dominators.set(nodeId, inherited);
  }

  function visit(nodeId: NodeId): void {
    if (nodeDependenciesAtRoot.has(nodeId)) return;
    nodeDependenciesAtRoot.add(nodeId);
    const node = plan.normalized.nodes.get(nodeId);
    const checked = plan.nodes.get(nodeId);
    if (node === undefined || checked === undefined) return;
    if (node.op === "input") inputDependencies.add(node.inputKey);
    for (const reference of nodeOperationReferences(node))
      operations.set(referenceKey(reference), reference);
    if (checked.operation?.kind === "effect")
      effects.add(checked.operation.effectName);
    if (checked.operation?.semantics.stateChanging === true) {
      const reference = nodeOperationReferences(node).at(0);
      if (reference !== undefined)
        stateChangingOperations.set(referenceKey(reference), reference);
    }
    for (const dependency of nodeDependencies(node)) visit(dependency);
  }
  visit(plan.normalized.wire.root);

  return {
    nodeDependencies: nodeDependenciesAtRoot,
    inputDependencies,
    operationDependencies: operations,
    effectDependencies: effects,
    stateChangingOperations,
    dominators: dominators.get(plan.normalized.wire.root) ?? new Set(),
  };
}

function operationDominates(
  plan: CheckedPlan,
  provenance: RootProvenance,
  operation: OperationReference,
): boolean {
  const key = referenceKey(operation);
  return [...provenance.dominators].some((nodeId) => {
    const node = plan.normalized.nodes.get(nodeId);
    return (
      node !== undefined &&
      nodeOperationReferences(node).some(
        (reference) => referenceKey(reference) === key,
      )
    );
  });
}

export function enforceSemanticObligations(
  plan: CheckedPlan,
  analysis: PlanAnalysis,
  obligations: ReadonlyArray<SemanticObligation>,
): ReadonlyArray<Diagnostic> {
  const diagnostics: Array<Diagnostic> = [];
  for (const obligation of obligations) {
    let satisfied: boolean;
    switch (obligation.kind) {
      case "requiresOperation":
        satisfied = analysis.rootProvenance.operationDependencies.has(
          referenceKey(obligation.operation),
        );
        break;
      case "operationDominatesRoot":
        satisfied = operationDominates(
          plan,
          analysis.rootProvenance,
          obligation.operation,
        );
        break;
      case "rootDependsOnInput":
        satisfied = analysis.rootProvenance.inputDependencies.has(
          obligation.inputKey,
        );
        break;
      case "requiresStateChange":
        satisfied = analysis.rootProvenance.stateChangingOperations.size > 0;
        break;
      case "requiresEffect":
        satisfied = analysis.rootProvenance.effectDependencies.has(
          obligation.effectName,
        );
        break;
    }
    if (!satisfied)
      diagnostics.push(
        diagnostic(
          "SEMANTIC_OBLIGATION_FAILED",
          `Plan does not satisfy semantic obligation ${obligation.kind}.`,
          {},
          [{ key: "obligation", value: obligation.kind }],
          { repair: { path: ["semanticObligations"] } },
        ),
      );
  }
  return diagnostics;
}
