import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  accountM9b13cArchiveChunks,
  accountM9b13cResponse,
  compareM9b13cSbomInventories,
  evaluateM9b13cReadiness,
  isM9b13cPublicAddress,
  M9B13C_BYTE_LIMITS,
  M9B13C_DESTINATION,
  M9B13C_EMPTY_BYTE_STATE,
  M9B13C_QUARANTINE,
  M9B13C_ZERO_EFFECTS,
  type M9b13cGitBinding,
  type M9b13cGitObjects,
  type M9b13cNetworkAttempt,
  runM9b13cInterceptedRequests,
  validateM9b13cBearerResponse,
  validateM9b13cDestinationFixture,
  validateM9b13cEvidenceEnvelope,
  validateM9b13cGpgStatus,
  validateM9b13cNetworkAttempt,
  verifyM9b13cGitClosure,
} from "../internal/m9b13c-acquisition-boundary.js";

function expectQuarantine(result: unknown, reason: string): void {
  expect(result).toEqual({
    ok: false,
    error: {
      kind: "m9b13c-quarantine",
      disposition: M9B13C_QUARANTINE,
      reason,
    },
  });
}

const baseNetworkAttempt: M9b13cNetworkAttempt = Object.freeze({
  url: "https://registry-1.docker.io/v2/library/node/manifests/sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7",
  sni: "registry-1.docker.io",
  certificateChainValid: true,
  certificateHostnameValid: true,
  dnsAnswers: ["8.8.8.8"],
  peerAddress: "8.8.8.8",
  proxyEnvironmentKeys: [],
  systemProxyConfigured: false,
  ambientDockerPaths: [],
  ambientEnvironmentKeys: [],
  requestOrdinal: 1,
  redirectFromHost: null,
  redirectDigest: null,
});

const baseEvidence = Object.freeze({
  descriptorGraphConsistent: true,
  provenancePresent: true,
  sbomPresent: true,
  subjectExact: true,
  sourceExact: true,
  builderExact: true,
  buildTypeExact: true,
  invocationComplete: true,
  platformExact: true,
  nodeVersionExact: true,
  baseMaterialsComplete: true,
  packageInventoryConsistent: true,
  malformedOrAmbiguous: false,
  unexpectedSignature: false,
  unexpectedTransparency: false,
  unrecognizedEvidenceTypes: [],
});

const baseDestination = Object.freeze({
  destination: M9B13C_DESTINATION,
  resolvedOutsideRepository: true,
  protectedNamespaceOverlap: false,
  ancestors: [
    {
      path: "/Users/paul/orgs/nicia/lachesis-private",
      kind: "directory" as const,
      mode: 0o700,
      ownerMatches: true,
      device: "synthetic-device-a",
      inode: "synthetic-inode-a",
      mountBoundary: false,
      aliasDetected: false,
      replaced: false,
      controlledPrivateAncestor: true,
    },
  ],
  rootPreexisting: false,
  exclusiveCreateSucceeded: true,
  createdMode: 0o700,
  rootDeviceStable: true,
  rootInodeStable: true,
  concurrentCreate: false,
  crashOrInterruption: false,
  partialState: false,
  cleanupAnomaly: false,
  sealingFailure: false,
});

