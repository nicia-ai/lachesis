# M9b.12d correction threat model

The boundary assumes an uncompromised controller, operating-system account,
private trusted-binding custody, and local filesystem/SQLite semantics. It
handles untrusted assessment payloads and concurrent controller operations.

Covered threats include process restart, attempted empty-store recovery,
caller-selected identity, textual identity rotation, role/session/inventory
rotation, duplicate allocation issuance, unknown or expired handles, stale
validation, quarantine/admission races, duplicate admission, crash before and
after the linearization point, effect-boundary failure, event removal,
reordering, duplication, alteration, truncation, fork, database rollback,
database replacement, wrong anchors, malformed anchors, symlinks, exposed modes,
and unsupported protocol state.

Controls are strict schemas, stable controller-derived observer keys, opaque
launch handles, complete event-chain validation, SQLite immediate transactions,
revision/state-digest CAS, a separately persisted trusted anchor, exclusive
create versus fail-closed open, one-time start events, and conservative
ambiguous states.

Out of scope are global human identity, a compromised controller or OS account,
malicious storage with broken durability guarantees, remote distributed
consensus, provider dispatch, and external registration.
