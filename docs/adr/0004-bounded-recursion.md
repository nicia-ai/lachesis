# ADR 0004: Bounded recursion only

## Decision

There is no general `fix`. `boundedFix` takes a seed, a registered same-schema
step, a registered nonnegative integer measure, and a positive iteration
maximum. Execution succeeds only at measure zero, rejects non-decreasing
progress immediately, and rejects exhaustion.

## Rationale

A fixed-point combinator does not prove termination. The combination of a
well-founded runtime measure and a hard static maximum gives both progress
evidence and a resource ceiling without admitting hidden graph back-edges.
