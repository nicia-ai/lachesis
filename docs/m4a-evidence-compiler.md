# M4a/M4b: offline evidence compilation and provenance reconstruction

Status: deterministic offline vertical slice. No provider inference, campaign,
calibration, held-out corpus, held-out materialization, preregistration, or
TypeGraph integration is included or authorized.

M3 is closed as `complete-formal-fail`. Every M3 observation is development
evidence for the M4 policy hypothesis. No inspected M3 case may become M4
held-out evidence, and no M4 confirmatory claim can reuse the M3 corpus.

M4a and M4b reset the oracle boundary:

```text
typed evidence graph + public query + public provider/task profiles
  -> content-addressed evidence-view policy
  -> one selected model-visible evidence context

model answer values + supporting fact IDs
  -> deterministic public-obligation validation
  -> canonical fact and relationship citations
  -> bounded shortest evidence paths
  -> content-addressed provenance graph
```

The model does not choose an experimental arm and does not reconstruct citations
or paths already present in trusted evidence.

## M4a evidence compiler

`compileM4EvidenceView` compiles one validated evidence graph into all four
substrate-neutral views, then chooses one with a typed policy:

- `lexical-facts`;
- `graph-facts`;
- `graph-adjacency`; and
- `graph-typed`.

The initial version-1 development hypothesis is:

| Trusted task class | OpenAI                  | Anthropic                 |
| ------------------ | ----------------------- | ------------------------- |
| Relational         | untyped graph adjacency | typed graph relationships |
| Non-relational     | lexical facts           | lexical facts             |
| Negative control   | lexical facts           | lexical facts             |

`graph-facts` is always compiled and identified as an experimental control. A
valid policy cannot select it as a default. The compiler requires exactly one
rule for every provider/task-class pair, canonicalizes rule ordering, and
rejects incomplete, duplicate, or control-selecting policies.

Provider profile, task class, and the answer contract are strict public inputs.
Unknown fields are rejected, so the policy has no input position for answers,
hidden properties, expected outcomes, or ground truth. Task class remains a
trusted benchmark/runtime declaration, not a model prediction. Future work must
specify how production callers obtain it; this offline slice does not infer it
from task prose.

The compiled artifact retains the canonical source graph as non-model-visible
audit provenance. Compiler protocol version 2 binds:

- policy version and complete policy digest;
- strict provider-profile and public task-contract digests;
- the exact selector manifest, including each selector implementation version;
- source-snapshot and public-query digests;
- provider and trusted task class;
- selected and control views;
- every view's neighborhood digest;
- the selected visible-view digest; and
- a source-inclusive compiler audit digest.

Graph storage order and policy-rule order do not change the identity. Validation
recomputes the graph digest, re-runs every view selection against that graph,
checks view digests and source/view correspondence, and verifies the applicable
policy rule, selected and control neighborhoods, model-visible context, and
final compiler audit digest.

Only `modelVisibleContext` is an oracle payload. Provider, task class, selected
view, source implementation, policy identity, graph digest, and experimental
control remain compiler provenance. Hostile tests verify that those labels do
not enter the normalized model context.

## M4b deterministic provenance

The reduced oracle output is a strict object containing only:

```json
{
  "outcome": "answered | insufficient-evidence",
  "answerValues": [],
  "supportingFactIds": []
}
```

Extra fields are rejected. The oracle cannot author `citationIds`, `pathIds`,
expected values, semantic scores, or provenance edges.

`reconstructM4Provenance` first validates the compiled evidence identity and
uses the public answer contract already bound into that artifact. It
deterministically enumerates complete visible derivations and rejects:

- unknown, duplicate, or mismatched support;
- answer values not derived from the declared supporting facts;
- answers without a complete visible derivation; and
- abstention when a complete derivation is visible.

After validation, the runtime:

1. restores canonical derivation order;
2. derives cited fact references from the supporting facts;
3. finds deterministic shortest directed paths between successive supporting
   facts using a graph-linear breadth-first search;
