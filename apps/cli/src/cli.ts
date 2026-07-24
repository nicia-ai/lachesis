#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import {
  compilePlanJson,
  createReplayEffectHandler,
  type Diagnostic,
  type ExecutablePlan,
  executePlan,
  inspectExecutablePlan,
  parseJson,
  type PlanAnalysis,
  type ReplayEntry,
  replayEntrySchema,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import { createExampleCatalog, examplePolicy } from "./example-catalog.js";
import { runCatalogManifestCommand } from "./internal/catalog-manifest-command.js";

const nonTransformingJsonObjectSchema = z.custom<
  Readonly<Record<string, unknown>>
>(
  (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value),
  "Expected a JSON object.",
);

function jsonOutput(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`);
}

function diagnosticsOutput(
  diagnostics: ReadonlyArray<Diagnostic>,
  asJson: boolean,
): void {
  if (asJson) jsonOutput({ valid: false, diagnostics });
  else
    for (const item of diagnostics)
      process.stderr.write(`${item.code}: ${item.message}\n`);
}

async function readText(
  path: string,
): Promise<Result<string, ReadonlyArray<Diagnostic>>> {
  try {
    return { ok: true, value: await readFile(path, "utf8") };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown filesystem error";
    return {
      ok: false,
      error: [
        {
          code: "MALFORMED_JSON",
          message: `Could not read ${path}: ${message}`,
          location: {},
          details: [],
        },
      ],
    };
  }
}

async function compile(
  path: string,
): Promise<Result<ExecutablePlan, ReadonlyArray<Diagnostic>>> {
  const text = await readText(path);
  if (!text.ok) return text;
  return compilePlanJson(text.value, createExampleCatalog(), examplePolicy);
}

function analysisJson(analysis: PlanAnalysis): unknown {
  return {
    inferredSchemas: [...analysis.inferredSchemas].map(([nodeId, schema]) => ({
      nodeId,
      schema,
    })),
    topologicalStages: analysis.topologicalStages,
    effectsUsed: [...analysis.effectsUsed].toSorted(),
    capabilitiesRequired: [...analysis.capabilitiesRequired].toSorted(),
    cacheableNodes: [...analysis.cacheableNodes].toSorted(),
    replayableNodes: [...analysis.replayableNodes].toSorted(),
    maximumEffectCalls: analysis.maximumEffectCalls,
    maximumRecursionDepth: analysis.maximumRecursionDepth,
    maximumCollectionFanOut: analysis.maximumCollectionFanOut,
    maximumDeclaredTokens: analysis.maximumDeclaredTokens,
    maximumDeclaredWallClockMs: analysis.maximumDeclaredWallClockMs,
    maximumParallelism: analysis.maximumParallelism,
    everyRelevantBoundProven: analysis.everyRelevantBoundProven,
  };
}

function usage(): void {
  process.stderr.write(
    "Usage: lachesis <validate|analyze|canonicalize|run> <plan.json> [--inputs inputs.json --replay effects.json] [--json]\n",
  );
}

function flagValue(
  args: ReadonlyArray<string>,
  flag: string,
): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function loadInputs(
  path: string,
): Promise<Result<ReadonlyMap<string, unknown>, ReadonlyArray<Diagnostic>>> {
  const text = await readText(path);
  if (!text.ok) return text;
  const json = parseJson(text.value);
  if (!json.ok) return { ok: false, error: [json.error] };
  const parsed = nonTransformingJsonObjectSchema.safeParse(json.value);
  return parsed.success
    ? { ok: true, value: new Map(Object.entries(parsed.data)) }
    : {
        ok: false,
        error: [
          {
            code: "INVALID_WIRE_SCHEMA",
            message: "Inputs must be a JSON object.",
            location: {},
            details: [],
          },
        ],
      };
}

async function loadReplay(
  path: string,
): Promise<Result<ReadonlyArray<ReplayEntry>, ReadonlyArray<Diagnostic>>> {
  const text = await readText(path);
  if (!text.ok) return text;
  const json = parseJson(text.value);
  if (!json.ok) return { ok: false, error: [json.error] };
  const parsed = z.array(replayEntrySchema).safeParse(json.value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        error: [
          {
            code: "INVALID_WIRE_SCHEMA",
            message: "Replay file has an invalid shape.",
            location: {},
            details: [],
          },
        ],
      };
}

async function main(args: ReadonlyArray<string>): Promise<number> {
  if (args[0] === "catalog" && args[1] === "manifest") {
    const result = await runCatalogManifestCommand(args.slice(2), {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    });
    if (!result.parsed)
      process.stderr.write(
        "Usage: lachesis catalog manifest --catalog <file#export> --policy <file#export> (--check|--out <file>|--verify <file>) --report <file|-> [--replace]\n",
      );
    return result.exitCode;
  }
  const [command, planPath] = args;
  const asJson = args.includes("--json");
  if (
    command === undefined ||
    planPath === undefined ||
    !["validate", "analyze", "canonicalize", "run"].includes(command)
  ) {
    usage();
    return 2;
  }
  const compiled = await compile(planPath);
  if (!compiled.ok) {
    diagnosticsOutput(compiled.error, asJson);
    return 1;
  }
  if (command === "validate") {
    const summary = inspectExecutablePlan(compiled.value);
    if (summary === undefined) return 1;
    if (asJson)
      jsonOutput({
        valid: true,
        rootSchema: summary.rootSchema.id,
      });
    else
      process.stdout.write(
        `Valid plan; root schema ${summary.rootSchema.id}.\n`,
      );
    return 0;
  }
  if (command === "analyze") {
    const summary = inspectExecutablePlan(compiled.value);
    if (summary === undefined) return 1;
    jsonOutput(analysisJson(summary.analysis));
    return 0;
  }
  if (command === "canonicalize") {
    const summary = inspectExecutablePlan(compiled.value);
    if (summary === undefined) return 1;
    if (asJson)
      jsonOutput({ canonical: summary.canonicalPlan, hash: summary.planHash });
    else
      process.stdout.write(`${summary.canonicalPlan}\n${summary.planHash}\n`);
    return 0;
  }
  const inputsPath = flagValue(args, "--inputs");
  const replayPath = flagValue(args, "--replay");
  if (inputsPath === undefined || replayPath === undefined) {
    usage();
    return 2;
  }
  const inputs = await loadInputs(inputsPath);
  const replay = await loadReplay(replayPath);
  if (!inputs.ok) {
    diagnosticsOutput(inputs.error, asJson);
    return 1;
  }
  if (!replay.ok) {
    diagnosticsOutput(replay.error, asJson);
    return 1;
  }
  let tick = 0;
  const executed = await executePlan(compiled.value, {
    inputs: inputs.value,
    effectHandler: createReplayEffectHandler(replay.value),
    clock: {
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
    },
    runIdProvider: { next: () => "example-replay-run" },
  });
  if (!executed.ok) {
    diagnosticsOutput(executed.error.diagnostics, asJson);
    return 1;
  }
  jsonOutput({
    output: executed.value.output,
    outputDigest: executed.value.outputDigest,
    trace: executed.value.trace,
  });
  return 0;
}

main(process.argv.slice(2)).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error: unknown) => {
    const message =
      error instanceof Error
        ? (error.stack ?? error.message)
        : "Unexpected internal failure";
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  },
);
