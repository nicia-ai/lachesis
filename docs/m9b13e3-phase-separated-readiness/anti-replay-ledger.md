# Phase-separated synthetic anti-replay ledger

The synthetic ledger performs compare-and-swap over exact revision and root for
every event. Its state machine permits one session reservation, one pre-effect
admission, one active-monitoring commit, and one terminal completed, stopped, or
quarantined commit. Terminal sessions cannot reopen. Stale events, second
admissions, skipped phases, and mismatched roots reject without changing state.

Ambiguous-after-write faults are treated as possibly persisted. A retry uses a
stale revision/root and rejects, so no dispatch is repeated. This is an
in-memory hostile-test provider only, not a durable or live ledger claim.
