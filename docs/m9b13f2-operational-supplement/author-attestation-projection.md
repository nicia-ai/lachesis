# Exact author-attestation signing projection

The specifically named unsigned projection protocol is
`lachesis-m9b13f2-supplement-author-unsigned-projection/1`. Its complete object
shape and every permitted nested field are enumerated in
`author-attestation-projection.json`. Additional fields and caller-selected
subsets are prohibited.

The complete attestation contains exactly `protocol`, `unsignedProjection`, and
`signatureEnvelope`. The signature envelope is absent from the unsigned
projection, not present with null fields. Consequently the Ed25519 signature
bytes, the signing-input digest derived from the projection, and all other
signature-envelope fields are excluded without an arbitrary deletion rule.

Signing bytes are exactly:

`UTF8(RFC8785(unsignedProjection))`

The envelope's `signingInputSha256` must equal the SHA-256 of those bytes. The
projection binds the author-public-key evidence protocol and raw/canonical
identities; body protocol and canonical digest; raw `BODY-PAYLOAD.json` digest;
registration and scientific/financial identities; prospective-only status; and
the explicit nonauthorizing authority boundary. Verification must reject
omitted, null, additional, or schema-divergent fields before checking the
signature.
