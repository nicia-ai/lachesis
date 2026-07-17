import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type Diagnostic, diagnostic, type Result } from "@nicia-ai/lachesis";
import {
  type M3bRawOutputArtifact,
  m3bRawOutputArtifactSchema,
  type M3bRawOutputReader,
  type M3bRawOutputWriter,
} from "@nicia-ai/lachesis-evidence";
import { z } from "zod";

const MAXIMUM_RAW_OUTPUT_BYTES = 65_536;
const fileErrorSchema = z.looseObject({ code: z.string() });

function failure(action: string, error: unknown): Diagnostic {
  return diagnostic(
    "INVALID_WIRE_SCHEMA",
    `Unable to ${action} bounded M3b raw-output artifact: ${error instanceof Error ? error.message : String(error)}.`,
  );
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function boundedText(text: string): Readonly<{
  text: string;
  bytes: Uint8Array;
  originalSizeBytes: number;
  truncated: boolean;
}> {
  const encoder = new TextEncoder();
  const original = encoder.encode(text);
  if (original.byteLength <= MAXIMUM_RAW_OUTPUT_BYTES)
    return {
      text,
      bytes: original,
      originalSizeBytes: original.byteLength,
      truncated: false,
    };
  const decoded = new TextDecoder().decode(
    original.subarray(0, MAXIMUM_RAW_OUTPUT_BYTES),
  );
  let bounded = decoded;
  let bytes = encoder.encode(bounded);
  while (bytes.byteLength > MAXIMUM_RAW_OUTPUT_BYTES) {
    bounded = bounded.slice(0, -1);
    bytes = encoder.encode(bounded);
  }
  return {
    text: bounded,
    bytes,
    originalSizeBytes: original.byteLength,
    truncated: true,
  };
}

function artifactPath(root: string, digest: string): string {
  return join(root, `${digest}.txt`);
}

export type M3bRawOutputArtifactStore = Readonly<{
  write: M3bRawOutputWriter;
  read: M3bRawOutputReader;
}>;

export function createM3bRawOutputArtifactStore(
  root: string,
): M3bRawOutputArtifactStore {
  return {
    async write(input) {
      const bounded = boundedText(input.text);
      const digest = await sha256(bounded.bytes);
      const artifact = m3bRawOutputArtifactSchema.parse({
        digest,
        storedSizeBytes: bounded.bytes.byteLength,
        originalSizeBytes: bounded.originalSizeBytes,
        truncated: bounded.truncated,
      });
      const path = artifactPath(root, digest);
      try {
        await mkdir(root, { recursive: true, mode: 0o700 });
        await writeFile(path, bounded.text, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      } catch (error: unknown) {
        const parsed = fileErrorSchema.safeParse(error);
        if (!parsed.success || parsed.data.code !== "EEXIST")
          return { ok: false, error: failure("write", error) };
        try {
          const existing = await readFile(path, "utf8");
          if (existing !== bounded.text)
            return {
              ok: false,
              error: diagnostic(
                "REPLAY_OUTPUT_MISMATCH",
                "An existing M3b raw-output artifact differs from its content address.",
              ),
            };
        } catch (readError: unknown) {
          return { ok: false, error: failure("verify", readError) };
        }
      }
      return { ok: true, value: artifact };
    },
    async read(
      artifact: M3bRawOutputArtifact,
    ): Promise<Result<string, Diagnostic>> {
      try {
        const text = await readFile(
          artifactPath(root, artifact.digest),
          "utf8",
        );
        const bytes = new TextEncoder().encode(text);
        const digest = await sha256(bytes);
        if (
          digest !== artifact.digest ||
          bytes.byteLength !== artifact.storedSizeBytes
        )
          return {
            ok: false,
            error: diagnostic(
              "REPLAY_OUTPUT_MISMATCH",
              "M3b raw-output artifact failed content-address verification.",
            ),
          };
        return { ok: true, value: text };
      } catch (error: unknown) {
        return { ok: false, error: failure("read", error) };
      }
    },
  };
}
