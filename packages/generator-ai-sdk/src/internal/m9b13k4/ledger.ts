import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";

import { type Result } from "@nicia-ai/lachesis";

import {
  canonicalM9b13k4Payload,
  M9B13K4_BUILD_PROTOCOL,
  M9B13K4_HELPER_TIMEOUT_MS,
  M9B13K4_INVOCATION_PROTOCOL,
  M9B13K4_MAXIMUM_OUTPUT_BYTES,
  type M9b13k4Failure,
  m9b13k4Failure,
  type M9b13k4LedgerReceipt,
  m9b13k4LedgerReceiptSchema,
} from "./protocol.js";

const COMPILER = "/usr/bin/xcrun" as const;
const CODESIGN = "/usr/bin/codesign" as const;
const SIGNING_IDENTIFIER = "org.nicia.lachesis.m9b13k4-ledger" as const;
const COMPILER_ARGUMENTS = [
  "clang",
  "-std=c17",
  "-Os",
  "-Wall",
  "-Wextra",
  "-Werror",
] as const;

export type M9b13k4HelperIdentity = Readonly<{
  protocol: typeof M9B13K4_BUILD_PROTOCOL;
  sourceSha256: string;
  executableSha256: string;
  executableBytes: number;
  executableDevice: string;
  executableInode: string;
  compiler: string;
  compilerVersion: string;
  sdkPath: string;
  targetArchitecture: "arm64" | "x86_64";
  flags: ReadonlyArray<string>;
  linkedLibraries: ReadonlyArray<string>;
  normalization: "remove-signature-patch-source-bound-lc-uuid-adhoc-resign";
}>;

const helperBrand: unique symbol = Symbol("M9b13k4HelperCapability");
export type M9b13k4HelperCapability = Readonly<{
  [helperBrand]: "M9b13k4HelperCapability";
}>;
export type M9b13k4BuiltHelper = Readonly<{
  helper: M9b13k4HelperCapability;
  identity: M9b13k4HelperIdentity;
}>;
const builtHelpers = new WeakMap<
  object,
  Readonly<{
    path: string;
    identity: M9b13k4HelperIdentity;
    device: bigint;
    inode: bigint;
  }>
>();

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactToolOutput(
  command: string,
  arguments_: ReadonlyArray<string>,
): string {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin" },
    maxBuffer: 64 * 1024,
  });
  if (result.status !== 0 || result.stderr.length !== 0)
    throw new Error("m9b13k4-build-tool-rejected");
  return result.stdout.trim();
}

function patchUuid(binary: Uint8Array, sourceDigest: string): Uint8Array {
  const bytes = binary.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 32 || view.getUint32(0, true) !== 0xfeedfacf)
    throw new Error("m9b13k4-mach-o-header-invalid");
  const commandCount = view.getUint32(16, true);
  const commandBytes = view.getUint32(20, true);
  if (32 + commandBytes > bytes.byteLength)
    throw new Error("m9b13k4-mach-o-commands-invalid");
  const uuid = Uint8Array.from(
    sourceDigest.slice(0, 32).match(/../gu) ?? [],
    (pair) => Number.parseInt(pair, 16),
  );
  if (uuid.byteLength !== 16) throw new Error("m9b13k4-source-digest-invalid");
  let offset = 32;
  let patched = false;
  for (let index = 0; index < commandCount; index++) {
    if (offset + 8 > 32 + commandBytes)
      throw new Error("m9b13k4-mach-o-command-truncated");
    const command = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);
    if (size < 8 || offset + size > 32 + commandBytes)
      throw new Error("m9b13k4-mach-o-command-invalid");
    if (command === 0x1b) {
      if (size !== 24 || patched)
        throw new Error("m9b13k4-mach-o-uuid-command-invalid");
      bytes.set(uuid, offset + 8);
      patched = true;
    }
    offset += size;
  }
  if (!patched) throw new Error("m9b13k4-mach-o-uuid-command-absent");
  return bytes;
}

function runBuildCommand(
  command: string,
  arguments_: ReadonlyArray<string>,
): void {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin" },
    maxBuffer: 64 * 1024,
  });
  if (
    result.status !== 0 ||
    result.stdout.length !== 0 ||
    result.stderr.length !== 0
  )
    throw new Error("m9b13k4-build-command-rejected");
}

