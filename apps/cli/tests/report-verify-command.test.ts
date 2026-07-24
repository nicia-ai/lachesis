import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

import { digestValue, parseJson } from "@nicia-ai/lachesis";
import { afterEach, describe, expect, it } from "vitest";

import { runCatalogCompareCommand } from "../src/internal/catalog-compare-command.js";
import { runCatalogManifestCommand } from "../src/internal/catalog-manifest-command.js";
import {
  serializeCommandReport,
  verifyCommandReport,
} from "../src/internal/report-contract.js";
import {
  type CommandReport,
  commandReportSchema,
} from "../src/internal/report-schema.js";
import {
  type ReportVerifyCommandTestHooks,
  runReportVerifyCommand,
} from "../src/internal/report-verify-command.js";

const roots: Array<string> = [];
const catalogModule = `
import { catalogSemanticRolesSchema, createCatalog, defineFunction, defineSchema } from "@nicia-ai/lachesis";
import { z } from "zod";
const number = defineSchema({
  id: "stage5/number", version: "1", description: "A Stage 5 integer.",
  validator: z.number().int().min(0).max(10)
});
function catalogFor(variant) {
  const transform = defineFunction({
    id: "stage5/transform", version: "1", description: "Transform an integer.",
    input: number, output: number,
    implementation(value) { return variant === "genuine" ? Math.min(10, value + 1) : value; }
  });
  const roleVersion = variant === "repairable" ? "2" : "1";
  const semanticRoles = catalogSemanticRolesSchema.parse({
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [{
      kind: "schema", role: { id: "stage5.role/number", version: roleVersion },
      schema: { id: number.id, version: number.version },
      obligations: { mutuallyAcceptsConformanceValues: true }
    }],
    operations: [{
      kind: "function", role: { id: "stage5.role/transform", version: roleVersion },
      operation: { id: transform.id, version: transform.version },
      obligations: { deterministic: true, totalOnConformanceValues: true, pointwiseEquivalent: true }
    }]
  });
  const result = createCatalog({
    identity: { id: "stage5/catalog-" + variant, version: "1" },
    schemas: [number.runtime], operations: [transform], semanticRoles
  });
  if (!result.ok) throw new Error("catalog fixture failed");
  return result.value;
}
export const catalog = catalogFor("same");
export const repairable = catalogFor("repairable");
export const genuine = catalogFor("genuine");
export const policy = {
  allowedCapabilities: [],
  budget: { maxEffectCalls: 0, maxCollectionItems: 10, maxRecursionDepth: 0,
    maxTokens: 0, maxWallClockMs: 100, maxParallelism: 1 }
};
`;
const suiteModule = `
const schema = { kind: "schema", role: { id: "stage5.role/number", version: "1" }, values: [0, 1, 5] };
const operation = { kind: "function", role: { id: "stage5.role/transform", version: "1" }, inputs: [0, 1, 5] };
export const exact = { protocol: "lachesis-cross-catalog-conformance-suite/1", fixtures: [schema, operation] };
export const incomplete = { protocol: "lachesis-cross-catalog-conformance-suite/1", fixtures: [schema] };
`;

type Invocation = Readonly<{ code: number; stdout: string; stderr: string }>;

async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(import.meta.dirname, ".stage5-"));
  roots.push(root);
  await Promise.all([
    writeFile(resolve(root, "left.mjs"), catalogModule),
    writeFile(resolve(root, "right.mjs"), catalogModule),
    writeFile(resolve(root, "suite.mjs"), suiteModule),
  ]);
  return root;
}

