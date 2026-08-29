import { createHash } from "node:crypto";

import { canonicalizeJson, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

export const M9B13K5_DESIGN_PROTOCOL =
  "lachesis-m9b13k5-offline-controller-integration-design/1" as const;
export const M9B13K5_ACTIVATION_PROTOCOL =
  "lachesis-m9b13k5-structural-activation-candidate/1" as const;
export const M9B13K5_STATE_PROTOCOL =
  "lachesis-m9b13k5-pure-controller-state/1" as const;
export const M9B13K5_EVENT_PROTOCOL =
  "lachesis-m9b13k5-controller-ledger-event/1" as const;
export const M9B13K5_CUSTODIAN_PROTOCOL =
  "lachesis-m9b13k5-custodian-verification/1" as const;
export const M9B13K5_RECONCILIATION_PROTOCOL =
  "lachesis-m9b13k5-stable-object-reconciliation/1" as const;

export const M9B13K5_ACCEPTED_LEDGER_IDENTITY =
  "cf35bd5756e8397ed9fa010e356ac30787ef69ba19ab13a7c057eac0f32d9ceb" as const;
export const M9B13K5_PRODUCTION_HELPER_IDENTITY =
  "7edfb6ece84e6d9b4d292700234880bc73c57484c6bc7fd73ec29136c2b64c6e" as const;
export const M9B13K5_CONFORMANCE_HELPER_IDENTITY =
  "16f2a69cb84c52a4a96532546f7783cc3f1bd80125f98dff3eb926e6363f1625" as const;

export const M9B13K5_PROJECT_ID = "bmsda" as const;
export const M9B13K5_DRAFT_ID = "6a7619b506a607fe5f63a77d" as const;
export const M9B13K5_PROVIDER = "osfstorage" as const;
export const M9B13K5_ARTIFACT_FILENAME =
  "m9b13k5-offline-controller-integration-proof.txt" as const;

export const M9B13K5_LIMITS = Object.freeze({
  maximumHttpRequests: 18,
  maximumPutDispatches: 1,
  maximumRevocationDispatches: 1,
  retries: 0,
  concurrency: 1,
  perRequestTimeoutMs: 10_000,
  controllerDeadlineMs: 120_000,
  revocationDeadlineMs: 15_000,
  apiResponseBytes: 262_144,
  uploadResponseBytes: 65_536,
  requestBodyBytes: 245,
  redirects: 0,
} as const);

const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .readonly();
const gitIdentitySchema = z
  .string()
  .regex(/^[a-f0-9]{40}$/u)
  .readonly();
const boundedIdentitySchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:/-]+$/u)
  .readonly();

const syntheticArtifactText = [
  "Lachesis M9b.13k.5 offline controller integration proof.",
  "This synthetic artifact carries no authority, credential, or remote effect.",
  "Its exact 245-byte snapshot is frozen for future intercepted conformance only.",
  "M9b remains NO-GO.",
].join("\n");
const syntheticArtifactBytes = new TextEncoder().encode(
  syntheticArtifactText.padEnd(M9B13K5_LIMITS.requestBodyBytes, "."),
);
if (syntheticArtifactBytes.byteLength !== M9B13K5_LIMITS.requestBodyBytes)
  throw new Error("m9b13k5-synthetic-artifact-length-invalid");

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export const M9B13K5_ARTIFACT_SHA256 = sha256(syntheticArtifactBytes);
export const M9B13K5_ARTIFACT_IDENTITY = sha256(
  `${M9B13K5_ARTIFACT_FILENAME}\u0000${syntheticArtifactBytes.byteLength}\u0000${M9B13K5_ARTIFACT_SHA256}`,
);
export const M9B13K5_PUT_REQUEST_DIGEST = sha256(
  `PUT\u0000files.osf.io\u0000/v1/resources/${M9B13K5_PROJECT_ID}/providers/${M9B13K5_PROVIDER}/?name=${M9B13K5_ARTIFACT_FILENAME}\u0000${M9B13K5_ARTIFACT_SHA256}`,
);

export function copyM9b13k5SyntheticArtifact(): Uint8Array {
  return syntheticArtifactBytes.slice();
}

