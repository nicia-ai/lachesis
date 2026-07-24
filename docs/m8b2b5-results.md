# M8b.2b.5 CLI bootstrap reconciliation

Decision: `complete-published-reconciled-credential-retired`.

`@nicia-ai/lachesis-cli@0.1.0-alpha.4` was successfully and immutably published
by GitHub Actions run
[`30134246636`](https://github.com/nicia-ai/lachesis/actions/runs/30134246636),
attempt 1. The publish step completed and npm recorded both publish and SLSA
provenance attestations. The workflow subsequently concluded `failure` because
the public package metadata continued to return HTTP 404 throughout its 24
five-second verification attempts. The package became public after that bounded
window.

Independent reconciliation verified:

- the registry tarball SHA-256 is
  `f9586fd9554fbe78fd88ab28400d2a04fe78792196d17f5d7f74558f33d3e638`;
- the npm registry signature and both npm publish and SLSA provenance
  attestations verify cryptographically;
- provenance binds `.github/workflows/bootstrap-cli.yml`, workflow commit
  `db5c793c9b78c78ac4d7a3161f5ae06741b0c55e`, and run `30134246636/attempts/1`;
- the detached release gates bound package source commit
  `635521f1d2e753095fca4fdbbafbf7ed2287efe1`;
- the package has exactly one version, `0.1.0-alpha.4`;
- `alpha` and the unavoidable first-publication `latest` tag both resolve to
  `0.1.0-alpha.4`; and
- no later bootstrap dispatch or second publication occurred.

Exactly one trusted-publisher connection is now configured for
`@nicia-ai/lachesis-cli`: GitHub Actions organization `nicia-ai`, repository
`lachesis`, workflow filename `release.yml`, with only `npm publish` allowed.
`npm stage publish` is not allowed and no environment is bound. The saved
binding was independently re-read after credential retirement.

The temporary granular npm token named `lachesis temp`, record identity
`8c9e9afc-e20b-44f1-9a13-014632a261be`, was identified by its July 24
creation/last-use dates, `@nicia-ai` and organization read/write grants,
bypass-2FA setting, and truncated identity `npm_FRrp......LILl`. npm reported
`deleted 1 token`; the identity is absent from the complete token inventory and
its former detail record no longer resolves. The secret value was never read,
printed, fingerprinted, or otherwise inspected.

The repository Actions secret inventory contained exactly `NPM_TOKEN` before
deletion and is empty afterward. Its value was never accessed.

The annotated tag, draft prerelease, existing five packages and their tags,
bootstrap workflow, and all package bytes remain unchanged. No bootstrap rerun,
release-workflow dispatch, other package publication, dist-tag mutation, cleanup
push, or release modification occurred.
