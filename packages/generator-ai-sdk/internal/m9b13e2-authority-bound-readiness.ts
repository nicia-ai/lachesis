import { canonicalizeJson, digestValue, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import { M9B13E1_REGISTERED_ARCHIVE_FILES } from "./m9b13e1-trusted-session-readiness.js";

export const M9B13E2_STRUCTURAL_VALIDATION_PROTOCOL =
  "lachesis-m9b13e2-structural-readiness-receipt-validation/1" as const;
export const M9B13E2_AUTHORITY_ADMISSION_PROTOCOL =
  "lachesis-m9b13e2-authority-bound-session-admission/1" as const;
export const M9B13E2_EXPECTATION_PACKAGE_PROTOCOL =
  "lachesis-m9b13e2-reviewed-readiness-expectation-package/1" as const;
export const M9B13E2_EXPECTATION_REVIEW_DECISION =
  "m9b13e2-expectation-package-review-pass" as const;
export const M9B13E2_LEDGER_PROTOCOL =
  "lachesis-m9b13e2-provider-neutral-anti-replay-ledger/1" as const;
export const M9B13E2_STATE_MACHINE_PROTOCOL =
  "lachesis-m9b13e2-exact-session-state-machine/1" as const;
export const M9B13E2_CENSUS_PROTOCOL =
  "lachesis-m9b13e2-session-bound-process-census/1" as const;
export const M9B13E2_AMENDMENT_PROTOCOL =
  "lachesis-m9b13e2-authority-lineage-replay-correction/1" as const;
export const M9B13E2_SUPPLEMENT_PROTOCOL =
  "lachesis-m9b13e2-append-only-embargo-compatible-operational-supplement/1" as const;
export const M9B13E2_CANDIDATE_PROTOCOL =
  "lachesis-m9b13e2-session-admission-candidate/1" as const;
export const M9B13E2_RECEIPT_PROTOCOL =
  "lachesis-m9b13e2-authority-bound-session-receipt/1" as const;
export const M9B13E2_SYNTHETIC_AUTHORITY_PROTOCOL =
  "lachesis-m9b13e2-synthetic-test-authority-never-live/1" as const;
export const M9B13E2_SUPPLEMENT_REVIEW_PROTOCOL =
  "lachesis-m9b13e2-independent-supplement-review/1" as const;

export const M9B13E2_AMENDED_ASSUMPTION =
  "Acquisition runs on a trusted controlled host with no malicious or unrelated concurrent process under the operational UID. All external bytes remain hostile." as const;
export const M9B13E2_NONCLAIM =
  "The study does not establish security against compromise of the trusted local host, acquisition account, controller, kernel, administrator, hypervisor, or pre-start local code, tool, and runtime installation." as const;
export const M9B13E2_RETAINED_SCOPE =
  "Ordinary operator error, accidental controller or helper races, malformed or adversarial external bytes, artifact substitution, partial persistence, retired-corpus exposure, contamination, and failure to establish or retain the trusted-session readiness invariant remain in scope and fail closed." as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitmentSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const gitIdentitySchema = z.string().regex(/^[a-f0-9]{40}$/u);
const timestampSchema = z.iso.datetime({ offset: true });
const nonemptySchema = z.string().min(1);
const monotonicSchema = z.string().regex(/^[0-9]+$/u);

const executableIdentitySchema = z.strictObject({
  protocol: nonemptySchema,
  sourceSha256: sha256Schema,
  buildReceiptSha256: sha256Schema,
  executableSha256: sha256Schema,
});

type ExecutableIdentity = z.infer<typeof executableIdentitySchema>;

function executableIdentityOf(value: ExecutableIdentity): ExecutableIdentity {
  return {
    protocol: value.protocol,
    sourceSha256: value.sourceSha256,
    buildReceiptSha256: value.buildReceiptSha256,
    executableSha256: value.executableSha256,
  };
}

const helperIdentitySchema = executableIdentitySchema.extend({
  compilerPathCommitment: commitmentSchema,
  compilerVersion: nonemptySchema,
  compilerSha256: sha256Schema,
  sdkSysrootCommitment: commitmentSchema,
  sdkVersion: nonemptySchema,
  sdkSha256: sha256Schema,
  compilerFlags: z.array(nonemptySchema).min(1),
  linkerFlags: z.array(nonemptySchema),
  buildEnvironmentSha256: sha256Schema,
  linkedLibraries: z.array(
    z.strictObject({ identity: nonemptySchema, sha256: sha256Schema }),
  ),
  reproducibleBuildReceiptSha256: sha256Schema,
  supportedHost: z.strictObject({
    operatingSystem: nonemptySchema,
    kernel: nonemptySchema,
    architecture: nonemptySchema,
    filesystem: nonemptySchema,
  }),
  invocationContractSha256: sha256Schema,
  exitCodeContractSha256: sha256Schema,
});

const processRoleSchema = z.enum([
  "controller",
  "helper",
  "scanner",
  "verifier",
]);

const expectedProcessSchema = z.strictObject({
  processKey: nonemptySchema,
  role: processRoleSchema,
  parentProcessKey: nonemptySchema.nullable(),
  identity: executableIdentitySchema,
  argumentsSchemaSha256: sha256Schema,
  environmentSchemaSha256: sha256Schema,
  descriptorInheritanceSha256: sha256Schema,
  maximumInstances: z.number().int().positive(),
  startOrder: z.number().int().nonnegative(),
  terminalExitRequired: z.literal(true),
});

const checksumEntrySchema = z.strictObject({
  path: nonemptySchema,
  sha256: sha256Schema,
});

export const m9b13e2ExpectationPackageSchema = z.strictObject({
  protocol: z.literal(M9B13E2_EXPECTATION_PACKAGE_PROTOCOL),
  version: z.literal(1),
  packageCanonicalDigest: sha256Schema,
  independentReview: z.strictObject({
    protocol: nonemptySchema,
    packageIdentity: nonemptySchema,
    acceptedDecision: z.literal(M9B13E2_EXPECTATION_REVIEW_DECISION),
    reviewedCommit: gitIdentitySchema,
    reviewedTree: gitIdentitySchema,
    evidenceSha256: sha256Schema,
  }),
  expectedHostBindingPolicySha256: sha256Schema,
  expectedOperationalUidPolicy: z.strictObject({
    numericUid: z.number().int().nonnegative(),
    numericGids: z.array(z.number().int().nonnegative()).min(1),
    groupInventorySha256: sha256Schema,
    privilegeState: z.literal("unprivileged-no-sudo-no-root-elevation"),
  }),
  permittedProcessTopology: z.array(expectedProcessSchema).min(1),
  maximumProcessCount: z.number().int().positive(),
  maximumConcurrency: z.literal(1),
  backgroundProcessPolicy: z.literal(
    "reject-pre-existing-process-not-in-exact-allowlist",
  ),
  controller: executableIdentitySchema,
  nodeRuntime: executableIdentitySchema.extend({ version: nonemptySchema }),
  collector: executableIdentitySchema,
  collectionMechanismSha256: sha256Schema,
  verifier: executableIdentitySchema,
  helper: helperIdentitySchema,
  scanner: executableIdentitySchema.extend({ runtimeSha256: sha256Schema }),
  trustedRoots: z.strictObject({
    inventorySha256: sha256Schema,
    filesystemPolicySha256: sha256Schema,
  }),
  environmentAllowlist: z.array(nonemptySchema),
  stateMachineProtocol: z.literal(M9B13E2_STATE_MACHINE_PROTOCOL),
  censusProtocol: z.literal(M9B13E2_CENSUS_PROTOCOL),
  antiReplayLedger: z.strictObject({
    protocol: z.literal(M9B13E2_LEDGER_PROTOCOL),
    namespace: nonemptySchema,
    trustedInitialRoot: commitmentSchema,
  }),
  expectedAmendmentProtocol: z.literal(M9B13E2_AMENDMENT_PROTOCOL),
  expectedSupplementProtocol: z.literal(M9B13E2_SUPPLEMENT_PROTOCOL),
  checksumInventory: z.array(checksumEntrySchema).min(1),
  checksumInventoryDigest: sha256Schema,
});

export type M9b13e2ExpectationPackage = z.infer<
  typeof m9b13e2ExpectationPackageSchema
>;

const sessionInputSchema = z.strictObject({
  expectationPackageDigest: sha256Schema,
  hostSessionCommitment: commitmentSchema,
  hostBindingPolicySha256: sha256Schema,
  operationalUidCommitment: commitmentSchema,
  operationalIdentity: z.strictObject({
    numericUid: z.number().int().nonnegative(),
    numericGids: z.array(z.number().int().nonnegative()).min(1),
    groupInventorySha256: sha256Schema,
    privilegeState: z.literal("unprivileged-no-sudo-no-root-elevation"),
  }),
  controllerIdentity: executableIdentitySchema,
  collectorIdentity: executableIdentitySchema,
  verifierIdentity: executableIdentitySchema,
  collectionMechanismSha256: sha256Schema,
  trustedInputInventorySha256: sha256Schema,
  trustedRootInventorySha256: sha256Schema,
  filesystemPolicySha256: sha256Schema,
  environmentAllowlistSha256: sha256Schema,
  stateMachineProtocol: z.literal(M9B13E2_STATE_MACHINE_PROTOCOL),
  censusProtocol: z.literal(M9B13E2_CENSUS_PROTOCOL),
  ledgerProtocol: z.literal(M9B13E2_LEDGER_PROTOCOL),
  ledgerNamespace: nonemptySchema,
  controllerNonce: commitmentSchema,
  monotonicSessionSequence: z.number().int().nonnegative(),
  sessionStartTimestamp: timestampSchema,
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
  sessionCommitment: commitmentSchema,
  sequence: z.number().int().nonnegative(),
  from: sessionStateSchema,
  to: sessionStateSchema,
  event: nonemptySchema,
  wallTimestamp: timestampSchema,
  monotonicTimestampNanos: monotonicSchema,
  evidenceSha256: sha256Schema,
});

const processRecordSchema = z.strictObject({
  sessionCommitment: commitmentSchema,
  processKey: nonemptySchema,
  processId: z.number().int().positive(),
  startTimeIdentity: commitmentSchema,
  role: processRoleSchema,
  parentProcessKey: nonemptySchema.nullable(),
  parentProcessId: z.number().int().positive().nullable(),
  executableIdentity: executableIdentitySchema,
  numericUid: z.number().int().nonnegative(),
  numericGids: z.array(z.number().int().nonnegative()),
  environmentSha256: sha256Schema,
});

const censusBoundaryKindSchema = z.enum([
  "before-session-admission",
  "before-consequential-boundary",
  "after-helper-or-scanner-completion",
  "before-sealing",
  "terminal",
]);

const censusSnapshotSchema = z.strictObject({
  sessionCommitment: commitmentSchema,
  censusProtocol: z.literal(M9B13E2_CENSUS_PROTOCOL),
  collectorIdentity: executableIdentitySchema,
  boundaryKind: censusBoundaryKindSchema,
  boundaryIdentity: nonemptySchema,
  boundaryOrder: z.number().int().nonnegative(),
  afterTransitionSequence: z.number().int().nonnegative(),
  monotonicSequence: z.number().int().nonnegative(),
  monotonicTimestampNanos: monotonicSchema,
  wallTimestamp: timestampSchema,
  ageMillisAtDecision: z.number().int().nonnegative(),
  processRecords: z.array(processRecordSchema).min(1),
  inventorySha256: sha256Schema,
  topologySha256: sha256Schema,
  evidenceSha256: sha256Schema,
});

const boundaryRecordSchema = z.strictObject({
  sessionCommitment: commitmentSchema,
  identity: nonemptySchema,
  order: z.number().int().nonnegative(),
  afterTransitionSequence: z.number().int().nonnegative(),
  monotonicTimestampNanos: monotonicSchema,
  evidenceSha256: sha256Schema,
});

const completionRecordSchema = z.strictObject({
  sessionCommitment: commitmentSchema,
  identity: nonemptySchema,
  order: z.number().int().nonnegative(),
  processKey: nonemptySchema,
  role: z.enum(["helper", "scanner"]),
  afterTransitionSequence: z.number().int().nonnegative(),
  monotonicTimestampNanos: monotonicSchema,
  evidenceSha256: sha256Schema,
});

const verificationSchema = z.strictObject({
  sessionCommitment: commitmentSchema,
  attemptSequence: z.number().int().nonnegative(),
  verifierIdentity: executableIdentitySchema,
  result: z.enum(["pass", "fail", "not-performed", "unavailable"]),
  evidenceSha256: sha256Schema.nullable(),
  monotonicTimestampNanos: monotonicSchema,
  wallTimestamp: timestampSchema,
});

const zeroEffectSchema = z.strictObject({
  networkRequests: z.literal(0),
  durableAcquisitionWrites: z.literal(0),
  downloads: z.literal(0),
  imageOperations: z.literal(0),
  credentialAccesses: z.literal(0),
  providerOrModelCalls: z.literal(0),
});

export const m9b13e2AdmissionCandidateSchema = z.strictObject({
  protocol: z.literal(M9B13E2_CANDIDATE_PROTOCOL),
  sessionInputs: sessionInputSchema,
  sessionCommitment: commitmentSchema,
  transitions: z.array(transitionSchema).min(1),
  censuses: z.array(censusSnapshotSchema).min(1),
  consequentialBoundaries: z.array(boundaryRecordSchema),
  processCompletions: z.array(completionRecordSchema),
  verification: verificationSchema,
  maximumCensusAgeMillis: z.number().int().nonnegative(),
  preAdmissionEffects: zeroEffectSchema,
  ledgerExpectation: z.strictObject({
    protocol: z.literal(M9B13E2_LEDGER_PROTOCOL),
    namespace: nonemptySchema,
    expectedRevision: z.number().int().nonnegative(),
    expectedRoot: commitmentSchema,
  }),
  canonicalCandidateDigest: sha256Schema,
});

export type M9b13e2AdmissionCandidate = z.infer<
  typeof m9b13e2AdmissionCandidateSchema
>;

const ledgerStatusSchema = z.enum([
  "reserved",
  "admitted",
  "stopped",
  "quarantined",
]);

const ledgerEventSchema = z.strictObject({
  protocol: z.literal(M9B13E2_LEDGER_PROTOCOL),
  namespace: nonemptySchema,
  sequence: z.number().int().positive(),
  previousRoot: commitmentSchema,
  sessionCommitment: commitmentSchema,
  status: ledgerStatusSchema,
  candidateDigest: sha256Schema,
  receiptDigest: sha256Schema.nullable(),
  ambiguity: z.enum(["none", "persistence-ambiguous"]),
  eventDigest: sha256Schema,
  resultingRoot: commitmentSchema,
});

const ledgerReceiptSchema = z.strictObject({
  namespace: nonemptySchema,
  reservation: ledgerEventSchema,
  terminal: ledgerEventSchema.nullable(),
  persistenceAmbiguous: z.boolean(),
});

const admittedReceiptSchema = z.strictObject({
  protocol: z.literal(M9B13E2_RECEIPT_PROTOCOL),
  decision: z.literal("trusted-session-admitted"),
  candidate: m9b13e2AdmissionCandidateSchema,
  independentVerification: z.literal("pass"),
  verificationEvidenceSha256: sha256Schema,
  acceptedAdmission: z.literal(true),
  acceptedSealWritten: z.literal(true),
  stopReasons: z.tuple([]),
  ambiguity: z.literal("none"),
  ledger: ledgerReceiptSchema,
  canonicalReceiptDigest: sha256Schema,
});

const stopReasonSchema = z.enum([
  "positive-readiness-authority-unavailable",
  "malformed-or-inconsistent-evidence",
  "expectation-package-mismatch",
  "expectation-package-unreviewed",
  "collector-mismatch",
  "verifier-mismatch",
  "trusted-input-inventory-mismatch",
  "independent-verification-not-pass",
  "replayed-session-commitment",
  "stale-ledger-revision-or-root",
  "conflicting-concurrent-reservation",
  "persistence-ambiguous",
  "terminal-session-reopening",
]);

const stoppedReceiptSchema = z.strictObject({
  protocol: z.literal(M9B13E2_RECEIPT_PROTOCOL),
  decision: z.literal("trusted-session-no-effect-stop"),
  candidate: m9b13e2AdmissionCandidateSchema,
  independentVerification: z.enum([
    "pass",
    "fail",
    "not-performed",
    "unavailable",
  ]),
  verificationEvidenceSha256: sha256Schema.nullable(),
  acceptedAdmission: z.literal(false),
  acceptedSealWritten: z.literal(false),
  stopReason: stopReasonSchema,
  ambiguity: z.enum(["none", "evidence-incomplete", "persistence-ambiguous"]),
  zeroEffects: zeroEffectSchema,
  ledger: ledgerReceiptSchema,
  canonicalReceiptDigest: sha256Schema,
});

export const m9b13e2AuthorityReceiptSchema = z.discriminatedUnion("decision", [
  admittedReceiptSchema,
  stoppedReceiptSchema,
]);

export type M9b13e2AuthorityReceipt = z.infer<
  typeof m9b13e2AuthorityReceiptSchema
>;
export type M9b13e2AdmittedReceipt = z.infer<typeof admittedReceiptSchema>;
export type M9b13e2StoppedReceipt = z.infer<typeof stoppedReceiptSchema>;

type ContractFailure = Readonly<{
  kind: "m9b13e2-contract-invalid";
  reason: string;
}>;

type ContractResult<T> = Result<T, ContractFailure>;

function failure<T>(reason: string): ContractResult<T> {
  return {
    ok: false,
    error: { kind: "m9b13e2-contract-invalid", reason },
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

async function digestOrFailure(
  value: unknown,
): Promise<ContractResult<string>> {
  const digest = await digestValue(value);
  return digest.ok
    ? { ok: true, value: digest.value }
    : failure("m9b13e2:canonicalization-failed");
}

function expectationPackageProjection(
  value: M9b13e2ExpectationPackage,
): Readonly<Record<string, unknown>> {
  const { packageCanonicalDigest: omitted, ...projection } = value;
  void omitted;
  return projection;
}

export async function digestM9b13e2ExpectationPackage(
  value: M9b13e2ExpectationPackage,
): Promise<ContractResult<string>> {
  return digestOrFailure(expectationPackageProjection(value));
}

export async function validateM9b13e2ExpectationPackage(
  value: unknown,
): Promise<ContractResult<M9b13e2ExpectationPackage>> {
  const parsed = m9b13e2ExpectationPackageSchema.safeParse(value);
  if (!parsed.success)
    return failure("m9b13e2:expectation-package-schema-rejected");
  const packageValue = parsed.data;
  const checksumDigest = await digestOrFailure(packageValue.checksumInventory);
  if (
    !checksumDigest.ok ||
    checksumDigest.value !== packageValue.checksumInventoryDigest
  )
    return failure("m9b13e2:checksum-inventory-digest-mismatch");
  const packageDigest = await digestM9b13e2ExpectationPackage(packageValue);
  if (
    !packageDigest.ok ||
    packageDigest.value !== packageValue.packageCanonicalDigest
  )
    return failure("m9b13e2:expectation-package-digest-mismatch");
  const processKeys = new Set<string>();
  const startOrders = new Set<number>();
  for (const process of packageValue.permittedProcessTopology) {
    if (processKeys.has(process.processKey))
      return failure("m9b13e2:duplicate-expected-process-key");
    if (startOrders.has(process.startOrder))
      return failure("m9b13e2:duplicate-expected-process-order");
    processKeys.add(process.processKey);
    startOrders.add(process.startOrder);
  }
  const roots = packageValue.permittedProcessTopology.filter(
    (process) => process.parentProcessKey === null,
  );
  if (roots.length !== 1 || roots[0]?.role !== "controller")
    return failure("m9b13e2:expected-controller-root-invalid");
  if (
    packageValue.permittedProcessTopology.some(
      (process) =>
        process.parentProcessKey !== null &&
        !processKeys.has(process.parentProcessKey),
    )
  )
    return failure("m9b13e2:expected-parent-missing");
  if (
    packageValue.permittedProcessTopology.length >
    packageValue.maximumProcessCount
  )
    return failure("m9b13e2:expected-process-limit-exceeded");
  const groupDigest = await digestOrFailure(
    packageValue.expectedOperationalUidPolicy.numericGids,
  );
  if (
    !groupDigest.ok ||
    groupDigest.value !==
      packageValue.expectedOperationalUidPolicy.groupInventorySha256
  )
    return failure("m9b13e2:expected-group-inventory-digest-mismatch");
  const roleIdentityMatches = (
    role: z.infer<typeof processRoleSchema>,
    identity: ExecutableIdentity,
  ): boolean =>
    packageValue.permittedProcessTopology.some(
      (process) =>
        process.role === role &&
        canonicalEqual(process.identity, executableIdentityOf(identity)),
    );
  if (
    !roleIdentityMatches("controller", packageValue.controller) ||
    !roleIdentityMatches("helper", packageValue.helper) ||
    !roleIdentityMatches("scanner", packageValue.scanner) ||
    !roleIdentityMatches("verifier", packageValue.verifier)
  )
    return failure("m9b13e2:trusted-identity-topology-cross-binding-mismatch");
  return { ok: true, value: packageValue };
}

function candidateProjection(
  value: M9b13e2AdmissionCandidate,
): Readonly<Record<string, unknown>> {
  const { canonicalCandidateDigest: omitted, ...projection } = value;
  void omitted;
  return projection;
}

export async function digestM9b13e2AdmissionCandidate(
  value: M9b13e2AdmissionCandidate,
): Promise<ContractResult<string>> {
  return digestOrFailure(candidateProjection(value));
}

export async function deriveM9b13e2SessionCommitment(
  inputs: z.infer<typeof sessionInputSchema>,
): Promise<ContractResult<string>> {
  const digest = await digestOrFailure(inputs);
  return digest.ok ? { ok: true, value: `sha256:${digest.value}` } : digest;
}

async function digestProcessInventory(
  records: ReadonlyArray<z.infer<typeof processRecordSchema>>,
): Promise<ContractResult<string>> {
  return digestOrFailure(records);
}

async function digestProcessTopology(
  records: ReadonlyArray<z.infer<typeof processRecordSchema>>,
): Promise<ContractResult<string>> {
  return digestOrFailure(
    records.map((record) => ({
      processKey: record.processKey,
      processId: record.processId,
      startTimeIdentity: record.startTimeIdentity,
      role: record.role,
      parentProcessKey: record.parentProcessKey,
      parentProcessId: record.parentProcessId,
    })),
  );
}

const admittedEdges: ReadonlyArray<
  readonly [
    z.infer<typeof sessionStateSchema>,
    z.infer<typeof sessionStateSchema>,
  ]
> = [
  ["uninitialized", "preflight"],
  ["preflight", "admitted-clean"],
  ["admitted-clean", "acquisition-active"],
  ["acquisition-active", "verification-active"],
  ["verification-active", "sealed"],
  ["sealed", "closed"],
];

const stoppedEdges: ReadonlyArray<
  ReadonlyArray<
    readonly [
      z.infer<typeof sessionStateSchema>,
      z.infer<typeof sessionStateSchema>,
    ]
  >
> = [
  [
    ["uninitialized", "preflight"],
    ["preflight", "quarantined"],
    ["quarantined", "closed"],
  ],
  [
    ["uninitialized", "preflight"],
    ["preflight", "admitted-clean"],
    ["admitted-clean", "quarantined"],
    ["quarantined", "closed"],
  ],
  [
    ["uninitialized", "preflight"],
    ["preflight", "admitted-clean"],
    ["admitted-clean", "acquisition-active"],
    ["acquisition-active", "quarantined"],
    ["quarantined", "closed"],
  ],
  [
    ["uninitialized", "preflight"],
    ["preflight", "admitted-clean"],
    ["admitted-clean", "acquisition-active"],
    ["acquisition-active", "verification-active"],
    ["verification-active", "quarantined"],
    ["quarantined", "closed"],
  ],
];

function pathEquals(
  transitions: ReadonlyArray<z.infer<typeof transitionSchema>>,
  edges: ReadonlyArray<
    readonly [
      z.infer<typeof sessionStateSchema>,
      z.infer<typeof sessionStateSchema>,
    ]
  >,
): boolean {
  return (
    transitions.length === edges.length &&
    transitions.every((transition, index) => {
      const edge = edges.at(index);
      if (edge === undefined) return false;
      return transition.from === edge[0] && transition.to === edge[1];
    })
  );
}

function validateTransitionChain(
  transitions: ReadonlyArray<z.infer<typeof transitionSchema>>,
  sessionCommitment: string,
  decision: M9b13e2AuthorityReceipt["decision"],
): ContractResult<true> {
  if (transitions[0]?.from !== "uninitialized")
    return failure("m9b13e2:first-transition-not-uninitialized");
  for (const [index, transition] of transitions.entries()) {
    if (transition.sessionCommitment !== sessionCommitment)
      return failure("m9b13e2:transition-session-mismatch");
    if (transition.sequence !== index)
      return failure("m9b13e2:transition-sequence-not-contiguous");
    if (index > 0 && transitions[index - 1]?.to !== transition.from)
      return failure("m9b13e2:transition-chain-disconnected");
    if (
      index > 0 &&
      BigInt(transition.monotonicTimestampNanos) <=
        BigInt(transitions[index - 1]?.monotonicTimestampNanos ?? "0")
    )
      return failure("m9b13e2:transition-time-not-increasing");
  }
  if (decision === "trusted-session-admitted") {
    if (!pathEquals(transitions, admittedEdges))
      return failure("m9b13e2:admitted-state-path-not-exact");
  } else if (!stoppedEdges.some((edges) => pathEquals(transitions, edges))) {
    return failure("m9b13e2:stopped-state-path-not-exact");
  }
  return { ok: true, value: true };
}

async function validateCensusStructure(
  candidate: M9b13e2AdmissionCandidate,
  decision: M9b13e2AuthorityReceipt["decision"],
): Promise<ContractResult<true>> {
  const censusOrders = new Set<number>();
  const censusIdentities = new Set<string>();
  let priorSequence = -1;
  let priorTime = -1n;
  for (const census of candidate.censuses) {
    if (census.sessionCommitment !== candidate.sessionCommitment)
      return failure("m9b13e2:census-session-mismatch");
    if (census.monotonicSequence <= priorSequence)
      return failure("m9b13e2:census-sequence-not-increasing");
    const censusTime = BigInt(census.monotonicTimestampNanos);
    if (censusTime <= priorTime)
      return failure("m9b13e2:census-time-not-increasing");
    priorSequence = census.monotonicSequence;
    priorTime = censusTime;
    if (census.ageMillisAtDecision > candidate.maximumCensusAgeMillis)
      return failure("m9b13e2:stale-census");
    if (census.afterTransitionSequence >= candidate.transitions.length)
      return failure("m9b13e2:census-transition-reference-missing");
    const before = candidate.transitions[census.afterTransitionSequence];
    const after = candidate.transitions[census.afterTransitionSequence + 1];
    if (
      before === undefined ||
      censusTime <= BigInt(before.monotonicTimestampNanos) ||
      (after !== undefined &&
        censusTime >= BigInt(after.monotonicTimestampNanos))
    )
      return failure("m9b13e2:census-not-between-adjacent-transitions");
    const processIdentities = new Set<string>();
    const processKeys = new Set<string>();
    const processIds = new Set<number>();
    for (const process of census.processRecords) {
      if (process.sessionCommitment !== candidate.sessionCommitment)
        return failure("m9b13e2:process-record-session-mismatch");
      const identity = `${process.processId}:${process.startTimeIdentity}`;
      if (
        processIdentities.has(identity) ||
        processKeys.has(process.processKey) ||
        processIds.has(process.processId)
      )
        return failure("m9b13e2:duplicate-process-identity");
      processIdentities.add(identity);
      processKeys.add(process.processKey);
      processIds.add(process.processId);
    }
    for (const process of census.processRecords) {
      if (process.parentProcessKey === null) {
        if (process.parentProcessId !== null)
          return failure("m9b13e2:census-root-has-parent-id");
        continue;
      }
      const parent = census.processRecords.find(
        (candidateParent) =>
          candidateParent.processKey === process.parentProcessKey,
      );
      if (parent === undefined)
        return failure("m9b13e2:census-parent-missing-or-mismatched");
      if (
        process.parentProcessId !== parent.processId ||
        !processKeys.has(parent.processKey) ||
        !processIds.has(parent.processId)
      )
        return failure("m9b13e2:census-parent-missing-or-mismatched");
    }
    const inventoryDigest = await digestProcessInventory(census.processRecords);
    if (!inventoryDigest.ok || inventoryDigest.value !== census.inventorySha256)
      return failure("m9b13e2:census-inventory-digest-mismatch");
    const topologyDigest = await digestProcessTopology(census.processRecords);
    if (!topologyDigest.ok || topologyDigest.value !== census.topologySha256)
      return failure("m9b13e2:census-topology-digest-mismatch");
    if (censusOrders.has(census.boundaryOrder))
      return failure("m9b13e2:duplicate-census-boundary-order");
    if (censusIdentities.has(census.boundaryIdentity))
      return failure("m9b13e2:duplicate-census-boundary-identity");
    censusOrders.add(census.boundaryOrder);
    censusIdentities.add(census.boundaryIdentity);
  }
  if (
    candidate.censuses.some((census, index) => census.boundaryOrder !== index)
  )
    return failure("m9b13e2:census-boundary-order-not-contiguous");
  const initial = candidate.censuses.filter(
    (census) => census.boundaryKind === "before-session-admission",
  );
  const terminal = candidate.censuses.filter(
    (census) => census.boundaryKind === "terminal",
  );
  if (initial.length !== 1 || terminal.length !== 1)
    return failure("m9b13e2:initial-or-terminal-census-not-exact");
  if (
    decision === "trusted-session-admitted" &&
    candidate.censuses.filter(
      (census) => census.boundaryKind === "before-sealing",
    ).length !== 1
  )
    return failure("m9b13e2:before-sealing-census-not-exact");
  const boundaryIdentities = new Set<string>();
  for (const boundary of candidate.consequentialBoundaries) {
    if (boundary.sessionCommitment !== candidate.sessionCommitment)
      return failure("m9b13e2:boundary-session-mismatch");
    if (boundaryIdentities.has(boundary.identity))
      return failure("m9b13e2:duplicate-consequential-boundary");
    boundaryIdentities.add(boundary.identity);
    if (
      candidate.censuses.filter(
        (census) =>
          census.boundaryKind === "before-consequential-boundary" &&
          census.boundaryIdentity === boundary.identity,
      ).length !== 1
    )
      return failure("m9b13e2:boundary-census-not-exact");
    const before = candidate.transitions[boundary.afterTransitionSequence];
    const after = candidate.transitions[boundary.afterTransitionSequence + 1];
    const boundaryTime = BigInt(boundary.monotonicTimestampNanos);
    if (
      before === undefined ||
      boundaryTime <= BigInt(before.monotonicTimestampNanos) ||
      (after !== undefined &&
        boundaryTime >= BigInt(after.monotonicTimestampNanos))
    )
      return failure("m9b13e2:boundary-not-between-adjacent-transitions");
  }
  if (
    candidate.consequentialBoundaries.some(
      (boundary, index) => boundary.order !== index,
    )
  )
    return failure("m9b13e2:consequential-boundary-order-not-contiguous");
  const completionIdentities = new Set<string>();
  for (const completion of candidate.processCompletions) {
    if (completion.sessionCommitment !== candidate.sessionCommitment)
      return failure("m9b13e2:completion-session-mismatch");
    if (completionIdentities.has(completion.identity))
      return failure("m9b13e2:duplicate-completion");
    completionIdentities.add(completion.identity);
    if (
      !candidate.censuses.some((census) =>
        census.processRecords.some(
          (process) =>
            process.processKey === completion.processKey &&
            process.role === completion.role,
        ),
      )
    )
      return failure("m9b13e2:completion-process-not-in-topology");
    if (
      candidate.censuses.filter(
        (census) =>
          census.boundaryKind === "after-helper-or-scanner-completion" &&
          census.boundaryIdentity === completion.identity,
      ).length !== 1
    )
      return failure("m9b13e2:completion-census-not-exact");
    const before = candidate.transitions[completion.afterTransitionSequence];
    const after = candidate.transitions[completion.afterTransitionSequence + 1];
    const completionTime = BigInt(completion.monotonicTimestampNanos);
    if (
      before === undefined ||
      completionTime <= BigInt(before.monotonicTimestampNanos) ||
      (after !== undefined &&
        completionTime >= BigInt(after.monotonicTimestampNanos))
    )
      return failure("m9b13e2:completion-not-between-adjacent-transitions");
  }
  return { ok: true, value: true };
}

function receiptProjection(
  receipt: M9b13e2AuthorityReceipt,
): Readonly<Record<string, unknown>> {
  const { canonicalReceiptDigest: omitted, ...projection } = receipt;
  void omitted;
  return projection;
}

export async function digestM9b13e2AuthorityReceipt(
  receipt: M9b13e2AuthorityReceipt,
): Promise<ContractResult<string>> {
  return digestOrFailure(receiptProjection(receipt));
}

async function validateCandidateStructure(
  candidate: M9b13e2AdmissionCandidate,
  decision: M9b13e2AuthorityReceipt["decision"],
): Promise<ContractResult<true>> {
  const candidateDigest = await digestM9b13e2AdmissionCandidate(candidate);
  if (
    !candidateDigest.ok ||
    candidateDigest.value !== candidate.canonicalCandidateDigest
  )
    return failure("m9b13e2:candidate-digest-mismatch");
  const sessionCommitment = await deriveM9b13e2SessionCommitment(
    candidate.sessionInputs,
  );
  if (
    !sessionCommitment.ok ||
    sessionCommitment.value !== candidate.sessionCommitment
  )
    return failure("m9b13e2:session-commitment-mismatch");
  const transitionResult = validateTransitionChain(
    candidate.transitions,
    candidate.sessionCommitment,
    decision,
  );
  if (!transitionResult.ok) return transitionResult;
  if (
    candidate.verification.sessionCommitment !== candidate.sessionCommitment ||
    !canonicalEqual(
      candidate.verification.verifierIdentity,
      candidate.sessionInputs.verifierIdentity,
    )
  )
    return failure("m9b13e2:verification-session-mismatch");
  const censusResult = await validateCensusStructure(candidate, decision);
  if (!censusResult.ok) return censusResult;
  return { ok: true, value: true };
}

async function validateLedgerEventDigest(
  event: z.infer<typeof ledgerEventSchema>,
): Promise<ContractResult<true>> {
  const {
    eventDigest: omittedEventDigest,
    resultingRoot: omittedResultingRoot,
    ...body
  } = event;
  void omittedEventDigest;
  void omittedResultingRoot;
  const eventDigest = await digestOrFailure(body);
  if (!eventDigest.ok || eventDigest.value !== event.eventDigest)
    return failure("m9b13e2:ledger-event-digest-mismatch");
  const resultingRoot = await digestOrFailure({
    previousRoot: event.previousRoot,
    eventDigest: event.eventDigest,
  });
  if (
    !resultingRoot.ok ||
    `sha256:${resultingRoot.value}` !== event.resultingRoot
  )
    return failure("m9b13e2:ledger-root-mismatch");
  return { ok: true, value: true };
}

async function validateLedgerReceipt(
  receipt: M9b13e2AuthorityReceipt,
): Promise<ContractResult<true>> {
  const reservation = receipt.ledger.reservation;
  const terminal = receipt.ledger.terminal;
  if (
    reservation.status !== "reserved" ||
    reservation.sessionCommitment !== receipt.candidate.sessionCommitment ||
    reservation.candidateDigest !==
      receipt.candidate.canonicalCandidateDigest ||
    reservation.namespace !== receipt.ledger.namespace
  )
    return failure("m9b13e2:ledger-reservation-cross-binding-mismatch");
  const reservationDigest = await validateLedgerEventDigest(reservation);
  if (!reservationDigest.ok) return reservationDigest;
  if (terminal === null) {
    if (!receipt.ledger.persistenceAmbiguous)
      return failure("m9b13e2:ledger-terminal-missing-without-ambiguity");
    return { ok: true, value: true };
  }
  const terminalDigest = await validateLedgerEventDigest(terminal);
  if (!terminalDigest.ok) return terminalDigest;
  if (
    terminal.namespace !== reservation.namespace ||
    terminal.sessionCommitment !== reservation.sessionCommitment ||
    terminal.candidateDigest !== reservation.candidateDigest ||
    terminal.sequence !== reservation.sequence + 1 ||
    terminal.previousRoot !== reservation.resultingRoot ||
    (receipt.decision === "trusted-session-admitted" &&
      terminal.status !== "admitted") ||
    (receipt.decision === "trusted-session-no-effect-stop" &&
      terminal.status !== "stopped")
  )
    return failure("m9b13e2:ledger-terminal-chain-mismatch");
  return { ok: true, value: true };
}

export type M9b13e2StructuralValidationSummary = Readonly<{
  protocol: typeof M9B13E2_STRUCTURAL_VALIDATION_PROTOCOL;
  result: "structurally-valid-nonauthoritative";
  receiptKind: "admitted-record" | "stopped-record";
  receiptDigest: string;
  grantsAdmissionAuthority: false;
}>;

export async function validateM9b13e2ReceiptStructure(
  value: unknown,
): Promise<ContractResult<M9b13e2StructuralValidationSummary>> {
  const parsed = m9b13e2AuthorityReceiptSchema.safeParse(value);
  if (!parsed.success)
    return failure("m9b13e2:receipt-schema-or-hostile-key-rejected");
  const receipt = parsed.data;
  const candidateResult = await validateCandidateStructure(
    receipt.candidate,
    receipt.decision,
  );
  if (!candidateResult.ok) return candidateResult;
  if (
    receipt.decision === "trusted-session-admitted" &&
    (receipt.candidate.verification.result !== "pass" ||
      receipt.candidate.verification.evidenceSha256 === null ||
      receipt.verificationEvidenceSha256 !==
        receipt.candidate.verification.evidenceSha256)
  )
    return failure("m9b13e2:admitted-independent-verification-not-pass");
  const ledgerResult = await validateLedgerReceipt(receipt);
  if (!ledgerResult.ok) return ledgerResult;
  const receiptDigest = await digestM9b13e2AuthorityReceipt(receipt);
  if (
    !receiptDigest.ok ||
    receiptDigest.value !== receipt.canonicalReceiptDigest
  )
    return failure("m9b13e2:receipt-digest-mismatch");
  return {
    ok: true,
    value: {
      protocol: M9B13E2_STRUCTURAL_VALIDATION_PROTOCOL,
      result: "structurally-valid-nonauthoritative",
      receiptKind:
        receipt.decision === "trusted-session-admitted"
          ? "admitted-record"
          : "stopped-record",
      receiptDigest: receiptDigest.value,
      grantsAdmissionAuthority: false,
    },
  };
}

export type M9b13e2LiveAdmissionStop = Readonly<{
  protocol: typeof M9B13E2_AUTHORITY_ADMISSION_PROTOCOL;
  decision: "trusted-session-no-effect-stop";
  reason: "positive-readiness-authority-unavailable";
  acceptedAdmission: false;
  effects: z.infer<typeof zeroEffectSchema>;
}>;

const ZERO_EFFECTS: z.infer<typeof zeroEffectSchema> = Object.freeze({
  networkRequests: 0,
  durableAcquisitionWrites: 0,
  downloads: 0,
  imageOperations: 0,
  credentialAccesses: 0,
  providerOrModelCalls: 0,
});

export const M9B13E2_LIVE_POSITIVE_AUTHORITY = null;

export function attemptLiveM9b13e2Admission(
  _value: unknown,
): M9b13e2LiveAdmissionStop {
  void _value;
  return {
    protocol: M9B13E2_AUTHORITY_ADMISSION_PROTOCOL,
    decision: "trusted-session-no-effect-stop",
    reason: "positive-readiness-authority-unavailable",
    acceptedAdmission: false,
    effects: ZERO_EFFECTS,
  };
}

export type M9b13e2LedgerSnapshot = Readonly<{
  protocol: typeof M9B13E2_LEDGER_PROTOCOL;
  namespace: string;
  trustedInitialRoot: string;
  revision: number;
  root: string;
  events: ReadonlyArray<z.infer<typeof ledgerEventSchema>>;
}>;

export type M9b13e2LedgerError = Readonly<{
  kind: "conflict" | "persistence-ambiguous" | "storage-failure";
}>;

export type M9b13e2LedgerStore = Readonly<{
  read: () => Promise<Result<M9b13e2LedgerSnapshot, M9b13e2LedgerError>>;
  compareAndSwap: (
    expectedRevision: number,
    expectedRoot: string,
    event: z.infer<typeof ledgerEventSchema>,
  ) => Promise<Result<M9b13e2LedgerSnapshot, M9b13e2LedgerError>>;
}>;

export type M9b13e2SyntheticLedgerFault =
  | "none"
  | "next-conflict"
  | "next-ambiguous-before-write"
  | "next-ambiguous-after-write";

export type M9b13e2SyntheticLedgerControl = Readonly<{
  store: M9b13e2LedgerStore;
  setNextFault: (fault: M9b13e2SyntheticLedgerFault) => void;
  snapshot: () => M9b13e2LedgerSnapshot;
}>;

export function createSyntheticM9b13e2Ledger(
  namespace: string,
  trustedInitialRoot: string,
): M9b13e2SyntheticLedgerControl {
  let fault: M9b13e2SyntheticLedgerFault = "none";
  let state: M9b13e2LedgerSnapshot = {
    protocol: M9B13E2_LEDGER_PROTOCOL,
    namespace,
    trustedInitialRoot,
    revision: 0,
    root: trustedInitialRoot,
    events: [],
  };
  const compareAndSwap: M9b13e2LedgerStore["compareAndSwap"] = (
    expectedRevision,
    expectedRoot,
    event,
  ) => {
    if (fault === "next-conflict") {
      fault = "none";
      return Promise.resolve({ ok: false, error: { kind: "conflict" } });
    }
    if (fault === "next-ambiguous-before-write") {
      fault = "none";
      return Promise.resolve({
        ok: false,
        error: { kind: "persistence-ambiguous" },
      });
    }
    if (
      state.revision !== expectedRevision ||
      state.root !== expectedRoot ||
      event.sequence !== state.revision + 1 ||
      event.previousRoot !== state.root
    )
      return Promise.resolve({ ok: false, error: { kind: "conflict" } });
    state = {
      ...state,
      revision: state.revision + 1,
      root: event.resultingRoot,
      events: [...state.events, event],
    };
    if (fault === "next-ambiguous-after-write") {
      fault = "none";
      return Promise.resolve({
        ok: false,
        error: { kind: "persistence-ambiguous" },
      });
    }
    return Promise.resolve({ ok: true, value: state });
  };
  return {
    store: {
      read: () => Promise.resolve({ ok: true, value: state }),
      compareAndSwap,
    },
    setNextFault: (nextFault): void => {
      fault = nextFault;
    },
    snapshot: (): M9b13e2LedgerSnapshot => state,
  };
}

async function createLedgerEvent(
  snapshot: M9b13e2LedgerSnapshot,
  sessionCommitment: string,
  status: z.infer<typeof ledgerStatusSchema>,
  candidateDigest: string,
  receiptDigest: string | null,
  ambiguity: "none" | "persistence-ambiguous",
): Promise<ContractResult<z.infer<typeof ledgerEventSchema>>> {
  const body = {
    protocol: M9B13E2_LEDGER_PROTOCOL,
    namespace: snapshot.namespace,
    sequence: snapshot.revision + 1,
    previousRoot: snapshot.root,
    sessionCommitment,
    status,
    candidateDigest,
    receiptDigest,
    ambiguity,
  } as const;
  const eventDigest = await digestOrFailure(body);
  if (!eventDigest.ok) return eventDigest;
  const resultingRootDigest = await digestOrFailure({
    previousRoot: snapshot.root,
    eventDigest: eventDigest.value,
  });
  if (!resultingRootDigest.ok) return resultingRootDigest;
  return {
    ok: true,
    value: {
      ...body,
      eventDigest: eventDigest.value,
      resultingRoot: `sha256:${resultingRootDigest.value}`,
    },
  };
}

type SyntheticAuthorityContext = Readonly<{
  protocol: typeof M9B13E2_SYNTHETIC_AUTHORITY_PROTOCOL;
  expectationPackageDigest: string;
  expectationPackageProtocol: typeof M9B13E2_EXPECTATION_PACKAGE_PROTOCOL;
  independentReviewIdentity: string;
  acceptedReviewDecision: typeof M9B13E2_EXPECTATION_REVIEW_DECISION;
  collector: z.infer<typeof executableIdentitySchema>;
  collectionMechanismSha256: string;
  verifier: z.infer<typeof executableIdentitySchema>;
  trustedInputInventorySha256: string;
  stateMachineProtocol: typeof M9B13E2_STATE_MACHINE_PROTOCOL;
  censusProtocol: typeof M9B13E2_CENSUS_PROTOCOL;
  ledgerProtocol: typeof M9B13E2_LEDGER_PROTOCOL;
  ledgerNamespace: string;
  trustedInitialRoot: string;
  amendmentProtocol: typeof M9B13E2_AMENDMENT_PROTOCOL;
  supplementProtocol: typeof M9B13E2_SUPPLEMENT_PROTOCOL;
  authorityActivationIdentity: typeof M9B13E2_SYNTHETIC_AUTHORITY_PROTOCOL;
  expectationPackage: M9b13e2ExpectationPackage;
}>;

export type M9b13e2SyntheticAdmissionResult =
  | Readonly<{ ok: true; receipt: M9b13e2AdmittedReceipt }>
  | Readonly<{
      ok: false;
      decision: "trusted-session-no-effect-stop";
      reason: z.infer<typeof stopReasonSchema>;
      effects: z.infer<typeof zeroEffectSchema>;
      receipt?: M9b13e2StoppedReceipt;
    }>;

export type M9b13e2SyntheticAdmissionHarness = Readonly<{
  protocol: typeof M9B13E2_SYNTHETIC_AUTHORITY_PROTOCOL;
  expectationPackageDigest: string;
  attempt: (value: unknown) => Promise<M9b13e2SyntheticAdmissionResult>;
}>;

function authorityMismatchReason(
  candidate: M9b13e2AdmissionCandidate,
  context: SyntheticAuthorityContext,
): z.infer<typeof stopReasonSchema> | null {
  if (
    candidate.sessionInputs.expectationPackageDigest !==
    context.expectationPackageDigest
  )
    return "expectation-package-mismatch";
  if (
    candidate.sessionInputs.hostBindingPolicySha256 !==
      context.expectationPackage.expectedHostBindingPolicySha256 ||
    !canonicalEqual(
      candidate.sessionInputs.operationalIdentity,
      context.expectationPackage.expectedOperationalUidPolicy,
    ) ||
    candidate.sessionInputs.trustedRootInventorySha256 !==
      context.expectationPackage.trustedRoots.inventorySha256 ||
    candidate.sessionInputs.filesystemPolicySha256 !==
      context.expectationPackage.trustedRoots.filesystemPolicySha256
  )
    return "expectation-package-mismatch";
  if (
    !canonicalEqual(
      candidate.sessionInputs.collectorIdentity,
      context.collector,
    )
  )
    return "collector-mismatch";
  if (
    !canonicalEqual(candidate.sessionInputs.verifierIdentity, context.verifier)
  )
    return "verifier-mismatch";
  if (
    candidate.sessionInputs.collectionMechanismSha256 !==
      context.collectionMechanismSha256 ||
    candidate.sessionInputs.trustedInputInventorySha256 !==
      context.trustedInputInventorySha256
  )
    return "trusted-input-inventory-mismatch";
  if (
    !canonicalEqual(
      candidate.sessionInputs.controllerIdentity,
      context.expectationPackage.controller,
    )
  )
    return "expectation-package-mismatch";
  if (
    candidate.sessionInputs.ledgerNamespace !== context.ledgerNamespace ||
    candidate.ledgerExpectation.namespace !== context.ledgerNamespace
  )
    return "expectation-package-mismatch";
  return null;
}

async function validateExpectedTopology(
  candidate: M9b13e2AdmissionCandidate,
  context: SyntheticAuthorityContext,
): Promise<ContractResult<true>> {
  const expected = context.expectationPackage.permittedProcessTopology;
  const environmentAllowlistDigest = await digestOrFailure(
    context.expectationPackage.environmentAllowlist,
  );
  if (
    !environmentAllowlistDigest.ok ||
    environmentAllowlistDigest.value !==
      candidate.sessionInputs.environmentAllowlistSha256
  )
    return failure("m9b13e2:environment-allowlist-mismatch");
  for (const census of candidate.censuses) {
    if (census.processRecords.length !== expected.length)
      return failure("m9b13e2:process-count-mismatch");
    for (const expectedProcess of expected) {
      const record = census.processRecords.find(
        (process) => process.processKey === expectedProcess.processKey,
      );
      if (record === undefined)
        return failure("m9b13e2:process-topology-not-exact");
      if (
        record.role !== expectedProcess.role ||
        record.parentProcessKey !== expectedProcess.parentProcessKey ||
        !canonicalEqual(record.executableIdentity, expectedProcess.identity) ||
        record.numericUid !==
          context.expectationPackage.expectedOperationalUidPolicy.numericUid ||
        !canonicalEqual(
          record.numericGids,
          context.expectationPackage.expectedOperationalUidPolicy.numericGids,
        )
      )
        return failure("m9b13e2:process-topology-not-exact");
    }
    if (!canonicalEqual(census.collectorIdentity, context.collector))
      return failure("m9b13e2:census-collector-mismatch");
  }
  return { ok: true, value: true };
}

async function makeStoppedReceipt(
  candidate: M9b13e2AdmissionCandidate,
  reason: z.infer<typeof stopReasonSchema>,
  reservation: z.infer<typeof ledgerEventSchema>,
  terminal: z.infer<typeof ledgerEventSchema> | null,
  persistenceAmbiguous: boolean,
): Promise<ContractResult<M9b13e2StoppedReceipt>> {
  const unsigned: M9b13e2StoppedReceipt = {
    protocol: M9B13E2_RECEIPT_PROTOCOL,
    decision: "trusted-session-no-effect-stop",
    candidate,
    independentVerification: candidate.verification.result,
    verificationEvidenceSha256: candidate.verification.evidenceSha256,
    acceptedAdmission: false,
    acceptedSealWritten: false,
    stopReason: reason,
    ambiguity: persistenceAmbiguous
      ? "persistence-ambiguous"
      : reason === "malformed-or-inconsistent-evidence"
        ? "evidence-incomplete"
        : "none",
    zeroEffects: ZERO_EFFECTS,
    ledger: {
      namespace: candidate.ledgerExpectation.namespace,
      reservation,
      terminal,
      persistenceAmbiguous,
    },
    canonicalReceiptDigest: "0".repeat(64),
  };
  const digest = await digestM9b13e2AuthorityReceipt(unsigned);
  return digest.ok
    ? {
        ok: true,
        value: { ...unsigned, canonicalReceiptDigest: digest.value },
      }
    : digest;
}

async function makeAdmittedReceipt(
  candidate: M9b13e2AdmissionCandidate,
  reservation: z.infer<typeof ledgerEventSchema>,
  terminal: z.infer<typeof ledgerEventSchema>,
): Promise<ContractResult<M9b13e2AdmittedReceipt>> {
  if (
    candidate.verification.result !== "pass" ||
    candidate.verification.evidenceSha256 === null
  )
    return failure("m9b13e2:independent-verification-not-pass");
  const unsigned: M9b13e2AdmittedReceipt = {
    protocol: M9B13E2_RECEIPT_PROTOCOL,
    decision: "trusted-session-admitted",
    candidate,
    independentVerification: "pass",
    verificationEvidenceSha256: candidate.verification.evidenceSha256,
    acceptedAdmission: true,
    acceptedSealWritten: true,
    stopReasons: [],
    ambiguity: "none",
    ledger: {
      namespace: candidate.ledgerExpectation.namespace,
      reservation,
      terminal,
      persistenceAmbiguous: false,
    },
    canonicalReceiptDigest: "0".repeat(64),
  };
  const digest = await digestM9b13e2AuthorityReceipt(unsigned);
  return digest.ok
    ? {
        ok: true,
        value: { ...unsigned, canonicalReceiptDigest: digest.value },
      }
    : digest;
}

async function attemptSyntheticAdmission(
  value: unknown,
  context: SyntheticAuthorityContext,
  store: M9b13e2LedgerStore,
): Promise<M9b13e2SyntheticAdmissionResult> {
  const parsed = m9b13e2AdmissionCandidateSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      decision: "trusted-session-no-effect-stop",
      reason: "malformed-or-inconsistent-evidence",
      effects: ZERO_EFFECTS,
    };
  const candidate = parsed.data;
  const candidateDigest = await digestM9b13e2AdmissionCandidate(candidate);
  if (
    !candidateDigest.ok ||
    candidateDigest.value !== candidate.canonicalCandidateDigest
  )
    return {
      ok: false,
      decision: "trusted-session-no-effect-stop",
      reason: "malformed-or-inconsistent-evidence",
      effects: ZERO_EFFECTS,
    };
  const snapshotResult = await store.read();
  if (!snapshotResult.ok)
    return {
      ok: false,
      decision: "trusted-session-no-effect-stop",
      reason: "persistence-ambiguous",
      effects: ZERO_EFFECTS,
    };
  const snapshot = snapshotResult.value;
  if (
    snapshot.namespace !== context.ledgerNamespace ||
    snapshot.trustedInitialRoot !== context.trustedInitialRoot
  )
    return {
      ok: false,
      decision: "trusted-session-no-effect-stop",
      reason: "expectation-package-mismatch",
      effects: ZERO_EFFECTS,
    };
  const priorEvents = snapshot.events.filter(
    (event) => event.sessionCommitment === candidate.sessionCommitment,
  );
  if (priorEvents.some((event) => event.status !== "reserved"))
    return {
      ok: false,
      decision: "trusted-session-no-effect-stop",
      reason: "terminal-session-reopening",
      effects: ZERO_EFFECTS,
    };
  if (priorEvents.length !== 0)
    return {
      ok: false,
      decision: "trusted-session-no-effect-stop",
      reason: "replayed-session-commitment",
      effects: ZERO_EFFECTS,
    };
  if (
    candidate.ledgerExpectation.expectedRevision !== snapshot.revision ||
    candidate.ledgerExpectation.expectedRoot !== snapshot.root
  )
    return {
      ok: false,
      decision: "trusted-session-no-effect-stop",
      reason: "stale-ledger-revision-or-root",
      effects: ZERO_EFFECTS,
    };
  const reservationEvent = await createLedgerEvent(
    snapshot,
    candidate.sessionCommitment,
    "reserved",
    candidate.canonicalCandidateDigest,
    null,
    "none",
  );
  if (!reservationEvent.ok)
    return {
      ok: false,
      decision: "trusted-session-no-effect-stop",
      reason: "persistence-ambiguous",
      effects: ZERO_EFFECTS,
    };
  const reservation = await store.compareAndSwap(
    snapshot.revision,
    snapshot.root,
    reservationEvent.value,
  );
  if (!reservation.ok)
    return {
      ok: false,
      decision: "trusted-session-no-effect-stop",
      reason:
        reservation.error.kind === "conflict"
          ? "conflicting-concurrent-reservation"
          : "persistence-ambiguous",
      effects: ZERO_EFFECTS,
    };
  let stopReason = authorityMismatchReason(candidate, context);
  const structure = await validateCandidateStructure(
    candidate,
    "trusted-session-admitted",
  );
  if (!structure.ok) stopReason = "malformed-or-inconsistent-evidence";
  const topology = await validateExpectedTopology(candidate, context);
  if (!topology.ok) stopReason = "expectation-package-mismatch";
  if (
    candidate.verification.result !== "pass" ||
    candidate.verification.evidenceSha256 === null
  )
    stopReason = "independent-verification-not-pass";
  const terminalStatus = stopReason === null ? "admitted" : "stopped";
  const terminalEvent = await createLedgerEvent(
    reservation.value,
    candidate.sessionCommitment,
    terminalStatus,
    candidate.canonicalCandidateDigest,
    null,
    "none",
  );
  if (!terminalEvent.ok)
    return {
      ok: false,
      decision: "trusted-session-no-effect-stop",
      reason: "persistence-ambiguous",
      effects: ZERO_EFFECTS,
    };
  const terminal = await store.compareAndSwap(
    reservation.value.revision,
    reservation.value.root,
    terminalEvent.value,
  );
  if (!terminal.ok) {
    const stoppedStructure = await validateCandidateStructure(
      candidate,
      "trusted-session-no-effect-stop",
    );
    const stopped = stoppedStructure.ok
      ? await makeStoppedReceipt(
          candidate,
          terminal.error.kind === "conflict"
            ? "conflicting-concurrent-reservation"
            : "persistence-ambiguous",
          reservationEvent.value,
          null,
          true,
        )
      : failure<M9b13e2StoppedReceipt>(
          "m9b13e2:stopped-candidate-structure-invalid",
        );
    return {
      ok: false,
      decision: "trusted-session-no-effect-stop",
      reason:
        terminal.error.kind === "conflict"
          ? "conflicting-concurrent-reservation"
          : "persistence-ambiguous",
      effects: ZERO_EFFECTS,
      ...(stopped.ok ? { receipt: stopped.value } : {}),
    };
  }
  if (stopReason !== null) {
    const stoppedStructure = await validateCandidateStructure(
      candidate,
      "trusted-session-no-effect-stop",
    );
    const stopped = stoppedStructure.ok
      ? await makeStoppedReceipt(
          candidate,
          stopReason,
          reservationEvent.value,
          terminalEvent.value,
          false,
        )
      : failure<M9b13e2StoppedReceipt>(
          "m9b13e2:stopped-candidate-structure-invalid",
        );
    return {
      ok: false,
      decision: "trusted-session-no-effect-stop",
      reason: stopReason,
      effects: ZERO_EFFECTS,
      ...(stopped.ok ? { receipt: stopped.value } : {}),
    };
  }
  const admitted = await makeAdmittedReceipt(
    candidate,
    reservationEvent.value,
    terminalEvent.value,
  );
  return admitted.ok
    ? { ok: true, receipt: admitted.value }
    : {
        ok: false,
        decision: "trusted-session-no-effect-stop",
        reason: "malformed-or-inconsistent-evidence",
        effects: ZERO_EFFECTS,
      };
}

export async function createSyntheticM9b13e2AdmissionHarness(
  expectationPackageValue: unknown,
  trustedInputInventorySha256: string,
  store: M9b13e2LedgerStore,
): Promise<ContractResult<M9b13e2SyntheticAdmissionHarness>> {
  const expectation = await validateM9b13e2ExpectationPackage(
    expectationPackageValue,
  );
  if (!expectation.ok) return expectation;
  const packageValue = expectation.value;
  const context: SyntheticAuthorityContext = Object.freeze({
    protocol: M9B13E2_SYNTHETIC_AUTHORITY_PROTOCOL,
    expectationPackageDigest: packageValue.packageCanonicalDigest,
    expectationPackageProtocol: packageValue.protocol,
    independentReviewIdentity: packageValue.independentReview.packageIdentity,
    acceptedReviewDecision: packageValue.independentReview.acceptedDecision,
    collector: packageValue.collector,
    collectionMechanismSha256: packageValue.collectionMechanismSha256,
    verifier: packageValue.verifier,
    trustedInputInventorySha256,
    stateMachineProtocol: packageValue.stateMachineProtocol,
    censusProtocol: packageValue.censusProtocol,
    ledgerProtocol: packageValue.antiReplayLedger.protocol,
    ledgerNamespace: packageValue.antiReplayLedger.namespace,
    trustedInitialRoot: packageValue.antiReplayLedger.trustedInitialRoot,
    amendmentProtocol: packageValue.expectedAmendmentProtocol,
    supplementProtocol: packageValue.expectedSupplementProtocol,
    authorityActivationIdentity: M9B13E2_SYNTHETIC_AUTHORITY_PROTOCOL,
    expectationPackage: packageValue,
  });
  return {
    ok: true,
    value: {
      protocol: M9B13E2_SYNTHETIC_AUTHORITY_PROTOCOL,
      expectationPackageDigest: packageValue.packageCanonicalDigest,
      attempt: async (value): Promise<M9b13e2SyntheticAdmissionResult> =>
        attemptSyntheticAdmission(value, context, store),
    },
  };
}

const archiveFileSchema = z.strictObject({
  name: nonemptySchema,
  version: z.literal(1),
  sha256: sha256Schema,
});

const supplementReviewSchema = z.strictObject({
  protocol: z.literal(M9B13E2_SUPPLEMENT_REVIEW_PROTOCOL),
  reviewPackageIdentity: nonemptySchema,
  reviewPackageDigest: sha256Schema,
  reviewedSupplementPackageDigest: sha256Schema,
  reviewedCommit: gitIdentitySchema,
  reviewedTree: gitIdentitySchema,
  reviewerIdentityCommitment: commitmentSchema,
  decision: z.literal("pass"),
  reviewEvidenceSha256: sha256Schema,
  checksumManifestSha256: sha256Schema,
  timestamp: timestampSchema,
  precededSubmissionAuthorization: z.literal(true),
});

export const m9b13e2SupplementSchema = z.strictObject({
  protocol: z.literal(M9B13E2_SUPPLEMENT_PROTOCOL),
  supplementPackageIdentity: nonemptySchema,
  supplementPackageDigest: sha256Schema,
  prospective: z.literal(true),
  amendedAssumption: z.literal(M9B13E2_AMENDED_ASSUMPTION),
  nonclaim: z.literal(M9B13E2_NONCLAIM),
  retainedScope: z.literal(M9B13E2_RETAINED_SCOPE),
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
  historicalNoGos: z.array(nonemptySchema).min(8),
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
  independentPreSubmissionReview: supplementReviewSchema,
  submissionAuthorizationTimestamp: timestampSchema,
  attachmentInventorySha256: sha256Schema,
  serverSubmissionTimestamp: timestampSchema,
  approvalTimestamp: timestampSchema.nullable(),
  independentPostUploadByteVerification: z.literal(true),
  appendOnlyLocalReceiptRequired: z.literal(true),
  separateSubmissionAuthorizationRequired: z.literal(true),
  separateApprovalAuthorizationRequired: z.literal(true),
  supplementApprovalGrantsCorpusOrAcquisitionAuthority: z.literal(false),
});

export type M9b13e2Supplement = z.infer<typeof m9b13e2SupplementSchema>;

export function validateM9b13e2Supplement(
  value: unknown,
): ContractResult<M9b13e2Supplement> {
  const parsed = m9b13e2SupplementSchema.safeParse(value);
  if (!parsed.success)
    return failure("m9b13e2:supplement-schema-or-hostile-key-rejected");
  const supplement = parsed.data;
  if (
    supplement.supplementPackageIdentity === "63sh5" ||
    supplement.independentPreSubmissionReview.reviewPackageIdentity ===
      supplement.supplementPackageIdentity
  )
    return failure("m9b13e2:supplement-or-review-identity-not-independent");
  if (
    !canonicalEqual(
      supplement.registration.immutableFiles,
      M9B13E1_REGISTERED_ARCHIVE_FILES,
    )
  )
    return failure("m9b13e2:registered-archive-identity-mismatch");
  if (
    supplement.independentPreSubmissionReview
      .reviewedSupplementPackageDigest !== supplement.supplementPackageDigest
  )
    return failure("m9b13e2:reviewed-supplement-digest-mismatch");
  if (
    Date.parse(supplement.independentPreSubmissionReview.timestamp) >=
    Date.parse(supplement.submissionAuthorizationTimestamp)
  )
    return failure("m9b13e2:review-did-not-precede-submission-authorization");
  const expectedHistory = new Set([
    "M9b.13",
    "M9b.13a",
    "M9b.13b",
    "M9b.13c",
    "M9b.13d",
    "M9b.13d.1",
    "M9b.13e-and-independent-review",
    "M9b.13e.1-and-independent-review",
  ]);
  for (const historical of supplement.historicalNoGos)
    expectedHistory.delete(historical);
  if (expectedHistory.size !== 0)
    return failure("m9b13e2:historical-no-go-omitted");
  return { ok: true, value: supplement };
}
