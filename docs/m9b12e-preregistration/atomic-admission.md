# M9b.12e atomic role/effect admission

Protocol: `lachesis-m9b12e-atomic-role-effect-admission/1`.

The controller receives authenticated presenter context separately from the
untrusted request. Admission validates that runtime context, resolves the known
launch, and checks exact presenter principal, allocation, role, session, expiry,
quarantine, and current M9b.12b proofs. The presenter check and quarantine check
are repeated inside the same `BEGIN IMMEDIATE` mutation that consumes the launch
and admission identity and appends `admission-effect-started`.

The start-event commit is the linearization point. No caller-visible boolean or
reusable permission exists. Only after the durable start does the operation call
the intercepted role-startup effect. Its context always carries
`providerEffectsPermitted: false`; any separately authorized future provider
dispatch remains bound to `lachesis-m9b4-offline-effect-ledger@1.2.0`.

Quarantine-first and admission-first races record truthful order. Duplicate or
concurrent admissions produce one start and at most one effect. A pre-commit
failure consumes nothing. A database/anchor mismatch fails closed. A crash after
the durable start, before or after the intercepted effect, remains
conservatively ambiguous and non-redispatchable after restart.
