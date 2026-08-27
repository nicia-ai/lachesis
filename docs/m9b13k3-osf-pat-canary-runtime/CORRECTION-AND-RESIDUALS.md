# Correction boundaries and residual blockers

## Corrected concrete paths

- **Authority and transport:** loopback and production transports have distinct
  types and closure-private registries. Synthetic construction accepts only a
  registered loopback object. A production-effect authority has no constructor,
  and the live entry is inert before capability creation.
- **Token binding:** the runtime owns the sole canonical 24-lowercase-hex token
  ID. Strict request intents contain no token field. Token-detail, revocation,
  receipts, and custodian verification derive it from the binding.
- **Artifact binding:** the 245-byte artifact, filename, length, identity, and
  SHA-256 are constants. Upload intent contains no body. Transport constructs an
  owned byte array, verifies it, sends it once, and clears the mutable
  temporary.
- **Custodian binding:** synthetic Ed25519 identity is derived from protocol,
  SPKI, fingerprint, and key material. The activation-shaped binding identifies
  synthetic mode. Cross-principal receipts reject. There is no live authority
  constructor and synthetic terminal language is structurally distinct.
- **Implementation identity:** canonical inventory entries bind kind, path, byte
  length, and SHA-256. Entries are sorted deterministically and duplicate
  kind/path pairs reject. The digest uses explicit 64-bit length framing.
- **Chronology:** construction and callback-registration faults remain
  pre-dispatch; once `write` or `end` begins, a failure remains after-dispatch
  ambiguous. Requests are destroyed and timers/listeners are cleared.
- **FD3:** FD4 is described only as synthetic frame-consistency evidence.
  Launcher identity is explicitly unauthenticated and reserved for future
  activation.

## Credential-copy limits

The caller's mutable synthetic credential buffer is cleared after the runtime
copies it. The runtime-owned mutable copy is cleared when the runtime closes.
The short-lived mutable authorization buffer and mutable artifact copies are
cleared in application code. This is not complete erasure: creation of the HTTP
authorization header necessarily creates an immutable JavaScript string, and
Node may copy it into `ClientRequest`, header storage, TLS buffers, or runtime
internals. Those copies cannot be synchronously zeroized and may survive until
request destruction and garbage collection. No credential is logged, serialized,
included in receipts, or propagated through error text. This is a live-execution
risk requiring activation review.

## Blocking residuals

1. **Path identity:** `node:sqlite` `DatabaseSync` accepts a pathname, not a
   verified open descriptor or `openat`-style directory-relative handle. A
   replacement can therefore occur after component audit but before SQLite's
   open. The required audit/open identity guarantee cannot be stated on the
   target Node/macOS runtime.
2. **Ledger and campaign continuity:** the complete transition grammar,
   activation-bound external anchor, namespace replacement detection, PUT and
   revocation ceilings, terminal separation, recovery validation, and serialized
   deadline admission are not wired into the M9b.13k.3 controller.
3. **Reconciliation:** the transport exposes opaque bounded response handles,
   but strict duplicate-key rejection and end-to-end stable-object derivation
   from provider, upload, inventory, download relation, URL, and bytes are not
   implemented.
4. **Concurrency proof:** the exact two-child frozen-root barrier CAS campaign,
   crash variants, and winner reopen validation are not implemented for this
   correction.
5. **Activation authentication:** FD3 framing is conformance-only; trusted
   launcher ownership and a live human custodian remain absent.
6. **Coverage:** the focused correction test passes, but explicit correction
   coverage is below repository release thresholds.

These are release blockers, not deferred readiness claims. No ledger is created
and no synthetic request path is represented as a durable campaign.
