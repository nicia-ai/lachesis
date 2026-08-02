import { canonicalizeJson, digestValue, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type M9b12cPreregistration,
  prepareM9b12cPreregistration,
  verifyM9b12cPreregistration,
} from "./m9b12c-preregistration.js";
import {
  type M9b12dPreregistration,
  m9b12dPreregistrationSchema,
  prepareM9b12dPreregistration,
  verifyM9b12dPreregistration,
} from "./m9b12d-preregistration.js";

export const M9B12E_PREREGISTRATION_PROTOCOL = Object.freeze({
  id: "lachesis-m9b12e-offline-preregistration-package",
  version: "1.0.0",
  qualified: "lachesis-m9b12e-offline-preregistration-package@1.0.0",
  baselineCommit: "5dff4a5f74933135c4c686f1c94df04cc320f53b",
  baselineTree: "a021670c01fc020afe3e682f847d40e2084a1545",
  visibility: "private-offline-preregistration-correction-only" as const,
  decision: "m9b12e-corrected-package-ready-for-independent-review" as const,
});

export const M9B12E_RETIRED_CORPUS_PROTOCOL =
  "lachesis-m9b12e-retired-corpus-quarantine@1.0.0" as const;
export const M9B12E_DURABLE_AUTHORITY_PROTOCOL =
  "lachesis-m9b12e-durable-quarantine-authority/1" as const;
export const M9B12E_AUTHENTICATED_OBSERVER_IDENTITY_PROTOCOL =
  "lachesis-m9b12e-authenticated-observer-identity/1" as const;
export const M9B12E_ATOMIC_ADMISSION_PROTOCOL =
  "lachesis-m9b12e-atomic-role-effect-admission/1" as const;
export const M9B12E_EXTERNAL_REGISTRATION_PROTOCOL =
  "lachesis-m9b12e-append-only-external-registration/1" as const;
export const M9B12E_PREREGISTRATION_DIGEST =
  "d973ce34b715cd5d9bcc4c33d42184980a97be9b4cae1aaea2825e5b99520f5c" as const;
const M9B4_EFFECT_LEDGER_PROTOCOL =
  "lachesis-m9b4-offline-effect-ledger@1.2.0" as const;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export type M9b12ePreregistrationFailure = Readonly<{
  kind: "integrity";
  message: string;
}>;

function failure(message: string): Result<never, M9b12ePreregistrationFailure> {
  return { ok: false, error: { kind: "integrity", message } };
}

async function digestBody(
  value: unknown,
): Promise<Result<string, M9b12ePreregistrationFailure>> {
  const digest = await digestValue(value);
  return digest.ok
    ? { ok: true, value: digest.value }
    : failure("M9b.12e canonical digest failed.");
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

const m9b12LineageSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b12-offline-preregistration-package@1.0.0"),
    commit: z.literal("b9f13c7b215624eb651caf3b038b77976247c9a3"),
    tree: z.literal("30144b30de282d63371f9afedeb7d5ac43cfa739"),
    preregistrationDigest: z.literal(
      "f12c1212c4fbaa57190059f4d29ef413d09f9d006489b7b95ae038e426a74ff5",
    ),
    checksumManifestDigest: z.literal(
      "437c7b26238d1f758efcb4ed753662d6da197526b2f1a707b0f0961de5cbd83c",
    ),
    status: z.literal(
      "superseded-unregistered-retired-corpus-policy-incomplete",
    ),
  })
  .readonly();

const m9b12aLineageSchema = z
  .strictObject({
    protocol: z.literal(
      "lachesis-m9b12a-offline-preregistration-package@1.0.0",
    ),
    commit: z.literal("d8cadc384ec99df8c2c938c9dda2992be15f8272"),
    tree: z.literal("8babde6e603705f2c672afc260157c6fdd02bc88"),
    preregistrationDigest: z.literal(
      "79db2718c94a938431544f8bc72f793c478ed85bff56a2071c3bd03d999c2831",
    ),
    checksumManifestDigest: z.literal(
      "fb98320423322624a42eea328a71d90199b1208b5e5094a999876eca14775298",
    ),
    status: z.literal(
      "superseded-unregistered-retired-corpus-enforcement-incomplete",
    ),
  })
  .readonly();

