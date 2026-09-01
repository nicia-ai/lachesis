# Deadlines and custodian lineage

Activation binds a nonzero admitted monotonic controller start and the absolute
controller deadline `start + 120000`. Revocation reconciliation binds its own
phase start and absolute custodian deadline `start + 15000`. Retained receipts
carry both pairs. Replay never resets them and validates them before and after
every applicable transition. Evidence at deadline minus one is timely; evidence
at the deadline or later rejects.

Custodian evidence is a genuinely verified Ed25519 signature over the exact
canonical unsigned projection. Verification derives the public-key fingerprint
from SPKI DER and derives the visibly synthetic custodian identity from that
fingerprint. The signed projection binds activation, run, session, synthetic
identity marker, PAT commitment, key fingerprint/identity, exact revocation
projection digest, accepted native-ledger receipt digest/sequence/root, and
observation time. Forgery, altered projections, wrong keys, cross-run/session
data, wrong revocation digest, stale receipt/root, and late evidence reject.
