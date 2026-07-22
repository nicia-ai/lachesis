# `@nicia-ai/lachesis-generator`

Status: **experimental**. This package exposes provider-neutral generation and
research infrastructure; it is not part of the stable-alpha runtime facade.

Provider-neutral generation, bounded compiler-guided repair, deterministic
recorded adapters, and resumable semantic benchmarks for Lachesis.

M1c adds public typed semantic obligations, deterministic infeasibility-witness
validation, and a dedicated shared-proposal repair benchmark. Obligation and
witness diagnostics enter the same bounded repair loop without exposing hidden
evaluation data. See
[the M1c design](../../docs/m1c-typed-semantic-obligations.md).

The core export owns model-output parsing and is portable to Workers. Adapters
return raw provider text plus optional provider-decoded structure; malformed
model output is measured separately from provider transport failure.

Model proposals contain only registered operator topology and arguments. Trusted
public input bounds and execution policy are bound locally; analysis derives
resource requirements and compilation checks those requirements against the
trusted policy. Manifest materialization can validate all references and offline
reference witnesses without exposing them to a provider.

Benchmark runs require a content-addressed `ExperimentManifest` and resume by
its digest. Research gates use held-out records, matched comparison tuples,
explicit denominators, and 95% confidence intervals. Node filesystem storage is
available only from `@nicia-ai/lachesis-generator/node`.

M6a/M6b adds an offline experimental compositional-harness surface: successful
plans can be normalized into trajectory-shape and strategy-contract identities,
promoted into immutable typed templates, matched against public task features,
bound only through public value slots, and recompiled through the ordinary
kernel boundary. The registry fails closed on semantic mismatch, envelope
overflow, ambiguity, authority widening, and identity tamper. It makes no live
provider or learned-generalization claim. See the
[M6 design](../../docs/m6a-compositional-harness.md).

M1a contains no live model SDK. Provider adapters and CodeMode enter only in the
M1b pilot, outside `@nicia-ai/lachesis`.