const m9b12bLineageSchema = z
  .strictObject({
    protocol: z.literal(
      "lachesis-m9b12b-offline-preregistration-package@1.0.0",
    ),
    commit: z.literal("f1f4dae5b681e2237161be5da0d6e4781a15a538"),
    tree: z.literal("8609e77370ceefaffbd06752f1fc343903839c23"),
    preregistrationDigest: z.literal(
      "52807c052f6e3fab79a943a4e2c6644296823f3b40f49e4452ad40a641a83bd2",
    ),
    checksumManifestDigest: z.literal(
      "ed9d3a0fda5c0bb753f17dcc01370281406ec6bfd4cc157f8927c6d2d892face",
    ),
    status: z.literal("superseded-unregistered-quarantine-history-not-durable"),
  })
  .readonly();

const m9b12cLineageSchema = z
  .strictObject({
    protocol: z.literal(
      "lachesis-m9b12c-offline-preregistration-package@1.0.0",
    ),
    commit: z.literal("c9e50ff3db56f898184dc9b7be934b1f1c0560df"),
    tree: z.literal("ef9f3847a6f0eb7d1a5a519c4acc90cd6a2354fd"),
    preregistrationDigest: z.literal(
      "62cff37dae7332855b8f7a8f9583f5b5f0917adde2d9b2c019603fb101392fc3",
    ),
    checksumManifestDigest: z.literal(
      "65cca06be59f863b7d5256bdac7fc57d4653d2404ce9d8047bb863d0dc5dbc46",
    ),
    status: z.literal(
      "superseded-unregistered-process-durability-identity-admission-incomplete",
    ),
  })
  .readonly();

const m9b12dLineageSchema = z
  .strictObject({
    protocol: z.literal(
      "lachesis-m9b12d-offline-preregistration-package@1.0.0",
    ),
    commit: z.literal(M9B12E_PREREGISTRATION_PROTOCOL.baselineCommit),
    tree: z.literal(M9B12E_PREREGISTRATION_PROTOCOL.baselineTree),
    preregistrationDigest: z.literal(
      "ed991e11ccc6c9129bdb6509dd011b28006b4420d59bf4290d2dac11765ccef0",
    ),
    checksumManifestDigest: z.literal(
      "8524883df08e628dfbd07eff16aa057110e28fe7746ac11beb24b525871b510e",
    ),
    independentReviewDecision: z.literal("m9b12d-independent-review-no-go"),
    status: z.literal(
      "superseded-unregistered-durability-claim-and-presenter-identity-incomplete",
    ),
  })
  .readonly();

const M9B12_LINEAGE = Object.freeze({
  protocol: "lachesis-m9b12-offline-preregistration-package@1.0.0",
  commit: "b9f13c7b215624eb651caf3b038b77976247c9a3",
  tree: "30144b30de282d63371f9afedeb7d5ac43cfa739",
  preregistrationDigest:
    "f12c1212c4fbaa57190059f4d29ef413d09f9d006489b7b95ae038e426a74ff5",
  checksumManifestDigest:
    "437c7b26238d1f758efcb4ed753662d6da197526b2f1a707b0f0961de5cbd83c",
  status: "superseded-unregistered-retired-corpus-policy-incomplete",
});
const M9B12A_LINEAGE = Object.freeze({
  protocol: "lachesis-m9b12a-offline-preregistration-package@1.0.0",
  commit: "d8cadc384ec99df8c2c938c9dda2992be15f8272",
  tree: "8babde6e603705f2c672afc260157c6fdd02bc88",
  preregistrationDigest:
    "79db2718c94a938431544f8bc72f793c478ed85bff56a2071c3bd03d999c2831",
  checksumManifestDigest:
    "fb98320423322624a42eea328a71d90199b1208b5e5094a999876eca14775298",
  status: "superseded-unregistered-retired-corpus-enforcement-incomplete",
});
const M9B12B_LINEAGE = Object.freeze({
  protocol: "lachesis-m9b12b-offline-preregistration-package@1.0.0",
  commit: "f1f4dae5b681e2237161be5da0d6e4781a15a538",
  tree: "8609e77370ceefaffbd06752f1fc343903839c23",
  preregistrationDigest:
    "52807c052f6e3fab79a943a4e2c6644296823f3b40f49e4452ad40a641a83bd2",
  checksumManifestDigest:
    "ed9d3a0fda5c0bb753f17dcc01370281406ec6bfd4cc157f8927c6d2d892face",
  status: "superseded-unregistered-quarantine-history-not-durable",
});
const M9B12C_LINEAGE = Object.freeze({
  protocol: "lachesis-m9b12c-offline-preregistration-package@1.0.0",
  commit: "c9e50ff3db56f898184dc9b7be934b1f1c0560df",
  tree: "ef9f3847a6f0eb7d1a5a519c4acc90cd6a2354fd",
  preregistrationDigest:
    "62cff37dae7332855b8f7a8f9583f5b5f0917adde2d9b2c019603fb101392fc3",
  checksumManifestDigest:
    "65cca06be59f863b7d5256bdac7fc57d4653d2404ce9d8047bb863d0dc5dbc46",
  status:
    "superseded-unregistered-process-durability-identity-admission-incomplete",
});
const M9B12D_LINEAGE = Object.freeze({
  protocol: "lachesis-m9b12d-offline-preregistration-package@1.0.0",
  commit: M9B12E_PREREGISTRATION_PROTOCOL.baselineCommit,
  tree: M9B12E_PREREGISTRATION_PROTOCOL.baselineTree,
  preregistrationDigest:
    "ed991e11ccc6c9129bdb6509dd011b28006b4420d59bf4290d2dac11765ccef0",
  checksumManifestDigest:
    "8524883df08e628dfbd07eff16aa057110e28fe7746ac11beb24b525871b510e",
  independentReviewDecision: "m9b12d-independent-review-no-go",
  status:
    "superseded-unregistered-durability-claim-and-presenter-identity-incomplete",
});

