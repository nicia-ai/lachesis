# M9b.13e independent review

Reviewed analysis commit: `7e975353eb6f41faa61a4ded3b03ec878b674c02`.

Reviewed analysis tree: `14b9a605b225ef54d4098058b79ba3f71070921c`.

Reviewed final commit: `ca0a3050e950b661c23346d31c8c2f087bf474fe`.

Reviewed final tree: `1f206793e0ff97b1e8a487d4df9c94e59a47600a`.

Reviewed manifest:
`38c6056789f4c6f3c63fad7b082aa1e54dca1c7dd111fe3daaee3114044c87fe`.

Submitted decision:
`m9b13e-trusted-host-amendment-ready-for-independent-review`.

Independent-review decision: `m9b13e-operational-amendment-review-no-go`.

Disposition: `reviewed-no-go-superseded-prospectively-by-m9b13e1`.

The trusted-controlled-host approach is scientifically compatible in principle:
hostile same-UID resistance was not promised by the approved preregistration,
and removing it changes none of the 18 registered fields. The sealed M9b.13e
package is nevertheless not operationally precise enough for external
supplementation or later implementation.

## Blocking findings

1. **The trusted-session assumption is not operationally testable**

   - Severity: High
   - Confidence: High
   - Source:
     `docs/m9b13e-operational-trust-boundary/prospective-amendment.json`, lines
     16–28.
   - The amendment requires a clean host and later readiness review, but does
     not bind a readiness protocol or define the machine, UID, permitted process
     tree, census method and timing, session boundaries, trusted roots and
     runtimes, background-process policy, recorded evidence, or fail-closed
     outcome.
   - Registered conflict: `docs/m9b12f-preregistration/threat-model.md`, lines
     7–10, protects concurrent controllers, malformed state, and partial
     replacement.
   - Violated invariant: the trusted-host assumption must be observable and
     failure to establish it must be a no-effect pre-acquisition stop gate.
   - Consequence: an implementation could begin acquisition without proving the
     assumption on which scientific contamination protection depends.
   - Narrow correction: bind a named future readiness protocol covering every
     fact above and make failure, or later invariant loss, a no-effect stop.

2. **Temporary-publication identity checks were weakened too far**

   - Severity: High
   - Confidence: Medium-high
   - Source: `docs/m9b13e-operational-trust-boundary/retained-controls.json`,
     lines 23–27.
   - The package labels temporary-entry and final-entry identity checks merely
     defense in depth.
   - Registered conflict: `docs/m9b12f-preregistration/threat-model.md`, lines
     7–10, retains protection against concurrent controllers and partial
     replacement.
   - Violated invariant: the amendment removes only deliberate malicious
     same-UID resistance, not accidental authorized-process races.
   - Consequence: verified bytes could be replaced through an ordinary
     controller/helper race without violating the stated classification.
   - Narrow correction: keep retained descriptors, entry-identity comparisons,
     writable-descriptor closure, durability ordering, and pre/post-publication
     checks mandatory for ordinary races and controller correctness.

3. **Exact helper/source/build identity was not retained**

   - Severity: High
   - Confidence: High
   - Source: `docs/m9b13e-operational-trust-boundary/retained-controls.json`,
     lines 50–54.
   - The split retains several evidence identities but omits the helper's
     source/build identity and substitutes generic trusted-path and digest
     verification.
   - Historical evidence:
     `docs/m9b13d-offline-dependency-closure/helper-identity.json`, lines 2–36,
     binds exact source, compiler, SDK, flags, and executable digest.
   - Violated invariant: only hostile same-UID hash-to-exec pathname replacement
     leaves scope; accidental or controller-created substitution must reject.
   - Consequence: a self-consistent replacement helper could pass the amended
     description and corrupt evidence lineage.
   - Narrow correction: require the future implementation package to freeze and
     independently compare exact helper protocol, source, compiler/SDK, flags,
     build, linked libraries, and executable identities before any effect.

