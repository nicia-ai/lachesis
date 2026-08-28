# Native helper and framing design

The native helper contains only POSIX/macOS filesystem mechanics. It has no
study, HTTP, credential, OSF, artifact, activation, custodian, or authority
logic. Its operations are `create`, `snapshot`, `append`, and `audit`.

## Admission and descriptor policy

The helper splits an absolute normalized path into components, checks each with
`fstatat(..., AT_SYMLINK_NOFOLLOW)`, and opens it with descriptor-relative
`openat`, `O_DIRECTORY`, `O_NOFOLLOW`, and `O_CLOEXEC`. Creation uses `mkdirat`
and refuses an existing leaf. It retains the grandparent, immediate parent, and
namespace descriptors for the operation. It creates the log with
`O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC`, then uses the retained log descriptor for
locking, reads, validation, appends, and synchronization.

Pre-append and post-append checks compare the retained descriptors with their
admitted device/inode/type/mode/link-count values and with descriptor-relative
directory entries. A pathname replacement never becomes authoritative.

## Binary framing

All integers are unsigned big-endian.

The 64-byte log header contains:

- bytes 0–7: `L9K4LOG1`;
- bytes 8–11: version `1`;
- bytes 12–15: header length `64`;
- bytes 16–47: random 32-byte session identity;
- bytes 48–59: zero reserved bytes;
- bytes 60–63: IEEE CRC-32 of bytes 0–59.

The initial root is SHA-256 of the complete header.

Each record contains:

- four-byte magic `REC4`;
- four-byte version `1`;
- four-byte total record length;
- four-byte canonical payload length;
- eight-byte strictly increasing sequence;
- 32-byte previous root;
- canonical payload bytes;
- 32-byte SHA-256 of the fixed record header and payload;
- four-byte IEEE CRC-32 through the record digest;
- four-byte footer `END4`.

Payloads are at most 65,536 bytes and the complete log is at most 8 MiB. Audit
requires exact framing to EOF. Duplicate sequences, broken previous roots,
invalid digests/checksums/footers, oversized fields, trailing garbage, and torn
records fail closed. A short final frame is classified ambiguous; other invalid
chains are security stops. No partial record is returned as committed.

The helper treats payload bytes as opaque storage data. The trusted wrapper
performs duplicate-key rejection, kernel JSON validation, and canonicalization
before invocation. The helper does not interpret or authorize payload meaning.
