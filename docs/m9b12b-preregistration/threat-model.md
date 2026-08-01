# M9b.12b threat model

The primary correction threats are permissive role startup from incomplete
proofs, stale or conflicting registration contracts, omitted influence-bearing
roles, unmodeled isolation or lineage channels, and hostile tests whose second
trigger masks failure of the named trigger.

Controls are one canonical registration constructor; exact linear predecessor
bindings; a single canonical role model; exhaustive closed isolation and
ancestor schemas; explicit recording and quarantine of unsupported channels; one
affirmative proof for every required channel and ancestor; deterministic
rejection reasons; malformed-input quarantine receipts; isolated one-trigger
tests; complete reason-set combination tests; and canonical digest replay.

Unknown observer identity, exposure inventory, noninterference, isolation,
ancestry, derivation, or access classification always prevents role startup. No
denylist, permissions error, read-only mount, renaming, paraphrase, reorder,
copy, rehash, serialization change, reconstruction, manual cleanup, or claimed
noninterference can restore eligibility after contamination.

Residual uncertainty itself is a quarantine reason. Nothing in this threat model
grants live authority or claims a professional audit, penetration test, or
compliance assessment.
