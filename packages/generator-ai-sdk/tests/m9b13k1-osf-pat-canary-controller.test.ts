import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Duplex } from "node:stream";

import { canonicalizeJson, parseJson } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  frozenM9b13k1ArtifactBytes,
  inspectM9b13k1StructuralCandidateJson,
  M9B13K1_ACTIVATION_PROTOCOL,
  M9B13K1_API_RESPONSE_MAXIMUM_BYTES,
  M9B13K1_ARTIFACT_BYTE_LENGTH,
  M9B13K1_ARTIFACT_FILENAME,
  M9B13K1_ARTIFACT_IDENTITY,
  M9B13K1_ARTIFACT_SHA256,
  M9B13K1_AUTHORITY_UNAVAILABLE_PROTOCOL,
  M9B13K1_CONTROLLER_DEADLINE_MS,
  M9B13K1_CONTROLLER_PROTOCOL,
  M9B13K1_CREDENTIAL_CUSTODY_PROTOCOL,
  M9B13K1_DRAFT_ID,
  M9B13K1_LEDGER_PROTOCOL,
  M9B13K1_MAXIMUM_HTTP_REQUESTS,
  M9B13K1_MAXIMUM_PUT_DISPATCHES,
  M9B13K1_MAXIMUM_REQUEST_BODY_BYTES,
  M9B13K1_MAXIMUM_REVOCATION_ATTEMPTS,
  M9B13K1_OBJECT_RECONCILIATION_PROTOCOL,
  M9B13K1_PROJECT_ID,
  M9B13K1_PROVIDER,
  M9B13K1_REQUEST_TIMEOUT_MS,
  M9B13K1_REQUIRED_SCOPE,
  M9B13K1_REVOCATION_DEADLINE_MS,
  M9B13K1_REVOCATION_PROTOCOL,
  M9B13K1_TRANSPORT_PROTOCOL,
  M9B13K1_UPLOAD_RESPONSE_MAXIMUM_BYTES,
  m9b13k1LiveOutcomeSchema,
  type M9b13k1StructuralCandidate,
  m9b13k1StructuralCandidateSchema,
  runM9b13k1OsfPatCanaryController,
} from "../internal/m9b13k1-osf-pat-canary-controller.js";

function futureStructuralCandidate(): M9b13k1StructuralCandidate {
  return {
    protocol: M9B13K1_ACTIVATION_PROTOCOL,
    controllerProtocol: M9B13K1_CONTROLLER_PROTOCOL,
    authorityKind: "independently-frozen-closure-capability",
    activationIdentity: `sha256:${"a".repeat(64)}`,
    requestIdentity: `sha256:${"b".repeat(64)}`,
    correctedSourceSha256: "c".repeat(64),
    correctedTestSha256: "d".repeat(64),
    packageManifestSha256: "e".repeat(64),
    credentialCustodyProtocol: M9B13K1_CREDENTIAL_CUSTODY_PROTOCOL,
    ledgerProtocol: M9B13K1_LEDGER_PROTOCOL,
    ledgerImplementationIdentity: `sha256:${"1".repeat(64)}`,
    ledgerInitialRoot: `sha256:${"2".repeat(64)}`,
    transportProtocol: M9B13K1_TRANSPORT_PROTOCOL,
    transportImplementationIdentity: `sha256:${"3".repeat(64)}`,
    custodianProtocol: M9B13K1_REVOCATION_PROTOCOL,
    custodianImplementationIdentity: `sha256:${"4".repeat(64)}`,
    objectReconciliationProtocol: M9B13K1_OBJECT_RECONCILIATION_PROTOCOL,
    tokenId: "5".repeat(24),
    expectedScope: M9B13K1_REQUIRED_SCOPE,
    projectId: M9B13K1_PROJECT_ID,
    draftId: M9B13K1_DRAFT_ID,
    provider: M9B13K1_PROVIDER,
    artifactIdentity: M9B13K1_ARTIFACT_IDENTITY,
    artifactFilename: M9B13K1_ARTIFACT_FILENAME,
    artifactSha256: M9B13K1_ARTIFACT_SHA256,
    artifactByteLength: M9B13K1_ARTIFACT_BYTE_LENGTH,
    limits: {
      maximumHttpRequests: M9B13K1_MAXIMUM_HTTP_REQUESTS,
      maximumPutDispatches: M9B13K1_MAXIMUM_PUT_DISPATCHES,
      maximumRevocationAttempts: M9B13K1_MAXIMUM_REVOCATION_ATTEMPTS,
      maximumRequestBodyBytes: M9B13K1_MAXIMUM_REQUEST_BODY_BYTES,
      apiResponseMaximumBytes: M9B13K1_API_RESPONSE_MAXIMUM_BYTES,
      uploadResponseMaximumBytes: M9B13K1_UPLOAD_RESPONSE_MAXIMUM_BYTES,
      perRequestTimeoutMs: M9B13K1_REQUEST_TIMEOUT_MS,
      controllerDeadlineMs: M9B13K1_CONTROLLER_DEADLINE_MS,
      revocationDeadlineMs: M9B13K1_REVOCATION_DEADLINE_MS,
      retries: 0,
      concurrency: 1,
      redirectPolicy: "error",
    },
  };
}

