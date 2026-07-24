import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { format as formatText } from "prettier";

const repositoryRoot = resolve(import.meta.dirname, "..");
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || process.argv[outputIndex + 1] === undefined)
  throw new Error(
    "Usage: run-m8b2a-default-parallel-stability.mjs --output <file>",
  );
const outputPath = resolve(repositoryRoot, process.argv[outputIndex + 1]);
const runs = 10;

await readFile(resolve(repositoryRoot, "packages/kernel/dist/index.js"));

function execute(command, args) {
  const started = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
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

function withoutAnsi(value) {
  return value.replaceAll(
    new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "gu"),
    "",
  );
}

function parseCount(output, label, exitCode) {
  const match = output.match(
    new RegExp(`${label}\\s+(\\d+) passed(?:\\s*\\((\\d+)\\))?`, "u"),
  );
  if (match === null)
    throw new Error(
      `Could not parse ${label.toLowerCase()} count for exit ${exitCode}: ${output.slice(-2_000)}`,
    );
  return {
    passed: Number(match[1]),
    total: Number(match[2] ?? match[1]),
  };
}

const results = [];
for (let index = 1; index <= runs; index += 1) {
  const result = execute("pnpm", ["exec", "vitest", "run"]);
  const output = withoutAnsi(`${result.stdout}\n${result.stderr}`);
  const testFiles = parseCount(output, "Test Files", result.status);
  const tests = parseCount(output, "Tests", result.status);
  results.push({
    run: index,
    exitCode: result.status,
    durationMs: Number(result.durationMs.toFixed(3)),
    testFiles,
    tests,
  });
  process.stdout.write(
    `M8b.2a default-parallel run ${index}/${runs}: exit=${result.status} tests=${tests.passed}/${tests.total} durationMs=${result.durationMs.toFixed(3)}\n`,
  );
  if (result.status !== 0)
    throw new Error(
      `Default-parallel run ${index} failed with exit ${result.status}.`,
    );
}

const durations = results.map((result) => result.durationMs);
const record = {
  protocol: "lachesis.m8b2a.default-parallel-stability.v1",
  command: "pnpm exec vitest run",
  precondition: "workspace build completed before the ten-run sequence",
  defaultParallelism: true,
  globalTimeoutOrWorkerOverrides: false,
  m2TimeoutChanged: false,
  runsRequired: runs,
  runsPassed: results.length,
  results,
  durationSummaryMs: {
    minimum: Math.min(...durations),
    maximum: Math.max(...durations),
    total: Number(durations.reduce((sum, value) => sum + value, 0).toFixed(3)),
  },
  status: "pass",
};
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(
  outputPath,
  await formatText(JSON.stringify(record), { parser: "json" }),
);
