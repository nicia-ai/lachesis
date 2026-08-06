import { describe, expect, it } from "vitest";

import {
  digestM9b13e1TrustedSessionReceipt,
  M9B13E1_EMBARGO_SUPPLEMENT_PROTOCOL,
  M9B13E1_NONCLAIM,
  M9B13E1_REGISTERED_ARCHIVE_FILES,
  M9B13E1_RETAINED_SCOPE,
  M9B13E1_TRUSTED_SESSION_READINESS_PROTOCOL,
  type M9b13e1ReadinessExpectations,
  type M9b13e1Supplement,
  type M9b13e1TrustedSessionReceipt,
  validateM9b13e1Supplement,
  validateM9b13e1TrustedSessionReceipt,
} from "../internal/m9b13e1-trusted-session-readiness.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);
const F = "f".repeat(64);
const ZERO = "0".repeat(64);
const COMMITMENT_A = `sha256:${A}`;
const COMMITMENT_B = `sha256:${B}`;
const COMMITMENT_C = `sha256:${C}`;
const WALL = "2026-08-06T12:00:00.000Z";

type SessionTransition =
  M9b13e1TrustedSessionReceipt["session"]["transitions"][number];

function transition(
  from: SessionTransition["from"],
  to: SessionTransition["to"],
  event: string,
  index: number,
): SessionTransition {
  return {
    from,
    to,
    event,
    wallTimestamp: WALL,
    monotonicTimestampNanos: String(1200 + index),
    evidenceSha256: A,
  };
}

function executable(protocol: string, digest: string) {
  return {
    protocol,
    sourceSha256: digest,
    buildReceiptSha256: digest,
    executableSha256: digest,
  };
}

