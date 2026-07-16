import {
  canonicalizeJson,
  canonicalizeSemanticObligations,
  type Catalog,
  type CompilationPolicy,
  compilePlanJson,
  createPlanLanguageManifest,
  type Diagnostic,
  diagnostic,
  digestValue,
  type ExecutablePlan,
  inspectExecutablePlan,
  type ModelPlanProposal,
  modelPlanProposalSchema,
  parseJson,
  type PlanLanguageManifest,
  type Result,
  type SemanticObligation,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type GenerationOutcome,
  generationOutcomeSchema,
  type GenerationStrategy,
  MAX_REPAIR_ATTEMPTS,
  type ModelAdapter,
  type ModelAdapterFailure,
  type ModelRequest,
  type ModelResponse,
  type ModelUsage,
  type PublicExample,
  type TaskInput,
} from "./model.js";
import type {
  AttemptRecord,
  GenerationFinalKind,
  GenerationRecord,
} from "./records.js";
import {
  compileStructuredOutputTransport,
  type StructuredOutputTransport,
} from "./transport.js";
import { validateUnplannableWitness } from "./witness.js";

export type AttemptPhase = "initial" | "repair";

export type GenerationSession =
  | Readonly<{
      kind: "compiled";
      executablePlan: ExecutablePlan;
      manifest: PlanLanguageManifest;
      record: GenerationRecord;
    }>
  | Readonly<{
      kind: "unplannable" | "rejected" | "providerRefusal" | "adapterFailure";
      manifest: PlanLanguageManifest;
      record: GenerationRecord;
    }>;

export type GeneratePlanInput = Readonly<{
  task: string;
  catalog: Catalog;
  policy: CompilationPolicy;
  taskInputs: ReadonlyArray<TaskInput>;
  semanticObligations?: ReadonlyArray<SemanticObligation> | undefined;
  publicExamples: ReadonlyArray<PublicExample>;
  adapter: ModelAdapter;
  strategy: GenerationStrategy;
  structuredOutputTransport?: StructuredOutputTransport | undefined;
  modelCallLimit?: number | undefined;
  sharedInitialProposal?: ModelPlanProposal | undefined;
}>;

export type ModelProposalCompilation = Readonly<{
  canonical: string | null;
  diagnostics: ReadonlyArray<Diagnostic>;
  wireValidation: boolean;
  executablePlan?: ExecutablePlan | undefined;
}>;

type ParsedModelOutput =
  | Readonly<{
      ok: true;
      outcome: GenerationOutcome;
    }>
  | Readonly<{
      ok: false;
      previousProposal: unknown;
      diagnostics: ReadonlyArray<Diagnostic>;
    }>;

const ZERO_USAGE: ModelUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  costUsdMicros: 0,
};

type CompleteModelUsage = Readonly<{
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsdMicros: number;
}>;

type RecordedAdapterFailure = Omit<ModelAdapterFailure, "usage"> &
  Readonly<{ usage?: CompleteModelUsage | undefined }>;

function completeUsage(usage: ModelUsage): CompleteModelUsage {
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens ?? 0,
    cacheWriteInputTokens: usage.cacheWriteInputTokens ?? 0,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens ?? 0,
    costUsdMicros: usage.costUsdMicros,
  };
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

function wireValidated(diagnostics: ReadonlyArray<Diagnostic>): boolean {
  return !diagnostics.some((item) =>
    [
      "MALFORMED_JSON",
      "INVALID_WIRE_SCHEMA",
      "UNSUPPORTED_PLAN_VERSION",
    ].includes(item.code),
  );
}

function structuredOutputCanonical(
  response: Readonly<{ structuredOutput?: unknown }>,
): string | null {
  const canonical = canonicalizeJson(response.structuredOutput);
  return canonical.ok ? canonical.value : null;
}

