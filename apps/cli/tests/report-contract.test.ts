import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalizeJson, digestValue, parseJson } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  canonicalizeReportValue,
  serializeCanonicalReport,
  validateReportPlainData,
} from "../src/internal/report-canonical.js";
import {
  createCommandReport,
  deriveReportExitCode,
  serializeCommandReport,
  verifyCommandReport,
  verifyReportArtifactBindings,
} from "../src/internal/report-contract.js";
import {
  escapeTerminalText,
  renderCommandReport,
} from "../src/internal/report-renderer.js";
import {
  type CommandReport,
  type CommandReportInput,
  commandReportSchema,
} from "../src/internal/report-schema.js";
import { createExitFixture, semanticExitCodes } from "./report-fixtures.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const goldenRoot = resolve(import.meta.dirname, "goldens/report-contract");

function reportInput(report: CommandReport): CommandReportInput {
  return {
    protocol: report.protocol,
    command: report.command,
    inputs: report.inputs,
    completeness: report.completeness,
    diagnostics: report.diagnostics,
    migrations: report.migrations,
    artifacts: report.artifacts,
    redaction: report.redaction,
    integrity: report.integrity,
  };
}

async function redigest(value: unknown): Promise<CommandReport> {
  const parsed = commandReportSchema.parse(value);
  const body = {
    protocol: parsed.protocol,
    command: parsed.command,
    inputs: parsed.inputs,
    status: parsed.status,
    completeness: parsed.completeness,
    outcomeExitCode: parsed.outcomeExitCode,
    diagnostics: parsed.diagnostics,
    migrations: parsed.migrations,
    summary: parsed.summary,
    artifacts: parsed.artifacts,
    redaction: parsed.redaction,
    integrity: parsed.integrity,
  };
  const digest = await digestValue(body);
  if (!digest.ok) throw new Error(digest.error.message);
  return commandReportSchema.parse({ ...body, reportDigest: digest.value });
}

async function parseFile(path: string): Promise<unknown> {
  const parsed = parseJson(await readFile(path, "utf8"));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function permutations<T>(
  values: ReadonlyArray<T>,
): ReadonlyArray<ReadonlyArray<T>> {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) =>
    permutations(values.filter((_item, itemIndex) => itemIndex !== index)).map(
      (tail) => [value, ...tail],
    ),
  );
}

describe("private M8b.1 report canonicalization", () => {
  it("is insertion-order independent for accepted plain data", () => {
    const left = {
      second: [{ z: true, a: null }],
      first: { beta: 2, alpha: 1 },
    };
    const right = {
      first: { alpha: 1, beta: 2 },
      second: [{ a: null, z: true }],
    };
    expect(canonicalizeReportValue(left)).toEqual(
      canonicalizeReportValue(right),
    );
    expect(serializeCanonicalReport(left)).toEqual(
      serializeCanonicalReport(right),
    );
  });

  it("produces one canonical value for every insertion-order permutation", () => {
    const entries = [
      ["delta", 4],
      ["alpha", 1],
      ["charlie", 3],
      ["bravo", 2],
    ] as const;
    const canonical = permutations(entries).map((permutation) =>
      canonicalizeReportValue(Object.fromEntries(permutation)),
    );
    expect(canonical).toHaveLength(24);
    expect(
      new Set(canonical.map((result) => JSON.stringify(result))).size,
    ).toBe(1);
  });

  it.each([
    ["undefined", { value: undefined }],
    ["NaN", { value: Number.NaN }],
    ["infinity", { value: Number.POSITIVE_INFINITY }],
    ["BigInt", { value: BigInt(1) }],
    ["Date", { value: new Date(0) }],
    ["Map", { value: new Map([["key", "value"]]) }],
    ["Set", { value: new Set(["value"]) }],
    ["Buffer", { value: Buffer.from("value") }],
    ["typed array", { value: new Uint8Array([1, 2]) }],
  ])("rejects unsupported %s values", (_label, value) => {
    expect(validateReportPlainData(value)).toMatchObject({ ok: false });
  });

  it("rejects cycles, sparse arrays, symbol keys, accessors, hostile prototypes, and normalized duplicate keys", () => {
    const cycle: { self?: object } = {};
    cycle.self = cycle;
    const sparse = new Array<unknown>(2);
    sparse[1] = "present";
    const symbolKey = { safe: true };
    Object.defineProperty(symbolKey, Symbol("hidden"), { value: true });
    let getterInvoked = false;
    const accessor = {};
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return "unsafe";
      },
    });
    class HostilePrototype {
      readonly safe = true;
    }
    const hostilePrototype = new HostilePrototype();
    const normalizedDuplicate = {};
    Object.defineProperties(normalizedDuplicate, {
      "\u00e9": { enumerable: true, value: 1 },
      "e\u0301": { enumerable: true, value: 2 },
    });
    const proxy = new Proxy({ safe: true }, {});
    const hiddenProperty = {};
    Object.defineProperty(hiddenProperty, "hidden", { value: true });

    for (const value of [
      cycle,
      sparse,
      symbolKey,
      accessor,
      hostilePrototype,
      normalizedDuplicate,
      proxy,
      hiddenProperty,
    ])
      expect(validateReportPlainData(value)).toMatchObject({ ok: false });
    expect(getterInvoked).toBe(false);
  });
});

