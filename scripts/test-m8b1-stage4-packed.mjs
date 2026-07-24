import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const root = await mkdtemp(resolve(tmpdir(), "lachesis-stage4-packed-"));

function run(command, args, cwd = root) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function compare(extra) {
  return spawnSync(
    "node",
    [
      "node_modules/@nicia-ai/lachesis-cli/dist/cli.js",
      "catalog",
      "compare",
      "--left-catalog",
      "./left.mjs#catalog",
      "--left-policy",
      "./left.mjs#policy",
      "--right-catalog",
      "./right.mjs#catalog",
      "--right-policy",
      "./right.mjs#policy",
      ...extra,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

const catalogSource = `import {
  createCatalog,
  diagnostic
} from "@nicia-ai/lachesis";
const schema = {
  id: "packed-stage4/item",
  version: "1",
  description: "Packed Stage 4 integer.",
  jsonSchema: { type: "number" },
  kind: { kind: "scalar" },
  parse(value) {
    return typeof value === "number"
      ? { ok: true, value }
      : { ok: false, error: diagnostic("INVALID_WIRE_SCHEMA", "invalid") };
  }
};
const operation = {
  kind: "function",
  id: "packed-stage4/identity",
  version: "1",
  description: "Preserve an integer.",
  input: { id: schema.id, version: schema.version },
  output: { id: schema.id, version: schema.version },
  semantics: { stateChanging: false },
  invoke(value) { return { ok: true, value }; }
};
const result = createCatalog({
  identity: { id: "packed-stage4/catalog", version: "1" },
  schemas: [schema],
  operations: [operation],
  semanticRoles: {
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [{
      kind: "schema",
      role: { id: "packed-stage4.role/item", version: "1" },
      schema: { id: schema.id, version: schema.version },
      obligations: { mutuallyAcceptsConformanceValues: true }
    }],
    operations: [{
      kind: "function",
      role: { id: "packed-stage4.role/identity", version: "1" },
      operation: { id: operation.id, version: operation.version },
      obligations: {
        deterministic: true,
        totalOnConformanceValues: true,
        pointwiseEquivalent: true
      }
    }]
  }
});
if (!result.ok) throw new Error("catalog failed");
export const catalog = result.value;
export const policy = {
  allowedCapabilities: [],
  budget: {
    maxEffectCalls: 0,
    maxCollectionItems: 4,
    maxRecursionDepth: 0,
    maxTokens: 0,
    maxWallClockMs: 10,
    maxParallelism: 1
  }
};
`;

try {
  run(
    "pnpm",
    ["--filter", "@nicia-ai/lachesis-cli", "pack", "--pack-destination", root],
    repositoryRoot,
  );
  const tarball = resolve(root, "nicia-ai-lachesis-cli-0.1.0.tgz");
  await writeFile(
    resolve(root, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          "@nicia-ai/lachesis-cli": `file:${tarball}`,
          "@nicia-ai/lachesis": "0.1.0-alpha.3",
          "@nicia-ai/lachesis-generator": "0.1.0-alpha.3",
        },
        devDependencies: {
          "@types/node": "24.13.3",
          typescript: "6.0.3",
        },
      },
      undefined,
      2,
    )}\n`,
  );
  await Promise.all([
    writeFile(resolve(root, "left.mjs"), catalogSource),
    writeFile(resolve(root, "right.mjs"), catalogSource),
    writeFile(
      resolve(root, "suite.mjs"),
      `export const suite = {
  protocol: "lachesis-cross-catalog-conformance-suite/1",
  fixtures: [
    {
      kind: "schema",
      role: { id: "packed-stage4.role/item", version: "1" },
      values: [0, 1, 2]
    },
    {
      kind: "function",
      role: { id: "packed-stage4.role/identity", version: "1" },
      inputs: [0, 1, 2]
    }
  ]
};\n`,
    ),
  ]);
  await writeFile(
    resolve(root, "tsconfig.json"),
    `${JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2024",
        strict: true,
        skipLibCheck: false,
        noEmit: true,
      },
      files: ["consumer.ts"],
    })}\n`,
  );
  await writeFile(
    resolve(root, "consumer.ts"),
    `import type {
  Catalog,
  CompilationPolicy
} from "@nicia-ai/lachesis";
import type {
  CatalogConformanceSuite
} from "@nicia-ai/lachesis-generator";
export type Inputs = readonly [
  Catalog,
  CompilationPolicy,
  Catalog,
  CompilationPolicy,
  CatalogConformanceSuite
];\n`,
  );
  run("pnpm", ["install", "--offline", "--ignore-scripts"]);
  run("pnpm", ["exec", "tsc", "--noEmit"]);

  const structural = compare(["--report", "-"]);
  if (
    structural.status !== 0 ||
    structural.stdout === null ||
    !structural.stdout.includes('"outcomeExitCode":0')
  )
    throw new Error("Packed structural comparison did not pass.");

  const semantic = compare([
    "--suite",
    "./suite.mjs#suite",
    "--conformance-out",
    "native.json",
    "--report",
    "report.json",
  ]);
  if (semantic.status !== 0)
    throw new Error("Packed semantic comparison did not pass.");
  const [report, native, lockfile] = await Promise.all([
    readFile(resolve(root, "report.json"), "utf8"),
    readFile(resolve(root, "native.json"), "utf8"),
    readFile(resolve(root, "pnpm-lock.yaml"), "utf8"),
  ]);
  if (
    !report.includes('"outcomeExitCode":0') ||
    !report.includes('"conformanceRecords":1') ||
    !native.includes('"protocol":"lachesis-cross-catalog-conformance-report/1"')
  )
    throw new Error("Packed semantic artifacts are incomplete.");
  if (lockfile.includes("workspace:"))
    throw new Error("Packed consumer retained a workspace dependency.");
  process.stdout.write(
    `${JSON.stringify({
      protocol: "lachesis-m8b1-stage4-packed-consumer/1",
      node: process.version,
      typescript: "6.0.3",
      skipLibCheck: false,
      workspaceImports: false,
      structuralExit: structural.status,
      semanticExit: semantic.status,
      conformanceArtifact: true,
      providerCalls: 0,
      status: "pass",
    })}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
