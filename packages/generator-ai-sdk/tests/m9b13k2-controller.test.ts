import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendM9b13k2IndependentCustodianReceipt,
  closeSyntheticM9b13k2ConcreteRuntime,
  createSyntheticM9b13k2ConcreteRuntime,
  dispatchSyntheticM9b13k2ConcreteRequest,
  inspectM9b13k2ProspectiveActivation,
  inspectM9b13k2RestartState,
  M9B13K2_RUNTIME_IMPLEMENTATION_IDENTITY,
  type M9b13k2RuntimeBinding,
  runM9b13k2LiveController,
} from "../src/internal/m9b13k2/controller.js";
import { syntheticM9b13k2CredentialBytes } from "../src/internal/m9b13k2/credential.js";
import {
  createM9b13k2CustodianAuthority,
  createSyntheticM9b13k2CustodianPrincipal,
  verifyM9b13k2CustodianReceipt,
} from "../src/internal/m9b13k2/custodian.js";
import {
  auditM9b13k2FilesystemLedger,
  createM9b13k2FilesystemLedger,
  type M9b13k2FilesystemLedger,
  snapshotM9b13k2FilesystemLedger,
} from "../src/internal/m9b13k2/ledger.js";
import {
  M9B13K2_RUNTIME_PROTOCOL,
  M9B13K2_SYNTHETIC_PROTOCOL,
  m9b13k2DomainDigest,
} from "../src/internal/m9b13k2/protocol.js";
import {
  createM9b13k2LoopbackHttpsTransport,
  dispatchM9b13k2HttpsRequest,
  type M9b13k2HttpsTransport,
  type M9b13k2TransportRequest,
} from "../src/internal/m9b13k2/transport.js";
import {
  createM9b13k2TlsFixture,
  type M9b13k2TlsFixture,
  waitM9b13k2,
} from "./m9b13k2-fixtures.js";

const activationIdentity = `sha256:${"a".repeat(64)}`;
const requestIdentity = `sha256:${"b".repeat(64)}`;
const tokenId = "c".repeat(24);
const custodianIdentityPlaceholder = `sha256:${"d".repeat(64)}`;
const roots: Array<string> = [];
const fixtures: Array<M9b13k2TlsFixture> = [];

afterEach(async () => {
  await Promise.all([
    ...fixtures.splice(0).map(async (fixture) => fixture.close()),
    ...roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  ]);
});

function runtimeBinding(
  custodianIdentity = custodianIdentityPlaceholder,
): M9b13k2RuntimeBinding {
  return {
    activationIdentity,
    requestIdentity,
    campaignIdentity: `sha256:${m9b13k2DomainDigest(
      M9B13K2_RUNTIME_PROTOCOL,
      "campaign",
      activationIdentity,
      requestIdentity,
    )}`,
    tokenId,
    custodianIdentity,
  };
}

async function createLedger(): Promise<M9b13k2FilesystemLedger> {
  const root = await mkdtemp(join(tmpdir(), "lachesis-m9b13k2-controller-"));
  roots.push(root);
  const created = await createM9b13k2FilesystemLedger(
    join(root, "ledger"),
    activationIdentity,
    M9B13K2_RUNTIME_IMPLEMENTATION_IDENTITY,
  );
  if (!created.ok) throw new Error(created.error.reason);
  return created.value.ledger;
}

async function transportFor(
  handler: Parameters<typeof createM9b13k2TlsFixture>[0],
): Promise<M9b13k2HttpsTransport> {
  const fixture = await createM9b13k2TlsFixture(handler);
  fixtures.push(fixture);
  const transport = createM9b13k2LoopbackHttpsTransport({
    hostname: "127.0.0.1",
    port: fixture.port,
    certificateAuthorityPem: fixture.certificatePem,
  });
  if (!transport.ok) throw new Error(transport.error.reason);
  return transport.value;
}

function projectRequest(): M9b13k2TransportRequest {
  return {
    requestClass: "project-detail",
    method: "GET",
    logicalUrl: new URL("https://api.osf.io/v2/nodes/bmsda/"),
    tokenId,
    pathClass: "/v2/nodes/<project>/",
    body: null,
    maximumResponseBytes: 1024,
    timeoutMs: 100,
  };
}

