import { createHash } from "node:crypto";
import { closeSync, readSync } from "node:fs";
import { isIP } from "node:net";

import { canonicalizeJson, parseJson, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

export const M9B13K_CONTROLLER_PROTOCOL =
  "lachesis-m9b13k-osf-pat-waterbutler-canary-controller/1" as const;
export const M9B13K_ACTIVATION_PROTOCOL =
  "lachesis-m9b13k-osf-pat-canary-activation-binding/1" as const;
export const M9B13K_CREDENTIAL_CUSTODY_PROTOCOL =
  "lachesis-m9b13k-anonymous-fd3-pat-custody/1" as const;
export const M9B13K_SYNTHETIC_ARTIFACT_PROTOCOL =
  "lachesis-m9b13k-osf-pat-canary-synthetic-artifact/1" as const;
export const M9B13K_REQUEST_SEQUENCE_PROTOCOL =
  "lachesis-m9b13k-osf-pat-canary-request-sequence/1" as const;
export const M9B13K_SANITIZED_RECEIPT_PROTOCOL =
  "lachesis-m9b13k-sanitized-transport-receipts/1" as const;
export const M9B13K_RESPONSE_VALIDATION_PROTOCOL =
  "lachesis-m9b13k-waterbutler-response-validation/1" as const;
export const M9B13K_REDOWNLOAD_PROTOCOL =
  "lachesis-m9b13k-osf-pat-canary-redownload-verification/1" as const;
export const M9B13K_REVOCATION_PROTOCOL =
  "lachesis-m9b13k-osf-pat-revocation/1" as const;
export const M9B13K_TERMINAL_RECONCILIATION_PROTOCOL =
  "lachesis-m9b13k-osf-pat-canary-terminal-reconciliation/1" as const;
export const M9B13K_ZERO_EFFECT_REPLAY_PROTOCOL =
  "lachesis-m9b13k-osf-pat-canary-zero-effect-replay/1" as const;
export const M9B13K_COMPLETE_URL_DIGEST_PROTOCOL =
  "lachesis-m9b13k-complete-url-domain-separated-digest/1" as const;
export const M9B13K_LEDGER_PROTOCOL =
  "lachesis-m9b13k-durable-cas-controller-ledger/1" as const;

export const M9B13K_PROJECT_ID = "bmsda" as const;
export const M9B13K_DRAFT_ID = "6a7619b506a607fe5f63a77d" as const;
export const M9B13K_PROVIDER = "osfstorage" as const;
export const M9B13K_REQUIRED_SCOPE = "osf.full_write" as const;
export const M9B13K_ARTIFACT_IDENTITY =
  "1fbd9e013ac05f53c411b9e98f507d12" as const;
export const M9B13K_ARTIFACT_FILENAME =
  "OSF-PAT-WATERBUTLER-CANARY-1fbd9e013ac05f53c411b9e98f507d12.txt" as const;
export const M9B13K_ARTIFACT_SHA256 =
  "4ee4d970eb65bb9b8e525618ba19d4ee28dd2c1a1d0730bd9c4f3ff016134994" as const;
export const M9B13K_ARTIFACT_BYTE_LENGTH = 245 as const;

export const M9B13K_MAXIMUM_HTTP_REQUESTS = 18 as const;
export const M9B13K_MAXIMUM_REQUEST_BODY_BYTES = 245 as const;
export const M9B13K_API_RESPONSE_MAXIMUM_BYTES = 262_144 as const;
export const M9B13K_UPLOAD_RESPONSE_MAXIMUM_BYTES = 65_536 as const;
export const M9B13K_REQUEST_TIMEOUT_MS = 10_000 as const;
export const M9B13K_CONTROLLER_DEADLINE_MS = 120_000 as const;
export const M9B13K_REVOCATION_DEADLINE_MS = 15_000 as const;
export const M9B13K_MAXIMUM_CREDENTIAL_BYTES = 65 as const;

const M9B13K_ARTIFACT_TEXT = `frozen identity: ${M9B13K_ARTIFACT_IDENTITY}\nexact filename: ${M9B13K_ARTIFACT_FILENAME}\nSYNTHETIC NON-STUDY OSF PAT WATERBUTLER CANARY\nThis file contains no scientific, operational or protected content.\n`;

const ALLOWED_FILE_HOSTS = new Set([
  "files.osf.io",
  "files.us.osf.io",
  "files.eu.osf.io",
  "files.au.osf.io",
  "files.ca.osf.io",
]);

const commitmentSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const tokenIdSchema = z.string().regex(/^[a-f0-9]{24}$/u);
const nonemptySchema = z.string().min(1);

const ceilingsSchema = z.strictObject({
  maximumHttpRequests: z.literal(M9B13K_MAXIMUM_HTTP_REQUESTS),
  maximumRequestBodyBytes: z.literal(M9B13K_MAXIMUM_REQUEST_BODY_BYTES),
  apiResponseMaximumBytes: z.literal(M9B13K_API_RESPONSE_MAXIMUM_BYTES),
  uploadResponseMaximumBytes: z.literal(M9B13K_UPLOAD_RESPONSE_MAXIMUM_BYTES),
  perRequestTimeoutMs: z.literal(M9B13K_REQUEST_TIMEOUT_MS),
  controllerDeadlineMs: z.literal(M9B13K_CONTROLLER_DEADLINE_MS),
  revocationDeadlineMs: z.literal(M9B13K_REVOCATION_DEADLINE_MS),
  retries: z.literal(0),
  concurrency: z.literal(1),
});

export const m9b13kActivationSchema = z.strictObject({
  protocol: z.literal(M9B13K_ACTIVATION_PROTOCOL),
  controllerProtocol: z.literal(M9B13K_CONTROLLER_PROTOCOL),
  activationIdentity: commitmentSchema,
  requestIdentity: commitmentSchema,
  tokenId: tokenIdSchema,
  expectedCredentialFingerprint: commitmentSchema,
  expectedScope: z.literal(M9B13K_REQUIRED_SCOPE),
  projectId: z.literal(M9B13K_PROJECT_ID),
  draftId: z.literal(M9B13K_DRAFT_ID),
  provider: z.literal(M9B13K_PROVIDER),
  artifactProtocol: z.literal(M9B13K_SYNTHETIC_ARTIFACT_PROTOCOL),
  artifactSha256: z.literal(M9B13K_ARTIFACT_SHA256),
  requestSequenceProtocol: z.literal(M9B13K_REQUEST_SEQUENCE_PROTOCOL),
  ledgerNamespace: nonemptySchema,
  ceilings: ceilingsSchema,
});

export type M9b13kActivation = z.infer<typeof m9b13kActivationSchema>;

type ControllerFailure = Readonly<{
  kind: "m9b13k-controller-failure";
  reason: string;
}>;

function failure<T>(reason: string): Result<T, ControllerFailure> {
  return { ok: false, error: { kind: "m9b13k-controller-failure", reason } };
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function domainDigest(
  protocol: string,
  ...parts: ReadonlyArray<string>
): string {
  const digest = createHash("sha256");
  digest.update(protocol, "utf8");
  for (const part of parts) {
    digest.update("\0", "utf8");
    digest.update(part, "utf8");
  }
  return `sha256:${digest.digest("hex")}`;
}

function canonicalDigest(value: unknown): Result<string, ControllerFailure> {
  const canonical = canonicalizeJson(value);
  if (!canonical.ok) return failure("m9b13k:canonicalization-failed");
  return {
    ok: true,
    value: sha256Bytes(new TextEncoder().encode(canonical.value)),
  };
}

export function frozenM9b13kArtifactBytes(): Uint8Array {
  return new TextEncoder().encode(M9B13K_ARTIFACT_TEXT);
}

export function deriveM9b13kCredentialFingerprint(
  activationIdentity: string,
  tokenId: string,
  credential: Uint8Array,
): string {
  const digest = createHash("sha256");
  digest.update(M9B13K_CREDENTIAL_CUSTODY_PROTOCOL, "utf8");
  digest.update("\0", "utf8");
  digest.update(activationIdentity, "utf8");
  digest.update("\0", "utf8");
  digest.update(tokenId, "utf8");
  digest.update("\0", "utf8");
  digest.update(credential);
  return `sha256:${digest.digest("hex")}`;
}

export type M9b13kCredentialReadFailure = Readonly<{
  kind:
    | "fd3-unavailable"
    | "fd3-reused"
    | "credential-oversized"
    | "credential-malformed";
}>;

export type M9b13kCredentialReader = Readonly<{
  source: "anonymous-fd3";
  readOnce: () => Result<Uint8Array, M9b13kCredentialReadFailure>;
}>;

function validTokenBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength !== M9B13K_MAXIMUM_CREDENTIAL_BYTES) return false;
  if (bytes[64] !== 0x0a) return false;
  for (let index = 0; index < 64; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) return false;
    const digit = byte >= 0x30 && byte <= 0x39;
    const uppercase = byte >= 0x41 && byte <= 0x5a;
    const lowercase = byte >= 0x61 && byte <= 0x7a;
    if (!digit && !uppercase && !lowercase) return false;
  }
  return true;
}

