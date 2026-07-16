# Lachesis controlled experiment controller

`@nicia-ai/lachesis-benchmark` is the Node-only controller for controlled
plan-generation experiments. It materializes and verifies content-addressed
campaign/phase manifests, performs zero-network preflight, coordinates live
execution through a durable campaign ledger, resumes immutable records, and
reconstructs reports without loading providers.

Commands:

```text
lachesis-benchmark materialize <transport-probe|smoke|calibration|heldout> --out DIR
lachesis-benchmark materialize <m1c-protocol-probe|m1c-repair|m1c-calibration|m1c-heldout> --out DIR
lachesis-benchmark materialize <m2-protocol-probe|m2-calibration|m2-heldout> --out DIR
lachesis-benchmark validate --campaign FILE --manifest FILE
lachesis-benchmark dry-run --campaign FILE --manifest FILE --storage-root DIR
lachesis-benchmark execute --campaign FILE --manifest FILE --storage-root DIR \
  --ack-experiment DIGEST --ack-phase PHASE --ack-max-usd-micros INTEGER
lachesis-benchmark resume  # same bindings as execute
lachesis-benchmark report --campaign FILE --manifest FILE --storage-root DIR
lachesis-benchmark audit-heldout
lachesis-benchmark audit-m1c-heldout
lachesis-benchmark audit-m2-heldout
```

Import, manifest materialization, validation, dry-run, and reporting are inert:
they neither load provider models nor make provider requests. Live execution is
the only path that constructs credential-bearing adapters, and it does so only
after preflight and exact spend acknowledgement succeed.

M1b.4 compiles a strict root-object JSON Schema from each exact language
manifest and passes it directly through the AI SDK JSON-schema wrapper. OpenAI
uses Responses structured output; Anthropic uses the SDK's internal `json` tool
transport with the identical schema. The tool is only an output-serialization
mechanism for `GenerationOutcome`; Lachesis does not enable model-controlled
external tools. Unsupported catalog schemas fail during zero-network preflight,
before any budget reservation.

M1b.5 also resolves every required case reference and compiles a hidden offline
reference witness for every plannable fixture before materialization. The model
proposes computation only; trusted public bounds and policy are bound locally.
`audit-heldout` reports only aggregate validity counts and never returns
held-out case content. It separately counts compiled feasible witnesses,
hidden-property passes, and machine-verified infeasibility witnesses.

M1b.4 stores each phase under a namespace derived from the complete experiment
digest. A repaired smoke can therefore register beside the immutable original
`m1b/smoke/v1` namespace while both consume the same campaign-level development
pool.

Both prior smoke experiments and their shared ledger are append-only and are
neither edited nor credited. The ledger's six OpenAI conservative settlements
are historical overestimates: the old adapter classified the callable-provider
reflection failure as though a request had been dispatched. M1b.3 records
explicit dispatch evidence; pre-dispatch failures settle at zero tokens and zero
cost, while dispatched failures without provider usage retain the authorized
conservative charge.

See [the M1b runbook](../../docs/m1b-runbook.md) before any live use.

M1c uses a distinct campaign and budget pools. Its protocol probe is an exact
four-call matrix: one feasible plan and one typed-unplannable response through
both providers. The repair phase stores deterministic mutations and binds both
arms to one recomputed initial-proposal digest; only eligible failed proposals
dispatch, while valid proposals are reported as `repair-unnecessary`. Functional
IR is the only implemented representation, so the M1c corpus and protocol make
no IR-versus-CodeMode claim. See
[the M1c design note](../../docs/m1c-typed-semantic-obligations.md).

M2 is a separate, paired representation-ablation campaign: functional JSON IR
versus restricted capability-oriented TypeScript. A content-addressed,
provider-stratified schedule counterbalances which representation runs first and
is preserved across resume. The frozen paired analysis reports exact McNemar
tests, a semantic non-inferiority margin, repair/runtime comparisons, and
provider-stratified cost and latency. The protocol probe is exactly eight calls:
two representations × one feasible and one typed-unplannable task × two
providers. Campaign ceilings are not authorization to spend. Conventional
CodeMode and TypeGraph remain unevaluated. See
[the M2 design note](../../docs/m2-codemode-baseline.md).