export async function compileModelPlanProposal(
  plan: unknown,
  catalog: Catalog,
  policy: CompilationPolicy,
  taskInputs: ReadonlyArray<TaskInput>,
  semanticObligations: ReadonlyArray<SemanticObligation>,
): Promise<ModelProposalCompilation> {
  const proposal = modelPlanProposalSchema.safeParse(plan);
  if (!proposal.success) {
    return {
      canonical: null,
      diagnostics: invalidOutcomeDiagnostics(proposal.error.issues),
      wireValidation: false,
    };
  }
  const inputs = new Map(taskInputs.map((input) => [input.name, input]));
  const diagnostics: Array<Diagnostic> = [];
  const nodes = proposal.data.nodes.map((node) => {
    if (node.op !== "input") return node;
    const taskInput = inputs.get(node.inputKey);
    if (taskInput === undefined) {
      diagnostics.push(
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          `Input ${node.inputKey} is not declared by the public task contract.`,
          { nodeId: node.id, path: ["nodes", node.id, "inputKey"] },
        ),
      );
      return node;
    }
    if (
      taskInput.schema.id !== node.schema.id ||
      taskInput.schema.version !== node.schema.version
    ) {
      diagnostics.push(
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          `Input ${node.inputKey} does not use its declared public schema.`,
          { nodeId: node.id, path: ["nodes", node.id, "schema"] },
        ),
      );
      return node;
    }
    const maximum = taskInput.declaredBounds.at(0);
    return maximum === undefined ? node : { ...node, maxItems: maximum.value };
  });
  if (diagnostics.length > 0)
    return { canonical: null, diagnostics, wireValidation: false };
  const canonical = canonicalizeJson(proposal.data);
  if (!canonical.ok) {
    return {
      canonical: null,
      diagnostics: [canonical.error],
      wireValidation: false,
    };
  }
  const trustedPlan = canonicalizeJson({
    ...proposal.data,
    nodes,
    budget: policy.budget,
    allowedCapabilities: policy.allowedCapabilities,
  });
  if (!trustedPlan.ok) {
    return {
      canonical: canonical.value,
      diagnostics: [trustedPlan.error],
      wireValidation: false,
    };
  }
  const compiled = await compilePlanJson(
    trustedPlan.value,
    catalog,
    policy,
    semanticObligations,
  );
  return compiled.ok
    ? {
        canonical: canonical.value,
        diagnostics: [],
        wireValidation: true,
        executablePlan: compiled.value,
      }
    : {
        canonical: canonical.value,
        diagnostics: compiled.error,
        wireValidation: wireValidated(compiled.error),
      };
}

function invalidOutcomeDiagnostics(
  issues: ReadonlyArray<
    Readonly<{ message: string; path: ReadonlyArray<PropertyKey> }>
  >,
): ReadonlyArray<Diagnostic> {
  return issues.map((issue) => {
    const path = issue.path.map((part) =>
      typeof part === "symbol" ? String(part) : part,
    );
    return diagnostic(
      "INVALID_WIRE_SCHEMA",
      `Invalid generation outcome: ${issue.message}`,
      { path },
      [],
      { repair: { path } },
    );
  });
}

