# Independent rederivation

The reviewed implementation is commit
`6972e212d431454a3a4b024064d83033834a512b`, tree
`1c9549168bd01c6d4cf39cc5b6f00752465c1c5b`. The failed-review evidence commit is
`0ac536f1c7c14c7f3056735fe23d3e6c941707e2`, tree
`c60c85db98863a7a3dd1c19cdf7acacb7bc9df01`.

An independent script reconstructed the protocol projection from exported
literal constants without calling the production derivation. It canonicalized
that projection with the kernel canonicalizer and SHA-256 hashed it. The
independent and executable identities matched exactly:

`504be41010938ad16c76fcfd3f54acf3cf2e6f5932d3de01333ca5a5e19a4f37`

The same independent procedure reconstructed the state/event/transition
projection. It matched the executable state-model identity exactly:

`dd71ea66af137be312891b393ee04467a3e74abcb2433e54140cf54e58cb62be`

The model freezes 9 request-local states, 15 discriminated event kinds, 18
allowed transitions, 117 forbidden transitions, and all 135 state/event pairs.
It freezes 10 mandatory operations, a 10-request shortest closed path, and an
18-request maximum-pagination closed path. In the maximum path, requests 1–11
are pre-upload verification, request 12 is PUT, requests 13–16 are post-upload
inventory, request 17 is download, and request 18 is revocation.

All source, emitted JavaScript/declarations/maps, tests, fixtures, package/build
configuration, and protocol artifacts were rehashed from the reviewed
implementation. Two fresh archived source roots independently emitted the same
12 corrected build artifacts byte-for-byte. The accepted M9b.13k.4c identity and
bytewise comparator protocol are bound explicitly; no reported or truncated
reviewer hash was reused as an implementation assertion.

No credential, PAT, OSF/Waterbutler request, upload, download, revocation,
browser action, provider/model call, activation capsule, live controller,
corpus/study action, publication, push, or external effect occurred.
