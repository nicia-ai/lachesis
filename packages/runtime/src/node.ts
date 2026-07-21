import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { canonicalizeJson, parseJson, type Result } from "@nicia-ai/lachesis";
import {
  type M5RecordingStore,
  type M5ReplayArtifact,
  m5ReplayArtifactSchema,
  type M5RuntimeFailure,
} from "@nicia-ai/lachesis-evidence";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const TEMP_PATTERN = /^[a-f0-9]{64}\.tmp-[a-f0-9-]{36}$/u;

export const PRIVATE_RECORDING_STORE_POLICY = Object.freeze({
  id: "lachesis-private-recording-store",
  version: "1",
  directoryMode: PRIVATE_DIRECTORY_MODE,
  artifactMode: PRIVATE_FILE_MODE,
  maximumArtifactBytesDefault: 4 * 1024 * 1024,
  staleTemporaryFileMsDefault: 5 * 60 * 1_000,
  writes: "exclusive-temporary-file-fsync-atomic-hard-link-directory-fsync",
  locks: "lock-free-content-addressed-commit",
});

export type PrivateRecordingArtifactAudit = Readonly<{
  path: string;
  kind: "artifact" | "temporary";
  mode: 384;
  size: number;
}>;

export type PrivateRecordingStoreAudit = Readonly<{
  root: string;
  directoryMode: 448;
  artifacts: ReadonlyArray<PrivateRecordingArtifactAudit>;
}>;

export type PrivateFileRecordingStore = Readonly<{
  root: string;
  store: M5RecordingStore;
  audit: () => Promise<Result<PrivateRecordingStoreAudit, M5RuntimeFailure>>;
}>;

export type PrivateSqliteArtifactAudit = Readonly<{
  path: string;
  mode: 384;
}>;

export type PrivateSqliteAudit = Readonly<{
  databasePath: string;
  directoryPath: string;
  artifacts: ReadonlyArray<PrivateSqliteArtifactAudit>;
}>;

type PrivateStoreOptions = Readonly<{
  root: string;
  maximumArtifactBytes?: number | undefined;
  staleTemporaryFileMs?: number | undefined;
  now?: (() => number) | undefined;
}>;

