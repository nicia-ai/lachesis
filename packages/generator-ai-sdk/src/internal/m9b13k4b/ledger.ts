import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { Readable, Writable } from "node:stream";

import { type Result } from "@nicia-ai/lachesis";

import {
  canonicalM9b13k4bPayload,
  M9B13K4B_BUILD_PROTOCOL,
  M9B13K4B_HELPER_TIMEOUT_MS,
  M9B13K4B_INVOCATION_PROTOCOL,
  M9B13K4B_MAXIMUM_OUTPUT_BYTES,
  type M9b13k4bFailure,
  m9b13k4bFailure,
  type M9b13k4bLedgerReceipt,
  m9b13k4bLedgerReceiptSchema,
} from "./protocol.js";

const COMPILER = "/usr/bin/xcrun" as const;
const CODESIGN = "/usr/bin/codesign" as const;
const PRODUCTION_SIGNING_IDENTIFIER =
  "org.nicia.lachesis.m9b13k4b-ledger" as const;
const CONFORMANCE_SIGNING_IDENTIFIER =
  "org.nicia.lachesis.m9b13k4b-ledger-conformance" as const;
const PRODUCTION_HELPER_LEAF = "m9b13k4b-ledger-helper" as const;
const CONFORMANCE_HELPER_LEAF = "m9b13k4b-ledger-conformance-helper" as const;
const COMPILER_ARGUMENTS = [
  "clang",
  "-std=c17",
  "-Os",
  "-Wall",
  "-Wextra",
  "-Werror",
] as const;

export type M9b13k4bHelperIdentity = Readonly<{
  protocol: typeof M9B13K4B_BUILD_PROTOCOL;
  sourceSha256: string;
  executableSha256: string;
  executableBytes: number;
  executableDevice: string;
  executableInode: string;
  executableOwner: number;
  variant: "production" | "conformance";
  admittedPathComponents: ReadonlyArray<M9b13k4bPathComponentIdentity>;
  compiler: string;
  compilerVersion: string;
  sdkPath: string;
  targetArchitecture: "arm64" | "x86_64";
  flags: ReadonlyArray<string>;
  linkedLibraries: ReadonlyArray<string>;
  normalization: "remove-signature-patch-source-bound-lc-uuid-adhoc-resign";
}>;

export type M9b13k4bPathComponentIdentity = Readonly<{
  path: string;
  device: string;
  inode: string;
  owner: number;
  mode: number;
}>;

const helperBrand: unique symbol = Symbol("M9b13k4bHelperCapability");
export type M9b13k4bHelperCapability = Readonly<{
  [helperBrand]: "M9b13k4bHelperCapability";
}>;
export type M9b13k4bBuiltHelper = Readonly<{
  helper: M9b13k4bHelperCapability;
  identity: M9b13k4bHelperIdentity;
}>;
const builtHelpers = new WeakMap<
  object,
  Readonly<{
    path: string;
    identity: M9b13k4bHelperIdentity;
    device: bigint;
    inode: bigint;
    variant: "production" | "conformance";
    pathComponents: ReadonlyArray<M9b13k4bPathComponentIdentity>;
  }>
>();

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function effectiveUserId(): number {
  const uid = process.geteuid?.();
  if (uid === undefined) throw new Error("m9b13k4b-effective-uid-unavailable");
  return uid;
}

function exactPath(path: string): string {
  const normalized = resolve(path);
  if (path !== normalized || normalized === "/" || normalized.endsWith("/"))
    throw new Error("m9b13k4b-path-not-normalized");
  return normalized;
}

function componentPaths(path: string): ReadonlyArray<string> {
  const components = path.split("/").slice(1);
  let current = "";
  return components.map((component) => {
    current += `/${component}`;
    return current;
  });
}

