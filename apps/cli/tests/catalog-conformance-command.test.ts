import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

import { parseJson } from "@nicia-ai/lachesis";
import {
  type CatalogConformanceDiagnostic,
  catalogConformanceDiagnosticSchema,
  verifyCatalogConformanceReport,
} from "@nicia-ai/lachesis-generator";
import { afterEach, describe, expect, it } from "vitest";

import {
  type CatalogCompareCommandTestHooks,
  runCatalogCompareCommand,
} from "../src/internal/catalog-compare-command.js";
import { verifyCommandReport } from "../src/internal/report-contract.js";

const roots: Array<string> = [];

function catalogModule(side: "left" | "right"): string {
  const namespace = `stage4/${side}`;
  return `
import {
  catalogSemanticRolesSchema,
  createCatalog,
  defineFunction,
  defineSchema
} from "@nicia-ai/lachesis";
import { z } from "zod";

function makeCatalog(variant) {
  const number = defineSchema({
    id: "${namespace}/number",
    version: "1",
    description: "A bounded Stage 4 integer.",
    validator: z.number().int().min(0).max(10)
  });
  const transform = defineFunction({
    id: "${namespace}/transform",
    version: "1",
    description: "Transform a bounded integer.",
    input: number,
    output: number,
    implementation(value) {
      return variant === "genuine" ? Math.min(10, value + 1) : value;
    }
  });
  const roleVersion = variant === "role-version" ? "2" : "1";
  const semanticRoles = catalogSemanticRolesSchema.parse({
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [{
      kind: "schema",
      role: { id: "stage4.role/number", version: roleVersion },
      schema: { id: number.id, version: number.version },
      obligations: { mutuallyAcceptsConformanceValues: true }
    }],
    operations: [{
      kind: "function",
      role: { id: "stage4.role/transform", version: roleVersion },
      operation: { id: transform.id, version: transform.version },
      obligations: {
        deterministic: true,
        totalOnConformanceValues: true,
        pointwiseEquivalent: true
      }
    }]
  });
  const catalog = createCatalog({
    identity: { id: "${namespace}/catalog-" + variant, version: "1" },
    schemas: [number.runtime],
    operations: [transform],
    semanticRoles
  });
  if (!catalog.ok) throw new Error("Stage 4 fixture catalog is invalid.");
  return catalog.value;
}

export const catalog = makeCatalog("conformant");
export const roleVersionCatalog = makeCatalog("role-version");
export const genuineCatalog = makeCatalog("genuine");
export const policy = {
  allowedCapabilities: ["stage4.read"],
  budget: {
    maxEffectCalls: 2,
    maxCollectionItems: 20,
    maxRecursionDepth: 2,
    maxTokens: 40,
    maxWallClockMs: 200,
    maxParallelism: 2
  }
};
export const changedPolicy = {
  allowedCapabilities: ["stage4.write"],
  budget: {
    maxEffectCalls: 3,
    maxCollectionItems: 30,
    maxRecursionDepth: 3,
    maxTokens: 60,
    maxWallClockMs: 300,
    maxParallelism: 3
  }
};
`;
}

const suiteModule = `
const schemaFixture = {
  kind: "schema",
  role: { id: "stage4.role/number", version: "1" },
  values: [0, 1, 5]
};
const functionFixture = {
  kind: "function",
  role: { id: "stage4.role/transform", version: "1" },
  inputs: [0, 1, 5]
};
export const exactSuite = {
  protocol: "lachesis-cross-catalog-conformance-suite/1",
  fixtures: [schemaFixture, functionFixture]
};
export const incompleteSuite = {
  protocol: "lachesis-cross-catalog-conformance-suite/1",
  fixtures: [schemaFixture]
};
export const duplicateSuite = {
  protocol: "lachesis-cross-catalog-conformance-suite/1",
  fixtures: [schemaFixture, schemaFixture, functionFixture]
};
export const invalidSuite = {
  protocol: "lachesis-cross-catalog-conformance-suite/1",
  fixtures: [{ ...schemaFixture, unexpected: true }]
};
export const unsupportedSuite = {};
`;

type Invocation = Readonly<{
  code: number;
  stdout: string;
  stderr: string;
}>;

async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(import.meta.dirname, ".stage4-"));
  roots.push(root);
  await Promise.all([
    writeFile(resolve(root, "left.mjs"), catalogModule("left"), "utf8"),
    writeFile(resolve(root, "right.mjs"), catalogModule("right"), "utf8"),
    writeFile(resolve(root, "suite.mjs"), suiteModule, "utf8"),
  ]);
  return root;
}

