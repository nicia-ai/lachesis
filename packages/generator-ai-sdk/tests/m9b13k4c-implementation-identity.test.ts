import { createHash } from "node:crypto";

import { canonicalizeJson } from "@nicia-ai/lachesis";
import { describe, expect, it } from "vitest";

import {
  compareM9b13k4cInventoryIdentities,
  type M9b13k4cInventoryIdentity,
  m9b13k4cInventoryIdentityBytes,
} from "../src/internal/m9b13k4c/implementation-order.js";
import {
  deriveM9b13k4cImplementationIdentity,
  M9B13K4C_IMPLEMENTATION_PROTOCOL,
  type M9b13k4cImplementationInventory,
} from "../src/internal/m9b13k4c/protocol.js";

type Entry = M9b13k4cImplementationInventory["entries"][number];

function entry(kind: Entry["kind"], path: string, marker: string): Entry {
  return { kind, path, byteLength: marker.length, sha256: marker.repeat(64) };
}

function referenceIdentityBytes(
  identity: M9b13k4cInventoryIdentity,
): Uint8Array {
  const separator = String.fromCodePoint(0);
  return new TextEncoder().encode(identity.kind + separator + identity.path);
}

function referenceCompare(
  left: M9b13k4cInventoryIdentity,
  right: M9b13k4cInventoryIdentity,
): number {
  const leftBytes = referenceIdentityBytes(left);
  const rightBytes = referenceIdentityBytes(right);
  const limit = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < limit; index++) {
    const difference = Number(leftBytes[index]) - Number(rightBytes[index]);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function referenceDigest(entries: ReadonlyArray<Entry>): string {
  const inventory = {
    protocol: M9B13K4C_IMPLEMENTATION_PROTOCOL,
    entries: [...entries].sort(referenceCompare),
  };
  const canonical = canonicalizeJson(inventory);
  if (!canonical.ok) throw new Error("reference-canonicalization-failed");
  const canonicalBytes = new TextEncoder().encode(canonical.value);
  const length = new Uint8Array(8);
  new DataView(length.buffer).setBigUint64(0, BigInt(canonicalBytes.length));
  const digest = createHash("sha256");
  digest.update(M9B13K4C_IMPLEMENTATION_PROTOCOL, "utf8");
  digest.update(length);
  digest.update(canonicalBytes);
  return digest.digest("hex");
}

async function webCryptoReferenceDigest(
  entries: ReadonlyArray<Entry>,
): Promise<string> {
  const inventory = {
    protocol: M9B13K4C_IMPLEMENTATION_PROTOCOL,
    entries: [...entries].sort(referenceCompare),
  };
  const canonical = canonicalizeJson(inventory);
  if (!canonical.ok) throw new Error("reference-canonicalization-failed");
  const protocolBytes = new TextEncoder().encode(
    M9B13K4C_IMPLEMENTATION_PROTOCOL,
  );
  const canonicalBytes = new TextEncoder().encode(canonical.value);
  const length = new Uint8Array(8);
  new DataView(length.buffer).setBigUint64(0, BigInt(canonicalBytes.length));
  const framed = new Uint8Array(
    protocolBytes.length + length.length + canonicalBytes.length,
  );
  framed.set(protocolBytes, 0);
  framed.set(length, protocolBytes.length);
  framed.set(canonicalBytes, protocolBytes.length + length.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", framed));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function permutations<T>(
  values: ReadonlyArray<T>,
): ReadonlyArray<ReadonlyArray<T>> {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map(
      (tail) => [value, ...tail],
    ),
  );
}

function derive(
  entries: ReadonlyArray<Entry>,
): ReturnType<typeof deriveM9b13k4cImplementationIdentity> {
  return deriveM9b13k4cImplementationIdentity({
    protocol: M9B13K4C_IMPLEMENTATION_PROTOCOL,
    entries,
  });
}

describe("M9b.13k.4c bytewise implementation identity", () => {
  it.each([
    ["uppercase A before lowercase a", "A", "a"],
    ["uppercase Z before lowercase a", "Z", "a"],
    ["digit before uppercase", "9", "A"],
    ["digit before lowercase", "9", "a"],
    ["hyphen before period", "a-", "a."],
    ["period before slash", "a.", "a/"],
    ["slash before underscore", "a/", "a_"],
    ["underscore before lowercase", "a_", "aa"],
    ["prefix sorts first", "a", "a/child"],
  ])("orders %s", (_label, leftPath, rightPath) => {
    const left = { kind: "configuration", path: leftPath };
    const right = { kind: "configuration", path: rightPath };
    expect(m9b13k4cInventoryIdentityBytes(left)).toEqual(
      referenceIdentityBytes(left),
    );
    expect(m9b13k4cInventoryIdentityBytes(right)).toEqual(
      referenceIdentityBytes(right),
    );
    expect(referenceCompare(left, right)).toBeLessThan(0);
    expect(compareM9b13k4cInventoryIdentities(left, right)).toBeLessThan(0);
    expect(compareM9b13k4cInventoryIdentities(right, left)).toBeGreaterThan(0);
  });

  it("orders differences before and after the NUL separator", () => {
    const vectors = [
      entry("typescript-source", "A", "a"),
      entry("configuration", "a", "b"),
      entry("configuration", "A", "c"),
      entry("build-protocol", "z", "d"),
    ];
    const expected = [
      "build-protocol:z",
      "configuration:A",
      "configuration:a",
      "typescript-source:A",
    ];
    expect(
      [...vectors]
        .sort(referenceCompare)
        .map(({ kind, path }) => `${kind}:${path}`),
    ).toEqual(expected);
    const result = derive(vectors);
    if (!result.ok) throw new Error(result.error.reason);
    expect(
      result.value.canonicalInventory.entries.map(
        ({ kind, path }) => `${kind}:${path}`,
      ),
    ).toEqual(expected);
    expect(result.value.identity).toBe(referenceDigest(vectors));
  });

  it("matches independent order and digest for every small-set permutation", () => {
    const vectors = [
      entry("configuration", "a", "a"),
      entry("configuration", "A", "b"),
      entry("native-source", "0", "c"),
      entry("configuration", "a/child", "d"),
    ];
    const expectedDigest = referenceDigest(vectors);
    const expectedOrder = [...vectors].sort(referenceCompare);
    const results = permutations(vectors).map(derive);
    expect(results).toHaveLength(24);
    for (const result of results) {
      if (!result.ok) throw new Error(result.error.reason);
      expect(result.value.canonicalInventory.entries).toEqual(expectedOrder);
      expect(result.value.identity).toBe(expectedDigest);
    }
  });

  it("matches the Workers-compatible Web Crypto reference digest", async () => {
    const vectors = [
      entry("configuration", "a", "a"),
      entry("configuration", "A", "b"),
      entry("native-source", "0", "c"),
    ];
    const result = derive(vectors);
    if (!result.ok) throw new Error(result.error.reason);
    expect(result.value.identity).toBe(await webCryptoReferenceDigest(vectors));
  });

  it("reproduces the mixed-case adversarial condition independently", () => {
    const adversarial = [
      entry("configuration", "a", "a"),
      entry("configuration", "A", "b"),
    ];
    const localeCompareDescriptor = Object.getOwnPropertyDescriptor(
      String.prototype,
      "localeCompare",
    );
    if (localeCompareDescriptor === undefined)
      throw new Error("locale-compare-descriptor-missing");
    Object.defineProperty(String.prototype, "localeCompare", {
      configurable: true,
      value: (): never => {
        throw new Error("locale-collation-used");
      },
    });
    try {
      const result = derive(adversarial);
      if (!result.ok) throw new Error(result.error.reason);
      expect(
        result.value.canonicalInventory.entries.map(({ path }) => path),
      ).toEqual(["A", "a"]);
      expect(result.value.identity).toBe(referenceDigest(adversarial));
      expect(result.value.identity).not.toBe(
        "3f59340a32ddcde0fc36dacde82158e410202686b55bed6a0c053f6f25511a7f",
      );
    } finally {
      Object.defineProperty(
        String.prototype,
        "localeCompare",
        localeCompareDescriptor,
      );
    }
  });

  it("rejects exact duplicates before sorting", () => {
    const duplicate = entry("configuration", "same", "a");
    expect(compareM9b13k4cInventoryIdentities(duplicate, duplicate)).toBe(0);
    expect(
      derive([duplicate, { ...duplicate, sha256: "b".repeat(64) }]),
    ).toMatchObject({
      ok: false,
      error: { reason: "m9b13k4c-implementation-path-duplicate" },
    });
  });

  it("rejects non-ASCII and canonically equivalent Unicode paths under the frozen schema", () => {
    for (const path of ["é", "e\u0301", "目录"])
      expect(derive([entry("configuration", path, "a")])).toMatchObject({
        ok: false,
        error: { reason: "m9b13k4c-implementation-inventory-invalid" },
      });
  });

  it("changes identity for every bound-field mutation", () => {
    const original = entry("configuration", "A", "a");
    const baseline = derive([original]);
    if (!baseline.ok) throw new Error(baseline.error.reason);
    const mutations = [
      entry("native-source", original.path, "a"),
      entry(original.kind, "a", "a"),
      { ...original, byteLength: original.byteLength + 1 },
      { ...original, sha256: "b".repeat(64) },
    ];
    for (const mutation of mutations) {
      const result = derive([mutation]);
      if (!result.ok) throw new Error(result.error.reason);
      expect(result.value.identity).not.toBe(baseline.value.identity);
      expect(result.value.identity).toBe(referenceDigest([mutation]));
    }
  });
});
