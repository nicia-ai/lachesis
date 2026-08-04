import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

import { parseJson as parseLachesisJson } from "@nicia-ai/lachesis";
import { z } from "zod";

export const M9B13D_SCANNER_PROTOCOL =
  "lachesis-m9b13d-oci-inventory-scanner/1" as const;
export const M9B13D_INVENTORY_SCHEMA =
  "lachesis-m9b13d-oci-package-inventory/1" as const;
export const M9B13D_COMPARISON_PROTOCOL =
  "lachesis-m9b13d-spdx-inventory-comparison/1" as const;
export const M9B13D_QUARANTINE =
  "quarantined-supply-chain-evidence-insufficient" as const;

const LIMITS = Object.freeze({
  descriptors: 128,
  layers: 64,
  uncompressedLayerBytes: 1_073_741_824,
  virtualEntries: 1_000_000,
  pathBytes: 4096,
  nesting: 128,
  authoritativeFileBytes: 16_777_216,
  metadataBytes: 16_777_216,
});

type ScannerFailure = Readonly<{
  kind: "m9b13d-scanner-failure";
  disposition: typeof M9B13D_QUARANTINE;
  reason: string;
}>;

type Result<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: ScannerFailure }>;

function failure(reason: string): Result<never> {
  return {
    ok: false,
    error: {
      kind: "m9b13d-scanner-failure",
      disposition: M9B13D_QUARANTINE,
      reason,
    },
  };
}

const sha256DigestSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/u)
  .brand<"M9b13dSha256Digest">();

const descriptorSchema = z
  .object({
    mediaType: z.string().min(1),
    digest: sha256DigestSchema,
    size: z.number().int().nonnegative().max(1_073_741_824),
    platform: z
      .object({
        architecture: z.enum(["amd64", "arm64"]),
        os: z.literal("linux"),
      })
      .strict()
      .optional(),
    annotations: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .readonly();

const indexSchema = z
  .object({
    schemaVersion: z.literal(2),
    mediaType: z.literal("application/vnd.oci.image.index.v1+json"),
    manifests: descriptorSchema.array().min(1).max(LIMITS.descriptors),
  })
  .strict()
  .readonly();

const manifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    mediaType: z.literal("application/vnd.oci.image.manifest.v1+json"),
    config: descriptorSchema,
    layers: descriptorSchema.array().max(LIMITS.layers),
  })
  .strict()
  .readonly();

const configSchema = z
  .object({
    architecture: z.enum(["amd64", "arm64"]),
    os: z.literal("linux"),
    config: z
      .looseObject({
        Env: z.string().array().optional(),
      })
      .optional(),
    rootfs: z
      .object({
        type: z.literal("layers"),
        diff_ids: sha256DigestSchema.array(),
      })
      .strict(),
  })
  .loose()
  .readonly();

const debianVersionSchema = z
  .object({
    raw: z.string().min(1),
    epoch: z.string().regex(/^(0|[1-9][0-9]*)$/u),
    upstream: z.string().min(1),
    revision: z.string(),
  })
  .strict()
  .readonly();

const debianPackageSchema = z
  .object({
    kind: z.literal("debian-binary"),
    name: z.string().regex(/^[a-z0-9][a-z0-9+.-]+$/u),
    version: debianVersionSchema,
    architecture: z.enum(["amd64", "arm64", "all"]),
    sourceName: z
      .string()
      .regex(/^[a-z0-9][a-z0-9+.-]+$/u)
      .optional(),
    sourceVersion: z.string().min(1).optional(),
  })
  .strict()
  .readonly();

const nodePackageSchema = z
  .object({
    kind: z.literal("node-runtime"),
    name: z.literal("node"),
    version: z
      .string()
      .regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u),
    architecture: z.enum(["amd64", "arm64"]),
  })
  .strict()
  .readonly();

export const m9b13dInventorySchema = z
  .object({
    schema: z.literal(M9B13D_INVENTORY_SCHEMA),
    scanner: z.literal(M9B13D_SCANNER_PROTOCOL),
    imageManifestDigest: sha256DigestSchema,
    architecture: z.enum(["amd64", "arm64"]),
    debianPackages: debianPackageSchema.array(),
    node: nodePackageSchema,
  })
  .strict()
  .readonly();

export type M9b13dInventory = z.infer<typeof m9b13dInventorySchema>;

