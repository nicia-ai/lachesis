import { canonicalizeJson, digestValue, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type M9b12Preregistration,
  m9b12PreregistrationSchema,
  prepareM9b12Preregistration,
  verifyM9b12Preregistration,
} from "./m9b12-preregistration.js";

export const M9B12A_PREREGISTRATION_PROTOCOL = Object.freeze({
  id: "lachesis-m9b12a-offline-preregistration-package",
  version: "1.0.0",
  baselineCommit: "b9f13c7b215624eb651caf3b038b77976247c9a3",
  visibility: "private-offline-preregistration-correction-only" as const,
  decision:
    "corrected-preregistration-package-ready-for-independent-review" as const,
  claimBoundary:
    "append-only retired-corpus quarantine correction only; no registration, corpus, gold, project, credential, provider, count, inference, campaign, publication, release, or push authority",
});

export const M9B12A_RETIRED_CORPUS_PROTOCOL = Object.freeze({
  id: "lachesis-m9b12a-retired-corpus-quarantine",
  version: "1.0.0",
  status: "prospective-policy-no-retired-material-accessed" as const,
});

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

const retiredMaterialClassSchema = z.enum([
  "corpus",
  "case-inventory",
  "packet-set",
  "topology",
  "hidden-reference-set",
  "constructor-output",
  "materialization",
  "derived-study-artifact",
]);

const retirementCauseSchema = z.enum([
  "used-by-earlier-study-attempt",
  "exposed-outside-authorized-role-boundary",
  "contaminated-or-potentially-contaminated",
  "quarantined",
  "superseded",
  "partially-constructed-under-failed-attempt",
  "accessed-by-excluded-identity",
  "derived-from-retired-material",
]);

const forbiddenAccessSchema = z.enum([
  "mount",
  "open-or-read",
  "list-or-enumerate",
  "search",
  "hash",
  "compare",
  "copy",
  "inspect-metadata-or-contents",
  "traverse-namespace",
  "import",
  "reconstruct",
  "derive-study-material",
  "receive-identifiers-or-structure",
  "freshness-comparison",
]);

const namespaceExposureSchema = z.enum([
  "mounted-read-only",
  "visible-permission-denied",
  "addressable",
  "enumerable",
  "search-root",
  "repository-history",
  "cache",
  "temporary-directory",
  "archive",
  "log",
  "shell-history",
  "environment-variable",
  "parent-workspace",
]);

const exposedValueSchema = z.enum([
  "snippet",
  "filename",
  "identifier",
  "ordering",
  "metadata",
  "content",
  "structural-summary",
  "counts-with-identity-mapping",
]);

const derivedOutputSchema = z.enum([
  "fixture",
  "template",
  "entity",
  "answer",
  "document",
  "supporting-fact",
  "schedule",
  "packet",
  "corpus",
  "seed",
  "randomization-decision",
  "constructor-output",
  "materializer-output",
  "derived-result",
]);

const studyRoleSchema = z.enum([
  "constructor",
  "materializer",
  "study-operator",
  "evaluator",
  "analyst",
  "auditor",
  "credential-custodian",
  "control-plane-bootstrap",
]);

const roleAwarenessSchema = z.enum([
  "no-retired-material-awareness",
  "opaque-commitments-only",
]);

const excludedInfluenceRoleSchema = z.enum([
  "constructor",
  "author",
  "evaluator",
  "adjudicator",
  "analyst",
  "campaign-control",
]);

const rolePolicySchema = z
  .strictObject({
    role: studyRoleSchema,
    permittedAwareness: roleAwarenessSchema,
    retiredNamespaceAccessible: z.literal(false),
    retiredPathsOrIdentitiesDisclosed: z.literal(false),
  })
  .readonly();

const frozenCountCommitmentSchema = z
  .strictObject({
    families: z.literal(8),
    scales: z.literal(3),
    cells: z.literal(24),
    probePairs: z.literal(24),
    primaryPairs: z.literal(168),
    totalPairs: z.literal(192),
  })
  .readonly();

