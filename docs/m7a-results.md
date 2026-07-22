# M7a offline independent catalog conformance vertical slice

Status: **complete-offline-slice-go-for-independent-author-study**

M7a evaluated the public package entrypoints and documentation for
`0.1.0-alpha.2` without network access, provider calls, effects, credentials,
strategy promotion, M8 work, or TypeGraph-specific research. The prospective
plan was frozen before implementing or observing M7a outcomes.

## Result

The role-simulated consumer slice contained independently implemented-style
catalog pairs for warehouse replenishment, transit telemetry, and support
triage. All three adjudicated equivalent pairs passed. All nine frozen hostile
near-equivalence pairs were rejected.

| Metric                           |   Result |              Slice gate |
| -------------------------------- | -------: | ----------------------: |
| False semantic equivalence       |    `0/9` |             exactly `0` |
| False rejection                  |    `0/3` |             exactly `0` |
| Failure-class localization       |    `9/9` |          at least `90%` |
| Role or boundary localization    |    `9/9` |          at least `80%` |
| Repair-direction presence        |    `1/9` | measured; no slice gate |
| Deterministic blinded identity   |     pass |                    pass |
| Evolution and fingerprint checks | all pass |                all pass |

The machine-readable record is
[`m7a-conformance-report.json`](../examples/m7a-independent-catalogs/reports/m7a-conformance-report.json),
with report digest
`8cc35372ec4f4f560180a2f26cf4edb46c9c298f49f21cc39f8df07cde19cf85`.

Catalog fingerprints were stable under reconstruction and registration-order
changes. A behavior-preserving catalog version changed both catalog fingerprint
and manifest digest, required and passed a fresh conformance report, and left
the prior report verifiable. A role-version mismatch rejected rather than
migrating implicitly.

## Diagnostics

Alpha.2 diagnostics reliably located the failed obligation class and role or
catalog boundary in this set. They usually did not identify the divergent input,
side, or concrete repair action: only one of nine rejections contained repair
direction under the conservative preregistered rubric. The external-author guide
therefore documents a fail-closed repair workflow. The larger study must measure
actual repair success and retain its 80% prospective repair-direction gate; this
slice does not claim diagnostic usability is established.

## Decision

**GO** for the proposed larger, entirely offline independent-author catalog
conformance study. The reason is narrow: the public API supported all three
unrelated catalog families without a new abstraction, the primary safety gate
had zero hostile acceptances, false rejection was separately zero, identities
were deterministic, and evolution behaved correctly.

This is not a GO for live inference, operation substitution, strategy promotion,
M8, TypeGraph quality research, deployment, publication, or spending. The
current slice was produced by one development process and is explicitly not
independent-human evidence.

## Nonclaims

M7a does not establish universal extensional equivalence, equivalence outside
the frozen fixture domains, genuinely independent authorship, compositional
generalization, model quality, production readiness, or permission for live
effects or provider dispatch.
