# M8b.0 catalog-author CLI product specification

Status: design complete; implementation not authorized.

Decision: use the existing private `lachesis` binary and add three coherent
commands in M8b.1. Do not add a package, binary, or public library export.

## Product boundary

The CLI turns a trusted catalog-author module into content-addressed artifacts
and fail-closed CI decisions. It does not generate catalogs, execute providers,
infer semantic equivalence, or apply repairs.

Catalog modules are executable host code containing Zod validators and
registered implementations. Loading one is equivalent to running trusted build
configuration. The CLI must never load a catalog module from an untrusted pull
request without an external sandbox.

## Alternatives considered

| Surface                                                                       | Assessment                                                                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Five verbs: `validate`, `manifest`, `compare`, `conformance`, `report verify` | Clear but duplicates catalog loading, manifest creation, and comparison                             |
| One `catalog` command with mode flags                                         | Small but hard to discover and produces invalid flag combinations                                   |
| Three commands: `catalog manifest`, `catalog compare`, `report verify`        | Recommended: one artifact producer, one comparison/conformance gate, one detached integrity checker |

`catalog validate` is unnecessary because manifest construction already
validates the catalog, registrations, reducer-law declarations, semantic-role
declarations, and policy. `catalog conformance` is unnecessary because
conformance is the evidence-bearing mode of `catalog compare`.

## Common conventions

- Runtime: Node 24, ESM only.
- Module locator: `<project-relative-file>#<named-export>`, for example
  `./catalog/dist/index.js#incidentCatalog`.
- Locators must resolve beneath `--project-root` (default: current directory).
  Absolute paths, URLs, bare package specifiers, directory imports, and missing
  fragments reject.
- TypeScript sources must be compiled by the author before invocation. The CLI
  does not install or embed a TypeScript loader.
- `--report <path|->` is required. `-` writes canonical JSON to stdout.
- Human diagnostics go to stderr and never affect report bytes.
- Files are written through same-directory temporary files, fsynced where the
  platform supports it, and renamed atomically. Existing files require
  `--replace`; symlink outputs reject.
- Inputs are read once, bounded, hashed, and retained in memory for the command.
- No ambient time, random ID, hostname, absolute path, environment value, or
  color escape enters a machine report.
- Reports use `lachesis-canonical-json/1` plus a trailing newline.

## Command 1: `catalog manifest`

### Create

```text
lachesis catalog manifest \
  --catalog ./dist/catalog.js#incidentCatalog \
  --policy ./dist/catalog.js#incidentPolicy \
  --out artifacts/incident.manifest.json \
  --report artifacts/incident.manifest.report.json
```

Inputs:

- `--catalog`: named ESM export whose value is a Lachesis `Catalog`;
- `--policy`: named ESM export whose value satisfies `CompilationPolicy`;
- exactly one mode: `--out`, `--check`, or `--verify`.

Behavior:

1. resolve and hash the module bytes and export locators;
2. import the trusted module once;
3. validate catalog structure and semantic-role declarations through the public
   catalog boundary;
4. create a `PlanLanguageManifest`;
5. verify its fingerprint and digest;
6. either emit it (`--out`), retain no manifest (`--check`), or compare it
   byte-for-byte with a regenerated manifest (`--verify <file>`); and
7. emit a command report.

`--verify` is deliberately source-bound. Alpha.3 does not expose an untrusted
`PlanLanguageManifest` parser. Regenerating from the catalog and policy verifies
the complete semantic artifact without mirroring a public type or adding an
export.

Results:

- valid/create/check/exact verification: exit `0`;
- invalid catalog, declaration, policy, or manifest: exit `20`;
- manifest byte or digest mismatch in verify mode: exit `22`;
- incomplete read/write: exit `23`;
- controller invariant failure: exit `70`.

### Check only

```text
lachesis catalog manifest \
  --catalog ./dist/catalog.js#incidentCatalog \
  --policy ./dist/catalog.js#incidentPolicy \
  --check \
  --report -
```

## Command 2: `catalog compare`

