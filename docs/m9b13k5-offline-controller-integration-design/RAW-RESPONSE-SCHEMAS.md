# Raw-response schemas

Protocol implementation:
`packages/generator-ai-sdk/src/internal/m9b13k5/response-schemas.ts`.

The future transport supplies bounded raw bytes only. The controller performs,
in order:

1. response ceiling check;
2. fatal UTF-8 decoding with no normalization;
3. complete JSON grammar scan with decoded-key duplicate rejection;
4. kernel JSON parsing;
5. strict, nontransforming Zod validation;
6. canonical decision projection;
7. retention of both raw-byte SHA-256 and canonical-projection SHA-256.

Unknown and hostile keys reject. Keys are never assigned through a prototype or
silently normalized. Escaped and literal spellings that decode to the same key
are duplicates.

Strict schemas exist for token detail, project, registrations pages,
view-only-link pages, pre/post-upload storage inventory, provider-root upload
relation, upload entity, download metadata, and revocation response. Actual
download content remains raw bounded bytes and is checked against the frozen
245-byte artifact digest rather than accepted as JSON assertions.
