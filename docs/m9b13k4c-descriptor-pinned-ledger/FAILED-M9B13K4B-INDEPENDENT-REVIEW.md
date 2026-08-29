# Failed M9b.13k.4b independent review

The independent review examined commit
`4d447b72432479a734e327ff42270e34ea3dbfd7`, tree
`aaf1e8b0d4ce3af72ede47d93701cefb5d2dc5bf`, implementation identity
`ead3f08507c92c03f6380ab17a1bf44046bc07a1e5f72c46bd0183f135e82db9`,
and checksum-manifest SHA-256
`b8fb340a20795d383afde9f6874d7993fd9ad26eb4fb27c9a4e020d51cdaf473`.

The exact independent-review disposition was:

`m9b13k4b-corrected-descriptor-ledger-review-no-go`

M9b remains NO-GO.

The review accepted every runtime, durability, barrier, framing, EINTR,
pathname, CAS, build, sandbox, and zero-effect invariant except one
implementation-identity ordering defect. The revision-3 derivation used
`leftKey.localeCompare(rightKey)` even though the protocol requires unsigned
bytewise ordering of the UTF-8 encoding of `kind + NUL + path`.

The review reported a valid adversarial inventory containing paths `A` and `a`
and reported its bytewise-protocol identity as
`3f59340a32ddcde0fc36dacde82158e410202686b55bed6a0c053f6f25511a7f`.
The complete adversarial inventory was not supplied with the correction
authority and is not present in the preserved predecessor evidence. Therefore
that exact fixture and digest cannot be independently reproduced or asserted by
this correction. The new focused regression preserves the reported mixed-case
condition using a fully specified local fixture and derives its own independent
reference digest.

