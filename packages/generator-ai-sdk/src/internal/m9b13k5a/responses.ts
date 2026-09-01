import { createHash } from "node:crypto";
import { isIP } from "node:net";

import { canonicalizeJson, parseJson, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  M9B13K5A_FILENAME,
  M9B13K5A_PROJECT_ID,
  M9B13K5A_PROVIDER,
  type M9b13k5aFailure,
  m9b13k5aFailure,
  type M9b13k5aOperation,
  m9b13k5aOperationSchema,
  m9b13k5aSha256,
} from "./protocol.js";

const boundedText = z.string().min(1).max(4096);
const boundedUrl = z.url().max(8192);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const entityLinkSchema = z
  .strictObject({
    href: boundedUrl,
    meta: z.strictObject({}).readonly(),
  })
  .readonly();
const selfLinksSchema = z
  .strictObject({
    self: boundedUrl,
  })
  .readonly();
const paginationLinksSchema = z
  .strictObject({
    first: boundedUrl,
    last: boundedUrl,
    prev: boundedUrl.nullable(),
    next: boundedUrl.nullable(),
  })
  .readonly();
const collectionMetaSchema = z
  .strictObject({
    total: z.number().int().nonnegative(),
    per_page: z.number().int().positive(),
  })
  .readonly();

export const m9b13k5aTokenDetailResponseSchema = z
  .strictObject({
    data: z
      .strictObject({
        type: z.literal("tokens"),
        id: boundedText,
        attributes: z
          .strictObject({
            name: boundedText,
            scopes: z.array(boundedText).max(64).readonly(),
          })
          .readonly(),
        links: selfLinksSchema,
      })
      .readonly(),
  })
  .readonly();

export const m9b13k5aProjectResponseSchema = z
  .strictObject({
    data: z
      .strictObject({
        type: z.literal("nodes"),
        id: z.literal(M9B13K5A_PROJECT_ID),
        attributes: z
          .strictObject({
            title: boundedText,
            public: z.literal(false),
            current_user_permissions: z
              .array(z.enum(["read", "write", "admin"]))
              .min(2)
              .max(3)
              .readonly(),
          })
          .readonly(),
        relationships: z
          .strictObject({
            files: z.strictObject({ links: entityLinkSchema }).readonly(),
            registrations: z
              .strictObject({ links: entityLinkSchema })
              .readonly(),
          })
          .readonly(),
        links: selfLinksSchema,
      })
      .readonly(),
  })
  .readonly();

const registrationEntitySchema = z
  .strictObject({
    type: z.literal("registrations"),
    id: boundedText,
    attributes: z.strictObject({ title: boundedText }).readonly(),
    relationships: z
      .strictObject({
        registered_from: z.strictObject({ links: entityLinkSchema }).readonly(),
      })
      .readonly(),
    links: selfLinksSchema,
  })
  .readonly();
const viewOnlyLinkEntitySchema = z
  .strictObject({
    type: z.literal("view-only-links"),
    id: boundedText,
    attributes: z
      .strictObject({
        name: boundedText,
        anonymous: z.boolean(),
      })
      .readonly(),
    relationships: z
      .strictObject({
        nodes: z.strictObject({ links: entityLinkSchema }).readonly(),
      })
      .readonly(),
    links: selfLinksSchema,
  })
  .readonly();

function collectionSchema<T extends z.ZodType>(
  entity: T,
): z.ZodReadonly<
  z.ZodObject<{
    data: z.ZodReadonly<z.ZodArray<T>>;
    links: typeof paginationLinksSchema;
    meta: typeof collectionMetaSchema;
  }>
> {
  return z
    .strictObject({
      data: z.array(entity).max(100).readonly(),
      links: paginationLinksSchema,
      meta: collectionMetaSchema,
    })
    .readonly();
}

export const m9b13k5aRegistrationsResponseSchema = collectionSchema(
  registrationEntitySchema,
);
export const m9b13k5aViewOnlyLinksResponseSchema = collectionSchema(
  viewOnlyLinkEntitySchema,
);

export const m9b13k5aFileEntitySchema = z
  .strictObject({
    type: z.literal("files"),
    id: boundedText.regex(/^[A-Za-z0-9._~:-]+$/u),
    attributes: z
      .strictObject({
        name: boundedText,
        kind: z.enum(["file", "folder"]),
        path: boundedText,
        materialized_path: boundedText,
        provider: z.literal(M9B13K5A_PROVIDER),
        resource: z.literal(M9B13K5A_PROJECT_ID),
        size: z.number().int().nonnegative(),
      })
      .readonly(),
    relationships: z
      .strictObject({
        node: z.strictObject({ links: entityLinkSchema }).readonly(),
      })
      .readonly(),
    links: z
      .strictObject({
        self: boundedUrl,
        download: boundedUrl,
        upload: boundedUrl,
      })
      .readonly(),
  })
  .readonly();

