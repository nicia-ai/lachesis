import { createHash } from "node:crypto";
import { isIP } from "node:net";

import type { Result } from "@nicia-ai/lachesis";
import { z } from "zod";

export const M9B13C_PROTOCOLS = Object.freeze({
  boundary: "lachesis-m9b13c-offline-acquisition-boundary@1.0.0" as const,
  network: "lachesis-m9b13c-intercepted-network-boundary/1" as const,
  git: "lachesis-m9b13c-git-object-closure/1" as const,
  bytes: "lachesis-m9b13c-byte-accounting/1" as const,
  openpgp: "lachesis-m9b13c-openpgp-status-policy/1" as const,
  sbom: "lachesis-m9b13c-independent-sbom-comparison/1" as const,
  quarantine: "lachesis-m9b13c-quarantine-decision/1" as const,
  destination: "lachesis-m9b13c-destination-admission/1" as const,
});

export const M9B13C_QUARANTINE =
  "quarantined-supply-chain-evidence-insufficient" as const;

export const M9B13C_DESTINATION =
  "/Users/paul/orgs/nicia/lachesis-private/m9b13c-oci-acquisition/v1/docker.io/library/node/24.18.1-bookworm-slim/linux-arm64-v8" as const;

export const M9B13C_ALLOWED_HOSTS = Object.freeze([
  "api.github.com",
  "auth.docker.io",
  "github.com",
  "nodejs.org",
  "production.cloudflare.docker.com",
  "raw.githubusercontent.com",
  "registry-1.docker.io",
] as const);

export const M9B13C_BYTE_LIMITS = Object.freeze({
  perResponseHeaderBytes: 32_768,
  aggregateStageABodyBytes: 32_000_000,
  aggregateRegistryBodyBytes: 100_000_000,
  aggregateArchiveBytes: 512_000_000,
  maximumRequests: 64,
  maximumRedirects: 8,
  knownRegistryBytes: 82_785_952,
  registryHeadroomBytes: 17_214_048,
  responseBodyBytes: Object.freeze({
    "auth-token": 65_536,
    "git-commit": 1_048_576,
    "git-tree": 4_194_304,
    "git-blob": 8_388_608,
    "node-signed-manifest": 1_048_576,
    "verification-key": 1_048_576,
    "registry-manifest": 4_194_304,
    "registry-config": 4_194_304,
    "registry-layer": 64_000_000,
    "attestation-body": 8_388_608,
  }),
});

export type M9b13cFailure = Readonly<{
  kind: "m9b13c-quarantine";
  disposition: typeof M9B13C_QUARANTINE;
  reason: string;
}>;

function quarantine(reason: string): Result<never, M9b13cFailure> {
  return {
    ok: false,
    error: {
      kind: "m9b13c-quarantine",
      disposition: M9B13C_QUARANTINE,
      reason,
    },
  };
}

const prohibitedProxyKeys = new Set(
  [
    "all_proxy",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "npm_config_proxy",
    "npm_config_https_proxy",
    "ssl_cert_dir",
    "ssl_cert_file",
    "node_extra_ca_certs",
  ].map((key) => key.toLowerCase()),
);

const prohibitedDockerKeys = new Set(
  [
    "docker_config",
    "docker_context",
    "docker_host",
    "docker_tls_verify",
    "registry_auth_file",
  ].map((key) => key.toLowerCase()),
);

function parseIpv4(address: string): ReadonlyArray<number> | undefined {
  if (isIP(address) !== 4) return undefined;
  const octets = address.split(".").map(Number);
  return octets.length === 4 ? octets : undefined;
}

function isPublicIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (octets === undefined) return false;
  const [a = -1, b = -1] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && [0, 168].includes(b)) return false;
  if (a === 192 && b === 88 && octets[2] === 99) return false;
  if (a === 198 && [18, 19, 51].includes(b)) return false;
  if (a === 203 && b === 0 && octets[2] === 113) return false;
  return true;
}

