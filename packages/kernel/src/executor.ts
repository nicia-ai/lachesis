import { z } from "zod";

import {
  canonicalizeJson,
  digestValue,
  hashCanonicalJson,
} from "./canonical.js";
import {
  type CatalogState,
  readCatalog,
  referenceKey,
  type RuntimeEffect,
  type RuntimeSchema,
} from "./catalog.js";
import { type Diagnostic, diagnostic } from "./diagnostic.js";
import { type ExecutablePlan, readExecutablePlan } from "./executable.js";
import {
  type CatalogFingerprint,
  catalogFingerprintSchema,
  type EffectRequestHash,
  effectRequestHashSchema,
  type PlanHash,
  planHashSchema,
  type ValueDigest,
  valueDigestSchema,
} from "./identity.js";
import type { CheckedNode, CheckedPlan } from "./plan.js";
import { err, ok, type Result } from "./result.js";
import {
  type NodeId,
  nodeIdSchema,
  type OperationReference,
  operationReferenceSchema,
  type PlanBudget,
} from "./wire.js";

export type RuntimeUsage = Readonly<{
  effectCalls: number;
  tokens: number;
  wallClockMs: number;
  recursionDepth: number;
  maximumParallelism: number;
}>;

export type EffectRequest = Readonly<{
  invocationId: string;
  invocationIndex: number;
  requestHash: EffectRequestHash;
  planHash: PlanHash;
  catalogFingerprint: CatalogFingerprint;
  nodeId: NodeId;
  operation: OperationReference;
  effectName: string;
  capability: string;
  input: unknown;
  inputDigest: ValueDigest;
}>;

export type EffectResult = Readonly<{
  value: unknown;
  replayResultId: string;
  usage: Readonly<{ tokens: number; wallClockMs: number }>;
}>;

export type EffectHandler = (
  request: EffectRequest,
) => Promise<Result<EffectResult, Diagnostic>>;

export type TraceEvent =
  | Readonly<{
      kind: "nodeStarted";
      nodeId: NodeId;
      timestamp: string;
    }>
  | Readonly<{
      kind: "nodeCompleted";
      nodeId: NodeId;
      timestamp: string;
      inputDigests: ReadonlyArray<string>;
      outputDigest: string;
      usage: RuntimeUsage;
    }>
  | Readonly<{
      kind: "nodeFailed";
      nodeId: NodeId;
      timestamp: string;
      diagnostic: Diagnostic;
      usage: RuntimeUsage;
    }>
  | Readonly<{
      kind: "effectInvoked";
      nodeId: NodeId;
      timestamp: string;
      invocationId: string;
      effectName: string;
      inputDigest: string;
      outputDigest: string;
      replayResultId: string;
    }>;

export type RunTrace = Readonly<{
  runId: string;
  planHash: string;
  catalog: Readonly<{ id: string; version: string }>;
  catalogFingerprint: CatalogFingerprint;
  events: ReadonlyArray<TraceEvent>;
  finalUsage: RuntimeUsage;
}>;

export type ExecutionResult = Readonly<{
  output: unknown;
  outputDigest: string;
  trace: RunTrace;
}>;

export type ExecutionFailure = Readonly<{
  diagnostics: ReadonlyArray<Diagnostic>;
  trace?: RunTrace | undefined;
}>;

export type ExecuteOptions = Readonly<{
  inputs: ReadonlyMap<string, unknown>;
  effectHandler: EffectHandler;
  clock: Readonly<{ now: () => string }>;
  runIdProvider: Readonly<{ next: () => string }>;
}>;

type MutableUsage = {
  effectCalls: number;
  tokens: number;
  wallClockMs: number;
  recursionDepth: number;
  maximumParallelism: number;
};

function snapshotUsage(usage: MutableUsage): RuntimeUsage {
  return { ...usage };
}

function budgetFailure(
  resource: string,
  actual: number,
  limit: number,
  nodeId: NodeId,
): Diagnostic {
  return diagnostic(
    "BUDGET_EXCEEDED",
    `Runtime ${resource} ${actual} exceeds budget ${limit}.`,
    { nodeId },
    [
      { key: "resource", value: resource },
      { key: "actual", value: actual },
      { key: "limit", value: limit },
    ],
  );
}

