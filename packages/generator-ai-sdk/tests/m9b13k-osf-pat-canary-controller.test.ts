import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createSyntheticM9b13kLedger,
  deriveM9b13kCredentialFingerprint,
  frozenM9b13kArtifactBytes,
  M9B13K_ACTIVATION_PROTOCOL,
  M9B13K_API_RESPONSE_MAXIMUM_BYTES,
  M9B13K_ARTIFACT_BYTE_LENGTH,
  M9B13K_ARTIFACT_FILENAME,
  M9B13K_ARTIFACT_IDENTITY,
  M9B13K_ARTIFACT_SHA256,
  M9B13K_CONTROLLER_DEADLINE_MS,
  M9B13K_CONTROLLER_PROTOCOL,
  M9B13K_CREDENTIAL_CUSTODY_PROTOCOL,
  M9B13K_DRAFT_ID,
  M9B13K_MAXIMUM_HTTP_REQUESTS,
  M9B13K_MAXIMUM_REQUEST_BODY_BYTES,
  M9B13K_PROJECT_ID,
  M9B13K_PROVIDER,
  M9B13K_REQUEST_SEQUENCE_PROTOCOL,
  M9B13K_REQUEST_TIMEOUT_MS,
  M9B13K_REQUIRED_SCOPE,
  M9B13K_REVOCATION_DEADLINE_MS,
  M9B13K_SYNTHETIC_ARTIFACT_PROTOCOL,
  type M9b13kActivation,
  type M9b13kControllerDependencies,
  type M9b13kCredentialReader,
  type M9b13kCredentialReadFailure,
  type M9b13kRevocationVerification,
  type M9b13kSyntheticLedgerControl,
  type M9b13kTransport,
  type M9b13kTransportRequest,
  type M9b13kTransportResult,
  runM9b13kOsfPatCanaryController,
} from "../internal/m9b13k-osf-pat-canary-controller.js";

const TOKEN = "A1b2C3d4".repeat(8);
const TOKEN_ID = "1".repeat(24);
const OTHER_TOKEN_ID = "2".repeat(24);
const ACTIVATION_ID = `sha256:${"a".repeat(64)}`;
const REQUEST_ID = `sha256:${"b".repeat(64)}`;
const LEDGER_NAMESPACE = "m9b13k-test-ledger";
const encoder = new TextEncoder();

type ReaderControl = Readonly<{
  reader: M9b13kCredentialReader;
  bytes: Uint8Array | null;
  reads: () => number;
}>;

function credentialReader(
  failure: M9b13kCredentialReadFailure["kind"] | null = null,
  text = `${TOKEN}\n`,
): ReaderControl {
  let reads = 0;
  const bytes = failure === null ? encoder.encode(text) : null;
  return {
    reader: {
      source: "anonymous-fd3",
      readOnce: () => {
        reads += 1;
        return failure === null && bytes !== null
          ? { ok: true, value: bytes }
          : {
              ok: false,
              error: { kind: failure ?? "fd3-unavailable" },
            };
      },
    },
    bytes,
    reads: () => reads,
  };
}

function activation(readerToken = TOKEN): M9b13kActivation {
  return {
    protocol: M9B13K_ACTIVATION_PROTOCOL,
    controllerProtocol: M9B13K_CONTROLLER_PROTOCOL,
    activationIdentity: ACTIVATION_ID,
    requestIdentity: REQUEST_ID,
    tokenId: TOKEN_ID,
    expectedCredentialFingerprint: deriveM9b13kCredentialFingerprint(
      ACTIVATION_ID,
      TOKEN_ID,
      encoder.encode(readerToken),
    ),
    expectedScope: M9B13K_REQUIRED_SCOPE,
    projectId: M9B13K_PROJECT_ID,
    draftId: M9B13K_DRAFT_ID,
    provider: M9B13K_PROVIDER,
    artifactProtocol: M9B13K_SYNTHETIC_ARTIFACT_PROTOCOL,
    artifactSha256: M9B13K_ARTIFACT_SHA256,
    requestSequenceProtocol: M9B13K_REQUEST_SEQUENCE_PROTOCOL,
    ledgerNamespace: LEDGER_NAMESPACE,
    ceilings: {
      maximumHttpRequests: M9B13K_MAXIMUM_HTTP_REQUESTS,
      maximumRequestBodyBytes: M9B13K_MAXIMUM_REQUEST_BODY_BYTES,
      apiResponseMaximumBytes: M9B13K_API_RESPONSE_MAXIMUM_BYTES,
      uploadResponseMaximumBytes: 65_536,
      perRequestTimeoutMs: M9B13K_REQUEST_TIMEOUT_MS,
      controllerDeadlineMs: M9B13K_CONTROLLER_DEADLINE_MS,
      revocationDeadlineMs: M9B13K_REVOCATION_DEADLINE_MS,
      retries: 0,
      concurrency: 1,
    },
  };
}

