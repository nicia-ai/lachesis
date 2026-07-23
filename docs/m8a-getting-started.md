# Registry-only getting started

This path runs the Northstar incident-response example in well under 15 minutes
on Node 24.18.0. It uses npm packages only and makes no provider call.

## 1. Create the consumer

Start with the complete
[`m8a-registry-consumer`](../fixtures/m8a-registry-consumer) directory as an
independent repository, then run:

```bash
git init
npm ci --ignore-scripts
npm run verify
npm run workers:dry-run
```

`npm ci` resolves exact versions from the committed lockfile. `verify` runs
TypeScript 6 with strict checking and `skipLibCheck:false`, builds, executes the
valid and invalid examples, and writes:

- `reports/m8a-adoption-report.json` — deterministic machine report;
- `reports/m8a-diagnostics.md` — deterministic human diagnostics.

The Workers command bundles only the portable catalog and manifest path. It is a
dry-run and does not deploy.

## 2. Follow the product path

The example is divided by responsibility:

- `src/catalog.ts` defines schemas, nine operations, semantic roles, and four
  catalog versions.
- `src/workflow.ts` compiles positive and negative plans, injects mock evidence,
  records a run, verifies citations/provenance, and replays it.
- `src/conformance.ts` owns the fixture suite, manifests, and evolution
  assessments.
- `src/run.ts` renders stable human and JSON reports.
- `src/worker.ts` proves that the catalog/manifest path remains portable.

Keep the boundaries in that order. An external effect implementation belongs in
the host; it does not belong in the plan wire format or the portable catalog.

## 3. Handle failures correctly

Compilation returns all kernel diagnostics:

```ts
const compiled = await compilePlan(planJson, catalog, policy, obligations);
if (!compiled.ok) {
  for (const item of compiled.error) {
    console.error(item.code, item.location, item.repair);
  }
  process.exitCode = 1;
}
```

Catalog comparison returns one typed assessment:

```ts
const assessed = await diagnoseCatalogsOffline({ left, right, suite });
if (!assessed.ok) throw new Error(assessed.error.message);
if (assessed.value.kind === "rejected") {
  const diagnostic = assessed.value.diagnostic;
  console.error(renderCatalogConformanceDiagnostic(diagnostic));
  if (diagnostic.action.kind === "do-not-substitute") process.exitCode = 1;
}
```

Never convert rejection into equivalence. Apply declaration guidance only after
the catalog author confirms the written role contract was stale. If the action
is `do-not-substitute`, preserve both versions and migrate callers explicitly.

## 4. Evolve safely

For every catalog release:

1. freeze the old and candidate manifests;
2. run the same versioned semantic-role fixture suite;
3. verify the report or diagnostic digest;
4. keep the initial result even if a declaration is later repaired;
5. recompile plans against the candidate fingerprint; and
6. retain the prior manifest and migration decision with release artifacts.

See the [CI and migration guide](m8a-conformance-ci.md) for a fail-closed check.
