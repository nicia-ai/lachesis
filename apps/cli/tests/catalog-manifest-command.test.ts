import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

import { parseJson } from "@nicia-ai/lachesis";
import { afterEach, describe, expect, it } from "vitest";

import {
  type CatalogManifestCommandTestHooks,
  runCatalogManifestCommand,
} from "../src/internal/catalog-manifest-command.js";
import { verifyCommandReport } from "../src/internal/report-contract.js";
import { readBoundedRegularFile } from "../src/internal/secure-files.js";

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
  hooks: CatalogManifestCommandTestHooks = {},
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
    hooks,
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
          "--catalog",
          "./oversized.mjs#catalog",
          "--policy",
          "./catalog.mjs#policy",
          "--check",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(23);
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

  it("acquires and executes one shared module once and rejects drift before execution", async () => {
    const root = await fixture();
    const common = [
      "--catalog",
      "./catalog.mjs#catalog",
      "--policy",
      "./catalog.mjs#policy",
      "--check",
      "--report",
      "-",
    ];
    let acquisitions = 0;
    let executions = 0;
    const successful = await invoke(root, common, {
      onSourceAcquisition: () => {
        acquisitions += 1;
      },
      onModuleExecution: () => {
        executions += 1;
      },
    });
    expect(successful.code).toBe(0);
    expect({ acquisitions, executions }).toEqual({
      acquisitions: 1,
      executions: 1,
    });

    let mutated = false;
    let rejectedExecutions = 0;
    const rejected = await invoke(root, common, {
      beforeModuleImport: async (path) => {
        if (mutated) return;
        mutated = true;
        await appendFile(path, "\n// mutation after digest\n", "utf8");
      },
      onModuleExecution: () => {
        rejectedExecutions += 1;
      },
    });
    expect(rejected.code).toBe(23);
    expect(rejectedExecutions).toBe(0);
  });

  it("fails closed on mutation across acquisition, digest, import, and export boundaries", async () => {
    const cases: ReadonlyArray<
      (
        mutate: (path: string) => Promise<void>,
      ) => CatalogManifestCommandTestHooks
    > = [
      (mutate) => ({ afterSourceAcquired: mutate }),
      (mutate) => ({ afterSourceDigest: mutate }),
      (mutate) => ({ afterModuleImport: mutate }),
      (mutate) => ({
        beforeExportLookup: async (path) => {
          await mutate(path);
        },
      }),
    ];
    for (const createHooks of cases) {
      const root = await fixture();
      let mutated = false;
      const mutate = async (path: string): Promise<void> => {
        if (mutated) return;
        mutated = true;
        await appendFile(
          path,
          "\n// deterministic boundary mutation\n",
          "utf8",
        );
      };
      const result = await invoke(
        root,
        [
          "--catalog",
          "./catalog.mjs#catalog",
          "--policy",
          "./catalog.mjs#policy",
          "--check",
          "--report",
          "-",
        ],
        createHooks(mutate),
      );
      expect(result.code).toBe(23);
    }
  });

  it("rejects growth, truncation, replacement, and symlink swaps during descriptor reads", async () => {
    const root = await fixture();
    const path = resolve(root, "race.json");
    const reset = async (): Promise<void> => {
      await rm(path, { force: true });
      await writeFile(path, "0123456789", "utf8");
    };
    await reset();
    await expect(
      readBoundedRegularFile(path, 100, {
        beforeReadChunk: async (_path, offset) => {
          if (offset === 0) await appendFile(path, "growth", "utf8");
        },
      }),
    ).rejects.toThrow();
    await reset();
    await expect(
      readBoundedRegularFile(path, 100, {
        beforeReadChunk: async (_path, offset) => {
          if (offset === 0) await truncate(path, 2);
        },
      }),
    ).rejects.toThrow();
    await reset();
    await expect(
      readBoundedRegularFile(path, 100, {
        afterBoundRead: async () => {
          await rename(path, `${path}.replaced`);
          await writeFile(path, "replacement", "utf8");
        },
      }),
    ).rejects.toThrow();
    await reset();
    await expect(
      readBoundedRegularFile(path, 100, {
        afterBoundRead: async () => {
          await rename(path, `${path}.target`);
          await symlink(`${path}.target`, path);
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects parent escapes, directory replacement, and artifact/report aliases before mutation", async () => {
    const root = await fixture();
    const common = [
      "--catalog",
      "./catalog.mjs#catalog",
      "--policy",
      "./catalog.mjs#policy",
    ];
    const outside = await mkdtemp(resolve(import.meta.dirname, ".outside-"));
    roots.push(outside);
    await symlink(outside, resolve(root, "escape"));
    expect(
      (
        await invoke(root, [
          ...common,
          "--out",
          "escape/manifest.json",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(23);
    expect(
      (
        await invoke(root, [
          ...common,
          "--check",
          "--report",
          "escape/report.json",
        ])
      ).code,
    ).toBe(23);
    await expect(lstat(resolve(outside, "report.json"))).rejects.toThrow();

    const aliased = resolve(root, "manifest.json");
    await writeFile(aliased, "preserve", "utf8");
    const alias = await invoke(root, [
      ...common,
      "--out",
      "nested/../manifest.json",
      "--report",
      "manifest.json",
      "--replace",
    ]);
    expect(alias.code).toBe(20);
    expect(await readFile(aliased, "utf8")).toBe("preserve");
    const verifyAlias = await invoke(root, [
      ...common,
      "--verify",
      "manifest.json",
      "--report",
      "./manifest.json",
    ]);
    expect(verifyAlias.code).toBe(20);
    expect(await readFile(aliased, "utf8")).toBe("preserve");
    const sourceBefore = await readFile(resolve(root, "catalog.mjs"), "utf8");
    const sourceArtifactAlias = await invoke(root, [
      ...common,
      "--out",
      "catalog.mjs",
      "--report",
      "-",
      "--replace",
    ]);
    expect(sourceArtifactAlias.code).toBe(20);
    const sourceReportAlias = await invoke(root, [
      ...common,
      "--check",
      "--report",
      "./catalog.mjs",
    ]);
    expect(sourceReportAlias.code).toBe(20);
    expect(await readFile(resolve(root, "catalog.mjs"), "utf8")).toBe(
      sourceBefore,
    );

    await mkdir(resolve(root, "stable"));
    let replaced = false;
    const swapped = await invoke(
      root,
      [...common, "--out", "stable/manifest.json", "--report", "-"],
      {
        beforeCommit: async () => {
          if (replaced) return;
          replaced = true;
          await rename(resolve(root, "stable"), resolve(root, "old-stable"));
          await mkdir(resolve(root, "stable"));
        },
      },
    );
    expect(swapped.code).toBe(23);
  });
});
