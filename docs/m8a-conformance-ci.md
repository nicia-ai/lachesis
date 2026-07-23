# Catalog conformance CI and migration

The supported alpha workflow treats conformance as an application-owned, offline
release gate. The catalog author supplies representative values and operation
inputs; Lachesis checks the registered versioned roles and produces a
content-addressed report or diagnostic.

## CI contract

The complete workflow is in
[`catalog-conformance.yml`](../fixtures/m8a-registry-consumer/.github/workflows/catalog-conformance.yml).
It uses a read-only GitHub token, Node 24.18.0, `npm ci --ignore-scripts`, the
strict consumer verification, and a Workers dry-run.

Fail the job when:

- package origin or a frozen package version changes unexpectedly;
- a plan does not compile within its capability/budget policy;
- a conformance assessment is rejected;
- a genuine semantic difference lacks `do-not-substitute`;
- a report or diagnostic digest does not verify; or
- repeated output is not byte-identical.

Do not configure CI to rewrite a role version automatically. A
`review-declaration` action is safe only under its recorded `safetyCondition`
and after author attestation. It never turns a semantic failure into
equivalence.

## Version-diff record

Store these fields for the old and candidate catalogs:

- catalog ID and version;
- catalog fingerprint;
- manifest digest;
- semantic-role protocol and declaration bytes;
- conformance fixture digest;
- verified report or diagnostic;
- migration disposition; and
- the newly compiled plan and semantic-contract identities.

A compatible result means the supplied finite suite passed. It still requires
recompilation because the candidate catalog fingerprint is different. A
declaration-repairable result pauses migration until the declaration is reviewed
and a fresh manifest is produced. A genuinely non-equivalent result requires
separate operations or an explicit caller migration.

The M8a machine report demonstrates all three paths. Its unsafe evolution is a
capability boundary change and must remain rejected.
