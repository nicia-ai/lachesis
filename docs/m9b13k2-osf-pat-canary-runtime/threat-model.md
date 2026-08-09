# M9b.13k.2 threat model

## Protected assets

The protected assets are future credential bytes, activation authority,
request/effect budgets, the exact uploaded object identity, durable campaign
history, and the independent revocation result. M9b.13k.2 has no real credential
or activation authority.

## Adversaries and failures

- A direct or mis-launched child may inherit an unrelated FD3. The child
  requires a separately committed FD4 proof before examining FD3 and otherwise
  leaves FD3 open and unread.
- A caller may try to inject a transport, namespace, activation JSON, signed
  URL, or alternate object identity. Opaque handles, module-private factories,
  exact URL policy, checksum bindings, and strict schemas reject those paths.
- A process may crash before reservation, after SQLite commit, before anchor
  advancement, during dispatch, or after cancellation. `BEGIN IMMEDIATE`,
  revision/root CAS, synchronous SQLite commits, directory/file sync, a
  separately persisted anchor, and conservative ambiguity retain the failure.
- A response may redirect, stall, stream beyond its bound, disconnect, fail TLS,
  finish late, or race another request. The controller and request timers
  destroy the request, concurrency is one, retries are zero, and settled
  outcomes cannot mutate later.
- Waterbutler may return the same name for another object, encoded or normalized
  paths, a different host/provider, duplicate inventory entries, or a download
  URL for another object. Reconciliation binds one exact ID/path/host/provider
  from upload relation through downloaded digest.
- The revoked credential cannot prove its own absence. Only a distinct
  authority-bound custodian receipt can advance the durable terminal state.

## Residual boundary

The future account-control custodian, PAT ceremony, and checksum-bound
activation capsule do not exist in this milestone. The live runtime therefore
stops with zero effects. Independent review of the local construction cannot be
interpreted as activation authorization.
