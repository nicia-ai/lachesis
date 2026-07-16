# M2 restricted TypeScript CodeMode baseline

M2 compares two computation representations under one public task contract:

1. Lachesis functional IR with trusted typed semantic obligations.
2. Restricted TypeScript CodeMode with the same obligations and only registered
   operations available through a capability-scoped `ops` parameter.

M1c is frozen. M2 uses new `m2/` case IDs, `m2.*` catalogs, new hidden values,
and a new protocol identity. Nothing in the M2 controller resumes, rewrites, or
dispatches against an M1c record.

## Isolation boundary

Model-authored source never enters the Lachesis plan wire format or kernel. It
is accepted only by `@nicia-ai/lachesis-generator`'s CodeMode boundary. The
boundary parses TypeScript with the Babel TypeScript parser and lowers the
accepted subset into a private, closed SSA/capability AST. The source is never
passed to `eval`, `Function`, a module loader, a Worker host realm, or a Node
VM. The interpreter has no binding for `fetch`, filesystem APIs, environment
variables, module imports, dynamic code, timers, or ambient globals.

The accepted program has exactly this shape:

```ts
export default async function main(input, ops) {
  const selected = await ops.filter("predicate@1", input.items);
  const mapped = await ops.map("function@1", selected);
  return mapped;
}
```

Only single-declarator `const` bindings and a final return are accepted. Values
are declared input fields, prior bindings, or scalar JSON literals. Capability
calls are `invoke`, `map`, `filter`, `fold`, `select`, `boundedFix`, and
`effect`. Imports, additional functions, callbacks, loops, recursion, computed
property access, ordinary JavaScript calls, and unknown capability methods are
rejected before execution. Dead bindings are rejected.

This is an isolate by construction: rejected syntax has no runtime semantics.
The implementation remains Worker-compatible and is exercised by the packaged
Cloudflare Worker consumer.

## Trusted authority

The model authors source topology and registered operation references. It does
not author capabilities, policy, public input bounds, or semantic obligations.
The benchmark supplies those values. Static compilation resolves every operation
against the exact catalog, validates nominal schemas, proves bounded collection
and fixed-point work, checks capabilities and budgets, computes root provenance,
and enforces the same typed obligations used by functional IR.

Effects are injected by the runtime. Requests include only the registered
operation, effect name, capability, input, and an abort signal. The runtime
validates provider output against the registered output schema and enforces
actual effect-call, token, and wall-clock usage. A timeout aborts the execution
context and prevents later capability calls from dispatching.

## Provider protocol

CodeMode has a separate versioned outcome:

```json
{ "kind": "program", "source": "..." }
```

or the unchanged typed `unplannable` witness contract. Its portable structured
output schema uses a root object envelope and the conservative common provider
subset. The real installed OpenAI and Anthropic packages are tested with
intercepted fetch. OpenAI uses Responses JSON Schema with low reasoning;
Anthropic uses its internal JSON-tool transport with adaptive-low thinking. SDK
retries remain zero and no external tools are exposed.

## Paired experiment

The paired controller requires one functional-IR schema-with-repair method and
one CodeMode schema-with-repair method for each identical provider/model pair.
It binds the IR subexperiment, CodeMode methods, cases, repetitions, and this
protocol into a new M2 experiment digest. Both arms share the budget controller;
reservations are rebound to the paired M2 digest. Content-addressed stores make
resume idempotent.

Measurements are recorded per case/provider/repetition:

- parse/transpile success;
- first and final compilation/execution success;
- hidden semantic correctness and typed abstention;
- runtime exceptions, timeouts, capability and budget violations;
- repair calls, provider cost, and latency;
- static analyzability;
- conservative predicted versus actual resource usage.

The first corpus revision contains six development cases and seven held-out
cases. Both splits cover `missingOperation`, `deniedCapability`, and
`insufficientBudget`. Seven feasible fixtures have paired offline IR and
CodeMode witnesses that compile and produce identical outputs on every hidden
evaluation.

## Claim boundary

No M2 provider inference has been run or authorized. The current implementation
is offline experiment substrate, not evidence that either representation is
superior. A campaign, budget ceilings, prospective gates, frozen manifests, and
separate phase authorizations are still required before live use. TypeGraph
remains deferred.
