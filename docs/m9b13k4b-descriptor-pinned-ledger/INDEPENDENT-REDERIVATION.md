# Independent rederivation

The implementation inventory is parsed by the strict private revision-3 schema,
sorted by the bytewise `kind + NUL + path` key, canonicalized, and hashed over:

1. the UTF-8 implementation protocol;
2. an unsigned big-endian 64-bit canonical-byte length;
3. the canonical inventory bytes.

The independently derived identity is:

`ead3f08507c92c03f6380ab17a1bf44046bc07a1e5f72c46bd0183f135e82db9`

All fourteen bound entries were mutated independently. Every mutation changed
the derived identity.

The inventory binds corrected TypeScript and native sources, emitted JavaScript
and declarations, the production and conformance normalized helpers, the build
protocol, hostile test, exact sandbox, and relevant configuration. It excludes
the inventory file itself, package manifest, decision projections, and checksum
manifest, preventing identity cycles.

The normalized production helper is 53,696 bytes with SHA-256
`7edfb6ece84e6d9b4d292700234880bc73c57484c6bc7fd73ec29136c2b64c6e`. The
normalized conformance helper is 53,984 bytes with SHA-256
`16f2a69cb84c52a4a96532546f7783cc3f1bd80125f98dff3eb926e6363f1625`. Both use
source-derived UUID `812EAFBE-99FD-7A55-9619-C9F6068F174E`, variant-specific
fixed ad-hoc identifiers, and only `libSystem.B.dylib`.
