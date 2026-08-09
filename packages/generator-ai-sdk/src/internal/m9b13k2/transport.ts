import { createHash } from "node:crypto";
import type { ClientRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { type Result } from "@nicia-ai/lachesis";

import {
  type M9b13k2RequestClass,
  m9b13k2RequestClassSchema,
} from "./ledger.js";
import {
  M9B13K2_ARTIFACT_FILENAME,
  M9B13K2_MAXIMUM_REQUEST_BODY_BYTES,
  M9B13K2_PROJECT_ID,
  M9B13K2_PROVIDER,
  M9B13K2_REQUEST_TIMEOUT_MS,
  M9B13K2_TRANSPORT_PROTOCOL,
  m9b13k2DomainDigest,
  type M9b13k2Failure,
  m9b13k2Failure,
} from "./protocol.js";

const ALLOWED_FILE_HOSTS = new Set([
  "files.osf.io",
  "files.us.osf.io",
  "files.eu.osf.io",
  "files.au.osf.io",
  "files.ca.osf.io",
]);

export type M9b13k2TransportRequest = Readonly<{
  requestClass: M9b13k2RequestClass;
  method: "DELETE" | "GET" | "PUT";
  logicalUrl: URL;
  tokenId: string;
  pathClass: string;
  body: Uint8Array | null;
  maximumResponseBytes: number;
  timeoutMs: number;
}>;

export type M9b13k2TransportReceipt = Readonly<{
  protocol: typeof M9B13K2_TRANSPORT_PROTOCOL;
  requestClass: M9b13k2RequestClass;
  method: "DELETE" | "GET" | "PUT";
  urlDigest: string;
  logicalHost: string;
  pathClass: string;
  queryNames: ReadonlyArray<string>;
  dispatched: boolean;
  status: number | null;
  responseDigest: string | null;
  responseBytes: number;
  contentType: string | null;
  outcome:
    | "response"
    | "concurrent-dispatch-rejected"
    | "controller-aborted"
    | "per-request-timeout"
    | "redirect-rejected"
    | "response-oversized"
    | "response-headers-invalid"
    | "tls-or-transport-error";
  ambiguity: "none" | "before-dispatch" | "after-dispatch";
  latencyMs: number;
  socketDestroyed: boolean;
  retries: 0;
}>;

export type M9b13k2TransportResult = Readonly<{
  receipt: M9b13k2TransportReceipt;
  body: Uint8Array | null;
}>;

type LoopbackRoute = Readonly<{
  hostname: "127.0.0.1" | "::1";
  port: number;
  certificateAuthorityPem: string;
}>;

type TransportState = {
  mode: "production" | "synthetic-loopback-conformance";
  route: LoopbackRoute | null;
  inFlight: boolean;
};

const transportBrand: unique symbol = Symbol("M9b13k2HttpsTransport");
export type M9b13k2HttpsTransport = Readonly<{
  [transportBrand]: "M9b13k2HttpsTransport";
}>;
const transports = new WeakMap<object, TransportState>();

function createTransport(state: TransportState): M9b13k2HttpsTransport {
  const transport: M9b13k2HttpsTransport = Object.freeze({
    [transportBrand]: "M9b13k2HttpsTransport",
  });
  transports.set(transport, state);
  return transport;
}

export function createM9b13k2ProductionHttpsTransport(): M9b13k2HttpsTransport {
  return createTransport({ mode: "production", route: null, inFlight: false });
}

/** Private conformance adapter; the live controller never calls this factory. */
export function createM9b13k2LoopbackHttpsTransport(
  route: LoopbackRoute,
): Result<M9b13k2HttpsTransport, M9b13k2Failure> {
  if (
    !["127.0.0.1", "::1"].includes(route.hostname) ||
    !Number.isSafeInteger(route.port) ||
    route.port < 1 ||
    route.port > 65_535 ||
    route.certificateAuthorityPem.length < 1
  )
    return m9b13k2Failure("transport", "m9b13k2-loopback-route-invalid");
  return {
    ok: true,
    value: createTransport({
      mode: "synthetic-loopback-conformance",
      route,
      inFlight: false,
    }),
  };
}

function resolveTransport(
  value: M9b13k2HttpsTransport,
): Result<TransportState, M9b13k2Failure> {
  const state = transports.get(value);
  return state === undefined
    ? m9b13k2Failure("transport", "m9b13k2-transport-handle-invalid")
    : { ok: true, value: state };
}

function commonUrlPolicy(url: URL): Result<URL, M9b13k2Failure> {
  if (
    Array.from(url.href).some((character) => {
      const point = character.codePointAt(0);
      return point === undefined || point > 0x7f;
    })
  )
    return m9b13k2Failure("transport", "m9b13k2-url-non-ascii");
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.port !== "" ||
    isIP(url.hostname) !== 0 ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.includes("xn--")
  )
    return m9b13k2Failure("transport", "m9b13k2-url-common-policy-rejected");
  return { ok: true, value: url };
}

