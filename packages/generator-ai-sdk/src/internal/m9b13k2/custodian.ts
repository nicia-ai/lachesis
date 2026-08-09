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
  M9B13K2_CUSTODIAN_PROTOCOL,
  M9B13K2_REVOCATION_PROTOCOL,
  M9B13K2_SYNTHETIC_PROTOCOL,
  m9b13k2BoundDigestSchema,
  m9b13k2CanonicalDigest,
  m9b13k2DigestSchema,
  m9b13k2DomainDigest,
  type M9b13k2Failure,
  m9b13k2Failure,
  m9b13k2TokenIdSchema,
} from "./protocol.js";

export const m9b13k2RevocationVerificationRequestSchema = z
  .strictObject({
    protocol: z.literal(M9B13K2_REVOCATION_PROTOCOL),
    activationIdentity: m9b13k2BoundDigestSchema,
    requestIdentity: m9b13k2BoundDigestSchema,
    tokenId: m9b13k2TokenIdSchema,
    ledgerStoreIdentity: m9b13k2DigestSchema,
    ledgerRevision: z.number().int().positive(),
    ledgerRoot: m9b13k2DigestSchema,
    revocationRequestIndex: z.number().int().positive(),
    revocationReceiptDigest: m9b13k2DigestSchema,
    credentialIncluded: z.literal(false),
  })
  .readonly();
export type M9b13k2RevocationVerificationRequest = z.infer<
  typeof m9b13k2RevocationVerificationRequestSchema
>;

const custodianReceiptBodySchema = z
  .strictObject({
    protocol: z.literal(M9B13K2_CUSTODIAN_PROTOCOL),
    custodianIdentity: m9b13k2BoundDigestSchema,
    requestDigest: m9b13k2DigestSchema,
    activationIdentity: m9b13k2BoundDigestSchema,
    tokenId: m9b13k2TokenIdSchema,
    ledgerStoreIdentity: m9b13k2DigestSchema,
    ledgerRoot: m9b13k2DigestSchema,
    revocationRequestIndex: z.number().int().positive(),
    revocationReceiptDigest: m9b13k2DigestSchema,
    result: z.enum(["revoked", "active", "ambiguous"]),
    issuedAtEpochMs: z.number().int().nonnegative(),
    signatureAlgorithm: z.literal("Ed25519"),
    publicKeyFingerprint: m9b13k2DigestSchema,
    syntheticConformanceOnly: z.boolean(),
    credentialReceived: z.literal(false),
  })
  .readonly();

export const m9b13k2CustodianReceiptSchema = custodianReceiptBodySchema
  .unwrap()
  .safeExtend({
    signatureBase64Url: z.string().regex(/^[A-Za-z0-9_-]+$/u),
    receiptDigest: m9b13k2DigestSchema,
  })
  .readonly();
export type M9b13k2CustodianReceipt = z.infer<
  typeof m9b13k2CustodianReceiptSchema
>;

const authorityBrand: unique symbol = Symbol("M9b13k2CustodianAuthority");
export type M9b13k2CustodianAuthority = Readonly<{
  [authorityBrand]: "M9b13k2CustodianAuthority";
}>;
type AuthorityState = Readonly<{
  custodianIdentity: string;
  publicKey: KeyObject;
  publicKeyFingerprint: string;
  syntheticConformanceOnly: boolean;
}>;
const authorities = new WeakMap<object, AuthorityState>();

function publicKeyFingerprint(publicKey: KeyObject): string {
  return m9b13k2DomainDigest(
    M9B13K2_CUSTODIAN_PROTOCOL,
    publicKey.export({ type: "spki", format: "der" }),
  );
}

function makeAuthority(
  publicKey: KeyObject,
  custodianIdentity: string,
  syntheticConformanceOnly: boolean,
): Result<M9b13k2CustodianAuthority, M9b13k2Failure> {
  const identity = m9b13k2BoundDigestSchema.safeParse(custodianIdentity);
  if (!identity.success || publicKey.asymmetricKeyType !== "ed25519")
    return m9b13k2Failure("custodian", "m9b13k2-custodian-authority-invalid");
  const authority: M9b13k2CustodianAuthority = Object.freeze({
    [authorityBrand]: "M9b13k2CustodianAuthority",
  });
  authorities.set(authority, {
    custodianIdentity: identity.data,
    publicKey,
    publicKeyFingerprint: publicKeyFingerprint(publicKey),
    syntheticConformanceOnly,
  });
  return { ok: true, value: authority };
}

/**
 * Future activation capsules may call this only with their checksum-bound
 * public key and identity. The effect controller never accepts this authority.
 */
export function createM9b13k2CustodianAuthority(
  publicKeyPem: string,
  custodianIdentity: string,
): Result<M9b13k2CustodianAuthority, M9b13k2Failure> {
  try {
    return makeAuthority(
      createPublicKey(publicKeyPem),
      custodianIdentity,
      false,
    );
  } catch {
    return m9b13k2Failure("custodian", "m9b13k2-custodian-public-key-invalid");
  }
}

export type M9b13k2SyntheticCustodianPrincipal = Readonly<{
  protocol: typeof M9B13K2_SYNTHETIC_PROTOCOL;
  authority: M9b13k2CustodianAuthority;
  custodianIdentity: string;
  signReceipt: (
    request: M9b13k2RevocationVerificationRequest,
    result: "revoked" | "active" | "ambiguous",
    issuedAtEpochMs: number,
  ) => Result<M9b13k2CustodianReceipt, M9b13k2Failure>;
}>;

export function createSyntheticM9b13k2CustodianPrincipal(): Result<
  M9b13k2SyntheticCustodianPrincipal,
  M9b13k2Failure
