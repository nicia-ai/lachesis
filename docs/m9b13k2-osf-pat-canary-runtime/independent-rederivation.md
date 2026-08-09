# M9b.13k.2 independent rederivation

Starting from implementation commit `806ca880c674262024a02db0a0c0660ce127d70b`
and tree `c2f7be1072fdc82981d6f36ec3dd19c3109e5fb0`, the runtime identity
rederives as `9b2a1aeab9450eec9f8a6e2360b03914a4c92bd3da1a5835dab8c62c513eb325`.
The source hashes and emitted JavaScript hashes are frozen in
`implementation-identities.json`.

The live entry has no activation authority and returns zero FD3 reads, ledger
accesses, transport dispatches, custodian invocations, and external effects. The
synthetic path uses opaque concrete ledger/transport/runtime handles and a
domain-separated non-OSF credential. Durable events rederive request, PUT and
revocation counts; unresolved reservations and non-response dispatches remain
ambiguous across restart.

Independent revocation is a separate authority boundary. The effect controller
can only surrender credential custody and freeze a verification request. A
future separately authenticated custodian must bind its public key in the
uncreated activation capsule and sign `revoked`, `active`, or `ambiguous`
without receiving the effect PAT. The synthetic signer proves the local binding
only.

These facts support `m9b13k2-concrete-runtime-ready-for-independent-review`.
They do not support an M9b GO decision, PAT ceremony, activation, network
access, OSF access, or publication.