export function isM9b13cPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version !== 6) return false;
  const normalized = address.toLowerCase();
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:") ||
    normalized.startsWith("2001:10:")
  )
    return false;
  if (normalized.startsWith("::ffff:"))
    return isPublicIpv4(normalized.slice("::ffff:".length));
  const first = Number.parseInt(normalized.split(":")[0] ?? "", 16);
  return Number.isFinite(first) && first >= 0x2000 && first <= 0x3fff;
}

const networkAttemptSchema = z
  .strictObject({
    url: z.string(),
    sni: z.string(),
    certificateChainValid: z.boolean(),
    certificateHostnameValid: z.boolean(),
    dnsAnswers: z.string().array().readonly(),
    peerAddress: z.string(),
    proxyEnvironmentKeys: z.string().array().readonly(),
    systemProxyConfigured: z.boolean(),
    ambientDockerPaths: z.string().array().readonly(),
    ambientEnvironmentKeys: z.string().array().readonly(),
    requestOrdinal: z.number().int().positive(),
    redirectFromHost: z.string().nullable(),
    redirectDigest: z.string().nullable(),
  })
  .readonly();

export type M9b13cNetworkAttempt = z.infer<typeof networkAttemptSchema>;

const frozenDigests = new Set([
  "sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7",
  "sha256:c39335f45d6d5b2a5be95b0f1a63e57cca4e9e36cc69b313c1ad5472b13a1e3",
  "sha256:f3c062ad822adadf8f41d1bfaa2a25cce3fd81800fc2a2cf2264307b8c77ae23",
  "sha256:1c261b8cd71d78fcdc0507b08bc7156a29785b92f0d3496861455a598bcc042d",
  "sha256:53bb9e501f1803aca595be8d902a62cea6bf4d996ce6f7dfe16c1c97be343e6c",
  "sha256:ab40f635d656bc78edba5f9d146f84446f9726581f8b6d0107bb4829aaa20f4a",
  "sha256:78c0f71ad86cbdcf4792fbde7c7ad8ed4ec0d0928e23304150f912fc28e8f7a3",
  "sha256:8055ce4d148bba236fda7c9bcd5eee50b7f1459ee71e6dadcd6c4583373b3618",
  "sha256:1930f839b9269e060fc3b6e12831c0cf685409855d3b2c80accf5bfa561da2c1",
  "sha256:eaa2172dacb9b1759f08a5c09e17877017373536a23f5a0ca1abeb68b8355d50",
  "sha256:582f962d2a1af162c7927de3b356d08961575a2b32aee3b39ea733f5b5ce919c",
  "sha256:792f6e366cff5fff17d77e82eb8b3e52e37b7f83ee3f80cf0036ff439baa9b15",
]);

function allowedPath(host: string, pathname: string): boolean {
  switch (host) {
    case "auth.docker.io":
      return pathname === "/token";
    case "registry-1.docker.io":
      return /^\/v2\/library\/node\/(manifests|blobs)\/[A-Za-z0-9:._-]+$/u.test(
        pathname,
      );
    case "production.cloudflare.docker.com":
      return pathname.length > 1;
    case "api.github.com":
      return /^\/repos\/(nodejs\/docker-node|nodejs\/release-keys|docker-library\/official-images)\/git\/(commits|trees|blobs)\/[0-9a-f]{40}$/u.test(
        pathname,
      );
    case "github.com":
      return pathname === "/web-flow.gpg";
    case "nodejs.org":
      return pathname === "/dist/v24.18.1/SHASUMS256.txt.asc";
    case "raw.githubusercontent.com":
      return (
        pathname ===
          "/nodejs/docker-node/53252eea9caacaa50bdf58f4d34f0bff8d259999/24/bookworm-slim/Dockerfile" ||
        pathname ===
          "/nodejs/release-keys/b28073028e6d6855cfb53bf7fa0137599c01f967/gpg-only-active-keys/pubring.kbx" ||
        pathname ===
          "/docker-library/official-images/baca6de4f5be548b9b818fa2ca5a1d1d9e66f309/library/node"
      );
  }
  return false;
}

