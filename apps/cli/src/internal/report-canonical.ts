import { isProxy } from "node:util/types";

import { canonicalizeJson, type Result } from "@nicia-ai/lachesis";

export type ReportContractFailure = Readonly<{
  code:
    | "INVALID_REPORT"
    | "UNSAFE_REPORT_VALUE"
    | "SUMMARY_MISMATCH"
    | "STATUS_MISMATCH"
    | "EXIT_CODE_MISMATCH"
    | "REPORT_DIGEST_MISMATCH"
    | "COMMAND_IDENTITY_MISMATCH"
    | "NESTED_IDENTITY_MISMATCH"
    | "ARTIFACT_BINDING_MISMATCH"
    | "ARTIFACT_BINDING_INCOMPLETE"
    | "SEMANTIC_ORDER_MISMATCH";
  message: string;
}>;

function failure(message: string): Result<never, ReportContractFailure> {
  return {
    ok: false,
    error: { code: "UNSAFE_REPORT_VALUE", message },
  };
}

function inspectPlainData(
  value: unknown,
  ancestors: ReadonlySet<object>,
  path: string,
): Result<true, ReportContractFailure> {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return { ok: true, value: true };
  if (typeof value === "number")
    return Number.isFinite(value)
      ? { ok: true, value: true }
      : failure(`Non-finite number at ${path}.`);
  if (typeof value !== "object")
    return failure(`Unsupported ${typeof value} value at ${path}.`);
  if (isProxy(value)) return failure(`Proxy value at ${path}.`);
  if (ancestors.has(value)) return failure(`Cycle at ${path}.`);

  const prototype = Reflect.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (
    (isArray && prototype !== Array.prototype) ||
    (!isArray && prototype !== Object.prototype && prototype !== null)
  )
    return failure(`Unsupported object prototype at ${path}.`);

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol"))
    return failure(`Symbol key at ${path}.`);
  const nextAncestors = new Set(ancestors).add(value);

  if (isArray) {
    const allowed = new Set([
      "length",
      ...Array.from({ length: value.length }, (_, index) => String(index)),
    ]);
    if (ownKeys.some((key) => typeof key === "string" && !allowed.has(key)))
      return failure(`Unexpected array property at ${path}.`);
    for (let index = 0; index < value.length; index += 1) {
      const key = String(index);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined)
        return failure(`Sparse array element at ${path}[${key}].`);
      if ("get" in descriptor || "set" in descriptor)
        return failure(`Accessor at ${path}[${key}].`);
      if (!descriptor.enumerable)
        return failure(`Hidden array element at ${path}[${key}].`);
      const inspected = inspectPlainData(
        descriptor.value,
        nextAncestors,
        `${path}[${key}]`,
      );
      if (!inspected.ok) return inspected;
    }
    return { ok: true, value: true };
  }

  const semanticKeys = new Set<string>();
  for (const key of ownKeys) {
    if (typeof key !== "string") return failure(`Symbol key at ${path}.`);
    const normalizedKey = key.normalize("NFC");
    if (semanticKeys.has(normalizedKey))
      return failure(`Duplicate normalized key at ${path}.`);
    semanticKeys.add(normalizedKey);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined)
      return failure(`Missing property descriptor at ${path}.${key}.`);
    if ("get" in descriptor || "set" in descriptor)
      return failure(`Accessor at ${path}.${key}.`);
    if (!descriptor.enumerable)
      return failure(`Hidden property at ${path}.${key}.`);
    const inspected = inspectPlainData(
      descriptor.value,
      nextAncestors,
      `${path}.${key}`,
    );
    if (!inspected.ok) return inspected;
  }
  return { ok: true, value: true };
}

export function validateReportPlainData(
  value: unknown,
): Result<true, ReportContractFailure> {
  return inspectPlainData(value, new Set(), "$");
}

export function canonicalizeReportValue(
  value: unknown,
): Result<string, ReportContractFailure> {
  const inspected = validateReportPlainData(value);
  if (!inspected.ok) return inspected;
  const canonical = canonicalizeJson(value);
  return canonical.ok
    ? { ok: true, value: canonical.value }
    : {
        ok: false,
        error: {
          code: "UNSAFE_REPORT_VALUE",
          message: canonical.error.message,
        },
      };
}

export function serializeCanonicalReport(
  value: unknown,
): Result<string, ReportContractFailure> {
  const canonical = canonicalizeReportValue(value);
  return canonical.ok ? { ok: true, value: `${canonical.value}\n` } : canonical;
}
