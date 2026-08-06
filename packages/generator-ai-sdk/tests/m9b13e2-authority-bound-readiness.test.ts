import { digestValue } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import { M9B13E1_REGISTERED_ARCHIVE_FILES } from "../internal/m9b13e1-trusted-session-readiness.js";
import {
  attemptLiveM9b13e2Admission,
  createSyntheticM9b13e2AdmissionHarness,
  createSyntheticM9b13e2Ledger,
  deriveM9b13e2SessionCommitment,
  digestM9b13e2AdmissionCandidate,
  digestM9b13e2ExpectationPackage,
  M9B13E2_AMENDED_ASSUMPTION,
  M9B13E2_AMENDMENT_PROTOCOL,
  M9B13E2_AUTHORITY_ADMISSION_PROTOCOL,
  M9B13E2_CANDIDATE_PROTOCOL,
  M9B13E2_CENSUS_PROTOCOL,
  M9B13E2_EXPECTATION_PACKAGE_PROTOCOL,
  M9B13E2_EXPECTATION_REVIEW_DECISION,
  M9B13E2_LEDGER_PROTOCOL,
  M9B13E2_LIVE_POSITIVE_AUTHORITY,
  M9B13E2_NONCLAIM,
  M9B13E2_RETAINED_SCOPE,
  M9B13E2_STATE_MACHINE_PROTOCOL,
  M9B13E2_SUPPLEMENT_PROTOCOL,
  M9B13E2_SUPPLEMENT_REVIEW_PROTOCOL,
  M9B13E2_SYNTHETIC_AUTHORITY_PROTOCOL,
  type M9b13e2AdmissionCandidate,
  type M9b13e2ExpectationPackage,
  type M9b13e2Supplement,
  validateM9b13e2ExpectationPackage,
  validateM9b13e2ReceiptStructure,
  validateM9b13e2Supplement,
} from "../internal/m9b13e2-authority-bound-readiness.js";

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
const WALL = "2026-08-07T12:00:00.000Z";

function executable(protocol: string, digest: string) {
  return {
    protocol,
    sourceSha256: digest,
    buildReceiptSha256: digest,
    executableSha256: digest,
  };
}

function helperIdentity() {
  return {
    ...executable("helper/1", B),
    compilerPathCommitment: COMMITMENT_A,
    compilerVersion: "clang-18",
    compilerSha256: C,
    sdkSysrootCommitment: COMMITMENT_B,
    sdkVersion: "macos-26.5",
    sdkSha256: D,
    compilerFlags: ["-std=c17", "-O2"],
    linkerFlags: ["-Wl,-fatal_warnings"],
    buildEnvironmentSha256: E,
    linkedLibraries: [{ identity: "libSystem", sha256: F }],
    reproducibleBuildReceiptSha256: A,
    supportedHost: {
      operatingSystem: "macOS-26.5",
      kernel: "Darwin-25.5",
      architecture: "arm64",
      filesystem: "APFS",
    },
    invocationContractSha256: B,
    exitCodeContractSha256: C,
  };
}

