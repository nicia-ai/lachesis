# M5 results: production evidence runtime

Status: **complete-operational-pass**

M5 delivered an offline-first evidence runtime and then exercised its frozen
production-pilot path against both configured providers. The 24-record M5b.1
pilot completed without repair, retry, accounting ambiguity, permission drift,
or replay mismatch.

The immutable machine-readable record is [`m5-results.json`](./m5-results.json).
Its artifact checksums bind the frozen external manifest, ledger, record,
replay, and private-SQLite evidence set without copying or modifying those
artifacts.

## Frozen identity

- Execution source: `1f1db6247c07653dc2e91715e4b25d18b7781a5c`
- Campaign: `9eb02a74d5c696c355b9047f27c65c7dafc8ba7ea156c32b5bbd3d61ac2f765f`
- Experiment: `2b0de5d270d5284997660abba3977de66f93f70cd7fda2820a2429bdc868aba3`
- Phase manifest:
  `82c9e5d532eef29bec54d538402e635e2bfee4b7d6341f29885f5f594ef72c74`
- Schedule: `376cce010bdbc296ab3503eabbfec57db9ed354638cd295b7d92d20784064a63`
- Final ledger: 68 events ending at
  `fc5c566d2a4c089259684c7e8cf1a3353a1ed25b92657bc4786a9382edb0acc9`
- Cumulative campaign spend: `311961` micro-US dollars

## Frozen operational result

| Measure                                                                                    | Result |
| ------------------------------------------------------------------------------------------ | -----: |
| Durable and precisely classified records                                                   |  24/24 |
| First-attempt end-to-end success                                                           |  24/24 |
| First-attempt semantic success                                                             |  24/24 |
| Final reliable outcomes                                                                    |  24/24 |
| Answerable outcomes with validated citations and provenance                                |  22/22 |
| Typed insufficient-evidence outcomes                                                       |    2/2 |
| Wire repairs                                                                               |      0 |
| Semantic repairs                                                                           |      0 |
| Transport retries                                                                          |      0 |
| Opaque failures or missing usage                                                           |      0 |
| Authorization, identity, capability, budget, snapshot, redaction, or permission violations |      0 |
| Exact offline replay                                                                       |  24/24 |

The 24 initial calls used 90,964 input tokens and 2,209 output tokens. The pilot
added `229089` micro-US dollars of observed spend and 43,171 milliseconds of
aggregate provider latency. OpenAI completed 12 records for `101305` micro-US
dollars; Anthropic completed 12 records for `127784` micro-US dollars. All
accounting was provider-observed: there were no conservative or unsettled
charges.

The post-run resume loaded all 24 completed records, dispatched zero calls, and
left the ledger head, event count, and spend unchanged. Directories were mode
`0700`; record, replay, manifest, ledger, and SQLite files were mode `0600`.
SQLite sidecars passed the same private-mode audit and were absent after clean
database closure.

## What M5 establishes

M5 establishes that the frozen Lachesis vertical slice can pin evidence, produce
typed answers or typed insufficiency, validate only visible evidence, construct
citations and provenance, account for provider usage, persist private artifacts,
and replay completed executions without external effects.

## Nonclaims

This result does **not** establish:

- provider superiority;
- graph, graph serialization, or TypeGraph model-quality superiority;
- production-scale throughput, availability, or security certification;
- correctness beyond the frozen 12-task repository-history corpus;
- permission to rerun the pilot or execute another experiment; or
- general model-quality conclusions.

The experiment, ledger, records, replay artifacts, reports, and permission
evidence are immutable. M5c changes release packaging and documentation only; it
does not reinterpret or rerun M5b.1.
