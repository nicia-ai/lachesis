import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const files = [
  ".github/workflows/bootstrap-cli.yml",
  "docs/m8b2b1-authorization-texts.md",
  "docs/m8b2b1-bootstrap-correction.json",
  "docs/m8b2b1-results.md",
  "scripts/prepare-m8b2b1-checksums.mjs",
  "scripts/test-m8b2b1-bootstrap.mjs",
  "scripts/verify-cli-bootstrap.mjs",
];

const lines = [];
for (const file of files) {
  const digest = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  lines.push(`${digest}  ${file}`);
}
await writeFile("docs/m8b2b1-results.sha256", `${lines.join("\n")}\n`, {
  encoding: "utf8",
  flag: "w",
  mode: 0o644,
});
