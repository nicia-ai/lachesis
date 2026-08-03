import { lstat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

import { digestValue, type Result } from "@nicia-ai/lachesis";
import { z } from "zod";

export const M9B13_PROTOCOLS = Object.freeze({
  readiness:
    "lachesis-m9b13-offline-corpus-materialization-readiness@1.0.0" as const,
  construction: "lachesis-m9b13-fresh-corpus-construction-protocol/1" as const,
  roleIsolation: "lachesis-m9b13-role-isolation-protocol/1" as const,
  acquisition: "lachesis-m9b13-source-acquisition-protocol/1" as const,
  population: "lachesis-m9b13-population-materialization-protocol/1" as const,
  hiddenGold: "lachesis-m9b13-hidden-gold-protocol/1" as const,
  binding: "lachesis-m9b13-materialization-binding/1" as const,
  dryRun: "lachesis-m9b13-zero-effect-dry-run/1" as const,
});

export const M9B13_FROZEN_BINDINGS = Object.freeze({
  receiptCommit: "02d77486455aa9b581fe9a8c747f525f075f1f72",
  receiptTree: "c20f0ae2bf9fc6538a756a46bf22b62b4179e22f",
  reviewedSourceCommit: "821a0f64c145de46ff77ebb734421fa2c7ab33f4",
  reviewedSourceTree: "998c03b0d1082a7a20ba3558ffb8e8da79b69454",
  preregistrationPackage:
    "lachesis-m9b12f-offline-preregistration-package@1.0.0",
  preregistrationDigest:
    "097d4848a264fc8484ca590c79388e3a00279a6310392205db7868104cee13b4",
  preregistrationManifestDigest:
    "5e53f4aeb8bf22213692557023b695bf88013372c8b235a7f844fdcf5545b189",
  externalRegistrationProtocol:
    "lachesis-m9b12f-append-only-external-registration/1",
  osfRegistration: "63sh5",
  receiptDigest:
    "ae33915d355ca96aff4b4846a6f2d374491d4d9eea28540d87332368f61ef70b",
  receiptManifestDigest:
    "0a8447b88d7cc41db67dd863a5269bad6b95bed2cf568d85fd562b96253faae1",
  durableAuthority: "lachesis-m9b12f-durable-quarantine-authority/1",
  observerIdentity: "lachesis-m9b12f-authenticated-observer-identity/1",
  atomicAdmission: "lachesis-m9b12f-atomic-role-effect-admission/1",
  sqliteSidecars: "lachesis-m9b12f-private-sqlite-sidecar-policy/1",
  effectLedger: "lachesis-m9b4-offline-effect-ledger@1.2.0",
});

export const M9B13_FAMILIES = Object.freeze([
  "lookup",
  "join",
  "multi-hop",
  "temporal-retraction",
  "contradiction",
  "aggregation",
  "insufficient-evidence",
  "prompt-injection",
] as const);

export const M9B13_SCALES = Object.freeze([
  Object.freeze({
    scale: "1x",
    targetBytes: 4_096,
    minimumBytes: 3_072,
    maximumBytes: 5_120,
  }),
  Object.freeze({
    scale: "8x",
    targetBytes: 32_768,
    minimumBytes: 24_576,
    maximumBytes: 40_960,
  }),
  Object.freeze({
    scale: "32x",
    targetBytes: 131_072,
    minimumBytes: 98_304,
    maximumBytes: 163_840,
  }),
] as const);

export const M9B13_ROLES = Object.freeze([
  "protocol-controller",
  "source-acquirer",
  "constructor",
  "materializer",
  "hidden-gold-constructor",
  "split-auditor",
  "disclosure-auditor",
  "environment-builder",
  "study-operator",
  "program-author",
  "answer-role",
  "evaluator",
  "analyst",
  "receipt-recorder",
  "independent-verifier",
] as const);

export const M9B13_ISOLATION_CHANNELS = Object.freeze([
  "direct-mount",
  "parent-filesystem",
  "parent-workspace",
  "worktree",
  "repository-history",
  "archive",
  "backup-or-snapshot",
  "cache",
  "temporary-storage",
  "log",
  "shell-history",
  "environment-variable",
  "search-root",
  "bootstrap-input",
  "inherited-process-input",
  "external-or-object-storage",
] as const);

export const M9B13_AUDIT_DIMENSIONS = Object.freeze([
  "family",
  "task",
  "source",
  "document",
  "entity",
  "answer",
  "fact",
  "template",
  "seed",
  "schedule",
  "packet",
  "evaluator-input",
  "analysis-input",
] as const);

export const M9B13_FUTURE_ROOTS = Object.freeze([
  "raw-acquired-sources",
  "normalized-immutable-snapshots",
  "constructor-workspace",
  "materializer-input",
  "author-packets",
  "answer-packets",
  "evaluator-packets",
  "hidden-gold-and-witnesses",
  "split-randomization-secrets",
  "durable-authority-state",
  "effect-ledger",
  "replay-artifacts",
  "analysis-inputs",
  "analysis-outputs",
  "quarantine",
  "public-audit-records",
] as const);

const effectSchema = z
  .strictObject({
    retiredMaterialAccesses: z.number().int().nonnegative(),
    networkRequests: z.number().int().nonnegative(),
    sourceDownloads: z.number().int().nonnegative(),
    corpusArtifacts: z.number().int().nonnegative(),
    goldArtifacts: z.number().int().nonnegative(),
    caseIdentities: z.number().int().nonnegative(),
    sourceIdentities: z.number().int().nonnegative(),
    packetIdentities: z.number().int().nonnegative(),
    scheduleInstances: z.number().int().nonnegative(),
    randomSeeds: z.number().int().nonnegative(),
    operationalPrincipals: z.number().int().nonnegative(),
    authorityStores: z.number().int().nonnegative(),
    credentialAccesses: z.number().int().nonnegative(),
    countCalls: z.number().int().nonnegative(),
    inferenceCalls: z.number().int().nonnegative(),
    providerCalls: z.number().int().nonnegative(),
    analysisRuns: z.number().int().nonnegative(),
    osfMutations: z.number().int().nonnegative(),
    gitPushes: z.number().int().nonnegative(),
  })
  .readonly();

export type M9b13Effects = z.infer<typeof effectSchema>;

export const M9B13_ZERO_EFFECTS: M9b13Effects = Object.freeze({
  retiredMaterialAccesses: 0,
  networkRequests: 0,
  sourceDownloads: 0,
  corpusArtifacts: 0,
  goldArtifacts: 0,
  caseIdentities: 0,
  sourceIdentities: 0,
  packetIdentities: 0,
  scheduleInstances: 0,
  randomSeeds: 0,
  operationalPrincipals: 0,
  authorityStores: 0,
  credentialAccesses: 0,
  countCalls: 0,
  inferenceCalls: 0,
  providerCalls: 0,
  analysisRuns: 0,
  osfMutations: 0,
  gitPushes: 0,
});

const dependencyClosureSchema = z
  .strictObject({
    node: z.string(),
    pnpm: z.string(),
    typescript: z.string(),
    zod: z.string(),
    vitest: z.string(),
    offlineStoreAvailable: z.boolean(),
    workspaceDependenciesInstalled: z.boolean(),
    declarationsBuildable: z.boolean(),
    cleanNode24ContainerBaseAvailable: z.boolean(),
    containerBaseIdentity: z.string().nullable(),
    workspaceFallbackPermitted: z.boolean(),
  })
  .readonly();

const dryRunInputSchema = z
  .strictObject({
    protocol: z.literal(M9B13_PROTOCOLS.dryRun),
    bindings: z.strictObject({
      preregistrationDigest: z.string(),
      receiptDigest: z.string(),
      osfRegistration: z.string(),
    }),
    population: z.strictObject({
      families: z.number().int().nonnegative(),
      scales: z.number().int().nonnegative(),
      cells: z.number().int().nonnegative(),
      probePairsPerCell: z.number().int().nonnegative(),
      probePairs: z.number().int().nonnegative(),
      primaryPairsPerCell: z.number().int().nonnegative(),
      primaryPairs: z.number().int().nonnegative(),
      totalPairs: z.number().int().nonnegative(),
      countRequests: z.number().int().nonnegative(),
      inferenceCalls: z.number().int().nonnegative(),
      maximumHttpRequests: z.number().int().nonnegative(),
    }),
    roles: z.string().array().readonly(),
    roots: z.string().array().readonly(),
    isolationProofs: z.string().array().readonly(),
    auditDimensions: z.string().array().readonly(),
    inventoryAuthority: z.string(),
    observerAuthority: z.string(),
    searchRoots: z.string().array().readonly(),
    attemptedPaths: z.string().array().readonly(),
    roleCombinations: z
      .strictObject({
        principal: z.string(),
        roles: z.string().array().readonly(),
      })
      .array()
      .readonly(),
    authorPacketFields: z.string().array().readonly(),
    crossPacketMetadataFields: z.string().array().readonly(),
    identities: z
      .strictObject({ kind: z.string(), value: z.string() })
      .array()
      .readonly(),
    splitOverlaps: z.string().array().readonly(),
    sourceNearDuplicates: z.number().int().nonnegative(),
    provenanceComplete: z.boolean(),
    exposureInventoryComplete: z.boolean(),
    filesystemEntries: z
      .strictObject({
        path: z.string(),
        kind: z.enum(["directory", "file", "symlink", "other"]),
        mode: z.number().int().nonnegative(),
        ownerMatches: z.boolean(),
      })
      .array()
      .readonly(),
    networkEnabledRoles: z.string().array().readonly(),
    leakedEnvironmentKeys: z.string().array().readonly(),
    dependencies: dependencyClosureSchema,
    authorityActivationRequested: z.boolean(),
    executionAuthorizationPresent: z.boolean(),
    materializationAuthorizationPresent: z.boolean(),
    analysisRequested: z.boolean(),
    prohibitedAttempts: z.strictObject({
      scheduleOrRandomization: z.boolean(),
      corpusArtifact: z.boolean(),
      goldArtifact: z.boolean(),
    }),
    effects: effectSchema,
  })
  .readonly();

export type M9b13DryRunInput = z.infer<typeof dryRunInputSchema>;

const readinessFindingSchema = z
  .strictObject({ code: z.string(), detail: z.string() })
  .readonly();

const dryRunReportSchema = z
  .strictObject({
    protocol: z.literal(M9B13_PROTOCOLS.dryRun),
    status: z.literal("completed-offline-zero-effect"),
    decision: z.enum([
      "m9b13-materialization-readiness-go",
      "m9b13-materialization-readiness-no-go",
    ]),
    findings: readinessFindingSchema.array().readonly(),
    checks: z
      .strictObject({
        bindings: z.literal("passed"),
        roleTopology: z.literal("passed"),
        namespaceIsolation: z.literal("passed"),
        accessProvenance: z.literal("passed"),
        populationArithmetic: z.literal("passed"),
        splitAuditCompleteness: z.literal("passed"),
        dependencyClosure: z.enum(["passed", "failed"]),
        noNetwork: z.literal("passed"),
        noCredentials: z.literal("passed"),
        noCorpus: z.literal("passed"),
        noGold: z.literal("passed"),
        noProviderCalls: z.literal("passed"),
        noSchedule: z.literal("passed"),
        noAuthorityActivation: z.literal("passed"),
        noAnalysis: z.literal("passed"),
      })
      .readonly(),
    effects: effectSchema,
    reportDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .readonly();

export type M9b13DryRunReport = z.infer<typeof dryRunReportSchema>;

export type M9b13ReadinessFailure = Readonly<{
  kind: "readiness-rejection";
  reason: string;
}>;

function reject(reason: string): Result<never, M9b13ReadinessFailure> {
  return { ok: false, error: { kind: "readiness-rejection", reason } };
}

function equalSet(
  actual: ReadonlyArray<string>,
  expected: ReadonlyArray<string>,
): boolean {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((value) => actual.includes(value))
  );
}

function effectsAreZero(effects: M9b13Effects): boolean {
  return Object.values(effects).every((value) => value === 0);
}

function duplicateIdentity(
  values: ReadonlyArray<Readonly<{ kind: string; value: string }>>,
): string | undefined {
  const seen = new Set<string>();
  for (const identity of values) {
    const key = `${identity.kind}\u0000${identity.value}`;
    if (seen.has(key)) return identity.kind;
    seen.add(key);
  }
  return undefined;
}

export function createM9b13SyntheticDryRunInput(): M9b13DryRunInput {
  return dryRunInputSchema.parse({
    protocol: M9B13_PROTOCOLS.dryRun,
    bindings: {
      preregistrationDigest: M9B13_FROZEN_BINDINGS.preregistrationDigest,
      receiptDigest: M9B13_FROZEN_BINDINGS.receiptDigest,
      osfRegistration: M9B13_FROZEN_BINDINGS.osfRegistration,
    },
    population: {
      families: 8,
      scales: 3,
      cells: 24,
      probePairsPerCell: 1,
      probePairs: 24,
      primaryPairsPerCell: 7,
      primaryPairs: 168,
      totalPairs: 192,
      countRequests: 768,
      inferenceCalls: 768,
      maximumHttpRequests: 1_536,
    },
    roles: M9B13_ROLES,
    roots: M9B13_FUTURE_ROOTS,
    isolationProofs: M9B13_ISOLATION_CHANNELS,
    auditDimensions: M9B13_AUDIT_DIMENSIONS,
    inventoryAuthority: "authoritative-synthetic-materializer-output",
    observerAuthority: "controller-issued-synthetic-opaque-token",
    searchRoots: [
      "docs/m9b12f-preregistration",
      "docs/m9b12f-registration-receipt",
      "packages/generator/src/m9a-corpus.ts",
      "packages/generator/src/m9b3-preparation.ts",
      "packages/generator/src/m9b4-effect-ledger.ts",
      "packages/generator-ai-sdk/internal/m9b13-materialization-readiness.ts",
    ],
    attemptedPaths: [],
    roleCombinations: M9B13_ROLES.map((role) => ({
      principal: `synthetic-test-only/${role}`,
      roles: [role],
    })),
    authorPacketFields: [
      "task",
      "snapshot-identity",
      "answer-schema",
      "retrieval-limits",
    ],
    crossPacketMetadataFields: [],
    identities: [
      { kind: "case", value: "synthetic-case-canary-a" },
      { kind: "source", value: "synthetic-source-canary-a" },
      { kind: "fact", value: "synthetic-fact-canary-a" },
      { kind: "opaque-principal", value: "synthetic-principal-canary-a" },
    ],
    splitOverlaps: [],
    sourceNearDuplicates: 0,
    provenanceComplete: true,
    exposureInventoryComplete: true,
    filesystemEntries: M9B13_FUTURE_ROOTS.map((path) => ({
      path,
      kind: "directory" as const,
      mode: 0o700,
      ownerMatches: true,
    })),
    networkEnabledRoles: [],
    leakedEnvironmentKeys: [],
    dependencies: {
      node: "24.18.1",
      pnpm: "10.33.0",
      typescript: "6.0.3",
      zod: "4.4.3",
      vitest: "4.1.10",
      offlineStoreAvailable: true,
      workspaceDependenciesInstalled: true,
      declarationsBuildable: true,
      cleanNode24ContainerBaseAvailable: false,
      containerBaseIdentity: null,
      workspaceFallbackPermitted: false,
    },
    authorityActivationRequested: false,
    executionAuthorizationPresent: false,
    materializationAuthorizationPresent: false,
    analysisRequested: false,
    prohibitedAttempts: {
      scheduleOrRandomization: false,
      corpusArtifact: false,
      goldArtifact: false,
    },
    effects: M9B13_ZERO_EFFECTS,
  });
}

export async function runM9b13ZeroEffectDryRun(
  input: unknown,
): Promise<Result<M9b13DryRunReport, M9b13ReadinessFailure>> {
  const parsed = dryRunInputSchema.safeParse(input);
  if (!parsed.success) return reject("m9b13:invalid-dry-run-fixture");
  const fixture = parsed.data;
  if (
    fixture.bindings.preregistrationDigest !==
      M9B13_FROZEN_BINDINGS.preregistrationDigest ||
    fixture.bindings.receiptDigest !== M9B13_FROZEN_BINDINGS.receiptDigest ||
    fixture.bindings.osfRegistration !== M9B13_FROZEN_BINDINGS.osfRegistration
  )
    return reject("m9b13:binding-mismatch");
  if (!equalSet(fixture.roles, M9B13_ROLES))
    return reject("m9b13:role-topology-incomplete");
  if (!equalSet(fixture.roots, M9B13_FUTURE_ROOTS))
    return reject("m9b13:namespace-topology-incomplete");
  if (!equalSet(fixture.isolationProofs, M9B13_ISOLATION_CHANNELS))
    return reject("m9b13:isolation-proof-incomplete");
  if (!equalSet(fixture.auditDimensions, M9B13_AUDIT_DIMENSIONS))
    return reject("m9b13:split-audit-incomplete");
  if (
    fixture.inventoryAuthority !== "authoritative-synthetic-materializer-output"
  )
    return reject("m9b13:caller-selected-case-inventory");
  if (fixture.observerAuthority !== "controller-issued-synthetic-opaque-token")
    return reject("m9b13:caller-selected-observer-identity");
  if (
    fixture.searchRoots.some(
      (root) => root === "." || root === ".." || root === "/",
    )
  )
    return reject("m9b13:repository-wide-search-forbidden");
  if (
    fixture.attemptedPaths.some((path) =>
      /(^|\/)(sealed|retired|paper|private-artifacts|credentials)(\/|$)/u.test(
        path,
      ),
    )
  )
    return reject("m9b13:forbidden-retired-path");
  if (
    fixture.roleCombinations.some(
      ({ roles }) =>
        roles.length !== 1 ||
        (roles.includes("constructor") && roles.includes("evaluator")),
    )
  )
    return reject("m9b13:incompatible-role-combination");
  if (
    fixture.authorPacketFields.some((field) =>
      [
        "hidden-gold",
        "gold-answer",
        "supporting-fact-witness",
        "evaluator-label",
      ].includes(field),
    )
  )
    return reject("m9b13:hidden-gold-in-author-packet");
  if (fixture.crossPacketMetadataFields.length !== 0)
    return reject("m9b13:cross-packet-ordering-metadata");
  const duplicate = duplicateIdentity(fixture.identities);
  if (duplicate !== undefined)
    return reject(`m9b13:duplicate-${duplicate}-identity`);
  if (fixture.splitOverlaps.length !== 0)
    return reject("m9b13:development-probe-primary-overlap");
  if (fixture.sourceNearDuplicates !== 0)
    return reject("m9b13:source-near-duplicate-leakage");
  if (!fixture.provenanceComplete)
    return reject("m9b13:missing-provenance-record");
  if (!fixture.exposureInventoryComplete)
    return reject("m9b13:incomplete-exposure-inventory");
  if (
    fixture.filesystemEntries.some(
      (entry) =>
        entry.kind === "symlink" ||
        entry.kind === "other" ||
        !entry.ownerMatches ||
        (entry.kind === "directory"
          ? entry.mode !== 0o700
          : entry.mode !== 0o600),
    )
  )
    return reject("m9b13:filesystem-symlink-permission-or-ownership-drift");
  if (fixture.networkEnabledRoles.length !== 0)
    return reject("m9b13:network-enabled-study-role");
  if (fixture.leakedEnvironmentKeys.length !== 0)
    return reject("m9b13:credential-or-environment-leakage");
  if (fixture.dependencies.workspaceFallbackPermitted)
    return reject("m9b13:dependency-workspace-fallback");
  if (fixture.authorityActivationRequested)
    return reject("m9b13:authority-activation-during-readiness");
  if (fixture.executionAuthorizationPresent)
    return reject("m9b13:execution-authorization-during-readiness");
  if (fixture.materializationAuthorizationPresent)
    return reject("m9b13:materialization-authorization-during-readiness");
  if (fixture.analysisRequested)
    return reject("m9b13:analysis-during-readiness");
  if (fixture.prohibitedAttempts.scheduleOrRandomization)
    return reject("m9b13:schedule-or-randomization-instantiated");
  if (fixture.prohibitedAttempts.corpusArtifact)
    return reject("m9b13:corpus-artifact-emitted");
  if (fixture.prohibitedAttempts.goldArtifact)
    return reject("m9b13:gold-artifact-emitted");
  if (!effectsAreZero(fixture.effects))
    return reject("m9b13:prohibited-effect-nonzero");

  const population = fixture.population;
  if (
    population.families * population.scales !== population.cells ||
    population.cells * population.probePairsPerCell !== population.probePairs ||
    population.cells * population.primaryPairsPerCell !==
      population.primaryPairs ||
    population.probePairs + population.primaryPairs !== population.totalPairs ||
    population.totalPairs * 4 !== population.countRequests ||
    population.totalPairs * 4 !== population.inferenceCalls ||
    population.totalPairs * 8 !== population.maximumHttpRequests
  )
    return reject("m9b13:population-arithmetic-mismatch");

  const dependencyComplete =
    fixture.dependencies.node === "24.18.1" &&
    fixture.dependencies.pnpm === "10.33.0" &&
    fixture.dependencies.typescript === "6.0.3" &&
    fixture.dependencies.zod === "4.4.3" &&
    fixture.dependencies.vitest === "4.1.10" &&
    fixture.dependencies.offlineStoreAvailable &&
    fixture.dependencies.workspaceDependenciesInstalled &&
    fixture.dependencies.declarationsBuildable &&
    fixture.dependencies.cleanNode24ContainerBaseAvailable &&
    fixture.dependencies.containerBaseIdentity !== null;
  const findings = dependencyComplete
    ? []
    : [
        {
          code: "m9b13:clean-node24-container-base-unavailable",
          detail:
            "No clean study-eligible Node 24 container base is locally available; network acquisition and reuse of unrelated historical images are forbidden.",
        },
      ];
  const body = {
    protocol: M9B13_PROTOCOLS.dryRun,
    status: "completed-offline-zero-effect" as const,
    decision: dependencyComplete
      ? ("m9b13-materialization-readiness-go" as const)
      : ("m9b13-materialization-readiness-no-go" as const),
    findings,
    checks: {
      bindings: "passed" as const,
      roleTopology: "passed" as const,
      namespaceIsolation: "passed" as const,
      accessProvenance: "passed" as const,
      populationArithmetic: "passed" as const,
      splitAuditCompleteness: "passed" as const,
      dependencyClosure: dependencyComplete
        ? ("passed" as const)
        : ("failed" as const),
      noNetwork: "passed" as const,
      noCredentials: "passed" as const,
      noCorpus: "passed" as const,
      noGold: "passed" as const,
      noProviderCalls: "passed" as const,
      noSchedule: "passed" as const,
      noAuthorityActivation: "passed" as const,
      noAnalysis: "passed" as const,
    },
    effects: fixture.effects,
  };
  const digest = await digestValue(body);
  if (!digest.ok) return reject("m9b13:dry-run-report-digest-failed");
  return {
    ok: true,
    value: dryRunReportSchema.parse({ ...body, reportDigest: digest.value }),
  };
}

type SyntheticPrincipal = Readonly<{ kind: "m9b13-synthetic-principal" }>;
type SyntheticLaunchHandle = Readonly<{ kind: "m9b13-synthetic-launch" }>;

export type M9b13SyntheticAuthority = Readonly<{
  issuePrincipal: (role: (typeof M9B13_ROLES)[number]) => SyntheticPrincipal;
  issueLaunch: (
    principal: SyntheticPrincipal,
    authorization: "materialization" | "execution",
  ) => Result<SyntheticLaunchHandle, M9b13ReadinessFailure>;
  admit: (
    handle: unknown,
    requiredAuthorization: "materialization" | "execution",
  ) => Result<"admitted", M9b13ReadinessFailure>;
  quarantine: (
    principal: SyntheticPrincipal,
  ) => Result<true, M9b13ReadinessFailure>;
  advanceRevision: () => void;
}>;

export async function validateM9b13SyntheticFilesystem(
  root: string,
): Promise<Result<true, M9b13ReadinessFailure>> {
  const resolvedRoot = resolve(root);
  const relativeToTemporary = relative(resolve(tmpdir()), resolvedRoot);
  if (
    relativeToTemporary === "" ||
    relativeToTemporary.startsWith("..") ||
    isAbsolute(relativeToTemporary)
  )
    return reject("m9b13:synthetic-fixture-outside-temporary-root");
  const rootStat = await lstat(resolvedRoot);
  if (!rootStat.isDirectory() || (rootStat.mode & 0o777) !== 0o700)
    return reject("m9b13:filesystem-symlink-permission-or-ownership-drift");
  const entries = await readdir(resolvedRoot, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = resolve(resolvedRoot, entry.name);
    const entryStat = await lstat(entryPath);
    if (
      entry.isSymbolicLink() ||
      (!entry.isDirectory() && !entry.isFile()) ||
      (entryStat.mode & 0o777) !== (entry.isDirectory() ? 0o700 : 0o600)
    )
      return reject("m9b13:filesystem-symlink-permission-or-ownership-drift");
  }
  return { ok: true, value: true };
}

export function createM9b13SyntheticAuthority(): M9b13SyntheticAuthority {
  let revision = 0;
  const principals = new WeakMap<
    SyntheticPrincipal,
    { quarantined: boolean }
  >();
  const launches = new WeakMap<
    object,
    Readonly<{
      principal: SyntheticPrincipal;
      authorization: "materialization" | "execution";
      revision: number;
      consumed: boolean;
    }>
  >();
  return Object.freeze({
    issuePrincipal(role) {
      void role;
      const principal: SyntheticPrincipal = Object.freeze({
        kind: "m9b13-synthetic-principal",
      });
      principals.set(principal, { quarantined: false });
      return principal;
    },
    issueLaunch(principal, authorization) {
      const state = principals.get(principal);
      if (state === undefined)
        return reject("m9b13:caller-selected-observer-identity");
      if (state.quarantined) return reject("m9b13:quarantined-identity");
      const handle: SyntheticLaunchHandle = Object.freeze({
        kind: "m9b13-synthetic-launch",
      });
      launches.set(handle, {
        principal,
        authorization,
        revision,
        consumed: false,
      });
      return { ok: true, value: handle };
    },
    admit(handle, requiredAuthorization) {
      if (typeof handle !== "object" || handle === null)
        return reject("m9b13:copied-launch-handle");
      const launch = launches.get(handle);
      if (launch === undefined) return reject("m9b13:copied-launch-handle");
      if (launch.consumed) return reject("m9b13:launch-handle-consumed");
      if (launch.revision !== revision) return reject("m9b13:stale-admission");
      const principal = principals.get(launch.principal);
      if (principal === undefined)
        return reject("m9b13:caller-selected-observer-identity");
      if (principal.quarantined) return reject("m9b13:quarantined-identity");
      if (launch.authorization !== requiredAuthorization)
        return reject("m9b13:authorization-domain-mismatch");
      launches.set(handle, { ...launch, consumed: true });
      return { ok: true, value: "admitted" };
    },
    quarantine(principal) {
      const state = principals.get(principal);
      if (state === undefined)
        return reject("m9b13:caller-selected-observer-identity");
      principals.set(principal, { quarantined: true });
      revision += 1;
      return { ok: true, value: true };
    },
    advanceRevision() {
      revision += 1;
    },
  });
}
