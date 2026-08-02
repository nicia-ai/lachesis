# M9b.12e verification

Decision: `m9b12e-corrected-package-ready-for-independent-review`.

Review-evidence commit: `8f8b0754d1736efcf9e14ecd75bd01ddb639adc8`.

Implementation commit: `c2e5d7b14eac2a25d5436e6a369e6f63dd607b67`.

Implementation tree: `948180b86f3b8dde32a6335c9269967f8efcdad6`.

Canonical preregistration digest:
`d973ce34b715cd5d9bcc4c33d42184980a97be9b4cae1aaea2825e5b99520f5c`.

## Blocking corrections

- The authority honestly claims local crash, concurrency, partial replacement,
  and accidental unilateral rollback protection. Its separate local anchor is a
  consistency/recovery artifact, not an independent monotonic witness. A
  privileged matching rollback of SQLite and the anchor is explicitly outside
  scope and not claimed detectable. Suspected operator restore halts the
  campaign and requires a new execution identity.
- Principal and allocation identities are controller-issued opaque 256-bit
  values encoded as exactly 64 lowercase hexadecimal characters. No identity
  normalization occurs; noncanonical encodings fail closed, and colliding
  display labels do not merge distinct principals.
- Authentication is a private runtime presenter context separate from request
  JSON. A launch handle identifies an allocation but does not authenticate its
  presenter. Missing, forged, cross-store, revoked, expired, or mismatched
  contexts fail closed. A complete request copied through canonical
  serialization and presented by another principal returns exactly
  `presenting-principal-mismatch`.
- Presenter identity, quarantine state, launch allocation, role, session, and
  current proofs are revalidated inside the atomic admission transaction before
  the durable effect-started linearization point.

All 12 influence-bearing roles, including `materializer` and `study-operator`,
asserted the exact terminal quarantine receipt, opaque observer identity,
allocation/role/session and inventory exclusions, complete prohibitions, durable
head, and absence of an admission start for that request.

## Integrity and invariance

M9b.12, M9b.12a, M9b.12b, M9b.12c, and M9b.12d are byte-identical to reviewed
commit `5dff4a5f74933135c4c686f1c94df04cc320f53b`; their 18, 22, 22, 24, and 24
checksum entries pass. The exact M9b.12d disposition is
`superseded-unregistered-durability-claim-and-presenter-identity-incomplete`.

The M9b.12e canonical digest independently reproduces and nested/standalone
registration is exact. Only M9b.12e is registrable; no receipt exists and no
submission is authorized.

The 18 inherited study fields have canonical digest
`e5cd02100a1004849acc18f3f302e880580a38ef45a0733868826c32a23ff282`. The
estimand, 24/168 paired populations, balanced allocation, exact McNemar
analysis, model/reasoning settings, zero retries, concurrency one, 768 count
requests, 768 inference calls, 1,536 maximum HTTP requests, and every financial
value are unchanged.

## Tests and gates

- Focused M9b.12e: 4 files, 39/39 passed.
- Focused M9: 27 files, 530/530 passed.
- Complete serialized repository suite: 59 files, 973/973 passed.
- Repository coverage: 973/973 passed; 90.01% statements, 80.99% branches,
  97.45% functions, and 93.70% lines.
- Strict typecheck, lint, build, Node/Workers smokes, seven examples,
  descriptive load smoke, M8b0 CLI 6/6, CLI valid/invalid smokes, source-safety,
  secret scan, public-API, release-checksum, M8b history, targeted formatting,
  predecessor integrity, canonical rederivation, and diff checks passed.
- Documentation-level no-witness conformance, exact database permission
  rejection, and absence of persistent SQLite journal/WAL/SHM sidecars passed.

Whole-workspace formatting still observes only protected untracked
`paper/README.md`. The M7c audit has a pre-existing public-document binding
mismatch, and the packed-package audit has a pre-existing frozen alpha.5
generator inventory mismatch. These unrelated artifacts were not modified.

No corpus, retired material, gold, schedule, credential, provider, model,
network, registry, publication, or push effect occurred. No study authority
store was created and no external authority was granted.