const quarantineActionSchema = z.enum([
  "immediate-stop",
  "zero-provider-model-dispatch",
  "zero-new-credential-access",
  "quarantine-role-and-session",
  "quarantine-all-produced-and-derived-material",
  "permanently-prohibit-output-reuse",
  "exclude-observer-from-influential-study-roles",
  "append-only-incident-and-access-provenance",
  "independent-noninterference-assessment",
  "fresh-identities-environment-seed-and-construction-for-restart",
  "prohibit-manual-sanitization-or-harmless-exposure-override",
]);

const retiredCorpusPolicySchema = z
  .strictObject({
    protocol: z.literal(M9B12A_RETIRED_CORPUS_PROTOCOL.id),
    version: z.literal(M9B12A_RETIRED_CORPUS_PROTOCOL.version),
    status: z.literal(M9B12A_RETIRED_CORPUS_PROTOCOL.status),
    materialClasses: retiredMaterialClassSchema.array().length(8).readonly(),
    retirementCauses: retirementCauseSchema.array().length(8).readonly(),
    forbiddenAccess: forbiddenAccessSchema.array().length(14).readonly(),
    namespaceIsolation: z
      .strictObject({
        excludedBeforeRoleStart: z.literal(true),
        denylistInsideRoleSufficient: z.literal(false),
        namespaceExposuresProhibited: namespaceExposureSchema
          .array()
          .length(13)
          .readonly(),
        bootstrapMayDiscloseRetiredPathsOrIdentities: z.literal(false),
      })
      .readonly(),
    opaqueCommitments: z
      .strictObject({
        minimumOnly: z.literal(true),
        contentAddressed: z.literal(true),
        revealIdentitiesOrStructure: z.literal(false),
        approvedPublicCounts: frozenCountCommitmentSchema,
        countsWithIdentityOrderOrStructurePermitted: z.literal(false),
      })
      .readonly(),
    failClosed: z
      .strictObject({
        suspectedOrConfirmedAccessTriggers: z.literal(true),
        missingObserverIdentityForbidsReuse: z.literal(true),
        incompleteExposureInventoryForbidsReuse: z.literal(true),
        unknownNoninterferenceForbidsReuse: z.literal(true),
        manualCleanupPermitted: z.literal(false),
        selectiveDeletionPermitted: z.literal(false),
        renameAndReusePermitted: z.literal(false),
        observerExcludedFromLaterRoles: excludedInfluenceRoleSchema
          .array()
          .length(6)
          .readonly(),
        actions: quarantineActionSchema.array().length(11).readonly(),
      })
      .readonly(),
    derivedInventory: z
      .strictObject({
        anyRetiredAncestorOrInfluenceContaminates: z.literal(true),
        ancestorKinds: derivedOutputSchema.array().length(14).readonly(),
        publicCountsOnlyEqualityPermitted: z.literal(true),
        identityOrderContentOrStructuralMappingPermitted: z.literal(false),
      })
      .readonly(),
    roles: rolePolicySchema.array().length(8).readonly(),
    contentObserverMayLaterInfluenceStudy: z.literal(false),
    incidentMustPrecedeProviderEffects: z.literal(true),
    restartMustUseFreshRoleEnvironmentSeedAndCorpus: z.literal(true),
    liveAuthorityGranted: z.literal(false),
  })
  .readonly();

export type M9b12aRetiredCorpusPolicy = z.infer<
  typeof retiredCorpusPolicySchema
>;

const originalShape = m9b12PreregistrationSchema.unwrap().shape;
const correctedCorpusConstructionSchema = originalShape.corpusConstruction
  .unwrap()
  .safeExtend({
    retiredCorpusPolicy: z.literal(M9B12A_RETIRED_CORPUS_PROTOCOL.id),
    retiredMaterialAccessProhibited: z.literal(true),
    isolationBeforeRoleStartRequired: z.literal(true),
    inRoleDenylistSufficient: z.literal(false),
    retiredAccessBehavior: z.literal(
      "fail-closed-quarantine-all-role-session-and-derived-material",
    ),
  })
  .readonly();

