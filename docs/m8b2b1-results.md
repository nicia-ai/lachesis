# M8b.2b.1 one-time CLI bootstrap correction

Decision: `prepared-unexecuted-awaiting-separate-authorizations`.

The release-infrastructure correction commit is
`468349a7ac30934180650f41d83ccf7c68cfcda7`. Its temporary bootstrap workflow
SHA-256 is `ec3f50296cf236364c5a5c34384c930956b23bc1b1e2247d42e1acdbbff1bc69`.

The original M8b.2b plan correctly determined that `@nicia-ai/lachesis-cli` must
exist before npm trusted publishing can be configured, but its bootstrap
procedure was not executable: it named no dedicated workflow, did not enforce a
single-package mutation, and described a package-scoped token even though the
package does not yet exist.

The temporary `.github/workflows/bootstrap-cli.yml` closes that infrastructure
gap. It is manually dispatched with static concurrency, uses a GitHub-hosted
runner and only `contents: read` plus `id-token: write`, validates the exact
alpha.4 source commit, and checks out that commit detached. Before any npm
mutation it verifies the annotated tag, draft prerelease title and body, frozen
source checksums, six-package allowlist, three byte-identical CLI packs, and
registry absence. Its only mutation command publishes the single frozen CLI
tarball with public access, the `alpha` tag, provenance, and lifecycle scripts
disabled.

The workflow snapshots the five existing packages before publication and
requires their complete version and dist-tag sets to remain unchanged after
publication. It then verifies the CLI registry tarball, signature, SLSA
provenance, `alpha` tag, and npm's observed first-publication `latest` outcome.
The SLSA statement must name `.github/workflows/bootstrap-cli.yml` and its
workflow-infrastructure commit. The frozen package-source commit is bound
separately by the detached checkout, annotated tag, source checksum manifest,
three reproducible packs, and exact registry tarball digest. The evidence does
not inaccurately claim that npm provenance rewrites its resolved workflow
dependency to the detached source checkout.

The narrowest enforceable pre-publication token scope is prospective read/write
access to the `@nicia-ai` npm scope, not the nonexistent CLI package alone. The
token must use npm's minimum one-day expiration and bypass-2FA publication
permission. The workflow confines it to `NPM_TOKEN`, passes it only to npm
authentication for the one publish command, and never uses it for `npm trust`.

All six alpha.4 package versions, source bytes, tarball digests, release notes,
public APIs, and the five-package OIDC release path remain unchanged.

Verification passed under Node 24.18.0 and pnpm 10.33.0: actionlint; clean
detached-source simulation; three exact CLI packs; exact allowlist and sole
publish-path checks; mocked 404, unexpected-presence, and registry-failure
guards; static concurrency enforcement; secret/source-safety scanning; strict
typechecking; lint and formatting; 443 default-parallel tests; 443 coverage
tests; build; Node and Workers smokes; packed consumers; historical checksums;
current registry-absence preflight; and `git diff --check`.

No workflow was dispatched. No credential or secret was created, read, or
installed; no package, tag, GitHub release, trusted-publisher configuration, or
dist-tag was created or changed.