const preservedStudyFieldNames = Object.freeze([
  "researchQuestion",
  "bindings",
  "treatment",
  "control",
  "matching",
  "population",
  "primaryEndpoint",
  "analysis",
  "probeAdvancement",
  "financial",
  "operationalSequence",
  "countPricingKillGates",
  "operationalSecurity",
  "disclosureAndRoles",
  "nonclaims",
  "audit",
  "authority",
  "inheritedDecisions",
] as const);

function preservedStudyFields(
  preregistration: M9b12cPreregistration,
): Readonly<Record<(typeof preservedStudyFieldNames)[number], unknown>> {
  return {
    researchQuestion: preregistration.researchQuestion,
    bindings: preregistration.bindings,
    treatment: preregistration.treatment,
    control: preregistration.control,
    matching: preregistration.matching,
    population: preregistration.population,
    primaryEndpoint: preregistration.primaryEndpoint,
    analysis: preregistration.analysis,
    probeAdvancement: preregistration.probeAdvancement,
    financial: preregistration.financial,
    operationalSequence: preregistration.operationalSequence,
    countPricingKillGates: preregistration.countPricingKillGates,
    operationalSecurity: preregistration.operationalSecurity,
    disclosureAndRoles: preregistration.disclosureAndRoles,
    nonclaims: preregistration.nonclaims,
    audit: preregistration.audit,
    authority: preregistration.authority,
    inheritedDecisions: preregistration.inheritedDecisions,
  };
}

function correctedFutureAuthorizations(
  predecessor: M9b12dPreregistration,
): M9b12dPreregistration["futureAuthorizations"] {
  return originalShape.futureAuthorizations.parse({
    issued: false,
    texts: predecessor.futureAuthorizations.texts.map((authorization) => ({
      ...authorization,
      text: authorization.text.replaceAll("M9b.12d", "M9b.12e"),
      prerequisites: authorization.prerequisites
        .replaceAll("M9b.12d", "M9b.12e")
        .replaceAll(
          "cross-process durable authority, trusted observer identity, and atomic admission",
          "honestly scoped local durable authority, authenticated opaque observer identity, and atomic admission",
        )
        .replaceAll(
          "durable retired-material history",
          "durable authority, authenticated observer identity, and atomic admission history",
        )
        .replaceAll(
          "durable retired-material",
          "durable authenticated-identity retired-material",
        ),
      grantsOnly: authorization.grantsOnly,
    })),
  });
}

export const m9b12eExternalRegistrationFormatSchema = z
  .strictObject({
    protocol: z.literal(M9B12E_EXTERNAL_REGISTRATION_PROTOCOL),
    status: z.literal("format-only-no-record-present"),
    registrablePackage: z.literal(M9B12E_PREREGISTRATION_PROTOCOL.qualified),
    supersessionLineage: z
      .tuple([
        m9b12LineageSchema,
        m9b12aLineageSchema,
        m9b12bLineageSchema,
        m9b12cLineageSchema,
        m9b12dLineageSchema,
      ])
      .readonly(),
    requiredFields: z
      .tuple([
        z.literal("registration-service"),
        z.literal("registration-record-id"),
        z.literal("server-registered-at"),
        z.literal("m9b12e-preregistration-digest"),
        z.literal("source-commit"),
        z.literal("source-tree"),
        z.literal("checksum-manifest-digest"),
        z.literal("submitted-attachment-inventory-and-sha256"),
        z.literal("registrant-attestation"),
      ])
      .readonly(),
    sourceBinding: z
      .strictObject({
        baselineCommit: z.literal(
          M9B12E_PREREGISTRATION_PROTOCOL.baselineCommit,
        ),
        baselineTree: z.literal(M9B12E_PREREGISTRATION_PROTOCOL.baselineTree),
        sourceCommit: z.null(),
        sourceTree: z.null(),
        procedure: z.literal(
          "external-record-binds-reviewed-source-commit-and-tree-after-independent-review",
        ),
      })
      .readonly(),
    amendmentRule: z.literal(
      "append-only-new-identity-no-reinterpretation-of-predecessor-bytes",
    ),
    registrationRecord: z.null(),
    submissionAuthorized: z.literal(false),
  })
  .readonly();
