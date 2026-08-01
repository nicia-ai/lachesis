# M9b.12d changed-artifact inventory

## New implementation and tests

- `packages/generator-ai-sdk/internal/m9b12d-preregistration.ts`: private,
  checksum-bound correction package and registration model.
- `packages/generator-ai-sdk/internal/m9b12d-durable-authority-node.ts`: private
  Node SQLite authority, trusted anchor, identity issuance, quarantine, and
  atomic admission implementation.
- `packages/generator-ai-sdk/tests/m9b12d-preregistration.test.ts`: package,
  registration, invariance, and public-facade checks.
- `packages/generator-ai-sdk/tests/m9b12d-durable-authority.test.ts`: lifecycle,
  identity, race, crash, hostile storage, event-chain, positive, and 12-role
  terminal assertions.
- `packages/generator-ai-sdk/tests/m9b12d-cross-process.test.ts` and
  `m9b12d-process-worker.test.ts`: genuine Process A exit and Process B reopen
  proof.

## New package documentation

This directory contains the canonical preregistration and registration JSON;
authority, identity, admission, supersession, invariance, threat, operational,
authorization, nonclaim, and review-finding documentation; and the sealed
binding, verification, and checksum evidence added after implementation commit.

## Preserved predecessors

All M9b.12, M9b.12a, M9b.12b, and M9b.12c artifacts are byte-identical to
reviewed commit `c9e50ff3db56f898184dc9b7be934b1f1c0560df`. The only evidence
appended outside this directory is the exact M9b.12c independent-review record
committed before implementation.