4. **The nonclaim is incomplete**

   - Severity: High
   - Confidence: High
   - Source: `docs/m9b13e-operational-trust-boundary/nonclaims.md`, lines 3–8.
   - The nonclaim excludes host, account, kernel, administrator, and hypervisor
     compromise, but not controller or pre-start local code/tool/runtime
     installation compromise.
   - Internal conflict:
     `docs/m9b13e-operational-trust-boundary/topology-comparison.json`, lines
     8–10, places the controller and installed runtime inside the trusted
     boundary.
   - Violated invariant: every trusted component excluded from the security
     claim must be stated explicitly without excluding ordinary operator error
     or accidental contamination.
   - Consequence: the package can be read as retaining security claims against
     compromise of trusted controller/runtime components.
   - Narrow correction: extend the verbatim nonclaim to controller and pre-start
     code/tool/runtime installation while preserving ordinary error and
     contamination as in-scope fail-closed conditions.

5. **The supplement contract is incomplete and not expressly
   embargo-compatible**

   - Severity: High
   - Confidence: High
   - Source:
     `docs/m9b13e-operational-trust-boundary/prospective-amendment.json`, lines
     18–28.
   - The procedure does not require the supplement to state expressly that it is
     prospective, preserve M9b.13–M9b.13d.1 as historical NO-GO evidence, or use
     an external mechanism compatible with the existing embargo.
   - Registered conflict: `docs/m9b12f-registration-receipt/REGISTRATION.json`,
     lines 13–18, records registration `63sh5` as private and embargoed through
     `2030-08-01T00:00:00Z`.
   - Violated invariant: an append-only amendment must preserve registration
     identity, history, confidentiality, and prospective timing.
   - Consequence: a nominally immutable supplement could publish protected
     context or present earlier failures as superseded successes.
   - Narrow correction: require an embargo-compatible new immutable identity, an
     explicit prospective statement, preservation of every historical NO-GO, and
     prohibition of modification, withdrawal, replacement, publication, or
     premature embargo termination of `63sh5`.

## Lineage and scientific assessment

The immutable M9b.12f bytes directly establish that the controller
implementation, controller host operating system, privileged operator, private
authority-storage domain, and authenticated principal/channel adapter are
trusted. They expressly exclude malicious privileged host/operator and
kernel/hypervisor compromise and disclaim malicious-host resistance.

The first local artifact that explicitly made the hostile same-UID attacker a
gate is the M9b.13d independent review. M9b.13c required race-resistant
admission but did not expressly name that attacker. Its relationship to same-UID
resistance is an inference; M9b.13e generally labels that distinction correctly.

All 18 preserved scientific and financial fields independently rederived with
zero differences at:

`e5cd02100a1004849acc18f3f302e880580a38ef45a0733868826c32a23ff282`

Thus the intervention, comparison arm, retrieval topology, model and reasoning
settings, population, allocations, endpoint, McNemar analysis, power gate,
schedule, provider and financial ceilings, contamination rules, role blindness,
quarantine, replay, and stopping rules remain unchanged. Findings 2–5 and 7 from
M9b.13d remain unresolved and mandatory; acquisition remains NO-GO independently
of the operational amendment.

## Independent verification

- Both reviewed commits and trees reproduced exactly.
- All 13 predecessor package manifests, seven independent-review manifests, the
  registration receipt manifest, and all 19 M9b.13e checksum entries passed.
- All 27 registered archive entries matched recorded byte size and SHA-256.
- The preregistration, manifest, canonical receipt, and 18-field projection
  digests reproduced exactly.
- Nine M9b.13e JSON files parsed and independently canonicalized.
- Focused preregistration tests passed 7/7.
- Formatting, local-link, TypeScript, lint, source-safety, changed-file secret,
  diff, and strict Git-integrity checks passed.
- M9b.12 through M9b.13d.1 remained byte-identical.
- The tracked worktree was clean; the pre-existing untracked `.DS_Store` and
  `paper/` files were untouched.

## Review effects

- Network requests: 0
- Downloads or package installations: 0
- External-registry or OSF accesses and mutations: 0
- Supplement preparation, submission, or approval: 0
- Accounts, process terminations, or host changes: 0
- Acquisition, image, corpus, or hidden-gold effects: 0
- Credential accesses: 0
- Provider or model calls: 0
- Study executions or analyses: 0
- Publications or pushes: 0
- M10 work: 0

The review grants no supplement, acquisition, materialization, credential,
provider, execution, analysis, publication, push, or M10 authority.