function admittedComponent(path: string): M9b13k4bPathComponentIdentity {
  const metadata = lstatSync(path, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error("m9b13k4b-helper-path-component-rejected");
  const mode = Number(metadata.mode & 0o7777n);
  const owner = Number(metadata.uid);
  const writable = mode & 0o022;
  const approvedStickySystemDirectory =
    path === "/private/tmp" && owner === 0 && mode === 0o1777;
  if (
    owner === effectiveUserId()
      ? mode !== 0o700
      : owner !== 0 || (writable !== 0 && !approvedStickySystemDirectory)
  )
    throw new Error("m9b13k4b-helper-path-mode-rejected");
  return Object.freeze({
    path,
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    owner,
    mode,
  });
}

function admitNewBuildDirectory(
  directoryPath: string,
): ReadonlyArray<M9b13k4bPathComponentIdentity> {
  const directory = exactPath(directoryPath);
  const components = componentPaths(directory);
  if (components.length < 2)
    throw new Error("m9b13k4b-build-directory-parent-rejected");
  const parentComponents = components.slice(0, -1).map(admittedComponent);
  let absent = false;
  try {
    lstatSync(directory);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      absent = true;
    else throw error;
  }
  if (!absent) throw new Error("m9b13k4b-build-directory-preexisting");
  mkdirSync(directory, { mode: 0o700 });
  return Object.freeze([...parentComponents, admittedComponent(directory)]);
}

function pathComponentsStillPinned(
  components: ReadonlyArray<M9b13k4bPathComponentIdentity>,
): boolean {
  try {
    return components.every((expected) => {
      const current = admittedComponent(expected.path);
      return (
        current.device === expected.device &&
        current.inode === expected.inode &&
        current.owner === expected.owner &&
        current.mode === expected.mode
      );
    });
  } catch {
    return false;
  }
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
    throw new Error("m9b13k4b-build-tool-rejected");
  return result.stdout.trim();
}

function patchUuid(binary: Uint8Array, sourceDigest: string): Uint8Array {
  const bytes = binary.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 32 || view.getUint32(0, true) !== 0xfeedfacf)
    throw new Error("m9b13k4b-mach-o-header-invalid");
  const commandCount = view.getUint32(16, true);
  const commandBytes = view.getUint32(20, true);
  if (32 + commandBytes > bytes.byteLength)
    throw new Error("m9b13k4b-mach-o-commands-invalid");
  const uuid = Uint8Array.from(
    sourceDigest.slice(0, 32).match(/../gu) ?? [],
    (pair) => Number.parseInt(pair, 16),
  );
  if (uuid.byteLength !== 16) throw new Error("m9b13k4b-source-digest-invalid");
  let offset = 32;
  let patched = false;
  for (let index = 0; index < commandCount; index++) {
    if (offset + 8 > 32 + commandBytes)
      throw new Error("m9b13k4b-mach-o-command-truncated");
    const command = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);
    if (size < 8 || offset + size > 32 + commandBytes)
      throw new Error("m9b13k4b-mach-o-command-invalid");
    if (command === 0x1b) {
      if (size !== 24 || patched)
        throw new Error("m9b13k4b-mach-o-uuid-command-invalid");
      bytes.set(uuid, offset + 8);
      patched = true;
    }
    offset += size;
  }
  if (!patched) throw new Error("m9b13k4b-mach-o-uuid-command-absent");
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
    throw new Error("m9b13k4b-build-command-rejected");
}

