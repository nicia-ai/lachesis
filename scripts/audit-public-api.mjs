import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import ts from "typescript";

import { parseJson } from "../packages/kernel/dist/index.js";

const root = resolve(import.meta.dirname, "..");

const publishable = [
  {
    name: "@nicia-ai/lachesis",
    classification: "stable-alpha",
    packagePath: "packages/kernel/package.json",
    entrypoints: [{ name: ".", source: "packages/kernel/src/index.ts" }],
  },
  {
    name: "@nicia-ai/lachesis-runtime",
    classification: "stable-alpha",
    packagePath: "packages/runtime/package.json",
    entrypoints: [
      { name: ".", source: "packages/runtime/src/index.ts" },
      { name: "./node", source: "packages/runtime/src/node.ts" },
    ],
  },
  {
    name: "@nicia-ai/lachesis-evidence-typegraph",
    classification: "stable-alpha",
    packagePath: "packages/evidence-typegraph/package.json",
    entrypoints: [
      { name: ".", source: "packages/evidence-typegraph/src/index.ts" },
      {
        name: "./sqlite",
        source: "packages/evidence-typegraph/src/sqlite.ts",
      },
    ],
  },
  {
    name: "@nicia-ai/lachesis-evidence",
    classification: "experimental",
    packagePath: "packages/evidence/package.json",
    entrypoints: [{ name: ".", source: "packages/evidence/src/index.ts" }],
  },
  {
    name: "@nicia-ai/lachesis-generator",
    classification: "experimental",
    packagePath: "packages/generator/package.json",
    entrypoints: [
      { name: ".", source: "packages/generator/src/index.ts" },
      { name: "./node", source: "packages/generator/src/node-store.ts" },
    ],
  },
];

const internalPackages = [
  "apps/benchmark/package.json",
  "apps/cli/package.json",
  "compat/node-smoke/package.json",
  "compat/worker-smoke/package.json",
  "packages/generator-ai-sdk/package.json",
];

function exportedNames(sourceText, sourcePath) {
  const source = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = [];
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause === undefined)
        throw new Error(`${sourcePath} contains an unbounded export star.`);
      if (!ts.isNamedExports(statement.exportClause))
        throw new Error(`${sourcePath} contains an unsupported export clause.`);
      for (const element of statement.exportClause.elements)
        names.push(element.name.text);
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : undefined;
    if (
      !modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    )
      continue;
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      if (statement.name !== undefined) names.push(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name))
          throw new Error(`${sourcePath} exports a destructured declaration.`);
        names.push(declaration.name.text);
      }
    }
  }
  const unique = [...new Set(names)].toSorted();
  if (unique.length !== names.length)
    throw new Error(`${sourcePath} exports a duplicate public name.`);
  return unique;
}

function digest(names) {
  return createHash("sha256")
    .update(`${names.join("\n")}\n`)
    .digest("hex");
}

async function packageJson(path) {
  const text = await readFile(resolve(root, path), "utf8");
  const parsed = parseJson(text);
  if (!parsed.ok || parsed.value === null || Array.isArray(parsed.value))
    throw new Error(`${path} is not a valid package manifest.`);
  return parsed.value;
}

const inventory = [];
for (const item of publishable) {
  const manifest = await packageJson(item.packagePath);
  if (manifest.private === true)
    throw new Error(`${item.name} is unexpectedly private.`);
  if (
    manifest.license !== "Apache-2.0" ||
    manifest.type !== "module" ||
    manifest.sideEffects !== false ||
    manifest.publishConfig?.access !== "public" ||
    manifest.repository?.url !== "https://github.com/nicia-ai/lachesis.git" ||
    manifest.engines?.node !== ">=24 <25" ||
    !manifest.files?.includes("README.md") ||
    !manifest.files?.includes("CHANGELOG.md") ||
    !manifest.files?.includes("LICENSE")
  )
    throw new Error(`${item.name} is missing frozen alpha package metadata.`);
  const entrypoints = [];
  for (const entrypoint of item.entrypoints) {
    const names = exportedNames(
      await readFile(resolve(root, entrypoint.source), "utf8"),
      entrypoint.source,
    );
    entrypoints.push({
      name: entrypoint.name,
      classification: item.classification,
      exportCount: names.length,
      exportsDigest: digest(names),
      exports: names,
    });
  }
  inventory.push({
    package: item.name,
    version: manifest.version,
    classification: item.classification,
    entrypoints,
  });
}

for (const path of internalPackages) {
  const manifest = await packageJson(path);
  if (manifest.private !== true)
    throw new Error(`${manifest.name} must remain private and unpublished.`);
}

for (const portableDeclaration of [
  "packages/kernel/dist/index.d.ts",
  "packages/evidence/dist/index.d.ts",
  "packages/runtime/dist/index.d.ts",
  "packages/evidence-typegraph/dist/index.d.ts",
]) {
  const text = await readFile(resolve(root, portableDeclaration), "utf8");
  for (const forbidden of [
    'from "node:',
    "NodeJS.",
    "Buffer",
    "Drizzle",
    "better-sqlite3",
  ]) {
    if (text.includes(forbidden))
      throw new Error(`${portableDeclaration} leaks ${forbidden}.`);
  }
}

const report = {
  formatVersion: "1",
  policy: {
    stableAlpha: "supported under the documented alpha compatibility policy",
    experimental:
      "public for research and low-level integration; may change between alpha releases",
    internal: "private workspace package; excluded from publication",
  },
  packages: inventory,
  internalPackages,
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;
await writeFile(
  resolve(root, "docs/public-api-inventory-alpha.3.json"),
  reportText,
  { encoding: "utf8", mode: 0o644 },
);
process.stdout.write(reportText);
