import { parseJson } from "@nicia-ai/lachesis";
import { z } from "zod";

export const M9B13K1_CONTROLLER_PROTOCOL =
  "lachesis-m9b13k1-osf-pat-canary-controller/1" as const;
export const M9B13K1_ACTIVATION_PROTOCOL =
  "lachesis-m9b13k1-independent-activation-capability/1" as const;
export const M9B13K1_CREDENTIAL_CUSTODY_PROTOCOL =
  "lachesis-m9b13k1-controlled-launch-owned-fd3/1" as const;
export const M9B13K1_LEDGER_PROTOCOL =
  "lachesis-m9b13k1-durable-cas-receipt-ledger/1" as const;
export const M9B13K1_TRANSPORT_PROTOCOL =
  "lachesis-m9b13k1-bounded-abortable-http-transport/1" as const;
export const M9B13K1_REVOCATION_PROTOCOL =
  "lachesis-m9b13k1-credential-free-revocation-custodian/1" as const;
export const M9B13K1_OBJECT_RECONCILIATION_PROTOCOL =
  "lachesis-m9b13k1-stable-file-object-reconciliation/1" as const;
export const M9B13K1_AUTHORITY_UNAVAILABLE_PROTOCOL =
  "lachesis-m9b13k1-live-activation-authority-unavailable/1" as const;

export const M9B13K1_PROJECT_ID = "bmsda" as const;
export const M9B13K1_DRAFT_ID = "6a7619b506a607fe5f63a77d" as const;
export const M9B13K1_PROVIDER = "osfstorage" as const;
export const M9B13K1_REQUIRED_SCOPE = "osf.full_write" as const;
export const M9B13K1_ARTIFACT_IDENTITY =
  "1fbd9e013ac05f53c411b9e98f507d12" as const;
export const M9B13K1_ARTIFACT_FILENAME =
  "OSF-PAT-WATERBUTLER-CANARY-1fbd9e013ac05f53c411b9e98f507d12.txt" as const;
export const M9B13K1_ARTIFACT_SHA256 =
  "4ee4d970eb65bb9b8e525618ba19d4ee28dd2c1a1d0730bd9c4f3ff016134994" as const;
export const M9B13K1_ARTIFACT_BYTE_LENGTH = 245 as const;

export const M9B13K1_MAXIMUM_HTTP_REQUESTS = 18 as const;
export const M9B13K1_MAXIMUM_PUT_DISPATCHES = 1 as const;
export const M9B13K1_MAXIMUM_REVOCATION_ATTEMPTS = 1 as const;
export const M9B13K1_MAXIMUM_REQUEST_BODY_BYTES = 245 as const;
export const M9B13K1_API_RESPONSE_MAXIMUM_BYTES = 262_144 as const;
export const M9B13K1_UPLOAD_RESPONSE_MAXIMUM_BYTES = 65_536 as const;
export const M9B13K1_REQUEST_TIMEOUT_MS = 10_000 as const;
export const M9B13K1_CONTROLLER_DEADLINE_MS = 120_000 as const;
export const M9B13K1_REVOCATION_DEADLINE_MS = 15_000 as const;

const M9B13K1_ARTIFACT_TEXT = `frozen identity: ${M9B13K1_ARTIFACT_IDENTITY}\nexact filename: ${M9B13K1_ARTIFACT_FILENAME}\nSYNTHETIC NON-STUDY OSF PAT WATERBUTLER CANARY\nThis file contains no scientific, operational or protected content.\n`;

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const rawSha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const tokenIdSchema = z.string().regex(/^[a-f0-9]{24}$/u);

const limitsSchema = z.strictObject({
  maximumHttpRequests: z.literal(M9B13K1_MAXIMUM_HTTP_REQUESTS),
  maximumPutDispatches: z.literal(M9B13K1_MAXIMUM_PUT_DISPATCHES),
  maximumRevocationAttempts: z.literal(M9B13K1_MAXIMUM_REVOCATION_ATTEMPTS),
  maximumRequestBodyBytes: z.literal(M9B13K1_MAXIMUM_REQUEST_BODY_BYTES),
  apiResponseMaximumBytes: z.literal(M9B13K1_API_RESPONSE_MAXIMUM_BYTES),
  uploadResponseMaximumBytes: z.literal(M9B13K1_UPLOAD_RESPONSE_MAXIMUM_BYTES),
  perRequestTimeoutMs: z.literal(M9B13K1_REQUEST_TIMEOUT_MS),
  controllerDeadlineMs: z.literal(M9B13K1_CONTROLLER_DEADLINE_MS),
  revocationDeadlineMs: z.literal(M9B13K1_REVOCATION_DEADLINE_MS),
  retries: z.literal(0),
  concurrency: z.literal(1),
  redirectPolicy: z.literal("error"),
});

/**
 * This schema describes a prospective authority document. Passing it only
 * establishes syntax. It never constructs or conveys activation authority.
 */
