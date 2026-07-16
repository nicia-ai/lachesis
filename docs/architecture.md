# Measured Plan Kernel architecture

## Compiler and execution pipeline

```mermaid
flowchart LR
  JSON["Untrusted JSON"] --> PARSE["Parse + Zod wire validation"]
  PARSE --> NORMALIZE["Normalize IDs + graph"]
  NORMALIZE --> CHECK["Resolve catalog + type-check"]
  CHECK --> ANALYZE["Effects, capabilities + resource proofs"]
  ANALYZE --> CANON["Plan + catalog fingerprints"]
  CANON --> ARTIFACT["Opaque ExecutablePlan"]
  ARTIFACT --> EXEC["Pure / mock / replay interpreter"]
  EXEC --> TRACE["Separate typed provenance trace"]
```

Every arrow strengthens the value's guarantees. Parsing accepts text and returns
only a validated wire document. Normalization builds a `ReadonlyMap`, detects
identity/reference failures, and establishes topological order. Checking proves
nominal schema compatibility at every edge. Analysis must prove every relevant
maximum and policy inclusion before execution. Compilation snapshots the catalog
and binds analysis, the plan hash, catalog fingerprint, capability set, and
budget into an opaque `ExecutablePlan`. Execution accepts only that artifact and
independently enforces capabilities, actual usage, and runtime schemas.

The public package does not export normalization, checking, or analysis entry
points. Callers cannot pair artifacts from separate compilations or substitute a
catalog at execution time.

## Three graphs

```mermaid
flowchart TB
  PG["Plan / orchestration graph<br/>immutable operators and dependencies"]
  KG["Knowledge / evidence graph<br/>external domain facts and provenance"]
  RG["Run / provenance graph<br/>events, effects, digests and usage"]
  PG -. "instantiated as" .-> RG
  RG -. "may reference external evidence" .-> KG
  KG -. "never controls execution implicitly" .-> PG
```

The kernel implements the plan graph and an in-memory run graph. The separate
`@nicia-ai/lachesis-evidence` package now implements a substrate-neutral
knowledge/evidence contract plus deterministic matched-text and in-memory graph
reference sources for the M3a.1 four-arm factorial benchmark. Evidence queries
bound facts, citations, edges, paths, hops, and serialized context; facts and
relationships carry separate valid-time and recorded-time intervals, and
relationships require independent provenance citations. A future run record may
link a typed evidence-selection digest into provenance, but knowledge
relationships never become scheduling edges and run events never become evidence
claims. See
[M3a.1 graph-native decomposition](./m3a-graph-native-decomposition.md).

## Catalog trust boundary

Plans see only stable IDs and versions. Generic registration builders retain
typed implementations in closures. Their erased runtime functions accept
`unknown`, validate through the registered input schema, invoke typed code, and
validate output before returning `unknown`. The heterogeneous catalog therefore
does not require `any`, covariance assertions, or model-authored code.

Schema compatibility is conservative and nominal. Equal identities are
compatible; collection element compatibility comes from registered collection
metadata. There is no coercion or structural-subtyping guess.

Catalog tokens hold frozen snapshots. Their canonical manifest fingerprints all
schema descriptions and JSON Schemas, operation signatures, effect declarations,
bounds, and reducer laws. The generator-facing `PlanLanguageManifest` combines
that catalog fingerprint with the plan JSON Schema and the available policy.

## Bounds

Mapped effect calls are multiplied by the source collection's proven maximum.
`select` unions possible effects/capabilities but uses the maximum branch cost,
because one statically present branch executes. `boundedFix` contributes its
hard iteration maximum and performs no undeclared effect. Unknown cardinality
that reaches a relevant resource calculation rejects the plan.

The static report is conservative. It predicts maxima, not actual usage. The
trace records actual calls, tokens, wall-clock usage reported by effect
handlers, recursion depth, and parallelism.

## Portability

The kernel targets ES2022 with `ES2023` and `WebWorker` declarations and an
empty ambient `types` set. It uses `crypto.subtle`, `TextEncoder`, and injected
time/identity providers. The CLI alone owns filesystem and process behavior.
Compatibility fixtures consume built public exports in Node and through a real
Wrangler/Workers bundle.

## Current guarantee boundary

Canonical identity is syntactic, not semantic: object key order is normalized,
array order remains significant, and all plan/catalog/policy references in the
wire document contribute to the hash. Equivalent programs are not promised the
same hash.

Replay reuses recorded external results only when the effect request hash
matches. That hash binds the plan, catalog, operation version, node/invocation,
effect name, and input digest. Recorded output digests are checked before a
value is returned. Replay does not claim that rerunning a provider would
reproduce a recording, nor that a semantically incorrect recorded answer becomes
correct.

## Typed semantic obligations

The compiler accepts public, typed task obligations separately from the
model-authored plan and trusted execution policy. The analyzer records root
provenance—contributing nodes, public inputs, operations, effects, trusted
state-changing operations, and graph dominators—then the compiler checks each
obligation before creating an executable artifact. Nodes outside root provenance
are rejected during normalization. See
[M1c typed semantic obligations](./m1c-typed-semantic-obligations.md).
