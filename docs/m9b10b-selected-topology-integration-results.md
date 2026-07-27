# M9b.10b selected-topology integration results

Decision:
`selected-topology-integration-pass-with-narrow-nonprotocol-fixes-pricing-blocked`

This deterministic offline result is bound to implementation commit
`aef254143b7efa647b2e916cd255e153c2cf208b` and tree
`6b4a1f2b3a733000b2cbae2df57b183167e03085`. It prospectively amends the M9b.10a
audit without reinterpreting M9a through M9b.10. The companion JSON is the
machine-readable record.

## Outcome

The M9b.10a composition gaps are closed for offline conformance:

- A private `lachesis-m9b10b-selected-retrieval-codemode@1.0.0` profile parses
  and interprets a closed AST. It supports bounded evidence inspection,
  extraction, predicates, collection algebra, query construction,
  `map`/`fold`/`boundedFix`, and visible-evidence selection. It exposes no
  provider or model operation and never enters an ordinary JavaScript realm.
- The functional witness searches from the task, reads an intermediate record,
  extracts `ZX-41`, incorporates that untrusted value into a second query, and
  retrieves the answer-bearing evidence. The predetermined static query cannot
  succeed on the same synthetic snapshot. This proves expressiveness only.
- The selected orchestrator connects two matched provider-shaped request
  receipts per arm to local retrieval, visible evidence, a grounded answer,
  blind local evaluation, conservative accounting, durable arm persistence, pair
  completion, measurement, and replay. Every provider-shaped effect is
  intercepted; actual provider, model, token-count, credential, and network
  accesses are zero.
- The historical M9b.9 lifecycle now fails closed before persistence, session
  creation, credentials, or transport when presented with its frozen NO-GO
  authority. Its former intercepted lifecycle remains explicitly named as a
  historical offline conformance helper.
- A persistent CAS-bound campaign lock enforces concurrency one across attempt
  identities. Completed first arms survive a second-arm write failure and are
  not repeated on resume.
- The new measurement accepts only rederived M9b.10b arm records. The primary
  analyzer consumes exactly 168 frozen primary pairs and uses exact integer
  arithmetic for the one-sided conditional McNemar tail at alpha 0.05.
- Campaign progress is bound to the complete 24-pair probe followed by the
  complete 168-pair primary schedule. Missing, duplicate, reordered, foreign,
  ambiguous, or overage state fails closed.

One narrow nonprotocol correction was required in the shared CodeMode analyzer:
`filter` now preserves the known maximum cardinality of its already-bounded
input, because filtering cannot increase collection size. No wire identity or
public API changed.

## Protocols

The connected private protocols are:

- retrieval: `lachesis-m9b10b-selected-retrieval-codemode@1.0.0`
- integration: `lachesis-m9b10b-offline-selected-topology-integration@1.0.0`
- measurement: `lachesis-m9b10b-selected-topology-measurement@1.0.0`
- primary analysis: `lachesis-m9b10b-exact-primary-mcnemar@1.0.0`
- count, reservation, output, settlement, and attempt receipts under the
  `lachesis-m9b10b-*` version-1 identities recorded in the companion JSON
- persistent campaign lock, terminal pair, schedule inventory, and campaign
  progress under the version-1 identities recorded in the companion JSON

The selected output receipt is append-only and retains the historical M9b.10
receipt identity; it does not reinterpret that artifact.

## Capacity reproduction

All amounts are USD micros and remain prospective:

| Boundary                           |   Reservation |
| ---------------------------------- | ------------: |
| Root program authoring request     |       819,200 |
| Static query authoring request     |       266,240 |
| Discovered grounded-answer request |       348,160 |
| Static grounded-answer request     |       348,160 |
| Discovered arm                     |     1,167,360 |
| Static arm                         |       614,400 |
| Complete pair                      |     1,781,760 |
| Probe, 24 pairs                    |    42,762,240 |
| Primary, 168 pairs                 |   299,335,680 |
| Campaign, 192 pairs                |   342,097,920 |
| Conditional prospective hard cap   |   400,000,000 |
| Conditional prospective headroom   |    57,902,080 |
| Unresolved count effect            | 4,425,600,000 |
| Complete conservative exposure     | 4,767,697,920 |

The `$342.097920` moderate envelope, `$400.000000` hard cap, and `$57.902080`
headroom are not activated. They remain conditional on authoritative pricing for
`POST /v1/responses/input_tokens`.

## Integrity evidence

Hostile coverage rejects caller capacity overriding NO-GO authority, false live
authority, concurrent attempt identities, cross-arm count receipts,
cross-request responses, program/corpus/transcript/query/evidence/answer/
evaluator transfers, missing arms, post-outcome population selection, foreign
primary cases, missing or duplicate pairs, incorrect McNemar direction or tail,
floating-point boundary substitutions, old-version artifacts, unbounded evidence
strings, and provider/model AST attempts. Prompt injection remains untrusted
evidence data. Truncation, ambiguity, and overage remain terminal first-attempt
outcomes. Zero-effect replay counters remain exactly zero.

## Verification

Node `v24.18.0` and pnpm `10.33.0` were used.

- Focused M9 suite: 14 files, 294/294 tests passed.
- Complete repository suite: 46 files, 737/737 tests passed.
- Full coverage rerun: 737/737 passed; statements 90%, branches 80.91%,
  functions 97.44%, lines 93.71%. The first coverage attempt encountered one
  unrelated existing M3b1 five-second timeout; that exact test immediately
  passed without changing its timeout, and the complete coverage rerun passed.
- Strict package and repository typechecks, lint, build, changed-file
  formatting, Node/Workers smoke consumers, seven offline examples, CLI contract
  tests, source-safety audit, release checksum audit, and `git diff --check`
  passed.
- Load smoke completed 128 records in 534.322 ms, replayed 128 in 241.351 ms,
  and exercised concurrency 32 in 133.599 ms. These timings are descriptive.
- The public-API audit passed with the generator facade unchanged at 317 exports
  and digest `bf6a0476cbf3643705da8133e3173cbce771d765c979a7b198b586e2b6bda830`.
- The package-artifact audit correctly detects that the local generator pack
  differs from its historical published-alpha checksum after this private source
  amendment. No version, release metadata, dist-tag, or published artifact
  changed.
- Historical M9 checksum manifests verified except the immutable M9b.5 manifest
  correctly detected four later append-only M9b.4/M9b.5 source/test changes; its
  own evidence documents and pinned SDK inputs still verify.
- Protected untracked `.DS_Store` and `paper/` paths were untouched.

## Decision boundary

M9b remains NO-GO. This result grants no corpus-materialization,
preregistration, credential, provider, token-count, model, network, probe,
campaign, release, or live-execution authority. It does not claim model quality,
retrieval superiority, RLM or RAG superiority, compositional generalization,
natural-corpus validity, production readiness, security-audit coverage,
penetration-test coverage, compliance, or whether the count endpoint is free or
billable.

The only next separately authorized scope remains a narrow append-only pricing
resolution after an authoritative answer for the count endpoint is supplied.

Independent SHA-256 checksums for this result are stored in
`docs/m9b10b-selected-topology-integration-results.sha256`; exact source
checksums are embedded in the companion JSON.
