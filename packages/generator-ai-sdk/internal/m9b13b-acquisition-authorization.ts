import type { Result } from "@nicia-ai/lachesis";
import { z } from "zod";

export const M9B13B_PROTOCOLS = Object.freeze({
  review:
    "lachesis-m9b13b-cryptographically-complete-acquisition-review@1.0.0" as const,
  closure: "lachesis-m9b13b-content-addressed-download-closure/1" as const,
  nodeRelease: "lachesis-m9b13b-node-release-verification/1" as const,
  attestation: "lachesis-m9b13b-oci-attestation-verification/1" as const,
  quarantine: "lachesis-m9b13b-image-quarantine-decision/1" as const,
});

export const M9B13B_FROZEN = Object.freeze({
  startingCommit: "113c3f526e67eceea3d06874c393ddd5240865e9",
  startingTree: "873eff5ef34989903ea206dfd90a5f03dfe089a7",
  priorDecision: "m9b13a-existing-image-acquisition-review-no-go",
  preregistrationDigest:
    "097d4848a264fc8484ca590c79388e3a00279a6310392205db7868104cee13b4",
  receiptDigest:
    "ae33915d355ca96aff4b4846a6f2d374491d4d9eea28540d87332368f61ef70b",
  tag: "docker.io/library/node:24.18.1-bookworm-slim",
  indexDigest:
    "sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7",
  platform: "linux/arm64/v8",
  platformManifestDigest:
    "sha256:c39335f45d6d5b2a5be95b0f1a63e57cca4e9e36cc69b313c1ad5472b13a1e3",
  attestationManifestDigest:
    "sha256:f3c062ad822adadf8f41d1bfaa2a25cce3fd81800fc2a2cf2264307b8c77ae23",
  dockerNodeCommit: "53252eea9caacaa50bdf58f4d34f0bff8d259999",
  dockerfileSha256:
    "bd6bb06de21f22916d8e582ccd43722889f8788a5699f2a099296707c2c57e52",
  nodeVersion: "24.18.1",
  nodeArm64Sha256:
    "7201e3a09dc825bac57867c81913e2b8f0ef87d04cb9082af4cda82f6ff3d88c",
  nodeSourceXzSha256:
    "86d40d594bbdfcf69009a62fdf43cb19ae72b6cb5822d2bdd8349c5a1b2fa628",
  nodeSignedManifestSha256:
    "b04865cae6bfd78008eea4ef9e715889ae3b81a869fea61fd1790be78b91a743",
  nodeKeyringSha256:
    "8e6f89521a0694e445f42decd022f48369c634f1b5bcb5975135b69c88629ae8",
  nodeSignerFingerprint: "DD792F5973C6DE52C432CBDAC77ABFA00DDBF2B7",
  githubWebFlowKeyId: "B5690EEEBB952194",
  githubWebFlowKeySha256:
    "6e8af687f60cf3f403151c8fb1b26e95e6f9e424ca60cc8f3787bd4466a3ef84",
  officialImagesCommit: "baca6de4f5be548b9b818fa2ca5a1d1d9e66f309",
  officialImagesBlob: "611d1d2858eff2204e357de60a188b88ef1cd1c7",
  officialImagesFileSha256:
    "4e06e614086ad016d795d1005e821c595cf4e7c8e18bf03aecacc74191dd5e68",
  expectedBuilder: "https://github.com/docker-library/official-images",
  expectedBuildType: "https://mobyproject.org/buildkit@v1",
});

const effectsSchema = z
  .strictObject({
    imageManifestDownloads: z.number().int().nonnegative(),
    imageConfigDownloads: z.number().int().nonnegative(),
    imageLayerDownloads: z.number().int().nonnegative(),
    attestationBodyDownloads: z.number().int().nonnegative(),
    nodeBinaryDownloads: z.number().int().nonnegative(),
    keyMaterialDownloads: z.number().int().nonnegative(),
    ociArchiveDownloads: z.number().int().nonnegative(),
    imagePulls: z.number().int().nonnegative(),
    imageBuilds: z.number().int().nonnegative(),
    imageImports: z.number().int().nonnegative(),
    imageRuns: z.number().int().nonnegative(),
    corpusArtifacts: z.number().int().nonnegative(),
    goldArtifacts: z.number().int().nonnegative(),
    credentialAccesses: z.number().int().nonnegative(),
    providerCalls: z.number().int().nonnegative(),
    modelCalls: z.number().int().nonnegative(),
    scheduleInstances: z.number().int().nonnegative(),
    operationalIdentities: z.number().int().nonnegative(),
    authorityStores: z.number().int().nonnegative(),
    analysisRuns: z.number().int().nonnegative(),
    osfMutations: z.number().int().nonnegative(),
    gitPushes: z.number().int().nonnegative(),
  })
  .readonly();

