# M8b.0 threat and misuse analysis

The proposed CLI processes trusted executable catalog modules and untrusted data
artifacts. Keeping those trust classes explicit is the primary safety boundary.

| Threat or misuse                               | Required control                                                                                                        | Failure behavior                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Importing an untrusted catalog executes code   | Document catalog modules as trusted project code; accept only local compiled ESM selected explicitly by path and export | Reject unsupported locators before import                            |
| Source-string or remote-code execution         | No source evaluation, TypeScript loader, remote URL, callback, or implicit package resolution                           | Usage or invalid-input exit                                          |
| Manifest substitution                          | Source-bound regeneration and exact canonical identity comparison                                                       | Stable identity diagnostic and exit 22; never continue to comparison |
| Report or nested diagnostic tampering          | Verify envelope digest, derived summary, exit code, nested diagnostic identities, and referenced artifact checksums     | Exit 22                                                              |
| Repair laundering                              | `autoAccepted` is structurally `false`; declaration repairs are conditional and require a distinct post-repair run      | Exit 11 until independently rerun                                    |
| Manufacturing semantic equivalence             | Genuine differences require `do-not-substitute`; renderer must not offer metadata repair                                | Exit 12                                                              |
| Cardinality collapse hides failures            | Validation attempts and conformance records use separate arrays; summary is derived                                     | Invalid report if summary disagrees                                  |
| Initial result overwritten by repair           | Outcomes carry unique identities and explicit `initial` or `post-repair` phase                                          | Reject duplicate or missing initial histories                        |
| Heuristic prose mistaken for truth             | Render guidance as conditional, attribute its source, and never change the machine disposition from prose               | Machine disposition remains authoritative                            |
| Nondeterministic identity                      | Canonical JSON, LF termination, sorted detailed records, no timestamps or absolute paths in identity-bearing body       | Verification or golden-determinism failure                           |
| Path disclosure                                | Redact absolute paths, environment data, credentials, and source excerpts from reports                                  | Report generation fails closed if redaction status is incomplete     |
| Symlink/output overwrite                       | Resolve and validate inputs before writes; use create-new temporary output followed by atomic rename in M8b.1           | Invalid input or controller failure                                  |
| Time-of-check/time-of-use change               | Read each input once, hash those bytes, and operate on the bound in-memory value                                        | Incomplete or identity-mismatch exit                                 |
| Unsupported schema version                     | Exact protocol-major match; no best-effort coercion                                                                     | Exit 20                                                              |
| Resource exhaustion                            | File-size, record-count, and recursion-depth limits at the CLI boundary                                                 | Exit 23 when bounded work cannot complete                            |
| Internal exception exposed as domain rejection | Expected failures remain `Result`; sanitize the outer CLI failure                                                       | Exit 70                                                              |

## Diagnostic safety invariants

1. A declaration-repairable result is not equivalent.
2. Applying a proposed repair is never part of a conformance command.
3. A repaired declaration produces a new catalog/manifest identity and a
   separate `post-repair` outcome.
4. Genuine non-equivalence cannot carry a patch action.
5. Insufficient evidence cannot be promoted to equivalence.
6. Human wording cannot override a stable machine disposition or exit code.

## Report verification limitations

Checksum verification proves identity and integrity, not semantic truth. The
human renderer must say this explicitly. A valid report may faithfully record an
invalid catalog or a rejected comparison. `report verify` returns success only
when the report and referenced artifacts are intact; it also prints the recorded
command outcome so users do not confuse integrity with acceptance.

## Supply-chain boundary

M8b.1 must be tested as a packed npm consumer using the public package
allowlist, strict TypeScript 6, and `skipLibCheck:false`. It must not depend on
workspace-only modules, private fixtures, benchmarks, Drizzle, SQLite,
TypeGraph, provider SDKs, or credentials. Publication and trusted provenance are
separate release work.