type Descriptor = z.infer<typeof descriptorSchema>;

type VirtualEntry = Readonly<{
  kind: "directory" | "file" | "hardlink" | "symlink";
  content?: Uint8Array;
  target?: string;
}>;

type LayerEntry = Readonly<{
  path: string;
  kind: "directory" | "file" | "hardlink" | "symlink";
  content?: Uint8Array;
  target?: string;
}>;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

export function canonicalizeM9b13dJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value))}\n`;
}

async function readStrictRegularFile(
  path: string,
  maximumBytes: number,
): Promise<Result<Uint8Array>> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1)
      return failure("m9b13d:nonregular-or-aliased-oci-file");
    if (metadata.size > maximumBytes)
      return failure("m9b13d:oci-metadata-size-overflow");
    return { ok: true, value: await readFile(path) };
  } catch {
    return failure("m9b13d:missing-or-unreadable-oci-file");
  }
}

function parseJson(bytes: Uint8Array): Result<unknown> {
  const parsed = parseLachesisJson(new TextDecoder().decode(bytes));
  return parsed.ok
    ? { ok: true, value: parsed.value }
    : failure("m9b13d:malformed-json");
}

function blobPath(root: string, descriptor: Descriptor): string {
  return join(root, "blobs", "sha256", descriptor.digest.slice(7));
}

async function verifyDescriptor(
  root: string,
  descriptor: Descriptor,
): Promise<Result<string>> {
  const path = blobPath(root, descriptor);
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1)
      return failure("m9b13d:descriptor-not-regular-file");
    if (metadata.size !== descriptor.size)
      return failure("m9b13d:descriptor-size-mismatch");
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of byteChunks(createReadStream(path))) {
      bytes += chunk.byteLength;
      if (bytes > descriptor.size)
        return failure("m9b13d:descriptor-size-overflow");
      hash.update(chunk);
    }
    if (
      bytes !== descriptor.size ||
      `sha256:${hash.digest("hex")}` !== descriptor.digest
    )
      return failure("m9b13d:descriptor-digest-mismatch");
    return { ok: true, value: path };
  } catch {
    return failure("m9b13d:descriptor-read-failure");
  }
}

async function* byteChunks(stream: Readable): AsyncGenerator<Uint8Array> {
  const iterator: AsyncIterator<unknown> = stream[Symbol.asyncIterator]();
  for (;;) {
    const next = await iterator.next();
    if (next.done) return;
    if (!(next.value instanceof Uint8Array))
      throw new TypeError("Node byte stream yielded a non-byte chunk.");
    yield next.value;
  }
}

class StreamReader {
  readonly #iterator: AsyncIterator<unknown>;
  #chunk: Uint8Array = new Uint8Array();
  #offset = 0;

  constructor(stream: Readable) {
    this.#iterator = stream[Symbol.asyncIterator]();
  }

  async #fill(): Promise<boolean> {
    while (this.#offset >= this.#chunk.byteLength) {
      const next = await this.#iterator.next();
      if (next.done) return false;
      if (!(next.value instanceof Uint8Array))
        throw new TypeError("Node byte stream yielded a non-byte chunk.");
      this.#chunk = next.value;
      this.#offset = 0;
    }
    return true;
  }

  async readExact(bytes: number): Promise<Uint8Array | undefined> {
    const output = new Uint8Array(bytes);
    let written = 0;
    while (written < bytes) {
      if (!(await this.#fill())) return undefined;
      const available = this.#chunk.byteLength - this.#offset;
      const take = Math.min(available, bytes - written);
      output.set(
        this.#chunk.subarray(this.#offset, this.#offset + take),
        written,
      );
      this.#offset += take;
      written += take;
    }
    return output;
  }

  async consume(
    bytes: number,
    onChunk?: (chunk: Uint8Array) => void,
  ): Promise<boolean> {
    let remaining = bytes;
    while (remaining > 0) {
      if (!(await this.#fill())) return false;
      const available = this.#chunk.byteLength - this.#offset;
      const take = Math.min(available, remaining);
      const chunk = this.#chunk.subarray(this.#offset, this.#offset + take);
      onChunk?.(chunk);
      this.#offset += take;
      remaining -= take;
    }
    return true;
  }
}

function ascii(bytes: Uint8Array): string {
  return new TextDecoder("ascii").decode(bytes);
}

function tarString(bytes: Uint8Array): Result<string> {
  const nul = bytes.indexOf(0);
  const body = bytes.subarray(0, nul === -1 ? bytes.byteLength : nul);
  if (body.some((byte) => byte < 0x20 || byte > 0x7e))
    return failure("m9b13d:malformed-tar-string");
  return { ok: true, value: ascii(body) };
}

function tarOctal(bytes: Uint8Array): Result<number> {
  const text = ascii(bytes).replaceAll("\0", "").trim();
  if (!/^[0-7]+$/u.test(text)) return failure("m9b13d:malformed-tar-size");
  const value = Number.parseInt(text, 8);
  return Number.isSafeInteger(value) && value >= 0
    ? { ok: true, value }
    : failure("m9b13d:malformed-tar-size");
}

function normalizeArchivePath(input: string): Result<string> {
  const withoutPrefix = input.startsWith("./") ? input.slice(2) : input;
  const path = withoutPrefix.endsWith("/")
    ? withoutPrefix.slice(0, -1)
    : withoutPrefix;
  const components = path.split("/");
  if (
    path === "" ||
    path.startsWith("/") ||
    new TextEncoder().encode(path).byteLength > LIMITS.pathBytes ||
    components.length > LIMITS.nesting ||
    components.some((component) =>
      component === "" || component === "." || component === ".."
        ? true
        : component.includes("\0"),
    )
  )
    return failure("m9b13d:unsafe-tar-path");
  return { ok: true, value: path };
}

function normalizeLinkTarget(path: string, input: string): Result<string> {
  if (input.startsWith("/")) return failure("m9b13d:unsafe-tar-link");
  const stack = dirname(path) === "." ? [] : dirname(path).split("/");
  for (const component of input.split("/")) {
    if (component === "" || component === ".") continue;
    if (component === "..") {
      if (stack.length === 0) return failure("m9b13d:unsafe-tar-link");
      stack.pop();
    } else stack.push(component);
  }
  return normalizeArchivePath(stack.join("/"));
}

function captureContent(path: string): boolean {
  return (
    path === "var/lib/dpkg/status" ||
    path.startsWith("var/lib/dpkg/status.d/") ||
    path === "usr/local/include/node/node_version.h"
  );
}

async function parseTarLayer(
  path: string,
  mediaType: string,
): Promise<Result<ReadonlyArray<LayerEntry>>> {
  const source = createReadStream(path);
  const stream = mediaType.endsWith("+gzip")
    ? source.pipe(createGunzip())
    : source;
  const reader = new StreamReader(stream);
  const entries: Array<LayerEntry> = [];
  const paths = new Set<string>();
  let uncompressed = 0;
  let zeroBlocks = 0;
  try {
    for (;;) {
      const header = await reader.readExact(512);
      if (header === undefined) return failure("m9b13d:truncated-tar-header");
      uncompressed += 512;
      if (uncompressed > LIMITS.uncompressedLayerBytes)
        return failure("m9b13d:uncompressed-layer-overflow");
      if (header.every((byte) => byte === 0)) {
        zeroBlocks += 1;
        if (zeroBlocks === 2) break;
        continue;
      }
      if (zeroBlocks !== 0) return failure("m9b13d:malformed-tar-terminator");
      const storedChecksum = tarOctal(header.subarray(148, 156));
      if (!storedChecksum.ok) return storedChecksum;
      let checksum = 0;
      for (let index = 0; index < header.byteLength; index += 1)
        checksum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
      if (checksum !== storedChecksum.value)
        return failure("m9b13d:tar-checksum-mismatch");
      const name = tarString(header.subarray(0, 100));
      const prefix = tarString(header.subarray(345, 500));
      const linkName = tarString(header.subarray(157, 257));
      const size = tarOctal(header.subarray(124, 136));
      if (!name.ok) return name;
      if (!prefix.ok) return prefix;
      if (!linkName.ok) return linkName;
      if (!size.ok) return size;
      const normalized = normalizeArchivePath(
        prefix.value === "" ? name.value : `${prefix.value}/${name.value}`,
      );
      if (!normalized.ok) return normalized;
      if (paths.has(normalized.value))
        return failure("m9b13d:duplicate-tar-entry");
      paths.add(normalized.value);
      const type = header[156] ?? 0;
      let entry: LayerEntry;
      if (type === 0 || type === 0x30) {
        if (size.value > LIMITS.uncompressedLayerBytes)
          return failure("m9b13d:tar-entry-size-overflow");
        let content: Uint8Array | undefined;
        if (captureContent(normalized.value)) {
          if (size.value > LIMITS.authoritativeFileBytes)
            return failure("m9b13d:authoritative-file-overflow");
          content = new Uint8Array(size.value);
          let offset = 0;
          if (
            !(await reader.consume(size.value, (chunk) => {
              content?.set(chunk, offset);
              offset += chunk.byteLength;
            }))
          )
            return failure("m9b13d:truncated-tar-entry");
        } else if (!(await reader.consume(size.value)))
          return failure("m9b13d:truncated-tar-entry");
        entry = {
          path: normalized.value,
          kind: "file",
          ...(content === undefined ? {} : { content }),
        };
      } else if (type === 0x35) {
        if (size.value !== 0) return failure("m9b13d:directory-with-data");
        entry = { path: normalized.value, kind: "directory" };
      } else if (type === 0x31 || type === 0x32) {
        if (size.value !== 0) return failure("m9b13d:link-with-data");
        const target = normalizeLinkTarget(normalized.value, linkName.value);
        if (!target.ok) return target;
        entry = {
          path: normalized.value,
          kind: type === 0x31 ? "hardlink" : "symlink",
          target: target.value,
        };
      } else if ([0x33, 0x34, 0x36].includes(type))
        return failure("m9b13d:device-or-socket-tar-entry");
      else return failure("m9b13d:unsupported-tar-entry");
      entries.push(entry);
      if (entries.length > LIMITS.virtualEntries)
        return failure("m9b13d:virtual-entry-overflow");
      const padding = (512 - (size.value % 512)) % 512;
      if (!(await reader.consume(padding)))
        return failure("m9b13d:truncated-tar-padding");
      uncompressed += size.value + padding;
      if (uncompressed > LIMITS.uncompressedLayerBytes)
        return failure("m9b13d:uncompressed-layer-overflow");
    }
    return { ok: true, value: entries };
  } catch {
    return failure("m9b13d:layer-decompression-or-stream-failure");
  }
}

async function hashUncompressedLayer(
  path: string,
  mediaType: string,
): Promise<Result<string>> {
  const source = createReadStream(path);
  const stream = mediaType.endsWith("+gzip")
    ? source.pipe(createGunzip())
    : source;
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of byteChunks(stream)) {
      bytes += chunk.byteLength;
      if (bytes > LIMITS.uncompressedLayerBytes)
        return failure("m9b13d:uncompressed-layer-overflow");
      hash.update(chunk);
    }
    return { ok: true, value: `sha256:${hash.digest("hex")}` };
  } catch {
    return failure("m9b13d:layer-decompression-or-stream-failure");
  }
}

function removePath(vfs: Map<string, VirtualEntry>, path: string): void {
  for (const candidate of vfs.keys())
    if (candidate === path || candidate.startsWith(`${path}/`))
      vfs.delete(candidate);
}

function applyLayer(
  vfs: Map<string, VirtualEntry>,
  entries: ReadonlyArray<LayerEntry>,
): Result<true> {
  const lower = new Set(vfs.keys());
  for (const entry of entries) {
    const base = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    if (base === ".wh..wh..opq") {
      const directory = dirname(entry.path);
      const prefix = directory === "." ? "" : `${directory}/`;
      for (const path of lower)
        if (path.startsWith(prefix) && path !== directory) vfs.delete(path);
    } else if (base.startsWith(".wh.")) {
      const targetName = base.slice(4);
      if (targetName === "") return failure("m9b13d:malformed-whiteout");
      const directory = dirname(entry.path);
      removePath(
        vfs,
        directory === "." ? targetName : `${directory}/${targetName}`,
      );
    }
  }
  for (const entry of entries) {
    const base = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    if (base.startsWith(".wh.")) continue;
    const existing = vfs.get(entry.path);
    if (
      existing !== undefined &&
      (existing.kind === "directory") !== (entry.kind === "directory")
    )
      return failure("m9b13d:conflicting-layer-entry");
    vfs.set(entry.path, {
      kind: entry.kind,
      ...(entry.content === undefined ? {} : { content: entry.content }),
      ...(entry.target === undefined ? {} : { target: entry.target }),
    });
    if (vfs.size > LIMITS.virtualEntries)
      return failure("m9b13d:virtual-entry-overflow");
  }
  return { ok: true, value: true };
}

function parseDebianVersion(
  raw: string,
): Result<z.infer<typeof debianVersionSchema>> {
  const colon = raw.indexOf(":");
  const epoch = colon === -1 ? "0" : raw.slice(0, colon);
  const rest = colon === -1 ? raw : raw.slice(colon + 1);
  const hyphen = rest.lastIndexOf("-");
  const upstream = hyphen === -1 ? rest : rest.slice(0, hyphen);
  const revision = hyphen === -1 ? "" : rest.slice(hyphen + 1);
  const parsed = debianVersionSchema.safeParse({
    raw,
    epoch,
    upstream,
    revision,
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : failure("m9b13d:unsupported-debian-version");
}

function parseControlParagraphs(
  text: string,
): Result<ReadonlyArray<ReadonlyMap<string, string>>> {
  const paragraphs: Array<ReadonlyMap<string, string>> = [];
  for (const rawParagraph of text.replaceAll("\r\n", "\n").split(/\n\n+/u)) {
    if (rawParagraph.trim() === "") continue;
    const fields = new Map<string, string>();
    let current: string | undefined;
    for (const line of rawParagraph.trimEnd().split("\n")) {
      if (line.startsWith(" ")) {
        if (current === undefined)
          return failure("m9b13d:malformed-debian-control");
        fields.set(current, `${fields.get(current) ?? ""}\n${line.slice(1)}`);
        continue;
      }
      const separator = line.indexOf(":");
      if (separator <= 0) return failure("m9b13d:malformed-debian-control");
      const name = line.slice(0, separator);
      if (!/^[A-Za-z0-9-]+$/u.test(name) || fields.has(name))
        return failure("m9b13d:duplicate-or-malformed-debian-field");
      fields.set(name, line.slice(separator + 1).trimStart());
      current = name;
    }
    paragraphs.push(fields);
  }
  return { ok: true, value: paragraphs };
}

function deriveDebianPackages(
  vfs: ReadonlyMap<string, VirtualEntry>,
): Result<ReadonlyArray<z.infer<typeof debianPackageSchema>>> {
  const statusFiles = [...vfs.entries()]
    .filter(
      ([path, entry]) =>
        entry.kind === "file" &&
        (path === "var/lib/dpkg/status" ||
          path.startsWith("var/lib/dpkg/status.d/")),
    )
    .sort(([left], [right]) => left.localeCompare(right));
  if (statusFiles.length === 0) return failure("m9b13d:missing-dpkg-status");
  const packages = new Map<string, z.infer<typeof debianPackageSchema>>();
  for (const [, entry] of statusFiles) {
    if (entry.content === undefined)
      return failure("m9b13d:missing-dpkg-status-content");
    const parsed = parseControlParagraphs(
      new TextDecoder().decode(entry.content),
    );
    if (!parsed.ok) return parsed;
    for (const fields of parsed.value) {
      if (fields.get("Status") !== "install ok installed") continue;
      const name = fields.get("Package");
      const rawVersion = fields.get("Version");
      const architecture = fields.get("Architecture");
      if (
        name === undefined ||
        rawVersion === undefined ||
        architecture === undefined
      )
        return failure("m9b13d:incomplete-installed-debian-package");
      const version = parseDebianVersion(rawVersion);
      if (!version.ok) return version;
      const source = fields.get("Source");
      const sourceMatch = source?.match(/^([^ ]+)(?: \(([^)]+)\))?$/u);
      if (source !== undefined && sourceMatch === null)
        return failure("m9b13d:malformed-debian-source");
      const candidate = debianPackageSchema.safeParse({
        kind: "debian-binary",
        name,
        version: version.value,
        architecture,
        ...(sourceMatch?.[1] === undefined
          ? {}
          : { sourceName: sourceMatch[1] }),
        ...(sourceMatch?.[2] === undefined
          ? {}
          : { sourceVersion: sourceMatch[2] }),
      });
      if (!candidate.success)
        return failure("m9b13d:unsupported-debian-package-record");
      const key = `${candidate.data.name}\0${candidate.data.architecture}`;
      if (packages.has(key))
        return failure("m9b13d:duplicate-debian-package-identity");
      packages.set(key, candidate.data);
    }
  }
  return {
    ok: true,
    value: [...packages.values()].sort((left, right) =>
      `${left.name}\0${left.architecture}`.localeCompare(
        `${right.name}\0${right.architecture}`,
      ),
    ),
  };
}

function deriveNodePackage(
  vfs: ReadonlyMap<string, VirtualEntry>,
  architecture: "amd64" | "arm64",
): Result<z.infer<typeof nodePackageSchema>> {
  const binary = vfs.get("usr/local/bin/node");
  const header = vfs.get("usr/local/include/node/node_version.h");
  if (
    binary?.kind !== "file" ||
    header?.kind !== "file" ||
    header.content === undefined
  )
    return failure("m9b13d:missing-node-installation-evidence");
  const text = new TextDecoder().decode(header.content);
  const readMacro = (name: string): string | undefined =>
    new RegExp(`^#define ${name} (0|[1-9][0-9]*)$`, "mu").exec(text)?.[1];
  const major = readMacro("NODE_MAJOR_VERSION");
  const minor = readMacro("NODE_MINOR_VERSION");
  const patch = readMacro("NODE_PATCH_VERSION");
  if (major === undefined || minor === undefined || patch === undefined)
    return failure("m9b13d:malformed-node-version-header");
  return {
    ok: true,
    value: {
      kind: "node-runtime",
      name: "node",
      version: `${major}.${minor}.${patch}`,
      architecture,
    },
  };
}

