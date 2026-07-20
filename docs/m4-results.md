# M4 results: evidence compilation, provenance, and policy viability

Status: M4 is closed as `complete-mixed`. M4d.1 is closed as
`complete-design-no-go`.

No provider calls were made for this closure. No M4 confirmatory corpus,
protocol probe, campaign, manifest, preregistration, or executable state was
generated. The frozen M4 identities remain historical development evidence.

## Result

M4 completed the evidence-runtime substrate but did not establish the proposed
adaptive model-facing policy:

> Provider-aware evidence compilation, deterministic provenance reconstruction,
> and optional TypeGraph storage parity are complete offline capabilities. The
> original adaptive policy was rejected, and the narrow exploratory replacement
> is impractical to confirm under the frozen power and practicality rules.
> Lexical evidence therefore remains the production default.

| Component                       | Result                                                  | Bound implementation                       |
| ------------------------------- | ------------------------------------------------------- | ------------------------------------------ |
| M4a evidence compiler           | Complete                                                | `62de4bdd3a10f8db9c2254bf5dca42cd4c0fc0d4` |
| M4a.1 visible-evidence boundary | Complete, with property-tested noninterference evidence | `f8d4992913b67c9129bb88babbdb76e6d16aa347` |
| M4b deterministic provenance    | Complete                                                | `62de4bdd3a10f8db9c2254bf5dca42cd4c0fc0d4` |
| M4c TypeGraph parity            | Complete offline                                        | `a52f39e32877bc8cac844d50409b4970b0a3019f` |
| M4d.0 policy viability          | Existing policy rejected using M3 development evidence  | `ad875ca89608e3b3d9f1fd44bc7e342af51748e3` |
| M4d.1 protocol and power design | `complete-design-no-go`                                 | `30afd676bcf373f3c7acc81894b41e73ba1c7d71` |

### M4a and M4b

M4a compiles a typed evidence graph into a content-addressed model-visible view.
Policy, provider profile, public task contract, selector, source snapshot,
visible view, and reconstruction identities remain separated at their proper
trust boundaries. M4a.1 demonstrated through metamorphic and property tests—not
a mechanized proof—that hidden source-graph changes cannot validate an answer,
supply a citation, shorten a path, or complete a derivation absent from the
compiled visible view.

M4b reduced the oracle output to answer values and visible supporting fact IDs.
The runtime deterministically validates those values and reconstructs canonical
citations, bounded paths, and a separate run/provenance graph. The model no
longer has to reproduce provenance topology already known to the runtime.

### M4c

M4c added TypeGraph 0.38 as an optional evidence-storage adapter behind the
substrate-neutral contract. Real SQLite integration tests require byte-identical
selection, ordering, model-visible serialization, visible-view identity,
validation, citations, paths, provenance, and reconstruction identity relative
to the in-memory implementation. TypeGraph-specific storage and temporal
identities remain audit metadata and never become model-visible or executable
control flow.

This is infrastructure parity, not a model-quality result. TypeGraph remains
additive rather than mandatory.

## Policy findings

The original M4a adaptive policy is permanently `development-rejected`. In the
counterfactual M3 development audit it was materially worse than lexical facts
for Anthropic provenance tasks in both independent repetitions:

| Repetition | Risk difference vs lexical | Discordances, policy favorable-adverse |
| ---------- | -------------------------: | -------------------------------------: |
| 1          |      -20 percentage points |                                    0-4 |
| 2          |      -15 percentage points |                                    1-4 |

Its content identity remains
`d93d87fc1d337b691f0fc24be5524e491525052cce8fa7157ed1ab4e4ddc721f`; rejection
does not rewrite that identity or silently replace its policy.

M4d.1 defined one narrow exploratory candidate:

- Anthropic contradiction tasks use graph facts.
- Anthropic retraction tasks use typed graph.
- Every other provider/category uses lexical facts.

The candidate identity is
`29121609dde1241c4cfd5fae5053e5fbf3482c3de963b97e0e6fa220e8f3daa7`. It remains
`research-only`, non-default, and unconfirmed.

## Prospective design no-go

The exact prospective design retained independent repetitions, exact paired
tests, Holm correction, and at least 20 discordant pairs for each hypothesis in
each repetition. Conservative development estimates required:

| Independent hypothesis                            | Cases per repetition |
| ------------------------------------------------- | -------------------: |
| Anthropic graph facts vs lexical on contradiction |                2,289 |
| Anthropic typed graph vs lexical on retraction    |                  228 |
| **Total unique cases per repetition**             |            **2,517** |

Two evidence conditions over two independent repetitions imply 10,068 initial
provider calls. The 2,517-case corpus exceeds the frozen 500-case practicality
ceiling by more than fivefold.

M4d.1 therefore stops before corpus generation. The project did not relax the
discordance, power, multiplicity, independence, or practicality gates, and did
not enrich the population after inspecting development effects. No protocol
probe or confirmatory identity exists.

## Frozen identities

The following identities remain immutable development and design records:

- M4a policy: `d93d87fc1d337b691f0fc24be5524e491525052cce8fa7157ed1ab4e4ddc721f`
- M4d.0 audit:
  `af33443a315e2c69632297ca77ddb4738b54815431f010453f783be7c3b94176`
- M4d.1 candidate policy:
  `29121609dde1241c4cfd5fae5053e5fbf3482c3de963b97e0e6fa220e8f3daa7`
- Prospective power design:
  `29c80e1348933b232d057e8030d94c0abee53c91f76e79ff5f131a8f36b2366a`
- Reduced oracle prompt:
  `7ffac8734d0b356e9a155996560de2a60dd41fd39136d516f20b5d3e36fc2edd`
- Reduced output schema:
  `8065e56a828c6b6c871b0d4b2d381a0d1cb730e166620e1512f973e4e3da1bf7`
- Disjointness design:
  `2bc49a93a95e564c395d2b2a35ec637c44345d4f00bc6e922177142242c557ee`
- Unmaterialized probe design:
  `dc730952639e833040ccf87418ac9feea3155893c363b777fac8c2cea5d5d8d5`

The machine-readable closure record is [m4-results.json](m4-results.json), with
the document and record digests in [m4-results.sha256](m4-results.sha256).

## Production decision and nonclaims

Lexical evidence remains the production default. The narrow candidate is not a
default, deployment recommendation, or confirmed effect.

M4 establishes none of the following:

- No adaptive-policy superiority.
- No graph-serialization superiority.
- No TypeGraph model-quality advantage.
- No confirmation of the exploratory category effects.

It also makes no general graph, provider-independent, all-task, performance, or
scale claim.

## Proposed M5: production evidence runtime

M5 is proposed only; it is not implemented, materialized, preregistered, or
authorized here. Its production-oriented scope is:

- a cohesive public evidence-runtime API;
- lexical-by-default model-facing evidence;
- optional TypeGraph storage, history, and provenance;
- reduced oracle outputs consisting of answer values and supporting fact IDs;
- deterministic validation, citations, paths, and provenance;
- live, replay, mock, and recorded-effect interpreters; and
- natural-workload evaluation centered on reliability, provenance completeness,
  replay, budgets, and developer experience—not graph superiority.

See the [project roadmap](roadmap.md) for the proposed milestone boundary.
