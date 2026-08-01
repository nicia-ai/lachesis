# Authoritative append-only quarantine history

Protocol: `lachesis-m9b12c-append-only-quarantine-history/1`.

The authority owns the current history, revision, and head. Assessments receive
only an opaque repository capability and cannot include a history field. A
serialized candidate is accepted on reload only after complete chain validation
and exact equality with the authority-owned revision, head, and canonical value.

Each record binds the protocol, monotonic sequence, predecessor head, observer
commitment, requested and affected roles, affected sessions, affected derived
inventory, incident receipt, sorted exact reasons, terminal decision, reuse,
startup and provider prohibitions, and its canonical digest.

Append is compare-and-swap against the exact authority-state revision. A
terminal quarantine receipt is created only after its record commits. A clean
receipt binds the exact head observed by its assessment. The controller must
revalidate that receipt immediately before startup or any provider-capable
effect. Head drift or later observer quarantine rejects authorization.

History is permanent and monotonic. Removal, override, expiration, replacement,
rehabilitation, manual cleanup, and clean reset do not exist.
