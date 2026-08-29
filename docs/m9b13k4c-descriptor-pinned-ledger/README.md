# M9b.13k.4c bytewise identity correction

This append-only package preserves the failed M9b.13k.4b review and corrects
only the private implementation-inventory ordering protocol. The native ledger,
helper behavior, caller behavior, activation boundary, controller code, and
public exports are unchanged.

Inventory identities are ordered by explicit unsigned lexicographic comparison
of UTF-8 `kind + NUL + path` bytes. Duplicate identities are rejected before
sorting. The implementation identity is:

`cf35bd5756e8397ed9fa010e356ac30787ef69ba19ab13a7c057eac0f32d9ceb`

The package decision is:

`m9b13k4c-bytewise-identity-correction-ready-for-independent-review`

This authorizes only one final independent read-only review. M9b remains NO-GO.
