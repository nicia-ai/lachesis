# M9b.13e.1 verification

All predecessor package, independent-review, and registration-receipt manifests
pass. M9b.12 through M9b.13e remain byte-identical. All 27 registered archive
files match recorded size and SHA-256. Preregistration, manifest, canonical
receipt, and 18-field scientific/financial identities reproduce exactly with
zero changed fields.

The M9b.13e.1 focused suite passes 18/18 tests. The five-file relevant
serialized suite passes 71/71. The complete serialized suite passes 72 files and
1,210 tests; the complete serialized coverage run also passes all 1,210 tests at
90.01% statements, 80.99% branches, 97.45% functions, and 93.70% lines. One
initial mixed run exceeded an existing historical Darwin test's five-second
default; the required serialized rerun passed with an explicit 15-second timeout
and no source change.

Strict JSON and canonicalization, changed-file formatting, local links, secrets,
TypeScript, lint, build, source safety, diff checks, Git integrity,
public-export, and version gates pass. The validator is private and pure; no
operational collector, network adapter, or acquisition runner was added.

All prohibited-effect counters are zero. No supplement was prepared, submitted,
or approved, and no external registry was selected or accessed.
