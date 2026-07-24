# `@nicia-ai/lachesis-cli`

Experimental, offline catalog-author and CI commands for Lachesis.

This package is an ESM-only Node 24 binary. It exposes the `lachesis`
executable, not a supported JavaScript import surface. CommonJS and declaration
files are not promised.

## Install and quick start

Requirements:

- Node `>=24 <25`;
- a project using ESM; and
- catalogs compiled to JavaScript before invoking the CLI.

Install the alpha explicitly:

```sh
pnpm add --save-dev @nicia-ai/lachesis-cli@alpha
```

Assume `dist/catalog.js` exports a Lachesis `Catalog` named `catalog` and a
`CompilationPolicy` named `policy`. Validate both and emit a deterministic
machine report:

```sh
mkdir -p artifacts
pnpm exec lachesis catalog manifest \
  --catalog ./dist/catalog.js#catalog \
  --policy ./dist/catalog.js#policy \
  --check \
  --report artifacts/catalog-check.json
```

A locator is exactly `<compiled-esm-path>#<named-export>`. Paths must be
project-relative regular files beneath the project root. Absolute paths, URLs,
bare package specifiers, directories, missing fragments, ambiguous exports, and
symlink escapes reject. The module is trusted executable configuration and is
loaded once from the bytes whose digest appears in the report. Do not load
catalog code from an untrusted change without an external sandbox.

## `catalog manifest`

Validate a catalog and policy and create a content-addressed plan-language
manifest:

```sh
pnpm exec lachesis catalog manifest \
  --catalog ./dist/catalog.js#catalog \
  --policy ./dist/catalog.js#policy \
  --out artifacts/catalog.manifest.json \
  --report artifacts/catalog.manifest.report.json
```

Exactly one mode is required:

- `--check` validates and generates in memory without retaining a manifest;
- `--out <file>` writes the canonical manifest; or
- `--verify <file>` regenerates from the source and requires exact artifact
  identity.

Existing outputs require `--replace`.

## `catalog compare`

Structural comparison reports changes as `review-required`; it never claims
compatibility or substitutability:

```sh
set +e
pnpm exec lachesis catalog compare \
  --left-catalog ./dist/v1.js#catalog \
  --left-policy ./dist/v1.js#policy \
  --right-catalog ./dist/v2.js#catalog \
  --right-policy ./dist/v2.js#policy \
  --report artifacts/catalog-diff.json
comparison_exit=$?
set -e
```

Optional `--left-manifest <file>` and `--right-manifest <file>` inputs must
equal independently regenerated manifests.

To evaluate a finite, explicit conformance suite, add a compiled ESM suite
export and a separate native-report output:

```sh
set +e
pnpm exec lachesis catalog compare \
  --left-catalog ./dist/v1.js#catalog \
  --left-policy ./dist/v1.js#policy \
  --right-catalog ./dist/v2.js#catalog \
  --right-policy ./dist/v2.js#policy \
  --suite ./dist/conformance.js#suite \
  --conformance-out artifacts/native-conformance.json \
  --report artifacts/catalog-conformance.json
comparison_exit=$?
set -e
```

A conformant suite establishes only conformance over those finite fixtures.
Policy differences remain review-required. Declaration repairs are conditional,
never automatically applied or accepted. Genuine differences render explicit
`do-not-substitute` guidance.

## `report verify`

Verify a command report without importing catalogs, loading the generator,
executing user code, or using network or credentials:

```sh
pnpm exec lachesis report verify \
  --input artifacts/catalog-conformance.json \
  --artifact native-conformance-report=artifacts/native-conformance.json \
  --report artifacts/verification.json
```

Repeat `--artifact <artifact-id>=<path>` for exactly the artifacts declared by
the source report. The verifier checks raw bytes, semantic identities, derived
summaries, command identity, nested evidence, and cross-references. Verification
exit `0` means the report is intact. It does not convert an underlying exit
`10`–`13` into semantic acceptance.

## Exit codes

