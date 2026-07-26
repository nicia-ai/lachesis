# Prospective M9b retrieval study outline

Status: **M9b.2 offline scientific-measurement design only; M9b is not
materialized or authorized**.

M9b would compare matched static RAG and retrieval CodeMode on fresh natural
external corpora. M9a does not create a final corpus, campaign, preregistration,
provider identity, credential preflight, executable live state, or authorization
text.

## M9b.2 offline scientific-measurement design

The private `lachesis-m9b2-offline-scientific-measurement@1.0.0` protocol
freezes the development-only measurement rules without changing M9a, M9b.0, or
M9b.1b's protocol identities and without adding a generator-facade export. Its
content-addressed design digest covers the task taxonomy, scale taxonomy, answer
normalization, semantic-support rule, primary and secondary endpoints, evaluator
reliability gate, prospective power method, split policy, and explicit absence
of live authority. It does not cover or freeze a final corpus, provider, model,
campaign, schedule, or preregistration.

The offline development fixture contains 24 substrate-neutral natural-document
cases: lookup, join, multi-hop, temporal/retraction, contradiction, aggregation,
insufficient-evidence, and prompt-injection tasks crossed with 1x, 8x, and 32x
distractor scales. Within each family, the public task, relevant prose, solution
strategy, accepted response, and evidence contract stay fixed; only unrelated
background-document volume changes. The corpus/task fixture and hidden answer
and evidence expectations live in separate modules. These are development
fixtures, not the eventual held-out corpus. Preparing them uses M9a's immutable,
content-addressed corpus implementation, but no final corpus identity is frozen.

Each prepared development case derives separate case, normalized-task,
ID-independent document-content, whole-corpus-content, and semantic-contract
identities. The prospective split audit rejects overlap on any scalar dimension,
rejects reuse of even one development document, and rejects duplicate case
identities within a split. The eventual held-out namespace is reserved but has
no materialized cases or identities. Distinct names or versions alone therefore
cannot disguise reused task, corpus, document, or evaluator content.

The `lachesis.m9b2.offline-arm-blind-evaluator@1.0.0-development` evaluator
implements the existing M9b.1 external-evaluator interface. It is bound to one
case and sees only that case's public task and submitted citation-confined
answer; its callable interface has no arm label. Exact NFC-bound snapshot chunk
identities are checked against the prepared corpus. A submitted answer is
semantically supported only when:

- its NFKC, lowercased, whitespace-collapsed, terminal-punctuation-stripped form
  exactly matches a frozen accepted answer or abstention;
- the observed answer/abstention kind is correct;
- citations are exact chunks from the bound corpus snapshot;
- at least one complete required-evidence set is cited;
- every cited document belongs to the allowed support set; and
- an abstention has no citations.

This is a deterministic categorical evaluator for these fixtures, not a claim
that string normalization solves open-ended semantic evaluation. Reliability
validation requires 100% expected fixture agreement, 100% repeated-output
identity, and coverage of all eight task families. The current 16-fixture
positive/hostile suite passes both 100% gates; changing an expected outcome
causes the advancement result to stop as unreliable. Reports replay from their
fixtures and reject altered content or digests.

The primary endpoint is frozen as
`first-attempt-semantically-supported-end-to-end-success`. It is true only when
authoring, first compilation, execution, and external evaluation all complete on
the first attempt and the evaluator reports semantic support. A compile
rejection or any earlier terminal failure is therefore a primary failure, not a
missing observation. Secondary extraction separately records retrieved-evidence
recall and precision, citation validity, correct abstention, bytes read,
retrieval calls, model calls, compilation acceptance, input/output/reasoning
tokens, latency, and cost. A real deterministic M9a run validates this
measurement path offline.

Prospective paired power uses exact one-sided conditional McNemar scenario
analysis with family alpha 0.05, target power 0.80, and a practical ceiling of
480 paired cases. It does not treat mock-fixture outcomes as a model effect
estimate. Under an explicitly assumed 16% discovered-only versus 6% static-only
discordance pattern, the method requires 146 pairs and has 99.90% power at the
ceiling. Under a 12% versus 8% pattern, power is only 58.58% at the ceiling and
the required sample is recorded as unknown beyond that ceiling. An 8% versus 8%
no-effect scenario has no positive-effect sample-size result. Empirical power
remains `unknown` because no offline development model discordance estimate
exists.