function gitObjectId(
  type: "blob" | "commit" | "tree",
  bytes: Uint8Array,
): string {
  return createHash("sha1")
    .update(`${type} ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function gitTreeEntry(
  mode: string,
  name: string,
  objectId: string,
): Uint8Array {
  return Buffer.concat([
    Buffer.from(`${mode} ${name}\0`, "utf8"),
    Buffer.from(objectId, "hex"),
  ]);
}

function syntheticGitFixture(finalMode = "100644"): Readonly<{
  binding: M9b13cGitBinding;
  objects: M9b13cGitObjects;
}> {
  const blob = Buffer.from("synthetic-m9b13c-git-blob\n", "utf8");
  const blobId = gitObjectId("blob", blob);
  const leafTree = gitTreeEntry(finalMode, "file.txt", blobId);
  const leafTreeId = gitObjectId("tree", leafTree);
  const rootTree = gitTreeEntry("40000", "dir", leafTreeId);
  const rootTreeId = gitObjectId("tree", rootTree);
  const commit = Buffer.from(
    `tree ${rootTreeId}\n\nsynthetic commit\n`,
    "utf8",
  );
  const commitId = gitObjectId("commit", commit);
  return {
    binding: {
      repository: "synthetic/test-only",
      commitId,
      requiredPath: ["dir", "file.txt"],
      requiredBlobId: blobId,
      requiredBlobSha256: createHash("sha256").update(blob).digest("hex"),
      requiredMode: "100644",
      expectedRootTreeId: rootTreeId,
    },
    objects: {
      repository: "synthetic/test-only",
      commitBytes: commit,
      trees: new Map([
        [rootTreeId, rootTree],
        [leafTreeId, leafTree],
      ]),
      blobs: new Map([[blobId, blob]]),
    },
  };
}

describe("M9b.13c intercepted network boundary", () => {
  it("accepts an exact HTTPS request over a public resolved peer", () => {
    expect(validateM9b13cNetworkAttempt(baseNetworkAttempt)).toEqual({
      ok: true,
      value: true,
    });
  });

  it.each([
    [
      "proxy environment",
      { proxyEnvironmentKeys: ["HTTPS_PROXY"] },
      "m9b13c:proxy-configuration-present",
    ],
    [
      "system proxy",
      { systemProxyConfigured: true },
      "m9b13c:proxy-configuration-present",
    ],
    [
      "wrong scheme",
      { url: "http://registry-1.docker.io/v2/library/node/manifests/x" },
      "m9b13c:https-boundary-violation",
    ],
    [
      "wrong host",
      {
        url: "https://example.com/v2/library/node/manifests/x",
        sni: "example.com",
      },
      "m9b13c:unlisted-network-host",
    ],
    [
      "wrong path",
      { url: "https://registry-1.docker.io/v2/library/other/manifests/x" },
      "m9b13c:unlisted-network-path",
    ],
    ["wrong SNI", { sni: "auth.docker.io" }, "m9b13c:tls-sni-mismatch"],
    [
      "bad certificate",
      { certificateChainValid: false },
      "m9b13c:tls-certificate-invalid",
    ],
    [
      "private DNS",
      { dnsAnswers: ["10.0.0.1"], peerAddress: "10.0.0.1" },
      "m9b13c:nonpublic-or-empty-dns-answer",
    ],
    [
      "wrong peer",
      { peerAddress: "1.1.1.1" },
      "m9b13c:peer-address-not-in-validated-dns-set",
    ],
    [
      "ambient Docker path",
      { ambientDockerPaths: ["synthetic/.docker/config.json"] },
      "m9b13c:ambient-docker-configuration-present",
    ],
    [
      "credential helper environment",
      { ambientEnvironmentKeys: ["DOCKER_CONFIG"] },
      "m9b13c:ambient-docker-configuration-present",
    ],
    ["retry request", { requestOrdinal: 65 }, "m9b13c:request-count-overflow"],
  ] as const)("rejects %s", (_name, replacement, reason) => {
    expect.hasAssertions();
    expectQuarantine(
      validateM9b13cNetworkAttempt({ ...baseNetworkAttempt, ...replacement }),
      reason,
    );
  });

  it("rejects a redirect not bound to the sole registry redirect rule", () => {
    expect.hasAssertions();
    expectQuarantine(
      validateM9b13cNetworkAttempt({
        ...baseNetworkAttempt,
        url: "https://production.cloudflare.docker.com/synthetic/blob",
        sni: "production.cloudflare.docker.com",
        redirectFromHost: "registry-1.docker.io",
        redirectDigest: "sha256:unbound",
      }),
      "m9b13c:redirect-boundary-violation",
    );
  });

  it("rejects malformed bearer service, scope, action, lifetime, and response fields", () => {
    const valid = {
      token: "synthetic-memory-token",
      expires_in: 300,
      issued_at: "2026-08-03T00:00:00Z",
      service: "registry.docker.io",
      scope: "repository:library/node:pull",
      actions: ["pull"],
      logged: false,
      persisted: false,
      discardedAfterUse: true,
    };
    expect(validateM9b13cBearerResponse(valid)).toEqual({
      ok: true,
      value: true,
    });
    for (const invalid of [
      { ...valid, service: "other" },
      { ...valid, scope: "repository:library/node:push" },
      { ...valid, actions: ["push"] },
      { ...valid, expires_in: 301 },
      { ...valid, refresh_token: "forbidden" },
      { ...valid, persisted: true },
    ])
      expectQuarantine(
        validateM9b13cBearerResponse(invalid),
        "m9b13c:invalid-anonymous-bearer-response",
      );
  });

  it("uses only a fully intercepted transport and records zero real network effects", async () => {
    let interceptedCalls = 0;
    const result = await runM9b13cInterceptedRequests([baseNetworkAttempt], {
      kind: "m9b13c-fully-intercepted-transport",
      send() {
        interceptedCalls += 1;
        return Promise.resolve({ bytes: 17 });
      },
    });
    expect(result).toEqual({ ok: true, value: 17 });
    expect(interceptedCalls).toBe(1);
    expect(M9B13C_ZERO_EFFECTS.networkRequests).toBe(0);
  });

  it("classifies non-public address families fail-closed", () => {
    expect(isM9b13cPublicAddress("8.8.8.8")).toBe(true);
    expect(isM9b13cPublicAddress("10.0.0.1")).toBe(false);
    expect(isM9b13cPublicAddress("127.0.0.1")).toBe(false);
    expect(isM9b13cPublicAddress("2001:db8::1")).toBe(false);
    expect(isM9b13cPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
});

describe("M9b.13c Git object closure", () => {
  it("reconstructs commit, trees, exact path, mode, and blob", () => {
    const fixture = syntheticGitFixture();
    expect(verifyM9b13cGitClosure(fixture.binding, fixture.objects)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("rejects repository, commit, tree, path, blob, and mode substitution", () => {
    expect.hasAssertions();
    const fixture = syntheticGitFixture();
    expectQuarantine(
      verifyM9b13cGitClosure(fixture.binding, {
        ...fixture.objects,
        repository: "synthetic/wrong",
      }),
      "m9b13c:git-repository-substitution",
    );
    expectQuarantine(
      verifyM9b13cGitClosure(fixture.binding, {
        ...fixture.objects,
        commitBytes: Buffer.from(
          "tree 0000000000000000000000000000000000000000\n",
        ),
      }),
      "m9b13c:git-commit-substitution",
    );
    expectQuarantine(
      verifyM9b13cGitClosure(fixture.binding, {
        ...fixture.objects,
        trees: new Map(),
      }),
      "m9b13c:git-tree-substitution",
    );
    expectQuarantine(
      verifyM9b13cGitClosure(
        { ...fixture.binding, requiredPath: ["wrong", "file.txt"] },
        fixture.objects,
      ),
      "m9b13c:git-required-path-mismatch",
    );
    expectQuarantine(
      verifyM9b13cGitClosure(fixture.binding, {
        ...fixture.objects,
        blobs: new Map([
          [fixture.binding.requiredBlobId, Buffer.from("wrong")],
        ]),
      }),
      "m9b13c:git-blob-substitution",
    );
    const wrongMode = syntheticGitFixture("100755");
    expectQuarantine(
      verifyM9b13cGitClosure(wrongMode.binding, wrongMode.objects),
      "m9b13c:git-final-mode-mismatch",
    );
  });
});

describe("M9b.13c byte accounting", () => {
  it("accounts exact streamed response and archive bytes", () => {
    const response = accountM9b13cResponse(M9B13C_EMPTY_BYTE_STATE, {
      responseClass: "registry-manifest",
      headerBytes: 512,
      bodyChunks: [100, 200],
      declaredBodyBytes: 300,
      stageA: true,
      registry: true,
      redirect: false,
    });
    expect(response).toEqual({
      ok: true,
      value: {
        requestCount: 1,
        redirectCount: 0,
        stageABodyBytes: 300,
        registryBodyBytes: 300,
        archiveBytes: 0,
      },
    });
    if (!response.ok) throw new Error(response.error.reason);
    expect(accountM9b13cArchiveChunks(response.value, [400, 500])).toEqual({
      ok: true,
      value: { ...response.value, archiveBytes: 900 },
    });
  });

  it("rejects header, body, Stage A, registry, descriptor, and archive overflow", () => {
    expect.hasAssertions();
    const baseResponse = {
      responseClass: "auth-token" as const,
      headerBytes: 1,
      bodyChunks: [1],
      declaredBodyBytes: 1,
      stageA: true,
      registry: false,
      redirect: false,
    };
    expectQuarantine(
      accountM9b13cResponse(M9B13C_EMPTY_BYTE_STATE, {
        ...baseResponse,
        headerBytes: M9B13C_BYTE_LIMITS.perResponseHeaderBytes + 1,
      }),
      "m9b13c:response-header-overflow",
    );
    expectQuarantine(
      accountM9b13cResponse(M9B13C_EMPTY_BYTE_STATE, {
        ...baseResponse,
        bodyChunks: [65_537],
        declaredBodyBytes: 65_537,
      }),
      "m9b13c:response-body-overflow",
    );
    expectQuarantine(
      accountM9b13cResponse(
        {
          ...M9B13C_EMPTY_BYTE_STATE,
          stageABodyBytes: M9B13C_BYTE_LIMITS.aggregateStageABodyBytes,
        },
        baseResponse,
      ),
      "m9b13c:stage-a-aggregate-overflow",
    );
    expectQuarantine(
      accountM9b13cResponse(
        {
          ...M9B13C_EMPTY_BYTE_STATE,
          registryBodyBytes: M9B13C_BYTE_LIMITS.aggregateRegistryBodyBytes,
        },
        { ...baseResponse, stageA: false, registry: true },
      ),
      "m9b13c:registry-aggregate-overflow",
    );
    expectQuarantine(
      accountM9b13cResponse(M9B13C_EMPTY_BYTE_STATE, {
        ...baseResponse,
        declaredBodyBytes: 2,
      }),
      "m9b13c:descriptor-size-mismatch",
    );
    expectQuarantine(
      accountM9b13cArchiveChunks(
        {
          ...M9B13C_EMPTY_BYTE_STATE,
          archiveBytes: M9B13C_BYTE_LIMITS.aggregateArchiveBytes,
        },
        [1],
      ),
      "m9b13c:archive-overflow-before-sealing",
    );
    expect(M9B13C_BYTE_LIMITS.knownRegistryBytes).toBe(82_785_952);
    expect(M9B13C_BYTE_LIMITS.registryHeadroomBytes).toBe(17_214_048);
  });
});

describe("M9b.13c OpenPGP policy", () => {
  const signing = "DD792F5973C6DE52C432CBDAC77ABFA00DDBF2B7";
  const primary = "1111111111111111111111111111111111111111";
  const valid = `[GNUPG:] NEWSIG\n[GNUPG:] GOODSIG C77ABFA00DDBF2B7 Node\n[GNUPG:] VALIDSIG ${signing} 2026-07-29 1785340800 0 4 0 1 10 00 ${primary}\n`;

  it("requires exactly one VALIDSIG with signing and primary binding", () => {
    expect(validateM9b13cGpgStatus(valid, signing, primary)).toEqual({
      ok: true,
      value: true,
    });
  });

  it.each([
    "BADSIG",
    "ERRSIG",
    "NO_PUBKEY",
    "EXPKEYSIG",
    "EXPSIG",
    "REVKEYSIG",
    "KEYREVOKED",
  ])("rejects fatal %s status", (token) => {
    expect.hasAssertions();
    expectQuarantine(
      validateM9b13cGpgStatus(
        `[GNUPG:] ${token} synthetic\n`,
        signing,
        primary,
      ),
      `m9b13c:gpg-status-${token.toLowerCase()}`,
    );
  });

  it("rejects malformed, conflicting, missing, and wrong-fingerprint status", () => {
    expect.hasAssertions();
    expectQuarantine(
      validateM9b13cGpgStatus("not-status\n", signing, primary),
      "m9b13c:malformed-or-unrecognized-gpg-status",
    );
    expectQuarantine(
      validateM9b13cGpgStatus(`${valid}${valid}`, signing, primary),
      "m9b13c:gpg-validsig-count-mismatch",
    );
    expectQuarantine(
      validateM9b13cGpgStatus("[GNUPG:] NEWSIG\n", signing, primary),
      "m9b13c:gpg-validsig-count-mismatch",
    );
    expectQuarantine(
      validateM9b13cGpgStatus(valid, "0".repeat(40), primary),
      "m9b13c:gpg-fingerprint-binding-mismatch",
    );
  });
});

describe("M9b.13c evidence, SBOM, and quarantine", () => {
  it("accepts only the exact unsigned content-addressed evidence envelope", () => {
    expect(validateM9b13cEvidenceEnvelope(baseEvidence)).toEqual({
      ok: true,
      value: true,
    });
  });

  it.each([
    [
      "signature",
      { unexpectedSignature: true },
      "m9b13c:unexpected-signature-or-transparency",
    ],
    [
      "transparency",
      { unexpectedTransparency: true },
      "m9b13c:unexpected-signature-or-transparency",
    ],
    [
      "unknown type",
      { unrecognizedEvidenceTypes: ["synthetic/type"] },
      "m9b13c:unrecognized-evidence-type",
    ],
    [
      "missing provenance",
      { provenancePresent: false },
      "m9b13c:missing-provenance-or-sbom",
    ],
    [
      "missing SBOM",
      { sbomPresent: false },
      "m9b13c:missing-provenance-or-sbom",
    ],
    [
      "wrong subject",
      { subjectExact: false },
      "m9b13c:wrong-attestation-subject",
    ],
    [
      "descriptor graph",
      { descriptorGraphConsistent: false },
      "m9b13c:descriptor-graph-inconsistent",
    ],
    [
      "source",
      { sourceExact: false },
      "m9b13c:provenance-semantics-inconsistent",
    ],
    [
      "builder",
      { builderExact: false },
      "m9b13c:provenance-semantics-inconsistent",
    ],
    [
      "build type",
      { buildTypeExact: false },
      "m9b13c:provenance-semantics-inconsistent",
    ],
    [
      "invocation",
      { invocationComplete: false },
      "m9b13c:provenance-semantics-inconsistent",
    ],
    [
      "platform",
      { platformExact: false },
      "m9b13c:provenance-semantics-inconsistent",
    ],
    [
      "Node",
      { nodeVersionExact: false },
      "m9b13c:provenance-semantics-inconsistent",
    ],
    [
      "base",
      { baseMaterialsComplete: false },
      "m9b13c:provenance-semantics-inconsistent",
    ],
    [
      "packages",
      { packageInventoryConsistent: false },
      "m9b13c:sbom-semantics-inconsistent",
    ],
    [
      "ambiguity",
      { malformedOrAmbiguous: true },
      "m9b13c:malformed-or-ambiguous-evidence",
    ],
  ] as const)("quarantines %s mismatch", (_name, replacement, reason) => {
    expect.hasAssertions();
    expectQuarantine(
      validateM9b13cEvidenceEnvelope({ ...baseEvidence, ...replacement }),
      reason,
    );
  });

  it("normalizes presentation order but rejects semantic SBOM differences", () => {
    const packageA = {
      name: "node",
      version: "24.18.1",
      architecture: "arm64",
      packageId: "pkg:generic/node@24.18.1?arch=arm64",
      files: ["/usr/bin/node"],
      relationships: ["CONTAINS:file:/usr/bin/node"],
    };
    expect(
      compareM9b13cSbomInventories(
        { packages: [packageA] },
        {
          packages: [
            { ...packageA, files: ["/usr/bin/node", "/usr/bin/node"] },
          ],
        },
      ),
    ).toEqual({ ok: true, value: true });
    expectQuarantine(
      compareM9b13cSbomInventories(
        { packages: [packageA] },
        { packages: [{ ...packageA, version: "24.18.0" }] },
      ),
      "m9b13c:sbom-semantic-mismatch",
    );
  });
});

describe("M9b.13c destination admission and final dependency closure", () => {
  it("accepts a fully stable synthetic private destination fixture", () => {
    expect(validateM9b13cDestinationFixture(baseDestination)).toEqual({
      ok: true,
      value: true,
    });
  });

  it.each([
    [
      "symlink",
      { ancestors: [{ ...baseDestination.ancestors[0], kind: "symlink" }] },
      "m9b13c:destination-ancestor-identity-mismatch",
    ],
    [
      "mount boundary",
      { ancestors: [{ ...baseDestination.ancestors[0], mountBoundary: true }] },
      "m9b13c:destination-ancestor-identity-mismatch",
    ],
    [
      "alias",
      { ancestors: [{ ...baseDestination.ancestors[0], aliasDetected: true }] },
      "m9b13c:destination-ancestor-identity-mismatch",
    ],
    [
      "ancestor replacement",
      { ancestors: [{ ...baseDestination.ancestors[0], replaced: true }] },
      "m9b13c:destination-ancestor-identity-mismatch",
    ],
    [
      "device replacement",
      { rootDeviceStable: false },
      "m9b13c:destination-root-identity-replaced",
    ],
    [
      "inode replacement",
      { rootInodeStable: false },
      "m9b13c:destination-root-identity-replaced",
    ],
    [
      "preexisting root",
      { rootPreexisting: true },
      "m9b13c:destination-exclusive-create-failed",
    ],
    [
      "concurrent creation",
      { concurrentCreate: true },
      "m9b13c:destination-exclusive-create-failed",
    ],
    [
      "crash",
      { crashOrInterruption: true },
      "m9b13c:destination-partial-or-sealing-failure",
    ],
    [
      "partial state",
      { partialState: true },
      "m9b13c:destination-partial-or-sealing-failure",
    ],
    [
      "cleanup anomaly",
      { cleanupAnomaly: true },
      "m9b13c:destination-partial-or-sealing-failure",
    ],
    [
      "sealing failure",
      { sealingFailure: true },
      "m9b13c:destination-partial-or-sealing-failure",
    ],
  ] as const)("rejects %s", (_name, replacement, reason) => {
    expect.hasAssertions();
    expectQuarantine(
      validateM9b13cDestinationFixture({ ...baseDestination, ...replacement }),
      reason,
    );
  });

  it("seals NO-GO for absent scanner and race-resistant filesystem helper", () => {
    expect(evaluateM9b13cReadiness(M9B13C_ZERO_EFFECTS)).toEqual({
      ok: true,
      value: {
        decision: "acquisition-boundary-no-go",
        blockers: [
          "m9b13c:offline-independent-sbom-scanner-unavailable",
          "m9b13c:directory-relative-race-resistant-filesystem-primitive-unavailable",
        ],
        effects: M9B13C_ZERO_EFFECTS,
      },
    });
    expectQuarantine(
      evaluateM9b13cReadiness({ ...M9B13C_ZERO_EFFECTS, downloads: 1 }),
      "m9b13c:prohibited-effect-nonzero",
    );
  });
});
