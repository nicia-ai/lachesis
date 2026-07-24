import { canonicalizeJson, digestValue, parseJson } from "@nicia-ai/lachesis";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const FIXED_SEED = 0x6d_38_b1_a1;
const RANDOM_JSON_RUNS = 100_000;
const DISTINCT_KEY_RUNS = 50_000;

const jsonValueSchema = z.json();
type JsonValue = z.infer<typeof jsonValueSchema>;

function unwrapCanonical(value: unknown): string {
  const result = canonicalizeJson(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function legacySerialize(value: JsonValue): string {
  if (value === null) return "null";
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => legacySerialize(item)).join(",")}]`;
  }
  const entries = Object.entries(value).toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${legacySerialize(item)}`)
    .join(",")}}`;
}

function alpha3Canonicalize(value: unknown): string | undefined {
  const parsed = jsonValueSchema.safeParse(value);
  return parsed.success ? legacySerialize(parsed.data) : undefined;
}

function hasOwnProtoKey(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, "__proto__")) return true;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor !== undefined &&
      "value" in descriptor &&
      hasOwnProtoKey(descriptor.value)
    ) {
      return true;
    }
  }
  return false;
}

function parseFixture(text: string): unknown {
  const parsed = parseJson(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function objectWithKey(key: string, value: JsonValue): unknown {
  return { [key]: value };
}

function optionalIdentity(optional?: string): unknown {
  return {
    protocol: "m8b1a-optional-identity/1",
    required: "bound",
    ...(optional === undefined ? {} : { optional }),
  };
}

const arbitraryUtf16Key = fc
  .array(fc.integer({ min: 0, max: 0xffff }), {
    minLength: 1,
    maxLength: 12,
  })
  .map((units) => String.fromCharCode(...units));

describe("M8b.1a canonicalization hardening", () => {
  it("preserves root and nested own __proto__ properties without collision", () => {
    const root = parseFixture('{"__proto__":{"polluted":true},"safe":1}');
    const nested = parseFixture(
      '{"outer":{"__proto__":{"polluted":true},"safe":1}}',
    );

    expect(unwrapCanonical(root)).toBe(
      '{"__proto__":{"polluted":true},"safe":1}',
    );
    expect(unwrapCanonical(nested)).toBe(
      '{"outer":{"__proto__":{"polluted":true},"safe":1}}',
    );
    expect(unwrapCanonical(root)).not.toBe(unwrapCanonical({ safe: 1 }));
  });

  it("preserves special and escaped property names exactly", () => {
    const keys = [
      "__proto__",
      "constructor",
      "prototype",
      "__defineGetter__",
      "__defineSetter__",
      '"quoted"',
      "\\backslash\\",
      "line\nbreak",
      "\u0000control",
      "é",
      "e\u0301",
      "漢字",
      "\ud800",
      "\udfff",
    ];

    for (const key of keys) {
      const canonical = unwrapCanonical(objectWithKey(key, true));
      const reparsed = parseFixture(canonical);
      expect(Object.prototype.hasOwnProperty.call(reparsed, key)).toBe(true);
      expect(unwrapCanonical(reparsed)).toBe(canonical);
    }
  });

  it("is insertion-order invariant with special keys", () => {
    const left = parseFixture(
      '{"z":1,"__proto__":2,"constructor":3,"prototype":4}',
    );
    const right = parseFixture(
      '{"prototype":4,"constructor":3,"__proto__":2,"z":1}',
    );

    expect(unwrapCanonical(left)).toBe(unwrapCanonical(right));
  });

  it("requires optional identity fields to be deliberately omitted", async () => {
    const deliberate = optionalIdentity();
    const omitted = optionalIdentity();
    const present = optionalIdentity("present");

    expect(await digestValue(deliberate)).toEqual(await digestValue(omitted));
    expect(await digestValue(present)).not.toEqual(await digestValue(omitted));
    expect(
      await digestValue({
        protocol: "m8b1a-optional-identity/1",
        required: "bound",
        optional: undefined,
      }),
    ).toMatchObject({ ok: false });
  });

  it("keeps arbitrary distinct keys distinct with a fixed reproducible seed", () => {
    fc.assert(
      fc.property(arbitraryUtf16Key, arbitraryUtf16Key, (leftKey, rightKey) => {
        fc.pre(leftKey !== rightKey);
        expect(unwrapCanonical(objectWithKey(leftKey, 1))).not.toBe(
          unwrapCanonical(objectWithKey(rightKey, 1)),
        );
      }),
      {
        seed: FIXED_SEED,
        numRuns: DISTINCT_KEY_RUNS,
        verbose: 1,
      },
    );
  }, 30_000);

  it("is parse/canonicalize idempotent over a fixed broad JSON corpus", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const first = unwrapCanonical(value);
        const parsed = parseJson(first);
        if (!parsed.ok) throw new Error(parsed.error.message);
        expect(unwrapCanonical(parsed.value)).toBe(first);
      }),
      {
        seed: FIXED_SEED,
        numRuns: RANDOM_JSON_RUNS,
        verbose: 1,
      },
    );
  }, 30_000);

  it("differs from alpha.3 only where alpha.3 silently loses __proto__", () => {
    let changedCases = 0;
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const corrected = unwrapCanonical(value);
        const alpha3 = alpha3Canonicalize(value);
        const affectedBySilentLoss = hasOwnProtoKey(value);
        if (affectedBySilentLoss) changedCases += 1;
        expect(corrected === alpha3).toBe(!affectedBySilentLoss);
      }),
      {
        seed: FIXED_SEED,
        numRuns: RANDOM_JSON_RUNS,
        verbose: 1,
      },
    );
    expect(changedCases).toBe(3);

    const affected = [
      parseFixture('{"__proto__":0}'),
      parseFixture('{"safe":1,"__proto__":{"nested":true}}'),
      parseFixture('{"outer":{"__proto__":false}}'),
      parseFixture('[{"__proto__":"preserve"}]'),
    ];
    for (const value of affected) {
      expect(alpha3Canonicalize(value)).not.toBe(unwrapCanonical(value));
      expect(unwrapCanonical(value)).toContain("__proto__");
    }
  }, 30_000);

  it("rejects non-JSON and observable hostile inputs", () => {
    class Unsupported {
      readonly value = 1;
    }

    const explicitUndefined = { absent: undefined, present: true };
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => 1,
    });
    const hidden = Object.defineProperty({}, "value", {
      enumerable: false,
      value: 1,
    });
    const symbolKey = Object.defineProperty({}, Symbol("value"), {
      enumerable: true,
      value: 1,
    });
    const sparse = Array.from({ length: 2 });
    const extraArrayProperty = Object.defineProperty([1], "extra", {
      enumerable: true,
      value: 2,
    });
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const throwingProxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("hostile trap");
        },
      },
    );
    const transparentProxy = new Proxy({ safe: 1 }, {});

    const rejected: ReadonlyArray<unknown> = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1n,
      Symbol("value"),
      () => 1,
      new Date(0),
      new Map(),
      new Set(),
      new Uint8Array([1]),
      new Unsupported(),
      explicitUndefined,
      accessor,
      hidden,
      symbolKey,
      sparse,
      extraArrayProperty,
      cycle,
      throwingProxy,
      transparentProxy,
    ];

    for (const value of rejected) {
      expect(canonicalizeJson(value).ok).toBe(false);
    }
  });
});
