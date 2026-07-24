import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

import { parseJson } from "@nicia-ai/lachesis";
import { afterEach, describe, expect, it } from "vitest";

import {
  type CatalogCompareCommandTestHooks,
  runCatalogCompareCommand,
} from "../src/internal/catalog-compare-command.js";
import { runCatalogManifestCommand } from "../src/internal/catalog-manifest-command.js";
import { verifyCommandReport } from "../src/internal/report-contract.js";

const roots: Array<string> = [];
const moduleSource = `
import { createCatalog, diagnostic } from "@nicia-ai/lachesis";

function schema(id, version, description, jsonSchema, semantic) {
  return {
    id, version, description, jsonSchema,
    kind: semantic === undefined
      ? { kind: "scalar" }
      : { kind: "scalar", semantic },
    parse(value) {
      return value !== undefined
        ? { ok: true, value }
        : { ok: false, error: diagnostic("INVALID_WIRE_SCHEMA", "invalid") };
    }
  };
}

function fn(id, version, description, input, output, stateChanging = false) {
  return {
    kind: "function", id, version, description,
    input: { id: input.id, version: input.version },
    output: { id: output.id, version: output.version },
    semantics: { stateChanging },
    invoke(value) { return { ok: true, value }; }
  };
}

function effect(id, description, input, output, options = {}) {
  return {
    kind: "effect", id, version: "1", description,
    input: { id: input.id, version: input.version },
    output: { id: output.id, version: output.version },
    semantics: { stateChanging: options.stateChanging ?? true },
    effectName: options.effectName ?? "fixture.publish",
    capability: options.capability ?? "fixture.read",
    maxTokens: options.maxTokens ?? 8,
    maxWallClockMs: options.maxWallClockMs ?? 100,
    maxOutputItems: options.maxOutputItems ?? 1,
    replayable: options.replayable ?? true
  };
}

function reducer(id, description, item, laws) {
  return {
    kind: "reducer", id, version: "1", description,
    element: { id: item.id, version: item.version },
    accumulator: { id: item.id, version: item.version },
    identity: "identity", laws,
    semantics: { stateChanging: false },
    reduce(accumulator) { return { ok: true, value: accumulator }; }
  };
}

function unwrap(definition) {
  const result = createCatalog(definition);
  if (!result.ok) throw new Error("fixture catalog failed");
  return result.value;
}

const item1 = schema(
  "stage3/item", "1", "Stage 3 item.",
  { type: "string", minLength: 1 }
);
const reorderedItem = schema(
  "stage3/item", "1", "Stage 3 item.",
  { minLength: 1, type: "string" }
);
const item2 = schema(
  "stage3/item", "2", "Changed item.",
  { minLength: 2, type: "string" }, "boolean"
);
const auxiliary = schema(
  "stage3/auxiliary", "1", "Auxiliary.",
  { type: "number" }
);
const extra = schema(
  "stage3/extra", "1", "Extra.",
  { type: "object", additionalProperties: false }
);

const baseTransform = fn(
  "stage3/transform", "1", "Transform.", item1, item1
);
const changedTransform = {
  kind: "fixedPointStep",
  id: "stage3/transform",
  version: "2",
  description: "Changed transform.",
  input: { id: item2.id, version: item2.version },
  output: { id: item2.id, version: item2.version },
  semantics: { stateChanging: true },
  invoke(value) { return { ok: true, value }; }
};
const baseEffect = effect("stage3/publish", "Publish.", item1, item1);
const changedEffect = effect(
  "stage3/publish", "Changed publish.", item2, extra,
  {
    stateChanging: false,
    effectName: "fixture.archive",
    capability: "fixture.write",
    maxTokens: 13,
    maxWallClockMs: 200,
    maxOutputItems: 2,
    replayable: false
  }
);
const baseReducer = reducer(
  "stage3/combine", "Combine.", item1,
  { associative: true, commutative: true, idempotent: true }
);
const changedReducer = reducer(
  "stage3/combine", "Changed combine.", item2,
  { associative: false, commutative: false, idempotent: false }
);
const removedOperation = fn(
  "stage3/retire", "1", "Retire.", auxiliary, auxiliary
);
const addedOperation = fn(
  "stage3/escalate", "1", "Escalate.", extra, extra
);

const baseRoles = {
  protocol: "lachesis-catalog-semantic-roles/1",
  schemas: [
    {
      kind: "schema",
      role: { id: "stage3.role/item", version: "1" },
      schema: { id: item1.id, version: item1.version },
      obligations: { mutuallyAcceptsConformanceValues: true }
    },
    {
      kind: "schema",
      role: { id: "stage3.role/auxiliary", version: "1" },
      schema: { id: auxiliary.id, version: auxiliary.version },
      obligations: { mutuallyAcceptsConformanceValues: true }
    }
  ],
  operations: [
    {
      kind: "function",
      role: { id: "stage3.role/transform", version: "1" },
      operation: { id: baseTransform.id, version: baseTransform.version },
      obligations: {
        deterministic: true,
        totalOnConformanceValues: true,
        pointwiseEquivalent: true
      }
    },
    {
      kind: "reducer",
      role: { id: "stage3.role/combine", version: "1" },
      operation: { id: baseReducer.id, version: baseReducer.version },
      obligations: {
        deterministic: true,
        totalOnConformanceValues: true,
        pointwiseEquivalent: true,
        identity: true,
        associative: true,
        commutative: true,
        idempotent: true
      }
    }
  ]
};

const changedRoles = {
  protocol: "lachesis-catalog-semantic-roles/1",
  schemas: [
    {
      kind: "schema",
      role: { id: "stage3.role/item", version: "2" },
      schema: { id: extra.id, version: extra.version },
      obligations: { mutuallyAcceptsConformanceValues: true }
    },
    {
      kind: "schema",
      role: { id: "stage3.role/extra", version: "1" },
      schema: { id: item2.id, version: item2.version },
      obligations: { mutuallyAcceptsConformanceValues: true }
    }
  ],
  operations: [
    {
      kind: "fixedPointStep",
      role: { id: "stage3.role/transform", version: "2" },
      operation: { id: changedTransform.id, version: changedTransform.version },
      obligations: {
        deterministic: true,
        totalOnConformanceValues: true,
        pointwiseEquivalent: true,
        sameSchema: true
      }
    },
    {
      kind: "reducer",
      role: { id: "stage3.role/combine", version: "1" },
      operation: { id: changedReducer.id, version: changedReducer.version },
      obligations: {
        deterministic: true,
        totalOnConformanceValues: true,
        pointwiseEquivalent: true,
        identity: true,
        associative: false,
        commutative: false,
        idempotent: false
      }
    }
  ]
};

export const baseCatalog = unwrap({
  identity: { id: "stage3/catalog", version: "1" },
  schemas: [item1.runtime ?? item1, auxiliary.runtime ?? auxiliary],
  operations: [baseTransform, baseEffect, baseReducer, removedOperation],
  semanticRoles: baseRoles
});
export const reorderedCatalog = unwrap({
  identity: { version: "1", id: "stage3/catalog" },
  schemas: [auxiliary.runtime ?? auxiliary, reorderedItem.runtime ?? reorderedItem],
  operations: [removedOperation, baseReducer, baseEffect, baseTransform],
  semanticRoles: {
    protocol: "lachesis-catalog-semantic-roles/1",
    schemas: [...baseRoles.schemas].reverse(),
    operations: [...baseRoles.operations].reverse()
  }
});
export const identityCatalog = unwrap({
  identity: { id: "stage3/catalog-renamed", version: "2" },
  schemas: [item1.runtime ?? item1, auxiliary.runtime ?? auxiliary],
  operations: [baseTransform, baseEffect, baseReducer, removedOperation],
  semanticRoles: baseRoles
});
export const noRolesCatalog = unwrap({
  identity: { id: "stage3/catalog", version: "1" },
  schemas: [item1.runtime ?? item1, auxiliary.runtime ?? auxiliary],
  operations: [baseTransform, baseEffect, baseReducer, removedOperation]
});
export const changedCatalog = unwrap({
  identity: { id: "stage3/catalog", version: "1" },
  schemas: [item2.runtime ?? item2, extra.runtime ?? extra],
  operations: [changedTransform, changedEffect, changedReducer, addedOperation],
  semanticRoles: changedRoles
});
export const invalidCatalog = {};

export const basePolicy = {
  allowedCapabilities: ["fixture.read"],
  budget: {
    maxEffectCalls: 1,
    maxCollectionItems: 10,
    maxRecursionDepth: 1,
    maxTokens: 8,
    maxWallClockMs: 100,
    maxParallelism: 1
  }
};
export const reorderedPolicy = {
  budget: {
    maxParallelism: 1,
    maxWallClockMs: 100,
    maxTokens: 8,
    maxRecursionDepth: 1,
    maxCollectionItems: 10,
    maxEffectCalls: 1
  },
  allowedCapabilities: ["fixture.read"]
};
export const changedPolicy = {
  allowedCapabilities: ["fixture.write"],
  budget: {
    maxEffectCalls: 2,
    maxCollectionItems: 20,
    maxRecursionDepth: 2,
    maxTokens: 13,
    maxWallClockMs: 200,
    maxParallelism: 2
  }
};
export const invalidPolicy = { allowedCapabilities: [] };
`;

