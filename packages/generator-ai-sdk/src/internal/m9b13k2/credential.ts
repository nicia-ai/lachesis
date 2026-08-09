import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, fstatSync, readSync } from "node:fs";
import { Duplex } from "node:stream";

import { parseJson } from "@nicia-ai/lachesis";
import { z } from "zod";

import {
  M9B13K2_LAUNCH_PROTOCOL,
  M9B13K2_SYNTHETIC_PROTOCOL,
  m9b13k2DomainDigest,
} from "./protocol.js";

const LAUNCH_PROTOCOL_ENV = "LACHESIS_M9B13K2_LAUNCH_PROTOCOL";
const LAUNCH_PROOF_DIGEST_ENV = "LACHESIS_M9B13K2_LAUNCH_PROOF_SHA256";
const MAXIMUM_PROOF_BYTES = 65;
const MAXIMUM_CREDENTIAL_READ_BYTES = 66;
const SYNTHETIC_PREFIX = "M9B13K2SYNTHETICNONOSF";

export const m9b13k2CredentialChildOutcomeSchema = z
  .strictObject({
    protocol: z.literal(M9B13K2_LAUNCH_PROTOCOL),
    terminalState: z.enum([
      "credential-accepted-owned",
      "credential-malformed",
      "credential-read-failed",
      "launch-evidence-invalid",
      "launch-evidence-unavailable",
      "owned-fd3-invalid",
    ]),
    launchEvidenceReads: z.union([z.literal(0), z.literal(1)]),
    fd3Reads: z.union([z.literal(0), z.literal(1)]),
    fd3Closes: z.union([z.literal(0), z.literal(1)]),
    credentialBytesObserved: z.number().int().min(0).max(66),
    mutableBuffersZeroized: z.literal(true),
    credentialExposed: z.literal(false),
  })
  .readonly();

export type M9b13k2CredentialChildOutcome = z.infer<
  typeof m9b13k2CredentialChildOutcomeSchema
>;

function childOutcome(
  terminalState: M9b13k2CredentialChildOutcome["terminalState"],
  launchEvidenceReads: 0 | 1,
  fd3Reads: 0 | 1,
  fd3Closes: 0 | 1,
  credentialBytesObserved: number,
): M9b13k2CredentialChildOutcome {
  return m9b13k2CredentialChildOutcomeSchema.parse({
    protocol: M9B13K2_LAUNCH_PROTOCOL,
    terminalState,
    launchEvidenceReads,
    fd3Reads,
    fd3Closes,
    credentialBytesObserved,
    mutableBuffersZeroized: true,
    credentialExposed: false,
  });
}

function isAsciiAlphanumeric(byte: number): boolean {
  return (
    (byte >= 0x30 && byte <= 0x39) ||
    (byte >= 0x41 && byte <= 0x5a) ||
    (byte >= 0x61 && byte <= 0x7a)
  );
}

function isCredentialShape(bytes: Uint8Array, count: number): boolean {
  if (count !== 65 || bytes[64] !== 0x0a) return false;
  for (let index = 0; index < 64; index += 1) {
    const byte = bytes[index];
    if (byte === undefined || !isAsciiAlphanumeric(byte)) return false;
  }
  return true;
}

function isSyntheticCredential(bytes: Uint8Array): boolean {
  const prefix = new TextEncoder().encode(SYNTHETIC_PREFIX);
  if (bytes.byteLength !== 64 || prefix.byteLength > bytes.byteLength)
    return false;
  for (const [index, byte] of prefix.entries())
    if (bytes[index] !== byte) return false;
  return true;
}

/** Pure classifier for the synthetic conformance suite; it performs no I/O. */
export function inspectM9b13k2CredentialFramesForConformance(
  credential: Uint8Array,
  frame: Uint8Array,
): Readonly<{
  syntheticCredential: boolean;
  credentialFrameValid: boolean;
}> {
  return {
    syntheticCredential: isSyntheticCredential(credential),
    credentialFrameValid: isCredentialShape(frame, frame.byteLength),
  };
}

function launchEvidenceMatches(
  proof: Uint8Array,
  count: number,
  expectedDigest: string,
): boolean {
  return (
    count === 32 &&
    m9b13k2DomainDigest(M9B13K2_LAUNCH_PROTOCOL, proof.subarray(0, count)) ===
      expectedDigest
  );
}

/** Pure proof classifier for the synthetic conformance suite. */
export function inspectM9b13k2LaunchEvidenceForConformance(
  proof: Uint8Array,
  expectedDigest: string,
): boolean {
  return launchEvidenceMatches(proof, proof.byteLength, expectedDigest);
}

type M9b13k2SyntheticChildObservation =
  | Readonly<{ kind: "launch-evidence-unavailable" }>
  | Readonly<{ kind: "launch-evidence-invalid" }>
  | Readonly<{ kind: "owned-fd3-invalid" }>
  | Readonly<{
      kind: "credential-read";
      bytes: Uint8Array;
      count: number;
      readFailed: boolean;
    }>;

