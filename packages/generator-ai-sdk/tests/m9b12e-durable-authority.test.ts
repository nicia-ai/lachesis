import {
  access,
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

import { canonicalizeJson, parseJson, type Result } from "@nicia-ai/lachesis";
import { afterEach, describe, expect, it } from "vitest";

import {
  M9B12B_CONTAMINATION_ANCESTORS,
  M9B12B_INFLUENCE_BEARING_ROLES,
  M9B12B_ISOLATION_CHANNELS,
  type M9b12bInfluenceBearingRole,
} from "../internal/m9b12b-preregistration.js";
import {
  admitM9b12eRoleStartup as admitM9b12eRoleStartupWithPresenter,
  auditM9b12eAuthority,
  authenticateM9b12ePresenter,
  createM9b12eAuthenticatedChannelAdapter,
  createNewM9b12eAuthority,
  issueM9b12eObserverLaunchHandle,
  M9B12E_DURABLE_AUTHORITY_PROTOCOL,
  type M9b12eAdmissionRequest,
  type M9b12eAuthorityPaths,
  type M9b12eBoundaryReceipt,
  type M9b12eDurableAuthority,
  type M9b12eFailure,
  type M9b12eIdentityReceipt,
  type M9b12eQuarantineReceipt,
  type M9b12eTrustedAuthorityBinding,
  openExistingM9b12eAuthority,
  revokeM9b12ePresenterContext,
  snapshotM9b12eAuthorityState,
  validateM9b12eAuthorityState,
} from "../internal/m9b12e-durable-authority-node.js";

const roots: Array<string> = [];
const principalsByAuthority = new WeakMap<
  M9b12eDurableAuthority,
  Map<string, string>
>();

function identity(character: string): string {
  return character.repeat(64);
}

async function paths(label: string): Promise<
  Readonly<{
    root: string;
    paths: M9b12eAuthorityPaths;
  }>
> {
  const root = await mkdtemp(join(tmpdir(), `lachesis-m9b12e-${label}-`));
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
): M9b12eAdmissionRequest["currentAssessment"] {
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
    paths: M9b12eAuthorityPaths;
    authority: M9b12eDurableAuthority;
    binding: M9b12eTrustedAuthorityBinding;
  }>
> {
  const location = await paths(label);
  const created = unwrap(await createNewM9b12eAuthority(location.paths));
  return {
    ...location,
    authority: created.authority,
    binding: created.trustedBinding,
  };
}

async function issue(
  authority: M9b12eDurableAuthority,
  options: Readonly<{
    principal?: string;
    allocation?: string;
    role?: M9b12bInfluenceBearingRole;
    session?: string;
    validThroughEpochMs?: number | null;
    displayLabel?: string | null;
  }> = {},
): Promise<M9b12eIdentityReceipt> {
  const receipt = unwrap(
    await issueM9b12eObserverLaunchHandle(authority, {
      opaquePrincipalId: options.principal ?? identity("1"),
      launchAllocationId: options.allocation ?? identity("4"),
      displayLabel: options.displayLabel ?? "Observer Alpha",
      requestedRole: options.role ?? "constructor",
      sessionIdentity: options.session ?? identity("a"),
      validThroughEpochMs: options.validThroughEpochMs ?? null,
    }),
  );
  const principals =
    principalsByAuthority.get(authority) ?? new Map<string, string>();
  principals.set(receipt.launchHandle, receipt.principalId);
  principalsByAuthority.set(authority, principals);
  return receipt;
}

function admissionRequest(
  issued: M9b12eIdentityReceipt,
  options: Readonly<{
    admissionIdentity?: string;
    derivedInventoryIdentity?: string;
    retiredMaterialStatus?: "none" | "suspected" | "confirmed";
  }> = {},
): M9b12eAdmissionRequest {
  return {
    launchHandle: issued.launchHandle,
    launchAllocationId: issued.launchAllocationId,
    requestedRole: issued.requestedRole,
    sessionIdentity: issued.sessionIdentity,
    derivedInventoryIdentity: options.derivedInventoryIdentity ?? identity("b"),
    admissionIdentity: options.admissionIdentity ?? identity("c"),
    currentAssessment: cleanProofs(options.retiredMaterialStatus),
  };
}

async function presenter(
  authority: M9b12eDurableAuthority,
  principalId: string,
  validThroughEpochMs: number | null = null,
) {
  const adapter = createM9b12eAuthenticatedChannelAdapter(
    authority,
    (): Promise<
      Result<
        Readonly<{
          opaquePrincipalId: string;
          validThroughEpochMs: number | null;
        }>,
        M9b12eFailure
      >
    > =>
      Promise.resolve({
        ok: true,
        value: { opaquePrincipalId: principalId, validThroughEpochMs },
      }),
  );
  return unwrap(await authenticateM9b12ePresenter(adapter, Object.freeze({})));
}

async function admitM9b12eRoleStartup(
  authority: M9b12eDurableAuthority,
  value: unknown,
  effect: Parameters<typeof admitM9b12eRoleStartupWithPresenter>[3],
  hooks?: Parameters<typeof admitM9b12eRoleStartupWithPresenter>[4],
) {
  const launchHandle =
    typeof value === "object" &&
    value !== null &&
    "launchHandle" in value &&
    typeof value.launchHandle === "string"
      ? value.launchHandle
      : undefined;
  const principalId =
    launchHandle === undefined
      ? identity("1")
      : (principalsByAuthority.get(authority)?.get(launchHandle) ??
        identity("1"));
  return admitM9b12eRoleStartupWithPresenter(
    authority,
    await presenter(authority, principalId),
    value,
    effect,
    hooks,
  );
}

function successfulEffect(counter: { value: number }) {
  return (): Promise<Readonly<{ ok: true; value: undefined }>> => {
    counter.value += 1;
    return Promise.resolve({ ok: true, value: undefined });
  };
}

async function expectCompleteQuarantine(
  authority: M9b12eDurableAuthority,
  receipt: M9b12eBoundaryReceipt,
  request: M9b12eAdmissionRequest,
  observerKey: string,
  reason: string,
): Promise<void> {
  expect(receipt).toMatchObject({
    decision: "quarantine-reuse-forbidden",
    reasons: [reason],
    canonicalObserverKey: observerKey,
    launchHandle: request.launchHandle,
    launchAllocationId: request.launchAllocationId,
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
  const quarantine: M9b12eQuarantineReceipt = receipt;
  const state = unwrap(await snapshotM9b12eAuthorityState(authority));
  expect(quarantine.durableHistoryHead).toEqual({
    protocol: M9B12E_DURABLE_AUTHORITY_PROTOCOL,
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

describe("M9b.12e private durable authority", () => {
  it("creates explicitly, opens existing state, and never initializes missing state", async () => {
    const location = await paths("lifecycle");
    expect(
      await openExistingM9b12eAuthority(location.paths, {
        protocol: M9B12E_DURABLE_AUTHORITY_PROTOCOL,
      }),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
    const created = unwrap(await createNewM9b12eAuthority(location.paths));
    expect(await createNewM9b12eAuthority(location.paths)).toMatchObject({
      ok: false,
      error: { kind: "storage" },
    });
    const opened = unwrap(
      await openExistingM9b12eAuthority(location.paths, created.trustedBinding),
    );
    expect(unwrap(await auditM9b12eAuthority(opened))).toMatchObject({
      revision: 0,
      identityMappings: 0,
      quarantineEvents: 0,
      admissionStarts: 0,
      databaseMode: 0o600,
      anchorMode: 0o600,
      parentDirectoryMode: 0o700,
    });
    for (const suffix of ["-journal", "-wal", "-shm"])
      await expect(
        access(`${location.paths.databasePath}${suffix}`),
      ).rejects.toMatchObject({ code: "ENOENT" });
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
      await admitM9b12eRoleStartup(
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
      await admitM9b12eRoleStartup(
        authority,
        request,
        successfulEffect(effects),
      ),
    ).toMatchObject({ ok: false, error: { kind: "admission" } });
    expect(effects.value).toBe(1);
    const reopened = unwrap(
      await openExistingM9b12eAuthority(authorityPaths, binding),
    );
    expect(unwrap(await auditM9b12eAuthority(reopened))).toMatchObject({
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
      await admitM9b12eRoleStartup(
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
      await openExistingM9b12eAuthority(created.paths, created.binding),
    );
    const second = await issue(reopened, {
      principal: identity("1"),
      allocation: identity("5"),
      role: "runtime-controller",
      session: identity("d"),
    });
    expect(second.canonicalObserverKey).toBe(first.canonicalObserverKey);
    const retry = admissionRequest(second, {
      admissionIdentity: identity("e"),
      derivedInventoryIdentity: identity("f"),
    });
    const rejected = unwrap(
      await admitM9b12eRoleStartup(reopened, retry, successfulEffect(effects)),
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

  it("keeps opaque principals distinct despite colliding labels and rejects noncanonical identity inputs", async () => {
    const { authority } = await createAuthority("identity");
    const first = await issue(authority, {
      principal: identity("1"),
      allocation: identity("4"),
      displayLabel: "  OBSERVER  Alpha  ",
    });
    const distinct = await issue(authority, {
      principal: identity("2"),
      allocation: identity("5"),
      displayLabel: "Ｏｂｓｅｒｖｅｒ Alpha",
      role: "analyst",
      session: identity("d"),
    });
    expect(distinct.canonicalObserverKey).not.toBe(first.canonicalObserverKey);
    for (const malformed of [
      identity("A"),
      ` ${identity("a")}`,
      `${identity("a")} `,
      "Ｏ".repeat(64),
      identity("a").slice(1),
    ])
      expect(
        await issueM9b12eObserverLaunchHandle(authority, {
          opaquePrincipalId: malformed,
          launchAllocationId: identity("8"),
          displayLabel: null,
          requestedRole: "constructor",
          sessionIdentity: identity("a"),
          validThroughEpochMs: null,
        }),
      ).toMatchObject({ ok: false, error: { kind: "identity" } });
    const callerIdentity = {
      ...admissionRequest(first),
      observerCommitment: identity("f"),
    };
    expect(
      await admitM9b12eRoleStartup(
        authority,
        callerIdentity,
        successfulEffect({ value: 0 }),
      ),
    ).toMatchObject({ ok: false, error: { kind: "authorization" } });
    expect(
      await admitM9b12eRoleStartup(
        authority,
        {
          ...admissionRequest(first),
          currentAssessment: {
            ...cleanProofs(),
            presenterContext: Object.freeze({}),
          },
        },
        successfulEffect({ value: 0 }),
      ),
    ).toMatchObject({ ok: false, error: { kind: "authorization" } });
    expect(
      await admitM9b12eRoleStartup(
        authority,
        {
          ...admissionRequest(first),
          studyPrincipalIdentity: "caller-selected-alias",
        },
        successfulEffect({ value: 0 }),
      ),
    ).toMatchObject({ ok: false, error: { kind: "authorization" } });
    expect(
      await admitM9b12eRoleStartup(
        authority,
        { ...admissionRequest(first), launchHandle: identity("9") },
        successfulEffect({ value: 0 }),
      ),
    ).toMatchObject({ ok: false, error: { kind: "identity" } });
    expect(
      await admitM9b12eRoleStartup(
        authority,
        {
          ...admissionRequest(distinct),
          requestedRole: "constructor",
          sessionIdentity: first.sessionIdentity,
        },
        successfulEffect({ value: 0 }),
      ),
    ).toMatchObject({ ok: false, error: { kind: "identity" } });
    const otherObserver = await issue(authority, {
      principal: identity("3"),
      allocation: identity("6"),
      displayLabel: "Observer Beta",
      role: "author",
      session: identity("6"),
    });
    expect(
      await admitM9b12eRoleStartup(
        authority,
        {
          ...admissionRequest(first),
          launchHandle: otherObserver.launchHandle,
        },
        successfulEffect({ value: 0 }),
      ),
    ).toMatchObject({ ok: false, error: { kind: "identity" } });
    const expired = await issue(authority, {
      allocation: identity("7"),
      session: identity("8"),
      validThroughEpochMs: 0,
    });
    expect(
      await admitM9b12eRoleStartup(
        authority,
        admissionRequest(expired, { admissionIdentity: identity("7") }),
        successfulEffect({ value: 0 }),
      ),
    ).toMatchObject({ ok: false, error: { kind: "identity" } });
  });

  it("enforces runtime presenter authenticity, store binding, expiry, and revocation", async () => {
    const first = await createAuthority("presenter-boundary");
    const second = await createAuthority("presenter-other-store");
    const issued = await issue(first.authority);
    const request = admissionRequest(issued);
    const effect = successfulEffect({ value: 0 });
    expect(
      await admitM9b12eRoleStartupWithPresenter(
        first.authority,
        undefined,
        request,
        effect,
      ),
    ).toMatchObject({
      ok: false,
      error: { message: "authenticated-presenter-context-invalid" },
    });
    expect(
      await admitM9b12eRoleStartupWithPresenter(
        first.authority,
        Object.freeze({}),
        request,
        effect,
      ),
    ).toMatchObject({
      ok: false,
      error: { message: "authenticated-presenter-context-invalid" },
    });
    const wrongStore = await presenter(second.authority, issued.principalId);
    expect(
      await admitM9b12eRoleStartupWithPresenter(
        first.authority,
        wrongStore,
        request,
        effect,
      ),
    ).toMatchObject({
      ok: false,
      error: { message: "authenticated-presenter-context-wrong-store" },
    });
    const revoked = await presenter(first.authority, issued.principalId);
    expect(revokeM9b12ePresenterContext(revoked)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      await admitM9b12eRoleStartupWithPresenter(
        first.authority,
        revoked,
        request,
        effect,
      ),
    ).toMatchObject({
      ok: false,
      error: { message: "authenticated-presenter-context-revoked" },
    });
    const expiring = await presenter(
      first.authority,
      issued.principalId,
      Date.now() + 5,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      await admitM9b12eRoleStartupWithPresenter(
        first.authority,
        expiring,
        request,
        effect,
      ),
    ).toMatchObject({
      ok: false,
      error: { message: "authenticated-presenter-context-expired" },
    });
  });

  it("rejects copied complete requests under another presenter before admission or effect", async () => {
    const created = await createAuthority("copied-handle");
    const first = await issue(created.authority, {
      principal: identity("1"),
      allocation: identity("4"),
    });
    const second = await issue(created.authority, {
      principal: identity("2"),
      allocation: identity("5"),
      role: "analyst",
      session: identity("d"),
    });
    const firstPresenter = await presenter(
      created.authority,
      first.principalId,
    );
    const secondPresenter = await presenter(
      created.authority,
      second.principalId,
    );
    const firstRequest = structuredClone(admissionRequest(first));
    const serializedRequest = unwrap(
      parseJson(unwrap(canonicalizeJson(firstRequest))),
    );
    const effects = { value: 0 };
    expect(
      await admitM9b12eRoleStartupWithPresenter(
        created.authority,
        secondPresenter,
        serializedRequest,
        successfulEffect(effects),
      ),
    ).toEqual({
      ok: false,
      error: { kind: "identity", message: "presenting-principal-mismatch" },
    });
    unwrap(
      await admitM9b12eRoleStartupWithPresenter(
        created.authority,
        firstPresenter,
        { ...firstRequest, currentAssessment: cleanProofs("confirmed") },
        successfulEffect(effects),
      ),
    );
    expect(
      await admitM9b12eRoleStartupWithPresenter(
        created.authority,
        firstPresenter,
        admissionRequest(second, { admissionIdentity: identity("e") }),
        successfulEffect(effects),
      ),
    ).toEqual({
      ok: false,
      error: { kind: "identity", message: "presenting-principal-mismatch" },
    });
    expect(
      await admitM9b12eRoleStartupWithPresenter(
        created.authority,
        secondPresenter,
        firstRequest,
        successfulEffect(effects),
      ),
    ).toEqual({
      ok: false,
      error: { kind: "identity", message: "presenting-principal-mismatch" },
    });
    expect(effects.value).toBe(0);
    expect(unwrap(await auditM9b12eAuthority(created.authority))).toMatchObject(
      {
        admissionStarts: 0,
      },
    );
  });

  it("authenticates the exact opaque presenter after process-style reopen", async () => {
    const created = await createAuthority("presenter-reopen");
    const issued = await issue(created.authority);
    const reopened = unwrap(
      await openExistingM9b12eAuthority(created.paths, created.binding),
    );
    const reopenedPresenter = await presenter(reopened, issued.principalId);
    const effects = { value: 0 };
    expect(
      unwrap(
        await admitM9b12eRoleStartupWithPresenter(
          reopened,
          reopenedPresenter,
          admissionRequest(issued),
          successfulEffect(effects),
        ),
      ).decision,
    ).toBe("atomic-admission-completed");
    expect(effects.value).toBe(1);
  });

  it("revalidates presenter context inside the admission transaction", async () => {
    const created = await createAuthority("presenter-revalidation");
    const issued = await issue(created.authority);
    const context = await presenter(created.authority, issued.principalId);
    const effects = { value: 0 };
    expect(
      await admitM9b12eRoleStartupWithPresenter(
        created.authority,
        context,
        admissionRequest(issued),
        successfulEffect(effects),
        {
          afterValidationBeforeCommit: () => {
            unwrap(revokeM9b12ePresenterContext(context));
            return Promise.resolve();
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      error: { message: "authenticated-presenter-context-revoked" },
    });
    expect(effects.value).toBe(0);
    expect(unwrap(await auditM9b12eAuthority(created.authority))).toMatchObject(
      {
        admissionStarts: 0,
      },
    );
  });

  it("rejects duplicate and concurrent launch allocation issuance", async () => {
    const { authority } = await createAuthority("identity-race");
    const input = {
      opaquePrincipalId: identity("1"),
      launchAllocationId: identity("4"),
      displayLabel: "observer-alpha",
      requestedRole: "constructor",
      sessionIdentity: identity("a"),
      validThroughEpochMs: null,
    } as const;
    const results = await Promise.all([
      issueM9b12eObserverLaunchHandle(authority, input),
      issueM9b12eObserverLaunchHandle(authority, input),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(
      await issueM9b12eObserverLaunchHandle(authority, input),
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
    const clean = admitM9b12eRoleStartup(
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
      await admitM9b12eRoleStartup(
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
    const quarantine = admitM9b12eRoleStartup(
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
      await admitM9b12eRoleStartup(
        authority,
        admissionRequest(issued),
        successfulEffect(effects),
      ),
    );
    expect(admitted.decision).toBe("atomic-admission-completed");
    release?.();
    const quarantined = unwrap(await quarantine);
    expect(quarantined.decision).toBe("quarantine-reuse-forbidden");
    const state = unwrap(await snapshotM9b12eAuthorityState(authority));
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
      admitM9b12eRoleStartup(authority, request, successfulEffect(effects)),
      admitM9b12eRoleStartup(authority, request, successfulEffect(effects)),
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
      await admitM9b12eRoleStartup(
        before.authority,
        request,
        successfulEffect({ value: 0 }),
        { transactionFault: "before-database-update" },
      ),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
    expect(unwrap(await auditM9b12eAuthority(before.authority))).toMatchObject({
      admissionStarts: 0,
    });
    expect(
      unwrap(
        await admitM9b12eRoleStartup(
          before.authority,
          request,
          successfulEffect({ value: 0 }),
        ),
      ).decision,
    ).toBe("atomic-admission-completed");

    const afterDatabase = await createAuthority("crash-database");
    const afterIssued = await issue(afterDatabase.authority);
    expect(
      await admitM9b12eRoleStartup(
        afterDatabase.authority,
        admissionRequest(afterIssued),
        successfulEffect({ value: 0 }),
        { transactionFault: "after-database-commit-before-anchor" },
      ),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
    expect(
      await openExistingM9b12eAuthority(
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
      const result = await admitM9b12eRoleStartup(
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
        await openExistingM9b12eAuthority(created.paths, created.binding),
      );
      expect(unwrap(await auditM9b12eAuthority(reopened))).toMatchObject({
        admissionStarts: 1,
        ambiguousAdmissions: 1,
      });
      expect(
        await admitM9b12eRoleStartup(
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
    const failed = await admitM9b12eRoleStartup(
      created.authority,
      request,
      (): Promise<Result<void, M9b12eFailure>> => {
        effects += 1;
        return Promise.resolve({
          ok: false,
          error: { kind: "admission", message: "intercepted startup failure" },
        });
      },
    );
    expect(failed).toMatchObject({ ok: false, error: { kind: "admission" } });
    expect(unwrap(await auditM9b12eAuthority(created.authority))).toMatchObject(
      {
        admissionStarts: 1,
        ambiguousAdmissions: 1,
      },
    );
    expect(
      await admitM9b12eRoleStartup(
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
      await admitM9b12eRoleStartup(
        created.authority,
        admissionRequest(issued, { retiredMaterialStatus: "confirmed" }),
        successfulEffect({ value: 0 }),
      ),
    );
    await copyFile(backup, created.paths.databasePath);
    await chmod(created.paths.databasePath, 0o600);
    expect(
      await openExistingM9b12eAuthority(created.paths, created.binding),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });

    const anchorOnly = await createAuthority("anchor-only-rollback");
    const oldAnchor = join(anchorOnly.root, "old-anchor.json");
    await copyFile(anchorOnly.paths.anchorPath, oldAnchor);
    await chmod(oldAnchor, 0o600);
    await issue(anchorOnly.authority);
    await copyFile(oldAnchor, anchorOnly.paths.anchorPath);
    await chmod(anchorOnly.paths.anchorPath, 0o600);
    expect(
      await openExistingM9b12eAuthority(anchorOnly.paths, anchorOnly.binding),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });

    const wrong = await createAuthority("wrong-anchor");
    expect(
      await openExistingM9b12eAuthority(wrong.paths, created.binding),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
    await chmod(wrong.paths.anchorPath, 0o644);
    expect(
      await openExistingM9b12eAuthority(wrong.paths, wrong.binding),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });

    const exposedDatabase = await createAuthority("exposed-database");
    await chmod(exposedDatabase.paths.databasePath, 0o644);
    expect(
      await openExistingM9b12eAuthority(
        exposedDatabase.paths,
        exposedDatabase.binding,
      ),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });

    const linked = await paths("symlink");
    await mkdir(join(linked.root, "authority-store"), { mode: 0o700 });
    await symlink(wrong.paths.databasePath, linked.paths.databasePath);
    expect(
      await openExistingM9b12eAuthority(linked.paths, wrong.binding),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
  });

  it("rejects missing, reordered, duplicated, altered, forked, and unknown event state", async () => {
    const { authority } = await createAuthority("chain");
    const issued = await issue(authority);
    unwrap(
      await admitM9b12eRoleStartup(
        authority,
        admissionRequest(issued, { retiredMaterialStatus: "confirmed" }),
        successfulEffect({ value: 0 }),
      ),
    );
    const state = unwrap(await snapshotM9b12eAuthorityState(authority));
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
      expect(await validateM9b12eAuthorityState(candidate)).toMatchObject({
        ok: false,
      });
  });

  it.each(M9B12B_INFLUENCE_BEARING_ROLES)(
    "asserts the complete durable terminal outcome for %s",
    async (role) => {
      const { authority } = await createAuthority(`role-${role}`);
      const session = identity("a");
      const issued = await issue(authority, {
        allocation: identity("7"),
        role,
        session,
      });
      const request = admissionRequest(issued, {
        retiredMaterialStatus: "suspected",
      });
      const receipt = unwrap(
        await admitM9b12eRoleStartup(
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
      await openExistingM9b12eAuthority(created.paths, created.binding),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
  });

  it("rejects missing anchors, truncated databases, unexpected schema, and exposed parents", async () => {
    const missing = await createAuthority("missing-anchor");
    await rm(missing.paths.anchorPath);
    expect(
      await openExistingM9b12eAuthority(missing.paths, missing.binding),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });

    const truncated = await createAuthority("truncated-database");
    await writeFile(truncated.paths.databasePath, "", { mode: 0o600 });
    expect(
      await openExistingM9b12eAuthority(truncated.paths, truncated.binding),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });

    const unexpectedSchema = await createAuthority("unexpected-schema");
    const database = new DatabaseSync(unexpectedSchema.paths.databasePath);
    try {
      database.exec("CREATE TABLE unexpected (value TEXT) STRICT;");
    } finally {
      database.close();
    }
    expect(
      await openExistingM9b12eAuthority(
        unexpectedSchema.paths,
        unexpectedSchema.binding,
      ),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });

    const exposedParent = await createAuthority("exposed-parent");
    await chmod(dirname(exposedParent.paths.databasePath), 0o755);
    expect(
      await openExistingM9b12eAuthority(
        exposedParent.paths,
        exposedParent.binding,
      ),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
  });
});
