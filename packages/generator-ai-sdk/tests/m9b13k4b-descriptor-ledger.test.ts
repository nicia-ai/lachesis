import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { Readable } from "node:stream";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appendM9b13k4bLedger,
  auditM9b13k4bLedger,
  buildM9b13k4bConformanceHelper,
  buildM9b13k4bHelper,
  createM9b13k4bLedger,
  inspectMalformedM9b13k4bHelperOutput,
  launchBarrierM9b13k4bAppend,
  launchBarrierM9b13k4bInspect,
  launchBlockedInputM9b13k4bAppend,
  launchMalformedBarrierM9b13k4bInvocation,
  type M9b13k4bBuiltHelper,
  snapshotM9b13k4bLedger,
} from "../src/internal/m9b13k4b/ledger.js";
import {
  canonicalM9b13k4bPayload,
  deriveM9b13k4bImplementationIdentity,
  M9B13K4B_IMPLEMENTATION_PROTOCOL,
} from "../src/internal/m9b13k4b/protocol.js";

const SOURCE = `${process.cwd()}/packages/generator-ai-sdk/src/internal/m9b13k4b/native/m9b13k4b-ledger.c`;
const HELPER_LEAF = "m9b13k4b-ledger-helper";
const CONFORMANCE_HELPER_LEAF = "m9b13k4b-ledger-conformance-helper";
let root = "";
let built: M9b13k4bBuiltHelper;
let conformanceBuilt: M9b13k4bBuiltHelper;
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

function rewriteHeaderCrc(bytes: Buffer): number {
  const expected = crc32(bytes.subarray(0, 60));
  bytes.writeUInt32BE(expected, 60);
  expect(bytes.readUInt32BE(60)).toBe(expected);
  return expected;
}

function expectSelfConsistentHeader(bytes: Buffer): void {
  expect(bytes.subarray(0, 8).toString("ascii")).toBe("L9K4LOG1");
  expect(bytes.readUInt32BE(8)).toBe(1);
  expect(bytes.readUInt32BE(12)).toBe(64);
  expect(bytes.subarray(16, 48)).not.toEqual(Buffer.alloc(32));
  expect(bytes.readUInt32BE(60)).toBe(crc32(bytes.subarray(0, 60)));
}

async function holdExclusiveLock(path: string): Promise<
  Readonly<{
    release: () => void;
    completed: Promise<void>;
  }>
> {
  const script = [
    "import fcntl, os, sys",
    "fd = os.open(sys.argv[1], os.O_RDWR)",
    "fcntl.flock(fd, fcntl.LOCK_EX)",
    "sys.stdout.buffer.write(b'R')",
    "sys.stdout.buffer.flush()",
    "sys.stdin.buffer.read(1)",
    "fcntl.flock(fd, fcntl.LOCK_UN)",
    "os.close(fd)",
  ].join("\n");
  const child = spawn("/usr/bin/python3", ["-c", script, path], {
    stdio: "pipe",
    env: { PATH: "/usr/bin:/bin" },
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.stdout.once("data", (chunk: Buffer) => {
      if (chunk.equals(Buffer.from("R"))) resolve();
      else reject(new Error("external-lock-ready-invalid"));
    });
  });
  const completed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("external-lock-holder-failed"));
    });
  });
  return {
    release: (): void => {
      child.stdin.end(Buffer.from("G"));
    },
    completed,
  };
}

async function expectStillPending<T>(promise: Promise<T>): Promise<void> {
  const state = await Promise.race([
    promise.then(() => "settled" as const),
    new Promise<"pending">((resolve) => {
      setTimeout(() => {
        resolve("pending");
      }, 40);
    }),
  ]);
  expect(state).toBe("pending");
}

