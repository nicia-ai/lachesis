# Corpus construction, freshness, and deny-by-default quarantine

Protocol: `lachesis-m9b12b-retired-corpus-quarantine@1.0.0`.

Role startup is allowed only when the observer identity and exposure inventory
are complete and committed, noninterference is confirmed, every required
isolation channel has one affirmative isolation proof, every required ancestor
kind has one affirmative clean-lineage proof, and no rejection reason exists.
Malformed, missing, incomplete, ambiguous, unknown, unsupported, duplicate, or
contaminated input fails closed as `quarantine-reuse-forbidden`.

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
is permanently excluded from every role above. The exclusion list is derived
from this canonical role model and has no manual exception.

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
The control-plane bootstrap may receive only the minimum approved opaque public
counts and cannot receive retired paths, identifiers, content, ordering,
metadata, snippets, or structural mappings through any bootstrap input.

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

## Counts-only boundary

The only permitted opaque commitment contains exactly eight families, three
scales, 24 cells, 24 probe pairs, 168 primary pairs, and 192 total pairs. It
must be approved by the trusted boundary and cannot expose identity, ordering,
content, or mappings.

## Quarantine response

Every rejection produces a deterministic reason set, prohibits role startup,
provider dispatch, credential access, and reuse, quarantines the role/session
and all produced or derived inventory, excludes the observer from every
influence-bearing role, requires append-only incident provenance and an
independent assessment, and permits restart only with fresh role identity,
environment, seed, and corpus construction. Manual cleanup, selective reuse, or
a claim of harmless exposure never restores eligibility.

This milestone creates and accesses no corpus, retired material, case, gold,
schedule instance, seed, packet, credential, provider state, or registry state.