async function requireExactBlobInventory(
  root: string,
  expected: ReadonlySet<string>,
): Promise<Result<true>> {
  try {
    const entries = await readdir(join(root, "blobs", "sha256"), {
      withFileTypes: true,
    });
    if (
      entries.some(
        (entry) =>
          !entry.isFile() ||
          !/^[0-9a-f]{64}$/u.test(entry.name) ||
          !expected.has(`sha256:${entry.name}`),
      ) ||
      entries.length !== expected.size
    )
      return failure("m9b13d:unreferenced-or-substituted-blob");
    return { ok: true, value: true };
  } catch {
    return failure("m9b13d:invalid-blob-directory");
  }
}

export async function scanM9b13dOciLayout(
  root: string,
): Promise<Result<M9b13dInventory>> {
  const seal = await readStrictRegularFile(join(root, ".m9b13d-sealed"), 64);
  if (!seal.ok) return seal;
  if (new TextDecoder().decode(seal.value) !== "lachesis-m9b13d-sealed/1\n")
    return failure("m9b13d:invalid-or-missing-seal");
  const layoutBytes = await readStrictRegularFile(
    join(root, "oci-layout"),
    1024,
  );
  if (!layoutBytes.ok) return layoutBytes;
  const layoutJson = parseJson(layoutBytes.value);
  if (!layoutJson.ok) return layoutJson;
  if (
    !isObject(layoutJson.value) ||
    Object.keys(layoutJson.value).length !== 1 ||
    layoutJson.value["imageLayoutVersion"] !== "1.0.0"
  )
    return failure("m9b13d:invalid-oci-layout-marker");
  const indexBytes = await readStrictRegularFile(
    join(root, "index.json"),
    LIMITS.metadataBytes,
  );
  if (!indexBytes.ok) return indexBytes;
  const indexJson = parseJson(indexBytes.value);
  if (!indexJson.ok) return indexJson;
  const index = indexSchema.safeParse(indexJson.value);
  if (!index.success) return failure("m9b13d:invalid-oci-index");
  if (index.data.manifests.length !== 1)
    return failure("m9b13d:extra-selected-manifest");
  const imageDescriptor = index.data.manifests[0];
  if (
    imageDescriptor?.mediaType !== "application/vnd.oci.image.manifest.v1+json"
  )
    return failure("m9b13d:unsupported-image-manifest-media-type");
  const seen = new Set<string>([imageDescriptor.digest]);
  const manifestPath = await verifyDescriptor(root, imageDescriptor);
  if (!manifestPath.ok) return manifestPath;
  const manifestBytes = await readStrictRegularFile(
    manifestPath.value,
    LIMITS.metadataBytes,
  );
  if (!manifestBytes.ok) return manifestBytes;
  const manifestJson = parseJson(manifestBytes.value);
  if (!manifestJson.ok) return manifestJson;
  const manifest = manifestSchema.safeParse(manifestJson.value);
  if (!manifest.success) return failure("m9b13d:invalid-oci-manifest");
  if (
    manifest.data.config.mediaType !==
    "application/vnd.oci.image.config.v1+json"
  )
    return failure("m9b13d:unsupported-config-media-type");
  for (const descriptor of [manifest.data.config, ...manifest.data.layers]) {
    if (seen.has(descriptor.digest))
      return failure("m9b13d:duplicate-or-cyclic-descriptor");
    seen.add(descriptor.digest);
  }
  const blobs = await requireExactBlobInventory(root, seen);
  if (!blobs.ok) return blobs;
  const configPath = await verifyDescriptor(root, manifest.data.config);
  if (!configPath.ok) return configPath;
  const configBytes = await readStrictRegularFile(
    configPath.value,
    LIMITS.metadataBytes,
  );
  if (!configBytes.ok) return configBytes;
  const configJson = parseJson(configBytes.value);
  if (!configJson.ok) return configJson;
  const config = configSchema.safeParse(configJson.value);
  if (!config.success) return failure("m9b13d:invalid-oci-config");
  if (config.data.rootfs.diff_ids.length !== manifest.data.layers.length)
    return failure("m9b13d:config-layer-count-mismatch");
  const vfs = new Map<string, VirtualEntry>();
  for (const [layerIndex, layer] of manifest.data.layers.entries()) {
    if (
      layer.mediaType !== "application/vnd.oci.image.layer.v1.tar+gzip" &&
      layer.mediaType !== "application/vnd.oci.image.layer.v1.tar"
    )
      return failure("m9b13d:unsupported-layer-compression");
    const verified = await verifyDescriptor(root, layer);
    if (!verified.ok) return verified;
    const diffId = await hashUncompressedLayer(verified.value, layer.mediaType);
    if (!diffId.ok) return diffId;
    if (diffId.value !== config.data.rootfs.diff_ids[layerIndex])
      return failure("m9b13d:layer-diff-id-mismatch");
    const parsed = await parseTarLayer(verified.value, layer.mediaType);
    if (!parsed.ok) return parsed;
    const applied = applyLayer(vfs, parsed.value);
    if (!applied.ok) return applied;
  }
  const debianPackages = deriveDebianPackages(vfs);
  if (!debianPackages.ok) return debianPackages;
  const node = deriveNodePackage(vfs, config.data.architecture);
  if (!node.ok) return node;
  const inventory = m9b13dInventorySchema.safeParse({
    schema: M9B13D_INVENTORY_SCHEMA,
    scanner: M9B13D_SCANNER_PROTOCOL,
    imageManifestDigest: imageDescriptor.digest,
    architecture: config.data.architecture,
    debianPackages: debianPackages.value,
    node: node.value,
  });
  return inventory.success
    ? { ok: true, value: inventory.data }
    : failure("m9b13d:invalid-derived-inventory");
}