beforeAll(() => {
  root = mkdtempSync("/private/tmp/m9b13k4b-tests.");
  const buildDirectory = `${root}/primary-build`;
  helperPath = `${buildDirectory}/${HELPER_LEAF}`;
  const result = buildM9b13k4bHelper(SOURCE, buildDirectory);
  if (!result.ok) throw new Error(result.error.reason);
  built = result.value;
  const conformance = buildM9b13k4bConformanceHelper(
    SOURCE,
    `${root}/conformance-build`,
  );
  if (!conformance.ok) throw new Error(conformance.error.reason);
  conformanceBuilt = conformance.value;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("M9b.13k.4b descriptor-pinned native ledger", () => {
  it("normalizes two independent native builds to identical bytes", () => {
    const secondDirectory = `${root}/second-build`;
    const secondPath = `${secondDirectory}/${HELPER_LEAF}`;
    const second = buildM9b13k4bHelper(SOURCE, secondDirectory);
    if (!second.ok) throw new Error(second.error.reason);
    expect(second.value.identity.executableSha256).toBe(
      built.identity.executableSha256,
    );
    expect(readFileSync(secondPath)).toEqual(readFileSync(helperPath));
    expect(built.identity).toMatchObject({
      protocol: "lachesis-m9b13k4b-native-helper-reproducible-build/3",
      variant: "production",
      targetArchitecture: "arm64",
      flags: ["clang", "-std=c17", "-Os", "-Wall", "-Wextra", "-Werror"],
      normalization: "remove-signature-patch-source-bound-lc-uuid-adhoc-resign",
    });
    expect(built.identity.linkedLibraries).toEqual([
      expect.stringContaining("/usr/lib/libSystem.B.dylib"),
    ]);
    const conformanceDirectory = `${root}/second-conformance-build`;
    const conformancePath = `${conformanceDirectory}/${CONFORMANCE_HELPER_LEAF}`;
    const secondConformance = buildM9b13k4bConformanceHelper(
      SOURCE,
      conformanceDirectory,
    );
    if (!secondConformance.ok) throw new Error(secondConformance.error.reason);
    expect(secondConformance.value.identity.executableSha256).toBe(
      conformanceBuilt.identity.executableSha256,
    );
    expect(readFileSync(conformancePath)).toEqual(
      readFileSync(`${root}/conformance-build/${CONFORMANCE_HELPER_LEAF}`),
    );
    expect(conformanceBuilt.identity).toMatchObject({
      variant: "conformance",
      flags: [
        "clang",
        "-std=c17",
        "-Os",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-DM9B13K4B_CONFORMANCE=1",
      ],
    });
    expect(conformanceBuilt.identity.executableSha256).not.toBe(
      built.identity.executableSha256,
    );
  });

  it("binds implementation identity to exact native and caller bytes", () => {
    const inventory = {
      protocol: M9B13K4B_IMPLEMENTATION_PROTOCOL,
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
    const first = deriveM9b13k4bImplementationIdentity(inventory);
    const reordered = deriveM9b13k4bImplementationIdentity({
      ...inventory,
      entries: inventory.entries.toReversed(),
    });
    const mutated = deriveM9b13k4bImplementationIdentity({
      ...inventory,
      entries: [{ ...inventory.entries[0], sha256: "c".repeat(64) }],
    });
    if (!first.ok || !reordered.ok || !mutated.ok)
      throw new Error("identity-derivation-failed");
    expect(reordered.value.identity).toBe(first.value.identity);
    expect(mutated.value.identity).not.toBe(first.value.identity);
    expect(
      deriveM9b13k4bImplementationIdentity({
        ...inventory,
        entries: [inventory.entries[0], inventory.entries[0]],
      }),
    ).toMatchObject({ ok: false });
    expect(deriveM9b13k4bImplementationIdentity({ entries: [] })).toMatchObject(
      {
        ok: false,
        error: { reason: "m9b13k4b-implementation-inventory-invalid" },
      },
    );
  });

  it("creates, snapshots, appends, audits, and reopens across processes", async () => {
    const path = namespace();
    const created = await createM9b13k4bLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    expect(created.value).toMatchObject({ sequence: 0, operation: "create" });
    const snapshot = await snapshotM9b13k4bLedger(built.helper, path);
    expect(snapshot).toMatchObject({
      ok: true,
      value: {
        sequence: 0,
        root: created.value.root,
        sessionIdentity: created.value.sessionIdentity,
      },
    });
    const appended = await appendM9b13k4bLedger(
      built.helper,
      path,
      created.value,
      '{"kind":"synthetic-ledger-payload","value":1}',
    );
    if (!appended.ok) throw new Error(appended.error.reason);
    expect(appended.value.sequence).toBe(1);
    expect(
      await auditM9b13k4bLedger(built.helper, path, appended.value),
    ).toMatchObject({
      ok: true,
      value: { sequence: 1, root: appended.value.root },
    });
    const second = await appendM9b13k4bLedger(
      built.helper,
      path,
      appended.value,
      '{"process":"B","reopened":true}',
    );
    expect(second).toMatchObject({ ok: true, value: { sequence: 2 } });
  });

  it("rejects duplicate keys before parsing and preserves hostile own keys", () => {
    expect(canonicalM9b13k4bPayload('{"a":1,"a":2}')).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-json-duplicate-object-key" },
    });
    expect(canonicalM9b13k4bPayload('{"a":1,"\\u0061":2}')).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-json-duplicate-object-key" },
    });
    const hostile = canonicalM9b13k4bPayload(
      '{"constructor":{"prototype":1},"__proto__":{"polluted":true}}',
    );
    if (!hostile.ok) throw new Error(hostile.error.reason);
    expect(new TextDecoder().decode(hostile.value)).toBe(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":1}}',
    );
    expect(canonicalM9b13k4bPayload(`"${"x".repeat(65_537)}"`)).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-payload-oversized" },
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
      expect(canonicalM9b13k4bPayload(valid)).toMatchObject({ ok: true });
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
      expect(canonicalM9b13k4bPayload(invalid)).toMatchObject({ ok: false });
  });

  it("rejects forged, missing, mode-changed, and unbuildable helpers", async () => {
    expect(
      await createM9b13k4bLedger(Object.freeze({}), namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-capability-invalid" },
    });
    expect(
      buildM9b13k4bHelper(`${root}/missing-source.c`, `${root}/missing-output`),
    ).toMatchObject({ ok: false });

    const modeDirectory = `${root}/mode-build`;
    const modePath = `${modeDirectory}/${HELPER_LEAF}`;
    const modeHelper = buildM9b13k4bHelper(SOURCE, modeDirectory);
    if (!modeHelper.ok) throw new Error(modeHelper.error.reason);
    chmodSync(modePath, 0o755);
    expect(
      await createM9b13k4bLedger(modeHelper.value.helper, namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-metadata-rejected" },
    });

    const missingDirectory = `${root}/missing-build`;
    const missingPath = `${missingDirectory}/${HELPER_LEAF}`;
    const missingHelper = buildM9b13k4bHelper(SOURCE, missingDirectory);
    if (!missingHelper.ok) throw new Error(missingHelper.error.reason);
    rmSync(missingPath);
    expect(
      await createM9b13k4bLedger(missingHelper.value.helper, namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-unreadable" },
    });
  });

  it("rejects namespace aliases, symlinks, modes, and log hardlinks", async () => {
    const privateParent = `${root}/private-parent`;
    mkdirSync(privateParent, { mode: 0o700 });
    const ancestorAlias = `${root}/ancestor-alias`;
    symlinkSync(privateParent, ancestorAlias);
    expect(
      await createM9b13k4bLedger(built.helper, `${ancestorAlias}/ledger`),
    ).toMatchObject({ ok: false });

    const leafTarget = `${root}/leaf-target`;
    mkdirSync(leafTarget, { mode: 0o700 });
    const leafAlias = `${root}/leaf-alias`;
    symlinkSync(leafTarget, leafAlias);
    expect(await snapshotM9b13k4bLedger(built.helper, leafAlias)).toMatchObject(
      {
        ok: false,
      },
    );

    const normalizedAlias = `${root}/./normalized-alias`;
    expect(
      await createM9b13k4bLedger(built.helper, normalizedAlias),
    ).toMatchObject({
      ok: false,
    });

    const wrongMode = `${root}/wrong-mode`;
    mkdirSync(wrongMode, { mode: 0o755 });
    expect(await snapshotM9b13k4bLedger(built.helper, wrongMode)).toMatchObject(
      {
        ok: false,
      },
    );

    const path = namespace();
    const created = await createM9b13k4bLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    linkSync(`${path}/ledger.log`, `${path}/second-name`);
    expect(await auditM9b13k4bLedger(built.helper, path)).toMatchObject({
      ok: false,
    });
  });

  it("rejects the complete unsafe-ancestor matrix and post-admission mode changes", async () => {
    for (const mode of [0o777, 0o770, 0o720, 0o702, 0o1777]) {
      const parent = `${root}/unsafe-${mode.toString(8)}`;
      mkdirSync(parent, { mode: 0o700 });
      chmodSync(parent, mode);
      expect(
        await createM9b13k4bLedger(built.helper, `${parent}/ledger`),
      ).toMatchObject({ ok: false });
    }

    const approved = await createM9b13k4bLedger(built.helper, namespace());
    expect(approved).toMatchObject({ ok: true });

    const admittedParent = `${root}/admitted-parent`;
    mkdirSync(admittedParent, { mode: 0o700 });
    const path = `${admittedParent}/ledger`;
    const created = await createM9b13k4bLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    const launched = launchBarrierM9b13k4bInspect(
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
    "security-stops %s after the exact externally lock-held pathname race",
    async (operation) => {
      for (let repetition = 0; repetition < 5; repetition++) {
        const path = namespace();
        const created = await createM9b13k4bLedger(built.helper, path);
        if (!created.ok) throw new Error(created.error.reason);
        const logPath = `${path}/ledger.log`;
        const original = lstatSync(logPath, { bigint: true });
        expect(created.value.logInode).toBe(original.ino.toString());
        const holder = await holdExclusiveLock(logPath);
        const launched = launchBarrierM9b13k4bInspect(
          built.helper,
          path,
          operation,
        );
        if (!launched.ok) throw new Error(launched.error.reason);
        expect(await launched.value.ready).toMatchObject({ ok: true });
        launched.value.release();
        await expectStillPending(launched.value.completed);
        renameSync(logPath, `${path}/ledger.retained`);
        copyFileSync(`${path}/ledger.retained`, logPath);
        chmodSync(logPath, 0o600);
        const replacement = lstatSync(logPath, { bigint: true });
        expect(replacement.ino).not.toBe(original.ino);
        holder.release();
        await holder.completed;
        expect(await launched.value.completed).toMatchObject({
          ok: false,
          error: {
            reason: "m9b13k4b-helper-post-inspect-identity-ambiguous",
            ambiguous: true,
          },
        });
      }
    },
  );

  it("settles every genuine barrier early-exit and timeout lifecycle", async () => {
    const started = Date.now();
    const invalid = launchBarrierM9b13k4bInspect(
      built.helper,
      `${root}/absent/namespace`,
      "snapshot",
      { timeoutMs: 150 },
    );
    if (!invalid.ok) throw new Error(invalid.error.reason);
    expect(await invalid.value.ready).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-barrier-ready-eof" },
    });
    expect(await invalid.value.completed).toMatchObject({
      ok: false,
      error: {
        reason: "m9b13k4b-helper-namespace-admission-rejected",
        ambiguous: false,
      },
    });
    expect(Date.now() - started).toBeLessThan(150);

    const malformed = launchMalformedBarrierM9b13k4bInvocation(
      built.helper,
      150,
    );
    if (!malformed.ok) throw new Error(malformed.error.reason);
    expect(await malformed.value.ready).toMatchObject({ ok: false });
    expect(await malformed.value.completed).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-operation-invalid" },
    });

    const timeoutPath = namespace();
    const timeoutCreated = await createM9b13k4bLedger(
      built.helper,
      timeoutPath,
    );
    if (!timeoutCreated.ok) throw new Error(timeoutCreated.error.reason);

    const descriptorError = launchBarrierM9b13k4bInspect(
      built.helper,
      timeoutPath,
      "snapshot",
      { timeoutMs: 500 },
    );
    if (!descriptorError.ok) throw new Error(descriptorError.error.reason);
    descriptorError.value.child.kill("SIGSTOP");
    const readinessDescriptor = descriptorError.value.child.stdio[3];
    if (!(readinessDescriptor instanceof Readable))
      throw new Error("readiness-descriptor-invalid");
    readinessDescriptor.destroy(new Error("injected-readiness-error"));
    expect(await descriptorError.value.ready).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-barrier-ready-error" },
    });
    expect(await descriptorError.value.completed).toMatchObject({ ok: false });

    const childError = launchBarrierM9b13k4bInspect(
      built.helper,
      timeoutPath,
      "audit",
      { timeoutMs: 500 },
    );
    if (!childError.ok) throw new Error(childError.error.reason);
    childError.value.child.kill("SIGSTOP");
    childError.value.child.emit("error", new Error("injected-child-error"));
    expect(await childError.value.ready).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-spawn-failed" },
    });
    expect(await childError.value.completed).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-spawn-failed" },
    });
    expect(() => {
      childError.value.child.emit("error", new Error("late-child-error"));
      readinessDescriptor.emit("data", Buffer.from("R"));
      readinessDescriptor.emit("error", new Error("late-readiness-error"));
      readinessDescriptor.emit("close");
    }).not.toThrow();

    const beforeReady = launchBarrierM9b13k4bInspect(
      built.helper,
      timeoutPath,
      "snapshot",
      { timeoutMs: 100 },
    );
    if (!beforeReady.ok) throw new Error(beforeReady.error.reason);
    beforeReady.value.child.kill("SIGSTOP");
    expect(await beforeReady.value.ready).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-timeout" },
    });
    expect(await beforeReady.value.completed).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-timeout", ambiguous: false },
    });

    const afterReady = launchBarrierM9b13k4bInspect(
      built.helper,
      timeoutPath,
      "audit",
      { timeoutMs: 100 },
    );
    if (!afterReady.ok) throw new Error(afterReady.error.reason);
    expect(await afterReady.value.ready).toMatchObject({ ok: true });
    expect(await afterReady.value.completed).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-timeout", ambiguous: false },
    });

    const killed = launchBarrierM9b13k4bInspect(
      built.helper,
      timeoutPath,
      "snapshot",
    );
    if (!killed.ok) throw new Error(killed.error.reason);
    expect(await killed.value.ready).toMatchObject({ ok: true });
    killed.value.child.kill("SIGKILL");
    killed.value.release();
    killed.value.release();
    expect(await killed.value.completed).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-terminated", ambiguous: false },
    });

    const append = launchBarrierM9b13k4bAppend(
      built.helper,
      timeoutPath,
      timeoutCreated.value,
      '{"death":"after-release"}',
    );
    if (!append.ok) throw new Error(append.error.reason);
    expect(await append.value.ready).toMatchObject({ ok: true });
    append.value.release();
    append.value.release();
    append.value.child.kill("SIGKILL");
    expect(await append.value.completed).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-terminated", ambiguous: true },
    });
  });

  it("attributes every self-consistent big-endian reserved-byte rejection", async () => {
    const controlPath = namespace();
    const controlCreated = await createM9b13k4bLedger(
      built.helper,
      controlPath,
    );
    if (!controlCreated.ok) throw new Error(controlCreated.error.reason);
    const controlLog = `${controlPath}/ledger.log`;
    const control = Buffer.from(readFileSync(controlLog));
    rewriteHeaderCrc(control);
    expectSelfConsistentHeader(control);
    expect(control.subarray(48, 60)).toEqual(Buffer.alloc(12));
    writeFileSync(controlLog, control);
    expect(
      await snapshotM9b13k4bLedger(built.helper, controlPath),
    ).toMatchObject({ ok: true });

    for (const offsets of [
      ...Array.from({ length: 12 }, (_, index) => [48 + index]),
      Array.from({ length: 12 }, (_, index) => 48 + index),
    ]) {
      const path = namespace();
      const created = await createM9b13k4bLedger(built.helper, path);
      if (!created.ok) throw new Error(created.error.reason);
      const logPath = `${path}/ledger.log`;
      const mutated = Buffer.from(readFileSync(logPath));
      for (const offset of offsets) mutated[offset] = 0xa5;
      rewriteHeaderCrc(mutated);
      expectSelfConsistentHeader(mutated);
      writeFileSync(logPath, mutated);
      expect(await snapshotM9b13k4bLedger(built.helper, path)).toMatchObject({
        ok: false,
        error: { reason: "m9b13k4b-helper-reserved-header-unsupported" },
      });
      expect(await auditM9b13k4bLedger(built.helper, path)).toMatchObject({
        ok: false,
        error: { reason: "m9b13k4b-helper-reserved-header-unsupported" },
      });
      expect(
        await appendM9b13k4bLedger(
          built.helper,
          path,
          created.value,
          '{"reserved":"rejected"}',
        ),
      ).toMatchObject({
        ok: false,
        error: { reason: "m9b13k4b-helper-reserved-header-unsupported" },
      });
      expect(await snapshotM9b13k4bLedger(built.helper, path)).toMatchObject({
        ok: false,
        error: { reason: "m9b13k4b-helper-reserved-header-unsupported" },
      });
    }
  });

  it("admits the complete helper path and rejects aliases, links, and replacements", async () => {
    expect(
      buildM9b13k4bHelper(
        SOURCE,
        "/private/var/run/m9b13k4b-root-writable-build",
      ),
    ).toMatchObject({ ok: false });
    expect(
      buildM9b13k4bHelper(
        SOURCE,
        "/Users/Shared/m9b13k4b-unexpected-sticky-build",
      ),
    ).toMatchObject({ ok: false });
    for (const mode of [0o777, 0o770, 0o720, 0o702, 0o1777]) {
      const parent = `${root}/helper-unsafe-${mode.toString(8)}`;
      mkdirSync(parent, { mode: 0o700 });
      chmodSync(parent, mode);
      expect(
        buildM9b13k4bHelper(SOURCE, `${parent}/fresh-build`),
      ).toMatchObject({ ok: false });
    }

    const target = `${root}/helper-alias-target`;
    mkdirSync(target, { mode: 0o700 });
    const alias = `${root}/helper-alias`;
    symlinkSync(target, alias);
    expect(buildM9b13k4bHelper(SOURCE, `${alias}/fresh-build`)).toMatchObject({
      ok: false,
    });

    const preexisting = `${root}/preexisting-build`;
    mkdirSync(preexisting, { mode: 0o700 });
    expect(buildM9b13k4bHelper(SOURCE, preexisting)).toMatchObject({
      ok: false,
    });
    const leafAlias = `${root}/leaf-build-alias`;
    symlinkSync(target, leafAlias);
    expect(buildM9b13k4bHelper(SOURCE, leafAlias)).toMatchObject({ ok: false });

    const linkedDirectory = `${root}/linked-build`;
    const linkedPath = `${linkedDirectory}/${HELPER_LEAF}`;
    const linked = buildM9b13k4bHelper(SOURCE, linkedDirectory);
    if (!linked.ok) throw new Error(linked.error.reason);
    linkSync(linkedPath, `${linkedDirectory}/second-name`);
    expect(
      await createM9b13k4bLedger(linked.value.helper, namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-metadata-rejected" },
    });

    const replacedDirectory = `${root}/replaced-build`;
    const replacedPath = `${replacedDirectory}/${HELPER_LEAF}`;
    const replaced = buildM9b13k4bHelper(SOURCE, replacedDirectory);
    if (!replaced.ok) throw new Error(replaced.error.reason);
    renameSync(replacedDirectory, `${replacedDirectory}-retained`);
    mkdirSync(replacedDirectory, { mode: 0o700 });
    copyFileSync(`${replacedDirectory}-retained/${HELPER_LEAF}`, replacedPath);
    chmodSync(replacedPath, 0o700);
    expect(
      await createM9b13k4bLedger(replaced.value.helper, namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-path-replaced" },
    });
  });

  it("keeps synthetic EINTR injection distinct and preserves progress", async () => {
    for (const syntheticFailurePoint of [
      "read",
      "pread",
      "flock",
      "record-header-write",
      "record-payload-write",
      "record-footer-write",
      "fsync",
    ]) {
      const path = namespace();
      const created = await createM9b13k4bLedger(conformanceBuilt.helper, path);
      if (!created.ok) throw new Error(created.error.reason);
      const appended = await appendM9b13k4bLedger(
        conformanceBuilt.helper,
        path,
        created.value,
        `{"synthetic":"${syntheticFailurePoint}"}`,
        { syntheticFailurePoint },
      );
      expect(appended).toMatchObject({
        ok: true,
        value: {
          sequence: 1,
          helperVariant: "conformance",
          actualEintrCount: 0,
          syntheticFailureCount: 1,
        },
      });
      expect(
        await auditM9b13k4bLedger(conformanceBuilt.helper, path),
      ).toMatchObject({ ok: true, value: { sequence: 1 } });
    }

    for (const point of [
      "record-header-write",
      "record-payload-write",
      "record-footer-write",
    ]) {
      const path = namespace();
      const created = await createM9b13k4bLedger(conformanceBuilt.helper, path);
      if (!created.ok) throw new Error(created.error.reason);
      const payload = `{"partial":"${point}"}`;
      const appended = await appendM9b13k4bLedger(
        conformanceBuilt.helper,
        path,
        created.value,
        payload,
        { syntheticFailurePoint: `${point}-partial-eintr` },
      );
      expect(appended).toMatchObject({
        ok: true,
        value: {
          sequence: 1,
          actualEintrCount: 0,
          syntheticFailureCount: 1,
          syntheticPartialBytes: 3,
        },
      });
      const bytes = readFileSync(`${path}/ledger.log`);
      const canonicalPayload = Buffer.from(payload);
      expect(bytes.indexOf(canonicalPayload)).toBeGreaterThanOrEqual(64);
      expect(bytes.indexOf(canonicalPayload)).toBe(
        bytes.lastIndexOf(canonicalPayload),
      );
      expect(
        await auditM9b13k4bLedger(
          conformanceBuilt.helper,
          path,
          appended.ok ? appended.value : undefined,
        ),
      ).toMatchObject({ ok: true, value: { sequence: 1 } });
    }

    const productionPath = namespace();
    const productionCreated = await createM9b13k4bLedger(
      built.helper,
      productionPath,
    );
    if (!productionCreated.ok) throw new Error(productionCreated.error.reason);
    expect(
      await appendM9b13k4bLedger(
        built.helper,
        productionPath,
        productionCreated.value,
        "{}",
        { syntheticFailurePoint: "read" },
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-synthetic-failure-production-rejected" },
    });
  });

  it("records genuine asynchronous EINTR for blocked retry paths", async () => {
    const barrierPath = namespace();
    const barrierCreated = await createM9b13k4bLedger(
      conformanceBuilt.helper,
      barrierPath,
    );
    if (!barrierCreated.ok) throw new Error(barrierCreated.error.reason);
    const barrier = launchBarrierM9b13k4bInspect(
      conformanceBuilt.helper,
      barrierPath,
      "snapshot",
    );
    if (!barrier.ok) throw new Error(barrier.error.reason);
    expect(await barrier.value.ready).toMatchObject({ ok: true });
    expect(barrier.value.child.kill("SIGUSR1")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    barrier.value.release();
    expect(await barrier.value.completed).toMatchObject({
      ok: true,
      value: { receivedSignalCount: 1, actualEintrCount: 1 },
    });

    const lockPath = namespace();
    const lockCreated = await createM9b13k4bLedger(
      conformanceBuilt.helper,
      lockPath,
    );
    if (!lockCreated.ok) throw new Error(lockCreated.error.reason);
    const lock = await holdExclusiveLock(`${lockPath}/ledger.log`);
    const waiting = launchBarrierM9b13k4bInspect(
      conformanceBuilt.helper,
      lockPath,
      "audit",
    );
    if (!waiting.ok) throw new Error(waiting.error.reason);
    expect(await waiting.value.ready).toMatchObject({ ok: true });
    waiting.value.release();
    await expectStillPending(waiting.value.completed);
    expect(waiting.value.child.kill("SIGUSR1")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    lock.release();
    await lock.completed;
    expect(await waiting.value.completed).toMatchObject({
      ok: true,
      value: { receivedSignalCount: 1, actualEintrCount: 1 },
    });

    const inputPath = namespace();
    const inputCreated = await createM9b13k4bLedger(
      conformanceBuilt.helper,
      inputPath,
    );
    if (!inputCreated.ok) throw new Error(inputCreated.error.reason);
    const input = launchBlockedInputM9b13k4bAppend(
      conformanceBuilt.helper,
      inputPath,
      inputCreated.value,
      '{"genuine":"stdin-read"}',
    );
    if (!input.ok) throw new Error(input.error.reason);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(input.value.child.kill("SIGUSR1")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    input.value.sendInput();
    expect(await input.value.completed).toMatchObject({
      ok: true,
      value: { sequence: 1, receivedSignalCount: 1, actualEintrCount: 1 },
    });
  });

  it("detects namespace swap, mode change, and retained-log replacement", async () => {
    for (const attack of [
      "namespace-swap",
      "namespace-mode",
      "log-replacement",
    ] as const) {
      const path = namespace();
      const created = await createM9b13k4bLedger(built.helper, path);
      if (!created.ok) throw new Error(created.error.reason);
      const launched = launchBarrierM9b13k4bAppend(
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
    const created = await createM9b13k4bLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    const launched = launchBarrierM9b13k4bAppend(
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
      createM9b13k4bLedger(built.helper, concurrent),
      createM9b13k4bLedger(built.helper, concurrent),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
  });

  it("proves one-winner stale-root CAS in 100 genuine two-process barriers", async () => {
    const path = namespace();
    const created = await createM9b13k4bLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    let current = created.value;
    for (let iteration = 0; iteration < 100; iteration++) {
      const left = launchBarrierM9b13k4bAppend(
        built.helper,
        path,
        current,
        `{"iteration":${iteration},"side":"left"}`,
      );
      const right = launchBarrierM9b13k4bAppend(
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
        { error: { reason: "m9b13k4b-helper-stale-cas", ambiguous: false } },
      ]);
      const winner = winners[0];
      if (winner?.ok !== true) throw new Error("race-winner-absent");
      current = winner.value;
    }
    expect(current.sequence).toBe(100);
    expect(
      await auditM9b13k4bLedger(built.helper, path, current),
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
    const created = await createM9b13k4bLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    expect(
      await appendM9b13k4bLedger(
        built.helper,
        path,
        created.value,
        '{"crash":"matrix","padding":"abcdefghijk"}',
        { crashPoint },
      ),
    ).toMatchObject({ ok: false, error: { ambiguous: true } });
    const audit = await auditM9b13k4bLedger(built.helper, path);
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
    const created = await createM9b13k4bLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    const appended = await appendM9b13k4bLedger(
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
        await auditM9b13k4bLedger(built.helper, path, appended.value),
      ).toMatchObject({ ok: false });
    }
    writeFileSync(logPath, complete.subarray(0, 64));
    expect(
      await auditM9b13k4bLedger(built.helper, path, appended.value),
    ).toMatchObject({
      ok: false,
      error: {
        reason: "m9b13k4b-audit-expected-state-mismatch",
        ambiguous: true,
      },
    });
    writeFileSync(logPath, complete);
    truncateSync(logPath, complete.byteLength - 1);
    expect(await auditM9b13k4bLedger(built.helper, path)).toMatchObject({
      ok: false,
    });
    writeFileSync(logPath, Buffer.concat([complete, Buffer.from("garbage")]));
    expect(await auditM9b13k4bLedger(built.helper, path)).toMatchObject({
      ok: false,
    });
    for (const damageOffset of [64 + 16, 64 + 24]) {
      const damaged = Buffer.from(complete);
      const original = damaged[damageOffset];
      if (original === undefined) throw new Error("damage-offset-invalid");
      damaged[damageOffset] = original ^ 0x01;
      writeFileSync(logPath, damaged);
      expect(await auditM9b13k4bLedger(built.helper, path)).toMatchObject({
        ok: false,
      });
    }
  });

  it("rejects malformed output, timeout, pre-invocation substitution, and running replacement", async () => {
    const path = namespace();
    const created = await createM9b13k4bLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    expect(
      await inspectMalformedM9b13k4bHelperOutput(built.helper, path),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-output-invalid" },
    });
    const timeout = launchBarrierM9b13k4bAppend(
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
      error: { kind: "timeout", reason: "m9b13k4b-helper-timeout" },
    });

    const substituteDirectory = `${root}/substitution-build`;
    const substitutePath = `${substituteDirectory}/${HELPER_LEAF}`;
    const substitute = buildM9b13k4bHelper(SOURCE, substituteDirectory);
    if (!substitute.ok) throw new Error(substitute.error.reason);
    renameSync(substitutePath, `${substitutePath}-original`);
    copyFileSync(`${substitutePath}-original`, substitutePath);
    chmodSync(substitutePath, 0o700);
    expect(
      await createM9b13k4bLedger(substitute.value.helper, namespace()),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-hash-mismatch" },
    });

    const runningDirectory = `${root}/running-build`;
    const runningPath = `${runningDirectory}/${HELPER_LEAF}`;
    const running = buildM9b13k4bHelper(SOURCE, runningDirectory);
    if (!running.ok) throw new Error(running.error.reason);
    const runningNamespace = namespace();
    const runningCreated = await createM9b13k4bLedger(
      running.value.helper,
      runningNamespace,
    );
    if (!runningCreated.ok) throw new Error(runningCreated.error.reason);
    const launched = launchBarrierM9b13k4bAppend(
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
      error: { reason: "m9b13k4b-helper-replaced-during-run", ambiguous: true },
    });
  });

  it("zero-effect replay cannot append from an older root", async () => {
    const path = namespace();
    const created = await createM9b13k4bLedger(built.helper, path);
    if (!created.ok) throw new Error(created.error.reason);
    expect(
      await appendM9b13k4bLedger(
        built.helper,
        path,
        created.value,
        '{"duplicate":1,"duplicate":2}',
      ),
    ).toMatchObject({ ok: false });
    const first = await appendM9b13k4bLedger(
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
      await appendM9b13k4bLedger(
        built.helper,
        path,
        created.value,
        '{"effect":"synthetic-only","index":1}',
      ),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4b-helper-stale-cas", ambiguous: false },
    });
    expect(
      createHash("sha256")
        .update(readFileSync(`${path}/ledger.log`))
        .digest("hex"),
    ).toBe(bytesBefore);
  });
});
