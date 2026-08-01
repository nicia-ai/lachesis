# Threat model

Protected assets include hidden gold, future and retired inventories,
credentials, provider caps, schedules, model requests/responses, retrieval
evidence, evaluation receipts, accounting ledgers, and first-attempt outcomes.

Threats include development or retired-material leakage; visible-but-denied or
read-only retired namespaces; history/cache/temp/archive leakage; metadata,
identifier, snippet, ordering, or structural exposure; derivation from retired
ancestors; prompt-injected documents; closed-AST escape; evidence becoming
instructions; session leakage; cross-arm/request/snapshot/evaluator
substitution; schedule or population selection; ambiguous effects; duplicate
dispatch; cap/pricing drift; credential exposure; delayed spend reporting; and
post-outcome protocol amendment.

Controls are pre-start namespace exclusion, opaque public-count commitments,
fail-closed role/session/derived-output quarantine, fresh restart identities and
seeds, permanent observer exclusion from influential roles, closed-AST local
execution, untrusted evidence values, frozen capabilities, strict schemas,
content addressing, full lineage, separate sessions, arm-blind local evaluation,
opaque population tokens, complete inventories, durable reservations, hash
chains, atomic persistence, concurrency one, zero retries, zero-dispatch
terminal resume, shadow accounting, kill gates, role isolation, redaction
review, and credential revocation/absence verification.

Residual risks include unknown retired-material exposure, provider cap lag, and
undocumented fees. Unknown exposure forbids reuse; financial risks require later
explicit acceptance. No risk creates authority here. This is an AI-assisted
threat model, not a professional audit or penetration test.
