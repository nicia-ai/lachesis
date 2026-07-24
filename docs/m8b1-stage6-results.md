# M8b.1 Stage 6 registry-only product gate

Status: `blocked`

Baseline: `0e76d35a6f9f397f0ed235ab12efe7b02f940a0c`

Stage 6 closes M8b.1 without publishing. The implemented CLI behavior passed the
registry-only product workflow, but the package is not release-ready: its
manifest remains private, its registry README and description describe the old
workspace-only product, the unchanged default-parallel release test gate has a
reproduced contention-sensitive timeout, and the baseline release-checksum
command compares the authorized corrected workflow with an older frozen
pre-correction digest.

## Registry-only result

The audit packed `@nicia-ai/lachesis-cli` from the exact baseline and installed
the local, unpublished tarball into two fresh directories outside the
repository. That tarball was the only unavoidable local artifact. All Lachesis
and transitive dependencies resolved from the public npm registry; there were no
workspace, link, Git, private-registry, or unexpected file dependencies.

Both consumers used Node 24.18.0 and TypeScript 6.0.3 with strict checking and
`skipLibCheck:false`. After installation, Node networking modules were
intercepted to fail closed. A third detached-verification run passed in
`node:24.18.0-bookworm-slim` with `--network none` and a read-only root.

The black-box matrix passed:

- manifest `--check`, `--out`, source-bound `--verify`, no-clobber, `--replace`,
  invalid-catalog, and identity-mismatch paths;
- structural exact exit `0` and review-required exit `10`;
- finite conformant exit `0`, declaration-repairable exit `11`, genuine
  non-equivalence exit `12`, insufficient-evidence exit `13`, and policy-review
  exit `10`;
- no conformance artifact for rejected finite assessments and a verified
  two-artifact transaction for a conformant assessment;
- detached verification of eight produced report kinds, including integrity
  success for valid source reports recording exits `10`–`13`; and
- rejection of command-identity, nested-identity, checksum, semantic-digest,
  summary, exit, completeness, and artifact-set tampering.

The generator package was physically unavailable during manifest, structural
compare, and detached verification and those paths still passed. Suite mode
passed only after the generator package was restored. No provider call,
credential access, catalog import during detached verification, or network
attempt occurred.

## Package boundary

Three consecutive packs produced the same 66,655-byte tarball:

`1cd3653a30f32e83b69d222b02e6fa5f29816c0fd8b4909eb918bb668abce3a5`

The tarball expands to 355,846 bytes. Its `lachesis` binary has mode `0755` and
the expected Node shebang. It contains ESM JavaScript and source maps, README,
license, and package metadata. It intentionally has no supported import surface
or declaration files: the proposed package boundary is binary-only. CommonJS
loading failed and remains explicitly unsupported.

The complete installed strict-consumer environment is 38,394,299 bytes. It has
three direct runtime dependencies, two direct development/toolchain
dependencies, 11 unique installed packages, and 12 recorded dependency edges.
Every registry package has a recorded npm origin and lockfile integrity; the
only local origin is the CLI tarball under test. Installed licenses are
Apache-2.0 and MIT.

All 25 regular tarball files and 27 generated JSON reports were scanned. No
absolute repository or temporary path, credential marker, environment value,
private registry, workspace resolution, or private package name was found.
Workers-portable package boundaries remained unchanged; the CLI introduced no
public export or Node type into them.

## Non-contractual measurements

Measurements were taken on Darwin arm64 25.5.0 using a host temporary
filesystem, Node 24.18.0, and pnpm 10.33.0. Each startup path records its first
process separately and summarizes seven additional independent processes with
the median and median absolute deviation (MAD):

| Path                       | First process | Repeated median ± MAD |
| -------------------------- | ------------: | --------------------: |
| Usage                      |     68.270 ms |     68.616 ± 0.446 ms |
| Manifest check             |     77.702 ms |     79.716 ± 2.041 ms |
| Structural compare         |     87.067 ms |     83.487 ± 0.870 ms |
| Detached verify            |     84.352 ms |     78.295 ± 0.887 ms |
| First suite-backed compare |    168.091 ms |    165.354 ± 2.972 ms |