export const m9b13k1StructuralCandidateSchema = z.strictObject({
  protocol: z.literal(M9B13K1_ACTIVATION_PROTOCOL),
  controllerProtocol: z.literal(M9B13K1_CONTROLLER_PROTOCOL),
  authorityKind: z.literal("independently-frozen-closure-capability"),
  activationIdentity: sha256Schema,
  requestIdentity: sha256Schema,
  correctedSourceSha256: rawSha256Schema,
  correctedTestSha256: rawSha256Schema,
  packageManifestSha256: rawSha256Schema,
  credentialCustodyProtocol: z.literal(M9B13K1_CREDENTIAL_CUSTODY_PROTOCOL),
  ledgerProtocol: z.literal(M9B13K1_LEDGER_PROTOCOL),
  ledgerImplementationIdentity: sha256Schema,
  ledgerInitialRoot: sha256Schema,
  transportProtocol: z.literal(M9B13K1_TRANSPORT_PROTOCOL),
  transportImplementationIdentity: sha256Schema,
  custodianProtocol: z.literal(M9B13K1_REVOCATION_PROTOCOL),
  custodianImplementationIdentity: sha256Schema,
  objectReconciliationProtocol: z.literal(
    M9B13K1_OBJECT_RECONCILIATION_PROTOCOL,
  ),
  tokenId: tokenIdSchema,
  expectedScope: z.literal(M9B13K1_REQUIRED_SCOPE),
  projectId: z.literal(M9B13K1_PROJECT_ID),
  draftId: z.literal(M9B13K1_DRAFT_ID),
  provider: z.literal(M9B13K1_PROVIDER),
  artifactIdentity: z.literal(M9B13K1_ARTIFACT_IDENTITY),
  artifactFilename: z.literal(M9B13K1_ARTIFACT_FILENAME),
  artifactSha256: z.literal(M9B13K1_ARTIFACT_SHA256),
  artifactByteLength: z.literal(M9B13K1_ARTIFACT_BYTE_LENGTH),
  limits: limitsSchema,
});

export type M9b13k1StructuralCandidate = z.infer<
  typeof m9b13k1StructuralCandidateSchema
>;

export const m9b13k1StructuralInspectionSchema = z.strictObject({
  protocol: z.literal(M9B13K1_AUTHORITY_UNAVAILABLE_PROTOCOL),
  structurallyValid: z.boolean(),
  authorityAvailable: z.literal(false),
  effectAdmission: z.literal("denied"),
  reason: z.enum([
    "m9b13k1-structural-candidate-invalid",
    "m9b13k1-structural-candidate-valid-but-nonauthoritative",
  ]),
});

export type M9b13k1StructuralInspection = z.infer<
  typeof m9b13k1StructuralInspectionSchema
>;

export const m9b13k1LiveOutcomeSchema = z.strictObject({
  protocol: z.literal(M9B13K1_CONTROLLER_PROTOCOL),
  decision: z.literal("m9b13k1-correction-no-go"),
  terminalState: z.literal("authority-unavailable-zero-effect-stop"),
  reason: z.literal("m9b13k1-correction-no-go"),
  authorityProtocol: z.literal(M9B13K1_AUTHORITY_UNAVAILABLE_PROTOCOL),
  authorityAvailable: z.literal(false),
  candidateInspected: z.literal(false),
  effectAdmission: z.literal("denied-before-effect-subsystem-construction"),
  credentialAccess: z.literal("none"),
  ledgerAccess: z.literal("none"),
  transportAccess: z.literal("none"),
  custodianAccess: z.literal("none"),
  externalEffects: z.literal("none-by-construction"),
});

export type M9b13k1LiveOutcome = z.infer<typeof m9b13k1LiveOutcomeSchema>;

// A future positive capability must be introduced by a separately reviewed,
// checksum-bound change. Ordinary callers cannot replace or populate this
// module-private constant.
const LIVE_ACTIVATION_AUTHORITY = null;

export function frozenM9b13k1ArtifactBytes(): Uint8Array {
  return new TextEncoder().encode(M9B13K1_ARTIFACT_TEXT);
}

export function inspectM9b13k1StructuralCandidateJson(
  candidateJson: string,
): M9b13k1StructuralInspection {
  const parsed = parseJson(candidateJson);
  const structurallyValid =
    parsed.ok &&
    m9b13k1StructuralCandidateSchema.safeParse(parsed.value).success;
  return {
    protocol: M9B13K1_AUTHORITY_UNAVAILABLE_PROTOCOL,
    structurallyValid,
    authorityAvailable: false,
    effectAdmission: "denied",
    reason: structurallyValid
      ? "m9b13k1-structural-candidate-valid-but-nonauthoritative"
      : "m9b13k1-structural-candidate-invalid",
  };
}

/**
 * The only live entry point in M9b.13k.1. It intentionally does not inspect
 * its argument or construct any credential, ledger, transport, or custodian.
 */
export function runM9b13k1OsfPatCanaryController(
  candidate: unknown,
): Promise<M9b13k1LiveOutcome> {
  void candidate;
  void LIVE_ACTIVATION_AUTHORITY;
  return Promise.resolve({
    protocol: M9B13K1_CONTROLLER_PROTOCOL,
    decision: "m9b13k1-correction-no-go",
    terminalState: "authority-unavailable-zero-effect-stop",
    reason: "m9b13k1-correction-no-go",
    authorityProtocol: M9B13K1_AUTHORITY_UNAVAILABLE_PROTOCOL,
    authorityAvailable: false,
    candidateInspected: false,
    effectAdmission: "denied-before-effect-subsystem-construction",
    credentialAccess: "none",
    ledgerAccess: "none",
    transportAccess: "none",
    custodianAccess: "none",
    externalEffects: "none-by-construction",
  });
}
