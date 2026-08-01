# Threat model

Protected assets include hidden gold, future inventories, credentials, provider
caps, schedules, model requests/responses, retrieval evidence, evaluation
receipts, accounting ledgers, and first-attempt outcomes.

Threats include development leakage; prompt-injected documents; model-authored
code escaping the closed AST; evidence becoming instructions; session leakage;
cross-arm/request/snapshot/evaluator substitution; schedule or population
selection; ambiguous effects; duplicate dispatch; cap/pricing drift; credential
exposure; delayed spend reporting; and post-outcome protocol amendment.

Controls are closed-AST local execution, untrusted evidence values, frozen
capabilities, strict schemas, content addressing, full lineage, separate
sessions, arm-blind local evaluation, opaque population tokens, exact complete
inventories, durable pre-dispatch reservations, hash chains, atomic persistence,
campaign-global concurrency one, zero retries, zero-dispatch terminal resume,
shadow accounting, kill gates, role isolation, redaction review, and credential
revocation/absence verification.

Residual risks include provider cap lag and undocumented fees. They require
explicit later acceptance and do not create authority here. This is an
AI-assisted threat model, not a professional audit or penetration test.
