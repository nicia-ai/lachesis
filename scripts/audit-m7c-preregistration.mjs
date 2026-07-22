import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { digestValue, parseJson } from "../packages/kernel/dist/index.js";

const root = resolve(import.meta.dirname, "..");

async function readObject(path) {
  const text = await readFile(resolve(root, path), "utf8");
  const parsed = parseJson(text);
  if (
    !parsed.ok ||
    parsed.value === null ||
    Array.isArray(parsed.value) ||
    typeof parsed.value !== "object"
  )
    throw new Error(`${path} is not a valid object.`);
  return parsed.value;
}

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(resolve(root, path)))
    .digest("hex");
}

const preregistration = await readObject("docs/m7c-preregistration.json");
const { recordDigest, ...body } = preregistration;
const expectedRecordDigest = await digestValue(body);
if (
  !expectedRecordDigest.ok ||
  expectedRecordDigest.value !== recordDigest ||
  preregistration.status !==
    "prepared-for-external-preregistration-not-registered-not-executed"
)
  throw new Error("M7c preregistration identity or status is invalid.");

const bindings = preregistration.bindings;
if (
  bindings === null ||
  Array.isArray(bindings) ||
  typeof bindings !== "object"
)
  throw new Error("M7c bindings are invalid.");
for (const name of [
  "protocol",
  "authorInstructions",
  "adjudicatorInstructions",
  "constructorInstructions",
  "authorEnvironment",
  "countsOnlyAudit",
  "analysis",
]) {
  const binding = bindings[name];
  if (
    binding === null ||
    Array.isArray(binding) ||
    typeof binding !== "object" ||
    typeof binding.path !== "string" ||
    typeof binding.sha256 !== "string" ||
    (await sha256(binding.path)) !== binding.sha256
  )
    throw new Error(`M7c ${name} binding differs.`);
}
if (!Array.isArray(bindings.publicDocumentation))
  throw new Error("M7c public documentation bindings are invalid.");
for (const binding of bindings.publicDocumentation)
  if (
    binding === null ||
    Array.isArray(binding) ||
    typeof binding !== "object" ||
    typeof binding.path !== "string" ||
    typeof binding.sha256 !== "string" ||
    (await sha256(binding.path)) !== binding.sha256
  )
    throw new Error("M7c public documentation binding differs.");

const counts = await readObject("docs/m7c-counts-only-corpus-audit.json");
const planned = counts.planned;
if (
  counts.status !== "protocol-counts-frozen-corpus-not-constructed" ||
  counts.contentInspected !== false ||
  counts.identitiesCreated !== false ||
  planned === null ||
  Array.isArray(planned) ||
  typeof planned !== "object" ||
  planned.initialNonEquivalentDecisions < 100 ||
  planned.authorSessions !== 12 ||
  planned.catalogFamilies !== 6 ||
  counts.executionAuthorized !== false
)
  throw new Error("M7c counts-only corpus boundary is invalid.");

for (const [path, expected] of [
  [
    "examples/m7a-independent-catalogs/reports/m7a-conformance-report.json",
    "8cc35372ec4f4f560180a2f26cf4edb46c9c298f49f21cc39f8df07cde19cf85",
  ],
  [
    "examples/m7b-diagnostics/reports/m7b-diagnostic-report.json",
    "1dc71b40b919b69d177ed0986962f10f7b7311831dc63df0667891693a75b4c4",
  ],
]) {
  const report = await readObject(path);
  if (report.reportDigest !== expected)
    throw new Error(`${path} internal report digest changed.`);
}

process.stdout.write(
  `${JSON.stringify({
    protocol: preregistration.protocol,
    recordDigest,
    status: preregistration.status,
    initialNonEquivalentDecisions: planned.initialNonEquivalentDecisions,
    executionAuthorized: false,
  })}\n`,
);
