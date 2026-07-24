import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { parseJson } from "../packages/kernel/dist/json.js";

const root = resolve(import.meta.dirname, "..");
const context = await mkdtemp(resolve(tmpdir(), "lachesis-alpha4-linux-"));
const image = "lachesis-m8b2b-alpha4-offline-smoke";

function execute(program, arguments_, cwd = root) {
  const result = spawnSync(program, arguments_, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0)
    throw new Error(
      `${program} ${arguments_.join(" ")} failed: ${result.stderr}`,
    );
  return result.stdout;
}

try {
  await mkdir(resolve(context, ".release-packages"));
  await mkdir(resolve(context, "scripts"));
  await cp(
    resolve(root, ".release-packages"),
    resolve(context, ".release-packages"),
    { recursive: true },
  );
  await cp(
    resolve(root, "scripts/test-m8b2b-alpha4-consumer.mjs"),
    resolve(context, "scripts/test-m8b2b-alpha4-consumer.mjs"),
  );
  await writeFile(
    resolve(context, "Dockerfile"),
    `FROM node:24.18.0-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /workspace
COPY .release-packages/ .release-packages/
COPY scripts/ scripts/
RUN node scripts/test-m8b2b-alpha4-consumer.mjs
ENV M8B2B_OFFLINE=1
ENTRYPOINT ["node", "scripts/test-m8b2b-alpha4-consumer.mjs"]
`,
    { encoding: "utf8", mode: 0o644 },
  );
  execute("docker", ["build", "--tag", image, context]);
  const output = execute("docker", [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=256m",
    "--tmpfs",
    "/root/.local/share/pnpm/store/v10/projects:rw,noexec,nosuid,nodev,size=16m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    image,
  ]);
  const parsed = parseJson(output);
  if (!parsed.ok) throw new Error("The Linux consumer returned invalid JSON.");
  const result = parsed.value;
  if (result.status !== "pass")
    throw new Error("The Linux offline consumer did not pass.");
  process.stdout.write(
    `${JSON.stringify({
      protocol: "lachesis.m8b2b.alpha4.linux-consumer.v1",
      image: "node:24.18.0-bookworm-slim",
      packageManager: "pnpm@10.33.0",
      network: "none",
      rootFilesystem: "read-only",
      capabilities: "none",
      noNewPrivileges: true,
      providerCalls: 0,
      status: "pass",
    })}\n`,
  );
} finally {
  await rm(context, { recursive: true, force: true });
}
