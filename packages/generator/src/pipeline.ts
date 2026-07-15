import {
  canonicalizeJson,
  type Catalog,
  type CompilationPolicy,
  compilePlanJson,
  createPlanLanguageManifest,
  type Diagnostic,
  diagnostic,
  digestValue,
  type ExecutablePlan,
  inspectExecutablePlan,
  parseJson,
  type PlanLanguageManifest,
  type Result,
} from "@nicia-ai/lachesis";

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
} from "./model.js";
import type {
  AttemptRecord,
  GenerationFinalKind,
  GenerationRecord,
} from "./records.js";

export type AttemptPhase = "initial" | "repair";

export type GenerationSession =
  | Readonly<{
      kind: "compiled";
      executablePlan: ExecutablePlan;
      manifest: PlanLanguageManifest;
      record: GenerationRecord;
    }>
  | Readonly<{
      kind: "unplannable" | "rejected" | "adapterFailure";
      manifest: PlanLanguageManifest;
      record: GenerationRecord;
    }>;

export type GeneratePlanInput = Readonly<{
  task: string;
  catalog: Catalog;
  policy: CompilationPolicy;
  publicExamples: ReadonlyArray<PublicExample>;
  adapter: ModelAdapter;
  strategy: GenerationStrategy;
  modelCallLimit?: number | undefined;
}>;

type CompiledProposal = Readonly<{
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
  outputTokens: 0,
  costUsdMicros: 0,
};

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

function structuredOutputCanonical(response: ModelResponse): string | null {
  const canonical = canonicalizeJson(response.structuredOutput);
  return canonical.ok ? canonical.value : null;
}

async function compileProposal(
  plan: unknown,
  catalog: Catalog,
  policy: CompilationPolicy,
): Promise<CompiledProposal> {
  const canonical = canonicalizeJson(plan);
  if (!canonical.ok) {
    return {
      canonical: null,
      diagnostics: [canonical.error],
      wireValidation: false,
    };
  }
  const compiled = await compilePlanJson(canonical.value, catalog, policy);
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
  constraint: GenerationStrategy["constraint"],
): ParsedModelOutput {
  let candidate: unknown;
  if (constraint === "unconstrained-json") {
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
  return withDigest({
    attemptIndex,
    phase,
    requestDigest: digest,
    responseKind: "adapterFailure",
    rawResponse: null,
    structuredOutputCanonical: null,
    proposalCanonical: null,
    abstentionReasons: [],
    diagnostics: [],
    adapterFailure: failure,
    parseSuccess: null,
    wireValidation: null,
    compiled: false,
    usage: ZERO_USAGE,
    latencyMs: 0,
  });
}

async function outcomeAttempt(
  attemptIndex: number,
  phase: AttemptPhase,
  digest: string,
  response: Readonly<{
    outcome: GenerationOutcome;
    rawResponse: string;
    usage: ModelUsage;
    latencyMs: number;
  }>,
  compilation: CompiledProposal | undefined,
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
    abstentionReasons: unplannable ? response.outcome.reasons : [],
    diagnostics: compilation?.diagnostics ?? [],
    adapterFailure: null,
    parseSuccess: true,
    wireValidation: compilation?.wireValidation ?? null,
    compiled: compilation?.executablePlan !== undefined,
    usage: response.usage,
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
    diagnostics,
    adapterFailure: null,
    parseSuccess: false,
    wireValidation: null,
    compiled: false,
    usage: response.usage,
    latencyMs: response.latencyMs,
  });
}

async function generationRecord(
  input: GeneratePlanInput,
  manifest: PlanLanguageManifest,
  attempts: ReadonlyArray<AttemptRecord>,
  finalKind: GenerationFinalKind,
  planHash: string | null,
): Promise<Result<GenerationRecord, Diagnostic>> {
  const totals = attempts.reduce(
    (current, attempt) => ({
      inputTokens: current.inputTokens + attempt.usage.inputTokens,
      outputTokens: current.outputTokens + attempt.usage.outputTokens,
      costUsdMicros: current.costUsdMicros + attempt.usage.costUsdMicros,
      latencyMs: current.latencyMs + attempt.latencyMs,
    }),
    { inputTokens: 0, outputTokens: 0, costUsdMicros: 0, latencyMs: 0 },
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
    repairCount: Math.max(0, attempts.length - 1),
    totalInputTokens: totals.inputTokens,
    totalOutputTokens: totals.outputTokens,
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
  const attempts: Array<AttemptRecord> = [];
  let request: ModelRequest = {
    kind: "initial",
    originalTask: input.task,
    languageManifest: manifest.value,
    publicExamples: input.publicExamples,
    constraint: input.strategy.constraint,
  };

  for (
    let attemptIndex = 0;
    attemptIndex < Math.min(MAX_REPAIR_ATTEMPTS + 1, maximumCalls);
    attemptIndex += 1
  ) {
    const phase: AttemptPhase = attemptIndex === 0 ? "initial" : "repair";
    const requestHash = await requestDigest(
      request,
      attempts.at(-1)?.digest ?? null,
    );
    if (!requestHash.ok) return requestHash;
    const response = await input.adapter.generate(request);
    if (!response.ok) {
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
        "adapterFailure",
        null,
      );
      return record.ok
        ? {
            ok: true,
            value: {
              kind: "adapterFailure",
              manifest: manifest.value,
              record: record.value,
            },
          }
        : record;
    }
    const parsedOutput = parseModelOutput(
      response.value,
      input.strategy.constraint,
    );
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
        attemptIndex === MAX_REPAIR_ATTEMPTS
      ) {
        const record = await generationRecord(
          input,
          manifest.value,
          attempts,
          "rejected",
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
      request = {
        kind: "repair",
        originalTask: input.task,
        languageManifest: manifest.value,
        previousProposal: parsedOutput.previousProposal,
        diagnostics: parsedOutput.diagnostics,
      };
      continue;
    }
    if (parsedOutput.outcome.kind === "unplannable") {
      const attempt = await outcomeAttempt(
        attemptIndex,
        phase,
        requestHash.value,
        { ...response.value, outcome: parsedOutput.outcome },
        undefined,
      );
      if (!attempt.ok) return attempt;
      attempts.push(attempt.value);
      const record = await generationRecord(
        input,
        manifest.value,
        attempts,
        "unplannable",
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
    const compilation = await compileProposal(
      parsedOutput.outcome.plan,
      input.catalog,
      input.policy,
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
      attemptIndex === MAX_REPAIR_ATTEMPTS
    ) {
      const record = await generationRecord(
        input,
        manifest.value,
        attempts,
        "rejected",
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
    request = {
      kind: "repair",
      originalTask: input.task,
      languageManifest: manifest.value,
      previousProposal: parsedOutput.outcome.plan,
      diagnostics: compilation.diagnostics,
    };
  }
  return {
    ok: false,
    error: diagnostic(
      maximumCalls <= MAX_REPAIR_ATTEMPTS
        ? "BUDGET_EXCEEDED"
        : "INTERNAL_INVARIANT_VIOLATION",
      maximumCalls <= MAX_REPAIR_ATTEMPTS
        ? "Model-call cap prevented another repair attempt."
        : "Bounded generation loop exited unexpectedly.",
    ),
  };
}
