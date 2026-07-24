import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const paths = [
  ".github/workflows/bootstrap-cli.yml",
  "docs/m8b2b3-authorization-texts.md",
  "docs/m8b2b3-bootstrap-correction.json",
  "docs/m8b2b3-results.md",
  "scripts/prepare-m8b2b3-checksums.mjs",
  "scripts/test-m8b2b3-bootstrap.mjs",
];

const lines = [];
for (const path of paths) {
  const digest = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  lines.push(`${digest}  ${path}`);
}

await writeFile("docs/m8b2b3-results.sha256", `${lines.join("\n")}\n`, {
  flag: "wx",
});