async function requiredDigest(value: unknown): Promise<string> {
  const result = await digestValue(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function expectationPackage(
  changes: Readonly<Partial<M9b13e2ExpectationPackage>> = {},
): Promise<M9b13e2ExpectationPackage> {
  const helper = helperIdentity();
  const controller = executable("controller/1", A);
  const scanner = { ...executable("scanner/1", C), runtimeSha256: D };
  const verifier = executable("verifier/1", D);
  const numericGids = [20, 501];
  const checksumInventory = [
    { path: "synthetic/controller", sha256: A },
    { path: "synthetic/helper", sha256: B },
    { path: "synthetic/scanner", sha256: C },
    { path: "synthetic/verifier", sha256: D },
  ];
  const base: M9b13e2ExpectationPackage = {
    protocol: M9B13E2_EXPECTATION_PACKAGE_PROTOCOL,
    version: 1,
    packageCanonicalDigest: ZERO,
    independentReview: {
      protocol: "synthetic-independent-review/1",
      packageIdentity: "synthetic-reviewed-expectations-v1",
      acceptedDecision: M9B13E2_EXPECTATION_REVIEW_DECISION,
      reviewedCommit: "1".repeat(40),
      reviewedTree: "2".repeat(40),
      evidenceSha256: E,
    },
    expectedHostBindingPolicySha256: A,
    expectedOperationalUidPolicy: {
      numericUid: 501,
      numericGids,
      groupInventorySha256: await requiredDigest(numericGids),
      privilegeState: "unprivileged-no-sudo-no-root-elevation",
    },
    permittedProcessTopology: [
      {
        processKey: "controller",
        role: "controller",
        parentProcessKey: null,
        identity: controller,
        argumentsSchemaSha256: A,
        environmentSchemaSha256: B,
        descriptorInheritanceSha256: C,
        maximumInstances: 1,
        startOrder: 0,
        terminalExitRequired: true,
      },
      {
        processKey: "helper",
        role: "helper",
        parentProcessKey: "controller",
        identity: executable("helper/1", B),
        argumentsSchemaSha256: B,
        environmentSchemaSha256: C,
        descriptorInheritanceSha256: D,
        maximumInstances: 1,
        startOrder: 1,
        terminalExitRequired: true,
      },
      {
        processKey: "scanner",
        role: "scanner",
        parentProcessKey: "controller",
        identity: executable("scanner/1", C),
        argumentsSchemaSha256: C,
        environmentSchemaSha256: D,
        descriptorInheritanceSha256: E,
        maximumInstances: 1,
        startOrder: 2,
        terminalExitRequired: true,
      },
      {
        processKey: "verifier",
        role: "verifier",
        parentProcessKey: "controller",
        identity: verifier,
        argumentsSchemaSha256: D,
        environmentSchemaSha256: E,
        descriptorInheritanceSha256: F,
        maximumInstances: 1,
        startOrder: 3,
        terminalExitRequired: true,
      },
    ],
    maximumProcessCount: 4,
    maximumConcurrency: 1,
    backgroundProcessPolicy:
      "reject-pre-existing-process-not-in-exact-allowlist",
    controller,
    nodeRuntime: { ...executable("node/24", F), version: "24.6.0" },
    collector: executable("collector/1", E),
    collectionMechanismSha256: F,
    verifier,
    helper,
    scanner,
    trustedRoots: { inventorySha256: A, filesystemPolicySha256: B },
    environmentAllowlist: ["LANG", "TZ"],
    stateMachineProtocol: M9B13E2_STATE_MACHINE_PROTOCOL,
    censusProtocol: M9B13E2_CENSUS_PROTOCOL,
    antiReplayLedger: {
      protocol: M9B13E2_LEDGER_PROTOCOL,
      namespace: "synthetic-m9b13e2-tests",
      trustedInitialRoot: COMMITMENT_A,
    },
    expectedAmendmentProtocol: M9B13E2_AMENDMENT_PROTOCOL,
    expectedSupplementProtocol: M9B13E2_SUPPLEMENT_PROTOCOL,
    checksumInventory,
    checksumInventoryDigest: await requiredDigest(checksumInventory),
    ...changes,
  };
  const packageDigest = await digestM9b13e2ExpectationPackage(base);
  if (!packageDigest.ok) throw new Error(packageDigest.error.reason);
  return { ...base, packageCanonicalDigest: packageDigest.value };
}

function processRecords(
  packageValue: M9b13e2ExpectationPackage,
  sessionCommitment: string,
) {
  return packageValue.permittedProcessTopology.map((expected, index) => ({
    sessionCommitment,
    processKey: expected.processKey,
    processId: 100 + index,
    startTimeIdentity: index % 2 === 0 ? COMMITMENT_B : COMMITMENT_C,
    role: expected.role,
    parentProcessKey: expected.parentProcessKey,
    parentProcessId: expected.parentProcessKey === null ? null : 100,
    executableIdentity: expected.identity,
    numericUid: 501,
    numericGids: packageValue.expectedOperationalUidPolicy.numericGids,
    environmentSha256: expected.environmentSchemaSha256,
  }));
}

async function candidate(
  packageValue: M9b13e2ExpectationPackage,
  ledgerRevision = 0,
  ledgerRoot = COMMITMENT_A,
): Promise<M9b13e2AdmissionCandidate> {
  const sessionInputs: M9b13e2AdmissionCandidate["sessionInputs"] = {
    expectationPackageDigest: packageValue.packageCanonicalDigest,
    hostSessionCommitment: COMMITMENT_B,
    hostBindingPolicySha256: A,
    operationalUidCommitment: COMMITMENT_C,
    operationalIdentity: {
      numericUid: 501,
      numericGids: packageValue.expectedOperationalUidPolicy.numericGids,
      groupInventorySha256:
        packageValue.expectedOperationalUidPolicy.groupInventorySha256,
      privilegeState: "unprivileged-no-sudo-no-root-elevation",
    },
    controllerIdentity: packageValue.controller,
    collectorIdentity: packageValue.collector,
    verifierIdentity: packageValue.verifier,
    collectionMechanismSha256: packageValue.collectionMechanismSha256,
    trustedInputInventorySha256: D,
    trustedRootInventorySha256: packageValue.trustedRoots.inventorySha256,
    filesystemPolicySha256: packageValue.trustedRoots.filesystemPolicySha256,
    environmentAllowlistSha256: await requiredDigest(
      packageValue.environmentAllowlist,
    ),
    stateMachineProtocol: M9B13E2_STATE_MACHINE_PROTOCOL,
    censusProtocol: M9B13E2_CENSUS_PROTOCOL,
    ledgerProtocol: M9B13E2_LEDGER_PROTOCOL,
    ledgerNamespace: packageValue.antiReplayLedger.namespace,
    controllerNonce: COMMITMENT_A,
    monotonicSessionSequence: 1,
    sessionStartTimestamp: WALL,
  };
  const commitment = await deriveM9b13e2SessionCommitment(sessionInputs);
  if (!commitment.ok) throw new Error(commitment.error.reason);
  const sessionCommitment = commitment.value;
  const records = processRecords(packageValue, sessionCommitment);
  const inventorySha256 = await requiredDigest(records);
  const topologySha256 = await requiredDigest(
    records.map((record) => ({
      processKey: record.processKey,
      processId: record.processId,
      startTimeIdentity: record.startTimeIdentity,
      role: record.role,
      parentProcessKey: record.parentProcessKey,
      parentProcessId: record.parentProcessId,
    })),
  );
  const transitions: M9b13e2AdmissionCandidate["transitions"] = [
    ["uninitialized", "preflight"],
    ["preflight", "admitted-clean"],
    ["admitted-clean", "acquisition-active"],
    ["acquisition-active", "verification-active"],
    ["verification-active", "sealed"],
    ["sealed", "closed"],
  ].map(([from, to], index) => ({
    sessionCommitment,
    sequence: index,
    from:
      from === "uninitialized" ||
      from === "preflight" ||
      from === "admitted-clean" ||
      from === "acquisition-active" ||
      from === "verification-active" ||
      from === "sealed"
        ? from
        : "closed",
    to:
      to === "preflight" ||
      to === "admitted-clean" ||
      to === "acquisition-active" ||
      to === "verification-active" ||
      to === "sealed" ||
      to === "closed"
        ? to
        : "closed",
    event: `transition-${index}`,
    wallTimestamp: WALL,
    monotonicTimestampNanos: String((index + 1) * 100),
    evidenceSha256: A,
  }));
  const censusInputs = [
    ["before-session-admission", "admission", 0, 0, 150],
    ["before-consequential-boundary", "boundary-1", 1, 2, 350],
    ["after-helper-or-scanner-completion", "helper-completion-1", 2, 3, 450],
    ["before-sealing", "sealing", 3, 4, 550],
    ["terminal", "terminal", 4, 5, 650],
  ] as const;
  const censuses: M9b13e2AdmissionCandidate["censuses"] = censusInputs.map(
    ([boundaryKind, boundaryIdentity, boundaryOrder, after, time]) => ({
      sessionCommitment,
      censusProtocol: M9B13E2_CENSUS_PROTOCOL,
      collectorIdentity: packageValue.collector,
      boundaryKind,
      boundaryIdentity,
      boundaryOrder,
      afterTransitionSequence: after,
      monotonicSequence: boundaryOrder,
      monotonicTimestampNanos: String(time),
      wallTimestamp: WALL,
      ageMillisAtDecision: 1,
      processRecords: records,
      inventorySha256,
      topologySha256,
      evidenceSha256: E,
    }),
  );
  const unsigned: M9b13e2AdmissionCandidate = {
    protocol: M9B13E2_CANDIDATE_PROTOCOL,
    sessionInputs,
    sessionCommitment,
    transitions,
    censuses,
    consequentialBoundaries: [
      {
        sessionCommitment,
        identity: "boundary-1",
        order: 0,
        afterTransitionSequence: 2,
        monotonicTimestampNanos: "340",
        evidenceSha256: B,
      },
    ],
    processCompletions: [
      {
        sessionCommitment,
        identity: "helper-completion-1",
        order: 0,
        processKey: "helper",
        role: "helper",
        afterTransitionSequence: 3,
        monotonicTimestampNanos: "440",
        evidenceSha256: C,
      },
    ],
    verification: {
      sessionCommitment,
      attemptSequence: 0,
      verifierIdentity: packageValue.verifier,
      result: "pass",
      evidenceSha256: F,
      monotonicTimestampNanos: "570",
      wallTimestamp: WALL,
    },
    maximumCensusAgeMillis: 50,
    preAdmissionEffects: {
      networkRequests: 0,
      durableAcquisitionWrites: 0,
      downloads: 0,
      imageOperations: 0,
      credentialAccesses: 0,
      providerOrModelCalls: 0,
    },
    ledgerExpectation: {
      protocol: M9B13E2_LEDGER_PROTOCOL,
      namespace: packageValue.antiReplayLedger.namespace,
      expectedRevision: ledgerRevision,
      expectedRoot: ledgerRoot,
    },
    canonicalCandidateDigest: ZERO,
  };
  return sealCandidate(unsigned);
}

async function sealCandidate(
  value: M9b13e2AdmissionCandidate,
): Promise<M9b13e2AdmissionCandidate> {
  const digest = await digestM9b13e2AdmissionCandidate(value);
  if (!digest.ok) throw new Error(digest.error.reason);
  return { ...value, canonicalCandidateDigest: digest.value };
}

async function rebindCandidate(
  value: M9b13e2AdmissionCandidate,
  sessionInputs: M9b13e2AdmissionCandidate["sessionInputs"],
): Promise<M9b13e2AdmissionCandidate> {
  const commitment = await deriveM9b13e2SessionCommitment(sessionInputs);
  if (!commitment.ok) throw new Error(commitment.error.reason);
  const sessionCommitment = commitment.value;
  const rebound: M9b13e2AdmissionCandidate = {
    ...value,
    sessionInputs,
    sessionCommitment,
    transitions: value.transitions.map((entry) => ({
      ...entry,
      sessionCommitment,
    })),
    censuses: value.censuses.map((entry) => ({
      ...entry,
      sessionCommitment,
      processRecords: entry.processRecords.map((process) => ({
        ...process,
        sessionCommitment,
      })),
    })),
    consequentialBoundaries: value.consequentialBoundaries.map((entry) => ({
      ...entry,
      sessionCommitment,
    })),
    processCompletions: value.processCompletions.map((entry) => ({
      ...entry,
      sessionCommitment,
    })),
    verification: {
      ...value.verification,
      sessionCommitment,
      verifierIdentity: sessionInputs.verifierIdentity,
    },
  };
  const censuses = await Promise.all(
    rebound.censuses.map(async (entry) => ({
      ...entry,
      inventorySha256: await requiredDigest(entry.processRecords),
      topologySha256: await requiredDigest(
        entry.processRecords.map((record) => ({
          processKey: record.processKey,
          processId: record.processId,
          startTimeIdentity: record.startTimeIdentity,
          role: record.role,
          parentProcessKey: record.parentProcessKey,
          parentProcessId: record.parentProcessId,
        })),
      ),
    })),
  );
  return sealCandidate({ ...rebound, censuses });
}

async function stoppedCandidate(
  value: M9b13e2AdmissionCandidate,
  verificationResult: "fail" | "not-performed" | "unavailable",
): Promise<M9b13e2AdmissionCandidate> {
  const first = value.transitions.at(0);
  const second = value.transitions.at(1);
  const third = value.transitions.at(2);
  const initialCensus = value.censuses.at(0);
  const terminalCensus = value.censuses.at(4);
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    initialCensus === undefined ||
    terminalCensus === undefined
  )
    throw new Error("synthetic stopped fixture prerequisites missing");
  const transitions: M9b13e2AdmissionCandidate["transitions"] = [
    {
      ...first,
      sequence: 0,
      from: "uninitialized",
      to: "preflight",
      monotonicTimestampNanos: "100",
    },
    {
      ...second,
      sequence: 1,
      from: "preflight",
      to: "quarantined",
      monotonicTimestampNanos: "200",
    },
    {
      ...third,
      sequence: 2,
      from: "quarantined",
      to: "closed",
      monotonicTimestampNanos: "300",
    },
  ];
  const censuses: M9b13e2AdmissionCandidate["censuses"] = [
    {
      ...initialCensus,
      boundaryKind: "before-session-admission",
      boundaryIdentity: "admission",
      boundaryOrder: 0,
      afterTransitionSequence: 0,
      monotonicSequence: 0,
      monotonicTimestampNanos: "150",
    },
    {
      ...terminalCensus,
      boundaryKind: "terminal",
      boundaryIdentity: "terminal",
      boundaryOrder: 1,
      afterTransitionSequence: 2,
      monotonicSequence: 1,
      monotonicTimestampNanos: "350",
    },
  ];
  return sealCandidate({
    ...value,
    transitions,
    censuses,
    consequentialBoundaries: [],
    processCompletions: [],
    verification: {
      ...value.verification,
      result: verificationResult,
      evidenceSha256: verificationResult === "fail" ? F : null,
      monotonicTimestampNanos: "250",
    },
  });
}

async function setup() {
  const packageValue = await expectationPackage();
  const ledger = createSyntheticM9b13e2Ledger(
    packageValue.antiReplayLedger.namespace,
    packageValue.antiReplayLedger.trustedInitialRoot,
  );
  const harness = await createSyntheticM9b13e2AdmissionHarness(
    packageValue,
    D,
    ledger.store,
  );
  if (!harness.ok) throw new Error(harness.error.reason);
  return {
    packageValue,
    ledger,
    harness: harness.value,
    candidate: await candidate(packageValue),
  };
}

function validSupplement(): M9b13e2Supplement {
  return {
    protocol: M9B13E2_SUPPLEMENT_PROTOCOL,
    supplementPackageIdentity: "future-supplement-package-v1",
    supplementPackageDigest: A,
    prospective: true,
    amendedAssumption: M9B13E2_AMENDED_ASSUMPTION,
    nonclaim: M9B13E2_NONCLAIM,
    retainedScope: M9B13E2_RETAINED_SCOPE,
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
    historicalNoGos: [
      "M9b.13",
      "M9b.13a",
      "M9b.13b",
      "M9b.13c",
      "M9b.13d",
      "M9b.13d.1",
      "M9b.13e-and-independent-review",
      "M9b.13e.1-and-independent-review",
    ],
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
    independentPreSubmissionReview: {
      protocol: M9B13E2_SUPPLEMENT_REVIEW_PROTOCOL,
      reviewPackageIdentity: "future-independent-review-v1",
      reviewPackageDigest: B,
      reviewedSupplementPackageDigest: A,
      reviewedCommit: "3".repeat(40),
      reviewedTree: "4".repeat(40),
      reviewerIdentityCommitment: COMMITMENT_C,
      decision: "pass",
      reviewEvidenceSha256: C,
      checksumManifestSha256: D,
      timestamp: "2026-08-07T12:00:00.000Z",
      precededSubmissionAuthorization: true,
    },
    submissionAuthorizationTimestamp: "2026-08-07T13:00:00.000Z",
    attachmentInventorySha256: E,
    serverSubmissionTimestamp: "2026-08-07T14:00:00.000Z",
    approvalTimestamp: "2026-08-07T15:00:00.000Z",
    independentPostUploadByteVerification: true,
    appendOnlyLocalReceiptRequired: true,
    separateSubmissionAuthorizationRequired: true,
    separateApprovalAuthorizationRequired: true,
    supplementApprovalGrantsCorpusOrAcquisitionAuthority: false,
  };
}

describe("M9b.13e.2 authority separation", () => {
  it("keeps live positive authority unavailable and always stops with zero effects", async () => {
    const { candidate: candidateValue } = await setup();
    expect(M9B13E2_LIVE_POSITIVE_AUTHORITY).toBeNull();
    expect(attemptLiveM9b13e2Admission(candidateValue)).toEqual({
      protocol: M9B13E2_AUTHORITY_ADMISSION_PROTOCOL,
      decision: "trusted-session-no-effect-stop",
      reason: "positive-readiness-authority-unavailable",
      acceptedAdmission: false,
      effects: {
        networkRequests: 0,
        durableAcquisitionWrites: 0,
        downloads: 0,
        imageOperations: 0,
        credentialAccesses: 0,
        providerOrModelCalls: 0,
      },
    });
  });

  it("admits only through the explicitly synthetic authority harness", async () => {
    const fixture = await setup();
    expect(fixture.harness.protocol).toBe(M9B13E2_SYNTHETIC_AUTHORITY_PROTOCOL);
    const result = await fixture.harness.attempt(fixture.candidate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.decision).toBe("trusted-session-admitted");
    expect(result.receipt.independentVerification).toBe("pass");
    expect(
      fixture.ledger.snapshot().events.map((event) => event.status),
    ).toEqual(["reserved", "admitted"]);
  });

  it("keeps structural validation nonauthoritative", async () => {
    const fixture = await setup();
    const admission = await fixture.harness.attempt(fixture.candidate);
    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    const result = await validateM9b13e2ReceiptStructure(admission.receipt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.grantsAdmissionAuthority).toBe(false);
    expect(JSON.stringify(result.value)).not.toContain(
      "trusted-session-admitted",
    );
  });
});

describe("M9b.13e.2 expectation and authority bindings", () => {
  it("validates an exact checksum-bound synthetic expectation package", async () => {
    expect(
      (await validateM9b13e2ExpectationPackage(await expectationPackage())).ok,
    ).toBe(true);
  });

  it("rejects an unreviewed expectation package", async () => {
    const packageValue = await expectationPackage();
    expect(
      (
        await validateM9b13e2ExpectationPackage({
          ...packageValue,
          independentReview: {
            ...packageValue.independentReview,
            acceptedDecision: "pending",
          },
        })
      ).ok,
    ).toBe(false);
  });

  it("rejects expectations copied from a substituted receipt and alternate host/controller", async () => {
    const fixture = await setup();
    const changedInputs = {
      ...fixture.candidate.sessionInputs,
      expectationPackageDigest: F,
      hostBindingPolicySha256: F,
      controllerIdentity: executable("alternate-controller/1", F),
    };
    const changed = await rebindCandidate(fixture.candidate, changedInputs);
    const result = await fixture.harness.attempt(changed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("expectation-package-mismatch");
  });

  it.each([
    ["wrong expectation-package digest", "expectationPackageDigest", F],
    ["wrong host policy", "hostBindingPolicySha256", F],
    ["wrong trusted roots", "trustedRootInventorySha256", F],
  ] as const)("rejects %s", async (_label, field, replacement) => {
    const fixture = await setup();
    const changed = await rebindCandidate(fixture.candidate, {
      ...fixture.candidate.sessionInputs,
      [field]: replacement,
    });
    const result = await fixture.harness.attempt(changed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("expectation-package-mismatch");
  });

  it("rejects UID group and privilege drift", async () => {
    const fixture = await setup();
    const groupDrift = await rebindCandidate(fixture.candidate, {
      ...fixture.candidate.sessionInputs,
      operationalIdentity: {
        ...fixture.candidate.sessionInputs.operationalIdentity,
        numericGids: [20, 502],
        groupInventorySha256: F,
      },
    });
    expect(await fixture.harness.attempt(groupDrift)).toMatchObject({
      ok: false,
      reason: "expectation-package-mismatch",
    });
    expect(
      await fixture.harness.attempt({
        ...fixture.candidate,
        sessionInputs: {
          ...fixture.candidate.sessionInputs,
          operationalIdentity: {
            ...fixture.candidate.sessionInputs.operationalIdentity,
            privilegeState: "root",
          },
        },
      }),
    ).toMatchObject({
      ok: false,
      reason: "malformed-or-inconsistent-evidence",
    });
  });

  it.each([
    ["collector", "collectorIdentity", executable("wrong-collector/1", F)],
    ["verifier", "verifierIdentity", executable("wrong-verifier/1", F)],
  ] as const)("rejects the wrong %s", async (_label, field, replacement) => {
    const fixture = await setup();
    const changed = await rebindCandidate(fixture.candidate, {
      ...fixture.candidate.sessionInputs,
      [field]: replacement,
    });
    const result = await fixture.harness.attempt(changed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(
      field === "collectorIdentity"
        ? "collector-mismatch"
        : "verifier-mismatch",
    );
  });

  it("rejects the wrong trusted-input inventory", async () => {
    const fixture = await setup();
    const changed = await rebindCandidate(fixture.candidate, {
      ...fixture.candidate.sessionInputs,
      trustedInputInventorySha256: F,
    });
    const result = await fixture.harness.attempt(changed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("trusted-input-inventory-mismatch");
  });

  it("rejects a self-consistent alternate helper inventory", async () => {
    const fixture = await setup();
    const censuses = await Promise.all(
      fixture.candidate.censuses.map(async (entry) => {
        const processRecords = entry.processRecords.map((process) =>
          process.processKey === "helper"
            ? {
                ...process,
                executableIdentity: executable("alternate-helper/1", F),
              }
            : process,
        );
        return {
          ...entry,
          processRecords,
          inventorySha256: await requiredDigest(processRecords),
          topologySha256: await requiredDigest(
            processRecords.map((record) => ({
              processKey: record.processKey,
              processId: record.processId,
              startTimeIdentity: record.startTimeIdentity,
              role: record.role,
              parentProcessKey: record.parentProcessKey,
              parentProcessId: record.parentProcessId,
            })),
          ),
        };
      }),
    );
    const changed = await sealCandidate({ ...fixture.candidate, censuses });
    const result = await fixture.harness.attempt(changed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("expectation-package-mismatch");
  });
});

describe("M9b.13e.2 exact verification and state lineage", () => {
  it.each(["fail", "not-performed", "unavailable"] as const)(
    "stops when independent verification is %s",
    async (verificationResult) => {
      const fixture = await setup();
      const changed = await stoppedCandidate(
        fixture.candidate,
        verificationResult,
      );
      const result = await fixture.harness.attempt(changed);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("independent-verification-not-pass");
      expect(result.effects.networkRequests).toBe(0);
      expect(result.receipt).toBeDefined();
      const structural =
        result.receipt === undefined
          ? { ok: false }
          : await validateM9b13e2ReceiptStructure(result.receipt);
      expect(structural.ok).toBe(true);
    },
  );

  it("rejects missing independent verification and hostile candidate keys", async () => {
    const fixture = await setup();
    const { verification: omitted, ...missing } = fixture.candidate;
    void omitted;
    const missingResult = await fixture.harness.attempt(missing);
    expect(missingResult).toMatchObject({
      ok: false,
      reason: "malformed-or-inconsistent-evidence",
    });
    const hostileResult = await fixture.harness.attempt({
      ...fixture.candidate,
      constructor: "hostile",
    });
    expect(hostileResult.ok).toBe(false);
  });

  it("rejects a pre-admission effect", async () => {
    const fixture = await setup();
    const result = await fixture.harness.attempt({
      ...fixture.candidate,
      preAdmissionEffects: {
        ...fixture.candidate.preAdmissionEffects,
        networkRequests: 1,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("malformed-or-inconsistent-evidence");
  });

  it.each([
    ["disconnected edge", 2, { from: "verification-active" }],
    ["non-uninitialized first state", 0, { from: "preflight" }],
    ["skipped state", 1, { to: "acquisition-active" }],
    ["duplicate edge", 2, { from: "preflight", to: "admitted-clean" }],
    ["reordered edge", 3, { from: "verification-active", to: "sealed" }],
  ] as const)("rejects a %s", async (_label, index, changes) => {
    const fixture = await setup();
    const transitions = fixture.candidate.transitions.map(
      (entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...changes } : entry,
    );
    const changed = await sealCandidate({
      ...fixture.candidate,
      transitions,
    });
    const result = await fixture.harness.attempt(changed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("malformed-or-inconsistent-evidence");
  });

  it("rejects non-increasing transition sequence and monotonic time", async () => {
    for (const kind of ["sequence", "time"] as const) {
      const fixture = await setup();
      const transitions = fixture.candidate.transitions.map((entry, index) =>
        index === 2
          ? {
              ...entry,
              ...(kind === "sequence"
                ? { sequence: 1 }
                : { monotonicTimestampNanos: "200" }),
            }
          : entry,
      );
      const changed = await sealCandidate({
        ...fixture.candidate,
        transitions,
      });
      const result = await fixture.harness.attempt(changed);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe("malformed-or-inconsistent-evidence");
    }
  });
});

describe("M9b.13e.2 census rederivation", () => {
  it("rejects a census from another session", async () => {
    const fixture = await setup();
    const changed = await sealCandidate({
      ...fixture.candidate,
      censuses: fixture.candidate.censuses.map((entry, index) =>
        index === 1 ? { ...entry, sessionCommitment: COMMITMENT_A } : entry,
      ),
    });
    const result = await fixture.harness.attempt(changed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("malformed-or-inconsistent-evidence");
  });

  it("rejects stale census and caller-selected inventory digests", async () => {
    for (const kind of ["stale", "digest"] as const) {
      const fixture = await setup();
      const censuses = fixture.candidate.censuses.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              ...(kind === "stale"
                ? { ageMillisAtDecision: 51 }
                : { inventorySha256: F }),
            }
          : entry,
      );
      const changed = await sealCandidate({ ...fixture.candidate, censuses });
      const result = await fixture.harness.attempt(changed);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe("malformed-or-inconsistent-evidence");
    }
  });

  it("rejects a completion process absent from topology", async () => {
    const fixture = await setup();
    const changed = await sealCandidate({
      ...fixture.candidate,
      processCompletions: fixture.candidate.processCompletions.map((entry) => ({
        ...entry,
        processKey: "missing-helper",
      })),
    });
    const result = await fixture.harness.attempt(changed);
    expect(result.ok).toBe(false);
  });

  it("rejects a parent key whose parent PID names another process", async () => {
    const fixture = await setup();
    const censuses = await Promise.all(
      fixture.candidate.censuses.map(async (entry) => {
        const processRecords = entry.processRecords.map((process) =>
          process.processKey === "helper"
            ? { ...process, parentProcessId: 102 }
            : process,
        );
        return {
          ...entry,
          processRecords,
          inventorySha256: await requiredDigest(processRecords),
          topologySha256: await requiredDigest(
            processRecords.map((record) => ({
              processKey: record.processKey,
              processId: record.processId,
              startTimeIdentity: record.startTimeIdentity,
              role: record.role,
              parentProcessKey: record.parentProcessKey,
              parentProcessId: record.parentProcessId,
            })),
          ),
        };
      }),
    );
    const changed = await sealCandidate({ ...fixture.candidate, censuses });
    expect(await fixture.harness.attempt(changed)).toMatchObject({
      ok: false,
      reason: "malformed-or-inconsistent-evidence",
    });
  });

  it("rejects duplicate and missing boundary census", async () => {
    for (const kind of ["duplicate", "missing"] as const) {
      const fixture = await setup();
      const censuses =
        kind === "duplicate"
          ? [
              ...fixture.candidate.censuses.slice(0, 1),
              ...fixture.candidate.censuses,
            ]
          : fixture.candidate.censuses.filter(
              (entry) => entry.boundaryIdentity !== "boundary-1",
            );
      const changed = await sealCandidate({
        ...fixture.candidate,
        censuses,
      });
      const result = await fixture.harness.attempt(changed);
      expect(result.ok).toBe(false);
    }
  });
});

describe("M9b.13e.2 durable anti-replay ledger", () => {
  it("rejects replayed commitments and terminal reopening", async () => {
    const fixture = await setup();
    const first = await fixture.harness.attempt(fixture.candidate);
    expect(first.ok).toBe(true);
    const second = await fixture.harness.attempt(fixture.candidate);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("terminal-session-reopening");
    expect(second.effects.networkRequests).toBe(0);
  });

  it("rejects stale ledger revision and root", async () => {
    const fixture = await setup();
    const changed = await sealCandidate({
      ...fixture.candidate,
      ledgerExpectation: {
        ...fixture.candidate.ledgerExpectation,
        expectedRevision: 1,
      },
    });
    const result = await fixture.harness.attempt(changed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("stale-ledger-revision-or-root");
  });

  it("rejects a conflicting concurrent reservation", async () => {
    const fixture = await setup();
    fixture.ledger.setNextFault("next-conflict");
    const result = await fixture.harness.attempt(fixture.candidate);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("conflicting-concurrent-reservation");
  });

  it("fails closed on ambiguous persistence and never retries", async () => {
    const fixture = await setup();
    fixture.ledger.setNextFault("next-ambiguous-after-write");
    const first = await fixture.harness.attempt(fixture.candidate);
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.reason).toBe("persistence-ambiguous");
    const second = await fixture.harness.attempt(fixture.candidate);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("replayed-session-commitment");
    expect(second.effects).toEqual(first.effects);
  });
});

describe("M9b.13e.2 completed supplement schema", () => {
  it("accepts the exact future-only contract", () => {
    expect(validateM9b13e2Supplement(validSupplement()).ok).toBe(true);
  });

  it("rejects missing or altered amended assumption", () => {
    const supplement = validSupplement();
    const { amendedAssumption: omitted, ...missing } = supplement;
    void omitted;
    expect(validateM9b13e2Supplement(missing).ok).toBe(false);
    expect(
      validateM9b13e2Supplement({
        ...supplement,
        amendedAssumption: "altered",
      }).ok,
    ).toBe(false);
  });

  it("rejects missing, failed, self, or different-digest review", () => {
    const supplement = validSupplement();
    const { independentPreSubmissionReview: omitted, ...missing } = supplement;
    void omitted;
    expect(validateM9b13e2Supplement(missing).ok).toBe(false);
    expect(
      validateM9b13e2Supplement({
        ...supplement,
        independentPreSubmissionReview: {
          ...supplement.independentPreSubmissionReview,
          decision: "fail",
        },
      }).ok,
    ).toBe(false);
    expect(
      validateM9b13e2Supplement({
        ...supplement,
        independentPreSubmissionReview: {
          ...supplement.independentPreSubmissionReview,
          reviewPackageIdentity: supplement.supplementPackageIdentity,
        },
      }).ok,
    ).toBe(false);
    expect(
      validateM9b13e2Supplement({
        ...supplement,
        independentPreSubmissionReview: {
          ...supplement.independentPreSubmissionReview,
          reviewedSupplementPackageDigest: F,
        },
      }).ok,
    ).toBe(false);
  });

  it("rejects review after authorization, changed registration identity, and hostile keys", () => {
    const supplement = validSupplement();
    expect(
      validateM9b13e2Supplement({
        ...supplement,
        independentPreSubmissionReview: {
          ...supplement.independentPreSubmissionReview,
          timestamp: "2026-08-07T13:00:00.000Z",
        },
      }).ok,
    ).toBe(false);
    expect(
      validateM9b13e2Supplement({
        ...supplement,
        registration: { ...supplement.registration, immutableFiles: [] },
      }).ok,
    ).toBe(false);
    expect(
      validateM9b13e2Supplement({ ...supplement, constructor: "hostile" }).ok,
    ).toBe(false);
  });
});