const preservedM9b12FieldsSchema = m9b12PreregistrationSchema.unwrap().omit({
  protocol: true,
  version: true,
  baselineCommit: true,
  status: true,
  corpusConstruction: true,
  futureAuthorizations: true,
  preregistrationDigest: true,
  decision: true,
});

const supersessionSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b12a-append-only-supersession/1"),
    supersedesProtocol: z.literal(
      "lachesis-m9b12-offline-preregistration-package@1.0.0",
    ),
    supersedesCommit: z.literal("b9f13c7b215624eb651caf3b038b77976247c9a3"),
    supersedesTree: z.literal("30144b30de282d63371f9afedeb7d5ac43cfa739"),
    supersedesDigest: z.literal(
      "f12c1212c4fbaa57190059f4d29ef413d09f9d006489b7b95ae038e426a74ff5",
    ),
    originalStatus: z.literal(
      "superseded-unregistered-retired-corpus-policy-incomplete",
    ),
    originalExternallyRegistered: z.literal(false),
    reviewDecision: z.literal(
      "independent-preregistration-review-pass-with-narrow-corrections",
    ),
    finding: z.literal(
      "retired-or-previously-contaminated-corpus-access-was-not-an-explicit-quarantine-event",
    ),
    correctionScope: z.literal("retired-corpus-quarantine-policy-only"),
    originalBytesModified: z.literal(false),
    reinterpretOriginalArtifacts: z.literal(false),
  })
  .readonly();

const correctionAuditSchema = z
  .strictObject({
    originalPackageByteIdentityRequired: z.literal(true),
    originalChecksumManifestStillValid: z.literal(true),
    scientificTopologyUnchanged: z.literal(true),
    populationUnchanged: z.literal(true),
    endpointUnchanged: z.literal(true),
    analysisUnchanged: z.literal(true),
    modelAndEnvelopeUnchanged: z.literal(true),
    financialTotalsUnchanged: z.literal(true),
    operationalSequenceUnchanged: z.literal(true),
    authorizationBoundariesUnchanged: z.literal(true),
    retiredIdentityOrContentDisclosed: z.literal(false),
    retiredMaterialAccessed: z.literal(false),
    providerEffects: z.literal(0),
    countEffects: z.literal(0),
    inferenceEffects: z.literal(0),
    networkEffects: z.literal(0),
  })
  .readonly();

const m9b12aBodySchema = preservedM9b12FieldsSchema
  .safeExtend({
    protocol: z.literal(M9B12A_PREREGISTRATION_PROTOCOL.id),
    version: z.literal(M9B12A_PREREGISTRATION_PROTOCOL.version),
    baselineCommit: z.literal(M9B12A_PREREGISTRATION_PROTOCOL.baselineCommit),
    status: z.literal(
      "offline-immutable-superseding-draft-not-externally-registered",
    ),
    supersession: supersessionSchema,
    corpusConstruction: correctedCorpusConstructionSchema,
    retiredCorpusPolicy: retiredCorpusPolicySchema,
    futureAuthorizations: originalShape.futureAuthorizations,
    correctionAudit: correctionAuditSchema,
    decision: z.literal(M9B12A_PREREGISTRATION_PROTOCOL.decision),
  })
  .readonly();

export const m9b12aPreregistrationSchema = m9b12aBodySchema
  .unwrap()
  .safeExtend({ preregistrationDigest: digestSchema })
  .readonly();
export type M9b12aPreregistration = z.infer<typeof m9b12aPreregistrationSchema>;

type M9b12aFailure = Readonly<{
  kind: "validation" | "integrity";
  message: string;
}>;

function failure(
  kind: M9b12aFailure["kind"],
  message: string,
): Result<never, M9b12aFailure> {
  return { ok: false, error: { kind, message } };
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalizeJson(left);
  const rightBytes = canonicalizeJson(right);
  return leftBytes.ok && rightBytes.ok && leftBytes.value === rightBytes.value;
}

