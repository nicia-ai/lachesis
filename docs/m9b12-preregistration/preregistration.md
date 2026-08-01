# M9b.12 offline preregistration

Decision: `preregistration-package-ready-awaiting-external-authorization`

Status: immutable offline draft; not externally registered.

This package is based on commit `0096c1ff119ab6556edd8c9bacbd618a78b573cd`. Its
canonical private protocol is
`lachesis-m9b12-offline-preregistration-package@1.0.0`, with preregistration
digest `f12c1212c4fbaa57190059f4d29ef413d09f9d006489b7b95ae038e426a74ff5`.

## Research question

Does a TypeScript/JavaScript CodeMode harness that lets the model author and
locally execute an evidence-adaptive retrieval program improve first-attempt
grounded task success over a matched static one-shot retrieval harness operating
on the same external corpus snapshot?

## Arms and matching

The discovered arm uses one model call to author a closed retrieval AST, runs
that AST locally with bounded evidence-derived adaptation, and uses a second
model call to answer from visible evidence. The static arm uses one model call
to author one static query, performs one-shot local retrieval, and uses a second
model call to answer from visible evidence. Both then receive the same local
validation and arm-blind evaluation.

Each arm has exactly two inference calls; each pair has four inference calls and
four token-count requests. The model, reasoning effort, retriever, corpus
snapshot, aggregate retrieval/read/byte limits, answer schema, and evaluator are
matched. Sessions are independent, arm order is deterministically randomized,
retries are zero, and campaign concurrency is one. Local retrieval cannot call a
model or provider.

## Population and endpoint

The eight families are lookup, join, multi-hop, temporal/retraction,
contradiction, aggregation, insufficient evidence, and prompt injection. Each
has 1x, 8x, and 32x strata, producing 24 cells. The probe contains exactly one
pair per cell (24); the primary contains exactly seven per cell (168). The
complete campaign is 192 pairs, 768 count requests, 768 inference calls, and at
most 1,536 provider HTTP requests.

Development, probe, and primary inventories must be fully disjoint across
fixtures, cases, documents, entities, answers, supporting facts, templates,
surface forms, snapshots, seeds, and source provenance.

The primary paired binary endpoint is first-attempt semantically supported
end-to-end success. It requires valid first authoring and answer responses, a
valid program/query, bounded retrieval, the correct typed outcome and answer,
sufficient visible support, valid supporting-fact/citation identities,
snapshot/provenance consistency, local evaluator success, and no repair, retry,
ambiguity, overage, authority violation, or protocol violation. Every failure,
abstention, truncation, ambiguity, and halted pair is retained.

## Analysis and probe gate

The primary test is the treatment-favorable exact one-sided conditional McNemar
test at alpha 1/20. The decision uses integer/rational arithmetic. It requires
the opaque complete 168-case M9b.10c population and measurement-set tokens; no
subset, missing-pair deletion, replacement, or enrichment is permitted. All 24
family-by-scale cells have equal weight. Family, scale, provider usage,
retrieval, latency, and cost analyses are descriptive only.

The registered M9b.3f probe gate requires all 24 probe pairs, reliability and
ambiguity gates, Bonferroni-adjusted one-sided Clopper-Pearson limits, projected
McNemar power of at least 8,000 basis points at 168 pairs, and all safety,
authorization, accounting, pricing, and replay gates. There is no qualitative
override or threshold relaxation. Failure permanently prevents primary execution
under this registration.

## Financial boundary

M9b.11 is incorporated exactly: moderate inference ceiling
$342.097920, count
shadow contingency $117.964800, operational ceiling
$460.062720, prospective
provider cap $500.000000, and headroom $39.937280. The
dedicated project must start at exactly zero spend. Counts retain conservative
shadow charges at the highest frozen class rate; counting is not claimed
contractually free. The cap may lag. Ambiguity consumes the full reservation and
overage halts.

## Authority

This package grants no external registration, corpus/gold creation, project,
credential, provider, count, inference, probe, primary, budget, campaign,
publication, release, or push authority. It contains no corpus, case identity,
construction seed, hidden gold, credential, execution namespace, or provider
request. Each future action requires the separate exact authorization text in
`authorization-texts.md` and an append-only identity.

This AI-assisted preparation is not a professional security audit, penetration
test, or compliance assessment.
