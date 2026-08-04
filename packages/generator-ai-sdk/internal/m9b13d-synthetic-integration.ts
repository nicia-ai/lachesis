import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

import { z } from "zod";

import {
  compareM9b13dSpdxInventory,
  M9B13D_QUARANTINE,
  scanM9b13dOciLayout,
} from "./m9b13d-oci-inventory-scanner.js";

export const M9B13D_INTEGRATION_PROTOCOL =
  "lachesis-m9b13d-synthetic-oci-integration/1" as const;
export const M9B13D_HELPER_PROTOCOL =
  "lachesis-m9b13d-race-resistant-filesystem-helper/1" as const;
export const M9B13D_HELPER_EXECUTABLE_SHA256 =
  "60a81ccf7658b1a7a91d9dbee7d1ca63840a4751597319139d65f0a0a1536fd7" as const;

const artifactSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine(
        (path) =>
          !path.startsWith("/") &&
          path
            .split("/")
            .every(
              (component) =>
                component !== "" && component !== "." && component !== "..",
            ),
      ),
    bytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
    expectedSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict()
  .readonly();

const integrationInputSchema = z
  .object({
    helperPath: z.string().min(1),
    parent: z.string().startsWith("/"),
    destination: z.string().min(1).max(4096),
    artifacts: artifactSchema.array().max(1024),
    attachedSpdx: z.unknown(),
  })
  .strict()
  .readonly();

export type M9b13dSyntheticArtifact = z.infer<typeof artifactSchema>;

type IntegrationFailure = Readonly<{
  kind: "m9b13d-integration-failure";
  disposition: typeof M9B13D_QUARANTINE;
  reason: string;
}>;

type IntegrationResult =
  | Readonly<{
      ok: true;
      value: Readonly<{
        protocol: typeof M9B13D_INTEGRATION_PROTOCOL;
        status: "accepted-synthetic-evidence";
        helperSha256: typeof M9B13D_HELPER_EXECUTABLE_SHA256;
        files: number;
        bytes: number;
        inventorySha256: string;
        spdxSha256: string;
      }>;
    }>
  | Readonly<{ ok: false; error: IntegrationFailure }>;

function rejected(reason: string): IntegrationResult {
  return {
    ok: false,
    error: {
      kind: "m9b13d-integration-failure",
      disposition: M9B13D_QUARANTINE,
      reason,
    },
  };
}

async function writeChunk(stream: Writable, chunk: Uint8Array): Promise<void> {
  if (stream.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function collect(stream: Readable): Promise<string> {
  const chunks: Array<Uint8Array> = [];
  const iterator: AsyncIterator<unknown> = stream[Symbol.asyncIterator]();
  for (;;) {
    const next = await iterator.next();
    if (next.done) break;
    if (!(next.value instanceof Uint8Array))
      throw new TypeError("Node subprocess stream yielded a non-byte chunk.");
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
): Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

function fileFrame(artifact: M9b13dSyntheticArtifact): Uint8Array {
  const encodedPath = Buffer.from(artifact.path, "utf8").toString("hex");
  return new TextEncoder().encode(
    `FILE ${encodedPath} ${artifact.bytes.byteLength} ${artifact.expectedSha256}\n`,
  );
}

export async function runM9b13dSyntheticIntegration(
  input: unknown,
): Promise<IntegrationResult> {
  const parsed = integrationInputSchema.safeParse(input);
  if (!parsed.success) return rejected("m9b13d:invalid-integration-input");
  let helperBytes: Uint8Array;
  try {
    helperBytes = await readFile(parsed.data.helperPath);
  } catch {
    return rejected("m9b13d:helper-unreadable");
  }
  if (
    createHash("sha256").update(helperBytes).digest("hex") !==
    M9B13D_HELPER_EXECUTABLE_SHA256
  )
    return rejected("m9b13d:helper-identity-mismatch");
  const paths = new Set<string>();
  let accountedBytes = 0;
  for (const artifact of parsed.data.artifacts) {
    if (paths.has(artifact.path))
      return rejected("m9b13d:duplicate-integration-path");
    paths.add(artifact.path);
    if (
      createHash("sha256").update(artifact.bytes).digest("hex") !==
      artifact.expectedSha256
    )
      return rejected("m9b13d:pre-persistence-digest-mismatch");
    accountedBytes += artifact.bytes.byteLength;
    if (accountedBytes > 512_000_000)
      return rejected("m9b13d:pre-persistence-byte-overflow");
  }
  let canonicalParent: string;
  try {
    canonicalParent = await realpath(parsed.data.parent);
  } catch {
    return rejected("m9b13d:integration-parent-unavailable");
  }
  if (canonicalParent !== parsed.data.parent)
    return rejected("m9b13d:integration-parent-noncanonical");
  const child = spawn(
    parsed.data.helperPath,
    [
      "--mode",
      "synthetic",
      "--parent",
      canonicalParent,
      "--destination",
      parsed.data.destination,
    ],
    { cwd: canonicalParent, env: {}, stdio: "pipe" },
  );
  const stdout = collect(child.stdout);
  const stderr = collect(child.stderr);
  const exit = waitForExit(child);
  try {
    for (const artifact of parsed.data.artifacts) {
      await writeChunk(child.stdin, fileFrame(artifact));
      for (
        let offset = 0;
        offset < artifact.bytes.byteLength;
        offset += 65_536
      ) {
        const chunk = artifact.bytes.subarray(offset, offset + 65_536);
        await writeChunk(child.stdin, chunk);
      }
      await writeChunk(child.stdin, new TextEncoder().encode("\n"));
    }
    await writeChunk(child.stdin, new TextEncoder().encode("SEAL\n"));
    child.stdin.end();
    const [out, errorOutput, exited] = await Promise.all([
      stdout,
      stderr,
      exit,
    ]);
    if (exited.code !== 0 || exited.signal !== null)
      return rejected(
        errorOutput.startsWith("M9B13D_ERROR ")
          ? errorOutput.trim().slice("M9B13D_ERROR ".length)
          : "m9b13d:helper-process-failure",
      );
    if (!out.includes(`"protocol":"${M9B13D_HELPER_PROTOCOL}"`))
      return rejected("m9b13d:helper-receipt-mismatch");
  } catch {
    child.kill("SIGKILL");
    return rejected("m9b13d:helper-stream-failure");
  }
  const root = join(canonicalParent, parsed.data.destination);
  const inventory = await scanM9b13dOciLayout(root);
  if (!inventory.ok) return rejected(inventory.error.reason);
  const compared = compareM9b13dSpdxInventory(
    inventory.value,
    parsed.data.attachedSpdx,
  );
  if (!compared.ok) return rejected(compared.error.reason);
  return {
    ok: true,
    value: {
      protocol: M9B13D_INTEGRATION_PROTOCOL,
      status: "accepted-synthetic-evidence",
      helperSha256: M9B13D_HELPER_EXECUTABLE_SHA256,
      files: parsed.data.artifacts.length,
      bytes: accountedBytes,
      inventorySha256: compared.value.inventorySha256,
      spdxSha256: compared.value.spdxSha256,
    },
  };
}