async function digestBody(
  value: unknown,
): Promise<Result<string, M9b12aFailure>> {
  const digest = await digestValue(value);
  return digest.ok
    ? { ok: true, value: digest.value }
    : failure("integrity", "M9b.12a canonical digest failed.");
}

function retiredCorpusPolicy(): M9b12aRetiredCorpusPolicy {
  return retiredCorpusPolicySchema.parse({
    protocol: M9B12A_RETIRED_CORPUS_PROTOCOL.id,
    version: M9B12A_RETIRED_CORPUS_PROTOCOL.version,
    status: M9B12A_RETIRED_CORPUS_PROTOCOL.status,
    materialClasses: retiredMaterialClassSchema.options,
    retirementCauses: retirementCauseSchema.options,
    forbiddenAccess: forbiddenAccessSchema.options,
    namespaceIsolation: {
      excludedBeforeRoleStart: true,
      denylistInsideRoleSufficient: false,
      namespaceExposuresProhibited: namespaceExposureSchema.options,
      bootstrapMayDiscloseRetiredPathsOrIdentities: false,
    },
    opaqueCommitments: {
      minimumOnly: true,
      contentAddressed: true,
      revealIdentitiesOrStructure: false,
      approvedPublicCounts: {
        families: 8,
        scales: 3,
        cells: 24,
        probePairs: 24,
        primaryPairs: 168,
        totalPairs: 192,
      },
      countsWithIdentityOrderOrStructurePermitted: false,
    },
    failClosed: {
      suspectedOrConfirmedAccessTriggers: true,
      missingObserverIdentityForbidsReuse: true,
      incompleteExposureInventoryForbidsReuse: true,
      unknownNoninterferenceForbidsReuse: true,
      manualCleanupPermitted: false,
      selectiveDeletionPermitted: false,
      renameAndReusePermitted: false,
      observerExcludedFromLaterRoles: excludedInfluenceRoleSchema.options,
      actions: quarantineActionSchema.options,
    },
    derivedInventory: {
      anyRetiredAncestorOrInfluenceContaminates: true,
      ancestorKinds: derivedOutputSchema.options,
      publicCountsOnlyEqualityPermitted: true,
      identityOrderContentOrStructuralMappingPermitted: false,
    },
    roles: [
      "constructor",
      "materializer",
      "study-operator",
      "evaluator",
      "analyst",
      "credential-custodian",
    ]
      .map((role) => ({
        role,
        permittedAwareness: "no-retired-material-awareness",
        retiredNamespaceAccessible: false,
        retiredPathsOrIdentitiesDisclosed: false,
      }))
      .concat(
        ["auditor", "control-plane-bootstrap"].map((role) => ({
          role,
          permittedAwareness: "opaque-commitments-only",
          retiredNamespaceAccessible: false,
          retiredPathsOrIdentitiesDisclosed: false,
        })),
      ),
    contentObserverMayLaterInfluenceStudy: false,
    incidentMustPrecedeProviderEffects: true,
    restartMustUseFreshRoleEnvironmentSeedAndCorpus: true,
    liveAuthorityGranted: false,
  });
}

