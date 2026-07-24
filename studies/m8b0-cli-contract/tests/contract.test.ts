import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalizeJson, digestValue, parseJson } from "@nicia-ai/lachesis";
import {
  type CatalogConformanceDiagnostic,
  catalogConformanceDiagnosticSchema,
} from "@nicia-ai/lachesis-generator";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type CommandReport,
  commandReportSchema,
  deriveOutcomeExitCode,
  renderMigrationGuidance,
  serializeCommandReport,
  verifyCommandReport,
} from "../src/contract.js";

const packageRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const goldenNames = [
  "compatible",
  "declaration-repairable",
  "genuinely-non-equivalent",
  "compilation-rejected",
] as const;

async function readJson(path: string): Promise<unknown> {
  const parsed = parseJson(await readFile(path, "utf8"));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

async function golden(
  name: (typeof goldenNames)[number],
): Promise<CommandReport> {
  return commandReportSchema.parse(
    await readJson(resolve(packageRoot, "goldens", `${name}.json`)),
  );
}

async function insufficientEvidence(): Promise<CatalogConformanceDiagnostic> {
  const body = {
    protocol: "lachesis-catalog-conformance-diagnostic/1" as const,
    code: "UNRESOLVED_CONFORMANCE_FAILURE" as const,
    outcome: "insufficient-evidence" as const,
    side: "both" as const,
    role: null,
    boundary: "unresolved-conformance-boundary",
    obligation: "complete-diagnostic-evidence",
    explanation: "The finite evidence cannot localize a safe cause.",
    action: {
      kind: "no-safe-repair" as const,
      mechanical: false as const,
      reason: "Preserve rejection and collect more evidence.",
    },
    evidence: {
      leftCatalogFingerprint: "1".repeat(64),
      rightCatalogFingerprint: "2".repeat(64),
      leftManifestDigest: "3".repeat(64),
      rightManifestDigest: "4".repeat(64),
      fixtureDigest: null,
      inputDigest: null,
      leftValueDigest: null,
      rightValueDigest: null,
    },
  };
  const diagnostic = await digestValue({
    protocol: "lachesis-catalog-conformance-diagnostic-identity/1",
    code: body.code,
    outcome: body.outcome,
    side: body.side,
    role: null,
    boundary: body.boundary,
    obligation: body.obligation,
    action: body.action,
    inputDigest: null,
    leftValueDigest: null,
    rightValueDigest: null,
  });
  if (!diagnostic.ok) throw new Error(diagnostic.error.message);
  const record = await digestValue({
    ...body,
    diagnosticDigest: diagnostic.value,
  });
  if (!record.ok) throw new Error(record.error.message);
  return catalogConformanceDiagnosticSchema.parse({
    ...body,
    diagnosticDigest: diagnostic.value,
    recordDigest: record.value,
  });
}

describe("M8b.0 private command-report contract", () => {
  it("validates the checked-in JSON Schema against the source schema", async () => {
    const checkedIn = await readJson(
      resolve(repositoryRoot, "docs/m8b0-machine-report.schema.json"),
    );
    const generated = z.toJSONSchema(commandReportSchema, {
      target: "draft-2020-12",
    });
    expect(canonicalizeJson(checkedIn)).toEqual(canonicalizeJson(generated));
  });

  it("verifies canonical identities and byte-identical golden reports", async () => {
    for (const name of goldenNames) {
      const report = await golden(name);
      expect(await verifyCommandReport(report)).toEqual({
        ok: true,
        value: report,
      });
      const serialized = serializeCommandReport(report);
      if (!serialized.ok) throw new Error(serialized.error.message);
      expect(serialized.value).toBe(
        await readFile(resolve(packageRoot, "goldens", `${name}.json`), "utf8"),
      );
      expect(renderMigrationGuidance(report)).toBe(
        await readFile(resolve(packageRoot, "goldens", `${name}.txt`), "utf8"),
      );
    }
  });

  it("preserves validation arrays separately from conformance records", async () => {
    const compilation = await golden("compilation-rejected");
    expect(compilation.diagnostics.controller).toHaveLength(0);
    expect(compilation.diagnostics.validationAttempts).toHaveLength(1);
    expect(
      compilation.diagnostics.validationAttempts[0]?.diagnostics,
    ).toHaveLength(2);
    expect(compilation.diagnostics.conformance).toHaveLength(0);
    expect(compilation.summary.validationDiagnostics).toBe(2);

    const declaration = await golden("declaration-repairable");
    expect(declaration.diagnostics.validationAttempts).toHaveLength(0);
    expect(declaration.diagnostics.conformance).toHaveLength(1);
    expect(declaration.diagnostics.conformance[0]?.diagnostic?.outcome).toBe(
      "declaration-repairable",
    );
  });

  it("derives stable exit codes for every contract class", async () => {
    const compatible = await golden("compatible");
    const declaration = await golden("declaration-repairable");
    const genuine = await golden("genuinely-non-equivalent");
    const compilation = await golden("compilation-rejected");
    expect(compatible.outcomeExitCode).toBe(0);
    expect(declaration.outcomeExitCode).toBe(11);
    expect(genuine.outcomeExitCode).toBe(12);
    expect(compilation.outcomeExitCode).toBe(21);
    const insufficient = await insufficientEvidence();
    expect(
      deriveOutcomeExitCode({
        ...compatible,
        status: "rejected",
        diagnostics: {
          controller: [],
          validationAttempts: [],
          conformance: [
            {
              recordIdentity: insufficient.recordDigest,
              comparisonIdentity: "5".repeat(64),
              result: "rejected",
              reportIdentity: null,
              diagnostic: insufficient,
            },
          ],
        },
      }),
    ).toBe(13);
    expect(
      deriveOutcomeExitCode({
        ...compatible,
        status: "review-required",
        diagnostics: {
          controller: [],
          validationAttempts: [],
          conformance: [],
        },
      }),
    ).toBe(10);
    expect(
      deriveOutcomeExitCode({
        ...compatible,
        status: "incomplete",
        completeness: "partial",
      }),
    ).toBe(23);
    expect(
      deriveOutcomeExitCode({
        ...compatible,
        status: "invalid",
        command: {
          ...compatible.command,
          id: "catalog.manifest",
        },
      }),
    ).toBe(20);
    expect(
      deriveOutcomeExitCode({
        ...compatible,
        status: "invalid",
        diagnostics: {
          ...compatible.diagnostics,
          controller: [
            {
              code: "CHECKSUM_MISMATCH",
              message: "Artifact checksum differs.",
              location: { artifactId: "candidate", fieldPath: [] },
            },
          ],
        },
      }),
    ).toBe(22);
    expect(
      deriveOutcomeExitCode({ ...compatible, status: "internal-error" }),
    ).toBe(70);
  });

  it("rejects changed summaries, identities, and unsafe repair advice", async () => {
    const compatible = await golden("compatible");
    const changedSummary = {
      ...compatible,
      summary: { ...compatible.summary, conformant: 99 },
    };
    await expect(verifyCommandReport(changedSummary)).resolves.toMatchObject({
      ok: false,
      error: { code: "SUMMARY_MISMATCH" },
    });
    await expect(
      verifyCommandReport({
        ...compatible,
        reportDigest: "0".repeat(64),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "REPORT_DIGEST_MISMATCH" },
    });

    const genuine = await golden("genuinely-non-equivalent");
    const migration = genuine.migrations[0];
    if (migration === undefined) throw new Error("Missing migration fixture.");
    expect(
      commandReportSchema.safeParse({
        ...genuine,
        migrations: [
          {
            ...migration,
            guidance: {
              kind: "review-declaration",
              conditional: true,
              autoAccepted: false,
              explanation: "Change metadata.",
              safetyCondition: "None.",
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      commandReportSchema.safeParse({
        ...genuine,
        migrations: [
          {
            ...migration,
            guidance: { ...migration.guidance, autoAccepted: true },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps initial and post-repair outcomes distinct", async () => {
    const declaration = await golden("declaration-repairable");
    const migration = declaration.migrations[0];
    if (migration === undefined) throw new Error("Missing migration fixture.");
    const result = commandReportSchema.safeParse({
      ...declaration,
      migrations: [
        {
          ...migration,
          outcomes: [
            migration.outcomes[0],
            {
              phase: "post-repair",
              assessmentIdentity: "1".repeat(64),
              disposition: "compatible",
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expect(
      result.data.migrations[0]?.outcomes.map((item) => item.phase),
    ).toEqual(["initial", "post-repair"]);
  });
});
