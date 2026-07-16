import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  canonicalizeJson,
  type Catalog,
  compilePlanJson,
  createCatalog,
  createMockEffectHandler,
  createPlanLanguageManifest,
  createReplayEffectHandler,
  defineEffect,
  diagnostic,
  type DiagnosticCode,
  type EffectHandler,
  type EffectRequest,
  type EffectResult,
  type ExecutablePlan,
  executePlan,
  fingerprintCatalog,
  inspectExecutablePlan,
  parseJson,
  recordEffectResult,
  type ReplayEntry,
  type Result,
  schemaReferenceSchema,
  wirePlanSchema,
} from "@nicia-ai/lachesis";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { normalizePlan } from "../../../packages/kernel/src/normalize.js";
import {
  claimIsNonempty,
  claimSchema,
  claimUnion,
  countdownMeasure,
  countdownStep,
  createExampleCatalog,
  exampleOperations,
  examplePolicy,
  exampleSchemas,
  extractionEffect,
  fragmentSchema,
  fragmentToClaim,
} from "../src/example-catalog.js";

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "../../..");
const inputFragments = new Map<string, unknown>([
  [
    "fragments",
    [
      { id: "f1", text: "one" },
      { id: "f2", text: "two" },
    ],
  ],
]);

async function fixture(name: string): Promise<string> {
  return readFile(resolve(ROOT, "fixtures/plans", name), "utf8");
}

function planText(
  nodes: ReadonlyArray<unknown>,
  root: string,
  overrides: Readonly<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
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
    ...overrides,
  });
}