export function createAnonymousFd3CredentialReader(): M9b13kCredentialReader {
  let read = false;
  return {
    source: "anonymous-fd3",
    readOnce: () => {
      if (read) return { ok: false, error: { kind: "fd3-reused" } };
      read = true;
      const bytes = new Uint8Array(M9B13K_MAXIMUM_CREDENTIAL_BYTES + 1);
      let count: number;
      try {
        count = readSync(3, bytes, 0, bytes.byteLength, null);
      } catch {
        bytes.fill(0);
        return { ok: false, error: { kind: "fd3-unavailable" } };
      } finally {
        try {
          closeSync(3);
        } catch {
          // The descriptor may already be absent. The sanitized result is unchanged.
        }
      }
      if (count > M9B13K_MAXIMUM_CREDENTIAL_BYTES) {
        bytes.fill(0);
        return { ok: false, error: { kind: "credential-oversized" } };
      }
      const credential = bytes.slice(0, count);
      bytes.fill(0);
      if (!validTokenBytes(credential)) {
        credential.fill(0);
        return { ok: false, error: { kind: "credential-malformed" } };
      }
      return { ok: true, value: credential };
    },
  };
}

export type M9b13kRequestKind =
  | "token-detail"
  | "project-detail"
  | "registrations-page"
  | "view-only-links-page"
  | "files-page"
  | "provider-root"
  | "upload"
  | "download"
  | "revoke-token";

export type M9b13kTransportRequest = Readonly<{
  kind: M9b13kRequestKind;
  method: "DELETE" | "GET" | "PUT";
  url: URL;
  endpointClass: string;
  urlDigest: string;
  body: Uint8Array | null;
  maximumResponseBytes: number;
  timeoutMs: number;
  redirect: "error";
  retryCount: 0;
}>;

export type M9b13kTransportResult =
  | Readonly<{
      kind: "response";
      dispatched: true;
      status: number;
      contentType: string;
      body: Uint8Array;
      latencyMs: number;
      redirectCount: number;
    }>
  | Readonly<{
      kind: "failure";
      dispatched: boolean;
      failureClass:
        | "timeout-before-dispatch"
        | "timeout-after-dispatch"
        | "interrupted-before-dispatch"
        | "interrupted-after-dispatch"
        | "transport-error-before-dispatch"
        | "transport-error-after-dispatch";
      latencyMs: number;
    }>;

export type M9b13kTransport = Readonly<{
  kind: "interceptable-zero-retry-transport";
  dispatch: (
    request: M9b13kTransportRequest,
    credential: Uint8Array,
  ) => Promise<M9b13kTransportResult>;
}>;

type LedgerEventKind =
  "activation-reserved" | "request-dispatched" | "request-receipt" | "terminal";

export type M9b13kLedgerEvent = Readonly<{
  protocol: string;
  sequence: number;
  activationDigest: string;
  kind: LedgerEventKind;
  requestKind: M9b13kRequestKind | null;
  outcomeClass: string | null;
  priorRoot: string;
  currentRoot: string;
}>;

export type M9b13kLedgerSnapshot = Readonly<{
  protocol: string;
  namespace: string;
  revision: number;
  root: string;
  events: ReadonlyArray<M9b13kLedgerEvent>;
}>;

export type M9b13kLedgerFailure = Readonly<{
  kind: "conflict" | "persistence-ambiguous" | "tampered";
}>;

export type M9b13kLedger = Readonly<{
  persistence: "durable-cas";
  snapshot: () => Promise<M9b13kLedgerSnapshot>;
  compareAndSwap: (
    expectedRevision: number,
    expectedRoot: string,
    event: Readonly<{
      activationDigest: string;
      kind: LedgerEventKind;
      requestKind: M9b13kRequestKind | null;
      outcomeClass: string | null;
    }>,
  ) => Promise<Result<M9b13kLedgerSnapshot, M9b13kLedgerFailure>>;
}>;

export type M9b13kSyntheticLedgerFault =
  | "none"
  | "next-conflict"
  | "next-ambiguous-before-write"
  | "next-ambiguous-after-write";

export type M9b13kSyntheticLedgerControl = Readonly<{
  ledger: M9b13kLedger;
  setNextFault: (fault: M9b13kSyntheticLedgerFault) => void;
  tamperRoot: () => void;
  snapshot: () => M9b13kLedgerSnapshot;
}>;

function initialLedgerRoot(namespace: string): string {
  return domainDigest(M9B13K_LEDGER_PROTOCOL, namespace, "initial");
}

function ledgerEventRoot(
  event: Omit<M9b13kLedgerEvent, "currentRoot">,
): Result<string, ControllerFailure> {
  const digest = canonicalDigest(event);
  return digest.ok ? { ok: true, value: `sha256:${digest.value}` } : digest;
}

