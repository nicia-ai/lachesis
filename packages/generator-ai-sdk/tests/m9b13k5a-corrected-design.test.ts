import {
  createHash,
  generateKeyPairSync,
  type KeyObject,
  sign,
} from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalizeJson, parseJson } from "@nicia-ai/lachesis";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  deriveM9b13k5aProtocolIdentity,
  deriveM9b13k5aRequestPath,
  M9B13K5A_ACCEPTED_LEDGER_IMPLEMENTATION_IDENTITY,
  M9B13K5A_ACTIVATION_PROTOCOL,
  M9B13K5A_CONTROLLER_DURATION_MS,
  M9B13K5A_CUSTODIAN_PROTOCOL,
  M9B13K5A_EVENT_KINDS,
  M9B13K5A_EVENT_PROTOCOL,
  M9B13K5A_FILENAME,
  M9B13K5A_FUTURE_IMPLEMENTATION_ORDER,
  M9B13K5A_LEDGER_PAYLOAD_LIMIT,
  M9B13K5A_LONGEST_REQUEST_COUNT,
  M9B13K5A_NATIVE_RECEIPT_PROTOCOL,
  M9B13K5A_OPERATION_SPECS,
  M9B13K5A_PROJECT_ID,
  M9B13K5A_PROVIDER,
  M9B13K5A_REVOCATION_DURATION_MS,
  M9B13K5A_SHORTEST_REQUEST_COUNT,
  type M9b13k5aActivation,
  m9b13k5aCanonicalDigest,
  m9b13k5aCustodianReceiptSchema,
  type M9b13k5aCustodianUnsigned,
  type M9b13k5aEventPayload,
  m9b13k5aEventPayloadSchema,
  type M9b13k5aNativeReceipt,
  type M9b13k5aOperation,
  m9b13k5aSha256,
} from "../src/internal/m9b13k5a/protocol.js";
import {
  createM9b13k5aSyntheticTransportReceipt,
  M9B13K5A_RESPONSE_KINDS,
  m9b13k5aFileEntitySchema,
  type M9b13k5aResponseKind,
  type M9b13k5aStableObjectEvidence,
  parseM9b13k5aOfficialResponse,
  reconcileM9b13k5aStableObject,
  responseKindForOperation,
} from "../src/internal/m9b13k5a/responses.js";
import {
  acceptM9b13k5aNativeLedgerReceipt,
  consumeM9b13k5aDispatchPermit,
  createM9b13k5aSyntheticLedgerAdapterCapability,
  deriveM9b13k5aStateModelIdentity,
  issueM9b13k5aDispatchPermit,
  M9B13K5A_ALLOWED_STAGE_EVENTS,
  type M9b13k5aDispatchPermit,
  type M9b13k5aReplayProjection,
  type M9b13k5aVerifiedReplay,
  type M9b13k5aVerifiedRetainedReceipt,
  replayM9b13k5aReceipts,
  verifyM9b13k5aCustodianReceipt,
} from "../src/internal/m9b13k5a/state-model.js";

const digest = (marker: string): string =>
  createHash("sha256").update(marker).digest("hex");
const encode = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value));

function readFixture(name: string): unknown {
  const decoded = parseJson(
    readFileSync(new URL(`fixtures/m9b13k5a/${name}`, import.meta.url), "utf8"),
  );
  if (!decoded.ok) throw new Error(decoded.error.code);
  return decoded.value;
}

const officialFixtures = readFixture("official-shaped-responses.json");
const hostileFixtures = readFixture("hostile-near-misses.json");

function fixtureRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("fixture-record-required");
  return value as Readonly<Record<string, unknown>>;
}

function activation(): M9b13k5aActivation {
  const start = 10_000;
  return {
    protocol: M9B13K5A_ACTIVATION_PROTOCOL,
    activationIdentity: digest("m9b13k5a-activation"),
    runIdentity: "SYNTHETIC-M9B13K5A-RUN",
    sessionIdentity: "SYNTHETIC-M9B13K5A-SESSION",
    requestPlanIdentity: digest("request-plan"),
    patCommitment: digest("synthetic-pat-commitment"),
    ledgerImplementationIdentity:
      M9B13K5A_ACCEPTED_LEDGER_IMPLEMENTATION_IDENTITY,
    ledgerNamespaceIdentity: digest("ledger-namespace"),
    ledgerStoreIdentity: digest("ledger-store"),
    logDevice: 91,
    logInode: 92,
    helperIdentity: digest("conformance-helper"),
    helperVariant: "conformance",
    ledgerInitialRoot: digest("native-initial-root"),
    controllerStartMonotonicMs: start,
    controllerDeadlineMonotonicMs: start + M9B13K5A_CONTROLLER_DURATION_MS,
    projectId: M9B13K5A_PROJECT_ID,
    draftId: "6a7619b506a607fe5f63a77d",
    provider: M9B13K5A_PROVIDER,
    filename: M9B13K5A_FILENAME,
    putDigest: digest("canary-put"),
  };
}

