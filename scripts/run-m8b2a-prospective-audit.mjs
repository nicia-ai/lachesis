import { spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";

import { format as formatText } from "prettier";

import { parseJson } from "../packages/kernel/dist/json.js";

const SOURCE_COMMIT = "9d414e0f3e695097457219e7a3c649bf813d7c57";
const repositoryRoot = resolve(import.meta.dirname, "..");
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || process.argv[outputIndex + 1] === undefined)
  throw new Error(
    "Usage: run-m8b2a-prospective-audit.mjs --output <directory>",
  );
const outputRoot = resolve(repositoryRoot, process.argv[outputIndex + 1]);
const scratch = await mkdtemp(resolve(tmpdir(), "lachesis-m8b2a-"));
const encoder = new TextEncoder();

function execute(command, args, options = {}) {
  const started = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 70,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
  };
}

function requireStatus(result, expected, label) {
  if (result.status !== expected)
    throw new Error(
      `${label}: expected ${expected}, received ${result.status}: ${result.stderr}`,
    );
}

function parseJsonValue(text, label) {
  const parsed = parseJson(text);
  if (!parsed.ok) throw new Error(`${label}: ${parsed.error.message}`);
  return parsed.value;
}

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function contentInventory(root, prefix = "") {
  const inventory = [];
  const entries = (await readdir(root, { withFileTypes: true })).toSorted(
    (left, right) => left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const relativePath = `${prefix}${entry.name}`;
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      inventory.push(...(await contentInventory(path, `${relativePath}/`)));
    } else if (entry.isFile()) {
      const bytes = await readFile(path);
      inventory.push({
        path: relativePath,
        bytes: bytes.byteLength,
        sha256: await sha256(bytes),
      });
    } else {
      throw new Error(`Unsupported package entry: ${relativePath}`);
    }
  }
  return inventory;
}

async function contentRoot(inventory) {
  return sha256(encoder.encode(canonical(inventory)));
}

async function writeJson(path, value) {
  await writeFile(
    path,
    await formatText(JSON.stringify(value), { parser: "json" }),
  );
}

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (
    typeof value === "object" &&
    Reflect.getPrototypeOf(value) === Object.prototype
  )
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  throw new Error("Unsupported audit JSON.");
}

async function redigest(report) {
  const body = { ...report };
  delete body.reportDigest;
  return {
    ...body,
    reportDigest: await sha256(encoder.encode(canonical(body))),
  };
}

