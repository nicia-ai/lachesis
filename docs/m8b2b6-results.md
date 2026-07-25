# M8b.2b.6 bootstrap-workflow retirement

Decision: `bootstrap-terminally-complete-workflow-retired`.

The one-time `@nicia-ai/lachesis-cli@0.1.0-alpha.4` bootstrap is terminally
complete. Its public registry bytes, npm signature, npm publish attestation,
SLSA provenance, source binding, and dist-tags were independently reconciled in
M8b.2b.5. No bootstrap rerun or second publication occurred.

The temporary `.github/workflows/bootstrap-cli.yml` workflow has therefore been
deleted. Its final SHA-256 before retirement was
`aa318966d4cece6e65ecc482cd38b9b62f95bfd4c209aac60f00b971b76d25ff`.

`.github/workflows/release.yml` remains byte-identical at
`c6288195114390cbcb2369a0ae96f2573f8ccd4ab954950302496617dec822a1`. Static
verification confirmed that its publication step contains exactly five
`npm publish` commands:

- `@nicia-ai/lachesis`
- `@nicia-ai/lachesis-evidence`
- `@nicia-ai/lachesis-runtime`
- `@nicia-ai/lachesis-evidence-typegraph`
- `@nicia-ai/lachesis-generator`

The workflow does not publish the CLI. Before those five commands can run, it
requires the exact existing CLI alpha.4 version and rejects an absent CLI or any
unexpected partial release. Its post-publication verification treats the CLI as
a frozen sixth prerequisite: it checks all six registry tarballs against the
frozen checksums, verifies signatures and provenance, installs the complete
six-package registry closure, runs strict TypeScript, checks the CLI process
contract, and runs detached npm signature auditing.

Live read-only npm verification confirmed:

- the CLI registry tarball SHA-256 remains
  `f9586fd9554fbe78fd88ab28400d2a04fe78792196d17f5d7f74558f33d3e638`;
- the registry signature and both npm publish and SLSA provenance attestations
  verify cryptographically;
- CLI provenance still records the historical bootstrap workflow and commit
  `db5c793c9b78c78ac4d7a3161f5ae06741b0c55e`;
- `alpha=0.1.0-alpha.4` and `latest=0.1.0-alpha.4`;
- the five packages listed above remain absent at `0.1.0-alpha.4`; and
- the CLI trusted publisher remains exactly GitHub Actions `nicia-ai/lachesis`,
  workflow filename `release.yml`, with only `npm publish` allowed.

The repository Actions secret inventory was inspected without querying
organization secrets and is empty; `NPM_TOKEN` remains absent. No secret value
was accessed. The revoked bootstrap token `lachesis temp` remains absent from
the npm token inventory, and its former record identity does not resolve.

The release source, package versions, tarball digests, annotated tag, draft
prerelease, release-note bytes, trusted-publisher settings, and dist-tags remain
unchanged. No workflow was dispatched, no package or release was published, no
dist-tag was changed, and nothing was pushed.
