import { spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { release, tmpdir } from "node:os";
import { basename, resolve } from "node:path";

import { format as formatText } from "prettier";

import { parseJson } from "../packages/kernel/dist/json.js";

const BASELINE = "0e76d35a6f9f397f0ed235ab12efe7b02f940a0c";
const repositoryRoot = resolve(import.meta.dirname, "..");
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || process.argv[outputIndex + 1] === undefined)
  throw new Error("Usage: run-m8b1-stage6-registry-audit.mjs --output <path>");
const outputRoot = resolve(repositoryRoot, process.argv[outputIndex + 1]);
const scratch = await mkdtemp(resolve(tmpdir(), "lachesis-stage6-"));
const encoder = new TextEncoder();

function execute(command, args, options = {}) {
  const started = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? scratch,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return {
    status: result.status ?? 70,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs,
  };
}

function requireStatus(result, expected, label) {
  if (result.status !== expected)
    throw new Error(
      `${label}: expected ${expected}, got ${result.status}: ${result.stderr}`,
    );
}

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
  throw new Error("Audit canonicalizer received unsupported data.");
}

async function redigest(report) {
  const body = { ...report };
  delete body.reportDigest;
  return {
    ...body,
    reportDigest: await sha256(encoder.encode(canonical(body))),
  };
}

function parseJsonValue(text, label) {
  const parsed = parseJson(text);
  if (!parsed.ok) throw new Error(`${label}: ${parsed.error.message}`);
  return parsed.value;
}

async function writeJson(path, value) {
  await writeFile(
    path,
    await formatText(JSON.stringify(value), { parser: "json" }),
  );
}

async function directoryBytes(path) {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) total += await directoryBytes(child);
    else if (entry.isFile()) total += (await stat(child)).size;
  }
  return total;
}

