import {
  type Catalog,
  type CompilationPolicy,
  createPlanLanguageManifest,
  type Diagnostic,
  diagnostic,
  digestValue,
  parseJson,
  type PlanLanguageManifest,
  type Result,
  type SemanticObligation,
  type SemanticObligationInput,
  semanticObligationSchema,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  CODEMODE_PROTOCOL,
  type CodeModeArtifact,
  compileCodeMode,
  validateCodeModeSourceSyntax,
} from "./codemode.js";
import type {
  GenerationConstraint,
  InferenceSettings,
  ModelAdapterFailure,
  ModelIdentity,
  ModelResponse,
  ModelUsage,
  TaskInput,
  UnplannableWitness,
} from "./model.js";
import { MAX_REPAIR_ATTEMPTS, unplannableWitnessSchema } from "./model.js";
import {
  adapterFailureSchema,
  diagnosticRecordSchema,
  modelIdentitySchema,
  modelUsageSchema,
} from "./records.js";
import {
  PORTABLE_TRANSPORT_COMPILER_VERSION,
  type StructuredOutputTransport,
  structuredOutputTransportSchema,
  validatePortableStructuredOutputSchema,
} from "./transport.js";
import { validateUnplannableWitness } from "./witness.js";

export const M2_CODEMODE_PROMPT_PROTOCOL = Object.freeze({
  id: "lachesis-m2-restricted-capability-typescript-generation",
  version: "2",
  representation: CODEMODE_PROTOCOL,
  outputContract: Object.freeze({
    program: '{ "kind": "program", "source": "..." }',
    unplannable:
      '{ "kind": "unplannable", "witness": { "kind": "missingOperation" | "deniedCapability" | "insufficientBudget", ... } }',
    rules: Object.freeze([
      "Return raw JSON only.",
      "Do not use Markdown fences or alternate field names.",
      "Source must use only the supplied restricted TypeScript grammar and registered ops capabilities.",
      "Do not use imports, globals, network, filesystem, environment access, dynamic code, loops, recursion, or unregistered operations.",
    ]),
  }),
  repairVisibility: Object.freeze([
    "original task",
    "public task-input declarations",
    "registered operation manifest",
    "public typed semantic obligations",
    "previous program",
    "restricted compiler diagnostics",
  ]),
  hiddenEvaluationResultsVisible: false,
});

export const codeModeOutcomeSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("program"),
      source: z.string().min(1).max(65_536),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("unplannable"),
      witness: unplannableWitnessSchema,
    })
    .readonly(),
]);

export type CodeModeOutcome = z.infer<typeof codeModeOutcomeSchema>;

export type CodeModeGenerationStrategy = Readonly<{
  constraint: GenerationConstraint;
  repair: "none" | "compiler-guided";
}>;

export type CodeModeInitialRequest = Readonly<{
  kind: "initial";
  protocol: typeof M2_CODEMODE_PROMPT_PROTOCOL;
  originalTask: string;
  taskInputs: ReadonlyArray<TaskInput>;
  languageManifest: PlanLanguageManifest;
  semanticObligations: ReadonlyArray<SemanticObligation>;
  constraint: GenerationConstraint;
  structuredOutputTransport: StructuredOutputTransport | null;
}>;

export type CodeModeRepairRequest = Readonly<{
  kind: "repair";
  protocol: typeof M2_CODEMODE_PROMPT_PROTOCOL;
  originalTask: string;
  taskInputs: ReadonlyArray<TaskInput>;
  languageManifest: PlanLanguageManifest;
  semanticObligations: ReadonlyArray<SemanticObligation>;
  previousProgram: string;
  diagnostics: ReadonlyArray<Diagnostic>;
  structuredOutputTransport: StructuredOutputTransport;
}>;

export type CodeModeModelRequest =
  CodeModeInitialRequest | CodeModeRepairRequest;

export type CodeModeModelAdapter = Readonly<{
  identity: ModelIdentity;
  inference: InferenceSettings;
  pricingEntryId: string;
  preflightStructuredOutput?:
    | ((
        transport: StructuredOutputTransport,
      ) => Promise<Result<void, ModelAdapterFailure>>)
    | undefined;
  generate: (
    request: CodeModeModelRequest,
  ) => Promise<Result<ModelResponse, ModelAdapterFailure>>;
}>;

