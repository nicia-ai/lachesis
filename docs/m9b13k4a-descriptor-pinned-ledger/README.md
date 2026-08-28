# M9b.13k.4a corrected descriptor-pinned ledger

This append-only package preserves the failed M9b.13k.4 independent review and
corrects its six concrete defects. The correction is a local Darwin storage
feasibility milestone only. M9b remains NO-GO.

The implementation adds final snapshot/audit pathname authority checks, an exact
safe-ancestor policy, strict twelve-byte reserved-header validation, complete
helper-path admission, an operation-specific loopback-only sandbox, and
signal-driven EINTR retry conformance. The focused sandboxed suite passes 31/31
including 100 genuine two-process stale-root races.

The disposition is
`m9b13k4a-corrected-descriptor-ledger-ready-for-independent-review`. It
authorizes only another independent read-only review. It does not authorize
controller integration, activation preparation, credentials, OSF, publication,
provider calls, or push.
