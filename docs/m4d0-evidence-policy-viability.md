# M4d.0 evidence-policy viability audit

Status: complete offline development audit. No corpus, campaign, manifest,
preregistration, executable state, or provider call was created.

## Decision

The existing M4a policy must not advance unchanged. Its Anthropic typed-graph
choice for relational tasks was materially worse than lexical evidence on
provenance in both repetitions:

| Provider  | Repetition | Category   | Paired risk difference | Favorable-adverse | Discordances |
| --------- | ---------: | ---------- | ---------------------: | ----------------: | -----------: |
| Anthropic |          1 | provenance |                 -20.0% |               0-4 |            4 |
| Anthropic |          2 | provenance |                 -15.0% |               1-4 |            5 |

This crosses the audit's explicit -10 percentage-point material-harm boundary in
each repetition. Repairs do not alter that primary decision.

A narrow exploratory hypothesis remains defensible for a completely fresh
confirmation corpus:

| Provider   | Public category | Candidate view | Basis                        |
| ---------- | --------------- | -------------- | ---------------------------- |
| Anthropic  | contradiction   | graph facts    | positive in both repetitions |
| Anthropic  | retraction      | typed graph    | positive in both repetitions |
| all others | all others      | lexical facts  | lexical-preferring default   |

This candidate has two non-lexical overrides among 12 provider/category rules
and uses three views. It is not a revision of `M4A_INITIAL_POLICY`; that policy
is audited and rejected unchanged. The candidate is only a development-derived
input to a future fresh-corpus design.

## Immutable inputs and identity

- Lachesis baseline: `a52f39e32877bc8cac844d50409b4970b0a3019f`
- Frozen M3 experiment:
  `7f0eff01ce6190d03c11ddca40f9d099eb9f24ba323811c7df7b764215e5edc5`
- Frozen execution-report SHA-256:
  `6a996ce61dee73688f069f6a05ffb9a878ee6160695c1cb686a66acab1fbddcd`
- Existing canonical policy digest:
  `d93d87fc1d337b691f0fc24be5524e491525052cce8fa7157ed1ab4e4ddc721f`
- Audit digest:
  `af33443a315e2c69632297ca77ddb4738b54815431f010453f783be7c3b94176`
- Matrix: 160 cases × four arms × two providers × two repetitions = 2,560
  immutable records.

The read-only reproduction command validates all records and emits the complete
120 category strata, 20 provider/repetition summaries, and 420 paired endpoint
contrasts to standard output:

```bash
mise exec node@24 -- node apps/benchmark/dist/m4d0-audit-cli.js \
  /Users/paul/.local/share/lachesis/m3b5/reports/7f0eff01ce6190d03c11ddca40f9d099eb9f24ba323811c7df7b764215e5edc5/execution-report.json
```

## Method

Each policy is evaluated by selecting the already observed, frozen arm record
for the same case, provider, and repetition. No output is regenerated or
rescored. The compared policies are the existing M4a policy, always lexical,
always graph facts, always graph adjacency, and always typed graph.

The primary endpoint is first-attempt end-to-end success. First-attempt public
semantic validation and final repaired reliability remain separate. Token, cost,
and latency totals include every provider attempt actually recorded for the
selected arm, including wire and semantic repairs. Every attempt had
provider-reported usage.

Paired risk difference is
`(policy-only successes - lexical-only successes) / matched cases`. Providers
and repetitions are never pooled for a decision. The audit reports all three
endpoints; the compact paired table below shows the primary endpoint.

The cross-repetition learner uses only provider and public task category. On its
training repetition it defaults to lexical, selects a non-lexical arm only for
higher first-attempt correctness, or for at least 10% lower observed cost with
no correctness loss. Ties otherwise remain lexical. Stable rules must improve
correctness in the same direction in both repetitions or meet the cost rule in
both. Candidate ranking maximizes the minimum repetition-specific correctness
gain before total gain and cost. No case, entity, instruction text, answer,
expected citation, or hidden property is a policy feature.