function jsonResponse(value: unknown, status = 200): M9b13kTransportResult {
  return {
    kind: "response",
    dispatched: true,
    status,
    contentType: "application/vnd.api+json",
    body: encoder.encode(JSON.stringify(value)),
    latencyMs: 1,
    redirectCount: 0,
  };
}

function rawResponse(
  body: Uint8Array,
  status = 200,
  contentType = "application/octet-stream",
): M9b13kTransportResult {
  return {
    kind: "response",
    dispatched: true,
    status,
    contentType,
    body,
    latencyMs: 1,
    redirectCount: 0,
  };
}

function identityCollection(
  records: ReadonlyArray<Readonly<{ id: string; type: string }>> = [],
  next: string | null = null,
): unknown {
  return { data: records, links: { next } };
}

function fileEntity(id = "file-identity"): unknown {
  return {
    id,
    type: "files",
    attributes: {
      name: M9B13K_ARTIFACT_FILENAME,
      kind: "file",
      path: `/${M9B13K_ARTIFACT_FILENAME}`,
      provider: M9B13K_PROVIDER,
    },
  };
}

function uploadEntity(
  download = `https://files.osf.io/v1/resources/${M9B13K_PROJECT_ID}/providers/${M9B13K_PROVIDER}/file-identity`,
  name: string = M9B13K_ARTIFACT_FILENAME,
): unknown {
  return {
    data: {
      id: "file-identity",
      type: "files",
      attributes: {
        name,
        kind: "file",
        path: `/${name}`,
        provider: M9B13K_PROVIDER,
        resource: M9B13K_PROJECT_ID,
      },
      links: { download },
    },
  };
}

type Override = (
  request: M9b13kTransportRequest,
  occurrence: number,
) => M9b13kTransportResult | null;

type TransportControl = Readonly<{
  transport: M9b13kTransport;
  requests: ReadonlyArray<M9b13kTransportRequest>;
  credentials: ReadonlyArray<Uint8Array>;
}>;

function interceptedTransport(override?: Override): TransportControl {
  const requests: Array<M9b13kTransportRequest> = [];
  const credentials: Array<Uint8Array> = [];
  const occurrences = new Map<string, number>();
  const transport: M9b13kTransport = {
    kind: "interceptable-zero-retry-transport",
    dispatch: (request, credential) => {
      requests.push({
        ...request,
        url: new URL(request.url.href),
        body: request.body?.slice() ?? null,
      });
      credentials.push(credential.slice());
      const occurrence = (occurrences.get(request.kind) ?? 0) + 1;
      occurrences.set(request.kind, occurrence);
      const replacement = override?.(request, occurrence);
      if (replacement !== null && replacement !== undefined)
        return Promise.resolve(replacement);
      switch (request.kind) {
        case "token-detail":
          return Promise.resolve(
            jsonResponse({
              data: {
                type: "tokens",
                id: TOKEN_ID,
                attributes: { scopes: [M9B13K_REQUIRED_SCOPE] },
              },
            }),
          );
        case "project-detail":
          return Promise.resolve(
            jsonResponse({
              data: {
                type: "nodes",
                id: M9B13K_PROJECT_ID,
                attributes: {
                  public: false,
                  current_user_permissions: ["read", "write", "admin"],
                },
              },
            }),
          );
        case "registrations-page":
        case "view-only-links-page":
          return Promise.resolve(jsonResponse(identityCollection()));
        case "files-page":
          return Promise.resolve(
            jsonResponse(
              occurrence === 1
                ? { data: [], links: { next: null } }
                : { data: [fileEntity()], links: { next: null } },
            ),
          );
        case "provider-root":
          return Promise.resolve(
            jsonResponse({
              data: [
                {
                  id: `${M9B13K_PROJECT_ID}:${M9B13K_PROVIDER}`,
                  type: "files",
                  attributes: {
                    name: M9B13K_PROVIDER,
                    provider: M9B13K_PROVIDER,
                  },
                  links: {
                    upload: `https://files.osf.io/v1/resources/${M9B13K_PROJECT_ID}/providers/${M9B13K_PROVIDER}/`,
                  },
                },
              ],
              links: { next: null },
            }),
          );
        case "upload":
          return Promise.resolve(jsonResponse(uploadEntity(), 201));
        case "download":
          return Promise.resolve(rawResponse(frozenM9b13kArtifactBytes()));
        case "revoke-token":
          return Promise.resolve(rawResponse(new Uint8Array(), 204, ""));
      }
    },
  };
  return { transport, requests, credentials };
}

