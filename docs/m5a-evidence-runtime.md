# M5a production evidence runtime

Status: offline vertical slice complete. M5a makes no provider call, creates no
research campaign or experiment identity, and implements no live provider
dispatch.

M5a composes the existing opaque executable-plan boundary, M4 evidence compiler,
visible-evidence validator, deterministic provenance reconstruction, and
optional M4c TypeGraph adapter into one production-oriented workflow. Lexical
facts are the model-facing default.

## Concise tutorial

Compile the capability-scoped oracle plan with `@nicia-ai/lachesis`, then bind
its identities into a trusted runtime policy. The oracle plan must accept the
runtime-owned reduced request at the declared input and return the reduced
output unchanged.

```ts
import {
  createInMemoryM5EvidenceStore,
  createM5OracleEffectIdentity,
  createM5RecordingOracleInterpreter,
  createMemoryM5RecordingStore,
  runM5EvidenceRuntime,
} from "@nicia-ai/lachesis-evidence";

const evidenceStore = await createInMemoryM5EvidenceStore({
  id: "product-evidence",
  version: "1",
  snapshots: [{ recordedAt, graph }],
});

const effectIdentity = await createM5OracleEffectIdentity({
  id: "host-oracle",
  version: "1",
  implementation: "host-injected/1",
});

if (!evidenceStore.ok || !effectIdentity.ok) {
  throw new Error("Offline runtime setup failed.");
}

const oracle = createM5RecordingOracleInterpreter({
  identity: effectIdentity.value,
  invoke: hostOracleEffect,
});

const recordings = createMemoryM5RecordingStore();
const run = await runM5EvidenceRuntime({
  executablePlan,
  publicTaskContract,
  inputValues,
  trustedPolicy,
  evidenceStore: evidenceStore.value,
  snapshot: { validAt, recordedAt },
  oracle,
  recordingStore: recordings,
  signal: abortController.signal,
});
```

Production applications should replace the memory recording store with a durable
implementation of the same content-addressed interface. The portable runtime
does not choose or instantiate a provider SDK.

## Public API reference

The portable API is exported by `@nicia-ai/lachesis-evidence`:

- `runM5EvidenceRuntime(input)` pins evidence, compiles the view, executes the
  supplied `ExecutablePlan`, validates the reduced oracle output, reconstructs
  provenance, persists a replay artifact, and returns a typed result.
- `replayM5EvidenceRuntime(input)` loads an exact artifact and verifies the
  plan, semantic contract, task, policy, request, effect recording, evidence
  snapshot, visible view, result, and reconstruction identities without an
  evidence store or oracle effect.
- `createInMemoryM5EvidenceStore(input)` provides deterministic versioned
  snapshots for offline, mock, and replayable workloads.
- `createM5RecordingOracleInterpreter(effect)` records an injected bounded
  effect. It does not grant the effect ambient authority.
- `createM5MockOracleInterpreter(input)` resolves content-addressed fixtures and
  supports deterministic typed fault injection.
- `createM5OracleEffectIdentity(input)` binds the reduced request and output
  schemas into the host effect identity.
- `createMemoryM5RecordingStore()` is an offline recording fixture.

`M5RuntimeResult` contains the typed answer, visible citations, reconstructed
provenance, plan hash, semantic-contract hash, task and policy identities,
evidence snapshot, visible-view identity, oracle-effect identity, budget limits
and usage, and a redaction-safe trace. `M5ReplayArtifact` retains the compiled
view, pinned source snapshot, reduced request/output, kernel effect replay
entry, and final result under one canonical digest.

Expected operational failures use the `M5RuntimeFailure` discriminant. It
distinguishes plan and semantic-contract mismatches, snapshot and visible-view
mismatches, missing support, capability denial, budget exhaustion, oracle wire
and semantic rejection, replay mismatch, provenance failure, store/recording
failure, and cancellation.

## Architecture and trust boundaries

M5a preserves three graph domains:

1. The opaque `ExecutablePlan` is the plan/orchestration graph.
2. The evidence store supplies a pinned knowledge/evidence graph snapshot.
3. Deterministic reconstruction emits a separate run/provenance graph.

Evidence edges never become executable control flow. The retained source graph
is used to compile and audit the selected view; answer validation, citations,
paths, and provenance use only the public task contract, exact model-visible
context, and reduced oracle output.

The trusted policy binds the expected plan and semantic-contract hashes,
provider profile, oracle input/effect/capability names, evidence policy, and
call/token/time/concurrency budgets. The default branch compiles lexical facts.
A non-default M4 research policy requires the literal
`explicit-research-policy-opt-in` acknowledgement and remains non-production.
Provider, storage, policy, representation, TypeGraph, source, and
expected-answer identities are absent from the oracle request.

Portable exports use Web Platform APIs only. Cancellation is propagated through
the evidence-store and oracle-effect boundaries. Traces contain stages and
content identities, not raw prompts, evidence, answers, credentials, or
exceptions.

## Record and replay semantics

Every successful mock or record run writes a content-addressed replay artifact.
The artifact includes enough selected evidence, effect output, usage, and kernel
replay data to execute and validate the same plan again without contacting the
oracle or evidence source.

Replay requires the exact artifact digest, executable plan, semantic contract,
public task contract, and trusted policy. It re-executes the plan with the
kernel's replay handler and reruns visible-evidence provenance reconstruction.
Any request, output, snapshot, visible-view, result, or reconstruction mismatch
fails closed. A successful replay returns the original typed runtime result.

### Temporal and retraction example

The end-to-end integration fixture records an Atlas owner answer at a pinned
TypeGraph recorded-time checkpoint. A replacement owner fact is valid only at a
later valid-time coordinate. After the old fact is retracted:

1. the historical recorded-time plus valid-time lens still returns `Mira`;
2. the current snapshot returns `Noor`;
3. replay of the historical artifact returns the original `Mira` result without
   calling TypeGraph or the oracle; and
4. supplying a different expected storage-snapshot digest fails before oracle
   invocation.

The example changes knowledge state, not the plan or public answer contract.

## TypeGraph integration

TypeGraph remains optional and is not imported by the portable evidence package.
`@nicia-ai/lachesis-evidence-typegraph` exports
`createM5TypeGraphEvidenceStore(repository)`, which adapts an M4c repository
created from a host-provided TypeGraph `HistoryStore`. This is the portable
TypeGraph path and is compatible with Cloudflare-hosted stores.

The Node-only `@nicia-ai/lachesis-evidence-typegraph/sqlite` subpath exports
`createM5TypeGraphSqliteEvidenceStore(input)` for managed local SQLite. Node
requirements do not leak into the main package declarations.

Integration tests require byte-identical answers, citations, provenance,
reconstruction identities, and visible-view identities across in-memory,
host-provided TypeGraph HistoryStore, and managed SQLite workflows. Storage
audit identities may differ. Recorded-time tests retain a historical answer,
apply a later TypeGraph retraction, observe the changed current answer, and
replay the historical result without store or oracle access.

## Explicit nonclaims

M5a establishes an offline runtime composition and deterministic replay
property. It does not establish:

- provider or model quality;
- adaptive-policy, graph-serialization, or TypeGraph accuracy superiority;
- production scale, performance, availability, or security certification;
- correctness of a host-supplied live provider adapter; or
- authorization for M5b, a campaign, a manifest, or live inference.

## Remaining M5b blockers

A future live development pilot still requires a separately reviewed provider
adapter binding, durable recording implementation, credential and dispatch
boundary, frozen pricing and reservation accounting, operational retry policy,
natural-workload fixtures, redaction review, capacity planning, and independent
authorization. None is implemented or materialized by M5a.
