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

export type AtomicPairHooks = SecureFileHooks &
  Readonly<{
    beforePairStage?:
      | ((role: "artifact" | "report", path: string) => Promise<void>)
      | undefined;
    afterPairStage?:
      | ((role: "artifact" | "report", path: string) => Promise<void>)
      | undefined;
    beforeArtifactInstall?: ((path: string) => Promise<void>) | undefined;
    afterArtifactInstall?: ((path: string) => Promise<void>) | undefined;
    beforeReportInstall?: ((path: string) => Promise<void>) | undefined;
    afterReportInstall?: ((path: string) => Promise<void>) | undefined;
    beforePairRollback?: (() => Promise<void>) | undefined;
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

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

type TargetSnapshot = Readonly<{
  bound: BoundBytes | null;
}>;

type StagedWrite = Readonly<{
  root: string;
  path: string;
  parent: Readonly<{ path: string; identity: FileIdentity }>;
  temporary: string;
  staged: BoundBytes;
  original: TargetSnapshot;
}>;

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function snapshotTarget(
  path: string,
  limit: number,
  replace: boolean,
): Promise<TargetSnapshot> {
  try {
    const bound = await readBoundedRegularFile(path, limit);
    if (!replace) throw new Error("unsafe-output");
    return { bound };
  } catch (error: unknown) {
    if (missing(error)) return { bound: null };
    throw new Error("transaction-commit-incomplete", { cause: error });
  }
}

async function verifyParent(
  parent: Readonly<{ path: string; identity: FileIdentity }>,
): Promise<void> {
  const current = await lstat(parent.path);
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    !sameObject(parent.identity, identity(current)) ||
    (await realpath(parent.path)) !== parent.path
  )
    throw new Error("parent-identity-drift");
}

async function verifyTargetSnapshot(
  path: string,
  snapshot: TargetSnapshot,
  limit: number,
): Promise<void> {
  if (snapshot.bound === null) {
    try {
      await lstat(path);
      throw new Error("target-identity-drift");
    } catch (error: unknown) {
      if (missing(error)) return;
      throw error;
    }
  }
  const current = await readBoundedRegularFile(path, limit);
  if (!sameBoundIdentity(snapshot.bound, current))
    throw new Error("target-identity-drift");
}

async function stageWrite(
  root: string,
  path: string,
  bytes: Uint8Array,
  limit: number,
  replace: boolean,
  role: "artifact" | "report",
  hooks: AtomicPairHooks,
): Promise<StagedWrite> {
  if (bytes.byteLength > limit) throw new Error("output-too-large");
  const parent = await ensureParent(root, path);
  const original = await snapshotTarget(path, limit, replace);
  const temporary = `${path}.lachesis-${role}-txn`;
  await hooks.beforePairStage?.(role, path);
  const handle = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const staged = await readBoundedRegularFile(temporary, limit);
  if (
    staged.bytes.byteLength !== bytes.byteLength ||
    !staged.bytes.every((byte, index) => bytes[index] === byte)
  )
    throw new Error("temporary-identity-drift");
  await hooks.afterPairStage?.(role, path);
  return { root, path, parent, temporary, staged, original };
}

async function installStaged(
  write: StagedWrite,
  limit: number,
): Promise<BoundBytes> {
  await verifyParent(write.parent);
  await verifyTargetSnapshot(write.path, write.original, limit);
  const staged = await readBoundedRegularFile(write.temporary, limit);
  if (!sameBoundIdentity(write.staged, staged))
    throw new Error("temporary-identity-drift");
  if (write.original.bound === null) {
    await link(write.temporary, write.path);
    await rm(write.temporary);
  } else {
    await rename(write.temporary, write.path);
  }
  await syncDirectory(write.parent.path);
  const installed = await readBoundedRegularFile(write.path, limit);
  if (
    installed.bytes.byteLength !== write.staged.bytes.byteLength ||
    !installed.bytes.every((byte, index) => write.staged.bytes[index] === byte)
  )
    throw new Error("target-identity-drift");
  return installed;
}

