import { canonicalizeJson, digestValue, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  type M9b12aPreregistration,
  m9b12aPreregistrationSchema,
  prepareM9b12aPreregistration,
  verifyM9b12aPreregistration,
} from "./m9b12a-preregistration.js";

export const M9B12B_PREREGISTRATION_PROTOCOL = Object.freeze({
  id: "lachesis-m9b12b-offline-preregistration-package",
  version: "1.0.0",
  baselineCommit: "d8cadc384ec99df8c2c938c9dda2992be15f8272",
  baselineTree: "8babde6e603705f2c672afc260157c6fdd02bc88",
  visibility: "private-offline-preregistration-correction-only" as const,
  decision: "m9b12b-corrected-package-ready-for-independent-review" as const,
});

export const M9B12B_RETIRED_CORPUS_PROTOCOL = Object.freeze({
  id: "lachesis-m9b12b-retired-corpus-quarantine",
  version: "1.0.0",
  status:
    "prospective-deny-by-default-policy-no-retired-material-accessed" as const,
});

export const M9B12B_EXTERNAL_REGISTRATION_PROTOCOL =
  "lachesis-m9b12b-append-only-external-registration/1" as const;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const recordedUnknownValueSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._:/-]*$/u);

export const m9b12bInfluenceBearingRoleSchema = z.enum([
  "constructor",
  "materializer",
  "study-operator",
  "author",
  "evaluator",
  "adjudicator",
  "analyst",
  "auditor",
  "campaign-controller",
  "runtime-controller",
  "control-plane-bootstrap",
  "credential-custodian",
]);
export type M9b12bInfluenceBearingRole = z.infer<
  typeof m9b12bInfluenceBearingRoleSchema
>;
export const M9B12B_INFLUENCE_BEARING_ROLES = Object.freeze(
  m9b12bInfluenceBearingRoleSchema.options,
);

export const m9b12bIsolationChannelSchema = z.enum([
  "direct-mount",
  "parent-filesystem",
  "parent-workspace",
  "worktree",
  "repository-history",
  "archive",
  "backup-or-snapshot",
  "cache",
  "temporary-storage",
  "log",
  "shell-history",
  "environment-variable",
  "search-root",
  "bootstrap-input",
  "inherited-process-input",
  "external-or-object-storage",
]);
export type M9b12bIsolationChannel = z.infer<
  typeof m9b12bIsolationChannelSchema
>;
export const M9B12B_ISOLATION_CHANNELS = Object.freeze(
  m9b12bIsolationChannelSchema.options,
);

export const m9b12bContaminationAncestorSchema = z.enum([
  "corpus",
  "case",
  "seed",
  "template",
  "family",
  "task",
  "source",
  "document",
  "entity",
  "answer",
  "supporting-fact",
  "constructor-output",
  "schedule",
  "randomization",
  "packet",
  "materialization",
  "evaluator-input",
  "analysis-input",
]);
export type M9b12bContaminationAncestor = z.infer<
  typeof m9b12bContaminationAncestorSchema
>;
export const M9B12B_CONTAMINATION_ANCESTORS = Object.freeze(
  m9b12bContaminationAncestorSchema.options,
);

export const m9b12bForbiddenAccessSchema = z.enum([
  "mount",
  "open",
  "read",
  "list",
  "enumerate",
  "search",
  "hash",
  "compare",
  "copy",
  "inspect-metadata",
  "inspect-content",
  "traverse-namespace",
  "import",
  "reconstruct",
  "receive-identifier",
  "receive-filename",
  "receive-snippet",
  "receive-ordering",
  "receive-structural-mapping",
  "derive-study-material",
]);
export type M9b12bForbiddenAccess = z.infer<typeof m9b12bForbiddenAccessSchema>;
export const M9B12B_FORBIDDEN_ACCESS_CLASSES = Object.freeze(
  m9b12bForbiddenAccessSchema.options,
);

