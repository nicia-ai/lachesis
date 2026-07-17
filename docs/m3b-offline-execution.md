# M3b: offline execution infrastructure

Status: archived as the offline-unbound design substrate. Its three materialized
identities are report-only and cannot become live experiments. Provider,
transport, pricing, durable-controller, and explicit-decision bindings are added
under the fresh [M3b.1 live-binding protocol](./m3b1-live-binding.md).

M3b turns the M3a.1 substrate benchmark into a matched execution protocol while
preserving the representation boundary:

```text
one compiled functional plan
one public task instruction
one oracle prompt and output schema
one provider/model setting per matched provider unit
four frozen evidence contexts in a Williams order
```

Only the evidence-neighborhood and normalized-context digests vary across the
four arms. Semantic repair is disabled.

## Shared executable plan

`createM3bSharedPlan` compiles one fixed kernel plan whose only effect is the
capability-scoped `m3b.oracle@1`. The plan accepts an `M3bOracleRequest`,
invokes the oracle once, and returns a strict `M3bOracleOutput` containing an
answer, citations, and evidence paths.

The manifest binds the plan hash, semantic-contract hash, catalog fingerprint,
oracle-protocol digest, and output-schema digest. Every arm in every matched
unit records those same identities. A plan is never sampled or regenerated per
arm.

## Arm blinding

The oracle sees exactly:

```json
{
  "instruction": "the public task instruction",
  "evidence": {
    "facts": [],
    "citations": [],
    "edges": [],
    "paths": []
  }
}
```

The request contains no source identity, implementation name, arm label,
neighborhood digest, expected answer, or scoring data. Source identity and the
full neighborhood digest remain in run provenance. Relationship fields inside
the normalized context are the intended experimental treatment, not an arm
label.

## Corpus and phase sizes

M3b preserves the frozen 30-case M3a.1 development set and 140-case held-out
set, then adds 20 new held-out negative controls under a new M3b corpus
identity. M3a.1 constants and its prior audit remain unchanged.

| Phase          | Cases | Repetitions | Providers | Arms | Initial calls | Maximum controller retries | Maximum calls |
| -------------- | ----: | ----------: | --------: | ---: | ------------: | -------------------------: | ------------: |
| Protocol probe |     2 |           1 |         2 |    4 |            16 |                         16 |            32 |
| Calibration    |    30 |           1 |         2 |    4 |           240 |                        240 |           480 |
| Held-out       |   160 |           2 |         2 |    4 |         2,560 |                      2,560 |         5,120 |

The retry columns are worst-case controller limits, not expected calls. Semantic
repairs are exactly zero in every phase.

The held-out cells are:

- 60 retrieval-advantage cases;
- 100 relationship-encoding cases; and
- 60 negative controls.

## Four-arm Williams schedule

The four sequences are:

```text
lexical-facts   → graph-facts     → graph-typed     → graph-adjacency
graph-facts     → graph-adjacency → lexical-facts   → graph-typed
graph-adjacency → graph-typed     → graph-facts     → lexical-facts
graph-typed     → lexical-facts   → graph-adjacency → graph-facts
```

Cases are content-addressed and assigned to sequences independently within each
provider and repetition. Complete four-case blocks balance every arm exactly
across positions and every ordered predecessor pair. In incomplete probe and
calibration blocks, the deterministic discrepancy is at most one. The schedule
digest is bound into experiment identity and every durable record; resume must
preserve the original order.

## Exact contrasts

Each provider and repetition is evaluated independently. Repetitions are never
pooled.

| Contrast                          |   Frozen held-out population |
| --------------------------------- | ---------------------------: |
| `graph-facts` − `lexical-facts`   | 60 retrieval-advantage cases |
| `graph-adjacency` − `graph-facts` |       100 relationship cases |
| `graph-typed` − `graph-adjacency` |       100 relationship cases |
| `graph-typed` − `lexical-facts`   |         60 negative controls |

Reports include an exact two-sided McNemar result and validated 95% Tango paired
risk-difference interval. The three structural contrasts form one
Holm-Bonferroni family at family-wise alpha 0.05, independently within provider
and repetition. Negative-control non-inferiority is a separate −10 percentage-
point safety gate and cannot establish structural superiority.

The retrieval contrast uses its actual `n=60`; it never inherits the M3a.1
`n=100` sensitivity calculation. With 60 negative controls, one adverse pair has
a lower bound of approximately −0.0886 and remains inside the margin. The
corresponding 40-case lower bound is approximately −0.1288.

## Transport failures and estimands

SDK retries remain zero. The controller may retry `provider-overload`,
`provider-timeout`, and `provider-unavailable` once, symmetrically for every arm
and provider. A retry occurs inside the scheduled arm slot before the next arm;
it does not become a semantic repair or a new schedule position.

Refusals, budget rejection, contract mismatch, and a second retryable failure
are terminal. Terminal failures remain failures in the primary end-to-end
estimand. A paired conditional-on-both-valid-output analysis is reported only as
secondary evidence and never replaces the primary result.

## Offline manifests and resume

`materializeM3bPhase` freezes every case digest, per-case oracle-prompt digest,
four source identities, neighborhood digests, normalized-context digests,
provider settings, shared-plan identities, schedule, retry policy, analysis
policy, and phase limits. `validateM3bMaterialization` recomputes these
identities before any oracle call or store write.

The portable runner accepts a digest-validating store. Completed records resume
without redispatch; a changed experiment, schedule, plan, output schema, or
record digest fails before dispatch. `createDeterministicM3bOracle` supplies a
zero-network fixture for protocol and resume verification.

Development and held-out manifests name independent pools. Both currently have
an operational authorization of zero micro-dollars and
`liveExecutionAuthorized: false`. The disclosed call ceilings are not spending
authorization.

The counts-only audit reports phase counts, resource ceilings, leakage and
ground-truth failure counts, schedule imbalance, and shared-plan identity count.
It returns no case IDs, prompts, answers, contexts, or digests.

## Historical boundary

This document describes the substrate frozen before live binding. M3b.1 later
reached a 16-record provider probe and closed as a protocol failure; it did not
reach calibration or held-out inference. The identity-changing
[M3b.2](./m3b2-protocol-correction.md) is frozen as a semantic-gate failure.
[M3b.3](./m3b3-semantic-obligations.md) is the current offline-only protocol.

Before any fresh provider call:

1. review and freeze the offline manifests and source commit;
2. derive and authorize independent development-pool caps;
3. create the external preregistration record;
4. separately authorize the 16-initial-call protocol probe; and
5. stop again before calibration.

TypeGraph remains deferred until the generic graph contrasts demonstrate live,
additive value.
