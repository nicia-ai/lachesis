import { execFileSync, spawn } from "node:child_process";
import { constants, openSync, writeSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex } from "node:stream";

import { parseJson } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  consumeM9b13k2OwnedCredentialDescriptorForConformance,
  inspectM9b13k2CredentialFramesForConformance,
  inspectM9b13k2LaunchEvidenceDescriptorForConformance,
  inspectM9b13k2LaunchEvidenceForConformance,
  inspectM9b13k2OwnedChildObservationForConformance,
  launchM9b13k2SyntheticCredentialChild,
  m9b13k2CredentialChildOutcomeSchema,
  runM9b13k2OwnedFd3Child,
  syntheticM9b13k2CredentialBytes,
} from "../src/internal/m9b13k2/credential.js";
import {
  M9B13K2_LAUNCH_PROTOCOL,
  m9b13k2DomainDigest,
} from "../src/internal/m9b13k2/protocol.js";

async function syntheticFifoWithBytes(
  bytes: Uint8Array,
): Promise<Readonly<{ descriptor: number; root: string }>> {
  const root = await mkdtemp(join(tmpdir(), "lachesis-m9b13k2-fifo-"));
  const path = join(root, "channel");
  execFileSync("/usr/bin/mkfifo", [path]);
  const descriptor = openSync(
    path,
    constants.O_RDWR | constants.O_NONBLOCK,
    0o600,
  );
  writeSync(descriptor, bytes);
  return { descriptor, root };
}

async function directChildWithUnprovenFd3(): Promise<
  Readonly<{
    code: number | null;
    stdout: string;
  }>
> {
  const moduleUrl = new URL(
    "../dist/internal/m9b13k2/credential.js",
    import.meta.url,
  ).href;
  const source = `
import { readSync } from "node:fs";
const runtime = await import(${JSON.stringify(moduleUrl)});
const outcome = runtime.runM9b13k2OwnedFd3Child();
const untouched = Buffer.alloc(4);
const count = readSync(3, untouched, 0, 4, null);
process.stdout.write(JSON.stringify({ outcome, count, untouched: untouched.toString("ascii") }));`;
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", source],
    {
      env: {},
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    },
  );
  const fd3 = child.stdio[3];
  if (
    !(fd3 instanceof Duplex) ||
    child.stdout === null ||
    child.stderr === null
  )
    throw new Error("Isolated child pipes unavailable.");
  fd3.end("seal");
  child.stderr.resume();
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, stdout };
}

