# Durable authority integration

Future role admission composes the registered M9b.12f durable quarantine
authority, authenticated opaque identity, transactional one-time admission,
closed SQLite sidecar policy, and the M9b.4 effect ledger wherever effects can
later occur.

The controller authenticates the presenter separately from the request and
issues one opaque principal plus unique role/session allocation. Inside one
`BEGIN IMMEDIATE` transaction it reloads and validates state, resolves the
presenter, assesses captured canonical proof bytes, rechecks permanent
quarantine, and appends either quarantine or one-time effect-started admission.
Only after commit, trusted-anchor persistence, and clean sidecar closure may a
receipt or intercepted startup be exposed.

No role starts without all affirmative current proofs. Copied, unknown,
consumed, or stale handles fail; quarantined principals remain excluded; sidecar
drift fails; ambiguous starts are never readmitted. Materialization authority is
a separate domain from execution/count/inference/probe/primary and analysis
authority. No real authority store, principal, launch, or provider path is
created during readiness.