> {
  const pair = generateKeyPairSync("ed25519");
  const fingerprint = publicKeyFingerprint(pair.publicKey);
  const custodianIdentity = `sha256:${m9b13k2DomainDigest(
    M9B13K2_SYNTHETIC_PROTOCOL,
    "custodian",
    fingerprint,
  )}`;
  const authority = makeAuthority(pair.publicKey, custodianIdentity, true);
  if (!authority.ok) return authority;
  return {
    ok: true,
    value: {
      protocol: M9B13K2_SYNTHETIC_PROTOCOL,
      authority: authority.value,
      custodianIdentity,
      signReceipt: (request, result, issuedAtEpochMs) => {
        const parsedRequest =
          m9b13k2RevocationVerificationRequestSchema.safeParse(request);
        if (!parsedRequest.success)
          return m9b13k2Failure(
            "custodian",
            "m9b13k2-custodian-request-invalid",
          );
        const requestDigest = m9b13k2CanonicalDigest(parsedRequest.data);
        if (!requestDigest.ok) return requestDigest;
        const body = custodianReceiptBodySchema.safeParse({
          protocol: M9B13K2_CUSTODIAN_PROTOCOL,
          custodianIdentity,
          requestDigest: requestDigest.value,
          activationIdentity: parsedRequest.data.activationIdentity,
          tokenId: parsedRequest.data.tokenId,
          ledgerStoreIdentity: parsedRequest.data.ledgerStoreIdentity,
          ledgerRoot: parsedRequest.data.ledgerRoot,
          revocationRequestIndex: parsedRequest.data.revocationRequestIndex,
          revocationReceiptDigest: parsedRequest.data.revocationReceiptDigest,
          result,
          issuedAtEpochMs,
          signatureAlgorithm: "Ed25519",
          publicKeyFingerprint: fingerprint,
          syntheticConformanceOnly: true,
          credentialReceived: false,
        });
        if (!body.success)
          return m9b13k2Failure(
            "custodian",
            "m9b13k2-custodian-receipt-body-invalid",
          );
        const canonical = canonicalizeJson(body.data);
        const receiptDigest = m9b13k2CanonicalDigest(body.data);
        if (!canonical.ok || !receiptDigest.ok)
          return m9b13k2Failure(
            "custodian",
            "m9b13k2-custodian-receipt-canonicalization-failed",
          );
        const signature = sign(
          null,
          new TextEncoder().encode(canonical.value),
          pair.privateKey,
        );
        return {
          ok: true,
          value: m9b13k2CustodianReceiptSchema.parse({
            ...body.data,
            signatureBase64Url: signature.toString("base64url"),
            receiptDigest: receiptDigest.value,
          }),
        };
      },
    },
  };
}

export function verifyM9b13k2CustodianReceipt(
  authority: M9b13k2CustodianAuthority,
  request: M9b13k2RevocationVerificationRequest,
  receipt: M9b13k2CustodianReceipt,
): Result<M9b13k2CustodianReceipt, M9b13k2Failure> {
  const authorityState = authorities.get(authority);
  const parsedRequest =
    m9b13k2RevocationVerificationRequestSchema.safeParse(request);
  const parsedReceipt = m9b13k2CustodianReceiptSchema.safeParse(receipt);
  if (
    authorityState === undefined ||
    !parsedRequest.success ||
    !parsedReceipt.success
  )
    return m9b13k2Failure(
      "custodian",
      "m9b13k2-custodian-verification-envelope-invalid",
    );
  const requestDigest = m9b13k2CanonicalDigest(parsedRequest.data);
  const { signatureBase64Url, receiptDigest, ...bodyValue } =
    parsedReceipt.data;
  const body = custodianReceiptBodySchema.safeParse(bodyValue);
  const bodyDigest = body.success
    ? m9b13k2CanonicalDigest(body.data)
    : m9b13k2Failure("custodian", "m9b13k2-custodian-receipt-body-invalid");
  const canonical = body.success ? canonicalizeJson(body.data) : undefined;
  if (
    !requestDigest.ok ||
    !body.success ||
    !bodyDigest.ok ||
    canonical === undefined ||
    !canonical.ok ||
    bodyDigest.value !== receiptDigest ||
    body.data.requestDigest !== requestDigest.value ||
    body.data.custodianIdentity !== authorityState.custodianIdentity ||
    body.data.publicKeyFingerprint !== authorityState.publicKeyFingerprint ||
    body.data.syntheticConformanceOnly !==
      authorityState.syntheticConformanceOnly ||
    body.data.activationIdentity !== parsedRequest.data.activationIdentity ||
    body.data.tokenId !== parsedRequest.data.tokenId ||
    body.data.ledgerStoreIdentity !== parsedRequest.data.ledgerStoreIdentity ||
    body.data.ledgerRoot !== parsedRequest.data.ledgerRoot ||
    body.data.revocationRequestIndex !==
      parsedRequest.data.revocationRequestIndex ||
    body.data.revocationReceiptDigest !==
      parsedRequest.data.revocationReceiptDigest
  )
    return m9b13k2Failure(
      "custodian",
      "m9b13k2-custodian-receipt-binding-invalid",
    );
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureBase64Url, "base64url");
  } catch {
    return m9b13k2Failure("custodian", "m9b13k2-custodian-signature-invalid");
  }
  return verify(
    null,
    new TextEncoder().encode(canonical.value),
    authorityState.publicKey,
    signature,
  )
    ? { ok: true, value: parsedReceipt.data }
    : m9b13k2Failure("custodian", "m9b13k2-custodian-signature-invalid");
}
