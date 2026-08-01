# Corpus construction, freshness, and durable deny-by-default quarantine

Quarantine protocol: `lachesis-m9b12c-retired-corpus-quarantine@1.0.0`.

History protocol: `lachesis-m9b12c-append-only-quarantine-history/1`.

Role startup is allowed only when the observer identity and exposure inventory
are complete and committed, noninterference is confirmed, every required
isolation channel has one affirmative isolation proof, every required ancestor
kind has one affirmative clean-lineage proof, no current rejection reason
exists, and the authoritative history confirms that the observer is clean at the
exact head bound into the receipt.

## Influence-bearing roles

- `constructor`
- `materializer`
- `study-operator`
- `author`
- `evaluator`
- `adjudicator`
- `analyst`
- `auditor`
- `campaign-controller`
- `runtime-controller`
- `control-plane-bootstrap`
- `credential-custodian`

Any observer of retired content, identifiers, ordering, metadata, or structure
is permanently excluded from every role above. The exclusion is recorded under
the observer commitment in authoritative append-only history and applies across
role, session, inventory, controller, and process changes.

## Required isolation channels

- `direct-mount`
- `parent-filesystem`
- `parent-workspace`
- `worktree`
- `repository-history`
- `archive`
- `backup-or-snapshot`
- `cache`
- `temporary-storage`
- `log`
- `shell-history`
- `environment-variable`
- `search-root`
- `bootstrap-input`
- `inherited-process-input`
- `external-or-object-storage`

Every channel requires one `isolated` proof before role startup. Omission,
duplication, `unknown`, `not-isolated`, or an unsupported channel quarantines.

## Contamination ancestor kinds

- `corpus`
- `case`
- `seed`
- `template`
- `family`
- `task`
- `source`
- `document`
- `entity`
- `answer`
- `supporting-fact`
- `constructor-output`
- `schedule`
- `randomization`
- `packet`
- `materialization`
- `evaluator-input`
- `analysis-input`

Any retired or uncertain ancestor contaminates every descendant. Renaming,
paraphrasing, reordering, copying, rehashing, changing serialization, or
reconstructing material cannot remove contamination.

## Forbidden access classes

- `mount`
- `open`
- `read`
- `list`
- `enumerate`
- `search`
- `hash`
- `compare`
- `copy`
- `inspect-metadata`
- `inspect-content`
- `traverse-namespace`
- `import`
- `reconstruct`
- `receive-identifier`
- `receive-filename`
- `receive-snippet`
- `receive-ordering`
- `receive-structural-mapping`
- `derive-study-material`

Any attempted forbidden access or unclassified access channel quarantines.

## Durable quarantine response

Every quarantine is appended before its terminal receipt. Each record binds its
sequence, predecessor head, observer, affected roles, session, derived
inventory, incident receipt, exact reasons, terminal prohibitions, and record
digest. The complete chain is validated on load and use, and serialized history
must match the authority-owned revision and head.

The caller cannot supply, omit, replace, truncate, or select assessment history.
There is no removal, override, expiration, replacement, rehabilitation, manual
cleanup, or clean reset. A clean receipt is usable only after revalidation
against the current authoritative head. Any intervening append or observer
quarantine fails closed before startup or provider-capable effects.

This milestone creates and accesses no corpus, retired material, case, gold,
schedule instance, seed, packet, credential, provider state, or registry state.
