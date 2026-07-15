import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  aggregateBound,
  analyzePlan,
  canonicalizeJson,
  canonicalizePlan,
  type Catalog,
  type CheckedPlan,
  checkPlan,
  createCatalog,
  createMockEffectHandler,
  createReplayEffectHandler,
  diagnostic,
  executePlan,
  hashPlan,
  normalizePlan,
  parseJson,
  parsePlanJson,
  type PlanAnalysis,
  type ReplayEntry,
  unionEffectSets,
  type WirePlan,
} from "@nicia-ai/lachesis";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createExampleCatalog } from "../src/example-catalog.js";

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "../../..");

async function loadPlan(name: string): Promise<WirePlan> {
  const parsed = parsePlanJson(
    await readFile(resolve(ROOT, "fixtures/plans", name), "utf8"),
  );
  if (!parsed.ok)
    throw new Error(parsed.error.map((item) => item.message).join("; "));
  return parsed.value;
}

function compile(
  plan: WirePlan,
  catalog: Catalog = createExampleCatalog(),
): Readonly<{
  checked: CheckedPlan;
  analysis: PlanAnalysis;
}> {
  const normalized = normalizePlan(plan);
  if (!normalized.ok)
    throw new Error(normalized.error.map((item) => item.message).join("; "));
  const checked = checkPlan(normalized.value, catalog);
  if (!checked.ok)
    throw new Error(checked.error.map((item) => item.message).join("; "));
  const analysis = analyzePlan(checked.value);
  if (!analysis.ok)
    throw new Error(analysis.error.map((item) => item.message).join("; "));
  return { checked: checked.value, analysis: analysis.value };
}

function basePlan(nodes: ReadonlyArray<unknown>, root: string): WirePlan {
  const parsed = parsePlanJson(
    JSON.stringify({
      formatVersion: "1",
      catalog: { id: "example/catalog", version: "1" },
      root,
      nodes,
      budget: {
        maxEffectCalls: 20,
        maxCollectionItems: 20,
        maxRecursionDepth: 20,
        maxTokens: 20_000,
        maxWallClockMs: 20_000,
        maxParallelism: 4,
      },
      allowedCapabilities: ["llm.invoke:extractor", "llm.invoke:synthesizer"],
    }),
  );
  if (!parsed.ok)
    throw new Error(parsed.error.map((item) => item.message).join("; "));
  return parsed.value;
}

function deterministicOptions(
  entries: ReadonlyArray<ReplayEntry>,
): Parameters<typeof executePlan>[3] {
  let tick = 0;
  return {
    inputs: new Map([
      [
        "fragments",
        [
          { id: "f1", text: "one" },
          { id: "f2", text: "two" },
        ],
      ],
    ]),
    effectHandler: createReplayEffectHandler(entries),
    clock: {
      now: () => `2026-01-01T00:00:${String(tick++).padStart(2, "0")}.000Z`,
    },
    runIdProvider: { next: () => "test-run" },
  };
}