function unsignedReceipt(): M9b13e1TrustedSessionReceipt {
  const processes: M9b13e1TrustedSessionReceipt["permittedProcesses"] = [
    {
      id: "controller",
      role: "controller",
      parentId: null,
      identity: executable("controller/1", A),
      argumentsSchemaSha256: A,
      environmentSchemaSha256: B,
      descriptorInheritanceSha256: C,
      maximumInstances: 1,
      startOrder: 0,
      terminalExitRequired: true,
    },
    {
      id: "helper",
      role: "helper",
      parentId: "controller",
      identity: executable("helper/1", B),
      argumentsSchemaSha256: B,
      environmentSchemaSha256: C,
      descriptorInheritanceSha256: D,
      maximumInstances: 1,
      startOrder: 1,
      terminalExitRequired: true,
    },
    {
      id: "scanner",
      role: "scanner",
      parentId: "controller",
      identity: executable("scanner/1", C),
      argumentsSchemaSha256: C,
      environmentSchemaSha256: D,
      descriptorInheritanceSha256: E,
      maximumInstances: 1,
      startOrder: 2,
      terminalExitRequired: true,
    },
    {
      id: "verifier",
      role: "verifier",
      parentId: "controller",
      identity: executable("verifier/1", D),
      argumentsSchemaSha256: D,
      environmentSchemaSha256: E,
      descriptorInheritanceSha256: F,
      maximumInstances: 1,
      startOrder: 3,
      terminalExitRequired: true,
    },
  ];
  const checkpoints: M9b13e1TrustedSessionReceipt["censusPolicy"]["checkpoints"] =
    [
      "before-session-admission",
      "before-consequential-boundary",
      "after-helper-or-scanner-completion",
      "before-sealing",
      "terminal",
    ];
  return {
    protocol: M9B13E1_TRUSTED_SESSION_READINESS_PROTOCOL,
    decision: "trusted-session-admitted",
    host: {
      hostIdentityCommitment: COMMITMENT_A,
      architecture: "arm64",
      operatingSystemName: "macOS",
      operatingSystemVersion: "26.5.2",
      kernelVersion: "Darwin 25.5.0",
      kernelBuild: "25F84",
      bootSessionIdentityCommitment: COMMITMENT_B,
      operationalRoots: [
        {
          rootCommitment: COMMITMENT_C,
          filesystemType: "APFS",
          deviceIdentityCommitment: COMMITMENT_A,
        },
      ],
      clockSource: "host-wall-plus-monotonic",
      wallTimestamp: WALL,
      monotonicTimestampNanos: "1000",
      trustedHostPolicySha256: A,
      readinessImplementation: executable("readiness-validator/1", A),
    },
    operationalIdentity: {
      numericUid: 501,
      principalCommitment: COMMITMENT_C,
      realUid: 501,
      effectiveUid: 501,
      savedUid: 501,
      groupInventorySha256: B,
      supplementaryGroupPolicy: "exact-digest-no-drift",
      privilegeState: "unprivileged-no-sudo-no-root-elevation",
      accountSessionCommitment: COMMITMENT_B,
      identityChangesPermitted: false,
    },
    permittedProcesses: processes,
    maximumProcessCount: 4,
    maximumConcurrency: 1,
    censusPolicy: {
      dataSource: "frozen-darwin-process-snapshot-source",
      enumerationMethod: "complete-uid-scoped-enumeration",
      executableIdentityMethod: "descriptor-metadata-plus-sha256",
      parentChildReconstructionMethod: "pid-ppid-start-time-join",
      shortLivedProcessMethod: "event-source-correlated-with-snapshots",
      maximumAgeMillis: 50,
      checkpoints,
      backgroundProcessPolicy:
        "reject-pre-existing-process-not-in-exact-allowlist",
      continuousObservationRequired: false,
      continuousObservationProven: false,
      evidenceSchemaSha256: C,
    },
    consequentialBoundaries: [{ identity: "boundary-1", order: 0 }],
    processCompletions: [
      { identity: "helper-completion-1", processId: "helper", role: "helper" },
    ],
    censusSnapshots: checkpoints.map((checkpoint, index) => ({
      checkpoint,
      subjectIdentity:
        checkpoint === "before-consequential-boundary"
          ? "boundary-1"
          : checkpoint === "after-helper-or-scanner-completion"
            ? "helper-completion-1"
            : null,
      wallTimestamp: WALL,
      monotonicTimestampNanos: String(1100 + index),
      ageMillisAtDecision: 0,
      processInventorySha256: D,
      parentChildTopologySha256: E,
      shortLivedProcessCoverage: "complete",
      evidenceSha256: F,
    })),
    unexpectedProcesses: [],
    trustedInventory: {
      controller: executable("controller/1", A),
      nodeRuntime: { ...executable("node-runtime/1", B), version: "24.19.0" },
      helper: {
        protocol: "future-helper/1",
        sourceSha256: C,
        compilerPathCommitment: COMMITMENT_A,
        compilerVersion: "frozen-compiler-1",
        compilerSha256: D,
        sdkSysrootCommitment: COMMITMENT_B,
        sdkVersion: "frozen-sdk-1",
        sdkSha256: E,
        compilerFlags: ["-std=c17", "-O2"],
        linkerFlags: ["-Wl,-fatal_warnings"],
        buildEnvironmentSha256: F,
        linkedLibraries: [{ identity: "libSystem", sha256: A }],
        reproducibleBuildReceiptSha256: B,
        executableSha256: C,
        supportedHost: {
          operatingSystem: "macOS-26.5.2",
          kernel: "Darwin-25.5.0",
          architecture: "arm64",
          filesystem: "APFS",
        },
        invocationContractSha256: D,
        exitCodeContractSha256: E,
      },
      scanner: executable("scanner/1", C),
      protocolsAndSchemasSha256: D,
      trustedKeyringSha256: E,
      acquisitionConfigurationSha256: F,
      privateRootInventorySha256: A,
      everyInvokedExecutableSha256: B,
      environmentAllowlist: ["LANG", "PATH_DISABLED"],
    },
    session: {
      sessionIdentityCommitment: COMMITMENT_C,
      transitions: [
        transition("uninitialized", "preflight", "begin-preflight", 0),
        transition("preflight", "admitted-clean", "admit-clean-session", 1),
        transition(
          "admitted-clean",
          "acquisition-active",
          "activate-acquisition",
          2,
        ),
        transition(
          "acquisition-active",
          "verification-active",
          "begin-verification",
          3,
        ),
        transition(
          "verification-active",
          "sealed",
          "seal-after-verification",
          4,
        ),
        transition("sealed", "closed", "close-session", 5),
      ],
      finalState: "closed",
      interrupted: false,
      invariantLostAfterAdmission: false,
      stopReasons: [],
      priorFailedSessionReused: false,
      restartPermitted: false,
    },
    stopGate: {
      evaluatedBeforeNetworkOrDurableEffect: true,
      noNewRequestAfterStop: true,
      inFlightCancellationAttemptedOnInvariantLoss: true,
      acceptedSealWritten: true,
      partialStateQuarantined: false,
      retries: 0,
      freshAdmissionRequiredAfterStop: true,
      effectBeforeAdmission: false,
      effectCounters: {
        networkRequests: 0,
        durableAcquisitionWrites: 0,
        downloads: 0,
        imageOperations: 0,
        credentialAccesses: 0,
        providerOrModelCalls: 0,
      },
    },
    evidence: {
      inputBindingsSha256: A,
      permittedProcessInventorySha256: D,
      unexpectedProcessInventorySha256: E,
      trustedRootInventorySha256: F,
      transitionInventorySha256: A,
      failureOrStopReasonSha256: B,
      effectAccountingSha256: C,
      independentVerification: "pass",
      canonicalReceiptDigest: ZERO,
    },
    nonclaim: M9B13E1_NONCLAIM,
    retainedScope: M9B13E1_RETAINED_SCOPE,
  };
}

