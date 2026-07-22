# Lachesis

Lachesis is a typed functional compiler/runtime for measured agent programs.
Models may propose an immutable JSON plan, but they cannot add source code,
callbacks, hidden loops, or undeclared effects. The kernel parses, resolves,
type-checks, bounds, content-addresses, and executes the plan through explicit
effect interpreters.

This repository contains the measured plan kernel, deterministic generation
benchmark substrate, the frozen M1b/M1c experiment controllers, the completed M2
functional-JSON-IR versus restricted-capability-TypeScript representation
ablation, the completed M3 factorial evidence-substrate study, and the M5
public-alpha evidence runtime.

## What works

- Strict Zod validation for an untrusted, versioned graph wire format.
- Duplicate-ID, dangling-reference, missing-root, cycle, and dead-node
  detection.
- A versioned nominal schema and operation catalog with safe erased runtime
  boundaries.
- All initial operators: `input`, `constant`, `invoke`, `map`, `filter`, `fold`,
  `select`, `effect`, `checkpoint`, and `boundedFix`.
- Complete schema inference, effect/capability inference, conservative resource
  maxima, and budget rejection.
- Root provenance and typed input-dependency, operation-dominance, state-change,
  required-operation, and required-effect obligations.
- Portable canonical JSON and SHA-256 hashing through Web Crypto.
- An opaque compile/execute boundary that binds successful analysis, policy,
  plan hash, and immutable catalog fingerprint.
- A canonical generator-facing language manifest with JSON Schemas, complete
  signatures, effects, bounds, reducer laws, and available policy.
- Pure, replay, and caller-supplied mock effect execution with runtime budget,
  output-schema, cardinality, and recursion-progress enforcement.
- Request-bound replay identities and verified recording output digests.
- A typed in-memory run trace containing digests rather than unbounded values.
- Node 24 and Cloudflare Workers compatibility builds using public package
  exports.
- A provider-neutral generate/compile/two-repair pipeline with canonical attempt
  records, recorded-model fixtures, and resumable hidden-case semantic scoring.
- Deterministic typed validation of missing-operation, denied-capability, and
  insufficient-budget witnesses before an `unplannable` result is credited.
- Central model-output parsing, digest-bound experiment manifests, enforced
  inference caps, and paired held-out research gates with confidence intervals.
- A Node-only Vercel AI SDK 7 adapter package whose primary comparison is direct
  OpenAI Responses and Anthropic Messages, with optional Anthropic-through-
  Bedrock support, frozen pricing, and worst-case spend reservation.
- A phase-aware Node experiment controller with shared campaign budgets,
  zero-network dry-run, append-only ledger accounting, safe resume, and offline
  reporting.
- A Worker-compatible restricted capability-TypeScript compiler/interpreter that
  never evaluates model source, exposes only registered capability calls, and
  records matched static and runtime resource measurements.
- A disjoint paired M2 corpus and independent campaign controller for functional
  IR versus restricted capability TypeScript, including frozen counterbalanced
  schedules, paired statistics, content-addressed resume, and shared
  conservative accounting.
- A bounded substrate-neutral evidence-selection contract with four factorial
  text/graph arms, bitemporal facts and cited relationships, evidence-path and
  citation ground truth, negative controls, and a counts-only M3a.1 audit.
- Offline M3b matched execution infrastructure with one shared compiled plan,
  arm-blinded oracle requests, digest-bound Williams scheduling, symmetric
  transport retries, safe resume, and contrast-specific paired statistics.
- M3b.3 live-binding infrastructure with typed executable answer obligations,
  canonical path references, staged diagnostics, direct Responses/Messages
  transports, conservative attempt-level accounting, an append-only ledger, and
  durable content-addressed resume.
- An offline M4 evidence compiler with a content-addressed provider/task policy,
  arm-blinded selected contexts, graph-facts controls, and deterministic
  provenance reconstruction from answer values plus supporting fact IDs.
- A cohesive lexical-default production evidence runtime with typed
  answer/citation/provenance results, bounded injected oracle effects,
  content-addressed record/replay, and optional TypeGraph storage.