function queryNames(url: URL): ReadonlyArray<string> {
  return Array.from(new Set(url.searchParams.keys())).toSorted();
}

function exactQueryNames(url: URL, expected: ReadonlyArray<string>): boolean {
  const observed = queryNames(url);
  return (
    observed.length === expected.length &&
    observed.every((name, index) => name === expected[index]) &&
    observed.every((name) => url.searchParams.getAll(name).length === 1)
  );
}

function validateLogicalRequest(
  request: M9b13k2TransportRequest,
  mode: TransportState["mode"],
): Result<URL, M9b13k2Failure> {
  const requestClass = m9b13k2RequestClassSchema.safeParse(
    request.requestClass,
  );
  const common = commonUrlPolicy(request.logicalUrl);
  if (!requestClass.success)
    return m9b13k2Failure("transport", "m9b13k2-request-class-invalid");
  if (!common.ok) return common;
  if (
    !/^[a-f0-9]{24}$/u.test(request.tokenId) ||
    request.pathClass.length < 1 ||
    request.pathClass.length > 256 ||
    !Number.isSafeInteger(request.maximumResponseBytes) ||
    request.maximumResponseBytes < 0 ||
    request.maximumResponseBytes > 262_144 ||
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs < 1 ||
    request.timeoutMs > M9B13K2_REQUEST_TIMEOUT_MS ||
    (mode === "production" &&
      request.timeoutMs !== M9B13K2_REQUEST_TIMEOUT_MS) ||
    (request.body?.byteLength ?? 0) > M9B13K2_MAXIMUM_REQUEST_BODY_BYTES
  )
    return m9b13k2Failure("transport", "m9b13k2-request-envelope-invalid");

  const url = common.value;
  const apiPaths: Readonly<
    Record<
      Exclude<M9b13k2RequestClass, "upload" | "download">,
      Readonly<{
        method: "DELETE" | "GET";
        path: string;
        query: ReadonlyArray<string>;
      }>
    >
  > = {
    "token-detail": {
      method: "GET",
      path: `/v2/tokens/${request.tokenId}/`,
      query: [],
    },
    "project-detail": {
      method: "GET",
      path: `/v2/nodes/${M9B13K2_PROJECT_ID}/`,
      query: [],
    },
    registrations: {
      method: "GET",
      path: `/v2/nodes/${M9B13K2_PROJECT_ID}/registrations/`,
      query: ["page[size]"],
    },
    "view-only-links": {
      method: "GET",
      path: `/v2/nodes/${M9B13K2_PROJECT_ID}/view_only_links/`,
      query: ["page[size]"],
    },
    "files-inventory": {
      method: "GET",
      path: `/v2/nodes/${M9B13K2_PROJECT_ID}/files/${M9B13K2_PROVIDER}/`,
      query: ["page[size]"],
    },
    "provider-root": {
      method: "GET",
      path: `/v2/nodes/${M9B13K2_PROJECT_ID}/files/`,
      query: ["page[size]"],
    },
    "revoke-token": {
      method: "DELETE",
      path: `/v2/tokens/${request.tokenId}/`,
      query: [],
    },
  };
  if (
    request.requestClass !== "upload" &&
    request.requestClass !== "download"
  ) {
    const policy = apiPaths[request.requestClass];
    if (
      url.hostname !== "api.osf.io" ||
      request.method !== policy.method ||
      url.pathname !== policy.path ||
      !exactQueryNames(url, policy.query) ||
      (policy.query.includes("page[size]") &&
        url.searchParams.get("page[size]") !== "100") ||
      request.body !== null
    )
      return m9b13k2Failure("transport", "m9b13k2-api-request-policy-rejected");
    return { ok: true, value: url };
  }
  const prefix = `/v1/resources/${M9B13K2_PROJECT_ID}/providers/${M9B13K2_PROVIDER}/`;
  if (!ALLOWED_FILE_HOSTS.has(url.hostname) || !url.pathname.startsWith(prefix))
    return m9b13k2Failure(
      "transport",
      "m9b13k2-waterbutler-host-or-prefix-rejected",
    );
  if (request.requestClass === "upload") {
    if (
      request.method !== "PUT" ||
      url.pathname !== prefix ||
      !exactQueryNames(url, ["kind", "name"]) ||
      url.searchParams.get("kind") !== "file" ||
      url.searchParams.get("name") !== M9B13K2_ARTIFACT_FILENAME ||
      request.body?.byteLength !== M9B13K2_MAXIMUM_REQUEST_BODY_BYTES
    )
      return m9b13k2Failure(
        "transport",
        "m9b13k2-upload-request-policy-rejected",
      );
    return { ok: true, value: url };
  }
  const objectId = url.pathname.slice(prefix.length);
  if (
    request.method !== "GET" ||
    request.body !== null ||
    objectId.length < 1 ||
    objectId.includes("%") ||
    objectId.includes("/") ||
    !/^[A-Za-z0-9._~-]+$/u.test(objectId) ||
    !exactQueryNames(url, [])
  )
    return m9b13k2Failure(
      "transport",
      "m9b13k2-download-request-policy-rejected",
    );
  return { ok: true, value: url };
}