function expectationsOf(
  receipt: M9b13e1TrustedSessionReceipt,
): M9b13e1ReadinessExpectations {
  return {
    host: receipt.host,
    operationalIdentity: receipt.operationalIdentity,
    permittedProcesses: receipt.permittedProcesses,
    maximumProcessCount: receipt.maximumProcessCount,
    censusPolicy: receipt.censusPolicy,
    trustedInventory: receipt.trustedInventory,
  };
}

async function sealReceipt(
  receipt: M9b13e1TrustedSessionReceipt,
): Promise<M9b13e1TrustedSessionReceipt> {
  const digest = await digestM9b13e1TrustedSessionReceipt(receipt);
  if (!digest.ok) throw new Error(digest.error.reason);
  return {
    ...receipt,
    evidence: { ...receipt.evidence, canonicalReceiptDigest: digest.value },
  };
}

async function validReceipt(): Promise<M9b13e1TrustedSessionReceipt> {
  return sealReceipt(unsignedReceipt());
}

async function stoppedReceipt(): Promise<M9b13e1TrustedSessionReceipt> {
  const receipt = unsignedReceipt();
  return sealReceipt({
    ...receipt,
    decision: "trusted-session-no-effect-stop",
    unexpectedProcesses: [
      { processIdentityCommitment: COMMITMENT_A, evidenceSha256: A },
    ],
    session: {
      ...receipt.session,
      transitions: [
        transition("uninitialized", "preflight", "begin-preflight", 0),
        transition("preflight", "admitted-clean", "admit-clean-session", 1),
        transition(
          "admitted-clean",
          "quarantined",
          "unexpected-process-stop",
          2,
        ),
        transition("quarantined", "closed", "close-quarantined-session", 3),
      ],
      finalState: "closed",
      invariantLostAfterAdmission: true,
      stopReasons: ["unexpected-process"],
    },
    stopGate: {
      ...receipt.stopGate,
      acceptedSealWritten: false,
      partialStateQuarantined: true,
    },
  });
}

