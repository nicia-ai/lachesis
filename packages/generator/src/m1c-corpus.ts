import { type Diagnostic, diagnostic, type Result } from "@nicia-ai/lachesis";

import type { FrozenPlanGenerationCase } from "./case.js";
import { freezePlanGenerationCase } from "./case.js";

const NUMBER_VERSION = "1.0.0";
const WORKFLOW_VERSION = "1.1.0";

const DEFAULT_POLICY = Object.freeze({
  allowedCapabilities: Object.freeze([]),
  budget: Object.freeze({
    maxEffectCalls: 128,
    maxCollectionItems: 128,
    maxRecursionDepth: 16,
    maxTokens: 8_192,
    maxWallClockMs: 10_000,
    maxParallelism: 8,
  }),
});

export const M1C_CORPUS_PROTOCOL = Object.freeze({
  id: "lachesis-m1c-typed-semantic-obligations-corpus",
  version: "2",
  priorHeldOutReuse: false,
  representation: "functional-ir",
  codeModeStatus: "not-implemented-not-claimed",
  heldOutAccessPolicy:
    "Counts-only validity audit until the prompt, scorer, and execution protocol are frozen.",
});

type CaseDefinition = Readonly<{
  split: "development" | "heldout";
  value: unknown;
}>;

function collectionInput(id: "numbers" | "texts"): ReadonlyArray<unknown> {
  return [
    {
      name: "items",
      schema: { id, version: NUMBER_VERSION },
      declaredBounds: [{ kind: "maximumCollectionItems", value: 128 }],
    },
  ];
}

function collectionCase(
  input: Readonly<{
    split: CaseDefinition["split"];
    id: string;
    instruction: string;
    catalogId: "benchmark.numbers" | "benchmark.text";
    inputs: ReadonlyArray<ReadonlyArray<number | string>>;
    outputs: ReadonlyArray<unknown>;
    operations: ReadonlyArray<string>;
    effects?: ReadonlyArray<ReadonlyArray<unknown>> | undefined;
    effectName?: string | undefined;
    allowedCapabilities?: ReadonlyArray<string> | undefined;
  }>,
): CaseDefinition {
  const inputSchema =
    input.catalogId === "benchmark.numbers" ? "numbers" : "texts";
  const properties = [
    { kind: "usesInput", inputKey: "items" },
    ...input.operations.map((id) => ({
      kind: "usesOperation",
      id,
      version: NUMBER_VERSION,
    })),
    ...(input.effectName === undefined
      ? []
      : [{ kind: "usesEffect", name: input.effectName }]),
  ];
  const semanticObligations = [
    { kind: "rootDependsOnInput", inputKey: "items" },
    ...input.operations.map((id) => ({
      kind: "requiresOperation",
      operation: { id, version: NUMBER_VERSION },
    })),
    ...(input.effectName === undefined
      ? []
      : [{ kind: "requiresEffect", effectName: input.effectName }]),
  ];
  return {
    split: input.split,
    value: {
      id: input.id,
      instruction: input.instruction,
      catalogId: input.catalogId,
      policy: {
        ...DEFAULT_POLICY,
        allowedCapabilities: input.allowedCapabilities ?? [],
      },
      taskInputs: collectionInput(inputSchema),
      publicExamples: [],
      hiddenEvaluations: input.inputs.map((items, index) => ({
        id: `${input.id}/hidden-${index + 1}`,
        inputs: { items },
        effects: input.effects?.[index] ?? [],
        expectedOutput: input.outputs[index],
      })),
      expectedFeasibility: "plannable",
      infeasibilityWitness: null,
      requiredProperties: properties,
      semanticObligations,
      forbiddenCapabilities: [],
    },
  };
}

