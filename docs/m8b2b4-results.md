# M8b.2b.4 detached-source pnpm setup correction

Decision: `prepared-unexecuted-awaiting-separate-authorizations`.

Bootstrap run
[`30133047029`](https://github.com/nicia-ai/lachesis/actions/runs/30133047029)
passed the privilege-separated draft verification job, then failed at
`pnpm/action-setup@v5`. The action examined the GitHub Actions workspace-root
`package.json`, which does not exist in the two-checkout layout, instead of the
frozen source at `release-source/package.json`. Node setup, install, build,
packaging, npm credential use, publication, and registry reconciliation were
skipped. All six alpha.4 versions remained absent.

Workflow-only correction `db5c793c9b78c78ac4d7a3161f5ae06741b0c55e` adds only
the supported action input:

```yaml
with:
  package_json_file: release-source/package.json
```

The pnpm version remains derived exclusively from the frozen release source's
`packageManager` field (`pnpm@10.33.0`). No second version declaration was
introduced.

The remaining bootstrap path audit passed:

- `actions/setup-node` binds its cache to `release-source/pnpm-lock.yaml`;
- install and all six builds run under `release-source`;
- deterministic packing and checksum verification run under `release-source` and
  write only to explicit runner-temp paths;
- the allowlist and registry checks load the built strict-JSON module from
  `release-source/packages/kernel/dist/json.js`; and
- the single frozen CLI tarball is copied from the first runner-temp pack into
  the isolated publish directory.

A clean simulation reproduced the Actions layout with no workspace-root package
metadata, a frozen checkout under `release-source`, and separate bootstrap
infrastructure. The pre-correction root lookup rejected. The corrected lookup
derived pnpm `10.33.0`, after which frozen-lockfile installation, all six
package builds, allowlist verification, three deterministic packs, exact CLI
digest verification, and mocked six-package registry absence passed.

The corrected workflow SHA-256 is
`aa318966d4cece6e65ecc482cd38b9b62f95bfd4c209aac60f00b971b76d25ff`.
`release.yml` remains byte-identical at
`c6288195114390cbcb2369a0ae96f2573f8ccd4ab954950302496617dec822a1`. All package
sources, versions, tarball digests, release bytes, tag, draft release,
permissions, privilege separation, and registry gates remain unchanged.

Actionlint, formatting, lint, source safety, historical checksums, bootstrap
security tests, repository tests with coverage, builds, Node and Workers smokes,
packed consumers, the clean-layout simulation, and `git diff --check` passed.

No workflow was dispatched during correction preparation. No credential or
secret was accessed or changed. No package, trusted publisher, release, tag, or
dist-tag was created or modified.
