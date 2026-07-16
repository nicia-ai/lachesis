import { z } from "zod";

import { analyzePlan } from "./analyze.js";
import { canonicalizePlan, hashPlan } from "./canonical.js";
import { type Catalog, snapshotCatalog } from "./catalog.js";
import { checkPlan } from "./check.js";
import { type Diagnostic, diagnostic, type Diagnostics } from "./diagnostic.js";
import { createExecutablePlan, type ExecutablePlan } from "./executable.js";
import { planHashSchema } from "./identity.js";
import { parsePlanJson } from "./json.js";
import {
  type CompilationPolicy,
  createPlanLanguageManifest,
} from "./manifest.js";
import { normalizePlan } from "./normalize.js";
import type { PlanAnalysis } from "./plan.js";
import { err, ok, type Result } from "./result.js";
import {
  enforceSemanticObligations,
  type SemanticObligationInput,
  semanticObligationSchema,
} from "./semantic.js";
import { planBudgetSchema } from "./wire.js";

const compilationPolicySchema = z
  .strictObject({
    allowedCapabilities: z
      .array(z.string().min(1).max(128))
      .max(256)
      .readonly(),
    budget: planBudgetSchema,
  })
  .readonly();

const BUDGET_LIMITS: ReadonlyArray<
  readonly [keyof CompilationPolicy["budget"], string]
> = [
  ["maxEffectCalls", "effect calls"],
  ["maxCollectionItems", "collection items"],
  ["maxRecursionDepth", "recursion depth"],
  ["maxTokens", "tokens"],
  ["maxWallClockMs", "wall-clock milliseconds"],
  ["maxParallelism", "parallelism"],
];

function enforceRequirements(
  analysis: PlanAnalysis,
  policy: CompilationPolicy,
): ReadonlyArray<Diagnostic> {
  const diagnostics: Array<Diagnostic> = [];
  for (const capability of analysis.capabilitiesRequired) {
    if (!policy.allowedCapabilities.includes(capability))
      diagnostics.push(
        diagnostic(
          "DENIED_CAPABILITY",
          `Required capability ${capability} is not allowed by trusted policy.`,
          {},
          [{ key: "capability", value: capability }],
        ),
      );
  }
  const requirements = new Map<
    keyof CompilationPolicy["budget"],
    PlanAnalysis["maximumEffectCalls"]
  >([
    ["maxEffectCalls", analysis.maximumEffectCalls],
    ["maxCollectionItems", analysis.maximumCollectionFanOut],
    ["maxRecursionDepth", analysis.maximumRecursionDepth],
    ["maxTokens", analysis.maximumDeclaredTokens],
    ["maxWallClockMs", analysis.maximumDeclaredWallClockMs],
    ["maxParallelism", analysis.maximumParallelism],
  ]);
  for (const [key, label] of BUDGET_LIMITS) {
    const requirement = requirements.get(key);
    if (requirement?.kind === "known" && requirement.value > policy.budget[key])
      diagnostics.push(
        diagnostic(
          "BUDGET_EXCEEDED",
          `Maximum ${label} ${requirement.value} exceeds trusted limit ${policy.budget[key]}.`,
          {},
          [
            { key: "resource", value: label },
            { key: "maximum", value: requirement.value },
            { key: "limit", value: policy.budget[key] },
          ],
          {
            limit: {
              resource: label,
              actual: requirement.value,
              limit: policy.budget[key],
            },
          },
        ),
      );
  }
  return diagnostics;
}

/** The only public route from untrusted plan text to an executable artifact. */
export async function compilePlanJson(
  text: string,
  catalog: Catalog,
  policy: CompilationPolicy,
  semanticObligations: ReadonlyArray<SemanticObligationInput> = [],
): Promise<Result<ExecutablePlan, Diagnostics>> {
  const parsedPolicy = compilationPolicySchema.safeParse(policy);
  if (!parsedPolicy.success) {
    return err(
      parsedPolicy.error.issues.map((issue) => {
        const path = issue.path.map((part) =>
          typeof part === "symbol" ? String(part) : part,
        );
        return diagnostic(
          "INVALID_WIRE_SCHEMA",
          `Invalid compilation policy: ${issue.message}`,
          { path },
          [],
          { repair: { path } },
        );
      }),
    );
  }
  const parsed = parsePlanJson(text);
  if (!parsed.ok) return parsed;
  const normalized = normalizePlan(parsed.value);
  if (!normalized.ok) return normalized;
  const snapshot = snapshotCatalog(catalog);
  const checked = checkPlan(normalized.value, snapshot);
  if (!checked.ok) return checked;
  const analysis = analyzePlan(checked.value);
  if (!analysis.ok) return analysis;
  const parsedObligations = z
    .array(semanticObligationSchema)
    .readonly()
    .safeParse(semanticObligations);
  if (!parsedObligations.success)
    return err(
      parsedObligations.error.issues.map((issue) =>
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          `Invalid semantic obligation: ${issue.message}`,
          {
            path: issue.path.map((part) =>
              typeof part === "symbol" ? String(part) : part,
            ),
          },
        ),
      ),
    );
  const semanticDiagnostics = enforceSemanticObligations(
    checked.value,
    analysis.value,
    parsedObligations.data,
  );
  if (semanticDiagnostics.length > 0) return err(semanticDiagnostics);
  const requirementDiagnostics = enforceRequirements(
    analysis.value,
    parsedPolicy.data,
  );
  if (requirementDiagnostics.length > 0) return err(requirementDiagnostics);
  const planHash = await hashPlan(parsed.value);
  if (!planHash.ok) return err([planHash.error]);
  const canonical = canonicalizePlan(parsed.value);
  if (!canonical.ok) return err([canonical.error]);
  const manifest = await createPlanLanguageManifest(
    snapshot,
    parsedPolicy.data,
  );
  if (!manifest.ok) return err([manifest.error]);
  return ok(
    createExecutablePlan({
      checked: checked.value,
      analysis: analysis.value,
      catalog: snapshot,
      catalogFingerprint: manifest.value.catalogFingerprint,
      planHash: planHashSchema.parse(planHash.value),
      policy: parsedPolicy.data,
      canonicalPlan: canonical.value,
    }),
  );
}
