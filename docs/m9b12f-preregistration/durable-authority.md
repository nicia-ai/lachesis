# M9b.12f durable authority and SQLite sidecars

The private Node adapter implements
`lachesis-m9b12f-durable-quarantine-authority/1`. It retains M9b.12e's SQLite
authority row and separately persisted local consistency/recovery anchor.

The database and anchor have exact mode `0600`; their immediate private parents
have exact mode `0700`. Existing opens never initialize or repair state. The
database parent must be its canonical real path, preventing normalized aliases
or containment escapes.

`lachesis-m9b12f-private-sqlite-sidecar-policy/1` freezes a closed sidecar
inventory: `<database>-journal`, `<database>-wal`, and `<database>-shm`. Unknown
database-prefixed sidecar-like names fail closed. Every present
active-transaction sidecar must be an owner-controlled, non-symlink regular file
at exact mode `0600`. Existing opens and clean closures require all three
sidecars to be absent; residual files are rejected and never repaired.

Audits run before SQLite open, after open, inside each write transaction after
the database update, after database close, and after anchor persistence. No
admission, quarantine receipt, startup, or provider-capable effect is exposed
after an audit failure.

The local anchor detects unilateral database or anchor rollback and partial
replacement. Coordinated privileged restoration of an older matching database
and anchor remains explicitly outside scope. Suspected operator restore halts
the campaign and requires a new execution identity.