## Aggregate operational results

`W/S` means wire/semantic repairs. Tokens are input/output; cost is observed
micro-dollars and latency is milliseconds.

| Policy       | Provider  | Rep | First E2E | First semantic |   Final |  W/S |       Tokens |    Cost | Latency |
| ------------ | --------- | --: | --------: | -------------: | ------: | ---: | -----------: | ------: | ------: |
| existing M4a | OpenAI    |   1 |   160/160 |        160/160 | 160/160 |  0/0 | 183100/17714 |  676180 |  235792 |
| existing M4a | OpenAI    |   2 |   159/160 |        159/160 | 160/160 |  0/1 | 184463/18339 |  743729 |  247358 |
| existing M4a | Anthropic |   1 |   152/160 |        152/160 | 159/160 |  5/3 | 423589/38644 | 1233618 |  476191 |
| existing M4a | Anthropic |   2 |   150/160 |        150/160 | 160/160 |  8/2 | 429245/38991 | 1248400 |  487075 |
| lexical      | OpenAI    |   1 |   160/160 |        160/160 | 160/160 |  0/0 | 171325/12648 |  557011 |  202837 |
| lexical      | OpenAI    |   2 |   160/160 |        160/160 | 160/160 |  0/0 | 171325/12562 |  591734 |  201545 |
| lexical      | Anthropic |   1 |   156/160 |        156/160 | 160/160 |  4/0 | 388892/33089 | 1108674 |  431492 |
| lexical      | Anthropic |   2 |   152/160 |        152/160 | 160/160 |  8/0 | 399701/33725 | 1136652 |  442709 |
| graph facts  | OpenAI    |   1 |   141/160 |        141/160 | 160/160 | 0/19 | 194051/23555 |  774335 |  325421 |
| graph facts  | OpenAI    |   2 |   140/160 |        140/160 | 159/160 | 0/20 | 195220/23143 |  807835 |  322874 |
| graph facts  | Anthropic |   1 |   149/160 |        149/160 | 159/160 |  2/9 | 406392/41666 | 1229444 |  493850 |
| graph facts  | Anthropic |   2 |   147/160 |        147/160 | 158/160 | 2/11 | 411264/42056 | 1243088 |  504298 |
| adjacency    | OpenAI    |   1 |   160/160 |        160/160 | 160/160 |  0/0 | 194720/20366 |  743310 |  266318 |
| adjacency    | OpenAI    |   2 |   159/160 |        159/160 | 160/160 |  0/1 | 196083/21047 |  811099 |  277599 |
| adjacency    | Anthropic |   1 |   140/160 |        140/160 | 157/160 | 6/15 | 471788/42919 | 1372766 |  539507 |
| adjacency    | Anthropic |   2 |   142/160 |        142/160 | 159/160 | 6/12 | 463913/42874 | 1356566 |  517422 |
| typed graph  | OpenAI    |   1 |   160/160 |        160/160 | 160/160 |  0/0 | 203960/19470 |  755544 |  249874 |
| typed graph  | OpenAI    |   2 |   160/160 |        160/160 | 160/160 |  0/0 | 203960/19446 |  805133 |  242864 |
| typed graph  | Anthropic |   1 |   154/160 |        154/160 | 159/160 |  3/3 | 443134/41806 | 1304328 |  486253 |
| typed graph  | Anthropic |   2 |   156/160 |        156/160 | 160/160 |  2/2 | 436924/41569 | 1289538 |  500064 |

The existing policy's aggregate first-attempt paired differences from lexical
were 0 and -0.625 percentage points for OpenAI, and -2.5 and -1.25 points for
Anthropic. The category audit, not the aggregate, exposes the repeated Anthropic
provenance harm.

## Cross-repetition stability

The table reports only the independent evaluation repetition. Complexity is the
number of non-lexical rules among 12. The paired column is favorable- adverse
discordances against lexical.