type Harness = Readonly<{
  activation: M9b13k5aActivation;
  receipts: Array<M9b13k5aVerifiedRetainedReceipt>;
  replay: () => M9b13k5aVerifiedReplay;
  append: (event: M9b13k5aEventPayload) => M9b13k5aVerifiedRetainedReceipt;
  projection: () => M9b13k5aReplayProjection;
  nextTime: () => number;
}>;

function harness(): Harness {
  const boundActivation = activation();
  const adapter = createM9b13k5aSyntheticLedgerAdapterCapability();
  const receipts: Array<M9b13k5aVerifiedRetainedReceipt> = [];
  let clock = boundActivation.controllerStartMonotonicMs;
  const replay = (): M9b13k5aVerifiedReplay => {
    const result = replayM9b13k5aReceipts(
      boundActivation,
      receipts,
      boundActivation.controllerStartMonotonicMs + 1,
    );
    if (!result.ok) throw new Error(result.error.reason);
    return result.value;
  };
  const append = (
    event: M9b13k5aEventPayload,
  ): M9b13k5aVerifiedRetainedReceipt => {
    const before = replay().projection;
    const canonical = canonicalizeJson(event);
    if (!canonical.ok) throw new Error("event-canonicalization-failed");
    const draft = {
      protocol: M9B13K5A_NATIVE_RECEIPT_PROTOCOL,
      sessionIdentity: boundActivation.sessionIdentity,
      activationIdentity: boundActivation.activationIdentity,
      runIdentity: boundActivation.runIdentity,
      namespaceIdentity: boundActivation.ledgerNamespaceIdentity,
      storeIdentity: boundActivation.ledgerStoreIdentity,
      logDevice: boundActivation.logDevice,
      logInode: boundActivation.logInode,
      helperIdentity: boundActivation.helperIdentity,
      helperVariant: boundActivation.helperVariant,
      initialRoot: boundActivation.ledgerInitialRoot,
      previousRoot: before.currentRoot,
      resultingRoot: digest(`native-resulting-root-${before.sequence + 1}`),
      sequence: before.sequence + 1,
      canonicalPayloadDigest: m9b13k5aSha256(canonical.value),
    } as const;
    const receiptDigest = m9b13k5aCanonicalDigest(draft);
    if (!receiptDigest.ok) throw new Error(receiptDigest.error.reason);
    const nativeReceipt: M9b13k5aNativeReceipt = {
      ...draft,
      receiptDigest: receiptDigest.value,
    };
    const accepted = acceptM9b13k5aNativeLedgerReceipt(
      adapter,
      boundActivation,
      event,
      nativeReceipt,
      {
        revocationPhaseStartMonotonicMs: before.revocationPhaseStartMonotonicMs,
        revocationDeadlineMonotonicMs: before.revocationDeadlineMonotonicMs,
      },
    );
    if (!accepted.ok) throw new Error(accepted.error.reason);
    receipts.push(accepted.value);
    replay();
    return accepted.value;
  };
  return {
    activation: boundActivation,
    receipts,
    replay,
    append,
    projection: () => replay().projection,
    nextTime: () => ++clock,
  };
}

function binding(
  instance: Harness,
  operation?: M9b13k5aOperation,
  page?: number,
): Readonly<{
  protocol: typeof M9B13K5A_EVENT_PROTOCOL;
  activationIdentity: string;
  runIdentity: string;
  sessionIdentity: string;
  operation: M9b13k5aOperation;
  page: number;
  requestIdentity: string;
  requestDigest: string;
  reservationIdentity: string;
  observedMonotonicMs: number;
}> {
  const projection = instance.projection();
  const selectedOperation = operation ?? projection.expectedOperation;
  if (selectedOperation === null)
    throw new Error("expected-operation-required");
  const selectedPage = page ?? projection.expectedPage;
  return {
    protocol: M9B13K5A_EVENT_PROTOCOL,
    activationIdentity: instance.activation.activationIdentity,
    runIdentity: instance.activation.runIdentity,
    sessionIdentity: instance.activation.sessionIdentity,
    operation: selectedOperation,
    page: selectedPage,
    requestIdentity: digest(`request-${selectedOperation}-${selectedPage}`),
    requestDigest: digest(
      `request-digest-${selectedOperation}-${selectedPage}`,
    ),
    reservationIdentity: digest(
      `reservation-${selectedOperation}-${selectedPage}`,
    ),
    observedMonotonicMs: instance.nextTime(),
  };
}

