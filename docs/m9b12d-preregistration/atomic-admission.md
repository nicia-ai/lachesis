# M9b.12d atomic role/effect admission

Protocol: `lachesis-m9b12d-atomic-role-effect-admission/1`.

The controller owns one operation that resolves identity, evaluates the current
M9b.12b proof payload, reopens and validates durable state, rechecks quarantine,
consumes the launch and admission identities, appends an
`admission-effect-started` event, invokes the intercepted role-startup boundary,
and appends a terminal event.

The start-event commit is the linearization point. No caller-visible boolean or
unconsumed allow receipt exists. The effect receives a typed context whose
`providerEffectsPermitted` value is always `false` and whose required future
provider boundary is `lachesis-m9b4-offline-effect-ledger@1.2.0`.

The durable transition model is:

1. No record: the launch may be assessed once.
2. `quarantine`: terminal denial; observer, role/session startup, derived
   inventory reuse, and provider effects are forbidden.
3. `admission-effect-started`: the launch and admission identities are consumed;
   no redispatch or readmission is possible.
4. `admission-terminal/completed`: intercepted role startup returned success.
5. `admission-terminal/ambiguous`: the intercepted boundary failed after the
   durable start. The conservative terminal state remains inadmissible.

If quarantine commits first, the admission CAS reload observes it and rejects.
If admission commits first, the chain order records that fact and any subsequent
quarantine follows its start event. Concurrent attempts for the same launch or
admission identity produce one start event and at most one intercepted effect.

A failure before the database update consumes nothing. A database-only commit or
anchor persistence failure fails the authority closed. A crash after the durable
start but before invocation leaves an unresolved start audited as ambiguous; a
crash after invocation but before its terminal append does the same. Neither
state can be reset or redispatched.
