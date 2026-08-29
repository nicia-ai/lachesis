# Separately authorized implementation plan

The following stages are not authorized by M9b.13k.5. Each requires its own
approval, implementation, hostile tests, and independent review.

1. Integrate the accepted ledger behind an exact adapter. Bind retained
   receipts, namespace/store identity, CAS, rollback detection, and the complete
   event grammar.
2. Implement capability-separated transport. Keep production HTTPS and loopback
   conformance constructors opaque and disjoint.
3. Implement raw parsers and stable-object reconciliation against bounded
   transport bytes.
4. Implement the effect-capable controller state machine with exact reservation,
   dispatch, deadline, restart, and accounting behavior.
5. Implement and independently authenticate the one-use credential launcher.
6. Implement the independently authenticated human custodian tool.
7. Run intercepted and loopback integration with synthetic credentials and zero
   external effects.
8. Prepare, but do not admit, an activation capsule for separate review.
9. Conduct a separately authorized PAT ceremony.
10. Conduct a separately authorized canary execution.

No later stage may treat a failed M9b.13k.2 or M9b.13k.3 controller as accepted
implementation.
