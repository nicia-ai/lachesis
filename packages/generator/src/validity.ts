import {
  type Catalog,
  createPlanLanguageManifest,
  type Diagnostic,
  diagnostic,
  type Diagnostics,
  type ModelPlanProposal,
  modelPlanProposalSchema,
  type PlanLanguageManifest,
  type Result,
} from "@nicia-ai/lachesis";

import { type CatalogResolver, scoreGeneration } from "./benchmark.js";
import type { FrozenPlanGenerationCase } from "./case.js";
import { DEFAULT_INFERENCE_SETTINGS, type ModelAdapter } from "./model.js";
import { generatePlan } from "./pipeline.js";

export type BlindValidityCounts = Readonly<{
  totalCases: number;
  plannableCases: number;
  unplannableCases: number;
  referencesValid: number;
  witnessesCompiled: number;
  hiddenPropertiesPassed: number;
  invalidCases: number;
}>;

type CollectionStep = Readonly<{
  kind: "map-function" | "map-effect" | "filter" | "fold";
  operation: string;
}>;

function referenceKey(
  reference: Readonly<{ id: string; version: string }>,
): string {
  return `${reference.id}@${reference.version}`;
}

function fixtureDiagnostic(caseId: string, message: string): Diagnostic {
  return diagnostic("INVALID_WIRE_SCHEMA", `${caseId}: ${message}`);
}

async function languageManifest(
  frozenCase: FrozenPlanGenerationCase,
  catalog: Catalog,
): Promise<Result<PlanLanguageManifest, Diagnostics>> {
  const created = await createPlanLanguageManifest(
    catalog,
    frozenCase.case.policy,
  );
  return created.ok ? created : { ok: false, error: [created.error] };
}

function referenceDiagnostics(
  frozenCase: FrozenPlanGenerationCase,
  manifest: PlanLanguageManifest,
): Diagnostics {
  const schemas = new Set(
    manifest.schemas.map((schema) => referenceKey(schema.reference)),
  );
  const operations = new Set(
    manifest.operations.map((operation) => referenceKey(operation.reference)),
  );
  const effects = new Set(
    manifest.operations.flatMap((operation) =>
      operation.effect === undefined ? [] : [operation.effect.name],
    ),
  );
  const inputs = new Set(frozenCase.case.taskInputs.map((input) => input.name));
  const diagnostics: Array<Diagnostic> = [];
  for (const input of frozenCase.case.taskInputs) {
    if (!schemas.has(referenceKey(input.schema)))
      diagnostics.push(
        fixtureDiagnostic(
          frozenCase.case.id,
          `public input ${input.name} references unknown schema ${referenceKey(input.schema)}`,
        ),
      );
  }
  for (const property of frozenCase.case.requiredProperties) {
    switch (property.kind) {
      case "usesOperation":
        if (!operations.has(referenceKey(property)))
          diagnostics.push(
            fixtureDiagnostic(
              frozenCase.case.id,
              `required operation ${referenceKey(property)} is not registered`,
            ),
          );
        break;
      case "rootSchema":
        if (!schemas.has(referenceKey(property)))
          diagnostics.push(
            fixtureDiagnostic(
              frozenCase.case.id,
              `required root schema ${referenceKey(property)} is not registered`,
            ),
          );
        break;
      case "usesEffect":
        if (!effects.has(property.name))
          diagnostics.push(
            fixtureDiagnostic(
              frozenCase.case.id,
              `required effect ${property.name} is not registered`,
            ),
          );
        break;
      case "usesInput":
        if (!inputs.has(property.inputKey))
          diagnostics.push(
            fixtureDiagnostic(
              frozenCase.case.id,
              `required input ${property.inputKey} is not public`,
            ),
          );
        break;
      case "maximumNodes":
        break;
    }
  }
  return diagnostics;
}

function collectionPlan(
  manifest: PlanLanguageManifest,
  inputName: string,
  inputSchema: Readonly<{ id: string; version: string }>,
  steps: ReadonlyArray<CollectionStep>,
): unknown {
  const collection = manifest.schemas.find(
    (schema) => schema.kind.kind === "collection",
  )?.reference;
  const nodes: Array<unknown> = [
    { id: "input", op: "input", inputKey: inputName, schema: inputSchema },
  ];
  let source = "input";
  for (const [index, step] of steps.entries()) {
    const id = `step-${index + 1}`;
    const reference = {
      id: step.operation,
      version: manifest.catalog.version,
    };
    if (step.kind === "map-function" || step.kind === "map-effect") {
      nodes.push({
        id,
        op: "map",
        source,
        operation: {
          kind: step.kind === "map-effect" ? "effect" : "function",
          ...reference,
        },
        outputCollectionSchema: collection,
        parallelism: 1,
      });
    } else if (step.kind === "filter") {
      nodes.push({ id, op: "filter", source, predicate: reference });
    } else {
      nodes.push({ id, op: "fold", source, reducer: reference });
    }
    source = id;
  }
  return {
    formatVersion: "1",
    catalog: manifest.catalog,
    root: source,
    nodes,
  };
}

