# M9b.12c threat model

The correction threats are omitted or caller-selected history; valid-looking
truncation or replacement; reordered, duplicated, forked, or altered records;
self-consistent foreign chains; quarantine races; stale clean receipts; and role
tests that inspect only one terminal field.

Controls are an opaque authority-owned repository; no history field in the
assessment request; complete chain validation on load and use; exact match to
the trusted revision, head, and canonical history; per-record predecessor and
digest binding; monotonic compare-and-swap append; append before terminal
quarantine receipt; exact head binding in every receipt; mandatory startup
revalidation; and complete terminal assertions for every canonical role.

Quarantine is permanent. A different role, session, inventory, controller, or
process cannot restore an observer. Removal, override, expiration, replacement,
rehabilitation, cleanup, and clean reset are absent. Unknown history, invalid
history, head drift, or an observer quarantine fails closed before startup or
provider-capable effects.

Nothing in this threat model grants live authority or claims a professional
audit, penetration test, or compliance assessment.
