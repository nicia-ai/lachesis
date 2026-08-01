# M9b.12c verification

Decision: `m9b12c-corrected-package-ready-for-independent-review`.

Implementation commit: `f0856caa195a352914a5dcba31a069e7bbd348e1`.

Implementation tree: `69e2ad71dcd8864c96b3943b610f3ff6ebe092b9`.

Canonical preregistration digest:
`62cff37dae7332855b8f7a8f9583f5b5f0917adde2d9b2c019603fb101392fc3`.

## Durable-history results

- Confirmed exposure commits before its terminal receipt.
- A clean retry for the observer returns exactly
  `observer-previously-quarantined`.
- The rejection survives serialization, validated reload, controller change, and
  changes to role, session, or derived inventory.
- Missing repository, caller-injected history, caller-selected clean history,
  valid stale truncation, and independently valid foreign history fail closed.
- Removed, reordered, duplicated, altered, and forked records are rejected.
- A clean receipt becomes unusable after an intervening append; same-observer
  quarantine returns `observer-previously-quarantined` at revalidation.
- Concurrent clean and quarantine assessments leave no usable post-quarantine
  startup authorization.
- All 12 influence-bearing role cases assert the full exact terminal outcome and
  authoritative head binding.
- A genuinely clean observer with complete affirmative proofs can receive and
  revalidate `allow-role-start` at the exact current head.

## Integrity and invariance

M9b.12, M9b.12a, and M9b.12b remain byte-identical and their 18, 22, and 22
checksum entries pass. The M9b.12c digest independently reproduces. Nested and
standalone registration values and the canonical history format are exact.

The selected scientific, financial, operational, security, disclosure, and
authority values have the same canonical hash as M9b.12b. The six inherited
scientific and financial documents are byte-identical. Financial arithmetic is
USD 342.097920 inference plus USD 117.964800 contingency equals USD 460.062720,
under the USD 500.000000 hard cap with USD 39.937280 headroom.

## Tests and gates

- Focused M9b.12c: 35/35 passed.
- Focused M9: 19 files and 457/457 passed.
- Repository coverage: 51 files and 900/900 passed; 90.01% statements, 80.99%
  branches, 97.45% functions, and 93.70% lines.
- Strict typecheck, lint, build, Node/Workers smokes, seven examples,
  descriptive load smoke, M8b0 CLI 6/6, CLI valid/invalid smokes, source-safety,
  secret scan, public-API, release-checksum, M8b history, targeted formatting,
  and diff checks passed.
- Whole-workspace formatting continues to observe only the protected
  pre-existing untracked `paper/README.md`; M9b.12c and every changed tracked
  artifact pass.

No corpus, retired material, gold, schedule, credential, provider, network,
registry, or push effect occurred, and no live authority was granted.
