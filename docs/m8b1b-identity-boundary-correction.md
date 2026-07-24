# M8b.1b identity-boundary correction

Status: `complete-offline-pass`

Parent correction: `1f32d5a83021bf57ad1c45b7ee2449fd97e26485`

## Root cause

M8b.1a corrected canonicalization and `parseJson`, but two downstream Zod
schemas still reconstructed arbitrary JSON:

- `constantNodeSchema.value` reconstructed a parsed plan constant before plan
  canonicalization and hashing.
- `replayEntrySchema.value` reconstructed an effect result after its output
  digest was calculated.

Zod 4.4.3 omits an own enumerable `__proto__` property while reconstructing
these records. The first path could collapse distinct plans onto one plan
identity. The second could persist a value that no longer matched the digest
calculated from the original result.

## Correction

Private strict JSON schemas now call the M8b.1a canonical validator as a Zod
custom predicate. Zod returns the exact input value from these schemas; it does
not rebuild arrays or objects. The boundary therefore:

- preserves every valid own enumerable string key, including root and nested
  `__proto__`;
- rejects unsupported prototypes, accessors, symbols, non-enumerable state,
  sparse arrays, cycles, undefined values, non-finite numbers, BigInt,
  functions, typed arrays, and proxies; and
- never acts as a normalizer or repair mechanism.

The primitive is private. No public export or command was added.

## Identity-bearing boundary inventory

| Area                | Boundary                                     | Disposition                                          |
| ------------------- | -------------------------------------------- | ---------------------------------------------------- |
| Kernel plans        | Constant node value                          | Corrected to strict non-transforming JSON            |
| Kernel replay       | Recorded and parsed replay value             | Corrected to strict non-transforming JSON            |
| Kernel catalog      | Post-validator JSON invariant                | Corrected to strict rejection without reconstruction |
| Kernel parser       | Parsed JSON result                           | Reuses the strict non-transforming schema            |
| CLI execution       | Input-object loading                         | Corrected to a non-transforming object check         |
| Evidence runtime    | M5 named input values                        | Corrected to strict non-transforming JSON            |
| Generator cases     | Hidden inputs, effects, and expected outputs | Corrected                                            |
| Generator adapters  | Recorded structured output                   | Corrected                                            |
| Generator transport | JSON Schema, enum, const, and property maps  | Corrected                                            |
| Catalog conformance | Pointwise and reducer fixture values         | Corrected                                            |
| Model records       | Reasoning settings and abstention witness    | Corrected                                            |
| Strategy records    | Literal parameter values                     | Corrected                                            |

No audited production use remains blocked pending protocol review.

## Remaining `z.json()` dispositions

Exactly two runtime calls remain:

1. `packages/kernel/src/wire.ts` contains a description-only constant schema. It
   is used solely to generate the public plan-language JSON Schema and never
   parses runtime data. Its canonical generated-schema digest remains
   `fe2063bb580e4e832f00eb9693d275fb32c477489cff7b33fd947b5fc3bd8e7c`,
   byte-identical to the M8b.1a source commit.
2. `apps/cli/tests/canonical-hardening.test.ts` intentionally uses `z.json()` as
   the alpha.3 behavioral oracle for the fixed-seed differential test. It is
   test-only and never produces a product identity.

Type-only `ReturnType<typeof z.json>` references derive JSON wire types but do
not instantiate or parse with `z.json()`.

## End-to-end evidence

The regression crosses the supported public workflow:

1. parse a plan containing a constant with an own `__proto__`;
2. compile it and compare it with the otherwise-identical omitted-property plan;
3. inspect distinct canonical plans and plan hashes;
4. execute and observe the property intact;
5. record an effect result carrying the property;
6. verify the stored digest against the stored value;
7. serialize and parse the replay entry; and
8. replay the exact value after digest verification.

The sparse-array rejection fixture now contains a real hole:
`new Array<unknown>(2)` with only index 1 populated.

## Compatibility decision

The correction remains within `lachesis-canonical-json/1` and wire plan format
`1`. Valid JSON values unaffected by silent `__proto__` loss retain the same
canonical bytes. Existing replay fixtures, plan hashes, catalog fingerprints,
and manifests pass unchanged.

The public plan-language schema is generated through a description-only
companion so its frozen canonical bytes do not change. Public export inventory,
package versions, and dependency graph are unchanged.

## Verification

- Fixed-seed campaigns: 100,000 parse/idempotence, 100,000 alpha.3 differential,
  and 50,000 distinct UTF-16 key cases passed with seed `1832432033`.
- Focused canonicalization and kernel boundary tests: 46/46 passed.
- Complete suite: 26 files and 392 tests passed.
- Coverage: 90.06% statements, 80.14% branches, 97.20% functions, and 94.12%
  lines.
- Historical M8b.0, M8b.1, and M8b.1a artifacts verify from their bound commits.
- Current M8b.1b artifacts verify through `docs/m8b1b-results.sha256`.

The aggregate frozen release audit retains its pre-existing expected mismatch
for `.github/workflows/release.yml`, which was changed by the separately
authorized workflow-only correction after the alpha.3 release-source binding.
All other release artifacts pass.

## Boundary

M8b.1 Stage 2 did not start. No public command, public export, dependency,
package version, release metadata, provider call, or research workflow changed.