describe("private M8b.1 command-report contract", () => {
  it("generates and verifies every semantic exit-class golden", async () => {
    if (process.env["UPDATE_M8B1_GOLDENS"] === "1")
      await mkdir(goldenRoot, { recursive: true });
    for (const exitCode of semanticExitCodes) {
      const fixture = await createExitFixture(exitCode);
      expect(fixture.report.outcomeExitCode).toBe(exitCode);
      await expect(verifyCommandReport(fixture.report)).resolves.toEqual({
        ok: true,
        value: fixture.report,
      });
      await expect(
        verifyReportArtifactBindings(fixture.report, fixture.artifacts),
      ).resolves.toEqual({ ok: true, value: true });
      const json = serializeCommandReport(fixture.report);
      if (!json.ok) throw new Error(json.error.message);
      const human = renderCommandReport(fixture.report);
      const basename = `exit-${String(exitCode).padStart(2, "0")}`;
      const jsonPath = resolve(goldenRoot, `${basename}.json.golden`);
      const humanPath = resolve(goldenRoot, `${basename}.txt`);
      if (process.env["UPDATE_M8B1_GOLDENS"] === "1") {
        await writeFile(jsonPath, json.value, "utf8");
        await writeFile(humanPath, human, "utf8");
      }
      expect(json.value).toBe(await readFile(jsonPath, "utf8"));
      expect(human).toBe(await readFile(humanPath, "utf8"));
    }
  });

  it("normalizes detailed records into protocol semantic order", async () => {
    const compilation = await createExitFixture(21);
    const original = reportInput(compilation.report);
    const attempt = original.diagnostics.validationAttempts[0];
    if (attempt === undefined) throw new Error("Missing validation attempt.");
    const reordered: CommandReportInput = {
      ...original,
      inputs: original.inputs.toReversed(),
      diagnostics: {
        ...original.diagnostics,
        validationAttempts: [
          { ...attempt, diagnostics: attempt.diagnostics.toReversed() },
        ],
      },
      redaction: {
        ...original.redaction,
        omittedFields: original.redaction.omittedFields.toReversed(),
      },
    };
    const rebuilt = await createCommandReport(reordered);
    expect(rebuilt).toEqual({ ok: true, value: compilation.report });

    const outOfOrder = await redigest({
      ...compilation.report,
      diagnostics: {
        ...compilation.report.diagnostics,
        validationAttempts: [
          {
            ...attempt,
            diagnostics: attempt.diagnostics.toReversed(),
          },
        ],
      },
    });
    await expect(verifyCommandReport(outOfOrder)).resolves.toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_ORDER_MISMATCH" },
    });
  });

  it("rejects summary, status, and exit-code tampering", async () => {
    const { report } = await createExitFixture(12);
    await expect(
      verifyCommandReport({
        ...report,
        summary: { ...report.summary, genuinelyNonEquivalent: 0 },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "SUMMARY_MISMATCH" },
    });
    await expect(
      verifyCommandReport({ ...report, status: "success" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STATUS_MISMATCH" },
    });
    await expect(
      verifyCommandReport({ ...report, outcomeExitCode: 0 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EXIT_CODE_MISMATCH" },
    });
  });

  it("rejects nested identity and artifact mutation", async () => {
    const genuine = await createExitFixture(12);
    const record = genuine.report.diagnostics.conformance[0];
    if (record?.diagnostic === null || record?.diagnostic === undefined)
      throw new Error("Missing nested diagnostic.");
    const nestedMutation = await redigest({
      ...genuine.report,
      diagnostics: {
        ...genuine.report.diagnostics,
        conformance: [
          {
            ...record,
            diagnostic: {
              ...record.diagnostic,
              explanation: "Mutated explanation.",
            },
          },
        ],
      },
    });
    await expect(verifyCommandReport(nestedMutation)).resolves.toMatchObject({
      ok: false,
      error: { code: "NESTED_IDENTITY_MISMATCH" },
    });

    const success = await createExitFixture(0);
    const artifact = success.report.artifacts[0];
    if (artifact === undefined) throw new Error("Missing artifact.");
    const artifactMutation = await redigest({
      ...success.report,
      artifacts: [
        {
          ...artifact,
          checksum: { ...artifact.checksum, value: "0".repeat(64) },
        },
      ],
    });
    await expect(
      verifyReportArtifactBindings(artifactMutation, success.artifacts),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ARTIFACT_BINDING_MISMATCH" },
    });
  });

  it("rejects removed or duplicated detailed records", async () => {
    const declaration = await createExitFixture(11);
    await expect(
      verifyCommandReport({
        ...declaration.report,
        diagnostics: {
          ...declaration.report.diagnostics,
          conformance: [],
        },
      }),
    ).resolves.toMatchObject({ ok: false });
    const record = declaration.report.diagnostics.conformance[0];
    if (record === undefined) throw new Error("Missing conformance record.");
    await expect(
      verifyCommandReport({
        ...declaration.report,
        diagnostics: {
          ...declaration.report.diagnostics,
          conformance: [record, record],
        },
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("rejects collapsed repair history, missing non-substitution, and accepted repair wording", async () => {
    const declaration = await createExitFixture(11);
    const declarationMigration = declaration.report.migrations[0];
    if (declarationMigration === undefined)
      throw new Error("Missing declaration migration.");
    await expect(
      verifyCommandReport({
        ...declaration.report,
        migrations: [
          {
            ...declarationMigration,
            outcomes: [
              {
                phase: "post-repair",
                assessmentIdentity: "1".repeat(64),
                disposition: "compatible",
              },
            ],
          },
        ],
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      verifyCommandReport({
        ...declaration.report,
        migrations: [
          {
            ...declarationMigration,
            guidance: {
              ...declarationMigration.guidance,
              autoAccepted: true,
            },
          },
        ],
      }),
    ).resolves.toMatchObject({ ok: false });

    const genuine = await createExitFixture(12);
    const migration = genuine.report.migrations[0];
    if (migration === undefined) throw new Error("Missing genuine migration.");
    await expect(
      verifyCommandReport({
        ...genuine.report,
        migrations: [
          {
            ...migration,
            guidance: {
              kind: "review-required",
              conditional: true,
              autoAccepted: false,
              explanation: "Change metadata.",
            },
          },
        ],
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("fails closed on unsupported protocols and extra fields", async () => {
    const { report } = await createExitFixture(0);
    await expect(
      verifyCommandReport({
        ...report,
        protocol: "lachesis-catalog-command-report/2",
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      verifyCommandReport({ ...report, unexpected: true }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("escapes ANSI and control injection without mutating report bytes", async () => {
    const { report } = await createExitFixture(20);
    const diagnostic = report.diagnostics.controller[0];
    if (diagnostic === undefined)
      throw new Error("Missing controller diagnostic.");
    const hostile: CommandReport = {
      ...report,
      diagnostics: {
        ...report.diagnostics,
        controller: [
          {
            ...diagnostic,
            message: "bad\u001b[31mred\u0000\nnext",
          },
        ],
      },
    };
    const before = canonicalizeJson(hostile);
    const rendered = renderCommandReport(hostile);
    const after = canonicalizeJson(hostile);
    expect(rendered).not.toContain("\u001b");
    expect(rendered).not.toContain("\u0000");
    expect(rendered).toContain("\\u001b");
    expect(rendered).toContain("\\u000a");
    expect(before).toEqual(after);
    expect(escapeTerminalText("\u001b\n")).toBe("\\u001b\\u000a");
    await expect(verifyCommandReport(hostile)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REPORT" },
    });
  });

  it("implements every exit class and the frozen precedence", async () => {
    const fixtures = await Promise.all(
      semanticExitCodes.map((exitCode) => createExitFixture(exitCode)),
    );
    expect(fixtures.map((fixture) => fixture.report.outcomeExitCode)).toEqual(
      semanticExitCodes,
    );
    const byExit = new Map(
      fixtures.map((fixture) => [
        fixture.report.outcomeExitCode,
        fixture.report,
      ]),
    );
    const combined = (
      ...exitCodes: ReadonlyArray<(typeof semanticExitCodes)[number]>
    ): ReturnType<typeof deriveReportExitCode> => {
      const reports = exitCodes.map((exitCode) => byExit.get(exitCode));
      if (reports.some((report) => report === undefined))
        throw new Error("Missing precedence fixture.");
      return deriveReportExitCode({
        completeness: reports.some(
          (report) => report?.completeness === "partial",
        )
          ? "partial"
          : "complete",
        diagnostics: {
          controller: reports.flatMap(
            (report) => report?.diagnostics.controller ?? [],
          ),
          validationAttempts: reports.flatMap(
            (report) => report?.diagnostics.validationAttempts ?? [],
          ),
          conformance: reports.flatMap(
            (report) => report?.diagnostics.conformance ?? [],
          ),
        },
        migrations: reports.flatMap((report) => report?.migrations ?? []),
      });
    };
    expect(combined(10, 21)).toBe(21);
    expect(combined(21, 11)).toBe(11);
    expect(combined(11, 13)).toBe(13);
    expect(combined(13, 12)).toBe(12);
    expect(combined(12, 20)).toBe(20);
    expect(combined(20, 22)).toBe(22);
    expect(combined(22, 23)).toBe(23);
    expect(combined(23, 70)).toBe(70);
    expect(combined(0)).toBe(0);
  });

  it("reproduces the canonical report digest", async () => {
    for (const exitCode of semanticExitCodes) {
      const { report } = await createExitFixture(exitCode);
      const { reportDigest, ...body } = report;
      const digest = await digestValue(body);
      expect(digest).toEqual({ ok: true, value: reportDigest });
      const serialized = serializeCommandReport(report);
      if (!serialized.ok) throw new Error(serialized.error.message);
      expect(serialized.value.endsWith("\n")).toBe(true);
      expect(serialized.value.endsWith("\n\n")).toBe(false);
    }
  });

  it("keeps the documentation JSON Schema synchronized", async () => {
    const checkedIn = await parseFile(
      resolve(repositoryRoot, "docs/m8b0-machine-report.schema.json"),
    );
    const generated = z.toJSONSchema(commandReportSchema, {
      target: "draft-2020-12",
    });
    expect(canonicalizeJson(checkedIn)).toEqual(canonicalizeJson(generated));
  });
});
