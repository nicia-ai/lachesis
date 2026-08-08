# M9b.13k.1 verification

All executable verification ran under an operating-system policy denying network
access. The focused correction passed 12 tests, including hostile input,
caller-selected namespaces, a clean no-FD3 child exit, and proof that a
deliberately inherited FD3 remains open and unread. The corrected source has
100% statement, branch, function, and line coverage.

The complete serialized test and coverage runs each passed 76 files and 1,362
tests. Repository coverage was 90.04% statements, 81% branches, 97.45%
functions, and 93.72% lines. Strict typechecking, build, Node and Workers
smokes, source-safety, public-API, changed-file formatting and lint, secret
patterns, release checksums, M8 historical checksums, the predecessor manifest,
and predecessor byte preservation passed.

Three unrelated repository-wide exceptions remain recorded rather than
rewritten: 14 older M9 documents are not globally Prettier-clean, two older
M9b13h helper scripts are outside ESLint's project service, and the existing
generator package differs from its frozen alpha.5 tarball digest. The prior
M9b.13k verification already records the package mismatch. M9b.13k.1 changes no
publishable package source and its private controller is absent from build
output.

The effect-capable FD3, crash/restart, durable CAS, timeout/streaming, stable
object identity, and independent revocation suites cannot truthfully run because
their required real implementations are absent. No mock result is substituted
for them. No credential, PAT, network, OSF state, provider, or model was
accessed, and all real-effect counts are zero. The sealed decision is
`m9b13k1-correction-no-go`.
