# M7 results and closure

Status: **complete-mixed**

M7 is closed. M7a and M7b completed as finite offline development trials. M7c is
closed unexecuted because the operational isolation surface did not satisfy its
fail-closed protocol. No further M7 amendment, materialization, credential,
probe, author, adjudication, or analysis work is authorized by this closure.

## Final dispositions

| Milestone | Disposition                                     | Evidence boundary                                                             |
| --------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| M7a       | `complete-offline-pass`                         | Three frozen catalog families, three equivalent pairs, and nine hostile pairs |
| M7b       | `complete-offline-pass`                         | Nine fresh development diagnostics                                            |
| M7c       | `closed-unexecuted-operational-isolation-no-go` | Operational preparation only; no scientific execution                         |
| M7        | `complete-mixed`                                | M7a/M7b offline passes plus M7c operational no-go                             |

The immutable M7a report digest is
`8cc35372ec4f4f560180a2f26cf4edb46c9c298f49f21cc39f8df07cde19cf85`. The
immutable M7b report digest is
`1dc71b40b919b69d177ed0986962f10f7b7311831dc63df0667891693a75b4c4`. The terminal
M7c preparation records bind the M7c.4 disposition
`16ee48d6cdb90d90f3e05f92b47cb60ddb862ac9f2ecd68cb5abf28337a21c0b` and M7c.4.1
failure `e8a2ba934912d468b97e2b693c6438f391010feb069359f359ffc5225ed96aa2`.

## What the evidence says

M7a accepted all three frozen equivalent pairs and rejected all nine frozen
hostile near-equivalence pairs. It observed zero false acceptances and zero
false rejections in that finite role-simulated slice. M7b preserved every
rejection, classified all nine development cases, supplied safe guidance for
both declaration-repairable cases, and supplied explicit non-substitution
guidance for all six genuinely non-equivalent cases. It observed zero unsafe
repair directions in that finite development corpus.

These are useful offline engineering results. They do not become independent
author evidence merely because M7c was prepared.

## Why M7c is a no-go

M7c's scientific protocol required stronger isolation than the preparation
infrastructure repeatedly demonstrated. The final M7c.4 controller
materialization was blocked because it reused a historical request identity. The
prospective M7c.4.1 correction then failed its disclosure boundary when a
repository-wide search could not prove that sealed JSON remained unread.
Fail-closed handling was correct: the candidate identity was retired, no
credential was issued, no request was dispatched, and no study role ran.

This is an operational-isolation no-go, not a negative scientific finding about
catalog authors or Lachesis semantics.

## Security and control-plane closure

Secure deletion and absence of the M7c.4 Ed25519 receipt-signing private key and
its custody nonce were verified. Only its public identity
`m7c4-receipt-ed25519-2256c8e7ba0c36704e633df5`, public-key digest
`2256c8e7ba0c36704e633df5c326e0b79a991964eb54da99f4d3b5189845b959`, and original
custody commitment
`a78df1732562af4d820c328dbf54648f33535ff79455c8feb49bcc0163fda622` remain in the
audit record.

A read-only control-plane audit of project `proj_sB5DxgYcwy8cTRqFxu5D0Ovo`
showed zero active project API keys and an unchanged project spend limit of
exactly USD 80.00. No credential was created, read, or deleted during that
audit, and no Responses request was made.

## Exact nonclaims

- No M7c author, adjudicator, or analysis role ever executed.
- No M7c provider or model request occurred.
- No M7c scientific outcome exists.
- No independent-human or independent-agent evidence was obtained.
- No compositional-generalization claim is supported.
- M7a and M7b remain finite offline evidence over their frozen fixtures.
- Alpha.3's published diagnostic API remains valid and unchanged.
- Every retired corpus, request identity, signing key, controller binding,
  materialization, and partially derived identity is immutable and non-reusable.

M7 does not authorize M8, another study, provider access, package publication,
or reinterpretation of a rejected or unexecuted record.

## Related records

- [M7 machine result](m7-results.json)
- [M7 milestone timeline](m7-timeline.md)
- [M7 failure taxonomy](m7-failure-taxonomy.md)
- [M7 technical lessons](m7-technical-lessons.md)
- [Immutable M7 bindings](m7-artifact-bindings.json)
- [Future independent-study proposal](future-independent-study-proposal.md)
- [M7a results](m7a-results.md)
- [M7b results](m7b-diagnostic-hardening.md)
- [Frozen M7c protocol](m7c-protocol.md)
