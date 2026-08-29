# Frozen request topology and accounting

Protocol limits are fixed at 18 HTTP requests, one PUT reservation/dispatch, one
revocation reservation/dispatch, zero retries, concurrency one, 10,000 ms per
request, 120,000 ms controller deadline, 15,000 ms revocation deadline, 262,144
API response bytes, 65,536 upload response bytes, 245 request-body bytes, and
zero redirects.

The worst-case path is exactly:

| Indices | Operation                                 | Maximum requests |
| ------- | ----------------------------------------- | ---------------: |
| 1       | Bound token detail                        |                1 |
| 2       | Project `bmsda`                           |                1 |
| 3-4     | Complete registrations pagination         |                2 |
| 5-6     | Complete view-only-link pagination        |                2 |
| 7-10    | Complete pre-upload OSF Storage inventory |                4 |
| 11      | Provider-root upload relation             |                1 |
| 12      | Single exact PUT                          |                1 |
| 13-16   | Complete post-upload inventory            |                4 |
| 17      | Exact returned-object download            |                1 |
| 18      | Exact token revocation                    |                1 |

Total: 18. Pagination page size is 100; registrations and view-only links cap at
two pages and 100 records, while each file inventory caps at four pages and 400
records. A repeated/cyclic next link, page overflow, record overflow, or
unapproved host/path rejects.

The request count increments in the accepted-ledger reservation transaction, not
in memory at dispatch. PUT and revocation counts increment at their respective
reservations. Restart recovers all three counters from retained and ledger
receipts. Request 19, PUT 2, and revocation 2 reject before reservation.
