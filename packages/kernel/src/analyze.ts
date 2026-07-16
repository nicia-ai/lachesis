import type { RuntimeEffect } from "./catalog.js";
import { type Diagnostic, diagnostic } from "./diagnostic.js";
import { nodeDependencies } from "./normalize.js";
import type { Bound, CheckedNode, CheckedPlan, PlanAnalysis } from "./plan.js";
import { err, ok, type Result } from "./result.js";
import { analyzeRootProvenance } from "./semantic.js";
import type { NodeId } from "./wire.js";

type Metrics = Readonly<{
  effects: ReadonlySet<string>;
  capabilities: ReadonlySet<string>;
  effectCalls: Bound;
  recursionDepth: Bound;
  collectionFanOut: Bound;
  tokens: Bound;
  wallClockMs: Bound;
  parallelism: Bound;
  allEffectsReplayable: boolean;
}>;

const ZERO: Bound = { kind: "known", value: 0 };
const ONE: Bound = { kind: "known", value: 1 };

function add(left: Bound, right: Bound): Bound {
  /* v8 ignore next -- checked graphs never place an unknown bound on the left */
  if (left.kind === "unknown") return left;
  if (right.kind === "unknown") return right;
  return { kind: "known", value: left.value + right.value };
}

function maximum(left: Bound, right: Bound): Bound {
  /* v8 ignore next -- checked graphs never place an unknown bound on the left */
  if (left.kind === "unknown") return left;
  if (right.kind === "unknown") return right;
  return { kind: "known", value: Math.max(left.value, right.value) };
}

function multiply(bound: Bound, multiplier: number): Bound {
  return bound.kind === "known"
    ? { kind: "known", value: bound.value * multiplier }
    : bound;
}

function setUnion<T>(...sets: ReadonlyArray<ReadonlySet<T>>): ReadonlySet<T> {
  const result = new Set<T>();
  for (const set of sets) for (const value of set) result.add(value);
  return result;
}

function emptyMetrics(node: CheckedNode): Metrics {
  return {
    effects: new Set(),
    capabilities: new Set(),
    effectCalls: ZERO,
    recursionDepth: ZERO,
    collectionFanOut: node.cardinality,
    tokens: ZERO,
    wallClockMs: ZERO,
    parallelism: ONE,
    allEffectsReplayable: true,
  };
}

function addEffect(
  base: Metrics,
  effect: RuntimeEffect,
  calls: Bound,
  parallelism: number,
): Metrics {
  return {
    effects: setUnion(base.effects, new Set([effect.effectName])),
    capabilities: setUnion(base.capabilities, new Set([effect.capability])),
    effectCalls: add(base.effectCalls, calls),
    recursionDepth: base.recursionDepth,
    collectionFanOut: base.collectionFanOut,
    tokens: add(base.tokens, multiply(calls, effect.maxTokens)),
    wallClockMs: add(base.wallClockMs, multiply(calls, effect.maxWallClockMs)),
    parallelism: maximum(base.parallelism, {
      kind: "known",
      value: parallelism,
    }),
    allEffectsReplayable: base.allEffectsReplayable && effect.replayable,
  };
}

function mergeAlternative(
  condition: Metrics,
  whenTrue: Metrics,
  whenFalse: Metrics,
): Metrics {
  return {
    effects: setUnion(condition.effects, whenTrue.effects, whenFalse.effects),
    capabilities: setUnion(
      condition.capabilities,
      whenTrue.capabilities,
      whenFalse.capabilities,
    ),
    effectCalls: add(
      condition.effectCalls,
      maximum(whenTrue.effectCalls, whenFalse.effectCalls),
    ),
    recursionDepth: maximum(
      condition.recursionDepth,
      maximum(whenTrue.recursionDepth, whenFalse.recursionDepth),
    ),
    collectionFanOut: maximum(
      condition.collectionFanOut,
      maximum(whenTrue.collectionFanOut, whenFalse.collectionFanOut),
    ),
    tokens: add(condition.tokens, maximum(whenTrue.tokens, whenFalse.tokens)),
    wallClockMs: add(
      condition.wallClockMs,
      maximum(whenTrue.wallClockMs, whenFalse.wallClockMs),
    ),
    parallelism: maximum(
      condition.parallelism,
      maximum(whenTrue.parallelism, whenFalse.parallelism),
    ),
    allEffectsReplayable:
      condition.allEffectsReplayable &&
      whenTrue.allEffectsReplayable &&
      whenFalse.allEffectsReplayable,
  };
}