function validCredentialShape(credential: Uint8Array): boolean {
  if (credential.byteLength !== 64) return false;
  for (const byte of credential) {
    const valid =
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a);
    if (!valid) return false;
  }
  return true;
}

function failureResult(
  request: M9b13k2TransportRequest,
  startedAtMs: number,
  dispatched: boolean,
  outcome: Exclude<M9b13k2TransportReceipt["outcome"], "response">,
  socketDestroyed: boolean,
): M9b13k2TransportResult {
  return {
    body: null,
    receipt: {
      protocol: M9B13K2_TRANSPORT_PROTOCOL,
      requestClass: request.requestClass,
      method: request.method,
      urlDigest: m9b13k2DomainDigest(
        M9B13K2_TRANSPORT_PROTOCOL,
        request.logicalUrl.href,
      ),
      logicalHost: request.logicalUrl.hostname,
      pathClass: request.pathClass,
      queryNames: queryNames(request.logicalUrl),
      dispatched,
      status: null,
      responseDigest: null,
      responseBytes: 0,
      contentType: null,
      outcome,
      ambiguity: dispatched ? "after-dispatch" : "before-dispatch",
      latencyMs: Math.max(0, performance.now() - startedAtMs),
      socketDestroyed,
      retries: 0,
    },
  };
}