M9b.2 therefore ends with **M9b NO-GO**. The evaluator fixture gate passes, but
practical power is assumption-sensitive and fails under the modest scenario; the
final held-out corpus is absent; and provider request/tokenizer/pricing
boundaries are not frozen. This milestone creates no provider adapter, provider
call, corpus campaign, preregistration, final corpus identity, public API,
package version, release artifact, or superiority claim. It is AI-assisted
architecture and measurement work, not a professional security audit,
penetration test, compliance assessment, or scientific result.

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

M9b.0 still executes a caller-supplied treatment source. It therefore remains a
protocol-hardening substrate rather than program-discovery evidence.

## M9b.1b offline failed-request profile binding

The internal `lachesis-m9b1b-offline-program-discovery@1.0.0` protocol and
`lachesis-m9b1b-atomic-arm-store/1` identity supersede M9b.1a persisted records.
M9b.0's frozen protocol identity is unchanged.

M9b.1b validates every retained execution-request sequence against its frozen
arm profile after validating each request's canonical M9b.0 identity. The static
control may retain at most one request: an answer request using the exact
one-shot reservation. It cannot retain a decomposition request or a leaf
reservation. The discovered arm may retain at most one root-reserved
decomposition request followed by at most four leaf-reserved answer requests;
one-shot reservations, repeated decomposition, and decomposition after an answer
all fail closed.

The contextual sequence check runs during store load, store save, controller
resume, and successful request-to-transcript matching. Execution-failure records
pass through the same validation before they can resume as terminal. The 33-test
focused suite includes equivalent successful and failed-record mutations for
reservation swapping, fully canonical cross-profile decomposition, repeated or
reordered decomposition, request-count ceilings, and exact zero-effect resume.
These remain offline development regressions, not a professional security audit,
penetration test, or compliance assessment.

## M9b.1a offline persistence and isolation correction

The internal `lachesis-m9b1a-offline-program-discovery@1.0.0` protocol retains
the M9b.1 program-discovery boundary and advances its persisted wire identity.
The atomic store identity is likewise advanced to
`lachesis-m9b1a-atomic-arm-store/1`; old M9b.1 records are not silently
reinterpreted. This remains a private generator module and is not exported by
the package facade.

M9b.1a reuses one internal M9b.0 execution-request validator at store load,
store save, controller resume, and request-to-transcript matching. It
reconstructs the frozen prompt, response schema, reasoning-disabled setting,
phase, canonical request bytes and digest, exact byte-token input accounting,
and the permitted pre-dispatch reservation. A terminal execution failure does
not bypass this validation.

Each arm now persists the frozen execution order and evaluator identity in
addition to its task, corpus snapshot, model, protocol, and matched-envelope
identities. Those fields independently recompute the comparison digest. Both
successful and failed evaluation outcomes retain a typed evaluation-attempt
receipt: evaluator identity plus exact canonical evaluator input bytes and
digest, with canonical output for success or the typed retained failure payload
for failure. Resume validates the receipt against zero-effect replay and never
invokes the evaluator.

One object-identity set covers every authoring, execution, and evaluator
session. Reuse within or across roles fails closed, including hybrid objects.
The evaluator identity is required to differ from the arm model identity; this
is an explicit role-separation rule, not merely a factory convention. The
controller also races each authoring call against the frozen 2,000 ms planning
ceiling, aborts the supplied authoring signal on expiry, and records a terminal
first-attempt failure even when a mock session ignores cancellation. Existing
execution timeouts are unchanged.

The focused M9b.1a discovery suite contains 31 tests. It covers both successful
and execution-failure request mutation matrices, comparison-order and evaluator
re-keying, success/failure evaluation receipts, cross-role object reuse,
controller-enforced authoring timeout, and exact zero-effect resume. These are
offline development regressions, not a professional security audit, penetration
test, or compliance assessment.

## M9b.1 program-discovery boundary

The original M9b.1 vertical slice adds the missing first-attempt discovery
boundary without changing M2, M9a, or M9b.0's protocol identities. The root
authoring model receives exactly a public task, frozen grammar, public
capability descriptions, and resource limits. Its canonical request has no
corpus identity or contents, search/read results, hidden answers, expected
citations, evaluator data, model or provider identity, or arm label.