function checkUsage(
  budget: PlanBudget,
  usage: MutableUsage,
  nodeId: NodeId,
): Diagnostic | undefined {
  /* v8 ignore start -- compilation proves these totals; checks remain defense in depth */
  if (usage.effectCalls > budget.maxEffectCalls)
    return budgetFailure(
      "effect calls",
      usage.effectCalls,
      budget.maxEffectCalls,
      nodeId,
    );
  if (usage.tokens > budget.maxTokens)
    return budgetFailure("tokens", usage.tokens, budget.maxTokens, nodeId);
  if (usage.wallClockMs > budget.maxWallClockMs)
    return budgetFailure(
      "wall-clock milliseconds",
      usage.wallClockMs,
      budget.maxWallClockMs,
      nodeId,
    );
  if (usage.recursionDepth > budget.maxRecursionDepth)
    return budgetFailure(
      "recursion depth",
      usage.recursionDepth,
      budget.maxRecursionDepth,
      nodeId,
    );
  if (usage.maximumParallelism > budget.maxParallelism)
    return budgetFailure(
      "parallelism",
      usage.maximumParallelism,
      budget.maxParallelism,
      nodeId,
    );
  return undefined;
  /* v8 ignore stop */
}

function ensureArray(
  value: unknown,
  nodeId: NodeId,
): Result<ReadonlyArray<unknown>, Diagnostic> {
  /* v8 ignore next -- checker only routes collection schemas to collection operators */
  return Array.isArray(value)
    ? ok(value)
    : err(
        diagnostic(
          "RUNTIME_SCHEMA_VIOLATION",
          "Collection operator received a non-array value.",
          { nodeId },
        ),
      );
}

function outputSchemaForEffect(
  catalog: CatalogState,
  effect: RuntimeEffect,
): Result<RuntimeSchema, Diagnostic> {
  const schema = catalog.schemas.get(referenceKey(effect.output));
  /* v8 ignore next -- immutable catalog registration rejects dangling outputs */
  return schema === undefined
    ? err(
        diagnostic(
          "INTERNAL_INVARIANT_VIOLATION",
          `Effect output schema ${referenceKey(effect.output)} disappeared.`,
        ),
      )
    : ok(schema);
}

