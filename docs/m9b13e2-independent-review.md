m9b13e2-authority-lineage-replay-review-no-go

Three blocking findings:

1. High severity, high confidence — temporal admission circularity. The admitted
   path requires acquisition, verification, sealing, and closure at
   `packages/generator-ai-sdk/internal/m9b13e2-authority-bound-readiness.ts:574`.
   That complete history is validated at line 1483, and admission is returned
   only after the terminal ledger commit at line 1575.

   - Violated invariant: pre-effect admission must precede acquisition.
   - Consequence: terminal completion retroactively purports to authorize
     effects already performed.
   - Correction: issue a pre-effect receipt ending at `admitted-clean`, then
     separately chain continuing monitoring and a terminal sealed/closed or
     quarantined/closed receipt.

2. High severity, high confidence — supplement review remains self-authorizing.
   At
   `packages/generator-ai-sdk/internal/m9b13e2-authority-bound-readiness.ts:1708-1737`,
   validation trusts the review object embedded by the supplement. It neither
   recomputes `supplementPackageDigest` nor receives a separately frozen review
   package.

   - Violated invariant: submission authority must bind independently supplied
     review evidence.
   - Consequence: a caller can choose the review identity, reviewer commitment,
     evidence hashes, literal `pass`, timestamp, and matching arbitrary
     supplement digest.
   - Correction: recompute the supplement digest structurally, then require a
     separate authority operation holding the frozen external review package.

3. High severity, high confidence — census chronology is not semantically
   enforced. Lines 693–703 only check the caller-selected transition interval.
   The accepted fixture places the “before-consequential-boundary” census at
   time 350 after its boundary at 340, and places “before-sealing” after the
   transition into `sealed`, at
   `packages/generator-ai-sdk/tests/m9b13e2-authority-bound-readiness.test.ts:303-342`.

   - Violated invariant: every census must occupy its boundary-kind-specific
     temporal position.
   - Consequence: post-boundary or post-seal observations can be presented as
     pre-effect evidence.
   - Correction: enforce matching transition references and explicit
     census-before-boundary, census-after-completion, pre-seal, initial, and
     terminal ordering.

Offline verification otherwise reproduced all commits, trees, manifests,
artifact hashes, 27/27 archive entries, registration receipt, and the unchanged
18-field digest. Focused tests passed 38/38; the complete suite passed
1,248/1,248. Formatting, TypeScript, lint, build, source-safety, JSON, and
Git-integrity gates passed. The synthetic harness is excluded from production
build/package output, the live entry remains exact zero-effect stop, and the
ledger is accurately documented as synthetic-only. No repository files were
modified; `.DS_Store` and `paper/` remain untouched.
