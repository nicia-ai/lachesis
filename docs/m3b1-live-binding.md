# M3b.1: live-binding substrate

Status: closed as `complete-protocol-fail`. The immutable protocol probe
`a104cd5c...` executed 16 initial records and exposed a deterministic schema and
measurement defect. Its ledger, records, and report are frozen. The M3b.1
calibration `a4e61610...` and held-out `9feb01a0...` identities are
`superseded-unexecuted`.

M3b.1 binds the portable M3b evidence study to the already validated direct
provider routes without changing the four-arm factorial comparison:

- OpenAI Responses, `gpt-5.6-terra`, low reasoning, no temperature override, and
  provider retries zero;
- Anthropic Messages, `claude-sonnet-5`, adaptive-low thinking, provider retries
  zero, no temperature override, and the internal JSON-tool structured-output
  transport; and
- one conservative controller-managed retry for overload, timeout, or provider
  unavailability.

The historical provider output schema was a strict root object containing
`answer`, `citationIds`, and reconstructed `paths`. Its exact schema digest,
provider/model identity, core and provider AI SDK package versions, adapter
version, route, transport choice, and pricing entry are bound into each
experiment. Intercepted-fetch tests exercise the real installed provider
packages and prove that neither the arm label nor the evidence-source
implementation identity enters the provider request.

## Endpoints and decisions

The primary semantic endpoint is identical in every arm: answer correctness plus
the same expected fact-citation requirement. Relationship-citation correctness,
path reproduction, and supported path utilization are separate typed-encoding
outcomes and cannot add an arm-specific failure condition to the common primary
endpoint.

Each structural contrast concludes superiority only when every required provider
and repetition independently has:

1. complete expected paired coverage;
2. a paired difference in the correct direction;
3. at least 20 discordant pairs; and
4. Holm-adjusted `p <= 0.05` within the three-contrast structural family.

The negative-control conclusion requires complete coverage and a 95% paired
risk-difference lower bound of at least `-0.10` independently in every provider
and repetition. The overall conclusion additionally requires zero recorded
safety violations. Conditional-on-both-valid-output and path-utilization results
remain secondary.

## Accounting and resume

The Node-only controller validates the complete materialization, clean source
commit, credential-name presence, exact acknowledgement, and complete per-call
reservation capacity before opening a ledger. It then uses:

- an append-only, digest-chained campaign ledger and durable head;
- immutable content-addressed JSON records with mode `0600`;
- complete worst-case reservation before every initial or retry attempt; and
- provider-reported settlement when usage exists, zero settlement for proven
  pre-dispatch failures, and full conservative settlement for dispatched
  unknown-usage failures.

If an unknown-usage failure is retried, both attempts receive independent full
reservations and settlements. Budget exhaustion stops before dispatch. Completed
records resume without provider calls; a duplicate ambiguous reservation cannot
redispatch.

## Frozen economics

The pricing snapshot preserves cache-write accounting. A complete OpenAI request
reservation is `55,000 µUSD`; Anthropic is `40,000 µUSD`.

| Phase          | Initial | Maximum retries | Maximum calls | Theoretical ceiling |
| -------------- | ------: | --------------: | ------------: | ------------------: |
| Protocol probe |      16 |              16 |            32 |    `1,520,000 µUSD` |
| Calibration    |     240 |             240 |           480 |   `22,800,000 µUSD` |
| Held-out       |   2,560 |           2,560 |         5,120 |  `243,200,000 µUSD` |

The theoretical ceilings are disclosures, not authorization. The independent
operational pools are:

- development: `10,000,000 µUSD` total, with `6,000,000` OpenAI and `4,000,000`
  Anthropic; and
- held-out: `60,000,000 µUSD` total, with `35,000,000` OpenAI and `25,000,000`
  Anthropic.

Every individual worst-case request fits its provider subcap. Repeated
conservative settlements may exhaust the smaller pool and stop the phase.

## Historical identities and next gate

The M3b offline-unbound experiments `99dc013f...`, `aa88eeb7...`, and
`2101fe92...` remain report-only offline design identities. They cannot execute
or resume through the M3b.1 controller.

M3b.1 must not be rerun. [M3b.2](./m3b2-protocol-correction.md) replaces prose
answers and reconstructed paths with typed answer values, explicit abstention,
and canonical path references. It also preserves bounded provider and wire
diagnostics before applying domain validation. TypeGraph remains absent.