function decisionPlan(
  manifest: PlanLanguageManifest,
  operation: "approve-label" | "reject-label" | null,
): unknown {
  const version = manifest.catalog.version;
  const nodes: Array<unknown> = [
    {
      id: "condition",
      op: "input",
      inputKey: "condition",
      schema: { id: "boolean", version },
    },
    {
      id: "primary",
      op: "input",
      inputKey: "primary",
      schema: { id: "label", version },
    },
    {
      id: "fallback",
      op: "input",
      inputKey: "fallback",
      schema: { id: "label", version },
    },
    {
      id: "selected",
      op: "select",
      condition: "condition",
      whenTrue: "primary",
      whenFalse: "fallback",
    },
  ];
  if (operation !== null)
    nodes.push({
      id: "result",
      op: "invoke",
      source: "selected",
      function: { id: operation, version },
    });
  return {
    formatVersion: "1",
    catalog: manifest.catalog,
    root: operation === null ? "selected" : "result",
    nodes,
  };
}

function workflowPlan(
  frozenCase: FrozenPlanGenerationCase,
  manifest: PlanLanguageManifest,
): unknown {
  const version = manifest.catalog.version;
  return {
    formatVersion: "1",
    catalog: manifest.catalog,
    root: "fixed",
    nodes: [
      {
        id: "state",
        op: "input",
        inputKey: "state",
        schema: { id: "workflow-state", version },
      },
      {
        id: "fixed",
        op: "boundedFix",
        seed: "state",
        step: { id: "countdown-step", version },
        measure: { id: "remaining", version },
        maxIterations: frozenCase.case.policy.budget.maxRecursionDepth,
      },
    ],
  };
}

