# M8b and alpha.5 final closure

Decision: `complete-public-release-pass`.

Lachesis `0.1.0-alpha.5` is a complete synchronized public release of all six
packages. Package bytes remain bound to source commit
`1b48a41eaee0936da5e264b7dfb85d7cf2c696bb`; the post-publication verification
correction is workflow-only commit `404c2a63341ed29d5b088feb6c7990bfd80a2d47`.

Publication run
[`30146905854`](https://github.com/nicia-ai/lachesis/actions/runs/30146905854)
successfully published all six packages through npm trusted-publishing OIDC
before its post-publication checks failed. Verify-only run
[`30164532908`](https://github.com/nicia-ai/lachesis/actions/runs/30164532908)
then detected all six versions, skipped every `npm publish` command, and passed
the complete frozen verification path. The unchanged GitHub
[alpha.5 prerelease](https://github.com/nicia-ai/lachesis/releases/tag/v0.1.0-alpha.5)
is public.

## Registry closure

| Package                                 | Frozen tarball SHA-256                                             | `alpha`         | `latest`        |
| --------------------------------------- | ------------------------------------------------------------------ | --------------- | --------------- |
| `@nicia-ai/lachesis`                    | `324940c3610c9280141ac1825a73c87a24238d31ae359c212b2985a66db20730` | `0.1.0-alpha.5` | `0.1.0-alpha.1` |
| `@nicia-ai/lachesis-evidence`           | `717c4627dbc3a6e8da985a46993dda7aaa0d648aa229c7c4bc87531b29381956` | `0.1.0-alpha.5` | `0.1.0-alpha.1` |
| `@nicia-ai/lachesis-generator`          | `c91f2b36d0a08a99209714df620cea331e3bb3562c4f6d45d8ead17c5949a3e6` | `0.1.0-alpha.5` | `0.1.0-alpha.1` |
| `@nicia-ai/lachesis-runtime`            | `93277274a06ea5da465f9ab0eb69dcffc45e06348b369ba7e960781b6ad3721b` | `0.1.0-alpha.5` | `0.1.0-alpha.1` |
| `@nicia-ai/lachesis-evidence-typegraph` | `5e030b987f731e7429d680cf850fc8425b2609eb7beb1dc72ebdc8282bca7242` | `0.1.0-alpha.5` | `0.1.0-alpha.1` |
| `@nicia-ai/lachesis-cli`                | `34faca53164d9dedc3b09f348392654f58a129cf7abd56cbd530c994ebf9d1cd` | `0.1.0-alpha.5` | `0.1.0-alpha.4` |

Every package has a verified npm registry signature plus npm publish and SLSA
provenance attestations. Provenance binds `.github/workflows/release.yml`, the
Lachesis repository, and release source `1b48a41…`. Every internal Lachesis
dependency is exactly `0.1.0-alpha.5`; no prospective package resolves alpha.3.

The final fresh registry consumer compiled under TypeScript 6.0.3 with
`strict: true` and `skipLibCheck: false`. The published CLI returned its
documented no-argument usage exit `2`. Repository Actions secrets were empty,
and alpha.5 used no npm token or other npm credential.

## Fail-closed infrastructure record

Historical evidence remains byte-for-byte append-only:

1. Run `30127417942` stopped before npm setup because a tag-addressed public
   lookup could not retrieve a draft release.
2. Run `30130906678` stopped before npm setup because `contents: read` could not
   retrieve the draft release.
3. Run `30133047029` stopped before npm setup because pnpm examined the wrong
   checkout root.
4. Run `30134246636` published CLI alpha.4, then exhausted its bounded registry
   propagation window. Later reconciliation verified that publication and
   retired its temporary credential.
5. Runs `30136489135` and `30144568420` stopped before packing or publication
   when the parity identity test exceeded its empirically invalid 20-second
   bound under hosted contention.
6. Run `30146905854` published all six alpha.5 packages, then failed because the
   fresh-consumer TypeScript command did not bind its project and the next CLI
   check expected exit `64` instead of the published contract's `2`.
7. Run `30164532908` selected the all-present verify-only path, executed zero
   publication commands, and passed every release gate.

Alpha.4 remains closed as `partial-bootstrap-only-verification-no-go`: only
`@nicia-ai/lachesis-cli@0.1.0-alpha.4` exists, and the other five alpha.4
versions remain absent. No historical release record has been reclassified or
rewritten.

## Claim boundary

M8a remains `adoption-ready-with-docs-fixes`; M8b closes
`complete-public-release-pass`. Alpha.5 establishes a registry-only,
strict-consumer product path for catalog manifests, finite conformance, safe
diagnostics, and detached report verification.

Finite conformance does not establish general semantic equivalence. Detached
verification establishes artifact integrity, not semantic acceptance. This
release makes no model-quality, provider-superiority, TypeGraph-superiority, or
compositional-generalization claim.
