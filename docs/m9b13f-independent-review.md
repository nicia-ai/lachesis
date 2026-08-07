# M9b.13f independent review

Decision: `m9b13f-minimal-operational-supplement-review-no-go`

Four blocking findings:

1. **[P0, confidence 10/10] Body digest does not bind the substantive component
   records.** `docs/m9b13f-operational-supplement/supplement.json:5` defines the
   body digest over `supplement.json` alone. The inventory at lines 56–78
   contains filenames but no hashes for registration binding, historical
   inventory, future requirements, authority boundary, or external-mechanism
   requirements.
   - Violated invariant: the canonical body digest must cover every substantive
     field.
   - Consequence: substantive component bytes can change without changing the
     advertised body digest; only the separately supplied manifest detects it.
   - Correction: bind canonical digests for every substantive component in the
     body projection, or define the body digest over a canonical
     non-self-referential payload manifest, then reseal all identities.

2. **[P0, confidence 10/10] The historical inventory omits the separate M9b.13a
   NO-GO review.**
   `docs/m9b13f-operational-supplement/historical-no-go-inventory.json:35`
   records only the preparation decision and sets `reviewDecision` to `null`.
   Independently inspected M9b.13b evidence binds
   `m9b13a-existing-image-acquisition-review-no-go` and disposition
   `reviewed-but-not-activatable-because-cryptographic-verification-inputs-and-exact-attestation-gates-were-incomplete`.
   - Violated invariant: every material preparation, failure, and independent
     review must have a distinct canonical record.
   - Consequence: the reported count of 16 and the claim of no missing entries
     are false; the correct derived count is at least 17.
   - Correction: add `M9b.13a.review` with its exact decision, disposition,
     source commit/tree, manifest binding, zero effects, and live-use
     prohibition; update counts and reseal.

3. **[P1, confidence 10/10] The author commitment is not an opaque
   author-identity commitment.**
   `docs/m9b13f-operational-supplement/supplement.json:7` contains the SHA-256
   of the publicly guessable fixed string
   `lachesis-m9b13f-static-supplement-author-commitment/1`.
   - Violated invariant: the commitment must bind an author identity strongly
     enough to establish later reviewer separation without publishing personal
     data.
   - Consequence: anyone can reproduce the value, and inequality with a
     reviewer-selected value does not establish different principals.
   - Correction: use a domain-separated commitment to a stable opaque principal
     identity with a privately retained opening, then require the independent
     verifier to validate distinct openings.

4. **[P1, confidence 9/10] The future review-receipt boundary does not
   explicitly deny submission authority.**
   `docs/m9b13f-operational-supplement/supplement.json:38` lists review-receipt
   bindings but does not state that a pass grants no submission authority or
   require a separate exact submission authorization.
   - Violated invariant: independent review and external submission authority
     must remain noncircular and structurally separate.
   - Consequence: a later consumer could interpret a review pass as sufficient
     permission to submit.
   - Correction: bind `reviewPassGrantsSubmissionAuthority: false`, require
     separate submission authorization, and require that authorization to bind
     the reviewed body, receipt, target identity, and embargo.

Other offline checks passed:

- All three commits and trees reproduced; their changed-file counts are exactly
  3, 16, and 5.
- Exactly 21 package files exist, without symlinks, hidden files, aliases, or
  path escapes.
- `CHECKSUMS.sha256` contains exactly 20 payload entries and unambiguously
  excludes itself.
- Manifest digest reproduced:
  `4feb24e72eef0f0994f705645b0d23bccb59783869b403c716c03e368c7a3245`.
- The advertised body digest reproduced mechanically:
  `bda6171ec4c088dfb29ecd3884f9640922a7829e12b64c9a01b9ceaf2df11ab3`; its
  coverage is nevertheless insufficient.
- Seventeen predecessor package manifests, eleven review manifests, and the
  registration receipt passed.
- All 27 registration identities and the receipt digest reproduced.
- The 18-field projection reproduced with zero scientific/financial changes and
  digest `e5cd02100a1004849acc18f3f302e880580a38ef45a0733868826c32a23ff282`.
- Exact assumption, nonclaim, and retained-scope literals are consistent.
- Runtime reuse prohibitions, future readiness requirements, current
  zero-authority boundary, embargo requirements, formatting, JSON duplicate-key
  checks, secret/privacy scans, Git integrity, and predecessor preservation
  passed.
- Repository tests were not run because no code changed.
- No files were modified. The tracked worktree remained clean; protected
  untracked files remained untouched.

This review grants no submission authority. No reviewer commitment or pass
receipt was issued.

Append-only disposition: `reviewed-no-go-superseded-prospectively-by-m9b13f1`.
