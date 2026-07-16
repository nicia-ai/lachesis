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
