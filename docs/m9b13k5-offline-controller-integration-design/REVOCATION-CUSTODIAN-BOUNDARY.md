# Two-phase revocation and custodian boundary

Phase one is controller-owned. It reserves and dispatches at most one exact
token revocation, persists terminal response or dispatch ambiguity, destroys
requests/sockets, closes credential custody, and ends at
`awaiting_independent_revocation_verification`. Its own HTTP result cannot
create independently verified success.

Phase two is independently authenticated. The custodian receives no PAT and uses
a separate account-control session to inspect the exact bound token ID. A signed
receipt reports exactly `revoked`, `active`, or `ambiguous` and binds:

- activation and request identities;
- token ID;
- ledger store identity and retained sequence/root;
- revocation request index and revocation digest;
- custodian public key, fingerprint, and identity;
- receipt mode and signature protocol.

Cross-custodian, cross-token, cross-ledger, stale-root, and foreign-activation
receipts reject. Synthetic receipts reach only synthetic terminal states. Live
receipts and terminal states require an absent human-controlled custodian tool.
That tool remains a future blocker.
