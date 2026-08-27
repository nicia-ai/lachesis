import { createHash } from "node:crypto";
import type { ClientRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { type Result } from "@nicia-ai/lachesis";

import {
  frozenM9b13k3ArtifactBytes,
  M9B13K3_ARTIFACT_BYTE_LENGTH,
  M9B13K3_ARTIFACT_FILENAME,
  M9B13K3_ARTIFACT_SHA256,
  M9B13K3_LOOPBACK_TRANSPORT_PROTOCOL,
  M9B13K3_PRODUCTION_TRANSPORT_PROTOCOL,
  M9B13K3_PROJECT_ID,
  M9B13K3_PROVIDER,
  M9B13K3_REQUEST_TIMEOUT_MS,
  m9b13k3DomainDigest,
  type M9b13k3Failure,
  m9b13k3Failure,
  m9b13k3Sha256,
  m9b13k3TokenIdSchema,
} from "./protocol.js";

export type M9b13k3RequestIntent =
  | Readonly<{ requestClass: "project-detail" }>
  | Readonly<{ requestClass: "token-detail" }>
  | Readonly<{ requestClass: "registrations" }>
  | Readonly<{ requestClass: "drafts" }>
  | Readonly<{ requestClass: "provider-root" }>
  | Readonly<{ requestClass: "inventory" }>
  | Readonly<{ requestClass: "upload" }>
  | Readonly<{ requestClass: "revoke-token" }>
  | Readonly<{ requestClass: "download"; objectId: string }>;

export type M9b13k3TransportFault =
  | "none"
  | "request-construction-throws"
  | "callback-registration-throws"
  | "write-throws"
  | "end-throws";

type LoopbackRoute = Readonly<{
  hostname: "127.0.0.1" | "::1";
  port: number;
  certificateAuthorityPem: string;
  fault: M9b13k3TransportFault;
}>;

type ResolvedRequest = Readonly<{
  requestClass: M9b13k3RequestIntent["requestClass"];
  method: "DELETE" | "GET" | "PUT";
  logicalUrl: URL;
  pathClass: string;
  maximumResponseBytes: number;
  body: Uint8Array | null;
  bodyDigest: string | null;
}>;

export type M9b13k3TransportReceipt = Readonly<{
  protocol: typeof M9B13K3_LOOPBACK_TRANSPORT_PROTOCOL;
  requestClass: M9b13k3RequestIntent["requestClass"];
  method: "DELETE" | "GET" | "PUT";
  logicalUrl: string;
  logicalHost: string;
  pathClass: string;
  tokenId: string;
  requestDigest: string;
  requestBodyDigest: string | null;
  dispatched: boolean;
  status: number | null;
  responseDigest: string | null;
  responseBytes: number;
  outcome:
    | "response"
    | "controller-aborted"
    | "per-request-timeout"
    | "redirect-rejected"
    | "response-oversized"
    | "response-invalid"
    | "transport-error"
    | "injected-construction-failure"
    | "injected-callback-registration-failure"
    | "injected-write-failure"
    | "injected-end-failure";
  ambiguity: "none" | "before-dispatch" | "after-dispatch";
  socketDestroyed: boolean;
  retries: 0;
}>;

const loopbackBrand: unique symbol = Symbol("M9b13k3LoopbackTransport");
export type M9b13k3LoopbackTransportCapability = Readonly<{
  [loopbackBrand]: "M9b13k3LoopbackTransportCapability";
}>;
const loopbackTransports = new WeakMap<object, LoopbackRoute>();

const productionBrand: unique symbol = Symbol("M9b13k3ProductionTransport");
export type M9b13k3ProductionTransportCapability = Readonly<{
  [productionBrand]: "M9b13k3ProductionTransportCapability";
}>;
const productionTransports = new WeakSet<object>();

const productionAuthorityBrand: unique symbol = Symbol(
  "M9b13k3ProductionEffectAuthority",
);
export type M9b13k3ProductionEffectAuthority = Readonly<{
  [productionAuthorityBrand]: "M9b13k3ProductionEffectAuthority";
}>;
const productionAuthorities = new WeakSet<object>();

const responseBrand: unique symbol = Symbol("M9b13k3RawResponse");
export type M9b13k3RawResponse = Readonly<{
  [responseBrand]: "M9b13k3RawResponse";
}>;
type RawResponseState = Readonly<{
  receipt: M9b13k3TransportReceipt;
  body: Uint8Array;
}>;
const rawResponses = new WeakMap<object, RawResponseState>();

export type M9b13k3TransportResult = Readonly<{
  receipt: M9b13k3TransportReceipt;
  response: M9b13k3RawResponse | null;
}>;

export function createM9b13k3LoopbackTransport(
  route: Readonly<{
    hostname: "127.0.0.1" | "::1";
    port: number;
    certificateAuthorityPem: string;
    fault?: M9b13k3TransportFault;
  }>,
): Result<M9b13k3LoopbackTransportCapability, M9b13k3Failure> {
  if (
    !["127.0.0.1", "::1"].includes(route.hostname) ||
    !Number.isSafeInteger(route.port) ||
    route.port < 1 ||
    route.port > 65_535 ||
    route.certificateAuthorityPem.length === 0
  )
    return m9b13k3Failure("transport", "m9b13k3-loopback-route-invalid");
  const transport: M9b13k3LoopbackTransportCapability = Object.freeze({
    [loopbackBrand]: "M9b13k3LoopbackTransportCapability",
  });
  loopbackTransports.set(transport, {
    ...route,
    fault: route.fault ?? "none",
  });
  return { ok: true, value: transport };
}

export function createM9b13k3ProductionTransportForConformanceInspection(): M9b13k3ProductionTransportCapability {
  const transport: M9b13k3ProductionTransportCapability = Object.freeze({
    [productionBrand]: "M9b13k3ProductionTransportCapability",
  });
  productionTransports.add(transport);
  return transport;
}

export function isM9b13k3LoopbackTransportCapability(
  value: object,
): value is M9b13k3LoopbackTransportCapability {
  return loopbackTransports.has(value);
}

export function inspectM9b13k3ProductionDispatch(
  transport: M9b13k3ProductionTransportCapability,
  authority: M9b13k3ProductionEffectAuthority,
): Result<never, M9b13k3Failure> {
  return productionTransports.has(transport) &&
    productionAuthorities.has(authority)
    ? m9b13k3Failure(
        "activation",
        "m9b13k3-production-dispatch-not-implemented-before-activation-review",
      )
    : m9b13k3Failure(
        "activation",
        "m9b13k3-production-effect-authority-unavailable",
      );
}

function exactObjectId(value: string): boolean {
  return /^[A-Za-z0-9._~-]{1,128}$/u.test(value);
}

function resolveRequest(
  intent: M9b13k3RequestIntent,
  tokenId: string,
): Result<ResolvedRequest, M9b13k3Failure> {
  if (!m9b13k3TokenIdSchema.safeParse(tokenId).success)
    return m9b13k3Failure("transport", "m9b13k3-bound-token-invalid");
  const api = "https://api.osf.io";
  const files = `https://files.osf.io/v1/resources/${M9B13K3_PROJECT_ID}/providers/${M9B13K3_PROVIDER}/`;
  const get = (
    logicalUrl: string,
    pathClass: string,
    maximumResponseBytes = 262_144,
  ): Result<ResolvedRequest, M9b13k3Failure> => ({
    ok: true,
    value: {
      requestClass: intent.requestClass,
      method: "GET",
      logicalUrl: new URL(logicalUrl),
      pathClass,
      maximumResponseBytes,
      body: null,
      bodyDigest: null,
    },
  });
  switch (intent.requestClass) {
    case "project-detail":
      return get(
        `${api}/v2/nodes/${M9B13K3_PROJECT_ID}/`,
        "/v2/nodes/<project>/",
      );
    case "token-detail":
      return get(`${api}/v2/tokens/${tokenId}/`, "/v2/tokens/<bound-token>/");
    case "registrations":
      return get(
        `${api}/v2/nodes/${M9B13K3_PROJECT_ID}/registrations/?page%5Bsize%5D=100`,
        "/v2/nodes/<project>/registrations/",
      );
    case "drafts":
      return get(
        `${api}/v2/nodes/${M9B13K3_PROJECT_ID}/draft_registrations/?page%5Bsize%5D=100`,
        "/v2/nodes/<project>/draft_registrations/",
      );
    case "provider-root":
      return get(files, "/v1/resources/<project>/providers/osfstorage/");
    case "inventory":
      return get(
        `${files}?page%5Bsize%5D=100`,
        "/v1/resources/<project>/providers/osfstorage/",
      );
    case "download":
      return exactObjectId(intent.objectId)
        ? get(
            `${files}${intent.objectId}`,
            "/v1/resources/<project>/providers/osfstorage/<object>/",
            M9B13K3_ARTIFACT_BYTE_LENGTH,
          )
        : m9b13k3Failure("transport", "m9b13k3-download-object-id-invalid");
    case "upload": {
      const body = frozenM9b13k3ArtifactBytes();
      const digest = m9b13k3Sha256(body);
      if (
        body.byteLength !== M9B13K3_ARTIFACT_BYTE_LENGTH ||
        digest !== M9B13K3_ARTIFACT_SHA256
      ) {
        body.fill(0);
        return m9b13k3Failure("transport", "m9b13k3-frozen-artifact-invalid");
      }
      return {
        ok: true,
        value: {
          requestClass: "upload",
          method: "PUT",
          logicalUrl: new URL(
            `${files}?kind=file&name=${encodeURIComponent(M9B13K3_ARTIFACT_FILENAME)}`,
          ),
          pathClass: "/v1/resources/<project>/providers/osfstorage/",
          maximumResponseBytes: 65_536,
          body,
          bodyDigest: digest,
        },
      };
    }
    case "revoke-token":
      return {
        ok: true,
        value: {
          requestClass: "revoke-token",
          method: "DELETE",
          logicalUrl: new URL(`${api}/v2/tokens/${tokenId}/`),
          pathClass: "/v2/tokens/<bound-token>/",
          maximumResponseBytes: 65_536,
          body: null,
          bodyDigest: null,
        },
      };
  }
}

function requestDigest(request: ResolvedRequest, tokenId: string): string {
  return m9b13k3DomainDigest(
    M9B13K3_LOOPBACK_TRANSPORT_PROTOCOL,
    request.requestClass,
    request.method,
    request.logicalUrl.href,
    tokenId,
    request.bodyDigest ?? "no-body",
  );
}

function failureReceipt(
  request: ResolvedRequest,
  tokenId: string,
  dispatched: boolean,
  outcome: Exclude<M9b13k3TransportReceipt["outcome"], "response">,
  socketDestroyed: boolean,
): M9b13k3TransportReceipt {
  return {
    protocol: M9B13K3_LOOPBACK_TRANSPORT_PROTOCOL,
    requestClass: request.requestClass,
    method: request.method,
    logicalUrl: request.logicalUrl.href,
    logicalHost: request.logicalUrl.hostname,
    pathClass: request.pathClass,
    tokenId,
    requestDigest: requestDigest(request, tokenId),
    requestBodyDigest: request.bodyDigest,
    dispatched,
    status: null,
    responseDigest: null,
    responseBytes: 0,
    outcome,
    ambiguity: dispatched ? "after-dispatch" : "before-dispatch",
    socketDestroyed,
    retries: 0,
  };
}

function responseHandle(
  receipt: M9b13k3TransportReceipt,
  body: Uint8Array,
): M9b13k3RawResponse {
  const handle: M9b13k3RawResponse = Object.freeze({
    [responseBrand]: "M9b13k3RawResponse",
  });
  rawResponses.set(handle, { receipt, body: body.slice() });
  return handle;
}

export function inspectM9b13k3RawResponse(
  response: M9b13k3RawResponse,
): Result<RawResponseState, M9b13k3Failure> {
  const state = rawResponses.get(response);
  return state === undefined
    ? m9b13k3Failure("reconciliation", "m9b13k3-raw-response-handle-invalid")
    : {
        ok: true,
        value: { receipt: state.receipt, body: state.body.slice() },
      };
}

export async function dispatchM9b13k3LoopbackRequest(
  transport: M9b13k3LoopbackTransportCapability,
  intent: M9b13k3RequestIntent,
  boundTokenId: string,
  credential: Uint8Array,
  timeoutMs: number,
  controllerSignal: AbortSignal,
): Promise<Result<M9b13k3TransportResult, M9b13k3Failure>> {
  const route = loopbackTransports.get(transport);
  if (route === undefined)
    return m9b13k3Failure("transport", "m9b13k3-loopback-capability-invalid");
  if (
    credential.byteLength !== 64 ||
    !Array.from(credential).every(
      (byte) =>
        (byte >= 0x30 && byte <= 0x39) ||
        (byte >= 0x41 && byte <= 0x5a) ||
        (byte >= 0x61 && byte <= 0x7a),
    )
  )
    return m9b13k3Failure("credential", "m9b13k3-credential-shape-invalid");
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > M9B13K3_REQUEST_TIMEOUT_MS
  )
    return m9b13k3Failure("deadline", "m9b13k3-request-timeout-invalid");
  const resolved = resolveRequest(intent, boundTokenId);
  if (!resolved.ok) return resolved;
  const request = resolved.value;
  const finishBody = (): void => {
    request.body?.fill(0);
  };
  if (route.fault === "request-construction-throws") {
    finishBody();
    return {
      ok: true,
      value: {
        receipt: failureReceipt(
          request,
          boundTokenId,
          false,
          "injected-construction-failure",
          false,
        ),
        response: null,
      },
    };
  }

  return await new Promise((resolve) => {
    let settled = false;
    let dispatchMayHaveOccurred = false;
    let clientRequest: ClientRequest | null = null;
    const authorizationBuffer = Buffer.from(credential);
    const authorization = `Bearer ${authorizationBuffer.toString("ascii")}`;
    authorizationBuffer.fill(0);
    const cleanup = (): void => {
      clearTimeout(timeout);
      controllerSignal.removeEventListener("abort", onAbort);
      finishBody();
    };
    const finish = (result: M9b13k3TransportResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: true, value: result });
    };
    const fail = (
      outcome: Exclude<M9b13k3TransportReceipt["outcome"], "response">,
    ): void => {
      if (settled) return;
      clientRequest?.destroy();
      finish({
        receipt: failureReceipt(
          request,
          boundTokenId,
          dispatchMayHaveOccurred,
          outcome,
          clientRequest !== null,
        ),
        response: null,
      });
    };
    const onAbort = (): void => { fail("controller-aborted"); };
    const timeout = setTimeout(() => { fail("per-request-timeout"); }, timeoutMs);
    timeout.unref();
    controllerSignal.addEventListener("abort", onAbort, { once: true });
    if (controllerSignal.aborted) {
      onAbort();
      return;
    }
    try {
      clientRequest = httpsRequest(
        {
          protocol: "https:",
          hostname: route.hostname,
          port: route.port,
          servername: request.logicalUrl.hostname,
          method: request.method,
          path: `${request.logicalUrl.pathname}${request.logicalUrl.search}`,
          ca: route.certificateAuthorityPem,
          rejectUnauthorized: true,
          headers: {
            authorization,
            host: request.logicalUrl.hostname,
            "content-length": request.body?.byteLength ?? 0,
          },
        },
        (response) => {
          const status = response.statusCode;
          if (status === undefined) {
            fail("response-invalid");
            return;
          }
          if (status >= 300 && status < 400) {
            fail("redirect-rejected");
            return;
          }
          const chunks: Array<Buffer> = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            if (settled) return;
            bytes += chunk.byteLength;
            if (bytes > request.maximumResponseBytes) {
              fail("response-oversized");
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          response.once("aborted", () => { fail("transport-error"); });
          response.once("error", () => { fail("transport-error"); });
          response.once("end", () => {
            if (settled) return;
            const body = Buffer.concat(chunks, bytes);
            const responseDigest = createHash("sha256")
              .update(body)
              .digest("hex");
            const receipt: M9b13k3TransportReceipt = {
              protocol: M9B13K3_LOOPBACK_TRANSPORT_PROTOCOL,
              requestClass: request.requestClass,
              method: request.method,
              logicalUrl: request.logicalUrl.href,
              logicalHost: request.logicalUrl.hostname,
              pathClass: request.pathClass,
              tokenId: boundTokenId,
              requestDigest: requestDigest(request, boundTokenId),
              requestBodyDigest: request.bodyDigest,
              dispatched: true,
              status,
              responseDigest,
              responseBytes: bytes,
              outcome: "response",
              ambiguity: "none",
              socketDestroyed: false,
              retries: 0,
            };
            const bytesCopy = new Uint8Array(body);
            const handle = responseHandle(receipt, bytesCopy);
            bytesCopy.fill(0);
            body.fill(0);
            finish({ receipt, response: handle });
          });
        },
      );
      if (route.fault === "callback-registration-throws") {
        clientRequest.once("error", () => undefined);
        clientRequest.destroy();
        finish({
          receipt: failureReceipt(
            request,
            boundTokenId,
            false,
            "injected-callback-registration-failure",
            true,
          ),
          response: null,
        });
        return;
      }
      clientRequest.once("error", () => { fail("transport-error"); });
      dispatchMayHaveOccurred = true;
      if (request.body !== null) {
        if (route.fault === "write-throws") throw new Error("injected-write");
        clientRequest.write(request.body);
      }
      if (route.fault === "end-throws") throw new Error("injected-end");
      clientRequest.end();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown";
      const outcome = dispatchMayHaveOccurred
        ? message === "injected-write"
          ? "injected-write-failure"
          : message === "injected-end"
            ? "injected-end-failure"
            : "transport-error"
        : "injected-construction-failure";
      fail(outcome);
    }
  });
}

export function inspectM9b13k3TransportProtocols(): Readonly<{
  loopback: typeof M9B13K3_LOOPBACK_TRANSPORT_PROTOCOL;
  production: typeof M9B13K3_PRODUCTION_TRANSPORT_PROTOCOL;
  productionAuthorityAvailable: false;
}> {
  return {
    loopback: M9B13K3_LOOPBACK_TRANSPORT_PROTOCOL,
    production: M9B13K3_PRODUCTION_TRANSPORT_PROTOCOL,
    productionAuthorityAvailable: false,
  };
}
