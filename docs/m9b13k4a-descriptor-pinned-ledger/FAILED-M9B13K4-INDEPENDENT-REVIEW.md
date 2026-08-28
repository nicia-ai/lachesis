# Failed M9b.13k.4 independent review

M9b.13k.4 was independently reviewed at the exact seal:

- commit `31cf28e1621f9ea98186e62a2e795c6d5ba4416a`;
- tree `5ae43651c0a30a4f4ab9750efed8515b004dad7d`;
- implementation commit `7b74736b65a32589ba7aee234cb195bd8100de8b`;
- implementation tree `465a6ad37a08b5c6e82d158cb1a6b9467f600b61`;
- implementation identity
  `d52fadda1be127f610f838f12e7c361ad949d65e46c76e09e6e21e02ddca5ecf`;
- normalized helper SHA-256
  `39af7eecf5241261a54273241e420f223d05278e25e4e294b97cfd104467ba95`;
- checksum-manifest SHA-256
  `93ef5624a94e107dddd2e3c77af721adf8b733963df6e70c8fe8be4f2c306c65`.

The exact independent-review disposition was:

`m9b13k4-descriptor-pinned-ledger-review-no-go`

The review reproduced six defects:

1. `snapshot` and `audit` could return an orphaned retained log descriptor as
   successful after authoritative pathname replacement.
2. Effective-UID-owned group/world-writable ancestors were admitted.
3. Nonzero version-1 reserved header bytes were accepted when the CRC was
   recomputed.
4. The helper executable's complete path was not admitted.
5. The recorded localhost sandbox profile did not prove non-loopback denial.
6. Blocking native I/O did not retry `EINTR` correctly.

The original package and its predecessors remain historical evidence and are not
rewritten by M9b.13k.4a.
