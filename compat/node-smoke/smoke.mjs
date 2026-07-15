import {
  analyzePlan,
  canonicalizePlan,
  checkPlan,
  createCatalog,
  defineSchema,
  normalizePlan,
  parsePlanJson,
} from "@nicia-ai/lachesis";
import { z } from "zod";

const truth = defineSchema({
  id: "smoke/truth",
  version: "1",
  validator: z.boolean(),
  semantic: "boolean",
});
const catalogResult = createCatalog({
  identity: { id: "smoke/catalog", version: "1" },
  schemas: [truth.runtime],
  operations: [],
});
if (!catalogResult.ok) throw new Error("Node smoke catalog failed");
const parsed = parsePlanJson(
  JSON.stringify({
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
  }),
);
if (!parsed.ok) throw new Error("Node smoke parse failed");
const normalized = normalizePlan(parsed.value);
if (!normalized.ok) throw new Error("Node smoke normalization failed");
const checked = checkPlan(normalized.value, catalogResult.value);
if (!checked.ok) throw new Error("Node smoke checking failed");
const analyzed = analyzePlan(checked.value);
if (!analyzed.ok) throw new Error("Node smoke analysis failed");
const canonical = canonicalizePlan(parsed.value);
if (!canonical.ok || !canonical.value.includes('"formatVersion":"1"'))
  throw new Error("Node smoke canonicalization failed");
process.stdout.write("Node public-package smoke passed.\n");
