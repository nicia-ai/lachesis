# M3b.3: typed evidence-answer obligations

Status: frozen historical protocol. Its 48-record probe passed. Its calibration
is an immutable `complete-calibration-fail` after four Anthropic
`graph-adjacency` responses failed at the provider-to-AI-SDK structured-output
decoding boundary. Held-out was never authorized and remains blocked. The
forward-looking probe language below records the preregistered design before
execution; it is not current authorization.

M3b.2 is frozen as `complete-semantic-gate-fail`. Its 16 durable records, ledger
settlements, report, and preregistration artifacts remain immutable. The M3b.2
calibration and held-out identities are `superseded-unexecuted`.

## Public executable answer contract

M3b.3 replaces the generic scalar answer shape with an arm-blinded public
`answerContract`. The contract declares:

- exact cardinality and scalar, ordered, or unordered value semantics;
- the requested semantic role and public anchor subject;
- the required fact predicates and derivation shape;
- the answer-value source and minimum supporting-fact structure; and
- the rule that the model must abstain exactly when no complete visible
  derivation satisfies the contract.

The six contracts cover headquarters city, release-status change, conflicting
readings, independent verifier, retracted-rule change, and owner. Hidden answer
values, expected fact/citation IDs, scores, source identity, and arm identity
are not part of the contract.

The response wire shape is:

```json
{
  "outcome": "answered | insufficient-evidence",
  "answerValues": [],
  "supportingFactIds": [],
  "citationIds": [],
  "pathIds": []
}
```

After the response and usage are durable, the deterministic validator enumerates
complete derivations from only the visible facts. It rejects unknown or
duplicate supporting facts, intermediate entities in a terminal role, answer
values not derived from the declared support, missing support citations,
unsupported answers, and abstentions when a complete derivation is visible. An
abstention is valid only when no complete visible derivation exists.

## Bounded semantic repair

Each record permits at most one semantic repair. Repair receives only the same
public instruction, answer contract, arm-visible evidence, previous typed
output, and deterministic obligation issue codes and paths. It receives no
hidden answer, expected citation, arm/source label, or score. Transport retries
remain separate and symmetric.

Records persist first-attempt output, first-attempt obligation result,
first-attempt end-to-end success, final output, final obligation result, repair
usage, and repair success independently. Scientific substrate contrasts retain
the first-attempt endpoint; final post-repair correctness is the operational
reliability endpoint.

## Next protocol gate

The next probe covers one development task from every category, all four arms,
and both providers: 48 initial records. Each record permits at most one semantic
repair and each initial or repair request permits at most one symmetric
transport retry. The disclosed maximum is therefore 48 repairs, 96 transport
retries, and 192 provider attempts. Operational campaign pools remain
fail-closed and are not permission to spend.

The frozen gate requires:

- 48/48 non-opaque durable outcomes;
- 48/48 final contract-correct outcomes after bounded repair;
- complete provider/category coverage;
- first-attempt and repaired results reported separately; and
- zero hidden-value leakage, unauthorized calls, or identity mismatches.

External preregistration and a fresh exact authorization are required before the
probe. Calibration and held-out execution remain unauthorized.

The subsequent execution history and M3b.4 correction are documented in
[M3b.4 structured-output forensics](m3b4-structured-output-forensics.md). No
M3b.3 identity may be rerun.
