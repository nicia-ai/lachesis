# Prospective M9b retrieval study outline

Status: **M9b.0.2 offline protocol hardening only; program discovery is not
implemented and M9b is not materialized or authorized**.

M9b would compare matched static RAG and retrieval CodeMode on fresh natural
external corpora. M9a does not create a final corpus, campaign, preregistration,
provider identity, credential preflight, executable live state, or authorization
text.

## M9b.0.2 offline boundary correction

The internal `lachesis-m9b0-offline-retrieval-comparison@1.0.2` protocol is a
development-only dry run of the comparison boundary. It is not exported from the
generator package facade. It composes M9a's closed retrieval interpreter under
arm-specific private execution profiles and does not change the M2 or M9a
protocol identities. The full-envelope one-shot answer operation exists only in
the control profile and cannot be named by a model-authored treatment program.

Both arms receive the same aggregate model ceiling: 102,400 input tokens, 20,480
output tokens, zero reasoning tokens, zero monetary cost, and 10,000 ms of model
time. The sequenced arm allocates that ceiling across one planning call and at
most four leaf calls; the one-shot arm allocates it to its one answer call.
Compilation rejects a proposed treatment when its static aggregate token or
model-time ceiling differs from the control. Retrieval calls remain visible and
separately accounted as treatment behavior; they are not disguised as model
calls or executable evidence edges.

M9b.0 uses `utf8-byte-exact-offline-reference/1`, where one canonical UTF-8
request or response byte is one offline reference token. Before dispatch, the
adapter freezes the prompt, structured-response schema, reasoning-disabled
setting, input, canonical serialization, digest, and exact input count. It then
reconciles the canonical response byte count and reported time against the
reservation. This proves the shape of the reservation boundary only. It is not a
claim about any live provider's tokenizer or transport serializer.

A shared NFC and 512-UTF-8-byte task preflight runs before compilation creates a
model session or either arm executes. Each arm has an independent terminal
record written through a compare-and-swap atomic persistence contract. A record
retains the exact bound model-request receipts. A successful record also
contains the private M9a replay artifact. A failed record retains its exact
typed strict-JSON failure payload, discriminant, and payload digest. Load and
resume both revalidate the payload shape, require its discriminant to match the
summary kind, and recompute its digest. Restart replays successful arms with
zero corpus or model effects, resumes verified failed arms as terminal, and runs
only missing arms. A second-arm execution or persistence failure therefore does
not erase the first arm.

M9b.0.1 also treats resume as one end-to-end identity boundary rather than a
collection of independently valid digests. Before zero-effect replay, a
successful arm record must bind to the expected compiled source and semantic
contract, exact task, corpus snapshot, model identity, and nested replay run
digest. After replay, the reconstructed transcript and run must bind back to the
same identities. Every canonical model-request input digest must match its
corresponding root- or leaf-model transcript event. Re-signing a locally valid
record, replay artifact, or request therefore cannot move that component to a
different comparison identity.

M9b.0.2 closes the corresponding failed-terminal gap: changing the retained
failure kind, payload, or digest fails closed even when the outer arm record is
re-signed. Failure records no longer rely on an unverifiable digest of discarded
data.

This protocol still executes a caller-supplied treatment source. It does not
test program discovery and makes no claim that a root model can discover a
better retrieval trajectory. The next substantive offline phase must add a
program-discovery boundary in which the root model authors the restricted
TypeScript retrieval program from only the task, frozen grammar, registered
capability descriptions, and budget. Corpus contents, search results, and read
results must remain unavailable during program authoring. That phase requires a
new review before provider adapters, corpus construction, or live execution.

## Candidate arms

1. Static RAG: one task-derived query, one bounded top-k result, bounded reads,
   one answer call, and the shared external evaluator.
2. CodeMode RLM: a model-authored bounded retrieval program using the same
   search, read, leaf boundary, external evaluator, and total envelope.

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

M9a's submission endpoint establishes citation confinement only. Before M9b, the
study must freeze an answer-and-abstention evaluator with task-level gold
answers, support criteria, disagreement handling, and a scoring policy that is
external to both arms. Only that frozen evaluator may define a prospective
primary endpoint such as first-attempt semantically supported end-to-end
success. Secondary outcomes would include required-evidence recall, retrieved
evidence precision, citation validity, correct abstention, bytes read,
search/read/root/leaf calls, input/output/reasoning tokens, known monetary cost,
and latency.

Power and sample size remain unknown until a development study supplies a
discordance estimate. Provider, model, prompt, pricing, capacity, operational
budget, and authorization would need to be frozen before any live protocol
probe. A live adapter must bind the exact provider request serialization to that
provider's exact versioned tokenizer before dispatch; M9b.0's byte-exact offline
reference tokenizer is insufficient for this gate. Every planning and answer
call must reserve its contribution to the matched aggregate input, output,
reasoning, monetary-cost, and time ceilings before dispatch, then reconcile
actual usage. Each arm must use a fresh, audited model-session factory. Arm
order must follow a preregistered, seeded randomized or counterbalanced schedule
that is frozen before execution and recorded in every comparison. No superiority
or noninferiority margin is selected here.

## Advancement gates

M9b should not materialize until M9a receives an independent architecture and
security review confirming:

- both arms share exactly one retriever, citation-confinement boundary, and
  external evaluator;
- the treatment program is authored through a frozen program-discovery boundary
  whose root model sees only the task, grammar, registered capabilities, and
  budget—not corpus contents or retrieval results;
- a shared byte-aware task preflight rejects inputs outside either arm's domain
  before either arm creates a model session or executes;
- the aggregate input-token, output-token, reasoning-token, monetary-cost, and
  model-time ceilings are identical, and all planning/query-generation calls are
  included in those ceilings;
- the answer/abstention evaluator is frozen, external to both arms, and tested
  against contradiction and abstention cases;
- external text cannot become authority;
- static accounting and pre-dispatch model/read reservations fail closed, with
  actual model usage reconciled afterward;
- the live provider adapter binds the exact serialized request, frozen prompt
  and response schema, and exact versioned provider tokenizer to each
  pre-dispatch reservation;
- comparison arms use distinct model sessions and a frozen counterbalanced or
  randomized order;
- each arm persists an independent atomic terminal result, safe resume performs
  zero effects for completed arms, asymmetric failures are retained, and a
  second-arm failure cannot discard the first arm;
- replay preserves all strict JSON identities, including hostile own keys;
- private replay performs zero corpus and model effects; and
- no stable API, release, or provider boundary was widened.

M9b remains **NO-GO** until the program-discovery boundary, corpus, external
semantic/abstention evaluator, provider/model/prompt/tokenizer/pricing
identities, randomized schedule, operational budget, preregistration, and
explicit live authorization are frozen and independently reviewed. M9b.0.2 does
not satisfy those live-study gates.
