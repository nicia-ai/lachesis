import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseJson } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import {
  createM9b13bSyntheticInput,
  M9B13B_FROZEN,
  M9B13B_PROTOCOLS,
  M9B13B_ZERO_EFFECTS,
  type M9b13bSyntheticInput,
  validateM9b13bSyntheticAcquisition,
} from "../internal/m9b13b-acquisition-authorization.js";

function expectRejected(input: M9b13bSyntheticInput, reason: string): void {
  expect(validateM9b13bSyntheticAcquisition(input)).toEqual({
    ok: false,
    error: { kind: "acquisition-authorization-rejection", reason },
  });
  expect(input.effects).toEqual(M9B13B_ZERO_EFFECTS);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("M9b.13b cryptographically complete OCI acquisition authorization", () => {
  it("accepts only the frozen synthetic contract with zero prohibited effects", () => {
    expect(
      validateM9b13bSyntheticAcquisition(createM9b13bSyntheticInput()),
    ).toEqual({
      ok: true,
      value: {
        protocol: M9B13B_PROTOCOLS.review,
        status: "completed-offline-synthetic-zero-effect",
        decision:
          "m9b13b-corrected-acquisition-authorization-ready-for-independent-review",
        checks: {
          nodeReleaseVerification: "passed",
          githubWebFlowVerification: "passed-limited-meaning",
          officialImagesMapping: "passed",
          contentAddressedClosure: "passed",
          attestationGates: "passed-synthetic-only",
          noAcquisition: "passed",
          noImageState: "passed",
          noStudyEffects: "passed",
        },
        effects: M9B13B_ZERO_EFFECTS,
      },
    });
  });

  it("rejects a missing Node keyring", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      { ...base, node: { ...base.node, keyringPresent: false } },
      "m9b13b:missing-node-keyring",
    );
  });

  it("rejects an altered Node keyring", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      { ...base, node: { ...base.node, keyringSha256: "0".repeat(64) } },
      "m9b13b:altered-node-keyring",
    );
  });

  it("rejects the wrong Node signer", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      { ...base, node: { ...base.node, signerFingerprint: "0".repeat(40) } },
      "m9b13b:wrong-node-signer",
    );
  });

  it("rejects a changed signed-manifest hash", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      {
        ...base,
        node: { ...base.node, signedManifestSha256: "0".repeat(64) },
      },
      "m9b13b:changed-node-signed-manifest-hash",
    );
  });

  it("rejects a missing GitHub verification key", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      { ...base, github: { ...base.github, keyPresent: false } },
      "m9b13b:missing-github-web-flow-key",
    );
  });

  it("rejects the wrong GitHub web-flow key ID", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      { ...base, github: { ...base.github, signerKeyId: "0000000000000000" } },
      "m9b13b:wrong-github-web-flow-key-id",
    );
  });

  it("rejects an altered official-images mapping", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      {
        ...base,
        officialImages: {
          ...base.officialImages,
          fileSha256: "0".repeat(64),
        },
      },
      "m9b13b:altered-official-images-mapping",
    );
  });

  it("rejects an unexpected child descriptor", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      {
        ...base,
        graph: {
          ...base.graph,
          unexpectedDescriptors: ["sha256:synthetic-unexpected-canary"],
        },
      },
      "m9b13b:unexpected-child-descriptor",
    );
  });

  it("rejects the wrong attestation subject", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      {
        ...base,
        attestation: { ...base.attestation, subjectNameExact: false },
      },
      "m9b13b:wrong-attestation-subject",
    );
  });

  it("rejects the wrong provenance source commit", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      {
        ...base,
        attestation: { ...base.attestation, sourceCommit: "0".repeat(40) },
      },
      "m9b13b:wrong-provenance-source-commit",
    );
  });

  it("rejects a missing build invocation", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      {
        ...base,
        attestation: { ...base.attestation, invocationPresent: false },
      },
      "m9b13b:missing-build-invocation",
    );
  });

  it("rejects the wrong provenance platform", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      {
        ...base,
        attestation: { ...base.attestation, platform: "linux/amd64" },
      },
      "m9b13b:wrong-provenance-platform",
    );
  });

  it("rejects the wrong provenance Node version", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      {
        ...base,
        attestation: { ...base.attestation, nodeVersion: "24.18.0" },
      },
      "m9b13b:wrong-provenance-node-version",
    );
  });

  it("rejects an inconsistent SBOM package inventory", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      {
        ...base,
        attestation: {
          ...base.attestation,
          sbomBookwormPackagesCoherent: false,
        },
      },
      "m9b13b:inconsistent-sbom-package-inventory",
    );
  });

  it("rejects an absent claimed attestation signature", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      {
        ...base,
        attestation: {
          ...base.attestation,
          signatureClaimed: true,
          signaturePresent: false,
        },
      },
      "m9b13b:absent-claimed-attestation-signature",
    );
  });

  it("rejects malformed transparency evidence", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      {
        ...base,
        attestation: {
          ...base.attestation,
          transparencyClaimed: true,
          transparencyValid: false,
        },
      },
      "m9b13b:malformed-transparency-evidence",
    );
  });

  it("rejects an unexpected redirect host", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      {
        ...base,
        graph: {
          ...base.graph,
          unexpectedRedirectHost: "synthetic.invalid",
        },
      },
      "m9b13b:unexpected-redirect-host",
    );
  });

  it("rejects an incomplete download", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      { ...base, graph: { ...base.graph, downloadComplete: false } },
      "m9b13b:incomplete-download",
    );
  });

  it("rejects a retry or candidate substitution", () => {
    expect.hasAssertions();
    const base = createM9b13bSyntheticInput();
    expectRejected(
      {
        ...base,
        graph: { ...base.graph, attemptCount: 2, candidateSubstitution: true },
      },
      "m9b13b:retry-or-candidate-substitution",
    );
  });

  it("rederives protocol and inactive-authorization digests from checked-in bytes", async () => {
    const root = join(process.cwd(), "docs/m9b13b-acquisition-authorization");
    const protocolBytes = await readFile(join(root, "protocol.json"));
    const authorizationBytes = await readFile(
      join(root, "inactive-acquisition-authorization.json"),
    );
    const authorizationResult = parseJson(authorizationBytes.toString("utf8"));
    const decisionResult = parseJson(
      await readFile(join(root, "decision.json"), "utf8"),
    );
    if (!authorizationResult.ok)
      throw new Error(authorizationResult.error.code);
    if (!decisionResult.ok) throw new Error(decisionResult.error.code);
    const authorization = authorizationResult.value;
    const decision = decisionResult.value;
    expect(authorization).toMatchObject({
      protocol: "lachesis-m9b13b-content-addressed-download-closure/1",
      status: "inactive-prospective-text-only",
      reviewProtocolDigest: sha256(protocolBytes),
    });
    expect(decision).toMatchObject({
      protocol: M9B13B_PROTOCOLS.review,
      decision:
        "m9b13b-corrected-acquisition-authorization-ready-for-independent-review",
      protocolDigest: sha256(protocolBytes),
      inactiveAuthorizationDigest: sha256(authorizationBytes),
      activation: false,
    });
    expect(M9B13B_FROZEN.startingCommit).toHaveLength(40);
  });

  it("matches the checked-in deterministic zero-effect report", async () => {
    const result = validateM9b13bSyntheticAcquisition(
      createM9b13bSyntheticInput(),
    );
    const checkedInResult = parseJson(
      await readFile(
        join(
          process.cwd(),
          "docs/m9b13b-acquisition-authorization/zero-effect-report.json",
        ),
        "utf8",
      ),
    );
    if (!checkedInResult.ok) throw new Error(checkedInResult.error.code);
    expect(checkedInResult.value).toEqual(result);
  });
});
