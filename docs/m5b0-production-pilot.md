# M5b.0 offline live-pilot infrastructure

Status: implemented offline. No provider call or execution authorization is part
of this milestone.

M5b.0 turns the M5 evidence runtime into a controlled Node-only development
pilot without changing its portable trust boundary. The corpus is a frozen
artifact derived from Lachesis history at commit
`1f1bc5f2de01cfb1a1121eca072756c6f1aa4983`: commits and first parents,
repository documents and blob identities, source-backed milestone facts, and
twelve auditable questions. Eleven questions have deterministic answer witnesses
and one requires `insufficient-evidence`. The corpus never reads live GitHub.

## Controlled workflow

`m5b-pilot` exposes `materialize`, `validate`, `dry-run`, `execute`, `resume`,
and `report`. Materialization writes only frozen corpus and manifest artifacts.
Credential-free dry-run validates identities and complete-phase capacity but is
intentionally non-executable and creates no ledger or execution namespace.
Execution additionally requires the exact clean source commit, both named
credentials retained only in memory, exact identity and cap acknowledgement,
complete worst-case phase capacity, and a user-private external storage root.

The controller uses a hash-chained append-only ledger, durable head, atomic
content-addressed records, a stale-lock protocol, per-provider caps, and
per-attempt reservations. An interrupted reservation is conservatively charged
and never redispatched. Stored terminal records are immutable. Resume skips
every completed content-addressed record.

## Oracle and recovery boundary

The existing direct OpenAI Responses and Anthropic Messages/json-tool routes are
reused with the reduced output contract: `outcome`, `answerValues`, and
`supportingFactIds`. SDK retries remain zero. The controller permits one
symmetric transport retry per logical attempt, one bounded wire repair, and one
bounded semantic repair. Initial end-to-end, initial semantic, post-wire,
post-semantic, and final reliability outcomes are recorded separately. Each
physical provider attempt gets its own worst-case reservation and usage
settlement.

Raw request/output recovery artifacts and replay artifacts live below `0700`
directories as `0600` files. Durable records and reports contain only bounded
diagnostics, content digests, sizes, usage, and sanitized classifications. They
contain no credential or provider response identifier. The redaction audit runs
before every durable record write.

## Evidence and graph boundaries

Lexical evidence is the production default. Research evidence policies require
explicit opt-in and are absent from this pilot. TypeGraph 0.38 is the execution
store; in-memory fixtures establish the same M5 semantic behavior. TypeGraph's
storage snapshot identity remains distinct from repository fact valid-time and
recorded-time metadata.

The compiled plan/orchestration graph, TypeGraph knowledge/evidence graph, and
reconstructed run/provenance graph remain distinct. The model sees only the
public task contract and compiled lexical evidence. It does not see provider,
storage, graph-arm, policy, expected-answer, or source identity. Validation,
citations, canonical paths, and provenance use only the visible evidence view.

## Frozen development design

The protocol probe contains four initial records: one feasible and one
insufficient-evidence task for each provider. Its maximum is twelve physical
attempts and 570,000 µUSD (OpenAI 330,000; Anthropic 240,000).

The pilot contains 24 initial records. Per provider it permits 12 initial
attempts, 6 wire repairs, 6 semantic repairs, and 12 transport retries, for 36
attempts. The total maximum is 72 attempts and 3,420,000 µUSD (OpenAI 1,980,000;
Anthropic 1,440,000). Shared development caps are 5,000,000 total, 3,000,000
OpenAI, and 2,000,000 Anthropic.

Probe acceptance requires 4/4 precise durable classifications, 4/4 final correct
answers or abstentions, visible-evidence citations and provenance for answered
cases, accounting reconciliation, integrity, and zero unauthorized, capability,
or identity violations. Pilot acceptance applies corresponding 24/24 gates.

## Nonclaims

M5b.0 does not authorize or perform inference, establish production readiness,
compare providers, claim graph or TypeGraph model-quality benefit, or generalize
from this small development corpus. Live execution and the 24-record pilot each
require separate exact authorization; probe authorization does not authorize the
pilot.