function buildHelper(
  sourcePath: string,
  buildDirectoryPath: string,
  variant: "production" | "conformance",
): Result<M9b13k4bBuiltHelper, M9b13k4bFailure> {
  try {
    const exactSourcePath = exactPath(sourcePath);
    const pathComponents = admitNewBuildDirectory(buildDirectoryPath);
    const outputLeaf =
      variant === "production"
        ? PRODUCTION_HELPER_LEAF
        : CONFORMANCE_HELPER_LEAF;
    const signingIdentifier =
      variant === "production"
        ? PRODUCTION_SIGNING_IDENTIFIER
        : CONFORMANCE_SIGNING_IDENTIFIER;
    const flags =
      variant === "production"
        ? COMPILER_ARGUMENTS
        : [...COMPILER_ARGUMENTS, "-DM9B13K4B_CONFORMANCE=1"];
    const outputPath = `${exactPath(buildDirectoryPath)}/${outputLeaf}`;
    const source = readFileSync(exactSourcePath);
    const sourceSha256 = sha256(source);
    runBuildCommand(COMPILER, [...flags, exactSourcePath, "-o", outputPath]);
    runBuildCommand(CODESIGN, ["--remove-signature", outputPath]);
    const normalized = patchUuid(readFileSync(outputPath), sourceSha256);
    writeFileSync(outputPath, normalized, { mode: 0o700 });
    runBuildCommand(CODESIGN, [
      "--force",
      "--sign",
      "-",
      "--identifier",
      signingIdentifier,
      outputPath,
    ]);
    chmodSync(outputPath, 0o700);
    if (!pathComponentsStillPinned(pathComponents))
      return m9b13k4bFailure("build", "m9b13k4b-helper-path-replaced");
    const executable = readFileSync(outputPath);
    const executableMetadata = lstatSync(outputPath, { bigint: true });
    if (
      !executableMetadata.isFile() ||
      executableMetadata.isSymbolicLink() ||
      executableMetadata.nlink !== 1n ||
      Number(executableMetadata.uid) !== effectiveUserId() ||
      (executableMetadata.mode & 0o777n) !== 0o700n
    )
      return m9b13k4bFailure("build", "m9b13k4b-built-helper-metadata-invalid");
    const compilerVersion = exactToolOutput(COMPILER, ["clang", "--version"]);
    const sdkPath = exactToolOutput(COMPILER, ["--show-sdk-path"]);
    const architecture = exactToolOutput("/usr/bin/uname", ["-m"]);
    if (architecture !== "arm64" && architecture !== "x86_64")
      return m9b13k4bFailure("build", "m9b13k4b-architecture-unsupported");
    const libraries = exactToolOutput("/usr/bin/otool", ["-L", outputPath])
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const identity: M9b13k4bHelperIdentity = Object.freeze({
      protocol: M9B13K4B_BUILD_PROTOCOL,
      sourceSha256,
      executableSha256: sha256(executable),
      executableBytes: executable.byteLength,
      executableDevice: executableMetadata.dev.toString(),
      executableInode: executableMetadata.ino.toString(),
      executableOwner: Number(executableMetadata.uid),
      variant,
      admittedPathComponents: pathComponents,
      compiler: COMPILER,
      compilerVersion,
      sdkPath,
      targetArchitecture: architecture,
      flags,
      linkedLibraries: libraries,
      normalization: "remove-signature-patch-source-bound-lc-uuid-adhoc-resign",
    });
    const helper: M9b13k4bHelperCapability = Object.freeze({
      [helperBrand]: "M9b13k4bHelperCapability",
    });
    builtHelpers.set(helper, {
      path: outputPath,
      identity,
      device: executableMetadata.dev,
      inode: executableMetadata.ino,
      variant,
      pathComponents,
    });
    return { ok: true, value: { helper, identity } };
  } catch (error: unknown) {
    return m9b13k4bFailure(
      "build",
      error instanceof Error ? error.message : "m9b13k4b-build-failed",
    );
  }
}

export function buildM9b13k4bHelper(
  sourcePath: string,
  buildDirectoryPath: string,
): Result<M9b13k4bBuiltHelper, M9b13k4bFailure> {
  return buildHelper(sourcePath, buildDirectoryPath, "production");
}

export function buildM9b13k4bConformanceHelper(
  sourcePath: string,
  buildDirectoryPath: string,
): Result<M9b13k4bBuiltHelper, M9b13k4bFailure> {
  return buildHelper(sourcePath, buildDirectoryPath, "conformance");
}

