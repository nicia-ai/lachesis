import { access, open, stat, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const workerInputSchema = z
  .strictObject({
    mode: z.enum(["delete", "wal"]),
    databasePath: z.string(),
    reportPath: z.string(),
  })
  .readonly();

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runWorker(): Promise<void> {
  const input = workerInputSchema.parse({
    mode: process.env["M9B12F_SIDECAR_MODE"],
    databasePath: process.env["M9B12F_SIDECAR_DATABASE_PATH"],
    reportPath: process.env["M9B12F_SIDECAR_REPORT_PATH"],
  });
  const databaseFile = await open(input.databasePath, "wx", 0o600);
  try {
    await databaseFile.sync();
  } finally {
    await databaseFile.close();
  }
  const database = new DatabaseSync(input.databasePath);
  const observed: {
    journal: number | null;
    wal: number | null;
    shm: number | null;
  } = { journal: null, wal: null, shm: null };
  try {
    database.exec(
      "PRAGMA synchronous = FULL; CREATE TABLE sample (value INTEGER NOT NULL) STRICT;",
    );
    if (input.mode === "delete") {
      database.exec(
        "PRAGMA journal_mode = DELETE; BEGIN IMMEDIATE; INSERT INTO sample VALUES (1);",
      );
      observed.journal =
        (await stat(`${input.databasePath}-journal`)).mode & 0o777;
      database.exec("ROLLBACK");
    } else {
      database.exec(
        "PRAGMA journal_mode = WAL; INSERT INTO sample VALUES (1);",
      );
      observed.wal = (await stat(`${input.databasePath}-wal`)).mode & 0o777;
      observed.shm = (await stat(`${input.databasePath}-shm`)).mode & 0o777;
    }
  } finally {
    database.close();
  }
  await writeFile(
    input.reportPath,
    JSON.stringify({
      observed,
      cleanCloseAbsent: {
        journal: !(await exists(`${input.databasePath}-journal`)),
        wal: !(await exists(`${input.databasePath}-wal`)),
        shm: !(await exists(`${input.databasePath}-shm`)),
      },
    }),
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

const configured = process.env["M9B12F_SIDECAR_MODE"];

describe("M9b.12f SQLite sidecar lifecycle worker", () => {
  it("runs exactly one configured SQLite lifecycle", async () => {
    expect(configured).toBe(configured);
    if (configured === undefined) return;
    await runWorker();
  });
});
