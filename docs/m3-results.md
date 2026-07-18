# M3 results: graph-native evidence decomposition

Status: `complete-formal-fail`. M3b.5 and M3 are closed. No M3 experiment may be
rerun, repaired, rescored, or reinterpreted under changed gates.

M3 tested whether graph-selected and graph-encoded evidence improved the
first-attempt end-to-end correctness of the same functional plan, planner,
models, reducers, budgets, and public answer obligations. The frozen held-out
study completed all 2,560 records and passed its transport, safety, accounting,
negative-control, and integrity gates. It did not pass any universal
structural-superiority contrast.

The formal conclusion is:

> The study does not establish a universal advantage for graph retrieval,
> untyped adjacency, or typed graph encoding over their frozen comparators.
> Provider-specific descriptive effects were substantial but did not satisfy the
> preregistered requirement to pass independently for both providers and both
> repetitions.

This is a complete formal failure, not an incomplete run. Every planned record
was present in the primary analysis, no quota was exhausted, and the frozen
analysis ran exactly once.

## Frozen study

The held-out matrix used 160 strictly disjoint cases, four evidence arms, two
providers, and two independent repetitions:

```text
160 cases x 4 arms x 2 providers x 2 repetitions = 2,560 records
```

The arms were lexical facts, graph-selected facts with relationships hidden, the
same graph-selected facts with untyped adjacency, and the same facts with typed
edges and paths. The primary endpoint was first-attempt end-to-end success. Wire
repair, semantic repair, and final reliability were frozen secondary endpoints.
Providers and repetitions were analyzed independently and were never pooled for
a conclusion.

The three structural contrasts required, in every provider and repetition:

- a paired difference in the correct direction;
- at least 20 discordant pairs; and
- Holm-Bonferroni-adjusted `p <= 0.05` across the structural family.

The negative-control gate separately required the 95% Tango paired
risk-difference lower bound to be at least -10 percentage points in every
provider and repetition. It could establish safety non-inferiority, not
structural superiority.

## Formal gate results

Every universal structural-superiority conclusion failed.

### Graph-selected facts versus lexical facts

Graph-selected facts were worse on the frozen retrieval population in every
stratum:

| Provider  | Repetition | Difference | Discordant pairs | Holm-adjusted p | Result                |
| --------- | ---------: | ---------: | ---------------: | --------------: | --------------------- |
| OpenAI    |          1 |   -31.7 pp |               19 |       0.0000114 | Fail: wrong direction |
| OpenAI    |          2 |   -33.3 pp |               20 |      0.00000572 | Fail: wrong direction |
| Anthropic |          1 |   -11.7 pp |               13 |          0.0923 | Fail                  |
| Anthropic |          2 |   -10.0 pp |               16 |           0.359 | Fail                  |

### Untyped adjacency versus graph-selected facts

OpenAI showed a descriptive +19 percentage-point effect in both repetitions, but
each stratum had 19 discordant pairs, one below the frozen minimum. Anthropic
moved in the opposite direction.

| Provider  | Repetition | Difference | Discordant pairs | Holm-adjusted p | Result                 |
| --------- | ---------: | ---------: | ---------------: | --------------: | ---------------------- |
| OpenAI    |          1 |   +19.0 pp |               19 |       0.0000114 | Fail: discordance gate |
| OpenAI    |          2 |   +19.0 pp |               19 |      0.00000763 | Fail: discordance gate |
| Anthropic |          1 |    -9.0 pp |               15 |          0.0703 | Fail: wrong direction  |
| Anthropic |          2 |    -5.0 pp |                9 |           0.359 | Fail: wrong direction  |

### Typed graph versus untyped adjacency

Anthropic showed a descriptive +14 percentage-point effect in both repetitions,
with adjusted p-values below 0.05, but had only 18 and 16 discordant pairs.
OpenAI showed no comparable effect.

| Provider  | Repetition | Difference | Discordant pairs | Holm-adjusted p | Result                 |
| --------- | ---------: | ---------: | ---------------: | --------------: | ---------------------- |
| OpenAI    |          1 |     0.0 pp |                0 |             1.0 | Fail: discordance gate |
| OpenAI    |          2 |    +1.0 pp |                1 |             1.0 | Fail: discordance gate |
| Anthropic |          1 |   +14.0 pp |               18 |         0.00394 | Fail: discordance gate |
| Anthropic |          2 |   +14.0 pp |               16 |         0.00156 | Fail: discordance gate |

### Negative controls

Typed graph versus lexical facts passed non-inferiority in all four
provider/repetition strata. Each paired estimate was 0, with a 95% lower bound
of -6.02 percentage points against the frozen -10-point margin. This supports
the narrow conclusion that adding the typed graph view did not degrade the
negative controls under the study conditions.

## Reliability and repair

First-attempt and repaired outcomes remain separate:

