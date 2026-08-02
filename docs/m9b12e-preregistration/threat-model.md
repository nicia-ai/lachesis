# M9b.12e correction threat model

The trusted computing base is exactly the controller implementation, controller
host operating system, controller privileged operator, private authority-storage
domain, and authenticated principal/channel adapter. Study roles, model outputs,
corpus content, ordinary request callers, and role containers are untrusted.

The local authority protects against process crashes and restart, interrupted
writes, concurrent controllers, partial database or anchor replacement,
malformed/truncated/forked/inconsistent state, study-role access, symlinks,
permission drift, stale heads, stale admissions, and accidental unilateral
rollback.

The consistency/recovery anchor is a separately persisted local JSON artifact.
It detects a database-only or anchor-only rollback because the remaining side
retains the later revision and state digest. It is not an independent monotonic
witness and is not described as rollback-resistant.

The security claim explicitly excludes a malicious or compromised privileged
host or operator, coordinated rollback or replacement of the complete local
authority domain, rollback of both SQLite and its matching anchor by that
privileged actor, and kernel, hypervisor, or hardware compromise. Resistance to
coordinated privileged rollback requires an independently controlled monotonic
witness; M9b.12e has no such witness and makes no such claim.

Any detected or suspected operator restore or recovery outside the defined
protocol halts the campaign and requires a new execution identity. It is never a
normal resume operation.
