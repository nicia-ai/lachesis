# M9b.13e.1 independent review

Reviewed evidence commit: `ad6efa0b0f8ffa7b2c883aa816c316a0bd8792c0`.

Reviewed evidence tree: `0ba350208524e198755baf0ac0b8b4aa6815f222`.

Reviewed correction commit: `49d9e7f7b919fb5a22f89fd87d48630dd3baf97b`.

Reviewed correction tree: `ac505ad37a3f049f8c61b767d56fd2e2c23a5a0f`.

Reviewed final commit: `d60c757d8cf022263b0109716c81d9a88f843a84`.

Reviewed final tree: `20bcd6bfa55d11da232f9b10c531e73cec6cd7a6`.

Reviewed manifest:
`f525376c6666d6eb12e3b66b356a9bc2c8efa2464c1b90bdc3f00bbfa3379b34`.

Submitted decision:
`m9b13e1-corrected-operational-amendment-ready-for-independent-review`.

Independent-review decision: `m9b13e1-operational-amendment-review-no-go`.

Disposition: `reviewed-no-go-superseded-prospectively-by-m9b13e2`.

## Blocking findings

### 1. Caller-selected expectations can self-authorize admission

- Severity: High
- Confidence: High
- Source:
  `packages/generator-ai-sdk/internal/m9b13e1-trusted-session-readiness.ts`,
  lines 337–369.
- The submitted receipt and `expectationsValue` are both caller-provided and are
  compared only with each other. No independently reviewed package digest,
  authoritative collector, verifier, or trusted admission input establishes
  which expectations are authoritative.
- Violated invariant: host, process, helper, toolchain, and environment
  identities must be prospectively frozen or supplied by a separately reviewed
  package, not selected by the submitted receipt.
- Consequence: a caller can replace the host, helper, controller, and trusted
  inventory and submit the same replacements as expected values.
- Narrow prospective correction: bind an independently reviewed expectation
  package, collector, verifier, and trusted admission context that ordinary
  receipt JSON cannot construct or redefine.

### 2. Admission permits failed or unperformed independent verification

- Severity: High
- Confidence: High
- Source:
  `packages/generator-ai-sdk/internal/m9b13e1-trusted-session-readiness.ts`,
  lines 234–243 and 465–468.
- `independentVerification` permits `fail` and `not-performed`, and the admitted
  path rejects neither value.
- Violated invariant: structural receipt validation is necessary but
  insufficient; authoritative collection and passing independent verification
  must precede `trusted-session-admitted`.
- Consequence: a receipt can be admitted while expressly recording that
  verification failed or was not performed.
- Narrow prospective correction: split structural validation from
  authority-bearing admission and use exact admitted/stopped discriminated
  variants. Only admitted receipts may contain verification literal `pass`.

### 3. State, census, and session evidence is not chained or replay-resistant

- Severity: High
- Confidence: High
- Source:
  `packages/generator-ai-sdk/internal/m9b13e1-trusted-session-readiness.ts`,
  lines 383–438.
- Individual transition edges are checked without requiring adjacent edges to
  connect, start at `uninitialized`, or increase monotonically. Census evidence
  is not bound to the session identity, and inventory/topology digests are not
  independently recomputed from complete records.
- Violated invariant: exact ordered state progression, independently derived
  topology, fresh session-bound census evidence, terminal evidence, and stale or
  replay rejection.
- Consequence: disconnected state histories, reordered evidence, or census
  evidence from another session can support a nominally clean close.
- Narrow prospective correction: require an exact contiguous state path,
  strictly increasing sequence and monotonic time, one session commitment on
  every evidence object, rederived inventories, and a durable anti-replay
  ledger.

### 4. The supplement omits the amended assumption and pre-submission review

- Severity: High
- Confidence: High
- Source:
  `packages/generator-ai-sdk/internal/m9b13e1-trusted-session-readiness.ts`,
  lines 658–710, and
  `docs/m9b13e1-operational-trust-boundary/external-supplement-contract.json`,
  lines 50–60.
- The accepted supplement contains neither the exact amended assumption nor an
  independent pre-submission review of the exact checksum-bound supplement.
- Violated invariant: the future supplement must bind the operational amendment
  verbatim and be independently reviewed before separately authorized
  submission.
- Consequence: the validator accepts a supplement that never states the trusted
  host assumption and was never independently reviewed before submission.
- Narrow prospective correction: add the assumption as a literal and require a
  passing review object bound to the supplement-package digest, reviewed commit
  and tree, reviewer identity, checksum manifest, and pre-authorization time.

## Accepted conclusions

The M9b.13e.1 finding-1 split, exact nonclaim, retained scope, ordinary-race
controls, scientific invariance, unresolved M9b.13d findings, and zero-authority
boundary remain correct. The helper identity contract contains the required
fields but is not yet bound to an authoritative expectation package.

All 18 registered scientific and financial fields independently rederived with
zero differences at:

`e5cd02100a1004849acc18f3f302e880580a38ef45a0733868826c32a23ff282`

Findings 2–5 and 7 from M9b.13d remain unresolved and mandatory. Acquisition
remains NO-GO independently of this operational amendment.

## Independent verification

- All three reviewed commits and trees reproduced exactly.
- Every M9b.12–M9b.13e.1 package and independent-review manifest passed.
- All 27 registered archive entries matched recorded size and SHA-256.
- The preregistration, checksum-manifest, canonical registration-receipt, and
  18-field projection digests reproduced exactly.
- Focused M9b.13e.1 tests passed 18/18; the complete serialized repository suite
  passed 1,210/1,210.
- Formatting, JSON/canonicalization, local-link, TypeScript, lint, build,
  source-safety, secret, diff, and Git-integrity checks passed. The build ran
  under an operating-system network-deny sandbox.
- M9b.12 through M9b.13e remained byte-identical.
- The tracked worktree was clean; pre-existing untracked `.DS_Store` and
  `paper/` files were untouched.

## Review effects

- Network requests: 0
- Downloads or package installations: 0
- External-registry or OSF accesses and mutations: 0
- Supplement preparation, submission, or approval: 0
- Accounts, process terminations, host changes, or trusted-session activations:
  0
- Acquisition, image, corpus, hidden-gold, or schedule effects: 0
- Credential accesses: 0
- Provider or model calls: 0
- Study executions or analyses: 0
- Publications or pushes: 0
- M10 work: 0

The review grants no supplement, expectation-package, collector, verifier,
ledger, admission, acquisition, materialization, credential, provider,
execution, analysis, publication, push, or M10 authority.
