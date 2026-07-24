import { z } from "zod";

import { type Diagnostic, diagnostic } from "./diagnostic.js";
import { err, ok, type Result } from "./result.js";
import type { WirePlan } from "./wire.js";

export type StrictJsonValue = z.infer<ReturnType<typeof z.json>>;

function invalidJson(): Result<never, Diagnostic> {
  return err(
    diagnostic(
      "RUNTIME_SCHEMA_VIOLATION",
      "Value is not canonically serializable JSON.",
    ),
  );
}

function serializeJson(
  value: unknown,
  ancestors: ReadonlySet<object>,
): Result<string, Diagnostic> {
  if (value === null) return ok("null");
  if (typeof value === "string" || typeof value === "boolean") {
    return ok(JSON.stringify(value));
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? ok(JSON.stringify(value)) : invalidJson();
  }
  if (typeof value !== "object" || ancestors.has(value)) return invalidJson();

  const isArray = Array.isArray(value);
  const prototype = Reflect.getPrototypeOf(value);
  if (
    (isArray && prototype !== Array.prototype) ||
    (!isArray && prototype !== Object.prototype && prototype !== null)
  ) {
    return invalidJson();
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) return invalidJson();
  const nextAncestors = new Set(ancestors).add(value);

  if (isArray) {
    const allowedKeys = new Set([
      "length",
      ...Array.from({ length: value.length }, (_, index) => String(index)),
    ]);
    if (
      ownKeys.length !== allowedKeys.size ||
      ownKeys.some((key) => typeof key !== "string" || !allowedKeys.has(key))
    ) {
      return invalidJson();
    }

    const serializedItems: Array<string> = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return invalidJson();
      }
      const serialized = serializeJson(descriptor.value, nextAncestors);
      if (!serialized.ok) return serialized;
      serializedItems.push(serialized.value);
    }
    return ok(`[${serializedItems.join(",")}]`);
  }

  const serializedEntries: Array<readonly [string, string]> = [];
  for (const key of ownKeys) {
    if (typeof key !== "string") return invalidJson();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      return invalidJson();
    }
    const serialized = serializeJson(descriptor.value, nextAncestors);
    if (!serialized.ok) return serialized;
    serializedEntries.push([key, serialized.value]);
  }
  serializedEntries.sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return ok(
    `{${serializedEntries
      .map(([key, item]) => `${JSON.stringify(key)}:${item}`)
      .join(",")}}`,
  );
}

export function canonicalizeJson(value: unknown): Result<string, Diagnostic> {
  try {
    const serialized = serializeJson(value, new Set());
    if (!serialized.ok) return serialized;
    void structuredClone(value);
    return serialized;
  } catch {
    return invalidJson();
  }
}

/**
 * Validates canonical JSON without reconstructing the input. Keep this schema
 * private to package internals: it is a runtime identity boundary, not a
 * general-purpose normalization API.
 */
export const strictJsonValueSchema = z.custom<StrictJsonValue>(
  (value) => canonicalizeJson(value).ok,
  "Expected a strict, non-transforming JSON value.",
);

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