function appendRequestLifecycle(
  instance: Harness,
  continuePage: boolean,
): Readonly<{
  permit: M9b13k5aDispatchPermit;
  eventKinds: ReadonlyArray<string>;
}> {
  const projection = instance.projection();
  const operation = projection.expectedOperation;
  if (operation === null) throw new Error("operation-required");
  const page = projection.expectedPage;
  const base = binding(instance, operation, page);
  const eventKinds: Array<string> = [];
  const append = (event: M9b13k5aEventPayload) => {
    eventKinds.push(event.kind);
    return instance.append(event);
  };
  const reservation = append({
    ...base,
    kind: "request-reserved",
    requestNumber: projection.requestCount + 1,
  });
  const permitIdentity = digest(`permit-${operation}-${page}`);
  const permitReceipt = append({
    ...base,
    observedMonotonicMs: instance.nextTime(),
    kind: "dispatch-permit-consumed",
    permitIdentity,
    reservationReceiptDigest: reservation.nativeReceipt.receiptDigest,
  });
  const issued = issueM9b13k5aDispatchPermit(instance.replay(), permitReceipt);
  if (!issued.ok) throw new Error(issued.error.reason);
  expect(consumeM9b13k5aDispatchPermit(issued.value)).toMatchObject({
    ok: true,
  });
  append({
    ...base,
    observedMonotonicMs: instance.nextTime(),
    kind: "enqueue-observed",
    permitIdentity,
    transportReceiptDigest: digest(`enqueue-receipt-${operation}-${page}`),
  });
  const rawSha256 = digest(`raw-${operation}-${page}`);
  const responseIdentity = digest(`response-${operation}-${page}`);
  append({
    ...base,
    observedMonotonicMs: instance.nextTime(),
    kind: "raw-response-recorded",
    responseIdentity,
    transportReceiptDigest: digest(`response-receipt-${operation}-${page}`),
    status: operation === "canary-put" ? 201 : 200,
    rawByteLength: 100,
    rawSha256,
  });
  const canonicalResponseSha256 = digest(`canonical-${operation}-${page}`);
  append({
    ...base,
    observedMonotonicMs: instance.nextTime(),
    kind: "response-validated",
    responseIdentity,
    rawSha256,
    canonicalResponseSha256,
  });
  append({
    ...base,
    observedMonotonicMs: instance.nextTime(),
    kind: "decision-projected",
    responseIdentity,
    rawSha256,
    canonicalResponseSha256,
    decisionProjectionSha256: digest(`decision-${operation}-${page}`),
  });
  const reconciliationBase = {
    ...base,
    observedMonotonicMs: instance.nextTime(),
    responseIdentity,
    reconciliationSha256: digest(`reconciliation-${operation}-${page}`),
  };
  switch (operation) {
    case "canary-put":
      append({
        ...reconciliationBase,
        kind: "upload-reconciled",
        exactObjectCardinality: 1,
        filename: M9B13K5A_FILENAME,
        putDigest: instance.activation.putDigest,
        objectIdentity: "synthetic-file-identity",
      });
      break;
    case "canary-download":
      append({
        ...reconciliationBase,
        kind: "download-reconciled",
        exactObjectCardinality: 1,
        filename: M9B13K5A_FILENAME,
        putDigest: instance.activation.putDigest,
        objectIdentity: "synthetic-file-identity",
        downloadedByteLength: 245,
        downloadedSha256: digest("downloaded-artifact"),
      });
      break;
    case "pat-revocation": {
      const start = reconciliationBase.observedMonotonicMs;
      append({
        ...reconciliationBase,
        kind: "revocation-reconciled",
        revocationProjectionSha256: digest("revocation-projection"),
        revocationPhaseStartMonotonicMs: start,
        revocationDeadlineMonotonicMs: start + M9B13K5A_REVOCATION_DURATION_MS,
      });
      break;
    }
    case "token-detail":
    case "project":
    case "registration-inventory":
    case "view-only-link-inventory":
    case "pre-upload-file-inventory":
    case "provider-root":
    case "post-upload-file-inventory":
      append({
        ...reconciliationBase,
        kind: "request-reconciled",
        exactObjectCardinality: 0,
      });
  }
  if (continuePage)
    append({
      ...base,
      observedMonotonicMs: instance.nextTime(),
      kind: "page-continued",
      nextPage: page + 1,
      nextUrlSha256: digest(`next-page-${operation}-${page + 1}`),
    });
  else
    append({
      ...base,
      observedMonotonicMs: instance.nextTime(),
      kind: "operation-completed",
      pagesCompleted: page,
      exactObjectCardinality: operation.includes("inventory") ? 0 : 1,
    });
  return { permit: issued.value, eventKinds };
}

function runPath(
  pageCounts: Readonly<Record<M9b13k5aOperation, number>>,
): Harness {
  const instance = harness();
  for (const specification of M9B13K5A_OPERATION_SPECS) {
    const pages = pageCounts[specification.operation];
    for (let page = 1; page <= pages; page++)
      appendRequestLifecycle(instance, page < pages);
  }
  return instance;
}

