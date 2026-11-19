import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Result } from "@nicia-ai/lachesis";

import { type RegistryError, registryError } from "./errors.js";

export type ProcessOutput = Readonly<{
  status: number;
  stdout: Uint8Array;
  stderr: string;
}>;

export type ProcessOptions = Readonly<{
  cwd: string;
  input?: Uint8Array;
  /** Lets a tool prompt on the terminal, e.g. for an SSH key passphrase. */
  interactive?: boolean;
}>;

const SIGNAL_EXIT_STATUS = -1;

export function runProcess(
  command: string,
  args: ReadonlyArray<string>,
  options: ProcessOptions,
): Promise<Result<ProcessOutput, RegistryError>> {
  return new Promise((resolvePromise) => {
    const interactive = options.interactive === true;
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: interactive
        ? ["inherit", "pipe", "inherit"]
        : ["pipe", "pipe", "pipe"],
    });
    const stdout: Array<Buffer> = [];
    const stderr: Array<Buffer> = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      resolvePromise({
        ok: false,
        error: registryError("TOOL_FAILURE", `${command}: ${error.message}`),
      });
    });
    child.on("close", (status) => {
      resolvePromise({
        ok: true,
        value: {
          status: status ?? SIGNAL_EXIT_STATUS,
          stdout: new Uint8Array(Buffer.concat(stdout)),
          stderr: Buffer.concat(stderr).toString("utf8").trim(),
        },
      });
    });
    if (!interactive) child.stdin?.end(options.input);
  });
}

/** Runs a tool that must exit 0 and returns its stdout. */
export async function runChecked(
  command: string,
  args: ReadonlyArray<string>,
  options: ProcessOptions,
): Promise<Result<Uint8Array, RegistryError>> {
  const output = await runProcess(command, args, options);
  if (!output.ok) return output;
  if (output.value.status !== 0)
    return {
      ok: false,
      error: registryError(
        "TOOL_FAILURE",
        `${command} ${args.slice(0, 2).join(" ")} failed: ${output.value.stderr}`,
      ),
    };
  return { ok: true, value: output.value.stdout };
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Runs `use` with a private temporary directory that is always removed. */
export async function withTemporaryDirectory<T>(
  use: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "lachesis-registry-"));
  try {
    return await use(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
