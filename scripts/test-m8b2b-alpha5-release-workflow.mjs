import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(".github/workflows/release.yml", "utf8");
const packageNames = [
  "@nicia-ai/lachesis",
  "@nicia-ai/lachesis-evidence",
  "@nicia-ai/lachesis-runtime",
  "@nicia-ai/lachesis-evidence-typegraph",
  "@nicia-ai/lachesis-generator",
  "@nicia-ai/lachesis-cli",
];

assert.match(workflow, /RELEASE_VERSION: 0\.1\.0-alpha\.5/);
assert.match(workflow, /RELEASE_TAG: v0\.1\.0-alpha\.5/);
assert.match(workflow, /RELEASE_NOTES: docs\/m8b2b-alpha5-release-notes\.md/);
assert.match(workflow, /RELEASE_CHECKSUMS: docs\/m8b2b-alpha5-release\.sha256/);
assert.match(workflow, /id-token: write/);
assert.match(workflow, /NPM_CONFIG_PROVENANCE: "true"/);
assert.match(workflow, /steps\.registry\.outputs\.state == 'absent'/);
assert.match(workflow, /test "\$present" -eq 0 && test "\$absent" -eq 6/);
assert.match(workflow, /test "\$present" -eq 6 && test "\$absent" -eq 0/);
assert.match(workflow, /pnpm test:coverage/);
assert.match(workflow, /scripts\/prepare-alpha5-tarballs\.mjs/);
assert.match(workflow, /docs\/m8b2b-alpha5-tarballs\.sha256/);
assert.doesNotMatch(workflow, /NPM_TOKEN|bootstrap-cli|cli-bootstrap-present/);

const publishLines = workflow
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("npm publish "));
assert.equal(publishLines.length, packageNames.length);
for (const name of packageNames) {
  const stem = name.slice(1).replace("/", "-");
  assert.equal(
    publishLines.filter((line) =>
      line.includes(`.release-packages/${stem}-$RELEASE_VERSION.tgz`),
    ).length,
    1,
  );
}

const timeoutSource = await readFile(
  "packages/evidence-typegraph/tests/parity.test.ts",
  "utf8",
);
assert.match(
  timeoutSource,
  /preserves compiler, visible-view, validation, and reconstruction identities[\s\S]*?\}, 40_000\);/,
);

process.stdout.write(
  `${JSON.stringify({
    protocol: "lachesis.m8b2b.alpha5.release-workflow-static-test.v1",
    packages: packageNames,
    publication: "not-performed",
    status: "pass",
  })}\n`,
);
