# M8b.1 Stage 4a semantic-conformance protocol closure

Status: `complete-offline-design`; implementation is not part of Stage 4a.

Bound parent commit: `b296694460037e8c196c8376cf42183c5a02c7d4`.

This document closes the prospective protocol for suite-backed
`lachesis catalog compare`. It preserves `lachesis-catalog-command-report/1`,
`lachesis-canonical-json/1`, the frozen exit-code precedence, and the Stage 2a
file-security boundary. It does not authorize a command implementation,
publication, or a compatibility claim beyond a supplied finite suite.

## Exact command and flag grammar

The future Stage 4 semantic form is:

```text
lachesis catalog compare \
  --left-catalog <compiled-esm-path>#<named-export> \
  --left-policy <compiled-esm-path>#<named-export> \
  --right-catalog <compiled-esm-path>#<named-export> \
  --right-policy <compiled-esm-path>#<named-export> \
  [--left-manifest <file>] \
  [--right-manifest <file>] \
  --suite <compiled-esm-path>#<named-export> \
  --conformance-out <file> \
  --report <file> \
  [--project-root <directory>] \
  [--replace]
```

The grammar is deliberately narrower than structural comparison:

- `--suite` and `--conformance-out` require each other.
- In suite mode, `--report -` is a usage error. Two file outputs are required so
  the report can act as the durable transaction commit marker.
- `--conformance-out` is forbidden without `--suite`.
- Every singleton flag occurs exactly once at most.
- Unknown flags, `--suite` without `--conformance-out`, the inverse, a missing
  value, `--report -`, or a malformed locator exits `64` and emits no command
  report.
- `--left-manifest` and `--right-manifest`, when present, must match their
  independently regenerated source-bound manifests exactly.
- `--replace` applies only to outputs actually produced. A rejected native
  assessment produces no conformance artifact and never modifies the
  `--conformance-out` target.

The suite source, left catalog source, right catalog source, supplied manifests,
conformance output, and command report must be distinct after normalized
project-root resolution. A catalog and policy locator for the same side may
intentionally name different exports from one source module, as in the frozen
command example; that module is acquired and executed once. No other source
alias is allowed. Every artifact path is distinct from every source and other
artifact path. Aliasing rejects before module execution or filesystem mutation.
The conformance output and command report may reside in different directories
beneath the project root; each rename is atomic only within its own parent.

## Acquisition, validation, and native assessment

Stage 4 must retain the Stage 2a acquisition contract:

1. Parse the complete command and reject aliases before execution.
2. Acquire each unique catalog, policy, and suite source module once using the
   descriptor-bound, bounded, `O_NOFOLLOW` reader.
3. Bind each locator to the acquired module-byte digest and named-export locator
   digest.
4. Execute each unique verified source module once. Revalidate descriptor/path
   identity and exact bytes at every Stage 2a boundary through export lookup.
5. Regenerate and reconcile both catalog manifests and any supplied manifests.
6. Only when `--suite` is present, dynamically import
   `@nicia-ai/lachesis-generator` once. Structural mode must not load it.
7. Validate the named suite export with
   `catalogConformanceSuiteSchema.safeParse` before diagnosis. Unknown fields or
   a malformed suite are invalid input, not finite evidence.
8. Compute the canonical suite digest from the validated suite and call
   `diagnoseCatalogsOffline` exactly once with the two validated catalogs and
   that suite.

The returned discriminated assessment has exactly one native result:

- `kind: "conformant"`: verify it with `verifyCatalogConformanceReport`;
- `kind: "rejected"`: verify it with `verifyCatalogConformanceDiagnostic`.

Verification failure is an identity mismatch (`22`), not a semantic outcome. No
second diagnostic pass, automatic repair, or post-repair assessment is allowed.

## Input and identity reconciliation

The command report explicitly binds:

- four catalog/policy module-byte digests;
- four catalog/policy export-locator digests;
- the two regenerated manifest digests;
- the suite module-byte digest;
- the suite export-locator digest; and
- the digest of the validated suite value.

The native result must reconcile with those inputs:

- both native catalog fingerprints equal the independently regenerated manifest
  catalog fingerprints;
