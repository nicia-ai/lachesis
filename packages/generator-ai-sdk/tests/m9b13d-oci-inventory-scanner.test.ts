import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalizeM9b13dJson,
  compareM9b13dSpdxInventory,
  M9B13D_QUARANTINE,
  scanM9b13dOciLayout,
} from "../internal/m9b13d-oci-inventory-scanner.js";
import {
  createSyntheticSpdx,
  type SyntheticOciOptions,
  type SyntheticTarEntry,
  writeSyntheticOciLayout,
} from "./m9b13d-fixtures.js";

const temporaryRoots: Array<string> = [];

async function fixture(options: SyntheticOciOptions = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "m9b13d-scanner-"));
  temporaryRoots.push(root);
  await writeSyntheticOciLayout(root, options);
  return root;
}

function expectFailure(result: unknown, reason: string): void {
  expect(result).toEqual({
    ok: false,
    error: {
      kind: "m9b13d-scanner-failure",
      disposition: M9B13D_QUARANTINE,
      reason,
    },
  });
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("M9b.13d sealed OCI inventory scanner", () => {
  it("derives deterministic Debian and Node inventory without image execution", async () => {
    const root = await fixture();
    const first = await scanM9b13dOciLayout(root);
    const second = await scanM9b13dOciLayout(root);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      value: {
        architecture: "arm64",
        node: { name: "node", version: "24.18.1", architecture: "arm64" },
        debianPackages: [
          {
            name: "libc6",
            architecture: "arm64",
            version: { raw: "2:2.41-12", epoch: "2", revision: "12" },
            sourceName: "glibc",
          },
          {
            name: "zlib1g",
            architecture: "arm64",
            version: {
              raw: "1:1.3.dfsg+really1.3.1-1+b1",
              epoch: "1",
              revision: "1+b1",
            },
          },
        ],
      },
    });
    if (!first.ok || !second.ok) throw new Error("Expected successful scans.");
    expect(canonicalizeM9b13dJson(first.value)).toBe(
      canonicalizeM9b13dJson(second.value),
    );
  });

  it("applies OCI whiteouts before replacement entries", async () => {
    const status = (version: string): Uint8Array =>
      new TextEncoder().encode(
        `Package: synthetic\nStatus: install ok installed\nVersion: ${version}\nArchitecture: arm64\n`,
      );
    const nodeEntries: ReadonlyArray<SyntheticTarEntry> = [
      { path: "usr/local/bin/node", content: new Uint8Array([1]) },
      {
        path: "usr/local/include/node/node_version.h",
        content: new TextEncoder().encode(
          "#define NODE_MAJOR_VERSION 24\n#define NODE_MINOR_VERSION 18\n#define NODE_PATCH_VERSION 1\n",
        ),
      },
    ];
    const root = await fixture({
      layers: [
        [
          { path: "var/lib/dpkg/status", content: status("1.0-1") },
          ...nodeEntries,
        ],
        [
          { path: "var/lib/dpkg/.wh.status", content: new Uint8Array() },
          { path: "var/lib/dpkg/status", content: status("2.0-1") },
        ],
      ],
    });
    const result = await scanM9b13dOciLayout(root);
    expect(result).toMatchObject({
      ok: true,
      value: { debianPackages: [{ version: { raw: "2.0-1" } }] },
    });
  });

  it.each([
    [
      "absolute path",
      "/etc/passwd",
      "file",
      undefined,
      "m9b13d:unsafe-tar-path",
    ],
    ["dot-dot path", "a/../b", "file", undefined, "m9b13d:unsafe-tar-path"],
    [
      "device",
      "dev/synthetic",
      "device",
      undefined,
      "m9b13d:device-or-socket-tar-entry",
    ],
    [
      "socket",
      "run/synthetic",
      "socket",
      undefined,
      "m9b13d:device-or-socket-tar-entry",
    ],
    [
      "escaping link",
      "safe/link",
      "symlink",
      "../../escape",
      "m9b13d:unsafe-tar-link",
    ],
  ] as const)(
    "rejects %s tar entries",
    async (_name, path, type, target, reason) => {
      expect.hasAssertions();
      const root = await fixture({
        layers: [
          [
            {
              path,
              type,
              ...(target === undefined ? {} : { target }),
            },
          ],
        ],
      });
      expectFailure(await scanM9b13dOciLayout(root), reason);
    },
  );

  it("rejects conflicting duplicate tar entries", async () => {
    expect.hasAssertions();
    const root = await fixture({
      layers: [
        [
          { path: "duplicate", content: new Uint8Array([1]) },
          { path: "duplicate", content: new Uint8Array([2]) },
        ],
      ],
    });
    expectFailure(
      await scanM9b13dOciLayout(root),
      "m9b13d:duplicate-tar-entry",
    );
  });

  it("rejects an unsealed layout", async () => {
    expect.hasAssertions();
    const root = await fixture();
    await rm(join(root, ".m9b13d-sealed"));
    expectFailure(
      await scanM9b13dOciLayout(root),
      "m9b13d:missing-or-unreadable-oci-file",
    );
  });

  it("rejects malformed index JSON", async () => {
    expect.hasAssertions();
    const root = await fixture();
    await writeFile(join(root, "index.json"), "{", { mode: 0o600 });
    expectFailure(await scanM9b13dOciLayout(root), "m9b13d:malformed-json");
  });

  it("rejects a symlinked OCI metadata file", async () => {
    expect.hasAssertions();
    const root = await fixture();
    await rm(join(root, "index.json"));
    await symlink("oci-layout", join(root, "index.json"));
    expectFailure(
      await scanM9b13dOciLayout(root),
      "m9b13d:nonregular-or-aliased-oci-file",
    );
  });

  it("rejects extra selected manifests", async () => {
    expect.hasAssertions();
    const root = await fixture({ extraIndexManifest: true });
    expectFailure(
      await scanM9b13dOciLayout(root),
      "m9b13d:extra-selected-manifest",
    );
  });

  it("rejects duplicate or cyclic descriptor identities", async () => {
    expect.hasAssertions();
    const root = await fixture({ duplicateLayerDescriptor: true });
    expectFailure(
      await scanM9b13dOciLayout(root),
      "m9b13d:duplicate-or-cyclic-descriptor",
    );
  });

  it("rejects unsupported layer compression", async () => {
    expect.hasAssertions();
    const root = await fixture({
      layerMediaTypeOverride: "application/vnd.oci.image.layer.v1.tar+zstd",
    });
    expectFailure(
      await scanM9b13dOciLayout(root),
      "m9b13d:unsupported-layer-compression",
    );
  });

  it("rejects declared descriptor size mismatch", async () => {
    expect.hasAssertions();
    const root = await fixture({ layerDeclaredSizeDelta: 1 });
    expectFailure(
      await scanM9b13dOciLayout(root),
      "m9b13d:descriptor-size-mismatch",
    );
  });

  it("rejects config diff-id substitution", async () => {
    expect.hasAssertions();
    const root = await fixture({ wrongDiffId: true });
    expectFailure(
      await scanM9b13dOciLayout(root),
      "m9b13d:layer-diff-id-mismatch",
    );
  });

  it("rejects malformed tar header checksums", async () => {
    expect.hasAssertions();
    const root = await fixture({ corruptTarHeader: true });
    expectFailure(
      await scanM9b13dOciLayout(root),
      "m9b13d:tar-checksum-mismatch",
    );
  });

  it("rejects unreferenced blob substitutions", async () => {
    expect.hasAssertions();
    const root = await fixture({ extraBlob: true });
    expectFailure(
      await scanM9b13dOciLayout(root),
      "m9b13d:unreferenced-or-substituted-blob",
    );
  });

  it("rejects descriptor byte changes", async () => {
    const root = await fixture();
    const entries = await writeSyntheticOciLayout(
      await mkdtemp(join(tmpdir(), "m9b13d-discarded-fixture-")),
    );
    temporaryRoots.push(entries.root);
    const layer = entries.blobs[0];
    expect(layer).toBeDefined();
    if (layer !== undefined)
      await writeFile(
        join(root, "blobs", "sha256", layer.digest),
        new Uint8Array(layer.bytes.byteLength),
        { mode: 0o600 },
      );
    expectFailure(
      await scanM9b13dOciLayout(root),
      "m9b13d:descriptor-digest-mismatch",
    );
  });

  it("rejects missing Node installation evidence", async () => {
    expect.hasAssertions();
    const root = await fixture({
      layers: [
        [
          {
            path: "var/lib/dpkg/status",
            content: new TextEncoder().encode(
              "Package: libc6\nStatus: install ok installed\nVersion: 1-1\nArchitecture: arm64\n",
            ),
          },
        ],
      ],
    });
    expectFailure(
      await scanM9b13dOciLayout(root),
      "m9b13d:missing-node-installation-evidence",
    );
  });
});

