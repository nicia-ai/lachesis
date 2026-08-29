# Supersession disposition

M9b.13k.4c supersedes only the failed M9b.13k.4b implementation-identity
ordering claim. M9b.13k.4 through M9b.13k.4b remain immutable append-only
evidence.

The correction authority is limited to:

1. replacing locale collation with explicit unsigned-byte lexicographic
   comparison of the UTF-8 encoding of `kind + U+0000 + path`;
2. rejecting duplicate inventory identities without relying on sort stability;
3. adding focused ordering, permutation, mutation, and identity tests;
4. advancing the private implementation-identity protocol revision;
5. rebuilding, rederiving, verifying, and resealing the append-only package.

This disposition does not authorize native ledger or helper behavior changes,
controller integration, activation, credentials, OSF access, scientific-code
changes, or public exports.

The exact predecessor disposition is:

`m9b13k4b-corrected-descriptor-ledger-review-no-go`

