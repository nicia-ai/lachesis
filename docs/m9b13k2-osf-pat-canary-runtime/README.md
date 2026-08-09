# M9b.13k.2 concrete runtime

M9b.13k.2 constructs the local runtime that the accepted M9b.13k.1
`m9b13k1-correction-no-go` disposition intentionally did not provide. It does
not activate M9b, authorize a credential ceremony, or contact OSF.

The build-included private implementation is under
`packages/generator-ai-sdk/src/internal/m9b13k2/`. It contains a controlled FD3
launcher, private SQLite CAS ledger, bounded Node HTTPS transport, deadline
controller, stable Waterbutler-object reconciler, and two-phase revocation
receipt verifier. These modules are not exported from the package root.

The live entry point has no arguments and an unavailable, module-private
activation capsule. It returns before FD3 access, ledger access, transport
construction or dispatch, and custodian invocation. Ordinary JSON can be
structurally inspected but never supplies activation authority.

All executable conformance uses credentials beginning `M9B13K2SYNTHETICNONOSF`,
private temporary namespaces, local processes and loopback TLS. The test runner
is enclosed by a macOS sandbox profile that denies all networking except
localhost. No PAT, OSF request, DNS lookup, browser, provider/model call, study
effect, push or publication is part of this milestone.

The independent custodian boundary is intentionally distinct from the effect
controller. A future custodian must use separately authorized account control,
receive no effect PAT, and sign one frozen verification request with a public
key bound by a future reviewed activation capsule. The local synthetic signer
exists only to exercise binding and persistence and cannot authorize live use.