export type CodeModeAttemptRecord = Readonly<{
  attemptIndex: number;
  phase: "initial" | "repair";
  requestDigest: string;
  responseKind:
    "program" | "unplannable" | "invalid-output" | "adapter-failure";
  programSource: string | null;
  sourceHash: string | null;
  parseTranspileSuccess: boolean | null;
  staticAnalysisSuccess: boolean | null;
  diagnostics: ReadonlyArray<Diagnostic>;
  usage: ModelUsage;
  latencyMs: number;
  dispatchEvidence:
    "not-dispatched" | "dispatched-with-usage" | "dispatched-usage-unknown";
  adapterFailure: ModelAdapterFailure | null;
  digest: string;
}>;

export type CodeModeGenerationRecord = Readonly<{
  task: string;
  model: ModelIdentity;
  strategy: CodeModeGenerationStrategy;
  manifestDigest: string;
  semanticObligations: ReadonlyArray<SemanticObligation>;
  attempts: ReadonlyArray<CodeModeAttemptRecord>;
  finalKind: "compiled" | "unplannable" | "rejected" | "adapter-failure";
  sourceHash: string | null;
  semanticContractHash: string | null;
  repairCount: number;
  totalUsage: ModelUsage;
  totalLatencyMs: number;
  digest: string;
}>;

const codeModeGenerationStrategySchema = z
  .strictObject({
    constraint: z.enum(["unconstrained-json", "json-schema"]),
    repair: z.enum(["none", "compiler-guided"]),
  })
  .readonly();

const codeModeAttemptRecordSchema = z
  .strictObject({
    attemptIndex: z.number().int().nonnegative(),
    phase: z.enum(["initial", "repair"]),
    requestDigest: z.string(),
    responseKind: z.enum([
      "program",
      "unplannable",
      "invalid-output",
      "adapter-failure",
    ]),
    programSource: z.string().nullable(),
    sourceHash: z.string().nullable(),
    parseTranspileSuccess: z.boolean().nullable(),
    staticAnalysisSuccess: z.boolean().nullable(),
    diagnostics: z.array(diagnosticRecordSchema).readonly(),
    usage: modelUsageSchema,
    latencyMs: z.number().int().nonnegative(),
    dispatchEvidence: z.enum([
      "not-dispatched",
      "dispatched-with-usage",
      "dispatched-usage-unknown",
    ]),
    adapterFailure: adapterFailureSchema
      .unwrap()
      .required({ dispatchEvidence: true })
      .readonly()
      .nullable(),
    digest: z.string(),
  })
  .readonly();

export const codeModeGenerationRecordSchema = z
  .strictObject({
    task: z.string(),
    model: modelIdentitySchema,
    strategy: codeModeGenerationStrategySchema,
    manifestDigest: z.string(),
    semanticObligations: z.array(semanticObligationSchema).readonly(),
    attempts: z.array(codeModeAttemptRecordSchema).readonly(),
    finalKind: z.enum([
      "compiled",
      "unplannable",
      "rejected",
      "adapter-failure",
    ]),
    sourceHash: z.string().nullable(),
    semanticContractHash: z.string().nullable(),
    repairCount: z.number().int().nonnegative(),
    totalUsage: modelUsageSchema,
    totalLatencyMs: z.number().int().nonnegative(),
    digest: z.string(),
  })
  .readonly() satisfies z.ZodType<CodeModeGenerationRecord>;

export type CodeModeGenerationSession =
  | Readonly<{
      kind: "compiled";
      artifact: CodeModeArtifact;
      record: CodeModeGenerationRecord;
    }>
  | Readonly<{
      kind: "unplannable" | "rejected" | "adapter-failure";
      record: CodeModeGenerationRecord;
    }>;

export type GenerateCodeModeInput = Readonly<{
  task: string;
  catalog: Catalog;
  policy: CompilationPolicy;
  taskInputs: ReadonlyArray<TaskInput>;
  semanticObligations: ReadonlyArray<SemanticObligationInput>;
  adapter: CodeModeModelAdapter;
  strategy: CodeModeGenerationStrategy;
  structuredOutputTransport?: StructuredOutputTransport | undefined;
}>;

type JsonValue = z.infer<ReturnType<typeof z.json>>;