export function createSyntheticM9b13kLedger(
  namespace: string,
): M9b13kSyntheticLedgerControl {
  let fault: M9b13kSyntheticLedgerFault = "none";
  let state: M9b13kLedgerSnapshot = {
    protocol: M9B13K_LEDGER_PROTOCOL,
    namespace,
    revision: 0,
    root: initialLedgerRoot(namespace),
    events: [],
  };
  const ledger: M9b13kLedger = {
    persistence: "durable-cas",
    snapshot: () => Promise.resolve(state),
    compareAndSwap: (expectedRevision, expectedRoot, draft) => {
      if (fault === "next-conflict") {
        fault = "none";
        return Promise.resolve({ ok: false, error: { kind: "conflict" } });
      }
      if (state.revision !== expectedRevision || state.root !== expectedRoot)
        return Promise.resolve({ ok: false, error: { kind: "conflict" } });
      if (fault === "next-ambiguous-before-write") {
        fault = "none";
        return Promise.resolve({
          ok: false,
          error: { kind: "persistence-ambiguous" },
        });
      }
      const partial: Omit<M9b13kLedgerEvent, "currentRoot"> = {
        protocol: M9B13K_LEDGER_PROTOCOL,
        sequence: state.revision + 1,
        activationDigest: draft.activationDigest,
        kind: draft.kind,
        requestKind: draft.requestKind,
        outcomeClass: draft.outcomeClass,
        priorRoot: state.root,
      };
      const root = ledgerEventRoot(partial);
      if (!root.ok)
        return Promise.resolve({ ok: false, error: { kind: "tampered" } });
      const event: M9b13kLedgerEvent = {
        ...partial,
        currentRoot: root.value,
      };
      state = {
        ...state,
        revision: state.revision + 1,
        root: event.currentRoot,
        events: [...state.events, event],
      };
      if (fault === "next-ambiguous-after-write") {
        fault = "none";
        return Promise.resolve({
          ok: false,
          error: { kind: "persistence-ambiguous" },
        });
      }
      return Promise.resolve({ ok: true, value: state });
    },
  };
  return {
    ledger,
    setNextFault: (next) => {
      fault = next;
    },
    tamperRoot: () => {
      state = { ...state, root: `sha256:${"f".repeat(64)}` };
    },
    snapshot: () => state,
  };
}

function validateLedger(
  snapshot: M9b13kLedgerSnapshot,
  namespace: string,
): Result<M9b13kLedgerSnapshot, ControllerFailure> {
  if (
    snapshot.protocol !== M9B13K_LEDGER_PROTOCOL ||
    snapshot.namespace !== namespace ||
    snapshot.revision !== snapshot.events.length
  )
    return failure("m9b13k:ledger-envelope-invalid");
  let root = initialLedgerRoot(namespace);
  let activationDigest: string | null = null;
  let putDispatches = 0;
  let revocationDispatches = 0;
  let terminalEvents = 0;
  for (const [index, event] of snapshot.events.entries()) {
    if (
      event.protocol !== M9B13K_LEDGER_PROTOCOL ||
      event.sequence !== index + 1 ||
      event.priorRoot !== root ||
      (activationDigest !== null && event.activationDigest !== activationDigest)
    )
      return failure("m9b13k:ledger-event-chain-invalid");
    const expected = ledgerEventRoot({
      protocol: event.protocol,
      sequence: event.sequence,
      activationDigest: event.activationDigest,
      kind: event.kind,
      requestKind: event.requestKind,
      outcomeClass: event.outcomeClass,
      priorRoot: event.priorRoot,
    });
    if (!expected.ok || expected.value !== event.currentRoot)
      return failure("m9b13k:ledger-event-digest-invalid");
    if (index === 0 && event.kind !== "activation-reserved")
      return failure("m9b13k:ledger-first-event-not-reservation");
    activationDigest ??= event.activationDigest;
    if (event.kind === "request-dispatched" && event.requestKind === "upload")
      putDispatches += 1;
    if (
      event.kind === "request-dispatched" &&
      event.requestKind === "revoke-token"
    )
      revocationDispatches += 1;
    if (event.kind === "terminal") terminalEvents += 1;
    root = event.currentRoot;
  }
  if (
    root !== snapshot.root ||
    putDispatches > 1 ||
    revocationDispatches > 1 ||
    terminalEvents > 1
  )
    return failure("m9b13k:ledger-budget-or-root-invalid");
  return { ok: true, value: snapshot };
}

export type M9b13kRevocationVerification = "revoked" | "active" | "ambiguous";

export type M9b13kRevocationCustodian = Readonly<{
  kind: "separately-controlled-non-secret-custodian";
  verify: (
    binding: Readonly<{
      activationIdentity: string;
      requestIdentity: string;
      tokenId: string;
      revocationReceiptDigest: string;
    }>,
  ) => Promise<M9b13kRevocationVerification>;
}>;

export type M9b13kSanitizedReceipt = Readonly<{
  protocol: typeof M9B13K_SANITIZED_RECEIPT_PROTOCOL;
  sequence: number;
  requestKind: M9b13kRequestKind;
  method: "DELETE" | "GET" | "PUT";
  schemeClass: "https";
  hostClass: string;
  pathClass: string;
  queryParameterNames: ReadonlyArray<string>;
  urlDigest: string;
  status: number | null;
  responseClass: string;
  latencyMs: number;
  dispatched: boolean;
  ambiguity: "none" | "pre-dispatch" | "post-dispatch";
}>;

export type M9b13kControllerOutcome = Readonly<{
  protocol: typeof M9B13K_CONTROLLER_PROTOCOL;
  decision: "pass" | "no-go";
  terminalState:
    | "not-activated"
    | "revoked-and-verified"
    | "revocation-failed-security-stop"
    | "revocation-ambiguous-security-stop";
  reason: string;
  activationIdentity: string | null;
  requestIdentity: string | null;
  credentialFingerprint: string | null;
  requestCount: number;
  putDispatchCount: number;
  revocationAttemptCount: number;
  receipts: ReadonlyArray<M9b13kSanitizedReceipt>;
  replay: boolean;
  cleanupAuthorization:
    null | "browser-custodian-token-cleanup-and-state-reconciliation-only";
  effects: Readonly<{
    retries: 0;
    maximumConcurrency: 1;
    unexpectedProjectAccesses: 0;
    registrationMutations: 0;
    projectDraftLinkOrContributorCreations: 0;
  }>;
}>;

type Runtime = {
  snapshot: M9b13kLedgerSnapshot;
  receipts: Array<M9b13kSanitizedReceipt>;
  requestCount: number;
  putDispatchCount: number;
  revocationAttemptCount: number;
  controllerDeadlineAtMs: number;
};

type ExecutionFailure = Readonly<{
  reason: string;
  ambiguous: boolean;
}>;

type ExecutionResult<T> = Result<T, ExecutionFailure>;

