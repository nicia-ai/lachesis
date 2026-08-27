import { createHash } from "node:crypto";

import { canonicalizeJson, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

export const M9B13K3_RUNTIME_PROTOCOL =
  "lachesis-m9b13k3-corrected-concrete-runtime/1" as const;
export const M9B13K3_ACTIVATION_PROTOCOL =
  "lachesis-m9b13k3-future-activation/1" as const;
export const M9B13K3_LEDGER_PROTOCOL =
  "lachesis-m9b13k3-bound-sqlite-ledger/1" as const;
export const M9B13K3_LOOPBACK_TRANSPORT_PROTOCOL =
  "lachesis-m9b13k3-loopback-conformance-transport/1" as const;
export const M9B13K3_PRODUCTION_TRANSPORT_PROTOCOL =
  "lachesis-m9b13k3-production-transport-unavailable/1" as const;
export const M9B13K3_SYNTHETIC_CUSTODIAN_PROTOCOL =
  "lachesis-m9b13k3-synthetic-custodian-receipt/1" as const;
export const M9B13K3_LIVE_CUSTODIAN_PROTOCOL =
  "lachesis-m9b13k3-live-custodian-receipt-unavailable/1" as const;
export const M9B13K3_RECONCILIATION_PROTOCOL =
  "lachesis-m9b13k3-raw-waterbutler-reconciliation/1" as const;
export const M9B13K3_FD3_PROTOCOL =
  "lachesis-m9b13k3-synthetic-fd3-frame-consistency/1" as const;
export const M9B13K3_IDENTITY_PROTOCOL =
  "lachesis-m9b13k3-source-bound-runtime-identity/1" as const;

export const M9B13K3_PROJECT_ID = "bmsda" as const;
export const M9B13K3_DRAFT_ID = "6a7619b506a607fe5f63a77d" as const;
export const M9B13K3_PROVIDER = "osfstorage" as const;
export const M9B13K3_ARTIFACT_IDENTITY =
  "1fbd9e013ac05f53c411b9e98f507d12" as const;
export const M9B13K3_ARTIFACT_FILENAME =
  "OSF-PAT-WATERBUTLER-CANARY-1fbd9e013ac05f53c411b9e98f507d12.txt" as const;
export const M9B13K3_ARTIFACT_SHA256 =
  "4ee4d970eb65bb9b8e525618ba19d4ee28dd2c1a1d0730bd9c4f3ff016134994" as const;
export const M9B13K3_ARTIFACT_BYTE_LENGTH = 245 as const;

export const M9B13K3_MAXIMUM_HTTP_REQUESTS = 18 as const;
export const M9B13K3_MAXIMUM_PUTS = 1 as const;
export const M9B13K3_MAXIMUM_REVOCATIONS = 1 as const;
export const M9B13K3_REQUEST_TIMEOUT_MS = 10_000 as const;
export const M9B13K3_CONTROLLER_DEADLINE_MS = 120_000 as const;
export const M9B13K3_REVOCATION_DEADLINE_MS = 15_000 as const;

const ARTIFACT_TEXT = `frozen identity: ${M9B13K3_ARTIFACT_IDENTITY}\nexact filename: ${M9B13K3_ARTIFACT_FILENAME}\nSYNTHETIC NON-STUDY OSF PAT WATERBUTLER CANARY\nThis file contains no scientific, operational or protected content.\n`;

export const m9b13k3DigestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .readonly();
export const m9b13k3BoundDigestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u)
  .readonly();
export const m9b13k3TokenIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/u)
  .readonly();

export type M9b13k3Failure = Readonly<{
  kind:
    | "activation"
    | "credential"
    | "custodian"
    | "deadline"
    | "identity"
    | "ledger"
    | "reconciliation"
    | "transport";
  reason: string;
  ambiguous: boolean;
}>;

export function m9b13k3Failure(
  kind: M9b13k3Failure["kind"],
  reason: string,
  ambiguous = false,
): Result<never, M9b13k3Failure> {
  return { ok: false, error: { kind, reason, ambiguous } };
}

export function m9b13k3Sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function m9b13k3DomainDigest(
  protocol: string,
  ...parts: ReadonlyArray<string | Uint8Array>
): string {
  const digest = createHash("sha256");
  digest.update(protocol, "utf8");
  for (const part of parts) {
    const bytes =
      typeof part === "string" ? new TextEncoder().encode(part) : part;
    const length = new Uint8Array(8);
    new DataView(length.buffer).setBigUint64(0, BigInt(bytes.byteLength));
    digest.update(length);
    digest.update(bytes);
  }
  return digest.digest("hex");
}

