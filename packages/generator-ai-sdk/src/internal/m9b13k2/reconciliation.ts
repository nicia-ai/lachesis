import { isIP } from "node:net";

import { type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  M9B13K2_ARTIFACT_BYTE_LENGTH,
  M9B13K2_ARTIFACT_FILENAME,
  M9B13K2_ARTIFACT_SHA256,
  M9B13K2_OBJECT_PROTOCOL,
  M9B13K2_PROJECT_ID,
  M9B13K2_PROVIDER,
  m9b13k2CanonicalDigest,
  m9b13k2DigestSchema,
  type M9b13k2Failure,
  m9b13k2Failure,
} from "./protocol.js";

const ALLOWED_FILE_HOSTS = new Set([
  "files.osf.io",
  "files.us.osf.io",
  "files.eu.osf.io",
  "files.au.osf.io",
  "files.ca.osf.io",
]);
const stableIdSchema = z.string().regex(/^[A-Za-z0-9._~-]+$/u);

const fileIdentitySchema = z
  .strictObject({
    id: stableIdSchema,
    type: z.literal("files"),
    name: z.literal(M9B13K2_ARTIFACT_FILENAME),
    path: z.string().min(2).max(512),
    resource: z.literal(M9B13K2_PROJECT_ID),
    provider: z.literal(M9B13K2_PROVIDER),
  })
  .readonly();
const uploadEntitySchema = fileIdentitySchema
  .unwrap()
  .safeExtend({ downloadUrl: z.url() })
  .readonly();

export const m9b13k2ObjectReconciliationInputSchema = z
  .strictObject({
    providerRoot: z
      .strictObject({
        resource: z.literal(M9B13K2_PROJECT_ID),
        provider: z.literal(M9B13K2_PROVIDER),
        uploadUrl: z.url(),
      })
      .readonly(),
    putUrl: z.url(),
    uploadEntity: uploadEntitySchema,
    postUploadInventory: z.array(fileIdentitySchema).readonly(),
    actualDownloadUrl: z.url(),
    downloadedReceipt: z
      .strictObject({
        objectId: stableIdSchema,
        resource: z.literal(M9B13K2_PROJECT_ID),
        provider: z.literal(M9B13K2_PROVIDER),
        byteLength: z.literal(M9B13K2_ARTIFACT_BYTE_LENGTH),
        sha256: z.literal(M9B13K2_ARTIFACT_SHA256),
      })
      .readonly(),
  })
  .readonly();
export type M9b13k2ObjectReconciliationInput = z.infer<
  typeof m9b13k2ObjectReconciliationInputSchema
>;

export type M9b13k2ObjectReceipt = Readonly<{
  protocol: typeof M9B13K2_OBJECT_PROTOCOL;
  objectId: string;
  resource: typeof M9B13K2_PROJECT_ID;
  provider: typeof M9B13K2_PROVIDER;
  filename: typeof M9B13K2_ARTIFACT_FILENAME;
  path: string;
  host: string;
  artifactSha256: typeof M9B13K2_ARTIFACT_SHA256;
  artifactByteLength: typeof M9B13K2_ARTIFACT_BYTE_LENGTH;
  reconciliationDigest: string;
}>;

function parseExactFileUrl(value: string): Result<URL, M9b13k2Failure> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return m9b13k2Failure("reconciliation", "m9b13k2-object-url-invalid");
  }
  if (
    value !== url.href ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.hash !== "" ||
    isIP(url.hostname) !== 0 ||
    !ALLOWED_FILE_HOSTS.has(url.hostname) ||
    url.pathname.includes("%") ||
    value.includes("\\")
  )
    return m9b13k2Failure(
      "reconciliation",
      "m9b13k2-object-url-policy-rejected",
    );
  return { ok: true, value: url };
}

function identityMatches(
  left: z.infer<typeof fileIdentitySchema>,
  right: z.infer<typeof fileIdentitySchema>,
): boolean {
  return left.id === right.id && left.path === right.path;
}

export function reconcileM9b13k2StableObject(
  value: unknown,
): Result<M9b13k2ObjectReceipt, M9b13k2Failure> {
  const parsed = m9b13k2ObjectReconciliationInputSchema.safeParse(value);
  if (!parsed.success)
    return m9b13k2Failure("reconciliation", "m9b13k2-object-input-invalid");
  const input = parsed.data;
  const providerUpload = parseExactFileUrl(input.providerRoot.uploadUrl);
  const put = parseExactFileUrl(input.putUrl);
  const download = parseExactFileUrl(input.uploadEntity.downloadUrl);
  const actualDownload = parseExactFileUrl(input.actualDownloadUrl);
  if (!providerUpload.ok) return providerUpload;
  if (!put.ok) return put;
  if (!download.ok) return download;
  if (!actualDownload.ok) return actualDownload;

  const providerPath = `/v1/resources/${M9B13K2_PROJECT_ID}/providers/${M9B13K2_PROVIDER}/`;
  if (
    providerUpload.value.pathname !== providerPath ||
    providerUpload.value.search !== "" ||
    put.value.origin !== providerUpload.value.origin ||
    put.value.pathname !== providerPath ||
    Array.from(put.value.searchParams.keys()).toSorted().join("\0") !==
      ["kind", "name"].join("\0") ||
    put.value.searchParams.getAll("kind").length !== 1 ||
    put.value.searchParams.get("kind") !== "file" ||
    put.value.searchParams.getAll("name").length !== 1 ||
    put.value.searchParams.get("name") !== M9B13K2_ARTIFACT_FILENAME
  )
    return m9b13k2Failure(
      "reconciliation",
      "m9b13k2-object-provider-put-mismatch",
    );

  const expectedObjectPath = `${providerPath}${input.uploadEntity.id}`;
  const expectedAttributePath = `/${input.uploadEntity.id}`;
  if (
    input.uploadEntity.path !== expectedAttributePath ||
    download.value.origin !== providerUpload.value.origin ||
    download.value.pathname !== expectedObjectPath ||
    download.value.search !== "" ||
    actualDownload.value.href !== download.value.href
  )
    return m9b13k2Failure(
      "reconciliation",
      "m9b13k2-object-upload-download-mismatch",
    );

  if (
    input.postUploadInventory.length !== 1 ||
    input.postUploadInventory[0] === undefined ||
    !identityMatches(input.postUploadInventory[0], input.uploadEntity)
  )
    return m9b13k2Failure(
      "reconciliation",
      "m9b13k2-object-inventory-mismatch-or-duplicate",
    );
  if (input.downloadedReceipt.objectId !== input.uploadEntity.id)
    return m9b13k2Failure(
      "reconciliation",
      "m9b13k2-object-downloaded-receipt-mismatch",
    );

  const receiptBody = {
    protocol: M9B13K2_OBJECT_PROTOCOL,
    objectId: input.uploadEntity.id,
    resource: M9B13K2_PROJECT_ID,
    provider: M9B13K2_PROVIDER,
    filename: M9B13K2_ARTIFACT_FILENAME,
    path: expectedAttributePath,
    host: providerUpload.value.hostname,
    artifactSha256: M9B13K2_ARTIFACT_SHA256,
    artifactByteLength: M9B13K2_ARTIFACT_BYTE_LENGTH,
  } as const;
  const digest = m9b13k2CanonicalDigest(receiptBody);
  return digest.ok
    ? {
        ok: true,
        value: {
          ...receiptBody,
          reconciliationDigest: m9b13k2DigestSchema.parse(digest.value),
        },
      }
    : digest;
}
