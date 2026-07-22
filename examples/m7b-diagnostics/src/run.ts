import { readFile, writeFile } from "node:fs/promises";

import { canonicalizeJson, parseJson } from "@nicia-ai/lachesis";

import { createM7bReport, m7bReportSchema, verifyM7bReport } from "./report.js";

const m7aText = await readFile(
  new URL(
    "../../m7a-independent-catalogs/reports/m7a-conformance-report.json",
    import.meta.url,
  ),
  "utf8",
);
const m7a = parseJson(m7aText);
if (
  !m7a.ok ||
  m7a.value === null ||
  Array.isArray(m7a.value) ||
  typeof m7a.value !== "object" ||
  m7a.value["reportDigest"] !==
    "8cc35372ec4f4f560180a2f26cf4edb46c9c298f49f21cc39f8df07cde19cf85"
)
  throw new Error("M7a report digest changed during M7b.");

const report = await createM7bReport();
if (!(await verifyM7bReport(report))) throw new Error("M7b report is invalid.");
const canonical = canonicalizeJson(report);
if (!canonical.ok) throw new Error("M7b report is not canonical JSON.");

if (process.argv.includes("--write")) {
  await writeFile(
    new URL("../reports/m7b-diagnostic-report.json", import.meta.url),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
} else if (process.argv.includes("--print")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const expectedText = await readFile(
    new URL("../reports/m7b-diagnostic-report.json", import.meta.url),
    "utf8",
  );
  const expectedJson = parseJson(expectedText);
  if (!expectedJson.ok) throw new Error("Committed M7b report is malformed.");
  const expected = m7bReportSchema.parse(expectedJson.value);
  const expectedCanonical = canonicalizeJson(expected);
  if (!expectedCanonical.ok || expectedCanonical.value !== canonical.value)
    throw new Error("Committed M7b report is not deterministic.");
}
