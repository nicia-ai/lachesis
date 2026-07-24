# M8b.1 Stage 2 results

Status: `complete-offline-pass`

The existing private `lachesis` binary now implements only `catalog manifest`
with the frozen `--check`, `--out`, and source-bound `--verify` modes. Catalog
and policy locators bind bounded compiled-ESM bytes plus named exports. Modules
are loaded once per resolved source, and catalog, policy, fingerprint, manifest
digest, and canonical bytes are reconciled through existing alpha.3 APIs.

Outputs use private same-directory atomic writes, reject symlinks and unsafe
replacement, and require `--replace` before overwriting. Reports retain the
M8b.1 protocol, derived exit precedence, redaction policy, and
`lachesis-canonical-json/1`.

Focused tests cover deterministic check/output/verification, source-bound
identity mismatch, invalid exports and policies, malformed and duplicate modes,
bounded reads, existing outputs, replacement, symlinks, permission-shaped I/O
failure, hostile `__proto__`, and path redaction. A packed consumer installs the
private CLI tarball plus the five-package-era public kernel from the offline npm
store, contains no workspace reference, and passes Node 24 and TypeScript 6
strict checking with `skipLibCheck:false`.

No public export, generator dependency, catalog comparison, detached report
verification, package version, release metadata, provider path, or research
surface was added. Stage 3 did not begin.
