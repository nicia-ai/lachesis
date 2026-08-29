# Exact externally lock-held pathname regression

Snapshot and audit each run the former-defect ordering five times:

1. create the ledger and retain its receipt;
2. have an external Python process open and exclusively `flock` the original
   `ledger.log`;
3. confirm the external lock holder is ready;
4. start the native inspection and release only its pre-lock coordination point;
5. prove completion remains pending while the external lock is held;
6. rename the authoritative log, copy it to a replacement inode, and verify the
   original and replacement inode numbers differ;
7. release the external lock;
8. require `m9b13k4b-helper-post-inspect-identity-ambiguous` and prohibit an
   ordinary success receipt.

The creation receipt identifies the retained original inode. The current
pathname identifies the replacement inode. The native helper retains its
original descriptor through lock acquisition and validation, then detects the
descriptor/path divergence in the immediate pre-success identity check.