function validSupplement(): M9b13e1Supplement {
  const historicalStages: ReadonlyArray<
    M9b13e1Supplement["historicalNoGos"][number]["stage"]
  > = [
    "M9b.13",
    "M9b.13a",
    "M9b.13b",
    "M9b.13c",
    "M9b.13d",
    "M9b.13d.1",
    "M9b.13e-and-independent-review",
  ];
  return {
    protocol: M9B13E1_EMBARGO_SUPPLEMENT_PROTOCOL,
    externalIdentity: "future-immutable-external-identity",
    prospective: true,
    approvedBefore: {
      corpusConstruction: true,
      hiddenGoldConstruction: true,
      scheduleMaterialization: true,
      credentialAccess: true,
      networkAcquisition: true,
      providerOrModelEffects: true,
      studyExecution: true,
    },
    registration: {
      id: "63sh5",
      submissionTimestamp: "2026-08-02T19:19:33.924946Z",
      approvalTimestamp: "2026-08-02T20:03:47.850242Z",
      immutableFiles: [...M9B13E1_REGISTERED_ARCHIVE_FILES],
      preregistrationDigest:
        "097d4848a264fc8484ca590c79388e3a00279a6310392205db7868104cee13b4",
      manifestDigest:
        "5e53f4aeb8bf22213692557023b695bf88013372c8b235a7f844fdcf5545b189",
      scientificFinancialProjectionDigest:
        "e5cd02100a1004849acc18f3f302e880580a38ef45a0733868826c32a23ff282",
    },
    historicalNoGos: historicalStages.map((stage) => ({
      stage,
      disposition: "historical-no-go-evidence-not-reinterpreted",
    })),
    embargo: {
      mechanismSupportsAtLeastOriginalRestriction: true,
      protectedThrough: "2030-08-01T00:00:00Z",
      publicViewOnlyLinkCount: 0,
      publicMetadataRevealsProtectedContext: false,
    },
    prohibitions: {
      publication: true,
      withdrawal: true,
      replacement: true,
      clonePresentedAsOriginal: true,
      registration63sh5Modification: true,
      prematureEmbargoTermination: true,
    },
    attachmentInventorySha256: A,
    serverSubmissionTimestamp: "2026-08-06T12:00:00.000Z",
    approvalTimestamp: "2026-08-06T12:01:00.000Z",
    independentPostUploadByteVerification: true,
    appendOnlyLocalReceiptRequired: true,
    separateSubmissionAuthorizationRequired: true,
    separateApprovalAuthorizationRequired: true,
    supplementApprovalGrantsCorpusOrAcquisitionAuthority: false,
    nonclaim: M9B13E1_NONCLAIM,
    retainedScope: M9B13E1_RETAINED_SCOPE,
  };
}

