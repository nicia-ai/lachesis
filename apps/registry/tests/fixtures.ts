import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";

import { encodeCanonical } from "../src/core.js";
import { type CliIo, runCli } from "../src/main.js";
import { WITNESSES_PROTOCOL } from "../src/schema.js";

export const execFileAsync = promisify(execFile);

export type TestAuthority = Readonly<{
  name: string;
  url: string;
  caPath: string;
  close: () => Promise<void>;
}>;

/** Requests to this path on a test authority answer HTTP 503. */
export const UNAVAILABLE_PATH = "/unavailable";

export type CliRun = Readonly<{ code: number; stdout: string; stderr: string }>;

const TSA_CONFIG = (directory: string): string => `
[ tsa ]
default_tsa = tsa_config
[ tsa_config ]
serial = ${join(directory, "serial")}
signer_digest = sha256
default_policy = 1.2.3.4.1
digests = sha256
accuracy = secs:1
ordering = no
tsa_name = no
ess_cert_id_chain = no
ess_cert_id_alg = sha256
[ tsa_ext ]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,timeStamping
`;

async function openssl(
  cwd: string,
  args: ReadonlyArray<string>,
): Promise<void> {
  await execFileAsync("openssl", [...args], { cwd });
}

/** A local RFC 3161 authority with its own CA, answering over HTTP. */
export async function startAuthority(
  root: string,
  name: string,
): Promise<TestAuthority> {
  const directory = join(root, `tsa-${name}`);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "tsa.cnf"), TSA_CONFIG(directory));
  await writeFile(join(directory, "serial"), "01\n");
  await openssl(directory, [
    "req",
    "-x509",
    "-newkey",
    "ed25519",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-subj",
    `/CN=${name} root`,
    "-days",
    "30",
  ]);
  await openssl(directory, [
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "tsa.key",
    "-out",
    "tsa.csr",
    "-subj",
    `/CN=${name} tsa`,
  ]);
  await openssl(directory, [
    "x509",
    "-req",
    "-in",
    "tsa.csr",
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca.key",
    "-out",
    "tsa.pem",
    "-days",
    "30",
    "-extfile",
    "tsa.cnf",
    "-extensions",
    "tsa_ext",
  ]);
  let requests = 0;
  const server: Server = createServer((request, response) => {
    const chunks: Array<Buffer> = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (request.url === UNAVAILABLE_PATH) {
        response.writeHead(503, { "content-type": "text/plain" });
        response.end("unavailable");
        return;
      }
      requests += 1;
      const queryPath = join(directory, `query-${requests}.tsq`);
      const replyPath = join(directory, `reply-${requests}.tsr`);
      void writeFile(queryPath, Buffer.concat(chunks))
        .then(() =>
          openssl(directory, [
            "ts",
            "-reply",
            "-queryfile",
            queryPath,
            "-inkey",
            "tsa.key",
            "-signer",
            "tsa.pem",
            "-config",
            "tsa.cnf",
            "-out",
            replyPath,
          ]),
        )
        .then(() => readFile(replyPath))
        .then((reply) => {
          response.writeHead(200, {
            "content-type": "application/timestamp-reply",
          });
          response.end(reply);
        })
        .catch(() => {
          response.writeHead(500);
          response.end();
        });
    });
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Test TSA did not bind a TCP port.");
  const { port }: AddressInfo = address;
  return {
    name,
    url: `http://127.0.0.1:${port}/`,
    caPath: join(directory, "ca.pem"),
    close: () =>
      new Promise((resolveClose) => {
        server.close(() => {
          resolveClose();
        });
      }),
  };
}

export async function createSshKey(
  root: string,
  name: string,
): Promise<string> {
  const path = join(root, name);
  await execFileAsync("ssh-keygen", [
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-C",
    name,
    "-f",
    path,
  ]);
  return path;
}

export async function gitIn(
  cwd: string,
  ...args: ReadonlyArray<string>
): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd });
  return stdout.trim();
}

export async function cli(
  cwd: string,
  ...argv: ReadonlyArray<string>
): Promise<CliRun> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    cwd,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  };
  const code = await runCli(argv, io);
  return { code, stdout, stderr };
}

/** A repository with pinned TSA bundles and one bare witness remote. */
export async function createRepository(
  root: string,
  name: string,
  authorities: ReadonlyArray<TestAuthority>,
): Promise<Readonly<{ path: string; witness: string }>> {
  const path = join(root, name);
  const witness = join(root, `${name}-witness.git`);
  await mkdir(join(path, "registry", "tsa"), { recursive: true });
  await gitIn(
    root,
    "init",
    "--quiet",
    "--bare",
    "--initial-branch=main",
    witness,
  );
  await gitIn(path, "init", "--quiet", "--initial-branch=main");
  await gitIn(path, "config", "user.email", "test@example.com");
  await gitIn(path, "config", "user.name", "Test");
  for (const authority of authorities)
    await writeFile(
      join(path, "registry", "tsa", `${authority.name}.pem`),
      await readFile(authority.caPath),
    );
  const witnesses = encodeCanonical({
    protocol: WITNESSES_PROTOCOL,
    witnesses: [{ name: "bare", url: witness, branch: "main" }],
  });
  if (!witnesses.ok) throw new Error(witnesses.error.message);
  await writeFile(join(path, "registry", "witnesses.json"), witnesses.value);
  await gitIn(path, "add", ".");
  await gitIn(path, "commit", "--quiet", "--message", "setup");
  await gitIn(path, "push", "--quiet", witness, "HEAD:refs/heads/main");
  return { path, witness };
}
