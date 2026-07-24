import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const READ_CHUNK_BYTES = 64 * 1024;

type FileIdentity = Readonly<{
  device: number;
  inode: number;
  size: number;
  modifiedMs: number;
  changedMs: number;
}>;

export type BoundBytes = Readonly<{
  bytes: Uint8Array;
  identity: FileIdentity;
}>;

export type SecureFileHooks = Readonly<{
  beforeReadChunk?:
    ((path: string, offset: number) => Promise<void>) | undefined;
  afterBoundRead?: ((path: string) => Promise<void>) | undefined;
  beforeCommit?: ((path: string) => Promise<void>) | undefined;
}>;

function identity(stat: {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}): FileIdentity {
  return {
    device: stat.dev,
    inode: stat.ino,
    size: stat.size,
    modifiedMs: stat.mtimeMs,
    changedMs: stat.ctimeMs,
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedMs === right.modifiedMs &&
    left.changedMs === right.changedMs
  );
}

function sameObject(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

export async function readBoundedRegularFile(
  path: string,
  limit: number,
  hooks: SecureFileHooks = {},
): Promise<BoundBytes> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const beforeStat = await handle.stat();
    if (!beforeStat.isFile() || beforeStat.size > limit)
      throw new Error("bounded-read-rejected");
    const before = identity(beforeStat);
    const chunks: Array<Uint8Array> = [];
    let total = 0;
    for (;;) {
      await hooks.beforeReadChunk?.(path, total);
      const buffer = new Uint8Array(
        Math.min(READ_CHUNK_BYTES, limit - total + 1),
      );
      const result = await handle.read(buffer, 0, buffer.byteLength, total);
      if (result.bytesRead === 0) break;
      total += result.bytesRead;
      if (total > limit) throw new Error("bounded-read-rejected");
      chunks.push(buffer.subarray(0, result.bytesRead));
    }
    await hooks.afterBoundRead?.(path);
    const afterStat = await handle.stat();
    const after = identity(afterStat);
    if (
      !afterStat.isFile() ||
      total !== before.size ||
      !sameIdentity(before, after)
    )
      throw new Error("file-identity-drift");
    const pathStat = await lstat(path);
    if (pathStat.isSymbolicLink() || !sameIdentity(after, identity(pathStat)))
      throw new Error("file-identity-drift");
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, identity: after };
  } finally {
    await handle.close();
  }
}

function contained(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

async function verifyExistingComponents(
  root: string,
  target: string,
): Promise<void> {
  const child = relative(root, target);
  const parts = child.split(sep).filter((part) => part.length > 0);
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error("unsafe-path");
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return;
      throw error;
    }
  }
}

export async function resolveProjectPath(
  projectRoot: string,
  path: string,
): Promise<Readonly<{ root: string; path: string }>> {
  if (isAbsolute(path) || path === "-") throw new Error("unsafe-path");
  const root = await realpath(projectRoot);
  const candidate = resolve(root, path);
  if (!contained(root, candidate)) throw new Error("unsafe-path");
  await verifyExistingComponents(root, candidate);
  return { root, path: candidate };
}

async function ensureParent(
  root: string,
  target: string,
): Promise<Readonly<{ path: string; identity: FileIdentity }>> {
  const parent = dirname(target);
  const child = relative(root, parent);
  let current = root;
  for (const part of child.split(sep).filter((item) => item.length > 0)) {
    current = resolve(current, part);
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("unsafe-path");
    } catch (error: unknown) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
  const resolved = await realpath(parent);
  if (resolved !== parent || !contained(root, resolved))
    throw new Error("unsafe-path");
  const stat = await lstat(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("unsafe-path");
  return { path: parent, identity: identity(stat) };
}

export async function atomicWriteBounded(
  root: string,
  path: string,
  bytes: Uint8Array,
  limit: number,
  replace: boolean,
  hooks: SecureFileHooks = {},
): Promise<void> {
  if (bytes.byteLength > limit) throw new Error("output-too-large");
  const parent = await ensureParent(root, path);
  let targetIdentity: FileIdentity | undefined;
  try {
    const existing = await lstat(path);
    if (existing.isSymbolicLink() || !existing.isFile() || !replace)
      throw new Error("unsafe-output");
    targetIdentity = identity(existing);
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const temporary = `${path}.lachesis-tmp`;
  const handle = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  let temporaryIdentity: FileIdentity | undefined;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    const temporaryStat = await handle.stat();
    if (!temporaryStat.isFile()) throw new Error("temporary-identity-drift");
    temporaryIdentity = identity(temporaryStat);
  } finally {
    await handle.close();
  }
  try {
    await hooks.beforeCommit?.(path);
    const currentParent = await lstat(parent.path);
    if (
      !currentParent.isDirectory() ||
      currentParent.isSymbolicLink() ||
      !sameObject(parent.identity, identity(currentParent)) ||
      (await realpath(parent.path)) !== parent.path
    )
      throw new Error("parent-identity-drift");
    const temporaryStat = await lstat(temporary);
    if (
      !temporaryStat.isFile() ||
      temporaryStat.isSymbolicLink() ||
      !sameIdentity(temporaryIdentity, identity(temporaryStat))
    )
      throw new Error("temporary-identity-drift");
    if (targetIdentity !== undefined) {
      const currentTarget = await lstat(path);
      if (
        currentTarget.isSymbolicLink() ||
        !sameIdentity(targetIdentity, identity(currentTarget))
      )
        throw new Error("target-identity-drift");
      await rename(temporary, path);
    } else {
      await link(temporary, path);
      await rm(temporary);
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

export function sameBoundIdentity(
  left: BoundBytes,
  right: BoundBytes,
): boolean {
  return (
    sameIdentity(left.identity, right.identity) &&
    left.bytes.byteLength === right.bytes.byteLength &&
    left.bytes.every((byte, index) => right.bytes[index] === byte)
  );
}
