# Lachesis M1b experiment controller

`@nicia-ai/lachesis-benchmark` is the Node-only controller for controlled
plan-generation experiments. It materializes and verifies content-addressed
campaign/phase manifests, performs zero-network preflight, coordinates live
execution through a durable campaign ledger, resumes immutable records, and
reconstructs reports without loading providers.

Commands:

```text
lachesis-benchmark materialize <smoke|calibration|heldout> --out DIR
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

Anthropic structured output uses the AI SDK's internal `json` tool transport. It
is only an output-serialization mechanism for `GenerationOutcome`; Lachesis does
not enable model-controlled external tools.

M1b.3 stores each phase under a namespace derived from the complete experiment
digest. A repaired smoke can therefore register beside the immutable original
`m1b/smoke/v1` namespace while both consume the same campaign-level development
pool.

The original smoke ledger is append-only and is neither edited nor credited. Its
six OpenAI conservative settlements are historical overestimates: the old
adapter classified the callable-provider reflection failure as though a request
had been dispatched. M1b.3 records explicit dispatch evidence; pre-dispatch
failures settle at zero tokens and zero cost, while dispatched failures without
provider usage retain the authorized conservative charge.

See [the M1b runbook](../../docs/m1b-runbook.md) before any live use.
