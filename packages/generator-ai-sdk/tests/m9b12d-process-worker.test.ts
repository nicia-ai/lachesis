import { readFile, writeFile } from "node:fs/promises";

import { parseJson } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  M9B12B_CONTAMINATION_ANCESTORS,
  M9B12B_ISOLATION_CHANNELS,
} from "../internal/m9b12b-preregistration.js";
import {
  admitM9b12dRoleStartup,
  createNewM9b12dAuthority,
  issueM9b12dObserverLaunchHandle,
  openExistingM9b12dAuthority,
} from "../internal/m9b12d-durable-authority-node.js";

const workerInputSchema = z
  .strictObject({
    action: z.enum(["create-and-quarantine", "open-and-reject"]),
    databasePath: z.string(),
    anchorPath: z.string(),
    bindingPath: z.string(),
    reportPath: z.string(),
  })
  .readonly();

function identity(character: string): string {
  return character.repeat(64);
}

function unwrap<T>(
  result:
    Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }>,
): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function currentAssessment(retiredMaterialStatus: "none" | "confirmed") {
  return {
    exposureInventory: { status: "complete", commitment: identity("2") },
    isolationProofs: M9B12B_ISOLATION_CHANNELS.map((channel) => ({
      channel,
      decision: "isolated" as const,
    })),
    unsupportedIsolationChannels: [],
    lineageProofs: M9B12B_CONTAMINATION_ANCESTORS.map((ancestorKind) => ({
      ancestorKind,
      decision: "clean" as const,
    })),
    unsupportedAncestorKinds: [],
    noninterference: "confirmed" as const,
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

async function runWorker(): Promise<void> {
  const input = workerInputSchema.parse({
    action: process.env["M9B12D_PROCESS_ACTION"],
    databasePath: process.env["M9B12D_PROCESS_DATABASE_PATH"],
    anchorPath: process.env["M9B12D_PROCESS_ANCHOR_PATH"],
    bindingPath: process.env["M9B12D_PROCESS_BINDING_PATH"],
    reportPath: process.env["M9B12D_PROCESS_REPORT_PATH"],
  });
  const paths = {
    databasePath: input.databasePath,
    anchorPath: input.anchorPath,
  };
  if (input.action === "create-and-quarantine") {
    const created = unwrap(await createNewM9b12dAuthority(paths));
    const issued = unwrap(
      await issueM9b12dObserverLaunchHandle(created.authority, {
        studyPrincipalIdentity: "ＯＢＳＥＲＶＥＲ　ＡＬＰＨＡ",
        launchAllocationIdentity: "first-allocation",
        requestedRole: "constructor",
        sessionIdentity: identity("a"),
        validThroughEpochMs: null,
      }),
    );
    const effectCounter = { value: 0 };
    const receipt = unwrap(
      await admitM9b12dRoleStartup(
        created.authority,
        {
          launchHandle: issued.launchHandle,
          requestedRole: issued.requestedRole,
          sessionIdentity: issued.sessionIdentity,
          derivedInventoryIdentity: identity("b"),
          admissionIdentity: identity("c"),
          currentAssessment: currentAssessment("confirmed"),
        },
        () => {
          effectCounter.value += 1;
          return Promise.resolve({ ok: true, value: undefined } as const);
        },
      ),
    );
    await writeFile(input.bindingPath, JSON.stringify(created.trustedBinding), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(
      input.reportPath,
      JSON.stringify({
        decision: receipt.decision,
        canonicalObserverKey: receipt.canonicalObserverKey,
        effectCount: effectCounter.value,
      }),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    return;
  }

  const bindingJson = parseJson(await readFile(input.bindingPath, "utf8"));
  if (!bindingJson.ok) throw new Error(bindingJson.error.message);
  const opened = unwrap(
    await openExistingM9b12dAuthority(paths, bindingJson.value),
  );
  const recreate = await createNewM9b12dAuthority(paths);
  const issued = unwrap(
    await issueM9b12dObserverLaunchHandle(opened, {
      studyPrincipalIdentity: "  observer   alpha  ",
      launchAllocationIdentity: "second-allocation",
      requestedRole: "analyst",
      sessionIdentity: identity("d"),
      validThroughEpochMs: null,
    }),
  );
  const effectCounter = { value: 0 };
  const receipt = unwrap(
    await admitM9b12dRoleStartup(
      opened,
      {
        launchHandle: issued.launchHandle,
        requestedRole: issued.requestedRole,
        sessionIdentity: issued.sessionIdentity,
        derivedInventoryIdentity: identity("e"),
        admissionIdentity: identity("f"),
        currentAssessment: currentAssessment("none"),
      },
      () => {
        effectCounter.value += 1;
        return Promise.resolve({ ok: true, value: undefined } as const);
      },
    ),
  );
  if (receipt.decision !== "quarantine-reuse-forbidden")
    throw new Error("Process B unexpectedly received atomic admission.");
  await writeFile(
    input.reportPath,
    JSON.stringify({
      decision: receipt.decision,
      reasons: receipt.reasons,
      canonicalObserverKey: receipt.canonicalObserverKey,
      observerReuseForbidden: receipt.observerReuseForbidden,
      roleSessionStartupPermitted: receipt.roleSessionStartupPermitted,
      providerEffectsPermitted: receipt.providerEffectsPermitted,
      derivedInventoryQuarantined: receipt.derivedInventoryQuarantined,
      effectCount: effectCounter.value,
      recreateRejected: !recreate.ok,
    }),
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

const action = process.env["M9B12D_PROCESS_ACTION"];

describe("M9b.12d child-process authority worker", () => {
  it("performs exactly one requested process action when configured", async () => {
    expect(action).toBe(action);
    if (action === undefined) return;
    await runWorker();
  });
});
