# M9b.12f verification

Decision: `m9b12f-corrected-package-ready-for-independent-review`.

Review-evidence commit: `b5245111dc1aecad554c4102a7be0fe8e3c3e1bb`.

Implementation commit: `00c794929d1deba802ff2508f30ca943303283e7`.

Implementation tree: `7133da5d5307d00b033454b5414fac963b481f40`.

Canonical preregistration digest:
`097d4848a264fc8484ca590c79388e3a00279a6310392205db7868104cee13b4`.

## Blocking corrections

- The controller treats SQLite `-journal`, `-wal`, and `-shm` files as a closed
  sidecar inventory. Active sidecars must be exact-path, contained, owned,
  regular, nonsymlink files at mode `0600` under the already validated private
  parent; clean closure requires their absence. Unknown database-prefixed
  entries fail closed. No umask mutation or post-exposure repair is performed.
- The exact assessment subtree is captured once as strict canonical JSON bytes.
  Inside `BEGIN IMMEDIATE`, the controller revalidates presenter, launch, and
  quarantine state, parses those bytes, performs the complete M9b.12b
  assessment, and atomically stores either quarantine or admission. The event
  binds the assessment bytes and digest plus the transaction-generated proof
  receipt and digest; reopen independently rederives all four.

Hostile tests reject mode `0644`, symlink, directory, and FIFO replacements for
each recognized sidecar suffix, unknown database-prefixed entries, normalized
parent aliases, and parent permission drift. Child processes observed genuine
SQLite rollback journals, WAL files, and SHM files at `0600` under shell umasks
`0022`, `0000`, and `0077`, followed by clean-close absence.

Instrumentation proved the proof assessment executes while another connection is
excluded by `BEGIN IMMEDIATE`. Caller mutation after capture cannot change the
authoritative assessment; mutation before capture does, hidden or non-JSON state
rejects, transaction failures leave no receipt or mutation, and restart
rederives the assessment and proof. Tampered bytes, digests, receipts, and proof
digests fail closed.

## Integrity and invariance

M9b.12 through M9b.12e are byte-identical to baseline commit
`b1a830f871fa8ab78cbce7ef6c8836fe4464b5c1` and tree
`e6dedd253cca8dda11894b4f84d4d5d1ffc59e6a`; their 18, 22, 22, 24, 24, and 24
checksum entries pass. The exact M9b.12e disposition is
`superseded-unregistered-sidecar-and-transactional-proof-enforcement-incomplete`.

The M9b.12f canonical digest independently reproduces and nested/standalone
registration is exact. Only M9b.12f is registrable; no receipt exists and no
submission is authorized.

The 18 inherited study fields have canonical digest
`e5cd02100a1004849acc18f3f302e880580a38ef45a0733868826c32a23ff282`. The
estimand, 24/168 paired populations, balanced allocation, exact McNemar
analysis, model/reasoning settings, zero retries, concurrency one, 768 count
requests, 768 inference calls, 1,536 maximum HTTP requests, and every financial
value are unchanged.

## Tests and gates

- Focused M9b.12f: 5 files, 63/63 passed.
- Focused M9: 32 files, 593/593 passed.
- Complete serialized repository suite: 64 files, 1,036/1,036 passed.
- Repository coverage: 1,036/1,036 passed; 90.01% statements, 80.99% branches,
  97.45% functions, and 93.70% lines.
- Strict typecheck, lint, build, Node/Workers smokes, seven examples,
  descriptive load smoke, M8b0 CLI 6/6, CLI valid/invalid smokes, source-safety,
  secret scan, public-API, release-checksum, M8b history, targeted formatting,
  predecessor integrity, canonical rederivation, and diff checks passed.

Whole-workspace formatting still observes only protected untracked
`paper/README.md`. The M7c audit has a pre-existing public-document binding
mismatch, and the packed-package audit has a pre-existing frozen alpha.5
generator inventory mismatch. These unrelated artifacts were not modified.

No corpus, retired material, gold, schedule, credential, provider, model,
network, registry, publication, or push effect occurred. No study authority
store was created and no external authority was granted.