export type M9b13bEffects = z.infer<typeof effectsSchema>;

export const M9B13B_ZERO_EFFECTS: M9b13bEffects = Object.freeze({
  imageManifestDownloads: 0,
  imageConfigDownloads: 0,
  imageLayerDownloads: 0,
  attestationBodyDownloads: 0,
  nodeBinaryDownloads: 0,
  keyMaterialDownloads: 0,
  ociArchiveDownloads: 0,
  imagePulls: 0,
  imageBuilds: 0,
  imageImports: 0,
  imageRuns: 0,
  corpusArtifacts: 0,
  goldArtifacts: 0,
  credentialAccesses: 0,
  providerCalls: 0,
  modelCalls: 0,
  scheduleInstances: 0,
  operationalIdentities: 0,
  authorityStores: 0,
  analysisRuns: 0,
  osfMutations: 0,
  gitPushes: 0,
});

const syntheticInputSchema = z
  .strictObject({
    protocol: z.literal(M9B13B_PROTOCOLS.review),
    node: z.strictObject({
      keyringPresent: z.boolean(),
      keyringSha256: z.string(),
      signerFingerprint: z.string(),
      signedManifestSha256: z.string(),
      arm64ArtifactSha256: z.string(),
      sourceXzSha256: z.string(),
      additionalTrustRoots: z.boolean(),
    }),
    github: z.strictObject({
      verificationRetained: z.boolean(),
      keyPresent: z.boolean(),
      keySha256: z.string(),
      signerKeyId: z.string(),
      localSignatureValid: z.boolean(),
      meaning: z.string(),
    }),
    officialImages: z.strictObject({
      commit: z.string(),
      libraryBlob: z.string(),
      fileSha256: z.string(),
      exactTagPresent: z.boolean(),
      arm64v8Present: z.boolean(),
      dockerNodeCommit: z.string(),
      directory: z.string(),
    }),
    graph: z.strictObject({
      indexDigest: z.string(),
      platformManifestDigest: z.string(),
      attestationManifestDigest: z.string(),
      inventoryRecordedBeforeChildren: z.boolean(),
      unexpectedDescriptors: z.string().array().readonly(),
      foreignLayers: z.boolean(),
      nondigestUrls: z.boolean(),
      mutableFallback: z.boolean(),
      schemaOrMediaTypeChanges: z.boolean(),
      unexpectedRedirectHost: z.string().nullable(),
      digestCycles: z.boolean(),
      conflictingDescriptors: z.boolean(),
      childOutsideGraph: z.boolean(),
      downloadComplete: z.boolean(),
      attemptCount: z.number().int().nonnegative(),
      candidateSubstitution: z.boolean(),
    }),
    attestation: z.strictObject({
      statementVersion: z.enum([
        "https://in-toto.io/Statement/v0.1",
        "https://in-toto.io/Statement/v1",
      ]),
      predicatesExact: z.boolean(),
      validJsonAndSchema: z.boolean(),
      subjectNameExact: z.boolean(),
      subjectDigest: z.string(),
      conflictingSubjects: z.boolean(),
      builder: z.string(),
      buildType: z.string(),
      sourceCommit: z.string(),
      dockerfileAndContextExact: z.boolean(),
      invocationPresent: z.boolean(),
      platform: z.string(),
      materialsComplete: z.boolean(),
      baseImageBound: z.boolean(),
      nodeVersion: z.string(),
      timestampsConsistent: z.boolean(),
      reproducibilityMetadataConsistent: z.boolean(),
      sbomImageBound: z.boolean(),
      sbomNodeVersion: z.string(),
      sbomBookwormPackagesCoherent: z.boolean(),
      sbomRelationshipsCoherent: z.boolean(),
      independentSbomComparisonFrozen: z.boolean(),
      signatureClaimed: z.boolean(),
      signaturePresent: z.boolean(),
      signatureValid: z.boolean(),
      transparencyClaimed: z.boolean(),
      transparencyValid: z.boolean(),
      unsignedStatusRecorded: z.boolean(),
    }),
    effects: effectsSchema,
  })
  .readonly();