type InvocationOptions = Readonly<{
  crashPoint?: string;
  syntheticFailurePoint?: string;
  timeoutMs?: number;
  barrier?: boolean;
  outputFault?: "malformed";
  deferInput?: boolean;
}>;

type Invocation = Readonly<{
  arguments: ReadonlyArray<string>;
  input: Uint8Array;
  expectedOperation: M9b13k4bLedgerReceipt["operation"];
}>;

function executableIdentity(
  path: string,
): Result<
  Readonly<{ sha256: string; device: bigint; inode: bigint }>,
  M9b13k4bFailure
> {
  try {
    const metadata = lstatSync(path, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1n ||
      Number(metadata.uid) !== effectiveUserId() ||
      (metadata.mode & 0o777n) !== 0o700n
    )
      return m9b13k4bFailure("identity", "m9b13k4b-helper-metadata-rejected");
    return {
      ok: true,
      value: {
        sha256: sha256(readFileSync(path)),
        device: metadata.dev,
        inode: metadata.ino,
      },
    };
  } catch {
    return m9b13k4bFailure("identity", "m9b13k4b-helper-unreadable");
  }
}

function strictReceipt(
  line: string,
  expectedOperation: M9b13k4bLedgerReceipt["operation"],
  helperSha256: string,
  helperVariant: M9b13k4bHelperIdentity["variant"],
): Result<M9b13k4bLedgerReceipt, M9b13k4bFailure> {
  if (!line.endsWith("\n") || line.slice(0, -1).includes("\n"))
    return m9b13k4bFailure(
      "invocation",
      "m9b13k4b-helper-output-framing-invalid",
    );
  const tokens = line.slice(0, -1).split(" ");
  if (tokens[0] === "ERR" && tokens.length === 3) {
    if (
      !/^[a-z0-9-]{1,64}$/u.test(tokens[1] ?? "") ||
      (tokens[2] !== "0" && tokens[2] !== "1")
    )
      return m9b13k4bFailure("invocation", "m9b13k4b-helper-error-invalid");
    return m9b13k4bFailure(
      "ledger",
      `m9b13k4b-helper-${tokens[1]}`,
      tokens[2] === "1",
    );
  }
  if (tokens[0] !== "OK" || tokens.length !== 14)
    return m9b13k4bFailure("invocation", "m9b13k4b-helper-output-invalid");
  const sequence = Number(tokens[3]);
  const receivedSignalCount = Number(tokens[10]);
  const actualEintrCount = Number(tokens[11]);
  const syntheticFailureCount = Number(tokens[12]);
  const syntheticPartialBytes = Number(tokens[13]);
  const parsed = m9b13k4bLedgerReceiptSchema.safeParse({
    protocol: M9B13K4B_INVOCATION_PROTOCOL,
    operation: tokens[1],
    sessionIdentity: tokens[2],
    sequence,
    root: tokens[4],
    namespaceDevice: tokens[5],
    namespaceInode: tokens[6],
    logDevice: tokens[7],
    logInode: tokens[8],
    helperSha256,
    helperVariant: tokens[9],
    receivedSignalCount,
    actualEintrCount,
    syntheticFailureCount,
    syntheticPartialBytes,
  });
  return parsed.success &&
    parsed.data.operation === expectedOperation &&
    parsed.data.helperVariant === helperVariant
    ? { ok: true, value: parsed.data }
    : m9b13k4bFailure("invocation", "m9b13k4b-helper-receipt-invalid");
}

type RunningInvocation = Readonly<{
  child: ChildProcessWithoutNullStreams;
  ready: Promise<Result<void, M9b13k4bFailure>>;
  release: () => void;
  sendInput: () => void;
  completed: Promise<Result<M9b13k4bLedgerReceipt, M9b13k4bFailure>>;
}>;

