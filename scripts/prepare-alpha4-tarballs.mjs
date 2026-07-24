import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";

import { format as formatText } from "prettier";

import { parseJson } from "../packages/kernel/dist/json.js";
const root = resolve(import.meta.dirname, "..");
const version = "0.1.0-alpha.4";
const definitions = [
  ["@nicia-ai/lachesis", "packages/kernel"],
  ["@nicia-ai/lachesis-evidence", "packages/evidence"],
  ["@nicia-ai/lachesis-generator", "packages/generator"],
  ["@nicia-ai/lachesis-runtime", "packages/runtime"],
  ["@nicia-ai/lachesis-evidence-typegraph", "packages/evidence-typegraph"],
  ["@nicia-ai/lachesis-cli", "apps/cli"],
].map(([name, directory]) => ({ name, directory }));

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv.at(index + 1);
  if (value === undefined || value.startsWith("--"))
    throw new Error(`${name} requires a path.`);
  return resolve(root, value);
}

const outputDirectory = argument("--output-dir");
const inventoryPath = argument("--inventory");
const checksumsPath = argument("--checksums");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function execute(program, arguments_, cwd = root) {
  const result = spawnSync(program, arguments_, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0)
    throw new Error(
      `${program} ${arguments_.join(" ")} failed: ${result.stderr.trim()}`,
    );
  return result.stdout;
}

function parseManifest(text, label) {
  const parsed = parseJson(text);
  if (!parsed.ok) throw new Error(`${label} is not valid JSON.`);
  const value = parsed.value;
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    !Array.isArray(value.files)
  )
    throw new Error(`${label} is not a package manifest with a files list.`);
  return value;
}

function allDependencies(manifest) {
  const result = [];
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
    for (const [name, range] of Object.entries(dependencies))
      result.push({ section, name, range });
  }
  return result.toSorted((left, right) =>
    `${left.section}\0${left.name}`.localeCompare(
      `${right.section}\0${right.name}`,
    ),
  );
}

async function stagePackage(definition, stagingRoot) {
  const source = resolve(root, definition.directory);
  const stage = resolve(stagingRoot, definition.directory.replaceAll("/", "-"));
  const manifest = parseManifest(
    await readFile(resolve(source, "package.json"), "utf8"),
    definition.name,
  );
  if (
    manifest.name !== definition.name ||
    manifest.version !== version ||
    manifest.private === true ||
    manifest.publishConfig?.access !== "public"
  )
    throw new Error(`${definition.name} has unexpected release metadata.`);
  for (const dependency of allDependencies(manifest)) {
    if (
      dependency.name.startsWith("@nicia-ai/lachesis") &&
      dependency.range !== version
    )
      throw new Error(
        `${definition.name} does not bind ${dependency.name} exactly to ${version}.`,
      );
    if (
      typeof dependency.range === "string" &&
      dependency.range.startsWith("workspace:")
    )
      throw new Error(`${definition.name} contains a workspace dependency.`);
  }
  await mkdir(stage, { recursive: true });
  for (const entry of manifest.files)
    await cp(resolve(source, entry), resolve(stage, entry), {
      recursive: true,
    });
  await writeFile(
    resolve(stage, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 },
  );
  return { stage, manifest };
}

async function inventoryTree(directory, prefix = "") {
  const records = [];
  const entries = (await readdir(directory, { withFileTypes: true })).toSorted(
    (left, right) => left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const relative = `${prefix}${entry.name}`;
    const metadata = await lstat(path);
    if (entry.isDirectory()) {
      records.push(...(await inventoryTree(path, `${relative}/`)));
      continue;
    }
    if (!entry.isFile() || metadata.isSymbolicLink())
      throw new Error(`Unsupported packed entry ${relative}.`);
    const bytes = await readFile(path);
    records.push({
      path: relative,
      bytes: bytes.byteLength,
      mode: metadata.mode & 0o777,
      sha256: sha256(bytes),
    });
  }
  return records;
}

