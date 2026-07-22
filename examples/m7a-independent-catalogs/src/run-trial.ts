import { readFile } from "node:fs/promises";

import { canonicalizeJson, parseJson } from "@nicia-ai/lachesis";

import {
  createM7aConformanceReport,
  m7aConformanceReportSchema,
  verifyM7aConformanceReport,
} from "./report.js";

const report = await createM7aConformanceReport();
if (!(await verifyM7aConformanceReport(report)))
  throw new Error("Generated M7a report did not verify.");
const canonical = canonicalizeJson(report);
if (!canonical.ok)
  throw new Error("Generated M7a report is not canonical JSON.");

if (process.argv.includes("--print")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const expectedText = await readFile(
    new URL("../reports/m7a-conformance-report.json", import.meta.url),
    "utf8",
  );
  const expectedJson = parseJson(expectedText);
  if (!expectedJson.ok)
    throw new Error("Committed M7a report is malformed JSON.");
  const expected = m7aConformanceReportSchema.parse(expectedJson.value);
  const expectedCanonical = canonicalizeJson(expected);
  if (!expectedCanonical.ok || expectedCanonical.value !== canonical.value)
    throw new Error("Committed M7a report is not deterministic.");
}
