# M9b.11 shadow-pricing campaign freeze

Decision: `shadow-priced-campaign-go-for-offline-preregistration-preparation`

This append-only, entirely offline amendment is based on commit
`ff039c63207a91fda896ef99fd88144c51269e4a`. It supersedes, but does not rewrite,
the conditional $400 cap recommendation. It grants authority only to prepare a
separately reviewed offline preregistration package.

## Public-documentation finding

The frozen source artifact records the public token-counting guide, input-token
count API reference, and Responses API reference as retrieved on 2026-07-27.
Those sources establish that `POST /v1/responses/input_tokens` returns the exact
model-visible input count, includes structural formatting tokens, is intended
for context validation and cost estimation, and returns `object` plus
`input_tokens`.

The cited material does not publish an explicit endpoint price, an explicit $0
statement, a failure-billing matrix, a cache classification, or a service-tier
rule for the counting operation. Public documentation therefore suggests free
operational behavior but does not establish it contractually. M9b.11 does not
state or imply that counting is confirmed free.

## Prospective shadow accounting

Every future count request reserves its request class's full input ceiling at
the frozen highest applicable input rate: $3.125000 per million tokens. On an
exact successful count, settlement uses ceiling division at the request level,
retains the resulting shadow cost, releases only the unused reservation, and
passes that same exact count to inference reservation preparation. The shadow
charge remains separate from provider-reported inference billing and is kept
even if the provider eventually reports no count charge.

Successful prerecorded conformance accepts only the strict
`response.input_tokens` object with exactly `object` and `input_tokens`, and
binds its canonical bytes and digest. Added usage, cost, cache, or billing
metadata therefore fails the frozen response boundary.

The prospective lifecycle binds the campaign, pair, arm, phase, call index,
request class, exact request digest, moderate envelope, pricing identity,
hard-cap policy, and capacity. Reservation persistence precedes any future
dispatch. This milestone contains no dispatch authority: its synthetic dispatch
marker explicitly records zero network, credential, count, inference, or
transport effects.

Timeout, cancellation, interrupted transport, malformed response, possible
dispatch without a durable response, or persistence failure after a possible
effect consumes the full class reservation. Such an attempt is terminally
ambiguous, authorizes no inference or retry, and halts its pair and campaign.

## Frozen capacity

| Scope    | Pairs | Count requests | Inference calls | Provider HTTP |   Inference | Count shadow | Operational |
| -------- | ----: | -------------: | --------------: | ------------: | ----------: | -----------: | ----------: |
| Pair     |     1 |              4 |               4 |             8 |   $1.781760 |    $0.614400 |   $2.396160 |
| Probe    |    24 |             96 |              96 |           192 |  $42.762240 |   $14.745600 |  $57.507840 |
| Primary  |   168 |            672 |             672 |         1,344 | $299.335680 |  $103.219200 | $402.554880 |
| Campaign |   192 |            768 |             768 |         1,536 | $342.097920 |  $117.964800 | $460.062720 |

The selected envelope is `moderate`. The prospective provider hard cap is
$500.000000, leaving $39.937280 of headroom above the conservative operational
ceiling. Retries remain zero and campaign concurrency remains one. Neither the
cap nor the campaign is activated.

## Kill gates and residual risk

A new prospective amendment is mandatory if the count response contract gains
inconsistent usage, cost, cache, or billing fields; an authoritative source
publishes a nonzero or structurally different rate; observed spend exceeds the
shadow reservation; a fixed fee appears; a tier, region, long-context, or cache
multiplier exceeds the rule; hard-cap enforcement cannot be independently
verified; initial project spend is nonzero; or provider pricing/model limits
drift. Existing records are never reinterpreted.

Provider spend enforcement may lag, and the controller cannot guarantee coverage
of arbitrary undocumented fees. Practical exposure is bounded by concurrency
one, zero retries, per-effect persistence, shadow reservations, and terminal
kill gates. Live activation would require explicit user acceptance of this
residual risk, an exclusively dedicated project, and exactly zero initial spend.

## Future count-only probe

The frozen but unauthorized probe uses a fresh zero-spend project with an
independently verified $500 cap. It permits one synthetic count-only request for
each of the four frozen request classes, at most four count requests total, no
inference, no retry, and concurrency one. Every request requires a prior shadow
reservation, exact identities, and durable response and latency evidence. A
frozen 24-hour observation interval precedes project-spend reconciliation.
Charge or ambiguity stops the probe immediately.

Even a successful probe establishes only observed operational behavior, never a
contractual pricing guarantee. It requires separate authorization and must pass
before corpus materialization or study execution.

## Scientific and preregistration boundary

The selected M9b.8/M9b.10c four-call paired topology, GPT-5.6 Terra, reasoning
effort, moderate envelope, 24-pair probe, 168-pair primary population,
family-by-scale allocation, paired estimand, exact one-sided McNemar analysis,
probe gate, retrieval limits, zero retries, concurrency one, and complete-pair
and complete-population gating are unchanged.

Prospective language must disclose the unresolved pricing classification, make
no contractual-free claim, retain conservative shadow charges, state the
inactive $500 cap and frozen kill gates, require the count-only probe before
inference, report incomplete/ambiguous/halted records, and prohibit post-hoc
budget, population, envelope, or retry changes.

## Verification

Node v24.18.0 and pnpm 10.33.0 were used. The focused M9 suite passed 303/303;
the complete serial repository and coverage suites passed 746/746. Coverage was
90.01% statements, 80.99% branches, 97.45% functions, and 93.70% lines. Strict
typecheck, lint, build, formatting, Node/Workers smokes, seven examples, the
six-test CLI contract, descriptive load smoke, source-safety, public-API,
release-checksum, historical M8, and `git diff --check` gates passed.

The historical M8b stage-4 command passed its 63 focused tests, then its offline
packed-consumer step failed because the expected
`nicia-ai-lachesis-cli-0.1.0.tgz` fixture was absent. M9b.11 changed neither
that script nor the historical package fixture.

The public generator facade remains at 317 exports with digest
`bf6a0476cbf3643705da8133e3173cbce771d765c979a7b198b586e2b6bda830`. Three
package packs were byte-identical before the expected frozen-alpha digest
mismatch. The historical M7c current-document binding mismatch remains
pre-existing. M9b.11 changes neither historical artifact.

Untracked `.DS_Store` and `paper/` remained untouched.

## Authority

M9b remains NO-GO for external registration, corpus materialization, projects,
credentials, provider or network access, count-probe execution, inference,
campaign activation, publication, release, and push. No provider or network call
occurred. No public export or package version changed. This result makes no
model-quality, RLM/RAG superiority, compositional-generalization,
natural-corpus, pricing-guarantee, production-readiness, professional-security,
penetration-test, or compliance claim.
