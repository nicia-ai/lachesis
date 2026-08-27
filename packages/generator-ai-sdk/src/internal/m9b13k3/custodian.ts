import {
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";

import { canonicalizeJson, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  M9B13K3_SYNTHETIC_CUSTODIAN_PROTOCOL,
  m9b13k3BoundDigestSchema,
  m9b13k3CanonicalDigest,
  type M9b13k3CustodianBinding,
  m9b13k3CustodianBindingSchema,
  m9b13k3DigestSchema,
  m9b13k3DomainDigest,
  type M9b13k3Failure,
  m9b13k3Failure,
  m9b13k3Sha256,
  m9b13k3TokenIdSchema,
} from "./protocol.js";

export const m9b13k3RevocationVerificationRequestSchema = z
  .strictObject({
    protocol: z.literal("lachesis-m9b13k3-revocation-verification/1"),
    activationIdentity: m9b13k3BoundDigestSchema,
    runtimeIdentity: m9b13k3DigestSchema,
    tokenId: m9b13k3TokenIdSchema,
    ledgerStoreIdentity: m9b13k3DigestSchema,
    ledgerRevision: z.number().int().positive(),
    ledgerRoot: m9b13k3DigestSchema,
    revocationRequestIndex: z.number().int().positive(),
    revocationReceiptDigest: m9b13k3DigestSchema,
    custodian: m9b13k3CustodianBindingSchema,
    credentialIncluded: z.literal(false),
  })
  .readonly();
export type M9b13k3RevocationVerificationRequest = z.infer<
  typeof m9b13k3RevocationVerificationRequestSchema
>;

const syntheticReceiptBodySchema = z
  .strictObject({
    protocol: z.literal(M9B13K3_SYNTHETIC_CUSTODIAN_PROTOCOL),
    conformanceOnly: z.literal(true),
    requestDigest: m9b13k3DigestSchema,
    activationIdentity: m9b13k3BoundDigestSchema,
    runtimeIdentity: m9b13k3DigestSchema,
    tokenId: m9b13k3TokenIdSchema,
    ledgerStoreIdentity: m9b13k3DigestSchema,
    ledgerRoot: m9b13k3DigestSchema,
    revocationRequestIndex: z.number().int().positive(),
    revocationReceiptDigest: m9b13k3DigestSchema,
    custodian: m9b13k3CustodianBindingSchema,
    result: z.enum(["revoked", "active", "ambiguous"]),
    issuedAtEpochMs: z.number().int().nonnegative(),
    credentialReceived: z.literal(false),
  })
  .readonly();

export const m9b13k3SyntheticCustodianReceiptSchema = syntheticReceiptBodySchema
  .unwrap()
  .safeExtend({
    receiptDigest: m9b13k3DigestSchema,
    signatureBase64Url: z.string().regex(/^[A-Za-z0-9_-]+$/u),
  })
  .readonly();
export type M9b13k3SyntheticCustodianReceipt = z.infer<
  typeof m9b13k3SyntheticCustodianReceiptSchema
>;

const authorityBrand: unique symbol = Symbol("M9b13k3SyntheticAuthority");
export type M9b13k3SyntheticCustodianAuthority = Readonly<{
  [authorityBrand]: "M9b13k3SyntheticCustodianAuthority";
}>;

type AuthorityState = Readonly<{
  binding: M9b13k3CustodianBinding;
  publicKey: KeyObject;
}>;
const authorities = new WeakMap<object, AuthorityState>();

export type M9b13k3SyntheticCustodianPrincipal = Readonly<{
  authority: M9b13k3SyntheticCustodianAuthority;
  binding: M9b13k3CustodianBinding;
  signReceipt: (
    request: M9b13k3RevocationVerificationRequest,
    result: "revoked" | "active" | "ambiguous",
    issuedAtEpochMs: number,
  ) => Result<M9b13k3SyntheticCustodianReceipt, M9b13k3Failure>;
}>;

function publicKeyEvidence(publicKey: KeyObject): Readonly<{
  fingerprint: string;
  spkiDigest: string;
}> {
  const der = publicKey.export({ type: "spki", format: "der" });
  const spkiDigest = m9b13k3Sha256(der);
  return {
    spkiDigest,
    fingerprint: m9b13k3DomainDigest(
      M9B13K3_SYNTHETIC_CUSTODIAN_PROTOCOL,
      "public-key-fingerprint",
      der,
    ),
  };
}

function bindingForPublicKey(publicKey: KeyObject): M9b13k3CustodianBinding {
  const evidence = publicKeyEvidence(publicKey);
  return m9b13k3CustodianBindingSchema.parse({
    mode: "synthetic-conformance",
    receiptProtocol: M9B13K3_SYNTHETIC_CUSTODIAN_PROTOCOL,
    custodianIdentity: `sha256:${m9b13k3DomainDigest(
      M9B13K3_SYNTHETIC_CUSTODIAN_PROTOCOL,
      "custodian-identity",
      evidence.spkiDigest,
      evidence.fingerprint,
    )}`,
    publicKeyFingerprint: evidence.fingerprint,
    publicKeySpkiDigest: evidence.spkiDigest,
  });
}

function sameBinding(
  left: M9b13k3CustodianBinding,
  right: M9b13k3CustodianBinding,
): boolean {
  return (
    left.mode === right.mode &&
    left.receiptProtocol === right.receiptProtocol &&
    left.custodianIdentity === right.custodianIdentity &&
    left.publicKeyFingerprint === right.publicKeyFingerprint &&
    left.publicKeySpkiDigest === right.publicKeySpkiDigest
  );
}

export function createSyntheticM9b13k3CustodianPrincipal(): M9b13k3SyntheticCustodianPrincipal {
  const pair = generateKeyPairSync("ed25519");
  const binding = bindingForPublicKey(pair.publicKey);
  const authority: M9b13k3SyntheticCustodianAuthority = Object.freeze({
    [authorityBrand]: "M9b13k3SyntheticCustodianAuthority",
  });
  authorities.set(authority, { binding, publicKey: pair.publicKey });
  return Object.freeze({
    authority,
    binding,
    signReceipt: (request, result, issuedAtEpochMs) => {
      const parsedRequest =
        m9b13k3RevocationVerificationRequestSchema.safeParse(request);
      if (
        !parsedRequest.success ||
        !sameBinding(parsedRequest.data.custodian, binding)
      )
        return m9b13k3Failure(
          "custodian",
          "m9b13k3-synthetic-signing-binding-rejected",
        );
      const requestDigest = m9b13k3CanonicalDigest(parsedRequest.data);
      if (!requestDigest.ok) return requestDigest;
      const body = syntheticReceiptBodySchema.safeParse({
        protocol: M9B13K3_SYNTHETIC_CUSTODIAN_PROTOCOL,
        conformanceOnly: true,
        requestDigest: requestDigest.value,
        activationIdentity: parsedRequest.data.activationIdentity,
        runtimeIdentity: parsedRequest.data.runtimeIdentity,
        tokenId: parsedRequest.data.tokenId,
        ledgerStoreIdentity: parsedRequest.data.ledgerStoreIdentity,
        ledgerRoot: parsedRequest.data.ledgerRoot,
        revocationRequestIndex: parsedRequest.data.revocationRequestIndex,
        revocationReceiptDigest: parsedRequest.data.revocationReceiptDigest,
        custodian: binding,
        result,
        issuedAtEpochMs,
        credentialReceived: false,
      });
      if (!body.success)
        return m9b13k3Failure(
          "custodian",
          "m9b13k3-synthetic-receipt-body-invalid",
        );
      const canonical = canonicalizeJson(body.data);
      const receiptDigest = m9b13k3CanonicalDigest(body.data);
      if (!canonical.ok || !receiptDigest.ok)
        return m9b13k3Failure(
          "custodian",
          "m9b13k3-synthetic-receipt-canonicalization-failed",
        );
      const signature = sign(
        null,
        new TextEncoder().encode(canonical.value),
        pair.privateKey,
      );
      return {
        ok: true,
        value: m9b13k3SyntheticCustodianReceiptSchema.parse({
          ...body.data,
          receiptDigest: receiptDigest.value,
          signatureBase64Url: signature.toString("base64url"),
        }),
      };
    },
  });
}

export function verifySyntheticM9b13k3CustodianReceipt(
  authority: M9b13k3SyntheticCustodianAuthority,
  expectedBinding: M9b13k3CustodianBinding,
  requestValue: unknown,
  receiptValue: unknown,
): Result<M9b13k3SyntheticCustodianReceipt, M9b13k3Failure> {
  const state = authorities.get(authority);
  const request =
    m9b13k3RevocationVerificationRequestSchema.safeParse(requestValue);
  const receipt =
    m9b13k3SyntheticCustodianReceiptSchema.safeParse(receiptValue);
  if (
    state === undefined ||
    !request.success ||
    !receipt.success ||
    !sameBinding(state.binding, expectedBinding) ||
    !sameBinding(request.data.custodian, expectedBinding) ||
    !sameBinding(receipt.data.custodian, expectedBinding)
  )
    return m9b13k3Failure(
      "custodian",
      "m9b13k3-custodian-authority-binding-rejected",
    );
  const requestDigest = m9b13k3CanonicalDigest(request.data);
  const { signatureBase64Url, receiptDigest, ...bodyValue } = receipt.data;
  const body = syntheticReceiptBodySchema.safeParse(bodyValue);
  const canonical = body.success ? canonicalizeJson(body.data) : undefined;
  const bodyDigest = body.success
    ? m9b13k3CanonicalDigest(body.data)
    : m9b13k3Failure("custodian", "m9b13k3-receipt-body-invalid");
  if (
    !requestDigest.ok ||
    !body.success ||
    canonical === undefined ||
    !canonical.ok ||
    !bodyDigest.ok ||
    requestDigest.value !== body.data.requestDigest ||
    bodyDigest.value !== receiptDigest ||
    body.data.activationIdentity !== request.data.activationIdentity ||
    body.data.runtimeIdentity !== request.data.runtimeIdentity ||
    body.data.tokenId !== request.data.tokenId ||
    body.data.ledgerStoreIdentity !== request.data.ledgerStoreIdentity ||
    body.data.ledgerRoot !== request.data.ledgerRoot ||
    body.data.revocationRequestIndex !== request.data.revocationRequestIndex ||
    body.data.revocationReceiptDigest !== request.data.revocationReceiptDigest
  )
    return m9b13k3Failure(
      "custodian",
      "m9b13k3-custodian-receipt-binding-rejected",
    );
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureBase64Url, "base64url");
  } catch {
    return m9b13k3Failure("custodian", "m9b13k3-signature-invalid");
  }
  return verify(
    null,
    new TextEncoder().encode(canonical.value),
    state.publicKey,
    signature,
  )
    ? { ok: true, value: receipt.data }
    : m9b13k3Failure("custodian", "m9b13k3-signature-invalid");
}

export function inspectM9b13k3LiveCustodianAuthority(): Readonly<{
  available: false;
  reason: "m9b13k3-live-custodian-requires-future-activation-capability";
}> {
  return {
    available: false,
    reason: "m9b13k3-live-custodian-requires-future-activation-capability",
  };
}

export function inspectM9b13k3PublicKeyBindingForConformance(
  publicKeyPem: string,
): Result<M9b13k3CustodianBinding, M9b13k3Failure> {
  try {
    const publicKey = createPublicKey(publicKeyPem);
    return publicKey.asymmetricKeyType === "ed25519"
      ? { ok: true, value: bindingForPublicKey(publicKey) }
      : m9b13k3Failure("custodian", "m9b13k3-public-key-type-rejected");
  } catch {
    return m9b13k3Failure("custodian", "m9b13k3-public-key-invalid");
  }
}
