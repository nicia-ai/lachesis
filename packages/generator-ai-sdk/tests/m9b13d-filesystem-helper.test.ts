import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text as readText } from "node:stream/consumers";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { M9B13D_HELPER_EXECUTABLE_SHA256 } from "../internal/m9b13d-synthetic-integration.js";
import { buildM9b13dHelper } from "./m9b13d-fixtures.js";

let suiteRoot = "";
let helperPath = "";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileFrame(
  path: string,
  bytes: Uint8Array,
  digest = sha256(bytes),
): Buffer {
  const header = `FILE ${Buffer.from(path).toString("hex")} ${bytes.byteLength} ${digest}\n`;
  return Buffer.concat([
    Buffer.from(header),
    Buffer.from(bytes),
    Buffer.from("\n"),
  ]);
}

async function caseParent(name: string): Promise<string> {
  const path = join(suiteRoot, name);
  await mkdir(path, { mode: 0o700 });
  return realpath(path);
}

function run(
  parent: string,
  destination: string,
  input: Uint8Array,
  mode = "synthetic",
): Readonly<{ status: number | null; stdout: string; stderr: string }> {
  const result = spawnSync(
    helperPath,
    ["--mode", mode, "--parent", parent, "--destination", destination],
    { input, env: {}, encoding: "utf8" },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function waitForPath(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await lstat(path);
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error(`Timed out waiting for synthetic path: ${path}`);
}

function waitForExit(
  child: ReturnType<typeof spawn>,
): Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

beforeAll(async () => {
  suiteRoot = await realpath(
    await mkdtemp(join(tmpdir(), "m9b13d-helper-suite-")),
  );
  helperPath = join(suiteRoot, "m9b13d-filesystem-helper");
  await buildM9b13dHelper(helperPath);
});

afterAll(async () => {
  if (suiteRoot !== "") await rm(suiteRoot, { recursive: true, force: true });
});

describe("M9b.13d reproducible native helper", () => {
  it("matches the frozen executable identity", async () => {
    expect(sha256(await readFile(helperPath))).toBe(
      M9B13D_HELPER_EXECUTABLE_SHA256,
    );
    const identity = spawnSync(helperPath, ["--identity"], {
      env: {},
      encoding: "utf8",
    });
    expect(identity.status).toBe(0);
    expect(identity.stdout).toBe(
      '{"protocol":"lachesis-m9b13d-race-resistant-filesystem-helper/1","platform":"arm64-apple-darwin25.5.0","network":false}\n',
    );
  });

  it("builds byte-identically in two isolated output directories", async () => {
    const firstDirectory = join(suiteRoot, "reproducible-one");
    const secondDirectory = join(suiteRoot, "reproducible-two");
    await mkdir(firstDirectory, { mode: 0o700 });
    await mkdir(secondDirectory, { mode: 0o700 });
    const first = join(firstDirectory, "m9b13d-filesystem-helper");
    const second = join(secondDirectory, "m9b13d-filesystem-helper");
    await buildM9b13dHelper(first);
    await buildM9b13dHelper(second);
    const firstBytes = await readFile(first);
    const secondBytes = await readFile(second);
    expect(firstBytes.equals(secondBytes)).toBe(true);
    expect(sha256(firstBytes)).toBe(M9B13D_HELPER_EXECUTABLE_SHA256);
  });

  it("performs a descriptor-owned no-clobber write and seal", async () => {
    const parent = await caseParent("success");
    const bytes = new TextEncoder().encode("synthetic-content");
    const result = run(
      parent,
      "output",
      Buffer.concat([
        fileFrame("nested/file.txt", bytes),
        Buffer.from("SEAL\n"),
      ]),
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"status":"sealed"');
    expect(
      await readFile(join(parent, "output", "nested", "file.txt")),
    ).toEqual(Buffer.from(bytes));
    expect(
      await readFile(join(parent, "output", ".m9b13d-sealed"), "utf8"),
    ).toBe("lachesis-m9b13d-sealed/1\n");
  });

  it("rejects a pre-existing destination", async () => {
    const parent = await caseParent("preexisting");
    await mkdir(join(parent, "output"), { mode: 0o700 });
    expect(run(parent, "output", Buffer.from("SEAL\n"))).toMatchObject({
      status: 66,
      stderr: "M9B13D_ERROR m9b13d:destination-already-exists\n",
    });
  });

  it("rejects destination and ancestor symlinks", async () => {
    const parent = await caseParent("symlink");
    await symlink(suiteRoot, join(parent, "output"));
    expect(run(parent, "output", Buffer.from("SEAL\n"))).toMatchObject({
      status: 66,
      stderr: "M9B13D_ERROR m9b13d:destination-already-exists\n",
    });
    const linkParent = join(suiteRoot, "parent-link");
    await symlink(parent, linkParent);
    expect(run(linkParent, "other", Buffer.from("SEAL\n"))).toMatchObject({
      status: 65,
      stderr: "M9B13D_ERROR m9b13d:noncanonical-or-missing-parent\n",
    });
  });

  it("rejects unexpectedly writable ancestors", async () => {
    const parent = await caseParent("permissions");
    await chmod(parent, 0o777);
    expect(run(parent, "output", Buffer.from("SEAL\n"))).toMatchObject({
      status: 65,
      stderr: "M9B13D_ERROR m9b13d:writable-ancestor\n",
    });
  });

  it("detects ancestor replacement while retaining descriptor ownership", async () => {
    const parent = await caseParent("ancestor-race");
    const child = spawn(
      helperPath,
      ["--mode", "synthetic", "--parent", parent, "--destination", "output"],
      { env: {}, stdio: "pipe" },
    );
    await waitForPath(join(parent, "output"));
    const moved = `${parent}-moved`;
    await rename(parent, moved);
    await mkdir(parent, { mode: 0o700 });
    child.stdin.end("SEAL\n");
    expect(await waitForExit(child)).toEqual({ code: 65, signal: null });
  });

  it("detects destination inode replacement", async () => {
    const parent = await caseParent("destination-race");
    const child = spawn(
      helperPath,
      ["--mode", "synthetic", "--parent", parent, "--destination", "output"],
      { env: {}, stdio: "pipe" },
    );
    const output = join(parent, "output");
    await waitForPath(output);
    await rename(output, `${output}-moved`);
    await mkdir(output, { mode: 0o700 });
    child.stdin.end("SEAL\n");
    expect(await waitForExit(child)).toEqual({ code: 65, signal: null });
  });

  it("detects nested file-parent replacement before publication", async () => {
    const parent = await caseParent("nested-parent-race");
    const child = spawn(
      helperPath,
      ["--mode", "synthetic", "--parent", parent, "--destination", "output"],
      { env: {}, stdio: "pipe" },
    );
    const stderr = readText(child.stderr);
    const output = join(parent, "output");
    await waitForPath(output);
    const bytes = Buffer.alloc(100, 1);
    child.stdin.write(
      `FILE ${Buffer.from("nested/file").toString("hex")} ${bytes.byteLength} ${sha256(bytes)}\n`,
    );
    const nested = join(output, "nested");
    await waitForPath(join(nested, ".m9b13d.tmp.1"));
    await rename(nested, `${nested}-moved`);
    await mkdir(nested, { mode: 0o700 });
    child.stdin.end(Buffer.concat([bytes, Buffer.from("\n")]));
    expect(await waitForExit(child)).toEqual({ code: 65, signal: null });
    expect(await stderr).toBe(
      "M9B13D_ERROR m9b13d:file-parent-path-replaced\n",
    );
  });

  it("allows exactly one of genuinely separate concurrent creators", async () => {
    const parent = await caseParent("concurrent");
    const children = Array.from({ length: 6 }, () =>
      spawn(
        helperPath,
        ["--mode", "synthetic", "--parent", parent, "--destination", "output"],
        { env: {}, stdio: "pipe" },
      ),
    );
    for (const child of children) child.stdin.end("SEAL\n");
    const results = await Promise.all(
      children.map((child) => waitForExit(child)),
    );
    expect(results.filter((result) => result.code === 0)).toHaveLength(1);
    expect(results.filter((result) => result.code === 66)).toHaveLength(5);
  });

  it("rejects hard-link aliases and file-to-directory substitutions", async () => {
    const hardlinkParent = await caseParent("hardlink");
    const hardlinkChild = spawn(
      helperPath,
      [
        "--mode",
        "synthetic",
        "--parent",
        hardlinkParent,
        "--destination",
        "output",
      ],
      { env: {}, stdio: "pipe" },
    );
    const hardlinkRoot = join(hardlinkParent, "output");
    await waitForPath(hardlinkRoot);
    const foreign = join(hardlinkParent, "foreign");
    await writeFile(foreign, "foreign", { mode: 0o600 });
    await link(foreign, join(hardlinkRoot, "target"));
    hardlinkChild.stdin.end(
      Buffer.concat([
        fileFrame("target", new Uint8Array([1])),
        Buffer.from("SEAL\n"),
      ]),
    );
    expect(await waitForExit(hardlinkChild)).toEqual({
      code: 66,
      signal: null,
    });

    const directoryParent = await caseParent("directory-substitution");
    const directoryChild = spawn(
      helperPath,
      [
        "--mode",
        "synthetic",
        "--parent",
        directoryParent,
        "--destination",
        "output",
      ],
      { env: {}, stdio: "pipe" },
    );
    const directoryRoot = join(directoryParent, "output");
    await waitForPath(directoryRoot);
    await mkdir(join(directoryRoot, "target"), { mode: 0o700 });
    directoryChild.stdin.end(
      Buffer.concat([
        fileFrame("target", new Uint8Array([1])),
        Buffer.from("SEAL\n"),
      ]),
    );
    expect(await waitForExit(directoryChild)).toEqual({
      code: 66,
      signal: null,
    });
  });

  it("rejects no-follow violations in a file path", async () => {
    const parent = await caseParent("nofollow");
    const child = spawn(
      helperPath,
      ["--mode", "synthetic", "--parent", parent, "--destination", "output"],
      { env: {}, stdio: "pipe" },
    );
    const output = join(parent, "output");
    await waitForPath(output);
    await symlink(suiteRoot, join(output, "escape"));
    child.stdin.end(
      Buffer.concat([
        fileFrame("escape/file", new Uint8Array([1])),
        Buffer.from("SEAL\n"),
      ]),
    );
    expect(await waitForExit(child)).toEqual({ code: 65, signal: null });
  });

  it("retains partial crash state and rejects restart reuse", async () => {
    const parent = await caseParent("crash");
    const child = spawn(
      helperPath,
      ["--mode", "synthetic", "--parent", parent, "--destination", "output"],
      { env: {}, stdio: "pipe" },
    );
    const output = join(parent, "output");
    await waitForPath(output);
    child.stdin.write(
      `FILE ${Buffer.from("partial").toString("hex")} 100 ${"0".repeat(64)}\nxx`,
    );
    await waitForPath(join(output, ".m9b13d.tmp.1"));
    child.kill("SIGKILL");
    expect((await waitForExit(child)).signal).toBe("SIGKILL");
    expect(run(parent, "output", Buffer.from("SEAL\n"))).toMatchObject({
      status: 66,
      stderr: "M9B13D_ERROR m9b13d:destination-already-exists\n",
    });
    expect((await lstat(join(output, ".m9b13d.tmp.1"))).isFile()).toBe(true);
  });

  it("fails closed on partial writes", async () => {
    const parent = await caseParent("partial");
    const input = Buffer.from(
      `FILE ${Buffer.from("partial").toString("hex")} 10 ${"0".repeat(64)}\nxx`,
    );
    expect(run(parent, "output", input)).toMatchObject({
      status: 67,
      stderr: "M9B13D_ERROR m9b13d:partial-input-write\n",
    });
  });

  it("fails closed on synthetic fsync and seal faults", async () => {
    const fsyncParent = await caseParent("fsync-fault");
    const bytes = new Uint8Array([1]);
    expect(
      run(fsyncParent, "output", fileFrame("file", bytes), "synthetic:fsync"),
    ).toMatchObject({
      status: 67,
      stderr: "M9B13D_ERROR m9b13d:file-fsync-failure\n",
    });
    const sealParent = await caseParent("seal-fault");
    expect(
      run(sealParent, "output", Buffer.from("SEAL\n"), "synthetic:seal"),
    ).toMatchObject({
      status: 67,
      stderr: "M9B13D_ERROR m9b13d:seal-failure\n",
    });
  });

  it("rejects post-seal mutation input", async () => {
    const parent = await caseParent("post-seal");
    expect(
      run(parent, "output", Buffer.from("SEAL\nFILE forbidden\n")),
    ).toMatchObject({
      status: 65,
      stderr: "M9B13D_ERROR m9b13d:post-seal-mutation-attempt\n",
    });
  });
});
