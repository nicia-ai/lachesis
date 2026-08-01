import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Result } from "@nicia-ai/lachesis";
import { afterEach, describe, expect, it } from "vitest";

import {
  M9B12B_CONTAMINATION_ANCESTORS,
  M9B12B_INFLUENCE_BEARING_ROLES,
  M9B12B_ISOLATION_CHANNELS,
  type M9b12bInfluenceBearingRole,
} from "../internal/m9b12b-preregistration.js";
import {
  admitM9b12dRoleStartup,
  auditM9b12dAuthority,
  createNewM9b12dAuthority,
  issueM9b12dObserverLaunchHandle,
  M9B12D_DURABLE_AUTHORITY_PROTOCOL,
  type M9b12dAdmissionRequest,
  type M9b12dAuthorityPaths,
  type M9b12dBoundaryReceipt,
  type M9b12dDurableAuthority,
  type M9b12dFailure,
  type M9b12dIdentityReceipt,
  type M9b12dQuarantineReceipt,
  type M9b12dTrustedAuthorityBinding,
  openExistingM9b12dAuthority,
  snapshotM9b12dAuthorityState,
  validateM9b12dAuthorityState,
} from "../internal/m9b12d-durable-authority-node.js";

const roots: Array<string> = [];

function identity(character: string): string {
  return character.repeat(64);
}

async function paths(label: string): Promise<
  Readonly<{
    root: string;
    paths: M9b12dAuthorityPaths;
  }>
> {
  const root = await mkdtemp(join(tmpdir(), `lachesis-m9b12d-${label}-`));
  roots.push(root);
  return {
    root,
    paths: {
      databasePath: join(root, "authority-store", "authority.sqlite"),
      anchorPath: join(root, "trusted-anchor", "anchor.json"),
    },
  };
}

function unwrap<T>(
  result:
    Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }>,
): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function cleanProofs(
  retiredMaterialStatus: "none" | "suspected" | "confirmed" = "none",
): M9b12dAdmissionRequest["currentAssessment"] {
  return {
    exposureInventory: { status: "complete", commitment: identity("2") },
    isolationProofs: M9B12B_ISOLATION_CHANNELS.map((channel) => ({
      channel,
      decision: "isolated",
    })),
    unsupportedIsolationChannels: [],
    lineageProofs: M9B12B_CONTAMINATION_ANCESTORS.map((ancestorKind) => ({
      ancestorKind,
      decision: "clean",
    })),
    unsupportedAncestorKinds: [],
    noninterference: "confirmed",
    retiredMaterialStatus,
    forbiddenAccessAttempts: [],
    unclassifiedAccessChannels: [],
    frozenCountsCommitment: null,
    manualCleanupAttempted: false,
    restart: {
      attempted: false,
      freshRoleIdentity: true,
      freshEnvironment: true,
      freshSeed: true,
      freshCorpusConstruction: true,
      reusedIdentityTemplatePacketOrMaterialization: false,
    },
    providerEffectAttempted: false,
  };
}

async function createAuthority(label: string): Promise<
  Readonly<{
    root: string;
    paths: M9b12dAuthorityPaths;
    authority: M9b12dDurableAuthority;
    binding: M9b12dTrustedAuthorityBinding;
  }>
> {
  const location = await paths(label);
  const created = unwrap(await createNewM9b12dAuthority(location.paths));
  return {
    ...location,
    authority: created.authority,
    binding: created.trustedBinding,
  };
}

async function issue(
  authority: M9b12dDurableAuthority,
  options: Readonly<{
    principal?: string;
    allocation?: string;
    role?: M9b12bInfluenceBearingRole;
    session?: string;
    validThroughEpochMs?: number | null;
  }> = {},
): Promise<M9b12dIdentityReceipt> {
  return unwrap(
    await issueM9b12dObserverLaunchHandle(authority, {
      studyPrincipalIdentity: options.principal ?? "Observer Alpha",
      launchAllocationIdentity: options.allocation ?? "allocation-alpha",
      requestedRole: options.role ?? "constructor",
      sessionIdentity: options.session ?? identity("a"),
      validThroughEpochMs: options.validThroughEpochMs ?? null,
    }),
  );
}