describe("M9b.13k.2 controlled launcher and owned FD3", () => {
  it("stops direct invocation before touching an unrelated FD3", () => {
    const outcome = runM9b13k2OwnedFd3Child();
    expect(outcome).toEqual({
      protocol: "lachesis-m9b13k2-controlled-owned-fd3-launch/1",
      terminalState: "launch-evidence-unavailable",
      launchEvidenceReads: 0,
      fd3Reads: 0,
      fd3Closes: 0,
      credentialBytesObserved: 0,
      mutableBuffersZeroized: true,
      credentialExposed: false,
    });
  });

  it("leaves a Node-managed or caller-owned FD3 open and unread", async () => {
    const child = await directChildWithUnprovenFd3();
    expect(child.code).toBe(0);
    const json = parseJson(child.stdout);
    expect(json.ok).toBe(true);
    if (!json.ok) throw new Error("Direct child output was not JSON.");
    expect(
      z
        .strictObject({
          outcome: m9b13k2CredentialChildOutcomeSchema,
          count: z.literal(4),
          untouched: z.literal("seal"),
        })
        .safeParse(json.value).success,
    ).toBe(true);
  });

  it("installs and consumes one exact synthetic credential on owned FD3", async () => {
    const credential = syntheticM9b13k2CredentialBytes();
    const result = await launchM9b13k2SyntheticCredentialChild(
      credential,
      "none",
      1_000,
    );
    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      timedOut: false,
      credentialPipeWrites: 1,
      credentialMaterialRetained: false,
      childOutcome: {
        terminalState: "credential-accepted-owned",
        launchEvidenceReads: 1,
        fd3Reads: 1,
        fd3Closes: 1,
        credentialBytesObserved: 65,
        mutableBuffersZeroized: true,
        credentialExposed: false,
      },
    });
    expect(Array.from(credential).every((byte) => byte === 0)).toBe(true);
  });

  it.each([
    ["partial-write", "credential-malformed", 31],
    ["extra-byte", "credential-malformed", 66],
    ["missing-line-feed", "credential-malformed", 64],
    ["close-before-write", "credential-malformed", 0],
  ] as const)(
    "fails safely for %s",
    async (fault, terminalState, observedBytes) => {
      const result = await launchM9b13k2SyntheticCredentialChild(
        syntheticM9b13k2CredentialBytes(),
        fault,
        1_000,
      );
      expect(result.childOutcome).toMatchObject({
        terminalState,
        launchEvidenceReads: 1,
        fd3Reads: 1,
        fd3Closes: 1,
        credentialBytesObserved: observedBytes,
        mutableBuffersZeroized: true,
        credentialExposed: false,
      });
    },
  );

  it("rejects mismatched launch proof without reading or closing FD3", async () => {
    const result = await launchM9b13k2SyntheticCredentialChild(
      syntheticM9b13k2CredentialBytes(),
      "proof-mismatch",
      1_000,
    );
    expect(result.childOutcome).toMatchObject({
      terminalState: "launch-evidence-invalid",
      launchEvidenceReads: 1,
      fd3Reads: 0,
      fd3Closes: 0,
      credentialBytesObserved: 0,
    });
  });

  it("kills a non-reading child at the launcher-owned timeout", async () => {
    const result = await launchM9b13k2SyntheticCredentialChild(
      syntheticM9b13k2CredentialBytes(),
      "never-write",
      40,
    );
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe("SIGKILL");
    expect(result.childOutcome).toBeNull();
    expect(result.credentialPipeWrites).toBe(0);
  });

  it("contains child death without retaining credential material", async () => {
    const result = await launchM9b13k2SyntheticCredentialChild(
      syntheticM9b13k2CredentialBytes(),
      "kill-child",
      1_000,
    );
    expect(result.signal).toBe("SIGKILL");
    expect(result.credentialMaterialRetained).toBe(false);
  });

  it("rejects structurally shaped material outside the synthetic test domain", async () => {
    expect(launchM9b13k2SyntheticCredentialChild).toHaveLength(3);
    await expect(
      launchM9b13k2SyntheticCredentialChild(
        new TextEncoder().encode("Z".repeat(64)),
        "none",
        100,
      ),
    ).rejects.toThrow("Synthetic non-OSF credential prefix is required.");
  });

  it("classifies exact frames and launch evidence without descriptor effects", () => {
    const credential = syntheticM9b13k2CredentialBytes();
    const frame = new Uint8Array(65);
    frame.set(credential);
    frame[64] = 0x0a;
    expect(
      inspectM9b13k2CredentialFramesForConformance(credential, frame),
    ).toEqual({ syntheticCredential: true, credentialFrameValid: true });
    for (const replacement of [0x30, 0x41, 0x61]) {
      const variant = frame.slice();
      variant[63] = replacement;
      expect(
        inspectM9b13k2CredentialFramesForConformance(credential, variant)
          .credentialFrameValid,
      ).toBe(true);
    }
    const malformed = frame.slice();
    malformed[12] = 0x2d;
    expect(
      inspectM9b13k2CredentialFramesForConformance(credential, malformed)
        .credentialFrameValid,
    ).toBe(false);
    expect(
      inspectM9b13k2CredentialFramesForConformance(
        new Uint8Array(63),
        frame.subarray(0, 64),
      ),
    ).toEqual({ syntheticCredential: false, credentialFrameValid: false });

    const proof = new Uint8Array(32).fill(0x41);
    const digest = m9b13k2DomainDigest(M9B13K2_LAUNCH_PROTOCOL, proof);
    expect(inspectM9b13k2LaunchEvidenceForConformance(proof, digest)).toBe(
      true,
    );
    expect(
      inspectM9b13k2LaunchEvidenceForConformance(proof.subarray(0, 31), digest),
    ).toBe(false);
    expect(
      inspectM9b13k2LaunchEvidenceForConformance(proof, "0".repeat(64)),
    ).toBe(false);

    for (const [kind, terminalState] of [
      ["launch-evidence-unavailable", "launch-evidence-unavailable"],
      ["launch-evidence-invalid", "launch-evidence-invalid"],
      ["owned-fd3-invalid", "owned-fd3-invalid"],
    ] as const)
      expect(
        inspectM9b13k2OwnedChildObservationForConformance({ kind }),
      ).toMatchObject({ terminalState });
    expect(
      inspectM9b13k2OwnedChildObservationForConformance({
        kind: "credential-read",
        bytes: frame,
        count: frame.byteLength,
        readFailed: false,
      }),
    ).toMatchObject({ terminalState: "credential-accepted-owned" });
    expect(
      inspectM9b13k2OwnedChildObservationForConformance({
        kind: "credential-read",
        bytes: malformed,
        count: malformed.byteLength,
        readFailed: false,
      }),
    ).toMatchObject({ terminalState: "credential-malformed" });
    expect(
      inspectM9b13k2OwnedChildObservationForConformance({
        kind: "credential-read",
        bytes: new Uint8Array(66),
        count: 0,
        readFailed: true,
      }),
    ).toMatchObject({ terminalState: "credential-read-failed" });
  });

  it("reads exact proof and credential frames from owned synthetic FIFOs", async () => {
    const proof = new Uint8Array(32).fill(0x42);
    const proofDigest = m9b13k2DomainDigest(M9B13K2_LAUNCH_PROTOCOL, proof);
    const proofFifo = await syntheticFifoWithBytes(proof);
    try {
      expect(
        inspectM9b13k2LaunchEvidenceDescriptorForConformance(
          proofFifo.descriptor,
          proofDigest,
        ),
      ).toEqual({ valid: true, read: 1 });
    } finally {
      await rm(proofFifo.root, { recursive: true, force: true });
    }

    const credential = syntheticM9b13k2CredentialBytes();
    const frame = new Uint8Array(65);
    frame.set(credential);
    frame[64] = 0x0a;
    const credentialFifo = await syntheticFifoWithBytes(frame);
    try {
      expect(
        consumeM9b13k2OwnedCredentialDescriptorForConformance(
          credentialFifo.descriptor,
        ),
      ).toMatchObject({
        terminalState: "credential-accepted-owned",
        credentialBytesObserved: 65,
        fd3Reads: 1,
        fd3Closes: 1,
      });
    } finally {
      await rm(credentialFifo.root, { recursive: true, force: true });
    }

    expect(
      consumeM9b13k2OwnedCredentialDescriptorForConformance(-1),
    ).toMatchObject({
      terminalState: "owned-fd3-invalid",
      fd3Reads: 0,
      fd3Closes: 0,
    });
  });

  it("rejects unsafe launcher timeout bounds before spawning", async () => {
    for (const timeoutMs of [0, 5_001])
      await expect(
        launchM9b13k2SyntheticCredentialChild(
          syntheticM9b13k2CredentialBytes(),
          "none",
          timeoutMs,
        ),
      ).rejects.toThrow("outside the conformance bound");
  });
});
