import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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
const expectedReleaseVersion = "0.1.0-alpha.2";

if (process.versions.node.split(".")[0] !== "24")
  throw new Error(`Node 24 is required; found ${process.versions.node}.`);

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

function parseManifest(text, label) {
  const parsed = parseJson(text);
  if (!parsed.ok || parsed.value === null || Array.isArray(parsed.value))
    throw new Error(`Invalid package manifest: ${label}.`);
  return parsed.value;
}

async function readManifest(path) {
  return parseManifest(await readFile(path, "utf8"), path);
}

function exportTargets(value) {
  if (typeof value === "string") return [value];
  if (value === null || Array.isArray(value) || typeof value !== "object")
    throw new Error("Package exports contain an unsupported target.");
  return Object.values(value).flatMap((target) => exportTargets(target));
}

const temporary = await mkdtemp(join(tmpdir(), "lachesis-pack-audit-"));
const packed = join(temporary, "packed");
const consumer = join(temporary, "consumer");

try {
  await Promise.all([
    mkdir(packed, { recursive: true }),
    mkdir(consumer, { recursive: true }),
  ]);
  const sourceManifests = await Promise.all(
    packageDirectories.map((directory) =>
      readManifest(join(root, directory, "package.json")),
    ),
  );
  const publicPackageNames = new Set(
    sourceManifests.map((manifest) => manifest.name),
  );
  for (const manifest of sourceManifests) {
    if (manifest.version !== expectedReleaseVersion)
      throw new Error(
        `${manifest.name} is ${manifest.version}; expected ${expectedReleaseVersion}.`,
      );
  }
  const tarballs = new Map();
  const packages = [];
  for (const [index, directory] of packageDirectories.entries()) {
    const manifest = sourceManifests[index];
    if (manifest === undefined)
      throw new Error(`Missing source manifest for ${directory}.`);
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
    const tarballPath = join(packed, tarball);
    const listing = (
      await command("tar", ["-tf", tarballPath], { capture: true })
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
    const packedManifest = parseManifest(
      (
        await command("tar", ["-xOf", tarballPath, "package/package.json"], {
          capture: true,
        })
      ).stdout,
      `${tarball}:package/package.json`,
    );
    if (
      packedManifest.name !== manifest.name ||
      packedManifest.version !== expectedReleaseVersion ||
      packedManifest.type !== "module" ||
      packedManifest.publishConfig?.access !== "public"
    )
      throw new Error(`${manifest.name} packed metadata is not release-safe.`);
    for (const target of exportTargets(packedManifest.exports)) {
      if (
        !target.startsWith("./dist/") ||
        !listing.includes(`package/${target.slice(2)}`)
      )
        throw new Error(`${manifest.name} export target ${target} is absent.`);
    }
    for (const path of listing.filter((file) =>
      file.startsWith("package/dist/"),
    )) {
      if (path.endsWith(".js") && !listing.includes(`${path}.map`))
        throw new Error(`${manifest.name} source map is missing for ${path}.`);
      if (path.endsWith(".d.ts") && !listing.includes(`${path}.map`))
        throw new Error(
          `${manifest.name} declaration map is missing for ${path}.`,
        );
    }
    for (const section of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      const dependencies = packedManifest[section];
      if (
        dependencies === undefined ||
        dependencies === null ||
        Array.isArray(dependencies) ||
        typeof dependencies !== "object"
      )
        continue;
      for (const [name, version] of Object.entries(dependencies)) {
        if (publicPackageNames.has(name) && version !== expectedReleaseVersion)
          throw new Error(
            `${manifest.name} resolves ${name} to ${String(version)}, not ${expectedReleaseVersion}.`,
          );
      }
    }
    for (const declaration of listing.filter(
      (path) =>
        path.endsWith(".d.ts") &&
        !path.endsWith("/node.d.ts") &&
        !path.endsWith("/node-store.d.ts") &&
        !path.endsWith("/sqlite.d.ts"),
    )) {
      const text = (
        await command("tar", ["-xOf", tarballPath, declaration], {
          capture: true,
        })
      ).stdout;
      for (const forbidden of [
        'from "node:',
        "from 'node:",
        "NodeJS.",
        "Buffer",
        'from "drizzle-orm',
        'from "better-sqlite3',
        'from "@ai-sdk/',
        'from "openai',
        'from "@anthropic-ai/',
      ]) {
        if (text.includes(forbidden))
          throw new Error(
            `${manifest.name} portable declaration leaks ${forbidden}.`,
          );
      }
    }
    const tarballContents = await readFile(tarballPath);
    const metadata = await stat(tarballPath);
    packages.push({
      name: manifest.name,
      version: manifest.version,
      tarball,
      sha256: createHash("sha256").update(tarballContents).digest("hex"),
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
          wrangler: "4.110.0",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumer, "portable.ts"),
    `import { catalogSemanticRolesSchema } from "@nicia-ai/lachesis";
import { selectEvidence } from "@nicia-ai/lachesis-evidence";
import { conformCatalogsOffline, designM6dPairedStudy } from "@nicia-ai/lachesis-generator";
import { compilePlan, run, replay } from "@nicia-ai/lachesis-runtime";
import { createM5TypeGraphEvidenceStore } from "@nicia-ai/lachesis-evidence-typegraph";
void catalogSemanticRolesSchema;
void selectEvidence;
void conformCatalogsOffline;
void designM6dPairedStudy;
void compilePlan;
void run;
void replay;
void createM5TypeGraphEvidenceStore;
`,
  );
  await writeFile(
    join(consumer, "worker.ts"),
    `import { catalogSemanticRolesSchema } from "@nicia-ai/lachesis";
import { selectEvidence } from "@nicia-ai/lachesis-evidence";
import { TYPEGRAPH_EVIDENCE_SCHEMA } from "@nicia-ai/lachesis-evidence-typegraph";
import { conformCatalogsOffline } from "@nicia-ai/lachesis-generator";
import { createInMemoryEvidenceStore } from "@nicia-ai/lachesis-runtime";
export default {
  fetch(): Response {
    return Response.json({
      portable: [catalogSemanticRolesSchema, selectEvidence, TYPEGRAPH_EVIDENCE_SCHEMA, conformCatalogsOffline, createInMemoryEvidenceStore].every(Boolean),
    });
  },
};
`,
  );
  await writeFile(
    join(consumer, "wrangler.jsonc"),
    `${JSON.stringify(
      {
        $schema: "./node_modules/wrangler/config-schema.json",
        name: "lachesis-packed-worker-smoke",
        main: "worker.ts",
        compatibility_date: "2026-06-01",
      },
      null,
      2,
    )}\n`,
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
  await command(
    "pnpm",
    ["exec", "wrangler", "deploy", "--dry-run", "--outdir", "worker-dist"],
    { cwd: consumer },
  );

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
          nodeVersion: process.versions.node,
          workers: "passed",
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
