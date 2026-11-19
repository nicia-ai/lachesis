import { createHash } from "node:crypto";

import { canonicalizeJson, parseJson, type Result } from "@nicia-ai/lachesis";
import type { z } from "zod";

import { type RegistryError, registryError } from "./errors.js";
import {
  type Manifest,
  MANIFEST_PROTOCOL,
  manifestSchema,
  type RegistryEntry,
} from "./schema.js";

const ENTRY_FILE_PATTERN = /^(\d{4})\.json$/;
const ENTRY_SEQUENCE_WIDTH = 4;

export type LoadedEntry = Readonly<{
  fileName: string;
  bytes: Uint8Array;
  entry: RegistryEntry;
}>;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

export function entryFileName(sequence: number): string {
  return `${String(sequence).padStart(ENTRY_SEQUENCE_WIDTH, "0")}.json`;
}

export function isEntryFileName(name: string): boolean {
  return ENTRY_FILE_PATTERN.test(name);
}

/** Canonical JSON plus a trailing newline: the only accepted on-disk form. */
export function encodeCanonical(
  value: unknown,
): Result<Uint8Array, RegistryError> {
  const canonical = canonicalizeJson(value);
  if (!canonical.ok)
    return {
      ok: false,
      error: registryError("MALFORMED_DOCUMENT", canonical.error.message),
    };
  return { ok: true, value: new TextEncoder().encode(`${canonical.value}\n`) };
}

