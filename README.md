# Lachesis

Lachesis is a typed functional compiler/runtime for measured agent programs.
Models may propose an immutable JSON plan, but they cannot add source code,
callbacks, hidden loops, or undeclared effects. The kernel parses, resolves,
type-checks, bounds, content-addresses, and executes the plan through explicit
effect interpreters.

This repository contains the measured plan kernel, deterministic generation
benchmark substrate, the frozen M1b/M1c experiment controllers, the completed M2
functional-JSON-IR versus restricted-capability-TypeScript representation
ablation, and the completed M3 factorial evidence-substrate study.

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
- Forty-two content-addressed benchmark cases spanning four unrelated catalogs,
  including bounded recursion and intentionally impossible policies.

Deterministic orchestration is not semantic determinism. Exact replay comes from
recorded effect results bound to plan, catalog, operation, invocation, effect,
and input identities, plus injected time and run identifiers.

## Try the example

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
- `packages/generator` — provider-neutral package
  `@nicia-ai/lachesis-generator`; no live provider SDKs.
- `packages/generator-ai-sdk` — Node-only live-provider adapter package; kept
  outside the kernel and portable generator.
- `packages/evidence` — portable substrate-neutral evidence contracts and the
  offline M3a.1 factorial text/reference-graph implementations; no TypeGraph
  dependency.
- `apps/benchmark` — private Node-only M1b/M1c/M2 campaign controller and CLI.
- `apps/cli` — Node-only public package `@nicia-ai/lachesis-cli` and `lachesis`
  binary.
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

## Not yet implemented

The project still excludes conventional or bounded-general CodeMode, TypeGraph,
SQL/Drizzle, persistent knowledge-graph storage, model-facing graph-native
traversal, joins, `boundedExplore`, optimizer rewrites, durable/distributed
scheduling, general adaptive loops, package publication, and deployment. M3b.1
is closed as a protocol failure; its calibration and held-out identities were
never executed. M3b.2 is frozen as a semantic-gate failure. M3b.3 passed its
probe and is frozen as an immutable calibration failure; held-out was not
authorized. M3b.4's stress probe and calibration are complete and immutable;
calibration achieved 236/240 first-attempt success and 240/240 final
reliability. M3b.5 subsequently completed all 2,560 held-out records. Its
negative-control and safety gates passed, but every universal structural-
superiority conclusion failed under the frozen provider-by-repetition rule. M3
is complete and may not be rerun or reinterpreted under relaxed gates.

M4 is only a proposed provider-aware evidence-view compiler and confirmatory
benchmark. It has not been implemented, materialized, preregistered, or
authorized. TypeGraph remains absent from the evaluated model-quality claims.

M2 is complete and closed as a valid formal failure. Its historical M2.2
protocol failure was corrected before the completed M2.3 probe, calibration, and
frozen held-out study. See the immutable [M2 results](docs/m2-results.md) for
the preregistered conclusion, descriptive operational findings, and claim
boundary. No M2 phase may be rerun or reinterpreted under changed gates.

Licensed under [Apache License 2.0](LICENSE).
