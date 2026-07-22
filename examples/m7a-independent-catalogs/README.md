# M7a public-package consumer fixture

This private workspace fixture imports only documented package entrypoints from
`@nicia-ai/lachesis@0.1.0-alpha.2` and
`@nicia-ai/lachesis-generator@0.1.0-alpha.2`. Its standalone TypeScript config
resolves installed package declarations, uses TypeScript 6 strict mode, and
keeps `skipLibCheck: false`.

The six files under `src/authors` separately implement three unrelated catalog
contracts without shared implementation helpers. The remaining modules freeze
complete conformance suites, opaque cases, sealed adjudication, hostile
near-equivalence, evolution checks, and a deterministic content-addressed
report. Source separation rehearses independent authorship; it is not evidence
from independent humans.

After the workspace public packages are built:

```bash
pnpm --filter @nicia-ai/lachesis-m7a-independent-catalogs typecheck
pnpm --filter @nicia-ai/lachesis-m7a-independent-catalogs build
node examples/m7a-independent-catalogs/dist/run-trial.js
```

The last command regenerates the result in memory and fails if it differs from
`reports/m7a-conformance-report.json`.
