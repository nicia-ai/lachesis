import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { M9B13D_HELPER_EXECUTABLE_SHA256 } from "../internal/m9b13d-synthetic-integration.js";
import { probeM9b13d1HelperDescriptorExecution } from "../internal/m9b13d1-descriptor-execution.js";
import { buildM9b13dHelper } from "./m9b13d-fixtures.js";

const DARWIN_O_EXEC = 0x40000000;
const O_NOFOLLOW = 0x00000100;
const HOSTILE_REPETITIONS = 32;

let suiteRoot = "";
let helperPath = "";

function descriptorSpawn(fd: number): ReturnType<typeof spawnSync> {
  return spawnSync("/dev/fd/3", ["--identity"], {
    env: {},
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe", fd],
  });
}

function errorCode(error: Error | undefined): string | undefined {
  if (error !== undefined && "code" in error && typeof error.code === "string")
    return error.code;
  return undefined;
}

beforeAll(async () => {
  suiteRoot = await realpath(
    await mkdtemp(join(tmpdir(), "m9b13d1-descriptor-execution-")),
  );
  helperPath = join(suiteRoot, "m9b13d-filesystem-helper");
  await buildM9b13dHelper(helperPath);
});

afterAll(async () => {
  if (suiteRoot !== "") await rm(suiteRoot, { recursive: true, force: true });
});

describe("M9b.13d.1 descriptor-bound helper execution feasibility", () => {
  it("seals NO-GO when Darwin rejects both inherited descriptor modes", () => {
    const result = probeM9b13d1HelperDescriptorExecution(helperPath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      protocol: "lachesis-m9b13d1-darwin-descriptor-execution-probe/1",
      host: {
        platform: "darwin",
        release: "25.5.0",
        architecture: "arm64",
      },
      helperSha256: M9B13D_HELPER_EXECUTABLE_SHA256,
      attempts: [
        {
          openMode: "read-only",
          descriptorPath: "/dev/fd/3",
          result: "spawn-error",
          errorCode: "EACCES",
        },
        {
          openMode: "execute-only",
          descriptorPath: "/dev/fd/3",
          result: "spawn-error",
          errorCode: "EACCES",
        },
      ],
      descriptorExecutionSupported: false,
      originalPathFallbackPermitted: false,
    });
  });

  it("never falls back to a replaced pathname in repeated same-UID races", async () => {
    const authorized = join(suiteRoot, "authorized-helper");
    await copyFile(helperPath, authorized);
    await chmod(authorized, 0o755);

    for (let attempt = 0; attempt < HOSTILE_REPETITIONS; attempt += 1) {
      const directory = join(suiteRoot, `hostile-${attempt}`);
      await mkdir(directory, { mode: 0o700 });
      const launchPath = join(directory, "m9b13d-filesystem-helper");
      const retainedPath = join(directory, "retained-authorized-helper");
      await copyFile(authorized, launchPath);
      await chmod(launchPath, 0o755);
      const readFd = await open(launchPath, O_NOFOLLOW);
      const executeFd = await open(launchPath, DARWIN_O_EXEC | O_NOFOLLOW);
      try {
        await rename(launchPath, retainedPath);
        await writeFile(launchPath, "#!/bin/sh\nexit 23\n", { mode: 0o755 });

        const readAttempt = descriptorSpawn(readFd.fd);
        const executeAttempt = descriptorSpawn(executeFd.fd);
        expect(errorCode(readAttempt.error)).toBe("EACCES");
        expect(errorCode(executeAttempt.error)).toBe("EACCES");

        const forbiddenFallback = spawnSync(launchPath, [], {
          env: {},
          encoding: "utf8",
        });
        expect(forbiddenFallback.status).toBe(23);
      } finally {
        await executeFd.close();
        await readFd.close();
      }
    }
  });
});
