# M8b.2a technical release gate

Status: `release-ready-with-docs-fixes`

Baseline: `9d414e0f3e695097457219e7a3c649bf813d7c57`

M8b.2a supersedes only the Stage 6 technical decision. The checksum-bound Stage
6 records remain immutable and continue to describe the originally observed
blocked gate.

## Outcome

All technical blockers identified by Stage 6 are closed:

- the prospective audit now installs exact current local artifacts for all six
  packages needed by the product path;
- no package in that prospective set falls back to registry alpha.3;
- the M2 contention-sensitive test uses a small, valid, digest-rebound campaign
  while preserving the production ledger and exhaustion invariant;
- ten consecutive default-parallel full test runs passed; and
- alpha.3 and Stage 5.1 historical checksum audits now read their immutable
  manifests and artifacts from their bound commits.

Only ordinary release preparation remains: public CLI metadata, synchronized
alpha.4 versions and internal dependency pins, changelogs and registry-facing
documentation, release notes, checksums, and a release-candidate rerun. M8b.2a
does not perform or authorize any of those changes.

## Exact package delta

The current public export inventory is identical to alpha.3 for all five
published packages.

The proposed alpha.4 publication closure is:

1. `@nicia-ai/lachesis` — implementation correction;
2. `@nicia-ai/lachesis-evidence` — implementation correction;
3. `@nicia-ai/lachesis-generator` — implementation correction;
4. `@nicia-ai/lachesis-runtime` — dependency-only synchronized republish;
5. `@nicia-ai/lachesis-evidence-typegraph` — dependency-only synchronized
   republish; and
6. `@nicia-ai/lachesis-cli` — first public candidate with new private command
   implementation and a generator runtime dependency.

Publishing runtime and evidence-typegraph is necessary even though their own
source is unchanged: an alpha.4 consumer must not resolve their Lachesis
dependencies back to alpha.3. The complete per-package classification is in
[`package-delta.json`](m8b2a/package-delta.json).

## Prospective registry methodology

The corrected harness binds the unchanged package source tree at the baseline
commit and produces three independently packed artifacts per package through a
deterministic staged manifest. Every package produced one byte-identical digest
across all three attempts.

Two clean external consumers installed all six local tarballs. Explicit pnpm
overrides closed the entire Lachesis dependency graph over those tarballs;
unrelated transitive dependencies alone came from the public npm registry. The
installed payload of each prospective package matched the content root extracted
from its tarball. The lockfile contained no workspace, link, GitHub, or registry
fallback for a prospective package.

After installation, the harness denied Node networking and exercised:

- strict TypeScript 6 with `skipLibCheck:false`;
- manifest check, output, source-bound verify, structural comparison, finite
  suite comparison, and detached report verification;
- all semantic process exits 0 and 10–13 plus invalid, mismatch, and incomplete
  exits 20, 22, and 23;
- command, summary, exit, completeness, semantic artifact, symlink, alias,
  oversize, no-clobber, and stale-temporary rejection;
- own root and nested `__proto__` keys through canonicalization, manifest
  identity, plan compilation, execution, effect recording, replay, generator
  suite parsing, and detached verification;
- distinct hostile values and plan identities, with hidden or unsupported
  JavaScript state rejected;
- generator lazy loading outside suite mode; and
- a read-only, network-disabled Linux container.

The second consumer reproduced the first consumer's report bytes and identity
evidence exactly. A separate install paired the prospective CLI with published
alpha.3 dependencies and passed its API smoke; that result is backward
compatibility only and is not prospective release evidence.

## M2 and default-parallel stability

The original M2 test derived the full held-out OpenAI pool. At 322,880
micro-dollars per call, the 35,000,000-micro-dollar pool admitted 108 complete
reserve/settle cycles. Each durable event causes the ledger to re-read and
verify its full hash chain, so the test created 216 growing-ledger events to
prove a single boundary. This was unnecessary fixture scale, amplified by
shared-worker contention; it was not an accounting failure.

