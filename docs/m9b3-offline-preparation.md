# M9b.3d offline artifact-to-effect correction

Status: **offline preparation frozen; M9b remains NO-GO for corpus
materialization, provider integration, preregistration, and execution**.

M9b.3d supersedes the affected private M9b.3c identities and freezes the
contracts that must exist before a later M9c provider study can be considered.
It does not select credentials, implement an adapter, contact a provider,
construct a corpus, create schedule entries, register a protocol, or authorize
execution. The implementation is private to the generator package and is
identified by `lachesis-m9b3d-offline-prospective-study-preparation@1.0.0`.
Existing M9b.3a, M9b.3b, and M9b.3c artifacts retain their original meaning and
are not reinterpreted.

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
- a schedule-seed commitment with an exact opening and domain-separated hash
  frame.

The preparation separately binds the frozen prompt bundle, M9b.1b discovery
protocol, M9b.2 measurement protocol, M9b.2d inference/report/split identities,
and the development evaluator identity. It also accepts an independently trusted
historical-development baseline containing the exact reviewed M9b.2 development
suite and complete-inventory digests. That baseline is bound into the
preparation, allocation, preregistration materials, and outer preparation
digest. A different valid 24-case suite is therefore a decoy, not a substitute.

The development evaluator is explicitly ineligible for a campaign. A separate
content-addressed prospective supplement is required to freeze the independently
validated final deterministic evaluator's implementation artifact, output
schema, and validation-record digests. Labels alone are insufficient. Every
M9b.3d terminal measurement carries those complete identities and binds them to
the retained evaluation-attempt digest. A successful evaluator output must also
carry the same exact identities; a same-label wrapper without them rejects.

Final probe gold is no longer a caller-authored artifact digest. The private
measurement layer derives an opaque token from the exact prepared suite's hidden
expectations, snapshot identities, case inventory, and suite digest. The
supplement accepts only the content-addressed identity revealed by that token,
and measurement rederivation requires the same token object and suite. Neither
the token nor its public identity reveals answers or expectations. The
supplement grants no corpus, adapter, provider-call, preregistration, or
execution authority.

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

`lachesis-m9b3a-natural-corpus-construction/1` requires fresh, natural-text,
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
M9b.3d contains no documents, tasks, gold values, corpus snapshot, or final
corpus identity.

Scale is measured by the M9a snapshot's `corpusBytes`: the sum of canonical NFC
document-text UTF-8 bytes. Inclusive nonoverlapping acceptance ranges are:

| Stratum |  Target | Accepted bytes |
| ------- | ------: | -------------: |
| 1x      |   4,096 |    3,072–5,120 |
| 8x      |  32,768 |  24,576–40,960 |
| 32x     | 131,072 | 98,304–163,840 |

`lachesis-m9b3a-corpus-scale-validation/1` rejects an out-of-range or
mislabelled snapshot before population binding. These sizes remain below M9a's
fixed 512 KiB corpus maximum and change corpus scale without making TypeGraph or
another substrate mandatory.

## Allocation and scheduling

The allocation has 24 equal family × scale cells:

- a 24-case protocol probe, one independent paired case per cell, excluded from
  the primary analysis; and
- a fixed 168-case primary population, seven independent paired cases per cell.

After corpus construction, the private
`lachesis-m9b3d-prospective-population-binding/1` function consumes the exact
historical M9b.2 development suite token and the separate probe and primary
suite tokens. It derives each complete case inventory, suite and inventory
digests, snapshot, scale-validation, and semantic-problem identities. It
requires exactly 24 development cases, 24 probe cases, and 168 primary cases.
Probe and primary have respectively one and seven semantically independent cases
in every cell; the existing development suite may retain its development-only
scale clusters. Case identities are unique across all three populations and
prospective semantic problems are unique across probe and primary. Exact M9b.2d
audits must pass for development↔probe, development↔primary, and probe↔primary,
and all three audit digests are bound into the population record. Before those
audits, the supplied development token must reproduce both historical suite and
inventory digests already frozen in the preparation. A caller cannot substitute
a clean decoy, select, or omit case IDs. The primary report must consume exactly
the bound primary suite token, preserving M9b.2d full-suite reporting.

The primary population is fixed before primary execution and keeps equal 1/24
cell weights. The probe must pass the exact conservative gate defined below;
otherwise the study remains NO-GO. The practical ceiling remains 480 paired
cases, but it is not authority to enlarge or adapt the primary sample after
outcomes are observed.

