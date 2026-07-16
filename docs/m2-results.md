# M2 results: functional IR versus restricted capability TypeScript

Status: `complete-formal-fail`

M2 is closed. Its frozen held-out experiment is a valid formal failure with
highly informative operational results. It must not be rerun, re-pooled, or
reinterpreted under a relaxed margin. The study compares Lachesis functional
JSON IR with restricted capability-oriented TypeScript; it does not evaluate
conventional CodeMode or TypeGraph.

This is a documentation-only closure recorded after inference. The executable
source remains the frozen commit `957c8f0999c736920470df3b1e85bc25f13e36c7`. The
campaign, manifests, ledger, records, reports, scorer, prompts, schedules,
gates, and experiment identities are unchanged.

## Frozen identities

- Campaign: `918ae344d9f52bbd97d683e18c7decf678046e8f75ce21b3a6274dc9916f5b14`
- Held-out experiment:
  `537c8f3f28b82bb25819a3341989a816104980625c44e3ee9eed22db188a9680`
- Held-out phase manifest:
  `6d9816fc86689ace3924c3fcd5c901cd51d89bad3d3f44b6b23557a549856933`
- Counterbalanced schedule:
  `5d938cd744e21e3d11d0f5ab43309c18646cee2645e07812d590b2adb355756f`
- Paired analysis plan:
  `9e69c7ccd3145531d59243f432ee553d0c25db67101025fa6e1128a4a6bbcbf6`

## Preregistered conclusions

The statistical unit was one case-provider pair within one repetition. The 24
feasible held-out cases produced 48 feasible units independently in the primary
repetition and 48 independently in confirmation. Results were not pooled. The
functional-IR non-inferiority gate required the 95% Tango paired risk-difference
lower bound to be at least -0.10 in both repetitions.

| Gate                                                 |     Primary | Confirmation |
| ---------------------------------------------------- | ----------: | -----------: |
| Functional-IR final correctness at least 95%         | pass, 59/60 |  pass, 60/60 |
| Restricted-TypeScript final correctness at least 95% | pass, 60/60 |  pass, 60/60 |
| Functional-IR semantic non-inferiority               |    **fail** |         pass |
| No functional-IR repair-free disadvantage            |        pass |         pass |
| No functional-IR runtime-failure disadvantage        |        pass |         pass |
| Safety and contract boundary                         |        pass |         pass |

Primary feasible semantic success was 47/48 for functional IR and 48/48 for
restricted TypeScript, a paired difference of -1/48. The frozen Tango interval
had lower bound `-0.10899217995251859`, below the required `-0.10`. Confirmation
was 48/48 in both arms and passed with lower bound `-0.07410012966611751`.

Because every prospective gate had to pass independently in both repetitions,
the frozen aggregate conclusion is `replicated-fail`. Here that label means the
two-repetition conclusion failed; it does not mean the adverse event replicated.
No superiority analysis was eligible because the preregistered minimum of ten
discordant task-correctness pairs was not met in either repetition.

The single primary adverse pair was an Anthropic functional-IR provider failure.
The request was dispatched, Anthropic returned `Overloaded`, and usage was
unknown. The controller did not retry it. It conservatively settled the exact
241,920 micro-dollar worst-case reservation and continued according to the
frozen record-and-continue policy.

## Descriptive operational findings

These findings describe the frozen sample. They are not substitutes for the
failed non-inferiority gate and do not establish representation superiority.

| Measure                   | Functional JSON IR | Restricted capability TypeScript |
| ------------------------- | -----------------: | -------------------------------: |
| Final task correctness    |            119/120 |                          120/120 |
| Feasible semantic success |              95/96 |                            96/96 |
| Typed abstention          |              24/24 |                            24/24 |
| First compilation         |              94/96 |                            84/96 |
| Final compilation         |              95/96 |                            96/96 |
| Repair calls              |                  1 |                               12 |
| Output tokens             |             33,118 |                           13,289 |
| Accounted cost            |     2,014,402 µUSD |                   1,706,496 µUSD |
| Aggregate latency         |         408,117 ms |                       315,020 ms |

Every returned feasible output eventually passed hidden semantics. Both
representations had zero runtime exceptions, timeouts, capability violations,
budget violations, rejected plan executions, and contract-mismatched execution.
All typed infeasibility responses validated.

Functional IR was descriptively more generation-reliable: it required one
repair, for `DEAD_NODE`, while restricted TypeScript required twelve repairs,
all for `OPERATION_KIND_MISMATCH`. Every compiler-eligible repair succeeded. All
twelve TypeScript repairs occurred on Anthropic; OpenAI required no repair in
either representation. This is a meaningful model-by-representation interaction
in the observed sample, not a preregistered inferential claim.

Restricted TypeScript was descriptively more concise and efficient. It used
19,829 fewer output tokens and had lower aggregate latency and accounted cost.
The functional-IR cost includes the 241,920 micro-dollar conservative overload
settlement, so observed provider billing and authorized conservative accounting
must remain separate in any comparison.

Across 253 provider calls, held-out accounting consumed 3,720,898 µUSD:
3,478,978 µUSD of observed provider billing plus 241,920 µUSD of authorized
conservative accounting. No reservation remained unsettled, no pre-dispatch
failure was charged, and safe resume redispatched zero records.

## Post-hoc design sensitivity

The following calculation was made only after observing the held-out result. It
does not change the preregistered conclusion, justify a rerun, or authorize a
different analysis.

With the same single adverse pair, 53 feasible units rather than 48 would have
produced a Tango lower bound of approximately `-0.099429`, just inside the
frozen -0.10 margin. This shows that the design was knife-edge around one
end-to-end provider failure. It does not overturn the formal failure, permit
pooling repetitions, or support dropping the failed record.

## Claim boundary

M2 supports the claim that both functional IR and restricted capability
TypeScript achieved exceptional final correctness while preserving the same
capability, budget, contract, and runtime boundaries. It also provides
descriptive evidence that functional IR was easier to generate without repair
and that restricted TypeScript was more token- and latency-efficient in this
sample.

M2 does not establish:

- functional-IR non-inferiority under the frozen replicated rule;
- superiority of either representation;
- natural-language or production generality;
- any result about conventional CodeMode; or
- any result about TypeGraph.

## Next milestone: M3 graph-native decomposition

M3 should compare functional IR over text retrieval or chunks with the same
functional IR over graph-selected evidence neighborhoods. Planner, models,
inference settings, effects, budgets, reducers, public task contracts, and
evaluation limits should remain matched. TypeGraph belongs only in the
graph-substrate arm.

The new corpus should exercise relational, temporal, contradiction, provenance,
and retraction tasks, plus negative-control tasks where graph structure should
provide no advantage. The objective is to test whether the graph substrate adds
measurable capability, not to give it credit merely for being present. M2's
corpus is closed and must not be reused as a fresh held-out benchmark.

The external preregistration repository records the immutable M2 result and
checksums for all frozen manifests, durable records, the ledger, and its durable
head.
