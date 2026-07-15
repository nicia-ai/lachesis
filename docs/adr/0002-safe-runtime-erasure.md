# ADR 0002: Safe runtime erasure in the catalog

## Decision

Typed registration builders close over Zod-backed input/output schemas and typed
implementations, then expose erased operations accepting and returning validated
`unknown`.

## Rationale

An arbitrary JSON plan is existentially typed at runtime. Pretending TypeScript
knows its output would require `any`, double assertions, or unchecked variance.
Keeping `unknown` at this single heterogeneous boundary makes the trust
transition explicit and preserves typed implementation code.