function executionFailure<T>(
  reason: string,
  ambiguous = false,
): ExecutionResult<T> {
  return { ok: false, error: { reason, ambiguous } };
}

function sanitizedContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function endpointDigest(url: URL): string {
  return domainDigest(M9B13K_COMPLETE_URL_DIGEST_PROTOCOL, url.href);
}

function commonUrlPolicy(url: URL): Result<URL, ControllerFailure> {
  if (
    Array.from(url.href).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint === undefined || codePoint > 0x7f;
    })
  )
    return failure("m9b13k:url-non-ascii");
  if (url.protocol !== "https:") return failure("m9b13k:url-not-https");
  if (url.username !== "" || url.password !== "")
    return failure("m9b13k:url-userinfo");
  if (url.hash !== "") return failure("m9b13k:url-fragment");
  if (url.port !== "") return failure("m9b13k:url-non-default-port");
  if (isIP(url.hostname) !== 0) return failure("m9b13k:url-ip-literal");
  if (
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.includes("xn--")
  )
    return failure("m9b13k:url-host-ambiguity");
  return { ok: true, value: url };
}

function apiUrl(path: string, query?: Readonly<Record<string, string>>): URL {
  const url = new URL(path, "https://api.osf.io");
  if (query !== undefined)
    for (const [key, value] of Object.entries(query))
      url.searchParams.set(key, value);
  return url;
}

function validateApiUrl(
  url: URL,
  expectedPath: string,
  allowedQueryNames: ReadonlySet<string>,
): Result<URL, ControllerFailure> {
  const common = commonUrlPolicy(url);
  if (!common.ok) return common;
  if (url.hostname !== "api.osf.io" || url.pathname !== expectedPath)
    return failure("m9b13k:api-resource-boundary");
  for (const key of url.searchParams.keys())
    if (!allowedQueryNames.has(key))
      return failure("m9b13k:api-query-boundary");
  for (const key of allowedQueryNames)
    if (url.searchParams.getAll(key).length > 1)
      return failure("m9b13k:api-query-duplicate");
  const pageSize = url.searchParams.get("page[size]");
  if (pageSize !== null && pageSize !== "100")
    return failure("m9b13k:api-page-size-boundary");
  return { ok: true, value: url };
}

function validateWaterbutlerUploadUrl(
  value: string,
): Result<URL, ControllerFailure> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return failure("m9b13k:upload-url-invalid");
  }
  const common = commonUrlPolicy(url);
  if (!common.ok) return common;
  if (
    !ALLOWED_FILE_HOSTS.has(url.hostname) ||
    url.pathname !==
      `/v1/resources/${M9B13K_PROJECT_ID}/providers/${M9B13K_PROVIDER}/` ||
    Array.from(url.searchParams.keys()).length !== 0
  )
    return failure("m9b13k:upload-url-boundary");
  return { ok: true, value: url };
}

function validateWaterbutlerDownloadUrl(
  value: string,
): Result<URL, ControllerFailure> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return failure("m9b13k:download-url-invalid");
  }
  const common = commonUrlPolicy(url);
  if (!common.ok) return common;
  const prefix = `/v1/resources/${M9B13K_PROJECT_ID}/providers/${M9B13K_PROVIDER}/`;
  const objectId = url.pathname.slice(prefix.length);
  if (
    !ALLOWED_FILE_HOSTS.has(url.hostname) ||
    !url.pathname.startsWith(prefix) ||
    objectId.length === 0 ||
    objectId.includes("/") ||
    objectId.includes("%") ||
    !/^[A-Za-z0-9._~-]+$/u.test(objectId) ||
    Array.from(url.searchParams.keys()).length !== 0
  )
    return failure("m9b13k:download-url-boundary");
  return { ok: true, value: url };
}

function activationDigest(
  activation: M9b13kActivation,
): Result<string, ControllerFailure> {
  const digest = canonicalDigest(activation);
  return digest.ok ? { ok: true, value: `sha256:${digest.value}` } : digest;
}

async function appendLedger(
  dependencies: M9b13kControllerDependencies,
  runtime: Runtime,
  digest: string,
  event: Readonly<{
    kind: LedgerEventKind;
    requestKind: M9b13kRequestKind | null;
    outcomeClass: string | null;
  }>,
): Promise<ExecutionResult<null>> {
  let write: Awaited<ReturnType<M9b13kLedger["compareAndSwap"]>>;
  try {
    write = await dependencies.ledger.compareAndSwap(
      runtime.snapshot.revision,
      runtime.snapshot.root,
      { activationDigest: digest, ...event },
    );
  } catch {
    return executionFailure("m9b13k:ledger-persistence-ambiguous", true);
  }
  if (!write.ok)
    return executionFailure(
      `m9b13k:ledger-${write.error.kind}`,
      write.error.kind === "persistence-ambiguous",
    );
  const validated = validateLedger(write.value, write.value.namespace);
  if (!validated.ok) return executionFailure(validated.error.reason, true);
  runtime.snapshot = validated.value;
  return { ok: true, value: null };
}

