import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appendM9b13k4aLedger,
  auditM9b13k4aLedger,
  buildM9b13k4aHelper,
  createM9b13k4aLedger,
  inspectMalformedM9b13k4aHelperOutput,
  launchBarrierM9b13k4aAppend,
  launchBarrierM9b13k4aInspect,
  type M9b13k4aBuiltHelper,
  snapshotM9b13k4aLedger,
} from "../src/internal/m9b13k4a/ledger.js";
import {
  canonicalM9b13k4aPayload,
  deriveM9b13k4aImplementationIdentity,
  M9B13K4A_IMPLEMENTATION_PROTOCOL,
} from "../src/internal/m9b13k4a/protocol.js";

const SOURCE = `${process.cwd()}/packages/generator-ai-sdk/src/internal/m9b13k4a/native/m9b13k4a-ledger.c`;
const HELPER_LEAF = "m9b13k4a-ledger-helper";
let root = "";
let built: M9b13k4aBuiltHelper;
let helperPath = "";
let namespaceIndex = 0;

function namespace(): string {
  namespaceIndex += 1;
  return `${root}/namespace-${namespaceIndex}`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function rewriteHeaderCrc(bytes: Buffer): void {
  bytes.writeUInt32LE(crc32(bytes.subarray(0, 60)), 60);
}

beforeAll(() => {
  root = mkdtempSync("/private/tmp/m9b13k4a-tests.");
  const buildDirectory = `${root}/primary-build`;
  helperPath = `${buildDirectory}/${HELPER_LEAF}`;
  const result = buildM9b13k4aHelper(SOURCE, buildDirectory);
  if (!result.ok) throw new Error(result.error.reason);
  built = result.value;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("M9b.13k.4 descriptor-pinned native ledger", () => {
  it("normalizes two independent native builds to identical bytes", () => {
    const secondDirectory = `${root}/second-build`;
    const secondPath = `${secondDirectory}/${HELPER_LEAF}`;
    const second = buildM9b13k4aHelper(SOURCE, secondDirectory);
    if (!second.ok) throw new Error(second.error.reason);
    expect(second.value.identity.executableSha256).toBe(
      built.identity.executableSha256,
    );
    expect(readFileSync(secondPath)).toEqual(readFileSync(helperPath));
    expect(built.identity).toMatchObject({
      protocol: "lachesis-m9b13k4a-native-helper-reproducible-build/2",
      targetArchitecture: "arm64",
      flags: ["clang", "-std=c17", "-Os", "-Wall", "-Wextra", "-Werror"],
      normalization: "remove-signature-patch-source-bound-lc-uuid-adhoc-resign",
    });
    expect(built.identity.linkedLibraries).toEqual([
      expect.stringContaining("/usr/lib/libSystem.B.dylib"),
    ]);
  });

  it("binds implementation identity to exact native and caller bytes", () => {
    const inventory = {
      protocol: M9B13K4A_IMPLEMENTATION_PROTOCOL,
      entries: [
        {
          kind: "native-source" as const,
          path: "native/helper.c",
          byteLength: 10,
          sha256: "a".repeat(64),
        },
        {
          kind: "typescript-source" as const,
          path: "src/ledger.ts",
          byteLength: 20,
          sha256: "b".repeat(64),
        },
      ],
    };
    const first = deriveM9b13k4aImplementationIdentity(inventory);
    const reordered = deriveM9b13k4aImplementationIdentity({
      ...inventory,
      entries: inventory.entries.toReversed(),
    });
    const mutated = deriveM9b13k4aImplementationIdentity({
      ...inventory,
      entries: [{ ...inventory.entries[0], sha256: "c".repeat(64) }],
    });
    if (!first.ok || !reordered.ok || !mutated.ok)
      throw new Error("identity-derivation-failed");
    expect(reordered.value.identity).toBe(first.value.identity);
    expect(mutated.value.identity).not.toBe(first.value.identity);
    expect(
      deriveM9b13k4aImplementationIdentity({
        ...inventory,
        entries: [inventory.entries[0], inventory.entries[0]],
      }),
    ).toMatchObject({ ok: false });
    expect(deriveM9b13k4aImplementationIdentity({ entries: [] })).toMatchObject(
      {
        ok: false,
        error: { reason: "m9b13k4a-implementation-inventory-invalid" },
      },
    );
  });

  it("creates, snapshots, appends, audits, and reopens across processes", async () => {
    const path = namespace();
    const created = await createM9b13k4aLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    expect(created.value).toMatchObject({ sequence: 0, operation: "create" });
    const snapshot = await snapshotM9b13k4aLedger(built.helper, path);
    expect(snapshot).toMatchObject({
      ok: true,
      value: {
        sequence: 0,
        root: created.value.root,
        sessionIdentity: created.value.sessionIdentity,
      },
    });
    const appended = await appendM9b13k4aLedger(
      built.helper,
      path,
      created.value,
      '{"kind":"synthetic-ledger-payload","value":1}',
    );
    if (!appended.ok) throw new Error(appended.error.reason);
    expect(appended.value.sequence).toBe(1);
    expect(
      await auditM9b13k4aLedger(built.helper, path, appended.value),
    ).toMatchObject({
      ok: true,
      value: { sequence: 1, root: appended.value.root },
    });
    const second = await appendM9b13k4aLedger(
      built.helper,
      path,
      appended.value,
      '{"process":"B","reopened":true}',
    );
    expect(second).toMatchObject({ ok: true, value: { sequence: 2 } });
  });

  it("rejects duplicate keys before parsing and preserves hostile own keys", () => {
    expect(canonicalM9b13k4aPayload('{"a":1,"a":2}')).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4a-json-duplicate-object-key" },
    });
    expect(canonicalM9b13k4aPayload('{"a":1,"\\u0061":2}')).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4a-json-duplicate-object-key" },
    });
    const hostile = canonicalM9b13k4aPayload(
      '{"constructor":{"prototype":1},"__proto__":{"polluted":true}}',
    );
    if (!hostile.ok) throw new Error(hostile.error.reason);
    expect(new TextDecoder().decode(hostile.value)).toBe(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":1}}',
    );
    expect(canonicalM9b13k4aPayload(`"${"x".repeat(65_537)}"`)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4a-payload-oversized" },
    });
  });

  it("strictly scans every JSON structure and escape class", () => {
    for (const valid of [
      "[]",
      "{}",
      "[true,false,null,-1,2.5,3e2]",
      '"\\"\\\\\\/\\b\\f\\n\\r\\t"',
      '"\\uD83D\\uDE00"',
    ])
      expect(canonicalM9b13k4aPayload(valid)).toMatchObject({ ok: true });
    for (const invalid of [
      "",
      "x",
      "true false",
      '{"a" 1}',
      '{"a":1 "b":2}',
      "[1 2]",
      '{"a":"\\q"}',
      '{"a":"\\uZZZZ"}',
      '{"a":"\\uD800x"}',
      '{"a":"\\uD800\\u0041"}',
      '{"a":"\\uDC00"}',
      '{"a":"unterminated}',
      '{"a":"\n"}',
      "\u00a0true",
    ])
      expect(canonicalM9b13k4aPayload(invalid)).toMatchObject({ ok: false });
  });

  it("rejects forged, missing, mode-changed, and unbuildable helpers", async () => {
    expect(
      await createM9b13k4aLedger(Object.freeze({}), namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4a-helper-capability-invalid" },
    });
    expect(
      buildM9b13k4aHelper(`${root}/missing-source.c`, `${root}/missing-output`),
    ).toMatchObject({ ok: false });

    const modeDirectory = `${root}/mode-build`;
    const modePath = `${modeDirectory}/${HELPER_LEAF}`;
    const modeHelper = buildM9b13k4aHelper(SOURCE, modeDirectory);
    if (!modeHelper.ok) throw new Error(modeHelper.error.reason);
    chmodSync(modePath, 0o755);
    expect(
      await createM9b13k4aLedger(modeHelper.value.helper, namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4a-helper-metadata-rejected" },
    });

    const missingDirectory = `${root}/missing-build`;
    const missingPath = `${missingDirectory}/${HELPER_LEAF}`;
    const missingHelper = buildM9b13k4aHelper(SOURCE, missingDirectory);
    if (!missingHelper.ok) throw new Error(missingHelper.error.reason);
    rmSync(missingPath);
    expect(
      await createM9b13k4aLedger(missingHelper.value.helper, namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4a-helper-unreadable" },
    });
  });

  it("rejects namespace aliases, symlinks, modes, and log hardlinks", async () => {
    const privateParent = `${root}/private-parent`;
    mkdirSync(privateParent, { mode: 0o700 });
    const ancestorAlias = `${root}/ancestor-alias`;
    symlinkSync(privateParent, ancestorAlias);
    expect(
      await createM9b13k4aLedger(built.helper, `${ancestorAlias}/ledger`),
    ).toMatchObject({ ok: false });

    const leafTarget = `${root}/leaf-target`;
    mkdirSync(leafTarget, { mode: 0o700 });
    const leafAlias = `${root}/leaf-alias`;
    symlinkSync(leafTarget, leafAlias);
    expect(await snapshotM9b13k4aLedger(built.helper, leafAlias)).toMatchObject(
      {
        ok: false,
      },
    );

    const normalizedAlias = `${root}/./normalized-alias`;
    expect(
      await createM9b13k4aLedger(built.helper, normalizedAlias),
    ).toMatchObject({
      ok: false,
    });

    const wrongMode = `${root}/wrong-mode`;
    mkdirSync(wrongMode, { mode: 0o755 });
    expect(await snapshotM9b13k4aLedger(built.helper, wrongMode)).toMatchObject(
      {
        ok: false,
      },
    );

    const path = namespace();
    const created = await createM9b13k4aLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    linkSync(`${path}/ledger.log`, `${path}/second-name`);
    expect(await auditM9b13k4aLedger(built.helper, path)).toMatchObject({
      ok: false,
    });
  });

  it("rejects the complete unsafe-ancestor matrix and post-admission mode changes", async () => {
    for (const mode of [0o777, 0o770, 0o720, 0o702, 0o1777]) {
      const parent = `${root}/unsafe-${mode.toString(8)}`;
      mkdirSync(parent, { mode: 0o700 });
      chmodSync(parent, mode);
      expect(
        await createM9b13k4aLedger(built.helper, `${parent}/ledger`),
      ).toMatchObject({ ok: false });
    }

    const approved = await createM9b13k4aLedger(built.helper, namespace());
    expect(approved).toMatchObject({ ok: true });

    const admittedParent = `${root}/admitted-parent`;
    mkdirSync(admittedParent, { mode: 0o700 });
    const path = `${admittedParent}/ledger`;
    const created = await createM9b13k4aLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    const launched = launchBarrierM9b13k4aInspect(
      built.helper,
      path,
      "snapshot",
    );
    if (!launched.ok) throw new Error(launched.error.reason);
    expect(await launched.value.ready).toMatchObject({ ok: true });
    chmodSync(admittedParent, 0o770);
    launched.value.release();
    expect(await launched.value.completed).toMatchObject({ ok: false });
    chmodSync(admittedParent, 0o700);
  });

  it.each(["snapshot", "audit"] as const)(
    "security-stops %s after authoritative log pathname replacement",
    async (operation) => {
      const path = namespace();
      const created = await createM9b13k4aLedger(built.helper, path);
      if (!created.ok) throw new Error(created.error.reason);
      const launched = launchBarrierM9b13k4aInspect(
        built.helper,
        path,
        operation,
      );
      if (!launched.ok) throw new Error(launched.error.reason);
      expect(await launched.value.ready).toMatchObject({ ok: true });
      renameSync(`${path}/ledger.log`, `${path}/ledger.retained`);
      copyFileSync(`${path}/ledger.retained`, `${path}/ledger.log`);
      chmodSync(`${path}/ledger.log`, 0o600);
      launched.value.release();
      expect(await launched.value.completed).toMatchObject({
        ok: false,
        error: {
          reason: "m9b13k4a-helper-post-inspect-identity-ambiguous",
          ambiguous: true,
        },
      });
    },
  );

  it("rejects every reserved header byte even with a recomputed CRC", async () => {
    for (const offsets of [
      ...Array.from({ length: 12 }, (_, index) => [48 + index]),
      [48, 53, 59],
    ]) {
      const path = namespace();
      const created = await createM9b13k4aLedger(built.helper, path);
      if (!created.ok) throw new Error(created.error.reason);
      const logPath = `${path}/ledger.log`;
      const mutated = Buffer.from(readFileSync(logPath));
      for (const offset of offsets) mutated[offset] = 0xa5;
      rewriteHeaderCrc(mutated);
      writeFileSync(logPath, mutated);
      expect(await snapshotM9b13k4aLedger(built.helper, path)).toMatchObject({
        ok: false,
      });
      expect(await auditM9b13k4aLedger(built.helper, path)).toMatchObject({
        ok: false,
      });
      expect(
        await appendM9b13k4aLedger(
          built.helper,
          path,
          created.value,
          '{"reserved":"rejected"}',
        ),
      ).toMatchObject({ ok: false });
    }
  });

  it("admits the complete helper path and rejects aliases, links, and replacements", async () => {
    expect(
      buildM9b13k4aHelper(
        SOURCE,
        "/private/var/run/m9b13k4a-root-writable-build",
      ),
    ).toMatchObject({ ok: false });
    expect(
      buildM9b13k4aHelper(
        SOURCE,
        "/Users/Shared/m9b13k4a-unexpected-sticky-build",
      ),
    ).toMatchObject({ ok: false });
    for (const mode of [0o777, 0o770, 0o720, 0o702, 0o1777]) {
      const parent = `${root}/helper-unsafe-${mode.toString(8)}`;
      mkdirSync(parent, { mode: 0o700 });
      chmodSync(parent, mode);
      expect(
        buildM9b13k4aHelper(SOURCE, `${parent}/fresh-build`),
      ).toMatchObject({ ok: false });
    }

    const target = `${root}/helper-alias-target`;
    mkdirSync(target, { mode: 0o700 });
    const alias = `${root}/helper-alias`;
    symlinkSync(target, alias);
    expect(buildM9b13k4aHelper(SOURCE, `${alias}/fresh-build`)).toMatchObject({
      ok: false,
    });

    const preexisting = `${root}/preexisting-build`;
    mkdirSync(preexisting, { mode: 0o700 });
    expect(buildM9b13k4aHelper(SOURCE, preexisting)).toMatchObject({
      ok: false,
    });
    const leafAlias = `${root}/leaf-build-alias`;
    symlinkSync(target, leafAlias);
    expect(buildM9b13k4aHelper(SOURCE, leafAlias)).toMatchObject({ ok: false });

    const linkedDirectory = `${root}/linked-build`;
    const linkedPath = `${linkedDirectory}/${HELPER_LEAF}`;
    const linked = buildM9b13k4aHelper(SOURCE, linkedDirectory);
    if (!linked.ok) throw new Error(linked.error.reason);
    linkSync(linkedPath, `${linkedDirectory}/second-name`);
    expect(
      await createM9b13k4aLedger(linked.value.helper, namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4a-helper-metadata-rejected" },
    });

    const replacedDirectory = `${root}/replaced-build`;
    const replacedPath = `${replacedDirectory}/${HELPER_LEAF}`;
    const replaced = buildM9b13k4aHelper(SOURCE, replacedDirectory);
    if (!replaced.ok) throw new Error(replaced.error.reason);
    renameSync(replacedDirectory, `${replacedDirectory}-retained`);
    mkdirSync(replacedDirectory, { mode: 0o700 });
    copyFileSync(`${replacedDirectory}-retained/${HELPER_LEAF}`, replacedPath);
    chmodSync(replacedPath, 0o700);
    expect(
      await createM9b13k4aLedger(replaced.value.helper, namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4a-helper-path-replaced" },
    });
  });

  it("retries genuine harmless-signal EINTR without duplicate appends", async () => {
    for (const eintrPoint of [
      "read",
      "pread",
      "flock",
      "record-header-write",
      "record-payload-write",
      "record-footer-write",
      "fsync",
      "response-write",
    ]) {
      const path = namespace();
      const created = await createM9b13k4aLedger(built.helper, path);
      if (!created.ok) throw new Error(created.error.reason);
      const appended = await appendM9b13k4aLedger(
        built.helper,
        path,
        created.value,
        `{"eintr":"${eintrPoint}"}`,
        { eintrPoint },
      );
      expect(appended).toMatchObject({ ok: true, value: { sequence: 1 } });
      expect(await auditM9b13k4aLedger(built.helper, path)).toMatchObject({
        ok: true,
        value: { sequence: 1 },
      });
    }

    for (const operation of ["snapshot", "audit"] as const) {
      const path = namespace();
      const created = await createM9b13k4aLedger(built.helper, path);
      if (!created.ok) throw new Error(created.error.reason);
      const result =
        operation === "snapshot"
          ? await snapshotM9b13k4aLedger(built.helper, path, {
              eintrPoint: "pread",
            })
          : await auditM9b13k4aLedger(built.helper, path, undefined, {
              eintrPoint: "pread",
            });
      expect(result).toMatchObject({ ok: true, value: { sequence: 0 } });
    }

    for (const eintrPoint of ["barrier-write", "barrier-read"]) {
      const path = namespace();
      const created = await createM9b13k4aLedger(built.helper, path);
      if (!created.ok) throw new Error(created.error.reason);
      const launched = launchBarrierM9b13k4aInspect(
        built.helper,
        path,
        "snapshot",
        { eintrPoint },
      );
      if (!launched.ok) throw new Error(launched.error.reason);
      expect(await launched.value.ready).toMatchObject({ ok: true });
      launched.value.release();
      expect(await launched.value.completed).toMatchObject({ ok: true });
    }
  });

  it("detects namespace swap, mode change, and retained-log replacement", async () => {
    for (const attack of [
      "namespace-swap",
      "namespace-mode",
      "log-replacement",
    ] as const) {
      const path = namespace();
      const created = await createM9b13k4aLedger(built.helper, path);
      if (!created.ok) throw new Error(created.error.reason);
      const launched = launchBarrierM9b13k4aAppend(
        built.helper,
        path,
        created.value,
        `{"attack":"${attack}"}`,
      );
      if (!launched.ok) throw new Error(launched.error.reason);
      expect(await launched.value.ready).toMatchObject({ ok: true });
      if (attack === "namespace-swap") {
        renameSync(path, `${path}-admitted`);
        mkdirSync(path, { mode: 0o700 });
        copyFileSync(`${path}-admitted/ledger.log`, `${path}/ledger.log`);
        chmodSync(`${path}/ledger.log`, 0o600);
      } else if (attack === "log-replacement") {
        renameSync(`${path}/ledger.log`, `${path}/ledger-admitted.log`);
        copyFileSync(`${path}/ledger-admitted.log`, `${path}/ledger.log`);
        chmodSync(`${path}/ledger.log`, 0o600);
      } else {
        chmodSync(path, 0o755);
      }
      launched.value.release();
      expect(await launched.value.completed).toMatchObject({ ok: false });
    }
  });

  it("detects parent rename and permits only one concurrent namespace creator", async () => {
    const parent = `${root}/campaign-parent`;
    mkdirSync(parent, { mode: 0o700 });
    const path = `${parent}/ledger`;
    const created = await createM9b13k4aLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    const launched = launchBarrierM9b13k4aAppend(
      built.helper,
      path,
      created.value,
      '{"attack":"parent-rename"}',
    );
    if (!launched.ok) throw new Error(launched.error.reason);
    expect(await launched.value.ready).toMatchObject({ ok: true });
    renameSync(parent, `${parent}-admitted`);
    mkdirSync(parent, { mode: 0o700 });
    launched.value.release();
    expect(await launched.value.completed).toMatchObject({ ok: false });

    const concurrent = namespace();
    const results = await Promise.all([
      createM9b13k4aLedger(built.helper, concurrent),
      createM9b13k4aLedger(built.helper, concurrent),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
  });

  it("proves one-winner stale-root CAS in 100 genuine two-process barriers", async () => {
    const path = namespace();
    const created = await createM9b13k4aLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    let current = created.value;
    for (let iteration = 0; iteration < 100; iteration++) {
      const left = launchBarrierM9b13k4aAppend(
        built.helper,
        path,
        current,
        `{"iteration":${iteration},"side":"left"}`,
      );
      const right = launchBarrierM9b13k4aAppend(
        built.helper,
        path,
        current,
        `{"iteration":${iteration},"side":"right"}`,
      );
      if (!left.ok || !right.ok) throw new Error("race-launch-failed");
      expect(await Promise.all([left.value.ready, right.value.ready])).toEqual([
        { ok: true, value: undefined },
        { ok: true, value: undefined },
      ]);
      left.value.release();
      right.value.release();
      const results = await Promise.all([
        left.value.completed,
        right.value.completed,
      ]);
      const winners = results.filter((result) => result.ok);
      const losers = results.filter((result) => !result.ok);
      expect(winners).toHaveLength(1);
      expect(losers).toMatchObject([
        { error: { reason: "m9b13k4a-helper-stale-cas", ambiguous: false } },
      ]);
      const winner = winners[0];
      if (winner?.ok !== true) throw new Error("race-winner-absent");
      current = winner.value;
    }
    expect(current.sequence).toBe(100);
    expect(
      await auditM9b13k4aLedger(built.helper, path, current),
    ).toMatchObject({
      ok: true,
    });
  }, 30_000);

  it.each([
    ["before-lock", "unchanged"],
    ["after-lock", "unchanged"],
    ["after-validation", "unchanged"],
    ["before-header", "unchanged"],
    ["during-header", "security-stop"],
    ["during-payload", "security-stop"],
    ["before-footer", "security-stop"],
    ["after-record-before-sync", "committed"],
    ["after-file-sync", "committed"],
    ["before-directory-sync", "committed"],
    ["after-directory-sync", "committed"],
    ["after-return", "committed"],
  ] as const)("is crash-conservative at %s", async (crashPoint, expected) => {
    const path = namespace();
    const created = await createM9b13k4aLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    expect(
      await appendM9b13k4aLedger(
        built.helper,
        path,
        created.value,
        '{"crash":"matrix","padding":"abcdefghijk"}',
        { crashPoint },
      ),
    ).toMatchObject({ ok: false, error: { ambiguous: true } });
    const audit = await auditM9b13k4aLedger(built.helper, path);
    expect(audit).toMatchObject(
      expected === "security-stop"
        ? { ok: false }
        : {
            ok: true,
            value: { sequence: expected === "committed" ? 1 : 0 },
          },
    );
  });

  it("rejects every torn boundary, rollback, truncation, garbage, and chain damage", async () => {
    const path = namespace();
    const created = await createM9b13k4aLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    const appended = await appendM9b13k4aLedger(
      built.helper,
      path,
      created.value,
      '{"framing":"boundary-payload"}',
    );
    if (!appended.ok) throw new Error(appended.error.reason);
    const logPath = `${path}/ledger.log`;
    const complete = readFileSync(logPath);
    const recordLength = complete.byteLength - 64;
    const cuts = new Set<number>();
    for (let offset = 0; offset <= 56; offset++) cuts.add(64 + offset);
    for (let offset = recordLength - 40; offset < recordLength; offset++)
      cuts.add(64 + offset);
    for (const cut of cuts) {
      writeFileSync(logPath, complete.subarray(0, cut));
      expect(
        await auditM9b13k4aLedger(built.helper, path, appended.value),
      ).toMatchObject({ ok: false });
    }
    writeFileSync(logPath, complete.subarray(0, 64));
    expect(
      await auditM9b13k4aLedger(built.helper, path, appended.value),
    ).toMatchObject({
      ok: false,
      error: {
        reason: "m9b13k4a-audit-expected-state-mismatch",
        ambiguous: true,
      },
    });
    writeFileSync(logPath, complete);
    truncateSync(logPath, complete.byteLength - 1);
    expect(await auditM9b13k4aLedger(built.helper, path)).toMatchObject({
      ok: false,
    });
    writeFileSync(logPath, Buffer.concat([complete, Buffer.from("garbage")]));
    expect(await auditM9b13k4aLedger(built.helper, path)).toMatchObject({
      ok: false,
    });
    for (const damageOffset of [64 + 16, 64 + 24]) {
      const damaged = Buffer.from(complete);
      const original = damaged[damageOffset];
      if (original === undefined) throw new Error("damage-offset-invalid");
      damaged[damageOffset] = original ^ 0x01;
      writeFileSync(logPath, damaged);
      expect(await auditM9b13k4aLedger(built.helper, path)).toMatchObject({
        ok: false,
      });
    }
  });

  it("rejects malformed output, timeout, pre-invocation substitution, and running replacement", async () => {
    const path = namespace();
    const created = await createM9b13k4aLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    expect(
      await inspectMalformedM9b13k4aHelperOutput(built.helper, path),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4a-helper-output-invalid" },
    });
    const timeout = launchBarrierM9b13k4aAppend(
      built.helper,
      path,
      created.value,
      '{"timeout":true}',
      50,
    );
    if (!timeout.ok) throw new Error(timeout.error.reason);
    expect(await timeout.value.ready).toMatchObject({ ok: true });
    expect(await timeout.value.completed).toMatchObject({
      ok: false,
      error: { kind: "timeout", reason: "m9b13k4a-helper-timeout" },
    });

    const substituteDirectory = `${root}/substitution-build`;
    const substitutePath = `${substituteDirectory}/${HELPER_LEAF}`;
    const substitute = buildM9b13k4aHelper(SOURCE, substituteDirectory);
    if (!substitute.ok) throw new Error(substitute.error.reason);
    renameSync(substitutePath, `${substitutePath}-original`);
    copyFileSync(`${substitutePath}-original`, substitutePath);
    chmodSync(substitutePath, 0o700);
    expect(
      await createM9b13k4aLedger(substitute.value.helper, namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4a-helper-hash-mismatch" },
    });

    const runningDirectory = `${root}/running-build`;
    const runningPath = `${runningDirectory}/${HELPER_LEAF}`;
    const running = buildM9b13k4aHelper(SOURCE, runningDirectory);
    if (!running.ok) throw new Error(running.error.reason);
    const runningNamespace = namespace();
    const runningCreated = await createM9b13k4aLedger(
      running.value.helper,
      runningNamespace,
    );
    if (!runningCreated.ok) throw new Error(runningCreated.error.reason);
    const launched = launchBarrierM9b13k4aAppend(
      running.value.helper,
      runningNamespace,
      runningCreated.value,
      '{"replacement":"running"}',
    );
    if (!launched.ok) throw new Error(launched.error.reason);
    expect(await launched.value.ready).toMatchObject({ ok: true });
    renameSync(runningDirectory, `${runningDirectory}-original`);
    mkdirSync(runningDirectory, { mode: 0o700 });
    copyFileSync(`${runningDirectory}-original/${HELPER_LEAF}`, runningPath);
    chmodSync(runningPath, 0o700);
    launched.value.release();
    expect(await launched.value.completed).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4a-helper-replaced-during-run", ambiguous: true },
    });
  });

  it("zero-effect replay cannot append from an older root", async () => {
    const path = namespace();
    const created = await createM9b13k4aLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    expect(
      await appendM9b13k4aLedger(
        built.helper,
        path,
        created.value,
        '{"duplicate":1,"duplicate":2}',
      ),
    ).toMatchObject({ ok: false });
    const first = await appendM9b13k4aLedger(
      built.helper,
      path,
      created.value,
      '{"effect":"synthetic-only","index":1}',
    );
    if (!first.ok) throw new Error(first.error.reason);
    const bytesBefore = createHash("sha256")
      .update(readFileSync(`${path}/ledger.log`))
      .digest("hex");
    expect(
      await appendM9b13k4aLedger(
        built.helper,
        path,
        created.value,
        '{"effect":"synthetic-only","index":1}',
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4a-helper-stale-cas", ambiguous: false },
    });
    expect(
      createHash("sha256")
        .update(readFileSync(`${path}/ledger.log`))
        .digest("hex"),
    ).toBe(bytesBefore);
  });
});
