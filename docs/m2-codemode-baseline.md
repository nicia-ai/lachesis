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

The immutable model-visible grammar is defined beside the compiler and is
embedded verbatim in every initial and repair request. Its exact signatures are:

```text
await ops.invoke("id@version", value)
await ops.map("id@version", value)
await ops.filter("id@version", value)
await ops.fold("id@version", value)
await ops.effect("id@version", value)
await ops.select(condition, primary, fallback)
await ops.boundedFix("step-id@version", "measure-id@version", value, nonnegativeIntegerLimit)
```

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

## Prospective paired analysis

The analysis plan is content-addressed into every M2 phase. Binary paired
outcomes use two-sided exact McNemar tests for task correctness, repair-free
final success, and runtime-failure-free success. The statistical unit is one
case-provider pair within one repetition. Preregistered repetition 1 (record
index 0) is the primary analysis; repetition 2 (record index 1) is an
independent confirmation. Outcomes are never pooled across repetitions, and the
main conclusion must pass prospectively declared gates in both. Each repetition
also reports provider-stratified binary, cost, and latency results.

Feasible semantic success uses a functional-IR non-inferiority margin of -10
percentage points. The gate uses the 95% Tango asymptotic score interval for a
paired risk difference: its lower confidence bound must be at least -0.10. An
observed difference or sensitivity count cannot substitute for that interval.
The implementation is frozen against Robert Newcombe's published
`N=50, b=12, c=2` Tango vector and the Cavo and zero-cell boundary vectors in
CRAN `contingencytables` 3.1.0. The method follows
[Tango (1998)](<https://doi.org/10.1002/(SICI)1097-0258(19980430)17:8%3C891::AID-SIM780%3E3.0.CO;2-B>).
Cost and latency report paired means, medians, and exact sign tests separately
for each provider and repetition.

A directional superiority claim requires at least ten discordant pairs in each
repetition. Exact p-values are reported without post-hoc threshold changes. This
minimum does not affect non-inferiority, which is decided only by the frozen
paired confidence interval.

Prospective gates are:

- at least 95% final task correctness in each representation;
- functional-IR semantic non-inferiority at the frozen margin;
- no paired repair-free-final-success disadvantage for functional IR;
- no paired runtime-failure disadvantage for functional IR;
- all gates pass independently in primary and confirmation repetitions;
- zero unauthorized or contract-mismatched execution;
- a superiority claim only when the frozen discordant-pair minimum is met in
  both repetitions.

## Independent campaign and phases

The M2 controller materializes a new campaign named
`lachesis-m2-functional-ir-vs-restricted-capability-typescript`. Its campaign
digest, phase digests, schedules, transports, pricing, source commit, and paired
analysis identity are independent of M1c.

Worst-case conservative theoretical ceilings are derived from the frozen
methods, token limits, repetitions, pricing, and two-repair bound:

| Phase          | Initial records | Maximum repairs | Maximum calls |        Exact cap |
| -------------- | --------------: | --------------: | ------------: | ---------------: |
| Protocol probe |               8 |               0 |             8 |   2,259,200 µUSD |
| Calibration    |              36 |              72 |           108 |  30,499,200 µUSD |
| Held-out       |             240 |             480 |           720 | 203,328,000 µUSD |

These phase ceilings disclose the maximum possible reservation demand; they are
not campaign authorization. M2.2 instead freezes smaller operational pools:

| Pool        | Total µUSD | OpenAI µUSD | Anthropic µUSD |
| ----------- | ---------: | ----------: | -------------: |
| Development | 10,000,000 |   6,000,000 |      4,000,000 |
| Held-out    | 60,000,000 |  35,000,000 |     25,000,000 |

Every provider request must still reserve its complete worst-case call cost
before dispatch. Post-dispatch failures without usage consume that full
reservation conservatively. Once either the total or provider operational pool
cannot fund the next complete request, execution stops before dispatch. The
campaign ceiling is therefore 70,000,000 µUSD, not the 236,086,400 µUSD sum of
the theoretical phase ceilings.

The paired protocol probe is exactly eight initial calls: two representations ×
one feasible and one typed-unplannable outcome × two providers. It has no repair
calls. Each phase requires a separate exact acknowledgement after offline
materialization and review.

## Superseded M2.1 identities

The source commit `e26e76b8cbae7bfa827dfd2deb97773afe41ff70` and campaign
`09e8ee6cb1fd090f80f7be4fd14e8b1fd746e815b2a409fce1bdcdd72f38ca68` were never
executed or externally preregistered. Their probe, calibration, and held-out
experiment identities (`490f8fb3…`, `96379661…`, and `b0fa6ece…`) are
machine-marked `superseded-unexecuted`. Verification under M2.2 rejects those
analysis and authorization identities.

## M2.3 deterministic protocol correction

The M2.2 probe at source `933dfc62235658597cf5bbcc0d4c5247571965d1` made eight
calls before calibration or held-out access. Both functional-IR plans and all
four typed-witness branches passed. Both feasible restricted TypeScript
responses reached structured output but violated the compiler's entry-point
contract, so the preregistered 8/8 probe gate failed 6/8. The probe experiment
`0a8c35b9…` is immutable and report-only.

The deterministic defect was prompt/compiler drift: the compiler required
`export default async function main(input, ops)` and direct awaited `ops.*`
calls, while the model-visible protocol described those constraints only
abstractly. M2.3 defines one immutable grammar contract beside the compiler,
includes its canonical template and every capability signature in initial and
repair requests, and tests the canonical witness through the real compiler and
both intercepted provider serializers. This correction changes prompt, protocol,
adapter, experiment, and phase identities but does not change the corpus,
models, inference settings, schedule algorithm, scorer, analysis, or prospective
gates.

The unexecuted M2.2 calibration `79bf9900…` and held-out `98e7da38…` experiments
are `superseded-unexecuted`. Neither may execute or resume. M2.3 requires a
fresh matched eight-call probe and separate authorization before any development
calibration.

## Claim boundary

The failed M2.2 protocol probe is transport and protocol evidence only. It is
not calibration evidence and cannot support a representation comparison. The
intended live order remains a fresh matched protocol probe, development
calibration, offline held-out freeze review, then separately authorized held-out
execution. The implementation and campaign definitions are offline substrate,
not evidence that either representation is superior. TypeGraph and
bounded-general CodeMode remain deferred.
