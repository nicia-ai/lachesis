import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const jsonModuleUrl =
  process.env.LACHESIS_JSON_MODULE === undefined
    ? new URL("../packages/kernel/dist/json.js", import.meta.url)
    : pathToFileURL(process.env.LACHESIS_JSON_MODULE);
const { parseJson: parseStrictJson } = await import(jsonModuleUrl.href);

const RELEASE_VERSION = "0.1.0-alpha.4";
const CLI_NAME = "@nicia-ai/lachesis-cli";
const CLI_TARBALL_SHA256 =
  "f9586fd9554fbe78fd88ab28400d2a04fe78792196d17f5d7f74558f33d3e638";
const WORKFLOW_PATH = ".github/workflows/bootstrap-cli.yml";
const REPOSITORY = "https://github.com/nicia-ai/lachesis";

const packageEntries = [
  ["packages/kernel/package.json", "@nicia-ai/lachesis"],
  ["packages/evidence/package.json", "@nicia-ai/lachesis-evidence"],
  ["packages/generator/package.json", "@nicia-ai/lachesis-generator"],
  ["packages/runtime/package.json", "@nicia-ai/lachesis-runtime"],
  [
    "packages/evidence-typegraph/package.json",
    "@nicia-ai/lachesis-evidence-typegraph",
  ],
  ["apps/cli/package.json", CLI_NAME],
];

const packageNames = packageEntries.map((entry) => entry[1]);

const parseJson = (bytes, description) => {
  const parsed = parseStrictJson(bytes);
  if (!parsed.ok) throw new Error(`${description} is not valid strict JSON`);
  return parsed.value;
};

const fetchJson = async (url, description, fetchImplementation) => {
  const response = await fetchImplementation(url, {
    headers: { accept: "application/json" },
    redirect: "error",
  });
  const bytes = await response.text();
  if (!response.ok) {
    throw new Error(`${description} returned HTTP ${response.status}`);
  }
  return parseJson(bytes, description);
};

const encodedPackage = (packageName) =>
  encodeURIComponent(packageName).replace("%40", "@");

const versionUrl = (registry, packageName) =>
  `${registry}/${encodedPackage(packageName)}/${RELEASE_VERSION}`;

const packageUrl = (registry, packageName) =>
  `${registry}/${encodedPackage(packageName)}`;

