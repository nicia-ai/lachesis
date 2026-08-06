# M9b.13e.1 corrected retained controls

Only deliberate post-verification helper/path replacement by a malicious process
already running under the trusted operational UID is outside scope.

Finding 1's retained temporary descriptor, `fstat` and directory-entry identity
comparisons, descriptor retention through rename, final-entry identity check,
writable-descriptor closure, durability ordering, pre/post-publication checks,
atomic no-clobber publication, ordinary-race rejection, accidental and
controller-created substitution rejection, and no-seal-on-failure rule remain
mandatory. They are not merely defense in depth.

Findings 2–5 and 7 remain unresolved and mandatory. Finding 6 retains exact
helper/source/build/platform identity and exact acquired-evidence and receipt
binding. Digest verification immediately before every consequential use and all
freshness, blindness, hidden-gold, quarantine, accounting, and replay rules
remain mandatory. M9b.13e.1 does not make acquisition ready.

The study does not establish security against compromise of the trusted local
host, acquisition account, controller, kernel, administrator, hypervisor, or
pre-start local code, tool, and runtime installation.

Ordinary operator error, accidental controller or helper races, malformed or
adversarial external bytes, artifact substitution, partial persistence,
retired-corpus exposure, contamination, and failure to establish or retain the
trusted-session readiness invariant remain in scope and fail closed.
