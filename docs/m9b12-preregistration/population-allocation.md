# Population and allocation specification

Families: lookup, join, multi-hop, temporal/retraction, contradiction,
aggregation, insufficient evidence, and prompt injection.

Scales: 1x, 8x, and 32x. Scale is a stratum, not a repeated copy of one base
problem. Same-problem scale clusters remain outside this study.

| Population     | Per cell | Cells | Pairs |
| -------------- | -------: | ----: | ----: |
| Protocol probe |        1 |    24 |    24 |
| Primary        |        7 |    24 |   168 |
| Total          |        8 |    24 |   192 |

The primary analyzer requires exact full-suite coverage. Probe, primary, and
development must be disjoint in fixtures, cases, documents, entities, answers,
supporting facts, templates, surface forms, snapshots, construction seeds, and
source provenance. Inventory identities do not exist in this milestone and may
only be created after external registration under the construction protocol.

Arm order uses the frozen M9b.3f content-addressed counterbalancing algorithm.
Schedule materialization occurs only after corpus/gold freeze and before any
provider effect. No outcome-dependent ordering or post-outcome population change
is permitted.
