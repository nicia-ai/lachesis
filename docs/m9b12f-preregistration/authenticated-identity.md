# M9b.12f authenticated opaque observer identity

M9b.12f preserves M9b.12e's identity boundary under
`lachesis-m9b12f-authenticated-observer-identity/1`.

Principal and launch-allocation identities are authority-issued exact 64-byte
lowercase hexadecimal strings. Display labels are non-authoritative. No NFKC,
case folding, trimming, or whitespace normalization contributes to identity.

Authenticated presenter context remains a private runtime object supplied
outside untrusted request JSON. It binds protocol, store, opaque principal,
expiry, and revocation state. Possession of a launch handle does not
authenticate the presenter; exact presenter/launch principal equality is
rechecked inside the admission transaction.
