# M9b.12e offline preregistration package

Package: `lachesis-m9b12e-offline-preregistration-package@1.0.0`.

Durable authority: `lachesis-m9b12e-durable-quarantine-authority/1`.

Authenticated identity: `lachesis-m9b12e-authenticated-observer-identity/1`.

Atomic admission: `lachesis-m9b12e-atomic-role-effect-admission/1`.

Registration: `lachesis-m9b12e-append-only-external-registration/1`.

Status: offline immutable superseding draft, not externally registered.

Canonical preregistration digest:
`d973ce34b715cd5d9bcc4c33d42184980a97be9b4cae1aaea2825e5b99520f5c`.

## Narrow correction

M9b.12e addresses only the M9b.12d durability-claim, opaque-identity, and
presenter-authentication blockers. The local SQLite database and JSON
consistency/recovery anchor protect against crashes, partial transitions,
unilateral replacement, and ordinary concurrency inside the stated trusted
computing base. Coordinated privileged rollback of their complete domain is
explicitly excluded and requires an independent monotonic witness not present
here.

Controller-issued principal and allocation IDs use one strict 256-bit lowercase
hex encoding. Display labels have no identity authority. A private runtime
presenter context binds the exact principal and store outside request JSON;
launch handles are identifiers only. Atomic admission repeats presenter and
quarantine resolution inside the start-event transaction before any intercepted
role effect.

The scientific, financial, operational, and study-authority boundaries inherited
through M9b.12d remain unchanged. No external registration, corpus, credential,
provider, count, inference, publication, release, or push authority is granted.
