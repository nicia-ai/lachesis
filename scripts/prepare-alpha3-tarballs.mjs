import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { parseJson } from "../packages/kernel/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const packages = [
  "packages/kernel",
  "packages/evidence",
  "packages/runtime",
  "packages/evidence-typegraph",
  "packages/generator",
];
const version = "0.1.0-alpha.3";
const outputArgumentIndex = process.argv.indexOf("--output-dir");
const outputDirectory =
  outputArgumentIndex === -1
    ? null
    : (process.argv.at(outputArgumentIndex + 1) ?? null);
if (outputArgumentIndex !== -1 && outputDirectory === null)
  throw new Error("--output-dir requires a path.");

function command(program, arguments_, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, arguments_, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${program} failed with ${code ?? "signal"}.`));
    });
  });
}

function capture(program, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, arguments_, { cwd: root });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${program} failed with ${code ?? "signal"}.`));
    });
  });
}

function synchronizeWorkspaceDependencies(manifest) {
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
        .map(([name, value]) => [
          name,
          typeof value === "string" && value.startsWith("workspace:")
            ? version
            : value,
        ])
        .toSorted(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        ),
    );
  }
  return result;
}

async function stagePackage(packageDirectory, stagingRoot) {
  const source = join(root, packageDirectory);
  const stage = join(stagingRoot, packageDirectory.replaceAll("/", "-"));
  await mkdir(stage, { recursive: true });
  const parsedManifest = parseJson(
    await readFile(join(source, "package.json"), "utf8"),
  );
  if (
    !parsedManifest.ok ||
    parsedManifest.value === null ||
    Array.isArray(parsedManifest.value) ||
    typeof parsedManifest.value !== "object" ||
    !Array.isArray(parsedManifest.value.files)
  )
    throw new Error(`${packageDirectory} has an invalid package manifest.`);
  const manifest = parsedManifest.value;
  for (const entry of manifest.files)
    await cp(join(source, entry), join(stage, entry), { recursive: true });
  await writeFile(
    join(stage, "package.json"),
    `${JSON.stringify(synchronizeWorkspaceDependencies(manifest), null, 2)}\n`,
    "utf8",
  );
  return stage;
}

async function packSet(directory, stagingRoot) {
  await mkdir(directory, { recursive: true });
  for (const packageDirectory of packages) {
    const stage = await stagePackage(packageDirectory, stagingRoot);
    await command(
      "npm",
      ["pack", stage, "--pack-destination", directory],
      root,
    );
  }
  return (await readdir(directory)).filter((file) => file.endsWith(".tgz"));
}

const temporary = await mkdtemp(join(tmpdir(), "lachesis-alpha3-packs-"));
try {
  const firstDirectory = join(temporary, "first");
  const secondDirectory = join(temporary, "second");
  const firstFiles = await packSet(
    firstDirectory,
    join(temporary, "first-stage"),
  );
  const secondFiles = await packSet(
    secondDirectory,
    join(temporary, "second-stage"),
  );
  const names = firstFiles.toSorted();
  if (
    names.length !== packages.length ||
    names.join("\u0000") !== secondFiles.toSorted().join("\u0000")
  )
    throw new Error("Alpha.3 pack sets differ.");
  const artifacts = [];
  for (const file of names) {
    const [first, second] = await Promise.all([
      readFile(join(firstDirectory, file)),
      readFile(join(secondDirectory, file)),
    ]);
    const firstDigest = createHash("sha256").update(first).digest("hex");
    const secondDigest = createHash("sha256").update(second).digest("hex");
    if (firstDigest !== secondDigest || !first.equals(second))
      throw new Error(`${file} is not deterministic.`);
    const metadata = await stat(join(firstDirectory, file));
    const listing = await capture("tar", ["-tf", join(firstDirectory, file)]);
    artifacts.push({
      tarball: basename(file),
      version,
      sha256: firstDigest,
      bytes: metadata.size,
      files: listing.trim().split("\n").filter(Boolean).length,
      byteIdenticalAcrossTwoPacks: true,
    });
  }
  const report = {
    schemaVersion: 1,
    kind: "lachesis-alpha3-deterministic-tarball-digests",
    version,
    packRuns: 2,
    artifacts,
    networkAccess: "none",
    publication: "not-performed",
  };
  await writeFile(
    join(root, "docs/m7c-alpha3-tarball-digests.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  if (outputDirectory !== null) {
    const destination = resolve(root, outputDirectory);
    await mkdir(destination, { recursive: true });
    for (const file of names)
      await cp(join(firstDirectory, file), join(destination, file));
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
