# `@nicia-ai/lachesis-evidence`

Portable, substrate-neutral evidence-selection contracts plus deterministic
in-memory graph and matched-text reference implementations for the offline M3a.1
factorial design milestone.

The substrate contract does not turn evidence edges into plan dependencies or
execution events. M3b adds a portable matched-study scheduler, one compiled
oracle-effect plan, and typed run records above that boundary. The package does
not depend on TypeGraph or a provider SDK.

M3a.1 provides four matched arms: lexically selected rendered facts,
graph-selected facts, the same graph facts with untyped cited adjacency, and the
same graph facts with cited typed edges and paths. Queries bound facts,
citations, edges, paths, hops, canonical bytes, and a conservative token upper
bound. Facts and edges carry valid-time and recorded-time intervals, and every
edge has independent provenance citations.

The package contains no provider SDK or TypeGraph integration. Its 30-case
development and 140-case held-out synthetic corpora are offline benchmark
fixtures only; they do not authorize M3b or live inference.

The package also contains M3b's offline execution infrastructure: a single
compiled oracle-effect plan, arm-blinded normalized requests, four-arm Williams
scheduling, digest-validating resume, deterministic zero-network oracle
fixtures, symmetric controller retry records, and exact contrast-specific paired
statistics. Its M3b held-out corpus adds 20 negative controls under a new
identity, for 60 total, without changing the frozen M3a.1 constants.

All generated M3b manifests remain unauthorized with zero operational pool
allowance. No provider adapter or TypeGraph dependency is present.

M3b.3 keeps this package provider-neutral while binding answer intent into a
public executable contract. Typed outputs name supporting facts; deterministic
validation derives permissible values from visible facts, verifies their
citations, and enforces the exact sufficiency/abstention rule. One bounded
semantic repair receives only public obligations, the previous output,
deterministic diagnostics, and the same arm-visible evidence. First-attempt and
final repaired outcomes remain separate.

See [the M3a design](../../docs/m3a-graph-native-decomposition.md) and the
[M3b offline execution protocol](../../docs/m3b-offline-execution.md), and the
[M3b.2 correction](../../docs/m3b2-protocol-correction.md), and the
[M3b.3 semantic obligations](../../docs/m3b3-semantic-obligations.md), and the
[M3b.4 staged wire-recovery design](../../docs/m3b4-structured-output-forensics.md).
