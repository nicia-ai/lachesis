# Reserved-byte regression method

The version-1 header is a 64-byte big-endian structure. The corrected hostile
test independently computes CRC-32 over bytes 0–59, writes it with
`writeUInt32BE`, reads it back with `readUInt32BE`, and asserts equality before
invoking the helper.

The test also verifies magic, version, header length, nonzero session identity,
and the stored CRC. A zero-reserved-byte control rewritten by the same procedure
succeeds.

Each offset 48–59 is then changed independently, followed by a mutation of all
twelve offsets together. Each mutation retains a self-consistent CRC and is
rejected by snapshot, audit, append, and a fresh cross-process reopen with the
specific native reason `reserved-header-unsupported`. Generic CRC or framing
rejection is not credited.
