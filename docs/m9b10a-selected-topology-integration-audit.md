# M9b.10a selected-topology integration audit

Decision: `integration-review-no-go`

This append-only offline audit is bound to commit
`c71ffa4fde5f1ed84c5027bc9bc4569c26a8fbdd` and tree
`cfff6ccea1c6b11f36d865d548d8fb74af7ad3c0`. The companion JSON is the
machine-readable record. This audit neither modifies nor reinterprets M9a
through M9b.10 artifacts.

## Findings

1. **P1 — The M9b.8 selected topology is not executable.** M9b.8 freezes a
   prospective topology and capacity decision, but the runnable M9b.1 path
   continues to select the historical M9b.0 profiles. There is no connected
   selected-topology orchestrator. Sources:
   `packages/generator-ai-sdk/internal/m9b8-prospective-redesign.ts:775-830` and
   `packages/generator/src/m9b1-discovery.ts:832`.
2. **P1 — The retrieval-only treatment cannot adapt to intermediate evidence.**
   The frozen authoring grammar exposes only the existing
   `invoke`/`map`/`fold`/`boundedFix` algebra, and the reference refinement step
   appends evidence rather than extracting a bounded evidence value for a later
   query. Sources: `packages/generator/src/m9b1-discovery.ts:83-110` and
   `packages/generator/src/m9a-retrieval.ts:443`.
3. **P1 — M9b.9 can dispatch despite verified NO-GO authority.** The verified
   report fixes provider and live authority to false, but the lifecycle
   transport path does not consume those fields before dispatch. Caller-supplied
   available capacity cannot establish authority. Sources:
   `packages/generator-ai-sdk/internal/m9b9-input-token-count.ts:975-1000` and
   `:1697-1964`.
4. **P1 — Provider output is not bound through evidence, arm persistence, and
   measurement.** The M9b.10 receipt binds its raw response and envelope
   decision, but no selected-topology terminal record connects the exact request
   to retrieval evidence, evaluation, accounting settlement, and a new
   measurement. Sources:
   `packages/generator-ai-sdk/internal/m9b10-output-envelope.ts:951-1090` and
   `packages/generator/src/m9b2-measurement.ts:1382-1420`.
5. **P1 — The frozen 168-pair primary McNemar analysis has no implementation.**
   M9b.3 freezes 168 primary pairs and alpha 0.05, while the cited M9b.2
   function is prospective power analysis, not the selected complete-population
   primary test. Sources: `packages/generator/src/m9b3-preparation.ts:445` and
   `packages/generator/src/m9b2-measurement.ts:2676-2810`.

## End-to-end boundary matrix

| Boundary                                     | Existing component         | Audit state           |
| -------------------------------------------- | -------------------------- | --------------------- |
| Restricted source → closed AST               | M9a/M9b.1 compiler         | passed component      |
| Closed AST → adaptive evidence-derived query | selected retrieval profile | missing composition   |
| Program authoring → local retrieval          | selected orchestrator      | missing composition   |
| Static query authoring → one-shot retrieval  | selected orchestrator      | missing composition   |
| Retrieval transcript → visible evidence      | selected terminal lineage  | missing composition   |
| Provider request → count receipt             | M9b.9                      | passed component      |
| Provider request → output receipt            | M9b.10                     | passed component      |
| Verified NO-GO → zero transport              | M9b.9 authority gate       | failed composition    |
| Arm terminal record → paired measurement     | selected measurement       | missing composition   |
| Frozen primary population → exact test       | selected primary analyzer  | missing composition   |
| Terminal replay → zero effects               | selected replay            | missing composition   |
| Pricing source → campaign authority          | count-endpoint pricing     | externally unresolved |

## Protocol inventory

The reviewed chain consists of the private M9b.1f artifact-bound program
discovery protocol, M9b.2 measurement protocol 1.2.0, M9b.3f prospective study
preparation, M9b.4 effect ledger, M9b.5a intercepted Responses adapter, M9b.6
conservative accounting, M9b.8 prospective topology redesign, M9b.9
input-token-count conformance, and M9b.10 output-envelope review. The exact IDs,
versions, and roles are recorded in the companion JSON.

## Capacity reproduction

All amounts are USD micros and are prospective, not activated:

| Artifact                                                            |        Amount |
| ------------------------------------------------------------------- | ------------: |
| M9b.7 conservative campaign                                         | 3,639,570,432 |
| M9b.8 selected-topology campaign                                    | 1,869,330,432 |
| M9b.9 inference-only campaign                                       |   613,416,960 |
| M9b.9 unresolved count effect                                       | 4,425,600,000 |
| M9b.10 moderate, only if counting is authoritatively confirmed free |   342,097,920 |
| Prospective hard cap under that same unresolved condition           |   400,000,000 |
| Prospective headroom under that same unresolved condition           |    57,902,080 |

The moderate envelope, cap, and headroom remain inactive. This audit makes no
claim about whether `POST /v1/responses/input_tokens` is free or billable.

## Passed components and missing composition

Passed component evidence covers closed-AST compilation, immutable
content-addressed offline retrieval, per-arm durable persistence, conservative
effect accounting, intercepted Responses conformance, prospective
population/schedule/evaluator/gold/capacity identities, and class-specific
output-envelope conformance.

The connected proof is missing: an executable two-call selected topology,
evidence-derived local adaptation, a pre-effect authority gate, campaign-global
exclusion, provider-to-evidence-to-evaluation-to-accounting terminal lineage, a
new selected measurement, the exact 168-pair analyzer, and complete zero-effect
paired replay.

## Required prospective amendment

Add a separately versioned private M9b.10b selected-topology integration that
composes the frozen prospective identities without reinterpreting historical
artifacts. It must remain entirely offline and stop with count-endpoint pricing
unresolved.

## Nonclaims

This record makes no model-quality, retrieval-superiority,
corpus-generalization, security-audit, penetration-test, compliance,
live-provider, preregistration, production-readiness, or pricing claim. It
grants no execution authority and does not activate the moderate envelope or
provider cap.

Independent SHA-256 checksums for this record are stored in
`docs/m9b10a-selected-topology-integration-audit.sha256`; baseline source
checksums are embedded in the companion JSON.
