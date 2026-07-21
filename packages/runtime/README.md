# `@nicia-ai/lachesis-runtime`

The supported public-alpha workflow for Lachesis evidence-backed execution. This
ESM package composes the existing compiler, lexical-default evidence runtime,
deterministic citation/provenance reconstruction, and exact replay without
exposing benchmark or provider-controller internals.

```ts
import {
  compilePlan,
  createInMemoryEvidenceStore,
  createRecordingOracleInterpreter,
  createMemoryRecordingStore,
  replay,
  run,
} from "@nicia-ai/lachesis-runtime";

const compiled = await compilePlan(planJson, catalog, policy, obligations);
if (!compiled.ok) return compiled;

const completed = await run({
  executablePlan: compiled.value,
  publicTaskContract,
  inputValues,
  trustedPolicy,
  evidenceStore,
  snapshot,
  oracle: createRecordingOracleInterpreter(hostOracle),
  recordingStore: createMemoryRecordingStore(),
  signal,
});
```

Successful results contain the typed answer, canonical citations, reconstructed
provenance, plan and semantic-contract identities, pinned evidence and visible
view identities, effect identity, budgets, usage, and a redaction-safe trace.
Expected failures are discriminated `Result` values.

The portable root export uses Web Platform APIs and works in Node 24 and
Cloudflare Workers. `@nicia-ai/lachesis-runtime/node` adds the optional private
file recording store and private SQLite preparation/audit helpers. It is
Node-only and requires a POSIX user identity and permission model.

Provider adapters and TypeGraph are injected separately. The default evidence
policy is lexical. Research policies require an explicit acknowledgement.

See the [public-alpha guide](../../docs/public-alpha.md), the
[M5 runtime architecture](../../docs/m5a-evidence-runtime.md), and the
[M5 operational result](../../docs/m5-results.md).
