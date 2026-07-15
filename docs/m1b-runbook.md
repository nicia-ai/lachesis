# M1b controlled experiment runbook

This runbook prepares the Lachesis M1b provider pilot. This implementation task
does not authorize provider calls or spend. All live examples below are
procedures for a later, separately authorized run.

## Frozen campaign

The campaign has two durable pools. Smoke and calibration share
`m1b-development`, capped at 10,000,000 micro-dollars
($10) across every
development manifest. Held-out uses `m1b-heldout-pilot`, capped at 50,000,000
micro-dollars ($50),
with independent 25,000,000 micro-dollar OpenAI and Anthropic subcaps. A new
manifest does not create a new allowance. The absolute campaign authorization is
$60.

The primary matrix is direct OpenAI Responses `gpt-5.6-terra` with low reasoning
and direct Anthropic Messages `claude-sonnet-5` with adaptive thinking and low
effort. Vercel AI SDK is pinned to 7.0.28 with automatic retries set to zero.
Bedrock is optional secondary research and is rejected from the primary held-out
manifest and pools.

Anthropic structured output uses the AI SDK's `jsonTool` mode. Its `json` tool
is an internal `GenerationOutcome` output transport only; external tools remain
disabled. Every initial and repair prompt carries the same exact plan or
unplannable JSON contract and the public task-input declarations.

The causal result is the matched effect of `unconstrained-json`, `json-schema`,
and `json-schema-with-repair` within each model. Terra and Sonnet use different
reasoning treatments, so cross-provider numbers are descriptive, not a
controlled model-quality head-to-head.

## 1. Inspect and materialize

Build from the exact source to be tested, then create manifests outside the Git
worktree:

```sh
pnpm install --frozen-lockfile
pnpm build
node apps/benchmark/dist/cli.js materialize smoke --out /secure/m1b/smoke
node apps/benchmark/dist/cli.js materialize calibration --out /secure/m1b/calibration
node apps/benchmark/dist/cli.js materialize heldout --out /secure/m1b/heldout
```

Each phase file embeds the verified experiment manifest and binds campaign,
phase, budget pool, cases/splits, prompt and protocol digests, pricing, scorer,
provider/model/inference settings, repetitions, Git commit, runtime/package
versions, failure policy, and storage namespace. Validate a pair before use:

```sh
node apps/benchmark/dist/cli.js validate \
  --campaign /secure/m1b/smoke/campaign.json \
  --manifest /secure/m1b/smoke/smoke.json
```

Do not hand-edit a manifest. Rematerialize it and review the new digest. M1b.3
derives `storageNamespace` from the complete experiment digest, so a fresh smoke
registers beside the immutable original smoke without receiving a new
development allowance.

## 2. Zero-network dry run

Dry-run reads Git, manifests, and any existing ledger only. It does not load a
provider model, output credential values, or make a request:

```sh
node apps/benchmark/dist/cli.js dry-run \
  --campaign /secure/m1b/smoke/campaign.json \
  --manifest /secure/m1b/smoke/smoke.json \
  --storage-root /secure/m1b/state
```

The JSON includes all digests, split counts, exact methods and inference
settings, repetitions, benchmark-record and maximum-call counts, pricing and
scorer identities, expected capabilities, consumed/remaining pool amounts,
credential-name checks, Git checks, acknowledgement checks, and
`liveExecutionPermitted`.

The smoke phase is one feasible and one impossible development task, both
providers, three strategies, and one repetition: 12 records, 12 initial calls,
at most 8 repair calls, and at most 20 model calls.

## 3. Development transport smoke

Only after separate authorization, set the two direct-provider credentials in
the process environment. Do not put them in manifests, logs, shell history, or
the ledger. Copy the exact `experimentDigest` from dry-run and acknowledge the
entire applicable development pool:

```sh
node apps/benchmark/dist/cli.js execute \
  --campaign /secure/m1b/smoke/campaign.json \
  --manifest /secure/m1b/smoke/smoke.json \
  --storage-root /secure/m1b/state \
  --ack-experiment EXACT_EXPERIMENT_DIGEST \
  --ack-phase smoke \
  --ack-max-usd-micros 10000000
```

There is no `--yes`. Before every dispatched request the controller emits a
machine-readable budget status showing pool and provider remainder. Credential
checks report missing variable names only. AWS credentials are neither checked
nor required for the primary route.

## 4. Bounded calibration

Calibration is a preregistered development-only set. It covers number, text,
decision, and workflow catalogs; map/filter/fold; branching; effectful
operations; a dedicated development-only `boundedFix` probe; and an impossible
task. The workflow probe is not a held-out corpus example. Smoke spend reduces
the same $10 balance available to calibration.

