# Count-pricing risk statement

Public documentation does not explicitly classify
`POST /v1/responses/input_tokens` pricing. This study does not claim the
endpoint is contractually free.

Every count effect receives a retained local shadow charge at the highest frozen
applicable input rate. A separately authorized count-only probe must run before
inference: one request per request class, four maximum, zero inference, zero
retries, concurrency one, durable latency/response evidence, and spend
reconciliation after the frozen interval.

The campaign terminates on a charge above shadow reservation, fixed count fee,
contradictory authoritative pricing, unexpected cache/tier/region/long-context
classification, nonzero initial spend, missing/changed hard cap, missing or late
reconciliation, API shape drift, ambiguity, count/inference identity mismatch,
retry, or inference during the count-only probe. New evidence requires a new
prospective amendment; existing records are never reinterpreted.
