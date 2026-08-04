# M9b.13d.1 same-UID threat analysis

The attacker remains an independent process with the same effective UID as the
acquisition process. Directory ownership and mode checks do not remove that
attacker.

## Descriptor-execution boundary

- Trusted object: the exact Mach-O helper bytes whose digest is
  `60a81ccf7658b1a7a91d9dbee7d1ca63840a4751597319139d65f0a0a1536fd7`.
- Pinning descriptors: one `O_RDONLY | O_NOFOLLOW` descriptor used for hashing
  and one `O_EXEC | O_NOFOLLOW` descriptor whose device, inode, regular-file
  type, owner, link count, mode, and size match the read descriptor.
- Same-UID pathname power: the attacker can replace the original directory
  entry. The 32-repetition regression does so after both descriptors are open.
- Digest point: the digest is computed from the retained read descriptor before
  launch attempts.
- Consequential use: neither retained descriptor can be executed through
  `/dev/fd/3`; Darwin returns `EACCES`. A path fallback would execute attacker
  bytes and is therefore forbidden.
- Mutation after verification: a same-UID process may also hold or obtain a
  writable descriptor to the inode. Descriptor identity does not make mutable
  bytes immutable, and no kernel descriptor-exec operation exists here to narrow
  and prove the final hash-to-load interval.
- Detecting check: no pathname or digest recheck can prove which bytes the
  kernel loads from a later path-based `exec`. The boundary therefore fails
  closed as NO-GO.

## Seven independent-review findings

Finding 6 reaches a proven NO-GO at the helper-execution boundary. Findings 1
through 5 and 7 remain blocking and unmodified. Their old M9b.13d pathnames,
descriptors, digest points, parsing paths, and seal ordering are not
reinterpreted as safe. Because one mandatory boundary already requires NO-GO,
implementing partial corrections to the remaining findings would create no
reviewable dependency closure and was intentionally avoided.

No consequential M9b.13d.1 use relies on a pathname after identity validation:
the feasibility probe attempts only `/dev/fd/3`, forbids fallback, performs no
acquisition effect, and returns NO-GO.
