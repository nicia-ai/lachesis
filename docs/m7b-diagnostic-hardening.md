# M7b offline diagnostic hardening

Status: **complete development GO, scoped only to freezing the M7c protocol**.

M7b addresses the M7a finding that all nine rejections had the right failure
class, role, and boundary, but only one diagnostic contained actionable repair
direction. It does not change the conformance decision, add operation
substitution, execute M7c, invoke a model, begin M8, or establish compositional
generalization.

## Design boundary

`diagnoseCatalogsOffline()` first calls the unchanged `conformCatalogsOffline()`
decision path. A passing comparison returns its ordinary content-addressed
report. A rejection is enriched with a portable, typed diagnostic; no diagnostic
path can convert that rejection into a pass.

Each rejection has exactly one outcome:

- `declaration-repairable`: the declaration may be stale or incomplete, but an
  author must attest the written semantic contract before changing it;
- `genuinely-non-equivalent`: the supplied evidence demonstrates a violated
  semantic obligation and the only guidance is `do-not-substitute`; or
- `insufficient-evidence`: rejection remains in force while the suite is
  repaired or more evidence is collected.

Stable diagnostic codes are separate from prose. Every record identifies the
side, exact versioned role when known, boundary, obligation, catalog
fingerprints, language-manifest identities, fixture identity, and relevant
input/output identities. `diagnosticDigest` identifies semantic diagnostic
content and intentionally excludes unrelated manifest identity; `recordDigest`
binds the full observation. Human rendering is deterministic and machine records
are Zod-validated and content-addressed.

The new public experimental surface is justified by one concrete packed-
consumer failure: M7a consumers could obtain only the kernel's generic
`Diagnostic`, so they could not safely distinguish a declaration review from
proven non-equivalence or automate a suite-only repair. The structured surface
remains in the generator package and does not widen the stable runtime facade.
It is an unpublished development surface recorded in
[`m7b-development-api-inventory.json`](m7b-development-api-inventory.json); the
frozen published alpha.2 inventory remains unchanged.

## Fresh development corpus

The private `m7b.dev` corpus was created after M7a and is reserved for M7b
development. It is prohibited from M7c. Its nine cases cover:

| Case                            | Expected outcome         | Exact boundary           |
| ------------------------------- | ------------------------ | ------------------------ |
| Missing role declarations       | declaration-repairable   | catalog declaration set  |
| Role-version mismatch           | declaration-repairable   | versioned role identity  |
| Missing fixture                 | insufficient-evidence    | suite coverage           |
| Reducer identity/law mismatch   | genuinely-non-equivalent | reducer obligations      |
| Capability mismatch             | genuinely-non-equivalent | effect capability        |
| Effect-contract mismatch        | genuinely-non-equivalent | replay/resource contract |
| Ordering mismatch               | genuinely-non-equivalent | output order             |
| Fixed-point transition mismatch | genuinely-non-equivalent | state transition         |
| Output mismatch                 | genuinely-non-equivalent | pointwise output         |

The hostile cases specifically reject advice that would manufacture equivalence
by aligning metadata. The evolution arm changes irrelevant catalog content while
holding the semantic failure fixed, then changes the relevant output semantics.
The former changes manifest identity but not diagnostic identity; the latter
changes both.

## Preregistered development gates and result

| Gate                                              |           Threshold | Result |
| ------------------------------------------------- | ------------------: | -----: |
| False semantic equivalence                        |                   0 |    0/9 |
| Incorrect or unsafe repair direction              |                   0 |    0/9 |
| Outcome classification                            |                100% |    9/9 |
| Failure, role, and boundary localization          |                100% |    9/9 |
| Safe guidance for declaration-repairable cases    |                100% |    2/2 |
| Explicit non-substitution for genuine differences |                100% |    6/6 |
| Byte-identical deterministic reports              |            required |   pass |
| Irrelevant/substantive identity behavior          | all checks required |   pass |

The canonical machine report is
[`m7b-diagnostic-report.json`](../examples/m7b-diagnostics/reports/m7b-diagnostic-report.json),
with internal report digest
`1dc71b40b919b69d177ed0986962f10f7b7311831dc63df0667891693a75b4c4`. The report
embeds and checks the unchanged M7a digest
`8cc35372ec4f4f560180a2f26cf4edb46c9c298f49f21cc39f8df07cde19cf85`.

## Decision and nonclaims

**GO to freeze the M7c protocol.** This means only that the development
diagnostic substrate met its prespecified gates strongly enough to preregister a
genuinely independent author study.

It is not a GO to execute M7c, publish packages, run live inference, promote a
strategy, begin M8, create a campaign, or claim independent-author usability,
catalog equivalence beyond the finite fixtures, or compositional generalization.
