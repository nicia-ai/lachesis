import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = await mkdtemp(resolve(tmpdir(), "lachesis-alpha4-consumer-"));
const repositoryRoot = resolve(import.meta.dirname, "..");
const artifacts = resolve(repositoryRoot, ".release-packages");
const cli = resolve(root, "node_modules/@nicia-ai/lachesis-cli/dist/cli.js");

function run(command, arguments_, cwd = root) {
  return execFileSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function invoke(arguments_) {
  return spawnSync("node", [cli, ...arguments_], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const catalog = `import { createCatalog, diagnostic } from "@nicia-ai/lachesis";
const schema = {
  id: "alpha4-consumer/item",
  version: "1",
  description: "An alpha.4 consumer integer.",
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
  id: "alpha4-consumer/identity",
  version: "1",
  description: "Preserve an integer.",
  input: { id: schema.id, version: schema.version },
  output: { id: schema.id, version: schema.version },
  semantics: { stateChanging: false },
  invoke(value) { return { ok: true, value }; }
};
const created = createCatalog({
  identity: { id: "alpha4-consumer/catalog", version: "1" },
  schemas: [schema],
  operations: [operation],
  semanticRoles: {
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [{
      kind: "schema",
      role: { id: "alpha4-consumer.role/item", version: "1" },
      schema: { id: schema.id, version: schema.version },
      obligations: { mutuallyAcceptsConformanceValues: true }
    }],
    operations: [{
      kind: "function",
      role: { id: "alpha4-consumer.role/identity", version: "1" },
      operation: { id: operation.id, version: operation.version },
      obligations: {
        deterministic: true,
        totalOnConformanceValues: true,
        pointwiseEquivalent: true
      }
    }]
  }
});
if (!created.ok) throw new Error("catalog creation failed");
export const catalog = created.value;
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
};\n`;

try {
  const tarball = (name) =>
    `file:${resolve(artifacts, `${name}-0.1.0-alpha.4.tgz`)}`;
  await writeFile(
    resolve(root, "package.json"),
    `${JSON.stringify(
      {
        name: "lachesis-alpha4-external-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@nicia-ai/lachesis": tarball("nicia-ai-lachesis"),
          "@nicia-ai/lachesis-cli": tarball("nicia-ai-lachesis-cli"),
          "@nicia-ai/lachesis-evidence": tarball("nicia-ai-lachesis-evidence"),
          "@nicia-ai/lachesis-evidence-typegraph": tarball(
            "nicia-ai-lachesis-evidence-typegraph",
          ),
          "@nicia-ai/lachesis-generator": tarball(
            "nicia-ai-lachesis-generator",
          ),
          "@nicia-ai/lachesis-runtime": tarball("nicia-ai-lachesis-runtime"),
          zod: "4.4.3",
        },
        devDependencies: {
          "@types/node": "24.13.3",
          typescript: "6.0.3",
        },
        pnpm: {
          overrides: {
            "@nicia-ai/lachesis": tarball("nicia-ai-lachesis"),
            "@nicia-ai/lachesis-evidence": tarball(
              "nicia-ai-lachesis-evidence",
            ),
            "@nicia-ai/lachesis-generator": tarball(
              "nicia-ai-lachesis-generator",
            ),
            "@nicia-ai/lachesis-runtime": tarball("nicia-ai-lachesis-runtime"),
          },
        },
      },
      undefined,
      2,
    )}\n`,
  );
  await Promise.all([
    writeFile(resolve(root, "left.mjs"), catalog),
    writeFile(resolve(root, "right.mjs"), catalog),
    writeFile(
      resolve(root, "suite.mjs"),
      `export const suite = {
  protocol: "lachesis-cross-catalog-conformance-suite/1",
  fixtures: [
    {
      kind: "schema",
      role: { id: "alpha4-consumer.role/item", version: "1" },
      values: [0, 1, 2]
    },
    {
      kind: "function",
      role: { id: "alpha4-consumer.role/identity", version: "1" },
      inputs: [0, 1, 2]
    }
  ]
};\n`,
    ),
    writeFile(
      resolve(root, "consumer.ts"),
      `import { canonicalizeJson } from "@nicia-ai/lachesis";
import type { EvidenceGraph } from "@nicia-ai/lachesis-evidence";
import type { CatalogConformanceSuite } from "@nicia-ai/lachesis-generator";
import type { RuntimeResult } from "@nicia-ai/lachesis-runtime";
const value = canonicalizeJson({ alpha: 4 });
export type Surface = readonly [EvidenceGraph, CatalogConformanceSuite, RuntimeResult];
void value;\n`,
    ),
    writeFile(
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
    ),
  ]);
  run("pnpm", [
    "install",
    "--ignore-scripts",
    ...(process.env.M8B2B_OFFLINE === "1" ? ["--offline"] : []),
  ]);
  run("node", ["node_modules/typescript/bin/tsc", "--noEmit"]);

  const manifest = invoke([
    "catalog",
    "manifest",
    "--catalog",
    "./left.mjs#catalog",
    "--policy",
    "./left.mjs#policy",
    "--out",
    "manifest.json",
    "--report",
    "manifest-report.json",
  ]);
  if (manifest.status !== 0) throw new Error(manifest.stderr);

  const structural = invoke([
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
    "--report",
    "structural.json",
  ]);
  if (structural.status !== 0) throw new Error(structural.stderr);

  const semantic = invoke([
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
    "--suite",
    "./suite.mjs#suite",
    "--conformance-out",
    "conformance.json",
    "--report",
    "semantic.json",
  ]);
  if (semantic.status !== 0) throw new Error(semantic.stderr);

  const detached = invoke([
    "report",
    "verify",
    "--input",
    "semantic.json",
    "--artifact",
    "native-conformance-report=conformance.json",
    "--report",
    "-",
  ]);
  if (detached.status !== 0 || !detached.stdout.includes('"outcomeExitCode":0'))
    throw new Error(detached.stderr);

  const lockfile = await readFile(resolve(root, "pnpm-lock.yaml"), "utf8");
  if (
    lockfile.includes("0.1.0-alpha.3") ||
    lockfile.includes("workspace:") ||
    !lockfile.includes("0.1.0-alpha.4")
  )
    throw new Error("The external consumer dependency closure is not alpha.4.");

  process.stdout.write(
    `${JSON.stringify({
      protocol: "lachesis.m8b2b.alpha4.consumer.v1",
      node: process.version,
      typescript: "6.0.3",
      skipLibCheck: false,
      packageCount: 6,
      workspaceImports: 0,
      alpha3Fallbacks: 0,
      commands: ["catalog.manifest", "catalog.compare", "report.verify"],
      providerCalls: 0,
      status: "pass",
    })}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