function correctedFutureAuthorizations(): M9b12Preregistration["futureAuthorizations"] {
  return originalShape.futureAuthorizations.parse({
    issued: false,
    texts: [
      {
        kind: "external-preregistration",
        text: "Authorize submission of the exact checksum-bound M9b.12a preregistration package to the named external registry and no other action.",
        prerequisites:
          "Independent review accepts the corrected package digest, supersession lineage, and exact artifact checksum manifest.",
        grantsOnly:
          "One append-only external registration submission; no corpus, project, credential, count, inference, or campaign action.",
      },
      {
        kind: "corpus-materialization",
        text: "Authorize isolated construction and materialization under the registered corpus and retired-material protocols only.",
        prerequisites:
          "External registration is independently verified, retired namespaces are excluded, and role isolation is active.",
        grantsOnly:
          "Fresh corpus, gold, and split-audit production; no provider, credential, count, inference, probe, or primary execution.",
      },
      {
        kind: "provider-cap-and-credential-activation",
        text: "Authorize activation of one fresh zero-spend dedicated project, verified 500 USD cap, and project-scoped credential custody.",
        prerequisites:
          "Corpus, retired-material, evaluator, schedule, environment, security, and disclosure reviews pass with immutable identities.",
        grantsOnly:
          "Cap and credential activation plus preflight; no count or inference dispatch.",
      },
      {
        kind: "count-only-pricing-probe",
        text: "Authorize the frozen four-request maximum count-only operational pricing probe.",
        prerequisites:
          "Cap, credential, zero-spend, accounting, persistence, retired-material, and response-shape preflights pass.",
        grantsOnly:
          "At most one count request per frozen class, zero inference, zero retries, concurrency one.",
      },
      {
        kind: "twenty-four-pair-protocol-probe",
        text: "Authorize execution of the exact frozen 24-pair protocol-probe inventory and schedule.",
        prerequisites:
          "Count-only reconciliation and retired-material noninterference pass every frozen gate and a separate review accepts the bound probe inventory.",
        grantsOnly:
          "The complete 24-pair probe; no primary execution or population change.",
      },
      {
        kind: "conditional-168-pair-primary-execution",
        text: "Authorize the exact frozen 168-pair primary inventory and schedule only if the registered probe gate passed.",
        prerequisites:
          "Verified complete probe measurements pass and all safety, retired-material, accounting, pricing, replay, authorization, and capacity gates remain satisfied.",
        grantsOnly:
          "The complete immutable 168-pair primary study; no subset, replacement, retry, or protocol amendment.",
      },
      {
        kind: "final-closure-and-credential-revocation",
        text: "Authorize final replay, analysis, accounting and security closure, credential revocation, and independent absence verification.",
        prerequisites:
          "All authorized study effects and retired-material incidents are terminally accounted and no further provider dispatch is permitted.",
        grantsOnly:
          "Closure and revocation actions; no new count, inference, corpus, analysis-population, publication, or quarantine-override authority.",
      },
    ],
  });
}

function withoutReplacedFields(
  original: M9b12Preregistration,
): z.infer<typeof preservedM9b12FieldsSchema> {
  const {
    protocol: ignoredProtocol,
    version: ignoredVersion,
    baselineCommit: ignoredBaseline,
    status: ignoredStatus,
    corpusConstruction: ignoredCorpusConstruction,
    futureAuthorizations: ignoredFutureAuthorizations,
    preregistrationDigest: ignoredDigest,
    decision: ignoredDecision,
    ...preserved
  } = original;
  void ignoredProtocol;
  void ignoredVersion;
  void ignoredBaseline;
  void ignoredStatus;
  void ignoredCorpusConstruction;
  void ignoredFutureAuthorizations;
  void ignoredDigest;
  void ignoredDecision;
  return preservedM9b12FieldsSchema.parse(preserved);
}

async function deriveM9b12aPreregistration(): Promise<
  Result<M9b12aPreregistration, M9b12aFailure>
