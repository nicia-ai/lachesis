import {
  type Catalog,
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
import {
  blindPlanGenerationValidityAudit,
  type BlindValidityCounts,
} from "./validity.js";

const VERSION = "1.0.0";

export const M2_CORPUS_PROTOCOL = Object.freeze({
  id: "lachesis-m2-ir-vs-restricted-capability-typescript-corpus",
  version: "2",
  priorHeldOutReuse: false,
  representations: Object.freeze([
    "functional-ir-with-typed-obligations",
    "restricted-capability-typescript",
  ]),
  pairing:
    "Every representation receives the same model, task instruction, public input contract, manifest, obligations, hidden evaluations, call limit, and repair limit.",
  heldOutAccessPolicy:
    "Counts-only validity audit until both representations, scorer, and execution protocol are frozen.",
});

const DEFAULT_POLICY = Object.freeze({
  allowedCapabilities: Object.freeze([]),
  budget: Object.freeze({
    maxEffectCalls: 8,
    maxCollectionItems: 64,
    maxRecursionDepth: 0,
    maxTokens: 1_024,
    maxWallClockMs: 2_000,
    maxParallelism: 4,
  }),
});

function numericCatalog(): Result<Catalog, Diagnostics> {
  const number = defineSchema({
    id: "m2-number",
    version: VERSION,
    description: "A finite M2 numeric value.",
    validator: z.number(),
  });
  const numbers = defineCollectionSchema({
    id: "m2-numbers",
    version: VERSION,
    description: "A bounded M2 numeric sequence.",
    validator: z.array(z.number()).max(64).readonly(),
    element: number,
    defaultMaxItems: 64,
  });
  return createCatalog({
    identity: { id: "m2.numbers", version: VERSION },
    schemas: [number.runtime, numbers.runtime],
    operations: [
      defineFunction({
        id: "square",
        version: VERSION,
        description: "Square one number.",
        input: number,
        output: number,
        stateChanging: true,
        implementation: (value) => value * value,
      }),
      defineFunction({
        id: "add-ten",
        version: VERSION,
        description: "Add ten to one number.",
        input: number,
        output: number,
        stateChanging: true,
        implementation: (value) => value + 10,
      }),
      definePredicate({
        id: "nonnegative",
        version: VERSION,
        description: "Keep numbers greater than or equal to zero.",
        input: number,
        implementation: (value) => value >= 0,
      }),
      defineReducer({
        id: "product",
        version: VERSION,
        description: "Multiply a sequence from identity one.",
        element: number,
        accumulator: number,
        identity: 1,
        laws: {
          associative: true,
          commutative: true,
          idempotent: false,
        },
        stateChanging: true,
        implementation: (total, value) => total * value,
      }),
      defineEffect({
        id: "risk-quote",
        version: VERSION,
        description: "Obtain a deterministic risk quote.",
        input: number,
        output: number,
        effectName: "m2.risk.quote",
        capability: "m2.risk.read",
        maxTokens: 80,
        maxWallClockMs: 40,
        replayable: true,
        stateChanging: true,
      }),
    ],
  });
}

function textCatalog(): Result<Catalog, Diagnostics> {
  const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
  const text = defineSchema({
    id: "m2-text",
    version: VERSION,
    description: "An M2 text value.",
    validator: z.string().max(256),
  });
  const texts = defineCollectionSchema({
    id: "m2-texts",
    version: VERSION,
    description: "A bounded M2 text sequence.",
    validator: z.array(z.string().max(256)).max(64).readonly(),
    element: text,
    defaultMaxItems: 64,
  });
  return createCatalog({
    identity: { id: "m2.text", version: VERSION },
    schemas: [text.runtime, texts.runtime],
    operations: [
      defineFunction({
        id: "surround",
        version: VERSION,
        description: "Surround text with square brackets.",
        input: text,
        output: text,
        stateChanging: true,
        implementation: (value) => `[${value}]`,
      }),
      defineFunction({
        id: "reverse",
        version: VERSION,
        description: "Reverse Unicode code points in text.",
        input: text,
        output: text,
        stateChanging: true,
        implementation: (value) =>
          [...graphemes.segment(value)]
            .map((segment) => segment.segment)
            .toReversed()
            .join(""),
      }),
      definePredicate({
        id: "has-dash",
        version: VERSION,
        description: "Keep text containing a dash.",
        input: text,
        implementation: (value) => value.includes("-"),
      }),
      defineReducer({
        id: "join-slash",
        version: VERSION,
        description: "Join text values with a leading slash separator.",
        element: text,
        accumulator: text,
        identity: "",
        laws: {
          associative: false,
          commutative: false,
          idempotent: false,
        },
        stateChanging: true,
        implementation: (total, value) =>
          total.length === 0 ? value : `${total}/${value}`,
      }),
      defineEffect({
        id: "redact",
        version: VERSION,
        description: "Redact text using a deterministic fixture.",
        input: text,
        output: text,
        effectName: "m2.text.redact",
        capability: "m2.redaction.use",
        maxTokens: 48,
        maxWallClockMs: 30,
        replayable: true,
        stateChanging: true,
      }),
    ],
  });
}

function decisionCatalog(): Result<Catalog, Diagnostics> {
  const condition = defineSchema({
    id: "m2-condition",
    version: VERSION,
    description: "An M2 branch condition.",
    validator: z.boolean(),
    semantic: "boolean",
  });
  const label = defineSchema({
    id: "m2-label",
    version: VERSION,
    description: "A bounded M2 decision label.",
    validator: z.string().max(128),
  });
  return createCatalog({
    identity: { id: "m2.decisions", version: VERSION },
    schemas: [condition.runtime, label.runtime],
    operations: [
      defineFunction({
        id: "approve",
        version: VERSION,
        description: "Mark the selected label approved.",
        input: label,
        output: label,
        stateChanging: true,
        implementation: (value) => `approved:${value}`,
      }),
      defineFunction({
        id: "review",
        version: VERSION,
        description: "Mark the selected label reviewed.",
        input: label,
        output: label,
        stateChanging: true,
        implementation: (value) => `reviewed:${value}`,
      }),
      defineEffect({
        id: "verify-label",
        version: VERSION,
        description: "Verify a selected label with a deterministic fixture.",
        input: label,
        output: label,
        effectName: "m2.decision.verify",
        capability: "m2.decision.verify",
        maxTokens: 32,
        maxWallClockMs: 25,
        replayable: true,
        stateChanging: true,
      }),
    ],
  });
}

const workflowStateSchema = z
  .strictObject({
    remaining: z.number().int().nonnegative().max(16),
    value: z.number(),
  })
  .readonly();

function workflowCatalog(): Result<Catalog, Diagnostics> {
  const state = defineSchema({
    id: "m2-workflow-state",
    version: VERSION,
    description: "An M2 bounded countdown and accumulated value.",
    validator: workflowStateSchema,
  });
  return createCatalog({
    identity: { id: "m2.workflow", version: VERSION },
    schemas: [state.runtime],
    operations: [
      defineFixedPointStep({
        id: "advance-one",
        version: VERSION,
        description: "Consume one remaining step and add one.",
        state,
        stateChanging: true,
        implementation: (value) =>
          value.remaining === 0
            ? value
            : { remaining: value.remaining - 1, value: value.value + 1 },
      }),
      defineFixedPointStep({
        id: "advance-two",
        version: VERSION,
        description: "Consume one remaining step and add two.",
        state,
        stateChanging: true,
        implementation: (value) =>
          value.remaining === 0
            ? value
            : { remaining: value.remaining - 1, value: value.value + 2 },
      }),
      defineMeasure({
        id: "remaining",
        version: VERSION,
        description: "Read the trusted remaining-work measure.",
        input: state,
        implementation: (value) => value.remaining,
      }),
      defineEffect({
        id: "enrich-state",
        version: VERSION,
        description: "Enrich state from a deterministic fixture.",
        input: state,
        output: state,
        effectName: "m2.workflow.enrich",
        capability: "m2.workflow.remote",
        maxTokens: 40,
        maxWallClockMs: 30,
        replayable: true,
        stateChanging: true,
      }),
    ],
  });
}

export function createM2CatalogResolver(): Result<
  CatalogResolver,
  Diagnostics
> {
  const numeric = numericCatalog();
  /* v8 ignore next -- fixed catalog declarations are validated at construction */
  if (!numeric.ok) return numeric;
  const text = textCatalog();
  /* v8 ignore next -- fixed catalog declarations are validated at construction */
  if (!text.ok) return text;
  const decisions = decisionCatalog();
  /* v8 ignore next -- fixed catalog declarations are validated at construction */
  if (!decisions.ok) return decisions;
  const workflow = workflowCatalog();
  /* v8 ignore next -- fixed catalog declarations are validated at construction */
  if (!workflow.ok) return workflow;
  const catalogs = new Map<string, Catalog>([
    ["m2.numbers", numeric.value],
    ["m2.text", text.value],
    ["m2.decisions", decisions.value],
    ["m2.workflow", workflow.value],
  ]);
  return {
    ok: true,
    value: (catalogId) => {
      const catalog = catalogs.get(catalogId);
      return catalog === undefined
        ? {
            ok: false,
            error: diagnostic(
              "CATALOG_REFERENCE_MISMATCH",
              `Unknown M2 catalog ${catalogId}.`,
            ),
          }
        : { ok: true, value: catalog };
    },
  };
}

type CaseDefinition = Readonly<{
  split: "development" | "heldout";
  category: "multi-step" | "branch" | "effect" | "recursion" | "infeasible";
  value: unknown;
}>;

function collectionInput(
  schema: "m2-numbers" | "m2-texts",
): ReadonlyArray<unknown> {
  return [
    {
      name: "items",
      schema: { id: schema, version: VERSION },
      declaredBounds: [{ kind: "maximumCollectionItems", value: 64 }],
    },
  ];
}

function feasibleCase(
  input: Readonly<{
    split: CaseDefinition["split"];
    id: string;
    instruction: string;
    catalogId: "m2.numbers" | "m2.text";
    operations: ReadonlyArray<string>;
    evaluations: ReadonlyArray<
      Readonly<{ items: ReadonlyArray<number | string>; output: unknown }>
    >;
  }>,
): CaseDefinition {
  return {
    split: input.split,
    category: "multi-step",
    value: {
      id: input.id,
      instruction: input.instruction,
      catalogId: input.catalogId,
      policy: DEFAULT_POLICY,
      taskInputs: collectionInput(
        input.catalogId === "m2.numbers" ? "m2-numbers" : "m2-texts",
      ),
      publicExamples: [],
      hiddenEvaluations: input.evaluations.map((evaluation, index) => ({
        id: `${input.id}/hidden-${index + 1}`,
        inputs: { items: evaluation.items },
        effects: [],
        expectedOutput: evaluation.output,
      })),
      expectedFeasibility: "plannable",
      infeasibilityWitness: null,
      requiredProperties: [
        { kind: "usesInput", inputKey: "items" },
        ...input.operations.map((id) => ({
          kind: "usesOperation",
          id,
          version: VERSION,
        })),
      ],
      semanticObligations: [
        { kind: "rootDependsOnInput", inputKey: "items" },
        ...input.operations.map((id) => ({
          kind: "requiresOperation",
          operation: { id, version: VERSION },
        })),
        { kind: "requiresStateChange" },
      ],
      forbiddenCapabilities: [],
    },
  };
}

function branchCase(
  input: Readonly<{
    split: CaseDefinition["split"];
    id: string;
    instruction: string;
    operation: "approve" | "review";
    evaluations: ReadonlyArray<
      Readonly<{
        condition: boolean;
        primary: string;
        fallback: string;
        output: string;
      }>
    >;
  }>,
): CaseDefinition {
  return {
    split: input.split,
    category: "branch",
    value: {
      id: input.id,
      instruction: input.instruction,
      catalogId: "m2.decisions",
      policy: DEFAULT_POLICY,
      taskInputs: [
        {
          name: "condition",
          schema: { id: "m2-condition", version: VERSION },
          declaredBounds: [],
        },
        ...["primary", "fallback"].map((name) => ({
          name,
          schema: { id: "m2-label", version: VERSION },
          declaredBounds: [],
        })),
      ],
      publicExamples: [],
      hiddenEvaluations: input.evaluations.map((evaluation, index) => ({
        id: `${input.id}/hidden-${index + 1}`,
        inputs: {
          condition: evaluation.condition,
          primary: evaluation.primary,
          fallback: evaluation.fallback,
        },
        effects: [],
        expectedOutput: evaluation.output,
      })),
      expectedFeasibility: "plannable",
      infeasibilityWitness: null,
      requiredProperties: [
        { kind: "usesInput", inputKey: "condition" },
        { kind: "usesOperation", id: input.operation, version: VERSION },
      ],
      semanticObligations: [
        { kind: "rootDependsOnInput", inputKey: "condition" },
        {
          kind: "operationDominatesRoot",
          operation: { id: input.operation, version: VERSION },
        },
        { kind: "requiresStateChange" },
      ],
      forbiddenCapabilities: [],
    },
  };
}

function effectCase(
  input: Readonly<{
    split: CaseDefinition["split"];
    id: string;
    instruction: string;
    catalogId: "m2.numbers" | "m2.text" | "m2.decisions" | "m2.workflow";
    inputName: string;
    inputSchema: string;
    operation: string;
    effectName: string;
    capability: string;
    evaluations: ReadonlyArray<
      Readonly<{
        input: unknown;
        effectOutput: unknown;
        tokens: number;
        wallClockMs: number;
      }>
    >;
  }>,
): CaseDefinition {
  const policy = {
    ...DEFAULT_POLICY,
    allowedCapabilities: [input.capability],
  };
  return {
    split: input.split,
    category: "effect",
    value: {
      id: input.id,
      instruction: input.instruction,
      catalogId: input.catalogId,
      policy,
      taskInputs: [
        {
          name: input.inputName,
          schema: { id: input.inputSchema, version: VERSION },
          declaredBounds: [],
        },
      ],
      publicExamples: [],
      hiddenEvaluations: input.evaluations.map((evaluation, index) => ({
        id: `${input.id}/hidden-${index + 1}`,
        inputs: { [input.inputName]: evaluation.input },
        effects: [
          {
            effectName: input.effectName,
            input: evaluation.input,
            output: evaluation.effectOutput,
            replayResultId: `${input.id}/effect-${index + 1}`,
            usage: {
              tokens: evaluation.tokens,
              wallClockMs: evaluation.wallClockMs,
            },
          },
        ],
        expectedOutput: evaluation.effectOutput,
      })),
      expectedFeasibility: "plannable",
      infeasibilityWitness: null,
      requiredProperties: [
        { kind: "usesInput", inputKey: input.inputName },
        { kind: "usesEffect", name: input.effectName },
        { kind: "usesOperation", id: input.operation, version: VERSION },
      ],
      semanticObligations: [
        { kind: "rootDependsOnInput", inputKey: input.inputName },
        { kind: "requiresEffect", effectName: input.effectName },
        {
          kind: "requiresOperation",
          operation: { id: input.operation, version: VERSION },
        },
        { kind: "requiresStateChange" },
      ],
      forbiddenCapabilities: [],
    },
  };
}

function recursionCase(
  input: Readonly<{
    split: CaseDefinition["split"];
    id: string;
    instruction: string;
    step: "advance-one" | "advance-two";
    increment: 1 | 2;
    evaluations: ReadonlyArray<
      Readonly<{
        remaining: number;
        value: number;
      }>
    >;
  }>,
): CaseDefinition {
  const policy = {
    ...DEFAULT_POLICY,
    budget: { ...DEFAULT_POLICY.budget, maxRecursionDepth: 16 },
  };
  return {
    split: input.split,
    category: "recursion",
    value: {
      id: input.id,
      instruction: input.instruction,
      catalogId: "m2.workflow",
      policy,
      taskInputs: [
        {
          name: "state",
          schema: { id: "m2-workflow-state", version: VERSION },
          declaredBounds: [],
        },
      ],
      publicExamples: [],
      hiddenEvaluations: input.evaluations.map((evaluation, index) => ({
        id: `${input.id}/hidden-${index + 1}`,
        inputs: {
          state: {
            remaining: evaluation.remaining,
            value: evaluation.value,
          },
        },
        effects: [],
        expectedOutput: {
          remaining: 0,
          value: evaluation.value + evaluation.remaining * input.increment,
        },
      })),
      expectedFeasibility: "plannable",
      infeasibilityWitness: null,
      requiredProperties: [
        { kind: "usesInput", inputKey: "state" },
        { kind: "usesOperation", id: input.step, version: VERSION },
        { kind: "usesOperation", id: "remaining", version: VERSION },
      ],
      semanticObligations: [
        { kind: "rootDependsOnInput", inputKey: "state" },
        {
          kind: "requiresOperation",
          operation: { id: input.step, version: VERSION },
        },
        { kind: "requiresStateChange" },
      ],
      forbiddenCapabilities: [],
    },
  };
}

function defaultTaskInputs(
  catalogId: "m2.numbers" | "m2.text" | "m2.decisions" | "m2.workflow",
): ReadonlyArray<unknown> {
  if (catalogId === "m2.numbers") return collectionInput("m2-numbers");
  if (catalogId === "m2.text") return collectionInput("m2-texts");
  if (catalogId === "m2.workflow")
    return [
      {
        name: "state",
        schema: { id: "m2-workflow-state", version: VERSION },
        declaredBounds: [],
      },
    ];
  return [
    {
      name: "condition",
      schema: { id: "m2-condition", version: VERSION },
      declaredBounds: [],
    },
    ...["primary", "fallback"].map((name) => ({
      name,
      schema: { id: "m2-label", version: VERSION },
      declaredBounds: [],
    })),
  ];
}

function defaultInputName(
  catalogId: "m2.numbers" | "m2.text" | "m2.decisions" | "m2.workflow",
): "items" | "condition" | "state" {
  return catalogId === "m2.decisions"
    ? "condition"
    : catalogId === "m2.workflow"
      ? "state"
      : "items";
}

function unplannableCase(
  input: Readonly<{
    split: CaseDefinition["split"];
    id: string;
    instruction: string;
    catalogId: "m2.numbers" | "m2.text" | "m2.decisions" | "m2.workflow";
    witness:
      | Readonly<{ kind: "missingOperation"; operation: string }>
      | Readonly<{
          kind: "deniedCapability";
          operation: string;
          capability: string;
        }>
      | Readonly<{
          kind: "insufficientBudget";
          operation: string;
          resource: "maxEffectCalls";
          requiredMinimum: number;
        }>;
  }>,
): CaseDefinition {
  const operation = { id: input.witness.operation, version: VERSION };
  const policy =
    input.witness.kind === "insufficientBudget"
      ? {
          ...DEFAULT_POLICY,
          budget: {
            ...DEFAULT_POLICY.budget,
            [input.witness.resource]: input.witness.requiredMinimum - 1,
          },
        }
      : DEFAULT_POLICY;
  return {
    split: input.split,
    category: "infeasible",
    value: {
      id: input.id,
      instruction: input.instruction,
      catalogId: input.catalogId,
      policy,
      taskInputs: defaultTaskInputs(input.catalogId),
      publicExamples: [],
      hiddenEvaluations: [],
      expectedFeasibility: "unplannable",
      infeasibilityWitness: { ...input.witness, operation },
      requiredProperties: [],
      semanticObligations: [
        {
          kind: "rootDependsOnInput",
          inputKey: defaultInputName(input.catalogId),
        },
        { kind: "requiresOperation", operation },
      ],
      forbiddenCapabilities:
        input.witness.kind === "deniedCapability"
          ? [input.witness.capability]
          : [],
    },
  };
}

const DEFINITIONS: ReadonlyArray<CaseDefinition> = Object.freeze([
  feasibleCase({
    split: "development",
    id: "m2/dev/numbers/nonnegative-squares",
    instruction: "Keep nonnegative inputs, then square every retained number.",
    catalogId: "m2.numbers",
    operations: ["nonnegative", "square"],
    evaluations: [
      { items: [-4, 0, 3], output: [0, 9] },
      { items: [2, -9], output: [4] },
    ],
  }),
  feasibleCase({
    split: "development",
    id: "m2/dev/numbers/add-ten-product",
    instruction: "Add ten to every input, then multiply all results.",
    catalogId: "m2.numbers",
    operations: ["add-ten", "product"],
    evaluations: [
      { items: [1, 2, 3], output: 1716 },
      { items: [], output: 1 },
    ],
  }),
  feasibleCase({
    split: "development",
    id: "m2/dev/text/reverse-surround",
    instruction: "Reverse every text value, then surround every result.",
    catalogId: "m2.text",
    operations: ["reverse", "surround"],
    evaluations: [
      { items: ["ab", "x-y"], output: ["[ba]", "[y-x]"] },
      { items: [""], output: ["[]"] },
    ],
  }),
  branchCase({
    split: "development",
    id: "m2/dev/decisions/select-approve",
    instruction:
      "Select primary when the condition is true and fallback otherwise, then approve the selected label.",
    operation: "approve",
    evaluations: [
      {
        condition: true,
        primary: "alpha",
        fallback: "beta",
        output: "approved:alpha",
      },
      {
        condition: false,
        primary: "north",
        fallback: "south",
        output: "approved:south",
      },
    ],
  }),
  effectCase({
    split: "development",
    id: "m2/dev/numbers/risk-quote",
    instruction: "Obtain the required deterministic risk quote for the value.",
    catalogId: "m2.numbers",
    inputName: "value",
    inputSchema: "m2-number",
    operation: "risk-quote",
    effectName: "m2.risk.quote",
    capability: "m2.risk.read",
    evaluations: [
      { input: 4, effectOutput: 17, tokens: 8, wallClockMs: 5 },
      { input: -2, effectOutput: 3, tokens: 7, wallClockMs: 4 },
    ],
  }),
  recursionCase({
    split: "development",
    id: "m2/dev/workflow/advance-one",
    instruction:
      "Reach the bounded fixed point by consuming each remaining step and adding one.",
    step: "advance-one",
    increment: 1,
    evaluations: [
      { remaining: 3, value: 5 },
      { remaining: 0, value: 9 },
    ],
  }),
  unplannableCase({
    split: "development",
    id: "m2/dev/numbers/missing-median",
    instruction: "Return the median using the required median operation.",
    catalogId: "m2.numbers",
    witness: { kind: "missingOperation", operation: "median" },
  }),
  unplannableCase({
    split: "development",
    id: "m2/dev/text/denied-redaction",
    instruction: "Redact the input texts using the required redaction service.",
    catalogId: "m2.text",
    witness: {
      kind: "deniedCapability",
      operation: "redact",
      capability: "m2.redaction.use",
    },
  }),
  unplannableCase({
    split: "development",
    id: "m2/dev/numbers/insufficient-risk-budget",
    instruction: "Obtain a risk quote using the required quote operation.",
    catalogId: "m2.numbers",
    witness: {
      kind: "insufficientBudget",
      operation: "risk-quote",
      resource: "maxEffectCalls",
      requiredMinimum: 1,
    },
  }),
  feasibleCase({
    split: "heldout",
    id: "m2/heldout/numbers/square-add-ten",
    instruction:
      "Square each supplied number before adding ten to each square.",
    catalogId: "m2.numbers",
    operations: ["square", "add-ten"],
    evaluations: [
      { items: [-3, 1], output: [19, 11] },
      { items: [0, 5], output: [10, 35] },
    ],
  }),
  feasibleCase({
    split: "heldout",
    id: "m2/heldout/numbers/nonnegative-adjusted-product",
    instruction:
      "Keep nonnegative numbers, add ten to each retained value, and multiply the results.",
    catalogId: "m2.numbers",
    operations: ["nonnegative", "add-ten", "product"],
    evaluations: [
      { items: [-2, 0, 2], output: 120 },
      { items: [-7], output: 1 },
    ],
  }),
  feasibleCase({
    split: "heldout",
    id: "m2/heldout/text/dashed-reversed",
    instruction:
      "Keep values containing a dash, then reverse each retained value.",
    catalogId: "m2.text",
    operations: ["has-dash", "reverse"],
    evaluations: [
      { items: ["ab", "c-d", "e-f-g"], output: ["d-c", "g-f-e"] },
      { items: ["none"], output: [] },
    ],
  }),
  feasibleCase({
    split: "heldout",
    id: "m2/heldout/text/surrounded-slash-join",
    instruction: "Surround every value, then join the sequence with slashes.",
    catalogId: "m2.text",
    operations: ["surround", "join-slash"],
    evaluations: [
      { items: ["a", "bc"], output: "[a]/[bc]" },
      { items: [], output: "" },
    ],
  }),
  feasibleCase({
    split: "heldout",
    id: "m2/heldout/numbers/squared-product",
    instruction: "Square every number and multiply all squared results.",
    catalogId: "m2.numbers",
    operations: ["square", "product"],
    evaluations: [
      { items: [2, 3], output: 36 },
      { items: [], output: 1 },
    ],
  }),
  feasibleCase({
    split: "heldout",
    id: "m2/heldout/text/reversed-slash-join",
    instruction:
      "Reverse every text and join the resulting sequence with slashes.",
    catalogId: "m2.text",
    operations: ["reverse", "join-slash"],
    evaluations: [
      { items: ["ab", "cde"], output: "ba/edc" },
      { items: ["x"], output: "x" },
    ],
  }),
  ...[
    {
      id: "approve-primary-or-fallback",
      operation: "approve" as const,
      first: { condition: true, primary: "red", fallback: "blue" },
      second: { condition: false, primary: "east", fallback: "west" },
    },
    {
      id: "review-primary-or-fallback",
      operation: "review" as const,
      first: { condition: false, primary: "hot", fallback: "cold" },
      second: { condition: true, primary: "up", fallback: "down" },
    },
    {
      id: "approve-route-choice",
      operation: "approve" as const,
      first: { condition: false, primary: "rail", fallback: "road" },
      second: { condition: true, primary: "sea", fallback: "air" },
    },
    {
      id: "review-deployment-choice",
      operation: "review" as const,
      first: { condition: true, primary: "canary", fallback: "hold" },
      second: { condition: false, primary: "ship", fallback: "pause" },
    },
    {
      id: "approve-language-choice",
      operation: "approve" as const,
      first: { condition: true, primary: "typed", fallback: "dynamic" },
      second: { condition: false, primary: "local", fallback: "remote" },
    },
    {
      id: "review-policy-choice",
      operation: "review" as const,
      first: { condition: false, primary: "allow", fallback: "deny" },
      second: { condition: true, primary: "audit", fallback: "skip" },
    },
  ].map((definition) =>
    branchCase({
      split: "heldout",
      id: `m2/heldout/decisions/${definition.id}`,
      instruction: `Select the condition-directed label and ${definition.operation} it after selection.`,
      operation: definition.operation,
      evaluations: [
        {
          ...definition.first,
          output: `${definition.operation === "approve" ? "approved" : "reviewed"}:${definition.first.condition ? definition.first.primary : definition.first.fallback}`,
        },
        {
          ...definition.second,
          output: `${definition.operation === "approve" ? "approved" : "reviewed"}:${definition.second.condition ? definition.second.primary : definition.second.fallback}`,
        },
      ],
    }),
  ),
  effectCase({
    split: "heldout",
    id: "m2/heldout/effects/risk-positive",
    instruction:
      "Fetch the required risk quote for the supplied numeric value.",
    catalogId: "m2.numbers",
    inputName: "value",
    inputSchema: "m2-number",
    operation: "risk-quote",
    effectName: "m2.risk.quote",
    capability: "m2.risk.read",
    evaluations: [
      { input: 8, effectOutput: 21, tokens: 9, wallClockMs: 6 },
      { input: 1, effectOutput: 5, tokens: 6, wallClockMs: 3 },
    ],
  }),
  effectCase({
    split: "heldout",
    id: "m2/heldout/effects/risk-negative",
    instruction:
      "Return the deterministic risk-service result for the input number.",
    catalogId: "m2.numbers",
    inputName: "value",
    inputSchema: "m2-number",
    operation: "risk-quote",
    effectName: "m2.risk.quote",
    capability: "m2.risk.read",
    evaluations: [
      { input: -7, effectOutput: 14, tokens: 10, wallClockMs: 7 },
      { input: 0, effectOutput: 2, tokens: 5, wallClockMs: 2 },
    ],
  }),
  effectCase({
    split: "heldout",
    id: "m2/heldout/effects/redact-short",
    instruction:
      "Redact the supplied text through the registered deterministic service.",
    catalogId: "m2.text",
    inputName: "text",
    inputSchema: "m2-text",
    operation: "redact",
    effectName: "m2.text.redact",
    capability: "m2.redaction.use",
    evaluations: [
      { input: "alpha", effectOutput: "[redacted]", tokens: 7, wallClockMs: 4 },
      { input: "beta", effectOutput: "b***", tokens: 8, wallClockMs: 5 },
    ],
  }),
  effectCase({
    split: "heldout",
    id: "m2/heldout/effects/redact-punctuated",
    instruction:
      "Use the required redaction capability on the exact input text.",
    catalogId: "m2.text",
    inputName: "text",
    inputSchema: "m2-text",
    operation: "redact",
    effectName: "m2.text.redact",
    capability: "m2.redaction.use",
    evaluations: [
      { input: "a-b", effectOutput: "*-*", tokens: 9, wallClockMs: 5 },
      { input: "x/y", effectOutput: "*/y", tokens: 9, wallClockMs: 5 },
    ],
  }),
  effectCase({
    split: "heldout",
    id: "m2/heldout/effects/verify-decision",
    instruction:
      "Verify the supplied decision label with the registered verifier.",
    catalogId: "m2.decisions",
    inputName: "label",
    inputSchema: "m2-label",
    operation: "verify-label",
    effectName: "m2.decision.verify",
    capability: "m2.decision.verify",
    evaluations: [
      {
        input: "green",
        effectOutput: "verified:green",
        tokens: 6,
        wallClockMs: 3,
      },
      {
        input: "amber",
        effectOutput: "verified:amber",
        tokens: 7,
        wallClockMs: 4,
      },
    ],
  }),
  effectCase({
    split: "heldout",
    id: "m2/heldout/effects/enrich-workflow",
    instruction:
      "Enrich the supplied workflow state through the registered capability.",
    catalogId: "m2.workflow",
    inputName: "state",
    inputSchema: "m2-workflow-state",
    operation: "enrich-state",
    effectName: "m2.workflow.enrich",
    capability: "m2.workflow.remote",
    evaluations: [
      {
        input: { remaining: 2, value: 3 },
        effectOutput: { remaining: 2, value: 30 },
        tokens: 11,
        wallClockMs: 7,
      },
      {
        input: { remaining: 0, value: 5 },
        effectOutput: { remaining: 0, value: 50 },
        tokens: 10,
        wallClockMs: 6,
      },
    ],
  }),
  ...[
    {
      id: "advance-one-small",
      step: "advance-one" as const,
      increment: 1 as const,
      a: [2, 4],
      b: [0, 7],
    },
    {
      id: "advance-one-large",
      step: "advance-one" as const,
      increment: 1 as const,
      a: [6, -1],
      b: [3, 10],
    },
    {
      id: "advance-one-zero",
      step: "advance-one" as const,
      increment: 1 as const,
      a: [0, 0],
      b: [1, 9],
    },
    {
      id: "advance-two-small",
      step: "advance-two" as const,
      increment: 2 as const,
      a: [2, 5],
      b: [0, 3],
    },
    {
      id: "advance-two-large",
      step: "advance-two" as const,
      increment: 2 as const,
      a: [7, -2],
      b: [4, 1],
    },
    {
      id: "advance-two-zero",
      step: "advance-two" as const,
      increment: 2 as const,
      a: [0, 11],
      b: [1, -3],
    },
  ].map((definition) =>
    recursionCase({
      split: "heldout",
      id: `m2/heldout/workflow/${definition.id}`,
      instruction: `Reach the bounded workflow fixed point with ${definition.step}, using the trusted remaining measure.`,
      step: definition.step,
      increment: definition.increment,
      evaluations: [
        { remaining: definition.a[0] ?? 0, value: definition.a[1] ?? 0 },
        { remaining: definition.b[0] ?? 0, value: definition.b[1] ?? 0 },
      ],
    }),
  ),
  unplannableCase({
    split: "heldout",
    id: "m2/heldout/text/missing-sort",
    instruction: "Sort the texts using the required locale-sort operation.",
    catalogId: "m2.text",
    witness: { kind: "missingOperation", operation: "locale-sort" },
  }),
  unplannableCase({
    split: "heldout",
    id: "m2/heldout/numbers/denied-risk",
    instruction: "Obtain required risk quotes for the supplied numbers.",
    catalogId: "m2.numbers",
    witness: {
      kind: "deniedCapability",
      operation: "risk-quote",
      capability: "m2.risk.read",
    },
  }),
  unplannableCase({
    split: "heldout",
    id: "m2/heldout/text/insufficient-redaction-budget",
    instruction:
      "Redact the supplied text with the required redaction operation.",
    catalogId: "m2.text",
    witness: {
      kind: "insufficientBudget",
      operation: "redact",
      resource: "maxEffectCalls",
      requiredMinimum: 1,
    },
  }),
  unplannableCase({
    split: "heldout",
    id: "m2/heldout/decisions/missing-rank",
    instruction:
      "Rank the selected decision with the required rank-label operation.",
    catalogId: "m2.decisions",
    witness: { kind: "missingOperation", operation: "rank-label" },
  }),
  unplannableCase({
    split: "heldout",
    id: "m2/heldout/workflow/denied-enrichment",
    instruction:
      "Enrich the workflow using the required remote state operation.",
    catalogId: "m2.workflow",
    witness: {
      kind: "deniedCapability",
      operation: "enrich-state",
      capability: "m2.workflow.remote",
    },
  }),
  unplannableCase({
    split: "heldout",
    id: "m2/heldout/numbers/insufficient-risk-call",
    instruction:
      "Obtain the required risk-service result within the declared policy.",
    catalogId: "m2.numbers",
    witness: {
      kind: "insufficientBudget",
      operation: "risk-quote",
      resource: "maxEffectCalls",
      requiredMinimum: 1,
    },
  }),
]);

export type M2PreregisteredCorpus = Readonly<{
  development: ReadonlyArray<FrozenPlanGenerationCase>;
  heldOut: ReadonlyArray<FrozenPlanGenerationCase>;
}>;

export type M2BlindAuditCounts = BlindValidityCounts &
  Readonly<{
    loadValid: boolean;
    categories: Readonly<{
      multiStep: number;
      branch: number;
      effect: number;
      recursion: number;
      infeasible: number;
    }>;
    witnessKinds: Readonly<{
      missingOperation: number;
      deniedCapability: number;
      insufficientBudget: number;
    }>;
  }>;

export async function loadM2PreregisteredCorpus(): Promise<
  Result<M2PreregisteredCorpus, Diagnostics>
> {
  const development: Array<FrozenPlanGenerationCase> = [];
  const heldOut: Array<FrozenPlanGenerationCase> = [];
  const diagnostics: Array<Diagnostics[number]> = [];
  for (const definition of DEFINITIONS) {
    const frozen = await freezePlanGenerationCase(definition.value);
    if (!frozen.ok) diagnostics.push(...frozen.error);
    else if (definition.split === "development") development.push(frozen.value);
    else heldOut.push(frozen.value);
  }
  return diagnostics.length > 0
    ? { ok: false, error: diagnostics }
    : {
        ok: true,
        value: Object.freeze({
          development: Object.freeze(development),
          heldOut: Object.freeze(heldOut),
        }),
      };
}

/** Counts-only audit: never returns case IDs, prompts, inputs, effects, or outputs. */
export async function blindM2HeldOutIntegrityAudit(): Promise<M2BlindAuditCounts> {
  const definitions = DEFINITIONS.filter(
    (definition) => definition.split === "heldout",
  );
  const categories = {
    multiStep: definitions.filter(
      (definition) => definition.category === "multi-step",
    ).length,
    branch: definitions.filter((definition) => definition.category === "branch")
      .length,
    effect: definitions.filter((definition) => definition.category === "effect")
      .length,
    recursion: definitions.filter(
      (definition) => definition.category === "recursion",
    ).length,
    infeasible: definitions.filter(
      (definition) => definition.category === "infeasible",
    ).length,
  };
  const loaded = await loadM2PreregisteredCorpus();
  if (!loaded.ok)
    return Object.freeze({
      loadValid: false,
      totalCases: definitions.length,
      plannableCases: 0,
      unplannableCases: 0,
      referencesValid: 0,
      witnessesCompiled: 0,
      hiddenPropertiesPassed: 0,
      infeasibilityWitnessesPassed: 0,
      invalidCases: definitions.length,
      categories,
      witnessKinds: {
        missingOperation: 0,
        deniedCapability: 0,
        insufficientBudget: 0,
      },
    });
  const resolver = createM2CatalogResolver();
  const validity = resolver.ok
    ? await blindPlanGenerationValidityAudit(
        loaded.value.heldOut,
        resolver.value,
      )
    : {
        totalCases: loaded.value.heldOut.length,
        plannableCases: 0,
        unplannableCases: 0,
        referencesValid: 0,
        witnessesCompiled: 0,
        hiddenPropertiesPassed: 0,
        infeasibilityWitnessesPassed: 0,
        invalidCases: loaded.value.heldOut.length,
      };
  const witnesses = loaded.value.heldOut.flatMap((item) =>
    item.case.infeasibilityWitness === null
      ? []
      : [item.case.infeasibilityWitness.kind],
  );
  return Object.freeze({
    ...validity,
    loadValid: resolver.ok,
    categories,
    witnessKinds: {
      missingOperation: witnesses.filter((kind) => kind === "missingOperation")
        .length,
      deniedCapability: witnesses.filter((kind) => kind === "deniedCapability")
        .length,
      insufficientBudget: witnesses.filter(
        (kind) => kind === "insufficientBudget",
      ).length,
    },
  });
}

export function assertM2CorpusNamespaceDisjoint(
  cases: ReadonlyArray<FrozenPlanGenerationCase>,
): Result<void, Diagnostics> {
  const diagnostics = cases
    .filter(
      (item) =>
        !item.case.id.startsWith("m2/") ||
        !item.case.catalogId.startsWith("m2."),
    )
    .map((item) =>
      diagnostic(
        "INTERNAL_INVARIANT_VIOLATION",
        `M2 case ${item.case.id} does not use the disjoint M2 namespace.`,
      ),
    );
  return diagnostics.length === 0
    ? { ok: true, value: undefined }
    : { ok: false, error: diagnostics };
}
