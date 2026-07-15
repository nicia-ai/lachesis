import type { Diagnostics, Result } from "@nicia-ai/lachesis";

import {
  freezeRecordedModelFixture,
  type FrozenRecordedModelFixture,
} from "./recorded-adapter.js";

const PLAN_BUDGET = Object.freeze({
  maxEffectCalls: 0,
  maxCollectionItems: 32,
  maxRecursionDepth: 0,
  maxTokens: 0,
  maxWallClockMs: 0,
  maxParallelism: 2,
});

export const RECORDED_DOUBLE_PLAN = Object.freeze({
  formatVersion: "1",
  catalog: { id: "benchmark.numbers", version: "1.0.0" },
  root: "doubled",
  nodes: [
    {
      id: "source",
      op: "input",
      inputKey: "items",
      schema: { id: "numbers", version: "1.0.0" },
      maxItems: 32,
    },
    {
      id: "doubled",
      op: "map",
      source: "source",
      operation: { kind: "function", id: "double", version: "1.0.0" },
      outputCollectionSchema: { id: "numbers", version: "1.0.0" },
      parallelism: 2,
    },
  ],
  budget: PLAN_BUDGET,
  allowedCapabilities: [],
});

const DOUBLE_OUTCOME = Object.freeze({
  kind: "plan",
  plan: RECORDED_DOUBLE_PLAN,
});
const INVALID_OUTCOME = Object.freeze({
  kind: "plan",
  plan: { formatVersion: "1" },
});

const DIRECT_FIXTURE = {
  identity: {
    provider: "recorded",
    model: "m1a-direct",
    adapterVersion: "1",
  },
  responses: [
    {
      kind: "response",
      response: {
        structuredOutput: DOUBLE_OUTCOME,
        rawResponse: JSON.stringify(DOUBLE_OUTCOME),
        usage: { inputTokens: 120, outputTokens: 80, costUsdMicros: 240 },
        latencyMs: 12,
      },
    },
  ],
};

const REPAIR_FIXTURE = {
  identity: {
    provider: "recorded",
    model: "m1a-repair",
    adapterVersion: "1",
  },
  responses: [
    {
      kind: "response",
      response: {
        structuredOutput: INVALID_OUTCOME,
        rawResponse: JSON.stringify(INVALID_OUTCOME),
        usage: { inputTokens: 120, outputTokens: 12, costUsdMicros: 144 },
        latencyMs: 7,
      },
    },
    {
      kind: "response",
      response: {
        structuredOutput: DOUBLE_OUTCOME,
        rawResponse: JSON.stringify(DOUBLE_OUTCOME),
        usage: { inputTokens: 180, outputTokens: 80, costUsdMicros: 340 },
        latencyMs: 11,
      },
    },
  ],
};

const ABSTENTION_FIXTURE = {
  identity: {
    provider: "recorded",
    model: "m1a-abstention",
    adapterVersion: "1",
  },
  responses: [
    {
      kind: "response",
      response: {
        structuredOutput: {
          kind: "unplannable",
          reasons: ["The required capability is forbidden by policy."],
        },
        rawResponse:
          '{"kind":"unplannable","reasons":["The required capability is forbidden by policy."]}',
        usage: { inputTokens: 100, outputTokens: 22, costUsdMicros: 144 },
        latencyMs: 8,
      },
    },
  ],
};

export async function loadM1aRecordedFixtures(): Promise<
  Result<ReadonlyArray<FrozenRecordedModelFixture>, Diagnostics>
> {
  const frozen = await Promise.all(
    [DIRECT_FIXTURE, REPAIR_FIXTURE, ABSTENTION_FIXTURE].map((fixture) =>
      freezeRecordedModelFixture(fixture),
    ),
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