export const m9b13k5aFileListResponseSchema = z
  .strictObject({
    data: z.array(m9b13k5aFileEntitySchema).max(1000).readonly(),
    links: paginationLinksSchema,
    meta: collectionMetaSchema,
  })
  .readonly();

export const m9b13k5aProviderRootResponseSchema = z
  .strictObject({
    data: z.array(m9b13k5aFileEntitySchema).length(1).readonly(),
    links: paginationLinksSchema,
    meta: collectionMetaSchema,
  })
  .readonly();

export const m9b13k5aUploadResponseSchema = z
  .strictObject({
    data: m9b13k5aFileEntitySchema,
  })
  .readonly();

export const M9B13K5A_RESPONSE_KINDS = [
  "token-detail",
  "project",
  "registrations",
  "view-only-links",
  "file-list",
  "provider-root",
  "upload",
] as const;
export type M9b13k5aResponseKind = (typeof M9B13K5A_RESPONSE_KINDS)[number];

const responseSchemas: Readonly<Record<M9b13k5aResponseKind, z.ZodType>> = {
  "token-detail": m9b13k5aTokenDetailResponseSchema,
  project: m9b13k5aProjectResponseSchema,
  registrations: m9b13k5aRegistrationsResponseSchema,
  "view-only-links": m9b13k5aViewOnlyLinksResponseSchema,
  "file-list": m9b13k5aFileListResponseSchema,
  "provider-root": m9b13k5aProviderRootResponseSchema,
  upload: m9b13k5aUploadResponseSchema,
};

type ScanState = { index: number };

function skipWhitespace(text: string, state: ScanState): void {
  while (["\t", "\n", "\r", " "].includes(text[state.index] ?? ""))
    state.index++;
}

function scanString(text: string, state: ScanState): string {
  if (text[state.index] !== '"') throw new Error("string-required");
  state.index++;
  let decoded = "";
  while (state.index < text.length) {
    const character = text[state.index++];
    if (character === '"') return decoded;
    if (character === undefined || character.charCodeAt(0) < 0x20)
      throw new Error("invalid-string");
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    const escape = text[state.index++];
    if (escape === undefined) throw new Error("invalid-escape");
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
    if (simple[escape] !== undefined) {
      decoded += simple[escape];
      continue;
    }
    if (escape !== "u") throw new Error("invalid-escape");
    const token = text.slice(state.index, state.index + 4);
    if (!/^[a-fA-F0-9]{4}$/u.test(token)) throw new Error("invalid-unicode");
    state.index += 4;
    const code = Number.parseInt(token, 16);
    if (code >= 0xd800 && code <= 0xdfff)
      throw new Error("surrogate-not-accepted");
    decoded += String.fromCodePoint(code);
  }
  throw new Error("unterminated-string");
}

function scanPrimitive(text: string, state: ScanState): void {
  const match =
    /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u.exec(
      text.slice(state.index),
    );
  if (match === null) throw new Error("primitive-invalid");
  state.index += match[0].length;
}

function scanValue(text: string, state: ScanState): void {
  skipWhitespace(text, state);
  if (text[state.index] === '"') {
    scanString(text, state);
    return;
  }
  if (text[state.index] === "[") {
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
      if (text[state.index] !== ",") throw new Error("array-invalid");
      state.index++;
    }
  }
  if (text[state.index] === "{") {
    state.index++;
    skipWhitespace(text, state);
    const keys = new Set<string>();
    if (text[state.index] === "}") {
      state.index++;
      return;
    }
    for (;;) {
      skipWhitespace(text, state);
      const key = scanString(text, state);
      if (keys.has(key)) throw new Error("duplicate-key");
      keys.add(key);
      skipWhitespace(text, state);
      if (text[state.index] !== ":") throw new Error("colon-required");
      state.index++;
      scanValue(text, state);
      skipWhitespace(text, state);
      if (text[state.index] === "}") {
        state.index++;
        return;
      }
      if (text[state.index] !== ",") throw new Error("object-invalid");
      state.index++;
    }
  }
  scanPrimitive(text, state);
}

function validStrictJsonFraming(text: string): boolean {
  try {
    const state: ScanState = { index: 0 };
    scanValue(text, state);
    skipWhitespace(text, state);
    return state.index === text.length;
  } catch {
    return false;
  }
}

