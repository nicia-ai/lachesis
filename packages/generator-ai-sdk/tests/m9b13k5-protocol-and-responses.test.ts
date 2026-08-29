import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  copyM9b13k5SyntheticArtifact,
  deriveM9b13k5ActivationIdentity,
  deriveM9b13k5ProtocolIdentity,
  M9B13K5_ACCEPTED_LEDGER_IDENTITY,
  M9B13K5_ACTIVATION_PROTOCOL,
  M9B13K5_ARTIFACT_FILENAME,
  M9B13K5_ARTIFACT_IDENTITY,
  M9B13K5_ARTIFACT_SHA256,
  M9B13K5_DRAFT_ID,
  M9B13K5_LIMITS,
  M9B13K5_PRODUCTION_HELPER_IDENTITY,
  M9B13K5_PROJECT_ID,
  M9B13K5_PROVIDER,
  M9B13K5_PUT_REQUEST_DIGEST,
  M9B13K5_RECONCILIATION_PROTOCOL,
  type M9b13k5ActivationCandidate,
} from "../src/internal/m9b13k5/protocol.js";
import {
  M9B13K5_RESPONSE_KINDS,
  parseM9b13k5BoundedResponse,
  reconcileM9b13k5StableObject,
} from "../src/internal/m9b13k5/response-schemas.js";
import { deriveM9b13k5StateModelIdentity } from "../src/internal/m9b13k5/state-model.js";

const digest = (marker: string): string =>
  createHash("sha256").update(marker).digest("hex");

function candidate(): M9b13k5ActivationCandidate {
  return {
    protocol: M9B13K5_ACTIVATION_PROTOCOL,
    reviewedIntegrationCommit: "1".repeat(40),
    reviewedIntegrationTree: "2".repeat(40),
    controllerImplementationIdentity: digest("controller"),
    ledgerImplementationIdentity: M9B13K5_ACCEPTED_LEDGER_IDENTITY,
    productionHelperIdentity: M9B13K5_PRODUCTION_HELPER_IDENTITY,
    launcherIdentity: digest("launcher"),
    productionTransportIdentity: digest("production-transport"),
    rawResponseParserIdentity: digest("response-parser"),
    reconciliationIdentity: digest("reconciliation"),
    requestSequenceIdentity: digest("request-sequence"),
    custodianPublicKey: "synthetic-public-key",
    custodianFingerprint: digest("custodian-fingerprint"),
    custodianIdentity: digest("custodian"),
    ledgerNamespaceCommitment: digest("namespace"),
    ledgerStoreIdentity: digest("store"),
    ledgerInitialRoot: digest("initial-root"),
    requestIdentity: "synthetic-request-1",
    campaignIdentity: "synthetic-campaign-1",
    tokenId: "synthetic-token-1",
    projectId: M9B13K5_PROJECT_ID,
    draftId: M9B13K5_DRAFT_ID,
    provider: M9B13K5_PROVIDER,
    artifactFilename: M9B13K5_ARTIFACT_FILENAME,
    artifactByteLength: M9B13K5_LIMITS.requestBodyBytes,
    artifactSha256: M9B13K5_ARTIFACT_SHA256,
    artifactIdentity: M9B13K5_ARTIFACT_IDENTITY,
    putRequestDigest: M9B13K5_PUT_REQUEST_DIGEST,
    limits: M9B13K5_LIMITS,
    ceremonyProtocol: "m9b13k5-future-pat-ceremony/1",
    revocationProtocol: "m9b13k5-two-phase-revocation/1",
  };
}