type HarnessOptions = Readonly<{
  reader?: ReaderControl;
  transport?: TransportControl;
  ledger?: M9b13kSyntheticLedgerControl;
  custodian?: M9b13kRevocationVerification;
  monotonicNowMs?: () => number;
}>;

function harness(options: HarnessOptions = {}): Readonly<{
  dependencies: M9b13kControllerDependencies;
  reader: ReaderControl;
  transport: TransportControl;
  ledger: M9b13kSyntheticLedgerControl;
}> {
  const reader = options.reader ?? credentialReader();
  const transport = options.transport ?? interceptedTransport();
  const ledger =
    options.ledger ?? createSyntheticM9b13kLedger(LEDGER_NAMESPACE);
  return {
    dependencies: {
      credentialReader: reader.reader,
      transport: transport.transport,
      ledger: ledger.ledger,
      revocationCustodian: {
        kind: "separately-controlled-non-secret-custodian",
        verify: () => Promise.resolve(options.custodian ?? "revoked"),
      },
      monotonicNowMs: options.monotonicNowMs ?? (() => 0),
    },
    reader,
    transport,
    ledger,
  };
}

function assertSingleDispatchBudgets(
  requests: ReadonlyArray<M9b13kTransportRequest>,
): void {
  expect(requests.filter((entry) => entry.kind === "upload")).toHaveLength(1);
  expect(
    requests.filter((entry) => entry.kind === "revoke-token"),
  ).toHaveLength(1);
  for (const entry of requests)
    expect(entry).toMatchObject({ retryCount: 0, redirect: "error" });
}

describe("M9b.13k exact frozen controller contract", () => {
  it("executes the complete intercepted success path and verifies revocation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("forbidden"))),
    );
    const control = harness();
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );

    expect(result.decision).toBe("pass");
    expect(result.terminalState).toBe("revoked-and-verified");
    expect(result.requestCount).toBe(10);
    expect(result.putDispatchCount).toBe(1);
    expect(result.revocationAttemptCount).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    assertSingleDispatchBudgets(control.transport.requests);
    expect(
      control.transport.credentials.every((value) => value.length === 64),
    ).toBe(true);
    expect(control.reader.bytes?.every((value) => value === 0)).toBe(true);
  });

  it("freezes the exact synthetic non-study bytes, identity, length and digest", () => {
    const bytes = frozenM9b13kArtifactBytes();
    const text = new TextDecoder().decode(bytes);
    expect(M9B13K_ARTIFACT_IDENTITY).toHaveLength(32);
    expect(bytes).toHaveLength(M9B13K_ARTIFACT_BYTE_LENGTH);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      M9B13K_ARTIFACT_SHA256,
    );
    expect(text).toBe(
      `frozen identity: ${M9B13K_ARTIFACT_IDENTITY}\nexact filename: ${M9B13K_ARTIFACT_FILENAME}\nSYNTHETIC NON-STUDY OSF PAT WATERBUTLER CANARY\nThis file contains no scientific, operational or protected content.\n`,
    );
  });

  it.each([
    "fd3-unavailable",
    "fd3-reused",
    "credential-oversized",
    "credential-malformed",
  ] as const)("rejects %s with no dispatch", async (kind) => {
    const control = harness({ reader: credentialReader(kind) });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    expect(result.reason).toBe(`m9b13k:${kind}`);
    expect(result.terminalState).toBe("not-activated");
    expect(control.reader.reads()).toBe(1);
    expect(control.transport.requests).toHaveLength(0);
  });

  it.each(["environment", "argv", "file", "stdin", "clipboard"])(
    "rejects a %s credential fallback field before FD3 access",
    async (field) => {
      const control = harness();
      const candidate: Readonly<Record<string, unknown>> = {
        ...activation(),
        [field]: TOKEN,
      };
      const result = await runM9b13kOsfPatCanaryController(
        candidate,
        control.dependencies,
      );
      expect(result.reason).toBe("m9b13k:activation-invalid");
      expect(control.reader.reads()).toBe(0);
      expect(control.transport.requests).toHaveLength(0);
    },
  );

  it("rejects a credential fingerprint substitution and zeroizes it", async () => {
    const reader = credentialReader(null, `${"Z".repeat(64)}\n`);
    const control = harness({ reader });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    expect(result.reason).toBe("m9b13k:credential-fingerprint-mismatch");
    expect(reader.bytes?.every((value) => value === 0)).toBe(true);
    expect(control.transport.requests).toHaveLength(0);
  });

  it("does not leak the PAT through URLs, receipts, errors, ledger or serialization", async () => {
    const control = harness({
      transport: interceptedTransport((request) =>
        request.kind === "upload"
          ? {
              kind: "failure",
              dispatched: true,
              failureClass: "timeout-after-dispatch",
              latencyMs: M9B13K_REQUEST_TIMEOUT_MS,
            }
          : null,
      ),
    });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    const serialized = JSON.stringify({
      result,
      ledger: control.ledger.snapshot(),
      urls: control.transport.requests.map((entry) => entry.url.href),
    });
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("Bearer");
    expect(result.receipts.every((entry) => !("headers" in entry))).toBe(true);
    assertSingleDispatchBudgets(control.transport.requests);
  });
});

