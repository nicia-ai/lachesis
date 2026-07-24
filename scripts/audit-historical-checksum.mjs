import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function gitBytes(specification) {
  const result = spawnSync("git", ["show", specification], {
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = result.stderr.toString("utf8").trim();
    throw new Error(`git show ${specification} failed: ${detail}`);
  }
  return result.stdout;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const [commit, manifestPath, expectedManifestDigest] = process.argv.slice(2);
if (
  commit === undefined ||
  !/^[a-f0-9]{40}$/.test(commit) ||
  manifestPath === undefined ||
  !/^docs\/[A-Za-z0-9._/-]+\.sha256$/.test(manifestPath) ||
  expectedManifestDigest === undefined ||
  !/^[a-f0-9]{64}$/.test(expectedManifestDigest)
) {
  fail(
    "Usage: audit-historical-checksum.mjs <40-hex-commit> <docs/*.sha256> <64-hex-manifest-digest>",
  );
} else {
  try {
    const historicalManifest = gitBytes(`${commit}:${manifestPath}`);
    const currentManifest = await readFile(manifestPath);
    if (!historicalManifest.equals(currentManifest)) {
      throw new Error(`${manifestPath} differs from its bound commit.`);
    }
    if (sha256(historicalManifest) !== expectedManifestDigest) {
      throw new Error(`${manifestPath} digest differs from its binding.`);
    }

    const lines = historicalManifest
      .toString("utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    for (const line of lines) {
      const match =
        /^([a-f0-9]{64}) {2}([A-Za-z0-9._/@+-][A-Za-z0-9._/@+ -]*)$/.exec(line);
      if (match === null) {
        throw new Error(`Malformed checksum line: ${line}`);
      }
      const [, expected, path] = match;
      if (expected === undefined || path === undefined) {
        throw new Error(`Incomplete checksum line: ${line}`);
      }
      const actual = sha256(gitBytes(`${commit}:${path}`));
      if (actual !== expected) {
        throw new Error(`${path} differs at bound commit ${commit}.`);
      }
    }

    process.stdout.write(
      `${JSON.stringify({
        protocol: "lachesis-historical-checksum-audit/1",
        commit,
        manifestPath,
        manifestDigest: expectedManifestDigest,
        artifacts: lines.length,
        status: "pass",
      })}\n`,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : "Historical audit failed.");
  }
}