function measurement(values) {
  const sorted = values.toSorted((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = values
    .map((value) => Math.abs(value - median))
    .toSorted((left, right) => left - right);
  return {
    samples: values.length,
    medianMs: Number(median.toFixed(3)),
    medianAbsoluteDeviationMs: Number(
      deviations[Math.floor(deviations.length / 2)].toFixed(3),
    ),
    minimumMs: Number(Math.min(...values).toFixed(3)),
    maximumMs: Number(Math.max(...values).toFixed(3)),
  };
}

function extractStage6Fixture(source, name) {
  const marker = `const ${name} = \``;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Missing ${name} fixture.`);
  const contentStart = start + marker.length;
  const end = source.indexOf("\n`;", contentStart);
  if (end === -1) throw new Error(`Unterminated ${name} fixture.`);
  return source.slice(contentStart, end);
}

const head = execute("git", ["rev-parse", "HEAD"]).stdout.trim();
if (head !== SOURCE_COMMIT)
  throw new Error(`Expected ${SOURCE_COMMIT}; received ${head}.`);
const packagePaths = [
  "packages/kernel",
  "packages/evidence",
  "packages/generator",
  "packages/runtime",
  "packages/evidence-typegraph",
  "apps/cli",
];
requireStatus(
  execute("git", ["diff", "--exit-code", SOURCE_COMMIT, "--", ...packagePaths]),
  0,
  "prospective package source binding",
);
requireStatus(execute("pnpm", ["build"]), 0, "workspace build");

const packageDefinitions = [
  {
    name: "@nicia-ai/lachesis",
    directory: "packages/kernel",
    expectedVersion: "0.1.0-alpha.3",
  },
  {
    name: "@nicia-ai/lachesis-evidence",
    directory: "packages/evidence",
    expectedVersion: "0.1.0-alpha.3",
  },
  {
    name: "@nicia-ai/lachesis-generator",
    directory: "packages/generator",
    expectedVersion: "0.1.0-alpha.3",
  },
  {
    name: "@nicia-ai/lachesis-runtime",
    directory: "packages/runtime",
    expectedVersion: "0.1.0-alpha.3",
  },
  {
    name: "@nicia-ai/lachesis-evidence-typegraph",
    directory: "packages/evidence-typegraph",
    expectedVersion: "0.1.0-alpha.3",
  },
  {
    name: "@nicia-ai/lachesis-cli",
    directory: "apps/cli",
    expectedVersion: "0.1.0",
  },
];
const versionsByName = new Map(
  packageDefinitions.map((item) => [item.name, item.expectedVersion]),
);
function synchronizedVersion(name, version) {
  if (typeof version !== "string" || !version.startsWith("workspace:"))
    return version;
  const synchronized = versionsByName.get(name);
  if (synchronized === undefined)
    throw new Error(`No prospective version is bound for ${name}.`);
  return synchronized;
}
function synchronizedManifest(manifest) {
  const result = { ...manifest };
  for (const section of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencies = manifest[section];
    if (
      dependencies === undefined ||
      dependencies === null ||
      Array.isArray(dependencies) ||
      typeof dependencies !== "object"
    )
      continue;
    result[section] = Object.fromEntries(
      Object.entries(dependencies)
        .map(([name, version]) => [name, synchronizedVersion(name, version)])
        .toSorted(([left], [right]) => left.localeCompare(right)),
    );
  }
  return result;
}

async function stagePackage(definition, attempt) {
  const source = resolve(repositoryRoot, definition.directory);
  const stage = resolve(
    scratch,
    `stage-${definition.name.replaceAll("/", "-").replaceAll("@", "")}-${attempt}`,
  );
  await mkdir(stage);
  const manifest = parseJsonValue(
    await readFile(resolve(source, "package.json"), "utf8"),
    `${definition.name} source manifest`,
  );
  if (!Array.isArray(manifest.files))
    throw new Error(`${definition.name} has no explicit files allowlist.`);
  for (const entry of manifest.files)
    await cp(resolve(source, entry), resolve(stage, entry), {
      recursive: true,
    });
  await writeJson(
    resolve(stage, "package.json"),
    synchronizedManifest(manifest),
  );
  return stage;
}

const artifactRoot = resolve(scratch, "artifacts");
await mkdir(artifactRoot);
const packageRecords = [];
for (const definition of packageDefinitions) {
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const destination = resolve(
      scratch,
      `pack-${definition.name.replaceAll("/", "-").replaceAll("@", "")}-${attempt}`,
    );
    await mkdir(destination);
    const stage = await stagePackage(definition, attempt);
    requireStatus(
      execute("npm", ["pack", stage, "--pack-destination", destination], {
        cwd: repositoryRoot,
      }),
      0,
      `${definition.name} pack ${attempt}`,
    );
    const files = (await readdir(destination)).filter((name) =>
      name.endsWith(".tgz"),
    );
    if (files.length !== 1)
      throw new Error(`${definition.name} produced an ambiguous tarball.`);
    const path = resolve(destination, files[0]);
    const bytes = await readFile(path);
    attempts.push({
      attempt,
      path,
      bytes: bytes.byteLength,
      sha256: await sha256(bytes),
    });
  }
  if (new Set(attempts.map((item) => item.sha256)).size !== 1)
    throw new Error(`${definition.name} packing is not byte-deterministic.`);
  const canonicalPath = resolve(artifactRoot, basename(attempts[0].path));
  await cp(attempts[0].path, canonicalPath);
  const listing = execute("tar", ["-tzf", canonicalPath], {
    cwd: repositoryRoot,
  });
  requireStatus(listing, 0, `${definition.name} inventory`);
  const manifestText = execute(
    "tar",
    ["-xOf", canonicalPath, "package/package.json"],
    { cwd: repositoryRoot },
  );
  requireStatus(manifestText, 0, `${definition.name} packed manifest`);
  const manifest = parseJsonValue(
    manifestText.stdout,
    `${definition.name} manifest`,
  );
  if (
    manifest.name !== definition.name ||
    manifest.version !== definition.expectedVersion
  )
    throw new Error(`${definition.name} packed identity mismatch.`);
  const extracted = resolve(
    scratch,
    `payload-${definition.name.replaceAll("/", "-").replaceAll("@", "")}`,
  );
  await mkdir(extracted);
  requireStatus(
    execute("tar", ["-xzf", canonicalPath, "-C", extracted]),
    0,
    `${definition.name} payload extraction`,
  );
  const payloadInventory = await contentInventory(
    resolve(extracted, "package"),
  );
  packageRecords.push({
    name: definition.name,
    version: definition.expectedVersion,
    tarball: basename(canonicalPath),
    path: canonicalPath,
    sha256: attempts[0].sha256,
    bytes: attempts[0].bytes,
    payloadContentRootSha256: await contentRoot(payloadInventory),
    fileInventory: listing.stdout.trim().split("\n").toSorted(),
    attempts: attempts.map(({ attempt, sha256: digest, bytes }) => ({
      attempt,
      sha256: digest,
      bytes,
    })),
  });
}

const stage6Source = await readFile(
  resolve(repositoryRoot, "scripts/run-m8b1-stage6-registry-audit.mjs"),
  "utf8",
);
const catalogSource = extractStage6Fixture(stage6Source, "catalogSource");
const suiteSource = extractStage6Fixture(stage6Source, "suiteSource");
const hostileCatalogSource = `
import {
  canonicalizeJson,
  createCatalog,
  defineEffect,
  defineSchema
} from "@nicia-ai/lachesis";
import { z } from "zod";

export const hostileSchema = defineSchema({
  id: "m8b2a/hostile-json",
  version: "1",
  description: "Own hostile keys are identity-bearing.",
  validator: z.strictObject({
    ["__proto__"]: z.strictObject({ marker: z.boolean() }),
    nested: z.strictObject({ ["__proto__"]: z.number() }),
    safe: z.number()
  })
});
const exactJsonRuntime = {
  id: "m8b2a/exact-json",
  version: "1",
  description: "Strict non-transforming JSON.",
  jsonSchema: {},
  kind: { kind: "scalar" },
  parse(value) {
    const result = canonicalizeJson(value);
    return result.ok ? { ok: true, value } : result;
  }
};
export const exactJson = {
  ...exactJsonRuntime,
  runtime: exactJsonRuntime
};
export const echo = defineEffect({
  id: "m8b2a/echo",
  version: "1",
  description: "Recordable echo.",
  input: exactJson,
  output: exactJson,
  effectName: "m8b2a.echo",
  capability: "m8b2a.echo",
  maxTokens: 1,
  maxWallClockMs: 1,
  replayable: true
});
const created = createCatalog({
  identity: { id: "m8b2a/hostile-catalog", version: "1" },
  schemas: [hostileSchema.runtime, exactJson.runtime],
  operations: [echo]
});
if (!created.ok) throw new Error("hostile catalog failed");
export const catalog = created.value;
export const policy = {
  allowedCapabilities: ["m8b2a.echo"],
  budget: {
    maxEffectCalls: 1,
    maxCollectionItems: 1,
    maxRecursionDepth: 0,
    maxTokens: 1,
    maxWallClockMs: 1,
    maxParallelism: 1
  }
};
`;
const identityRegressionSource = `
import {
  canonicalizeJson,
  compilePlanJson,
  createMockEffectHandler,
  createPlanLanguageManifest,
  createReplayEffectHandler,
  diagnostic,
  digestValue,
  executePlan,
  inspectExecutablePlan,
  parseJson,
  recordEffectResult,
  replayEntrySchema
} from "@nicia-ai/lachesis";
import {
  catalogConformanceSuiteSchema,
  verifyCatalogConformanceReport
} from "@nicia-ai/lachesis-generator";
import { catalog, exactJson, policy } from "./hostile-catalog.mjs";

const exact = (text) => {
  const parsed = parseJson(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
};
const withProto = exact('{"__proto__":{"marker":true},"nested":{"__proto__":7},"safe":1}');
const withoutProto = exact('{"nested":{},"safe":1}');
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
if (!own(withProto, "__proto__") || !own(withProto.nested, "__proto__"))
  throw new Error("parse lost an own hostile key");
const withCanonical = canonicalizeJson(withProto);
const withoutCanonical = canonicalizeJson(withoutProto);
if (!withCanonical.ok || !withoutCanonical.ok || withCanonical.value === withoutCanonical.value)
  throw new Error("canonical hostile identities collided");
const manifest = await createPlanLanguageManifest(catalog, policy);
if (!manifest.ok) throw new Error(manifest.error.message);
const manifestText = canonicalizeJson(manifest.value);
if (!manifestText.ok || !manifestText.value.includes('"__proto__"'))
  throw new Error("manifest lost hostile JSON-schema keys");
const plan = (value) => JSON.stringify({
  formatVersion: "1",
  catalog: { id: "m8b2a/hostile-catalog", version: "1" },
  root: "value",
  nodes: [{
    id: "value",
    op: "constant",
    schema: { id: exactJson.id, version: exactJson.version },
    value
  }],
  budget: policy.budget,
  allowedCapabilities: policy.allowedCapabilities
});
const compiled = await compilePlanJson(plan(withProto), catalog, policy);
const omitted = await compilePlanJson(plan(withoutProto), catalog, policy);
if (!compiled.ok || !omitted.ok) throw new Error("hostile constant did not compile");
const left = inspectExecutablePlan(compiled.value);
const right = inspectExecutablePlan(omitted.value);
if (left?.planHash === right?.planHash || !left?.canonicalPlan.includes('"__proto__"'))
  throw new Error("plan identity lost hostile key");
const executionOptions = (handler) => ({
  inputs: new Map(),
  effectHandler: handler,
  clock: { now: () => "2026-01-01T00:00:00.000Z" },
  runIdProvider: { next: () => "m8b2a-regression" }
});
const executed = await executePlan(
  compiled.value,
  executionOptions(createReplayEffectHandler([]))
);
if (!executed.ok || !own(executed.value.output, "__proto__"))
  throw new Error("execution lost hostile key");
const effectPlan = JSON.stringify({
  formatVersion: "1",
  catalog: { id: "m8b2a/hostile-catalog", version: "1" },
  root: "echo",
  nodes: [
    {
      id: "value",
      op: "constant",
      schema: { id: exactJson.id, version: exactJson.version },
      value: withProto
    },
    {
      id: "echo",
      op: "effect",
      source: "value",
      effect: { id: "m8b2a/echo", version: "1" }
    }
  ],
  budget: policy.budget,
  allowedCapabilities: policy.allowedCapabilities
});
const effectExecutable = await compilePlanJson(effectPlan, catalog, policy);
if (!effectExecutable.ok) throw new Error("effect plan failed");
let request;
await executePlan(
  effectExecutable.value,
  executionOptions(createMockEffectHandler((value) => {
    request = value;
    return { ok: false, error: diagnostic("MISSING_REPLAY_RESULT", "capture") };
  }))
);
if (request === undefined) throw new Error("effect request missing");
const recorded = await recordEffectResult(request, {
  value: withProto,
  replayResultId: "m8b2a/recording",
  usage: { tokens: 1, wallClockMs: 1 }
});
if (!recorded.ok || !own(recorded.value.value, "__proto__"))
  throw new Error("recording lost hostile key");
const storedDigest = await digestValue(recorded.value.value);
if (!storedDigest.ok || storedDigest.value !== recorded.value.outputDigest)
  throw new Error("recorded digest mismatch");
const persistedJson = parseJson(JSON.stringify(recorded.value));
if (!persistedJson.ok) throw new Error("persisted JSON failed");
const persisted = replayEntrySchema.parse(persistedJson.value);
const replayed = await createReplayEffectHandler([persisted])(request);
if (!replayed.ok || !own(replayed.value.value, "__proto__"))
  throw new Error("replay lost hostile key");
const parsedSuite = catalogConformanceSuiteSchema.parse({
  protocol: "lachesis-cross-catalog-conformance-suite/1",
  fixtures: [{
    kind: "schema",
    role: { id: "m8b2a.role/json", version: "1" },
    values: [withProto]
  }]
});
if (!own(parsedSuite.fixtures[0].values[0], "__proto__"))
  throw new Error("generator suite boundary lost hostile key");
for (const unsupported of [
  new Date(0),
  Object.defineProperty({ safe: 1 }, "hidden", { value: 2, enumerable: false }),
  Object.defineProperty({}, "value", { get() { return 1; }, enumerable: true }),
  (() => { const sparse = new Array(2); sparse[1] = 1; return sparse; })()
])
  if (canonicalizeJson(unsupported).ok)
    throw new Error("unsupported JavaScript state was accepted");
if (typeof verifyCatalogConformanceReport !== "function")
  throw new Error("current generator was not installed");
process.stdout.write(JSON.stringify({
  protocol: "lachesis.m8b2a.identity-regression.v1",
  rootProto: true,
  nestedProto: true,
  distinctCanonicalValues: true,
  distinctPlanHashes: true,
  manifestIdentity: true,
  compileExecuteRecordReplay: true,
  generatorStrictBoundary: true,
  unsupportedStateRejected: true
}) + "\\n");
`;

const pnpmVersion = execute("pnpm", ["--version"]).stdout.trim();
const nodeBinary = process.execPath;
const networkDenySource = `"use strict";
const deny = () => { throw new Error("m8b2a-network-denied"); };
for (const name of ["node:http", "node:https", "node:net", "node:tls", "node:dns"]) {
  const module = require(name);
  for (const key of ["connect", "createConnection", "request", "get", "lookup", "resolve"])
    if (typeof module[key] === "function") module[key] = deny;
}
`;

async function prepareConsumer(name, prospective) {
  const root = resolve(scratch, name);
  await mkdir(root);
  const dependencies = {
    "@nicia-ai/lachesis-cli": `file:./${packageRecords.find((item) => item.name === "@nicia-ai/lachesis-cli").tarball}`,
    zod: "4.4.3",
  };
  if (prospective)
    for (const item of packageRecords)
      dependencies[item.name] = `file:./${item.tarball}`;
  else dependencies["@nicia-ai/lachesis"] = "0.1.0-alpha.3";
  for (const item of packageRecords)
    if (prospective || item.name === "@nicia-ai/lachesis-cli")
      await cp(item.path, resolve(root, item.tarball));
  await writeJson(resolve(root, "package.json"), {
    name,
    private: true,
    type: "module",
    packageManager: `pnpm@${pnpmVersion}`,
    dependencies,
    ...(prospective
      ? {
          pnpm: {
            overrides: Object.fromEntries(
              packageRecords
                .filter((item) => item.name !== "@nicia-ai/lachesis-cli")
                .map((item) => [item.name, `file:./${item.tarball}`])
                .toSorted(([left], [right]) => left.localeCompare(right)),
            ),
          },
        }
      : {}),
    devDependencies: {
      "@types/node": "24.13.3",
      typescript: "6.0.3",
    },
  });
  await writeFile(resolve(root, "catalog.mjs"), catalogSource);
  await writeFile(resolve(root, "right-catalog.mjs"), catalogSource);
  await writeFile(resolve(root, "suite.mjs"), suiteSource);
  await writeFile(resolve(root, "hostile-catalog.mjs"), hostileCatalogSource);
  await writeFile(
    resolve(root, "identity-regression.mjs"),
    identityRegressionSource,
  );
  await writeFile(resolve(root, "network-deny.cjs"), networkDenySource);
  await writeJson(resolve(root, "tsconfig.json"), {
    compilerOptions: {
      module: "NodeNext",
      moduleResolution: "NodeNext",
      target: "ES2024",
      strict: true,
      skipLibCheck: false,
      noEmit: true,
    },
    files: ["consumer.ts"],
  });
  await writeFile(
    resolve(root, "consumer.ts"),
    'import type { Catalog, CompilationPolicy } from "@nicia-ai/lachesis";\nexport type InstalledContract = readonly [Catalog, CompilationPolicy];\n',
  );
  const installed = execute(
    "pnpm",
    ["install", "--ignore-scripts", "--config.confirmModulesPurge=false"],
    { cwd: root },
  );
  requireStatus(installed, 0, `${name} install`);
  return { root, installMs: installed.durationMs };
}

const prospective = await prepareConsumer("prospective-consumer", true);
const consumerRoot = prospective.root;
const cli = resolve(
  consumerRoot,
  "node_modules/@nicia-ai/lachesis-cli/dist/cli.js",
);
const offlineEnv = {
  ...process.env,
  CI: "1",
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  ALL_PROXY: "http://127.0.0.1:9",
  NO_PROXY: "",
  NODE_OPTIONS: `--require=${resolve(consumerRoot, "network-deny.cjs")}`,
};
function invoke(args, expected, label, root = consumerRoot, binary = cli) {
  const result = execute(nodeBinary, [binary, ...args], {
    cwd: root,
    env: offlineEnv,
  });
  requireStatus(result, expected, label);
  return result;
}

requireStatus(
  execute("pnpm", ["exec", "tsc", "--noEmit"], {
    cwd: consumerRoot,
    env: offlineEnv,
  }),
  0,
  "prospective strict TypeScript",
);
const manifestCheck = invoke(
  [
    "catalog",
    "manifest",
    "--catalog",
    "./catalog.mjs#catalog",
    "--policy",
    "./catalog.mjs#policy",
    "--check",
    "--report",
    "-",
  ],
  0,
  "manifest check",
);
const reorderedCheck = invoke(
  [
    "catalog",
    "manifest",
    "--report",
    "-",
    "--check",
    "--policy",
    "./catalog.mjs#policy",
    "--catalog",
    "./catalog.mjs#catalog",
  ],
  0,
  "reordered manifest check",
);
if (manifestCheck.stdout !== reorderedCheck.stdout)
  throw new Error("Reordered manifest report differs.");
invoke(
  [
    "catalog",
    "manifest",
    "--catalog",
    "./catalog.mjs#catalog",
    "--policy",
    "./catalog.mjs#policy",
    "--out",
    "manifest.json",
    "--report",
    "manifest-report.json",
  ],
  0,
  "manifest output",
);
invoke(
  [
    "catalog",
    "manifest",
    "--catalog",
    "./catalog.mjs#catalog",
    "--policy",
    "./catalog.mjs#policy",
    "--verify",
    "manifest.json",
    "--report",
    "manifest-verify.json",
  ],
  0,
  "manifest verify",
);
invoke(
  [
    "catalog",
    "manifest",
    "--catalog",
    "./catalog.mjs#catalog",
    "--policy",
    "./catalog.mjs#policy",
    "--out",
    "manifest.json",
    "--report",
    "duplicate-report.json",
  ],
  23,
  "manifest no-clobber",
);
invoke(
  [
    "catalog",
    "manifest",
    "--catalog",
    "./catalog.mjs#catalog",
    "--policy",
    "./catalog.mjs#policy",
    "--out",
    "manifest.json",
    "--report",
    "manifest-report.json",
    "--replace",
  ],
  0,
  "manifest replace",
);
invoke(
  [
    "catalog",
    "manifest",
    "--catalog",
    "./catalog.mjs#missing",
    "--policy",
    "./catalog.mjs#policy",
    "--check",
    "--report",
    "-",
  ],
  20,
  "invalid manifest export",
);
const originalCatalog = await readFile(resolve(consumerRoot, "catalog.mjs"));
await writeFile(
  resolve(consumerRoot, "catalog.mjs"),
  catalogSource.replace("maxWallClockMs: 100", "maxWallClockMs: 98"),
);
invoke(
  [
    "catalog",
    "manifest",
    "--catalog",
    "./catalog.mjs#catalog",
    "--policy",
    "./catalog.mjs#policy",
    "--verify",
    "manifest.json",
    "--report",
    "-",
  ],
  22,
  "manifest identity mismatch",
);
await writeFile(resolve(consumerRoot, "catalog.mjs"), originalCatalog);

function structural(rightCatalog, rightPolicy, report, expected) {
  invoke(
    [
      "catalog",
      "compare",
      "--left-catalog",
      "./catalog.mjs#catalog",
      "--left-policy",
      "./catalog.mjs#policy",
      "--right-catalog",
      `./right-catalog.mjs#${rightCatalog}`,
      "--right-policy",
      `./right-catalog.mjs#${rightPolicy}`,
      "--report",
      report,
    ],
    expected,
    `structural ${report}`,
  );
}
structural("catalog", "policy", "structural-exact.json", 0);
structural("review", "policy", "structural-review.json", 10);
structural("catalog", "changedPolicy", "structural-policy.json", 10);

function semantic(rightCatalog, rightPolicy, suite, stem, expected) {
  invoke(
    [
      "catalog",
      "compare",
      "--left-catalog",
      "./catalog.mjs#catalog",
      "--left-policy",
      "./catalog.mjs#policy",
      "--right-catalog",
      `./right-catalog.mjs#${rightCatalog}`,
      "--right-policy",
      `./right-catalog.mjs#${rightPolicy}`,
      "--suite",
      `./suite.mjs#${suite}`,
      "--conformance-out",
      `${stem}-native.json`,
      "--report",
      `${stem}-report.json`,
    ],
    expected,
    `semantic ${stem}`,
  );
}
semantic("catalog", "policy", "exact", "conformant", 0);
semantic("repairable", "policy", "exact", "repairable", 11);
semantic("genuine", "policy", "exact", "genuine", 12);
semantic("catalog", "policy", "incomplete", "insufficient", 13);
semantic("catalog", "changedPolicy", "exact", "policy-review", 10);
for (const stem of ["repairable", "genuine", "insufficient"])
  try {
    await lstat(resolve(consumerRoot, `${stem}-native.json`));
    throw new Error(`${stem} unexpectedly retained a native artifact.`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }

const verificationCases = [
  ["manifest-report.json", "catalog-manifest=manifest.json"],
  ["structural-exact.json"],
  ["structural-review.json"],
  [
    "conformant-report.json",
    "native-conformance-report=conformant-native.json",
  ],
  ["repairable-report.json"],
  ["genuine-report.json"],
  ["insufficient-report.json"],
  [
    "policy-review-report.json",
    "native-conformance-report=policy-review-native.json",
  ],
];
for (const [report, artifact] of verificationCases) {
  const args = ["report", "verify", "--input", report];
  if (artifact !== undefined) args.push("--artifact", artifact);
  args.push("--report", "-");
  invoke(args, 0, `detached ${report}`);
}
invoke(
  ["report", "verify", "--input", "manifest-report.json", "--report", "-"],
  23,
  "missing detached artifact",
);
invoke(
  [
    "report",
    "verify",
    "--input",
    "structural-exact.json",
    "--artifact",
    "unexpected=manifest.json",
    "--report",
    "-",
  ],
  22,
  "unexpected detached artifact",
);
const structuralReport = parseJsonValue(
  await readFile(resolve(consumerRoot, "structural-exact.json"), "utf8"),
  "structural report",
);
for (const [name, mutation] of [
  [
    "command",
    {
      ...structuralReport,
      command: {
        ...structuralReport.command,
        commandIdentity: "0".repeat(64),
      },
    },
  ],
  [
    "summary",
    {
      ...structuralReport,
      summary: { ...structuralReport.summary, migrationRecords: 999 },
    },
  ],
  ["exit", { ...structuralReport, outcomeExitCode: 10 }],
  ["completeness", { ...structuralReport, completeness: "partial" }],
]) {
  await writeJson(
    resolve(consumerRoot, `tamper-${name}.json`),
    name === "command" ? await redigest(mutation) : mutation,
  );
  invoke(
    ["report", "verify", "--input", `tamper-${name}.json`, "--report", "-"],
    22,
    `tamper ${name}`,
  );
}
const nativeBytes = await readFile(
  resolve(consumerRoot, "conformant-native.json"),
);
await writeFile(
  resolve(consumerRoot, "tamper-native.json"),
  new Uint8Array([...nativeBytes, 0x20]),
);
invoke(
  [
    "report",
    "verify",
    "--input",
    "conformant-report.json",
    "--artifact",
    "native-conformance-report=tamper-native.json",
    "--report",
    "-",
  ],
  22,
  "native checksum tamper",
);
await writeFile(
  resolve(consumerRoot, "oversized.json"),
  new Uint8Array(16 * 1024 * 1024 + 1),
);
invoke(
  ["report", "verify", "--input", "oversized.json", "--report", "-"],
  23,
  "oversized detached report",
);
await symlink("manifest.json", resolve(consumerRoot, "manifest-link.json"));
invoke(
  [
    "report",
    "verify",
    "--input",
    "manifest-report.json",
    "--artifact",
    "catalog-manifest=manifest-link.json",
    "--report",
    "-",
  ],
  23,
  "symlink artifact",
);
invoke(
  [
    "report",
    "verify",
    "--input",
    "manifest-report.json",
    "--artifact",
    "catalog-manifest=manifest.json",
    "--report",
    "manifest.json",
  ],
  22,
  "artifact and report alias",
);
await mkdir(resolve(consumerRoot, "stale-report.json.lachesis-tmp"));
invoke(
  [
    "report",
    "verify",
    "--input",
    "structural-exact.json",
    "--report",
    "stale-report.json",
  ],
  23,
  "stale deterministic temporary path",
);

invoke(
  [
    "catalog",
    "manifest",
    "--catalog",
    "./hostile-catalog.mjs#catalog",
    "--policy",
    "./hostile-catalog.mjs#policy",
    "--out",
    "hostile-manifest.json",
    "--report",
    "hostile-report.json",
  ],
  0,
  "hostile manifest",
);
const hostileManifestBytes = await readFile(
  resolve(consumerRoot, "hostile-manifest.json"),
  "utf8",
);
if (!hostileManifestBytes.includes('"__proto__"'))
  throw new Error("CLI manifest lost hostile schema keys.");
invoke(
  [
    "report",
    "verify",
    "--input",
    "hostile-report.json",
    "--artifact",
    "catalog-manifest=hostile-manifest.json",
    "--report",
    "-",
  ],
  0,
  "hostile detached verification",
);
const identityRegression = execute(nodeBinary, ["identity-regression.mjs"], {
  cwd: consumerRoot,
  env: offlineEnv,
});
requireStatus(identityRegression, 0, "prospective identity regression");

const secondProspective = await prepareConsumer(
  "prospective-consumer-two",
  true,
);
const secondCli = resolve(
  secondProspective.root,
  "node_modules/@nicia-ai/lachesis-cli/dist/cli.js",
);
const secondOfflineEnv = {
  ...offlineEnv,
  NODE_OPTIONS: `--require=${resolve(secondProspective.root, "network-deny.cjs")}`,
};
requireStatus(
  execute("pnpm", ["exec", "tsc", "--noEmit"], {
    cwd: secondProspective.root,
    env: secondOfflineEnv,
  }),
  0,
  "second prospective strict TypeScript",
);
const secondManifestCheck = execute(
  nodeBinary,
  [
    secondCli,
    "catalog",
    "manifest",
    "--catalog",
    "./catalog.mjs#catalog",
    "--policy",
    "./catalog.mjs#policy",
    "--check",
    "--report",
    "-",
  ],
  { cwd: secondProspective.root, env: secondOfflineEnv },
);
requireStatus(secondManifestCheck, 0, "second prospective manifest");
if (secondManifestCheck.stdout !== manifestCheck.stdout)
  throw new Error("Clean prospective consumers produced different reports.");
const secondIdentityRegression = execute(
  nodeBinary,
  ["identity-regression.mjs"],
  { cwd: secondProspective.root, env: secondOfflineEnv },
);
requireStatus(
  secondIdentityRegression,
  0,
  "second prospective identity regression",
);
if (secondIdentityRegression.stdout !== identityRegression.stdout)
  throw new Error(
    "Clean prospective consumers produced different identity evidence.",
  );

const lockfile = await readFile(
  resolve(consumerRoot, "pnpm-lock.yaml"),
  "utf8",
);
for (const item of packageRecords) {
  if (
    lockfile.includes(
      `https://registry.npmjs.org/${item.name.replace("/", "%2f")}`,
    ) ||
    lockfile.includes(`https://registry.npmjs.org/${item.name}/-`)
  )
    throw new Error(`${item.name} fell back to the public registry.`);
}
for (const forbidden of ["workspace:", "link:", "git+", "github:"])
  if (lockfile.includes(forbidden))
    throw new Error(`Prospective lockfile contains ${forbidden}.`);

const list = execute("pnpm", ["list", "--json", "--depth", "Infinity"], {
  cwd: consumerRoot,
  env: offlineEnv,
});
requireStatus(list, 0, "prospective dependency graph");
const dependencyTree = parseJsonValue(list.stdout, "dependency graph");
const origins = new Map();
const edges = new Set();
function visit(node, parent, declaredName) {
  if (node === null || typeof node !== "object") return;
  const name = node.name ?? declaredName;
  const version = node.version;
  let nextParent = parent;
  if (typeof name === "string" && typeof version === "string") {
    const identity = `${name}@${version}`;
    const resolved =
      typeof node.resolved === "string"
        ? node.resolved.includes(".tgz")
          ? node.resolved.startsWith("https://registry.npmjs.org/")
            ? node.resolved
            : "prospective-local-tarball"
          : node.resolved
        : "deduplicated";
    if (!origins.has(identity) || origins.get(identity) === "deduplicated")
      origins.set(identity, resolved);
    if (parent !== undefined) edges.add(`${parent}->${identity}`);
    nextParent = identity;
  }
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    const children = node[section];
    if (children !== null && typeof children === "object")
      for (const [childName, child] of Object.entries(children))
        visit(child, nextParent, childName);
  }
}
for (const item of dependencyTree) visit(item, undefined, undefined);
for (const item of packageRecords) {
  const origin = origins.get(`${item.name}@${item.version}`);
  if (origin !== "prospective-local-tarball")
    throw new Error(`${item.name} was not installed from its bound tarball.`);
}
const installedIntegrity = [];
for (const item of packageRecords) {
  const installedRoot = await realpath(
    resolve(consumerRoot, "node_modules", item.name),
  );
  const installedInventory = await contentInventory(installedRoot);
  const installedContentRootSha256 = await contentRoot(installedInventory);
  if (installedContentRootSha256 !== item.payloadContentRootSha256)
    throw new Error(`${item.name} installed content differs from its tarball.`);
  installedIntegrity.push({
    name: item.name,
    version: item.version,
    tarballSha256: item.sha256,
    payloadContentRootSha256: item.payloadContentRootSha256,
    installedContentRootSha256,
    installedFiles: installedInventory.length,
    verified: true,
  });
}
const licenses = execute("pnpm", ["licenses", "list", "--json"], {
  cwd: consumerRoot,
  env: offlineEnv,
});
requireStatus(licenses, 0, "prospective license inventory");
const licenseInventory = parseJsonValue(licenses.stdout, "license inventory");
const sanitizedLicenses = Object.fromEntries(
  Object.entries(licenseInventory)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([license, entries]) => {
      if (!Array.isArray(entries))
        throw new Error("Unexpected license inventory shape.");
      return [
        license,
        entries
          .map((entry) => {
            if (
              entry === null ||
              typeof entry !== "object" ||
              typeof entry.name !== "string" ||
              !Array.isArray(entry.versions)
            )
              throw new Error("Unexpected license inventory entry.");
            return {
              name: entry.name,
              versions: entry.versions.toSorted(),
            };
          })
          .toSorted((left, right) =>
            `${left.name}@${left.versions.join(",")}`.localeCompare(
              `${right.name}@${right.versions.join(",")}`,
            ),
          ),
      ];
    }),
);
const leakageNeedles = [
  repositoryRoot,
  scratch,
  "workspace:",
  "link:",
  "npm.pkg.github.com",
  "@nicia-ai/lachesis-benchmark",
  "@nicia-ai/lachesis-generator-ai-sdk",
  "_authToken",
].filter((needle) => needle.length > 0);
const leakageFindings = [];
for (const entry of await readdir(consumerRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
  const text = await readFile(resolve(consumerRoot, entry.name), "utf8");
  for (const needle of leakageNeedles)
    if (text.includes(needle))
      leakageFindings.push({ artifact: entry.name, needle });
}
for (const item of packageRecords) {
  const installedRoot = await realpath(
    resolve(consumerRoot, "node_modules", item.name),
  );
  for (const entry of await contentInventory(installedRoot)) {
    const path = resolve(installedRoot, entry.path);
    const text = new TextDecoder().decode(await readFile(path));
    for (const needle of leakageNeedles)
      if (text.includes(needle))
        leakageFindings.push({
          artifact: `${item.name}/${entry.path}`,
          needle,
        });
  }
}
if (leakageFindings.length > 0)
  throw new Error(
    `Prospective leakage findings: ${JSON.stringify(leakageFindings)}`,
  );

const compatibility = await prepareConsumer("alpha3-compatibility", false);
const compatibilityCli = resolve(
  compatibility.root,
  "node_modules/@nicia-ai/lachesis-cli/dist/cli.js",
);
requireStatus(
  execute("pnpm", ["exec", "tsc", "--noEmit"], {
    cwd: compatibility.root,
    env: {
      ...offlineEnv,
      NODE_OPTIONS: `--require=${resolve(compatibility.root, "network-deny.cjs")}`,
    },
  }),
  0,
  "alpha3 compatibility typecheck",
);
const compatibilityCheck = execute(
  nodeBinary,
  [
    compatibilityCli,
    "catalog",
    "manifest",
    "--catalog",
    "./catalog.mjs#catalog",
    "--policy",
    "./catalog.mjs#policy",
    "--check",
    "--report",
    "-",
  ],
  {
    cwd: compatibility.root,
    env: {
      ...offlineEnv,
      NODE_OPTIONS: `--require=${resolve(compatibility.root, "network-deny.cjs")}`,
    },
  },
);
requireStatus(compatibilityCheck, 0, "alpha3 backward API compatibility");

const docker = execute("docker", [
  "run",
  "--rm",
  "--network",
  "none",
  "--read-only",
  "--tmpfs",
  "/tmp:rw,noexec,nosuid,size=16m",
  "-v",
  `${consumerRoot}:/work:ro`,
  "-w",
  "/work",
  "node:24.18.0-bookworm-slim",
  "node",
  "identity-regression.mjs",
]);
requireStatus(docker, 0, "Linux prospective identity regression");
const dockerVerify = execute("docker", [
  "run",
  "--rm",
  "--network",
  "none",
  "--read-only",
  "--tmpfs",
  "/tmp:rw,noexec,nosuid,size=16m",
  "-v",
  `${consumerRoot}:/work:ro`,
  "-w",
  "/work",
  "node:24.18.0-bookworm-slim",
  "node",
  "node_modules/@nicia-ai/lachesis-cli/dist/cli.js",
  "report",
  "verify",
  "--input",
  "structural-exact.json",
  "--report",
  "-",
]);
requireStatus(dockerVerify, 0, "Linux detached verification");

const generatorPath = resolve(
  await realpath(resolve(consumerRoot, "node_modules/@nicia-ai/lachesis-cli")),
  "../lachesis-generator",
);
const disabledGenerator = `${generatorPath}.m8b2a-disabled`;
await rename(generatorPath, disabledGenerator);
for (const [label, args] of [
  [
    "manifest lazy load",
    [
      "catalog",
      "manifest",
      "--catalog",
      "./catalog.mjs#catalog",
      "--policy",
      "./catalog.mjs#policy",
      "--check",
      "--report",
      "-",
    ],
  ],
  [
    "structural lazy load",
    [
      "catalog",
      "compare",
      "--left-catalog",
      "./catalog.mjs#catalog",
      "--left-policy",
      "./catalog.mjs#policy",
      "--right-catalog",
      "./right-catalog.mjs#catalog",
      "--right-policy",
      "./right-catalog.mjs#policy",
      "--report",
      "-",
    ],
  ],
  [
    "detached lazy load",
    ["report", "verify", "--input", "structural-exact.json", "--report", "-"],
  ],
])
  invoke(args, 0, label);
await rename(disabledGenerator, generatorPath);

const timingCommands = {
  usage: ["--help"],
  manifest: [
    "catalog",
    "manifest",
    "--catalog",
    "./catalog.mjs#catalog",
    "--policy",
    "./catalog.mjs#policy",
    "--check",
    "--report",
    "-",
  ],
  structural: [
    "catalog",
    "compare",
    "--left-catalog",
    "./catalog.mjs#catalog",
    "--left-policy",
    "./catalog.mjs#policy",
    "--right-catalog",
    "./right-catalog.mjs#catalog",
    "--right-policy",
    "./right-catalog.mjs#policy",
    "--report",
    "-",
  ],
  detached: [
    "report",
    "verify",
    "--input",
    "structural-exact.json",
    "--report",
    "-",
  ],
  suite: [
    "catalog",
    "compare",
    "--left-catalog",
    "./catalog.mjs#catalog",
    "--left-policy",
    "./catalog.mjs#policy",
    "--right-catalog",
    "./right-catalog.mjs#catalog",
    "--right-policy",
    "./right-catalog.mjs#policy",
    "--suite",
    "./suite.mjs#exact",
    "--conformance-out",
    "timing-native.json",
    "--report",
    "timing-report.json",
    "--replace",
  ],
};
const timings = {};
for (const [name, args] of Object.entries(timingCommands)) {
  const first = execute(nodeBinary, [cli, ...args], {
    cwd: consumerRoot,
    env: offlineEnv,
  });
  requireStatus(first, name === "usage" ? 2 : 0, `${name} first timing`);
  const repeated = [];
  for (let index = 0; index < 7; index += 1) {
    const sample = execute(nodeBinary, [cli, ...args], {
      cwd: consumerRoot,
      env: offlineEnv,
    });
    requireStatus(sample, name === "usage" ? 2 : 0, `${name} timing`);
    repeated.push(sample.durationMs);
  }
  timings[name] = {
    firstProcessMs: Number(first.durationMs.toFixed(3)),
    repeated: measurement(repeated),
  };
}

const inventory = {
  protocol: "lachesis.m8b2a.prospective-artifacts.v1",
  sourceCommit: SOURCE_COMMIT,
  packages: packageRecords.map((item) => ({
    name: item.name,
    version: item.version,
    tarball: item.tarball,
    sha256: item.sha256,
    bytes: item.bytes,
    payloadContentRootSha256: item.payloadContentRootSha256,
    fileInventory: item.fileInventory,
    attempts: item.attempts,
  })),
  installedIntegrity,
  dependencyGraph: {
    packages: [...origins.entries()]
      .map(([identity, origin]) => ({ identity, origin }))
      .toSorted((left, right) => left.identity.localeCompare(right.identity)),
    edges: [...edges].toSorted(),
    lockfileSha256: await sha256(encoder.encode(lockfile)),
    allProspectivePackagesInstalledFromLocalTarballs: true,
    registryAlpha3Fallbacks: 0,
  },
  licenses: sanitizedLicenses,
  leakage: {
    scannedCommandReports: true,
    scannedProspectivePackagePayloads: true,
    findings: leakageFindings,
  },
};
const report = {
  protocol: "lachesis.m8b2a.registry-consumer.v1",
  sourceCommit: SOURCE_COMMIT,
  prospectiveReleaseVerification: {
    packageArtifacts: packageRecords.length,
    packsPerArtifact: 3,
    cleanHostConsumers: 2,
    byteIdenticalCrossConsumerReports: true,
    host: "pass",
    linuxNetworkNone: "pass",
    strictTypeScript: "pass",
    workflowExits: [0, 10, 11, 12, 13, 20, 22, 23],
    detachedTamperVerification: "pass",
    symlinkAliasOversizeAndStaleTempRejection: "pass",
    packageLeakageAudit: "pass",
    hostileIdentityRegression: parseJsonValue(
      identityRegression.stdout,
      "identity regression",
    ),
    providerCalls: 0,
  },
  backwardCompatibilityOnly: {
    prospectiveCliWithPublishedAlpha3Dependencies: "pass",
    prospectiveReleaseEvidence: false,
  },
  decision: "technical-pass",
};
const performance = {
  protocol: "lachesis.m8b2a.performance.v1",
  nonContractual: true,
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    pnpm: pnpmVersion,
    samplesPerRepeatedPath: 7,
  },
  install: {
    prospectiveFirstMs: Number(prospective.installMs.toFixed(3)),
    prospectiveSecondMs: Number(secondProspective.installMs.toFixed(3)),
    alpha3CompatibilityMs: Number(compatibility.installMs.toFixed(3)),
  },
  startup: timings,
};
await mkdir(outputRoot, { recursive: true });
await Promise.all([
  writeJson(resolve(outputRoot, "prospective-artifacts.json"), inventory),
  writeJson(resolve(outputRoot, "registry-consumer.json"), report),
  writeJson(resolve(outputRoot, "performance.json"), performance),
]);
process.stdout.write(
  `${JSON.stringify({
    protocol: "lachesis.m8b2a.audit-run.v1",
    sourceCommit: SOURCE_COMMIT,
    packages: packageRecords.map((item) => ({
      name: item.name,
      sha256: item.sha256,
    })),
    dependencyFallbacks: 0,
    status: "pass",
  })}\n`,
);
await rm(scratch, { recursive: true, force: true });