const assertPlainRecord = (value, description) => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${description} must be a plain object`);
  }
  return value;
};

export const verifyPackageSet = async (sourceRoot) => {
  const expectedPaths = new Set(packageEntries.map((entry) => entry[0]));
  const discovered = [];
  for (const root of ["packages", "apps", "compat", "examples"]) {
    let entries;
    try {
      entries = await readdir(join(sourceRoot, root), { withFileTypes: true });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relativePath = `${root}/${entry.name}/package.json`;
      try {
        const manifest = parseJson(
          await readFile(join(sourceRoot, relativePath), "utf8"),
          relativePath,
        );
        if (manifest.private !== true) discovered.push(relativePath);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          continue;
        }
        throw error;
      }
    }
  }
  discovered.sort();
  const expected = [...expectedPaths].sort();
  if (JSON.stringify(discovered) !== JSON.stringify(expected)) {
    throw new Error(
      `Public package allowlist mismatch: ${JSON.stringify(discovered)}`,
    );
  }

  for (const [manifestPath, expectedName] of packageEntries) {
    const manifest = assertPlainRecord(
      parseJson(
        await readFile(join(sourceRoot, manifestPath), "utf8"),
        manifestPath,
      ),
      manifestPath,
    );
    if (
      manifest.name !== expectedName ||
      manifest.version !== RELEASE_VERSION ||
      manifest.publishConfig?.access !== "public"
    ) {
      throw new Error(`Frozen package metadata mismatch at ${manifestPath}`);
    }
    for (const [dependency, version] of Object.entries(
      manifest.dependencies ?? {},
    )) {
      if (
        dependency.startsWith("@nicia-ai/lachesis") &&
        version !== RELEASE_VERSION
      ) {
        throw new Error(
          `${expectedName} has an unsynchronized dependency on ${dependency}`,
        );
      }
    }
  }

  const cli = parseJson(
    await readFile(join(sourceRoot, "apps/cli/package.json"), "utf8"),
    "apps/cli/package.json",
  );
  if (
    cli.private !== false ||
    cli.type !== "module" ||
    cli.engines?.node !== ">=24 <25" ||
    cli.bin?.lachesis !== "./dist/cli.js" ||
    cli.exports !== undefined ||
    cli.main !== undefined ||
    cli.types !== undefined
  ) {
    throw new Error("CLI binary-only metadata is not frozen");
  }

  return { packageCount: packageEntries.length, version: RELEASE_VERSION };
};

export const verifyRegistryAbsent = async (
  registry,
  fetchImplementation = fetch,
) => {
  for (const packageName of packageNames) {
    const response = await fetchImplementation(
      versionUrl(registry, packageName),
      {
        headers: { accept: "application/json" },
        redirect: "error",
      },
    );
    await response.arrayBuffer();
    if (response.status !== 404) {
      throw new Error(
        `${packageName}@${RELEASE_VERSION} absence check returned HTTP ${response.status}`,
      );
    }
  }
  const cliPackageResponse = await fetchImplementation(
    packageUrl(registry, CLI_NAME),
    {
      headers: { accept: "application/json" },
      redirect: "error",
    },
  );
  await cliPackageResponse.arrayBuffer();
  if (cliPackageResponse.status !== 404) {
    throw new Error(
      `First-publication CLI package check returned HTTP ${cliPackageResponse.status}`,
    );
  }
  return { absent: packageNames.length, version: RELEASE_VERSION };
};

export const snapshotPreBootstrapRegistry = async (
  registry,
  fetchImplementation = fetch,
) => {
  await verifyRegistryAbsent(registry, fetchImplementation);
  const packages = [];
  for (const packageName of packageNames.filter((name) => name !== CLI_NAME)) {
    const metadata = await fetchJson(
      packageUrl(registry, packageName),
      `${packageName} pre-bootstrap metadata`,
      fetchImplementation,
    );
    packages.push({
      distTags: metadata["dist-tags"],
      name: packageName,
      versions: Object.keys(metadata.versions ?? {}).sort(),
    });
  }
  return {
    cli: "absent",
    packages,
    protocol: "lachesis.m8b2b1.registry-snapshot.v1",
  };
};

export const verifyUnchangedExistingPackages = async (
  registry,
  snapshot,
  fetchImplementation = fetch,
) => {
  if (
    snapshot.protocol !== "lachesis.m8b2b1.registry-snapshot.v1" ||
    snapshot.cli !== "absent" ||
    !Array.isArray(snapshot.packages)
  ) {
    throw new Error("Pre-bootstrap registry snapshot is malformed");
  }
  const current = [];
  for (const packageName of packageNames.filter((name) => name !== CLI_NAME)) {
    const metadata = await fetchJson(
      packageUrl(registry, packageName),
      `${packageName} post-bootstrap metadata`,
      fetchImplementation,
    );
    current.push({
      distTags: metadata["dist-tags"],
      name: packageName,
      versions: Object.keys(metadata.versions ?? {}).sort(),
    });
  }
  if (JSON.stringify(current) !== JSON.stringify(snapshot.packages)) {
    throw new Error("A non-CLI package changed during CLI bootstrap");
  }
  return { unchanged: current.length };
};

const decodeSlsaStatement = (attestationResponse) => {
  const attestations = attestationResponse.attestations;
  if (!Array.isArray(attestations)) {
    throw new Error("Registry attestation response has no attestations");
  }
  const provenance = attestations.find(
    (entry) => entry?.predicateType === "https://slsa.dev/provenance/v1",
  );
  const payload = provenance?.bundle?.dsseEnvelope?.payload;
  if (typeof payload !== "string") {
    throw new Error("Registry response has no SLSA provenance payload");
  }
  return assertPlainRecord(
    parseJson(
      Buffer.from(payload, "base64").toString("utf8"),
      "SLSA provenance payload",
    ),
    "SLSA provenance payload",
  );
};

export const verifyPublishedRegistryState = async ({
  registry,
  sourceCommit,
  workflowCommit,
  fetchImplementation = fetch,
}) => {
  for (const packageName of packageNames.filter((name) => name !== CLI_NAME)) {
    const response = await fetchImplementation(
      versionUrl(registry, packageName),
      {
        headers: { accept: "application/json" },
        redirect: "error",
      },
    );
    await response.arrayBuffer();
    if (response.status !== 404) {
      throw new Error(
        `Unexpected publication detected for ${packageName}@${RELEASE_VERSION}`,
      );
    }
  }

  const version = await fetchJson(
    versionUrl(registry, CLI_NAME),
    "CLI version metadata",
    fetchImplementation,
  );
  if (version.name !== CLI_NAME || version.version !== RELEASE_VERSION) {
    throw new Error("CLI registry identity mismatch");
  }
  if (
    !Array.isArray(version.dist?.signatures) ||
    version.dist.signatures.length === 0
  ) {
    throw new Error("CLI registry signature is absent");
  }
  const tarballUrl = version.dist?.tarball;
  const attestationUrl = version.dist?.attestations?.url;
  if (typeof tarballUrl !== "string" || typeof attestationUrl !== "string") {
    throw new Error("CLI registry artifact metadata is incomplete");
  }

  const tarballResponse = await fetchImplementation(tarballUrl, {
    redirect: "error",
  });
  if (!tarballResponse.ok) {
    throw new Error(`CLI tarball returned HTTP ${tarballResponse.status}`);
  }
  const tarballDigest = createHash("sha256")
    .update(Buffer.from(await tarballResponse.arrayBuffer()))
    .digest("hex");
  if (tarballDigest !== CLI_TARBALL_SHA256) {
    throw new Error(`CLI registry tarball digest mismatch: ${tarballDigest}`);
  }

  const packageMetadata = await fetchJson(
    packageUrl(registry, CLI_NAME),
    "CLI package metadata",
    fetchImplementation,
  );
  const alpha = packageMetadata["dist-tags"]?.alpha;
  const latest = packageMetadata["dist-tags"]?.latest;
  if (alpha !== RELEASE_VERSION) {
    throw new Error(`Unexpected CLI alpha dist-tag: ${String(alpha)}`);
  }
  if (latest !== undefined && latest !== RELEASE_VERSION) {
    throw new Error(`Unexpected CLI latest dist-tag: ${String(latest)}`);
  }

  const attestationResponse = await fetchJson(
    attestationUrl,
    "CLI attestations",
    fetchImplementation,
  );
  const statement = decodeSlsaStatement(attestationResponse);
  const predicate = statement.predicate;
  const workflow = predicate?.buildDefinition?.externalParameters?.workflow;
  const dependencies =
    predicate?.buildDefinition?.resolvedDependencies ??
    predicate?.buildDefinition?.resolvedDependencies;
  if (
    statement.predicateType !== "https://slsa.dev/provenance/v1" ||
    workflow?.path !== WORKFLOW_PATH ||
    workflow?.repository !== REPOSITORY ||
    !Array.isArray(dependencies) ||
    !dependencies.some(
      (dependency) => dependency?.digest?.gitCommit === workflowCommit,
    )
  ) {
    throw new Error("CLI provenance workflow identity mismatch");
  }

  return {
    alpha,
    latest: latest ?? null,
    package: CLI_NAME,
    releaseSourceCommit: sourceCommit,
    registryTarballSha256: tarballDigest,
    version: RELEASE_VERSION,
    workflowCommit,
    workflowPath: WORKFLOW_PATH,
  };
};

const main = async () => {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command === "package-set" && arguments_.length === 1) {
    console.log(JSON.stringify(await verifyPackageSet(arguments_[0])));
    return;
  }
  if (command === "registry-absence" && arguments_.length === 1) {
    console.log(JSON.stringify(await verifyRegistryAbsent(arguments_[0])));
    return;
  }
  if (command === "registry-snapshot" && arguments_.length === 1) {
    console.log(
      JSON.stringify(await snapshotPreBootstrapRegistry(arguments_[0])),
    );
    return;
  }
  if (command === "registry-unchanged" && arguments_.length === 2) {
    const snapshot = parseJson(
      await readFile(arguments_[1], "utf8"),
      "pre-bootstrap registry snapshot",
    );
    console.log(
      JSON.stringify(
        await verifyUnchangedExistingPackages(arguments_[0], snapshot),
      ),
    );
    return;
  }
  if (command === "registry-result" && arguments_.length === 3) {
    console.log(
      JSON.stringify(
        await verifyPublishedRegistryState({
          registry: arguments_[0],
          sourceCommit: arguments_[1],
          workflowCommit: arguments_[2],
        }),
      ),
    );
    return;
  }
  throw new Error(
    "Usage: verify-cli-bootstrap.mjs package-set <root> | registry-absence <registry> | registry-snapshot <registry> | registry-unchanged <registry> <snapshot> | registry-result <registry> <source-commit> <workflow-commit>",
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
