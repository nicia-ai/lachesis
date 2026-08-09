import { spawn } from "node:child_process";
import { createServer as createTcpServer, type Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { syntheticM9b13k2CredentialBytes } from "../src/internal/m9b13k2/credential.js";
import {
  frozenM9b13k2ArtifactBytes,
  M9B13K2_ARTIFACT_BYTE_LENGTH,
} from "../src/internal/m9b13k2/protocol.js";
import {
  createM9b13k2LoopbackHttpsTransport,
  createM9b13k2ProductionHttpsTransport,
  dispatchM9b13k2HttpsRequest,
  type M9b13k2HttpsTransport,
  type M9b13k2TransportRequest,
  type M9b13k2TransportResult,
} from "../src/internal/m9b13k2/transport.js";
import {
  createM9b13k2TlsFixture,
  type M9b13k2TlsFixture,
  waitM9b13k2,
} from "./m9b13k2-fixtures.js";

const tokenId = "c".repeat(24);
const fixtures: Array<M9b13k2TlsFixture> = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(async (fixture) => fixture.close()));
});

function projectRequest(
  timeoutMs: number,
  maximumResponseBytes = 1024,
): M9b13k2TransportRequest {
  return {
    requestClass: "project-detail",
    method: "GET",
    logicalUrl: new URL("https://api.osf.io/v2/nodes/bmsda/"),
    tokenId,
    pathClass: "/v2/nodes/<project-id>/",
    body: null,
    maximumResponseBytes,
    timeoutMs,
  };
}

function loopbackTransport(
  fixture: M9b13k2TlsFixture,
  certificatePem = fixture.certificatePem,
): M9b13k2HttpsTransport {
  fixtures.push(fixture);
  const transport = createM9b13k2LoopbackHttpsTransport({
    hostname: "127.0.0.1",
    port: fixture.port,
    certificateAuthorityPem: certificatePem,
  });
  if (!transport.ok) throw new Error(transport.error.reason);
  return transport.value;
}

async function dispatch(
  transport: M9b13k2HttpsTransport,
  request: M9b13k2TransportRequest,
  controller = new AbortController(),
) {
  return await dispatchM9b13k2HttpsRequest(
    transport,
    request,
    syntheticM9b13k2CredentialBytes(),
    controller.signal,
  );
}

function requireTransportResult(
  result: Awaited<ReturnType<typeof dispatch>>,
): M9b13k2TransportResult {
  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
}

async function proveExternalNetworkDenied(): Promise<
  Readonly<{ code: number | null; stdout: string }>
