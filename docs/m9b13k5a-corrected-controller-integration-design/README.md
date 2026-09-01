# M9b.13k.5a corrected controller-integration design

This append-only milestone corrects the pure, offline M9b.13k.5 design. It does
not alter M9b.13k.5 or any predecessor. M9b remains NO-GO.

The implementation contains only schemas, pure state/replay logic, opaque test
capabilities, cryptographic verification, frozen fixtures, and hostile tests. It
contains no launcher, credential access, transport, native-ledger invocation,
custodian process, controller activation, OSF or Waterbutler access, network
call, upload, download, revocation, provider/model call, browser action, or
external effect.

The corrected boundaries are:

1. proposed discriminated controller event payload;
2. complete accepted native-ledger receipt supplied by an opaque adapter;
3. authenticated retained receipt;
4. exhaustive replay result that ordinary JSON cannot construct;
5. one-use dispatch permit issued only after durable permit-consumption receipt;
6. strict raw-byte response parsing and exact evidence-based reconciliation;
7. genuine Ed25519 custodian verification with exact lineage and deadlines.

Only future stages 1–4 are modeled. Stages 5–10 remain frozen contracts and are
not implemented. The terminal package decision remains one of the two exact
M9b.13k.5a independent-review dispositions.