function revocationRequest(): M9b13k2TransportRequest {
  return {
    requestClass: "revoke-token",
    method: "DELETE",
    logicalUrl: new URL(`https://api.osf.io/v2/tokens/${tokenId}/`),
    tokenId,
    pathClass: "/v2/tokens/<token-id>/",
    body: null,
    maximumResponseBytes: 1024,
    timeoutMs: 100,
  };
}

describe("M9b.13k.2 activation and concrete controller", () => {
  it("keeps the live entry inert before every local or external effect", async () => {
    expect(runM9b13k2LiveController).toHaveLength(0);
    await expect(runM9b13k2LiveController()).resolves.toEqual({
      protocol: M9B13K2_RUNTIME_PROTOCOL,
      decision: "m9b13k2-live-activation-unavailable",
      authorityAvailable: false,
      structuralInputAccepted: false,
      credentialReads: 0,
      ledgerAccesses: 0,
      transportDispatches: 0,
      custodianInvocations: 0,
      externalEffects: "none",
    });
  });

  it("keeps even structurally valid prospective JSON nonauthoritative", () => {
    const candidate = {
      protocol: "lachesis-m9b13k2-checksum-bound-activation-capsule/1",
      runtimeProtocol: M9B13K2_RUNTIME_PROTOCOL,
      reviewedCommit: "1".repeat(64),
      reviewedTree: "2".repeat(64),
      packageManifestSha256: "3".repeat(64),
      controllerImplementationSha256: "4".repeat(64),
      launcherImplementationSha256: "5".repeat(64),
      ledgerImplementationSha256: "6".repeat(64),
      transportImplementationSha256: "7".repeat(64),
      activationIdentity,
      requestIdentity,
      ledgerNamespaceCommitment: `sha256:${"8".repeat(64)}`,
      ledgerStoreIdentity: "9".repeat(64),
      ledgerInitialRoot: "a".repeat(64),
      projectId: "bmsda",
      draftId: "6a7619b506a607fe5f63a77d",
      provider: "osfstorage",
      artifactIdentity: "1fbd9e013ac05f53c411b9e98f507d12",
      artifactFilename:
        "OSF-PAT-WATERBUTLER-CANARY-1fbd9e013ac05f53c411b9e98f507d12.txt",
      artifactSha256:
        "4ee4d970eb65bb9b8e525618ba19d4ee28dd2c1a1d0730bd9c4f3ff016134994",
      artifactByteLength: 245,
      tokenId,
      custodianIdentity: custodianIdentityPlaceholder,
      limits: {
        maximumHttpRequests: 18,
        maximumPutDispatches: 1,
        maximumRevocationDispatches: 1,
        maximumRequestBodyBytes: 245,
        apiResponseMaximumBytes: 262144,
        uploadResponseMaximumBytes: 65536,
        perRequestTimeoutMs: 10000,
        controllerDeadlineMs: 120000,
        revocationDeadlineMs: 15000,
        retries: 0,
        concurrency: 1,
        redirectPolicy: "error",
      },
      ceremonyRequiresIndependentAuthorization: true,
      revocationRequiresIndependentReceipt: true,
    };
    expect(inspectM9b13k2ProspectiveActivation(candidate)).toEqual({
      protocol: "lachesis-m9b13k2-checksum-bound-activation-capsule/1",
      structurallyValid: true,
      authorityAvailable: false,
      effectAdmission: "denied",
    });
    expect(
      inspectM9b13k2ProspectiveActivation({
        ...candidate,
        ledgerNamespaceCommitment: "caller-selected",
      }),
    ).toMatchObject({ structurallyValid: false, authorityAvailable: false });
  });

  it("rejects malformed, mismatched, non-synthetic, and restart runtime admission", async () => {
    const transport = createM9b13k2LoopbackHttpsTransport({
      hostname: "127.0.0.1",
      port: 1,
      certificateAuthorityPem: "unused-admission-certificate",
    });
    if (!transport.ok) throw new Error(transport.error.reason);
    const deadlineProfile = {
      protocol: M9B13K2_SYNTHETIC_PROTOCOL,
      requestTimeoutMs: 100,
      controllerDeadlineMs: 500,
      revocationDeadlineMs: 200,
    };
    const malformedLedger = await createLedger();
    expect(
      await createSyntheticM9b13k2ConcreteRuntime(
        malformedLedger,
        transport.value,
        {},
        syntheticM9b13k2CredentialBytes(),
        deadlineProfile,
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-synthetic-runtime-binding-invalid" },
    });

    const campaignLedger = await createLedger();
    expect(
      await createSyntheticM9b13k2ConcreteRuntime(
        campaignLedger,
        transport.value,
        { ...runtimeBinding(), campaignIdentity: `sha256:${"f".repeat(64)}` },
        syntheticM9b13k2CredentialBytes(),
        deadlineProfile,
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-synthetic-campaign-binding-invalid" },
    });

    const credentialLedger = await createLedger();
    expect(
      await createSyntheticM9b13k2ConcreteRuntime(
        credentialLedger,
        transport.value,
        runtimeBinding(),
        new TextEncoder().encode("Z".repeat(64)),
        deadlineProfile,
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-synthetic-non-osf-credential-required" },
    });

    const restartLedger = await createLedger();
    const first = await createSyntheticM9b13k2ConcreteRuntime(
      restartLedger,
      transport.value,
      runtimeBinding(),
      syntheticM9b13k2CredentialBytes(),
      deadlineProfile,
    );
    if (!first.ok) throw new Error(first.error.reason);
    closeSyntheticM9b13k2ConcreteRuntime(first.value);
    expect(
      await createSyntheticM9b13k2ConcreteRuntime(
        restartLedger,
        transport.value,
        runtimeBinding(),
        syntheticM9b13k2CredentialBytes(),
        deadlineProfile,
      ),
    ).toMatchObject({
      ok: false,
      error: {
        reason: "m9b13k2-restart-forbids-new-credential-session",
        ambiguous: true,
      },
    });
  });

  it("runs a concrete request through durable reserve/dispatch/receipt", async () => {
    const ledger = await createLedger();
    let requests = 0;
    const transport = await transportFor((_request, response) => {
      requests += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    const credential = syntheticM9b13k2CredentialBytes();
    const runtime = await createSyntheticM9b13k2ConcreteRuntime(
      ledger,
      transport,
      runtimeBinding(),
      credential,
      {
        protocol: M9B13K2_SYNTHETIC_PROTOCOL,
        requestTimeoutMs: 100,
        controllerDeadlineMs: 500,
        revocationDeadlineMs: 200,
      },
    );
    expect(Array.from(credential).every((byte) => byte === 0)).toBe(true);
    if (!runtime.ok) throw new Error(runtime.error.reason);
    const outcome = await dispatchSyntheticM9b13k2ConcreteRequest(
      runtime.value,
      projectRequest(),
    );
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        terminalState: "request-recorded",
        cumulativeHttpRequests: 1,
        transportReceipt: { dispatched: true, status: 200 },
      },
    });
    expect(requests).toBe(1);
    expect(await auditM9b13k2FilesystemLedger(ledger)).toMatchObject({
      ok: true,
      value: {
        cumulativeHttpRequests: 1,
        revision: 4,
      },
    });
    expect(closeSyntheticM9b13k2ConcreteRuntime(runtime.value)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("durably reserves but does not fabricate dispatch during transport contention", async () => {
    const ledger = await createLedger();
    const transport = await transportFor(() => {
      // Keep the direct conformance dispatch in flight.
    });
    const runtime = await createSyntheticM9b13k2ConcreteRuntime(
      ledger,
      transport,
      runtimeBinding(),
      syntheticM9b13k2CredentialBytes(),
      {
        protocol: M9B13K2_SYNTHETIC_PROTOCOL,
        requestTimeoutMs: 100,
        controllerDeadlineMs: 500,
        revocationDeadlineMs: 200,
      },
    );
    if (!runtime.ok) throw new Error(runtime.error.reason);
    const blockerController = new AbortController();
    const blocker = dispatchM9b13k2HttpsRequest(
      transport,
      projectRequest(),
      syntheticM9b13k2CredentialBytes(),
      blockerController.signal,
    );
    await waitM9b13k2(10);
    const result = await dispatchSyntheticM9b13k2ConcreteRequest(
      runtime.value,
      projectRequest(),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        terminalState: "request-reserved-not-dispatched",
        ledgerRevision: 2,
        cumulativeHttpRequests: 1,
        transportReceipt: {
          dispatched: false,
          outcome: "concurrent-dispatch-rejected",
        },
      },
    });
    blockerController.abort();
    await blocker;
    closeSyntheticM9b13k2ConcreteRuntime(runtime.value);
  });

  it("enforces the durable campaign request ceiling without resetting on replay", async () => {
    const ledger = await createLedger();
    const transport = await transportFor(() => {
      // Hold the only transport slot while reservations reach their ceiling.
    });
    const runtime = await createSyntheticM9b13k2ConcreteRuntime(
      ledger,
      transport,
      runtimeBinding(),
      syntheticM9b13k2CredentialBytes(),
      {
        protocol: M9B13K2_SYNTHETIC_PROTOCOL,
        requestTimeoutMs: 500,
        controllerDeadlineMs: 5_000,
        revocationDeadlineMs: 200,
      },
    );
    if (!runtime.ok) throw new Error(runtime.error.reason);
    const blockerController = new AbortController();
    const blocker = dispatchM9b13k2HttpsRequest(
      transport,
      { ...projectRequest(), timeoutMs: 2_000 },
      syntheticM9b13k2CredentialBytes(),
      blockerController.signal,
    );
    await waitM9b13k2(10);
    for (let requestIndex = 1; requestIndex <= 18; requestIndex += 1)
      expect(
        await dispatchSyntheticM9b13k2ConcreteRequest(
          runtime.value,
          projectRequest(),
        ),
      ).toMatchObject({
        ok: true,
        value: {
          terminalState: "request-reserved-not-dispatched",
          cumulativeHttpRequests: requestIndex,
        },
      });
    expect(
      await dispatchSyntheticM9b13k2ConcreteRequest(
        runtime.value,
        projectRequest(),
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-campaign-request-budget-exhausted" },
    });
    blockerController.abort();
    await blocker;
    closeSyntheticM9b13k2ConcreteRuntime(runtime.value);
  });

  it.each([
    ["revoked", "revoked-and-independently-verified"],
    ["active", "custodian-reports-active"],
    ["ambiguous", "custodian-verification-ambiguous"],
  ] as const)(
    "keeps revocation two-phase and appends the independent %s result",
    async (custodianResult, expectedTerminal) => {
      const principal = createSyntheticM9b13k2CustodianPrincipal();
      if (!principal.ok) throw new Error(principal.error.reason);
      const ledger = await createLedger();
      const transport = await transportFor((_request, response) => {
        response.writeHead(204);
        response.end();
      });
      const runtime = await createSyntheticM9b13k2ConcreteRuntime(
        ledger,
        transport,
        runtimeBinding(principal.value.custodianIdentity),
        syntheticM9b13k2CredentialBytes(),
        {
          protocol: M9B13K2_SYNTHETIC_PROTOCOL,
          requestTimeoutMs: 100,
          controllerDeadlineMs: 20,
          revocationDeadlineMs: 200,
        },
      );
      if (!runtime.ok) throw new Error(runtime.error.reason);
      await waitM9b13k2(30);
      const mainRequest = await dispatchSyntheticM9b13k2ConcreteRequest(
        runtime.value,
        projectRequest(),
      );
      expect(mainRequest).toMatchObject({
        ok: false,
        error: { reason: "m9b13k2-controller-deadline-before-reservation" },
      });
      const effectPhase = await dispatchSyntheticM9b13k2ConcreteRequest(
        runtime.value,
        revocationRequest(),
      );
      expect(effectPhase).toMatchObject({
        ok: true,
        value: {
          terminalState: "awaiting-independent-revocation-verification",
          cumulativeHttpRequests: 1,
          revocationReservations: 1,
          revocationDispatches: 1,
        },
      });
      if (!effectPhase.ok || effectPhase.value.verificationRequest === null)
        throw new Error("Revocation verification request missing.");
      expect(effectPhase.value.verificationRequest.credentialIncluded).toBe(
        false,
      );
      const signed = principal.value.signReceipt(
        effectPhase.value.verificationRequest,
        custodianResult,
        1,
      );
      if (!signed.ok) throw new Error(signed.error.reason);
      const independent = await appendM9b13k2IndependentCustodianReceipt(
        ledger,
        principal.value.authority,
        effectPhase.value.verificationRequest,
        signed.value,
      );
      expect(independent).toMatchObject({
        ok: true,
        value: {
          terminalState: expectedTerminal,
          result: custodianResult,
          effectControllerCredentialAvailable: false,
        },
      });
      const snapshot = await snapshotM9b13k2FilesystemLedger(ledger);
      if (!snapshot.ok) throw new Error(snapshot.error.reason);
      expect(snapshot.value).toMatchObject({
        cumulativeHttpRequests: 1,
        revocationReservations: 1,
        revocationDispatches: 1,
      });
      expect(inspectM9b13k2RestartState(snapshot.value)).toMatchObject({
        state: "terminal-state",
        credentialReadPermitted: false,
      });
      await expect(
        dispatchSyntheticM9b13k2ConcreteRequest(
          runtime.value,
          projectRequest(),
        ),
      ).resolves.toMatchObject({ ok: false });
    },
  );

  it("closes credential custody after ambiguous revocation dispatch", async () => {
    const ledger = await createLedger();
    const transport = await transportFor(() => {
      // Force the concrete request timer to destroy this dispatch.
    });
    const runtime = await createSyntheticM9b13k2ConcreteRuntime(
      ledger,
      transport,
      runtimeBinding(),
      syntheticM9b13k2CredentialBytes(),
      {
        protocol: M9B13K2_SYNTHETIC_PROTOCOL,
        requestTimeoutMs: 25,
        controllerDeadlineMs: 500,
        revocationDeadlineMs: 100,
      },
    );
    if (!runtime.ok) throw new Error(runtime.error.reason);
    const result = await dispatchSyntheticM9b13k2ConcreteRequest(
      runtime.value,
      revocationRequest(),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        terminalState: "request-dispatch-ambiguous",
        verificationRequest: null,
      },
    });
    await expect(
      dispatchSyntheticM9b13k2ConcreteRequest(runtime.value, projectRequest()),
    ).resolves.toMatchObject({ ok: false });
  });

  it("gives revocation its own deadline and closes custody when it expires", async () => {
    const ledger = await createLedger();
    const transport = await transportFor(() => {
      // Let the independent revocation timer abort this request.
    });
    const runtime = await createSyntheticM9b13k2ConcreteRuntime(
      ledger,
      transport,
      runtimeBinding(),
      syntheticM9b13k2CredentialBytes(),
      {
        protocol: M9B13K2_SYNTHETIC_PROTOCOL,
        requestTimeoutMs: 100,
        controllerDeadlineMs: 500,
        revocationDeadlineMs: 20,
      },
    );
    if (!runtime.ok) throw new Error(runtime.error.reason);
    expect(
      await dispatchSyntheticM9b13k2ConcreteRequest(
        runtime.value,
        revocationRequest(),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        terminalState: "request-dispatch-ambiguous",
        transportReceipt: {
          outcome: "controller-aborted",
          socketDestroyed: true,
        },
      },
    });
    await expect(
      dispatchSyntheticM9b13k2ConcreteRequest(runtime.value, projectRequest()),
    ).resolves.toMatchObject({ ok: false });
  });

  it("rejects a signed receipt after any bound request mutation", () => {
    const principal = createSyntheticM9b13k2CustodianPrincipal();
    if (!principal.ok) throw new Error(principal.error.reason);
    const request = {
      protocol: "lachesis-m9b13k2-two-phase-revocation/1" as const,
      activationIdentity,
      requestIdentity,
      tokenId,
      ledgerStoreIdentity: "1".repeat(64),
      ledgerRevision: 7,
      ledgerRoot: "2".repeat(64),
      revocationRequestIndex: 1,
      revocationReceiptDigest: "3".repeat(64),
      credentialIncluded: false as const,
    };
    const receipt = principal.value.signReceipt(request, "revoked", 1);
    if (!receipt.ok) throw new Error(receipt.error.reason);
    expect(
      principal.value.signReceipt(
        { ...request, tokenId: "invalid" },
        "revoked",
        1,
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-custodian-request-invalid" },
    });
    expect(principal.value.signReceipt(request, "revoked", -1)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-custodian-receipt-body-invalid" },
    });
    expect(
      verifyM9b13k2CustodianReceipt(
        principal.value.authority,
        request,
        receipt.value,
      ),
    ).toEqual({ ok: true, value: receipt.value });
    expect(
      verifyM9b13k2CustodianReceipt(
        principal.value.authority,
        { ...request, ledgerRoot: "4".repeat(64) },
        receipt.value,
      ),
    ).toMatchObject({ ok: false });
    expect(
      verifyM9b13k2CustodianReceipt(principal.value.authority, request, {
        ...receipt.value,
        result: "active",
      }),
    ).toMatchObject({ ok: false });
    const firstSignatureCharacter = receipt.value.signatureBase64Url.at(0);
    const signatureMutation = `${firstSignatureCharacter === "A" ? "B" : "A"}${receipt.value.signatureBase64Url.slice(1)}`;
    expect(
      verifyM9b13k2CustodianReceipt(principal.value.authority, request, {
        ...receipt.value,
        signatureBase64Url: signatureMutation,
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-custodian-signature-invalid" },
    });
    expect(
      verifyM9b13k2CustodianReceipt(principal.value.authority, request, {
        ...receipt.value,
        signatureBase64Url: "",
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-custodian-verification-envelope-invalid" },
    });
  });

  it("rejects malformed and ledger-mismatched independent receipt phases", async () => {
    const principal = createSyntheticM9b13k2CustodianPrincipal();
    if (!principal.ok) throw new Error(principal.error.reason);
    const ledger = await createLedger();
    expect(
      await appendM9b13k2IndependentCustodianReceipt(
        ledger,
        principal.value.authority,
        {},
        {},
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-independent-receipt-envelope-invalid" },
    });
    const request = {
      protocol: "lachesis-m9b13k2-two-phase-revocation/1" as const,
      activationIdentity,
      requestIdentity,
      tokenId,
      ledgerStoreIdentity: "1".repeat(64),
      ledgerRevision: 7,
      ledgerRoot: "2".repeat(64),
      revocationRequestIndex: 1,
      revocationReceiptDigest: "3".repeat(64),
      credentialIncluded: false as const,
    };
    const receipt = principal.value.signReceipt(request, "revoked", 1);
    if (!receipt.ok) throw new Error(receipt.error.reason);
    expect(
      await appendM9b13k2IndependentCustodianReceipt(
        ledger,
        principal.value.authority,
        request,
        receipt.value,
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-independent-receipt-ledger-binding-invalid" },
    });
  });

  it("constructs only bound Ed25519 production custodian authorities", () => {
    const identity = `sha256:${"e".repeat(64)}`;
    const ed25519 = generateKeyPairSync("ed25519").publicKey.export({
      type: "spki",
      format: "pem",
    });
    if (typeof ed25519 !== "string")
      throw new Error("Ed25519 public key PEM was not textual.");
    expect(createM9b13k2CustodianAuthority(ed25519, identity)).toMatchObject({
      ok: true,
    });
    const rsa = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }).publicKey.export({ type: "spki", format: "pem" });
    if (typeof rsa !== "string")
      throw new Error("RSA public key PEM was not textual.");
    expect(createM9b13k2CustodianAuthority(rsa, identity)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-custodian-authority-invalid" },
    });
    expect(
      createM9b13k2CustodianAuthority("not-a-public-key", identity),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-custodian-public-key-invalid" },
    });
  });
});
