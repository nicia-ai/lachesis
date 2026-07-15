import type { RuntimeOperation, RuntimeSchema } from "./catalog.js";
import type { NodeId, WireNode, WirePlan } from "./wire.js";

export type Bound =
  | Readonly<{ kind: "known"; value: number }>
  | Readonly<{ kind: "unknown"; reason: string }>;

export type NormalizedPlan = Readonly<{
  wire: WirePlan;
  nodes: ReadonlyMap<NodeId, WireNode>;
  topologicalOrder: ReadonlyArray<NodeId>;
}>;

export type CheckedNode = Readonly<{
  node: WireNode;
  outputSchema: RuntimeSchema;
  operation?: RuntimeOperation | undefined;
  cardinality: Bound;
}>;

export type CheckedPlan = Readonly<{
  normalized: NormalizedPlan;
  nodes: ReadonlyMap<NodeId, CheckedNode>;
  root: CheckedNode;
}>;

export type PlanAnalysis = Readonly<{
  inferredSchemas: ReadonlyMap<
    NodeId,
    Readonly<{ id: string; version: string }>
  >;
  topologicalStages: ReadonlyArray<ReadonlyArray<NodeId>>;
  effectsUsed: ReadonlySet<string>;
  capabilitiesRequired: ReadonlySet<string>;
  cacheableNodes: ReadonlySet<NodeId>;
  replayableNodes: ReadonlySet<NodeId>;
  maximumEffectCalls: Bound;
  maximumRecursionDepth: Bound;
  maximumCollectionFanOut: Bound;
  maximumDeclaredTokens: Bound;
  maximumDeclaredWallClockMs: Bound;
  maximumParallelism: Bound;
  everyRelevantBoundProven: boolean;
}>;
