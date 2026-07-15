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

See [the M1b runbook](../../docs/m1b-runbook.md) before any live use.
