# M8b.1 detached report verification and CI contract

Stage 5 adds the private, offline integrity command:

```sh
lachesis report verify \
  --input artifacts/catalog-command-report.json \
  --artifact native-conformance-report=artifacts/native-conformance.json \
  --report artifacts/verification.json
```

The verifier reads only the command report and the explicitly bound artifacts.
It does not import catalog modules, load the generator, execute a conformance
suite or user code, access a provider, or use the network or credentials.

It verifies the strict frozen command-report schema and canonical identity,
derived summaries/status/completeness/exit behavior, nested diagnostics and
finite assessments, artifact checksums, kind-specific semantic identities, and
cross-references. A valid source report whose original outcome is `10`, `11`,
`12`, or `13` produces verifier exit `0`: that means the evidence is intact, not
that the underlying catalog change is accepted.

## POSIX CI

The tested [exit-policy script](../examples/m8b1-ci/ci-exit-policy.sh) keeps the
comparison decision separate from detached integrity:

```sh
set +e
lachesis catalog compare \
  --left-catalog ./dist/v1.js#catalog \
  --left-policy ./dist/v1.js#policy \
  --right-catalog ./dist/v2.js#catalog \
  --right-policy ./dist/v2.js#policy \
  --suite ./dist/suite.js#suite \
  --conformance-out artifacts/native-conformance.json \
  --report artifacts/catalog-command-report.json
comparison_exit=$?
set -e

./examples/m8b1-ci/ci-exit-policy.sh "$comparison_exit"

lachesis report verify \
  --input artifacts/catalog-command-report.json \
  --artifact native-conformance-report=artifacts/native-conformance.json \
  --report artifacts/verification.json
```

Exits `11`, `12`, and `13` always fail. Exit `10` fails by default and may pass
only through an explicit repository policy:

```sh
LACHESIS_ALLOW_REVIEW_REQUIRED=1 \
  ./examples/m8b1-ci/ci-exit-policy.sh "$comparison_exit"
```

## GitHub Actions

```yaml
- name: Compare catalogs
  id: compare
  shell: bash
  run: |
    set +e
    lachesis catalog compare \
      --left-catalog ./dist/v1.js#catalog \
      --left-policy ./dist/v1.js#policy \
      --right-catalog ./dist/v2.js#catalog \
      --right-policy ./dist/v2.js#policy \
      --suite ./dist/suite.js#suite \
      --conformance-out artifacts/native-conformance.json \
      --report artifacts/catalog-command-report.json
    code=$?
    set -e
    echo "code=$code" >> "$GITHUB_OUTPUT"

- name: Enforce catalog policy
  shell: bash
  env:
    # Set to 1 only through reviewed repository policy.
    LACHESIS_ALLOW_REVIEW_REQUIRED: ${{ vars.LACHESIS_ALLOW_REVIEW_REQUIRED }}
  run: ./examples/m8b1-ci/ci-exit-policy.sh '${{ steps.compare.outputs.code }}'

- name: Verify detached evidence
  shell: bash
  run: |
    lachesis report verify \
      --input artifacts/catalog-command-report.json \
      --artifact native-conformance-report=artifacts/native-conformance.json \
      --report artifacts/verification.json
```

Do not use verification success to override the comparison exit. The policy gate
and integrity gate answer different questions and both must pass.

## Security boundary

Descriptor-bound reads, parent and leaf symlink rejection, identity drift
checks, bounded I/O, and atomic no-clobber output protect against the frozen
controller and the tested mutation model. They do not claim kernel-atomic
isolation from a malicious concurrent process running as the same operating
system user. Run CI in an isolated job/container with no untrusted same-user
process.
