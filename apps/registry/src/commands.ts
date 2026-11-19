import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { Result } from "@nicia-ai/lachesis";

import {
  chainErrors,
  createManifest,
  decodeCanonical,
  encodeCanonical,
  entryFileName,
  isEntryFileName,
  type LoadedEntry,
  manifestErrors,
  publicKeyFingerprint,
  sha256Hex,
  witnessError,
} from "./core.js";
import { type RegistryError, registryError } from "./errors.js";
import {
  fetchBranch,
  git,
  isAncestor,
  isIndexClean,
  isTracked,
  listTree,
  readBlob,
  type Repository,
  resolveCommit,
  rewrittenPaths,
} from "./git.js";
import { decodeText } from "./process.js";
import {
  type BoundEntry,
  ENTRY_PROTOCOL,
  entrySchema,
  type GenesisEntry,
  MANIFEST_FILE_NAME,
  manifestSchema,
  PENDING_DIRECTORY_NAME,
  REGISTRY_DIRECTORY,
  type RegistryEntry,
  type TimestampAuthority,
  TSA_DIRECTORY,
  WITNESSES_PATH,
  witnessesSchema,
} from "./schema.js";
import {
  normalizePublicKey,
  publicKeyOf,
  signFile,
  verifySignature,
} from "./signature.js";
import { requestTimestamp, verifyTimestamp } from "./timestamp.js";

export type EntryTimestamp = Readonly<{ authority: string; time: string }>;

export type EntrySummary = Readonly<{
  sequence: number;
  kind: RegistryEntry["kind"];
  revision: string | undefined;
  timestamps: ReadonlyArray<EntryTimestamp>;
}>;

export type StudyReport = Readonly<{
  study: string;
  signerFingerprint: string | undefined;
  pending: number;
  entries: ReadonlyArray<EntrySummary>;
}>;

export type VerifyReport = Readonly<{
  revision: string;
  studies: ReadonlyArray<StudyReport>;
  witnessesChecked: ReadonlyArray<string>;
  warnings: ReadonlyArray<string>;
  errors: ReadonlyArray<RegistryError>;
}>;

export type VerifyOptions = Readonly<{
  revision: string;
  study: string | undefined;
  offline: boolean;
}>;

export type PrepareRequest =
  | Readonly<{
      kind: "genesis";
      study: string;
      principal: string;
      publicKeyPath: string;
      authorities: ReadonlyArray<Readonly<{ name: string; url: string }>>;
      externalRoots: ReadonlyArray<Readonly<{ label: string; sha256: string }>>;
    }>
  | Readonly<{
      kind: "registration";
      study: string;
      revision: string;
      manifestPath: string;
      authorizes: string;
    }>
  | Readonly<{
      kind: "result";
      study: string;
      revision: string;
      manifestPath: string;
      reportsOn: number;
    }>;

export type SealOptions = Readonly<{
  study: string;
  privateKeyPath: string;
  push: boolean;
}>;

export type SealOutcome = Readonly<{
  entryPath: string;
  timestamps: ReadonlyArray<EntryTimestamp>;
  pushErrors: ReadonlyArray<RegistryError>;
}>;

type Failure = Result<never, ReadonlyArray<RegistryError>>;

function fail(code: RegistryError["code"], message: string): Failure {
  return { ok: false, error: [registryError(code, message)] };
}

function studyDirectory(study: string): string {
  return `${REGISTRY_DIRECTORY}/${study}`;
}

function pendingDirectory(study: string): string {
  return `${studyDirectory(study)}/${PENDING_DIRECTORY_NAME}`;
}

function bundlePath(authority: string): string {
  return `${TSA_DIRECTORY}/${authority}.pem`;
}

function signaturePathFor(entryPath: string): string {
  return `${entryPath}.sig`;
}

function tokenPathFor(entryPath: string, authority: string): string {
  return `${entryPath}.${authority}.tsr`;
}

function isMutablePath(path: string): boolean {
  return (
    path === WITNESSES_PATH || path.split("/").includes(PENDING_DIRECTORY_NAME)
  );
}

export function toRepositoryPath(
  repository: Repository,
  cwd: string,
  path: string,
): Result<string, RegistryError> {
  const relativePath = relative(repository.root, resolve(cwd, path));
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  )
    return {
      ok: false,
      error: registryError("USAGE", `${path} is not inside the repository.`),
    };
  return { ok: true, value: relativePath.split(sep).join("/") };
}

