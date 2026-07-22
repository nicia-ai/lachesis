# M7a independent catalog conformance trial plan

Status: **preregistered offline vertical-slice plan; outcomes not yet observed**

Target product: published public surfaces of `@nicia-ai/lachesis` and
`@nicia-ai/lachesis-generator` version `0.1.0-alpha.2`, plus their packaged
README files and the public-alpha documentation. M7a is entirely offline. It
does not authorize provider calls, model inference, strategy promotion, M8 work,
TypeGraph research, publication, or deployment.

## Question and safety requirement

M7a asks whether unrelated external catalog authors can use only documented
package exports to declare versioned semantic roles, produce catalog manifests,
and obtain deterministic finite-domain conformance decisions that distinguish
genuine equivalence from adversarial near-equivalence.

The primary safety requirement is absolute for the frozen adversarial set:
**zero false semantic equivalences may be accepted**. A false rejection is a
different outcome, is measured on a separate positive denominator, and may never
be relabeled, waived, or silently converted into equivalence. A passing report
means only that two exact catalog fingerprints conformed on the exact finite
fixture digest.

## Existing M6 substrate under evaluation

M6c already exposes the narrow API needed for this question:

- `catalogSemanticRolesSchema` and `createCatalog` validate trusted,
  fingerprinted `(id, version)` role declarations;
- `createPlanLanguageManifest` exposes a versioned, content-addressed catalog
  manifest through the portable kernel;
- `conformCatalogsOffline` checks complete application-supplied finite fixture
  domains and returns a content-addressed success report;
- `verifyCatalogConformanceReport` verifies report structure and identity; and
- failures remain `Result` diagnostics rather than exceptions.

M7a will exercise those exports directly. It will not add a new kernel or
generator abstraction unless a concrete public-package consumer fixture cannot
be expressed or diagnosed through the existing exports. Any such failure must be
recorded before an API change is proposed.

## Catalog families and authorship

The vertical slice contains three unrelated realistic families, with two
separately implemented catalogs per family:

1. warehouse replenishment: bounded unit counts, reorder-point decisions, and
   maximum observed demand;
2. urban transit telemetry: bounded delay seconds, service-alert decisions, and
   worst-delay aggregation; and
3. customer-support triage: bounded normalized priority, escalation decisions,
   and highest-priority aggregation.

Each author module owns its schemas, operations, identifiers, descriptions, role
declarations, and catalog construction. It may import only documented root
exports from the two public packages and Zod. Author modules may share the
written role contract and blinded fixture protocol, but no implementation
helper, private source import, workspace-relative package import, TypeGraph
surface, or hidden adjudication label.

Because one development team creates this minimal slice, source-file separation
is only a rehearsal of independent authorship. It is not evidence from genuine
independent authors. The larger study described below requires independently
recruited authors who cannot inspect another author's implementation.

## Versioned declarations and manifests

Every family uses a family-specific role namespace and protocol version `1`.
Every catalog has a distinct catalog, schema, and operation identity. The
consumer fixture will materialize `PlanLanguageManifest` values using a frozen
zero-capability, zero-effect policy and will record catalog fingerprint and
manifest digest in the machine report.

Evolution checks are prospective:

- reconstructing the same catalog in a different registration order must keep
  its fingerprint stable;
- changing catalog identity/version, public schema/operation metadata, or role
  version must change the fingerprint;
- a behavior-preserving catalog version must still require a fresh conformance
  report for its new exact fingerprint;
- a role-version mismatch must reject conformance rather than migrate
  implicitly; and
- old manifests and reports remain immutable and verifiable; they are never
  rewritten to the new fingerprint.

## Blinded cases and adjudication

Trial execution and adjudication are separate data stages.

1. A case registry exposes only opaque case IDs, two catalogs, and a complete
   suite to the runner.
2. The runner records `accepted` or `rejected` plus bounded public diagnostic
   fields. It does not import expected labels while executing cases.
3. A sealed adjudication table maps every opaque ID exactly once to `equivalent`
   or `non-equivalent`, mutation class, and rationale.
4. Only after every runner outcome is frozen and content-addressed does the
   adjudicator join labels and calculate the confusion matrix.
5. Missing, duplicate, or extra IDs invalidate the trial. A rejected positive is
   a false rejection. No manual override can turn it into an accepted pair.

For the future human study, two domain adjudicators independently label each
pair from public contracts and supplied finite domains without seeing tool
outcomes. Disagreement is resolved by a third adjudicator before outcomes are
unblinded. Raw votes, resolution, and rationale are retained. Authors and
adjudicators must disclose conflicts and may not serve in both roles for the
same family.

## Frozen vertical-slice cases

The slice includes one genuinely equivalent author pair per family and at least
two near-equivalent hostile pairs per family. Hostile mutations are chosen to
agree on ordinary examples while diverging at a frozen boundary or authority
condition. The set covers schema-boundary drift, predicate-threshold drift,
reducer behavior or law drift, role-version drift, and complete-fixture coverage
failure. No hostile fixture may be removed after execution; a repaired case
receives a new case ID and belongs to a later protocol version.

Cross-family comparisons must reject because unrelated catalogs do not declare
the same versioned role sets. These structural rejections are protocol checks,
not additional semantic-equivalence observations in the confusion matrix.

## Diagnostics and repairability

Each rejection records only diagnostic code and message. It is scored without
looking at the implementation against three preregistered binary properties:

- `failureClassLocated`: identifies the failed contract class (role set, fixture
  coverage, schema, operation, reducer, pointwise behavior, or effect);
- `targetLocated`: identifies the versioned role when one exists, otherwise
  identifies the catalog/fixture-set boundary; and
- `repairDirectionPresent`: tells an author what declaration, fixture, or
  implementation boundary must be inspected without recommending that a
  rejection be waived.