async function packRun(run, scratch) {
  const destination = resolve(scratch, `pack-${run}`);
  const stagingRoot = resolve(scratch, `stage-${run}`);
  await mkdir(destination, { recursive: true });
  const results = [];
  for (const definition of definitions) {
    const { stage } = await stagePackage(definition, stagingRoot);
    execute("npm", ["pack", stage, "--pack-destination", destination]);
    const expectedPrefix = definition.name
      .slice(1)
      .replaceAll("/", "-")
      .replaceAll("@", "");
    const matches = (await readdir(destination)).filter(
      (name) =>
        name.startsWith(expectedPrefix) && name.endsWith(`-${version}.tgz`),
    );
    if (matches.length !== 1)
      throw new Error(`${definition.name} produced an ambiguous tarball.`);
    const path = resolve(destination, matches[0]);
    const bytes = await readFile(path);
    results.push({
      name: definition.name,
      path,
      tarball: basename(path),
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  return results;
}

const scratch = await mkdtemp(resolve(tmpdir(), "lachesis-alpha4-packs-"));
try {
  const runs = [];
  for (let run = 1; run <= 3; run += 1) runs.push(await packRun(run, scratch));

  const artifacts = [];
  for (const definition of definitions) {
    const attempts = runs
      .flat()
      .filter((record) => record.name === definition.name);
    if (
      attempts.length !== 3 ||
      new Set(attempts.map((record) => record.sha256)).size !== 1
    )
      throw new Error(
        `${definition.name} is not deterministic across 3 packs.`,
      );

    const extraction = resolve(
      scratch,
      `extract-${definition.name.replaceAll("/", "-").replaceAll("@", "")}`,
    );
    await mkdir(extraction);
    execute("tar", ["-xzf", attempts[0].path, "-C", extraction]);
    const packageRoot = resolve(extraction, "package");
    const manifest = parseManifest(
      await readFile(resolve(packageRoot, "package.json"), "utf8"),
      `${definition.name} packed manifest`,
    );
    const files = await inventoryTree(packageRoot);
    const declarations = files
      .filter((file) => file.path.endsWith(".d.ts"))
      .map((file) => file.path);
    const declarationMaps = files
      .filter((file) => file.path.endsWith(".d.ts.map"))
      .map((file) => file.path);
    const sourceMaps = files
      .filter((file) => file.path.endsWith(".js.map"))
      .map((file) => file.path);
    const executableFiles = files
      .filter((file) => (file.mode & 0o111) !== 0)
      .map((file) => ({ path: file.path, mode: file.mode }));
    if (
      definition.name === "@nicia-ai/lachesis-cli" &&
      (manifest.exports !== undefined ||
        manifest.main !== undefined ||
        manifest.types !== undefined ||
        declarations.length !== 0 ||
        manifest.bin?.lachesis !== "./dist/cli.js")
    )
      throw new Error("The CLI is not a binary-only package.");

    artifacts.push({
      package: definition.name,
      version,
      tarball: attempts[0].tarball,
      sha256: attempts[0].sha256,
      bytes: attempts[0].bytes,
      packRuns: attempts.map(({ sha256: digest, bytes }, index) => ({
        run: index + 1,
        sha256: digest,
        bytes,
      })),
      npmPackageContents: files,
      dependencies: allDependencies(manifest),
      sourceMaps,
      declarations,
      declarationMaps,
      executableFiles,
      license: manifest.license,
      repository: manifest.repository,
      packageType: manifest.type,
      engines: manifest.engines,
      bin: manifest.bin ?? null,
      exports: manifest.exports ?? null,
    });

    if (outputDirectory !== null) {
      await mkdir(outputDirectory, { recursive: true });
      await cp(attempts[0].path, resolve(outputDirectory, attempts[0].tarball));
    }
  }

  const report = {
    protocol: "lachesis.m8b2b.alpha4.tarball-inventory.v1",
    version,
    publication: "not-performed",
    packRuns: 3,
    byteIdentical: true,
    packages: artifacts,
  };
  const text = await formatText(JSON.stringify(report), { parser: "json" });
  if (inventoryPath === null) process.stdout.write(text);
  else await writeFile(inventoryPath, text, { encoding: "utf8", mode: 0o644 });
  if (checksumsPath !== null) {
    const checksums = artifacts
      .map((artifact) => `${artifact.sha256}  ${artifact.tarball}`)
      .join("\n");
    await writeFile(checksumsPath, `${checksums}\n`, {
      encoding: "utf8",
      mode: 0o644,
    });
  }
} finally {
  await rm(scratch, { force: true, recursive: true });
}