const publicCountCommitmentSchema = z
  .strictObject({
    approvedByTrustedBoundary: z.boolean(),
    revealsIdentityOrderContentOrMapping: z.boolean(),
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
  .readonly();

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
    independentReviewDecision: z.literal(
      "independent-preregistration-review-pass-with-narrow-corrections",
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
    commit: z.literal(M9B12B_PREREGISTRATION_PROTOCOL.baselineCommit),
    tree: z.literal(M9B12B_PREREGISTRATION_PROTOCOL.baselineTree),
    preregistrationDigest: z.literal(
      "79db2718c94a938431544f8bc72f793c478ed85bff56a2071c3bd03d999c2831",
    ),
    checksumManifestDigest: z.literal(
      "fb98320423322624a42eea328a71d90199b1208b5e5094a999876eca14775298",
    ),
    independentReviewDecision: z.literal("m9b12a-independent-review-no-go"),
    status: z.literal(
      "superseded-unregistered-retired-corpus-enforcement-incomplete",
    ),
  })
  .readonly();

export const m9b12bExternalRegistrationFormatSchema = z
  .strictObject({
    protocol: z.literal(M9B12B_EXTERNAL_REGISTRATION_PROTOCOL),
    status: z.literal("format-only-no-record-present"),
    requiredFields: z
      .tuple([
        z.literal("registration-service"),
        z.literal("registration-record-id"),
        z.literal("server-registered-at"),
        z.literal("corrected-preregistration-digest"),
        z.literal("superseded-m9b12a-preregistration-digest"),
        z.literal("superseded-m9b12-preregistration-digest"),
        z.literal("source-commit"),
        z.literal("source-tree"),
        z.literal("checksum-manifest-digest"),
        z.literal("submitted-attachment-inventory-and-sha256"),
        z.literal("registrant-attestation"),
      ])
      .readonly(),
    supersessionLineage: z
      .tuple([m9b12LineageSchema, m9b12aLineageSchema])
      .readonly(),
    sourceBinding: z
      .strictObject({
        baselineCommit: z.literal(
          M9B12B_PREREGISTRATION_PROTOCOL.baselineCommit,
        ),
        baselineTree: z.literal(M9B12B_PREREGISTRATION_PROTOCOL.baselineTree),
        sourceCommit: z.null(),
        sourceTree: z.null(),
        procedure: z.literal(
          "external-record-binds-reviewed-source-commit-and-tree-after-independent-review",
        ),
      })
      .readonly(),
    correctedPreregistrationDigestRule: z.literal(
      "registration-value-must-equal-canonical-submitted-m9b12b-preregistration-digest",
    ),
    checksumManifestDigestRule: z.literal(
      "registration-value-must-equal-sha256-of-submitted-checksum-manifest",
    ),
    attachmentInventoryRule: z.literal(
      "registration-value-must-list-every-submitted-relative-path-and-sha256-in-manifest-order",
    ),
    amendmentRule: z.literal(
      "append-only-new-identity-no-reinterpretation-of-any-lineage-artifact",
    ),
    registrationRecord: z.null(),
    submissionAuthorized: z.literal(false),
  })
  .readonly();
export type M9b12bExternalRegistrationFormat = z.infer<
  typeof m9b12bExternalRegistrationFormatSchema
>;

const M9B12_LINEAGE = Object.freeze({
  protocol: "lachesis-m9b12-offline-preregistration-package@1.0.0",
  commit: "b9f13c7b215624eb651caf3b038b77976247c9a3",
  tree: "30144b30de282d63371f9afedeb7d5ac43cfa739",
  preregistrationDigest:
    "f12c1212c4fbaa57190059f4d29ef413d09f9d006489b7b95ae038e426a74ff5",
  checksumManifestDigest:
    "437c7b26238d1f758efcb4ed753662d6da197526b2f1a707b0f0961de5cbd83c",
  independentReviewDecision:
    "independent-preregistration-review-pass-with-narrow-corrections",
  status: "superseded-unregistered-retired-corpus-policy-incomplete",
});

const M9B12A_LINEAGE = Object.freeze({
  protocol: "lachesis-m9b12a-offline-preregistration-package@1.0.0",
  commit: M9B12B_PREREGISTRATION_PROTOCOL.baselineCommit,
  tree: M9B12B_PREREGISTRATION_PROTOCOL.baselineTree,
  preregistrationDigest:
    "79db2718c94a938431544f8bc72f793c478ed85bff56a2071c3bd03d999c2831",
  checksumManifestDigest:
    "fb98320423322624a42eea328a71d90199b1208b5e5094a999876eca14775298",
  independentReviewDecision: "m9b12a-independent-review-no-go",
  status: "superseded-unregistered-retired-corpus-enforcement-incomplete",
});

export function createM9b12bExternalRegistrationFormat(): M9b12bExternalRegistrationFormat {
  return m9b12bExternalRegistrationFormatSchema.parse({
    protocol: M9B12B_EXTERNAL_REGISTRATION_PROTOCOL,
    status: "format-only-no-record-present",
    requiredFields: [
      "registration-service",
      "registration-record-id",
      "server-registered-at",
      "corrected-preregistration-digest",
      "superseded-m9b12a-preregistration-digest",
      "superseded-m9b12-preregistration-digest",
      "source-commit",
      "source-tree",
      "checksum-manifest-digest",
      "submitted-attachment-inventory-and-sha256",
      "registrant-attestation",
    ],
    supersessionLineage: [M9B12_LINEAGE, M9B12A_LINEAGE],
    sourceBinding: {
      baselineCommit: M9B12B_PREREGISTRATION_PROTOCOL.baselineCommit,
      baselineTree: M9B12B_PREREGISTRATION_PROTOCOL.baselineTree,
      sourceCommit: null,
      sourceTree: null,
      procedure:
        "external-record-binds-reviewed-source-commit-and-tree-after-independent-review",
    },
    correctedPreregistrationDigestRule:
      "registration-value-must-equal-canonical-submitted-m9b12b-preregistration-digest",
    checksumManifestDigestRule:
      "registration-value-must-equal-sha256-of-submitted-checksum-manifest",
    attachmentInventoryRule:
      "registration-value-must-list-every-submitted-relative-path-and-sha256-in-manifest-order",
    amendmentRule:
      "append-only-new-identity-no-reinterpretation-of-any-lineage-artifact",
    registrationRecord: null,
    submissionAuthorized: false,
  });
}

const originalShape = m9b12aPreregistrationSchema.unwrap().shape;
const preservedM9b12aFieldsSchema = m9b12aPreregistrationSchema.unwrap().omit({
  protocol: true,
  version: true,
  baselineCommit: true,
  status: true,
  supersession: true,
  corpusConstruction: true,
  retiredCorpusPolicy: true,
  futureAuthorizations: true,
  externalRegistrationFormat: true,
  correctionAudit: true,
  decision: true,
  preregistrationDigest: true,
});

const supersessionSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b12b-linear-supersession/1"),
    ordering: z
      .tuple([
        z.literal("lachesis-m9b12-offline-preregistration-package@1.0.0"),
        z.literal("lachesis-m9b12a-offline-preregistration-package@1.0.0"),
        z.literal("lachesis-m9b12b-offline-preregistration-package@1.0.0"),
      ])
      .readonly(),
    predecessors: z.tuple([m9b12LineageSchema, m9b12aLineageSchema]).readonly(),
    predecessorBytesModified: z.literal(false),
    predecessorExternallyRegistered: z.literal(false),
    correctionScope: z.literal(
      "retired-corpus-enforcement-roles-isolation-ancestry-supersession-registration-and-tests-only",
    ),
  })
  .readonly();

