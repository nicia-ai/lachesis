# M9b.13e.1 trusted-session readiness

Protocol: `lachesis-m9b13e1-trusted-controlled-host-session-readiness/1`.

A future receipt binds an opaque host and boot/session identity, architecture,
OS, kernel, every operational filesystem and device, clock source, wall and
monotonic timestamps, trusted-host policy, and exact readiness implementation.
It exposes no serial number, personal username, home path, or unnecessary
private identifier.

It binds the numeric real, effective, and saved UID; an opaque principal and
account/session identity; the exact group inventory; an unprivileged state; and
no identity drift. One controller root may launch only frozen helper, scanner,
and verifier children with exact source/build/executable, argument, environment,
descriptor, count, order, and exit identities. Any pre-existing process not in
that exact allowlist makes the session unclean.

The frozen census source and methods cover enumeration, executable identity,
parent/child reconstruction, and short-lived processes. Evidence is required
before admission, before every consequential boundary, after every
helper/scanner completion, before sealing, and at terminal close. Stale or
missing evidence rejects. If continuous observation is required but cannot be
proven on Darwin without new privileges or dependencies, the result is
`trusted-session-no-effect-stop`; snapshot validation is not represented as
continuous coverage.

The legal state machine is `uninitialized`, `preflight`, `admitted-clean`,
`acquisition-active`, `verification-active`, `sealed`, `quarantined`, and
`closed`. Every transition commits its event, times, and evidence digest.
Interruption, crash, timeout, census failure, unexpected process, identity
drift, or missing evidence quarantines and closes the session. Restart and
silent reuse are forbidden; a fresh session must be separately admitted.

Before any network or durable acquisition effect, the only admitting decision is
`trusted-session-admitted`. Every other result is
`trusted-session-no-effect-stop`. Invariant loss after admission cancels work
where possible, permits no new request, writes no accepted seal, quarantines
partial state, performs no retry, retains ambiguity and effect accounting, and
requires a fresh separately admitted session.

The study does not establish security against compromise of the trusted local
host, acquisition account, controller, kernel, administrator, hypervisor, or
pre-start local code, tool, and runtime installation.

Ordinary operator error, accidental controller or helper races, malformed or
adversarial external bytes, artifact substitution, partial persistence,
retired-corpus exposure, contamination, and failure to establish or retain the
trusted-session readiness invariant remain in scope and fail closed.