type LoadedChain = Readonly<{
  entries: ReadonlyArray<LoadedEntry>;
  blobNames: ReadonlyArray<string>;
  treeNames: ReadonlyArray<string>;
}>;

async function loadChain(
  repository: Repository,
  revision: string,
  study: string,
): Promise<Result<LoadedChain, ReadonlyArray<RegistryError>>> {
  const listing = await listTree(repository, revision, studyDirectory(study));
  if (!listing.ok) return { ok: false, error: [listing.error] };
  const blobNames = listing.value
    .filter((item) => item.type === "blob")
    .map((item) => item.name);
  const entries: Array<LoadedEntry> = [];
  const errors: Array<RegistryError> = [];
  for (const fileName of blobNames.filter(isEntryFileName).sort()) {
    const bytes = await readBlob(
      repository,
      revision,
      `${studyDirectory(study)}/${fileName}`,
    );
    if (bytes === undefined) continue;
    const entry = decodeCanonical(bytes, entrySchema, `${study}/${fileName}`);
    if (entry.ok) entries.push({ fileName, bytes, entry: entry.value });
    else errors.push(entry.error);
  }
  if (errors.length > 0) return { ok: false, error: errors };
  return {
    ok: true,
    value: {
      entries,
      blobNames,
      treeNames: listing.value
        .filter((item) => item.type === "tree")
        .map((item) => item.name),
    },
  };
}

async function contentErrors(
  repository: Repository,
  tip: string,
  entry: BoundEntry,
): Promise<ReadonlyArray<RegistryError>> {
  const label = `${entry.study}/${entryFileName(entry.sequence)}`;
  const source = await resolveCommit(repository, entry.sourceCommit);
  if (!source.ok) return [source.error];
  const ancestor = await isAncestor(repository, source.value, tip);
  if (!ancestor.ok) return [ancestor.error];
  if (!ancestor.value)
    return [
      registryError(
        "CONTENT_MISMATCH",
        `${label}: source commit is not in this history.`,
      ),
    ];
  const manifestBytes = await readBlob(
    repository,
    source.value,
    entry.manifestPath,
  );
  if (
    manifestBytes === undefined ||
    sha256Hex(manifestBytes) !== entry.manifestSha256
  )
    return [
      registryError(
        "CONTENT_MISMATCH",
        `${label}: manifest at the source commit does not match.`,
      ),
    ];
  const manifest = decodeCanonical(manifestBytes, manifestSchema, label);
  if (!manifest.ok) return [manifest.error];
  return manifestErrors(manifest.value, entry.manifestPath, (path) =>
    readBlob(repository, source.value, path),
  );
}

async function authorityBundles(
  repository: Repository,
  revision: string,
  genesis: GenesisEntry,
): Promise<
  Result<ReadonlyMap<string, Uint8Array>, ReadonlyArray<RegistryError>>
> {
  const bundles = new Map<string, Uint8Array>();
  const errors: Array<RegistryError> = [];
  for (const authority of genesis.timestampAuthorities) {
    const bytes = await readBlob(
      repository,
      revision,
      bundlePath(authority.name),
    );
    if (bytes === undefined || sha256Hex(bytes) !== authority.caBundleSha256)
      errors.push(
        registryError(
          "CONTENT_MISMATCH",
          `${bundlePath(authority.name)} does not match the genesis entry.`,
        ),
      );
    else bundles.set(authority.name, bytes);
  }
  return errors.length > 0
    ? { ok: false, error: errors }
    : { ok: true, value: bundles };
}

async function entryProofErrors(
  repository: Repository,
  revision: string,
  loaded: LoadedEntry,
  genesis: GenesisEntry,
  bundles: ReadonlyMap<string, Uint8Array>,
): Promise<
  Readonly<{
    errors: ReadonlyArray<RegistryError>;
    timestamps: ReadonlyArray<EntryTimestamp>;
  }>
