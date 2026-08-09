import { createHash } from "node:crypto";

import { canonicalizeJson, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

export const M9B13K2_RUNTIME_PROTOCOL =
  "lachesis-m9b13k2-concrete-osf-pat-canary-runtime/1" as const;
export const M9B13K2_ACTIVATION_PROTOCOL =
  "lachesis-m9b13k2-checksum-bound-activation-capsule/1" as const;
export const M9B13K2_LAUNCH_PROTOCOL =
  "lachesis-m9b13k2-controlled-owned-fd3-launch/1" as const;
export const M9B13K2_LEDGER_PROTOCOL =
  "lachesis-m9b13k2-private-sqlite-cas-ledger/1" as const;
export const M9B13K2_TRANSPORT_PROTOCOL =
  "lachesis-m9b13k2-bounded-node-https-transport/1" as const;
export const M9B13K2_DEADLINE_PROTOCOL =
  "lachesis-m9b13k2-controller-owned-deadlines/1" as const;
export const M9B13K2_OBJECT_PROTOCOL =
  "lachesis-m9b13k2-stable-waterbutler-object/1" as const;
export const M9B13K2_REVOCATION_PROTOCOL =
  "lachesis-m9b13k2-two-phase-revocation/1" as const;
export const M9B13K2_CUSTODIAN_PROTOCOL =
  "lachesis-m9b13k2-independent-ed25519-custodian-receipt/1" as const;
export const M9B13K2_REPLAY_PROTOCOL =
  "lachesis-m9b13k2-zero-effect-durable-replay/1" as const;
export const M9B13K2_SYNTHETIC_PROTOCOL =
  "lachesis-m9b13k2-local-synthetic-conformance-only/1" as const;

export const M9B13K2_PROJECT_ID = "bmsda" as const;
export const M9B13K2_DRAFT_ID = "6a7619b506a607fe5f63a77d" as const;
export const M9B13K2_PROVIDER = "osfstorage" as const;
export const M9B13K2_REQUIRED_SCOPE = "osf.full_write" as const;
export const M9B13K2_ARTIFACT_IDENTITY =
  "1fbd9e013ac05f53c411b9e98f507d12" as const;
export const M9B13K2_ARTIFACT_FILENAME =
  "OSF-PAT-WATERBUTLER-CANARY-1fbd9e013ac05f53c411b9e98f507d12.txt" as const;
export const M9B13K2_ARTIFACT_SHA256 =
  "4ee4d970eb65bb9b8e525618ba19d4ee28dd2c1a1d0730bd9c4f3ff016134994" as const;
export const M9B13K2_ARTIFACT_BYTE_LENGTH = 245 as const;

export const M9B13K2_MAXIMUM_HTTP_REQUESTS = 18 as const;
export const M9B13K2_MAXIMUM_PUT_DISPATCHES = 1 as const;
export const M9B13K2_MAXIMUM_REVOCATION_DISPATCHES = 1 as const;
export const M9B13K2_MAXIMUM_REQUEST_BODY_BYTES = 245 as const;
export const M9B13K2_API_RESPONSE_MAXIMUM_BYTES = 262_144 as const;
export const M9B13K2_UPLOAD_RESPONSE_MAXIMUM_BYTES = 65_536 as const;
export const M9B13K2_REQUEST_TIMEOUT_MS = 10_000 as const;
export const M9B13K2_CONTROLLER_DEADLINE_MS = 120_000 as const;
export const M9B13K2_REVOCATION_DEADLINE_MS = 15_000 as const;

const ARTIFACT_TEXT = `frozen identity: ${M9B13K2_ARTIFACT_IDENTITY}\nexact filename: ${M9B13K2_ARTIFACT_FILENAME}\nSYNTHETIC NON-STUDY OSF PAT WATERBUTLER CANARY\nThis file contains no scientific, operational or protected content.\n`;

export const m9b13k2DigestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .readonly();
export const m9b13k2BoundDigestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u)
  .readonly();
export const m9b13k2TokenIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/u)
  .readonly();

export type M9b13k2Failure = Readonly<{
  kind:
    | "activation"
    | "credential"
    | "custodian"
    | "ledger"
    | "protocol"
    | "reconciliation"
    | "transport";
  reason: string;
  ambiguous: boolean;
}>;

