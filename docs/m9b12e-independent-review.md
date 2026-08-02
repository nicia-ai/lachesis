# M9b.12e final independent review

Reviewed commit: `940efbdb78ff185552b3f846d977eaf98436ba42`.

Reviewed tree: `45ba2f5dd67cfd757be44b352654a09a0d593383`.

Decision: `m9b12e-independent-review-no-go`.

Disposition:
`superseded-unregistered-sidecar-and-transactional-proof-enforcement-incomplete`.

## Blocking findings

1. The authority does not enumerate or validate SQLite `-journal`, `-wal`, or
   `-shm` sidecars. Unexpected wrong-mode sidecars remain accepted despite the
   checksum-bound claim that sidecar and permission drift fail closed.
2. The authoritative M9b.12b proof assessment is computed before
   `BEGIN IMMEDIATE`. The transaction rechecks presenter, launch, and quarantine
   state but copies the precomputed proof-receipt digest into the admission
   event instead of assessing the exact captured proof bytes transactionally.

## Preserved results

The review independently reproduced the M9b.12e preregistration and manifest
digests, verified all predecessor bytes and checksums, exercised genuine
child-process reopen, ran the copied-handle serialization test, and confirmed
scientific and financial invariance. Those checks do not cure the sidecar and
transactional-proof defects.

No registration, corpus, credential, provider, network, push, publication, or
study-execution effect occurred.