describe("M9b.13k hostile identity, inventory and provider responses", () => {
  it.each([
    {
      name: "wrong token ID",
      kind: "token-detail",
      replacement: jsonResponse({
        data: {
          type: "tokens",
          id: OTHER_TOKEN_ID,
          attributes: { scopes: [M9B13K_REQUIRED_SCOPE] },
        },
      }),
    },
    {
      name: "wrong project",
      kind: "project-detail",
      replacement: jsonResponse({
        data: {
          type: "nodes",
          id: "other",
          attributes: {
            public: false,
            current_user_permissions: ["read", "write", "admin"],
          },
        },
      }),
    },
    {
      name: "non-private project",
      kind: "project-detail",
      replacement: jsonResponse({
        data: {
          type: "nodes",
          id: M9B13K_PROJECT_ID,
          attributes: {
            public: true,
            current_user_permissions: ["read", "write", "admin"],
          },
        },
      }),
    },
    {
      name: "registration 63sh5 substitution",
      kind: "registrations-page",
      replacement: jsonResponse(
        identityCollection([{ id: "63sh5", type: "registrations" }]),
      ),
    },
    {
      name: "unexpected registration",
      kind: "registrations-page",
      replacement: jsonResponse(
        identityCollection([{ id: "r1", type: "registrations" }]),
      ),
    },
    {
      name: "unexpected view-only link",
      kind: "view-only-links-page",
      replacement: jsonResponse(
        identityCollection([{ id: "v1", type: "view-only-links" }]),
      ),
    },
    {
      name: "pre-existing canary",
      kind: "files-page",
      replacement: jsonResponse({
        data: [fileEntity("preexisting")],
        links: { next: null },
      }),
    },
    {
      name: "wrong provider",
      kind: "provider-root",
      replacement: jsonResponse({
        data: [
          {
            id: `${M9B13K_PROJECT_ID}:dropbox`,
            type: "files",
            attributes: { name: "dropbox", provider: "dropbox" },
            links: { upload: "https://files.osf.io/dropbox" },
          },
        ],
        links: { next: null },
      }),
    },
  ])("rejects $name and still attempts one revocation", async (example) => {
    const control = harness({
      transport: interceptedTransport((request) =>
        request.kind === example.kind ? example.replacement : null,
      ),
    });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    expect(result.decision).toBe("no-go");
    expect(result.terminalState).toBe("revoked-and-verified");
    expect(
      control.transport.requests.filter((entry) => entry.kind === "upload"),
    ).toHaveLength(0);
    expect(
      control.transport.requests.filter(
        (entry) => entry.kind === "revoke-token",
      ),
    ).toHaveLength(1);
  });

  it("finds a canary hidden on a bounded second pagination page", async () => {
    const next = `https://api.osf.io/v2/nodes/${M9B13K_PROJECT_ID}/files/${M9B13K_PROVIDER}/?page%5Bcursor%5D=hidden`;
    const control = harness({
      transport: interceptedTransport((request, occurrence) => {
        if (request.kind !== "files-page") return null;
        return occurrence === 1
          ? jsonResponse({ data: [], links: { next } })
          : jsonResponse({
              data: [fileEntity("hidden")],
              links: { next: null },
            });
      }),
    });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    expect(result.reason).toBe("m9b13k:preexisting-or-unexpected-file");
    expect(
      control.transport.requests.filter((entry) => entry.kind === "files-page"),
    ).toHaveLength(2);
    expect(
      control.transport.requests.filter((entry) => entry.kind === "upload"),
    ).toHaveLength(0);
  });
});