function childOutcomeFromObservation(
  observation: M9b13k2SyntheticChildObservation,
): M9b13k2CredentialChildOutcome {
  switch (observation.kind) {
    case "launch-evidence-unavailable":
      return childOutcome("launch-evidence-unavailable", 0, 0, 0, 0);
    case "launch-evidence-invalid":
      return childOutcome("launch-evidence-invalid", 1, 0, 0, 0);
    case "owned-fd3-invalid":
      return childOutcome("owned-fd3-invalid", 1, 0, 0, 0);
    case "credential-read":
      return childOutcome(
        observation.readFailed
          ? "credential-read-failed"
          : isCredentialShape(observation.bytes, observation.count)
            ? "credential-accepted-owned"
            : "credential-malformed",
        1,
        1,
        1,
        observation.count,
      );
  }
}

/** Pure owned-child state machine for the synthetic conformance suite. */
export function inspectM9b13k2OwnedChildObservationForConformance(
  observation: M9b13k2SyntheticChildObservation,
): M9b13k2CredentialChildOutcome {
  return childOutcomeFromObservation(observation);
}

function descriptorIsAnonymousChannel(descriptor: number): boolean {
  try {
    const status = fstatSync(descriptor);
    return status.isFIFO() || status.isSocket();
  } catch {
    return false;
  }
}

function readLaunchEvidenceFromDescriptor(
  descriptor: number,
  protocol: string | undefined,
  expectedDigest: string | undefined,
): Readonly<{
  valid: boolean;
  read: 0 | 1;
}> {
  if (
    protocol !== M9B13K2_LAUNCH_PROTOCOL ||
    expectedDigest === undefined ||
    !/^[a-f0-9]{64}$/u.test(expectedDigest)
  )
    return { valid: false, read: 0 };
  if (!descriptorIsAnonymousChannel(descriptor))
    return { valid: false, read: 0 };
  const proof = new Uint8Array(MAXIMUM_PROOF_BYTES);
  try {
    const count = readSync(descriptor, proof, 0, proof.byteLength, null);
    return {
      valid: launchEvidenceMatches(proof, count, expectedDigest),
      read: 1,
    };
  } catch {
    return { valid: false, read: 1 };
  } finally {
    proof.fill(0);
    try {
      closeSync(descriptor);
    } catch {
      // The controlled launch evidence descriptor may already be closed.
    }
  }
}

function readLaunchEvidence(): Readonly<{
  valid: boolean;
  read: 0 | 1;
}> {
  return readLaunchEvidenceFromDescriptor(
    4,
    process.env[LAUNCH_PROTOCOL_ENV],
    process.env[LAUNCH_PROOF_DIGEST_ENV],
  );
}

/** Reads and closes a synthetic FIFO/socket proof descriptor in conformance. */
export function inspectM9b13k2LaunchEvidenceDescriptorForConformance(
  descriptor: number,
  expectedDigest: string,
): Readonly<{ valid: boolean; read: 0 | 1 }> {
  return readLaunchEvidenceFromDescriptor(
    descriptor,
    M9B13K2_LAUNCH_PROTOCOL,
    expectedDigest,
  );
}

function consumeOwnedCredentialDescriptor(
  descriptor: number,
): M9b13k2CredentialChildOutcome {
  if (!descriptorIsAnonymousChannel(descriptor))
    return childOutcomeFromObservation({ kind: "owned-fd3-invalid" });
  const bytes = new Uint8Array(MAXIMUM_CREDENTIAL_READ_BYTES);
  let count = 0;
  let readFailed = false;
  try {
    count = readSync(descriptor, bytes, 0, bytes.byteLength, null);
  } catch {
    readFailed = true;
  } finally {
    try {
      closeSync(descriptor);
    } catch {
      // Ownership was proven; a concurrent close leaves the same safe result.
    }
  }
  const outcome = childOutcomeFromObservation({
    kind: "credential-read",
    bytes,
    count,
    readFailed,
  });
  bytes.fill(0);
  return outcome;
}

/** Reads and closes a synthetic FIFO/socket credential descriptor in conformance. */
export function consumeM9b13k2OwnedCredentialDescriptorForConformance(
  descriptor: number,
): M9b13k2CredentialChildOutcome {
  return consumeOwnedCredentialDescriptor(descriptor);
}

/**
 * Runs inside the controlled child. It returns before touching FD3 unless the
 * separately installed FD4 launch evidence matches the launcher's commitment.
 */
export function runM9b13k2OwnedFd3Child(): M9b13k2CredentialChildOutcome {
  const evidence = readLaunchEvidence();
  if (evidence.read === 0)
    return childOutcomeFromObservation({ kind: "launch-evidence-unavailable" });
  if (!evidence.valid)
    return childOutcomeFromObservation({ kind: "launch-evidence-invalid" });
  return consumeOwnedCredentialDescriptor(3);
}

