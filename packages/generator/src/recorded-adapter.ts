import {
  type Diagnostic,
  diagnostic,
  digestValue,
  type Result,
} from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  DEFAULT_INFERENCE_SETTINGS,
  inferenceSettingsSchema,
  type ModelAdapter,
  type ModelAdapterFailure,
  type ModelIdentity,
  type ModelRequest,
  type ModelResponse,
} from "./model.js";

const identitySchema = z
  .strictObject({
    provider: z.string().min(1),
    model: z.string().min(1),
    adapterVersion: z.string().min(1),
  })
  .readonly();

const usageSchema = z
  .strictObject({
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative().default(0),
    cacheWriteInputTokens: z.number().int().nonnegative().default(0),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative().default(0),
    costUsdMicros: z.number().int().nonnegative(),
  })
  .readonly();

const responseSchema = z
  .strictObject({
    kind: z.literal("response"),
    response: z
      .strictObject({
        rawResponse: z.string(),
        structuredOutput: z.json().optional(),
        usage: usageSchema,
        latencyMs: z.number().int().nonnegative(),
        dispatchEvidence: z
          .literal("dispatched-with-usage")
          .default("dispatched-with-usage"),
        metadata: z
          .strictObject({
            providerRequestId: z.string().nullable(),
            providerResponseId: z.string().nullable(),
            returnedModelId: z.string().min(1),
            finishReason: z.string().min(1),
            rawFinishReason: z.string().nullable(),
          })
          .readonly()
          .optional(),
      })
      .readonly(),
  })
  .readonly();

const failureSchema = z
  .strictObject({
    kind: z.literal("failure"),
    failure: z
      .strictObject({
        code: z.enum([
          "RECORDED_RESPONSE_MISSING",
          "PROVIDER_FAILURE",
          "PROVIDER_REFUSAL",
          "BUDGET_RESERVATION_FAILED",
        ]),
        message: z.string().min(1),
        dispatchEvidence: z
          .enum([
            "not-dispatched",
            "dispatched-with-usage",
            "dispatched-usage-unknown",
          ])
          .default("dispatched-usage-unknown"),
        metadata: z
          .strictObject({
            providerRequestId: z.string().nullable(),
            providerResponseId: z.string().nullable(),
            returnedModelId: z.string().min(1),
            finishReason: z.string().min(1),
            rawFinishReason: z.string().nullable(),
          })
          .readonly()
          .optional(),
        usage: usageSchema.optional(),
        latencyMs: z.number().int().nonnegative().optional(),
      })
      .readonly(),
  })
  .readonly();

export const recordedModelFixtureSchema = z
  .strictObject({
    identity: identitySchema,
    pricingEntryId: z.string().min(1).default("recorded/free"),
    inference: inferenceSettingsSchema.default(DEFAULT_INFERENCE_SETTINGS),
    responses: z
      .array(z.discriminatedUnion("kind", [responseSchema, failureSchema]))
      .readonly(),
  })
  .readonly();

export type RecordedModelFixture = z.infer<typeof recordedModelFixtureSchema>;

export type FrozenRecordedModelFixture = Readonly<{
  fixture: RecordedModelFixture;
  digest: string;
}>;

export type RecordedModelAdapter = ModelAdapter &
  Readonly<{
    fixtureDigest: string;
    requests: () => ReadonlyArray<ModelRequest>;
  }>;

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

export async function freezeRecordedModelFixture(
  value: unknown,
): Promise<Result<FrozenRecordedModelFixture, ReadonlyArray<Diagnostic>>> {
  const parsed = recordedModelFixtureSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) =>
        diagnostic("INVALID_WIRE_SCHEMA", issue.message, {
          path: issue.path.map((part) =>
            typeof part === "symbol" ? String(part) : part,
          ),
        }),
      ),
    };
  }
  deepFreeze(parsed.data);
  const digest = await digestValue(parsed.data);
  return digest.ok
    ? {
        ok: true,
        value: Object.freeze({ fixture: parsed.data, digest: digest.value }),
      }
    : { ok: false, error: [digest.error] };
}

export function createRecordedModelAdapter(
  frozen: FrozenRecordedModelFixture,
): RecordedModelAdapter {
  let cursor = 0;
  const requests: Array<ModelRequest> = [];
  return {
    identity: frozen.fixture.identity,
    inference: frozen.fixture.inference,
    pricingEntryId: frozen.fixture.pricingEntryId,
    fixtureDigest: frozen.digest,
    requests: () => [...requests],
    preflightStructuredOutput: () =>
      Promise.resolve({ ok: true, value: undefined }),
    generate(
      request: ModelRequest,
    ): Promise<Result<ModelResponse, ModelAdapterFailure>> {
      requests.push(request);
      const item = frozen.fixture.responses[cursor];
      cursor += 1;
      if (item === undefined) {
        return Promise.resolve({
          ok: false,
          error: {
            code: "RECORDED_RESPONSE_MISSING",
            message: `No recorded response at index ${cursor - 1}.`,
            dispatchEvidence: "not-dispatched",
          },
        });
      }
      return Promise.resolve(
        item.kind === "response"
          ? { ok: true, value: item.response }
          : { ok: false, error: item.failure },
      );
    },
  };
}

export function modelIdentityKey(identity: ModelIdentity): string {
  return `${identity.provider}/${identity.model}@${identity.adapterVersion}`;
}
