import { z } from "zod";

import { type Diagnostic, diagnostic } from "./diagnostic.js";
import { err, ok, type Result } from "./result.js";
import type { WirePlan } from "./wire.js";

const jsonValueSchema = z.json();
type JsonValue = z.infer<typeof jsonValueSchema>;

function serializeJson(value: JsonValue): string {
  if (value === null) return "null";
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value).toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${serializeJson(item)}`)
    .join(",")}}`;
}

export function canonicalizeJson(value: unknown): Result<string, Diagnostic> {
  const parsed = jsonValueSchema.safeParse(value);
  return parsed.success
    ? ok(serializeJson(parsed.data))
    : err(
        diagnostic(
          "RUNTIME_SCHEMA_VIOLATION",
          "Value is not canonically serializable JSON.",
        ),
      );
}

/** Returns the syntactic canonical identity of an already validated plan. */
export function canonicalizePlan(plan: WirePlan): Result<string, Diagnostic> {
  return canonicalizeJson(plan);
}

export async function hashCanonicalJson(canonical: string): Promise<string> {
  const bytes = new TextEncoder().encode(canonical);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Hashes every semantic field in the validated wire plan using Web Crypto SHA-256. */
export async function hashPlan(
  plan: WirePlan,
): Promise<Result<string, Diagnostic>> {
  const canonical = canonicalizePlan(plan);
  return canonical.ok
    ? ok(await hashCanonicalJson(canonical.value))
    : canonical;
}

export async function digestValue(
  value: unknown,
): Promise<Result<string, Diagnostic>> {
  const canonical = canonicalizeJson(value);
  return canonical.ok
    ? ok(await hashCanonicalJson(canonical.value))
    : canonical;
}
