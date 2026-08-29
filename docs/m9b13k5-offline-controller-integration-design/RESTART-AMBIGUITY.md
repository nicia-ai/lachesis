# Restart and ambiguity table

Restart begins with retained-receipt, namespace, store, initial-root, and ledger
snapshot comparison before credential acquisition. `may create another PAT` is
false in every state.

| Durable state                     | Read credential               | Reserve request   | Dispatch                       | Reconcile only | Revoke | Await custodian | Terminal/quarantine   |
| --------------------------------- | ----------------------------- | ----------------- | ------------------------------ | -------------- | ------ | --------------- | --------------------- |
| inert                             | No                            | No                | No                             | No             | No     | No              | No                    |
| activation structurally inspected | No                            | No                | No                             | No             | No     | No              | No                    |
| activation admitted               | No                            | No                | No                             | No             | No     | No              | No                    |
| ledger opened/verified            | No                            | No                | No                             | No             | No     | No              | No                    |
| credential launch reserved        | Yes, same one-use launch only | No                | No                             | No             | No     | No              | No                    |
| credential custody active         | No replacement                | No                | No                             | No             | No     | No              | No                    |
| request preconditions in progress | No replacement                | Yes, if count <18 | No                             | No             | No     | No              | No                    |
| upload reserved                   | No replacement                | No                | Yes, original reservation only | No             | No     | No              | No                    |
| upload possibly dispatched        | No                            | No                | No                             | Yes            | No     | No              | No                    |
| upload reconciled                 | No                            | No                | No                             | No             | Yes    | No              | No                    |
| revocation reserved               | No                            | No                | Yes, original reservation only | No             | No     | No              | No                    |
| revocation possibly dispatched    | No                            | No                | No                             | Yes            | No     | No              | No                    |
| credential custody closed         | No                            | No                | No                             | No             | No     | Yes             | No                    |
| awaiting independent verification | No                            | No                | No                             | No             | No     | Yes             | No                    |
| synthetic revoked/verified        | No                            | No                | No                             | No             | No     | No              | Close-only            |
| synthetic/live security stops     | No                            | No                | No                             | No             | No     | No              | Yes                   |
| live revoked/verified             | No                            | No                | No                             | No             | No     | No              | Yes; unreachable here |
| quarantined                       | No                            | No                | No                             | No             | No     | No              | Yes                   |
| closed                            | No                            | No                | No                             | No             | No     | No              | Yes                   |

After a possible PUT there is no second PAT, PUT, retry, or in-memory counter
reset. Possible upload dispatch allows only a separately authorized
reconciliation path. Possible revocation dispatch allows only custody closure
and independent verification. Unresolved ambiguity is terminal unless a later,
separately authorized reconciliation protocol proves otherwise.
