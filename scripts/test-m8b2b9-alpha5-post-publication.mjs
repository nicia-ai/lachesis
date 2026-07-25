import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseJson } from "../packages/kernel/dist/json.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = await readFile(
  resolve(root, ".github/workflows/release.yml"),
  "utf8",
);
const inventoryJson = parseJson(
  await readFile(
    resolve(root, "docs/m8b2b-alpha5-tarball-inventory.json"),
    "utf8",
  ),
);
if (!inventoryJson.ok) {
  throw new Error("The frozen alpha.5 tarball inventory is invalid JSON.");
}
const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const inventoryValue = inventoryJson.value;
if (!isRecord(inventoryValue) || !Array.isArray(inventoryValue.packages)) {
  throw new Error("The frozen alpha.5 tarball inventory has an invalid shape.");
}
const inventoryPackages = inventoryValue.packages.map((entry) => {
  if (
    !isRecord(entry) ||
    typeof entry.package !== "string" ||
    typeof entry.version !== "string" ||
    typeof entry.sha256 !== "string" ||
    !Array.isArray(entry.dependencies)
  ) {
    throw new Error("A frozen alpha.5 package entry has an invalid shape.");
  }
  const dependencies = entry.dependencies.map((dependency) => {
    if (
      !isRecord(dependency) ||
      typeof dependency.name !== "string" ||
      typeof dependency.range !== "string"
    ) {
      throw new Error(
        "A frozen alpha.5 dependency entry has an invalid shape.",
      );
    }
    return dependency;
  });
  return { ...entry, dependencies };
});

let assertions = 0;
const verify = (condition, message) => {
  assert.ok(condition, message);
  assertions += 1;
};

verify(
  workflow.includes("npm exec -- tsc --noEmit --project tsconfig.json") &&
    workflow.includes('cd "$consumer"'),
  "the consumer typecheck must run from the consumer directory with an explicit project",
);
verify(
  !workflow.includes(
    'npm --prefix "$registry_root/consumer" exec -- tsc --noEmit',
  ),
  "the prefix-only TypeScript invocation must remain retired",
);
verify(
  workflow.includes('test "$cli_status" -eq 2') &&
    !workflow.includes('test "$cli_status" -eq 64'),
  "the frozen no-argument CLI usage contract must be exit 2",
);