export function m9b13k2Failure(
  kind: M9b13k2Failure["kind"],
  reason: string,
  ambiguous = false,
): Result<never, M9b13k2Failure> {
  return { ok: false, error: { kind, reason, ambiguous } };
}

export function m9b13k2Sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function m9b13k2DomainDigest(
  protocol: string,
  ...parts: ReadonlyArray<string | Uint8Array>
): string {
  const digest = createHash("sha256");
  digest.update(protocol, "utf8");
  for (const part of parts) {
    digest.update("\0", "utf8");
    digest.update(part);
  }
  return digest.digest("hex");
}

export function m9b13k2CanonicalDigest(
  value: unknown,
): Result<string, M9b13k2Failure> {
  const canonical = canonicalizeJson(value);
  return canonical.ok
    ? {
        ok: true,
        value: m9b13k2Sha256(new TextEncoder().encode(canonical.value)),
      }
    : m9b13k2Failure("protocol", "m9b13k2-canonicalization-failed");
}

export function frozenM9b13k2ArtifactBytes(): Uint8Array {
  return new TextEncoder().encode(ARTIFACT_TEXT);
}

export const m9b13k2LimitsSchema = z
  .strictObject({
    maximumHttpRequests: z.literal(M9B13K2_MAXIMUM_HTTP_REQUESTS),
    maximumPutDispatches: z.literal(M9B13K2_MAXIMUM_PUT_DISPATCHES),
    maximumRevocationDispatches: z.literal(
      M9B13K2_MAXIMUM_REVOCATION_DISPATCHES,
    ),
    maximumRequestBodyBytes: z.literal(M9B13K2_MAXIMUM_REQUEST_BODY_BYTES),
    apiResponseMaximumBytes: z.literal(M9B13K2_API_RESPONSE_MAXIMUM_BYTES),
    uploadResponseMaximumBytes: z.literal(
      M9B13K2_UPLOAD_RESPONSE_MAXIMUM_BYTES,
    ),
    perRequestTimeoutMs: z.literal(M9B13K2_REQUEST_TIMEOUT_MS),
    controllerDeadlineMs: z.literal(M9B13K2_CONTROLLER_DEADLINE_MS),
    revocationDeadlineMs: z.literal(M9B13K2_REVOCATION_DEADLINE_MS),
    retries: z.literal(0),
    concurrency: z.literal(1),
    redirectPolicy: z.literal("error"),
  })
  .readonly();

export const m9b13k2ProspectiveActivationSchema = z
  .strictObject({
    protocol: z.literal(M9B13K2_ACTIVATION_PROTOCOL),
    runtimeProtocol: z.literal(M9B13K2_RUNTIME_PROTOCOL),
    reviewedCommit: m9b13k2DigestSchema,
    reviewedTree: m9b13k2DigestSchema,
    packageManifestSha256: m9b13k2DigestSchema,
    controllerImplementationSha256: m9b13k2DigestSchema,
    launcherImplementationSha256: m9b13k2DigestSchema,
    ledgerImplementationSha256: m9b13k2DigestSchema,
    transportImplementationSha256: m9b13k2DigestSchema,
    activationIdentity: m9b13k2BoundDigestSchema,
    requestIdentity: m9b13k2BoundDigestSchema,
    ledgerNamespaceCommitment: m9b13k2BoundDigestSchema,
    ledgerStoreIdentity: m9b13k2DigestSchema,
    ledgerInitialRoot: m9b13k2DigestSchema,
    projectId: z.literal(M9B13K2_PROJECT_ID),
    draftId: z.literal(M9B13K2_DRAFT_ID),
    provider: z.literal(M9B13K2_PROVIDER),
    artifactIdentity: z.literal(M9B13K2_ARTIFACT_IDENTITY),
    artifactFilename: z.literal(M9B13K2_ARTIFACT_FILENAME),
    artifactSha256: z.literal(M9B13K2_ARTIFACT_SHA256),
    artifactByteLength: z.literal(M9B13K2_ARTIFACT_BYTE_LENGTH),
    tokenId: m9b13k2TokenIdSchema,
    custodianIdentity: m9b13k2BoundDigestSchema,
    limits: m9b13k2LimitsSchema,
    ceremonyRequiresIndependentAuthorization: z.literal(true),
    revocationRequiresIndependentReceipt: z.literal(true),
  })
  .readonly();

export type M9b13k2ProspectiveActivation = z.infer<
  typeof m9b13k2ProspectiveActivationSchema
>;
