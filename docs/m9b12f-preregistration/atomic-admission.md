# M9b.12f transactional proof assessment and admission

Protocol: `lachesis-m9b12f-atomic-role-effect-admission/1`.

The untrusted request is first required to be strict canonical JSON. The exact
assessment subtree is captured once as canonical bytes before any await can
re-read caller state. Hidden properties, symbols, accessors, aliases, cycles,
non-JSON values, and unsupported fields reject.

The authoritative sequence is:

1. `BEGIN IMMEDIATE` and reload the validated durable state.
2. Revalidate authenticated presenter context and resolve the exact opaque
   principal and launch.
3. Recheck durable quarantine history.
4. Parse the captured assessment bytes inside the transaction.
5. Execute the complete M9b.12b retired-material boundary assessment.
6. Append either quarantine or `admission-effect-started` in that transaction.
7. Commit, persist the anchor, audit clean closure, and only then expose the
   durable receipt or invoke the intercepted startup effect.

The event stores the canonical assessment bytes, their digest, the complete
transaction-generated proof receipt, and its digest. Reopen re-parses the bytes,
rederives both digests and the proof decision, and rejects any mismatch.

No precomputed proof decision controls admission. No reusable permission is
returned. Provider dispatch remains forbidden and separately requires
`lachesis-m9b4-offline-effect-ledger@1.2.0`.
