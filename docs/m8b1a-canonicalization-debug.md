# M8b.1a canonicalization hardening

Status: `complete-offline-pass`

Historical Stage 1 commit: `919b6d7946e9959c77a237c93339a7e00042e753`

## Debug report

Symptom: alpha.3 assigned identical canonical bytes to distinct valid JSON
values when one value contained an own enumerable `__proto__` property.

Root cause: `canonicalizeJson` serialized the transformed output of
`z.json().safeParse`. `parseJson` returned the same transformed representation.
Zod 4.4.3 reconstructs records and omits an own `__proto__` property during that
reconstruction.

Correction:

- `canonicalizeJson` now validates and serializes the original raw value through
  property descriptors without rebuilding it.
- `parseJson` returns the exact structure created by `JSON.parse` after the same
  strict, non-transforming validation.
- Accessors are inspected but never invoked. `toJSON` is never consulted.
- Undefined values, non-finite numbers, BigInt, symbols, functions, cycles,
  sparse arrays, extra array properties, accessors, unsupported prototypes,
  non-enumerable semantic state, and proxies rejected by structured cloning all
  fail closed.
- Root and nested `__proto__` keys are emitted with ordinary data-property
  semantics and cannot mutate a prototype.

## Protocol decision

The protocol remains `lachesis-canonical-json/1`.

Canonical JSON already requires all valid own enumerable string-keyed JSON
properties to participate in the content identity. Restoring `__proto__` is an
alpha compatibility correction to the existing algorithm, not a new
canonicalization algorithm. Non-JSON JavaScript state was never part of the
protocol domain; moving it from silent normalization to rejection enforces that
boundary.

## Trusted producer correction

Zod attaches non-enumerable runtime metadata to values returned by
`z.toJSONSchema`. Those values are not directly hashable under the corrected
boundary.

Four private trusted snapshot boundaries now:

1. invoke the bound `z.toJSONSchema` call themselves;
2. take a structured-clone snapshot, which excludes Zod's non-enumerable runtime
   metadata without invoking `toJSON`;
3. immediately validate the snapshot through strict canonical JSON; and
4. throw on unexpected enumerable non-JSON output.

The conversion never accepts a caller-supplied object, is not publicly exported,
and is not a general-purpose sanitizer. A hostile ordinary object cannot use it
to hide an identity-bearing property.

Affected producers:

| Package            | Producer                                          |
| ------------------ | ------------------------------------------------- |
| Kernel             | Scalar and collection runtime schema descriptions |
| Kernel             | Plan-language manifest schema                     |
| Evidence           | M3b oracle-output schema identity                 |
| Evidence           | M5 oracle request/output schema identities        |
| Private CLI        | M8b report-schema synchronization                 |
| M8b.0 design study | Checked-in schema generation and verification     |

Ordinary optional identity inputs remain responsible for conditionally omitting
absent properties. A regression proves explicit `undefined` is rejected while a
conditional spread produces the same identity as deliberate omission.

## Compatibility evidence

All fixed-seed campaigns use seed `1832432033` (`0x6d38b1a1`):

- 100,000 parse/canonicalize idempotence cases;
- 100,000 alpha.3 differential cases; and
- 50,000 distinct UTF-16 key pairs.

Exactly 3 of the 100,000 differential inputs changed. Every changed input
contained an own `__proto__` property that alpha.3 silently removed. No valid
JSON input outside that class changed. Exact vectors are recorded in
`docs/m8b1a-regression-evidence.json`.

The earlier quote/backslash failure remains unconfirmed and did not reproduce.
Fast-check failures report the fixed seed, counterexample, and shrink path.

The instrumented TypeGraph parity case passed 5/5 unchanged attempts in 17.06,
14.66, 14.78, 14.73, and 14.87 seconds. Its 20-second timeout was not altered;
the timeout concern is closed for this milestone.

## Verification

- Focused M8b.1a and report-contract tests: 32/32 passed.
- Complete suite with fixed-seed campaigns: 26 files and 391 tests passed.
- Coverage: 90.06% statements, 80.13% branches, 97.20% functions, and 94.11%
  lines.
- Kernel canonicalizer coverage: 96.96% statements, 92.98% branches, 100%
  functions, and 98.21% lines.
- Formatting, strict TypeScript 6, lint, source safety, builds, Node and Workers
  smokes, TypeGraph parity, packed consumers, public API inventory, M8a, M8b.0,
  and `git diff --check` passed.
- The aggregate historical release checksum command reached its pre-existing
  expected mismatch for `.github/workflows/release.yml`: the frozen alpha.3
  release-source manifest predates the separately authorized workflow-only
  correction. Every other artifact in that release checksum chain passed.
- Historical M8b.0 and M8b.1 records verify from their bound Git commits.
- The current tree verifies against `docs/m8b1a-results.sha256`.

## Boundaries

No public export, CLI command, dependency, package version, or protocol identity
changed. No package was prepared or published. No provider call or research work
occurred. M8b.1 Stage 2 has not started.
