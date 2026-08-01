import { readFileSync } from "node:fs";

import { parseJson, type Result } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import { prepareM9b12aPreregistration } from "../internal/m9b12a-preregistration.js";
import {
  assessM9b12bRetiredMaterialBoundary,
  createM9b12bExternalRegistrationFormat,
  M9B12B_CONTAMINATION_ANCESTORS,
  M9B12B_FORBIDDEN_ACCESS_CLASSES,
  M9B12B_INFLUENCE_BEARING_ROLES,
  M9B12B_ISOLATION_CHANNELS,
  m9b12bExternalRegistrationFormatSchema,
  m9b12bPreregistrationSchema,
  type M9b12bRetiredBoundaryAttempt,
  prepareM9b12bPreregistration,
} from "../internal/m9b12b-preregistration.js";
import * as aiSdkFacade from "../src/index.js";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

const commitment = "0".repeat(64);

function cleanAttempt(): M9b12bRetiredBoundaryAttempt {
  return {
    role: "constructor",
    observerIdentity: { status: "complete", commitment },
    exposureInventory: { status: "complete", commitment },
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

function exactCounts(): NonNullable<
  M9b12bRetiredBoundaryAttempt["frozenCountsCommitment"]
> {
  return {
    approvedByTrustedBoundary: true,
    revealsIdentityOrderContentOrMapping: false,
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

async function expectOneReason(
  attempt: M9b12bRetiredBoundaryAttempt,
  reason: string,
): Promise<void> {
  const receipt = unwrap(await assessM9b12bRetiredMaterialBoundary(attempt));
  expect(receipt).toMatchObject({
    decision: "quarantine-reuse-forbidden",
    reasons: [reason],
    reuseForbidden: true,
    roleStartupPermitted: false,
    roleSessionQuarantined: true,
    allProducedAndDerivedInventoryQuarantined: true,
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
  expect(receipt.observerExcludedFromLaterRoles).toEqual(
    M9B12B_INFLUENCE_BEARING_ROLES,
  );
}

describe("M9b.12b deny-by-default retired-corpus correction", () => {
  it("preserves accepted scientific and financial values while superseding M9b.12a", async () => {
    const predecessor = unwrap(
      await prepareM9b12aPreregistration(),
    ).preregistration;
    const corrected = unwrap(
      await prepareM9b12bPreregistration(),
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
      ],
      predecessorBytesModified: false,
      predecessorExternallyRegistered: false,
    });
  });

  it("uses one canonical external-registration value in nested and standalone forms", async () => {
    const corrected = unwrap(
      await prepareM9b12bPreregistration(),
    ).preregistration;
    const standalone = createM9b12bExternalRegistrationFormat();
    expect(corrected.externalRegistrationFormat).toEqual(standalone);
    expect(standalone.requiredFields).toContain(
      "corrected-preregistration-digest",
    );
    expect(standalone.requiredFields).toContain(
      "superseded-m9b12a-preregistration-digest",
    );
    expect(standalone.requiredFields).toContain(
      "superseded-m9b12-preregistration-digest",
    );
  });

  it("binds the on-disk preregistration and standalone registration to the same canonical values", async () => {
    const corrected = unwrap(
      await prepareM9b12bPreregistration(),
    ).preregistration;
    const diskPreregistration = unwrap(
      parseJson(
        readFileSync(
          "docs/m9b12b-preregistration/preregistration.json",
          "utf8",
        ),
      ),
    );
    const diskRegistration = unwrap(
      parseJson(
        readFileSync(
          "docs/m9b12b-preregistration/external-registration-format.json",
          "utf8",
        ),
      ),
    );
    expect(m9b12bPreregistrationSchema.parse(diskPreregistration)).toEqual(
      corrected,
    );
    expect(
      m9b12bExternalRegistrationFormatSchema.parse(diskRegistration),
    ).toEqual(corrected.externalRegistrationFormat);
  });

  it("keeps canonical roles, isolation channels, and ancestor kinds identical in prose and machine policy", async () => {
    const policy = unwrap(await prepareM9b12bPreregistration()).preregistration
      .retiredCorpusPolicy;
    const markdown = readFileSync(
      "docs/m9b12b-preregistration/corpus-construction-freshness.md",
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

  it("rejects missing, altered, or reordered registration lineage", () => {
    const current = createM9b12bExternalRegistrationFormat();
    const [first, second] = current.supersessionLineage;
    const candidates: ReadonlyArray<unknown> = [
      { ...current, supersessionLineage: [first] },
      {
        ...current,
        supersessionLineage: [
          { ...first, preregistrationDigest: "f".repeat(64) },
          second,
        ],
      },
      { ...current, supersessionLineage: [second, first] },
    ];
    for (const candidate of candidates)
      expect(
        m9b12bExternalRegistrationFormatSchema.safeParse(candidate).success,
      ).toBe(false);
  });

  it("allows only a complete affirmative clean baseline", async () => {
    const receipt = unwrap(
      await assessM9b12bRetiredMaterialBoundary(cleanAttempt()),
    );
    expect(receipt).toMatchObject({
      decision: "allow-role-start",
      reasons: [],
      reuseForbidden: false,
      roleStartupPermitted: true,
      providerDispatchPermittedByReceipt: false,
      credentialAccessPermittedByReceipt: false,
    });
  });

  it.each(["missing", "incomplete", "ambiguous"] as const)(
    "quarantines observer identity status %s as the only failing input",
    async (status) => {
      expect.hasAssertions();
      await expectOneReason(
        { ...cleanAttempt(), observerIdentity: { status, commitment } },
        `observer-identity-${status}`,
      );
    },
  );

  it.each(["missing", "incomplete", "ambiguous"] as const)(
    "quarantines exposure inventory status %s as the only failing input",
    async (status) => {
      expect.hasAssertions();
      await expectOneReason(
        { ...cleanAttempt(), exposureInventory: { status, commitment } },
        `exposure-inventory-${status}`,
      );
    },
  );

  it.each(["observerIdentity", "exposureInventory"] as const)(
    "quarantines a missing %s commitment",
    async (field) => {
      expect.hasAssertions();
      const base = cleanAttempt();
      await expectOneReason(
        { ...base, [field]: { status: "complete", commitment: null } },
        `${field === "observerIdentity" ? "observer-identity" : "exposure-inventory"}-commitment-missing`,
      );
    },
  );

  it.each(["unknown", "not-assessed"] as const)(
    "quarantines noninterference status %s independently",
    async (noninterference) => {
      expect.hasAssertions();
      await expectOneReason(
        { ...cleanAttempt(), noninterference },
        `noninterference-${noninterference}`,
      );
    },
  );

  it.each(["suspected", "confirmed"] as const)(
    "quarantines retired material status %s independently",
    async (retiredMaterialStatus) => {
      expect.hasAssertions();
      await expectOneReason(
        { ...cleanAttempt(), retiredMaterialStatus },
        `retired-material-${retiredMaterialStatus}`,
      );
    },
  );

  it.each(M9B12B_FORBIDDEN_ACCESS_CLASSES)(
    "quarantines forbidden access %s as the only failing input",
    async (access) => {
      expect.hasAssertions();
      await expectOneReason(
        { ...cleanAttempt(), forbiddenAccessAttempts: [access] },
        `forbidden-access:${access}`,
      );
    },
  );

  it.each(M9B12B_ISOLATION_CHANNELS)(
    "quarantines an omitted %s isolation proof",
    async (channel) => {
      expect.hasAssertions();
      await expectOneReason(
        {
          ...cleanAttempt(),
          isolationProofs: cleanAttempt().isolationProofs.filter(
            (proof) => proof.channel !== channel,
          ),
        },
        `isolation-proof-missing:${channel}`,
      );
    },
  );

  it.each(["not-isolated", "unknown"] as const)(
    "quarantines an isolation proof decided %s",
    async (decision) => {
      expect.hasAssertions();
      const [first, ...rest] = cleanAttempt().isolationProofs;
      if (first === undefined) throw new Error("Isolation fixture is empty.");
      await expectOneReason(
        {
          ...cleanAttempt(),
          isolationProofs: [{ ...first, decision }, ...rest],
        },
        `isolation-${decision}:${first.channel}`,
      );
    },
  );

  it("quarantines duplicate isolation proof coverage", async () => {
    expect.hasAssertions();
    const base = cleanAttempt();
    const first = base.isolationProofs[0];
    if (first === undefined) throw new Error("Isolation fixture is empty.");
    await expectOneReason(
      { ...base, isolationProofs: [...base.isolationProofs, first] },
      `isolation-proof-duplicate:${first.channel}`,
    );
  });

  it.each(M9B12B_CONTAMINATION_ANCESTORS)(
    "quarantines contaminated ancestor %s as the only failing input",
    async (ancestorKind) => {
      expect.hasAssertions();
      await expectOneReason(
        {
          ...cleanAttempt(),
          lineageProofs: cleanAttempt().lineageProofs.map((proof) =>
            proof.ancestorKind === ancestorKind
              ? { ...proof, decision: "contaminated" as const }
              : proof,
          ),
        },
        `lineage-contaminated:${ancestorKind}`,
      );
    },
  );

  it("quarantines missing, unknown, and duplicate lineage proof coverage", async () => {
    expect.hasAssertions();
    const base = cleanAttempt();
    const first = base.lineageProofs[0];
    if (first === undefined) throw new Error("Lineage fixture is empty.");
    const candidates: ReadonlyArray<
      readonly [M9b12bRetiredBoundaryAttempt, string]
    > = [
      [
        {
          ...base,
          lineageProofs: base.lineageProofs.filter(
            (proof) => proof.ancestorKind !== first.ancestorKind,
          ),
        },
        `lineage-proof-missing:${first.ancestorKind}`,
      ],
      [
        {
          ...base,
          lineageProofs: [
            { ...first, decision: "unknown" },
            ...base.lineageProofs.slice(1),
          ],
        },
        `lineage-unknown:${first.ancestorKind}`,
      ],
      [
        { ...base, lineageProofs: [...base.lineageProofs, first] },
        `lineage-proof-duplicate:${first.ancestorKind}`,
      ],
    ];
    for (const [attempt, reason] of candidates)
      await expectOneReason(attempt, reason);
  });

  it.each(M9B12B_INFLUENCE_BEARING_ROLES)(
    "excludes every influence-bearing role after exposure: %s",
    async (role) => {
      const receipt = unwrap(
        await assessM9b12bRetiredMaterialBoundary({
          ...cleanAttempt(),
          role,
          retiredMaterialStatus: "suspected",
        }),
      );
      expect(receipt.observerExcludedFromLaterRoles).toContain(role);
      expect(receipt.observerExcludedFromLaterRoles).toEqual(
        M9B12B_INFLUENCE_BEARING_ROLES,
      );
    },
  );

  it("allows only the exact approved opaque public-count commitment", async () => {
    const allowed = unwrap(
      await assessM9b12bRetiredMaterialBoundary({
        ...cleanAttempt(),
        role: "control-plane-bootstrap",
        frozenCountsCommitment: exactCounts(),
      }),
    );
    expect(allowed).toMatchObject({
      decision: "allow-minimum-opaque-count-commitment",
      reasons: [],
      roleStartupPermitted: true,
    });
    await expectOneReason(
      {
        ...cleanAttempt(),
        frozenCountsCommitment: {
          ...exactCounts(),
          revealsIdentityOrderContentOrMapping: true,
        },
      },
      "count-commitment-not-exact-approved-public-counts",
    );
  });

  it("quarantines each invalid count commitment dimension independently", async () => {
    expect.hasAssertions();
    const candidates: ReadonlyArray<M9b12bRetiredBoundaryAttempt> = [
      {
        ...cleanAttempt(),
        frozenCountsCommitment: {
          ...exactCounts(),
          approvedByTrustedBoundary: false,
        },
      },
      {
        ...cleanAttempt(),
        frozenCountsCommitment: {
          ...exactCounts(),
          values: { ...exactCounts().values, totalPairs: 191 },
        },
      },
    ];
    for (const candidate of candidates)
      await expectOneReason(
        candidate,
        "count-commitment-not-exact-approved-public-counts",
      );
  });

  it("quarantines cleanup, stale restart, and provider effects independently", async () => {
    expect.hasAssertions();
    const candidates: ReadonlyArray<
      readonly [M9b12bRetiredBoundaryAttempt, string]
    > = [
      [
        { ...cleanAttempt(), manualCleanupAttempted: true },
        "manual-cleanup-attempted",
      ],
      [
        {
          ...cleanAttempt(),
          restart: {
            ...cleanAttempt().restart,
            attempted: true,
            freshSeed: false,
          },
        },
        "restart-not-fully-fresh",
      ],
      [
        { ...cleanAttempt(), providerEffectAttempted: true },
        "provider-effect-attempted-before-allow",
      ],
    ];
    for (const [attempt, reason] of candidates)
      await expectOneReason(attempt, reason);
  });

  it("quarantines unknown access, isolation, and ancestry classes", async () => {
    expect.hasAssertions();
    const candidates: ReadonlyArray<
      readonly [M9b12bRetiredBoundaryAttempt, string]
    > = [
      [
        { ...cleanAttempt(), unclassifiedAccessChannels: ["future-channel"] },
        "unclassified-access-channel",
      ],
      [
        {
          ...cleanAttempt(),
          unsupportedIsolationChannels: ["future-storage"],
        },
        "unsupported-isolation-channel",
      ],
      [
        { ...cleanAttempt(), unsupportedAncestorKinds: ["future-input"] },
        "unsupported-contamination-ancestor",
      ],
    ];
    for (const [attempt, reason] of candidates)
      await expectOneReason(attempt, reason);
  });

  it("turns malformed or structurally incomplete attempts into quarantine receipts", async () => {
    const malformed = unwrap(
      await assessM9b12bRetiredMaterialBoundary({ role: "constructor" }),
    );
    expect(malformed).toMatchObject({
      decision: "quarantine-reuse-forbidden",
      reasons: ["attempt-schema-invalid"],
      reuseForbidden: true,
      roleStartupPermitted: false,
    });
  });

  it("orders combined rejection reasons deterministically", async () => {
    const receipt = unwrap(
      await assessM9b12bRetiredMaterialBoundary({
        ...cleanAttempt(),
        observerIdentity: { status: "missing", commitment },
        retiredMaterialStatus: "suspected",
        forbiddenAccessAttempts: ["read"],
      }),
    );
    expect(receipt.reasons).toEqual([
      "forbidden-access:read",
      "observer-identity-missing",
      "retired-material-suspected",
    ]);
  });

  it("keeps M9b.12b private with no facade entry point", () => {
    expect("prepareM9b12bPreregistration" in aiSdkFacade).toBe(false);
    expect("assessM9b12bRetiredMaterialBoundary" in aiSdkFacade).toBe(false);
  });
});