> {
  const entryPath = `${studyDirectory(loaded.entry.study)}/${loaded.fileName}`;
  const errors: Array<RegistryError> = [];
  const timestamps: Array<EntryTimestamp> = [];
  const signature = await readBlob(
    repository,
    revision,
    signaturePathFor(entryPath),
  );
  if (signature === undefined)
    errors.push(
      registryError("SIGNATURE_INVALID", `${entryPath} is unsigned.`),
    );
  else {
    const verified = await verifySignature(
      loaded.bytes,
      signature,
      genesis.signer,
    );
    if (!verified.ok)
      errors.push(
        registryError(
          verified.error.code,
          `${entryPath}: ${verified.error.message}`,
        ),
      );
  }
  const digest = sha256Hex(loaded.bytes);
  for (const authority of genesis.timestampAuthorities) {
    const token = await readBlob(
      repository,
      revision,
      tokenPathFor(entryPath, authority.name),
    );
    const bundle = bundles.get(authority.name);
    if (token === undefined || bundle === undefined) {
      errors.push(
        registryError(
          "TIMESTAMP_INVALID",
          `${entryPath} has no ${authority.name} timestamp.`,
        ),
      );
      continue;
    }
    const time = await verifyTimestamp(token, digest, bundle);
    if (time.ok)
      timestamps.push({
        authority: authority.name,
        time: time.value.toISOString(),
      });
    else
      errors.push(
        registryError(
          time.error.code,
          `${entryPath} (${authority.name}): ${time.error.message}`,
        ),
      );
  }
  if (loaded.entry.kind !== "genesis")
    errors.push(...(await contentErrors(repository, revision, loaded.entry)));
  return { errors, timestamps };
}

function unexpectedFileErrors(
  study: string,
  chain: LoadedChain,
  genesis: GenesisEntry | undefined,
): ReadonlyArray<RegistryError> {
  const expected = new Set<string>();
  for (const { fileName } of chain.entries) {
    expected.add(fileName);
    expected.add(signaturePathFor(fileName));
    for (const authority of genesis?.timestampAuthorities ?? [])
      expected.add(tokenPathFor(fileName, authority.name));
  }
  return [
    ...chain.blobNames.filter((name) => !expected.has(name)),
    ...chain.treeNames.filter((name) => name !== PENDING_DIRECTORY_NAME),
  ].map((name) =>
    registryError(
      "UNEXPECTED_FILE",
      `${studyDirectory(study)}/${name} is not part of the registry.`,
    ),
  );
}

async function verifyStudy(
  repository: Repository,
  revision: string,
  study: string,
): Promise<
  Readonly<{ report: StudyReport; errors: ReadonlyArray<RegistryError> }>
> {
  const empty: StudyReport = {
    study,
    signerFingerprint: undefined,
    pending: 0,
    entries: [],
  };
  const chain = await loadChain(repository, revision, study);
  if (!chain.ok) return { report: empty, errors: chain.error };
  const errors: Array<RegistryError> = [
    ...chainErrors(study, chain.value.entries),
  ];
  const first = chain.value.entries[0]?.entry;
  const genesis = first?.kind === "genesis" ? first : undefined;
  errors.push(...unexpectedFileErrors(study, chain.value, genesis));
  const pending = await listTree(repository, revision, pendingDirectory(study));
  const pendingCount = pending.ok
    ? pending.value.filter((item) => isEntryFileName(item.name)).length
    : 0;
  if (genesis === undefined)
    return {
      report: { ...empty, pending: pendingCount },
      errors,
    };
  const bundles = await authorityBundles(repository, revision, genesis);
  if (!bundles.ok) errors.push(...bundles.error);
  const summaries: Array<EntrySummary> = [];
  for (const loaded of chain.value.entries) {
    const proofs = await entryProofErrors(
      repository,
      revision,
      loaded,
      genesis,
      bundles.ok ? bundles.value : new Map(),
    );
    errors.push(...proofs.errors);
    summaries.push({
      sequence: loaded.entry.sequence,
      kind: loaded.entry.kind,
      revision:
        loaded.entry.kind === "genesis" ? undefined : loaded.entry.revision,
      timestamps: proofs.timestamps,
    });
  }
  return {
    report: {
      study,
      signerFingerprint: publicKeyFingerprint(genesis.signer.publicKey),
      pending: pendingCount,
      entries: summaries,
    },
    errors,
  };
}