function stableJson(value: unknown): string {
  const canonical = canonicalizeJson(value);
  if (!canonical.ok) throw new Error("Synthetic candidate was not JSON.");
  return canonical.value;
}

async function runIsolatedNoFd3Process(): Promise<
  Readonly<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
  }>
> {
  const source = `
const controller = await import("./packages/generator-ai-sdk/internal/m9b13k1-osf-pat-canary-controller.ts");
const hostile = new Proxy({}, { get() { throw new Error("candidate inspected"); } });
const outcome = await controller.runM9b13k1OsfPatCanaryController(hostile);
console.log(JSON.stringify(outcome));`;
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", source],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  const { code, signal } = await new Promise<
    Readonly<{ code: number | null; signal: NodeJS.Signals | null }>
  >((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, exitSignal) => {
      resolve({ code: exitCode, signal: exitSignal });
    });
  });
  return {
    code,
    signal,
    stdout: stdout.trim(),
  };
}

async function runIsolatedPreservedFd3Process(): Promise<
  Readonly<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
  }>
> {
  const source = `
import { readSync } from "node:fs";
const controller = await import("./packages/generator-ai-sdk/internal/m9b13k1-osf-pat-canary-controller.ts");
const outcome = await controller.runM9b13k1OsfPatCanaryController({ launchProof: "caller-claim" });
const untouched = Buffer.alloc(4);
const bytesRead = readSync(3, untouched, 0, untouched.byteLength, null);
console.log(JSON.stringify({ outcome, bytesRead, untouched: untouched.toString("ascii") }));`;
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", source],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "pipe"] },
  );
  const fd3Pipe = child.stdio[3];
  if (!(fd3Pipe instanceof Duplex)) {
    throw new Error("Child FD3 pipe was not created.");
  }
  if (child.stdout === null) {
    throw new Error("Child stdout pipe was not created.");
  }
  fd3Pipe.end("seal");
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  const { code, signal } = await new Promise<
    Readonly<{ code: number | null; signal: NodeJS.Signals | null }>
  >((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, exitSignal) => {
      resolve({ code: exitCode, signal: exitSignal });
    });
  });
  return {
    code,
    signal,
    stdout: stdout.trim(),
  };
}