function raw(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

const responseFixtures: Readonly<
  Record<(typeof M9B13K5_RESPONSE_KINDS)[number], unknown>
> = {
  "token-detail": { id: "synthetic-token-1", active: true, scopes: ["write"] },
  project: {
    id: M9B13K5_PROJECT_ID,
    title: "Synthetic project",
    currentUserCanWrite: true,
  },
  "registrations-page": { data: [], links: { next: null } },
  "view-only-links-page": { data: [], links: { next: null } },
  "storage-inventory": { provider: M9B13K5_PROVIDER, files: [] },
  "provider-root": {
    provider: M9B13K5_PROVIDER,
    upload: { href: "https://files.osf.io/upload/root" },
  },
  upload: {
    file: {
      id: "file-identity",
      name: M9B13K5_ARTIFACT_FILENAME,
      path: "/proof",
      provider: M9B13K5_PROVIDER,
      size: M9B13K5_LIMITS.requestBodyBytes,
      sha256: M9B13K5_ARTIFACT_SHA256,
      links: {
        download: { href: "https://files.osf.io/download/file-identity" },
      },
    },
  },
  "post-upload-inventory": { provider: M9B13K5_PROVIDER, files: [] },
  revocation: { tokenId: "synthetic-token-1", revoked: true },
  "download-metadata": {
    fileId: "file-identity",
    path: "/proof",
    byteLength: M9B13K5_LIMITS.requestBodyBytes,
    sha256: M9B13K5_ARTIFACT_SHA256,
  },
};

function stableEvidence() {
  return {
    protocol: M9B13K5_RECONCILIATION_PROTOCOL,
    providerRootUploadHref: "https://files.osf.io/upload/root",
    putHref: "https://files.osf.io/upload/root",
    uploadFileId: "file-identity",
    uploadPath: "/proof",
    uploadName: M9B13K5_ARTIFACT_FILENAME,
    uploadSha256: M9B13K5_ARTIFACT_SHA256,
    inventoryFileId: "file-identity",
    inventoryPath: "/proof",
    inventoryDownloadHref: "https://files.osf.io/download/file-identity",
    parsedDownloadFileId: "file-identity",
    parsedDownloadPath: "/proof",
    downloadedByteLength: M9B13K5_LIMITS.requestBodyBytes,
    downloadedSha256: M9B13K5_ARTIFACT_SHA256,
  };
}

describe("M9b.13k.5 protocols and bounded raw responses", () => {
  it("freezes an owned 245-byte artifact and detects replacement", () => {
    const first = copyM9b13k5SyntheticArtifact();
    const second = copyM9b13k5SyntheticArtifact();
    expect(first).toHaveLength(245);
    expect(createHash("sha256").update(first).digest("hex")).toBe(
      M9B13K5_ARTIFACT_SHA256,
    );
    const firstByte = first.at(0);
    if (firstByte === undefined) throw new Error("artifact unexpectedly empty");
    first[0] = firstByte ^ 1;
    expect(first).not.toEqual(second);
    expect(createHash("sha256").update(first).digest("hex")).not.toBe(
      M9B13K5_ARTIFACT_SHA256,
    );
  });

  it("derives deterministic noncircular activation and protocol identities", () => {
    const first = deriveM9b13k5ActivationIdentity(candidate());
    const second = deriveM9b13k5ActivationIdentity(candidate());
    expect(first).toEqual(second);
    expect(first.ok && first.value.activationIdentity).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(deriveM9b13k5ProtocolIdentity()).toMatch(/^[a-f0-9]{64}$/u);
    expect(deriveM9b13k5StateModelIdentity()).toMatch(/^[a-f0-9]{64}$/u);
    expect(deriveM9b13k5StateModelIdentity()).toBe(
      deriveM9b13k5StateModelIdentity(),
    );
    expect(deriveM9b13k5ActivationIdentity({})).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-activation-candidate-invalid" },
    });
  });

  it("binds every activation field mutation", () => {
    const original = candidate();
    const baseline = deriveM9b13k5ActivationIdentity(original);
    if (!baseline.ok) throw new Error(baseline.error.reason);
    const mutations: ReadonlyArray<unknown> = [
      { ...original, reviewedIntegrationCommit: "3".repeat(40) },
      { ...original, reviewedIntegrationTree: "4".repeat(40) },
      { ...original, controllerImplementationIdentity: digest("changed") },
      { ...original, launcherIdentity: digest("changed-launcher") },
      { ...original, productionTransportIdentity: digest("changed-transport") },
      { ...original, rawResponseParserIdentity: digest("changed-parser") },
      { ...original, reconciliationIdentity: digest("changed-reconcile") },
      { ...original, requestSequenceIdentity: digest("changed-sequence") },
      { ...original, custodianPublicKey: "different-key" },
      { ...original, custodianFingerprint: digest("different-fingerprint") },
      { ...original, custodianIdentity: digest("different-custodian") },
      { ...original, ledgerNamespaceCommitment: digest("different-namespace") },
      { ...original, ledgerStoreIdentity: digest("different-store") },
      { ...original, ledgerInitialRoot: digest("different-root") },
      { ...original, requestIdentity: "different-request" },
      { ...original, campaignIdentity: "different-campaign" },
      { ...original, tokenId: "different-token" },
      { ...original, ceremonyProtocol: "different-ceremony/1" },
      { ...original, revocationProtocol: "different-revocation/1" },
    ];
    for (const mutation of mutations) {
      const result = deriveM9b13k5ActivationIdentity(mutation);
      expect(
        !result.ok ||
          result.value.activationIdentity !== baseline.value.activationIdentity,
      ).toBe(true);
    }
  });

  it.each(M9B13K5_RESPONSE_KINDS)("parses strict bounded %s bytes", (kind) => {
    const parsed = parseM9b13k5BoundedResponse(
      kind,
      raw(responseFixtures[kind]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error.reason);
    expect(parsed.value.rawSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(parsed.value.canonicalDecisionSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects duplicate keys, hostile keys, malformed UTF-8, and oversized bytes", () => {
    expect(
      parseM9b13k5BoundedResponse(
        "token-detail",
        new TextEncoder().encode(
          '{"id":"a","id":"b","active":true,"scopes":[]}',
        ),
      ).ok,
    ).toBe(false);
    expect(
      parseM9b13k5BoundedResponse(
        "token-detail",
        new TextEncoder().encode(
          '{"id":"a","\\u0069d":"b","active":true,"scopes":[]}',
        ),
      ).ok,
    ).toBe(false);
    expect(
      parseM9b13k5BoundedResponse(
        "token-detail",
        raw({
          id: "synthetic-token-1",
          active: true,
          scopes: ["write"],
          __protoPollution: true,
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseM9b13k5BoundedResponse("token-detail", new Uint8Array([0xc3, 0x28]))
        .ok,
    ).toBe(false);
    expect(
      parseM9b13k5BoundedResponse(
        "upload",
        new Uint8Array(M9B13K5_LIMITS.uploadResponseBytes + 1),
      ).ok,
    ).toBe(false);
  });

  it.each([
    "",
    " ",
    "garbage",
    '"unterminated',
    '"\\x"',
    '"\\uZZZZ"',
    '"\\uD800"',
    '"\\uD800\\u0041"',
    '"\\uDC00"',
    "[1 2]",
    "[1,]",
    '{"id" true}',
    '{"id":true "active":true}',
    "{} trailing",
  ])("rejects malformed JSON framing vector %s", (text) => {
    expect(
      parseM9b13k5BoundedResponse(
        "token-detail",
        new TextEncoder().encode(text),
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-response-json-framing-invalid" },
    });
  });

  it.each(["null", "true", "false", "0", "-1.5e+2", '"string"', "[]", "{}"])(
    "frames valid JSON then rejects wrong schema %s",
    (text) => {
      expect(
        parseM9b13k5BoundedResponse(
          "token-detail",
          new TextEncoder().encode(text),
        ),
      ).toMatchObject({
        ok: false,
        error: { reason: "m9b13k5-response-schema-invalid" },
      });
    },
  );

  it.each([
    '{"id":"a\\n","active":true,"scopes":[]}',
    '{"id":"a\\uD83D\\uDE00","active":true,"scopes":[]}',
  ])("decodes valid escaped JSON strings %s", (text) => {
    expect(
      parseM9b13k5BoundedResponse(
        "token-detail",
        new TextEncoder().encode(text),
      ).ok,
    ).toBe(true);
  });

  it("reconciles one stable object and rejects cross-object tampering", () => {
    expect(reconcileM9b13k5StableObject(stableEvidence()).ok).toBe(true);
    expect(
      reconcileM9b13k5StableObject({
        ...stableEvidence(),
        parsedDownloadFileId: "different-object",
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5-reconciliation-object-mismatch" },
    });
    for (const [mutation, reason] of [
      [
        { ...stableEvidence(), parsedDownloadPath: "/different" },
        "m9b13k5-reconciliation-path-mismatch",
      ],
      [
        { ...stableEvidence(), putHref: "https://files.osf.io/other" },
        "m9b13k5-reconciliation-put-relation-mismatch",
      ],
      [
        {
          ...stableEvidence(),
          inventoryDownloadHref: "https://files.osf.io/download/other",
        },
        "m9b13k5-reconciliation-download-relation-mismatch",
      ],
      [{}, "m9b13k5-reconciliation-schema-invalid"],
    ] as const) {
      expect(reconcileM9b13k5StableObject(mutation)).toMatchObject({
        ok: false,
        error: { reason },
      });
    }
  });
});
