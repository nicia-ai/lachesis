# M8b.0 packaging and API delta assessment

Status: offline design complete; no package or export change

## Recommendation

Implement M8b.1 in the existing `apps/cli` package. It already owns the
`lachesis` binary, the Node-only process boundary, JSON file handling, exit
status, and the established plan commands. A second binary or public package
would fragment one product workflow without creating a portable capability.

The proposed catalog workflow can be composed entirely from the `0.1.0-alpha.3`
exports of:

- `@nicia-ai/lachesis` for catalog validation, semantic-role declarations,
  canonical JSON, fingerprints, digests, and manifests; and
- `@nicia-ai/lachesis-generator` for offline conformance, structured
  diagnostics, rendering, and diagnostic/report identity verification.

M8b.1 therefore requires **zero new public exports**. Publishing the currently
private CLI is a later product decision and is not part of M8b.0 or implicitly
authorized by an implementation GO.

The exact public composition points audited for the workflow are:

| Concern                                    | Existing alpha.3 export                                                |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| Catalog construction and validated read    | `createCatalog`, `readCatalog`                                         |
| Semantic-role wire validation              | `catalogSemanticRolesSchema` and role declaration schemas              |
| Manifest creation                          | `createPlanLanguageManifest`                                           |
| Catalog and value identity                 | `fingerprintCatalog`, `digestValue`                                    |
| Canonical serialization and JSON narrowing | `canonicalizeJson`, `parseJson`                                        |
| Suite validation                           | `catalogConformanceSuiteSchema`                                        |
| Conformance execution                      | `diagnoseCatalogsOffline`                                              |
| Structured result verification             | `verifyCatalogConformanceReport`, `verifyCatalogConformanceDiagnostic` |
| Safe existing diagnostic prose             | `renderCatalogConformanceDiagnostic`                                   |

## Audited boundary

The existing CLI is an ESM, Node-only application. The kernel remains portable
and Workers-compatible. Catalog operations belong at the Node boundary because
they resolve files, import trusted catalog modules, write artifacts, and set
process exit status. They must not introduce `node:*`, `Buffer`, `process`, or
filesystem dependencies into the kernel.

Catalog inputs are trusted compiled ESM modules, addressed as
`./catalog.mjs#catalogExport`. This is unavoidable with the current public
contract: catalog validators and operation implementations are executable
values, not wire data. The CLI must not evaluate source strings, transpile
TypeScript, or accept callbacks in JSON. A TypeScript project compiles its
catalog before invoking the CLI.

Detached `report verify` remains data-only and must not import a catalog module.

## Manifest verification boundary

Alpha.3 can safely verify a manifest by regenerating it from a trusted catalog
module and the selected policy, then comparing canonical bytes and identities.
It does not expose a parser that turns an arbitrary detached manifest into a
trusted executable catalog. M8b.1 must keep manifest verification
**source-bound**:

```text
catalog module + policy -> regenerated manifest -> exact canonical comparison
```

Adding a detached-manifest parser would expand the public trust model and is not
justified by the registry-only M8a workflow. It is explicitly out of scope.

## Dependency and bundle impact

The current private CLI depends on the kernel and Zod. Conformance would add a
direct dependency on the existing generator package. The audited installed
footprints in the current workspace were approximately:

| Item                       | Approximate installed or built size |
| -------------------------- | ----------------------------------: |
| Existing CLI `dist`        |                              32 KiB |
| Kernel `dist`              |                             476 KiB |
| Generator `dist`           |                           1,512 KiB |
| `@babel/parser` dependency |                           1,980 KiB |
| `@babel/types` dependency  |                           3,164 KiB |
| Shared Zod installation    |                           6,404 KiB |

These are directional workspace measurements, not promised packed sizes. M8b.1
must measure the packed CLI tarball and cold install before any publication
review. Loading the generator lazily for `catalog compare --suite` is preferred
so manifest and report-verification startup do not pay conformance
initialization cost.

## ESM and resolution

- Accept project-relative file URLs or paths and a named export.
- Normalize the resolved URL before import and include it only in redacted human
  provenance; content identities, not absolute paths, belong in reports.
- Reject CommonJS ambiguity, default-export guessing, TypeScript source, remote
  URLs, package installation, and extension probing.
- Preserve the current Node 24 ESM baseline.
- Resolve output paths from the invocation directory, never from the imported
  module.

## Compatibility and deprecation

The existing top-level `validate`, `analyze`, `canonicalize`, and `run` plan
commands remain unchanged. The new `catalog` and `report` namespaces are
additive within the CLI, but their publication would still require a separate
review because the CLI is currently private.

No kernel or generator deprecation is needed. A future stable report protocol
must be versioned independently of package versions. Unknown protocol major
versions fail verification; additive fields require a new schema version because
byte identity and strict decoding make silent field acceptance unsafe.

## Decision

`GO` for an internal M8b.1 implementation in `apps/cli`, gated by packed
registry-consumer tests and without public API additions.

`NO-GO` for a new package, a second binary, detached executable-manifest
parsing, publication, or an alpha version change under this milestone.
