# M8b.2b.9 separate authorization texts

These texts are proposals only. Recording them grants no authorization.

## Authorization 1: push the workflow correction

> I authorize pushing workflow-only post-publication verification correction
> commit `404c2a63341ed29d5b088feb6c7990bfd80a2d47` to `origin/main` as a clean
> fast-forward from `1b48a41eaee0936da5e264b7dfb85d7cf2c696bb`. Verify that
> remote `.github/workflows/release.yml` has SHA-256
> `4f12024fcb0b17f4c1bb87bad9f06e882c4e99524475c63b5fae9d7105793e7f`. Preserve
> all six published `0.1.0-alpha.5` packages and tarball digests, provenance
> from run `30146905854`, every dist-tag, annotated tag `v0.1.0-alpha.5`, and
> draft prerelease database ID `359683006` with body SHA-256
> `676e3176e9c3a8bd414196339091c5eebe200993b33ccaa7dbbd494d27ae3d6b`. Do not
> push the later evidence commit, dispatch a workflow, publish or republish a
> package, publish or modify the prerelease, access credentials, or alter a tag
> or dist-tag. Stop after remote verification.

## Authorization 2: publish the prerelease and verify once

> I authorize publishing the existing draft GitHub prerelease database ID
> `359683006` for `v0.1.0-alpha.5` with title and body unchanged, then exactly
> one dispatch of `.github/workflows/release.yml` from workflow correction
> commit `404c2a63341ed29d5b088feb6c7990bfd80a2d47`, workflow SHA-256
> `4f12024fcb0b17f4c1bb87bad9f06e882c4e99524475c63b5fae9d7105793e7f`, using
> `release_commit=1b48a41eaee0936da5e264b7dfb85d7cf2c696bb`. Require registry
> state `all six present`, select verify-only mode, and invoke zero
> `npm publish` commands. Verify all six frozen registry tarballs, signatures,
> npm publish attestations, SLSA provenance, exact alpha.5 dependency closure,
> preserved latest tags, alpha tags, strict TypeScript 6 consumer, and CLI usage
> exit `2`. Treat successful OIDC provenance from run `30146905854` as the
> authoritative trusted-publisher evidence. Use no npm token or repository
> Actions secret. If any gate fails, return the GitHub prerelease to draft and
> do not retry. Do not republish any package or version, alter any dist-tag,
> modify a tag or release body, access credentials, or begin unrelated work.
> Stop after final verify-only reconciliation.
