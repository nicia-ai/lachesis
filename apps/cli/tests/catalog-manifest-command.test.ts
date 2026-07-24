import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

import { parseJson } from "@nicia-ai/lachesis";
import { afterEach, describe, expect, it } from "vitest";

import { runCatalogManifestCommand } from "../src/internal/catalog-manifest-command.js";
import { verifyCommandReport } from "../src/internal/report-contract.js";

const roots: Array<string> = [];
const moduleSource = `
import {
  createCatalog,
  diagnostic,
} from "@nicia-ai/lachesis";
const item = {
  id: "stage2/item",
  version: "1",
  kind: { kind: "scalar" },
  description: "Stage 2 item.",
  jsonSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false
  },
  parse(value) {
    return value !== null && typeof value === "object" &&
      typeof value.value === "string"
      ? { ok: true, value }
      : { ok: false, error: diagnostic("INVALID_WIRE_SCHEMA", "invalid") };
  }
};
const result = createCatalog({
  identity: { id: "stage2/catalog", version: "1" },
  schemas: [item],
  operations: []
});
if (!result.ok) throw new Error("fixture catalog failed");
export const catalog = result.value;
export const policy = {
  allowedCapabilities: [],
  budget: {
    maxEffectCalls: 0,
    maxCollectionItems: 10,
    maxRecursionDepth: 0,
    maxTokens: 0,
    maxWallClockMs: 1000,
    maxParallelism: 1
  }
};
export const invalidCatalog = {};
export const invalidPolicy = { allowedCapabilities: [] };
`;

type Invocation = Readonly<{
  code: number;
  stdout: string;
  stderr: string;
}>;

async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(import.meta.dirname, ".stage2-"));
  roots.push(root);
  await writeFile(resolve(root, "catalog.mjs"), moduleSource, "utf8");
  return root;
}

async function invoke(
  root: string,
  args: ReadonlyArray<string>,
): Promise<Invocation> {
  let stdout = "";
  let stderr = "";
  const result = await runCatalogManifestCommand(
    [...args, "--project-root", root],
    {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
  );
  return { code: result.exitCode, stdout, stderr };
}

async function verifiedReport(text: string): Promise<void> {
  const parsed = parseJson(text);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  await expect(verifyCommandReport(parsed.value)).resolves.toMatchObject({
    ok: true,
  });
}

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("private catalog manifest command", () => {
  it("checks, writes, and source-bound verifies deterministically", async () => {
    const root = await fixture();
    const common = [
      "--catalog",
      "./catalog.mjs#catalog",
      "--policy",
      "./catalog.mjs#policy",
      "--report",
      "-",
    ];
    const first = await invoke(root, [...common, "--check"]);
    const second = await invoke(root, [...common, "--check"]);
    expect(first).toEqual(second);
    expect(first.code).toBe(0);
    await verifiedReport(first.stdout);

    const output = await invoke(root, [...common, "--out", "manifest.json"]);
    expect(output.code).toBe(0);
    const bytes = await readFile(resolve(root, "manifest.json"), "utf8");
    expect(bytes.endsWith("\n")).toBe(true);
    expect(bytes.endsWith("\n\n")).toBe(false);
    const verify = await invoke(root, [...common, "--verify", "manifest.json"]);
    expect(verify.code).toBe(0);
    await verifiedReport(verify.stdout);
  });

  it("rejects mutations, invalid exports, malformed locators, and invalid modes", async () => {
    const root = await fixture();
    const common = [
      "--catalog",
      "./catalog.mjs#catalog",
      "--policy",
      "./catalog.mjs#policy",
      "--report",
      "-",
    ];
    await invoke(root, [...common, "--out", "manifest.json"]);
    await writeFile(resolve(root, "manifest.json"), "{}\n", "utf8");
    expect(
      (await invoke(root, [...common, "--verify", "manifest.json"])).code,
    ).toBe(22);
    await invoke(root, [...common, "--out", "manifest.json", "--replace"]);
    await writeFile(
      resolve(root, "catalog.mjs"),
      moduleSource.replace(
        'identity: { id: "stage2/catalog", version: "1" }',
        'identity: { id: "stage2/catalog", version: "2" }',
      ),
      "utf8",
    );
    expect(
      (
        await invoke(root, [
          "--catalog",
          "./catalog.mjs#catalog",
          "--policy",
          "./catalog.mjs#policy",
          "--report",
          "-",
          "--verify",
          "manifest.json",
        ])
      ).code,
    ).toBe(22);
    expect(
      (
        await invoke(root, [
          "--catalog",
          "./catalog.mjs#missing",
          "--policy",
          "./catalog.mjs#policy",
          "--report",
          "-",
          "--check",
        ])
      ).code,
    ).toBe(20);
    expect(
      (
        await invoke(root, [
          ...common,
          "--catalog",
          "./catalog.mjs#missing",
          "--check",
        ])
      ).code,
    ).toBe(64);
    expect(
      (
        await invoke(root, [
          "--catalog",
          "./catalog.mjs#invalidCatalog",
          "--policy",
          "./catalog.mjs#policy",
          "--check",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(20);
    expect(
      (
        await invoke(root, [
          "--catalog",
          "./catalog.mjs",
          "--policy",
          "./catalog.mjs#policy",
          "--check",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(20);
    expect(
      (await invoke(root, [...common, "--check", "--out", "x"])).code,
    ).toBe(64);
  });

  it("fails closed for existing outputs, replacement, symlinks, bounds, and permissions", async () => {
    const root = await fixture();
    const common = [
      "--catalog",
      "./catalog.mjs#catalog",
      "--policy",
      "./catalog.mjs#policy",
      "--report",
      "-",
    ];
    await writeFile(resolve(root, "manifest.json"), "old", "utf8");
    expect(
      (await invoke(root, [...common, "--out", "manifest.json"])).code,
    ).toBe(23);
    expect(
      (await invoke(root, [...common, "--out", "manifest.json", "--replace"]))
        .code,
    ).toBe(0);
    await symlink("manifest.json", resolve(root, "linked.json"));
    expect((await invoke(root, [...common, "--out", "linked.json"])).code).toBe(
      23,
    );
    await writeFile(
      resolve(root, "oversized.mjs"),
      new Uint8Array(8 * 1024 * 1024 + 1),
    );
    expect(
      (
        await invoke(root, [
          ...common,
          "--catalog",
          "./oversized.mjs#catalog",
          "--check",
        ])
      ).code,
    ).toBe(64);
    const locked = resolve(root, "locked");
    await writeFile(locked, "not-a-directory", "utf8");
    expect((await invoke(root, [...common, "--out", "locked/out"])).code).toBe(
      23,
    );
    await chmod(resolve(root, "manifest.json"), 0o600);
    expect((await lstat(resolve(root, "linked.json"))).isSymbolicLink()).toBe(
      true,
    );
  });

  it("redacts paths and rejects hostile arbitrary JSON without leaking it", async () => {
    const root = await fixture();
    const hostile = await invoke(root, [
      "--catalog",
      "./catalog.mjs#__proto__",
      "--policy",
      "./catalog.mjs#policy",
      "--check",
      "--report",
      "-",
    ]);
    expect(hostile.code).toBe(20);
    expect(hostile.stdout).not.toContain(root);
    expect(hostile.stderr).not.toContain(root);
    expect(hostile.stdout).not.toContain("__proto__");
  });
});