export type M9b12eExternalRegistrationFormat = z.infer<
  typeof m9b12eExternalRegistrationFormatSchema
>;

export function createM9b12eExternalRegistrationFormat(): M9b12eExternalRegistrationFormat {
  return m9b12eExternalRegistrationFormatSchema.parse({
    protocol: M9B12E_EXTERNAL_REGISTRATION_PROTOCOL,
    status: "format-only-no-record-present",
    registrablePackage: M9B12E_PREREGISTRATION_PROTOCOL.qualified,
    supersessionLineage: [
      M9B12_LINEAGE,
      M9B12A_LINEAGE,
      M9B12B_LINEAGE,
      M9B12C_LINEAGE,
      M9B12D_LINEAGE,
    ],
    requiredFields: [
      "registration-service",
      "registration-record-id",
      "server-registered-at",
      "m9b12e-preregistration-digest",
      "source-commit",
      "source-tree",
      "checksum-manifest-digest",
      "submitted-attachment-inventory-and-sha256",
      "registrant-attestation",
    ],
    sourceBinding: {
      baselineCommit: M9B12E_PREREGISTRATION_PROTOCOL.baselineCommit,
      baselineTree: M9B12E_PREREGISTRATION_PROTOCOL.baselineTree,
      sourceCommit: null,
      sourceTree: null,
      procedure:
        "external-record-binds-reviewed-source-commit-and-tree-after-independent-review",
    },
    amendmentRule:
      "append-only-new-identity-no-reinterpretation-of-predecessor-bytes",
    registrationRecord: null,
    submissionAuthorized: false,
  });
}

const scientificFinancialSchema = z
  .strictObject({
    estimand: z.literal(
      "evidence-adaptive-codemode-versus-matched-static-one-shot-first-attempt-grounded-success",
    ),
    probePairs: z.literal(24),
    primaryPairs: z.literal(168),
    balancedCells: z.literal(24),
    analysis: z.literal("exact-one-sided-conditional-mcnemar"),
    zeroRetries: z.literal(true),
    maximumConcurrency: z.literal(1),
    countRequests: z.literal(768),
    inferenceCalls: z.literal(768),
    maximumHttpRequests: z.literal(1536),
    inferenceCeilingUsdMicros: z.literal(342_097_920),
    countContingencyUsdMicros: z.literal(117_964_800),
    operationalCeilingUsdMicros: z.literal(460_062_720),
    providerCapUsdMicros: z.literal(500_000_000),
    headroomUsdMicros: z.literal(39_937_280),
    inheritedFieldsCanonicalDigest: digestSchema,
    inheritedFieldsCanonicalEqualityRequired: z.literal(true),
  })
  .readonly();

const durableAuthorityPolicySchema = z
  .strictObject({
    protocol: z.literal(M9B12E_DURABLE_AUTHORITY_PROTOCOL),
    adapter: z.literal("private-node-sqlite-plus-separate-trusted-anchor"),
    createAndOpenOperationsDistinct: z.literal(true),
    existingOpenMayCreateEmptyState: z.literal(false),
    databaseTransaction: z.literal(
      "sqlite-begin-immediate-revision-state-digest-cas",
    ),
    consistencyRecoveryAnchor: z.literal(
      "separate-private-fsync-atomic-replace-revision-head-state-digest-binding",
    ),
    permissions: z.literal("parents-0700-files-0600-owner-regular-no-symlinks"),
    accidentalUnilateralRollbackAndWrongAnchorFailClosed: z.literal(true),
    coordinatedCompleteLocalRollbackDetected: z.literal(false),
    completeChainValidationOnEveryUse: z.literal(true),
  })
  .readonly();

