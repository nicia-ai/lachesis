# Deterministic archive protocol

The transport is an uncompressed POSIX.1-1988 ustar archive. All 57 accepted
files fit the 100-byte name field directly; the longest path is 65 bytes, so no
PAX, GNU, prefix-splitting, or implementation extension is needed.

Entries use ascending raw UTF-8 NFC path bytes. The archive contains two
explicit namespace directories at mode `0755` and 57 regular files at mode
`0644`. UID, GID, and mtime are zero; uname and gname are empty. All padding is
zero and the archive ends with exactly two 512-byte zero blocks.

Archive SHA-256:
`978c996fd5c55d559fa1c36a2f0eba2f7ef43e7fe27603c2dc7c74dc63f0201d`. Its exact
length is 210432 bytes.

The wrapper is a mechanical transport container. It changes no inner byte and
creates no scientific, financial, operational, submission, or approval claim.