export const m9b13k5ActivationCandidateSchema = z
  .strictObject({
    protocol: z.literal(M9B13K5_ACTIVATION_PROTOCOL),
    reviewedIntegrationCommit: gitIdentitySchema,
    reviewedIntegrationTree: gitIdentitySchema,
    controllerImplementationIdentity: sha256Schema,
    ledgerImplementationIdentity: z.literal(M9B13K5_ACCEPTED_LEDGER_IDENTITY),
    productionHelperIdentity: z.literal(M9B13K5_PRODUCTION_HELPER_IDENTITY),
    launcherIdentity: sha256Schema,
    productionTransportIdentity: sha256Schema,
    rawResponseParserIdentity: sha256Schema,
    reconciliationIdentity: sha256Schema,
    requestSequenceIdentity: sha256Schema,
    custodianPublicKey: z.string().min(1).max(4096),
    custodianFingerprint: sha256Schema,
    custodianIdentity: sha256Schema,
    ledgerNamespaceCommitment: sha256Schema,
    ledgerStoreIdentity: sha256Schema,
    ledgerInitialRoot: sha256Schema,
    requestIdentity: boundedIdentitySchema,
    campaignIdentity: boundedIdentitySchema,
    tokenId: boundedIdentitySchema,
    projectId: z.literal(M9B13K5_PROJECT_ID),
    draftId: z.literal(M9B13K5_DRAFT_ID),
    provider: z.literal(M9B13K5_PROVIDER),
    artifactFilename: z.literal(M9B13K5_ARTIFACT_FILENAME),
    artifactByteLength: z.literal(M9B13K5_LIMITS.requestBodyBytes),
    artifactSha256: z.literal(M9B13K5_ARTIFACT_SHA256),
    artifactIdentity: z.literal(M9B13K5_ARTIFACT_IDENTITY),
    putRequestDigest: z.literal(M9B13K5_PUT_REQUEST_DIGEST),
    limits: z
      .strictObject({
        maximumHttpRequests: z.literal(18),
        maximumPutDispatches: z.literal(1),
        maximumRevocationDispatches: z.literal(1),
        retries: z.literal(0),
        concurrency: z.literal(1),
        perRequestTimeoutMs: z.literal(10_000),
        controllerDeadlineMs: z.literal(120_000),
        revocationDeadlineMs: z.literal(15_000),
        apiResponseBytes: z.literal(262_144),
        uploadResponseBytes: z.literal(65_536),
        requestBodyBytes: z.literal(245),
        redirects: z.literal(0),
      })
      .readonly(),
    ceremonyProtocol: boundedIdentitySchema,
    revocationProtocol: boundedIdentitySchema,
  })
  .readonly();
export type M9b13k5ActivationCandidate = z.infer<
  typeof m9b13k5ActivationCandidateSchema
>;

export type M9b13k5ProtocolFailure = Readonly<{
  kind: "protocol";
  reason: string;
  ambiguous: false;
}>;

function protocolFailure(
  reason: string,
): Result<never, M9b13k5ProtocolFailure> {
  return { ok: false, error: { kind: "protocol", reason, ambiguous: false } };
}

function canonicalDigest(
  value: unknown,
): Result<string, M9b13k5ProtocolFailure> {
  const canonical = canonicalizeJson(value);
  return canonical.ok
    ? { ok: true, value: sha256(canonical.value) }
    : protocolFailure("m9b13k5-canonicalization-failed");
}

export function deriveM9b13k5ActivationIdentity(value: unknown): Result<
  Readonly<{
    activationIdentity: string;
    candidate: M9b13k5ActivationCandidate;
  }>,
  M9b13k5ProtocolFailure
> {
  const parsed = m9b13k5ActivationCandidateSchema.safeParse(value);
  if (!parsed.success)
    return protocolFailure("m9b13k5-activation-candidate-invalid");
  const digest = canonicalDigest(parsed.data);
  return digest.ok
    ? {
        ok: true,
        value: {
          activationIdentity: digest.value,
          candidate: parsed.data,
        },
      }
    : digest;
}

