# Reconciliation protocol

Reconciliation is read-only and occurs twice: immediately after the sole
submission attempt while the record is pending, and again after a separately
authorized approval. Both passes verify the exact record identity, timestamps,
embargoed non-public state, zero view-only links, unique supplement count and
all 57 downloaded file bytes.

Any timeout, interruption, missing identity, partial upload, partial
reconciliation or conflicting state becomes `ambiguous-no-retry`. Neither
automatic nor manual submission retry is permitted. A later local receipt must
be append-only and cannot alter the preregistration, supplement or signed review
receipt.
