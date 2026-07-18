# M3b.5: held-out preparation

Status: historical offline freeze. The frozen held-out experiment subsequently
completed and M3b.5 closed as `complete-formal-fail`. This document preserves
the prospective design; see [the immutable M3 results](m3-results.md) for the
frozen conclusion. No M3 experiment may be rerun or modified.

M3b.4 calibration is immutable at source commit
`eecd8566042159d8d13e30f25a4cfc6de6ab491f`, preregistration commit
`6c54da590e4bf242cf3d83fbfbc34ac29adf0d7f`, experiment
`c7beee09333f7a99a18d13a93108ae6f5d2ad62b7746683b64f0732d3129b576`, and ledger
head `5cbbeb699894cae21d01d4a67788df6f066c307a4bd1e726c3c43cd11499c235`. Its
236/240 first-attempt success, three wire repairs, two semantic repairs, 240/240
final reliability, and Anthropic retraction-stratum failures are historical
observations. M3b.5 does not alter the adapter, prompt, decoder, semantic
obligations, scorer, endpoint, contrasts, multiplicity rules, provider
stratification, repetition independence, or repair behavior in response to them.

## Strictly disjoint corpus

M3b.5 retains the frozen factorial design and replaces every inspected held-out
fixture with a deterministically namespaced equivalent. The blind audit requires
zero overlap with M3b.3, the M3b.4 stress probe, and M3b.4 calibration in:

- fixture identifiers;
- entities;
- exact and normalized instructions;
- exact fact wording;
- answer values;
- exact fixture structures; and
- frozen evidence-neighborhood digests.

The held-out corpus remains 160 cases: 20 in each of multi-hop, temporal,
contradiction, provenance, and retraction, plus 60 negative controls. The matrix
remains four arms, two providers, and two independent repetitions, for 2,560
initial records. Counts-only audit output never exposes case identifiers,
instructions, answers, contexts, or neighborhood digests.

The frozen contrasts remain:

| Contrast                                    | Cases per provider and repetition |
| ------------------------------------------- | --------------------------------: |
| graph-selected facts versus lexical facts   |      60 retrieval-advantage cases |
| graph adjacency versus graph-selected facts |            100 relationship cases |
| typed graph versus graph adjacency          |            100 relationship cases |
| typed graph versus lexical facts            |              60 negative controls |

The three structural contrasts retain the exact two-sided McNemar test,
correct-direction requirement, at least 20 discordant pairs, and Holm-Bonferroni
adjusted `p <= 0.05`, independently for every provider and repetition. Negative
controls retain the 95% Tango paired risk-difference lower-bound gate of at
least -0.10. At `n=60`, one adverse pair has a lower bound of approximately
-0.0886. This is a prospective design-sensitivity check, not a fabricated
unconditional power claim.

## Held-out authority envelope

M3b.5 uses a fresh held-out-only campaign. Its operational cap is 150,000,000
micro-dollars: 86,000,000 for OpenAI and 64,000,000 for Anthropic. Each provider
has these additional cohort limits:

| Attempt type    | Maximum |
| --------------- | ------: |
| Initial         |   1,280 |
| Wire repair     |      64 |
| Semantic repair |     128 |
| Transport retry |      64 |
| Total           |   1,536 |

The complete 3,072-attempt phase ceiling is derived from the frozen pricing
snapshot: 84,480,000 micro-dollars for OpenAI, 61,440,000 for Anthropic, and
145,920,000 total. Every attempt still requires its own complete worst-case
reservation. The existing per-record maxima of one wire repair, one semantic
repair, and one symmetric retry per logical attempt remain unchanged. Cohort
quota exhaustion stops before dispatch and makes the experiment an incomplete
formal failure.

Materialization and credential-free preflight confer no authority. Live
execution requires a separate acknowledgement of the exact campaign, experiment,
phase-manifest digest, caps, matrix, and attempt quotas.

## Historical disposition

The separately authorized held-out execution completed all 2,560 records. The
negative-control non-inferiority and safety gates passed, but none of the three
universal structural-superiority contrasts passed independently for both
providers and both repetitions. M3b.5 and M3 are therefore closed as
`complete-formal-fail`. The result did not change any gate, prompt, scorer,
manifest, corpus, schedule, or experiment artifact.
