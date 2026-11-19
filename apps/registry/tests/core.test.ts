import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  chainErrors,
  createManifest,
  decodeCanonical,
  encodeCanonical,
  entryFileName,
  type LoadedEntry,
  manifestErrors,
  sha256Hex,
  witnessError,
} from "../src/core.js";
import {
  ENTRY_PROTOCOL,
  entrySchema,
  type RegistryEntry,
} from "../src/schema.js";
import { parseTimestampTime } from "../src/timestamp.js";

const PUBLIC_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGkA9Wc1rF6pV0Y0J6l5y3x8w7v6u5t4s3r2q1p0o9n8";
const DIGEST = "a".repeat(64);
const COMMIT = "b".repeat(40);

const pathArbitrary = fc
  .array(fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,8}$/), {
    minLength: 1,
    maxLength: 3,
  })
  .map((parts) => parts.join("/"))
  .filter((path) =>
    path.split("/").every((part) => part !== "." && part !== ".."),
  );

const filesArbitrary = fc.uniqueArray(
  fc.record({ path: pathArbitrary, bytes: fc.uint8Array({ maxLength: 64 }) }),
  { minLength: 1, maxLength: 8, selector: (file) => file.path },
);

function encodeEntry(entry: RegistryEntry): Uint8Array {
  const encoded = encodeCanonical(entry);
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
}

function buildChain(length: number): ReadonlyArray<LoadedEntry> {
  const chain: Array<LoadedEntry> = [];
  for (let sequence = 0; sequence < length; sequence += 1) {
    const previous = chain.at(-1);
    const entry: RegistryEntry =
      previous === undefined
        ? {
            protocol: ENTRY_PROTOCOL,
            study: "m9",
            sequence,
            kind: "genesis",
            parentEntrySha256: null,
            signer: { principal: "sponsor", publicKey: PUBLIC_KEY },
            timestampAuthorities: [
              {
                name: "alpha",
                url: "https://alpha.example/",
                caBundleSha256: DIGEST,
              },
              {
                name: "beta",
                url: "https://beta.example/",
                caBundleSha256: DIGEST,
              },
            ],
            externalRoots: [],
          }
        : {
            protocol: ENTRY_PROTOCOL,
            study: "m9",
            sequence,
            kind: "registration",
            parentEntrySha256: sha256Hex(previous.bytes),
            revision: `r${sequence}`,
            manifestPath: "studies/m9/MANIFEST.json",
            manifestSha256: DIGEST,
            sourceCommit: COMMIT,
            authorizes: "probe",
          };
    chain.push({
      fileName: entryFileName(sequence),
      bytes: encodeEntry(entry),
      entry,
    });
  }
  return chain;
}

describe("manifest", () => {
  it("verifies exactly the files it was built from", async () => {
    await fc.assert(
      fc.asyncProperty(filesArbitrary, async (files) => {
        const manifest = createManifest(files);
        expect(manifest.ok).toBe(true);
        if (!manifest.ok) return;
        const byPath = new Map(files.map((file) => [file.path, file.bytes]));
        expect(
          await manifestErrors(manifest.value, "MANIFEST.json", (path) =>
            Promise.resolve(byPath.get(path)),
          ),
        ).toEqual([]);
      }),
    );
  });

  it("detects any changed or missing file", async () => {
    await fc.assert(
      fc.asyncProperty(
        filesArbitrary,
        fc.nat(),
        fc.boolean(),
        async (files, pick, remove) => {
          const manifest = createManifest(files);
          if (!manifest.ok) throw new Error(manifest.error.message);
          const target = files[pick % files.length];
          if (target === undefined) return;
          const changed = new Map(files.map((file) => [file.path, file.bytes]));
          if (remove) changed.delete(target.path);
          else changed.set(target.path, Uint8Array.from([...target.bytes, 1]));
          const errors = await manifestErrors(
            manifest.value,
            "MANIFEST.json",
            (path) => Promise.resolve(changed.get(path)),
          );
          expect(errors.map((error) => error.code)).toEqual([
            "CONTENT_MISMATCH",
          ]);
          expect(errors[0]?.message).toContain(target.path);
        },
      ),
    );
  });

  it("rejects paths that could escape the repository", () => {
    for (const path of ["../outside", "a/../b", "/absolute", "a//b", "./a"]) {
      const manifest = createManifest([{ path, bytes: new Uint8Array([1]) }]);
      expect(manifest.ok ? "accepted" : manifest.error.code).toBe(
        "MALFORMED_DOCUMENT",
      );
    }
  });

  it("rejects duplicate paths and self-listing", async () => {
    const bytes = new Uint8Array([1]);
    const duplicate = createManifest([
      { path: "a", bytes },
      { path: "a", bytes },
    ]);
    expect(duplicate.ok ? "accepted" : duplicate.error.message).toBe(
      "Manifest lists a twice.",
    );
    const manifest = createManifest([{ path: "MANIFEST.json", bytes }]);
    if (!manifest.ok) throw new Error(manifest.error.message);
    const errors = await manifestErrors(manifest.value, "MANIFEST.json", () =>
      Promise.resolve(bytes),
    );
    expect(errors.map((error) => error.message)).toEqual([
      "Manifest may not list itself.",
    ]);
  });
});