const threatModelPolicySchema = z
  .strictObject({
    trustedComputingBase: z
      .tuple([
        z.literal("controller-implementation"),
        z.literal("controller-host-operating-system"),
        z.literal("controller-privileged-operator"),
        z.literal("private-authority-storage-domain"),
        z.literal("authenticated-principal-channel-adapter"),
      ])
      .readonly(),
    untrusted: z
      .tuple([
        z.literal("study-roles"),
        z.literal("model-outputs"),
        z.literal("corpus-content"),
        z.literal("ordinary-request-callers"),
        z.literal("role-containers"),
      ])
      .readonly(),
    protectedThreats: z
      .tuple([
        z.literal("process-crash-and-restart"),
        z.literal("interrupted-writes"),
        z.literal("concurrent-controllers"),
        z.literal("partial-database-or-anchor-replacement"),
        z.literal("malformed-truncated-forked-or-inconsistent-state"),
        z.literal("study-role-access"),
        z.literal("symlinks-and-permission-drift"),
        z.literal("stale-heads-and-admissions"),
        z.literal("accidental-unilateral-rollback"),
      ])
      .readonly(),
    excludedThreats: z
      .tuple([
        z.literal("malicious-or-compromised-privileged-host-or-operator"),
        z.literal("coordinated-complete-local-authority-domain-rollback"),
        z.literal("privileged-matching-sqlite-and-anchor-rollback"),
        z.literal("kernel-hypervisor-or-hardware-compromise"),
      ])
      .readonly(),
    completeLocalRollbackDetectionClaimed: z.literal(false),
    independentMonotonicWitnessPresent: z.literal(false),
    completeLocalRollbackResistanceRequiresIndependentWitness: z.literal(true),
    detectedOrSuspectedOperatorRestoreDisposition: z.literal(
      "halt-campaign-require-new-execution-identity-no-normal-resume",
    ),
  })
  .readonly();

const authenticatedIdentityPolicySchema = z
  .strictObject({
    protocol: z.literal(M9B12E_AUTHENTICATED_OBSERVER_IDENTITY_PROTOCOL),
    domain: z.literal(
      "controller-issued-opaque-study-principal-and-launch-allocation",
    ),
    canonicalEncoding: z.literal("lowercase-256-bit-hex"),
    noncanonicalEncodingRejected: z.literal(true),
    displayMetadataAuthoritative: z.literal(false),
    observerKeyControllerDerived: z.literal(true),
    assessmentCallerMaySupplyCommitmentAliasOrPrincipal: z.literal(false),
    durablePrincipalToObserverMappingImmutable: z.literal(true),
    launchHandleBindsRoleSessionAndAllocation: z.literal(true),
    launchHandleAuthenticatesPresenter: z.literal(false),
    authenticatedPresenterContextSeparateFromRequest: z.literal(true),
    presenterPrincipalCheckedInsideAdmission: z.literal(true),
  })
  .readonly();

const atomicAdmissionPolicySchema = z
  .strictObject({
    protocol: z.literal(M9B12E_ATOMIC_ADMISSION_PROTOCOL),
    linearizationPoint: z.literal(
      "durable-admission-effect-started-event-commit",
    ),
    currentProofsAndIdentityResolvedBeforeCas: z.literal(true),
    authenticatedPresenterResolvedInsideAdmission: z.literal(true),
    quarantineRecheckedInsideTransaction: z.literal(true),
    oneTimeAdmissionAndLaunchConsumed: z.literal(true),
    reusableBarePermissionExposed: z.literal(false),
    crashAfterStartIsAmbiguousAndNeverReadmitted: z.literal(true),
    providerEffectsPermitted: z.literal(false),
    requiredProviderEffectLedgerProtocol: z.literal(
      "lachesis-m9b4-offline-effect-ledger@1.2.0",
    ),
  })
  .readonly();

