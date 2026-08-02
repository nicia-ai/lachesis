import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseJson } from "@nicia-ai/lachesis";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

const roots: Array<string> = [];

const processAReportSchema = z
  .strictObject({
    decision: z.literal("quarantine-reuse-forbidden"),
    canonicalObserverKey: z.string(),
    effectCount: z.literal(0),
  })
  .readonly();

const processBReportSchema = z
  .strictObject({
    decision: z.literal("quarantine-reuse-forbidden"),
    reasons: z.tuple([z.literal("observer-previously-quarantined")]),
    canonicalObserverKey: z.string(),
    observerReuseForbidden: z.literal(true),
    roleSessionStartupPermitted: z.literal(false),
    providerEffectsPermitted: z.literal(false),
    derivedInventoryQuarantined: z.literal(true),
    effectCount: z.literal(0),
    recreateRejected: z.literal(true),
  })
  .readonly();

const sidecarReportSchema = z
  .strictObject({
    observed: z
      .strictObject({
        journal: z.number().int().nullable(),
        wal: z.number().int().nullable(),
        shm: z.number().int().nullable(),
      })
      .readonly(),
    cleanCloseAbsent: z
      .strictObject({
        journal: z.literal(true),
        wal: z.literal(true),
        shm: z.literal(true),
      })
      .readonly(),
  })
  .readonly();

function runProcess(
  action: "create-and-quarantine" | "open-and-reject",
  paths: Readonly<{
    databasePath: string;
    anchorPath: string;
    bindingPath: string;
    reportPath: string;
  }>,
): void {
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), "node_modules/vitest/vitest.mjs"),
      "run",
      "packages/generator-ai-sdk/tests/m9b12f-process-worker.test.ts",
      "--reporter=dot",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        M9B12F_PROCESS_ACTION: action,
        M9B12F_PROCESS_DATABASE_PATH: paths.databasePath,
        M9B12F_PROCESS_ANCHOR_PATH: paths.anchorPath,
        M9B12F_PROCESS_BINDING_PATH: paths.bindingPath,
        M9B12F_PROCESS_REPORT_PATH: paths.reportPath,
      },
    },
  );
  if (result.status !== 0)
    throw new Error(
      `M9b.12f ${action} process failed: ${result.error?.message ?? result.stderr}`,
    );
}

function runSidecarProcess(
  mode: "delete" | "wal",
  umask: "0022" | "0000" | "0077",
  databasePath: string,
  reportPath: string,
): void {
  const result = spawnSync(
    "/bin/sh",
    [
      "-c",
      'umask "$1"; shift; exec "$@"',
      "m9b12f-sidecar-umask",
      umask,
      process.execPath,
      join(process.cwd(), "node_modules/vitest/vitest.mjs"),
      "run",
      "packages/generator-ai-sdk/tests/m9b12f-sqlite-sidecar-worker.test.ts",
      "--reporter=dot",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        M9B12F_SIDECAR_MODE: mode,
        M9B12F_SIDECAR_DATABASE_PATH: databasePath,
        M9B12F_SIDECAR_REPORT_PATH: reportPath,
      },
    },
  );
  if (result.status !== 0)
    throw new Error(
      `M9b.12f ${mode}/${umask} sidecar process failed: ${result.error?.message ?? result.stderr}`,
    );
}

async function readReport<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const parsed = parseJson(await readFile(path, "utf8"));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return schema.parse(parsed.value);
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("M9b.12f genuine cross-process durability", () => {
  it("rejects quarantine reuse after the creating process has exited", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "lachesis-m9b12f-process-")),
    );
    roots.push(root);
    const common = {
      databasePath: join(root, "authority-store", "authority.sqlite"),
      anchorPath: join(root, "trusted-anchor", "anchor.json"),
      bindingPath: join(root, "controller-binding.json"),
    };
    const processAPath = join(root, "process-a-report.json");
    runProcess("create-and-quarantine", {
      ...common,
      reportPath: processAPath,
    });
    const processA = await readReport(processAPath, processAReportSchema);

    const processBPath = join(root, "process-b-report.json");
    runProcess("open-and-reject", {
      ...common,
      reportPath: processBPath,
    });
    const processB = await readReport(processBPath, processBReportSchema);

    expect(processA).toMatchObject({
      decision: "quarantine-reuse-forbidden",
      effectCount: 0,
    });
    expect(processB).toEqual({
      decision: "quarantine-reuse-forbidden",
      reasons: ["observer-previously-quarantined"],
      canonicalObserverKey: processA.canonicalObserverKey,
      observerReuseForbidden: true,
      roleSessionStartupPermitted: false,
      providerEffectsPermitted: false,
      derivedInventoryQuarantined: true,
      effectCount: 0,
      recreateRejected: true,
    });
  }, 60_000);

  it.each(["0022", "0000", "0077"] as const)(
    "keeps genuine SQLite journal, WAL, and SHM sidecars private under umask %s",
    async (umask) => {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), `lachesis-m9b12f-umask-${umask}-`)),
      );
      roots.push(root);
      const deleteReportPath = join(root, "delete-report.json");
      runSidecarProcess(
        "delete",
        umask,
        join(root, "delete.sqlite"),
        deleteReportPath,
      );
      expect(await readReport(deleteReportPath, sidecarReportSchema)).toEqual({
        observed: { journal: 0o600, wal: null, shm: null },
        cleanCloseAbsent: { journal: true, wal: true, shm: true },
      });

      const walReportPath = join(root, "wal-report.json");
      runSidecarProcess("wal", umask, join(root, "wal.sqlite"), walReportPath);
      expect(await readReport(walReportPath, sidecarReportSchema)).toEqual({
        observed: { journal: null, wal: 0o600, shm: 0o600 },
        cleanCloseAbsent: { journal: true, wal: true, shm: true },
      });
    },
    60_000,
  );
});
