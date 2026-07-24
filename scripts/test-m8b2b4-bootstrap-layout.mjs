import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_COMMIT = "635521f1d2e753095fca4fdbbafbf7ed2287efe1";
const RELEASE_VERSION = "0.1.0-alpha.4";
const CLI_TARBALL_SHA256 =
  "f9586fd9554fbe78fd88ab28400d2a04fe78792196d17f5d7f74558f33d3e638";

const repositoryRoot = new URL("../", import.meta.url).pathname;
const workflow = await readFile(
  new URL("../.github/workflows/bootstrap-cli.yml", import.meta.url),
  "utf8",
);

const run = async (command, arguments_, options = {}) => {
  await new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} failed with ${signal === null ? `exit ${String(code)}` : `signal ${signal}`}`,
        ),
      );
    });
  });
};

const runFrozenPnpm = async (arguments_, options) =>
  run("corepack", ["pnpm@10.33.0", ...arguments_], options);

const packageManagerAt = async (workspace, relativePath) => {
  const bytes = await readFile(join(workspace, relativePath), "utf8");
  const matches = [
    ...bytes.matchAll(/"packageManager"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g),
  ];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw new Error(
      `${relativePath} does not declare exactly one packageManager`,
    );
  }
  return matches[0][1];
};

const digestFile = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

const sanitizedEnvironment = {
  CI: "true",
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  HOME: process.env.HOME,
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
};

const workspace = await mkdtemp(join(tmpdir(), "lachesis-m8b2b4-layout-"));
try {
  assert.rejects(
    packageManagerAt(workspace, "package.json"),
    /ENOENT/,
    "the pre-correction workspace-root lookup must fail",
  );

  await run(
    "git",
    [
      "clone",
      "--quiet",
      "--no-checkout",
      repositoryRoot,
      join(workspace, "release-source"),
    ],
    { env: sanitizedEnvironment },
  );
  await run("git", ["checkout", "--quiet", "--detach", RELEASE_COMMIT], {
    cwd: join(workspace, "release-source"),
    env: sanitizedEnvironment,
  });
  await run(
    "git",
    [
      "clone",
      "--quiet",
      "--no-checkout",
      repositoryRoot,
      join(workspace, "bootstrap-infrastructure"),
    ],
    { env: sanitizedEnvironment },
  );
  await run("git", ["checkout", "--quiet", "--detach", "HEAD"], {
    cwd: join(workspace, "bootstrap-infrastructure"),
    env: sanitizedEnvironment,
  });

  const packageManager = await packageManagerAt(
    workspace,
    "release-source/package.json",
  );
  assert.equal(packageManager, "pnpm@10.33.0");
  await runFrozenPnpm(["--version"], {
    cwd: workspace,
    env: sanitizedEnvironment,
  });
  await runFrozenPnpm(["install", "--frozen-lockfile"], {
    cwd: join(workspace, "release-source"),
    env: sanitizedEnvironment,
  });
  for (const packageName of [
    "@nicia-ai/lachesis",
    "@nicia-ai/lachesis-evidence",
    "@nicia-ai/lachesis-generator",
    "@nicia-ai/lachesis-runtime",
    "@nicia-ai/lachesis-evidence-typegraph",
    "@nicia-ai/lachesis-cli",
  ]) {
    await runFrozenPnpm(["--filter", packageName, "build"], {
      cwd: join(workspace, "release-source"),
      env: sanitizedEnvironment,
    });
  }

  const verificationEnvironment = {
    ...sanitizedEnvironment,
    LACHESIS_JSON_MODULE: join(
      workspace,
      "release-source/packages/kernel/dist/json.js",
    ),
  };
  await run(
    "node",
    [
      "bootstrap-infrastructure/scripts/verify-cli-bootstrap.mjs",
      "package-set",
      "release-source",
    ],
    { cwd: workspace, env: verificationEnvironment },
  );

  for (const attempt of [1, 2, 3]) {
    const output = join(workspace, `cli-pack-${String(attempt)}`);
    await run(
      "node",
      ["scripts/prepare-alpha4-tarballs.mjs", "--output-dir", output],
      {
        cwd: join(workspace, "release-source"),
        env: sanitizedEnvironment,
      },
    );
    assert.equal(
      await digestFile(
        join(output, `nicia-ai-lachesis-cli-${RELEASE_VERSION}.tgz`),
      ),
      CLI_TARBALL_SHA256,
    );
  }

  process.env.LACHESIS_JSON_MODULE = join(
    workspace,
    "release-source/packages/kernel/dist/json.js",
  );
  const { verifyRegistryAbsent } = await import(
    pathToFileURL(
      join(
        workspace,
        "bootstrap-infrastructure/scripts/verify-cli-bootstrap.mjs",
      ),
    ).href
  );
  const server = createServer((_request, response) => {
    response.writeHead(404, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address !== null && typeof address === "object");
  try {
    assert.deepEqual(
      await verifyRegistryAbsent(`http://127.0.0.1:${String(address.port)}`),
      { absent: 6, version: RELEASE_VERSION },
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
  }

  assert.match(
    workflow,
    /uses: pnpm\/action-setup@v5\n {8}with:\n {10}package_json_file: release-source\/package\.json/,
  );
  assert.match(
    workflow,
    /cache-dependency-path: release-source\/pnpm-lock\.yaml/,
  );
  assert.match(
    workflow,
    /name: Install and build frozen sources\n {8}working-directory: release-source/,
  );
  assert.match(
    workflow,
    /name: Reproduce and verify the CLI tarball\n {8}working-directory: release-source/,
  );
  assert.match(
    workflow,
    /node bootstrap-infrastructure\/scripts\/verify-cli-bootstrap\.mjs \\\n {12}package-set release-source/,
  );
  assert.match(
    workflow,
    /\$\{\{ github\.workspace \}\}\/release-source\/packages\/kernel\/dist\/json\.js/,
  );
  assert.match(
    workflow,
    /\$RUNNER_TEMP\/cli-pack-1\/nicia-ai-lachesis-cli-\$RELEASE_VERSION\.tgz/,
  );
} finally {
  await rm(workspace, { force: true, recursive: true });
}

console.log(
  "M8b.2b.4 clean-layout simulation passed: root lookup rejected; frozen-source setup, install, six-package build, three deterministic packs, path audit, and mocked pre-publication verification passed.",
);
