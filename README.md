# Lachesis

Lachesis is a typed functional compiler/runtime for measured agent programs.
Models may propose an immutable JSON plan, but they cannot add source code,
callbacks, hidden loops, or undeclared effects. The kernel parses, resolves,
type-checks, bounds, content-addresses, and executes the plan through explicit
effect interpreters.

This repository contains the first production vertical slice: the **Measured
Plan Kernel**.

## What works

- Strict Zod validation for an untrusted, versioned graph wire format.
- Duplicate-ID, dangling-reference, missing-root, and cycle detection.
- A versioned nominal schema and operation catalog with safe erased runtime
  boundaries.
- All initial operators: `input`, `constant`, `invoke`, `map`, `filter`, `fold`,
  `select`, `effect`, `checkpoint`, and `boundedFix`.
- Complete schema inference, effect/capability inference, conservative resource
  maxima, and budget rejection.
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
- `apps/cli` — Node-only public package `@nicia-ai/lachesis-cli` and `lachesis`
  binary.
- `fixtures` — valid/invalid plans, inputs, and effect recordings.
- `compat` — built-package Node and Workers consumers.
- `docs` — architecture and material ADRs.

See [the architecture](docs/architecture.md) for the trust boundaries and
guarantees.

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

The milestone intentionally excludes live model/provider handlers, TypeGraph,
SQL/Drizzle, knowledge-graph persistence, graph-native traversal, joins,
`boundedExplore`, optimizer rewrites, durable/distributed scheduling, general
adaptive loops, package publication, and deployment. The next research milestone
is provider-neutral plan-generation reliability and bounded repair, not a
TypeGraph integration.

Licensed under [Apache License 2.0](LICENSE).