function parseModelOutput(
  response: ModelResponse,
  request: ModelRequest,
): ParsedModelOutput {
  let candidate: unknown;
  if (
    request.kind === "initial" &&
    request.constraint === "unconstrained-json"
  ) {
    const parsed = parseJson(response.rawResponse);
    if (!parsed.ok) {
      return {
        ok: false,
        previousProposal: response.rawResponse,
        diagnostics: [parsed.error],
      };
    }
    candidate = parsed.value;
  } else {
    candidate = response.structuredOutput;
  }
  const authored = z
    .looseObject({
      kind: z.literal("plan"),
      plan: z.looseObject({
        budget: z.unknown().optional(),
        allowedCapabilities: z.unknown().optional(),
        nodes: z
          .array(
            z.looseObject({
              op: z.string().optional(),
              inputKey: z.string().optional(),
              maxItems: z.unknown().optional(),
            }),
          )
          .optional(),
      }),
    })
    .safeParse(candidate);
  if (authored.success) {
    const diagnostics: Array<Diagnostic> = [];
    if (Object.hasOwn(authored.data.plan, "budget"))
      diagnostics.push(
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Model proposals cannot author trusted policy budgets.",
          { path: ["plan", "budget"] },
        ),
      );
    if (Object.hasOwn(authored.data.plan, "allowedCapabilities"))
      diagnostics.push(
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          "Model proposals cannot authorize capabilities.",
          { path: ["plan", "allowedCapabilities"] },
        ),
      );
    for (const [index, node] of (authored.data.plan.nodes ?? []).entries()) {
      if (node.op !== "input" || !Object.hasOwn(node, "maxItems")) continue;
      const taskInput = request.taskInputs.find(
        (input) => input.name === node.inputKey,
      );
      const publicMaximum = taskInput?.declaredBounds.at(0)?.value;
      const proposedMaximum = z
        .number()
        .int()
        .nonnegative()
        .safeParse(node.maxItems);
      diagnostics.push(
        diagnostic(
          "INVALID_WIRE_SCHEMA",
          proposedMaximum.success &&
            publicMaximum !== undefined &&
            proposedMaximum.data < publicMaximum
            ? `Model input bound ${proposedMaximum.data} cannot narrow public task bound ${publicMaximum}.`
            : "Model proposals cannot author trusted public input bounds.",
          { path: ["plan", "nodes", index, "maxItems"] },
        ),
      );
    }
    if (diagnostics.length > 0)
      return { ok: false, previousProposal: candidate, diagnostics };
  }
  const outcome = generationOutcomeSchema.safeParse(candidate);
  return outcome.success
    ? { ok: true, outcome: outcome.data }
    : {
        ok: false,
        previousProposal: candidate ?? null,
        diagnostics: invalidOutcomeDiagnostics(outcome.error.issues),
      };
}

async function requestDigest(
  request: ModelRequest,
  previousAttemptDigest: string | null,
): Promise<Result<string, Diagnostic>> {
  const direct = await digestValue(request);
  if (direct.ok) return direct;
  return digestValue({
    kind: request.kind,
    originalTask: request.originalTask,
    manifestDigest: request.languageManifest.manifestDigest,
    previousAttemptDigest,
    diagnostics: request.kind === "repair" ? request.diagnostics : [],
    nonCanonicalRequest: true,
  });
}

async function withDigest(
  record: Omit<AttemptRecord, "digest">,
): Promise<Result<AttemptRecord, Diagnostic>> {
  const digest = await digestValue(record);
  if (!digest.ok) return digest;
  const complete: AttemptRecord = { ...record, digest: digest.value };
  deepFreeze(complete);
  return { ok: true, value: complete };
}

async function adapterFailureAttempt(
  attemptIndex: number,
  phase: AttemptPhase,
  digest: string,
  failure: ModelAdapterFailure,
): Promise<Result<AttemptRecord, Diagnostic>> {
  const { usage: failureUsage, ...failureWithoutUsage } = failure;
  const recordedFailure: RecordedAdapterFailure =
    failureUsage === undefined
      ? failureWithoutUsage
      : { ...failureWithoutUsage, usage: completeUsage(failureUsage) };
  return withDigest({
    attemptIndex,
    phase,
    requestDigest: digest,
    responseKind:
      failure.code === "PROVIDER_REFUSAL"
        ? "providerRefusal"
        : "adapterFailure",
    rawResponse: null,
    structuredOutputCanonical: null,
    proposalCanonical: null,
    abstentionReasons: [],
    diagnostics: [],
    adapterFailure: recordedFailure,
    dispatchEvidence: failure.dispatchEvidence,
    parseSuccess: null,
    wireValidation: null,
    compiled: false,
    usage: completeUsage(failure.usage ?? ZERO_USAGE),
    responseMetadata: failure.metadata ?? null,
    latencyMs: failure.latencyMs ?? 0,
  });
}

