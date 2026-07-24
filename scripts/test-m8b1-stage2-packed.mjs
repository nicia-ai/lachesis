import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const root = await mkdtemp(resolve(tmpdir(), "lachesis-stage2-packed-"));

function run(command, args, cwd = root) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
    resolve(root, "catalog.mjs"),
    `import { createCatalog, diagnostic } from "@nicia-ai/lachesis";
const schema = {
  id: "packed/item", version: "1", description: "Packed item.",
  jsonSchema: { type: "string" }, kind: { kind: "scalar" },
  parse(value) {
    return typeof value === "string"
      ? { ok: true, value }
      : { ok: false, error: diagnostic("INVALID_WIRE_SCHEMA", "invalid") };
  }
};
const result = createCatalog({
  identity: { id: "packed/catalog", version: "1" },
  schemas: [schema], operations: []
});
if (!result.ok) throw new Error("catalog failed");
export const catalog = result.value;
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
    'import type { Catalog, CompilationPolicy } from "@nicia-ai/lachesis";\nexport type Fixture = readonly [Catalog, CompilationPolicy];\n',
  );
  run("pnpm", ["install", "--offline", "--ignore-scripts"]);
  run("pnpm", ["exec", "tsc", "--noEmit"]);
  const output = run("node", [
    "node_modules/@nicia-ai/lachesis-cli/dist/cli.js",
    "catalog",
    "manifest",
    "--catalog",
    "./catalog.mjs#catalog",
    "--policy",
    "./catalog.mjs#policy",
    "--check",
    "--report",
    "-",
  ]);
  if (!output.includes('"outcomeExitCode":0'))
    throw new Error("Packed catalog manifest command did not pass.");
  const lockfile = await readFile(resolve(root, "pnpm-lock.yaml"), "utf8");
  if (lockfile.includes("workspace:"))
    throw new Error("Packed consumer retained a workspace dependency.");
  process.stdout.write(
    `${JSON.stringify({
      protocol: "lachesis-m8b1-stage2-packed-consumer/1",
      node: process.version,
      typescript: "6.0.3",
      skipLibCheck: false,
      workspaceImports: false,
      providerCalls: 0,
      status: "pass",
    })}\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
