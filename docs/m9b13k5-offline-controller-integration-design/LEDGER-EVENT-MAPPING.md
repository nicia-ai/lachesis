# Accepted-ledger event mapping

Every model transition is designed as one future transaction against ledger
implementation
`cf35bd5756e8397ed9fa010e356ac30787ef69ba19ab13a7c057eac0f32d9ceb`.

For event `n`, the retained external receipt supplies expected sequence `n-1`,
expected root, store identity, and namespace commitment. The canonical event
projection excludes only `eventIdentity` and `newRoot`. The event identity is
SHA-256 of canonical projection bytes; the modeled next root is SHA-256 of
`priorRoot + NUL + eventIdentity`. A future adapter replaces that modeled root
calculation with the accepted ledger transaction result while retaining the same
complete event projection.

| Relationship  | Reservation                                                      | Dispatch                                              | Completion/reconciliation                                        | Restart rule                                                        |
| ------------- | ---------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| Preconditions | One durable reservation per HTTP request                         | Only after committed receipt                          | Raw digest and decision projection are later events              | Count derives from ledger; never reset                              |
| Upload        | `upload-reserved`, request and PUT counters increment            | `upload-dispatch-observed` records exact boundary     | `upload-reconciled` binds stable object and bytes                | Possible dispatch permits reconciliation only, never second PUT/PAT |
| Revocation    | `revocation-reserved`, request and revocation counters increment | `revocation-dispatch-observed` records exact boundary | Custody closes; controller does not self-certify revocation      | Possible dispatch permits no retry; await custodian                 |
| Custodian     | No PAT-bearing controller reservation                            | Separate account-control session                      | Signed result binds retained sequence/root and revocation digest | Only exact custodian may terminate                                  |

The adapter must reject another ledger implementation, a recreated namespace,
changed store, changed initial root, stale expected receipt, cloned ledger,
rollback, foreign activation, or a non-successor sequence/root. The ledger is
not assumed to detect perfect rollback alone. The controller must durably retain
the last accepted receipt outside the ledger, authenticated and bound to the
activation. On restart it compares the retained receipt, current namespace and
store identities, and ledger snapshot before any credential acquisition.
