# CAS, durability, crash, and recovery protocol

An append supplies the expected session identity, sequence, root, namespace
device/inode, and log device/inode. After acquiring `flock(LOCK_EX)` on the
retained log descriptor, the helper rereads and validates the complete log,
revalidates path and descriptor identity, and compares every expected field.
Only then can it append. This serialization makes two processes holding one
stale snapshot produce one winner and one `stale-cas` rejection.

The append sequence is:

1. admit and retain descriptors;
2. synchronize a test-only start barrier when requested;
3. lock the retained log descriptor;
4. validate the complete chain and CAS inputs;
5. write the record header, payload, digest/checksum, and footer;
6. `fsync` the log descriptor;
7. revalidate descriptor/path identity;
8. `fsync` the namespace directory;
9. revalidate identity and return the new receipt.

The crash matrix terminates the real helper before lock, after lock, after
validation, before header, during header, during payload, before footer, after a
complete record but before log sync, after log sync, before directory sync,
after directory sync, and after the response is flushed. Reopen returns either
the old root, the complete new root, or an explicit ambiguous/security stop.
Partial frames never commit. Once a valid complete record is visible after
process termination it is conservatively treated as committed; if the wrapper
lost the response, callers must audit rather than retry.

Rollback detection requires the expected externally retained receipt. An audit
with expected session/root/sequence and object identities rejects a restored
older byte sequence as ambiguous. This milestone does not create the future
activation commitment that will hold that expectation.