export function buildM9b13k4Helper(
  sourcePath: string,
  outputPath: string,
): Result<M9b13k4BuiltHelper, M9b13k4Failure> {
  try {
    const source = readFileSync(sourcePath);
    const sourceSha256 = sha256(source);
    runBuildCommand(COMPILER, [
      ...COMPILER_ARGUMENTS,
      sourcePath,
      "-o",
      outputPath,
    ]);
    runBuildCommand(CODESIGN, ["--remove-signature", outputPath]);
    const normalized = patchUuid(readFileSync(outputPath), sourceSha256);
    writeFileSync(outputPath, normalized, { mode: 0o700 });
    runBuildCommand(CODESIGN, [
      "--force",
      "--sign",
      "-",
      "--identifier",
      SIGNING_IDENTIFIER,
      outputPath,
    ]);
    chmodSync(outputPath, 0o700);
    const executable = readFileSync(outputPath);
    const executableMetadata = lstatSync(outputPath, { bigint: true });
    if (
      !executableMetadata.isFile() ||
      executableMetadata.nlink !== 1n ||
      (executableMetadata.mode & 0o777n) !== 0o700n
    )
      return m9b13k4Failure("build", "m9b13k4-built-helper-metadata-invalid");
    const compilerVersion = exactToolOutput(COMPILER, ["clang", "--version"]);
    const sdkPath = exactToolOutput(COMPILER, ["--show-sdk-path"]);
    const architecture = exactToolOutput("/usr/bin/uname", ["-m"]);
    if (architecture !== "arm64" && architecture !== "x86_64")
      return m9b13k4Failure("build", "m9b13k4-architecture-unsupported");
    const libraries = exactToolOutput("/usr/bin/otool", ["-L", outputPath])
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const identity: M9b13k4HelperIdentity = Object.freeze({
      protocol: M9B13K4_BUILD_PROTOCOL,
      sourceSha256,
      executableSha256: sha256(executable),
      executableBytes: executable.byteLength,
      executableDevice: executableMetadata.dev.toString(),
      executableInode: executableMetadata.ino.toString(),
      compiler: COMPILER,
      compilerVersion,
      sdkPath,
      targetArchitecture: architecture,
      flags: COMPILER_ARGUMENTS,
      linkedLibraries: libraries,
      normalization: "remove-signature-patch-source-bound-lc-uuid-adhoc-resign",
    });
    const helper: M9b13k4HelperCapability = Object.freeze({
      [helperBrand]: "M9b13k4HelperCapability",
    });
    builtHelpers.set(helper, {
      path: outputPath,
      identity,
      device: executableMetadata.dev,
      inode: executableMetadata.ino,
    });
    return { ok: true, value: { helper, identity } };
  } catch (error: unknown) {
    return m9b13k4Failure(
      "build",
      error instanceof Error ? error.message : "m9b13k4-build-failed",
    );
  }
}

type InvocationOptions = Readonly<{
  crashPoint?: string;
  timeoutMs?: number;
  barrier?: boolean;
  outputFault?: "malformed";
}>;

type Invocation = Readonly<{
  arguments: ReadonlyArray<string>;
  input: Uint8Array;
  expectedOperation: M9b13k4LedgerReceipt["operation"];
}>;

function executableIdentity(
  path: string,
): Result<
  Readonly<{ sha256: string; device: bigint; inode: bigint }>,
  M9b13k4Failure
> {
  try {
    const metadata = lstatSync(path, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1n ||
      (metadata.mode & 0o777n) !== 0o700n
    )
      return m9b13k4Failure("identity", "m9b13k4-helper-metadata-rejected");
    return {
      ok: true,
      value: {
        sha256: sha256(readFileSync(path)),
        device: metadata.dev,
        inode: metadata.ino,
      },
    };
  } catch {
    return m9b13k4Failure("identity", "m9b13k4-helper-unreadable");
  }
}

function strictReceipt(
  line: string,
  expectedOperation: M9b13k4LedgerReceipt["operation"],
  helperSha256: string,
): Result<M9b13k4LedgerReceipt, M9b13k4Failure> {
  if (!line.endsWith("\n") || line.slice(0, -1).includes("\n"))
    return m9b13k4Failure(
      "invocation",
      "m9b13k4-helper-output-framing-invalid",
    );
  const tokens = line.slice(0, -1).split(" ");
  if (tokens[0] === "ERR" && tokens.length === 3) {
    if (!/^[a-z0-9-]{1,64}$/u.test(tokens[1] ?? ""))
      return m9b13k4Failure("invocation", "m9b13k4-helper-error-invalid");
    return m9b13k4Failure(
      "ledger",
      `m9b13k4-helper-${tokens[1]}`,
      tokens[2] === "1",
    );
  }
  if (tokens[0] !== "OK" || tokens.length !== 9)
    return m9b13k4Failure("invocation", "m9b13k4-helper-output-invalid");
  const sequence = Number(tokens[3]);
  const parsed = m9b13k4LedgerReceiptSchema.safeParse({
    protocol: M9B13K4_INVOCATION_PROTOCOL,
    operation: tokens[1],
    sessionIdentity: tokens[2],
    sequence,
    root: tokens[4],
    namespaceDevice: tokens[5],
    namespaceInode: tokens[6],
    logDevice: tokens[7],
    logInode: tokens[8],
    helperSha256,
  });
  return parsed.success && parsed.data.operation === expectedOperation
    ? { ok: true, value: parsed.data }
    : m9b13k4Failure("invocation", "m9b13k4-helper-receipt-invalid");
}