The corrected test derives the same per-call maximum, rebinds a schema-valid
test campaign and phase manifest to exactly three calls (968,640 micro-dollars),
settles each conservatively, verifies exact accounting, and rejects the fourth
reservation. Production accounting, durable I/O, identities, reservation,
settlement, and exhaustion code are unchanged. The five-second M2 timeout is
unchanged.

During the first stability attempt, a distinct M3b.1 integration test exposed
its own contention margin. That test constructs the complete frozen 3,072-call
held-out phase and takes roughly 9–10 seconds alone. M8b.2a retained the full
fixture and every assertion and changed only its local timeout from 20 to 30
seconds. It did not alter production code.

After both corrections, ten newly counted consecutive default-parallel runs
passed 443/443 tests. Durations ranged from 54.034 to 75.924 seconds. No worker
serialization or global timeout override was introduced.

## Historical release integrity

The alpha.3 manifest remains byte-identical to the manifest at release commit
`e972400a2ff4e65e4b2fe68bc2585f5453e82a06`, with SHA-256
`002d4e1184fff8759637c51308a94df20af32775281afac410c8561918d8d24a`. The
commit-aware audit verified all ten historical artifacts, including the release
workflow at that commit. The current workflow may retain its separately
authorized post-release correction and invokes the same commit-aware audit.

The Stage 5.1 checksum command received the same correction because its frozen
manifest binds root `package.json`, which M8b.2a necessarily changes. Its
historical manifest and twelve artifacts verify at commit
`0e76d35a6f9f397f0ed235ab12efe7b02f940a0c`.

No alpha.3 manifest, release tag, release record, or Stage 1–6 evidence byte was
changed.

## Verification

- Default-parallel tests: 443/443 passed in the release matrix and in each of
  ten consecutive stability runs.
- Coverage: 90.04% statements, 80.36% branches, 97.17% functions, and 94.06%
  lines; every existing threshold passed.
- Formatting, strict typechecking, lint, build, Node smoke, Workers dry-run,
  seven offline examples, source safety, public API inventory, package audit,
  M7c preregistration integrity, M8a, M8b.0, and historical M8b checks passed.
- Two clean prospective host consumers, a network-disabled Linux run, and the
  separate alpha.3 compatibility consumer passed.
- No public export, report protocol, exit code, package version, release
  metadata, or frozen evidence changed.

The machine-readable matrix is [`verification.json`](m8b2a/verification.json).

## Nonclaims

This gate establishes finite offline integrity and adoption behavior for the
bound fixtures and artifacts. It does not establish general semantic
equivalence, compositional generalization, model quality, provider behavior, or
release publication readiness. No provider call occurred.

## Exact separate M8b.2b authorization text

> I authorize M8b.2b release preparation—but not publication—from M8b.2a's
> `release-ready-with-docs-fixes` commit. Prepare a synchronized `0.1.0-alpha.4`
> release candidate for exactly `@nicia-ai/lachesis`,
> `@nicia-ai/lachesis-evidence`, `@nicia-ai/lachesis-generator`,
> `@nicia-ai/lachesis-runtime`, `@nicia-ai/lachesis-evidence-typegraph`, and
> `@nicia-ai/lachesis-cli`. Make the CLI public, ESM-only, Node `>=24 <25`, with
> the existing `lachesis` binary; distinguish the three implementation
> corrections, the two dependency-only synchronized republishes, and the first
> CLI publication. Update only required package metadata, exact internal
> dependency pins, changelogs, README/package descriptions, public API
> inventory, release notes, checksums, packed artifacts, and audited workflow
> bindings. Re-run deterministic three-pack verification, clean registry-style
> consumers, strict TypeScript 6 with `skipLibCheck:false`, network-disabled
> Linux, the complete repository and historical checksum matrix, and verify no
> prospective package resolves an alpha.3 Lachesis dependency. Commit release
> preparation atomically and report the commit and tarball digests. Do not push,
> tag, publish, change dist-tags, create a GitHub release, make provider calls,
> begin M9, or claim general semantic equivalence or compositional
> generalization.
