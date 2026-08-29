# Failed M9b.13k.4a independent review

The independently reviewed M9b.13k.4a seal was commit
`1a5276ee017625ae75fbd5f5c25b502cd016f7fe`, tree
`fccd8857bdfdbcd78ee3af1ab26b89b2f27cfde9`, with implementation identity
`16ac5ed843aab33a3f68e26c91a2a0dabda1aac3993931e61b9e9e3c0291e908`.

The independent disposition was:

`m9b13k4a-corrected-descriptor-ledger-review-no-go`

The review independently confirmed the corrected native mechanics:

- descriptor/path pinning detected the externally lock-held pathname race;
- correctly encoded reserved-byte probes rejected every nonzero version-1
  reserved state;
- stale-root CAS, crash, framing, rollback, ancestor, and helper-path behavior
  passed;
- the checked sandbox returned immediate `EPERM` for numeric non-loopback IPv4,
  numeric non-loopback IPv6, and direct DNS UDP;
- independent native builds were byte-identical.

The review nevertheless found four blocking wrapper or evidence defects.

1. Barrier readiness listened only for readiness data. Early EOF, descriptor
   error, helper exit, or helper rejection could leave `ready` pending. The
   parent release descriptor remained open, delayed child-process closure, and
   converted a deterministic rejection into timeout ambiguity.
2. The reserved-byte hostile test wrote the recomputed header CRC with
   `writeUInt32LE`, although the wire format is big-endian. Generic rejection
   therefore did not prove reserved-byte rejection.
3. The native conformance hook raised a signal, returned from its handler,
   manually assigned `errno = EINTR`, and skipped the syscall. This was
   synthetic fault injection, not genuine signal interruption, despite the test
   and evidence terminology.
4. The sealed pathname test replaced the log after a pre-lock barrier. It did
   not preserve the exact former-defect ordering in which an external process
   holds the original log lock while snapshot or audit waits, the pathname is
   replaced, and the original lock is then released.

The review required correction of all four findings before any later ledger
integration design milestone. It authorized no integration, activation,
credentials, OSF access, provider calls, publication, or push.
