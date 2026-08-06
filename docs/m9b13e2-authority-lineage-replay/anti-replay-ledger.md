# Provider-neutral anti-replay ledger

`lachesis-m9b13e2-provider-neutral-anti-replay-ledger/1` defines a private
provider-neutral store with atomic compare-and-swap over revision and root.
Canonical hash-chained events reserve a unique session commitment and record a
terminal admitted, stopped, or quarantined status.

Previously seen commitments, stale revisions or roots, conflicting reservations,
and attempts to reopen terminal sessions stop with zero effects. Ambiguous
persistence is conservatively treated as possibly written: the session never
admits or retries, and any surviving reservation makes reuse reject.

Only an in-memory synthetic provider is implemented for hostile offline tests.
There is no live namespace, trusted root, durable provider, or campaign ledger.