type Invocation = Readonly<{
  code: number;
  stdout: string;
  stderr: string;
}>;

async function fixture(source = moduleSource): Promise<string> {
  const root = await mkdtemp(resolve(import.meta.dirname, ".stage3-"));
  roots.push(root);
  await writeFile(resolve(root, "catalogs.mjs"), source, "utf8");
  return root;
}

function common(
  rightCatalog = "baseCatalog",
  rightPolicy = "basePolicy",
): ReadonlyArray<string> {
  return [
    "--left-catalog",
    "./catalogs.mjs#baseCatalog",
    "--left-policy",
    "./catalogs.mjs#basePolicy",
    "--right-catalog",
    `./catalogs.mjs#${rightCatalog}`,
    "--right-policy",
    `./catalogs.mjs#${rightPolicy}`,
  ];
}

async function invoke(
  root: string,
  args: ReadonlyArray<string>,
  hooks: CatalogCompareCommandTestHooks = {},
): Promise<Invocation> {
  let stdout = "";
  let stderr = "";
  const result = await runCatalogCompareCommand(
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

async function report(text: string) {
  const parsed = parseJson(text);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("report parse failed");
  const verified = await verifyCommandReport(parsed.value);
  expect(verified.ok).toBe(true);
  if (!verified.ok) throw new Error(verified.error.message);
  return verified.value;
}

async function emitManifest(
  root: string,
  catalog: string,
  policy: string,
  output: string,
): Promise<void> {
  const result = await runCatalogManifestCommand(
    [
      "--catalog",
      `./catalogs.mjs#${catalog}`,
      "--policy",
      `./catalogs.mjs#${policy}`,
      "--out",
      output,
      "--report",
      "-",
      "--project-root",
      root,
    ],
    { stdout: () => undefined, stderr: () => undefined },
  );
  expect(result.exitCode).toBe(0);
}

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("private structural catalog compare command", () => {
  it("reports exact and reordered declarations as byte-identical exact matches", async () => {
    const root = await fixture();
    const first = await invoke(root, [...common(), "--report", "-"]);
    const second = await invoke(root, [...common(), "--report", "-"]);
    const reordered = await invoke(root, [
      ...common("reorderedCatalog", "reorderedPolicy"),
      "--report",
      "-",
    ]);
    expect(first).toEqual(second);
    expect(first.code).toBe(0);
    expect(reordered.code).toBe(0);
    const exact = await report(first.stdout);
    const reorderedReport = await report(reordered.stdout);
    expect(exact.migrations).toEqual([]);
    expect(reorderedReport.migrations).toEqual([]);
    expect(
      exact.inputs.find((input) => input.label === "left-manifest")?.digest,
    ).toBe(
      exact.inputs.find((input) => input.label === "right-manifest")?.digest,
    );
  });

  it("reports identity-only and every supported structural change as review-required", async () => {
    const root = await fixture();
    const identity = await invoke(root, [
      ...common("identityCatalog"),
      "--report",
      "-",
    ]);
    expect(identity.code).toBe(10);
    expect(identity.stdout).toContain("change=catalog.identity");

    const changed = await invoke(root, [
      ...common("changedCatalog", "changedPolicy"),
      "--report",
      "-",
    ]);
    const changedAgain = await invoke(root, [
      ...common("changedCatalog", "changedPolicy"),
      "--report",
      "-",
    ]);
    expect(changed.code).toBe(10);
    expect(changedAgain).toEqual(changed);
    const expectedKinds = [
      "schema.added",
      "schema.removed",
      "schema.version",
      "schema.kind",
      "schema.description",
      "schema.json-schema",
      "operation.added",
      "operation.removed",
      "operation.version",
      "operation.kind",
      "operation.description",
      "operation.signature.input",
      "operation.signature.output",
      "operation.signature.element",
      "operation.signature.accumulator",
      "operation.semantics.state-changing",
      "operation.effect.name",
      "operation.effect.capability",
      "operation.effect.replayable",
      "operation.bound.max-output-items",
      "operation.bound.max-tokens",
      "operation.bound.max-wall-clock-ms",
      "operation.reducer-law.associative",
      "operation.reducer-law.commutative",
      "operation.reducer-law.idempotent",
      "semantic-role.schema.added",
      "semantic-role.schema.removed",
      "semantic-role.schema.version",
      "semantic-role.schema.target",
      "semantic-role.operation.version",
      "semantic-role.operation.kind",
      "semantic-role.operation.target",
      "semantic-role.operation.obligation",
      "policy.capability.added",
      "policy.capability.removed",
      "policy.budget",
    ];
    for (const kind of expectedKinds)
      expect(changed.stdout).toContain(`change=${kind}`);
    const withoutRoles = await invoke(root, [
      ...common("noRolesCatalog"),
      "--report",
      "-",
    ]);
    expect(withoutRoles.code).toBe(10);
    expect(withoutRoles.stdout).toContain("change=semantic-role.protocol");
    const verified = await report(changed.stdout);
    expect(verified.summary.migrationRecords).toBe(verified.migrations.length);
    expect(
      verified.migrations.every(
        (migration) =>
          migration.category === "declaration-review" &&
          migration.guidance.kind === "review-required",
      ),
    ).toBe(true);
    expect(changed.stdout).not.toMatch(
      /\b(?:compatible|equivalent|substitut(?:e|able)|safe migration)\b/iu,
    );
  });

  it("verifies optional source-bound manifests and rejects mismatch", async () => {
    const root = await fixture();
    await emitManifest(root, "baseCatalog", "basePolicy", "left.json");
    await emitManifest(root, "changedCatalog", "changedPolicy", "right.json");
    const valid = await invoke(root, [
      ...common("changedCatalog", "changedPolicy"),
      "--left-manifest",
      "left.json",
      "--right-manifest",
      "right.json",
      "--report",
      "-",
    ]);
    expect(valid.code).toBe(10);
    await writeFile(resolve(root, "right.json"), "{}\n", "utf8");
    const mismatch = await invoke(root, [
      ...common("changedCatalog", "changedPolicy"),
      "--left-manifest",
      "left.json",
      "--right-manifest",
      "right.json",
      "--report",
      "-",
    ]);
    expect(mismatch.code).toBe(22);
    await writeFile(resolve(root, "right.json"), "{", "utf8");
    const invalid = await invoke(root, [
      ...common("changedCatalog", "changedPolicy"),
      "--right-manifest",
      "right.json",
      "--report",
      "-",
    ]);
    expect(invalid.code).toBe(20);
  });

  it("acquires and imports a shared module once and rejects drift at every boundary", async () => {
    const root = await fixture();
    let acquisitions = 0;
    let executions = 0;
    const successful = await invoke(root, [...common(), "--report", "-"], {
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

    const cases: ReadonlyArray<
      (
        mutate: (path: string) => Promise<void>,
        onExecution: () => void,
      ) => CatalogCompareCommandTestHooks
    > = [
      (mutate, onModuleExecution) => ({
        afterSourceAcquired: mutate,
        onModuleExecution,
      }),
      (mutate, onModuleExecution) => ({
        afterSourceDigest: mutate,
        onModuleExecution,
      }),
      (mutate, onModuleExecution) => ({
        beforeModuleImport: mutate,
        onModuleExecution,
      }),
      (mutate, onModuleExecution) => ({
        afterModuleImport: mutate,
        onModuleExecution,
      }),
      (mutate, onModuleExecution) => ({
        beforeExportLookup: async (path) => {
          await mutate(path);
        },
        onModuleExecution,
      }),
    ];
    const observedExecutions: Array<number> = [];
    for (const createHooks of cases) {
      const caseRoot = await fixture();
      let mutated = false;
      let caseExecutions = 0;
      const result = await invoke(
        caseRoot,
        [...common(), "--report", "-"],
        createHooks(
          async (path) => {
            if (mutated) return;
            mutated = true;
            await appendFile(path, "\n// deterministic drift\n", "utf8");
          },
          () => {
            caseExecutions += 1;
          },
        ),
      );
      expect(result.code).toBe(23);
      observedExecutions.push(caseExecutions);
    }
    expect(observedExecutions).toEqual([0, 0, 0, 1, 1]);

    const replacementRoot = await fixture();
    let replaced = false;
    const replacement = await invoke(
      replacementRoot,
      [...common(), "--report", "-"],
      {
        afterBoundRead: async (path) => {
          if (replaced) return;
          replaced = true;
          await rename(path, `${path}.original`);
          await writeFile(path, moduleSource, "utf8");
        },
      },
    );
    expect(replacement.code).toBe(23);
  });

  it("rejects normalized aliases before execution or mutation", async () => {
    const root = await fixture();
    await emitManifest(root, "baseCatalog", "basePolicy", "manifest.json");
    const sourceBefore = await readFile(resolve(root, "catalogs.mjs"), "utf8");
    const cases = [
      [
        ...common(),
        "--left-manifest",
        "nested/../catalogs.mjs",
        "--report",
        "-",
      ],
      [
        ...common(),
        "--left-manifest",
        "manifest.json",
        "--right-manifest",
        "./manifest.json",
        "--report",
        "-",
      ],
      [
        ...common(),
        "--left-manifest",
        "manifest.json",
        "--report",
        "./manifest.json",
      ],
      [...common(), "--report", "nested/../catalogs.mjs", "--replace"],
    ];
    for (const args of cases) {
      let executions = 0;
      const result = await invoke(root, args, {
        onModuleExecution: () => {
          executions += 1;
        },
      });
      expect(result.code).toBe(20);
      expect(executions).toBe(0);
    }
    expect(await readFile(resolve(root, "catalogs.mjs"), "utf8")).toBe(
      sourceBefore,
    );
  });

  it("fails closed for symlinks, escapes, bounds, replacement, and output races", async () => {
    const root = await fixture();
    const outside = await mkdtemp(resolve(import.meta.dirname, ".outside3-"));
    roots.push(outside);
    await symlink(outside, resolve(root, "escape"));
    expect(
      (await invoke(root, [...common(), "--report", "escape/report.json"]))
        .code,
    ).toBe(23);
    await expect(lstat(resolve(outside, "report.json"))).rejects.toThrow();
    await writeFile(resolve(root, "existing.json"), "preserve", "utf8");
    await symlink("existing.json", resolve(root, "report-link.json"));
    expect(
      (await invoke(root, [...common(), "--report", "report-link.json"])).code,
    ).toBe(23);
    expect(
      (
        await invoke(root, [
          "--left-catalog",
          "../outside.mjs#catalog",
          "--left-policy",
          "./catalogs.mjs#basePolicy",
          "--right-catalog",
          "./catalogs.mjs#baseCatalog",
          "--right-policy",
          "./catalogs.mjs#basePolicy",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(23);
    await symlink("existing.json", resolve(root, "manifest-link.json"));
    expect(
      (
        await invoke(root, [
          ...common(),
          "--left-manifest",
          "manifest-link.json",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(23);
    await writeFile(
      resolve(root, "oversized.mjs"),
      new Uint8Array(8 * 1024 * 1024 + 1),
    );
    expect(
      (
        await invoke(root, [
          "--left-catalog",
          "./oversized.mjs#catalog",
          "--left-policy",
          "./catalogs.mjs#basePolicy",
          "--right-catalog",
          "./catalogs.mjs#baseCatalog",
          "--right-policy",
          "./catalogs.mjs#basePolicy",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(23);

    const first = await invoke(root, [
      ...common("identityCatalog"),
      "--report",
      "report.json",
    ]);
    expect(first.code).toBe(10);
    expect(
      (
        await invoke(root, [
          ...common("identityCatalog"),
          "--report",
          "report.json",
        ])
      ).code,
    ).toBe(23);
    expect(
      (
        await invoke(root, [
          ...common("identityCatalog"),
          "--report",
          "report.json",
          "--replace",
        ])
      ).code,
    ).toBe(10);
    let targetReplaced = false;
    const targetRace = await invoke(
      root,
      [...common("identityCatalog"), "--report", "report.json", "--replace"],
      {
        beforeCommit: async (path) => {
          if (targetReplaced) return;
          targetReplaced = true;
          await writeFile(path, "replacement", "utf8");
        },
      },
    );
    expect(targetRace.code).toBe(23);

    await mkdir(resolve(root, "stable"));
    let replaced = false;
    const raced = await invoke(
      root,
      [...common("identityCatalog"), "--report", "stable/report.json"],
      {
        beforeCommit: async () => {
          if (replaced) return;
          replaced = true;
          await rename(resolve(root, "stable"), resolve(root, "old-stable"));
          await mkdir(resolve(root, "stable"));
        },
      },
    );
    expect(raced.code).toBe(23);
  });

  it("returns frozen usage and invalid-input codes with redacted deterministic reports", async () => {
    const root = await fixture();
    expect(
      (await invoke(root, [...common(), "--suite", "x", "--report", "-"])).code,
    ).toBe(64);
    expect(
      (
        await invoke(root, [
          ...common(),
          "--left-catalog",
          "./catalogs.mjs",
          "--report",
          "-",
        ])
      ).code,
    ).toBe(64);
    const invalid = await invoke(root, [
      "--left-catalog",
      "./catalogs.mjs#invalidCatalog",
      "--left-policy",
      "./catalogs.mjs#basePolicy",
      "--right-catalog",
      "./catalogs.mjs#baseCatalog",
      "--right-policy",
      "./catalogs.mjs#basePolicy",
      "--report",
      "-",
    ]);
    expect(invalid.code).toBe(20);
    expect(invalid.stdout).not.toContain(root);
    expect(invalid.stderr).not.toContain(root);
    await report(invalid.stdout);
  });
});