describe("M9b.13k.1 authority-unavailable live boundary", () => {
  it("returns the exact no-go stop without inspecting ordinary input", async () => {
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error("live entry inspected caller input");
        },
        ownKeys: () => {
          throw new Error("live entry enumerated caller input");
        },
      },
    );
    const outcome = await runM9b13k1OsfPatCanaryController(hostile);
    expect(m9b13k1LiveOutcomeSchema.safeParse(outcome).success).toBe(true);
    expect(outcome).toStrictEqual({
      protocol: M9B13K1_CONTROLLER_PROTOCOL,
      decision: "m9b13k1-correction-no-go",
      terminalState: "authority-unavailable-zero-effect-stop",
      reason: "m9b13k1-correction-no-go",
      authorityProtocol: M9B13K1_AUTHORITY_UNAVAILABLE_PROTOCOL,
      authorityAvailable: false,
      candidateInspected: false,
      effectAdmission: "denied-before-effect-subsystem-construction",
      credentialAccess: "none",
      ledgerAccess: "none",
      transportAccess: "none",
      custodianAccess: "none",
      externalEffects: "none-by-construction",
    });
  });

  it("exposes no caller-controlled dependency parameter", async () => {
    expect(runM9b13k1OsfPatCanaryController).toHaveLength(1);
    const outcome = await runM9b13k1OsfPatCanaryController({
      credentialReader: "caller-selected",
      ledger: "caller-selected",
      transport: "caller-selected",
      monotonicClock: "caller-selected",
      revocationCustodian: "caller-selected",
    });
    expect(outcome.decision).toBe("m9b13k1-correction-no-go");
    expect(outcome.externalEffects).toBe("none-by-construction");
  });

  it("does not let two caller-selected ledger namespaces duplicate authority", async () => {
    const first = await runM9b13k1OsfPatCanaryController({
      ledgerNamespace: "caller-one",
    });
    const second = await runM9b13k1OsfPatCanaryController({
      ledgerNamespace: "caller-two",
    });
    expect(first).toStrictEqual(second);
    expect(first.effectAdmission).toBe(
      "denied-before-effect-subsystem-construction",
    );
    expect(first.externalEffects).toBe("none-by-construction");
  });

  it("keeps a structurally valid future document nonauthoritative", () => {
    const candidate = futureStructuralCandidate();
    expect(m9b13k1StructuralCandidateSchema.safeParse(candidate).success).toBe(
      true,
    );
    expect(
      inspectM9b13k1StructuralCandidateJson(stableJson(candidate)),
    ).toEqual({
      protocol: M9B13K1_AUTHORITY_UNAVAILABLE_PROTOCOL,
      structurallyValid: true,
      authorityAvailable: false,
      effectAdmission: "denied",
      reason: "m9b13k1-structural-candidate-valid-but-nonauthoritative",
    });
  });

  it.each([
    "not-json",
    "null",
    "{}",
    stableJson({ ...futureStructuralCandidate(), projectId: "other" }),
    stableJson({ ...futureStructuralCandidate(), arbitraryNamespace: "reset" }),
  ])("keeps malformed or substituted structure nonauthoritative", (text) => {
    expect(inspectM9b13k1StructuralCandidateJson(text)).toEqual({
      protocol: M9B13K1_AUTHORITY_UNAVAILABLE_PROTOCOL,
      structurallyValid: false,
      authorityAvailable: false,
      effectAdmission: "denied",
      reason: "m9b13k1-structural-candidate-invalid",
    });
  });

  it("preserves the exact frozen artifact identity without admitting effects", () => {
    const bytes = frozenM9b13k1ArtifactBytes();
    expect(bytes).toHaveLength(M9B13K1_ARTIFACT_BYTE_LENGTH);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      M9B13K1_ARTIFACT_SHA256,
    );
    expect(new TextDecoder().decode(bytes)).toBe(
      `frozen identity: ${M9B13K1_ARTIFACT_IDENTITY}\nexact filename: ${M9B13K1_ARTIFACT_FILENAME}\nSYNTHETIC NON-STUDY OSF PAT WATERBUTLER CANARY\nThis file contains no scientific, operational or protected content.\n`,
    );
  });

  it("exits cleanly without touching an internally reused FD3", async () => {
    const child = await runIsolatedNoFd3Process();
    expect(child.code).toBe(0);
    expect(child.signal).toBeNull();
    const parsed = parseJson(child.stdout);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("Child emitted malformed JSON.");
    expect(m9b13k1LiveOutcomeSchema.safeParse(parsed.value).success).toBe(true);
  });

  it("leaves a deliberately inherited FD3 open and unread", async () => {
    const child = await runIsolatedPreservedFd3Process();
    expect(child.code).toBe(0);
    expect(child.signal).toBeNull();
    const parsed = parseJson(child.stdout);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("Child emitted malformed JSON.");
    const result = z
      .strictObject({
        outcome: m9b13k1LiveOutcomeSchema,
        bytesRead: z.literal(4),
        untouched: z.literal("seal"),
      })
      .safeParse(parsed.value);
    expect(result.success).toBe(true);
  });
});
