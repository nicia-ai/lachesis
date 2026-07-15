# Lachesis engineering rules

Lachesis compiles untrusted typed plans. Preserve these invariants in every
change.

## Architecture

- Agents may reference registered schemas and operations only. Never add source
  strings, callbacks, arbitrary lambdas, `eval`, or implicit effects to the wire
  format.
- Keep the plan graph, external knowledge/evidence graph, and run/provenance
  graph conceptually and structurally separate.
- `@nicia-ai/lachesis` is backend-neutral and must never depend on TypeGraph.
- The kernel supports Node 24 and Cloudflare Workers. It must not import
  `node:*`, use `Buffer`, `process`, Node streams/crypto, or Node ambient types.
- Expected domain failures return `Result`; throws are limited to programmer or
  outer CLI boundaries.
- General recursion does not exist. `boundedFix` requires a same-schema step, a
  nonnegative measure, a hard limit, and runtime proof of strict progress.
- Never fabricate analysis precision. Bounds are explicit `known` or `unknown`,
  and relevant unknown bounds reject execution.
- Reducer law declarations are claims. Keep property tests for every reducer
  whose laws permit ordering, parallelization, or deduplication.

## Type discipline

- Prefer `type`, `Readonly<{...}>`, `ReadonlyArray<T>`, `ReadonlyMap`, and
  `ReadonlySet`; mutation stays local and unobservable.
- Derive wire types from Zod. Do not hand-maintain mirror types.
- Use discriminated unions and exhaustive switches. Invalid operator states must
  remain structurally unrepresentable.
- Do not use `any`, double assertions, non-null assertions, suppression
  comments, broad unvalidated `unknown`, or casts that only silence TypeScript.
- Raw `JSON.parse` is confined to `packages/kernel/src/json.ts` and immediately
  narrows to `unknown` before Zod validation.
- No TypeScript `enum`, `Partial<T>` lifecycle models, unchecked index
  signatures, or implicit coercion between nominal schemas.
- Public functions have explicit return types. Imports used only as types use
  `import type`.

## Working agreement

- Node 24, pnpm 10, TypeScript 6, Zod 4, Vitest 4, ESLint 10, Prettier, and
  fast-check are the pinned baseline.
- Preserve strict compiler and type-aware lint settings. Do not relax a gate to
  accommodate a modeling problem.
- Add behavioral and property tests for every new acceptance and rejection path.
  Tests also forbid unsafe type escapes.
- Before handoff run formatting, strict type-checking, lint, tests with
  coverage, build, Node/Workers smoke consumers, CLI valid/invalid smokes,
  `git diff --check`, and the unsafe-escape audit documented in the root brief.
