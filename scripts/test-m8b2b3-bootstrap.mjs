import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(
  new URL("../.github/workflows/bootstrap-cli.yml", import.meta.url),
  "utf8",
);

const job = (name, nextName) => {
  const start = workflow.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `missing ${name} job`);
  const end =
    nextName === undefined
      ? workflow.length
      : workflow.indexOf(`  ${nextName}:\n`, start);
  assert.notEqual(end, -1, `missing ${nextName} job`);
  return workflow.slice(start, end);
};

const step = (jobBytes, name, nextName) => {
  const start = jobBytes.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `missing ${name} step`);
  const end =
    nextName === undefined
      ? jobBytes.length
      : jobBytes.indexOf(`      - name: ${nextName}\n`, start);
  assert.notEqual(end, -1, `missing ${nextName} step`);
  return jobBytes.slice(start, end);
};

const verifyDraft = job("verify-draft", "bootstrap-cli");
const bootstrapCli = job("bootstrap-cli");
const publish = step(
  bootstrapCli,
  "Publish exactly the first CLI version",
  "Verify the sole registry mutation",
);

assert.match(verifyDraft, /permissions:\n {6}contents: write\n/);
assert.doesNotMatch(verifyDraft, /id-token:/);
assert.doesNotMatch(verifyDraft, /secrets\.NPM_TOKEN/);
assert.doesNotMatch(verifyDraft, /\bNPM_TOKEN\b/);
assert.doesNotMatch(verifyDraft, /\bnpm publish\b/);
assert.doesNotMatch(verifyDraft, /actions\/setup-node|pnpm\/action-setup/);
assert.equal((verifyDraft.match(/\bgh api\b/g) ?? []).length, 1);
assert.match(verifyDraft, /gh api \\\n\s+--method GET \\/);
assert.doesNotMatch(
  verifyDraft,
  /\bgh (?:release|api\b[\s\S]*?--method (?:POST|PUT|PATCH|DELETE))\b/,
);

assert.match(bootstrapCli, /needs: verify-draft/);
assert.match(
  bootstrapCli,
  /permissions:\n {6}contents: read\n {6}id-token: write\n/,
);
assert.doesNotMatch(bootstrapCli, /contents: write/);
assert.equal((workflow.match(/secrets\.NPM_TOKEN/g) ?? []).length, 1);
assert.equal((publish.match(/secrets\.NPM_TOKEN/g) ?? []).length, 1);
assert.doesNotMatch(
  bootstrapCli.slice(0, bootstrapCli.indexOf(publish)),
  /secrets\.NPM_TOKEN/,
);
assert.doesNotMatch(
  bootstrapCli.slice(bootstrapCli.indexOf(publish) + publish.length),
  /secrets\.NPM_TOKEN/,
);
assert.equal((workflow.match(/\bnpm publish\b/g) ?? []).length, 1);
assert.match(publish, /--ignore-scripts/);
assert.match(publish, /--tag alpha/);
assert.match(publish, /--access public/);
assert.match(publish, /--provenance/);

for (const binding of [
  "635521f1d2e753095fca4fdbbafbf7ed2287efe1",
  "0.1.0-alpha.4",
  "v0.1.0-alpha.4",
  "Lachesis 0.1.0-alpha.4",
  "359550250",
  "bec6a90f3c7683e3d66d10607ebfb4891105abb25064c5feae14e59196fc1a02",
  "f9586fd9554fbe78fd88ab28400d2a04fe78792196d17f5d7f74558f33d3e638",
]) {
  assert.match(workflow, new RegExp(binding.replaceAll(".", String.raw`\.`)));
}

for (const output of [
  "cli-tarball-sha256",
  "draft-release-id",
  "registry-absence",
  "release-body-sha256",
  "release-commit",
  "release-tag",
]) {
  assert.match(verifyDraft, new RegExp(`steps\\.bind\\.outputs\\.${output}`));
  assert.match(
    bootstrapCli,
    new RegExp(`needs\\.verify-draft\\.outputs\\.${output}`),
  );
}

assert.ok(
  workflow.indexOf("  verify-draft:\n") <
    workflow.indexOf("  bootstrap-cli:\n"),
);
assert.match(bootstrapCli, /Require all six alpha\.4 versions to be absent/);
assert.match(bootstrapCli, /Verify the sole registry mutation/);

console.log(
  "M8b.2b.3 bootstrap privilege-split tests passed: write/read separation, GET-only draft verification, secret confinement, dependency gating, and frozen bindings.",
);
