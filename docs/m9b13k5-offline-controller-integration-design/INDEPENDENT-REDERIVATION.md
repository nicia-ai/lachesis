# Independent rederivation

The reviewed implementation is commit
`1d7a0ec5bac2f257e553351f46e0c46e7678a250`, tree
`4d084937969fc611d10ab698bfb65cb236c120ba`. The receipt commit is
`e00ce7e198bd6a128947f4fd7af2e9657ac6c5bd`, tree
`4927abd8440d35c30d38d3c30a9be42da47619dc`.

An independent script reconstructed the design projection from literal protocol
names, the accepted ledger identity, state and event inventories, dispatch
boundaries, limits, and artifact fields. It canonicalized that projection with
the kernel canonicalizer and SHA-256 hashed the result. The independently
derived result and the executable result were identical:

`6b08681bb2b94c4f0dfc6d70dfc539ad8b2d32cd7614c8ed3ec58ff8f8f537e0`

The state-model projection binds the state, event, transition, capability,
artifact, limit, custodian, and accepted-ledger inventories. Its identity is:

`04d5cfef64860ebcc14ebcdfe95e6a6aa401dfdd71c128c73d7a9e1789dbb7ef`

The frozen artifact independently has length 245 and SHA-256
`1b00de9f3ed77084dcbe8bdd2c6b51c140b4384cb23301823983656681cdab64`. Its artifact
identity is `1b81659fe2a5f119a47b88afcd1473c6e6838452ea7165cc642bcd9a9c65a1d3`,
and its PUT-request digest is
`5bf21037629d0ed7f4c02291b3fa9314d370b0dcaf13413d21ea278442beed42`.

The model contains 22 states, 20 event kinds, and 37 allowed transition
specifications: 18 workflow transitions, four dispatch-ambiguity transitions,
and 15 quarantine transitions. Its exhaustive matrix tests all 440 state/event
pairs, applies every allowed specification, and rejects every unspecified pair.

No ledger adapter, HTTPS transport, credential launcher, activation capsule,
custodian tool, OSF controller, credential, token, or remote effect was created.