describe("M9b.13d frozen SPDX comparison", () => {
  async function scanned(): Promise<
    Extract<
      Awaited<ReturnType<typeof scanM9b13dOciLayout>>,
      { ok: true }
    >["value"]
  > {
    const result = await scanM9b13dOciLayout(await fixture());
    if (!result.ok) throw new Error(result.error.reason);
    return result.value;
  }

  it("accepts exact one-to-one inventory equality deterministically", async () => {
    const inventory = await scanned();
    const spdx = createSyntheticSpdx(inventory);
    const first = compareM9b13dSpdxInventory(inventory, spdx);
    const second = compareM9b13dSpdxInventory(inventory, spdx);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true });
  });

  it.each([
    [
      "missing entry",
      { omitLastPackage: true },
      "m9b13d:attached-sbom-semantic-mismatch",
    ],
    [
      "duplicate entry",
      { duplicateFirstPackage: true },
      "m9b13d:duplicate-spdx-package-identity",
    ],
    [
      "field mismatch",
      { wrongFirstVersion: true },
      "m9b13d:spdx-package-field-mismatch",
    ],
    [
      "missing relationship",
      { omitLastRelationship: true },
      "m9b13d:spdx-relationship-mismatch",
    ],
    [
      "unsupported purl",
      { unsupportedFirstPurl: true },
      "m9b13d:unsupported-spdx-purl",
    ],
    [
      "caller-selected ignored field",
      { extraDocumentField: true },
      "m9b13d:unsupported-or-malformed-inventory-representation",
    ],
  ] as const)("quarantines %s", async (_name, options, reason) => {
    expect.hasAssertions();
    const inventory = await scanned();
    expectFailure(
      compareM9b13dSpdxInventory(
        inventory,
        createSyntheticSpdx(inventory, options),
      ),
      reason,
    );
  });

  it("rejects a caller-supplied comparison-policy argument", async () => {
    expect.hasAssertions();
    const inventory = await scanned();
    expectFailure(
      Reflect.apply(compareM9b13dSpdxInventory, undefined, [
        inventory,
        createSyntheticSpdx(inventory),
        { ignorePackages: true },
      ]),
      "m9b13d:comparison-policy-override",
    );
  });
});
