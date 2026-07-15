import {
  compilePlanJson,
  createCatalog,
  defineSchema,
  inspectExecutablePlan,
} from "@nicia-ai/lachesis";
import { z } from "zod";

const truth = defineSchema({
  id: "smoke/truth",
  version: "1",
  description: "A portable smoke-test boolean.",
  validator: z.boolean(),
  semantic: "boolean",
});
const catalogResult = createCatalog({
  identity: { id: "smoke/catalog", version: "1" },
  schemas: [truth.runtime],
  operations: [],
});
if (!catalogResult.ok) throw new Error("Node smoke catalog failed");
const planText = JSON.stringify({
  formatVersion: "1",
  catalog: { id: "smoke/catalog", version: "1" },
  root: "answer",
  nodes: [
    {
      id: "answer",
      op: "constant",
      schema: { id: "smoke/truth", version: "1" },
      value: true,
    },
  ],
  budget: {
    maxEffectCalls: 0,
    maxCollectionItems: 1,
    maxRecursionDepth: 0,
    maxTokens: 0,
    maxWallClockMs: 0,
    maxParallelism: 1,
  },
  allowedCapabilities: [],
});
const compiled = await compilePlanJson(planText, catalogResult.value, {
  allowedCapabilities: [],
  budget: {
    maxEffectCalls: 0,
    maxCollectionItems: 1,
    maxRecursionDepth: 0,
    maxTokens: 0,
    maxWallClockMs: 0,
    maxParallelism: 1,
  },
});
if (!compiled.ok) throw new Error("Node smoke compilation failed");
const summary = inspectExecutablePlan(compiled.value);
if (
  summary === undefined ||
  !summary.canonicalPlan.includes('"formatVersion":"1"')
)
  throw new Error("Node smoke canonicalization failed");
process.stdout.write("Node public-package smoke passed.\n");
