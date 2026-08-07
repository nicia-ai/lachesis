import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outputDirectory = process.argv[2];
if (outputDirectory === undefined || process.argv.length !== 3) {
  throw new Error(
    "usage: node build-deterministic-archive.mjs OUTPUT_DIRECTORY",
  );
}

const archiveName = "m9b13f2-supplement-and-review.tar";
const manifestName = "external-archive-manifest.json";
const checksumName = "EXTERNAL-ARCHIVE-CHECKSUMS.sha256";
const inventoryCommit = "c324343d65bbbf68659c443581eb686ace9c9b68";
const inventoryPath =
  "docs/m9b13g-external-supplement-readiness/attachment-inventory.json";
const archiveProtocol = "lachesis-m9b13h-posix-ustar-transport/1";
const manifestProtocol =
  "lachesis-m9b13h-deterministic-external-archive-manifest/1";
const fixedMtimeEpochSeconds = 0;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gitShow = (commit, path) =>
  execFileSync("git", ["show", `${commit}:${path}`]);

function writeAscii(target, offset, length, value, field) {
  const bytes = Buffer.from(value, "ascii");
  if (bytes.length !== length) {
    throw new Error(`${field} must occupy exactly ${length} bytes`);
  }
  bytes.copy(target, offset);
}

function octalField(value, length, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} is not a nonnegative safe integer`);
  }
  const octal = value.toString(8);
  if (octal.length > length - 1) {
    throw new Error(`${field} does not fit its POSIX ustar field`);
  }
  return octal.padStart(length - 1, "0") + "\0";
}

function header(path, type, size) {
  const normalized = path.normalize("NFC");
  if (
    normalized !== path ||
    path.startsWith("/") ||
    path.includes("//") ||
    path.split("/").includes("..")
  ) {
    throw new Error(`invalid archive path: ${path}`);
  }
  const pathBytes = Buffer.from(path, "utf8");
  if (pathBytes.length > 100) {
    throw new Error(
      `path requires an extension or ustar prefix split: ${path}`,
    );
  }

  const block = Buffer.alloc(512, 0);
  pathBytes.copy(block, 0);
  writeAscii(
    block,
    100,
    8,
    octalField(type === "directory" ? 0o755 : 0o644, 8, "mode"),
    "mode",
  );
  writeAscii(block, 108, 8, octalField(0, 8, "uid"), "uid");
  writeAscii(block, 116, 8, octalField(0, 8, "gid"), "gid");
  writeAscii(block, 124, 12, octalField(size, 12, "size"), "size");
  writeAscii(
    block,
    136,
    12,
    octalField(fixedMtimeEpochSeconds, 12, "mtime"),
    "mtime",
  );
  block.fill(0x20, 148, 156);
  block[156] = type === "directory" ? 0x35 : 0x30;
  writeAscii(block, 257, 6, "ustar\0", "magic");
  writeAscii(block, 263, 2, "00", "version");
  writeAscii(block, 329, 8, octalField(0, 8, "devmajor"), "devmajor");
  writeAscii(block, 337, 8, octalField(0, 8, "devminor"), "devminor");
  const checksum = block.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0") + "\0 ";
  writeAscii(block, 148, 8, checksumText, "checksum");
  return block;
}

const inventoryBytes = gitShow(inventoryCommit, inventoryPath);
const inventory = JSON.parse(inventoryBytes.toString("utf8"));
if (
  inventory.protocol !== "lachesis-m9b13g-prospective-attachment-inventory/1" ||
  inventory.attachments.length !== 57
) {
  throw new Error("unexpected frozen source inventory");
}

const files = inventory.attachments.map((entry) => {
  const bytes = gitShow(entry.sourceGitCommit, entry.sourceRepositoryPath);
  if (bytes.length !== entry.byteLength || sha256(bytes) !== entry.rawSha256) {
    throw new Error(`frozen source mismatch: ${entry.path}`);
  }
  return { entry, bytes };
});
const archiveEntries = [
  {
    path: "independent-review-receipt/",
    type: "directory",
    bytes: Buffer.alloc(0),
  },
  ...files
    .filter(({ entry }) => entry.path.startsWith("independent-review-receipt/"))
    .map(({ entry, bytes }) => ({
      path: entry.path,
      type: "regular-file",
      bytes,
    })),
  { path: "supplement/", type: "directory", bytes: Buffer.alloc(0) },
  ...files
    .filter(({ entry }) => entry.path.startsWith("supplement/"))
    .map(({ entry, bytes }) => ({
      path: entry.path,
      type: "regular-file",
      bytes,
    })),
];
const sortedPaths = archiveEntries
  .map(({ path }) => path)
  .sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
if (
  JSON.stringify(archiveEntries.map(({ path }) => path)) !==
  JSON.stringify(sortedPaths)
) {
  throw new Error("archive entries are not in ascending UTF-8 byte order");
}

const chunks = [];
for (const entry of archiveEntries) {
  chunks.push(header(entry.path, entry.type, entry.bytes.length));
  if (entry.type === "regular-file") {
    chunks.push(entry.bytes);
    const paddingLength = (512 - (entry.bytes.length % 512)) % 512;
    if (paddingLength !== 0) chunks.push(Buffer.alloc(paddingLength, 0));
  }
}
chunks.push(Buffer.alloc(1024, 0));
const archiveBytes = Buffer.concat(chunks);

const manifest = {
  protocol: manifestProtocol,
  archive: {
    fileName: archiveName,
    formatProtocol: archiveProtocol,
    format: "POSIX.1-1988 ustar",
    compression: "none",
    byteLength: archiveBytes.length,
    rawSha256: sha256(archiveBytes),
    entryCount: 59,
    regularFileCount: 57,
    directoryEntryCount: 2,
  },
  construction: {
    ordering: "ascending-raw-utf8-nfc-relative-path-bytes",
    fixedMtimeEpochSeconds,
    regularFileMode: "0644",
    directoryMode: "0755",
    uid: 0,
    gid: 0,
    uname: "",
    gname: "",
    pathEncoding: "UTF-8 NFC",
    regularFilesOnlyExceptExplicitNamespaceDirectories: true,
    symlinks: 0,
    hardLinks: 0,
    specialEntries: 0,
    paxRecords: 0,
    gnuExtensionRecords: 0,
    implementationSpecificExtensionRecords: 0,
    filePadding: "zero-bytes-to-next-512-byte-boundary",
    terminalBlocks: "exactly-two-512-byte-zero-blocks",
  },
  sourceInventory: {
    commit: inventoryCommit,
    protocol: inventory.protocol,
    canonicalSha256:
      "4a7193935b959b8f815839c80b87f2af6b60fd2928aaf09afa3ed8d547a9f725",
    attachmentCount: 57,
  },
  sourcePackages: inventory.sourcePackages,
  entries: files.map(({ entry }) => ({
    archivePath: entry.path,
    version: 1,
    byteLength: entry.byteLength,
    mediaType: entry.mediaType,
    rawSha256: entry.rawSha256,
    canonicalJsonSha256: entry.canonicalJsonSha256,
    sourceGitCommit: entry.sourceGitCommit,
    sourceGitTree: entry.sourceGitTree,
    sourceRepositoryPath: entry.sourceRepositoryPath,
    sourcePackage: entry.sourcePackage,
    classification: entry.classification,
    archiveMode: "0644",
  })),
  wrapperStatus: {
    mechanicalTransportOnly: true,
    scientificOrOperationalAmendment: false,
    innerBytesReformattedOrRewritten: false,
    authorityGranted: false,
  },
};
const manifestBytes = Buffer.from(
  JSON.stringify(manifest, null, 2) + "\n",
  "utf8",
);
const checksumEntries = [
  [manifestName, sha256(manifestBytes)],
  [archiveName, sha256(archiveBytes)],
].sort(([left], [right]) =>
  Buffer.compare(Buffer.from(left), Buffer.from(right)),
);
const checksumBytes = Buffer.from(
  checksumEntries.map(([name, digest]) => `${digest}  ${name}\n`).join(""),
  "utf8",
);

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(join(outputDirectory, archiveName), archiveBytes);
writeFileSync(join(outputDirectory, manifestName), manifestBytes);
writeFileSync(join(outputDirectory, checksumName), checksumBytes);

process.stdout.write(
  JSON.stringify(
    {
      archiveProtocol,
      manifestProtocol,
      archiveName,
      archiveByteLength: archiveBytes.length,
      archiveRawSha256: sha256(archiveBytes),
      manifestRawSha256: sha256(manifestBytes),
      checksumRawSha256: sha256(checksumBytes),
      regularFileCount: 57,
      directoryEntryCount: 2,
    },
    null,
    2,
  ) + "\n",
);