describe("wire parsing and normalization", () => {
  it("distinguishes malformed, unsupported, and invalid wire documents", () => {
    const malformed = parsePlanJson("{");
    const unsupported = parsePlanJson('{"formatVersion":"2"}');
    const invalid = parsePlanJson('{"formatVersion":"1"}');
    expect(malformed.ok ? undefined : malformed.error[0]?.code).toBe(
      "MALFORMED_JSON",
    );
    expect(unsupported.ok ? undefined : unsupported.error[0]?.code).toBe(
      "UNSUPPORTED_PLAN_VERSION",
    );
    expect(invalid.ok ? undefined : invalid.error[0]?.code).toBe(
      "INVALID_WIRE_SCHEMA",
    );
  });

  it("rejects duplicate IDs, missing roots, dangling references, and cycles", () => {
    const constant = {
      id: "value",
      op: "constant",
      schema: { id: "core/boolean", version: "1" },
      value: true,
    } as const;
    const duplicate = normalizePlan(basePlan([constant, constant], "value"));
    expect(duplicate.ok ? undefined : duplicate.error[0]?.code).toBe(
      "DUPLICATE_NODE_ID",
    );

    const missingRoot = normalizePlan(basePlan([constant], "other"));
    expect(missingRoot.ok ? undefined : missingRoot.error[0]?.code).toBe(
      "MISSING_ROOT",
    );

    const dangling = normalizePlan(
      basePlan(
        [{ id: "cp", op: "checkpoint", source: "missing", label: "cp" }],
        "cp",
      ),
    );
    expect(dangling.ok ? undefined : dangling.error[0]?.code).toBe(
      "MISSING_NODE_REFERENCE",
    );

    const cycle = normalizePlan(
      basePlan(
        [
          { id: "a", op: "checkpoint", source: "b", label: "a" },
          { id: "b", op: "checkpoint", source: "a", label: "b" },
        ],
        "a",
      ),
    );
    expect(cycle.ok ? undefined : cycle.error[0]?.code).toBe("GRAPH_CYCLE");
  });
});

