# Northstar catalog evolution diagnostics

BRANCH_TYPE_MISMATCH | {"operation":"select","role":"northstar.role/incident-decision-request","boundary":"mismatched-branch:whenTrue/whenFalse"} | Align both select branches to the same registered output schema.
SEMANTIC_OBLIGATION_FAILED | {"operation":"northstar.incident.v1/canonical-action@1","role":"northstar.role/canonical-action","boundary":"root-dependency:requiresOperation"} | Add the required operation to the root dependency graph or remove the obligation only if the public contract was wrong.
DENIED_CAPABILITY | {"operation":"northstar.incident.v1/record-decision@1","role":"northstar.role/record-incident-decision","boundary":"capability:incident.decision.mock"} | Grant only the named incident.decision.mock capability in trusted policy when this effect is intended.
BUDGET_EXCEEDED | {"operation":"northstar.incident.v1/record-decision@1","role":"northstar.role/record-incident-decision","boundary":"budget:maxEffectCalls"} | Raise maxEffectCalls to the analyzed requirement or simplify the plan; never hide an unknown or exceeded bound.

declaration-repairable: ROLE_VERSION_MISMATCH | outcome=declaration-repairable | side=both | role=northstar.role/record-incident-decision@1 | boundary=role-version:northstar.role/record-incident-decision | obligation=exact-role-version | Role northstar.role/record-incident-decision declares versions 1 and 2. | action=review-declaration | diagnostic=f994fd2163fcd225aad7e87c5b8415e7bb6effb81c9629a4a35b3dc670b4689d
genuinely-non-equivalent: CAPABILITY_MISMATCH | outcome=genuinely-non-equivalent | side=both | role=northstar.role/record-incident-decision@1 | boundary=effect-capability | obligation=same-capability | Effect role northstar.role/record-incident-decision@1 requires different capabilities. | action=do-not-substitute | diagnostic=0360dd44ee95f718272d177f706650a75d233274af202f4b6d82da22062caa4c

Safe migration: retain the old catalog and manifest, rerun conformance, and recompile against the new fingerprint.
Genuine difference: do-not-substitute; metadata edits cannot manufacture equivalence.