describe("M9b.13k URL, redirect and transport ambiguity defenses", () => {
  it("stops after the frozen complete-controller deadline and still revokes", async () => {
    let now = 0;
    const control = harness({
      monotonicNowMs: () => now,
      transport: interceptedTransport((request) => {
        if (request.kind === "project-detail")
          now = M9B13K_CONTROLLER_DEADLINE_MS;
        return null;
      }),
    });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    expect(result.reason).toBe(
      "m9b13k:controller-deadline-exceeded-after-dispatch",
    );
    expect(
      control.transport.requests.filter((entry) => entry.kind === "upload"),
    ).toHaveLength(0);
    expect(
      control.transport.requests.filter(
        (entry) => entry.kind === "revoke-token",
      ),
    ).toHaveLength(1);
  });

  it.each([
    "http://files.osf.io/v1/resources/bmsda/providers/osfstorage/",
    "https://files.osf.io.evil.example/v1/resources/bmsda/providers/osfstorage/",
    "https://127.0.0.1/v1/resources/bmsda/providers/osfstorage/",
    "https://[::1]/v1/resources/bmsda/providers/osfstorage/",
    "https://xn--osf-qua.example/v1/resources/bmsda/providers/osfstorage/",
    "https://user@files.osf.io/v1/resources/bmsda/providers/osfstorage/",
    "https://files.osf.io:444/v1/resources/bmsda/providers/osfstorage/",
    "https://files.osf.io/v1/resources/other/providers/osfstorage/",
    "https://files.osf.io/v1/resources/bmsda/providers/dropbox/",
  ])("rejects malicious upload URL %s", async (upload) => {
    const control = harness({
      transport: interceptedTransport((request) =>
        request.kind === "provider-root"
          ? jsonResponse({
              data: [
                {
                  id: `${M9B13K_PROJECT_ID}:${M9B13K_PROVIDER}`,
                  type: "files",
                  attributes: {
                    name: M9B13K_PROVIDER,
                    provider: M9B13K_PROVIDER,
                  },
                  links: { upload },
                },
              ],
              links: { next: null },
            })
          : null,
      ),
    });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    expect(result.decision).toBe("no-go");
    expect(
      control.transport.requests.filter((entry) => entry.kind === "upload"),
    ).toHaveLength(0);
    expect(
      control.transport.requests.filter(
        (entry) => entry.kind === "revoke-token",
      ),
    ).toHaveLength(1);
  });

  it.each([
    "http://files.osf.io/v1/resources/bmsda/providers/osfstorage/file-identity",
    "https://files.osf.io.evil.example/v1/resources/bmsda/providers/osfstorage/file-identity",
    "https://169.254.169.254/v1/resources/bmsda/providers/osfstorage/file-identity",
    "https://files.osf.io/v1/resources/other/providers/osfstorage/file-identity",
    "https://files.osf.io/v1/resources/bmsda/providers/dropbox/file-identity",
  ])("rejects malicious download URL %s after one PUT", async (download) => {
    const control = harness({
      transport: interceptedTransport((request) =>
        request.kind === "upload"
          ? jsonResponse(uploadEntity(download), 201)
          : null,
      ),
    });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    expect(result.decision).toBe("no-go");
    assertSingleDispatchBudgets(control.transport.requests);
    expect(
      control.transport.requests.filter((entry) => entry.kind === "download"),
    ).toHaveLength(0);
  });

  it.each([
    {
      name: "absolute redirect",
      response: {
        kind: "response",
        dispatched: true,
        status: 302,
        contentType: "text/plain",
        body: new Uint8Array(),
        latencyMs: 1,
        redirectCount: 0,
      } satisfies M9b13kTransportResult,
    },
    {
      name: "relative redirect",
      response: {
        kind: "response",
        dispatched: true,
        status: 307,
        contentType: "text/plain",
        body: new Uint8Array(),
        latencyMs: 1,
        redirectCount: 0,
      } satisfies M9b13kTransportResult,
    },
    {
      name: "timeout before dispatch",
      response: {
        kind: "failure",
        dispatched: false,
        failureClass: "timeout-before-dispatch",
        latencyMs: M9B13K_REQUEST_TIMEOUT_MS,
      } satisfies M9b13kTransportResult,
    },
    {
      name: "timeout after dispatch",
      response: {
        kind: "failure",
        dispatched: true,
        failureClass: "timeout-after-dispatch",
        latencyMs: M9B13K_REQUEST_TIMEOUT_MS,
      } satisfies M9b13kTransportResult,
    },
    {
      name: "interruption before dispatch",
      response: {
        kind: "failure",
        dispatched: false,
        failureClass: "interrupted-before-dispatch",
        latencyMs: 0,
      } satisfies M9b13kTransportResult,
    },
    {
      name: "interruption after dispatch",
      response: {
        kind: "failure",
        dispatched: true,
        failureClass: "interrupted-after-dispatch",
        latencyMs: 1,
      } satisfies M9b13kTransportResult,
    },
  ])("makes $name terminal without retry", async (example) => {
    const control = harness({
      transport: interceptedTransport((request) =>
        request.kind === "upload" ? example.response : null,
      ),
    });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    expect(result.decision).toBe("no-go");
    assertSingleDispatchBudgets(control.transport.requests);
  });

  it.each([401, 403, 409, 422, 500, 503])(
    "treats upload HTTP %i as terminal and never retries",
    async (status) => {
      const control = harness({
        transport: interceptedTransport((request) =>
          request.kind === "upload"
            ? rawResponse(new Uint8Array(), status, "text/plain")
            : null,
        ),
      });
      const result = await runM9b13kOsfPatCanaryController(
        activation(),
        control.dependencies,
      );
      expect(result.decision).toBe("no-go");
      assertSingleDispatchBudgets(control.transport.requests);
    },
  );

  it.each([401, 403, 500, 503])(
    "treats pre-upload HTTP %i as terminal without a PUT",
    async (status) => {
      const control = harness({
        transport: interceptedTransport((request) =>
          request.kind === "token-detail"
            ? rawResponse(new Uint8Array(), status, "text/plain")
            : null,
        ),
      });
      const result = await runM9b13kOsfPatCanaryController(
        activation(),
        control.dependencies,
      );
      expect(result.decision).toBe("no-go");
      expect(
        control.transport.requests.filter((entry) => entry.kind === "upload"),
      ).toHaveLength(0);
      expect(
        control.transport.requests.filter(
          (entry) => entry.kind === "revoke-token",
        ),
      ).toHaveLength(1);
    },
  );
});

