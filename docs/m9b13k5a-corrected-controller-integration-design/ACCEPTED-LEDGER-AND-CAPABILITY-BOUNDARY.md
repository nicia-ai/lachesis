# Accepted ledger and capability boundary

The controller never computes or predicts a native ledger root. The future
native adapter must return a complete accepted receipt from the accepted
M9b.13k.4c implementation. The pure harness verifies and opaquely authenticates
that receipt; it does not label a controller digest as a native root.

The accepted receipt contract binds:

- session, activation, and run identities;
- namespace and store identities;
- log device and inode;
- helper identity and production/conformance variant;
- initial, previous, and resulting native roots;
- native sequence;
- canonical payload digest;
- receipt digest.

The controller event payload is distinct from both the native receipt and the
authenticated retained receipt. Canonical event payloads are checked against the
accepted 65,536-byte native payload ceiling. Stale sequence/root receipts,
mutated receipt digests, cloned JSON, cross-run/session data, reset deadlines,
and mismatched store/helper lineage reject.

The opaque one-use dispatch permit binds activation, run, operation, page,
request, reservation, accepted root, accepted sequence, accepted receipt digest,
and permit identity. Durable permit consumption precedes the first possible
enqueue. Issuance and consumption are deterministic one-shot actions.