async function outcomeAttempt(
  attemptIndex: number,
  phase: AttemptPhase,
  digest: string,
  response: Readonly<{
    outcome: GenerationOutcome;
    rawResponse: string;
    structuredOutput?: unknown;
    usage: ModelUsage;
    latencyMs: number;
    metadata?: ModelResponse["metadata"];
  }>,
  compilation: ModelProposalCompilation | undefined,
): Promise<Result<AttemptRecord, Diagnostic>> {
  const unplannable = response.outcome.kind === "unplannable";
  return withDigest({
    attemptIndex,
    phase,
    requestDigest: digest,
    responseKind: response.outcome.kind,
    rawResponse: response.rawResponse,
    structuredOutputCanonical: structuredOutputCanonical(response),
    proposalCanonical: compilation?.canonical ?? null,
    abstentionReasons: [],
    abstentionWitness: unplannable ? response.outcome.witness : null,
    diagnostics: compilation?.diagnostics ?? [],
    adapterFailure: null,
    dispatchEvidence: "dispatched-with-usage",
    parseSuccess: true,
    wireValidation: compilation?.wireValidation ?? null,
    compiled: compilation?.executablePlan !== undefined,
    usage: completeUsage(response.usage),
    responseMetadata: response.metadata ?? null,
    latencyMs: response.latencyMs,
  });
}

async function invalidOutputAttempt(
  attemptIndex: number,
  phase: AttemptPhase,
  digest: string,
  response: ModelResponse,
  diagnostics: ReadonlyArray<Diagnostic>,
): Promise<Result<AttemptRecord, Diagnostic>> {
  return withDigest({
    attemptIndex,
    phase,
    requestDigest: digest,
    responseKind: "invalidOutput",
    rawResponse: response.rawResponse,
    structuredOutputCanonical: structuredOutputCanonical(response),
    proposalCanonical: null,
    abstentionReasons: [],
    abstentionWitness: null,
    diagnostics,
    adapterFailure: null,
    dispatchEvidence: "dispatched-with-usage",
    parseSuccess: false,
    wireValidation: null,
    compiled: false,
    usage: completeUsage(response.usage),
    responseMetadata: response.metadata ?? null,
    latencyMs: response.latencyMs,
  });
}