describe("M9b.13e.1 trusted-session readiness contract", () => {
  it("accepts one exact checksum-bound clean session", async () => {
    const receipt = await validReceipt();
    const result = await validateM9b13e1TrustedSessionReceipt(
      receipt,
      expectationsOf(receipt),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a missing machine identity", async () => {
    const receipt = await validReceipt();
    const { hostIdentityCommitment: omitted, ...host } = receipt.host;
    void omitted;
    const result = await validateM9b13e1TrustedSessionReceipt(
      { ...receipt, host },
      expectationsOf(receipt),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects the wrong UID and UID drift", async () => {
    const receipt = await validReceipt();
    const wrongUid = await sealReceipt({
      ...receipt,
      operationalIdentity: { ...receipt.operationalIdentity, numericUid: 502 },
    });
    const uidDrift = await sealReceipt({
      ...receipt,
      operationalIdentity: {
        ...receipt.operationalIdentity,
        effectiveUid: 502,
      },
    });
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          wrongUid,
          expectationsOf(receipt),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          uidDrift,
          expectationsOf(uidDrift),
        )
      ).ok,
    ).toBe(false);
  });

  it("rejects an unexpected process or incorrect parent relationship", async () => {
    const receipt = await validReceipt();
    const unexpected = await sealReceipt({
      ...receipt,
      unexpectedProcesses: [
        { processIdentityCommitment: COMMITMENT_A, evidenceSha256: A },
      ],
    });
    const invalidParent = await sealReceipt({
      ...receipt,
      permittedProcesses: receipt.permittedProcesses.map((process) =>
        process.id === "helper"
          ? { ...process, parentId: "missing-parent" }
          : process,
      ),
    });
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          unexpected,
          expectationsOf(receipt),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          invalidParent,
          expectationsOf(invalidParent),
        )
      ).ok,
    ).toBe(false);
  });

  it("rejects missing or stale census evidence", async () => {
    const receipt = await validReceipt();
    const missing = await sealReceipt({
      ...receipt,
      censusSnapshots: receipt.censusSnapshots.slice(1),
    });
    const stale = await sealReceipt({
      ...receipt,
      censusSnapshots: receipt.censusSnapshots.map((snapshot, index) =>
        index === 0 ? { ...snapshot, ageMillisAtDecision: 51 } : snapshot,
      ),
    });
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          missing,
          expectationsOf(receipt),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          stale,
          expectationsOf(receipt),
        )
      ).ok,
    ).toBe(false);
  });

  it("rejects executable, helper source, build, compiler, SDK, and flag mismatch", async () => {
    const receipt = await validReceipt();
    const variants: ReadonlyArray<M9b13e1TrustedSessionReceipt> = [
      {
        ...receipt,
        trustedInventory: {
          ...receipt.trustedInventory,
          controller: {
            ...receipt.trustedInventory.controller,
            executableSha256: F,
          },
        },
      },
      {
        ...receipt,
        trustedInventory: {
          ...receipt.trustedInventory,
          helper: { ...receipt.trustedInventory.helper, sourceSha256: F },
        },
      },
      {
        ...receipt,
        trustedInventory: {
          ...receipt.trustedInventory,
          helper: {
            ...receipt.trustedInventory.helper,
            reproducibleBuildReceiptSha256: F,
          },
        },
      },
      {
        ...receipt,
        trustedInventory: {
          ...receipt.trustedInventory,
          helper: {
            ...receipt.trustedInventory.helper,
            compilerVersion: "wrong",
          },
        },
      },
      {
        ...receipt,
        trustedInventory: {
          ...receipt.trustedInventory,
          helper: { ...receipt.trustedInventory.helper, sdkVersion: "wrong" },
        },
      },
      {
        ...receipt,
        trustedInventory: {
          ...receipt.trustedInventory,
          helper: {
            ...receipt.trustedInventory.helper,
            compilerFlags: ["-O0"],
          },
        },
      },
    ];
    for (const variant of variants) {
      const signed = await sealReceipt(variant);
      const result = await validateM9b13e1TrustedSessionReceipt(
        signed,
        expectationsOf(receipt),
      );
      expect(result.ok).toBe(false);
    }
  });

  it("rejects runtime drift and unexpected environment allowlist entries", async () => {
    const receipt = await validReceipt();
    const runtimeDrift = await sealReceipt({
      ...receipt,
      trustedInventory: {
        ...receipt.trustedInventory,
        nodeRuntime: {
          ...receipt.trustedInventory.nodeRuntime,
          version: "25.0.0",
        },
      },
    });
    const ambientEnvironment = await sealReceipt({
      ...receipt,
      trustedInventory: {
        ...receipt.trustedInventory,
        environmentAllowlist: [
          ...receipt.trustedInventory.environmentAllowlist,
          "AMBIENT_SECRET",
        ],
      },
    });
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          runtimeDrift,
          expectationsOf(receipt),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          ambientEnvironment,
          expectationsOf(receipt),
        )
      ).ok,
    ).toBe(false);
  });

  it("rejects an illegal session transition", async () => {
    const receipt = await validReceipt();
    const transitions: M9b13e1TrustedSessionReceipt["session"]["transitions"] =
      receipt.session.transitions.map((transition, index) =>
        index === 1 ? { ...transition, to: "sealed" } : transition,
      );
    const changed = await sealReceipt({
      ...receipt,
      session: { ...receipt.session, transitions },
    });
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          changed,
          expectationsOf(receipt),
        )
      ).ok,
    ).toBe(false);
  });

  it("requires invariant loss after admission to stop and quarantine", async () => {
    const receipt = await validReceipt();
    const invalid = await sealReceipt({
      ...receipt,
      session: { ...receipt.session, invariantLostAfterAdmission: true },
    });
    const stopped = await stoppedReceipt();
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          invalid,
          expectationsOf(receipt),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          stopped,
          expectationsOf(unsignedReceipt()),
        )
      ).ok,
    ).toBe(true);
  });

  it("rejects an attempted effect before admission and an accepted seal after stop", async () => {
    const receipt = await validReceipt();
    const effect = await sealReceipt({
      ...receipt,
      stopGate: {
        ...receipt.stopGate,
        effectBeforeAdmission: true,
        effectCounters: {
          ...receipt.stopGate.effectCounters,
          networkRequests: 1,
        },
      },
    });
    const stopped = await stoppedReceipt();
    const sealedAfterStop = await sealReceipt({
      ...stopped,
      stopGate: { ...stopped.stopGate, acceptedSealWritten: true },
    });
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          effect,
          expectationsOf(receipt),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          sealedAfterStop,
          expectationsOf(receipt),
        )
      ).ok,
    ).toBe(false);
  });

  it("rejects restart after a failed session and incomplete evidence", async () => {
    const stopped = await stoppedReceipt();
    const restart = {
      ...stopped,
      session: { ...stopped.session, priorFailedSessionReused: true },
    };
    const incomplete = {
      ...stopped,
      evidence: { ...stopped.evidence, failureOrStopReasonSha256: "" },
    };
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          restart,
          expectationsOf(unsignedReceipt()),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          incomplete,
          expectationsOf(unsignedReceipt()),
        )
      ).ok,
    ).toBe(false);
  });

  it("rejects hostile extra JSON keys and replays with zero effects", async () => {
    const receipt = await validReceipt();
    const hostile = { ...receipt, constructor: "hostile" };
    expect(
      (
        await validateM9b13e1TrustedSessionReceipt(
          hostile,
          expectationsOf(receipt),
        )
      ).ok,
    ).toBe(false);
    const first = await validateM9b13e1TrustedSessionReceipt(
      receipt,
      expectationsOf(receipt),
    );
    const second = await validateM9b13e1TrustedSessionReceipt(
      receipt,
      expectationsOf(receipt),
    );
    expect(first).toEqual(second);
    expect(receipt.stopGate.effectCounters).toEqual({
      networkRequests: 0,
      durableAcquisitionWrites: 0,
      downloads: 0,
      imageOperations: 0,
      credentialAccesses: 0,
      providerOrModelCalls: 0,
    });
  });
});

