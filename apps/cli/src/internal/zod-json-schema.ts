import { canonicalizeJson } from "@nicia-ai/lachesis";
import { z } from "zod";

type JsonValue = z.infer<ReturnType<typeof z.json>>;

function isJsonValue(value: unknown): value is JsonValue {
  return canonicalizeJson(value).ok;
}

/**
 * Takes a plain-data snapshot of output produced directly by Zod's JSON Schema
 * generator. Structured cloning removes Zod's non-enumerable runtime metadata
 * without invoking `toJSON`; strict canonical validation then rejects any
 * unexpected enumerable non-JSON value. This is not a general input sanitizer.
 */
export function snapshotZodJsonSchema(
  schema: z.ZodType,
  target?: "draft-2020-12",
): JsonValue {
  const generated =
    target === undefined
      ? z.toJSONSchema(schema)
      : z.toJSONSchema(schema, { target });
  const snapshot: unknown = structuredClone(generated);
  if (!isJsonValue(snapshot)) {
    throw new Error("Zod generated a non-JSON schema snapshot.");
  }
  return snapshot;
}