async function dispatchRequest(
  dependencies: M9b13kControllerDependencies,
  runtime: Runtime,
  digest: string,
  credential: Uint8Array,
  request: M9b13kTransportRequest,
): Promise<ExecutionResult<M9b13kTransportResult>> {
  if (request.kind !== "revoke-token") {
    let now: number;
    try {
      now = dependencies.monotonicNowMs();
    } catch {
      return executionFailure("m9b13k:monotonic-clock-unavailable");
    }
    if (now >= runtime.controllerDeadlineAtMs)
      return executionFailure("m9b13k:controller-deadline-exceeded");
  }
  if (runtime.requestCount >= M9B13K_MAXIMUM_HTTP_REQUESTS)
    return executionFailure("m9b13k:http-request-budget-exhausted");
  if (
    request.body !== null &&
    request.body.byteLength > M9B13K_MAXIMUM_REQUEST_BODY_BYTES
  )
    return executionFailure("m9b13k:request-body-ceiling");
  if (request.kind === "upload") {
    if (runtime.putDispatchCount !== 0)
      return executionFailure("m9b13k:second-put-rejected", true);
    runtime.putDispatchCount += 1;
  }
  if (request.kind === "revoke-token") {
    if (runtime.revocationAttemptCount !== 0)
      return executionFailure("m9b13k:second-revocation-rejected", true);
    runtime.revocationAttemptCount += 1;
  }
  const reservation = await appendLedger(dependencies, runtime, digest, {
    kind: "request-dispatched",
    requestKind: request.kind,
    outcomeClass: null,
  });
  if (!reservation.ok) return reservation;
  runtime.requestCount += 1;
  let transportResult: M9b13kTransportResult;
  try {
    transportResult = await dependencies.transport.dispatch(
      request,
      credential,
    );
  } catch {
    transportResult = {
      kind: "failure",
      dispatched: true,
      failureClass: "transport-error-after-dispatch",
      latencyMs: request.timeoutMs,
    };
  }
  const responseClass =
    transportResult.kind === "response"
      ? transportResult.status >= 200 && transportResult.status < 300
        ? "success"
        : transportResult.status >= 300 && transportResult.status < 400
          ? "redirect"
          : transportResult.status >= 400 && transportResult.status < 500
            ? "client-error"
            : "server-error"
      : transportResult.failureClass;
  const receipt: M9b13kSanitizedReceipt = {
    protocol: M9B13K_SANITIZED_RECEIPT_PROTOCOL,
    sequence: runtime.receipts.length + 1,
    requestKind: request.kind,
    method: request.method,
    schemeClass: "https",
    hostClass: request.url.hostname,
    pathClass: request.endpointClass,
    queryParameterNames: Array.from(request.url.searchParams.keys()).sort(),
    urlDigest: request.urlDigest,
    status: transportResult.kind === "response" ? transportResult.status : null,
    responseClass,
    latencyMs: transportResult.latencyMs,
    dispatched: transportResult.dispatched,
    ambiguity:
      transportResult.kind === "failure"
        ? transportResult.dispatched
          ? "post-dispatch"
          : "pre-dispatch"
        : "none",
  };
  runtime.receipts.push(receipt);
  const persisted = await appendLedger(dependencies, runtime, digest, {
    kind: "request-receipt",
    requestKind: request.kind,
    outcomeClass: responseClass,
  });
  if (!persisted.ok) return executionFailure(persisted.error.reason, true);
  if (request.kind !== "revoke-token") {
    let now: number;
    try {
      now = dependencies.monotonicNowMs();
    } catch {
      return executionFailure(
        "m9b13k:monotonic-clock-unavailable-after-dispatch",
        true,
      );
    }
    if (now >= runtime.controllerDeadlineAtMs)
      return executionFailure(
        "m9b13k:controller-deadline-exceeded-after-dispatch",
        request.kind === "upload",
      );
  }
  if (transportResult.kind === "failure")
    return executionFailure(
      `m9b13k:${transportResult.failureClass}`,
      transportResult.dispatched,
    );
  if (
    transportResult.redirectCount !== 0 ||
    (transportResult.status >= 300 && transportResult.status < 400)
  )
    return executionFailure(
      "m9b13k:redirect-terminal",
      request.kind === "upload",
    );
  if (transportResult.body.byteLength > request.maximumResponseBytes)
    return executionFailure(
      "m9b13k:response-body-ceiling",
      request.kind === "upload",
    );
  return { ok: true, value: transportResult };
}

const tokenDetailSchema = z.strictObject({
  data: z.strictObject({
    type: z.literal("tokens"),
    id: tokenIdSchema,
    attributes: z.strictObject({
      scopes: z.array(z.string()).min(1),
    }),
  }),
});

const projectDetailSchema = z.strictObject({
  data: z.strictObject({
    type: z.literal("nodes"),
    id: z.literal(M9B13K_PROJECT_ID),
    attributes: z.strictObject({
      public: z.boolean(),
      current_user_permissions: z.array(z.string()),
    }),
  }),
});

const identityCollectionSchema = z.strictObject({
  data: z.array(
    z.strictObject({
      id: z.string().min(1),
      type: z.string().min(1),
    }),
  ),
  links: z.strictObject({ next: z.string().nullable() }),
});

const fileCollectionSchema = z.strictObject({
  data: z.array(
    z.strictObject({
      id: z.string().min(1),
      type: z.literal("files"),
      attributes: z.strictObject({
        name: z.string().min(1),
        kind: z.enum(["file", "folder"]),
        path: z.string().min(1),
        provider: z.literal(M9B13K_PROVIDER),
      }),
    }),
  ),
  links: z.strictObject({ next: z.string().nullable() }),
});

const providerRootSchema = z.strictObject({
  data: z.array(
    z.strictObject({
      id: z.literal(`${M9B13K_PROJECT_ID}:${M9B13K_PROVIDER}`),
      type: z.literal("files"),
      attributes: z.strictObject({
        name: z.literal(M9B13K_PROVIDER),
        provider: z.literal(M9B13K_PROVIDER),
      }),
      links: z.strictObject({ upload: z.url() }),
    }),
  ),
  links: z.strictObject({ next: z.string().nullable() }),
});

const uploadResponseSchema = z.strictObject({
  data: z.strictObject({
    id: z.string().min(1),
    type: z.literal("files"),
    attributes: z.strictObject({
      name: z.literal(M9B13K_ARTIFACT_FILENAME),
      kind: z.literal("file"),
      path: z.string().min(1),
      provider: z.literal(M9B13K_PROVIDER),
      resource: z.literal(M9B13K_PROJECT_ID),
    }),
    links: z.strictObject({ download: z.url() }),
  }),
});

function parseBoundedJson<T>(
  result: M9b13kTransportResult,
  schema: z.ZodType<T>,
  reason: string,
): ExecutionResult<T> {
  if (result.kind !== "response") return executionFailure(reason);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(result.body);
  } catch {
    return executionFailure(`${reason}:invalid-utf8`);
  }
  const json = parseJson(text);
  if (!json.ok) return executionFailure(`${reason}:invalid-json`);
  const parsed = schema.safeParse(json.value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : executionFailure(`${reason}:invalid-schema`);
}

function request(
  kind: M9b13kRequestKind,
  method: M9b13kTransportRequest["method"],
  url: URL,
  endpointClass: string,
  maximumResponseBytes: number,
  body: Uint8Array | null = null,
  timeoutMs: number = M9B13K_REQUEST_TIMEOUT_MS,
): M9b13kTransportRequest {
  return {
    kind,
    method,
    url,
    endpointClass,
    urlDigest: endpointDigest(url),
    body,
    maximumResponseBytes,
    timeoutMs,
    redirect: "error",
    retryCount: 0,
  };
}

async function getJson<T>(
  dependencies: M9b13kControllerDependencies,
  runtime: Runtime,
  digest: string,
  credential: Uint8Array,
  kind: M9b13kRequestKind,
  url: URL,
  endpointClass: string,
  schema: z.ZodType<T>,
): Promise<ExecutionResult<T>> {
  const response = await dispatchRequest(
    dependencies,
    runtime,
    digest,
    credential,
    request(kind, "GET", url, endpointClass, M9B13K_API_RESPONSE_MAXIMUM_BYTES),
  );
  if (!response.ok) return response;
  if (response.value.kind !== "response" || response.value.status !== 200)
    return executionFailure(`m9b13k:${kind}-status`, kind === "upload");
  if (
    sanitizedContentType(response.value.contentType) !==
    "application/vnd.api+json"
  )
    return executionFailure(`m9b13k:${kind}-content-type`);
  return parseBoundedJson(response.value, schema, `m9b13k:${kind}`);
}

