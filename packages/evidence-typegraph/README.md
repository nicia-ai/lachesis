# `@nicia-ai/lachesis-evidence-typegraph`

Stable-alpha optional storage adapter implementing Lachesis evidence snapshots
over the native, Drizzle-free TypeGraph 0.38 Store contract.

The root package is runtime-portable and accepts a TypeGraph `HistoryStore`
created by the host. This is the integration point for Cloudflare-backed stores
and other supported TypeGraph backends. The `./sqlite` subpath is only a
Node-local convenience factory because it owns a `better-sqlite3` database.

The adapter snapshots TypeGraph into the exact canonical Lachesis
`EvidenceGraph`, then delegates selection to the existing Lachesis selectors. It
does not change the adaptive policy, encodings, evidence budgets, model-visible
serialization, validation, or provenance reconstruction.

TypeGraph stores the knowledge/evidence graph only. Lachesis plan graphs and
run/provenance graphs retain their distinct schemas and identities; arbitrary
TypeGraph topology is never executable control flow.

See [`docs/m4c-typegraph-parity.md`](../../docs/m4c-typegraph-parity.md) for the
trust boundary, temporal semantics, parity evidence, and nonclaims.

M5a integration is exposed through `createM5TypeGraphEvidenceStore`, which
adapts a repository backed by a host-provided TypeGraph `HistoryStore` to the
portable production evidence-runtime contract. The Node-only `./sqlite` subpath
also exports `createM5TypeGraphSqliteEvidenceStore` as a managed local-SQLite
convenience. Both paths preserve the same visible evidence and reconstructed
provenance as the in-memory runtime; only storage audit identities may differ.
Managed SQLite paths are pre-created privately and expose a permission audit for
the database, journal, WAL, and shared-memory files. See the
[M5a runtime guide](../../docs/m5a-evidence-runtime.md).
