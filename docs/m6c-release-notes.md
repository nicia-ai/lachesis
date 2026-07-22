# Lachesis 0.1.0-alpha.2

Lachesis 0.1.0-alpha.2 is a synchronized five-package public-alpha candidate for
the completed M6 offline compositional-harness work. M6 remains formally closed
as **`closed-offline-design-no-go`**. This release does not authorize a live
study, provider dispatch, automatic cross-catalog substitution, or M7.

## Trusted catalog semantics

`@nicia-ai/lachesis` adds eight stable-alpha exports for trusted, versioned
catalog semantic-role declarations:

- `CatalogSemanticRoles`
- `CatalogSemanticRolesInput`
- `OperationRoleDeclaration`
- `SchemaRoleDeclaration`
- `SemanticRoleReference`
- `catalogSemanticRolesSchema`
- `operationRoleDeclarationSchema`
- `semanticRoleReferenceSchema`

Catalogs may map registered schemas and operations to application-owned
`(id, version)` roles. Declarations are validated at catalog construction and
bound into catalog fingerprints and plan-language manifests. Duplicate,
dangling, operation-kind-incompatible, and false reducer-law declarations fail
closed through `Result` diagnostics.

The plan wire format is unchanged. Declarations add no callbacks, source text,
implicit effects, provider bindings, or backend authority. The portable kernel
remains backend-neutral and compatible with Node 24 and Cloudflare Workers.

## Offline strategy and conformance tooling

The experimental `@nicia-ai/lachesis-generator` surface adds immutable typed
strategy templates, lifecycle and fallback machinery, sanitized trace grouping,
finite cross-catalog conformance reports, the fresh M6c adversarial corpus, and
the M6d paired-study design.

The offline M6c suite accepted its intended distinct-identity catalog pair and
rejected all eight adversarial non-equivalence fixtures: **0 accepted hostile
collisions out of 8**. A passing report is evidence only for the supplied finite
fixtures. It is not universal extensional equivalence and does not rewrite
concrete operation identities.

M6d remains a no-go: its distribution-free design requires 1,200 fresh cases,
exceeding the 500-case practical ceiling, while empirical power, effect-call
bounds, and maximum cost remain unknown.

## Migration requirements

Adding, removing, or changing semantic-role declarations changes the catalog
fingerprint. Applications must:

1. bump the catalog version;
2. retain the old catalog while old plans or replay artifacts remain in use;
3. recompile plans against the new fingerprint;
4. preserve stored plan, semantic-contract, replay, effect-request, and template
   identities rather than rewriting them; and
5. rerun the application-supplied conformance suite whenever catalogs or
   fixtures change.

Semantic-role declarations do not independently authorize template reuse or
cross-catalog execution.

## Synchronized packages

All five public packages use version `0.1.0-alpha.2` so packed workspace
dependencies resolve to one audited set:

- `@nicia-ai/lachesis` — additive stable-alpha semantic-role API.
- `@nicia-ai/lachesis-generator` — additive experimental offline strategy and
  conformance tooling.
- `@nicia-ai/lachesis-runtime` — dependency-only synchronized release; no API or
  behavior change.
- `@nicia-ai/lachesis-evidence` — dependency-only synchronized release; no API
  or behavior change.
- `@nicia-ai/lachesis-evidence-typegraph` — dependency-only synchronized
  release; no API or behavior change.

The release remains ESM-only, uses public package access and the npm `alpha`
dist-tag, and preserves provenance through npm trusted publishing. Private
workspace packages remain excluded. Existing npm `latest` dist-tags are not
changed by this release process.

## Explicit nonclaims

M6 did **not** establish:

- learned compositional generalization;
- cross-domain transfer or model generalization;
- universal cross-catalog equivalence;
- safe automatic template promotion or cross-catalog substitution;
- accuracy, latency, or cost superiority; or
- permission for live inference, provider spending, or production deployment.

The immutable M6 result remains [`closed-offline-design-no-go`](m6-results.md).
