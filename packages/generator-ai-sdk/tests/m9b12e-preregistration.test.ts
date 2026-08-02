import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalizeJson, parseJson } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import { prepareM9b12cPreregistration } from "../internal/m9b12c-preregistration.js";
import {
  createM9b12eExternalRegistrationFormat,
  M9B12E_PREREGISTRATION_DIGEST,
  M9B12E_PREREGISTRATION_PROTOCOL,
  prepareM9b12ePreregistration,
  verifyM9b12ePreregistration,
  verifyM9b12eScientificFinancialInvariance,
} from "../internal/m9b12e-preregistration.js";

function unwrap<T>(
  result:
    Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }>,
): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

async function readJson(path: string): Promise<unknown> {
  const parsed = parseJson(await readFile(path, "utf8"));
  return unwrap(parsed);
}

describe("M9b.12e preregistration", () => {
  it("rederives one immutable package", async () => {
    const prepared = unwrap(await prepareM9b12ePreregistration());
    expect(prepared.preregistration.preregistrationDigest).toBe(
      M9B12E_PREREGISTRATION_DIGEST,
    );
    expect(
      await verifyM9b12ePreregistration(
        prepared.token,
        prepared.preregistration,
      ),
    ).toEqual({ ok: true, value: prepared.preregistration });
  });

  it("binds the generated package and standalone registration byte model", async () => {
    const prepared = unwrap(await prepareM9b12ePreregistration());
    const packageRoot = join(process.cwd(), "docs/m9b12e-preregistration");
    const onDisk = await readJson(join(packageRoot, "preregistration.json"));
    expect(
      unwrap(await verifyM9b12ePreregistration(prepared.token, onDisk)),
    ).toEqual(prepared.preregistration);
    const standalone = await readJson(
      join(packageRoot, "external-registration-format.json"),
    );
    expect(canonicalizeJson(standalone)).toEqual(
      canonicalizeJson(prepared.preregistration.externalRegistrationFormat),
    );
    expect(standalone).toEqual(createM9b12eExternalRegistrationFormat());
  });

  it("makes only M9b.12e registrable and preserves the five predecessor dispositions", async () => {
    const prepared = unwrap(await prepareM9b12ePreregistration());
    expect(
      prepared.preregistration.externalRegistrationFormat.registrablePackage,
    ).toBe(M9B12E_PREREGISTRATION_PROTOCOL.qualified);
    expect(
      prepared.preregistration.supersession.predecessors.map(
        ({ status }) => status,
      ),
    ).toEqual([
      "superseded-unregistered-retired-corpus-policy-incomplete",
      "superseded-unregistered-retired-corpus-enforcement-incomplete",
      "superseded-unregistered-quarantine-history-not-durable",
      "superseded-unregistered-process-durability-identity-admission-incomplete",
      "superseded-unregistered-durability-claim-and-presenter-identity-incomplete",
    ]);
    expect(
      prepared.preregistration.externalRegistrationFormat.registrationRecord,
    ).toBeNull();
    expect(
      prepared.preregistration.externalRegistrationFormat.submissionAuthorized,
    ).toBe(false);
  });

  it("proves scientific and financial inheritance remains exact", async () => {
    const predecessor = unwrap(await prepareM9b12cPreregistration());
    const corrected = unwrap(await prepareM9b12ePreregistration());
    expect(
      await verifyM9b12eScientificFinancialInvariance(
        predecessor.preregistration,
        corrected.preregistration,
      ),
    ).toEqual({ ok: true, value: true });
    expect(
      corrected.preregistration.scientificFinancialInvariance,
    ).toMatchObject({
      probePairs: 24,
      primaryPairs: 168,
      balancedCells: 24,
      analysis: "exact-one-sided-conditional-mcnemar",
      countRequests: 768,
      inferenceCalls: 768,
      maximumHttpRequests: 1536,
      inferenceCeilingUsdMicros: 342_097_920,
      countContingencyUsdMicros: 117_964_800,
      operationalCeilingUsdMicros: 460_062_720,
      providerCapUsdMicros: 500_000_000,
      headroomUsdMicros: 39_937_280,
    });
  });

  it("states the complete local rollback boundary without claiming detection", async () => {
    const prepared = unwrap(await prepareM9b12ePreregistration());
    expect(prepared.preregistration.threatModel).toMatchObject({
      completeLocalRollbackDetectionClaimed: false,
      independentMonotonicWitnessPresent: false,
      completeLocalRollbackResistanceRequiresIndependentWitness: true,
      excludedThreats: [
        "malicious-or-compromised-privileged-host-or-operator",
        "coordinated-complete-local-authority-domain-rollback",
        "privileged-matching-sqlite-and-anchor-rollback",
        "kernel-hypervisor-or-hardware-compromise",
      ],
      detectedOrSuspectedOperatorRestoreDisposition:
        "halt-campaign-require-new-execution-identity-no-normal-resume",
    });
    expect(
      prepared.preregistration.durableAuthority
        .coordinatedCompleteLocalRollbackDetected,
    ).toBe(false);
    const packageRoot = join(process.cwd(), "docs/m9b12e-preregistration");
    const threatModel = await readFile(
      join(packageRoot, "threat-model.md"),
      "utf8",
    );
    const durableAuthority = await readFile(
      join(packageRoot, "durable-authority.md"),
      "utf8",
    );
    expect(threatModel).toMatch(
      /It is not an independent monotonic\s+witness and is not described as rollback-resistant\./u,
    );
    expect(threatModel).toMatch(
      /M9b\.12e has no such witness and makes no such claim\./u,
    );
    expect(threatModel).toMatch(
      /halts the campaign and requires a new execution identity/u,
    );
    expect(durableAuthority).toContain("consistency/recovery anchor");
    expect(durableAuthority).not.toContain("rollback-resistant");
  });

  it("keeps the correction implementation private", async () => {
    const facade = await readFile(
      join(process.cwd(), "packages/generator-ai-sdk/src/index.ts"),
      "utf8",
    );
    expect(facade).not.toContain("m9b12e");
  });
});
