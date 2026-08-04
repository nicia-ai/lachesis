import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  M9B13D_QUARANTINE,
  scanM9b13dOciLayout,
} from "../internal/m9b13d-oci-inventory-scanner.js";
import {
  M9B13D_HELPER_EXECUTABLE_SHA256,
  type M9b13dSyntheticArtifact,
  runM9b13dSyntheticIntegration,
} from "../internal/m9b13d-synthetic-integration.js";
import {
  buildM9b13dHelper,
  createSyntheticSpdx,
  type SyntheticOciFixture,
  writeSyntheticOciLayout,
} from "./m9b13d-fixtures.js";

let suiteRoot = "";
let helperPath = "";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function artifacts(
  fixture: SyntheticOciFixture,
): Promise<ReadonlyArray<M9b13dSyntheticArtifact>> {
  const metadataPaths = ["oci-layout", "index.json"];
  const metadata = await Promise.all(
    metadataPaths.map(async (path) => {
      const bytes = await readFile(join(fixture.root, path));
      return { path, bytes, expectedSha256: sha256(bytes) };
    }),
  );
  return [
    ...metadata,
    ...fixture.blobs.map((blob) => ({
      path: `blobs/sha256/${blob.digest}`,
      bytes: blob.bytes,
      expectedSha256: sha256(blob.bytes),
    })),
  ];
}

async function sourceFixture(name: string): Promise<
  Readonly<{
    fixture: SyntheticOciFixture;
    attachedSpdx: unknown;
    artifacts: ReadonlyArray<M9b13dSyntheticArtifact>;
  }>
> {
  const root = join(suiteRoot, `${name}-source`);
  await mkdir(root, { mode: 0o700 });
  const fixture = await writeSyntheticOciLayout(root);
  const inventory = await scanM9b13dOciLayout(root);
  if (!inventory.ok) throw new Error(inventory.error.reason);
  return {
    fixture,
    attachedSpdx: createSyntheticSpdx(inventory.value),
    artifacts: await artifacts(fixture),
  };
}

async function targetParent(name: string): Promise<string> {
  const path = join(suiteRoot, `${name}-target`);
  await mkdir(path, { mode: 0o700 });
  return realpath(path);
}

function expectIntegrationFailure(result: unknown, reason: string): void {
  expect(result).toEqual({
    ok: false,
    error: {
      kind: "m9b13d-integration-failure",
      disposition: M9B13D_QUARANTINE,
      reason,
    },
  });
}

beforeAll(async () => {
  suiteRoot = await realpath(
    await mkdtemp(join(tmpdir(), "m9b13d-integration-suite-")),
  );
  helperPath = join(suiteRoot, "m9b13d-filesystem-helper");
  await buildM9b13dHelper(helperPath);
});

afterAll(async () => {
  if (suiteRoot !== "") await rm(suiteRoot, { recursive: true, force: true });
});

describe("M9b.13d synthetic OCI integration", () => {
  it("accounts, persists, seals, scans, and compares a synthetic OCI layout", async () => {
    const source = await sourceFixture("accepted");
    const parent = await targetParent("accepted");
    const result = await runM9b13dSyntheticIntegration({
      helperPath,
      parent,
      destination: "sealed-layout",
      artifacts: source.artifacts,
      attachedSpdx: source.attachedSpdx,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        protocol: "lachesis-m9b13d-synthetic-oci-integration/1",
        status: "accepted-synthetic-evidence",
        helperSha256: M9B13D_HELPER_EXECUTABLE_SHA256,
        files: source.artifacts.length,
      },
    });
    expect(
      await scanM9b13dOciLayout(join(parent, "sealed-layout")),
    ).toMatchObject({
      ok: true,
    });
  });

  it("returns the exact quarantine for attached-SPDX semantic mismatch", async () => {
    expect.hasAssertions();
    const source = await sourceFixture("spdx-mismatch");
    const inventory = await scanM9b13dOciLayout(source.fixture.root);
    if (!inventory.ok) throw new Error(inventory.error.reason);
    const result = await runM9b13dSyntheticIntegration({
      helperPath,
      parent: await targetParent("spdx-mismatch"),
      destination: "sealed-layout",
      artifacts: source.artifacts,
      attachedSpdx: createSyntheticSpdx(inventory.value, {
        omitLastPackage: true,
      }),
    });
    expectIntegrationFailure(result, "m9b13d:attached-sbom-semantic-mismatch");
  });

  it("rejects a byte or digest mismatch before creating a destination", async () => {
    expect.hasAssertions();
    const source = await sourceFixture("digest-mismatch");
    const parent = await targetParent("digest-mismatch");
    const first = source.artifacts[0];
    if (first === undefined)
      throw new Error("Synthetic fixture has no artifacts.");
    const result = await runM9b13dSyntheticIntegration({
      helperPath,
      parent,
      destination: "must-not-exist",
      artifacts: [
        { ...first, expectedSha256: "0".repeat(64) },
        ...source.artifacts.slice(1),
      ],
      attachedSpdx: source.attachedSpdx,
    });
    expectIntegrationFailure(result, "m9b13d:pre-persistence-digest-mismatch");
    await expect(lstat(join(parent, "must-not-exist"))).rejects.toThrow();
  });

  it("rejects an unfrozen helper executable before mutation", async () => {
    expect.hasAssertions();
    const source = await sourceFixture("helper-mismatch");
    const altered = join(suiteRoot, "altered-helper");
    await copyFile(helperPath, altered);
    await writeFile(altered, "not-the-helper", { mode: 0o700 });
    const result = await runM9b13dSyntheticIntegration({
      helperPath: altered,
      parent: await targetParent("helper-mismatch"),
      destination: "must-not-exist",
      artifacts: source.artifacts,
      attachedSpdx: source.attachedSpdx,
    });
    expectIntegrationFailure(result, "m9b13d:helper-identity-mismatch");
  });

  it("rejects duplicate artifact paths before helper dispatch", async () => {
    expect.hasAssertions();
    const source = await sourceFixture("duplicates");
    const first = source.artifacts[0];
    if (first === undefined)
      throw new Error("Synthetic fixture has no artifacts.");
    const result = await runM9b13dSyntheticIntegration({
      helperPath,
      parent: await targetParent("duplicates"),
      destination: "must-not-exist",
      artifacts: [...source.artifacts, first],
      attachedSpdx: source.attachedSpdx,
    });
    expectIntegrationFailure(result, "m9b13d:duplicate-integration-path");
  });

  it("never accepts the real prospective root in synthetic mode", async () => {
    expect.hasAssertions();
    const source = await sourceFixture("real-root");
    const result = await runM9b13dSyntheticIntegration({
      helperPath,
      parent: "/Users/paul/orgs/nicia",
      destination:
        "lachesis-private/m9b13c-oci-acquisition/v1/docker.io/library/node/24.18.1-bookworm-slim/linux-arm64-v8",
      artifacts: source.artifacts,
      attachedSpdx: source.attachedSpdx,
    });
    expectIntegrationFailure(
      result,
      "m9b13d:real-root-forbidden-in-synthetic-mode",
    );
  });
});