export function validateM9b13cNetworkAttempt(
  input: unknown,
): Result<true, M9b13cFailure> {
  const parsed = networkAttemptSchema.safeParse(input);
  if (!parsed.success) return quarantine("m9b13c:malformed-network-attempt");
  const attempt = parsed.data;
  let url: URL;
  try {
    url = new URL(attempt.url);
  } catch {
    return quarantine("m9b13c:invalid-request-url");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443")
  )
    return quarantine("m9b13c:https-boundary-violation");
  const host = url.hostname.toLowerCase();
  if (!M9B13C_ALLOWED_HOSTS.some((allowed) => allowed === host))
    return quarantine("m9b13c:unlisted-network-host");
  if (!allowedPath(host, url.pathname))
    return quarantine("m9b13c:unlisted-network-path");
  if (attempt.sni.toLowerCase() !== host)
    return quarantine("m9b13c:tls-sni-mismatch");
  if (!attempt.certificateChainValid || !attempt.certificateHostnameValid)
    return quarantine("m9b13c:tls-certificate-invalid");
  if (
    attempt.proxyEnvironmentKeys.some((key) =>
      prohibitedProxyKeys.has(key.toLowerCase()),
    ) ||
    attempt.systemProxyConfigured
  )
    return quarantine("m9b13c:proxy-configuration-present");
  if (
    attempt.ambientDockerPaths.length !== 0 ||
    attempt.ambientEnvironmentKeys.some((key) =>
      prohibitedDockerKeys.has(key.toLowerCase()),
    )
  )
    return quarantine("m9b13c:ambient-docker-configuration-present");
  if (
    attempt.dnsAnswers.length === 0 ||
    attempt.dnsAnswers.some((address) => !isM9b13cPublicAddress(address))
  )
    return quarantine("m9b13c:nonpublic-or-empty-dns-answer");
  if (
    !isM9b13cPublicAddress(attempt.peerAddress) ||
    !attempt.dnsAnswers.includes(attempt.peerAddress)
  )
    return quarantine("m9b13c:peer-address-not-in-validated-dns-set");
  if (attempt.requestOrdinal > M9B13C_BYTE_LIMITS.maximumRequests)
    return quarantine("m9b13c:request-count-overflow");
  if (attempt.redirectFromHost !== null) {
    if (
      attempt.redirectFromHost !== "registry-1.docker.io" ||
      host !== "production.cloudflare.docker.com" ||
      attempt.redirectDigest === null ||
      !frozenDigests.has(attempt.redirectDigest)
    )
      return quarantine("m9b13c:redirect-boundary-violation");
  } else if (host === "production.cloudflare.docker.com") {
    return quarantine("m9b13c:unbound-registry-redirect");
  }
  return { ok: true, value: true };
}

const bearerResponseSchema = z
  .strictObject({
    token: z.string().min(1).max(16_384),
    expires_in: z.number().int().positive().max(300),
    issued_at: z.iso.datetime({ offset: true }),
    service: z.literal("registry.docker.io"),
    scope: z.literal("repository:library/node:pull"),
    actions: z.tuple([z.literal("pull")]),
    logged: z.literal(false),
    persisted: z.literal(false),
    discardedAfterUse: z.literal(true),
  })
  .readonly();

export function validateM9b13cBearerResponse(
  input: unknown,
): Result<true, M9b13cFailure> {
  const parsed = bearerResponseSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: true }
    : quarantine("m9b13c:invalid-anonymous-bearer-response");
}

export type M9b13cInterceptedTransport = Readonly<{
  kind: string;
  send: (attempt: M9b13cNetworkAttempt) => Promise<Readonly<{ bytes: number }>>;
}>;

export async function runM9b13cInterceptedRequests(
  attempts: ReadonlyArray<M9b13cNetworkAttempt>,
  transport: M9b13cInterceptedTransport,
): Promise<Result<number, M9b13cFailure>> {
  if (transport.kind !== "m9b13c-fully-intercepted-transport")
    return quarantine("m9b13c:nonintercepted-transport-forbidden");
  let bytes = 0;
  for (const attempt of attempts) {
    const validated = validateM9b13cNetworkAttempt(attempt);
    if (!validated.ok) return validated;
    const response = await transport.send(attempt);
    bytes += response.bytes;
  }
  return { ok: true, value: bytes };
}

