# Token and artifact binding

The activation/runtime binding is the sole source of token ID. Request intents
contain no token field. Token detail, revocation URL, revocation receipt,
custodian request, ledger events, and terminal report derive the same token ID
from state. Cross-token data rejects before reservation.

The pure model owns one exact 245-byte synthetic artifact snapshot. It exposes
only defensive copies for testing. The frozen binding includes filename, byte
length, SHA-256, artifact identity, and PUT request digest. No transition or
future request accepts a caller upload body.

Future dispatch chronology is:

1. copy the internally frozen bytes into a controller-owned mutable snapshot;
2. verify length, SHA-256, artifact identity, and PUT digest;
3. commit the upload reservation with those identities;
4. create the immutable request snapshot from the verified copy;
5. recheck immediately before the first possible byte enqueue;
6. bind dispatch/completion events to the same digest;
7. erase controllable mutable copies after request destruction.

Any arbitrary 245-byte replacement changes the digest and rejects. The design
does not claim erasure of immutable JavaScript or Node internal copies.