describe("canonical documents", () => {
  it("round-trips entries and rejects any other byte form of the same value", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.constantFrom(" ", "\n", "\t"),
        (length, padding) => {
          for (const loaded of buildChain(length)) {
            const decoded = decodeCanonical(loaded.bytes, entrySchema, "entry");
            expect(decoded.ok && decoded.value).toEqual(loaded.entry);
            const text = new TextDecoder().decode(loaded.bytes);
            const padded = new TextEncoder().encode(`${padding}${text}`);
            const rejected = decodeCanonical(padded, entrySchema, "entry");
            expect(rejected.ok ? "accepted" : rejected.error.code).toBe(
              "NON_CANONICAL",
            );
          }
        },
      ),
    );
  });

  it("rejects invalid UTF-8, non-JSON and schema violations", () => {
    const invalid = [
      new Uint8Array([0xff]),
      new TextEncoder().encode("not json"),
      new TextEncoder().encode('{"kind":"genesis"}\n'),
    ].map((bytes) => decodeCanonical(bytes, entrySchema, "entry"));
    expect(
      invalid.map((result) => (result.ok ? "accepted" : result.error.code)),
    ).toEqual([
      "MALFORMED_DOCUMENT",
      "MALFORMED_DOCUMENT",
      "MALFORMED_DOCUMENT",
    ]);
  });
});

describe("hash chain", () => {
  it("accepts any well-formed chain", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (length) => {
        expect(chainErrors("m9", buildChain(length))).toEqual([]);
      }),
    );
  });

  it("detects any dropped, swapped or relabelled entry", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 12 }),
        fc.nat(),
        fc.constantFrom("drop", "swap", "relabel"),
        (length, pick, mutation) => {
          const chain = [...buildChain(length)];
          const index = 1 + (pick % (length - 2));
          const current = chain[index];
          const next = chain[index + 1];
          if (current === undefined || next === undefined) return;
          switch (mutation) {
            case "drop":
              chain.splice(index, 1);
              break;
            case "swap":
              chain[index] = next;
              chain[index + 1] = current;
              break;
            case "relabel":
              chain[index] = {
                ...current,
                entry: { ...current.entry, study: "other" },
              };
              break;
          }
          const codes = chainErrors("m9", chain).map((error) => error.code);
          expect(codes.length).toBeGreaterThan(0);
          expect(new Set(codes)).toEqual(new Set(["CHAIN_BROKEN"]));
        },
      ),
    );
  });

  it("requires results to report on an earlier registration", () => {
    const chain = buildChain(2);
    const previous = chain[1];
    if (previous === undefined) throw new Error("chain too short");
    const result: RegistryEntry = {
      protocol: ENTRY_PROTOCOL,
      study: "m9",
      sequence: 2,
      kind: "result",
      parentEntrySha256: sha256Hex(previous.bytes),
      revision: "outcome",
      manifestPath: "studies/m9/MANIFEST.json",
      manifestSha256: DIGEST,
      sourceCommit: COMMIT,
      reportsOn: 0,
    };
    const withResult = [
      ...chain,
      { fileName: entryFileName(2), bytes: encodeEntry(result), entry: result },
    ];
    expect(chainErrors("m9", withResult).map((error) => error.message)).toEqual(
      ["m9/0002.json must report on an earlier registration entry."],
    );
    const valid = { ...result, reportsOn: 1 };
    expect(
      chainErrors("m9", [
        ...chain,
        { fileName: entryFileName(2), bytes: encodeEntry(valid), entry: valid },
      ]),
    ).toEqual([]);
  });
});

describe("witness comparison", () => {
  it("accepts identical logs and names the first divergence otherwise", () => {
    fc.assert(
      fc.property(
        fc.array(fc.uint8Array({ minLength: 1, maxLength: 16 }), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.nat(),
        (log, pick) => {
          expect(witnessError("w", log, log)).toBeUndefined();
          const cut = pick % log.length;
          expect(witnessError("w", log, log.slice(0, cut))?.message).toBe(
            `Witness w is missing entries from ${entryFileName(cut)}.`,
          );
          expect(witnessError("w", log.slice(0, cut), log)?.message).toBe(
            `Witness w has entries from ${entryFileName(cut)} that this checkout lacks.`,
          );
          const altered = log.map((bytes, index) =>
            index === cut ? Uint8Array.from(bytes, (byte) => byte ^ 1) : bytes,
          );
          expect(witnessError("w", log, altered)?.message).toBe(
            `Witness w differs at ${entryFileName(cut)}.`,
          );
        },
      ),
    );
  });
});

describe("timestamp text", () => {
  it("parses OpenSSL genTime with and without fractional seconds", () => {
    expect(
      parseTimestampTime("Time stamp: Nov  9 01:43:22 2026 GMT")?.toISOString(),
    ).toBe("2026-11-09T01:43:22.000Z");
    expect(
      parseTimestampTime(
        "Time stamp: Feb 28 23:59:59.5 2027 GMT",
      )?.toISOString(),
    ).toBe("2027-02-28T23:59:59.500Z");
    expect(
      parseTimestampTime("Time stamp: Foo 28 23:59:59 2027 GMT"),
    ).toBeUndefined();
    expect(parseTimestampTime("no time here")).toBeUndefined();
  });
});
