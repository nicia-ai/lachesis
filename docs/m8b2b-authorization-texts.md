# M8b.2b separate authorization texts

These texts are proposals only. Recording them does not grant authorization.

## Push release source and workflow correction

> I authorize pushing workflow correction commit
> `5e894a2df44cba074f8f9a1aa1cd2ce7240daa51` and its unpublished ancestors
> through release-source commit `635521f1d2e753095fca4fdbbafbf7ed2287efe1` to
> `origin/main` as a clean fast-forward. Do not tag, create or publish a GitHub
> release, publish to npm, configure trusted publishers, access credentials, or
> change dist-tags in the same operation.

## Create and push the annotated tag

> I authorize creating annotated tag `v0.1.0-alpha.4` with the frozen alpha.4
> release annotation and pushing only that tag to origin, provided it
> dereferences exactly to release-source commit
> `635521f1d2e753095fca4fdbbafbf7ed2287efe1`. Do not move or replace an existing
> tag, create a GitHub release, publish to npm, configure trusted publishers, or
> access credentials.

## Create the draft GitHub prerelease

> I authorize creating one draft GitHub prerelease for annotated tag
> `v0.1.0-alpha.4`, titled `Lachesis 0.1.0-alpha.4`, with its body byte-for-byte
> equal to
> `635521f1d2e753095fca4fdbbafbf7ed2287efe1:docs/m8b2b-alpha4-release-notes.md`.
> Keep it draft. Do not publish the release, publish to npm, configure trusted
> publishers, access npm credentials, or modify tags or dist-tags.

## Bootstrap the new CLI package

> I authorize the one-time first publication of exactly
> `@nicia-ai/lachesis-cli@0.1.0-alpha.4` from release-source commit
> `635521f1d2e753095fca4fdbbafbf7ed2287efe1`, tarball SHA-256
> `f9586fd9554fbe78fd88ab28400d2a04fe78792196d17f5d7f74558f33d3e638`, using the
> separately audited short-lived token bootstrap in
> `docs/m8b2b-first-cli-publication.md`, `--tag alpha`, `--access public`, and
> npm provenance. Publish no other package or version. Verify the registry
> tarball, provenance, `alpha=0.1.0-alpha.4`, and the preregistered
> first-package `latest` outcome; stop on any mismatch and revoke the bootstrap
> credential.

## Configure CLI trusted publishing

> I authorize configuring the existing `@nicia-ai/lachesis-cli@0.1.0-alpha.4`
> package for npm trusted publishing from repository `nicia-ai/lachesis` and
> workflow `.github/workflows/release.yml`, then revoking and deleting the
> one-time bootstrap token and secret. Do not publish any package, run the
> release workflow, or change any dist-tag.

## Publish the GitHub prerelease

> I authorize publishing the existing draft GitHub prerelease for
> `v0.1.0-alpha.4` with its title, body, tag, prerelease status, and attached
> artifacts unchanged. Do not publish to npm, dispatch a workflow, move the tag,
> or modify release metadata.

## Dispatch synchronized npm publication

> I authorize dispatching the corrected release workflow from `main` at workflow
> commit `5e894a2df44cba074f8f9a1aa1cd2ce7240daa51` with
> `release_commit=635521f1d2e753095fca4fdbbafbf7ed2287efe1`. Publish exactly the
> six-package synchronized alpha.4 release set bound by
> `docs/m8b2b-alpha4-tarballs.sha256`: the already bootstrapped CLI must verify
> byte-identically, and the five existing packages may publish only through OIDC
> trusted publishing with provenance, public access, and the `alpha` tag.
> Preserve every existing package's `latest=0.1.0-alpha.1`; accept only the
> frozen CLI first-publication `latest` outcome. Publish no private package,
> other version, other commit, or other artifact. Stop and return the GitHub
> prerelease to draft on any frozen gate failure.
