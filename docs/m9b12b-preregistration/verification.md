# M9b.12b verification

Decision: `m9b12b-corrected-package-ready-for-independent-review`.

Canonical preregistration digest:
`52807c052f6e3fab79a943a4e2c6644296823f3b40f49e4452ad40a641a83bd2`.

Implementation commit: `493bb8528df4986878050f19878e9e4d8a628b1b`; tree
`0e2833e5b271dbb65dc6af66baf19e03c16b5656`.

## Independent reproductions

- M9b.12 and M9b.12a have empty scoped diffs from the M9b.12a baseline and both
  original checksum manifests pass.
- Compact sorted JSON with `preregistrationDigest` removed independently hashes
  to the recorded M9b.12b canonical digest.
- The nested and standalone external-registration values compare canonically
  equal.
- Machine and prose lists agree exactly for 12 influence-bearing roles, 16
  isolation channels, 18 contamination ancestors, and 20 forbidden access
  classes.
- Every influence-bearing role is in the derived exclusion list.
- Missing, incomplete, ambiguous, unknown, unsupported, contaminated,
  duplicated, unclassified, and malformed inputs fail closed in isolated tests.
- The clean baseline and exact opaque counts commitment are the only allow
  paths; neither receipt grants provider or credential effects.

## Scientific and financial invariance

Canonical comparison against M9b.12a proves exact value equality for the
research question, bindings, treatment, control, matching, population, primary
endpoint, exact McNemar analysis, probe gate, financial policy, operational
sequence, count kill gates, operational security, disclosure roles, nonclaims,
audit, authority, and inherited decisions. The six inherited human artifacts are
byte-identical.

Financial arithmetic independently reproduces inference
$342.097920, count
contingency $117.964800, operational ceiling
$460.062720, hard cap $500.000000, and headroom $39.937280.

## Verification matrix

- M9b.12b: 95/95 tests.
- Focused M9: 422/422 tests across 18 files.
- Repository: 865/865 tests across 50 files in serialized auditable groups.
- Coverage: 90.01% statements, 80.99% branches, 97.45% functions, 93.70% lines.
- Strict typecheck, type-aware lint, build, Node and Workers smokes: passed.
- Seven offline examples, 128-record descriptive load smoke, and six M8b0 CLI
  cases: passed.
- Source-safety, public-API, release-checksum, and M8b-history audits: passed.
- M9b.12b formatting and `git diff --check`: passed. The root formatter observes
  only the pre-existing protected untracked `paper/README.md`.
- Disclosure scanning found no private path, personal identifier, credential,
  secret, retired locator, hidden material, construction seed, or future packet
  identity.

No corpus, retired material, gold, schedule instance, credential, provider
state, registry state, external registration, or push was created or accessed.
This package grants only authority for another independent review.