const rolePolicySchema = z
  .strictObject({
    role: m9b12bInfluenceBearingRoleSchema,
    influenceBearing: z.literal(true),
    retiredNamespaceAccessible: z.literal(false),
    retiredPathsIdentitiesOrStructureDisclosed: z.literal(false),
    excludedAfterRetiredExposure: z.literal(true),
  })
  .readonly();

const retiredCorpusPolicySchema = z
  .strictObject({
    protocol: z.literal(M9B12B_RETIRED_CORPUS_PROTOCOL.id),
    version: z.literal(M9B12B_RETIRED_CORPUS_PROTOCOL.version),
    status: z.literal(M9B12B_RETIRED_CORPUS_PROTOCOL.status),
    decisionRule: z.literal(
      "allow-only-when-every-required-proof-is-complete-affirmative-and-no-rejection-reason-exists",
    ),
    roles: rolePolicySchema.array().length(12).readonly(),
    observerExcludedFromLaterRoles: m9b12bInfluenceBearingRoleSchema
      .array()
      .length(12)
      .readonly(),
    isolationChannels: m9b12bIsolationChannelSchema
      .array()
      .length(16)
      .readonly(),
    contaminationAncestorKinds: m9b12bContaminationAncestorSchema
      .array()
      .length(18)
      .readonly(),
    forbiddenAccessClasses: m9b12bForbiddenAccessSchema
      .array()
      .length(20)
      .readonly(),
    allIsolationProofsRequiredBeforeRoleStart: z.literal(true),
    everyAncestorRequiresAffirmativeCleanLineageProof: z.literal(true),
    unknownOmittedOrUnsupportedInputQuarantines: z.literal(true),
    anyContaminatedAncestorContaminatesEveryDescendant: z.literal(true),
    transformationsCannotRemoveContamination: z
      .tuple([
        z.literal("rename"),
        z.literal("paraphrase"),
        z.literal("reorder"),
        z.literal("copy"),
        z.literal("rehash"),
        z.literal("serialization-change"),
        z.literal("reconstruct"),
      ])
      .readonly(),
    exactApprovedPublicCounts: z
      .strictObject({
        families: z.literal(8),
        scales: z.literal(3),
        cells: z.literal(24),
        probePairs: z.literal(24),
        primaryPairs: z.literal(168),
        totalPairs: z.literal(192),
      })
      .readonly(),
    countsMayRevealIdentityOrderContentOrMapping: z.literal(false),
    liveAuthorityGranted: z.literal(false),
  })
  .readonly();

