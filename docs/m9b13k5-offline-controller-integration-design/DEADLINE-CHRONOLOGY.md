# Deadline and dispatch chronology

All deadlines are absolute monotonic values. Equality with a deadline is
expired. Wall-clock time is never used for admission.

The controller checks the applicable deadline:

1. before the restart snapshot;
2. before opening a ledger transaction;
3. inside the reservation transaction immediately before commit;
4. after committed reservation and before request-object creation;
5. before the first possible byte enqueue;
6. during bounded response streaming;
7. before every revocation boundary using the separate 15-second deadline.

A post-deadline reservation is forbidden. A reservation committed before expiry
but followed by expiry remains durably reserved-not-dispatched; counters do not
roll back and the controller cannot create a replacement request.

Dispatch boundary semantics are exact:

| Boundary                    | Earliest possible effect                                   | Failure classification                                   |
| --------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| Request constructed         | No                                                         | Reserved-not-dispatched                                  |
| Reservation committed       | No transport effect                                        | Reserved-not-dispatched                                  |
| Request object created      | No byte yet                                                | Reserved-not-dispatched                                  |
| First possible byte enqueue | Yes                                                        | After-dispatch ambiguous absent terminal response        |
| Body write begun            | Yes                                                        | After-dispatch ambiguous                                 |
| Request end begun           | Yes                                                        | After-dispatch ambiguous                                 |
| Response headers            | Request was dispatched                                     | After-dispatch ambiguous until bounded terminal response |
| Response completion         | Terminal response only after strict parsing/reconciliation | Proven terminal or ambiguity                             |

Synchronous and asynchronous exceptions use the same semantic boundary. Once a
byte may have left, later local errors do not reclassify the operation as
pre-dispatch.
