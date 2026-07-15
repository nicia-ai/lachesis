import {
  analyzePlan,
  canonicalizePlan,
  checkPlan,
  createCatalog,
  createReplayEffectHandler,
  defineEffect,
  defineSchema,
  executePlan,
  hashPlan,
  normalizePlan,
  parsePlanJson,
} from "@nicia-ai/lachesis";
import { z } from "zod";

const textSchema = defineSchema({
  id: "worker/text",
  version: "1",
  validator: z.string(),
});
const echoEffect = defineEffect({
  id: "worker/echo",
  version: "1",
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
  const parsed = parsePlanJson(
    JSON.stringify({
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
    }),
  );
  if (!catalog.ok || !parsed.ok)
    return Response.json({ ok: false }, { status: 500 });
  const normalized = normalizePlan(parsed.value);
  if (!normalized.ok) return Response.json({ ok: false }, { status: 500 });
  const checked = checkPlan(normalized.value, catalog.value);
  if (!checked.ok) return Response.json({ ok: false }, { status: 500 });
  const analysis = analyzePlan(checked.value);
  const canonical = canonicalizePlan(parsed.value);
  const hash = await hashPlan(parsed.value);
  if (!analysis.ok || !canonical.ok || !hash.ok)
    return Response.json({ ok: false }, { status: 500 });
  const executed = await executePlan(
    checked.value,
    analysis.value,
    catalog.value,
    {
      inputs: new Map(),
      effectHandler: createReplayEffectHandler([
        {
          invocationId: "echo:0",
          value: "portable",
          replayResultId: "worker/replay/0",
          usage: { tokens: 0, wallClockMs: 1 },
        },
      ]),
      clock: { now: () => "2026-01-01T00:00:00.000Z" },
      runIdProvider: { next: () => "worker-smoke" },
    },
  );
  return Response.json({
    ok: executed.ok,
    planHash: hash.value,
    canonicalLength: canonical.value.length,
  });
}

export default { fetch: exerciseKernel };
