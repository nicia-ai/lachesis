# Structural validation and authority-bearing admission

`lachesis-m9b13e2-structural-readiness-receipt-validation/1` checks strict
schemas, canonical digests, session cross-references, state chains, census
inventories, topology, and ledger-event structure. Its only successful result is
`structurally-valid-nonauthoritative`; it returns no receipt and grants no
admission authority.

`lachesis-m9b13e2-authority-bound-session-admission/1` is the only operation
that may prospectively return `trusted-session-admitted`. Its trusted context is
closure-bound and is never accepted as ordinary JSON beside a submitted
candidate.

No live trusted context exists. The live entry point ignores caller-selected
identities and returns exactly `trusted-session-no-effect-stop` with reason
`positive-readiness-authority-unavailable` and zero effects. The only positive
test path is explicitly synthetic and cannot activate the live entry point.
