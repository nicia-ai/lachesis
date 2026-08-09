import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type M9b13k2TlsFixture = Readonly<{
  port: number;
  certificatePem: string;
  close: () => Promise<void>;
}>;

async function generateCertificate(
  root: string,
): Promise<Readonly<{ key: string; certificate: string }>> {
  const keyPath = join(root, "fixture-key.pem");
  const certificatePath = join(root, "fixture-certificate.pem");
  await new Promise<void>((resolve, reject) => {
    execFile(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-sha256",
        "-days",
        "1",
        "-subj",
        "/CN=api.osf.io",
        "-addext",
        "subjectAltName=DNS:api.osf.io,DNS:files.osf.io,DNS:files.us.osf.io,DNS:files.eu.osf.io,DNS:files.au.osf.io,DNS:files.ca.osf.io",
        "-keyout",
        keyPath,
        "-out",
        certificatePath,
      ],
      { maxBuffer: 64 * 1024 },
      (error) => {
        if (error === null) resolve();
        else
          reject(
            error instanceof Error
              ? error
              : new Error("OpenSSL certificate generation failed."),
          );
      },
    );
  });
  await chmod(keyPath, 0o600);
  await chmod(certificatePath, 0o600);
  return {
    key: await readFile(keyPath, "utf8"),
    certificate: await readFile(certificatePath, "utf8"),
  };
}

export async function createM9b13k2TlsFixture(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<M9b13k2TlsFixture> {
  const root = await mkdtemp(join(tmpdir(), "lachesis-m9b13k2-tls-"));
  const material = await generateCertificate(root);
  const server = createServer(
    { key: material.key, cert: material.certificate },
    handler,
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Loopback TLS fixture did not expose a TCP port.");
  return {
    port: address.port,
    certificatePem: material.certificate,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
        server.closeAllConnections();
      });
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function waitM9b13k2(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
