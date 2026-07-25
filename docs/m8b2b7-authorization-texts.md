# M8b.2b.7 separate authorization texts

These texts are proposals only. Recording them grants no authorization.

## Authorization 1: push the release-workflow correction

> I authorize pushing workflow-only correction commit
> `36402de6560a2c5998d773e10f0c9a2695110e18` and its authorized unpublished
> ancestors to `origin/main` as a clean fast-forward. Verify that `origin/main`
> resolves exactly to that commit and that remote
> `.github/workflows/release.yml` has SHA-256
> `2c04cf37d453916f3d189be1e0c09f6090db2ffa31d0c41397036dadeb9b66f4`. Preserve
> package-source commit `635521f1d2e753095fca4fdbbafbf7ed2287efe1`, annotated
> tag `v0.1.0-alpha.4`, draft prerelease database ID `359550250`, release body
> SHA-256 `bec6a90f3c7683e3d66d10607ebfb4891105abb25064c5feae14e59196fc1a02`,
> all six package versions and tarball digests, trusted publishers, registry
> state, and dist-tags. Do not push the later M8b.2b.7 evidence commit, dispatch
> a workflow, publish or modify the prerelease, publish a package, introduce a
> secret or token, or alter any tag or dist-tag. Stop after remote verification.

## Authorization 2: publish the prerelease and dispatch once

> I authorize publishing the existing draft GitHub prerelease database ID
> `359550250` for `v0.1.0-alpha.4` with title and body unchanged, then exactly
> one new dispatch of `.github/workflows/release.yml` from workflow correction
> commit `36402de6560a2c5998d773e10f0c9a2695110e18`, workflow SHA-256
> `2c04cf37d453916f3d189be1e0c09f6090db2ffa31d0c41397036dadeb9b66f4`, using
> `release_commit=635521f1d2e753095fca4fdbbafbf7ed2287efe1`. Publish exactly
> these five public packages at `0.1.0-alpha.4` through npm trusted publishing
> with provenance and the `alpha` dist-tag:
>
> - `@nicia-ai/lachesis`, tarball SHA-256
>   `298643284448324ad1a8a99e05364abc170cacb3ca839b9b32e95978cfec47cc`;
> - `@nicia-ai/lachesis-evidence`, tarball SHA-256
>   `eb0a83b7977db40a8175a786697dce745bf7a7422e49e69da7a7bf20b2719ee0`;
> - `@nicia-ai/lachesis-generator`, tarball SHA-256
>   `242c45f6e21fd376d58d27dc4f9764719f0368f49c31f2a26ca8e9a971072273`;
> - `@nicia-ai/lachesis-runtime`, tarball SHA-256
>   `22ed70fa0490afa064c692b4f3285a672a1763618efbdc423f2a7b499e7809ef`;
> - `@nicia-ai/lachesis-evidence-typegraph`, tarball SHA-256
>   `26f6f3775f1d9eda210a86b9f4f17466e9dfec245ef38205d8e281b53c5f2cb5`.
>
> Treat the existing `@nicia-ai/lachesis-cli@0.1.0-alpha.4`, tarball SHA-256
> `f9586fd9554fbe78fd88ab28400d2a04fe78792196d17f5d7f74558f33d3e638`, as an
> immutable prerequisite and do not republish it. Use OIDC trusted publishing
> only and introduce no npm token or Actions secret. Preserve the existing five
> packages' `latest=0.1.0-alpha.1` tags and the CLI's observed `alpha` and
> `latest` tags. Monitor the single run through completion and verify all six
> registry tarballs, npm signatures, SLSA provenance, dependencies, dist-tags,
> package allowlist, frozen source binding, and a fresh strict TypeScript 6
> registry consumer. If any frozen gate fails, follow the workflow's fail-closed
> draft restoration, report the immutable registry state, and do not rerun
> without new authorization. Do not publish another package or version, modify
> the tag or release body, configure a trusted publisher, alter any dist-tag, or
> begin unrelated work. Stop after final reconciliation.
