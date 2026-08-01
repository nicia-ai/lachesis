import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalizeJson, parseJson } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import { prepareM9b12cPreregistration } from "../internal/m9b12c-preregistration.js";
import {
  createM9b12dExternalRegistrationFormat,
  M9B12D_PREREGISTRATION_DIGEST,
  M9B12D_PREREGISTRATION_PROTOCOL,
  prepareM9b12dPreregistration,
  verifyM9b12dPreregistration,
  verifyM9b12dScientificFinancialInvariance,
} from "../internal/m9b12d-preregistration.js";

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

describe("M9b.12d preregistration", () => {
  it("rederives one immutable package", async () => {
    const prepared = unwrap(await prepareM9b12dPreregistration());
    expect(prepared.preregistration.preregistrationDigest).toBe(
      M9B12D_PREREGISTRATION_DIGEST,
    );
    expect(
      await verifyM9b12dPreregistration(
        prepared.token,
        prepared.preregistration,
      ),
    ).toEqual({ ok: true, value: prepared.preregistration });
  });

  it("binds the generated package and standalone registration byte model", async () => {
    const prepared = unwrap(await prepareM9b12dPreregistration());
    const packageRoot = join(process.cwd(), "docs/m9b12d-preregistration");
    const onDisk = await readJson(join(packageRoot, "preregistration.json"));
    expect(
      unwrap(await verifyM9b12dPreregistration(prepared.token, onDisk)),
    ).toEqual(prepared.preregistration);
    const standalone = await readJson(
      join(packageRoot, "external-registration-format.json"),
    );
    expect(canonicalizeJson(standalone)).toEqual(
      canonicalizeJson(prepared.preregistration.externalRegistrationFormat),
    );
    expect(standalone).toEqual(createM9b12dExternalRegistrationFormat());
  });

  it("makes only M9b.12d registrable and preserves the four predecessor dispositions", async () => {
    const prepared = unwrap(await prepareM9b12dPreregistration());
    expect(
      prepared.preregistration.externalRegistrationFormat.registrablePackage,
    ).toBe(M9B12D_PREREGISTRATION_PROTOCOL.qualified);
    expect(
      prepared.preregistration.supersession.predecessors.map(
        ({ status }) => status,
      ),
    ).toEqual([
      "superseded-unregistered-retired-corpus-policy-incomplete",
      "superseded-unregistered-retired-corpus-enforcement-incomplete",
      "superseded-unregistered-quarantine-history-not-durable",
      "superseded-unregistered-process-durability-identity-admission-incomplete",
    ]);
    expect(
      prepared.preregistration.externalRegistrationFormat.registrationRecord,
    ).toBeNull();
    expect(
      prepared.preregistration.externalRegistrationFormat.submissionAuthorized,
    ).toBe(false);
  });

  it("proves scientific and financial inheritance from M9b.12c", async () => {
    const predecessor = unwrap(await prepareM9b12cPreregistration());
    const corrected = unwrap(await prepareM9b12dPreregistration());
    expect(
      await verifyM9b12dScientificFinancialInvariance(
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

  it("keeps the correction implementation private", async () => {
    const facade = await readFile(
      join(process.cwd(), "packages/generator-ai-sdk/src/index.ts"),
      "utf8",
    );
    expect(facade).not.toContain("m9b12d");
  });
});
