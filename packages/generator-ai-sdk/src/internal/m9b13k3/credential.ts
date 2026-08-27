import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, fstatSync, readSync } from "node:fs";
import { Duplex } from "node:stream";

import { parseJson } from "@nicia-ai/lachesis";
import { z } from "zod";

import { M9B13K3_FD3_PROTOCOL, m9b13k3DomainDigest } from "./protocol.js";

const FRAME_PROTOCOL_ENV = "LACHESIS_M9B13K3_FRAME_PROTOCOL";
const FRAME_DIGEST_ENV = "LACHESIS_M9B13K3_FRAME_DIGEST";
const SYNTHETIC_PREFIX = "M9B13K3SYNTHETICNONOSF";

export const m9b13k3CredentialChildOutcomeSchema = z
  .strictObject({
    protocol: z.literal(M9B13K3_FD3_PROTOCOL),
    terminalState: z.enum([
      "synthetic-frame-accepted",
      "credential-malformed",
      "credential-read-failed",
      "frame-invalid",
      "frame-unavailable",
      "fd3-not-anonymous-channel",
    ]),
    frameConsistencyProven: z.boolean(),
    launcherIdentityAuthenticated: z.literal(false),
    fd3Reads: z.union([z.literal(0), z.literal(1)]),
    fd3Closes: z.union([z.literal(0), z.literal(1)]),
    credentialBytesObserved: z.number().int().min(0).max(66),
    mutableBuffersZeroized: z.literal(true),
    credentialExposed: z.literal(false),
  })
  .readonly();
export type M9b13k3CredentialChildOutcome = z.infer<
  typeof m9b13k3CredentialChildOutcomeSchema
>;

export type M9b13k3CredentialFrameFault =
  | "none"
  | "partial-write"
  | "extra-byte"
  | "missing-line-feed"
  | "proof-mismatch"
  | "never-write"
  | "kill-child";

export type M9b13k3CredentialFrameResult = Readonly<{
  protocol: typeof M9B13K3_FD3_PROTOCOL;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  childOutcome: M9b13k3CredentialChildOutcome | null;
  credentialPipeWrites: 0 | 1;
  launcherIdentityAuthenticated: false;
  credentialMaterialRetained: false;
}>;

function outcome(
  terminalState: M9b13k3CredentialChildOutcome["terminalState"],
  frameConsistencyProven: boolean,
  fd3Reads: 0 | 1,
  fd3Closes: 0 | 1,
  credentialBytesObserved: number,
): M9b13k3CredentialChildOutcome {
  return m9b13k3CredentialChildOutcomeSchema.parse({
    protocol: M9B13K3_FD3_PROTOCOL,
    terminalState,
    frameConsistencyProven,
    launcherIdentityAuthenticated: false,
    fd3Reads,
    fd3Closes,
    credentialBytesObserved,
    mutableBuffersZeroized: true,
    credentialExposed: false,
  });
}

function anonymousChannel(descriptor: number): boolean {
  try {
    const metadata = fstatSync(descriptor);
    return metadata.isFIFO() || metadata.isSocket();
  } catch {
    return false;
  }
}

function validCredentialFrame(bytes: Uint8Array, count: number): boolean {
  if (count !== 65 || bytes[64] !== 0x0a) return false;
  for (let index = 0; index < 64; index += 1) {
    const byte = bytes[index];
    if (
      byte === undefined ||
      !(
        (byte >= 0x30 && byte <= 0x39) ||
        (byte >= 0x41 && byte <= 0x5a) ||
        (byte >= 0x61 && byte <= 0x7a)
      )
    )
      return false;
  }
  return true;
}

function readFrameProof(): Readonly<{ valid: boolean; read: 0 | 1 }> {
  const protocol = process.env[FRAME_PROTOCOL_ENV];
  const expectedDigest = process.env[FRAME_DIGEST_ENV];
  if (
    protocol !== M9B13K3_FD3_PROTOCOL ||
    expectedDigest === undefined ||
    !/^[a-f0-9]{64}$/u.test(expectedDigest)
  )
    return { valid: false, read: 0 };
  if (!anonymousChannel(4)) return { valid: false, read: 0 };
  const proof = new Uint8Array(33);
  try {
    const count = readSync(4, proof, 0, proof.byteLength, null);
    return {
      valid:
        count === 32 &&
        m9b13k3DomainDigest(M9B13K3_FD3_PROTOCOL, proof.subarray(0, count)) ===
          expectedDigest,
      read: 1,
    };
  } catch {
    return { valid: false, read: 1 };
  } finally {
    proof.fill(0);
    try {
      closeSync(4);
    } catch {
      // The synthetic proof channel may already be closed.
    }
  }
}

