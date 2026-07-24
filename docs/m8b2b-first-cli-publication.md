# Alpha.4 CLI first-publication authentication plan

Status: prepared, not authorized, not executed.

`@nicia-ai/lachesis-cli` does not yet exist in the npm registry. The current npm
trusted-publisher administration command requires an existing package, so the
CLI cannot be bootstrapped directly through trusted publishing. The first
publication therefore requires a separate, one-time authorization and a
short-lived granular access token. The five existing packages remain OIDC-only.

Official npm references:

- https://docs.npmjs.com/trusted-publishers/
- https://docs.npmjs.com/cli/v11/commands/npm-trust/
- https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/
- https://docs.npmjs.com/cli/v11/commands/npm-publish/

## Minimal separately authorized bootstrap

The bootstrap is allowed only after one immutable alpha.4 package-source commit,
the annotated `v0.1.0-alpha.4` tag, the draft prerelease, release notes, and all
six tarball checksums agree.

1. Create one short-lived granular npm access token limited to write access for
   the new `@nicia-ai/lachesis-cli` package scope and usable for this
   first-publication action. Keep it only in a protected GitHub Actions secret;
   never put it in source, argv, logs, an environment report, or an artifact.
2. On a GitHub-hosted runner, check out the exact release-candidate commit,
   verify the tag dereference, release body, six-package allowlist, and checksum
   manifests, and reproduce the tarballs.
3. Confirm that alpha.4 remains absent for all six packages and that the CLI
   package itself remains absent.
4. Publish exactly the frozen CLI tarball:

   ```sh
   npm publish nicia-ai-lachesis-cli-0.1.0-alpha.4.tgz \
     --tag alpha \
     --access public \
     --provenance
   ```

5. Verify the registry tarball against the frozen SHA-256, verify npm signatures
   and provenance, and record the actual `alpha` and `latest` tags. The accepted
   first-publication outcomes are:

   - `alpha=0.1.0-alpha.4` and no `latest`; or
   - `alpha=0.1.0-alpha.4` and `latest=0.1.0-alpha.4`.

   Any other tag outcome stops the release. The preparation does not assume npm
   omits `latest`, and it does not create a fabricated stable version.

6. Configure the CLI package's trusted publisher for `nicia-ai/lachesis`,
   `.github/workflows/release.yml`, then independently verify that binding.
7. Revoke and delete the bootstrap token and GitHub secret before authorizing
   the normal release workflow.

The normal release workflow then sees the frozen CLI artifact already present
and publishes only the existing five packages through OIDC trusted publishing.
It verifies all six tarballs, provenance, `alpha` tags, and preserved `latest`
tags as one synchronized release.
