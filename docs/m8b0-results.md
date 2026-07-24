# M8b.0 results

Disposition: `design-complete-go-for-internal-m8b1`

M8b.0 designed a three-command catalog-author and CI surface without changing a
public command, export, package version, or package publication state.

## Result

- Recommended surface: `catalog manifest`, `catalog compare`, and
  `report verify`.
- Existing package owner: the private Node-only `apps/cli` package.
- Public API delta required: none.
- New package or binary required: no.
- Machine contract: `lachesis-catalog-command-report/1`.
- Exit contract: stable 0, 10–13, 20–23, 64, and 70 classes.
- Prototype status: private design fixture only.
- M8b.1 decision: GO for internal implementation; publication remains separately
  gated.

## Prototype evidence

The private `studies/m8b0-cli-contract` prototype:

- validates the strict report schema with Zod;
- derives summaries and exit codes from detailed records;
- keeps plan/validation diagnostics separate from conformance diagnostics;
- verifies nested diagnostic and envelope identities;
- keeps initial and post-repair outcomes distinct;
- structurally forbids automatic repair acceptance;
- requires `do-not-substitute` for genuine semantic differences; and
- generates canonical JSON and deterministic human goldens.

The prototype is not exported, is not wired into `apps/cli`, and is not a
supported command implementation.

## Documents

- [CLI product specification](m8b0-cli-product-spec.md)
- [Machine report contract](m8b0-report-contract.md)
- [JSON Schema](m8b0-machine-report.schema.json)
- [Exit codes](m8b0-exit-codes.md)
- [Human-output goldens](m8b0-human-output-goldens.md)
- [Packaging and API assessment](m8b0-packaging-api-assessment.md)
- [Threat and misuse analysis](m8b0-threat-and-misuse-analysis.md)
- [Implementation plan](m8b0-implementation-plan.md)

## Verification matrix

| Gate                                           | Result                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| Private contract typecheck/build/generate/test | PASS — 6 tests                                                            |
| JSON Schema/source-schema canonical equality   | PASS                                                                      |
| Repeated golden generation and byte comparison | PASS                                                                      |
| Workspace format check                         | PASS                                                                      |
| Strict recursive TypeScript 6 typecheck        | PASS                                                                      |
| Type-aware lint                                | PASS                                                                      |
| Existing test suite                            | PASS — 24 files, 359 tests                                                |
| Coverage suite                                 | PASS — 90.12% statements, 80.03% branches, 97.33% functions, 94.26% lines |
| Recursive build                                | PASS                                                                      |
| Node package smoke                             | PASS                                                                      |
| Workers dry-run smoke                          | PASS                                                                      |
| Seven offline public-alpha examples            | PASS                                                                      |
| Source-safety audit                            | PASS                                                                      |
| Public API inventory audit                     | PASS — no export change                                                   |
| Packed-package/strict-consumer audit           | PASS                                                                      |
| Checksum manifest                              | PASS                                                                      |
| `git diff --check`                             | PASS                                                                      |

## Nonclaims

M8b.0 does not establish CLI usability, registry adoption, semantic equivalence,
model quality, compositional generalization, provider behavior, or release
readiness. It made no provider call and performed no research study.
