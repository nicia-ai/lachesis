# M8b.1 Stage 5 results

Status: `complete-offline-pass`

Parent: `0633b576bd254237c1befa5762c8997387bf0ffb`

## Outcome

Stage 5 implements the private detached command:

```text
lachesis report verify \
  --input <command-report.json> \
  [--artifact <artifact-id>=<path> ...] \
  --report <path|->
```

It verifies only supplied report and artifact bytes. It imports no catalog
module, loads no generator, runs no suite or user code, and requires no network,
credential, effect, or provider access.

The verifier rejects unknown report fields/protocols, recomputes the canonical
report identity and all derived outcomes, verifies native diagnostic,
assessment, conformance-record, manifest, and conformance-report identities,
then verifies each explicit raw artifact checksum and semantic digest.
Descriptor-bound bounded reads, normalized-alias rejection, symlink checks,
identity-drift detection, redaction, and atomic no-clobber output are retained.

A valid report that records semantic exit `10`, `11`, `12`, or `13` yields
verifier exit `0`. This confirms integrity only. It never converts the original
catalog result into compatibility, equivalence, substitution, or acceptance.

## CI contract

The tested POSIX policy and GitHub Actions example are documented in
[`m8b1-stage5-ci.md`](./m8b1-stage5-ci.md). Exits `11`–`13` always fail. Exit
`10` fails unless a repository explicitly enables review-required results.
Detached integrity verification is a separate mandatory gate.

The filesystem controls cover the frozen controller and tested mutation model.
They do not claim kernel-atomic isolation from a malicious concurrent process
running as the same operating-system user.

## Verification

| Gate                                         | Result                                                             |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Focused Stage 1–5 suite                      | 8 files, 76 tests, pass                                            |
| Complete repository tests                    | 32 files, 436 tests, pass                                          |
| Coverage                                     | 90.04% statements, 80.30% branches, 97.20% functions, 94.07% lines |
| Formatting, strict TypeScript 6, lint, build | pass                                                               |
| Node smoke and Workers dry-run               | pass                                                               |
| Source-safety and public API inventory       | pass; no public delta                                              |
| Historical M8 checksums                      | pass                                                               |
| Workspace-free packed consumer               | Node 24.18.0, TS 6.0.3, `skipLibCheck:false`, pass                 |
| Provider/model calls                         | 0                                                                  |

The frozen alpha.3 aggregate still reports its known workflow-only checksum
mismatch because `.github/workflows/release.yml` was corrected after the
release-source checksum was frozen. Stage 5 does not touch that workflow or any
release artifact.

Two unchanged benchmark tests separately hit their fixed five-second timeout
during coverage retries. Each passed immediately in isolation (4.09 seconds and
1.50 seconds), and the final complete serial coverage run passed 436/436 tests.
No timeout was relaxed.

No public export, dependency, package version, report protocol, or release
metadata changed. Stage 6 did not begin.
