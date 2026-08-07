# Future independent-review evidence inventory

Protocol: `lachesis-m9b13f2-future-review-evidence-inventory-schema/1`

A future review must supply an exact inventory using protocol
`lachesis-m9b13f2-independent-review-evidence-inventory/1`. Each artifact entry
binds normalized relative path, byte length, media type, raw SHA-256,
classification, and an RFC 8785 canonical JSON digest for JSON artifacts.
Non-JSON entries use null only for the inapplicable canonical digest.

Duplicate, aliased, absolute, empty, traversal, backslash, repeated-separator,
percent-encoded, non-NFC, case-fold-ambiguous, and symlink paths are rejected.
Artifacts are ordered by ascending raw UTF-8 normalized path bytes. Omission,
addition, duplication, aliasing, or reordering is rejected.

The inventory canonical digest is
`SHA-256(UTF8(RFC8785(complete inventory record)))`. The record does not contain
its own digest; the review receipt binds the inventory protocol and canonical
digest directly. An opaque caller digest is insufficient.

The inventory remains external to and chronologically later than the supplement
body. It is supplied independently to any later submission authority and is
never self-authorizing.