export type M9b13bSyntheticInput = z.infer<typeof syntheticInputSchema>;

export type M9b13bFailure = Readonly<{
  kind: "acquisition-authorization-rejection";
  reason: string;
}>;

export type M9b13bReport = Readonly<{
  protocol: typeof M9B13B_PROTOCOLS.review;
  status: "completed-offline-synthetic-zero-effect";
  decision: "m9b13b-corrected-acquisition-authorization-ready-for-independent-review";
  checks: Readonly<{
    nodeReleaseVerification: "passed";
    githubWebFlowVerification: "passed-limited-meaning";
    officialImagesMapping: "passed";
    contentAddressedClosure: "passed";
    attestationGates: "passed-synthetic-only";
    noAcquisition: "passed";
    noImageState: "passed";
    noStudyEffects: "passed";
  }>;
  effects: M9b13bEffects;
}>;

function reject(reason: string): Result<never, M9b13bFailure> {
  return {
    ok: false,
    error: { kind: "acquisition-authorization-rejection", reason },
  };
}

function effectsAreZero(effects: M9b13bEffects): boolean {
  return Object.values(effects).every((value) => value === 0);
}

export function createM9b13bSyntheticInput(): M9b13bSyntheticInput {
  return syntheticInputSchema.parse({
    protocol: M9B13B_PROTOCOLS.review,
    node: {
      keyringPresent: true,
      keyringSha256: M9B13B_FROZEN.nodeKeyringSha256,
      signerFingerprint: M9B13B_FROZEN.nodeSignerFingerprint,
      signedManifestSha256: M9B13B_FROZEN.nodeSignedManifestSha256,
      arm64ArtifactSha256: M9B13B_FROZEN.nodeArm64Sha256,
      sourceXzSha256: M9B13B_FROZEN.nodeSourceXzSha256,
      additionalTrustRoots: false,
    },
    github: {
      verificationRetained: true,
      keyPresent: true,
      keySha256: M9B13B_FROZEN.githubWebFlowKeySha256,
      signerKeyId: M9B13B_FROZEN.githubWebFlowKeyId,
      localSignatureValid: true,
      meaning: "github-web-flow-signature-not-node-maintainer-signature",
    },
    officialImages: {
      commit: M9B13B_FROZEN.officialImagesCommit,
      libraryBlob: M9B13B_FROZEN.officialImagesBlob,
      fileSha256: M9B13B_FROZEN.officialImagesFileSha256,
      exactTagPresent: true,
      arm64v8Present: true,
      dockerNodeCommit: M9B13B_FROZEN.dockerNodeCommit,
      directory: "24/bookworm-slim",
    },
    graph: {
      indexDigest: M9B13B_FROZEN.indexDigest,
      platformManifestDigest: M9B13B_FROZEN.platformManifestDigest,
      attestationManifestDigest: M9B13B_FROZEN.attestationManifestDigest,
      inventoryRecordedBeforeChildren: true,
      unexpectedDescriptors: [],
      foreignLayers: false,
      nondigestUrls: false,
      mutableFallback: false,
      schemaOrMediaTypeChanges: false,
      unexpectedRedirectHost: null,
      digestCycles: false,
      conflictingDescriptors: false,
      childOutsideGraph: false,
      downloadComplete: true,
      attemptCount: 1,
      candidateSubstitution: false,
    },
    attestation: {
      statementVersion: "https://in-toto.io/Statement/v0.1",
      predicatesExact: true,
      validJsonAndSchema: true,
      subjectNameExact: true,
      subjectDigest: M9B13B_FROZEN.platformManifestDigest,
      conflictingSubjects: false,
      builder: M9B13B_FROZEN.expectedBuilder,
      buildType: M9B13B_FROZEN.expectedBuildType,
      sourceCommit: M9B13B_FROZEN.dockerNodeCommit,
      dockerfileAndContextExact: true,
      invocationPresent: true,
      platform: M9B13B_FROZEN.platform,
      materialsComplete: true,
      baseImageBound: true,
      nodeVersion: M9B13B_FROZEN.nodeVersion,
      timestampsConsistent: true,
      reproducibilityMetadataConsistent: true,
      sbomImageBound: true,
      sbomNodeVersion: M9B13B_FROZEN.nodeVersion,
      sbomBookwormPackagesCoherent: true,
      sbomRelationshipsCoherent: true,
      independentSbomComparisonFrozen: true,
      signatureClaimed: false,
      signaturePresent: false,
      signatureValid: false,
      transparencyClaimed: false,
      transparencyValid: false,
      unsignedStatusRecorded: true,
    },
    effects: M9B13B_ZERO_EFFECTS,
  });
}

