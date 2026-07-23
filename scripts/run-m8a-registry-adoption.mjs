import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "fixtures", "m8a-registry-consumer");
const temporaryRoot = await mkdtemp("/tmp/lachesis-m8a-registry-");
const consumer = join(temporaryRoot, "consumer");
const npmCache = join(temporaryRoot, "npm-cache");
const consumerHome = join(temporaryRoot, "home");
const npmCli = resolve(
  dirname(process.execPath),
  "..",
  "lib",
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js",
);
const safePath = `${dirname(process.execPath)}:/usr/bin:/bin`;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function run(command, arguments_, options = {}) {
  const started = performance.now();
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd ?? consumer,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolveResult({ code, stdout, stderr });
    });
  });
  if (result.code !== 0) {
    throw new Error(
      `${command} ${arguments_.join(" ")} failed (${String(result.code)}).\n${result.stdout}\n${result.stderr}`,
    );
  }
  return { ...result, durationMs: Math.round(performance.now() - started) };
}

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function directoryBytes(path) {
  const files = await walk(path);
  const sizes = await Promise.all(
    files.map(async (file) => (await stat(file)).size),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await cp(fixture, consumer, {
    recursive: true,
    filter: (source) =>
      !["node_modules", "dist", "reports", "worker-dist"].includes(
        source.split("/").at(-1),
      ),
  });
  const baseEnvironment = {
    CI: "1",
    HOME: consumerHome,
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    PATH: safePath,
    TMPDIR: temporaryRoot,
    WRANGLER_SEND_METRICS: "false",
    npm_config_cache: npmCache,
    npm_config_ignore_scripts: "true",
    npm_config_registry: "https://registry.npmjs.org/",
  };
  await run("git", ["init", "--quiet"], {
    cwd: consumer,
    env: baseEnvironment,
  });
  const install = await run(
    process.execPath,
    [
      npmCli,
      "ci",
      "--ignore-scripts",
      "--registry=https://registry.npmjs.org/",
    ],
    { env: baseEnvironment },
  );

  const lockText = await readFile(join(consumer, "package-lock.json"), "utf8");
  const packageText = await readFile(join(consumer, "package.json"), "utf8");
  const sources = await walk(join(consumer, "src"));
  const sourceText = (
    await Promise.all(sources.map((source) => readFile(source, "utf8")))
  ).join("\n");
  assert(
    !lockText.includes("workspace:"),
    "The lockfile contains a workspace dependency.",
  );
  assert(
    !lockText.includes('"file:'),
    "The lockfile contains a file dependency.",
  );
  assert(
    !sourceText.includes("../packages/") &&
      !sourceText.includes("../../packages/"),
    "The consumer imports repository source.",
  );
  for (const forbidden of [
    "@nicia-ai/lachesis-benchmark",
    "@nicia-ai/lachesis-generator-ai-sdk",
    "@nicia-ai/lachesis-evidence-typegraph",
    "@nicia-ai/typegraph",
    "better-sqlite3",
    "drizzle-orm",
  ]) {
    assert(
      !lockText.includes(`node_modules/${forbidden}`),
      `Unexpected package: ${forbidden}`,
    );
  }
  assert(
    !sourceText.includes(" as unknown as "),
    "Unsafe double assertion found.",
  );
  assert(
    !sourceText.includes("skipLibCheck: true"),
    "skipLibCheck was relaxed.",
  );
  assert(
    !packageText.includes("workspace:"),
    "The package manifest contains a workspace dependency.",
  );

  const sandboxProfile = [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    "",
  ].join("\n");
  const sandboxPath = join(temporaryRoot, "network-denied.sb");
  await writeFile(sandboxPath, sandboxProfile, "utf8");
  const offline = async (script) =>
    run(
      "/usr/bin/sandbox-exec",
      ["-f", sandboxPath, process.execPath, npmCli, "run", script],
      { env: baseEnvironment },
    );
  const first = await offline("verify");
  const reportPath = join(consumer, "reports", "m8a-adoption-report.json");
  const diagnosticPath = join(consumer, "reports", "m8a-diagnostics.md");
  const firstReport = await readFile(reportPath);
  const firstDiagnostic = await readFile(diagnosticPath);
  const second = await offline("verify");
  const secondReport = await readFile(reportPath);
  const secondDiagnostic = await readFile(diagnosticPath);
  assert(
    firstReport.equals(secondReport),
    "JSON report was not byte-identical.",
  );
  assert(
    firstDiagnostic.equals(secondDiagnostic),
    "Human diagnostics were not byte-identical.",
  );
  const workers = await offline("workers:dry-run");
  const reportModule = await import(pathToFileURL(reportPath).href, {
    with: { type: "json" },
  });
  const report = reportModule.default;
  assert(report.registryOnly === true, "Registry-only report flag is false.");
  assert(report.providerCalls === 0, "Provider calls were reported.");
  assert(report.compile.valid === true, "The valid plan did not compile.");
  assert(
    report.runtime.replay.additionalEffectInvocations === 0,
    "Replay invoked an effect.",
  );
  assert(report.runtime.citations.length > 0, "No citations were produced.");
  assert(
    report.runtime.provenance.links.length > 0,
    "No provenance links were produced.",
  );
  const negativeCodes = report.compile.negatives.map((entry) => entry.code);
  assert(
    JSON.stringify(negativeCodes) ===
      JSON.stringify([
        "BRANCH_TYPE_MISMATCH",
        "SEMANTIC_OBLIGATION_FAILED",
        "DENIED_CAPABILITY",
        "BUDGET_EXCEEDED",
      ]),
    "A compile rejection was misclassified.",
  );
  for (const rejection of report.compile.negatives) {
    assert(
      Object.hasOwn(rejection, "location") &&
        typeof rejection.localization.operation === "string" &&
        rejection.localization.operation.length > 0 &&
        typeof rejection.localization.role === "string" &&
        rejection.localization.role.length > 0 &&
        typeof rejection.localization.boundary === "string" &&
        rejection.localization.boundary.length > 0 &&
        typeof rejection.guidance === "string" &&
        rejection.guidance.length > 0,
      `Rejection ${rejection.caseId} lacks localization or guidance.`,
    );
  }
  assert(
    report.evolution.declarationRepairable.classification ===
      "declaration-repairable",
    "Declaration repair was misclassified.",
  );
  assert(
    report.evolution.genuinelyNonEquivalent.action.kind === "do-not-substitute",
    "Genuine non-equivalence lacks do-not-substitute guidance.",
  );

  const authoredFiles = [
    ...(await walk(join(consumer, "src"))),
    join(consumer, "package.json"),
    join(consumer, "tsconfig.json"),
    join(consumer, "tsconfig.build.json"),
    join(consumer, "wrangler.jsonc"),
  ];
  const lineCounts = await Promise.all(
    authoredFiles.map(
      async (file) => (await readFile(file, "utf8")).split("\n").length,
    ),
  );
  const imports = [
    ...new Set(
      [...sourceText.matchAll(/from "(@nicia-ai\/[^"]+)"/g)].map(
        (match) => match[1],
      ),
    ),
  ].sort();
  const measurement = {
    protocol: "lachesis-m8a-black-box-adoption/1",
    node: process.version,
    installSource: "https://registry.npmjs.org/",
    networkAfterInstall: "denied-by-sandbox",
    coldInstallMs: install.durationMs,
    firstWorkflowMs: first.durationMs,
    repeatedWorkflowMs: second.durationMs,
    workersDryRunMs: workers.durationMs,
    commandsRequired: 4,
    authoredFiles: authoredFiles.length,
    authoredLines: lineCounts.reduce((total, lines) => total + lines, 0),
    publicImports: imports,
    installedBytes: await directoryBytes(join(consumer, "node_modules")),
    selectedPackageBytes: await Promise.all(
      [
        "lachesis",
        "lachesis-evidence",
        "lachesis-generator",
        "lachesis-runtime",
      ].map(async (name) => ({
        name: `@nicia-ai/${name}`,
        bytes: await directoryBytes(
          join(consumer, "node_modules", "@nicia-ai", name),
        ),
      })),
    ),
    workerBundleBytes: await directoryBytes(join(consumer, "worker-dist")),
    jsonReportSha256: sha256(secondReport),
    humanReportSha256: sha256(secondDiagnostic),
    deterministicByteIdentity: true,
    negativeDiagnosticCoverage: "6/6",
    selectedLachesisPackages: 4,
    providerCalls: 0,
    result: "pass",
  };
  const outputArgument = process.argv.indexOf("--output");
  if (outputArgument !== -1) {
    const output = process.argv[outputArgument + 1];
    if (output === undefined) throw new Error("--output requires a path.");
    await writeFile(
      resolve(root, output),
      `${JSON.stringify(measurement, null, 2)}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(measurement)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
