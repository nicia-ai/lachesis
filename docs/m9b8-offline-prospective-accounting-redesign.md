# M9b.8 offline prospective accounting and topology redesign

Decision: `topology-redesign-go-for-offline-preregistration-preparation`.

M9b remains **NO-GO**. This decision authorizes only preparation of a separately
reviewed offline preregistration package. It does not authorize corpus
construction, external registration, credentials, provider access, a protocol
probe, or live execution. The frozen M9b.7 cap-only alternative remains
inactive.

Protocol: `lachesis-m9b8-offline-prospective-accounting-redesign@1.0.0`, based
on accepted commit `f3f23f7141fb3a12c06bda8d44e59d0ea6431664`.

## Why M9b.7 reserved 922,000 input tokens

GPT-5.6 Terra documents a 1,050,000-token context window, a 922,000-token
maximum input, and a 128,000-token maximum output. M9b.6 had exact canonical
provider-request bytes but no accepted exact tokenizer for the complete request
and no independently bounded provider-added framing. It therefore used the
922,000-token model input maximum as the safe fallback for every call.

The relevant boundaries are distinct:

| Boundary                        | M9b.8 classification                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| Provider context maximum        | 1,050,000 total; 922,000 input; 128,000 output                                                    |
| Canonical outbound request      | Exact JSON bytes and SHA-256 digest are available per M9b.5 request                               |
| Controller input limit          | M9b.6 reserves the provider maximum because no tighter accepted token bound exists                |
| Evidence exposed to the model   | At most four searches, four reads, and 4,096 read bytes per arm                                   |
| Instructions, schema, and tools | Included in the canonical request bytes, but bytes are not exact provider tokens                  |
| Provider framing                | Not reproducibly bounded by the pinned local adapter                                              |
| Internal provider tokens        | Not guessed as input; non-visible output structure remains within `max_output_tokens`             |
| Reported billable usage         | Available only after dispatch and used for settlement                                             |
| Maximum financial exposure      | Full input fallback plus configured output at the highest applicable cache and long-context rates |

The 922,000-token figure is therefore safe but not request-specific. It is a
fallback necessitated by the old counting boundary, not evidence that every
small request can consume 922,000 input tokens.

## Alternatives

### A. Proportional canonical-byte envelope

Rejected for the pinned OpenAI design. M9b.8 can bind the complete canonical
request, exact UTF-8 length, and digest. It also contains an explicitly
synthetic one-byte-per-token accounting harness covering multibyte Unicode,
combining characters, JSON escaping, schemas, framing exhaustion, long-context
thresholds, cache rates, ambiguity, and overage. That harness is deliberately
identified as synthetic and cannot authorize an OpenAI reservation.

No primary provider document or pinned tokenizer proof establishes a complete
byte-to-token upper bound for the provider-visible request, and no accepted
artifact bounds provider-added framing. Estimation is not reclassified as exact
or conservative proof.

### B. Official input-token count

OpenAI now documents `POST /v1/responses/input_tokens`. The operation accepts
the same input format as Responses, returns the exact count the model receives,
and includes request-structure formatting tokens. The documentation explicitly
notes why local tokenizers are insufficient for tools and schemas. The OpenAPI
contract inspected for this review is version 2.3.0. GPT-5.6 Terra supports the
Responses API and structured outputs.

The installed `@ai-sdk/openai@4.0.15` source does not expose this operation.
Using it would be a new provider effect requiring an intercepted adapter,
pre-dispatch ledger reservation, exact request/response binding, cancellation,
zero retries, ambiguity handling, and separate review. It also cannot by itself
produce a prospective complete-study maximum for later answer requests whose
evidence bodies do not exist before earlier authoring and retrieval outcomes. It
is therefore a supported future tightening path, not part of M9b.8's selected
offline design.

Primary sources:

- <https://developers.openai.com/api/docs/guides/token-counting>
- <https://api.openai.com/v1/responses/input_tokens> (OpenAPI 2.3.0)
- <https://developers.openai.com/api/docs/models/gpt-5.6-terra>

### C. Matched two-call arms with local retrieval

Selected prospectively. The discovered arm retains the central treatment:

