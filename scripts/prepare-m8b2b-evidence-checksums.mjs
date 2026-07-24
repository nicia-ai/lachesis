import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const paths = [
  ".github/workflows/release.yml",
  "docs/m8b2b-alpha4-release.sha256",
  "docs/m8b2b-alpha4-tarball-inventory.json",
  "docs/m8b2b-alpha4-tarballs.sha256",
  "docs/m8b2b-alpha4-verification.json",
  "docs/m8b2b-alpha4-workflow-binding.json",
  "docs/m8b2b-authorization-texts.md",
  "docs/m8b2b-results.md",
  "docs/public-api-inventory-alpha.4.json",
  "scripts/prepare-m8b2b-evidence-checksums.mjs",
].toSorted();

const lines = [];
for (const path of paths) {
  const bytes = await readFile(resolve(root, path));
  lines.push(`${createHash("sha256").update(bytes).digest("hex")}  ${path}`);
}
await writeFile(
  resolve(root, "docs/m8b2b-results.sha256"),
  `${lines.join("\n")}\n`,
  { encoding: "utf8", mode: 0o644 },
);