The two clean installs took 660.891 ms and 604.855 ms. Peak RSS is not claimed:
a sufficiently reliable portable measurement was not available. These values are
observations, not performance promises.

## Determinism and filesystem safety

The two clean consumers produced byte-identical reports. Reordered flags
produced byte-identical reports where the protocol promises order independence.
Alias, leaf and parent symlink, oversized input, stale temporary path, and
no-clobber paths passed in the black-box audit. The focused Stage 2a–5.1 matrix
covers bounded-read mutation, interrupted reads, rollback, replacement, and
post-commit cleanup.

The boundary remains intentionally narrow: these protections cover the frozen
controller and tested mutation model. They do not claim kernel-atomic isolation
from a malicious concurrent process running as the same OS user.

## Flake audit

Stage 6 reproduced the reported release-gate failure without changing the test
or timeout. A default-parallel full run passed 442/443 tests, while the M2
provider-pool test timed out at 5,004 ms. Five isolated runs of that same test
all passed, with test durations from 3.16 to 3.50 seconds. Bound Stage 5.1
evidence records two additional default-parallel full-run timeouts and a 443/443
single-worker coverage pass.

This is a contention-sensitive default-parallel timeout. The current
`verify:release` script invokes the failing default `pnpm test` command, so it
can fail nondeterministically. It is a release-readiness blocker. A separate
review should correct the test workload or timing model; Stage 6 does not hide
the issue by serializing the default gate, increasing its timeout, or weakening
coverage.

The remaining release-checksum audit also fails closed, but not because Stage 6
changed a frozen file. Its manifest binds the workflow bytes that preceded the
authorized workflow-only correction; the baseline now contains that later
correction. The historical alpha.3 bytes remain immutable. Before another
release gate can be authoritative, a separate correction must replace this
current-tree comparison with a commit-aware historical audit.

## Release assessment

`@nicia-ai/lachesis-cli` should become the sixth public Lachesis package. Its
first public version should align with the next repository alpha
(`0.1.0-alpha.4`) rather than establish an independent version line. Only the
CLI and packages with actual code, dependency, or metadata changes should be
published; unchanged alpha.3 packages do not need a synchronized republish.

The proposed CLI is experimental public alpha, ESM-only, binary-only, named
`lachesis`, and supports Node `>=24 <25`. For the current code its runtime
dependencies remain exact: `@nicia-ai/lachesis@0.1.0-alpha.3`,
`@nicia-ai/lachesis-generator@0.1.0-alpha.3`, and `zod@4.4.3`.

The exact prospective metadata and documentation changes are in
[`prospective-release-delta.json`](m8b1-stage6/prospective-release-delta.json).
No release authorization text is provided because the decision is `blocked`.

## Verification matrix

- Formatting, strict TypeScript, lint, build, source-safety, public-API
  inventory, Node smoke, Workers dry-run, and seven offline examples passed.
- All eight CLI test files passed 120/120 focused tests. The Stage 4 packed
  strict consumer and every historical M8b checksum audit through Stage 5.1
  passed.
- The complete single-worker coverage matrix passed 443/443 tests with 90.04%
  statements, 80.36% branches, 97.17% functions, and 94.06% lines.
- The public-package packed consumer, M7c preregistration integrity check, and
  source/package boundary checks passed. The package audit's generated alpha.3
  report was not retained; the frozen alpha.3 digest record remains unchanged.
- The Stage 6 registry-only harness passed three independent executions. Each
  execution itself created two clean host consumers and a network-disabled Linux
  verification, and each produced the same CLI tarball digest.
- The unchanged default-parallel full test command failed at 442/443 as recorded
  in the flake audit. The release-checksum command failed only its stale
  current-tree workflow comparison; all other bound files passed. Both failures
  are explicit blockers rather than hidden green results.
- JSON parsing, checksum verification, `git diff --check`, and repository
  integrity passed before commit.

## Nonclaims

This gate establishes offline product behavior for the frozen registry-only
fixtures. It does not establish semantic equivalence beyond finite supplied
evidence, compositional generalization, model quality, provider behavior,
same-user kernel isolation, or release readiness. It made no provider call and
changed no public API, report protocol, dependency, package version, or release
metadata.
