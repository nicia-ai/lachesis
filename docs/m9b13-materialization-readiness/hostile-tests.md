# Hostile readiness tests

Twenty focused tests exercise all required rejection classes, including
forbidden retired paths and broad search, caller-selected inventories or
observers, copied/stale/consumed launch handles, incompatible role combinations,
gold or ordering leakage, duplicate and overlapping identities, near-duplicate
sources, missing provenance/exposure history, filesystem drift, network or
environment leakage, dependency fallback, and attempted schedule, corpus, or
gold output.

Each rejection asserts its exact reason while the complete prohibited-effect
ledger remains zero. The filesystem test creates only synthetic canaries in a
fresh system temporary directory, validates `0700`/`0600` and symlink rejection,
and removes the entire fixture in `finally`.