export type M9b13k2CredentialLaunchFault =
  | "none"
  | "partial-write"
  | "extra-byte"
  | "missing-line-feed"
  | "close-before-write"
  | "proof-mismatch"
  | "never-write"
  | "kill-child";

export type M9b13k2CredentialLaunchResult = Readonly<{
  protocol: typeof M9B13K2_SYNTHETIC_PROTOCOL;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  childOutcome: M9b13k2CredentialChildOutcome | null;
  credentialPipeWrites: 0 | 1;
  credentialMaterialRetained: false;
}>;

function launchPayload(
  credential: Uint8Array,
  fault: M9b13k2CredentialLaunchFault,
): Uint8Array {
  if (fault === "partial-write") return credential.slice(0, 31);
  if (fault === "extra-byte") {
    const bytes = new Uint8Array(66);
    bytes.set(credential);
    bytes[64] = 0x0a;
    bytes[65] = 0x58;
    return bytes;
  }
  if (fault === "missing-line-feed") return credential.slice();
  const bytes = new Uint8Array(65);
  bytes.set(credential);
  bytes[64] = 0x0a;
  return bytes;
}

function controlledChildModuleUrl(): string {
  const sourceUrl = import.meta.url;
  return sourceUrl.endsWith(".ts") && sourceUrl.includes("/src/")
    ? sourceUrl.replace("/src/", "/dist/").replace(/\.ts$/u, ".js")
    : sourceUrl;
}

/**
 * Conformance-only launcher. The live controller has no call path to this
 * function, and the package root does not export this private module.
 */
export async function launchM9b13k2SyntheticCredentialChild(
  credential: Uint8Array,
  fault: M9b13k2CredentialLaunchFault,
  timeoutMs: number,
): Promise<M9b13k2CredentialLaunchResult> {
  if (!isSyntheticCredential(credential))
    throw new Error("Synthetic non-OSF credential prefix is required.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000)
    throw new Error(
      "Synthetic child timeout is outside the conformance bound.",
    );

  const proof = randomBytes(32);
  const committedProof =
    fault === "proof-mismatch" ? randomBytes(32) : Buffer.from(proof);
  const proofDigest = m9b13k2DomainDigest(
    M9B13K2_LAUNCH_PROTOCOL,
    committedProof,
  );
  committedProof.fill(0);
  const moduleUrl = controlledChildModuleUrl();
  const childSource = `
const runtime = await import(${JSON.stringify(moduleUrl)});
const outcome = runtime.runM9b13k2OwnedFd3Child();
process.stdout.write(JSON.stringify(outcome));`;
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", childSource],
    {
      env: {
        [LAUNCH_PROTOCOL_ENV]: M9B13K2_LAUNCH_PROTOCOL,
        [LAUNCH_PROOF_DIGEST_ENV]: proofDigest,
      },
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
    },
  );
  const credentialPipe = child.stdio[3];
  const proofPipe = child.stdio[4];
  if (!(credentialPipe instanceof Duplex) || !(proofPipe instanceof Duplex)) {
    child.kill("SIGKILL");
    proof.fill(0);
    throw new Error("Controlled child descriptors were not installed.");
  }
  if (child.stdout === null || child.stderr === null) {
    child.kill("SIGKILL");
    proof.fill(0);
    throw new Error("Controlled child output descriptors were not installed.");
  }

  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    if (stdout.length < 8_192) stdout += chunk.toString("utf8");
  });
  child.stderr.resume();
  proofPipe.end(proof, () => {
    proof.fill(0);
  });

  let credentialPipeWrites: 0 | 1 = 0;
  if (fault === "close-before-write") credentialPipe.end();
  else if (fault !== "never-write") {
    const payload = launchPayload(credential, fault);
    credentialPipeWrites = 1;
    credentialPipe.end(payload, () => {
      payload.fill(0);
    });
  }

  if (fault === "kill-child")
    setTimeout(() => {
      child.kill("SIGKILL");
    }, 5).unref();

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    credentialPipe.destroy();
    proofPipe.destroy();
    child.kill("SIGKILL");
  }, timeoutMs);
  timeout.unref();
  const { exitCode, signal } = await new Promise<
    Readonly<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>
  >((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, childSignal) => {
      resolve({ exitCode: code, signal: childSignal });
    });
  });
  clearTimeout(timeout);
  credential.fill(0);

  const childJson = parseJson(stdout);
  const parsed = m9b13k2CredentialChildOutcomeSchema.safeParse(
    childJson.ok ? childJson.value : undefined,
  );
  return {
    protocol: M9B13K2_SYNTHETIC_PROTOCOL,
    exitCode,
    signal,
    timedOut,
    childOutcome: parsed.success ? parsed.data : null,
    credentialPipeWrites,
    credentialMaterialRetained: false,
  };
}

export function syntheticM9b13k2CredentialBytes(): Uint8Array {
  const text = `${SYNTHETIC_PREFIX}${"A".repeat(64 - SYNTHETIC_PREFIX.length)}`;
  return new TextEncoder().encode(text);
}
