# Corrected M9b.13k.4a policies

## Final pathname pinning

Snapshot and audit open `ledger.log` relative to the admitted namespace, retain
that descriptor, cross the deterministic start barrier, take an exclusive log
lock, validate the complete chain, and keep the lock through the final identity
check and receipt write. Immediately before a successful receipt, the helper
revalidates the namespace chain and compares descriptor and authoritative leaf
device/inode, regular-file type, effective-UID ownership, mode 0600, link count
one, and session identity. Absence, replacement, unlink, hardlinking, or
identity divergence is `post-inspect-identity-ambiguous`, never an
orphan-descriptor success.

## Ancestors

Every absolute component is opened without following symlinks and retained by
device/inode. Effective-UID-owned ancestors must be directories of exact
mode 0700. Root-owned ancestors must not be group/world writable. The only
writable exception is the exact `/private/tmp` path, root-owned, directory type,
exact mode 01777; its next component must be effective-UID-owned and exact
mode 0700. Arbitrary sticky directories, other owners, aliases, group/world
writability, and later mode or identity changes reject. The campaign parent and
namespace are effective-UID-owned mode-0700 directories.

## Header version 1

All twelve bytes at offsets 48 through 59 are reserved and must be zero before
semantic state is derived. The CRC still covers bytes 0 through 59, but a valid
recomputed CRC cannot authorize nonzero reserved data. Version, flags, reserved
bits, or bytes require an explicit future protocol/version.

## Helper construction and invocation

The wrapper accepts only a normalized absolute source path and a new build
directory path. It validates every build-path ancestor under the same policy,
requires the build directory to be absent, creates it exclusively at mode 0700,
and selects the fixed leaf `m9b13k4a-ledger-helper`. The final executable must
be effective-UID-owned, regular, mode 0700, and link count one. The wrapper
records all component device/inode/owner/mode values plus executable hash and
identity, checks them immediately before direct absolute-path spawn and after
completion, and returns ambiguity on in-run replacement. There is no shell, PATH
lookup, caller-selected executable leaf, or filesystem result pathname: receipts
use a bounded inherited pipe, so a result-path-parent race is structurally
absent.

## EINTR

`read`, `pread`, partial-progress writes, barrier pipe reads/writes, `fsync`,
and `flock` retry only on `EINTR`. Read/write offsets advance only by completed
bytes. Other errors retain their semantic classification. The outer unchanged
deadline can terminate repeated interruption; post-write uncertainty remains an
explicit append ambiguity. Tests install a harmless `SIGUSR1` handler and raise
the real signal once at each named syscall boundary.