| Provider  | First-attempt success |   Final success | Wire repairs | Semantic repairs |
| --------- | --------------------: | --------------: | -----------: | ---------------: |
| OpenAI    |           1,240/1,280 |     1,279/1,280 |            0 |               40 |
| Anthropic |           1,196/1,280 |     1,272/1,280 |           33 |               52 |
| **Total** |       **2,436/2,560** | **2,551/2,560** |       **33** |           **92** |

The overall first-attempt success rate was 95.16%. Bounded recovery raised final
reliability to 99.65%. All 33 wire repairs succeeded. Eighty-three of 92
semantic repairs succeeded. These repair results establish operational recovery
performance; they do not establish a substrate advantage.

First-attempt to final results by arm were:

| Provider / repetition | Lexical facts | Graph facts |  Adjacency | Typed graph |
| --------------------- | ------------: | ----------: | ---------: | ----------: |
| OpenAI 1              |    160 -> 160 |  141 -> 160 | 160 -> 160 |  160 -> 160 |
| OpenAI 2              |    160 -> 160 |  140 -> 159 | 159 -> 160 |  160 -> 160 |
| Anthropic 1           |    156 -> 160 |  149 -> 159 | 140 -> 157 |  154 -> 159 |
| Anthropic 2           |    152 -> 160 |  147 -> 158 | 142 -> 159 |  156 -> 160 |

## Failure concentration and path use

Provenance tasks concentrated the observed failures:

- all 40 OpenAI first-attempt failures were provenance cases;
- 62 of 84 Anthropic first-attempt failures were provenance cases;
- seven of the nine records that remained unsuccessful after repair were
  provenance cases, and two were contradiction cases; and
- both terminal wire-schema rejections occurred on provenance records during
  Anthropic semantic repair.

The nine final failures comprised six
`answer-values-not-derived-from-supporting-facts` outcomes, one invalid
abstention despite a complete visible derivation, and two terminal wire-schema
rejections.

Typed-path utilization was low. OpenAI used a credited typed path in 7/100 and
8/100 relationship cases across the two repetitions. Anthropic did so in 0/100
in both repetitions. Path utilization was a separate secondary endpoint and does
not change the formal result.

## Transport, safety, accounting, and integrity

The controller admitted 2,560 initial attempts, 33 wire repairs, 92 semantic
repairs, and zero transport retries: 2,685 provider attempts in total. Every
attempt had provider-reported usage. There were 35 precisely classified
wire-schema rejections, of which 33 were repaired. There were:

- zero opaque contract mismatches;
- zero SDK/runtime-schema disagreements;
- zero missing-usage attempts;
- zero conservative settlements; and
- zero authorization, identity, capability, or safety violations.

| Provider  |  Input tokens | Output tokens | Aggregate latency |               Observed spend |
| --------- | ------------: | ------------: | ----------------: | ---------------------------: |
| OpenAI    |     1,530,644 |       152,237 |      2,089,332 ms |      5,846,001 micro-dollars |
| Anthropic |     3,422,008 |       319,704 |      3,915,595 ms |     10,041,056 micro-dollars |
| **Total** | **4,952,652** |   **471,941** |  **6,004,927 ms** | **15,887,057 micro-dollars** |

The held-out pool retained 134,112,943 micro-dollars. All 2,560 durable record
files had unique content-addressed keys and valid record digests. The
append-only ledger contained 5,372 events and ended at
`a759cadf841b22069b7bb2498704137c040d00d8354d277848e5534088b5a0c1`. The
content-addressed completeness audit proved that a resume had no missing
dispatch slot. The report, integrity record, ledger, frozen manifests, source,
and preregistration commits are bound by the external immutable results record.

## Claim boundary

M3 does not support:

- a universal graph-retrieval advantage;
- universal superiority for untyped adjacency or typed relationship encoding;
- pooling provider-specific effects into a superiority claim;
- a TypeGraph model-accuracy or task-quality claim, because TypeGraph was not
  part of the experiment;
- relaxing the minimum-discordance or Holm multiplicity gates after seeing the
  results; or
- treating repaired reliability as evidence for the primary first-attempt
  substrate contrasts.

The provider-specific effects remain useful descriptive evidence. They motivate
a compiler policy that chooses and reconstructs evidence views explicitly, but
they do not overturn the frozen failure.

## Proposed M4: provider-aware evidence-view compilation

M4 is a proposal only. It is not implemented, materialized, preregistered, or
authorized.

The proposed milestone would add:

1. a provider-aware evidence-view compiler that selects among lexical facts,
   graph-selected facts, adjacency, and typed relationships under a frozen
   public policy;
2. deterministic provenance reconstruction from oracle outputs and the visible
   evidence neighborhood, reducing dependence on model-authored support
   topology;
3. a TypeGraph adapter that must demonstrate contract parity for retrieval,
   temporal state, provenance, and replay before receiving experimental credit;
   and
4. a fresh confirmatory benchmark comparing the learned representation policy
   against a fixed lexical baseline.

TypeGraph parity would test storage, querying, temporal, provenance, and replay
behavior. It would not by itself establish improved model accuracy. Any M4 live
study requires a new disjoint corpus, preregistration, campaign, and separate
authorization.
