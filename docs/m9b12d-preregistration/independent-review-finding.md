# M9b.12c independent-review finding addressed by M9b.12d

The final M9b.12c decision was `m9b12c-independent-review-no-go`. The blocking
findings were process-local quarantine authority, caller-selectable observer
identity, and a non-atomic gap between revalidation and startup/effect use.

M9b.12d addresses only those findings with an on-disk authority and trusted
anchor, controller-derived identity mapping and opaque launch handles, and a
single admission/effect operation whose durable start event is the linearization
point.

The full evidence is preserved append-only in
`docs/m9b12c-independent-review.json`, `.md`, and `.sha256`. No M9b.12c package
byte was changed.
