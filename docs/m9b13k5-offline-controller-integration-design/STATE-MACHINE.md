# Pure controller state machine

State protocol: `lachesis-m9b13k5-pure-controller-state/1`. Event protocol:
`lachesis-m9b13k5-controller-ledger-event/1`.

The model contains 22 states and 37 exact transition specifications. Eighteen
are workflow transitions, four are dispatch-ambiguity stops, and fifteen are
fail-closed quarantine transitions from every nonterminal source. Every other
state/event pair rejects.

```mermaid
flowchart TD
  I[inert] -->|activation-inspected| SI[activation structurally inspected]
  SI -->|activation-admitted| AA[activation admitted]
  AA -->|ledger-opened| LO[ledger opened and identity verified]
  LO -->|credential-launch-reserved| CLR[credential launch reserved]
  CLR -->|credential-custody-active| CCA[credential custody active]
  CCA -->|preconditions-started| PI[request preconditions in progress]
  PI -->|precondition request reserved| PI
  PI -->|upload reserved| UR[upload reserved]
  UR -->|dispatch observed| UPD[upload possibly dispatched]
  UPD -->|raw response reconciled| UPR[upload reconciled]
  UPR -->|revocation reserved| RR[revocation reserved]
  RR -->|dispatch observed| RPD[revocation possibly dispatched]
  RPD -->|custody closed| CCC[credential custody closed]
  CCC -->|await custodian| AIV[awaiting independent revocation verification]
  AIV -->|synthetic revoked| SRV[synthetic revoked and verified]
  AIV -->|synthetic active| SAT[synthetic active-token security stop]
  AIV -->|synthetic ambiguous| SAS[synthetic ambiguity security stop]
  SRV -->|closed| C[closed]
  UR -->|dispatch ambiguity| SAS
  UPD -->|dispatch ambiguity| SAS
  RR -->|dispatch ambiguity| SAS
  RPD -->|dispatch ambiguity| SAS
```

The live terminal states `revoked_and_independently_verified`,
`active_token_security_stop`, and `ambiguity_security_stop` are schema-defined
but unreachable: no live authority or live custodian constructor exists.
Synthetic terminal language cannot be presented as live terminal language.

Each event contains the complete predecessor grammar: activation, request,
campaign, token, ledger implementation, namespace, store, artifact, prior
sequence/root, request index and cumulative counters, raw and canonical response
digests, ambiguity, dispatch boundary, monotonic observation, optional custodian
receipt, event identity, and new sequence/root. Terminal success cannot be
appended from a partial event.