- Forty-two content-addressed benchmark cases spanning four unrelated catalogs,
  including bounded recursion and intentionally impossible policies.
- An experimental offline M6 compositional harness that normalizes successful
  plans, calcifies validated typed strategy templates, fails closed on semantic
  or authority drift, eliminates an injected planner on stable hits, and groups
  sanitized trace identities without provider access. Trusted versioned catalog
  roles and a finite application-supplied conformance runner reject
  cross-catalog semantic drift.

Deterministic orchestration is not semantic determinism. Exact replay comes from
recorded effect results bound to plan, catalog, operation, invocation, effect,
and input identities, plus injected time and run identifiers.

## Public-alpha quickstart

The supported product API is `@nicia-ai/lachesis-runtime`:

```ts
import {
  compilePlan,
  createRecordingOracleInterpreter,
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
  recordingStore,
  signal,
});
```

See the [public-alpha guide](docs/public-alpha.md) for the complete tutorial,
package selection, API reference, trust boundaries, record/replay semantics,
TypeGraph integration, compatibility, security guidance, and alpha policy. Every
example under [`examples/m5-alpha`](examples/m5-alpha) runs offline.

## Kernel CLI example

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build

node apps/cli/dist/cli.js validate fixtures/plans/document-claims.valid.json
node apps/cli/dist/cli.js analyze fixtures/plans/document-claims.valid.json --json
node apps/cli/dist/cli.js canonicalize fixtures/plans/document-claims.valid.json
node apps/cli/dist/cli.js run fixtures/plans/document-claims.valid.json \
  --inputs fixtures/inputs/document-claims.json \
  --replay fixtures/effects/document-claims.replay.json \
  --json
```

The example maps a recorded claim-extraction effect over a collection whose
maximum cardinality is three, folds claims with a property-tested canonical
union reducer, and performs one recorded synthesis effect. Analysis proves a
maximum of four calls before execution. The supplied two-fragment run consumes
three.

Invalid examples demonstrate capability denial, branch mismatch, unbounded
mapped effects, and non-decreasing recursion under `fixtures/plans`.

## Workspace

- `packages/kernel` — portable public package `@nicia-ai/lachesis`.
- `packages/runtime` — supported public-alpha facade
  `@nicia-ai/lachesis-runtime`, with a separate Node-only subpath.
- `packages/generator` — provider-neutral package
  `@nicia-ai/lachesis-generator`; no live provider SDKs.
- `packages/generator-ai-sdk` — Node-only live-provider adapter package; kept
  outside the kernel and portable generator.
- `packages/evidence` — portable substrate-neutral evidence contracts and
  offline research substrates; explicitly experimental and without a TypeGraph
  dependency.
- `packages/evidence-typegraph` — optional public TypeGraph 0.38 adapter; its
  managed SQLite subpath is Node-only.
- `apps/benchmark` — private Node-only M1b/M1c/M2 campaign controller and CLI.
- `apps/cli` — private workspace CLI used by repository fixtures.
- `fixtures` — valid/invalid plans, inputs, and effect recordings.
- `compat` — built-package Node and Workers consumers.
- `docs` — architecture and material ADRs.

See [the architecture](docs/architecture.md) for the kernel guarantees, the
[benchmark protocol](docs/generator-benchmark.md) for generation and scoring
boundaries, the [M1b runbook](docs/m1b-runbook.md) for the frozen M1 study, and
the [M2 representation ablation](docs/m2-codemode-baseline.md) for its completed
comparison boundary, and the
[M3a.1 evidence design](docs/m3a-graph-native-decomposition.md) for the offline
four-arm substrate benchmark and M3b kill gates, and the
[M3b offline protocol](docs/m3b-offline-execution.md) for the unexecuted matched
study substrate, [M3b.1 live binding](docs/m3b1-live-binding.md) for the frozen
failed probe, the [M3b.2 correction](docs/m3b2-protocol-correction.md), and the
[M3b.3 semantic-obligation correction](docs/m3b3-semantic-obligations.md) for
the frozen calibration failure,
[M3b.4 structured-output forensics](docs/m3b4-structured-output-forensics.md),
and the historical [M3b.5 held-out freeze](docs/m3b5-heldout-preparation.md).
M3b.5 and M3 are closed as `complete-formal-fail`; see the immutable
[M3 results](docs/m3-results.md) for the formal conclusions and claim boundary.
The offline [M4a/M4b evidence compiler](docs/m4a-evidence-compiler.md) treats
all M3 results as development evidence and creates no campaign or held-out
identity. The optional [M4c TypeGraph adapter](docs/m4c-typegraph-parity.md)
passes storage, temporal-replay, and provenance parity without changing any
model-visible evidence or making a model-quality claim. The offline
[M4d.0 policy viability audit](docs/m4d0-evidence-policy-viability.md) rejects
the existing coarse M4a policy and retains only a narrow development-derived
candidate for possible confirmation on a completely fresh corpus. The offline
[M4d.1 protocol and power design](docs/m4d1-offline-protocol-power-design.md)
implements the reduced oracle boundary and exact paired design, but stops before
corpus generation because the conservative powered sample is impractical. M4 is
closed as `complete-mixed`, and M4d.1 is `complete-design-no-go`; see the
immutable [M4 results](docs/m4-results.md). M5 is closed as
`complete-operational-pass`; see the immutable [M5 results](docs/m5-results.md).
M5c prepares the offline public alpha without publishing a package or
authorizing another provider call.

M6a–M6d adds an entirely offline experimental strategy-template and catalog
conformance surface to `@nicia-ai/lachesis-generator`; it does not widen the
supported runtime facade, train a model, dispatch a provider, or claim learned
cross-domain generalization. Its paired discovery-versus-template study design
is a no-go because the distribution-free requirement exceeds the practical case
ceiling and empirical power and maximum cost remain unknown. See the
[compositional harness design](docs/m6a-compositional-harness.md) and immutable
[M6 results](docs/m6-results.md). M6 is closed as `closed-offline-design-no-go`.

## Validation

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm test:coverage
pnpm build
pnpm smoke
git diff --check
```

