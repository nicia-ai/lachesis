import { canonicalizeJson } from "@nicia-ai/lachesis";
import { z } from "zod";

type JsonValue = z.infer<ReturnType<typeof z.json>>;

function isJsonValue(value: unknown): value is JsonValue {
  return canonicalizeJson(value).ok;
}

/** Private non-transforming boundary for identity-bearing arbitrary JSON. */
export const strictJsonValueSchema = z.custom<JsonValue>(
  isJsonValue,
  "Expected a strict, non-transforming JSON value.",
);

/**
 * Takes a plain-data snapshot of output produced directly by Zod's JSON Schema
 * generator. Structured cloning removes Zod's non-enumerable runtime metadata
 * without invoking `toJSON`; strict canonical validation then rejects any
 * unexpected enumerable non-JSON value. This is not a general input sanitizer.
 */
export function snapshotZodJsonSchema(schema: z.ZodType): JsonValue {
  const snapshot: unknown = structuredClone(z.toJSONSchema(schema));
  if (!isJsonValue(snapshot)) {
    throw new Error("Zod generated a non-JSON schema snapshot.");
  }
  return snapshot;
}