function parseWireText(text: string) {
  const parsed = parseJson(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return wirePlanSchema.parse(parsed.value);
}

function catalogReplacing(
  replacement: (typeof exampleOperations)[number],
): Catalog {
  const catalog = createCatalog({
    identity: { id: "example/catalog", version: "1" },
    schemas: exampleSchemas,
    operations: exampleOperations.map((operation) =>
      operation.id === replacement.id ? replacement : operation,
    ),
  });
  if (!catalog.ok) throw new Error(catalog.error[0]?.message);
  return catalog.value;
}

async function compileOrThrow(
  text: string,
  catalog: Catalog = createExampleCatalog(),
): Promise<ExecutablePlan> {
  const compiled = await compilePlanJson(text, catalog, examplePolicy);
  if (!compiled.ok)
    throw new Error(compiled.error.map((item) => item.message).join("; "));
  return compiled.value;
}

function options(
  effectHandler: EffectHandler,
  inputs: ReadonlyMap<string, unknown> = inputFragments,
) {
  let tick = 0;
  return {
    inputs,
    effectHandler,
    clock: {
      now: () => `2026-01-01T00:00:${String(tick++).padStart(2, "0")}.000Z`,
    },
    runIdProvider: { next: () => "test-run" },
  };
}

function successfulEffect(request: EffectRequest): EffectResult {
  if (request.effectName === "model.extract") {
    const parsed = fragmentSchema.parse(request.input);
    if (!parsed.ok) throw new Error(parsed.error.message);
    return {
      value: { id: `c${request.invocationIndex + 1}`, text: parsed.value.text },
      replayResultId: `recording/${request.invocationId}`,
      usage: { tokens: 5, wallClockMs: 7 },
    };
  }
  return {
    value: { text: "summary", claimIds: ["c1", "c2"] },
    replayResultId: "recording/synthesis",
    usage: { tokens: 8, wallClockMs: 9 },
  };
}

function recordingHandler(entries: Array<ReplayEntry>): EffectHandler {
  return async (request) => {
    const result = successfulEffect(request);
    const recorded = await recordEffectResult(request, result);
    if (!recorded.ok) return recorded;
    entries.push(recorded.value);
    return { ok: true, value: result };
  };
}

async function recordingFor(
  text: string,
  catalog: Catalog = createExampleCatalog(),
): Promise<
  Readonly<{ executable: ExecutablePlan; entries: ReadonlyArray<ReplayEntry> }>
> {
  const executable = await compileOrThrow(text, catalog);
  const entries: Array<ReplayEntry> = [];
  const executed = await executePlan(
    executable,
    options(recordingHandler(entries)),
  );
  if (!executed.ok) throw new Error(executed.error.diagnostics[0]?.message);
  return { executable, entries };
}

function firstCode<T>(
  result: Result<T, ReadonlyArray<{ code: DiagnosticCode }>>,
) {
  return result.ok ? undefined : result.error[0]?.code;
}

describe("unskippable compilation", () => {
  it("distinguishes malformed, unsupported, and invalid wire input", async () => {
    expect(
      firstCode(
        await compilePlanJson("{", createExampleCatalog(), examplePolicy),
      ),
    ).toBe("MALFORMED_JSON");
    expect(
      firstCode(
        await compilePlanJson(
          '{"formatVersion":"2"}',
          createExampleCatalog(),
          examplePolicy,
        ),
      ),
    ).toBe("UNSUPPORTED_PLAN_VERSION");
    expect(
      firstCode(
        await compilePlanJson(
          '{"formatVersion":"1"}',
          createExampleCatalog(),
          examplePolicy,
        ),
      ),
    ).toBe("INVALID_WIRE_SCHEMA");
  });

  it("rejects duplicate IDs, missing roots, dangling edges, and cycles", async () => {
    const constant = {
      id: "value",
      op: "constant",
      schema: { id: "core/boolean", version: "1" },
      value: true,
    };
    const cases: ReadonlyArray<readonly [string, DiagnosticCode]> = [
      [planText([constant, constant], "value"), "DUPLICATE_NODE_ID"],
      [planText([constant], "other"), "MISSING_ROOT"],
      [
        planText(
          [{ id: "cp", op: "checkpoint", source: "missing", label: "cp" }],
          "cp",
        ),
        "MISSING_NODE_REFERENCE",
      ],
      [
        planText(
          [
            { id: "a", op: "checkpoint", source: "b", label: "a" },
            { id: "b", op: "checkpoint", source: "a", label: "b" },
          ],
          "a",
        ),
        "GRAPH_CYCLE",
      ],
    ];
    for (const [text, code] of cases) {
      expect(
        firstCode(
          await compilePlanJson(text, createExampleCatalog(), examplePolicy),
        ),
      ).toBe(code);
    }
  });

  it("rejects nodes that do not contribute to the root", async () => {
    const result = await compilePlanJson(
      planText(
        [
          {
            id: "root",
            op: "constant",
            schema: { id: "core/boolean", version: "1" },
            value: true,
          },
          {
            id: "dead",
            op: "constant",
            schema: { id: "core/boolean", version: "1" },
            value: false,
          },
        ],
        "root",
      ),
      createExampleCatalog(),
      examplePolicy,
    );
    expect(firstCode(result)).toBe("DEAD_NODE");
    const errors = result.ok ? [] : result.error;
    expect(errors[0]?.location.nodeId).toBe("dead");
    expect(errors[0]?.repair?.nodeId).toBe("dead");
  });

  it("tracks root provenance and enforces typed semantic obligations", async () => {
    const text = planText(
      [
        {
          id: "state",
          op: "input",
          inputKey: "state",
          schema: { id: "example/countdown", version: "1" },
        },
        {
          id: "fixed",
          op: "boundedFix",
          seed: "state",
          step: { id: "example/countdown-step", version: "1" },
          measure: { id: "example/countdown-measure", version: "1" },
          maxIterations: 4,
        },
      ],
      "fixed",
    );
    const compiled = await compilePlanJson(
      text,
      createExampleCatalog(),
      examplePolicy,
      [
        { kind: "rootDependsOnInput", inputKey: "state" },
        {
          kind: "requiresOperation",
          operation: { id: "example/countdown-step", version: "1" },
        },
        {
          kind: "operationDominatesRoot",
          operation: { id: "example/countdown-step", version: "1" },
        },
        { kind: "requiresStateChange" },
      ],
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.error[0]?.message);
    const summary = inspectExecutablePlan(compiled.value);
    expect(summary?.analysis.rootProvenance.inputDependencies).toEqual(
      new Set(["state"]),
    );
    expect(
      summary?.analysis.rootProvenance.operationDependencies.has(
        "example/countdown-step@1",
      ),
    ).toBe(true);
    expect(summary?.analysis.rootProvenance.dominators).toEqual(
      new Set(["state", "fixed"]),
    );
  });

  it("rejects an operation that occurs on only one path to the root", async () => {
    const result = await compilePlanJson(
      planText(
        [
          {
            id: "condition",
            op: "constant",
            schema: { id: "core/boolean", version: "1" },
            value: true,
          },
          {
            id: "fragment",
            op: "constant",
            schema: { id: "example/fragment", version: "1" },
            value: { id: "f", text: "text" },
          },
          {
            id: "transformed",
            op: "invoke",
            source: "fragment",
            function: { id: "example/fragment-to-claim", version: "1" },
          },
          {
            id: "fallback",
            op: "constant",
            schema: { id: "example/claim", version: "1" },
            value: { id: "f", text: "text" },
          },
          {
            id: "selected",
            op: "select",
            condition: "condition",
            whenTrue: "transformed",
            whenFalse: "fallback",
          },
        ],
        "selected",
      ),
      createExampleCatalog(),
      examplePolicy,
      [
        {
          kind: "operationDominatesRoot",
          operation: { id: "example/fragment-to-claim", version: "1" },
        },
      ],
    );
    expect(firstCode(result)).toBe("SEMANTIC_OBLIGATION_FAILED");
  });

  it("rejects structurally valid checkpoint chains when state change is required", async () => {
    const result = await compilePlanJson(
      planText(
        [
          {
            id: "state",
            op: "input",
            inputKey: "state",
            schema: { id: "example/countdown", version: "1" },
          },
          {
            id: "one",
            op: "checkpoint",
            source: "state",
            label: "one",
          },
          {
            id: "two",
            op: "checkpoint",
            source: "one",
            label: "two",
          },
        ],
        "two",
      ),
      createExampleCatalog(),
      examplePolicy,
      [
        { kind: "rootDependsOnInput", inputKey: "state" },
        { kind: "requiresStateChange" },
      ],
    );
    expect(firstCode(result)).toBe("SEMANTIC_OBLIGATION_FAILED");
  });

  it("rejects a constant root that ignores a required public input", async () => {
    const result = await compilePlanJson(
      planText(
        [
          {
            id: "reset",
            op: "constant",
            schema: { id: "example/countdown", version: "1" },
            value: { remaining: 0 },
          },
        ],
        "reset",
      ),
      createExampleCatalog(),
      examplePolicy,
      [{ kind: "rootDependsOnInput", inputKey: "state" }],
    );
    expect(firstCode(result)).toBe("SEMANTIC_OBLIGATION_FAILED");
  });

  it("rejects catalog, schema, operation, kind, type, and branch mismatches", async () => {
    const cases: ReadonlyArray<readonly [string, DiagnosticCode]> = [
      [
        planText(
          [
            {
              id: "x",
              op: "constant",
              schema: { id: "missing", version: "1" },
              value: true,
            },
          ],
          "x",
        ),
        "UNKNOWN_SCHEMA",
      ],
      [
        planText(
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
        ),
        "UNKNOWN_OPERATION",
      ],
      [
        planText(
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
        ),
        "OPERATION_KIND_MISMATCH",
      ],
      [
        planText(
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
        ),
        "TYPE_MISMATCH",
      ],
      [await fixture("branch-mismatch.invalid.json"), "BRANCH_TYPE_MISMATCH"],
      [
        planText(
          [
            {
              id: "x",
              op: "constant",
              schema: { id: "core/boolean", version: "1" },
              value: true,
            },
          ],
          "x",
          { catalog: { id: "other/catalog", version: "1" } },
        ),
        "CATALOG_REFERENCE_MISMATCH",
      ],
    ];
    for (const [text, code] of cases)
      expect(
        firstCode(
          await compilePlanJson(text, createExampleCatalog(), examplePolicy),
        ),
      ).toBe(code);
  });

  it("rejects a constant that violates its declared schema", async () => {
    const result = await compilePlanJson(
      planText(
        [
          {
            id: "bad",
            op: "constant",
            schema: { id: "example/fragment", version: "1" },
            value: { id: "missing-text" },
          },
        ],
        "bad",
      ),
      createExampleCatalog(),
      examplePolicy,
    );
    expect(firstCode(result)).toBe("RUNTIME_SCHEMA_VIOLATION");
  });

  it("binds reachable plan analysis into an opaque summary", async () => {
    const text = planText(
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
        { id: "cp", op: "checkpoint", source: "selected", label: "done" },
        {
          id: "effect",
          op: "effect",
          source: "cp",
          effect: { id: "example/synthesize", version: "1" },
        },
      ],
      "effect",
    );
    const executable = await compileOrThrow(text);
    const summary = inspectExecutablePlan(executable);
    expect(summary?.rootSchema.id).toBe("example/summary");
    expect(summary?.analysis.effectsUsed).toEqual(
      new Set(["model.synthesize"]),
    );
    expect(summary?.analysis.topologicalStages.length).toBeGreaterThan(2);
    expect(summary?.canonicalPlan.startsWith("{")).toBe(true);
  });

  it("enforces plan capability and budget policy before execution", async () => {
    const denied = await compilePlanJson(
      await fixture("document-claims.valid.json"),
      createExampleCatalog(),
      { ...examplePolicy, allowedCapabilities: [] },
    );
    expect(firstCode(denied)).toBe("DENIED_CAPABILITY");
    const limited = await compilePlanJson(
      await fixture("document-claims.valid.json"),
      createExampleCatalog(),
      {
        ...examplePolicy,
        budget: { ...examplePolicy.budget, maxTokens: 1 },
      },
    );
    expect(firstCode(limited)).toBe("BUDGET_EXCEEDED");
    const limitedDiagnostic = limited.ok ? undefined : limited.error[0];
    expect(limitedDiagnostic?.limit).toEqual({
      resource: "tokens",
      actual: 1100,
      limit: 1,
    });
    expect(limitedDiagnostic?.repair).toBeUndefined();
  });

  it("rejects analysis-time denied capability, unbounded fan-out, and budgets", async () => {
    for (const [name, code] of [
      ["unbounded-fanout.invalid.json", "UNBOUNDED_CARDINALITY"],
    ] as const) {
      expect(
        firstCode(
          await compilePlanJson(
            await fixture(name),
            createExampleCatalog(),
            examplePolicy,
          ),
        ),
      ).toBe(code);
    }
    const parsed = parseJson(await fixture("document-claims.valid.json"));
    if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null)
      throw new Error("fixture parse failed");
    const wire = wirePlanSchema.parse(parsed.value);
    const over = JSON.stringify({
      ...wire,
      budget: { ...wire.budget, maxEffectCalls: 3 },
    });
    expect(
      await compilePlanJson(over, createExampleCatalog(), examplePolicy),
    ).toMatchObject({ ok: true });
  });

  it("checks collection, reducer, select, map-output, and fixed-point schemas", async () => {
    const mismatches = [
      planText(
        [
          {
            id: "source",
            op: "constant",
            schema: { id: "example/fragment", version: "1" },
            value: { id: "x", text: "x" },
          },
          {
            id: "filtered",
            op: "filter",
            source: "source",
            predicate: { id: "example/claim-is-nonempty", version: "1" },
          },
        ],
        "filtered",
      ),
      planText(
        [
          {
            id: "source",
            op: "constant",
            schema: { id: "example/fragments", version: "1" },
            value: [{ id: "x", text: "x" }],
          },
          {
            id: "folded",
            op: "fold",
            source: "source",
            reducer: { id: "example/claim-union", version: "1" },
          },
        ],
        "folded",
      ),
      planText(
        [
          {
            id: "source",
            op: "constant",
            schema: { id: "example/fragments", version: "1" },
            value: [{ id: "x", text: "x" }],
          },
          {
            id: "mapped",
            op: "map",
            source: "source",
            operation: {
              kind: "function",
              id: "example/fragment-to-claim",
              version: "1",
            },
            outputCollectionSchema: { id: "example/fragments", version: "1" },
            parallelism: 1,
          },
        ],
        "mapped",
      ),
      planText(
        [
          {
            id: "condition",
            op: "constant",
            schema: { id: "example/fragment", version: "1" },
            value: { id: "x", text: "x" },
          },
          {
            id: "left",
            op: "constant",
            schema: { id: "example/claims", version: "1" },
            value: [],
          },
          {
            id: "selected",
            op: "select",
            condition: "condition",
            whenTrue: "left",
            whenFalse: "left",
          },
        ],
        "selected",
      ),
      planText(
        [
          {
            id: "seed",
            op: "constant",
            schema: { id: "example/fragment", version: "1" },
            value: { id: "x", text: "x" },
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
      ),
    ];
    for (const text of mismatches) {
      const result = await compilePlanJson(
        text,
        createExampleCatalog(),
        examplePolicy,
      );
      expect(firstCode(result)).toBe("TYPE_MISMATCH");
      const hasStructuredExpectation = result.ok
        ? false
        : result.error.some((item) => item.expected !== undefined);
      expect(hasStructuredExpectation).toBe(true);
    }
  });

  it("checks every analyzed resource limit", async () => {
    const source = {
      id: "source",
      op: "input",
      inputKey: "fragments",
      schema: { id: "example/fragments", version: "1" },
      maxItems: 3,
    };
    const effectMap = {
      id: "mapped",
      op: "map",
      source: "source",
      operation: {
        kind: "effect",
        id: "example/extract-claim",
        version: "1",
      },
      outputCollectionSchema: { id: "example/claims", version: "1" },
      parallelism: 2,
    };
    const budgets = [
      { maxEffectCalls: 2 },
      { maxCollectionItems: 2 },
      { maxTokens: 599 },
      { maxWallClockMs: 2_999 },
      { maxParallelism: 1 },
    ];
    for (const budget of budgets) {
      const result = await compilePlanJson(
        planText([source, effectMap], "mapped", {
          budget: {
            maxEffectCalls: 3,
            maxCollectionItems: 3,
            maxRecursionDepth: 0,
            maxTokens: 600,
            maxWallClockMs: 3_000,
            maxParallelism: 2,
            ...budget,
          },
          allowedCapabilities: ["llm.invoke:extractor"],
        }),
        createExampleCatalog(),
        {
          ...examplePolicy,
          budget: { ...examplePolicy.budget, ...budget },
        },
      );
      expect(firstCode(result)).toBe("BUDGET_EXCEEDED");
      expect(result.ok ? undefined : result.error[0]?.limit).toBeDefined();
    }
  });

  it("rejects mismatched and forged executable artifacts", async () => {
    const invalid: unknown = await Promise.resolve<unknown>(
      Reflect.apply(executePlan, undefined, [
        Object.freeze({}),
        options(createReplayEffectHandler([])),
      ]),
    );
    expect(invalid).toMatchObject({
      ok: false,
      error: { diagnostics: [{ code: "INVALID_EXECUTABLE_PLAN" }] },
    });
  });
});

describe("language manifest and catalog contract", () => {
  it("is deterministic, canonical, complete, and content addressed", async () => {
    const first = await createPlanLanguageManifest(
      createExampleCatalog(),
      examplePolicy,
    );
    const second = await createPlanLanguageManifest(
      createExampleCatalog(),
      examplePolicy,
    );
    expect(first).toEqual(second);
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value.planJsonSchema).toMatchObject({ type: "object" });
    expect(
      first.value.schemas.every((schema) => schema.description.length > 0),
    ).toBe(true);
    const synthesis = first.value.operations.find(
      (operation) => operation.reference.id === "example/synthesize",
    );
    expect(synthesis).toMatchObject({
      output: { id: "example/summary", version: "1" },
      effect: {
        name: "model.synthesize",
        capability: "llm.invoke:synthesizer",
      },
      bounds: { maxTokens: 500, maxWallClockMs: 2000 },
    });
    expect(
      first.value.operations.find((operation) => operation.kind === "reducer"),
    ).toMatchObject({
      reducerLaws: { associative: true, commutative: true, idempotent: true },
    });
  });

  it("changes its catalog fingerprint for a manifest-level catalog change", async () => {
    const alteredEffect = defineEffect({
      id: "example/extract-claim",
      version: "1",
      description: "Changed extraction semantics.",
      input: fragmentSchema,
      output: claimSchema,
      effectName: "model.extract",
      capability: "llm.invoke:extractor",
      maxTokens: 200,
      maxWallClockMs: 1_000,
      replayable: true,
    });
    const altered = createCatalog({
      identity: { id: "example/catalog", version: "1" },
      schemas: exampleSchemas,
      operations: exampleOperations.map((operation) =>
        operation.id === alteredEffect.id ? alteredEffect : operation,
      ),
    });
    if (!altered.ok) throw new Error(altered.error[0]?.message);
    expect(await fingerprintCatalog(altered.value)).not.toEqual(
      await fingerprintCatalog(createExampleCatalog()),
    );
  });

  it("marks nodes using non-replayable effects accordingly", async () => {
    const liveEffect = defineEffect({
      id: "example/extract-claim",
      version: "1",
      description: "A deliberately live extraction effect.",
      input: fragmentSchema,
      output: claimSchema,
      effectName: "model.extract",
      capability: "llm.invoke:extractor",
      maxTokens: 200,
      maxWallClockMs: 1_000,
      replayable: false,
    });
    const catalog = createCatalog({
      identity: { id: "example/catalog", version: "1" },
      schemas: exampleSchemas,
      operations: exampleOperations.map((operation) =>
        operation.id === liveEffect.id ? liveEffect : operation,
      ),
    });
    if (!catalog.ok) throw new Error(catalog.error[0]?.message);
    const compiled = await compileOrThrow(
      await fixture("document-claims.valid.json"),
      catalog.value,
    );
    expect(
      [
        ...(inspectExecutablePlan(compiled)?.analysis.replayableNodes ?? []),
      ].some((nodeId) => nodeId === "extracted"),
    ).toBe(false);
  });

  it("rejects duplicate, dangling, invalid reducer, and undeclared catalog entries", () => {
    expect(
      firstCode(
        createCatalog({
          identity: { id: "bad/catalog", version: "1" },
          schemas: [fragmentSchema.runtime, fragmentSchema.runtime],
          operations: [],
        }),
      ),
    ).toBe("UNKNOWN_SCHEMA");
    const missing = schemaReferenceSchema.parse({
      id: "missing",
      version: "1",
    });
    expect(
      firstCode(
        createCatalog({
          identity: { id: "bad/catalog", version: "1" },
          schemas: [fragmentSchema.runtime],
          operations: [{ ...extractionEffect, input: missing }],
        }),
      ),
    ).toBe("UNKNOWN_SCHEMA");
    const reducer = exampleOperations.find(
      (operation) => operation.kind === "reducer",
    );
    if (reducer === undefined) throw new Error("reducer missing");
    expect(
      firstCode(
        createCatalog({
          identity: { id: "bad/catalog", version: "1" },
          schemas: [fragmentSchema.runtime],
          operations: [{ ...reducer, element: missing }],
        }),
      ),
    ).toBe("INVALID_REDUCER");
    expect(
      firstCode(
        createCatalog({
          identity: { id: "bad/catalog", version: "1" },
          schemas: [fragmentSchema.runtime, claimSchema.runtime],
          operations: [{ ...extractionEffect, effectName: "", capability: "" }],
        }),
      ),
    ).toBe("UNDECLARED_EFFECT");
  });

  it("snapshots and freezes registered catalog entries", async () => {
    const catalog = createExampleCatalog();
    expect(Reflect.set(extractionEffect, "capability", "changed")).toBe(true);
    const manifest = await createPlanLanguageManifest(catalog, examplePolicy);
    if (!manifest.ok) throw new Error(manifest.error.message);
    expect(
      manifest.value.operations.find(
        (operation) => operation.reference.id === "example/extract-claim",
      )?.effect?.capability,
    ).toBe("llm.invoke:extractor");
    expect(
      Reflect.set(extractionEffect, "capability", "llm.invoke:extractor"),
    ).toBe(true);
  });
});