async function compare(
  root: string,
  rightExport: "catalog" | "repairable" | "genuine",
  suite: "exact" | "incomplete" | undefined,
): Promise<Invocation> {
  let stdout = "";
  let stderr = "";
  if (suite !== undefined)
    await Promise.all([
      rm(resolve(root, "native.json"), { force: true }),
      rm(resolve(root, "source-report.json"), { force: true }),
    ]);
  const suiteArgs =
    suite === undefined
      ? []
      : ["--suite", `./suite.mjs#${suite}`, "--conformance-out", "native.json"];
  const result = await runCatalogCompareCommand(
    [
      "--left-catalog",
      "./left.mjs#catalog",
      "--left-policy",
      "./left.mjs#policy",
      "--right-catalog",
      `./right.mjs#${rightExport}`,
      "--right-policy",
      "./right.mjs#policy",
      ...suiteArgs,
      "--report",
      suite === undefined ? "-" : "source-report.json",
      "--project-root",
      root,
    ],
    {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
  );
  return { code: result.exitCode, stdout, stderr };
}

async function verify(
  root: string,
  args: ReadonlyArray<string>,
  hooks: ReportVerifyCommandTestHooks = {},
): Promise<Invocation> {
  let stdout = "";
  let stderr = "";
  const result = await runReportVerifyCommand(
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

async function parsedReport(text: string): Promise<CommandReport> {
  const json = parseJson(text);
  if (!json.ok) throw new Error(json.error.message);
  const report = await verifyCommandReport(json.value);
  if (!report.ok) throw new Error(report.error.message);
  return report.value;
}

async function writeReport(
  root: string,
  name: string,
  report: CommandReport,
): Promise<void> {
  const serialized = serializeCommandReport(report);
  if (!serialized.ok) throw new Error(serialized.error.message);
  await writeFile(resolve(root, name), serialized.value);
}

async function rawSha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function redigest(
  report: CommandReport,
  changes: object,
): Promise<CommandReport> {
  const candidate = { ...report, ...changes };
  const { reportDigest, ...body } = candidate;
  void reportDigest;
  const digest = await digestValue(body);
  if (!digest.ok) throw new Error(digest.error.message);
  return commandReportSchema.parse({ ...body, reportDigest: digest.value });
}

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("private detached report verify command", () => {
  it("verifies manifest, structural, conformant, and rejected semantic reports without propagating their outcome", async () => {
    const root = await fixture();
    let manifestStdout = "";
    const manifest = await runCatalogManifestCommand(
      [
        "--catalog",
        "./left.mjs#catalog",
        "--policy",
        "./left.mjs#policy",
        "--out",
        "manifest.json",
        "--report",
        "manifest-report.json",
        "--project-root",
        root,
      ],
      {
        stdout: (text) => {
          manifestStdout += text;
        },
        stderr: () => undefined,
      },
    );
    expect(manifest.exitCode).toBe(0);
    expect(manifestStdout).toBe("");
    expect(
      (
        await verify(root, [
          "--input",
          "manifest-report.json",
          "--artifact",
          "catalog-manifest=manifest.json",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(0);

    const structural = await compare(root, "catalog", undefined);
    expect(structural.code).toBe(0);
    await writeFile(resolve(root, "structural.json"), structural.stdout);
    expect(
      (await verify(root, ["--input", "structural.json", "--report", "-"]))
        .code,
    ).toBe(0);

    const conformant = await compare(root, "catalog", "exact");
    expect(conformant.code).toBe(0);
    expect(
      (
        await verify(root, [
          "--input",
          "source-report.json",
          "--artifact",
          "native-conformance-report=native.json",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(0);

    for (const [right, suite, expected] of [
      ["repairable", "exact", 11],
      ["genuine", "exact", 12],
      ["catalog", "incomplete", 13],
    ] as const) {
      const source = await compare(root, right, suite);
      expect(source.code).toBe(expected);
      const name = `rejected-${expected}.json`;
      await writeFile(
        resolve(root, name),
        await readFile(resolve(root, "source-report.json")),
      );
      const detached = await verify(root, ["--input", name, "--report", "-"]);
      expect(detached.code).toBe(0);
      expect(detached.stdout).toContain('"outcomeExitCode":0');
    }
  });

  it("rejects report field, identity, summary, exit, completeness, and unknown-field tampering", async () => {
    const root = await fixture();
    const source = await compare(root, "catalog", undefined);
    const original = await parsedReport(source.stdout);
    const mutations: ReadonlyArray<
      Readonly<{ name: string; value: unknown; code: number }>
    > = [
      {
        name: "identity",
        value: { ...original, reportDigest: "0".repeat(64) },
        code: 22,
      },
      {
        name: "summary",
        value: {
          ...original,
          summary: { ...original.summary, migrationRecords: 1 },
        },
        code: 22,
      },
      { name: "exit", value: { ...original, outcomeExitCode: 10 }, code: 22 },
      {
        name: "completeness",
        value: { ...original, completeness: "partial" },
        code: 22,
      },
      { name: "unknown", value: { ...original, unexpected: true }, code: 20 },
    ];
    for (const mutation of mutations) {
      await writeFile(
        resolve(root, `${mutation.name}.json`),
        `${JSON.stringify(mutation.value)}\n`,
      );
      expect(
        (
          await verify(root, [
            "--input",
            `${mutation.name}.json`,
            "--report",
            "-",
          ])
        ).code,
      ).toBe(mutation.code);
    }
  });

  it("rejects redigested nested diagnostic, assessment, conformance, artifact-list, and cross-reference mutations", async () => {
    const root = await fixture();
    const rejected = await compare(root, "repairable", "exact");
    expect(rejected.code).toBe(11);
    const source = await parsedReport(
      await readFile(resolve(root, "source-report.json"), "utf8"),
    );
    const record = source.diagnostics.conformance[0];
    const migration = source.migrations[0];
    if (
      record?.diagnostic === null ||
      record?.diagnostic === undefined ||
      migration === undefined
    )
      throw new Error("Missing rejected semantic evidence.");
    const diagnosticMutation = await redigest(source, {
      diagnostics: {
        ...source.diagnostics,
        conformance: [
          {
            ...record,
            diagnostic: {
              ...record.diagnostic,
              explanation: "Mutated diagnostic explanation.",
            },
          },
        ],
      },
    });
    const assessmentMutation = await redigest(source, {
      migrations: [
        {
          ...migration,
          outcomes: [
            {
              ...migration.outcomes[0],
              assessmentIdentity: "0".repeat(64),
            },
          ],
        },
      ],
    });
    for (const [name, report] of [
      ["diagnostic", diagnosticMutation],
      ["assessment", assessmentMutation],
    ] as const) {
      await writeReport(root, `${name}.json`, report);
      expect(
        (await verify(root, ["--input", `${name}.json`, "--report", "-"])).code,
      ).toBe(22);
    }

    await compare(root, "catalog", "exact");
    const conformant = await parsedReport(
      await readFile(resolve(root, "source-report.json"), "utf8"),
    );
    const conformantRecord = conformant.diagnostics.conformance[0];
    const artifact = conformant.artifacts[0];
    if (conformantRecord === undefined || artifact === undefined)
      throw new Error("Missing conformant evidence.");
    const crossReference = await redigest(conformant, {
      diagnostics: {
        ...conformant.diagnostics,
        conformance: [{ ...conformantRecord, reportIdentity: "0".repeat(64) }],
      },
    });
    const artifactList = await redigest(conformant, { artifacts: [] });
    for (const [name, report] of [
      ["cross-reference", crossReference],
      ["artifact-list", artifactList],
    ] as const) {
      await writeReport(root, `${name}.json`, report);
      expect(
        (
          await verify(root, [
            "--input",
            `${name}.json`,
            "--artifact",
            "native-conformance-report=native.json",
            "--report",
            "-",
          ])
        ).code,
      ).toBe(22);
    }
    const nativeJson = parseJson(
      await readFile(resolve(root, "native.json"), "utf8"),
    );
    if (
      !nativeJson.ok ||
      nativeJson.value === null ||
      typeof nativeJson.value !== "object" ||
      Array.isArray(nativeJson.value)
    )
      throw new Error("Missing native conformance report.");
    const nativeMutationBytes = new TextEncoder().encode(
      `${JSON.stringify({ ...nativeJson.value, checkedValues: 999 })}\n`,
    );
    await writeFile(resolve(root, "native-mutated.json"), nativeMutationBytes);
    const semanticArtifactMutation = await redigest(conformant, {
      artifacts: [
        {
          ...artifact,
          checksum: {
            algorithm: "sha256",
            value: await rawSha256(nativeMutationBytes),
          },
        },
      ],
    });
    await writeReport(root, "semantic-artifact.json", semanticArtifactMutation);
    expect(
      (
        await verify(root, [
          "--input",
          "semantic-artifact.json",
          "--artifact",
          "native-conformance-report=native-mutated.json",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(22);
  });

  it("rejects missing, unexpected, corrupted, aliased, symlinked, and raced artifacts", async () => {
    const root = await fixture();
    await compare(root, "catalog", "exact");
    const nativeBytes = await readFile(resolve(root, "native.json"));
    expect(
      (await verify(root, ["--input", "source-report.json", "--report", "-"]))
        .code,
    ).toBe(23);
    expect(
      (
        await verify(root, [
          "--input",
          "source-report.json",
          "--artifact",
          "native-conformance-report=native.json",
          "--artifact",
          "unexpected=suite.mjs",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(22);
    await writeFile(
      resolve(root, "native.json"),
      nativeBytes.subarray(0, Math.max(1, nativeBytes.byteLength - 1)),
    );
    expect(
      (
        await verify(root, [
          "--input",
          "source-report.json",
          "--artifact",
          "native-conformance-report=native.json",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(22);
    await writeFile(resolve(root, "native.json"), nativeBytes);
    await appendFile(resolve(root, "native.json"), " ");
    expect(
      (
        await verify(root, [
          "--input",
          "source-report.json",
          "--artifact",
          "native-conformance-report=native.json",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(22);
    await rm(resolve(root, "native.json"));
    await symlink("suite.mjs", resolve(root, "native.json"));
    expect(
      (
        await verify(root, [
          "--input",
          "source-report.json",
          "--artifact",
          "native-conformance-report=native.json",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(23);
    expect(
      (
        await verify(root, [
          "--input",
          "source-report.json",
          "--artifact",
          "native-conformance-report=source-report.json",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(22);
    await rm(resolve(root, "native.json"));
    await writeFile(
      resolve(root, "native.json"),
      new Uint8Array(16 * 1024 * 1024 + 1),
    );
    expect(
      (
        await verify(root, [
          "--input",
          "source-report.json",
          "--artifact",
          "native-conformance-report=native.json",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(23);
  });

  it("fails closed on artifact replacement during a descriptor-bound read", async () => {
    const root = await fixture();
    await compare(root, "catalog", "exact");
    let replaced = false;
    const raced = await verify(
      root,
      [
        "--input",
        "source-report.json",
        "--artifact",
        "native-conformance-report=native.json",
        "--report",
        "-",
      ],
      {
        afterBoundRead: async (path) => {
          if (!path.endsWith("native.json") || replaced) return;
          replaced = true;
          await writeFile(path, "{}\n");
        },
      },
    );
    expect(raced.code).toBe(23);
  });

  it("uses no-clobber output, explicit replacement, containment, and symlink-safe writes", async () => {
    const root = await fixture();
    const source = await compare(root, "catalog", undefined);
    await writeFile(resolve(root, "input.json"), source.stdout);
    const first = await verify(root, [
      "--input",
      "input.json",
      "--report",
      "verified.json",
    ]);
    expect(first.code).toBe(0);
    const original = await readFile(resolve(root, "verified.json"), "utf8");
    const noClobber = await verify(root, [
      "--input",
      "input.json",
      "--report",
      "verified.json",
    ]);
    expect(noClobber.code).toBe(23);
    expect(await readFile(resolve(root, "verified.json"), "utf8")).toBe(
      original,
    );
    expect(
      (
        await verify(root, [
          "--input",
          "input.json",
          "--report",
          "verified.json",
          "--replace",
        ])
      ).code,
    ).toBe(0);
    await symlink("verified.json", resolve(root, "linked-report.json"));
    expect(
      (
        await verify(root, [
          "--input",
          "input.json",
          "--report",
          "linked-report.json",
        ])
      ).code,
    ).toBe(23);
    await mkdir(resolve(root, "real-parent"));
    await symlink("real-parent", resolve(root, "linked-parent"));
    expect(
      (
        await verify(root, [
          "--input",
          "input.json",
          "--report",
          "linked-parent/report.json",
        ])
      ).code,
    ).toBe(23);
    expect(
      (
        await verify(root, [
          "--input",
          "input.json",
          "--report",
          "../escape.json",
        ])
      ).code,
    ).toBe(23);
  });

  it("is byte deterministic, property-order independent, and emits one outcome", async () => {
    const root = await fixture();
    const source = await compare(root, "catalog", undefined);
    const original = await parsedReport(source.stdout);
    await writeReport(root, "first.json", original);
    const reordered = {
      reportDigest: original.reportDigest,
      integrity: original.integrity,
      redaction: original.redaction,
      artifacts: original.artifacts,
      summary: original.summary,
      migrations: original.migrations,
      diagnostics: original.diagnostics,
      outcomeExitCode: original.outcomeExitCode,
      completeness: original.completeness,
      status: original.status,
      inputs: original.inputs,
      command: original.command,
      protocol: original.protocol,
    };
    await writeFile(
      resolve(root, "second.json"),
      `${JSON.stringify(reordered)}\n`,
    );
    const first = await verify(root, [
      "--input",
      "first.json",
      "--report",
      "-",
    ]);
    const second = await verify(root, [
      "--input",
      "second.json",
      "--report",
      "-",
    ]);
    expect(first).toEqual(second);
    expect(first.stdout.trim().split("\n")).toHaveLength(1);
  });

  it("rejects hostile keys without prototype mutation and preserves usage errors", async () => {
    const root = await fixture();
    await writeFile(
      resolve(root, "hostile.json"),
      '{"**proto**":{"polluted":true},"protocol":"lachesis-catalog-command-report/1"}\n',
    );
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    expect(
      (await verify(root, ["--input", "hostile.json", "--report", "-"])).code,
    ).toBe(20);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    expect(
      (
        await verify(root, [
          "--input",
          "hostile.json",
          "--artifact",
          "duplicate=one.json",
          "--artifact",
          "duplicate=two.json",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(64);
  });

  it("contains no dynamic execution, generator, provider, network, or credential surface", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../src/internal/report-verify-command.ts"),
      "utf8",
    );
    for (const forbidden of [
      "import(",
      "lachesis-generator",
      "catalog-manifest-command",
      "catalog-compare-command",
      "fetch(",
      "process.env",
      "credential",
      "provider",
    ])
      expect(source).not.toContain(forbidden);
  });
});
