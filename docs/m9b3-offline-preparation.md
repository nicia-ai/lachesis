# M9b.3 offline prospective preparation

Status: **offline preparation frozen; M9b remains NO-GO for corpus
materialization, provider integration, preregistration, and execution**.

M9b.3 freezes the contracts that must exist before a later M9c provider study
can be considered. It does not select credentials, implement an adapter, contact
a provider, construct a corpus, create schedule entries, register a protocol, or
authorize execution. The implementation is private to the generator package and
is identified by `lachesis-m9b3-offline-prospective-study-preparation@1.0.0`.

## Provider, model, serializer, tokenizer, and pricing binding

The preparation function accepts one independently trusted prospective profile
and binds all of these exact identities:

- provider and request-protocol versions;
- request-serializer version and schema digest;
- shared model identifier, revision, context window, output limit, and
  reasoning-disabled setting;
- exact tokenizer version, artifact digest, and offline conformance-vector
  digest for serialized requests and responses;
- pricing snapshot identity, source digest, and integer token rates; and
- domain-separated allocation and schedule seed commitments.

The preparation separately binds the frozen prompt bundle, M9b.1b discovery
protocol, M9b.2 measurement protocol, M9b.2d inference/report/split identities,
and the development evaluator identity. The development evaluator is explicitly
ineligible for a campaign; final gold and evaluator identities remain absent
until independent validation.

Provider, model, tokenizer, and pricing foreign keys must agree. The candidate
model must contain the largest individual frozen M9b.1 request. These checks
freeze a candidate profile; they are not evidence that the external service
implements it. Exact serializer/tokenizer conformance and capacity review remain
mandatory gates before an adapter may be built.

The same model identity is used by both arms. Authoring, execution, and
evaluation roles require distinct session objects, and sessions cannot be reused
across cases. Provider identity remains invisible to the model-authored program
request.

## Corpus-construction protocol

`lachesis-m9b3-natural-corpus-construction/1` requires fresh, natural-text,
substrate-neutral documents across the eight M9b.2 families and the 1x, 8x, and
32x strata. TypeGraph is not required. Both arms use one frozen deterministic
lexical retriever.

Every M9c case is one semantically independent problem. Entity, source, task
template, answer, supporting-fact wording, document, corpus, and semantic
contract lineage cannot overlap with development material or another primary
case. Same-problem scale clusters remain reserved for M9d. Gold consists of
snapshot-bound supporting facts, answer or abstention contracts, and exact
citation identities. Prompt-injection cases are mandatory.

Construction roles are separated into corpus constructor, gold annotator, and
blind split auditor. Construction may begin only after external preregistration
of this protocol. The complete corpus and gold are then independently frozen and
must pass `lachesis-m9b2d-split-disjointness-audit/5` before an adapter exists.
M9b.3 contains no documents, tasks, gold values, corpus snapshot, or final
corpus identity.

## Allocation and scheduling

The allocation has 24 equal family × scale cells:

- a 24-case protocol probe, one independent paired case per cell, excluded from
  the primary analysis; and
- a fixed 168-case primary population, seven independent paired cases per cell.

The primary population is fixed before primary execution and keeps equal 1/24
cell weights. The probe must independently support the preregistered power gate
at 168 cases; otherwise the study remains NO-GO. The practical ceiling remains
480 paired cases, but it is not authority to enlarge or adapt the primary sample
after outcomes are observed.

The schedule protocol is
`sha256-revealed-seed-case-digest-stratum-balanced-alternation/1`. M9b.3 binds a
seed commitment only. The seed is revealed after the complete corpus and gold
are frozen, then the paired arm order is balanced within strata and the exact
schedule digest is registered before any provider call. No seed reveal, case
assignment, schedule entry, or execution state exists in M9b.3.

## Matched budgets

Each arm retains the M9b.1 aggregate ceiling:

- 135,168 input tokens;
- 86,016 output tokens;
- zero reasoning tokens;
- 12,000 ms of model time;
- four searches, four reads, and 4,096 read bytes; and
- a cost ceiling derived with integer arithmetic from the bound pricing
  snapshot.

The discovered arm may make at most six model calls and the static arm at most
two, but all planning calls are included in the same aggregate token, time, and
cost ceiling. Every dispatch requires a maximum-use reservation followed by
actual-use reconciliation. The artifact also derives a conservative cost bound
for the 192 prepared probe-plus-primary pairs and both arms. It explicitly
grants no spending authority.

## Preregistration materials and gates

`lachesis-m9b3-preregistration-materials/1` is an offline draft, not an external
registration. It freezes the primary endpoint, one-sided exact conditional
McNemar test, alpha 0.05, target power 0.80, fixed 168-case allocation, primary
direction, required component digests, and required prospective supplement.

The supplement must bind the complete corpus and case inventory, gold and final
evaluator, seed reveals and exact schedule, and the protocol-probe discordance
gate. Any change after registration requires a new protocol identity and review;
it cannot be silently re-signed.

Before any provider call, all of the following remain required: registered
corpus supplement, frozen schedule, reviewed atomic persistence and zero-effect
resume, budget-ledger preflight, credential preflight that records no secrets,
and separate explicit live authorization. Identity drift, unreserved dispatch,
session reuse, split failure, schedule mismatch, budget excess, or registration
binding mismatch is a kill gate that preserves already sealed records.

## Current decision

M9b remains **NO-GO**. M9b.3 creates no corpus or gold, credentials, provider
adapter, provider call, schedule entries, execution state, external
preregistration, spending authority, live authorization, or superiority claim.
It is prospective architecture and scientific-design material, not a security
audit, penetration test, compliance assessment, or empirical result.