function referenceProposal(
  frozenCase: FrozenPlanGenerationCase,
  manifest: PlanLanguageManifest,
): Result<ModelPlanProposal, Diagnostic> {
  const [family, slug] = frozenCase.case.id.split("/");
  const input = frozenCase.case.taskInputs[0];
  let candidate: unknown;
  if (family === "numbers" && input !== undefined) {
    const plans: ReadonlyMap<string, ReadonlyArray<CollectionStep>> = new Map([
      ["double", [{ kind: "map-function", operation: "double" }]],
      ["increment", [{ kind: "map-function", operation: "increment" }]],
      ["absolute", [{ kind: "map-function", operation: "absolute" }]],
      ["positive", [{ kind: "filter", operation: "positive" }]],
      ["even", [{ kind: "filter", operation: "even" }]],
      ["sum", [{ kind: "fold", operation: "sum" }]],
      [
        "double-sum",
        [
          { kind: "map-function", operation: "double" },
          { kind: "fold", operation: "sum" },
        ],
      ],
      [
        "positive-sum",
        [
          { kind: "filter", operation: "positive" },
          { kind: "fold", operation: "sum" },
        ],
      ],
      [
        "absolute-sum",
        [
          { kind: "map-function", operation: "absolute" },
          { kind: "fold", operation: "sum" },
        ],
      ],
      [
        "increment-positive",
        [
          { kind: "filter", operation: "positive" },
          { kind: "map-function", operation: "increment" },
        ],
      ],
      ["tax-map", [{ kind: "map-effect", operation: "quote-tax" }]],
    ]);
    const steps = plans.get(slug ?? "");
    if (steps === undefined)
      return {
        ok: false,
        error: fixtureDiagnostic(
          frozenCase.case.id,
          "no numeric reference witness is registered",
        ),
      };
    candidate = collectionPlan(manifest, input.name, input.schema, steps);
  } else if (family === "text" && input !== undefined) {
    const plans: ReadonlyMap<string, ReadonlyArray<CollectionStep>> = new Map([
      ["uppercase", [{ kind: "map-function", operation: "uppercase" }]],
      ["trim", [{ kind: "map-function", operation: "trim" }]],
      ["exclaim", [{ kind: "map-function", operation: "exclaim" }]],
      ["nonempty", [{ kind: "filter", operation: "nonempty" }]],
      ["concatenate", [{ kind: "fold", operation: "concatenate" }]],
      [
        "trim-uppercase",
        [
          { kind: "map-function", operation: "trim" },
          { kind: "map-function", operation: "uppercase" },
        ],
      ],
      [
        "nonempty-concatenate",
        [
          { kind: "filter", operation: "nonempty" },
          { kind: "fold", operation: "concatenate" },
        ],
      ],
      [
        "uppercase-exclaim",
        [
          { kind: "map-function", operation: "uppercase" },
          { kind: "map-function", operation: "exclaim" },
        ],
      ],
      [
        "trim-nonempty",
        [
          { kind: "map-function", operation: "trim" },
          { kind: "filter", operation: "nonempty" },
        ],
      ],
      ["translation-map", [{ kind: "map-effect", operation: "translate" }]],
    ]);
    const steps = plans.get(slug ?? "");
    if (steps === undefined)
      return {
        ok: false,
        error: fixtureDiagnostic(
          frozenCase.case.id,
          "no text reference witness is registered",
        ),
      };
    candidate = collectionPlan(manifest, input.name, input.schema, steps);
  } else if (family === "decisions") {
    candidate = decisionPlan(
      manifest,
      slug?.includes("approve") === true
        ? "approve-label"
        : slug?.includes("reject") === true
          ? "reject-label"
          : null,
    );
  } else if (
    family === "workflow" ||
    frozenCase.case.id === "calibration/workflow-countdown"
  ) {
    candidate = workflowPlan(frozenCase, manifest);
  } else {
    return {
      ok: false,
      error: fixtureDiagnostic(
        frozenCase.case.id,
        "no offline reference witness is registered",
      ),
    };
  }
  const parsed = modelPlanProposalSchema.safeParse(candidate);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        error: fixtureDiagnostic(
          frozenCase.case.id,
          `reference witness is invalid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
        ),
      };
}

function witnessAdapter(plan: ModelPlanProposal): ModelAdapter {
  return {
    identity: {
      provider: "offline",
      model: "reference-witness",
      adapterVersion: "reference-witness/1",
    },
    inference: {
      ...DEFAULT_INFERENCE_SETTINGS,
      structuredOutputMode: "none",
      structuredOutputTransport: "prompt-json",
    },
    pricingEntryId: "offline/reference-witness",
    generate: () =>
      Promise.resolve({
        ok: true,
        value: {
          rawResponse: JSON.stringify({ kind: "plan", plan }),
          usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 },
          latencyMs: 0,
          dispatchEvidence: "dispatched-with-usage",
        },
      }),
  };
}

async function witnessPasses(
  frozenCase: FrozenPlanGenerationCase,
  catalog: Catalog,
  manifest: PlanLanguageManifest,
): Promise<boolean> {
  const proposal = referenceProposal(frozenCase, manifest);
  if (!proposal.ok) return false;
  const generated = await generatePlan({
    task: frozenCase.case.instruction,
    catalog,
    policy: frozenCase.case.policy,
    taskInputs: frozenCase.case.taskInputs,
    publicExamples: [],
    adapter: witnessAdapter(proposal.value),
    strategy: {
      id: "unconstrained-json",
      constraint: "unconstrained-json",
      repair: "none",
    },
  });
  if (!generated.ok || generated.value.kind !== "compiled") return false;
  const score = await scoreGeneration(frozenCase.case, generated.value);
  return (
    score.ok &&
    score.value.propertiesSatisfied === true &&
    score.value.semanticSuccess === true
  );
}

export async function validatePlanGenerationCases(
  cases: ReadonlyArray<FrozenPlanGenerationCase>,
  resolveCatalog: CatalogResolver,
): Promise<Result<void, Diagnostics>> {
  const diagnostics: Array<Diagnostic> = [];
  for (const frozenCase of cases) {
    const catalog = resolveCatalog(frozenCase.case.catalogId);
    if (!catalog.ok) {
      diagnostics.push(catalog.error);
      continue;
    }
    const manifest = await languageManifest(frozenCase, catalog.value);
    if (!manifest.ok) {
      diagnostics.push(...manifest.error);
      continue;
    }
    const references = referenceDiagnostics(frozenCase, manifest.value);
    diagnostics.push(...references);
    if (
      references.length === 0 &&
      frozenCase.case.expectedFeasibility === "plannable" &&
      !(await witnessPasses(frozenCase, catalog.value, manifest.value))
    )
      diagnostics.push(
        fixtureDiagnostic(
          frozenCase.case.id,
          "offline reference witness did not compile and pass hidden properties over trusted bounds",
        ),
      );
  }
  return diagnostics.length === 0
    ? { ok: true, value: undefined }
    : { ok: false, error: diagnostics };
}

/** Returns counts only so held-out validity can be audited without revealing content. */
export async function blindPlanGenerationValidityAudit(
  cases: ReadonlyArray<FrozenPlanGenerationCase>,
  resolveCatalog: CatalogResolver,
): Promise<BlindValidityCounts> {
  let referencesValid = 0;
  let witnessesCompiled = 0;
  let hiddenPropertiesPassed = 0;
  let invalidCases = 0;
  for (const frozenCase of cases) {
    const catalog = resolveCatalog(frozenCase.case.catalogId);
    if (!catalog.ok) {
      invalidCases += 1;
      continue;
    }
    const manifest = await languageManifest(frozenCase, catalog.value);
    if (
      !manifest.ok ||
      referenceDiagnostics(frozenCase, manifest.value).length > 0
    ) {
      invalidCases += 1;
      continue;
    }
    referencesValid += 1;
    if (frozenCase.case.expectedFeasibility === "unplannable") continue;
    if (await witnessPasses(frozenCase, catalog.value, manifest.value)) {
      witnessesCompiled += 1;
      hiddenPropertiesPassed += 1;
    } else invalidCases += 1;
  }
  return Object.freeze({
    totalCases: cases.length,
    plannableCases: cases.filter(
      (item) => item.case.expectedFeasibility === "plannable",
    ).length,
    unplannableCases: cases.filter(
      (item) => item.case.expectedFeasibility === "unplannable",
    ).length,
    referencesValid,
    witnessesCompiled,
    hiddenPropertiesPassed,
    invalidCases,
  });
}