4. adds relationship-provenance citations for the selected path edges; and
5. emits a content-addressed provenance graph linking answers, facts, citations,
   and reconstructed paths.

Facts-only views legitimately produce no relationship paths. This is not a
validation failure: the same answer and fact-citation obligations still apply.
Path reconstruction is bounded by the validated context's maximum 64 facts and
256 edges and never enumerates arbitrary simple paths.

The plan/orchestration graph, evidence graph, and reconstructed run-provenance
graph remain separate typed structures. Provenance links reference evidence
identities but cannot schedule operations or rewrite evidence.

## M4a.1 visible-evidence trust boundary

After selector replay and artifact-integrity validation, model-output validation
and provenance reconstruction may read only:

- the compiled public answer contract;
- the exact `modelVisibleContext`;
- the model's answer values; and
- the model's supporting fact IDs.

The retained canonical source graph is available only while validating the
compiler artifact: it can replay selectors, verify the source snapshot, and
reconcile compiled identities. It is not passed to semantic derivation, citation
construction, shortest-path selection, or provenance construction. Consequently,
a source mutation that leaves the visible context unchanged must leave
acceptance and reconstructed provenance unchanged.

Content identities are separated by trust layer:

| Layer            | Bound inputs                                                                         | Identity                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Policy selection | policy version, provider profile, public task class                                  | `policyDigest`, `providerProfileDigest`                                                       |
| Compiler audit   | task contract, selector versions, source snapshot, query, all compiled views         | `taskContractDigest`, `selectorManifestDigest`, `sourceSnapshotDigest`, `compilerAuditDigest` |
| Visible view     | exact normalized model-visible evidence context                                      | `visibleViewDigest`                                                                           |
| Reconstruction   | visible view, task contract, reduced oracle answer, reconstruction algorithm version | `reconstructionDigest`                                                                        |

The reconstruction identity deliberately does not include the source-inclusive
compiler audit digest. Hidden source mutations therefore change
`sourceSnapshotDigest` and `compilerAuditDigest`, while an unchanged visible
view retains its `visibleViewDigest` and reconstruction identity.

This is a noninterference claim supported by metamorphic and property tests, not
a mechanized formal proof. The tests vary hidden facts and edges, remove visible
support, create multiple equal-length visible paths, rename entities, and audit
the closure of every accepted fact, citation, edge, and path. They demonstrate
the claimed behavior for the generated and deterministic fixtures covered by the
suite.

## Deterministic vertical slice

The offline suite covers both providers and all six M3 development categories.
It proves:

- the initial policy chooses the intended provider/task view;
- graph facts remain control-only;
- reordered graph storage and policy rules preserve identity;
- model-visible contexts remain arm- and provider-blinded;
- tampered compiled identities and mislabeled sources fail validation;
- reduced valid answers reconstruct canonical citations and paths;
- facts-only views preserve citations without fabricating paths;
- invalid support and false abstention fail deterministically; and
- hidden scorer fields and model-authored citation/path fields are rejected.
- hidden facts cannot complete visible derivations;
- hidden shortcut edges cannot alter visible shortest paths;
- equal visible views have equal reconstruction results despite different source
  audit identities;
- equal-length visible paths use a deterministic lexicographic edge-ID tie
  break;
- accepted provenance remains inside the visible evidence closure; and
- entity renaming preserves structural behavior while changing the appropriate
  content identities.

These are contract and implementation results, not evidence that the adaptive
policy improves model quality.

## Deferred M4 work

M4c may add a TypeGraph adapter only behind the existing `EvidenceSource`
contract. Parity must require byte-identical selected facts, edges, ordering,
temporal snapshot, model-visible serialization, and canonical neighborhood
digests against the in-memory implementation. Passing parity would establish a
storage/query/replay implementation property, not an accuracy improvement.

M4d requires a completely fresh corpus and separate preregistration. Its frozen
comparison should include the adaptive policy, fixed lexical baseline, fixed
adjacency, fixed typed graph, and at most a descriptive oracle-best ceiling.
Provider/model generalization is a separate experiment. No M4 campaign or live
identity exists in this milestone.
