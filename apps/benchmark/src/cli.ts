#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { canonicalizeJson, type Diagnostic } from "@nicia-ai/lachesis";

import {
  executePhase,
  generateStoredReport,
  type LiveAcknowledgement,
  loadPhaseFiles,
  preflightPhase,
} from "./controller.js";
import {
  blindHeldOutIntegrityAudit,
  blindM1cHeldOutIntegrityAudit,
  blindM2HeldOutAudit,
  materializeM1bPhase,
  materializeM1cPhase,
  materializeM2Phase,
  type RuntimeVersions,
} from "./manifests.js";
import { campaignPhaseSchema } from "./protocol.js";

const execFileAsync = promisify(execFile);

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`);
}

function failure(diagnostics: ReadonlyArray<Diagnostic> | Diagnostic): number {
  output({
    ok: false,
    diagnostics: Array.isArray(diagnostics) ? diagnostics : [diagnostics],
  });
  return 1;
}

function flag(args: ReadonlyArray<string>, name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function usage(): void {
  process.stderr.write(
    "Usage: lachesis-benchmark <materialize|audit-heldout|audit-m1c-heldout|audit-m2-heldout|validate|dry-run|execute|resume|report> [phase] --campaign FILE --manifest FILE [--storage-root DIR] [--ack-experiment DIGEST --ack-phase PHASE --ack-max-usd-micros INTEGER]\n",
  );
}

async function gitCommit(cwd: string): Promise<string> {
  const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
  return result.stdout.trim();
}

function runtimeVersions(): RuntimeVersions {
  return {
    node: process.versions.node,
    pnpm: "10.33.0",
    typescript: "6.0.3",
    zod: "4.4.3",
    aiSdk: "7.0.28",
  };
}

async function materialize(
  phaseValue: string | undefined,
  args: ReadonlyArray<string>,
  cwd: string,
): Promise<number> {
  const phase = campaignPhaseSchema.safeParse(phaseValue);
  if (!phase.success) {
    usage();
    return 2;
  }
  const destination = resolve(
    cwd,
    flag(args, "--out") ??
      `experiments/${phase.data.startsWith("m2-") ? "m2" : phase.data.startsWith("m1c-") ? "m1c" : "m1b"}/${phase.data}`,
  );
  const materializer = phase.data.startsWith("m2-")
    ? materializeM2Phase
    : phase.data.startsWith("m1c-")
      ? materializeM1cPhase
      : materializeM1bPhase;
  const materialized = await materializer({
    phase: phase.data,
    gitCommit: await gitCommit(cwd),
    runtimeVersions: runtimeVersions(),
  });
  if (!materialized.ok) return failure(materialized.error);
  const campaignJson = canonicalizeJson(materialized.value.campaign);
  const phaseJson = canonicalizeJson(materialized.value.manifest);
  if (!campaignJson.ok) return failure(campaignJson.error);
  if (!phaseJson.ok) return failure(phaseJson.error);
  await mkdir(destination, { recursive: true });
  const campaignPath = join(destination, "campaign.json");
  const phasePath = join(destination, `${phase.data}.json`);
  await writeFile(campaignPath, `${campaignJson.value}\n`, "utf8");
  await writeFile(phasePath, `${phaseJson.value}\n`, "utf8");
  output({
    ok: true,
    campaignPath,
    phasePath,
    campaignDigest: materialized.value.campaign.campaignDigest,
    phaseManifestDigest: materialized.value.manifest.phaseManifestDigest,
    experimentDigest: materialized.value.manifest.experimentDigest,
  });
  return 0;
}

function acknowledgement(
  args: ReadonlyArray<string>,
): LiveAcknowledgement | undefined {
  const experimentDigest = flag(args, "--ack-experiment");
  const phase = campaignPhaseSchema.safeParse(flag(args, "--ack-phase"));
  const maximum = flag(args, "--ack-max-usd-micros");
  if (experimentDigest === undefined || !phase.success || maximum === undefined)
    return undefined;
  const maximumCostUsdMicros = Number(maximum);
  return Number.isSafeInteger(maximumCostUsdMicros)
    ? { experimentDigest, phase: phase.data, maximumCostUsdMicros }
    : undefined;
}

async function main(args: ReadonlyArray<string>): Promise<number> {
  const [command, phaseValue] = args;
  const cwd = process.cwd();
  if (command === "materialize") return materialize(phaseValue, args, cwd);
  if (command === "audit-heldout") {
    const audit = await blindHeldOutIntegrityAudit();
    if (!audit.ok) return failure(audit.error);
    output(audit.value);
    return 0;
  }
  if (command === "audit-m1c-heldout") {
    const audit = await blindM1cHeldOutIntegrityAudit();
    if (!audit.ok) return failure(audit.error);
    output(audit.value);
    return 0;
  }
  if (command === "audit-m2-heldout") {
    const audit = await blindM2HeldOutAudit();
    output(audit);
    return 0;
  }
  if (
    !["validate", "dry-run", "execute", "resume", "report"].includes(
      command ?? "",
    )
  ) {
    usage();
    return 2;
  }
  const campaignPath = flag(args, "--campaign");
  const phasePath = flag(args, "--manifest");
  if (campaignPath === undefined || phasePath === undefined) {
    usage();
    return 2;
  }
  const loaded = await loadPhaseFiles({
    campaignPath: resolve(cwd, campaignPath),
    phasePath: resolve(cwd, phasePath),
  });
  if (!loaded.ok) return failure(loaded.error);
  if (command === "validate") {
    output({
      ok: true,
      campaignDigest: loaded.value.campaign.campaignDigest,
      phaseManifestDigest: loaded.value.phase.phaseManifestDigest,
      experimentDigest: loaded.value.phase.experimentDigest,
      phase: loaded.value.phase.phase,
    });
    return 0;
  }
  const storageRoot = resolve(
    cwd,
    flag(args, "--storage-root") ?? ".benchmark-state",
  );
  if (command === "report") {
    const report = await generateStoredReport({
      loaded: loaded.value,
      storageRoot,
    });
    if (!report.ok) return failure(report.error);
    output(report.value);
    return 0;
  }
  const ledgerPath = join(
    storageRoot,
    loaded.value.campaign.campaignDigest,
    "ledger.ndjson",
  );
  if (command === "dry-run") {
    const report = await preflightPhase({
      loaded: loaded.value,
      ledgerPath,
      cwd,
      acknowledgement: acknowledgement(args),
    });
    if (!report.ok) return failure(report.error);
    output(report.value);
    return 0;
  }
  const executed = await executePhase({
    loaded: loaded.value,
    storageRoot,
    cwd,
    acknowledgement: acknowledgement(args),
    onReservation(status, provider) {
      process.stderr.write(
        `${JSON.stringify({ event: "pre-request-budget", provider, budget: status })}\n`,
      );
    },
  });
  if (!executed.ok) return failure(executed.error);
  output({ ok: true, command, ...executed.value });
  return 0;
}

main(process.argv.slice(2)).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : "Unexpected controller failure"}\n`,
    );
    process.exitCode = 2;
  },
);