export type M9b12bRetiredCorpusPolicy = z.infer<
  typeof retiredCorpusPolicySchema
>;

function createRetiredCorpusPolicy(): M9b12bRetiredCorpusPolicy {
  return retiredCorpusPolicySchema.parse({
    protocol: M9B12B_RETIRED_CORPUS_PROTOCOL.id,
    version: M9B12B_RETIRED_CORPUS_PROTOCOL.version,
    status: M9B12B_RETIRED_CORPUS_PROTOCOL.status,
    decisionRule:
      "allow-only-when-every-required-proof-is-complete-affirmative-and-no-rejection-reason-exists",
    roles: M9B12B_INFLUENCE_BEARING_ROLES.map((role) => ({
      role,
      influenceBearing: true,
      retiredNamespaceAccessible: false,
      retiredPathsIdentitiesOrStructureDisclosed: false,
      excludedAfterRetiredExposure: true,
    })),
    observerExcludedFromLaterRoles: M9B12B_INFLUENCE_BEARING_ROLES,
    isolationChannels: M9B12B_ISOLATION_CHANNELS,
    contaminationAncestorKinds: M9B12B_CONTAMINATION_ANCESTORS,
    forbiddenAccessClasses: M9B12B_FORBIDDEN_ACCESS_CLASSES,
    allIsolationProofsRequiredBeforeRoleStart: true,
    everyAncestorRequiresAffirmativeCleanLineageProof: true,
    unknownOmittedOrUnsupportedInputQuarantines: true,
    anyContaminatedAncestorContaminatesEveryDescendant: true,
    transformationsCannotRemoveContamination: [
      "rename",
      "paraphrase",
      "reorder",
      "copy",
      "rehash",
      "serialization-change",
      "reconstruct",
    ],
    exactApprovedPublicCounts: {
      families: 8,
      scales: 3,
      cells: 24,
      probePairs: 24,
      primaryPairs: 168,
      totalPairs: 192,
    },
    countsMayRevealIdentityOrderContentOrMapping: false,
    liveAuthorityGranted: false,
  });
}

const correctedCorpusConstructionSchema = originalShape.corpusConstruction
  .unwrap()
  .extend({
    retiredCorpusPolicy: z.literal(M9B12B_RETIRED_CORPUS_PROTOCOL.id),
    retiredAccessBehavior: z.literal(
      "deny-by-default-quarantine-unless-every-required-proof-is-complete-and-affirmative",
    ),
  })
  .readonly();

