# Canonical event stream and census chronology

Every event is session-bound and carries a unique ID, contiguous integer
sequence, strictly increasing monotonic timestamp, wall timestamp, prior and
current event digests, and contiguous ledger revision and roots. References
resolve only to earlier events in the same stream and session.

Census meaning is derived from its discriminant and exact event adjacency. An
initial census follows entry into preflight. A pre-admission census follows the
readiness verification and immediately precedes admission. A before-boundary
census follows its reservation and immediately precedes dispatch. An
after-completion census immediately follows completion. A pre-seal census is the
final monitoring event, so the first terminal event must be seal. A terminal
census follows terminal close and cannot validate admission or an effect
boundary.

Inventory and topology digests are recomputed from complete process records,
including PID plus start identity and exact parent key/PID membership.