### Structural comparison

```text
lachesis catalog compare \
  --left-catalog ./dist/v1.js#catalog \
  --left-policy ./dist/v1.js#policy \
  --right-catalog ./dist/v2.js#catalog \
  --right-policy ./dist/v2.js#policy \
  --report artifacts/catalog-diff.json
```

The CLI regenerates and verifies both manifests. Without `--suite`, it may
report exact identity, identity-only changes, declaration changes, signature
changes, and policy changes. It must not claim semantic compatibility.

- identical manifest: exit `0`;
- any changed identity or declaration requiring author review: exit `10`;
- invalid input: exit `20`.

Optional `--left-manifest` and `--right-manifest` bind previously emitted
artifacts. When supplied, each must equal its regenerated manifest.

### Semantic conformance

```text
lachesis catalog compare \
  --left-catalog ./dist/v1.js#catalog \
  --left-policy ./dist/v1.js#policy \
  --right-catalog ./dist/v2.js#catalog \
  --right-policy ./dist/v2.js#policy \
  --suite ./dist/conformance.js#suite \
  --report artifacts/catalog-conformance.json
```

`--suite` must be a named ESM export accepted by
`catalogConformanceSuiteSchema`. The CLI calls `diagnoseCatalogsOffline`,
verifies the returned report or diagnostic identity with the corresponding
public verifier, and records the initial result.

Results:

- conformant on the supplied finite suite: exit `0`;
- declaration-repairable: exit `11`;
- genuinely non-equivalent: exit `12`;
- insufficient fixture evidence or otherwise unverifiable: exit `13`;
- invalid catalog, suite, or source-bound manifest: exit `20`;
- incomplete execution: exit `23`;
- controller invariant failure: exit `70`.

The CLI never changes a declaration. A repaired declaration is a new command
invocation and a new report. If a higher-level migration record references both
attempts, it retains distinct `initial` and `post-repair` outcomes.

## Command 3: `report verify`

```text
lachesis report verify \
  --input artifacts/catalog-conformance.json \
  --artifact catalog-v1=artifacts/v1.manifest.json \
  --artifact catalog-v2=artifacts/v2.manifest.json \
  --report -
```

Behavior:

1. parse the strict supported report protocol;
2. recompute all summary counts from detailed records;
3. recompute the command-report digest;
4. verify nested conformance report/diagnostic identities;
5. bind each supplied artifact ID to the recorded raw-byte SHA-256 and semantic
   digest where applicable; and
6. reject missing, extra, duplicated, or mismatched bindings.

This command never imports a catalog module. It verifies report and artifact
integrity, not the truth of semantic-role declarations.

Results:

- complete identity and checksum verification: exit `0`;
- malformed report or unsupported protocol: exit `20`;
- report, nested identity, or artifact checksum mismatch: exit `22`;
- missing artifact or interrupted verification: exit `23`;
- controller invariant failure: exit `70`.

## Output and flag errors

Unknown commands, unknown flags, duplicate singleton flags, mutually exclusive
modes, missing values, and invalid module locators return exit `64` and emit no
command report because no command identity can be constructed. This usage code
is outside the semantic outcome matrix.

## CI use

Unsafe catalog evolution always has a nonzero exit. CI can distinguish review
without weakening the safety gate:

```bash
set +e
lachesis catalog compare ... --report conformance.json
code=$?
set -e
case "$code" in
  0)  exit 0 ;;
  10) echo "Author review required"; exit 0 ;; # explicit local policy
  *)  exit "$code" ;;
esac
```

Allowing `10` is an explicit application policy. Codes `11`, `12`, `13`, `20`,
`21`, `22`, `23`, and `70` must never be converted to compatibility by the CLI.

## Compatibility

The current private top-level `validate`, `analyze`, `canonicalize`, and `run`
commands remain unchanged during M8b.1. They are internal legacy plan commands,
not an alpha.3 public contract. A later public CLI review may place them under
`lachesis plan ...`; no alias removal or deprecation occurs in M8b.1.