Before calibration, preregister no more than three prompt candidates. Record
every candidate body, version, digest, rationale, and result, including failed
candidates. Never open, print, render, or score held-out examples while revising
prompts. Do not add candidates after seeing held-out outcomes.

Select the prompt by development semantic success. Break ties by fewer repair
turns, then fewer total output/reasoning tokens, then retain the earlier prompt
version. Do not selectively rerun a poor semantic outcome. Any new prompt
candidate is a new content-addressed calibration manifest but remains charged to
the same development pool.

## 5. Freeze held-out

After choosing the prompt, run the full verification suite and commit the final
code. Confirm `git status --porcelain` is empty. Materialize held-out from that
clean commit into the external experiment directory, validate it, dry-run it,
and commit the manifest plus its digest to the experiment's separate
preregistration/audit repository.

A manifest cannot be both committed into this source repository and name the
commit that contains itself: Git commit identity is content-addressed. Keep the
executable manifest outside this worktree (or in a separate audit repository) so
its bound source commit remains checked out and clean. Held-out preflight
refuses both a dirty worktree and a commit mismatch.

The frozen held-out corpus is 9 catalog, 4 operator-combination, and 4 phrasing
cases (17 total). The primary matrix is 17 × 3 strategies × 2 providers × 2
repetitions = 204 records. Only repair methods may use two additional calls, so
the ceiling is 204 initial + 136 repair = 340 calls, below the frozen 400-call
experiment cap.

## 6. Execute and resume held-out

Use the exact held-out acknowledgement:

```sh
node apps/benchmark/dist/cli.js execute \
  --campaign /secure/m1b/heldout/campaign.json \
  --manifest /secure/m1b/heldout/heldout.json \
  --storage-root /secure/m1b/state \
  --ack-experiment EXACT_EXPERIMENT_DIGEST \
  --ack-phase heldout \
  --ack-max-usd-micros 50000000
```

After interruption, use `resume` with the identical manifest and
acknowledgement. Completed benchmark keys—including stored provider failures—are
loaded exactly once and never dispatched again. A reservation left without a
benchmark record is retained at worst-case cost and blocks duplicate dispatch;
investigate the immutable ledger rather than deleting or rewriting history.

The campaign lock admits one executor. An active lock refuses competitors. A
lock older than 15 minutes is renamed with a `.stale-*` suffix and retained as
audit evidence before one recovery attempt. Confirm no live process owns a lock
before treating it as stale.

## 7. Failure policy

The content-addressed policy is `record-and-continue`, with SDK retries disabled
and a 120-second timeout identity. Compiler-guided repair is a semantic protocol
step and is limited to two calls; it is not a transport retry. Provider
transport failure, timeout, safety refusal, invalid model output, parse failure,
wire-schema failure, compilation failure, and hidden semantic failure remain
distinct records.

Adapter results record `not-dispatched`, `dispatched-with-usage`, or
`dispatched-usage-unknown`. A pre-dispatch failure settles at zero tokens and
zero cost. If provider usage is unavailable after dispatch, the ledger retains
the entire worst-case reservation as authorized conservative accounting.
Provider-reported usage otherwise reconciles that reservation and is reported
separately from conservative accounting. Integer micro-dollars are used
throughout. Incomplete matched tuples are reported as incomplete/unevaluable;
they are never silently dropped or filled by selective reruns.

The ledger is append-only, sequence-numbered, hash-chained, campaign-bound, and
paired with a durable head. Validation rejects malformed, truncated, reordered,
duplicate, or mismatched events. The head detects removal of an already
committed suffix. Never delete or edit the ledger or head.

The immutable original smoke ledger is not retroactively edited or credited. Its
six OpenAI conservative settlements are historical overestimates caused by the
pre-M1b.3 callable-provider reflection semantics, which could not distinguish a
local factory failure from a dispatched request.

## 8. Offline report

Reporting reads only frozen manifests, content-verified benchmark records, and
the ledger. It does not construct adapters or contact providers:

```sh
node apps/benchmark/dist/cli.js report \
  --campaign /secure/m1b/heldout/campaign.json \
  --manifest /secure/m1b/heldout/heldout.json \
  --storage-root /secure/m1b/state
```

The report separates invalid provider responses from provider failures and
includes parse, wire, first-compile, post-repair compile, semantic execution,
correct abstention, repairs, all token classes, integer cost, latency, Wilson
95% intervals, matched/incomplete denominators, budget consumption/remainder,
and exact provider/model configuration. Within-provider matched comparisons are
primary. CodeMode remains explicitly unevaluated.

## Excluded scope

TypeGraph is not a dependency of the kernel, generator, provider adapter, or
controller. CodeMode, live prompt calibration, provider spend, package
publication, deployment, and the knowledge graph remain outside this milestone.