async function completeCollection<T>(
  dependencies: M9b13kControllerDependencies,
  runtime: Runtime,
  digest: string,
  credential: Uint8Array,
  options: Readonly<{
    requestKind: M9b13kRequestKind;
    initialUrl: URL;
    expectedPath: string;
    endpointClass: string;
    maximumPages: number;
    maximumRecords: number;
    schema: z.ZodType<
      Readonly<{ data: ReadonlyArray<T>; links: { next: string | null } }>
    >;
  }>,
): Promise<ExecutionResult<ReadonlyArray<T>>> {
  const records: Array<T> = [];
  const visited = new Set<string>();
  let next: URL | null = options.initialUrl;
  let pages = 0;
  const queryNames = new Set(["page[size]", "page[cursor]", "page[offset]"]);
  while (next !== null) {
    if (pages >= options.maximumPages)
      return executionFailure(`m9b13k:${options.requestKind}-page-cap`);
    const valid = validateApiUrl(next, options.expectedPath, queryNames);
    if (!valid.ok) return executionFailure(valid.error.reason);
    const digestUrl = endpointDigest(valid.value);
    if (visited.has(digestUrl))
      return executionFailure(`m9b13k:${options.requestKind}-pagination-cycle`);
    visited.add(digestUrl);
    const page = await getJson(
      dependencies,
      runtime,
      digest,
      credential,
      options.requestKind,
      valid.value,
      options.endpointClass,
      options.schema,
    );
    if (!page.ok) return page;
    pages += 1;
    records.push(...page.value.data);
    if (records.length > options.maximumRecords)
      return executionFailure(`m9b13k:${options.requestKind}-record-cap`);
    if (page.value.links.next === null) next = null;
    else {
      try {
        next = new URL(page.value.links.next);
      } catch {
        return executionFailure(`m9b13k:${options.requestKind}-next-invalid`);
      }
    }
  }
  return { ok: true, value: records };
}

function hasExactPermissions(permissions: ReadonlyArray<string>): boolean {
  return (
    permissions.length === 3 &&
    permissions.includes("admin") &&
    permissions.includes("write") &&
    permissions.includes("read")
  );
}

function existingPutDispatches(snapshot: M9b13kLedgerSnapshot): number {
  return snapshot.events.filter(
    (event) =>
      event.kind === "request-dispatched" && event.requestKind === "upload",
  ).length;
}

function existingRevocationDispatches(snapshot: M9b13kLedgerSnapshot): number {
  return snapshot.events.filter(
    (event) =>
      event.kind === "request-dispatched" &&
      event.requestKind === "revoke-token",
  ).length;
}

function hasTerminalEvent(snapshot: M9b13kLedgerSnapshot): boolean {
  return snapshot.events.some((event) => event.kind === "terminal");
}

function outcome(
  activation: M9b13kActivation | null,
  fingerprint: string | null,
  runtime: Runtime,
  terminalState: M9b13kControllerOutcome["terminalState"],
  reason: string,
  replay: boolean,
  success: boolean,
): M9b13kControllerOutcome {
  return {
    protocol: M9B13K_CONTROLLER_PROTOCOL,
    decision: success ? "pass" : "no-go",
    terminalState,
    reason,
    activationIdentity: activation?.activationIdentity ?? null,
    requestIdentity: activation?.requestIdentity ?? null,
    credentialFingerprint: fingerprint,
    requestCount: runtime.requestCount,
    putDispatchCount: runtime.putDispatchCount,
    revocationAttemptCount: runtime.revocationAttemptCount,
    receipts: [...runtime.receipts],
    replay,
    cleanupAuthorization:
      terminalState === "revocation-failed-security-stop" ||
      terminalState === "revocation-ambiguous-security-stop"
        ? "browser-custodian-token-cleanup-and-state-reconciliation-only"
        : null,
    effects: {
      retries: 0,
      maximumConcurrency: 1,
      unexpectedProjectAccesses: 0,
      registrationMutations: 0,
      projectDraftLinkOrContributorCreations: 0,
    },
  };
}

export type M9b13kControllerDependencies = Readonly<{
  credentialReader: M9b13kCredentialReader;
  ledger: M9b13kLedger;
  transport: M9b13kTransport;
  revocationCustodian: M9b13kRevocationCustodian;
  monotonicNowMs: () => number;
}>;