> {
  const profile =
    '(version 1)(allow default)(deny network*)(allow network* (local ip "localhost:*"))(allow network* (remote ip "localhost:*"))';
  const source = `
const net = require("node:net");
const socket = net.connect({ host: "203.0.113.1", port: 443 });
socket.once("connect", () => process.exit(9));
socket.once("error", error => { process.stdout.write(String(error.code)); process.exit(["EPERM", "EACCES"].includes(error.code) ? 0 : 8); });
setTimeout(() => { socket.destroy(); process.stdout.write("BLOCKED"); process.exit(0); }, 300).unref();`;
  const child = spawn(
    "/usr/bin/sandbox-exec",
    ["-p", profile, process.execPath, "-e", source],
    { env: {}, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.resume();
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, stdout };
}

describe("M9b.13k.2 concrete bounded HTTPS transport", () => {
  it("rejects invalid routes, envelopes, URL forms, and operation shapes pre-dispatch", async () => {
    expect(
      createM9b13k2LoopbackHttpsTransport({
        hostname: "127.0.0.1",
        port: 0,
        certificateAuthorityPem: "",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await dispatch(
        createM9b13k2ProductionHttpsTransport(),
        projectRequest(1),
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-request-envelope-invalid" },
    });

    const transport = createM9b13k2LoopbackHttpsTransport({
      hostname: "127.0.0.1",
      port: 1,
      certificateAuthorityPem: "unused-invalid-request-certificate",
    });
    if (!transport.ok) throw new Error(transport.error.reason);
    const base = projectRequest(200);
    const invalidRequests: ReadonlyArray<M9b13k2TransportRequest> = [
      { ...base, logicalUrl: new URL("http://api.osf.io/v2/nodes/bmsda/") },
      {
        ...base,
        logicalUrl: new URL("https://user@api.osf.io/v2/nodes/bmsda/"),
      },
      {
        ...base,
        logicalUrl: new URL("https://api.osf.io:444/v2/nodes/bmsda/"),
      },
      {
        ...base,
        logicalUrl: new URL("https://api.osf.io/v2/nodes/bmsda/#fragment"),
      },
      { ...base, logicalUrl: new URL("https://127.0.0.1/v2/nodes/bmsda/") },
      { ...base, logicalUrl: new URL("https://localhost/v2/nodes/bmsda/") },
      {
        ...base,
        logicalUrl: new URL("https://xn--exmple-cua.invalid/v2/nodes/bmsda/"),
      },
      { ...base, tokenId: "invalid" },
      { ...base, pathClass: "" },
      { ...base, maximumResponseBytes: -1 },
      { ...base, timeoutMs: 0 },
      { ...base, body: new Uint8Array(246) },
      {
        ...base,
        logicalUrl: new URL("https://files.osf.io/v2/nodes/bmsda/"),
      },
      { ...base, method: "PUT" },
      {
        ...base,
        logicalUrl: new URL("https://api.osf.io/v2/nodes/other/"),
      },
      {
        ...base,
        logicalUrl: new URL("https://api.osf.io/v2/nodes/bmsda/?extra=1"),
      },
      {
        ...base,
        requestClass: "registrations",
        logicalUrl: new URL(
          "https://api.osf.io/v2/nodes/bmsda/registrations/?page%5Bsize%5D=99",
        ),
      },
      {
        ...base,
        body: new Uint8Array([0x41]),
      },
      {
        ...base,
        requestClass: "upload",
        method: "PUT",
        logicalUrl: new URL(
          "https://files.osf.io/v1/resources/bmsda/providers/osfstorage/?kind=file&name=wrong.txt",
        ),
        body: frozenM9b13k2ArtifactBytes(),
      },
      {
        ...base,
        requestClass: "upload",
        method: "PUT",
        logicalUrl: new URL(
          "https://example.invalid/v1/resources/bmsda/providers/osfstorage/?kind=file&name=OSF-PAT-WATERBUTLER-CANARY-1fbd9e013ac05f53c411b9e98f507d12.txt",
        ),
        body: frozenM9b13k2ArtifactBytes(),
      },
      {
        ...base,
        requestClass: "download",
        logicalUrl: new URL(
          "https://files.osf.io/v1/resources/bmsda/providers/osfstorage/",
        ),
      },
      {
        ...base,
        requestClass: "download",
        logicalUrl: new URL(
          "https://files.osf.io/v1/resources/bmsda/providers/osfstorage/folder/object",
        ),
      },
      {
        ...base,
        requestClass: "download",
        logicalUrl: new URL(
          "https://files.osf.io/v1/resources/bmsda/providers/osfstorage/object?extra=1",
        ),
      },
    ];
    for (const request of invalidRequests)
      expect(await dispatch(transport.value, request)).toMatchObject({
        ok: false,
      });
    expect(
      await dispatchM9b13k2HttpsRequest(
        transport.value,
        base,
        new Uint8Array(63),
        new AbortController().signal,
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-transport-credential-shape-invalid" },
    });
  });

  it("proves the OS denies non-loopback connection attempts", async () => {
    const proof = await proveExternalNetworkDenied();
    expect(proof.code).toBe(0);
    expect(["EPERM", "EACCES", "BLOCKED"]).toContain(proof.stdout);
  });

  it("dispatches through TLS loopback without changing logical identity", async () => {
    const fixture = await createM9b13k2TlsFixture((request, response) => {
      expect(request.headers.host).toBe("api.osf.io");
      expect(request.url).toBe("/v2/nodes/bmsda/");
      response.writeHead(200, { "content-type": "application/vnd.api+json" });
      response.end('{"data":{"id":"bmsda"}}');
    });
    const result = await dispatch(
      loopbackTransport(fixture),
      projectRequest(200),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        receipt: {
          logicalHost: "api.osf.io",
          pathClass: "/v2/nodes/<project-id>/",
          dispatched: true,
          status: 200,
          outcome: "response",
          ambiguity: "none",
          retries: 0,
        },
      },
    });
    if (!result.ok) throw new Error(result.error.reason);
    expect(new TextDecoder().decode(result.value.body ?? undefined)).toBe(
      '{"data":{"id":"bmsda"}}',
    );
  });

  it("rejects redirects without following them", async () => {
    let requests = 0;
    const fixture = await createM9b13k2TlsFixture((_request, response) => {
      requests += 1;
      response.writeHead(302, { location: "https://example.invalid/" });
      response.end();
    });
    const result = await dispatch(
      loopbackTransport(fixture),
      projectRequest(200),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        receipt: {
          dispatched: true,
          status: null,
          outcome: "redirect-rejected",
          socketDestroyed: true,
        },
      },
    });
    expect(requests).toBe(1);
  });

  it("destroys a never-settling request at its owned timeout", async () => {
    const fixture = await createM9b13k2TlsFixture(() => {
      // Deliberately never send headers or a body.
    });
    const result = await dispatch(
      loopbackTransport(fixture),
      projectRequest(30),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        receipt: {
          dispatched: true,
          outcome: "per-request-timeout",
          socketDestroyed: true,
        },
      },
    });
  });

  it("bounds a slow body and quarantines its late completion", async () => {
    let lateWriteAttempted = false;
    const fixture = await createM9b13k2TlsFixture((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write("{");
      setTimeout(() => {
        lateWriteAttempted = true;
        response.end("}");
      }, 80).unref();
    });
    const result = await dispatch(
      loopbackTransport(fixture),
      projectRequest(25),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        receipt: {
          outcome: "per-request-timeout",
          socketDestroyed: true,
        },
      },
    });
    await waitM9b13k2(100);
    expect(lateWriteAttempted).toBe(true);
    expect(requireTransportResult(result).receipt.outcome).toBe(
      "per-request-timeout",
    );
  });

  it("stops an oversized streaming body before buffering it", async () => {
    const fixture = await createM9b13k2TlsFixture((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write("A".repeat(40));
      response.end("B".repeat(40));
    });
    const result = await dispatch(
      loopbackTransport(fixture),
      projectRequest(200, 64),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        body: null,
        receipt: {
          outcome: "response-oversized",
          responseBytes: 0,
          socketDestroyed: true,
        },
      },
    });
  });

  it("rejects a declared oversized body before reading it", async () => {
    const fixture = await createM9b13k2TlsFixture((_request, response) => {
      response.writeHead(200, {
        "content-length": "1000",
        "content-type": "application/json",
      });
      response.end();
    });
    const result = await dispatch(
      loopbackTransport(fixture),
      projectRequest(200, 64),
    );
    expect(requireTransportResult(result).receipt.outcome).toBe(
      "response-oversized",
    );
  });

  it("fails closed on disconnect and malformed HTTP bytes", async () => {
    const disconnect = await createM9b13k2TlsFixture((request) => {
      request.socket.destroy();
    });
    const disconnected = await dispatch(
      loopbackTransport(disconnect),
      projectRequest(200),
    );
    expect(requireTransportResult(disconnected).receipt.outcome).toBe(
      "tls-or-transport-error",
    );

    const malformed = await createM9b13k2TlsFixture((request) => {
      request.socket.write("HTTP/1.1 NOT-A-STATUS\r\nBad Header\r\n\r\n");
      request.socket.destroy();
    });
    const malformedResult = await dispatch(
      loopbackTransport(malformed),
      projectRequest(200),
    );
    expect(requireTransportResult(malformedResult).receipt.outcome).toBe(
      "tls-or-transport-error",
    );
  });

  it("fails TLS validation without dispatch result fabrication", async () => {
    const first = await createM9b13k2TlsFixture((_request, response) => {
      response.end("unreachable");
    });
    const unrelated = await createM9b13k2TlsFixture((_request, response) => {
      response.end("unrelated");
    });
    fixtures.push(unrelated);
    const result = await dispatch(
      loopbackTransport(first, unrelated.certificatePem),
      projectRequest(200),
    );
    expect(requireTransportResult(result).receipt).toMatchObject({
      dispatched: true,
      outcome: "tls-or-transport-error",
      socketDestroyed: true,
    });
  });

  it("enforces concurrency one and controller abort", async () => {
    const fixture = await createM9b13k2TlsFixture(() => {
      // Keep the first request in flight.
    });
    const transport = loopbackTransport(fixture);
    const controller = new AbortController();
    const first = dispatch(transport, projectRequest(500), controller);
    await waitM9b13k2(10);
    const second = await dispatch(transport, projectRequest(500));
    expect(requireTransportResult(second).receipt).toMatchObject({
      dispatched: false,
      outcome: "concurrent-dispatch-rejected",
      ambiguity: "before-dispatch",
    });
    controller.abort();
    const firstResult = await first;
    expect(requireTransportResult(firstResult).receipt).toMatchObject({
      dispatched: true,
      outcome: "controller-aborted",
      socketDestroyed: true,
    });
  });

  it("times out a stalled TLS handshake", async () => {
    const sockets = new Set<Socket>();
    const server = createTcpServer(() => {
      // Accept TCP but never begin TLS.
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => {
        sockets.delete(socket);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("TCP stall fixture unavailable.");
    const transport = createM9b13k2LoopbackHttpsTransport({
      hostname: "127.0.0.1",
      port: address.port,
      certificateAuthorityPem: "unused-for-stalled-handshake",
    });
    if (!transport.ok) throw new Error(transport.error.reason);
    const result = await dispatch(transport.value, projectRequest(25));
    expect(requireTransportResult(result).receipt).toMatchObject({
      outcome: "per-request-timeout",
      socketDestroyed: true,
    });
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  });

  it("sends the exact bounded artifact on a validated PUT", async () => {
    let received = 0;
    const fixture = await createM9b13k2TlsFixture((request, response) => {
      request.on("data", (chunk: Buffer) => {
        received += chunk.byteLength;
      });
      request.on("end", () => {
        response.writeHead(201, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    const body = frozenM9b13k2ArtifactBytes();
    expect(body).toHaveLength(M9B13K2_ARTIFACT_BYTE_LENGTH);
    const result = await dispatch(loopbackTransport(fixture), {
      requestClass: "upload",
      method: "PUT",
      logicalUrl: new URL(
        "https://files.osf.io/v1/resources/bmsda/providers/osfstorage/?kind=file&name=OSF-PAT-WATERBUTLER-CANARY-1fbd9e013ac05f53c411b9e98f507d12.txt",
      ),
      tokenId,
      pathClass: "/v1/resources/<project>/providers/osfstorage/",
      body,
      maximumResponseBytes: 1024,
      timeoutMs: 200,
    });
    expect(requireTransportResult(result).receipt.status).toBe(201);
    expect(received).toBe(M9B13K2_ARTIFACT_BYTE_LENGTH);
  });

  it("accepts one exact stable Waterbutler download URL", async () => {
    const fixture = await createM9b13k2TlsFixture((request, response) => {
      expect(request.headers.host).toBe("files.osf.io");
      expect(request.url).toBe(
        "/v1/resources/bmsda/providers/osfstorage/stable-object",
      );
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end("artifact");
    });
    const result = await dispatch(loopbackTransport(fixture), {
      requestClass: "download",
      method: "GET",
      logicalUrl: new URL(
        "https://files.osf.io/v1/resources/bmsda/providers/osfstorage/stable-object",
      ),
      tokenId,
      pathClass: "/v1/resources/<project>/providers/osfstorage/<object>",
      body: null,
      maximumResponseBytes: 1024,
      timeoutMs: 200,
    });
    expect(requireTransportResult(result).receipt).toMatchObject({
      status: 200,
      outcome: "response",
      logicalHost: "files.osf.io",
    });
  });
});
