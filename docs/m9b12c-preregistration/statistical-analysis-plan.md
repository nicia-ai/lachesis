# Statistical-analysis plan

- Unit: one semantically independent paired case.
- Primary population: exact opaque 168-case inventory, seven cases in each of 24
  family-by-scale cells.
- Endpoint: paired binary first-attempt semantically supported end-to-end
  success, with all required stages defined in `preregistration.md`.
- Test: exact one-sided conditional McNemar, discovered-program favorable, alpha
  0.05 represented as 1/20.
- Decision: integer comparison of the exact binomial tail numerator multiplied
  by 20 against its denominator; no floating-point boundary decision.
- Estimand: paired difference in first-attempt grounded success over the entire
  frozen primary population.
- Missingness: no deletion, imputation, substitution, repair, retry, or
  replacement. Every terminal failure remains a failure for the endpoint.
- Weighting: equal allocation and equal case weight across 24 cells.
- Multiplicity: the primary endpoint is the sole superiority test. Family,
  scale, usage, retrieval, latency, and cost strata are descriptive.
- Access: primary remains inaccessible until the separate 24-pair probe passes
  the frozen M9b.3f gate. Probe measurements are excluded from primary.

The executable analyzer is `lachesis-m9b10c-exact-primary-mcnemar@1.1.0`,
implemented in source SHA-256
`f21ec84ed1163eb2ae9b78350eaf480704596dad9f2a764502a80f690a17640e`. It accepts
only the opaque complete-population and complete-measurement tokens. Frozen
boundary vectors are 5-0 = 1/32 (significant), 4-0 = 1/16 (not), and 0-5 = 32/32
(not treatment-favorable).
