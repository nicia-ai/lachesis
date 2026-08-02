# M9b.12f private SQLite sidecar policy

Protocol: `lachesis-m9b12f-private-sqlite-sidecar-policy/1`.

Recognized exact suffixes are `-journal`, `-wal`, and `-shm`. The inventory is
closed. A present sidecar is acceptable only while the controller owns an active
SQLite mutation and only when pathname, containment, ownership, regular-file
type, non-symlink status, parent privacy, and exact mode `0600` all validate.

Mode drift, symlinks, directories, FIFOs, unknown database-prefixed names,
normalized parent aliases, and residual clean-close sidecars fail closed. The
controller never changes process umask and never repairs a sidecar after
exposure.

Child-process tests create genuine SQLite rollback journals, WAL files, and SHM
files under umasks `0022`, `0000`, and `0077`. Because the authority database is
exclusively precreated at `0600`, SQLite derives all sidecars at `0600`; clean
closure removes them.
