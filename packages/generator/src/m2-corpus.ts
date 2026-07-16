import {
  type Catalog,
  createCatalog,
  defineCollectionSchema,
  defineEffect,
  defineFunction,
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

const VERSION = "1.0.0";

export const M2_CORPUS_PROTOCOL = Object.freeze({
  id: "lachesis-m2-ir-vs-restricted-typescript-corpus",
  version: "1",
  priorHeldOutReuse: false,
  representations: Object.freeze([
    "functional-ir-with-typed-obligations",
    "restricted-typescript-codemode",
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

export function createM2CatalogResolver(): Result<
  CatalogResolver,
  Diagnostics
> {
  const numeric = numericCatalog();
  if (!numeric.ok) return numeric;
  const text = textCatalog();
  if (!text.ok) return text;
  const catalogs = new Map<string, Catalog>([
    ["m2.numbers", numeric.value],
    ["m2.text", text.value],
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

function unplannableCase(
  input: Readonly<{
    split: CaseDefinition["split"];
    id: string;
    instruction: string;
    catalogId: "m2.numbers" | "m2.text";
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
    value: {
      id: input.id,
      instruction: input.instruction,
      catalogId: input.catalogId,
      policy,
      taskInputs: collectionInput(
        input.catalogId === "m2.numbers" ? "m2-numbers" : "m2-texts",
      ),
      publicExamples: [],
      hiddenEvaluations: [],
      expectedFeasibility: "unplannable",
      infeasibilityWitness: { ...input.witness, operation },
      requiredProperties: [],
      semanticObligations: [
        { kind: "rootDependsOnInput", inputKey: "items" },
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
]);

export type M2PreregisteredCorpus = Readonly<{
  development: ReadonlyArray<FrozenPlanGenerationCase>;
  heldOut: ReadonlyArray<FrozenPlanGenerationCase>;
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