function strictObject(
  properties: Readonly<Record<string, JsonValue>>,
): JsonValue {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function referenceSchema(
  references: ReadonlyArray<Readonly<{ id: string; version: string }>>,
): JsonValue {
  return {
    anyOf: references.map((reference) =>
      strictObject({
        id: { type: "string", const: reference.id },
        version: { type: "string", const: reference.version },
      }),
    ),
  };
}

function witnessSchema(
  manifest: PlanLanguageManifest,
  obligations: ReadonlyArray<SemanticObligation>,
): JsonValue {
  const references = new Map(
    manifest.operations.map((operation) => [
      `${operation.reference.id}@${operation.reference.version}`,
      Object.freeze({
        id: operation.reference.id,
        version: operation.reference.version,
      }),
    ]),
  );
  for (const obligation of obligations) {
    if (
      obligation.kind === "requiresOperation" ||
      obligation.kind === "operationDominatesRoot"
    )
      references.set(
        `${obligation.operation.id}@${obligation.operation.version}`,
        obligation.operation,
      );
  }
  const sortedReferences = [...references.values()].toSorted((left, right) =>
    `${left.id}@${left.version}`.localeCompare(`${right.id}@${right.version}`),
  );
  return {
    anyOf: [
      strictObject({
        kind: { type: "string", const: "missingOperation" },
        operation: referenceSchema(sortedReferences),
      }),
      strictObject({
        kind: { type: "string", const: "deniedCapability" },
        operation: referenceSchema(sortedReferences),
        capability: { type: "string", minLength: 1, maxLength: 128 },
      }),
      strictObject({
        kind: { type: "string", const: "insufficientBudget" },
        operation: referenceSchema(sortedReferences),
        resource: {
          type: "string",
          enum: [
            "maxEffectCalls",
            "maxRecursionDepth",
            "maxTokens",
            "maxWallClockMs",
          ],
        },
        requiredMinimum: { type: "integer", minimum: 1 },
      }),
    ],
  };
}

export async function compileCodeModeStructuredOutputTransport(
  manifest: PlanLanguageManifest,
  obligationInputs: ReadonlyArray<SemanticObligationInput> = [],
): Promise<Result<StructuredOutputTransport, Diagnostic>> {
  const parsedObligations = semanticObligationSchema
    .array()
    .safeParse(obligationInputs);
  if (!parsedObligations.success)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Cannot compile CodeMode transport from invalid semantic obligations.",
      ),
    };
  const jsonSchema: JsonValue = strictObject({
    outcome: {
      anyOf: [
        strictObject({
          kind: { type: "string", const: "program" },
          source: { type: "string", minLength: 1, maxLength: 65_536 },
        }),
        strictObject({
          kind: { type: "string", const: "unplannable" },
          witness: witnessSchema(manifest, parsedObligations.data),
        }),
      ],
    },
  });
  const portable = validatePortableStructuredOutputSchema(jsonSchema);
  if (!portable.ok) return portable;
  const digest = await digestValue({
    compiler: `${PORTABLE_TRANSPORT_COMPILER_VERSION};codemode/1`,
    manifestDigest: manifest.manifestDigest,
    jsonSchema,
  });
  if (!digest.ok) return digest;
  return {
    ok: true,
    value: structuredOutputTransportSchema.parse({
      formatVersion: "1",
      compilerVersion: PORTABLE_TRANSPORT_COMPILER_VERSION,
      manifestDigest: manifest.manifestDigest,
      schemaDigest: digest.value,
      jsonSchema,
    }),
  };
}

const zeroUsage = (): ModelUsage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  costUsdMicros: 0,
});

function completeUsage(usage: ModelUsage): ModelUsage {
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens ?? 0,
    cacheWriteInputTokens: usage.cacheWriteInputTokens ?? 0,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens ?? 0,
    costUsdMicros: usage.costUsdMicros,
  };
}

function addUsage(left: ModelUsage, right: ModelUsage): ModelUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens:
      (left.cachedInputTokens ?? 0) + (right.cachedInputTokens ?? 0),
    cacheWriteInputTokens:
      (left.cacheWriteInputTokens ?? 0) + (right.cacheWriteInputTokens ?? 0),
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: (left.reasoningTokens ?? 0) + (right.reasoningTokens ?? 0),
    costUsdMicros: left.costUsdMicros + right.costUsdMicros,
  };
}