describe("catalog and checker", () => {
  it("checks every node variant and nominally infers schemas", () => {
    const plan = basePlan(
      [
        {
          id: "fragments",
          op: "input",
          inputKey: "fragments",
          schema: { id: "example/fragments", version: "1" },
          maxItems: 2,
        },
        {
          id: "fragment",
          op: "constant",
          schema: { id: "example/fragment", version: "1" },
          value: { id: "f", text: "claim" },
        },
        {
          id: "invoked",
          op: "invoke",
          source: "fragment",
          function: { id: "example/fragment-to-claim", version: "1" },
        },
        {
          id: "mapped",
          op: "map",
          source: "fragments",
          operation: {
            kind: "function",
            id: "example/fragment-to-claim",
            version: "1",
          },
          outputCollectionSchema: { id: "example/claims", version: "1" },
          parallelism: 2,
        },
        {
          id: "filtered",
          op: "filter",
          source: "mapped",
          predicate: { id: "example/claim-is-nonempty", version: "1" },
        },
        {
          id: "folded",
          op: "fold",
          source: "filtered",
          reducer: { id: "example/claim-union", version: "1" },
        },
        {
          id: "condition",
          op: "constant",
          schema: { id: "core/boolean", version: "1" },
          value: true,
        },
        {
          id: "empty",
          op: "constant",
          schema: { id: "example/claims", version: "1" },
          value: [],
        },
        {
          id: "selected",
          op: "select",
          condition: "condition",
          whenTrue: "folded",
          whenFalse: "empty",
        },
        {
          id: "checkpoint",
          op: "checkpoint",
          source: "selected",
          label: "claims-ready",
        },
        {
          id: "synthesis",
          op: "effect",
          source: "checkpoint",
          effect: { id: "example/synthesize", version: "1" },
        },
        {
          id: "seed",
          op: "constant",
          schema: { id: "example/countdown", version: "1" },
          value: { remaining: 2 },
        },
        {
          id: "fixed",
          op: "boundedFix",
          seed: "seed",
          step: { id: "example/countdown-step", version: "1" },
          measure: { id: "example/countdown-measure", version: "1" },
          maxIterations: 2,
        },
      ],
      "synthesis",
    );
    const result = compile(plan);
    expect(result.checked.nodes.size).toBe(13);
    expect(
      [...result.checked.nodes.values()].find(
        (node) => node.node.id === "invoked",
      )?.outputSchema.id,
    ).toBe("example/claim");
    expect(
      [...result.checked.nodes.values()].find(
        (node) => node.node.id === "fixed",
      )?.outputSchema.id,
    ).toBe("example/countdown");
  });

  it("reports unknown schemas, operations, kind mismatches, and type mismatches", () => {
    const unknownSchemaPlan = basePlan(
      [
        {
          id: "x",
          op: "constant",
          schema: { id: "missing", version: "1" },
          value: true,
        },
      ],
      "x",
    );
    const normalizedSchema = normalizePlan(unknownSchemaPlan);
    if (!normalizedSchema.ok) throw new Error("normalization failed");
    const unknownSchema = checkPlan(
      normalizedSchema.value,
      createExampleCatalog(),
    );
    expect(unknownSchema.ok ? undefined : unknownSchema.error[0]?.code).toBe(
      "UNKNOWN_SCHEMA",
    );

    const unknownOperationPlan = basePlan(
      [
        {
          id: "x",
          op: "constant",
          schema: { id: "example/fragment", version: "1" },
          value: { id: "x", text: "x" },
        },
        {
          id: "y",
          op: "invoke",
          source: "x",
          function: { id: "missing", version: "1" },
        },
      ],
      "y",
    );
    const normalizedOperation = normalizePlan(unknownOperationPlan);
    if (!normalizedOperation.ok) throw new Error("normalization failed");
    const unknownOperation = checkPlan(
      normalizedOperation.value,
      createExampleCatalog(),
    );
    expect(
      unknownOperation.ok ? undefined : unknownOperation.error[0]?.code,
    ).toBe("UNKNOWN_OPERATION");

    const kindPlan = basePlan(
      [
        {
          id: "x",
          op: "constant",
          schema: { id: "example/claims", version: "1" },
          value: [],
        },
        {
          id: "y",
          op: "invoke",
          source: "x",
          function: { id: "example/claim-union", version: "1" },
        },
      ],
      "y",
    );
    const normalizedKind = normalizePlan(kindPlan);
    if (!normalizedKind.ok) throw new Error("normalization failed");
    const wrongKind = checkPlan(normalizedKind.value, createExampleCatalog());
    expect(wrongKind.ok ? undefined : wrongKind.error[0]?.code).toBe(
      "OPERATION_KIND_MISMATCH",
    );

    const typePlan = basePlan(
      [
        {
          id: "x",
          op: "constant",
          schema: { id: "example/claims", version: "1" },
          value: [],
        },
        {
          id: "y",
          op: "invoke",
          source: "x",
          function: { id: "example/fragment-to-claim", version: "1" },
        },
      ],
      "y",
    );
    const normalizedType = normalizePlan(typePlan);
    if (!normalizedType.ok) throw new Error("normalization failed");
    const wrongType = checkPlan(normalizedType.value, createExampleCatalog());
    expect(wrongType.ok ? undefined : wrongType.error[0]?.code).toBe(
      "TYPE_MISMATCH",
    );
  });

  it("reports branch mismatches and invalid or undeclared catalog operations", async () => {
    const branch = await loadPlan("branch-mismatch.invalid.json");
    const normalized = normalizePlan(branch);
    if (!normalized.ok) throw new Error("normalization failed");
    const checked = checkPlan(normalized.value, createExampleCatalog());
    expect(checked.ok ? undefined : checked.error[0]?.code).toBe(
      "BRANCH_TYPE_MISMATCH",
    );

    const catalog = createExampleCatalog();
    const schema = catalog.schemas.values().next().value;
    if (schema === undefined) throw new Error("schema missing");
    const invalidReducer = createCatalog({
      identity: { id: "bad", version: "1" },
      schemas: [schema],
      operations: [
        {
          kind: "reducer",
          id: "bad/reducer",
          version: "1",
          element: { id: "missing", version: "1" },
          accumulator: { id: schema.id, version: schema.version },
          identity: true,
          laws: { associative: true, commutative: true, idempotent: true },
          reduce: (value) => ({ ok: true, value }),
        },
      ],
    });
    expect(invalidReducer.ok ? undefined : invalidReducer.error[0]?.code).toBe(
      "INVALID_REDUCER",
    );

    const undeclared = createCatalog({
      identity: { id: "bad", version: "1" },
      schemas: [schema],
      operations: [
        {
          kind: "effect",
          id: "bad/effect",
          version: "1",
          input: { id: schema.id, version: schema.version },
          output: { id: schema.id, version: schema.version },
          effectName: "",
          capability: "",
          maxTokens: 0,
          maxWallClockMs: 0,
          replayable: true,
        },
      ],
    });
    expect(undeclared.ok ? undefined : undeclared.error[0]?.code).toBe(
      "UNDECLARED_EFFECT",
    );
  });
});