export function parseM9b13k5aOfficialResponse(
  responseKind: M9b13k5aResponseKind,
  rawBytes: Uint8Array,
): Result<
  Readonly<{
    rawByteLength: number;
    rawSha256: string;
    canonicalResponseSha256: string;
    response: unknown;
  }>,
  M9b13k5aFailure
> {
  if (rawBytes.byteLength > 262_144)
    return m9b13k5aFailure("m9b13k5a-response-oversized");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
  } catch {
    return m9b13k5aFailure("m9b13k5a-response-utf8-invalid");
  }
  if (!validStrictJsonFraming(text))
    return m9b13k5aFailure("m9b13k5a-response-json-framing-invalid");
  const decoded = parseJson(text);
  if (!decoded.ok) return m9b13k5aFailure("m9b13k5a-response-json-invalid");
  const parsed = responseSchemas[responseKind].safeParse(decoded.value);
  if (!parsed.success)
    return m9b13k5aFailure("m9b13k5a-response-schema-invalid");
  const canonical = canonicalizeJson(parsed.data);
  if (!canonical.ok)
    return m9b13k5aFailure("m9b13k5a-response-canonicalization-invalid");
  return {
    ok: true,
    value: {
      rawByteLength: rawBytes.byteLength,
      rawSha256: m9b13k5aSha256(rawBytes),
      canonicalResponseSha256: m9b13k5aSha256(canonical.value),
      response: parsed.data,
    },
  };
}

const transportReceiptRegistry = new WeakSet<object>();
const transportReceiptSchema = z
  .strictObject({
    syntheticIdentity: z.literal("SYNTHETIC-M9B13K5A-TRANSPORT-RECEIPT"),
    operation: m9b13k5aOperationSchema,
    page: z.number().int().positive().max(4),
    method: z.enum(["DELETE", "GET", "PUT"]),
    requestedUrl: boundedUrl,
    requestDigest: sha256Schema,
    responseIdentity: sha256Schema,
    status: z.number().int().min(200).max(299),
    rawByteLength: z.number().int().nonnegative(),
    rawSha256: sha256Schema,
    receiptDigest: sha256Schema,
  })
  .readonly();
export type M9b13k5aVerifiedTransportReceipt = z.infer<
  typeof transportReceiptSchema
>;

export function createM9b13k5aSyntheticTransportReceipt(
  value: Omit<
    M9b13k5aVerifiedTransportReceipt,
    "syntheticIdentity" | "receiptDigest"
  >,
): M9b13k5aVerifiedTransportReceipt {
  const digest = canonicalizeJson(value);
  if (!digest.ok) throw new Error("m9b13k5a-transport-receipt-invalid");
  const receipt = transportReceiptSchema.parse({
    ...value,
    syntheticIdentity: "SYNTHETIC-M9B13K5A-TRANSPORT-RECEIPT",
    receiptDigest: createHash("sha256").update(digest.value).digest("hex"),
  });
  transportReceiptRegistry.add(receipt);
  return receipt;
}

function verifiedTransportReceipt(
  value: unknown,
): value is M9b13k5aVerifiedTransportReceipt {
  return (
    value !== null &&
    typeof value === "object" &&
    transportReceiptRegistry.has(value) &&
    transportReceiptSchema.safeParse(value).success
  );
}

function exactHttpsUrl(value: string): Result<URL, M9b13k5aFailure> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return m9b13k5aFailure("m9b13k5a-url-invalid");
  }
  if (
    parsed.href !== value ||
    parsed.protocol !== "https:" ||
    parsed.hostname !== "files.osf.io" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    isIP(parsed.hostname) !== 0 ||
    parsed.pathname.includes("%") ||
    value.includes("\\")
  )
    return m9b13k5aFailure("m9b13k5a-url-policy-rejected");
  return { ok: true, value: parsed };
}

export type M9b13k5aStableObjectEvidence = Readonly<{
  providerRootUploadUrl: string;
  putUrl: string;
  uploadEntity: z.infer<typeof m9b13k5aFileEntitySchema>;
  postUploadInventory: ReadonlyArray<z.infer<typeof m9b13k5aFileEntitySchema>>;
  downloadUrl: string;
}>;

export function reconcileM9b13k5aStableObject(
  putReceiptValue: unknown,
  downloadReceiptValue: unknown,
  evidence: M9b13k5aStableObjectEvidence,
  downloadedRawBytes: Uint8Array,
): Result<
  Readonly<{
    objectIdentity: string;
    byteLength: number;
    sha256: string;
    exactObjectCardinality: 1;
    reconciliationSha256: string;
  }>,
  M9b13k5aFailure
