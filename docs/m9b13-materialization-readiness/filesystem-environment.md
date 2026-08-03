# Filesystem and role environment design

Sixteen physically separate future roots cover acquisition, normalization,
construction, materialization, author/answer/evaluator packets, hidden gold,
secrets, authority, effects, replay, analysis, quarantine, and public audit
records. This milestone creates none of them.

Every directory is owner-only `0700`; every file is an owner-only `0600` regular
file. Symlinks, hard-link aliases, special files, mount crossing, and permission
or ownership drift fail closed. Atomic writes use same-filesystem temporary
files, fsync, rename, and parent fsync. SQLite authority follows the registered
closed M9b.12f sidecar inventory and requires a sidecar-free clean closure.

Future role containers use nonroot principals, read-only root filesystems and
inputs, one writable output root, dropped capabilities, no-new-privileges,
seccomp, and no network except the separately authorized acquirer. Credentials,
parent/worktree/history, browser state, caches, temp, logs, shell history,
inherited environment, crash reports, and bootstrap inputs are excluded or
replaced by empty role-private stores.
