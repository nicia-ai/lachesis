# Future independent-review receipt schema

Protocol: `lachesis-m9b13f2-future-independent-review-receipt-schema/1`

The future receipt directly binds the supplement-body protocol and canonical
digest; `BODY-PAYLOAD.json` protocol and raw digest; package-inventory protocol
and canonical digest; complete checksum-manifest protocol and raw digest; and
the final reviewed Git commit and tree.

It directly binds the author-public-key evidence protocol, public identity,
commitment and SPKI digest; author-attestation protocol, raw digest and RFC 8785
canonical digest; author unsigned-projection protocol and signing-input digest;
and the author signature bytes.

It directly binds a distinct reviewer-public-key evidence protocol, identity,
commitment and SPKI digest; the exact decision; the canonical review-evidence
inventory and every artifact entry; the reviewer unsigned-projection protocol
and signing-input digest; and the reviewer signature bytes.

An opaque review-evidence digest or ambiguous singular author-attestation digest
is prohibited. Additional fields are prohibited. The receipt must state that a
review pass grants neither submission nor operational authority and requires a
later separate submission authorization. It is externally supplied and cannot
self-authorize submission.
