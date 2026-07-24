import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseJson } from "../packages/kernel/dist/json.js";

const root = resolve(import.meta.dirname, "..");
const version = "0.1.0-alpha.4";
const packages = [
  "@nicia-ai/lachesis",
  "@nicia-ai/lachesis-evidence",
  "@nicia-ai/lachesis-generator",
  "@nicia-ai/lachesis-runtime",
  "@nicia-ai/lachesis-evidence-typegraph",
  "@nicia-ai/lachesis-cli",
];
const outputIndex = process.argv.indexOf("--output");
const output =
  outputIndex === -1 ? null : (process.argv.at(outputIndex + 1) ?? null);
if (outputIndex !== -1 && output === null)
  throw new Error("--output requires a path.");

function view(specification, field) {
  const result = spawnSync(
    "npm",
    [
      "view",
      specification,
      field,
      "--json",
      "--registry",
      "https://registry.npmjs.org",
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NPM_CONFIG_USERCONFIG: "/dev/null" },
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status === 0) {
    const parsed = parseJson(result.stdout);
    if (!parsed.ok) throw new Error(`npm view returned invalid JSON.`);
    return parsed.value;
  }
  if (result.stderr.includes("E404")) return null;
  throw new Error(`npm view failed for ${specification}.`);
}

const records = [];
for (const name of packages) {
  const found = view(`${name}@${version}`, "version");
  if (found !== null)
    throw new Error(`${name}@${version} is already present in the registry.`);
  const tags = view(name, "dist-tags");
  if (name === "@nicia-ai/lachesis-cli") {
    if (tags !== null)
      throw new Error("The CLI package unexpectedly exists before bootstrap.");
    records.push({ name, alpha4: "absent", package: "absent", distTags: null });
    continue;
  }
  if (
    tags === null ||
    tags.latest !== "0.1.0-alpha.1" ||
    tags.alpha !== "0.1.0-alpha.3"
  )
    throw new Error(`${name} has unexpected prerelease tags.`);
  records.push({
    name,
    alpha4: "absent",
    package: "present",
    distTags: { alpha: tags.alpha, latest: tags.latest },
  });
}

const report = {
  protocol: "lachesis.m8b2b.alpha4.registry-preflight.v1",
  observationDate: "2026-07-24",
  registry: "https://registry.npmjs.org",
  version,
  packages: records,
  alpha4AbsentForAllSix: true,
  existingLatestTagsPreserved: true,
  credentialsAccessed: false,
  publicationPerformed: false,
};
const text = `${JSON.stringify(report, null, 2)}\n`;
if (output === null) process.stdout.write(text);
else
  await writeFile(resolve(root, output), text, {
    encoding: "utf8",
    mode: 0o644,
  });
