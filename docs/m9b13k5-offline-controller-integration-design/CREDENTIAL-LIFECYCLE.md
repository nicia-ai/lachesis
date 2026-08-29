# Future credential lifecycle

No credential code or bytes exist in M9b.13k.5. The future boundary requires an
authenticated, one-use launcher capability owned by a separately reviewed
launcher.

The required lifecycle is:

1. restart/ledger inspection completes before credential acquisition;
2. a launch reservation consumes the one-use launcher capability;
3. the controller exclusively owns FD3;
4. it performs one bounded read of exactly 64 ASCII alphanumeric bytes followed
   by LF and then EOF;
5. it closes FD3 immediately;
6. it erases controllable mutable input and authorization buffers;
7. it never logs, serializes, returns, or includes the credential in errors or
   receipts;
8. every request/socket is promptly destroyed at timeout or terminal failure;
9. custody closes before independent revocation verification;
10. no replacement credential or PAT is allowed after a possible effect.

Creating the `Bearer` header necessarily creates immutable JavaScript strings,
and Node may copy them into headers, request objects, TLS buffers, or runtime
internals. The controller cannot synchronously zeroize those copies and must not
claim complete JavaScript zeroization.

FD4 self-consistency cannot authenticate launcher ownership. Authenticated
launcher construction is a future blocker and requires separate authorization.