function launchInvocation(
  helper: unknown,
  invocation: Invocation,
  options: InvocationOptions,
): Result<RunningInvocation, M9b13k4bFailure> {
  const built =
    typeof helper === "object" && helper !== null
      ? builtHelpers.get(helper)
      : undefined;
  if (built === undefined)
    return m9b13k4bFailure("identity", "m9b13k4b-helper-capability-invalid");
  if (!pathComponentsStillPinned(built.pathComponents))
    return m9b13k4bFailure("identity", "m9b13k4b-helper-path-replaced");
  const helperPath = built.path;
  const before = executableIdentity(helperPath);
  if (!before.ok) return before;
  if (
    before.value.sha256 !== built.identity.executableSha256 ||
    before.value.device !== built.device ||
    before.value.inode !== built.inode
  )
    return m9b13k4bFailure("identity", "m9b13k4b-helper-hash-mismatch");
  const admittedBuilt = built;
  const admittedBefore = before.value;
  const environment: Record<string, string> = { PATH: "/usr/bin:/bin" };
  if (options.crashPoint !== undefined)
    environment["M9B13K4B_CRASH_POINT"] = options.crashPoint;
  if (options.syntheticFailurePoint !== undefined) {
    if (built.variant !== "conformance")
      return m9b13k4bFailure(
        "invocation",
        "m9b13k4b-synthetic-failure-production-rejected",
      );
    environment["M9B13K4B_SYNTHETIC_FAILURE_POINT"] =
      options.syntheticFailurePoint;
  }
  if (options.barrier === true) environment["M9B13K4B_BARRIER"] = "1";
  if (options.outputFault !== undefined)
    environment["M9B13K4B_OUTPUT_FAULT"] = options.outputFault;
  const child = spawn(helperPath, invocation.arguments, {
    env: environment,
    stdio:
      options.barrier === true
        ? ["pipe", "pipe", "pipe", "pipe", "pipe"]
        : "pipe",
  });
  const readinessDescriptor =
    options.barrier === true && child.stdio[3] instanceof Readable
      ? child.stdio[3]
      : undefined;
  const releaseDescriptor =
    options.barrier === true && child.stdio[4] instanceof Writable
      ? child.stdio[4]
      : undefined;
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let outputExceeded = false;
  let readySettled = options.barrier !== true;
  let readySucceeded = options.barrier !== true;
  let completedSettled = false;
  let released = false;
  let inputSent = options.deferInput !== true;
  let releaseClosed = false;
  let timedOut = false;
  let listenersCleared = false;
  const { promise: ready, resolve: resolveReady } =
    Promise.withResolvers<Result<void, M9b13k4bFailure>>();
  const { promise: completed, resolve: resolveCompleted } =
    Promise.withResolvers<Result<M9b13k4bLedgerReceipt, M9b13k4bFailure>>();
  if (options.barrier !== true) resolveReady({ ok: true, value: undefined });
  const ignoreStreamError = (error: Error): void => {
    void error;
  };
  const settleReady = (result: Result<void, M9b13k4bFailure>): void => {
    if (readySettled) return;
    readySettled = true;
    readySucceeded = result.ok;
    resolveReady(result);
  };
  const closeReleaseDescriptor = (): void => {
    if (releaseClosed || releaseDescriptor === undefined) return;
    releaseClosed = true;
    releaseDescriptor.once("error", ignoreStreamError);
    releaseDescriptor.end();
  };
  const destroyDescriptors = (): void => {
    readinessDescriptor?.destroy();
    releaseDescriptor?.destroy();
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  };
  const clearLifecycleListeners = (): void => {
    if (listenersCleared) return;
    listenersCleared = true;
    readinessDescriptor?.removeListener("data", onReadinessData);
    readinessDescriptor?.removeListener("end", onReadinessEnd);
    readinessDescriptor?.removeListener("error", onReadinessError);
    child.removeListener("error", onChildError);
    child.removeListener("exit", onChildExit);
    child.removeListener("close", onChildClose);
    child.stdout.removeListener("data", onStdoutData);
    child.stderr.removeListener("data", onStderrData);
    child.on("error", ignoreStreamError);
    readinessDescriptor?.on("error", ignoreStreamError);
    releaseDescriptor?.on("error", ignoreStreamError);
    child.stdin.on("error", ignoreStreamError);
    child.stdout.on("error", ignoreStreamError);
    child.stderr.on("error", ignoreStreamError);
  };
  const settleCompleted = (
    result: Result<M9b13k4bLedgerReceipt, M9b13k4bFailure>,
  ): void => {
    if (completedSettled) return;
    completedSettled = true;
    clearTimeout(timer);
    closeReleaseDescriptor();
    clearLifecycleListeners();
    destroyDescriptors();
    resolveCompleted(result);
  };
  const onStdoutData = (chunk: Buffer): void => {
    stdout = Buffer.concat(
      [stdout, chunk],
      stdout.byteLength + chunk.byteLength,
    );
    if (stdout.byteLength > M9B13K4B_MAXIMUM_OUTPUT_BYTES) {
      outputExceeded = true;
      child.kill("SIGKILL");
    }
  };
  const onStderrData = (chunk: Buffer): void => {
    stderr = Buffer.concat(
      [stderr, chunk],
      stderr.byteLength + chunk.byteLength,
    );
    if (stderr.byteLength > M9B13K4B_MAXIMUM_OUTPUT_BYTES) {
      outputExceeded = true;
      child.kill("SIGKILL");
    }
  };
  child.stdout.on("data", onStdoutData);
  child.stderr.on("data", onStderrData);
  child.stdin.once("error", () => {
    // The helper may reject before consuming stdin; its bounded receipt and
    // exit status remain authoritative for that invocation.
  });
  if (options.deferInput !== true) child.stdin.end(invocation.input);
  const timeoutMs = options.timeoutMs ?? M9B13K4B_HELPER_TIMEOUT_MS;
  const timer = setTimeout(() => {
    if (completedSettled) return;
    timedOut = true;
    settleReady(m9b13k4bFailure("timeout", "m9b13k4b-helper-timeout"));
    closeReleaseDescriptor();
    child.kill("SIGKILL");
  }, timeoutMs);
  timer.unref();
  function onReadinessData(chunk: Buffer): void {
    if (readySettled) return;
    if (chunk.equals(Buffer.from("R"))) {
      settleReady({ ok: true, value: undefined });
      return;
    }
    settleReady(
      m9b13k4bFailure("invocation", "m9b13k4b-barrier-ready-invalid"),
    );
    closeReleaseDescriptor();
    child.kill("SIGKILL");
  }
  function onReadinessEnd(): void {
    if (readySettled) return;
    settleReady(m9b13k4bFailure("invocation", "m9b13k4b-barrier-ready-eof"));
    closeReleaseDescriptor();
    child.kill("SIGKILL");
  }
  function onReadinessError(): void {
    if (readySettled) return;
    settleReady(m9b13k4bFailure("invocation", "m9b13k4b-barrier-ready-error"));
    closeReleaseDescriptor();
    child.kill("SIGKILL");
  }
  const release = (): void => {
    if (
      options.barrier !== true ||
      !readySucceeded ||
      released ||
      completedSettled ||
      releaseDescriptor === undefined
    )
      return;
    released = true;
    releaseClosed = true;
    releaseDescriptor.once("error", ignoreStreamError);
    releaseDescriptor.end(Buffer.from("G"));
  };
  const sendInput = (): void => {
    if (inputSent || completedSettled) return;
    inputSent = true;
    child.stdin.end(invocation.input);
  };
  function onChildError(): void {
    const failure = m9b13k4bFailure(
      "invocation",
      "m9b13k4b-helper-spawn-failed",
    );
    child.kill("SIGKILL");
    settleReady(failure);
    settleCompleted(failure);
  }
  function onChildExit(): void {
    if (!readySettled)
      settleReady(
        m9b13k4bFailure("invocation", "m9b13k4b-helper-exit-before-readiness"),
      );
    closeReleaseDescriptor();
  }
  function onChildClose(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (!readySettled)
      settleReady(
        m9b13k4bFailure("invocation", "m9b13k4b-helper-close-before-readiness"),
      );
    const after = executableIdentity(helperPath);
    if (
      !pathComponentsStillPinned(admittedBuilt.pathComponents) ||
      !after.ok ||
      after.value.sha256 !== admittedBefore.sha256 ||
      after.value.device !== admittedBefore.device ||
      after.value.inode !== admittedBefore.inode
    ) {
      settleCompleted(
        m9b13k4bFailure(
          "identity",
          "m9b13k4b-helper-replaced-during-run",
          true,
        ),
      );
      return;
    }
    const appendMayHaveOccurred =
      invocation.expectedOperation === "append" &&
      (options.barrier !== true || released);
    if (outputExceeded) {
      settleCompleted(
        m9b13k4bFailure("invocation", "m9b13k4b-helper-extra-output"),
      );
      return;
    }
    if (signal !== null || code === 91) {
      settleCompleted(
        timedOut
          ? m9b13k4bFailure(
              "timeout",
              "m9b13k4b-helper-timeout",
              appendMayHaveOccurred,
            )
          : m9b13k4bFailure(
              "invocation",
              "m9b13k4b-helper-terminated",
              appendMayHaveOccurred,
            ),
      );
      return;
    }
    if (stderr.byteLength !== 0) {
      settleCompleted(
        m9b13k4bFailure("invocation", "m9b13k4b-helper-extra-output"),
      );
      return;
    }
    const receipt = strictReceipt(
      stdout.toString("utf8"),
      invocation.expectedOperation,
      admittedBefore.sha256,
      admittedBuilt.variant,
    );
    settleCompleted(
      code === 0 || (!receipt.ok && code === 2)
        ? receipt
        : m9b13k4bFailure("invocation", "m9b13k4b-helper-exit-invalid"),
    );
  }
  if (options.barrier === true) {
    if (readinessDescriptor === undefined || releaseDescriptor === undefined) {
      const failure = m9b13k4bFailure(
        "invocation",
        "m9b13k4b-barrier-fd-invalid",
      );
      settleReady(failure);
      closeReleaseDescriptor();
      child.kill("SIGKILL");
    } else {
      readinessDescriptor.on("data", onReadinessData);
      readinessDescriptor.once("end", onReadinessEnd);
      readinessDescriptor.once("error", onReadinessError);
    }
  }
  child.once("error", onChildError);
  child.once("exit", onChildExit);
  child.once("close", onChildClose);
  return {
    ok: true,
    value: { child, ready, release, sendInput, completed },
  };
}