/** Executes only an opaque artifact emitted by compilePlanJson. */
export async function executePlan(
  executablePlan: ExecutablePlan,
  options: ExecuteOptions,
): Promise<Result<ExecutionResult, ExecutionFailure>> {
  const artifacts = readExecutablePlan(executablePlan);
  if (artifacts === undefined) {
    return err({
      diagnostics: [
        diagnostic(
          "INVALID_EXECUTABLE_PLAN",
          "Execution requires an artifact returned by compilePlanJson.",
        ),
      ],
    });
  }
  const compiledArtifacts = artifacts;
  const plan: CheckedPlan = compiledArtifacts.checked;
  const catalog = readCatalog(compiledArtifacts.catalog);
  const planHash = compiledArtifacts.planHash;
  const runId = options.runIdProvider.next();
  const events: Array<TraceEvent> = [];
  const pendingEffectEvents = new Map<
    string,
    Extract<TraceEvent, Readonly<{ kind: "effectInvoked" }>>
  >();
  const usage: MutableUsage = {
    effectCalls: 0,
    tokens: 0,
    wallClockMs: 0,
    recursionDepth: 0,
    maximumParallelism: 1,
  };
  const memo = new Map<NodeId, Promise<Result<unknown, Diagnostic>>>();

  async function runEffect(
    nodeId: NodeId,
    effect: RuntimeEffect,
    input: unknown,
    index: number,
  ): Promise<Result<unknown, Diagnostic>> {
    const invocationId = `${nodeId}:${index}`;
    const invokedAt = options.clock.now();
    if (
      !compiledArtifacts.policy.allowedCapabilities.includes(
        effect.capability,
      ) ||
      !compiledArtifacts.analysis.capabilitiesRequired.has(effect.capability)
    ) {
      return err(
        diagnostic(
          "DENIED_CAPABILITY",
          `Capability ${effect.capability} is not authorized by the compiled plan.`,
          { nodeId },
          [{ key: "capability", value: effect.capability }],
          {
            expected: { value: "capability bound into executable plan" },
            actual: { value: effect.capability },
            repair: { nodeId },
          },
        ),
      );
    }
    usage.effectCalls += 1;
    const beforeFailure = checkUsage(
      compiledArtifacts.policy.budget,
      usage,
      nodeId,
    );
    /* v8 ignore next -- analysis proves the maximum effect-call count */
    if (beforeFailure !== undefined) return err(beforeFailure);
    const inputDigest = await digestValue(input);
    /* v8 ignore next -- checked schema values are guaranteed to be JSON */
    if (!inputDigest.ok) return inputDigest;
    const requestIdentity = {
      planHash,
      catalogFingerprint: compiledArtifacts.catalogFingerprint,
      operation: { id: effect.id, version: effect.version },
      nodeId,
      invocationIndex: index,
      effectName: effect.effectName,
      inputDigest: valueDigestSchema.parse(inputDigest.value),
    };
    const requestCanonical = canonicalizeJson(requestIdentity);
    /* v8 ignore next -- request identity consists only of validated JSON scalars */
    if (!requestCanonical.ok) return requestCanonical;
    const requestHash = effectRequestHashSchema.parse(
      await hashCanonicalJson(requestCanonical.value),
    );
    const handled = await options.effectHandler({
      invocationId,
      invocationIndex: index,
      requestHash,
      planHash,
      catalogFingerprint: compiledArtifacts.catalogFingerprint,
      nodeId,
      operation: operationReferenceSchema.parse({
        id: effect.id,
        version: effect.version,
      }),
      effectName: effect.effectName,
      capability: effect.capability,
      input,
      inputDigest: requestIdentity.inputDigest,
    });
    if (!handled.ok) return handled;
    if (
      !Number.isSafeInteger(handled.value.usage.tokens) ||
      handled.value.usage.tokens < 0 ||
      !Number.isSafeInteger(handled.value.usage.wallClockMs) ||
      handled.value.usage.wallClockMs < 0
    ) {
      return err(
        diagnostic(
          "RUNTIME_SCHEMA_VIOLATION",
          "Effect usage must contain nonnegative safe integers.",
          {
            nodeId,
          },
        ),
      );
    }
    if (handled.value.usage.tokens > effect.maxTokens) {
      return err(
        budgetFailure(
          "effect tokens",
          handled.value.usage.tokens,
          effect.maxTokens,
          nodeId,
        ),
      );
    }
    if (handled.value.usage.wallClockMs > effect.maxWallClockMs) {
      return err(
        budgetFailure(
          "effect wall-clock milliseconds",
          handled.value.usage.wallClockMs,
          effect.maxWallClockMs,
          nodeId,
        ),
      );
    }
    usage.tokens += handled.value.usage.tokens;
    usage.wallClockMs += handled.value.usage.wallClockMs;
    const afterFailure = checkUsage(
      compiledArtifacts.policy.budget,
      usage,
      nodeId,
    );
    /* v8 ignore next -- analysis and per-effect checks prove aggregate usage */
    if (afterFailure !== undefined) return err(afterFailure);
    const schema = outputSchemaForEffect(catalog, effect);
    /* v8 ignore next -- output schema is bound into the immutable catalog snapshot */
    if (!schema.ok) return schema;
    const validated = schema.value.parse(handled.value.value);
    if (!validated.ok) return validated;
    const outputDigest = await digestValue(validated.value);
    /* v8 ignore next -- validated effect outputs are guaranteed to be JSON */
    if (!outputDigest.ok) return outputDigest;
    pendingEffectEvents.set(invocationId, {
      kind: "effectInvoked",
      nodeId,
      timestamp: invokedAt,
      invocationId,
      effectName: effect.effectName,
      inputDigest: inputDigest.value,
      outputDigest: outputDigest.value,
      replayResultId: handled.value.replayResultId,
    });
    return ok(validated.value);
  }

  function flushEffectEvent(invocationId: string): void {
    const event = pendingEffectEvents.get(invocationId);
    if (event !== undefined) {
      events.push(event);
      pendingEffectEvents.delete(invocationId);
    }
  }

  async function evaluateNode(
    checkedNode: CheckedNode,
  ): Promise<Result<unknown, Diagnostic>> {
    const node = checkedNode.node;
    events.push({
      kind: "nodeStarted",
      nodeId: node.id,
      timestamp: options.clock.now(),
    });
    const inputDigests: Array<string> = [];
    async function dependency(
      nodeId: NodeId,
    ): Promise<Result<unknown, Diagnostic>> {
      const value = await evaluate(nodeId);
      if (value.ok) {
        const digest = await digestValue(value.value);
        /* v8 ignore next -- successful checked nodes only produce JSON */
        if (digest.ok) inputDigests.push(digest.value);
      }
      return value;
    }

    let result: Result<unknown, Diagnostic>;
    switch (node.op) {
      case "input": {
        const input = options.inputs.get(node.inputKey);
        if (input === undefined && !options.inputs.has(node.inputKey)) {
          result = err(
            diagnostic(
              "RUNTIME_SCHEMA_VIOLATION",
              `Missing runtime input ${node.inputKey}.`,
              { nodeId: node.id },
            ),
          );
          break;
        }
        const parsed = checkedNode.outputSchema.parse(input);
        if (!parsed.ok) {
          result = parsed;
          break;
        }
        if (Array.isArray(parsed.value)) {
          const maximum =
            node.maxItems ??
            (checkedNode.outputSchema.kind.kind === "collection"
              ? checkedNode.outputSchema.kind.defaultMaxItems
              : undefined);
          if (
            parsed.value.length >
            compiledArtifacts.policy.budget.maxCollectionItems
          ) {
            result = err(
              budgetFailure(
                "collection items",
                parsed.value.length,
                compiledArtifacts.policy.budget.maxCollectionItems,
                node.id,
              ),
            );
            break;
          }
          if (maximum !== undefined && parsed.value.length > maximum) {
            result = err(
              budgetFailure(
                "input cardinality",
                parsed.value.length,
                maximum,
                node.id,
              ),
            );
            break;
          }
        }
        result = ok(parsed.value);
        break;
      }
      case "constant": {
        result = checkedNode.outputSchema.parse(node.value);
        break;
      }
      case "invoke": {
        const source = await dependency(node.source);
        result =
          source.ok && checkedNode.operation?.kind === "function"
            ? checkedNode.operation.invoke(source.value)
            : source;
        break;
      }
      case "map": {
        const source = await dependency(node.source);
        if (!source.ok) {
          result = source;
          break;
        }
        const array = ensureArray(source.value, node.id);
        /* v8 ignore start -- checker and runtime schema guarantee a collection here */
        if (!array.ok) {
          result = array;
          break;
        }
        /* v8 ignore stop */
        if (checkedNode.operation?.kind === "function") {
          const output: Array<unknown> = [];
          let failure: Diagnostic | undefined;
          for (const item of array.value) {
            const mapped = checkedNode.operation.invoke(item);
            if (!mapped.ok) {
              failure = mapped.error;
              break;
            }
            output.push(mapped.value);
          }
          result =
            failure === undefined
              ? checkedNode.outputSchema.parse(output)
              : err(failure);
        } else if (checkedNode.operation?.kind === "effect") {
          const effect = checkedNode.operation;
          usage.maximumParallelism = Math.max(
            usage.maximumParallelism,
            Math.min(node.parallelism, array.value.length),
          );
          const usageFailure = checkUsage(
            compiledArtifacts.policy.budget,
            usage,
            node.id,
          );
          /* v8 ignore next -- analysis proves map parallelism and effect totals */
          if (usageFailure !== undefined) {
            result = err(usageFailure);
            break;
          }
          const output: Array<unknown> = [];
          let failure: Diagnostic | undefined;
          for (
            let start = 0;
            start < array.value.length;
            start += node.parallelism
          ) {
            const batch = array.value.slice(start, start + node.parallelism);
            const handled = await Promise.all(
              batch.map((item, offset) =>
                runEffect(node.id, effect, item, start + offset),
              ),
            );
            for (let offset = 0; offset < batch.length; offset += 1) {
              flushEffectEvent(`${node.id}:${start + offset}`);
            }
            for (const item of handled) {
              if (item.ok) output.push(item.value);
              else {
                failure = item.error;
                break;
              }
            }
            if (failure !== undefined) break;
          }
          result =
            failure === undefined
              ? checkedNode.outputSchema.parse(output)
              : err(failure);
        } /* v8 ignore next -- checker always binds a map operation */ else {
          result = err(
            diagnostic(
              "INTERNAL_INVARIANT_VIOLATION",
              "Map operation is missing.",
              { nodeId: node.id },
            ),
          );
        }
        break;
      }
      case "filter": {
        const source = await dependency(node.source);
        if (!source.ok) {
          result = source;
          break;
        }
        const array = ensureArray(source.value, node.id);
        /* v8 ignore start -- checker binds collection input and predicate */
        if (!array.ok || checkedNode.operation?.kind !== "predicate") {
          result = array.ok
            ? err(
                diagnostic(
                  "INTERNAL_INVARIANT_VIOLATION",
                  "Filter predicate is missing.",
                  { nodeId: node.id },
                ),
              )
            : array;
          break;
        }
        /* v8 ignore stop */
        const output: Array<unknown> = [];
        let failure: Diagnostic | undefined;
        for (const item of array.value) {
          const included = checkedNode.operation.test(item);
          if (!included.ok) {
            failure = included.error;
            break;
          }
          if (included.value) output.push(item);
        }
        result =
          failure === undefined
            ? checkedNode.outputSchema.parse(output)
            : err(failure);
        break;
      }
      case "fold": {
        const source = await dependency(node.source);
        if (!source.ok) {
          result = source;
          break;
        }
        const array = ensureArray(source.value, node.id);
        /* v8 ignore start -- checker binds collection input and reducer */
        if (!array.ok || checkedNode.operation?.kind !== "reducer") {
          result = array.ok
            ? err(
                diagnostic(
                  "INTERNAL_INVARIANT_VIOLATION",
                  "Fold reducer is missing.",
                  { nodeId: node.id },
                ),
              )
            : array;
          break;
        }
        /* v8 ignore stop */
        let accumulator: unknown = checkedNode.operation.identity;
        let failure: Diagnostic | undefined;
        for (const item of array.value) {
          const reduced = checkedNode.operation.reduce(accumulator, item);
          if (!reduced.ok) {
            failure = reduced.error;
            break;
          }
          accumulator = reduced.value;
        }
        result =
          failure === undefined
            ? checkedNode.outputSchema.parse(accumulator)
            : err(failure);
        break;
      }
      case "select": {
        const condition = await dependency(node.condition);
        if (!condition.ok) {
          result = condition;
          break;
        }
        /* v8 ignore next -- checker requires a boolean schema for select */
        if (typeof condition.value !== "boolean") {
          result = err(
            diagnostic(
              "RUNTIME_SCHEMA_VIOLATION",
              "Select condition is not boolean.",
              { nodeId: node.id },
            ),
          );
          break;
        }
        result = await dependency(
          condition.value ? node.whenTrue : node.whenFalse,
        );
        break;
      }
      case "effect": {
        const source = await dependency(node.source);
        result =
          source.ok && checkedNode.operation?.kind === "effect"
            ? await runEffect(node.id, checkedNode.operation, source.value, 0)
            : source;
        flushEffectEvent(`${node.id}:0`);
        break;
      }
      case "checkpoint": {
        result = await dependency(node.source);
        break;
      }
      case "boundedFix": {
        const seed = await dependency(node.seed);
        const measureOperation = catalog.operations.get(
          referenceKey(node.measure),
        );
        /* v8 ignore next -- checker binds step and measure operations */
        if (
          !seed.ok ||
          checkedNode.operation?.kind !== "fixedPointStep" ||
          measureOperation?.kind !== "measure"
        ) {
          result = seed.ok
            ? err(
                diagnostic(
                  "INTERNAL_INVARIANT_VIOLATION",
                  "Bounded fix registration is missing.",
                  { nodeId: node.id },
                ),
              )
            : seed;
          break;
        }
        let state = seed.value;
        let measured = measureOperation.measure(state);
        let failure: Diagnostic | undefined;
        if (!measured.ok) failure = measured.error;
        for (
          let iteration = 0;
          failure === undefined && measured.ok && measured.value > 0;
          iteration += 1
        ) {
          if (iteration >= node.maxIterations) {
            failure = diagnostic(
              "UNBOUNDED_RECURSION",
              `Bounded fix exceeded ${node.maxIterations} iterations.`,
              {
                nodeId: node.id,
              },
            );
            break;
          }
          usage.recursionDepth = Math.max(usage.recursionDepth, iteration + 1);
          const usageFailure = checkUsage(
            compiledArtifacts.policy.budget,
            usage,
            node.id,
          );
          if (usageFailure !== undefined) {
            failure = usageFailure;
            break;
          }
          const stepped = checkedNode.operation.invoke(state);
          if (!stepped.ok) {
            failure = stepped.error;
            break;
          }
          const nextMeasure = measureOperation.measure(stepped.value);
          if (!nextMeasure.ok) {
            failure = nextMeasure.error;
            break;
          }
          if (nextMeasure.value >= measured.value) {
            failure = diagnostic(
              "NON_DECREASING_RECURSION_MEASURE",
              `Measure did not decrease: ${measured.value} -> ${nextMeasure.value}.`,
              { nodeId: node.id },
            );
            break;
          }
          state = stepped.value;
          measured = nextMeasure;
        }
        result =
          failure === undefined
            ? checkedNode.outputSchema.parse(state)
            : err(failure);
        break;
      }
    }
    if (!result.ok) {
      events.push({
        kind: "nodeFailed",
        nodeId: node.id,
        timestamp: options.clock.now(),
        diagnostic: result.error,
        usage: snapshotUsage(usage),
      });
      return result;
    }
    const outputDigest = await digestValue(result.value);
    /* v8 ignore next -- successful checked nodes only produce JSON */
    if (!outputDigest.ok) return outputDigest;
    events.push({
      kind: "nodeCompleted",
      nodeId: node.id,
      timestamp: options.clock.now(),
      inputDigests,
      outputDigest: outputDigest.value,
      usage: snapshotUsage(usage),
    });
    return result;
  }

  function evaluate(nodeId: NodeId): Promise<Result<unknown, Diagnostic>> {
    const existing = memo.get(nodeId);
    if (existing !== undefined) return existing;
    const checkedNode = plan.nodes.get(nodeId);
    /* v8 ignore next -- executable artifacts snapshot every checked node */
    const pending =
      checkedNode === undefined
        ? Promise.resolve(
            err(
              diagnostic(
                "INTERNAL_INVARIANT_VIOLATION",
                `Execution node ${nodeId} is missing.`,
              ),
            ),
          )
        : evaluateNode(checkedNode);
    memo.set(nodeId, pending);
    return pending;
  }

  const output = await evaluate(plan.normalized.wire.root);
  if (!output.ok) {
    return err({
      diagnostics: [output.error],
      trace: {
        runId,
        planHash,
        catalog: catalog.identity,
        catalogFingerprint: compiledArtifacts.catalogFingerprint,
        events,
        finalUsage: snapshotUsage(usage),
      },
    });
  }
  const outputDigest = await digestValue(output.value);
  /* v8 ignore next -- the checked root output is guaranteed to be JSON */
  if (!outputDigest.ok) {
    return err({
      diagnostics: [outputDigest.error],
      trace: {
        runId,
        planHash,
        catalog: catalog.identity,
        catalogFingerprint: compiledArtifacts.catalogFingerprint,
        events,
        finalUsage: snapshotUsage(usage),
      },
    });
  }
  return ok({
    output: output.value,
    outputDigest: outputDigest.value,
    trace: {
      runId,
      planHash,
      catalog: catalog.identity,
      catalogFingerprint: compiledArtifacts.catalogFingerprint,
      events,
      finalUsage: snapshotUsage(usage),
    },
  });
}

