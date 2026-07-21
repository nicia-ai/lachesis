import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { parseJson } from "@nicia-ai/lachesis";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  auditM5bPrivateSqlite,
  prepareM5bPrivateSqlite,
} from "../src/m5b-private-sqlite.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: Array<string> = [];
const privateSqliteModuleUrl = pathToFileURL(
  join(import.meta.dirname, "..", "dist", "m5b-private-sqlite.js"),
).href;
const typeGraphSchemaModuleUrl = pathToFileURL(
  join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "packages",
    "evidence-typegraph",
    "dist",
    "store.js",
  ),
).href;
const typeGraphPackageUrl = pathToFileURL(
  join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "packages",
    "evidence-typegraph",
    "package.json",
  ),
).href;
const childSource = `
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { auditM5bPrivateSqlite, prepareM5bPrivateSqlite } from ${JSON.stringify(privateSqliteModuleUrl)};
import { TYPEGRAPH_EVIDENCE_SCHEMA } from ${JSON.stringify(typeGraphSchemaModuleUrl)};
const databasePath = process.argv[1];
const mode = process.argv[2];
if (databasePath === undefined || mode === undefined) throw new Error("Expected a database path and SQLite mode.");
const prepared = await prepareM5bPrivateSqlite(databasePath);
if (!prepared.ok) throw new Error(prepared.error.message);
const requireFromTypeGraph = createRequire(${JSON.stringify(typeGraphPackageUrl)});
if (mode === "wal") {
  const modulePath = requireFromTypeGraph.resolve("@nicia-ai/typegraph/sqlite/local");
  const typeGraph = await import(pathToFileURL(modulePath).href);
  const store = await typeGraph.createLocalSqliteStore(TYPEGRAPH_EVIDENCE_SCHEMA, { path: databasePath, store: { history: true } });
  const audit = await auditM5bPrivateSqlite(databasePath);
  if (!audit.ok) throw new Error(audit.error.message);
  process.stdout.write(JSON.stringify(audit.value) + "\\n");
  await store.close();
} else if (mode === "journal") {
  const BetterSqlite3 = requireFromTypeGraph("better-sqlite3");
  const database = new BetterSqlite3(databasePath);
  database.pragma("journal_mode = delete");
  database.exec("CREATE TABLE IF NOT EXISTS permission_probe (value TEXT)");
  database.exec("BEGIN IMMEDIATE");
  database.prepare("INSERT INTO permission_probe (value) VALUES (?)").run("x");
  const audit = await auditM5bPrivateSqlite(databasePath);
  if (!audit.ok) throw new Error(audit.error.message);
  process.stdout.write(JSON.stringify(audit.value) + "\\n");
  database.exec("ROLLBACK");
  database.close();
} else {
  throw new Error("Unknown SQLite test mode.");
}
`;
const childAuditSchema = z
  .strictObject({
    databasePath: z.string(),
    directoryPath: z.string(),
    artifacts: z
      .array(z.strictObject({ path: z.string(), mode: z.literal(0o600) }))
      .readonly(),
  })
  .readonly();

function parseChildAudit(value: string): z.infer<typeof childAuditSchema> {
  return childAuditSchema.parse(unwrap(parseJson(value)));
}

function unwrap<T>(
  result:
    Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }>,
): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lachesis-m5b-sqlite-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("M5b.1 private SQLite ownership boundary", () => {
  it.each(["0022", "0000", "0077"])(
    "creates the TypeGraph database and WAL sidecars as 0600 under umask %s",
    async (mask) => {
      const root = await temporaryRoot();
      const databasePath = join(root, mask, "private", "evidence.sqlite");
      const child = await execFileAsync(
        "/bin/sh",
        [
          "-c",
          'umask "$1"; exec "$2" --input-type=module --eval "$3" "$4" "$5"',
          "m5b-private-sqlite",
          mask,
          process.execPath,
          childSource,
          databasePath,
          "wal",
        ],
        { encoding: "utf8" },
      );
      const audit = parseChildAudit(child.stdout);
      expect(audit.artifacts.map((artifact) => artifact.path)).toEqual(
        expect.arrayContaining([
          databasePath,
          `${databasePath}-wal`,
          `${databasePath}-shm`,
        ]),
      );
      expect(audit.artifacts).toHaveLength(3);
    },
  );

  it.each(["0022", "0000", "0077"])(
    "keeps rollback journals private under umask %s",
    async (mask) => {
      const root = await temporaryRoot();
      const databasePath = join(root, `${mask}-journal`, "evidence.sqlite");
      const child = await execFileAsync(
        "/bin/sh",
        [
          "-c",
          'umask "$1"; exec "$2" --input-type=module --eval "$3" "$4" "$5"',
          "m5b-private-sqlite",
          mask,
          process.execPath,
          childSource,
          databasePath,
          "journal",
        ],
        { encoding: "utf8" },
      );
      const audit = parseChildAudit(child.stdout);
      expect(audit.artifacts).toContainEqual({
        path: `${databasePath}-journal`,
        mode: 0o600,
      });
    },
  );

  it("rejects permissive, linked, and non-regular existing database paths", async () => {
    const root = await temporaryRoot();
    const parent = join(root, "private");
    await mkdir(parent, { mode: 0o700 });

    const permissive = join(parent, "permissive.sqlite");
    const permissiveHandle = await open(permissive, "wx", 0o600);
    await permissiveHandle.close();
    await chmod(permissive, 0o644);
    await expect(prepareM5bPrivateSqlite(permissive)).resolves.toMatchObject({
      ok: false,
    });

    const target = join(parent, "target.sqlite");
    const targetHandle = await open(target, "wx", 0o600);
    await targetHandle.close();
    const linked = join(parent, "linked.sqlite");
    await symlink(target, linked);
    await expect(prepareM5bPrivateSqlite(linked)).resolves.toMatchObject({
      ok: false,
    });

    const directory = join(parent, "directory.sqlite");
    await mkdir(directory, { mode: 0o700 });
    await expect(prepareM5bPrivateSqlite(directory)).resolves.toMatchObject({
      ok: false,
    });
  });

  it("supports concurrent creation and reopening without permission drift", async () => {
    const root = await temporaryRoot();
    const databasePath = join(root, "private", "evidence.sqlite");
    const [first, second] = await Promise.all([
      prepareM5bPrivateSqlite(databasePath),
      prepareM5bPrivateSqlite(databasePath),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect((await lstat(databasePath)).mode & 0o777).toBe(0o600);
    await expect(prepareM5bPrivateSqlite(databasePath)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("fails closed on parent, database, and sidecar permission drift", async () => {
    const root = await temporaryRoot();
    const databasePath = join(root, "private", "evidence.sqlite");
    unwrap(await prepareM5bPrivateSqlite(databasePath));

    await chmod(databasePath, 0o644);
    await expect(auditM5bPrivateSqlite(databasePath)).resolves.toMatchObject({
      ok: false,
    });
    await chmod(databasePath, 0o600);

    const wal = await open(`${databasePath}-wal`, "wx", 0o600);
    await wal.close();
    await chmod(`${databasePath}-wal`, 0o644);
    await expect(auditM5bPrivateSqlite(databasePath)).resolves.toMatchObject({
      ok: false,
    });
    await chmod(`${databasePath}-wal`, 0o600);

    await chmod(join(root, "private"), 0o755);
    await expect(auditM5bPrivateSqlite(databasePath)).resolves.toMatchObject({
      ok: false,
    });
  });
});
