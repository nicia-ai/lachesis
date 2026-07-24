# M8b.1 stage 1 verification

Status: `complete-offline-pass`

Bound design commit: `b65be65842f7346da1374b29a2bd76cf70c4cbbe`

## Result

The reviewed report contract now has a private implementation under
`apps/cli/src/internal`. No command, package export, dependency, package
version, or existing CLI behavior changed.

The implementation provides:

- strict `lachesis-catalog-command-report/1` schemas;
- `lachesis-canonical-json/1` serialization with exactly one trailing newline;
- summaries, status, and exit codes derived only from detailed records;
- frozen exit precedence `70 → 23 → 22 → 20 → 12 → 13 → 11 → 21 → 10 → 0`;
- content-addressed report and nested diagnostic identities;
- external-artifact checksum and semantic-identity verification;
- separate validation-attempt and catalog-conformance diagnostic sections;
- phase-distinct initial and post-repair migration outcomes; and
- stable, terminal-safe human diagnostics that never accept a conditional repair
  and prominently render `DO NOT SUBSTITUTE`.

## Focused evidence

- 23 focused unit, property, mutation, and hostile-input tests pass.
- Ten machine-report and ten human-rendering golden fixtures cover every
  semantic exit class.
- Regenerating the goldens produces byte-identical files.
- The implementation's conformance-diagnostic schema is canonically identical to
  the reviewed documentation schema.
- Coverage includes all four new private modules: 88.38% statements, 81.46%
  branches, 93.58% functions, and 90.80% lines.
- Canonicalization rejects undefined values, non-finite numbers, BigInt, cycles,
  sparse arrays, symbols, accessors, hostile prototypes, proxies, and
  unsupported objects. Accepted plain data is insertion-order independent.

## Repository verification

| Gate                                      | Result                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Formatting                                | pass                                                                      |
| Strict TypeScript                         | pass                                                                      |
| Type-aware lint                           | pass                                                                      |
| Tests                                     | pass — 25 files, 382 tests                                                |
| Coverage                                  | pass — 90.05% statements, 80.09% branches, 97.19% functions, 94.12% lines |
| Build                                     | pass                                                                      |
| Node and Workers smokes                   | pass                                                                      |
| Existing CLI valid/invalid behavior       | pass                                                                      |
| Examples                                  | pass                                                                      |
| Load baseline                             | pass                                                                      |
| Source-safety audit                       | pass                                                                      |
| Public API inventory                      | pass; no delta                                                            |
| Packed packages and consumers             | pass                                                                      |
| M8a registry-only adoption                | pass                                                                      |
| M8b.0 design checksum                     | pass                                                                      |
| `git diff --check`                        | pass                                                                      |
| Frozen alpha.3 release checksum aggregate | expected historical mismatch only                                         |

The aggregate alpha.3 checksum command checks the immutable prerelease manifest
against the current `.github/workflows/release.yml`. That workflow was changed
later by the separately authorized workflow-only correction commit
`f2a62fe583feca3a6ce7bc26fb77d2e2c3cd3c6b`. The frozen manifest and corrected
workflow are both preserved; no M8b.1 file participates in that mismatch.

One coverage attempt hit the existing 20-second TypeGraph parity timeout under
instrumentation. An unchanged retry passed all 382 tests and the coverage
thresholds. One ordinary property-test attempt also found a pre-existing kernel
canonicalization counterexample involving quote and backslash characters in an
arbitrary object key. An unchanged retry passed all 382 tests. M8b.1 report
object keys are fixed by strict schemas, so this does not alter the stage
result; the kernel defect is neither fixed nor hidden by this milestone.

## Boundaries

This is an internal contract-library milestone. It does not expose or wire a
command, establish catalog compatibility by itself, authorize automatic repair,
change the alpha.3 API, prepare a release, begin M8b.2, call a provider, or
create research evidence.
