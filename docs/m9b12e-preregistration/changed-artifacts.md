# M9b.12e changed-artifact inventory

## New implementation and tests

- `packages/generator-ai-sdk/internal/m9b12e-preregistration.ts`: private,
  checksum-bound correction and registration model.
- `packages/generator-ai-sdk/internal/m9b12e-durable-authority-node.ts`: private
  local SQLite authority, consistency/recovery anchor, opaque identity issuance,
  authenticated presenter boundary, quarantine, and atomic admission.
- `packages/generator-ai-sdk/tests/m9b12e-preregistration.test.ts`: package,
  registration, invariance, threat-boundary, and facade checks.
- `packages/generator-ai-sdk/tests/m9b12e-durable-authority.test.ts`: lifecycle,
  opaque identity, presenter mismatch, race, crash, storage, event-chain,
  positive, and 12-role assertions.
- `packages/generator-ai-sdk/tests/m9b12e-cross-process.test.ts` and
  `m9b12e-process-worker.test.ts`: genuine Process A exit and Process B reopen.

## Preserved predecessors

All M9b.12 through M9b.12d package artifacts remain byte-identical to reviewed
commit `5dff4a5f74933135c4c686f1c94df04cc320f53b`. The only preceding append is
the exact M9b.12d independent-review evidence committed before implementation.
