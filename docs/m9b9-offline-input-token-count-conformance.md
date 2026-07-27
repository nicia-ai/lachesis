# M9b.9 offline Responses input-token count conformance

M9b.9 remains **NO-GO**. Its deterministic decision is
`token-count-pricing-unknown-no-go`.

This milestone implements and tests only a private, intercepted, zero-network
boundary for `POST /v1/responses/input_tokens`. It does not access credentials,
provider projects, a corpus, or a model. It does not authorize preregistration,
corpus materialization, a probe, or live execution.

## Pinned contract

The official token-counting guide says that the endpoint accepts the Responses
input shape and returns the exact count the model will receive, including
provider formatting and tool/schema structure. The pinned OpenAPI contract is
version 2.3.0 and returns `object: "response.input_tokens"` plus a nonnegative
integer `input_tokens` value.

The pinned primary sources do not state that the count operation is free and do
not publish a separate count-operation price. M9b.9 therefore records pricing as
unresolved. It reserves each count HTTP effect at the full 922,000-token
model-input ceiling, the highest input billing class, and the long-context
multiplier. This is a conservative liability, not a claim that the provider
actually bills the endpoint that way.

The installed `@ai-sdk/openai@4.0.15` package does not expose the count
operation. The private adapter consequently uses an injected intercepted fetch,
one POST, zero SDK retries, and zero controller retries. Its pinned source and
declaration aggregate digest is
`a543dc8f867af10291594fe151b98ec6e91dbede39e174fb6822d79a26771bc4`.

Primary sources:

- <https://developers.openai.com/api/docs/guides/token-counting>
- <https://developers.openai.com/api/docs/models/gpt-5.6-terra>
- <https://developers.openai.com/api/docs/pricing>
- <https://api.openai.com/v1/responses/input_tokens> (OpenAPI endpoint)

## Request and effect boundary

`lachesis-m9b9-single-source-request-binding/1` constructs one immutable
Responses request. The count and eventual inference bodies, canonical bytes,
digests, endpoints, and relationship digest derive from that single value.
Instructions, messages, tools, structured-output schema, model, provider
settings, and maximum output remain bound. There is no second reconstruction
path.

The private durable lifecycle is:

```text
prepared
  → count-reserved
  → count-dispatch-started
  → count-completed
  → inference-reserved
  → inference-dispatch-started
  → terminal
```

Count and inference are separate provider HTTP effects. A count is never called
a model or inference call. `dispatch-started` is durable before either
transport. A resumed started effect is charged conservatively, terminal,
unscorable, and never redispatched. Count rejection, drift, persistence failure,
or insufficient complete-campaign capacity produces zero inference/model calls.

Provider input usage equal to the count settles normally. Lower usage retains
both values without rewriting the count. Higher usage is an accounting overage,
settles actual usage, halts progression, and cannot redispatch. Missing usage
retains the full inference reservation.

## Frozen offline count fixtures and capacity

The prospective conformance maxima are frozen before any provider or corpus
work:

| Request class              | Counted input | Max output | Inference reservation |
| -------------------------- | ------------: | ---------: | --------------------: |
| Root program authoring     |        65,536 |     65,536 |             $1.187840 |
| Static query planning      |        65,536 |     65,536 |             $1.187840 |
| Discovered grounded answer |        32,768 |     20,480 |             $0.409600 |
| Static grounded answer     |        32,768 |     20,480 |             $0.409600 |

These are frozen intercepted conformance fixtures, not provider observations and
not post-hoc selected study counts. A future live boundary would still require
the exact count receipt for every final materialized request.

| Scope          | Count HTTP | Inference/model | Total HTTP | Exact-count inference | Unresolved count liability | Complete exposure |
| -------------- | ---------: | --------------: | ---------: | --------------------: | -------------------------: | ----------------: |
| Pair           |          4 |               4 |          8 |             $3.194880 |                 $23.050000 |        $26.244880 |
| Probe (24)     |         96 |              96 |        192 |            $76.677120 |                $553.200000 |       $629.877120 |
| Primary (168)  |        672 |             672 |      1,344 |           $536.739840 |              $3,872.400000 |     $4,409.139840 |
| Campaign (192) |        768 |             768 |      1,536 |           $613.416960 |              $4,425.600000 |     $5,039.016960 |

The exact-count inference component is $1,255.913472 below M9b.8's
$1,869.330432
exposure. Once the unresolved count-effect liability is included, complete
exposure is $3,169.686528 higher than M9b.8 and $4,921.052160 above the original
$117.964800 cap. The dominant cost driver is the deliberately conservative
unresolved count-effect price, followed by authoring output ceilings and the
four-call topology.

## Decision and next boundary

Full complete-study capacity does not pass. M9b.9 does not activate the M9b.8 or
M9b.7 cap alternatives. The next separately authorized scope, if desired, is a
narrow offline review that obtains an explicit authoritative count-endpoint
billing rule or prospectively replaces the count boundary with another proven,
priced exact-count mechanism. Until then there is no authorization for offline
preregistration preparation, corpus construction, credentials, provider calls,
registration, a probe, or live execution.

This is AI-assisted architecture and conformance evidence, not a professional
security audit, penetration test, compliance assessment, model-quality claim,
RLM/RAG superiority claim, or production-readiness claim.
