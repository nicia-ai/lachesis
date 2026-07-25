# M8b.2b.8 release-verification investigation

Decision: `NO-GO`.

No workflow correction was implemented. The required isolated-process
reliability gate failed before the coverage merge or verification-only workflow
could be accepted.

## Failed hosted run

Release run
[`30144568420`](https://github.com/nicia-ai/lachesis/actions/runs/30144568420)
ran from workflow commit `36402de6560a2c5998d773e10f0c9a2695110e18` against
frozen source `635521f1d2e753095fca4fdbbafbf7ed2287efe1`. The single-worker
suite passed 442 of 443 tests. The unchanged identity test at
`packages/evidence-typegraph/tests/parity.test.ts:145` timed out after 20.016
seconds.

The package-set, registry, packing, publication, and reconciliation steps were
all skipped. The failure handler restored release `359550250` to draft. No npm
package or dist-tag changed.

## Prospective split-process test

Vitest 4.1.10 supports collecting test and V8 coverage evidence in blob reports
and applying reporters and coverage after `--merge-reports`. The proposed
transaction would therefore:

1. execute the entire evidence-TypeGraph parity file in one fresh process;
2. execute all other test files with that path explicitly excluded and
   `maxWorkers=1`;
3. merge both blob reports; and
4. apply the unchanged aggregate and per-file thresholds from
   `vitest.config.ts`.

The requested count of “remaining 442 tests” is incompatible with whole-file
isolation. The parity file contains 14 tests. Exact-once accounting is therefore
14 isolated tests plus 429 remaining tests, for 443 total.

The first uncontended local isolated-file run failed before merge validation:

- Node 24.18.0 and pnpm 10.33.0;
- a fresh Vitest process;
- separate blob and coverage paths;
- 13 of 14 tests passed;
- the same identity test timed out at 20.009738833 seconds; and
- no coverage report was emitted after the failed test process.

This triggers the prospective kill gate. Adding workflow plumbing after the
isolated phase proved unreliable would turn a known failure into an
unsubstantiated release mechanism.

## Larger-runner availability

The `nicia-ai` organization currently reports the GitHub Free plan. The
organization hosted-runner API returns `404` with “GitHub hosted runners are not
supported for this organization.”

GitHub documents larger runners as available only to organizations on Team or
Enterprise Cloud. The currently documented macOS choices include:

- `macos-15-xlarge`: arm64 M2, 5 CPU, 14 GB RAM, $0.102 per minute; and
- `macos-15-large`: x64 Intel, 12 CPU, 30 GB RAM, $0.077 per minute.

Larger-runner minutes are billed separately and are not free for public
repositories. No plan change, billing authorization, runner creation, or
repository access grant was authorized or performed.

Sources:

- <https://docs.github.com/en/actions/concepts/runners/larger-runners>
- <https://docs.github.com/en/actions/reference/runners/larger-runners>
- <https://docs.github.com/en/billing/reference/actions-runner-pricing>

## Authorization disposition

The three requested authorizations are withheld:

1. There is no correction commit to push.
2. There is no accepted verification-only path or eligible larger runner to
   dispatch.
3. A final release dispatch is prohibited because the hosted verification gates
   have not passed.

A future attempt requires separate authority to change the organization plan and
billing posture, provision a named larger runner, bind repository access, and
prepare a fresh verification-only workflow correction. That correction must then
pass several hosted runs before a release authorization can exist.

## Preserved state

`.github/workflows/release.yml` remains byte-identical at SHA-256
`2c04cf37d453916f3d189be1e0c09f6090db2ffa31d0c41397036dadeb9b66f4`. Package
source, the test and timeout, assertions, coverage thresholds, frozen
source/tag/tarballs, release notes, registry state, and trusted publishers
remain unchanged.

No workflow was pushed or dispatched. No release, runner, credential, package,
tag, or dist-tag was created or changed.
