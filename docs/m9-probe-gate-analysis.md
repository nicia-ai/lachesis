# M9 probe gate analysis

The registered M9b.3f probe gate (`evaluateM9b3ProbeAdvancement` in
`packages/generator/src/m9b3-preparation.ts`) passes only if:

- the one-sided 97.5% Clopper–Pearson lower bound of the discovered-only share
  of discordant pairs exceeds 0.5; and
- the power at 168 primary pairs (McNemar exact, alpha 0.05), computed with both
  97.5% lower bounds from the 24-pair probe plugged in, is at least 80%.

`m9-probe-gate-analysis.py` recomputes this region exactly with no shared code.

## Minimum discovered-only wins needed to pass, by discordant pairs D

| D    | 1–10 | 11  | 12  | 13  | 14  | 15  | 16  | 17  | 18  | 19  | 20  | 21  | 22  | 23  | 24  |
| ---- | ---- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wins | none | 11  | 12  | 13  | 14  | 14  | 15  | 16  | 16  | 17  | 18  | 18  | 19  | 19  | 20  |

## Probability that the probe passes

The rows are the true discordance rate. The columns are the true win share among
discordant pairs.

| Discordance | 0.65  | 0.75  | 0.85  | 0.95  |
| ----------- | ----- | ----- | ----- | ----- |
| 0.2         | 0.000 | 0.000 | 0.001 | 0.002 |
| 0.3         | 0.001 | 0.003 | 0.012 | 0.041 |
| 0.4         | 0.002 | 0.013 | 0.054 | 0.196 |
| 0.5         | 0.005 | 0.029 | 0.126 | 0.432 |

At a discordance rate of 0.3 and a win share of 0.75, the 168-pair primary has
97% power, yet the probe passes 0.3% of the time.

The cause is that both inputs to the power calculation are lower confidence
bounds from n = 24. Stacking two conservative bounds from a small sample
produces a gate that rejects nearly every effect the primary is designed to
detect.

## Decision: blinded discordance check

The sponsor selected the blinded discordance check (2026-11-18). This is a
charter §5 change and is registered in the next M9 revision.

### Probe rule

1. **Feasibility gates.** The registered reliability, ambiguity and spend gates
   still apply. Any failure stops the study.
2. **Blinding.** The evaluator releases only the total number of discordant
   pairs, D, out of 24. Which arm won each pair stays sealed in the probe
   `result` registry entry until the primary result is registered.
3. **Required size.** Let `N(d)` be the smallest multiple of 24 that reaches 80%
   exact one-sided McNemar power (alpha 0.05) at discordance d, assuming the
   registered strong-scenario win share of 16/22.
   - **Size:** run `max(168, N(D/24))` primary pairs. The size never drops
     below 168.
   - **Stop:** the study stops if D = 0, or if the required size is above
     `N_max`.
4. **Ceiling.** `N_max` is the largest size the registered budget allows. Under
   the current $460.06 operational ceiling, `N_max` = 168. Any larger `N_max`
   needs a sponsor budget decision before the probe runs, so it is never chosen
   after seeing D.

The probe pairs are excluded from the primary analysis, and N depends only on
probe data. The primary test's type I error is therefore unaffected. Blinding
the direction protects against T1 (outcome-informed changes), not alpha.

### Required size by probe result

At the registered strong scenario (discordance 0.22, win share 0.727), power at
168 pairs is 85%.

| D (of 24) | 0    | 1   | 2   | 3   | 4   | 5–24 |
| --------- | ---- | --- | --- | --- | --- | ---- |
| N(D/24)   | stop | 792 | 408 | 264 | 216 | ≤168 |

At the primary cost of $2.40 per pair, the sizes and their extra spend are:

| N   | Primary spend | Extra over 168 |
| --- | ------------- | -------------- |
| 216 | $518          | +$115          |
| 264 | $633          | +$230          |
| 408 | $978          | +$575          |

With the current budget, D ≤ 4 stops the study. The study stops when the probe
suggests too few discordant pairs for an informative primary, not when it
suggests a weak effect.

### Choosing `N_max`

The table gives the probability that probe noise stops the study, by true
discordance rate and `N_max`.

| True discordance | `N_max` 168 ($460) | 216 ($575) | 264 ($690) |
| ---------------- | ------------------ | ---------- | ---------- |
| 0.15             | 0.71               | 0.50       | 0.28       |
| 0.22 (strong)    | 0.37               | 0.19       | 0.08       |
| 0.30             | 0.11               | 0.04       | 0.01       |

Totals in parentheses include the probe.

**Decision (approved 2026-11-18):** `N_max` = 264. This sets an operational
ceiling of $690.09 and needs a provider cap of $750.

At the registered strong scenario, the current ceiling stops more than a third
of studies that would have succeeded. The additional spend is incurred only when
the probe shows low discordance.

`m9-probe-blinded-reestimation.py` reproduces these tables.
