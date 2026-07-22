# M7b offline diagnostic hardening

This private fixture exercises the portable generator package exactly as an
external consumer would, without credentials, provider calls, model inference,
or TypeGraph. Its nine-case development corpus is intentionally disjoint from
the future M7c author study.

Build and verify the committed deterministic report:

```bash
pnpm --filter @nicia-ai/lachesis-m7b-diagnostics build
pnpm --filter @nicia-ai/lachesis-m7b-diagnostics report
```

`report:write` regenerates the checked-in report only when deliberately updating
the M7b corpus or protocol. The runner first verifies that M7a still contains
the frozen report digest
`8cc35372ec4f4f560180a2f26cf4edb46c9c298f49f21cc39f8df07cde19cf85`.

Every genuine semantic mismatch must remain rejected and must carry a typed
`do-not-substitute` action. Declaration guidance is conditional on author
attestation; it is not an instruction to edit metadata until a test passes.