const originalShape = m9b12dPreregistrationSchema.unwrap().shape;
const preregistrationBodySchema = z
  .strictObject({
    protocol: z.literal(M9B12E_PREREGISTRATION_PROTOCOL.id),
    version: z.literal(M9B12E_PREREGISTRATION_PROTOCOL.version),
    baselineCommit: z.literal(M9B12E_PREREGISTRATION_PROTOCOL.baselineCommit),
    baselineTree: z.literal(M9B12E_PREREGISTRATION_PROTOCOL.baselineTree),
    status: z.literal(
      "offline-immutable-superseding-draft-not-externally-registered",
    ),
    supersession: z
      .strictObject({
        protocol: z.literal("lachesis-m9b12e-linear-supersession/1"),
        ordering: z
          .tuple([
            z.literal(M9B12_LINEAGE.protocol),
            z.literal(M9B12A_LINEAGE.protocol),
            z.literal(M9B12B_LINEAGE.protocol),
            z.literal(M9B12C_LINEAGE.protocol),
            z.literal(M9B12D_LINEAGE.protocol),
            z.literal(M9B12E_PREREGISTRATION_PROTOCOL.qualified),
          ])
          .readonly(),
        predecessors: z
          .tuple([
            m9b12LineageSchema,
            m9b12aLineageSchema,
            m9b12bLineageSchema,
            m9b12cLineageSchema,
            m9b12dLineageSchema,
          ])
          .readonly(),
        predecessorBytesModified: z.literal(false),
        predecessorExternallyRegistered: z.literal(false),
      })
      .readonly(),
    preservedStudyFields: z
      .tuple([
        z.literal("researchQuestion"),
        z.literal("bindings"),
        z.literal("treatment"),
        z.literal("control"),
        z.literal("matching"),
        z.literal("population"),
        z.literal("primaryEndpoint"),
        z.literal("analysis"),
        z.literal("probeAdvancement"),
        z.literal("financial"),
        z.literal("operationalSequence"),
        z.literal("countPricingKillGates"),
        z.literal("operationalSecurity"),
        z.literal("disclosureAndRoles"),
        z.literal("nonclaims"),
        z.literal("audit"),
        z.literal("authority"),
        z.literal("inheritedDecisions"),
      ])
      .readonly(),
    scientificFinancialInvariance: scientificFinancialSchema,
    threatModel: threatModelPolicySchema,
    durableAuthority: durableAuthorityPolicySchema,
    authenticatedObserverIdentity: authenticatedIdentityPolicySchema,
    atomicAdmission: atomicAdmissionPolicySchema,
    futureAuthorizations: originalShape.futureAuthorizations,
    externalRegistrationFormat: m9b12eExternalRegistrationFormatSchema,
    correctionAudit: z
      .strictObject({
        reviewDecisionAddressed: z.literal("m9b12d-independent-review-no-go"),
        honestDurabilityScopeImplemented: z.literal(true),
        opaqueAuthenticatedObserverIdentityImplemented: z.literal(true),
        atomicAdmissionImplemented: z.literal(true),
        m9b12BytesModified: z.literal(false),
        m9b12aBytesModified: z.literal(false),
        m9b12bBytesModified: z.literal(false),
        m9b12cBytesModified: z.literal(false),
        m9b12dBytesModified: z.literal(false),
        scientificProtocolUnchanged: z.literal(true),
        financialProtocolUnchanged: z.literal(true),
        providerEffects: z.literal(0),
        networkEffects: z.literal(0),
        credentialEffects: z.literal(0),
      })
      .readonly(),
    decision: z.literal(M9B12E_PREREGISTRATION_PROTOCOL.decision),
  })
  .readonly();

export const m9b12ePreregistrationSchema = preregistrationBodySchema
  .unwrap()
  .safeExtend({ preregistrationDigest: digestSchema })
  .readonly();
export type M9b12ePreregistration = z.infer<typeof m9b12ePreregistrationSchema>;

async function deriveM9b12ePreregistration(): Promise<
  Result<M9b12ePreregistration, M9b12ePreregistrationFailure>