function structural(): ReadonlyArray<string> {
  return [
    "--left-catalog",
    "./left.mjs#catalog",
    "--left-policy",
    "./left.mjs#policy",
    "--right-catalog",
    "./right.mjs#catalog",
    "--right-policy",
    "./right.mjs#policy",
  ];
}

function semantic(
  rightCatalog = "catalog",
  rightPolicy = "policy",
  suite = "exactSuite",
  report = "report.json",
  conformance = "conformance.json",
): ReadonlyArray<string> {
  return [
    "--left-catalog",
    "./left.mjs#catalog",
    "--left-policy",
    "./left.mjs#policy",
    "--right-catalog",
    `./right.mjs#${rightCatalog}`,
    "--right-policy",
    `./right.mjs#${rightPolicy}`,
    "--suite",
    `./suite.mjs#${suite}`,
    "--conformance-out",
    conformance,
    "--report",
    report,
  ];
}

async function invoke(
  root: string,
  args: ReadonlyArray<string>,
  hooks: CatalogCompareCommandTestHooks = {},
): Promise<Invocation> {
  let stdout = "";
  let stderr = "";
  const result = await runCatalogCompareCommand(
    [...args, "--project-root", root],
    {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
    hooks,
  );
  return { code: result.exitCode, stdout, stderr };
}

async function commandReport(root: string, path = "report.json") {
  const text = await readFile(resolve(root, path), "utf8");
  const parsed = parseJson(text);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("Stage 4 report is not JSON.");
  const verified = await verifyCommandReport(parsed.value);
  expect(verified.ok).toBe(true);
  if (!verified.ok) throw new Error(verified.error.message);
  return verified.value;
}

async function fallbackReport(text: string) {
  const parsed = parseJson(text);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("Stage 4 fallback is not JSON.");
  const verified = await verifyCommandReport(parsed.value);
  expect(verified.ok).toBe(true);
  if (!verified.ok) throw new Error(verified.error.message);
  return verified.value;
}

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("private suite-backed catalog conformance command", () => {
  it("emits a deterministic verified native artifact and command report", async () => {
    const root = await fixture();
    let generatorLoads = 0;
    let diagnoses = 0;
    const first = await invoke(root, semantic(), {
      onGeneratorLoad: () => {
        generatorLoads += 1;
      },
      onDiagnosis: () => {
        diagnoses += 1;
      },
    });
    expect(first.code).toBe(0);
    expect(first.stdout).toBe("");
    expect({ generatorLoads, diagnoses }).toEqual({
      generatorLoads: 1,
      diagnoses: 1,
    });
    const firstReport = await readFile(resolve(root, "report.json"));
    const firstArtifact = await readFile(resolve(root, "conformance.json"));
    const verified = await commandReport(root);
    expect(verified.summary).toMatchObject({
      conformanceRecords: 1,
      conformant: 1,
      migrationRecords: 0,
    });
    expect(verified.artifacts).toHaveLength(1);
    expect(
      verified.inputs.some(
        (input) => input.label === "validated-conformance-suite",
      ),
    ).toBe(true);
    const nativeJson = parseJson(firstArtifact.toString("utf8"));
    expect(nativeJson.ok).toBe(true);
    if (!nativeJson.ok) return;
    expect((await verifyCatalogConformanceReport(nativeJson.value)).ok).toBe(
      true,
    );

    const repeated = await invoke(root, [...semantic(), "--replace"]);
    expect(repeated.code).toBe(0);
    expect(await readFile(resolve(root, "report.json"))).toEqual(firstReport);
    expect(await readFile(resolve(root, "conformance.json"))).toEqual(
      firstArtifact,
    );
  });

  it("keeps capability and budget differences under independent review", async () => {
    const root = await fixture();
    const result = await invoke(root, semantic("catalog", "changedPolicy"));
    expect(result.code).toBe(10);
    expect(result.stderr).toContain(
      "FINITE SUITE PASSED; COMPILATION POLICY REVIEW REMAINS. No compatibility or substitution claim is made.",
    );
    const report = await commandReport(root);
    expect(report.summary.conformant).toBe(1);
    expect(report.migrations).toHaveLength(8);
    expect(
      report.migrations.every(
        (migration) =>
          migration.category === "declaration-review" &&
          migration.guidance.kind === "review-required",
      ),
    ).toBe(true);
  });

  it("preserves each rejected outcome and never touches its conformance target", async () => {
    const cases = [
      {
        catalog: "roleVersionCatalog",
        suite: "exactSuite",
        exit: 11,
        outcome: "declaration-repairable",
        text: "CONDITIONAL DECLARATION REPAIR",
      },
      {
        catalog: "genuineCatalog",
        suite: "exactSuite",
        exit: 12,
        outcome: "genuinely-non-equivalent",
        text: "DO NOT SUBSTITUTE",
      },
      {
        catalog: "catalog",
        suite: "incompleteSuite",
        exit: 13,
        outcome: "insufficient-evidence",
        text: "INSUFFICIENT EVIDENCE",
      },
    ] as const;
    for (const [index, testCase] of cases.entries()) {
      const root = await fixture();
      const artifact = `sentinel-${index}.json`;
      const reportPath = `report-${index}.json`;
      await writeFile(resolve(root, artifact), "preserve", "utf8");
      const result = await invoke(
        root,
        semantic(
          testCase.catalog,
          "changedPolicy",
          testCase.suite,
          reportPath,
          artifact,
        ),
      );
      expect(result.code).toBe(testCase.exit);
      expect(result.stderr).toContain(testCase.text);
      expect(await readFile(resolve(root, artifact), "utf8")).toBe("preserve");
      const report = await commandReport(root, reportPath);
      expect(report.diagnostics.conformance).toHaveLength(1);
      expect(report.diagnostics.conformance[0]?.diagnostic?.outcome).toBe(
        testCase.outcome,
      );
      expect(report.artifacts).toEqual([]);
      expect(report.migrations.some((item) => item.outcomes.length !== 1)).toBe(
        false,
      );
    }
  });

  it("separates invalid suites from valid but insufficient evidence", async () => {
    const root = await fixture();
    let loads = 0;
    const unsupported = await invoke(
      root,
      semantic(
        "catalog",
        "policy",
        "unsupportedSuite",
        "unsupported.json",
        "unused-a.json",
      ),
      {
        onGeneratorLoad: () => {
          loads += 1;
        },
      },
    );
    expect(unsupported.code).toBe(20);
    expect(loads).toBe(0);
    const invalid = await invoke(
      root,
      semantic(
        "catalog",
        "policy",
        "invalidSuite",
        "invalid.json",
        "unused-b.json",
      ),
    );
    expect(invalid.code).toBe(20);
    const insufficient = await invoke(
      root,
      semantic(
        "catalog",
        "policy",
        "duplicateSuite",
        "duplicate.json",
        "unused-c.json",
      ),
    );
    expect(insufficient.code).toBe(13);
  });

  it("rejects native tampering and invalid assessment cardinality", async () => {
    const root = await fixture();
    const tamperedReport = await invoke(
      root,
      semantic(
        "catalog",
        "policy",
        "exactSuite",
        "tampered-report.json",
        "unused-a.json",
      ),
      {
        transformNativeAssessment: (assessment) => {
          if (
            assessment === null ||
            typeof assessment !== "object" ||
            !("kind" in assessment) ||
            assessment.kind !== "conformant" ||
            !("report" in assessment) ||
            assessment.report === null ||
            typeof assessment.report !== "object"
          )
            return assessment;
          return {
            ...assessment,
            report: {
              ...assessment.report,
              leftCatalogFingerprint: "0".repeat(64),
            },
          };
        },
      },
    );
    expect(tamperedReport.code).toBe(22);
    expect(tamperedReport.stdout.endsWith("\n")).toBe(true);
    expect(tamperedReport.stdout.split("\n")).toHaveLength(2);
    await expect(
      readFile(resolve(root, "tampered-report.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const diagnosticMutations: ReadonlyArray<
      (diagnostic: CatalogConformanceDiagnostic) => CatalogConformanceDiagnostic
    > = [
      (diagnostic) => ({
        ...diagnostic,
        recordDigest: "0".repeat(64),
      }),
      (diagnostic) => ({
        ...diagnostic,
        evidence: {
          ...diagnostic.evidence,
          leftCatalogFingerprint: "0".repeat(64),
        },
      }),
      (diagnostic) => ({
        ...diagnostic,
        evidence: {
          ...diagnostic.evidence,
          fixtureDigest: "0".repeat(64),
        },
      }),
    ];
    for (const [index, mutate] of diagnosticMutations.entries()) {
      const result = await invoke(
        root,
        semantic(
          "genuineCatalog",
          "policy",
          "exactSuite",
          `tampered-diagnostic-${index}.json`,
          `unused-diagnostic-${index}.json`,
        ),
        {
          transformNativeAssessment: (assessment) => {
            if (
              assessment === null ||
              typeof assessment !== "object" ||
              !("kind" in assessment) ||
              assessment.kind !== "rejected" ||
              !("diagnostic" in assessment) ||
              assessment.diagnostic === null
            )
              return assessment;
            const diagnostic = catalogConformanceDiagnosticSchema.safeParse(
              assessment.diagnostic,
            );
            if (!diagnostic.success) return assessment;
            return {
              ...assessment,
              diagnostic: mutate(diagnostic.data),
            };
          },
        },
      );
      expect(result.code).toBe(22);
      await fallbackReport(result.stdout);
      await expect(
        readFile(resolve(root, `tampered-diagnostic-${index}.json`), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }

    for (const [index, transformed] of [
      [],
      [{ kind: "extra" }, { kind: "extra" }],
      { kind: "missing" },
    ].entries()) {
      const result = await invoke(
        root,
        semantic(
          "catalog",
          "policy",
          "exactSuite",
          `cardinality-${index}.json`,
          `unused-cardinality-${index}.json`,
        ),
        { transformNativeAssessment: () => transformed },
      );
      expect(result.code).toBe(70);
      await fallbackReport(result.stdout);
    }
  });

  it("loads and executes each permitted unique module exactly once", async () => {
    const root = await fixture();
    const acquired = new Set<string>();
    const executed = new Set<string>();
    const result = await invoke(root, semantic(), {
      onSourceAcquisition: (path) => acquired.add(path),
      onModuleExecution: (path) => executed.add(path),
    });
    expect(result.code).toBe(0);
    expect(acquired.size).toBe(3);
    expect(executed.size).toBe(3);
  });

  it("rejects suite aliases and acquisition drift before semantic output", async () => {
    const root = await fixture();
    const alias = await invoke(root, [
      ...structural(),
      "--suite",
      "./left.mjs#catalog",
      "--conformance-out",
      "native.json",
      "--report",
      "report.json",
    ]);
    expect(alias.code).toBe(20);
    expect(alias.stdout).not.toContain(root);

    const mutations: ReadonlyArray<
      (
        mutate: (path: string) => Promise<void>,
      ) => CatalogCompareCommandTestHooks
    > = [
      (mutate) => ({ afterSourceAcquired: mutate }),
      (mutate) => ({ afterSourceDigest: mutate }),
      (mutate) => ({ beforeModuleImport: mutate }),
      (mutate) => ({ afterModuleImport: mutate }),
      (mutate) => ({
        beforeExportLookup: async (path) => {
          await mutate(path);
        },
      }),
    ];
    for (const [index, makeHooks] of mutations.entries()) {
      const caseRoot = await fixture();
      let changed = false;
      const result = await invoke(
        caseRoot,
        semantic(
          "catalog",
          "policy",
          "exactSuite",
          `drift-${index}.json`,
          `native-${index}.json`,
        ),
        makeHooks(async (path) => {
          if (changed || !path.endsWith("suite.mjs")) return;
          changed = true;
          await appendFile(path, "\n// drift\n", "utf8");
        }),
      );
      expect(result.code).toBe(23);
      expect(result.stdout).not.toContain(caseRoot);
    }
  });

  it("rolls back detected two-output failures and fails closed on rollback failure", async () => {
    const root = await fixture();
    for (const role of ["artifact", "report"] as const) {
      const result = await invoke(
        root,
        semantic(
          "catalog",
          "policy",
          "exactSuite",
          `stage-${role}.json`,
          `native-stage-${role}.json`,
        ),
        {
          beforePairStage: (candidate) =>
            candidate === role
              ? Promise.reject(new Error("stage-failed"))
              : Promise.resolve(),
        },
      );
      expect(result.code).toBe(23);
      await fallbackReport(result.stdout);
      await expect(
        lstat(resolve(root, `stage-${role}.json`)),
      ).rejects.toThrow();
      await expect(
        lstat(resolve(root, `native-stage-${role}.json`)),
      ).rejects.toThrow();
    }

    const rolledBack = await invoke(
      root,
      semantic(
        "catalog",
        "policy",
        "exactSuite",
        "rollback.json",
        "native-rollback.json",
      ),
      {
        beforeReportInstall: () =>
          Promise.reject(new Error("report-install-failed")),
      },
    );
    expect(rolledBack.code).toBe(23);
    await fallbackReport(rolledBack.stdout);
    await expect(lstat(resolve(root, "rollback.json"))).rejects.toThrow();
    await expect(
      lstat(resolve(root, "native-rollback.json")),
    ).rejects.toThrow();

    const failedRollback = await invoke(
      root,
      semantic(
        "catalog",
        "policy",
        "exactSuite",
        "rollback-failed.json",
        "native-rollback-failed.json",
      ),
      {
        beforeReportInstall: () =>
          Promise.reject(new Error("report-install-failed")),
        beforePairRollback: () => Promise.reject(new Error("rollback-failed")),
      },
    );
    expect(failedRollback.code).toBe(70);
    await fallbackReport(failedRollback.stdout);

    const replaceRoot = await fixture();
    await Promise.all([
      writeFile(resolve(replaceRoot, "report.json"), "old-report", "utf8"),
      writeFile(
        resolve(replaceRoot, "conformance.json"),
        "old-artifact",
        "utf8",
      ),
    ]);
    const restored = await invoke(replaceRoot, [...semantic(), "--replace"], {
      beforeReportInstall: () =>
        Promise.reject(new Error("report-install-failed")),
    });
    expect(restored.code).toBe(23);
    expect(await readFile(resolve(replaceRoot, "report.json"), "utf8")).toBe(
      "old-report",
    );
    expect(
      await readFile(resolve(replaceRoot, "conformance.json"), "utf8"),
    ).toBe("old-artifact");

    const tamperRoot = await fixture();
    const rawTamper = await invoke(tamperRoot, semantic(), {
      beforeReportInstall: async () => {
        await appendFile(
          resolve(tamperRoot, "conformance.json"),
          "tamper",
          "utf8",
        );
        throw new Error("raw-artifact-tampered");
      },
    });
    expect(rawTamper.code).toBe(70);
    await fallbackReport(rawTamper.stdout);
  });

  it("preserves no-clobber and replace behavior for prior-target combinations", async () => {
    const combinations = [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const;
    for (const [artifactExists, reportExists] of combinations) {
      const root = await fixture();
      if (artifactExists)
        await writeFile(
          resolve(root, "conformance.json"),
          "old-artifact",
          "utf8",
        );
      if (reportExists)
        await writeFile(resolve(root, "report.json"), "old-report", "utf8");
      const first = await invoke(root, semantic());
      expect(
        first.code,
        `artifactExists=${artifactExists}; reportExists=${reportExists}`,
      ).toBe(artifactExists || reportExists ? 23 : 0);
      const preservedArtifact = artifactExists
        ? await readFile(resolve(root, "conformance.json"), "utf8")
        : null;
      const preservedReport = reportExists
        ? await readFile(resolve(root, "report.json"), "utf8")
        : null;
      expect(preservedArtifact).toBe(artifactExists ? "old-artifact" : null);
      expect(preservedReport).toBe(reportExists ? "old-report" : null);
      let replacementCode: number | null = null;
      if (artifactExists || reportExists) {
        const replaced = await invoke(root, [...semantic(), "--replace"]);
        replacementCode = replaced.code;
        await commandReport(root);
      }
      expect(replacementCode).toBe(artifactExists || reportExists ? 0 : null);
    }
  });

  it("fails closed for stale transaction material, symlinks, and path escapes", async () => {
    const root = await fixture();
    await writeFile(
      resolve(root, "conformance.json.lachesis-artifact-txn"),
      "stale",
      "utf8",
    );
    const stale = await invoke(root, semantic());
    expect(stale.code).toBe(23);
    await fallbackReport(stale.stdout);

    const outside = await mkdtemp(resolve(import.meta.dirname, ".outside4-"));
    roots.push(outside);
    await symlink(outside, resolve(root, "escape"));
    const escaped = await invoke(
      root,
      semantic(
        "catalog",
        "policy",
        "exactSuite",
        "escape/report.json",
        "escape/native.json",
      ),
    );
    expect(escaped.code).toBe(23);
    await expect(lstat(resolve(outside, "report.json"))).rejects.toThrow();

    await mkdir(resolve(root, "safe"));
    await symlink("../safe", resolve(root, "linked"));
    const symlinked = await invoke(
      root,
      semantic(
        "catalog",
        "policy",
        "exactSuite",
        "linked/report.json",
        "linked/native.json",
      ),
    );
    expect(symlinked.code).toBe(23);

    const committedRoot = await fixture();
    expect((await invoke(committedRoot, semantic())).code).toBe(0);
    const committedReport = await readFile(
      resolve(committedRoot, "report.json"),
    );
    const committedArtifact = await readFile(
      resolve(committedRoot, "conformance.json"),
    );
    await writeFile(
      resolve(committedRoot, "report.json.lachesis-report-txn"),
      "stale-after-marker",
      "utf8",
    );
    const afterMarker = await invoke(committedRoot, [
      ...semantic(),
      "--replace",
    ]);
    expect(afterMarker.code).toBe(23);
    expect(await readFile(resolve(committedRoot, "report.json"))).toEqual(
      committedReport,
    );
    expect(await readFile(resolve(committedRoot, "conformance.json"))).toEqual(
      committedArtifact,
    );
  });

  it("rejects normalized artifact aliases, output symlinks, and oversized suites", async () => {
    const root = await fixture();
    const aliasCases = [
      semantic(
        "catalog",
        "policy",
        "exactSuite",
        "nested/../same.json",
        "same.json",
      ),
      [...semantic(), "--left-manifest", "nested/../conformance.json"],
      semantic(
        "catalog",
        "policy",
        "exactSuite",
        "nested/../suite.mjs",
        "native.json",
      ),
    ];
    for (const args of aliasCases) {
      let executions = 0;
      const result = await invoke(root, args, {
        onModuleExecution: () => {
          executions += 1;
        },
      });
      expect(result.code).toBe(20);
      expect(executions).toBe(0);
    }

    await writeFile(resolve(root, "target.json"), "preserve", "utf8");
    await symlink("target.json", resolve(root, "report-link.json"));
    const leafSymlink = await invoke(
      root,
      semantic(
        "catalog",
        "policy",
        "exactSuite",
        "report-link.json",
        "native-link-test.json",
      ),
    );
    expect(leafSymlink.code).toBe(23);

    await writeFile(
      resolve(root, "oversized-suite.mjs"),
      new Uint8Array(8 * 1024 * 1024 + 1),
    );
    const oversized = await invoke(root, [
      ...structural(),
      "--suite",
      "./oversized-suite.mjs#suite",
      "--conformance-out",
      "oversized-native.json",
      "--report",
      "oversized-report.json",
    ]);
    expect(oversized.code).toBe(23);
    await fallbackReport(oversized.stdout);
  });

  it("renders only finite claims and deterministic redacted failures", async () => {
    const root = await fixture();
    const conformant = await invoke(root, semantic());
    expect(conformant.code).toBe(0);
    expect(conformant.stderr).not.toMatch(
      /\b(?:equivalent|substitutable|safe migration|general(?:ized)? compatibility)\b/iu,
    );
    const first = await invoke(
      root,
      semantic(
        "catalog",
        "policy",
        "exactSuite",
        "failure-a.json",
        "native-failure-a.json",
      ),
      {
        beforePairStage: () =>
          Promise.reject(new Error("failure-with-host-path")),
      },
    );
    const second = await invoke(
      root,
      semantic(
        "catalog",
        "policy",
        "exactSuite",
        "failure-b.json",
        "native-failure-b.json",
      ),
      {
        beforePairStage: () =>
          Promise.reject(new Error("failure-with-host-path")),
      },
    );
    expect(first.code).toBe(23);
    expect(second.code).toBe(23);
    expect(first.stdout.replaceAll("failure-a", "failure")).toBe(
      second.stdout.replaceAll("failure-b", "failure"),
    );
    expect(first.stdout).not.toContain(root);
    expect(first.stderr).not.toContain(root);
  });

  it("keeps structural grammar and lazy-loading behavior unchanged", async () => {
    const root = await fixture();
    let loads = 0;
    const structuralResult = await invoke(
      root,
      [...structural(), "--report", "-"],
      {
        onGeneratorLoad: () => {
          loads += 1;
        },
      },
    );
    expect(structuralResult.code).toBe(10);
    expect(loads).toBe(0);
    expect(
      (
        await invoke(root, [
          ...structural(),
          "--conformance-out",
          "native.json",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(64);
    expect(
      (
        await invoke(root, [
          ...structural(),
          "--suite",
          "./suite.mjs#exactSuite",
          "--report",
          "report.json",
        ])
      ).code,
    ).toBe(64);
    expect(
      (
        await invoke(root, [
          ...structural(),
          "--suite",
          "./suite.mjs#exactSuite",
          "--conformance-out",
          "native.json",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(64);
  });
});
