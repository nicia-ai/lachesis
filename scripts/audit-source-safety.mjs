import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const roots = ["packages", "apps", "compat"];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["dist", "coverage", "node_modules", ".wrangler"].includes(entry.name))
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (extname(entry.name) === ".ts") files.push(path);
  }
  return files;
}

const violations = [];
for (const sourceRoot of roots) {
  for (const path of await sourceFiles(resolve(root, sourceRoot))) {
    const text = await readFile(path, "utf8");
    const source = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const projectPath = relative(root, path);
    if (/@ts-(?:ignore|expect-error|nocheck)|eslint-disable/u.test(text))
      violations.push(`${projectPath}: suppression directive`);
    function visit(node) {
      if (node.kind === ts.SyntaxKind.AnyKeyword)
        violations.push(
          `${projectPath}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}: any`,
        );
      if (ts.isNonNullExpression(node))
        violations.push(
          `${projectPath}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}: non-null assertion`,
        );
      if (ts.isTypeAssertionExpression(node))
        violations.push(
          `${projectPath}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}: angle-bracket assertion`,
        );
      if (ts.isAsExpression(node) && ts.isAsExpression(node.expression))
        violations.push(
          `${projectPath}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}: double assertion`,
        );
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "JSON" &&
        node.expression.name.text === "parse" &&
        projectPath !== "packages/kernel/src/json.ts"
      )
        violations.push(
          `${projectPath}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}: raw JSON.parse`,
        );
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}

if (violations.length > 0)
  throw new Error(`Source-safety audit failed:\n${violations.join("\n")}`);

process.stdout.write(
  "Source-safety audit passed: no any, double assertions, non-null assertions, suppressions, or stray JSON.parse.\n",
);