async function performCoreSequence(
  activation: M9b13kActivation,
  dependencies: M9b13kControllerDependencies,
  runtime: Runtime,
  digest: string,
  credential: Uint8Array,
): Promise<ExecutionResult<null>> {
  const token = await getJson(
    dependencies,
    runtime,
    digest,
    credential,
    "token-detail",
    apiUrl(`/v2/tokens/${activation.tokenId}/`),
    "/v2/tokens/<bound-token-id>/",
    tokenDetailSchema,
  );
  if (!token.ok) return token;
  if (
    token.value.data.id !== activation.tokenId ||
    token.value.data.attributes.scopes.length !== 1 ||
    token.value.data.attributes.scopes[0] !== M9B13K_REQUIRED_SCOPE
  )
    return executionFailure("m9b13k:token-binding-or-scope");

  const project = await getJson(
    dependencies,
    runtime,
    digest,
    credential,
    "project-detail",
    apiUrl(`/v2/nodes/${M9B13K_PROJECT_ID}/`),
    "/v2/nodes/<project-id>/",
    projectDetailSchema,
  );
  if (!project.ok) return project;
  if (
    project.value.data.attributes.public ||
    !hasExactPermissions(project.value.data.attributes.current_user_permissions)
  )
    return executionFailure("m9b13k:project-privacy-or-permissions");

  const registrations = await completeCollection(
    dependencies,
    runtime,
    digest,
    credential,
    {
      requestKind: "registrations-page",
      initialUrl: apiUrl(`/v2/nodes/${M9B13K_PROJECT_ID}/registrations/`, {
        "page[size]": "100",
      }),
      expectedPath: `/v2/nodes/${M9B13K_PROJECT_ID}/registrations/`,
      endpointClass: "/v2/nodes/<project-id>/registrations/",
      maximumPages: 2,
      maximumRecords: 100,
      schema: identityCollectionSchema,
    },
  );
  if (!registrations.ok) return registrations;
  if (registrations.value.length !== 0)
    return executionFailure("m9b13k:unexpected-registration");

  const viewLinks = await completeCollection(
    dependencies,
    runtime,
    digest,
    credential,
    {
      requestKind: "view-only-links-page",
      initialUrl: apiUrl(`/v2/nodes/${M9B13K_PROJECT_ID}/view_only_links/`, {
        "page[size]": "100",
      }),
      expectedPath: `/v2/nodes/${M9B13K_PROJECT_ID}/view_only_links/`,
      endpointClass: "/v2/nodes/<project-id>/view_only_links/",
      maximumPages: 2,
      maximumRecords: 100,
      schema: identityCollectionSchema,
    },
  );
  if (!viewLinks.ok) return viewLinks;
  if (viewLinks.value.length !== 0)
    return executionFailure("m9b13k:unexpected-view-only-link");

  const files = await completeCollection(
    dependencies,
    runtime,
    digest,
    credential,
    {
      requestKind: "files-page",
      initialUrl: apiUrl(
        `/v2/nodes/${M9B13K_PROJECT_ID}/files/${M9B13K_PROVIDER}/`,
        { "page[size]": "100" },
      ),
      expectedPath: `/v2/nodes/${M9B13K_PROJECT_ID}/files/${M9B13K_PROVIDER}/`,
      endpointClass: "/v2/nodes/<project-id>/files/osfstorage/",
      maximumPages: 4,
      maximumRecords: 400,
      schema: fileCollectionSchema,
    },
  );
  if (!files.ok) return files;
  if (files.value.length !== 0)
    return executionFailure("m9b13k:preexisting-or-unexpected-file");

  const providerRoot = await getJson(
    dependencies,
    runtime,
    digest,
    credential,
    "provider-root",
    apiUrl(`/v2/nodes/${M9B13K_PROJECT_ID}/files/`, {
      "page[size]": "100",
    }),
    "/v2/nodes/<project-id>/files/",
    providerRootSchema,
  );
  if (!providerRoot.ok) return providerRoot;
  if (providerRoot.value.data.length !== 1)
    return executionFailure("m9b13k:provider-root-cardinality");
  const provider = providerRoot.value.data[0];
  if (provider === undefined)
    return executionFailure("m9b13k:provider-root-missing");
  const uploadLink = validateWaterbutlerUploadUrl(provider.links.upload);
  if (!uploadLink.ok) return executionFailure(uploadLink.error.reason);
  uploadLink.value.searchParams.set("kind", "file");
  uploadLink.value.searchParams.set("name", M9B13K_ARTIFACT_FILENAME);
  const artifact = frozenM9b13kArtifactBytes();
  const upload = await dispatchRequest(
    dependencies,
    runtime,
    digest,
    credential,
    request(
      "upload",
      "PUT",
      uploadLink.value,
      "/v1/resources/<project-id>/providers/osfstorage/?kind&name",
      M9B13K_UPLOAD_RESPONSE_MAXIMUM_BYTES,
      artifact,
    ),
  );
  artifact.fill(0);
  if (!upload.ok) return upload;
  if (
    upload.value.kind !== "response" ||
    upload.value.status !== 201 ||
    sanitizedContentType(upload.value.contentType) !==
      "application/vnd.api+json"
  )
    return executionFailure("m9b13k:upload-terminal-response", true);
  const uploadEntity = parseBoundedJson(
    upload.value,
    uploadResponseSchema,
    "m9b13k:upload-response",
  );
  if (!uploadEntity.ok)
    return executionFailure(uploadEntity.error.reason, true);

  const postFiles = await completeCollection(
    dependencies,
    runtime,
    digest,
    credential,
    {
      requestKind: "files-page",
      initialUrl: apiUrl(
        `/v2/nodes/${M9B13K_PROJECT_ID}/files/${M9B13K_PROVIDER}/`,
        { "page[size]": "100" },
      ),
      expectedPath: `/v2/nodes/${M9B13K_PROJECT_ID}/files/${M9B13K_PROVIDER}/`,
      endpointClass: "/v2/nodes/<project-id>/files/osfstorage/",
      maximumPages: 4,
      maximumRecords: 400,
      schema: fileCollectionSchema,
    },
  );
  if (!postFiles.ok) return executionFailure(postFiles.error.reason, true);
  if (
    postFiles.value.length !== 1 ||
    postFiles.value[0]?.id !== uploadEntity.value.data.id ||
    postFiles.value[0].attributes.name !== M9B13K_ARTIFACT_FILENAME
  )
    return executionFailure("m9b13k:post-upload-inventory-mismatch", true);

  const downloadLink = validateWaterbutlerDownloadUrl(
    uploadEntity.value.data.links.download,
  );
  if (!downloadLink.ok)
    return executionFailure(downloadLink.error.reason, true);
  const download = await dispatchRequest(
    dependencies,
    runtime,
    digest,
    credential,
    request(
      "download",
      "GET",
      downloadLink.value,
      "/v1/resources/<project-id>/providers/osfstorage/<stable-file-id>",
      M9B13K_ARTIFACT_BYTE_LENGTH,
    ),
  );
  if (!download.ok) return executionFailure(download.error.reason, true);
  if (
    download.value.kind !== "response" ||
    download.value.status !== 200 ||
    !["application/octet-stream", "text/plain"].includes(
      sanitizedContentType(download.value.contentType),
    ) ||
    download.value.body.byteLength !== M9B13K_ARTIFACT_BYTE_LENGTH ||
    sha256Bytes(download.value.body) !== M9B13K_ARTIFACT_SHA256
  )
    return executionFailure("m9b13k:redownload-mismatch", true);
  return { ok: true, value: null };
}

async function revoke(
  activation: M9b13kActivation,
  dependencies: M9b13kControllerDependencies,
  runtime: Runtime,
  digest: string,
  credential: Uint8Array,
): Promise<
  Readonly<{
    terminalState: M9b13kControllerOutcome["terminalState"];
    reason: string;
  }>
> {
  if (existingRevocationDispatches(runtime.snapshot) !== 0)
    return {
      terminalState: "revocation-ambiguous-security-stop",
      reason: "m9b13k:revocation-already-dispatched",
    };
  const result = await dispatchRequest(
    dependencies,
    runtime,
    digest,
    credential,
    request(
      "revoke-token",
      "DELETE",
      apiUrl(`/v2/tokens/${activation.tokenId}/`),
      "/v2/tokens/<bound-token-id>/",
      M9B13K_API_RESPONSE_MAXIMUM_BYTES,
      null,
      M9B13K_REVOCATION_DEADLINE_MS,
    ),
  );
  if (!result.ok)
    return {
      terminalState: result.error.ambiguous
        ? "revocation-ambiguous-security-stop"
        : "revocation-failed-security-stop",
      reason: result.error.reason,
    };
  if (
    result.value.kind !== "response" ||
    ![200, 204].includes(result.value.status)
  )
    return {
      terminalState: "revocation-failed-security-stop",
      reason: "m9b13k:revocation-status",
    };
  const receipt = runtime.receipts.at(-1);
  if (receipt === undefined)
    return {
      terminalState: "revocation-ambiguous-security-stop",
      reason: "m9b13k:revocation-receipt-missing",
    };
  const receiptDigest = canonicalDigest(receipt);
  if (!receiptDigest.ok)
    return {
      terminalState: "revocation-ambiguous-security-stop",
      reason: receiptDigest.error.reason,
    };
  let verification: M9b13kRevocationVerification;
  try {
    verification = await dependencies.revocationCustodian.verify({
      activationIdentity: activation.activationIdentity,
      requestIdentity: activation.requestIdentity,
      tokenId: activation.tokenId,
      revocationReceiptDigest: receiptDigest.value,
    });
  } catch {
    verification = "ambiguous";
  }
  switch (verification) {
    case "revoked":
      return {
        terminalState: "revoked-and-verified",
        reason: "m9b13k:revoked-and-verified",
      };
    case "active":
      return {
        terminalState: "revocation-failed-security-stop",
        reason: "m9b13k:custodian-reports-token-active",
      };
    case "ambiguous":
      return {
        terminalState: "revocation-ambiguous-security-stop",
        reason: "m9b13k:custodian-verification-ambiguous",
      };
  }
}

