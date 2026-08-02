# M9b.12e authenticated observer identity

Protocol: `lachesis-m9b12e-authenticated-observer-identity/1`.

The authoritative principal and launch-allocation identifiers are controller-
issued 256-bit values encoded as exactly 64 lowercase hexadecimal characters.
The strict parser rejects uppercase, whitespace, shortened, compatibility-
character, and other noncanonical encodings. Identity applies no NFKC, case
folding, trimming, whitespace collapse, or display-label derivation.

Display labels are optional non-authoritative metadata. Two distinct opaque IDs
remain distinct even when their labels normalize identically. One principal
retains the same exact opaque ID across authorized roles, sessions, inventories,
allocations, and reopen.

The authenticated principal/channel adapter creates a runtime presenter context
outside parsed request JSON. Private runtime state binds its issuance protocol,
exact opaque principal ID, authority store identity, issue time, and optional
expiry. Revocation, expiry, forgery, missing context, and cross-store context
all fail closed. TypeScript branding is not the runtime check.

A launch handle identifies a durable allocation; it does not authenticate its
presenter. Admission requires exact presenter-principal, allocation, role, and
session equality. A copied complete request under another presenter returns
exactly `presenting-principal-mismatch` before any admission or effect.
