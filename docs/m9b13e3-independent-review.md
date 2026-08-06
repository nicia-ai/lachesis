m9b13e3-phase-separated-amendment-review-no-go

Seven blocking findings remain:

1. [P0, confidence 10/10]
   `packages/generator-ai-sdk/internal/m9b13e3-phase-separated-readiness.ts:1201`
   accepts caller-supplied `currentLedgerRoot`, `terminal: false`, and a
   disconnected three-event chain. It never consults the ledger or validates the
   full monitoring lineage. A synthetic chain beginning at unrelated
   revision/root 80 was accepted.
   - Invariant: effects require the current, nonterminal, admission-bound ledger
     head with no prior invariant loss.
   - Consequence: fabricated state can authorize a prospective boundary effect.
   - Correction: require an opaque ledger-head proof, validate the complete
     monitoring receipt, and derive current status/root/revision and
     invariant-loss absence from that ledger.

2. [P0, confidence 10/10]
   `packages/generator-ai-sdk/internal/m9b13e3-phase-separated-readiness.ts:258`
   allows every non-`phase-commit` event regardless of phase and does not
   recompute its digest/resulting root. A `boundary-dispatch-effect` was
   successfully persisted before reservation or admission, leaving the session
   inventory empty.
   - Invariant: every ledger transition requires phase eligibility, canonical
     hash continuity, and CAS continuity.
   - Correction: enforce permitted event kinds per session status, validate
     references and hashes, and reject all effects unless the committed status
     is `active-monitoring`.

3. [P0, confidence 10/10]
   `packages/generator-ai-sdk/internal/m9b13e3-phase-separated-readiness.ts:964`
   checks that a completion event exists but never requires
   `completion === "completed"`. An `ambiguous` completion passed monitoring and
   then produced `trusted-session-completed` after sealing.
   - Invariant: ambiguity fails conservatively and no failure may reach
     `sealed`.
   - Correction: successful monitoring must require every completion to be
     unambiguous; ambiguity must enter invariant-loss, quarantine/stop, and
     terminal failure accounting.

4. [P0, confidence 10/10]
   `packages/generator-ai-sdk/internal/m9b13e3-phase-separated-readiness.ts:1554`
   relies on a TypeScript-only context type. Runtime code ignores the protocol,
   accepted decision, authorization identity, registry identity, and embargo
   identity. A context omitting all those fields still authorized submission.
   The body also has no author commitment, so self-review cannot be rejected.
   - Invariant: only opaque, externally issued authority binding every required
     identity may authorize submission.
   - Correction: use a strict runtime schema and non-caller-constructible
     authority handle; verify every field and bind distinct body-author and
     reviewer commitments.

5. [P1, confidence 10/10]
   `packages/generator-ai-sdk/internal/m9b13e3-phase-separated-readiness.ts:1102`
   transitions to `closed`, then appends the terminal census and terminal
   commit. Neither schema nor documentation distinguishes state closure from
   final event-stream closure.
   - Invariant: no event may follow final closure unless the two closure
     concepts are explicitly separated and post-state-close events cannot
     authorize effects.
   - Correction: place terminal census immediately before `terminal-close`, or
     model and validate separate state-closed and stream-finalized transitions.

6. [P1, confidence 10/10]
   `packages/generator-ai-sdk/internal/m9b13e3-phase-separated-readiness.ts:1502`
   only checks that all required historical NO-GOs occur somewhere. A
   caller-added history entry was accepted after digest recomputation.
   - Invariant: the frozen historical inventory must be exact and deterministic.
   - Correction: require canonical equality with one exact, duplicate-free
     inventory and similarly enforce unique canonical checksum paths.

7. [P1, confidence 9/10]
   `packages/generator-ai-sdk/internal/m9b13e3-phase-separated-readiness.ts:612`
   creates a new event-ID set for each phase. Duplicate IDs across admission,
   monitoring, and terminal artifacts therefore pass, and multiple structurally
   valid monitoring branches can bind one admission without ledger arbitration.
   - Invariant: event IDs and lineage are unique across the complete canonical
     session stream.
   - Correction: validate the concatenated stream or carry a committed
     ID/lineage accumulator across phase boundaries.

Verification otherwise reproduced:

- All three reviewed commits and trees exactly.
- All eight requested artifact digests and nine protocol identities.
- 16/16 predecessor manifests, 10/10 independent-review manifests, and the
  registration receipt.
- 27/27 immutable archive sizes and SHA-256 identities.
- Registration digest
  `ae33915d355ca96aff4b4846a6f2d374491d4d9eea28540d87332368f61ef70b`,
  preregistration digest
  `097d4848a264fc8484ca590c79388e3a00279a6310392205db7868104cee13b4`, and the
  18-field projection
  `e5cd02100a1004849acc18f3f302e880580a38ef45a0733868826c32a23ff282`.
- Exact M9b.13e.2 decision: `m9b13e2-authority-lineage-replay-review-no-go`.
- M9b.12 through M9b.13e.2 remain byte-identical; subsequent changes are
  append-only.
- Focused suite: 26/26. Relevant M9/preregistration: 410/410. Full coverage:
  1,274/1,274 with the recorded coverage percentages.
- Build, TypeScript, lint, source safety, Node/Workers smokes, strict
  JSON/canonicalization, manifests, checksums, Git integrity, local-link and
  secret scans passed offline.
- Five independent hostile probes reproduced the unsafe acceptances above.
- Production build and declarations exclude M9b.13e.3; live authorities remain
  `null` and live entry points stop with zero effects.
- Whole-workspace Prettier still reports the pre-existing protected
  `docs/m9b13b-independent-review.md`; every M9b.13e.3 changed file passes
  formatting.
- No repository files were modified. Final status contained only the
  pre-existing `.DS_Store` and `paper/` files.

No supplement was prepared or submitted.

Disposition:
`reviewed-no-go-not-live-eligible-superseded-only-as-operational-amendment-text-by-m9b13f`.

M9b.13e.3 code is not corrected. Its validators, synthetic ledger, admission
APIs, monitoring APIs, terminal receipts, and submission harness are prohibited
from live use and cannot be evidence of readiness. They cannot be activated by a
later configuration-only change. Any future readiness implementation requires a
new protocol identity, a new implementation, hostile testing, and independent
review.