export async function runM9b13kOsfPatCanaryController(
  candidateActivation: unknown,
  dependencies: M9b13kControllerDependencies,
): Promise<M9b13kControllerOutcome> {
  const emptyRuntime: Runtime = {
    snapshot: {
      protocol: M9B13K_LEDGER_PROTOCOL,
      namespace: "unvalidated",
      revision: 0,
      root: initialLedgerRoot("unvalidated"),
      events: [],
    },
    receipts: [],
    requestCount: 0,
    putDispatchCount: 0,
    revocationAttemptCount: 0,
    controllerDeadlineAtMs: 0,
  };
  const parsedActivation =
    m9b13kActivationSchema.safeParse(candidateActivation);
  if (!parsedActivation.success)
    return outcome(
      null,
      null,
      emptyRuntime,
      "not-activated",
      "m9b13k:activation-invalid",
      false,
      false,
    );
  const activation = parsedActivation.data;
  const artifact = frozenM9b13kArtifactBytes();
  const artifactValid =
    artifact.byteLength === M9B13K_ARTIFACT_BYTE_LENGTH &&
    sha256Bytes(artifact) === M9B13K_ARTIFACT_SHA256;
  artifact.fill(0);
  if (!artifactValid)
    return outcome(
      activation,
      null,
      emptyRuntime,
      "not-activated",
      "m9b13k:frozen-artifact-invalid",
      false,
      false,
    );

  let snapshot: M9b13kLedgerSnapshot;
  try {
    snapshot = await dependencies.ledger.snapshot();
  } catch {
    return outcome(
      activation,
      null,
      emptyRuntime,
      "not-activated",
      "m9b13k:ledger-snapshot-unavailable",
      false,
      false,
    );
  }
  const checkedLedger = validateLedger(snapshot, activation.ledgerNamespace);
  if (!checkedLedger.ok)
    return outcome(
      activation,
      null,
      emptyRuntime,
      "not-activated",
      checkedLedger.error.reason,
      false,
      false,
    );
  const digest = activationDigest(activation);
  if (!digest.ok)
    return outcome(
      activation,
      null,
      emptyRuntime,
      "not-activated",
      digest.error.reason,
      false,
      false,
    );
  if (
    checkedLedger.value.events[0] !== undefined &&
    checkedLedger.value.events[0].activationDigest !== digest.value
  )
    return outcome(
      activation,
      null,
      emptyRuntime,
      "not-activated",
      "m9b13k:ledger-activation-mismatch",
      false,
      false,
    );
  const runtime: Runtime = {
    snapshot: checkedLedger.value,
    receipts: [],
    requestCount: 0,
    putDispatchCount: existingPutDispatches(checkedLedger.value),
    revocationAttemptCount: existingRevocationDispatches(checkedLedger.value),
    controllerDeadlineAtMs: 0,
  };
  if (hasTerminalEvent(runtime.snapshot))
    return outcome(
      activation,
      activation.expectedCredentialFingerprint,
      runtime,
      "not-activated",
      M9B13K_ZERO_EFFECT_REPLAY_PROTOCOL,
      true,
      false,
    );

  try {
    runtime.controllerDeadlineAtMs =
      dependencies.monotonicNowMs() + M9B13K_CONTROLLER_DEADLINE_MS;
  } catch {
    return outcome(
      activation,
      null,
      runtime,
      "not-activated",
      "m9b13k:monotonic-clock-unavailable",
      false,
      false,
    );
  }

  const credentialRead = dependencies.credentialReader.readOnce();
  if (!credentialRead.ok)
    return outcome(
      activation,
      null,
      runtime,
      "not-activated",
      `m9b13k:${credentialRead.error.kind}`,
      false,
      false,
    );
  const credential = credentialRead.value;
  const credentialToken = credential.subarray(0, 64);
  const fingerprint = deriveM9b13kCredentialFingerprint(
    activation.activationIdentity,
    activation.tokenId,
    credentialToken,
  );
  if (fingerprint !== activation.expectedCredentialFingerprint) {
    credential.fill(0);
    return outcome(
      activation,
      fingerprint,
      runtime,
      "not-activated",
      "m9b13k:credential-fingerprint-mismatch",
      false,
      false,
    );
  }

  let activated = runtime.snapshot.revision !== 0;
  let coreResult: ExecutionResult<null>;
  let revocationResult: Awaited<ReturnType<typeof revoke>> = {
    terminalState: "revocation-ambiguous-security-stop",
    reason: "m9b13k:revocation-not-attempted",
  };
  try {
    if (!activated) {
      const reservation = await appendLedger(
        dependencies,
        runtime,
        digest.value,
        {
          kind: "activation-reserved",
          requestKind: null,
          outcomeClass: null,
        },
      );
      if (!reservation.ok)
        return outcome(
          activation,
          fingerprint,
          runtime,
          "not-activated",
          reservation.error.reason,
          false,
          false,
        );
      activated = true;
    }
    if (runtime.putDispatchCount !== 0)
      coreResult = executionFailure(
        "m9b13k:restart-after-put-never-redispatch",
        true,
      );
    else
      coreResult = await performCoreSequence(
        activation,
        dependencies,
        runtime,
        digest.value,
        credentialToken,
      );
  } finally {
    try {
      if (activated)
        revocationResult = await revoke(
          activation,
          dependencies,
          runtime,
          digest.value,
          credentialToken,
        );
    } catch {
      revocationResult = {
        terminalState: "revocation-ambiguous-security-stop",
        reason: "m9b13k:revocation-boundary-threw",
      };
    } finally {
      credential.fill(0);
    }
  }

  const coreSucceeded = coreResult.ok;
  const revoked = revocationResult.terminalState === "revoked-and-verified";
  const terminalReason = !revoked
    ? revocationResult.reason
    : coreSucceeded
      ? "m9b13k:controller-completed-and-pat-revoked"
      : coreResult.error.reason;
  const terminalWrite = await appendLedger(
    dependencies,
    runtime,
    digest.value,
    {
      kind: "terminal",
      requestKind: null,
      outcomeClass: terminalReason,
    },
  );
  const ledgerTerminalAmbiguous = !terminalWrite.ok;
  const terminalState = ledgerTerminalAmbiguous
    ? "revocation-ambiguous-security-stop"
    : revocationResult.terminalState;
  return outcome(
    activation,
    fingerprint,
    runtime,
    terminalState,
    ledgerTerminalAmbiguous ? terminalWrite.error.reason : terminalReason,
    false,
    coreSucceeded && revoked && !ledgerTerminalAmbiguous,
  );
}