function dependencyMetrics(
  metrics: ReadonlyMap<NodeId, Metrics>,
  nodeId: NodeId,
  diagnostics: Array<Diagnostic>,
): Metrics | undefined {
  const value = metrics.get(nodeId);
  /* v8 ignore next -- normalization guarantees dependency-first order */
  if (value === undefined) {
    diagnostics.push(
      diagnostic(
        "INTERNAL_INVARIANT_VIOLATION",
        `Metrics missing for ${nodeId}.`,
      ),
    );
  }
  return value;
}

function computeMetrics(
  checkedNode: CheckedNode,
  metrics: ReadonlyMap<NodeId, Metrics>,
  diagnostics: Array<Diagnostic>,
): Metrics | undefined {
  const node = checkedNode.node;
  switch (node.op) {
    case "input":
    case "constant": {
      return emptyMetrics(checkedNode);
    }
    case "invoke":
    case "filter":
    case "fold":
    case "checkpoint": {
      const source = dependencyMetrics(metrics, node.source, diagnostics);
      /* v8 ignore next -- a checked node always has checked dependencies */
      return source === undefined
        ? undefined
        : {
            ...source,
            collectionFanOut: maximum(
              source.collectionFanOut,
              checkedNode.cardinality,
            ),
          };
    }
    case "map": {
      const source = dependencyMetrics(metrics, node.source, diagnostics);
      /* v8 ignore next -- a checked node always has checked dependencies */
      if (source === undefined) return undefined;
      const base = {
        ...source,
        collectionFanOut: maximum(
          source.collectionFanOut,
          checkedNode.cardinality,
        ),
      };
      if (checkedNode.operation?.kind !== "effect") {
        return {
          ...base,
          parallelism: maximum(base.parallelism, {
            kind: "known",
            value: node.parallelism,
          }),
        };
      }
      return addEffect(
        base,
        checkedNode.operation,
        checkedNode.cardinality,
        node.parallelism,
      );
    }
    case "effect": {
      const source = dependencyMetrics(metrics, node.source, diagnostics);
      /* v8 ignore next -- checker binds the effect and its dependency */
      return source === undefined || checkedNode.operation?.kind !== "effect"
        ? undefined
        : addEffect(
            {
              ...source,
              collectionFanOut: maximum(
                source.collectionFanOut,
                checkedNode.cardinality,
              ),
            },
            checkedNode.operation,
            ONE,
            1,
          );
    }
    case "select": {
      const condition = dependencyMetrics(metrics, node.condition, diagnostics);
      const whenTrue = dependencyMetrics(metrics, node.whenTrue, diagnostics);
      const whenFalse = dependencyMetrics(metrics, node.whenFalse, diagnostics);
      /* v8 ignore next -- checker binds all three select dependencies */
      return condition === undefined ||
        whenTrue === undefined ||
        whenFalse === undefined
        ? undefined
        : mergeAlternative(condition, whenTrue, whenFalse);
    }
    case "boundedFix": {
      const seed = dependencyMetrics(metrics, node.seed, diagnostics);
      /* v8 ignore next -- checker binds the fixed-point seed */
      return seed === undefined
        ? undefined
        : {
            ...seed,
            recursionDepth: maximum(seed.recursionDepth, {
              kind: "known",
              value: node.maxIterations,
            }),
          };
    }
  }
}

