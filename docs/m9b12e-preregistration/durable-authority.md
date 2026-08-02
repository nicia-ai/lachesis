# M9b.12e durable authority

The private Node adapter implements
`lachesis-m9b12e-durable-quarantine-authority/1` with one SQLite authority-state
row and a separately persisted consistency/recovery anchor. Neither the adapter
nor its types are exported from the package facade.

`createNewM9b12eAuthority` exclusively creates private parent directories, the
database, store identity, and anchor identity. `openExistingM9b12eAuthority`
never creates or repairs state. Parents are owner-controlled mode `0700`;
database, SQLite sidecars, and anchor are owner-controlled regular files at
`0600`. Missing files, unexpected sidecars, symlinks, wrong ownership, type
changes, and permission drift fail closed.

Each mutation begins SQLite `BEGIN IMMEDIATE`, validates the database and
anchor, and performs a revision/state-digest compare-and-swap. The database
commit is followed by a fsynced temporary anchor, atomic rename, and directory
fsync. A crash between the two updates leaves a mismatch and a fail-closed
store. Full validation rejects malformed, truncated, reordered, duplicated,
altered, forked, or unsupported event history.

The anchor detects unilateral database or anchor rollback and partial
replacement. Because both artifacts remain in the same privileged local storage
domain, coordinated restoration of an older matching pair is explicitly outside
the detection claim. Suspected privileged restore halts the campaign and
requires a new execution identity.

A genuine child-process test creates and quarantines in Process A, lets it exit,
then authenticates and opens in Process B using persisted files only. The same
exact opaque principal receives `observer-previously-quarantined`; empty-store
recreation is rejected.
