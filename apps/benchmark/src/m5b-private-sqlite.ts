import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

import { type Diagnostic, diagnostic, type Result } from "@nicia-ai/lachesis";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export const M5B_PRIVATE_SQLITE_POLICY = Object.freeze({
  id: "m5b-private-sqlite",
  version: "1",
  directoryMode: PRIVATE_DIRECTORY_MODE,
  databaseMode: PRIVATE_FILE_MODE,
  creation: "exclusive-no-follow-precreation-before-sqlite-open",
  existingPath:
    "owned-regular-non-symlink-file-with-exact-private-mode-required",
  sidecars: "journal-wal-and-shm-must-be-owned-regular-0600-files",
  processUmaskMutation: "forbidden",
});

export type M5bPrivateSqliteArtifact = Readonly<{
  path: string;
  mode: 384;
}>;

export type M5bPrivateSqliteAudit = Readonly<{
  databasePath: string;
  directoryPath: string;
  artifacts: ReadonlyArray<M5bPrivateSqliteArtifact>;
}>;

function failure(message: string): Diagnostic {
  return diagnostic("INVALID_WIRE_SCHEMA", message);
}

function modeOf(mode: number): number {
  return mode & 0o777;
}

function currentUserId(): Result<number, Diagnostic> {
  const userId = process.getuid?.();
  return userId === undefined
    ? {
        ok: false,
        error: failure(
          "Private SQLite storage requires an operating-system user ID.",
        ),
      }
    : { ok: true, value: userId };
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

async function validatePrivateDirectory(
  path: string,
  userId: number,
): Promise<Result<void, Diagnostic>> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      return {
        ok: false,
        error: failure(
          "Private SQLite parent must be a non-symlink directory.",
        ),
      };
    if (metadata.uid !== userId)
      return {
        ok: false,
        error: failure(
          "Private SQLite parent is not owned by the current user.",
        ),
      };
    if (modeOf(metadata.mode) !== PRIVATE_DIRECTORY_MODE)
      return {
        ok: false,
        error: failure("Private SQLite parent mode must be exactly 0700."),
      };
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    return {
      ok: false,
      error: failure(
        `Private SQLite parent audit failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
}

async function validatePrivateFile(
  path: string,
  userId: number,
): Promise<Result<M5bPrivateSqliteArtifact, Diagnostic>> {
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

export async function prepareM5bPrivateSqlite(
  databasePath: string,
): Promise<Result<M5bPrivateSqliteAudit, Diagnostic>> {
  const userId = currentUserId();
  if (!userId.ok) return userId;
  const directoryPath = dirname(databasePath);
  try {
    await mkdir(directoryPath, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    });
  } catch (error: unknown) {
    return {
      ok: false,
      error: failure(
        `Private SQLite parent creation failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
      ),
    };
  }
  const directory = await validatePrivateDirectory(directoryPath, userId.value);
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
    if (errorCode(error) !== "EEXIST")
      return {
        ok: false,
        error: failure(
          `Private SQLite exclusive creation failed: ${error instanceof Error ? error.name : "unknown-error"}.`,
        ),
      };
  }
  return auditM5bPrivateSqlite(databasePath);
}

export async function auditM5bPrivateSqlite(
  databasePath: string,
): Promise<Result<M5bPrivateSqliteAudit, Diagnostic>> {
  const userId = currentUserId();
  if (!userId.ok) return userId;
  const directoryPath = dirname(databasePath);
  const directory = await validatePrivateDirectory(directoryPath, userId.value);
  if (!directory.ok) return directory;
  const database = await validatePrivateFile(databasePath, userId.value);
  if (!database.ok) return database;
  const artifacts: Array<M5bPrivateSqliteArtifact> = [database.value];
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
    const artifact = await validatePrivateFile(path, userId.value);
    if (!artifact.ok) return artifact;
    artifacts.push(artifact.value);
  }
  return {
    ok: true,
    value: { databasePath, directoryPath, artifacts },
  };
}
