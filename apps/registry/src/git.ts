import type { Result } from "@nicia-ai/lachesis";

import { type RegistryError, registryError } from "./errors.js";
import { decodeText, runChecked, runProcess } from "./process.js";

const GIT_SUCCESS = 0;
const GIT_NOT_ANCESTOR = 1;

export type Repository = Readonly<{ root: string }>;

export type TreeItem = Readonly<{ name: string; type: "blob" | "tree" }>;

export async function openRepository(
  cwd: string,
): Promise<Result<Repository, RegistryError>> {
  const root = await runChecked("git", ["rev-parse", "--show-toplevel"], {
    cwd,
  });
  if (!root.ok) return root;
  return { ok: true, value: { root: decodeText(root.value).trim() } };
}

export function git(
  repository: Repository,
  args: ReadonlyArray<string>,
): Promise<Result<Uint8Array, RegistryError>> {
  return runChecked("git", args, { cwd: repository.root });
}

export async function resolveCommit(
  repository: Repository,
  revision: string,
): Promise<Result<string, RegistryError>> {
  const commit = await git(repository, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${revision}^{commit}`,
  ]);
  if (!commit.ok)
    return {
      ok: false,
      error: registryError(
        "CONTENT_MISMATCH",
        `Commit ${revision} does not exist.`,
      ),
    };
  return { ok: true, value: decodeText(commit.value).trim() };
}

/** Returns the blob at `revision:path`, or undefined when it does not exist. */
export async function readBlob(
  repository: Repository,
  revision: string,
  path: string,
): Promise<Uint8Array | undefined> {
  const output = await runProcess(
    "git",
    ["cat-file", "blob", `${revision}:${path}`],
    { cwd: repository.root },
  );
  return output.ok && output.value.status === GIT_SUCCESS
    ? output.value.stdout
    : undefined;
}

export async function listTree(
  repository: Repository,
  revision: string,
  directory: string,
): Promise<Result<ReadonlyArray<TreeItem>, RegistryError>> {
  const listing = await git(repository, [
    "ls-tree",
    "-z",
    revision,
    `${directory}/`,
  ]);
  if (!listing.ok) return listing;
  const items: Array<TreeItem> = [];
  for (const record of decodeText(listing.value).split("\0")) {
    const match = /^\d+ (blob|tree) [a-f0-9]+\t(.+)$/.exec(record);
    const type = match?.[1];
    const path = match?.[2];
    if ((type === "blob" || type === "tree") && path !== undefined)
      items.push({ name: path.slice(directory.length + 1), type });
  }
  return { ok: true, value: items };
}

export async function isAncestor(
  repository: Repository,
  ancestor: string,
  descendant: string,
): Promise<Result<boolean, RegistryError>> {
  const output = await runProcess(
    "git",
    ["merge-base", "--is-ancestor", ancestor, descendant],
    { cwd: repository.root },
  );
  if (!output.ok) return output;
  if (output.value.status === GIT_SUCCESS) return { ok: true, value: true };
  if (output.value.status === GIT_NOT_ANCESTOR)
    return { ok: true, value: false };
  return {
    ok: false,
    error: registryError("TOOL_FAILURE", output.value.stderr),
  };
}

/** Paths under `directory` that any commit reachable from `revision` modified, deleted or renamed. */
export async function rewrittenPaths(
  repository: Repository,
  revision: string,
  directory: string,
): Promise<Result<ReadonlyArray<string>, RegistryError>> {
  const log = await git(repository, [
    "log",
    "--format=",
    "--name-only",
    "--no-renames",
    "--diff-merges=separate",
    "--diff-filter=DMT",
    revision,
    "--",
    directory,
  ]);
  if (!log.ok) return log;
  const paths = decodeText(log.value)
    .split("\n")
    .filter((line) => line.length > 0);
  return { ok: true, value: [...new Set(paths)] };
}

export async function isIndexClean(
  repository: Repository,
): Promise<Result<boolean, RegistryError>> {
  const output = await runProcess("git", ["diff", "--cached", "--quiet"], {
    cwd: repository.root,
  });
  if (!output.ok) return output;
  return { ok: true, value: output.value.status === GIT_SUCCESS };
}

export async function isTracked(
  repository: Repository,
  path: string,
): Promise<Result<boolean, RegistryError>> {
  const output = await runProcess(
    "git",
    ["ls-files", "--error-unmatch", "--", path],
    { cwd: repository.root },
  );
  if (!output.ok) return output;
  return { ok: true, value: output.value.status === GIT_SUCCESS };
}

/** Fetches a witness branch without creating refs and returns its commit. */
export async function fetchBranch(
  repository: Repository,
  url: string,
  branch: string,
): Promise<Result<string, RegistryError>> {
  const fetched = await git(repository, [
    "fetch",
    "--quiet",
    "--no-tags",
    url,
    `refs/heads/${branch}`,
  ]);
  if (!fetched.ok) return fetched;
  return resolveCommit(repository, "FETCH_HEAD");
}
