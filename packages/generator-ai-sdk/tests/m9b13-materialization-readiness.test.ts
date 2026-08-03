import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseJson } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import {
  createM9b13SyntheticAuthority,
  createM9b13SyntheticDryRunInput,
  M9B13_FROZEN_BINDINGS,
  M9B13_PROTOCOLS,
  M9B13_ZERO_EFFECTS,
  type M9b13DryRunInput,
  runM9b13ZeroEffectDryRun,
  validateM9b13SyntheticFilesystem,
} from "../internal/m9b13-materialization-readiness.js";

async function expectRejected(
  input: M9b13DryRunInput,
  reason: string,
): Promise<void> {
  const result = await runM9b13ZeroEffectDryRun(input);
  expect(result).toEqual({
    ok: false,
    error: { kind: "readiness-rejection", reason },
  });
  expect(input.effects).toEqual(M9B13_ZERO_EFFECTS);
}

function duplicateIdentityInput(
  kind: "case" | "source" | "fact" | "opaque-principal",
): M9b13DryRunInput {
  const base = createM9b13SyntheticDryRunInput();
  const duplicate = { kind, value: `synthetic-${kind}-duplicate-canary` };
  return { ...base, identities: [...base.identities, duplicate, duplicate] };
}

describe("M9b.13 offline corpus-materialization readiness", () => {
  it("rederives the frozen bindings, population arithmetic, zero effects, and dependency NO-GO", async () => {
    const result = await runM9b13ZeroEffectDryRun(
      createM9b13SyntheticDryRunInput(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.reason);
    expect(result.value).toMatchObject({
      protocol: M9B13_PROTOCOLS.dryRun,
      decision: "m9b13-materialization-readiness-no-go",
      checks: {
        bindings: "passed",
        populationArithmetic: "passed",
        dependencyClosure: "failed",
        noNetwork: "passed",
        noCredentials: "passed",
        noCorpus: "passed",
        noGold: "passed",
        noProviderCalls: "passed",
        noSchedule: "passed",
        noAuthorityActivation: "passed",
        noAnalysis: "passed",
      },
      effects: M9B13_ZERO_EFFECTS,
    });
    expect(result.value.findings).toEqual([
      {
        code: "m9b13:clean-node24-container-base-unavailable",
        detail:
          "No clean study-eligible Node 24 container base is locally available; network acquisition and reuse of unrelated historical images are forbidden.",
      },
    ]);
    const checkedIn = parseJson(
      await readFile(
        join(
          process.cwd(),
          "docs/m9b13-materialization-readiness/zero-effect-dry-run.json",
        ),
        "utf8",
      ),
    );
    expect(checkedIn).toEqual({ ok: true, value: result.value });
  });

  it("rejects a preregistration or receipt binding mismatch", async () => {
    const base = createM9b13SyntheticDryRunInput();
    await expectRejected(
      {
        ...base,
        bindings: { ...base.bindings, receiptDigest: "0".repeat(64) },
      },
      "m9b13:binding-mismatch",
    );
    expect(M9B13_FROZEN_BINDINGS.osfRegistration).toBe("63sh5");
  });

  it("rejects attempted retired-corpus path access", async () => {
    expect.hasAssertions();
    const base = createM9b13SyntheticDryRunInput();
    await expectRejected(
      { ...base, attemptedPaths: ["sealed/retired-corpus-canary"] },
      "m9b13:forbidden-retired-path",
    );
  });

  it("rejects a repository-wide search root", async () => {
    expect.hasAssertions();
    const base = createM9b13SyntheticDryRunInput();
    await expectRejected(
      { ...base, searchRoots: ["."] },
      "m9b13:repository-wide-search-forbidden",
    );
  });

  it("rejects caller-selected case inventories and observer identities", async () => {
    expect.hasAssertions();
    const base = createM9b13SyntheticDryRunInput();
    await expectRejected(
      { ...base, inventoryAuthority: "caller-selected" },
      "m9b13:caller-selected-case-inventory",
    );
    await expectRejected(
      { ...base, observerAuthority: "caller-selected" },
      "m9b13:caller-selected-observer-identity",
    );
  });

  it("rejects a principal combining constructor and evaluator access", async () => {
    expect.hasAssertions();
    const base = createM9b13SyntheticDryRunInput();
    await expectRejected(
      {
        ...base,
        roleCombinations: [
          {
            principal: "synthetic-test-only/incompatible-canary",
            roles: ["constructor", "evaluator"],
          },
        ],
      },
      "m9b13:incompatible-role-combination",
    );
  });

  it("rejects hidden gold and cross-packet order in author packets", async () => {
    expect.hasAssertions();
    const base = createM9b13SyntheticDryRunInput();
    await expectRejected(
      { ...base, authorPacketFields: ["task", "hidden-gold"] },
      "m9b13:hidden-gold-in-author-packet",
    );
    await expectRejected(
      { ...base, crossPacketMetadataFields: ["global-execution-ordinal"] },
      "m9b13:cross-packet-ordering-metadata",
    );
  });

  it.each(["case", "source", "fact", "opaque-principal"] as const)(
    "rejects duplicate %s identities",
    async (kind) => {
      expect.hasAssertions();
      await expectRejected(
        duplicateIdentityInput(kind),
        `m9b13:duplicate-${kind}-identity`,
      );
    },
  );

  it("rejects development, probe, or primary overlap and source near-duplicates", async () => {
    expect.hasAssertions();
    const base = createM9b13SyntheticDryRunInput();
    await expectRejected(
      { ...base, splitOverlaps: ["development-probe/task"] },
      "m9b13:development-probe-primary-overlap",
    );
    await expectRejected(
      { ...base, sourceNearDuplicates: 1 },
      "m9b13:source-near-duplicate-leakage",
    );
  });

  it("rejects missing provenance and incomplete exposure history", async () => {
    expect.hasAssertions();
    const base = createM9b13SyntheticDryRunInput();
    await expectRejected(
      { ...base, provenanceComplete: false },
      "m9b13:missing-provenance-record",
    );
    await expectRejected(
      { ...base, exposureInventoryComplete: false },
      "m9b13:incomplete-exposure-inventory",
    );
  });

  it("validates only owner-private regular synthetic filesystem fixtures and removes them", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "lachesis-m9b13-"));
    await chmod(fixtureRoot, 0o700);
    const fixtureFile = join(fixtureRoot, "synthetic-canary.json");
    await writeFile(fixtureFile, "{}\n", { mode: 0o600 });
    try {
      expect(await validateM9b13SyntheticFilesystem(fixtureRoot)).toEqual({
        ok: true,
        value: true,
      });
      const link = join(fixtureRoot, "synthetic-link-canary");
      await symlink(fixtureFile, link);
      expect(await validateM9b13SyntheticFilesystem(fixtureRoot)).toEqual({
        ok: false,
        error: {
          kind: "readiness-rejection",
          reason: "m9b13:filesystem-symlink-permission-or-ownership-drift",
        },
      });
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
    expect(M9B13_ZERO_EFFECTS).toEqual(
      createM9b13SyntheticDryRunInput().effects,
    );
  });

  it("rejects network-enabled roles and credential/environment leakage", async () => {
    expect.hasAssertions();
    const base = createM9b13SyntheticDryRunInput();
    await expectRejected(
      { ...base, networkEnabledRoles: ["constructor"] },
      "m9b13:network-enabled-study-role",
    );
    await expectRejected(
      { ...base, leakedEnvironmentKeys: ["SYNTHETIC_API_KEY_CANARY"] },
      "m9b13:credential-or-environment-leakage",
    );
  });

  it("rejects dependency fallback to workspace or private packages", async () => {
    expect.hasAssertions();
    const base = createM9b13SyntheticDryRunInput();
    await expectRejected(
      {
        ...base,
        dependencies: {
          ...base.dependencies,
          workspaceFallbackPermitted: true,
        },
      },
      "m9b13:dependency-workspace-fallback",
    );
  });

  it("rejects schedules, randomization, corpus, or gold emitted during readiness", async () => {
    expect.hasAssertions();
    const base = createM9b13SyntheticDryRunInput();
    await expectRejected(
      {
        ...base,
        prohibitedAttempts: {
          ...base.prohibitedAttempts,
          scheduleOrRandomization: true,
        },
      },
      "m9b13:schedule-or-randomization-instantiated",
    );
    await expectRejected(
      {
        ...base,
        prohibitedAttempts: {
          ...base.prohibitedAttempts,
          corpusArtifact: true,
        },
      },
      "m9b13:corpus-artifact-emitted",
    );
    await expectRejected(
      {
        ...base,
        prohibitedAttempts: {
          ...base.prohibitedAttempts,
          goldArtifact: true,
        },
      },
      "m9b13:gold-artifact-emitted",
    );
  });

  it("keeps materialization and execution admission distinct and fail-closed", () => {
    const authority = createM9b13SyntheticAuthority();
    const principal = authority.issuePrincipal("materializer");
    const issued = authority.issueLaunch(principal, "materialization");
    if (!issued.ok) throw new Error(issued.error.reason);
    expect(authority.admit({ ...issued.value }, "materialization")).toEqual({
      ok: false,
      error: {
        kind: "readiness-rejection",
        reason: "m9b13:copied-launch-handle",
      },
    });
    expect(authority.admit(issued.value, "execution")).toEqual({
      ok: false,
      error: {
        kind: "readiness-rejection",
        reason: "m9b13:authorization-domain-mismatch",
      },
    });
    expect(authority.admit(issued.value, "materialization")).toEqual({
      ok: true,
      value: "admitted",
    });
    expect(authority.admit(issued.value, "materialization")).toEqual({
      ok: false,
      error: {
        kind: "readiness-rejection",
        reason: "m9b13:launch-handle-consumed",
      },
    });
  });

  it("rejects stale admission and permanently quarantined identities", () => {
    const authority = createM9b13SyntheticAuthority();
    const stalePrincipal = authority.issuePrincipal("constructor");
    const stale = authority.issueLaunch(stalePrincipal, "materialization");
    if (!stale.ok) throw new Error(stale.error.reason);
    authority.advanceRevision();
    expect(authority.admit(stale.value, "materialization")).toEqual({
      ok: false,
      error: {
        kind: "readiness-rejection",
        reason: "m9b13:stale-admission",
      },
    });
    const quarantined = authority.issuePrincipal("evaluator");
    expect(authority.quarantine(quarantined)).toEqual({
      ok: true,
      value: true,
    });
    expect(authority.issueLaunch(quarantined, "materialization")).toEqual({
      ok: false,
      error: {
        kind: "readiness-rejection",
        reason: "m9b13:quarantined-identity",
      },
    });
  });

  it("keeps M9b.13 private and all checked-in machine artifacts parseable", async () => {
    const facade = await readFile(
      join(process.cwd(), "packages/generator-ai-sdk/src/index.ts"),
      "utf8",
    );
    expect(facade).not.toContain("m9b13");
    const bindingsText = await readFile(
      join(process.cwd(), "docs/m9b13-materialization-readiness/bindings.json"),
      "utf8",
    );
    expect(parseJson(bindingsText).ok).toBe(true);
  });
});
