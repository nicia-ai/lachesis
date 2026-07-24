import { z } from "zod";

import { canonicalizeJson } from "./canonical.js";
import { type Diagnostic, diagnostic } from "./diagnostic.js";
import { err, ok, type Result } from "./result.js";
import { type WirePlan, wirePlanSchema } from "./wire.js";

type JsonValue = z.infer<ReturnType<typeof z.json>>;

function isJsonValue(value: unknown): value is JsonValue {
  return canonicalizeJson(value).ok;
}

export function parseJson(text: string): Result<JsonValue, Diagnostic> {
  try {
    const value: unknown = JSON.parse(text);
    if (!isJsonValue(value)) {
      return err(diagnostic("MALFORMED_JSON", "Input is not a JSON value."));
    }
    return ok(value);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown JSON parser failure";
    return err(
      diagnostic("MALFORMED_JSON", "Could not parse JSON.", {}, [
        { key: "cause", value: message },
      ]),
    );
  }
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

/** Parses untrusted text and returns only a fully Zod-validated version-1 wire plan. */
export function parsePlanJson(
  text: string,
): Result<WirePlan, ReadonlyArray<Diagnostic>> {
  const json = parseJson(text);
  if (!json.ok) return err([json.error]);
  const version = z.object({ formatVersion: z.string() }).safeParse(json.value);
  if (version.success && version.data.formatVersion !== "1") {
    return err([
      diagnostic(
        "UNSUPPORTED_PLAN_VERSION",
        `Unsupported plan format ${version.data.formatVersion}.`,
        {
          path: ["formatVersion"],
        },
      ),
    ]);
  }
  const parsed = wirePlanSchema.safeParse(json.value);
  if (parsed.success) return ok(parsed.data);
  return err(
    parsed.error.issues.map((issue) =>
      diagnostic(
        "INVALID_WIRE_SCHEMA",
        issue.message,
        {
          path: issue.path.map((part) =>
            typeof part === "symbol" ? String(part) : part,
          ),
        },
        [{ key: "issue", value: issue.code }],
      ),
    ),
  );
}
