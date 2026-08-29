import { createHash } from "node:crypto";

import { canonicalizeJson, parseJson, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  M9B13K5_ARTIFACT_FILENAME,
  M9B13K5_ARTIFACT_SHA256,
  M9B13K5_LIMITS,
  M9B13K5_PROJECT_ID,
  M9B13K5_PROVIDER,
  M9B13K5_RECONCILIATION_PROTOCOL,
} from "./protocol.js";

const boundedText = z.string().min(1).max(4096);
const boundedUrl = z.url().max(8192);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const relationSchema = z
  .strictObject({
    href: boundedUrl,
  })
  .readonly();

const fileObjectSchema = z
  .strictObject({
    id: boundedText,
    name: boundedText,
    path: boundedText,
    provider: z.literal(M9B13K5_PROVIDER),
    size: z.number().int().nonnegative(),
    sha256: sha256Schema,
    links: z
      .strictObject({
        download: relationSchema,
      })
      .readonly(),
  })
  .readonly();

export const m9b13k5TokenDetailResponseSchema = z
  .strictObject({
    id: boundedText,
    active: z.boolean(),
    scopes: z.array(boundedText).max(64).readonly(),
  })
  .readonly();

export const m9b13k5ProjectResponseSchema = z
  .strictObject({
    id: z.literal(M9B13K5_PROJECT_ID),
    title: boundedText,
    currentUserCanWrite: z.boolean(),
  })
  .readonly();

const pageLinksSchema = z
  .strictObject({
    next: boundedUrl.nullable(),
  })
  .readonly();

export const m9b13k5RegistrationsPageSchema = z
  .strictObject({
    data: z
      .array(
        z.strictObject({ id: boundedText, projectId: boundedText }).readonly(),
      )
      .max(100)
      .readonly(),
    links: pageLinksSchema,
  })
  .readonly();

export const m9b13k5ViewOnlyLinksPageSchema = z
  .strictObject({
    data: z
      .array(
        z.strictObject({ id: boundedText, anonymous: z.boolean() }).readonly(),
      )
      .max(100)
      .readonly(),
    links: pageLinksSchema,
  })
  .readonly();

export const m9b13k5StorageInventorySchema = z
  .strictObject({
    provider: z.literal(M9B13K5_PROVIDER),
    files: z.array(fileObjectSchema).max(1000).readonly(),
  })
  .readonly();

export const m9b13k5ProviderRootSchema = z
  .strictObject({
    provider: z.literal(M9B13K5_PROVIDER),
    upload: relationSchema,
  })
  .readonly();

export const m9b13k5UploadResponseSchema = z
  .strictObject({
    file: fileObjectSchema,
  })
  .readonly();

export const m9b13k5RevocationResponseSchema = z
  .strictObject({
    tokenId: boundedText,
    revoked: z.boolean(),
  })
  .readonly();

export const m9b13k5DownloadMetadataSchema = z
  .strictObject({
    fileId: boundedText,
    path: boundedText,
    byteLength: z.number().int().nonnegative(),
    sha256: sha256Schema,
  })
  .readonly();

export const M9B13K5_RESPONSE_KINDS = [
  "token-detail",
  "project",
  "registrations-page",
  "view-only-links-page",
  "storage-inventory",
  "provider-root",
  "upload",
  "post-upload-inventory",
  "revocation",
  "download-metadata",
] as const;
export type M9b13k5ResponseKind = (typeof M9B13K5_RESPONSE_KINDS)[number];

const responseSchemas: Readonly<Record<M9b13k5ResponseKind, z.ZodType>> = {
  "token-detail": m9b13k5TokenDetailResponseSchema,
  project: m9b13k5ProjectResponseSchema,
  "registrations-page": m9b13k5RegistrationsPageSchema,
  "view-only-links-page": m9b13k5ViewOnlyLinksPageSchema,
  "storage-inventory": m9b13k5StorageInventorySchema,
  "provider-root": m9b13k5ProviderRootSchema,
  upload: m9b13k5UploadResponseSchema,
  "post-upload-inventory": m9b13k5StorageInventorySchema,
  revocation: m9b13k5RevocationResponseSchema,
  "download-metadata": m9b13k5DownloadMetadataSchema,
};

export type M9b13k5ResponseFailure = Readonly<{
  kind: "response";
  reason: string;
  ambiguous: false;
}>;

