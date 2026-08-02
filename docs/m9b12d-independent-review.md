# M9b.12d final independent review

Reviewed commit: `5dff4a5f74933135c4c686f1c94df04cc320f53b`.

Reviewed tree: `a021670c01fc020afe3e682f847d40e2084a1545`.

Decision: `m9b12d-independent-review-no-go`.

Disposition:
`superseded-unregistered-durability-claim-and-presenter-identity-incomplete`.

## Blocking findings

1. The local JSON consistency anchor and SQLite database share one privileged
   filesystem trust domain. Restoring an older valid database together with its
   matching older anchor is not detectable without an independently controlled
   monotonic witness, so the package's coordinated-rollback claim is too broad.
2. A launch handle is accepted as a bearer credential. Admission receives no
   separately authenticated presenting principal, so a copied complete handle,
   role, and session can be used as the original observer.
3. NFKC, case, trim, and whitespace normalization can merge distinct textual
   controller principal identifiers into one durable observer identity.

## Preserved results

The review independently reproduced the M9b.12d preregistration and manifest
digests, verified predecessor bytes, exercised genuine child-process reopen,
confirmed all 12 role assertions, and confirmed scientific and financial
invariance. Those checks do not cure the durability-claim and presenter-identity
defects.

No registration, corpus, credential, provider, network, push, publication, or
study-execution effect occurred.
