# M7 failure taxonomy

The categories below keep scientific evidence separate from failures in the
machinery intended to produce it.

| Class                | M7 outcome                                                                                                                                  | Interpretation                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Scientific           | No M7c outcome                                                                                                                              | No author, adjudicator, or analysis role ran, so M7c neither passed nor failed a scientific endpoint |
| Protocol             | Request-identity uniqueness and fail-closed disclosure requirements triggered                                                               | The controls rejected unsafe continuation; the protocol was not relaxed                              |
| Implementation       | Constructor handoff, dependency capsule, capacity accounting, and real controller entrypoint required successive hardening                  | Offline preparation found implementation gaps before study dispatch                                  |
| Disclosure           | M7c.1 was closed after insufficient noninterference evidence; M7c.4.1 stopped after an overbroad sealed-file search                         | Potential disclosure is treated as contamination even without a recovered hidden label               |
| Credential lifecycle | Cross-phase leases, revocation proof, and phase-scoped leases were explored but never yielded an authorized study execution                 | No credential lifecycle shortcut was allowed to outlive its phase                                    |
| Infrastructure       | Hosted-task enforcement, clean-room materialization, container boundaries, and controller binding did not jointly reach an executable state | This is the terminal cause of `closed-unexecuted-operational-isolation-no-go`                        |

M7a's low repair-direction presence motivated M7b; it was a diagnostic-quality
finding, not a false-equivalence event. M7b corrected the development diagnostic
surface without weakening conformance. M7c preparation failures are not evidence
that independent authors would pass or fail the scientific gates.
