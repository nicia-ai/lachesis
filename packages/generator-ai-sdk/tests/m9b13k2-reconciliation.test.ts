import { describe, expect, it } from "vitest";

import {
  M9B13K2_ARTIFACT_BYTE_LENGTH,
  M9B13K2_ARTIFACT_FILENAME,
  M9B13K2_ARTIFACT_SHA256,
  M9B13K2_PROJECT_ID,
  M9B13K2_PROVIDER,
} from "../src/internal/m9b13k2/protocol.js";
import {
  type M9b13k2ObjectReconciliationInput,
  reconcileM9b13k2StableObject,
} from "../src/internal/m9b13k2/reconciliation.js";

function validInput(): M9b13k2ObjectReconciliationInput {
  const objectId = "file-identity";
  const uploadUrl =
    "https://files.osf.io/v1/resources/bmsda/providers/osfstorage/";
  const identity = {
    id: objectId,
    type: "files" as const,
    name: M9B13K2_ARTIFACT_FILENAME,
    path: `/${objectId}`,
    resource: M9B13K2_PROJECT_ID,
    provider: M9B13K2_PROVIDER,
  };
  return {
    providerRoot: {
      resource: M9B13K2_PROJECT_ID,
      provider: M9B13K2_PROVIDER,
      uploadUrl,
    },
    putUrl: `${uploadUrl}?kind=file&name=${M9B13K2_ARTIFACT_FILENAME}`,
    uploadEntity: {
      ...identity,
      downloadUrl: `${uploadUrl}${objectId}`,
    },
    postUploadInventory: [identity],
    actualDownloadUrl: `${uploadUrl}${objectId}`,
    downloadedReceipt: {
      objectId,
      resource: M9B13K2_PROJECT_ID,
      provider: M9B13K2_PROVIDER,
      byteLength: M9B13K2_ARTIFACT_BYTE_LENGTH,
      sha256: M9B13K2_ARTIFACT_SHA256,
    },
  };
}

describe("M9b.13k.2 stable Waterbutler object reconciliation", () => {
  it("binds one exact identity through upload, inventory, download and bytes", () => {
    expect(reconcileM9b13k2StableObject(validInput())).toMatchObject({
      ok: true,
      value: {
        objectId: "file-identity",
        path: "/file-identity",
        host: "files.osf.io",
        artifactSha256: M9B13K2_ARTIFACT_SHA256,
        artifactByteLength: M9B13K2_ARTIFACT_BYTE_LENGTH,
      },
    });
  });

  it("rejects the prior upload file-identity/download different-object case", () => {
    const input = validInput();
    expect(
      reconcileM9b13k2StableObject({
        ...input,
        actualDownloadUrl:
          "https://files.osf.io/v1/resources/bmsda/providers/osfstorage/different-object",
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-object-upload-download-mismatch" },
    });
  });

  it("rejects malformed inputs, unparsable URLs, and provider PUT drift", () => {
    expect(reconcileM9b13k2StableObject(null)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-object-input-invalid" },
    });
    const input = validInput();
    expect(
      reconcileM9b13k2StableObject({
        ...input,
        providerRoot: { ...input.providerRoot, uploadUrl: "not-a-url" },
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-object-input-invalid" },
    });
    expect(
      reconcileM9b13k2StableObject({
        ...input,
        putUrl: `${input.providerRoot.uploadUrl}?kind=file&name=wrong.txt`,
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-object-provider-put-mismatch" },
    });
  });

  it.each([
    {
      name: "same filename with another inventory ID",
      mutate: (input: M9b13k2ObjectReconciliationInput): unknown => ({
        ...input,
        postUploadInventory: [
          { ...input.postUploadInventory[0], id: "other-object" },
        ],
      }),
    },
    {
      name: "duplicate inventory objects",
      mutate: (input: M9b13k2ObjectReconciliationInput): unknown => ({
        ...input,
        postUploadInventory: [
          input.postUploadInventory[0],
          input.postUploadInventory[0],
        ],
      }),
    },
    {
      name: "encoded separator",
      mutate: (input: M9b13k2ObjectReconciliationInput): unknown => ({
        ...input,
        uploadEntity: {
          ...input.uploadEntity,
          downloadUrl:
            "https://files.osf.io/v1/resources/bmsda/providers/osfstorage/file%2Fidentity",
        },
      }),
    },
    {
      name: "normalized dot segment",
      mutate: (input: M9b13k2ObjectReconciliationInput): unknown => ({
        ...input,
        actualDownloadUrl:
          "https://files.osf.io/v1/resources/bmsda/providers/osfstorage/folder/../file-identity",
      }),
    },
    {
      name: "wrong regional host",
      mutate: (input: M9b13k2ObjectReconciliationInput): unknown => ({
        ...input,
        actualDownloadUrl:
          "https://files.eu.osf.io/v1/resources/bmsda/providers/osfstorage/file-identity",
      }),
    },
    {
      name: "alternate provider",
      mutate: (input: M9b13k2ObjectReconciliationInput): unknown => ({
        ...input,
        actualDownloadUrl:
          "https://files.osf.io/v1/resources/bmsda/providers/dropbox/file-identity",
      }),
    },
    {
      name: "path and ID disagreement",
      mutate: (input: M9b13k2ObjectReconciliationInput): unknown => ({
        ...input,
        uploadEntity: { ...input.uploadEntity, path: "/other-object" },
      }),
    },
    {
      name: "downloaded receipt object disagreement",
      mutate: (input: M9b13k2ObjectReconciliationInput): unknown => ({
        ...input,
        downloadedReceipt: {
          ...input.downloadedReceipt,
          objectId: "other-object",
        },
      }),
    },
  ])("rejects $name", ({ mutate }) => {
    expect(reconcileM9b13k2StableObject(mutate(validInput()))).toMatchObject({
      ok: false,
    });
  });
});