export async function dispatchM9b13k2HttpsRequest(
  transport: M9b13k2HttpsTransport,
  request: M9b13k2TransportRequest,
  credential: Uint8Array,
  controllerSignal: AbortSignal,
): Promise<Result<M9b13k2TransportResult, M9b13k2Failure>> {
  const resolved = resolveTransport(transport);
  if (!resolved.ok) return resolved;
  const valid = validateLogicalRequest(request, resolved.value.mode);
  if (!valid.ok) return valid;
  if (!validCredentialShape(credential))
    return m9b13k2Failure(
      "credential",
      "m9b13k2-transport-credential-shape-invalid",
    );
  const startedAtMs = performance.now();
  if (resolved.value.inFlight)
    return {
      ok: true,
      value: failureResult(
        request,
        startedAtMs,
        false,
        "concurrent-dispatch-rejected",
        false,
      ),
    };
  resolved.value.inFlight = true;

  try {
    return {
      ok: true,
      value: await new Promise<M9b13k2TransportResult>((resolve) => {
        let settled = false;
        let dispatched = false;
        const requestHolder: { value: ClientRequest | null } = { value: null };
        let socketDestroyed = false;
        const chunks: Array<Buffer> = [];
        let responseBytes = 0;
        let responseStatus: number | null = null;
        let responseContentType: string | null = null;

        const finish = (result: M9b13k2TransportResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          controllerSignal.removeEventListener("abort", onControllerAbort);
          resolve(result);
        };
        const destroyAndFail = (
          outcome: Exclude<M9b13k2TransportReceipt["outcome"], "response">,
        ): void => {
          if (settled) return;
          socketDestroyed = true;
          finish(
            failureResult(
              request,
              startedAtMs,
              dispatched,
              outcome,
              socketDestroyed,
            ),
          );
          requestHolder.value?.destroy();
        };
        const onControllerAbort = (): void => {
          destroyAndFail("controller-aborted");
        };
        const timeout = setTimeout(() => {
          destroyAndFail("per-request-timeout");
        }, request.timeoutMs);
        timeout.unref();
        controllerSignal.addEventListener("abort", onControllerAbort, {
          once: true,
        });
        if (controllerSignal.aborted) {
          onControllerAbort();
          return;
        }

        const route = resolved.value.route;
        const authorizationBytes = Buffer.from(credential);
        const authorization = `Bearer ${authorizationBytes.toString("ascii")}`;
        authorizationBytes.fill(0);
        const clientRequest = httpsRequest(
          {
            protocol: "https:",
            hostname: route?.hostname ?? valid.value.hostname,
            port: route?.port ?? 443,
            servername: valid.value.hostname,
            method: request.method,
            path: `${valid.value.pathname}${valid.value.search}`,
            ca: route?.certificateAuthorityPem,
            rejectUnauthorized: true,
            headers: {
              authorization,
              host: valid.value.hostname,
              "content-length": request.body?.byteLength ?? 0,
            },
          },
          (response) => {
            responseStatus = response.statusCode ?? null;
            const contentType = response.headers["content-type"];
            if (
              responseStatus === null ||
              Array.isArray(contentType) ||
              (contentType !== undefined && typeof contentType !== "string")
            ) {
              destroyAndFail("response-headers-invalid");
              return;
            }
            responseContentType = contentType?.split(";", 1)[0]?.trim() ?? null;
            if (responseStatus >= 300 && responseStatus < 400) {
              destroyAndFail("redirect-rejected");
              return;
            }
            const declaredLength = response.headers["content-length"];
            if (
              typeof declaredLength === "string" &&
              /^\d+$/u.test(declaredLength) &&
              Number(declaredLength) > request.maximumResponseBytes
            ) {
              destroyAndFail("response-oversized");
              return;
            }
            response.on("data", (chunk: Buffer) => {
              if (settled) return;
              responseBytes += chunk.byteLength;
              if (responseBytes > request.maximumResponseBytes) {
                destroyAndFail("response-oversized");
                return;
              }
              chunks.push(Buffer.from(chunk));
            });
            response.once("aborted", () => {
              destroyAndFail("tls-or-transport-error");
            });
            response.once("error", () => {
              destroyAndFail("tls-or-transport-error");
            });
            response.once("end", () => {
              if (settled || responseStatus === null) return;
              const body = Buffer.concat(chunks, responseBytes);
              const responseDigest = createHash("sha256")
                .update(body)
                .digest("hex");
              finish({
                body: new Uint8Array(body),
                receipt: {
                  protocol: M9B13K2_TRANSPORT_PROTOCOL,
                  requestClass: request.requestClass,
                  method: request.method,
                  urlDigest: m9b13k2DomainDigest(
                    M9B13K2_TRANSPORT_PROTOCOL,
                    request.logicalUrl.href,
                  ),
                  logicalHost: request.logicalUrl.hostname,
                  pathClass: request.pathClass,
                  queryNames: queryNames(request.logicalUrl),
                  dispatched,
                  status: responseStatus,
                  responseDigest,
                  responseBytes,
                  contentType: responseContentType,
                  outcome: "response",
                  ambiguity: "none",
                  latencyMs: Math.max(0, performance.now() - startedAtMs),
                  socketDestroyed,
                  retries: 0,
                },
              });
            });
          },
        );
        requestHolder.value = clientRequest;
        clientRequest.once("error", () => {
          destroyAndFail("tls-or-transport-error");
        });
        clientRequest.once("socket", (socket) => {
          socket.once("close", () => {
            if (!settled) socketDestroyed = socket.destroyed;
          });
        });
        dispatched = true;
        if (request.body !== null) clientRequest.write(request.body);
        clientRequest.end();
      }),
    };
  } catch {
    return {
      ok: true,
      value: failureResult(
        request,
        startedAtMs,
        false,
        "tls-or-transport-error",
        false,
      ),
    };
  } finally {
    resolved.value.inFlight = false;
  }
}