| Exit | Meaning                                                          | CI treatment                                             |
| ---: | ---------------------------------------------------------------- | -------------------------------------------------------- |
|  `0` | Complete success or finite conformant result                     | Pass                                                     |
| `10` | Structurally valid change requires author review                 | Fail unless an explicit repository policy permits review |
| `11` | Declaration-repairable; guidance remains conditional             | Fail                                                     |
| `12` | Genuine semantic difference; do not substitute                   | Fail                                                     |
| `13` | Insufficient or incomplete finite evidence                       | Fail                                                     |
| `20` | Invalid catalog, declaration, policy, suite, manifest, or report | Fail                                                     |
| `21` | Compilation or policy rejection in a supported report            | Fail                                                     |
| `22` | Identity, semantic digest, checksum, or verification mismatch    | Fail                                                     |
| `23` | Incomplete bounded read, write, artifact, or verification        | Fail                                                     |
| `64` | Command-line usage error before a command identity exists        | Fail                                                     |
| `70` | Internal controller invariant failure                            | Fail                                                     |

Exit `10` is not compatibility. A repository may allow it only as a separate,
reviewed policy decision. Exits `11`, `12`, and `13` must never be pooled with
or converted to success.

## POSIX CI policy

```sh
case "$comparison_exit" in
  0) ;;
  10)
    test "${LACHESIS_ALLOW_REVIEW_REQUIRED:-0}" = "1" || exit 10
    ;;
  *) exit "$comparison_exit" ;;
esac

pnpm exec lachesis report verify \
  --input artifacts/catalog-conformance.json \
  --artifact native-conformance-report=artifacts/native-conformance.json \
  --report artifacts/verification.json
```

Keep the comparison policy gate and detached integrity gate separate.

## GitHub Actions

```yaml
- name: Compare catalogs
  id: compare
  shell: bash
  run: |
    set +e
    pnpm exec lachesis catalog compare \
      --left-catalog ./dist/v1.js#catalog \
      --left-policy ./dist/v1.js#policy \
      --right-catalog ./dist/v2.js#catalog \
      --right-policy ./dist/v2.js#policy \
      --suite ./dist/conformance.js#suite \
      --conformance-out artifacts/native-conformance.json \
      --report artifacts/catalog-conformance.json
    code=$?
    set -e
    echo "code=$code" >> "$GITHUB_OUTPUT"

- name: Enforce comparison policy
  shell: bash
  env:
    LACHESIS_ALLOW_REVIEW_REQUIRED: ${{ vars.LACHESIS_ALLOW_REVIEW_REQUIRED }}
  run: |
    code='${{ steps.compare.outputs.code }}'
    case "$code" in
      0) ;;
      10) test "${LACHESIS_ALLOW_REVIEW_REQUIRED:-0}" = "1" ;;
      *) exit "$code" ;;
    esac

- name: Verify detached evidence
  shell: bash
  run: |
    pnpm exec lachesis report verify \
      --input artifacts/catalog-conformance.json \
      --artifact native-conformance-report=artifacts/native-conformance.json \
      --report artifacts/verification.json
```

## Filesystem and output guarantees

Source modules are bounded to 8 MiB. Reports, manifests, conformance artifacts,
and detached artifacts are bounded to 16 MiB. Reads are descriptor-bound and
reject symlinks, non-regular files, truncation, growth, replacement, and
identity drift under the tested controller mutation model.

Outputs use same-directory temporary files, bounded writes, identity
verification, and atomic rename. Existing files require `--replace`; aliases
between inputs and outputs reject before execution. Suite mode stages the native
artifact and command report as one two-output transaction whose report is the
sole commit marker.

These protections do not claim kernel-atomic isolation from a malicious
concurrent process running as the same operating-system user. Use an isolated CI
job or container with no untrusted same-UID process.

## Troubleshooting

`Usage error (64)` : Supply every required flag once. Use exactly one manifest
mode and include the `#named-export` locator fragment.

`Invalid input (20)` : Compile TypeScript to ESM first. Confirm the named
exports are a Lachesis `Catalog`, `CompilationPolicy`, or conformance suite as
appropriate.

`Mismatch (22)` : Regenerate artifacts from the exact catalog bytes and bind
every artifact ID exactly as recorded. Do not edit canonical JSON reports.

`Incomplete (23)` : Check file size, permissions, missing artifacts, existing
outputs, symlinks, stale temporary paths, or concurrent replacement. Use
`--replace` only for an intentional existing regular output.

`Review or rejection (10–13)` : Read the stable code and localized role,
operation, and boundary. Treat repair advice as conditional. Never change
metadata to manufacture equivalence, and never substitute a genuine difference.

`Cannot import @nicia-ai/lachesis-cli` : Expected. This package supports only
the `lachesis` binary and publishes no JavaScript import contract.
