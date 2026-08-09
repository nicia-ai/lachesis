import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { canonicalizeJson } from "@nicia-ai/lachesis";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  inspectM9b13k2RestartState,
  M9B13K2_RUNTIME_IMPLEMENTATION_IDENTITY,
} from "../src/internal/m9b13k2/controller.js";
import {
  appendM9b13k2LedgerEvent,
  auditM9b13k2FilesystemLedger,
  createM9b13k2FilesystemLedger,
  type M9b13k2FilesystemLedger,
  type M9b13k2LedgerBinding,
  type M9b13k2LedgerEventDraft,
  m9b13k2LedgerPathsForConformance,
  type M9b13k2LedgerState,
  openM9b13k2FilesystemLedger,
  snapshotM9b13k2FilesystemLedger,
  validateM9b13k2LedgerState,
} from "../src/internal/m9b13k2/ledger.js";
import {
  M9B13K2_ARTIFACT_IDENTITY,
  M9B13K2_DRAFT_ID,
  M9B13K2_PROJECT_ID,
  M9B13K2_PROVIDER,
  M9B13K2_RUNTIME_PROTOCOL,
  m9b13k2DomainDigest,
} from "../src/internal/m9b13k2/protocol.js";

const activationIdentity = `sha256:${"a".repeat(64)}`;
const requestIdentity = `sha256:${"b".repeat(64)}`;
const tokenId = "c".repeat(24);
const campaignIdentity = `sha256:${m9b13k2DomainDigest(
  M9B13K2_RUNTIME_PROTOCOL,
  "campaign",
  activationIdentity,
  requestIdentity,
)}`;
const temporaryRoots: Array<string> = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

async function newLedger(): Promise<
  Readonly<{
    root: string;
    ledger: M9b13k2FilesystemLedger;
    binding: M9b13k2LedgerBinding;
  }>
> {
  const root = await mkdtemp(join(tmpdir(), "lachesis-m9b13k2-ledger-"));
  temporaryRoots.push(root);
  const created = await createM9b13k2FilesystemLedger(
    join(root, "namespace"),
    activationIdentity,
    M9B13K2_RUNTIME_IMPLEMENTATION_IDENTITY,
  );
  if (!created.ok) throw new Error(created.error.reason);
  return { root, ...created.value };
}

function eventDraft(
  kind: M9b13k2LedgerEventDraft["kind"],
  overrides: Readonly<{
    method?: M9b13k2LedgerEventDraft["method"];
    outcome?: M9b13k2LedgerEventDraft["outcome"];
    requestClass?: M9b13k2LedgerEventDraft["requestClass"];
    requestIndex?: M9b13k2LedgerEventDraft["requestIndex"];
    responseDigest?: M9b13k2LedgerEventDraft["responseDigest"];
    responseStatus?: M9b13k2LedgerEventDraft["responseStatus"];
    urlDigest?: M9b13k2LedgerEventDraft["urlDigest"];
  }> = {},
): M9b13k2LedgerEventDraft {
  return {
    activationIdentity,
    runtimeIdentity: M9B13K2_RUNTIME_IMPLEMENTATION_IDENTITY,
    campaignIdentity,
    requestIdentity,
    kind,
    requestIndex: null,
    requestClass: null,
    method: null,
    urlDigest: null,
    host: null,
    pathClass: null,
    queryNames: [],
    projectId: M9B13K2_PROJECT_ID,
    draftId: M9B13K2_DRAFT_ID,
    provider: M9B13K2_PROVIDER,
    artifactIdentity: M9B13K2_ARTIFACT_IDENTITY,
    tokenId,
    responseStatus: null,
    responseDigest: null,
    receiptDigest: null,
    custodianIdentity: null,
    outcome: null,
    observedMonotonicMs: 1,
    deadlineMonotonicMs: null,
    ...overrides,
  };
}

async function append(
  ledger: M9b13k2FilesystemLedger,
  state: M9b13k2LedgerState,
  draft: M9b13k2LedgerEventDraft,
): Promise<M9b13k2LedgerState> {
  const result = await appendM9b13k2LedgerEvent(
    ledger,
    state.revision,
    state.headDigest,
    draft,
  );
  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
}