const spdxExternalRefSchema = z
  .object({
    referenceCategory: z.literal("PACKAGE-MANAGER"),
    referenceType: z.literal("purl"),
    referenceLocator: z.string().startsWith("pkg:"),
  })
  .strict()
  .readonly();

const spdxPackageSchema = z
  .object({
    SPDXID: z.string().regex(/^SPDXRef-[A-Za-z0-9.-]+$/u),
    name: z.string().min(1),
    versionInfo: z.string().min(1),
    downloadLocation: z.string().min(1),
    filesAnalyzed: z.literal(false),
    licenseConcluded: z.string().min(1),
    licenseDeclared: z.string().min(1),
    copyrightText: z.string().min(1),
    externalRefs: z.tuple([spdxExternalRefSchema]),
  })
  .strict()
  .readonly();

const spdxSchema = z
  .object({
    spdxVersion: z.literal("SPDX-2.3"),
    dataLicense: z.literal("CC0-1.0"),
    SPDXID: z.literal("SPDXRef-DOCUMENT"),
    name: z.string().min(1),
    documentNamespace: z.url(),
    creationInfo: z
      .object({
        created: z.iso.datetime(),
        creators: z.string().array().min(1),
      })
      .strict(),
    packages: spdxPackageSchema.array(),
    relationships: z
      .object({
        spdxElementId: z.literal("SPDXRef-DOCUMENT"),
        relationshipType: z.literal("DESCRIBES"),
        relatedSpdxElement: z.string().regex(/^SPDXRef-[A-Za-z0-9.-]+$/u),
      })
      .strict()
      .array(),
  })
  .strict()
  .readonly();

