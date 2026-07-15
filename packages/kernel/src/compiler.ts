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
import { err, ok, type Result } from "./result.js";
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

function enforcePolicy(
  policy: CompilationPolicy,
  allowedCapabilities: ReadonlyArray<string>,
  budget: CompilationPolicy["budget"],
): ReadonlyArray<Diagnostic> {
  const diagnostics: Array<Diagnostic> = [];
  for (const capability of allowedCapabilities) {
    if (!policy.allowedCapabilities.includes(capability)) {
      diagnostics.push(
        diagnostic(
          "DENIED_CAPABILITY",
          `Plan capability ${capability} is not available under compilation policy.`,
          { path: ["allowedCapabilities"] },
          [{ key: "capability", value: capability }],
          {
            expected: { value: "capability allowed by policy" },
            actual: { value: capability },
            repair: { path: ["allowedCapabilities"] },
          },
        ),
      );
    }
  }
  const limits: ReadonlyArray<
    readonly [keyof CompilationPolicy["budget"], string]
  > = [
    ["maxEffectCalls", "effect calls"],
    ["maxCollectionItems", "collection items"],
    ["maxRecursionDepth", "recursion depth"],
    ["maxTokens", "tokens"],
    ["maxWallClockMs", "wall-clock milliseconds"],
    ["maxParallelism", "parallelism"],
  ];
  for (const [key, label] of limits) {
    if (budget[key] > policy.budget[key]) {
      diagnostics.push(
        diagnostic(
          "BUDGET_EXCEEDED",
          `Plan ${label} budget ${budget[key]} exceeds policy limit ${policy.budget[key]}.`,
          { path: ["budget", key] },
          [],
          {
            limit: {
              resource: label,
              actual: budget[key],
              limit: policy.budget[key],
            },
            repair: { path: ["budget", key] },
          },
        ),
      );
    }
  }
  return diagnostics;
}

/** The only public route from untrusted plan text to an executable artifact. */
export async function compilePlanJson(
  text: string,
  catalog: Catalog,
  policy: CompilationPolicy,
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
  const policyDiagnostics = enforcePolicy(
    parsedPolicy.data,
    parsed.value.allowedCapabilities,
    parsed.value.budget,
  );
  if (policyDiagnostics.length > 0) return err(policyDiagnostics);
  const normalized = normalizePlan(parsed.value);
  if (!normalized.ok) return normalized;
  const snapshot = snapshotCatalog(catalog);
  const checked = checkPlan(normalized.value, snapshot);
  if (!checked.ok) return checked;
  const analysis = analyzePlan(checked.value);
  if (!analysis.ok) return analysis;
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