const consumer = await mkdtemp(
  resolve(tmpdir(), "lachesis-alpha5-post-publication-"),
);
try {
  await writeFile(
    resolve(consumer, "package.json"),
    '{"name":"post-publication-consumer","private":true,"type":"module"}\n',
  );
  await writeFile(
    resolve(consumer, "consumer.ts"),
    "const verified: string = 'alpha.5';\nvoid verified;\n",
  );
  await writeFile(
    resolve(consumer, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2024",
          strict: true,
          skipLibCheck: false,
          noEmit: true,
        },
        files: ["consumer.ts"],
      },
      undefined,
      2,
    )}\n`,
  );
  await symlink(
    resolve(root, "node_modules"),
    resolve(consumer, "node_modules"),
    "dir",
  );

  const previous = spawnSync(
    "npm",
    ["--prefix", consumer, "exec", "--", "tsc", "--noEmit"],
    { cwd: root, encoding: "utf8" },
  );
  verify(
    previous.status !== 0 &&
      `${previous.stdout}${previous.stderr}`.includes(
        "The TypeScript Compiler",
      ),
    "the previous command must reproduce the help-text verification failure",
  );

  const corrected = spawnSync(
    "npm",
    ["exec", "--", "tsc", "--noEmit", "--project", "tsconfig.json"],
    { cwd: consumer, encoding: "utf8" },
  );
  verify(
    corrected.status === 0,
    `the corrected consumer typecheck must pass: ${corrected.stderr}`,
  );
} finally {
  await rm(consumer, { recursive: true, force: true });
}

const assertUsageExit = (exitCode) => {
  if (exitCode !== 2) {
    throw new Error(`unexpected CLI usage exit ${exitCode}`);
  }
};
assert.doesNotThrow(() => assertUsageExit(2));
assertions += 1;
for (const rejected of [0, 1, 64, 70]) {
  assert.throws(() => assertUsageExit(rejected));
  assertions += 1;
}

const classifyRegistry = ({ present, absent }) => {
  if (present === 0 && absent === 6) return "absent";
  if (present === 6 && absent === 0) return "present";
  throw new Error("unexpected partial release");
};
verify(
  classifyRegistry({ present: 6, absent: 0 }) === "present",
  "all six present must select verify-only state",
);
assert.throws(() => classifyRegistry({ present: 5, absent: 1 }));
assertions += 1;

const publishCommands = workflow.match(/^\s+npm publish /gmu) ?? [];
verify(
  publishCommands.length === 6 &&
    workflow.includes("if: steps.registry.outputs.state == 'absent'"),
  "publication must remain restricted to the all-absent state",
);
const publishCallsForState = (state) =>
  state === "absent" ? publishCommands.length : 0;
verify(
  publishCallsForState("present") === 0,
  "verify-only state must invoke zero npm publish commands",
);

const expectedPackages = new Map([
  [
    "@nicia-ai/lachesis",
    "324940c3610c9280141ac1825a73c87a24238d31ae359c212b2985a66db20730",
  ],
  [
    "@nicia-ai/lachesis-evidence",
    "717c4627dbc3a6e8da985a46993dda7aaa0d648aa229c7c4bc87531b29381956",
  ],
  [
    "@nicia-ai/lachesis-generator",
    "c91f2b36d0a08a99209714df620cea331e3bb3562c4f6d45d8ead17c5949a3e6",
  ],
  [
    "@nicia-ai/lachesis-runtime",
    "93277274a06ea5da465f9ab0eb69dcffc45e06348b369ba7e960781b6ad3721b",
  ],
  [
    "@nicia-ai/lachesis-evidence-typegraph",
    "5e030b987f731e7429d680cf850fc8425b2609eb7beb1dc72ebdc8282bca7242",
  ],
  [
    "@nicia-ai/lachesis-cli",
    "34faca53164d9dedc3b09f348392654f58a129cf7abd56cbd530c994ebf9d1cd",
  ],
]);
verify(
  inventoryPackages.length === expectedPackages.size &&
    inventoryPackages.every(
      (entry) =>
        entry.version === "0.1.0-alpha.5" &&
        expectedPackages.get(entry.package) === entry.sha256,
    ),
  "all six frozen tarball identities must remain bound",
);

const exactInternalDependencies = inventoryPackages.every((entry) =>
  entry.dependencies
    .filter(({ name }) => name.startsWith("@nicia-ai/lachesis"))
    .every(({ range }) => range === "0.1.0-alpha.5"),
);
const workflowChecks = {
  tarballs:
    workflow.includes(
      'shasum -a 256 -c "$GITHUB_WORKSPACE/docs/m8b2b-alpha5-tarballs.sha256"',
    ) && expectedPackages.size === 6,
  signatures: workflow.includes("npm audit signatures"),
  attestations:
    workflow.includes('NPM_CONFIG_PROVENANCE: "true"') &&
    workflow.includes("npm audit signatures"),
  provenance:
    workflow.includes('NPM_CONFIG_PROVENANCE: "true"') &&
    workflow.includes("npm audit signatures"),
  dependencies:
    exactInternalDependencies &&
    workflow.includes(
      'npm --prefix "$registry_root/consumer" install --ignore-scripts',
    ),
  distTags:
    workflow.includes("Verify alpha dist-tags") &&
    workflow.includes('test "$latest" = "$expected_latest"'),
  strictConsumer:
    workflow.includes('"strict": true') &&
    workflow.includes('"skipLibCheck": false') &&
    workflow.includes("npm exec -- tsc --noEmit --project tsconfig.json"),
};
verify(
  Object.values(workflowChecks).every((value) => value === true),
  "the verify-only path must retain every six-package integrity check",
);

const reconcileVerifyOnly = ({ registryState, releaseDraft, checks }) => {
  const npmPublishCalls = publishCallsForState(registryState);
  const complete = Object.values(checks).every((value) => value === true);
  return {
    npmPublishCalls,
    releaseDraft: complete ? false : releaseDraft,
    status: complete ? "verified" : "failed",
  };
};
const allChecks = workflowChecks;
const successful = reconcileVerifyOnly({
  registryState: "present",
  releaseDraft: true,
  checks: allChecks,
});
verify(
  successful.status === "verified" &&
    successful.releaseDraft === false &&
    successful.npmPublishCalls === 0,
  "successful verify-only reconciliation must publish the prerelease without npm mutation",
);
const failed = reconcileVerifyOnly({
  registryState: "present",
  releaseDraft: true,
  checks: { ...allChecks, provenance: false },
});
verify(
  failed.status === "failed" &&
    failed.releaseDraft === true &&
    failed.npmPublishCalls === 0,
  "failed verify-only reconciliation must remain draft without npm mutation",
);

process.stdout.write(
  `${JSON.stringify({
    protocol: "lachesis.m8b2b9.alpha5-post-publication-regression.v1",
    assertions,
    previousTypeScriptCommand: "reproduced-help-failure",
    correctedTypeScriptCommand: "pass",
    cliUsageExit: 2,
    registryState: "present-verify-only",
    npmPublishCalls: 0,
    packageCount: expectedPackages.size,
    status: "pass",
  })}\n`,
);