describe("M9b.13e.1 embargo-compatible supplement contract", () => {
  it("accepts the exact prospective contract", () => {
    expect(validateM9b13e1Supplement(validSupplement()).ok).toBe(true);
  });

  it("rejects historical NO-GO omission", () => {
    const supplement = validSupplement();
    expect(
      validateM9b13e1Supplement({
        ...supplement,
        historicalNoGos: supplement.historicalNoGos.slice(1),
      }).ok,
    ).toBe(false);
  });

  it("rejects a non-prospective or non-embargo-compatible supplement", () => {
    const supplement = validSupplement();
    expect(
      validateM9b13e1Supplement({ ...supplement, prospective: false }).ok,
    ).toBe(false);
    expect(
      validateM9b13e1Supplement({
        ...supplement,
        embargo: {
          ...supplement.embargo,
          mechanismSupportsAtLeastOriginalRestriction: false,
        },
      }).ok,
    ).toBe(false);
  });

  it("rejects a public link or changed registration identity", () => {
    const supplement = validSupplement();
    expect(
      validateM9b13e1Supplement({
        ...supplement,
        embargo: { ...supplement.embargo, publicViewOnlyLinkCount: 1 },
      }).ok,
    ).toBe(false);
    expect(
      validateM9b13e1Supplement({
        ...supplement,
        registration: { ...supplement.registration, id: "different" },
      }).ok,
    ).toBe(false);
  });

  it("rejects a changed scientific field or altered nonclaim", () => {
    const supplement = validSupplement();
    expect(
      validateM9b13e1Supplement({
        ...supplement,
        registration: {
          ...supplement.registration,
          scientificFinancialProjectionDigest: F,
        },
      }).ok,
    ).toBe(false);
    expect(
      validateM9b13e1Supplement({ ...supplement, nonclaim: "weaker" }).ok,
    ).toBe(false);
  });

  it("rejects hostile keys and an identity reused from registration", () => {
    const supplement = validSupplement();
    expect(
      validateM9b13e1Supplement({ ...supplement, prototype: "hostile" }).ok,
    ).toBe(false);
    expect(
      validateM9b13e1Supplement({ ...supplement, externalIdentity: "63sh5" })
        .ok,
    ).toBe(false);
  });
});
