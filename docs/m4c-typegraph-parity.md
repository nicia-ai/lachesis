# M4c TypeGraph parity

M4c adds TypeGraph 0.38 as optional knowledge/evidence storage behind the
existing M4 evidence-source boundary. It remains entirely offline: there are no
provider adapters, campaigns, manifests, preregistrations, or M4d execution
state.

## Boundary

The host creates a TypeGraph `HistoryStore`, declares its public backend
identity, and transfers its lifetime to the adapter. The adapter validates and
stores one canonical Lachesis `EvidenceGraph`, then reads a content-addressed
valid-time/recorded-time snapshot. Selection is still performed by the unchanged
Lachesis lexical and graph selectors. Therefore TypeGraph-specific identity is
confined to adapter and storage-snapshot audit metadata; canonical source,
neighborhood, visible-view, compiler, and reconstruction identities remain
unchanged.

The model never sees TypeGraph, backend, provider, or evidence-arm labels.

## Runtime surfaces

- `@nicia-ai/lachesis-evidence-typegraph` accepts the native TypeGraph Store
  contract and is compatible with portable/Cloudflare hosts supported by
  TypeGraph.
- `@nicia-ai/lachesis-evidence-typegraph/sqlite` owns a local `better-sqlite3`
  store and is explicitly Node-only.

The local adapter is additive convenience, not the TypeGraph compatibility
boundary.

## Temporal semantics

Lachesis evidence valid/recorded intervals remain explicit logical fields.
TypeGraph independently supplies a storage snapshot lens:

- `validAt` pins the TypeGraph valid-time view;
- `recordedAt` reconstructs known evidence identities through TypeGraph's
  recorded-time point-read API; and
- both coordinates participate in `storageSnapshotDigest`.

A later storage retraction changes the current snapshot while a previously
recorded snapshot remains byte-identical. The canonical graph produced by that
snapshot is then subject to the ordinary Lachesis evidence-time filtering.

## Three-graph separation

1. Lachesis functional plans remain the orchestration graph.
2. TypeGraph contains only evidence facts, citations, and evidence
   relationships.
3. Lachesis reconstruction produces a separate run/provenance graph from the
   model's answer values and visible supporting facts.

No TypeGraph relationship is interpreted as executable plan control flow.

## Verified parity

Real managed TypeGraph SQLite integration tests cover every M4 development
fixture, provider profile, public task contract, and evidence view. They require
identical selected facts and edges, ordering, model-visible serialization,
neighborhood digests, compiler identities, validation decisions, citations,
bounded canonical paths, reconstructed provenance, and reconstruction digests.

Additional tests cover recorded replay, current retraction, deterministic row
ordering, hidden additions, duplicate identities, dangling references,
inconsistent intervals, source/schema mismatch, snapshot mismatch, missing
references, and closed-repository capability violations.

## Nonclaims

Parity establishes storage, temporal, and replay compatibility only. It does not
establish performance, scale, graph-retrieval advantage, model-quality
improvement, or a TypeGraph accuracy effect. M4d.1 subsequently closed as a
prospective design no-go without a confirmatory corpus or live study. See the
[M4 results](m4-results.md).
