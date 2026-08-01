import { readFileSync } from "node:fs";

import { parseJson, type Result } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import {
  M9B12B_CONTAMINATION_ANCESTORS,
  M9B12B_INFLUENCE_BEARING_ROLES,
  M9B12B_ISOLATION_CHANNELS,
  type M9b12bInfluenceBearingRole,
  type M9b12bRetiredBoundaryAttempt,
  prepareM9b12bPreregistration,
} from "../internal/m9b12b-preregistration.js";
import {
  assessM9b12cRetiredMaterialBoundary,
  createM9b12cExternalRegistrationFormat,
  createM9b12cQuarantineHistoryFormat,
  M9B12C_QUARANTINE_HISTORY_PROTOCOL,
  type M9b12cAssessmentRequest,
  m9b12cExternalRegistrationFormatSchema,
  m9b12cPreregistrationSchema,
  m9b12cQuarantineHistoryFormatSchema,
  type M9b12cQuarantineRepository,
  type M9b12cRetiredBoundaryReceipt,
  prepareM9b12cPreregistration,
  prepareM9b12cQuarantineRepository,
  reloadM9b12cQuarantineRepository,
  revalidateM9b12cStartupAuthorization,
  snapshotM9b12cQuarantineHistory,
  validateM9b12cQuarantineHistoryChain,
} from "../internal/m9b12c-preregistration.js";
import * as aiSdkFacade from "../src/index.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function identity(character: string): string {
  return character.repeat(64);
}

const observerA = identity("a");
const observerB = identity("b");
const observerC = identity("c");
const sessionA = identity("d");
const sessionB = identity("e");
const inventoryA = identity("f");
const inventoryB = identity("1");