function failure(message: string): M5RuntimeFailure {
  return {
    code: "RECORDING_FAILED",
    stage: "recording",
    message,
    issues: [],
  };
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function modeOf(mode: number): number {
  return mode & 0o777;
}

function currentUserId(): Result<number, M5RuntimeFailure> {
  const userId = process.getuid?.();
  return userId === undefined
    ? {
        ok: false,
        error: failure(
          "Private recording storage requires an operating-system user ID.",
        ),
      }
    : { ok: true, value: userId };
}

async function validateDirectory(
  root: string,
  userId: number,
): Promise<Result<void, M5RuntimeFailure>> {
  try {
    const metadata = await lstat(root);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      return {
        ok: false,
        error: failure(
          "Private recording root must be a non-symlink directory.",
        ),
      };
    if (metadata.uid !== userId)
      return {
        ok: false,
        error: failure(
          "Private recording root is not owned by the current user.",
        ),
      };
    if (modeOf(metadata.mode) !== PRIVATE_DIRECTORY_MODE)
      return {
        ok: false,
        error: failure("Private recording root mode must be exactly 0700."),
      };
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    return {
      ok: false,
      error: failure(
        `Private recording root audit failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
}

async function validateArtifact(
  path: string,
  kind: PrivateRecordingArtifactAudit["kind"],
  userId: number,
  maximumArtifactBytes: number,
): Promise<Result<PrivateRecordingArtifactAudit, M5RuntimeFailure>> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile())
      return {
        ok: false,
        error: failure(
          "Private recording artifact must be a non-symlink regular file.",
        ),
      };
    if (metadata.uid !== userId)
      return {
        ok: false,
        error: failure(
          "Private recording artifact is not owned by the current user.",
        ),
      };
    if (modeOf(metadata.mode) !== PRIVATE_FILE_MODE)
      return {
        ok: false,
        error: failure("Private recording artifact mode must be exactly 0600."),
      };
    if (metadata.size > maximumArtifactBytes)
      return {
        ok: false,
        error: failure("Private recording artifact exceeds its byte limit."),
      };
    return {
      ok: true,
      value: { path, kind, mode: PRIVATE_FILE_MODE, size: metadata.size },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: failure(
        `Private recording artifact audit failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
}

async function validateSqliteArtifact(
  path: string,
  userId: number,
): Promise<Result<PrivateSqliteArtifactAudit, M5RuntimeFailure>> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile())
      return {
        ok: false,
        error: failure(
          "Private SQLite artifact must be a non-symlink regular file.",
        ),
      };
    if (metadata.uid !== userId)
      return {
        ok: false,
        error: failure(
          "Private SQLite artifact is not owned by the current user.",
        ),
      };
    if (modeOf(metadata.mode) !== PRIVATE_FILE_MODE)
      return {
        ok: false,
        error: failure("Private SQLite artifact mode must be exactly 0600."),
      };
    return { ok: true, value: { path, mode: PRIVATE_FILE_MODE } };
  } catch (error: unknown) {
    return {
      ok: false,
      error: failure(
        `Private SQLite artifact audit failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
}

async function syncDirectory(
  root: string,
): Promise<Result<void, M5RuntimeFailure>> {
  try {
    const handle = await open(root, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    return {
      ok: false,
      error: failure(
        `Private recording directory sync failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
}

async function readArtifact(
  path: string,
  userId: number,
  maximumArtifactBytes: number,
): Promise<Result<M5ReplayArtifact | undefined, M5RuntimeFailure>> {
  try {
    try {
      await lstat(path);
    } catch (error: unknown) {
      if (errorCode(error) === "ENOENT") return { ok: true, value: undefined };
      throw error;
    }
    const audited = await validateArtifact(
      path,
      "artifact",
      userId,
      maximumArtifactBytes,
    );
    if (!audited.ok) return audited;
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      const named = await lstat(path);
      if (
        opened.dev !== named.dev ||
        opened.ino !== named.ino ||
        opened.uid !== userId ||
        modeOf(opened.mode) !== PRIVATE_FILE_MODE ||
        opened.size > maximumArtifactBytes
      )
        return {
          ok: false,
          error: failure(
            "Private recording artifact changed during its permission audit.",
          ),
        };
      const text = await handle.readFile({ encoding: "utf8" });
      const json = parseJson(text);
      if (!json.ok)
        return {
          ok: false,
          error: failure("Private recording artifact is not valid JSON."),
        };
      const parsed = m5ReplayArtifactSchema.safeParse(json.value);
      return parsed.success
        ? { ok: true, value: parsed.data }
        : {
            ok: false,
            error: failure(
              "Private recording artifact failed the replay schema.",
            ),
          };
    } finally {
      await handle.close();
    }
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return { ok: true, value: undefined };
    return {
      ok: false,
      error: failure(
        `Private recording read failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
}

async function cleanupStaleTemporaryFiles(
  root: string,
  userId: number,
  maximumArtifactBytes: number,
  staleTemporaryFileMs: number,
  now: () => number,
): Promise<Result<void, M5RuntimeFailure>> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!TEMP_PATTERN.test(entry.name)) continue;
      const path = join(root, entry.name);
      const audited = await validateArtifact(
        path,
        "temporary",
        userId,
        maximumArtifactBytes,
      );
      if (!audited.ok) return audited;
      const metadata = await lstat(path);
      if (now() - metadata.mtimeMs < staleTemporaryFileMs) continue;
      await unlink(path);
    }
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    return {
      ok: false,
      error: failure(
        `Private recording recovery failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
}

async function auditStore(
  root: string,
  userId: number,
  maximumArtifactBytes: number,
): Promise<Result<PrivateRecordingStoreAudit, M5RuntimeFailure>> {
  const directory = await validateDirectory(root, userId);
  if (!directory.ok) return directory;
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const artifacts: Array<PrivateRecordingArtifactAudit> = [];
    for (const entry of entries.toSorted((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const kind = entry.name.endsWith(".json")
        ? "artifact"
        : TEMP_PATTERN.test(entry.name)
          ? "temporary"
          : undefined;
      if (kind === undefined)
        return {
          ok: false,
          error: failure(
            "Private recording root contains an unknown artifact.",
          ),
        };
      const expectedName =
        kind === "artifact" && DIGEST_PATTERN.test(entry.name.slice(0, -5));
      if (kind === "artifact" && !expectedName)
        return {
          ok: false,
          error: failure("Private recording artifact name is not a digest."),
        };
      const audited = await validateArtifact(
        join(root, entry.name),
        kind,
        userId,
        maximumArtifactBytes,
      );
      if (!audited.ok) return audited;
      artifacts.push(audited.value);
    }
    return {
      ok: true,
      value: {
        root,
        directoryMode: PRIVATE_DIRECTORY_MODE,
        artifacts,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: failure(
        `Private recording store audit failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
}

async function saveArtifact(
  root: string,
  artifact: M5ReplayArtifact,
  signal: AbortSignal,
  userId: number,
  maximumArtifactBytes: number,
): Promise<Result<void, M5RuntimeFailure>> {
  if (signal.aborted)
    return {
      ok: false,
      error: { ...failure("Recording was cancelled."), code: "CANCELLED" },
    };
  const parsed = m5ReplayArtifactSchema.safeParse(artifact);
  if (!parsed.success)
    return {
      ok: false,
      error: failure("Replay artifact failed validation before persistence."),
    };
  const canonical = canonicalizeJson(parsed.data);
  if (!canonical.ok)
    return {
      ok: false,
      error: failure("Replay artifact could not be serialized canonically."),
    };
  const bytes = new TextEncoder().encode(canonical.value).byteLength;
  if (bytes > maximumArtifactBytes)
    return {
      ok: false,
      error: failure("Replay artifact exceeds the recording byte limit."),
    };
  const directory = await validateDirectory(root, userId);
  if (!directory.ok) return directory;
  const target = join(root, `${parsed.data.artifactDigest}.json`);
  const temporary = join(
    root,
    `${parsed.data.artifactDigest}.tmp-${randomUUID()}`,
  );
  try {
    const handle = await open(
      temporary,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
    try {
      await handle.writeFile(canonical.value, { encoding: "utf8" });
      await handle.sync();
    } finally {
      await handle.close();
    }
    const temporaryAudit = await validateArtifact(
      temporary,
      "temporary",
      userId,
      maximumArtifactBytes,
    );
    if (!temporaryAudit.ok) return temporaryAudit;
    try {
      await link(temporary, target);
    } catch (error: unknown) {
      if (errorCode(error) !== "EEXIST") throw error;
      const existing = await readArtifact(target, userId, maximumArtifactBytes);
      if (
        !existing.ok ||
        existing.value?.artifactDigest !== parsed.data.artifactDigest
      )
        return existing.ok
          ? {
              ok: false,
              error: failure(
                "A conflicting content-addressed replay artifact already exists.",
              ),
            }
          : existing;
    }
    const targetAudit = await validateArtifact(
      target,
      "artifact",
      userId,
      maximumArtifactBytes,
    );
    if (!targetAudit.ok) return targetAudit;
    const synced = await syncDirectory(root);
    if (!synced.ok) return synced;
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    return {
      ok: false,
      error: failure(
        `Private recording write failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  } finally {
    try {
      await unlink(temporary);
    } catch (error: unknown) {
      if (errorCode(error) !== "ENOENT") void error;
    }
  }
}

export async function createPrivateFileRecordingStore(
  options: PrivateStoreOptions,
): Promise<Result<PrivateFileRecordingStore, M5RuntimeFailure>> {
  const userId = currentUserId();
  if (!userId.ok) return userId;
  if (!isAbsolute(options.root) || resolve(options.root) !== options.root)
    return {
      ok: false,
      error: failure(
        "Private recording root must be an absolute normalized path.",
      ),
    };
  const maximumArtifactBytes =
    options.maximumArtifactBytes ??
    PRIVATE_RECORDING_STORE_POLICY.maximumArtifactBytesDefault;
  const staleTemporaryFileMs =
    options.staleTemporaryFileMs ??
    PRIVATE_RECORDING_STORE_POLICY.staleTemporaryFileMsDefault;
  if (
    !Number.isSafeInteger(maximumArtifactBytes) ||
    maximumArtifactBytes <= 0 ||
    !Number.isSafeInteger(staleTemporaryFileMs) ||
    staleTemporaryFileMs < 0
  )
    return {
      ok: false,
      error: failure("Private recording limits are invalid."),
    };
  try {
    try {
      const existing = await lstat(options.root);
      if (existing.isSymbolicLink())
        return {
          ok: false,
          error: failure("Private recording root cannot be a symbolic link."),
        };
    } catch (error: unknown) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    await mkdir(options.root, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    });
    const canonicalRoot = await realpath(options.root);
    const expectedCanonicalRoot = join(
      await realpath(dirname(options.root)),
      basename(options.root),
    );
    if (canonicalRoot !== expectedCanonicalRoot)
      return {
        ok: false,
        error: failure(
          "Private recording root resolves through a symbolic link.",
        ),
      };
    const directory = await validateDirectory(canonicalRoot, userId.value);
    if (!directory.ok) return directory;
    const recovered = await cleanupStaleTemporaryFiles(
      canonicalRoot,
      userId.value,
      maximumArtifactBytes,
      staleTemporaryFileMs,
      options.now ?? Date.now,
    );
    if (!recovered.ok) return recovered;
    const initialAudit = await auditStore(
      canonicalRoot,
      userId.value,
      maximumArtifactBytes,
    );
    if (!initialAudit.ok) return initialAudit;
    const store: M5RecordingStore = {
      load: async (artifactDigest, signal) => {
        if (signal.aborted)
          return {
            ok: false,
            error: { ...failure("Replay was cancelled."), code: "CANCELLED" },
          };
        if (!DIGEST_PATTERN.test(artifactDigest))
          return {
            ok: false,
            error: failure("Replay artifact identity is invalid."),
          };
        const directoryAudit = await validateDirectory(
          canonicalRoot,
          userId.value,
        );
        return directoryAudit.ok
          ? readArtifact(
              join(canonicalRoot, `${artifactDigest}.json`),
              userId.value,
              maximumArtifactBytes,
            )
          : directoryAudit;
      },
      save: (artifact, signal) =>
        saveArtifact(
          canonicalRoot,
          artifact,
          signal,
          userId.value,
          maximumArtifactBytes,
        ),
    };
    return {
      ok: true,
      value: {
        root: canonicalRoot,
        store,
        audit: () =>
          auditStore(canonicalRoot, userId.value, maximumArtifactBytes),
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: failure(
        `Private recording store initialization failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
}

export async function auditPrivateSqliteFile(
  databasePath: string,
): Promise<Result<PrivateSqliteAudit, M5RuntimeFailure>> {
  const userId = currentUserId();
  if (!userId.ok) return userId;
  if (!isAbsolute(databasePath) || resolve(databasePath) !== databasePath)
    return {
      ok: false,
      error: failure("Private SQLite path must be absolute and normalized."),
    };
  const directoryPath = dirname(databasePath);
  const directory = await validateDirectory(directoryPath, userId.value);
  if (!directory.ok) return directory;
  const database = await validateSqliteArtifact(databasePath, userId.value);
  if (!database.ok) return database;
  const artifacts: Array<PrivateSqliteArtifactAudit> = [database.value];
  for (const suffix of ["-journal", "-wal", "-shm"] as const) {
    const path = `${databasePath}${suffix}`;
    try {
      await lstat(path);
    } catch (error: unknown) {
      if (errorCode(error) === "ENOENT") continue;
      return {
        ok: false,
        error: failure(
          `Private SQLite sidecar discovery failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
        ),
      };
    }
    const artifact = await validateSqliteArtifact(path, userId.value);
    if (!artifact.ok) return artifact;
    artifacts.push(artifact.value);
  }
  return {
    ok: true,
    value: { databasePath, directoryPath, artifacts },
  };
}

export async function preparePrivateSqliteFile(
  databasePath: string,
): Promise<Result<PrivateSqliteAudit, M5RuntimeFailure>> {
  const userId = currentUserId();
  if (!userId.ok) return userId;
  if (!isAbsolute(databasePath) || resolve(databasePath) !== databasePath)
    return {
      ok: false,
      error: failure("Private SQLite path must be absolute and normalized."),
    };
  const directoryPath = dirname(databasePath);
  try {
    try {
      const existing = await lstat(databasePath);
      if (existing.isSymbolicLink())
        return {
          ok: false,
          error: failure("Private SQLite database cannot be a symbolic link."),
        };
    } catch (error: unknown) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    await mkdir(directoryPath, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    });
    const directory = await validateDirectory(directoryPath, userId.value);
    if (!directory.ok) return directory;
    try {
      const handle = await open(
        databasePath,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_RDWR |
          constants.O_NOFOLLOW,
        PRIVATE_FILE_MODE,
      );
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error: unknown) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    return await auditPrivateSqliteFile(databasePath);
  } catch (error: unknown) {
    return {
      ok: false,
      error: failure(
        `Private SQLite preparation failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
}
