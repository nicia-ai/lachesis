import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const paths = [
  ".changeset/m8b2b-alpha5.release.json",
  ".github/workflows/release.yml",
  "README.md",
  "apps/cli/CHANGELOG.md",
  "apps/cli/LICENSE",
  "apps/cli/README.md",
  "apps/cli/package.json",
  "apps/cli/src/cli.ts",
  "docs/m8b2b-alpha5-package-delta.json",
  "docs/m8b2b-alpha5-registry-expectations.json",
  "docs/m8b2b-alpha5-registry-preflight.json",
  "docs/m8b2b-alpha5-release-notes.md",
  "docs/m8b2b-alpha5-results.md",
  "docs/m8b2b-alpha5-tarball-inventory.json",
  "docs/m8b2b-alpha5-tarballs.sha256",
  "docs/m8b2b-alpha5-verification.json",
  "docs/m8b2b-alpha5-workflow-binding.json",
  "docs/m8b2b9-parity-correction.sha256",
  "docs/m8b2b9-results.sha256",
  "docs/public-alpha.md",
  "docs/public-api-inventory-alpha.5.json",
  "docs/roadmap.md",
  "packages/evidence/CHANGELOG.md",
  "packages/evidence/package.json",
  "packages/evidence-typegraph/CHANGELOG.md",
  "packages/evidence-typegraph/package.json",
  "packages/evidence-typegraph/tests/parity.test.ts",
  "packages/generator/CHANGELOG.md",
  "packages/generator/package.json",
  "packages/kernel/CHANGELOG.md",
  "packages/kernel/package.json",
  "packages/runtime/CHANGELOG.md",
  "packages/runtime/package.json",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/audit-alpha5-registry-state.mjs",
  "scripts/audit-packed-packages-alpha5.mjs",
  "scripts/audit-public-api.mjs",
  "scripts/prepare-alpha5-release-checksums.mjs",
  "scripts/prepare-alpha5-tarballs.mjs",
  "scripts/set-cli-bin-mode.mjs",
  "scripts/test-m8b2b-alpha5-consumer.mjs",
  "scripts/test-m8b2b-alpha5-linux.mjs",
  "scripts/test-m8b2b-alpha5-release-workflow.mjs",
].toSorted();

const lines = [];
for (const path of paths) {
  const bytes = await readFile(resolve(root, path));
  lines.push(`${createHash("sha256").update(bytes).digest("hex")}  ${path}`);
}
await writeFile(
  resolve(root, "docs/m8b2b-alpha5-release.sha256"),
  `${lines.join("\n")}\n`,
  { encoding: "utf8", mode: 0o644 },
);