const shortestCounts = Object.fromEntries(
  M9B13K5A_OPERATION_SPECS.map((specification) => [
    specification.operation,
    specification.minimumPages,
  ]),
) as Readonly<Record<M9b13k5aOperation, number>>;
const longestCounts = Object.fromEntries(
  M9B13K5A_OPERATION_SPECS.map((specification) => [
    specification.operation,
    specification.maximumPages,
  ]),
) as Readonly<Record<M9b13k5aOperation, number>>;

function signCustodian(
  instance: Harness,
  privateKey: KeyObject,
  publicKey: KeyObject,
  overrides: Readonly<Partial<M9b13k5aCustodianUnsigned>> = {},
): unknown {
  const projection = instance.projection();
  const der = publicKey.export({ format: "der", type: "spki" });
  const fingerprint = createHash("sha256").update(der).digest("hex");
  const unsigned: M9b13k5aCustodianUnsigned = {
    protocol: M9B13K5A_CUSTODIAN_PROTOCOL,
    syntheticIdentity: "SYNTHETIC-M9B13K5A-CUSTODIAN",
    activationIdentity: instance.activation.activationIdentity,
    runIdentity: instance.activation.runIdentity,
    sessionIdentity: instance.activation.sessionIdentity,
    patCommitment: instance.activation.patCommitment,
    publicKeyFingerprint: fingerprint,
    custodianIdentity: digest(`SYNTHETIC-M9B13K5A-CUSTODIAN\0${fingerprint}`),
    revocationProjectionSha256: digest("revocation-projection"),
    acceptedLedgerReceiptDigest:
      projection.lastAcceptedLedgerReceiptDigest ?? digest("missing"),
    acceptedLedgerSequence: projection.sequence,
    acceptedLedgerRoot: projection.currentRoot,
    observedMonotonicMs: projection.lastMonotonicMs + 1,
    ...overrides,
  };
  const canonical = canonicalizeJson(unsigned);
  if (!canonical.ok) throw new Error("custodian-canonical-invalid");
  return {
    unsigned,
    publicKeyDerBase64: der.toString("base64"),
    signatureBase64: sign(
      null,
      new TextEncoder().encode(canonical.value),
      privateKey,
    ).toString("base64"),
  };
}

