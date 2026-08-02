# M9b.12f threat model

The trusted computing base remains the controller implementation, controller
host operating system, privileged controller operator, private authority-storage
domain, and authenticated principal/channel adapter.

M9b.12f protects local process crash/restart, concurrent controllers,
interrupted writes, malformed state, partial replacement, unilateral database or
anchor rollback, sidecar/type/permission drift, stale admissions, and study role
access.

The local consistency/recovery anchor is not independently monotonic. It is not
an independent monotonic witness and is not described as rollback-resistant.
M9b.12f has no such witness and makes no such claim. Coordinated restoration of
matching older SQLite and anchor bytes by the privileged operator is outside the
detection boundary.

Any detected or suspected out-of-protocol operator restore halts the campaign
and requires a new execution identity with no normal resume.
