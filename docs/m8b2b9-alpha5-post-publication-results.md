# M8b.2b.9 alpha.5 post-publication verification correction

Run `30146905854` is recorded as `publication-complete-post-verification-fail`.

All six npm publications were immutable successes. The OIDC-only publication
step and alpha dist-tag verification passed. Independent reconciliation matched
all six registry tarballs to their frozen SHA-256 digests, cryptographically
verified registry signatures and both npm publish and SLSA attestations, bound
provenance to `release.yml`, source commit `1b48a41…`, and run `30146905854`,
confirmed exact alpha.5 internal dependencies, and passed a fresh strict
TypeScript 6 consumer.

The workflow failed only after publication. Its prefix-only TypeScript command
did not bind the fresh consumer project and printed compiler help. The next
check, which was not reached, expected CLI no-argument exit `64`; the existing
published binary, source, tests, and documented usage contract return `2`.

Workflow-only commit `404c2a63341ed29d5b088feb6c7990bfd80a2d47` corrects those
two assertions. It does not change packages, publication commands, versions,
tarballs, source, provenance, tags, dist-tags, APIs, or CLI implementation. The
corrected workflow SHA-256 is
`4f12024fcb0b17f4c1bb87bad9f06e882c4e99524475c63b5fae9d7105793e7f`.

Deterministic regression coverage reproduces the old TypeScript help failure,
passes the explicit project-bound command, accepts only usage exit `2`, maps
all-six-present registry state to verify-only mode, proves zero npm publication
calls in that mode, preserves every six-package integrity binding, and models
successful draft-prerelease publication only after complete verification.

The alpha.5 GitHub prerelease remains draft. No workflow was dispatched, no
package was republished, no credential was accessed, and no npm, release, tag,
or dist-tag state changed during this correction.