function cleanBoundary(
  observerCommitment: string,
  role: M9b12bInfluenceBearingRole = "constructor",
): M9b12bRetiredBoundaryAttempt {
  return {
    role,
    observerIdentity: { status: "complete", commitment: observerCommitment },
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
    retiredMaterialStatus: "none",
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

function requestFor(
  observerCommitment: string,
  options: Readonly<{
    role?: M9b12bInfluenceBearingRole;
    sessionIdentity?: string;
    derivedInventoryIdentity?: string;
    retiredMaterialStatus?: "none" | "suspected" | "confirmed";
  }> = {},
): M9b12cAssessmentRequest {
  const role = options.role ?? "constructor";
  return {
    observerCommitment,
    requestedRole: role,
    sessionIdentity: options.sessionIdentity ?? sessionA,
    derivedInventoryIdentity: options.derivedInventoryIdentity ?? inventoryA,
    currentAssessment: {
      ...cleanBoundary(observerCommitment, role),
      retiredMaterialStatus: options.retiredMaterialStatus ?? "none",
    },
  };
}

async function expectCompleteQuarantine(
  repository: M9b12cQuarantineRepository,
  receipt: M9b12cRetiredBoundaryReceipt,
  request: M9b12cAssessmentRequest,
  reason: string,
): Promise<void> {
  expect(receipt).toMatchObject({
    decision: "quarantine-reuse-forbidden",
    reasons: [reason],
    observerCommitment: request.observerCommitment,
    requestedRole: request.requestedRole,
    sessionIdentity: request.sessionIdentity,
    derivedInventoryIdentity: request.derivedInventoryIdentity,
    observerStatusAtHead: "quarantined",
    observerReuseForbidden: true,
    roleSessionStartupPermitted: false,
    roleSessionQuarantined: true,
    allProducedAndDerivedInventoryQuarantined: true,
    derivedInventoryReuseForbidden: true,
    observerExcludedFromLaterRoles: M9B12B_INFLUENCE_BEARING_ROLES,
    affectedRoleIdentities: M9B12B_INFLUENCE_BEARING_ROLES,
    affectedSessionIdentities: [request.sessionIdentity],
    affectedDerivedInventoryIdentities: [request.derivedInventoryIdentity],
    freshRestartRequired: true,
    providerDispatchPermittedByReceipt: false,
    credentialAccessPermittedByReceipt: false,
    effects: {
      providerDispatches: 0,
      credentialAccesses: 0,
      filesystemAccesses: 0,
      networkAccesses: 0,
    },
  });
  expect(receipt.historyHead.protocol).toBe(M9B12C_QUARANTINE_HISTORY_PROTOCOL);
  expect(receipt.historyHead.revision).toBeGreaterThan(0);
  expect(receipt.historyHead.digest).toMatch(/^[a-f0-9]{64}$/u);
  const history = unwrap(await snapshotM9b12cQuarantineHistory(repository));
  expect(receipt.historyHead).toEqual({
    protocol: history.protocol,
    revision: history.revision,
    digest: history.headDigest,
  });
  const lastRecord = history.records.at(-1);
  if (lastRecord === undefined) throw new Error("History record is missing.");
  expect(lastRecord).toMatchObject({
    observerCommitment: request.observerCommitment,
    requestedRole: request.requestedRole,
    affectedRoleIdentities: M9B12B_INFLUENCE_BEARING_ROLES,
    affectedSessionIdentities: [request.sessionIdentity],
    affectedDerivedInventoryIdentities: [request.derivedInventoryIdentity],
    quarantineReasons: [reason],
    terminalDecision: "quarantine-reuse-forbidden",
    observerReuseForbidden: true,
    roleSessionStartupPermitted: false,
    providerEffectsPermitted: false,
    derivedInventoryReuseForbidden: true,
  });
  expect(lastRecord.recordDigest).toBe(history.headDigest);
}

async function quarantineObserver(
  repository: M9b12cQuarantineRepository,
  observerCommitment: string = observerA,
  role: M9b12bInfluenceBearingRole = "constructor",
): Promise<M9b12cRetiredBoundaryReceipt> {
  const request = requestFor(observerCommitment, {
    role,
    retiredMaterialStatus: "confirmed",
  });
  const receipt = unwrap(
    await assessM9b12cRetiredMaterialBoundary(repository, request),
  );
  await expectCompleteQuarantine(
    repository,
    receipt,
    request,
    "retired-material-confirmed",
  );
  return receipt;
}

function serialized(value: unknown): unknown {
  return unwrap(parseJson(JSON.stringify(value)));
}

function sectionValues(
  markdown: string,
  heading: string,
): ReadonlyArray<string> {
  const section = markdown.split(`## ${heading}\n`)[1]?.split("\n## ")[0];
  if (section === undefined) throw new Error(`Missing section ${heading}.`);
  return [...section.matchAll(/^- `([^`]+)`$/gmu)].map((match) => {
    const value = match[1];
    if (value === undefined) throw new Error(`Malformed value in ${heading}.`);
    return value;
  });
}

describe("M9b.12c durable observer quarantine", () => {
  it("preserves accepted scientific and financial values while superseding M9b.12b", async () => {
    const predecessor = unwrap(
      await prepareM9b12bPreregistration(),
    ).preregistration;
    const corrected = unwrap(
      await prepareM9b12cPreregistration(),
    ).preregistration;
    for (const key of [
      "researchQuestion",
      "bindings",
      "treatment",
      "control",
      "matching",
      "population",
      "primaryEndpoint",
      "analysis",
      "probeAdvancement",
      "financial",
      "operationalSequence",
      "countPricingKillGates",
      "operationalSecurity",
      "disclosureAndRoles",
      "nonclaims",
      "audit",
      "authority",
      "inheritedDecisions",
    ] as const)
      expect(corrected[key]).toEqual(predecessor[key]);
    expect(corrected.supersession).toMatchObject({
      ordering: [
        "lachesis-m9b12-offline-preregistration-package@1.0.0",
        "lachesis-m9b12a-offline-preregistration-package@1.0.0",
        "lachesis-m9b12b-offline-preregistration-package@1.0.0",
        "lachesis-m9b12c-offline-preregistration-package@1.0.0",
      ],
      predecessorBytesModified: false,
      predecessorExternallyRegistered: false,
    });
  });

  it("uses one M9b.12c external-registration value and one history format", async () => {
    const corrected = unwrap(
      await prepareM9b12cPreregistration(),
    ).preregistration;
    expect(corrected.externalRegistrationFormat).toEqual(
      createM9b12cExternalRegistrationFormat(),
    );
    expect(corrected.quarantineHistory.format).toEqual(
      createM9b12cQuarantineHistoryFormat(),
    );
    expect(
      corrected.externalRegistrationFormat.supersessionLineage,
    ).toHaveLength(3);
  });

  it("rejects missing, altered, or reordered registration lineage", () => {
    const current = createM9b12cExternalRegistrationFormat();
    const [first, second, third] = current.supersessionLineage;
    const candidates: ReadonlyArray<unknown> = [
      { ...current, supersessionLineage: [first, second] },
      {
        ...current,
        supersessionLineage: [
          first,
          second,
          { ...third, preregistrationDigest: identity("9") },
        ],
      },
      { ...current, supersessionLineage: [third, second, first] },
    ];
    for (const candidate of candidates)
      expect(
        m9b12cExternalRegistrationFormatSchema.safeParse(candidate).success,
      ).toBe(false);
  });

  it("keeps canonical machine and prose role, isolation, ancestry, and access inventories exact", async () => {
    const policy = unwrap(await prepareM9b12cPreregistration()).preregistration
      .retiredCorpusPolicy;
    const markdown = readFileSync(
      "docs/m9b12c-preregistration/corpus-construction-freshness.md",
      "utf8",
    );
    expect(sectionValues(markdown, "Influence-bearing roles")).toEqual(
      policy.observerExcludedFromLaterRoles,
    );
    expect(sectionValues(markdown, "Required isolation channels")).toEqual(
      policy.isolationChannels,
    );
    expect(sectionValues(markdown, "Contamination ancestor kinds")).toEqual(
      policy.contaminationAncestorKinds,
    );
    expect(sectionValues(markdown, "Forbidden access classes")).toEqual(
      policy.forbiddenAccessClasses,
    );
  });

  it("allows a genuinely clean observer only at the exact authoritative head", async () => {
    const { repository } = prepareM9b12cQuarantineRepository();
    const request = requestFor(observerA);
    const receipt = unwrap(
      await assessM9b12cRetiredMaterialBoundary(repository, request),
    );
    expect(receipt).toMatchObject({
      decision: "allow-role-start",
      reasons: [],
      historyHead: {
        protocol: M9B12C_QUARANTINE_HISTORY_PROTOCOL,
        revision: 0,
        digest: null,
      },
      observerStatusAtHead: "clean",
      observerReuseForbidden: false,
      roleSessionStartupPermitted: true,
      roleSessionQuarantined: false,
      allProducedAndDerivedInventoryQuarantined: false,
      derivedInventoryReuseForbidden: false,
      providerDispatchPermittedByReceipt: false,
      credentialAccessPermittedByReceipt: false,
    });
    const revalidated = unwrap(
      await revalidateM9b12cStartupAuthorization(repository, receipt),
    );
    expect(revalidated).toEqual({
      protocol: "lachesis-m9b12c-startup-revalidation/1",
      decision: "authorization-current",
      reason: null,
      authoritativeHistoryHead: receipt.historyHead,
      observerReuseForbidden: false,
      roleSessionStartupPermitted: true,
      providerEffectsPermitted: false,
      derivedInventoryReuseForbidden: false,
    });
  });

  it("durably quarantines confirmed exposure before returning the receipt", async () => {
    const { repository } = prepareM9b12cQuarantineRepository();
    await quarantineObserver(repository);
    const history = unwrap(await snapshotM9b12cQuarantineHistory(repository));
    expect(history).toMatchObject({ revision: 1 });
    expect(history.headDigest).toBe(history.records[0]?.recordDigest);
  });

  it("does not weaken current incomplete-proof quarantine", async () => {
    expect.hasAssertions();
    const { repository } = prepareM9b12cQuarantineRepository();
    const original = requestFor(observerA);
    const currentAssessment = cleanBoundary(observerA);
    const request: M9b12cAssessmentRequest = {
      ...original,
      currentAssessment: {
        ...currentAssessment,
        observerIdentity: {
          ...currentAssessment.observerIdentity,
          status: "missing",
        },
      },
    };
    const receipt = unwrap(
      await assessM9b12cRetiredMaterialBoundary(repository, request),
    );
    await expectCompleteQuarantine(
      repository,
      receipt,
      request,
      "observer-identity-missing",
    );
  });

  it("rejects a clean second assessment for the same observer with the exact prior reason", async () => {
    expect.hasAssertions();
    const { repository } = prepareM9b12cQuarantineRepository();
    await quarantineObserver(repository);
    const retry = requestFor(observerA);
    const receipt = unwrap(
      await assessM9b12cRetiredMaterialBoundary(repository, retry),
    );
    await expectCompleteQuarantine(
      repository,
      receipt,
      retry,
      "observer-previously-quarantined",
    );
  });

  it("preserves permanent quarantine after serialization, reload, and controller replacement", async () => {
    expect.hasAssertions();
    const { authority, repository } = prepareM9b12cQuarantineRepository();
    await quarantineObserver(repository);
    const history = unwrap(await snapshotM9b12cQuarantineHistory(repository));
    const reloaded = unwrap(
      await reloadM9b12cQuarantineRepository(authority, serialized(history)),
    );
    const retry = requestFor(observerA, {
      role: "runtime-controller",
      sessionIdentity: sessionB,
      derivedInventoryIdentity: inventoryB,
    });
    const receipt = unwrap(
      await assessM9b12cRetiredMaterialBoundary(reloaded, retry),
    );
    await expectCompleteQuarantine(
      reloaded,
      receipt,
      retry,
      "observer-previously-quarantined",
    );
  });

  it.each([
    {
      label: "different role",
      options: { role: "analyst" as const },
    },
    {
      label: "different session",
      options: { sessionIdentity: sessionB },
    },
    {
      label: "different derived inventory",
      options: { derivedInventoryIdentity: inventoryB },
    },
  ])("rejects a retry with a $label", async ({ options }) => {
    expect.hasAssertions();
    const { repository } = prepareM9b12cQuarantineRepository();
    await quarantineObserver(repository);
    const retry = requestFor(observerA, options);
    const receipt = unwrap(
      await assessM9b12cRetiredMaterialBoundary(repository, retry),
    );
    await expectCompleteQuarantine(
      repository,
      receipt,
      retry,
      "observer-previously-quarantined",
    );
  });

  it("fails closed when the trusted repository is omitted", async () => {
    const result = await assessM9b12cRetiredMaterialBoundary(
      null,
      requestFor(observerA),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "history",
        message: "Trusted quarantine repository is required.",
      },
    });
  });

  it("rejects caller-supplied history fields and caller-selected clean history", async () => {
    const trusted = prepareM9b12cQuarantineRepository();
    await quarantineObserver(trusted.repository);
    const clean = prepareM9b12cQuarantineRepository();
    const cleanHistory = unwrap(
      await snapshotM9b12cQuarantineHistory(clean.repository),
    );
    const selected = await reloadM9b12cQuarantineRepository(
      trusted.authority,
      cleanHistory,
    );
    expect(selected).toMatchObject({ ok: false, error: { kind: "history" } });
    const request = requestFor(observerA);
    const injected = await assessM9b12cRetiredMaterialBoundary(
      trusted.repository,
      { ...request, history: cleanHistory },
    );
    expect(injected).toMatchObject({
      ok: false,
      error: { kind: "authorization" },
    });
  });

  it("rejects a valid but stale truncated snapshot against the trusted head", async () => {
    const { authority, repository } = prepareM9b12cQuarantineRepository();
    await quarantineObserver(repository);
    const revisionOne = unwrap(
      await snapshotM9b12cQuarantineHistory(repository),
    );
    unwrap(
      await assessM9b12cRetiredMaterialBoundary(
        repository,
        requestFor(observerA),
      ),
    );
    expect(
      await validateM9b12cQuarantineHistoryChain(revisionOne),
    ).toMatchObject({ ok: true });
    expect(
      await reloadM9b12cQuarantineRepository(authority, revisionOne),
    ).toMatchObject({ ok: false, error: { kind: "history" } });
  });

  it("rejects independently valid self-consistent history from another authority", async () => {
    const trusted = prepareM9b12cQuarantineRepository();
    await quarantineObserver(trusted.repository, observerA);
    const other = prepareM9b12cQuarantineRepository();
    await quarantineObserver(other.repository, observerB);
    const otherHistory = unwrap(
      await snapshotM9b12cQuarantineHistory(other.repository),
    );
    expect(
      await validateM9b12cQuarantineHistoryChain(otherHistory),
    ).toMatchObject({ ok: true });
    expect(
      await reloadM9b12cQuarantineRepository(trusted.authority, otherHistory),
    ).toMatchObject({ ok: false, error: { kind: "history" } });
  });

  it("rejects removed, reordered, duplicated, altered, and forked records", async () => {
    expect.hasAssertions();
    const { authority, repository } = prepareM9b12cQuarantineRepository();
    await quarantineObserver(repository);
    unwrap(
      await assessM9b12cRetiredMaterialBoundary(
        repository,
        requestFor(observerA),
      ),
    );
    const history = unwrap(await snapshotM9b12cQuarantineHistory(repository));
    const first = history.records[0];
    const second = history.records[1];
    if (first === undefined || second === undefined)
      throw new Error("Two history records are required.");
    const candidates: ReadonlyArray<unknown> = [
      {
        ...history,
        records: [second],
        revision: 1,
        headDigest: second.recordDigest,
      },
      { ...history, records: [second, first] },
      { ...history, records: [first, first], headDigest: first.recordDigest },
      {
        ...history,
        records: [{ ...first, observerCommitment: observerC }, second],
      },
      {
        ...history,
        records: [
          { ...first, quarantineReasons: ["retired-material-suspected"] },
          second,
        ],
      },
      {
        ...history,
        records: [{ ...first, providerEffectsPermitted: true }, second],
      },
      {
        ...history,
        records: [first, { ...second, predecessorHeadDigest: null }],
      },
    ];
    for (const candidate of candidates) {
      expect(
        await reloadM9b12cQuarantineRepository(authority, candidate),
      ).toMatchObject({ ok: false, error: { kind: "history" } });
    }
  });

  it("invalidates a clean receipt after an unrelated intervening quarantine changes the head", async () => {
    const { repository } = prepareM9b12cQuarantineRepository();
    const cleanReceipt = unwrap(
      await assessM9b12cRetiredMaterialBoundary(
        repository,
        requestFor(observerA),
      ),
    );
    await quarantineObserver(repository, observerB);
    expect(
      unwrap(
        await revalidateM9b12cStartupAuthorization(repository, cleanReceipt),
      ),
    ).toMatchObject({
      decision: "authorization-rejected",
      reason: "history-head-changed",
      observerReuseForbidden: true,
      roleSessionStartupPermitted: false,
      providerEffectsPermitted: false,
      derivedInventoryReuseForbidden: true,
    });
  });

  it("invalidates a clean receipt after the same observer is quarantined", async () => {
    const { repository } = prepareM9b12cQuarantineRepository();
    const cleanReceipt = unwrap(
      await assessM9b12cRetiredMaterialBoundary(
        repository,
        requestFor(observerA),
      ),
    );
    await quarantineObserver(repository, observerA);
    expect(
      unwrap(
        await revalidateM9b12cStartupAuthorization(repository, cleanReceipt),
      ),
    ).toMatchObject({
      decision: "authorization-rejected",
      reason: "observer-previously-quarantined",
      roleSessionStartupPermitted: false,
      providerEffectsPermitted: false,
    });
  });

  it("rejects tampered and quarantine receipts at startup revalidation", async () => {
    const { repository } = prepareM9b12cQuarantineRepository();
    const cleanReceipt = unwrap(
      await assessM9b12cRetiredMaterialBoundary(
        repository,
        requestFor(observerA),
      ),
    );
    expect(
      unwrap(
        await revalidateM9b12cStartupAuthorization(repository, {
          ...cleanReceipt,
          sessionIdentity: sessionB,
        }),
      ),
    ).toMatchObject({
      decision: "authorization-rejected",
      reason: "receipt-invalid",
    });
    const quarantined = await quarantineObserver(repository, observerB);
    expect(
      unwrap(
        await revalidateM9b12cStartupAuthorization(repository, quarantined),
      ),
    ).toMatchObject({
      decision: "authorization-rejected",
      reason: "receipt-not-startup-authorization",
    });
  });

  it("uses compare-and-swap semantics so no concurrent clean authorization survives quarantine", async () => {
    const { repository } = prepareM9b12cQuarantineRepository();
    const [cleanResult, quarantineResult] = await Promise.all([
      assessM9b12cRetiredMaterialBoundary(repository, requestFor(observerA)),
      assessM9b12cRetiredMaterialBoundary(
        repository,
        requestFor(observerA, { retiredMaterialStatus: "confirmed" }),
      ),
    ]);
    const cleanReceipt = unwrap(cleanResult);
    const quarantineReceipt = unwrap(quarantineResult);
    expect(quarantineReceipt.decision).toBe("quarantine-reuse-forbidden");
    const history = unwrap(await snapshotM9b12cQuarantineHistory(repository));
    expect(history.revision).toBeGreaterThan(0);
    const finalAuthorization =
      cleanReceipt.decision === "quarantine-reuse-forbidden"
        ? {
            decision: "authorization-rejected",
            reason: "observer-previously-quarantined",
            roleSessionStartupPermitted:
              cleanReceipt.roleSessionStartupPermitted,
            providerEffectsPermitted:
              cleanReceipt.providerDispatchPermittedByReceipt,
          }
        : unwrap(
            await revalidateM9b12cStartupAuthorization(
              repository,
              cleanReceipt,
            ),
          );
    expect(finalAuthorization).toMatchObject({
      decision: "authorization-rejected",
      reason: "observer-previously-quarantined",
      roleSessionStartupPermitted: false,
      providerEffectsPermitted: false,
    });
  });

  it.each(M9B12B_INFLUENCE_BEARING_ROLES)(
    "asserts the complete terminal outcome for influence-bearing role %s",
    async (role) => {
      expect.hasAssertions();
      const { repository } = prepareM9b12cQuarantineRepository();
      const request = requestFor(observerA, {
        role,
        retiredMaterialStatus: "suspected",
      });
      const receipt = unwrap(
        await assessM9b12cRetiredMaterialBoundary(repository, request),
      );
      await expectCompleteQuarantine(
        repository,
        receipt,
        request,
        "retired-material-suspected",
      );
    },
  );

  it("binds on-disk package and standalone formats to generated values", async () => {
    const generated = unwrap(
      await prepareM9b12cPreregistration(),
    ).preregistration;
    const diskPreregistration = unwrap(
      parseJson(
        readFileSync(
          "docs/m9b12c-preregistration/preregistration.json",
          "utf8",
        ),
      ),
    );
    const diskRegistration = unwrap(
      parseJson(
        readFileSync(
          "docs/m9b12c-preregistration/external-registration-format.json",
          "utf8",
        ),
      ),
    );
    const diskHistoryFormat = unwrap(
      parseJson(
        readFileSync(
          "docs/m9b12c-preregistration/quarantine-history-format.json",
          "utf8",
        ),
      ),
    );
    expect(m9b12cPreregistrationSchema.parse(diskPreregistration)).toEqual(
      generated,
    );
    expect(
      m9b12cExternalRegistrationFormatSchema.parse(diskRegistration),
    ).toEqual(generated.externalRegistrationFormat);
    expect(
      m9b12cQuarantineHistoryFormatSchema.parse(diskHistoryFormat),
    ).toEqual(generated.quarantineHistory.format);
  });

  it("keeps M9b.12c private with no facade entry point", () => {
    expect("prepareM9b12cPreregistration" in aiSdkFacade).toBe(false);
    expect("assessM9b12cRetiredMaterialBoundary" in aiSdkFacade).toBe(false);
    expect("prepareM9b12cQuarantineRepository" in aiSdkFacade).toBe(false);
  });
});
