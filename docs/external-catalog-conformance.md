# External catalog conformance for alpha.2

This guide is for catalog authors using only the public exports of
`@nicia-ai/lachesis` and `@nicia-ai/lachesis-generator` version `0.1.0-alpha.2`.
Cross-catalog conformance is experimental, finite-domain, and offline. It
neither invokes effects nor proves universal equivalence.

## Authoring boundary

Import catalog definitions, roles, fingerprints, and manifests from the kernel
root. Import the conformance suite, runner, and report verifier from the
generator root. Do not import package `src` files or undocumented subpaths.

```ts
import {
  catalogSemanticRolesSchema,
  createCatalog,
  createPlanLanguageManifest,
  definePredicate,
  defineSchema,
} from "@nicia-ai/lachesis";
import {
  catalogConformanceSuiteSchema,
  conformCatalogsOffline,
  verifyCatalogConformanceReport,
} from "@nicia-ai/lachesis-generator";
import { z } from "zod";
```

An external catalog remains ordinary trusted host code. It registers schemas and
operations; no implementation enters the plan wire format. Semantic roles are
versioned declarations about registrations already present in that catalog. They
contain neither source code nor authority.

## Choose role identities before implementations

Two authors who intend to compare catalogs should first agree on a written role
contract. For every role, freeze:

- a stable application-owned role ID and explicit version;
- the operation kind and its input/output schema roles;
- the finite conformance domain, including lower and upper bounds, threshold
  values, empty or identity values, and realistic ordinary values;
- reducer identity and every law being claimed; and
- for effects, exact class, capability, replayability, state-change semantics,
  and resource bounds.

Descriptions help humans but are never treated as semantic proof. Do not reuse a
role version after changing its contract. A version change is a rejection
boundary until both catalogs and their complete suites migrate explicitly.

## Declare roles and create a catalog

Use `catalogSemanticRolesSchema.parse()` so the wire declaration is strict and
Zod-owned. Then pass the parsed declaration to `createCatalog()`.

```ts
const count = defineSchema({
  id: "acme.inventory/count",
  version: "1",
  description: "An on-hand unit count from zero through one thousand.",
  validator: z.number().int().min(0).max(1_000),
});

const lowStock = definePredicate({
  id: "acme.inventory/low-stock",
  version: "1",
  description: "True at or below ten units.",
  input: count,
  implementation: (value) => value <= 10,
});

const semanticRoles = catalogSemanticRolesSchema.parse({
  protocol: "lachesis-catalog-semantic-roles/1",
  schemas: [
    {
      kind: "schema",
      role: { id: "acme.role/inventory-count", version: "1" },
      schema: { id: count.id, version: count.version },
      obligations: { mutuallyAcceptsConformanceValues: true },
    },
  ],
  operations: [
    {
      kind: "predicate",
      role: { id: "acme.role/low-stock", version: "1" },
      operation: { id: lowStock.id, version: lowStock.version },
      obligations: {
        deterministic: true,
        totalOnConformanceValues: true,
        pointwiseEquivalent: true,
      },
    },
  ],
});

const catalog = createCatalog({
  identity: { id: "acme.inventory/catalog", version: "1" },
  schemas: [count.runtime],
  operations: [lowStock],
  semanticRoles,
});
```

Catalog creation rejects duplicate and dangling mappings, kind mismatches, and
reducer-role law declarations that disagree with registered reducer metadata.
Handle the returned `Result`; do not catch expected failures as exceptions.

## Build a complete adversarial suite

Every declared role requires exactly one fixture. Include values on both sides
of every semantic boundary and the boundary itself. For reducers include at
least three values and values capable of falsifying identity, associativity,
commutativity, and idempotence claims. Ordinary happy-path samples alone are not
a credible conformance domain.

```ts
const suite = catalogConformanceSuiteSchema.parse({
  protocol: "lachesis-cross-catalog-conformance-suite/1",
  fixtures: [
    {
      kind: "schema",
      role: { id: "acme.role/inventory-count", version: "1" },
      values: [0, 9, 10, 11, 999, 1_000],
    },
    {
      kind: "predicate",
      role: { id: "acme.role/low-stock", version: "1" },
      inputs: [0, 9, 10, 11, 1_000],
    },
  ],
});
```

Run `conformCatalogsOffline({ left, right, suite })`. On success, retain the
exact report and verify it with `verifyCatalogConformanceReport()`. A success is
bound to the two catalog fingerprints, declarations, and suite digest. It does
not authorize operation substitution or rewrite plans compiled against another
catalog.

## Diagnose and repair a rejection

Alpha.2 diagnostics usually identify the failed obligation class and, for
role-local failures, the role. They frequently do not identify the exact input,
side, or repair action. M7a observed repair direction in only 1 of 9 hostile
rejections. Use this fail-closed workflow:

1. confirm both catalogs declare the exact same role IDs and versions;
2. confirm the suite covers every declared role exactly once;
3. inspect the named role's schema bounds or operation signature;
4. replay the fixture locally against each implementation and locate the first
   divergent boundary value;
5. for reducers, separately test identity and every claimed law; and
6. repair the declaration or implementation, bump identities when semantics
   changed, and generate a new report. Never waive the rejection or edit a
   previous report.

Treat a rejected intended-positive pair as a false rejection in evaluation. Do
not convert it into equivalence because the implementations “look close.”

## Evolve catalogs without rewriting history

Catalog fingerprints include identity, public schema and operation metadata, and
semantic-role declarations. Registration order is canonicalized, but a catalog
or role version change changes identity. When evolving a catalog:

1. bump the catalog and affected registration or role versions;
2. retain the previous catalog and manifest for old compiled and replay
   artifacts;
3. create a new `PlanLanguageManifest` and record its digest;
4. rerun the complete conformance suite against the new fingerprint; and
5. recompile plans rather than rewriting stored identities.

The complete public-package example is in
[`examples/m7a-independent-catalogs`](../examples/m7a-independent-catalogs).

## Nonclaims

A conformance report establishes only finite fixture-domain agreement. It does
not establish universal extensional equivalence, independent authorship,
compositional generalization, model quality, production readiness, or permission
for inference, effects, promotion, or deployment.
