# M2 functional IR versus restricted capability TypeScript

M2 is a representation ablation under one public task contract:

1. Lachesis functional JSON IR with trusted typed semantic obligations.
2. Restricted capability-oriented TypeScript with the same obligations and only
   registered operations exposed through a capability-scoped `ops` parameter.

The accepted TypeScript is a surface over a closed capability algebra. It does
not support ordinary application computation, callbacks, loops, helper
functions, imports, or general JavaScript libraries. M2 therefore cannot support
a superiority claim over conventional or bounded-general CodeMode. A broader
CodeMode arm would require a separate protocol and safety boundary.

M1c is frozen. M2 uses only `m2/` case IDs, `m2.*` catalogs, fresh hidden
values, new prompt and protocol versions, and a separate campaign. Nothing in
the M2 controller resumes, rewrites, or dispatches against an M1c record.

## Isolation boundary

Model-authored source never enters the Lachesis plan wire format or kernel. The
generator parses TypeScript with the Babel TypeScript parser and lowers the
accepted subset into a private, closed SSA/capability AST. Source is never
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
property access, ordinary JavaScript calls, unknown methods, and dead bindings
are rejected before execution.

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
validates output against the registered schema and enforces actual effect-call,
token, and wall-clock usage. A timeout aborts the execution context and prevents
later capability calls from dispatching.

## Provider protocol

Restricted capability TypeScript has a separate versioned outcome:

```json
{ "kind": "program", "source": "..." }
```

or the unchanged typed `unplannable` witness contract. Its portable structured
output schema uses a root object envelope and the conservative common provider
subset. Intercepted-fetch tests exercise the real installed OpenAI and Anthropic
packages. OpenAI uses Responses JSON Schema with low reasoning; Anthropic uses
its internal JSON-tool transport with adaptive-low thinking. SDK retries remain
zero and no external tools are exposed.

## Frozen counterbalanced schedule

The scheduling protocol hashes the exact case ID and digest, provider, model,
and repetition. Within each provider stratum, entries are sorted by that hash
and alternate which representation runs first. The 30-case, two-repetition
held-out matrix therefore has exactly 30 IR-first and 30 TypeScript-first pairs
per provider.

The complete schedule is persisted in the phase manifest. Its digest is bound
into the paired experiment identity. Execution admits only the next scheduled
record, completes both arms of a pair in the frozen order, and then advances.
Completed records still pass through the coordinator during resume, so a resume
cannot reorder or redispatch a pair. Changing method or case input order does
not change the schedule.

## Corpus and blind audit

The preregistered corpus is disjoint from M1b and M1c. Development contains nine
cases. Held-out contains 30 cases:

- six multi-step cases;
- six branch cases;
- six effect cases;
- six bounded-recursion cases;
- six infeasible cases, with two each for `missingOperation`,
  `deniedCapability`, and `insufficientBudget`.

Thus held-out has 24 feasible and six infeasible cases. Offline witnesses prove
all 24 feasible fixtures compile and pass their hidden properties in both
representations; all six infeasibility witnesses validate deterministically. The
counts-only audit exposes only aggregate validity and category counts.

## Preregistered paired analysis

The analysis plan is content-addressed into every M2 phase. Binary paired
outcomes use two-sided exact McNemar tests for task correctness, repair-free
final success, and runtime-failure-free success. Feasible semantic success uses
a functional-IR non-inferiority margin of -10 percentage points. Cost and
latency report paired means, medians, and exact sign tests separately for each
provider.

A directional inferential claim requires at least ten discordant pairs. With
fewer discordances, the report is explicitly sensitivity-only and gives the
number of adverse pairs needed to cross the non-inferiority margin. Exact
p-values are reported without post-hoc threshold changes.

Prospective gates are:

- at least 95% final task correctness in each representation;
- functional-IR semantic non-inferiority at the frozen margin;
- no paired repair-free-final-success disadvantage for functional IR;
- no paired runtime-failure disadvantage for functional IR;
- zero unauthorized or contract-mismatched execution;
- a superiority claim only when the frozen discordant-pair minimum is met.

## Independent campaign and phases

The M2 controller materializes a new campaign named
`lachesis-m2-functional-ir-vs-restricted-capability-typescript`. Its campaign
digest, phase digests, schedules, transports, pricing, source commit, and paired
analysis identity are independent of M1c.

Worst-case conservative ceilings are derived from the frozen methods, token
limits, repetitions, pricing, and two-repair bound:

| Phase          | Initial records | Maximum repairs | Maximum calls |        Exact cap |
| -------------- | --------------: | --------------: | ------------: | ---------------: |
| Protocol probe |               8 |               0 |             8 |   2,259,200 µUSD |
| Calibration    |              36 |              72 |           108 |  30,499,200 µUSD |
| Held-out       |             240 |             480 |           720 | 203,328,000 µUSD |

The development pool is the exact sum of probe and calibration: 32,758,400 µUSD,
with OpenAI 18,727,040 and Anthropic 14,031,360. The held-out pool is
203,328,000 µUSD, with OpenAI 116,236,800 and Anthropic 87,091,200. These
ceilings are fail-closed accounting limits, not permission to spend.

The paired protocol probe is exactly eight initial calls: two representations ×
one feasible and one typed-unplannable outcome × two providers. It has no repair
calls. Each phase requires a separate exact acknowledgement after offline
materialization and review.

## Claim boundary

No M2 provider inference has been run or authorized. The implementation and
campaign definitions are offline substrate, not evidence that either
representation is superior. TypeGraph and bounded-general CodeMode remain
deferred.
