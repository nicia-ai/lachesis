# M9b.12f changed-artifact inventory

New private sources and tests use only the M9b.12f protocol family:

- `packages/generator-ai-sdk/internal/m9b12f-preregistration.ts`
- `packages/generator-ai-sdk/internal/m9b12f-durable-authority-node.ts`
- `packages/generator-ai-sdk/tests/m9b12f-preregistration.test.ts`
- `packages/generator-ai-sdk/tests/m9b12f-durable-authority.test.ts`
- `packages/generator-ai-sdk/tests/m9b12f-cross-process.test.ts`
- `packages/generator-ai-sdk/tests/m9b12f-process-worker.test.ts`
- `packages/generator-ai-sdk/tests/m9b12f-sqlite-sidecar-worker.test.ts`

The new documentation directory and append-only M9b.12e review evidence are the
only other changes. All M9b.12 through M9b.12e package bytes remain identical to
baseline commit `b1a830f871fa8ab78cbce7ef6c8836fe4464b5c1` and tree
`e6dedd253cca8dda11894b4f84d4d5d1ffc59e6a`.
