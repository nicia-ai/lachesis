# State, event, and replay contract

Durable controller state is derived only by replaying opaque, verified retained
receipts. Callers cannot submit snapshots. Each retained receipt binds the
activation, run, session, namespace/store, device/inode, helper identity and
variant, initial/previous/resulting native roots, native sequence, canonical
payload digest, native receipt digest, absolute deadlines, and exact
discriminated event payload.

The request-local stages are `idle`, `reserved`, `possibly-dispatched`,
`enqueued`, `raw-recorded`, `validated`, `projected`, `reconciled`, and
`ambiguous`. There are 15 event kinds and 18 allowed stage/event pairs out of
135 possible pairs. Every unspecified pair rejects.

Every successful request uses this grammar:

1. `request-reserved`;
2. `dispatch-permit-consumed` (durable `possibly-dispatched` before enqueue);
3. optional `enqueue-observed`;
4. `raw-response-recorded`;
5. `response-validated`;
6. `decision-projected`;
7. exactly one operation-applicable reconciliation variant;
8. `page-continued` or `operation-completed`.

After permit consumption, restart never restores dispatch authority. It can only
continue from retained evidence, reconcile, enter ambiguity, proceed to
revocation where the grammar permits, or stop. `request-object-created` is not
an accepted event and never counts as dispatch observation. Ordinary serialized
JSON cannot recreate a verified replay, verified retained receipt, transport
receipt, or dispatch permit. A permit is issued once and consumed once.

Pagination is monotonic, bounded per operation, and cannot rewind. Terminal
closure requires all ten operations in order, 10–18 total requests, exact
custodian evidence, and no ambiguity. Terminal state cannot reopen.
