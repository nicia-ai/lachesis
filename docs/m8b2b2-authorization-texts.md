# M8b.2b.2 separate authorization texts

These texts are proposals only. Recording them grants no authorization.

## Push the authenticated-draft workflow correction

> I authorize pushing workflow correction commit
> `587b23d6b37ccb3f6a0f4ba0aba046638036f13b` and its unpublished ancestors to
> `origin/main` as a clean fast-forward. Preserve package-source commit
> `635521f1d2e753095fca4fdbbafbf7ed2287efe1`, annotated tag `v0.1.0-alpha.4`,
> draft release database ID `359550250`, every package, tarball, checksum,
> release-note byte, `release.yml`, credential, secret, trusted-publisher
> setting, and dist-tag. Do not dispatch a workflow or publish anything.

## Dispatch one new CLI bootstrap attempt

> I authorize exactly one new dispatch of `.github/workflows/bootstrap-cli.yml`
> from workflow correction commit `587b23d6b37ccb3f6a0f4ba0aba046638036f13b`,
> workflow SHA-256
> `e5fb843e3e89b576d1a6cf27917b0c7e98dfff118c05c626b18b32d2f3e7ed82`, with
> `release_commit=635521f1d2e753095fca4fdbbafbf7ed2287efe1`. Use only the
> existing `NPM_TOKEN` Actions secret and publish exactly
> `@nicia-ai/lachesis-cli@0.1.0-alpha.4`, tarball SHA-256
> `f9586fd9554fbe78fd88ab28400d2a04fe78792196d17f5d7f74558f33d3e638`, with
> public access, provenance, and the `alpha` tag. Verify the registry tarball,
> observed `alpha` and `latest` tags, npm signature, provenance, bootstrap
> workflow identity, and frozen source binding. Do not rerun failed run
> `30127417942`, publish another package or version, configure trusted
> publishing, revoke the npm token, delete `NPM_TOKEN`, remove the bootstrap
> workflow, publish or modify the draft prerelease, dispatch `release.yml`, or
> alter any dist-tag.
