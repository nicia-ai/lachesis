# M5c public-alpha release notes

Proposed version: `0.1.0-alpha.1`

M5c turns the completed M5 evidence runtime into an auditable package boundary.
The new `@nicia-ai/lachesis-runtime` facade makes the supported workflow obvious
and keeps research controllers, scorers, campaigns, credentials, and provider
dispatch out of the product API.

## Builder-facing changes

- Compile, run, inspect, record, and replay from one portable ESM entrypoint.
- Use lexical model-facing evidence by default; research policies require an
  explicit opt-in.
- Inject a mock or recording oracle with exact schema, identity, cancellation,
  and budget boundaries.
- Persist replay artifacts with an optional Node-only private file store.
- Use a host TypeGraph `HistoryStore` portably or opt into managed private
  SQLite from the Node-only TypeGraph subpath.
- Receive discriminated operational failures instead of unstructured expected
  exceptions.

## Hardening

- Runtime adapter results and usage are validated before use.
- Wall-clock deadlines race adapter execution and propagate cancellation.
- Private recording files use exclusive `0600` creation, fsync, atomic
  content-addressed commit, stale-temporary recovery, and permission audits.
- Managed SQLite pre-creates and audits the database and all sidecars under a
  dedicated `0700` directory.
- Package and declaration audits keep Node, Drizzle, provider, and research
  controller types out of portable runtime declarations.

## Compatibility and limits

This is an ESM-only alpha for Node 24. Portable surfaces are verified through a
Cloudflare Workers bundle. The Node file and SQLite helpers require POSIX
ownership and mode semantics. TypeGraph is optional infrastructure, not a
model-quality arm. The release makes no provider, graph, or production-scale
claim. TypeGraph 0.38 currently declares `drizzle-orm` as a non-optional
upstream peer; it is not exposed by Lachesis declarations, but some package
managers may install it transitively.
