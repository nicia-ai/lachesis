# Lachesis 0.1.0-alpha.3 release candidate

Status: **prepared, audited, and not published**.

This synchronized five-package candidate contains M7a commit
`ed37d0a379ae906555d86be1b0c4c528ba6e3932` and M7b commit
`085211a53c9424ca2a29141001ff9abf07cf4b1f`. It preserves the immutable M7a
report digest `8cc35372ec4f4f560180a2f26cf4edb46c9c298f49f21cc39f8df07cde19cf85`
and M7b report digest
`1dc71b40b919b69d177ed0986962f10f7b7311831dc63df0667891693a75b4c4`.

## Package delta from alpha.2

- `@nicia-ai/lachesis-generator` is the only behaviorally changed package. Its
  experimental root adds 13 structured catalog-diagnostic exports. The ordinary
  conformance acceptance path and rules are unchanged.
- `@nicia-ai/lachesis` is a documentation-only synchronized republish. It adds
  external catalog-author guidance but no exports or runtime behavior.
- `@nicia-ai/lachesis-evidence`, `@nicia-ai/lachesis-runtime`, and
  `@nicia-ai/lachesis-evidence-typegraph` are dependency-only synchronized
  republishes with no API or behavior changes.

There are no removed exports. The exact delta is recorded in
[`m7c-alpha3-package-delta.json`](m7c-alpha3-package-delta.json); the complete
alpha.3 surface is in
[`public-api-inventory-alpha.3.json`](public-api-inventory-alpha.3.json).

## Diagnostic boundary

The generator can now return typed rejection outcomes: `declaration-repairable`,
`genuinely-non-equivalent`, and `insufficient-evidence`. Stable codes are
independent of prose. Genuine semantic differences always recommend
non-substitution. Conditional declaration guidance cannot establish equivalence,
and no rejected M7 case became accepted.

## Packaging

All five public packages use `0.1.0-alpha.3` so packed workspace dependencies
resolve to one version. The candidate remains ESM-only, targets Node 24, keeps
portable roots compatible with Workers, and uses public npm access with the
`alpha` dist-tag if separately authorized. Private applications and fixtures
remain unpublished.

Packed artifacts are produced twice and required to be byte-identical. Their
SHA-256 digests, sizes, and file counts are frozen in
[`m7c-alpha3-tarball-digests.json`](m7c-alpha3-tarball-digests.json). A fresh
temporary consumer installs only those local tarballs, type-checks under
TypeScript 6 with `skipLibCheck: false`, runs ESM smokes, and builds a Workers
bundle without credentials or network package resolution.

## Claims and authorization

This candidate does not execute M7c, establish evidence about independent agents
or humans, authorize provider calls, promote a strategy, begin M8, or establish
compositional generalization.

Publication requires a separate user instruction matching this exact text after
replacing the bracketed value with the audited 40-hex release commit:

> I authorize publication of all five Lachesis 0.1.0-alpha.3 public packages
> from release commit `[RELEASE_COMMIT]`, using the existing audited release
> workflow, tag `v0.1.0-alpha.3`, npm dist-tag `alpha`, and frozen release notes
> and checksums. I do not authorize M7c execution, provider calls, M8 work, or
> any broader claim.

Preparing or committing this candidate is not that authorization. No package,
tag, release, or registry state is changed by release preparation.
