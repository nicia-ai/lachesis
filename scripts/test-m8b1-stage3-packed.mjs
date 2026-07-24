import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const root = await mkdtemp(resolve(tmpdir(), "lachesis-stage3-packed-"));

function run(command, args, cwd = root) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function compare(rightExport) {
  return spawnSync(
    "node",
    [
      "node_modules/@nicia-ai/lachesis-cli/dist/cli.js",
      "catalog",
      "compare",
      "--left-catalog",
      "./catalogs.mjs#leftCatalog",
      "--left-policy",
      "./catalogs.mjs#policy",
      "--right-catalog",
      `./catalogs.mjs#${rightExport}`,
      "--right-policy",
      "./catalogs.mjs#policy",
      "--report",
      "-",
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

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
  await writeFile(
    resolve(root, "catalogs.mjs"),
    `import { createCatalog, diagnostic } from "@nicia-ai/lachesis";
const schema = {
  id: "packed-stage3/item", version: "1", description: "Packed item.",
  jsonSchema: { type: "string" }, kind: { kind: "scalar" },
  parse(value) {
    return typeof value === "string"
      ? { ok: true, value }
      : { ok: false, error: diagnostic("INVALID_WIRE_SCHEMA", "invalid") };
  }
};
function catalog(version) {
  const result = createCatalog({
    identity: { id: "packed-stage3/catalog", version },
    schemas: [schema], operations: []
  });
  if (!result.ok) throw new Error("catalog failed");
  return result.value;
}
export const leftCatalog = catalog("1");
export const exactCatalog = catalog("1");
export const changedCatalog = catalog("2");
export const policy = {
  allowedCapabilities: [],
  budget: {
    maxEffectCalls: 0, maxCollectionItems: 1, maxRecursionDepth: 0,
    maxTokens: 0, maxWallClockMs: 1, maxParallelism: 1
  }
};
`,
  );
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
    'import type { Catalog, CompilationPolicy } from "@nicia-ai/lachesis";\nexport type ComparisonInputs = readonly [Catalog, CompilationPolicy, Catalog, CompilationPolicy];\n',
  );
  run("pnpm", ["install", "--offline", "--ignore-scripts"]);
  run("pnpm", ["exec", "tsc", "--noEmit"]);
  const exact = compare("exactCatalog");
  if (
    exact.status !== 0 ||
    exact.stdout === null ||
    !exact.stdout.includes('"outcomeExitCode":0')
  )
    throw new Error("Packed exact structural comparison did not pass.");
  const changed = compare("changedCatalog");
  if (
    changed.status !== 10 ||
    changed.stdout === null ||
    !changed.stdout.includes('"outcomeExitCode":10') ||
    !changed.stdout.includes("change=catalog.identity")
  )
    throw new Error(
      "Packed changed structural comparison did not require review.",
    );
  const lockfile = await readFile(resolve(root, "pnpm-lock.yaml"), "utf8");
  if (lockfile.includes("workspace:"))
    throw new Error("Packed consumer retained a workspace dependency.");
  process.stdout.write(
    `${JSON.stringify({
      protocol: "lachesis-m8b1-stage3-packed-consumer/1",
      node: process.version,
      typescript: "6.0.3",
      skipLibCheck: false,
      workspaceImports: false,
      structuralExactExit: exact.status,
      structuralReviewExit: changed.status,
      providerCalls: 0,
      status: "pass",
    })}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
