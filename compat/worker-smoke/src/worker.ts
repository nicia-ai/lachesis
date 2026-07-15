import {
  compilePlanJson,
  createCatalog,
  createMockEffectHandler,
  defineEffect,
  defineSchema,
  executePlan,
  inspectExecutablePlan,
} from "@nicia-ai/lachesis";
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
});

async function exerciseKernel(): Promise<Response> {
  const catalog = createCatalog({
    identity: { id: "worker/catalog", version: "1" },
    schemas: [textSchema.runtime],
    operations: [echoEffect],
  });
  const planText = JSON.stringify({
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
  });
  if (!catalog.ok) return Response.json({ ok: false }, { status: 500 });
  const compiled = await compilePlanJson(planText, catalog.value, {
    allowedCapabilities: ["worker.echo"],
    budget: {
      maxEffectCalls: 1,
      maxCollectionItems: 1,
      maxRecursionDepth: 0,
      maxTokens: 0,
      maxWallClockMs: 1,
      maxParallelism: 1,
    },
  });
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
  return Response.json({
    ok: executed.ok,
    planHash: summary.planHash,
    canonicalLength: summary.canonicalPlan.length,
  });
}

export default { fetch: exerciseKernel };
