# `@nicia-ai/lachesis-evidence`

Portable, substrate-neutral evidence-selection contracts plus deterministic
in-memory graph and matched-text reference implementations for the offline M3a.1
factorial design milestone.

The package does not schedule plans, execute effects, record run provenance, or
depend on TypeGraph. An `EvidenceNeighborhood` is external knowledge selected
for a task. Its digest may be referenced by a future run record, but its edges
never become plan dependencies or execution events.

M3a.1 provides four matched arms: lexically selected rendered facts,
graph-selected facts, the same graph facts with untyped cited adjacency, and the
same graph facts with cited typed edges and paths. Queries bound facts,
citations, edges, paths, hops, canonical bytes, and a conservative token upper
bound. Facts and edges carry valid-time and recorded-time intervals, and every
edge has independent provenance citations.

The package contains no provider SDK or TypeGraph integration. Its 30-case
development and 140-case held-out synthetic corpora are offline benchmark
fixtures only; they do not authorize M3b or live inference.

See [the M3a design](../../docs/m3a-graph-native-decomposition.md).