function responseFailure(
  reason: string,
): Result<never, M9b13k5ResponseFailure> {
  return { ok: false, error: { kind: "response", reason, ambiguous: false } };
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type ScanState = { index: number };

function skipWhitespace(text: string, state: ScanState): void {
  while (["\t", "\n", "\r", " "].includes(text[state.index] ?? ""))
    state.index++;
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
    const simpleValue = simple[escape];
    if (simpleValue !== undefined) {
      decoded += simpleValue;
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

function validateJsonFraming(text: string): boolean {
  try {
    const state: ScanState = { index: 0 };
    scanValue(text, state);
    skipWhitespace(text, state);
    return state.index === text.length;
  } catch {
    return false;
  }
}

export function parseM9b13k5BoundedResponse(
  responseKind: M9b13k5ResponseKind,
  rawBytes: Uint8Array,
): Result<
  Readonly<{
    rawSha256: string;
    canonicalDecisionSha256: string;
    decision: unknown;
  }>,
  M9b13k5ResponseFailure
> {
  const ceiling =
    responseKind === "upload"
      ? M9B13K5_LIMITS.uploadResponseBytes
      : M9B13K5_LIMITS.apiResponseBytes;
  if (rawBytes.byteLength > ceiling)
    return responseFailure("m9b13k5-response-oversized");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
  } catch {
    return responseFailure("m9b13k5-response-utf8-invalid");
  }
  if (!validateJsonFraming(text))
    return responseFailure("m9b13k5-response-json-framing-invalid");
  const decoded = parseJson(text);
  if (!decoded.ok)
    return responseFailure(`m9b13k5-response-${decoded.error.code}`);
  const parsed = responseSchemas[responseKind].safeParse(decoded.value);
  if (!parsed.success)
    return responseFailure("m9b13k5-response-schema-invalid");
  const canonical = canonicalizeJson(parsed.data);
  if (!canonical.ok)
    return responseFailure("m9b13k5-response-projection-invalid");
  return {
    ok: true,
    value: {
      rawSha256: sha256(rawBytes),
      canonicalDecisionSha256: sha256(canonical.value),
      decision: parsed.data,
    },
  };
}

export const m9b13k5StableObjectEvidenceSchema = z
  .strictObject({
    protocol: z.literal(M9B13K5_RECONCILIATION_PROTOCOL),
    providerRootUploadHref: boundedUrl,
    putHref: boundedUrl,
    uploadFileId: boundedText,
    uploadPath: boundedText,
    uploadName: z.literal(M9B13K5_ARTIFACT_FILENAME),
    uploadSha256: z.literal(M9B13K5_ARTIFACT_SHA256),
    inventoryFileId: boundedText,
    inventoryPath: boundedText,
    inventoryDownloadHref: boundedUrl,
    parsedDownloadFileId: boundedText,
    parsedDownloadPath: boundedText,
    downloadedByteLength: z.literal(M9B13K5_LIMITS.requestBodyBytes),
    downloadedSha256: z.literal(M9B13K5_ARTIFACT_SHA256),
  })
  .readonly();
export type M9b13k5StableObjectEvidence = z.infer<
  typeof m9b13k5StableObjectEvidenceSchema
>;

export function reconcileM9b13k5StableObject(
  value: unknown,
): Result<Readonly<{ stableObjectIdentity: string }>, M9b13k5ResponseFailure> {
  const parsed = m9b13k5StableObjectEvidenceSchema.safeParse(value);
  if (!parsed.success)
    return responseFailure("m9b13k5-reconciliation-schema-invalid");
  const evidence = parsed.data;
  const identities = [
    evidence.uploadFileId,
    evidence.inventoryFileId,
    evidence.parsedDownloadFileId,
  ];
  const paths = [
    evidence.uploadPath,
    evidence.inventoryPath,
    evidence.parsedDownloadPath,
  ];
  if (new Set(identities).size !== 1)
    return responseFailure("m9b13k5-reconciliation-object-mismatch");
  if (new Set(paths).size !== 1)
    return responseFailure("m9b13k5-reconciliation-path-mismatch");
  if (evidence.providerRootUploadHref !== evidence.putHref)
    return responseFailure("m9b13k5-reconciliation-put-relation-mismatch");
  const expectedDownloadSuffix = `/${identities[0]}`;
  if (!evidence.inventoryDownloadHref.endsWith(expectedDownloadSuffix))
    return responseFailure("m9b13k5-reconciliation-download-relation-mismatch");
  const canonical = canonicalizeJson(evidence);
  if (!canonical.ok)
    return responseFailure("m9b13k5-reconciliation-canonical-invalid");
  return { ok: true, value: { stableObjectIdentity: sha256(canonical.value) } };
}
