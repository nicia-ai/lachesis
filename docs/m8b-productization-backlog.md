# Proposed M8b productization backlog

M8b is not started. This proposal is prioritized only from M8a adoption
friction.

## P0 — supported catalog-author workflow

1. Design a catalog-author CLI that validates declarations, emits manifests,
   runs conformance, verifies report identities, and returns stable CI exit
   codes. Review the design before adding a public package or command.
2. Define a stable machine-report envelope for compile diagnostics plus catalog
   diagnostics without collapsing their different cardinalities.
3. Add manifest-diff presentation that distinguishes identity change,
   declaration review, and semantic non-substitution. It must never auto-accept
   a repaired declaration.

## P1 — inspection and migration

1. Add first-class read-only inspection for replay artifacts, plan identity,
   evidence provenance, and conformance records.
2. Publish two additional registry-only reference integrations in unrelated
   domains.
3. Test migration across real catalog versions, retaining initial and repaired
   outcomes separately.
4. Evaluate a dependency-free SARIF renderer outside the core API.

## P2 — beta evidence

1. Conduct external developer usability tests of the supported product path, not
   a compositional-generalization experiment.
2. Require successful independent integrations, API stability review, security
   review, and operating experience before beta.
3. Measure time-to-first-valid-run, diagnostic comprehension, repair attempts,
   report integration, and replay/provenance inspection.

Permanent requirements:

- content, task, attempt, phase, and provider-dispatch identities stay distinct;
- every executable controller passes a real-entrypoint positive canary;
- no research orchestration lies on the adoption critical path; and
- unsafe semantic evolution always fails closed.
