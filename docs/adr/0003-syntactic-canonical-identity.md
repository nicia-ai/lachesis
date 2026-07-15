# ADR 0003: Syntactic canonical identity

## Decision

Canonicalization recursively sorts object keys by code-unit order, preserves
array order, emits no whitespace, and hashes the result with Web Crypto SHA-256.
The complete wire plan—including catalog, operation/schema versions, budgets,
capabilities, and semantic metadata—is hashed.

## Rationale

The first milestone needs stable content identity, not equivalence proofs or an
optimizer. Claiming semantic canonicalization would be stronger than the
implementation and unsafe for cache identity.