export const replayEntrySchema = z
  .strictObject({
    requestHash: effectRequestHashSchema,
    planHash: planHashSchema,
    catalogFingerprint: catalogFingerprintSchema,
    operation: operationReferenceSchema,
    nodeId: nodeIdSchema,
    invocationIndex: z.number().int().nonnegative(),
    effectName: z.string().min(1),
    inputDigest: valueDigestSchema,
    outputDigest: valueDigestSchema,
    value: z.json(),
    replayResultId: z.string().min(1),
    usage: z
      .strictObject({
        tokens: z.number().int().nonnegative(),
        wallClockMs: z.number().int().nonnegative(),
      })
      .readonly(),
  })
  .readonly();

export type ReplayEntry = z.infer<typeof replayEntrySchema>;

function replayIdentityMatches(
  entry: ReplayEntry,
  request: EffectRequest,
): boolean {
  return (
    entry.requestHash === request.requestHash &&
    entry.planHash === request.planHash &&
    entry.catalogFingerprint === request.catalogFingerprint &&
    entry.operation.id === request.operation.id &&
    entry.operation.version === request.operation.version &&
    entry.nodeId === request.nodeId &&
    entry.invocationIndex === request.invocationIndex &&
    entry.effectName === request.effectName &&
    entry.inputDigest === request.inputDigest
  );
}

