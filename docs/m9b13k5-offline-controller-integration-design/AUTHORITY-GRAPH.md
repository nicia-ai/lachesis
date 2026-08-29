# Component authority graph

M9b.13k.5 defines authority shapes but constructs only synthetic modeling
capabilities. The positive live authority constant and every live constructor
are absent.

| Component                          | Constructor authority                                              | Bound inputs                                                            | Output identity                 | Serializable               | JSON creates it         | Process crossing                     | Reuse                     | Terminal invalidation                                                     |
| ---------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------- | -------------------------- | ----------------------- | ------------------------------------ | ------------------------- | ------------------------------------------------------------------------- |
| Structural activation candidate    | Ordinary validated data builder                                    | Commit/tree, implementation identities, artifact, token, ledger, limits | Canonical candidate digest      | Yes                        | Data only, no authority | Yes as untrusted data                | Inspection only           | Superseded by any binding change                                          |
| Reviewed activation capsule        | Future independent activation ceremony                             | Exact structural candidate plus independent signatures                  | Future activation identity      | Envelope yes; authority no | No                      | Only through authenticated admission | One campaign              | Invalid after first admission, mismatch, or terminal state                |
| Live effect-admission capability   | Unavailable live authority module                                  | Reviewed capsule and live integration identity                          | Opaque live identity            | No                         | No                      | No                                   | One campaign              | Destroyed on admission failure or terminal state                          |
| Synthetic conformance capability   | Private model constructor                                          | Synthetic identity only                                                 | Registry-backed opaque identity | No                         | No                      | No                                   | One model run             | Invalid after terminal state                                              |
| Production transport capability    | Future live transport owner                                        | HTTPS policy, hosts, paths, limits, activation                          | Opaque production identity      | No                         | No                      | No                                   | One campaign              | Destroy sockets and invalidate on terminal state                          |
| Loopback transport capability      | Private model/conformance constructor                              | Loopback policy and synthetic identity                                  | Registry-backed opaque identity | No                         | No                      | No                                   | One conformance run       | Invalid after terminal state                                              |
| Credential-launch capability       | Future authenticated launcher owner                                | Capsule, launcher binary, owned FD3 contract                            | Opaque one-use launch identity  | No                         | No                      | No                                   | Never                     | Consumed on one launch reservation                                        |
| Ledger capability                  | Future exact adapter; synthetic model now                          | Accepted ledger identity, namespace, store, retained receipt            | Opaque ledger identity          | No                         | No                      | No                                   | One campaign              | Invalid on stale receipt, replacement, clone, rollback, or terminal state |
| Frozen request-sequence capability | Controller implementation                                          | Sequence protocol, activation, limits                                   | Opaque sequence identity        | No                         | No                      | No                                   | One campaign              | Invalid at limit, mismatch, or terminal state                             |
| Custodian-verification capability  | Future independently authenticated human tool; synthetic model now | Custodian key/identity, token, activation, retained ledger receipt      | Signed receipt identity         | Receipt yes; capability no | No                      | Receipt only                         | One terminal verification | Consumed by one terminal decision                                         |
| Terminal-report capability         | Controller-owned reporter                                          | Complete ledger grammar and custodian result                            | Terminal report identity        | Report yes; capability no  | No                      | Report only                          | Once                      | Consumed after report emission                                            |

The graph is:

```text
structural candidate (data, no authority)
  -> independent capsule review (future, absent)
    -> live effect admission (future constant unavailable)
      -> [ledger, credential launcher, production transport, request sequence]
        -> awaiting independent verification
          -> custodian receipt
            -> terminal report

synthetic conformance capability
  -> [synthetic ledger, loopback transport, frozen sequence]
    -> synthetic custodian receipt
      -> synthetic terminal report
```

Synthetic and live branches never merge. A registry-backed capability cannot be
reconstructed by serialization. Importing a private module exposes only the
synthetic constructor and pure functions; it exposes no production transport,
credential, capsule, or live-admission constructor. No callback supplies URL
policy, parsing, reconciliation, accounting, ledger behavior, or terminal
classification.
