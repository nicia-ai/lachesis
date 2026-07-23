# M8a results

M8a is complete as `adoption-ready-with-docs-fixes`.

An empty external repository installed the selected `0.1.0-alpha.3` packages
from npm, with no workspace import or source checkout. TypeScript 6.0.3 passed
in strict mode with `skipLibCheck:false`. After installation, a macOS sandbox
denied all network access while the consumer compiled, executed with
deterministic mock evidence, verified citations and provenance, recorded,
exactly replayed with zero additional effect calls, evolved its catalog, ran
conformance, and rendered diagnostics twice.

The two JSON reports and two human reports were byte-identical. The Workers
portable path bundled in dry-run mode. Six negative outcomes were correctly
classified: four compile/policy failures, one declaration-repairable role
version mismatch, and one genuine capability mismatch with explicit
`do-not-substitute`.

## Verification matrix

| Verification                                                                                                                  | Result                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Fresh npm install from empty directory and empty cache                                                                        | PASS                                                                                 |
| Exact alpha.3 package versions; no workspace/file source                                                                      | PASS                                                                                 |
| No private, provider, TypeGraph, Drizzle, or SQLite package                                                                   | PASS                                                                                 |
| TypeScript 6 strict, `skipLibCheck:false`                                                                                     | PASS                                                                                 |
| Nine-operation catalog and versioned semantic roles                                                                           | PASS                                                                                 |
| Valid compile and deterministic mock execution                                                                                | PASS                                                                                 |
| Structural, obligation, capability, and budget rejections                                                                     | PASS                                                                                 |
| Citations and provenance links                                                                                                | PASS                                                                                 |
| Content-addressed record and exact zero-effect replay                                                                         | PASS                                                                                 |
| Compatible, declaration-repairable, and non-equivalent evolution                                                              | PASS                                                                                 |
| Diagnostic code, role/boundary, and repair/non-substitution guidance                                                          | PASS                                                                                 |
| Byte-identical JSON and human output                                                                                          | PASS                                                                                 |
| Post-install network denial and credential-free environment                                                                   | PASS                                                                                 |
| Node 24.18.0 execution                                                                                                        | PASS                                                                                 |
| Workers portable dry-run                                                                                                      | PASS                                                                                 |
| Repository format, types, lint, tests, coverage, build, smokes, examples, load, safety, API, preregistration, packed packages | PASS                                                                                 |
| Frozen alpha.3 checksums                                                                                                      | PASS at release source; current authorized workflow correction intentionally differs |

The aggregate `verify:release` command therefore stops at
`.github/workflows/release.yml`, after every preceding gate passes. This is the
expected immutable-release behavior: the frozen checksum matches the workflow at
release source `e972400a2ff4e65e4b2fe68bc2585f5453e82a06`; the current workflow
contains the separately authorized post-release correction. The remaining
preregistration and packed-package gates were run separately and passed. M8a
verification and its independent checksum audit also passed.

## Decision rationale

The API is sufficient, so the result is not `api-gap`. The workflow is stable
and automated, so it is not `no-go`. Documentation did not previously present
the external production path or distinguish diagnostic cardinalities, so the
result is `adoption-ready-with-docs-fixes` rather than `adoption-ready`.

Artifacts:

- [machine adoption report](../fixtures/m8a-registry-consumer/reports/m8a-adoption-report.json)
- [human diagnostics](../fixtures/m8a-registry-consumer/reports/m8a-diagnostics.md)
- [black-box measurement](m8a-black-box-measurement.json)
- [design and acceptance criteria](m8a-design.md)
- [getting started](m8a-getting-started.md)
- [CI and migration guide](m8a-conformance-ci.md)
- [adoption friction](m8a-adoption-friction.md)

No provider/model call occurred. M8a makes no compositional-generalization,
graph-superiority, TypeGraph-quality, or broader external-adoption claim.