const responseClassSchema = z.enum([
  "auth-token",
  "git-commit",
  "git-tree",
  "git-blob",
  "node-signed-manifest",
  "verification-key",
  "registry-manifest",
  "registry-config",
  "registry-layer",
  "attestation-body",
]);

type ResponseClass = z.infer<typeof responseClassSchema>;

export type M9b13cByteState = Readonly<{
  requestCount: number;
  redirectCount: number;
  stageABodyBytes: number;
  registryBodyBytes: number;
  archiveBytes: number;
}>;

export const M9B13C_EMPTY_BYTE_STATE: M9b13cByteState = Object.freeze({
  requestCount: 0,
  redirectCount: 0,
  stageABodyBytes: 0,
  registryBodyBytes: 0,
  archiveBytes: 0,
});

export type M9b13cResponseAccounting = Readonly<{
  responseClass: ResponseClass;
  headerBytes: number;
  bodyChunks: ReadonlyArray<number>;
  declaredBodyBytes: number;
  stageA: boolean;
  registry: boolean;
  redirect: boolean;
}>;

export function accountM9b13cResponse(
  state: M9b13cByteState,
  response: M9b13cResponseAccounting,
): Result<M9b13cByteState, M9b13cFailure> {
  const parsedClass = responseClassSchema.safeParse(response.responseClass);
  if (!parsedClass.success)
    return quarantine("m9b13c:unrecognized-response-class");
  if (
    !Number.isSafeInteger(response.headerBytes) ||
    response.headerBytes < 0 ||
    response.headerBytes > M9B13C_BYTE_LIMITS.perResponseHeaderBytes
  )
    return quarantine("m9b13c:response-header-overflow");
  const requestCount = state.requestCount + 1;
  const redirectCount = state.redirectCount + (response.redirect ? 1 : 0);
  if (requestCount > M9B13C_BYTE_LIMITS.maximumRequests)
    return quarantine("m9b13c:request-count-overflow");
  if (redirectCount > M9B13C_BYTE_LIMITS.maximumRedirects)
    return quarantine("m9b13c:redirect-count-overflow");
  const classLimit = M9B13C_BYTE_LIMITS.responseBodyBytes[parsedClass.data];
  let bodyBytes = 0;
  let stageABodyBytes = state.stageABodyBytes;
  let registryBodyBytes = state.registryBodyBytes;
  for (const chunk of response.bodyChunks) {
    if (!Number.isSafeInteger(chunk) || chunk < 0)
      return quarantine("m9b13c:malformed-stream-size");
    bodyBytes += chunk;
    if (bodyBytes > classLimit)
      return quarantine("m9b13c:response-body-overflow");
    if (response.stageA) {
      stageABodyBytes += chunk;
      if (stageABodyBytes > M9B13C_BYTE_LIMITS.aggregateStageABodyBytes)
        return quarantine("m9b13c:stage-a-aggregate-overflow");
    }
    if (response.registry) {
      registryBodyBytes += chunk;
      if (registryBodyBytes > M9B13C_BYTE_LIMITS.aggregateRegistryBodyBytes)
        return quarantine("m9b13c:registry-aggregate-overflow");
    }
  }
  if (bodyBytes !== response.declaredBodyBytes)
    return quarantine("m9b13c:descriptor-size-mismatch");
  return {
    ok: true,
    value: {
      requestCount,
      redirectCount,
      stageABodyBytes,
      registryBodyBytes,
      archiveBytes: state.archiveBytes,
    },
  };
}