describe("analysis", () => {
  it("infers effects, capabilities, stages, and conservative known bounds", async () => {
    const { analysis } = compile(await loadPlan("document-claims.valid.json"));
    expect([...analysis.effectsUsed]).toEqual([
      "model.extract",
      "model.synthesize",
    ]);
    expect(analysis.maximumEffectCalls).toEqual({ kind: "known", value: 4 });
    expect(analysis.maximumParallelism).toEqual({ kind: "known", value: 2 });
    expect(analysis.topologicalStages).toHaveLength(4);
    expect(analysis.everyRelevantBoundProven).toBe(true);
  });

  it("rejects denied capabilities, unbounded fan-out, and exceeded budgets", async () => {
    for (const [fixture, code] of [
      ["capability-denied.invalid.json", "DENIED_CAPABILITY"],
      ["unbounded-fanout.invalid.json", "UNBOUNDED_CARDINALITY"],
    ] as const) {
      const plan = await loadPlan(fixture);
      const normalized = normalizePlan(plan);
      if (!normalized.ok) throw new Error("normalization failed");
      const checked = checkPlan(normalized.value, createExampleCatalog());
      if (!checked.ok) throw new Error("checking failed");
      const analysis = analyzePlan(checked.value);
      expect(analysis.ok ? undefined : analysis.error[0]?.code).toBe(code);
    }
    const valid = await loadPlan("document-claims.valid.json");
    const overBudget: WirePlan = {
      ...valid,
      budget: { ...valid.budget, maxEffectCalls: 3 },
    };
    const normalized = normalizePlan(overBudget);
    if (!normalized.ok) throw new Error("normalization failed");
    const checked = checkPlan(normalized.value, createExampleCatalog());
    if (!checked.ok) throw new Error("checking failed");
    const analysis = analyzePlan(checked.value);
    expect(analysis.ok ? undefined : analysis.error[0]?.code).toBe(
      "BUDGET_EXCEEDED",
    );
  });

  it("obeys effect-set union laws and monotone budget aggregation", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string()),
        fc.uniqueArray(fc.string()),
        (left, right) => {
          const leftSet = new Set(left);
          const rightSet = new Set(right);
          expect(unionEffectSets(leftSet, leftSet)).toEqual(leftSet);
          expect(unionEffectSets(leftSet, rightSet)).toEqual(
            unionEffectSets(rightSet, leftSet),
          );
          expect(
            unionEffectSets(unionEffectSets(leftSet, rightSet), leftSet),
          ).toEqual(
            unionEffectSets(leftSet, unionEffectSets(rightSet, leftSet)),
          );
        },
      ),
    );
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (base, increment) => {
        const total = aggregateBound(
          { kind: "known", value: base },
          { kind: "known", value: increment },
        );
        expect(total.kind === "known" && total.value >= base).toBe(true);
      }),
    );
  });
});

