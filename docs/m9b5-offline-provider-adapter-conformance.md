# M9b.5 offline OpenAI Responses adapter conformance

Status: **request/transport/response conformance passes offline; exact tokenizer
conformance does not; M9b remains NO-GO**.

M9b.5 adds one private provider-specific boundary in
`@nicia-ai/lachesis-generator-ai-sdk`. Its protocol identity is
`lachesis-m9b5-openai-responses-offline-conformance@1.1.0`. It is not exported
from the package entry point and does not change a stable facade, package
version, or release artifact. The private M9b.4 ledger advances to 1.1.0 with
revision-2 persisted identities because cache-aware usage changes its private
wire semantics; accepted 1.0.0 artifacts are not reinterpreted.

This milestone used the real installed `@ai-sdk/openai@4.0.15` Responses model
through an intercepted `fetch`. It made no network request, read no environment
credential, and used only an in-memory synthetic key. The supporting
machine-readable record is
`docs/m9b5-offline-provider-adapter-conformance.json`; independent file hashes
are in `docs/m9b5-offline-provider-adapter-conformance.sha256`.

## Reviewed contract and installed artifacts

The current-source review used the official OpenAI Responses create reference
and its OpenAPI operation:

- <https://developers.openai.com/api/reference/resources/responses/methods/create>
- <https://api.openai.com/v1/responses> (OpenAPI `2.3.0`, documentation/schema
  inspection only; no API request was made by the implementation or tests)

The pinned SDK declarations and implementation were reviewed directly. The
adapter calls the provider model's `LanguageModelV4.doGenerate` primitive, not
the high-level retrying generation helper. The frozen SDK retry limit and the
M9b.4 controller retry limit are both zero.

Every request has exactly these provider-visible fields:

- revision-pinned `model`;
- one user `input` containing only the request's public input;
- frozen `instructions`;
- strict named `text.format` JSON Schema;
- `max_output_tokens`;
- `reasoning.effort: "none"`;
- `store: false`;
- `service_tier: "default"`;
- `truncation: "disabled"`; and
- the SDK-required encrypted-reasoning include associated with a non-stored
  reasoning-model request.

Tools, background mode, continuation, metadata, streaming, and polling are
absent. The adapter canonicalizes the SDK-emitted JSON at the intercepted fetch
boundary and requires byte equality with the bound provider request before the
offline transport sees it. Request-class, arm, phase, comparison, call index,
provider, model, serializer, tokenizer, pricing, schema, and request identities
remain outside model-visible content. The four frozen classes are root program
authoring, static one-shot query planning, discovered-program leaf reasoning,
and static answer generation.

An M9b.4 attempt ID includes the request digest, so embedding that final ID in
its own request would be circular. M9b.5 instead binds the complete M9b.4
attempt coordinate in the canonical request and binds the final derived attempt
ID when the private session is created after `dispatch-started`. M9b.4 then
cross-binds both through its unchanged attempt identity derivation.

## Raw response and usage boundary

The adapter validates the captured raw response independently of the SDK's
normalized result. It strictly projects only decision-relevant fields, so valid
pinned-contract metadata such as `service_tier`, `reasoning`, message `phase`,
output-text `logprobs`, and extended usage details cannot invalidate an
otherwise conforming response. A success still requires a completed response,
exact returned model, response ID, exactly one assistant message, exactly one
`output_text`, no unexpected output item, strict non-transforming structured
JSON, the exact request-class output schema, and complete integer usage.

Usage retains total input, cached-read input, cache-write input, output, total,
and reasoning-token fields. Cache classes must be present, disjoint, and within
total input; reasoning tokens must be zero. Cost is recomputed from uncached,
cached-read, cache-write, and output rates using M9b.4's integer ceiling rule
and frozen pricing identity. The conservative reservation prices every input
token at the highest frozen input-class rate. Locally measured monotonic elapsed
time is the only duration accepted.

The response ID, returned model, class, and structured output are retained in
the M9b.4 completed output receipt. Missing, malformed, duplicate, hostile-key,
wrong-model, tool-bearing, usage-incomplete, reasoning-bearing, or otherwise
indeterminate responses throw at the transport boundary and therefore become
M9b.4 ambiguity. A non-completed response becomes a typed M9b.4 failure only
when its complete usage and determinate terminal status are present. Usage above
reservation remains ambiguity under unchanged M9b.4 validation. No usage is
invented, estimated, repaired, or copied from a later request.

## Cancellation, retry, and effect-ledger composition

An already-aborted controller signal causes zero fetches. Mid-flight
cancellation and the adapter timeout reach the sole intercepted fetch and cause
no retry. The synthetic credential appears only in the in-memory Authorization
header observed by the interception; it is absent from request vectors,
receipts, reports, errors, and durable ledger content.

Private structural tests compose the adapter with the cache-aware M9b.4 source
module without a public export. Reservation and `dispatch-started` persist
before session creation and fetch. Valid usage settles exactly. Malformed and
over-reservation responses are conservatively charged ambiguity. Post-reserve
identity drift is rejected before fetch. A response followed by terminal-write
failure resumes as ambiguity with zero session creation or redispatch, and
repeated resume remains effect-free. M9b.4's accepted concurrency, chain,
budget, and persistence hostile tests remain part of the focused matrix.

## Exact tokenizer stop gate

The installed provider package serializes Requests and consumes
provider-reported usage, but exposes no versioned offline mechanism that
reproduces the provider's exact Responses input count, including server-side
request framing. The official Responses create contract likewise specifies usage
and an online input-token-count operation, not an independently reproducible
offline framing counter.

Generic `tiktoken`, UTF-8 bytes, intercepted request-body bytes, synthetic
counts, and post-dispatch reported usage do not satisfy the frozen exact-count
boundary. The online count operation would itself be a separately reserved
provider effect and is outside this milestone. Therefore the recorded result is
`adapter-conformance-pass-tokenizer-no-go`. The synthetic ten-token value in the
M9b.4 composition fixture tests only structural receipt reconciliation and is
explicitly not tokenizer evidence.

## Decision and nonclaims

- **PASS:** offline request construction, canonical transport bytes, single
  invocation, zero retry, cancellation propagation, decision-relevant raw
  response validation, cache-aware usage/pricing mapping, identity drift
  rejection, and private M9b.4 structural composition.
- **NO-GO:** exact offline tokenizer conformance and consequently campaign-ready
  adapter status.
- **NO-GO:** corpus materialization, credentials, provider calls, external
  preregistration, campaign execution, spending, M9 claims, or superiority
  claims.

The next step is protocol review of the token-accounting blocker, not corpus or
live work. An online count request cannot be introduced without a new protocol,
attempt accounting, capacity analysis, and explicit authorization.

This AI-assisted architecture and security work is not a professional security
audit, penetration test, compliance assessment, or evidence of provider
entitlement.