> {
  const predecessor = await prepareM9b12dPreregistration();
  if (!predecessor.ok)
    return failure("M9b.12d predecessor could not rederive.");
  const verified = await verifyM9b12dPreregistration(
    predecessor.value.token,
    predecessor.value.preregistration,
  );
  if (
    !verified.ok ||
    verified.value.preregistrationDigest !==
      M9B12D_LINEAGE.preregistrationDigest
  )
    return failure("M9b.12d predecessor identity changed.");
  const scientificPredecessor = await prepareM9b12cPreregistration();
  if (!scientificPredecessor.ok)
    return failure("M9b.12c scientific predecessor could not rederive.");
  const scientificVerified = await verifyM9b12cPreregistration(
    scientificPredecessor.value.token,
    scientificPredecessor.value.preregistration,
  );
  if (!scientificVerified.ok)
    return failure("M9b.12c scientific predecessor identity changed.");
  const inheritedDigest = await digestBody(
    preservedStudyFields(scientificVerified.value),
  );
  if (!inheritedDigest.ok) return inheritedDigest;
  const body = preregistrationBodySchema.parse({
    protocol: M9B12E_PREREGISTRATION_PROTOCOL.id,
    version: M9B12E_PREREGISTRATION_PROTOCOL.version,
    baselineCommit: M9B12E_PREREGISTRATION_PROTOCOL.baselineCommit,
    baselineTree: M9B12E_PREREGISTRATION_PROTOCOL.baselineTree,
    status: "offline-immutable-superseding-draft-not-externally-registered",
    supersession: {
      protocol: "lachesis-m9b12e-linear-supersession/1",
      ordering: [
        M9B12_LINEAGE.protocol,
        M9B12A_LINEAGE.protocol,
        M9B12B_LINEAGE.protocol,
        M9B12C_LINEAGE.protocol,
        M9B12D_LINEAGE.protocol,
        M9B12E_PREREGISTRATION_PROTOCOL.qualified,
      ],
      predecessors: [
        M9B12_LINEAGE,
        M9B12A_LINEAGE,
        M9B12B_LINEAGE,
        M9B12C_LINEAGE,
        M9B12D_LINEAGE,
      ],
      predecessorBytesModified: false,
      predecessorExternallyRegistered: false,
    },
    preservedStudyFields: preservedStudyFieldNames,
    scientificFinancialInvariance: {
      estimand:
        "evidence-adaptive-codemode-versus-matched-static-one-shot-first-attempt-grounded-success",
      probePairs: 24,
      primaryPairs: 168,
      balancedCells: 24,
      analysis: "exact-one-sided-conditional-mcnemar",
      zeroRetries: true,
      maximumConcurrency: 1,
      countRequests: 768,
      inferenceCalls: 768,
      maximumHttpRequests: 1536,
      inferenceCeilingUsdMicros: 342_097_920,
      countContingencyUsdMicros: 117_964_800,
      operationalCeilingUsdMicros: 460_062_720,
      providerCapUsdMicros: 500_000_000,
      headroomUsdMicros: 39_937_280,
      inheritedFieldsCanonicalDigest: inheritedDigest.value,
      inheritedFieldsCanonicalEqualityRequired: true,
    },
    threatModel: {
      trustedComputingBase: [
        "controller-implementation",
        "controller-host-operating-system",
        "controller-privileged-operator",
        "private-authority-storage-domain",
        "authenticated-principal-channel-adapter",
      ],
      untrusted: [
        "study-roles",
        "model-outputs",
        "corpus-content",
        "ordinary-request-callers",
        "role-containers",
      ],
      protectedThreats: [
        "process-crash-and-restart",
        "interrupted-writes",
        "concurrent-controllers",
        "partial-database-or-anchor-replacement",
        "malformed-truncated-forked-or-inconsistent-state",
        "study-role-access",
        "symlinks-and-permission-drift",
        "stale-heads-and-admissions",
        "accidental-unilateral-rollback",
      ],
      excludedThreats: [
        "malicious-or-compromised-privileged-host-or-operator",
        "coordinated-complete-local-authority-domain-rollback",
        "privileged-matching-sqlite-and-anchor-rollback",
        "kernel-hypervisor-or-hardware-compromise",
      ],
      completeLocalRollbackDetectionClaimed: false,
      independentMonotonicWitnessPresent: false,
      completeLocalRollbackResistanceRequiresIndependentWitness: true,
      detectedOrSuspectedOperatorRestoreDisposition:
        "halt-campaign-require-new-execution-identity-no-normal-resume",
    },
    durableAuthority: {
      protocol: M9B12E_DURABLE_AUTHORITY_PROTOCOL,
      adapter: "private-node-sqlite-plus-separate-trusted-anchor",
      createAndOpenOperationsDistinct: true,
      existingOpenMayCreateEmptyState: false,
      databaseTransaction: "sqlite-begin-immediate-revision-state-digest-cas",
      consistencyRecoveryAnchor:
        "separate-private-fsync-atomic-replace-revision-head-state-digest-binding",
      permissions: "parents-0700-files-0600-owner-regular-no-symlinks",
      accidentalUnilateralRollbackAndWrongAnchorFailClosed: true,
      coordinatedCompleteLocalRollbackDetected: false,
      completeChainValidationOnEveryUse: true,
    },
    authenticatedObserverIdentity: {
      protocol: M9B12E_AUTHENTICATED_OBSERVER_IDENTITY_PROTOCOL,
      domain: "controller-issued-opaque-study-principal-and-launch-allocation",
      canonicalEncoding: "lowercase-256-bit-hex",
      noncanonicalEncodingRejected: true,
      displayMetadataAuthoritative: false,
      observerKeyControllerDerived: true,
      assessmentCallerMaySupplyCommitmentAliasOrPrincipal: false,
      durablePrincipalToObserverMappingImmutable: true,
      launchHandleBindsRoleSessionAndAllocation: true,
      launchHandleAuthenticatesPresenter: false,
      authenticatedPresenterContextSeparateFromRequest: true,
      presenterPrincipalCheckedInsideAdmission: true,
    },
    atomicAdmission: {
      protocol: M9B12E_ATOMIC_ADMISSION_PROTOCOL,
      linearizationPoint: "durable-admission-effect-started-event-commit",
      currentProofsAndIdentityResolvedBeforeCas: true,
      authenticatedPresenterResolvedInsideAdmission: true,
      quarantineRecheckedInsideTransaction: true,
      oneTimeAdmissionAndLaunchConsumed: true,
      reusableBarePermissionExposed: false,
      crashAfterStartIsAmbiguousAndNeverReadmitted: true,
      providerEffectsPermitted: false,
      requiredProviderEffectLedgerProtocol: M9B4_EFFECT_LEDGER_PROTOCOL,
    },
    futureAuthorizations: correctedFutureAuthorizations(verified.value),
    externalRegistrationFormat: createM9b12eExternalRegistrationFormat(),
    correctionAudit: {
      reviewDecisionAddressed: "m9b12d-independent-review-no-go",
      honestDurabilityScopeImplemented: true,
      opaqueAuthenticatedObserverIdentityImplemented: true,
      atomicAdmissionImplemented: true,
      m9b12BytesModified: false,
      m9b12aBytesModified: false,
      m9b12bBytesModified: false,
      m9b12cBytesModified: false,
      m9b12dBytesModified: false,
      scientificProtocolUnchanged: true,
      financialProtocolUnchanged: true,
      providerEffects: 0,
      networkEffects: 0,
      credentialEffects: 0,
    },
    decision: M9B12E_PREREGISTRATION_PROTOCOL.decision,
  });
  const preregistrationDigest = await digestBody(body);
  if (
    !preregistrationDigest.ok ||
    preregistrationDigest.value !== M9B12E_PREREGISTRATION_DIGEST
  )
    return preregistrationDigest.ok
      ? failure("M9b.12e preregistration digest changed.")
      : preregistrationDigest;
  return {
    ok: true,
    value: m9b12ePreregistrationSchema.parse({
      ...body,
      preregistrationDigest: preregistrationDigest.value,
    }),
  };
}