function decisionCase(
  split: CaseDefinition["split"],
  operation: "approve-label" | "reject-label",
): CaseDefinition {
  const action = operation === "approve-label" ? "approve" : "reject";
  const id = `m1c/decisions/${action}-after-choice`;
  return {
    split,
    value: {
      id,
      instruction: `Choose the requested label from the flag, then apply the ${action} transformation to every possible branch.`,
      catalogId: "benchmark.decisions",
      policy: DEFAULT_POLICY,
      taskInputs: [
        {
          name: "condition",
          schema: { id: "boolean", version: NUMBER_VERSION },
          declaredBounds: [],
        },
        {
          name: "primary",
          schema: { id: "label", version: NUMBER_VERSION },
          declaredBounds: [],
        },
        {
          name: "fallback",
          schema: { id: "label", version: NUMBER_VERSION },
          declaredBounds: [],
        },
      ],
      publicExamples: [],
      hiddenEvaluations: [false, true].map((condition, index) => ({
        id: `${id}/hidden-${index + 1}`,
        inputs: {
          condition,
          primary: "north",
          fallback: "south",
        },
        effects: [],
        expectedOutput: `${operation === "approve-label" ? "approved" : "rejected"}:${condition ? "north" : "south"}`,
      })),
      expectedFeasibility: "plannable",
      infeasibilityWitness: null,
      requiredProperties: [
        { kind: "usesInput", inputKey: "condition" },
        { kind: "usesOperation", id: operation, version: NUMBER_VERSION },
      ],
      semanticObligations: [
        { kind: "rootDependsOnInput", inputKey: "condition" },
        { kind: "rootDependsOnInput", inputKey: "primary" },
        { kind: "rootDependsOnInput", inputKey: "fallback" },
        {
          kind: "operationDominatesRoot",
          operation: { id: operation, version: NUMBER_VERSION },
        },
        { kind: "requiresStateChange" },
      ],
      forbiddenCapabilities: [],
    },
  };
}

function workflowCase(): CaseDefinition {
  const id = "m1c/workflow/bounded-countdown-six";
  return {
    split: "heldout",
    value: {
      id,
      instruction:
        "Advance the supplied workflow state to its countdown fixed point for any declared state in the public domain.",
      catalogId: "benchmark.workflow",
      policy: DEFAULT_POLICY,
      taskInputs: [
        {
          name: "state",
          schema: { id: "workflow-state", version: WORKFLOW_VERSION },
          declaredBounds: [],
        },
      ],
      publicExamples: [],
      hiddenEvaluations: [
        {
          id: `${id}/hidden-1`,
          inputs: { state: { remaining: 6, value: -2 } },
          effects: [],
          expectedOutput: { remaining: 0, value: 4 },
        },
        {
          id: `${id}/hidden-2`,
          inputs: { state: { remaining: 0, value: 9 } },
          effects: [],
          expectedOutput: { remaining: 0, value: 9 },
        },
      ],
      expectedFeasibility: "plannable",
      infeasibilityWitness: null,
      requiredProperties: [
        { kind: "usesInput", inputKey: "state" },
        {
          kind: "usesOperation",
          id: "countdown-step",
          version: WORKFLOW_VERSION,
        },
      ],
      semanticObligations: [
        { kind: "rootDependsOnInput", inputKey: "state" },
        {
          kind: "requiresOperation",
          operation: { id: "countdown-step", version: WORKFLOW_VERSION },
        },
        { kind: "requiresStateChange" },
      ],
      forbiddenCapabilities: [],
    },
  };
}

function missingOperationCase(
  input: Readonly<{
    split: CaseDefinition["split"];
    id: string;
    instruction: string;
    catalogId: "benchmark.numbers" | "benchmark.text";
    operation: string;
  }>,
): CaseDefinition {
  return {
    split: input.split,
    value: {
      id: input.id,
      instruction: input.instruction,
      catalogId: input.catalogId,
      policy: DEFAULT_POLICY,
      taskInputs: collectionInput(
        input.catalogId === "benchmark.numbers" ? "numbers" : "texts",
      ),
      publicExamples: [],
      hiddenEvaluations: [],
      expectedFeasibility: "unplannable",
      infeasibilityWitness: {
        kind: "missingOperation",
        operation: { id: input.operation, version: NUMBER_VERSION },
      },
      requiredProperties: [],
      semanticObligations: [
        { kind: "rootDependsOnInput", inputKey: "items" },
        {
          kind: "requiresOperation",
          operation: { id: input.operation, version: NUMBER_VERSION },
        },
      ],
      forbiddenCapabilities: [],
    },
  };
}