1. The root model authors one restricted TypeScript retrieval program.
2. Lachesis compiles it as a closed AST and executes retrieval locally.
3. The same model boundary produces one grounded answer from the bounded slice.
4. The frozen evaluator scores locally with zero provider calls.

The prospective CodeMode profile is retrieval-only: the authored program may use
the closed local retrieval algebra but has no model/provider capability. It
returns a bounded evidence slice and retrieval transcript for the single later
grounded-answer call. The existing M9b.1 protocol is not reinterpreted; this new
profile still requires implementation and separate review before activation.

The static arm receives the matched planning and answer envelope:

1. The root model authors exactly one bounded search query.
2. The same deterministic retriever performs local one-shot retrieval.
3. The same model boundary produces one grounded answer from the same evidence
   limit.
4. The same evaluator scores locally.

Both arms use two calls, the same model, the same 65,536-token planning ceiling,
the same 20,480-token grounded-answer ceiling, zero retries, concurrency one,
and the same local evaluator. The frozen treatment asymmetry is program-authored
retrieval sequencing versus a model-authored single query. Program discovery is
not removed.

### D. M9b.7 cap-only reference

The eight-call, $3,639.570432 maximum remains immutable and inactive. It is a
higher-exposure reference, not the selected design.

## Conservative capacity

All values are exact integer upper bounds under M9b.7's frozen full-input,
highest-cache-class, and long-context pricing rules. They are not expected-spend
estimates.

| Slice                 | Pairs | Calls |   Input max | Output max | Reasoning max |       USD maximum |
| --------------------- | ----: | ----: | ----------: | ---------: | ------------: | ----------------: |
| One pair              |     1 |     4 |   3,688,000 |    172,032 |             0 |         $9.736096 |
| Either arm, campaign  |   192 |   384 | 354,048,000 | 16,515,072 |             0 |       $934.665216 |
| Authoring phase       |   192 |   384 | 354,048,000 | 25,165,824 |             0 |       $960.617472 |
| Grounded-answer phase |   192 |   384 | 354,048,000 |  7,864,320 |             0 |       $908.712960 |
| Probe                 |    24 |    96 |  88,512,000 |  4,128,768 |             0 |       $233.666304 |
| Primary               |   168 |   672 | 619,584,000 | 28,901,376 |             0 |     $1,635.664128 |
| Campaign              |   192 |   768 | 708,096,000 | 33,030,144 |             0 | **$1,869.330432** |

The selected topology saves exactly $1,770.240000 of maximum exposure and is
51.37% of M9b.7's maximum when rounded upward to a basis point. Expected spend
remains `unknown-before-provider-usage-observations`.

The 24-pair probe, 168-pair primary allocation, equal family × scale weighting,
two-sided alpha 0.05, target power 0.80, exact conditional McNemar procedure,
and frozen probe gate remain unchanged. Achieved power remains unknown pending
the frozen probe; no retrospective effect size or population reduction is
introduced.

## Completion safety and threat model

The private controller simulation binds the verified M9b.7 report, selected
topology, schedule protocol, observed cap, population, pair, arm order, and
committed cost. A complete probe or primary phase must fit before its first
pair. A complete pair is charged before its first arm. A partial pair may resume
only the missing opposite arm. Concurrent reservations reject.

Ambiguous attempts retain their full reservation and halt as unscorable.
Verified overage retains the reservation plus verified excess and halts as
unscorable. Neither may redispatch. Re-signed changes to request counts, output
ceilings, arm envelopes, schedule, population, cap, settlement, or reports fail
complete zero-effect rederivation.

Before this topology could be activated, a separate package must bind a new
prospective campaign cap of exactly 1,869,330,432 USD µ, a fresh independently
verified provider hard-cap receipt, an implemented and reviewed retrieval-only
CodeMode profile, and the materialized schedule and request identities. Provider
spend controls remain defense in depth because delayed enforcement and overshoot
are not treated as per-request safety.

## Nonclaims

M9b.8 makes no model-quality, RLM-superiority, RAG-superiority,
compositional-generalization, expected-spend, production-readiness, or live
campaign claim. The synthetic byte harness is not an OpenAI tokenizer proof.
This AI-assisted review is not a professional security audit, penetration test,
or compliance assessment.
