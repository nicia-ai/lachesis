# Barrier lifecycle protocol

The M9b.13k.4b wrapper uses one invocation state shared by readiness, release,
child termination, timeout, and final completion.

- `ready` and `completed` each settle at most once.
- Readiness data accepts exactly `R`.
- Readiness EOF, readiness error, child error, exit, or close before readiness
  settles `ready` as an explicit failure.
- Every early terminal path closes the parent release descriptor.
- Release is accepted only once, only after readiness, and only before terminal
  completion. Repeated or late release is a no-op.
- Timeout settles pending readiness, closes release, sends `SIGKILL`, and waits
  for child closure before completing.
- A barrier timeout before release is non-ambiguous. An append termination after
  release remains ambiguous because durable mutation may have occurred.
- Lifecycle listeners are removed once at completion. Guard error listeners
  absorb late stream or child errors without changing settled results.

Genuine child-process regressions cover deterministic pre-readiness namespace
and malformed-operation rejection, EOF, injected descriptor and child errors,
timeout before and after readiness, death after readiness, death immediately
after append release, repeated release, and late events. The former 150 ms case
now returns the native namespace-admission rejection before the deadline rather
than `m9b13k4b-helper-timeout`.