describe("canonical identity", () => {
  it("is idempotent and stable under object-key reordering", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const first = canonicalizeJson(value);
        if (!first.ok) throw new Error(first.error.message);
        const parsed = parseJson(first.value);
        if (!parsed.ok) throw new Error(parsed.error.message);
        const second = canonicalizeJson(parsed.value);
        expect(second).toEqual(first);
      }),
    );
    const left = canonicalizeJson({ z: 1, a: { d: 2, b: 3 } });
    const right = canonicalizeJson({ a: { b: 3, d: 2 }, z: 1 });
    expect(left).toEqual(right);
  });

  it("keeps hashes stable and changes them for semantic changes", async () => {
    const plan = await loadPlan("document-claims.valid.json");
    const reordered = parsePlanJson(
      JSON.stringify({
        allowedCapabilities: plan.allowedCapabilities,
        nodes: plan.nodes,
        root: plan.root,
        catalog: plan.catalog,
        budget: plan.budget,
        metadata: plan.metadata,
        formatVersion: plan.formatVersion,
      }),
    );
    if (!reordered.ok) throw new Error("reordered parse failed");
    expect(await hashPlan(reordered.value)).toEqual(await hashPlan(plan));
    const changed: WirePlan = {
      ...plan,
      budget: { ...plan.budget, maxTokens: plan.budget.maxTokens + 1 },
    };
    expect(await hashPlan(changed)).not.toEqual(await hashPlan(plan));
    const canonical = canonicalizePlan(plan);
    expect(canonical.ok && canonical.value.startsWith("{")).toBe(true);
  });
});

