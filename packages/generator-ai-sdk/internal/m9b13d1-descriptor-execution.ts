import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { arch, platform, release } from "node:os";

export const M9B13D1_DESCRIPTOR_EXECUTION_PROBE_PROTOCOL =
  "lachesis-m9b13d1-darwin-descriptor-execution-probe/1" as const;

const DARWIN_O_EXEC = 0x40000000;
const PROBE_CHILD_FD = 3;

type DescriptorIdentity = Readonly<{
  device: string;
  inode: string;
  mode: string;
  owner: string;
  links: string;
  size: string;
}>;

type DescriptorAttempt = Readonly<{
  openMode: "read-only" | "execute-only";
  descriptorPath: "/dev/fd/3";
  result: "spawn-error" | "executed";
  errorCode?: string;
  exitCode?: number;
  signal?: NodeJS.Signals;
}>;

export type M9b13d1DescriptorExecutionReceipt = Readonly<{
  protocol: typeof M9B13D1_DESCRIPTOR_EXECUTION_PROBE_PROTOCOL;
  host: Readonly<{
    platform: string;
    release: string;
    architecture: string;
  }>;
  helperSha256: string;
  identity: DescriptorIdentity;
  attempts: readonly [DescriptorAttempt, DescriptorAttempt];
  descriptorExecutionSupported: boolean;
  originalPathFallbackPermitted: false;
}>;

type ProbeResult =
  | Readonly<{ ok: true; value: M9b13d1DescriptorExecutionReceipt }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        kind: "m9b13d1-descriptor-execution-probe-failure";
        reason: string;
      }>;
    }>;

function failure(reason: string): ProbeResult {
  return {
    ok: false,
    error: {
      kind: "m9b13d1-descriptor-execution-probe-failure",
      reason,
    },
  };
}

function identityOf(fd: number): DescriptorIdentity {
  const metadata = fstatSync(fd, { bigint: true });
  return {
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    mode: metadata.mode.toString(8),
    owner: metadata.uid.toString(),
    links: metadata.nlink.toString(),
    size: metadata.size.toString(),
  };
}

function sameIdentity(
  left: DescriptorIdentity,
  right: DescriptorIdentity,
): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.owner === right.owner &&
    left.links === right.links &&
    left.size === right.size
  );
}

function digestDescriptor(fd: number): string {
  const digest = createHash("sha256");
  const buffer = Buffer.alloc(65_536);
  let offset = 0;
  for (;;) {
    const bytesRead = readSync(fd, buffer, 0, buffer.byteLength, offset);
    if (bytesRead === 0) break;
    digest.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return digest.digest("hex");
}

function errorCode(error: Error | undefined): string | undefined {
  if (error !== undefined && "code" in error && typeof error.code === "string")
    return error.code;
  return undefined;
}

function attemptDescriptorExecution(
  fd: number,
  openMode: DescriptorAttempt["openMode"],
): DescriptorAttempt {
  const child = spawnSync("/dev/fd/3", ["--identity"], {
    env: {},
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe", fd],
  });
  const code = errorCode(child.error);
  if (child.error !== undefined) {
    return {
      openMode,
      descriptorPath: `/dev/fd/${PROBE_CHILD_FD}`,
      result: "spawn-error",
      ...(code === undefined ? {} : { errorCode: code }),
    };
  }
  return {
    openMode,
    descriptorPath: `/dev/fd/${PROBE_CHILD_FD}`,
    result: "executed",
    ...(child.status === null ? {} : { exitCode: child.status }),
    ...(child.signal === null ? {} : { signal: child.signal }),
  };
}

export function probeM9b13d1HelperDescriptorExecution(
  helperPath: string,
): ProbeResult {
  let readFd = -1;
  let executeFd = -1;
  try {
    readFd = openSync(helperPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const readIdentityBefore = identityOf(readFd);
    if ((BigInt(`0o${readIdentityBefore.mode}`) & 0o170000n) !== 0o100000n)
      return failure("m9b13d1:helper-not-regular-file");
    const helperSha256 = digestDescriptor(readFd);
    const readIdentityAfter = identityOf(readFd);
    if (!sameIdentity(readIdentityBefore, readIdentityAfter))
      return failure("m9b13d1:read-descriptor-identity-changed");

    executeFd = openSync(helperPath, DARWIN_O_EXEC | constants.O_NOFOLLOW);
    const executeIdentity = identityOf(executeFd);
    if (!sameIdentity(readIdentityAfter, executeIdentity))
      return failure("m9b13d1:read-execute-descriptor-identity-mismatch");

    const readAttempt = attemptDescriptorExecution(readFd, "read-only");
    const executeAttempt = attemptDescriptorExecution(
      executeFd,
      "execute-only",
    );
    return {
      ok: true,
      value: {
        protocol: M9B13D1_DESCRIPTOR_EXECUTION_PROBE_PROTOCOL,
        host: {
          platform: platform(),
          release: release(),
          architecture: arch(),
        },
        helperSha256,
        identity: readIdentityAfter,
        attempts: [readAttempt, executeAttempt],
        descriptorExecutionSupported:
          readAttempt.result === "executed" ||
          executeAttempt.result === "executed",
        originalPathFallbackPermitted: false,
      },
    };
  } catch {
    return failure("m9b13d1:descriptor-probe-io-failure");
  } finally {
    if (executeFd >= 0) closeSync(executeFd);
    if (readFd >= 0) closeSync(readFd);
  }
}
