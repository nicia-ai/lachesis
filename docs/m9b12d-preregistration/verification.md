# M9b.12d verification

Decision: `m9b12d-corrected-package-ready-for-independent-review`.

Review-evidence commit: `d1dc6c58538ca67e7c96656bca6afa94ac011c4d`.

Implementation commit: `abe5a35fb76045811b0f8d33fee34a0f64d6c9aa`.

Implementation tree: `d924b263809a45ed1f459cebb34ce740c14ff181`.

Canonical preregistration digest:
`ed991e11ccc6c9129bdb6509dd011b28006b4420d59bf4290d2dac11765ccef0`.

## Blocking corrections

- Process A created a private SQLite authority, issued identity, committed
  quarantine, and exited. Process B opened with only the persisted files and
  trusted binding. A new role, session, handle, and inventory for the same
  Unicode/whitespace-equivalent principal returned exactly
  `observer-previously-quarantined`; reuse, startup, provider effects, and
  derived inventory were forbidden. Empty-store recreation was rejected.
- The controller-derived observer key remained stable across case, whitespace,
  Unicode NFKC, allocation, role, session, inventory, and restart changes.
  Caller commitment/principal fields, caller-created and mismatched handles,
  expiry, conflicts, and duplicate/concurrent allocation issuance failed closed.
- The durable `admission-effect-started` append is the admission linearization
  point. Quarantine-first and admission-first barriers recorded truthful order;
  concurrent duplicate admission had one winner; failures before commit,
  database-only commit, crash before effect, crash after effect, and intercepted
  failure produced no stale permission or redispatch.

All 12 influence-bearing roles, including `materializer` and `study-operator`,
asserted the exact terminal quarantine receipt, canonical observer identity,
role/session and inventory exclusions, complete prohibitions, durable head, and
absence of an admission start for that request.

## Integrity and invariance

M9b.12, M9b.12a, M9b.12b, and M9b.12c are byte-identical to reviewed commit
`c9e50ff3db56f898184dc9b7be934b1f1c0560df`; their 18, 22, 22, and 24 checksum
entries pass. The exact M9b.12c disposition is
`superseded-unregistered-process-durability-identity-admission-incomplete`.

The M9b.12d canonical digest independently reproduces and nested/standalone
registration is exact. Only M9b.12d is registrable; no receipt exists and no
submission is authorized.

The 18 inherited study fields have canonical digest
`e5cd02100a1004849acc18f3f302e880580a38ef45a0733868826c32a23ff282`. The
estimand, 24/168 paired populations, balanced allocation, exact McNemar
analysis, model/reasoning settings, zero retries, concurrency one, 768 count
requests, 768 inference calls, 1,536 maximum HTTP requests, and every financial
value are unchanged.

## Tests and gates

- Focused M9b.12d: 4 files, 34/34 passed.
- Focused M9: 23 files, 491/491 passed.
- Complete serialized repository suite: 55 files, 934/934 passed.
- Repository coverage: 934/934 passed; 90.01% statements, 80.99% branches,
  97.45% functions, and 93.70% lines.
- Strict typecheck, lint, build, Node/Workers smokes, seven examples,
  descriptive load smoke, M8b0 CLI 6/6, CLI valid/invalid smokes, source-safety,
  secret scan, public-API, release-checksum, M8b history, targeted formatting,
  predecessor integrity, canonical rederivation, and diff checks passed.

The default parallel suite caused only the unrelated M5b corpus test to exceed
its fixed five-second timeout; that test passed alone and the complete suite
passed with the repository coverage policy `--maxWorkers=1`.

Whole-workspace formatting still observes only protected untracked
`paper/README.md`. The M7c audit has a pre-existing binding to an older
`docs/public-alpha.md` hash, while reviewed-baseline and current bytes are
identical. The packed-package audit has a pre-existing frozen alpha.5 generator
tarball mismatch; all public package inputs are unchanged from the reviewed
baseline. These unrelated artifacts were not modified.

No corpus, retired material, gold, schedule, credential, provider, model,
network, registry, publication, or push effect occurred. No study authority
store was created and no external authority was granted.