describe("execution and provenance", () => {
  it("executes the complete pure algebra and a successful bounded fix", async () => {
    const purePlan = basePlan(
      [
        {
          id: "fragments",
          op: "input",
          inputKey: "fragments",
          schema: { id: "example/fragments", version: "1" },
          maxItems: 2,
        },
        {
          id: "mapped",
          op: "map",
          source: "fragments",
          operation: {
            kind: "function",
            id: "example/fragment-to-claim",
            version: "1",
          },
          outputCollectionSchema: { id: "example/claims", version: "1" },
          parallelism: 2,
        },
        {
          id: "filtered",
          op: "filter",
          source: "mapped",
          predicate: { id: "example/claim-is-nonempty", version: "1" },
        },
        {
          id: "folded",
          op: "fold",
          source: "filtered",
          reducer: { id: "example/claim-union", version: "1" },
        },
        {
          id: "condition",
          op: "constant",
          schema: { id: "core/boolean", version: "1" },
          value: true,
        },
        {
          id: "empty",
          op: "constant",
          schema: { id: "example/claims", version: "1" },
          value: [],
        },
        {
          id: "selected",
          op: "select",
          condition: "condition",
          whenTrue: "folded",
          whenFalse: "empty",
        },
        {
          id: "checkpoint",
          op: "checkpoint",
          source: "selected",
          label: "done",
        },
      ],
      "checkpoint",
    );
    const pure = compile(purePlan);
    const pureResult = await executePlan(
      pure.checked,
      pure.analysis,
      createExampleCatalog(),
      deterministicOptions([]),
    );
    expect(pureResult.ok ? pureResult.value.output : undefined).toEqual([
      { id: "f1", text: "one" },
      { id: "f2", text: "two" },
    ]);

    const invokePlan = basePlan(
      [
        {
          id: "fragment",
          op: "constant",
          schema: { id: "example/fragment", version: "1" },
          value: { id: "f", text: "invoked" },
        },
        {
          id: "invoked",
          op: "invoke",
          source: "fragment",
          function: { id: "example/fragment-to-claim", version: "1" },
        },
      ],
      "invoked",
    );
    const invoked = compile(invokePlan);
    const invokeResult = await executePlan(
      invoked.checked,
      invoked.analysis,
      createExampleCatalog(),
      deterministicOptions([]),
    );
    expect(invokeResult.ok ? invokeResult.value.output : undefined).toEqual({
      id: "f",
      text: "invoked",
    });

    const fixPlan = basePlan(
      [
        {
          id: "seed",
          op: "constant",
          schema: { id: "example/countdown", version: "1" },
          value: { remaining: 2 },
        },
        {
          id: "fix",
          op: "boundedFix",
          seed: "seed",
          step: { id: "example/countdown-step", version: "1" },
          measure: { id: "example/countdown-measure", version: "1" },
          maxIterations: 2,
        },
      ],
      "fix",
    );
    const fixed = compile(fixPlan);
    const fixResult = await executePlan(
      fixed.checked,
      fixed.analysis,
      createExampleCatalog(),
      deterministicOptions([]),
    );
    expect(fixResult.ok ? fixResult.value.output : undefined).toEqual({
      remaining: 0,
    });
  });

  it("replays mapped effects in stable order and produces identical traces", async () => {
    const plan = await loadPlan("document-claims.valid.json");
    const compiled = compile(plan);
    const replay = parseJson(
      await readFile(
        resolve(ROOT, "fixtures/effects/document-claims.replay.json"),
        "utf8",
      ),
    );
    if (!replay.ok) throw new Error(replay.error.message);
    const parsedEntries = z
      .array(
        z.strictObject({
          invocationId: z.string(),
          value: z.json(),
          replayResultId: z.string(),
          usage: z.strictObject({
            tokens: z.number(),
            wallClockMs: z.number(),
          }),
        }),
      )
      .safeParse(replay.value);
    if (!parsedEntries.success) throw new Error(parsedEntries.error.message);
    const entries = parsedEntries.data;
    const first = await executePlan(
      compiled.checked,
      compiled.analysis,
      createExampleCatalog(),
      deterministicOptions(entries),
    );
    const second = await executePlan(
      compiled.checked,
      compiled.analysis,
      createExampleCatalog(),
      deterministicOptions(entries),
    );
    expect(first).toEqual(second);
    if (!first.ok) throw new Error(first.error.diagnostics[0]?.message);
    expect(first.value.outputDigest).toBe(
      "068e8e62fa164d15b4580b5d59798175afcca41c8af2fd544bc8e61daaea7367",
    );
    expect(first.value.trace.finalUsage.effectCalls).toBe(3);
    expect(
      first.value.trace.events
        .filter((event) => event.kind === "effectInvoked")
        .map((event) => event.invocationId),
    ).toEqual(["extracted:0", "extracted:1", "synthesis:0"]);
  });

  it("rejects missing replay values and invalid effect outputs", async () => {
    const plan = await loadPlan("document-claims.valid.json");
    const compiled = compile(plan);
    const missing = await executePlan(
      compiled.checked,
      compiled.analysis,
      createExampleCatalog(),
      deterministicOptions([]),
    );
    expect(missing.ok ? undefined : missing.error.diagnostics[0]?.code).toBe(
      "MISSING_REPLAY_RESULT",
    );
    expect(
      missing.ok
        ? undefined
        : missing.error.trace?.events.some(
            (event) => event.kind === "nodeFailed",
          ),
    ).toBe(true);

    const invalidEntry: ReplayEntry = {
      invocationId: "extracted:0",
      value: { wrong: true },
      replayResultId: "invalid",
      usage: { tokens: 0, wallClockMs: 0 },
    };
    const invalid = await executePlan(
      compiled.checked,
      compiled.analysis,
      createExampleCatalog(),
      deterministicOptions([invalidEntry]),
    );
    expect(invalid.ok ? undefined : invalid.error.diagnostics[0]?.code).toBe(
      "RUNTIME_SCHEMA_VIOLATION",
    );
  });

  it("supports deterministic caller-owned mock effects", async () => {
    const plan = await loadPlan("document-claims.valid.json");
    const compiled = compile(plan);
    const options = deterministicOptions([]);
    const mocked = await executePlan(
      compiled.checked,
      compiled.analysis,
      createExampleCatalog(),
      {
        ...options,
        effectHandler: createMockEffectHandler((request) => {
          if (request.effectName === "model.extract") {
            const text =
              typeof request.input === "object" &&
              request.input !== null &&
              "text" in request.input
                ? request.input.text
                : "";
            const id = request.invocationId.endsWith(":0") ? "c1" : "c2";
            return {
              ok: true,
              value: {
                value: { id, text },
                replayResultId: `mock/${request.invocationId}`,
                usage: { tokens: 0, wallClockMs: 0 },
              },
            };
          }
          return {
            ok: true,
            value: {
              value: { text: "mocked", claimIds: ["c1", "c2"] },
              replayResultId: "mock/synthesis",
              usage: { tokens: 0, wallClockMs: 0 },
            },
          };
        }),
      },
    );
    expect(mocked.ok ? mocked.value.output : undefined).toEqual({
      text: "mocked",
      claimIds: ["c1", "c2"],
    });
  });

  it("enforces runtime input cardinality, usage shape, and actual budgets", async () => {
    const plan = await loadPlan("document-claims.valid.json");
    const compiled = compile(plan);
    const missingOptions = deterministicOptions([]);
    const missing = await executePlan(
      compiled.checked,
      compiled.analysis,
      createExampleCatalog(),
      { ...missingOptions, inputs: new Map() },
    );
    expect(missing.ok ? undefined : missing.error.diagnostics[0]?.code).toBe(
      "RUNTIME_SCHEMA_VIOLATION",
    );

    const oversizedOptions = deterministicOptions([]);
    const oversized = await executePlan(
      compiled.checked,
      compiled.analysis,
      createExampleCatalog(),
      {
        ...oversizedOptions,
        inputs: new Map([
          [
            "fragments",
            [
              { id: "1", text: "1" },
              { id: "2", text: "2" },
              { id: "3", text: "3" },
              { id: "4", text: "4" },
            ],
          ],
        ]),
      },
    );
    expect(
      oversized.ok ? undefined : oversized.error.diagnostics[0]?.code,
    ).toBe("BUDGET_EXCEEDED");

    const badUsageOptions = deterministicOptions([]);
    const badUsage = await executePlan(
      compiled.checked,
      compiled.analysis,
      createExampleCatalog(),
      {
        ...badUsageOptions,
        effectHandler: createMockEffectHandler(() => ({
          ok: true,
          value: {
            value: { id: "c", text: "c" },
            replayResultId: "bad-usage",
            usage: { tokens: -1, wallClockMs: 0 },
          },
        })),
      },
    );
    expect(badUsage.ok ? undefined : badUsage.error.diagnostics[0]?.code).toBe(
      "RUNTIME_SCHEMA_VIOLATION",
    );

    const overBudgetOptions = deterministicOptions([]);
    const overBudget = await executePlan(
      compiled.checked,
      compiled.analysis,
      createExampleCatalog(),
      {
        ...overBudgetOptions,
        effectHandler: createMockEffectHandler((request) => ({
          ok: true,
          value: {
            value:
              request.effectName === "model.extract"
                ? { id: request.invocationId, text: "claim" }
                : { text: "summary", claimIds: [] },
            replayResultId: "over-budget",
            usage: { tokens: 2_000, wallClockMs: 0 },
          },
        })),
      },
    );
    expect(
      overBudget.ok ? undefined : overBudget.error.diagnostics[0]?.code,
    ).toBe("BUDGET_EXCEEDED");
  });

  it("enforces decreasing measures and bounded recursion at runtime", async () => {
    const stuckPlan = await loadPlan("non-decreasing-recursion.invalid.json");
    const stuck = compile(stuckPlan);
    const stuckResult = await executePlan(
      stuck.checked,
      stuck.analysis,
      createExampleCatalog(),
      deterministicOptions([]),
    );
    expect(
      stuckResult.ok ? undefined : stuckResult.error.diagnostics[0]?.code,
    ).toBe("NON_DECREASING_RECURSION_MEASURE");

    const exhaustedPlan = basePlan(
      [
        {
          id: "seed",
          op: "constant",
          schema: { id: "example/countdown", version: "1" },
          value: { remaining: 2 },
        },
        {
          id: "fix",
          op: "boundedFix",
          seed: "seed",
          step: { id: "example/countdown-step", version: "1" },
          measure: { id: "example/countdown-measure", version: "1" },
          maxIterations: 1,
        },
      ],
      "fix",
    );
    const exhausted = compile(exhaustedPlan);
    const exhaustedResult = await executePlan(
      exhausted.checked,
      exhausted.analysis,
      createExampleCatalog(),
      deterministicOptions([]),
    );
    expect(
      exhaustedResult.ok
        ? undefined
        : exhaustedResult.error.diagnostics[0]?.code,
    ).toBe("UNBOUNDED_RECURSION");
  });

  it("property-tests the declared claim reducer laws", () => {
    const reducer = createExampleCatalog().operations.get(
      "example/claim-union@1",
    );
    if (reducer?.kind !== "reducer") throw new Error("fixture reducer missing");
    const runtimeReducer = reducer;
    function reduce(
      claims: ReadonlyArray<Readonly<{ id: string; text: string }>>,
    ): unknown {
      let accumulator: unknown = runtimeReducer.identity;
      for (const claim of claims) {
        const result = runtimeReducer.reduce(accumulator, claim);
        if (!result.ok) throw new Error(result.error.message);
        accumulator = result.value;
      }
      return accumulator;
    }
    const claim = fc.record({ id: fc.string(), text: fc.string() });
    fc.assert(
      fc.property(claim, claim, claim, (a, b, c) => {
        expect(reduce([a, b, c])).toEqual(reduce([c, a, b]));
        expect(reduce([a, a])).toEqual(reduce([a]));
        expect(reduce([a, b, c])).toEqual(reduce([...([a, b] as const), c]));
      }),
    );
  });

  it("property-tests rejection of non-decreasing measures", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (remaining) => {
        const fixture = await loadPlan("non-decreasing-recursion.invalid.json");
        const nodes = fixture.nodes.map((node) =>
          node.id === "seed" && node.op === "constant"
            ? { ...node, value: { remaining } }
            : node,
        );
        const compiled = compile({ ...fixture, nodes });
        const result = await executePlan(
          compiled.checked,
          compiled.analysis,
          createExampleCatalog(),
          deterministicOptions([]),
        );
        expect(result.ok ? undefined : result.error.diagnostics[0]?.code).toBe(
          "NON_DECREASING_RECURSION_MEASURE",
        );
      }),
    );
  });
});