> {
  if (
    !verifiedTransportReceipt(putReceiptValue) ||
    !verifiedTransportReceipt(downloadReceiptValue)
  )
    return m9b13k5aFailure("m9b13k5a-transport-receipt-unverified");
  const putReceipt = putReceiptValue;
  const downloadReceipt = downloadReceiptValue;
  if (
    putReceipt.operation !== "canary-put" ||
    putReceipt.method !== "PUT" ||
    downloadReceipt.operation !== "canary-download" ||
    downloadReceipt.method !== "GET" ||
    putReceipt.requestedUrl !== evidence.putUrl ||
    downloadReceipt.requestedUrl !== evidence.downloadUrl ||
    downloadReceipt.rawByteLength !== downloadedRawBytes.byteLength ||
    downloadReceipt.rawSha256 !== m9b13k5aSha256(downloadedRawBytes)
  )
    return m9b13k5aFailure("m9b13k5a-transport-receipt-mismatch");
  const root = exactHttpsUrl(evidence.providerRootUploadUrl);
  const put = exactHttpsUrl(evidence.putUrl);
  const download = exactHttpsUrl(evidence.downloadUrl);
  if (!root.ok) return root;
  if (!put.ok) return put;
  if (!download.ok) return download;
  const providerPath = `/v1/resources/${M9B13K5A_PROJECT_ID}/providers/${M9B13K5A_PROVIDER}/`;
  if (
    root.value.pathname !== providerPath ||
    root.value.search !== "" ||
    put.value.pathname !== providerPath ||
    put.value.searchParams.getAll("kind").length !== 1 ||
    put.value.searchParams.get("kind") !== "file" ||
    put.value.searchParams.getAll("name").length !== 1 ||
    put.value.searchParams.get("name") !== M9B13K5A_FILENAME ||
    [...put.value.searchParams.keys()].toSorted().join("\0") !==
      ["kind", "name"].join("\0")
  )
    return m9b13k5aFailure("m9b13k5a-provider-put-identity-mismatch");
  const entity = m9b13k5aFileEntitySchema.safeParse(evidence.uploadEntity);
  if (!entity.success || entity.data.attributes.name !== M9B13K5A_FILENAME)
    return m9b13k5aFailure("m9b13k5a-upload-entity-invalid");
  const expectedObjectPath = `${providerPath}${entity.data.id}`;
  if (
    download.value.pathname !== expectedObjectPath ||
    download.value.search !== "" ||
    entity.data.links.download !== download.value.href ||
    entity.data.attributes.path !== `/${entity.data.id}` ||
    entity.data.attributes.materialized_path !== `/${M9B13K5A_FILENAME}`
  )
    return m9b13k5aFailure("m9b13k5a-download-object-identity-mismatch");
  const inventoryEntity = evidence.postUploadInventory[0];
  if (
    evidence.postUploadInventory.length !== 1 ||
    inventoryEntity?.id !== entity.data.id ||
    inventoryEntity.attributes.path !== entity.data.attributes.path
  )
    return m9b13k5aFailure("m9b13k5a-inventory-cardinality-mismatch");
  const result = {
    objectIdentity: entity.data.id,
    byteLength: downloadedRawBytes.byteLength,
    sha256: m9b13k5aSha256(downloadedRawBytes),
    exactObjectCardinality: 1 as const,
  };
  const canonical = canonicalizeJson({
    ...result,
    providerRootUploadUrl: root.value.href,
    putUrl: put.value.href,
    downloadUrl: download.value.href,
    putReceiptDigest: putReceipt.receiptDigest,
    downloadReceiptDigest: downloadReceipt.receiptDigest,
  });
  if (!canonical.ok)
    return m9b13k5aFailure("m9b13k5a-reconciliation-canonical-invalid");
  return {
    ok: true,
    value: {
      ...result,
      reconciliationSha256: m9b13k5aSha256(canonical.value),
    },
  };
}

export function responseKindForOperation(
  operation: M9b13k5aOperation,
): M9b13k5aResponseKind | null {
  switch (operation) {
    case "token-detail":
      return "token-detail";
    case "project":
      return "project";
    case "registration-inventory":
      return "registrations";
    case "view-only-link-inventory":
      return "view-only-links";
    case "pre-upload-file-inventory":
    case "post-upload-file-inventory":
      return "file-list";
    case "provider-root":
      return "provider-root";
    case "canary-put":
      return "upload";
    case "canary-download":
    case "pat-revocation":
      return null;
  }
}