export const M9B13K5_STATES = [
  "inert",
  "activation_structurally_inspected",
  "activation_admitted",
  "ledger_opened_identity_verified",
  "credential_launch_reserved",
  "credential_custody_active",
  "request_preconditions_in_progress",
  "upload_reserved",
  "upload_possibly_dispatched",
  "upload_reconciled",
  "revocation_reserved",
  "revocation_possibly_dispatched",
  "credential_custody_closed",
  "awaiting_independent_revocation_verification",
  "synthetic_revoked_and_verified",
  "synthetic_active_token_security_stop",
  "synthetic_ambiguity_security_stop",
  "revoked_and_independently_verified",
  "active_token_security_stop",
  "ambiguity_security_stop",
  "quarantined",
  "closed",
] as const;
export const m9b13k5StateNameSchema = z.enum(M9B13K5_STATES);
export type M9b13k5StateName = z.infer<typeof m9b13k5StateNameSchema>;

export const M9B13K5_EVENT_KINDS = [
  "activation-inspected",
  "activation-admitted",
  "ledger-opened",
  "credential-launch-reserved",
  "credential-custody-active",
  "preconditions-started",
  "precondition-request-reserved",
  "upload-reserved",
  "upload-dispatch-observed",
  "upload-reconciled",
  "revocation-reserved",
  "revocation-dispatch-observed",
  "credential-custody-closed",
  "custodian-verification-awaited",
  "synthetic-custodian-revoked",
  "synthetic-custodian-active",
  "synthetic-custodian-ambiguous",
  "dispatch-ambiguity-stopped",
  "quarantined",
  "closed",
] as const;
export const m9b13k5EventKindSchema = z.enum(M9B13K5_EVENT_KINDS);
export type M9b13k5EventKind = z.infer<typeof m9b13k5EventKindSchema>;

export const M9B13K5_DISPATCH_BOUNDARIES = [
  "request-constructed",
  "reservation-committed",
  "request-object-created",
  "first-possible-byte-enqueue",
  "body-write-begun",
  "request-end-begun",
  "response-headers-received",
  "response-completed",
] as const;
export const m9b13k5DispatchBoundarySchema = z.enum(
  M9B13K5_DISPATCH_BOUNDARIES,
);
export type M9b13k5DispatchBoundary = z.infer<
  typeof m9b13k5DispatchBoundarySchema
>;

export const m9b13k5CustodianReceiptSchema = z
  .strictObject({
    protocol: z.literal(M9B13K5_CUSTODIAN_PROTOCOL),
    mode: z.enum(["synthetic", "live"]),
    result: z.enum(["revoked", "active", "ambiguous"]),
    activationIdentity: sha256Schema,
    requestIdentity: boundedIdentitySchema,
    tokenId: boundedIdentitySchema,
    ledgerStoreIdentity: sha256Schema,
    ledgerSequence: z.number().int().nonnegative(),
    ledgerRoot: sha256Schema,
    revocationRequestIndex: z.number().int().positive(),
    revocationDigest: sha256Schema,
    custodianPublicKey: z.string().min(1).max(4096),
    custodianFingerprint: sha256Schema,
    custodianIdentity: sha256Schema,
    signature: z.string().min(1).max(8192),
  })
  .readonly();
export type M9b13k5CustodianReceipt = z.infer<
  typeof m9b13k5CustodianReceiptSchema
>;

export function deriveM9b13k5ProtocolIdentity(): string {
  const digest = canonicalDigest({
    protocol: M9B13K5_DESIGN_PROTOCOL,
    activationProtocol: M9B13K5_ACTIVATION_PROTOCOL,
    stateProtocol: M9B13K5_STATE_PROTOCOL,
    eventProtocol: M9B13K5_EVENT_PROTOCOL,
    custodianProtocol: M9B13K5_CUSTODIAN_PROTOCOL,
    reconciliationProtocol: M9B13K5_RECONCILIATION_PROTOCOL,
    ledgerIdentity: M9B13K5_ACCEPTED_LEDGER_IDENTITY,
    states: M9B13K5_STATES,
    events: M9B13K5_EVENT_KINDS,
    dispatchBoundaries: M9B13K5_DISPATCH_BOUNDARIES,
    limits: M9B13K5_LIMITS,
    artifact: {
      filename: M9B13K5_ARTIFACT_FILENAME,
      byteLength: syntheticArtifactBytes.byteLength,
      sha256: M9B13K5_ARTIFACT_SHA256,
      identity: M9B13K5_ARTIFACT_IDENTITY,
      putRequestDigest: M9B13K5_PUT_REQUEST_DIGEST,
    },
  });
  if (!digest.ok) throw new Error(digest.error.reason);
  return digest.value;
}
