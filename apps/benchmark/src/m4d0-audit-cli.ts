import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parseJson } from "@nicia-ai/lachesis";
import {
  auditM4d0PolicyViability,
  loadM3bPhaseCases,
  M4A_INITIAL_POLICY,
} from "@nicia-ai/lachesis-evidence";
import { z } from "zod";

const reportEnvelopeSchema = z.object({
  run: z.object({ records: z.unknown() }),
});

async function main(): Promise<number> {
  const reportPath = process.argv[2];
  if (reportPath === undefined) {
    process.stderr.write(
      "Usage: m4d0-audit <immutable-m3-execution-report.json>\n",
    );
    return 2;
  }
  const text = await readFile(reportPath, "utf8");
  const parsed = parseJson(text);
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error.message}\n`);
    return 1;
  }
  const envelope = reportEnvelopeSchema.safeParse(parsed.value);
  if (!envelope.success) {
    process.stderr.write("The M3 execution report envelope is invalid.\n");
    return 1;
  }
  const result = await auditM4d0PolicyViability({
    recordsInput: envelope.data.run.records,
    tasksInput: loadM3bPhaseCases("m3b-heldout"),
    existingPolicyInput: M4A_INITIAL_POLICY,
    m3ExecutionReportDigest: createHash("sha256").update(text).digest("hex"),
  });
  if (!result.ok) {
    process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
    return 1;
  }
  process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
  return 0;
}

process.exitCode = await main();
