# Independent rederivation

The revision-4 implementation inventory contains 22 bound entries. An
independent reference encoder constructed each key as raw `kind`, byte `0x00`,
and raw `path`, encoded the complete key as UTF-8, and compared unsigned bytes
without calling the production comparator.

The canonical inventory was independently framed as:

1. UTF-8 bytes of `lachesis-m9b13k4c-source-build-bound-ledger-identity/4`;
2. an unsigned big-endian 64-bit canonical-inventory byte length;
3. canonical JSON inventory bytes.

Node SHA-256 and the production derivation independently produced:

`cf35bd5756e8397ed9fa010e356ac30787ef69ba19ab13a7c057eac0f32d9ceb`

Workers-compatible Web Crypto produced the same digest for the focused reference
vectors. Twenty-four full-inventory orderings—original, reversed, and all 22
rotations—produced one identity. The four-entry focused fixture exhaustively
covered all 24 permutations and produced one identity.

Each of the 22 bound entries was mutated independently and every mutation
changed the identity. This includes the `m9b13k4c/implementation-order.ts`
entry, proving a comparator-source mutation changes the source-bound identity.

The fully specified local mixed-case fixture sorted `A` before `a`, did not call
`localeCompare`, and independently produced
`edc85f40bcba54fddda922c0d08436987b16b44c2e75d93ee6f8f2b381823edb`. It does not
reproduce the reviewer-reported digest because the review authority did not
supply the rest of that exact fixture. The production code contains neither
expected digest.