> {
  const original = await prepareM9b12Preregistration();
  if (!original.ok)
    return failure("integrity", "Original M9b.12 package could not rederive.");
  const verifiedOriginal = await verifyM9b12Preregistration(
    original.value.token,
    original.value.preregistration,
  );
  if (
    !verifiedOriginal.ok ||
    verifiedOriginal.value.preregistrationDigest !==
      "f12c1212c4fbaa57190059f4d29ef413d09f9d006489b7b95ae038e426a74ff5"
  )
    return failure("integrity", "Original M9b.12 identity changed.");
  const body = m9b12aBodySchema.parse({
    ...withoutReplacedFields(verifiedOriginal.value),
    protocol: M9B12A_PREREGISTRATION_PROTOCOL.id,
    version: M9B12A_PREREGISTRATION_PROTOCOL.version,
    baselineCommit: M9B12A_PREREGISTRATION_PROTOCOL.baselineCommit,
    status: "offline-immutable-superseding-draft-not-externally-registered",
    supersession: {
      protocol: "lachesis-m9b12a-append-only-supersession/1",
      supersedesProtocol:
        "lachesis-m9b12-offline-preregistration-package@1.0.0",
      supersedesCommit: "b9f13c7b215624eb651caf3b038b77976247c9a3",
      supersedesTree: "30144b30de282d63371f9afedeb7d5ac43cfa739",
      supersedesDigest:
        "f12c1212c4fbaa57190059f4d29ef413d09f9d006489b7b95ae038e426a74ff5",
      originalStatus:
        "superseded-unregistered-retired-corpus-policy-incomplete",
      originalExternallyRegistered: false,
      reviewDecision:
        "independent-preregistration-review-pass-with-narrow-corrections",
      finding:
        "retired-or-previously-contaminated-corpus-access-was-not-an-explicit-quarantine-event",
      correctionScope: "retired-corpus-quarantine-policy-only",
      originalBytesModified: false,
      reinterpretOriginalArtifacts: false,
    },
    corpusConstruction: {
      ...verifiedOriginal.value.corpusConstruction,
      retiredCorpusPolicy: M9B12A_RETIRED_CORPUS_PROTOCOL.id,
      retiredMaterialAccessProhibited: true,
      isolationBeforeRoleStartRequired: true,
      inRoleDenylistSufficient: false,
      retiredAccessBehavior:
        "fail-closed-quarantine-all-role-session-and-derived-material",
    },
    retiredCorpusPolicy: retiredCorpusPolicy(),
    futureAuthorizations: correctedFutureAuthorizations(),
    correctionAudit: {
      originalPackageByteIdentityRequired: true,
      originalChecksumManifestStillValid: true,
      scientificTopologyUnchanged: true,
      populationUnchanged: true,
      endpointUnchanged: true,
      analysisUnchanged: true,
      modelAndEnvelopeUnchanged: true,
      financialTotalsUnchanged: true,
      operationalSequenceUnchanged: true,
      authorizationBoundariesUnchanged: true,
      retiredIdentityOrContentDisclosed: false,
      retiredMaterialAccessed: false,
      providerEffects: 0,
      countEffects: 0,
      inferenceEffects: 0,
      networkEffects: 0,
    },
    decision: M9B12A_PREREGISTRATION_PROTOCOL.decision,
  });
  const preregistrationDigest = await digestBody(body);
  return preregistrationDigest.ok
    ? {
        ok: true,
        value: m9b12aPreregistrationSchema.parse({
          ...body,
          preregistrationDigest: preregistrationDigest.value,
        }),
      }
    : preregistrationDigest;
}

const packageTokenBrand: unique symbol = Symbol("M9b12aPreregistrationToken");
export type M9b12aPreregistrationToken = Readonly<{
  [packageTokenBrand]: "M9b12aPreregistrationToken";
}>;
const trustedPackages = new WeakMap<
  M9b12aPreregistrationToken,
  M9b12aPreregistration
>();

export async function prepareM9b12aPreregistration(): Promise<
  Result<
    Readonly<{
      token: M9b12aPreregistrationToken;
      preregistration: M9b12aPreregistration;
    }>,
    M9b12aFailure
  >
> {
  const preregistration = await deriveM9b12aPreregistration();
  if (!preregistration.ok) return preregistration;
  const token: M9b12aPreregistrationToken = Object.freeze({
    [packageTokenBrand]: "M9b12aPreregistrationToken",
  });
  trustedPackages.set(token, preregistration.value);
  return {
    ok: true,
    value: { token, preregistration: preregistration.value },
  };
}

export async function verifyM9b12aPreregistration(
  token: M9b12aPreregistrationToken,
  value: unknown,
): Promise<Result<M9b12aPreregistration, M9b12aFailure>> {
  const trusted = trustedPackages.get(token);
  const parsed = m9b12aPreregistrationSchema.safeParse(value);
  const rederived = await deriveM9b12aPreregistration();
  if (
    trusted === undefined ||
    !parsed.success ||
    !rederived.ok ||
    !canonicalEqual(trusted, parsed.data) ||
    !canonicalEqual(rederived.value, parsed.data)
  )
    return failure("integrity", "M9b.12a preregistration package changed.");
  return { ok: true, value: parsed.data };
}

