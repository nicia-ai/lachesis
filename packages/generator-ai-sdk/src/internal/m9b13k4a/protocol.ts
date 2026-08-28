import { createHash } from "node:crypto";

import { canonicalizeJson, parseJson, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

export const M9B13K4A_BUILD_PROTOCOL =
  "lachesis-m9b13k4a-native-helper-reproducible-build/2" as const;
export const M9B13K4A_INVOCATION_PROTOCOL =
  "lachesis-m9b13k4a-descriptor-ledger-invocation/2" as const;
export const M9B13K4A_LEDGER_PROTOCOL =
  "lachesis-m9b13k4a-descriptor-pinned-append-log/2" as const;
export const M9B13K4A_IMPLEMENTATION_PROTOCOL =
  "lachesis-m9b13k4a-source-build-bound-ledger-identity/2" as const;
export const M9B13K4A_MAXIMUM_PAYLOAD_BYTES = 65_536 as const;
export const M9B13K4A_MAXIMUM_LOG_BYTES = 8 * 1024 * 1024;
export const M9B13K4A_MAXIMUM_OUTPUT_BYTES = 2_048 as const;
export const M9B13K4A_HELPER_TIMEOUT_MS = 5_000 as const;

const digestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .readonly();
const decimalIdentitySchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/u)
  .readonly();

export const m9b13k4aLedgerReceiptSchema = z
  .strictObject({
    protocol: z.literal(M9B13K4A_INVOCATION_PROTOCOL),
    operation: z.enum(["create", "snapshot", "append", "audit"]),
    sessionIdentity: digestSchema,
    sequence: z.number().int().nonnegative(),
    root: digestSchema,
    namespaceDevice: decimalIdentitySchema,
    namespaceInode: decimalIdentitySchema,
    logDevice: decimalIdentitySchema,
    logInode: decimalIdentitySchema,
    helperSha256: digestSchema,
  })
  .readonly();
export type M9b13k4aLedgerReceipt = z.infer<typeof m9b13k4aLedgerReceiptSchema>;

export type M9b13k4aFailure = Readonly<{
  kind: "build" | "framing" | "identity" | "invocation" | "ledger" | "timeout";
  reason: string;
  ambiguous: boolean;
}>;

export const m9b13k4aImplementationInventorySchema = z
  .strictObject({
    protocol: z.literal(M9B13K4A_IMPLEMENTATION_PROTOCOL),
    entries: z
      .array(
        z
          .strictObject({
            kind: z.enum([
              "native-source",
              "typescript-source",
              "javascript",
              "declaration",
              "build-protocol",
              "executable",
              "sandbox-profile",
              "hostile-test",
              "configuration",
            ]),
            path: z
              .string()
              .min(1)
              .regex(/^[A-Za-z0-9._/-]+$/u)
              .refine((path) => !path.startsWith("/") && !path.includes("..")),
            byteLength: z.number().int().nonnegative(),
            sha256: digestSchema,
          })
          .readonly(),
      )
      .min(1)
      .readonly(),
  })
  .readonly();
export type M9b13k4aImplementationInventory = z.infer<
  typeof m9b13k4aImplementationInventorySchema
>;

export function m9b13k4aFailure(
  kind: M9b13k4aFailure["kind"],
  reason: string,
  ambiguous = false,
): Result<never, M9b13k4aFailure> {
  return { ok: false, error: { kind, reason, ambiguous } };
}

export function deriveM9b13k4aImplementationIdentity(value: unknown): Result<
  Readonly<{
    identity: string;
    canonicalInventory: M9b13k4aImplementationInventory;
  }>,
  M9b13k4aFailure
> {
  const parsed = m9b13k4aImplementationInventorySchema.safeParse(value);
  if (!parsed.success)
    return m9b13k4aFailure(
      "identity",
      "m9b13k4a-implementation-inventory-invalid",
    );
  const entries = parsed.data.entries.toSorted((left, right) => {
    const leftKey = `${left.kind}\0${left.path}`;
    const rightKey = `${right.kind}\0${right.path}`;
    return leftKey.localeCompare(rightKey);
  });
  const keys = entries.map((entry) => `${entry.kind}\0${entry.path}`);
  if (new Set(keys).size !== keys.length)
    return m9b13k4aFailure(
      "identity",
      "m9b13k4a-implementation-path-duplicate",
    );
  const canonicalInventory = m9b13k4aImplementationInventorySchema.parse({
    protocol: M9B13K4A_IMPLEMENTATION_PROTOCOL,
    entries,
  });
  const canonical = canonicalizeJson(canonicalInventory);
  if (!canonical.ok)
    return m9b13k4aFailure("identity", "m9b13k4a-implementation-not-canonical");
  const digest = createHash("sha256");
  digest.update(M9B13K4A_IMPLEMENTATION_PROTOCOL, "utf8");
  const bytes = new TextEncoder().encode(canonical.value);
  const length = new Uint8Array(8);
  new DataView(length.buffer).setBigUint64(0, BigInt(bytes.byteLength));
  digest.update(length);
  digest.update(bytes);
  return {
    ok: true,
    value: { identity: digest.digest("hex"), canonicalInventory },
  };
}