function median(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function mad(values) {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

function measurement(values) {
  return {
    samples: values.length,
    medianMs: Number(median(values).toFixed(3)),
    medianAbsoluteDeviationMs: Number(mad(values).toFixed(3)),
    minimumMs: Number(Math.min(...values).toFixed(3)),
    maximumMs: Number(Math.max(...values).toFixed(3)),
  };
}

const catalogSource = `
import {
  catalogSemanticRolesSchema,
  createCatalog,
  defineFunction,
  defineSchema
} from "@nicia-ai/lachesis";
import { z } from "zod";

const number = defineSchema({
  id: "stage6/incident-severity",
  version: "1",
  description: "A bounded incident severity.",
  validator: z.number().int().min(0).max(10)
});

function makeCatalog(variant) {
  const operation = defineFunction({
    id: "stage6/normalize-severity",
    version: "1",
    description: "Normalize an incident severity.",
    input: number,
    output: number,
    implementation(value) {
      return variant === "genuine" ? Math.min(10, value + 1) : value;
    }
  });
  const roleVersion = variant === "repairable" ? "2" : "1";
  const semanticRoles = catalogSemanticRolesSchema.parse({
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [{
      kind: "schema",
      role: { id: "stage6.role/severity", version: roleVersion },
      schema: { id: number.id, version: number.version },
      obligations: { mutuallyAcceptsConformanceValues: true }
    }],
    operations: [{
      kind: "function",
      role: { id: "stage6.role/normalize", version: roleVersion },
      operation: { id: operation.id, version: operation.version },
      obligations: {
        deterministic: true,
        totalOnConformanceValues: true,
        pointwiseEquivalent: true
      }
    }]
  });
  const result = createCatalog({
    identity: { id: "stage6/incident-" + variant, version: "1" },
    schemas: [number.runtime],
    operations: [operation],
    semanticRoles
  });
  if (!result.ok) throw new Error("catalog fixture failed");
  return result.value;
}

export const catalog = makeCatalog("same");
export const review = makeCatalog("review");
export const repairable = makeCatalog("repairable");
export const genuine = makeCatalog("genuine");
export const policy = {
  allowedCapabilities: [],
  budget: {
    maxEffectCalls: 0,
    maxCollectionItems: 10,
    maxRecursionDepth: 0,
    maxTokens: 0,
    maxWallClockMs: 100,
    maxParallelism: 1
  }
};
export const changedPolicy = {
  ...policy,
  budget: { ...policy.budget, maxWallClockMs: 99 }
};
`;

const suiteSource = `
const schema = {
  kind: "schema",
  role: { id: "stage6.role/severity", version: "1" },
  values: [0, 1, 5]
};
const operation = {
  kind: "function",
  role: { id: "stage6.role/normalize", version: "1" },
  inputs: [0, 1, 5]
};
export const exact = {
  protocol: "lachesis-cross-catalog-conformance-suite/1",
  fixtures: [schema, operation]
};
export const incomplete = {
  protocol: "lachesis-cross-catalog-conformance-suite/1",
  fixtures: [schema]
};
`;

const nodeBinary = process.execPath;
const nodeVersion = process.version;
const pnpmVersion = execute("pnpm", ["--version"], {
  cwd: repositoryRoot,
}).stdout.trim();
const head = execute("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
}).stdout.trim();
if (head !== BASELINE) throw new Error(`Expected ${BASELINE}; found ${head}.`);
const cliDiff = execute("git", ["diff", "--exit-code", "--", "apps/cli"], {
  cwd: repositoryRoot,
});
requireStatus(cliDiff, 0, "CLI baseline diff");

const packRecords = [];
for (let index = 1; index <= 3; index += 1) {
  const destination = resolve(scratch, `pack-${index}`);
  await mkdir(destination);
  const packed = execute(
    "pnpm",
    [
      "--filter",
      "@nicia-ai/lachesis-cli",
      "pack",
      "--pack-destination",
      destination,
    ],
    { cwd: repositoryRoot },
  );
  requireStatus(packed, 0, `pack ${index}`);
  const tarball = resolve(destination, "nicia-ai-lachesis-cli-0.1.0.tgz");
  const bytes = await readFile(tarball);
  packRecords.push({
    attempt: index,
    path: tarball,
    sha256: await sha256(bytes),
    bytes: bytes.byteLength,
  });
}

const canonicalTarball = packRecords[0].path;
const extracted = resolve(scratch, "extracted");
await mkdir(extracted);
requireStatus(
  execute("tar", ["-xzf", canonicalTarball, "-C", extracted]),
  0,
  "tar extract",
);
const packedRoot = resolve(extracted, "package");
const packedManifest = parseJsonValue(
  await readFile(resolve(packedRoot, "package.json"), "utf8"),
  "packed manifest",
);
const packedFiles = execute("tar", ["-tzf", canonicalTarball])
  .stdout.trim()
  .split("\n");
const packedCli = await lstat(resolve(packedRoot, "dist/cli.js"));
const cliBytes = await readFile(resolve(packedRoot, "dist/cli.js"));
const readme = await readFile(resolve(packedRoot, "README.md"), "utf8");

async function prepareConsumer(name) {
  const root = resolve(scratch, name);
  await mkdir(root);
  const localTarball = resolve(root, basename(canonicalTarball));
  await cp(canonicalTarball, localTarball);
  await writeJson(resolve(root, "package.json"), {
    name,
    private: true,
    type: "module",
    packageManager: `pnpm@${pnpmVersion}`,
    dependencies: {
      "@nicia-ai/lachesis-cli": `file:./${basename(localTarball)}`,
      "@nicia-ai/lachesis": "0.1.0-alpha.3",
      zod: "4.4.3",
    },
    devDependencies: {
      "@types/node": "24.13.3",
      typescript: "6.0.3",
    },
  });
  await writeFile(resolve(root, "catalog.mjs"), catalogSource);
  await writeFile(resolve(root, "right-catalog.mjs"), catalogSource);
  await writeFile(resolve(root, "suite.mjs"), suiteSource);
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
    'import type { Catalog, CompilationPolicy } from "@nicia-ai/lachesis";\nexport type ExternalFixture = readonly [Catalog, CompilationPolicy];\n',
  );
  await writeFile(
    resolve(root, "network-deny.cjs"),
    `"use strict";
const deny = () => { throw new Error("stage6-network-denied"); };
for (const name of ["node:http", "node:https", "node:net", "node:tls", "node:dns"]) {
  const module = require(name);
  for (const key of ["connect", "createConnection", "request", "get", "lookup", "resolve"])
    if (typeof module[key] === "function") module[key] = deny;
}
`,
  );
  const installed = execute(
    "pnpm",
    ["install", "--ignore-scripts", "--config.confirmModulesPurge=false"],
    { cwd: root },
  );
  requireStatus(installed, 0, `${name} install`);
  return { root, installMs: installed.durationMs };
}

