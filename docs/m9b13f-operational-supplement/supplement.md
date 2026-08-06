# M9b.13f minimal operational supplement

Protocol: `lachesis-m9b13f-embargo-compatible-operational-supplement-body/1`

This is a static, embargo-compatible operational supplement body awaiting an
external independent review. It is not a review decision, readiness
implementation, submission, authorization, or activation.

## Exact amendment

> Acquisition runs on a trusted controlled host with no malicious or unrelated
> concurrent process under the operational UID. All external bytes remain
> hostile.

Exact nonclaim:

> The study does not establish security against compromise of the trusted local
> host, acquisition account, controller, kernel, administrator, hypervisor, or
> pre-start local code, tool, and runtime installation.

Exact retained scope:

> Ordinary operator error, accidental controller or helper races, malformed or
> adversarial external bytes, artifact substitution, partial persistence,
> retired-corpus exposure, contamination, and failure to establish or retain the
> trusted-session readiness invariant remain in scope and fail closed.

## Boundary

The registered scientific and financial design is unchanged. The historical
operational-readiness record remains NO-GO. M9b.13e.3 is preserved with
disposition
`reviewed-no-go-not-live-eligible-superseded-only-as-operational-amendment-text-by-m9b13f`.

M9b.13e.3 code is not corrected. Its validators, synthetic ledger, admission
APIs, monitoring APIs, terminal receipts, and submission harness are prohibited
from live use, may not evidence readiness, and may not be activated through
configuration alone. M9b.13e.1, M9b.13e.2, and M9b.13e.3 runtime modules may not
be reused, imported, or activated by a future readiness implementation.

The package grants zero current authority. A future implementation requires a
new protocol identity and version, a new implementation, hostile offline
testing, independent review, a separately reviewed materialization binding, and
a separate acquisition authorization after a pass.

## Review separation

The opaque author commitment is
`sha256:f3a9af7024c827ceb360865b9708090e3cbe203ce946f1325a482cef671f822f`. The
body does not identify or choose a reviewer. Any later review receipt must use
protocol `lachesis-m9b13f-independent-supplement-review-receipt/1`, remain
external to the body digest, and bind a distinct reviewer commitment and all
bindings listed in `supplement.json`.
