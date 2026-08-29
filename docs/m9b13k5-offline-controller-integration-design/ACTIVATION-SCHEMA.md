# Structural activation schema

Protocol: `lachesis-m9b13k5-structural-activation-candidate/1`.

The Zod-derived schema in
`packages/generator-ai-sdk/src/internal/m9b13k5/protocol.ts` binds:

- reviewed integration commit and tree;
- controller, accepted ledger, production helper, launcher, production
  transport, raw parser, reconciliation, and request-sequence identities;
- custodian public key, SHA-256 fingerprint, and custodian identity;
- ledger namespace commitment, store identity, and initial root;
- request and campaign identities and the sole token ID;
- project `bmsda`, draft `6a7619b506a607fe5f63a77d`, and provider `osfstorage`;
- exact synthetic filename, 245-byte length, byte digest, artifact identity, and
  PUT request digest;
- every request, response, concurrency, retry, redirect, and deadline limit;
- ceremony and two-phase revocation protocols.

The activation identity is SHA-256 of canonical JSON of the complete candidate.
The identity is not a field of that projection, so derivation is noncircular.
Changing any projected binding changes the identity or rejects validation.

The schema produces structural data only. Positive authority additionally
requires an independently reviewed capsule and a live effect-admission
capability. Neither exists in this milestone. A future capsule must place the
structural candidate and its digest in a signed envelope; the envelope identity
must exclude its own identity and signatures from the signed projection while
binding the signer identities and signature protocol outside that projection.
