# `@nicia-ai/lachesis-evidence`

Portable, substrate-neutral evidence-selection contracts plus deterministic
in-memory graph and matched-text reference implementations for the offline M3a
design milestone.

The package does not schedule plans, execute effects, record run provenance, or
depend on TypeGraph. An `EvidenceNeighborhood` is external knowledge selected
for a task. Its digest may be referenced by a future run record, but its edges
never become plan dependencies or execution events.

See [the M3a design](../../docs/m3a-graph-native-decomposition.md).