function unavailableEffectCase(
  input: Readonly<{
    split: CaseDefinition["split"];
    id: string;
    kind: "deniedCapability" | "insufficientBudget";
  }>,
): CaseDefinition {
  const denied = input.kind === "deniedCapability";
  return {
    split: input.split,
    value: {
      id: input.id,
      instruction: denied
        ? "Request a tax quote for every number, although finance access is denied."
        : "Request a tax quote, although the trusted policy permits no effect calls.",
      catalogId: "benchmark.numbers",
      policy: {
        ...DEFAULT_POLICY,
        allowedCapabilities: denied ? [] : ["finance.read"],
        budget: {
          ...DEFAULT_POLICY.budget,
          maxEffectCalls: denied ? DEFAULT_POLICY.budget.maxEffectCalls : 0,
        },
      },
      taskInputs: collectionInput("numbers"),
      publicExamples: [],
      hiddenEvaluations: [],
      expectedFeasibility: "unplannable",
      infeasibilityWitness: denied
        ? {
            kind: "deniedCapability",
            operation: { id: "quote-tax", version: NUMBER_VERSION },
            capability: "finance.read",
          }
        : {
            kind: "insufficientBudget",
            operation: { id: "quote-tax", version: NUMBER_VERSION },
            resource: "maxEffectCalls",
            requiredMinimum: 1,
          },
      requiredProperties: [],
      semanticObligations: [
        { kind: "rootDependsOnInput", inputKey: "items" },
        {
          kind: "requiresOperation",
          operation: { id: "quote-tax", version: NUMBER_VERSION },
        },
        { kind: "requiresEffect", effectName: "tax.quote" },
      ],
      forbiddenCapabilities: denied ? ["finance.read"] : [],
    },
  };
}

