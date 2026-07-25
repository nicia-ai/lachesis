# M8b.2b.7 release-workflow reliability correction

Decision: `prepared-unexecuted-awaiting-separate-authorizations`.

Release run
[`30136489135`](https://github.com/nicia-ai/lachesis/actions/runs/30136489135)
failed before packing or publication. The default-parallel test phase passed 442
of 443 tests and timed out at the unchanged 20-second boundary in
`packages/evidence-typegraph/tests/parity.test.ts:145`. The pack and publish
steps were skipped, and the fail-closed handler returned release `359550250` to
draft.

## Root cause

The release workflow ran the full test matrix twice:

1. `pnpm test` used Vitest's default file parallelism.
2. `pnpm test:coverage` ran the same 443 tests with the repository's supported
   deterministic `--maxWorkers=1` mode and enforced coverage.

The test itself is valid but has little scheduling margin. Ten isolated
repetitions passed in 10 to 13 seconds. An uncontended default-parallel run
passed 443/443 with the target test at 9.943 seconds. Under a controlled model
that occupied 11 of this host's 14 logical CPUs, default-parallel repetitions 3
and 4 failed exactly like the hosted run: 442/443 passed and only the target
test exceeded 20 seconds. The other three repetitions passed with target
durations of 17.630, 18.210, and 19.708 seconds.

GitHub documents a standard public-repository `macos-15` runner as an ARM64
three-core M1 with 7 GB of memory. The actual failed run used that label. The
observed pass/fail boundary, successful isolated runs, and exact controlled
reproduction classify the failure as scheduler and contention sensitive rather
than a semantic parity failure.

## Correction

Workflow-only commit `36402de6560a2c5998d773e10f0c9a2695110e18` removes the
redundant `pnpm test` line. It retains `pnpm test:coverage`, whose frozen
package script is exactly:

```text
vitest run --coverage --maxWorkers=1
```

No test is skipped. All 443 tests still execute, and the coverage thresholds
remain enforced. The correction adds no retry, changes no assertion or timeout,
and modifies no package or test source.

The previous workflow SHA-256 was
`c6288195114390cbcb2369a0ae96f2573f8ccd4ab954950302496617dec822a1`. The
corrected workflow SHA-256 is
`2c04cf37d453916f3d189be1e0c09f6090db2ffa31d0c41397036dadeb9b66f4`.

## Verification

- Five clean single-worker runs passed 443/443. The target test took 9.335 to
  9.843 seconds.
- Three moderate-pressure single-worker runs passed 443/443. The target test
  took 14.951, 17.106, and 15.595 seconds.
- Three single-worker coverage runs passed 443/443 and the frozen thresholds:
  90.04% statements, 80.36% branches, 97.17% functions, and 94.06% lines.
- `actionlint` and static workflow assertions passed.
- The exact frozen source used Node 24.18.0 and pnpm 10.33.0.
- The package audit performed three pack runs for all six packages. Every run
  was byte-identical to the frozen digest, and strict Node, Workers, and packed
  consumer checks passed.
- The complete repository matrix passed: formatting, strict TypeScript 6,
  type-aware lint, single-worker coverage, build, Node and Workers smokes,
  offline examples, load baseline, source-safety audit, public-API inventory,
  M6/M7 release and preregistration checks, every M8 historical checksum audit,
  and the M8b.2a prospective release audit.
- The final repository coverage run executed all 443 tests, including the
  evidence-TypeGraph parity test, in 184.25 seconds.

One deliberately harsher stress observation is retained: after prolonged
11-worker background load, two single-worker runs passed and a third crossed the
parity timeout. This is not represented as a dedicated-runner acceptance result.
A supplemental three-CPU Linux ARM64 cgroup exposed unrelated Linux/bind-mount
test assumptions, so it is also not used as `macos-15` acceptance evidence.

## Preserved release state

- Package source remains `635521f1d2e753095fca4fdbbafbf7ed2287efe1`.
- `v0.1.0-alpha.4` still peels to that source.
- Release `359550250` is still a draft prerelease with body SHA-256
  `bec6a90f3c7683e3d66d10607ebfb4891105abb25064c5feae14e59196fc1a02`.
- The five library alpha.4 versions remain absent. Their `alpha` tags remain
  alpha.3 and `latest` remains alpha.1.
- The immutable CLI alpha.4 remains present with its frozen tarball and
  first-publication `alpha` and `latest` tags.
- The workflow still publishes only the five absent packages, requires the CLI
  as a frozen prerequisite, uses OIDC trusted publishing, and references no npm
  token.

No workflow was dispatched. No release, package, tag, dist-tag, trusted
publisher, secret, or token was created or changed.
