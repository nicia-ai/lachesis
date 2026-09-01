# Frozen future implementation order

The only permitted future order is:

1. Accepted-ledger adapter and verified-receipt boundary.
2. Raw transport receipt, strict JSON parser, and official response schemas.
3. Exact reconciliation and URL/resource binding.
4. Complete request/state/event grammar and replay.
5. Authenticated launcher.
6. Revocation custodian.
7. Full loopback/intercepted integration with crashes and restarts.
8. Independent review of all preceding components.
9. Only then effect-capable controller assembly.
10. Separate activation-capsule preparation and review.

M9b.13k.5a implements pure contracts and tests for stages 1–4 only. It does not
implement or begin stages 5–10.
