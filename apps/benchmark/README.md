# Lachesis M1b experiment controller

`@nicia-ai/lachesis-benchmark` is the Node-only controller for controlled
plan-generation experiments. It materializes and verifies content-addressed
campaign/phase manifests, performs zero-network preflight, coordinates live
execution through a durable campaign ledger, resumes immutable records, and
reconstructs reports without loading providers.

Commands:

```text
lachesis-benchmark materialize <transport-probe|smoke|calibration|heldout> --out DIR
lachesis-benchmark validate --campaign FILE --manifest FILE
lachesis-benchmark dry-run --campaign FILE --manifest FILE --storage-root DIR
lachesis-benchmark execute --campaign FILE --manifest FILE --storage-root DIR \
  --ack-experiment DIGEST --ack-phase PHASE --ack-max-usd-micros INTEGER
lachesis-benchmark resume  # same bindings as execute
lachesis-benchmark report --campaign FILE --manifest FILE --storage-root DIR
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
