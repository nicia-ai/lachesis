# Prospective M9b retrieval study outline

Status: **design outline only; not materialized or authorized**.

M9b would compare matched static RAG and retrieval CodeMode on fresh natural
external corpora. M9a does not create a final corpus, campaign, preregistration,
provider identity, credential preflight, executable live state, or authorization
text.

## Candidate arms

1. Static RAG: one task-derived query, one bounded top-k result, bounded reads,
   one answer call, and the shared validator.
2. CodeMode RLM: a model-authored bounded retrieval program using the same
   search, read, leaf boundary, validator, and total envelope.

Iterative non-CodeMode retrieval could be a later diagnostic arm. Calcified
strategy reuse belongs in a separate future study so discovery and reuse are not
confounded.

## Workloads

Fresh development and held-out corpora would be disjoint. Workloads should cover
lookup, joins, multi-hop resolution, temporal changes and retractions,
contradictions, exhaustive aggregation, insufficient evidence, and
document-embedded prompt injection. Each task family should have approximately
1×, 8×, and 32× corpus-scale variants while preserving the solution strategy.

## Outcomes

The prospective primary endpoint would be first-attempt grounded end-to-end
success. Secondary outcomes would include required-evidence recall, retrieved
evidence precision, citation validity, correct abstention, bytes read,
search/read/root/leaf calls, input/output/reasoning tokens, known monetary cost,
and latency.

Power and sample size remain unknown until a development study supplies a
discordance estimate. Provider, model, prompt, pricing, capacity, operational
budget, and authorization would need to be frozen before any live protocol
probe. No superiority or noninferiority margin is selected here.

## Advancement gates

M9b should not materialize until M9a receives an independent architecture and
security review confirming:

- both arms share exactly one retriever and validator;
- external text cannot become authority;
- static and runtime resource accounting fail closed;
- private replay performs zero corpus and model effects; and
- no stable API, release, or provider boundary was widened.
