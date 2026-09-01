# Failed M9b.13k.5 independent review

The independent review examined the sealed M9b.13k.5 commit
`d89aeac7d859a03e19b9902927c65b228eff9aad`, tree
`63b80c9f1e352110a9e69664ff74b3ba40410e2e`, and the accepted M9b.13k.4c ledger
implementation identity
`cf35bd5756e8397ed9fa010e356ac30787ef69ba19ab13a7c057eac0f32d9ceb`.

The exact independent-review disposition is:

`m9b13k5-offline-controller-integration-design-no-go`

M9b remains NO-GO. The review found the following blocking defects.

1. The generic reservation self-loop did not model the complete
   operation-indexed, page-aware lifecycle. It did not freeze the 18-request
   worst-case topology, prove mandatory-operation coverage, or report and verify
   shortest and longest successful request paths.
2. Dispatch ambiguity began only after observable dispatch. A crash after
   request-object creation or dispatch authorization but before observable
   enqueue could redispatch. The design lacked a durable one-use dispatch
   capability consumed before the first possible enqueue and the required
   crash-boundary proofs.
3. The controller modeled a ledger root as
   `SHA256(priorRoot + NUL + eventIdentity)`. The accepted native ledger instead
   hashes framed records containing its header, sequence, prior root, and
   canonical payload. Proposed controller events, accepted native-ledger commit
   receipts, and authenticated retained receipts were not honestly separated.
4. A broad optional-field event schema admitted irrelevant fields and invalid
   combinations. Caller-assembled snapshots could stand in for exhaustive
   replay. Reservations, permit consumption, observations, responses,
   ambiguities, validation, decisions, pagination, reconciliation, revocation,
   custodian evidence, and closure were not exact discriminated variants.
5. Response schemas did not freeze the reviewed official OSF JSON:API shapes.
   They omitted or weakened required top-level `data`, resource type, id,
   attributes, relationships, links, pagination, provider/resource identity,
   file entity, and Waterbutler metadata structure. Raw parsing did not prove
   malformed UTF-8 and duplicate-key rejection before semantic parsing.
6. Reconciliation trusted caller-supplied length or hash assertions and used
   weak URL/path identity tests. It did not compute from verified receipts and
   actual raw bytes or structurally bind exact scheme, host, port, project,
   provider, resource, object/path, filename, and cardinality. The previously
   accepted foreign-host hostile case remained open.
7. Deadline state used a duration as though it were an absolute monotonic
   deadline. Controller and revocation/custodian starts and absolute deadlines
   were not durably activation-bound, restart-stable, transition-wide, or tested
   at deadline minus one, deadline, and deadline plus one.
8. Custodian success did not prove genuine Ed25519 verification and exact
   lineage. It lacked exact unsigned and revocation projections, key fingerprint
   derivation, activation/run/session and PAT-commitment binding,
   accepted-ledger receipt binding, stale-root rejection, and late-receipt
   rejection.
9. Capabilities were caller-reconstructible or insufficiently bound. Ordinary
   JSON could potentially choose or reset counters, deadlines, roots,
   pagination, terminal state, or dispatch permission. Exact one-use consumption
   across serialization, replay, stale roots, and restart was not established.
10. The future implementation sequence put later controller work ahead of the
    accepted-ledger boundary, strict transport parsing, and exact
    reconciliation. The required order places those foundations first and defers
    launcher, custodian, intercepted integration, independent review,
    effect-capable assembly, and activation-capsule work.
11. The build inventory was incomplete and circular. It did not bind every
    source, emitted JavaScript, declaration, test, fixture, manifest,
    configuration, and protocol artifact; prove byte-identical builds in two
    clean roots; or explicitly bind the comparator and accepted M9b.13k.4c
    implementation identity.

The correction must add exhaustive state/event and operation/page coverage,
shortest and maximum-pagination histories, all dispatch/persistence crash
boundaries with zero redispatch, hostile discriminated-union mutations,
official-shaped fixtures and malformed near-misses, duplicate-key and malformed
UTF-8 rejection, exact foreign-host/encoded-path/provider/resource rejection,
actual-byte reconciliation, deadline/restart boundaries, genuine Ed25519
verification and mutations, one-use/reset rejection, accepted-receipt and
stale-root mutations, exhaustive replay equivalence, payload-limit checks, and
fixed-seed properties. Seed `331677701` must run for at least 2,048 cases and
show that official-shaped responses pass while foreign-host substitutions fail.

The correction authority is append-only and pure. It authorizes no credentials,
PAT ceremony, OSF or Waterbutler access, network calls, uploads, downloads,
revocation, browser action, provider or model call, activation capsule, live
controller, corpus work, publication, push, or other external effect. It must
preserve M9b.13k.5 and every predecessor byte-for-byte and stop after a sealed
package is ready for independent read-only review.
