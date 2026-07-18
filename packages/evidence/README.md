# `@nicia-ai/lachesis-evidence`

Portable, substrate-neutral evidence-selection contracts plus deterministic
in-memory graph and matched-text reference implementations. M3 is closed; the
package now includes an offline M4a/M4b evidence compiler and deterministic
provenance-reconstruction vertical slice.

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

M3b.5 completed and M3 is frozen as `complete-formal-fail`. Its corpora and
outcomes are development evidence only for M4 and cannot become M4 held-out
evidence. No provider adapter or TypeGraph dependency is present.

M3b.3 keeps this package provider-neutral while binding answer intent into a
public executable contract. Typed outputs name supporting facts; deterministic
validation derives permissible values from visible facts, verifies their
citations, and enforces the exact sufficiency/abstention rule. One bounded
semantic repair receives only public obligations, the previous output,
deterministic diagnostics, and the same arm-visible evidence. First-attempt and
final repaired outcomes remain separate.

M4a compiles all four evidence views under a content-addressed provider/task
policy, exposes only the selected normalized context to an oracle, and retains
graph facts as a control rather than a default. M4b reduces the oracle output to
answer values and supporting fact IDs, then deterministically validates the
public answer contract and reconstructs citations, bounded shortest paths, and a
content-addressed provenance graph. This package still contains no M4 live
controller, campaign, held-out corpus, or TypeGraph adapter.

See [the M3a design](../../docs/m3a-graph-native-decomposition.md) and the
[M3b offline execution protocol](../../docs/m3b-offline-execution.md), and the
[M3b.2 correction](../../docs/m3b2-protocol-correction.md), and the
[M3b.3 semantic obligations](../../docs/m3b3-semantic-obligations.md), and the
[M3b.4 staged wire-recovery design](../../docs/m3b4-structured-output-forensics.md),
the immutable [M3 results](../../docs/m3-results.md), and the offline
[M4a/M4b design](../../docs/m4a-evidence-compiler.md).
