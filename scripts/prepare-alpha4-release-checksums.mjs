import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const paths = [
  ".changeset/m8b2b-alpha4.release.json",
  ".github/workflows/release.yml",
  "README.md",
  "apps/cli/CHANGELOG.md",
  "apps/cli/LICENSE",
  "apps/cli/README.md",
  "apps/cli/package.json",
  "apps/cli/src/cli.ts",
  "docs/m8b2b-alpha4-package-delta.json",
  "docs/m8b2b-alpha4-registry-expectations.json",
  "docs/m8b2b-alpha4-registry-preflight.json",
  "docs/m8b2b-alpha4-release-notes.md",
  "docs/m8b2b-alpha4-tarball-inventory.json",
  "docs/m8b2b-alpha4-tarballs.sha256",
  "docs/m8b2b-first-cli-publication.md",
  "docs/public-alpha.md",
  "docs/public-api-inventory-alpha.4.json",
  "docs/roadmap.md",
  "packages/evidence/CHANGELOG.md",
  "packages/evidence/package.json",
  "packages/evidence-typegraph/CHANGELOG.md",
  "packages/evidence-typegraph/package.json",
  "packages/generator/CHANGELOG.md",
  "packages/generator/package.json",
  "packages/kernel/CHANGELOG.md",
  "packages/kernel/package.json",
  "packages/runtime/CHANGELOG.md",
  "packages/runtime/package.json",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/audit-alpha4-registry-state.mjs",
  "scripts/audit-packed-packages.mjs",
  "scripts/audit-public-api.mjs",
  "scripts/prepare-alpha4-release-checksums.mjs",
  "scripts/prepare-alpha4-tarballs.mjs",
  "scripts/set-cli-bin-mode.mjs",
  "scripts/test-m8b2b-alpha4-consumer.mjs",
  "scripts/test-m8b2b-alpha4-linux.mjs",
].toSorted();

const lines = [];
for (const path of paths) {
  const bytes = await readFile(resolve(root, path));
  lines.push(`${createHash("sha256").update(bytes).digest("hex")}  ${path}`);
}
await writeFile(
  resolve(root, "docs/m8b2b-alpha4-release.sha256"),
  `${lines.join("\n")}\n`,
  { encoding: "utf8", mode: 0o644 },
);