describe("M9b.13k post-PUT validation and revocation security stops", () => {
  it.each([
    {
      name: "altered upload filename",
      kind: "upload",
      response: jsonResponse(
        uploadEntity(
          "https://files.osf.io/v1/resources/bmsda/providers/osfstorage/file-identity",
          "altered.txt",
        ),
        201,
      ),
    },
    {
      name: "malformed upload response",
      kind: "upload",
      response: rawResponse(
        encoder.encode("{"),
        201,
        "application/vnd.api+json",
      ),
    },
    {
      name: "unexpected second upload entity",
      kind: "upload",
      response: jsonResponse({ data: [uploadEntity(), uploadEntity()] }, 201),
    },
    {
      name: "successful PUT followed by inventory failure",
      kind: "files-page",
      occurrence: 2,
      response: rawResponse(new Uint8Array(), 500, "text/plain"),
    },
    {
      name: "unexpected additional remote file",
      kind: "files-page",
      occurrence: 2,
      response: jsonResponse({
        data: [
          fileEntity(),
          {
            id: "unexpected",
            type: "files",
            attributes: {
              name: "unexpected.txt",
              kind: "file",
              path: "/unexpected.txt",
              provider: M9B13K_PROVIDER,
            },
          },
        ],
        links: { next: null },
      }),
    },
    {
      name: "successful PUT followed by redownload mismatch",
      kind: "download",
      response: rawResponse(encoder.encode("wrong bytes")),
    },
    {
      name: "successful PUT followed by wrong redownload media semantics",
      kind: "download",
      response: rawResponse(frozenM9b13kArtifactBytes(), 200, "text/html"),
    },
  ])("rejects $name with exactly one PUT and revocation", async (example) => {
    const control = harness({
      transport: interceptedTransport((request, occurrence) =>
        request.kind === example.kind &&
        (example.occurrence === undefined || example.occurrence === occurrence)
          ? example.response
          : null,
      ),
    });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    expect(result.decision).toBe("no-go");
    assertSingleDispatchBudgets(control.transport.requests);
  });

  it("sends only the exact frozen filename, query and raw body", async () => {
    const control = harness();
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    const upload = control.transport.requests.find(
      (entry) => entry.kind === "upload",
    );
    expect(result.decision).toBe("pass");
    expect(upload?.url.searchParams.get("kind")).toBe("file");
    expect(upload?.url.searchParams.get("name")).toBe(M9B13K_ARTIFACT_FILENAME);
    expect(upload?.body).toStrictEqual(frozenM9b13kArtifactBytes());
    expect(upload?.body?.byteLength).toBe(M9B13K_ARTIFACT_BYTE_LENGTH);
  });

  it.each([
    {
      name: "revocation rejection",
      response: rawResponse(new Uint8Array(), 403, "text/plain"),
      terminal: "revocation-failed-security-stop",
    },
    {
      name: "ambiguous revocation",
      response: {
        kind: "failure",
        dispatched: true,
        failureClass: "timeout-after-dispatch",
        latencyMs: M9B13K_REVOCATION_DEADLINE_MS,
      } satisfies M9b13kTransportResult,
      terminal: "revocation-ambiguous-security-stop",
    },
  ])("produces a cleanup-only stop for $name", async (example) => {
    const control = harness({
      transport: interceptedTransport((request) =>
        request.kind === "revoke-token" ? example.response : null,
      ),
    });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    expect(result.decision).toBe("no-go");
    expect(result.terminalState).toBe(example.terminal);
    expect(result.cleanupAuthorization).toBe(
      "browser-custodian-token-cleanup-and-state-reconciliation-only",
    );
    assertSingleDispatchBudgets(control.transport.requests);
  });

  it.each([
    ["active", "revocation-failed-security-stop"],
    ["ambiguous", "revocation-ambiguous-security-stop"],
  ] as const)(
    "does not fabricate custodian verification when it reports %s",
    async (custodian, terminal) => {
      const control = harness({ custodian });
      const result = await runM9b13kOsfPatCanaryController(
        activation(),
        control.dependencies,
      );
      expect(result.terminalState).toBe(terminal);
      expect(result.decision).toBe("no-go");
      assertSingleDispatchBudgets(control.transport.requests);
    },
  );
});