export function validateM9b13bSyntheticAcquisition(
  input: unknown,
): Result<M9b13bReport, M9b13bFailure> {
  const parsed = syntheticInputSchema.safeParse(input);
  if (!parsed.success) return reject("m9b13b:invalid-synthetic-fixture");
  const fixture = parsed.data;
  if (!fixture.node.keyringPresent)
    return reject("m9b13b:missing-node-keyring");
  if (fixture.node.keyringSha256 !== M9B13B_FROZEN.nodeKeyringSha256)
    return reject("m9b13b:altered-node-keyring");
  if (fixture.node.signerFingerprint !== M9B13B_FROZEN.nodeSignerFingerprint)
    return reject("m9b13b:wrong-node-signer");
  if (
    fixture.node.signedManifestSha256 !== M9B13B_FROZEN.nodeSignedManifestSha256
  )
    return reject("m9b13b:changed-node-signed-manifest-hash");
  if (
    fixture.node.arm64ArtifactSha256 !== M9B13B_FROZEN.nodeArm64Sha256 ||
    fixture.node.sourceXzSha256 !== M9B13B_FROZEN.nodeSourceXzSha256 ||
    fixture.node.additionalTrustRoots
  )
    return reject("m9b13b:node-release-verification-mismatch");
  if (fixture.github.verificationRetained && !fixture.github.keyPresent)
    return reject("m9b13b:missing-github-web-flow-key");
  if (
    fixture.github.verificationRetained &&
    (fixture.github.keySha256 !== M9B13B_FROZEN.githubWebFlowKeySha256 ||
      !fixture.github.localSignatureValid)
  )
    return reject("m9b13b:github-web-flow-verification-failed");
  if (
    fixture.github.verificationRetained &&
    fixture.github.signerKeyId !== M9B13B_FROZEN.githubWebFlowKeyId
  )
    return reject("m9b13b:wrong-github-web-flow-key-id");
  if (
    fixture.github.verificationRetained &&
    fixture.github.meaning !==
      "github-web-flow-signature-not-node-maintainer-signature"
  )
    return reject("m9b13b:github-signature-meaning-overstated");
  if (
    fixture.officialImages.commit !== M9B13B_FROZEN.officialImagesCommit ||
    fixture.officialImages.libraryBlob !== M9B13B_FROZEN.officialImagesBlob ||
    fixture.officialImages.fileSha256 !==
      M9B13B_FROZEN.officialImagesFileSha256 ||
    !fixture.officialImages.exactTagPresent ||
    !fixture.officialImages.arm64v8Present ||
    fixture.officialImages.dockerNodeCommit !==
      M9B13B_FROZEN.dockerNodeCommit ||
    fixture.officialImages.directory !== "24/bookworm-slim"
  )
    return reject("m9b13b:altered-official-images-mapping");
  if (
    fixture.graph.indexDigest !== M9B13B_FROZEN.indexDigest ||
    fixture.graph.platformManifestDigest !==
      M9B13B_FROZEN.platformManifestDigest ||
    fixture.graph.attestationManifestDigest !==
      M9B13B_FROZEN.attestationManifestDigest
  )
    return reject("m9b13b:root-descriptor-mismatch");
  if (
    !fixture.graph.inventoryRecordedBeforeChildren ||
    fixture.graph.unexpectedDescriptors.length !== 0 ||
    fixture.graph.foreignLayers ||
    fixture.graph.nondigestUrls ||
    fixture.graph.mutableFallback ||
    fixture.graph.schemaOrMediaTypeChanges ||
    fixture.graph.digestCycles ||
    fixture.graph.conflictingDescriptors ||
    fixture.graph.childOutsideGraph
  )
    return reject("m9b13b:unexpected-child-descriptor");
  if (fixture.graph.unexpectedRedirectHost !== null)
    return reject("m9b13b:unexpected-redirect-host");
  if (!fixture.graph.downloadComplete)
    return reject("m9b13b:incomplete-download");
  if (fixture.graph.attemptCount !== 1 || fixture.graph.candidateSubstitution)
    return reject("m9b13b:retry-or-candidate-substitution");
  if (
    !fixture.attestation.predicatesExact ||
    !fixture.attestation.validJsonAndSchema ||
    !fixture.attestation.subjectNameExact ||
    fixture.attestation.subjectDigest !==
      M9B13B_FROZEN.platformManifestDigest ||
    fixture.attestation.conflictingSubjects
  )
    return reject("m9b13b:wrong-attestation-subject");
  if (fixture.attestation.sourceCommit !== M9B13B_FROZEN.dockerNodeCommit)
    return reject("m9b13b:wrong-provenance-source-commit");
  if (!fixture.attestation.invocationPresent)
    return reject("m9b13b:missing-build-invocation");
  if (fixture.attestation.platform !== M9B13B_FROZEN.platform)
    return reject("m9b13b:wrong-provenance-platform");
  if (fixture.attestation.nodeVersion !== M9B13B_FROZEN.nodeVersion)
    return reject("m9b13b:wrong-provenance-node-version");
  if (
    fixture.attestation.builder !== M9B13B_FROZEN.expectedBuilder ||
    fixture.attestation.buildType !== M9B13B_FROZEN.expectedBuildType ||
    !fixture.attestation.dockerfileAndContextExact ||
    !fixture.attestation.materialsComplete ||
    !fixture.attestation.baseImageBound ||
    !fixture.attestation.timestampsConsistent ||
    !fixture.attestation.reproducibilityMetadataConsistent
  )
    return reject("m9b13b:provenance-inconsistent");
  if (
    !fixture.attestation.sbomImageBound ||
    fixture.attestation.sbomNodeVersion !== M9B13B_FROZEN.nodeVersion ||
    !fixture.attestation.sbomBookwormPackagesCoherent ||
    !fixture.attestation.sbomRelationshipsCoherent ||
    !fixture.attestation.independentSbomComparisonFrozen
  )
    return reject("m9b13b:inconsistent-sbom-package-inventory");
  if (
    fixture.attestation.signatureClaimed &&
    !fixture.attestation.signaturePresent
  )
    return reject("m9b13b:absent-claimed-attestation-signature");
  if (
    fixture.attestation.signatureClaimed &&
    !fixture.attestation.signatureValid
  )
    return reject("m9b13b:invalid-attestation-signature");
  if (
    fixture.attestation.transparencyClaimed &&
    !fixture.attestation.transparencyValid
  )
    return reject("m9b13b:malformed-transparency-evidence");
  if (
    !fixture.attestation.signatureClaimed &&
    !fixture.attestation.unsignedStatusRecorded
  )
    return reject("m9b13b:unsigned-attestation-status-not-recorded");
  if (!effectsAreZero(fixture.effects))
    return reject("m9b13b:prohibited-effect-nonzero");
  return {
    ok: true,
    value: {
      protocol: M9B13B_PROTOCOLS.review,
      status: "completed-offline-synthetic-zero-effect",
      decision:
        "m9b13b-corrected-acquisition-authorization-ready-for-independent-review",
      checks: {
        nodeReleaseVerification: "passed",
        githubWebFlowVerification: "passed-limited-meaning",
        officialImagesMapping: "passed",
        contentAddressedClosure: "passed",
        attestationGates: "passed-synthetic-only",
        noAcquisition: "passed",
        noImageState: "passed",
        noStudyEffects: "passed",
      },
      effects: fixture.effects,
    },
  };
}
