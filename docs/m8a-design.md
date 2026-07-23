# M8a registry-only adoption design

## Decision

M8a is `adoption-ready-with-docs-fixes`.

The published `0.1.0-alpha.3` API supports the complete product path without a
source checkout or a new public export. The documentation correction is material
but narrow: catalog construction and plan compilation can return an array of
kernel diagnostics, whereas `diagnoseCatalogsOffline` returns one structured
conformance assessment. External consumers need both handling patterns shown
explicitly.

This is a product-adoption result over one finite offline scenario. It is not
evidence for model quality, graph superiority, TypeGraph quality, or
compositional generalization.

## Scenario

Northstar Incident Response is an independently named catalog that does not
reuse a benchmark fixture. Its nine operations cover pure functions, a
property-claimed reducer, a fixed-point step, a nonnegative measure, branching,
and a bounded replayable state-changing effect.

The consumer:

1. declares four schema roles and nine operation roles;
2. compiles a branching incident-decision plan;
3. executes it with a deterministic mock oracle and in-memory evidence;
4. checks answer citations and provenance links;
5. records and exactly replays the result with zero additional effects;
6. builds versioned catalog manifests;
7. accepts a compatible catalog evolution;
8. classifies a stale role-version declaration as `declaration-repairable`; and
9. classifies a capability change as `genuinely-non-equivalent` with
   `do-not-substitute`.

Compile rejection fixtures cover a branch schema mismatch, an unsatisfied
semantic obligation, a denied capability, and an insufficient effect-call
budget.

## Acceptance criteria

| Gate             | Required result                                                                                 | Evidence                            |
| ---------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------- |
| Package origin   | Public npm packages at exactly alpha.3; no workspace/file dependency                            | Lockfile and black-box audit        |
| Type discipline  | TypeScript 6.0.3, strict, `skipLibCheck:false`, no unsafe assertion                             | Consumer typecheck and source audit |
| Runtime          | Valid compile, mock execution, cited answer, provenance                                         | Deterministic JSON report           |
| Replay           | Matching result and plan identities, zero added effect calls                                    | Runtime report                      |
| Negative cases   | Stable code, localization field, actionable guidance for all six rejections                     | Compile and conformance diagnostics |
| Unsafe evolution | Never accepted; explicit `do-not-substitute`                                                    | `CAPABILITY_MISMATCH` diagnostic    |
| Determinism      | Human and JSON reports byte-identical across two clean runs                                     | SHA-256 comparison                  |
| Portability      | Node execution and Workers bundle dry-run                                                       | Black-box harness                   |
| Isolation        | Network denied after install; no credentials, provider, database, TypeGraph, or private package | Sandbox and lock/source audits      |
| Product fit      | ≤15-minute runnable path and CI guidance                                                        | M8a guides                          |

The harness fails closed on any unmet gate. SARIF was intentionally omitted: the
deterministic JSON already contains stable codes and exact boundaries, and
adding a translation layer or dependency would not improve this alpha workflow.

## Public API assessment

The example uses only:

- `@nicia-ai/lachesis` for catalog definitions, semantic roles, manifests, and
  digests;
- `@nicia-ai/lachesis-runtime` for compile, inspect, run, record, mock, and
  replay; and
- `@nicia-ai/lachesis-generator` for offline cross-catalog conformance and
  structured diagnostics.

`@nicia-ai/lachesis-evidence` is pinned as an explicit portable runtime
dependency. The optional `@nicia-ai/lachesis-evidence-typegraph` package is not
selected, so neither TypeGraph nor SQLite/Drizzle enters the installation.

No API gap was found. In particular, application composition is sufficient for
version diffs: retain both manifests, compare their content-addressed
identities, run the application-owned fixture suite, and use the structured
assessment as the migration decision.

## Nonclaims

- The fixture is not representative of all catalogs.
- A conformant finite suite does not prove universal semantic equivalence.
- A declaration-repairable diagnostic is conditional guidance, not permission to
  relabel genuinely different operations.
- Exact replay establishes equality to the recorded effect result, not semantic
  determinism of arbitrary live effects.
- No provider or model was called.
