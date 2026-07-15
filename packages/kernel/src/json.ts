import { z } from "zod";

import { type Diagnostic, diagnostic } from "./diagnostic.js";
import { err, ok, type Result } from "./result.js";
import { type WirePlan, wirePlanSchema } from "./wire.js";

const jsonValueSchema = z.json();
type JsonValue = z.infer<typeof jsonValueSchema>;

export function parseJson(text: string): Result<JsonValue, Diagnostic> {
  try {
    const value: unknown = JSON.parse(text);
    const parsed = jsonValueSchema.safeParse(value);
    if (!parsed.success) {
      return err(diagnostic("MALFORMED_JSON", "Input is not a JSON value."));
    }
    return ok(parsed.data);
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