The discovered arm must return one source string. That source is immediately
passed to M9a's existing closed-AST compiler. A first-attempt rejection retains
the exact compiler diagnostics and digest and is terminal; no retrieval,
execution-model, leaf-model, or evaluator session is created. There is no repair
attempt, `eval`, `Function`, `vm`, module loading, child process, ordinary
JavaScript execution, or new executable wire value. The capability catalog and
`boundedFix` invariants remain those of M9a.

The static control receives an independent matched root planning call and must
return exactly one NFC search query of at most 512 UTF-8 bytes. Its fixed,
closed-AST one-shot program receives that query as its retrieval execution
input. The shared public task remains the authoring and external-evaluator task;
the query identity and the control replay task are cross-bound in the terminal
record. This keeps the planner-authored query operative without treating an
untyped source literal as a nominal task value.

Each arm has the same aggregate ceiling: 135,168 input reference tokens, 86,016
output reference tokens, zero reasoning tokens, zero monetary cost, and 12,000
ms of model time. Those totals include one pre-dispatch-reserved authoring or
query-planning call plus the existing matched M9b.0 execution envelope. Exact
canonical request and response byte usage is reconciled after every planning
call. Runtime root and leaf calls continue through M9b.0's canonical request
adapter and remain distinguishable from search and read events.

M9b.1a requires distinct authoring, execution, and evaluator session factories
for the two arms and accepts either frozen counterbalanced order. It uses the
same model identity, M9a lexical retriever, evidence/read limits, leaf boundary,
citation-confinement submission validator, and external-evaluator interface in
both arms. The evaluator is an offline injected interface only; M9b.1a does not
freeze evaluator data or interpret its output as proof of semantic support.

Authoring requests and outputs, source or query identities, compilation
receipts, runtime model requests, execution transcripts, private replay
artifacts, and evaluator input/output receipts are canonicalized, digested, and
cross-validated. Arms persist independent immutable terminal records through an
atomic compare-and-swap store. Resume recompiles locally and replays successful
runs without authoring, corpus, model, retrieval, leaf, or evaluator effects;
only a missing arm runs after an asymmetric failure.

The hostile offline suite covers request-boundary non-disclosure, forbidden
capabilities, malformed and oversized source, attempted ordinary-realm access,
counterbalanced state isolation, atomic asymmetric failure, zero-effect resume,
and re-digested request/source/query/compilation/run/replay alterations. These
are development regressions, not a professional security audit, penetration
test, or compliance assessment.

## Candidate arms

1. Static RAG: one task-derived query, one bounded top-k result, bounded reads,
   one answer call, and the shared external evaluator.
2. CodeMode RLM: a model-authored bounded retrieval program using the same
   search, read, leaf boundary, external evaluator, and total envelope.

Iterative non-CodeMode retrieval could be a later diagnostic arm. Calcified
strategy reuse belongs in a separate future study so discovery and reuse are not
confounded.

## Workloads

The M9b.2 development fixtures cover lookup, joins, multi-hop resolution,
temporal changes and retractions, contradictions, exhaustive aggregation,
insufficient evidence, and document-embedded prompt injection at approximately
1x, 8x, and 32x scale while preserving the solution strategy. Any eventual fresh
held-out corpus must satisfy the multidimensional split-disjointness audit and
must not reuse these development tasks, content, or semantic contracts.

## Outcomes

M9a's submission endpoint establishes citation confinement only. M9b.2 freezes
the development evaluator rules, task-level gold shape, support criteria, and
scoring policy external to both arms. It also freezes the prospective primary
endpoint and secondary metric definitions described above. An eventual campaign
would still need a separately frozen final evaluator/corpus identity and an
independent reliability review; the development evaluator identity is not a
campaign identity.

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

M9b.1b has passed its offline architecture/security review. M9b remains
**NO-GO** after M9b.2 because there is no empirical development discordance
estimate, the modest power scenario exceeds the practical case ceiling, and the
fresh final corpus, final external evaluator identity, provider/model/prompt/
tokenizer/pricing identities, randomized schedule, operational budget,
preregistration, and explicit live authorization are not frozen or independently
reviewed. M9b.2 does not authorize provider adapters, a held-out corpus
campaign, or live execution.