export function accountM9b13cArchiveChunks(
  state: M9b13cByteState,
  chunks: ReadonlyArray<number>,
): Result<M9b13cByteState, M9b13cFailure> {
  let archiveBytes = state.archiveBytes;
  for (const chunk of chunks) {
    if (!Number.isSafeInteger(chunk) || chunk < 0)
      return quarantine("m9b13c:malformed-archive-size");
    archiveBytes += chunk;
    if (archiveBytes > M9B13C_BYTE_LIMITS.aggregateArchiveBytes)
      return quarantine("m9b13c:archive-overflow-before-sealing");
  }
  return { ok: true, value: { ...state, archiveBytes } };
}

function sha1GitObject(
  type: "blob" | "commit" | "tree",
  bytes: Uint8Array,
): string {
  return createHash("sha1")
    .update(`${type} ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type TreeEntry = Readonly<{ mode: string; name: string; objectId: string }>;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function parseTree(
  bytes: Uint8Array,
): Result<ReadonlyArray<TreeEntry>, M9b13cFailure> {
  const entries: Array<TreeEntry> = [];
  const names = new Set<string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;
  try {
    while (offset < bytes.byteLength) {
      const space = bytes.indexOf(0x20, offset);
      const nul = bytes.indexOf(0, space + 1);
      if (space <= offset || nul <= space || nul + 21 > bytes.byteLength)
        return quarantine("m9b13c:malformed-git-tree");
      const mode = decoder.decode(bytes.subarray(offset, space));
      const name = decoder.decode(bytes.subarray(space + 1, nul));
      if (
        name === "" ||
        name === "." ||
        name === ".." ||
        name.includes("/") ||
        names.has(name)
      )
        return quarantine("m9b13c:ambiguous-git-tree-entry");
      names.add(name);
      entries.push({
        mode,
        name,
        objectId: hex(bytes.subarray(nul + 1, nul + 21)),
      });
      offset = nul + 21;
    }
  } catch {
    return quarantine("m9b13c:malformed-git-tree-encoding");
  }
  return { ok: true, value: entries };
}

export type M9b13cGitBinding = Readonly<{
  repository: string;
  commitId: string;
  requiredPath: ReadonlyArray<string>;
  requiredBlobId: string;
  requiredBlobSha256: string;
  requiredMode: "100644";
  expectedRootTreeId: string | null;
}>;

export type M9b13cGitObjects = Readonly<{
  repository: string;
  commitBytes: Uint8Array;
  trees: ReadonlyMap<string, Uint8Array>;
  blobs: ReadonlyMap<string, Uint8Array>;
}>;

export function verifyM9b13cGitClosure(
  binding: M9b13cGitBinding,
  objects: M9b13cGitObjects,
): Result<true, M9b13cFailure> {
  if (objects.repository !== binding.repository)
    return quarantine("m9b13c:git-repository-substitution");
  if (sha1GitObject("commit", objects.commitBytes) !== binding.commitId)
    return quarantine("m9b13c:git-commit-substitution");
  const commitText = new TextDecoder("utf-8", { fatal: true }).decode(
    objects.commitBytes,
  );
  const treeLine = commitText
    .split("\n")
    .find((line) => line.startsWith("tree "));
  if (treeLine === undefined || !/^tree [0-9a-f]{40}$/u.test(treeLine))
    return quarantine("m9b13c:malformed-git-commit-tree");
  let treeId = treeLine.slice("tree ".length);
  if (
    binding.expectedRootTreeId !== null &&
    treeId !== binding.expectedRootTreeId
  )
    return quarantine("m9b13c:git-root-tree-substitution");
  for (const [index, segment] of binding.requiredPath.entries()) {
    const treeBytes = objects.trees.get(treeId);
    if (treeBytes === undefined || sha1GitObject("tree", treeBytes) !== treeId)
      return quarantine("m9b13c:git-tree-substitution");
    const parsed = parseTree(treeBytes);
    if (!parsed.ok) return parsed;
    const matches = parsed.value.filter((entry) => entry.name === segment);
    if (matches.length !== 1)
      return quarantine("m9b13c:git-required-path-mismatch");
    const entry = matches[0];
    if (entry === undefined)
      return quarantine("m9b13c:git-required-path-mismatch");
    const final = index === binding.requiredPath.length - 1;
    if (final) {
      if (entry.mode !== binding.requiredMode)
        return quarantine("m9b13c:git-final-mode-mismatch");
      if (entry.objectId !== binding.requiredBlobId)
        return quarantine("m9b13c:git-blob-substitution");
      const blob = objects.blobs.get(entry.objectId);
      if (
        blob === undefined ||
        sha1GitObject("blob", blob) !== binding.requiredBlobId ||
        sha256(blob) !== binding.requiredBlobSha256
      )
        return quarantine("m9b13c:git-blob-substitution");
    } else {
      if (entry.mode !== "40000")
        return quarantine(
          entry.mode === "120000" || entry.mode === "160000"
            ? "m9b13c:git-symlink-or-submodule-forbidden"
            : "m9b13c:git-intermediate-mode-mismatch",
        );
      treeId = entry.objectId;
    }
  }
  return { ok: true, value: true };
}

const fatalGpgStatuses = new Set([
  "BADSIG",
  "ERRSIG",
  "NO_PUBKEY",
  "EXPKEYSIG",
  "EXPSIG",
  "REVKEYSIG",
  "KEYREVOKED",
]);

const allowedGpgStatuses = new Set([
  "NEWSIG",
  "KEY_CONSIDERED",
  "SIG_ID",
  "GOODSIG",
  "VALIDSIG",
  "TRUST_UNDEFINED",
  "TRUST_NEVER",
  "TRUST_MARGINAL",
  "TRUST_FULLY",
  "TRUST_ULTIMATE",
]);

export function validateM9b13cGpgStatus(
  status: string,
  expectedSigningFingerprint: string,
  expectedPrimaryFingerprint: string,
): Result<true, M9b13cFailure> {
  const validSignatures: ReadonlyArray<ReadonlyArray<string>> = status
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      if (!line.startsWith("[GNUPG:] ")) return ["MALFORMED"];
      return line.slice("[GNUPG:] ".length).trim().split(/\s+/u);
    });
  for (const fields of validSignatures) {
    const token = fields[0] ?? "MALFORMED";
    if (fatalGpgStatuses.has(token))
      return quarantine(`m9b13c:gpg-status-${token.toLowerCase()}`);
    if (!allowedGpgStatuses.has(token))
      return quarantine("m9b13c:malformed-or-unrecognized-gpg-status");
  }
  const validsig = validSignatures.filter((fields) => fields[0] === "VALIDSIG");
  if (validsig.length !== 1)
    return quarantine("m9b13c:gpg-validsig-count-mismatch");
  const fields = validsig[0];
  const signingFingerprint = fields?.[1];
  const primaryFingerprint = fields?.at(-1);
  if (
    signingFingerprint !== expectedSigningFingerprint ||
    primaryFingerprint !== expectedPrimaryFingerprint
  )
    return quarantine("m9b13c:gpg-fingerprint-binding-mismatch");
  return { ok: true, value: true };
}

const evidenceEnvelopeSchema = z
  .strictObject({
    descriptorGraphConsistent: z.boolean(),
    provenancePresent: z.boolean(),
    sbomPresent: z.boolean(),
    subjectExact: z.boolean(),
    sourceExact: z.boolean(),
    builderExact: z.boolean(),
    buildTypeExact: z.boolean(),
    invocationComplete: z.boolean(),
    platformExact: z.boolean(),
    nodeVersionExact: z.boolean(),
    baseMaterialsComplete: z.boolean(),
    packageInventoryConsistent: z.boolean(),
    malformedOrAmbiguous: z.boolean(),
    unexpectedSignature: z.boolean(),
    unexpectedTransparency: z.boolean(),
    unrecognizedEvidenceTypes: z.string().array().readonly(),
  })
  .readonly();

export type M9b13cEvidenceEnvelope = z.infer<typeof evidenceEnvelopeSchema>;

export function validateM9b13cEvidenceEnvelope(
  input: unknown,
): Result<true, M9b13cFailure> {
  const parsed = evidenceEnvelopeSchema.safeParse(input);
  if (!parsed.success) return quarantine("m9b13c:malformed-evidence-envelope");
  const evidence = parsed.data;
  if (evidence.unexpectedSignature || evidence.unexpectedTransparency)
    return quarantine("m9b13c:unexpected-signature-or-transparency");
  if (evidence.unrecognizedEvidenceTypes.length !== 0)
    return quarantine("m9b13c:unrecognized-evidence-type");
  if (!evidence.provenancePresent || !evidence.sbomPresent)
    return quarantine("m9b13c:missing-provenance-or-sbom");
  if (!evidence.subjectExact)
    return quarantine("m9b13c:wrong-attestation-subject");
  if (!evidence.descriptorGraphConsistent)
    return quarantine("m9b13c:descriptor-graph-inconsistent");
  if (
    !evidence.sourceExact ||
    !evidence.builderExact ||
    !evidence.buildTypeExact ||
    !evidence.invocationComplete ||
    !evidence.platformExact ||
    !evidence.nodeVersionExact ||
    !evidence.baseMaterialsComplete
  )
    return quarantine("m9b13c:provenance-semantics-inconsistent");
  if (!evidence.packageInventoryConsistent)
    return quarantine("m9b13c:sbom-semantics-inconsistent");
  if (evidence.malformedOrAmbiguous)
    return quarantine("m9b13c:malformed-or-ambiguous-evidence");
  return { ok: true, value: true };
}

const sbomPackageSchema = z
  .strictObject({
    name: z.string().min(1),
    version: z.string(),
    architecture: z.string(),
    packageId: z.string().min(1),
    files: z.string().array().readonly(),
    relationships: z.string().array().readonly(),
  })
  .readonly();

const sbomInventorySchema = z
  .strictObject({ packages: sbomPackageSchema.array().readonly() })
  .readonly();

function normalizeSbom(input: z.infer<typeof sbomInventorySchema>): string {
  const normalized = input.packages
    .map((pkg) => ({
      ...pkg,
      files: [...new Set(pkg.files)].sort(),
      relationships: [...new Set(pkg.relationships)].sort(),
    }))
    .sort((left, right) => left.packageId.localeCompare(right.packageId));
  return JSON.stringify({ packages: normalized });
}

export function compareM9b13cSbomInventories(
  attached: unknown,
  independent: unknown,
): Result<true, M9b13cFailure> {
  const attachedParsed = sbomInventorySchema.safeParse(attached);
  const independentParsed = sbomInventorySchema.safeParse(independent);
  if (!attachedParsed.success || !independentParsed.success)
    return quarantine("m9b13c:invalid-sbom-schema");
  if (
    normalizeSbom(attachedParsed.data) !== normalizeSbom(independentParsed.data)
  )
    return quarantine("m9b13c:sbom-semantic-mismatch");
  return { ok: true, value: true };
}

const destinationFixtureSchema = z
  .strictObject({
    destination: z.literal(M9B13C_DESTINATION),
    resolvedOutsideRepository: z.boolean(),
    protectedNamespaceOverlap: z.boolean(),
    ancestors: z
      .strictObject({
        path: z.string(),
        kind: z.enum(["directory", "symlink", "other"]),
        mode: z.number().int().nonnegative(),
        ownerMatches: z.boolean(),
        device: z.string(),
        inode: z.string(),
        mountBoundary: z.boolean(),
        aliasDetected: z.boolean(),
        replaced: z.boolean(),
        controlledPrivateAncestor: z.boolean(),
      })
      .array()
      .readonly(),
    rootPreexisting: z.boolean(),
    exclusiveCreateSucceeded: z.boolean(),
    createdMode: z.number().int().nonnegative(),
    rootDeviceStable: z.boolean(),
    rootInodeStable: z.boolean(),
    concurrentCreate: z.boolean(),
    crashOrInterruption: z.boolean(),
    partialState: z.boolean(),
    cleanupAnomaly: z.boolean(),
    sealingFailure: z.boolean(),
  })
  .readonly();

export function validateM9b13cDestinationFixture(
  input: unknown,
): Result<true, M9b13cFailure> {
  const parsed = destinationFixtureSchema.safeParse(input);
  if (!parsed.success) return quarantine("m9b13c:invalid-destination-fixture");
  const fixture = parsed.data;
  if (!fixture.resolvedOutsideRepository || fixture.protectedNamespaceOverlap)
    return quarantine("m9b13c:destination-boundary-mismatch");
  if (
    fixture.ancestors.some(
      (ancestor) =>
        ancestor.kind !== "directory" ||
        !ancestor.ownerMatches ||
        ancestor.mountBoundary ||
        ancestor.aliasDetected ||
        ancestor.replaced ||
        (ancestor.controlledPrivateAncestor && ancestor.mode !== 0o700),
    )
  )
    return quarantine("m9b13c:destination-ancestor-identity-mismatch");
  if (fixture.rootPreexisting || fixture.concurrentCreate)
    return quarantine("m9b13c:destination-exclusive-create-failed");
  if (!fixture.exclusiveCreateSucceeded || fixture.createdMode !== 0o700)
    return quarantine("m9b13c:destination-private-create-failed");
  if (!fixture.rootDeviceStable || !fixture.rootInodeStable)
    return quarantine("m9b13c:destination-root-identity-replaced");
  if (
    fixture.crashOrInterruption ||
    fixture.partialState ||
    fixture.cleanupAnomaly ||
    fixture.sealingFailure
  )
    return quarantine("m9b13c:destination-partial-or-sealing-failure");
  return { ok: true, value: true };
}

const effectsSchema = z
  .strictObject({
    networkRequests: z.number().int().nonnegative(),
    downloads: z.number().int().nonnegative(),
    imagePulls: z.number().int().nonnegative(),
    imageImports: z.number().int().nonnegative(),
    imageBuilds: z.number().int().nonnegative(),
    imageRuns: z.number().int().nonnegative(),
    corpusAccesses: z.number().int().nonnegative(),
    credentialAccesses: z.number().int().nonnegative(),
    providerCalls: z.number().int().nonnegative(),
    modelCalls: z.number().int().nonnegative(),
    osfMutations: z.number().int().nonnegative(),
    gitRemoteEffects: z.number().int().nonnegative(),
  })
  .readonly();

export type M9b13cEffects = z.infer<typeof effectsSchema>;

export const M9B13C_ZERO_EFFECTS: M9b13cEffects = Object.freeze({
  networkRequests: 0,
  downloads: 0,
  imagePulls: 0,
  imageImports: 0,
  imageBuilds: 0,
  imageRuns: 0,
  corpusAccesses: 0,
  credentialAccesses: 0,
  providerCalls: 0,
  modelCalls: 0,
  osfMutations: 0,
  gitRemoteEffects: 0,
});

export const M9B13C_DEPENDENCY_CLOSURE = Object.freeze({
  offlineScannerAvailable: false,
  selectedScanner: null,
  scannerBlocker: "m9b13c:offline-independent-sbom-scanner-unavailable",
  raceResistantHelperAvailable: false,
  selectedHelper: null,
  helperBlocker:
    "m9b13c:directory-relative-race-resistant-filesystem-primitive-unavailable",
});

export function evaluateM9b13cReadiness(effects: unknown): Result<
  Readonly<{
    decision: "acquisition-boundary-no-go";
    blockers: ReadonlyArray<string>;
    effects: M9b13cEffects;
  }>,
  M9b13cFailure
> {
  const parsed = effectsSchema.safeParse(effects);
  if (
    !parsed.success ||
    Object.values(parsed.data).some((value) => value !== 0)
  )
    return quarantine("m9b13c:prohibited-effect-nonzero");
  return {
    ok: true,
    value: {
      decision: "acquisition-boundary-no-go",
      blockers: [
        M9B13C_DEPENDENCY_CLOSURE.scannerBlocker,
        M9B13C_DEPENDENCY_CLOSURE.helperBlocker,
      ],
      effects: parsed.data,
    },
  };
}