- diagnostic manifest digests equal the regenerated manifest digests;
- the native `fixtureDigest` equals the validated-suite digest; and
- the native report or diagnostic identity passes its public verifier.

The comparison identity is the digest of the command protocol, command version,
left and right manifest digests, validated-suite digest, and the literal mode
`finite-semantic-conformance`. The conformance-record identity additionally
binds the comparison identity, native result kind, and native report or record
digest.

Exactly one native assessment becomes exactly one `diagnostics.conformance`
record:

- conformant: `result: "conformant"`, `reportIdentity` is the native
  `reportDigest`, and `diagnostic` is `null`;
- rejected: `result: "rejected"`, `reportIdentity` is `null`, and the verified
  diagnostic is embedded.

Summaries derive from this record. Duplicate or missing native records are
controller invariant failures (`70`).

## Conformance artifact contract

A conformant native report is serialized as canonical JSON under
`lachesis-canonical-json/1` plus exactly one trailing LF. The bytes are written
only to the explicit `--conformance-out` path.

The command report contains one artifact entry:

```json
{
  "id": "native-conformance-report",
  "kind": "conformance-report",
  "mediaType": "application/json",
  "digest": "<native reportDigest>",
  "checksum": {
    "algorithm": "sha256",
    "value": "<SHA-256 of canonical bytes including trailing LF>"
  }
}
```

`digest` is the semantic native report identity. `checksum.value` is the raw
artifact-byte identity. The conformance record's `reportIdentity` must equal the
artifact's `digest`.

A rejected assessment embeds its verified diagnostic in the command report, has
no diagnostic sidecar, has no conformance artifact entry, and does not create or
replace `--conformance-out`. The path is nevertheless mandatory so argument
identity and alias checks do not depend on the semantic outcome.

## Policy changes and finite-evidence nonclaims

The suite evaluates finite catalog-role behavior. It does not evaluate or prove
compilation-policy equivalence.

- A conformant native result establishes conformance only on the supplied finite
  suite.
- Every structural policy, capability, or budget difference remains a
  `declaration-review` migration with `review-required` guidance.
- Conformant finite evidence plus any unresolved policy difference exits `10`.
- Human output must include:
  `FINITE SUITE PASSED; COMPILATION POLICY REVIEW REMAINS. No compatibility or substitution claim is made.`
- A suite pass must never delete, downgrade, or relabel a structural policy
  review.

Catalog structural differences covered by the verified suite may be described
only as finite-suite conformance. The command must not state semantic
equivalence, general substitutability, safe migration, or compositional
generalization.

Suite mode does not translate non-policy catalog deltas into the frozen
`identity-only`/`compatible` migration vocabulary because that wording would
overclaim. The one native conformance record carries the finite result; the
manifest identities preserve the fact that the catalogs differ. Authors can run
the Stage 3 structural command separately for its detailed structural delta.

## Suite-validity and migration mapping

Validation and evidence sufficiency are separate:

| Condition                                                        | Detailed record                                             | Migration guidance                                                                   | Exit |
| ---------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---: |
| Suite fails strict schema validation                             | `INVALID_SUITE` controller diagnostic                       | none                                                                                 |   20 |
| Valid suite is incomplete, duplicated, or otherwise insufficient | one rejected native diagnostic                              | `invalid-or-unverifiable`; add/remove fixture only when the native action permits it |   13 |
| Declaration is repairable                                        | one rejected native diagnostic                              | `review-declaration`, conditional, never auto-accepted                               |   11 |
| Genuine semantic difference                                      | one rejected native diagnostic                              | prominent `do-not-substitute` with violated obligation                               |   12 |
| Finite suite conforms, no policy review                          | one conformant native record                                | no repair                                                                            |    0 |
| Finite suite conforms, policy review remains                     | one conformant native record plus structural review records | `review-required`                                                                    |   10 |

Only an `initial` migration outcome is recorded. A later repaired declaration
requires a separate invocation and report. Stage 4 performs no repair and never
creates a `post-repair` outcome.

The frozen precedence remains:

```text
70 > 23 > 22 > 20 > 12 > 13 > 11 > 21 > 10 > 0
```

