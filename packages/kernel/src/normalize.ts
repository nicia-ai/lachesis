import { type Diagnostic, diagnostic } from "./diagnostic.js";
import type { NormalizedPlan } from "./plan.js";
import { err, ok, type Result } from "./result.js";
import type { NodeId, WireNode, WirePlan } from "./wire.js";

export function nodeDependencies(node: WireNode): ReadonlyArray<NodeId> {
  switch (node.op) {
    case "input":
    case "constant": {
      return [];
    }
    case "invoke":
    case "map":
    case "filter":
    case "fold":
    case "effect":
    case "checkpoint": {
      return [node.source];
    }
    case "select": {
      return [node.condition, node.whenTrue, node.whenFalse];
    }
    case "boundedFix": {
      return [node.seed];
    }
  }
}

/** Converts a validated wire array into an immutable, reference-safe acyclic graph. */
export function normalizePlan(
  plan: WirePlan,
): Result<NormalizedPlan, ReadonlyArray<Diagnostic>> {
  const nodes = new Map<NodeId, WireNode>();
  const diagnostics: Array<Diagnostic> = [];
  for (const node of plan.nodes) {
    if (nodes.has(node.id)) {
      diagnostics.push(
        diagnostic("DUPLICATE_NODE_ID", `Duplicate node ID ${node.id}.`, {
          nodeId: node.id,
        }),
      );
    } else nodes.set(node.id, Object.freeze(node));
  }
  if (!nodes.has(plan.root)) {
    diagnostics.push(
      diagnostic("MISSING_ROOT", `Root node ${plan.root} does not exist.`),
    );
  }
  for (const node of nodes.values()) {
    for (const dependency of nodeDependencies(node)) {
      if (!nodes.has(dependency)) {
        diagnostics.push(
          diagnostic(
            "MISSING_NODE_REFERENCE",
            `Node ${node.id} references missing node ${dependency}.`,
            {
              nodeId: node.id,
            },
          ),
        );
      }
    }
  }
  if (diagnostics.length > 0) return err(diagnostics);

  const visiting = new Set<NodeId>();
  const visited = new Set<NodeId>();
  const order: Array<NodeId> = [];
  function visit(nodeId: NodeId): boolean {
    if (visiting.has(nodeId)) {
      diagnostics.push(
        diagnostic("GRAPH_CYCLE", `Graph cycle reaches ${nodeId}.`, { nodeId }),
      );
      return false;
    }
    if (visited.has(nodeId)) return true;
    const node = nodes.get(nodeId);
    if (node === undefined) return false;
    visiting.add(nodeId);
    const valid = nodeDependencies(node).every((dependency) =>
      visit(dependency),
    );
    visiting.delete(nodeId);
    visited.add(nodeId);
    order.push(nodeId);
    return valid;
  }
  for (const nodeId of nodes.keys()) visit(nodeId);
  if (diagnostics.length === 0) {
    const contributing = new Set<NodeId>();
    function markContributing(nodeId: NodeId): void {
      if (contributing.has(nodeId)) return;
      contributing.add(nodeId);
      const node = nodes.get(nodeId);
      if (node === undefined) return;
      for (const dependency of nodeDependencies(node))
        markContributing(dependency);
    }
    markContributing(plan.root);
    for (const nodeId of nodes.keys()) {
      if (contributing.has(nodeId)) continue;
      diagnostics.push(
        diagnostic(
          "DEAD_NODE",
          `Node ${nodeId} does not contribute to root ${plan.root}.`,
          { nodeId },
          [],
          { repair: { nodeId } },
        ),
      );
    }
  }
  return diagnostics.length === 0
    ? ok({ wire: plan, nodes, topologicalOrder: order })
    : err(diagnostics);
}