The slice is large enough to expose diagnostic gaps, not to estimate population
usability. Diagnostic failure never converts a semantic rejection into a pass.

## Deterministic report

The committed UTF-8 JSON report has no clock time, host path, randomness,
credentials, or environment-dependent ordering. It contains:

- protocol and exact package versions;
- case-registry, adjudication, and report digests;
- exact catalog fingerprints and manifest digests;
- per-case blinded outcome, adjudicated label, diagnostic score, and scoped
  conformance-report digest when accepted;
- separate positive and hostile denominators, false-rejection and
  false-equivalence counts and rates;
- evolution and fingerprint-stability outcomes;
- threshold and kill-gate results; and
- decision and explicit nonclaims.

The report is regenerated twice and byte-compared. Its Zod-derived consumer
schema and all input schemas reject unknown fields.

## Prospective metrics and thresholds

The vertical-slice decision uses the following frozen metrics:

| Metric                              |                               Slice threshold |                      Larger-study threshold |
| ----------------------------------- | --------------------------------------------: | ------------------------------------------: |
| Accepted hostile semantic pairs     |                                   exactly `0` |                                 exactly `0` |
| Hostile-case coverage               |                                        `100%` |                        `100%` of frozen set |
| False-rejection rate                |                                         `0/3` | at most `10%`, reported with a 95% interval |
| Equivalent families accepted        |                                         `3/3` |     at least `90%` of adjudicated positives |
| Deterministic report reproduction   |                          byte-identical twice |         byte-identical in two clean CI jobs |
| Exact-role or boundary localization |                  at least `80%` of rejections |                              at least `90%` |
| Failure-class localization          |                  at least `90%` of rejections |                              at least `95%` |
| Repair-direction presence           |                       measured, no slice gate |                              at least `80%` |
| Fingerprint/evolution checks        |                                      all pass |                                    all pass |
| Public-package TypeScript consumer  | TS 6, `skipLibCheck: false`, all strict gates |                                        same |
| Portable public imports             |          Node and Workers package audits pass |                                        same |

The false-rejection rate is never pooled with the false-equivalence rate. The
small slice percentages are protocol checks, not population estimates.

## Kill gates

Any of the following forces `NO-GO` for a larger independent-author study:

- one hostile case is accepted;
- one frozen hostile ID is missing, duplicated, mutated after unblinding, or
  excluded from the denominator;
- a rejected positive is relabeled as equivalent or omitted;
- report identity, catalog fingerprint, manifest digest, or suite digest is
  nondeterministic or unverifiable;
- a role-version mismatch migrates implicitly;
- conformance invokes an effect, provider, credential, network service, or
  model;
- a consumer requires a private import, TypeGraph, relaxed TypeScript checking,
  Node-only primitives in a portable public package, or plan/knowledge/run graph
  conflation; or
- any required verification gate fails.

A diagnostics threshold miss without a semantic-safety failure blocks the larger
study until documentation or diagnostics are repaired and the same frozen cases
are rerun under a new report version. It never changes case labels.

## Proposed larger independent-author study

If the slice passes, preregister a two-stage offline study before recruitment:

- recruit at least six external authors, two per family, with no prior Lachesis
  contribution and no access to counterpart source;
- give authors only packed `0.1.0-alpha.2` artifacts, packaged READMEs, public
  alpha documentation, role-contract briefs, and local fixture values;
- require three independently authored positive pairs plus a frozen set of at
  least 24 adversarial pairs, balanced across families and mutation classes;
- use two independent adjudicators and a prespecified third-adjudicator tie
  break before tool outcomes are revealed;
- freeze case IDs, labels, suites, package tarball hashes, analysis code, and
  thresholds in a content-addressed preregistration;
- report author time, compile attempts, documentation questions, rejected
  declarations, confusion matrix, exact binomial 95% intervals, diagnostic
  scores, and repair success on a separately versioned second attempt; and
- stop immediately on any accepted hostile pair. Repairs may improve later
  diagnostics or false rejection but cannot erase the primary failure.

This is a conformance-usability study, not a model-quality study. No live model,
provider, learned strategy, promotion lifecycle, or TypeGraph comparison is in
scope.

## Smallest implementation slice

1. Add one private public-package consumer fixture with six independent-style
   author modules, three suites, a blinded runner, sealed adjudication, hostile
   mutations, evolution checks, and a deterministic JSON report.
2. Add behavioral tests for every positive, hostile, structural, evolution,
   report-integrity, and label-integrity path.
3. Add an external catalog-author guide based only on public exports, including
   migration, finite-domain limitations, diagnostics, and repair workflow.
4. Add a machine-readable result and a concise result document with an explicit
   `GO` or `NO-GO` decision.
5. Extend existing example/package verification only as needed to compile and
   execute the consumer through package entrypoints. Do not change the kernel or
   generator API unless a recorded consumer failure makes that unavoidable.

## Verification matrix

Before handoff run formatting check, TypeScript 6 strict typecheck with
`skipLibCheck: false`, type-aware lint, focused M7a tests, the full test suite
with coverage, build, package smokes, Node and Workers smokes, CLI valid and
invalid smokes, public example execution, packed-package offline install/audit,
public API audit, release checksum audit, source-safety/unsafe-escape audit,
`git diff --check`, and a direct scan for `any`, double assertions, non-null
assertions, suppression comments, raw `JSON.parse`, Node primitives in portable
packages, credentials, and provider calls introduced by M7a.

## Nonclaims

M7a will not claim universal extensional equivalence, semantic equivalence
outside supplied fixtures, genuinely independent authorship from the internal
slice, compositional generalization, model quality, strategy transfer,
production readiness, provider superiority, TypeGraph quality, security
certification, or permission for live inference, promotion, publication, or
spending.