async function restoreTarget(
  write: StagedWrite,
  installed: BoundBytes,
  limit: number,
): Promise<void> {
  await verifyParent(write.parent);
  const current = await readBoundedRegularFile(write.path, limit);
  if (!sameBoundIdentity(installed, current))
    throw new Error("target-identity-drift");
  if (write.original.bound === null) {
    await rm(write.path);
    await syncDirectory(write.parent.path);
    try {
      await lstat(write.path);
      throw new Error("target-identity-drift");
    } catch (error: unknown) {
      if (!missing(error)) throw error;
    }
    return;
  }
  const rollback = `${write.path}.lachesis-rollback-txn`;
  const handle = await open(
    rollback,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(write.original.bound.bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    const rollbackBytes = await readBoundedRegularFile(rollback, limit);
    if (
      rollbackBytes.bytes.byteLength !==
        write.original.bound.bytes.byteLength ||
      !rollbackBytes.bytes.every(
        (byte, index) => write.original.bound?.bytes[index] === byte,
      )
    )
      throw new Error("temporary-identity-drift");
    await verifyParent(write.parent);
    const beforeRename = await readBoundedRegularFile(write.path, limit);
    if (!sameBoundIdentity(installed, beforeRename))
      throw new Error("target-identity-drift");
    await rename(rollback, write.path);
    await syncDirectory(write.parent.path);
    const restored = await readBoundedRegularFile(write.path, limit);
    if (
      restored.bytes.byteLength !== write.original.bound.bytes.byteLength ||
      !restored.bytes.every(
        (byte, index) => write.original.bound?.bytes[index] === byte,
      )
    )
      throw new Error("target-identity-drift");
  } finally {
    await rm(rollback, { force: true });
  }
}

async function detectInstalledTarget(
  write: StagedWrite,
  limit: number,
): Promise<BoundBytes | undefined> {
  let current: BoundBytes;
  try {
    current = await readBoundedRegularFile(write.path, limit);
  } catch (error: unknown) {
    if (missing(error) && write.original.bound === null) return undefined;
    throw error;
  }
  if (
    write.original.bound !== null &&
    sameBoundIdentity(write.original.bound, current)
  )
    return undefined;
  if (
    current.bytes.byteLength === write.staged.bytes.byteLength &&
    current.bytes.every((byte, index) => write.staged.bytes[index] === byte)
  )
    return current;
  throw new Error("target-identity-drift");
}

export async function atomicWritePairBounded(
  artifact: Readonly<{
    root: string;
    path: string;
    bytes: Uint8Array;
    limit: number;
  }>,
  report: Readonly<{
    root: string;
    path: string;
    bytes: Uint8Array;
    limit: number;
  }>,
  replace: boolean,
  hooks: AtomicPairHooks = {},
): Promise<void> {
  let artifactWrite: StagedWrite | undefined;
  let reportWrite: StagedWrite | undefined;
  let installedArtifact: BoundBytes | undefined;
  let installedReport: BoundBytes | undefined;
  try {
    artifactWrite = await stageWrite(
      artifact.root,
      artifact.path,
      artifact.bytes,
      artifact.limit,
      replace,
      "artifact",
      hooks,
    );
    reportWrite = await stageWrite(
      report.root,
      report.path,
      report.bytes,
      report.limit,
      replace,
      "report",
      hooks,
    );
    await hooks.beforeArtifactInstall?.(artifact.path);
    installedArtifact = await installStaged(artifactWrite, artifact.limit);
    await hooks.afterArtifactInstall?.(artifact.path);
    await hooks.beforeReportInstall?.(report.path);
    installedReport = await installStaged(reportWrite, report.limit);
    await hooks.afterReportInstall?.(report.path);
    const [verifiedArtifact, verifiedReport] = await Promise.all([
      readBoundedRegularFile(artifact.path, artifact.limit),
      readBoundedRegularFile(report.path, report.limit),
    ]);
    if (
      !sameBoundIdentity(installedArtifact, verifiedArtifact) ||
      !sameBoundIdentity(installedReport, verifiedReport)
    )
      throw new Error("target-identity-drift");
  } catch (error: unknown) {
    try {
      if (installedReport === undefined && reportWrite !== undefined)
        installedReport = await detectInstalledTarget(
          reportWrite,
          report.limit,
        );
      if (installedArtifact === undefined && artifactWrite !== undefined)
        installedArtifact = await detectInstalledTarget(
          artifactWrite,
          artifact.limit,
        );
    } catch {
      throw new Error("transaction-rollback-failed");
    }
    if (installedArtifact !== undefined || installedReport !== undefined) {
      try {
        await hooks.beforePairRollback?.();
        if (installedReport !== undefined && reportWrite !== undefined)
          await restoreTarget(reportWrite, installedReport, report.limit);
        if (installedArtifact !== undefined && artifactWrite !== undefined)
          await restoreTarget(artifactWrite, installedArtifact, artifact.limit);
      } catch {
        throw new Error("transaction-rollback-failed");
      }
      throw new Error("transaction-commit-incomplete", { cause: error });
    }
    throw new Error("transaction-commit-incomplete", { cause: error });
  } finally {
    if (artifactWrite !== undefined)
      await rm(artifactWrite.temporary, { force: true });
    if (reportWrite !== undefined)
      await rm(reportWrite.temporary, { force: true });
  }
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