export function runM9b13k3SyntheticFd3FrameChild(): M9b13k3CredentialChildOutcome {
  const proof = readFrameProof();
  if (proof.read === 0) return outcome("frame-unavailable", false, 0, 0, 0);
  if (!proof.valid) return outcome("frame-invalid", false, 0, 0, 0);
  if (!anonymousChannel(3))
    return outcome("fd3-not-anonymous-channel", true, 0, 0, 0);
  const credential = new Uint8Array(66);
  try {
    const count = readSync(3, credential, 0, credential.byteLength, null);
    return outcome(
      validCredentialFrame(credential, count)
        ? "synthetic-frame-accepted"
        : "credential-malformed",
      true,
      1,
      1,
      count,
    );
  } catch {
    return outcome("credential-read-failed", true, 1, 1, 0);
  } finally {
    credential.fill(0);
    try {
      closeSync(3);
    } catch {
      // FD3 was proven to be the synthetic anonymous channel before closure.
    }
  }
}

export function syntheticM9b13k3CredentialBytes(): Uint8Array {
  const bytes = new TextEncoder().encode(
    `${SYNTHETIC_PREFIX}${"A".repeat(64)}`,
  );
  return bytes.slice(0, 64);
}

function payload(
  credential: Uint8Array,
  fault: M9b13k3CredentialFrameFault,
): Uint8Array {
  if (fault === "partial-write") return credential.slice(0, 31);
  if (fault === "missing-line-feed") return credential.slice();
  const framed = new Uint8Array(fault === "extra-byte" ? 66 : 65);
  framed.set(credential);
  framed[64] = 0x0a;
  if (fault === "extra-byte") framed[65] = 0x58;
  return framed;
}

function childModuleUrl(): string {
  return import.meta.url.endsWith(".ts") && import.meta.url.includes("/src/")
    ? import.meta.url.replace("/src/", "/dist/").replace(/\.ts$/u, ".js")
    : import.meta.url;
}

export async function launchM9b13k3SyntheticFd3FrameChild(
  credential: Uint8Array,
  fault: M9b13k3CredentialFrameFault,
  timeoutMs: number,
): Promise<M9b13k3CredentialFrameResult> {
  if (
    credential.byteLength !== 64 ||
    !new TextDecoder().decode(credential).startsWith(SYNTHETIC_PREFIX)
  )
    throw new Error("Synthetic non-OSF credential required.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000)
    throw new Error("Synthetic frame timeout outside bound.");
  const proof = randomBytes(32);
  const committedProof =
    fault === "proof-mismatch" ? randomBytes(32) : Buffer.from(proof);
  const proofDigest = m9b13k3DomainDigest(M9B13K3_FD3_PROTOCOL, committedProof);
  committedProof.fill(0);
  const source = `
const runtime = await import(${JSON.stringify(childModuleUrl())});
process.stdout.write(JSON.stringify(runtime.runM9b13k3SyntheticFd3FrameChild()));`;
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", source],
    {
      env: {
        [FRAME_PROTOCOL_ENV]: M9B13K3_FD3_PROTOCOL,
        [FRAME_DIGEST_ENV]: proofDigest,
      },
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
    },
  );
  const credentialPipe = child.stdio[3];
  const proofPipe = child.stdio[4];
  if (
    !(credentialPipe instanceof Duplex) ||
    !(proofPipe instanceof Duplex) ||
    child.stdout === null ||
    child.stderr === null
  ) {
    proof.fill(0);
    child.kill("SIGKILL");
    throw new Error("Synthetic child channels unavailable.");
  }
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    if (stdout.length < 8_192) stdout += chunk.toString("utf8");
  });
  child.stderr.resume();
  proofPipe.end(proof, () => proof.fill(0));
  let credentialPipeWrites: 0 | 1 = 0;
  if (fault !== "never-write") {
    const framed = payload(credential, fault);
    credentialPipeWrites = 1;
    credentialPipe.end(framed, () => framed.fill(0));
  }
  if (fault === "kill-child")
    setTimeout(() => child.kill("SIGKILL"), 5).unref();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    credentialPipe.destroy();
    proofPipe.destroy();
    child.kill("SIGKILL");
  }, timeoutMs);
  timeout.unref();
  const termination = await new Promise<
    Readonly<{ exitCode: number | null; signal: NodeJS.Signals | null }>
  >((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => { resolve({ exitCode, signal }); });
  });
  clearTimeout(timeout);
  credential.fill(0);
  const parsedJson = parseJson(stdout);
  const childOutcome = m9b13k3CredentialChildOutcomeSchema.safeParse(
    parsedJson.ok ? parsedJson.value : undefined,
  );
  return {
    protocol: M9B13K3_FD3_PROTOCOL,
    ...termination,
    timedOut,
    childOutcome: childOutcome.success ? childOutcome.data : null,
    credentialPipeWrites,
    launcherIdentityAuthenticated: false,
    credentialMaterialRetained: false,
  };
}

export function inspectM9b13k3Fd3Claim(): Readonly<{
  proves: "synthetic-frame-consistency-only";
  provesLauncherIdentity: false;
  authenticatedOwnershipRequiresFutureActivation: true;
}> {
  return {
    proves: "synthetic-frame-consistency-only",
    provesLauncherIdentity: false,
    authenticatedOwnershipRequiresFutureActivation: true,
  };
}