function normalizedOutcome(
  response: ModelResponse,
  constraint: GenerationConstraint,
): Result<CodeModeOutcome, Diagnostic> {
  let candidate: unknown;
  if (constraint === "unconstrained-json") {
    const parsed = parseJson(response.rawResponse);
    if (!parsed.ok) return parsed;
    candidate = parsed.value;
  } else {
    const envelope = z
      .strictObject({ outcome: z.unknown() })
      .safeParse(response.structuredOutput);
    candidate = envelope.success
      ? envelope.data.outcome
      : response.structuredOutput;
  }
  const parsed = codeModeOutcomeSchema.safeParse(candidate);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          `Invalid CodeMode generation outcome: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
        ),
      };
}

async function attemptRecord(
  input: Omit<CodeModeAttemptRecord, "digest">,
): Promise<Result<CodeModeAttemptRecord, Diagnostic>> {
  const digest = await digestValue(input);
  return digest.ok
    ? { ok: true, value: Object.freeze({ ...input, digest: digest.value }) }
    : digest;
}

async function finishRecord(
  input: Omit<CodeModeGenerationRecord, "digest">,
): Promise<Result<CodeModeGenerationRecord, Diagnostic>> {
  const digest = await digestValue(input);
  return digest.ok
    ? { ok: true, value: Object.freeze({ ...input, digest: digest.value }) }
    : digest;
}

export async function generateCodeMode(
  input: GenerateCodeModeInput,
): Promise<Result<CodeModeGenerationSession, Diagnostic>> {
  const manifest = await createPlanLanguageManifest(
    input.catalog,
    input.policy,
  );
  if (!manifest.ok) return manifest;
  const parsedObligations = semanticObligationSchema
    .array()
    .safeParse(input.semanticObligations);
  if (!parsedObligations.success)
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "CodeMode semantic obligations are invalid.",
      ),
    };
  const obligations = parsedObligations.data;
  if (
    input.strategy.repair === "compiler-guided" &&
    input.strategy.constraint !== "json-schema"
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "CodeMode compiler-guided repair requires structured output.",
      ),
    };
  let transport: StructuredOutputTransport | null = null;
  if (input.strategy.constraint === "json-schema") {
    if (input.structuredOutputTransport !== undefined)
      transport = input.structuredOutputTransport;
    else {
      const compiledTransport = await compileCodeModeStructuredOutputTransport(
        manifest.value,
        obligations,
      );
      if (!compiledTransport.ok) return compiledTransport;
      transport = compiledTransport.value;
    }
  }
  if (transport !== null) {
    const preflight =
      await input.adapter.preflightStructuredOutput?.(transport);
    if (preflight !== undefined && !preflight.ok)
      return {
        ok: false,
        error: diagnostic("INVALID_WIRE_SCHEMA", preflight.error.message),
      };
  }
  const attempts: Array<CodeModeAttemptRecord> = [];
  let totalUsage = zeroUsage();
  let totalLatencyMs = 0;
  let previousProgram: string | undefined;
  let previousDiagnostics: ReadonlyArray<Diagnostic> = [];
  const maximumAttempts =
    input.strategy.repair === "compiler-guided" ? 1 + MAX_REPAIR_ATTEMPTS : 1;
  for (
    let attemptIndex = 0;
    attemptIndex < maximumAttempts;
    attemptIndex += 1
  ) {
    let request: CodeModeModelRequest;
    if (attemptIndex === 0) {
      request = {
        kind: "initial",
        protocol: M2_CODEMODE_PROMPT_PROTOCOL,
        originalTask: input.task,
        taskInputs: input.taskInputs,
        languageManifest: manifest.value,
        semanticObligations: obligations,
        constraint: input.strategy.constraint,
        structuredOutputTransport: transport ?? null,
      };
    } else {
      if (transport === null)
        return {
          ok: false,
          error: diagnostic(
            "INTERNAL_INVARIANT_VIOLATION",
            "CodeMode repair lost its structured transport.",
          ),
        };
      request = {
        kind: "repair",
        protocol: M2_CODEMODE_PROMPT_PROTOCOL,
        originalTask: input.task,
        taskInputs: input.taskInputs,
        languageManifest: manifest.value,
        semanticObligations: obligations,
        previousProgram: previousProgram ?? "",
        diagnostics: previousDiagnostics,
        structuredOutputTransport: transport,
      };
    }
    const requestDigest = await digestValue(request);
    if (!requestDigest.ok) return requestDigest;
    const generated = await input.adapter.generate(request);
    if (!generated.ok) {
      const usage = completeUsage(generated.error.usage ?? zeroUsage());
      totalUsage = addUsage(totalUsage, usage);
      totalLatencyMs += generated.error.latencyMs ?? 0;
      const recorded = await attemptRecord({
        attemptIndex,
        phase: attemptIndex === 0 ? "initial" : "repair",
        requestDigest: requestDigest.value,
        responseKind: "adapter-failure",
        programSource: null,
        sourceHash: null,
        parseTranspileSuccess: null,
        staticAnalysisSuccess: null,
        diagnostics: [],
        usage,
        latencyMs: generated.error.latencyMs ?? 0,
        dispatchEvidence: generated.error.dispatchEvidence,
        adapterFailure: generated.error,
      });
      if (!recorded.ok) return recorded;
      attempts.push(recorded.value);
      const record = await finishRecord({
        task: input.task,
        model: input.adapter.identity,
        strategy: input.strategy,
        manifestDigest: manifest.value.manifestDigest,
        semanticObligations: obligations,
        attempts,
        finalKind: "adapter-failure",
        sourceHash: null,
        semanticContractHash: null,
        repairCount: attemptIndex,
        totalUsage,
        totalLatencyMs,
      });
      return record.ok
        ? { ok: true, value: { kind: "adapter-failure", record: record.value } }
        : record;
    }
    const response = generated.value;
    totalUsage = addUsage(totalUsage, completeUsage(response.usage));
    totalLatencyMs += response.latencyMs;
    const outcome = normalizedOutcome(response, input.strategy.constraint);
    let diagnostics: ReadonlyArray<Diagnostic> = [];
    let artifact: CodeModeArtifact | undefined;
    let responseKind: CodeModeAttemptRecord["responseKind"] = "invalid-output";
    let source: string | null = null;
    let sourceHash: string | null = null;
    let parseTranspileSuccess: boolean | null = null;
    let staticAnalysisSuccess: boolean | null = null;
    let unplannable: UnplannableWitness | undefined;
    if (!outcome.ok) diagnostics = [outcome.error];
    else if (outcome.value.kind === "unplannable") {
      responseKind = "unplannable";
      unplannable = outcome.value.witness;
      diagnostics = validateUnplannableWitness(
        outcome.value.witness,
        manifest.value,
        input.policy,
        obligations,
      );
    } else {
      responseKind = "program";
      source = outcome.value.source;
      parseTranspileSuccess = validateCodeModeSourceSyntax(source).ok;
      const compiled = await compileCodeMode({
        source,
        catalog: input.catalog,
        policy: input.policy,
        taskInputs: input.taskInputs,
        semanticObligations: obligations,
      });
      if (compiled.ok) {
        staticAnalysisSuccess = true;
        artifact = compiled.value;
        const digest = await digestValue({
          protocol: CODEMODE_PROTOCOL,
          source,
        });
        if (!digest.ok) return digest;
        sourceHash = digest.value;
      } else {
        staticAnalysisSuccess = false;
        diagnostics = compiled.error;
      }
    }
    const recorded = await attemptRecord({
      attemptIndex,
      phase: attemptIndex === 0 ? "initial" : "repair",
      requestDigest: requestDigest.value,
      responseKind,
      programSource: source,
      sourceHash,
      parseTranspileSuccess,
      staticAnalysisSuccess,
      diagnostics,
      usage: completeUsage(response.usage),
      latencyMs: response.latencyMs,
      dispatchEvidence: response.dispatchEvidence,
      adapterFailure: null,
    });
    if (!recorded.ok) return recorded;
    attempts.push(recorded.value);
    if (artifact !== undefined) {
      const summary = await digestValue({
        sourceHash,
        manifestDigest: manifest.value.manifestDigest,
        policy: input.policy,
        obligations,
      });
      if (!summary.ok) return summary;
      const record = await finishRecord({
        task: input.task,
        model: input.adapter.identity,
        strategy: input.strategy,
        manifestDigest: manifest.value.manifestDigest,
        semanticObligations: obligations,
        attempts,
        finalKind: "compiled",
        sourceHash,
        semanticContractHash: summary.value,
        repairCount: attemptIndex,
        totalUsage,
        totalLatencyMs,
      });
      return record.ok
        ? {
            ok: true,
            value: { kind: "compiled", artifact, record: record.value },
          }
        : record;
    }
    if (unplannable !== undefined && diagnostics.length === 0) {
      const record = await finishRecord({
        task: input.task,
        model: input.adapter.identity,
        strategy: input.strategy,
        manifestDigest: manifest.value.manifestDigest,
        semanticObligations: obligations,
        attempts,
        finalKind: "unplannable",
        sourceHash: null,
        semanticContractHash: null,
        repairCount: attemptIndex,
        totalUsage,
        totalLatencyMs,
      });
      return record.ok
        ? { ok: true, value: { kind: "unplannable", record: record.value } }
        : record;
    }
    previousProgram = source ?? response.rawResponse;
    previousDiagnostics = diagnostics;
  }
  const record = await finishRecord({
    task: input.task,
    model: input.adapter.identity,
    strategy: input.strategy,
    manifestDigest: manifest.value.manifestDigest,
    semanticObligations: obligations,
    attempts,
    finalKind: "rejected",
    sourceHash: null,
    semanticContractHash: null,
    repairCount: Math.max(0, attempts.length - 1),
    totalUsage,
    totalLatencyMs,
  });
  return record.ok
    ? { ok: true, value: { kind: "rejected", record: record.value } }
    : record;
}