async function activationReserved(
  ledger: M9b13k2FilesystemLedger,
): Promise<M9b13k2LedgerState> {
  const initial = await snapshotM9b13k2FilesystemLedger(ledger);
  if (!initial.ok) throw new Error(initial.error.reason);
  return await append(ledger, initial.value, eventDraft("activation-reserved"));
}

async function waitForDatabaseRevision(
  databasePath: string,
  expectedRevision: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const parsed = z
        .object({ revision: z.number().int().nonnegative() })
        .safeParse(
          database
            .prepare("SELECT revision FROM ledger_state WHERE singleton = 1")
            .get(),
        );
      if (parsed.success && parsed.data.revision === expectedRevision) return;
    } finally {
      database.close();
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error("Timed out awaiting the child ledger commit boundary.");
}

describe("M9b.13k.2 private SQLite CAS ledger", () => {
  it("creates a 0700 namespace with 0600 database and anchor", async () => {
    const created = await newLedger();
    const paths = m9b13k2LedgerPathsForConformance(created.ledger);
    expect(paths.ok).toBe(true);
    if (!paths.ok) throw new Error(paths.error.reason);
    expect((await lstat(paths.value.namespacePath)).mode & 0o777).toBe(0o700);
    expect((await lstat(paths.value.databasePath)).mode & 0o777).toBe(0o600);
    expect((await lstat(paths.value.anchorPath)).mode & 0o777).toBe(0o600);
    expect(await auditM9b13k2FilesystemLedger(created.ledger)).toMatchObject({
      ok: true,
      value: {
        revision: 0,
        cumulativeHttpRequests: 0,
        putReservations: 0,
        putDispatches: 0,
        revocationReservations: 0,
        revocationDispatches: 0,
      },
    });
  });

  it("rejects nonabsolute namespaces, mode drift, and foreign sidecars", async () => {
    expect(
      await createM9b13k2FilesystemLedger(
        "relative-ledger-namespace",
        activationIdentity,
        M9B13K2_RUNTIME_IMPLEMENTATION_IDENTITY,
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-namespace-not-normalized-absolute" },
    });

    const modeDrift = await newLedger();
    const modePaths = m9b13k2LedgerPathsForConformance(modeDrift.ledger);
    if (!modePaths.ok) throw new Error(modePaths.error.reason);
    await chmod(modePaths.value.namespacePath, 0o755);
    expect(await auditM9b13k2FilesystemLedger(modeDrift.ledger)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-namespace-owner-or-mode-invalid" },
    });

    const sidecar = await newLedger();
    const sidecarPaths = m9b13k2LedgerPathsForConformance(sidecar.ledger);
    if (!sidecarPaths.ok) throw new Error(sidecarPaths.error.reason);
    await writeFile(`${sidecarPaths.value.databasePath}-foreign`, "synthetic", {
      mode: 0o600,
    });
    expect(await auditM9b13k2FilesystemLedger(sidecar.ledger)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-unknown-sidecar" },
    });

    const databaseMode = await newLedger();
    const databaseModePaths = m9b13k2LedgerPathsForConformance(
      databaseMode.ledger,
    );
    if (!databaseModePaths.ok) throw new Error(databaseModePaths.error.reason);
    await chmod(databaseModePaths.value.databasePath, 0o644);
    expect(
      await auditM9b13k2FilesystemLedger(databaseMode.ledger),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-database-owner-or-mode-invalid" },
    });

    const nonregular = await newLedger();
    const nonregularPaths = m9b13k2LedgerPathsForConformance(nonregular.ledger);
    if (!nonregularPaths.ok) throw new Error(nonregularPaths.error.reason);
    const movedDatabase = `${nonregularPaths.value.databasePath}.moved`;
    await rename(nonregularPaths.value.databasePath, movedDatabase);
    await mkdir(nonregularPaths.value.databasePath, { mode: 0o700 });
    expect(await auditM9b13k2FilesystemLedger(nonregular.ledger)).toMatchObject(
      {
        ok: false,
        error: { reason: "m9b13k2-ledger-database-not-regular" },
      },
    );

    const residual = await newLedger();
    const residualPaths = m9b13k2LedgerPathsForConformance(residual.ledger);
    if (!residualPaths.ok) throw new Error(residualPaths.error.reason);
    await writeFile(
      `${residualPaths.value.databasePath}-journal`,
      "synthetic",
      {
        mode: 0o600,
      },
    );
    expect(await auditM9b13k2FilesystemLedger(residual.ledger)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-residual-sidecar" },
    });

    const oversized = await newLedger();
    const oversizedPaths = m9b13k2LedgerPathsForConformance(oversized.ledger);
    if (!oversizedPaths.ok) throw new Error(oversizedPaths.error.reason);
    await truncate(oversizedPaths.value.databasePath, 17 * 1024 * 1024);
    expect(await auditM9b13k2FilesystemLedger(oversized.ledger)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-database-oversized" },
    });
  });

  it("rejects invalid creation/open bindings and existing namespaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "lachesis-m9b13k2-invalid-"));
    temporaryRoots.push(root);
    expect(
      await createM9b13k2FilesystemLedger(
        join(root, "bad-binding"),
        "invalid",
        M9B13K2_RUNTIME_IMPLEMENTATION_IDENTITY,
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-creation-binding-invalid" },
    });
    const created = await newLedger();
    expect(
      await createM9b13k2FilesystemLedger(
        join(created.root, "namespace"),
        activationIdentity,
        M9B13K2_RUNTIME_IMPLEMENTATION_IDENTITY,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await openM9b13k2FilesystemLedger(join(created.root, "namespace"), null),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-binding-invalid" },
    });
    const namespaceFile = join(root, "namespace-file");
    await writeFile(namespaceFile, "synthetic", { mode: 0o600 });
    expect(
      await openM9b13k2FilesystemLedger(namespaceFile, created.binding),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-namespace-not-private-directory" },
    });
    expect(
      await openM9b13k2FilesystemLedger(
        join(root, "missing-namespace"),
        created.binding,
      ),
    ).toMatchObject({ ok: false });
  });

  it("persists and reopens a canonical hash-chained activation", async () => {
    const created = await newLedger();
    const state = await activationReserved(created.ledger);
    expect(state.revision).toBe(1);
    expect(state.events[0]?.priorEventDigest).toBe(state.initialRoot);
    expect(state.events[0]?.eventDigest).toBe(state.headDigest);
    const reopened = await openM9b13k2FilesystemLedger(
      join(created.root, "namespace"),
      created.binding,
    );
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) throw new Error(reopened.error.reason);
    expect(await snapshotM9b13k2FilesystemLedger(reopened.value)).toEqual({
      ok: true,
      value: state,
    });
  });

  it("allows one winner for concurrent CAS from the same root", async () => {
    const created = await newLedger();
    const initial = await snapshotM9b13k2FilesystemLedger(created.ledger);
    if (!initial.ok) throw new Error(initial.error.reason);
    const results = await Promise.all([
      appendM9b13k2LedgerEvent(
        created.ledger,
        0,
        initial.value.headDigest,
        eventDraft("activation-reserved"),
      ),
      appendM9b13k2LedgerEvent(
        created.ledger,
        0,
        initial.value.headDigest,
        eventDraft("activation-reserved"),
      ),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(await auditM9b13k2FilesystemLedger(created.ledger)).toMatchObject({
      ok: true,
      value: { revision: 1 },
    });
  });

  it("persists cumulative request and at-most-once PUT accounting", async () => {
    const created = await newLedger();
    let state = await activationReserved(created.ledger);
    const urlDigest = "d".repeat(64);
    state = await append(
      created.ledger,
      state,
      eventDraft("request-reserved", {
        requestIndex: 1,
        requestClass: "upload",
        method: "PUT",
        urlDigest,
      }),
    );
    state = await append(
      created.ledger,
      state,
      eventDraft("request-dispatched", {
        requestIndex: 1,
        requestClass: "upload",
        method: "PUT",
        urlDigest,
      }),
    );
    state = await append(
      created.ledger,
      state,
      eventDraft("request-completed", {
        requestIndex: 1,
        requestClass: "upload",
        method: "PUT",
        urlDigest,
        responseStatus: 201,
        responseDigest: "e".repeat(64),
        outcome: "response",
      }),
    );
    expect(state).toMatchObject({
      cumulativeHttpRequests: 1,
      putReservations: 1,
      putDispatches: 1,
    });
    const second = await appendM9b13k2LedgerEvent(
      created.ledger,
      state.revision,
      state.headDigest,
      eventDraft("request-reserved", {
        requestIndex: 2,
        requestClass: "upload",
        method: "PUT",
        urlDigest,
      }),
    );
    expect(second).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-effect-budget-exceeded" },
    });
  });

  it("retains commit-before-anchor ambiguity and fails closed on restart", async () => {
    const created = await newLedger();
    const initial = await snapshotM9b13k2FilesystemLedger(created.ledger);
    if (!initial.ok) throw new Error(initial.error.reason);
    const result = await appendM9b13k2LedgerEvent(
      created.ledger,
      initial.value.revision,
      initial.value.headDigest,
      eventDraft("activation-reserved"),
      "after-database-commit-before-anchor",
    );
    expect(result).toMatchObject({
      ok: false,
      error: { ambiguous: true },
    });
    expect(await snapshotM9b13k2FilesystemLedger(created.ledger)).toMatchObject(
      {
        ok: false,
        error: {
          reason: "m9b13k2-ledger-anchor-state-mismatch",
          ambiguous: true,
        },
      },
    );
  });

  it("rolls back a fault before the database update without ambiguity", async () => {
    const created = await newLedger();
    const initial = await snapshotM9b13k2FilesystemLedger(created.ledger);
    if (!initial.ok) throw new Error(initial.error.reason);
    expect(
      await appendM9b13k2LedgerEvent(
        created.ledger,
        initial.value.revision,
        initial.value.headDigest,
        eventDraft("activation-reserved"),
        "before-database-update",
      ),
    ).toMatchObject({
      ok: false,
      error: {
        reason: "m9b13k2-ledger-injected-before-database-update",
        ambiguous: false,
      },
    });
    expect(await auditM9b13k2FilesystemLedger(created.ledger)).toMatchObject({
      ok: true,
      value: { revision: 0 },
    });
  });

  it("fails closed after a genuine SIGKILL between database commit and anchor", async () => {
    const created = await newLedger();
    const initial = await snapshotM9b13k2FilesystemLedger(created.ledger);
    const paths = m9b13k2LedgerPathsForConformance(created.ledger);
    if (!initial.ok || !paths.ok)
      throw new Error("Crash fixture could not inspect the fresh ledger.");
    const canonicalBinding = canonicalizeJson(created.binding);
    const canonicalDraft = canonicalizeJson(eventDraft("activation-reserved"));
    if (!canonicalBinding.ok || !canonicalDraft.ok)
      throw new Error("Crash fixture inputs were not canonical.");
    const ledgerUrl = pathToFileURL(
      join(
        process.cwd(),
        "packages/generator-ai-sdk/dist/internal/m9b13k2/ledger.js",
      ),
    ).href;
    const source = `
import { parseJson } from "@nicia-ai/lachesis";
const ledgerModule = await import(${JSON.stringify(ledgerUrl)});
const binding = parseJson(process.env.BINDING ?? "");
const draft = parseJson(process.env.DRAFT ?? "");
if (!binding.ok || !draft.ok) process.exit(2);
const opened = await ledgerModule.openM9b13k2FilesystemLedger(process.env.NAMESPACE ?? "", binding.value);
if (!opened.ok) process.exit(3);
await ledgerModule.appendM9b13k2LedgerEvent(opened.value, ${String(initial.value.revision)}, ${JSON.stringify(initial.value.headDigest)}, draft.value, "pause-after-database-commit-before-anchor");
process.exit(8);`;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      {
        cwd: join(process.cwd(), "packages/generator-ai-sdk"),
        env: {
          BINDING: canonicalBinding.value,
          DRAFT: canonicalDraft.value,
          NAMESPACE: join(created.root, "namespace"),
        },
        stdio: "ignore",
      },
    );
    await waitForDatabaseRevision(paths.value.databasePath, 1);
    expect(child.kill("SIGKILL")).toBe(true);
    const termination = await new Promise<
      Readonly<{ code: number | null; signal: NodeJS.Signals | null }>
    >((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolve({ code, signal });
      });
    });
    expect(termination).toEqual({ code: null, signal: "SIGKILL" });
    expect(await auditM9b13k2FilesystemLedger(created.ledger)).toMatchObject({
      ok: false,
      error: {
        reason: "m9b13k2-ledger-anchor-state-mismatch",
        ambiguous: true,
      },
    });
    expect(
      await openM9b13k2FilesystemLedger(
        join(created.root, "namespace"),
        created.binding,
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-anchor-state-mismatch" },
    });
  });

  it("detects rollback of the database beneath a newer anchor", async () => {
    const created = await newLedger();
    const paths = m9b13k2LedgerPathsForConformance(created.ledger);
    if (!paths.ok) throw new Error(paths.error.reason);
    const backup = join(created.root, "database-backup.sqlite");
    await copyFile(paths.value.databasePath, backup);
    await activationReserved(created.ledger);
    await copyFile(backup, paths.value.databasePath);
    expect(await snapshotM9b13k2FilesystemLedger(created.ledger)).toMatchObject(
      {
        ok: false,
        error: { reason: "m9b13k2-ledger-anchor-state-mismatch" },
      },
    );
  });

  it("detects truncation and self-consistent row replacement attempts", async () => {
    const created = await newLedger();
    await activationReserved(created.ledger);
    const paths = m9b13k2LedgerPathsForConformance(created.ledger);
    if (!paths.ok) throw new Error(paths.error.reason);
    const database = new DatabaseSync(paths.value.databasePath);
    try {
      database
        .prepare("UPDATE ledger_state SET state_json = ?, state_digest = ?")
        .run("{}", "f".repeat(64));
    } finally {
      database.close();
    }
    expect(await snapshotM9b13k2FilesystemLedger(created.ledger)).toMatchObject(
      {
        ok: false,
      },
    );
  });

  it("detects anchor schema, database binding, and database schema tampering", async () => {
    const anchor = await newLedger();
    const anchorPaths = m9b13k2LedgerPathsForConformance(anchor.ledger);
    if (!anchorPaths.ok) throw new Error(anchorPaths.error.reason);
    await writeFile(anchorPaths.value.anchorPath, "{}", { mode: 0o600 });
    expect(await snapshotM9b13k2FilesystemLedger(anchor.ledger)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-anchor-schema-invalid" },
    });

    const binding = await newLedger();
    const bindingPaths = m9b13k2LedgerPathsForConformance(binding.ledger);
    if (!bindingPaths.ok) throw new Error(bindingPaths.error.reason);
    const bindingDatabase = new DatabaseSync(bindingPaths.value.databasePath);
    try {
      bindingDatabase
        .prepare("UPDATE ledger_state SET protocol = ? WHERE singleton = 1")
        .run("synthetic-wrong-protocol");
    } finally {
      bindingDatabase.close();
    }
    expect(await snapshotM9b13k2FilesystemLedger(binding.ledger)).toMatchObject(
      {
        ok: false,
        error: { reason: "m9b13k2-ledger-database-binding-invalid" },
      },
    );

    const schema = await newLedger();
    const schemaPaths = m9b13k2LedgerPathsForConformance(schema.ledger);
    if (!schemaPaths.ok) throw new Error(schemaPaths.error.reason);
    const schemaDatabase = new DatabaseSync(schemaPaths.value.databasePath);
    try {
      schemaDatabase.exec("PRAGMA user_version = 2");
    } finally {
      schemaDatabase.close();
    }
    expect(await snapshotM9b13k2FilesystemLedger(schema.ledger)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-database-schema-invalid" },
    });

    const row = await newLedger();
    const rowPaths = m9b13k2LedgerPathsForConformance(row.ledger);
    if (!rowPaths.ok) throw new Error(rowPaths.error.reason);
    const rowDatabase = new DatabaseSync(rowPaths.value.databasePath);
    try {
      rowDatabase.exec("DELETE FROM ledger_state WHERE singleton = 1");
    } finally {
      rowDatabase.close();
    }
    expect(await snapshotM9b13k2FilesystemLedger(row.ledger)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-database-row-invalid" },
    });
  });

  it("rejects schema, chain, digest, and derived-counter state tampering", async () => {
    expect(validateM9b13k2LedgerState(null)).toMatchObject({ ok: false });
    const created = await newLedger();
    const state = await activationReserved(created.ledger);
    const event = state.events[0];
    if (event === undefined) throw new Error("Activation event missing.");
    expect(validateM9b13k2LedgerState({ ...state, revision: 0 })).toMatchObject(
      {
        ok: false,
        error: { reason: "m9b13k2-ledger-state-truncated" },
      },
    );
    expect(
      validateM9b13k2LedgerState({
        ...state,
        events: [{ ...event, sequence: 2 }],
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-event-chain-invalid" },
    });
    expect(
      validateM9b13k2LedgerState({
        ...state,
        headDigest: "f".repeat(64),
        events: [{ ...event, eventDigest: "f".repeat(64) }],
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-event-digest-invalid" },
    });
    expect(
      validateM9b13k2LedgerState({
        ...state,
        cumulativeHttpRequests: 1,
      }),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-derived-state-mismatch" },
    });
  });

  it("rejects illegal reservation, dispatch, completion, and terminal transitions", async () => {
    const wrongRevocation = await newLedger();
    let state = await activationReserved(wrongRevocation.ledger);
    expect(
      await appendM9b13k2LedgerEvent(
        wrongRevocation.ledger,
        state.revision,
        state.headDigest,
        eventDraft("revocation-reserved", {
          requestIndex: 1,
          requestClass: "project-detail",
          method: "GET",
          urlDigest: "d".repeat(64),
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-revocation-reservation-invalid" },
    });

    const noReservation = await newLedger();
    state = await activationReserved(noReservation.ledger);
    expect(
      await appendM9b13k2LedgerEvent(
        noReservation.ledger,
        state.revision,
        state.headDigest,
        eventDraft("request-dispatched", {
          requestIndex: 1,
          requestClass: "download",
          method: "GET",
          urlDigest: "d".repeat(64),
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-request-dispatch-invalid" },
    });

    const noDispatch = await newLedger();
    state = await activationReserved(noDispatch.ledger);
    state = await append(
      noDispatch.ledger,
      state,
      eventDraft("request-reserved", {
        requestIndex: 1,
        requestClass: "download",
        method: "GET",
        urlDigest: "d".repeat(64),
      }),
    );
    expect(
      await appendM9b13k2LedgerEvent(
        noDispatch.ledger,
        state.revision,
        state.headDigest,
        eventDraft("request-completed", {
          requestIndex: 1,
          requestClass: "download",
          method: "GET",
          urlDigest: "d".repeat(64),
          outcome: "response",
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-request-completion-invalid" },
    });

    const duplicateTerminal = await newLedger();
    state = await activationReserved(duplicateTerminal.ledger);
    state = await append(
      duplicateTerminal.ledger,
      state,
      eventDraft("terminal", { outcome: "synthetic-terminal" }),
    );
    expect(
      await appendM9b13k2LedgerEvent(
        duplicateTerminal.ledger,
        state.revision,
        state.headDigest,
        eventDraft("terminal", { outcome: "synthetic-terminal" }),
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-duplicate-terminal" },
    });
  });

  it("rejects an invalid draft and a deterministically stale CAS", async () => {
    const created = await newLedger();
    const initial = await snapshotM9b13k2FilesystemLedger(created.ledger);
    if (!initial.ok) throw new Error(initial.error.reason);
    expect(
      await appendM9b13k2LedgerEvent(
        created.ledger,
        initial.value.revision,
        initial.value.headDigest,
        {
          ...eventDraft("activation-reserved"),
          observedMonotonicMs: Number.NaN,
        },
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-event-draft-invalid" },
    });
    await activationReserved(created.ledger);
    expect(
      await appendM9b13k2LedgerEvent(
        created.ledger,
        initial.value.revision,
        initial.value.headDigest,
        eventDraft("activation-reserved"),
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k2-ledger-cas-conflict" },
    });
  });

  it("rejects cross-namespace replay even with a valid foreign binding", async () => {
    const first = await newLedger();
    const second = await newLedger();
    const replay = await openM9b13k2FilesystemLedger(
      join(second.root, "namespace"),
      first.binding,
    );
    expect(replay).toMatchObject({ ok: false });
  });

  it("marks every durable restart state as ineligible for credential reacquisition", async () => {
    const created = await newLedger();
    const initial = await snapshotM9b13k2FilesystemLedger(created.ledger);
    if (!initial.ok) throw new Error(initial.error.reason);
    expect(inspectM9b13k2RestartState(initial.value)).toMatchObject({
      state: "fresh-ledger-awaiting-unavailable-activation",
      credentialReadPermitted: false,
    });
    const activated = await activationReserved(created.ledger);
    expect(inspectM9b13k2RestartState(activated)).toMatchObject({
      state: "prior-activation-or-effect-state",
      credentialReadPermitted: false,
      secondPutPermitted: false,
      secondRevocationPermitted: false,
      requestCounterResetPermitted: false,
    });
    const reserved = await append(
      created.ledger,
      activated,
      eventDraft("request-reserved", {
        requestIndex: 1,
        requestClass: "download",
        method: "GET",
        urlDigest: "d".repeat(64),
      }),
    );
    expect(inspectM9b13k2RestartState(reserved).state).toBe("ambiguous-state");
  });

  it("produces one winner across two genuine Node processes", async () => {
    const created = await newLedger();
    const ledgerUrl = pathToFileURL(
      join(
        process.cwd(),
        "packages/generator-ai-sdk/dist/internal/m9b13k2/ledger.js",
      ),
    ).href;
    const canonicalBinding = canonicalizeJson(created.binding);
    const canonicalDraft = canonicalizeJson(eventDraft("activation-reserved"));
    if (!canonicalBinding.ok || !canonicalDraft.ok)
      throw new Error("Synthetic child input was not canonical.");
    const source = `
import { parseJson } from "@nicia-ai/lachesis";
const ledgerModule = await import(${JSON.stringify(ledgerUrl)});
const binding = parseJson(process.env.BINDING ?? "");
const draft = parseJson(process.env.DRAFT ?? "");
if (!binding.ok || !draft.ok) process.exit(2);
const opened = await ledgerModule.openM9b13k2FilesystemLedger(process.env.NAMESPACE ?? "", binding.value);
if (!opened.ok) process.exit(3);
const state = await ledgerModule.snapshotM9b13k2FilesystemLedger(opened.value);
if (!state.ok) process.exit(4);
const result = await ledgerModule.appendM9b13k2LedgerEvent(opened.value, state.value.revision, state.value.headDigest, draft.value);
process.exit(result.ok ? 0 : 9);`;
    const run = async (): Promise<
      Readonly<{ code: number | null; stderr: string }>
    > => {
      const child = spawn(
        process.execPath,
        ["--experimental-strip-types", "--input-type=module", "-e", source],
        {
          cwd: join(process.cwd(), "packages/generator-ai-sdk"),
          env: {
            BINDING: canonicalBinding.value,
            DRAFT: canonicalDraft.value,
            NAMESPACE: join(created.root, "namespace"),
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      return { code, stderr };
    };
    const results = await Promise.all([run(), run()]);
    if (results.every((result) => result.code !== 0))
      throw new Error(
        `Both ledger contenders failed: ${results
          .map((result) => `${String(result.code)}:${result.stderr}`)
          .join(" | ")}`,
      );
    expect(results.filter((result) => result.code === 0)).toHaveLength(1);
    expect(results.filter((result) => result.code !== 0)).toHaveLength(1);
    expect(await auditM9b13k2FilesystemLedger(created.ledger)).toMatchObject({
      ok: true,
      value: { revision: 1 },
    });
  });
});