async function invoke(
  helper: unknown,
  invocation: Invocation,
  options: InvocationOptions = {},
): Promise<Result<M9b13k4bLedgerReceipt, M9b13k4bFailure>> {
  const launched = launchInvocation(helper, invocation, options);
  if (!launched.ok) return launched;
  return await launched.value.completed;
}

function appendInvocation(
  namespacePath: string,
  expected: M9b13k4bLedgerReceipt,
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

export async function createM9b13k4bLedger(
  helper: unknown,
  namespacePath: string,
): Promise<Result<M9b13k4bLedgerReceipt, M9b13k4bFailure>> {
  return await invoke(helper, {
    arguments: ["create", namespacePath],
    input: new Uint8Array(),
    expectedOperation: "create",
  });
}

export async function snapshotM9b13k4bLedger(
  helper: unknown,
  namespacePath: string,
  options: Readonly<{ syntheticFailurePoint?: string }> = {},
): Promise<Result<M9b13k4bLedgerReceipt, M9b13k4bFailure>> {
  return await invoke(
    helper,
    {
      arguments: ["snapshot", namespacePath],
      input: new Uint8Array(),
      expectedOperation: "snapshot",
    },
    options,
  );
}

export async function auditM9b13k4bLedger(
  helper: unknown,
  namespacePath: string,
  expected?: M9b13k4bLedgerReceipt,
  options: Readonly<{ syntheticFailurePoint?: string }> = {},
): Promise<Result<M9b13k4bLedgerReceipt, M9b13k4bFailure>> {
  const result = await invoke(
    helper,
    {
      arguments: ["audit", namespacePath],
      input: new Uint8Array(),
      expectedOperation: "audit",
    },
    options,
  );
  if (!result.ok || expected === undefined) return result;
  return result.value.sessionIdentity === expected.sessionIdentity &&
    result.value.sequence === expected.sequence &&
    result.value.root === expected.root &&
    result.value.namespaceDevice === expected.namespaceDevice &&
    result.value.namespaceInode === expected.namespaceInode &&
    result.value.logDevice === expected.logDevice &&
    result.value.logInode === expected.logInode
    ? result
    : m9b13k4bFailure("ledger", "m9b13k4b-audit-expected-state-mismatch", true);
}

export async function appendM9b13k4bLedger(
  helper: unknown,
  namespacePath: string,
  expected: M9b13k4bLedgerReceipt,
  rawPayload: string,
  options: Readonly<{
    crashPoint?: string;
    syntheticFailurePoint?: string;
    timeoutMs?: number;
  }> = {},
): Promise<Result<M9b13k4bLedgerReceipt, M9b13k4bFailure>> {
  const payload = canonicalM9b13k4bPayload(rawPayload);
  if (!payload.ok) return payload;
  return await invoke(
    helper,
    appendInvocation(namespacePath, expected, payload.value),
    options,
  );
}

export function launchBarrierM9b13k4bAppend(
  helper: unknown,
  namespacePath: string,
  expected: M9b13k4bLedgerReceipt,
  rawPayload: string,
  timeoutMs: number = M9B13K4B_HELPER_TIMEOUT_MS,
): Result<RunningInvocation, M9b13k4bFailure> {
  const payload = canonicalM9b13k4bPayload(rawPayload);
  return payload.ok
    ? launchInvocation(
        helper,
        appendInvocation(namespacePath, expected, payload.value),
        { barrier: true, timeoutMs },
      )
    : payload;
}

export function launchBlockedInputM9b13k4bAppend(
  helper: unknown,
  namespacePath: string,
  expected: M9b13k4bLedgerReceipt,
  rawPayload: string,
  timeoutMs: number = M9B13K4B_HELPER_TIMEOUT_MS,
): Result<RunningInvocation, M9b13k4bFailure> {
  const payload = canonicalM9b13k4bPayload(rawPayload);
  return payload.ok
    ? launchInvocation(
        helper,
        appendInvocation(namespacePath, expected, payload.value),
        { deferInput: true, timeoutMs },
      )
    : payload;
}

export function launchBarrierM9b13k4bInspect(
  helper: unknown,
  namespacePath: string,
  operation: "snapshot" | "audit",
  options: Readonly<{
    syntheticFailurePoint?: string;
    timeoutMs?: number;
  }> = {},
): Result<RunningInvocation, M9b13k4bFailure> {
  return launchInvocation(
    helper,
    {
      arguments: [operation, namespacePath],
      input: new Uint8Array(),
      expectedOperation: operation,
    },
    { barrier: true, ...options },
  );
}

export function launchMalformedBarrierM9b13k4bInvocation(
  helper: unknown,
  timeoutMs: number = M9B13K4B_HELPER_TIMEOUT_MS,
): Result<RunningInvocation, M9b13k4bFailure> {
  return launchInvocation(
    helper,
    {
      arguments: ["invalid"],
      input: new Uint8Array(),
      expectedOperation: "snapshot",
    },
    { barrier: true, timeoutMs },
  );
}

export async function inspectMalformedM9b13k4bHelperOutput(
  helper: unknown,
  namespacePath: string,
): Promise<Result<M9b13k4bLedgerReceipt, M9b13k4bFailure>> {
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
