# `@nicia-ai/lachesis`

Portable typed compiler/runtime kernel for measured agent plans. See the
[workspace README](../../README.md) for guarantees, examples, and commands.

The compiler may also receive public typed semantic obligations. It rejects dead
graph nodes and records root provenance for input-dependency,
operation-dominance, state-change, required-operation, and required-effect
checks.

The public execution boundary is deliberately narrow:

```ts
const compiled = await compilePlanJson(text, catalog, policy, obligations);
if (!compiled.ok) return compiled;

const result = await executePlan(compiled.value, options);
```

`ExecutablePlan` and `Catalog` are opaque, immutable snapshot tokens. A compiled
artifact binds the checked plan, successful analysis, plan hash, catalog
fingerprint, capabilities, and budget. `createPlanLanguageManifest` exposes the
canonical content-addressed JSON language description for plan generators.

Catalogs may opt into trusted, versioned semantic-role declarations through the
`semanticRoles` field of `createCatalog()`. Roles are fingerprinted catalog
metadata; they never enter the plan wire format and contain no implementation or
authority. Construction rejects duplicate or dangling declarations,
operation-kind mismatches, and reducer-role law claims that differ from the
registered reducer.

Adding or changing roles changes the catalog fingerprint. Bump the catalog
version, retain the previous catalog for old replay artifacts, and recompile
rather than rewriting stored identities. Role declarations alone do not prove
cross-catalog equivalence or authorize operation substitution.

For role-contract design, complete boundary fixtures, offline conformance,
diagnostic repair, and version migration, see the
[external catalog-author guide](../../docs/external-catalog-conformance.md).