type RunningInvocation = Readonly<{
  child: ChildProcessWithoutNullStreams;
  ready: Promise<Result<void, M9b13k4Failure>>;
  release: () => void;
  completed: Promise<Result<M9b13k4LedgerReceipt, M9b13k4Failure>>;
}>;

function launchInvocation(
  helper: unknown,
  invocation: Invocation,
  options: InvocationOptions,
): Result<RunningInvocation, M9b13k4Failure> {
  const built =
    typeof helper === "object" && helper !== null
      ? builtHelpers.get(helper)
      : undefined;
  if (built === undefined)
    return m9b13k4Failure("identity", "m9b13k4-helper-capability-invalid");
  const helperPath = built.path;
  const before = executableIdentity(helperPath);
  if (!before.ok) return before;
  if (
    before.value.sha256 !== built.identity.executableSha256 ||
    before.value.device !== built.device ||
    before.value.inode !== built.inode
  )
    return m9b13k4Failure("identity", "m9b13k4-helper-hash-mismatch");
  const environment: Record<string, string> = { PATH: "/usr/bin:/bin" };
  if (options.crashPoint !== undefined)
    environment["M9B13K4_CRASH_POINT"] = options.crashPoint;
  if (options.barrier === true) environment["M9B13K4_BARRIER"] = "1";
  if (options.outputFault !== undefined)
    environment["M9B13K4_OUTPUT_FAULT"] = options.outputFault;
  const child = spawn(helperPath, invocation.arguments, {
    env: environment,
    stdio:
      options.barrier === true
        ? ["pipe", "pipe", "pipe", "pipe", "pipe"]
        : "pipe",
  });
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = Buffer.concat(
      [stdout, chunk],
      stdout.byteLength + chunk.byteLength,
    );
    if (stdout.byteLength > M9B13K4_MAXIMUM_OUTPUT_BYTES) child.kill("SIGKILL");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = Buffer.concat(
      [stderr, chunk],
      stderr.byteLength + chunk.byteLength,
    );
    if (stderr.byteLength > M9B13K4_MAXIMUM_OUTPUT_BYTES) child.kill("SIGKILL");
  });
  child.stdin.once("error", () => {
    // The helper may reject before consuming stdin; its bounded receipt and
    // exit status remain authoritative for that invocation.
  });
  child.stdin.end(invocation.input);
  const timeoutMs = options.timeoutMs ?? M9B13K4_HELPER_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  timer.unref();
  const ready =
    options.barrier === true
      ? new Promise<Result<void, M9b13k4Failure>>((resolve) => {
          const descriptor = child.stdio[3];
          if (!(descriptor instanceof Readable)) {
            resolve(m9b13k4Failure("invocation", "m9b13k4-barrier-fd-invalid"));
            return;
          }
          descriptor.once("data", (chunk: Buffer) => {
            resolve(
              chunk.equals(Buffer.from("R"))
                ? { ok: true, value: undefined }
                : m9b13k4Failure("invocation", "m9b13k4-barrier-ready-invalid"),
            );
          });
        })
      : Promise.resolve({ ok: true as const, value: undefined });
  const release = (): void => {
    const descriptor = child.stdio[4];
    if (options.barrier === true && descriptor instanceof Writable)
      descriptor.end(Buffer.from("G"));
  };
  const completed = new Promise<Result<M9b13k4LedgerReceipt, M9b13k4Failure>>(
    (resolve) => {
      child.once("error", () => {
        clearTimeout(timer);
        resolve(m9b13k4Failure("invocation", "m9b13k4-helper-spawn-failed"));
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        const after = executableIdentity(helperPath);
        if (
          !after.ok ||
          after.value.sha256 !== before.value.sha256 ||
          after.value.device !== before.value.device ||
          after.value.inode !== before.value.inode
        ) {
          resolve(
            m9b13k4Failure(
              "identity",
              "m9b13k4-helper-replaced-during-run",
              true,
            ),
          );
          return;
        }
        if (signal !== null || code === 91) {
          resolve(
            timedOut
              ? m9b13k4Failure("timeout", "m9b13k4-helper-timeout", true)
              : m9b13k4Failure("invocation", "m9b13k4-helper-terminated", true),
          );
          return;
        }
        if (
          stderr.byteLength !== 0 ||
          stdout.byteLength > M9B13K4_MAXIMUM_OUTPUT_BYTES
        ) {
          resolve(m9b13k4Failure("invocation", "m9b13k4-helper-extra-output"));
          return;
        }
        const receipt = strictReceipt(
          stdout.toString("utf8"),
          invocation.expectedOperation,
          before.value.sha256,
        );
        resolve(
          code === 0 || (!receipt.ok && code === 2)
            ? receipt
            : m9b13k4Failure("invocation", "m9b13k4-helper-exit-invalid"),
        );
      });
    },
  );
  return { ok: true, value: { child, ready, release, completed } };
}