## Roadmap

The project still excludes conventional or bounded-general CodeMode,
model-facing graph-native traversal, joins, `boundedExplore`, optimizer
rewrites, durable/distributed scheduling, general adaptive loops, package
publication, and deployment. M3b.1 is closed as a protocol failure; its
calibration and held-out identities were never executed. M3b.2 is frozen as a
semantic-gate failure. M3b.3 passed its probe and is frozen as an immutable
calibration failure; held-out was not authorized. M3b.4's stress probe and
calibration are complete and immutable; calibration achieved 236/240
first-attempt success and 240/240 final reliability. M3b.5 subsequently
completed all 2,560 held-out records. Its negative-control and safety gates
passed, but every universal structural superiority conclusion failed under the
frozen provider-by-repetition rule. M3 is complete and may not be rerun or
reinterpreted under relaxed gates.

M4a/M4b and the optional M4c TypeGraph storage adapter provide an offline
deterministic evidence-runtime substrate. The original M4 adaptive policy is
development-rejected; its narrow exploratory replacement remains research-only
and unconfirmed because the frozen powered design exceeded the practicality
ceiling. Lexical evidence remains the production default. The
[M5 roadmap](docs/roadmap.md) focuses on a cohesive production evidence runtime,
natural-workload reliability, provenance completeness, replay, budgets, and
developer experience—not graph superiority. The offline
[M5a vertical slice](docs/m5a-evidence-runtime.md) now composes the portable
lexical-default runtime, deterministic provenance, and exact record/replay with
optional TypeGraph storage. M5b.1 closed as `complete-operational-pass`: its
replacement probe and 24-record production pilot passed, while the original
M5b.0 integrity-failed probe remains immutable report-only history. See
[the M5b design](docs/m5b0-production-pilot.md) and
[M5 results](docs/m5-results.md).

M2 is complete and closed as a valid formal failure. Its historical M2.2
protocol failure was corrected before the completed M2.3 probe, calibration, and
frozen held-out study. See the immutable [M2 results](docs/m2-results.md) for
the preregistered conclusion, descriptive operational findings, and claim
boundary. No M2 phase may be rerun or reinterpreted under changed gates.

Licensed under [Apache License 2.0](LICENSE).
