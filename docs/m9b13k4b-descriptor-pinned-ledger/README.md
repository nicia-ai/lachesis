# M9b.13k.4b corrected descriptor-pinned ledger

M9b.13k.4b is the append-only correction to the failed M9b.13k.4a independent
review. It preserves M9b.13k.4 and M9b.13k.4a byte-for-byte.

The correction is limited to:

- a single-settlement barrier invocation lifecycle;
- correctly attributed big-endian reserved-byte regressions;
- explicit separation of production, synthetic conformance, and genuine
  asynchronous EINTR evidence;
- the exact externally lock-held snapshot and audit pathname race.

The private protocols advance to revision 3. Production and conformance helpers
have distinct normalized executable hashes and signing identifiers. The
production helper cannot enable synthetic failure injection.

The disposition is:

`m9b13k4b-corrected-descriptor-ledger-ready-for-independent-review`

This authorizes only a new independent adversarial read-only review. M9b remains
NO-GO. Nothing here authorizes controller integration, activation, credentials,
OSF access, provider calls, publication, or push.