export function decodeCanonical<T>(
  bytes: Uint8Array,
  schema: z.ZodType<T>,
  label: string,
): Result<T, RegistryError> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      ok: false,
      error: registryError("MALFORMED_DOCUMENT", `${label} is not UTF-8.`),
    };
  }
  const json = parseJson(text);
  if (!json.ok)
    return {
      ok: false,
      error: registryError("MALFORMED_DOCUMENT", `${label} is not JSON.`),
    };
  const parsed = schema.safeParse(json.value);
  if (!parsed.success)
    return {
      ok: false,
      error: registryError(
        "MALFORMED_DOCUMENT",
        `${label} is invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      ),
    };
  const canonical = encodeCanonical(parsed.data);
  if (!canonical.ok) return canonical;
  if (!bytesEqual(canonical.value, bytes))
    return {
      ok: false,
      error: registryError(
        "NON_CANONICAL",
        `${label} is not in canonical form.`,
      ),
    };
  return { ok: true, value: parsed.data };
}

export function createManifest(
  files: ReadonlyArray<Readonly<{ path: string; bytes: Uint8Array }>>,
): Result<Manifest, RegistryError> {
  const sorted = [...files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const duplicate = sorted.find(
    (file, index) => index > 0 && sorted[index - 1]?.path === file.path,
  );
  if (duplicate !== undefined)
    return {
      ok: false,
      error: registryError(
        "MALFORMED_DOCUMENT",
        `Manifest lists ${duplicate.path} twice.`,
      ),
    };
  const parsed = manifestSchema.safeParse({
    protocol: MANIFEST_PROTOCOL,
    files: sorted.map((file) => ({
      path: file.path,
      bytes: file.bytes.length,
      sha256: sha256Hex(file.bytes),
    })),
  });
  if (!parsed.success)
    return {
      ok: false,
      error: registryError(
        "MALFORMED_DOCUMENT",
        `Manifest is invalid: ${parsed.error.issues
          .map((issue) => issue.message)
          .join("; ")}`,
      ),
    };
  return { ok: true, value: parsed.data };
}

/** Every listed file must exist with exactly the recorded size and digest. */
export async function manifestErrors(
  manifest: Manifest,
  manifestPath: string,
  read: (path: string) => Promise<Uint8Array | undefined>,
): Promise<ReadonlyArray<RegistryError>> {
  const errors: Array<RegistryError> = [];
  const paths = manifest.files.map((file) => file.path);
  if (new Set(paths).size !== paths.length)
    errors.push(
      registryError("CONTENT_MISMATCH", "Manifest lists a path twice."),
    );
  if (paths.includes(manifestPath))
    errors.push(
      registryError("CONTENT_MISMATCH", "Manifest may not list itself."),
    );
  for (const file of manifest.files) {
    const bytes = await read(file.path);
    if (bytes === undefined)
      errors.push(
        registryError("CONTENT_MISMATCH", `${file.path} is missing.`),
      );
    else if (bytes.length !== file.bytes || sha256Hex(bytes) !== file.sha256)
      errors.push(
        registryError(
          "CONTENT_MISMATCH",
          `${file.path} does not match the manifest.`,
        ),
      );
  }
  return errors;
}

/** Structural hash-chain rules over an ordered list of entries. */
export function chainErrors(
  study: string,
  entries: ReadonlyArray<LoadedEntry>,
): ReadonlyArray<RegistryError> {
  const errors: Array<RegistryError> = [];
  entries.forEach(({ fileName, entry }, index) => {
    const label = `${study}/${fileName}`;
    if (fileName !== entryFileName(index) || entry.sequence !== index)
      errors.push(
        registryError(
          "CHAIN_BROKEN",
          `${label} is out of sequence (expected ${entryFileName(index)}).`,
        ),
      );
    if (entry.study !== study)
      errors.push(
        registryError("CHAIN_BROKEN", `${label} names study ${entry.study}.`),
      );
    if ((index === 0) !== (entry.kind === "genesis"))
      errors.push(
        registryError(
          "CHAIN_BROKEN",
          `${label}: the first entry, and only the first, must be genesis.`,
        ),
      );
    const previous = entries[index - 1];
    if (
      previous !== undefined &&
      entry.parentEntrySha256 !== sha256Hex(previous.bytes)
    )
      errors.push(
        registryError(
          "CHAIN_BROKEN",
          `${label} does not link to ${previous.fileName}.`,
        ),
      );
    if (entry.kind === "result") {
      const target = entries[entry.reportsOn];
      if (entry.reportsOn >= index || target?.entry.kind !== "registration")
        errors.push(
          registryError(
            "CHAIN_BROKEN",
            `${label} must report on an earlier registration entry.`,
          ),
        );
    }
  });
  return errors;
}

/** Witness logs must be identical; any missing or differing entry fails. */
export function witnessError(
  witnessName: string,
  local: ReadonlyArray<Uint8Array>,
  witness: ReadonlyArray<Uint8Array>,
): RegistryError | undefined {
  const shared = Math.min(local.length, witness.length);
  for (let index = 0; index < shared; index += 1) {
    const localBytes = local[index];
    const witnessBytes = witness[index];
    if (
      localBytes === undefined ||
      witnessBytes === undefined ||
      !bytesEqual(localBytes, witnessBytes)
    )
      return registryError(
        "WITNESS_DIVERGED",
        `Witness ${witnessName} differs at ${entryFileName(index)}.`,
      );
  }
  if (witness.length < local.length)
    return registryError(
      "WITNESS_DIVERGED",
      `Witness ${witnessName} is missing entries from ${entryFileName(witness.length)}.`,
    );
  if (witness.length > local.length)
    return registryError(
      "WITNESS_DIVERGED",
      `Witness ${witnessName} has entries from ${entryFileName(local.length)} that this checkout lacks.`,
    );
  return undefined;
}

/** OpenSSH-style fingerprint, comparable with `ssh-keygen -lf key.pub`. */
export function publicKeyFingerprint(publicKey: string): string {
  const blob = publicKey.split(" ")[1] ?? "";
  const digest = createHash("sha256")
    .update(Uint8Array.from(atob(blob), (character) => character.charCodeAt(0)))
    .digest("base64");
  return `SHA256:${digest.replace(/=+$/, "")}`;
}
