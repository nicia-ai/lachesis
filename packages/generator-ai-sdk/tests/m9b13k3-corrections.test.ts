import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  closeSyntheticM9b13k3Runtime,
  createSyntheticM9b13k3Runtime,
  dispatchSyntheticM9b13k3LoopbackConformance,
  runM9b13k3LiveController,
} from "../src/internal/m9b13k3/controller.js";
import {
  inspectM9b13k3Fd3Claim,
  launchM9b13k3SyntheticFd3FrameChild,
  syntheticM9b13k3CredentialBytes,
} from "../src/internal/m9b13k3/credential.js";
import {
  createSyntheticM9b13k3CustodianPrincipal,
  type M9b13k3RevocationVerificationRequest,
  verifySyntheticM9b13k3CustodianReceipt,
} from "../src/internal/m9b13k3/custodian.js";
import {
  inspectM9b13k3PathIdentityFeasibility,
  requireM9b13k3PathIdentityGuarantee,
} from "../src/internal/m9b13k3/path-identity.js";
import {
  deriveM9b13k3RuntimeIdentity,
  M9B13K3_ARTIFACT_SHA256,
  M9B13K3_IDENTITY_PROTOCOL,
} from "../src/internal/m9b13k3/protocol.js";
import {
  createM9b13k3LoopbackTransport,
  createM9b13k3ProductionTransportForConformanceInspection,
  type M9b13k3LoopbackTransportCapability,
  type M9b13k3TransportFault,
} from "../src/internal/m9b13k3/transport.js";
import {
  createM9b13k2TlsFixture,
  type M9b13k2TlsFixture,
} from "./m9b13k2-fixtures.js";

const fixtures: Array<M9b13k2TlsFixture> = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(async (fixture) => fixture.close()));
});

function runtimeBinding(
  custodian = createSyntheticM9b13k3CustodianPrincipal().binding,
) {
  return {
    activationIdentity: `sha256:${"a".repeat(64)}`,
    runtimeIdentity: "b".repeat(64),
    tokenId: "c".repeat(24),
    custodian,
  };
}

async function loopback(
  handler: Parameters<typeof createM9b13k2TlsFixture>[0],
  fault: M9b13k3TransportFault = "none",
): Promise<M9b13k3LoopbackTransportCapability> {
  const fixture = await createM9b13k2TlsFixture(handler);
  fixtures.push(fixture);
  const transport = createM9b13k3LoopbackTransport({
    hostname: "127.0.0.1",
    port: fixture.port,
    certificateAuthorityPem: fixture.certificatePem,
    fault,
  });
  if (!transport.ok) throw new Error(transport.error.reason);
  return transport.value;
}

