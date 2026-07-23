# M8a adoption friction

## Observed result

The empty-directory black-box test passed. From a cold npm cache it installed,
strictly typechecked, built, ran twice with network denied, compared
byte-identical reports, and completed a Workers dry-run. The measured run is in
[`m8a-black-box-measurement.json`](m8a-black-box-measurement.json).

The complete automated workflow took seconds, leaving substantial margin under
the 15-minute target. The fixture authors nine files and approximately 1,550
lines, including the deliberately comprehensive catalog, negative cases,
conformance suite, and Workers entrypoint. Application users can split or reduce
this according to their domain.

## Friction found

1. Failure cardinality was undocumented in the adoption path. Kernel
   construction/compilation failures are diagnostic arrays; conformance emits a
   single typed assessment. The M8a guides now show both.
2. Safe catalog evolution requires the consumer to assemble a small manifest
   diff record. The necessary public fields exist, but the production path was
   not documented as a sequence.
3. Exact mock requests are intentionally strict. Branch adapters before the
   bound oracle must preserve the expected request or the consumer must seed a
   matching fixture. This is a safety property, but it deserves troubleshooting
   guidance.
4. The Workers development tool dominates installed footprint. It is optional
   application tooling, not a runtime dependency.
5. The original external-conformance guide is frozen historical alpha
   documentation. M8a adds a current registry-only guide rather than mutating
   that frozen evidence.

No public API gap was required. Optional SARIF was deferred because a new
translation surface would add fragility without strengthening the deterministic
JSON gate.

## Package and leakage audit

The fixture pins four selected alpha.3 public packages, including the portable
evidence package. The runtime’s public dependency graph remains npm-only. It
contains no private benchmark package, provider adapter, TypeGraph, Drizzle, or
SQLite package. No credential-shaped environment variable is propagated into the
post-install sandbox, and no network access is available during compile,
execution, report generation, replay, or Workers bundling.