async function listStudies(
  repository: Repository,
  revision: string,
): Promise<Result<ReadonlyArray<string>, RegistryError>> {
  const listing = await listTree(repository, revision, REGISTRY_DIRECTORY);
  if (!listing.ok) return listing;
  const tsaDirectoryName = TSA_DIRECTORY.slice(REGISTRY_DIRECTORY.length + 1);
  return {
    ok: true,
    value: listing.value
      .filter((item) => item.type === "tree" && item.name !== tsaDirectoryName)
      .map((item) => item.name),
  };
}

async function entryBytesAt(
  repository: Repository,
  revision: string,
  study: string,
): Promise<ReadonlyArray<Uint8Array>> {
  const listing = await listTree(repository, revision, studyDirectory(study));
  if (!listing.ok) return [];
  const names = listing.value
    .filter((item) => item.type === "blob" && isEntryFileName(item.name))
    .map((item) => item.name)
    .sort();
  const entries: Array<Uint8Array> = [];
  for (const name of names) {
    const bytes = await readBlob(
      repository,
      revision,
      `${studyDirectory(study)}/${name}`,
    );
    if (bytes !== undefined) entries.push(bytes);
  }
  return entries;
}

async function witnessErrors(
  repository: Repository,
  revision: string,
  studies: ReadonlyArray<string>,
): Promise<
  Readonly<{
    checked: ReadonlyArray<string>;
    warnings: ReadonlyArray<string>;
    errors: ReadonlyArray<RegistryError>;
  }>
> {
  const configuration = await readBlob(repository, revision, WITNESSES_PATH);
  if (configuration === undefined)
    return {
      checked: [],
      warnings: [`${WITNESSES_PATH} is absent; no witnesses were checked.`],
      errors: [],
    };
  const witnesses = decodeCanonical(
    configuration,
    witnessesSchema,
    WITNESSES_PATH,
  );
  if (!witnesses.ok)
    return { checked: [], warnings: [], errors: [witnesses.error] };
  const errors: Array<RegistryError> = [];
  const checked: Array<string> = [];
  for (const witness of witnesses.value.witnesses) {
    const fetched = await fetchBranch(repository, witness.url, witness.branch);
    if (!fetched.ok) {
      errors.push(
        registryError(
          "WITNESS_DIVERGED",
          `Witness ${witness.name} is unreachable: ${fetched.error.message}`,
        ),
      );
      continue;
    }
    checked.push(witness.name);
    for (const study of studies) {
      const divergence = witnessError(
        `${witness.name} (${study})`,
        await entryBytesAt(repository, revision, study),
        await entryBytesAt(repository, fetched.value, study),
      );
      if (divergence !== undefined) errors.push(divergence);
    }
  }
  return { checked, warnings: [], errors };
}

export async function verifyRegistry(
  repository: Repository,
  options: VerifyOptions,
): Promise<Result<VerifyReport, ReadonlyArray<RegistryError>>> {
  const commit = await resolveCommit(repository, options.revision);
  if (!commit.ok) return { ok: false, error: [commit.error] };
  const studies = await listStudies(repository, commit.value);
  if (!studies.ok) return { ok: false, error: [studies.error] };
  const selected =
    options.study === undefined
      ? studies.value
      : studies.value.filter((study) => study === options.study);
  if (options.study !== undefined && selected.length === 0)
    return fail("USAGE", `Study ${options.study} is not registered.`);
  const errors: Array<RegistryError> = [];
  const rewritten = await rewrittenPaths(
    repository,
    commit.value,
    REGISTRY_DIRECTORY,
  );
  if (!rewritten.ok) return { ok: false, error: [rewritten.error] };
  for (const path of rewritten.value.filter(
    (candidate) => !isMutablePath(candidate),
  ))
    errors.push(
      registryError(
        "HISTORY_REWRITTEN",
        `${path} was modified or deleted after it was committed.`,
      ),
    );
  const reports: Array<StudyReport> = [];
  for (const study of selected) {
    const verified = await verifyStudy(repository, commit.value, study);
    reports.push(verified.report);
    errors.push(...verified.errors);
  }
  const witnesses = options.offline
    ? {
        checked: [],
        warnings: ["Offline: witnesses were not checked."],
        errors: [],
      }
    : await witnessErrors(repository, commit.value, selected);
  errors.push(...witnesses.errors);
  return {
    ok: true,
    value: {
      revision: commit.value,
      studies: reports,
      witnessesChecked: witnesses.checked,
      warnings: witnesses.warnings,
      errors,
    },
  };
}

