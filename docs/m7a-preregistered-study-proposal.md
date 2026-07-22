# Proposed M7a independent-author study preregistration

Status: **proposal only; no authors recruited and no study started**

This protocol may be registered only after the offline vertical slice and all
release verifications pass. Registration does not authorize provider calls,
model inference, strategy promotion, M8 work, TypeGraph research, credentials,
publication, or spending.

## Objective and estimands

The primary estimand is the false-semantic-equivalence rate among a frozen set
of adjudicated non-equivalent catalog pairs evaluated on complete frozen finite
domains. The primary safety hypothesis is operational rather than
noninferential: the study passes only with zero accepted hostile pairs.

Secondary estimands are reported separately:

- false-rejection rate among adjudicated equivalent pairs;
- successful catalog construction without maintainer intervention;
- first-attempt declaration and fixture validity;
- diagnostic failure-class and target localization;
- repair-direction presence and second-attempt repair success; and
- author time and number of compile/conformance attempts.

No secondary result can offset one false semantic equivalence.

## Participants and independence

Recruit at least six catalog authors, two for each of warehouse replenishment,
transit telemetry, and support triage. An author is eligible only if they have
not contributed to Lachesis or seen the counterpart implementation. Authors work
in isolated repositories and may not communicate about implementations.

Give authors only hashed packed artifacts for public version `0.1.0-alpha.2`,
packaged READMEs, `docs/public-alpha.md`, the external-author guide, a family
role-contract brief, and public finite fixture values. Do not provide repository
source, M6/M7a test implementations, private imports, or adjudication labels.

## Frozen material

Before recruitment, content-address and publish internally:

- package tarball hashes and Node/pnpm/TypeScript versions;
- author instructions and role-contract briefs;
- three positive pair IDs and at least 24 hostile pair IDs, balanced across the
  three families and schema boundary, predicate/function boundary, reducer
  behavior/law, effect authority if present, and role-version classes;
- complete suite values and the rule forbidding post-outcome removal;
- the sealed adjudication form, analysis program, report schema, thresholds, and
  exact-binomial interval method; and
- conflict disclosures and the random assignment seed or digest-derived
  assignment algorithm.

Hostile mutations should match common examples and diverge on frozen boundary or
authority cases. A repaired or replaced case receives a new protocol version and
cannot erase an outcome from the primary set.

## Blinding and adjudication

The runner sees opaque pair IDs, catalogs, and suites but no expected labels.
Two independent domain adjudicators label each pair from the written contract
and finite domain without seeing runner outcomes. They record label, rationale,
and confidence. Disagreement goes to a prespecified third adjudicator before
unblinding. Authors may not adjudicate their own family.

The outcome file is content-addressed before it is joined to the sealed labels.
Missing, duplicate, or extra IDs invalidate the run. Accepted hostile pairs are
never relabeled; rejected positives remain false rejections.

## Analysis and thresholds

Report the complete confusion matrix and exact two-sided 95% binomial intervals
for false equivalence and false rejection. Zero observed false equivalences is
required but is not proof of a zero population rate; the upper confidence bound
must be shown prominently.

The prospective gates are:

- exactly zero accepted hostile pairs and 100% hostile coverage;
- at least 90% of equivalent pairs accepted, with every rejection retained;
- byte-identical reports from two clean offline CI jobs;
- at least 90% exact-role or catalog/fixture-boundary localization;
- at least 95% failure-class localization;
- at least 80% repair-direction presence;
- all catalog-evolution, role-version, prior-report verification, and
  fingerprint-stability checks pass; and
- all strict TypeScript, Node, Workers, packaging, safety, test, and coverage
  gates pass.

Stop immediately and return `NO-GO` on a false equivalence, effect/provider or
network activity, label leakage, denominator change after unblinding, identity
nondeterminism, private import, TypeScript relaxation, or failed required
verification. Diagnostic or usability misses also return `NO-GO` for widening,
but never change semantic classifications.

## Reporting and decision

The machine report contains no time, host path, credentials, or unstable order.
It records exact package, catalog, manifest, suite, blind-outcome, adjudication,
and report identities; every case outcome; separate denominators; diagnostic
scores; evolution results; all gates; and nonclaims.

`GO` means only that a subsequent larger offline catalog-conformance study or a
diagnostic-improvement iteration is justified. It does not authorize operation
substitution, inference, strategy promotion, M8, deployment, publication, or a
claim of universal equivalence or compositional generalization.