async function invoke(
  helper: unknown,
  invocation: Invocation,
  options: InvocationOptions = {},
): Promise<Result<M9b13k4LedgerReceipt, M9b13k4Failure>> {
  const launched = launchInvocation(helper, invocation, options);
  if (!launched.ok) return launched;
  return await launched.value.completed;
}

function appendInvocation(
  namespacePath: string,
  expected: M9b13k4LedgerReceipt,
  payload: Uint8Array,
): Invocation {
  return {
    arguments: [
      "append",
      namespacePath,
      expected.sessionIdentity,
      String(expected.sequence),
      expected.root,
      expected.namespaceDevice,
      expected.namespaceInode,
      expected.logDevice,
      expected.logInode,
    ],
    input: payload,
    expectedOperation: "append",
  };
}

export async function createM9b13k4Ledger(
  helper: unknown,
  namespacePath: string,
): Promise<Result<M9b13k4LedgerReceipt, M9b13k4Failure>> {
  return await invoke(helper, {
    arguments: ["create", namespacePath],
    input: new Uint8Array(),
    expectedOperation: "create",
  });
}

export async function snapshotM9b13k4Ledger(
  helper: unknown,
  namespacePath: string,
): Promise<Result<M9b13k4LedgerReceipt, M9b13k4Failure>> {
  return await invoke(helper, {
    arguments: ["snapshot", namespacePath],
    input: new Uint8Array(),
    expectedOperation: "snapshot",
  });
}

export async function auditM9b13k4Ledger(
  helper: unknown,
  namespacePath: string,
  expected?: M9b13k4LedgerReceipt,
): Promise<Result<M9b13k4LedgerReceipt, M9b13k4Failure>> {
  const result = await invoke(helper, {
    arguments: ["audit", namespacePath],
    input: new Uint8Array(),
    expectedOperation: "audit",
  });
  if (!result.ok || expected === undefined) return result;
  return result.value.sessionIdentity === expected.sessionIdentity &&
    result.value.sequence === expected.sequence &&
    result.value.root === expected.root &&
    result.value.namespaceDevice === expected.namespaceDevice &&
    result.value.namespaceInode === expected.namespaceInode &&
    result.value.logDevice === expected.logDevice &&
    result.value.logInode === expected.logInode
    ? result
    : m9b13k4Failure("ledger", "m9b13k4-audit-expected-state-mismatch", true);
}

export async function appendM9b13k4Ledger(
  helper: unknown,
  namespacePath: string,
  expected: M9b13k4LedgerReceipt,
  rawPayload: string,
  options: Readonly<{ crashPoint?: string; timeoutMs?: number }> = {},
): Promise<Result<M9b13k4LedgerReceipt, M9b13k4Failure>> {
  const payload = canonicalM9b13k4Payload(rawPayload);
  if (!payload.ok) return payload;
  return await invoke(
    helper,
    appendInvocation(namespacePath, expected, payload.value),
    options,
  );
}

export function launchBarrierM9b13k4Append(
  helper: unknown,
  namespacePath: string,
  expected: M9b13k4LedgerReceipt,
  rawPayload: string,
  timeoutMs: number = M9B13K4_HELPER_TIMEOUT_MS,
): Result<RunningInvocation, M9b13k4Failure> {
  const payload = canonicalM9b13k4Payload(rawPayload);
  return payload.ok
    ? launchInvocation(
        helper,
        appendInvocation(namespacePath, expected, payload.value),
        { barrier: true, timeoutMs },
      )
    : payload;
}

export async function inspectMalformedM9b13k4HelperOutput(
  helper: unknown,
  namespacePath: string,
): Promise<Result<M9b13k4LedgerReceipt, M9b13k4Failure>> {
  return await invoke(
    helper,
    {
      arguments: ["snapshot", namespacePath],
      input: new Uint8Array(),
      expectedOperation: "snapshot",
    },
    { outputFault: "malformed" },
  );
}