async function listWorkingFiles(
  repository: Repository,
  directory: string,
): Promise<Result<ReadonlyArray<string>, RegistryError>> {
  const listing = await git(repository, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    directory,
  ]);
  if (!listing.ok) return listing;
  return {
    ok: true,
    value: [
      ...new Set(
        decodeText(listing.value)
          .split("\0")
          .filter((path) => path.length > 0),
      ),
    ],
  };
}

/** Writes `<directory>/MANIFEST.json` over every non-ignored file in the directory. */
export async function writeManifest(
  repository: Repository,
  directory: string,
): Promise<Result<string, ReadonlyArray<RegistryError>>> {
  const manifestPath = `${directory}/${MANIFEST_FILE_NAME}`;
  const paths = await listWorkingFiles(repository, directory);
  if (!paths.ok) return { ok: false, error: [paths.error] };
  const files: Array<Readonly<{ path: string; bytes: Uint8Array }>> = [];
  for (const path of paths.value.filter(
    (candidate) => candidate !== manifestPath,
  )) {
    const absolute = join(repository.root, path);
    const status = await lstat(absolute);
    if (!status.isFile())
      return fail("CONTENT_MISMATCH", `${path} is not a regular file.`);
    files.push({ path, bytes: new Uint8Array(await readFile(absolute)) });
  }
  const manifest = createManifest(files);
  if (!manifest.ok) return { ok: false, error: [manifest.error] };
  const encoded = encodeCanonical(manifest.value);
  if (!encoded.ok) return { ok: false, error: [encoded.error] };
  await writeFile(join(repository.root, manifestPath), encoded.value);
  return { ok: true, value: manifestPath };
}

async function pendingEntryPaths(
  repository: Repository,
  study: string,
): Promise<ReadonlyArray<string>> {
  try {
    const names = await readdir(join(repository.root, pendingDirectory(study)));
    return names
      .filter(isEntryFileName)
      .sort()
      .map((name) => `${pendingDirectory(study)}/${name}`);
  } catch {
    return [];
  }
}

async function verifiedHead(
  repository: Repository,
  study: string,
): Promise<
  Result<
    Readonly<{ head: string; entries: ReadonlyArray<LoadedEntry> }>,
    ReadonlyArray<RegistryError>
  >
> {
  const head = await resolveCommit(repository, "HEAD");
  if (!head.ok) return { ok: false, error: [head.error] };
  const verified = await verifyStudy(repository, head.value, study);
  if (verified.errors.length > 0) return { ok: false, error: verified.errors };
  const chain = await loadChain(repository, head.value, study);
  if (!chain.ok) return chain;
  return {
    ok: true,
    value: { head: head.value, entries: chain.value.entries },
  };
}

/** Checks a candidate entry against the committed chain and the content it binds. */
async function candidateErrors(
  repository: Repository,
  head: string,
  entries: ReadonlyArray<LoadedEntry>,
  candidate: LoadedEntry,
): Promise<ReadonlyArray<RegistryError>> {
  const errors = [
    ...chainErrors(candidate.entry.study, [...entries, candidate]),
  ];
  if (candidate.entry.kind === "genesis") {
    const bundles = await authorityBundles(repository, head, candidate.entry);
    if (!bundles.ok) errors.push(...bundles.error);
  } else
    errors.push(...(await contentErrors(repository, head, candidate.entry)));
  return errors;
}