describe("M9b.13k durable accounting, crash, restart and replay", () => {
  it("rejects hostile ledger root tampering before credential access", async () => {
    const ledger = createSyntheticM9b13kLedger(LEDGER_NAMESPACE);
    ledger.tamperRoot();
    const control = harness({ ledger });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    expect(result.reason).toBe("m9b13k:ledger-budget-or-root-invalid");
    expect(control.reader.reads()).toBe(0);
    expect(control.transport.requests).toHaveLength(0);
  });

  it("stops on hostile receipt-ledger tampering without continuing", async () => {
    const ledger = createSyntheticM9b13kLedger(LEDGER_NAMESPACE);
    const transport = interceptedTransport((request) => {
      if (request.kind === "token-detail") ledger.tamperRoot();
      return null;
    });
    const control = harness({ ledger, transport });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    expect(result.decision).toBe("no-go");
    expect(result.terminalState).toBe("revocation-ambiguous-security-stop");
    expect(result.cleanupAuthorization).toBe(
      "browser-custodian-token-cleanup-and-state-reconciliation-only",
    );
    expect(
      transport.requests.filter((entry) => entry.kind === "upload"),
    ).toHaveLength(0);
    expect(
      transport.requests.filter((entry) => entry.kind === "revoke-token"),
    ).toHaveLength(0);
    expect(result.revocationAttemptCount).toBe(1);
  });

  it.each([
    "next-conflict",
    "next-ambiguous-before-write",
    "next-ambiguous-after-write",
  ] as const)("stops on hostile initial ledger fault %s", async (fault) => {
    const ledger = createSyntheticM9b13kLedger(LEDGER_NAMESPACE);
    ledger.setNextFault(fault);
    const control = harness({ ledger });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    expect(result.decision).toBe("no-go");
    expect(control.transport.requests).toHaveLength(0);
    expect(control.reader.bytes?.every((value) => value === 0)).toBe(true);
  });

  it("treats a thrown pre-PUT transport boundary as a crash and still revokes", async () => {
    const base = interceptedTransport();
    const requests: Array<M9b13kTransportRequest> = [];
    const transport: M9b13kTransport = {
      kind: "interceptable-zero-retry-transport",
      dispatch: (request, credential) => {
        requests.push(request);
        if (request.kind === "project-detail")
          return Promise.reject(new Error("synthetic crash"));
        return base.transport.dispatch(request, credential);
      },
    };
    const control = harness({
      transport: { transport, requests, credentials: [] },
    });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    expect(result.decision).toBe("no-go");
    expect(requests.filter((entry) => entry.kind === "upload")).toHaveLength(0);
    expect(
      requests.filter((entry) => entry.kind === "revoke-token"),
    ).toHaveLength(1);
  });

  it("treats a thrown post-PUT transport boundary as ambiguous and never retries", async () => {
    const base = interceptedTransport();
    const requests: Array<M9b13kTransportRequest> = [];
    const transport: M9b13kTransport = {
      kind: "interceptable-zero-retry-transport",
      dispatch: (request, credential) => {
        requests.push(request);
        if (request.kind === "upload")
          return Promise.reject(new Error("synthetic crash"));
        return base.transport.dispatch(request, credential);
      },
    };
    const control = harness({
      transport: { transport, requests, credentials: [] },
    });
    const result = await runM9b13kOsfPatCanaryController(
      activation(),
      control.dependencies,
    );
    expect(result.decision).toBe("no-go");
    assertSingleDispatchBudgets(requests);
  });

  it("restarts after ambiguous PUT persistence with zero PUT redispatch", async () => {
    const ledger = createSyntheticM9b13kLedger(LEDGER_NAMESPACE);
    const firstTransport = interceptedTransport((request) => {
      if (request.kind === "upload")
        ledger.setNextFault("next-ambiguous-after-write");
      return null;
    });
    const first = harness({ ledger, transport: firstTransport });
    const firstResult = await runM9b13kOsfPatCanaryController(
      activation(),
      first.dependencies,
    );
    expect(firstResult.decision).toBe("no-go");
    expect(
      firstTransport.requests.filter((entry) => entry.kind === "upload"),
    ).toHaveLength(1);

    const secondTransport = interceptedTransport();
    const second = harness({ ledger, transport: secondTransport });
    const secondResult = await runM9b13kOsfPatCanaryController(
      activation(),
      second.dependencies,
    );
    expect(secondResult.decision).toBe("no-go");
    expect(
      secondTransport.requests.filter((entry) => entry.kind === "upload"),
    ).toHaveLength(0);
    expect(
      secondTransport.requests.filter((entry) => entry.kind === "revoke-token"),
    ).toHaveLength(1);
    expect(
      ledger
        .snapshot()
        .events.filter(
          (entry) =>
            entry.kind === "request-dispatched" &&
            entry.requestKind === "upload",
        ),
    ).toHaveLength(1);
  });

  it("performs an exact zero-effect replay after a terminal execution", async () => {
    const ledger = createSyntheticM9b13kLedger(LEDGER_NAMESPACE);
    const first = harness({ ledger });
    const completed = await runM9b13kOsfPatCanaryController(
      activation(),
      first.dependencies,
    );
    expect(completed.decision).toBe("pass");

    const second = harness({ ledger });
    const replay = await runM9b13kOsfPatCanaryController(
      activation(),
      second.dependencies,
    );
    expect(replay.replay).toBe(true);
    expect(replay.decision).toBe("no-go");
    expect(second.reader.reads()).toBe(0);
    expect(second.transport.requests).toHaveLength(0);
  });

  it("rejects activation substitution against an existing ledger", async () => {
    const ledger = createSyntheticM9b13kLedger(LEDGER_NAMESPACE);
    const first = harness({ ledger });
    await runM9b13kOsfPatCanaryController(activation(), first.dependencies);
    const second = harness({ ledger });
    const substituted = {
      ...activation(),
      requestIdentity: `sha256:${"c".repeat(64)}`,
    };
    const result = await runM9b13kOsfPatCanaryController(
      substituted,
      second.dependencies,
    );
    expect(result.reason).toBe("m9b13k:ledger-activation-mismatch");
    expect(second.reader.reads()).toBe(0);
    expect(second.transport.requests).toHaveLength(0);
  });

  it("binds the token ID separately and permits no post-activation replacement", async () => {
    const changed = { ...activation(), tokenId: OTHER_TOKEN_ID };
    const control = harness();
    const result = await runM9b13kOsfPatCanaryController(
      changed,
      control.dependencies,
    );
    expect(result.reason).toBe("m9b13k:credential-fingerprint-mismatch");
    expect(control.transport.requests).toHaveLength(0);
    expect(M9B13K_CREDENTIAL_CUSTODY_PROTOCOL).toContain("anonymous-fd3");
  });
});
