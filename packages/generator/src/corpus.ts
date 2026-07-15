import {
  type Catalog,
  type CompilationPolicy,
  createCatalog,
  defineCollectionSchema,
  defineEffect,
  defineFixedPointStep,
  defineFunction,
  defineMeasure,
  definePredicate,
  defineReducer,
  defineSchema,
  diagnostic,
  type Diagnostics,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import type { CatalogResolver } from "./benchmark.js";
import {
  freezePlanGenerationCase,
  type FrozenPlanGenerationCase,
} from "./case.js";
import type { TaskInput } from "./model.js";

const VERSION = "1.0.0";

const DEFAULT_BUDGET = Object.freeze({
  maxEffectCalls: 32,
  maxCollectionItems: 128,
  maxRecursionDepth: 16,
  maxTokens: 4_000,
  maxWallClockMs: 10_000,
  maxParallelism: 8,
});

function policy(
  allowedCapabilities: ReadonlyArray<string> = [],
  budget: CompilationPolicy["budget"] = DEFAULT_BUDGET,
): CompilationPolicy {
  return { allowedCapabilities, budget };
}

function numericCatalog(): Result<Catalog, Diagnostics> {
  const number = defineSchema({
    id: "number",
    version: VERSION,
    description: "A finite numeric value.",
    validator: z.number(),
  });
  const numbers = defineCollectionSchema({
    id: "numbers",
    version: VERSION,
    description: "A bounded sequence of finite numbers.",
    validator: z.array(z.number()).readonly(),
    element: number,
    defaultMaxItems: 128,
  });
  return createCatalog({
    identity: { id: "benchmark.numbers", version: VERSION },
    schemas: [number.runtime, numbers.runtime],
    operations: [
      defineFunction({
        id: "double",
        version: VERSION,
        description: "Multiply a number by two.",
        input: number,
        output: number,
        implementation: (value) => value * 2,
      }),
      defineFunction({
        id: "increment",
        version: VERSION,
        description: "Add one to a number.",
        input: number,
        output: number,
        implementation: (value) => value + 1,
      }),
      defineFunction({
        id: "absolute",
        version: VERSION,
        description: "Return the absolute value of a number.",
        input: number,
        output: number,
        implementation: Math.abs,
      }),
      definePredicate({
        id: "positive",
        version: VERSION,
        description: "Test whether a number is greater than zero.",
        input: number,
        implementation: (value) => value > 0,
      }),
      definePredicate({
        id: "even",
        version: VERSION,
        description: "Test whether a number is an even integer.",
        input: number,
        implementation: (value) => Number.isInteger(value) && value % 2 === 0,
      }),
      defineReducer({
        id: "sum",
        version: VERSION,
        description: "Add every numeric element, starting at zero.",
        element: number,
        accumulator: number,
        identity: 0,
        laws: { associative: true, commutative: true, idempotent: false },
        implementation: (total, value) => total + value,
      }),
      defineEffect({
        id: "quote-tax",
        version: VERSION,
        description: "Look up a deterministic tax quote for one number.",
        input: number,
        output: number,
        effectName: "tax.quote",
        capability: "finance.read",
        maxTokens: 12,
        maxWallClockMs: 20,
        replayable: true,
      }),
    ],
  });
}

function textCatalog(): Result<Catalog, Diagnostics> {
  const text = defineSchema({
    id: "text",
    version: VERSION,
    description: "A Unicode text value.",
    validator: z.string(),
  });
  const texts = defineCollectionSchema({
    id: "texts",
    version: VERSION,
    description: "A bounded sequence of text values.",
    validator: z.array(z.string()).readonly(),
    element: text,
    defaultMaxItems: 128,
  });
  return createCatalog({
    identity: { id: "benchmark.text", version: VERSION },
    schemas: [text.runtime, texts.runtime],
    operations: [
      defineFunction({
        id: "uppercase",
        version: VERSION,
        description: "Convert text to uppercase.",
        input: text,
        output: text,
        implementation: (value) => value.toUpperCase(),
      }),
      defineFunction({
        id: "trim",
        version: VERSION,
        description: "Remove leading and trailing whitespace.",
        input: text,
        output: text,
        implementation: (value) => value.trim(),
      }),
      defineFunction({
        id: "exclaim",
        version: VERSION,
        description: "Append one exclamation mark.",
        input: text,
        output: text,
        implementation: (value) => `${value}!`,
      }),
      definePredicate({
        id: "nonempty",
        version: VERSION,
        description: "Test whether text has at least one character.",
        input: text,
        implementation: (value) => value.length > 0,
      }),
      defineReducer({
        id: "concatenate",
        version: VERSION,
        description: "Concatenate text in source order.",
        element: text,
        accumulator: text,
        identity: "",
        laws: { associative: true, commutative: false, idempotent: false },
        implementation: (total, value) => total + value,
      }),
      defineEffect({
        id: "translate",
        version: VERSION,
        description: "Translate one text value using a deterministic fixture.",
        input: text,
        output: text,
        effectName: "language.translate",
        capability: "language.translate",
        maxTokens: 64,
        maxWallClockMs: 50,
        replayable: true,
      }),
    ],
  });
}

function decisionCatalog(): Result<Catalog, Diagnostics> {
  const boolean = defineSchema({
    id: "boolean",
    version: VERSION,
    description: "A boolean condition.",
    validator: z.boolean(),
    semantic: "boolean",
  });
  const label = defineSchema({
    id: "label",
    version: VERSION,
    description: "A decision label.",
    validator: z.string(),
  });
  return createCatalog({
    identity: { id: "benchmark.decisions", version: VERSION },
    schemas: [boolean.runtime, label.runtime],
    operations: [
      defineFunction({
        id: "approve-label",
        version: VERSION,
        description: "Normalize a label as an approval message.",
        input: label,
        output: label,
        implementation: (value) => `approved:${value}`,
      }),
      defineFunction({
        id: "reject-label",
        version: VERSION,
        description: "Normalize a label as a rejection message.",
        input: label,
        output: label,
        implementation: (value) => `rejected:${value}`,
      }),
    ],
  });
}

const workflowStateSchema = z
  .strictObject({
    remaining: z.number().int().nonnegative(),
    value: z.number(),
  })
  .readonly();

function workflowCatalog(): Result<Catalog, Diagnostics> {
  const state = defineSchema({
    id: "workflow-state",
    version: VERSION,
    description: "A state with a countdown measure and accumulated value.",
    validator: workflowStateSchema,
  });
  return createCatalog({
    identity: { id: "benchmark.workflow", version: VERSION },
    schemas: [state.runtime],
    operations: [
      defineFixedPointStep({
        id: "countdown-step",
        version: VERSION,
        description:
          "Decrement remaining and increment value until remaining is zero.",
        state,
        implementation: (value) =>
          value.remaining === 0
            ? value
            : { remaining: value.remaining - 1, value: value.value + 1 },
      }),
      defineMeasure({
        id: "remaining",
        version: VERSION,
        description: "Use the remaining countdown as the progress measure.",
        input: state,
        implementation: (value) => value.remaining,
      }),
      defineEffect({
        id: "enrich-state",
        version: VERSION,
        description:
          "Enrich workflow state using a deterministic remote fixture.",
        input: state,
        output: state,
        effectName: "workflow.enrich",
        capability: "workflow.remote",
        maxTokens: 32,
        maxWallClockMs: 40,
        replayable: true,
      }),
    ],
  });
}

export const M1A_CATALOG_IDS = Object.freeze([
  "benchmark.numbers",
  "benchmark.text",
  "benchmark.decisions",
  "benchmark.workflow",
]);

export function createM1aCatalogResolver(): Result<
  CatalogResolver,
  Diagnostics
> {
  const created = [
    numericCatalog(),
    textCatalog(),
    decisionCatalog(),
    workflowCatalog(),
  ];
  const failures = created.flatMap((result) => (result.ok ? [] : result.error));
  if (failures.length > 0) return { ok: false, error: failures };
  const catalogs = new Map<string, Catalog>();
  for (let index = 0; index < M1A_CATALOG_IDS.length; index += 1) {
    const result = created[index];
    const id = M1A_CATALOG_IDS[index];
    if (result?.ok === true && id !== undefined) catalogs.set(id, result.value);
  }
  return {
    ok: true,
    value: (catalogId) => {
      const catalog = catalogs.get(catalogId);
      return catalog === undefined
        ? {
            ok: false,
            error: diagnostic(
              "CATALOG_REFERENCE_MISMATCH",
              `Unknown benchmark catalog ${catalogId}.`,
            ),
          }
        : { ok: true, value: catalog };
    },
  };
}

type CaseSeed = Readonly<{
  id: string;
  instruction: string;
  catalogId:
    | "benchmark.numbers"
    | "benchmark.text"
    | "benchmark.decisions"
    | "benchmark.workflow";
  inputs: ReadonlyArray<Readonly<Record<string, unknown>>>;
  outputs: ReadonlyArray<unknown>;
  properties: ReadonlyArray<unknown>;
  allowedCapabilities?: ReadonlyArray<string> | undefined;
  effects?: ReadonlyArray<ReadonlyArray<unknown>> | undefined;
  feasible?: boolean | undefined;
  budget?: CompilationPolicy["budget"] | undefined;
  forbidden?: ReadonlyArray<string> | undefined;
}>;

const collectionBound: TaskInput["declaredBounds"] = Object.freeze([
  Object.freeze({ kind: "maximumCollectionItems", value: 128 }),
]);

function taskInputsForCatalog(
  catalogId: CaseSeed["catalogId"],
): ReadonlyArray<TaskInput> {
  switch (catalogId) {
    case "benchmark.numbers":
      return Object.freeze([
        Object.freeze({
          name: "items",
          schema: Object.freeze({ id: "numbers", version: VERSION }),
          declaredBounds: collectionBound,
        }),
      ]);
    case "benchmark.text":
      return Object.freeze([
        Object.freeze({
          name: "items",
          schema: Object.freeze({ id: "texts", version: VERSION }),
          declaredBounds: collectionBound,
        }),
      ]);
    case "benchmark.decisions":
      return Object.freeze(
        [
          { name: "condition", schema: { id: "boolean", version: VERSION } },
          { name: "primary", schema: { id: "label", version: VERSION } },
          { name: "fallback", schema: { id: "label", version: VERSION } },
        ].map((item) =>
          Object.freeze({
            ...item,
            schema: Object.freeze(item.schema),
            declaredBounds: Object.freeze([]),
          }),
        ),
      );
    case "benchmark.workflow":
      return Object.freeze([
        Object.freeze({
          name: "state",
          schema: Object.freeze({ id: "workflow-state", version: VERSION }),
          declaredBounds: Object.freeze([]),
        }),
      ]);
  }
}

function caseValue(seed: CaseSeed): unknown {
  const hiddenEvaluations = seed.inputs.map((inputs, index) => ({
    id: `${seed.id}/hidden-${index + 1}`,
    inputs,
    effects: seed.effects?.[index] ?? [],
    expectedOutput: seed.outputs[index] ?? null,
  }));
  return {
    id: seed.id,
    instruction: seed.instruction,
    catalogId: seed.catalogId,
    policy: policy(seed.allowedCapabilities, seed.budget),
    taskInputs: taskInputsForCatalog(seed.catalogId),
    publicExamples: [],
    hiddenEvaluations,
    expectedFeasibility: seed.feasible === false ? "unplannable" : "plannable",
    requiredProperties: seed.properties,
    forbiddenCapabilities: seed.forbidden ?? [],
  };
}

const op = (id: string): unknown => ({
  kind: "usesOperation",
  id,
  version: VERSION,
});
const input = (inputKey = "items"): unknown => ({
  kind: "usesInput",
  inputKey,
});
const effect = (name: string): unknown => ({ kind: "usesEffect", name });

type CollectionCaseSeed = Readonly<{
  slug: string;
  instruction: string;
  values: ReadonlyArray<unknown>;
  outputs: ReadonlyArray<unknown>;
}>;

const numericRows: ReadonlyArray<CollectionCaseSeed> = [
  {
    slug: "double",
    instruction: "Double each number.",
    values: [
      [1, 2],
      [-2, 3],
    ],
    outputs: [
      [2, 4],
      [-4, 6],
    ],
  },
  {
    slug: "increment",
    instruction: "Add one to every value.",
    values: [
      [0, 2],
      [-1, 4],
    ],
    outputs: [
      [1, 3],
      [0, 5],
    ],
  },
  {
    slug: "absolute",
    instruction: "Make every number nonnegative.",
    values: [
      [-2, 3],
      [-5, -1],
    ],
    outputs: [
      [2, 3],
      [5, 1],
    ],
  },
  {
    slug: "positive",
    instruction: "Keep only numbers greater than zero.",
    values: [
      [-1, 0, 2],
      [3, -4],
    ],
    outputs: [[2], [3]],
  },
  {
    slug: "even",
    instruction: "Retain the even integers.",
    values: [
      [1, 2, 4],
      [-2, 3],
    ],
    outputs: [[2, 4], [-2]],
  },
  {
    slug: "sum",
    instruction: "Return the sum of the numbers.",
    values: [
      [1, 2, 3],
      [-2, 5],
    ],
    outputs: [6, 3],
  },
  {
    slug: "double-sum",
    instruction: "Double all values, then add them.",
    values: [
      [1, 3],
      [-2, 4],
    ],
    outputs: [8, 4],
  },
  {
    slug: "positive-sum",
    instruction: "Add only positive values.",
    values: [
      [-1, 2, 3],
      [-5, 4],
    ],
    outputs: [5, 4],
  },
  {
    slug: "absolute-sum",
    instruction: "Sum the magnitudes of all values.",
    values: [
      [-2, 3],
      [-1, -4],
    ],
    outputs: [5, 5],
  },
  {
    slug: "increment-positive",
    instruction: "Discard non-positive values and increment the rest.",
    values: [
      [-1, 2],
      [0, 3],
    ],
    outputs: [[3], [4]],
  },
];

const numericSeeds: ReadonlyArray<CaseSeed> = numericRows.map((row) => ({
  id: `numbers/${row.slug}`,
  instruction: row.instruction,
  catalogId: "benchmark.numbers",
  inputs: row.values.map((items) => ({ items })),
  outputs: row.outputs,
  properties: [
    input(),
    op(row.slug.includes("sum") ? "sum" : (row.slug.split("-")[0] ?? "double")),
  ],
}));

const textRows: ReadonlyArray<CollectionCaseSeed> = [
  {
    slug: "uppercase",
    instruction: "Uppercase every string.",
    values: [["a", "Bee"], ["x"]],
    outputs: [["A", "BEE"], ["X"]],
  },
  {
    slug: "trim",
    instruction: "Trim whitespace from every item.",
    values: [[" a ", "b"], [" x"]],
    outputs: [["a", "b"], ["x"]],
  },
  {
    slug: "exclaim",
    instruction: "Add an exclamation mark to each message.",
    values: [["hi", "ok"], ["go"]],
    outputs: [["hi!", "ok!"], ["go!"]],
  },
  {
    slug: "nonempty",
    instruction: "Remove empty strings.",
    values: [
      ["", "a"],
      ["b", ""],
    ],
    outputs: [["a"], ["b"]],
  },
  {
    slug: "concatenate",
    instruction: "Join the text values without a separator.",
    values: [
      ["a", "b"],
      ["x", "y", "z"],
    ],
    outputs: ["ab", "xyz"],
  },
  {
    slug: "trim-uppercase",
    instruction: "Trim and then uppercase each string.",
    values: [[" a ", "Bee "], [" x"]],
    outputs: [["A", "BEE"], ["X"]],
  },
  {
    slug: "nonempty-concatenate",
    instruction: "Remove empty strings and concatenate the rest.",
    values: [
      ["", "a", "b"],
      ["x", ""],
    ],
    outputs: ["ab", "x"],
  },
  {
    slug: "uppercase-exclaim",
    instruction: "Uppercase each message and add an exclamation mark.",
    values: [["hi"], ["go", "ok"]],
    outputs: [["HI!"], ["GO!", "OK!"]],
  },
  {
    slug: "trim-nonempty",
    instruction: "Trim each string and discard the empty results.",
    values: [
      [" ", " a "],
      ["x", ""],
    ],
    outputs: [["a"], ["x"]],
  },
];

const textSeeds: ReadonlyArray<CaseSeed> = textRows.map((row) => ({
  id: `text/${row.slug}`,
  instruction: row.instruction,
  catalogId: "benchmark.text",
  inputs: row.values.map((items) => ({ items })),
  outputs: row.outputs,
  properties: [input(), op(row.slug.split("-").at(-1) ?? "uppercase")],
}));

type DecisionCaseSeed = Readonly<{
  slug: string;
  instruction: string;
  conditions: ReadonlyArray<boolean>;
  outputs: ReadonlyArray<string>;
}>;

const decisionRows: ReadonlyArray<DecisionCaseSeed> = [
  {
    slug: "choose",
    instruction:
      "Return the primary label when condition is true, otherwise the fallback.",
    conditions: [true, false],
    outputs: ["primary", "fallback"],
  },
  {
    slug: "approve",
    instruction:
      "Choose the label by condition, then turn it into an approval message.",
    conditions: [true, false],
    outputs: ["approved:primary", "approved:fallback"],
  },
  {
    slug: "reject",
    instruction:
      "Choose the label by condition, then turn it into a rejection message.",
    conditions: [true, false],
    outputs: ["rejected:primary", "rejected:fallback"],
  },
  {
    slug: "approve-primary",
    instruction:
      "When approved use the primary label; otherwise use the fallback, and prefix the result as approved.",
    conditions: [false, true],
    outputs: ["approved:fallback", "approved:primary"],
  },
  {
    slug: "reject-primary",
    instruction:
      "Select a label from the flag and prefix the selection as rejected.",
    conditions: [false, true],
    outputs: ["rejected:fallback", "rejected:primary"],
  },
  {
    slug: "branch-only",
    instruction: "Select between two labels using the supplied boolean flag.",
    conditions: [false, true],
    outputs: ["fallback", "primary"],
  },
];

const decisionSeeds: ReadonlyArray<CaseSeed> = decisionRows.map((row) => ({
  id: `decisions/${row.slug}`,
  instruction: row.instruction,
  catalogId: "benchmark.decisions",
  inputs: row.conditions.map((condition) => ({
    condition,
    primary: "primary",
    fallback: "fallback",
  })),
  outputs: row.outputs,
  properties: [input("condition"), { kind: "maximumNodes", value: 8 }],
}));

const workflowSeeds: ReadonlyArray<CaseSeed> = [1, 2, 3, 5, 8].map(
  (remaining) => ({
    id: `workflow/countdown-${remaining}`,
    instruction: `Run the countdown to its fixed point for a state with up to ${remaining} remaining steps.`,
    catalogId: "benchmark.workflow",
    inputs: [
      { state: { remaining, value: 10 } },
      { state: { remaining: 0, value: 4 } },
    ],
    outputs: [
      { remaining: 0, value: 10 + remaining },
      { remaining: 0, value: 4 },
    ],
    properties: [input("state"), op("countdown-step"), op("remaining")],
  }),
);

const effectfulSeeds: ReadonlyArray<CaseSeed> = [
  {
    id: "numbers/tax-map",
    instruction: "Look up the tax quote for every number.",
    catalogId: "benchmark.numbers",
    inputs: [{ items: [1, 2] }, { items: [3] }],
    outputs: [[10, 20], [30]],
    properties: [input(), effect("tax.quote")],
    allowedCapabilities: ["finance.read"],
    effects: [
      [
        {
          effectName: "tax.quote",
          input: 1,
          output: 10,
          replayResultId: "tax/1",
          usage: { tokens: 2, wallClockMs: 3 },
        },
        {
          effectName: "tax.quote",
          input: 2,
          output: 20,
          replayResultId: "tax/2",
          usage: { tokens: 2, wallClockMs: 3 },
        },
      ],
      [
        {
          effectName: "tax.quote",
          input: 3,
          output: 30,
          replayResultId: "tax/3",
          usage: { tokens: 2, wallClockMs: 3 },
        },
      ],
    ],
  },
  {
    id: "text/translation-map",
    instruction:
      "Translate every text item using the declared language effect.",
    catalogId: "benchmark.text",
    inputs: [{ items: ["hello", "world"] }, { items: ["yes"] }],
    outputs: [["hola", "mundo"], ["sí"]],
    properties: [input(), effect("language.translate")],
    allowedCapabilities: ["language.translate"],
    effects: [
      [
        {
          effectName: "language.translate",
          input: "hello",
          output: "hola",
          replayResultId: "translation/hello",
          usage: { tokens: 4, wallClockMs: 5 },
        },
        {
          effectName: "language.translate",
          input: "world",
          output: "mundo",
          replayResultId: "translation/world",
          usage: { tokens: 4, wallClockMs: 5 },
        },
      ],
      [
        {
          effectName: "language.translate",
          input: "yes",
          output: "sí",
          replayResultId: "translation/yes",
          usage: { tokens: 4, wallClockMs: 5 },
        },
      ],
    ],
  },
];

const impossibleBudget = Object.freeze({
  ...DEFAULT_BUDGET,
  maxEffectCalls: 0,
  maxTokens: 0,
  maxWallClockMs: 0,
});

const impossibleSeeds: ReadonlyArray<CaseSeed> = [
  {
    id: "numbers/forbidden-tax",
    instruction:
      "Quote tax for every number, even though finance access is forbidden.",
    catalogId: "benchmark.numbers",
    inputs: [],
    outputs: [],
    properties: [effect("tax.quote")],
    feasible: false,
    forbidden: ["finance.read"],
  },
  {
    id: "numbers/zero-effect-budget",
    instruction: "Quote tax for every number with no effect calls available.",
    catalogId: "benchmark.numbers",
    inputs: [],
    outputs: [],
    properties: [effect("tax.quote")],
    allowedCapabilities: ["finance.read"],
    budget: impossibleBudget,
    feasible: false,
  },
  {
    id: "numbers/missing-average",
    instruction:
      "Compute the arithmetic mean, but no division or count operation exists.",
    catalogId: "benchmark.numbers",
    inputs: [],
    outputs: [],
    properties: [],
    feasible: false,
  },
  {
    id: "text/forbidden-translation",
    instruction:
      "Translate every string while translation capability is forbidden.",
    catalogId: "benchmark.text",
    inputs: [],
    outputs: [],
    properties: [effect("language.translate")],
    feasible: false,
    forbidden: ["language.translate"],
  },
  {
    id: "text/missing-sort",
    instruction:
      "Sort strings alphabetically, though the catalog has no sorting operation.",
    catalogId: "benchmark.text",
    inputs: [],
    outputs: [],
    properties: [],
    feasible: false,
  },
  {
    id: "decisions/missing-negation",
    instruction:
      "Invert the boolean condition before selecting, though negation is unavailable.",
    catalogId: "benchmark.decisions",
    inputs: [],
    outputs: [],
    properties: [],
    feasible: false,
  },
  {
    id: "workflow/recursion-forbidden",
    instruction:
      "Reach the countdown fixed point with recursion depth set to zero.",
    catalogId: "benchmark.workflow",
    inputs: [],
    outputs: [],
    properties: [op("countdown-step")],
    feasible: false,
    budget: { ...DEFAULT_BUDGET, maxRecursionDepth: 0 },
  },
  {
    id: "workflow/forbidden-enrichment",
    instruction:
      "Enrich workflow state while remote workflow access is forbidden.",
    catalogId: "benchmark.workflow",
    inputs: [],
    outputs: [],
    properties: [effect("workflow.enrich")],
    feasible: false,
    forbidden: ["workflow.remote"],
  },
  {
    id: "workflow/zero-effect-budget",
    instruction: "Enrich workflow state without any effect-call budget.",
    catalogId: "benchmark.workflow",
    inputs: [],
    outputs: [],
    properties: [effect("workflow.enrich")],
    feasible: false,
    allowedCapabilities: ["workflow.remote"],
    budget: impossibleBudget,
  },
  {
    id: "workflow/missing-reset",
    instruction:
      "Reset the accumulated value to zero without changing remaining, but no reset operation exists.",
    catalogId: "benchmark.workflow",
    inputs: [],
    outputs: [],
    properties: [],
    feasible: false,
  },
];

const CASE_SEEDS = Object.freeze([
  ...numericSeeds,
  ...textSeeds,
  ...decisionSeeds,
  ...workflowSeeds,
  ...effectfulSeeds,
  ...impossibleSeeds,
]);

export const M1A_HOLDOUTS = Object.freeze({
  catalogs: Object.freeze(["benchmark.workflow"]),
  operatorCombinations: Object.freeze([
    "numbers/double-sum",
    "numbers/positive-sum",
    "text/trim-uppercase",
    "text/nonempty-concatenate",
  ]),
  phrasings: Object.freeze([
    "numbers/absolute-sum",
    "text/uppercase-exclaim",
    "decisions/approve-primary",
    "decisions/reject-primary",
  ]),
});

export type M1aCorpusPartition = Readonly<{
  development: ReadonlyArray<FrozenPlanGenerationCase>;
  heldOutCatalogs: ReadonlyArray<FrozenPlanGenerationCase>;
  heldOutOperatorCombinations: ReadonlyArray<FrozenPlanGenerationCase>;
  heldOutPhrasings: ReadonlyArray<FrozenPlanGenerationCase>;
}>;

export function partitionM1aCorpus(
  cases: ReadonlyArray<FrozenPlanGenerationCase>,
): M1aCorpusPartition {
  const development: Array<FrozenPlanGenerationCase> = [];
  const heldOutCatalogs: Array<FrozenPlanGenerationCase> = [];
  const heldOutOperatorCombinations: Array<FrozenPlanGenerationCase> = [];
  const heldOutPhrasings: Array<FrozenPlanGenerationCase> = [];
  for (const item of cases) {
    if (M1A_HOLDOUTS.catalogs.includes(item.case.catalogId))
      heldOutCatalogs.push(item);
    else if (M1A_HOLDOUTS.operatorCombinations.includes(item.case.id))
      heldOutOperatorCombinations.push(item);
    else if (M1A_HOLDOUTS.phrasings.includes(item.case.id))
      heldOutPhrasings.push(item);
    else development.push(item);
  }
  return Object.freeze({
    development: Object.freeze(development),
    heldOutCatalogs: Object.freeze(heldOutCatalogs),
    heldOutOperatorCombinations: Object.freeze(heldOutOperatorCombinations),
    heldOutPhrasings: Object.freeze(heldOutPhrasings),
  });
}

export async function loadM1aCorpus(): Promise<
  Result<ReadonlyArray<FrozenPlanGenerationCase>, Diagnostics>
> {
  const frozen = await Promise.all(
    CASE_SEEDS.map((seed) => freezePlanGenerationCase(caseValue(seed))),
  );
  const diagnostics = frozen.flatMap((result) =>
    result.ok ? [] : result.error,
  );
  return diagnostics.length > 0
    ? { ok: false, error: diagnostics }
    : {
        ok: true,
        value: Object.freeze(
          frozen.flatMap((result) => (result.ok ? [result.value] : [])),
        ),
      };
}
