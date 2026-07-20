import {
  compilePlanJson,
  createCatalog,
  defineSchema,
  inspectExecutablePlan,
  semanticObligationSchema,
} from "@nicia-ai/lachesis";
import {
  createInMemoryM5EvidenceStore,
  createInMemoryGraphEvidenceSource,
  M3A1_PREREGISTERED_CORPUS,
  M3A1_REFERENCE_GRAPH,
  M5A_RUNTIME_PROTOCOL,
  selectEvidence,
} from "@nicia-ai/lachesis-evidence";
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
if (
  !semanticObligationSchema.safeParse({ kind: "requiresStateChange" }).success
)
  throw new Error("Node smoke semantic-obligation export failed");
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
const evidenceSource = createInMemoryGraphEvidenceSource(M3A1_REFERENCE_GRAPH);
if (!evidenceSource.ok) throw new Error("Node evidence source failed");
const evidenceTask = M3A1_PREREGISTERED_CORPUS[0];
if (evidenceTask === undefined) throw new Error("Node evidence task missing");
const evidence = await selectEvidence(evidenceSource.value, evidenceTask.query);
if (!evidence.ok || evidence.value.context.paths.length === 0)
  throw new Error("Node evidence selection failed");
const runtimeStore = await createInMemoryM5EvidenceStore({
  id: "node-smoke-evidence",
  version: "1",
  snapshots: [
    {
      recordedAt: "2026-01-01T00:00:00.000Z",
      graph: M3A1_REFERENCE_GRAPH,
    },
  ],
});
if (
  !runtimeStore.ok ||
  M5A_RUNTIME_PROTOCOL.defaultEvidenceView !== "lexical-facts"
)
  throw new Error("Node M5 evidence-runtime smoke failed");
process.stdout.write("Node public-package smoke passed.\n");
