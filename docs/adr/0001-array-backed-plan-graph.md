# ADR 0001: Array-backed wire graph

## Decision

Plans use a versioned node array plus a root ID on the wire. Normalization
rejects duplicate IDs, resolves references, detects raw graph cycles, and builds
an immutable map and topological order.

## Rationale

A JSON object keyed by node ID silently overwrites duplicates before the kernel
can diagnose them. A recursively nested tree duplicates shared subplans and
obscures graph identity. Raw back-edges are never recursion; recursion is only
the registered `boundedFix` operator.
