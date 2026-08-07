# M9b.13f.2 sealing verification

The authorized offline author ceremony produced one Ed25519 keypair and one
author signature. The private opening remains solely outside the repository in
the required restricted custody. Only canonical public-key evidence and the
signed author attestation are included here.

Exact allowlisted verification passed for the frozen unsigned commit
`6fd14342f92b3ecc94ffab72542884cc55560d2c` and tree
`3b51f71be773e8eeb3ff6446bdc8d5764caa4762`. The 28 substantive BODY-PAYLOAD
artifacts, all raw identities, all applicable RFC 8785 identities, the complete
BODY-PAYLOAD raw identity, and the body digest are unchanged.

The exact unsigned projection canonicalizes to signing-input SHA-256
`fe2126f1e95bc34cd5d03cd56898e5a20aec53534e3d98fb07f551d7a4ebea4b`. Independent
verification from the exported RFC 8410 public key passes.

The package is ready only for external independent review. No reviewer key or
review receipt exists, independent-review passage is not claimed, and no
submission, publication, embargo-change, study-operation, or M10 authority is
present. M9b remains NO-GO.