The schedule protocol is `lachesis-m9b3d-paired-counterbalance-schedule/1`.
M9b.3d binds a SHA-256 commitment to a 256-bit seed reveal. After corpus and
gold freeze, the materializer verifies the commitment and hashes canonical JSON
frames containing the protocol, seed, population, complete suite/inventory
identities, case, semantic-problem and snapshot identities, family, and scale.
Cells and cases are sorted by those hashes with ascending identifier code-unit
order as the explicit collision tie-break. The 24 cells are hash-sorted and
alternate their leading arm; cases inside each seven-case primary cell alternate
from that leader. This produces twelve cells led by each arm and 84 first
executions per arm. A separate hash orders execution. All probe cases precede
the advancement decision; primary execution is forbidden unless that decision
passes. The verifier rederives the complete schedule from the opaque populations
and trusted preparation. No seed reveal, case assignment, schedule entry, or
execution state is created by the current M9b.3d preparation artifact.

## Exact probe advancement rule

`lachesis-m9b3d-probe-advancement-gate/1` consumes the complete set of 24 paired
verification contexts, not aggregate counts. Each context contains opaque M9b.1b
terminal-record verification tokens for the discovered and static arms. The gate
verifies the prospective supplement, then rederives both terminal measurements
through the distinct
`lachesis-m9b3d-artifact-bound-terminal-measurement-record/1` boundary. It
requires the supplement's complete evaluator artifact, output-schema, and
validation-record identities and the opaque gold token derived from the exact
probe suite. Successful scores are locally recomputed from that token's scoring
source and must reproduce the artifact-bound evaluator output. Evaluation
failures retain an artifact/gold binding to the exact failed attempt; records
that never reached evaluation have no fabricated attempt receipt. The gate also
requires exact probe suite and case coverage, opposite arm identities, the
scheduled order, and matching comparison, task, snapshot, model, endpoint,
program, measurement-record, and source-arm identities. It derives all four
outcome cells exclusively from the verified `primary.success` values.

The decision binds the preparation, prospective supplement, derived gold
artifact and scoring-source identity, complete evaluator artifact, three-way
population record, probe suite and inventory, materialized schedule, endpoint,
model, final evaluator, all 48 source measurement and arm-record digests, and a
canonical measurement-inventory digest. Verification repeats the complete
derivation and invokes no model, retriever, evaluator, corpus constructor, or
persistence effect. Caller-authored counts cannot produce a decision.

The gate estimates the discordance rate and the conditional discovered-win rate.
For each parameter it computes a one-sided Clopper–Pearson lower bound by
80-step exact-binomial-tail inversion at component alpha 0.025; Bonferroni gives
at least 95% joint coverage.

Those two lower bounds are inserted into the same one-sided exact conditional
McNemar power calculation used by M9b.2. Projected power is evaluated at the
fixed 168 primary pairs and alpha 0.05, floored to integer basis points, and
must be at least 8,000. Zero discordances, a conditional lower bound at or below
0.5, or lower-bound power below 8,000 is an explicit NO-GO. Invalid or
incomplete measurement inventories reject. The decision and its exact inputs are
content-addressed and fully rederived; no threshold or estimator may be chosen
after the probe.

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

The complete-effects budget requires the campaign evaluator to be deterministic,
local, arm-blind, and to make zero provider calls, consume zero model tokens,
and incur zero provider cost. Its final identity is absent from the initial
preparation and must be frozen by the separately verified prospective supplement
after independent validation. SDK transport retries and controller dispatch
retries are both exactly zero: one logical request permits one provider attempt,
and the first dispatch failure is terminal. At most eight logical requests and
provider attempts exist per pair, or 1,536 across all 192 prepared pairs.
Consequently the model-envelope total is also the complete provider-attempt cost
ceiling; evaluator or retry effects cannot be added without a new protocol
identity and review.

## Preregistration materials and gates

`lachesis-m9b3d-preregistration-materials/1` is an offline draft, not an
external registration. It freezes the primary endpoint, one-sided exact
conditional McNemar test, alpha 0.05, target power 0.80, fixed 168-case
allocation, primary direction, required component digests, and required
prospective supplement.

The preparation already binds the independently trusted historical development
suite and complete-inventory digests. The prospective supplement separately
binds the exact opaque probe-gold scoring source and independently reviewed
evaluator artifact, output schema, and validation receipt without granting
authority. Eventual registration must also bind the complete probe and primary
suite and case inventories, every snapshot and scale-validation digest, all
three pairwise M9b.2d split audits, seed reveal and exact schedule, and the
protocol-probe measurement inventory and discordance gate. Any change after
registration requires a new protocol identity and review; it cannot be silently
re-signed.

Before any provider call, all of the following remain required: registered
corpus supplement, frozen schedule, reviewed atomic persistence and zero-effect
resume, budget-ledger preflight, credential preflight that records no secrets,
and separate explicit live authorization. Identity drift, unreserved dispatch,
session reuse, split failure, schedule mismatch, budget excess, or registration
binding mismatch is a kill gate that preserves already sealed records.

## Current decision

M9b remains **NO-GO**. M9b.3d creates no corpus or gold, credentials, provider
adapter, provider call, schedule entries, execution state, external
preregistration, spending authority, live authorization, or superiority claim.
It is prospective architecture and scientific-design material, not a security
audit, penetration test, compliance assessment, or empirical result.
