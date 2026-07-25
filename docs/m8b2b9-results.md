# M8b.2b.9 alpha.4 closure and parity investigation

The synchronized alpha.4 attempt is closed as
`partial-bootstrap-only-verification-no-go`.

`@nicia-ai/lachesis-cli@0.1.0-alpha.4` remains the one valid, immutable
publication. The other five alpha.4 versions remain absent. The annotated tag
and draft GitHub prerelease remain unchanged and unpublished. No dist-tag was
changed, no package was unpublished or fabricated, and every prior failure and
the successful CLI bootstrap remain append-only.

No alpha.5 work has started.

## Root cause

The parity timeout is not a product regression. It is an empirically invalid
aggregate wall-clock bound.

The test covers 30 development tasks and two provider profiles. For each of the
60 task/provider assignments it compiles both the in-memory reference graph and
the TypeGraph snapshot, then reconstructs provenance from both compiled views.
That is 120 full compiles and 120 full provenance reconstructions.

A representative 8.843-second run spent:

- 83.457 ms creating the TypeGraph repository;
- 12.963 ms taking the snapshot;
- 2,124.562 ms compiling reference-graph inputs;
- 2,117.000 ms compiling snapshot-graph inputs;
- 2,206.519 ms reconstructing snapshot-graph provenance; and
- 2,177.924 ms reconstructing reference-graph provenance.

Per-call task/provider measurements ranged from 28.270 to 62.401 ms. The machine
record preserves the category/provider measurement boundary and phase range.

## Historical and distribution evidence

Current uncontended runs ranged from 8.826 to 10.137 seconds, with a 8.920
second median. Alpha.3 ran in 9.173 seconds warm. The introducing commit
`a52f39e32877bc8cac844d50409b4970b0a3019f` ran in 10.020 seconds warm. There is
no commit at which this test materially regressed.

With 13 controlled CPU burners on the 14-core host and the test process at nice
15, completed runs ranged from 14.079 to 17.447 seconds. The prior GitHub jobs
were censored by the unchanged 20-second timeout. The test was introduced with
the full matrix and that fixed bound; it was never calibrated with a contention
margin.

The diagnostic used an ephemeral 120-second ceiling only. The source remains at
20 seconds in this commit.

The recent strict canonicalization corrections are not the cause. TypeGraph
repository and snapshot creation are also not the cause. A temporary
parallel-pair experiment remained CPU-bound and did not materially reduce wall
time. Removing compiles, reconstructions, tasks, providers, or assertions would
weaken the parity population, so no implementation or fixture reduction is
accepted.

## Prospective correction

The proposed correction is a test-specific 40-second timeout. This exceeds twice
the measured constrained maximum:

`2 × 17.446546 s = 34.893092 s`, rounded up to `40 s`.

That leaves 22.553 seconds, or 129.27%, above the measured constrained maximum.
It changes no product code, assertion, fixture, task, provider, or release
artifact. It is an explicit anti-hang bound correction, not a silent relaxation
of semantic coverage.

The timeout correction must be a separate commit and pass repeated clean and
constrained runs before review. Alpha.5 preparation remains blocked until that
separate correction is committed and reviewed.
