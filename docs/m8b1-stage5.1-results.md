# M8b.1 Stage 5.1 correction

Status: `complete-offline-pass`

Parent: `1b0592db50a4d2d8443fa35048b6213353caac11`

## Corrected integrity boundaries

Detached verification now recomputes the frozen producer identity for
`catalog.manifest`, `catalog.compare`, and `report.verify`. A self-consistent
outer report digest cannot make an arbitrary command identity valid. Reserved
input labels, kinds, pairings, source forms, artifact bindings, and compare mode
are checked before identity acceptance. Identity mismatch remains exit `22`.

Nested `command-report` artifacts now pass the same full detached checks as a
top-level report. An artifact-bearing nested report cannot be declared verified
without its child bytes: the flat binding boundary returns incomplete exit `23`.
No recursive discovery, filesystem search, catalog loading, generator loading,
network access, credential access, or effects were introduced.

The single-output writer now has an explicit terminal `committed` state only
after the installed output is descriptor-read and identity-verified. Pre-commit
failures roll back. Once committed, identity-bound temporary cleanup cannot
change the semantic exit or cause a fallback report. A foreign directory,
symlink, non-regular file, or different inode at the temporary name is
preserved.

## Regression evidence

- Legitimate manifest, early invalid manifest, structural compare, conformant
  suite, declaration-repairable, genuinely non-equivalent,
  insufficient-evidence, successful verifier, and unsuccessful verifier reports
  all reject a replaced command identity after outer redigesting.
- Duplicate and reordered reserved labels and structural/suite mode confusion
  fail closed.
- Nested command identity, summary, completeness, comparison, and assessment
  mutations fail; an artifact-free nested report passes; an unbound nested
  artifact is incomplete.
- Post-commit foreign temporary directories and symlinks do not cause fallback,
  are not removed, and leave a verifiable authoritative output.
- Pre-commit new-output and replacement failures preserve the absence or exact
  prior bytes and emit exactly one fallback outcome.

The correction does not widen the frozen report schema, protocol, exit contract,
public API, dependencies, or package versions. Stage 6 remains unstarted.

## Verification

The focused detached suite passed 41 tests across two files; all eight CLI test
files passed 121 tests. The single-worker coverage matrix passed 443/443 tests
at 90.04% statements, 80.36% branches, 97.17% functions, and 94.06% lines.
Formatting, strict TypeScript, lint, build, Node and Workers smokes, source
safety, API inventory, historical checksums, packed-package checks, and the
workspace-free Stage 5 consumer passed.

Two default-parallel repository runs each passed 442 tests and hit the existing
5-second timeout in the unchanged M2 provider-pool test; an isolated
default-timeout attempt reached the same threshold. The complete single-worker
coverage rerun passed that test and all 443 tests without changing or relaxing
its timeout.
