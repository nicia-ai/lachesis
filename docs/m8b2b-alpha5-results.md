# M8b.2b alpha.4 closure and alpha.5 release candidate

Decision: `release-candidate-prepared-not-authorized`.

The synchronized alpha.4 attempt is closed as
`partial-bootstrap-only-verification-no-go`. The published
`@nicia-ai/lachesis-cli@0.1.0-alpha.4` remains valid and immutable. The other
five alpha.4 versions remain absent. The alpha.4 tag and draft release were not
moved, rewritten, or published; no dist-tag changed and no package was
unpublished or fabricated.

## Parity root cause and correction

The evidence-TypeGraph parity test is a CPU-bound identity matrix: 30
development tasks across two provider identities, with 120 evidence-view
compilations and 120 provenance reconstructions. A representative 8.843-second
run spent only 96.420 milliseconds creating and snapshotting the TypeGraph
repository; almost all wall time was divided between the four compile and
reconstruction passes.

Current uncontended runs ranged from 8.826 to 10.137 seconds. Controlled
contention produced 14.079 to 17.447 seconds before correction. Alpha.3 and the
test's introducing commit were not materially faster, so the investigation found
no product regression and no newly introduced redundant computation. The
20-second anti-hang bound lacked an empirical contention margin.

The separately committed correction changes only that test's timeout from 20 to
40 seconds. It preserves all 60 task/provider assignments, all 240 expensive
operations, every assertion, and every fixture. Five clean validation runs
completed in 9.721–10.163 seconds; three constrained runs completed in
18.745–20.964 seconds, leaving 19.036 seconds at the slowest observed point.

## Alpha.5 release candidate

All six public packages are synchronized at `0.1.0-alpha.5`, and every internal
Lachesis dependency is exact alpha.5. No implementation, public export, report
protocol, semantic rule, assertion, or fixture population changed. The
evidence-TypeGraph package includes only synchronized dependency metadata and
the unpacked test-infrastructure correction.

Each tarball reproduced byte-identically over three packs. A fresh host consumer
installed the prospective six-package set without workspace imports or alpha.3
fallback, compiled with TypeScript 6.0.3 and `skipLibCheck: false`, and
exercised all three CLI commands. A separate network-disabled Linux consumer
passed with a read-only root, dropped capabilities, and `no-new-privileges`.

The complete repository matrix passed: formatting, strict typechecking, lint,
443 default-parallel tests, 443 single-worker coverage tests, all coverage
thresholds, build, Node and Workers smokes, seven offline examples, load
baseline, source-safety audit, public API inventory, historical checksums, M7c
preregistration integrity, packed-package audit, and workflow static validation.

The public registry preflight found alpha.5 absent for all six packages. The
five libraries remain at `alpha=0.1.0-alpha.3` and `latest=0.1.0-alpha.1`; the
CLI remains at both `alpha=latest=0.1.0-alpha.4`.

The existing `release.yml` is bound to publish the complete six-package set
through npm trusted-publishing OIDC only. It contains no bootstrap workflow or
npm-token path. No push, tag, GitHub release, credential access, provider call,
publication, or dist-tag mutation occurred during this preparation.

Finite conformance evidence remains finite. Detached verification establishes
artifact integrity, not semantic acceptance. This candidate makes no
model-quality, provider, TypeGraph-superiority, or compositional-generalization
claim.