export async function prepareEntry(
  repository: Repository,
  request: PrepareRequest,
): Promise<Result<string, ReadonlyArray<RegistryError>>> {
  if ((await pendingEntryPaths(repository, request.study)).length > 0)
    return fail(
      "STATE_CONFLICT",
      `${pendingDirectory(request.study)} already holds an entry.`,
    );
  const verified = await verifiedHead(repository, request.study);
  if (!verified.ok) return verified;
  const { head, entries } = verified.value;
  const previous = entries.at(-1);
  const common = {
    protocol: ENTRY_PROTOCOL,
    study: request.study,
    sequence: entries.length,
  };
  let entry: unknown;
  switch (request.kind) {
    case "genesis": {
      const publicKey = normalizePublicKey(
        await readFile(resolve(repository.root, request.publicKeyPath), "utf8"),
      );
      if (!publicKey.ok) return { ok: false, error: [publicKey.error] };
      const authorities: Array<TimestampAuthority> = [];
      for (const authority of request.authorities) {
        const bundle = await readBlob(
          repository,
          head,
          bundlePath(authority.name),
        );
        if (bundle === undefined)
          return fail(
            "CONTENT_MISMATCH",
            `${bundlePath(authority.name)} must be committed first.`,
          );
        authorities.push({ ...authority, caBundleSha256: sha256Hex(bundle) });
      }
      entry = {
        ...common,
        kind: "genesis",
        parentEntrySha256: null,
        signer: { principal: request.principal, publicKey: publicKey.value },
        timestampAuthorities: authorities,
        externalRoots: request.externalRoots,
      };
      break;
    }
    case "registration":
    case "result": {
      if (previous === undefined)
        return fail(
          "CHAIN_BROKEN",
          `Study ${request.study} has no sealed genesis entry.`,
        );
      const manifestBytes = await readBlob(
        repository,
        head,
        request.manifestPath,
      );
      if (manifestBytes === undefined)
        return fail(
          "CONTENT_MISMATCH",
          `${request.manifestPath} must be committed first.`,
        );
      const bound = {
        ...common,
        parentEntrySha256: sha256Hex(previous.bytes),
        revision: request.revision,
        manifestPath: request.manifestPath,
        manifestSha256: sha256Hex(manifestBytes),
        sourceCommit: head,
      };
      entry =
        request.kind === "registration"
          ? { ...bound, kind: "registration", authorizes: request.authorizes }
          : { ...bound, kind: "result", reportsOn: request.reportsOn };
      break;
    }
  }
  const encoded = encodeCanonical(entry);
  if (!encoded.ok) return { ok: false, error: [encoded.error] };
  const fileName = entryFileName(entries.length);
  const decoded = decodeCanonical(
    encoded.value,
    entrySchema,
    `${request.study}/${fileName}`,
  );
  if (!decoded.ok) return { ok: false, error: [decoded.error] };
  const errors = await candidateErrors(repository, head, entries, {
    fileName,
    bytes: encoded.value,
    entry: decoded.value,
  });
  if (errors.length > 0) return { ok: false, error: errors };
  const path = `${pendingDirectory(request.study)}/${fileName}`;
  await mkdir(join(repository.root, pendingDirectory(request.study)), {
    recursive: true,
  });
  await writeFile(join(repository.root, path), encoded.value, { flag: "wx" });
  return { ok: true, value: path };
}

async function removeFiles(
  repository: Repository,
  paths: ReadonlyArray<string>,
): Promise<void> {
  for (const path of paths)
    await rm(join(repository.root, path), { force: true });
}

async function pushToWitnesses(
  repository: Repository,
  tag: string,
): Promise<ReadonlyArray<RegistryError>> {
  const configuration = await readBlob(repository, "HEAD", WITNESSES_PATH);
  if (configuration === undefined) return [];
  const witnesses = decodeCanonical(
    configuration,
    witnessesSchema,
    WITNESSES_PATH,
  );
  if (!witnesses.ok) return [witnesses.error];
  const errors: Array<RegistryError> = [];
  for (const witness of witnesses.value.witnesses) {
    const pushed = await git(repository, [
      "push",
      "--quiet",
      witness.url,
      `HEAD:refs/heads/${witness.branch}`,
      `refs/tags/${tag}`,
    ]);
    if (!pushed.ok)
      errors.push(
        registryError(
          "WITNESS_DIVERGED",
          `Push to ${witness.name} failed: ${pushed.error.message}`,
        ),
      );
  }
  return errors;
}