describe("request-bound replay and execution", () => {
  it("records request/output digests and replays a complete run deterministically", async () => {
    const text = await fixture("document-claims.valid.json");
    const recorded = await recordingFor(text);
    expect(recorded.entries).toHaveLength(3);
    expect(
      recorded.entries.every((entry) => entry.requestHash.length === 64),
    ).toBe(true);
    expect(
      recorded.entries.every((entry) => entry.outputDigest.length === 64),
    ).toBe(true);
    const first = await executePlan(
      recorded.executable,
      options(createReplayEffectHandler(recorded.entries)),
    );
    const second = await executePlan(
      recorded.executable,
      options(createReplayEffectHandler(recorded.entries)),
    );
    expect(first).toEqual(second);
    expect(first.ok ? first.value.output : undefined).toEqual({
      text: "summary",
      claimIds: ["c1", "c2"],
    });
    expect(first.ok ? first.value.trace.finalUsage.effectCalls : 0).toBe(3);
  });

  it("rejects recordings after input, plan, operation, or catalog changes", async () => {
    const originalText = await fixture("document-claims.valid.json");
    const recorded = await recordingFor(originalText);

    const changedInput = new Map<string, unknown>([
      ["fragments", [{ id: "f1", text: "changed" }]],
    ]);
    const inputResult = await executePlan(
      recorded.executable,
      options(createReplayEffectHandler(recorded.entries), changedInput),
    );
    expect(
      inputResult.ok ? undefined : inputResult.error.diagnostics[0]?.code,
    ).toBe("REPLAY_REQUEST_MISMATCH");

    const json = parseJson(originalText);
    if (!json.ok || typeof json.value !== "object" || json.value === null)
      throw new Error("plan parse failed");
    const plan = wirePlanSchema.parse(json.value);
    const changedPlan = await compileOrThrow(
      JSON.stringify({ ...plan, metadata: { name: "changed", revision: "2" } }),
    );
    const planResult = await executePlan(
      changedPlan,
      options(createReplayEffectHandler(recorded.entries)),
    );
    expect(
      planResult.ok ? undefined : planResult.error.diagnostics[0]?.code,
    ).toBe("REPLAY_REQUEST_MISMATCH");

    const changedCatalogEffect = defineEffect({
      id: "example/extract-claim",
      version: "1",
      description: "Catalog-changed extraction.",
      input: fragmentSchema,
      output: claimSchema,
      effectName: "model.extract",
      capability: "llm.invoke:extractor",
      maxTokens: 200,
      maxWallClockMs: 1_000,
      replayable: true,
    });
    const changedCatalog = createCatalog({
      identity: { id: "example/catalog", version: "1" },
      schemas: exampleSchemas,
      operations: exampleOperations.map((operation) =>
        operation.id === changedCatalogEffect.id
          ? changedCatalogEffect
          : operation,
      ),
    });
    if (!changedCatalog.ok) throw new Error(changedCatalog.error[0]?.message);
    const catalogExecutable = await compileOrThrow(
      originalText,
      changedCatalog.value,
    );
    const catalogResult = await executePlan(
      catalogExecutable,
      options(createReplayEffectHandler(recorded.entries)),
    );
    expect(
      catalogResult.ok ? undefined : catalogResult.error.diagnostics[0]?.code,
    ).toBe("REPLAY_REQUEST_MISMATCH");

    const operationV2 = defineEffect({
      id: "example/extract-claim",
      version: "2",
      description: "Version-two extraction.",
      input: fragmentSchema,
      output: claimSchema,
      effectName: "model.extract",
      capability: "llm.invoke:extractor",
      maxTokens: 200,
      maxWallClockMs: 1_000,
      replayable: true,
    });
    const operationCatalog = createCatalog({
      identity: { id: "example/catalog", version: "1" },
      schemas: exampleSchemas,
      operations: exampleOperations.map((operation) =>
        operation.id === operationV2.id ? operationV2 : operation,
      ),
    });
    if (!operationCatalog.ok)
      throw new Error(operationCatalog.error[0]?.message);
    const operationText = originalText.replace(
      '"id": "example/extract-claim",\n        "version": "1"',
      '"id": "example/extract-claim",\n        "version": "2"',
    );
    const operationExecutable = await compileOrThrow(
      operationText,
      operationCatalog.value,
    );
    const operationResult = await executePlan(
      operationExecutable,
      options(createReplayEffectHandler(recorded.entries)),
    );
    expect(
      operationResult.ok
        ? undefined
        : operationResult.error.diagnostics[0]?.code,
    ).toBe("REPLAY_REQUEST_MISMATCH");
  });

  it("rejects missing entries, identity tampering, and output tampering", async () => {
    const text = await fixture("document-claims.valid.json");
    const recorded = await recordingFor(text);
    const missing = await executePlan(
      recorded.executable,
      options(createReplayEffectHandler([])),
    );
    expect(missing.ok ? undefined : missing.error.diagnostics[0]?.code).toBe(
      "MISSING_REPLAY_RESULT",
    );
    const first = recorded.entries[0];
    if (first === undefined) throw new Error("recording missing");
    const identityTampered = [
      { ...first, effectName: "other.effect" },
      ...recorded.entries.slice(1),
    ];
    const identity = await executePlan(
      recorded.executable,
      options(createReplayEffectHandler(identityTampered)),
    );
    expect(identity.ok ? undefined : identity.error.diagnostics[0]?.code).toBe(
      "REPLAY_REQUEST_MISMATCH",
    );
    const outputTampered = [
      { ...first, value: { id: "c1", text: "tampered" } },
      ...recorded.entries.slice(1),
    ];
    const output = await executePlan(
      recorded.executable,
      options(createReplayEffectHandler(outputTampered)),
    );
    expect(output.ok ? undefined : output.error.diagnostics[0]?.code).toBe(
      "REPLAY_OUTPUT_MISMATCH",
    );
  });

  it("executes pure invoke/map/filter/fold/select/checkpoint nodes", async () => {
    const text = planText(
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
          value: false,
        },
        {
          id: "selected",
          op: "select",
          condition: "condition",
          whenTrue: "folded",
          whenFalse: "folded",
        },
        { id: "cp", op: "checkpoint", source: "selected", label: "done" },
      ],
      "cp",
    );
    const result = await executePlan(
      await compileOrThrow(text),
      options(
        createReplayEffectHandler([]),
        new Map([
          [
            "fragments",
            [
              { id: "f1", text: "one" },
              { id: "f2", text: "" },
            ],
          ],
        ]),
      ),
    );
    expect(result.ok ? result.value.output : undefined).toEqual([
      { id: "f1", text: "one" },
    ]);
  });

  it("executes a pure invocation as the root", async () => {
    const executable = await compileOrThrow(
      planText(
        [
          {
            id: "fragment",
            op: "constant",
            schema: { id: "example/fragment", version: "1" },
            value: { id: "x", text: "invoked" },
          },
          {
            id: "invoked",
            op: "invoke",
            source: "fragment",
            function: { id: "example/fragment-to-claim", version: "1" },
          },
        ],
        "invoked",
      ),
    );
    const result = await executePlan(
      executable,
      options(createReplayEffectHandler([])),
    );
    expect(result.ok ? result.value.output : undefined).toEqual({
      id: "x",
      text: "invoked",
    });
  });

  it("executes scalar input and memoized select dependencies", async () => {
    const scalar = await executePlan(
      await compileOrThrow(
        planText(
          [
            {
              id: "item",
              op: "input",
              inputKey: "item",
              schema: { id: "example/fragment", version: "1" },
            },
          ],
          "item",
        ),
      ),
      options(
        createReplayEffectHandler([]),
        new Map([["item", { id: "x", text: "scalar" }]]),
      ),
    );
    expect(scalar.ok ? scalar.value.output : undefined).toEqual({
      id: "x",
      text: "scalar",
    });
    const memoized = await executePlan(
      await compileOrThrow(
        planText(
          [
            {
              id: "condition",
              op: "constant",
              schema: { id: "core/boolean", version: "1" },
              value: true,
            },
            {
              id: "selected",
              op: "select",
              condition: "condition",
              whenTrue: "condition",
              whenFalse: "condition",
            },
          ],
          "selected",
        ),
      ),
      options(createReplayEffectHandler([])),
    );
    expect(memoized.ok ? memoized.value.output : undefined).toBe(true);
  });

  it("propagates trusted function, predicate, reducer, step, and measure failures", async () => {
    const injected = diagnostic("RUNTIME_SCHEMA_VIOLATION", "injected");
    function failure<T>(): Result<T, typeof injected> {
      return { ok: false, error: injected };
    }
    const badFunction = {
      ...fragmentToClaim,
      invoke: () => failure<unknown>(),
    };
    const mapText = planText(
      [
        {
          id: "source",
          op: "constant",
          schema: { id: "example/fragments", version: "1" },
          value: [{ id: "x", text: "x" }],
        },
        {
          id: "mapped",
          op: "map",
          source: "source",
          operation: {
            kind: "function",
            id: "example/fragment-to-claim",
            version: "1",
          },
          outputCollectionSchema: { id: "example/claims", version: "1" },
          parallelism: 1,
        },
      ],
      "mapped",
    );
    const mapped = await executePlan(
      await compileOrThrow(mapText, catalogReplacing(badFunction)),
      options(createReplayEffectHandler([])),
    );
    expect(mapped.ok ? undefined : mapped.error.diagnostics[0]?.message).toBe(
      "injected",
    );

    const badPredicate = {
      ...claimIsNonempty,
      test: () => failure<boolean>(),
    };
    const filterText = planText(
      [
        {
          id: "source",
          op: "constant",
          schema: { id: "example/claims", version: "1" },
          value: [{ id: "x", text: "x" }],
        },
        {
          id: "filtered",
          op: "filter",
          source: "source",
          predicate: { id: "example/claim-is-nonempty", version: "1" },
        },
      ],
      "filtered",
    );
    const filtered = await executePlan(
      await compileOrThrow(filterText, catalogReplacing(badPredicate)),
      options(createReplayEffectHandler([])),
    );
    expect(
      filtered.ok ? undefined : filtered.error.diagnostics[0]?.message,
    ).toBe("injected");

    const badReducer = {
      ...claimUnion,
      reduce: () => failure<unknown>(),
    };
    const foldText = planText(
      [
        {
          id: "source",
          op: "constant",
          schema: { id: "example/claims", version: "1" },
          value: [{ id: "x", text: "x" }],
        },
        {
          id: "folded",
          op: "fold",
          source: "source",
          reducer: { id: "example/claim-union", version: "1" },
        },
      ],
      "folded",
    );
    const folded = await executePlan(
      await compileOrThrow(foldText, catalogReplacing(badReducer)),
      options(createReplayEffectHandler([])),
    );
    expect(folded.ok ? undefined : folded.error.diagnostics[0]?.message).toBe(
      "injected",
    );

    const fixedText = planText(
      [
        {
          id: "seed",
          op: "constant",
          schema: { id: "example/countdown", version: "1" },
          value: { remaining: 1 },
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
    const badStep = {
      ...countdownStep,
      invoke: () => failure<unknown>(),
    };
    const stepped = await executePlan(
      await compileOrThrow(fixedText, catalogReplacing(badStep)),
      options(createReplayEffectHandler([])),
    );
    expect(stepped.ok ? undefined : stepped.error.diagnostics[0]?.message).toBe(
      "injected",
    );
    const badMeasure = {
      ...countdownMeasure,
      measure: () => failure<number>(),
    };
    const measured = await executePlan(
      await compileOrThrow(fixedText, catalogReplacing(badMeasure)),
      options(createReplayEffectHandler([])),
    );
    expect(
      measured.ok ? undefined : measured.error.diagnostics[0]?.message,
    ).toBe("injected");
  });

  it("enforces missing/oversized inputs and effect usage/output boundaries", async () => {
    const text = await fixture("document-claims.valid.json");
    const executable = await compileOrThrow(text);
    const missing = await executePlan(
      executable,
      options(createReplayEffectHandler([]), new Map()),
    );
    expect(missing.ok ? undefined : missing.error.diagnostics[0]?.code).toBe(
      "RUNTIME_SCHEMA_VIOLATION",
    );
    const oversized = await executePlan(
      executable,
      options(
        createReplayEffectHandler([]),
        new Map([
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
      ),
    );
    expect(
      oversized.ok ? undefined : oversized.error.diagnostics[0]?.code,
    ).toBe("BUDGET_EXCEEDED");
    const badUsage = await executePlan(
      executable,
      options(
        createMockEffectHandler(() => ({
          ok: true,
          value: {
            value: { id: "c", text: "claim" },
            replayResultId: "bad-usage",
            usage: { tokens: -1, wallClockMs: 0 },
          },
        })),
      ),
    );
    expect(badUsage.ok ? undefined : badUsage.error.diagnostics[0]?.code).toBe(
      "RUNTIME_SCHEMA_VIOLATION",
    );
    const overEffectBudget = await executePlan(
      executable,
      options(
        createMockEffectHandler((request) => ({
          ok: true,
          value: {
            value:
              request.effectName === "model.extract"
                ? { id: "c", text: "claim" }
                : { text: "summary", claimIds: [] },
            replayResultId: "over-budget",
            usage: { tokens: 2_000, wallClockMs: 0 },
          },
        })),
      ),
    );
    expect(
      overEffectBudget.ok
        ? undefined
        : overEffectBudget.error.diagnostics[0]?.code,
    ).toBe("BUDGET_EXCEEDED");
    const invalidOutput = await executePlan(
      executable,
      options(
        createMockEffectHandler(() => ({
          ok: true,
          value: {
            value: { wrong: true },
            replayResultId: "invalid-output",
            usage: { tokens: 0, wallClockMs: 0 },
          },
        })),
      ),
    );
    expect(
      invalidOutput.ok ? undefined : invalidOutput.error.diagnostics[0]?.code,
    ).toBe("RUNTIME_SCHEMA_VIOLATION");

    const invalidInput = await executePlan(
      executable,
      options(
        createReplayEffectHandler([]),
        new Map([["fragments", [{ id: "missing-text" }]]]),
      ),
    );
    expect(
      invalidInput.ok ? undefined : invalidInput.error.diagnostics[0]?.code,
    ).toBe("RUNTIME_SCHEMA_VIOLATION");

    const handlerFailure = await executePlan(
      executable,
      options(
        createMockEffectHandler(() => ({
          ok: false,
          error: diagnostic("MISSING_REPLAY_RESULT", "injected failure"),
        })),
      ),
    );
    expect(
      handlerFailure.ok ? undefined : handlerFailure.error.diagnostics[0]?.code,
    ).toBe("MISSING_REPLAY_RESULT");

    const overWallClock = await executePlan(
      executable,
      options(
        createMockEffectHandler((request) => ({
          ok: true,
          value: {
            value:
              request.effectName === "model.extract"
                ? { id: "c", text: "claim" }
                : { text: "summary", claimIds: [] },
            replayResultId: "over-wall-clock",
            usage: { tokens: 0, wallClockMs: 5_000 },
          },
        })),
      ),
    );
    expect(
      overWallClock.ok ? undefined : overWallClock.error.diagnostics[0]?.code,
    ).toBe("BUDGET_EXCEEDED");
  });

  it("enforces an input node's tighter cardinality bound", async () => {
    const text = planText(
      [
        {
          id: "fragments",
          op: "input",
          inputKey: "fragments",
          schema: { id: "example/fragments", version: "1" },
          maxItems: 2,
        },
      ],
      "fragments",
    );
    const result = await executePlan(
      await compileOrThrow(text),
      options(
        createReplayEffectHandler([]),
        new Map([
          [
            "fragments",
            [
              { id: "1", text: "1" },
              { id: "2", text: "2" },
              { id: "3", text: "3" },
            ],
          ],
        ]),
      ),
    );
    expect(result.ok ? undefined : result.error.diagnostics[0]?.code).toBe(
      "BUDGET_EXCEEDED",
    );
  });

  it("rejects non-JSON effect recordings", async () => {
    const text = await fixture("document-claims.valid.json");
    const executable = await compileOrThrow(text);
    let requestSeen: EffectRequest | undefined;
    await executePlan(
      executable,
      options(
        createMockEffectHandler((request) => {
          requestSeen = request;
          return {
            ok: false,
            error: diagnostic("MISSING_REPLAY_RESULT", "stop"),
          };
        }),
      ),
    );
    if (requestSeen === undefined) throw new Error("effect request missing");
    const recorded = await recordEffectResult(requestSeen, {
      value: 1n,
      replayResultId: "non-json",
      usage: { tokens: 0, wallClockMs: 0 },
    });
    expect(recorded.ok ? undefined : recorded.error.code).toBe(
      "RUNTIME_SCHEMA_VIOLATION",
    );
    const invalidUsage = await recordEffectResult(requestSeen, {
      value: { id: "c", text: "claim" },
      replayResultId: "invalid-usage",
      usage: { tokens: -1, wallClockMs: 0 },
    });
    expect(invalidUsage.ok ? undefined : invalidUsage.error.code).toBe(
      "RUNTIME_SCHEMA_VIOLATION",
    );
  });

  it("executes decreasing bounded fixes and rejects stuck or exhausted fixes", async () => {
    const fix = (step: string, remaining: number, maxIterations: number) =>
      planText(
        [
          {
            id: "seed",
            op: "constant",
            schema: { id: "example/countdown", version: "1" },
            value: { remaining },
          },
          {
            id: "fix",
            op: "boundedFix",
            seed: "seed",
            step: { id: step, version: "1" },
            measure: { id: "example/countdown-measure", version: "1" },
            maxIterations,
          },
        ],
        "fix",
      );
    const success = await executePlan(
      await compileOrThrow(fix("example/countdown-step", 2, 2)),
      options(createReplayEffectHandler([])),
    );
    expect(success.ok ? success.value.output : undefined).toEqual({
      remaining: 0,
    });
    const stuck = await executePlan(
      await compileOrThrow(fix("example/stuck-countdown-step", 2, 3)),
      options(createReplayEffectHandler([])),
    );
    expect(stuck.ok ? undefined : stuck.error.diagnostics[0]?.code).toBe(
      "NON_DECREASING_RECURSION_MEASURE",
    );
    const exhausted = await executePlan(
      await compileOrThrow(fix("example/countdown-step", 2, 1)),
      options(createReplayEffectHandler([])),
    );
    expect(
      exhausted.ok ? undefined : exhausted.error.diagnostics[0]?.code,
    ).toBe("UNBOUNDED_RECURSION");
  });
});

describe("property and wire contracts", () => {
  it("makes parsed wire arrays and nested objects readonly at runtime", () => {
    const parsed = parseWireText(
      planText(
        [
          {
            id: "x",
            op: "constant",
            schema: { id: "core/boolean", version: "1" },
            value: true,
          },
        ],
        "x",
      ),
    );
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.nodes)).toBe(true);
    expect(Object.isFrozen(parsed.nodes[0])).toBe(true);
    expect(Object.isFrozen(parsed.budget)).toBe(true);
    expect(Object.isFrozen(parsed.allowedCapabilities)).toBe(true);
  });

  it("property-tests arbitrary checkpoint graphs for deterministic normalization", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/), {
          minLength: 1,
          maxLength: 30,
        }),
        (ids) => {
          const nodes = ids.map((id, index) =>
            index === 0
              ? {
                  id,
                  op: "constant",
                  schema: { id: "core/boolean", version: "1" },
                  value: true,
                }
              : { id, op: "checkpoint", source: ids[index - 1], label: id },
          );
          const parsed = parseWireText(
            planText(nodes, ids[ids.length - 1] ?? ids[0] ?? "x"),
          );
          expect(normalizePlan(parsed)).toEqual(normalizePlan(parsed));
        },
      ),
    );
  });

  it("property-tests graph cycle rejection", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 30 }), (size) => {
        const nodes = Array.from({ length: size }, (_, index) => ({
          id: `n${index}`,
          op: "checkpoint",
          source: `n${(index + 1) % size}`,
          label: `n${index}`,
        }));
        const parsed = parseWireText(planText(nodes, "n0"));
        expect(firstCode(normalizePlan(parsed))).toBe("GRAPH_CYCLE");
      }),
    );
  });

  it("canonicalizes arbitrary JSON idempotently", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const first = canonicalizeJson(value);
        if (!first.ok) throw new Error(first.error.message);
        const parsed = parseJson(first.value);
        if (!parsed.ok) throw new Error(parsed.error.message);
        expect(canonicalizeJson(parsed.value)).toEqual(first);
      }),
    );
  });

  it("exposes structured diagnostic expectations, limits, and repair locations", () => {
    expect(
      diagnostic("TYPE_MISMATCH", "mismatch", { nodeId: "x" }, [], {
        expected: { schema: { id: "a", version: "1" } },
        actual: { schema: { id: "b", version: "1" } },
        repair: { nodeId: "x", path: ["schema"] },
      }),
    ).toMatchObject({
      expected: { schema: { id: "a", version: "1" } },
      actual: { schema: { id: "b", version: "1" } },
      repair: { nodeId: "x", path: ["schema"] },
    });
  });
});

describe("CLI", () => {
  it("compiles through the public boundary and uses deterministic exit codes", async () => {
    const cli = resolve(ROOT, "apps/cli/dist/cli.js");
    const valid = await execFileAsync(
      process.execPath,
      [cli, "validate", "fixtures/plans/document-claims.valid.json", "--json"],
      { cwd: ROOT },
    );
    expect(parseJson(valid.stdout)).toMatchObject({
      ok: true,
      value: { valid: true, rootSchema: "example/summary" },
    });
    await expect(
      execFileAsync(
        process.execPath,
        [
          cli,
          "validate",
          "fixtures/plans/branch-mismatch.invalid.json",
          "--json",
        ],
        { cwd: ROOT },
      ),
    ).rejects.toMatchObject({ code: 1 });
    await expect(
      execFileAsync(process.execPath, [cli], { cwd: ROOT }),
    ).rejects.toMatchObject({
      code: 2,
    });
  });
});
