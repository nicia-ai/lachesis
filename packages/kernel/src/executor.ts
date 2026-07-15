import { digestValue, hashPlan } from "./canonical.js";
import {
  type Catalog,
  referenceKey,
  type RuntimeEffect,
  type RuntimeSchema,
} from "./catalog.js";
import { type Diagnostic, diagnostic } from "./diagnostic.js";
import type { CheckedNode, CheckedPlan, PlanAnalysis } from "./plan.js";
import { err, ok, type Result } from "./result.js";
import type { NodeId } from "./wire.js";

export type RuntimeUsage = Readonly<{
  effectCalls: number;
  tokens: number;
  wallClockMs: number;
  recursionDepth: number;
  maximumParallelism: number;
}>;

export type EffectRequest = Readonly<{
  invocationId: string;
  nodeId: NodeId;
  operation: Readonly<{ id: string; version: string }>;
  effectName: string;
  capability: string;
  input: unknown;
  inputDigest: string;
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
  events: ReadonlyArray<TraceEvent>;
  finalUsage: RuntimeUsage;
}>;

export type ExecutionSuccess = Readonly<{
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
  plan: CheckedPlan,
  usage: MutableUsage,
  nodeId: NodeId,
): Diagnostic | undefined {
  const budget = plan.normalized.wire.budget;
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
}

function ensureArray(
  value: unknown,
  nodeId: NodeId,
): Result<ReadonlyArray<unknown>, Diagnostic> {
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
  catalog: Catalog,
  effect: RuntimeEffect,
): Result<RuntimeSchema, Diagnostic> {
  const schema = catalog.schemas.get(referenceKey(effect.output));
  return schema === undefined
    ? err(
        diagnostic(
          "INTERNAL_INVARIANT_VIOLATION",
          `Effect output schema ${referenceKey(effect.output)} disappeared.`,
        ),
      )
    : ok(schema);
}

/** Executes only a checked/analyzed plan through injected effects, time, and run identity. */
export async function executePlan(
  plan: CheckedPlan,
  _analysis: PlanAnalysis,
  catalog: Catalog,
  options: ExecuteOptions,
): Promise<Result<ExecutionSuccess, ExecutionFailure>> {
  const planHash = await hashPlan(plan.normalized.wire);
  if (!planHash.ok) return err({ diagnostics: [planHash.error] });
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
    usage.effectCalls += 1;
    const beforeFailure = checkUsage(plan, usage, nodeId);
    if (beforeFailure !== undefined) return err(beforeFailure);
    const inputDigest = await digestValue(input);
    if (!inputDigest.ok) return inputDigest;
    const handled = await options.effectHandler({
      invocationId,
      nodeId,
      operation: { id: effect.id, version: effect.version },
      effectName: effect.effectName,
      capability: effect.capability,
      input,
      inputDigest: inputDigest.value,
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
    const afterFailure = checkUsage(plan, usage, nodeId);
    if (afterFailure !== undefined) return err(afterFailure);
    const schema = outputSchemaForEffect(catalog, effect);
    if (!schema.ok) return schema;
    const validated = schema.value.parse(handled.value.value);
    if (!validated.ok) return validated;
    const outputDigest = await digestValue(validated.value);
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
            parsed.value.length > plan.normalized.wire.budget.maxCollectionItems
          ) {
            result = err(
              budgetFailure(
                "collection items",
                parsed.value.length,
                plan.normalized.wire.budget.maxCollectionItems,
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
        if (!array.ok) {
          result = array;
          break;
        }
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
          const usageFailure = checkUsage(plan, usage, node.id);
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
        } else {
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
          const usageFailure = checkUsage(plan, usage, node.id);
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
        planHash: planHash.value,
        catalog: catalog.identity,
        events,
        finalUsage: snapshotUsage(usage),
      },
    });
  }
  const outputDigest = await digestValue(output.value);
  if (!outputDigest.ok) {
    return err({
      diagnostics: [outputDigest.error],
      trace: {
        runId,
        planHash: planHash.value,
        catalog: catalog.identity,
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
      planHash: planHash.value,
      catalog: catalog.identity,
      events,
      finalUsage: snapshotUsage(usage),
    },
  });
}

export type ReplayEntry = Readonly<{
  invocationId: string;
  value: unknown;
  replayResultId: string;
  usage: Readonly<{ tokens: number; wallClockMs: number }>;
}>;

export function createReplayEffectHandler(
  entries: ReadonlyArray<ReplayEntry>,
): EffectHandler {
  const byInvocation = new Map(
    entries.map((entry) => [entry.invocationId, entry]),
  );
  return (request) => {
    const entry = byInvocation.get(request.invocationId);
    return Promise.resolve(
      entry === undefined
        ? err(
            diagnostic(
              "MISSING_REPLAY_RESULT",
              `No replay result for ${request.invocationId}.`,
              {
                nodeId: request.nodeId,
              },
            ),
          )
        : ok({
            value: entry.value,
            replayResultId: entry.replayResultId,
            usage: entry.usage,
          }),
    );
  };
}

/** Adapts a deterministic caller-owned resolver into the asynchronous effect boundary. */
export function createMockEffectHandler(
  resolver: (request: EffectRequest) => Result<EffectResult, Diagnostic>,
): EffectHandler {
  return (request) => Promise.resolve(resolver(request));
}