function admissionRequest(
  issued: M9b12dIdentityReceipt,
  options: Readonly<{
    admissionIdentity?: string;
    derivedInventoryIdentity?: string;
    retiredMaterialStatus?: "none" | "suspected" | "confirmed";
  }> = {},
): M9b12dAdmissionRequest {
  return {
    launchHandle: issued.launchHandle,
    requestedRole: issued.requestedRole,
    sessionIdentity: issued.sessionIdentity,
    derivedInventoryIdentity: options.derivedInventoryIdentity ?? identity("b"),
    admissionIdentity: options.admissionIdentity ?? identity("c"),
    currentAssessment: cleanProofs(options.retiredMaterialStatus),
  };
}

function successfulEffect(counter: { value: number }) {
  return (): Promise<Readonly<{ ok: true; value: undefined }>> => {
    counter.value += 1;
    return Promise.resolve({ ok: true, value: undefined });
  };
}

async function expectCompleteQuarantine(
  authority: M9b12dDurableAuthority,
  receipt: M9b12dBoundaryReceipt,
  request: M9b12dAdmissionRequest,
  observerKey: string,
  reason: string,
): Promise<void> {
  expect(receipt).toMatchObject({
    decision: "quarantine-reuse-forbidden",
    reasons: [reason],
    canonicalObserverKey: observerKey,
    launchHandle: request.launchHandle,
    requestedRole: request.requestedRole,
    sessionIdentity: request.sessionIdentity,
    derivedInventoryIdentity: request.derivedInventoryIdentity,
    observerReuseForbidden: true,
    roleSessionStartupPermitted: false,
    providerEffectsPermitted: false,
    derivedInventoryQuarantined: true,
    derivedInventoryReuseForbidden: true,
    observerExcludedFromLaterRoles: M9B12B_INFLUENCE_BEARING_ROLES,
    affectedRoleIdentities: M9B12B_INFLUENCE_BEARING_ROLES,
    affectedSessionIdentities: [request.sessionIdentity],
    affectedDerivedInventoryIdentities: [request.derivedInventoryIdentity],
    noAdmissionRecordCreated: true,
  });
  if (receipt.decision !== "quarantine-reuse-forbidden")
    throw new Error("Expected a quarantine receipt.");
  const quarantine: M9b12dQuarantineReceipt = receipt;
  const state = unwrap(await snapshotM9b12dAuthorityState(authority));
  expect(quarantine.durableHistoryHead).toEqual({
    protocol: M9B12D_DURABLE_AUTHORITY_PROTOCOL,
    storeIdentity: state.storeIdentity,
    preregistrationDigest: state.preregistrationDigest,
    revision: state.revision,
    digest: state.headDigest,
  });
  expect(
    state.events.filter((event) => event.kind === "admission-effect-started"),
  ).toHaveLength(0);
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("M9b.12d private durable authority", () => {
  it("creates explicitly, opens existing state, and never initializes missing state", async () => {
    const location = await paths("lifecycle");
    expect(
      await openExistingM9b12dAuthority(location.paths, {
        protocol: M9B12D_DURABLE_AUTHORITY_PROTOCOL,
      }),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
    const created = unwrap(await createNewM9b12dAuthority(location.paths));
    expect(await createNewM9b12dAuthority(location.paths)).toMatchObject({
      ok: false,
      error: { kind: "storage" },
    });
    const opened = unwrap(
      await openExistingM9b12dAuthority(location.paths, created.trustedBinding),
    );
    expect(unwrap(await auditM9b12dAuthority(opened))).toMatchObject({
      revision: 0,
      identityMappings: 0,
      quarantineEvents: 0,
      admissionStarts: 0,
      databaseMode: 0o600,
      anchorMode: 0o600,
      parentDirectoryMode: 0o700,
    });
  });

  it("admits a clean trusted observer exactly once through the effect boundary", async () => {
    const {
      authority,
      paths: authorityPaths,
      binding,
    } = await createAuthority("positive");
    const issued = await issue(authority);
    const request = admissionRequest(issued);
    const effects = { value: 0 };
    const receipt = unwrap(
      await admitM9b12dRoleStartup(
        authority,
        request,
        successfulEffect(effects),
      ),
    );
    expect(receipt).toMatchObject({
      decision: "atomic-admission-completed",
      admissionState: "completed",
      canonicalObserverKey: issued.canonicalObserverKey,
      oneTimeAdmissionConsumed: true,
      reusablePermissionExposed: false,
      providerEffectsPermitted: false,
      requiredProviderEffectLedgerProtocol:
        "lachesis-m9b4-offline-effect-ledger@1.2.0",
    });
    expect("roleSessionStartupPermitted" in receipt).toBe(false);
    expect(effects.value).toBe(1);
    expect(
      await admitM9b12dRoleStartup(
        authority,
        request,
        successfulEffect(effects),
      ),
    ).toMatchObject({ ok: false, error: { kind: "admission" } });
    expect(effects.value).toBe(1);
    const reopened = unwrap(
      await openExistingM9b12dAuthority(authorityPaths, binding),
    );
    expect(unwrap(await auditM9b12dAuthority(reopened))).toMatchObject({
      admissionStarts: 1,
      completedAdmissions: 1,
      ambiguousAdmissions: 0,
    });
  });

  it("permanently quarantines across new handles, roles, sessions, inventories, and reopen", async () => {
    const created = await createAuthority("permanent");
    const first = await issue(created.authority);
    const exposed = admissionRequest(first, {
      retiredMaterialStatus: "confirmed",
    });
    const effects = { value: 0 };
    const initial = unwrap(
      await admitM9b12dRoleStartup(
        created.authority,
        exposed,
        successfulEffect(effects),
      ),
    );
    await expectCompleteQuarantine(
      created.authority,
      initial,
      exposed,
      first.canonicalObserverKey,
      "retired-material-confirmed",
    );
    const reopened = unwrap(
      await openExistingM9b12dAuthority(created.paths, created.binding),
    );
    const second = await issue(reopened, {
      principal: " observer alpha ",
      allocation: "allocation-beta",
      role: "runtime-controller",
      session: identity("d"),
    });
    expect(second.canonicalObserverKey).toBe(first.canonicalObserverKey);
    const retry = admissionRequest(second, {
      admissionIdentity: identity("e"),
      derivedInventoryIdentity: identity("f"),
    });
    const rejected = unwrap(
      await admitM9b12dRoleStartup(reopened, retry, successfulEffect(effects)),
    );
    await expectCompleteQuarantine(
      reopened,
      rejected,
      retry,
      first.canonicalObserverKey,
      "observer-previously-quarantined",
    );
    expect(effects.value).toBe(0);
  });

  it("normalizes trusted principals and rejects caller identity rotation, foreign handles, and expiry", async () => {
    const { authority } = await createAuthority("identity");
    const first = await issue(authority, {
      principal: "  OBSERVER  Alpha  ",
      allocation: "allocation-one",
    });
    const normalized = await issue(authority, {
      principal: "Ｏｂｓｅｒｖｅｒ Alpha",
      allocation: "allocation-two",
      role: "analyst",
      session: identity("d"),
    });
    expect(normalized.canonicalObserverKey).toBe(first.canonicalObserverKey);
    const callerIdentity = {
      ...admissionRequest(first),
      observerCommitment: identity("f"),
    };
    expect(
      await admitM9b12dRoleStartup(
        authority,
        callerIdentity,
        successfulEffect({ value: 0 }),
      ),
    ).toMatchObject({ ok: false, error: { kind: "authorization" } });
    expect(
      await admitM9b12dRoleStartup(
        authority,
        {
          ...admissionRequest(first),
          studyPrincipalIdentity: "caller-selected-alias",
        },
        successfulEffect({ value: 0 }),
      ),
    ).toMatchObject({ ok: false, error: { kind: "authorization" } });
    expect(
      await admitM9b12dRoleStartup(
        authority,
        { ...admissionRequest(first), launchHandle: identity("9") },
        successfulEffect({ value: 0 }),
      ),
    ).toMatchObject({ ok: false, error: { kind: "identity" } });
    expect(
      await admitM9b12dRoleStartup(
        authority,
        {
          ...admissionRequest(normalized),
          requestedRole: "constructor",
          sessionIdentity: first.sessionIdentity,
        },
        successfulEffect({ value: 0 }),
      ),
    ).toMatchObject({ ok: false, error: { kind: "identity" } });
    const otherObserver = await issue(authority, {
      principal: "Observer Beta",
      allocation: "allocation-other-observer",
      role: "author",
      session: identity("6"),
    });
    expect(
      await admitM9b12dRoleStartup(
        authority,
        {
          ...admissionRequest(first),
          launchHandle: otherObserver.launchHandle,
        },
        successfulEffect({ value: 0 }),
      ),
    ).toMatchObject({ ok: false, error: { kind: "identity" } });
    const expired = await issue(authority, {
      allocation: "allocation-expired",
      session: identity("8"),
      validThroughEpochMs: 0,
    });
    expect(
      await admitM9b12dRoleStartup(
        authority,
        admissionRequest(expired, { admissionIdentity: identity("7") }),
        successfulEffect({ value: 0 }),
      ),
    ).toMatchObject({ ok: false, error: { kind: "identity" } });
  });

  it("rejects duplicate and concurrent launch allocation issuance", async () => {
    const { authority } = await createAuthority("identity-race");
    const input = {
      studyPrincipalIdentity: "observer-alpha",
      launchAllocationIdentity: "one-allocation",
      requestedRole: "constructor",
      sessionIdentity: identity("a"),
      validThroughEpochMs: null,
    } as const;
    const results = await Promise.all([
      issueM9b12dObserverLaunchHandle(authority, input),
      issueM9b12dObserverLaunchHandle(authority, input),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(
      await issueM9b12dObserverLaunchHandle(authority, input),
    ).toMatchObject({ ok: false, error: { kind: "identity" } });
  });

  it("lets quarantine win between proof validation and admission CAS", async () => {
    const { authority } = await createAuthority("quarantine-wins");
    const issued = await issue(authority);
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let validated: (() => void) | undefined;
    const reached = new Promise<void>((resolve) => {
      validated = resolve;
    });
    const effects = { value: 0 };
    const clean = admitM9b12dRoleStartup(
      authority,
      admissionRequest(issued),
      successfulEffect(effects),
      {
        afterValidationBeforeCommit: async () => {
          validated?.();
          await barrier;
        },
      },
    );
    await reached;
    const quarantined = unwrap(
      await admitM9b12dRoleStartup(
        authority,
        admissionRequest(issued, {
          admissionIdentity: identity("d"),
          retiredMaterialStatus: "confirmed",
        }),
        successfulEffect(effects),
      ),
    );
    expect(quarantined.decision).toBe("quarantine-reuse-forbidden");
    release?.();
    expect(await clean).toMatchObject({
      ok: false,
      error: {
        kind: "admission",
        message: "Quarantine committed before atomic admission.",
      },
    });
    expect(effects.value).toBe(0);
  });

  it("records truthful ordering when admission wins before quarantine", async () => {
    const { authority } = await createAuthority("admission-wins");
    const issued = await issue(authority);
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let validated: (() => void) | undefined;
    const reached = new Promise<void>((resolve) => {
      validated = resolve;
    });
    const quarantine = admitM9b12dRoleStartup(
      authority,
      admissionRequest(issued, {
        admissionIdentity: identity("d"),
        retiredMaterialStatus: "confirmed",
      }),
      successfulEffect({ value: 0 }),
      {
        afterValidationBeforeCommit: async () => {
          validated?.();
          await barrier;
        },
      },
    );
    await reached;
    const effects = { value: 0 };
    const admitted = unwrap(
      await admitM9b12dRoleStartup(
        authority,
        admissionRequest(issued),
        successfulEffect(effects),
      ),
    );
    expect(admitted.decision).toBe("atomic-admission-completed");
    release?.();
    const quarantined = unwrap(await quarantine);
    expect(quarantined.decision).toBe("quarantine-reuse-forbidden");
    const state = unwrap(await snapshotM9b12dAuthorityState(authority));
    const admissionIndex = state.events.findIndex(
      (event) => event.kind === "admission-effect-started",
    );
    const quarantineIndex = state.events.findIndex(
      (event) => event.kind === "quarantine",
    );
    expect(admissionIndex).toBeGreaterThanOrEqual(0);
    expect(quarantineIndex).toBeGreaterThan(admissionIndex);
    expect(effects.value).toBe(1);
  });

  it("consumes one concurrent admission identity and invokes one effect", async () => {
    const { authority } = await createAuthority("admission-race");
    const issued = await issue(authority);
    const request = admissionRequest(issued);
    const effects = { value: 0 };
    const results = await Promise.all([
      admitM9b12dRoleStartup(authority, request, successfulEffect(effects)),
      admitM9b12dRoleStartup(authority, request, successfulEffect(effects)),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(effects.value).toBe(1);
  });

  it("fails before commit without consuming admission and fails closed after database-only commit", async () => {
    const before = await createAuthority("crash-before");
    const issued = await issue(before.authority);
    const request = admissionRequest(issued);
    expect(
      await admitM9b12dRoleStartup(
        before.authority,
        request,
        successfulEffect({ value: 0 }),
        { transactionFault: "before-database-update" },
      ),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
    expect(unwrap(await auditM9b12dAuthority(before.authority))).toMatchObject({
      admissionStarts: 0,
    });
    expect(
      unwrap(
        await admitM9b12dRoleStartup(
          before.authority,
          request,
          successfulEffect({ value: 0 }),
        ),
      ).decision,
    ).toBe("atomic-admission-completed");

    const afterDatabase = await createAuthority("crash-database");
    const afterIssued = await issue(afterDatabase.authority);
    expect(
      await admitM9b12dRoleStartup(
        afterDatabase.authority,
        admissionRequest(afterIssued),
        successfulEffect({ value: 0 }),
        { transactionFault: "after-database-commit-before-anchor" },
      ),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
    expect(
      await openExistingM9b12dAuthority(
        afterDatabase.paths,
        afterDatabase.binding,
      ),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
  });

  it("retains conservative ambiguous state across crashes before or after the effect", async () => {
    for (const crash of [
      "crashAfterAnchorBeforeEffect",
      "crashAfterEffectBeforeTerminal",
    ] as const) {
      const created = await createAuthority(crash);
      const issued = await issue(created.authority);
      const request = admissionRequest(issued);
      const effects = { value: 0 };
      const result = await admitM9b12dRoleStartup(
        created.authority,
        request,
        successfulEffect(effects),
        { [crash]: true },
      );
      expect(result).toMatchObject({
        ok: false,
        error: { kind: "admission" },
      });
      const reopened = unwrap(
        await openExistingM9b12dAuthority(created.paths, created.binding),
      );
      expect(unwrap(await auditM9b12dAuthority(reopened))).toMatchObject({
        admissionStarts: 1,
        ambiguousAdmissions: 1,
      });
      expect(
        await admitM9b12dRoleStartup(
          reopened,
          { ...request, admissionIdentity: identity("e") },
          successfulEffect(effects),
        ),
      ).toMatchObject({ ok: false, error: { kind: "admission" } });
      expect(effects.value).toBe(
        crash === "crashAfterAnchorBeforeEffect" ? 0 : 1,
      );
    }
  });

  it("marks a caught effect-boundary failure ambiguous and never redispatches", async () => {
    const created = await createAuthority("effect-failure");
    const issued = await issue(created.authority);
    const request = admissionRequest(issued);
    let effects = 0;
    const failed = await admitM9b12dRoleStartup(
      created.authority,
      request,
      (): Promise<Result<void, M9b12dFailure>> => {
        effects += 1;
        return Promise.resolve({
          ok: false,
          error: { kind: "admission", message: "intercepted startup failure" },
        });
      },
    );
    expect(failed).toMatchObject({ ok: false, error: { kind: "admission" } });
    expect(unwrap(await auditM9b12dAuthority(created.authority))).toMatchObject(
      {
        admissionStarts: 1,
        ambiguousAdmissions: 1,
      },
    );
    expect(
      await admitM9b12dRoleStartup(
        created.authority,
        { ...request, admissionIdentity: identity("f") },
        () => {
          effects += 1;
          return Promise.resolve({ ok: true, value: undefined } as const);
        },
      ),
    ).toMatchObject({ ok: false, error: { kind: "admission" } });
    expect(effects).toBe(1);
  });

  it("rejects rollback, replacement, wrong anchors, modes, and symlinks", async () => {
    const created = await createAuthority("hostile");
    const backup = join(created.root, "old.sqlite");
    await copyFile(created.paths.databasePath, backup);
    await chmod(backup, 0o600);
    const issued = await issue(created.authority);
    unwrap(
      await admitM9b12dRoleStartup(
        created.authority,
        admissionRequest(issued, { retiredMaterialStatus: "confirmed" }),
        successfulEffect({ value: 0 }),
      ),
    );
    await copyFile(backup, created.paths.databasePath);
    await chmod(created.paths.databasePath, 0o600);
    expect(
      await openExistingM9b12dAuthority(created.paths, created.binding),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });

    const wrong = await createAuthority("wrong-anchor");
    expect(
      await openExistingM9b12dAuthority(wrong.paths, created.binding),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
    await chmod(wrong.paths.anchorPath, 0o644);
    expect(
      await openExistingM9b12dAuthority(wrong.paths, wrong.binding),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });

    const linked = await paths("symlink");
    await mkdir(join(linked.root, "authority-store"), { mode: 0o700 });
    await symlink(wrong.paths.databasePath, linked.paths.databasePath);
    expect(
      await openExistingM9b12dAuthority(linked.paths, wrong.binding),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
  });

  it("rejects missing, reordered, duplicated, altered, forked, and unknown event state", async () => {
    const { authority } = await createAuthority("chain");
    const issued = await issue(authority);
    unwrap(
      await admitM9b12dRoleStartup(
        authority,
        admissionRequest(issued, { retiredMaterialStatus: "confirmed" }),
        successfulEffect({ value: 0 }),
      ),
    );
    const state = unwrap(await snapshotM9b12dAuthorityState(authority));
    const first = state.events[0];
    const second = state.events[1];
    if (first === undefined || second === undefined)
      throw new Error("Expected identity and quarantine events.");
    const candidates: ReadonlyArray<unknown> = [
      {
        ...state,
        events: [second],
        revision: 1,
        headDigest: second.eventDigest,
      },
      { ...state, events: [second, first] },
      { ...state, events: [first, first], headDigest: first.eventDigest },
      { ...state, events: [first, { ...second, observerKey: identity("f") }] },
      {
        ...state,
        events: [first, { ...second, providerEffectsPermitted: true }],
      },
      {
        ...state,
        events: [first, { ...second, predecessorHeadDigest: null }],
      },
      { ...state, unsupported: true },
    ];
    for (const candidate of candidates)
      expect(await validateM9b12dAuthorityState(candidate)).toMatchObject({
        ok: false,
      });
  });

  it.each(M9B12B_INFLUENCE_BEARING_ROLES)(
    "asserts the complete durable terminal outcome for %s",
    async (role) => {
      const { authority } = await createAuthority(`role-${role}`);
      const session = identity("a");
      const issued = await issue(authority, {
        allocation: `allocation-${role}`,
        role,
        session,
      });
      const request = admissionRequest(issued, {
        retiredMaterialStatus: "suspected",
      });
      const receipt = unwrap(
        await admitM9b12dRoleStartup(
          authority,
          request,
          successfulEffect({ value: 0 }),
        ),
      );
      expect(receipt.decision).toBe("quarantine-reuse-forbidden");
      await expectCompleteQuarantine(
        authority,
        receipt,
        request,
        issued.canonicalObserverKey,
        "retired-material-suspected",
      );
    },
  );

  it("rejects malformed trusted anchor JSON without repairing it", async () => {
    const created = await createAuthority("anchor-json");
    await writeFile(created.paths.anchorPath, "{}", { mode: 0o600 });
    expect(
      await openExistingM9b12dAuthority(created.paths, created.binding),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
  });

  it("rejects missing anchors, truncated databases, unexpected schema, and exposed parents", async () => {
    const missing = await createAuthority("missing-anchor");
    await rm(missing.paths.anchorPath);
    expect(
      await openExistingM9b12dAuthority(missing.paths, missing.binding),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });

    const truncated = await createAuthority("truncated-database");
    await writeFile(truncated.paths.databasePath, "", { mode: 0o600 });
    expect(
      await openExistingM9b12dAuthority(truncated.paths, truncated.binding),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });

    const unexpectedSchema = await createAuthority("unexpected-schema");
    const database = new DatabaseSync(unexpectedSchema.paths.databasePath);
    try {
      database.exec("CREATE TABLE unexpected (value TEXT) STRICT;");
    } finally {
      database.close();
    }
    expect(
      await openExistingM9b12dAuthority(
        unexpectedSchema.paths,
        unexpectedSchema.binding,
      ),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });

    const exposedParent = await createAuthority("exposed-parent");
    await chmod(dirname(exposedParent.paths.databasePath), 0o755);
    expect(
      await openExistingM9b12dAuthority(
        exposedParent.paths,
        exposedParent.binding,
      ),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
  });
});
