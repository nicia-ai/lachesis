# M8b.1 Stage 4a.1 diagnostic-manifest binding correction

Status: `complete-offline-pass`.

Parent commit: `6412f30c7c98c4e301f8da0992d4f4973c6ab1a7`.

Stage 4a correctly required native diagnostic identity, catalog fingerprint, and
suite identity verification, but one reconciliation clause was too strong. This
append-only correction supersedes only that clause. Every transaction, artifact,
cardinality, exit, policy-review, and nonclaim decision in Stage 4a remains in
force.

## Reproduced root cause

`diagnoseCatalogsOffline` creates diagnostic evidence manifests under the
generator's private fixed diagnostic policy. The future CLI creates its
source-bound left and right manifests under the independently supplied CLI
compilation policies. A manifest digest binds its policy, so these two valid
manifest classes generally have different digests even though they describe the
same catalog.

The deterministic regression at
`examples/m7b-diagnostics/tests/m8b1-stage4a1-manifest-binding.test.ts` uses
non-default, asymmetric CLI policies and one schema-valid suite case for each
rejected outcome:

| Case                        | Outcome                    | Fingerprints reconcile | Suite digest reconciles | Both manifest digests differ |
| --------------------------- | -------------------------- | ---------------------- | ----------------------- | ---------------------------- |
| missing declarations        | `declaration-repairable`   | yes                    | yes                     | yes                          |
| incomplete fixture evidence | `insufficient-evidence`    | yes                    | yes                     | yes                          |
| output semantics mismatch   | `genuinely-non-equivalent` | yes                    | yes                     | yes                          |

For every case the complete native diagnostic passes
`verifyCatalogConformanceDiagnostic`. The exact observed identities are recorded
in `m8b1-stage4a1-decision.json`.

## Superseded rule

The following Stage 4a prose clause is superseded:

> diagnostic manifest digests equal the regenerated manifest digests

The Stage 4a machine field `"manifestDigestsReconciled": true` is likewise
superseded. Neither original byte is rewritten.

## Correct prospective verification rule

For a rejected native assessment, Stage 4 must:

1. verify the complete diagnostic with `verifyCatalogConformanceDiagnostic`;
2. reconcile `leftCatalogFingerprint` and `rightCatalogFingerprint` against the
   `catalogFingerprint` values in the CLI's independently regenerated
   source-bound manifests;
3. reconcile `fixtureDigest` against the digest of the strictly validated suite
   value;
4. retain both CLI manifest digests independently as command inputs bound to
   their supplied compilation policies; and
5. make no equality comparison between generator-native diagnostic manifest
   digests and CLI manifest digests.

The diagnostic `leftManifestDigest` and `rightManifestDigest` fields remain
generator-native evidence. Their integrity is covered by verification of the
complete diagnostic and its record identity. They are created under the
generator's internal diagnostic policy, whose value and identity are not a CLI
input. The CLI must not copy, duplicate, reconstruct, or depend on that private
policy.

For a conformant native assessment, the existing Stage 4a fingerprint and
validated-suite reconciliation remains unchanged. A conformant native report
contains no diagnostic manifest-digest fields.

## Policy safety

Compilation-policy differences are derived only by structurally comparing the
supplied, validated CLI policies. They are never inferred from, reconciled
against, or suppressed by generator-native diagnostic manifest metadata.

- Every capability or budget difference remains a `review-required` record.
- A conformant suite plus a policy difference still exits `10`.
- Rejected semantic outcomes retain frozen precedence over policy review.
- Native diagnostic metadata can neither erase nor downgrade policy review.

## Corrected hostile gates

The later Stage 4 implementation must pass all original Stage 4a hostile tests
as qualified by these corrections:

| Test                                                                       | Required result                                                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Each rejected outcome with non-default CLI policies                        | Complete diagnostic verifies; fingerprints and suite digest match; differing manifest digests do not reject. |
| Tampered generator-native diagnostic manifest digest                       | Complete diagnostic verification fails; exit `22`.                                                           |
| Tampered diagnostic catalog fingerprint                                    | Complete diagnostic verification or explicit fingerprint reconciliation fails; exit `22`.                    |
| Tampered diagnostic fixture digest                                         | Complete diagnostic verification or explicit suite reconciliation fails; exit `22`.                          |
| CLI manifest digest omitted or changed                                     | Command-input identity verification fails; exit `22`.                                                        |
| Policy difference with any native outcome                                  | Independent structural policy review remains present with frozen precedence.                                 |
| Attempt to duplicate the generator's private diagnostic policy in CLI code | Source-safety/architecture test fails.                                                                       |

## Readiness

The correction regression, strict typecheck, and corrected protocol checks pass.
Decision: **GO for separately authorized Stage 4 implementation**, provided the
future implementation passes both the original Stage 4a hostile matrix and the
corrected gates above.

This is protocol evidence only. No Stage 4 command path, public API, dependency,
version, provider call, repair, or semantic claim was added.
