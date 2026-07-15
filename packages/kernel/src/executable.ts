import type { Catalog } from "./catalog.js";
import type { CatalogFingerprint, PlanHash } from "./identity.js";
import type { CompilationPolicy } from "./manifest.js";
import type { CheckedPlan, PlanAnalysis } from "./plan.js";
import type { SchemaReference } from "./wire.js";

const executablePlanBrand: unique symbol = Symbol("ExecutablePlan");

export type ExecutablePlan = Readonly<{
  [executablePlanBrand]: "ExecutablePlan";
}>;

export type ExecutableArtifacts = Readonly<{
  checked: CheckedPlan;
  analysis: PlanAnalysis;
  catalog: Catalog;
  catalogFingerprint: CatalogFingerprint;
  planHash: PlanHash;
  policy: CompilationPolicy;
  canonicalPlan: string;
}>;

export type ExecutablePlanSummary = Readonly<{
  planHash: PlanHash;
  catalogFingerprint: CatalogFingerprint;
  rootSchema: SchemaReference;
  analysis: PlanAnalysis;
  allowedCapabilities: ReadonlyArray<string>;
  budget: CompilationPolicy["budget"];
  canonicalPlan: string;
}>;

const executableArtifacts = new WeakMap<ExecutablePlan, ExecutableArtifacts>();

function cloneAnalysis(analysis: PlanAnalysis): PlanAnalysis {
  return {
    ...analysis,
    inferredSchemas: new Map(analysis.inferredSchemas),
    topologicalStages: analysis.topologicalStages.map((stage) => [...stage]),
    effectsUsed: new Set(analysis.effectsUsed),
    capabilitiesRequired: new Set(analysis.capabilitiesRequired),
    cacheableNodes: new Set(analysis.cacheableNodes),
    replayableNodes: new Set(analysis.replayableNodes),
  };
}

export function createExecutablePlan(
  artifacts: ExecutableArtifacts,
): ExecutablePlan {
  const token: ExecutablePlan = Object.freeze({
    [executablePlanBrand]: "ExecutablePlan",
  });
  executableArtifacts.set(token, Object.freeze(artifacts));
  return token;
}

export function readExecutablePlan(
  executablePlan: ExecutablePlan,
): ExecutableArtifacts | undefined {
  return executableArtifacts.get(executablePlan);
}

export function inspectExecutablePlan(
  executablePlan: ExecutablePlan,
): ExecutablePlanSummary | undefined {
  const artifacts = readExecutablePlan(executablePlan);
  return artifacts === undefined
    ? undefined
    : {
        planHash: artifacts.planHash,
        catalogFingerprint: artifacts.catalogFingerprint,
        rootSchema: {
          id: artifacts.checked.root.outputSchema.id,
          version: artifacts.checked.root.outputSchema.version,
        },
        analysis: cloneAnalysis(artifacts.analysis),
        allowedCapabilities:
          artifacts.checked.normalized.wire.allowedCapabilities,
        budget: artifacts.checked.normalized.wire.budget,
        canonicalPlan: artifacts.canonicalPlan,
      };
}
