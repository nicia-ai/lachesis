# M9b.6 conservative pre-dispatch accounting

Status: **GO only for a separately reviewed offline campaign-preparation
milestone; M9b remains NO-GO for corpus construction, preregistration,
credentials, provider access, probes, or live execution**.

M9b.6 is private development infrastructure. It advances the effect ledger to
`lachesis-m9b4-offline-effect-ledger@1.2.0` with persisted wire revision 3, the
offline Responses adapter to
`lachesis-m9b5-openai-responses-offline-conformance@1.2.0`, and introduces
`lachesis-m9b6-conservative-pre-dispatch-accounting@1.0.0`. The earlier M9b.4
and M9b.5 artifacts remain historical records and are rejected by the new
schemas; they are not reinterpreted.

## Necessity review

Exact provider-side input tokenization is not part of the M9 estimand. The
paired endpoint asks whether a model-authored retrieval program achieves
semantically supported first-attempt success more often than a model-authored
static query under the same controlled envelope. Inclusion is fixed before
outcomes and never depends on reported token counts. Family and scale
stratification, the paired case identity, arm order, model identity, retrieval
and evidence bytes, call/output/time ceilings, and the external evaluator are
the scientific bindings.

The earlier exact-tokenizer requirement was a budget-safety mechanism. Neither
the official Responses contract nor pinned `@ai-sdk/openai@4.0.15` supplies a
versioned offline mechanism that reproduces provider-side Responses framing.
M9b.6 therefore does not create a tokenizer or relabel an estimate as a token
count.

The replacement is deliberately more conservative: every admitted call reserves
the pinned model's complete maximum input-token envelope, including the portion
that might be provider framing. The exact provider-visible JSON bytes are still
measured and bound, but they are not used as provider token counts. This can be
materially more expensive on paper and may make a future campaign impractical;
impractical capacity is a fail-closed budget outcome, not a reason to weaken the
reservation.

## Exact, conservative, and unknown quantities

| Quantity                                                                                            | Classification    | Enforcement                                                                                          |
| --------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| Complete provider request JSON                                                                      | exact             | Strict canonical JSON, SHA-256, and byte-for-byte M9b.5 replay                                       |
| Provider request size                                                                               | exact             | `TextEncoder` UTF-8 byte length before session creation                                              |
| Instructions, task/evidence text, response schema, model settings, reasoning effort, and output cap | exact             | Rebuilt from the frozen M9b.5 vector                                                                 |
| Input-token reservation                                                                             | conservative      | Full provider-documented model input maximum, not a byte-derived token estimate                      |
| Input billing class                                                                                 | conservative      | Highest uncached, cached-read, or cache-write rate, including the applicable long-context multiplier |
| Output/reasoning reservation                                                                        | conservative      | Frozen maximum output/reasoning ceilings and highest applicable tier rate                            |
| Provider-side hidden framing                                                                        | unknown           | Covered by the full model input maximum; never reported as locally known                             |
| Settled token classes and cost                                                                      | exact as reported | Complete M9b.5 usage classes, local tiered-price rederivation, and durable receipt                   |
| Provider hard-limit overshoot                                                                       | unknown           | Explicitly retained; official enforcement is not instantaneous                                       |

One-token-per-byte is not used. It would bound admitted text content only and
would not prove the size of undisclosed provider framing.

## Controller and financial boundary

Before session creation, the controller requires:

1. an opaque capability for a canonical, fresh, hard—not notification-only—
   project-cap observation;
2. an opaque capability for the prospectively frozen scientific envelope and arm
   order;
3. an exact M9b.5 request rederivation;
4. an M9b.4 reservation for the full model input maximum, maximum output,
   reasoning, wall time, and worst applicable price tier; and
5. sufficient remaining local campaign, provider, phase, arm, request-count, and
   observed project-cap capacity.

