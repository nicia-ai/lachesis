# Independent rederivation

The implementation identity was rederived from the schema-validated inventory,
not copied from another artifact. Entries were sorted by `kind`, NUL, and
`path`; the canonical JSON bytes were length-prefixed with an eight-byte
big-endian length and hashed after the advanced implementation protocol string.
The result was
`16ac5ed843aab33a3f68e26c91a2a0dabda1aac3993931e61b9e9e3c0291e908`.

Independent source-to-output checks rebuilt the package emissions and two native
helpers. Every inventory byte length and SHA-256 was remeasured. Both native
outputs were byte-identical. Replacing only the bound sandbox-profile digest
with 64 zeroes changed the derived identity to
`59a7e4be53adf4ca7d09133806d82f00aee04938ec9ffd25c804fe3f6663d387`,
demonstrating bound-byte sensitivity.

Noncircularity is explicit: the implementation identity excludes
`IMPLEMENTATION-INVENTORY.json`, `PACKAGE-MANIFEST.json`, `CHECKSUMS.sha256`,
and this narrative. The package manifest excludes itself and the checksum
manifest; the checksum manifest excludes itself.

The reviewed M9b.13k.4 seal remained byte-identical: commit
`31cf28e1621f9ea98186e62a2e795c6d5ba4416a`, tree
`5ae43651c0a30a4f4ab9750efed8515b004dad7d`. Its checksum manifest and the
M9b.13k.3 predecessor manifest both revalidated without error.
