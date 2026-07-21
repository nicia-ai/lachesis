# M5b.0 offline live-pilot infrastructure

Status: M5b.0 protocol probe closed as `complete-integrity-fail`; M5b.1
permission hardening implemented offline. The original experiment, records, and
ten-event ledger remain immutable and report-only.

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

M5b.1 extends this boundary to managed SQLite. Before TypeGraph or
`better-sqlite3` opens a database, the Node controller creates and validates the
immediate directory as an owned, non-symlink `0700` directory and exclusively
pre-creates the database with `O_EXCL | O_NOFOLLOW` at `0600`. Existing paths
must already be owned, regular, non-symlink files with exact mode `0600`; the
controller never repairs a permissive path after exposure. It audits the main
database and any rollback-journal, WAL, or shared-memory sidecars immediately
after SQLite opens and after execution. The process umask is never changed.

The root cause of the M5b.0 integrity failure was below the TypeGraph evidence
adapter: TypeGraph passed a missing path to `better-sqlite3`, SQLite created the
main file from its permissive creation mode, and journal/WAL/shared-memory files
inherited the resulting main-file permissions. Controlled child-process tests
reproduce that behavior under umasks `0022`, `0000`, and `0077`, then prove the
M5b.1 precreation boundary yields `0600` for every database artifact under all
three.

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

The failed probe experiment
`80b4f6e323b7e15a0f6ff8e0a711445aa401eba3c99fb47fe0943372ce36668a` is
permanently report-only. Execute and resume reject it before credential
inspection, locking, reservation, or dispatch. Its ten-event ledger ending at
`73e3c8495fc73093e3bd704633589c3c017a589f0e579d53b39b0ed1fa68e14d` and its
41,436 µUSD settlement are historical facts, not credited or altered by M5b.1.