function decodePurlComponent(value: string): Result<string> {
  try {
    return { ok: true, value: decodeURIComponent(value) };
  } catch {
    return failure("m9b13d:malformed-spdx-purl");
  }
}

function purlIdentity(locator: string): Result<string> {
  const match = /^pkg:(deb\/debian|generic)\/([^@?]+)@([^?]+)\?(.+)$/u.exec(
    locator,
  );
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  )
    return failure("m9b13d:unsupported-spdx-purl");
  const name = decodePurlComponent(match[2]);
  const version = decodePurlComponent(match[3]);
  if (!name.ok) return name;
  if (!version.ok) return version;
  const parameters = new URLSearchParams(match[4]);
  if ([...parameters.keys()].some((key) => key !== "arch"))
    return failure("m9b13d:unsupported-spdx-purl-parameter");
  const architectures = parameters.getAll("arch");
  if (architectures.length !== 1)
    return failure("m9b13d:missing-or-duplicate-spdx-architecture");
  const architecture = architectures[0];
  if (!architecture || !["amd64", "arm64", "all"].includes(architecture))
    return failure("m9b13d:unsupported-spdx-architecture");
  return {
    ok: true,
    value: `${match[1] === "generic" ? "node-runtime" : "debian-binary"}\0${name.value}\0${version.value}\0${architecture}`,
  };
}