const DEFINITIONS: ReadonlyArray<CaseDefinition> = Object.freeze([
  collectionCase({
    split: "development",
    id: "m1c/numbers/even-then-double",
    instruction: "Keep the even values and then double every retained value.",
    catalogId: "benchmark.numbers",
    inputs: [
      [1, 2, 4],
      [-2, 3, 6],
    ],
    outputs: [
      [4, 8],
      [-4, 12],
    ],
    operations: ["even", "double"],
  }),
  collectionCase({
    split: "development",
    id: "m1c/text/trim-then-exclaim",
    instruction: "Trim every message before appending one exclamation mark.",
    catalogId: "benchmark.text",
    inputs: [[" hi ", "ok"], [" go "]],
    outputs: [["hi!", "ok!"], ["go!"]],
    operations: ["trim", "exclaim"],
  }),
  decisionCase("development", "approve-label"),
  decisionCase("development", "reject-label"),
  collectionCase({
    split: "heldout",
    id: "m1c/numbers/increment-magnitude-total",
    instruction:
      "Increment every number, take each resulting magnitude, and return their total.",
    catalogId: "benchmark.numbers",
    inputs: [
      [-2, 3],
      [-5, -1],
    ],
    outputs: [5, 4],
    operations: ["increment", "absolute", "sum"],
  }),
  collectionCase({
    split: "heldout",
    id: "m1c/numbers/even-double-total",
    instruction: "Filter to even integers, double them, and add the results.",
    catalogId: "benchmark.numbers",
    inputs: [
      [1, 2, 4],
      [-2, 3, 6],
    ],
    outputs: [12, 8],
    operations: ["even", "double", "sum"],
  }),
  collectionCase({
    split: "heldout",
    id: "m1c/text/trim-uppercase-exclaim",
    instruction:
      "Normalize whitespace, uppercase each message, and then punctuate it once.",
    catalogId: "benchmark.text",
    inputs: [[" hi ", "Ok"], [" go "]],
    outputs: [["HI!", "OK!"], ["GO!"]],
    operations: ["trim", "uppercase", "exclaim"],
  }),
  collectionCase({
    split: "heldout",
    id: "m1c/text/trim-filter-concatenate",
    instruction:
      "Trim each text, remove the empty results, and concatenate the survivors.",
    catalogId: "benchmark.text",
    inputs: [
      [" ", " a ", "b"],
      [" x ", ""],
    ],
    outputs: ["ab", "x"],
    operations: ["trim", "nonempty", "concatenate"],
  }),
  collectionCase({
    split: "heldout",
    id: "m1c/numbers/magnitude-tax-quotes",
    instruction:
      "Convert every number to its magnitude before requesting its tax quote.",
    catalogId: "benchmark.numbers",
    inputs: [[-2, 3], [-4]],
    outputs: [[20, 30], [40]],
    operations: ["absolute", "quote-tax"],
    effectName: "tax.quote",
    allowedCapabilities: ["finance.read"],
    effects: [
      [
        {
          effectName: "tax.quote",
          input: 2,
          output: 20,
          replayResultId: "m1c/tax/2",
          usage: { tokens: 1, wallClockMs: 1 },
        },
        {
          effectName: "tax.quote",
          input: 3,
          output: 30,
          replayResultId: "m1c/tax/3",
          usage: { tokens: 1, wallClockMs: 1 },
        },
      ],
      [
        {
          effectName: "tax.quote",
          input: 4,
          output: 40,
          replayResultId: "m1c/tax/4",
          usage: { tokens: 1, wallClockMs: 1 },
        },
      ],
    ],
  }),
  collectionCase({
    split: "heldout",
    id: "m1c/text/trim-before-translation",
    instruction:
      "Trim each phrase before translating it through the declared effect.",
    catalogId: "benchmark.text",
    inputs: [[" hello ", "yes"], [" world "]],
    outputs: [["hola", "sí"], ["mundo"]],
    operations: ["trim", "translate"],
    effectName: "language.translate",
    allowedCapabilities: ["language.translate"],
    effects: [
      [
        {
          effectName: "language.translate",
          input: "hello",
          output: "hola",
          replayResultId: "m1c/translate/hello",
          usage: { tokens: 1, wallClockMs: 1 },
        },
        {
          effectName: "language.translate",
          input: "yes",
          output: "sí",
          replayResultId: "m1c/translate/yes",
          usage: { tokens: 1, wallClockMs: 1 },
        },
      ],
      [
        {
          effectName: "language.translate",
          input: "world",
          output: "mundo",
          replayResultId: "m1c/translate/world",
          usage: { tokens: 1, wallClockMs: 1 },
        },
      ],
    ],
  }),
  workflowCase(),
  missingOperationCase({
    split: "development",
    id: "m1c/numbers/missing-product",
    instruction:
      "Multiply every supplied number together, though no product reducer exists.",
    catalogId: "benchmark.numbers",
    operation: "product",
  }),
  missingOperationCase({
    split: "heldout",
    id: "m1c/text/missing-reverse",
    instruction:
      "Reverse every supplied string, though no reverse operation exists.",
    catalogId: "benchmark.text",
    operation: "reverse",
  }),
  unavailableEffectCase({
    split: "development",
    id: "m1c/numbers/denied-tax-quote-development",
    kind: "deniedCapability",
  }),
  unavailableEffectCase({
    split: "development",
    id: "m1c/numbers/zero-effect-budget-development",
    kind: "insufficientBudget",
  }),
  unavailableEffectCase({
    split: "heldout",
    id: "m1c/numbers/denied-tax-quote-heldout",
    kind: "deniedCapability",
  }),
  unavailableEffectCase({
    split: "heldout",
    id: "m1c/numbers/zero-effect-budget-heldout",
    kind: "insufficientBudget",
  }),
]);

export type M1cPreregisteredCorpus = Readonly<{
  development: ReadonlyArray<FrozenPlanGenerationCase>;
  heldOut: ReadonlyArray<FrozenPlanGenerationCase>;
}>;

export async function loadM1cPreregisteredCorpus(): Promise<
  Result<M1cPreregisteredCorpus, ReadonlyArray<Diagnostic>>
> {
  const development: Array<FrozenPlanGenerationCase> = [];
  const heldOut: Array<FrozenPlanGenerationCase> = [];
  const diagnostics: Array<Diagnostic> = [];
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

export function assertNoM1bHeldOutReuse(
  corpus: M1cPreregisteredCorpus,
  priorHeldOutIds: ReadonlyArray<string>,
): Result<void, Diagnostic> {
  const prior = new Set(priorHeldOutIds);
  const reused = [...corpus.development, ...corpus.heldOut].find((item) =>
    prior.has(item.case.id),
  );
  return reused === undefined
    ? { ok: true, value: undefined }
    : {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          `M1c corpus reuses inspected M1b held-out case ${reused.case.id}.`,
        ),
      };
}
