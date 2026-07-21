import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  canonicalizeJson,
  type Diagnostic,
  diagnostic,
  digestValue,
  parseJson,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  executeM5b,
  generateStoredM5bReport,
  inspectGitState,
  type M5bLiveAcknowledgement,
  preflightM5b,
} from "./m5b-controller.js";
import { m5bCorpusSchema, materializeM5bCorpus } from "./m5b-corpus.js";
import {
  m5bCampaignManifestSchema,
  m5bExecutionDisposition,
  type M5bMaterializedPhase,
  m5bPhaseManifestSchema,
  materializeM5bPhase,
  validateM5bMaterialization,
} from "./m5b-manifests.js";

const commandSchema = z.enum([
  "materialize",
  "validate",
  "dry-run",
  "execute",
  "resume",
  "report",
]);
const phaseSchema = z.enum(["m5b-protocol-probe", "m5b-pilot"]);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

function failure(message: string): Diagnostic {
  return diagnostic("INVALID_WIRE_SCHEMA", message);
}

async function writePrivateJson(
  path: string,
  value: unknown,
): Promise<Result<void, Diagnostic>> {
  const canonical = canonicalizeJson(value);
  if (!canonical.ok) return canonical;
  const temporary = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await chmod(dirname(path), 0o700);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${canonical.value}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    await chmod(path, 0o600);
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    try {
      await unlink(temporary);
    } catch {
      // Best-effort cleanup after returning a typed storage failure.
    }
    return {
      ok: false,
      error: failure(
        `Unable to write private M5b artifact: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
}

async function readJson(path: string): Promise<Result<unknown, Diagnostic>> {
  try {
    return parseJson(await readFile(path, "utf8"));
  } catch (error: unknown) {
    return {
      ok: false,
      error: failure(
        `Unable to read frozen M5b artifact: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
}

async function derive(
  repositoryRoot: string,
  sourceCommit: string,
  phase: z.infer<typeof phaseSchema>,
): Promise<Result<M5bMaterializedPhase, Diagnostic>> {
  const corpus = await materializeM5bCorpus({ repositoryRoot });
  return corpus.ok
    ? materializeM5bPhase({ phase, sourceCommit, corpus: corpus.value })
    : corpus;
}

async function loadFrozen(
  root: string,
  repositoryRoot: string,
  sourceCommit: string,
  phase: z.infer<typeof phaseSchema>,
): Promise<Result<M5bMaterializedPhase, Diagnostic>> {
  const [corpusJson, campaignJson, phaseJson] = await Promise.all([
    readJson(join(root, "corpus.json")),
    readJson(join(root, "campaign.json")),
    readJson(join(root, `${phase}.json`)),
  ]);
  if (!corpusJson.ok) return corpusJson;
  if (!campaignJson.ok) return campaignJson;
  if (!phaseJson.ok) return phaseJson;
  const corpus = m5bCorpusSchema.safeParse(corpusJson.value);
  const campaign = m5bCampaignManifestSchema.safeParse(campaignJson.value);
  const phaseManifest = m5bPhaseManifestSchema.safeParse(phaseJson.value);
  if (!corpus.success || !campaign.success || !phaseManifest.success)
    return { ok: false, error: failure("Frozen M5b artifacts are invalid.") };
  const derived = await derive(repositoryRoot, sourceCommit, phase);
  if (!derived.ok) return derived;
  const expected = await digestValue({
    corpus: derived.value.corpus,
    campaign: derived.value.campaign,
    phase: derived.value.phase,
  });
  const actual = await digestValue({
    corpus: corpus.data,
    campaign: campaign.data,
    phase: phaseManifest.data,
  });
  if (!expected.ok) return expected;
  if (!actual.ok) return actual;
  return expected.value === actual.value
    ? validateM5bMaterialization({
        ...derived.value,
        corpus: corpus.data,
        campaign: campaign.data,
        phase: phaseManifest.data,
      })
    : { ok: false, error: failure("Frozen M5b artifact checksums differ.") };
}

async function materializeProbe(
  repositoryRoot: string,
  outputRoot: string,
  sourceCommit: string,
): Promise<Result<Readonly<{ probe: string }>, Diagnostic>> {
  const corpus = await materializeM5bCorpus({ repositoryRoot });
  if (!corpus.ok) return corpus;
  const probe = await materializeM5bPhase({
    phase: "m5b-protocol-probe",
    sourceCommit,
    corpus: corpus.value,
  });
  if (!probe.ok) return probe;
  const artifacts: ReadonlyArray<readonly [string, unknown]> = [
    ["corpus.json", corpus.value],
    ["campaign.json", probe.value.campaign],
    ["m5b-protocol-probe.json", probe.value.phase],
  ];
  const checksums: Array<Readonly<{ path: string; digest: string }>> = [];
  for (const [name, value] of artifacts) {
    const written = await writePrivateJson(join(outputRoot, name), value);
    if (!written.ok) return written;
    const digest = await digestValue(value);
    if (!digest.ok) return digest;
    checksums.push({ path: name, digest: digest.value });
  }
  const checksumWrite = await writePrivateJson(
    join(outputRoot, "checksums.json"),
    checksums,
  );
  return checksumWrite.ok
    ? {
        ok: true,
        value: {
          probe: probe.value.phase.experimentDigest,
        },
      }
    : checksumWrite;
}

function valueAt(values: ReadonlyArray<string>, index: number): string {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing CLI argument ${index}.`);
  return value;
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(args: ReadonlyArray<string>): Promise<number> {
  const command = commandSchema.parse(valueAt(args, 0));
  const repositoryRoot = valueAt(args, 1);
  const artifactRoot = valueAt(args, 2);
  const sourceCommit = commitSchema.parse(valueAt(args, 3));
  if (command === "materialize") {
    const result = await materializeProbe(
      repositoryRoot,
      artifactRoot,
      sourceCommit,
    );
    output(result);
    return result.ok ? 0 : 1;
  }
  const phase = phaseSchema.parse(valueAt(args, 4));
  const materialized = await loadFrozen(
    artifactRoot,
    repositoryRoot,
    sourceCommit,
    phase,
  );
  if (!materialized.ok) {
    output(materialized);
    return 1;
  }
  if (command === "validate") {
    output({
      ok: true,
      experimentDigest: materialized.value.phase.experimentDigest,
      phaseManifestDigest: materialized.value.phase.phaseManifestDigest,
    });
    return 0;
  }
  const storageRoot = valueAt(args, 5);
  if (command === "report") {
    const report = await generateStoredM5bReport({
      materialized: materialized.value,
      storageRoot,
    });
    output(report);
    return report.ok ? 0 : 1;
  }
  const git = await inspectGitState(repositoryRoot);
  if (!git.ok) {
    output(git);
    return 1;
  }
  if (command === "dry-run") {
    const dryRun = await preflightM5b({
      materialized: materialized.value,
      currentCommit: git.value.commit,
      cleanWorktree: git.value.clean,
      credentials: { OPENAI_API_KEY: false, ANTHROPIC_API_KEY: false },
      ledgerPath: join(
        storageRoot,
        materialized.value.campaign.campaignDigest,
        "ledger.ndjson",
      ),
    });
    output(dryRun);
    return dryRun.ok && dryRun.value.valid ? 0 : 1;
  }
  if (m5bExecutionDisposition(materialized.value.phase) !== "live-capable") {
    output({
      ok: false,
      error: failure(
        "The immutable M5b.0 failed probe is report-only and cannot execute or resume.",
      ),
    });
    return 1;
  }
  const acknowledgement: M5bLiveAcknowledgement = {
    campaignDigest: digestSchema.parse(valueAt(args, 6)),
    experimentDigest: digestSchema.parse(valueAt(args, 7)),
    phaseManifestDigest: digestSchema.parse(valueAt(args, 8)),
    phase,
    maximumCampaignUsdMicros: z
      .literal(5_000_000)
      .parse(Number(valueAt(args, 9))),
  };
  const execution = await executeM5b({
    materialized: materialized.value,
    storageRoot,
    currentCommit: git.value.commit,
    cleanWorktree: git.value.clean,
    acknowledgement,
    credentials: {
      openaiApiKey: process.env["OPENAI_API_KEY"] ?? "",
      anthropicApiKey: process.env["ANTHROPIC_API_KEY"] ?? "",
    },
  });
  output(execution);
  return execution.ok ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