Consequently genuine non-equivalence, insufficient evidence, and declaration
repairability retain precedence over policy review.

## Two-artifact transaction protocol

There is no portable Node/POSIX primitive that atomically publishes two
arbitrary regular files, especially in different directories. Stage 4 therefore
uses a staged logical transaction in which the command report is the sole commit
marker.

### States

| State                  | Durable visible result                          | Meaning                                                                    |
| ---------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| `parsed`               | none                                            | Arguments and locators are valid.                                          |
| `evaluated-rejected`   | none                                            | Verified rejected assessment; only a command report will be produced.      |
| `evaluated-conformant` | none                                            | Verified native report and final command report bytes exist in memory.     |
| `staged`               | private temporary files only                    | Both files are fully written, bounded, fsynced, and re-read by descriptor. |
| `artifact-installed`   | new conformance artifact; no new command report | Uncommitted intermediate state.                                            |
| `committed`            | matching artifact and command report            | The command report rename is the commit point.                             |
| `rolled-back`          | prior files restored or new files absent        | A detected commit failure was recovered.                                   |
| `terminal-failure`     | no valid new commit marker                      | Rollback or invariant failure; exit `70`.                                  |

### Procedure

1. Resolve and validate every parent and leaf using Stage 2a containment,
   symlink, identity, and alias rules.
2. Produce and verify both canonical byte sequences entirely in memory.
3. Stage private same-directory temporary files with bounded writes and modes
   that do not expose them to consumers. Fsync each file.
4. For `--replace`, retain descriptor-bound rollback copies of existing
   regular-file targets. Symlinks and identity drift reject.
5. Revalidate parent identities, containment, final-target identities, staged
   bytes, and source identities.
6. Install the conformance artifact first and fsync its parent.
7. Install the command report last and fsync its parent. This rename is the
   logical commit point.
8. Remove rollback material only after both final files re-read with their
   expected checksums and the report/artifact semantic identities reconcile.

If step 6 or 7 fails, restore both prior targets or remove newly installed
targets, revalidate the result, and remove temporary files. A successful
rollback exits `23`; rollback failure exits `70`. To preserve the frozen
one-report-after-successful-parsing contract, a deterministic incomplete or
internal-failure command report is then emitted exactly once on stdout only when
no new final command report was committed. That failure report contains no
conformance artifact claim and is not a transaction commit marker. Human
diagnostics remain on stderr.

A process or machine crash can occur between two filesystem renames. Physical
multi-file atomicity is therefore impossible under the accepted explicit-file
UX. The fail-closed rule is: a native conformance file without its matching
command report is uncommitted and must never be treated as a Lachesis command
outcome. The future detached verifier must require both files, verify the
artifact entry, and reject a missing, stale, or mismatched pair with `22` or
`23`. Installing the artifact first ensures a crash can never leave a newly
accepted command report whose bound artifact is absent.

Rejected assessments use the existing single-report atomic writer. A failed
report write exits `23`; no conformance output is touched.

## Rendering requirements

The existing stable ordering, redaction, control-character escaping, and
no-ambient-data requirements remain unchanged.

- Declaration guidance is labeled `CONDITIONAL DECLARATION REPAIR` and
  `Not accepted automatically`.
- Genuine differences render `DO NOT SUBSTITUTE` plus the exact role, boundary,
  and violated obligation.
- Insufficient evidence preserves rejection and states which finite evidence is
  missing or duplicated.
- Policy review is rendered separately from suite results.
- No output calls a heuristic, model, or native repair action accepted truth.

## Compatibility decision

No report-schema widening is required. The existing conformance record, artifact
entry, migration categories, summary derivation, status derivation, and exit
precedence encode the prospective behavior exactly.

The future CLI package will require a private dependency on
`@nicia-ai/lachesis-generator`; it must be dynamically loaded only for
`--suite`. No kernel or generator export is missing.

Decision: **GO for a separately authorized Stage 4 implementation**, subject to
the hostile matrix and transaction-state tests in
`m8b1-stage4a-hostile-test-matrix.md`. Stage 5 detached verification, public
packaging, version changes, and publication remain out of scope.
