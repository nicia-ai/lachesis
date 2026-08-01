import { digestValue, type Result } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import { prepareM9b12Preregistration } from "../internal/m9b12-preregistration.js";
import {
  assessM9b12aRetiredMaterialBoundary,
  M9B12A_PREREGISTRATION_PROTOCOL,
  M9B12A_RETIRED_CORPUS_PROTOCOL,
  type M9b12aPreregistration,
  type M9b12aRetiredBoundaryAttempt,
  prepareM9b12aPreregistration,
  verifyM9b12aPreregistration,
} from "../internal/m9b12a-preregistration.js";
import * as aiSdkFacade from "../src/index.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function cleanAttempt(): M9b12aRetiredBoundaryAttempt {
  return {
    role: "constructor",
    retiredMaterialStatus: "none",
    namespaceExposures: [],
    accessOperations: [],
    exposedValues: [],
    frozenCountsCommitment: null,
    derivedOutputs: [],
    observerIdentityKnown: true,
    exposureInventoryComplete: true,
    manualCleanupAttempted: false,
    restart: {
      attempted: false,
      freshRoleIdentity: true,
      freshEnvironment: true,
      freshSeed: true,
      freshCorpusConstruction: true,
      reusedPacketIdentity: false,
      reusedDerivedTemplate: false,
    },
    providerEffectAttempted: false,
    independentAssessment: "not-required",
  };
}

function frozenCounts(): NonNullable<
  M9b12aRetiredBoundaryAttempt["frozenCountsCommitment"]
> {
  return {
    approvedByTrustedBoundary: true,
    values: {
      families: 8,
      scales: 3,
      cells: 24,
      probePairs: 24,
      primaryPairs: 168,
      totalPairs: 192,
    },
  };
}

async function fixture() {
  return unwrap(await prepareM9b12aPreregistration());
}

async function resign(
  report: M9b12aPreregistration,
  changes: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  const { preregistrationDigest: ignored, ...body } = report;
  void ignored;
  const changed = { ...body, ...changes };
  return {
    ...changed,
    preregistrationDigest: unwrap(await digestValue(changed)),
  };
}

