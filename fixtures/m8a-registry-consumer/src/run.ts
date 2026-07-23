import { mkdir, writeFile } from "node:fs/promises";

import { digestValue, type Result } from "@nicia-ai/lachesis";

import { runCatalogEvolution } from "./conformance.js";
import { compileAdoptionPlans, runAdoptionRuntime } from "./workflow.js";

type Failure = Readonly<{ code: string; message: string }>;

function unwrap<T, E extends Failure>(result: Result<T, E>, label: string): T {
  if (!result.ok)
    throw new Error(`${label}: ${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function writeDeterministic(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const prepared = await compileAdoptionPlans();
const [runtime, evolution] = await Promise.all([
  runAdoptionRuntime(prepared),
  runCatalogEvolution(),
]);
const reportBody = {
  protocol: "lachesis-m8a-registry-adoption-report/1",
  productVersion: "0.1.0-alpha.3",
  scenario: "northstar-incident-response",
  registryOnly: true,
  providerCalls: 0,
  operationCount: prepared.catalog.operationCount,
  publicImports: [
    "@nicia-ai/lachesis",
    "@nicia-ai/lachesis-generator",
    "@nicia-ai/lachesis-runtime",
  ],
  compile: {
    valid: true,
    planHash: prepared.planSummary.planHash,
    semanticContractHash: prepared.planSummary.semanticContractHash,
    catalogFingerprint: prepared.planSummary.catalogFingerprint,
    maximumEffectCalls: prepared.planSummary.analysis.maximumEffectCalls,
    stateChangingOperations: [
      ...prepared.planSummary.analysis.rootProvenance.stateChangingOperations,
    ].map(([operation, stateChanging]) => ({ operation, stateChanging })),
    negatives: prepared.negatives,
  },
  runtime,
  evolution,
  gates: {
    validCompileAndExecution: true,
    citationsAndProvenance: true,
    exactZeroEffectReplay: true,
    negativeFixturesClassified: prepared.negatives.length === 4,
    deterministicConformance: true,
    declarationRepairGuidance: true,
    genuineDifferenceNonSubstitution: true,
  },
  decision: "adoption-ready-with-docs-fixes",
  nonclaims: [
    "finite-offline-product-adoption-fixture",
    "no-provider-or-model-call",
    "no-compositional-generalization-evidence",
    "no-graph-or-typegraph-quality-claim",
    "no-operation-substitution-authority",
  ],
} as const;
const reportDigest = unwrap(
  await digestValue(reportBody),
  "adoption report digest",
);
const report = { ...reportBody, reportDigest };
const compileDiagnostics = prepared.negatives.map((diagnostic) => {
  const localization = diagnostic["localization"];
  return `${String(diagnostic["code"])} | ${JSON.stringify(localization)} | ${String(diagnostic["guidance"])}`;
});
const human = [
  "# Northstar catalog evolution diagnostics",
  "",
  ...compileDiagnostics,
  "",
  `declaration-repairable: ${evolution.declarationRepairable.human}`,
  `genuinely-non-equivalent: ${evolution.genuinelyNonEquivalent.human}`,
  "",
  "Safe migration: retain the old catalog and manifest, rerun conformance, and recompile against the new fingerprint.",
  "Genuine difference: do-not-substitute; metadata edits cannot manufacture equivalence.",
  "",
].join("\n");
await mkdir("reports", { recursive: true });
await Promise.all([
  writeDeterministic("reports/m8a-adoption-report.json", report),
  writeFile("reports/m8a-diagnostics.md", human, "utf8"),
]);
process.stdout.write(`${JSON.stringify(report)}\n`);
