import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import type { M9b13dInventory } from "../internal/m9b13d-oci-inventory-scanner.js";

const execFileAsync = promisify(execFile);

export const M9B13D_HELPER_COMPILER =
  "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang" as const;
export const M9B13D_HELPER_SDK =
  "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk" as const;
export const M9B13D_HELPER_FLAGS = Object.freeze([
  "-std=c17",
  "-O2",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-Wno-deprecated-declarations",
  "-fno-common",
  "-fstack-protector-strong",
  "-D_FORTIFY_SOURCE=2",
  "-mmacosx-version-min=26.0",
  "-isysroot",
  M9B13D_HELPER_SDK,
]);

export async function buildM9b13dHelper(output: string): Promise<void> {
  await execFileAsync(M9B13D_HELPER_COMPILER, [
    ...M9B13D_HELPER_FLAGS,
    join(
      process.cwd(),
      "packages/generator-ai-sdk/internal/native/m9b13d-filesystem-helper.c",
    ),
    "-o",
    output,
  ]);
}

export type SyntheticTarEntry = Readonly<{
  path: string;
  content?: Uint8Array;
  type?: "file" | "directory" | "symlink" | "hardlink" | "device" | "socket";
  target?: string;
}>;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeAscii(
  target: Uint8Array,
  offset: number,
  length: number,
  text: string,
): void {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > length)
    throw new Error("Synthetic tar field overflow.");
  target.set(bytes, offset);
}

function writeOctal(
  target: Uint8Array,
  offset: number,
  length: number,
  value: number,
): void {
  const text = value.toString(8).padStart(length - 1, "0");
  writeAscii(target, offset, length, `${text}\0`);
}

