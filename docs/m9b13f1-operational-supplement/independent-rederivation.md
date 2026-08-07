# Independent offline rederivation

All inputs came from local immutable Git objects, local registration receipts,
and registered bytes. No network was used.

M9b.13f remains byte-for-byte unchanged at commit
`adc0eb47ee8103ab3491b8aca1d884be22ccf2ab`, tree
`e6aff271b90b68d24a8d5877b7e338fb6683a9cb`, with review decision
`m9b13f-minimal-operational-supplement-review-no-go`. Its review evidence is
preserved append-only with disposition
`reviewed-no-go-superseded-prospectively-by-m9b13f1`.

The corrected body uses 19 substantive payload files. `BODY-PAYLOAD.json` raw
digest is `b3e5c0787329f4e6c1771f2647d00513338a0272a6c34d27a1f8b701507294e6`;
its canonical strict-JSON digest, and therefore the body digest, is
`56ffe1f5c1fa7e43a7ab37367b630efc60fa530a126dbb499532a378dacd663b`. Identity and
seal records remain outside the body payload, avoiding a digest cycle.

The complete package inventory contains 30 normalized, sorted, unique paths and
has canonical digest
`f8a12040854cbd4af07317e71b86b6deb60f78e85dac37bbf7cf71bd42febdff`.

Exactly one OS-random Ed25519 keypair was generated for M9b.13f.1 authorship.
Public key identity is
`lachesis-m9b13f1-supplement-author-ed25519-a4902fc3ea2a0e91`; author commitment
is `sha256:a4902fc3ea2a0e91d9936b1a0be3c162e308f3f1d62e804c6e7066cce89c873f`.
The author signature verifies. Private custody remains outside Git at modes
`0700`/`0600`; no private bytes or locator are recorded.

The historical inventory contains 17 exact records including `M9b.13a.review`.
All 27 registration identities and the independently derived 18-field
scientific/financial projection reproduce with zero changes.

Independent review remains nonauthorizing; separate submission authorization is
required and currently absent. No runtime or other authority exists.