describe("M9b.13k.5a strict response and reconciliation design", () => {
  it("accepts every frozen official-shaped fixture without transformation", () => {
    const fixtures = fixtureRecord(officialFixtures);
    for (const kind of M9B13K5A_RESPONSE_KINDS) {
      const result = parseM9b13k5aOfficialResponse(
        kind,
        encode(fixtures[kind]),
      );
      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.response : null).toEqual(fixtures[kind]);
    }
  });

  it("rejects hostile official-shape near misses, duplicate keys, malformed UTF-8, and extras", () => {
    if (!Array.isArray(hostileFixtures)) throw new Error("hostiles-required");
    for (const hostile of hostileFixtures) {
      const record = fixtureRecord(hostile);
      const kind = record["kind"];
      if (
        typeof kind !== "string" ||
        !M9B13K5A_RESPONSE_KINDS.includes(kind as M9b13k5aResponseKind)
      )
        throw new Error("hostile-kind-invalid");
      expect(
        parseM9b13k5aOfficialResponse(
          kind as M9b13k5aResponseKind,
          encode(record["value"]),
        ).ok,
      ).toBe(false);
    }
    expect(
      parseM9b13k5aOfficialResponse(
        "token-detail",
        new TextEncoder().encode('{"data":{"type":"tokens","type":"tokens"}}'),
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5a-response-json-framing-invalid" },
    });
    expect(
      parseM9b13k5aOfficialResponse(
        "token-detail",
        Uint8Array.from([0xc3, 0x28]),
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k5a-response-utf8-invalid" },
    });
  });

  it("reconciles verified receipts and actual bytes with exact cardinality and URL identity", () => {
    const fixtures = fixtureRecord(officialFixtures);
    const upload = fixtureRecord(fixtures["upload"])["data"];
    const entity = m9b13k5aFileEntitySchema.parse(upload);
    const bytes = new TextEncoder().encode("x".repeat(245));
    const putUrl = `https://files.osf.io/v1/resources/${M9B13K5A_PROJECT_ID}/providers/${M9B13K5A_PROVIDER}/?kind=file&name=${M9B13K5A_FILENAME}`;
    const downloadUrl = entity.links.download;
    const putReceipt = createM9b13k5aSyntheticTransportReceipt({
      operation: "canary-put",
      page: 1,
      method: "PUT",
      requestedUrl: putUrl,
      requestDigest: digest("put-request"),
      responseIdentity: digest("put-response"),
      status: 201,
      rawByteLength: 100,
      rawSha256: digest("put-response-raw"),
    });
    const downloadReceipt = createM9b13k5aSyntheticTransportReceipt({
      operation: "canary-download",
      page: 1,
      method: "GET",
      requestedUrl: downloadUrl,
      requestDigest: digest("download-request"),
      responseIdentity: digest("download-response"),
      status: 200,
      rawByteLength: bytes.byteLength,
      rawSha256: m9b13k5aSha256(bytes),
    });
    const evidence: M9b13k5aStableObjectEvidence = {
      providerRootUploadUrl: `https://files.osf.io/v1/resources/${M9B13K5A_PROJECT_ID}/providers/${M9B13K5A_PROVIDER}/`,
      putUrl,
      uploadEntity: entity,
      postUploadInventory: [entity],
      downloadUrl,
    };
    expect(
      reconcileM9b13k5aStableObject(
        putReceipt,
        downloadReceipt,
        evidence,
        bytes,
      ),
    ).toMatchObject({
      ok: true,
      value: {
        objectIdentity: "synthetic-file-identity",
        byteLength: 245,
        exactObjectCardinality: 1,
      },
    });
    for (const mutation of [
      {
        ...evidence,
        downloadUrl: downloadUrl.replace(
          "files.osf.io",
          "files.osf.io.evil.example",
        ),
      },
      {
        ...evidence,
        downloadUrl: downloadUrl.replace(
          "synthetic-file-identity",
          "synthetic-file%2Fidentity",
        ),
      },
      {
        ...evidence,
        downloadUrl: downloadUrl.replace("osfstorage", "dropbox"),
      },
      {
        ...evidence,
        downloadUrl: downloadUrl.replace("bmsda", "foreign"),
      },
      { ...evidence, postUploadInventory: [entity, entity] },
      { ...evidence, postUploadInventory: [] },
    ])
      expect(
        reconcileM9b13k5aStableObject(
          putReceipt,
          downloadReceipt,
          mutation,
          bytes,
        ).ok,
      ).toBe(false);
    expect(
      reconcileM9b13k5aStableObject(
        { ...putReceipt },
        downloadReceipt,
        evidence,
        bytes,
      ).ok,
    ).toBe(false);
    expect(
      reconcileM9b13k5aStableObject(
        putReceipt,
        downloadReceipt,
        evidence,
        new TextEncoder().encode("y".repeat(245)),
      ).ok,
    ).toBe(false);
  });

  it("re-runs seed 331677701 for 2,048 official successes and foreign-host failures", () => {
    const fixture = fixtureRecord(officialFixtures)["token-detail"];
    fc.assert(
      fc.property(fc.stringMatching(/^[a-f0-9]{1,32}$/u), (suffix) => {
        expect(
          parseM9b13k5aOfficialResponse("token-detail", encode(fixture)).ok,
        ).toBe(true);
        const foreign = `https://files.osf.io.${suffix}.invalid/v1/resources/bmsda/providers/osfstorage/synthetic-file-identity`;
        const bytes = new Uint8Array();
        const putReceipt = createM9b13k5aSyntheticTransportReceipt({
          operation: "canary-put",
          page: 1,
          method: "PUT",
          requestedUrl: `https://files.osf.io/v1/resources/bmsda/providers/osfstorage/?kind=file&name=${M9B13K5A_FILENAME}`,
          requestDigest: digest("p"),
          responseIdentity: digest("pr"),
          status: 201,
          rawByteLength: 0,
          rawSha256: digest("prb"),
        });
        const downloadReceipt = createM9b13k5aSyntheticTransportReceipt({
          operation: "canary-download",
          page: 1,
          method: "GET",
          requestedUrl: foreign,
          requestDigest: digest("d"),
          responseIdentity: digest("dr"),
          status: 200,
          rawByteLength: 0,
          rawSha256: m9b13k5aSha256(bytes),
        });
        const upload = fixtureRecord(fixtureRecord(officialFixtures)["upload"])[
          "data"
        ];
        const entity = m9b13k5aFileEntitySchema.parse(upload);
        expect(
          reconcileM9b13k5aStableObject(
            putReceipt,
            downloadReceipt,
            {
              providerRootUploadUrl:
                "https://files.osf.io/v1/resources/bmsda/providers/osfstorage/",
              putUrl: putReceipt.requestedUrl,
              uploadEntity: {
                ...entity,
                links: { ...entity.links, download: foreign },
              },
              postUploadInventory: [entity],
              downloadUrl: foreign,
            },
            bytes,
          ).ok,
        ).toBe(false);
      }),
      { seed: 331_677_701, numRuns: 2_048 },
    );
  });
});

