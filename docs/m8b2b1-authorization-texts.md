# M8b.2b.1 separate authorization texts

These texts are proposals only. Recording them grants no authorization.

## 1. Push infrastructure, create tag, and create draft prerelease

> I authorize pushing M8b.2b.1 bootstrap-infrastructure commit
> `468349a7ac30934180650f41d83ccf7c68cfcda7` and its unpublished ancestors to
> `origin/main` as a clean fast-forward. I separately authorize creating and
> pushing annotated tag `v0.1.0-alpha.4` only if it peels exactly to
> package-source commit `635521f1d2e753095fca4fdbbafbf7ed2287efe1`, and creating
> one draft GitHub prerelease titled `Lachesis 0.1.0-alpha.4` whose body is
> byte-identical to
> `635521f1d2e753095fca4fdbbafbf7ed2287efe1:docs/m8b2b-alpha4-release-notes.md`.
> Do not publish the prerelease, install credentials, configure npm trust,
> dispatch a workflow, publish a package, or change a dist-tag.

## 2. One-time CLI bootstrap publication

> I authorize installing exactly one short-lived granular npm token as the
> `NPM_TOKEN` Actions secret and dispatching
> `.github/workflows/bootstrap-cli.yml` from infrastructure commit
> `468349a7ac30934180650f41d83ccf7c68cfcda7`, workflow SHA-256
> `ec3f50296cf236364c5a5c34384c930956b23bc1b1e2247d42e1acdbbff1bc69`, with
> `release_commit=635521f1d2e753095fca4fdbbafbf7ed2287efe1`. The token may have
> read/write access only to the `@nicia-ai` npm scope, npm's minimum one-day
> expiration, and bypass-2FA publication permission. Publish exactly
> `@nicia-ai/lachesis-cli@0.1.0-alpha.4`, tarball SHA-256
> `f9586fd9554fbe78fd88ab28400d2a04fe78792196d17f5d7f74558f33d3e638`, with
> public access, provenance, and the `alpha` tag. Publish no other package or
> version. Stop after registry verification; do not configure trusted
> publishing, revoke credentials, publish the GitHub prerelease, or dispatch
> `release.yml`.

## 3. Configure trusted publishing and clean up credentials

> I authorize configuring the existing `@nicia-ai/lachesis-cli@0.1.0-alpha.4`
> package's trusted publisher for repository `nicia-ai/lachesis`, workflow
> `.github/workflows/release.yml`, and npm publish permission. After
> independently verifying that binding, revoke the bootstrap npm token and
> delete the `NPM_TOKEN` GitHub Actions secret. Do not use the bypass-2FA token
> for `npm trust`, publish any package, dispatch either workflow, publish the
> GitHub prerelease, or change any dist-tag.

## 4. Remove the temporary bootstrap workflow

> I authorize one workflow-only cleanup commit deleting
> `.github/workflows/bootstrap-cli.yml` and its private bootstrap verification
> helpers after the CLI trusted publisher, token revocation, and secret deletion
> have all been verified. Preserve package-source commit
> `635521f1d2e753095fca4fdbbafbf7ed2287efe1`, `release.yml`, package versions,
> tarballs, checksums, release notes, tag, prerelease, and all append-only
> evidence. Commit and push only that cleanup; do not publish or dispatch.

## 5. Normal five-package OIDC publication

> I authorize publishing the existing draft GitHub prerelease for
> `v0.1.0-alpha.4` with its title, body, tag, and prerelease status unchanged,
> then dispatching `.github/workflows/release.yml` from the verified
> post-bootstrap cleanup commit with
> `release_commit=635521f1d2e753095fca4fdbbafbf7ed2287efe1`. The already
> published CLI must verify byte-identically; publish exactly the other five
> frozen `0.1.0-alpha.4` packages through OIDC trusted publishing with
> provenance, public access, and the `alpha` tag. Preserve the five existing
> packages' `latest=0.1.0-alpha.1` and accept only the recorded CLI
> first-publication `latest` outcome. Publish no other package, version, commit,
> or artifact. Stop on any gate failure and return the prerelease to draft where
> applicable.
