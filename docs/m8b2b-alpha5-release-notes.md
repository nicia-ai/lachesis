# Lachesis 0.1.0-alpha.5

Lachesis alpha.5 completes the synchronized six-package catalog-author release
that alpha.4 did not complete. The alpha.4 CLI publication remains valid; the
alpha.5 set republishes the unchanged product implementation under one complete
version and retains the registry-only catalog workflow.

## Install

The portable runtime path is:

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

The binary supports three offline commands:

- `lachesis catalog manifest` validates a trusted compiled-ESM catalog and
  policy and creates or verifies a content-addressed manifest;
- `lachesis catalog compare` performs structural review or evaluates an
  explicitly supplied finite conformance suite; and
- `lachesis report verify` checks a detached command report and its explicitly
  bound artifacts without loading catalogs or user code.

Reports are deterministic and checksum-bound. Review exit `10` remains separate
from declaration-repairable, genuine-difference, and insufficient-evidence exits
`11`–`13`. Genuine differences say `do-not-substitute`; repairs remain
conditional and are never applied automatically.

## Alpha.4 closure

The synchronized alpha.4 attempt ended
`partial-bootstrap-only-verification-no-go`: only
`@nicia-ai/lachesis-cli@0.1.0-alpha.4` was published. The five library alpha.4
versions were never published.

The release-verification blocker was an empirically invalid 20-second timeout on
a CPU-bound parity matrix, not a product regression. The test still executes 30
tasks across two providers, 120 compiles, 120 provenance reconstructions, and
every original identity assertion. Its calibrated 40-second anti-hang bound
passed repeated clean and constrained runs plus both complete 443-test matrices.

No package implementation, public API, report protocol, semantic rule, fixture
population, or assertion changed for alpha.5.

## Publication and compatibility boundaries

- All six packages publish together explicitly under the `alpha` dist-tag.
- The existing five library packages retain `latest` at `0.1.0-alpha.1`.
- The CLI retains `latest` at its unavoidable first-publication value,
  `0.1.0-alpha.4`.
- Every internal Lachesis dependency is exactly `0.1.0-alpha.5`.
- All six packages use the existing `release.yml` OIDC trusted-publisher
  bindings. No bootstrap workflow or npm token is used.
- Existing exports remain unchanged.
- Catalog modules are trusted executable configuration. The CLI does not sandbox
  them.
- Filesystem race protection covers the documented controller and tested
  mutation model; it does not claim kernel-atomic isolation against a malicious
  same-UID process.

## Nonclaims

Finite suite passage establishes conformance only over supplied fixtures. This
release does not establish general semantic equivalence, compositional
generalization, model quality, provider behavior, or TypeGraph superiority. No
provider inference is part of the supported catalog-author workflow.
