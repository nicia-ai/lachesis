# M9b.12b independent-review findings and M9b.12c disposition

Decision addressed: `m9b12b-independent-review-no-go`.

M9b.12b is preserved byte-for-byte and disposed as
`superseded-unregistered-quarantine-history-not-durable`.

## Finding 1: quarantine was not durable across assessments

M9b.12c places the complete append-only history behind an opaque authority and
repository capability. The assessment evaluator queries that repository itself.
Every quarantine is committed by compare-and-swap before its terminal receipt.
Any later request for the observer returns exactly
`observer-previously-quarantined`, including after role, session, inventory,
controller, or process changes.

Serialized reload validates the entire digest chain and must match the trusted
authority-owned revision and head. Caller-selected, omitted, truncated,
reordered, duplicated, forked, altered, or independently valid foreign history
cannot authorize startup.

## Finding 2: per-role assertions were incomplete

Every canonical influence-bearing role now runs through the same full terminal
assertion. Each case verifies the exact decision and reason, all observer and
affected-identity exclusions, derived-inventory quarantine, reuse and startup
prohibitions, provider prohibitions, zero effects, and exact history-head
binding.

A clean receipt binds the exact authority head. Startup revalidation rejects a
stale receipt after any intervening append and rejects the observer permanently
after quarantine. Concurrent clean and quarantine assessments cannot leave a
usable post-quarantine startup authorization.
