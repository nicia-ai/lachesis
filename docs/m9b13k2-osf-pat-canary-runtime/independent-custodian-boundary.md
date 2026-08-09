# Independent revocation custodian boundary

The effect controller can reserve and dispatch at most one revocation, persist
the bounded response or ambiguity, close credential custody, and stop at
`awaiting-independent-revocation-verification`. It cannot convert its own HTTP
response into a verified absence claim.

The frozen verification request contains only the activation identity, request
identity, token ID, ledger store identity, revision, root, revocation request
index, and revocation receipt digest. It explicitly records that no credential
is included. The independent Ed25519 receipt binds all of those fields plus the
custodian identity, public-key fingerprint, result, and issue time.

A credible future producer is a separately reviewed, human-controlled custodian
tool whose public key is checksum-bound in the activation capsule. Its operator
uses an independently authenticated account-control session for the same OSF
account to inspect the token inventory by token ID after the effect controller
has surrendered the PAT. The tool receives no effect PAT and signs exactly one
of `revoked`, `active`, or `ambiguous`. The controller cannot construct the
authority or sign the result.

That future tool and authorization ceremony are not present in M9b.13k.2.
Consequently M9b remains NO-GO and no live completion claim is possible. The
synthetic principal in the conformance suite is domain-separated, locally
generated, and deliberately ineligible for any future live activation.