describe("CLI", () => {
  it("uses deterministic success, rejection, and usage exit codes with JSON output", async () => {
    const cli = resolve(ROOT, "apps/cli/dist/cli.js");
    const valid = await execFileAsync(
      process.execPath,
      [cli, "validate", "fixtures/plans/document-claims.valid.json", "--json"],
      {
        cwd: ROOT,
      },
    );
    const output = parseJson(valid.stdout);
    expect(output.ok ? output.value : undefined).toEqual({
      valid: true,
      rootSchema: "example/summary",
    });

    await expect(
      execFileAsync(
        process.execPath,
        [
          cli,
          "validate",
          "fixtures/plans/capability-denied.invalid.json",
          "--json",
        ],
        {
          cwd: ROOT,
        },
      ),
    ).rejects.toMatchObject({ code: 1 });
    await expect(
      execFileAsync(process.execPath, [cli], { cwd: ROOT }),
    ).rejects.toMatchObject({ code: 2 });
  });
});

describe("diagnostics", () => {
  it("creates stable machine-readable details", () => {
    expect(
      diagnostic("INTERNAL_INVARIANT_VIOLATION", "invariant", { nodeId: "x" }),
    ).toEqual({
      code: "INTERNAL_INVARIANT_VIOLATION",
      message: "invariant",
      location: { nodeId: "x" },
      details: [],
    });
  });
});
