# M8b.2b.3 bootstrap privilege separation

Decision: `prepared-unexecuted-awaiting-separate-authorizations`.

Bootstrap run
[`30130906678`](https://github.com/nicia-ai/lachesis/actions/runs/30130906678)
failed before npm setup, npm credential use, packaging, or publication. The
workflow `GITHUB_TOKEN` had `contents: read`; GitHub returned HTTP 403
`Resource not accessible by integration` when the workflow attempted to read
draft release database ID `359550250`. Every npm-related step was skipped, and
all six alpha.4 versions remained absent.

Workflow-only correction `ca6af65382682e4616cedb122a2338ca008c02ce` separates
control-plane verification from package publication:

- `verify-draft` has `contents: write`, no `id-token` permission, no npm secret,
  and no npm setup. It performs an explicitly authenticated `GET` for the draft
  release, verifies the frozen source, annotated tag, release bytes, checksums,
  and registry absence, then exposes only public frozen identities and digests.
- `bootstrap-cli` depends on `verify-draft`, has `contents: read` and
  `id-token: write`, and lacks `contents: write`. It checks the verification
  outputs before setup, independently preserves the existing source, package,
  tarball, allowlist, registry, publication, provenance, and reconciliation
  gates, and references `NPM_TOKEN` only in the single publish step.

The corrected workflow SHA-256 is
`9453f7951d5c182a6bb18638ed166249e12478d8e9ce89e3bbf5f7207a69c1cf`.
`release.yml` remains byte-identical at
`c6288195114390cbcb2369a0ae96f2573f8ccd4ab954950302496617dec822a1`.
Package-source commit `635521f1d2e753095fca4fdbbafbf7ed2287efe1`, tag
`v0.1.0-alpha.4`, release database ID `359550250`, release body SHA-256
`bec6a90f3c7683e3d66d10607ebfb4891105abb25064c5feae14e59196fc1a02`, and CLI
tarball SHA-256
`f9586fd9554fbe78fd88ab28400d2a04fe78792196d17f5d7f74558f33d3e638` remain
unchanged.

Static enforcement verifies that the privileged job cannot reference
`NPM_TOKEN`; the publishing job lacks `contents: write`; the only GitHub API
operation in the privileged job is an explicit `GET`; no job combines GitHub
write permission with npm credentials; the dependency edge prevents npm setup or
publication after failed verification; and all frozen bindings remain present.
Actionlint, formatting, lint, source safety, historical checksums, bootstrap
tests, repository tests, build and smoke verification, and `git diff --check`
passed.

No workflow was dispatched. No credential or secret was read or changed. No
package, trusted publisher, release, tag, or dist-tag was created or modified.
