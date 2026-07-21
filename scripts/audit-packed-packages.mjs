import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseJson } from "../packages/kernel/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const packageDirectories = [
  "packages/kernel",
  "packages/evidence",
  "packages/generator",
  "packages/runtime",
  "packages/evidence-typegraph",
];

function command(program, arguments_, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, arguments_, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else
        reject(
          new Error(
            `${program} ${arguments_.join(" ")} failed with ${code ?? "signal"}. ${stderr}`,
          ),
        );
    });
  });
}

async function readManifest(path) {
  const parsed = parseJson(await readFile(path, "utf8"));
  if (!parsed.ok || parsed.value === null || Array.isArray(parsed.value))
    throw new Error(`Invalid package manifest: ${path}.`);
  return parsed.value;
}

const temporary = await mkdtemp(join(tmpdir(), "lachesis-pack-audit-"));
const packed = join(temporary, "packed");
const consumer = join(temporary, "consumer");

try {
  await Promise.all([
    mkdir(packed, { recursive: true }),
    mkdir(consumer, { recursive: true }),
  ]);
  const tarballs = new Map();
  const packages = [];
  for (const directory of packageDirectories) {
    const manifest = await readManifest(join(root, directory, "package.json"));
    await command("pnpm", ["pack", "--pack-destination", packed], {
      cwd: join(root, directory),
    });
    const candidates = (await readdir(packed)).filter(
      (file) => file.endsWith(".tgz") && ![...tarballs.values()].includes(file),
    );
    if (candidates.length !== 1)
      throw new Error(
        `Unable to identify packed artifact for ${manifest.name}.`,
      );
    const tarball = candidates[0];
    tarballs.set(manifest.name, tarball);
    const listing = (
      await command("tar", ["-tf", join(packed, tarball)], { capture: true })
    ).stdout
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const required of [
      "package/package.json",
      "package/README.md",
      "package/CHANGELOG.md",
      "package/LICENSE",
      "package/dist/index.js",
      "package/dist/index.js.map",
      "package/dist/index.d.ts",
      "package/dist/index.d.ts.map",
    ]) {
      if (!listing.includes(required))
        throw new Error(`${manifest.name} pack is missing ${required}.`);
    }
    if (
      listing.some(
        (path) =>
          path.includes("/src/") ||
          path.includes("/tests/") ||
          path.endsWith("/.env"),
      )
    )
      throw new Error(
        `${manifest.name} pack contains private source material.`,
      );
    const metadata = await stat(join(packed, tarball));
    packages.push({
      name: manifest.name,
      version: manifest.version,
      tarballBytes: metadata.size,
      files: listing.length,
    });
  }

  const dependencyEntries = Object.fromEntries(
    [...tarballs.entries()].map(([name, file]) => [
      name,
      `file:${join(packed, file)}`,
    ]),
  );
  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify(
      {
        name: "lachesis-public-alpha-consumer",
        private: true,
        type: "module",
        dependencies: {
          ...dependencyEntries,
          "@nicia-ai/typegraph": "0.38.0",
          "better-sqlite3": "12.11.1",
          zod: "4.4.3",
        },
        pnpm: { overrides: dependencyEntries },
        devDependencies: {
          "@types/node": "24.13.3",
          typescript: "6.0.3",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumer, "portable.ts"),
    `import { compilePlan, run, replay } from "@nicia-ai/lachesis-runtime";
import { createM5TypeGraphEvidenceStore } from "@nicia-ai/lachesis-evidence-typegraph";
void compilePlan;
void run;
void replay;
void createM5TypeGraphEvidenceStore;
`,
  );
  await writeFile(
    join(consumer, "node.ts"),
    `import { createPrivateFileRecordingStore } from "@nicia-ai/lachesis-runtime/node";
import { createM5TypeGraphSqliteEvidenceStore } from "@nicia-ai/lachesis-evidence-typegraph/sqlite";
void createPrivateFileRecordingStore;
void createM5TypeGraphSqliteEvidenceStore;
`,
  );
  const strict = {
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      skipLibCheck: false,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      useUnknownInCatchVariables: true,
      noUncheckedSideEffectImports: true,
    },
  };
  await writeFile(
    join(consumer, "tsconfig.portable.json"),
    `${JSON.stringify(
      {
        ...strict,
        compilerOptions: {
          ...strict.compilerOptions,
          lib: ["ES2023", "WebWorker"],
          types: [],
        },
        include: ["portable.ts"],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumer, "tsconfig.node.json"),
    `${JSON.stringify(
      {
        ...strict,
        compilerOptions: {
          ...strict.compilerOptions,
          target: "ES2024",
          lib: ["ES2024"],
          types: ["node"],
        },
        include: ["node.ts"],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumer, "smoke.mjs"),
    `import { run, replay } from "@nicia-ai/lachesis-runtime";
import { createM5TypeGraphEvidenceStore } from "@nicia-ai/lachesis-evidence-typegraph";
if (typeof run !== "function" || typeof replay !== "function" || typeof createM5TypeGraphEvidenceStore !== "function") process.exit(1);
`,
  );

  await command("pnpm", ["install", "--offline", "--ignore-scripts"], {
    cwd: consumer,
  });
  await command("pnpm", ["exec", "tsc", "-p", "tsconfig.portable.json"], {
    cwd: consumer,
  });
  await command("pnpm", ["exec", "tsc", "-p", "tsconfig.node.json"], {
    cwd: consumer,
  });
  await command(process.execPath, ["smoke.mjs"], { cwd: consumer });

  process.stdout.write(
    `${JSON.stringify(
      {
        formatVersion: "1",
        kind: "lachesis-packed-package-audit",
        packages,
        consumer: {
          typescript: "6.0.3",
          skipLibCheck: false,
          portable: "passed",
          node: "passed",
          esm: "passed",
          commonjs: "not-promised",
          network: "offline-install",
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