const retiredBoundaryAttemptSchema = z
  .strictObject({
    role: studyRoleSchema,
    retiredMaterialStatus: z.enum(["none", "suspected", "confirmed"]),
    namespaceExposures: namespaceExposureSchema.array().readonly(),
    accessOperations: forbiddenAccessSchema.array().readonly(),
    exposedValues: exposedValueSchema.array().readonly(),
    frozenCountsCommitment: z
      .strictObject({
        approvedByTrustedBoundary: z.boolean(),
        values: z
          .strictObject({
            families: z.number().int().nonnegative(),
            scales: z.number().int().nonnegative(),
            cells: z.number().int().nonnegative(),
            probePairs: z.number().int().nonnegative(),
            primaryPairs: z.number().int().nonnegative(),
            totalPairs: z.number().int().nonnegative(),
          })
          .readonly(),
      })
      .readonly()
      .nullable(),
    derivedOutputs: derivedOutputSchema.array().readonly(),
    observerIdentityKnown: z.boolean(),
    exposureInventoryComplete: z.boolean(),
    manualCleanupAttempted: z.boolean(),
    restart: z
      .strictObject({
        attempted: z.boolean(),
        freshRoleIdentity: z.boolean(),
        freshEnvironment: z.boolean(),
        freshSeed: z.boolean(),
        freshCorpusConstruction: z.boolean(),
        reusedPacketIdentity: z.boolean(),
        reusedDerivedTemplate: z.boolean(),
      })
      .readonly(),
    providerEffectAttempted: z.boolean(),
    independentAssessment: z.enum([
      "not-required",
      "noninterference-confirmed",
      "noninterference-unknown",
    ]),
  })
  .readonly();
export type M9b12aRetiredBoundaryAttempt = z.infer<
  typeof retiredBoundaryAttemptSchema
>;

const quarantineReasonSchema = z.enum([
  "retired-material-suspected-or-confirmed",
  "retired-namespace-accessible",
  "forbidden-access-operation",
  "retired-value-or-structure-exposed",
  "count-commitment-not-minimum-approved-public-counts",
  "observer-identity-missing",
  "exposure-inventory-incomplete",
  "manual-cleanup-or-reuse-attempt",
  "restart-not-fully-fresh",
  "provider-effect-attempt-after-contamination",
  "noninterference-unknown",
]);

const retiredBoundaryReceiptBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b12a-retired-boundary-receipt/1"),
    policyProtocol: z.literal(M9B12A_RETIRED_CORPUS_PROTOCOL.id),
    decision: z.enum([
      "allow-role-start",
      "allow-minimum-opaque-count-commitment",
      "quarantine-reuse-forbidden",
    ]),
    reasons: quarantineReasonSchema.array().readonly(),
    reuseForbidden: z.boolean(),
    roleSessionQuarantined: z.boolean(),
    allProducedAndDerivedMaterialQuarantined: z.boolean(),
    observerExcludedFromInfluentialRoles: z.boolean(),
    freshRestartRequired: z.boolean(),
    requiredActions: quarantineActionSchema.array().readonly(),
    providerDispatchPermittedByReceipt: z.literal(false),
    credentialAccessPermittedByReceipt: z.literal(false),
    effects: z
      .strictObject({
        providerDispatches: z.literal(0),
        credentialAccesses: z.literal(0),
        filesystemAccesses: z.literal(0),
        networkAccesses: z.literal(0),
      })
      .readonly(),
  })
  .readonly();

export const m9b12aRetiredBoundaryReceiptSchema =
  retiredBoundaryReceiptBodySchema
    .unwrap()
    .safeExtend({ receiptDigest: digestSchema })
    .readonly();
export type M9b12aRetiredBoundaryReceipt = z.infer<
  typeof m9b12aRetiredBoundaryReceiptSchema
>;

