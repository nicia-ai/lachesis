# M9b.12d trusted observer identity

Protocol: `lachesis-m9b12d-trusted-observer-identity/1`.

The exact trusted domain is the controller-issued study principal and launch
allocation for this study. This does not claim global human identity,
cross-study identity, biometric identity, or resistance to a compromised
controller.

The controller normalizes a trusted principal with Unicode NFKC, trim,
locale-stable `en-US` lowercase, and whitespace collapse. It hashes the domain
and normalized principal into a principal key, then derives the observer key
from that key and the durable store identity. The immutable identity event
stores only digest keys, the opaque launch handle, allocation key, role,
session, and optional expiry.

A new launch allocation for the same normalized principal receives the same
observer key across roles, sessions, inventories, and process restart. Duplicate
or concurrent allocation issuance has one winner. Unknown, expired, conflicting,
caller-created, or mismatched handles fail before startup or intercepted
effects.

The untrusted assessment schema rejects `observerIdentity`,
`observerCommitment`, `canonicalObserverKey`, and `role`, as well as every
unexpected top-level request field. Therefore the assessment cannot select or
rotate the canonical observer identity.