| Train → evaluate | Provider  | Complexity | First E2E | Risk difference |    Paired | W/S |       Tokens |    Cost | Latency |
| ---------------- | --------- | ---------: | --------: | --------------: | --------: | --: | -----------: | ------: | ------: |
| 1 → 2            | OpenAI    |          2 |   160/160 |          0.000% | 0-0 (d=0) | 0/0 | 171325/12562 |  591734 |  201545 |
| 1 → 2            | Anthropic |          2 |   158/160 |         +3.750% | 6-0 (d=6) | 2/0 | 400140/35956 | 1159840 |  446251 |
| 2 → 1            | OpenAI    |          3 |   160/160 |          0.000% | 0-0 (d=0) | 0/0 | 171325/12648 |  557011 |  202837 |
| 2 → 1            | Anthropic |          3 |   157/160 |         +0.625% | 4-3 (d=7) | 3/0 | 392415/35967 | 1144500 |  439094 |

Repetition 1 learned Anthropic contradiction → graph facts and retraction →
typed graph. Repetition 2 also learned contradiction → graph facts, but chose
graph facts for retraction and added temporal → adjacency. That temporal rule
lost on repetition 1, which is why it is excluded from the stable candidate.

The stable two-rule candidate produced 160/160 and 160/160 for OpenAI, and
160/160 and 158/160 for Anthropic. Relative to lexical, its Anthropic primary
discordances were 4-0 and 6-0, risk differences +2.5 and +3.75 percentage
points. These discordance counts are small and descriptive.

## Primary category-level paired results

Each cell is `risk difference [favorable-adverse; total discordances]` against
lexical. Graph facts remains a control in the existing M4a policy; its
appearance as an exploratory candidate does not silently revise that policy.

| Provider  | Rep | Category         |      Existing |      Graph facts |       Adjacency |   Typed graph |
| --------- | --: | ---------------- | ------------: | ---------------: | --------------: | ------------: |
| Anthropic |   1 | contradiction    |   0% [1-1; 2] |     +5% [1-0; 1] |     0% [1-1; 2] |   0% [1-1; 2] |
| Anthropic |   1 | multi-hop        |   0% [0-0; 0] |      0% [0-0; 0] |     0% [0-0; 0] |   0% [0-0; 0] |
| Anthropic |   1 | negative-control |   0% [0-0; 0] |      0% [0-0; 0] |     0% [0-0; 0] |   0% [0-0; 0] |
| Anthropic |   1 | provenance       | -20% [0-4; 4] |    -45% [0-9; 9] | -80% [0-16; 16] | -20% [0-4; 4] |
| Anthropic |   1 | retraction       |   0% [0-0; 0] |    +10% [3-1; 4] |   +10% [3-1; 4] | +15% [3-0; 3] |
| Anthropic |   1 | temporal         |   0% [0-0; 0] |     -5% [0-1; 1] |   -10% [0-2; 2] |  -5% [0-1; 1] |
| Anthropic |   2 | contradiction    |  +5% [1-0; 1] |     +5% [1-0; 1] |    +5% [1-0; 1] |  +5% [1-0; 1] |
| Anthropic |   2 | multi-hop        |   0% [0-0; 0] |      0% [0-0; 0] |     0% [0-0; 0] |   0% [0-0; 0] |
| Anthropic |   2 | negative-control |   0% [0-0; 0] |      0% [0-0; 0] |     0% [0-0; 0] |   0% [0-0; 0] |
| Anthropic |   2 | provenance       | -15% [1-4; 5] |  -55% [0-11; 11] | -75% [0-15; 15] | -15% [1-4; 5] |
| Anthropic |   2 | retraction       |   0% [0-0; 0] |    +25% [5-0; 5] |   +15% [4-1; 5] | +25% [5-0; 5] |
| Anthropic |   2 | temporal         |   0% [0-0; 0] |      0% [1-1; 2] |    +5% [1-0; 1] |  +5% [1-0; 1] |
| OpenAI    |   1 | contradiction    |   0% [0-0; 0] |      0% [0-0; 0] |     0% [0-0; 0] |   0% [0-0; 0] |
| OpenAI    |   1 | multi-hop        |   0% [0-0; 0] |      0% [0-0; 0] |     0% [0-0; 0] |   0% [0-0; 0] |
| OpenAI    |   1 | negative-control |   0% [0-0; 0] |      0% [0-0; 0] |     0% [0-0; 0] |   0% [0-0; 0] |
| OpenAI    |   1 | provenance       |   0% [0-0; 0] |  -95% [0-19; 19] |     0% [0-0; 0] |   0% [0-0; 0] |
| OpenAI    |   1 | retraction       |   0% [0-0; 0] |      0% [0-0; 0] |     0% [0-0; 0] |   0% [0-0; 0] |
| OpenAI    |   1 | temporal         |   0% [0-0; 0] |      0% [0-0; 0] |     0% [0-0; 0] |   0% [0-0; 0] |
| OpenAI    |   2 | contradiction    |   0% [0-0; 0] |      0% [0-0; 0] |     0% [0-0; 0] |   0% [0-0; 0] |
| OpenAI    |   2 | multi-hop        |   0% [0-0; 0] |      0% [0-0; 0] |     0% [0-0; 0] |   0% [0-0; 0] |
| OpenAI    |   2 | negative-control |   0% [0-0; 0] |      0% [0-0; 0] |     0% [0-0; 0] |   0% [0-0; 0] |
| OpenAI    |   2 | provenance       |  -5% [0-1; 1] | -100% [0-20; 20] |    -5% [0-1; 1] |   0% [0-0; 0] |
| OpenAI    |   2 | retraction       |   0% [0-0; 0] |      0% [0-0; 0] |     0% [0-0; 0] |   0% [0-0; 0] |
| OpenAI    |   2 | temporal         |   0% [0-0; 0] |      0% [0-0; 0] |     0% [0-0; 0] |   0% [0-0; 0] |