describe("M9b.12a retired-corpus quarantine correction", () => {
  it("supersedes M9b.12 append-only and preserves its exact identity", async () => {
    const original = unwrap(await prepareM9b12Preregistration());
    const corrected = await fixture();
    expect(original.preregistration.preregistrationDigest).toBe(
      "f12c1212c4fbaa57190059f4d29ef413d09f9d006489b7b95ae038e426a74ff5",
    );
    expect(corrected.preregistration).toMatchObject({
      protocol: M9B12A_PREREGISTRATION_PROTOCOL.id,
      version: "1.0.0",
      supersession: {
        supersedesCommit: "b9f13c7b215624eb651caf3b038b77976247c9a3",
        supersedesTree: "30144b30de282d63371f9afedeb7d5ac43cfa739",
        supersedesDigest:
          "f12c1212c4fbaa57190059f4d29ef413d09f9d006489b7b95ae038e426a74ff5",
        originalStatus:
          "superseded-unregistered-retired-corpus-policy-incomplete",
        originalBytesModified: false,
      },
      decision:
        "corrected-preregistration-package-ready-for-independent-review",
    });
  });

  it("preserves every scientific, population, analysis, financial, and authority field", async () => {
    const original = unwrap(
      await prepareM9b12Preregistration(),
    ).preregistration;
    const corrected = (await fixture()).preregistration;
    expect(corrected.researchQuestion).toEqual(original.researchQuestion);
    expect(corrected.bindings).toEqual(original.bindings);
    expect(corrected.treatment).toEqual(original.treatment);
    expect(corrected.control).toEqual(original.control);
    expect(corrected.matching).toEqual(original.matching);
    expect(corrected.population).toEqual(original.population);
    expect(corrected.primaryEndpoint).toEqual(original.primaryEndpoint);
    expect(corrected.analysis).toEqual(original.analysis);
    expect(corrected.probeAdvancement).toEqual(original.probeAdvancement);
    expect(corrected.financial).toEqual(original.financial);
    expect(corrected.operationalSequence).toEqual(original.operationalSequence);
    expect(corrected.countPricingKillGates).toEqual(
      original.countPricingKillGates,
    );
    expect(corrected.operationalSecurity).toEqual(original.operationalSecurity);
    expect(corrected.authority).toEqual(original.authority);
    expect(corrected.nonclaims).toEqual(original.nonclaims);
  });

  it("freezes all retired-material classes, access paths, fail-closed actions, and roles", async () => {
    const { retiredCorpusPolicy } = (await fixture()).preregistration;
    expect(retiredCorpusPolicy).toMatchObject({
      protocol: M9B12A_RETIRED_CORPUS_PROTOCOL.id,
      namespaceIsolation: {
        excludedBeforeRoleStart: true,
        denylistInsideRoleSufficient: false,
        bootstrapMayDiscloseRetiredPathsOrIdentities: false,
      },
      failClosed: {
        suspectedOrConfirmedAccessTriggers: true,
        missingObserverIdentityForbidsReuse: true,
        incompleteExposureInventoryForbidsReuse: true,
        unknownNoninterferenceForbidsReuse: true,
        manualCleanupPermitted: false,
      },
      contentObserverMayLaterInfluenceStudy: false,
      incidentMustPrecedeProviderEffects: true,
      restartMustUseFreshRoleEnvironmentSeedAndCorpus: true,
      liveAuthorityGranted: false,
    });
    expect(retiredCorpusPolicy.materialClasses).toHaveLength(8);
    expect(retiredCorpusPolicy.retirementCauses).toHaveLength(8);
    expect(retiredCorpusPolicy.forbiddenAccess).toHaveLength(14);
    expect(
      retiredCorpusPolicy.namespaceIsolation.namespaceExposuresProhibited,
    ).toHaveLength(13);
    expect(retiredCorpusPolicy.failClosed.actions).toHaveLength(11);
    expect(
      retiredCorpusPolicy.failClosed.observerExcludedFromLaterRoles,
    ).toEqual([
      "constructor",
      "author",
      "evaluator",
      "adjudicator",
      "analyst",
      "campaign-control",
    ]);
    expect(retiredCorpusPolicy.roles).toHaveLength(8);
    expect(
      retiredCorpusPolicy.roles
        .filter(
          (entry) => entry.permittedAwareness === "opaque-commitments-only",
        )
        .map((entry) => entry.role),
    ).toEqual(["auditor", "control-plane-bootstrap"]);
  });

  it("keeps M9b.12a private and grants no public or live entry point", () => {
    expect("M9B12A_PREREGISTRATION_PROTOCOL" in aiSdkFacade).toBe(false);
    expect("prepareM9b12aPreregistration" in aiSdkFacade).toBe(false);
    expect("assessM9b12aRetiredMaterialBoundary" in aiSdkFacade).toBe(false);
  });

  it("allows a clean isolated role start without granting effects", async () => {
    const receipt = unwrap(
      await assessM9b12aRetiredMaterialBoundary(cleanAttempt()),
    );
    expect(receipt).toMatchObject({
      decision: "allow-role-start",
      reuseForbidden: false,
      providerDispatchPermittedByReceipt: false,
      credentialAccessPermittedByReceipt: false,
      effects: {
        providerDispatches: 0,
        credentialAccesses: 0,
        filesystemAccesses: 0,
        networkAccesses: 0,
      },
    });
  });

  it("allows only the exact trusted public counts commitment", async () => {
    const receipt = unwrap(
      await assessM9b12aRetiredMaterialBoundary({
        ...cleanAttempt(),
        role: "control-plane-bootstrap",
        frozenCountsCommitment: frozenCounts(),
      }),
    );
    expect(receipt).toMatchObject({
      decision: "allow-minimum-opaque-count-commitment",
      reuseForbidden: false,
      reasons: [],
      providerDispatchPermittedByReceipt: false,
    });
  });

  it("fails closed for every hostile retired-material access and reuse case", async () => {
    const base = cleanAttempt();
    const hostile: ReadonlyArray<
      Readonly<{ name: string; attempt: M9b12aRetiredBoundaryAttempt }>
    > = [
      {
        name: "retired namespace mounted read-only",
        attempt: {
          ...base,
          namespaceExposures: ["mounted-read-only"],
        },
      },
      {
        name: "retired namespace visible but permission denied",
        attempt: {
          ...base,
          namespaceExposures: ["visible-permission-denied"],
        },
      },
      {
        name: "directory listing",
        attempt: { ...base, accessOperations: ["list-or-enumerate"] },
      },
      {
        name: "search root includes retired material",
        attempt: {
          ...base,
          namespaceExposures: ["search-root"],
          accessOperations: ["search"],
        },
      },
      {
        name: "hashing or checksum comparison",
        attempt: { ...base, accessOperations: ["hash", "compare"] },
      },
      {
        name: "filename or opaque identifier exposure",
        attempt: { ...base, exposedValues: ["filename", "identifier"] },
      },
      {
        name: "ordering exposure",
        attempt: { ...base, exposedValues: ["ordering"] },
      },
      {
        name: "selected line or snippet exposure",
        attempt: { ...base, exposedValues: ["snippet"] },
      },
      {
        name: "counts plus identity mapping",
        attempt: {
          ...base,
          frozenCountsCommitment: frozenCounts(),
          exposedValues: ["counts-with-identity-mapping"],
        },
      },
      {
        name: "retired corpus in repository history",
        attempt: {
          ...base,
          namespaceExposures: ["repository-history"],
        },
      },
      {
        name: "retired corpus in cache or temporary storage",
        attempt: {
          ...base,
          namespaceExposures: ["cache", "temporary-directory"],
        },
      },
      {
        name: "constructor output derived before exposure discovery",
        attempt: {
          ...base,
          retiredMaterialStatus: "suspected",
          derivedOutputs: ["constructor-output"],
        },
      },
      {
        name: "materializer output derived before exposure discovery",
        attempt: {
          ...base,
          role: "materializer",
          retiredMaterialStatus: "confirmed",
          derivedOutputs: ["materializer-output"],
        },
      },
      {
        name: "missing observer identity",
        attempt: {
          ...base,
          retiredMaterialStatus: "suspected",
          observerIdentityKnown: false,
        },
      },
      {
        name: "incomplete exposure inventory",
        attempt: {
          ...base,
          retiredMaterialStatus: "suspected",
          exposureInventoryComplete: false,
        },
      },
      {
        name: "manual cleanup followed by reuse",
        attempt: {
          ...base,
          retiredMaterialStatus: "confirmed",
          manualCleanupAttempted: true,
        },
      },
      {
        name: "fresh restart reuses a seed packet or template",
        attempt: {
          ...base,
          retiredMaterialStatus: "confirmed",
          restart: {
            attempted: true,
            freshRoleIdentity: true,
            freshEnvironment: true,
            freshSeed: false,
            freshCorpusConstruction: true,
            reusedPacketIdentity: true,
            reusedDerivedTemplate: true,
          },
        },
      },
      {
        name: "provider effect attempted after contamination",
        attempt: {
          ...base,
          retiredMaterialStatus: "confirmed",
          providerEffectAttempted: true,
        },
      },
      {
        name: "independent noninterference remains unknown",
        attempt: {
          ...base,
          retiredMaterialStatus: "suspected",
          independentAssessment: "noninterference-unknown",
        },
      },
      {
        name: "unapproved or changed counts commitment",
        attempt: {
          ...base,
          frozenCountsCommitment: {
            approvedByTrustedBoundary: false,
            values: { ...frozenCounts().values, totalPairs: 191 },
          },
        },
      },
    ];
    expect(hostile).toHaveLength(20);
    for (const scenario of hostile) {
      const receipt = unwrap(
        await assessM9b12aRetiredMaterialBoundary(scenario.attempt),
      );
      expect(receipt).toMatchObject({
        decision: "quarantine-reuse-forbidden",
        reuseForbidden: true,
        roleSessionQuarantined: true,
        allProducedAndDerivedMaterialQuarantined: true,
        observerExcludedFromInfluentialRoles: true,
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
      expect(receipt.requiredActions).toHaveLength(11);
      expect(receipt.reasons.length).toBeGreaterThan(0);
    }
  });

  it("retains fail-closed quarantine even after claimed noninterference", async () => {
    const receipt = unwrap(
      await assessM9b12aRetiredMaterialBoundary({
        ...cleanAttempt(),
        retiredMaterialStatus: "confirmed",
        independentAssessment: "noninterference-confirmed",
      }),
    );
    expect(receipt.decision).toBe("quarantine-reuse-forbidden");
    expect(receipt.reuseForbidden).toBe(true);
  });

  it("rejects self-consistent supersession, policy, scientific, financial, and authority mutations", async () => {
    const current = await fixture();
    const candidates = [
      await resign(current.preregistration, {
        supersession: {
          ...current.preregistration.supersession,
          originalBytesModified: true,
        },
      }),
      await resign(current.preregistration, {
        retiredCorpusPolicy: {
          ...current.preregistration.retiredCorpusPolicy,
          liveAuthorityGranted: true,
        },
      }),
      await resign(current.preregistration, {
        population: { ...current.preregistration.population, totalPairs: 191 },
      }),
      await resign(current.preregistration, {
        analysis: {
          ...current.preregistration.analysis,
          alphaDenominator: 10,
        },
      }),
      await resign(current.preregistration, {
        financial: {
          ...current.preregistration.financial,
          operationalCampaignCeilingUsdMicros: 0,
        },
      }),
      await resign(current.preregistration, {
        authority: {
          ...current.preregistration.authority,
          providerAccessAuthorized: true,
        },
      }),
    ];
    for (const candidate of candidates)
      expect(
        await verifyM9b12aPreregistration(current.token, candidate),
      ).toMatchObject({ ok: false });
  });

  it("rederives the corrected package and quarantine receipts with exact zero effects", async () => {
    const current = await fixture();
    const verified = unwrap(
      await verifyM9b12aPreregistration(current.token, current.preregistration),
    );
    const first = unwrap(
      await assessM9b12aRetiredMaterialBoundary({
        ...cleanAttempt(),
        retiredMaterialStatus: "suspected",
      }),
    );
    const second = unwrap(
      await assessM9b12aRetiredMaterialBoundary({
        ...cleanAttempt(),
        retiredMaterialStatus: "suspected",
      }),
    );
    expect(verified).toEqual(current.preregistration);
    expect(first).toEqual(second);
    expect(verified.correctionAudit).toMatchObject({
      retiredMaterialAccessed: false,
      providerEffects: 0,
      countEffects: 0,
      inferenceEffects: 0,
      networkEffects: 0,
    });
  });
});
