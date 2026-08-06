# Phase-separated receipt contracts

The pre-effect receipt is the only receipt whose decision is
`trusted-session-admitted`. It contains exactly the transition path
`uninitialized → preflight → admitted-clean`, two authoritative censuses,
literal passing readiness verification, session reservation and admission commit
records, and zero pre-admission effects. It cannot contain active, verification,
seal, close, completion, post-effect, or terminal evidence.

The continuing monitoring lineage begins from the exact admission head. It
records entry into acquisition, an active-monitoring commit, exact ordered
boundary groups, entry into verification, and the immediately pre-seal census.
It grants neither admission nor effect authority. A synthetic boundary proof is
valid only when it supplies the already validated admission, the current active
monitoring commit, a directly following reservation, and the directly following
before-boundary census at the current ledger head.

The terminal receipt begins from the exact monitoring head. Successful closure
records seal, close, terminal census, and terminal completion. Failed closure
records invariant loss, stop, quarantine closure, terminal census, and a typed
terminal stopped or quarantined commit. It binds the original admission and
monitoring digests and is structurally incapable of acting as initial authority.
