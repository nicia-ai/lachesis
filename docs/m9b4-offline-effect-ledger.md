# M9b.4 offline effect ledger and dispatch state machine

M9b.4 is a private, provider-neutral controller boundary. It establishes offline
functional evidence for conservative first-attempt accounting when a provider
effect and durable persistence can be separated by a crash. It does not include
a provider adapter, credentials, network access, a corpus, study execution, or
live authorization.

The internal protocol identity is `lachesis-m9b4-offline-effect-ledger@1.0.0`.
The campaign, attempt, ledger snapshot, event-chain, receipt, settlement, and
rederived-accounting identities are new M9b.4 identities. No earlier M9 artifact
is reinterpreted.

## State machine

Every attempt follows one closed transition sequence:

```text
prepared → reserved → dispatch-started → completed ─┐
                                         failed ────┼→ reconciled
                                         ambiguous ┘
```

`prepared` retains the complete canonical attempt. `reserved` proves that the
maximum input, output, reasoning, wall-clock, and monetary authorization fit the
campaign, provider, phase, arm, and attempt-count ceilings. Both records are
durably committed before session creation. `dispatch-started` is durably
committed before transport invocation and freezes an invocation limit of one and
an automatic-retry limit of zero.

Only the controller invocation that successfully commits `dispatch-started` may
invoke transport. Compare-and-swap failure returns without creating a session or
dispatching. A controller loading `dispatch-started` must assume the effect may
already have occurred, append `ambiguous`, charge the full reservation, and
never redispatch. The same no-redispatch rule applies to `completed`, `failed`,
`ambiguous`, and `reconciled` records.

A complete success or typed provider failure retains exact provider-reported
usage. Usage must match the request input count, remain within every reserved
maximum, and reproduce cost from the bound immutable pricing snapshot. Missing,
malformed, over-limit, or price-inconsistent usage is ambiguous. Ambiguity is a
terminal first-attempt outcome: unsuccessful, unscorable, non-repairable, and
charged at the full authorization.

## Attempt and ledger bindings

The content-addressed attempt identity binds:

- campaign and comparison digests;
- arm, phase, and call index;
- exact canonical request bytes and digest;
- provider, model, tokenizer, and pricing artifact identities;
- the complete reservation and budget-envelope digests; and
- exact request input-token accounting.

An arm/phase/call coordinate cannot be rebound to another request inside the
same comparison. Completed and failed receipts repeat the attempt, request,
provider, model, tokenizer, and pricing identities. Output, typed failure,
usage, receipt, terminal event, and settlement each have canonical identities.

Ledger events form a canonical hash chain with an exact index and previous-event
digest. The snapshot has a separate outer digest and campaign binding. Loading,
appending, resume, and inspection rederive the entire chain, every attempt,
historical reservation admission, each receipt, usage and pricing, and every
settlement. Re-signing only an outer snapshot cannot legitimize an altered
request, reservation, receipt, usage record, or chain.

## Persistence and crash rule

The controller depends on a private durable compare-and-swap persistence
interface. A write commits canonical snapshot bytes only if its expected
revision is current. The controller does not advance in memory before that
commit succeeds.

The conservative cases are:

| Last provable state     | Resume action                               |                       Transport calls on resume |                            Charge |
| ----------------------- | ------------------------------------------- | ----------------------------------------------: | --------------------------------: |
| `prepared`              | retry reservation admission                 | 0 until reservation and dispatch-started commit |               none until reserved |
| `reserved`              | commit dispatch-started, then dispatch once |                                       at most 1 | full reservation until reconciled |
| `dispatch-started`      | mark ambiguous and reconcile                |                                               0 |                  full reservation |
| `completed` or `failed` | validate receipt and reconcile              |                                               0 |           verified provider usage |
| `ambiguous`             | reconcile                                   |                                               0 |                  full reservation |
| `reconciled`            | return the verified terminal result         |                                               0 |               retained settlement |

A storage backend may commit a write while losing its acknowledgement. Resume
therefore reads the authoritative snapshot: a committed terminal receipt can be
settled without dispatch, while an uncommitted terminal receipt leaves
`dispatch-started` and becomes ambiguous. Repeated resume has zero provider
effects in either case.

## Accounting and evidence

Accounting is never accepted as a caller-authored summary. It is rederived from
the verified ledger for the whole campaign and independently for every provider,
phase, arm, and request digest. Until a terminal receipt is durably reconciled,
the active charge remains the maximum reservation. Remaining capacity and the
accounting receipt digest are recomputed on every inspection.

The focused offline suite contains 20 tests. It covers pre-dispatch persistence
failures, crashes around dispatch, commit-without-ack behavior, response and
settlement persistence failures, complete and failed receipts, malformed and
inconsistent usage, concurrent controllers, tampering, every resumable state,
asymmetric arm ambiguity, exact accounting, zero-effect repeated resume, and a
property check of pricing reconciliation. All transports are deterministic
in-process interceptions with zero network access.

## Decision

- **GO:** a separately scoped M9b.5 offline intercepted provider-adapter
  conformance milestone may depend on this controller.
- **NO-GO:** corpus materialization, credentials, provider calls, external
  preregistration, campaign execution, or any superiority claim.

M9b.5 must separately prove exact request serialization, the real tokenizer
boundary, usage and pricing interpretation, cancellation, and zero-retry adapter
behavior without network calls. Ambiguous post-effect persistence in a future
live backend remains intentionally record-sacrificing rather than silently
retryable.

This AI-assisted architecture and security work is not a professional security
audit, penetration test, or compliance assessment.