The hard-cap receipt binds provider, project, USD currency, configured cap,
tracked spend, remaining balance, observation and expiry times, verifier
artifact, canonical observation bytes/digest, and the documented enforcement
semantics. An offline serialized receipt is not live authority: the opaque
capability represents the future privileged verifier boundary and cannot be
reconstructed from caller JSON. M9b.6 does not access a project or credential.

OpenAI documents that a hard spend limit makes affected requests fail with
`429 insufficient_quota`, but also that enforcement is not instantaneous and
recorded spend can slightly exceed the configured value. M9b.6 therefore does
not claim that the configured provider number is an exact billing theorem. The
rigorous per-attempt financial bound comes from the full model input/output
maximum, zero automatic retries, one concurrent attempt, and the durable local
campaign ledger. The provider project cap is an independently enforced outer
stop control and defense in depth. A future activation must independently verify
the actual project receipt, exclusivity assumptions, pricing, and model limits;
this offline token does not do so.

## Settlement, ambiguity, and overage

Complete, internally consistent usage retains uncached, cached-read,
cache-write, output, reasoning, wall-time, raw receipt, and locally rederived
cost identities. Normal completion or typed provider failure releases the unused
reservation after durable settlement.

Missing, malformed, overlapping, contradictory, interrupted, or unreconciled
usage becomes `ambiguous`, retains the full reservation, is unscorable, stops
campaign progression, and is never redispatched. A complete provider receipt
outside any reserved input, output, reasoning, time, or cost dimension becomes
the distinct terminal `overage`. It retains the exact receipt, charges at least
the full reservation (or the larger reported cost), is unsuccessful, unscorable,
nonrepairable, and campaign-halting. Resume of either terminal state has zero
transport effects.

## Scientific matching

Exact cross-arm request-byte equality is inappropriate: the sequenced and static
arms necessarily have different public prompts and request sequences. M9b.6
instead freezes equal per-arm upper envelopes for canonical request bytes,
aggregate model calls, output tokens, reasoning effort, retrieval/evidence
bytes, model wall time, attempt count, and cost. The exact admitted bytes of
every call remain observable and bound. Provider-reported tokens and cost are
descriptive secondary measurements only; they cannot determine eligibility,
inclusion, primary success, or post-hoc exclusion.

## Threat model and kill gates

The hostile suite covers canonical ASCII and Unicode byte accounting, combining
characters, escapes and hostile-key text, noncanonical representations,
post-reservation request and identity changes, cap absence/softness/staleness
and cross-project drift, cap and safe-integer overflow, pricing-class choice,
missing and overlapping usage classes, provider overage, ambiguity, cap drift,
re-signed request/cap/ledger/settlement tampering, zero-effect replay,
scientific-envelope and arm-order substitution, concurrency, retry policy, and
old wire identities.

Any of the following retains M9b NO-GO: an estimate presented as exact,
unbounded model or price identity, absent/stale/soft cap evidence, insufficient
capacity, cap drift, arithmetic uncertainty, ambiguous usage, provider overage,
redispatch, post-outcome token filtering, unequal arm envelopes, public API or
package-version changes, or weakening of M9b.4 replay.

## Sources and nonclaims

The protocol review used only the official
[OpenAI spend-limit guide](https://developers.openai.com/api/docs/guides/spend-limits),
[production billing-limit guidance](https://developers.openai.com/api/docs/guides/production-best-practices#managing-billing-limits),
[GPT-5.6 Terra model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-terra),
[GPT-5.6 caching and usage guidance](https://developers.openai.com/api/docs/guides/latest-model),
the pinned provider package, and frozen Lachesis evidence.

The decision is `conservative-accounting-go-for-offline-campaign-preparation`.
It is not a campaign-readiness, exact-tokenizer, provider-entitlement, corpus,
gold, evaluator, preregistration, credential, spending, live-execution,
model-quality, retrieval-superiority, production-readiness, or
professional-security-audit claim.
