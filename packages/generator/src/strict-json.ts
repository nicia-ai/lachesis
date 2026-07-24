import { canonicalizeJson } from "@nicia-ai/lachesis";
import { z } from "zod";

export type StrictJsonValue = z.infer<ReturnType<typeof z.json>>;

function isStrictJsonValue(value: unknown): value is StrictJsonValue {
  return canonicalizeJson(value).ok;
}

/** Private non-transforming boundary for identity-bearing arbitrary JSON. */
export const strictJsonValueSchema = z.custom<StrictJsonValue>(
  isStrictJsonValue,
  "Expected a strict, non-transforming JSON value.",
);

export const strictJsonRecordSchema = z.custom<
  Readonly<Record<string, StrictJsonValue>>
>(
  (value) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    isStrictJsonValue(value),
  "Expected a strict, non-transforming JSON object.",
);
