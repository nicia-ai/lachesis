import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Result } from "@nicia-ai/lachesis";

import { type RegistryError, registryError } from "./errors.js";
import {
  decodeText,
  runChecked,
  runProcess,
  withTemporaryDirectory,
} from "./process.js";
import { publicKeySchema, SIGNATURE_NAMESPACE } from "./schema.js";

export type Signer = Readonly<{ principal: string; publicKey: string }>;

/** Derives the comment-free public key line for an SSH private key file. */
export async function publicKeyOf(
  privateKeyPath: string,
  cwd: string,
): Promise<Result<string, RegistryError>> {
  const output = await runChecked("ssh-keygen", ["-y", "-f", privateKeyPath], {
    cwd,
    interactive: true,
  });
  if (!output.ok) return output;
  return normalizePublicKey(decodeText(output.value));
}

export function normalizePublicKey(
  text: string,
): Result<string, RegistryError> {
  const [type, blob] = text.trim().split(/\s+/);
  const parsed = publicKeySchema.safeParse(`${type ?? ""} ${blob ?? ""}`);
  if (!parsed.success)
    return {
      ok: false,
      error: registryError("USAGE", "Not a supported SSH public key."),
    };
  return { ok: true, value: parsed.data };
}

/** Writes `<path>.sig`; ssh-keygen may prompt for the key passphrase. */
export async function signFile(
  path: string,
  privateKeyPath: string,
  cwd: string,
): Promise<Result<void, RegistryError>> {
  const signed = await runChecked(
    "ssh-keygen",
    ["-q", "-Y", "sign", "-f", privateKeyPath, "-n", SIGNATURE_NAMESPACE, path],
    { cwd, interactive: true },
  );
  return signed.ok ? { ok: true, value: undefined } : signed;
}

export function verifySignature(
  message: Uint8Array,
  signature: Uint8Array,
  signer: Signer,
): Promise<Result<void, RegistryError>> {
  return withTemporaryDirectory(async (directory) => {
    const allowedSigners = join(directory, "allowed_signers");
    const signaturePath = join(directory, "entry.sig");
    await writeFile(
      allowedSigners,
      `${signer.principal} namespaces="${SIGNATURE_NAMESPACE}" ${signer.publicKey}\n`,
    );
    await writeFile(signaturePath, signature);
    const output = await runProcess(
      "ssh-keygen",
      [
        "-Y",
        "verify",
        "-f",
        allowedSigners,
        "-I",
        signer.principal,
        "-n",
        SIGNATURE_NAMESPACE,
        "-s",
        signaturePath,
      ],
      { cwd: directory, input: message },
    );
    if (!output.ok) return output;
    return output.value.status === 0
      ? { ok: true, value: undefined }
      : {
          ok: false,
          error: registryError(
            "SIGNATURE_INVALID",
            "Signature does not verify against the genesis signer.",
          ),
        };
  });
}