const firstConsumer = await prepareConsumer("consumer-one");
const secondConsumer = await prepareConsumer("consumer-two");
const consumerRoot = firstConsumer.root;
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

function invoke(args, expected, label, root = consumerRoot) {
  const result = execute(nodeBinary, [cli, ...args], {
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
  "strict TypeScript consumer",
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
const reorderedManifestCheck = invoke(
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
if (manifestCheck.stdout !== reorderedManifestCheck.stdout)
  throw new Error("Manifest check report is not flag-order deterministic.");

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
  "manifest out",
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
    "manifest-verify-report.json",
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
    "manifest-report-duplicate.json",
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
  "invalid catalog export",
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
  "source identity mismatch",
);
await writeFile(resolve(consumerRoot, "catalog.mjs"), originalCatalog);

function structural(rightExport, rightPolicy, report, expected) {
  return invoke(
    [
      "catalog",
      "compare",
      "--left-catalog",
      "./catalog.mjs#catalog",
      "--left-policy",
      "./catalog.mjs#policy",
      "--right-catalog",
      `./right-catalog.mjs#${rightExport}`,
      "--right-policy",
      `./right-catalog.mjs#${rightPolicy}`,
      "--report",
      report,
    ],
    expected,
    `structural ${report}`,
  );
}
structural("catalog", "policy", "structural-identical.json", 0);
structural("review", "policy", "structural-review.json", 10);
structural("catalog", "changedPolicy", "structural-policy-review.json", 10);

function semantic(rightExport, rightPolicy, suite, stem, expected) {
  const result = invoke(
    [
      "catalog",
      "compare",
      "--left-catalog",
      "./catalog.mjs#catalog",
      "--left-policy",
      "./catalog.mjs#policy",
      "--right-catalog",
      `./right-catalog.mjs#${rightExport}`,
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
  return result;
}
semantic("catalog", "policy", "exact", "semantic-conformant", 0);
semantic("repairable", "policy", "exact", "semantic-repairable", 11);
semantic("genuine", "policy", "exact", "semantic-genuine", 12);
semantic("catalog", "policy", "incomplete", "semantic-insufficient", 13);
semantic("catalog", "changedPolicy", "exact", "semantic-policy-review", 10);

for (const stem of [
  "semantic-repairable",
  "semantic-genuine",
  "semantic-insufficient",
])
  try {
    await lstat(resolve(consumerRoot, `${stem}-native.json`));
    throw new Error(`${stem} unexpectedly produced a conformance artifact.`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }

const verificationCases = [
  {
    report: "manifest-report.json",
    artifacts: ["catalog-manifest=manifest.json"],
  },
  { report: "structural-identical.json", artifacts: [] },
  { report: "structural-review.json", artifacts: [] },
  {
    report: "semantic-conformant-report.json",
    artifacts: ["native-conformance-report=semantic-conformant-native.json"],
  },
  { report: "semantic-repairable-report.json", artifacts: [] },
  { report: "semantic-genuine-report.json", artifacts: [] },
  { report: "semantic-insufficient-report.json", artifacts: [] },
  {
    report: "semantic-policy-review-report.json",
    artifacts: ["native-conformance-report=semantic-policy-review-native.json"],
  },
];
for (const item of verificationCases) {
  const args = ["report", "verify", "--input", item.report];
  for (const artifact of item.artifacts) args.push("--artifact", artifact);
  args.push("--report", "-");
  invoke(args, 0, `detached ${item.report}`);
}
invoke(
  ["report", "verify", "--input", "manifest-report.json", "--report", "-"],
  23,
  "missing artifact",
);
invoke(
  [
    "report",
    "verify",
    "--input",
    "structural-identical.json",
    "--artifact",
    "unexpected=manifest.json",
    "--report",
    "-",
  ],
  22,
  "unexpected artifact",
);

const structuralReport = parseJsonValue(
  await readFile(resolve(consumerRoot, "structural-identical.json"), "utf8"),
  "structural report",
);
const identityTamper = await redigest({
  ...structuralReport,
  command: {
    ...structuralReport.command,
    commandIdentity: "0".repeat(64),
  },
});
const summaryTamper = {
  ...structuralReport,
  summary: { ...structuralReport.summary, migrationRecords: 999 },
};
const exitTamper = { ...structuralReport, outcomeExitCode: 10 };
const completenessTamper = { ...structuralReport, completeness: "partial" };
await Promise.all([
  writeJson(resolve(consumerRoot, "tamper-command.json"), identityTamper),
  writeJson(resolve(consumerRoot, "tamper-summary.json"), summaryTamper),
  writeJson(resolve(consumerRoot, "tamper-exit.json"), exitTamper),
  writeJson(
    resolve(consumerRoot, "tamper-completeness.json"),
    completenessTamper,
  ),
]);
for (const name of [
  "tamper-command.json",
  "tamper-summary.json",
  "tamper-exit.json",
  "tamper-completeness.json",
])
  invoke(["report", "verify", "--input", name, "--report", "-"], 22, name);

const conformantReport = parseJsonValue(
  await readFile(
    resolve(consumerRoot, "semantic-conformant-report.json"),
    "utf8",
  ),
  "conformant report",
);
const semanticArtifact = conformantReport.artifacts[0];
if (semanticArtifact === undefined)
  throw new Error("Missing native conformance artifact binding.");
const semanticDigestTamper = await redigest({
  ...conformantReport,
  artifacts: [{ ...semanticArtifact, digest: "0".repeat(64) }],
});
await writeJson(
  resolve(consumerRoot, "tamper-semantic-digest.json"),
  semanticDigestTamper,
);
invoke(
  [
    "report",
    "verify",
    "--input",
    "tamper-semantic-digest.json",
    "--artifact",
    "native-conformance-report=semantic-conformant-native.json",
    "--report",
    "-",
  ],
  22,
  "semantic digest tamper",
);
const nativeBytes = await readFile(
  resolve(consumerRoot, "semantic-conformant-native.json"),
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
    "semantic-conformant-report.json",
    "--artifact",
    "native-conformance-report=tamper-native.json",
    "--report",
    "-",
  ],
  22,
  "artifact checksum tamper",
);

const nestedTamper = await redigest({
  ...structuralReport,
  command: {
    ...structuralReport.command,
    commandIdentity: "f".repeat(64),
  },
});
const nestedBytes = encoder.encode(`${canonical(nestedTamper)}\n`);
await writeFile(resolve(consumerRoot, "nested-tamper.json"), nestedBytes);
const nestedOuter = await redigest({
  ...structuralReport,
  artifacts: [
    {
      id: "nested-command-report",
      kind: "command-report",
      mediaType: "application/json",
      digest: nestedTamper.reportDigest,
      checksum: {
        algorithm: "sha256",
        value: await sha256(nestedBytes),
      },
    },
  ],
});
await writeJson(resolve(consumerRoot, "nested-outer.json"), nestedOuter);
invoke(
  [
    "report",
    "verify",
    "--input",
    "nested-outer.json",
    "--artifact",
    "nested-command-report=nested-tamper.json",
    "--report",
    "-",
  ],
  22,
  "nested command identity tamper",
);

await writeFile(
  resolve(consumerRoot, "oversized.json"),
  new Uint8Array(16 * 1024 * 1024 + 1),
);
invoke(
  ["report", "verify", "--input", "oversized.json", "--report", "-"],
  23,
  "oversized report",
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
  "normalized alias",
);
await mkdir(resolve(consumerRoot, "stale-report.json.lachesis-tmp"));
invoke(
  [
    "report",
    "verify",
    "--input",
    "structural-identical.json",
    "--report",
    "stale-report.json",
  ],
  23,
  "stale temporary output",
);

const generatorLink = resolve(
  await realpath(resolve(consumerRoot, "node_modules/@nicia-ai/lachesis-cli")),
  "../lachesis-generator",
);
const disabledGenerator = `${generatorLink}.stage6-disabled`;
await rename(generatorLink, disabledGenerator);
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
    "verify lazy load",
    [
      "report",
      "verify",
      "--input",
      "structural-identical.json",
      "--report",
      "-",
    ],
  ],
])
  invoke(args, 0, label);
await rename(disabledGenerator, generatorLink);

const timingCommands = {
  usage: ["--help"],
  manifestCheck: [
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
  structuralCompare: [
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
  detachedVerify: [
    "report",
    "verify",
    "--input",
    "structural-identical.json",
    "--report",
    "-",
  ],
  suiteCompare: [
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
  if (name === "usage") requireStatus(first, 2, "usage timing");
  else requireStatus(first, 0, `${name} first timing`);
  const repeated = [];
  for (let index = 0; index < 7; index += 1) {
    const sample = execute(nodeBinary, [cli, ...args], {
      cwd: consumerRoot,
      env: offlineEnv,
    });
    if (name === "usage") requireStatus(sample, 2, "usage timing sample");
    else requireStatus(sample, 0, `${name} timing sample`);
    repeated.push(sample.durationMs);
  }
  timings[name] = {
    coldFirstProcessMs: Number(first.durationMs.toFixed(3)),
    warmProcesses: measurement(repeated),
  };
}

const listResult = execute("pnpm", ["list", "--json", "--depth", "Infinity"], {
  cwd: consumerRoot,
  env: offlineEnv,
});
requireStatus(listResult, 0, "dependency list");
const dependencyTree = parseJsonValue(listResult.stdout, "dependency tree");
const packageIdentities = new Map();
const dependencyEdges = new Set();
function visitDependency(node, parent, declaredName) {
  if (node === null || typeof node !== "object") return;
  const name = node.name ?? declaredName;
  const version = node.version;
  if (typeof name === "string" && typeof version === "string") {
    const resolution =
      typeof node.resolved === "string"
        ? node.resolved.startsWith("https://registry.npmjs.org/")
          ? node.resolved
          : node.resolved.includes("nicia-ai-lachesis-cli-0.1.0.tgz")
            ? "local-packed-cli-artifact"
            : "unexpected-non-registry-origin"
        : "deduplicated-from-recorded-registry-node";
    const identity = `${name}@${version}`;
    const existing = packageIdentities.get(identity);
    packageIdentities.set(identity, {
      name,
      version,
      origin:
        existing?.origin === undefined ||
        existing.origin === "deduplicated-from-recorded-registry-node"
          ? resolution
          : existing.origin,
    });
    if (parent !== undefined)
      dependencyEdges.add(`${parent}->${name}@${version}`);
    parent = `${name}@${version}`;
  }
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    const children = node[section];
    if (children !== null && typeof children === "object")
      for (const [childName, child] of Object.entries(children))
        visitDependency(child, parent, childName);
  }
}
for (const item of dependencyTree) visitDependency(item, undefined);
const licensesResult = execute("pnpm", ["licenses", "list", "--json"], {
  cwd: consumerRoot,
  env: offlineEnv,
});
requireStatus(licensesResult, 0, "license inventory");
const licenseInventory = parseJsonValue(
  licensesResult.stdout,
  "license inventory",
);
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
const lockfile = await readFile(
  resolve(consumerRoot, "pnpm-lock.yaml"),
  "utf8",
);
const forbiddenResolution = [
  "workspace:",
  "link:",
  "git+",
  "github:",
  "http://",
].filter((token) => lockfile.includes(token));
const fileResolutions = lockfile
  .split("\n")
  .filter(
    (line) =>
      line.includes("file:") && !line.includes("excludeLinksFromLockfile"),
  );
if (
  forbiddenResolution.length > 0 ||
  fileResolutions.some(
    (line) => !line.includes("nicia-ai-lachesis-cli-0.1.0.tgz"),
  )
)
  throw new Error("Unexpected non-registry dependency resolution.");
const lockIntegrities = lockfile
  .matchAll(/integrity:\s*([^,}\s]+)/g)
  .map((match) => match[1])
  .toArray();

const reports = (await readdir(consumerRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => entry.name);
const leakageNeedles = [
  repositoryRoot,
  scratch,
  process.env.HOME ?? "",
  "workspace:",
  "link:",
  "npm.pkg.github.com",
  "@nicia-ai/lachesis-benchmark",
  "@nicia-ai/lachesis-generator-ai-sdk",
  "_authToken",
  "OPENAI_API_KEY",
].filter((needle) => needle.length > 0);
const leakageFindings = [];
for (const name of reports) {
  const text = await readFile(resolve(consumerRoot, name), "utf8");
  for (const needle of leakageNeedles)
    if (text.includes(needle)) leakageFindings.push({ file: name, needle });
}
const scannedTarballFiles = [];
for (const packedName of packedFiles) {
  const relativeName = packedName.replace(/^package\//, "");
  const packedPath = resolve(packedRoot, relativeName);
  const packedEntry = await lstat(packedPath);
  if (!packedEntry.isFile()) continue;
  const bytes = await readFile(packedPath);
  scannedTarballFiles.push(relativeName);
  const text = new TextDecoder().decode(bytes);
  for (const needle of leakageNeedles)
    if (text.includes(needle))
      leakageFindings.push({ file: relativeName, needle });
}
if (leakageFindings.length > 0)
  throw new Error(`Leakage findings: ${JSON.stringify(leakageFindings)}`);

const cjsProbe = execute(
  nodeBinary,
  ["-e", 'require("@nicia-ai/lachesis-cli")'],
  {
    cwd: consumerRoot,
    env: offlineEnv,
  },
);
if (cjsProbe.status === 0)
  throw new Error("CommonJS unexpectedly loaded the ESM-only CLI package.");

const secondCli = resolve(
  secondConsumer.root,
  "node_modules/@nicia-ai/lachesis-cli/dist/cli.js",
);
const secondNetworkDeny = resolve(secondConsumer.root, "network-deny.cjs");
const secondRun = execute(
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
  {
    cwd: secondConsumer.root,
    env: {
      ...offlineEnv,
      NODE_OPTIONS: `--require=${secondNetworkDeny}`,
    },
  },
);
requireStatus(secondRun, 0, "second clean consumer");
if (secondRun.stdout !== manifestCheck.stdout)
  throw new Error("Second clean consumer report is not byte-identical.");

const dockerInspect = execute(
  "docker",
  ["image", "inspect", "node:24.18.0-bookworm-slim"],
  { cwd: consumerRoot },
);
if (dockerInspect.status !== 0) {
  const pull = execute("docker", ["pull", "node:24.18.0-bookworm-slim"], {
    cwd: consumerRoot,
  });
  requireStatus(pull, 0, "Linux image pull");
}
const linux = execute(
  "docker",
  [
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
    "structural-identical.json",
    "--report",
    "-",
  ],
  { cwd: consumerRoot },
);
requireStatus(linux, 0, "network-denied Linux detached verification");

const directDependencies = Object.keys(
  packedManifest.dependencies ?? {},
).length;
const installedBytes = await directoryBytes(
  resolve(consumerRoot, "node_modules"),
);
const tarballUnpackedBytes = await directoryBytes(packedRoot);
const uniqueTarballs = new Set(packRecords.map((record) => record.sha256));
const packageInventory = {
  protocol: "lachesis.m8b1.stage6.package-inventory.v1",
  baseline: BASELINE,
  cli: {
    name: packedManifest.name,
    version: packedManifest.version,
    private: packedManifest.private,
    description: packedManifest.description,
    type: packedManifest.type,
    engines: packedManifest.engines,
    bin: packedManifest.bin,
    publishConfig: packedManifest.publishConfig,
    repository: packedManifest.repository,
    dependencies: packedManifest.dependencies,
    files: packedFiles,
    tarballBytes: packRecords[0].bytes,
    unpackedBytes: tarballUnpackedBytes,
    executableMode: (packedCli.mode & 0o777).toString(8),
    shebang: new TextDecoder().decode(cliBytes.subarray(0, 19)),
  },
  graph: {
    scope:
      "Complete installed consumer graph, including CLI runtime dependencies and the strict TypeScript consumer toolchain.",
    directDependencies,
    directDevDependencies: 2,
    uniqueInstalledPackages: packageIdentities.size,
    dependencyEdges: dependencyEdges.size,
    packages: [...packageIdentities.values()].toSorted((left, right) =>
      `${left.name}@${left.version}`.localeCompare(
        `${right.name}@${right.version}`,
      ),
    ),
    edges: [...dependencyEdges].toSorted(),
    lockfileSha256: await sha256(encoder.encode(lockfile)),
    registryIntegrities: [...new Set(lockIntegrities)].toSorted(),
    localArtifactResolution:
      "Only the unpublished CLI tarball is a relative file dependency; every transitive dependency is registry-resolved.",
    forbiddenResolution,
    licenses: sanitizedLicenses,
  },
};

const performance = {
  protocol: "lachesis.m8b1.stage6.performance.v1",
  nonContractual: true,
  environment: {
    platform: process.platform,
    architecture: process.arch,
    osRelease: release(),
    filesystem: "host temporary directory",
    node: nodeVersion,
    pnpm: pnpmVersion,
    measurement:
      "spawnSync wall-clock; first process reported separately; seven subsequent independent processes summarized by median and median absolute deviation",
  },
  install: {
    firstCleanConsumerMs: Number(firstConsumer.installMs.toFixed(3)),
    secondCleanConsumerMs: Number(secondConsumer.installMs.toFixed(3)),
    fullInstalledBytes: installedBytes,
  },
  startup: timings,
  peakRss: {
    measured: false,
    reason:
      "Portable cross-platform peak-RSS capture was not sufficiently reliable for a checksum-bound product claim.",
  },
};

const security = {
  protocol: "lachesis.m8b1.stage6.security.v1",
  network: {
    hostCommands: "Node networking modules intercepted to fail closed",
    linuxCommand: "Docker --network none",
    attemptedProviderAccess: 0,
  },
  leakage: {
    reportsScanned: reports.length,
    tarballFilesScanned: scannedTarballFiles.toSorted(),
    findings: leakageFindings,
  },
  lazyLoading: {
    generatorPackageRemovedDuringManifest: true,
    generatorPackageRemovedDuringStructuralCompare: true,
    generatorPackageRemovedDuringDetachedVerify: true,
    suiteModeWithGeneratorInstalled: true,
  },
  filesystemBoundary: {
    sameUidKernelAtomicIsolationClaimed: false,
    symlinkAliasOversizeStaleTempNoClobber: "pass",
    raceInterruptedReadRollbackPostCommit:
      "covered by private hostile tests in the complete repository matrix",
  },
  credentialsPresent: false,
  sourceCheckoutInConsumer: false,
};

const blockers = [
  ...(uniqueTarballs.size === 1
    ? []
    : [
        "Three consecutive pnpm packs were not byte-identical because workspace dependency keys were emitted in nondeterministic order.",
      ]),
  ...(packedManifest.private === true
    ? ["The packed CLI remains private and cannot be published as-is."]
    : []),
  ...(readme.includes("../../README.md")
    ? [
        "The packed README contains a repository-relative link that is broken for registry consumers.",
      ]
    : []),
  ...(String(packedManifest.description).includes("plan inspector")
    ? [
        "The package description does not describe catalog conformance or detached verification.",
      ]
    : []),
  "The default-parallel repository test command reproducibly times out in the unchanged M2 provider-pool test at five seconds.",
  "The baseline release-checksum audit compares the authorized corrected workflow against its older pre-correction frozen digest and cannot pass.",
];

const consumerReport = {
  protocol: "lachesis.m8b1.stage6.registry-consumer.v1",
  baseline: BASELINE,
  status: "functional-pass-release-blocked",
  consumers: 2,
  environmentIsolation: {
    outsideRepository: true,
    gitMetadata: false,
    workspaceFile: false,
    sourceCheckout: false,
    privatePackageDependency: false,
    absolutePathDependency: false,
    relativeCliTarballException: true,
    strictTypeScript: true,
    skipLibCheck: false,
    hostOfflineAfterInstall: true,
    linuxNetworkNone: true,
  },
  workflow: {
    manifest: {
      check: "pass",
      out: "pass",
      sourceBoundVerify: "pass",
      noClobber: "pass",
      replace: "pass",
      invalid: "pass",
      identityMismatch: "pass",
    },
    compare: {
      structuralExact: 0,
      structuralReview: 10,
      conformant: 0,
      declarationRepairable: 11,
      genuineNonEquivalence: 12,
      insufficientEvidence: 13,
      policyReviewAfterSuite: 10,
      rejectedArtifactAbsence: "pass",
      conformantTwoArtifactVerification: "pass",
    },
    detachedVerify: {
      producedReportKinds: verificationCases.length,
      semanticExitsVerifyAsIntegritySuccess: [10, 11, 12, 13],
      missingArtifact: 23,
      unexpectedArtifact: 22,
      tamperClassesRejected: [
        "command-identity",
        "nested-identity",
        "checksum",
        "semantic-digest",
        "summary",
        "exit",
        "completeness",
        "artifact-set",
      ],
    },
  },
  determinism: {
    repeatedConsumerReportsByteIdentical: true,
    reorderedFlagsByteIdentical: true,
    packAttempts: packRecords.map(({ attempt, sha256: digest, bytes }) => ({
      attempt,
      sha256: digest,
      bytes,
    })),
    tarballsByteIdentical: uniqueTarballs.size === 1,
  },
  linux: {
    image: "node:24.18.0-bookworm-slim",
    network: "none",
    readOnlyRoot: true,
    detachedVerification: "pass",
  },
  decision: "blocked",
  blockers,
};

await mkdir(outputRoot, { recursive: true });
await Promise.all([
  writeJson(
    resolve(outputRoot, "registry-consumer-report.json"),
    consumerReport,
  ),
  writeJson(resolve(outputRoot, "package-inventory.json"), packageInventory),
  writeJson(resolve(outputRoot, "performance.json"), performance),
  writeJson(resolve(outputRoot, "security-leakage-audit.json"), security),
]);
process.stdout.write(
  `${JSON.stringify({
    protocol: "lachesis.m8b1.stage6.audit-run.v1",
    baseline: BASELINE,
    output: process.argv[outputIndex + 1],
    decision: "blocked",
    canonicalTarballSha256: packRecords[0].sha256,
    packDeterministic: uniqueTarballs.size === 1,
    packages: packageIdentities.size,
    dependencyEdges: dependencyEdges.size,
    status: "complete",
  })}\n`,
);

await chmod(outputRoot, 0o755);
await rm(scratch, { recursive: true, force: true });
