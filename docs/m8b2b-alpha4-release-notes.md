# Lachesis 0.1.0-alpha.4

Lachesis alpha.4 productizes the offline catalog-author workflow validated in
M8a and hardened through M8b. It synchronizes six packages and introduces the
experimental public `lachesis` command-line binary.

## Install

The portable runtime path remains:

```sh
pnpm add @nicia-ai/lachesis-runtime@alpha zod@4.4.3
```

Catalog authors and CI jobs may install the binary:

```sh
pnpm add --save-dev @nicia-ai/lachesis-cli@alpha
```

The CLI is ESM-only, requires Node `>=24 <25`, and exposes the `lachesis`
binary. It has no supported JavaScript import, declaration-file, or CommonJS
contract.

## Catalog-author workflow

The binary supports three offline product commands:

- `lachesis catalog manifest` validates a trusted compiled-ESM catalog and
  policy and creates or verifies a content-addressed manifest;
- `lachesis catalog compare` performs structural review or evaluates an
  explicitly supplied finite conformance suite; and
- `lachesis report verify` checks a detached command report and its explicitly
  bound artifacts without loading catalogs or user code.

Reports are deterministic, checksum-bound, and suitable for CI. Review exit `10`
remains separate from declaration-repairable, genuine-difference, and
insufficient-evidence exits `11`–`13`. Genuine differences say
`do-not-substitute`; repairs remain conditional and are never applied
automatically.

See the README included in `@nicia-ai/lachesis-cli` for the complete
self-contained quick start, command grammar, exit table, POSIX and GitHub
Actions policies, bounded-I/O behavior, security boundary, and troubleshooting.

## Corrected identity boundaries

The kernel, evidence, and generator packages correct arbitrary-JSON validation
at content-addressed boundaries. Valid own properties—including root and nested
`__proto__` keys—are preserved rather than reconstructed away. Unsupported,
hidden, cyclic, sparse, accessor-bearing, or non-JSON JavaScript state continues
to reject.

The correction preserves `lachesis-canonical-json/1`, existing report protocols,
exit codes, and the alpha.3 public library export inventory.

`@nicia-ai/lachesis-runtime` and `@nicia-ai/lachesis-evidence-typegraph` contain
no implementation change; they are synchronized dependency-only republishes so
every alpha.4 package resolves the corrected alpha.4 Lachesis closure.

## Publication and compatibility boundaries

- All six packages are prereleases and publish explicitly under the `alpha`
  dist-tag.
- The existing five packages retain `latest` at `0.1.0-alpha.1`.
- The CLI's first-publication dist-tags are verified against the separately
  frozen bootstrap outcome; no fabricated stable version is introduced.
- Existing library exports remain unchanged from alpha.3.
- Catalog modules are trusted executable configuration. The CLI does not sandbox
  them.
- Filesystem race protection covers the documented controller and tested
  mutation model; it does not claim kernel-atomic isolation against a malicious
  same-UID process.

## Nonclaims

Finite suite passage establishes conformance only over the supplied fixtures.
This release does not establish general semantic equivalence, compositional
generalization, model quality, provider behavior, or TypeGraph superiority. No
provider inference is part of the supported catalog-author workflow.
