import { canonicalizeJson, digestValue, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

export const M9B13E1_TRUSTED_SESSION_READINESS_PROTOCOL =
  "lachesis-m9b13e1-trusted-controlled-host-session-readiness/1" as const;
export const M9B13E1_EMBARGO_SUPPLEMENT_PROTOCOL =
  "lachesis-m9b13e1-append-only-embargo-compatible-operational-supplement/1" as const;
export const M9B13E1_NONCLAIM =
  "The study does not establish security against compromise of the trusted local host, acquisition account, controller, kernel, administrator, hypervisor, or pre-start local code, tool, and runtime installation." as const;
export const M9B13E1_RETAINED_SCOPE =
  "Ordinary operator error, accidental controller or helper races, malformed or adversarial external bytes, artifact substitution, partial persistence, retired-corpus exposure, contamination, and failure to establish or retain the trusted-session readiness invariant remain in scope and fail closed." as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const opaqueCommitmentSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const timestampSchema = z.iso.datetime({ offset: true });
const nonemptySchema = z.string().min(1);

const executableIdentitySchema = z.strictObject({
  protocol: nonemptySchema,
  sourceSha256: sha256Schema,
  buildReceiptSha256: sha256Schema,
  executableSha256: sha256Schema,
});

const helperBuildIdentitySchema = z.strictObject({
  protocol: nonemptySchema,
  sourceSha256: sha256Schema,
  compilerPathCommitment: opaqueCommitmentSchema,
  compilerVersion: nonemptySchema,
  compilerSha256: sha256Schema,
  sdkSysrootCommitment: opaqueCommitmentSchema,
  sdkVersion: nonemptySchema,
  sdkSha256: sha256Schema,
  compilerFlags: z.array(nonemptySchema).min(1),
  linkerFlags: z.array(nonemptySchema),
  buildEnvironmentSha256: sha256Schema,
  linkedLibraries: z.array(
    z.strictObject({ identity: nonemptySchema, sha256: sha256Schema }),
  ),
  reproducibleBuildReceiptSha256: sha256Schema,
  executableSha256: sha256Schema,
  supportedHost: z.strictObject({
    operatingSystem: nonemptySchema,
    kernel: nonemptySchema,
    architecture: nonemptySchema,
    filesystem: nonemptySchema,
  }),
  invocationContractSha256: sha256Schema,
  exitCodeContractSha256: sha256Schema,
});

const permittedProcessSchema = z.strictObject({
  id: nonemptySchema,
  role: z.enum(["controller", "helper", "scanner", "verifier"]),
  parentId: nonemptySchema.nullable(),
  identity: executableIdentitySchema,
  argumentsSchemaSha256: sha256Schema,
  environmentSchemaSha256: sha256Schema,
  descriptorInheritanceSha256: sha256Schema,
  maximumInstances: z.number().int().positive(),
  startOrder: z.number().int().nonnegative(),
  terminalExitRequired: z.literal(true),
});

const hostBindingSchema = z.strictObject({
  hostIdentityCommitment: opaqueCommitmentSchema,
  architecture: nonemptySchema,
  operatingSystemName: nonemptySchema,
  operatingSystemVersion: nonemptySchema,
  kernelVersion: nonemptySchema,
  kernelBuild: nonemptySchema,
  bootSessionIdentityCommitment: opaqueCommitmentSchema,
  operationalRoots: z
    .array(
      z.strictObject({
        rootCommitment: opaqueCommitmentSchema,
        filesystemType: nonemptySchema,
        deviceIdentityCommitment: opaqueCommitmentSchema,
      }),
    )
    .min(1),
  clockSource: nonemptySchema,
  wallTimestamp: timestampSchema,
  monotonicTimestampNanos: z.string().regex(/^[0-9]+$/u),
  trustedHostPolicySha256: sha256Schema,
  readinessImplementation: executableIdentitySchema,
});

const operationalIdentitySchema = z.strictObject({
  numericUid: z.number().int().nonnegative(),
  principalCommitment: opaqueCommitmentSchema,
  realUid: z.number().int().nonnegative(),
  effectiveUid: z.number().int().nonnegative(),
  savedUid: z.number().int().nonnegative(),
  groupInventorySha256: sha256Schema,
  supplementaryGroupPolicy: z.literal("exact-digest-no-drift"),
  privilegeState: z.literal("unprivileged-no-sudo-no-root-elevation"),
  accountSessionCommitment: opaqueCommitmentSchema,
  identityChangesPermitted: z.literal(false),
});

const censusCheckpointSchema = z.enum([
  "before-session-admission",
  "before-consequential-boundary",
  "after-helper-or-scanner-completion",
  "before-sealing",
  "terminal",
]);

const censusPolicySchema = z.strictObject({
  dataSource: nonemptySchema,
  enumerationMethod: nonemptySchema,
  executableIdentityMethod: nonemptySchema,
  parentChildReconstructionMethod: nonemptySchema,
  shortLivedProcessMethod: nonemptySchema,
  maximumAgeMillis: z.number().int().nonnegative(),
  checkpoints: z.array(censusCheckpointSchema).length(5),
  backgroundProcessPolicy: z.literal(
    "reject-pre-existing-process-not-in-exact-allowlist",
  ),
  continuousObservationRequired: z.boolean(),
  continuousObservationProven: z.boolean(),
  evidenceSchemaSha256: sha256Schema,
});

const censusSnapshotSchema = z.strictObject({
  checkpoint: censusCheckpointSchema,
  subjectIdentity: nonemptySchema.nullable(),
  wallTimestamp: timestampSchema,
  monotonicTimestampNanos: z.string().regex(/^[0-9]+$/u),
  ageMillisAtDecision: z.number().int().nonnegative(),
  processInventorySha256: sha256Schema,
  parentChildTopologySha256: sha256Schema,
  shortLivedProcessCoverage: z.literal("complete"),
  evidenceSha256: sha256Schema,
});

const sessionStateSchema = z.enum([
  "uninitialized",
  "preflight",
  "admitted-clean",
  "acquisition-active",
  "verification-active",
  "sealed",
  "quarantined",
  "closed",
]);

const transitionSchema = z.strictObject({
  from: sessionStateSchema,
  to: sessionStateSchema,
  event: nonemptySchema,
  wallTimestamp: timestampSchema,
  monotonicTimestampNanos: z.string().regex(/^[0-9]+$/u),
  evidenceSha256: sha256Schema,
});

const trustedInventorySchema = z.strictObject({
  controller: executableIdentitySchema,
  nodeRuntime: executableIdentitySchema.extend({ version: nonemptySchema }),
  helper: helperBuildIdentitySchema,
  scanner: executableIdentitySchema,
  protocolsAndSchemasSha256: sha256Schema,
  trustedKeyringSha256: sha256Schema,
  acquisitionConfigurationSha256: sha256Schema,
  privateRootInventorySha256: sha256Schema,
  everyInvokedExecutableSha256: sha256Schema,
  environmentAllowlist: z.array(nonemptySchema),
});

const effectCountersSchema = z.strictObject({
  networkRequests: z.number().int().nonnegative(),
  durableAcquisitionWrites: z.number().int().nonnegative(),
  downloads: z.number().int().nonnegative(),
  imageOperations: z.number().int().nonnegative(),
  credentialAccesses: z.number().int().nonnegative(),
  providerOrModelCalls: z.number().int().nonnegative(),
});

export const m9b13e1TrustedSessionReceiptSchema = z.strictObject({
  protocol: z.literal(M9B13E1_TRUSTED_SESSION_READINESS_PROTOCOL),
  decision: z.enum([
    "trusted-session-admitted",
    "trusted-session-no-effect-stop",
  ]),
  host: hostBindingSchema,
  operationalIdentity: operationalIdentitySchema,
  permittedProcesses: z.array(permittedProcessSchema).min(1),
  maximumProcessCount: z.number().int().positive(),
  maximumConcurrency: z.literal(1),
  censusPolicy: censusPolicySchema,
  consequentialBoundaries: z.array(
    z.strictObject({
      identity: nonemptySchema,
      order: z.number().int().nonnegative(),
    }),
  ),
  processCompletions: z.array(
    z.strictObject({
      identity: nonemptySchema,
      processId: nonemptySchema,
      role: z.enum(["helper", "scanner"]),
    }),
  ),
  censusSnapshots: z.array(censusSnapshotSchema).min(1),
  unexpectedProcesses: z.array(
    z.strictObject({
      processIdentityCommitment: opaqueCommitmentSchema,
      evidenceSha256: sha256Schema,
    }),
  ),
  trustedInventory: trustedInventorySchema,
  session: z.strictObject({
    sessionIdentityCommitment: opaqueCommitmentSchema,
    transitions: z.array(transitionSchema).min(1),
    finalState: sessionStateSchema,
    interrupted: z.boolean(),
    invariantLostAfterAdmission: z.boolean(),
    stopReasons: z.array(nonemptySchema),
    priorFailedSessionReused: z.literal(false),
    restartPermitted: z.literal(false),
  }),
  stopGate: z.strictObject({
    evaluatedBeforeNetworkOrDurableEffect: z.literal(true),
    noNewRequestAfterStop: z.literal(true),
    inFlightCancellationAttemptedOnInvariantLoss: z.literal(true),
    acceptedSealWritten: z.boolean(),
    partialStateQuarantined: z.boolean(),
    retries: z.literal(0),
    freshAdmissionRequiredAfterStop: z.literal(true),
    effectBeforeAdmission: z.boolean(),
    effectCounters: effectCountersSchema,
  }),
  evidence: z.strictObject({
    inputBindingsSha256: sha256Schema,
    permittedProcessInventorySha256: sha256Schema,
    unexpectedProcessInventorySha256: sha256Schema,
    trustedRootInventorySha256: sha256Schema,
    transitionInventorySha256: sha256Schema,
    failureOrStopReasonSha256: sha256Schema,
    effectAccountingSha256: sha256Schema,
    independentVerification: z.enum(["pass", "fail", "not-performed"]),
    canonicalReceiptDigest: sha256Schema,
  }),
  nonclaim: z.literal(M9B13E1_NONCLAIM),
  retainedScope: z.literal(M9B13E1_RETAINED_SCOPE),
});

export type M9b13e1TrustedSessionReceipt = z.infer<
  typeof m9b13e1TrustedSessionReceiptSchema
>;

export const m9b13e1ReadinessExpectationsSchema = z.strictObject({
  host: hostBindingSchema,
  operationalIdentity: operationalIdentitySchema,
  permittedProcesses: z.array(permittedProcessSchema).min(1),
  maximumProcessCount: z.number().int().positive(),
  censusPolicy: censusPolicySchema,
  trustedInventory: trustedInventorySchema,
});

export type M9b13e1ReadinessExpectations = z.infer<
  typeof m9b13e1ReadinessExpectationsSchema
>;

type ValidationFailure = Readonly<{
  kind: "m9b13e1-contract-invalid";
  reason: string;
}>;

type ValidationResult<T> = Result<T, ValidationFailure>;

function failure<T>(reason: string): ValidationResult<T> {
  return {
    ok: false,
    error: { kind: "m9b13e1-contract-invalid", reason },
  };
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftCanonical = canonicalizeJson(left);
  const rightCanonical = canonicalizeJson(right);
  return (
    leftCanonical.ok &&
    rightCanonical.ok &&
    leftCanonical.value === rightCanonical.value
  );
}

function isLegalTransition(
  from: z.infer<typeof sessionStateSchema>,
  to: z.infer<typeof sessionStateSchema>,
): boolean {
  switch (from) {
    case "uninitialized":
      return to === "preflight";
    case "preflight":
      return to === "admitted-clean" || to === "quarantined";
    case "admitted-clean":
      return to === "acquisition-active" || to === "quarantined";
    case "acquisition-active":
      return to === "verification-active" || to === "quarantined";
    case "verification-active":
      return to === "sealed" || to === "quarantined";
    case "sealed":
      return to === "closed";
    case "quarantined":
      return to === "closed";
    case "closed":
      return false;
  }
}

function allEffectCountersZero(
  counters: z.infer<typeof effectCountersSchema>,
): boolean {
  return Object.values(counters).every((value) => value === 0);
}

function receiptDigestProjection(
  receipt: M9b13e1TrustedSessionReceipt,
): Readonly<Record<string, unknown>> {
  const { canonicalReceiptDigest: omitted, ...evidence } = receipt.evidence;
  void omitted;
  return { ...receipt, evidence };
}

export async function digestM9b13e1TrustedSessionReceipt(
  receipt: M9b13e1TrustedSessionReceipt,
): Promise<ValidationResult<string>> {
  const digest = await digestValue(receiptDigestProjection(receipt));
  return digest.ok
    ? { ok: true, value: digest.value }
    : failure("m9b13e1:receipt-canonicalization-failed");
}

export async function validateM9b13e1TrustedSessionReceipt(
  value: unknown,
  expectationsValue: unknown,
): Promise<ValidationResult<M9b13e1TrustedSessionReceipt>> {
  const parsed = m9b13e1TrustedSessionReceiptSchema.safeParse(value);
  const expectations =
    m9b13e1ReadinessExpectationsSchema.safeParse(expectationsValue);
  if (!parsed.success || !expectations.success)
    return failure("m9b13e1:schema-or-hostile-key-rejected");
  const receipt = parsed.data;
  const expected = expectations.data;
  if (!canonicalEqual(receipt.host, expected.host))
    return failure("m9b13e1:host-identity-mismatch");
  if (
    !canonicalEqual(receipt.operationalIdentity, expected.operationalIdentity)
  )
    return failure("m9b13e1:operational-identity-mismatch");
  if (
    receipt.operationalIdentity.realUid !==
      receipt.operationalIdentity.numericUid ||
    receipt.operationalIdentity.effectiveUid !==
      receipt.operationalIdentity.numericUid ||
    receipt.operationalIdentity.savedUid !==
      receipt.operationalIdentity.numericUid
  )
    return failure("m9b13e1:uid-drift");
  if (
    !canonicalEqual(receipt.permittedProcesses, expected.permittedProcesses) ||
    receipt.maximumProcessCount !== expected.maximumProcessCount
  )
    return failure("m9b13e1:process-topology-mismatch");
  if (!canonicalEqual(receipt.censusPolicy, expected.censusPolicy))
    return failure("m9b13e1:census-policy-mismatch");
  if (
    receipt.censusPolicy.continuousObservationRequired &&
    !receipt.censusPolicy.continuousObservationProven &&
    receipt.decision === "trusted-session-admitted"
  )
    return failure("m9b13e1:required-continuous-observation-unproven");
  const requiredCheckpoints = new Set(censusCheckpointSchema.options);
  const uncoveredBoundaries = new Set(
    receipt.consequentialBoundaries.map((boundary) => boundary.identity),
  );
  const uncoveredCompletions = new Set(
    receipt.processCompletions.map((completion) => completion.identity),
  );
  for (const snapshot of receipt.censusSnapshots) {
    requiredCheckpoints.delete(snapshot.checkpoint);
    if (
      snapshot.checkpoint === "before-consequential-boundary" &&
      snapshot.subjectIdentity !== null
    )
      uncoveredBoundaries.delete(snapshot.subjectIdentity);
    if (
      snapshot.checkpoint === "after-helper-or-scanner-completion" &&
      snapshot.subjectIdentity !== null
    )
      uncoveredCompletions.delete(snapshot.subjectIdentity);
    if (snapshot.ageMillisAtDecision > receipt.censusPolicy.maximumAgeMillis)
      return failure("m9b13e1:stale-census");
    if (
      snapshot.processInventorySha256 !==
      receipt.evidence.permittedProcessInventorySha256
    )
      return failure("m9b13e1:census-process-inventory-mismatch");
  }
  if (requiredCheckpoints.size !== 0)
    return failure("m9b13e1:missing-census-checkpoint");
  if (uncoveredBoundaries.size !== 0 || uncoveredCompletions.size !== 0)
    return failure("m9b13e1:missing-per-boundary-or-completion-census");
  if (
    receipt.decision === "trusted-session-admitted" &&
    receipt.unexpectedProcesses.length !== 0
  )
    return failure("m9b13e1:unexpected-process-in-admitted-session");
  if (!canonicalEqual(receipt.trustedInventory, expected.trustedInventory))
    return failure("m9b13e1:trusted-root-or-runtime-mismatch");
  if (
    receipt.permittedProcesses.length > receipt.maximumProcessCount ||
    receipt.permittedProcesses.filter((process) => process.parentId === null)
      .length !== 1 ||
    receipt.permittedProcesses.find((process) => process.parentId === null)
      ?.role !== "controller"
  )
    return failure("m9b13e1:invalid-controller-root");
  const processIds = new Set(
    receipt.permittedProcesses.map((process) => process.id),
  );
  if (
    receipt.permittedProcesses.some(
      (process) =>
        process.parentId !== null && !processIds.has(process.parentId),
    )
  )
    return failure("m9b13e1:invalid-parent-child-relationship");
  for (const transition of receipt.session.transitions) {
    if (!isLegalTransition(transition.from, transition.to))
      return failure("m9b13e1:illegal-session-transition");
  }
  const lastTransition = receipt.session.transitions.at(-1);
  if (lastTransition?.to !== receipt.session.finalState)
    return failure("m9b13e1:terminal-state-mismatch");
  if (
    receipt.stopGate.effectBeforeAdmission ||
    !allEffectCountersZero(receipt.stopGate.effectCounters)
  )
    return failure("m9b13e1:effect-before-admission-or-nonzero-effect");
  if (
    receipt.decision === "trusted-session-no-effect-stop" &&
    (receipt.stopGate.acceptedSealWritten ||
      !receipt.stopGate.partialStateQuarantined ||
      receipt.session.finalState !== "closed" ||
      receipt.session.stopReasons.length === 0)
  )
    return failure("m9b13e1:stop-did-not-fail-closed");
  if (
    receipt.session.invariantLostAfterAdmission &&
    receipt.decision !== "trusted-session-no-effect-stop"
  )
    return failure("m9b13e1:invariant-loss-was-admitted");
  if (
    receipt.decision === "trusted-session-admitted" &&
    (receipt.session.finalState !== "closed" ||
      receipt.session.stopReasons.length !== 0 ||
      !receipt.stopGate.acceptedSealWritten ||
      receipt.stopGate.partialStateQuarantined)
  )
    return failure("m9b13e1:admitted-session-not-cleanly-closed");
  const digest = await digestM9b13e1TrustedSessionReceipt(receipt);
  if (!digest.ok || digest.value !== receipt.evidence.canonicalReceiptDigest)
    return failure("m9b13e1:canonical-receipt-digest-mismatch");
  return { ok: true, value: receipt };
}

const archiveFileSchema = z.strictObject({
  name: nonemptySchema,
  version: z.literal(1),
  sha256: sha256Schema,
});

export type M9b13e1ArchiveFile = z.infer<typeof archiveFileSchema>;

export const M9B13E1_REGISTERED_ARCHIVE_FILES: ReadonlyArray<M9b13e1ArchiveFile> =
  Object.freeze([
    {
      name: "atomic-admission.md",
      version: 1,
      sha256:
        "e95fcfc223e9fae03f703b182f7b5750c17b89d267f856b3c7dbcf867c066f91",
    },
    {
      name: "authenticated-identity.md",
      version: 1,
      sha256:
        "9dc1cecc4f00e407bbe6f0e45c7a4f55f02a0aff1588fd932f24312bd1d689db",
    },
    {
      name: "authorization-texts.md",
      version: 1,
      sha256:
        "de337f4a2cbc0c8ad885ac027185b369bdbcc42d026a2ec70e6e93b833b1dc22",
    },
    {
      name: "bindings.json",
      version: 1,
      sha256:
        "663332ce84575eebe83ef5d9ce5cea3ec7b98552f21539710fbccfa648e2e487",
    },
    {
      name: "changed-artifacts.md",
      version: 1,
      sha256:
        "26684e9ae089cd9ebd37ec6415fcc63ef9be4911d68dca124d23f21ce92615f6",
    },
    {
      name: "CHECKSUMS.sha256",
      version: 1,
      sha256:
        "5e53f4aeb8bf22213692557023b695bf88013372c8b235a7f844fdcf5545b189",
    },
    {
      name: "durable-authority.md",
      version: 1,
      sha256:
        "4a6be406289b6c52835667478fc8536594728c5da5fc3c38b9eb10897a5e851f",
    },
    {
      name: "external-registration-format.json",
      version: 1,
      sha256:
        "0f0bfbf46b6fd3b7c26f439f1823ce92be3d8f410d122d594569145d743791e5",
    },
    {
      name: "independent-review-finding.md",
      version: 1,
      sha256:
        "2b042fb82bba752d1eca1ecfb40e059422f4bdfeb5dfe14b029efd9f608e4e93",
    },
    {
      name: "m9b12f-cross-process.test.ts",
      version: 1,
      sha256:
        "b6c9b4d753acb2961146250626bf1c44efcb6dbec918d60182048cdcca0023fc",
    },
    {
      name: "m9b12f-durable-authority-node.ts",
      version: 1,
      sha256:
        "2e453563c09b5c3f8912d7abcc7e5f1b731fb7cb7270c2fc7690c564ab8b9409",
    },
    {
      name: "m9b12f-durable-authority.test.ts",
      version: 1,
      sha256:
        "e3722f6836368573a5f5d164cdd8183bba1304286e45a3d9551ed6fed34ee596",
    },
    {
      name: "m9b12f-preregistration.test.ts",
      version: 1,
      sha256:
        "8efbf82f18286538ecfd41efdf85a77a9eecde923e9fd718605312d9874182f4",
    },
    {
      name: "m9b12f-preregistration.ts",
      version: 1,
      sha256:
        "4eada425c2d4f7e1e15326e1c26ca3256b4dced204c864a235379e1976775eee",
    },
    {
      name: "m9b12f-process-worker.test.ts",
      version: 1,
      sha256:
        "f4df4145e8018ca3c150052ec58bfb72e8af27ce30674d95b63bc8dbf243ad46",
    },
    {
      name: "m9b12f-sqlite-sidecar-worker.test.ts",
      version: 1,
      sha256:
        "23c9ac7c5f9aa9ddbf1cb0ad3a421f12d66db7fe8a69e8ca69b30e358a581b1b",
    },
    {
      name: "nonclaims.md",
      version: 1,
      sha256:
        "1c57bff9b561d91fde964a822f24659bae348167d529c4e5276f2823b1deb327",
    },
    {
      name: "operational-sequence.md",
      version: 1,
      sha256:
        "79cc89b227f0eea3607a501d8aeb47c71b471984bad945e8e53f8b371f084066",
    },
    {
      name: "preregistration.json",
      version: 1,
      sha256:
        "3178b3059cce25bc1b66a9bc88c9a2eb5a35810a442f904d3d06349f1a187f8b",
    },
    {
      name: "preregistration.md",
      version: 1,
      sha256:
        "baebe0053c65ef27623f1243e58f459106f1ca301ccaba1417f64bb3e15462c5",
    },
    {
      name: "scientific-financial-invariance.md",
      version: 1,
      sha256:
        "cdcce3e22a3e5104fccd79efb27fbf6a6a8f4fe2d168953dabe0cce94d947250",
    },
    {
      name: "sidecar-policy.md",
      version: 1,
      sha256:
        "fa6fc4927434e088c8862533c3c8a801ec7d375b3d3cb6b4e62a462d21757b34",
    },
    {
      name: "supersession.json",
      version: 1,
      sha256:
        "1221f2826247a74d1d9f28d61f7bbf63e15c173840f2f132af25b39f4c8f74f7",
    },
    {
      name: "supersession.md",
      version: 1,
      sha256:
        "80838547f496c9f7e96cfc885aab321ca13c2006a71e68e59793e354d0cde493",
    },
    {
      name: "threat-model.md",
      version: 1,
      sha256:
        "eb726e135e7ce2654bb5fc4342ab7f9c8d5f862f28e8e34677b62c5e41de75ae",
    },
    {
      name: "verification.json",
      version: 1,
      sha256:
        "db94ddbd4aecffab91ff7be9390016e9d543aeabb42e7e16ff54df78881e0b2c",
    },
    {
      name: "verification.md",
      version: 1,
      sha256:
        "ca69fa930630c21bd96daf59adfcd15f80bd769e50e7478cd7a6fae033122599",
    },
  ]);

const historicalNoGoSchema = z.strictObject({
  stage: z.enum([
    "M9b.13",
    "M9b.13a",
    "M9b.13b",
    "M9b.13c",
    "M9b.13d",
    "M9b.13d.1",
    "M9b.13e-and-independent-review",
  ]),
  disposition: z.literal("historical-no-go-evidence-not-reinterpreted"),
});

export const m9b13e1SupplementSchema = z.strictObject({
  protocol: z.literal(M9B13E1_EMBARGO_SUPPLEMENT_PROTOCOL),
  externalIdentity: nonemptySchema,
  prospective: z.literal(true),
  approvedBefore: z.strictObject({
    corpusConstruction: z.literal(true),
    hiddenGoldConstruction: z.literal(true),
    scheduleMaterialization: z.literal(true),
    credentialAccess: z.literal(true),
    networkAcquisition: z.literal(true),
    providerOrModelEffects: z.literal(true),
    studyExecution: z.literal(true),
  }),
  registration: z.strictObject({
    id: z.literal("63sh5"),
    submissionTimestamp: z.literal("2026-08-02T19:19:33.924946Z"),
    approvalTimestamp: z.literal("2026-08-02T20:03:47.850242Z"),
    immutableFiles: z.array(archiveFileSchema).length(27),
    preregistrationDigest: z.literal(
      "097d4848a264fc8484ca590c79388e3a00279a6310392205db7868104cee13b4",
    ),
    manifestDigest: z.literal(
      "5e53f4aeb8bf22213692557023b695bf88013372c8b235a7f844fdcf5545b189",
    ),
    scientificFinancialProjectionDigest: z.literal(
      "e5cd02100a1004849acc18f3f302e880580a38ef45a0733868826c32a23ff282",
    ),
  }),
  historicalNoGos: z.array(historicalNoGoSchema).length(7),
  embargo: z.strictObject({
    mechanismSupportsAtLeastOriginalRestriction: z.literal(true),
    protectedThrough: z.literal("2030-08-01T00:00:00Z"),
    publicViewOnlyLinkCount: z.literal(0),
    publicMetadataRevealsProtectedContext: z.literal(false),
  }),
  prohibitions: z.strictObject({
    publication: z.literal(true),
    withdrawal: z.literal(true),
    replacement: z.literal(true),
    clonePresentedAsOriginal: z.literal(true),
    registration63sh5Modification: z.literal(true),
    prematureEmbargoTermination: z.literal(true),
  }),
  attachmentInventorySha256: sha256Schema,
  serverSubmissionTimestamp: timestampSchema,
  approvalTimestamp: timestampSchema.nullable(),
  independentPostUploadByteVerification: z.literal(true),
  appendOnlyLocalReceiptRequired: z.literal(true),
  separateSubmissionAuthorizationRequired: z.literal(true),
  separateApprovalAuthorizationRequired: z.literal(true),
  supplementApprovalGrantsCorpusOrAcquisitionAuthority: z.literal(false),
  nonclaim: z.literal(M9B13E1_NONCLAIM),
  retainedScope: z.literal(M9B13E1_RETAINED_SCOPE),
});

export type M9b13e1Supplement = z.infer<typeof m9b13e1SupplementSchema>;

export function validateM9b13e1Supplement(
  value: unknown,
): ValidationResult<M9b13e1Supplement> {
  const parsed = m9b13e1SupplementSchema.safeParse(value);
  if (!parsed.success)
    return failure("m9b13e1:supplement-schema-or-hostile-key-rejected");
  const supplement = parsed.data;
  if (supplement.externalIdentity === supplement.registration.id)
    return failure("m9b13e1:supplement-identity-not-new");
  if (
    !canonicalEqual(
      supplement.registration.immutableFiles,
      M9B13E1_REGISTERED_ARCHIVE_FILES,
    )
  )
    return failure("m9b13e1:registered-archive-identity-mismatch");
  const expectedStages = new Set(historicalNoGoSchema.shape.stage.options);
  for (const historical of supplement.historicalNoGos)
    expectedStages.delete(historical.stage);
  if (expectedStages.size !== 0)
    return failure("m9b13e1:historical-no-go-omitted");
  return { ok: true, value: supplement };
}