describe("M9b.13k.5a accepted receipt and replay model", () => {
  it("freezes shortest and maximum request paths with every mandatory operation", () => {
    const shortest = deriveM9b13k5aRequestPath(shortestCounts);
    const longest = deriveM9b13k5aRequestPath(longestCounts);
    if (!shortest.ok || !longest.ok) throw new Error("paths-required");
    expect(shortest.value).toHaveLength(M9B13K5A_SHORTEST_REQUEST_COUNT);
    expect(longest.value).toHaveLength(M9B13K5A_LONGEST_REQUEST_COUNT);
    expect(M9B13K5A_SHORTEST_REQUEST_COUNT).toBe(10);
    expect(M9B13K5A_LONGEST_REQUEST_COUNT).toBe(18);
    expect(
      longest.value
        .slice(0, 11)
        .every((slot) => slot.operation !== "canary-put"),
    ).toBe(true);
    expect(longest.value[11]?.operation).toBe("canary-put");
    expect(
      longest.value
        .slice(12, 16)
        .every((slot) => slot.operation === "post-upload-file-inventory"),
    ).toBe(true);
    expect(longest.value[16]?.operation).toBe("canary-download");
    expect(longest.value[17]?.operation).toBe("pat-revocation");
    expect(new Set(shortest.value.map((slot) => slot.operation))).toEqual(
      new Set(M9B13K5A_OPERATION_SPECS.map((item) => item.operation)),
    );
    expect(
      deriveM9b13k5aRequestPath({
        ...shortestCounts,
        "registration-inventory": 3,
      }).ok,
    ).toBe(false);
  });

  it("executes shortest and maximum histories by exhaustive accepted-receipt replay", () => {
    for (const [counts, expected] of [
      [shortestCounts, 10],
      [longestCounts, 18],
    ] as const) {
      const instance = runPath(counts);
      const projection = instance.projection();
      expect(projection).toMatchObject({
        expectedOperation: null,
        requestStage: "idle",
        requestCount: expected,
        operationIndex: 10,
      });
      expect(projection.completedOperations).toEqual(
        M9B13K5A_OPERATION_SPECS.map((item) => item.operation),
      );
      expect(new Set(projection.possiblyDispatchedRequestIdentities).size).toBe(
        expected,
      );
    }
  });

  it("exhaustively freezes every allowed and forbidden stage/event pairing", () => {
    const stages = Object.keys(M9B13K5A_ALLOWED_STAGE_EVENTS) as ReadonlyArray<
      keyof typeof M9B13K5A_ALLOWED_STAGE_EVENTS
    >;
    let allowed = 0;
    let forbidden = 0;
    for (const stage of stages)
      for (const kind of M9B13K5A_EVENT_KINDS) {
        if (M9B13K5A_ALLOWED_STAGE_EVENTS[stage].includes(kind)) allowed++;
        else forbidden++;
      }
    expect(allowed).toBe(18);
    expect(forbidden).toBe(stages.length * M9B13K5A_EVENT_KINDS.length - 18);
    expect(stages).toHaveLength(9);
    expect(M9B13K5A_EVENT_KINDS).toHaveLength(15);
  });

  it("rejects irrelevant discriminated fields and every payload stays under the native limit", () => {
    const instance = runPath(shortestCounts);
    for (const receipt of instance.receipts) {
      const canonical = canonicalizeJson(receipt.eventPayload);
      if (!canonical.ok) throw new Error("canonical-payload-required");
      expect(
        new TextEncoder().encode(canonical.value).byteLength,
      ).toBeLessThanOrEqual(M9B13K5A_LEDGER_PAYLOAD_LIMIT);
      expect(
        m9b13k5aEventPayloadSchema.safeParse({
          ...receipt.eventPayload,
          irrelevantHostileField: true,
        }).success,
      ).toBe(false);
    }
    expect(
      m9b13k5aEventPayloadSchema.safeParse({
        ...binding(harness()),
        kind: "request-object-created",
      }).success,
    ).toBe(false);
  });

  it("closes the crash-before-enqueue gap and proves zero redispatch at every ambiguous boundary", () => {
    const boundaries = [
      "immediately-after-commit-before-enqueue",
      "during-enqueue",
      "after-enqueue-before-response",
      "during-response-persistence",
      "after-response-before-projection",
    ] as const;
    for (const boundaryName of boundaries) {
      const instance = harness();
      const base = binding(instance);
      const reservation = instance.append({
        ...base,
        kind: "request-reserved",
        requestNumber: 1,
      });
      const permitIdentity = digest(`permit-${boundaryName}`);
      const committed = instance.append({
        ...base,
        observedMonotonicMs: instance.nextTime(),
        kind: "dispatch-permit-consumed",
        permitIdentity,
        reservationReceiptDigest: reservation.nativeReceipt.receiptDigest,
      });
      const permit = issueM9b13k5aDispatchPermit(instance.replay(), committed);
      if (!permit.ok) throw new Error(permit.error.reason);
      expect(consumeM9b13k5aDispatchPermit(permit.value).ok).toBe(true);
      if (
        boundaryName === "during-enqueue" ||
        boundaryName === "after-enqueue-before-response" ||
        boundaryName === "during-response-persistence" ||
        boundaryName === "after-response-before-projection"
      )
        instance.append({
          ...base,
          observedMonotonicMs: instance.nextTime(),
          kind: "enqueue-observed",
          permitIdentity,
          transportReceiptDigest: digest(`transport-${boundaryName}`),
        });
      if (boundaryName === "after-response-before-projection")
        instance.append({
          ...base,
          observedMonotonicMs: instance.nextTime(),
          kind: "raw-response-recorded",
          responseIdentity: digest("response"),
          transportReceiptDigest: digest("response-transport"),
          status: 200,
          rawByteLength: 1,
          rawSha256: digest("raw"),
        });
      instance.append({
        ...base,
        observedMonotonicMs: instance.nextTime(),
        kind: "response-ambiguity",
        permitIdentity,
        transportReceiptDigest: digest(`ambiguity-${boundaryName}`),
        classification:
          boundaryName === "immediately-after-commit-before-enqueue"
            ? "committed-before-enqueue"
            : boundaryName === "during-enqueue"
              ? "during-enqueue"
              : boundaryName === "after-response-before-projection"
                ? "after-response-before-projection"
                : boundaryName === "during-response-persistence"
                  ? "during-response-persistence"
                  : "after-enqueue-before-response",
      });
      expect(instance.projection()).toMatchObject({
        terminal: true,
        requestStage: "ambiguous",
      });
      expect(instance.projection().possiblyDispatchedRequestIdentities).toEqual(
        [base.requestIdentity],
      );
      expect(consumeM9b13k5aDispatchPermit(permit.value)).toMatchObject({
        ok: false,
        error: { reason: "m9b13k5a-dispatch-permit-reused" },
      });
      expect(issueM9b13k5aDispatchPermit(instance.replay(), committed).ok).toBe(
        false,
      );
      const serializedReplay = parseJson(JSON.stringify(instance.replay()));
      if (!serializedReplay.ok) throw new Error(serializedReplay.error.code);
      expect(
        issueM9b13k5aDispatchPermit(serializedReplay.value, committed).ok,
      ).toBe(false);
    }

    const beforeCommit = harness();
    const base = binding(beforeCommit);
    beforeCommit.append({
      ...base,
      kind: "request-reserved",
      requestNumber: 1,
    });
    expect(beforeCommit.projection()).toMatchObject({
      requestStage: "reserved",
      possiblyDispatchedRequestIdentities: [],
    });
  });

  it("rejects ordinary JSON receipts, stale roots, sequences, replay serialization, and pagination reset", () => {
    const instance = harness();
    const base = binding(instance);
    const receipt = instance.append({
      ...base,
      kind: "request-reserved",
      requestNumber: 1,
    });
    expect(
      replayM9b13k5aReceipts(
        instance.activation,
        [{ ...receipt }],
        instance.activation.controllerStartMonotonicMs + 1,
      ).ok,
    ).toBe(false);
    expect(
      replayM9b13k5aReceipts(
        instance.activation,
        [
          receipt,
          {
            ...receipt,
            nativeReceipt: {
              ...receipt.nativeReceipt,
              previousRoot: digest("stale-root"),
              sequence: 2,
            },
          },
        ],
        instance.activation.controllerStartMonotonicMs + 1,
      ).ok,
    ).toBe(false);
    expect(
      replayM9b13k5aReceipts(
        {
          ...instance.activation,
          controllerDeadlineMonotonicMs:
            instance.activation.controllerDeadlineMonotonicMs + 1,
        },
        instance.receipts,
        instance.activation.controllerStartMonotonicMs + 1,
      ).ok,
    ).toBe(false);
    expect(
      m9b13k5aEventPayloadSchema.safeParse({
        ...base,
        kind: "page-continued",
        nextPage: 1,
        nextUrlSha256: digest("rewind"),
      }).success,
    ).toBe(true);
  });

  it("binds nonzero absolute deadlines across restart at deadline-1, deadline, and deadline+1", () => {
    const instance = harness();
    const start = instance.activation.controllerStartMonotonicMs;
    const deadline = instance.activation.controllerDeadlineMonotonicMs;
    expect(start).toBeGreaterThan(0);
    expect(deadline).toBe(start + M9B13K5A_CONTROLLER_DURATION_MS);
    for (const now of [deadline - 1, deadline, deadline + 1])
      expect(replayM9b13k5aReceipts(instance.activation, [], now).ok).toBe(
        now === deadline - 1,
      );
  });

  it("applies revocation and custodian deadline boundaries at deadline-1, deadline, and deadline+1", () => {
    for (const offset of [-1, 0, 1] as const) {
      const instance = runPath(shortestCounts);
      const deadline = instance.projection().revocationDeadlineMonotonicMs;
      if (deadline === null) throw new Error("revocation-deadline-required");
      const keys = generateKeyPairSync("ed25519");
      const receipt = signCustodian(instance, keys.privateKey, keys.publicKey, {
        observedMonotonicMs: deadline + offset,
      });
      expect(
        verifyM9b13k5aCustodianReceipt(
          instance.activation,
          instance.replay(),
          receipt,
        ).ok,
      ).toBe(offset === -1);
    }
  });

  it("verifies genuine Ed25519 custodian lineage and rejects every hostile mutation", () => {
    const instance = runPath(shortestCounts);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const receipt = signCustodian(instance, privateKey, publicKey);
    const verified = verifyM9b13k5aCustodianReceipt(
      instance.activation,
      instance.replay(),
      receipt,
    );
    expect(verified).toMatchObject({ ok: true });
    if (!verified.ok) throw new Error(verified.error.reason);
    const parsed = m9b13k5aCustodianReceiptSchema.parse(receipt);
    const hostileUnsigned = [
      { runIdentity: "SYNTHETIC-WRONG-RUN" },
      { sessionIdentity: "SYNTHETIC-WRONG-SESSION" },
      { revocationProjectionSha256: digest("wrong-revocation") },
      { acceptedLedgerRoot: digest("stale-root") },
      {
        observedMonotonicMs:
          instance.projection().revocationDeadlineMonotonicMs ?? 0,
      },
    ];
    for (const changed of hostileUnsigned) {
      const hostile = {
        ...parsed,
        unsigned: { ...parsed.unsigned, ...changed },
      };
      expect(
        verifyM9b13k5aCustodianReceipt(
          instance.activation,
          instance.replay(),
          hostile,
        ).ok,
      ).toBe(false);
    }
    expect(
      verifyM9b13k5aCustodianReceipt(instance.activation, instance.replay(), {
        ...parsed,
        signatureBase64: Buffer.from("forged").toString("base64"),
      }).ok,
    ).toBe(false);
    const foreignKeys = generateKeyPairSync("ed25519");
    expect(
      verifyM9b13k5aCustodianReceipt(
        instance.activation,
        instance.replay(),
        signCustodian(instance, foreignKeys.privateKey, foreignKeys.publicKey, {
          publicKeyFingerprint: parsed.unsigned.publicKeyFingerprint,
          custodianIdentity: parsed.unsigned.custodianIdentity,
        }),
      ).ok,
    ).toBe(false);

    const custodianEventBase = binding(instance, "pat-revocation", 1);
    instance.append({
      ...custodianEventBase,
      kind: "custodian-evidence-accepted",
      custodianReceiptDigest: verified.value.custodianReceiptDigest,
      revocationProjectionSha256: digest("revocation-projection"),
    });
    instance.append({
      ...custodianEventBase,
      observedMonotonicMs: instance.nextTime(),
      kind: "terminal-closed",
      requestCount: M9B13K5A_SHORTEST_REQUEST_COUNT,
      custodianReceiptDigest: verified.value.custodianReceiptDigest,
    });
    expect(instance.projection()).toMatchObject({
      terminal: true,
      custodianVerified: true,
      requestCount: 10,
    });
  });

  it("freezes identities, future order, response routing, and fixed-seed replay equivalence", () => {
    expect(deriveM9b13k5aProtocolIdentity()).toMatch(/^[a-f0-9]{64}$/u);
    expect(deriveM9b13k5aStateModelIdentity()).toMatch(/^[a-f0-9]{64}$/u);
    expect(M9B13K5A_FUTURE_IMPLEMENTATION_ORDER).toHaveLength(10);
    expect(M9B13K5A_FUTURE_IMPLEMENTATION_ORDER[0]).toContain(
      "accepted-ledger-adapter",
    );
    for (const specification of M9B13K5A_OPERATION_SPECS)
      expect(responseKindForOperation(specification.operation)).toBe(
        ["canary-download", "pat-revocation"].includes(specification.operation)
          ? null
          : specification.operation === "registration-inventory"
            ? "registrations"
            : specification.operation === "view-only-link-inventory"
              ? "view-only-links"
              : specification.operation.includes("file-inventory")
                ? "file-list"
                : specification.operation === "canary-put"
                  ? "upload"
                  : specification.operation,
      );
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 }), (registrationPages) => {
        const counts = {
          ...shortestCounts,
          "registration-inventory": registrationPages,
        };
        const first = runPath(counts).projection();
        const second = runPath(counts).projection();
        expect(first).toEqual(second);
      }),
      { seed: 5_130_505, numRuns: 4 },
    );
  });
});
