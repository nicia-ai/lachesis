# Registry-consumer troubleshooting

## The compiler error has no `code`

`compilePlan` and `createCatalog` return an array of diagnostics on failure.
Read `result.error[0]` or iterate the array. Offline conformance assessments use
a different typed shape with a single structured diagnostic.

## A branch reports `BRANCH_TYPE_MISMATCH`

Both `select` branches must have the same registered nominal schema. Matching
JavaScript value shapes are insufficient. Route both branches through operations
with the same output registration.

## A valid-looking plan fails a semantic obligation

Obligations apply to the root dependency graph, not merely to operations present
as dead or unrelated nodes. Make the required operation/effect dominate or feed
the root. Remove an obligation only when the trusted contract itself was wrong.

## An effect is denied

The effect capability must appear in trusted policy and the plan’s
`allowedCapabilities`. Grant the narrow registered capability; do not broaden
the allowlist to make the diagnostic disappear.

## The budget is insufficient

Inspect the compiled analysis and raise only the named known bound, or simplify
the plan. Relevant `unknown` bounds reject execution and must not be fabricated
as known.

## Conformance says `declaration-repairable`

Read `action.patchDescription` and `action.safetyCondition`. Confirm against the
written semantic contract before changing metadata, regenerate the manifests,
and retain the original result separately.

## Conformance says `genuinely-non-equivalent`

Follow `do-not-substitute`. Do not edit role metadata to manufacture
equivalence. Version the operation/capability and migrate callers explicitly.

## Mock execution cannot find a fixture

Mock requests are bound to exact canonical request identity. Seed the recording
with the same task, evidence snapshot, policy, effect identity, and plan, then
construct the mock from that recorded request/result pair.

## Workers bundling pulls in Node APIs

Import the portable package entrypoints only. Keep filesystem-backed stores,
provider adapters, and managed SQLite on explicit Node-only paths. The M8a
worker imports catalog/manifest code and has no Node ambient types.

## Installation is large

The core selected Lachesis packages are small; most of the M8a development
installation is the pinned Workers CLI and its platform tooling. Keep the
Workers dry-run in development dependencies and omit it when the application
does not target Workers.
