import {
  compilePlanJson,
  createCatalog,
  createMockEffectHandler,
  defineEffect,
  defineSchema,
  executePlan,
  inspectExecutablePlan,
} from "@nicia-ai/lachesis";
import {
  createInMemoryGraphEvidenceSource,
  M3A_DETERMINISTIC_CORPUS,
  M3A_REFERENCE_GRAPH,
  selectEvidence,
} from "@nicia-ai/lachesis-evidence";
import {
  compileCodeMode,
  createRecordedModelAdapter,
  executeCodeMode,
  freezeRecordedModelFixture,
  generatePlan,
} from "@nicia-ai/lachesis-generator";
import { z } from "zod";

const textSchema = defineSchema({
  id: "worker/text",
  version: "1",
  description: "Portable worker text.",
  validator: z.string(),
});
const echoEffect = defineEffect({
  id: "worker/echo",
  version: "1",
  description: "Echoes text through an injected worker effect.",
  input: textSchema,
  output: textSchema,
  effectName: "worker.echo",
  capability: "worker.echo",
  maxTokens: 0,
  maxWallClockMs: 1,
  replayable: true,
  stateChanging: true,
});

async function exerciseKernel(): Promise<Response> {
  const catalog = createCatalog({
    identity: { id: "worker/catalog", version: "1" },
    schemas: [textSchema.runtime],
    operations: [echoEffect],
  });
  const plan = {
    formatVersion: "1",
    catalog: { id: "worker/catalog", version: "1" },
    root: "echo",
    nodes: [
      {
        id: "message",
        op: "constant",
        schema: { id: "worker/text", version: "1" },
        value: "portable",
      },
      {
        id: "echo",
        op: "effect",
        source: "message",
        effect: { id: "worker/echo", version: "1" },
      },
    ],
    budget: {
      maxEffectCalls: 1,
      maxCollectionItems: 1,
      maxRecursionDepth: 0,
      maxTokens: 0,
      maxWallClockMs: 1,
      maxParallelism: 1,
    },
    allowedCapabilities: ["worker.echo"],
  };
  const planText = JSON.stringify(plan);
  if (!catalog.ok) return Response.json({ ok: false }, { status: 500 });
  const fixture = await freezeRecordedModelFixture({
    identity: {
      provider: "recorded",
      model: "worker-smoke",
      adapterVersion: "1",
    },
    responses: [
      {
        kind: "response",
        response: {
          rawResponse: JSON.stringify({ kind: "plan", plan }),
          structuredOutput: { kind: "plan", plan },
          usage: {
            inputTokens: 10,
            outputTokens: 10,
            costUsdMicros: 0,
          },
          latencyMs: 1,
        },
      },
    ],
  });
  if (!fixture.ok) return Response.json({ ok: false }, { status: 500 });
  const generated = await generatePlan({
    task: "Echo portable text.",
    taskInputs: [
      {
        name: "message",
        schema: { id: "portable-text", version: "1" },
        declaredBounds: [],
      },
    ],
    catalog: catalog.value,
    policy: {
      allowedCapabilities: ["worker.echo"],
      budget: plan.budget,
    },
    semanticObligations: [
      { kind: "requiresEffect", effectName: "worker.echo" },
      { kind: "requiresStateChange" },
    ],
    publicExamples: [],
    adapter: createRecordedModelAdapter(fixture.value),
    strategy: {
      id: "json-schema",
      constraint: "json-schema",
      repair: "none",
    },
  });
  if (!generated.ok || generated.value.kind !== "compiled")
    return Response.json({ ok: false }, { status: 500 });
  const compiled = await compilePlanJson(
    planText,
    catalog.value,
    {
      allowedCapabilities: ["worker.echo"],
      budget: {
        maxEffectCalls: 1,
        maxCollectionItems: 1,
        maxRecursionDepth: 0,
        maxTokens: 0,
        maxWallClockMs: 1,
        maxParallelism: 1,
      },
    },
    [
      { kind: "requiresEffect", effectName: "worker.echo" },
      { kind: "requiresStateChange" },
    ],
  );
  if (!compiled.ok) return Response.json({ ok: false }, { status: 500 });
  const summary = inspectExecutablePlan(compiled.value);
  if (summary === undefined)
    return Response.json({ ok: false }, { status: 500 });
  const executed = await executePlan(compiled.value, {
    inputs: new Map(),
    effectHandler: createMockEffectHandler(() => ({
      ok: true,
      value: {
        value: "portable",
        replayResultId: "worker/mock/0",
        usage: { tokens: 0, wallClockMs: 1 },
      },
    })),
    clock: { now: () => "2026-01-01T00:00:00.000Z" },
    runIdProvider: { next: () => "worker-smoke" },
  });
  const codeMode = await compileCodeMode({
    source: `export default async function main(input, ops) {
      const echoed = await ops.effect("worker/echo@1", input.message);
      return echoed;
    }`,
    catalog: catalog.value,
    policy: {
      allowedCapabilities: ["worker.echo"],
      budget: plan.budget,
    },
    taskInputs: [
      {
        name: "message",
        schema: { id: "worker/text", version: "1" },
        declaredBounds: [],
      },
    ],
    semanticObligations: [
      { kind: "requiresEffect", effectName: "worker.echo" },
      { kind: "requiresStateChange" },
    ],
  });
  if (!codeMode.ok) return Response.json({ ok: false }, { status: 500 });
  const codeModeRun = await executeCodeMode(codeMode.value, {
    inputs: new Map([["message", "portable"]]),
    effectHandler: () =>
      Promise.resolve({
        ok: true,
        value: {
          value: "portable",
          usage: { tokens: 0, wallClockMs: 1 },
        },
      }),
  });
  const evidenceSource = createInMemoryGraphEvidenceSource(M3A_REFERENCE_GRAPH);
  const evidenceTask = M3A_DETERMINISTIC_CORPUS[0];
  if (!evidenceSource.ok || evidenceTask === undefined)
    return Response.json({ ok: false }, { status: 500 });
  const evidence = await selectEvidence(
    evidenceSource.value,
    evidenceTask.query,
  );
  return Response.json({
    ok:
      executed.ok &&
      codeModeRun.ok &&
      evidence.ok &&
      evidence.value.paths.length > 0,
    planHash: summary.planHash,
    canonicalLength: summary.canonicalPlan.length,
    codeModeOutput: codeModeRun.ok ? codeModeRun.value.output : null,
    evidencePaths: evidence.ok ? evidence.value.paths.length : 0,
  });
}

export default { fetch: exerciseKernel };
