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
  appendM9b13k4Ledger,
  auditM9b13k4Ledger,
  buildM9b13k4Helper,
  createM9b13k4Ledger,
  inspectMalformedM9b13k4HelperOutput,
  launchBarrierM9b13k4Append,
  type M9b13k4BuiltHelper,
  snapshotM9b13k4Ledger,
} from "../src/internal/m9b13k4/ledger.js";
import {
  canonicalM9b13k4Payload,
  deriveM9b13k4ImplementationIdentity,
  M9B13K4_IMPLEMENTATION_PROTOCOL,
} from "../src/internal/m9b13k4/protocol.js";

const SOURCE =
  "packages/generator-ai-sdk/src/internal/m9b13k4/native/m9b13k4-ledger.c";
let root = "";
let built: M9b13k4BuiltHelper;
let helperPath = "";
let namespaceIndex = 0;

function namespace(): string {
  namespaceIndex += 1;
  return `${root}/namespace-${namespaceIndex}`;
}

beforeAll(() => {
  root = mkdtempSync("/private/tmp/m9b13k4-tests.");
  helperPath = `${root}/ledger-helper`;
  const result = buildM9b13k4Helper(SOURCE, helperPath);
  if (!result.ok) throw new Error(result.error.reason);
  built = result.value;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("M9b.13k.4 descriptor-pinned native ledger", () => {
  it("normalizes two independent native builds to identical bytes", () => {
    const secondPath = `${root}/ledger-helper-second`;
    const second = buildM9b13k4Helper(SOURCE, secondPath);
    if (!second.ok) throw new Error(second.error.reason);
    expect(second.value.identity.executableSha256).toBe(
      built.identity.executableSha256,
    );
    expect(readFileSync(secondPath)).toEqual(readFileSync(helperPath));
    expect(built.identity).toMatchObject({
      protocol: "lachesis-m9b13k4-native-helper-reproducible-build/1",
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
      protocol: M9B13K4_IMPLEMENTATION_PROTOCOL,
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
    const first = deriveM9b13k4ImplementationIdentity(inventory);
    const reordered = deriveM9b13k4ImplementationIdentity({
      ...inventory,
      entries: inventory.entries.toReversed(),
    });
    const mutated = deriveM9b13k4ImplementationIdentity({
      ...inventory,
      entries: [{ ...inventory.entries[0], sha256: "c".repeat(64) }],
    });
    if (!first.ok || !reordered.ok || !mutated.ok)
      throw new Error("identity-derivation-failed");
    expect(reordered.value.identity).toBe(first.value.identity);
    expect(mutated.value.identity).not.toBe(first.value.identity);
    expect(
      deriveM9b13k4ImplementationIdentity({
        ...inventory,
        entries: [inventory.entries[0], inventory.entries[0]],
      }),
    ).toMatchObject({ ok: false });
    expect(deriveM9b13k4ImplementationIdentity({ entries: [] })).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4-implementation-inventory-invalid" },
    });
  });

  it("creates, snapshots, appends, audits, and reopens across processes", async () => {
    const path = namespace();
    const created = await createM9b13k4Ledger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    expect(created.value).toMatchObject({ sequence: 0, operation: "create" });
    const snapshot = await snapshotM9b13k4Ledger(built.helper, path);
    expect(snapshot).toMatchObject({
      ok: true,
      value: {
        sequence: 0,
        root: created.value.root,
        sessionIdentity: created.value.sessionIdentity,
      },
    });
    const appended = await appendM9b13k4Ledger(
      built.helper,
      path,
      created.value,
      '{"kind":"synthetic-ledger-payload","value":1}',
    );
    if (!appended.ok) throw new Error(appended.error.reason);
    expect(appended.value.sequence).toBe(1);
    expect(
      await auditM9b13k4Ledger(built.helper, path, appended.value),
    ).toMatchObject({
      ok: true,
      value: { sequence: 1, root: appended.value.root },
    });
    const second = await appendM9b13k4Ledger(
      built.helper,
      path,
      appended.value,
      '{"process":"B","reopened":true}',
    );
    expect(second).toMatchObject({ ok: true, value: { sequence: 2 } });
  });

  it("rejects duplicate keys before parsing and preserves hostile own keys", () => {
    expect(canonicalM9b13k4Payload('{"a":1,"a":2}')).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4-json-duplicate-object-key" },
    });
    expect(canonicalM9b13k4Payload('{"a":1,"\\u0061":2}')).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4-json-duplicate-object-key" },
    });
    const hostile = canonicalM9b13k4Payload(
      '{"constructor":{"prototype":1},"__proto__":{"polluted":true}}',
    );
    if (!hostile.ok) throw new Error(hostile.error.reason);
    expect(new TextDecoder().decode(hostile.value)).toBe(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":1}}',
    );
    expect(canonicalM9b13k4Payload(`"${"x".repeat(65_537)}"`)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4-payload-oversized" },
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
      expect(canonicalM9b13k4Payload(valid)).toMatchObject({ ok: true });
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
      expect(canonicalM9b13k4Payload(invalid)).toMatchObject({ ok: false });
  });

  it("rejects forged, missing, mode-changed, and unbuildable helpers", async () => {
    expect(
      await createM9b13k4Ledger(Object.freeze({}), namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4-helper-capability-invalid" },
    });
    expect(
      buildM9b13k4Helper(`${root}/missing-source.c`, `${root}/missing-output`),
    ).toMatchObject({ ok: false });

    const modePath = `${root}/mode-helper`;
    const modeHelper = buildM9b13k4Helper(SOURCE, modePath);
    if (!modeHelper.ok) throw new Error(modeHelper.error.reason);
    chmodSync(modePath, 0o755);
    expect(
      await createM9b13k4Ledger(modeHelper.value.helper, namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4-helper-metadata-rejected" },
    });

    const missingPath = `${root}/missing-helper`;
    const missingHelper = buildM9b13k4Helper(SOURCE, missingPath);
    if (!missingHelper.ok) throw new Error(missingHelper.error.reason);
    rmSync(missingPath);
    expect(
      await createM9b13k4Ledger(missingHelper.value.helper, namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4-helper-unreadable" },
    });
  });

  it("rejects namespace aliases, symlinks, modes, and log hardlinks", async () => {
    const privateParent = `${root}/private-parent`;
    mkdirSync(privateParent, { mode: 0o700 });
    const ancestorAlias = `${root}/ancestor-alias`;
    symlinkSync(privateParent, ancestorAlias);
    expect(
      await createM9b13k4Ledger(built.helper, `${ancestorAlias}/ledger`),
    ).toMatchObject({ ok: false });

    const leafTarget = `${root}/leaf-target`;
    mkdirSync(leafTarget, { mode: 0o700 });
    const leafAlias = `${root}/leaf-alias`;
    symlinkSync(leafTarget, leafAlias);
    expect(await snapshotM9b13k4Ledger(built.helper, leafAlias)).toMatchObject({
      ok: false,
    });

    const normalizedAlias = `${root}/./normalized-alias`;
    expect(
      await createM9b13k4Ledger(built.helper, normalizedAlias),
    ).toMatchObject({
      ok: false,
    });

    const wrongMode = `${root}/wrong-mode`;
    mkdirSync(wrongMode, { mode: 0o755 });
    expect(await snapshotM9b13k4Ledger(built.helper, wrongMode)).toMatchObject({
      ok: false,
    });

    const path = namespace();
    const created = await createM9b13k4Ledger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    linkSync(`${path}/ledger.log`, `${path}/second-name`);
    expect(await auditM9b13k4Ledger(built.helper, path)).toMatchObject({
      ok: false,
    });
  });

  it("detects namespace swap, mode change, and retained-log replacement", async () => {
    for (const attack of [
      "namespace-swap",
      "namespace-mode",
      "log-replacement",
    ] as const) {
      const path = namespace();
      const created = await createM9b13k4Ledger(built.helper, path);
      if (!created.ok) throw new Error(created.error.reason);
      const launched = launchBarrierM9b13k4Append(
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
    const created = await createM9b13k4Ledger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    const launched = launchBarrierM9b13k4Append(
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
      createM9b13k4Ledger(built.helper, concurrent),
      createM9b13k4Ledger(built.helper, concurrent),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
  });

  it("proves one-winner stale-root CAS in 100 genuine two-process barriers", async () => {
    const path = namespace();
    const created = await createM9b13k4Ledger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    let current = created.value;
    for (let iteration = 0; iteration < 100; iteration++) {
      const left = launchBarrierM9b13k4Append(
        built.helper,
        path,
        current,
        `{"iteration":${iteration},"side":"left"}`,
      );
      const right = launchBarrierM9b13k4Append(
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
        { error: { reason: "m9b13k4-helper-stale-cas", ambiguous: false } },
      ]);
      const winner = winners[0];
      if (winner?.ok !== true) throw new Error("race-winner-absent");
      current = winner.value;
    }
    expect(current.sequence).toBe(100);
    expect(await auditM9b13k4Ledger(built.helper, path, current)).toMatchObject(
      {
        ok: true,
      },
    );
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
    const created = await createM9b13k4Ledger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    expect(
      await appendM9b13k4Ledger(
        built.helper,
        path,
        created.value,
        '{"crash":"matrix","padding":"abcdefghijk"}',
        { crashPoint },
      ),
    ).toMatchObject({ ok: false, error: { ambiguous: true } });
    const audit = await auditM9b13k4Ledger(built.helper, path);
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
    const created = await createM9b13k4Ledger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    const appended = await appendM9b13k4Ledger(
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
        await auditM9b13k4Ledger(built.helper, path, appended.value),
      ).toMatchObject({ ok: false });
    }
    writeFileSync(logPath, complete.subarray(0, 64));
    expect(
      await auditM9b13k4Ledger(built.helper, path, appended.value),
    ).toMatchObject({
      ok: false,
      error: {
        reason: "m9b13k4-audit-expected-state-mismatch",
        ambiguous: true,
      },
    });
    writeFileSync(logPath, complete);
    truncateSync(logPath, complete.byteLength - 1);
    expect(await auditM9b13k4Ledger(built.helper, path)).toMatchObject({
      ok: false,
    });
    writeFileSync(logPath, Buffer.concat([complete, Buffer.from("garbage")]));
    expect(await auditM9b13k4Ledger(built.helper, path)).toMatchObject({
      ok: false,
    });
    for (const damageOffset of [64 + 16, 64 + 24]) {
      const damaged = Buffer.from(complete);
      const original = damaged[damageOffset];
      if (original === undefined) throw new Error("damage-offset-invalid");
      damaged[damageOffset] = original ^ 0x01;
      writeFileSync(logPath, damaged);
      expect(await auditM9b13k4Ledger(built.helper, path)).toMatchObject({
        ok: false,
      });
    }
  });

  it("rejects malformed output, timeout, pre-invocation substitution, and running replacement", async () => {
    const path = namespace();
    const created = await createM9b13k4Ledger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    expect(
      await inspectMalformedM9b13k4HelperOutput(built.helper, path),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4-helper-output-invalid" },
    });
    const timeout = launchBarrierM9b13k4Append(
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
      error: { kind: "timeout", reason: "m9b13k4-helper-timeout" },
    });

    const substitutePath = `${root}/substitution-helper`;
    const substitute = buildM9b13k4Helper(SOURCE, substitutePath);
    if (!substitute.ok) throw new Error(substitute.error.reason);
    renameSync(substitutePath, `${substitutePath}-original`);
    copyFileSync(`${substitutePath}-original`, substitutePath);
    chmodSync(substitutePath, 0o700);
    expect(
      await createM9b13k4Ledger(substitute.value.helper, namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4-helper-hash-mismatch" },
    });

    const runningPath = `${root}/running-helper`;
    const running = buildM9b13k4Helper(SOURCE, runningPath);
    if (!running.ok) throw new Error(running.error.reason);
    const runningNamespace = namespace();
    const runningCreated = await createM9b13k4Ledger(
      running.value.helper,
      runningNamespace,
    );
    if (!runningCreated.ok) throw new Error(runningCreated.error.reason);
    const launched = launchBarrierM9b13k4Append(
      running.value.helper,
      runningNamespace,
      runningCreated.value,
      '{"replacement":"running"}',
    );
    if (!launched.ok) throw new Error(launched.error.reason);
    expect(await launched.value.ready).toMatchObject({ ok: true });
    renameSync(runningPath, `${runningPath}-original`);
    copyFileSync(`${runningPath}-original`, runningPath);
    chmodSync(runningPath, 0o700);
    launched.value.release();
    expect(await launched.value.completed).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4-helper-replaced-during-run", ambiguous: true },
    });
  });

  it("zero-effect replay cannot append from an older root", async () => {
    const path = namespace();
    const created = await createM9b13k4Ledger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    expect(
      await appendM9b13k4Ledger(
        built.helper,
        path,
        created.value,
        '{"duplicate":1,"duplicate":2}',
      ),
    ).toMatchObject({ ok: false });
    const first = await appendM9b13k4Ledger(
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
      await appendM9b13k4Ledger(
        built.helper,
        path,
        created.value,
        '{"effect":"synthetic-only","index":1}',
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4-helper-stale-cas", ambiguous: false },
    });
    expect(
      createHash("sha256")
        .update(readFileSync(`${path}/ledger.log`))
        .digest("hex"),
    ).toBe(bytesBefore);
  });
});