export function m9b13k3CanonicalDigest(
  value: unknown,
): Result<string, M9b13k3Failure> {
  const canonical = canonicalizeJson(value);
  return canonical.ok
    ? {
        ok: true,
        value: m9b13k3Sha256(new TextEncoder().encode(canonical.value)),
      }
    : m9b13k3Failure("identity", "m9b13k3-canonicalization-failed");
}

export function frozenM9b13k3ArtifactBytes(): Uint8Array {
  return new TextEncoder().encode(ARTIFACT_TEXT);
}

export const m9b13k3CustodianBindingSchema = z
  .strictObject({
    mode: z.enum(["synthetic-conformance", "live-unavailable"]),
    receiptProtocol: z.enum([
      M9B13K3_SYNTHETIC_CUSTODIAN_PROTOCOL,
      M9B13K3_LIVE_CUSTODIAN_PROTOCOL,
    ]),
    custodianIdentity: m9b13k3BoundDigestSchema,
    publicKeyFingerprint: m9b13k3DigestSchema,
    publicKeySpkiDigest: m9b13k3DigestSchema,
  })
  .readonly();
export type M9b13k3CustodianBinding = z.infer<
  typeof m9b13k3CustodianBindingSchema
>;

export const m9b13k3LedgerBindingSchema = z
  .strictObject({
    protocol: z.literal(M9B13K3_LEDGER_PROTOCOL),
    schemaVersion: z.literal(1),
    normalizedNamespaceCommitment: m9b13k3BoundDigestSchema,
    storeIdentity: m9b13k3DigestSchema,
    databaseIdentity: m9b13k3DigestSchema,
    anchorIdentity: m9b13k3DigestSchema,
    initialRoot: m9b13k3DigestSchema,
    activationIdentity: m9b13k3BoundDigestSchema,
    runtimeIdentity: m9b13k3DigestSchema,
    tokenId: m9b13k3TokenIdSchema,
    custodian: m9b13k3CustodianBindingSchema,
  })
  .readonly();
export type M9b13k3LedgerBinding = z.infer<typeof m9b13k3LedgerBindingSchema>;

export const m9b13k3ImplementationEntrySchema = z
  .strictObject({
    kind: z.enum([
      "source",
      "javascript",
      "declaration",
      "declaration-map",
      "source-map",
      "build-config",
      "protocol-descriptor",
    ]),
    path: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9._/-]+$/u)
      .refine((path) => !path.startsWith("/") && !path.includes("..")),
    byteLength: z.number().int().nonnegative(),
    sha256: m9b13k3DigestSchema,
  })
  .readonly();
export type M9b13k3ImplementationEntry = z.infer<
  typeof m9b13k3ImplementationEntrySchema
>;

export const m9b13k3ImplementationInventorySchema = z
  .strictObject({
    protocol: z.literal(M9B13K3_IDENTITY_PROTOCOL),
    entries: z.array(m9b13k3ImplementationEntrySchema).min(1).readonly(),
  })
  .readonly();
export type M9b13k3ImplementationInventory = z.infer<
  typeof m9b13k3ImplementationInventorySchema
>;

export function deriveM9b13k3RuntimeIdentity(value: unknown): Result<
  Readonly<{
    identity: string;
    canonicalInventory: M9b13k3ImplementationInventory;
  }>,
  M9b13k3Failure
> {
  const parsed = m9b13k3ImplementationInventorySchema.safeParse(value);
  if (!parsed.success)
    return m9b13k3Failure("identity", "m9b13k3-inventory-invalid");
  const entries = parsed.data.entries.toSorted((left, right) => {
    const leftKey = `${left.kind}\0${left.path}`;
    const rightKey = `${right.kind}\0${right.path}`;
    return leftKey.localeCompare(rightKey);
  });
  const keys = entries.map((entry) => `${entry.kind}\0${entry.path}`);
  if (new Set(keys).size !== keys.length)
    return m9b13k3Failure("identity", "m9b13k3-inventory-duplicate-path");
  const canonicalInventory = m9b13k3ImplementationInventorySchema.parse({
    protocol: M9B13K3_IDENTITY_PROTOCOL,
    entries,
  });
  const canonical = canonicalizeJson(canonicalInventory);
  return canonical.ok
    ? {
        ok: true,
        value: {
          identity: m9b13k3DomainDigest(
            M9B13K3_IDENTITY_PROTOCOL,
            canonical.value,
          ),
          canonicalInventory,
        },
      }
    : m9b13k3Failure("identity", "m9b13k3-inventory-not-canonical");
}