function correctedFutureAuthorizations(): M9b12aPreregistration["futureAuthorizations"] {
  const original = originalShape.futureAuthorizations.parse({
    issued: false,
    texts: [
      {
        kind: "external-preregistration",
        text: "Authorize submission of the exact checksum-bound M9b.12b preregistration package to the named external registry and no other action.",
        prerequisites:
          "Independent review accepts the M9b.12b digest, complete linear supersession, one canonical registration contract, and exact checksum manifest.",
        grantsOnly:
          "One append-only external registration submission; no corpus, project, credential, count, inference, or campaign action.",
      },
      {
        kind: "corpus-materialization",
        text: "Authorize isolated construction and materialization under the registered corpus and M9b.12b retired-material protocols only.",
        prerequisites:
          "External registration is independently verified and every required role, isolation, ancestry, and noninterference proof is complete and affirmative.",
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
          "Cap, credential, zero-spend, accounting, persistence, deny-by-default retired-material, and response-shape preflights pass.",
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
  return original;
}

const correctionAuditSchema = z
  .strictObject({
    reviewDecisionAddressed: z.literal("m9b12a-independent-review-no-go"),
    externalRegistrationContractUnified: z.literal(true),
    missingIdentityOrInventoryFailsClosed: z.literal(true),
    roleExclusionsDerivedFromCanonicalRoles: z.literal(true),
    isolationAndAncestrySchemasExhaustive: z.literal(true),
    oneTriggerBehavioralTestsRequired: z.literal(true),
    m9b12BytesModified: z.literal(false),
    m9b12aBytesModified: z.literal(false),
    scientificProtocolUnchanged: z.literal(true),
    financialProtocolUnchanged: z.literal(true),
    retiredMaterialAccessed: z.literal(false),
    providerEffects: z.literal(0),
    credentialEffects: z.literal(0),
    networkEffects: z.literal(0),
  })
  .readonly();

const m9b12bBodySchema = preservedM9b12aFieldsSchema
  .safeExtend({
    protocol: z.literal(M9B12B_PREREGISTRATION_PROTOCOL.id),
    version: z.literal(M9B12B_PREREGISTRATION_PROTOCOL.version),
    baselineCommit: z.literal(M9B12B_PREREGISTRATION_PROTOCOL.baselineCommit),
    baselineTree: z.literal(M9B12B_PREREGISTRATION_PROTOCOL.baselineTree),
    status: z.literal(
      "offline-immutable-superseding-draft-not-externally-registered",
    ),
    supersession: supersessionSchema,
    corpusConstruction: correctedCorpusConstructionSchema,
    retiredCorpusPolicy: retiredCorpusPolicySchema,
    futureAuthorizations: originalShape.futureAuthorizations,
    externalRegistrationFormat: m9b12bExternalRegistrationFormatSchema,
    correctionAudit: correctionAuditSchema,
    decision: z.literal(M9B12B_PREREGISTRATION_PROTOCOL.decision),
  })
  .readonly();

export const m9b12bPreregistrationSchema = m9b12bBodySchema
  .unwrap()
  .safeExtend({ preregistrationDigest: digestSchema })
  .readonly();
export type M9b12bPreregistration = z.infer<typeof m9b12bPreregistrationSchema>;

type M9b12bFailure = Readonly<{
  kind: "integrity";
  message: string;
}>;

function failure(message: string): Result<never, M9b12bFailure> {
  return { ok: false, error: { kind: "integrity", message } };
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftBytes = canonicalizeJson(left);
  const rightBytes = canonicalizeJson(right);
  return leftBytes.ok && rightBytes.ok && leftBytes.value === rightBytes.value;
}

async function digestBody(
  value: unknown,
): Promise<Result<string, M9b12bFailure>> {
  const digest = await digestValue(value);
  return digest.ok
    ? { ok: true, value: digest.value }
    : failure("M9b.12b canonical digest failed.");
}

function withoutReplacedFields(
  original: M9b12aPreregistration,
): z.infer<typeof preservedM9b12aFieldsSchema> {
  const {
    protocol: ignoredProtocol,
    version: ignoredVersion,
    baselineCommit: ignoredBaselineCommit,
    status: ignoredStatus,
    supersession: ignoredSupersession,
    corpusConstruction: ignoredCorpusConstruction,
    retiredCorpusPolicy: ignoredRetiredCorpusPolicy,
    futureAuthorizations: ignoredFutureAuthorizations,
    externalRegistrationFormat: ignoredExternalRegistrationFormat,
    correctionAudit: ignoredCorrectionAudit,
    decision: ignoredDecision,
    preregistrationDigest: ignoredPreregistrationDigest,
    ...preserved
  } = original;
  void ignoredProtocol;
  void ignoredVersion;
  void ignoredBaselineCommit;
  void ignoredStatus;
  void ignoredSupersession;
  void ignoredCorpusConstruction;
  void ignoredRetiredCorpusPolicy;
  void ignoredFutureAuthorizations;
  void ignoredExternalRegistrationFormat;
  void ignoredCorrectionAudit;
  void ignoredDecision;
  void ignoredPreregistrationDigest;
  const parsed = preservedM9b12aFieldsSchema.safeParse(preserved);
  if (!parsed.success)
    throw new Error(
      `M9b.12a preserved fields changed: ${parsed.error.message}`,
    );
  return parsed.data;
}

async function deriveM9b12bPreregistration(): Promise<
  Result<M9b12bPreregistration, M9b12bFailure>
> {
  const original = await prepareM9b12aPreregistration();
  if (!original.ok) return failure("M9b.12a package could not rederive.");
  const verified = await verifyM9b12aPreregistration(
    original.value.token,
    original.value.preregistration,
  );
  if (
    !verified.ok ||
    verified.value.preregistrationDigest !==
      M9B12A_LINEAGE.preregistrationDigest
  )
    return failure("M9b.12a identity changed.");
  const body = m9b12bBodySchema.parse({
    ...withoutReplacedFields(verified.value),
    protocol: M9B12B_PREREGISTRATION_PROTOCOL.id,
    version: M9B12B_PREREGISTRATION_PROTOCOL.version,
    baselineCommit: M9B12B_PREREGISTRATION_PROTOCOL.baselineCommit,
    baselineTree: M9B12B_PREREGISTRATION_PROTOCOL.baselineTree,
    status: "offline-immutable-superseding-draft-not-externally-registered",
    supersession: {
      protocol: "lachesis-m9b12b-linear-supersession/1",
      ordering: [
        M9B12_LINEAGE.protocol,
        M9B12A_LINEAGE.protocol,
        "lachesis-m9b12b-offline-preregistration-package@1.0.0",
      ],
      predecessors: [M9B12_LINEAGE, M9B12A_LINEAGE],
      predecessorBytesModified: false,
      predecessorExternallyRegistered: false,
      correctionScope:
        "retired-corpus-enforcement-roles-isolation-ancestry-supersession-registration-and-tests-only",
    },
    corpusConstruction: {
      ...verified.value.corpusConstruction,
      retiredCorpusPolicy: M9B12B_RETIRED_CORPUS_PROTOCOL.id,
      retiredAccessBehavior:
        "deny-by-default-quarantine-unless-every-required-proof-is-complete-and-affirmative",
    },
    retiredCorpusPolicy: createRetiredCorpusPolicy(),
    futureAuthorizations: correctedFutureAuthorizations(),
    externalRegistrationFormat: createM9b12bExternalRegistrationFormat(),
    correctionAudit: {
      reviewDecisionAddressed: "m9b12a-independent-review-no-go",
      externalRegistrationContractUnified: true,
      missingIdentityOrInventoryFailsClosed: true,
      roleExclusionsDerivedFromCanonicalRoles: true,
      isolationAndAncestrySchemasExhaustive: true,
      oneTriggerBehavioralTestsRequired: true,
      m9b12BytesModified: false,
      m9b12aBytesModified: false,
      scientificProtocolUnchanged: true,
      financialProtocolUnchanged: true,
      retiredMaterialAccessed: false,
      providerEffects: 0,
      credentialEffects: 0,
      networkEffects: 0,
    },
    decision: M9B12B_PREREGISTRATION_PROTOCOL.decision,
  });
  const preregistrationDigest = await digestBody(body);
  return preregistrationDigest.ok
    ? {
        ok: true,
        value: m9b12bPreregistrationSchema.parse({
          ...body,
          preregistrationDigest: preregistrationDigest.value,
        }),
      }
    : preregistrationDigest;
}

const packageTokenBrand: unique symbol = Symbol("M9b12bPreregistrationToken");
export type M9b12bPreregistrationToken = Readonly<{
  [packageTokenBrand]: "M9b12bPreregistrationToken";
}>;
const trustedPackages = new WeakMap<
  M9b12bPreregistrationToken,
  M9b12bPreregistration
>();

export async function prepareM9b12bPreregistration(): Promise<
  Result<
    Readonly<{
      token: M9b12bPreregistrationToken;
      preregistration: M9b12bPreregistration;
    }>,
    M9b12bFailure
  >
> {
  const preregistration = await deriveM9b12bPreregistration();
  if (!preregistration.ok) return preregistration;
  const token: M9b12bPreregistrationToken = Object.freeze({
    [packageTokenBrand]: "M9b12bPreregistrationToken",
  });
  trustedPackages.set(token, preregistration.value);
  return {
    ok: true,
    value: { token, preregistration: preregistration.value },
  };
}

export async function verifyM9b12bPreregistration(
  token: M9b12bPreregistrationToken,
  value: unknown,
): Promise<Result<M9b12bPreregistration, M9b12bFailure>> {
  const trusted = trustedPackages.get(token);
  const parsed = m9b12bPreregistrationSchema.safeParse(value);
  const rederived = await deriveM9b12bPreregistration();
  if (
    trusted === undefined ||
    !parsed.success ||
    !rederived.ok ||
    !canonicalEqual(trusted, parsed.data) ||
    !canonicalEqual(rederived.value, parsed.data)
  )
    return failure("M9b.12b preregistration package changed.");
  return { ok: true, value: parsed.data };
}

const completenessStatusSchema = z.enum([
  "complete",
  "missing",
  "incomplete",
  "ambiguous",
]);
const isolationProofSchema = z
  .strictObject({
    channel: m9b12bIsolationChannelSchema,
    decision: z.enum(["isolated", "not-isolated", "unknown"]),
  })
  .readonly();
const lineageProofSchema = z
  .strictObject({
    ancestorKind: m9b12bContaminationAncestorSchema,
    decision: z.enum(["clean", "contaminated", "unknown"]),
  })
  .readonly();

const retiredBoundaryAttemptSchema = z
  .strictObject({
    role: m9b12bInfluenceBearingRoleSchema,
    observerIdentity: z
      .strictObject({
        status: completenessStatusSchema,
        commitment: digestSchema.nullable(),
      })
      .readonly(),
    exposureInventory: z
      .strictObject({
        status: completenessStatusSchema,
        commitment: digestSchema.nullable(),
      })
      .readonly(),
    isolationProofs: isolationProofSchema.array().readonly(),
    unsupportedIsolationChannels: recordedUnknownValueSchema.array().readonly(),
    lineageProofs: lineageProofSchema.array().readonly(),
    unsupportedAncestorKinds: recordedUnknownValueSchema.array().readonly(),
    noninterference: z.enum(["confirmed", "unknown", "not-assessed"]),
    retiredMaterialStatus: z.enum(["none", "suspected", "confirmed"]),
    forbiddenAccessAttempts: m9b12bForbiddenAccessSchema.array().readonly(),
    unclassifiedAccessChannels: recordedUnknownValueSchema.array().readonly(),
    frozenCountsCommitment: publicCountCommitmentSchema.nullable(),
    manualCleanupAttempted: z.boolean(),
    restart: z
      .strictObject({
        attempted: z.boolean(),
        freshRoleIdentity: z.boolean(),
        freshEnvironment: z.boolean(),
        freshSeed: z.boolean(),
        freshCorpusConstruction: z.boolean(),
        reusedIdentityTemplatePacketOrMaterialization: z.boolean(),
      })
      .readonly(),
    providerEffectAttempted: z.boolean(),
  })
  .readonly();
export type M9b12bRetiredBoundaryAttempt = z.infer<
  typeof retiredBoundaryAttemptSchema
>;

const retiredBoundaryReceiptBodySchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b12b-retired-boundary-receipt/1"),
    policyProtocol: z.literal(M9B12B_RETIRED_CORPUS_PROTOCOL.id),
    decision: z.enum([
      "allow-role-start",
      "allow-minimum-opaque-count-commitment",
      "quarantine-reuse-forbidden",
    ]),
    reasons: z.string().array().readonly(),
    reuseForbidden: z.boolean(),
    roleStartupPermitted: z.boolean(),
    roleSessionQuarantined: z.boolean(),
    allProducedAndDerivedInventoryQuarantined: z.boolean(),
    observerExcludedFromLaterRoles: m9b12bInfluenceBearingRoleSchema
      .array()
      .readonly(),
    freshRestartRequired: z.boolean(),
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

export const m9b12bRetiredBoundaryReceiptSchema =
  retiredBoundaryReceiptBodySchema
    .unwrap()
    .safeExtend({ receiptDigest: digestSchema })
    .readonly();
export type M9b12bRetiredBoundaryReceipt = z.infer<
  typeof m9b12bRetiredBoundaryReceiptSchema
>;

function exactFrozenCounts(
  value: M9b12bRetiredBoundaryAttempt["frozenCountsCommitment"],
): boolean {
  return (
    value !== null &&
    value.approvedByTrustedBoundary &&
    !value.revealsIdentityOrderContentOrMapping &&
    value.values.families === 8 &&
    value.values.scales === 3 &&
    value.values.cells === 24 &&
    value.values.probePairs === 24 &&
    value.values.primaryPairs === 168 &&
    value.values.totalPairs === 192
  );
}

function addCompletenessReason(
  reasons: Set<string>,
  prefix: "observer-identity" | "exposure-inventory",
  status: z.infer<typeof completenessStatusSchema>,
  commitment: string | null,
): void {
  if (status !== "complete") reasons.add(`${prefix}-${status}`);
  if (status === "complete" && commitment === null)
    reasons.add(`${prefix}-commitment-missing`);
}

function collectProofReasons(input: M9b12bRetiredBoundaryAttempt): Set<string> {
  const reasons = new Set<string>();
  addCompletenessReason(
    reasons,
    "observer-identity",
    input.observerIdentity.status,
    input.observerIdentity.commitment,
  );
  addCompletenessReason(
    reasons,
    "exposure-inventory",
    input.exposureInventory.status,
    input.exposureInventory.commitment,
  );

  const isolationByChannel = new Map<
    M9b12bIsolationChannel,
    ReadonlyArray<"isolated" | "not-isolated" | "unknown">
  >();
  for (const proof of input.isolationProofs) {
    const previous = isolationByChannel.get(proof.channel) ?? [];
    isolationByChannel.set(proof.channel, [...previous, proof.decision]);
  }
  for (const channel of M9B12B_ISOLATION_CHANNELS) {
    const decisions = isolationByChannel.get(channel) ?? [];
    if (decisions.length === 0)
      reasons.add(`isolation-proof-missing:${channel}`);
    else if (decisions.length > 1)
      reasons.add(`isolation-proof-duplicate:${channel}`);
    else if (decisions[0] !== "isolated")
      reasons.add(`isolation-${decisions[0]}:${channel}`);
  }
  if (input.unsupportedIsolationChannels.length > 0)
    reasons.add("unsupported-isolation-channel");

  const lineageByAncestor = new Map<
    M9b12bContaminationAncestor,
    ReadonlyArray<"clean" | "contaminated" | "unknown">
  >();
  for (const proof of input.lineageProofs) {
    const previous = lineageByAncestor.get(proof.ancestorKind) ?? [];
    lineageByAncestor.set(proof.ancestorKind, [...previous, proof.decision]);
  }
  for (const ancestor of M9B12B_CONTAMINATION_ANCESTORS) {
    const decisions = lineageByAncestor.get(ancestor) ?? [];
    if (decisions.length === 0)
      reasons.add(`lineage-proof-missing:${ancestor}`);
    else if (decisions.length > 1)
      reasons.add(`lineage-proof-duplicate:${ancestor}`);
    else if (decisions[0] !== "clean")
      reasons.add(`lineage-${decisions[0]}:${ancestor}`);
  }
  if (input.unsupportedAncestorKinds.length > 0)
    reasons.add("unsupported-contamination-ancestor");

  if (input.noninterference !== "confirmed")
    reasons.add(`noninterference-${input.noninterference}`);
  if (input.retiredMaterialStatus !== "none")
    reasons.add(`retired-material-${input.retiredMaterialStatus}`);
  for (const access of input.forbiddenAccessAttempts)
    reasons.add(`forbidden-access:${access}`);
  if (input.unclassifiedAccessChannels.length > 0)
    reasons.add("unclassified-access-channel");
  if (
    input.frozenCountsCommitment !== null &&
    !exactFrozenCounts(input.frozenCountsCommitment)
  )
    reasons.add("count-commitment-not-exact-approved-public-counts");
  if (input.manualCleanupAttempted) reasons.add("manual-cleanup-attempted");
  if (
    input.restart.attempted &&
    (!input.restart.freshRoleIdentity ||
      !input.restart.freshEnvironment ||
      !input.restart.freshSeed ||
      !input.restart.freshCorpusConstruction ||
      input.restart.reusedIdentityTemplatePacketOrMaterialization)
  )
    reasons.add("restart-not-fully-fresh");
  if (input.providerEffectAttempted)
    reasons.add("provider-effect-attempted-before-allow");
  return reasons;
}

async function createReceipt(
  reasons: ReadonlySet<string>,
  countCommitmentPresent: boolean,
): Promise<Result<M9b12bRetiredBoundaryReceipt, M9b12bFailure>> {
  const quarantine = reasons.size > 0;
  const body = retiredBoundaryReceiptBodySchema.parse({
    protocol: "lachesis-m9b12b-retired-boundary-receipt/1",
    policyProtocol: M9B12B_RETIRED_CORPUS_PROTOCOL.id,
    decision: quarantine
      ? "quarantine-reuse-forbidden"
      : countCommitmentPresent
        ? "allow-minimum-opaque-count-commitment"
        : "allow-role-start",
    reasons: [...reasons].toSorted(),
    reuseForbidden: quarantine,
    roleStartupPermitted: !quarantine,
    roleSessionQuarantined: quarantine,
    allProducedAndDerivedInventoryQuarantined: quarantine,
    observerExcludedFromLaterRoles: quarantine
      ? M9B12B_INFLUENCE_BEARING_ROLES
      : [],
    freshRestartRequired: quarantine,
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
        value: m9b12bRetiredBoundaryReceiptSchema.parse({
          ...body,
          receiptDigest: receiptDigest.value,
        }),
      }
    : receiptDigest;
}

export async function assessM9b12bRetiredMaterialBoundary(
  value: unknown,
): Promise<Result<M9b12bRetiredBoundaryReceipt, M9b12bFailure>> {
  const parsed = retiredBoundaryAttemptSchema.safeParse(value);
  if (!parsed.success)
    return createReceipt(new Set(["attempt-schema-invalid"]), false);
  return createReceipt(
    collectProofReasons(parsed.data),
    parsed.data.frozenCountsCommitment !== null,
  );
}