describe("M9b.13k.3 append-only corrections", () => {
  it("keeps the live controller inert before capability construction", async () => {
    expect(await runM9b13k3LiveController()).toEqual({
      protocol: "lachesis-m9b13k3-corrected-concrete-runtime/1",
      decision: "m9b13k3-live-activation-unavailable",
      authorityAvailable: false,
      transportCapabilitiesCreated: 0,
      credentialReads: 0,
      ledgerAccesses: 0,
      externalEffects: "none",
    });
  });

  it("rejects production and forged transports before credential custody", () => {
    for (const transport of [
      createM9b13k3ProductionTransportForConformanceInspection(),
      Object.freeze({}),
    ]) {
      const credential = syntheticM9b13k3CredentialBytes();
      const before = credential.slice();
      expect(
        createSyntheticM9b13k3Runtime(
          transport,
          runtimeBinding(),
          credential,
          100,
          500,
        ),
      ).toMatchObject({
        ok: false,
        error: {
          reason: "m9b13k3-synthetic-runtime-requires-loopback-capability",
        },
      });
      expect(credential).toEqual(before);
    }
  });

  it("derives token URLs solely from the runtime binding", async () => {
    let requests = 0;
    const transport = await loopback((request, response) => {
      requests += 1;
      expect(request.url).toBe(`/v2/tokens/${"c".repeat(24)}/`);
      response.writeHead(204);
      response.end();
    });
    const runtime = createSyntheticM9b13k3Runtime(
      transport,
      runtimeBinding(),
      syntheticM9b13k3CredentialBytes(),
      100,
      500,
    );
    if (!runtime.ok) throw new Error(runtime.error.reason);
    expect(
      await dispatchSyntheticM9b13k3LoopbackConformance(runtime.value, {
        requestClass: "revoke-token",
        tokenId: "e".repeat(24),
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k3-request-intent-invalid-before-reservation" },
    });
    expect(requests).toBe(0);
    expect(
      await dispatchSyntheticM9b13k3LoopbackConformance(runtime.value, {
        requestClass: "revoke-token",
      }),
    ).toMatchObject({
      ok: true,
      value: {
        receipt: { tokenId: "c".repeat(24), status: 204 },
      },
    });
    expect(requests).toBe(1);
    closeSyntheticM9b13k3Runtime(runtime.value);
  });

  it("rejects caller upload bytes and dispatches only the frozen artifact", async () => {
    const digest = createHash("sha256");
    const transport = await loopback((request, response) => {
      request.on("data", (chunk: Buffer) => digest.update(chunk));
      request.on("end", () => {
        response.writeHead(201, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    const runtime = createSyntheticM9b13k3Runtime(
      transport,
      runtimeBinding(),
      syntheticM9b13k3CredentialBytes(),
      100,
      500,
    );
    if (!runtime.ok) throw new Error(runtime.error.reason);
    expect(
      await dispatchSyntheticM9b13k3LoopbackConformance(runtime.value, {
        requestClass: "upload",
        body: new Uint8Array(245).fill(0x58),
      }),
    ).toMatchObject({ ok: false });
    expect(
      await dispatchSyntheticM9b13k3LoopbackConformance(runtime.value, {
        requestClass: "upload",
      }),
    ).toMatchObject({
      ok: true,
      value: {
        receipt: { requestBodyDigest: M9B13K3_ARTIFACT_SHA256, status: 201 },
      },
    });
    expect(digest.digest("hex")).toBe(M9B13K3_ARTIFACT_SHA256);
    closeSyntheticM9b13k3Runtime(runtime.value);
  });

  it.each([
    ["request-construction-throws", false, "before-dispatch"],
    ["callback-registration-throws", false, "before-dispatch"],
    ["write-throws", true, "after-dispatch"],
    ["end-throws", true, "after-dispatch"],
  ] as const)(
    "preserves %s chronology",
    async (fault, dispatched, ambiguity) => {
      const transport = await loopback(() => undefined, fault);
      const runtime = createSyntheticM9b13k3Runtime(
        transport,
        runtimeBinding(),
        syntheticM9b13k3CredentialBytes(),
        100,
        500,
      );
      if (!runtime.ok) throw new Error(runtime.error.reason);
      const result = await dispatchSyntheticM9b13k3LoopbackConformance(
        runtime.value,
        {
          requestClass: fault === "write-throws" ? "upload" : "project-detail",
        },
      );
      expect(result).toMatchObject({
        ok: true,
        value: { receipt: { dispatched, ambiguity } },
      });
      closeSyntheticM9b13k3Runtime(runtime.value);
    },
  );

  it("rejects a receipt signed by a different synthetic principal", () => {
    const expected = createSyntheticM9b13k3CustodianPrincipal();
    const other = createSyntheticM9b13k3CustodianPrincipal();
    const request: M9b13k3RevocationVerificationRequest = {
      protocol: "lachesis-m9b13k3-revocation-verification/1",
      activationIdentity: `sha256:${"a".repeat(64)}`,
      runtimeIdentity: "b".repeat(64),
      tokenId: "c".repeat(24),
      ledgerStoreIdentity: "d".repeat(64),
      ledgerRevision: 4,
      ledgerRoot: "e".repeat(64),
      revocationRequestIndex: 1,
      revocationReceiptDigest: "f".repeat(64),
      custodian: other.binding,
      credentialIncluded: false,
    };
    const receipt = other.signReceipt(request, "revoked", 1);
    if (!receipt.ok) throw new Error(receipt.error.reason);
    expect(
      verifySyntheticM9b13k3CustodianReceipt(
        other.authority,
        expected.binding,
        request,
        receipt.value,
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k3-custodian-authority-binding-rejected" },
    });
  });

  it("binds runtime identity to an exact noncircular artifact inventory", () => {
    const inventory = {
      protocol: M9B13K3_IDENTITY_PROTOCOL,
      entries: [
        {
          kind: "source" as const,
          path: "src/controller.ts",
          byteLength: 10,
          sha256: "a".repeat(64),
        },
        {
          kind: "javascript" as const,
          path: "dist/controller.js",
          byteLength: 9,
          sha256: "b".repeat(64),
        },
      ],
    };
    const first = deriveM9b13k3RuntimeIdentity(inventory);
    const reordered = deriveM9b13k3RuntimeIdentity({
      ...inventory,
      entries: inventory.entries.toReversed(),
    });
    const mutated = deriveM9b13k3RuntimeIdentity({
      ...inventory,
      entries: [{ ...inventory.entries[0], sha256: "c".repeat(64) }],
    });
    expect(first.ok && reordered.ok && mutated.ok).toBe(true);
    if (!first.ok || !reordered.ok || !mutated.ok) return;
    expect(reordered.value.identity).toBe(first.value.identity);
    expect(mutated.value.identity).not.toBe(first.value.identity);
    expect(
      deriveM9b13k3RuntimeIdentity({
        ...inventory,
        entries: [inventory.entries[0], inventory.entries[0]],
      }),
    ).toMatchObject({ ok: false });
  });

  it("states honestly that FD4 authenticates framing but not launcher identity", async () => {
    expect(inspectM9b13k3Fd3Claim()).toEqual({
      proves: "synthetic-frame-consistency-only",
      provesLauncherIdentity: false,
      authenticatedOwnershipRequiresFutureActivation: true,
    });
    const result = await launchM9b13k3SyntheticFd3FrameChild(
      syntheticM9b13k3CredentialBytes(),
      "none",
      500,
    );
    expect(result).toMatchObject({
      timedOut: false,
      launcherIdentityAuthenticated: false,
      childOutcome: {
        terminalState: "synthetic-frame-accepted",
        frameConsistencyProven: true,
        launcherIdentityAuthenticated: false,
      },
    });
  });

  it("returns NO-GO instead of overstating pathname-to-SQLite identity", () => {
    expect(inspectM9b13k3PathIdentityFeasibility()).toEqual({
      protocol: "lachesis-m9b13k3-path-identity-feasibility/1",
      descriptorRelativeSqliteOpen: false,
      auditToOpenIdentityPinned: false,
      decision: "m9b13k3-path-identity-no-go",
      reason: "node-database-sync-accepts-pathnames-not-open-descriptors",
    });
    expect(requireM9b13k3PathIdentityGuarantee()).toMatchObject({
      ok: false,
      error: {
        reason: "m9b13k3-path-identity-unavailable-with-node-database-sync",
      },
    });
  });
});