function buildStages(plan: CheckedPlan): ReadonlyArray<ReadonlyArray<NodeId>> {
  const depths = new Map<NodeId, number>();
  const stages: Array<Array<NodeId>> = [];
  for (const nodeId of plan.normalized.topologicalOrder) {
    const node = plan.normalized.nodes.get(nodeId);
    /* v8 ignore next -- normalization owns this exact order and node map */
    if (node === undefined) continue;
    const depth = nodeDependencies(node).reduce(
      (maximumDepth, dependency) =>
        /* v8 ignore next -- topological dependencies always have a depth */
        Math.max(maximumDepth, (depths.get(dependency) ?? -1) + 1),
      0,
    );
    depths.set(nodeId, depth);
    const stage = stages[depth];
    if (stage === undefined) stages[depth] = [nodeId];
    else stage.push(nodeId);
  }
  return stages;
}

/** Conservatively proves effect, capability, cardinality, recursion, and budget bounds. */
export function analyzePlan(
  plan: CheckedPlan,
): Result<PlanAnalysis, ReadonlyArray<Diagnostic>> {
  const metrics = new Map<NodeId, Metrics>();
  const diagnostics: Array<Diagnostic> = [];
  const cacheable = new Set<NodeId>();
  const replayable = new Set<NodeId>();
  for (const nodeId of plan.normalized.topologicalOrder) {
    const node = plan.nodes.get(nodeId);
    /* v8 ignore next -- checker builds this exact order and node map */
    if (node === undefined) continue;
    const computed = computeMetrics(node, metrics, diagnostics);
    if (computed !== undefined) {
      metrics.set(nodeId, computed);
      if (computed.effects.size === 0) cacheable.add(nodeId);
      if (computed.allEffectsReplayable) replayable.add(nodeId);
    }
  }
  const rootMetrics = metrics.get(plan.normalized.wire.root);
  /* v8 ignore next -- a successful check always has an analyzed root */
  if (rootMetrics === undefined) {
    diagnostics.push(
      diagnostic("INTERNAL_INVARIANT_VIOLATION", "Root analysis is missing."),
    );
    return err(diagnostics);
  }
  const requirements: ReadonlyArray<readonly [string, Bound]> = [
    ["effect calls", rootMetrics.effectCalls],
    ["collection items", rootMetrics.collectionFanOut],
    ["recursion depth", rootMetrics.recursionDepth],
    ["tokens", rootMetrics.tokens],
    ["wall-clock milliseconds", rootMetrics.wallClockMs],
    ["parallelism", rootMetrics.parallelism],
  ];
  for (const [name, bound] of requirements) {
    if (bound.kind === "unknown")
      diagnostics.push(
        diagnostic(
          "UNBOUNDED_CARDINALITY",
          `Cannot prove maximum ${name}: ${bound.reason}`,
        ),
      );
  }
  if (diagnostics.length > 0) return err(diagnostics);
  const inferredSchemas = new Map<
    NodeId,
    Readonly<{ id: string; version: string }>
  >();
  for (const [nodeId, node] of plan.nodes) {
    inferredSchemas.set(nodeId, {
      id: node.outputSchema.id,
      version: node.outputSchema.version,
    });
  }
  return ok({
    inferredSchemas,
    topologicalStages: buildStages(plan),
    effectsUsed: rootMetrics.effects,
    capabilitiesRequired: rootMetrics.capabilities,
    cacheableNodes: cacheable,
    replayableNodes: replayable,
    maximumEffectCalls: rootMetrics.effectCalls,
    maximumRecursionDepth: rootMetrics.recursionDepth,
    maximumCollectionFanOut: rootMetrics.collectionFanOut,
    maximumDeclaredTokens: rootMetrics.tokens,
    maximumDeclaredWallClockMs: rootMetrics.wallClockMs,
    maximumParallelism: rootMetrics.parallelism,
    everyRelevantBoundProven: true,
    rootProvenance: analyzeRootProvenance(plan),
  });
}

export function unionEffectSets(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): ReadonlySet<string> {
  return setUnion(left, right);
}

export function aggregateBound(base: Bound, increment: Bound): Bound {
  return add(base, increment);
}