/** Signs, timestamps and commits the single pending entry. Sponsor-only: needs the signing key. */
export async function sealEntry(
  repository: Repository,
  options: SealOptions,
): Promise<Result<SealOutcome, ReadonlyArray<RegistryError>>> {
  const clean = await isIndexClean(repository);
  if (!clean.ok) return { ok: false, error: [clean.error] };
  if (!clean.value)
    return fail(
      "STATE_CONFLICT",
      "The git index has staged changes; commit or unstage them first.",
    );
  const pending = await pendingEntryPaths(repository, options.study);
  const pendingPath = pending[0];
  if (pendingPath === undefined || pending.length !== 1)
    return fail(
      "STATE_CONFLICT",
      `Expected exactly one entry in ${pendingDirectory(options.study)}.`,
    );
  const verified = await verifiedHead(repository, options.study);
  if (!verified.ok) return verified;
  const { head, entries } = verified.value;
  const fileName = entryFileName(entries.length);
  const bytes = new Uint8Array(
    await readFile(join(repository.root, pendingPath)),
  );
  const decoded = decodeCanonical(bytes, entrySchema, pendingPath);
  if (!decoded.ok) return { ok: false, error: [decoded.error] };
  const candidate: LoadedEntry = { fileName, bytes, entry: decoded.value };
  const errors = await candidateErrors(repository, head, entries, candidate);
  if (errors.length > 0) return { ok: false, error: errors };
  const genesisEntry =
    candidate.entry.kind === "genesis" ? candidate.entry : entries[0]?.entry;
  if (genesisEntry?.kind !== "genesis")
    return fail("CHAIN_BROKEN", "Genesis entry is missing.");
  const keyPublic = await publicKeyOf(
    resolve(repository.root, options.privateKeyPath),
    repository.root,
  );
  if (!keyPublic.ok) return { ok: false, error: [keyPublic.error] };
  if (keyPublic.value !== genesisEntry.signer.publicKey)
    return fail(
      "SIGNATURE_INVALID",
      "The signing key is not the genesis signer.",
    );
  const bundles = await authorityBundles(repository, head, genesisEntry);
  if (!bundles.ok) return bundles;

  const entryPath = `${studyDirectory(options.study)}/${fileName}`;
  const written: Array<string> = [entryPath];
  const abort = async (
    failure: ReadonlyArray<RegistryError>,
  ): Promise<Failure> => {
    await removeFiles(repository, written);
    return { ok: false, error: failure };
  };
  await writeFile(join(repository.root, entryPath), bytes, { flag: "wx" });
  const signed = await signFile(
    join(repository.root, entryPath),
    resolve(repository.root, options.privateKeyPath),
    repository.root,
  );
  written.push(signaturePathFor(entryPath));
  if (!signed.ok) return abort([signed.error]);
  const signature = await readFile(
    join(repository.root, signaturePathFor(entryPath)),
  );
  const signatureCheck = await verifySignature(
    bytes,
    new Uint8Array(signature),
    genesisEntry.signer,
  );
  if (!signatureCheck.ok) return abort([signatureCheck.error]);

  const timestamps: Array<EntryTimestamp> = [];
  for (const authority of genesisEntry.timestampAuthorities) {
    const response = await requestTimestamp(authority, sha256Hex(bytes));
    if (!response.ok) return abort([response.error]);
    const bundle = bundles.value.get(authority.name);
    if (bundle === undefined)
      return abort([
        registryError(
          "CONTENT_MISMATCH",
          `No CA bundle for ${authority.name}.`,
        ),
      ]);
    const time = await verifyTimestamp(
      response.value,
      sha256Hex(bytes),
      bundle,
    );
    if (!time.ok) return abort([time.error]);
    const tokenPath = tokenPathFor(entryPath, authority.name);
    written.push(tokenPath);
    await writeFile(join(repository.root, tokenPath), response.value, {
      flag: "wx",
    });
    timestamps.push({
      authority: authority.name,
      time: time.value.toISOString(),
    });
  }

  const tracked = await isTracked(repository, pendingPath);
  if (!tracked.ok) return abort([tracked.error]);
  const label = `${candidate.entry.kind}${candidate.entry.kind === "genesis" ? "" : ` ${candidate.entry.revision}`}`;
  const message = `registry(${options.study}): seal ${fileName} ${label}`;
  const tag = `registry/${options.study}/${fileName.replace(".json", "")}`;
  const steps: ReadonlyArray<ReadonlyArray<string>> = [
    ["add", "--", ...written],
    tracked.value ? ["rm", "--quiet", "--", pendingPath] : [],
    ["commit", "--quiet", "--message", message],
    ["tag", "--annotate", tag, "--message", message],
  ];
  for (const step of steps.filter((args) => args.length > 0)) {
    const done = await git(repository, step);
    if (!done.ok) return { ok: false, error: [done.error] };
  }
  if (!tracked.value) await rm(join(repository.root, pendingPath));
  return {
    ok: true,
    value: {
      entryPath,
      timestamps,
      pushErrors: options.push ? await pushToWitnesses(repository, tag) : [],
    },
  };
}
