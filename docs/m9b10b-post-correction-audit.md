# M9b.10b post-correction audit

Decision: `post-correction-review-no-go`

This append-only offline audit is bound to commit
`16d36fc19d4fbb311394206beb2c64914690eb27` and tree
`6f048f0940a01916c1429208602744fc7e30e1de`. It does not modify or reinterpret
the M9b.10a or M9b.10b records.

## Findings

1. **P1 — The verified NO-GO capacity artifact remains bypassable.** The
   retained offline conformance lifecycle accepts count and inference transport
   callbacks and can invoke them after validating the frozen NO-GO capacity
   record.
2. **P1 — Terminal fragments are not cross-bound.** Independently valid
   authoring, execution, answer, and evaluation fragments can be substituted
   across pair, case, program, answer, and evaluator boundaries.
3. **P1 — Retrieval and pair replay confuse integrity with provenance.** A
   mutated second query or re-keyed pair can pass after its inner digests are
   recomputed because no independently trusted run or schedule root is checked.
4. **P1 — The selected moderate envelope is incomplete.** The selected receipt
   does not consume the authoritative M9b.10 profile and omits input, reasoning,
   and visible-output enforcement.
5. **P1 — The primary population remains caller-selected.** A balanced subset
   can be selected from a larger verified measurement pool because the analyzer
   does not consume an opaque frozen allocation token.

Exact sources, reproductions, preserved properties, required correction, and
nonclaims are recorded in the companion JSON.

## Preserved properties

The selected topology has one private paired-case orchestrator, two
inference-shaped attempts per successful arm, local closed-AST adaptive
retrieval, local one-shot retrieval, provider-free retrieval capabilities,
durable first-arm persistence, campaign-global compare-and-swap exclusion, and
exact integer McNemar arithmetic. Token-count pricing remains unresolved.

## Required correction

M9b.10c must make offline conformance structurally effect-free, cross-bind every
terminal fragment, verify replay against trusted retrieval and schedule roots,
consume the authoritative moderate envelope, and derive the complete primary
inventory from an opaque verified allocation token.

This audit grants no provider, live-execution, corpus-materialization,
preregistration, release, or pricing authority. It makes no model-quality,
retrieval-superiority, professional security-audit, penetration-test, or
compliance claim.

Independent SHA-256 checksums are stored in
`docs/m9b10b-post-correction-audit.sha256`.