type ScanState = { index: number };

function skipWhitespace(text: string, state: ScanState): void {
  while (/\s/u.test(text[state.index] ?? "")) state.index++;
}

function scanHex(text: string, state: ScanState): number {
  const token = text.slice(state.index, state.index + 4);
  if (!/^[a-fA-F0-9]{4}$/u.test(token))
    throw new Error("invalid-unicode-escape");
  state.index += 4;
  return Number.parseInt(token, 16);
}

function scanString(text: string, state: ScanState): string {
  if (text[state.index] !== '"') throw new Error("string-required");
  state.index++;
  let decoded = "";
  while (state.index < text.length) {
    const character = text[state.index++];
    if (character === '"') return decoded;
    if (character === undefined || character.charCodeAt(0) < 0x20)
      throw new Error("invalid-string-character");
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    const escape = text[state.index++];
    if (escape === undefined) throw new Error("invalid-string-escape");
    const simple: Readonly<Record<string, string>> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escape in simple) {
      const value = simple[escape];
      if (value === undefined) throw new Error("invalid-string-escape");
      decoded += value;
      continue;
    }
    if (escape !== "u") throw new Error("invalid-string-escape");
    const first = scanHex(text, state);
    if (first >= 0xd800 && first <= 0xdbff) {
      if (text.slice(state.index, state.index + 2) !== "\\u")
        throw new Error("unpaired-high-surrogate");
      state.index += 2;
      const second = scanHex(text, state);
      if (second < 0xdc00 || second > 0xdfff)
        throw new Error("unpaired-high-surrogate");
      decoded += String.fromCodePoint(
        0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00),
      );
    } else {
      if (first >= 0xdc00 && first <= 0xdfff)
        throw new Error("unpaired-low-surrogate");
      decoded += String.fromCodePoint(first);
    }
  }
  throw new Error("unterminated-string");
}

function scanArray(text: string, state: ScanState): void {
  state.index++;
  skipWhitespace(text, state);
  if (text[state.index] === "]") {
    state.index++;
    return;
  }
  for (;;) {
    scanValue(text, state);
    skipWhitespace(text, state);
    if (text[state.index] === "]") {
      state.index++;
      return;
    }
    if (text[state.index] !== ",") throw new Error("array-separator-required");
    state.index++;
    skipWhitespace(text, state);
  }
}

function scanObject(text: string, state: ScanState): void {
  state.index++;
  skipWhitespace(text, state);
  const keys = new Set<string>();
  if (text[state.index] === "}") {
    state.index++;
    return;
  }
  for (;;) {
    const key = scanString(text, state);
    if (keys.has(key)) throw new Error("duplicate-object-key");
    keys.add(key);
    skipWhitespace(text, state);
    if (text[state.index] !== ":") throw new Error("object-colon-required");
    state.index++;
    scanValue(text, state);
    skipWhitespace(text, state);
    if (text[state.index] === "}") {
      state.index++;
      return;
    }
    if (text[state.index] !== ",") throw new Error("object-separator-required");
    state.index++;
    skipWhitespace(text, state);
  }
}

function scanPrimitive(text: string, state: ScanState): void {
  const remaining = text.slice(state.index);
  const match =
    /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u.exec(
      remaining,
    );
  if (match === null) throw new Error("invalid-primitive");
  state.index += match[0].length;
}

function scanValue(text: string, state: ScanState): void {
  skipWhitespace(text, state);
  switch (text[state.index]) {
    case undefined:
      throw new Error("value-required");
    case '"':
      scanString(text, state);
      return;
    case "[":
      scanArray(text, state);
      return;
    case "{":
      scanObject(text, state);
      return;
    default:
      scanPrimitive(text, state);
  }
}

export function canonicalM9b13k4aPayload(
  text: string,
): Result<Uint8Array, M9b13k4aFailure> {
  try {
    const state: ScanState = { index: 0 };
    scanValue(text, state);
    skipWhitespace(text, state);
    if (state.index !== text.length)
      return m9b13k4aFailure("framing", "m9b13k4a-json-trailing-data");
  } catch (error: unknown) {
    const reason =
      error instanceof Error ? error.message : "invalid-json-framing";
    return m9b13k4aFailure("framing", `m9b13k4a-json-${reason}`);
  }
  const parsed = parseJson(text);
  if (!parsed.ok) return m9b13k4aFailure("framing", "m9b13k4a-json-invalid");
  const canonical = canonicalizeJson(parsed.value);
  if (!canonical.ok)
    return m9b13k4aFailure("framing", "m9b13k4a-json-not-canonicalizable");
  const bytes = new TextEncoder().encode(canonical.value);
  return bytes.byteLength > M9B13K4A_MAXIMUM_PAYLOAD_BYTES
    ? m9b13k4aFailure("framing", "m9b13k4a-payload-oversized")
    : { ok: true, value: bytes };
}