const tokenBrand: unique symbol = Symbol("M9b12ePreregistrationToken");
export type M9b12ePreregistrationToken = Readonly<{
  [tokenBrand]: "M9b12ePreregistrationToken";
}>;
const trustedPackages = new WeakMap<
  M9b12ePreregistrationToken,
  M9b12ePreregistration
>();

export async function prepareM9b12ePreregistration(): Promise<
  Result<
    Readonly<{
      token: M9b12ePreregistrationToken;
      preregistration: M9b12ePreregistration;
    }>,
    M9b12ePreregistrationFailure
  >
> {
  const preregistration = await deriveM9b12ePreregistration();
  if (!preregistration.ok) return preregistration;
  const token: M9b12ePreregistrationToken = Object.freeze({
    [tokenBrand]: "M9b12ePreregistrationToken",
  });
  trustedPackages.set(token, preregistration.value);
  return {
    ok: true,
    value: { token, preregistration: preregistration.value },
  };
}

export async function verifyM9b12ePreregistration(
  token: M9b12ePreregistrationToken,
  value: unknown,
): Promise<Result<M9b12ePreregistration, M9b12ePreregistrationFailure>> {
  const trusted = trustedPackages.get(token);
  const parsed = m9b12ePreregistrationSchema.safeParse(value);
  const rederived = await deriveM9b12ePreregistration();
  if (
    trusted === undefined ||
    !parsed.success ||
    !rederived.ok ||
    !canonicalEqual(trusted, parsed.data) ||
    !canonicalEqual(rederived.value, parsed.data)
  )
    return failure("M9b.12e preregistration package changed.");
  return { ok: true, value: parsed.data };
}

export async function verifyM9b12eScientificFinancialInvariance(
  predecessor: M9b12cPreregistration,
  corrected: M9b12ePreregistration,
): Promise<Result<true, M9b12ePreregistrationFailure>> {
  const digest = await digestBody(preservedStudyFields(predecessor));
  return digest.ok &&
    digest.value ===
      corrected.scientificFinancialInvariance.inheritedFieldsCanonicalDigest
    ? { ok: true, value: true }
    : failure("M9b.12e scientific or financial inheritance changed.");
}
