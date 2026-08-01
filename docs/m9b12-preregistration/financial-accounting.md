# Financial and accounting plan

| Component                     |     Ceiling |
| ----------------------------- | ----------: |
| Moderate inference            | $342.097920 |
| Count shadow contingency      | $117.964800 |
| Operational campaign          | $460.062720 |
| Prospective provider hard cap | $500.000000 |
| Headroom                      |  $39.937280 |

The campaign has 768 count requests, 768 inference calls, and at most 1,536
provider HTTP requests. Each request uses the authoritative class-specific
moderate envelope. Count requests reserve maximum input at $3.125000 per million
tokens and retain exact settled shadow cost regardless of actual count billing.
Count and inference billing remain distinct.

The dedicated project must start at zero spend and serve no other workload.
Reservations precede dispatch. Ambiguity consumes the complete reservation;
overage or insufficient complete-pair/phase/population capacity halts. Retries
are zero and concurrency is one. The $500 cap is defense in depth and may lag.
No cap, project, budget, or credential is activated by this document.
