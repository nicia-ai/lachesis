# M9b.12d offline preregistration package

Package: `lachesis-m9b12d-offline-preregistration-package@1.0.0`.

Quarantine: `lachesis-m9b12d-retired-corpus-quarantine@1.0.0`.

Durable authority: `lachesis-m9b12d-durable-quarantine-authority/1`.

Trusted identity: `lachesis-m9b12d-trusted-observer-identity/1`.

Atomic admission: `lachesis-m9b12d-atomic-role-effect-admission/1`.

Registration: `lachesis-m9b12d-append-only-external-registration/1`.

Status: offline immutable superseding draft, not externally registered.

Canonical preregistration digest:
`ed991e11ccc6c9129bdb6509dd011b28006b4420d59bf4290d2dac11765ccef0`.

## Narrow correction

M9b.12d changes only the three blockers in the final M9b.12c independent review:
cross-process durable quarantine, trusted observer identity, and atomic
startup/effect admission. It preserves the complete scientific, financial,
operational, security, and authority boundaries inherited from M9b.12c.

The controller stores canonical event state in a private SQLite database and a
separate controller-held trusted anchor. The anchor binds protocol,
preregistration, store identity, revision, history head, and canonical state
digest. Existing-state open cannot initialize an empty store.

Assessment input carries only an opaque authority-issued launch handle and its
bound role/session identifiers. The controller derives the stable observer key
from its trusted study-principal domain. The caller cannot supply a commitment,
alias, principal, or canonical key.

Admission and the intercepted role-startup invocation form one controller-owned
operation. Its linearization point is the durable `admission-effect-started`
append. The operation returns only a terminal durable receipt; it never exposes
reusable permission. Provider effects remain forbidden and any later provider
boundary remains subject to `lachesis-m9b4-offline-effect-ledger@1.2.0`.

## Effects and authority

No corpus, retired material, schedule instance, gold, credential, provider,
registry, network, or push effect exists. No external registration, corpus
materialization, provider access, count, inference, probe, primary, publication,
release, or push authority is granted.
