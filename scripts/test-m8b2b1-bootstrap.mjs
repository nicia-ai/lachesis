import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

import {
  verifyPackageSet,
  verifyPublishedRegistryState,
  verifyRegistryAbsent,
} from "./verify-cli-bootstrap.mjs";

const root = new URL("../", import.meta.url).pathname;
const workflow = await readFile(
  new URL("../.github/workflows/bootstrap-cli.yml", import.meta.url),
  "utf8",
);

assert.match(workflow, /runs-on: ubuntu-24\.04/);
assert.match(workflow, /contents: read/);
assert.match(workflow, /id-token: write/);
assert.match(workflow, /cancel-in-progress: false/);
assert.match(workflow, /git cat-file -t "\$RELEASE_TAG"/);
assert.equal((workflow.match(/\bnpm publish\b/g) ?? []).length, 1);
assert.match(workflow, /nicia-ai-lachesis-cli-\$RELEASE_VERSION\.tgz/);
assert.doesNotMatch(workflow, /npm trust/);
assert.doesNotMatch(workflow, /npm publish.*lachesis-evidence/);
assert.doesNotMatch(workflow, /npm publish.*lachesis-generator/);
assert.doesNotMatch(workflow, /npm publish.*lachesis-runtime/);
assert.match(workflow, /--ignore-scripts/);
assert.match(workflow, /secrets\.NPM_TOKEN/);
assert.equal((workflow.match(/secrets\.NPM_TOKEN/g) ?? []).length, 1);
assert.doesNotMatch(workflow, /NPM_TOKEN.*(?:echo|printf|tee|cat)/);

await verifyPackageSet(root);

const withServer = async (handler, action) => {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address !== null && typeof address === "object");
  try {
    return await action(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
  }
};

await withServer(
  (_request, response) => {
    response.writeHead(404, { "content-type": "application/json" });
    response.end("{}");
  },
  async (registry) => {
    assert.deepEqual(await verifyRegistryAbsent(registry), {
      absent: 6,
      version: "0.1.0-alpha.4",
    });
  },
);

await withServer(
  (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  },
  async (registry) => {
    await assert.rejects(
      verifyRegistryAbsent(registry),
      /absence check returned HTTP 200/,
    );
  },
);

await withServer(
  (_request, response) => {
    response.writeHead(503, { "content-type": "application/json" });
    response.end("{}");
  },
  async (registry) => {
    await assert.rejects(
      verifyRegistryAbsent(registry),
      /absence check returned HTTP 503/,
    );
  },
);

const fakeTarball = Buffer.from("wrong tarball");
await withServer(
  (request, response) => {
    if (request.url?.includes("lachesis-cli")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          name: "@nicia-ai/lachesis-cli",
          version: "0.1.0-alpha.4",
          dist: {
            attestations: { url: "http://invalid.example/attestations" },
            signatures: [{ keyid: "test", sig: "test" }],
            tarball: "http://invalid.example/tarball",
          },
        }),
      );
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end("{}");
  },
  async (registry) => {
    await assert.rejects(
      verifyPublishedRegistryState({
        registry,
        sourceCommit: "635521f1d2e753095fca4fdbbafbf7ed2287efe1",
        workflowCommit: "0".repeat(40),
        fetchImplementation: async (url, options) => {
          if (url === "http://invalid.example/tarball") {
            return new Response(fakeTarball);
          }
          return fetch(url, options);
        },
      }),
      /tarball digest mismatch/,
    );
  },
);

console.log(
  "M8b.2b.1 bootstrap tests passed: allowlist, sole publish path, concurrency, absence guards, and registry digest failure.",
);
