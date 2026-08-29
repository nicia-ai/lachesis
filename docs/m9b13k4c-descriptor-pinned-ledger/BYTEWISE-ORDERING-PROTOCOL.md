# Normative bytewise inventory ordering

The private implementation-identity protocol is
`lachesis-m9b13k4c-source-build-bound-ledger-identity/4`.

For each schema-validated inventory entry, the comparison key is exactly the raw
`kind`, followed by one U+0000 separator encoded as byte `0x00`, followed by the
raw `path`. The complete key is encoded as UTF-8 without normalization, case
folding, locale handling, or filesystem interpretation.

Two keys are compared byte by byte as unsigned integers. The first differing
byte determines order. If one sequence is an exact prefix of the other, the
shorter sequence sorts first. Exact equality returns zero.

Duplicate identities are rejected from the validated unsorted inventory before
sorting. An identity is the exact `kind + U+0000 + path` string. Differences in
byte length or SHA-256 do not make duplicate identities distinct.

After sorting, canonical framing is unchanged: canonical JSON is UTF-8 encoded,
then hashed as the UTF-8 protocol bytes, an unsigned big-endian 64-bit canonical
byte length, and the canonical inventory bytes.

The frozen path schema permits only `[A-Za-z0-9._/-]`, rejects absolute paths
and `..`, and therefore rejects non-ASCII and canonically equivalent Unicode
path spellings before comparison.
