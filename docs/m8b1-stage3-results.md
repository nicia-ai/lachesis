# M8b.1 Stage 3 structural comparison results

Status: `complete-offline-pass`

Parent commit: `f1a53cb7118a5a7eb0b0ed50be27f8bb8e9feb1c`.

The private `catalog compare` command regenerates both manifests from verified
compiled ESM exports, optionally verifies exact supplied manifest bytes, and
performs a structural comparison without a conformance suite.

Detailed review records cover:

- catalog identity;
- added, removed, versioned, described, typed, and JSON-schema declarations;
- operation kind, signature, state-change, effect, bound, and reducer-law
  changes;
- semantic-role versions, targets, kinds, obligations, additions, and removals;
  and
- policy capabilities and every budget field.

Catalog, operation, schema, and role declarations are matched by stable
canonical identities. Set-like declarations are compared without array-order
sensitivity. Each change becomes a separate deterministic `declaration-review`
migration whose identity commits to the typed change class, subject, and
left/right content digests. Summary, status, and exit code derive from those
detailed records.

The frozen report schema reserves its `identity-only` migration category for a
suite-backed compatible result. Because Stage 3 has no suite and makes no
compatibility claim, even a catalog-identity-only change is represented by a
`declaration-review` record tagged `change=catalog.identity` and exits `10`.
Exact structural identity exits `0`.

Stage 2a descriptor-bound reads, pre/post-import source reconciliation,
pre-export verification, bounded I/O, parent and leaf symlink rejection,
containment, atomic output, alias rejection, and redaction are preserved.
Sources sharing a normalized module path are acquired and imported once.

No public export, generator dependency, package version, release metadata, or
report protocol changed. No repair, suite-backed conformance, semantic
equivalence, substitutability, or safe-migration claim was added. Stage 4 did
not begin.