function tarHeader(entry: SyntheticTarEntry): Uint8Array {
  const header = new Uint8Array(512);
  const type = entry.type ?? "file";
  const content = entry.content ?? new Uint8Array();
  writeAscii(header, 0, 100, entry.path);
  writeOctal(header, 100, 8, type === "directory" ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, type === "file" ? content.byteLength : 0);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] =
    type === "file"
      ? 0x30
      : type === "directory"
        ? 0x35
        : type === "symlink"
          ? 0x32
          : type === "hardlink"
            ? 0x31
            : type === "device"
              ? 0x33
              : 0x36;
  if (entry.target !== undefined) writeAscii(header, 157, 100, entry.target);
  writeAscii(header, 257, 6, "ustar\0");
  writeAscii(header, 263, 2, "00");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeAscii(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

export function createSyntheticTar(
  entries: ReadonlyArray<SyntheticTarEntry>,
): Uint8Array {
  const parts: Array<Uint8Array> = [];
  for (const entry of entries) {
    const content = entry.content ?? new Uint8Array();
    parts.push(tarHeader(entry));
    if ((entry.type ?? "file") === "file") {
      parts.push(content);
      const padding = (512 - (content.byteLength % 512)) % 512;
      if (padding !== 0) parts.push(new Uint8Array(padding));
    }
  }
  parts.push(new Uint8Array(1024));
  const bytes = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

const DEFAULT_DPKG_STATUS = `Package: libc6
Status: install ok installed
Version: 2:2.41-12
Architecture: arm64
Source: glibc (2.41-12)

Package: zlib1g
Status: install ok installed
Version: 1:1.3.dfsg+really1.3.1-1+b1
Architecture: arm64
`;

const DEFAULT_NODE_HEADER = `#define NODE_MAJOR_VERSION 24
#define NODE_MINOR_VERSION 18
#define NODE_PATCH_VERSION 1
`;

export type SyntheticOciOptions = Readonly<{
  layers?: ReadonlyArray<ReadonlyArray<SyntheticTarEntry>>;
  compression?: "gzip" | "none";
  architecture?: "amd64" | "arm64";
  extraIndexManifest?: boolean;
  extraBlob?: boolean;
  duplicateLayerDescriptor?: boolean;
  layerMediaTypeOverride?: string;
  layerDeclaredSizeDelta?: number;
  corruptTarHeader?: boolean;
  wrongDiffId?: boolean;
}>;

export type SyntheticOciFixture = Readonly<{
  root: string;
  imageManifestDigest: `sha256:${string}`;
  blobs: ReadonlyArray<Readonly<{ digest: string; bytes: Uint8Array }>>;
}>;

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

export async function writeSyntheticOciLayout(
  root: string,
  options: SyntheticOciOptions = {},
): Promise<SyntheticOciFixture> {
  const architecture = options.architecture ?? "arm64";
  const compression = options.compression ?? "gzip";
  const layers = options.layers ?? [
    [
      {
        path: "var/lib/dpkg/status",
        content: new TextEncoder().encode(DEFAULT_DPKG_STATUS),
      },
      {
        path: "usr/local/bin/node",
        content: new TextEncoder().encode("synthetic-node-binary"),
      },
      {
        path: "usr/local/include/node/node_version.h",
        content: new TextEncoder().encode(DEFAULT_NODE_HEADER),
      },
    ],
  ];
  await mkdir(join(root, "blobs", "sha256"), { recursive: true, mode: 0o700 });
  const blobs: Array<Readonly<{ digest: string; bytes: Uint8Array }>> = [];
  const layerDescriptors = [];
  const diffIds = [];
  for (const [layerIndex, entries] of layers.entries()) {
    const tar = createSyntheticTar(entries);
    if (options.corruptTarHeader === true && layerIndex === 0)
      tar[0] = (tar[0] ?? 0) ^ 1;
    const bytes = compression === "gzip" ? gzipSync(tar) : tar;
    const digest = sha256(bytes);
    await writeFile(join(root, "blobs", "sha256", digest), bytes, {
      mode: 0o600,
    });
    blobs.push({ digest, bytes });
    layerDescriptors.push({
      mediaType:
        options.layerMediaTypeOverride ??
        (compression === "gzip"
          ? "application/vnd.oci.image.layer.v1.tar+gzip"
          : "application/vnd.oci.image.layer.v1.tar"),
      digest: `sha256:${digest}`,
      size:
        bytes.byteLength +
        (layerIndex === 0 ? (options.layerDeclaredSizeDelta ?? 0) : 0),
    });
    diffIds.push(
      options.wrongDiffId === true && layerIndex === 0
        ? `sha256:${"0".repeat(64)}`
        : `sha256:${sha256(tar)}`,
    );
  }
  if (
    options.duplicateLayerDescriptor === true &&
    layerDescriptors[0] !== undefined
  ) {
    layerDescriptors.push(layerDescriptors[0]);
    diffIds.push(diffIds[0] ?? `sha256:${"0".repeat(64)}`);
  }
  const config = jsonBytes({
    architecture,
    os: "linux",
    config: { Env: ["SYNTHETIC=true"] },
    rootfs: { type: "layers", diff_ids: diffIds },
  });
  const configDigest = sha256(config);
  await writeFile(join(root, "blobs", "sha256", configDigest), config, {
    mode: 0o600,
  });
  blobs.push({ digest: configDigest, bytes: config });
  const manifest = jsonBytes({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: {
      mediaType: "application/vnd.oci.image.config.v1+json",
      digest: `sha256:${configDigest}`,
      size: config.byteLength,
    },
    layers: layerDescriptors,
  });
  const manifestDigest = sha256(manifest);
  await writeFile(join(root, "blobs", "sha256", manifestDigest), manifest, {
    mode: 0o600,
  });
  blobs.push({ digest: manifestDigest, bytes: manifest });
  const descriptor = {
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: `sha256:${manifestDigest}`,
    size: manifest.byteLength,
    platform: { architecture, os: "linux" },
  };
  await writeFile(
    join(root, "index.json"),
    jsonBytes({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests: options.extraIndexManifest
        ? [descriptor, descriptor]
        : [descriptor],
    }),
    { mode: 0o600 },
  );
  await writeFile(
    join(root, "oci-layout"),
    jsonBytes({ imageLayoutVersion: "1.0.0" }),
    { mode: 0o600 },
  );
  await writeFile(join(root, ".m9b13d-sealed"), "lachesis-m9b13d-sealed/1\n", {
    mode: 0o600,
  });
  if (options.extraBlob === true)
    await writeFile(join(root, "blobs", "sha256", "0".repeat(64)), "extra", {
      mode: 0o600,
    });
  return {
    root,
    imageManifestDigest: `sha256:${manifestDigest}`,
    blobs,
  };
}

function purl(
  kind: "debian-binary" | "node-runtime",
  name: string,
  version: string,
  architecture: string,
): string {
  const type = kind === "debian-binary" ? "deb/debian" : "generic";
  return `pkg:${type}/${encodeURIComponent(name)}@${encodeURIComponent(version)}?arch=${architecture}`;
}

export type SyntheticSpdxOptions = Readonly<{
  omitLastPackage?: boolean;
  duplicateFirstPackage?: boolean;
  wrongFirstVersion?: boolean;
  omitLastRelationship?: boolean;
  extraDocumentField?: boolean;
  unsupportedFirstPurl?: boolean;
}>;

export function createSyntheticSpdx(
  inventory: M9b13dInventory,
  options: SyntheticSpdxOptions = {},
): unknown {
  const identities = [
    ...inventory.debianPackages.map((item) => ({
      kind: item.kind,
      name: item.name,
      version: item.version.raw,
      architecture: item.architecture,
    })),
    inventory.node,
  ];
  let packages = identities.map((item, index) => ({
    SPDXID: `SPDXRef-Package-${index + 1}`,
    name: item.name,
    versionInfo: item.version,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: "NOASSERTION",
    copyrightText: "NOASSERTION",
    externalRefs: [
      {
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator:
          options.unsupportedFirstPurl === true && index === 0
            ? `pkg:rpm/redhat/${item.name}@${item.version}?arch=${item.architecture}`
            : purl(item.kind, item.name, item.version, item.architecture),
      },
    ],
  }));
  if (options.wrongFirstVersion === true && packages[0] !== undefined)
    packages = [
      { ...packages[0], versionInfo: "synthetic-mismatch" },
      ...packages.slice(1),
    ];
  if (options.omitLastPackage === true) packages = packages.slice(0, -1);
  if (options.duplicateFirstPackage === true && packages[0] !== undefined)
    packages = [...packages, packages[0]];
  const relationships = packages.map((item) => ({
    spdxElementId: "SPDXRef-DOCUMENT" as const,
    relationshipType: "DESCRIBES" as const,
    relatedSpdxElement: item.SPDXID,
  }));
  const document = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: "synthetic-fixture",
    documentNamespace: "https://invalid.example/m9b13d/synthetic",
    creationInfo: {
      created: "2026-08-03T00:00:00.000Z",
      creators: ["Tool: synthetic-m9b13d-fixture"],
    },
    packages,
    relationships:
      options.omitLastRelationship === true
        ? relationships.slice(0, -1)
        : relationships,
  };
  return options.extraDocumentField === true
    ? { ...document, callerSelectedIgnoredFields: ["packages"] }
    : document;
}