function derivedIdentities(inventory: M9b13dInventory): ReadonlyArray<string> {
  return [
    ...inventory.debianPackages.map(
      (item) =>
        `${item.kind}\0${item.name}\0${item.version.raw}\0${item.architecture}`,
    ),
    `${inventory.node.kind}\0${inventory.node.name}\0${inventory.node.version}\0${inventory.node.architecture}`,
  ].sort();
}

export function compareM9b13dSpdxInventory(
  inventoryInput: unknown,
  spdxInput: unknown,
): Result<Readonly<{ inventorySha256: string; spdxSha256: string }>>;
export function compareM9b13dSpdxInventory(
  ...inputs: ReadonlyArray<unknown>
): Result<Readonly<{ inventorySha256: string; spdxSha256: string }>> {
  if (inputs.length !== 2) return failure("m9b13d:comparison-policy-override");
  const [inventoryInput, spdxInput] = inputs;
  const inventory = m9b13dInventorySchema.safeParse(inventoryInput);
  const spdx = spdxSchema.safeParse(spdxInput);
  if (!inventory.success || !spdx.success)
    return failure("m9b13d:unsupported-or-malformed-inventory-representation");
  const packageIds = new Set<string>();
  const attachedIdentities = new Set<string>();
  for (const item of spdx.data.packages) {
    if (packageIds.has(item.SPDXID))
      return failure("m9b13d:duplicate-spdx-package-identity");
    packageIds.add(item.SPDXID);
    const identity = purlIdentity(item.externalRefs[0].referenceLocator);
    if (!identity.ok) return identity;
    const [, name, version] = identity.value.split("\0");
    if (item.name !== name || item.versionInfo !== version)
      return failure("m9b13d:spdx-package-field-mismatch");
    if (attachedIdentities.has(identity.value))
      return failure("m9b13d:duplicate-spdx-semantic-identity");
    attachedIdentities.add(identity.value);
  }
  if (
    spdx.data.relationships.length !== packageIds.size ||
    new Set(spdx.data.relationships.map((item) => item.relatedSpdxElement))
      .size !== packageIds.size ||
    spdx.data.relationships.some(
      (item) => !packageIds.has(item.relatedSpdxElement),
    )
  )
    return failure("m9b13d:spdx-relationship-mismatch");
  const expected = derivedIdentities(inventory.data);
  const actual = [...attachedIdentities].sort();
  if (
    expected.length !== actual.length ||
    expected.some((identity, index) => identity !== actual[index])
  )
    return failure("m9b13d:attached-sbom-semantic-mismatch");
  return {
    ok: true,
    value: {
      inventorySha256: createHash("sha256")
        .update(canonicalizeM9b13dJson(inventory.data))
        .digest("hex"),
      spdxSha256: createHash("sha256")
        .update(canonicalizeM9b13dJson(spdx.data))
        .digest("hex"),
    },
  };
}
