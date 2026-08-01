# M9b.12d durable authority

The private Node adapter implements
`lachesis-m9b12d-durable-quarantine-authority/1` with one SQLite authority-state
row and a separately persisted trusted anchor. Neither implementation nor its
types are exported from the package facade.

## Store lifecycle

`createNewM9b12dAuthority` exclusively creates both private parent directories,
the database, the store identity, and the anchor identity. It rejects any
pre-existing target. `openExistingM9b12dAuthority` accepts only the exact
controller-held trusted binding and never creates or repairs state.

Parents must be owner-controlled mode `0700`. Database, SQLite sidecars, and
anchor must be owner-controlled regular files at mode `0600`. Paths must be
absolute and normalized. Symlinks, non-regular files, wrong ownership, exposed
modes, missing files, and unexpected sidecars fail closed before use.

## Transactions and integrity

Each mutation begins SQLite `BEGIN IMMEDIATE`, reloads and validates the
database and anchor, then compares the previous revision and canonical state
digest in the update predicate. Every event binds its sequence, predecessor
head, complete typed body, and event digest. The committed state binds the exact
M9b.12d preregistration digest and random store identity.

After the database commit, a private temporary anchor is fsynced, renamed over
the prior anchor, and its parent directory is fsynced. The anchor records the
store identity, anchor identity, protocol, preregistration digest, revision,
head, and canonical state digest. A crash or persistence failure between the
database and anchor updates creates a mismatch and therefore a fail-closed
store; it cannot silently roll back to clean authority.

Full validation rejects missing, reordered, duplicated, altered, truncated,
forked, or unsupported event state. The separate trusted anchor additionally
rejects valid-looking rollback, database replacement, anchor replacement, and
wrong-store binding.

## Cross-process claim

The durability claim is process scoped, not global-human-identity scoped. A
genuine child-process test creates and quarantines in Process A, lets it exit,
then opens in Process B using only persisted store files and the trusted
binding. A new handle, role, session, and inventory for the same normalized
study principal still returns exactly `observer-previously-quarantined` and
performs no intercepted effect. Re-creating an empty store at the existing
location is rejected.
