# M8b.1 Stage 4 results

Status: `complete-offline-pass`

Stage 4 implements the private suite-backed `lachesis catalog compare` path
defined by the frozen Stage 4a protocol and its Stage 4a.1 diagnostic-manifest
correction. It adds no public export, changes no public protocol or package
version, and performs no provider call.

## Result

Suite mode now requires both `--suite <compiled-esm#export>` and
`--conformance-out <file>`, plus a file-backed `--report`. Structural mode
retains its Stage 3 behavior and does not load the generator package. After
source, alias, optional-manifest, and suite-export gates pass, suite mode
dynamically loads the generator once, validates the suite, and calls
`diagnoseCatalogsOffline` exactly once.

One verified native assessment becomes one initial conformance record:

- a conformant report is verified, canonically persisted, and bound by both
  semantic digest and raw-byte SHA-256;
- a rejected diagnostic is verified and embedded in the command report, with
  conditional declaration guidance, explicit `do-not-substitute`, or
  insufficient-evidence guidance as appropriate;
- no repair is applied and no post-repair assessment is synthesized.

Catalog fingerprints and the suite digest are reconciled against independently
acquired CLI inputs. CLI manifest identities remain command inputs.
Generator-native diagnostic manifest identities are verified as part of the
complete diagnostic but are not compared with CLI manifests produced under
different compilation policies.

Compilation-policy differences are computed directly from the supplied policies
and remain review-required. Finite suite passage cannot erase that review. A
conformant suite with a policy difference exits 10 and renders:

> FINITE SUITE PASSED; COMPILATION POLICY REVIEW REMAINS. No compatibility or
> substitution claim is made.

## Artifact transaction

Conformant mode constructs and verifies both outputs before mutation, stages
both privately, installs the conformance artifact first, and installs the
command report last as the sole logical commit marker. Existing regular files
are retained as descriptor-bound rollback inputs when `--replace` is present.
Detected commit failure restores or removes both outputs and exits 23;
unverifiable rollback exits 70. Rejected assessments never touch the requested
conformance target. Any post-parse failure before report commitment emits one
deterministic stdout report with no artifact claim.

## Verification

- Focused Stage 4 matrix: 61/61 tests across six files.
- Complete repository tests: 421/421 across 30 files.
- Coverage: 90.10% statements, 80.20% branches, 97.25% functions, 94.15% lines.
- Formatting, strict TypeScript 6, lint, build, Node smoke, Workers dry-run,
  examples, load baseline, source-safety, public API inventory, M7c
  preregistration audit, M8a, and M8b.0 passed.
- Registry-packed, workspace-free consumer passed structural and suite modes
  under Node 24.18.0 and TypeScript 6.0.3 with `skipLibCheck: false`.
- All historical M8 checksums and the frozen Stage 4a/4a.1 checksums passed.
- The known alpha.3 workflow-only release-checksum mismatch remains preserved;
  no release artifact or metadata changed.

## Boundaries

This is finite offline conformance evidence only. It does not establish general
semantic equivalence, substitutability, safe migration, model quality, or
compositional generalization. Stage 5 and Stage 6 were not started.