The complete machine output contains the analogous first-semantic and final-
reliability paired tables plus all category-specific repair, token, cost, and
latency totals. First-semantic counts happened to equal first-attempt end-to-end
counts in every aggregate policy stratum, but they remain separately encoded.

## TypeGraph parity

The real TypeGraph 0.38 SQLite adapter and the in-memory graph were evaluated
over all 160 cases and both public provider profiles. All 320 compilations had
identical public policy inputs, selected views, complete compiled evidence
views, visible-view digests, and selector identities. Because the counterfactual
audit selects immutable records solely by case, provider, repetition, and that
selected view, the counterfactual result and audit digest are
adapter-independent. TypeGraph receives no model-quality credit from this parity
result.

## Limitations and nonclaims

- M3 has been inspected and is development evidence for M4. This audit is not a
  held-out confirmation and cannot establish adaptive-policy superiority.
- The stable two-rule policy was derived using both repetitions. Its favorable
  discordance counts are only four and six; no inferential superiority gate was
  applied or passed.
- The -10-point material-harm boundary and 10% cost threshold are explicit M4d.0
  viability conventions, not retroactive M3 gates.
- Cost and latency are counterfactual selections from a counterbalanced Williams
  schedule. They preserve observed attempts but do not simulate a new deployment
  order or provider load.
- Final repaired reliability is operational evidence only. It cannot rescue a
  failed first-attempt comparison.
- There is no universal graph advantage, TypeGraph accuracy claim, provider
  generalization claim, production claim, new corpus, or live M4d result.

The defensible next hypothesis is therefore narrow: on a fresh corpus, Anthropic
may benefit from graph facts for contradiction and typed graph for retraction,
while lexical evidence should remain the default everywhere else. That
hypothesis must be frozen prospectively and tested on new data before any
accuracy claim.