async function generationRecord(
  input: GeneratePlanInput,
  manifest: PlanLanguageManifest,
  attempts: ReadonlyArray<AttemptRecord>,
  finalKind: GenerationFinalKind,
  planHash: string | null,
  semanticContractHash: string | null,
): Promise<Result<GenerationRecord, Diagnostic>> {
  const totals = attempts.reduce(
    (current, attempt) => ({
      inputTokens: current.inputTokens + attempt.usage.inputTokens,
      cachedInputTokens:
        current.cachedInputTokens + attempt.usage.cachedInputTokens,
      cacheWriteInputTokens:
        current.cacheWriteInputTokens + attempt.usage.cacheWriteInputTokens,
      outputTokens: current.outputTokens + attempt.usage.outputTokens,
      reasoningTokens: current.reasoningTokens + attempt.usage.reasoningTokens,
      costUsdMicros: current.costUsdMicros + attempt.usage.costUsdMicros,
      latencyMs: current.latencyMs + attempt.latencyMs,
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsdMicros: 0,
      latencyMs: 0,
    },
  );
  const body = {
    task: input.task,
    model: input.adapter.identity,
    strategy: input.strategy,
    manifestDigest: manifest.manifestDigest,
    catalogFingerprint: manifest.catalogFingerprint,
    attempts,
    finalKind,
    planHash,
    semanticContractHash,
    semanticObligations: canonicalizeSemanticObligations(
      input.semanticObligations ?? [],
    ),
    repairCount: attempts.filter((attempt) => attempt.phase === "repair")
      .length,
    totalInputTokens: totals.inputTokens,
    totalCachedInputTokens: totals.cachedInputTokens,
    totalCacheWriteInputTokens: totals.cacheWriteInputTokens,
    totalOutputTokens: totals.outputTokens,
    totalReasoningTokens: totals.reasoningTokens,
    totalCostUsdMicros: totals.costUsdMicros,
    totalLatencyMs: totals.latencyMs,
  };
  const digest = await digestValue(body);
  if (!digest.ok) return digest;
  const complete: GenerationRecord = { ...body, digest: digest.value };
  deepFreeze(complete);
  return { ok: true, value: complete };
}

/** Generates, compiles, and performs at most two diagnostics-only repair turns. */
export async function generatePlan(
  input: GeneratePlanInput,
): Promise<Result<GenerationSession, Diagnostic>> {
  const maximumCalls = input.modelCallLimit ?? MAX_REPAIR_ATTEMPTS + 1;
  if (!Number.isSafeInteger(maximumCalls) || maximumCalls <= 0) {
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "Model-call limit must be a positive safe integer.",
      ),
    };
  }
  const manifest = await createPlanLanguageManifest(
    input.catalog,
    input.policy,
  );
  if (!manifest.ok) return manifest;
  const compiledTransport =
    input.strategy.constraint === "json-schema"
      ? await compileStructuredOutputTransport(manifest.value)
      : { ok: true as const, value: null };
  if (!compiledTransport.ok) return compiledTransport;
  if (
    input.structuredOutputTransport !== undefined &&
    (input.structuredOutputTransport.manifestDigest !==
      compiledTransport.value?.manifestDigest ||
      input.structuredOutputTransport.schemaDigest !==
        compiledTransport.value.schemaDigest)
  )
    return {
      ok: false,
      error: diagnostic(
        "INVALID_WIRE_SCHEMA",
        "The supplied structured-output transport does not match the language manifest.",
      ),
    };
  const transport = input.structuredOutputTransport ?? compiledTransport.value;
  if (
    transport !== null &&
    input.adapter.preflightStructuredOutput !== undefined
  ) {
    const preflight = await input.adapter.preflightStructuredOutput(transport);
    if (!preflight.ok)
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          `Structured-output preflight failed before dispatch: ${preflight.error.message}`,
        ),
      };
  }
  const attempts: Array<AttemptRecord> = [];
  let request: ModelRequest;
  if (input.sharedInitialProposal === undefined) {
    request = {
      kind: "initial",
      originalTask: input.task,
      taskInputs: input.taskInputs,
      languageManifest: manifest.value,
      semanticObligations: input.semanticObligations ?? [],
      publicExamples: input.publicExamples,
      constraint: input.strategy.constraint,
      structuredOutputTransport: transport,
    };
  } else {
    if (input.strategy.repair !== "compiler-guided" || transport === null)
      return {
        ok: false,
        error: diagnostic(
          "INVALID_WIRE_SCHEMA",
          "A shared repair proposal requires compiler-guided structured-output repair.",
        ),
      };
    const initialCompilation = await compileModelPlanProposal(
      input.sharedInitialProposal,
      input.catalog,
      input.policy,
      input.taskInputs,
      input.semanticObligations ?? [],
    );
    if (initialCompilation.executablePlan !== undefined) {
      const summary = inspectExecutablePlan(initialCompilation.executablePlan);
      if (summary === undefined)
        return {
          ok: false,
          error: diagnostic(
            "INVALID_EXECUTABLE_PLAN",
            "Shared initial proposal compiled but could not be inspected.",
          ),
        };
      const record = await generationRecord(
        input,
        manifest.value,
        attempts,
        "compiled",
        summary.planHash,
        summary.semanticContractHash,
      );
      return record.ok
        ? {
            ok: true,
            value: {
              kind: "compiled",
              executablePlan: initialCompilation.executablePlan,
              manifest: manifest.value,
              record: record.value,
            },
          }
        : record;
    }
    request = {
      kind: "repair",
      originalTask: input.task,
      taskInputs: input.taskInputs,
      languageManifest: manifest.value,
      semanticObligations: input.semanticObligations ?? [],
      previousProposal: input.sharedInitialProposal,
      diagnostics: initialCompilation.diagnostics,
      structuredOutputTransport: transport,
    };
  }
  const lastProtocolAttemptIndex =
    input.sharedInitialProposal === undefined
      ? MAX_REPAIR_ATTEMPTS
      : MAX_REPAIR_ATTEMPTS - 1;

  for (
    let attemptIndex = 0;
    attemptIndex < Math.min(lastProtocolAttemptIndex + 1, maximumCalls);
    attemptIndex += 1
  ) {
    const phase: AttemptPhase =
      input.sharedInitialProposal === undefined && attemptIndex === 0
        ? "initial"
        : "repair";
    const requestHash = await requestDigest(
      request,
      attempts.at(-1)?.digest ?? null,
    );
    if (!requestHash.ok) return requestHash;
    const response = await input.adapter.generate(request);
    if (!response.ok) {
      const finalKind =
        response.error.code === "PROVIDER_REFUSAL"
          ? "providerRefusal"
          : "adapterFailure";
      const attempt = await adapterFailureAttempt(
        attemptIndex,
        phase,
        requestHash.value,
        response.error,
      );
      if (!attempt.ok) return attempt;
      attempts.push(attempt.value);
      const record = await generationRecord(
        input,
        manifest.value,
        attempts,
        finalKind,
        null,
        null,
      );
      return record.ok
        ? {
            ok: true,
            value: {
              kind: finalKind,
              manifest: manifest.value,
              record: record.value,
            },
          }
        : record;
    }
    const parsedOutput = parseModelOutput(response.value, request);
    if (!parsedOutput.ok) {
      const attempt = await invalidOutputAttempt(
        attemptIndex,
        phase,
        requestHash.value,
        response.value,
        parsedOutput.diagnostics,
      );
      if (!attempt.ok) return attempt;
      attempts.push(attempt.value);
      if (
        input.strategy.repair === "none" ||
        attemptIndex === lastProtocolAttemptIndex
      ) {
        const record = await generationRecord(
          input,
          manifest.value,
          attempts,
          "rejected",
          null,
          null,
        );
        return record.ok
          ? {
              ok: true,
              value: {
                kind: "rejected",
                manifest: manifest.value,
                record: record.value,
              },
            }
          : record;
      }
      if (transport === null)
        return {
          ok: false,
          error: diagnostic(
            "INTERNAL_INVARIANT_VIOLATION",
            "A constrained repair request requires a structured-output transport.",
          ),
        };
      request = {
        kind: "repair",
        originalTask: input.task,
        taskInputs: input.taskInputs,
        languageManifest: manifest.value,
        semanticObligations: input.semanticObligations ?? [],
        previousProposal: parsedOutput.previousProposal,
        diagnostics: parsedOutput.diagnostics,
        structuredOutputTransport: transport,
      };
      continue;
    }
    if (parsedOutput.outcome.kind === "unplannable") {
      const witnessDiagnostics = validateUnplannableWitness(
        parsedOutput.outcome.witness,
        manifest.value,
        input.policy,
        input.semanticObligations ?? [],
      );
      const attempt = await outcomeAttempt(
        attemptIndex,
        phase,
        requestHash.value,
        { ...response.value, outcome: parsedOutput.outcome },
        witnessDiagnostics.length === 0
          ? undefined
          : {
              canonical: null,
              diagnostics: witnessDiagnostics,
              wireValidation: true,
            },
      );
      if (!attempt.ok) return attempt;
      attempts.push(attempt.value);
      if (witnessDiagnostics.length === 0) {
        const record = await generationRecord(
          input,
          manifest.value,
          attempts,
          "unplannable",
          null,
          null,
        );
        return record.ok
          ? {
              ok: true,
              value: {
                kind: "unplannable",
                manifest: manifest.value,
                record: record.value,
              },
            }
          : record;
      }
      if (
        input.strategy.repair === "none" ||
        attemptIndex === lastProtocolAttemptIndex
      ) {
        const record = await generationRecord(
          input,
          manifest.value,
          attempts,
          "rejected",
          null,
          null,
        );
        return record.ok
          ? {
              ok: true,
              value: {
                kind: "rejected",
                manifest: manifest.value,
                record: record.value,
              },
            }
          : record;
      }
      if (transport === null)
        return {
          ok: false,
          error: diagnostic(
            "INTERNAL_INVARIANT_VIOLATION",
            "A constrained repair request requires a structured-output transport.",
          ),
        };
      request = {
        kind: "repair",
        originalTask: input.task,
        taskInputs: input.taskInputs,
        languageManifest: manifest.value,
        semanticObligations: input.semanticObligations ?? [],
        previousProposal: parsedOutput.outcome,
        diagnostics: witnessDiagnostics,
        structuredOutputTransport: transport,
      };
      continue;
    }
    const compilation = await compileModelPlanProposal(
      parsedOutput.outcome.plan,
      input.catalog,
      input.policy,
      input.taskInputs,
      input.semanticObligations ?? [],
    );
    const attempt = await outcomeAttempt(
      attemptIndex,
      phase,
      requestHash.value,
      { ...response.value, outcome: parsedOutput.outcome },
      compilation,
    );
    if (!attempt.ok) return attempt;
    attempts.push(attempt.value);
    if (compilation.executablePlan !== undefined) {
      const summary = inspectExecutablePlan(compilation.executablePlan);
      if (summary === undefined) {
        return {
          ok: false,
          error: diagnostic(
            "INVALID_EXECUTABLE_PLAN",
            "Compiled artifact could not be inspected.",
          ),
        };
      }
      const record = await generationRecord(
        input,
        manifest.value,
        attempts,
        "compiled",
        summary.planHash,
        summary.semanticContractHash,
      );
      return record.ok
        ? {
            ok: true,
            value: {
              kind: "compiled",
              executablePlan: compilation.executablePlan,
              manifest: manifest.value,
              record: record.value,
            },
          }
        : record;
    }
    if (
      input.strategy.repair === "none" ||
      attemptIndex === lastProtocolAttemptIndex
    ) {
      const record = await generationRecord(
        input,
        manifest.value,
        attempts,
        "rejected",
        null,
        null,
      );
      return record.ok
        ? {
            ok: true,
            value: {
              kind: "rejected",
              manifest: manifest.value,
              record: record.value,
            },
          }
        : record;
    }
    if (transport === null)
      return {
        ok: false,
        error: diagnostic(
          "INTERNAL_INVARIANT_VIOLATION",
          "A constrained repair request requires a structured-output transport.",
        ),
      };
    request = {
      kind: "repair",
      originalTask: input.task,
      taskInputs: input.taskInputs,
      languageManifest: manifest.value,
      semanticObligations: input.semanticObligations ?? [],
      previousProposal: parsedOutput.outcome.plan,
      diagnostics: compilation.diagnostics,
      structuredOutputTransport: transport,
    };
  }
  return {
    ok: false,
    error: diagnostic(
      maximumCalls <= lastProtocolAttemptIndex
        ? "BUDGET_EXCEEDED"
        : "INTERNAL_INVARIANT_VIOLATION",
      maximumCalls <= lastProtocolAttemptIndex
        ? "Model-call cap prevented another repair attempt."
        : "Bounded generation loop exited unexpectedly.",
    ),
  };
}