function exactFrozenCounts(
  value: M9b12aRetiredBoundaryAttempt["frozenCountsCommitment"],
): boolean {
  return (
    value !== null &&
    value.approvedByTrustedBoundary &&
    value.values.families === 8 &&
    value.values.scales === 3 &&
    value.values.cells === 24 &&
    value.values.probePairs === 24 &&
    value.values.primaryPairs === 168 &&
    value.values.totalPairs === 192
  );
}

export async function assessM9b12aRetiredMaterialBoundary(
  value: unknown,
): Promise<Result<M9b12aRetiredBoundaryReceipt, M9b12aFailure>> {
  const parsed = retiredBoundaryAttemptSchema.safeParse(value);
  if (!parsed.success)
    return failure("validation", "Retired-material attempt schema rejected.");
  const input = parsed.data;
  const reasons = new Set<z.infer<typeof quarantineReasonSchema>>();
  const countCommitmentValid =
    input.frozenCountsCommitment === null ||
    exactFrozenCounts(input.frozenCountsCommitment);
  const directExposure =
    input.retiredMaterialStatus !== "none" ||
    input.namespaceExposures.length > 0 ||
    input.accessOperations.length > 0 ||
    input.exposedValues.length > 0 ||
    !countCommitmentValid;
  if (input.retiredMaterialStatus !== "none")
    reasons.add("retired-material-suspected-or-confirmed");
  if (input.namespaceExposures.length > 0)
    reasons.add("retired-namespace-accessible");
  if (input.accessOperations.length > 0)
    reasons.add("forbidden-access-operation");
  if (input.exposedValues.length > 0)
    reasons.add("retired-value-or-structure-exposed");
  if (!countCommitmentValid)
    reasons.add("count-commitment-not-minimum-approved-public-counts");
  if (directExposure && !input.observerIdentityKnown)
    reasons.add("observer-identity-missing");
  if (directExposure && !input.exposureInventoryComplete)
    reasons.add("exposure-inventory-incomplete");
  if (
    input.manualCleanupAttempted ||
    input.restart.reusedPacketIdentity ||
    input.restart.reusedDerivedTemplate
  )
    reasons.add("manual-cleanup-or-reuse-attempt");
  if (
    input.restart.attempted &&
    (!input.restart.freshRoleIdentity ||
      !input.restart.freshEnvironment ||
      !input.restart.freshSeed ||
      !input.restart.freshCorpusConstruction)
  )
    reasons.add("restart-not-fully-fresh");
  if (directExposure && input.providerEffectAttempted)
    reasons.add("provider-effect-attempt-after-contamination");
  if (
    directExposure &&
    input.independentAssessment === "noninterference-unknown"
  )
    reasons.add("noninterference-unknown");
  const quarantine = reasons.size > 0;
  const body = retiredBoundaryReceiptBodySchema.parse({
    protocol: "lachesis-m9b12a-retired-boundary-receipt/1",
    policyProtocol: M9B12A_RETIRED_CORPUS_PROTOCOL.id,
    decision: quarantine
      ? "quarantine-reuse-forbidden"
      : input.frozenCountsCommitment === null
        ? "allow-role-start"
        : "allow-minimum-opaque-count-commitment",
    reasons: [...reasons].toSorted(),
    reuseForbidden: quarantine,
    roleSessionQuarantined: quarantine,
    allProducedAndDerivedMaterialQuarantined: quarantine,
    observerExcludedFromInfluentialRoles: quarantine,
    freshRestartRequired: quarantine,
    requiredActions: quarantine ? quarantineActionSchema.options : [],
    providerDispatchPermittedByReceipt: false,
    credentialAccessPermittedByReceipt: false,
    effects: {
      providerDispatches: 0,
      credentialAccesses: 0,
      filesystemAccesses: 0,
      networkAccesses: 0,
    },
  });
  const receiptDigest = await digestBody(body);
  return receiptDigest.ok
    ? {
        ok: true,
        value: m9b12aRetiredBoundaryReceiptSchema.parse({
          ...body,
          receiptDigest: receiptDigest.value,
        }),
      }
    : receiptDigest;
}
