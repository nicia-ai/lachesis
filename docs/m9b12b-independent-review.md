# M9b.12b independent review

Protocol: `lachesis-m9b12b-independent-review@1.0.0`.

Reviewed commit: `f1f4dae5b681e2237161be5da0d6e4781a15a538`.

Reviewed tree: `8609e77370ceefaffbd06752f1fc343903839c23`.

Decision: `m9b12b-independent-review-no-go`.

Disposition: `superseded-unregistered-quarantine-history-not-durable`.

The M9b.12b preregistration digest remains
`52807c052f6e3fab79a943a4e2c6644296823f3b40f49e4452ad40a641a83bd2`. Its
checksum-manifest digest remains
`ed9d3a0fda5c0bb753f17dcc01370281406ec6bfd4cc157f8927c6d2d892face`.

## Findings

1. The evaluator considers only the current assessment. A previously quarantined
   observer can submit clean current fields and regain `allow-role-start`
   because no trusted durable history is queried.
2. The influence-bearing per-role cases inspect only the exclusion array rather
   than the complete terminal security result and history-head binding.

## Required disposition

M9b.12b must not be externally registered. M9b.12c must supersede it without
changing any M9b.12, M9b.12a, or M9b.12b artifact byte. The correction is
limited to trusted append-only observer quarantine history, atomic assessment,
stale-decision revalidation, complete per-role assertions, supersession,
registration binding, and tests. The accepted scientific and financial protocol
remains unchanged.

This review accessed no corpus, retired material, gold, credential, provider,
registry, or live campaign state and granted no authority.