export async function recordEffectResult(
  request: EffectRequest,
  result: EffectResult,
): Promise<Result<ReplayEntry, Diagnostic>> {
  const outputDigest = await digestValue(result.value);
  if (!outputDigest.ok) return outputDigest;
  const parsed = replayEntrySchema.safeParse({
    requestHash: request.requestHash,
    planHash: request.planHash,
    catalogFingerprint: request.catalogFingerprint,
    operation: request.operation,
    nodeId: request.nodeId,
    invocationIndex: request.invocationIndex,
    effectName: request.effectName,
    inputDigest: request.inputDigest,
    outputDigest: outputDigest.value,
    value: result.value,
    replayResultId: result.replayResultId,
    usage: result.usage,
  });
  return parsed.success
    ? ok(parsed.data)
    : err(
        diagnostic(
          "RUNTIME_SCHEMA_VIOLATION",
          parsed.error.issues.map((issue) => issue.message).join("; "),
          { nodeId: request.nodeId },
        ),
      );
}

export function createReplayEffectHandler(
  entries: ReadonlyArray<ReplayEntry>,
): EffectHandler {
  const byRequestHash = new Map(
    entries.map((entry) => [entry.requestHash, entry]),
  );
  const byInvocation = new Map(
    entries.map((entry) => [`${entry.nodeId}:${entry.invocationIndex}`, entry]),
  );
  return async (request) => {
    const entry = byRequestHash.get(request.requestHash);
    const invocationEntry = byInvocation.get(request.invocationId);
    if (entry === undefined) {
      return invocationEntry === undefined
        ? err(
            diagnostic(
              "MISSING_REPLAY_RESULT",
              `No replay result for request ${request.requestHash}.`,
              { nodeId: request.nodeId },
              [],
              { repair: { nodeId: request.nodeId } },
            ),
          )
        : err(
            diagnostic(
              "REPLAY_REQUEST_MISMATCH",
              `Replay request at ${request.invocationId} does not match the recording.`,
              { nodeId: request.nodeId },
              [],
              {
                expected: {
                  reference: {
                    kind: "effectRequest",
                    id: invocationEntry.requestHash,
                  },
                },
                actual: {
                  reference: {
                    kind: "effectRequest",
                    id: request.requestHash,
                  },
                },
                repair: { nodeId: request.nodeId },
              },
            ),
          );
    }
    if (!replayIdentityMatches(entry, request)) {
      return err(
        diagnostic(
          "REPLAY_REQUEST_MISMATCH",
          `Replay identity fields do not match request ${request.requestHash}.`,
          { nodeId: request.nodeId },
          [],
          { repair: { nodeId: request.nodeId } },
        ),
      );
    }
    const actualOutputDigest = await digestValue(entry.value);
    /* v8 ignore next -- replayEntrySchema only accepts JSON values */
    if (!actualOutputDigest.ok) return actualOutputDigest;
    if (actualOutputDigest.value !== entry.outputDigest) {
      return err(
        diagnostic(
          "REPLAY_OUTPUT_MISMATCH",
          `Replay output digest does not match request ${request.requestHash}.`,
          { nodeId: request.nodeId },
          [],
          {
            expected: { value: entry.outputDigest },
            actual: { value: actualOutputDigest.value },
            repair: { nodeId: request.nodeId },
          },
        ),
      );
    }
    return ok({
      value: entry.value,
      replayResultId: entry.replayResultId,
      usage: entry.usage,
    });
  };
}

/** Adapts a deterministic caller-owned resolver into the asynchronous effect boundary. */
export function createMockEffectHandler(
  resolver: (request: EffectRequest) => Result<EffectResult, Diagnostic>,
): EffectHandler {
  return (request) => Promise.resolve(resolver(request));
}
