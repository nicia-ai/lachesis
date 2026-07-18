# M3b.4: structured-output forensics and bounded wire recovery

Status: the stress probe and calibration are complete and immutable. Calibration
recorded 236/240 first-attempt success, three wire repairs, two semantic
repairs, and 240/240 final reliability. Its Anthropic retraction-stratum
failures remain unchanged historical observations. This document does not
authorize held-out inference or creation of a new budget pool.

M3b.3 is frozen as an immutable calibration failure. Its probe passed, but four
Anthropic `graph-adjacency` calibration records completed at the provider and
then failed at the AI SDK structured-output boundary. The records retained
usage, response metadata, finish reason, output digest, and byte count, but not
enough bounded output or exception detail to identify the malformed field. The
M3b.3 calibration experiment is `complete-calibration-fail`; its held-out
identity is `blocked-unexecuted`. Neither may execute or resume.

## Staged decoding and durable forensics

M3b.4 records four distinct stages:

```text
provider response
  -> JSON parse
  -> portable wire-schema validation
  -> public semantic-obligation validation
```

The adapter explicitly uses the installed AI SDK's
`NoObjectGeneratedError.isInstance` classifier. It preserves bounded sanitized
error and cause classes, message, finish metadata, usage, parse result, wire
result, and Zod issue codes, paths, and messages. SDK-thrown raw output is
written through the Node controller to a SHA-256-addressed artifact capped at
65,536 bytes. Artifact directories are mode `0700`; files are mode `0600`.
Portable benchmark records retain only the verified artifact reference.

When an SDK exception contains output and usage, Lachesis independently parses
and validates that output. Runtime-valid output is recovered and marked
`sdk-runtime-schema-disagreement`; it is never silently retried. Invalid output
is classified as `json-parse-failed` or `wire-schema-rejected`. Transport retry
remains restricted to overload, timeout, and unavailability.

## Bounded wire repair

One wire repair is permitted before the existing semantic repair. It receives
only the unchanged arm-visible evidence, public answer contract, exact public
wire schema, bounded previous raw output, and deterministic parse/wire
diagnostics. It receives no hidden answer, expected citation, source/arm label,
or score.

Records report independently:

- first-attempt end-to-end success;
- first-attempt public-semantic success;
- post-wire-repair success; and
- final post-semantic-repair reliability.

Each initial, wire-repair, and semantic-repair invocation may receive one
symmetric controller transport retry. Contract failures are deterministic and
not retryable.

## Prospective Anthropic transport selection

The installed Anthropic adapter was tested offline with intercepted fetch for
both `outputFormat` and `jsonTool`, using development provenance and temporal
shapes. The prospective rule was exact serialization of the frozen portable
schema with no external tools.

`outputFormat` rewrites `minLength` and `maxItems` constraints into schema
descriptions. `jsonTool` transmits the exact schema, so M3b.4 prospectively
selects `jsonTool`. The JSON tool remains an internal output-transport
mechanism; external model tools are disabled. This selection occurred without
provider inference and is bound into transport and experiment identity.

## Fresh stress probe

The new development-only stress phase uses three provenance and three temporal
fixtures, four repetitions, two matched arms (`graph-facts` and
`graph-adjacency`), and two providers:

```text
6 cases x 4 repetitions x 2 arms x 2 providers = 96 initial records
```

This provides 24 graph-adjacency and 24 matched graph-facts trials per provider.
The frozen prospective gate requires all 96 records to have precise staged
classifications, zero opaque failures, zero SDK/runtime-schema disagreements,
zero selected-route first-attempt wire failures on Anthropic graph-adjacency,
complete matched coverage, and zero authorization or identity violations.
First-attempt, wire-repaired, semantic-repaired, and final outcomes remain
separate.

M3b.4 uses a fresh development-only campaign capped at `30,000,000 µUSD`, with
`17,000,000 µUSD` available to OpenAI and `13,000,000 µUSD` to Anthropic. The
M3b.3 ledger remains an immutable historical binding rather than an authority
source for M3b.4. Materialization alone conveys zero spend authority.
Calibration may receive a new identity only after a separately preregistered and
authorized stress probe passes. The campaign contains no held-out pool; held-out
and TypeGraph remain blocked.

## Calibration cohort envelope

The completed stress probe observed zero wire repairs, 18 semantic repairs, and
zero transport retries across 96 initial records. Calibration therefore keeps
the same per-record recovery rules while prospectively imposing these durable
provider-level quotas:

| Attempt type    | OpenAI | Anthropic |
| --------------- | -----: | --------: |
| Initial         |    120 |       120 |
| Wire repair     |     24 |        24 |
| Semantic repair |     48 |        48 |
| Transport retry |     48 |        48 |
| Total           |    240 |       240 |

The append-only ledger checks the applicable cohort quota before every dispatch.
Exhausting any quota makes calibration incomplete and therefore `NO-GO`; it does
not change the per-record repair or retry rule. Before a new manifest is
registered, the ledger also requires the complete phase envelope to fit the
campaign's then-current total and provider balances. Admission failure appends
no manifest or reservation event.

At frozen pricing, the 480-attempt ceiling is `22,800,000 µUSD`:
`13,200,000 µUSD` for OpenAI and `9,600,000 µUSD` for Anthropic. This is a
resource limit, not permission to spend.

Calibration used a fresh 30-case development corpus with five cases in each of
the six categories. Offline audits require no reused fixture identity, entity,
normalized instruction wording, answer, fixture structure, or frozen
neighborhood from the earlier development corpus; zero answer-bearing query
leakage; valid ground-truth references; deterministic selection; and all four
factorial arms for every case. The superseded held-out candidate was never
executed. A strictly disjoint replacement and fresh held-out campaign are
defined by [M3b.5 held-out preparation](m3b5-heldout-preparation.md).
