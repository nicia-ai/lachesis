# M9b.7 offline campaign-capacity and completion-safety review

Status: **`campaign-capacity-no-go`**. This review grants no authority to
materialize a corpus, register a study, access credentials, contact a provider,
run a probe, or execute M9b live.

M9b.7 composes the accepted M9b.3f study preparation, the M9b.5 Responses
adapter contract, and M9b.6 conservative accounting. Its private protocol is
`lachesis-m9b7-offline-campaign-capacity-review@1.0.0`, based on commit
`4401bef2c912d9b8fd4349c74fad78ffb75a8dea`. Existing artifacts retain their
original meanings.

## Conservative reservation basis

The review uses the M9b.6 rule without relaxation: every request reserves the
full 922,000-token provider input maximum, including unknown provider framing,
plus its frozen output ceiling. Because 922,000 exceeds the 272,000-token
long-context threshold, each input reservation uses the 2× long-context
multiplier and each output reservation uses 1.5×. Input is priced at the most
expensive permitted cache class; for the frozen profile that is a 1.25× cache
write. Integer micro-dollar arithmetic rounds each request upward before
aggregation.

These limits and multipliers follow the official GPT-5.6 Terra model contract.
The hard-cap receipt remains defense in depth: provider hard-limit enforcement
is documented as non-instantaneous and has no provider-published exact overshoot
bound. Therefore a hard-cap receipt cannot replace the local full-reservation
proof.

The frozen request topology is:

| Request class             | Arm        | Phase     | Requests/pair | Input/request | Output/request | Cost/request (USD µ) |
| ------------------------- | ---------- | --------- | ------------: | ------------: | -------------: | -------------------: |
| Root program authoring    | discovered | authoring |             1 |       922,000 |         65,536 |            2,501,608 |
| Discovered leaf reasoning | discovered | execution |             5 |       922,000 |          4,096 |            2,317,288 |
| Static query planning     | static     | authoring |             1 |       922,000 |         65,536 |            2,501,608 |
| Static answer generation  | static     | execution |             1 |       922,000 |         20,480 |            2,366,440 |

There are exactly eight attempts per paired case, zero retries, one maximum
concurrent attempt, and zero provider evaluator attempts.

## Exact capacity totals

| Slice                         | Requests |  Input tokens | Output tokens |  Cost (USD µ) |   Cost (USD) |
| ----------------------------- | -------: | ------------: | ------------: | ------------: | -----------: |
| One pair                      |        8 |     7,376,000 |       172,032 |    18,956,096 |    18.956096 |
| Discovered arm, all 192 pairs |    1,152 | 1,062,144,000 |    16,515,072 | 2,704,905,216 | 2,704.905216 |
| Static arm, all 192 pairs     |      384 |   354,048,000 |    16,515,072 |   934,665,216 |   934.665216 |
| Authoring phase               |      384 |   354,048,000 |    25,165,824 |   960,617,472 |   960.617472 |
| Execution phase               |    1,152 | 1,062,144,000 |     7,864,320 | 2,678,952,960 | 2,678.952960 |
| Evaluation phase              |        0 |             0 |             0 |             0 |            0 |
| 24-pair probe                 |      192 |   177,024,000 |     4,128,768 |   454,946,304 |   454.946304 |
| 168-pair primary              |    1,344 | 1,239,168,000 |    28,901,376 | 3,184,624,128 | 3,184.624128 |
| Complete 192-pair campaign    |    1,536 | 1,416,192,000 |    33,030,144 | 3,639,570,432 | 3,639.570432 |

Probe advancement itself is deterministic and local, so it adds no provider
attempts or cost. The primary capacity is not fungible with probe capacity:
passing the probe cannot begin primary unless all 168 primary pairs fit at their
full reservation.

## Completion-safety controller

The private completion gate binds the M9b.3 allocation and schedule-protocol
digests, seed commitment, probe-before-primary phase order, M9b.5 response
schema identities, M9b.6 model/pricing/cap identities, request topology,
outputs, retry policy, and concurrency. The materialized case schedule and
request identities remain absent because corpus construction is outside this
milestone; their absence is an explicit blocker rather than an inferred value.

Before the first arm of a pair, the gate commits the full pair reservation.
Before the first pair in a population, it requires enough independently bound
capacity to finish that whole population. A persisted one-arm partial pair may
resume only its scheduled opposite arm; it cannot start another pair. The next
population cannot be shortened, reordered, or selected from outcomes. Primary
remains blocked until the exact frozen probe gate passes.

Ambiguous attempts retain the full pair reservation. Overage attempts retain
that reservation plus any verified provider charge above it. Both are terminal
and unscorable and halt progression. Resume after settlement continues at the
next exact pair. Resume after ambiguity, overage, or capacity rejection performs
no effects and repeats the same decision. Increasing outstanding reservations
above one rejects.

## Feasibility decision

M9b.3f froze a complete-study ceiling of 117,964,800 USD µ
($117.964800). M9b.6 requires 3,639,570,432 USD µ ($3,639.570432), a shortfall
of 3,521,605,632 USD µ ($3,521.605632). The required amount is 30.8531× the
frozen ceiling when rounded upward to four decimal places.

The original design is therefore immutable **`campaign-capacity-no-go`**,
independently of whether a later hard-cap receipt could cover the larger amount.
A current verified provider-project hard-cap receipt and the materialized
schedule/request identities are also absent.

The dominant cost drivers, in order, are:

1. eight full reservations per pair, including six discovered-arm requests;
2. the 922,000-token full-model input maximum;
3. selecting the highest possible input cache billing class;
4. long-context multipliers; and
5. output ceilings.

Input reservations account for 3,540,480,000 USD µ, or approximately 97.28% of
the conservative total. Lowering output ceilings alone cannot close the gap.
Retry and repair policies are already zero and cannot be reduced further.

## Frozen alternative

`lachesis-m9b7-cap-only-alternative/1` changes only the prospective campaign cap
to exactly 3,639,570,432 USD µ. It retains all 192 paired cases, all 1,536
attempts, the model, request topology, outputs, zero retries, concurrency one,
schedule protocol, primary estimand, and probe gate. Scientific comparability is
therefore preserved. The primary remains 168 independent pairs with alpha 0.05
and target power 0.80; achieved prospective power remains unknown until the
frozen 24-pair probe is measured.

This alternative is not activated and grants no authority. Activation would
require a new prospective cap binding, a fresh verified hard-cap receipt with at
least the complete amount remaining, the materialized schedule and request
identities, and a separate review. The original NO-GO remains immutable.

Changing output ceilings, request counts, call topology, model choice, repair
policy, population, or schedule is not this alternative. Those changes could
alter model behavior or the estimand and require a new protocol, preregistration
package, probe, and power assessment.

## Boundary and nonclaims

M9b.7 is deterministic offline infrastructure evidence. It makes no corpus,
tokenizer-exactness, provider-entitlement, provider-availability, financial
authorization, preregistration, model-quality, retrieval-superiority,
production-readiness, or professional-security-audit claim.
